// ============================================================================
// WinCatalog — drawers/ReportsDrawer.tsx
// Report generation: templates, parameters, export PDF/CSV/JSON/HTML
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Drawer, Group, Stack, Text, Paper, Button, Select, Checkbox,
  MultiSelect, Divider, Badge, ScrollArea,
} from '@mantine/core';
import {
  IconFileText, IconDownload, IconPrinter, IconTable,
  IconCode, IconFileTypePdf,
} from '@tabler/icons-react';
import { volumeApi, formatBytes, type Volume } from '../api/tauri';

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

type ExportFormat = 'pdf' | 'csv' | 'json' | 'html';

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
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [generating, setGenerating] = useState(false);

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
    try {
      // TODO: call actual report generation command when implemented
      // For now, simulate delay
      await new Promise((r) => setTimeout(r, 1500));
      console.log('Generate report:', { template: selectedTemplate, volumes: selectedVolumes, format });
    } finally {
      setGenerating(false);
    }
  }, [selectedTemplate, selectedVolumes, format]);

  const volumeOptions = volumes.map((v) => ({ value: String(v.id), label: `${v.label} (${formatBytes(v.used_bytes)})` }));

  return (
    <Drawer opened={opened} onClose={onClose} title="Générer un rapport" position="right" size="md"
      styles={{ content: { backgroundColor: 'var(--mantine-color-dark-7)' }, header: { backgroundColor: 'var(--mantine-color-dark-7)' } }}>
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
                    borderColor: selectedTemplate === t.id ? 'var(--mantine-color-primary-6)' : 'var(--mantine-color-dark-5)',
                    backgroundColor: selectedTemplate === t.id ? 'var(--mantine-color-primary-9)' : 'transparent',
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

          <Divider color="var(--mantine-color-dark-5)" />

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
                onChange={(v) => setFormat((v as ExportFormat) ?? 'pdf')}
                data={[
                  { value: 'pdf', label: '📄 PDF' },
                  { value: 'html', label: '🌐 HTML' },
                  { value: 'csv', label: '📊 CSV' },
                  { value: 'json', label: '🔧 JSON' },
                ]}
              />
            </Stack>
          </div>

          <Divider color="var(--mantine-color-dark-5)" />

          {/* Preview */}
          <div>
            <Text size="sm" fw={600} mb="sm">Aperçu</Text>
            <Paper p="sm" withBorder style={{ borderColor: 'var(--mantine-color-dark-5)' }}>
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

          <Divider color="var(--mantine-color-dark-5)" />

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
