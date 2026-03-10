// ============================================================================
// WinCatalog — db/mod.rs
// Writer thread + read-only connection pool (WAL concurrent reads/writes)
// ============================================================================

pub mod pragmas;
pub mod queries;

use std::panic::Location;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use crossbeam_channel::{bounded, Receiver, Sender};
use rusqlite::{Connection, OpenFlags, Transaction};
use thiserror::Error;

const SCHEMA_VERSION: i64 = 1;

/// Default number of read-only connections in the pool.
/// Allows concurrent reads from multiple Tauri command handlers.
const DEFAULT_READER_POOL_SIZE: usize = 4;
const MAX_READER_POOL_SIZE: usize = 16;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Migration error: {0}")]
    Migration(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Writer thread disconnected")]
    WriterDisconnected,
    #[error("Execution error: {0}")]
    Execution(String),
}

pub type DbResult<T> = Result<T, DbError>;
type DbTask = Box<dyn FnOnce(&mut Connection) + Send>;

/// Channel-based read connection pool.
/// Connections are borrowed via recv() and returned via send().
#[derive(Clone)]
struct ReaderPool {
    tx: Sender<Connection>,
    rx: Receiver<Connection>,
}

impl ReaderPool {
    fn new(path: &Path, count: usize) -> DbResult<Self> {
        let (tx, rx) = bounded::<Connection>(count);
        for _ in 0..count {
            let conn = Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_ONLY
                    | OpenFlags::SQLITE_OPEN_NO_MUTEX
                    | OpenFlags::SQLITE_OPEN_URI,
            )?;
            pragmas::apply_read_only(&conn)?;
            tx.send(conn)
                .map_err(|_| DbError::Execution("Pool init failed".into()))?;
        }
        Ok(Self { tx, rx })
    }

    fn new_memory(uri: &str, count: usize) -> DbResult<Self> {
        let (tx, rx) = bounded::<Connection>(count);
        for _ in 0..count {
            let conn = Connection::open_with_flags(
                uri,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
            )?;
            pragmas::apply_read_only(&conn)?;
            tx.send(conn)
                .map_err(|_| DbError::Execution("Pool init failed".into()))?;
        }
        Ok(Self { tx, rx })
    }

    /// Borrow a connection, run `f`, then return it to the pool.
    fn use_conn<F, T>(&self, f: F) -> DbResult<T>
    where
        F: FnOnce(&Connection) -> DbResult<T>,
    {
        let conn = self
            .rx
            .recv()
            .map_err(|_| DbError::Execution("Reader pool empty".into()))?;
        let result = f(&conn);
        // Always return the connection, even on error
        let _ = self.tx.send(conn);
        result
    }
}

