// ============================================================================
// WinCatalog — core/jobs/mod.rs
// Background job runner: dequeues jobs, dispatches to handlers, retry logic
//
// Architecture:
//   - 1 worker thread polls the DB job queue every 500ms
//   - Dequeues by priority ASC, respects depends_on
//   - Dispatches to the right handler (hash, thumb, extract_meta…)
//   - Retry on error (attempts < max_attempts), exponential backoff
//   - Pause/resume/cancel via control channel
//   - Emits JobEvent to the frontend via callback
//
// The runner does NOT own the hasher/thumbs modules — it calls into them.
// Each handler is a blocking function that takes a Database + job info.
// ============================================================================

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crossbeam_channel::{bounded, select, Receiver, Sender};
use rusqlite::params;

use crate::core::hasher;
use crate::core::thumbs;
use crate::db::{Database, DbResult};

// ============================================================================
// Events (sent to frontend via Tauri)
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum JobEvent {
    /// A job started executing
    Started {
        job_id: i64,
        job_type: String,
        variant: Option<String>,
    },
    /// Progress update on current job
    Progress {
        job_id: i64,
        progress: f64,
        detail: String,
    },
    /// Job finished successfully
    Done {
        job_id: i64,
        job_type: String,
        duration_ms: u64,
    },
    /// Job failed (may retry)
    Failed {
        job_id: i64,
        job_type: String,
        error: String,
        will_retry: bool,
    },
    /// Queue is empty, runner is idle
    Idle,
    /// Runner paused/resumed
    Paused,
    Resumed,
}

pub type JobEventCallback = Arc<dyn Fn(JobEvent) + Send + Sync>;

// ============================================================================
// Control commands (sent to the runner thread)
// ============================================================================

#[derive(Debug)]
pub enum RunnerCommand {
    /// Pause processing (finish current job, then wait)
    Pause,
    /// Resume processing
    Resume,
    /// Cancel the currently running job
    CancelCurrent,
    /// Shutdown the runner thread
    Shutdown,
    /// Wake up immediately to check for new jobs (instead of waiting for poll)
    Wake,
}

// ============================================================================
// Job runner handle (returned to app state)
// ============================================================================

/// Handle to control the background job runner.
pub struct JobRunner {
    cmd_tx: Sender<RunnerCommand>,
    thread: Option<thread::JoinHandle<()>>,
}

impl JobRunner {
    /// Start the job runner background thread.
    pub fn start(db: Database, on_event: Option<JobEventCallback>) -> Self {
        let (cmd_tx, cmd_rx) = bounded::<RunnerCommand>(16);

        let thread = thread::Builder::new()
            .name("job-runner".into())
            .spawn(move || {
                runner_loop(db, cmd_rx, on_event);
            })
            .expect("Failed to spawn job runner thread");

        Self {
            cmd_tx,
            thread: Some(thread),
        }
    }

    pub fn pause(&self) {
        let _ = self.cmd_tx.send(RunnerCommand::Pause);
    }

    pub fn resume(&self) {
        let _ = self.cmd_tx.send(RunnerCommand::Resume);
    }

    pub fn cancel_current(&self) {
        let _ = self.cmd_tx.send(RunnerCommand::CancelCurrent);
    }

    /// Notify the runner that new jobs may be available (skip poll wait).
    pub fn wake(&self) {
        let _ = self.cmd_tx.send(RunnerCommand::Wake);
    }

