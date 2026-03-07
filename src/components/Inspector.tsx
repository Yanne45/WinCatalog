// ============================================================================
// WinCatalog — components/Inspector.tsx
// Adaptive inspector panel: metadata by kind, tags, custom fields, AI section
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Box, Group, Stack, Text, Badge, Divider, ActionIcon, Button,
  ScrollArea, TextInput, Select, Tooltip, Loader,
} from '@mantine/core';
import {
  IconX, IconFolder, IconFile, IconMapPin, IconCamera,
  IconMusic, IconVideo, IconFileText, IconBrain, IconTag,
  IconCopy, IconCheck, IconExternalLink,
} from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import {
  entryApi, tagApi, formatBytes, formatDate,
  type Entry, type EntrySlim, type FileKind,
} from '../api/tauri';
import { FILE_KIND_COLORS } from '../app/theme';
import AudioWaveform from './Inspector/AudioWaveform';
import GpsMiniMap from './Inspector/GpsMiniMap';
import ImageHistogram from './Inspector/ImageHistogram';

// ============================================================================
// Types for metadata
// ============================================================================

interface ImageMeta {
  width?: number; height?: number; camera_make?: string; camera_model?: string;
  iso?: number; focal_length?: number; aperture?: number; shutter_speed?: string;
  gps_lat?: number; gps_lon?: number; taken_at?: number;
}

interface AudioMeta {
  duration_ms?: number; artist?: string; album?: string; title?: string;
  track_number?: number; genre?: string; year?: number; bitrate?: number;
  sample_rate?: number; channels?: number;
}

interface VideoMeta {
  duration_ms?: number; width?: number; height?: number; fps?: number;
  video_codec?: string; audio_codec?: string; bitrate?: number; container?: string;
}

interface DocumentMeta {
  format?: string; page_count?: number; title?: string; author?: string;
}

interface AiAnnotation {
  kind: string; value: string; confidence?: number; source: string;
}

interface CustomFieldValue {
  field_id: number; field_name: string; field_type: string; value: string | null;
}

interface TagInfo { id: number; name: string; color: string | null; }

// ============================================================================
// Props
// ============================================================================

export interface InspectorProps {
  /** Selected entry (slim from list, or null) */
  entrySlim: EntrySlim | null;
  /** All available tags for quick-add */
  allTags: TagInfo[];
  /** Close the inspector */
  onClose: () => void;
  /** Filter by tag click */
  onTagFilter: (tagId: number) => void;
  /** Tag was added (for parent refresh) */
  onTagChanged?: () => void;
}

// ============================================================================
// Metadata loaders
// ============================================================================

async function loadFullEntry(id: number): Promise<Entry | null> {
  return entryApi.get(id);
}

async function loadMeta<T>(table: string, entryId: number): Promise<T | null> {
  try {
    // Generic: query the meta table. Since we don't have a dedicated command per table,
    // we'll use get_entry which returns the full entry. For typed meta, we'd need
    // dedicated commands. For now, return null — the real data comes when extractors run.
    return null;
  } catch { return null; }
}

async function loadAiAnnotations(entryId: number): Promise<AiAnnotation[]> {
  try {
    // Would need a dedicated command: get_ai_annotations
    return [];
  } catch { return []; }
}

async function loadCustomValues(entryId: number): Promise<CustomFieldValue[]> {
  try {
    const raw = await invoke<[number, string, string, string | null][]>('get_entry_custom_values', { entryId });
    return raw.map(([field_id, field_name, field_type, value]) => ({ field_id, field_name, field_type, value }));
  } catch { return []; }
}

// ============================================================================
// Kind-specific sections
// ============================================================================

function ImageSection({ meta, filePath }: { meta: ImageMeta | null; filePath?: string }) {
  if (!meta) return null;
  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>EXIF</Text>
      {meta.width && meta.height && <Row label="Dimensions" value={`${meta.width} × ${meta.height}`} />}
      {meta.camera_make && <Row label="Appareil" value={`${meta.camera_make} ${meta.camera_model ?? ''}`} />}
      {meta.iso && <Row label="ISO" value={String(meta.iso)} />}
      {meta.focal_length && <Row label="Focale" value={`${meta.focal_length}mm`} />}
      {meta.aperture && <Row label="Ouverture" value={`f/${meta.aperture}`} />}
      {meta.shutter_speed && <Row label="Vitesse" value={meta.shutter_speed} />}
      {meta.taken_at && <Row label="Prise le" value={formatDate(meta.taken_at)} />}
      {filePath && <ImageHistogram seed={filePath} />}
      {meta.gps_lat != null && meta.gps_lon != null && (
        <GpsMiniMap lat={meta.gps_lat} lon={meta.gps_lon} />
      )}
    </Stack>
  );
}

