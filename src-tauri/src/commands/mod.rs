// ============================================================================
// WinCatalog — commands/mod.rs
// Tauri IPC commands
//
// Reads use db.read() (non-blocking vs writes via separate WAL reader).
// Writes use db.write() / db.write_transaction().
// ============================================================================

use std::path::PathBuf;
use std::sync::Mutex;
use crossbeam_channel::bounded;
use rusqlite::{params, OptionalExtension};
use tauri::{command, AppHandle, Emitter, State};

use crate::core::scanner::{self, ScanConfig, ScanMode, ScanStats};
use crate::core::scanner::watch::{FsWatcher, WatchConfig, WatchEvent, WatchEventCallback};
use crate::core::scanner::parallel::{self as parallel_scan, ParallelScanConfig, ParallelScanStats, ParallelScanEvent, ParallelEventCallback};
use crate::core::hasher::{self, HashStats};
use crate::core::jobs::JobRunner;
use crate::core::rename;
use crate::core::ai;
use crate::core::rules;
use crate::core::export::{self, ExportScope, ExportStats};
use crate::db::queries::{self, Entry, EntrySlim, Job, SearchResult, Volume};
use crate::db::Database;

pub struct AppState {
    pub db: Database,
    pub job_runner: Mutex<Option<JobRunner>>,
    pub watchers: Mutex<std::collections::HashMap<i64, FsWatcher>>,
    pub volume_watcher: Mutex<Option<crate::core::volume_watcher::VolumeWatcher>>,
}

// ============================================================================
// Volumes (READ)
// ============================================================================

#[command]
pub fn list_volumes(state: State<'_, AppState>) -> Result<Vec<Volume>, String> {
    state.db.read(|c| Ok(queries::list_volumes(c)?)).map_err(|e| e.to_string())
}

#[command]
pub fn get_volume(state: State<'_, AppState>, id: i64) -> Result<Option<Volume>, String> {
    state.db.read(move |c| Ok(queries::get_volume(c, id)?)).map_err(|e| e.to_string())
}

// ============================================================================
// Volumes (WRITE)
// ============================================================================

#[command]
pub fn add_volume(state: State<'_, AppState>, label: String, root_path: String) -> Result<i64, String> {
    let now = ts();
    state.db.write(move |c| Ok(queries::insert_volume(c, &label, &root_path, None, None, now)?))
        .map_err(|e| e.to_string())
}

// ============================================================================
// Entries (READ — slim for explorer, full for Inspector)
// ============================================================================

#[command]
pub fn list_entries(
    state: State<'_, AppState>, volume_id: i64, parent_path: String,
    cursor_mtime: Option<i64>, cursor_id: Option<i64>, limit: Option<i64>,
) -> Result<Vec<EntrySlim>, String> {
    let cursor = match (cursor_mtime, cursor_id) { (Some(m), Some(i)) => Some((m, i)), _ => None };
    let lim = limit.unwrap_or(200);
    state.db.read(move |c| Ok(queries::list_entries_slim(c, volume_id, &parent_path, cursor, lim)?))
        .map_err(|e| e.to_string())
}

#[command]
pub fn get_entry(state: State<'_, AppState>, id: i64) -> Result<Option<Entry>, String> {
    state.db.read(move |c| Ok(queries::get_entry(c, id)?)).map_err(|e| e.to_string())
}

// ============================================================================
// Search (READ)
// ============================================================================

#[command]
pub fn search(state: State<'_, AppState>, query: String, limit: Option<i64>) -> Result<Vec<SearchResult>, String> {
    let lim = limit.unwrap_or(50);
    state.db.read(move |c| Ok(queries::search_entries(c, &query, lim)?)).map_err(|e| e.to_string())
}

#[command]
pub fn search_content(state: State<'_, AppState>, query: String, limit: Option<i64>) -> Result<Vec<SearchResult>, String> {
    let lim = limit.unwrap_or(50);
    state.db.read(move |c| Ok(queries::search_text_content(c, &query, lim)?)).map_err(|e| e.to_string())
}

// ============================================================================
// Scan (WRITE — async)
// ============================================================================

