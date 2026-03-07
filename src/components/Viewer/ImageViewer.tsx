// ============================================================================
// WinCatalog — components/Viewer/ImageViewer.tsx
// Full-screen image viewer: zoom/pan, filmstrip, diaporama, keyboard shortcuts
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal, Group, Stack, Text, Box, ActionIcon, Tooltip, Badge,
  Slider, Transition, Drawer, Divider,
} from '@mantine/core';
import { useHotkeys, useInterval } from '@mantine/hooks';
import {
  IconChevronLeft, IconChevronRight, IconZoomIn, IconZoomOut,
  IconArrowsMaximize, IconMaximize, IconInfoCircle, IconPlayerPlay,
  IconPlayerPause, IconX, IconArrowAutofitHeight, IconPhoto,
} from '@tabler/icons-react';
import { formatBytes, formatDate, type EntrySlim } from '../../api/tauri';

// ============================================================================
// Types
// ============================================================================

type ZoomMode = 'fit' | 'fit-height' | '100' | 'custom';

export interface ImageViewerProps {
  opened: boolean;
  onClose: () => void;
  /** Current image entry */
  entry: EntrySlim | null;
  /** Full path of the image */
  imagePath?: string;
  /** All image entries in the current folder (for filmstrip + nav) */
  siblings: EntrySlim[];
  /** Index of current entry in siblings */
  currentIndex: number;
  /** Navigate to another entry by index */
  onNavigate: (index: number) => void;
}

// ============================================================================
// Zoom controls
// ============================================================================

const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

function nearestZoomStep(zoom: number, direction: 'in' | 'out'): number {
  if (direction === 'in') {
    for (const s of ZOOM_STEPS) { if (s > zoom + 0.01) return s; }
    return ZOOM_STEPS[ZOOM_STEPS.length - 1];
  } else {
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) { if (ZOOM_STEPS[i] < zoom - 0.01) return ZOOM_STEPS[i]; }
    return ZOOM_STEPS[0];
  }
}

// ============================================================================
// Filmstrip thumbnail
// ============================================================================

function FilmstripThumb({
  entry, active, onClick,
}: {
  entry: EntrySlim; active: boolean; onClick: () => void;
}) {
  return (
    <Box
      w={56} h={56}
      onClick={onClick}
      style={{
        borderRadius: 'var(--mantine-radius-xs)',
        border: `2px solid ${active ? 'var(--mantine-color-primary-5)' : 'transparent'}`,
        backgroundColor: 'var(--mantine-color-dark-6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', flexShrink: 0, opacity: active ? 1 : 0.6,
        transition: 'all 80ms ease-out',
      }}
    >
      <IconPhoto size={20} stroke={1} style={{ color: 'var(--mantine-color-dimmed)' }} />
    </Box>
  );
}

// ============================================================================
// Info Panel (EXIF drawer)
// ============================================================================

function InfoPanel({ entry, imagePath, opened, onClose }: {
  entry: EntrySlim | null; imagePath?: string; opened: boolean; onClose: () => void;
}) {
  if (!entry) return null;
  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="sm" withCloseButton
      title={<Text size="sm" fw={600}>Informations</Text>}
      styles={{ content: { backgroundColor: 'var(--mantine-color-dark-7)' }, header: { backgroundColor: 'var(--mantine-color-dark-7)' } }}>
      <Stack gap="sm">
        <Row label="Nom" value={entry.name} />
        <Row label="Taille" value={formatBytes(entry.size_bytes)} />
        <Row label="Extension" value={entry.ext ? `.${entry.ext}` : '—'} />
        <Row label="Modifié" value={formatDate(entry.mtime)} />
        {imagePath && <Row label="Chemin" value={imagePath} />}
        <Divider color="var(--mantine-color-dark-5)" />
        <Text size="xs" c="dimmed">
          Les métadonnées EXIF détaillées (appareil, GPS, ISO…) seront affichées ici
          quand les extracteurs metadata sont exécutés.
        </Text>
      </Stack>
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="xs" fw={500} lineClamp={1} maw={200} ta="right">{value}</Text>
    </Group>
  );
}

