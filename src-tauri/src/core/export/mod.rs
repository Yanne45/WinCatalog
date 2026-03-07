// ============================================================================
// WinCatalog — core/export/mod.rs
// Catalogue export: SQLite backup, JSON structured, CSV tabular
// ============================================================================

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde::Serialize;
use thiserror::Error;

use crate::db::{Database, DbError, DbResult};

#[derive(Error, Debug)]
pub enum ExportError {
    #[error("DB error: {0}")]
    Db(#[from] DbError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialize(String),
    #[error("Invalid scope: {0}")]
    InvalidScope(String),
}

pub type ExportResult<T> = Result<T, ExportError>;

// ============================================================================
// Scope: what to export
// ============================================================================

#[derive(Debug, Clone, serde::Deserialize)]
pub enum ExportScope {
    Full,
    Volume { id: i64 },
    Collection { id: i64 },
}

impl ExportScope {
    pub fn from_str(s: &str) -> ExportResult<Self> {
        if s == "full" { return Ok(Self::Full); }
        if let Some(id) = s.strip_prefix("volume:") {
            return Ok(Self::Volume { id: id.parse().map_err(|_| ExportError::InvalidScope(s.into()))? });
        }
        if let Some(id) = s.strip_prefix("collection:") {
            return Ok(Self::Collection { id: id.parse().map_err(|_| ExportError::InvalidScope(s.into()))? });
        }
        Err(ExportError::InvalidScope(s.into()))
    }

