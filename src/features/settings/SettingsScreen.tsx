// ============================================================================
// WinCatalog — features/settings/SettingsScreen.tsx
// Settings: tabs for General, Scan, Cache, Hash, Trash, Advanced
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Group, Stack, Text, Paper, Tabs, Switch, Select, Slider,
  NumberInput, TextInput, Button, Divider, Badge, Alert, ActionIcon,
  useMantineColorScheme,
} from '@mantine/core';
import {
  IconSettings, IconSun, IconRefresh, IconDatabase, IconTrash,
  IconHash, IconFolder, IconAlertTriangle, IconCheck, IconBrain,
  IconForms, IconPlus, IconX,
} from '@tabler/icons-react';
import { settingsApi, diagnosticsApi, trashApi, formatBytes, type PragmaDiagnostics } from '../../api/tauri';
import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// Settings hook — loads a key from DB, provides value + setter
// ============================================================================

function useSetting(key: string, defaultValue: string) {
  const [value, setValue] = useState(defaultValue);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    settingsApi.get(key).then((v) => {
      if (v !== null) setValue(v);
      setLoaded(true);
    });
  }, [key]);

  const save = useCallback(
    (newValue: string) => {
      setValue(newValue);
      settingsApi.set(key, newValue).catch(console.error);
    },
    [key],
  );

  return [value, save, loaded] as const;
}

function useSettingNumber(key: string, defaultValue: number) {
  const [raw, setRaw, loaded] = useSetting(key, String(defaultValue));
  const value = Number(raw) || defaultValue;
  const save = useCallback((n: number) => setRaw(String(n)), [setRaw]);
  return [value, save, loaded] as const;
}

function useSettingBool(key: string, defaultValue: boolean) {
  const [raw, setRaw, loaded] = useSetting(key, defaultValue ? '1' : '0');
  const value = raw === '1' || raw === 'true';
  const save = useCallback((b: boolean) => setRaw(b ? '1' : '0'), [setRaw]);
  return [value, save, loaded] as const;
}

// ============================================================================
// Section wrapper
// ============================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }} mb="md">
      <Text size="sm" fw={600} mb="sm">{title}</Text>
      {children}
    </Paper>
  );
}

// ============================================================================
// Tab: Général
// ============================================================================

function GeneralTab() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const [language, setLanguage] = useSetting('ui.language', 'fr');

  return (
    <Stack gap="md">
      <Section title="Apparence">
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
              <Text size="sm">Thème</Text>
              <Text size="xs" c="dimmed">Clair, sombre ou automatique</Text>
            </div>
            <Select
              size="xs" w={160}
              value={colorScheme}
              onChange={(v) => { if (v) setColorScheme(v as 'light' | 'dark' | 'auto'); }}
              data={[
                { value: 'dark', label: '🌙 Sombre' },
                { value: 'light', label: '☀️ Clair' },
                { value: 'auto', label: '🖥 Système' },
              ]}
            />
          </Group>

          <Group justify="space-between">
            <div>
              <Text size="sm">Langue</Text>
              <Text size="xs" c="dimmed">Langue de l'interface</Text>
            </div>
            <Select
              size="xs" w={160}
              value={language}
              onChange={(v) => { if (v) setLanguage(v); }}
              data={[
                { value: 'fr', label: '🇫🇷 Français' },
                { value: 'en', label: '🇬🇧 English' },
              ]}
            />
          </Group>
        </Stack>
      </Section>
    </Stack>
  );
}

// ============================================================================
// Tab: Scan
// ============================================================================

function ScanTab() {
  const [exclusions, setExclusions] = useSetting('scan.default_exclusions', 'node_modules,.git,.DS_Store,Thumbs.db,$RECYCLE.BIN');
  const [maxDepth, setMaxDepth] = useSettingNumber('scan.max_depth', 50);
  const [followSymlinks, setFollowSymlinks] = useSettingBool('scan.follow_symlinks', false);

  return (
    <Stack gap="md">
      <Section title="Exclusions par défaut">
        <Text size="xs" c="dimmed" mb="xs">
          Dossiers et fichiers ignorés pendant le scan (séparés par des virgules)
        </Text>
        <TextInput
          size="xs"
          value={exclusions}
          onChange={(e) => setExclusions(e.currentTarget.value)}
          placeholder="node_modules,.git,.DS_Store"
        />
      </Section>

      <Section title="Options de scan">
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
              <Text size="sm">Profondeur maximale</Text>
              <Text size="xs" c="dimmed">Nombre max de niveaux de sous-dossiers</Text>
            </div>
            <NumberInput
              size="xs" w={100}
              value={maxDepth}
              onChange={(v) => setMaxDepth(typeof v === 'number' ? v : 50)}
              min={1} max={200}
            />
          </Group>

          <Group justify="space-between">
            <div>
              <Text size="sm">Suivre les liens symboliques</Text>
              <Text size="xs" c="dimmed">Peut causer des boucles infinies</Text>
            </div>
            <Switch
              checked={followSymlinks}
              onChange={(e) => setFollowSymlinks(e.currentTarget.checked)}
            />
          </Group>
        </Stack>
      </Section>
    </Stack>
  );
}

