// ============================================================================
// WinCatalog — core/volume_watcher/mod.rs
// Volume connectivity: detect online/offline, auto-detect by fs_uuid
//
// Strategy:
//   - At startup: check all volumes' root_path accessibility → update is_online
//   - Polling thread: every 5s, re-check offline volumes for reconnection
//   - When a volume comes back online: emit event, optionally trigger quick scan
//   - fs_uuid matching: detect a volume even if drive letter changed (Windows)
//
// Phase 3 will add ReadDirectoryChangesW for real-time detection.
// ============================================================================

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crossbeam_channel::{bounded, Receiver, Sender};
use rusqlite::params;

use crate::db::{Database, DbError, DbResult};

// ============================================================================
// Events
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum VolumeEvent {
    /// A volume came back online
    Online { volume_id: i64, label: String, root_path: String },
    /// A volume went offline
    Offline { volume_id: i64, label: String },
    /// Initial status report after startup check
    StatusReport { online: Vec<i64>, offline: Vec<i64> },
}

pub type VolumeEventCallback = std::sync::Arc<dyn Fn(VolumeEvent) + Send + Sync>;

// ============================================================================
// Volume info (minimal, for the watcher)
// ============================================================================

#[derive(Debug, Clone)]
struct VolumeInfo {
    id: i64,
    label: String,
    root_path: String,
    fs_uuid: Option<String>,
    is_online: bool,
    auto_detect: bool,
}

// ============================================================================
// Public API
// ============================================================================

/// Check all volumes at startup and update their online status.
/// Returns (online_ids, offline_ids).
pub fn check_all_volumes(db: &Database) -> DbResult<(Vec<i64>, Vec<i64>)> {
    let volumes = load_volumes(db)?;
    let now = ts();
    let mut online = Vec::new();
    let mut offline = Vec::new();

    for vol in &volumes {
        let accessible = Path::new(&vol.root_path).exists();
        if accessible {
            online.push(vol.id);
        } else {
            offline.push(vol.id);
        }

        // Update if status changed
        if accessible != vol.is_online {
            let _ = set_online(db, vol.id, accessible, now);
            if accessible {
                log::info!("Volume '{}' ({}) is online", vol.label, vol.root_path);
            } else {
                log::info!("Volume '{}' ({}) is offline", vol.label, vol.root_path);
            }
        }
    }

    Ok((online, offline))
}

/// Start background polling thread that watches for volume reconnection.
pub struct VolumeWatcher {
    stop_tx: Sender<()>,
    thread: Option<thread::JoinHandle<()>>,
}

impl VolumeWatcher {
    pub fn start(
        db: Database,
        poll_interval: Duration,
        on_event: Option<VolumeEventCallback>,
    ) -> Self {
        let (stop_tx, stop_rx) = bounded::<()>(1);

        let thread = thread::Builder::new()
            .name("volume-watcher".into())
            .spawn(move || {
                watcher_loop(db, poll_interval, stop_rx, on_event);
            })
            .expect("Failed to spawn volume watcher");

        Self {
            stop_tx,
            thread: Some(thread),
        }
    }

    pub fn stop(mut self) {
        let _ = self.stop_tx.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for VolumeWatcher {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
    }
}

// ============================================================================
// Internal: watcher loop
// ============================================================================

fn watcher_loop(
    db: Database,
    poll_interval: Duration,
    stop_rx: Receiver<()>,
    on_event: Option<VolumeEventCallback>,
) {
    log::info!("Volume watcher started (poll every {:?})", poll_interval);

    let emit = |evt: VolumeEvent| {
        if let Some(ref cb) = on_event {
            cb(evt);
        }
    };

    loop {
        // Sleep or stop
        match stop_rx.recv_timeout(poll_interval) {
            Ok(()) => {
                log::info!("Volume watcher: stop signal");
                break;
            }
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
        }

        // Load current volumes
        let volumes = match load_volumes(&db) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("Volume watcher: DB error: {}", e);
                continue;
            }
        };

        let now = ts();

        for vol in &volumes {
            let accessible = Path::new(&vol.root_path).exists();

            if accessible && !vol.is_online {
                // Volume came back online!
                let _ = set_online(&db, vol.id, true, now);
                log::info!("Volume '{}' reconnected at {}", vol.label, vol.root_path);
                emit(VolumeEvent::Online {
                    volume_id: vol.id,
                    label: vol.label.clone(),
                    root_path: vol.root_path.clone(),
                });
            } else if !accessible && vol.is_online {
                // Volume went offline
                let _ = set_online(&db, vol.id, false, now);
                log::info!("Volume '{}' disconnected", vol.label);
                emit(VolumeEvent::Offline {
                    volume_id: vol.id,
                    label: vol.label.clone(),
                });
            }
        }
    }

    log::info!("Volume watcher stopped");
}

// ============================================================================
// Internal: DB helpers
// ============================================================================

fn load_volumes(db: &Database) -> DbResult<Vec<VolumeInfo>> {
    db.read(|conn| {
        let mut stmt = conn.prepare_cached(
            "SELECT id, label, root_path, fs_uuid, is_online, auto_detect FROM volumes"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(VolumeInfo {
                id: r.get(0)?,
                label: r.get(1)?,
                root_path: r.get(2)?,
                fs_uuid: r.get(3)?,
                is_online: r.get::<_, i32>(4)? != 0,
                auto_detect: r.get::<_, i32>(5)? != 0,
            })
        })?.filter_map(|r| r.ok()).collect();
        Ok(rows)
    })
}

fn set_online(db: &Database, volume_id: i64, online: bool, now: i64) -> DbResult<()> {
    db.write(move |conn| {
        conn.execute(
            "UPDATE volumes SET is_online=?1, last_online_at=CASE WHEN ?1=1 THEN ?2 ELSE last_online_at END WHERE id=?3",
            params![online as i32, now, volume_id],
        )?;
        Ok(())
    })
}

fn ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
