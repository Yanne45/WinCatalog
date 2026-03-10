// ============================================================================
// WinCatalog — core/hasher/mod.rs
// Blake3 hashing: quick hash (64 KB prefix) + full hash
// ============================================================================

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use std::time::Instant;

use crossbeam_channel::Receiver;
use rusqlite::params;
use thiserror::Error;

use crate::db::{Database, DbError};

const QUICK_HASH_SIZE: usize = 65_536; // 64 KB
const HASH_BUF_SIZE: usize = 1 << 16; // 64 KB read buffer
const BATCH_WRITE_SIZE: usize = 50; // entries per DB write batch

#[derive(Error, Debug)]
pub enum HashError {
    #[error("Database error: {0}")]
    Db(#[from] DbError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Canceled")]
    Canceled,
}

pub type HashResult<T> = Result<T, HashError>;

// ============================================================================
// Core hashing functions
// ============================================================================

/// Blake3 hash of the first 64 KB of a file (fast pre-filter for duplicates).
pub fn quick_hash_file(path: &Path) -> HashResult<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut buf = vec![0u8; QUICK_HASH_SIZE];
    let n = reader.read(&mut buf)?;
    buf.truncate(n);
    Ok(blake3::hash(&buf).to_hex().to_string())
}

/// Blake3 hash of the entire file (definitive duplicate detection).
pub fn full_hash_file(path: &Path) -> HashResult<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::with_capacity(HASH_BUF_SIZE, file);
    let mut hasher = blake3::Hasher::new();
    let mut buf = [0u8; HASH_BUF_SIZE];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

// ============================================================================
// Events
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum HashEvent {
    Started {
        volume_id: i64,
        total_files: u64,
        mode: String,
    },
    Progress {
        volume_id: i64,
        files_hashed: u64,
        bytes_processed: u64,
        current_file: String,
    },
    FileError {
        volume_id: i64,
        path: String,
        error: String,
    },
    Completed {
        volume_id: i64,
        stats: HashStats,
    },
}

pub type EventCallback = Box<dyn Fn(HashEvent) + Send>;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct HashStats {
    pub files_hashed: u64,
    pub files_skipped: u64,
    pub files_errors: u64,
    pub bytes_processed: u64,
    pub duration_ms: u64,
}

// ============================================================================
// Batch run
// ============================================================================