function AudioSection({ meta, filePath, isOnline }: { meta: AudioMeta | null; filePath?: string; isOnline?: boolean }) {
  if (!meta) return null;
  const dur = meta.duration_ms ? `${Math.floor(meta.duration_ms / 60000)}:${String(Math.floor((meta.duration_ms % 60000) / 1000)).padStart(2, '0')}` : null;
  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Audio</Text>
      {meta.title && <Row label="Titre" value={meta.title} />}
      {meta.artist && <Row label="Artiste" value={meta.artist} />}
      {meta.album && <Row label="Album" value={meta.album} />}
      {dur && <Row label="Durée" value={dur} />}
      {meta.genre && <Row label="Genre" value={meta.genre} />}
      {meta.year && <Row label="Année" value={String(meta.year)} />}
      {meta.bitrate && <Row label="Bitrate" value={`${meta.bitrate} kbps`} />}
      {meta.sample_rate && <Row label="Sample rate" value={`${meta.sample_rate} Hz`} />}
      {meta.channels && <Row label="Canaux" value={String(meta.channels)} />}
      {meta.duration_ms && meta.duration_ms > 0 && (
        <AudioWaveform
          durationMs={meta.duration_ms}
          canPlay={isOnline ?? true}
          filePath={filePath}
        />
      )}
    </Stack>
  );
}

function VideoSection({ meta }: { meta: VideoMeta | null }) {
  if (!meta) return null;
  const dur = meta.duration_ms ? `${Math.floor(meta.duration_ms / 60000)}:${String(Math.floor((meta.duration_ms % 60000) / 1000)).padStart(2, '0')}` : null;
  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Vidéo</Text>
      {meta.width && meta.height && <Row label="Résolution" value={`${meta.width}×${meta.height}`} />}
      {dur && <Row label="Durée" value={dur} />}
      {meta.fps && <Row label="FPS" value={meta.fps.toFixed(1)} />}
      {meta.video_codec && <Row label="Codec vidéo" value={meta.video_codec} />}
      {meta.audio_codec && <Row label="Codec audio" value={meta.audio_codec} />}
      {meta.bitrate && <Row label="Bitrate" value={`${meta.bitrate} kbps`} />}
      {meta.container && <Row label="Conteneur" value={meta.container} />}
    </Stack>
  );
}

function DocumentSection({ meta }: { meta: DocumentMeta | null }) {
  if (!meta) return null;
  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Document</Text>
      {meta.page_count && <Row label="Pages" value={String(meta.page_count)} />}
      {meta.title && <Row label="Titre" value={meta.title} />}
      {meta.author && <Row label="Auteur" value={meta.author} />}
      {meta.format && <Row label="Format" value={meta.format} />}
    </Stack>
  );
}

// ============================================================================
// AI section
// ============================================================================

