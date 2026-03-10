// ============================================================================
// WinCatalog — api/tauri.ts
// TypeScript wrappers for Tauri IPC commands
// ============================================================================

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ============================================================================
// Types
// ============================================================================

export interface Volume {
  id: number;
  label: string;
  root_path: string;
  fs_uuid: string | null;
  fs_type: string | null;
  total_bytes: number | null;
  free_bytes: number | null;
  used_bytes: number | null;
  is_online: boolean;
  last_online_at: number | null;
  auto_detect: boolean;
  scan_mode: string;
  last_scan_at: number | null;
  last_quick_scan_at: number | null;
  location_id: number | null;
  disk_number: string | null;
  created_at: number;
}

export interface Entry {
  id: number; volume_id: number; path: string; parent_path: string;
  name: string; is_dir: boolean; kind: FileKind; ext: string | null;
  mime: string | null; size_bytes: number; mtime: number | null;
  ctime: number | null; atime: number | null; status: string;
  last_seen_at: number; quick_hash: string | null; full_hash: string | null;
}

export interface EntrySlim {
  id: number; name: string; is_dir: boolean; kind: FileKind;
  ext: string | null; size_bytes: number; mtime: number | null; status: string;
}

export type FileKind =
  | 'dir' | 'image' | 'video' | 'audio' | 'document'
  | 'text' | 'archive' | 'font' | 'ebook' | 'other';

export interface SearchResult {
  id: number; name: string; path: string; kind: FileKind;
  size_bytes: number; volume_id: number; rank: number;
}

export interface Job {
  id: number; type: string; variant: string | null; entry_id: number | null;
  volume_id: number | null; priority: number; status: string;
  progress: number; attempts: number; last_error: string | null;
}

export interface ScanStats {
  scan_id: number; files_added: number; files_modified: number;
  files_deleted: number; files_unchanged: number; files_total: number;
  dirs_total: number; bytes_total: number; errors: number;
  duration_ms: number; jobs_scheduled: number;
}

export interface ScanEvent {
  type: 'Started' | 'Progress' | 'PhaseComplete' | 'Completed' | 'Error';
  scan_id: number;
  phase?: string; files_processed?: number; dirs_processed?: number;
  bytes_found?: number; stats?: ScanStats; path?: string; error?: string;
  volume_id?: number; mode?: string;
}

export interface PragmaDiagnostics {
  journal_mode: string; synchronous: number; cache_size_kb: number;
  mmap_size_mb: number; page_size: number; db_size_mb: number; foreign_keys: boolean;
}

// ============================================================================
// API wrappers
// ============================================================================

export const volumeApi = {
  list: () => invoke<Volume[]>('list_volumes'),
  get: (id: number) => invoke<Volume | null>('get_volume', { id }),
  add: (label: string, rootPath: string) => invoke<number>('add_volume', { label, rootPath }),
  update: (id: number, label: string, diskNumber?: string, locationId?: number, scanMode?: string) =>
    invoke<void>('update_volume', { id, label, diskNumber: diskNumber ?? null, locationId: locationId ?? null, scanMode: scanMode ?? 'full' }),
  updateSpace: (id: number, total: number, free: number, used: number) =>
    invoke<void>('update_volume_space', { id, total, free, used }),
  delete: (id: number) => invoke<void>('delete_volume', { id }),
};

export const entryApi = {
  list: (volumeId: number, parentPath: string, cursor?: { mtime: number; id: number }, limit = 200) =>
    invoke<EntrySlim[]>('list_entries', {
      volumeId, parentPath, cursorMtime: cursor?.mtime ?? null, cursorId: cursor?.id ?? null, limit,
    }),
  get: (id: number) => invoke<Entry | null>('get_entry', { id }),
};

export const searchApi = {
  entries: (query: string, limit = 50) => invoke<SearchResult[]>('search', { query, limit }),
  content: (query: string, limit = 50) => invoke<SearchResult[]>('search_content', { query, limit }),
};

