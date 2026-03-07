// ============================================================================
// WinCatalog — modals/CommandPalette.tsx
// Ctrl+K: global search (FTS5), quick nav, actions
// ============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Modal, TextInput, Group, Text, Box, UnstyledButton, Badge,
  ScrollArea, Kbd, Divider, Stack,
} from '@mantine/core';
import {
  IconSearch, IconFolder, IconDisc, IconRefresh, IconCopy,
  IconTag, IconSettings, IconFile, IconArrowRight,
} from '@tabler/icons-react';
import { searchApi, formatBytes, type SearchResult, type FileKind } from '../api/tauri';
import { FILE_KIND_COLORS } from '../app/theme';

// ============================================================================
// Types
// ============================================================================

type Screen = 'dashboard' | 'explorer' | 'scan' | 'doublons' | 'tags' | 'settings';

interface NavAction {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  screen?: Screen;
  context?: any;
  keywords: string[];
}

// ============================================================================
// Built-in navigation actions
// ============================================================================

const NAV_ACTIONS: NavAction[] = [
  { id: 'nav-dashboard',  label: 'Disques',            icon: <IconDisc size={16} />,     screen: 'dashboard', keywords: ['disques', 'dashboard', 'volumes', 'accueil'] },
  { id: 'nav-explorer',   label: 'Explorateur',        icon: <IconFolder size={16} />,   screen: 'explorer',  keywords: ['explorer', 'fichiers', 'naviguer', 'parcourir'] },
  { id: 'nav-scan',       label: 'Scanner',            icon: <IconRefresh size={16} />,  screen: 'scan',      keywords: ['scan', 'scanner', 'indexer', 'analyser'] },
  { id: 'nav-doublons',   label: 'Doublons',           icon: <IconCopy size={16} />,     screen: 'doublons',  keywords: ['doublons', 'duplicates', 'nettoyage', 'doublon'] },
  { id: 'nav-tags',       label: 'Tags & Collections', icon: <IconTag size={16} />,      screen: 'tags',      keywords: ['tags', 'collections', 'organisation', 'étiquettes'] },
  { id: 'nav-settings',   label: 'Paramètres',         icon: <IconSettings size={16} />, screen: 'settings',  keywords: ['paramètres', 'settings', 'configuration', 'options', 'préférences'] },
];

// ============================================================================
// Result row
// ============================================================================

function ResultRow({
  icon, label, description, badge, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  badge?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      w="100%"
      py={8} px="sm"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        borderRadius: 'var(--mantine-radius-sm)',
        backgroundColor: active ? 'var(--mantine-color-primary-9)' : 'transparent',
        transition: 'background-color 80ms ease-out',
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (!active) e.currentTarget.style.backgroundColor = 'var(--mantine-color-dark-6)';
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <Box style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }}>{icon}</Box>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" lineClamp={1}>{label}</Text>
        {description && <Text size="xs" c="dimmed" lineClamp={1}>{description}</Text>}
      </div>
      {badge && (
        <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>{badge}</Badge>
      )}
      <IconArrowRight size={14} style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />
    </UnstyledButton>
  );
}

// ============================================================================
// Command Palette
// ============================================================================

