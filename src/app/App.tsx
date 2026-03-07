// ============================================================================
// WinCatalog — app/App.tsx
// AppShell + layout + real screens
// ============================================================================

import { useState, useCallback } from 'react';
import {
  AppShell, Group, Text, ActionIcon, TextInput, Tooltip, Badge,
  UnstyledButton, Stack, Divider, Box, Kbd,
  useMantineColorScheme, ScrollArea, Burger,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import {
  IconSearch, IconBell, IconSun, IconMoon, IconDisc, IconFolder,
  IconRefresh, IconCopy, IconTag, IconSettings,
} from '@tabler/icons-react';

import DashboardScreen from '../features/dashboard/DashboardScreen';
import ExplorerScreen from '../features/explorer/ExplorerScreen';
import ScanScreen from '../features/scan/ScanScreen';
import DoublonsScreen from '../features/doublons/DoublonsScreen';
import SettingsScreen from '../features/settings/SettingsScreen';
import TagsScreen from '../features/tags/TagsScreen';
import StatusBar from '../components/StatusBar';
import CommandPalette from '../modals/CommandPalette';

// ============================================================================
// Types
// ============================================================================

type Screen = 'dashboard' | 'explorer' | 'scan' | 'doublons' | 'tags' | 'settings';

interface NavItem {
  id: Screen;
  icon: React.FC<any>;
  label: string;
  section: string;
}

interface NavigationContext {
  volumeId?: number;
  path?: string;
  mode?: 'full' | 'quick';
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', icon: IconDisc,    label: 'Disques',            section: 'Cœur' },
  { id: 'explorer',  icon: IconFolder,  label: 'Explorateur',        section: 'Cœur' },
  { id: 'scan',      icon: IconRefresh, label: 'Scan',               section: 'Outils' },
  { id: 'doublons',  icon: IconCopy,    label: 'Doublons',           section: 'Outils' },
  { id: 'tags',      icon: IconTag,     label: 'Tags & Collections', section: 'Organisation' },
  { id: 'settings',  icon: IconSettings,label: 'Paramètres',         section: 'Système' },
];

// ============================================================================
// Sidebar
// ============================================================================

function Sidebar({ active, onNavigate, collapsed }: {
  active: Screen; onNavigate: (screen: Screen) => void; collapsed: boolean;
}) {
  const sections = ['Cœur', 'Outils', 'Organisation', 'Système'];

  return (
    <ScrollArea h="100%" type="never">
      <Stack gap={2} p={collapsed ? 'xs' : 'sm'} pt="md">
        {sections.map((section, si) => {
          const items = NAV_ITEMS.filter((n) => n.section === section);
          return (
            <Box key={section}>
              {si > 0 && <Divider my={8} color="var(--mantine-color-dark-5)" />}
              {!collapsed && (
                <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5} mb={4} px="sm">
                  {section}
                </Text>
              )}
              {items.map((item) => {
                const isActive = active === item.id;
                const Icon = item.icon;
                return (
                  <Tooltip key={item.id} label={item.label} position="right" disabled={!collapsed}>
                    <UnstyledButton
                      onClick={() => onNavigate(item.id)}
                      py={8}
                      px={collapsed ? 0 : 'sm'}
                      w="100%"
                      style={{
                        display: 'flex', alignItems: 'center',
                        justifyContent: collapsed ? 'center' : 'flex-start',
                        gap: 10, borderRadius: 'var(--mantine-radius-sm)',
                        backgroundColor: isActive ? 'var(--mantine-color-primary-9)' : 'transparent',
                        color: isActive ? 'var(--mantine-color-primary-4)' : 'var(--mantine-color-dark-1)',
                        transition: 'background-color 120ms ease-out',
                      }}
                      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                        if (!isActive) e.currentTarget.style.backgroundColor = 'var(--mantine-color-dark-6)';
                      }}
                      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                        if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <Icon size={20} stroke={1.5} />
                      {!collapsed && <Text size="sm" fw={isActive ? 600 : 400}>{item.label}</Text>}
                    </UnstyledButton>
                  </Tooltip>
                );
              })}
            </Box>
          );
        })}
      </Stack>
    </ScrollArea>
  );
}

// ============================================================================
// Topbar
// ============================================================================

