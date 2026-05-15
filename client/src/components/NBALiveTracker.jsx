/**
 * NBALiveTracker.jsx
 *
 * Live scoreboard for NBA games in progress. Polls /api/nba/games?date=today
 * every 30 seconds, filters for `game_status_id === 2`, and renders period,
 * clock, score, and quarter-by-quarter breakdown.
 *
 * "Today" uses the America/New_York date — same rule as MLB tracker — so a
 * 10pm PT tipoff started yesterday in ET still belongs to "yesterday".
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import { C, BARLOW, MONO } from '../theme';
import { getNbaLogoUrl } from '../utils/nbaLogoUrl';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const POLL_INTERVAL = 30_000;

const T = {
  en: {
    title:      'NBA LIVE',
    noGames:    'No NBA games in progress',
    noGamesDesc:'Live scores will appear here when games tip off.',
    lastUpdate: 'Last update',
    polling:    'POLLING',
    period:     'PER',
    clock:      'CLOCK',
    final:      'FINAL',
    halftime:   'HALFTIME',
    end:        'END',
    pts:        'PTS',
    fg:         'FG%',
    fg3:        '3P%',
    ft:         'FT%',
    ast:        'AST',
    reb:        'REB',
    tov:        'TOV',
    total:      'TOT',
    ot:         'OT',
    yourPicks:  'YOUR NBA PICKS',
    noPicks:    'No pending NBA picks',
  },
  es: {
    title:      'NBA EN VIVO',
    noGames:    'No hay juegos NBA en progreso',
    noGamesDesc:'Los marcadores aparecerán aquí cuando comiencen los juegos.',
    lastUpdate: 'Última actualización',
    polling:    'ACTUALIZANDO',
    period:     'PER',
    clock:      'RELOJ',
    final:      'FINAL',
    halftime:   'MEDIO TIEMPO',
    end:        'FIN',
    pts:        'PTS',
    fg:         'TC%',
    fg3:        'T3%',
    ft:         'TL%',
    ast:        'AST',
    reb:        'REB',
    tov:        'PER',
    total:      'TOT',
    ot:         'TS',
    yourPicks:  'TUS PICKS NBA',
    noPicks:    'Sin picks NBA pendientes',
  },
};

function NbaPickProgressPanel({ picks, lang }) {
  const t = T[lang] || T.en;
  const nbaPicks = picks ?? [];
  if (!nbaPicks.length) return null;

  return (
    <Box sx={{ border: `1px solid ${C.border}`, p: 2, bgcolor: 'rgba(0,0,0,0.35)' }}>
      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.62rem', color: C.textMuted, letterSpacing: '0.14em', mb: 1.2 }}>
        {t.yourPicks}
      </Typography>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {nbaPicks.map((pick) => {
          const pct = pick.progress != null ? Math.min(100, pick.progress) : 0;
          const color =
            pick.status === 'won' || pick.status === 'winning' || pick.status === 'covering' || pick.status === 'hitting'
              ? C.green
              : pick.status === 'lost' || pick.status === 'losing' || pick.status === 'not_covering'
                ? C.red
                : C.cyan;
          return (
            <Box key={pick.pickId}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 0.4 }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textPrimary }}>
                  {pick.label || pick.pick}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted }}>
                  {pick.status ?? '—'}
                </Typography>
              </Box>
              {pick.details && (
                <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, mb: 0.6 }}>
                  {pick.details}
                </Typography>
              )}
              {pick.progress != null && (
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  sx={{
                    height: 4,
                    borderRadius: 0,
                    bgcolor: 'rgba(255,255,255,0.06)',
                    '& .MuiLinearProgress-bar': { bgcolor: color },
                  }}
                />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function getEasternDateString(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const lookup = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function NbaLogo({ teamId, abbr, size = 56 }) {
  const [failed, setFailed] = useState(false);
  if (!teamId || failed) {
    return (
      <Box
        sx={{
          width: size, height: size, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          border: `1px solid ${C.border}`, bgcolor: 'rgba(255,255,255,0.03)',
        }}
      >
        <Typography sx={{ fontFamily: MONO, fontSize: size * 0.26, color: C.textPrimary }}>
          {abbr || '—'}
        </Typography>
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={getNbaLogoUrl(teamId, abbr)}
      alt={abbr || 'team logo'}
      loading="lazy"
      onError={() => setFailed(true)}
      sx={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

function formatPeriodLabel(period, clock, statusText, t) {
  if (!period) return statusText || '—';
  const isHalftime = /halftime/i.test(statusText ?? '');
  if (isHalftime) return t.halftime;
  const isEnd = /^end /i.test(statusText ?? '') || /^q\d end/i.test(statusText ?? '');
  if (period <= 4) {
    const base = `Q${period}`;
    if (isEnd || (clock && /0?0:00\.?0?/.test(clock))) return `${t.end} ${base}`;
    return clock ? `${base} ${clock}` : base;
  }
  const otNum = period - 4;
  const base = `${t.ot}${otNum}`;
  return clock ? `${base} ${clock}` : base;
}

function PeriodScoreTable({ game, lang }) {
  const t = T[lang] || T.en;
  const home = game.home_qtrs ?? [];
  const away = game.away_qtrs ?? [];
  const maxLen = Math.max(4, home.length, away.length);
  // Trim trailing nulls from any OT quarters that don't have data
  let lastPlayed = 3; // 0-indexed for Q4
  for (let i = 0; i < maxLen; i++) {
    if ((home[i] != null && home[i] !== 0) || (away[i] != null && away[i] !== 0)) {
      lastPlayed = Math.max(lastPlayed, i);
    }
  }
  const playedCols = lastPlayed + 1;

  const cellSx = {
    fontFamily: MONO, fontSize: '0.7rem',
    textAlign: 'center', minWidth: '34px', px: '4px',
  };
  const headerCell = {
    ...cellSx, color: C.textMuted, pb: '4px',
    borderBottom: `1px solid ${C.border}`,
  };
  const totalCell = {
    ...cellSx, color: C.accent, fontWeight: 800,
    borderLeft: `1px solid ${C.border}`,
  };

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: '0.7rem' }}>
        <thead>
          <tr>
            <Box component="th" sx={{ ...headerCell, minWidth: '42px', textAlign: 'left', pr: '8px' }} />
            {Array.from({ length: playedCols }, (_, i) => (
              <Box
                component="th"
                key={i}
                sx={{ ...headerCell, color: i + 1 === game.live_period ? C.cyan : C.textMuted }}
              >
                {i < 4 ? `Q${i + 1}` : `OT${i - 3}`}
              </Box>
            ))}
            <Box component="th" sx={{ ...headerCell, borderLeft: `1px solid ${C.border}`, px: '8px', color: C.accent }}>
              {t.total}
            </Box>
          </tr>
        </thead>
        <tbody>
          {[
            { label: game.away_team_abbr || 'AWY', row: away, total: game.away_score, isHome: false },
            { label: game.home_team_abbr || 'HOM', row: home, total: game.home_score, isHome: true  },
          ].map(({ label, row, total }) => (
            <tr key={label}>
              <Box
                component="td"
                sx={{ fontFamily: BARLOW, fontSize: '0.72rem', letterSpacing: '0.1em', color: C.textSecondary, pr: '8px', py: '5px', whiteSpace: 'nowrap' }}
              >
                {label}
              </Box>
              {Array.from({ length: playedCols }, (_, i) => {
                const val = row[i];
                const isCurrent = i + 1 === game.live_period;
                return (
                  <Box
                    component="td"
                    key={i}
                    sx={{
                      ...cellSx, py: '5px',
                      color: val == null ? C.textGhost : val > 0 ? C.textPrimary : C.textMuted,
                      bgcolor: isCurrent ? 'rgba(0,217,255,0.08)' : 'transparent',
                    }}
                  >
                    {val ?? '—'}
                  </Box>
                );
              })}
              <Box component="td" sx={{ ...totalCell, py: '5px' }}>
                {total ?? '—'}
              </Box>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

function StatStrip({ game, lang }) {
  const t = T[lang] || T.en;
  const fmtPct = v => v == null ? '—' : `${Math.round(v * 1000) / 10}%`;
  const fmt = v => v == null ? '—' : v;

  const items = [
    { label: t.fg,  away: fmtPct(game.away_fg_pct),  home: fmtPct(game.home_fg_pct) },
    { label: t.fg3, away: fmtPct(game.away_fg3_pct), home: fmtPct(game.home_fg3_pct) },
    { label: t.ft,  away: fmtPct(game.away_ft_pct),  home: fmtPct(game.home_ft_pct) },
    { label: t.ast, away: fmt(game.away_ast),        home: fmt(game.home_ast) },
    { label: t.reb, away: fmt(game.away_reb),        home: fmt(game.home_reb) },
    { label: t.tov, away: fmt(game.away_tov),        home: fmt(game.home_tov) },
  ];

  // If everything is missing, don't render
  const hasAny = items.some(it => it.away !== '—' || it.home !== '—');
  if (!hasAny) return null;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: `auto repeat(${items.length}, minmax(0, 1fr))`,
        gap: 0.6, alignItems: 'center',
        pt: '10px', borderTop: `1px solid ${C.border}`,
      }}
    >
      <Box />
      {items.map(it => (
        <Typography
          key={`hdr-${it.label}`}
          sx={{ fontFamily: MONO, fontSize: '0.54rem', color: C.textMuted, letterSpacing: '0.12em', textAlign: 'center' }}
        >
          {it.label}
        </Typography>
      ))}
      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.66rem', color: C.textSecondary, letterSpacing: '0.08em', pr: '6px' }}>
        {game.away_team_abbr || 'AWY'}
      </Typography>
      {items.map(it => (
        <Typography
          key={`a-${it.label}`}
          sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textPrimary, textAlign: 'center' }}
        >
          {it.away}
        </Typography>
      ))}
      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.66rem', color: C.textSecondary, letterSpacing: '0.08em', pr: '6px' }}>
        {game.home_team_abbr || 'HOM'}
      </Typography>
      {items.map(it => (
        <Typography
          key={`h-${it.label}`}
          sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textPrimary, textAlign: 'center' }}
        >
          {it.home}
        </Typography>
      ))}
    </Box>
  );
}

function GameCard({ game, lang }) {
  const t = T[lang] || T.en;
  const periodLabel = formatPeriodLabel(game.live_period, game.live_clock, game.status, t);
  const awayLeading = game.away_score != null && game.home_score != null && game.away_score > game.home_score;
  const homeLeading = game.home_score != null && game.away_score != null && game.home_score > game.away_score;

  return (
    <Box
      sx={{
        position: 'relative',
        p: 2.5,
        border: `1px solid ${C.cyanLine}`,
        borderLeft: `3px solid ${C.cyan}`,
        background: 'linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))',
        boxShadow: '0 12px 28px rgba(0,0,0,0.42)',
        display: 'grid', gap: 2,
      }}
    >
      {/* Header: live pill + period/clock + arena */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            px: '8px', py: '3px',
            border: `1px solid ${C.amber}66`,
            background: 'rgba(255,170,0,0.10)',
            fontFamily: MONO, fontSize: '0.58rem', fontWeight: 700,
            color: C.amber, letterSpacing: '0.16em', textTransform: 'uppercase',
            '@keyframes nbaLivePulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.55 },
            },
            animation: 'nbaLivePulse 2s ease-in-out infinite',
          }}
        >
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: C.amber }} />
          {t.title}
        </Box>
        <Box
          sx={{
            px: '8px', py: '3px',
            border: `1px solid ${C.cyanLine}`,
            background: 'rgba(0,217,255,0.06)',
            fontFamily: MONO, fontSize: '0.62rem',
            color: C.cyan, letterSpacing: '0.1em',
          }}
        >
          {periodLabel}
        </Box>
        <Box sx={{ flex: 1 }} />
        {game.arena && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, letterSpacing: '0.08em' }}>
            {game.arena}{game.national_tv ? ` · ${game.national_tv}` : ''}
          </Typography>
        )}
      </Box>

      {/* Matchup + score */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <NbaLogo teamId={game.away_team_id} abbr={game.away_team_abbr} size={56} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '1.1rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.06em', lineHeight: 1.05 }}>
              {game.away_team_abbr || 'AWAY'}
            </Typography>
            <Typography noWrap sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, mt: 0.2 }}>
              {game.away_team_name || ''}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
          <Typography
            sx={{
              fontFamily: MONO, fontSize: { xs: '1.6rem', sm: '2.1rem' },
              fontWeight: 800,
              color: awayLeading ? C.amber : C.textPrimary,
              letterSpacing: '0.04em',
            }}
          >
            {game.away_score ?? '—'}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.8rem', color: C.textMuted }}>·</Typography>
          <Typography
            sx={{
              fontFamily: MONO, fontSize: { xs: '1.6rem', sm: '2.1rem' },
              fontWeight: 800,
              color: homeLeading ? C.amber : C.textPrimary,
              letterSpacing: '0.04em',
            }}
          >
            {game.home_score ?? '—'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, justifyContent: 'flex-end' }}>
          <Box sx={{ minWidth: 0, textAlign: 'right' }}>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '1.1rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.06em', lineHeight: 1.05 }}>
              {game.home_team_abbr || 'HOME'}
            </Typography>
            <Typography noWrap sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, mt: 0.2 }}>
              {game.home_team_name || ''}
            </Typography>
          </Box>
          <NbaLogo teamId={game.home_team_id} abbr={game.home_team_abbr} size={56} />
        </Box>
      </Box>

      <PeriodScoreTable game={game} lang={lang} />
      <StatStrip game={game} lang={lang} />
    </Box>
  );
}

