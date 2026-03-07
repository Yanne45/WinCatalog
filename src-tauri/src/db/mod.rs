// ============================================================================
// WinCatalog — db/mod.rs
// Writer thread + read-only connection (WAL concurrent reads/writes)
// ============================================================================

pub mod pragmas;
pub mod queries;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use crossbeam_channel::{bounded, Sender};
use parking_lot::Mutex;
use rusqlite::{Connection, OpenFlags, Transaction};
use thiserror::Error;

const SCHEMA_VERSION: i64 = 1;

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

/// Thread-safe database handle.
///
/// - `read()` → read-only connection (Mutex, fast, non-blocking vs writes)
/// - `write()` / `write_transaction()` → writer thread (serialized)
/// - WAL mode: reads never block writes, writes never block reads
#[derive(Clone)]
pub struct Database {
    writer_tx: Sender<DbTask>,
    reader: Arc<Mutex<Connection>>,
    path: PathBuf,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> DbResult<Self> {
        let path = path.as_ref().to_path_buf();

        // Writer thread
        let writer_path = path.clone();
        let (writer_tx, writer_rx) = bounded::<DbTask>(256);
        thread::Builder::new()
            .name("db-writer".into())
            .spawn(move || {
                let mut conn = match Connection::open(&writer_path) {
                    Ok(c) => c,
                    Err(e) => { log::error!("DB writer open failed: {}", e); return; }
                };
                if let Err(e) = pragmas::apply_all(&conn) {
                    log::error!("Pragmas failed: {}", e); return;
                }
                if let Err(e) = run_migrations(&mut conn) {
                    log::error!("Migration failed: {}", e); return;
                }
                log::info!("DB writer ready: {}", writer_path.display());
                while let Ok(task) = writer_rx.recv() { task(&mut conn); }
                let _ = conn.execute_batch("PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);");
                log::info!("DB writer shutdown");
            })
            .map_err(|e| DbError::Execution(format!("Spawn writer: {}", e)))?;

        // Read-only connection
        let reader_conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_URI,
        )?;
        pragmas::apply_read_only(&reader_conn)?;

        let db = Self { writer_tx, reader: Arc::new(Mutex::new(reader_conn)), path };

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
                while let Ok(task) = writer_rx.recv() { task(&mut conn); }
            })
            .unwrap();

        // Small delay for writer to finish migrations before reader connects
        std::thread::sleep(std::time::Duration::from_millis(50));

        let reader_conn = Connection::open_with_flags(
            uri,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        )?;
        pragmas::apply_read_only(&reader_conn)?;

        Ok(Self {
            writer_tx,
            reader: Arc::new(Mutex::new(reader_conn)),
            path: PathBuf::from(":memory:"),
        })
    }

    /// Read-only query. Non-blocking vs writes.
    pub fn read<F, T>(&self, f: F) -> DbResult<T>
    where F: FnOnce(&Connection) -> DbResult<T>,
    {
        let conn = self.reader.lock();
        f(&conn)
    }

    /// Single write statement on writer thread.
    pub fn write<F, T>(&self, f: F) -> DbResult<T>
    where
        F: FnOnce(&Connection) -> DbResult<T> + Send + 'static,
        T: Send + 'static,
    {
        let (tx, rx) = bounded::<DbResult<T>>(1);
        self.writer_tx
            .send(Box::new(move |conn| { let _ = tx.send(f(conn)); }))
            .map_err(|_| DbError::WriterDisconnected)?;
        rx.recv().map_err(|_| DbError::WriterDisconnected)?
    }

    /// Transaction on writer thread. Commits on Ok, rolls back on Err.
    pub fn write_transaction<F, T>(&self, f: F) -> DbResult<T>
    where
        F: FnOnce(&Transaction<'_>) -> DbResult<T> + Send + 'static,
        T: Send + 'static,
    {
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
        rx.recv().map_err(|_| DbError::WriterDisconnected)?
    }

    /// Fire-and-forget write.
    pub fn write_async<F>(&self, f: F) -> DbResult<()>
    where F: FnOnce(&mut Connection) + Send + 'static,
    {
        self.writer_tx.send(Box::new(f)).map_err(|_| DbError::WriterDisconnected)
    }

    pub fn optimize(&self) -> DbResult<()> {
        self.write(|conn| { conn.execute_batch("PRAGMA optimize;")?; Ok(()) })
    }

    pub fn path(&self) -> &Path { &self.path }

    pub fn file_size(&self) -> DbResult<u64> {
        if self.path.to_str() == Some(":memory:") { return Ok(0); }
        Ok(std::fs::metadata(&self.path)?.len())
    }
}

fn run_migrations(conn: &mut Connection) -> DbResult<()> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(DbError::Sqlite)?;
    if current >= SCHEMA_VERSION { return Ok(()); }
    log::info!("Migrating {} → {}", current, SCHEMA_VERSION);
    if current < 1 {
        conn.execute_batch(include_str!("migrations/001_init.sql"))
            .map_err(|e| DbError::Migration(format!("001_init: {}", e)))?;
    }
    conn.pragma_update(None, "user_version", SCHEMA_VERSION).map_err(DbError::Sqlite)?;
    Ok(())
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
                "INSERT INTO locations(name, created_at) VALUES ('Test', strftime('%s','now'))", [],
            )?;
            Ok(())
        }).unwrap();

        // Read via reader connection
        let count: i64 = db.read(|conn| {
            conn.query_row("SELECT COUNT(*) FROM locations", [], |row| row.get(0))
        }).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_transaction_rollback() {
        let db = Database::open_memory().unwrap();
        let _ = db.write_transaction(|tx| {
            tx.execute("INSERT INTO locations(name, created_at) VALUES ('X', 1)", [])
                .map_err(DbError::Sqlite)?;
            Err(DbError::Migration("rollback".into()))
        });
        let count: i64 = db.read(|conn| {
            conn.query_row("SELECT COUNT(*) FROM locations", [], |row| row.get(0))
        }).unwrap();
        assert_eq!(count, 0);
    }
}
