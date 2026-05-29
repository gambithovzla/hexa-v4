/**
 * PostmortemDashboard.jsx — Admin page for aggregate postmortem analytics.
 * Route: /admin/postmortem
 * Endpoint: GET /api/admin/postmortem-stats
 */

import { useState, useEffect, useCallback } from 'react';
import { Box, Typography, CircularProgress, Button, Chip, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { MONO } from '../theme';
import { PV as C } from '../styles/pageCssVars';
import { useHexaTheme } from '../themeProvider';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const RESULT_COLOR = {
  win:  C.outcomeWin,
  loss: C.outcomeLoss,
  push: C.outcomePush,
};

const STRINGS = {
  en: {
    title:       'POSTMORTEM ANALYTICS',
    subtitle:    '// LLM-REVIEWED PICK BREAKDOWN — PATTERN EXTRACTION',
    back:        '← BACK',
    sport:       'SPORT',
    all:         'ALL',
    coverage:    'COVERAGE',
    resolved:    'resolved picks',
    withPM:      'with postmortem',
    pct:         'coverage',
    signals:     'TOP ADJUSTMENT SIGNALS',
    missed:      'COMMON MISSES',
    gotRight:    'COMMON HITS',
    keyFactors:  'KEY FACTORS',
    recent:      'RECENT POSTMORTEMS',
    noData:      'No postmortems generated yet.',
    empty:       'No items.',
    takeaway:    'Training takeaway',
    noTakeaway:  '—',
    occurrences: (n) => `×${n}`,
  },
  es: {
    title:       'ANÁLISIS POSTMORTEM',
    subtitle:    '// REVISIÓN LLM POR PICK — EXTRACCIÓN DE PATRONES',
    back:        '← VOLVER',
    sport:       'DEPORTE',
    all:         'TODOS',
    coverage:    'COBERTURA',
    resolved:    'picks resueltos',
    withPM:      'con postmortem',
    pct:         'cobertura',
    signals:     'SEÑALES DE AJUSTE PRINCIPALES',
    missed:      'ERRORES RECURRENTES',
    gotRight:    'ACIERTOS RECURRENTES',
    keyFactors:  'FACTORES CLAVE',
    recent:      'POSTMORTEMS RECIENTES',
    noData:      'Aún no se han generado postmortems.',
    empty:       'Sin datos.',
    takeaway:    'Conclusión de entrenamiento',
    noTakeaway:  '—',
    occurrences: (n) => `×${n}`,
  },
};

// ── Small panel wrapper ────────────────────────────────────────────────────
function Panel({ children, sx = {} }) {
  return (
    <Box sx={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      p: '14px 16px',
      ...sx,
    }}>
      {children}
    </Box>
  );
}

// ── Section header ─────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <Typography sx={{
      fontFamily: MONO, fontSize: '9px', letterSpacing: '0.2em',
      color: C.textMuted, textTransform: 'uppercase', mb: '10px',
    }}>
      {children}
    </Typography>
  );
}

