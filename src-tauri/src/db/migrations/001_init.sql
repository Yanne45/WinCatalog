-- ============================================================================
-- WinCatalog — Migration 001 : Schéma initial complet (v2 corrigée)
-- ============================================================================
-- Basé sur la Synthèse Projet v2 + revue critique
-- SQLite 3.x + FTS5
-- ============================================================================

-- ============================================================================
-- PRAGMAS DE PERFORMANCE
-- ============================================================================

PRAGMA journal_mode = WAL;            -- lectures non bloquantes pendant les écritures
PRAGMA synchronous = NORMAL;          -- bon compromis perf/sécurité pour un catalogue
PRAGMA cache_size = -64000;           -- 64 Mo de cache (défaut = 2 Mo)
PRAGMA mmap_size = 268435456;         -- 256 Mo mmap pour gros index
PRAGMA temp_store = MEMORY;           -- tables temporaires en RAM
PRAGMA foreign_keys = ON;             -- intégrité référentielle activée

-- ============================================================================
-- 1. TABLES PRINCIPALES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- locations — Emplacements physiques des volumes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,            -- ex: "Boîte #1", "Étagère bureau", "Coffre-fort"
  description TEXT,
  icon        TEXT,                     -- emoji ou référence icône
  created_at  INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- volumes — Racines scannées
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS volumes (
  id             INTEGER PRIMARY KEY,
  label          TEXT NOT NULL,
  root_path      TEXT NOT NULL UNIQUE,
  fs_uuid        TEXT,
  fs_type        TEXT,                    -- ntfs/ext4/apfs...
  total_bytes    INTEGER,
  free_bytes     INTEGER,
  used_bytes     INTEGER,
  is_online      INTEGER NOT NULL DEFAULT 1,
  last_online_at INTEGER,
  auto_detect    INTEGER NOT NULL DEFAULT 1,
  scan_mode      TEXT DEFAULT 'full'
                 CHECK (scan_mode IN ('full','quick','watch')),
  last_scan_at       INTEGER,
  last_quick_scan_at INTEGER,
  location_id    INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  disk_number    TEXT,                    -- numéro/étiquette physique ("DVD-042")
  created_at     INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- entries — Noyau commun fichiers/dossiers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY,
  volume_id     INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,

  path          TEXT NOT NULL,
  path_lower    TEXT GENERATED ALWAYS AS (LOWER(path)) STORED,
  parent_path   TEXT NOT NULL,
  parent_path_lower TEXT GENERATED ALWAYS AS (LOWER(parent_path)) STORED,  -- [FIX D] navigation case-insensitive
  name          TEXT NOT NULL,
  is_dir        INTEGER NOT NULL CHECK (is_dir IN (0,1)),

  kind          TEXT NOT NULL DEFAULT 'other'
                CHECK (kind IN (
                  'dir','image','video','audio','document','text',
                  'archive','font','ebook','other'
                )),

  ext           TEXT,
  mime          TEXT,

  size_bytes    INTEGER NOT NULL DEFAULT 0,
  mtime         INTEGER,
  ctime         INTEGER,
  atime         INTEGER,

  inode         TEXT,
  device_id     TEXT,

  status        TEXT NOT NULL DEFAULT 'present'
                CHECK (status IN ('present','missing','deleted')),

  last_seen_at  INTEGER NOT NULL,

  quick_hash    TEXT,
  full_hash     TEXT,
  hash_algo     TEXT,

  extra_json    TEXT,

  UNIQUE(volume_id, path)
);

CREATE INDEX IF NOT EXISTS idx_entries_parent        ON entries(volume_id, parent_path);
CREATE INDEX IF NOT EXISTS idx_entries_parent_lower   ON entries(volume_id, parent_path_lower);  -- [FIX D]
CREATE INDEX IF NOT EXISTS idx_entries_kind           ON entries(volume_id, kind);
CREATE INDEX IF NOT EXISTS idx_entries_kind_size      ON entries(volume_id, kind, size_bytes DESC);  -- [FIX F] vues "Gros fichiers"
CREATE INDEX IF NOT EXISTS idx_entries_type           ON entries(volume_id, is_dir, mime, ext);
CREATE INDEX IF NOT EXISTS idx_entries_mtime          ON entries(volume_id, mtime);
CREATE INDEX IF NOT EXISTS idx_entries_size           ON entries(volume_id, size_bytes);
CREATE INDEX IF NOT EXISTS idx_entries_status         ON entries(status);
CREATE INDEX IF NOT EXISTS idx_entries_kind_stats     ON entries(status, is_dir, kind, size_bytes)
    WHERE status='present' AND is_dir=0;  -- covering index for global kind stats