/// Hash all files without hash for a volume. Blocking — call from spawn_blocking.
///
/// - `mode`: "quick" (64 KB prefix only) or "full" (quick + full hash)
/// - `min_size`: skip files smaller than this (0 = hash everything)
pub fn run_hash(
    db: &Database,
    volume_id: i64,
    mode: &str,
    min_size: i64,
    cancel: Receiver<()>,
    on_event: Option<EventCallback>,
) -> HashResult<HashStats> {
    let start = Instant::now();
    let do_full = mode == "full";
    let emit = |e: HashEvent| {
        if let Some(ref cb) = on_event {
            cb(e);
        }
    };

    // Load files needing hash, sorted by size DESC (big files first = more dedup gain)
    let files: Vec<(i64, String, i64)> = db.read(|conn| {
        let mut stmt = conn.prepare_cached(
            "SELECT id, path, size_bytes FROM entries
             WHERE volume_id=?1 AND status='present' AND is_dir=0 AND quick_hash IS NULL AND size_bytes >= ?2
             ORDER BY size_bytes DESC"
        )?;
        let rows = stmt
            .query_map(params![volume_id, min_size], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;

    let total = files.len() as u64;
    emit(HashEvent::Started {
        volume_id,
        total_files: total,
        mode: mode.into(),
    });

    if total == 0 {
        let stats = HashStats {
            duration_ms: start.elapsed().as_millis() as u64,
            ..Default::default()
        };
        emit(HashEvent::Completed {
            volume_id,
            stats: stats.clone(),
        });
        return Ok(stats);
    }

    let mut stats = HashStats::default();
    let mut batch: Vec<(i64, String, Option<String>)> = Vec::with_capacity(BATCH_WRITE_SIZE);

    for (entry_id, path, size) in &files {
        // Cancellation check
        if cancel.try_recv().is_ok() {
            return Err(HashError::Canceled);
        }

        let p = Path::new(path);
        if !p.exists() {
            stats.files_skipped += 1;
            continue;
        }

        match hash_one_file(p, do_full) {
            Ok((qh, fh)) => {
                stats.files_hashed += 1;
                stats.bytes_processed += *size as u64;
                batch.push((*entry_id, qh, fh));

                if stats.files_hashed % 100 == 0 || stats.files_hashed == total {
                    emit(HashEvent::Progress {
                        volume_id,
                        files_hashed: stats.files_hashed,
                        bytes_processed: stats.bytes_processed,
                        current_file: p
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default(),
                    });
                }
            }
            Err(e) => {
                stats.files_errors += 1;
                emit(HashEvent::FileError {
                    volume_id,
                    path: path.clone(),
                    error: e.to_string(),
                });
            }
        }

        // Flush batch to DB
        if batch.len() >= BATCH_WRITE_SIZE {
            flush_hash_batch(db, &mut batch)?;
        }
    }

    // Flush remaining
    if !batch.is_empty() {
        flush_hash_batch(db, &mut batch)?;
    }

    stats.duration_ms = start.elapsed().as_millis() as u64;
    emit(HashEvent::Completed {
        volume_id,
        stats: stats.clone(),
    });

    log::info!(
        "Hash done for volume {}: {} hashed, {} skipped, {} errors in {}ms",
        volume_id,
        stats.files_hashed,
        stats.files_skipped,
        stats.files_errors,
        stats.duration_ms
    );

    Ok(stats)
}

fn hash_one_file(path: &Path, do_full: bool) -> HashResult<(String, Option<String>)> {
    let qh = quick_hash_file(path)?;
    let fh = if do_full {
        Some(full_hash_file(path)?)
    } else {
        None
    };
    Ok((qh, fh))
}

fn flush_hash_batch(
    db: &Database,
    batch: &mut Vec<(i64, String, Option<String>)>,
) -> HashResult<()> {
    let owned: Vec<_> = batch.drain(..).collect();
    db.write_transaction(move |tx| {
        let mut stmt = tx
            .prepare_cached(
                "UPDATE entries SET quick_hash=?1, full_hash=?2, hash_algo='blake3' WHERE id=?3",
            )
            .map_err(DbError::Sqlite)?;
        for (id, qh, fh) in &owned {
            stmt.execute(params![qh, fh, id]).map_err(DbError::Sqlite)?;
        }
        Ok(())
    })?;
    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_quick_hash_small_file() {
        let dir = std::env::temp_dir().join("wc_hash_test");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("small.txt");
        std::fs::write(&path, b"hello world").unwrap();

        let h = quick_hash_file(&path).unwrap();
        assert_eq!(h.len(), 64); // blake3 hex = 64 chars
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_full_hash_deterministic() {
        let dir = std::env::temp_dir().join("wc_hash_test2");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("det.txt");
        std::fs::write(&path, b"deterministic content").unwrap();

        let h1 = full_hash_file(&path).unwrap();
        let h2 = full_hash_file(&path).unwrap();
        assert_eq!(h1, h2);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_identical_files_same_hash() {
        let dir = std::env::temp_dir().join("wc_hash_test3");
        let _ = std::fs::create_dir_all(&dir);
        let p1 = dir.join("a.bin");
        let p2 = dir.join("b.bin");
        let data: Vec<u8> = (0..100_000u32).flat_map(|i| i.to_le_bytes()).collect();
        std::fs::write(&p1, &data).unwrap();
        std::fs::write(&p2, &data).unwrap();

        assert_eq!(quick_hash_file(&p1).unwrap(), quick_hash_file(&p2).unwrap());
        assert_eq!(full_hash_file(&p1).unwrap(), full_hash_file(&p2).unwrap());

        let _ = std::fs::remove_file(&p1);
        let _ = std::fs::remove_file(&p2);
    }

    #[test]
    fn test_empty_file() {
        let dir = std::env::temp_dir().join("wc_hash_test4");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("empty.bin");
        std::fs::write(&path, b"").unwrap();

        let qh = quick_hash_file(&path).unwrap();
        let fh = full_hash_file(&path).unwrap();
        assert_eq!(qh, fh); // empty → same hash
        let _ = std::fs::remove_file(&path);
    }
}
