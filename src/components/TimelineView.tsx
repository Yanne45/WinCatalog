// ============================================================================
// WinCatalog — components/TimelineView.tsx
// Temporal timeline: vertical axis, entries grouped by year → month → day
// ============================================================================

import { useMemo } from 'react';
import {
  Box, Group, Stack, Text, Badge, UnstyledButton, SimpleGrid,
} from '@mantine/core';
import { IconFolder, IconCalendar } from '@tabler/icons-react';
import { formatBytes, type EntrySlim, type FileKind } from '../api/tauri';
import { FILE_KIND_COLORS } from '../app/theme';

// ============================================================================
// Types
// ============================================================================

interface TimelineGroup {
  label: string;       // "Mars 2024", "15 mars 2024"
  yearMonth: string;   // "2024-03" for sorting
  entries: EntrySlim[];
  totalSize: number;
}

// ============================================================================
// Grouping logic
// ============================================================================

function groupByMonth(entries: EntrySlim[]): TimelineGroup[] {
  const map = new Map<string, EntrySlim[]>();

  for (const e of entries) {
    if (e.is_dir || !e.mtime) continue;
    const d = new Date(e.mtime * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }

  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // newest first
    .map(([key, items]) => {
      const [y, m] = key.split('-').map(Number);
      return {
        label: `${months[m - 1]} ${y}`,
        yearMonth: key,
        entries: items.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0)),
        totalSize: items.reduce((s, e) => s + e.size_bytes, 0),
      };
    });
}

// ============================================================================
// Thumbnail card (mini)
// ============================================================================

function MiniCard({
  entry, selected, onClick, onDoubleClick,
}: {
  entry: EntrySlim; selected: boolean;
  onClick: () => void; onDoubleClick: () => void;
}) {
  const info = FILE_KIND_COLORS[entry.kind as keyof typeof FILE_KIND_COLORS] ?? FILE_KIND_COLORS.other;

  return (
    <UnstyledButton
      onClick={onClick} onDoubleClick={onDoubleClick}
      className="wc-hoverable"
      data-active={selected || undefined}
      style={{
        width: 90, display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 4, padding: 6, borderRadius: 'var(--mantine-radius-sm)',
        backgroundColor: selected ? 'var(--mantine-color-primary-light)' : 'transparent',
        border: `1px solid ${selected ? 'var(--mantine-color-primary-7)' : 'transparent'}`,
      }}
    >
      <Box w={56} h={56} style={{
        borderRadius: 'var(--mantine-radius-xs)',
        backgroundColor: 'var(--mantine-color-default)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Text size="lg">{info.icon}</Text>
      </Box>
      <Text size="xs" ta="center" lineClamp={1} w={80}>{entry.name}</Text>
    </UnstyledButton>
  );
}

// ============================================================================
// Timeline group
// ============================================================================

function TimelineGroupRow({
  group, selectedId, onSelect, onDoubleClick,
}: {
  group: TimelineGroup; selectedId: number | null;
  onSelect: (id: number) => void; onDoubleClick: (entry: EntrySlim) => void;
}) {
  return (
    <Box mb="lg">
      {/* Group header */}
      <Group gap="sm" mb="sm" px="sm">
        <Box w={3} h={24} style={{ borderRadius: 2, backgroundColor: 'var(--mantine-color-primary-6)' }} />
        <IconCalendar size={16} style={{ color: 'var(--mantine-color-primary-5)' }} />
        <Text size="sm" fw={600} tt="capitalize">{group.label}</Text>
        <Badge size="xs" variant="light" color="gray">
          {group.entries.length} fichier{group.entries.length > 1 ? 's' : ''} • {formatBytes(group.totalSize)}
        </Badge>
      </Group>

      {/* Entries grid */}
      <Box px="sm" pl={28}> {/* indent to align with the timeline bar */}
        <Group gap={6} style={{ flexWrap: 'wrap' }}>
          {group.entries.slice(0, 40).map((entry) => (
            <MiniCard
              key={entry.id}
              entry={entry}
              selected={selectedId === entry.id}
              onClick={() => onSelect(entry.id)}
              onDoubleClick={() => onDoubleClick(entry)}
            />
          ))}
          {group.entries.length > 40 && (
            <Text size="xs" c="dimmed" py="sm">+{group.entries.length - 40} autres</Text>
          )}
        </Group>
      </Box>
    </Box>
  );
}

// ============================================================================
// Timeline View
// ============================================================================

export interface TimelineViewProps {
  entries: EntrySlim[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDoubleClick: (entry: EntrySlim) => void;
}

export default function TimelineView({ entries, selectedId, onSelect, onDoubleClick }: TimelineViewProps) {
  const groups = useMemo(() => groupByMonth(entries), [entries]);

  if (groups.length === 0) {
    return (
      <Box ta="center" py={60}>
        <IconCalendar size={40} stroke={1} style={{ color: 'var(--mantine-color-dimmed)', marginBottom: 8 }} />
        <Text size="sm" c="dimmed">Aucun fichier avec date de modification</Text>
      </Box>
    );
  }

  return (
    <Box py="sm" style={{ position: 'relative' }}>
      {/* Vertical timeline bar */}
      <Box style={{
        position: 'absolute', left: 18, top: 0, bottom: 0, width: 2,
        backgroundColor: 'var(--mantine-color-default-border)',
      }} />

      {groups.map((group) => (
        <TimelineGroupRow
          key={group.yearMonth}
          group={group}
          selectedId={selectedId}
          onSelect={onSelect}
          onDoubleClick={onDoubleClick}
        />
      ))}
    </Box>
  );
}
