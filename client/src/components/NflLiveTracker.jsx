/**
 * NflLiveTracker.jsx
 *
 * Live scoreboard for NFL games in progress. Polls /api/nfl/games (current week)
 * every 60s, filters for `game_status_id === 2`, and renders quarter/clock,
 * score, and pending-pick progress. Mirrors NBALiveTracker but adapted to NFL:
 * the ESPN scoreboard exposes period (quarter) + clock + scores, not per-quarter
 * box or FG% strips, so the card is leaner.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import { BARLOW, MONO } from '../theme';
import { getNflLogoUrl } from '../utils/nflLogoUrl';
import { useAuth } from '../store/authStore';
import { useHexaTheme } from '../themeProvider';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const POLL_INTERVAL = 60_000; // NFL clock moves slower than NBA; 60s is plenty

const T = {
  en: {
    title: 'NFL LIVE', noGames: 'No NFL games in progress',
    noGamesDesc: 'Live scores appear here on game days (Thu / Sun / Mon).',
    lastUpdate: 'Last update', polling: 'POLLING', final: 'FINAL',
    half: 'HALFTIME', end: 'END', ot: 'OT', yourPicks: 'YOUR NFL PICKS',
  },
  es: {
    title: 'NFL EN VIVO', noGames: 'No hay juegos NFL en progreso',
    noGamesDesc: 'Los marcadores aparecen aquí en días de juego (Jue / Dom / Lun).',
    lastUpdate: 'Última actualización', polling: 'ACTUALIZANDO', final: 'FINAL',
    half: 'MEDIO TIEMPO', end: 'FIN', ot: 'TS', yourPicks: 'TUS PICKS NFL',
  },
};

function NflPickProgressPanel({ picks, lang }) {
  const { C } = useHexaTheme();
  const t = T[lang] || T.en;
  if (!picks?.length) return null;
  return (
    <Box sx={{ border: `1px solid ${C.border}`, p: 2, bgcolor: 'rgba(0,0,0,0.35)' }}>
      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.62rem', color: C.textMuted, letterSpacing: '0.14em', mb: 1.2 }}>
        {t.yourPicks}
      </Typography>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {picks.map((pick) => {
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
                  sx={{ height: 4, borderRadius: 0, bgcolor: 'rgba(255,255,255,0.06)', '& .MuiLinearProgress-bar': { bgcolor: color } }}
                />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function NflLogo({ teamId, abbr, size = 52 }) {
  const { C } = useHexaTheme();
  const [failed, setFailed] = useState(false);
  if ((!abbr && !teamId) || failed) {
    return (
      <Box sx={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.border}`, bgcolor: 'rgba(255,255,255,0.03)' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: size * 0.26, color: C.textPrimary }}>{abbr || '—'}</Typography>
      </Box>
    );
  }
  return (
    <Box component="img" src={getNflLogoUrl(teamId, abbr)} alt={abbr || 'team logo'} loading="lazy"
      onError={() => setFailed(true)}
      sx={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />
  );
}

function formatPeriodLabel(period, clock, statusText, t) {
  if (!period) return statusText || '—';
  if (/halftime/i.test(statusText ?? '')) return t.half;
  if (period <= 4) {
    const base = `Q${period}`;
    if (clock && /0?0:00/.test(clock)) return `${t.end} ${base}`;
    return clock ? `${base} ${clock}` : base;
  }
  return clock ? `${t.ot} ${clock}` : t.ot;
}

function GameCard({ game, lang }) {
  const { C, isLeague } = useHexaTheme();
  const t = T[lang] || T.en;
  const periodLabel = formatPeriodLabel(game.live_period, game.live_clock, game.status, t);
  const awayLeading = game.away_score != null && game.home_score != null && game.away_score > game.home_score;
  const homeLeading = game.home_score != null && game.away_score != null && game.home_score > game.away_score;

  return (
    <Box sx={{
      position: 'relative', p: 2.5,
      border: `1px solid ${C.cyanLine}`,
      borderLeft: `3px solid ${isLeague ? 'var(--sport-accent)' : C.cyan}`,
      background: isLeague ? C.surface : 'linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))',
      boxShadow: isLeague ? 'none' : '0 12px 28px rgba(0,0,0,0.42)',
      display: 'grid', gap: 2,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{
          display: 'inline-flex', alignItems: 'center', gap: '6px', px: '8px', py: '3px',
          border: `1px solid ${C.amber}66`, background: 'rgba(255,170,0,0.10)',
          fontFamily: MONO, fontSize: '0.58rem', fontWeight: 700, color: C.amber,
          letterSpacing: '0.16em', textTransform: 'uppercase',
          '@keyframes nflLivePulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.55 } },
          animation: 'nflLivePulse 2s ease-in-out infinite',
        }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: C.amber }} />
          {t.title}
        </Box>
        <Box sx={{ px: '8px', py: '3px', border: `1px solid ${C.cyanLine}`, background: 'rgba(0,217,255,0.06)', fontFamily: MONO, fontSize: '0.62rem', color: C.cyan, letterSpacing: '0.1em' }}>
          {periodLabel}
        </Box>
        <Box sx={{ flex: 1 }} />
        {game.venue && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, letterSpacing: '0.08em' }}>
            {game.venue}{game.national_tv ? ` · ${game.national_tv}` : ''}
          </Typography>
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <NflLogo teamId={game.away_team_id} abbr={game.away_team_abbr} size={52} />
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
          <Typography sx={{ fontFamily: MONO, fontSize: { xs: '1.6rem', sm: '2.1rem' }, fontWeight: 800, color: awayLeading ? C.amber : C.textPrimary, letterSpacing: '0.04em' }}>
            {game.away_score ?? '—'}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.8rem', color: C.textMuted }}>·</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: { xs: '1.6rem', sm: '2.1rem' }, fontWeight: 800, color: homeLeading ? C.amber : C.textPrimary, letterSpacing: '0.04em' }}>
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
          <NflLogo teamId={game.home_team_id} abbr={game.home_team_abbr} size={52} />
        </Box>
      </Box>
    </Box>
  );
}

export default function NflLiveTracker({ lang = 'es' }) {
  const { C, isLeague } = useHexaTheme();
  const t = T[lang] || T.en;
  const { token } = useAuth();
  const [games, setGames] = useState([]);
  const [pickProgress, setPickProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [polling, setPolling] = useState(false);

  const fetchGames = useCallback(async () => {
    setPolling(true);
    try {
      // No params → current NFL week (the endpoint resolves it server-side).
      const res = await fetch(`${API_URL}/api/nfl/games`);
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
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          });
          const progressJson = await progressRes.json();
          if (progressJson.success) {
            setPickProgress((progressJson.data ?? []).filter(p => p.sport === 'nfl'));
          }
        } catch { /* optional */ }
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
    return lastUpdate.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, [lastUpdate, lang]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, px: 2, py: 1.2, border: `1px solid ${C.border}`, background: isLeague ? C.surface : 'rgba(0,0,0,0.4)' }}>
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.92rem', fontWeight: 800, color: C.amber, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          {t.title}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {polling && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.cyan, letterSpacing: '0.16em' }}>{t.polling}</Typography>
        )}
        <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, letterSpacing: '0.08em' }}>
          {t.lastUpdate}: {lastUpdateLabel}
        </Typography>
      </Box>

      {pickProgress.length > 0 && <NflPickProgressPanel picks={pickProgress} lang={lang} />}

      {error && (
        <Box sx={{ border: `1px solid ${C.redLine}`, bgcolor: C.redDim, p: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.red }}>{error}</Typography>
        </Box>
      )}

      {loading && !games.length && (
        <Box sx={{ border: `1px solid ${C.border}`, p: 2.5 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textMuted }}>...</Typography>
        </Box>
      )}

      {!loading && !games.length && !error && (
        <Box sx={{ p: 4, border: `1px solid ${C.border}`, textAlign: 'center', background: isLeague ? C.surface : 'linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))' }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '1.1rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.8 }}>
            {t.noGames}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textMuted }}>{t.noGamesDesc}</Typography>
        </Box>
      )}

      {games.map(g => <GameCard key={g.game_id} game={g} lang={lang} />)}
    </Box>
  );
}
