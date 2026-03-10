// ============================================================================
// WinCatalog — components/Inspector/GpsMiniMap.tsx
// Mini-map showing GPS coordinates from EXIF data
// Uses a static OpenStreetMap tile image (no JS map library needed)
// ============================================================================

import { useState, useMemo } from 'react';
import {
  Box, Group, Stack, Text, ActionIcon, Tooltip, Badge,
  CopyButton, Button,
} from '@mantine/core';
import {
  IconMapPin, IconCopy, IconCheck, IconExternalLink,
} from '@tabler/icons-react';

// ============================================================================
// Props
// ============================================================================

export interface GpsMiniMapProps {
  lat: number;
  lon: number;
  /** Zoom level 1-18 (default 13) */
  zoom?: number;
}

// ============================================================================
// Tile math: convert lat/lon to OSM tile coordinates
// ============================================================================

function latLonToTile(lat: number, lon: number, zoom: number): { x: number; y: number; px: number; py: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  // Sub-tile pixel position (256px tiles)
  const px = Math.floor((((lon + 180) / 360) * n - x) * 256);
  const py = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - y) * 256);
  return { x, y, px, py };
}

function tileUrl(x: number, y: number, z: number): string {
  // OpenStreetMap tile server
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

// ============================================================================
// Format coordinates
// ============================================================================

function formatDMS(decimal: number, isLat: boolean): string {
  const abs = Math.abs(decimal);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  const dir = isLat ? (decimal >= 0 ? 'N' : 'S') : (decimal >= 0 ? 'E' : 'W');
  return `${d}°${m}'${s}" ${dir}`;
}

function formatDecimal(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

// ============================================================================
// Component
// ============================================================================

export default function GpsMiniMap({ lat, lon, zoom = 13 }: GpsMiniMapProps) {
  const [showDMS, setShowDMS] = useState(false);

  const tile = useMemo(() => latLonToTile(lat, lon, zoom), [lat, lon, zoom]);

  // We load a 3x3 grid of tiles for a wider view, centering the pin
  const tiles = useMemo(() => {
    const result: { url: string; x: number; y: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        result.push({
          url: tileUrl(tile.x + dx, tile.y + dy, zoom),
          x: dx,
          y: dy,
        });
      }
    }
    return result;
  }, [tile, zoom]);

  // Pin position within the 3x3 grid (768x768 viewport, cropped to 250x150)
  const pinX = 256 + tile.px; // center tile starts at 256px
  const pinY = 256 + tile.py;

  // Viewport offset to center the pin
  const viewW = 250;
  const viewH = 140;
  const offsetX = Math.max(0, Math.min(768 - viewW, pinX - viewW / 2));
  const offsetY = Math.max(0, Math.min(768 - viewH, pinY - viewH / 2));

  const coordText = showDMS
    ? `${formatDMS(lat, true)} ${formatDMS(lon, false)}`
    : formatDecimal(lat, lon);

  const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;

  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Group gap={4}>
          <IconMapPin size={12} style={{ color: 'var(--mantine-color-yellow-5)' }} />
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Position GPS</Text>
        </Group>
        <Badge
          size="xs" variant="outline" color="gray"
          style={{ cursor: 'pointer' }}
          onClick={() => setShowDMS((v) => !v)}
        >
          {showDMS ? 'DMS' : 'Déc'}
        </Badge>
      </Group>

      {/* Map viewport */}
      <Box
        style={{
          width: viewW,
          height: viewH,
          borderRadius: 'var(--mantine-radius-sm)',
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: 'var(--mantine-color-default)',
        }}
      >
        {/* Tile grid (positioned to show the pin area) */}
        <Box style={{
          position: 'absolute',
          top: -offsetY,
          left: -offsetX,
          width: 768,
          height: 768,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 256px)',
          gridTemplateRows: 'repeat(3, 256px)',
        }}>
          {tiles.map((t) => (
            <img
              key={`${t.x}-${t.y}`}
              src={t.url}
              alt=""
              width={256} height={256}
              style={{ display: 'block' }}
              loading="lazy"
              crossOrigin="anonymous"
            />
          ))}
        </Box>

        {/* Pin marker */}
        <Box style={{
          position: 'absolute',
          left: pinX - offsetX - 8,
          top: pinY - offsetY - 20,
          width: 16,
          height: 20,
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          {/* SVG pin */}
          <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z"
              fill="#ef4444" />
            <circle cx="8" cy="8" r="3" fill="white" />
          </svg>
        </Box>

        {/* Attribution (required by OSM) */}
        <Text fz={8} c="dimmed" style={{
          position: 'absolute', bottom: 2, right: 4, zIndex: 5,
          backgroundColor: 'rgba(0,0,0,0.5)', padding: '0 3px', borderRadius: 2,
        }}>
          © OpenStreetMap
        </Text>
      </Box>

      {/* Coordinates + actions */}
      <Group justify="space-between">
        <Text size="xs" c="dimmed" ff="monospace">{coordText}</Text>
        <Group gap={4}>
          <CopyButton value={formatDecimal(lat, lon)}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copié' : 'Copier coordonnées'}>
                <ActionIcon size="xs" variant="subtle" color={copied ? 'green' : 'gray'} onClick={copy}>
                  {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
          <Tooltip label="Ouvrir dans OpenStreetMap">
            <ActionIcon size="xs" variant="subtle" color="gray" component="a" href={osmUrl} target="_blank">
              <IconExternalLink size={12} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Stack>
  );
}
