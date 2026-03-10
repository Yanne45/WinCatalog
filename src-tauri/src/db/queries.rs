// ============================================================================
// WinCatalog — db/queries.rs
// Optimized queries: column indices, prepare_cached, slim SELECTs
// ============================================================================

use super::DbResult;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

// ============================================================================
// Data structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Volume {
    pub id: i64,
    pub label: String,
    pub root_path: String,
    pub fs_uuid: Option<String>,
    pub fs_type: Option<String>,
    pub total_bytes: Option<i64>,
    pub free_bytes: Option<i64>,
    pub used_bytes: Option<i64>,
    pub is_online: bool,
    pub last_online_at: Option<i64>,
    pub auto_detect: bool,
    pub scan_mode: String,
    pub last_scan_at: Option<i64>,
    pub last_quick_scan_at: Option<i64>,
    pub location_id: Option<i64>,
    pub disk_number: Option<String>,
    pub created_at: i64,
}

/// Full entry (for detail views, Inspector).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: i64,
    pub volume_id: i64,
    pub path: String,
    pub parent_path: String,
    pub name: String,
    pub is_dir: bool,
    pub kind: String,
    pub ext: Option<String>,
    pub mime: Option<String>,
    pub size_bytes: i64,
    pub mtime: Option<i64>,
    pub ctime: Option<i64>,
    pub atime: Option<i64>,
    pub status: String,
    pub last_seen_at: i64,
    pub quick_hash: Option<String>,
    pub full_hash: Option<String>,
}

/// Slim entry for the explorer list view (fewer columns = less IPC overhead).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntrySlim {
    pub id: i64,
    pub name: String,
    pub is_dir: bool,
    pub kind: String,
    pub ext: Option<String>,
    pub size_bytes: i64,
    pub mtime: Option<i64>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: i64,
    pub r#type: String,
    pub variant: Option<String>,
    pub entry_id: Option<i64>,
    pub volume_id: Option<i64>,
    pub priority: i64,
    pub status: String,
    pub progress: f64,
    pub attempts: i64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size_bytes: i64,
    pub volume_id: i64,
    pub rank: f64,
}

/// Parameters for batch upsert during scan.
#[derive(Debug, Clone)]
pub struct EntryUpsert {
    pub volume_id: i64,
    pub path: String,
    pub parent_path: String,
    pub name: String,
    pub is_dir: bool,
    pub kind: String,
    pub ext: Option<String>,
    pub mime: Option<String>,
    pub size_bytes: i64,
    pub mtime: Option<i64>,
    pub ctime: Option<i64>,
    pub atime: Option<i64>,
    pub inode: Option<String>,
    pub device_id: Option<String>,
    pub last_seen_at: i64,
}

// ============================================================================
// Row mappers (column INDEX for speed — no string lookup)
// ============================================================================

// Volume: SELECT id,label,root_path,fs_uuid,fs_type,total_bytes,free_bytes,used_bytes,
//   is_online,last_online_at,auto_detect,scan_mode,last_scan_at,last_quick_scan_at,
//   location_id,disk_number,created_at
const VOLUME_SELECT: &str =
    "SELECT id,label,root_path,fs_uuid,fs_type,total_bytes,free_bytes,used_bytes,\
     is_online,last_online_at,auto_detect,scan_mode,last_scan_at,last_quick_scan_at,\
     location_id,disk_number,created_at FROM volumes";

fn map_volume(row: &Row<'_>) -> rusqlite::Result<Volume> {
    Ok(Volume {
        id: row.get(0)?,
        label: row.get(1)?,
        root_path: row.get(2)?,
        fs_uuid: row.get(3)?,
        fs_type: row.get(4)?,
        total_bytes: row.get(5)?,
        free_bytes: row.get(6)?,
        used_bytes: row.get(7)?,
        is_online: row.get::<_, i32>(8)? != 0,
        last_online_at: row.get(9)?,
        auto_detect: row.get::<_, i32>(10)? != 0,
        scan_mode: row.get(11)?,
        last_scan_at: row.get(12)?,
        last_quick_scan_at: row.get(13)?,
        location_id: row.get(14)?,
        disk_number: row.get(15)?,
        created_at: row.get(16)?,
    })
}

