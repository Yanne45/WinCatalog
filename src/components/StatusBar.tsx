// ============================================================================
// WinCatalog — components/StatusBar.tsx
// Dynamic status bar: live job progress, volume status, contextual info
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import {
  Group, Text, Progress, Tooltip, ActionIcon, Badge, Box,
  UnstyledButton,
} from '@mantine/core';
import { IconCircleFilled, IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react';
import {
  jobApi, volumeApi, formatBytes,
  type Job, type Volume, type JobEvent,
} from '../api/tauri';

// ============================================================================
// Job type → icon + label
// ============================================================================

const JOB_META: Record<string, { icon: string; label: string; color: string }> = {
  scan:         { icon: '📀', label: 'Scan',        color: 'blue' },
  hash:         { icon: '🧬', label: 'Hash',        color: 'violet' },
  thumb:        { icon: '🖼', label: 'Thumbnails',  color: 'orange' },
  extract_meta: { icon: '🧠', label: 'Metadata',    color: 'cyan' },
  ocr:          { icon: '📝', label: 'OCR',         color: 'teal' },
  classify:     { icon: '🤖', label: 'Classification', color: 'pink' },
  cleanup:      { icon: '🧹', label: 'Nettoyage',   color: 'yellow' },
};

function getJobMeta(type: string) {
  return JOB_META[type] ?? { icon: '⚙', label: type, color: 'gray' };
}

// ============================================================================
// Mini job indicator
// ============================================================================

function JobIndicator({ job }: { job: Job }) {
  const meta = getJobMeta(job.type);
  const pct = Math.round(job.progress * 100);

  return (
    <Tooltip label={`${meta.label}${job.variant ? ` (${job.variant})` : ''} — ${job.status === 'running' ? `${pct}%` : job.status}`}>
      <Group gap={6} style={{ cursor: 'pointer' }}>
        <Text size="xs" c="dimmed">{meta.icon} {meta.label}</Text>
        {job.status === 'running' && (
          <>
            <Progress value={pct} size="xs" w={50} color={meta.color} radius="xl" />
            <Text size="xs" c="dimmed">{pct}%</Text>
          </>
        )}
        {job.status === 'queued' && (
          <Badge size="xs" variant="light" color="gray">file</Badge>
        )}
        {job.status === 'paused' && (
          <Badge size="xs" variant="light" color="yellow">pause</Badge>
        )}
      </Group>
    </Tooltip>
  );
}

// ============================================================================
// Volume status dot
// ============================================================================

function VolumeDot({ volume }: { volume: Volume }) {
  return (
    <Tooltip label={`${volume.label} — ${volume.is_online ? 'En ligne' : 'Hors ligne'}`}>
      <Group gap={4} style={{ cursor: 'default' }}>
        <IconCircleFilled
          size={7}
          style={{ color: volume.is_online ? 'var(--mantine-color-green-5)' : 'var(--mantine-color-red-5)' }}
        />
        <Text size="xs" c="dimmed">{volume.label}</Text>
      </Group>
    </Tooltip>
  );
}

// ============================================================================
// StatusBar
// ============================================================================

export interface StatusBarProps {
  /** Contextual info from the active screen (e.g. "1247 fichiers • 42.8 Go") */
  contextInfo?: string;
  onJobClick?: () => void;
}

export default function StatusBar({ contextInfo, onJobClick }: StatusBarProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Adaptive polling: 2s when jobs running, 10s when idle
  useEffect(() => {
    let active = true;
    let intervalId: ReturnType<typeof setTimeout> | null = null;
    let hasRunningJobs = false;

    const poll = async () => {
      try {
        const [j, v] = await Promise.all([jobApi.listActive(), volumeApi.list()]);
        if (active) {
          setJobs(j);
          setVolumes(v);
          const running = j.some((job) => job.status === 'running' || job.status === 'queued');
          if (running !== hasRunningJobs) {
            hasRunningJobs = running;
            schedulePoll(); // Reschedule with new interval
          }
        }
      } catch { /* ignore */ }
    };

    const schedulePoll = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(poll, hasRunningJobs ? 2000 : 10000);
    };

    poll();
    schedulePoll();

    // Also listen to job events for immediate updates
    jobApi.onEvent((evt) => {
      if (evt.type === 'Done' || evt.type === 'Failed' || evt.type === 'Started') {
        poll(); // Refresh on state changes
      }
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
      unlistenRef.current?.();
    };
  }, []);

  const runningJobs = jobs.filter((j) => j.status === 'running');
  const queuedCount = jobs.filter((j) => j.status === 'queued').length;

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap" style={{ overflow: 'hidden' }}>
      {/* Left: jobs */}
      <UnstyledButton onClick={onJobClick} style={{ display: 'flex', alignItems: 'center', flexShrink: 1, overflow: 'hidden' }}>
        <Group gap="lg" wrap="nowrap">
          {runningJobs.length > 0 ? (
            runningJobs.slice(0, 3).map((j) => <JobIndicator key={j.id} job={j} />)
          ) : queuedCount > 0 ? (
            <Text size="xs" c="dimmed">
              {queuedCount} tâche{queuedCount > 1 ? 's' : ''} en attente
            </Text>
          ) : (
            <Text size="xs" c="dimmed">Prêt</Text>
          )}
          {queuedCount > 0 && runningJobs.length > 0 && (
            <Text size="xs" c="dimmed">+{queuedCount} en file</Text>
          )}
        </Group>
      </UnstyledButton>

      {/* Center: contextual info */}
      <Text size="xs" c="dimmed" style={{ flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {contextInfo ?? ''}
      </Text>

      {/* Right: volume status */}
      <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
        {volumes.slice(0, 4).map((v) => (
          <VolumeDot key={v.id} volume={v} />
        ))}
        {volumes.length > 4 && (
          <Text size="xs" c="dimmed">+{volumes.length - 4}</Text>
        )}
      </Group>
    </Group>
  );
}
