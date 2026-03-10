// ============================================================================
// WinCatalog — modals/QuickLook.tsx
// Quick Look: Space to preview, ←→ navigate, works offline via cache
// ============================================================================

import { useState, useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Modal, Group, Stack, Text, Box, Button, Badge, Divider,
  ActionIcon, Tooltip, CopyButton,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import {
  IconChevronLeft, IconChevronRight, IconExternalLink,
  IconCopy, IconCheck, IconFolder, IconFile,
  IconMusic, IconVideo, IconPhoto, IconFileText,
} from '@tabler/icons-react';
import { formatBytes, formatDate, type EntrySlim, type FileKind } from '../api/tauri';
import { FILE_KIND_COLORS } from '../app/theme';

// ============================================================================
// Props
// ============================================================================

export interface QuickLookProps {
  opened: boolean;
  onClose: () => void;
  /** Currently previewed entry */
  entry: EntrySlim | null;
  /** Full path of the entry (needed for display) */
  entryPath?: string;
  /** Whether the volume is online */
  isOnline?: boolean;
  /** Navigate to previous entry in the list */
  onPrev: () => void;
  /** Navigate to next entry in the list */
  onNext: () => void;
  /** Open file with system app / trigger InsertDisk if offline */
  onOpen: () => void;
  /** Current index / total for counter display */
  currentIndex?: number;
  totalCount?: number;
}

// ============================================================================
// Preview by kind
// ============================================================================

function PreviewContent({
  entry, isOnline, entryPath,
}: {
  entry: EntrySlim; isOnline: boolean; entryPath?: string;
}) {
  const info = FILE_KIND_COLORS[entry.kind] ?? FILE_KIND_COLORS.other;
  const [mediaError, setMediaError] = useState(false);

  // Reset error state when the entry changes
  useEffect(() => { setMediaError(false); }, [entry.id]);

  const assetSrc = isOnline && entryPath && !mediaError ? convertFileSrc(entryPath) : null;
  const boxStyle = { borderRadius: 'var(--mantine-radius-sm)', overflow: 'hidden' as const };

  switch (entry.kind) {
    case 'image':
      if (assetSrc) {
        return (
          <Box h={350} style={{ ...boxStyle, backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img
              src={assetSrc}
              alt={entry.name}
              onError={() => setMediaError(true)}
              style={{ maxHeight: 350, maxWidth: '100%', objectFit: 'contain', display: 'block' }}
            />
          </Box>
        );
      }
      return (
        <Box h={350} style={{ ...boxStyle, backgroundColor: 'var(--mantine-color-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Stack align="center" gap="xs">
            <IconPhoto size={64} stroke={1} style={{ color: info.color }} />
            <Text size="sm" c="dimmed">{!isOnline ? 'Volume hors ligne' : 'Aperçu indisponible'}</Text>
            {!isOnline && <Badge size="xs" color="yellow" variant="light">Hors ligne</Badge>}
          </Stack>
        </Box>
      );

    case 'video':
      if (assetSrc) {
        return (
          <Box h={350} style={{ ...boxStyle, backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video
              src={assetSrc}
              controls
              onError={() => setMediaError(true)}
              style={{ maxHeight: 350, maxWidth: '100%', display: 'block' }}
            />
          </Box>
        );
      }
      return (
        <Box h={350} style={{ ...boxStyle, backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Stack align="center" gap="xs">
            <IconVideo size={64} stroke={1} style={{ color: info.color }} />
            <Text size="sm" c="dimmed">{!isOnline ? 'Volume hors ligne' : 'Lecteur indisponible'}</Text>
            {!isOnline && <Badge size="xs" color="yellow" variant="light">Volume déconnecté</Badge>}
          </Stack>
        </Box>
      );

    case 'audio':
      return (
        <Box h={250} style={{ ...boxStyle, backgroundColor: 'var(--mantine-color-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Stack align="center" gap="xs" w="100%" px="md">
            <IconMusic size={56} stroke={1} style={{ color: info.color }} />
            {assetSrc ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio
                key={assetSrc}
                src={assetSrc}
                controls
                onError={() => setMediaError(true)}
                style={{ width: '100%', marginTop: 8 }}
              />
            ) : (
              <Text size="sm" c="dimmed">{!isOnline ? 'Volume hors ligne' : 'Lecture indisponible'}</Text>
            )}
            {!isOnline && <Badge size="xs" color="yellow" variant="light">Hors ligne</Badge>}
          </Stack>
        </Box>
      );

    case 'document':
      return (
        <Box h={200} style={{ ...boxStyle, backgroundColor: 'var(--mantine-color-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Stack align="center" gap="xs">
            <IconFileText size={64} stroke={1} style={{ color: info.color }} />
            <Text size="sm" c="dimmed">{entry.ext?.toUpperCase() ?? 'Document'}</Text>
            {!isOnline && <Badge size="xs" color="yellow" variant="light">Hors ligne</Badge>}
          </Stack>
        </Box>
      );

    default:
      return (
        <Box h={180} style={{ ...boxStyle, backgroundColor: 'var(--mantine-color-default)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Stack align="center" gap="xs">
            <Text fz={48}>{info.icon}</Text>
            <Text size="sm" c="dimmed">Aperçu non disponible</Text>
          </Stack>
        </Box>
      );
  }
}

// ============================================================================
// Metadata section
// ============================================================================

function MetadataSection({ entry, entryPath }: { entry: EntrySlim; entryPath?: string }) {
  return (
    <Stack gap={6}>
      {!entry.is_dir && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Taille</Text>
          <Text size="xs" fw={500}>{formatBytes(entry.size_bytes)}</Text>
        </Group>
      )}
      {entry.ext && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Type</Text>
          <Text size="xs" fw={500}>.{entry.ext}</Text>
        </Group>
      )}
      <Group justify="space-between">
        <Text size="xs" c="dimmed">Modifié</Text>
        <Text size="xs" fw={500}>{formatDate(entry.mtime)}</Text>
      </Group>
      {entryPath && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">Chemin</Text>
          <Text size="xs" c="dimmed" lineClamp={1} maw={300} ta="right">{entryPath}</Text>
        </Group>
      )}
    </Stack>
  );
}

// ============================================================================
// Quick Look
// ============================================================================

export default function QuickLook({
  opened, onClose, entry, entryPath, isOnline = true,
  onPrev, onNext, onOpen, currentIndex, totalCount,
}: QuickLookProps) {

  // Keyboard shortcuts (only when opened)
  useHotkeys(
    opened
      ? [
          ['ArrowLeft', onPrev],
          ['ArrowRight', onNext],
          ['Space', onClose],
          ['Escape', onClose],
        ]
      : [],
    [],
  );

  if (!entry) return null;

  const info = FILE_KIND_COLORS[entry.kind] ?? FILE_KIND_COLORS.other;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      size="lg"
      padding={0}
      centered
      overlayProps={{ backgroundOpacity: 0.5, blur: 4 }}
      styles={{
        content: { backgroundColor: 'var(--mantine-color-body)', border: '1px solid var(--mantine-color-default-border)' },
      }}
    >
      {/* Header */}
      <Group px="md" py="sm" justify="space-between" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
        <Group gap="sm">
          <Badge size="sm" style={{ backgroundColor: `${info.color}18`, color: info.color, border: 'none' }}>
            {info.icon} {entry.kind}
          </Badge>
          <Text size="sm" fw={600} lineClamp={1}>{entry.name}</Text>
        </Group>
        {currentIndex != null && totalCount != null && (
          <Text size="xs" c="dimmed">{currentIndex + 1} / {totalCount}</Text>
        )}
      </Group>

      {/* Preview */}
      <Box px="md" py="md">
        <PreviewContent entry={entry} isOnline={isOnline} entryPath={entryPath} />
      </Box>

      {/* Metadata */}
      <Box px="md" pb="sm">
        <MetadataSection entry={entry} entryPath={entryPath} />
      </Box>

      <Divider color="var(--mantine-color-default-border)" />

      {/* Footer: nav + actions */}
      <Group px="md" py="sm" justify="space-between">
        <Group gap="xs">
          <Tooltip label="Précédent (←)">
            <ActionIcon variant="subtle" size="sm" color="gray" onClick={onPrev}>
              <IconChevronLeft size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Suivant (→)">
            <ActionIcon variant="subtle" size="sm" color="gray" onClick={onNext}>
              <IconChevronRight size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <Group gap="sm">
          {entryPath && (
            <CopyButton value={entryPath}>
              {({ copied, copy }) => (
                <Button variant="subtle" size="xs" color={copied ? 'green' : 'gray'}
                  leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />} onClick={copy}>
                  {copied ? 'Copié' : 'Copier chemin'}
                </Button>
              )}
            </CopyButton>
          )}
          <Button size="xs" leftSection={<IconExternalLink size={14} />} onClick={onOpen}>
            Ouvrir
          </Button>
        </Group>
      </Group>
    </Modal>
  );
}
