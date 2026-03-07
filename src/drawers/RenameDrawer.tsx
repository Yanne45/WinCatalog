// ============================================================================
// WinCatalog — drawers/RenameDrawer.tsx
// Batch rename: pattern editor, token reference, live preview, apply
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Drawer, Group, Stack, Text, Paper, Button, TextInput, Badge,
  Divider, ScrollArea, Alert, Table, Tooltip,
} from '@mantine/core';
import {
  IconEdit, IconCheck, IconAlertTriangle, IconRefresh,
} from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// Types (matching Rust)
// ============================================================================

interface RenamePreview {
  entry_id: number;
  old_name: string;
  new_name: string;
  old_path: string;
  new_path: string;
  conflict: boolean;
}

interface RenameStats {
  renamed: number;
  skipped: number;
  errors: number;
}

// ============================================================================
// Token reference
// ============================================================================

const TOKENS = [
  { token: '{name}', description: 'Nom original (sans ext)' },
  { token: '{ext}', description: 'Extension' },
  { token: '{date:YYYY-MM-DD}', description: 'Date fichier (format libre)' },
  { token: '{counter:3}', description: 'Compteur séquentiel (3 chiffres)' },
  { token: '{parent}', description: 'Nom du dossier parent' },
  { token: '{kind}', description: 'Type de fichier' },
];

// ============================================================================
// Rename Drawer
// ============================================================================

export interface RenameDrawerProps {
  opened: boolean;
  onClose: () => void;
  /** IDs of selected entries to rename */
  entryIds: number[];
  /** Volume ID for scan_log journaling */
  volumeId: number;
}

export default function RenameDrawer({ opened, onClose, entryIds, volumeId }: RenameDrawerProps) {
  const [pattern, setPattern] = useState('{name}');
  const [previews, setPreviews] = useState<RenamePreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<RenameStats | null>(null);

  // Generate preview when pattern changes
  useEffect(() => {
    if (!opened || entryIds.length === 0) return;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const p = await invoke<RenamePreview[]>('preview_rename', { entryIds, pattern });
        setPreviews(p);
      } catch (e) {
        console.error('Preview failed:', e);
        setPreviews([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [opened, entryIds, pattern]);

  // Reset on open
  useEffect(() => {
    if (opened) { setResult(null); setPattern('{name}'); }
  }, [opened]);

  const conflicts = previews.filter((p) => p.conflict);
  const changes = previews.filter((p) => p.old_name !== p.new_name && !p.conflict);

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      const stats = await invoke<RenameStats>('apply_rename', { previews, volumeId });
      setResult(stats);
    } catch (e) {
      console.error('Rename failed:', e);
    } finally {
      setApplying(false);
    }
  }, [previews, volumeId]);

  const insertToken = useCallback((token: string) => {
    setPattern((prev) => prev + token);
  }, []);

  return (
    <Drawer opened={opened} onClose={onClose} title="Renommer par lot" position="right" size="lg"
      styles={{ content: { backgroundColor: 'var(--mantine-color-dark-7)' }, header: { backgroundColor: 'var(--mantine-color-dark-7)' } }}>
      <ScrollArea h="calc(100vh - 80px)" type="auto">
        <Stack gap="md">
          {/* Result */}
          {result && (
            <Alert icon={<IconCheck size={16} />} color="green" variant="light">
              {result.renamed} renommé{result.renamed > 1 ? 's' : ''}, {result.skipped} ignoré{result.skipped > 1 ? 's' : ''}, {result.errors} erreur{result.errors > 1 ? 's' : ''}
            </Alert>
          )}

          {/* Pattern input */}
          <div>
            <Text size="sm" fw={600} mb="xs">Pattern de renommage</Text>
            <TextInput
              size="sm"
              value={pattern}
              onChange={(e) => setPattern(e.currentTarget.value)}
              placeholder="{date:YYYY-MM-DD}_{name}"
              rightSection={loading ? <Text size="xs" c="dimmed">…</Text> : null}
            />
          </div>

          {/* Token buttons */}
          <div>
            <Text size="xs" c="dimmed" mb={4}>Tokens disponibles :</Text>
            <Group gap={4}>
              {TOKENS.map((t) => (
                <Tooltip key={t.token} label={t.description}>
                  <Badge size="sm" variant="outline" color="gray" style={{ cursor: 'pointer' }}
                    onClick={() => insertToken(t.token)}>
                    {t.token}
                  </Badge>
                </Tooltip>
              ))}
            </Group>
          </div>

          <Divider color="var(--mantine-color-dark-5)" />

          {/* Summary */}
          <Group gap="md">
            <Text size="sm" fw={500}>{entryIds.length} fichier{entryIds.length > 1 ? 's' : ''} sélectionné{entryIds.length > 1 ? 's' : ''}</Text>
            <Badge color="green" variant="light">{changes.length} changement{changes.length > 1 ? 's' : ''}</Badge>
            {conflicts.length > 0 && (
              <Badge color="red" variant="light">{conflicts.length} conflit{conflicts.length > 1 ? 's' : ''}</Badge>
            )}
          </Group>

          {conflicts.length > 0 && (
            <Alert icon={<IconAlertTriangle size={14} />} color="yellow" variant="light" p="xs">
              <Text size="xs">{conflicts.length} nom{conflicts.length > 1 ? 's' : ''} en conflit (sera ignoré)</Text>
            </Alert>
          )}

          {/* Preview table */}
          <Paper withBorder style={{ borderColor: 'var(--mantine-color-dark-5)', overflow: 'hidden' }}>
            <Table.ScrollContainer minWidth={400}>
              <Table striped={false} highlightOnHover withColumnBorders={false}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th><Text size="xs">Ancien nom</Text></Table.Th>
                    <Table.Th><Text size="xs">→</Text></Table.Th>
                    <Table.Th><Text size="xs">Nouveau nom</Text></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {previews.slice(0, 50).map((p) => (
                    <Table.Tr key={p.entry_id} style={{
                      opacity: p.conflict ? 0.5 : 1,
                      backgroundColor: p.conflict ? 'var(--mantine-color-red-9)' : undefined,
                    }}>
                      <Table.Td><Text size="xs" lineClamp={1}>{p.old_name}</Text></Table.Td>
                      <Table.Td><Text size="xs" c="dimmed">→</Text></Table.Td>
                      <Table.Td>
                        <Text size="xs" fw={p.old_name !== p.new_name ? 500 : 400}
                          c={p.conflict ? 'red' : p.old_name !== p.new_name ? undefined : 'dimmed'}
                          lineClamp={1}>
                          {p.new_name}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {previews.length > 50 && (
                    <Table.Tr>
                      <Table.Td colSpan={3}><Text size="xs" c="dimmed" ta="center">+{previews.length - 50} autres…</Text></Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>

          <Divider color="var(--mantine-color-dark-5)" />

          {/* Apply */}
          <Button
            leftSection={<IconEdit size={14} />}
            onClick={handleApply}
            loading={applying}
            disabled={changes.length === 0}
            fullWidth
          >
            Renommer {changes.length} fichier{changes.length > 1 ? 's' : ''}
          </Button>
        </Stack>
      </ScrollArea>
    </Drawer>
  );
}
