import { createTheme, MantineColorsTuple, rem } from '@mantine/core';

// Red accent primary color
const primary: MantineColorsTuple = [
  '#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171',
  '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
];

// File kind → color + icon (stable across charts, badges, icons)
export const FILE_KIND_COLORS = {
  image:    { color: '#a78bfa', label: 'Violet',    icon: '🖼' },
  video:    { color: '#60a5fa', label: 'Bleu',      icon: '🎬' },
  audio:    { color: '#4ade80', label: 'Vert',      icon: '🎵' },
  document: { color: '#fb923c', label: 'Orange',    icon: '📄' },
  archive:  { color: '#facc15', label: 'Jaune',     icon: '🗜' },
  ebook:    { color: '#2dd4bf', label: 'Turquoise', icon: '📚' },
  text:     { color: '#94a3b8', label: 'Gris clair', icon: '📝' },
  font:     { color: '#c084fc', label: 'Mauve',     icon: '🔤' },
  dir:      { color: '#64748b', label: 'Gris',      icon: '📁' },
  other:    { color: '#64748b', label: 'Gris',      icon: '📎' },
} as const;

export const FILE_KIND_COLORS_DARK = {
  image: '#8b72d4', video: '#4d8ad4', audio: '#3bb866',
  document: '#d47d30', archive: '#d4ad12', ebook: '#24b8a0',
  text: '#7a8b9e', font: '#a46dd4', dir: '#536173', other: '#536173',
} as const;

export const theme = createTheme({
  primaryColor: 'primary',
  colors: { primary },
  fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Fira Code", Consolas, monospace',
  fontSizes: { xs: rem(11), sm: rem(12.5), md: rem(14), lg: rem(16), xl: rem(20) },
  headings: {
    fontWeight: '600',
    sizes: {
      h1: { fontSize: rem(22), lineHeight: '1.3' },
      h2: { fontSize: rem(18), lineHeight: '1.35' },
      h3: { fontSize: rem(16), lineHeight: '1.4' },
      h4: { fontSize: rem(14), lineHeight: '1.45' },
    },
  },
  spacing: { xs: rem(4), sm: rem(8), md: rem(16), lg: rem(24), xl: rem(32) },
  radius: { xs: rem(4), sm: rem(6), md: rem(8), lg: rem(12), xl: rem(16) },
  defaultRadius: 'sm',
  shadows: {
    xs: '0 1px 2px rgba(0,0,0,0.05)', sm: '0 1px 3px rgba(0,0,0,0.08)',
    md: '0 4px 6px rgba(0,0,0,0.08)', lg: '0 8px 16px rgba(0,0,0,0.10)',
    xl: '0 16px 32px rgba(0,0,0,0.12)',
  },
  components: {
    Button: { defaultProps: { size: 'sm', radius: 'sm' } },
    ActionIcon: { defaultProps: { variant: 'subtle', radius: 'sm' } },
    TextInput: { defaultProps: { size: 'sm', radius: 'sm' } },
    Select: { defaultProps: { size: 'sm', radius: 'sm' } },
    Modal: { defaultProps: { radius: 'md', overlayProps: { backgroundOpacity: 0.55, blur: 3 } } },
    Drawer: { defaultProps: { overlayProps: { backgroundOpacity: 0.35, blur: 2 } } },
    Tooltip: { defaultProps: { withArrow: true, arrowSize: 6, openDelay: 400 } },
    Badge: { defaultProps: { size: 'sm', radius: 'sm', variant: 'light' } },
    Paper: { defaultProps: { radius: 'sm' } },
    Table: { defaultProps: { striped: false, highlightOnHover: true, withTableBorder: false, withColumnBorders: false } },
    Tabs: { defaultProps: { radius: 'sm' } },
  },
  cursorType: 'pointer',
  focusRing: 'auto',
  respectReducedMotion: true,
  autoContrast: true,
});
