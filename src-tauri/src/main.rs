// ============================================================================
// WinCatalog — main.rs
// ============================================================================

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager};
use wincatalog_lib::commands::{self, AppState};
use wincatalog_lib::core::jobs::{JobRunner, JobEvent, JobEventCallback};
use wincatalog_lib::core::volume_watcher::{self, VolumeWatcher, VolumeEvent, VolumeEventCallback};
use wincatalog_lib::db::Database;

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .setup(|app| {
            let app_data = app.path().app_data_dir()
                .expect("Failed to resolve app data dir");
            std::fs::create_dir_all(&app_data)
                .expect("Failed to create app data directory");

            let db_path = app_data.join("catalog.db");
            log::info!("Database path: {}", db_path.display());

            let database = Database::open(&db_path)
                .expect("Failed to open database");

            // Check volume connectivity at startup
            match volume_watcher::check_all_volumes(&database) {
                Ok((online, offline)) => {
                    log::info!("Volumes: {} online, {} offline", online.len(), offline.len());
                }
                Err(e) => log::warn!("Failed to check volumes: {}", e),
            }

            // Start background volume watcher (poll every 5s)
            let app_handle_vol = app.handle().clone();
            let on_vol_event: Option<VolumeEventCallback> = Some(std::sync::Arc::new(move |evt: VolumeEvent| {
                let _ = app_handle_vol.emit("volume-event", &evt);
            }));
            let _watcher = VolumeWatcher::start(
                database.clone(),
                std::time::Duration::from_secs(5),
                on_vol_event,
            );

            // Start background job runner
            let app_handle_job = app.handle().clone();
            let on_job_event: Option<JobEventCallback> = Some(std::sync::Arc::new(move |evt: JobEvent| {
                let _ = app_handle_job.emit("job-event", &evt);
            }));
            let runner = JobRunner::start(database.clone(), on_job_event);
            log::info!("Job runner started");

            app.manage(AppState {
                db: database,
                job_runner: std::sync::Mutex::new(Some(runner)),
                watchers: std::sync::Mutex::new(std::collections::HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Volumes
            commands::list_volumes,
            commands::get_volume,
            commands::add_volume,
            commands::update_volume,
            commands::update_volume_space,
            commands::delete_volume,
            // Entries
            commands::list_entries,
            commands::get_entry,
            // Search
            commands::search,
            commands::search_content,
            // Scan
            commands::start_scan,
            // Jobs
            commands::list_active_jobs,
            commands::pause_jobs,
            commands::resume_jobs,
            commands::cancel_current_job,
            commands::wake_job_runner,
            // Hash
            commands::start_hash,
            // Duplicates
            commands::find_duplicates,
            commands::get_duplicate_group,
            // Settings
            commands::get_setting,
            commands::set_setting,
            // Tags
            commands::create_tag,
            commands::tag_entry,
            commands::get_entry_tags,
            // Trash
            commands::trash_entry,
            commands::list_trash,
            commands::restore_entry,
            commands::purge_expired,
            commands::trash_summary,
            // Tags — extended
            commands::list_tags,
            commands::update_tag,
            commands::delete_tag,
            commands::untag_entry,
            // Collections
            commands::list_collections,
            commands::create_collection,
            commands::update_collection,
            commands::delete_collection,
            commands::add_to_collection,
            commands::remove_from_collection,
            commands::get_collection_entries,
            // Custom fields
            commands::list_custom_fields,
            commands::create_custom_field,
            commands::delete_custom_field,
            commands::get_entry_custom_values,
            commands::set_entry_custom_value,
            // Rename
            commands::preview_rename,
            commands::apply_rename,
            // AI
            commands::ai_classify,
            commands::ai_summarize,
            commands::ai_analyze_image,
            // Rules
            commands::list_rules,
            commands::save_rules,
            // Watch mode
            commands::start_watch,
            commands::stop_watch,
            commands::list_watched_volumes,
            // Export
            commands::export_catalogue,
            // Parallel scan
            commands::start_parallel_scan,
            // Extractor plugins
            commands::list_extractor_plugins,
            // Dashboard
            commands::get_volume_kind_stats,
            commands::get_global_kind_stats,
            commands::get_recent_scan_log,
            commands::get_top_folders,
            commands::get_volume_snapshots,
            // Diagnostics
            commands::get_db_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running WinCatalog");
}
