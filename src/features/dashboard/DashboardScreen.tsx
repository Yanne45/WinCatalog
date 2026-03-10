// ============================================================================
// WinCatalog — features/dashboard/DashboardScreen.tsx
// Dashboard with real data from dashboardApi
// ============================================================================

import { lazy, Suspense, useState, useEffect, useCallback, memo } from 'react';
import {
  Box, Group, Stack, Text, Paper, Badge, Button, SimpleGrid,
  RingProgress, Skeleton, ActionIcon, Menu, Tooltip,
} from '@mantine/core';
import {
  IconRefresh, IconPlus, IconDots, IconFolder, IconDisc,
  IconCircleFilled, IconPlayerPlay, IconTrash, IconClock,
} from '@tabler/icons-react';
import {
  volumeApi, dashboardApi, trashApi, formatBytes, formatDate,
  type Volume, type KindStat, type ScanLogEntry, type FolderStat,
} from '../../api/tauri';

const KindDistributionWidget = lazy(() => import('./widgets/KindDistributionWidget'));
const TopFoldersWidget = lazy(() => import('./widgets/TopFoldersWidget'));

const DASHBOARD_CACHE_TTL_MS = 45_000;
const DASHBOARD_ANALYTICS_TTL_MS = 120_000;

type DashboardCache = {
  updatedAt: number;
  analyticsUpdatedAt: number;
  volumes: Volume[];
  kindStats: KindStat[];
  recentLog: ScanLogEntry[];
  topFolders: FolderStat[];
  topFoldersVolumeId: number | null;
  trashCount: number;
  trashSize: number;
};

let dashboardCache: DashboardCache | null = null;

// ============================================================================
// Volume Card
// ============================================================================

const VolumeCard = memo(function VolumeCard({
  volume, onScan, onExplore,
}: {
  volume: Volume;
  onScan: (id: number, mode: 'full' | 'quick') => void;
  onExplore: (volume: Volume) => void;
}) {
  const used = volume.used_bytes ?? 0;
  const total = volume.total_bytes ?? 1;
  const free = volume.free_bytes ?? 0;
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const ringColor = pct > 90 ? 'red' : pct > 75 ? 'orange' : 'primary';

  return (
    <Paper
      p="md" withBorder
      className="wc-card-hover"
      style={{ borderColor: 'var(--mantine-color-default-border)', cursor: 'pointer' }}
      onClick={() => onExplore(volume)}
    >
      <Group justify="space-between" align="flex-start" mb="sm">
        <Group gap="sm">
          <IconDisc size={20} stroke={1.5} style={{ color: 'var(--mantine-color-dimmed)' }} />
          <div>
            <Group gap={6}>
              <Text fw={600} size="sm">{volume.label}</Text>
              <Tooltip label={volume.is_online ? 'En ligne' : 'Hors ligne'}>
                <IconCircleFilled size={8} style={{ color: volume.is_online ? 'var(--mantine-color-green-5)' : 'var(--mantine-color-red-5)' }} />
              </Tooltip>
            </Group>
            <Text size="xs" c="dimmed" lineClamp={1}>{volume.root_path}</Text>
          </div>
        </Group>
        <Menu position="bottom-end" withArrow>
          <Menu.Target>
            <ActionIcon variant="subtle" size="sm" color="gray" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <IconDots size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconPlayerPlay size={14} />} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onScan(volume.id, 'quick'); }}>Quick scan</Menu.Item>
            <Menu.Item leftSection={<IconRefresh size={14} />} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onScan(volume.id, 'full'); }}>Scan complet</Menu.Item>
            <Menu.Item leftSection={<IconFolder size={14} />} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onExplore(volume); }}>Explorer</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <Group gap="lg" align="center">
        <RingProgress
          size={72} thickness={8} roundCaps
          sections={[{ value: pct, color: ringColor }]}
          label={<Text size="xs" ta="center" fw={700}>{pct}%</Text>}
        />
        <Stack gap={2} style={{ flex: 1 }}>
          <Group justify="space-between"><Text size="xs" c="dimmed">Utilisé</Text><Text size="xs" fw={500}>{formatBytes(used)}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Libre</Text><Text size="xs" fw={500}>{formatBytes(free)}</Text></Group>
          <Group justify="space-between"><Text size="xs" c="dimmed">Total</Text><Text size="xs" fw={500}>{formatBytes(total)}</Text></Group>
        </Stack>
      </Group>

      {volume.last_scan_at && (
        <Text size="xs" c="dimmed" mt="sm">
          Dernier scan : {new Date(volume.last_scan_at * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
        </Text>
      )}
    </Paper>
  );
});

// ============================================================================
// Recent Activity (REAL data)
// ============================================================================

