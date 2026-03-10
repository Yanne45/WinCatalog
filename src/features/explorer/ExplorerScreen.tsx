// ============================================================================
// WinCatalog — features/explorer/ExplorerScreen.tsx
// Explorer: breadcrumb, sortable columns, list/grid, inspector, tags
// ============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Box, Group, Stack, Text, Paper, ActionIcon, TextInput, Tooltip,
  ScrollArea, Skeleton, Badge, Divider, SegmentedControl, Button,
  Breadcrumbs, Anchor, UnstyledButton,
} from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  IconArrowLeft, IconArrowRight, IconArrowUp, IconSearch,
  IconList, IconGridDots, IconInfoCircle, IconFolder, IconFile,
  IconChevronRight, IconChevronUp, IconChevronDown, IconX,
  IconTag,
} from '@tabler/icons-react';
import {
  volumeApi, entryApi, tagApi, searchApi, formatBytes, formatDate,
  type Volume, type EntrySlim, type FileKind,
} from '../../api/tauri';
import { FILE_KIND_COLORS } from '../../app/theme';

// ============================================================================
// Types
// ============================================================================

type ViewMode = 'list' | 'grid';
type SortField = 'name' | 'size' | 'ext' | 'mtime' | 'kind';
type SortDir = 'asc' | 'desc';

interface TagInfo { id: number; name: string; color: string | null; }

// ============================================================================
// Kind badge
// ============================================================================

function KindBadge({ kind }: { kind: FileKind }) {
  const info = FILE_KIND_COLORS[kind] ?? FILE_KIND_COLORS.other;
  return (
    <Badge size="xs" variant="light" style={{ backgroundColor: `${info.color}18`, color: info.color, border: 'none' }}>
      {info.icon} {kind}
    </Badge>
  );
}

function FileIcon({ kind, isDir }: { kind: FileKind; isDir: boolean }) {
  const info = FILE_KIND_COLORS[kind] ?? FILE_KIND_COLORS.other;
  if (isDir) return <IconFolder size={18} stroke={1.5} style={{ color: '#facc15', flexShrink: 0 }} />;
  return <IconFile size={18} stroke={1.5} style={{ color: info.color, flexShrink: 0 }} />;
}

// ============================================================================
// Sortable column header
// ============================================================================

function SortHeader({
  label, field, w, ta, currentField, currentDir, onSort,
}: {
  label: string; field: SortField; w?: number; ta?: string;
  currentField: SortField; currentDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const active = currentField === field;
  return (
    <UnstyledButton
      onClick={() => onSort(field)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: ta === 'right' ? 'flex-end' : 'flex-start', gap: 2, width: w, flexShrink: w ? 0 : undefined, flex: w ? undefined : 1 }}
    >
      <Text size="xs" fw={600} c={active ? 'var(--mantine-color-primary-4)' : 'dimmed'}>{label}</Text>
      {active && (currentDir === 'asc'
        ? <IconChevronUp size={12} style={{ color: 'var(--mantine-color-primary-4)' }} />
        : <IconChevronDown size={12} style={{ color: 'var(--mantine-color-primary-4)' }} />
      )}
    </UnstyledButton>
  );
}

// ============================================================================
// List View Row (with optional tags)
// ============================================================================