CREATE INDEX IF NOT EXISTS idx_entries_path_lower     ON entries(volume_id, path_lower);

-- Index pour doublons (hash non-null uniquement)
CREATE INDEX IF NOT EXISTS idx_entries_full_hash ON entries(full_hash) WHERE full_hash IS NOT NULL;

-- Index pour keyset pagination (explorateur)
CREATE INDEX IF NOT EXISTS idx_entries_parent_mtime ON entries(volume_id, parent_path, mtime DESC, id DESC);

-- ----------------------------------------------------------------------------
-- entry_meta — Métadonnées éditoriales utilisateur
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entry_meta (
  entry_id      INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  display_name  TEXT,
  description   TEXT,
  notes         TEXT,
  rating        INTEGER CHECK (rating BETWEEN 0 AND 5),
  favorite      INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  color_label   TEXT,
  created_at    INTEGER,
  updated_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_entry_meta_favorite ON entry_meta(favorite) WHERE favorite = 1;

-- ----------------------------------------------------------------------------
-- tags / entry_tags — Classification
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(entry_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

-- ----------------------------------------------------------------------------
-- collections / collection_entries — Dossiers virtuels
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  color       TEXT,
  is_smart    INTEGER NOT NULL DEFAULT 0 CHECK (is_smart IN (0,1)),
  smart_query TEXT,             -- JSON : critères pour collections dynamiques
  sort_order  TEXT DEFAULT 'name_asc',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_entries (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  entry_id      INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  position      INTEGER,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY(collection_id, entry_id)
);

-- ----------------------------------------------------------------------------
-- assets — Thumbnails, previews, covers, posters
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY,
  entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  role        TEXT NOT NULL
              CHECK (role IN ('thumb','preview','cover','poster','artwork','screenshot')),
  source      TEXT NOT NULL
              CHECK (source IN ('generated','embedded','user','downloaded')),
  mime        TEXT,
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  path        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  is_primary  INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0,1)),
  extra_json  TEXT
);

CREATE INDEX  IF NOT EXISTS idx_assets_entry_role  ON assets(entry_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_primary_asset ON assets(entry_id, role) WHERE is_primary = 1;
CREATE INDEX  IF NOT EXISTS idx_assets_primary     ON assets(entry_id, role, is_primary) WHERE is_primary = 1;

-- ----------------------------------------------------------------------------
-- jobs — File de tâches (scan, thumbnails, hash, IA…)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id           INTEGER PRIMARY KEY,
  type         TEXT NOT NULL
               CHECK (type IN (                                    -- [FIX A] types contrôlés
                 'scan','thumb','preview','hash',
                 'extract_meta','extract_text',
                 'ocr','classify','summarize','embed',
                 'analyze_image','report','cleanup'
               )),
  variant      TEXT,
  entry_id     INTEGER REFERENCES entries(id) ON DELETE CASCADE,
  volume_id    INTEGER REFERENCES volumes(id) ON DELETE CASCADE,

  priority     INTEGER NOT NULL DEFAULT 100,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','running','done','error','canceled','paused')),
  progress     REAL DEFAULT 0.0,

  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error   TEXT,

  depends_on   INTEGER REFERENCES jobs(id),

  payload      TEXT,              -- JSON
  result       TEXT,              -- JSON

  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  updated_at   INTEGER NOT NULL,
  completed_at INTEGER,

  UNIQUE(type, variant, entry_id)
);

-- [FIX B] Unicité pour les jobs de volume sans entry_id (ex: scan volume X)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_jobs_volume
  ON jobs(type, variant, volume_id) WHERE entry_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_status_priority ON jobs(status, priority, updated_at);
CREATE INDEX IF NOT EXISTS idx_jobs_entry           ON jobs(entry_id);
CREATE INDEX IF NOT EXISTS idx_jobs_depends         ON jobs(depends_on) WHERE depends_on IS NOT NULL;

