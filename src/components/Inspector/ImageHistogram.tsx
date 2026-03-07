// ============================================================================
// WinCatalog — components/Inspector/ImageHistogram.tsx
// RGB histogram: shows color channel distribution for images
// Uses pseudo-data (real data would come from canvas pixel analysis)
// ============================================================================

import { useMemo } from 'react';
import { Box, Group, Text, Stack, Badge } from '@mantine/core';

// ============================================================================
// Props
// ============================================================================

export interface ImageHistogramProps {
  /** Seed for deterministic pseudo-data (e.g. file path or hash) */
  seed: string;
  /** Width of the histogram */
  width?: number;
  /** Height of the histogram */
  height?: number;
}

// ============================================================================
// Generate pseudo-histogram data
// ============================================================================

function generateHistogram(seed: string, bins: number): { r: number[]; g: number[]; b: number[] } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }

  const channel = (offset: number): number[] => {
    const data: number[] = [];
    let s = h + offset;
    for (let i = 0; i < bins; i++) {
      s = ((s * 1103515245 + 12345) & 0x7fffffff);
      // Bell curve shape with some noise
      const x = i / bins;
      const bell = Math.exp(-Math.pow((x - 0.5) * 3, 2));
      const noise = (s % 100) / 200;
      data.push(Math.max(0, Math.min(1, bell * 0.8 + noise)));
    }
    return data;
  };

  return { r: channel(1), g: channel(2), b: channel(3) };
}

// ============================================================================
// Component
// ============================================================================

export default function ImageHistogram({ seed, width = 240, height = 60 }: ImageHistogramProps) {
  const data = useMemo(() => generateHistogram(seed, 64), [seed]);
  const bins = data.r.length;
  const barW = Math.max(1, Math.floor(width / bins));

  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Histogramme</Text>
        <Group gap={4}>
          <Badge size="xs" variant="dot" color="red">R</Badge>
          <Badge size="xs" variant="dot" color="green">G</Badge>
          <Badge size="xs" variant="dot" color="blue">B</Badge>
        </Group>
      </Group>

      <Box style={{
        width, height, position: 'relative',
        borderRadius: 'var(--mantine-radius-xs)',
        backgroundColor: 'var(--mantine-color-dark-6)',
        overflow: 'hidden',
      }}>
        {/* Red channel */}
        <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
          <g opacity={0.4}>
            {data.r.map((v, i) => (
              <rect key={`r-${i}`} x={i * barW} y={height - v * height} width={barW} height={v * height} fill="#ef4444" />
            ))}
          </g>
          <g opacity={0.4}>
            {data.g.map((v, i) => (
              <rect key={`g-${i}`} x={i * barW} y={height - v * height} width={barW} height={v * height} fill="#22c55e" />
            ))}
          </g>
          <g opacity={0.4}>
            {data.b.map((v, i) => (
              <rect key={`b-${i}`} x={i * barW} y={height - v * height} width={barW} height={v * height} fill="#3b82f6" />
            ))}
          </g>
        </svg>
      </Box>
    </Stack>
  );
}