function AiSection({ entryId, kind, annotations }: { entryId: number; kind: FileKind; annotations: AiAnnotation[] }) {
  const [loading, setLoading] = useState(false);
  const docType = annotations.find((a) => a.kind === 'doc_type');
  const labels = annotations.filter((a) => a.kind === 'label');
  const summary = annotations.find((a) => a.kind === 'summary');

  const handleClassify = useCallback(async () => {
    setLoading(true);
    try { await invoke('ai_classify', { entryId }); } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [entryId]);

  const handleSummarize = useCallback(async () => {
    setLoading(true);
    try { await invoke('ai_summarize', { entryId }); } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [entryId]);

  const handleAnalyzeImage = useCallback(async () => {
    setLoading(true);
    try { await invoke('ai_analyze_image', { entryId }); } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [entryId]);

  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>
        <IconBrain size={12} style={{ marginRight: 4 }} />IA
      </Text>
      {docType && <Row label="Type détecté" value={docType.value} />}
      {labels.length > 0 && (
        <Group gap={4}>
          {labels.map((l, i) => <Badge key={i} size="xs" variant="light">{l.value}</Badge>)}
        </Group>
      )}
      {summary && <Text size="xs" c="dimmed" lineClamp={4}>{summary.value}</Text>}

      <Group gap="xs" mt={4}>
        {(kind === 'document' || kind === 'text') && !docType && (
          <Button size="xs" variant="light" loading={loading} onClick={handleClassify}>Classifier</Button>
        )}
        {(kind === 'document' || kind === 'text') && !summary && (
          <Button size="xs" variant="light" loading={loading} onClick={handleSummarize}>Résumer</Button>
        )}
        {kind === 'image' && labels.length === 0 && (
          <Button size="xs" variant="light" loading={loading} onClick={handleAnalyzeImage}>Analyser image</Button>
        )}
      </Group>
    </Stack>
  );
}

// ============================================================================
// Custom fields section
// ============================================================================

function CustomFieldsSection({ entryId, fields }: { entryId: number; fields: CustomFieldValue[] }) {
  const [values, setValues] = useState(fields);

  useEffect(() => { setValues(fields); }, [fields]);

  const handleChange = useCallback(async (fieldId: number, value: string | null) => {
    try {
      await invoke('set_entry_custom_value', { entryId, fieldId, value });
      setValues((prev) => prev.map((f) => f.field_id === fieldId ? { ...f, value } : f));
    } catch {}
  }, [entryId]);

  if (fields.length === 0) return null;

  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Champs personnalisés</Text>
      {values.map((f) => (
        <Group key={f.field_id} justify="space-between">
          <Text size="xs" c="dimmed" w={100}>{f.field_name}</Text>
          {f.field_type === 'boolean' ? (
            <Badge size="xs" variant="light" color={f.value === 'true' ? 'green' : 'gray'}
              style={{ cursor: 'pointer' }}
              onClick={() => handleChange(f.field_id, f.value === 'true' ? 'false' : 'true')}>
              {f.value === 'true' ? 'Oui' : 'Non'}
            </Badge>
          ) : (
            <TextInput size="xs" w={140} value={f.value ?? ''} placeholder="—"
              onChange={(e) => handleChange(f.field_id, e.currentTarget.value || null)} />
          )}
        </Group>
      ))}
    </Stack>
  );
}

// ============================================================================
// Tags section
// ============================================================================

function TagsSection({ entryId, entryTags, allTags, onTagFilter, onTagChanged }: {
  entryId: number; entryTags: TagInfo[]; allTags: TagInfo[];
  onTagFilter: (id: number) => void; onTagChanged?: () => void;
}) {
  const unassigned = allTags.filter((t) => !entryTags.some((et) => et.id === t.id));

  const addTag = useCallback(async (tagId: number) => {
    await tagApi.tagEntry(entryId, tagId);
    onTagChanged?.();
  }, [entryId, onTagChanged]);

  const removeTag = useCallback(async (tagId: number) => {
    await invoke('untag_entry', { entryId, tagId });
    onTagChanged?.();
  }, [entryId, onTagChanged]);

  return (
    <Stack gap={6}>
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Tags</Text>
      <Group gap={4}>
        {entryTags.map((t) => (
          <Badge key={t.id} size="sm" variant="light" color={t.color ?? 'gray'} style={{ cursor: 'pointer' }}
            rightSection={<ActionIcon variant="transparent" size={12} onClick={(e: React.MouseEvent) => { e.stopPropagation(); removeTag(t.id); }}>
              <IconX size={8} /></ActionIcon>}
            onClick={() => onTagFilter(t.id)}>
            {t.name}
          </Badge>
        ))}
        {entryTags.length === 0 && <Text size="xs" c="dimmed">Aucun tag</Text>}
      </Group>
      {unassigned.length > 0 && (
        <Group gap={4}>
          {unassigned.slice(0, 5).map((t) => (
            <Badge key={t.id} size="xs" variant="outline" color={t.color ?? 'gray'}
              style={{ cursor: 'pointer', opacity: 0.6 }}
              onClick={() => addTag(t.id)}>+ {t.name}</Badge>
          ))}
        </Group>
      )}
    </Stack>
  );
}

// ============================================================================
// Helper row
// ============================================================================

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Group justify="space-between">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text size="xs" fw={500} lineClamp={1} maw={160} ta="right">{value}</Text>
    </Group>
  );
}

// ============================================================================
// Inspector
// ============================================================================