// EntrySlim: id,name,is_dir,kind,ext,size_bytes,mtime,status
fn map_entry_slim(row: &Row<'_>) -> rusqlite::Result<EntrySlim> {
    Ok(EntrySlim {
        id: row.get(0)?,
        name: row.get(1)?,
        is_dir: row.get::<_, i32>(2)? != 0,
        kind: row.get(3)?,
        ext: row.get(4)?,
        size_bytes: row.get(5)?,
        mtime: row.get(6)?,
        status: row.get(7)?,
    })
}

// Full Entry: id,volume_id,path,parent_path,name,is_dir,kind,ext,mime,size_bytes,
//   mtime,ctime,atime,status,last_seen_at,quick_hash,full_hash
const ENTRY_SELECT: &str =
    "SELECT id,volume_id,path,parent_path,name,is_dir,kind,ext,mime,size_bytes,\
     mtime,ctime,atime,status,last_seen_at,quick_hash,full_hash FROM entries";

fn map_entry(row: &Row<'_>) -> rusqlite::Result<Entry> {
    Ok(Entry {
        id: row.get(0)?,
        volume_id: row.get(1)?,
        path: row.get(2)?,
        parent_path: row.get(3)?,
        name: row.get(4)?,
        is_dir: row.get::<_, i32>(5)? != 0,
        kind: row.get(6)?,
        ext: row.get(7)?,
        mime: row.get(8)?,
        size_bytes: row.get(9)?,
        mtime: row.get(10)?,
        ctime: row.get(11)?,
        atime: row.get(12)?,
        status: row.get(13)?,
        last_seen_at: row.get(14)?,
        quick_hash: row.get(15)?,
        full_hash: row.get(16)?,
    })
}

fn map_job(row: &Row<'_>) -> rusqlite::Result<Job> {
    Ok(Job {
        id: row.get(0)?,
        r#type: row.get(1)?,
        variant: row.get(2)?,
        entry_id: row.get(3)?,
        volume_id: row.get(4)?,
        priority: row.get(5)?,
        status: row.get(6)?,
        progress: row.get(7)?,
        attempts: row.get(8)?,
        last_error: row.get(9)?,
    })
}

// ============================================================================
// Volume queries
// ============================================================================

