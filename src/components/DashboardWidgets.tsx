// ============================================================================
// WinCatalog — components/DashboardWidgets.tsx
// Composable dashboard: configurable widget grid with add/remove
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Group, Stack, Text, Paper, Button, Badge, ActionIcon,
  Menu, SimpleGrid, Tooltip,
} from '@mantine/core';
import {
  IconPlus, IconX, IconGripVertical, IconDisc, IconFolder,
  IconCopy, IconAlertTriangle, IconStar, IconClock, IconBrain,
} from '@tabler/icons-react';
import { settingsApi } from '../api/tauri';

// ============================================================================
// Widget types
// ============================================================================

export type WidgetType =
  | 'volume_occupation'
  | 'recent_files'
  | 'kind_distribution'
  | 'top_folders'
  | 'duplicates_pending'
  | 'alerts'
  | 'favorites'
  | 'recent_activity'
  | 'ai_stats';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  size: 'sm' | 'md' | 'lg';  // 1 col / 1 col / 2 cols
}

interface WidgetDef {
  type: WidgetType;
  label: string;
  icon: React.ReactNode;
  defaultSize: 'sm' | 'md' | 'lg';
  description: string;
}

const WIDGET_DEFS: WidgetDef[] = [
  { type: 'volume_occupation', label: 'Occupation volume', icon: <IconDisc size={14} />, defaultSize: 'md', description: 'Donut + chiffres Used/Free/Total' },
  { type: 'recent_files', label: 'Fichiers récents', icon: <IconClock size={14} />, defaultSize: 'md', description: 'Derniers fichiers ajoutés' },
  { type: 'kind_distribution', label: 'Répartition par type', icon: <IconFolder size={14} />, defaultSize: 'lg', description: 'Donut par type de fichier' },
  { type: 'top_folders', label: 'Top dossiers', icon: <IconFolder size={14} />, defaultSize: 'lg', description: 'Bar chart des plus gros dossiers' },
  { type: 'duplicates_pending', label: 'Doublons', icon: <IconCopy size={14} />, defaultSize: 'sm', description: 'Compteur + espace récupérable' },
  { type: 'alerts', label: 'Alertes', icon: <IconAlertTriangle size={14} />, defaultSize: 'sm', description: 'Erreurs, volumes offline, espace critique' },
  { type: 'favorites', label: 'Favoris', icon: <IconStar size={14} />, defaultSize: 'md', description: 'Fichiers favoris récents' },
  { type: 'recent_activity', label: 'Activité récente', icon: <IconClock size={14} />, defaultSize: 'md', description: 'Jobs terminés récemment' },
  { type: 'ai_stats', label: 'Stats IA', icon: <IconBrain size={14} />, defaultSize: 'sm', description: 'Docs analysés vs non analysés' },
];

const DEFAULT_LAYOUT: WidgetConfig[] = [
  { id: 'w1', type: 'kind_distribution', title: 'Répartition par type', size: 'lg' },
  { id: 'w2', type: 'top_folders', title: 'Top dossiers', size: 'lg' },
  { id: 'w3', type: 'recent_files', title: 'Fichiers récents', size: 'md' },
  { id: 'w4', type: 'duplicates_pending', title: 'Doublons', size: 'sm' },
  { id: 'w5', type: 'alerts', title: 'Alertes', size: 'sm' },
];

const LAYOUT_KEY = 'dashboard.widget_layout';

// ============================================================================
// Widget placeholder (content comes from parent DashboardScreen)
// ============================================================================

function WidgetShell({
  config, onRemove, children,
}: {
  config: WidgetConfig; onRemove: () => void; children?: React.ReactNode;
}) {
  const def = WIDGET_DEFS.find((d) => d.type === config.type);

  return (
    <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-dark-5)', height: '100%' }}>
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <IconGripVertical size={14} style={{ color: 'var(--mantine-color-dimmed)', cursor: 'grab' }} />
          <Text size="sm" fw={600}>{config.title}</Text>
        </Group>
        <Tooltip label="Retirer">
          <ActionIcon size="xs" variant="subtle" color="gray" onClick={onRemove}>
            <IconX size={12} />
          </ActionIcon>
        </Tooltip>
      </Group>
      {children ?? (
        <Box py="lg" ta="center">
          <Text c="dimmed" size="xs">{def?.description ?? 'Widget'}</Text>
        </Box>
      )}
    </Paper>
  );
}

// ============================================================================
// Dashboard Widget Manager
// ============================================================================

export interface DashboardWidgetManagerProps {
  /** Render function for widget content — receives widget type and returns JSX */
  renderWidget: (type: WidgetType) => React.ReactNode;
}

export default function DashboardWidgetManager({ renderWidget }: DashboardWidgetManagerProps) {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_LAYOUT);
  const [loaded, setLoaded] = useState(false);

  // Load from settings
  useEffect(() => {
    settingsApi.getJson<WidgetConfig[]>(LAYOUT_KEY, DEFAULT_LAYOUT).then((layout) => {
      setWidgets(layout);
      setLoaded(true);
    });
  }, []);

  // Save on change
  const saveLayout = useCallback((updated: WidgetConfig[]) => {
    setWidgets(updated);
    settingsApi.setJson(LAYOUT_KEY, updated);
  }, []);

  const removeWidget = useCallback((id: string) => {
    saveLayout(widgets.filter((w) => w.id !== id));
  }, [widgets, saveLayout]);

  const addWidget = useCallback((type: WidgetType) => {
    const def = WIDGET_DEFS.find((d) => d.type === type);
    if (!def) return;
    const id = `w_${Date.now()}`;
    saveLayout([...widgets, { id, type, title: def.label, size: def.defaultSize }]);
  }, [widgets, saveLayout]);

  // Available widgets not yet in layout
  const available = WIDGET_DEFS.filter((d) => !widgets.some((w) => w.type === d.type));

  // Convert size to grid span
  const sizeToSpan = (size: string) => size === 'lg' ? 2 : 1;

  return (
    <Stack gap="md">
      {/* Widget grid */}
      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        {widgets.map((w) => (
          <Box key={w.id} style={{ gridColumn: sizeToSpan(w.size) === 2 ? 'span 2' : undefined }}>
            <WidgetShell config={w} onRemove={() => removeWidget(w.id)}>
              {renderWidget(w.type)}
            </WidgetShell>
          </Box>
        ))}
      </SimpleGrid>

      {/* Add widget */}
      {available.length > 0 && (
        <Menu position="bottom-start" withArrow>
          <Menu.Target>
            <Button variant="subtle" size="xs" leftSection={<IconPlus size={14} />}>
              Ajouter un widget
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {available.map((d) => (
              <Menu.Item key={d.type} leftSection={d.icon} onClick={() => addWidget(d.type)}>
                <div>
                  <Text size="sm">{d.label}</Text>
                  <Text size="xs" c="dimmed">{d.description}</Text>
                </div>
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </Stack>
  );
}