function ListRow({
  entry, selected, tags, onClick, onDoubleClick,
}: {
  entry: EntrySlim; selected: boolean; tags?: TagInfo[];
  onClick: () => void; onDoubleClick: () => void;
}) {
  return (
    <UnstyledButton
      w="100%" onClick={onClick} onDoubleClick={onDoubleClick}
      py={6} px="sm"
      className="wc-hoverable"
      data-active={selected || undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderRadius: 'var(--mantine-radius-xs)',
        backgroundColor: selected ? 'var(--mantine-color-primary-light)' : 'transparent',
      }}
    >
      <FileIcon kind={entry.kind} isDir={entry.is_dir} />
      <Text size="sm" fw={entry.is_dir ? 500 : 400} style={{ flex: 1, minWidth: 0 }} lineClamp={1}>
        {entry.name}
      </Text>
      {/* Tags */}
      {tags && tags.length > 0 && (
        <Group gap={3} style={{ flexShrink: 0 }}>
          {tags.slice(0, 2).map((t) => (
            <Badge key={t.id} size="xs" variant="dot" color={t.color ?? 'gray'} style={{ maxWidth: 70 }}>
              {t.name}
            </Badge>
          ))}
          {tags.length > 2 && <Text size="xs" c="dimmed">+{tags.length - 2}</Text>}
        </Group>
      )}
      {!entry.is_dir && (
        <Text size="xs" c="dimmed" w={70} ta="right" style={{ flexShrink: 0 }}>{formatBytes(entry.size_bytes)}</Text>
      )}
      <Text size="xs" c="dimmed" w={50} ta="right" style={{ flexShrink: 0 }}>{entry.ext ?? (entry.is_dir ? '' : '—')}</Text>
      <Text size="xs" c="dimmed" w={120} ta="right" style={{ flexShrink: 0 }}>{formatDate(entry.mtime)}</Text>
    </UnstyledButton>
  );
}

// ============================================================================
// Grid View Card
// ============================================================================

function GridCard({
  entry, selected, onClick, onDoubleClick,
}: {
  entry: EntrySlim; selected: boolean; onClick: () => void; onDoubleClick: () => void;
}) {
  const info = FILE_KIND_COLORS[entry.kind] ?? FILE_KIND_COLORS.other;
  return (
    <UnstyledButton
      onClick={onClick} onDoubleClick={onDoubleClick} p="sm"
      className="wc-hoverable"
      data-active={selected || undefined}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        borderRadius: 'var(--mantine-radius-sm)',
        backgroundColor: selected ? 'var(--mantine-color-primary-light)' : 'transparent',
        border: `1px solid ${selected ? 'var(--mantine-color-primary-7)' : 'transparent'}`,
        width: 120,
      }}
    >
      <Box w={64} h={64} style={{ borderRadius: 'var(--mantine-radius-sm)', backgroundColor: 'var(--mantine-color-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {entry.is_dir ? <IconFolder size={32} stroke={1} style={{ color: '#facc15' }} /> : <Text size="xl">{info.icon}</Text>}
      </Box>
      <Text size="xs" ta="center" lineClamp={2} w={100}>{entry.name}</Text>
      {!entry.is_dir && <Text size="xs" c="dimmed">{formatBytes(entry.size_bytes)}</Text>}
    </UnstyledButton>
  );
}

// ============================================================================
// Inspector Panel (with tags editing)
// ============================================================================