pub fn list_volumes(conn: &Connection) -> DbResult<Vec<Volume>> {
    let mut stmt = conn.prepare_cached(&format!("{} ORDER BY label", VOLUME_SELECT))?;
    let rows = stmt.query_map([], map_volume)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_volume(conn: &Connection, id: i64) -> DbResult<Option<Volume>> {
    Ok(conn
        .prepare_cached(&format!("{} WHERE id = ?1", VOLUME_SELECT))?
        .query_row(params![id], map_volume)
        .optional()?)
}

pub fn insert_volume(
    conn: &Connection,
    label: &str,
    root_path: &str,
    fs_uuid: Option<&str>,
    fs_type: Option<&str>,
    now: i64,
) -> DbResult<i64> {
    conn.execute("INSERT INTO volumes (label, root_path, fs_uuid, fs_type, created_at) VALUES (?1,?2,?3,?4,?5)",
        params![label, root_path, fs_uuid, fs_type, now])?;
    Ok(conn.last_insert_rowid())
}

pub fn set_volume_online(conn: &Connection, id: i64, online: bool, now: i64) -> DbResult<()> {
    conn.execute("UPDATE volumes SET is_online=?1, last_online_at=CASE WHEN ?1=1 THEN ?2 ELSE last_online_at END WHERE id=?3",
        params![online as i32, now, id])?;
    Ok(())
}

pub fn find_volume_by_uuid(conn: &Connection, fs_uuid: &str) -> DbResult<Option<Volume>> {
    Ok(conn
        .prepare_cached(&format!("{} WHERE fs_uuid = ?1", VOLUME_SELECT))?
        .query_row(params![fs_uuid], map_volume)
        .optional()?)
}

// ============================================================================
// Entry queries
// ============================================================================

/// List entries for the explorer (SLIM: only columns the UI needs).
/// Dirs first, then files, ordered by mtime DESC. Keyset pagination.
pub fn list_entries_slim(
    conn: &Connection,
    volume_id: i64,
    parent_path: &str,
    cursor: Option<(bool, i64, i64)>,
    limit: i64,
) -> DbResult<Vec<EntrySlim>> {
    if let Some((cursor_is_dir, cursor_mtime, cursor_id)) = cursor {
        let mut stmt = conn.prepare_cached(
            "SELECT id,name,is_dir,kind,ext,size_bytes,mtime,status FROM entries
             WHERE volume_id=?1 AND parent_path=?2 AND status='present'
               AND (
                 is_dir < ?3
                 OR (is_dir = ?3 AND COALESCE(mtime,0) < ?4)
                 OR (is_dir = ?3 AND COALESCE(mtime,0) = ?4 AND id < ?5)
               )
             ORDER BY is_dir DESC, COALESCE(mtime,0) DESC, id DESC LIMIT ?6",
        )?;
        let rows = stmt
            .query_map(
                params![
                    volume_id,
                    parent_path,
                    cursor_is_dir as i32,
                    cursor_mtime,
                    cursor_id,
                    limit
                ],
                map_entry_slim,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    } else {
        let mut stmt = conn.prepare_cached(
            "SELECT id,name,is_dir,kind,ext,size_bytes,mtime,status FROM entries
             WHERE volume_id=?1 AND parent_path=?2 AND status='present'
             ORDER BY is_dir DESC, COALESCE(mtime,0) DESC, id DESC LIMIT ?3",
        )?;
        let rows = stmt
            .query_map(params![volume_id, parent_path, limit], map_entry_slim)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

/// Full entry for Inspector/detail view.
pub fn get_entry(conn: &Connection, id: i64) -> DbResult<Option<Entry>> {
    Ok(conn
        .prepare_cached(&format!("{} WHERE id = ?1", ENTRY_SELECT))?
        .query_row(params![id], map_entry)
        .optional()?)
}

pub fn update_entry_hash(
    conn: &Connection,
    entry_id: i64,
    quick_hash: Option<&str>,
    full_hash: Option<&str>,
    algo: &str,
) -> DbResult<()> {
    conn.execute(
        "UPDATE entries SET quick_hash=?1, full_hash=?2, hash_algo=?3 WHERE id=?4",
        params![quick_hash, full_hash, algo, entry_id],
    )?;
    Ok(())
}

// ============================================================================
// Search (FTS5)
// ============================================================================

pub fn search_entries(conn: &Connection, query: &str, limit: i64) -> DbResult<Vec<SearchResult>> {
    let mut stmt = conn.prepare_cached(
        "SELECT e.id,e.name,e.path,e.kind,e.size_bytes,e.volume_id,rank
         FROM entries_fts fts JOIN entries e ON e.id=fts.rowid
         WHERE entries_fts MATCH ?1 AND e.status='present'
         ORDER BY rank LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![query, limit], |row| {
            Ok(SearchResult {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                kind: row.get(3)?,
                size_bytes: row.get(4)?,
                volume_id: row.get(5)?,
                rank: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn search_text_content(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> DbResult<Vec<SearchResult>> {
    let mut stmt = conn.prepare_cached(
        "SELECT e.id,e.name,e.path,e.kind,e.size_bytes,e.volume_id,fts.rank
         FROM entry_text_fts fts JOIN entries e ON e.id=fts.rowid
         WHERE entry_text_fts MATCH ?1 AND e.status='present'
         ORDER BY fts.rank LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![query, limit], |row| {
            Ok(SearchResult {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                kind: row.get(3)?,
                size_bytes: row.get(4)?,
                volume_id: row.get(5)?,
                rank: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ============================================================================
// Job queries
// ============================================================================

pub fn dequeue_job(conn: &Connection) -> DbResult<Option<Job>> {
    Ok(conn
        .prepare_cached(
            "SELECT id,type,variant,entry_id,volume_id,priority,status,progress,attempts,last_error
         FROM jobs WHERE status='queued'
           AND (depends_on IS NULL OR depends_on IN (SELECT id FROM jobs WHERE status='done'))
         ORDER BY priority ASC, created_at ASC LIMIT 1",
        )?
        .query_row([], map_job)
        .optional()?)
}

pub fn update_job_status(
    conn: &Connection,
    job_id: i64,
    status: &str,
    progress: f64,
    error: Option<&str>,
    now: i64,
) -> DbResult<()> {
    conn.execute(
        "UPDATE jobs SET status=?1, progress=?2, last_error=?3, updated_at=?4,
           started_at=CASE WHEN ?1='running' AND started_at IS NULL THEN ?4 ELSE started_at END,
           completed_at=CASE WHEN ?1 IN ('done','error','canceled') THEN ?4 ELSE completed_at END,
           attempts=CASE WHEN ?1='running' THEN attempts+1 ELSE attempts END
         WHERE id=?5",
        params![status, progress, error, now, job_id],
    )?;
    Ok(())
}

pub fn list_active_jobs(conn: &Connection) -> DbResult<Vec<Job>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id,type,variant,entry_id,volume_id,priority,status,progress,attempts,last_error
         FROM jobs WHERE status IN ('queued','running','paused')
         ORDER BY status DESC, priority ASC LIMIT 50",
    )?;
    let rows = stmt
        .query_map([], map_job)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ============================================================================
// Duplicates
// ============================================================================

pub fn find_duplicates(
    conn: &Connection,
    min_size: Option<i64>,
) -> DbResult<Vec<(String, i64, i64)>> {
    let mut stmt = conn.prepare_cached(
        "SELECT full_hash, COUNT(*) as cnt, SUM(size_bytes)
         FROM entries WHERE full_hash IS NOT NULL AND status='present' AND size_bytes >= ?1
         GROUP BY full_hash HAVING cnt > 1 ORDER BY SUM(size_bytes) DESC",
    )?;
    let rows = stmt
        .query_map(params![min_size.unwrap_or(0)], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_duplicate_group(conn: &Connection, hash: &str) -> DbResult<Vec<Entry>> {
    let mut stmt = conn.prepare_cached(&format!(
        "{} WHERE full_hash=?1 AND status='present' ORDER BY mtime DESC",
        ENTRY_SELECT
    ))?;
    let rows = stmt
        .query_map(params![hash], map_entry)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ============================================================================
// Settings
// ============================================================================

pub fn get_setting(conn: &Connection, key: &str) -> DbResult<Option<String>> {
    Ok(conn
        .prepare_cached("SELECT value FROM settings WHERE key=?1")?
        .query_row(params![key], |r| r.get(0))
        .optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str, now: i64) -> DbResult<()> {
    conn.execute(
        "INSERT INTO settings (key,value,updated_at) VALUES (?1,?2,?3)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        params![key, value, now],
    )?;
    Ok(())
}

// ============================================================================
// Tags
// ============================================================================

pub fn create_tag(conn: &Connection, name: &str, color: Option<&str>, now: i64) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO tags (name,color,created_at) VALUES (?1,?2,?3)",
        params![name, color, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn tag_entry(conn: &Connection, entry_id: i64, tag_id: i64) -> DbResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO entry_tags (entry_id,tag_id) VALUES (?1,?2)",
        params![entry_id, tag_id],
    )?;
    Ok(())
}

pub fn get_entry_tags(
    conn: &Connection,
    entry_id: i64,
) -> DbResult<Vec<(i64, String, Option<String>)>> {
    let mut stmt = conn.prepare_cached(
        "SELECT t.id,t.name,t.color FROM tags t JOIN entry_tags et ON et.tag_id=t.id WHERE et.entry_id=?1 ORDER BY t.name")?;
    let rows = stmt
        .query_map(params![entry_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_entry_tags_bulk(
    conn: &Connection,
    entry_ids: &[i64],
) -> DbResult<Vec<(i64, i64, String, Option<String>)>> {
    if entry_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = std::iter::repeat("?")
        .take(entry_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT et.entry_id,t.id,t.name,t.color
         FROM entry_tags et
         JOIN tags t ON t.id=et.tag_id
         WHERE et.entry_id IN ({})
         ORDER BY et.entry_id, t.name",
        placeholders
    );
    let mut stmt = conn.prepare_cached(&sql)?;
    let rows = stmt
        .query_map(params_from_iter(entry_ids.iter()), |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ============================================================================
// Trash
// ============================================================================

pub fn trash_entry(
    conn: &Connection,
    entry_id: i64,
    volume_id: i64,
    original_path: &str,
    original_hash: Option<&str>,
    reason: &str,
    size_bytes: i64,
    meta_snapshot: Option<&str>,
    now: i64,
    retention_days: i64,
) -> DbResult<i64> {
    let expires_at = now + (retention_days * 86400);
    conn.execute(
        "INSERT INTO trash (entry_id,volume_id,original_path,original_hash,reason,size_bytes,meta_snapshot,deleted_at,expires_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![entry_id, volume_id, original_path, original_hash, reason, size_bytes, meta_snapshot, now, expires_at])?;
    conn.execute(
        "UPDATE entries SET status='deleted' WHERE id=?1",
        params![entry_id],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn purge_expired_trash(conn: &Connection, now: i64) -> DbResult<i64> {
    let deleted = conn.execute(
        "DELETE FROM entries WHERE id IN (SELECT entry_id FROM trash WHERE expires_at<=?1 AND restored_at IS NULL)", params![now])?;
    conn.execute(
        "DELETE FROM trash WHERE expires_at<=?1 AND restored_at IS NULL",
        params![now],
    )?;
    Ok(deleted as i64)
}

// ============================================================================
// Trash — extended (task 9)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashItem {
    pub id: i64,
    pub entry_id: i64,
    pub volume_id: i64,
    pub original_path: String,
    pub reason: String,
    pub size_bytes: i64,
    pub deleted_at: i64,
    pub expires_at: i64,
}

pub fn list_trash(
    conn: &Connection,
    volume_id: Option<i64>,
    limit: i64,
) -> DbResult<Vec<TrashItem>> {
    if let Some(vid) = volume_id {
        let mut stmt = conn.prepare_cached(
            "SELECT id,entry_id,volume_id,original_path,reason,size_bytes,deleted_at,expires_at
             FROM trash WHERE volume_id=?1 AND restored_at IS NULL
             ORDER BY deleted_at DESC LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![vid, limit], map_trash_item)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    } else {
        let mut stmt = conn.prepare_cached(
            "SELECT id,entry_id,volume_id,original_path,reason,size_bytes,deleted_at,expires_at
             FROM trash WHERE restored_at IS NULL
             ORDER BY deleted_at DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], map_trash_item)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

fn map_trash_item(row: &Row<'_>) -> rusqlite::Result<TrashItem> {
    Ok(TrashItem {
        id: row.get(0)?,
        entry_id: row.get(1)?,
        volume_id: row.get(2)?,
        original_path: row.get(3)?,
        reason: row.get(4)?,
        size_bytes: row.get(5)?,
        deleted_at: row.get(6)?,
        expires_at: row.get(7)?,
    })
}

pub fn restore_trash_entry(conn: &Connection, trash_id: i64, now: i64) -> DbResult<()> {
    // Get entry_id from trash record
    let entry_id: i64 = conn
        .prepare_cached("SELECT entry_id FROM trash WHERE id=?1")?
        .query_row(params![trash_id], |r| r.get(0))?;
    // Restore entry status
    conn.execute(
        "UPDATE entries SET status='present' WHERE id=?1",
        params![entry_id],
    )?;
    // Mark trash record as restored
    conn.execute(
        "UPDATE trash SET restored_at=?1 WHERE id=?2",
        params![now, trash_id],
    )?;
    Ok(())
}

pub fn trash_summary(conn: &Connection) -> DbResult<(i64, i64)> {
    Ok(conn
        .prepare_cached(
            "SELECT COUNT(*), COALESCE(SUM(size_bytes),0) FROM trash WHERE restored_at IS NULL",
        )?
        .query_row([], |r| Ok((r.get(0)?, r.get(1)?)))?)
}

// ============================================================================
// Volumes — extended (task 8)
// ============================================================================

pub fn update_volume(
    conn: &Connection,
    id: i64,
    label: &str,
    disk_number: Option<&str>,
    location_id: Option<i64>,
    scan_mode: &str,
) -> DbResult<()> {
    conn.execute(
        "UPDATE volumes SET label=?1, disk_number=?2, location_id=?3, scan_mode=?4 WHERE id=?5",
        params![label, disk_number, location_id, scan_mode, id],
    )?;
    Ok(())
}

pub fn update_volume_space(
    conn: &Connection,
    id: i64,
    total: i64,
    free: i64,
    used: i64,
) -> DbResult<()> {
    conn.execute(
        "UPDATE volumes SET total_bytes=?1, free_bytes=?2, used_bytes=?3 WHERE id=?4",
        params![total, free, used, id],
    )?;
    Ok(())
}

pub fn delete_volume(conn: &Connection, id: i64) -> DbResult<()> {
    // CASCADE will delete entries, assets, jobs, scan_log, etc.
    conn.execute("DELETE FROM volumes WHERE id=?1", params![id])?;
    Ok(())
}

// ============================================================================
// Dashboard queries (task 10)
// ============================================================================

/// Volume kind stats (for the distribution donut chart).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KindStat {
    pub kind: String,
    pub count: i64,
    pub bytes: i64,
}

pub fn get_volume_kind_stats(conn: &Connection, volume_id: i64) -> DbResult<Vec<KindStat>> {
    let mut stmt = conn.prepare_cached(
        "SELECT kind, count_sum, bytes_sum FROM volume_kind_stats
         WHERE volume_id=?1 AND scanned_at=(SELECT MAX(scanned_at) FROM volume_kind_stats WHERE volume_id=?1)
         ORDER BY bytes_sum DESC")?;
    let rows = stmt
        .query_map(params![volume_id], |r| {
            Ok(KindStat {
                kind: r.get(0)?,
                count: r.get(1)?,
                bytes: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Aggregated kind stats across all volumes.
pub fn get_global_kind_stats(conn: &Connection) -> DbResult<Vec<KindStat>> {
    // Fast path: aggregate from per-volume snapshots generated after each scan.
    // This avoids a full-table scan on `entries` for large catalogs.
    let mut stmt = conn.prepare_cached(
        "WITH latest AS (
           SELECT volume_id, MAX(scanned_at) AS scanned_at
           FROM volume_kind_stats
           GROUP BY volume_id
         )
         SELECT v.kind,
                COALESCE(SUM(v.count_sum), 0) AS cnt,
                COALESCE(SUM(v.bytes_sum), 0) AS sz
         FROM volume_kind_stats v
         INNER JOIN latest l
           ON l.volume_id = v.volume_id
          AND l.scanned_at = v.scanned_at
         WHERE v.kind <> 'dir'
         GROUP BY v.kind
         ORDER BY sz DESC",
    )?;
    let mut rows = stmt
        .query_map([], |r| {
            Ok(KindStat {
                kind: r.get(0)?,
                count: r.get(1)?,
                bytes: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    if rows.is_empty() {
        // Fallback for databases not yet populated with volume_kind_stats.
        let mut fallback = conn.prepare_cached(
            "SELECT kind, COUNT(*) as cnt, COALESCE(SUM(size_bytes),0) as sz
             FROM entries WHERE status='present' AND is_dir=0
             GROUP BY kind ORDER BY sz DESC",
        )?;
        rows = fallback
            .query_map([], |r| {
                Ok(KindStat {
                    kind: r.get(0)?,
                    count: r.get(1)?,
                    bytes: r.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
    }

    Ok(rows)
}

/// Recent scan log entries (for "recently added/modified" widgets).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanLogEntry {
    pub id: i64,
    pub volume_id: i64,
    pub entry_id: Option<i64>,
    pub event: String,
    pub new_path: Option<String>,
    pub old_path: Option<String>,
    pub new_size: Option<i64>,
    pub detected_at: i64,
}

pub fn get_recent_scan_log(
    conn: &Connection,
    volume_id: Option<i64>,
    event_filter: Option<&str>,
    limit: i64,
) -> DbResult<Vec<ScanLogEntry>> {
    let sql = match (volume_id, event_filter) {
        (Some(_), Some(_)) =>
            "SELECT id,volume_id,entry_id,event,new_path,old_path,new_size,detected_at FROM scan_log WHERE volume_id=?1 AND event=?2 ORDER BY detected_at DESC LIMIT ?3",
        (Some(_), None) =>
            "SELECT id,volume_id,entry_id,event,new_path,old_path,new_size,detected_at FROM scan_log WHERE volume_id=?1 ORDER BY detected_at DESC LIMIT ?2",
        (None, Some(_)) =>
            "SELECT id,volume_id,entry_id,event,new_path,old_path,new_size,detected_at FROM scan_log WHERE event=?1 ORDER BY detected_at DESC LIMIT ?2",
        (None, None) =>
            "SELECT id,volume_id,entry_id,event,new_path,old_path,new_size,detected_at FROM scan_log ORDER BY detected_at DESC LIMIT ?1",
    };
    let mut stmt = conn.prepare_cached(sql)?;
    let rows: Vec<ScanLogEntry> = match (volume_id, event_filter) {
        (Some(vid), Some(ev)) => stmt
            .query_map(params![vid, ev, limit], map_scan_log)?
            .collect::<rusqlite::Result<Vec<_>>>()?,
        (Some(vid), None) => stmt
            .query_map(params![vid, limit], map_scan_log)?
            .collect::<rusqlite::Result<Vec<_>>>()?,
        (None, Some(ev)) => stmt
            .query_map(params![ev, limit], map_scan_log)?
            .collect::<rusqlite::Result<Vec<_>>>()?,
        (None, None) => stmt
            .query_map(params![limit], map_scan_log)?
            .collect::<rusqlite::Result<Vec<_>>>()?,
    };
    Ok(rows)
}

fn map_scan_log(row: &Row<'_>) -> rusqlite::Result<ScanLogEntry> {
    Ok(ScanLogEntry {
        id: row.get(0)?,
        volume_id: row.get(1)?,
        entry_id: row.get(2)?,
        event: row.get(3)?,
        new_path: row.get(4)?,
        old_path: row.get(5)?,
        new_size: row.get(6)?,
        detected_at: row.get(7)?,
    })
}

/// Top folders by recursive size (for the "top dossiers" bar chart).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderStat {
    pub path: String,
    pub name: String,
    pub bytes_total: i64,
    pub files_total: i64,
}

pub fn get_top_folders(
    conn: &Connection,
    volume_id: i64,
    parent_path: &str,
    limit: i64,
) -> DbResult<Vec<FolderStat>> {
    // Use direct aggregation from entries (dir_tree_stats may not be populated yet)
    let mut stmt = conn.prepare_cached(
        "SELECT e.path, e.name, COALESCE(d.bytes_total, 0), COALESCE(d.files_total, 0)
         FROM entries e
         LEFT JOIN dir_tree_stats d ON d.entry_id = e.id
         WHERE e.volume_id=?1 AND e.parent_path=?2 AND e.is_dir=1 AND e.status='present'
         ORDER BY COALESCE(d.bytes_total, e.size_bytes) DESC
         LIMIT ?3",
    )?;
    let rows = stmt
        .query_map(params![volume_id, parent_path, limit], |r| {
            Ok(FolderStat {
                path: r.get(0)?,
                name: r.get(1)?,
                bytes_total: r.get(2)?,
                files_total: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Volume snapshot history (for trend sparklines).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeSnapshot {
    pub scanned_at: i64,
    pub file_count: i64,
    pub dir_count: i64,
    pub total_bytes: Option<i64>,
    pub used_bytes: Option<i64>,
}

pub fn get_volume_snapshots(
    conn: &Connection,
    volume_id: i64,
    limit: i64,
) -> DbResult<Vec<VolumeSnapshot>> {
    let mut stmt = conn.prepare_cached(
        "SELECT scanned_at, file_count, dir_count, total_bytes, used_bytes
         FROM volume_snapshots WHERE volume_id=?1
         ORDER BY scanned_at DESC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![volume_id, limit], |r| {
            Ok(VolumeSnapshot {
                scanned_at: r.get(0)?,
                file_count: r.get(1)?,
                dir_count: r.get(2)?,
                total_bytes: r.get(3)?,
                used_bytes: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ============================================================================
// Tags — extended (list all)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
}

pub fn list_tags(conn: &Connection) -> DbResult<Vec<Tag>> {
    let mut stmt = conn.prepare_cached("SELECT id, name, color FROM tags ORDER BY name")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn update_tag(conn: &Connection, id: i64, name: &str, color: Option<&str>) -> DbResult<()> {
    conn.execute(
        "UPDATE tags SET name=?1, color=?2 WHERE id=?3",
        params![name, color, id],
    )?;
    Ok(())
}

pub fn delete_tag(conn: &Connection, id: i64) -> DbResult<()> {
    conn.execute("DELETE FROM tags WHERE id=?1", params![id])?;
    Ok(())
}

pub fn untag_entry(conn: &Connection, entry_id: i64, tag_id: i64) -> DbResult<()> {
    conn.execute(
        "DELETE FROM entry_tags WHERE entry_id=?1 AND tag_id=?2",
        params![entry_id, tag_id],
    )?;
    Ok(())
}

// ============================================================================
// Collections CRUD (tâche 22)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub is_smart: bool,
    pub smart_query: Option<String>,
    pub sort_order: String,
    pub created_at: i64,
}

pub fn list_collections(conn: &Connection) -> DbResult<Vec<Collection>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id,name,description,icon,color,is_smart,smart_query,sort_order,created_at FROM collections ORDER BY name")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Collection {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
                icon: r.get(3)?,
                color: r.get(4)?,
                is_smart: r.get::<_, i32>(5)? != 0,
                smart_query: r.get(6)?,
                sort_order: r.get(7)?,
                created_at: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn create_collection(
    conn: &Connection,
    name: &str,
    description: Option<&str>,
    icon: Option<&str>,
    color: Option<&str>,
    is_smart: bool,
    smart_query: Option<&str>,
    now: i64,
) -> DbResult<i64> {
    conn.execute(
        "INSERT INTO collections (name,description,icon,color,is_smart,smart_query,sort_order,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,'name_asc',?7,?7)",
        params![name, description, icon, color, is_smart as i32, smart_query, now])?;
    Ok(conn.last_insert_rowid())
}

pub fn update_collection(
    conn: &Connection,
    id: i64,
    name: &str,
    description: Option<&str>,
    icon: Option<&str>,
    color: Option<&str>,
    smart_query: Option<&str>,
    now: i64,
) -> DbResult<()> {
    conn.execute(
        "UPDATE collections SET name=?1,description=?2,icon=?3,color=?4,smart_query=?5,updated_at=?6 WHERE id=?7",
        params![name, description, icon, color, smart_query, now, id])?;
    Ok(())
}

pub fn delete_collection(conn: &Connection, id: i64) -> DbResult<()> {
    conn.execute("DELETE FROM collections WHERE id=?1", params![id])?;
    Ok(())
}

pub fn add_to_collection(
    conn: &Connection,
    collection_id: i64,
    entry_id: i64,
    now: i64,
) -> DbResult<()> {
    conn.execute("INSERT OR IGNORE INTO collection_entries (collection_id,entry_id,added_at) VALUES (?1,?2,?3)",
        params![collection_id, entry_id, now])?;
    Ok(())
}

pub fn remove_from_collection(
    conn: &Connection,
    collection_id: i64,
    entry_id: i64,
) -> DbResult<()> {
    conn.execute(
        "DELETE FROM collection_entries WHERE collection_id=?1 AND entry_id=?2",
        params![collection_id, entry_id],
    )?;
    Ok(())
}

pub fn get_collection_entries(
    conn: &Connection,
    collection_id: i64,
    limit: i64,
) -> DbResult<Vec<EntrySlim>> {
    let mut stmt = conn.prepare_cached(
        "SELECT e.id,e.name,e.is_dir,e.kind,e.ext,e.size_bytes,e.mtime,e.status
         FROM entries e JOIN collection_entries ce ON ce.entry_id=e.id
         WHERE ce.collection_id=?1 AND e.status='present'
         ORDER BY ce.position, ce.added_at DESC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![collection_id, limit], map_entry_slim)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ============================================================================
// Custom fields CRUD (tâche 22)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomField {
    pub id: i64,
    pub name: String,
    pub field_type: String,
    pub options: Option<String>,
    pub sort_order: i64,
}

pub fn list_custom_fields(conn: &Connection) -> DbResult<Vec<CustomField>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id,name,field_type,options,sort_order FROM custom_fields ORDER BY sort_order",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CustomField {
                id: r.get(0)?,
                name: r.get(1)?,
                field_type: r.get(2)?,
                options: r.get(3)?,
                sort_order: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn create_custom_field(
    conn: &Connection,
    name: &str,
    field_type: &str,
    options: Option<&str>,
    now: i64,
) -> DbResult<i64> {
    conn.execute("INSERT INTO custom_fields (name,field_type,options,sort_order,created_at) VALUES (?1,?2,?3,0,?4)",
        params![name, field_type, options, now])?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_custom_field(conn: &Connection, id: i64) -> DbResult<()> {
    conn.execute("DELETE FROM custom_fields WHERE id=?1", params![id])?;
    Ok(())
}

pub fn get_entry_custom_values(
    conn: &Connection,
    entry_id: i64,
) -> DbResult<Vec<(i64, String, String, Option<String>)>> {
    let mut stmt = conn.prepare_cached(
        "SELECT cf.id, cf.name, cf.field_type, ecv.value
         FROM custom_fields cf LEFT JOIN entry_custom_values ecv ON ecv.field_id=cf.id AND ecv.entry_id=?1
         ORDER BY cf.sort_order")?;
    let rows = stmt
        .query_map(params![entry_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn set_entry_custom_value(
    conn: &Connection,
    entry_id: i64,
    field_id: i64,
    value: Option<&str>,
) -> DbResult<()> {
    match value {
        Some(v) => {
            conn.execute(
                "INSERT INTO entry_custom_values (entry_id,field_id,value) VALUES (?1,?2,?3)
                 ON CONFLICT(entry_id,field_id) DO UPDATE SET value=excluded.value",
                params![entry_id, field_id, v],
            )?;
        }
        None => {
            conn.execute(
                "DELETE FROM entry_custom_values WHERE entry_id=?1 AND field_id=?2",
                params![entry_id, field_id],
            )?;
        }
    }
    Ok(())
}
