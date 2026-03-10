// ============================================================================
// WinCatalog — features/tags/TagsScreen.tsx
// Tags & Collections: CRUD tags, manual/smart collections, auto rules
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Group, Stack, Text, Paper, Tabs, Button, Badge, TextInput,
  ColorInput, ActionIcon, Modal, Checkbox, Select, NumberInput,
  ScrollArea, Divider, Tooltip, Alert,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import {
  IconTag, IconFolder, IconPlus, IconTrash, IconEdit,
  IconBolt, IconCheck, IconX, IconRefresh,
} from '@tabler/icons-react';
import {
  tagApi, type Tag,
} from '../../api/tauri';

// We'll invoke directly for collections/rules since we haven't added those to tauri.ts yet
import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// Types (matching Rust structs)
// ============================================================================

interface Collection {
  id: number; name: string; description: string | null;
  icon: string | null; color: string | null;
  is_smart: boolean; smart_query: string | null;
  sort_order: string; created_at: number;
}

interface AutoRule {
  id: string; name: string; enabled: boolean;
  conditions: Condition[]; actions: Action[];
}

interface Condition { type: string; value?: string; bytes?: number; days?: number; }
interface Action { type: string; tag_name?: string; tag_color?: string; collection_name?: string; }

// ============================================================================
// Tag list + editor
// ============================================================================