const RecentActivity = memo(function RecentActivity({ entries }: { entries: ScanLogEntry[] }) {
  if (entries.length === 0) return null;

  const eventLabels: Record<string, { label: string; color: string }> = {
    added: { label: 'Ajouté', color: 'green' },
    modified: { label: 'Modifié', color: 'yellow' },
    deleted: { label: 'Supprimé', color: 'red' },
    moved: { label: 'Déplacé', color: 'blue' },
    renamed: { label: 'Renommé', color: 'violet' },
  };

  return (
    <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
      <Text fw={600} size="sm" mb="md">Activité récente</Text>
      <Stack gap={4}>
        {entries.slice(0, 10).map((e) => {
          const meta = eventLabels[e.event] ?? { label: e.event, color: 'gray' };
          const name = (e.new_path ?? e.old_path ?? '').split(/[/\\]/).pop() ?? '?';
          return (
            <Group key={e.id} gap="sm" py={2}>
              <Badge size="xs" color={meta.color} variant="light" w={65}>{meta.label}</Badge>
              <Text size="xs" style={{ flex: 1, minWidth: 0 }} lineClamp={1}>{name}</Text>
              <Text size="xs" c="dimmed">{formatDate(e.detected_at)}</Text>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
});

// ============================================================================
// Stats Row
// ============================================================================

const StatsRow = memo(function StatsRow({ volumes, trashCount, trashSize }: { volumes: Volume[]; trashCount: number; trashSize: number }) {
  const totalUsed = volumes.reduce((s, v) => s + (v.used_bytes ?? 0), 0);
  const totalFree = volumes.reduce((s, v) => s + (v.free_bytes ?? 0), 0);
  const onlineCount = volumes.filter((v) => v.is_online).length;

  return (
    <SimpleGrid cols={{ base: 2, lg: 4 }}>
      <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Volumes</Text>
        <Text size="xl" fw={700} mt={4}>{volumes.length}</Text>
        <Text size="xs" c="dimmed">{onlineCount} en ligne</Text>
      </Paper>
      <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Espace utilisé</Text>
        <Text size="xl" fw={700} mt={4}>{formatBytes(totalUsed)}</Text>
        <Text size="xs" c="dimmed">{formatBytes(totalFree)} libre</Text>
      </Paper>
      <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
        <Group gap={6}>
          <IconTrash size={12} style={{ color: 'var(--mantine-color-dimmed)' }} />
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Corbeille</Text>
        </Group>
        <Text size="xl" fw={700} mt={4}>{trashCount}</Text>
        <Text size="xs" c="dimmed">{formatBytes(trashSize)}</Text>
      </Paper>
      <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
        <Group gap={6}>
          <IconClock size={12} style={{ color: 'var(--mantine-color-dimmed)' }} />
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.5}>Dernier scan</Text>
        </Group>
        <Text size="lg" fw={700} mt={4}>
          {(() => {
            const last = volumes.reduce((max, v) => Math.max(max, v.last_scan_at ?? 0), 0);
            return last > 0 ? formatDate(last) : '—';
          })()}
        </Text>
      </Paper>
    </SimpleGrid>
  );
});

// ============================================================================
// Empty State
// ============================================================================

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Box ta="center" py={80}>
      <IconDisc size={48} stroke={1} style={{ color: 'var(--mantine-color-dimmed)', marginBottom: 16 }} />
      <Text size="lg" fw={600} mb="xs">Aucun volume catalogué</Text>
      <Text size="sm" c="dimmed" mb="lg">Ajoutez un disque ou dossier pour commencer à cataloguer vos fichiers.</Text>
      <Button leftSection={<IconPlus size={16} />} onClick={onAdd}>Ajouter un volume</Button>
    </Box>
  );
}

// ============================================================================
// Dashboard Screen
// ============================================================================

export default function DashboardScreen({
  onNavigate,
}: {
  onNavigate: (screen: string, context?: any) => void;
}) {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [kindStats, setKindStats] = useState<KindStat[]>([]);
  const [recentLog, setRecentLog] = useState<ScanLogEntry[]>([]);
  const [topFolders, setTopFolders] = useState<FolderStat[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  const [trashSize, setTrashSize] = useState(0);
  const [loading, setLoading] = useState(true);

  const applyDashboardData = useCallback((data: DashboardCache) => {
    setVolumes(data.volumes);
    setKindStats(data.kindStats);
    setRecentLog(data.recentLog);
    setTopFolders(data.topFolders);
    setTrashCount(data.trashCount);
    setTrashSize(data.trashSize);
  }, []);

  const loadAll = useCallback(async (mode: 'auto' | 'light' | 'full' = 'auto') => {
    const now = Date.now();
    const hasCache = dashboardCache != null;
    const cacheAge = dashboardCache ? (now - dashboardCache.updatedAt) : Number.POSITIVE_INFINITY;
    const cacheIsFresh = cacheAge < DASHBOARD_CACHE_TTL_MS;

    if (mode === 'auto' && cacheIsFresh && dashboardCache) {
      applyDashboardData(dashboardCache);
      setLoading(false);
      return;
    }

    try {
      if (!hasCache) {
        setLoading(true);
      }

      const [vols, log, [tc, ts]] = await Promise.all([
        volumeApi.list(),
        dashboardApi.recentScanLog(undefined, undefined, 15),
        trashApi.summary(),
      ]);

      const firstOnline = vols.find((v) => v.is_online) ?? null;
      const topFoldersVolumeId = firstOnline?.id ?? null;

      const needTopFolders =
        mode === 'full'
        || !dashboardCache
        || dashboardCache.topFoldersVolumeId !== topFoldersVolumeId
        || (now - dashboardCache.updatedAt) >= DASHBOARD_CACHE_TTL_MS;

      const needAnalytics =
        mode === 'full'
        || !dashboardCache
        || (now - dashboardCache.analyticsUpdatedAt) >= DASHBOARD_ANALYTICS_TTL_MS;

      const topFoldersPromise = needTopFolders
        ? (firstOnline
          ? dashboardApi.topFolders(firstOnline.id, firstOnline.root_path, 10)
          : Promise.resolve([] as FolderStat[]))
        : Promise.resolve(dashboardCache?.topFolders ?? []);

      const kindStatsPromise = needAnalytics
        ? dashboardApi.globalKindStats()
        : Promise.resolve(dashboardCache?.kindStats ?? []);

      const [folders, kinds] = await Promise.all([topFoldersPromise, kindStatsPromise]);

      const nextCache: DashboardCache = {
        updatedAt: now,
        analyticsUpdatedAt: needAnalytics ? now : (dashboardCache?.analyticsUpdatedAt ?? now),
        volumes: vols,
        kindStats: kinds,
        recentLog: log,
        topFolders: folders,
        topFoldersVolumeId,
        trashCount: tc,
        trashSize: ts,
      };
      dashboardCache = nextCache;
      applyDashboardData(nextCache);
    } catch (err) {
      console.error('Dashboard load failed:', err);
    } finally {
      setLoading(false);
    }
  }, [applyDashboardData]);

  useEffect(() => { loadAll('auto'); }, [loadAll]);

  const handleScan = useCallback((volumeId: number, mode: 'full' | 'quick') => {
    onNavigate('scan', { volumeId, mode });
  }, [onNavigate]);

  const handleExplore = useCallback((volume: Volume) => {
    onNavigate('explorer', { volumeId: volume.id, path: volume.root_path });
  }, [onNavigate]);

  if (loading) {
    return (
      <Box p="lg">
        <Skeleton height={32} width={200} mb="lg" />
        <SimpleGrid cols={{ base: 2, lg: 4 }} mb="lg">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={90} />)}
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {[1, 2, 3].map((i) => <Skeleton key={i} height={180} />)}
        </SimpleGrid>
      </Box>
    );
  }

  if (volumes.length === 0) {
    return (
      <Box p="lg">
        <Group justify="space-between" mb="lg"><Text size="lg" fw={700}>Disques</Text></Group>
        <EmptyState onAdd={() => onNavigate('scan')} />
      </Box>
    );
  }

  return (
    <Box p="lg">
      {/* Header */}
      <Group justify="space-between" mb="lg">
        <Text size="lg" fw={700}>Disques</Text>
        <Group gap="sm">
          <Button variant="subtle" size="xs" leftSection={<IconRefresh size={14} />} onClick={() => loadAll('light')}>Actualiser</Button>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => onNavigate('scan')}>Scanner</Button>
        </Group>
      </Group>

      {/* Stats */}
      <StatsRow volumes={volumes} trashCount={trashCount} trashSize={trashSize} />

      {/* Volume Cards */}
      <Text size="sm" fw={600} c="dimmed" tt="uppercase" lts={0.5} mt="lg" mb="sm">Volumes</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mb="lg">
        {volumes.map((v) => (
          <VolumeCard key={v.id} volume={v} onScan={handleScan} onExplore={handleExplore} />
        ))}
      </SimpleGrid>

      {/* Widgets row */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} mb="lg">
        <Suspense fallback={<Skeleton height={220} />}><KindDistributionWidget stats={kindStats} /></Suspense>
        <Suspense fallback={<Skeleton height={220} />}><TopFoldersWidget folders={topFolders} /></Suspense>
      </SimpleGrid>

      {/* Recent activity */}
      <RecentActivity entries={recentLog} />
    </Box>
  );
}