function Topbar({ onToggleSidebar, sidebarCollapsed, onOpenSearch }: {
  onToggleSidebar: () => void; sidebarCollapsed: boolean; onOpenSearch: () => void;
}) {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="sm">
        <Burger opened={!sidebarCollapsed} onClick={onToggleSidebar} size="sm" aria-label="Toggle sidebar" />
        <Text fw={700} size="md" c="var(--mantine-color-primary-4)">WinCatalog</Text>
      </Group>

      <TextInput
        placeholder="Rechercher fichiers, dossiers, tags…"
        leftSection={<IconSearch size={16} stroke={1.5} />}
        rightSection={<Group gap={4} mr={4}><Kbd size="xs">Ctrl</Kbd><Kbd size="xs">K</Kbd></Group>}
        rightSectionWidth={72}
        w={420} size="sm" radius="sm" variant="filled" readOnly
        onClick={onOpenSearch}
        style={{ cursor: 'pointer' }}
        styles={{ input: { backgroundColor: 'var(--mantine-color-dark-6)', borderColor: 'var(--mantine-color-dark-5)' } }}
      />

      <Group gap="sm">
        <Tooltip label="Notifications">
          <ActionIcon variant="subtle" size="lg" radius="sm" color="gray">
            <IconBell size={18} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={colorScheme === 'dark' ? 'Mode clair' : 'Mode sombre'}>
          <ActionIcon variant="subtle" size="lg" radius="sm" color="gray" onClick={() => toggleColorScheme()}>
            {colorScheme === 'dark' ? <IconSun size={18} stroke={1.5} /> : <IconMoon size={18} stroke={1.5} />}
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}

// ============================================================================
// App
// ============================================================================

export default function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navContext, setNavContext] = useState<NavigationContext>({});
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Global navigation handler — used by child screens to navigate between features
  const handleNavigate = useCallback((screen: string, context?: any) => {
    setActiveScreen(screen as Screen);
    setNavContext(context ?? {});
  }, []);

  const handleSidebarNavigate = useCallback((screen: Screen) => {
    setActiveScreen(screen);
    setNavContext({});
  }, []);

  // Ctrl+K
  useHotkeys([['mod+K', () => setCommandPaletteOpen(true)]]);

  const renderScreen = () => {
    switch (activeScreen) {
      case 'dashboard':
        return <DashboardScreen onNavigate={handleNavigate} />;
      case 'explorer':
        return (
          <ExplorerScreen
            initialVolumeId={navContext.volumeId}
            initialPath={navContext.path}
            onNavigateApp={handleNavigate}
          />
        );
      case 'scan':
        return (
          <ScanScreen
            initialVolumeId={navContext.volumeId}
            initialMode={navContext.mode}
            onNavigate={handleNavigate}
          />
        );
      case 'doublons':
        return <DoublonsScreen />;
      case 'tags':
        return <TagsScreen />;
      case 'settings':
        return <SettingsScreen />;
      default:
        return <DashboardScreen onNavigate={handleNavigate} />;
    }
  };

  return (
    <>
      <AppShell
        header={{ height: 48 }}
        navbar={{ width: sidebarCollapsed ? 56 : 220, breakpoint: 0 }}
        footer={{ height: 28 }}
        padding={0}
        styles={{
          main: { backgroundColor: 'var(--mantine-color-dark-8)', minHeight: '100vh' },
          header: { backgroundColor: 'var(--mantine-color-dark-7)', borderBottom: '1px solid var(--mantine-color-dark-5)' },
          navbar: { backgroundColor: 'var(--mantine-color-dark-7)', borderRight: '1px solid var(--mantine-color-dark-5)', transition: 'width 180ms ease-out' },
          footer: { backgroundColor: 'var(--mantine-color-dark-7)', borderTop: '1px solid var(--mantine-color-dark-5)' },
        }}
      >
        <AppShell.Header>
          <Topbar
            onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
            sidebarCollapsed={sidebarCollapsed}
            onOpenSearch={() => setCommandPaletteOpen(true)}
          />
        </AppShell.Header>

        <AppShell.Navbar>
          <Sidebar active={activeScreen} onNavigate={handleSidebarNavigate} collapsed={sidebarCollapsed} />
        </AppShell.Navbar>

        <AppShell.Main>{renderScreen()}</AppShell.Main>

        <AppShell.Footer>
          <StatusBar />
        </AppShell.Footer>
      </AppShell>

      <CommandPalette
        opened={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={handleNavigate}
      />
    </>
  );
}
