import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useHexaTheme } from '../themeProvider';

const API_URL = import.meta.env.VITE_API_URL || '';
const MONO = "'JetBrains Mono', monospace";
const BARLOW = "'Barlow Condensed', sans-serif";

const T = {
  es: {
    title: 'ALTAS Y BAJAS',
    empty: 'Sin bajas reportadas para estos equipos.',
    loading: 'Cargando reporte de lesiones…',
    more: (n) => `+${n} más`,
    status: {
      out_for_season: 'FUERA (IR)', out: 'FUERA', doubtful: 'DUDOSO',
      game_time_decision: 'DECIDE EL DÍA', questionable: 'EN DUDA',
      day_to_day: 'DÍA A DÍA', probable: 'PROBABLE',
    },
  },
  en: {
    title: 'INJURY REPORT',
    empty: 'No injuries reported for these teams.',
    loading: 'Loading injury report…',
    more: (n) => `+${n} more`,
    status: {
      out_for_season: 'OUT (IR)', out: 'OUT', doubtful: 'DOUBTFUL',
      game_time_decision: 'GAME-TIME', questionable: 'QUESTIONABLE',
      day_to_day: 'DAY-TO-DAY', probable: 'PROBABLE',
    },
  },
};

// Anything doubtful or worse changes how you bet the game; the rest is noise
// until kickoff, so it stays collapsed behind the "+N more" count.
const KEY_STATUSES = new Set(['out_for_season', 'out', 'doubtful']);

/**
 * Availability report for the two teams of an NFL matchup, read from the same
 * ESPN feed the Oracle context uses. Renders nothing when no team is selected.
 */
export default function NflInjuryReport({ teams = [], lang = 'es' }) {
  const { C } = useHexaTheme();
  const t = T[lang] ?? T.es;
  const key = teams.filter(Boolean).join(',');

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!key) { setReport(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    fetch(`${API_URL}/api/nfl/injuries?team=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then(json => { if (!cancelled) setReport(json.success ? json.data : null); })
      .catch(() => { if (!cancelled) setReport(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key]);

  if (!key) return null;

  const color = (statusKey) => {
    if (statusKey === 'out' || statusKey === 'out_for_season') return C.red;
    if (statusKey === 'doubtful') return C.amber;
    return C.textMuted;
  };

  return (
    <Box sx={{ border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.amber}`, p: '10px 12px' }}>
      <Typography sx={{ fontFamily: BARLOW, fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.08em', color: C.amber, mb: 0.5 }}>
        {t.title}
      </Typography>

      {loading && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted }}>{t.loading}</Typography>
      )}

      {!loading && (report ?? []).map((team) => {
        const injuries = team.injuries ?? [];
        const key_ = injuries.filter(i => KEY_STATUSES.has(i.statusKey));
        const shown = expanded ? injuries : key_;
        const hidden = injuries.length - shown.length;
        return (
          <Box key={team.abbreviation ?? team.teamId} sx={{ mb: 1 }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textPrimary, fontWeight: 700 }}>
              {team.abbreviation ?? team.displayName}
            </Typography>
            {shown.length === 0 && (
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>—</Typography>
            )}
            {shown.map((i) => (
              <Typography key={`${i.playerId ?? i.playerName}`} sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
                <span style={{ color: color(i.statusKey), fontWeight: 700 }}>
                  {t.status[i.statusKey] ?? i.status ?? '?'}
                </span>
                {' · '}
                {i.playerName}{i.position ? ` (${i.position})` : ''}
                {i.detail ? ` — ${i.detail}` : ''}
              </Typography>
            ))}
            {hidden > 0 && (
              <Typography
                onClick={() => setExpanded(true)}
                sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.accent, cursor: 'pointer' }}
              >
                {t.more(hidden)}
              </Typography>
            )}
          </Box>
        );
      })}

      {!loading && (report ?? []).length === 0 && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted }}>{t.empty}</Typography>
      )}
    </Box>
  );
}
