// ============================================================================
// WinCatalog — drawers/ReportsDrawer.tsx
// Report generation: templates, parameters, export PDF/CSV/JSON/HTML
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Drawer, Group, Stack, Text, Paper, Button, Select, Checkbox,
  MultiSelect, Divider, Badge, ScrollArea, Alert,
} from '@mantine/core';
import {
  IconFileText, IconDownload, IconPrinter, IconTable,
  IconCode, IconFileTypePdf, IconCheck, IconAlertCircle,
} from '@tabler/icons-react';
import { volumeApi, exportApi, formatBytes, type Volume } from '../api/tauri';

// ============================================================================
// Report templates
// ============================================================================

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  sections: string[];
  icon: string;
}

const TEMPLATES: ReportTemplate[] = [
  { id: 'occupation', name: 'Occupation par disque', description: 'Espace utilisé/libre, répartition par type', sections: ['volume_summary', 'kind_distribution'], icon: '📊' },
  { id: 'distribution', name: 'Répartition par type', description: 'Détail des types de fichiers par volume', sections: ['kind_distribution', 'kind_details'], icon: '🧩' },
  { id: 'top_folders', name: 'Top dossiers', description: 'Les dossiers les plus volumineux', sections: ['top_folders'], icon: '📁' },
  { id: 'duplicates', name: 'Doublons', description: 'Fichiers en double et espace récupérable', sections: ['duplicates_summary', 'duplicate_groups'], icon: '🧬' },
  { id: 'full', name: 'Rapport complet', description: 'Toutes les sections combinées', sections: ['volume_summary', 'kind_distribution', 'top_folders', 'duplicates_summary', 'recent_activity'], icon: '📋' },
];

type ExportFormat = 'csv' | 'json' | 'sqlite';

// ============================================================================
// Reports Drawer
// ============================================================================

export interface ReportsDrawerProps {
  opened: boolean;
  onClose: () => void;
}

export default function ReportsDrawer({ opened, onClose }: ReportsDrawerProps) {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('full');
  const [selectedVolumes, setSelectedVolumes] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportFormat>('json');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (opened) {
      volumeApi.list().then((vols) => {
        setVolumes(vols);
        setSelectedVolumes(vols.map((v) => String(v.id)));
      });
    }
  }, [opened]);

  const template = TEMPLATES.find((t) => t.id === selectedTemplate) ?? TEMPLATES[4];

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setResult(null);
    try {
      // Build scope from selected volumes
      const scope = selectedVolumes.length === 1 ? `volume:${selectedVolumes[0]}` : 'full';
      // Generate a timestamped filename in the user's home directory
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const ext = format === 'sqlite' ? 'db' : format;
      const outputPath = `wincatalog_export_${ts}.${ext}`;
      const stats = await exportApi.catalogue(format as 'sqlite' | 'json' | 'csv', scope, outputPath);
      setResult({ success: true, message: `Export réussi : ${stats.entries_exported} entrées → ${stats.path}` });
    } catch (e) {
      setResult({ success: false, message: `Erreur : ${e}` });
    } finally {
      setGenerating(false);
    }
  }, [selectedTemplate, selectedVolumes, format]);

  const volumeOptions = volumes.map((v) => ({ value: String(v.id), label: `${v.label} (${formatBytes(v.used_bytes)})` }));

  return (
    <Drawer opened={opened} onClose={onClose} title="Générer un rapport" position="right" size="md"
      styles={{ content: { backgroundColor: 'var(--mantine-color-body)' }, header: { backgroundColor: 'var(--mantine-color-body)' } }}>
      <ScrollArea h="calc(100vh - 80px)" type="auto">
        <Stack gap="md">
          {/* Template selection */}
          <div>
            <Text size="sm" fw={600} mb="sm">Modèle de rapport</Text>
            <Stack gap={6}>
              {TEMPLATES.map((t) => (
                <Paper key={t.id} p="sm" withBorder
                  onClick={() => setSelectedTemplate(t.id)}
                  style={{
                    cursor: 'pointer',
                    borderColor: selectedTemplate === t.id ? 'var(--mantine-color-primary-6)' : 'var(--mantine-color-default-border)',
                    backgroundColor: selectedTemplate === t.id ? 'var(--mantine-color-primary-light)' : 'transparent',
                  }}>
                  <Group gap="sm">
                    <Text size="lg">{t.icon}</Text>
                    <div>
                      <Text size="sm" fw={500}>{t.name}</Text>
                      <Text size="xs" c="dimmed">{t.description}</Text>
                    </div>
                  </Group>
                </Paper>
              ))}
            </Stack>
          </div>

          <Divider color="var(--mantine-color-default-border)" />

          {/* Parameters */}
          <div>
            <Text size="sm" fw={600} mb="sm">Paramètres</Text>
            <Stack gap="sm">
              <MultiSelect
                size="xs"
                label="Volumes à inclure"
                data={volumeOptions}
                value={selectedVolumes}
                onChange={setSelectedVolumes}
                placeholder="Sélectionner les volumes"
              />

              <Select
                size="xs"
                label="Format d'export"
                value={format}
                onChange={(v) => setFormat((v as ExportFormat) ?? 'json')}
                data={[
                  { value: 'json', label: 'JSON' },
                  { value: 'csv', label: 'CSV' },
                  { value: 'sqlite', label: 'SQLite (sauvegarde)' },
                ]}
              />
            </Stack>
          </div>

          <Divider color="var(--mantine-color-default-border)" />

          {/* Preview */}
          <div>
            <Text size="sm" fw={600} mb="sm">Aperçu</Text>
            <Paper p="sm" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
              <Text size="sm" fw={500} mb="xs">{template.icon} {template.name}</Text>
              <Text size="xs" c="dimmed" mb="sm">{selectedVolumes.length} volume{selectedVolumes.length > 1 ? 's' : ''} sélectionné{selectedVolumes.length > 1 ? 's' : ''}</Text>
              <Group gap={4}>
                <Text size="xs" c="dimmed">Sections :</Text>
                {template.sections.map((s) => (
                  <Badge key={s} size="xs" variant="light">{s.replace('_', ' ')}</Badge>
                ))}
              </Group>
            </Paper>
          </div>

          <Divider color="var(--mantine-color-default-border)" />

          {/* Result */}
          {result && (
            <Alert
              color={result.success ? 'green' : 'red'}
              icon={result.success ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
              withCloseButton onClose={() => setResult(null)}
            >
              <Text size="xs">{result.message}</Text>
            </Alert>
          )}

          {/* Actions */}
          <Group gap="sm">
            <Button
              leftSection={<IconDownload size={14} />}
              onClick={handleGenerate}
              loading={generating}
              disabled={selectedVolumes.length === 0}
              style={{ flex: 1 }}
            >
              Exporter {format.toUpperCase()}
            </Button>
          </Group>
        </Stack>
      </ScrollArea>
    </Drawer>
  );
}
