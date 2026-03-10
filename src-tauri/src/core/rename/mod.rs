// ============================================================================
// WinCatalog — core/rename/mod.rs
// Batch rename: pattern tokens, preview, apply + journalize in scan_log
// ============================================================================

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use thiserror::Error;

use crate::db::{Database, DbError};

#[derive(Error, Debug)]
pub enum RenameError {
    #[error("DB error: {0}")]
    Db(#[from] DbError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Pattern error: {0}")]
    Pattern(String),
}

pub type RenameResult<T> = Result<T, RenameError>;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RenamePreview {
    pub entry_id: i64,
    pub old_name: String,
    pub new_name: String,
    pub old_path: String,
    pub new_path: String,
    pub conflict: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RenameStats {
    pub renamed: u64,
    pub skipped: u64,
    pub errors: u64,
}

// ============================================================================
// Pattern token expansion
// ============================================================================

/// Expand a rename pattern for a given entry.
///
/// Supported tokens:
///   {name}           — original name without extension
///   {ext}            — extension (lowercase)
///   {date:FORMAT}    — mtime formatted (subset: YYYY, MM, DD, HH, mm, ss)
///   {counter:N}      — sequential counter zero-padded to N digits
///   {parent}         — parent directory name
///   {kind}           — file kind (image, video, etc.)
pub fn expand_pattern(
    pattern: &str,
    name: &str,
    ext: Option<&str>,
    mtime: Option<i64>,
    parent: &str,
    kind: &str,
    counter: u64,
) -> RenameResult<String> {
    let stem = if let Some(dot) = name.rfind('.') {
        &name[..dot]
    } else {
        name
    };
    let ext_str = ext.unwrap_or("");

    let mut result = pattern.to_string();

    // Simple tokens
    result = result.replace("{name}", stem);
    result = result.replace("{ext}", ext_str);
    result = result.replace("{parent}", parent.split(&['/', '\\']).last().unwrap_or(""));
    result = result.replace("{kind}", kind);

    // Counter: {counter:N}
    if let Some(start) = result.find("{counter:") {
        if let Some(end) = result[start..].find('}') {
            let spec = &result[start + 9..start + end];
            let width: usize = spec.parse().unwrap_or(3);
            let formatted = format!("{:0>width$}", counter, width = width);
            result = format!(
                "{}{}{}",
                &result[..start],
                formatted,
                &result[start + end + 1..]
            );
        }
    }

    // Date: {date:FORMAT}
    if let Some(start) = result.find("{date:") {
        if let Some(end) = result[start..].find('}') {
            let fmt = &result[start + 6..start + end];
            let formatted = format_timestamp(mtime.unwrap_or(0), fmt);
            result = format!(
                "{}{}{}",
                &result[..start],
                formatted,
                &result[start + end + 1..]
            );
        }
    }

    // Add extension back if not in pattern
    if !result.contains('.') && !ext_str.is_empty() {
        result = format!("{}.{}", result, ext_str);
    }

    Ok(result)
}

fn format_timestamp(ts: i64, fmt: &str) -> String {
    // Simple formatter: YYYY-MM-DD_HH-mm-ss
    let dt = chrono_from_ts(ts);
    let mut s = fmt.to_string();
    s = s.replace("YYYY", &format!("{:04}", dt.0));
    s = s.replace("MM", &format!("{:02}", dt.1));
    s = s.replace("DD", &format!("{:02}", dt.2));
    s = s.replace("HH", &format!("{:02}", dt.3));
    s = s.replace("mm", &format!("{:02}", dt.4));
    s = s.replace("ss", &format!("{:02}", dt.5));
    s
}

fn chrono_from_ts(ts: i64) -> (i32, u32, u32, u32, u32, u32) {
    // Simplified date decomposition from unix timestamp
    let secs = ts;
    let days = (secs / 86400) as i32;
    let time = (secs % 86400) as u32;
    let h = time / 3600;
    let m = (time % 3600) / 60;
    let s = time % 60;

    // Days to date (simplified, doesn't handle leap years perfectly)
    let mut y = 1970i32;
    let mut remaining = days;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [
        0,
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut mo = 1u32;
    for i in 1..=12 {
        if remaining < month_days[i] {
            break;
        }
        remaining -= month_days[i];
        mo = (i + 1) as u32;
    }
    let d = remaining as u32 + 1;

    (y, mo, d, h, m, s)
}

// ============================================================================
// Preview (dry-run)
// ============================================================================

/// Generate preview of batch rename without applying.
pub fn preview_rename(
    db: &Database,
    entry_ids: &[i64],
    pattern: &str,
) -> RenameResult<Vec<RenamePreview>> {
    let ids = entry_ids.to_vec();
    let entries: Vec<(i64, String, String, Option<String>, Option<i64>, String)> =
        db.read(|conn| {
            let mut results = Vec::with_capacity(ids.len());
            let mut stmt = conn.prepare_cached(
                "SELECT id, name, path, ext, mtime, kind FROM entries WHERE id=?1",
            )?;
            for id in &ids {
                if let Ok(row) = stmt.query_row(params![id], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                }) {
                    results.push(row);
                }
            }
            Ok(results)
        })?;

    let mut previews = Vec::with_capacity(entries.len());
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (i, (id, name, path, ext, mtime, kind)) in entries.iter().enumerate() {
        let parent = path.rsplit_once(&['/', '\\']).map(|(p, _)| p).unwrap_or("");
        let new_name = expand_pattern(
            pattern,
            name,
            ext.as_deref(),
            *mtime,
            parent,
            kind,
            i as u64 + 1,
        )?;

        let new_path = if let Some((dir, _)) = path.rsplit_once(&['/', '\\']) {
            format!("{}/{}", dir, new_name)
        } else {
            new_name.clone()
        };

        let conflict = seen_names.contains(&new_name.to_lowercase());
        seen_names.insert(new_name.to_lowercase());

        previews.push(RenamePreview {
            entry_id: *id,
            old_name: name.clone(),
            new_name,
            old_path: path.clone(),
            new_path,
            conflict,
        });
    }

    Ok(previews)
}

// ============================================================================
// Apply rename
// ============================================================================

/// Apply batch rename: rename files on disk + update DB + log in scan_log.
pub fn apply_rename(
    db: &Database,
    previews: &[RenamePreview],
    volume_id: i64,
) -> RenameResult<RenameStats> {
    let mut stats = RenameStats {
        renamed: 0,
        skipped: 0,
        errors: 0,
    };
    let now = ts();

    for p in previews {
        if p.conflict {
            stats.skipped += 1;
            continue;
        }

        // Rename on disk
        let old = Path::new(&p.old_path);
        let new = Path::new(&p.new_path);

        if !old.exists() {
            stats.skipped += 1;
            continue;
        }

        match std::fs::rename(old, new) {
            Ok(()) => {
                // Update DB
                let eid = p.entry_id;
                let new_name = p.new_name.clone();
                let new_path_str = p.new_path.clone();
                let new_parent = new
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
                let new_ext = new.extension().map(|e| e.to_string_lossy().to_lowercase());
                let old_path = p.old_path.clone();

                let db_result = db.write(move |conn| {
                    conn.execute(
                        "UPDATE entries SET name=?1, path=?2, parent_path=?3, ext=?4 WHERE id=?5",
                        params![new_name, new_path_str, new_parent, new_ext, eid],
                    )?;
                    // Journal in scan_log
                    conn.execute(
                        "INSERT INTO scan_log (volume_id, scan_id, entry_id, event, old_path, new_path, detected_at)
                         VALUES (?1, 0, ?2, 'renamed', ?3, ?4, ?5)",
                        params![volume_id, eid, old_path, new_path_str, now],
                    )?;
                    Ok(())
                });

                match db_result {
                    Ok(()) => {
                        stats.renamed += 1;
                    }
                    Err(e) => {
                        // Roll back disk rename to keep consistency
                        log::error!("DB update failed after rename, rolling back: {}", e);
                        let _ = std::fs::rename(new, old);
                        stats.errors += 1;
                    }
                }
            }
            Err(e) => {
                log::warn!("Rename failed {} → {}: {}", p.old_path, p.new_path, e);
                stats.errors += 1;
            }
        }
    }

    log::info!(
        "Batch rename: {} renamed, {} skipped, {} errors",
        stats.renamed,
        stats.skipped,
        stats.errors
    );
    Ok(stats)
}

fn ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