export const scanApi = {
  start: (volumeId: number, mode: 'full' | 'quick' = 'full', opts?: { maxDepth?: number; computeHash?: boolean; generateThumbs?: boolean }) =>
    invoke<ScanStats>('start_scan', {
      volumeId, mode,
      maxDepth: opts?.maxDepth ?? null,
      computeHash: opts?.computeHash ?? null,
      generateThumbs: opts?.generateThumbs ?? null,
    }),
  onEvent: (cb: (e: ScanEvent) => void): Promise<UnlistenFn> =>
    listen<ScanEvent>('scan-event', (e) => cb(e.payload)),
};

// ============================================================================
// Job API
// ============================================================================

export interface JobEvent {
  type: 'Started' | 'Progress' | 'Done' | 'Failed' | 'Idle' | 'Paused' | 'Resumed';
  job_id?: number;
  job_type?: string;
  variant?: string | null;
  progress?: number;
  detail?: string;
  duration_ms?: number;
  error?: string;
  will_retry?: boolean;
}

export const jobApi = {
  listActive: () => invoke<Job[]>('list_active_jobs'),
  pause: () => invoke<void>('pause_jobs'),
  resume: () => invoke<void>('resume_jobs'),
  cancelCurrent: () => invoke<void>('cancel_current_job'),
  wake: () => invoke<void>('wake_job_runner'),
  onEvent: (cb: (e: JobEvent) => void): Promise<UnlistenFn> =>
    listen<JobEvent>('job-event', (e) => cb(e.payload)),
};

// ============================================================================
// Hash API
// ============================================================================

export interface HashStats {
  files_hashed: number;
  files_skipped: number;
  files_errors: number;
  bytes_processed: number;
  duration_ms: number;
}

export interface HashEvent {
  type: 'Started' | 'Progress' | 'FileError' | 'Completed';
  volume_id: number;
  total_files?: number;
  mode?: string;
  files_hashed?: number;
  bytes_processed?: number;
  current_file?: string;
  path?: string;
  error?: string;
  stats?: HashStats;
}

export const hashApi = {
  start: (volumeId: number, mode: 'quick' | 'full' = 'full', minSize?: number) =>
    invoke<HashStats>('start_hash', { volumeId, mode, minSize: minSize ?? null }),
  onEvent: (cb: (e: HashEvent) => void): Promise<UnlistenFn> =>
    listen<HashEvent>('hash-event', (e) => cb(e.payload)),
};

export const duplicateApi = {
  find: (minSize?: number) => invoke<[string, number, number][]>('find_duplicates', { minSize: minSize ?? null }),
  getGroup: (hash: string) => invoke<Entry[]>('get_duplicate_group', { hash }),
};