    pub fn shutdown(mut self) {
        let _ = self.cmd_tx.send(RunnerCommand::Shutdown);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for JobRunner {
    fn drop(&mut self) {
        let _ = self.cmd_tx.send(RunnerCommand::Shutdown);
        // Don't join in drop — may deadlock if called from the same thread
    }
}

// ============================================================================
// Internal: runner loop
// ============================================================================

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const MAX_CONSECUTIVE_ERRORS: u32 = 5; // Back off if DB keeps failing

fn runner_loop(db: Database, cmd_rx: Receiver<RunnerCommand>, on_event: Option<JobEventCallback>) {
    let paused = AtomicBool::new(false);
    let cancel_current = Arc::new(AtomicBool::new(false));
    let mut consecutive_errors: u32 = 0;

    let emit = |evt: JobEvent| {
        if let Some(ref cb) = on_event {
            cb(evt);
        }
    };

    log::info!("Job runner started");

    loop {
        // Check for commands (non-blocking)
        match cmd_rx.try_recv() {
            Ok(RunnerCommand::Shutdown) => {
                log::info!("Job runner: shutdown requested");
                break;
            }
            Ok(RunnerCommand::Pause) => {
                paused.store(true, Ordering::Relaxed);
                emit(JobEvent::Paused);
                log::info!("Job runner: paused");
            }
            Ok(RunnerCommand::Resume) => {
                paused.store(false, Ordering::Relaxed);
                emit(JobEvent::Resumed);
                log::info!("Job runner: resumed");
            }
            Ok(RunnerCommand::CancelCurrent) => {
                cancel_current.store(true, Ordering::Relaxed);
                log::info!("Job runner: cancel current requested");
            }
            Ok(RunnerCommand::Wake) => {
                // Just skip the sleep below
            }
            Err(_) => {} // No command — continue
        }

        // If paused, wait for a command
        if paused.load(Ordering::Relaxed) {
            match cmd_rx.recv_timeout(Duration::from_secs(1)) {
                Ok(RunnerCommand::Resume) => {
                    paused.store(false, Ordering::Relaxed);
                    emit(JobEvent::Resumed);
                }
                Ok(RunnerCommand::Shutdown) => break,
                _ => continue,
            }
        }

        // Try to dequeue a job
        let job = match dequeue_next_job(&db) {
            Ok(Some(j)) => {
                consecutive_errors = 0;
                j
            }
            Ok(None) => {
                // Queue empty — sleep and retry
                emit(JobEvent::Idle);
                // Wait for either poll interval or a command
                select! {
                    recv(cmd_rx) -> msg => {
                        match msg {
                            Ok(RunnerCommand::Shutdown) => break,
                            Ok(RunnerCommand::Pause) => {
                                paused.store(true, Ordering::Relaxed);
                                emit(JobEvent::Paused);
                            }
                            Ok(RunnerCommand::Wake) => {} // immediately loop
                            _ => {}
                        }
                    }
                    default(POLL_INTERVAL) => {}
                }
                continue;
            }
            Err(e) => {
                consecutive_errors += 1;
                log::error!("Job runner: dequeue error #{}: {}", consecutive_errors, e);
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                    let backoff = Duration::from_secs(2u64.pow(consecutive_errors.min(5)));
                    log::warn!("Job runner: backing off for {:?}", backoff);
                    thread::sleep(backoff);
                }
                continue;
            }
        };

        // Mark as running
        let now = ts();
        let _ = update_job_status(&db, job.id, "running", 0.0, None, now);

        emit(JobEvent::Started {
            job_id: job.id,
            job_type: job.job_type.clone(),
            variant: job.variant.clone(),
        });

        log::info!(
            "Job runner: executing job #{} type={} variant={:?} volume={:?} entry={:?}",
            job.id,
            job.job_type,
            job.variant,
            job.volume_id,
            job.entry_id
        );

        // Reset cancel flag
        cancel_current.store(false, Ordering::Relaxed);

        // Execute
        let start = Instant::now();
        let result = execute_job(&db, &job, &cancel_current, &emit);
        let duration_ms = start.elapsed().as_millis() as u64;
        let now = ts();

        match result {
            Ok(()) => {
                let _ = update_job_status(&db, job.id, "done", 1.0, None, now);
                emit(JobEvent::Done {
                    job_id: job.id,
                    job_type: job.job_type.clone(),
                    duration_ms,
                });
                log::info!("Job #{} done in {}ms", job.id, duration_ms);
            }
            Err(JobExecError::Canceled) => {
                let _ =
                    update_job_status(&db, job.id, "canceled", 0.0, Some("Canceled by user"), now);
                log::info!("Job #{} canceled", job.id);
            }
            Err(JobExecError::Failed(err)) => {
                let will_retry = job.attempts < job.max_attempts;
                let new_status = if will_retry { "queued" } else { "error" };
                let _ = update_job_status(&db, job.id, new_status, 0.0, Some(&err), now);
                emit(JobEvent::Failed {
                    job_id: job.id,
                    job_type: job.job_type.clone(),
                    error: err.clone(),
                    will_retry,
                });
                log::warn!(
                    "Job #{} failed (attempt {}/{}): {} — {}",
                    job.id,
                    job.attempts,
                    job.max_attempts,
                    err,
                    if will_retry {
                        "will retry"
                    } else {
                        "giving up"
                    }
                );
            }
        }
    }

    log::info!("Job runner stopped");
}

// ============================================================================
// Internal: dequeue
// ============================================================================

#[derive(Debug)]
struct JobRecord {
    id: i64,
    job_type: String,
    variant: Option<String>,
    entry_id: Option<i64>,
    volume_id: Option<i64>,
    _priority: i64,
    attempts: i64,
    max_attempts: i64,
    _payload: Option<String>,
}

fn dequeue_next_job(db: &Database) -> DbResult<Option<JobRecord>> {
    db.write(|conn| {
        // Atomically: SELECT + UPDATE to 'running' in one shot to avoid races
        // (even though we're single-threaded, this is defensive)
        let maybe = conn
            .prepare_cached(
                "SELECT id, type, variant, entry_id, volume_id, priority, attempts, max_attempts, payload
                 FROM jobs
                 WHERE status = 'queued'
                   AND attempts < max_attempts
                   AND (depends_on IS NULL OR depends_on IN (SELECT id FROM jobs WHERE status = 'done'))
                 ORDER BY priority ASC, created_at ASC
                 LIMIT 1",
            )?
            .query_row([], |row| {
                Ok(JobRecord {
                    id: row.get(0)?,
                    job_type: row.get(1)?,
                    variant: row.get(2)?,
                    entry_id: row.get(3)?,
                    volume_id: row.get(4)?,
                    _priority: row.get(5)?,
                    attempts: row.get(6)?,
                    max_attempts: row.get(7)?,
                    _payload: row.get(8)?,
                })
            })
            .optional()?;

        if let Some(ref job) = maybe {
            // Bump attempts
            conn.execute(
                "UPDATE jobs SET attempts = attempts + 1, updated_at = ?1 WHERE id = ?2",
                params![ts(), job.id],
            )?;
        }

        Ok(maybe)
    })
}

fn update_job_status(
    db: &Database,
    job_id: i64,
    status: &str,
    progress: f64,
    error: Option<&str>,
    now: i64,
) -> DbResult<()> {
    let s = status.to_string();
    let e = error.map(|s| s.to_string());
    db.write(move |conn| {
        conn.execute(
            "UPDATE jobs SET
               status = ?1, progress = ?2, last_error = ?3, updated_at = ?4,
               started_at = CASE WHEN ?1 = 'running' AND started_at IS NULL THEN ?4 ELSE started_at END,
               completed_at = CASE WHEN ?1 IN ('done','error','canceled') THEN ?4 ELSE completed_at END
             WHERE id = ?5",
            params![s, progress, e, now, job_id],
        )?;
        Ok(())
    })
}

// ============================================================================
// Internal: dispatch
// ============================================================================

enum JobExecError {
    Canceled,
    Failed(String),
}

fn execute_job(
    db: &Database,
    job: &JobRecord,
    cancel: &Arc<AtomicBool>,
    emit: &(dyn Fn(JobEvent) + Sync),
) -> Result<(), JobExecError> {
    match job.job_type.as_str() {
        "hash" => execute_hash_job(db, job, cancel, emit),
        "thumb" => execute_thumb_job(db, job, cancel, emit),
        "extract_meta" => execute_extract_meta_job(db, job, cancel, emit),
        other => {
            log::warn!("Job runner: unknown job type '{}', skipping", other);
            Err(JobExecError::Failed(format!("Unknown job type: {}", other)))
        }
    }
}

// ============================================================================
// Handler: hash
// ============================================================================

fn execute_hash_job(
    db: &Database,
    job: &JobRecord,
    cancel: &Arc<AtomicBool>,
    _emit: &(dyn Fn(JobEvent) + Sync),
) -> Result<(), JobExecError> {
    let volume_id = job
        .volume_id
        .ok_or_else(|| JobExecError::Failed("Hash job missing volume_id".into()))?;

    let mode = job.variant.as_deref().unwrap_or("full");
    let _job_id = job.id;

    // Create a cancel receiver that bridges the AtomicBool.
    // Use a separate stop flag so we don't corrupt the shared cancel_current.
    let (cancel_tx, cancel_rx) = bounded(1);
    let cancel_flag = cancel.clone();
    let stop_watcher = Arc::new(AtomicBool::new(false));
    let stop_flag = stop_watcher.clone();
    let cancel_handle = thread::spawn(move || loop {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = cancel_tx.send(());
            return;
        }
        if stop_flag.load(Ordering::Relaxed) {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    });

    let result = hasher::run_hash(
        db, volume_id, mode, 0, // min_size
        cancel_rx, None,
    );

    // Signal the watcher thread to stop (without corrupting the shared cancel flag)
    stop_watcher.store(true, Ordering::Relaxed);
    let _ = cancel_handle.join();

    match result {
        Ok(_stats) => Ok(()),
        Err(hasher::HashError::Canceled) => Err(JobExecError::Canceled),
        Err(e) => Err(JobExecError::Failed(e.to_string())),
    }
}

// ============================================================================
// Handler: thumb
// ============================================================================

fn execute_thumb_job(
    db: &Database,
    job: &JobRecord,
    cancel: &Arc<AtomicBool>,
    emit: &(dyn Fn(JobEvent) + Sync),
) -> Result<(), JobExecError> {
    let volume_id = job
        .volume_id
        .ok_or_else(|| JobExecError::Failed("Thumb job missing volume_id".into()))?;

    let job_id = job.id;

    // Load entries needing thumbnails
    let entries: Vec<(i64, String, String, Option<String>, Option<String>)> = db
        .read(|conn| {
            let mut stmt = conn.prepare_cached(
                "SELECT e.id, e.path, e.kind, e.ext, e.quick_hash
                 FROM entries e
                 WHERE e.volume_id = ?1 AND e.status = 'present' AND e.is_dir = 0
                   AND e.kind IN ('image','video','audio','document','ebook')
                   AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.entry_id = e.id AND a.role = 'thumb')
                 ORDER BY e.size_bytes DESC
                 LIMIT 5000",
            )?;
            let rows = stmt
                .query_map(params![volume_id], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        })
        .map_err(|e| JobExecError::Failed(e.to_string()))?;

    let total = entries.len();
    if total == 0 {
        return Ok(());
    }

    // Resolve cache dir (use app_data_dir from settings or fallback)
    let cache_dir = db
        .read(|conn| {
            let mut stmt =
                conn.prepare_cached("SELECT value FROM settings WHERE key = 'cache.thumbs_dir'")?;
            stmt.query_row([], |r| r.get::<_, String>(0))
                .optional()
                .map_err(crate::db::DbError::Sqlite)
        })
        .ok()
        .flatten()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            // Fallback: use a temp-like path. In real usage this comes from app config.
            let base = dirs_next::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
            base.join("wincatalog").join("cache").join("thumbs")
        });

    let mut processed = 0u64;
    let mut errors = 0u64;

    for (entry_id, path, kind, ext, quick_hash) in &entries {
        if cancel.load(Ordering::Relaxed) {
            return Err(JobExecError::Canceled);
        }

        let source = std::path::Path::new(path);
        if !source.exists() {
            processed += 1;
            continue;
        }

        let result = thumbs::generate(
            source,
            kind,
            ext.as_deref(),
            &cache_dir,
            quick_hash.as_deref(),
            *entry_id,
            thumbs::ThumbSize::THUMB,
        );

        match result {
            Ok(Some(output)) => {
                // Insert asset record
                let now = ts();
                let out_path = output.path.to_string_lossy().to_string();
                let eid = *entry_id;
                let _ = db.write(move |conn| {
                    conn.execute(
                        "INSERT OR IGNORE INTO assets (entry_id, role, source, mime, width, height, bytes, path, created_at, is_primary)
                         VALUES (?1, 'thumb', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)",
                        params![
                            eid, output.source.as_str(), output.mime,
                            output.width, output.height, output.bytes,
                            out_path, now,
                        ],
                    )?;
                    Ok(())
                });
            }
            Ok(None) => {} // Unsupported type, skip
            Err(e) => {
                errors += 1;
                log::debug!("Thumb error for {}: {}", path, e);
            }
        }

        processed += 1;
        if processed % 50 == 0 {
            let pct = processed as f64 / total as f64;
            emit(JobEvent::Progress {
                job_id,
                progress: pct,
                detail: format!("{}/{} thumbnails", processed, total),
            });
            // Update job progress in DB
            let _ = update_job_status(db, job_id, "running", pct, None, ts());
        }
    }

    log::info!(
        "Thumb job done: {}/{} processed, {} errors",
        processed,
        total,
        errors
    );
    Ok(())
}

// ============================================================================
// Handler: extract_meta (calls real extractors)
// ============================================================================

fn execute_extract_meta_job(
    db: &Database,
    job: &JobRecord,
    cancel: &Arc<AtomicBool>,
    emit: &(dyn Fn(JobEvent) + Sync),
) -> Result<(), JobExecError> {
    let volume_id = job
        .volume_id
        .ok_or_else(|| JobExecError::Failed("Missing volume_id".into()))?;
    let kind = job.variant.as_deref().unwrap_or("unknown");

    use crate::core::extractors;
    let (extracted, errors) = extractors::run_extract_meta(db, volume_id, kind, cancel)
        .map_err(|e| JobExecError::Failed(e.to_string()))?;

    emit(JobEvent::Progress {
        job_id: job.id,
        progress: 1.0,
        detail: format!(
            "{} extracted, {} errors for kind={}",
            extracted, errors, kind
        ),
    });

    Ok(())
}

// ============================================================================
// Helpers
// ============================================================================

fn ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// rusqlite OptionalExtension
use rusqlite::OptionalExtension;