// ============================================================================
// Tab: Cache
// ============================================================================

function CacheTab() {
  const [maxCacheMb, setMaxCacheMb] = useSettingNumber('cache.max_size_mb', 500);

  return (
    <Stack gap="md">
      <Section title="Cache des miniatures">
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
              <Text size="sm">Taille max du cache</Text>
              <Text size="xs" c="dimmed">Les fichiers les plus anciens seront supprimés</Text>
            </div>
            <Group gap="xs">
              <Slider
                w={200}
                value={maxCacheMb}
                onChange={setMaxCacheMb}
                min={100} max={5000} step={100}
                label={(v) => `${v} Mo`}
              />
              <Text size="xs" fw={500} w={60} ta="right">{maxCacheMb} Mo</Text>
            </Group>
          </Group>

          <Divider color="var(--mantine-color-default-border)" />

          <Button variant="light" size="xs" color="yellow" leftSection={<IconTrash size={14} />}>
            Vider le cache
          </Button>
        </Stack>
      </Section>
    </Stack>
  );
}

// ============================================================================
// Tab: Hash & Doublons
// ============================================================================

function HashTab() {
  const [minSizeKb, setMinSizeKb] = useSettingNumber('hash.min_size_kb', 0);

  return (
    <Stack gap="md">
      <Section title="Hash (blake3)">
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
              <Text size="sm">Algorithme</Text>
              <Text size="xs" c="dimmed">Blake3 — rapide, sûr, parallélisable</Text>
            </div>
            <Badge size="sm" variant="light">blake3</Badge>
          </Group>

          <Group justify="space-between">
            <div>
              <Text size="sm">Taille minimale</Text>
              <Text size="xs" c="dimmed">Ignorer les fichiers plus petits (en Ko)</Text>
            </div>
            <NumberInput
              size="xs" w={120}
              value={minSizeKb}
              onChange={(v) => setMinSizeKb(typeof v === 'number' ? v : 0)}
              min={0} max={100000}
              suffix=" Ko"
            />
          </Group>
        </Stack>
      </Section>
    </Stack>
  );
}

// ============================================================================
// Tab: Corbeille
// ============================================================================

function TrashTab() {
  const [retentionDays, setRetentionDays] = useSettingNumber('trash.retention_days', 30);
  const [trashCount, setTrashCount] = useState(0);
  const [trashSize, setTrashSize] = useState(0);
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    trashApi.summary().then(([count, size]) => {
      setTrashCount(count);
      setTrashSize(size);
    });
  }, []);

  const handlePurge = useCallback(async () => {
    setPurging(true);
    try {
      const deleted = await trashApi.purgeExpired();
      // Refresh
      const [count, size] = await trashApi.summary();
      setTrashCount(count);
      setTrashSize(size);
    } catch (err) {
      console.error('Purge failed:', err);
    } finally {
      setPurging(false);
    }
  }, []);

  return (
    <Stack gap="md">
      <Section title="Corbeille logique">
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
              <Text size="sm">Durée de rétention</Text>
              <Text size="xs" c="dimmed">Jours avant suppression définitive</Text>
            </div>
            <NumberInput
              size="xs" w={120}
              value={retentionDays}
              onChange={(v) => setRetentionDays(typeof v === 'number' ? v : 30)}
              min={1} max={365}
              suffix=" j"
            />
          </Group>

          <Divider color="var(--mantine-color-default-border)" />

          <Paper p="sm" style={{ backgroundColor: 'var(--mantine-color-default)', borderRadius: 'var(--mantine-radius-sm)' }}>
            <Group justify="space-between">
              <div>
                <Text size="sm" fw={500}>{trashCount} élément{trashCount > 1 ? 's' : ''} en corbeille</Text>
                <Text size="xs" c="dimmed">{formatBytes(trashSize)}</Text>
              </div>
              <Button
                variant="light" size="xs" color="red"
                leftSection={<IconTrash size={14} />}
                onClick={handlePurge}
                loading={purging}
                disabled={trashCount === 0}
              >
                Purger les expirés
              </Button>
            </Group>
          </Paper>
        </Stack>
      </Section>
    </Stack>
  );
}

