// ============================================================================
// WinCatalog — drawers/FiltersDrawer.tsx
// Advanced filters: kind, size, date, tags, custom fields — combined
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Drawer, Group, Stack, Text, Button, Select, MultiSelect,
  NumberInput, Checkbox, Divider, Badge, ActionIcon, Chip,
} from '@mantine/core';
import {
  IconFilter, IconX, IconCheck, IconRefresh,
} from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { type FileKind, type Tag } from '../api/tauri';
import { FILE_KIND_COLORS } from '../app/theme';

// ============================================================================
// Filter model
// ============================================================================

export interface AdvancedFilters {
  kinds: FileKind[];
  sizeMin: number | null;    // bytes
  sizeMax: number | null;    // bytes
  dateAfter: string | null;  // ISO string (for DateInput later)
  dateBefore: string | null;
  tagIds: number[];
  hasHash: boolean | null;
  status: string | null;
}

export const EMPTY_FILTERS: AdvancedFilters = {
  kinds: [], sizeMin: null, sizeMax: null,
  dateAfter: null, dateBefore: null,
  tagIds: [], hasHash: null, status: null,
};

export function isFiltersActive(f: AdvancedFilters): boolean {
  return f.kinds.length > 0 || f.sizeMin != null || f.sizeMax != null ||
    f.dateAfter != null || f.dateBefore != null || f.tagIds.length > 0 ||
    f.hasHash != null || f.status != null;
}

// ============================================================================
// Size presets
// ============================================================================

const SIZE_PRESETS = [
  { label: '> 100 Mo', min: 100 * 1024 * 1024 },
  { label: '> 1 Go', min: 1024 * 1024 * 1024 },
  { label: '> 4 Go', min: 4 * 1024 * 1024 * 1024 },
  { label: '< 1 Ko', max: 1024 },
  { label: '< 100 Ko', max: 100 * 1024 },
];

// ============================================================================
// Filters Drawer
// ============================================================================

export interface FiltersDrawerProps {
  opened: boolean;
  onClose: () => void;
  filters: AdvancedFilters;
  onApply: (filters: AdvancedFilters) => void;
}

export default function FiltersDrawer({ opened, onClose, filters, onApply }: FiltersDrawerProps) {
  const [local, setLocal] = useState<AdvancedFilters>(filters);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  // Sync on open
  useEffect(() => {
    if (opened) {
      setLocal(filters);
      invoke<Tag[]>('list_tags').then(setAllTags).catch(() => {});
    }
  }, [opened, filters]);

  const update = <K extends keyof AdvancedFilters>(key: K, value: AdvancedFilters[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const handleApply = useCallback(() => {
    onApply(local);
    onClose();
  }, [local, onApply, onClose]);

  const handleReset = useCallback(() => {
    setLocal(EMPTY_FILTERS);
  }, []);

  const activeCount = [
    local.kinds.length > 0,
    local.sizeMin != null || local.sizeMax != null,
    local.dateAfter != null || local.dateBefore != null,
    local.tagIds.length > 0,
    local.hasHash != null,
    local.status != null,
  ].filter(Boolean).length;

  const kindOptions: FileKind[] = ['image', 'video', 'audio', 'document', 'archive', 'ebook', 'text', 'font', 'other'];
  const tagOptions = allTags.map((t) => ({ value: String(t.id), label: t.name }));

  return (
    <Drawer opened={opened} onClose={onClose} title={
      <Group gap="sm"><IconFilter size={18} /><Text fw={600}>Filtres avancés</Text>
        {activeCount > 0 && <Badge size="sm" color="primary">{activeCount}</Badge>}
      </Group>
    } position="right" size="sm"
      styles={{ content: { backgroundColor: 'var(--mantine-color-body)' }, header: { backgroundColor: 'var(--mantine-color-body)' } }}>
      <Stack gap="md">
        {/* Kind filter */}
        <div>
          <Text size="xs" fw={600} c="dimmed" mb={6}>Type de fichier</Text>
          <Group gap={4}>
            {kindOptions.map((k) => {
              const info = FILE_KIND_COLORS[k] ?? FILE_KIND_COLORS.other;
              const active = local.kinds.includes(k);
              return (
                <Badge key={k} size="sm"
                  variant={active ? 'filled' : 'outline'}
                  color={active ? undefined : 'gray'}
                  style={{ cursor: 'pointer', backgroundColor: active ? `${info.color}30` : undefined, color: active ? info.color : undefined, borderColor: active ? info.color : undefined }}
                  onClick={() => update('kinds', active ? local.kinds.filter((x) => x !== k) : [...local.kinds, k])}>
                  {info.icon} {k}
                </Badge>
              );
            })}
          </Group>
        </div>

        <Divider color="var(--mantine-color-default-border)" />

        {/* Size filter */}
        <div>
          <Text size="xs" fw={600} c="dimmed" mb={6}>Taille</Text>
          <Group gap="sm" mb="xs">
            <NumberInput size="xs" label="Min (Mo)" w={120}
              value={local.sizeMin != null ? Math.round(local.sizeMin / (1024 * 1024)) : ''}
              onChange={(v) => update('sizeMin', typeof v === 'number' ? v * 1024 * 1024 : null)}
              min={0} />
            <NumberInput size="xs" label="Max (Mo)" w={120}
              value={local.sizeMax != null ? Math.round(local.sizeMax / (1024 * 1024)) : ''}
              onChange={(v) => update('sizeMax', typeof v === 'number' ? v * 1024 * 1024 : null)}
              min={0} />
          </Group>
          <Group gap={4}>
            {SIZE_PRESETS.map((p) => (
              <Badge key={p.label} size="xs" variant="outline" color="gray" style={{ cursor: 'pointer' }}
                onClick={() => { if (p.min) update('sizeMin', p.min); if (p.max) update('sizeMax', p.max); }}>
                {p.label}
              </Badge>
            ))}
          </Group>
        </div>

        <Divider color="var(--mantine-color-default-border)" />

        {/* Tags */}
        {allTags.length > 0 && (
          <div>
            <Text size="xs" fw={600} c="dimmed" mb={6}>Tags</Text>
            <MultiSelect size="xs" data={tagOptions} placeholder="Filtrer par tags"
              value={local.tagIds.map(String)}
              onChange={(v) => update('tagIds', v.map(Number))} />
          </div>
        )}

        <Divider color="var(--mantine-color-default-border)" />

        {/* Status */}
        <div>
          <Text size="xs" fw={600} c="dimmed" mb={6}>Statut</Text>
          <Select size="xs" placeholder="Tous" clearable
            value={local.status} onChange={(v) => update('status', v)}
            data={[
              { value: 'present', label: 'Présent' },
              { value: 'missing', label: 'Manquant' },
              { value: 'deleted', label: 'Supprimé' },
            ]} />
        </div>

        {/* Hash filter */}
        <Checkbox size="xs" label="Uniquement les fichiers avec hash"
          indeterminate={local.hasHash === null}
          checked={local.hasHash === true}
          onChange={() => update('hasHash', local.hasHash === true ? null : true)} />

        <Divider color="var(--mantine-color-default-border)" />

        {/* Actions */}
        <Group gap="sm">
          <Button variant="subtle" size="sm" leftSection={<IconRefresh size={14} />}
            onClick={handleReset} disabled={!isFiltersActive(local)}>
            Réinitialiser
          </Button>
          <Button size="sm" leftSection={<IconCheck size={14} />}
            onClick={handleApply} style={{ flex: 1 }}>
            Appliquer {activeCount > 0 ? `(${activeCount})` : ''}
          </Button>
        </Group>
      </Stack>
    </Drawer>
  );
}