export default function CommandPalette({
  opened, onClose, onNavigate,
}: {
  opened: boolean;
  onClose: () => void;
  onNavigate: (screen: string, context?: any) => void;
}) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset on open
  useEffect(() => {
    if (opened) {
      setQuery('');
      setSearchResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [opened]);

  // Search with debounce
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchApi.entries(query.trim(), 20);
        setSearchResults(results);
        setActiveIndex(0);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Filter navigation actions by query
  const filteredActions = useMemo(() => {
    if (!query.trim()) return NAV_ACTIONS;
    const q = query.toLowerCase();
    return NAV_ACTIONS.filter((a) =>
      a.label.toLowerCase().includes(q) ||
      a.keywords.some((k) => k.includes(q))
    );
  }, [query]);

  // Build combined results list
  const allItems = useMemo(() => {
    const items: Array<{
      type: 'action' | 'file';
      id: string;
      label: string;
      description?: string;
      icon: React.ReactNode;
      badge?: string;
      onSelect: () => void;
    }> = [];

    // Nav actions first
    for (const action of filteredActions) {
      items.push({
        type: 'action',
        id: action.id,
        label: action.label,
        description: action.description,
        icon: action.icon,
        badge: 'Navigation',
        onSelect: () => {
          if (action.screen) onNavigate(action.screen, action.context);
          onClose();
        },
      });
    }

    // File search results
    for (const result of searchResults) {
      const kindInfo = FILE_KIND_COLORS[result.kind as keyof typeof FILE_KIND_COLORS] ?? FILE_KIND_COLORS.other;
      items.push({
        type: 'file',
        id: `file-${result.id}`,
        label: result.name,
        description: result.path,
        icon: <IconFile size={16} style={{ color: kindInfo.color }} />,
        badge: formatBytes(result.size_bytes),
        onSelect: () => {
          onNavigate('explorer', { volumeId: result.volume_id, path: result.path });
          onClose();
        },
      });
    }

    return items;
  }, [filteredActions, searchResults, onNavigate, onClose]);

  // Clamp active index
  useEffect(() => {
    if (activeIndex >= allItems.length) setActiveIndex(Math.max(0, allItems.length - 1));
  }, [allItems.length, activeIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, allItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        allItems[activeIndex]?.onSelect();
        break;
      case 'Escape':
        onClose();
        break;
    }
  }, [allItems, activeIndex, onClose]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      size="lg"
      padding={0}
      radius="md"
      yOffset="15vh"
      overlayProps={{ backgroundOpacity: 0.4, blur: 4 }}
      styles={{
        content: {
          backgroundColor: 'var(--mantine-color-dark-7)',
          border: '1px solid var(--mantine-color-dark-4)',
        },
      }}
    >
      {/* Search input */}
      <Box px="md" pt="md" pb="sm">
        <TextInput
          ref={inputRef}
          placeholder="Rechercher fichiers, naviguer, actions…"
          leftSection={<IconSearch size={18} stroke={1.5} />}
          rightSection={
            <Kbd size="xs" style={{ opacity: 0.5 }}>Esc</Kbd>
          }
          size="md"
          variant="unstyled"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          styles={{
            input: {
              fontSize: 16,
              backgroundColor: 'transparent',
              border: 'none',
            },
          }}
        />
      </Box>

      <Divider color="var(--mantine-color-dark-5)" />

      {/* Results */}
      <ScrollArea.Autosize mah={400} type="auto">
        <Box px="xs" py="xs">
          {allItems.length === 0 && query.trim() && (
            <Text size="sm" c="dimmed" ta="center" py="lg">
              Aucun résultat pour « {query} »
            </Text>
          )}

          {/* Show section headers */}
          {filteredActions.length > 0 && (
            <>
              <Text size="xs" fw={600} c="dimmed" px="sm" pt={4} pb={2}>Navigation</Text>
              {allItems
                .filter((item) => item.type === 'action')
                .map((item, idx) => (
                  <ResultRow
                    key={item.id}
                    icon={item.icon}
                    label={item.label}
                    description={item.description}
                    badge={item.badge}
                    active={allItems.indexOf(item) === activeIndex}
                    onClick={item.onSelect}
                  />
                ))}
            </>
          )}

          {searchResults.length > 0 && (
            <>
              <Divider color="var(--mantine-color-dark-5)" my={4} />
              <Text size="xs" fw={600} c="dimmed" px="sm" pt={4} pb={2}>
                Fichiers ({searchResults.length})
              </Text>
              {allItems
                .filter((item) => item.type === 'file')
                .map((item) => (
                  <ResultRow
                    key={item.id}
                    icon={item.icon}
                    label={item.label}
                    description={item.description}
                    badge={item.badge}
                    active={allItems.indexOf(item) === activeIndex}
                    onClick={item.onSelect}
                  />
                ))}
            </>
          )}

          {/* Empty state: show all nav when no query */}
          {!query.trim() && (
            <Text size="xs" c="dimmed" ta="center" py="sm">
              Tapez pour rechercher des fichiers ou naviguer
            </Text>
          )}
        </Box>
      </ScrollArea.Autosize>

      {/* Footer hints */}
      <Divider color="var(--mantine-color-dark-5)" />
      <Group px="md" py={6} justify="center" gap="lg">
        <Group gap={4}>
          <Kbd size="xs">↑↓</Kbd>
          <Text size="xs" c="dimmed">naviguer</Text>
        </Group>
        <Group gap={4}>
          <Kbd size="xs">↵</Kbd>
          <Text size="xs" c="dimmed">ouvrir</Text>
        </Group>
        <Group gap={4}>
          <Kbd size="xs">Esc</Kbd>
          <Text size="xs" c="dimmed">fermer</Text>
        </Group>
      </Group>
    </Modal>
  );
}
