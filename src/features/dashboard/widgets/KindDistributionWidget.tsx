import { memo } from 'react';
import { Box, Group, Paper, Stack, Text } from '@mantine/core';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
} from 'recharts';

import { FILE_KIND_COLORS } from '../../../app/theme';
import { formatBytes, type KindStat } from '../../../api/tauri';

const KIND_LABELS: Record<string, string> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  document: 'Documents',
  archive: 'Archives',
  ebook: 'Ebooks',
  text: 'Texte',
  font: 'Polices',
  dir: 'Dossiers',
  other: 'Autre',
};

const KindDistributionWidget = memo(function KindDistributionWidget({
  stats,
}: {
  stats: KindStat[];
}) {
  if (stats.length === 0) return null;

  const totalBytes = stats.reduce((s, k) => s + k.bytes, 0);
  const data = stats.map((s) => ({
    name: KIND_LABELS[s.kind] ?? s.kind,
    kind: s.kind,
    value: totalBytes > 0 ? Math.round((s.bytes / totalBytes) * 100) : 0,
    bytes: s.bytes,
    count: s.count,
  }));

  return (
    <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
      <Text fw={600} size="sm" mb="md">Repartition par type</Text>
      <Group align="center" gap="lg">
        <ResponsiveContainer width={140} height={140}>
          <PieChart>
            <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={2}>
              {data.map((d) => (
                <Cell key={d.kind} fill={(FILE_KIND_COLORS as Record<string, { color: string }>)[d.kind]?.color ?? '#64748b'} />
              ))}
            </Pie>
            <ReTooltip
              contentStyle={{ backgroundColor: 'var(--mantine-color-body)', border: '1px solid var(--mantine-color-default-border)', borderRadius: 6, fontSize: 12 }}
              formatter={(value: number, _: unknown, entry: any) => [`${value}% (${formatBytes(entry?.payload?.bytes)})`, entry?.payload?.name ?? 'Type']}
            />
          </PieChart>
        </ResponsiveContainer>
        <Stack gap={4}>
          {data.slice(0, 8).map((d) => (
            <Group key={d.kind} gap={8}>
              <Box w={10} h={10} style={{ borderRadius: 2, backgroundColor: (FILE_KIND_COLORS as Record<string, { color: string }>)[d.kind]?.color ?? '#64748b' }} />
              <Text size="xs" c="dimmed" w={80}>{d.name}</Text>
              <Text size="xs" fw={500} w={35} ta="right">{d.value}%</Text>
              <Text size="xs" c="dimmed">{d.count.toLocaleString()}</Text>
            </Group>
          ))}
        </Stack>
      </Group>
    </Paper>
  );
});

export default KindDistributionWidget;