/// Thread-safe database handle.
///
/// - `read()` → borrows from a pool of read-only connections (non-blocking vs writes)
/// - `write()` / `write_transaction()` → writer thread (serialized)
/// - WAL mode: reads never block writes, writes never block reads
#[derive(Clone)]
pub struct Database {
    writer_tx: Sender<DbTask>,
    readers: Arc<ReaderPool>,
    path: PathBuf,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> DbResult<Self> {
        let path = path.as_ref().to_path_buf();

        // Writer thread — uses a channel to signal readiness back to the caller
        let writer_path = path.clone();
        let (writer_tx, writer_rx) = bounded::<DbTask>(256);
        let (ready_tx, ready_rx) = bounded::<Result<(), String>>(1);
        thread::Builder::new()
            .name("db-writer".into())
            .spawn(move || {
                let mut conn = match Connection::open(&writer_path) {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("DB open: {}", e)));
                        return;
                    }
                };
                if let Err(e) = pragmas::apply_all(&conn) {
                    let _ = ready_tx.send(Err(format!("Pragmas: {}", e)));
                    return;
                }
                if let Err(e) = run_migrations(&mut conn) {
                    let _ = ready_tx.send(Err(format!("Migration: {}", e)));
                    return;
                }
                log::info!("DB writer ready: {}", writer_path.display());
                let _ = ready_tx.send(Ok(()));
                while let Ok(task) = writer_rx.recv() {
                    task(&mut conn);
                }
                let _ = conn.execute_batch("PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);");
                log::info!("DB writer shutdown");
            })
            .map_err(|e| DbError::Execution(format!("Spawn writer: {}", e)))?;

        // Wait for the writer to finish creating/migrating the DB before opening readers
        match ready_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(DbError::Execution(e)),
            Err(_) => return Err(DbError::WriterDisconnected),
        }

        // Read-only connection pool (auto-sized, overridable by env).
        let reader_pool_size = configured_reader_pool_size();
        let readers = ReaderPool::new(&path, reader_pool_size)?;
        log::info!("DB reader pool ready: {} connections", reader_pool_size);

        let db = Self {
            writer_tx,
            readers: Arc::new(readers),
            path,
        };

        // Verify alive
        db.write(|conn| {
            let v: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
            log::info!("DB schema version: {}", v);
            Ok(())
        })?;

        Ok(db)
    }

    pub fn open_memory() -> DbResult<Self> {
        // For in-memory: shared cache URI so reader and writer see same data
        let uri = "file:wincatalog_mem?mode=memory&cache=shared";

        let (writer_tx, writer_rx) = bounded::<DbTask>(64);
        let uri_w = uri.to_string();
        thread::Builder::new()
            .name("db-writer-test".into())
            .spawn(move || {
                let mut conn = Connection::open(&uri_w).unwrap();
                pragmas::apply_all(&conn).unwrap();
                run_migrations(&mut conn).unwrap();
                while let Ok(task) = writer_rx.recv() {
                    task(&mut conn);
                }
            })
            .unwrap();

        // Small delay for writer to finish migrations before reader connects
        std::thread::sleep(std::time::Duration::from_millis(50));

        let readers = ReaderPool::new_memory(uri, configured_reader_pool_size())?;

        Ok(Self {
            writer_tx,
            readers: Arc::new(readers),
            path: PathBuf::from(":memory:"),
        })
    }

    /// Read-only query. Borrows a connection from the pool.
    /// Multiple reads can run concurrently (up to READER_POOL_SIZE).
    #[track_caller]
    pub fn read<F, T>(&self, f: F) -> DbResult<T>
    where
        F: FnOnce(&Connection) -> DbResult<T>,
    {
        let loc = Location::caller();
        self.readers.use_conn(f).map_err(|e| {
            log::error!(
                "DB read failed at {}:{}:{} -> {}",
                loc.file(),
                loc.line(),
                loc.column(),
                e
            );
            e
        })
    }

    /// Single write statement on writer thread.
    #[track_caller]
    pub fn write<F, T>(&self, f: F) -> DbResult<T>
    where
        F: FnOnce(&Connection) -> DbResult<T> + Send + 'static,
        T: Send + 'static,
    {
        let loc = Location::caller();
        let (tx, rx) = bounded::<DbResult<T>>(1);
        self.writer_tx
            .send(Box::new(move |conn| {
                let _ = tx.send(f(conn));
            }))
            .map_err(|_| DbError::WriterDisconnected)?;
        rx.recv()
            .map_err(|_| DbError::WriterDisconnected)?
            .map_err(|e| {
                log::error!(
                    "DB write failed at {}:{}:{} -> {}",
                    loc.file(),
                    loc.line(),
                    loc.column(),
                    e
                );
                e
            })
    }

    /// Transaction on writer thread. Commits on Ok, rolls back on Err.
    #[track_caller]
    pub fn write_transaction<F, T>(&self, f: F) -> DbResult<T>
    where
        F: FnOnce(&Transaction<'_>) -> DbResult<T> + Send + 'static,
        T: Send + 'static,
    {
        let loc = Location::caller();
        let (tx, rx) = bounded::<DbResult<T>>(1);
        self.writer_tx
            .send(Box::new(move |conn| {
                let result = (|| {
                    let t = conn.unchecked_transaction().map_err(DbError::Sqlite)?;
                    let v = f(&t)?;
                    t.commit().map_err(DbError::Sqlite)?;
                    Ok(v)
                })();
                let _ = tx.send(result);
            }))
            .map_err(|_| DbError::WriterDisconnected)?;
        rx.recv()
            .map_err(|_| DbError::WriterDisconnected)?
            .map_err(|e| {
                log::error!(
                    "DB write_transaction failed at {}:{}:{} -> {}",
                    loc.file(),
                    loc.line(),
                    loc.column(),
                    e
                );
                e
            })
    }

    /// Fire-and-forget write.
    pub fn write_async<F>(&self, f: F) -> DbResult<()>
    where
        F: FnOnce(&mut Connection) + Send + 'static,
    {
        self.writer_tx
            .send(Box::new(f))
            .map_err(|_| DbError::WriterDisconnected)
    }

    pub fn optimize(&self) -> DbResult<()> {
        self.write(|conn| {
            conn.execute_batch("PRAGMA optimize;")?;
            Ok(())
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn file_size(&self) -> DbResult<u64> {
        if self.path.to_str() == Some(":memory:") {
            return Ok(0);
        }
        Ok(std::fs::metadata(&self.path)?.len())
    }
}

fn run_migrations(conn: &mut Connection) -> DbResult<()> {
    let current: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(DbError::Sqlite)?;
    if current >= SCHEMA_VERSION {
        return Ok(());
    }
    log::info!("Migrating {} → {}", current, SCHEMA_VERSION);
    if current < 1 {
        conn.execute_batch(include_str!("migrations/001_init.sql"))
            .map_err(|e| DbError::Migration(format!("001_init: {}", e)))?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)
        .map_err(DbError::Sqlite)?;
    Ok(())
}

fn configured_reader_pool_size() -> usize {
    if let Ok(v) = std::env::var("WINCAT_DB_READERS") {
        if let Ok(n) = v.parse::<usize>() {
            return n.clamp(1, MAX_READER_POOL_SIZE);
        }
    }

    let cpus = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(DEFAULT_READER_POOL_SIZE);
    // Keep a moderate cap to avoid too many open handles while allowing concurrency.
    cpus.clamp(DEFAULT_READER_POOL_SIZE, MAX_READER_POOL_SIZE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_memory_read_write() {
        let db = Database::open_memory().unwrap();

        // Write
        db.write(|conn| {
            conn.execute(
                "INSERT INTO locations(name, created_at) VALUES ('Test', strftime('%s','now'))",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        // Read via reader pool
        let count: i64 = db
            .read(
                |conn| Ok(conn.query_row("SELECT COUNT(*) FROM locations", [], |row| row.get(0))?),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_transaction_rollback() {
        let db = Database::open_memory().unwrap();
        let _: DbResult<()> = db.write_transaction(|tx| {
            tx.execute(
                "INSERT INTO locations(name, created_at) VALUES ('X', 1)",
                [],
            )
            .map_err(DbError::Sqlite)?;
            Err(DbError::Migration("rollback".into()))
        });
        let count: i64 = db
            .read(
                |conn| Ok(conn.query_row("SELECT COUNT(*) FROM locations", [], |row| row.get(0))?),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_concurrent_reads() {
        let db = Database::open_memory().unwrap();
        db.write(|conn| {
            conn.execute(
                "INSERT INTO locations(name, created_at) VALUES ('A', 1)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        // Spawn multiple reader threads to verify pool works
        let readers = configured_reader_pool_size();
        let handles: Vec<_> = (0..readers * 2)
            .map(|_| {
                let db = db.clone();
                std::thread::spawn(move || {
                    db.read(|conn| {
                        let c: i64 = conn
                            .query_row("SELECT COUNT(*) FROM locations", [], |r| r.get(0))
                            .map_err(DbError::Sqlite)?;
                        assert_eq!(c, 1);
                        Ok(())
                    })
                    .unwrap();
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
    }
}
