// ============================================================================
// WinCatalog — components/Inspector.tsx
// Adaptive inspector panel: metadata by kind, tags, custom fields, AI section
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
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
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  entryApi, tagApi, metaApi, formatBytes, formatDate,
  type Entry, type EntrySlim, type FileKind,
  type MetaImage, type MetaAudio, type MetaVideo, type MetaDocument, type AiAnnotationRow,
} from '../api/tauri';
import { FILE_KIND_COLORS } from '../app/theme';
import AudioWaveform from './Inspector/AudioWaveform';
import GpsMiniMap from './Inspector/GpsMiniMap';
import ImageHistogram from './Inspector/ImageHistogram';

// ============================================================================
// Local aliases (typed meta comes from tauri.ts via metaApi)
// ============================================================================

// Use imported MetaImage, MetaAudio, MetaVideo, MetaDocument, AiAnnotationRow from tauri.ts

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



async function loadCustomValues(entryId: number): Promise<CustomFieldValue[]> {
  try {
    const raw = await invoke<[number, string, string, string | null][]>('get_entry_custom_values', { entryId });
    return raw.map(([field_id, field_name, field_type, value]) => ({ field_id, field_name, field_type, value }));
  } catch { return []; }
}

// ============================================================================
// Kind-specific sections
// ============================================================================

function ImageSection({ meta, filePath }: { meta: MetaImage | null; filePath?: string }) {
  if (!meta) return null;
  const imageSrc = filePath ? convertFileSrc(filePath) : undefined;
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
      <ImageHistogram imageSrc={imageSrc} />
      {meta.gps_lat != null && meta.gps_lon != null && (
        <GpsMiniMap lat={meta.gps_lat} lon={meta.gps_lon} />
      )}
    </Stack>
  );
}

function AudioSection({ meta, filePath, isOnline }: { meta: MetaAudio | null; filePath?: string; isOnline?: boolean }) {
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
        <AudioWaveform durationMs={meta.duration_ms} canPlay={isOnline ?? true} filePath={filePath} />
      )}
    </Stack>
  );
}