-- ----------------------------------------------------------------------------
-- trash — Corbeille logique
-- ----------------------------------------------------------------------------
-- [FIX C] Pas de FK vers entries (l'entrée peut être supprimée de entries).
-- On conserve original_hash pour traçabilité + meta_snapshot complet.
CREATE TABLE IF NOT EXISTS trash (
  id            INTEGER PRIMARY KEY,
  entry_id      INTEGER NOT NULL,          -- référence logique (pas FK)
  volume_id     INTEGER NOT NULL,
  original_path TEXT NOT NULL,
  original_hash TEXT,                       -- [FIX C] hash au moment de la suppression
  moved_to      TEXT,
  reason        TEXT NOT NULL DEFAULT 'user'
                CHECK (reason IN ('user','duplicate','auto_clean','rule')),
  size_bytes    INTEGER NOT NULL,
  deleted_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  restored_at   INTEGER,
  meta_snapshot TEXT                        -- JSON snapshot complet au moment de la suppression
);

CREATE INDEX IF NOT EXISTS idx_trash_expires ON trash(expires_at);
CREATE INDEX IF NOT EXISTS idx_trash_entry   ON trash(entry_id);

-- ----------------------------------------------------------------------------
-- settings — Préférences utilisateur
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,        -- JSON pour valeurs complexes
  updated_at INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- scan_profiles — Profils de scan réutilisables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scan_profiles (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  config     TEXT NOT NULL,         -- JSON
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- ----------------------------------------------------------------------------
-- [FIX 2] scans — Historique des scans (scan_log.scan_id → FK)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scans (
  id           INTEGER PRIMARY KEY,
  volume_id    INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  profile_id   INTEGER REFERENCES scan_profiles(id) ON DELETE SET NULL,
  mode         TEXT NOT NULL DEFAULT 'full'
               CHECK (mode IN ('full','quick','watch')),
  status       TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running','completed','error','canceled','paused')),
  started_at   INTEGER NOT NULL,
  completed_at INTEGER,
  -- Compteurs résumé
  files_added    INTEGER NOT NULL DEFAULT 0,
  files_modified INTEGER NOT NULL DEFAULT 0,
  files_deleted  INTEGER NOT NULL DEFAULT 0,
  files_total    INTEGER NOT NULL DEFAULT 0,
  dirs_total     INTEGER NOT NULL DEFAULT 0,
  bytes_total    INTEGER NOT NULL DEFAULT 0,
  duration_ms    INTEGER,
  error_count    INTEGER NOT NULL DEFAULT 0,
  stats_json     TEXT,               -- JSON stats détaillées additionnelles
  job_id         INTEGER REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_scans_volume ON scans(volume_id, started_at DESC);

-- ----------------------------------------------------------------------------
-- custom_fields / entry_custom_values — Champs personnalisés
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_fields (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  field_type  TEXT NOT NULL DEFAULT 'text'
              CHECK (field_type IN ('text','number','date','select','boolean')),
  options     TEXT,                  -- JSON pour 'select'
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_custom_values (
  entry_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  field_id    INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value       TEXT,
  PRIMARY KEY(entry_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_values_field ON entry_custom_values(field_id, value);

-- ----------------------------------------------------------------------------
-- rename_profiles — Profils de renommage batch
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rename_profiles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  pattern     TEXT NOT NULL,
  scope_kind  TEXT,
  created_at  INTEGER NOT NULL
);

-- ============================================================================
-- 2. TABLES DE MÉTADONNÉES TYPÉES (1-1 avec entries)
-- ============================================================================

CREATE TABLE IF NOT EXISTS meta_image (
  entry_id     INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  width        INTEGER,
  height       INTEGER,
  orientation  INTEGER,
  color_space  TEXT,
  camera_make  TEXT,
  camera_model TEXT,
  iso          INTEGER,
  focal_length REAL,
  aperture     REAL,
  shutter_speed TEXT,
  gps_lat      REAL,
  gps_lon      REAL,
  taken_at     INTEGER,
  extra_json   TEXT
);

CREATE TABLE IF NOT EXISTS meta_video (
  entry_id     INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  duration_ms  INTEGER,
  width        INTEGER,
  height       INTEGER,
  fps          REAL,
  video_codec  TEXT,
  audio_codec  TEXT,
  bitrate      INTEGER,
  container    TEXT,
  extra_json   TEXT
);

CREATE TABLE IF NOT EXISTS meta_audio (
  entry_id     INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  duration_ms  INTEGER,
  artist       TEXT,
  album        TEXT,
  title        TEXT,
  track_number INTEGER,
  genre        TEXT,
  year         INTEGER,
  bitrate      INTEGER,
  sample_rate  INTEGER,
  channels     INTEGER,
  extra_json   TEXT
);

CREATE TABLE IF NOT EXISTS meta_document (
  entry_id     INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  format       TEXT,
  page_count   INTEGER,
  title        TEXT,
  author       TEXT,
  keywords     TEXT,
  created_at   INTEGER,
  extra_json   TEXT
);

CREATE TABLE IF NOT EXISTS meta_archive (
  entry_id          INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  format            TEXT,
  entry_count       INTEGER,
  uncompressed_size INTEGER,
  extra_json        TEXT
);

CREATE TABLE IF NOT EXISTS meta_ebook (
  entry_id     INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  format       TEXT,
  title        TEXT,
  author       TEXT,
  series       TEXT,
  language     TEXT,
  extra_json   TEXT
);

CREATE TABLE IF NOT EXISTS meta_text (
  entry_id     INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  encoding     TEXT,
  language     TEXT,
  line_count   INTEGER,
  extra_json   TEXT
);

-- ============================================================================
-- 3. TABLES ANALYTIQUES
-- ============================================================================

CREATE TABLE IF NOT EXISTS volume_snapshots (
  id          INTEGER PRIMARY KEY,
  volume_id   INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  scanned_at  INTEGER NOT NULL,
  total_bytes INTEGER,
  free_bytes  INTEGER,
  used_bytes  INTEGER,
  file_count  INTEGER NOT NULL,
  dir_count   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS volume_kind_stats (
  volume_id   INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  scanned_at  INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  bytes_sum   INTEGER NOT NULL,
  count_sum   INTEGER NOT NULL,
  PRIMARY KEY(volume_id, scanned_at, kind)
);

CREATE TABLE IF NOT EXISTS folder_stats (
  volume_id    INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  scanned_at   INTEGER NOT NULL,
  parent_path  TEXT NOT NULL,
  bytes_files  INTEGER NOT NULL,
  count_files  INTEGER NOT NULL,
  count_dirs   INTEGER NOT NULL,
  PRIMARY KEY(volume_id, scanned_at, parent_path)
);

CREATE TABLE IF NOT EXISTS dir_tree_stats (
  entry_id     INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  scanned_at   INTEGER NOT NULL,
  bytes_total  INTEGER NOT NULL,
  files_total  INTEGER NOT NULL,
  dirs_total   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS report_templates (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  template_id INTEGER REFERENCES report_templates(id),
  created_at  INTEGER NOT NULL,
  title       TEXT,
  output_path TEXT,
  format      TEXT CHECK (format IN ('pdf','csv','json','html')),
  snapshot_at INTEGER
);

-- ============================================================================
-- 4. CHANGELOG DES SCANS
-- ============================================================================

CREATE TABLE IF NOT EXISTS scan_log (
  id          INTEGER PRIMARY KEY,
  volume_id   INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
  scan_id     INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,  -- [FIX 2] vraie FK
  entry_id    INTEGER,
  event       TEXT NOT NULL
              CHECK (event IN ('added','modified','deleted','moved','renamed')),
  old_path    TEXT,
  new_path    TEXT,
  old_size    INTEGER,
  new_size    INTEGER,
  detected_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scan_log_scan   ON scan_log(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_log_volume ON scan_log(volume_id, detected_at);
CREATE INDEX IF NOT EXISTS idx_scan_log_event  ON scan_log(volume_id, event, detected_at);

-- ============================================================================
-- 5. TABLES IA
-- ============================================================================

CREATE TABLE IF NOT EXISTS entry_text (
  entry_id   INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  text       TEXT,
  char_count INTEGER,
  source     TEXT CHECK(source IN ('native','ocr')),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_annotations (
  id            INTEGER PRIMARY KEY,
  entry_id      INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                CHECK (kind IN (                                   -- [FIX G] liste fermée
                  'label','doc_type','summary','entity',
                  'ocr_text','keyword','category'
                )),
  value         TEXT NOT NULL,
  confidence    REAL,
  source        TEXT NOT NULL DEFAULT 'auto'
                CHECK (source IN ('auto','user_confirmed','user_corrected')),
  model         TEXT,
  model_version TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE(entry_id, kind, value)
);

CREATE INDEX IF NOT EXISTS idx_ai_annotations_kind  ON ai_annotations(kind, confidence);
CREATE INDEX IF NOT EXISTS idx_ai_annotations_entry ON ai_annotations(entry_id);

CREATE TABLE IF NOT EXISTS entry_embeddings (
  entry_id   INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  embedding  BLOB,
  dim        INTEGER,
  model      TEXT,
  updated_at INTEGER NOT NULL
);

-- ============================================================================
-- 6. RECHERCHE FULL-TEXT (FTS5)
-- ============================================================================

-- [FIX 1] entries_fts en mode EXTERNAL CONTENT (content='')
-- display_name vient de entry_meta, pas de entries → impossible d'utiliser content='entries'
-- content='' + content_rowid='id' permet les opérations delete/reinsert dans les triggers
-- Alimentée exclusivement par triggers depuis entries + entry_meta
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts
USING fts5(name, path, ext, mime, display_name, content='', content_rowid='id');

-- FTS sur le texte extrait des documents
CREATE VIRTUAL TABLE IF NOT EXISTS entry_text_fts
USING fts5(text, content='', content_rowid='entry_id');

-- ============================================================================
-- 7. TRIGGERS DE SYNCHRONISATION FTS
-- ============================================================================

-- -------------------------------------------------------------------------
-- entries → entries_fts
-- -------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, name, path, ext, mime, display_name)
  VALUES (new.id, new.name, new.path, new.ext, new.mime, NULL);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, name, path, ext, mime, display_name)
  VALUES('delete', old.id, old.name, old.path, old.ext, old.mime,
         (SELECT display_name FROM entry_meta WHERE entry_id = old.id));
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_au AFTER UPDATE ON entries BEGIN
  -- delete old
  INSERT INTO entries_fts(entries_fts, rowid, name, path, ext, mime, display_name)
  VALUES('delete', old.id, old.name, old.path, old.ext, old.mime,
         (SELECT display_name FROM entry_meta WHERE entry_id = old.id));
  -- insert new
  INSERT INTO entries_fts(rowid, name, path, ext, mime, display_name)
  VALUES (new.id, new.name, new.path, new.ext, new.mime,
          (SELECT display_name FROM entry_meta WHERE entry_id = new.id));
END;

-- -------------------------------------------------------------------------
-- entry_meta.display_name → entries_fts
-- Contentless FTS5 : on doit supprimer/réinsérer la ligne complète
-- -------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS entry_meta_fts_ai AFTER INSERT ON entry_meta
WHEN new.display_name IS NOT NULL BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, name, path, ext, mime, display_name)
  VALUES('delete', new.entry_id,
         (SELECT name FROM entries WHERE id = new.entry_id),
         (SELECT path FROM entries WHERE id = new.entry_id),
         (SELECT ext  FROM entries WHERE id = new.entry_id),
         (SELECT mime FROM entries WHERE id = new.entry_id),
         NULL);
  INSERT INTO entries_fts(rowid, name, path, ext, mime, display_name)
  VALUES(new.entry_id,
         (SELECT name FROM entries WHERE id = new.entry_id),
         (SELECT path FROM entries WHERE id = new.entry_id),
         (SELECT ext  FROM entries WHERE id = new.entry_id),
         (SELECT mime FROM entries WHERE id = new.entry_id),
         new.display_name);
END;

CREATE TRIGGER IF NOT EXISTS entry_meta_fts_au AFTER UPDATE OF display_name ON entry_meta BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, name, path, ext, mime, display_name)
  VALUES('delete', old.entry_id,
         (SELECT name FROM entries WHERE id = old.entry_id),
         (SELECT path FROM entries WHERE id = old.entry_id),
         (SELECT ext  FROM entries WHERE id = old.entry_id),
         (SELECT mime FROM entries WHERE id = old.entry_id),
         old.display_name);
  INSERT INTO entries_fts(rowid, name, path, ext, mime, display_name)
  VALUES(new.entry_id,
         (SELECT name FROM entries WHERE id = new.entry_id),
         (SELECT path FROM entries WHERE id = new.entry_id),
         (SELECT ext  FROM entries WHERE id = new.entry_id),
         (SELECT mime FROM entries WHERE id = new.entry_id),
         new.display_name);
END;

CREATE TRIGGER IF NOT EXISTS entry_meta_fts_ad AFTER DELETE ON entry_meta
WHEN old.display_name IS NOT NULL BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, name, path, ext, mime, display_name)
  VALUES('delete', old.entry_id,
         (SELECT name FROM entries WHERE id = old.entry_id),
         (SELECT path FROM entries WHERE id = old.entry_id),
         (SELECT ext  FROM entries WHERE id = old.entry_id),
         (SELECT mime FROM entries WHERE id = old.entry_id),
         old.display_name);
  INSERT INTO entries_fts(rowid, name, path, ext, mime, display_name)
  VALUES(old.entry_id,
         (SELECT name FROM entries WHERE id = old.entry_id),
         (SELECT path FROM entries WHERE id = old.entry_id),
         (SELECT ext  FROM entries WHERE id = old.entry_id),
         (SELECT mime FROM entries WHERE id = old.entry_id),
         NULL);
END;

-- -------------------------------------------------------------------------
-- entry_text → entry_text_fts
-- -------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS entry_text_fts_ai AFTER INSERT ON entry_text BEGIN
  INSERT INTO entry_text_fts(rowid, text)
  VALUES (new.entry_id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS entry_text_fts_ad AFTER DELETE ON entry_text BEGIN
  INSERT INTO entry_text_fts(entry_text_fts, rowid, text)
  VALUES('delete', old.entry_id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS entry_text_fts_au AFTER UPDATE ON entry_text BEGIN
  INSERT INTO entry_text_fts(entry_text_fts, rowid, text)
  VALUES('delete', old.entry_id, old.text);
  INSERT INTO entry_text_fts(rowid, text)
  VALUES (new.entry_id, new.text);
END;

-- ============================================================================
-- 8. DASHBOARD & EXPORTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS dashboard_layout (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT 'default',
  widgets    TEXT NOT NULL,       -- JSON : [{type, position, size, config}]
  is_active  INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
  id         INTEGER PRIMARY KEY,
  format     TEXT NOT NULL CHECK (format IN ('json','csv','sqlite','pdf','html')),
  scope      TEXT NOT NULL,       -- 'full', 'volume:{id}', 'collection:{id}'
  path       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- ============================================================================
-- 9. SETTINGS PAR DÉFAUT
-- ============================================================================

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('ui.theme',               '"system"',    strftime('%s','now')),
  ('ui.density',             '"comfortable"', strftime('%s','now')),
  ('ui.language',            '"fr"',        strftime('%s','now')),
  ('scan.default_exclusions','["node_modules",".git",".DS_Store","Thumbs.db","$RECYCLE.BIN"]', strftime('%s','now')),
  ('scan.max_depth',         '50',          strftime('%s','now')),
  ('perf.threads',           '4',           strftime('%s','now')),
  ('cache.max_size_mb',      '2048',        strftime('%s','now')),
  ('hash.algorithm',         '"blake3"',    strftime('%s','now')),
  ('trash.retention_days',   '30',          strftime('%s','now')),
  ('ai.mode',                '"cloud"',     strftime('%s','now')),
  ('ai.auto_classify_docs',  'true',        strftime('%s','now')),
  ('ai.auto_ocr_scanned',   'true',        strftime('%s','now'));

-- ============================================================================
-- 10. PROFIL DE SCAN PAR DÉFAUT
-- ============================================================================

INSERT OR IGNORE INTO scan_profiles (id, name, config, is_default, created_at) VALUES
  (1, 'Standard', '{"exclusions":["node_modules",".git",".DS_Store","Thumbs.db","$RECYCLE.BIN"],"max_depth":50,"follow_symlinks":false,"thumbnails":true,"hash":true,"metadata":true}', 1, strftime('%s','now'));

-- ============================================================================
-- FIN DE MIGRATION
-- ============================================================================
