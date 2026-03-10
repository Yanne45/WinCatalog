// ============================================================================
// WinCatalog — db/pragmas.rs
// SQLite pragma configuration
// ============================================================================

use super::DbResult;
use rusqlite::Connection;

/// Apply all performance pragmas to the WRITE connection.
pub fn apply_all(conn: &Connection) -> DbResult<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "cache_size", -64000)?; // 64 MB
    conn.pragma_update(None, "mmap_size", 268_435_456)?; // 256 MB
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    Ok(())
}

/// Apply pragmas for the READ-ONLY connection.
/// Smaller cache (reads are lighter), no FK enforcement needed.
pub fn apply_read_only(conn: &Connection) -> DbResult<()> {
    // WAL is set at DB level, not per-connection; but we set read-specific tunables
    conn.pragma_update(None, "cache_size", -16000)?; // 16 MB (reads need less)
    conn.pragma_update(None, "mmap_size", 268_435_456)?; // 256 MB (helps reads too)
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.pragma_update(None, "busy_timeout", 2000)?; // shorter for reads
                                                     // No foreign_keys needed for reads
    Ok(())
}

pub fn optimize(conn: &Connection) -> DbResult<()> {
    conn.execute_batch("PRAGMA optimize;")?;
    Ok(())
}

pub fn integrity_check(conn: &Connection) -> DbResult<()> {
    let result: String = conn.pragma_query_value(None, "integrity_check", |row| row.get(0))?;
    if result == "ok" {
        Ok(())
    } else {
        Err(super::DbError::Migration(format!(
            "Integrity check failed: {}",
            result
        )))
    }
}

#[derive(Debug, serde::Serialize)]
pub struct PragmaDiagnostics {
    pub journal_mode: String,
    pub synchronous: i32,
    pub cache_size_kb: i64,
    pub mmap_size_mb: i64,
    pub page_size: i64,
    pub db_size_mb: i64,
    pub foreign_keys: bool,
}

pub fn get_diagnostics(conn: &Connection) -> DbResult<PragmaDiagnostics> {
    let journal_mode: String = conn.pragma_query_value(None, "journal_mode", |r| r.get(0))?;
    let synchronous: i32 = conn.pragma_query_value(None, "synchronous", |r| r.get(0))?;
    let cache_size: i64 = conn.pragma_query_value(None, "cache_size", |r| r.get(0))?;
    let mmap_size: i64 = conn.pragma_query_value(None, "mmap_size", |r| r.get(0))?;
    let page_size: i64 = conn.pragma_query_value(None, "page_size", |r| r.get(0))?;
    let page_count: i64 = conn.pragma_query_value(None, "page_count", |r| r.get(0))?;
    let fk: bool =
        conn.pragma_query_value(None, "foreign_keys", |r| r.get::<_, i32>(0).map(|v| v != 0))?;

    Ok(PragmaDiagnostics {
        journal_mode,
        synchronous,
        cache_size_kb: if cache_size < 0 {
            -cache_size
        } else {
            cache_size * page_size / 1024
        },
        mmap_size_mb: mmap_size / (1024 * 1024),
        page_size,
        db_size_mb: (page_count * page_size) / (1024 * 1024),
        foreign_keys: fk,
    })
}
