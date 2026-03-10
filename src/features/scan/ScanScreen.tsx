// ============================================================================
// WinCatalog — features/scan/ScanScreen.tsx
// Scan wizard: stepper (source → options → progress → results)
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Group, Stack, Text, Paper, Button, Stepper, SimpleGrid,
  Progress, Badge, Checkbox, NumberInput, TextInput, Divider,
  Skeleton, ActionIcon, Tooltip, Alert,
} from '@mantine/core';
import {
  IconDisc, IconCircleFilled, IconPlayerPlay, IconPlayerPause,
  IconPlayerStop, IconCheck, IconAlertTriangle, IconFolder,
  IconRefresh, IconArrowRight, IconSettings,
} from '@tabler/icons-react';
import {
  volumeApi, scanApi, formatBytes, formatDuration,
  type Volume, type ScanStats, type ScanEvent,
} from '../../api/tauri';

// ============================================================================
// Types
// ============================================================================

type ScanState = 'idle' | 'running' | 'paused' | 'completed' | 'error';

interface ScanProgress {
  phase: string;
  filesProcessed: number;
  dirsProcessed: number;
  bytesFound: number;
}

// ============================================================================
// Volume Selector Card
// ============================================================================

function VolumeSelectCard({
  volume, selected, onClick,
}: {
  volume: Volume;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Paper
      p="sm"
      withBorder
      onClick={onClick}
      style={{
        cursor: 'pointer',
        borderColor: selected ? 'var(--mantine-color-primary-6)' : 'var(--mantine-color-default-border)',
        backgroundColor: selected ? 'var(--mantine-color-primary-light)' : 'transparent',
        transition: 'all 120ms ease-out',
      }}
    >
      <Group gap="sm">
        <IconDisc size={20} stroke={1.5} style={{ color: selected ? 'var(--mantine-color-primary-4)' : 'var(--mantine-color-dimmed)' }} />
        <div style={{ flex: 1 }}>
          <Group gap={6}>
            <Text size="sm" fw={600}>{volume.label}</Text>
            <IconCircleFilled size={8} style={{ color: volume.is_online ? 'var(--mantine-color-green-5)' : 'var(--mantine-color-red-5)' }} />
          </Group>
          <Text size="xs" c="dimmed" lineClamp={1}>{volume.root_path}</Text>
        </div>
        {volume.last_scan_at && (
          <Text size="xs" c="dimmed">
            {new Date(volume.last_scan_at * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
          </Text>
        )}
      </Group>
    </Paper>
  );
}

// ============================================================================
// Progress Display
// ============================================================================

function ScanProgressView({
  state, progress, stats,
}: {
  state: ScanState;
  progress: ScanProgress;
  stats: ScanStats | null;
}) {
  const phaseLabels: Record<string, string> = {
    discovery: '📂 Parcours du système de fichiers',
    diff: '🔄 Comparaison avec le catalogue',
    post_scan: '📊 Planification des tâches',
  };

  if (state === 'completed' && stats) {
    return (
      <Stack gap="md">
        <Alert
          icon={<IconCheck size={18} />}
          title="Scan terminé"
          color="green"
          variant="light"
        >
          Durée : {formatDuration(stats.duration_ms)}
        </Alert>

        <SimpleGrid cols={3}>
          <Paper p="sm" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
            <Text size="xs" c="dimmed">Fichiers</Text>
            <Text size="lg" fw={700}>{stats.files_total.toLocaleString()}</Text>
          </Paper>
          <Paper p="sm" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
            <Text size="xs" c="dimmed">Dossiers</Text>
            <Text size="lg" fw={700}>{stats.dirs_total.toLocaleString()}</Text>
          </Paper>
          <Paper p="sm" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
            <Text size="xs" c="dimmed">Taille totale</Text>
            <Text size="lg" fw={700}>{formatBytes(stats.bytes_total)}</Text>
          </Paper>
        </SimpleGrid>

        <SimpleGrid cols={3}>
          <Paper p="sm" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
            <Text size="xs" c="dimmed">Ajoutés</Text>
            <Text size="md" fw={600} c="green">+{stats.files_added.toLocaleString()}</Text>
          </Paper>
          <Paper p="sm" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
            <Text size="xs" c="dimmed">Modifiés</Text>
            <Text size="md" fw={600} c="yellow">~{stats.files_modified.toLocaleString()}</Text>
          </Paper>
          <Paper p="sm" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
            <Text size="xs" c="dimmed">Supprimés</Text>
            <Text size="md" fw={600} c="red">-{stats.files_deleted.toLocaleString()}</Text>
          </Paper>
        </SimpleGrid>

        {stats.jobs_scheduled > 0 && (
          <Text size="sm" c="dimmed">
            {stats.jobs_scheduled} tâches planifiées (thumbnails, hash, metadata)
          </Text>
        )}

        {stats.errors > 0 && (
          <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light">
            {stats.errors} erreur{stats.errors > 1 ? 's' : ''} pendant le scan
          </Alert>
        )}
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
        <Text size="sm" fw={600} mb="sm">
          {phaseLabels[progress.phase] ?? progress.phase}
        </Text>
        <Progress value={100} size="sm" color="primary" radius="xl" animated={state === 'running'} />
        <Group justify="space-between" mt="sm">
          <Text size="xs" c="dimmed">
            {progress.filesProcessed.toLocaleString()} fichiers • {progress.dirsProcessed.toLocaleString()} dossiers
          </Text>
          <Text size="xs" c="dimmed">
            {formatBytes(progress.bytesFound)}
          </Text>
        </Group>
      </Paper>
    </Stack>
  );
}

// ============================================================================
// Scan Screen
// ============================================================================

export default function ScanScreen({
  initialVolumeId,
  initialMode,
  onNavigate,
}: {
  initialVolumeId?: number;
  initialMode?: 'full' | 'quick';
  onNavigate: (screen: string, context?: any) => void;
}) {
  const [step, setStep] = useState(0);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [loadingVolumes, setLoadingVolumes] = useState(true);
  const [selectedVolumeId, setSelectedVolumeId] = useState<number | null>(initialVolumeId ?? null);
  const [scanMode, setScanMode] = useState<'full' | 'quick'>(initialMode ?? 'full');
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [progress, setProgress] = useState<ScanProgress>({ phase: '', filesProcessed: 0, dirsProcessed: 0, bytesFound: 0 });
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Options
  const [maxDepth, setMaxDepth] = useState<number>(50);
  const [generateThumbs, setGenerateThumbs] = useState(true);
  const [computeHash, setComputeHash] = useState(true);

  // Load volumes
  useEffect(() => {
    volumeApi.list().then((vols) => {
      setVolumes(vols);
      setLoadingVolumes(false);
      if (initialVolumeId && initialMode) {
        // Quick mode: skip to launch
        setStep(2);
      }
    });
  }, [initialVolumeId, initialMode]);

  // Cleanup event listener
  useEffect(() => {
    return () => { unlistenRef.current?.(); };
  }, []);

  const selectedVolume = volumes.find((v) => v.id === selectedVolumeId);

  const startScan = useCallback(async () => {
    if (!selectedVolumeId) return;
    setScanState('running');
    setStep(3);
    setProgress({ phase: 'discovery', filesProcessed: 0, dirsProcessed: 0, bytesFound: 0 });
    setErrors([]);

    // Listen to scan events
    const unlisten = await scanApi.onEvent((event) => {
      switch (event.type) {
        case 'Progress':
          setProgress({
            phase: event.phase ?? '',
            filesProcessed: event.files_processed ?? 0,
            dirsProcessed: event.dirs_processed ?? 0,
            bytesFound: event.bytes_found ?? 0,
          });
          break;
        case 'PhaseComplete':
          setProgress((prev) => ({ ...prev, phase: event.phase ?? prev.phase }));
          break;
        case 'Completed':
          setScanState('completed');
          if (event.stats) setStats(event.stats);
          break;
        case 'Error':
          setErrors((prev) => [...prev.slice(-49), `${event.path}: ${event.error}`]);
          break;
      }
    });
    unlistenRef.current = unlisten;

    try {
      const result = await scanApi.start(selectedVolumeId, scanMode, {
        maxDepth,
        computeHash,
        generateThumbs,
      });
      setScanState('completed');
      setStats(result);
    } catch (err) {
      setScanState('error');
      setErrors((prev) => [...prev, `Scan failed: ${err}`]);
    }
  }, [selectedVolumeId, scanMode, maxDepth, computeHash, generateThumbs]);

  return (
    <Box p="lg" maw={800}>
      <Text size="lg" fw={700} mb="lg">Scanner un volume</Text>

      <Stepper active={step} onStepClick={(s) => { if (scanState === 'idle' && s <= step) setStep(s); }}>
        {/* Step 0: Source */}
        <Stepper.Step label="Source" description="Choisir un volume" icon={<IconDisc size={18} />}>
          <Stack gap="md" mt="md">
            <Text size="sm" c="dimmed">Sélectionnez le volume à scanner :</Text>

            {loadingVolumes ? (
              <Stack gap="sm">
                {[1, 2].map((i) => <Skeleton key={i} height={60} />)}
              </Stack>
            ) : volumes.length === 0 ? (
              <Paper p="lg" withBorder ta="center" style={{ borderColor: 'var(--mantine-color-default-border)' }}>
                <Text size="sm" c="dimmed" mb="sm">Aucun volume enregistré</Text>
                <Button size="xs" variant="light">Ajouter un volume</Button>
              </Paper>
            ) : (
              <Stack gap="sm">
                {volumes.map((v) => (
                  <VolumeSelectCard
                    key={v.id}
                    volume={v}
                    selected={selectedVolumeId === v.id}
                    onClick={() => setSelectedVolumeId(v.id)}
                  />
                ))}
              </Stack>
            )}

            <Group justify="flex-end">
              <Button
                disabled={!selectedVolumeId}
                rightSection={<IconArrowRight size={14} />}
                onClick={() => setStep(1)}
              >
                Suivant
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        {/* Step 1: Options */}
        <Stepper.Step label="Options" description="Configurer le scan" icon={<IconSettings size={18} />}>
          <Stack gap="md" mt="md">
            <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
              <Text size="sm" fw={600} mb="sm">Mode de scan</Text>
              <Group gap="md">
                <Paper
                  p="sm" withBorder style={{
                    flex: 1, cursor: 'pointer',
                    borderColor: scanMode === 'full' ? 'var(--mantine-color-primary-6)' : 'var(--mantine-color-default-border)',
                    backgroundColor: scanMode === 'full' ? 'var(--mantine-color-primary-light)' : 'transparent',
                  }}
                  onClick={() => setScanMode('full')}
                >
                  <Text size="sm" fw={600}>Complet</Text>
                  <Text size="xs" c="dimmed">Parcourt tout, détecte les suppressions</Text>
                </Paper>
                <Paper
                  p="sm" withBorder style={{
                    flex: 1, cursor: 'pointer',
                    borderColor: scanMode === 'quick' ? 'var(--mantine-color-primary-6)' : 'var(--mantine-color-default-border)',
                    backgroundColor: scanMode === 'quick' ? 'var(--mantine-color-primary-light)' : 'transparent',
                  }}
                  onClick={() => setScanMode('quick')}
                >
                  <Text size="sm" fw={600}>Rapide</Text>
                  <Text size="xs" c="dimmed">Ne traite que les changements (mtime/taille)</Text>
                </Paper>
              </Group>
            </Paper>

            <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
              <Text size="sm" fw={600} mb="sm">Options</Text>
              <Stack gap="sm">
                <NumberInput
                  label="Profondeur maximale"
                  size="xs"
                  value={maxDepth}
                  onChange={(v) => setMaxDepth(typeof v === 'number' ? v : 50)}
                  min={1} max={200}
                  w={200}
                />
                <Checkbox
                  label="Générer les miniatures (images, vidéos, documents)"
                  size="xs"
                  checked={generateThumbs}
                  onChange={(e) => setGenerateThumbs(e.currentTarget.checked)}
                />
                <Checkbox
                  label="Calculer les hash (détection de doublons)"
                  size="xs"
                  checked={computeHash}
                  onChange={(e) => setComputeHash(e.currentTarget.checked)}
                />
              </Stack>
            </Paper>

            <Group justify="space-between">
              <Button variant="subtle" onClick={() => setStep(0)}>Retour</Button>
              <Button rightSection={<IconArrowRight size={14} />} onClick={() => setStep(2)}>
                Suivant
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        {/* Step 2: Launch */}
        <Stepper.Step label="Lancement" description="Récapitulatif" icon={<IconPlayerPlay size={18} />}>
          <Stack gap="md" mt="md">
            <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
              <Text size="sm" fw={600} mb="sm">Récapitulatif</Text>
              <Stack gap={6}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Volume</Text>
                  <Text size="xs" fw={500}>{selectedVolume?.label ?? '—'}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Chemin</Text>
                  <Text size="xs" fw={500} lineClamp={1}>{selectedVolume?.root_path ?? '—'}</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Mode</Text>
                  <Badge size="xs" color={scanMode === 'full' ? 'primary' : 'blue'}>
                    {scanMode === 'full' ? 'Complet' : 'Rapide'}
                  </Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Profondeur max</Text>
                  <Text size="xs" fw={500}>{maxDepth}</Text>
                </Group>
              </Stack>
            </Paper>

            <Group justify="space-between">
              <Button variant="subtle" onClick={() => setStep(1)}>Retour</Button>
              <Button
                leftSection={<IconPlayerPlay size={16} />}
                onClick={startScan}
                disabled={!selectedVolumeId}
              >
                Lancer le scan
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>

        {/* Step 3: Progress / Results */}
        <Stepper.Step label="Résultats" description={scanState === 'running' ? 'En cours…' : 'Terminé'} icon={<IconCheck size={18} />}>
          <Box mt="md">
            <ScanProgressView state={scanState} progress={progress} stats={stats} />

            {scanState === 'completed' && stats && (
              <Group mt="lg" gap="sm">
                <Button
                  variant="light"
                  leftSection={<IconFolder size={14} />}
                  onClick={() => onNavigate('explorer', { volumeId: selectedVolumeId, path: selectedVolume?.root_path })}
                >
                  Explorer
                </Button>
                <Button
                  variant="subtle"
                  leftSection={<IconRefresh size={14} />}
                  onClick={() => { setStep(0); setScanState('idle'); setStats(null); }}
                >
                  Nouveau scan
                </Button>
              </Group>
            )}

            {scanState === 'error' && (
              <Alert icon={<IconAlertTriangle size={18} />} color="red" variant="light" mt="md">
                Le scan a échoué. {errors[errors.length - 1]}
              </Alert>
            )}

            {errors.length > 0 && scanState !== 'error' && (
              <Paper p="sm" withBorder mt="md" style={{ borderColor: 'var(--mantine-color-default-border)', maxHeight: 200, overflow: 'auto' }}>
                <Text size="xs" fw={600} c="dimmed" mb="xs">Erreurs ({errors.length})</Text>
                {errors.slice(-20).map((err, i) => (
                  <Text key={i} size="xs" c="yellow" mb={2} lineClamp={1}>{err}</Text>
                ))}
              </Paper>
            )}
          </Box>
        </Stepper.Step>
      </Stepper>
    </Box>
  );
}