export const settingsApi = {
  get: (key: string) => invoke<string | null>('get_setting', { key }),
  set: (key: string, value: string) => invoke<void>('set_setting', { key, value }),
  getJson: async <T>(key: string, fallback: T): Promise<T> => {
    const raw = await settingsApi.get(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  },
  setJson: <T>(key: string, value: T) => settingsApi.set(key, JSON.stringify(value)),
};

export const tagApi = {
  create: (name: string, color?: string) => invoke<number>('create_tag', { name, color: color ?? null }),
  tagEntry: (entryId: number, tagId: number) => invoke<void>('tag_entry', { entryId, tagId }),
  untagEntry: (entryId: number, tagId: number) => invoke<void>('untag_entry', { entryId, tagId }),
  getEntryTags: (entryId: number) => invoke<[number, string, string | null][]>('get_entry_tags', { entryId }),
  list: () => invoke<Tag[]>('list_tags'),
  update: (id: number, name: string, color?: string) => invoke<void>('update_tag', { id, name, color: color ?? null }),
  delete: (id: number) => invoke<void>('delete_tag', { id }),
};

export interface Tag { id: number; name: string; color: string | null; }

// ============================================================================
// Trash API
// ============================================================================

export interface TrashItem {
  id: number; entry_id: number; volume_id: number; original_path: string;
  reason: string; size_bytes: number; deleted_at: number; expires_at: number;
}

export const trashApi = {
  trash: (entryId: number, reason?: string) => invoke<number>('trash_entry', { entryId, reason: reason ?? null }),
  list: (volumeId?: number, limit?: number) => invoke<TrashItem[]>('list_trash', { volumeId: volumeId ?? null, limit: limit ?? 100 }),
  restore: (trashId: number) => invoke<void>('restore_entry', { trashId }),
  purgeExpired: () => invoke<number>('purge_expired'),
  summary: () => invoke<[number, number]>('trash_summary'),
};

export const diagnosticsApi = { getDb: () => invoke<PragmaDiagnostics>('get_db_diagnostics') };

// ============================================================================
// Dashboard API
// ============================================================================

export interface KindStat {
  kind: string; count: number; bytes: number;
}

export interface ScanLogEntry {
  id: number; volume_id: number; entry_id: number | null; event: string;
  new_path: string | null; old_path: string | null; new_size: number | null; detected_at: number;
}

export interface FolderStat {
  path: string; name: string; bytes_total: number; files_total: number;
}

export interface VolumeSnapshot {
  scanned_at: number; file_count: number; dir_count: number;
  total_bytes: number | null; used_bytes: number | null;
}

export const dashboardApi = {
  volumeKindStats: (volumeId: number) => invoke<KindStat[]>('get_volume_kind_stats', { volumeId }),
  globalKindStats: () => invoke<KindStat[]>('get_global_kind_stats'),
  recentScanLog: (volumeId?: number, eventFilter?: string, limit?: number) =>
    invoke<ScanLogEntry[]>('get_recent_scan_log', { volumeId: volumeId ?? null, eventFilter: eventFilter ?? null, limit: limit ?? 50 }),
  topFolders: (volumeId: number, parentPath: string, limit?: number) =>
    invoke<FolderStat[]>('get_top_folders', { volumeId, parentPath, limit: limit ?? 20 }),
  volumeSnapshots: (volumeId: number, limit?: number) =>
    invoke<VolumeSnapshot[]>('get_volume_snapshots', { volumeId, limit: limit ?? 30 }),
};

// ============================================================================
// Volume Events (from volume watcher)
// ============================================================================

export interface VolumeEvent {
  type: 'Online' | 'Offline' | 'StatusReport';
  volume_id?: number;
  label?: string;
  root_path?: string;
  online?: number[];
  offline?: number[];
}

export const volumeEvents = {
  onEvent: (cb: (e: VolumeEvent) => void): Promise<UnlistenFn> =>
    listen<VolumeEvent>('volume-event', (e) => cb(e.payload)),
};

// ============================================================================
// Helpers
// ============================================================================

export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes == null || bytes === 0) return '0 o';
  const k = 1024;
  const sizes = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${s % 60}s`;
}

// ============================================================================
// Collections API
// ============================================================================

export interface Collection {
  id: number; name: string; description: string | null;
  icon: string | null; color: string | null;
  is_smart: boolean; smart_query: string | null;
  sort_order: string; created_at: number;
}

export const collectionApi = {
  list: () => invoke<Collection[]>('list_collections'),
  create: (name: string, description?: string, icon?: string, color?: string, isSmart?: boolean, smartQuery?: string) =>
    invoke<number>('create_collection', { name, description: description ?? null, icon: icon ?? null, color: color ?? null, isSmart: isSmart ?? false, smartQuery: smartQuery ?? null }),
  update: (id: number, name: string, description?: string, icon?: string, color?: string, smartQuery?: string) =>
    invoke<void>('update_collection', { id, name, description: description ?? null, icon: icon ?? null, color: color ?? null, smartQuery: smartQuery ?? null }),
  delete: (id: number) => invoke<void>('delete_collection', { id }),
  addEntry: (collectionId: number, entryId: number) => invoke<void>('add_to_collection', { collectionId, entryId }),
  removeEntry: (collectionId: number, entryId: number) => invoke<void>('remove_from_collection', { collectionId, entryId }),
  getEntries: (collectionId: number, limit?: number) => invoke<EntrySlim[]>('get_collection_entries', { collectionId, limit: limit ?? 500 }),
};

// ============================================================================
// Custom Fields API
// ============================================================================

export interface CustomField {
  id: number; name: string; field_type: string; options: string | null; sort_order: number;
}

export const customFieldApi = {
  list: () => invoke<CustomField[]>('list_custom_fields'),
  create: (name: string, fieldType: string, options?: string) =>
    invoke<number>('create_custom_field', { name, fieldType, options: options ?? null }),
  delete: (id: number) => invoke<void>('delete_custom_field', { id }),
  getValues: (entryId: number) => invoke<[number, string, string, string | null][]>('get_entry_custom_values', { entryId }),
  setValue: (entryId: number, fieldId: number, value?: string) =>
    invoke<void>('set_entry_custom_value', { entryId, fieldId, value: value ?? null }),
};

// ============================================================================
// Rename API
// ============================================================================

export interface RenamePreview {
  entry_id: number; old_name: string; new_name: string;
  old_path: string; new_path: string; conflict: boolean;
}

export interface RenameStats { renamed: number; skipped: number; errors: number; }

export const renameApi = {
  preview: (entryIds: number[], pattern: string) => invoke<RenamePreview[]>('preview_rename', { entryIds, pattern }),
  apply: (previews: RenamePreview[], volumeId: number) => invoke<RenameStats>('apply_rename', { previews, volumeId }),
};

// ============================================================================
// AI API
// ============================================================================

export const aiApi = {
  classify: (entryId: number) => invoke<{ doc_type: string; labels: string[]; confidence: number }>('ai_classify', { entryId }),
  summarize: (entryId: number) => invoke<string>('ai_summarize', { entryId }),
  analyzeImage: (entryId: number) => invoke<string[]>('ai_analyze_image', { entryId }),
};

// ============================================================================
// Rules API
// ============================================================================

export interface AutoRule {
  id: string; name: string; enabled: boolean;
  conditions: Array<{ type: string; value?: string; bytes?: number; days?: number }>;
  actions: Array<{ type: string; tag_name?: string; tag_color?: string; collection_name?: string }>;
}

export const rulesApi = {
  list: () => invoke<AutoRule[]>('list_rules'),
  save: (ruleList: AutoRule[]) => invoke<void>('save_rules', { ruleList }),
};

// ============================================================================
// Watch API
// ============================================================================

export interface WatchEvent {
  type: 'Started' | 'Change' | 'Error' | 'Stopped';
  volume_id: number; kind?: string; paths?: string[];
  path?: string; error?: string;
}

export const watchApi = {
  start: (volumeId: number) => invoke<void>('start_watch', { volumeId }),
  stop: (volumeId: number) => invoke<void>('stop_watch', { volumeId }),
  listWatched: () => invoke<number[]>('list_watched_volumes'),
  onEvent: (cb: (e: WatchEvent) => void): Promise<UnlistenFn> =>
    listen<WatchEvent>('watch-event', (e) => cb(e.payload)),
};

// ============================================================================
// Export API
// ============================================================================

export interface ExportStats {
  format: string; scope: string; path: string;
  entries_exported: number; file_size_bytes: number; duration_ms: number;
}

export const exportApi = {
  catalogue: (format: 'sqlite' | 'json' | 'csv', scope: string, outputPath: string) =>
    invoke<ExportStats>('export_catalogue', { format, scope, outputPath }),
};

// ============================================================================
// Parallel Scan API
// ============================================================================

export const parallelScanApi = {
  start: (volumeIds: number[], mode: 'full' | 'quick' = 'full', maxConcurrent?: number) =>
    invoke<any>('start_parallel_scan', { volumeIds, mode, maxConcurrent: maxConcurrent ?? null }),
  onEvent: (cb: (e: any) => void): Promise<UnlistenFn> =>
    listen<any>('parallel-scan-event', (e) => cb(e.payload)),
};

// ============================================================================
// Extractor Plugins API
// ============================================================================

export interface PluginInfo { name: string; kinds: string[]; extensions: string[]; priority: number; }

export const extractorApi = {
  listPlugins: () => invoke<PluginInfo[]>('list_extractor_plugins'),
};