#[command]
pub async fn start_scan(
    state: State<'_, AppState>, app: AppHandle, volume_id: i64, mode: String,
    max_depth: Option<usize>, compute_hash: Option<bool>, generate_thumbs: Option<bool>,
) -> Result<ScanStats, String> {
    // Read volume info (via reader — non-blocking)
    let volume = state.db.read(move |c| Ok(queries::get_volume(c, volume_id)?))
        .map_err(|e| e.to_string())?
        .ok_or("Volume not found")?;

    let mut config = ScanConfig {
        volume_id,
        root_path: PathBuf::from(&volume.root_path),
        mode: if mode == "quick" { ScanMode::Quick } else { ScanMode::Full },
        ..ScanConfig::default()
    };
    if let Some(d) = max_depth { config.max_depth = Some(d); }
    if let Some(h) = compute_hash { config.compute_hash = h; }
    if let Some(t) = generate_thumbs { config.generate_thumbs = t; }

    let db = state.db.clone();
    let (cancel_tx, cancel_rx) = bounded(1);

    let app_handle = app.clone();
    let on_event = Box::new(move |evt: scanner::ScanEvent| {
        let _ = app_handle.emit("scan-event", &evt);
    });

    // Keep cancel_tx alive for the duration of the scan so it can be
    // used to cancel via the channel. Move it into the blocking task.
    tokio::task::spawn_blocking(move || {
        let _keep_alive = cancel_tx;
        scanner::run_scan(&db, config, cancel_rx, Some(on_event))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| e.to_string())
}

// ============================================================================
// Jobs (READ)
// ============================================================================

#[command]
pub fn list_active_jobs(state: State<'_, AppState>) -> Result<Vec<Job>, String> {
    state.db.read(|c| Ok(queries::list_active_jobs(c)?)).map_err(|e| e.to_string())
}

// ============================================================================
// Duplicates (READ)
// ============================================================================

#[command]
pub fn find_duplicates(state: State<'_, AppState>, min_size: Option<i64>) -> Result<Vec<(String, i64, i64)>, String> {
    state.db.read(move |c| Ok(queries::find_duplicates(c, min_size)?)).map_err(|e| e.to_string())
}

#[command]
pub fn get_duplicate_group(state: State<'_, AppState>, hash: String) -> Result<Vec<Entry>, String> {
    state.db.read(move |c| Ok(queries::get_duplicate_group(c, &hash)?)).map_err(|e| e.to_string())
}

// ============================================================================
// Settings (READ/WRITE)
// ============================================================================

#[command]
pub fn get_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state.db.read(move |c| Ok(queries::get_setting(c, &key)?)).map_err(|e| e.to_string())
}

#[command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let now = ts();
    state.db.write(move |c| Ok(queries::set_setting(c, &key, &value, now)?)).map_err(|e| e.to_string())
}

// ============================================================================
// Tags (READ/WRITE)
// ============================================================================

#[command]
pub fn create_tag(state: State<'_, AppState>, name: String, color: Option<String>) -> Result<i64, String> {
    let now = ts();
    state.db.write(move |c| Ok(queries::create_tag(c, &name, color.as_deref(), now)?)).map_err(|e| e.to_string())
}

#[command]
pub fn tag_entry(state: State<'_, AppState>, entry_id: i64, tag_id: i64) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::tag_entry(c, entry_id, tag_id)?)).map_err(|e| e.to_string())
}

#[command]
pub fn get_entry_tags(state: State<'_, AppState>, entry_id: i64) -> Result<Vec<(i64, String, Option<String>)>, String> {
    state.db.read(move |c| Ok(queries::get_entry_tags(c, entry_id)?)).map_err(|e| e.to_string())
}

// ============================================================================
// Trash (WRITE)
// ============================================================================

#[command]
pub fn trash_entry(state: State<'_, AppState>, entry_id: i64, reason: Option<String>) -> Result<i64, String> {
    let now = ts();
    let r = reason.unwrap_or_else(|| "user".into());
    state.db.write(move |conn| {
        let entry = queries::get_entry(conn, entry_id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)?;
        let retention: i64 = queries::get_setting(conn, "trash.retention_days")?
            .and_then(|v| v.parse().ok()).unwrap_or(30);
        Ok(queries::trash_entry(conn, entry_id, entry.volume_id, &entry.path,
            entry.full_hash.as_deref(), &r, entry.size_bytes, None, now, retention)?)
    }).map_err(|e| e.to_string())
}

