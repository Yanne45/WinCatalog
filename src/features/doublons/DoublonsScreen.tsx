// ============================================================================
// WinCatalog — features/doublons/DoublonsScreen.tsx
// Duplicate detection: 3-column layout, compare, dry-run, trash
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Group, Stack, Text, Paper, Button, Badge, Checkbox,
  ScrollArea, Skeleton, Divider, ActionIcon, Tooltip, Alert,
  Select, NumberInput, Progress,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconCopy, IconTrash, IconCheck, IconRefresh, IconChevronRight,
  IconFile, IconFolder, IconAlertTriangle, IconArrowRight,
} from '@tabler/icons-react';
import {
  duplicateApi, trashApi, formatBytes, formatDate,
  type Entry, type FileKind,
} from '../../api/tauri';
import { FILE_KIND_COLORS } from '../../app/theme';

// ============================================================================
// Types
// ============================================================================

interface DuplicateGroup {
  hash: string;
  count: number;
  totalBytes: number;
  reclaimable: number;
  entries: Entry[];
  kept: Set<number>;    // entry IDs to keep
  resolved: boolean;
}

type SortMode = 'size' | 'count' | 'name';

// ============================================================================
// Group list item (left column)
// ============================================================================

function GroupListItem({
  group, active, onClick,
}: {
  group: DuplicateGroup;
  active: boolean;
  onClick: () => void;
}) {
  const firstName = group.entries[0]?.name ?? '?';
  const kind = group.entries[0]?.kind ?? 'other';
  const info = FILE_KIND_COLORS[kind as keyof typeof FILE_KIND_COLORS] ?? FILE_KIND_COLORS.other;

  return (
    <Paper
      p="sm"
      onClick={onClick}
      className="wc-hoverable"
      data-active={active || undefined}
      style={{
        cursor: 'pointer',
        backgroundColor: active ? 'var(--mantine-color-primary-light)' : 'transparent',
        borderLeft: active ? '3px solid var(--mantine-color-primary-5)' : '3px solid transparent',
      }}
    >
      <Group justify="space-between" gap="xs">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500} lineClamp={1}>{firstName}</Text>
          <Group gap={6} mt={2}>
            <Badge size="xs" style={{ backgroundColor: `${info.color}18`, color: info.color, border: 'none' }}>
              {info.icon} {kind}
            </Badge>
            <Text size="xs" c="dimmed">{group.count} fichiers</Text>
          </Group>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <Text size="xs" fw={600}>{formatBytes(group.reclaimable)}</Text>
          <Text size="xs" c="dimmed">récupérable</Text>
        </div>
      </Group>
      {group.resolved && (
        <Badge size="xs" color="green" variant="light" mt={4} leftSection={<IconCheck size={10} />}>
          Traité
        </Badge>
      )}
    </Paper>
  );
}

// ============================================================================
// File comparison card (center)
// ============================================================================