    pub fn as_str(&self) -> String {
        match self {
            Self::Full => "full".into(),
            Self::Volume { id } => format!("volume:{}", id),
            Self::Collection { id } => format!("collection:{}", id),
        }
    }
}

// ============================================================================
// Export result stats
// ============================================================================

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct ExportStats {
    pub format: String,
    pub scope: String,
    pub path: String,
    pub entries_exported: u64,
    pub file_size_bytes: u64,
    pub duration_ms: u64,
}

// ============================================================================
// SQLite export (backup)
// ============================================================================

pub fn export_sqlite(db: &Database, output_path: &Path, scope: &ExportScope) -> ExportResult<ExportStats> {
    let start = std::time::Instant::now();

    // For full export: use SQLite backup API
    // For scoped: copy DB then delete unrelated data
    match scope {
        ExportScope::Full => {
            // Direct file copy of the DB (after WAL checkpoint)
            db.write(|conn| {
                conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
                Ok(())
            })?;
            fs::copy(db.path(), output_path)?;
        }
        ExportScope::Volume { id } => {
            // Copy full DB, then delete entries from other volumes
            fs::copy(db.path(), output_path)?;
            let export_conn = rusqlite::Connection::open(output_path)
                .map_err(|e| ExportError::Db(DbError::Sqlite(e)))?;
            let vid = *id;
            export_conn.execute("DELETE FROM entries WHERE volume_id != ?1", params![vid])
                .map_err(|e| ExportError::Db(DbError::Sqlite(e)))?;
            export_conn.execute("DELETE FROM volumes WHERE id != ?1", params![vid])
                .map_err(|e| ExportError::Db(DbError::Sqlite(e)))?;
            export_conn.execute_batch("VACUUM")
                .map_err(|e| ExportError::Db(DbError::Sqlite(e)))?;
        }
        ExportScope::Collection { .. } => {
            // For collection scope: same approach, filter by collection_entries
            fs::copy(db.path(), output_path)?;
            // Simplified: keep all data but this is a starting point
        }
    }

    let meta = fs::metadata(output_path)?;
    let count = count_entries(db, scope)?;

    record_export(db, "sqlite", scope, output_path)?;

    Ok(ExportStats {
        format: "sqlite".into(),
        scope: scope.as_str(),
        path: output_path.display().to_string(),
        entries_exported: count,
        file_size_bytes: meta.len(),
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

// ============================================================================
// JSON export
// ============================================================================

#[derive(Serialize)]
struct JsonEntry {
    id: i64,
    volume: String,
    path: String,
    name: String,
    is_dir: bool,
    kind: String,
    ext: Option<String>,
    size_bytes: i64,
    mtime: Option<i64>,
    status: String,
    quick_hash: Option<String>,
    full_hash: Option<String>,
}

pub fn export_json(db: &Database, output_path: &Path, scope: &ExportScope) -> ExportResult<ExportStats> {
    let start = std::time::Instant::now();

    let (where_clause, param_val) = scope_to_where(scope);

    let entries: Vec<JsonEntry> = db.read(|conn| {
        let sql = format!(
            "SELECT e.id, v.label, e.path, e.name, e.is_dir, e.kind, e.ext, e.size_bytes, e.mtime, e.status, e.quick_hash, e.full_hash
             FROM entries e JOIN volumes v ON v.id = e.volume_id
             WHERE e.status = 'present' {}
             ORDER BY e.volume_id, e.path", where_clause
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows: Vec<JsonEntry> = if let Some(id) = param_val {
            stmt.query_map(params![id], map_json_entry)?
        } else {
            stmt.query_map([], map_json_entry)?
        }.filter_map(|r| r.ok()).collect();
        Ok(rows)
    })?;

    let file = File::create(output_path)?;
    let writer = BufWriter::new(file);
    serde_json::to_writer_pretty(writer, &entries)
        .map_err(|e| ExportError::Serialize(e.to_string()))?;

    let meta = fs::metadata(output_path)?;
    let count = entries.len() as u64;

    record_export(db, "json", scope, output_path)?;

    Ok(ExportStats {
        format: "json".into(),
        scope: scope.as_str(),
        path: output_path.display().to_string(),
        entries_exported: count,
        file_size_bytes: meta.len(),
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

fn map_json_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<JsonEntry> {
    Ok(JsonEntry {
        id: row.get(0)?, volume: row.get(1)?, path: row.get(2)?,
        name: row.get(3)?, is_dir: row.get::<_, i32>(4)? != 0,
        kind: row.get(5)?, ext: row.get(6)?, size_bytes: row.get(7)?,
        mtime: row.get(8)?, status: row.get(9)?,
        quick_hash: row.get(10)?, full_hash: row.get(11)?,
    })
}

// ============================================================================
// CSV export
// ============================================================================

pub fn export_csv(db: &Database, output_path: &Path, scope: &ExportScope) -> ExportResult<ExportStats> {
    let start = std::time::Instant::now();

    let (where_clause, param_val) = scope_to_where(scope);

    let file = File::create(output_path)?;
    let mut writer = BufWriter::new(file);

    // Header
    writeln!(writer, "id,volume,path,name,is_dir,kind,ext,size_bytes,mtime,status,quick_hash,full_hash")?;

    let count = db.read(|conn| {
        let sql = format!(
            "SELECT e.id, v.label, e.path, e.name, e.is_dir, e.kind, e.ext, e.size_bytes, e.mtime, e.status, e.quick_hash, e.full_hash
             FROM entries e JOIN volumes v ON v.id = e.volume_id
             WHERE e.status = 'present' {}
             ORDER BY e.volume_id, e.path", where_clause
        );
        let mut stmt = conn.prepare(&sql)?;

        type Row = (i64, String, String, String, i32, String, Option<String>, i64, Option<i64>, String, Option<String>, Option<String>);
        let rows: Vec<Row> = if let Some(id) = param_val {
            let r: Vec<Row> = stmt.query_map(params![id], |r| Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
                r.get(10)?, r.get(11)?,
            )))?.filter_map(|r| r.ok()).collect();
            r
        } else {
            let r: Vec<Row> = stmt.query_map([], |r| Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?,
                r.get(10)?, r.get(11)?,
            )))?.filter_map(|r| r.ok()).collect();
            r
        };

        let count = rows.len() as u64;
        for (id, vol, path, name, is_dir, kind, ext, size, mtime, status, qh, fh) in &rows {
            let ext_s: &str = ext.as_ref().map(|s| s.as_str()).unwrap_or("");
            let mtime_s: String = mtime.map(|t: i64| t.to_string()).unwrap_or_default();
            let qh_s: &str = qh.as_ref().map(|s| s.as_str()).unwrap_or("");
            let fh_s: &str = fh.as_ref().map(|s| s.as_str()).unwrap_or("");
            // Simple CSV escaping: quote fields containing commas or quotes
            let _ = writeln!(writer, "{},{},{},{},{},{},{},{},{},{},{},{}",
                id, csv_escape(vol), csv_escape(path), csv_escape(name),
                is_dir, kind, ext_s,
                size, mtime_s,
                status, qh_s, fh_s,
            );
        }
        Ok(count)
    })?;

    drop(writer);
    let meta = fs::metadata(output_path)?;

    record_export(db, "csv", scope, output_path)?;

    Ok(ExportStats {
        format: "csv".into(),
        scope: scope.as_str(),
        path: output_path.display().to_string(),
        entries_exported: count,
        file_size_bytes: meta.len(),
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn scope_to_where(scope: &ExportScope) -> (String, Option<i64>) {
    match scope {
        ExportScope::Full => (String::new(), None),
        ExportScope::Volume { id } => (" AND e.volume_id = ?1".into(), Some(*id)),
        ExportScope::Collection { id } => (
            format!(" AND e.id IN (SELECT entry_id FROM collection_entries WHERE collection_id = ?1)"),
            Some(*id),
        ),
    }
}

fn count_entries(db: &Database, scope: &ExportScope) -> ExportResult<u64> {
    let (where_clause, param_val) = scope_to_where(scope);
    Ok(db.read(|conn| {
        let sql = format!("SELECT COUNT(*) FROM entries e WHERE e.status='present' {}", where_clause);
        if let Some(id) = param_val {
            conn.query_row(&sql, params![id], |r| r.get::<_, i64>(0)).map_err(crate::db::DbError::Sqlite)
        } else {
            conn.query_row(&sql, [], |r| r.get::<_, i64>(0)).map_err(crate::db::DbError::Sqlite)
        }
    })? as u64)
}

fn record_export(db: &Database, format: &str, scope: &ExportScope, path: &Path) -> ExportResult<()> {
    let now = ts();
    let fmt = format.to_string();
    let sc = scope.as_str();
    let p = path.display().to_string();
    db.write(move |conn| {
        conn.execute(
            "INSERT INTO exports (format, scope, path, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![fmt, sc, p, now],
        )?;
        Ok(())
    })?;
    Ok(())
}

fn ts() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}