function InspectorPanel({
  entry, entryTags, allTags, onClose, onAddTag, onTagFilter,
}: {
  entry: EntrySlim | null; entryTags: TagInfo[]; allTags: TagInfo[];
  onClose: () => void; onAddTag: (entryId: number, tagId: number) => void;
  onTagFilter: (tagId: number) => void;
}) {
  if (!entry) {
    return <Box p="md"><Text size="sm" c="dimmed" ta="center" mt="xl">Sélectionnez un fichier pour voir ses détails</Text></Box>;
  }

  const info = FILE_KIND_COLORS[entry.kind] ?? FILE_KIND_COLORS.other;
  const unassigned = allTags.filter((t) => !entryTags.some((et) => et.id === t.id));

  return (
    <ScrollArea h="100%" type="auto">
      <Stack p="md" gap="md">
        <Group justify="space-between">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Détails</Text>
          <ActionIcon variant="subtle" size="xs" color="gray" onClick={onClose}><IconX size={14} /></ActionIcon>
        </Group>

        {/* Preview placeholder */}
        <Box h={160} style={{ borderRadius: 'var(--mantine-radius-sm)', backgroundColor: 'var(--mantine-color-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {entry.is_dir ? <IconFolder size={48} stroke={1} style={{ color: '#facc15' }} /> : <Text fz={48}>{info.icon}</Text>}
        </Box>

        <div>
          <Text size="sm" fw={600} lineClamp={3}>{entry.name}</Text>
          <KindBadge kind={entry.kind} />
        </div>

        <Divider color="var(--mantine-color-default-border)" />

        {/* Metadata */}
        <Stack gap={8}>
          {!entry.is_dir && (
            <Group justify="space-between"><Text size="xs" c="dimmed">Taille</Text><Text size="xs" fw={500}>{formatBytes(entry.size_bytes)}</Text></Group>
          )}
          {entry.ext && (
            <Group justify="space-between"><Text size="xs" c="dimmed">Extension</Text><Text size="xs" fw={500}>.{entry.ext}</Text></Group>
          )}
          <Group justify="space-between"><Text size="xs" c="dimmed">Modifié</Text><Text size="xs" fw={500}>{formatDate(entry.mtime)}</Text></Group>
        </Stack>

        <Divider color="var(--mantine-color-default-border)" />

        {/* Tags */}
        <div>
          <Text size="xs" fw={600} c="dimmed" mb={6}>Tags</Text>
          <Group gap={4} mb={entryTags.length > 0 ? 8 : 0}>
            {entryTags.map((t) => (
              <Badge
                key={t.id} size="sm" variant="light" color={t.color ?? 'gray'}
                style={{ cursor: 'pointer' }}
                onClick={() => onTagFilter(t.id)}
              >
                {t.name}
              </Badge>
            ))}
            {entryTags.length === 0 && <Text size="xs" c="dimmed">Aucun tag</Text>}
          </Group>
          {/* Quick add tag */}
          {unassigned.length > 0 && (
            <Group gap={4}>
              <Text size="xs" c="dimmed">Ajouter :</Text>
              {unassigned.slice(0, 5).map((t) => (
                <Badge
                  key={t.id} size="xs" variant="outline" color={t.color ?? 'gray'}
                  className="wc-fade-hover"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onAddTag(entry.id, t.id)}
                >
                  + {t.name}
                </Badge>
              ))}
            </Group>
          )}
        </div>
      </Stack>
    </ScrollArea>
  );
}

// ============================================================================
// Breadcrumb
// ============================================================================

function PathBreadcrumb({
  volumeLabel, currentPath, rootPath, onNavigate,
}: {
  volumeLabel: string; currentPath: string; rootPath: string; onNavigate: (path: string) => void;
}) {
  const parts = useMemo(() => {
    const relative = currentPath.startsWith(rootPath) ? currentPath.slice(rootPath.length) : currentPath;
    const segments = relative.split(/[/\\]/).filter(Boolean);
    const crumbs: { label: string; path: string }[] = [{ label: `📀 ${volumeLabel}`, path: rootPath }];
    let acc = rootPath;
    for (const seg of segments) {
      acc = acc.endsWith('/') || acc.endsWith('\\') ? acc + seg : acc + '/' + seg;
      crumbs.push({ label: seg, path: acc });
    }
    return crumbs;
  }, [volumeLabel, currentPath, rootPath]);

  return (
    <Breadcrumbs separator={<IconChevronRight size={12} stroke={1.5} />}>
      {parts.map((c, i) => (
        <Anchor key={c.path} size="sm" c={i === parts.length - 1 ? undefined : 'dimmed'} fw={i === parts.length - 1 ? 600 : 400}
          onClick={() => onNavigate(c.path)} style={{ cursor: 'pointer' }}>{c.label}</Anchor>
      ))}
    </Breadcrumbs>
  );
}

// ============================================================================
// Virtualized list view (renders only visible rows)
// ============================================================================

const ROW_HEIGHT = 34;

function VirtualizedList({
  entries, selectedId, entryTagsMap, allTags,
  sortField, sortDir, onSort, onSelect, onDoubleClick,
  hasMore, loadingMore, onLoadMore,
}: {
  entries: EntrySlim[];
  selectedId: number | null;
  entryTagsMap: Map<number, TagInfo[]>;
  allTags: TagInfo[];
  sortField: SortField; sortDir: SortDir;
  onSort: (field: SortField) => void;
  onSelect: (id: number) => void;
  onDoubleClick: (entry: EntrySlim) => void;
  hasMore: boolean; loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const AUTO_LOAD_THRESHOLD_PX = 240;
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (!hasMore || loadingMore) return;
    const target = event.currentTarget;
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining <= AUTO_LOAD_THRESHOLD_PX) {
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  return (
    <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Sortable column headers */}
      <Group px="sm" py={4} gap={8} mx="xs" style={{ flexShrink: 0 }}>
        <Box w={18} />
        <SortHeader label="Nom" field="name" currentField={sortField} currentDir={sortDir} onSort={onSort} />
        {allTags.length > 0 && <Box w={80} />}
        <SortHeader label="Taille" field="size" w={70} ta="right" currentField={sortField} currentDir={sortDir} onSort={onSort} />
        <SortHeader label="Ext" field="ext" w={50} ta="right" currentField={sortField} currentDir={sortDir} onSort={onSort} />
        <SortHeader label="Modifié" field="mtime" w={120} ta="right" currentField={sortField} currentDir={sortDir} onSort={onSort} />
      </Group>
      <Divider color="var(--mantine-color-default-border)" mb={2} mx="xs" />

      {/* Virtualized scroll container */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflow: 'auto', paddingLeft: 8, paddingRight: 8 }}
      >
        <div style={{ height: rowVirtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index];
            return (
              <div
                key={entry.id}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <ListRow
                  entry={entry}
                  selected={selectedId === entry.id}
                  tags={entryTagsMap.get(entry.id)}
                  onClick={() => onSelect(entry.id)}
                  onDoubleClick={() => onDoubleClick(entry)}
                />
              </div>
            );
          })}
        </div>
        {hasMore && (
          <Box ta="center" py="sm">
            <Button variant="subtle" size="xs" onClick={onLoadMore} loading={loadingMore}>
              Charger plus de fichiers…
            </Button>
          </Box>
        )}
      </div>
    </Box>
  );
}

