/**
 * NbaContextMetaBadge.jsx — admin-only context_meta panel for NBA analyses.
 *
 * Rendered above the ResultCard for an admin running an NBA pick. Reads
 * `meta.context_meta` from the /api/nba/analyze/game response and surfaces:
 *   - overall data completeness (%)
 *   - odds source (client | server | none)
 *   - injury counts per side (total + severe)
 *   - active stale flags
 *
 * Pure presentation: never refetches. Returns null when no context_meta
 * is present, so it's safe to mount unconditionally.
 *
 * Props:
 *   contextMeta  object | null  — meta.context_meta from the NBA analyze response
 *   oddsSource   string | null  — meta.oddsSource ('client' | 'server' | null)
 *   lang         'en' | 'es'
 */

import { Box, Typography, Tooltip } from '@mui/material';
import { C, MONO } from '../theme';

const L = {
  en: {
    header: 'CONTEXT META — admin only',
    completeness: 'Completeness',
    odds: 'Odds',
    inj:  'Injuries',
    flags: 'Stale flags',
    none: 'none',
    severe: 'severe',
    oddsClient: 'client',
    oddsServer: 'server',
    oddsNone: 'none',
  },
  es: {
    header: 'CONTEXT META — solo admin',
    completeness: 'Completitud',
    odds: 'Cuotas',
    inj:  'Lesiones',
    flags: 'Flags stale',
    none: 'ninguno',
    severe: 'graves',
    oddsClient: 'cliente',
    oddsServer: 'servidor',
    oddsNone: 'ninguna',
  },
};

function completenessColor(pct) {
  if (pct == null) return C.ink2;
  if (pct >= 90) return C.green;
  if (pct >= 70) return C.cyan;
  if (pct >= 50) return C.amber;
  return C.red;
}

function oddsColor(source) {
  if (source === 'client') return C.cyan;
  if (source === 'server') return C.green;
  return C.amber;
}

function Chip({ label, value, color = C.ink2, tooltip = null }) {
  const content = (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '3px 8px',
      border: `1px solid ${color}40`,
      background: `${color}10`,
      fontFamily: MONO,
    }}>
      <Typography component="span" sx={{ fontFamily: MONO, fontSize: '9px', color: C.ink2, letterSpacing: '1.5px', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography component="span" sx={{ fontFamily: MONO, fontSize: '10px', color, fontWeight: 700 }}>
        {value}
      </Typography>
    </Box>
  );
  if (tooltip) {
    return <Tooltip title={tooltip} arrow placement="top">{content}</Tooltip>;
  }
  return content;
}

export default function NbaContextMetaBadge({ contextMeta, oddsSource = null, lang = 'en' }) {
  if (!contextMeta) return null;
  const t = L[lang] ?? L.en;

  const overall = contextMeta.overallCompleteness != null
    ? Math.round(contextMeta.overallCompleteness * 100)
    : null;

  const injHome = contextMeta.sources?.injuries?.count?.home ?? 0;
  const injAway = contextMeta.sources?.injuries?.count?.away ?? 0;
  const sevHome = contextMeta.sources?.injuries?.severe?.home ?? 0;
  const sevAway = contextMeta.sources?.injuries?.severe?.away ?? 0;
  const injStale = contextMeta.sources?.injuries?.stale === true;

  const flags = Array.isArray(contextMeta.staleFlags) ? contextMeta.staleFlags : [];
  const flagsValue = flags.length ? flags.length : t.none;
  const flagsColor = flags.length === 0 ? C.green : flags.length <= 2 ? C.amber : C.red;
  const flagsTooltip = flags.length ? flags.join(', ') : null;

  const oddsLabel = oddsSource === 'client' ? t.oddsClient
    : oddsSource === 'server' ? t.oddsServer
    : t.oddsNone;

  const injValue = `${injHome}/${injAway} (${sevHome + sevAway} ${t.severe})${injStale ? ' ⚠' : ''}`;

  return (
    <Box sx={{
      mb: 1.5, p: 1.25,
      border: `1px solid ${C.ink2}30`,
      background: 'rgba(255,255,255,0.02)',
    }}>
      <Typography sx={{
        fontFamily: MONO, fontSize: '9px', color: C.ink2,
        letterSpacing: '2px', textTransform: 'uppercase', mb: 0.75,
      }}>
        {t.header}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <Chip
          label={t.completeness}
          value={overall != null ? `${overall}%` : '—'}
          color={completenessColor(overall)}
        />
        <Chip
          label={t.odds}
          value={oddsLabel}
          color={oddsColor(oddsSource)}
        />
        <Chip
          label={t.inj}
          value={injValue}
          color={sevHome + sevAway > 0 ? C.amber : C.cyan}
          tooltip={injStale ? 'injuries stale or unavailable' : null}
        />
        <Chip
          label={t.flags}
          value={flagsValue}
          color={flagsColor}
          tooltip={flagsTooltip}
        />
      </Box>
    </Box>
  );
}
