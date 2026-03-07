// ============================================================================
// WinCatalog — components/Inspector/AudioWaveform.tsx
// Audio waveform: visual representation of audio amplitude
// Uses a simple canvas-based renderer with simulated waveform data
// (real data would come from Web Audio API decodeAudioData when online)
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Group, Text, ActionIcon, Tooltip, Progress,
} from '@mantine/core';
import {
  IconPlayerPlay, IconPlayerPause, IconPlayerStop,
} from '@tabler/icons-react';

// ============================================================================
// Props
// ============================================================================

export interface AudioWaveformProps {
  /** Duration in ms */
  durationMs: number;
  /** Whether playback is possible (volume online) */
  canPlay: boolean;
  /** File path for potential audio loading */
  filePath?: string;
  /** Accent color */
  color?: string;
}

// ============================================================================
// Generate pseudo-waveform from hash-like seed
// ============================================================================

function generateWaveform(seed: string, bars: number): number[] {
  // Deterministic pseudo-random based on seed string
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  const data: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = ((h * 1103515245 + 12345) & 0x7fffffff);
    // Shape: louder in middle, quieter at edges (typical music shape)
    const position = i / bars;
    const envelope = Math.sin(position * Math.PI) * 0.6 + 0.4;
    const random = (h % 100) / 100;
    data.push(random * envelope);
  }
  return data;
}

// ============================================================================
// Waveform canvas
// ============================================================================

function WaveformBars({
  data, progress, color, height, onClick,
}: {
  data: number[]; progress: number; color: string; height: number;
  onClick: (pct: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onClick(Math.max(0, Math.min(1, pct)));
  }, [onClick]);

  const barWidth = 3;
  const gap = 1;
  const totalBars = data.length;

  return (
    <Box
      ref={containerRef}
      h={height}
      onClick={handleClick}
      style={{
        display: 'flex', alignItems: 'center', gap, cursor: 'pointer',
        borderRadius: 'var(--mantine-radius-xs)',
        backgroundColor: 'var(--mantine-color-dark-6)',
        padding: '0 4px',
        overflow: 'hidden',
      }}
    >
      {data.map((amp, i) => {
        const barHeight = Math.max(2, amp * (height - 8));
        const played = i / totalBars <= progress;
        return (
          <Box
            key={i}
            style={{
              width: barWidth,
              height: barHeight,
              borderRadius: 1,
              backgroundColor: played ? color : 'var(--mantine-color-dark-4)',
              transition: 'background-color 60ms ease-out',
              flexShrink: 0,
            }}
          />
        );
      })}
    </Box>
  );
}

// ============================================================================
// Audio Waveform component
// ============================================================================

export default function AudioWaveform({ durationMs, canPlay, filePath, color = '#22c55e' }: AudioWaveformProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  // Generate pseudo-waveform from path
  const waveformData = useRef(generateWaveform(filePath ?? 'default', 80)).current;

  // Simulate playback progress
  useEffect(() => {
    if (playing && canPlay) {
      const step = 50; // ms per tick
      intervalRef.current = setInterval(() => {
        setProgress((p) => {
          const next = p + (step / durationMs);
          if (next >= 1) { setPlaying(false); return 0; }
          return next;
        });
      }, step);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, canPlay, durationMs]);

  const togglePlay = useCallback(() => {
    if (!canPlay) return;
    setPlaying((p) => !p);
  }, [canPlay]);

  const stop = useCallback(() => {
    setPlaying(false);
    setProgress(0);
  }, []);

  const seek = useCallback((pct: number) => {
    setProgress(pct);
  }, []);

  // Format time
  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  };

  const currentMs = Math.floor(progress * durationMs);

  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Forme d'onde</Text>

      {/* Waveform */}
      <WaveformBars data={waveformData} progress={progress} color={color} height={48} onClick={seek} />

      {/* Controls */}
      <Group justify="space-between">
        <Group gap={4}>
          <Tooltip label={playing ? 'Pause' : 'Lecture'}>
            <ActionIcon
              size="sm" variant="subtle"
              color={canPlay ? 'green' : 'gray'}
              disabled={!canPlay}
              onClick={togglePlay}
            >
              {playing ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Stop">
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={stop} disabled={!canPlay}>
              <IconPlayerStop size={14} />
            </ActionIcon>
          </Tooltip>
          {!canPlay && <Text size="xs" c="dimmed">Hors ligne</Text>}
        </Group>
        <Text size="xs" c="dimmed" ff="monospace">
          {formatTime(currentMs)} / {formatTime(durationMs)}
        </Text>
      </Group>
    </Stack>
  );
}