// ============================================================================
// Hash commands (WRITE — async)
// ============================================================================

#[command]
pub async fn start_hash(
    state: State<'_, AppState>, app: AppHandle,
    volume_id: i64, mode: String, min_size: Option<i64>,
) -> Result<HashStats, String> {
    let db = state.db.clone();
    let (cancel_tx, cancel_rx) = bounded(1);
    let app_handle = app.clone();
    let on_event = Box::new(move |evt: hasher::HashEvent| {
        let _ = app_handle.emit("hash-event", &evt);
    });
    let m = mode.clone();
    let ms = min_size.unwrap_or(0);

    // Keep cancel_tx alive for the duration of the hash so it can be
    // used to cancel via the channel. Move it into the blocking task.
    tokio::task::spawn_blocking(move || {
        let _keep_alive = cancel_tx;
        hasher::run_hash(&db, volume_id, &m, ms, cancel_rx, Some(on_event))
    })
    .await
    .map_err(|e| format!("Task error: {}", e))?
    .map_err(|e| e.to_string())
}

// ============================================================================
// Job runner control
// ============================================================================

#[command]
pub fn pause_jobs(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(ref runner) = *state.job_runner.lock().unwrap() {
        runner.pause();
    }
    Ok(())
}

#[command]
pub fn resume_jobs(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(ref runner) = *state.job_runner.lock().unwrap() {
        runner.resume();
    }
    Ok(())
}

#[command]
pub fn cancel_current_job(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(ref runner) = *state.job_runner.lock().unwrap() {
        runner.cancel_current();
    }
    Ok(())
}

#[command]
pub fn wake_job_runner(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(ref runner) = *state.job_runner.lock().unwrap() {
        runner.wake();
    }
    Ok(())
}

// ============================================================================
// Volumes — extended (task 8)
// ============================================================================

#[command]
pub fn update_volume(
    state: State<'_, AppState>, id: i64, label: String,
    disk_number: Option<String>, location_id: Option<i64>, scan_mode: String,
) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::update_volume(c, id, &label, disk_number.as_deref(), location_id, &scan_mode)?))
        .map_err(|e| e.to_string())
}

#[command]
pub fn update_volume_space(state: State<'_, AppState>, id: i64, total: i64, free: i64, used: i64) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::update_volume_space(c, id, total, free, used)?))
        .map_err(|e| e.to_string())
}

#[command]
pub fn delete_volume(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::delete_volume(c, id)?))
        .map_err(|e| e.to_string())
}

// ============================================================================
// Trash — extended (task 9)
// ============================================================================

#[command]
pub fn list_trash(state: State<'_, AppState>, volume_id: Option<i64>, limit: Option<i64>) -> Result<Vec<queries::TrashItem>, String> {
    let lim = limit.unwrap_or(100);
    state.db.read(move |c| Ok(queries::list_trash(c, volume_id, lim)?))
        .map_err(|e| e.to_string())
}

#[command]
pub fn restore_entry(state: State<'_, AppState>, trash_id: i64) -> Result<(), String> {
    let now = ts();
    state.db.write(move |c| Ok(queries::restore_trash_entry(c, trash_id, now)?))
        .map_err(|e| e.to_string())
}

#[command]
pub fn purge_expired(state: State<'_, AppState>) -> Result<i64, String> {
    let now = ts();
    state.db.write(move |c| Ok(queries::purge_expired_trash(c, now)?))
        .map_err(|e| e.to_string())
}

#[command]
pub fn trash_summary(state: State<'_, AppState>) -> Result<(i64, i64), String> {
    state.db.read(|c| Ok(queries::trash_summary(c)?))
        .map_err(|e| e.to_string())
}

// ============================================================================
// Dashboard queries (task 10)
// ============================================================================

#[command]
pub fn get_volume_kind_stats(state: State<'_, AppState>, volume_id: i64) -> Result<Vec<queries::KindStat>, String> {
    state.db.read(move |c| Ok(queries::get_volume_kind_stats(c, volume_id)?))
        .map_err(|e| e.to_string())
}

#[command]
pub fn get_global_kind_stats(state: State<'_, AppState>) -> Result<Vec<queries::KindStat>, String> {
    state.db.read(|c| Ok(queries::get_global_kind_stats(c)?))
        .map_err(|e| e.to_string())
}

