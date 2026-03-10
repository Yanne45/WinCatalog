// ============================================================================
// WinCatalog — components/Inspector/ImageHistogram.tsx
// RGB histogram: real pixel analysis via hidden <canvas> when imageSrc is given
// Falls back to a dimmed placeholder when offline or image unloadable
// ============================================================================

import { useEffect, useRef, useState } from 'react';
import { Box, Group, Text, Stack, Badge } from '@mantine/core';

// ============================================================================
// Props
// ============================================================================

export interface ImageHistogramProps {
  /** convertFileSrc URL — if provided, real pixel data is computed */
  imageSrc?: string;
  width?: number;
  height?: number;
}

// ============================================================================
// Canvas analysis
// ============================================================================

interface HistData { r: number[]; g: number[]; b: number[]; }

function analyzeImage(src: string, bins: number): Promise<HistData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Downsample to at most 200x200 for performance
      const scale = Math.min(1, 200 / Math.max(img.naturalWidth, img.naturalHeight, 1));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('no ctx')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = new Array<number>(bins).fill(0);
      const g = new Array<number>(bins).fill(0);
      const b = new Array<number>(bins).fill(0);
      let max = 0;

      for (let i = 0; i < data.length; i += 4) {
        const ri = Math.floor(data[i] / 256 * bins);
        const gi = Math.floor(data[i + 1] / 256 * bins);
        const bi = Math.floor(data[i + 2] / 256 * bins);
        r[ri]++; g[gi]++; b[bi]++;
      }

      // Normalise to 0-1
      for (let i = 0; i < bins; i++) max = Math.max(max, r[i], g[i], b[i]);
      if (max > 0) {
        for (let i = 0; i < bins; i++) { r[i] /= max; g[i] /= max; b[i] /= max; }
      }

      resolve({ r, g, b });
    };
    img.onerror = () => reject(new Error('load error'));
    img.src = src;
  });
}

// ============================================================================
// Rendering
// ============================================================================

function Bars({ data, width, height }: { data: HistData; width: number; height: number }) {
  const bins = data.r.length;
  const barW = Math.max(1, width / bins);
  return (
    <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
      <g opacity={0.45}>
        {data.r.map((v, i) => <rect key={`r${i}`} x={i * barW} y={height - v * height} width={barW} height={v * height} fill="#ef4444" />)}
      </g>
      <g opacity={0.45}>
        {data.g.map((v, i) => <rect key={`g${i}`} x={i * barW} y={height - v * height} width={barW} height={v * height} fill="#22c55e" />)}
      </g>
      <g opacity={0.45}>
        {data.b.map((v, i) => <rect key={`b${i}`} x={i * barW} y={height - v * height} width={barW} height={v * height} fill="#3b82f6" />)}
      </g>
    </svg>
  );
}

// ============================================================================
// Component
// ============================================================================

const BINS = 64;

export default function ImageHistogram({ imageSrc, width = 240, height = 60 }: ImageHistogramProps) {
  const [data, setData] = useState<HistData | null>(null);
  const [failed, setFailed] = useState(false);
  const srcRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!imageSrc) { setData(null); setFailed(false); return; }
    if (srcRef.current === imageSrc) return; // already loaded
    srcRef.current = imageSrc;
    setData(null); setFailed(false);

    let cancelled = false;
    analyzeImage(imageSrc, BINS)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [imageSrc]);

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
        backgroundColor: 'var(--mantine-color-default)',
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {data ? (
          <Bars data={data} width={width} height={height} />
        ) : (
          <Text size="xs" c="dimmed" style={{ opacity: 0.4, userSelect: 'none' }}>
            {failed ? 'Indisponible' : (imageSrc ? '…' : 'Hors ligne')}
          </Text>
        )}
      </Box>
    </Stack>
  );
}