// ============================================================================
// Tab: Avancé
// ============================================================================

function AdvancedTab() {
  const [diagnostics, setDiagnostics] = useState<PragmaDiagnostics | null>(null);

  useEffect(() => {
    diagnosticsApi.getDb().then(setDiagnostics).catch(console.error);
  }, []);

  return (
    <Stack gap="md">
      <Section title="Diagnostic base de données">
        {diagnostics ? (
          <Stack gap={6}>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Mode journal</Text>
              <Badge size="xs" variant="light">{diagnostics.journal_mode.toUpperCase()}</Badge>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Synchronous</Text>
              <Text size="xs" fw={500}>{diagnostics.synchronous === 1 ? 'NORMAL' : diagnostics.synchronous}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Cache</Text>
              <Text size="xs" fw={500}>{diagnostics.cache_size_kb} Ko</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">MMap</Text>
              <Text size="xs" fw={500}>{diagnostics.mmap_size_mb} Mo</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Taille page</Text>
              <Text size="xs" fw={500}>{diagnostics.page_size} o</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Taille DB</Text>
              <Text size="xs" fw={500}>{diagnostics.db_size_mb} Mo</Text>
            </Group>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">Foreign keys</Text>
              <Badge size="xs" variant="light" color={diagnostics.foreign_keys ? 'green' : 'red'}>
                {diagnostics.foreign_keys ? 'ON' : 'OFF'}
              </Badge>
            </Group>
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">Chargement…</Text>
        )}
      </Section>

      <Section title="Actions">
        <Stack gap="sm">
          <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={16} />} p="sm">
            <Text size="xs">Ces actions sont irréversibles. Utilisez-les avec précaution.</Text>
          </Alert>

          <Group gap="sm">
            <Button variant="light" size="xs" color="yellow" leftSection={<IconRefresh size={14} />}>
              Optimiser la DB
            </Button>
            <Button variant="light" size="xs" color="red" leftSection={<IconDatabase size={14} />}>
              Réinitialiser l'index
            </Button>
          </Group>
        </Stack>
      </Section>
    </Stack>
  );
}

// ============================================================================
// Tab: IA
// ============================================================================

function AiTab() {
  const [provider, setProvider] = useSetting('ai.provider', 'anthropic');
  const [apiKey, setApiKey] = useSetting('ai.api_key', '');
  const [model, setModel] = useSetting('ai.model', 'claude-sonnet-4-5-20250514');
  const [autoClassify, setAutoClassify] = useSettingBool('ai.auto_classify', true);
  const [autoOcr, setAutoOcr] = useSettingBool('ai.auto_ocr_pdf', true);

  return (
    <Stack gap="md">
      <Section title="Fournisseur API">
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
              <Text size="sm">Fournisseur</Text>
              <Text size="xs" c="dimmed">Service cloud pour l'IA</Text>
            </div>
            <Select size="xs" w={180} value={provider}
              onChange={(v) => { if (v) setProvider(v); }}
              data={[
                { value: 'anthropic', label: 'Anthropic (Claude)' },
                { value: 'openai', label: 'OpenAI (GPT)' },
              ]} />
          </Group>
          <Group justify="space-between">
            <div>
              <Text size="sm">Clé API</Text>
              <Text size="xs" c="dimmed">Stockée localement, jamais partagée</Text>
            </div>
            <TextInput size="xs" w={280} type="password" placeholder="sk-..." value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)} />
          </Group>
          <Group justify="space-between">
            <div>
              <Text size="sm">Modèle</Text>
              <Text size="xs" c="dimmed">Modèle utilisé pour les appels</Text>
            </div>
            <TextInput size="xs" w={280} value={model}
              onChange={(e) => setModel(e.currentTarget.value)} />
          </Group>
        </Stack>
      </Section>

      <Section title="Automatisations">
        <Stack gap="sm">
          <Group justify="space-between">
            <div>
              <Text size="sm">Auto-classification documents</Text>
              <Text size="xs" c="dimmed">Classifier automatiquement les documents après extraction texte</Text>
            </div>
            <Switch checked={autoClassify} onChange={(e) => setAutoClassify(e.currentTarget.checked)} />
          </Group>
          <Group justify="space-between">
            <div>
              <Text size="sm">Auto-OCR PDF scannés</Text>
              <Text size="xs" c="dimmed">Lancer l'OCR si un PDF semble scanné (peu de texte)</Text>
            </div>
            <Switch checked={autoOcr} onChange={(e) => setAutoOcr(e.currentTarget.checked)} />
          </Group>
        </Stack>
      </Section>
    </Stack>
  );
}