#[command]
pub fn get_recent_scan_log(
    state: State<'_, AppState>, volume_id: Option<i64>, event_filter: Option<String>, limit: Option<i64>,
) -> Result<Vec<queries::ScanLogEntry>, String> {
    let lim = limit.unwrap_or(50);
    state.db.read(move |c| Ok(queries::get_recent_scan_log(c, volume_id, event_filter.as_deref(), lim)?))
        .map_err(|e| e.to_string())
}

#[command]
pub fn get_top_folders(state: State<'_, AppState>, volume_id: i64, parent_path: String, limit: Option<i64>) -> Result<Vec<queries::FolderStat>, String> {
    let lim = limit.unwrap_or(20);
    state.db.read(move |c| Ok(queries::get_top_folders(c, volume_id, &parent_path, lim)?))
        .map_err(|e| e.to_string())
}

#[command]
pub fn get_volume_snapshots(state: State<'_, AppState>, volume_id: i64, limit: Option<i64>) -> Result<Vec<queries::VolumeSnapshot>, String> {
    let lim = limit.unwrap_or(30);
    state.db.read(move |c| Ok(queries::get_volume_snapshots(c, volume_id, lim)?))
        .map_err(|e| e.to_string())
}

// ============================================================================
// Tags — extended
// ============================================================================

#[command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<queries::Tag>, String> {
    state.db.read(|c| Ok(queries::list_tags(c)?)).map_err(|e| e.to_string())
}

#[command]
pub fn update_tag(state: State<'_, AppState>, id: i64, name: String, color: Option<String>) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::update_tag(c, id, &name, color.as_deref())?)).map_err(|e| e.to_string())
}

#[command]
pub fn delete_tag(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::delete_tag(c, id)?)).map_err(|e| e.to_string())
}

#[command]
pub fn untag_entry(state: State<'_, AppState>, entry_id: i64, tag_id: i64) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::untag_entry(c, entry_id, tag_id)?)).map_err(|e| e.to_string())
}

// ============================================================================
// Collections
// ============================================================================

#[command]
pub fn list_collections(state: State<'_, AppState>) -> Result<Vec<queries::Collection>, String> {
    state.db.read(|c| Ok(queries::list_collections(c)?)).map_err(|e| e.to_string())
}

#[command]
pub fn create_collection(state: State<'_, AppState>, name: String, description: Option<String>,
    icon: Option<String>, color: Option<String>, is_smart: bool, smart_query: Option<String>) -> Result<i64, String>
{
    let now = ts();
    state.db.write(move |c| Ok(queries::create_collection(c, &name, description.as_deref(), icon.as_deref(),
        color.as_deref(), is_smart, smart_query.as_deref(), now)?)).map_err(|e| e.to_string())
}

#[command]
pub fn update_collection(state: State<'_, AppState>, id: i64, name: String, description: Option<String>,
    icon: Option<String>, color: Option<String>, smart_query: Option<String>) -> Result<(), String>
{
    let now = ts();
    state.db.write(move |c| Ok(queries::update_collection(c, id, &name, description.as_deref(),
        icon.as_deref(), color.as_deref(), smart_query.as_deref(), now)?)).map_err(|e| e.to_string())
}

#[command]
pub fn delete_collection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::delete_collection(c, id)?)).map_err(|e| e.to_string())
}

#[command]
pub fn add_to_collection(state: State<'_, AppState>, collection_id: i64, entry_id: i64) -> Result<(), String> {
    let now = ts();
    state.db.write(move |c| Ok(queries::add_to_collection(c, collection_id, entry_id, now)?)).map_err(|e| e.to_string())
}

#[command]
pub fn remove_from_collection(state: State<'_, AppState>, collection_id: i64, entry_id: i64) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::remove_from_collection(c, collection_id, entry_id)?)).map_err(|e| e.to_string())
}

#[command]
pub fn get_collection_entries(state: State<'_, AppState>, collection_id: i64, limit: Option<i64>) -> Result<Vec<EntrySlim>, String> {
    let lim = limit.unwrap_or(500);
    state.db.read(move |c| Ok(queries::get_collection_entries(c, collection_id, lim)?)).map_err(|e| e.to_string())
}

