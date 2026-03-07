// ============================================================================
// WinCatalog — core/scanner/watch.rs
// Watch mode: real-time filesystem change detection via `notify` crate
//
// Uses notify::RecommendedWatcher which maps to:
//   - Windows: ReadDirectoryChangesW
//   - macOS: FSEvents
//   - Linux: inotify
//
// Changes are debounced (500ms) and batch-processed into the DB.
// ============================================================================

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crossbeam_channel::{bounded, select, Receiver, Sender};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::params;

use crate::db::{Database, DbError, DbResult};

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum WatchEvent {
    Started { volume_id: i64, path: String },
    Change { volume_id: i64, kind: String, paths: Vec<String> },
    Error { volume_id: i64, error: String },
    Stopped { volume_id: i64 },
}

pub type WatchEventCallback = Arc<dyn Fn(WatchEvent) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct WatchConfig {
    pub volume_id: i64,
    pub root_path: PathBuf,
    pub debounce_ms: u64,
    pub exclusions: Vec<String>,
}

impl Default for WatchConfig {
    fn default() -> Self {
        Self {
            volume_id: 0,
            root_path: PathBuf::new(),
            debounce_ms: 500,
            exclusions: vec![
                "node_modules".into(), ".git".into(), ".DS_Store".into(),
                "Thumbs.db".into(), "$RECYCLE.BIN".into(),
            ],
        }
    }
}

// ============================================================================
// Watch handle
// ============================================================================