export default function NBALiveTracker({ lang = 'es' }) {
  const t = T[lang] || T.en;
  const { token } = useAuth();
  const [games, setGames]     = useState([]);
  const [pickProgress, setPickProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [polling, setPolling] = useState(false);

  const fetchGames = useCallback(async () => {
    setPolling(true);
    try {
      const date = getEasternDateString();
      const res = await fetch(`${API_URL}/api/nba/games?date=${date}`);
      const json = await res.json();
      if (!json?.success) throw new Error(json?.error || 'fetch failed');
      const live = (json.data ?? []).filter(g => g.game_status_id === 2);
      setGames(live);
      setLastUpdate(new Date());
      setError('');

      if (token) {
        try {
          const progressRes = await fetch(`${API_URL}/api/picks/live-progress`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          });
          const progressJson = await progressRes.json();
          if (progressJson.success) {
            const rows = progressJson.data ?? [];
            setPickProgress(rows.filter(p => p.sport === 'nba'));
          }
        } catch {
          // optional
        }
      }
    } catch (err) {
      setError(err.message || 'fetch failed');
    } finally {
      setLoading(false);
      setPolling(false);
    }
  }, [token]);

  useEffect(() => {
    fetchGames();
    const id = setInterval(fetchGames, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchGames]);

  const lastUpdateLabel = useMemo(() => {
    if (!lastUpdate) return '—';
    return lastUpdate.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }, [lastUpdate, lang]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {/* Header strip */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.2,
          px: 2, py: 1.2,
          border: `1px solid ${C.border}`,
          background: 'rgba(0,0,0,0.4)',
        }}
      >
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.92rem', fontWeight: 800, color: C.amber, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          {t.title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {polling && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.cyan, letterSpacing: '0.16em' }}>
            {t.polling}
          </Typography>
        )}
        <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, letterSpacing: '0.08em' }}>
          {t.lastUpdate}: {lastUpdateLabel}
        </Typography>
      </Box>

      {pickProgress.length > 0 && (
        <NbaPickProgressPanel picks={pickProgress} lang={lang} />
      )}

      {/* Error */}
      {error && (
        <Box sx={{ border: `1px solid ${C.redLine}`, bgcolor: C.redDim, p: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.red }}>
            {error}
          </Typography>
        </Box>
      )}

      {/* Loading */}
      {loading && !games.length && (
        <Box sx={{ border: `1px solid ${C.border}`, p: 2.5 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textMuted }}>
            ...
          </Typography>
        </Box>
      )}

      {/* Empty */}
      {!loading && !games.length && !error && (
        <Box
          sx={{
            p: 4, border: `1px solid ${C.border}`, textAlign: 'center',
            background: 'linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))',
          }}
        >
          <Typography sx={{ fontFamily: BARLOW, fontSize: '1.1rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.8 }}>
            {t.noGames}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textMuted }}>
            {t.noGamesDesc}
          </Typography>
        </Box>
      )}

      {/* Game cards */}
      {games.map(g => (
        <GameCard key={g.game_id} game={g} lang={lang} />
      ))}
    </Box>
  );
}