// ============================================================================
// Custom fields
// ============================================================================

#[command]
pub fn list_custom_fields(state: State<'_, AppState>) -> Result<Vec<queries::CustomField>, String> {
    state.db.read(|c| Ok(queries::list_custom_fields(c)?)).map_err(|e| e.to_string())
}

#[command]
pub fn create_custom_field(state: State<'_, AppState>, name: String, field_type: String, options: Option<String>) -> Result<i64, String> {
    let now = ts();
    state.db.write(move |c| Ok(queries::create_custom_field(c, &name, &field_type, options.as_deref(), now)?)).map_err(|e| e.to_string())
}

#[command]
pub fn delete_custom_field(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::delete_custom_field(c, id)?)).map_err(|e| e.to_string())
}

#[command]
pub fn get_entry_custom_values(state: State<'_, AppState>, entry_id: i64) -> Result<Vec<(i64, String, String, Option<String>)>, String> {
    state.db.read(move |c| Ok(queries::get_entry_custom_values(c, entry_id)?)).map_err(|e| e.to_string())
}

#[command]
pub fn set_entry_custom_value(state: State<'_, AppState>, entry_id: i64, field_id: i64, value: Option<String>) -> Result<(), String> {
    state.db.write(move |c| Ok(queries::set_entry_custom_value(c, entry_id, field_id, value.as_deref())?)).map_err(|e| e.to_string())
}

// ============================================================================
// Rename batch
// ============================================================================

#[command]
pub fn preview_rename(state: State<'_, AppState>, entry_ids: Vec<i64>, pattern: String) -> Result<Vec<rename::RenamePreview>, String> {
    rename::preview_rename(&state.db, &entry_ids, &pattern).map_err(|e| e.to_string())
}

#[command]
pub fn apply_rename(state: State<'_, AppState>, previews: Vec<rename::RenamePreview>, volume_id: i64) -> Result<rename::RenameStats, String> {
    rename::apply_rename(&state.db, &previews, volume_id).map_err(|e| e.to_string())
}

// ============================================================================
// AI
// ============================================================================

#[command]
pub fn ai_classify(state: State<'_, AppState>, entry_id: i64) -> Result<ai::ClassifyResult, String> {
    let config = ai::AiConfig::load(&state.db).map_err(|e| e.to_string())?;
    let text = state.db.read(move |c| {
        c.prepare_cached("SELECT text FROM entry_text WHERE entry_id=?1")?
            .query_row(params![entry_id], |r| r.get::<_,String>(0))
            .optional().map_err(crate::db::DbError::Sqlite)
    }).map_err(|e| e.to_string())?.ok_or("No text extracted for this entry")?;
    ai::classify_document(&state.db, &config, entry_id, &text).map_err(|e| e.to_string())
}

#[command]
pub fn ai_summarize(state: State<'_, AppState>, entry_id: i64) -> Result<String, String> {
    let config = ai::AiConfig::load(&state.db).map_err(|e| e.to_string())?;
    let text = state.db.read(move |c| {
        c.prepare_cached("SELECT text FROM entry_text WHERE entry_id=?1")?
            .query_row(params![entry_id], |r| r.get::<_,String>(0))
            .optional().map_err(crate::db::DbError::Sqlite)
    }).map_err(|e| e.to_string())?.ok_or("No text extracted for this entry")?;
    ai::summarize_document(&state.db, &config, entry_id, &text).map_err(|e| e.to_string())
}

#[command]
pub fn ai_analyze_image(state: State<'_, AppState>, entry_id: i64) -> Result<Vec<String>, String> {
    let config = ai::AiConfig::load(&state.db).map_err(|e| e.to_string())?;
    let path: String = state.db.read(move |c| {
        c.prepare_cached("SELECT path FROM entries WHERE id=?1")?
            .query_row(params![entry_id], |r| r.get(0)).map_err(crate::db::DbError::Sqlite)
    }).map_err(|e| e.to_string())?;
    ai::analyze_image(&state.db, &config, entry_id, std::path::Path::new(&path)).map_err(|e| e.to_string())
}

// ============================================================================
// Rules
// ============================================================================

#[command]
pub fn list_rules(state: State<'_, AppState>) -> Result<Vec<rules::AutoRule>, String> {
    rules::load_rules(&state.db).map_err(|e| e.to_string())
}

