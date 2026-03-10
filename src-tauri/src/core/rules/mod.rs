// ============================================================================
// WinCatalog — core/rules/mod.rs
// Automatic rules: triggered post-scan to auto-tag/auto-collect entries
//
// Rules are stored as JSON in settings (key: "rules.auto_rules").
// Each rule: { conditions: [...], actions: [...] }
// ============================================================================

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::db::{Database, DbError, DbResult};

// ============================================================================
// Rule model
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoRule {
    pub id: String, // unique ID (uuid-like)
    pub name: String,
    pub enabled: bool,
    pub conditions: Vec<Condition>,
    pub actions: Vec<Action>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Condition {
    /// File kind matches
    Kind { value: String },
    /// Extension matches (case-insensitive)
    Extension { value: String },
    /// Size greater than N bytes
    SizeGreaterThan { bytes: i64 },
    /// Size less than N bytes
    SizeLessThan { bytes: i64 },
    /// Path contains substring
    PathContains { value: String },
    /// Name contains substring
    NameContains { value: String },
    /// Not accessed since N days ago (based on atime or mtime)
    NotAccessedSince { days: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Action {
    /// Add a tag (by name, creates if needed)
    AddTag {
        tag_name: String,
        tag_color: Option<String>,
    },
    /// Add to a collection (by name, creates if needed)
    AddToCollection { collection_name: String },
}

// ============================================================================
// Rule storage (settings-based)
// ============================================================================

const RULES_KEY: &str = "rules.auto_rules";

pub fn load_rules(db: &Database) -> DbResult<Vec<AutoRule>> {
    let json = db.read(|conn| {
        conn.prepare_cached("SELECT value FROM settings WHERE key=?1")?
            .query_row(params![RULES_KEY], |r| r.get::<_, String>(0))
            .optional()
            .map_err(crate::db::DbError::Sqlite)
    })?;

    match json {
        Some(j) => {
            serde_json::from_str(&j).map_err(|e| DbError::Execution(format!("Parse rules: {}", e)))
        }
        None => Ok(Vec::new()),
    }
}

pub fn save_rules(db: &Database, rules: &[AutoRule]) -> DbResult<()> {
    let json = serde_json::to_string(rules)
        .map_err(|e| DbError::Execution(format!("Serialize rules: {}", e)))?;
    let now = ts();
    db.write(move |conn| {
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![RULES_KEY, json, now],
        )?;
        Ok(())
    })
}

use rusqlite::OptionalExtension;

// ============================================================================
// Rule evaluation — run all enabled rules on new entries after scan
// ============================================================================

pub struct RuleStats {
    pub rules_evaluated: u64,
    pub entries_matched: u64,
    pub actions_applied: u64,
}

/// Run all enabled rules against entries that were added/modified in a scan.
/// `scan_id` identifies which scan to get the changed entries from.
pub fn run_rules_post_scan(db: &Database, volume_id: i64, scan_id: i64) -> DbResult<RuleStats> {
    let rules = load_rules(db)?;
    let enabled: Vec<&AutoRule> = rules.iter().filter(|r| r.enabled).collect();

    if enabled.is_empty() {
        return Ok(RuleStats {
            rules_evaluated: 0,
            entries_matched: 0,
            actions_applied: 0,
        });
    }

    // Load entries that were added or modified in this scan
    let entries: Vec<(
        i64,
        String,
        String,
        String,
        Option<String>,
        i64,
        Option<i64>,
        Option<i64>,
    )> = db.read(|conn| {
        let mut stmt = conn.prepare_cached(
            "SELECT e.id, e.name, e.path, e.kind, e.ext, e.size_bytes, e.mtime, e.atime
             FROM entries e
             JOIN scan_log sl ON sl.entry_id = e.id
             WHERE sl.volume_id = ?1 AND sl.scan_id = ?2
               AND sl.event IN ('added', 'modified')
               AND e.status = 'present'",
        )?;
        let rows = stmt
            .query_map(params![volume_id, scan_id], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;

    let mut stats = RuleStats {
        rules_evaluated: enabled.len() as u64,
        entries_matched: 0,
        actions_applied: 0,
    };
    let now = ts();

    for (entry_id, name, path, kind, ext, size, mtime, atime) in &entries {
        for rule in &enabled {
            if evaluate_conditions(
                &rule.conditions,
                &name,
                &path,
                &kind,
                ext.as_deref(),
                *size,
                *mtime,
                *atime,
                now,
            ) {
                stats.entries_matched += 1;
                for action in &rule.actions {
                    match apply_action(db, *entry_id, action, now) {
                        Ok(()) => {
                            stats.actions_applied += 1;
                        }
                        Err(e) => {
                            log::warn!(
                                "Rule action failed: rule_id={} rule_name='{}' entry_id={} action={:?} error={}",
                                rule.id,
                                rule.name,
                                entry_id,
                                action,
                                e
                            );
                        }
                    }
                }
            }
        }
    }

    log::info!(
        "Rules post-scan: {} rules, {} entries matched, {} actions applied",
        stats.rules_evaluated,
        stats.entries_matched,
        stats.actions_applied
    );

    Ok(stats)
}

// ============================================================================
// Condition evaluation
// ============================================================================

fn evaluate_conditions(
    conditions: &[Condition],
    name: &str,
    path: &str,
    kind: &str,
    ext: Option<&str>,
    size: i64,
    mtime: Option<i64>,
    atime: Option<i64>,
    now: i64,
) -> bool {
    // All conditions must match (AND logic)
    conditions.iter().all(|c| match c {
        Condition::Kind { value } => kind == value,
        Condition::Extension { value } => {
            ext.map(|e| e.eq_ignore_ascii_case(value)).unwrap_or(false)
        }
        Condition::SizeGreaterThan { bytes } => size > *bytes,
        Condition::SizeLessThan { bytes } => size < *bytes,
        Condition::PathContains { value } => path.to_lowercase().contains(&value.to_lowercase()),
        Condition::NameContains { value } => name.to_lowercase().contains(&value.to_lowercase()),
        Condition::NotAccessedSince { days } => {
            let threshold = now - (days * 86400);
            let last_access = atime.or(mtime).unwrap_or(0);
            last_access < threshold
        }
    })
}

// ============================================================================
// Action application
// ============================================================================

fn apply_action(db: &Database, entry_id: i64, action: &Action, now: i64) -> DbResult<()> {
    match action {
        Action::AddTag {
            tag_name,
            tag_color,
        } => {
            let name = tag_name.clone();
            let color = tag_color.clone();
            db.write(move |conn| {
                // Get or create tag
                let tag_id: i64 = match conn
                    .prepare_cached("SELECT id FROM tags WHERE name=?1")?
                    .query_row(params![name], |r| r.get(0))
                    .optional()?
                {
                    Some(id) => id,
                    None => {
                        conn.execute(
                            "INSERT INTO tags (name, color, created_at) VALUES (?1, ?2, ?3)",
                            params![name, color, now],
                        )?;
                        conn.last_insert_rowid()
                    }
                };
                // Assign tag
                conn.execute(
                    "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?1, ?2)",
                    params![entry_id, tag_id],
                )?;
                Ok(())
            })
        }
        Action::AddToCollection { collection_name } => {
            let name = collection_name.clone();
            db.write(move |conn| {
                // Get or create collection
                let col_id: i64 = match conn
                    .prepare_cached("SELECT id FROM collections WHERE name=?1")?
                    .query_row(params![name], |r| r.get(0))
                    .optional()?
                {
                    Some(id) => id,
                    None => {
                        conn.execute(
                            "INSERT INTO collections (name, is_smart, sort_order, created_at, updated_at) VALUES (?1, 0, 'name_asc', ?2, ?2)",
                            params![name, now],
                        )?;
                        conn.last_insert_rowid()
                    }
                };
                // Add entry to collection
                conn.execute(
                    "INSERT OR IGNORE INTO collection_entries (collection_id, entry_id, added_at) VALUES (?1, ?2, ?3)",
                    params![col_id, entry_id, now],
                )?;
                Ok(())
            })
        }
    }
}

fn ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