pub struct FsWatcher {
    stop_tx: Sender<()>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl FsWatcher {
    /// Start watching a directory tree for changes.
    pub fn start(
        db: Database,
        config: WatchConfig,
        on_event: Option<WatchEventCallback>,
    ) -> Result<Self, String> {
        let (stop_tx, stop_rx) = bounded::<()>(1);

        let thread = std::thread::Builder::new()
            .name(format!("fs-watch-{}", config.volume_id))
            .spawn(move || {
                if let Err(e) = watch_loop(db, config, stop_rx, on_event) {
                    log::error!("Watch loop error: {}", e);
                }
            })
            .map_err(|e| format!("Spawn watch thread: {}", e))?;

        Ok(Self { stop_tx, thread: Some(thread) })
    }

    pub fn stop(mut self) {
        let _ = self.stop_tx.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for FsWatcher {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
    }
}

// ============================================================================
// Internal: watch loop with debouncing
// ============================================================================

fn watch_loop(
    db: Database,
    config: WatchConfig,
    stop_rx: Receiver<()>,
    on_event: Option<WatchEventCallback>,
) -> Result<(), String> {
    let emit = |evt: WatchEvent| {
        if let Some(ref cb) = on_event { cb(evt); }
    };

    // Channel for notify events
    let (notify_tx, notify_rx) = bounded::<notify::Result<Event>>(1024);

    // Create watcher
    let mut watcher = RecommendedWatcher::new(
        move |res| { let _ = notify_tx.send(res); },
        Config::default().with_poll_interval(Duration::from_secs(2)),
    ).map_err(|e| format!("Create watcher: {}", e))?;

    watcher.watch(&config.root_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Watch path: {}", e))?;

    emit(WatchEvent::Started {
        volume_id: config.volume_id,
        path: config.root_path.display().to_string(),
    });

    log::info!("Watch started on {} (volume {})", config.root_path.display(), config.volume_id);

    let debounce = Duration::from_millis(config.debounce_ms);
    let mut pending: HashMap<PathBuf, ChangeKind> = HashMap::new();
    let mut last_flush = Instant::now();

    loop {
        // Check for stop signal or notify event
        select! {
            recv(stop_rx) -> _ => {
                log::info!("Watch stopped for volume {}", config.volume_id);
                emit(WatchEvent::Stopped { volume_id: config.volume_id });
                break;
            }
            recv(notify_rx) -> msg => {
                match msg {
                    Ok(Ok(event)) => {
                        if let Some(kind) = classify_event(&event.kind) {
                            for path in &event.paths {
                                if should_exclude_path(path, &config.exclusions) { continue; }
                                pending.insert(path.clone(), kind);
                            }
                        }
                    }
                    Ok(Err(e)) => {
                        log::warn!("Watch error: {}", e);
                        emit(WatchEvent::Error { volume_id: config.volume_id, error: e.to_string() });
                    }
                    Err(_) => break, // channel disconnected
                }
            }
            default(debounce) => {}
        }

        // Flush pending changes if debounce period elapsed
        if !pending.is_empty() && last_flush.elapsed() >= debounce {
            let changes: Vec<(PathBuf, ChangeKind)> = pending.drain().collect();
            process_changes(&db, config.volume_id, &changes, &emit);
            last_flush = Instant::now();
        }
    }

    Ok(())
}

// ============================================================================
// Change classification
// ============================================================================

#[derive(Debug, Clone, Copy)]
enum ChangeKind {
    Created,
    Modified,
    Removed,
}

fn classify_event(kind: &EventKind) -> Option<ChangeKind> {
    match kind {
        EventKind::Create(_) => Some(ChangeKind::Created),
        EventKind::Modify(_) => Some(ChangeKind::Modified),
        EventKind::Remove(_) => Some(ChangeKind::Removed),
        _ => None,
    }
}

fn should_exclude_path(path: &Path, exclusions: &[String]) -> bool {
    for component in path.components() {
        let name = component.as_os_str().to_string_lossy();
        if exclusions.iter().any(|ex| name.as_ref() == ex.as_str()) {
            return true;
        }
    }
    false
}

// ============================================================================
// Process changes: upsert/delete entries in DB
// ============================================================================

fn process_changes(
    db: &Database,
    volume_id: i64,
    changes: &[(PathBuf, ChangeKind)],
    emit: &dyn Fn(WatchEvent),
) {
    let now = ts();
    let mut created_paths = Vec::new();
    let mut modified_paths = Vec::new();
    let mut removed_paths = Vec::new();

    for (path, kind) in changes {
        match kind {
            ChangeKind::Created | ChangeKind::Modified => {
                let metadata = match std::fs::metadata(path) {
                    Ok(m) => m,
                    Err(_) => continue, // file disappeared between event and processing
                };

                let is_dir = metadata.is_dir();
                let full_path = path.to_string_lossy().to_string();
                let parent = path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                let ext = if is_dir { None } else { path.extension().map(|e| e.to_string_lossy().to_lowercase()) };
                let file_kind = if is_dir { "dir".to_string() } else {
                    super::kind::detect_kind(ext.as_deref(), None)
                };
                let size = if is_dir { 0 } else { metadata.len() as i64 };
                let mtime = metadata.modified().ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64);

                let result = db.write(move |conn| {
                    conn.execute(
                        "INSERT INTO entries (volume_id,path,parent_path,name,is_dir,kind,ext,size_bytes,mtime,status,last_seen_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'present',?10)
                         ON CONFLICT(volume_id,path) DO UPDATE SET
                           name=excluded.name, is_dir=excluded.is_dir, kind=excluded.kind,
                           ext=excluded.ext, size_bytes=excluded.size_bytes, mtime=excluded.mtime,
                           status='present', last_seen_at=excluded.last_seen_at",
                        params![volume_id, full_path, parent, name, is_dir as i32, file_kind, ext, size, mtime, now],
                    )?;
                    Ok(())
                });

                if result.is_ok() {
                    match kind {
                        ChangeKind::Created => created_paths.push(path.to_string_lossy().to_string()),
                        ChangeKind::Modified => modified_paths.push(path.to_string_lossy().to_string()),
                        _ => {}
                    }
                }
            }
            ChangeKind::Removed => {
                let full_path = path.to_string_lossy().to_string();
                let _ = db.write(move |conn| {
                    conn.execute(
                        "UPDATE entries SET status='missing' WHERE volume_id=?1 AND path=?2",
                        params![volume_id, full_path],
                    )?;
                    Ok(())
                });
                removed_paths.push(path.to_string_lossy().to_string());
            }
        }
    }

    // Emit aggregated events
    if !created_paths.is_empty() {
        emit(WatchEvent::Change { volume_id, kind: "created".into(), paths: created_paths });
    }
    if !modified_paths.is_empty() {
        emit(WatchEvent::Change { volume_id, kind: "modified".into(), paths: modified_paths });
    }
    if !removed_paths.is_empty() {
        emit(WatchEvent::Change { volume_id, kind: "removed".into(), paths: removed_paths });
    }
}

fn ts() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}
