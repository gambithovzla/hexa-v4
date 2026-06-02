/**
 * SoccerLiveTracker.jsx
 *
 * Live scoreboard for soccer matches in progress across all active leagues.
 * Polls /api/soccer/games (all 6 leagues) every 60s, filters for live games,
 * and renders match time, score, and pending-pick progress.
 * Mirrors NflLiveTracker but adapted to soccer: no quarter/clock — just
 * "1st Half / Half Time / 2nd Half" from ESPN statusDetail.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import { BARLOW, MONO } from '../theme';
import { getSoccerLogoUrl } from '../utils/soccerLogoUrl';
import { useAuth } from '../store/authStore';
import { useHexaTheme } from '../themeProvider';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const POLL_INTERVAL = 60_000;

const SOCCER_LEAGUES = [
  { slug: 'eng.1',  name: 'Premier League', abbr: 'EPL' },
  { slug: 'esp.1',  name: 'La Liga',        abbr: 'LLG' },
  { slug: 'ger.1',  name: 'Bundesliga',     abbr: 'BUN' },
  { slug: 'ita.1',  name: 'Serie A',        abbr: 'SRA' },
  { slug: 'fra.1',  name: 'Ligue 1',        abbr: 'L1'  },
  { slug: 'usa.1',  name: 'MLS',            abbr: 'MLS' },
];

const GRASS = 'var(--brand-grass, #388e3c)';

const T = {
  en: {
    title: 'SOCCER LIVE', noGames: 'No soccer matches in progress',
    noGamesDesc: 'Live scores appear here when matches from any of the 6 supported leagues kick off.',
    lastUpdate: 'Last update', polling: 'POLLING', final: 'FINAL',
    firstHalf: '1ST HALF', halfTime: 'HALFTIME', secondHalf: '2ND HALF', et: 'ET',
    yourPicks: 'YOUR SOCCER PICKS',
  },
  es: {
    title: 'FÚTBOL EN VIVO', noGames: 'No hay partidos de fútbol en curso',
    noGamesDesc: 'Los marcadores aparecen aquí cuando haya partidos en vivo en cualquiera de las 6 ligas.',
    lastUpdate: 'Última actualización', polling: 'ACTUALIZANDO', final: 'FINAL',
    firstHalf: '1ª PARTE', halfTime: 'MEDIO TIEMPO', secondHalf: '2ª PARTE', et: 'PRÓRROGA',
    yourPicks: 'TUS PICKS SOCCER',
  },
};

function SoccerPickProgressPanel({ picks, lang }) {
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
            pick.status === 'won' || pick.status === 'winning' || pick.status === 'hitting'
              ? C.green
              : pick.status === 'lost' || pick.status === 'losing'
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

function SoccerLogo({ teamId, abbr, size = 52 }) {
  const { C } = useHexaTheme();
  const [failed, setFailed] = useState(false);
  const src = getSoccerLogoUrl(teamId, abbr, size);
  if (!src || failed) {
    return (
      <Box sx={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.border}`, bgcolor: 'rgba(255,255,255,0.03)' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: size * 0.26, color: C.textPrimary }}>{abbr?.slice(0, 3) || '—'}</Typography>
      </Box>
    );
  }
  return (
    <Box component="img" src={src} alt={abbr || 'team logo'} loading="lazy"
      onError={() => setFailed(true)}
      sx={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />
  );
}

function formatPeriodLabel(statusDetail, t) {
  if (!statusDetail) return '—';
  const d = String(statusDetail).toLowerCase();
  if (/halftime|half.time|break/i.test(d)) return t.halfTime;
  if (/1st half|first half|primera/i.test(d)) return t.firstHalf;
  if (/2nd half|second half|segunda/i.test(d)) return t.secondHalf;
  if (/extra|overtime|prolong/i.test(d)) return t.et;
  if (/final|full.time/i.test(d)) return t.final;
  return statusDetail;
}

function LeagueBadge({ leagueSlug }) {
  const meta = SOCCER_LEAGUES.find(l => l.slug === leagueSlug);
  const { C } = useHexaTheme();
  return (
    <Box sx={{ px: '8px', py: '3px', border: `1px solid ${GRASS}44`, background: 'rgba(56,142,60,0.10)', fontFamily: MONO, fontSize: '0.55rem', color: GRASS, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
      {meta?.abbr ?? leagueSlug}
    </Box>
  );
}

function GameCard({ game, lang }) {
  const { C, isLeague } = useHexaTheme();
  const t = T[lang] || T.en;
  const periodLabel = formatPeriodLabel(game.statusDetail, t);
  const home = game.teams?.home ?? {};
  const away = game.teams?.away ?? {};
  const awayLeading = away.score != null && home.score != null && away.score > home.score;
  const homeLeading = home.score != null && away.score != null && home.score > away.score;

  return (
    <Box sx={{
      position: 'relative', p: 2.5,
      border: `1px solid ${C.cyanLine}`,
      borderLeft: `3px solid ${GRASS}`,
      background: isLeague ? C.surface : 'linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))',
      boxShadow: isLeague ? 'none' : '0 12px 28px rgba(0,0,0,0.42)',
      display: 'grid', gap: 2,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{
          display: 'inline-flex', alignItems: 'center', gap: '6px', px: '8px', py: '3px',
          border: `1px solid ${GRASS}66`, background: 'rgba(56,142,60,0.10)',
          fontFamily: MONO, fontSize: '0.58rem', fontWeight: 700, color: GRASS,
          letterSpacing: '0.16em', textTransform: 'uppercase',
          '@keyframes soccerLivePulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.55 } },
          animation: 'soccerLivePulse 2s ease-in-out infinite',
        }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: GRASS }} />
          {t.title}
        </Box>
        <Box sx={{ px: '8px', py: '3px', border: `1px solid ${C.cyanLine}`, background: 'rgba(0,217,255,0.06)', fontFamily: MONO, fontSize: '0.62rem', color: C.cyan, letterSpacing: '0.1em' }}>
          {periodLabel}
        </Box>
        <LeagueBadge leagueSlug={game.league} />
        <Box sx={{ flex: 1 }} />
        {game.venue && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, letterSpacing: '0.08em' }}>
            {game.venue}
          </Typography>
        )}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <SoccerLogo teamId={away.id} abbr={away.abbreviation} size={52} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '1.05rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.06em', lineHeight: 1.05 }}>
              {away.abbreviation || away.name?.slice(0, 10) || 'AWAY'}
            </Typography>
            <Typography noWrap sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, mt: 0.2 }}>
              {away.name || ''}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: { xs: '1.6rem', sm: '2.1rem' }, fontWeight: 800, color: awayLeading ? GRASS : C.textPrimary, letterSpacing: '0.04em' }}>
            {away.score ?? '—'}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '1rem', color: C.textMuted }}>–</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: { xs: '1.6rem', sm: '2.1rem' }, fontWeight: 800, color: homeLeading ? GRASS : C.textPrimary, letterSpacing: '0.04em' }}>
            {home.score ?? '—'}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, justifyContent: 'flex-end' }}>
          <Box sx={{ minWidth: 0, textAlign: 'right' }}>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '1.05rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.06em', lineHeight: 1.05 }}>
              {home.abbreviation || home.name?.slice(0, 10) || 'HOME'}
            </Typography>
            <Typography noWrap sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, mt: 0.2 }}>
              {home.name || ''}
            </Typography>
          </Box>
          <SoccerLogo teamId={home.id} abbr={home.abbreviation} size={52} />
        </Box>
      </Box>
    </Box>
  );
}

export default function SoccerLiveTracker({ lang = 'es' }) {
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
      // Fetch all 6 leagues in parallel, filter live games
      const results = await Promise.allSettled(
        SOCCER_LEAGUES.map(l =>
          fetch(`${API_URL}/api/soccer/games?league=${l.slug}`).then(r => r.json())
        )
      );
      const live = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value?.success) {
          const liveGames = (r.value.data ?? []).filter(g => g.status === 'live');
          live.push(...liveGames);
        }
      }
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
            setPickProgress((progressJson.data ?? []).filter(p => p.sport === 'soccer'));
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
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.92rem', fontWeight: 800, color: GRASS, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
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

      {pickProgress.length > 0 && <SoccerPickProgressPanel picks={pickProgress} lang={lang} />}

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

      {games.map(g => <GameCard key={`${g.league}-${g.gameId}`} game={g} lang={lang} />)}
    </Box>
  );
}