// ── Ranked text list ───────────────────────────────────────────────────────
function RankedList({ items, color, T }) {
  if (!items?.length) {
    return <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: C.textMuted }}>{T.empty}</Typography>;
  }
  const max = items[0]?.count ?? 1;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {items.map((item, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
          <Box sx={{
            minWidth: '28px', fontFamily: MONO, fontSize: '9px',
            color: C.textMuted, pt: '1px', flexShrink: 0,
          }}>
            {T.occurrences(item.count)}
          </Box>
          <Box sx={{ flex: 1 }}>
            <Box sx={{
              height: '2px', mb: '4px',
              background: color,
              width: `${Math.round((item.count / max) * 100)}%`,
              opacity: 0.6,
            }} />
            <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: C.ink0, lineHeight: 1.45 }}>
              {item.text}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// ── Coverage card ──────────────────────────────────────────────────────────
function CoverageCard({ coverage, T }) {
  const pct = coverage.resolved_total > 0
    ? Math.round((coverage.postmortem_count / coverage.resolved_total) * 100)
    : 0;
  return (
    <Box sx={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
      <Stat value={coverage.resolved_total} label={T.resolved} color={C.cyan} />
      <Stat value={coverage.postmortem_count} label={T.withPM} color={C.green} />
      <Stat value={`${pct}%`} label={T.pct} color={pct >= 60 ? C.green : pct >= 30 ? C.amber : C.red} />
    </Box>
  );
}

function Stat({ value, label, color }) {
  return (
    <Box>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.4rem', fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.textMuted, letterSpacing: '0.12em', mt: '3px' }}>
        {label}
      </Typography>
    </Box>
  );
}

// ── Single recent postmortem row ───────────────────────────────────────────
function RecentRow({ row, T }) {
  const [open, setOpen] = useState(false);
  const resultColor = RESULT_COLOR[row.result] ?? C.textMuted;
  const keyFactors   = Array.isArray(row.key_factors) ? row.key_factors : [];
  const missed       = Array.isArray(row.what_hexa_missed) ? row.what_hexa_missed : [];
  const signals      = Array.isArray(row.adjustment_signals) ? row.adjustment_signals : [];
  const takeaway     = typeof row.training_takeaway === 'string' ? row.training_takeaway : '';

  return (
    <Box sx={{ borderBottom: `1px solid ${C.border}`, pb: '10px', mb: '10px', '&:last-child': { borderBottom: 'none', mb: 0 } }}>
      <Box
        onClick={() => setOpen(v => !v)}
        sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', userSelect: 'none' }}
      >
        <Chip
          label={String(row.result ?? '?').toUpperCase()}
          size="small"
          sx={{
            fontFamily: MONO, fontSize: '9px', letterSpacing: '0.12em',
            bgcolor: `${resultColor}22`, color: resultColor,
            border: `1px solid ${resultColor}55`, borderRadius: '2px',
            height: '20px', flexShrink: 0, mt: '1px',
          }}
        />
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: C.ink0, lineHeight: 1.3 }}>
            {row.pick}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.textMuted, mt: '2px' }}>
            {row.matchup} · {row.game_date?.slice(0, 10)} · {String(row.sport).toUpperCase()}
          </Typography>
        </Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: C.cyan, flexShrink: 0, mt: '1px' }}>
          {open ? '▲' : '▼'}
        </Typography>
      </Box>

      {open && (
        <Box sx={{ mt: '10px', pl: '38px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {row.postmortem_summary && (
            <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: C.textSecondary, lineHeight: 1.55 }}>
              {row.postmortem_summary}
            </Typography>
          )}
          {keyFactors.length > 0 && (
            <Box>
              <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.textMuted, letterSpacing: '0.15em', mb: '4px' }}>
                KEY FACTORS
              </Typography>
              {keyFactors.map((f, i) => (
                <Typography key={i} sx={{ fontFamily: MONO, fontSize: '10px', color: C.ink1, lineHeight: 1.45 }}>
                  · {f}
                </Typography>
              ))}
            </Box>
          )}
          {missed.length > 0 && (
            <Box>
              <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.textMuted, letterSpacing: '0.15em', mb: '4px' }}>
                MISSED
              </Typography>
              {missed.map((m, i) => (
                <Typography key={i} sx={{ fontFamily: MONO, fontSize: '10px', color: C.red, lineHeight: 1.45 }}>
                  · {m}
                </Typography>
              ))}
            </Box>
          )}
          {signals.length > 0 && (
            <Box>
              <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.textMuted, letterSpacing: '0.15em', mb: '4px' }}>
                SIGNALS
              </Typography>
              {signals.map((s, i) => (
                <Typography key={i} sx={{ fontFamily: MONO, fontSize: '10px', color: C.cyan, lineHeight: 1.45 }}>
                  · {s}
                </Typography>
              ))}
            </Box>
          )}
          {takeaway && (
            <Box sx={{ borderTop: `1px solid ${C.border}`, pt: '8px', mt: '2px' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.textMuted, letterSpacing: '0.15em', mb: '3px' }}>
                {T.takeaway}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: C.amber, fontStyle: 'italic', lineHeight: 1.5 }}>
                {takeaway}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function PostmortemDashboard({ token, onBack, lang = 'es' }) {
  const T = STRINGS[lang] ?? STRINGS.es;
  const { isLeague } = useHexaTheme();

  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [sport, setSport]       = useState('all');

  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async (s) => {
    setLoading(true);
    try {
      const qs = s && s !== 'all' ? `?sport=${s}` : '';
      const r = await fetch(`${API_URL}/api/admin/postmortem-stats${qs}`, { headers });
      if (!r.ok) throw new Error(`http ${r.status}`);
      const json = await r.json();
      setData(json.data ?? null);
    } catch (err) {
      console.warn('[PostmortemDashboard] fetch failed:', err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(sport); }, [sport, fetchData]);

  return (
    <Box sx={{ minHeight: '100vh', background: C.bg, color: C.ink0, p: { xs: 1.5, md: 3 } }}>

      {/* Back + title */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onBack} sx={{ color: C.cyan, fontFamily: MONO, fontSize: '10px', letterSpacing: '2px', border: `1px solid ${C.border}`, px: 2, py: '6px' }}>
          {T.back}
        </Button>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.textMuted, letterSpacing: '0.2em' }}>
            {T.sport}
          </Typography>
          <ToggleButtonGroup
            value={sport}
            exclusive
            size="small"
            onChange={(_, v) => v && setSport(v)}
            sx={{
              '& .MuiToggleButton-root': {
                fontFamily: MONO, fontSize: '9px', letterSpacing: '2px',
                color: C.textMuted, border: `1px solid ${C.border}`, py: '4px', px: '10px', borderRadius: 0,
                '&.Mui-selected': { color: C.ink0, background: C.cyanDim, borderColor: C.cyan },
              },
            }}
          >
            {['all', 'mlb', 'nba'].map(s => (
              <ToggleButton key={s} value={s}>{s.toUpperCase()}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Page header */}
      <Box className={isLeague ? 'brand-clip-bevel' : ''} sx={isLeague ? { pl: '10px', py: '4px', mb: 2 } : { mb: 2 }}>
        <Typography sx={{
          fontFamily: isLeague ? 'var(--font-display)' : MONO,
          fontWeight: 800,
          fontSize: { xs: '1rem', sm: '1.2rem' },
          letterSpacing: isLeague ? '0.18em' : '0.22em',
          color: isLeague ? 'var(--volt)' : C.cyan,
          textTransform: 'uppercase',
        }}>
          {T.title}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, letterSpacing: '0.12em', mt: '2px' }}>
          {T.subtitle}
        </Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress sx={{ color: C.cyan }} size={32} />
        </Box>
      ) : !data ? (
        <Typography sx={{ fontFamily: MONO, fontSize: '12px', color: C.textMuted, pt: 4 }}>{T.noData}</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* Coverage */}
          <Panel>
            <SectionLabel>{T.coverage}</SectionLabel>
            <CoverageCard coverage={data.coverage} T={T} />
          </Panel>

          {/* Signals + Missed side by side */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <Panel>
              <SectionLabel>{T.signals}</SectionLabel>
              <RankedList items={data.adjustment_signals} color={C.cyan} T={T} />
            </Panel>
            <Panel>
              <SectionLabel>{T.missed}</SectionLabel>
              <RankedList items={data.what_hexa_missed} color={C.red} T={T} />
            </Panel>
          </Box>

          {/* Got right + Key factors side by side */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <Panel>
              <SectionLabel>{T.gotRight}</SectionLabel>
              <RankedList items={data.what_hexa_got_right} color={C.green} T={T} />
            </Panel>
            <Panel>
              <SectionLabel>{T.keyFactors}</SectionLabel>
              <RankedList items={data.key_factors} color={C.amber} T={T} />
            </Panel>
          </Box>

          {/* Recent postmortems */}
          <Panel>
            <SectionLabel>{T.recent}</SectionLabel>
            {data.recent?.length > 0
              ? data.recent.map(row => <RecentRow key={row.id} row={row} T={T} />)
              : <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: C.textMuted }}>{T.empty}</Typography>
            }
          </Panel>

        </Box>
      )}
    </Box>
  );
}
