// ============================================================================
// WinCatalog — core/scanner/parallel.rs
// Multi-volume parallel scan: run N scans concurrently with progress aggregation
// ============================================================================

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Instant;

use crossbeam_channel::{bounded, Receiver, Sender};

use super::{run_scan, ScanConfig, ScanEvent, ScanMode, ScanStats, EventCallback};
use crate::db::Database;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct ParallelScanStats {
    pub volume_stats: Vec<VolumeScanResult>,
    pub total_files: u64,
    pub total_dirs: u64,
    pub total_bytes: u64,
    pub total_duration_ms: u64,
    pub errors: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct VolumeScanResult {
    pub volume_id: i64,
    pub stats: Option<ScanStats>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum ParallelScanEvent {
    /// Overall progress
    Progress {
        volumes_done: usize,
        volumes_total: usize,
        current_volume_id: i64,
    },
    /// A single volume scan completed
    VolumeDone {
        volume_id: i64,
        stats: ScanStats,
    },
    /// A single volume scan failed
    VolumeError {
        volume_id: i64,
        error: String,
    },
    /// All scans completed
    AllDone {
        stats: ParallelScanStats,
    },
    /// Forwarded event from an individual scan
    ScanEvent {
        volume_id: i64,
        event: ScanEvent,
    },
}

pub type ParallelEventCallback = Arc<dyn Fn(ParallelScanEvent) + Send + Sync>;

// ============================================================================
// Parallel scan config
// ============================================================================

#[derive(Debug, Clone)]
pub struct ParallelScanConfig {
    /// Volume IDs to scan
    pub volume_ids: Vec<i64>,
    /// Scan mode (applies to all)
    pub mode: ScanMode,
    /// Max concurrent scans (0 = number of volumes, capped at 4)
    pub max_concurrent: usize,
    /// Shared scan options
    pub max_depth: Option<usize>,
    pub exclusions: Vec<String>,
    pub batch_size: usize,
}

impl Default for ParallelScanConfig {
    fn default() -> Self {
        Self {
            volume_ids: Vec::new(),
            mode: ScanMode::Full,
            max_concurrent: 0,
            max_depth: Some(50),
            exclusions: vec![
                "node_modules".into(), ".git".into(), ".DS_Store".into(),
                "Thumbs.db".into(), "$RECYCLE.BIN".into(),
            ],
            batch_size: 500,
        }
    }
}

// ============================================================================
// Run parallel scan
// ============================================================================

/// Run multiple volume scans concurrently.
/// Blocking — call from spawn_blocking.
pub fn run_parallel_scan(
    db: &Database,
    config: ParallelScanConfig,
    cancel: Arc<AtomicBool>,
    on_event: Option<ParallelEventCallback>,
) -> ParallelScanStats {
    let start = Instant::now();
    let emit = |e: ParallelScanEvent| { if let Some(ref cb) = on_event { cb(e); } };

    let max_threads = if config.max_concurrent == 0 {
        config.volume_ids.len().min(4)
    } else {
        config.max_concurrent.min(8)
    };

    let total_volumes = config.volume_ids.len();
    let (result_tx, result_rx) = bounded::<VolumeScanResult>(total_volumes);

    // Resolve volume paths
    let volume_configs: Vec<(i64, PathBuf)> = config.volume_ids.iter().filter_map(|&vid| {
        db.read(|conn| {
            conn.prepare_cached("SELECT root_path FROM volumes WHERE id=?1")?
                .query_row(rusqlite::params![vid], |r| r.get::<_, String>(0))
                .map_err(crate::db::DbError::Sqlite)
        }).ok().map(|path| (vid, PathBuf::from(path)))
    }).collect();

    // Chunk volumes into batches of max_threads
    let chunks: Vec<Vec<(i64, PathBuf)>> = volume_configs
        .chunks(max_threads)
        .map(|c| c.to_vec())
        .collect();

    let mut all_results: Vec<VolumeScanResult> = Vec::with_capacity(total_volumes);
    let mut done_count = 0usize;

    for chunk in chunks {
        if cancel.load(Ordering::Relaxed) { break; }

        let mut handles = Vec::new();

        for (volume_id, root_path) in chunk {
            let db_clone = db.clone();
            let cancel_clone = cancel.clone();
            let tx = result_tx.clone();
            let on_event_clone = on_event.clone();

            let scan_config = ScanConfig {
                volume_id,
                root_path,
                mode: config.mode,
                max_depth: config.max_depth,
                exclusions: config.exclusions.clone(),
                follow_symlinks: false,
                batch_size: config.batch_size,
            };

            let handle = thread::Builder::new()
                .name(format!("scan-{}", volume_id))
                .spawn(move || {
                    // Create a cancel channel that bridges the AtomicBool
                    let (cancel_tx_inner, cancel_rx_inner) = bounded(1);
                    let flag = cancel_clone.clone();
                    let _watcher = thread::spawn(move || {
                        loop {
                            if flag.load(Ordering::Relaxed) { let _ = cancel_tx_inner.send(()); break; }
                            thread::sleep(std::time::Duration::from_millis(100));
                        }
                    });

                    // Forward scan events
                    let vid = volume_id;
                    let event_cb: Option<EventCallback> = on_event_clone.map(|cb| -> EventCallback {
                        Box::new(move |evt: ScanEvent| {
                            cb(ParallelScanEvent::ScanEvent { volume_id: vid, event: evt });
                        })
                    });

                    let result = run_scan(&db_clone, scan_config, cancel_rx_inner, event_cb);

                    let vol_result = match result {
                        Ok(stats) => VolumeScanResult { volume_id, stats: Some(stats), error: None },
                        Err(e) => VolumeScanResult { volume_id, stats: None, error: Some(e.to_string()) },
                    };

                    let _ = tx.send(vol_result);
                });

            if let Ok(h) = handle {
                handles.push(h);
            }
        }

        // Wait for this batch to complete
        for _ in 0..handles.len() {
            if let Ok(result) = result_rx.recv() {
                done_count += 1;
                match &result {
                    VolumeScanResult { volume_id, stats: Some(s), .. } => {
                        emit(ParallelScanEvent::VolumeDone { volume_id: *volume_id, stats: s.clone() });
                    }
                    VolumeScanResult { volume_id, error: Some(e), .. } => {
                        emit(ParallelScanEvent::VolumeError { volume_id: *volume_id, error: e.clone() });
                    }
                    _ => {}
                }
                emit(ParallelScanEvent::Progress {
                    volumes_done: done_count,
                    volumes_total: total_volumes,
                    current_volume_id: result.volume_id,
                });
                all_results.push(result);
            }
        }

        // Join threads
        for h in handles { let _ = h.join(); }
    }

    let total_files = all_results.iter().filter_map(|r| r.stats.as_ref()).map(|s| s.files_total).sum();
    let total_dirs = all_results.iter().filter_map(|r| r.stats.as_ref()).map(|s| s.dirs_total).sum();
    let total_bytes = all_results.iter().filter_map(|r| r.stats.as_ref()).map(|s| s.bytes_total).sum();
    let errors = all_results.iter().filter(|r| r.error.is_some()).count() as u64;

    let stats = ParallelScanStats {
        volume_stats: all_results,
        total_files, total_dirs, total_bytes,
        total_duration_ms: start.elapsed().as_millis() as u64,
        errors,
    };

    emit(ParallelScanEvent::AllDone { stats: stats.clone() });

    log::info!(
        "Parallel scan done: {} volumes, {} files, {} dirs, {} bytes in {}ms",
        total_volumes, total_files, total_dirs, total_bytes, stats.total_duration_ms
    );

    stats
}