// ============================================================================
// Explorer Screen
// ============================================================================

export default function ExplorerScreen({
  initialVolumeId, initialPath, onNavigateApp,
}: {
  initialVolumeId?: number; initialPath?: string;
  onNavigateApp: (screen: string, context?: any) => void;
}) {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [activeVolume, setActiveVolume] = useState<Volume | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<EntrySlim[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [dirCount, setDirCount] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 200;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showInspector, setShowInspector] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const gridViewportRef = useRef<HTMLDivElement | null>(null);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Tags
  const [allTags, setAllTags] = useState<TagInfo[]>([]);
  const [entryTagsMap, setEntryTagsMap] = useState<Map<number, TagInfo[]>>(new Map());
  const [filterTagId, setFilterTagId] = useState<number | null>(null);
  const entryTagsMapRef = useRef<Map<number, TagInfo[]>>(new Map());
  const TAG_BATCH_SIZE = 200;

  useEffect(() => {
    entryTagsMapRef.current = entryTagsMap;
  }, [entryTagsMap]);

  // Load volumes
  useEffect(() => {
    volumeApi.list().then((vols) => {
      setVolumes(vols);
      if (initialVolumeId) {
        const v = vols.find((x) => x.id === initialVolumeId);
        if (v) { setActiveVolume(v); setCurrentPath(initialPath ?? v.root_path); }
      } else if (vols.length > 0) {
        setActiveVolume(vols[0]); setCurrentPath(vols[0].root_path);
      }
    });
  }, [initialVolumeId, initialPath]);

  // Load entries when path changes
  useEffect(() => {
    if (!activeVolume || !currentPath) return;
    let cancelled = false;
    setLoading(true);
    setSelectedId(null);
    setFilterTagId(null);
    setHasMore(false);
    entryApi.list(activeVolume.id, currentPath, undefined, PAGE_SIZE).then((data) => {
      if (!cancelled) {
        setEntries(data);
        let nextFiles = 0;
        let nextDirs = 0;
        let nextTotal = 0;
        for (const e of data) {
          if (e.is_dir) {
            nextDirs += 1;
          } else {
            nextFiles += 1;
            nextTotal += e.size_bytes;
          }
        }
        setFileCount(nextFiles);
        setDirCount(nextDirs);
        setTotalSize(nextTotal);
        setHasMore(data.length >= PAGE_SIZE);
        setLoading(false);
      }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeVolume, currentPath]);

  // Load more entries (pagination)
  const loadMore = useCallback(async () => {
    if (!activeVolume || !currentPath || loadingMore || !hasMore) return;
    const last = entries[entries.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const more = await entryApi.list(
        activeVolume.id,
        currentPath,
        { isDir: last.is_dir, mtime: last.mtime ?? 0, id: last.id },
        PAGE_SIZE,
      );
      setEntries((prev) => [...prev, ...more]);
      if (more.length > 0) {
        let addFiles = 0;
        let addDirs = 0;
        let addTotal = 0;
        for (const e of more) {
          if (e.is_dir) {
            addDirs += 1;
          } else {
            addFiles += 1;
            addTotal += e.size_bytes;
          }
        }
        setFileCount((v) => v + addFiles);
        setDirCount((v) => v + addDirs);
        setTotalSize((v) => v + addTotal);
      }
      setHasMore(more.length >= PAGE_SIZE);
    } catch { /* ignore */ }
    setLoadingMore(false);
  }, [activeVolume, currentPath, entries, loadingMore, hasMore]);

  const handleGridScroll = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    const viewport = gridViewportRef.current;
    if (!viewport) return;
    const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (remaining <= 240) {
      loadMore();
    }
  }, [loading, loadingMore, hasMore, loadMore]);

  // Load tags for visible entries (batch)
  useEffect(() => {
    if (entries.length === 0) { setEntryTagsMap(new Map()); return; }
    let cancelled = false;

    const loadEntryTags = async () => {
      try {
        const entryIds = entries.map((e) => e.id);
        const prevMap = entryTagsMapRef.current;

        // Keep only tags for currently loaded entries.
        const pruned = new Map<number, TagInfo[]>();
        for (const id of entryIds) {
          const existing = prevMap.get(id);
          if (existing) pruned.set(id, existing);
        }
        setEntryTagsMap(pruned);

        // Load tags only for entries that are still missing.
        const missingIds = entryIds.filter((id) => !pruned.has(id));
        if (missingIds.length === 0) return;

        const batches: number[][] = [];
        for (let i = 0; i < missingIds.length; i += TAG_BATCH_SIZE) {
          batches.push(missingIds.slice(i, i + TAG_BATCH_SIZE));
        }

        const batchResults = await Promise.all(
          batches.map((batch) => tagApi.getEntryTagsBulk(batch))
        );
        if (cancelled) return;

        const loaded = new Map<number, TagInfo[]>();
        for (const batch of batches) {
          for (const entryId of batch) {
            loaded.set(entryId, []);
          }
        }
        for (const rows of batchResults) {
          for (const [entryId, tagId, name, color] of rows) {
            const list = loaded.get(entryId);
            const tag: TagInfo = { id: tagId, name, color };
            if (list) {
              list.push(tag);
            } else {
              loaded.set(entryId, [tag]);
            }
          }
        }

        setEntryTagsMap((prev) => {
          const next = new Map(prev);
          for (const [entryId, tags] of loaded) {
            next.set(entryId, tags);
          }
          return next;
        });
      } catch {
        if (!cancelled) {
          const entryIds = entries.map((e) => e.id);
          const fallback = new Map<number, TagInfo[]>();
          for (const id of entryIds) {
            const existing = entryTagsMapRef.current.get(id);
            if (existing) fallback.set(id, existing);
          }
          setEntryTagsMap(fallback);
        }
      }
    };

    loadEntryTags();
    return () => { cancelled = true; };
  }, [entries]);

  // Load all tags (for filter sidebar + inspector)
  useEffect(() => {
    tagApi.list().then((tags) => {
      setAllTags(tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => {
      // Fallback: build from entryTagsMap
      const seen = new Map<number, TagInfo>();
      entryTagsMap.forEach((tags) => tags.forEach((t) => seen.set(t.id, t)));
      setAllTags(Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name)));
    });
  }, []);

  // Add tag to entry
  const handleAddTag = useCallback(async (entryId: number, tagId: number) => {
    try {
      await tagApi.tagEntry(entryId, tagId);
      // Refresh tags for this entry
      const tags = await tagApi.getEntryTags(entryId);
      setEntryTagsMap((prev) => {
        const next = new Map(prev);
        next.set(entryId, tags.map(([id, name, color]) => ({ id, name, color })));
        return next;
      });
    } catch (err) { console.error('Tag failed:', err); }
  }, []);

  // Sort handler
  const handleSort = useCallback((field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  }, [sortField]);

  // Navigation
  const navigateTo = useCallback((path: string) => {
    setHistory((prev) => [...prev.slice(0, historyIndex + 1), path]);
    setHistoryIndex((prev) => prev + 1);
    setCurrentPath(path);
  }, [historyIndex]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) { setHistoryIndex((i) => i - 1); setCurrentPath(history[historyIndex - 1]); }
  }, [history, historyIndex]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) { setHistoryIndex((i) => i + 1); setCurrentPath(history[historyIndex + 1]); }
  }, [history, historyIndex]);

  const goUp = useCallback(() => {
    if (!activeVolume) return;
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(sep);
    if (parts.length > 1) {
      parts.pop();
      const parent = parts.join(sep) || sep;
      if (parent.length >= activeVolume.root_path.length) navigateTo(parent);
    }
  }, [currentPath, activeVolume, navigateTo]);

  const handleDoubleClick = useCallback((entry: EntrySlim) => {
    if (entry.is_dir) {
      const sep = currentPath.includes('\\') ? '\\' : '/';
      navigateTo(currentPath.endsWith(sep) ? currentPath + entry.name : currentPath + sep + entry.name);
    }
  }, [currentPath, navigateTo]);

  const selectedEntry = useMemo(() => entries.find((e) => e.id === selectedId) ?? null, [entries, selectedId]);
  const selectedEntryTags = useMemo(() => selectedId ? (entryTagsMap.get(selectedId) ?? []) : [], [selectedId, entryTagsMap]);

  // Sort entries: dirs first, then by sortField
  const sortedEntries = useMemo(() => {
    const dirs = entries.filter((e) => e.is_dir);
    const files = entries.filter((e) => !e.is_dir);

    const comparator = (a: EntrySlim, b: EntrySlim) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'size': cmp = a.size_bytes - b.size_bytes; break;
        case 'ext': cmp = (a.ext ?? '').localeCompare(b.ext ?? ''); break;
        case 'mtime': cmp = (a.mtime ?? 0) - (b.mtime ?? 0); break;
        case 'kind': cmp = a.kind.localeCompare(b.kind); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    };

    dirs.sort(comparator);
    files.sort(comparator);
    return [...dirs, ...files];
  }, [entries, sortField, sortDir]);

  // FTS5 search: debounced query for 3+ chars
  const [ftsResultIds, setFtsResultIds] = useState<Set<number> | null>(null);
  const ftsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (ftsTimerRef.current) clearTimeout(ftsTimerRef.current);

    if (searchQuery.length < 3) {
      setFtsResultIds(null); // Use local filter
      return;
    }

    ftsTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchApi.entries(searchQuery, 500);
        setFtsResultIds(new Set(results.map((r) => r.id)));
      } catch {
        setFtsResultIds(null); // Fallback to local filter
      }
    }, 300);

    return () => { if (ftsTimerRef.current) clearTimeout(ftsTimerRef.current); };
  }, [searchQuery]);

  // Filter by search query + tag
  const filteredEntries = useMemo(() => {
    let result = sortedEntries;
    if (searchQuery) {
      if (ftsResultIds != null) {
        // FTS5 result filtering (3+ chars)
        result = result.filter((e) => ftsResultIds.has(e.id));
      } else {
        // Local filter (1-2 chars)
        const q = searchQuery.toLowerCase();
        result = result.filter((e) => e.name.toLowerCase().includes(q));
      }
    }
    if (filterTagId != null) {
      result = result.filter((e) => {
        const tags = entryTagsMap.get(e.id);
        return tags?.some((t) => t.id === filterTagId);
      });
    }
    return result;
  }, [sortedEntries, searchQuery, ftsResultIds, filterTagId, entryTagsMap]);

  // Keyboard navigation
  const containerRef = useRef<HTMLDivElement>(null);
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (filteredEntries.length === 0) return;
    const currentIdx = filteredEntries.findIndex((entry) => entry.id === selectedId);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIdx = currentIdx < filteredEntries.length - 1 ? currentIdx + 1 : 0;
        setSelectedId(filteredEntries[nextIdx].id);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : filteredEntries.length - 1;
        setSelectedId(filteredEntries[prevIdx].id);
        break;
      }
      case 'Enter': {
        if (currentIdx >= 0) {
          e.preventDefault();
          handleDoubleClick(filteredEntries[currentIdx]);
        }
        break;
      }
      case 'Backspace': {
        e.preventDefault();
        goUp();
        break;
      }
    }
  }, [filteredEntries, selectedId, handleDoubleClick, goUp]);

  return (
    <Box h="100%" style={{ display: 'flex', flexDirection: 'column' }} tabIndex={0} onKeyDown={handleKeyDown} ref={containerRef}>
      {/* Toolbar */}
      <Box px="sm" py={6} style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}>
        <Group justify="space-between">
          <Group gap={4}>
            <ActionIcon variant="subtle" size="sm" color="gray" disabled={historyIndex <= 0} onClick={goBack}><IconArrowLeft size={16} /></ActionIcon>
            <ActionIcon variant="subtle" size="sm" color="gray" disabled={historyIndex >= history.length - 1} onClick={goForward}><IconArrowRight size={16} /></ActionIcon>
            <ActionIcon variant="subtle" size="sm" color="gray" onClick={goUp}><IconArrowUp size={16} /></ActionIcon>
            <Divider orientation="vertical" mx={4} color="var(--mantine-color-default-border)" />
            {activeVolume && <PathBreadcrumb volumeLabel={activeVolume.label} currentPath={currentPath} rootPath={activeVolume.root_path} onNavigate={navigateTo} />}
          </Group>
          <Group gap={4}>
            {/* Tag filter chip */}
            {filterTagId != null && (
              <Badge size="sm" variant="light" rightSection={
                <ActionIcon variant="transparent" size="xs" onClick={() => setFilterTagId(null)}><IconX size={10} /></ActionIcon>
              }>
                <IconTag size={10} /> {allTags.find((t) => t.id === filterTagId)?.name ?? 'Tag'}
              </Badge>
            )}
            <TextInput
              placeholder="Filtrer…" size="xs" w={160}
              leftSection={<IconSearch size={14} />}
              value={searchQuery} onChange={(e) => setSearchQuery(e.currentTarget.value)}
              rightSection={searchQuery ? <ActionIcon variant="subtle" size="xs" onClick={() => setSearchQuery('')}><IconX size={12} /></ActionIcon> : null}
            />
            <Divider orientation="vertical" mx={4} color="var(--mantine-color-default-border)" />
            <SegmentedControl
              size="xs" value={viewMode} onChange={(v) => setViewMode(v as ViewMode)}
              data={[{ value: 'list', label: <IconList size={14} /> }, { value: 'grid', label: <IconGridDots size={14} /> }]}
              styles={{ root: { backgroundColor: 'var(--mantine-color-default)' } }}
            />
            <Tooltip label={showInspector ? 'Masquer détails' : 'Afficher détails'}>
              <ActionIcon variant={showInspector ? 'filled' : 'subtle'} size="sm" color={showInspector ? 'primary' : 'gray'} onClick={() => setShowInspector((v) => !v)}>
                <IconInfoCircle size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>

      {/* Status bar */}
      <Box px="sm" py={3} style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}>
        <Text size="xs" c="dimmed">
          {dirCount} dossiers, {fileCount} fichiers
          {hasMore && '+'}
          {' • '}{formatBytes(totalSize)}
          {selectedId != null && ' • 1 sélectionné'}
          {filterTagId != null && ' • filtré par tag'}
        </Text>
      </Box>

      {/* Content area */}
      <Box style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {loading ? (
          <Stack p="sm" gap={4} style={{ flex: 1 }}>{Array.from({ length: 20 }).map((_, i) => <Skeleton key={i} height={32} />)}</Stack>
        ) : filteredEntries.length === 0 ? (
          <Box ta="center" py={60} style={{ flex: 1 }}>
            <IconFolder size={40} stroke={1} style={{ color: 'var(--mantine-color-dimmed)', marginBottom: 8 }} />
            <Text size="sm" c="dimmed">{searchQuery || filterTagId != null ? 'Aucun résultat' : 'Dossier vide'}</Text>
            {searchQuery && (
              <Button variant="subtle" size="xs" mt="sm" onClick={() => setSearchQuery('')}>Effacer le filtre</Button>
            )}
            {filterTagId != null && (
              <Button variant="subtle" size="xs" mt="sm" onClick={() => setFilterTagId(null)}>Retirer le filtre tag</Button>
            )}
            {!searchQuery && filterTagId == null && activeVolume && (
              <Button variant="subtle" size="xs" mt="sm" onClick={goUp}>Remonter d'un niveau</Button>
            )}
          </Box>
        ) : viewMode === 'list' ? (
          <VirtualizedList
            entries={filteredEntries}
            selectedId={selectedId}
            entryTagsMap={entryTagsMap}
            allTags={allTags}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
            onSelect={setSelectedId}
            onDoubleClick={handleDoubleClick}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
        ) : (
          <ScrollArea
            style={{ flex: 1 }}
            type="auto"
            viewportRef={gridViewportRef}
            onScrollPositionChange={handleGridScroll}
          >
            <Group gap="xs" p="md" align="flex-start" style={{ flexWrap: 'wrap' }}>
              {filteredEntries.map((entry) => (
                <GridCard key={entry.id} entry={entry} selected={selectedId === entry.id}
                  onClick={() => setSelectedId(entry.id)} onDoubleClick={() => handleDoubleClick(entry)} />
              ))}
            </Group>
            {hasMore && !loading && (
              <Box ta="center" py="sm">
                <Button variant="subtle" size="xs" onClick={loadMore} loading={loadingMore}>
                  Charger plus de fichiers…
                </Button>
              </Box>
            )}
          </ScrollArea>
        )}

        {/* Inspector */}
        {showInspector && (
          <Box w={280} style={{ borderLeft: '1px solid var(--mantine-color-default-border)', flexShrink: 0, backgroundColor: 'var(--mantine-color-body)' }}>
            <InspectorPanel
              entry={selectedEntry}
              entryTags={selectedEntryTags}
              allTags={allTags}
              onClose={() => setShowInspector(false)}
              onAddTag={handleAddTag}
              onTagFilter={(id) => setFilterTagId(id)}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
