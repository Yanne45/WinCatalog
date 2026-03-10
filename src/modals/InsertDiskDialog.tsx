// ============================================================================
// WinCatalog — modals/InsertDiskDialog.tsx
// "Insert disk" dialog for offline volume file access
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal, Group, Stack, Text, Button, Badge, Divider, Box,
  CopyButton, ActionIcon, Tooltip, Loader,
} from '@mantine/core';
import {
  IconDisc, IconMapPin, IconHash, IconFolder, IconCopy,
  IconRefresh, IconCheck, IconX,
} from '@tabler/icons-react';
import { volumeApi, volumeEvents, type Volume, type VolumeEvent } from '../api/tauri';

// ============================================================================
// Props
// ============================================================================

export interface InsertDiskDialogProps {
  opened: boolean;
  onClose: () => void;
  /** The volume that is offline */
  volume: Volume | null;
  /** The file path the user tried to access */
  filePath?: string;
  /** Location name (from locations table, resolved by caller) */
  locationName?: string;
  /** Called when the volume comes back online and user wants to retry */
  onRetry?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export default function InsertDiskDialog({
  opened, onClose, volume, filePath, locationName, onRetry,
}: InsertDiskDialogProps) {
  const [checking, setChecking] = useState(false);
  const [detected, setDetected] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Listen for volume reconnection events
  useEffect(() => {
    if (!opened || !volume) return;

    setDetected(false);

    volumeEvents.onEvent((evt: VolumeEvent) => {
      if (evt.type === 'Online' && evt.volume_id === volume.id) {
        setDetected(true);
      }
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    return () => {
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [opened, volume?.id]);

  // Manual retry: check if volume is accessible now
  const handleRetry = useCallback(async () => {
    if (!volume) return;
    setChecking(true);
    try {
      const fresh = await volumeApi.get(volume.id);
      if (fresh?.is_online) {
        setDetected(true);
        onRetry?.();
        onClose();
      }
    } catch { /* ignore */ }
    finally { setChecking(false); }
  }, [volume, onRetry, onClose]);

  // Auto-action when detected
  useEffect(() => {
    if (detected && volume?.auto_detect) {
      // Small delay for UX feedback
      const t = setTimeout(() => {
        onRetry?.();
        onClose();
      }, 800);
      return () => clearTimeout(t);
    }
  }, [detected, volume?.auto_detect, onRetry, onClose]);

  if (!volume) return null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="sm">
          <IconDisc size={20} stroke={1.5} />
          <Text fw={600}>Volume hors ligne</Text>
        </Group>
      }
      size="md"
      centered
    >
      <Stack gap="md">
        {/* Volume info */}
        <Box
          p="md"
          style={{
            backgroundColor: 'var(--mantine-color-default)',
            borderRadius: 'var(--mantine-radius-sm)',
          }}
        >
          <Group justify="space-between" mb="sm">
            <Group gap="sm">
              <IconDisc size={24} stroke={1.5} style={{ color: 'var(--mantine-color-red-5)' }} />
              <div>
                <Text size="md" fw={600}>{volume.label}</Text>
                <Text size="xs" c="dimmed">{volume.root_path}</Text>
              </div>
            </Group>
            <Badge color="red" variant="light" size="sm">Hors ligne</Badge>
          </Group>

          {/* Physical location */}
          {locationName && (
            <Group gap="xs" mt="xs">
              <IconMapPin size={14} style={{ color: 'var(--mantine-color-yellow-5)' }} />
              <Text size="sm">
                Ce disque est rangé dans : <Text span fw={600}>{locationName}</Text>
              </Text>
            </Group>
          )}

          {/* Disk number */}
          {volume.disk_number && (
            <Group gap="xs" mt={4}>
              <IconHash size={14} style={{ color: 'var(--mantine-color-dimmed)' }} />
              <Text size="sm">
                Disque n° <Text span fw={600}>{volume.disk_number}</Text>
              </Text>
            </Group>
          )}
        </Box>

        {/* File path requested */}
        {filePath && (
          <div>
            <Text size="xs" fw={600} c="dimmed" mb={4}>Fichier demandé</Text>
            <Group
              gap="xs"
              p="xs"
              style={{
                backgroundColor: 'var(--mantine-color-default)',
                borderRadius: 'var(--mantine-radius-xs)',
              }}
            >
              <IconFolder size={14} style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
              <Text size="xs" ff="monospace" style={{ flex: 1, wordBreak: 'break-all' }}>
                {filePath}
              </Text>
            </Group>
          </div>
        )}

        {/* Auto-detect feedback */}
        {detected && (
          <Box
            p="sm"
            style={{
              backgroundColor: 'var(--mantine-color-green-light)',
              borderRadius: 'var(--mantine-radius-sm)',
              border: '1px solid var(--mantine-color-green-7)',
            }}
          >
            <Group gap="sm">
              <IconCheck size={16} style={{ color: 'var(--mantine-color-green-5)' }} />
              <Text size="sm" fw={500} c="green">
                Volume détecté ! {volume.auto_detect ? 'Action en cours…' : 'Vous pouvez réessayer.'}
              </Text>
              {volume.auto_detect && <Loader size="xs" color="green" />}
            </Group>
          </Box>
        )}

        {!detected && volume.auto_detect && (
          <Text size="xs" c="dimmed" ta="center">
            Branchez le disque — il sera détecté automatiquement
          </Text>
        )}

        <Divider color="var(--mantine-color-default-border)" />

        {/* Actions */}
        <Group justify="space-between">
          <Group gap="sm">
            {filePath && (
              <CopyButton value={filePath}>
                {({ copied, copy }) => (
                  <Button
                    variant="light"
                    size="xs"
                    color={copied ? 'green' : 'gray'}
                    leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    onClick={copy}
                  >
                    {copied ? 'Copié' : 'Copier le chemin'}
                  </Button>
                )}
              </CopyButton>
            )}
          </Group>

          <Group gap="sm">
            <Button variant="subtle" size="sm" onClick={onClose}>
              Annuler
            </Button>
            <Button
              size="sm"
              leftSection={<IconRefresh size={14} />}
              onClick={handleRetry}
              loading={checking}
              disabled={detected && volume.auto_detect}
            >
              Réessayer
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
