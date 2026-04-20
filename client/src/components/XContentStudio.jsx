import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { C, BARLOW, MONO, SANS } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const TYPE_OPTIONS = [
  { value: 'pick_of_day', en: 'Pick of Day', es: 'Pick del Dia' },
  { value: 'thread_daily', en: 'Daily Thread', es: 'Thread Diario' },
  { value: 'postmortem', en: 'Postmortem', es: 'Postmortem' },
  { value: 'weekly_recap', en: 'Weekly Recap', es: 'Resumen Semanal' },
];

const COPY = {
  en: {
    eyebrow: 'Admin Content Studio',
    title: 'X Content Machine',
    subtitle: 'Generate social-ready drafts from HEXA picks, board signals, postmortems, and performance.',
    single: 'Generate Draft',
    pack: 'Generate 4-Pack',
    loading: 'Generating...',
    date: 'Date',
    type: 'Draft type',
    lang: 'Output lang',
    pickId: 'Pick ID (optional)',
    copy: 'Copy',
    sourceRefs: 'Source refs',
    warnings: 'Warnings',
    visual: 'Visual brief',
    cta: 'CTA',
    posts: 'Posts',
    none: 'No draft generated yet.',
    error: 'Could not generate content.',
    copied: 'Copied',
    batchHint: '4-pack generates one draft for each content type.',
    generatedWith: 'Generated with',
    langEs: 'Spanish',
    langEn: 'English',
    queue: 'Save to Queue',
    queueScheduled: 'Save Scheduled',
    queueTitle: 'Editorial Queue',
    queueEmpty: 'No queued content yet.',
    refreshQueue: 'Refresh Queue',
    approve: 'Approve',
    publish: 'Publish',
    schedule: 'Schedule',
    scheduleFor: 'Schedule for',
    status: 'Status',
    saved: 'Saved to queue',
    queueError: 'Could not update queue.',
  },
  es: {
    eyebrow: 'Admin Content Studio',
    title: 'Maquina de Contenido X',
    subtitle: 'Genera drafts listos para redes con picks, board, postmortems y performance de HEXA.',
    single: 'Generar Draft',
    pack: 'Generar Pack x4',
    loading: 'Generando...',
    date: 'Fecha',
    type: 'Tipo de draft',
    lang: 'Idioma de salida',
    pickId: 'Pick ID (opcional)',
    copy: 'Copiar',
    sourceRefs: 'Fuentes',
    warnings: 'Alertas',
    visual: 'Brief visual',
    cta: 'CTA',
    posts: 'Posts',
    none: 'Todavia no se genero ningun draft.',
    error: 'No se pudo generar contenido.',
    copied: 'Copiado',
    batchHint: 'El pack x4 genera un draft por cada tipo de contenido.',
    generatedWith: 'Generado con',
    langEs: 'Espanol',
    langEn: 'Ingles',
    queue: 'Guardar en Cola',
    queueScheduled: 'Guardar Programado',
    queueTitle: 'Cola Editorial',
    queueEmpty: 'Todavia no hay contenido en cola.',
    refreshQueue: 'Actualizar Cola',
    approve: 'Aprobar',
    publish: 'Publicar',
    schedule: 'Programar',
    scheduleFor: 'Programar para',
    status: 'Estado',
    saved: 'Guardado en cola',
    queueError: 'No se pudo actualizar la cola.',
  },
};

function getEasternDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function DraftCard({ draft, t, onQueue, onQueueScheduled, scheduleFor = '', queueBusy = false }) {
  const [copyLabel, setCopyLabel] = useState('');

  async function handleCopy() {
    const text = (draft.posts ?? []).join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopyLabel(t.copied);
    setTimeout(() => setCopyLabel(''), 1500);
  }

  return (
    <Box
      sx={{
        border: `1px solid ${C.border}`,
        bgcolor: C.surface,
        p: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.95rem', color: C.textPrimary, fontWeight: 700 }}>
            {draft.title}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {draft.type} · {draft.format} · {t.generatedWith}: {draft.generated_with}
          </Typography>
        </Box>
        <Button
          onClick={handleCopy}
          variant="outlined"
          size="small"
          sx={{
            borderRadius: 0,
            borderColor: C.accentLine,
            color: C.accent,
            fontFamily: MONO,
            fontSize: '0.68rem',
          }}
        >
          {copyLabel || t.copy}
        </Button>
      </Box>

      {(onQueue || onQueueScheduled) && (
        <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {onQueue && (
            <Button
              onClick={onQueue}
              disabled={queueBusy}
              variant="outlined"
              size="small"
              sx={{
                borderRadius: 0,
                borderColor: C.greenLine,
                color: C.green,
                fontFamily: MONO,
                fontSize: '0.68rem',
              }}
            >
              {t.queue}
            </Button>
          )}
          {onQueueScheduled && (
            <Button
              onClick={onQueueScheduled}
              disabled={queueBusy || !scheduleFor}
              variant="outlined"
              size="small"
              sx={{
                borderRadius: 0,
                borderColor: C.amberLine ?? C.accentLine,
                color: C.amber ?? C.accent,
                fontFamily: MONO,
                fontSize: '0.68rem',
              }}
            >
              {t.queueScheduled}
            </Button>
          )}
        </Box>
      )}

      <Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', mb: '6px' }}>
          {t.posts}
        </Typography>
        <Stack spacing={1}>
          {(draft.posts ?? []).map((post, index) => (
            <Box key={`${draft.type}-${index}`} sx={{ border: `1px solid ${C.border}`, bgcolor: 'rgba(255,255,255,0.02)', p: '10px 12px' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.accent, letterSpacing: '0.08em', mb: '4px' }}>
                POST {index + 1}
              </Typography>
              <Typography sx={{ fontFamily: SANS, fontSize: '0.88rem', color: C.textPrimary, lineHeight: 1.65 }}>
                {post}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      {draft.hashtags?.length > 0 && (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {draft.hashtags.map((tag) => (
            <Chip
              key={`${draft.type}-${tag}`}
              label={tag}
              size="small"
              sx={{
                borderRadius: 0,
                bgcolor: C.accentDim,
                border: `1px solid ${C.accentLine}`,
                color: C.accent,
                fontFamily: MONO,
              }}
            />
          ))}
        </Stack>
      )}

      {draft.cta && (
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', mb: '4px' }}>
            {t.cta}
          </Typography>
          <Typography sx={{ fontFamily: SANS, fontSize: '0.86rem', color: C.textSecondary, lineHeight: 1.6 }}>
            {draft.cta}
          </Typography>
        </Box>
      )}

      {draft.visual_brief && (
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', mb: '4px' }}>
            {t.visual}
          </Typography>
          <Typography sx={{ fontFamily: SANS, fontSize: '0.86rem', color: C.textSecondary, lineHeight: 1.6 }}>
            {draft.visual_brief}
          </Typography>
        </Box>
      )}

      {draft.warnings?.length > 0 && (
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', mb: '4px' }}>
            {t.warnings}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {draft.warnings.map((warning, index) => (
              <Chip
                key={`${draft.type}-warning-${index}`}
                label={warning}
                size="small"
                sx={{
                  borderRadius: 0,
                  bgcolor: C.redDim,
                  border: `1px solid ${C.redLine}`,
                  color: C.red,
                  fontFamily: MONO,
                  maxWidth: '100%',
                }}
              />
            ))}
          </Stack>
        </Box>
      )}

      {draft.source_refs?.length > 0 && (
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', mb: '4px' }}>
            {t.sourceRefs}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {draft.source_refs.map((ref) => (
              <Chip
                key={`${draft.type}-${ref.kind}-${ref.id}`}
                label={`${ref.kind}: ${ref.label}`}
                size="small"
                sx={{
                  borderRadius: 0,
                  bgcolor: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${C.border}`,
                  color: C.textSecondary,
                  fontFamily: MONO,
                }}
              />
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
}

function QueueCard({ item, t, onApprove, onPublish, onSchedule, actionBusy = false }) {
  return (
    <Box
      sx={{
        border: `1px solid ${C.border}`,
        bgcolor: 'rgba(255,255,255,0.02)',
        p: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Box>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.92rem', color: C.textPrimary, fontWeight: 700 }}>
            {item.title}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            #{item.id} · {item.type} · {item.lang} · {t.status}: {item.status}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {item.status === 'draft' && (
            <Button
              onClick={() => onApprove(item.id)}
              disabled={actionBusy}
              variant="outlined"
              size="small"
              sx={{ borderRadius: 0, borderColor: C.greenLine, color: C.green, fontFamily: MONO, fontSize: '0.66rem' }}
            >
              {t.approve}
            </Button>
          )}
          {(item.status === 'approved' || item.status === 'scheduled' || item.status === 'failed') && (
            <Button
              onClick={() => onPublish(item.id)}
              disabled={actionBusy}
              variant="outlined"
              size="small"
              sx={{ borderRadius: 0, borderColor: C.accentLine, color: C.accent, fontFamily: MONO, fontSize: '0.66rem' }}
            >
              {t.publish}
            </Button>
          )}
          {(item.status === 'draft' || item.status === 'approved' || item.status === 'failed') && (
            <Button
              onClick={() => onSchedule(item.id)}
              disabled={actionBusy}
              variant="outlined"
              size="small"
              sx={{ borderRadius: 0, borderColor: C.textMuted, color: C.textSecondary, fontFamily: MONO, fontSize: '0.66rem' }}
            >
              {t.schedule}
            </Button>
          )}
        </Stack>
      </Box>

      <Typography sx={{ fontFamily: SANS, fontSize: '0.84rem', color: C.textSecondary, lineHeight: 1.55 }}>
        {(item.posts ?? [])[0] ?? ''}
      </Typography>

      {(item.scheduled_for || item.published_at || item.last_error) && (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {item.scheduled_for && (
            <Chip label={`${t.scheduleFor}: ${item.scheduled_for}`} size="small" sx={{ borderRadius: 0, fontFamily: MONO }} />
          )}
          {item.published_at && (
            <Chip label={`published: ${item.published_at}`} size="small" sx={{ borderRadius: 0, fontFamily: MONO }} />
          )}
          {item.last_error && (
            <Chip label={item.last_error} size="small" sx={{ borderRadius: 0, fontFamily: MONO, bgcolor: C.redDim, color: C.red, border: `1px solid ${C.redLine}` }} />
          )}
        </Stack>
      )}
    </Box>
  );
}

export default function XContentStudio({ lang = 'es' }) {
  const t = COPY[lang] ?? COPY.es;
  const [draftType, setDraftType] = useState('pick_of_day');
  const [outputLang, setOutputLang] = useState(lang);
  const [date, setDate] = useState(getEasternDate);
  const [pickId, setPickId] = useState('');
  const [scheduleFor, setScheduleFor] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [queueItems, setQueueItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    loadQueue();
  }, []);

  async function callEndpoint(url, payload) {
    const token = localStorage.getItem('hexa_token');
    const res = await fetch(`${API_URL}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || t.error);
    }
    return json;
  }

  async function callGet(url) {
    const token = localStorage.getItem('hexa_token');
    const res = await fetch(`${API_URL}${url}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || t.queueError);
    }
    return json;
  }

  async function loadQueue() {
    try {
      const json = await callGet('/api/admin/content/queue?limit=12');
      setQueueItems(json.data || []);
      setError('');
      return json.data || [];
    } catch (err) {
      setError(err.message || t.queueError);
      return [];
    }
  }

  async function handleGenerateSingle() {
    setLoading(true);
    setError('');
    try {
      const json = await callEndpoint('/api/admin/content/generate', {
        type: draftType,
        date,
        lang: outputLang,
        pickId: pickId ? Number(pickId) : null,
      });
      setDrafts([json.data]);
      setInfo('');
    } catch (err) {
      setError(err.message || t.error);
    } finally {
      setLoading(false);
    }
  }

  async function handleGeneratePack() {
    setLoading(true);
    setError('');
    try {
      const json = await callEndpoint('/api/admin/content/generate-batch', {
        types: TYPE_OPTIONS.map((option) => option.value),
        date,
        lang: outputLang,
        pickId: pickId ? Number(pickId) : null,
      });
      setDrafts(json.data || []);
      setInfo('');
    } catch (err) {
      setError(err.message || t.error);
    } finally {
      setLoading(false);
    }
  }

  async function handleQueueDraft(draft, scheduled = false) {
    setQueueBusy(true);
    setError('');
    setInfo('');
    try {
      const json = await callEndpoint('/api/admin/content/queue', {
        draft,
        scheduledFor: scheduled ? scheduleFor : null,
      });
      setInfo(t.saved);
      if (json.data?.id) {
        setQueueItems((prev) => {
          const next = [json.data, ...prev.filter((item) => item.id !== json.data.id)];
          return next.slice(0, 12);
        });
      }
      await loadQueue();
    } catch (err) {
      setError(err.message || t.queueError);
    } finally {
      setQueueBusy(false);
    }
  }

  async function handleApprove(id) {
    setQueueBusy(true);
    setError('');
    try {
      await callEndpoint(`/api/admin/content/queue/${id}/approve`, {});
      await loadQueue();
    } catch (err) {
      setError(err.message || t.queueError);
    } finally {
      setQueueBusy(false);
    }
  }

  async function handlePublish(id) {
    setQueueBusy(true);
    setError('');
    try {
      await callEndpoint(`/api/admin/content/queue/${id}/publish`, {});
      await loadQueue();
    } catch (err) {
      setError(err.message || t.queueError);
    } finally {
      setQueueBusy(false);
    }
  }

  async function handleSchedule(id) {
    setQueueBusy(true);
    setError('');
    try {
      await callEndpoint(`/api/admin/content/queue/${id}/schedule`, {
        scheduledFor: scheduleFor,
      });
      await loadQueue();
    } catch (err) {
      setError(err.message || t.queueError);
    } finally {
      setQueueBusy(false);
    }
  }

  return (
    <Box
      sx={{
        border: `1px solid ${C.cyanLine}`,
        bgcolor: C.surface,
        p: { xs: '18px 16px', md: '22px 24px' },
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
      }}
    >
      <Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.64rem', color: C.accent, letterSpacing: '0.18em', textTransform: 'uppercase', mb: '4px' }}>
          {t.eyebrow}
        </Typography>
        <Typography sx={{ fontFamily: BARLOW, fontSize: '1.3rem', color: C.textPrimary, fontWeight: 800 }}>
          {t.title}
        </Typography>
        <Typography sx={{ fontFamily: SANS, fontSize: '0.9rem', color: C.textSecondary, lineHeight: 1.6, mt: '4px', maxWidth: '70ch' }}>
          {t.subtitle}
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(5, minmax(0, 1fr))' },
          gap: '12px',
        }}
      >
        <TextField
          select
          label={t.type}
          value={draftType}
          onChange={(event) => setDraftType(event.target.value)}
          size="small"
          sx={{ '& .MuiInputBase-root': { borderRadius: 0, fontFamily: MONO } }}
        >
          {TYPE_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option[lang] ?? option.es}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label={t.date}
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          size="small"
          InputLabelProps={{ shrink: true }}
          sx={{ '& .MuiInputBase-root': { borderRadius: 0, fontFamily: MONO } }}
        />

        <TextField
          select
          label={t.lang}
          value={outputLang}
          onChange={(event) => setOutputLang(event.target.value)}
          size="small"
          sx={{ '& .MuiInputBase-root': { borderRadius: 0, fontFamily: MONO } }}
        >
          <MenuItem value="es">{t.langEs}</MenuItem>
          <MenuItem value="en">{t.langEn}</MenuItem>
        </TextField>

        <TextField
          label={t.pickId}
          value={pickId}
          onChange={(event) => setPickId(event.target.value.replace(/[^\d]/g, ''))}
          size="small"
          sx={{ '& .MuiInputBase-root': { borderRadius: 0, fontFamily: MONO } }}
        />

        <TextField
          label={t.scheduleFor}
          type="datetime-local"
          value={scheduleFor}
          onChange={(event) => setScheduleFor(event.target.value)}
          size="small"
          InputLabelProps={{ shrink: true }}
          sx={{ '& .MuiInputBase-root': { borderRadius: 0, fontFamily: MONO } }}
        />
      </Box>

      <Box sx={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          onClick={handleGenerateSingle}
          disabled={loading}
          variant="contained"
          sx={{
            borderRadius: 0,
            bgcolor: C.accent,
            color: '#03131A',
            fontFamily: MONO,
            fontSize: '0.72rem',
            '&:hover': { bgcolor: C.cyan },
          }}
        >
          {loading ? t.loading : t.single}
        </Button>
        <Button
          onClick={handleGeneratePack}
          disabled={loading}
          variant="outlined"
          sx={{
            borderRadius: 0,
            borderColor: C.accentLine,
            color: C.accent,
            fontFamily: MONO,
            fontSize: '0.72rem',
          }}
        >
          {loading ? t.loading : t.pack}
        </Button>
        <Typography sx={{ fontFamily: SANS, fontSize: '0.82rem', color: C.textMuted }}>
          {t.batchHint}
        </Typography>
      </Box>

      {error && (
        <Box sx={{ border: `1px solid ${C.redLine}`, bgcolor: C.redDim, p: '10px 12px' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.red }}>
            {error}
          </Typography>
        </Box>
      )}

      {info && (
        <Box sx={{ border: `1px solid ${C.greenLine}`, bgcolor: C.greenDim, p: '10px 12px' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.green }}>
            {info}
          </Typography>
        </Box>
      )}

      {drafts.length === 0 ? (
        <Box sx={{ border: `1px dashed ${C.border}`, p: '18px 16px' }}>
          <Typography sx={{ fontFamily: SANS, fontSize: '0.9rem', color: C.textMuted }}>
            {t.none}
          </Typography>
        </Box>
      ) : (
        <Stack spacing={2}>
          {drafts.map((draft, index) => (
            <DraftCard
              key={`${draft.type}-${index}`}
              draft={draft}
              t={t}
              scheduleFor={scheduleFor}
              queueBusy={queueBusy}
              onQueue={() => handleQueueDraft(draft, false)}
              onQueueScheduled={() => handleQueueDraft(draft, true)}
            />
          ))}
        </Stack>
      )}

      <Box sx={{ borderTop: `1px solid ${C.border}`, pt: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '1.02rem', color: C.textPrimary, fontWeight: 700 }}>
            {t.queueTitle}
          </Typography>
          <Button
            onClick={loadQueue}
            disabled={queueBusy}
            variant="outlined"
            size="small"
            sx={{ borderRadius: 0, borderColor: C.borderLight, color: C.textSecondary, fontFamily: MONO, fontSize: '0.68rem' }}
          >
            {t.refreshQueue}
          </Button>
        </Box>

        {queueItems.length === 0 ? (
          <Box sx={{ border: `1px dashed ${C.border}`, p: '16px 14px' }}>
            <Typography sx={{ fontFamily: SANS, fontSize: '0.86rem', color: C.textMuted }}>
              {t.queueEmpty}
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {queueItems.map((item) => (
              <QueueCard
                key={item.id}
                item={item}
                t={t}
                actionBusy={queueBusy}
                onApprove={handleApprove}
                onPublish={handlePublish}
                onSchedule={handleSchedule}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
