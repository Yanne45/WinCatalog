// ============================================================================
// WinCatalog — drawers/ActivityDrawer.tsx
// Job queue drawer: live progress, pause/cancel/retry, errors section
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Drawer, Group, Stack, Text, Badge, Button, Progress, ActionIcon,
  Tooltip, Divider, ScrollArea, SegmentedControl, Box, Alert,
} from '@mantine/core';
import {
  IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconRefresh,
  IconTrash, IconAlertTriangle, IconCheck,
} from '@tabler/icons-react';
import { jobApi, formatBytes, formatDuration, type Job, type JobEvent } from '../api/tauri';

// ============================================================================
// Job type metadata
// ============================================================================

const JOB_META: Record<string, { icon: string; label: string; color: string }> = {
  scan: { icon: '📀', label: 'Scan', color: 'blue' },
  hash: { icon: '🧬', label: 'Hash', color: 'violet' },
  thumb: { icon: '🖼', label: 'Thumbnails', color: 'orange' },
  extract_meta: { icon: '🧠', label: 'Metadata', color: 'cyan' },
  ocr: { icon: '📝', label: 'OCR', color: 'teal' },
  classify: { icon: '🤖', label: 'Classification', color: 'pink' },
  summarize: { icon: '📋', label: 'Résumé', color: 'grape' },
  cleanup: { icon: '🧹', label: 'Nettoyage', color: 'yellow' },
};

const STATUS_COLORS: Record<string, string> = {
  running: 'blue', queued: 'gray', done: 'green', error: 'red', canceled: 'yellow', paused: 'orange',
};

const STATUS_LABELS: Record<string, string> = {
  running: 'En cours', queued: 'En file', done: 'Terminé', error: 'Erreur', canceled: 'Annulé', paused: 'Pause',
};

// ============================================================================
// Job row
// ============================================================================

function JobRow({ job }: { job: Job }) {
  const meta = JOB_META[job.type] ?? { icon: '⚙', label: job.type, color: 'gray' };
  const pct = Math.round(job.progress * 100);

  return (
    <Box py="xs" px="sm" style={{ borderRadius: 'var(--mantine-radius-xs)', backgroundColor: 'var(--mantine-color-default)' }}>
      <Group justify="space-between" mb={job.status === 'running' ? 6 : 0}>
        <Group gap="sm">
          <Text size="md">{meta.icon}</Text>
          <div>
            <Text size="sm" fw={500}>{meta.label}{job.variant ? ` (${job.variant})` : ''}</Text>
            <Text size="xs" c="dimmed">Tentative {job.attempts}{job.last_error ? ` — ${job.last_error}` : ''}</Text>
          </div>
        </Group>
        <Badge size="sm" color={STATUS_COLORS[job.status] ?? 'gray'} variant="light">
          {STATUS_LABELS[job.status] ?? job.status}
        </Badge>
      </Group>

      {job.status === 'running' && (
        <Group gap="xs" mt={4}>
          <Progress value={pct} size="sm" color={meta.color} radius="xl" style={{ flex: 1 }} />
          <Text size="xs" fw={500} w={36} ta="right">{pct}%</Text>
        </Group>
      )}
    </Box>
  );
}

// ============================================================================
// Activity Drawer
// ============================================================================

export interface ActivityDrawerProps {
  opened: boolean;
  onClose: () => void;
}

export default function ActivityDrawer({ opened, onClose }: ActivityDrawerProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const unlistenRef = useRef<(() => void) | null>(null);

  // Poll + listen
  useEffect(() => {
    if (!opened) return;
    let active = true;

    const poll = async () => {
      try {
        const j = await jobApi.listActive();
        if (active) setJobs(j);
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 1500);

    jobApi.onEvent(() => { poll(); }).then((ul) => { unlistenRef.current = ul; });

    return () => { active = false; clearInterval(interval); unlistenRef.current?.(); };
  }, [opened]);

  const running = jobs.filter((j) => j.status === 'running');
  const queued = jobs.filter((j) => j.status === 'queued');
  const paused = jobs.filter((j) => j.status === 'paused');
  const errors = jobs.filter((j) => j.status === 'error');

  const filtered = filter === 'all' ? jobs
    : filter === 'running' ? running
    : filter === 'queued' ? queued
    : filter === 'error' ? errors : jobs;

  return (
    <Drawer opened={opened} onClose={onClose} title="Activité" position="right" size="md"
      styles={{ content: { backgroundColor: 'var(--mantine-color-body)' }, header: { backgroundColor: 'var(--mantine-color-body)' } }}>
      <Stack gap="md">
        {/* Summary */}
        <Group gap="md">
          <Badge color="blue" variant="light">{running.length} en cours</Badge>
          <Badge color="gray" variant="light">{queued.length} en file</Badge>
          {errors.length > 0 && <Badge color="red" variant="light">{errors.length} erreur{errors.length > 1 ? 's' : ''}</Badge>}
          {paused.length > 0 && <Badge color="orange" variant="light">{paused.length} en pause</Badge>}
        </Group>

        {/* Global actions */}
        <Group gap="sm">
          <Button size="xs" variant="light" leftSection={<IconPlayerPause size={14} />}
            onClick={() => jobApi.pause()}>Pause tout</Button>
          <Button size="xs" variant="light" leftSection={<IconPlayerPlay size={14} />}
            onClick={() => jobApi.resume()}>Reprendre</Button>
          <Button size="xs" variant="light" color="red" leftSection={<IconPlayerStop size={14} />}
            onClick={() => jobApi.cancelCurrent()}>Annuler courant</Button>
        </Group>

        {/* Filter */}
        <SegmentedControl size="xs" value={filter} onChange={setFilter}
          data={[
            { value: 'all', label: `Tout (${jobs.length})` },
            { value: 'running', label: `En cours (${running.length})` },
            { value: 'queued', label: `File (${queued.length})` },
            { value: 'error', label: `Erreurs (${errors.length})` },
          ]}
          styles={{ root: { backgroundColor: 'var(--mantine-color-default)' } }}
        />

        {/* Errors section */}
        {filter !== 'error' && errors.length > 0 && (
          <Alert variant="light" color="red" icon={<IconAlertTriangle size={16} />} p="sm">
            <Text size="xs">{errors.length} job{errors.length > 1 ? 's' : ''} en erreur</Text>
          </Alert>
        )}

        <Divider color="var(--mantine-color-default-border)" />

        {/* Job list */}
        <ScrollArea.Autosize mah={500} type="auto">
          <Stack gap={6}>
            {filtered.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="lg">
                {filter === 'all' ? 'Aucune tâche active' : 'Aucun résultat'}
              </Text>
            ) : (
              filtered.map((job) => <JobRow key={job.id} job={job} />)
            )}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </Drawer>
  );
}