#[command]
pub fn save_rules(state: State<'_, AppState>, rule_list: Vec<rules::AutoRule>) -> Result<(), String> {
    rules::save_rules(&state.db, &rule_list).map_err(|e| e.to_string())
}

// ============================================================================
// Export catalogue (Phase 3)
// ============================================================================

#[command]
pub fn export_catalogue(
    state: State<'_, AppState>, format: String, scope: String, output_path: String,
) -> Result<ExportStats, String> {
    let s = ExportScope::from_str(&scope).map_err(|e| e.to_string())?;
    let path = std::path::Path::new(&output_path);
    match format.as_str() {
        "sqlite" => export::export_sqlite(&state.db, path, &s).map_err(|e| e.to_string()),
        "json" => export::export_json(&state.db, path, &s).map_err(|e| e.to_string()),
        "csv" => export::export_csv(&state.db, path, &s).map_err(|e| e.to_string()),
        _ => Err(format!("Unsupported format: {}", format)),
    }
}

// ============================================================================
// Parallel scan (Phase 3)
// ============================================================================

#[command]
pub async fn start_parallel_scan(
    state: State<'_, AppState>, app: AppHandle,
    volume_ids: Vec<i64>, mode: String, max_concurrent: Option<usize>,
) -> Result<ParallelScanStats, String> {
    let db = state.db.clone();
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    let config = ParallelScanConfig {
        volume_ids,
        mode: if mode == "quick" { ScanMode::Quick } else { ScanMode::Full },
        max_concurrent: max_concurrent.unwrap_or(0),
        ..ParallelScanConfig::default()
    };

    let app_handle = app.clone();
    let on_event: Option<ParallelEventCallback> = Some(std::sync::Arc::new(move |evt: ParallelScanEvent| {
        let _ = app_handle.emit("parallel-scan-event", &evt);
    }));

    let cancel_clone = cancel.clone();
    tokio::task::spawn_blocking(move || {
        parallel_scan::run_parallel_scan(&db, config, cancel_clone, on_event)
    })
    .await
    .map_err(|e| format!("Task error: {}", e))
}

// ============================================================================
// Extractor plugins info
// ============================================================================

#[command]
pub fn list_extractor_plugins() -> Result<Vec<crate::core::extractors::plugins::PluginInfo>, String> {
    let registry = crate::core::extractors::plugins::ExtractorRegistry::with_defaults();
    Ok(registry.list_plugins())
}

// ============================================================================
// Watch mode (Phase 3)
// ============================================================================

#[command]
pub fn start_watch(state: State<'_, AppState>, app: AppHandle, volume_id: i64) -> Result<(), String> {
    let volume = state.db.read(move |c| Ok(queries::get_volume(c, volume_id)?))
        .map_err(|e| e.to_string())?
        .ok_or("Volume not found")?;

    let config = WatchConfig {
        volume_id,
        root_path: PathBuf::from(&volume.root_path),
        ..WatchConfig::default()
    };

    let app_handle = app.clone();
    let on_event: Option<WatchEventCallback> = Some(std::sync::Arc::new(move |evt: WatchEvent| {
        let _ = app_handle.emit("watch-event", &evt);
    }));

    let watcher = FsWatcher::start(state.db.clone(), config, on_event)
        .map_err(|e| e.to_string())?;

    state.watchers.lock().unwrap().insert(volume_id, watcher);
    Ok(())
}

#[command]
pub fn stop_watch(state: State<'_, AppState>, volume_id: i64) -> Result<(), String> {
    if let Some(watcher) = state.watchers.lock().unwrap().remove(&volume_id) {
        watcher.stop();
    }
    Ok(())
}

#[command]
pub fn list_watched_volumes(state: State<'_, AppState>) -> Result<Vec<i64>, String> {
    Ok(state.watchers.lock().unwrap().keys().cloned().collect())
}

// ============================================================================
// Diagnostics (READ)
// ============================================================================

#[command]
pub fn get_db_diagnostics(state: State<'_, AppState>) -> Result<crate::db::pragmas::PragmaDiagnostics, String> {
    state.db.read(|c| Ok(crate::db::pragmas::get_diagnostics(c)?)).map_err(|e| e.to_string())
}

fn ts() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}
