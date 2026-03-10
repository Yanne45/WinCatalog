import { memo } from 'react';
import { Paper, Text } from '@mantine/core';
import {
  ResponsiveContainer,
  Tooltip as ReTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
} from 'recharts';

import { formatBytes, type FolderStat } from '../../../api/tauri';

const TopFoldersWidget = memo(function TopFoldersWidget({
  folders,
}: {
  folders: FolderStat[];
}) {
  if (folders.length === 0) return null;

  const chartData = folders.slice(0, 10).map((f) => ({
    name: f.name.length > 18 ? `${f.name.slice(0, 16)}…` : f.name,
    bytes: f.bytes_total,
  }));

  return (
    <Paper p="md" withBorder style={{ borderColor: 'var(--mantine-color-default-border)' }}>
      <Text fw={600} size="sm" mb="md">Top dossiers</Text>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 10 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: 'var(--mantine-color-dimmed)' }} />
          <ReTooltip
            contentStyle={{ backgroundColor: 'var(--mantine-color-body)', border: '1px solid var(--mantine-color-default-border)', borderRadius: 6, fontSize: 12 }}
            formatter={(value: number) => [formatBytes(value), 'Taille']}
          />
          <Bar dataKey="bytes" fill="var(--mantine-color-primary-6)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Paper>
  );
});

export default TopFoldersWidget;