function TagsTab() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#ef4444');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const loadTags = useCallback(async () => {
    try { const t = await invoke<Tag[]>('list_tags'); setTags(t); } catch {}
  }, []);

  useEffect(() => { loadTags(); }, [loadTags]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      await tagApi.create(newName.trim(), newColor || undefined);
      setNewName(''); loadTags();
    } catch (e) { console.error('Failed to create tag:', e); }
  }, [newName, newColor, loadTags]);

  const handleUpdate = useCallback(async (id: number) => {
    try {
      await invoke('update_tag', { id, name: editName, color: editColor || null });
      setEditingId(null); loadTags();
    } catch (e) { console.error('Failed to update tag:', e); }
  }, [editName, editColor, loadTags]);

  const handleDelete = useCallback((id: number) => {
    const tag = tags.find((t) => t.id === id);
    modals.openConfirmModal({
      title: 'Supprimer le tag',
      children: <Text size="sm">Supprimer « {tag?.name ?? id} » ? Cette action est irréversible.</Text>,
      labels: { confirm: 'Supprimer', cancel: 'Annuler' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try { await invoke('delete_tag', { id }); loadTags(); }
        catch (e) { console.error('Failed to delete tag:', e); }
      },
    });
  }, [tags, loadTags]);

  return (
    <Stack gap="md">
      {/* Create new tag */}
      <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
        <Text size="sm" fw={600} mb="sm">Nouveau tag</Text>
        <Group gap="sm">
          <TextInput size="xs" placeholder="Nom du tag" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} style={{ flex: 1 }} />
          <ColorInput size="xs" w={120} value={newColor} onChange={setNewColor} format="hex" swatches={['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899']} />
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={handleCreate} disabled={!newName.trim()}>Créer</Button>
        </Group>
      </Paper>

      {/* Tag list */}
      <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
        <Text size="sm" fw={600} mb="sm">Tags ({tags.length})</Text>
        {tags.length === 0 ? (
          <Text size="sm" c="dimmed">Aucun tag créé</Text>
        ) : (
          <Stack gap={4}>
            {tags.map((tag) => (
              <Group key={tag.id} justify="space-between" py={4} px="xs"
                style={{ borderRadius: 'var(--mantine-radius-xs)', backgroundColor: 'var(--mantine-color-default)' }}>
                {editingId === tag.id ? (
                  <Group gap="sm" style={{ flex: 1 }}>
                    <TextInput size="xs" value={editName} onChange={(e) => setEditName(e.currentTarget.value)} style={{ flex: 1 }} />
                    <ColorInput size="xs" w={100} value={editColor} onChange={setEditColor} format="hex" />
                    <ActionIcon size="sm" color="green" variant="subtle" onClick={() => handleUpdate(tag.id)}><IconCheck size={14} /></ActionIcon>
                    <ActionIcon size="sm" color="gray" variant="subtle" onClick={() => setEditingId(null)}><IconX size={14} /></ActionIcon>
                  </Group>
                ) : (
                  <>
                    <Group gap="sm">
                      <Box w={12} h={12} style={{ borderRadius: 3, backgroundColor: tag.color ?? '#64748b' }} />
                      <Text size="sm">{tag.name}</Text>
                    </Group>
                    <Group gap={4}>
                      <ActionIcon size="sm" variant="subtle" color="gray"
                        onClick={() => { setEditingId(tag.id); setEditName(tag.name); setEditColor(tag.color ?? '#64748b'); }}>
                        <IconEdit size={14} />
                      </ActionIcon>
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => handleDelete(tag.id)}>
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Group>
                  </>
                )}
              </Group>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

// ============================================================================
// Collections tab
// ============================================================================

function CollectionsTab() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [newName, setNewName] = useState('');
  const [newSmart, setNewSmart] = useState(false);

  const load = useCallback(async () => {
    try { const c = await invoke<Collection[]>('list_collections'); setCollections(c); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      await invoke('create_collection', {
        name: newName.trim(), description: null, icon: null, color: null,
        isSmart: newSmart, smartQuery: null,
      });
      setNewName(''); setNewSmart(false); load();
    } catch (e) { console.error('Failed to create collection:', e); }
  }, [newName, newSmart, load]);

  const handleDelete = useCallback((id: number) => {
    const col = collections.find((c) => c.id === id);
    modals.openConfirmModal({
      title: 'Supprimer la collection',
      children: <Text size="sm">Supprimer « {col?.name ?? id} » ? Cette action est irréversible.</Text>,
      labels: { confirm: 'Supprimer', cancel: 'Annuler' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try { await invoke('delete_collection', { id }); load(); }
        catch (e) { console.error('Failed to delete collection:', e); }
      },
    });
  }, [collections, load]);

  return (
    <Stack gap="md">
      <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
        <Text size="sm" fw={600} mb="sm">Nouvelle collection</Text>
        <Group gap="sm">
          <TextInput size="xs" placeholder="Nom" value={newName} onChange={(e) => setNewName(e.currentTarget.value)} style={{ flex: 1 }} />
          <Checkbox size="xs" label="Smart" checked={newSmart} onChange={(e) => setNewSmart(e.currentTarget.checked)} />
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={handleCreate} disabled={!newName.trim()}>Créer</Button>
        </Group>
      </Paper>

      <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
        <Text size="sm" fw={600} mb="sm">Collections ({collections.length})</Text>
        {collections.length === 0 ? (
          <Text size="sm" c="dimmed">Aucune collection</Text>
        ) : (
          <Stack gap={4}>
            {collections.map((col) => (
              <Group key={col.id} justify="space-between" py={4} px="xs"
                style={{ borderRadius: 'var(--mantine-radius-xs)', backgroundColor: 'var(--mantine-color-default)' }}>
                <Group gap="sm">
                  <IconFolder size={16} style={{ color: col.color ?? 'var(--mantine-color-dimmed)' }} />
                  <Text size="sm">{col.name}</Text>
                  {col.is_smart && <Badge size="xs" variant="light" color="violet" leftSection={<IconBolt size={10} />}>Smart</Badge>}
                </Group>
                <Group gap={4}>
                  <Text size="xs" c="dimmed">{col.description}</Text>
                  <ActionIcon size="sm" variant="subtle" color="red" onClick={() => handleDelete(col.id)}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              </Group>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

// ============================================================================
// Rules tab
// ============================================================================

function RulesTab() {
  const [rules, setRules] = useState<AutoRule[]>([]);

  const load = useCallback(async () => {
    try { const r = await invoke<AutoRule[]>('list_rules'); setRules(r); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (updated: AutoRule[]) => {
    setRules(updated);
    try {
      await invoke('save_rules', { ruleList: updated });
    } catch (e) { console.error('Failed to save rules:', e); }
  }, []);

  const toggleEnabled = useCallback((id: string) => {
    save(rules.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r));
  }, [rules, save]);

  const deleteRule = useCallback((id: string) => {
    const rule = rules.find((r) => r.id === id);
    modals.openConfirmModal({
      title: 'Supprimer la règle',
      children: <Text size="sm">Supprimer « {rule?.name ?? id} » ?</Text>,
      labels: { confirm: 'Supprimer', cancel: 'Annuler' },
      confirmProps: { color: 'red' },
      onConfirm: () => save(rules.filter((r) => r.id !== id)),
    });
  }, [rules, save]);

  const addRule = useCallback(() => {
    const newRule: AutoRule = {
      id: `rule_${Date.now()}`, name: 'Nouvelle règle', enabled: true,
      conditions: [{ type: 'Kind', value: 'image' }],
      actions: [{ type: 'AddTag', tag_name: 'à trier' }],
    };
    save([...rules, newRule]);
  }, [rules, save]);

  const condLabel = (c: Condition) => {
    switch (c.type) {
      case 'Kind': return `Type = ${c.value}`;
      case 'Extension': return `Ext = .${c.value}`;
      case 'SizeGreaterThan': return `Taille > ${c.bytes}`;
      case 'PathContains': return `Chemin contient "${c.value}"`;
      case 'NotAccessedSince': return `Non accédé depuis ${c.days}j`;
      default: return c.type;
    }
  };

  const actionLabel = (a: Action) => {
    switch (a.type) {
      case 'AddTag': return `→ Tag "${a.tag_name}"`;
      case 'AddToCollection': return `→ Collection "${a.collection_name}"`;
      default: return a.type;
    }
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text size="sm" fw={600}>Règles automatiques ({rules.length})</Text>
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={addRule}>Ajouter</Button>
      </Group>

      {rules.length === 0 ? (
        <Paper p="lg" withBorder ta="center" style={{ borderColor: 'var(--mantine-color-default-border)' }}>
          <IconBolt size={32} stroke={1} style={{ color: 'var(--mantine-color-dimmed)', marginBottom: 8 }} />
          <Text size="sm" c="dimmed">Aucune règle. Les règles s'appliquent automatiquement après chaque scan.</Text>
        </Paper>
      ) : (
        <Stack gap="sm">
          {rules.map((rule) => (
            <Paper key={rule.id} p="sm" withBorder style={{
              borderColor: 'var(--mantine-color-default-border)',
              opacity: rule.enabled ? 1 : 0.5,
            }}>
              <Group justify="space-between" mb="xs">
                <Group gap="sm">
                  <Checkbox size="xs" checked={rule.enabled} onChange={() => toggleEnabled(rule.id)} />
                  <Text size="sm" fw={500}>{rule.name}</Text>
                </Group>
                <ActionIcon size="sm" variant="subtle" color="red" onClick={() => deleteRule(rule.id)}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
              <Group gap="xs" mb={4}>
                <Text size="xs" c="dimmed">Si :</Text>
                {rule.conditions.map((c, i) => (
                  <Badge key={i} size="xs" variant="light" color="blue">{condLabel(c)}</Badge>
                ))}
              </Group>
              <Group gap="xs">
                <Text size="xs" c="dimmed">Alors :</Text>
                {rule.actions.map((a, i) => (
                  <Badge key={i} size="xs" variant="light" color="green">{actionLabel(a)}</Badge>
                ))}
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

// ============================================================================
// Tags Screen
// ============================================================================

export default function TagsScreen() {
  return (
    <Box p="lg" maw={800}>
      <Text size="lg" fw={700} mb="lg">Tags & Collections</Text>

      <Tabs defaultValue="tags" variant="outline">
        <Tabs.List mb="md">
          <Tabs.Tab value="tags" leftSection={<IconTag size={14} />}>Tags</Tabs.Tab>
          <Tabs.Tab value="collections" leftSection={<IconFolder size={14} />}>Collections</Tabs.Tab>
          <Tabs.Tab value="rules" leftSection={<IconBolt size={14} />}>Règles auto</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="tags"><TagsTab /></Tabs.Panel>
        <Tabs.Panel value="collections"><CollectionsTab /></Tabs.Panel>
        <Tabs.Panel value="rules"><RulesTab /></Tabs.Panel>
      </Tabs>
    </Box>
  );
}