// ============================================================================
// Tab: Champs personnalisés
// ============================================================================

interface CustomField { id: number; name: string; field_type: string; options: string | null; sort_order: number; }

function CustomFieldsTab() {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('text');

  const load = useCallback(async () => {
    try { const f = await invoke<CustomField[]>('list_custom_fields'); setFields(f); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    await invoke('create_custom_field', { name: newName.trim(), fieldType: newType, options: null });
    setNewName(''); load();
  }, [newName, newType, load]);

  const handleDelete = useCallback(async (id: number) => {
    await invoke('delete_custom_field', { id }); load();
  }, [load]);

  const typeLabels: Record<string, string> = {
    text: 'Texte', number: 'Nombre', date: 'Date', select: 'Liste', boolean: 'Oui/Non',
  };

  return (
    <Stack gap="md">
      <Section title="Nouveau champ">
        <Group gap="sm">
          <TextInput size="xs" placeholder="Nom du champ (ex: Client, Projet)" value={newName}
            onChange={(e) => setNewName(e.currentTarget.value)} style={{ flex: 1 }} />
          <Select size="xs" w={120} value={newType} onChange={(v) => { if (v) setNewType(v); }}
            data={[
              { value: 'text', label: 'Texte' },
              { value: 'number', label: 'Nombre' },
              { value: 'date', label: 'Date' },
              { value: 'select', label: 'Liste' },
              { value: 'boolean', label: 'Oui/Non' },
            ]} />
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={handleCreate} disabled={!newName.trim()}>
            Créer
          </Button>
        </Group>
      </Section>

      <Section title={`Champs définis (${fields.length})`}>
        {fields.length === 0 ? (
          <Text size="sm" c="dimmed">Aucun champ personnalisé. Les champs apparaissent dans l'Inspector pour chaque fichier.</Text>
        ) : (
          <Stack gap={4}>
            {fields.map((f) => (
              <Group key={f.id} justify="space-between" py={4} px="xs"
                style={{ borderRadius: 'var(--mantine-radius-xs)', backgroundColor: 'var(--mantine-color-default)' }}>
                <Group gap="sm">
                  <Text size="sm" fw={500}>{f.name}</Text>
                  <Badge size="xs" variant="light">{typeLabels[f.field_type] ?? f.field_type}</Badge>
                </Group>
                <ActionIcon size="sm" variant="subtle" color="red" onClick={() => handleDelete(f.id)}>
                  <IconX size={14} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        )}
      </Section>
    </Stack>
  );
}

// ============================================================================
// Settings Screen
// ============================================================================

export default function SettingsScreen() {
  return (
    <Box p="lg" maw={800}>
      <Text size="lg" fw={700} mb="lg">Paramètres</Text>

      <Tabs defaultValue="general" variant="outline">
        <Tabs.List mb="md">
          <Tabs.Tab value="general" leftSection={<IconSun size={14} />}>Général</Tabs.Tab>
          <Tabs.Tab value="scan" leftSection={<IconRefresh size={14} />}>Scan</Tabs.Tab>
          <Tabs.Tab value="cache" leftSection={<IconFolder size={14} />}>Cache</Tabs.Tab>
          <Tabs.Tab value="hash" leftSection={<IconHash size={14} />}>Hash</Tabs.Tab>
          <Tabs.Tab value="trash" leftSection={<IconTrash size={14} />}>Corbeille</Tabs.Tab>
          <Tabs.Tab value="ai" leftSection={<IconBrain size={14} />}>IA</Tabs.Tab>
          <Tabs.Tab value="custom_fields" leftSection={<IconForms size={14} />}>Champs</Tabs.Tab>
          <Tabs.Tab value="advanced" leftSection={<IconSettings size={14} />}>Avancé</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="general"><GeneralTab /></Tabs.Panel>
        <Tabs.Panel value="scan"><ScanTab /></Tabs.Panel>
        <Tabs.Panel value="cache"><CacheTab /></Tabs.Panel>
        <Tabs.Panel value="hash"><HashTab /></Tabs.Panel>
        <Tabs.Panel value="trash"><TrashTab /></Tabs.Panel>
        <Tabs.Panel value="ai"><AiTab /></Tabs.Panel>
        <Tabs.Panel value="custom_fields"><CustomFieldsTab /></Tabs.Panel>
        <Tabs.Panel value="advanced"><AdvancedTab /></Tabs.Panel>
      </Tabs>
    </Box>
  );
}