// ============================================================================
// Image Viewer
// ============================================================================

export default function ImageViewer({
  opened, onClose, entry, imagePath, siblings, currentIndex, onNavigate,
}: ImageViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit');
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const [showFilmstrip, setShowFilmstrip] = useState(true);
  const [diaporama, setDiaporama] = useState(false);

  const filmstripRef = useRef<HTMLDivElement>(null);

  // Reset on entry change
  useEffect(() => {
    setZoom(1); setZoomMode('fit'); setPanX(0); setPanY(0);
  }, [entry?.id]);

  // Auto-scroll filmstrip to active
  useEffect(() => {
    if (filmstripRef.current) {
      const active = filmstripRef.current.querySelector('[data-active="true"]');
      active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentIndex]);

  // Navigation
  const goPrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  }, [currentIndex, onNavigate]);

  const goNext = useCallback(() => {
    if (currentIndex < siblings.length - 1) onNavigate(currentIndex + 1);
  }, [currentIndex, siblings.length, onNavigate]);

  // Zoom
  const zoomIn = useCallback(() => {
    const next = nearestZoomStep(zoom, 'in');
    setZoom(next); setZoomMode('custom');
  }, [zoom]);

  const zoomOut = useCallback(() => {
    const next = nearestZoomStep(zoom, 'out');
    setZoom(next); setZoomMode('custom');
  }, [zoom]);

  const zoomFit = useCallback(() => { setZoom(1); setZoomMode('fit'); setPanX(0); setPanY(0); }, []);
  const zoomFitHeight = useCallback(() => { setZoom(1); setZoomMode('fit-height'); setPanX(0); setPanY(0); }, []);
  const zoom100 = useCallback(() => { setZoom(1); setZoomMode('100'); setPanX(0); setPanY(0); }, []);

  const toggleDiaporama = useCallback(() => setDiaporama((d) => !d), []);
  const toggleInfo = useCallback(() => setShowInfo((s) => !s), []);

  // Diaporama auto-advance
  const diaporamaInterval = useInterval(() => {
    if (diaporama) goNext();
  }, 4000);

  useEffect(() => {
    if (diaporama) diaporamaInterval.start();
    else diaporamaInterval.stop();
    return diaporamaInterval.stop;
  }, [diaporama]);

  // Double-click toggle fit ↔ 100%
  const handleDoubleClick = useCallback(() => {
    if (zoomMode === 'fit') zoom100();
    else zoomFit();
  }, [zoomMode, zoom100, zoomFit]);

  // Keyboard shortcuts
  useHotkeys(
    opened
      ? [
          ['ArrowLeft', goPrev],
          ['ArrowRight', goNext],
          ['Space', toggleDiaporama],
          ['Escape', onClose],
          ['f', () => {}],  // fullscreen handled by browser
          ['i', toggleInfo],
          ['0', zoomFit],
          ['h', zoomFitHeight],
          ['1', zoom100],
          ['=', zoomIn],
          ['-', zoomOut],
        ]
      : [],
    [],
  );

  if (!entry) return null;

  const zoomPct = Math.round(zoom * 100);

  return (
    <>
      <Modal
        opened={opened} onClose={onClose}
        fullScreen withCloseButton={false} padding={0}
        styles={{
          content: { backgroundColor: '#2a2a2e' }, // neutral gray distinct from app
          body: { height: '100vh', display: 'flex', flexDirection: 'column' },
        }}
      >
        {/* Topbar */}
        <Group h={44} px="md" justify="space-between" style={{
          backgroundColor: 'rgba(0,0,0,0.5)', flexShrink: 0, backdropFilter: 'blur(8px)',
        }}>
          <Group gap="sm">
            <Text size="sm" fw={500} c="white" lineClamp={1}>{entry.name}</Text>
            <Text size="xs" c="gray.4">{currentIndex + 1} / {siblings.length}</Text>
          </Group>

          <Group gap={4}>
            <Badge size="xs" variant="light" color="gray">{zoomPct}%</Badge>

            <Tooltip label="Zoom − (-)"><ActionIcon variant="subtle" color="gray" size="sm" onClick={zoomOut}><IconZoomOut size={16} /></ActionIcon></Tooltip>
            <Tooltip label="Zoom + (+)"><ActionIcon variant="subtle" color="gray" size="sm" onClick={zoomIn}><IconZoomIn size={16} /></ActionIcon></Tooltip>
            <Tooltip label="Ajuster (0)"><ActionIcon variant="subtle" color="gray" size="sm" onClick={zoomFit}><IconArrowsMaximize size={16} /></ActionIcon></Tooltip>
            <Tooltip label="Ajuster hauteur (H)"><ActionIcon variant="subtle" color="gray" size="sm" onClick={zoomFitHeight}><IconArrowAutofitHeight size={16} /></ActionIcon></Tooltip>
            <Tooltip label="100% (1)"><ActionIcon variant="subtle" color="gray" size="sm" onClick={zoom100}><IconMaximize size={16} /></ActionIcon></Tooltip>

            <Divider orientation="vertical" mx={4} color="dark.4" />

            <Tooltip label={diaporama ? 'Pause (Espace)' : 'Diaporama (Espace)'}>
              <ActionIcon variant="subtle" color={diaporama ? 'primary' : 'gray'} size="sm" onClick={toggleDiaporama}>
                {diaporama ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
              </ActionIcon>
            </Tooltip>

            <Tooltip label="Info (I)">
              <ActionIcon variant={showInfo ? 'filled' : 'subtle'} color={showInfo ? 'primary' : 'gray'} size="sm" onClick={toggleInfo}>
                <IconInfoCircle size={16} />
              </ActionIcon>
            </Tooltip>

            <Divider orientation="vertical" mx={4} color="dark.4" />

            <Tooltip label="Fermer (Esc)">
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose}><IconX size={16} /></ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {/* Canvas area */}
        <Box
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: zoomMode === 'custom' ? 'grab' : 'default', position: 'relative' }}
          onDoubleClick={handleDoubleClick}
        >
          {/* Navigation arrows */}
          {currentIndex > 0 && (
            <ActionIcon variant="subtle" color="gray" size="xl" radius="xl"
              onClick={goPrev}
              style={{ position: 'absolute', left: 16, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.4)' }}>
              <IconChevronLeft size={24} />
            </ActionIcon>
          )}
          {currentIndex < siblings.length - 1 && (
            <ActionIcon variant="subtle" color="gray" size="xl" radius="xl"
              onClick={goNext}
              style={{ position: 'absolute', right: 16, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.4)' }}>
              <IconChevronRight size={24} />
            </ActionIcon>
          )}

          {/* Image placeholder */}
          <Box style={{
            transform: `scale(${zoom}) translate(${panX}px, ${panY}px)`,
            transition: zoomMode !== 'custom' ? 'transform 200ms ease-out' : 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* In real app: <img src={convertFileSrc(imagePath)} /> */}
            <Stack align="center" gap="sm">
              <IconPhoto size={120} stroke={0.5} style={{ color: '#555' }} />
              <Text size="sm" c="gray.5">{entry.name}</Text>
              <Text size="xs" c="gray.6">{formatBytes(entry.size_bytes)}</Text>
            </Stack>
          </Box>
        </Box>

        {/* Filmstrip */}
        {showFilmstrip && siblings.length > 1 && (
          <Box ref={filmstripRef} px="md" py={6} style={{
            backgroundColor: 'rgba(0,0,0,0.5)', flexShrink: 0,
            display: 'flex', gap: 6, overflowX: 'auto', backdropFilter: 'blur(8px)',
          }}>
            {siblings.map((s, i) => (
              <Box key={s.id} data-active={i === currentIndex ? 'true' : 'false'}>
                <FilmstripThumb entry={s} active={i === currentIndex} onClick={() => onNavigate(i)} />
              </Box>
            ))}
          </Box>
        )}
      </Modal>

      {/* Info drawer */}
      <InfoPanel entry={entry} imagePath={imagePath} opened={showInfo} onClose={() => setShowInfo(false)} />
    </>
  );
}