function VideoSection({ meta }: { meta: MetaVideo | null }) {
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

function DocumentSection({ meta }: { meta: MetaDocument | null }) {
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

function AiSection({ entryId, kind, annotations }: { entryId: number; kind: FileKind; annotations: AiAnnotationRow[] }) {
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
  const debounceRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => { setValues(fields); }, [fields]);

  const saveField = useCallback(async (fieldId: number, value: string | null) => {
    try {
      await invoke('set_entry_custom_value', { entryId, fieldId, value });
    } catch {}
  }, [entryId]);

  const handleChange = useCallback((fieldId: number, value: string | null) => {
    // Update local state immediately for responsive UI
    setValues((prev) => prev.map((f) => f.field_id === fieldId ? { ...f, value } : f));
    // Debounce the API call
    clearTimeout(debounceRef.current[fieldId]);
    debounceRef.current[fieldId] = setTimeout(() => saveField(fieldId, value), 500);
  }, [saveField]);

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => { Object.values(debounceRef.current).forEach(clearTimeout); };
  }, []);

  const handleBoolToggle = useCallback(async (fieldId: number, currentValue: string | null) => {
    const newValue = currentValue === 'true' ? 'false' : 'true';
    setValues((prev) => prev.map((f) => f.field_id === fieldId ? { ...f, value: newValue } : f));
    await saveField(fieldId, newValue);
  }, [saveField]);

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
              onClick={() => handleBoolToggle(f.field_id, f.value)}>
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
  const [aiAnnotations, setAiAnnotations] = useState<AiAnnotationRow[]>([]);
  const [imageMeta, setImageMeta] = useState<MetaImage | null>(null);
  const [audioMeta, setAudioMeta] = useState<MetaAudio | null>(null);
  const [videoMeta, setVideoMeta] = useState<MetaVideo | null>(null);
  const [docMeta, setDocMeta] = useState<MetaDocument | null>(null);

  // Load data when entry changes
  useEffect(() => {
    if (!entrySlim) return;
    const id = entrySlim.id;
    // Reset typed meta to avoid stale data flashing
    setImageMeta(null); setAudioMeta(null); setVideoMeta(null); setDocMeta(null); setAiAnnotations([]);

    entryApi.get(id).then(setFullEntry);
    tagApi.getEntryTags(id).then((tags) => setEntryTags(tags.map(([i,n,c]) => ({ id: i, name: n, color: c }))));
    loadCustomValues(id).then(setCustomFields);
    metaApi.getAiAnnotations(id).then(setAiAnnotations).catch(() => {});

    // Kind-specific metadata
    switch (entrySlim.kind) {
      case 'image':
        metaApi.getImageMeta(id).then((m) => { if (m) setImageMeta(m); }).catch(() => {});
        break;
      case 'audio':
        metaApi.getAudioMeta(id).then((m) => { if (m) setAudioMeta(m); }).catch(() => {});
        break;
      case 'video':
        metaApi.getVideoMeta(id).then((m) => { if (m) setVideoMeta(m); }).catch(() => {});
        break;
      case 'document':
        metaApi.getDocMeta(id).then((m) => { if (m) setDocMeta(m); }).catch(() => {});
        break;
    }
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
        <Box h={140} style={{ borderRadius: 'var(--mantine-radius-sm)', backgroundColor: 'var(--mantine-color-default)',
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {entrySlim.is_dir ? <IconFolder size={48} stroke={1} style={{ color: '#facc15' }} />
            : <Text fz={48}>{info.icon}</Text>}
        </Box>

        {/* Name + kind */}
        <div>
          <Text size="sm" fw={600} lineClamp={3}>{entrySlim.name}</Text>
          <Badge size="xs" variant="light" style={{ backgroundColor: `${info.color}18`, color: info.color, border: 'none' }}>
            {info.icon} {entrySlim.kind}
          </Badge>
        </div>

        <Divider color="var(--mantine-color-default-border)" />

        {/* Common metadata */}
        <Stack gap={6}>
          {!entrySlim.is_dir && <Row label="Taille" value={formatBytes(entrySlim.size_bytes)} />}
          {entrySlim.ext && <Row label="Extension" value={`.${entrySlim.ext}`} />}
          <Row label="Modifié" value={formatDate(entrySlim.mtime)} />
          {fullEntry?.path && <Row label="Chemin" value={fullEntry.path} />}
        </Stack>

        <Divider color="var(--mantine-color-default-border)" />

        {/* Kind-specific metadata */}
        {entrySlim.kind === 'image' && <ImageSection meta={imageMeta} filePath={fullEntry?.path} />}
        {entrySlim.kind === 'audio' && <AudioSection meta={audioMeta} filePath={fullEntry?.path} />}
        {entrySlim.kind === 'video' && <VideoSection meta={videoMeta} />}
        {entrySlim.kind === 'document' && <DocumentSection meta={docMeta} />}

        {/* AI section (documents + images) */}
        {(entrySlim.kind === 'document' || entrySlim.kind === 'text' || entrySlim.kind === 'image') && (
          <>
            <Divider color="var(--mantine-color-default-border)" />
            <AiSection entryId={entrySlim.id} kind={entrySlim.kind} annotations={aiAnnotations} />
          </>
        )}

        <Divider color="var(--mantine-color-default-border)" />

        {/* Tags */}
        <TagsSection entryId={entrySlim.id} entryTags={entryTags} allTags={allTags}
          onTagFilter={onTagFilter} onTagChanged={onTagChanged} />

        {/* Custom fields */}
        {customFields.length > 0 && (
          <>
            <Divider color="var(--mantine-color-default-border)" />
            <CustomFieldsSection entryId={entrySlim.id} fields={customFields} />
          </>
        )}
      </Stack>
    </ScrollArea>
  );
}