export default function Inspector({ entrySlim, allTags, onClose, onTagFilter, onTagChanged }: InspectorProps) {
  const [fullEntry, setFullEntry] = useState<Entry | null>(null);
  const [entryTags, setEntryTags] = useState<TagInfo[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldValue[]>([]);
  const [aiAnnotations, setAiAnnotations] = useState<AiAnnotation[]>([]);
  // Typed meta (loaded when we have commands)
  const [imageMeta, setImageMeta] = useState<ImageMeta | null>(null);
  const [audioMeta, setAudioMeta] = useState<AudioMeta | null>(null);
  const [videoMeta, setVideoMeta] = useState<VideoMeta | null>(null);
  const [docMeta, setDocMeta] = useState<DocumentMeta | null>(null);

  // Load data when entry changes
  useEffect(() => {
    if (!entrySlim) return;
    const id = entrySlim.id;
    loadFullEntry(id).then(setFullEntry);
    tagApi.getEntryTags(id).then((tags) => setEntryTags(tags.map(([i,n,c]) => ({ id: i, name: n, color: c }))));
    loadCustomValues(id).then(setCustomFields);
    loadAiAnnotations(id).then(setAiAnnotations);
  }, [entrySlim?.id]);

  if (!entrySlim) {
    return <Box p="md"><Text size="sm" c="dimmed" ta="center" mt="xl">Sélectionnez un fichier</Text></Box>;
  }

  const info = FILE_KIND_COLORS[entrySlim.kind] ?? FILE_KIND_COLORS.other;

  return (
    <ScrollArea h="100%" type="auto">
      <Stack p="md" gap="md">
        <Group justify="space-between">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={0.5}>Détails</Text>
          <ActionIcon variant="subtle" size="xs" color="gray" onClick={onClose}><IconX size={14} /></ActionIcon>
        </Group>

        {/* Preview */}
        <Box h={140} style={{ borderRadius: 'var(--mantine-radius-sm)', backgroundColor: 'var(--mantine-color-dark-6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {entrySlim.is_dir ? <IconFolder size={48} stroke={1} style={{ color: '#facc15' }} />
            : <Text size={48}>{info.icon}</Text>}
        </Box>

        {/* Name + kind */}
        <div>
          <Text size="sm" fw={600} lineClamp={3}>{entrySlim.name}</Text>
          <Badge size="xs" variant="light" style={{ backgroundColor: `${info.color}18`, color: info.color, border: 'none' }}>
            {info.icon} {entrySlim.kind}
          </Badge>
        </div>

        <Divider color="var(--mantine-color-dark-5)" />

        {/* Common metadata */}
        <Stack gap={6}>
          {!entrySlim.is_dir && <Row label="Taille" value={formatBytes(entrySlim.size_bytes)} />}
          {entrySlim.ext && <Row label="Extension" value={`.${entrySlim.ext}`} />}
          <Row label="Modifié" value={formatDate(entrySlim.mtime)} />
          {fullEntry?.path && <Row label="Chemin" value={fullEntry.path} />}
        </Stack>

        <Divider color="var(--mantine-color-dark-5)" />

        {/* Kind-specific metadata */}
        {entrySlim.kind === 'image' && <ImageSection meta={imageMeta} filePath={fullEntry?.path} />}
        {entrySlim.kind === 'audio' && <AudioSection meta={audioMeta} filePath={fullEntry?.path} />}
        {entrySlim.kind === 'video' && <VideoSection meta={videoMeta} />}
        {entrySlim.kind === 'document' && <DocumentSection meta={docMeta} />}

        {/* AI section (documents + images) */}
        {(entrySlim.kind === 'document' || entrySlim.kind === 'text' || entrySlim.kind === 'image') && (
          <>
            <Divider color="var(--mantine-color-dark-5)" />
            <AiSection entryId={entrySlim.id} kind={entrySlim.kind} annotations={aiAnnotations} />
          </>
        )}

        <Divider color="var(--mantine-color-dark-5)" />

        {/* Tags */}
        <TagsSection entryId={entrySlim.id} entryTags={entryTags} allTags={allTags}
          onTagFilter={onTagFilter} onTagChanged={onTagChanged} />

        {/* Custom fields */}
        {customFields.length > 0 && (
          <>
            <Divider color="var(--mantine-color-dark-5)" />
            <CustomFieldsSection entryId={entrySlim.id} fields={customFields} />
          </>
        )}
      </Stack>
    </ScrollArea>
  );
}