function FileCard({
  entry, kept, onToggle,
}: {
  entry: Entry;
  kept: boolean;
  onToggle: () => void;
}) {
  const info = FILE_KIND_COLORS[entry.kind as keyof typeof FILE_KIND_COLORS] ?? FILE_KIND_COLORS.other;

  return (
    <Paper
      p="md"
      withBorder
      style={{
        borderColor: kept ? 'var(--mantine-color-green-7)' : 'var(--mantine-color-default-border)',
        backgroundColor: kept ? 'var(--mantine-color-green-light)' : 'transparent',
        opacity: kept ? 1 : 0.75,
        transition: 'all 120ms ease-out',
      }}
    >
      <Group justify="space-between" mb="sm">
        <Checkbox
          checked={kept}
          onChange={onToggle}
          label={kept ? 'Garder' : 'Supprimer'}
          size="sm"
          color={kept ? 'green' : 'red'}
        />
        <Badge size="xs" color={kept ? 'green' : 'red'} variant="light">
          {kept ? 'CONSERVER' : 'SUPPRIMER'}
        </Badge>
      </Group>

      {/* Thumbnail placeholder */}
      <Box
        h={80} mb="sm"
        style={{
          borderRadius: 'var(--mantine-radius-sm)',
          backgroundColor: 'var(--mantine-color-default)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text size="xl">{info.icon}</Text>
      </Box>

      <Text size="sm" fw={500} lineClamp={2} mb="xs">{entry.name}</Text>

      <Stack gap={4}>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Chemin</Text>
          <Text size="xs" fw={400} lineClamp={1} maw={200} ta="right">{entry.path}</Text>
        </Group>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Taille</Text>
          <Text size="xs" fw={500}>{formatBytes(entry.size_bytes)}</Text>
        </Group>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Modifié</Text>
          <Text size="xs" fw={500}>{formatDate(entry.mtime)}</Text>
        </Group>
        {entry.full_hash && (
          <Group justify="space-between">
            <Text size="xs" c="dimmed">Hash</Text>
            <Text size="xs" ff="monospace" c="dimmed">{entry.full_hash.slice(0, 12)}…</Text>
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

// ============================================================================
// Group detail panel (right column)
// ============================================================================

function GroupDetail({
  group, onAutoSelect, onApply, applying,
}: {
  group: DuplicateGroup;
  onAutoSelect: () => void;
  onApply: () => void;
  applying: boolean;
}) {
  const toDelete = group.entries.filter((e) => !group.kept.has(e.id));
  const toKeep = group.entries.filter((e) => group.kept.has(e.id));
  const reclaimBytes = toDelete.reduce((s, e) => s + e.size_bytes, 0);

  return (
    <ScrollArea h="100%" type="auto">
      <Stack p="md" gap="md">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Résumé du groupe</Text>

        <Paper p="sm" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
          <Stack gap={6}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Fichiers identiques</Text>
              <Text size="xs" fw={600}>{group.count}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Taille unitaire</Text>
              <Text size="xs" fw={500}>{formatBytes(group.entries[0]?.size_bytes ?? 0)}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Taille totale</Text>
              <Text size="xs" fw={500}>{formatBytes(group.totalBytes)}</Text>
            </Group>
            <Divider color="var(--mantine-color-default-border)" />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">À conserver</Text>
              <Text size="xs" fw={600} c="green">{toKeep.length}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">À supprimer</Text>
              <Text size="xs" fw={600} c="red">{toDelete.length}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" fw={600}>Espace récupéré</Text>
              <Text size="xs" fw={700} c="green">{formatBytes(reclaimBytes)}</Text>
            </Group>
          </Stack>
        </Paper>

        <Button
          variant="light"
          size="xs"
          fullWidth
          onClick={onAutoSelect}
        >
          Auto-sélection (garder le plus récent)
        </Button>

        {toDelete.length > 0 && (
          <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={16} />} p="sm">
            <Text size="xs">
              {toDelete.length} fichier{toDelete.length > 1 ? 's' : ''} ser{toDelete.length > 1 ? 'ont' : 'a'} déplacé{toDelete.length > 1 ? 's' : ''} dans
              la corbeille. Restauration possible pendant 30 jours.
            </Text>
          </Alert>
        )}

        <Button
          color="red"
          variant="light"
          size="sm"
          fullWidth
          leftSection={<IconTrash size={14} />}
          disabled={toDelete.length === 0 || applying}
          loading={applying}
          onClick={onApply}
        >
          Supprimer {toDelete.length} fichier{toDelete.length > 1 ? 's' : ''} → Corbeille
        </Button>
      </Stack>
    </ScrollArea>
  );
}

// ============================================================================
// Empty / Loading states
// ============================================================================

function EmptyState({ onNavigate }: { onNavigate?: (screen: string, ctx?: any) => void }) {
  return (
    <Box ta="center" py={80}>
      <IconCopy size={48} stroke={1} style={{ color: 'var(--mantine-color-dimmed)', marginBottom: 16 }} />
      <Text size="lg" fw={600} mb="xs">Aucun doublon détecté</Text>
      <Text size="sm" c="dimmed" mb="md">
        Lancez un scan avec hash activé pour détecter les fichiers en double.
      </Text>
      {onNavigate && (
        <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={() => onNavigate('scan')}>
          Lancer un scan
        </Button>
      )}
    </Box>
  );
}

// ============================================================================
// Doublons Screen
// ============================================================================

export default function DoublonsScreen({ onNavigate }: { onNavigate?: (screen: string, ctx?: any) => void }) {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGroupIdx, setActiveGroupIdx] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>('size');
  const [minSize, setMinSize] = useState<number>(0);
  const [applying, setApplying] = useState(false);

  // Load duplicate groups — parallel batches of 10 for fast loading
  const loadDuplicates = useCallback(async () => {
    try {
      setLoading(true);
      const raw = await duplicateApi.find(minSize);

      // Load entries in parallel batches of 10
      const BATCH = 10;
      const loaded: DuplicateGroup[] = [];
      for (let i = 0; i < raw.length; i += BATCH) {
        const chunk = raw.slice(i, i + BATCH);
        const results = await Promise.all(
          chunk.map(async ([hash, count, totalBytes]) => {
            const entries = await duplicateApi.getGroup(hash);
            return { hash, count, totalBytes, entries };
          })
        );
        for (const { hash, count, totalBytes, entries } of results) {
          if (entries.length < 2) continue;
          const sorted = [...entries].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
          const kept = new Set<number>([sorted[0].id]);
          // reclaimable = total − taille d'une copie conservée (sorted[0], le plus récent)
          const keptSize = sorted[0]?.size_bytes ?? 0;
          loaded.push({
            hash, count: entries.length, totalBytes,
            reclaimable: totalBytes - keptSize,
            entries, kept, resolved: false,
          });
        }
      }

      setGroups(loaded);
      setActiveGroupIdx(0);
    } catch (err) {
      console.error('Failed to load duplicates:', err);
    } finally {
      setLoading(false);
    }
  }, [minSize]);

  useEffect(() => { loadDuplicates(); }, [loadDuplicates]);

  // Sort groups
  const sortedGroups = useMemo(() => {
    const sorted = [...groups];
    switch (sortMode) {
      case 'size': sorted.sort((a, b) => b.reclaimable - a.reclaimable); break;
      case 'count': sorted.sort((a, b) => b.count - a.count); break;
      case 'name': sorted.sort((a, b) => (a.entries[0]?.name ?? '').localeCompare(b.entries[0]?.name ?? '')); break;
    }
    return sorted;
  }, [groups, sortMode]);

  const activeGroup = sortedGroups[activeGroupIdx] ?? null;

  // Toggle keep/delete for an entry
  const toggleKept = useCallback((entryId: number) => {
    if (!activeGroup) return;
    const hash = activeGroup.hash;
    setGroups((prev) => prev.map((g) => {
      if (g.hash !== hash) return g;
      const newKept = new Set(g.kept);
      if (newKept.has(entryId)) {
        // Don't allow un-keeping the last one
        if (newKept.size <= 1) return g;
        newKept.delete(entryId);
      } else {
        newKept.add(entryId);
      }
      return { ...g, kept: newKept };
    }));
  }, [activeGroup]);

  // Auto-select: keep most recent
  const autoSelect = useCallback(() => {
    if (!activeGroup) return;
    const hash = activeGroup.hash;
    setGroups((prev) => prev.map((g) => {
      if (g.hash !== hash) return g;
      const sorted = [...g.entries].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
      return { ...g, kept: new Set([sorted[0].id]) };
    }));
  }, [activeGroup]);

  // Apply: send to trash
  const applyDeletion = useCallback(() => {
    if (!activeGroup) return;
    const toDelete = activeGroup.entries.filter((e) => !activeGroup.kept.has(e.id));
    if (toDelete.length === 0) return;
    const { hash } = activeGroup;
    modals.openConfirmModal({
      title: 'Envoyer à la corbeille',
      children: (
        <Text size="sm">
          Envoyer {toDelete.length} fichier{toDelete.length > 1 ? 's' : ''} à la corbeille ?
        </Text>
      ),
      labels: { confirm: 'Envoyer', cancel: 'Annuler' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        setApplying(true);
        try {
          for (const entry of toDelete) {
            await trashApi.trash(entry.id, 'duplicate');
          }
          setGroups((prev) => prev.map((g) =>
            g.hash === hash ? { ...g, resolved: true } : g
          ));
          const nextIdx = sortedGroups.findIndex((g, i) => i > activeGroupIdx && !g.resolved);
          if (nextIdx >= 0) setActiveGroupIdx(nextIdx);
        } catch (err) {
          console.error('Trash failed:', err);
        } finally {
          setApplying(false);
        }
      },
    });
  }, [activeGroup, activeGroupIdx, sortedGroups]);

  // Summary stats
  const totalGroups = groups.length;
  const totalReclaimable = groups.reduce((s, g) => s + g.reclaimable, 0);
  const resolvedCount = groups.filter((g) => g.resolved).length;

  if (loading) {
    return (
      <Box p="lg">
        <Skeleton height={32} width={200} mb="lg" />
        <Group gap="md">
          <Skeleton height={400} w={300} />
          <Skeleton height={400} style={{ flex: 1 }} />
          <Skeleton height={400} w={280} />
        </Group>
      </Box>
    );
  }

  if (totalGroups === 0) {
    return (
      <Box p="lg">
        <Group justify="space-between" mb="lg">
          <Text size="lg" fw={700}>Doublons</Text>
          <Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={loadDuplicates}>
            Actualiser
          </Button>
        </Group>
        <EmptyState onNavigate={onNavigate} />
      </Box>
    );
  }

  return (
    <Box h="100%" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box px="lg" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}>
        <Group justify="space-between">
          <Group gap="md">
            <Text size="lg" fw={700}>Doublons</Text>
            <Badge size="md" variant="light" color="yellow">
              {totalGroups} groupe{totalGroups > 1 ? 's' : ''} • {formatBytes(totalReclaimable)} récupérables
            </Badge>
            {resolvedCount > 0 && (
              <Badge size="md" variant="light" color="green">
                {resolvedCount}/{totalGroups} traités
              </Badge>
            )}
          </Group>
          <Group gap="sm">
            <Select
              size="xs" w={140}
              value={sortMode}
              onChange={(v) => setSortMode((v as SortMode) || 'size')}
              data={[
                { value: 'size', label: 'Par taille' },
                { value: 'count', label: 'Par nombre' },
                { value: 'name', label: 'Par nom' },
              ]}
            />
            <Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={loadDuplicates}>
              Actualiser
            </Button>
          </Group>
        </Group>
      </Box>

      {/* 3-column layout */}
      <Box style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: group list */}
        <ScrollArea w={300} style={{ borderRight: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }} type="auto">
          <Stack gap={0} p="xs">
            {sortedGroups.map((group, idx) => (
              <GroupListItem
                key={group.hash}
                group={group}
                active={idx === activeGroupIdx}
                onClick={() => setActiveGroupIdx(idx)}
              />
            ))}
          </Stack>
        </ScrollArea>

        {/* Center: comparison cards */}
        <ScrollArea style={{ flex: 1 }} type="auto">
          {activeGroup ? (
            <Box p="md">
              <Text size="sm" fw={600} c="dimmed" mb="sm">
                Comparer {activeGroup.count} copies identiques
              </Text>
              <Group gap="md" align="stretch" style={{ flexWrap: 'wrap' }}>
                {activeGroup.entries.map((entry) => (
                  <Box key={entry.id} w={280}>
                    <FileCard
                      entry={entry}
                      kept={activeGroup.kept.has(entry.id)}
                      onToggle={() => toggleKept(entry.id)}
                    />
                  </Box>
                ))}
              </Group>
            </Box>
          ) : (
            <Box ta="center" py={60}>
              <Text size="sm" c="dimmed">Sélectionnez un groupe à gauche</Text>
            </Box>
          )}
        </ScrollArea>

        {/* Right: detail panel */}
        {activeGroup && (
          <Box w={280} style={{ borderLeft: '1px solid var(--mantine-color-default-border)', flexShrink: 0, backgroundColor: 'var(--mantine-color-body)' }}>
            <GroupDetail
              group={activeGroup}
              onAutoSelect={autoSelect}
              onApply={applyDeletion}
              applying={applying}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
