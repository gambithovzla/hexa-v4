/**
 * LiveTracker.jsx — H.E.X.A. V4
 *
 * Real-time scoreboard, diamond situation, play-by-play feed,
 * and pick progress bars for all in-progress MLB games.
 * Polls /api/games/live every 30 seconds.
 */

import { useState, useEffect, useCallback } from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import { C, BARLOW, MONO, SANS } from '../theme';
import { useAuth } from '../store/authStore';

const API_URL      = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const POLL_INTERVAL = 30_000;

const T = {
  en: {
    title:        'LIVE TRACKER',
    noGames:      'No games in progress',
    noGamesDesc:  'Live scores will appear here when games start.',
    lastUpdate:   'Last update',
    polling:      'POLLING',
    inning:       'INN',
    top:          'T',
    bot:          'B',
    outs:         'OUT',
    count:        'COUNT',
    batter:       'BATTER',
    pitcher:      'PITCHER',
    atBat:        'AT BAT',
    recentPlays:  'RECENT PLAYS',
    yourPicks:    'YOUR PICKS',
    noPicks:      'No picks for this game',
    runs:         'R',
    hits:         'H',
    errors:       'E',
    winning:      'ON TRACK',
    losing:       'BEHIND',
    resolved:     'RESOLVED',
  },
  es: {
    title:        'EN VIVO',
    noGames:      'No hay juegos en progreso',
    noGamesDesc:  'Los marcadores aparecerán aquí cuando comiencen los juegos.',
    lastUpdate:   'Última actualización',
    polling:      'ACTUALIZANDO',
    inning:       'INN',
    top:          'T',
    bot:          'B',
    outs:         'OUTS',
    count:        'CONTEO',
    batter:       'BATEADOR',
    pitcher:      'PITCHER',
    atBat:        'AL BATE',
    recentPlays:  'JUGADAS RECIENTES',
    yourPicks:    'TUS PICKS',
    noPicks:      'Sin picks para este juego',
    runs:         'C',
    hits:         'H',
    errors:       'E',
    winning:      'EN CAMINO',
    losing:       'ATRÁS',
    resolved:     'RESUELTO',
  },
};

// ── Pick bar color helper ─────────────────────────────────────────────────────

function getPickBarColor(pick) {
  if (!pick || pick.status === 'pending' || pick.status === 'not_started') return C.textMuted;
  if (pick.status === 'won' || pick.status === 'hitting' || pick.status === 'winning' || pick.status === 'covering') return C.green || '#00ff88';
  if (pick.status === 'lost' || pick.status === 'losing' || pick.status === 'not_covering') return C.red || '#ff3d57';

  if (pick.type === 'total' || pick.type === 'player_prop') {
    if (pick.direction === 'over') {
      return pick.progress < 70 ? (C.green || '#00ff88') : (pick.progress < 90 ? (C.amber || '#ffaa00') : (C.green || '#00ff88'));
    } else {
      return pick.progress < 60 ? (C.green || '#00ff88') : (pick.progress < 85 ? (C.amber || '#ffaa00') : (C.red || '#ff3d57'));
    }
  }

  return C.accent;
}

// ── Diamond SVG ───────────────────────────────────────────────────────────────

function DiamondSVG({ runners, size = 70 }) {
  const s  = size;
  const cx = s / 2, cy = s / 2;
  const d  = s * 0.3;
  const bs = 8;

  const bases = [
    { x: cx + d, y: cy,     occupied: runners?.first  },
    { x: cx,     y: cy - d, occupied: runners?.second },
    { x: cx - d, y: cy,     occupied: runners?.third  },
  ];

  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      {/* Diamond outline */}
      <path
        d={`M${cx} ${cy + d} L${cx + d} ${cy} L${cx} ${cy - d} L${cx - d} ${cy} Z`}
        fill="none" stroke={C.border} strokeWidth="1"
      />
      {/* Home plate */}
      <rect
        x={cx - 4} y={cy + d - 4} width="8" height="8"
        fill={C.textMuted}
        transform={`rotate(45 ${cx} ${cy + d})`}
      />
      {/* Bases */}
      {bases.map((base, i) => (
        <rect
          key={i}
          x={base.x - bs / 2} y={base.y - bs / 2}
          width={bs} height={bs}
          fill={base.occupied ? C.cyan : 'transparent'}
          stroke={base.occupied ? C.cyan : C.border}
          strokeWidth="1.5"
          transform={`rotate(45 ${base.x} ${base.y})`}
        />
      ))}
    </svg>
  );
}

// ── Outs display ──────────────────────────────────────────────────────────────

function OutsDisplay({ outs, label }) {
  return (
    <Box sx={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, mr: '4px', letterSpacing: '0.08em' }}>
        {label || 'OUT'}
      </Typography>
      {[0, 1, 2].map(i => (
        <Box key={i} sx={{
          width:        10,
          height:       10,
          borderRadius: '50%',
          bgcolor:      i < outs ? C.accent : 'transparent',
          border:       `1.5px solid ${i < outs ? C.accent : C.border}`,
        }} />
      ))}
    </Box>
  );
}

// ── Scoreboard ────────────────────────────────────────────────────────────────

function Scoreboard({ game, lang }) {
  const { innings: gameInnings, away, home, situation } = game;
  if (!gameInnings && !away) return null;

  const t          = T[lang] || T.en;
  const innings    = gameInnings || [];
  const totalInns  = Math.max(9, innings.length);
  const currentInn = situation?.inning || 0;

  const awayRow = Array.from({ length: totalInns }, (_, i) => innings[i]?.away?.runs ?? (i < innings.length ? 0 : ''));
  const homeRow = Array.from({ length: totalInns }, (_, i) => innings[i]?.home?.runs ?? (i < innings.length ? 0 : ''));

  const cellSx = {
    fontFamily: MONO,
    fontSize:   '0.65rem',
    textAlign:  'center',
    minWidth:   '22px',
    px:         '2px',
  };

  const headerCell = {
    ...cellSx,
    color: C.textMuted,
    pb:    '4px',
    borderBottom: `1px solid ${C.border}`,
  };

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: '0.65rem' }}>
        <thead>
          <tr>
            <Box component="th" sx={{ ...headerCell, minWidth: '42px', textAlign: 'left', pr: '8px' }} />
            {Array.from({ length: totalInns }, (_, i) => (
              <Box
                component="th"
                key={i}
                sx={{
                  ...headerCell,
                  color:   i + 1 === currentInn ? C.cyan : C.textMuted,
                  bgcolor: i + 1 === currentInn ? C.cyanDim : 'transparent',
                  px:      '4px',
                }}
              >
                {i + 1}
              </Box>
            ))}
            <Box component="th" sx={{ ...headerCell, borderLeft: `1px solid ${C.border}`, px: '8px', color: C.accent }}>{t.runs}</Box>
            <Box component="th" sx={{ ...headerCell, px: '8px', color: C.textMuted }}>{t.hits}</Box>
            <Box component="th" sx={{ ...headerCell, px: '8px', color: C.textMuted }}>{t.errors}</Box>
          </tr>
        </thead>
        <tbody>
          {[
            { label: away?.abbreviation || 'AWY', row: awayRow, rhe: away, teamId: away?.id },
            { label: home?.abbreviation || 'HOM', row: homeRow, rhe: home, teamId: home?.id },
          ].map(({ label, row, rhe, teamId }) => (
            <tr key={label}>
              <Box
                component="td"
                sx={{ fontFamily: BARLOW, fontSize: '0.65rem', letterSpacing: '0.1em', color: C.textSecondary, pr: '8px', py: '4px', whiteSpace: 'nowrap' }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {teamId && (
                    <img
                      src={`https://www.mlbstatic.com/team-logos/${teamId}.svg`}
                      alt=""
                      style={{ width: 16, height: 16 }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <Typography sx={{ fontFamily: BARLOW, fontSize: '0.65rem', letterSpacing: '0.1em', color: C.textSecondary }}>
                    {label}
                  </Typography>
                </Box>
              </Box>
              {row.map((val, i) => (
                <Box
                  component="td"
                  key={i}
                  sx={{
                    ...cellSx,
                    py:      '4px',
                    color:   val === '' ? C.textGhost : val > 0 ? C.textPrimary : C.textMuted,
                    bgcolor: i + 1 === currentInn ? C.cyanDim : 'transparent',
                    fontWeight: val > 0 ? 700 : 400,
                  }}
                >
                  {val === '' ? '-' : val}
                </Box>
              ))}
              <Box component="td" sx={{ ...cellSx, py: '4px', borderLeft: `1px solid ${C.border}`, px: '8px', color: C.accent, fontWeight: 700 }}>
                {rhe?.score ?? 0}
              </Box>
              <Box component="td" sx={{ ...cellSx, py: '4px', px: '8px', color: C.textSecondary }}>
                {rhe?.hits ?? 0}
              </Box>
              <Box component="td" sx={{ ...cellSx, py: '4px', px: '8px', color: C.textMuted }}>
                {rhe?.errors ?? 0}
              </Box>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

// ── Recent plays feed ─────────────────────────────────────────────────────────

function RecentPlaysFeed({ plays, lang }) {
  const t = T[lang] || T.en;
  if (!plays || plays.length === 0) return null;

  const last5 = [...plays].slice(0, 5);

  const eventColors = {
    Strikeout: C.red, 'Strikeout Swinging': C.red, 'Strikeout Looking': C.red,
    'Home Run': C.accent, Single: C.cyan, Double: C.cyan, Triple: C.cyan,
    Walk: C.green, 'Hit By Pitch': C.green,
  };

  return (
    <Box>
      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.55rem', color: C.textMuted, letterSpacing: '0.15em', mb: '6px' }}>
        {t.recentPlays}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {last5.map((play, i) => {
          const isScoring = play.isScoring;
          const half      = (play.halfInning === 'top' || play.halfInning === 'Top') ? '▲' : '▼';
          const inn       = play.inning || '?';
          const eventColor = eventColors[play.event] || C.textSecondary;

          return (
            <Box
              key={i}
              sx={{
                display:  'flex',
                gap:      '8px',
                px:       '8px',
                py:       '3px',
                bgcolor:  isScoring ? `${C.green}10` : i === 0 ? C.cyanDim : 'transparent',
                borderLeft: `2px solid ${isScoring ? C.green : i === 0 ? C.cyan : 'transparent'}`,
              }}
            >
              <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {half}{inn}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textPrimary, lineHeight: 1.4, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {play.batter}:
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: eventColor, fontWeight: 600, lineHeight: 1.4 }}>
                {play.event}
              </Typography>
              {isScoring && (
                <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.green, flexShrink: 0, alignSelf: 'center' }}>
                  ⚡
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ── Pick progress bars ────────────────────────────────────────────────────────

function PickProgressBars({ picks, lang }) {
  const t = T[lang] || T.en;
  if (!picks || picks.length === 0) return null;

  return (
    <Box>
      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.55rem', color: C.textMuted, letterSpacing: '0.15em', mb: '8px' }}>
        {t.yourPicks}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {picks.map((pick, i) => {
          const { label, current, target, status, pct, details } = pick;
          const isWon  = status === 'won';
          const isLost = status === 'lost';
          const isDone = isWon || isLost;

          const isML_RL = pick.type === 'moneyline' || pick.type === 'runline';

          // Calculate bar width from current and target
          const barProgress = pick.current != null && pick.target
            ? Math.min(100, Math.round((pick.current / pick.target) * 100))
            : 0;

          // Color logic for the progress bar fill
          const pickBarColor = (() => {
            if (!pick || pick.status === 'pending' || pick.status === 'not_started') return C.textMuted || '#666';
            if (pick.status === 'won' || pick.status === 'hitting') return C.green || '#00ff88';
            if (pick.status === 'lost') return C.red || '#ff3d57';
            // For Under: green while safely under, amber near target, red if over
            if (pick.label?.toLowerCase().includes('under')) {
              if (barProgress < 65) return C.green || '#00ff88';
              if (barProgress < 85) return C.amber || '#ffaa00';
              return C.red || '#ff3d57';
            }
            // For Over: green shows progress toward goal
            if (pick.label?.toLowerCase().includes('over')) {
              if (barProgress >= 100) return C.green || '#00ff88';
              if (barProgress >= 70) return C.amber || '#ffaa00';
              return C.accent || '#00d9ff';
            }
            return C.accent || '#00d9ff';
          })();

          const barColor  = pickBarColor;
          const textColor = isWon ? C.green : isLost ? C.red : C.textSecondary;

          const mlStatusColor =
            status === 'winning' || status === 'covering' || status === 'won'
              ? (C.green || '#00ff88')
              : status === 'losing' || status === 'not_covering' || status === 'lost'
                ? (C.red || '#ff3d57')
                : (C.amber || '#ffaa00');

          const mlBorderColor =
            status === 'winning' || status === 'covering' || status === 'won'
              ? (C.greenLine || 'rgba(0,255,136,0.3)')
              : status === 'losing' || status === 'not_covering' || status === 'lost'
                ? (C.redLine || 'rgba(255,61,87,0.3)')
                : (C.amberLine || 'rgba(255,170,0,0.3)');

          const mlLabel =
            status === 'winning' || status === 'covering' ? '✓ W' :
            status === 'losing'  || status === 'not_covering' ? '✗ L' :
            status === 'tied' ? '— T' :
            status === 'won'  ? '✓ WON' :
            status === 'lost' ? '✗ LOST' : '—';

          return (
            <Box key={i}>
              {isML_RL ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textPrimary }}>
                    {label}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {details && (
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textSecondary }}>
                        {details}
                      </Typography>
                    )}
                    <Typography sx={{
                      fontFamily: MONO, fontSize: '0.75rem', fontWeight: 700,
                      color: mlStatusColor,
                      padding: '2px 8px',
                      border: `1px solid`,
                      borderColor: mlBorderColor,
                      borderRadius: '2px',
                      letterSpacing: '1px',
                    }}>
                      {mlLabel}
                    </Typography>
                  </Box>
                </Box>
              ) : (
                <>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '4px' }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: textColor, letterSpacing: '0.05em' }}>
                      {label}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted }}>
                        {current}/{target}
                      </Typography>
                      {isDone ? (
                        <Box sx={{
                          px: '6px', py: '1px',
                          border: `1px solid ${isWon ? C.greenLine : C.redLine}`,
                          bgcolor: isWon ? C.greenDim : C.redDim,
                          fontFamily: BARLOW, fontSize: '0.5rem',
                          color: isWon ? C.green : C.red,
                          letterSpacing: '0.1em',
                        }}>
                          {isWon ? 'WON' : 'LOST'}
                        </Box>
                      ) : (
                        <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: barColor }}>
                          {barProgress}%
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ position: 'relative', height: '4px', bgcolor: `${barColor}20`, borderRadius: '1px' }}>
                    <Box sx={{
                      position: 'absolute', top: 0, left: 0,
                      height:   '100%',
                      width:    `${barProgress}%`,
                      bgcolor:  barColor,
                      borderRadius: '1px',
                      transition: 'width 0.4s ease',
                    }} />
                  </Box>
                </>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ── Live game card ────────────────────────────────────────────────────────────

function LiveGameCard({ game, picks, lang }) {
  const [expanded, setExpanded] = useState(true);
  const t = T[lang] || T.en;

  const { situation, recentPlays } = game;

  const inningHalf = situation?.halfInning === 'Top' ? t.top : t.bot;
  const inningNum  = situation?.inning ?? 0;
  const outs       = situation?.outs ?? 0;
  const balls      = situation?.balls ?? 0;
  const strikes    = situation?.strikes ?? 0;
  const batter     = situation?.currentBatter?.name ?? '—';
  const pitcher    = situation?.currentPitcher?.name ?? '—';
  const runners    = situation?.runners || {};

  const awayRuns = game.away?.score ?? 0;
  const homeRuns = game.home?.score ?? 0;

  const gamePicks = picks?.filter(p => p.gamePk === game.gamePk) || [];

  return (
    <Box sx={{
      border:   `1px solid ${C.border}`,
      bgcolor:  C.surface,
      mb:       '12px',
    }}>
      {/* Card header */}
      <Box
        component="button"
        onClick={() => setExpanded(v => !v)}
        sx={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          width:          '100%',
          p:              '10px 14px',
          bgcolor:        'transparent',
          border:         'none',
          borderBottom:   expanded ? `1px solid ${C.border}` : 'none',
          cursor:         'pointer',
          gap:            '12px',
        }}
      >
        {/* Teams */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {game.away?.id && (
            <img
              src={`https://www.mlbstatic.com/team-logos/${game.away.id}.svg`}
              alt={game.away.abbreviation}
              style={{ width: 24, height: 24, marginRight: 6 }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.95rem', letterSpacing: '0.15em', color: C.textSecondary }}>
            {game.away?.abbreviation || 'AWY'}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '1.1rem', color: C.textPrimary, fontWeight: 700, mx: '4px' }}>
            {awayRuns}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textMuted }}>–</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '1.1rem', color: C.textPrimary, fontWeight: 700, mx: '4px' }}>
            {homeRuns}
          </Typography>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.95rem', letterSpacing: '0.15em', color: C.textSecondary }}>
            {game.home?.abbreviation || 'HOM'}
          </Typography>
          {game.home?.id && (
            <img
              src={`https://www.mlbstatic.com/team-logos/${game.home.id}.svg`}
              alt={game.home.abbreviation}
              style={{ width: 24, height: 24, marginLeft: 6 }}
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
        </Box>

        {/* Inning indicator */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Box sx={{
            px:        '6px',
            py:        '2px',
            bgcolor:   C.cyanDim,
            border:    `1px solid ${C.cyanLine}`,
            fontFamily: MONO,
            fontSize:  '0.6rem',
            color:     C.cyan,
            letterSpacing: '0.08em',
          }}>
            ● {inningHalf}{inningNum}
          </Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textMuted }}>
            {expanded ? '▲' : '▼'}
          </Typography>
        </Box>
      </Box>

      {/* Card body */}
      {expanded && (
        <Box sx={{ p: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Scoreboard */}
          <Scoreboard game={game} lang={lang} />

          {/* Situation panel */}
          <Box sx={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {/* Diamond + outs */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <DiamondSVG runners={runners} size={72} />
              <OutsDisplay outs={outs} label={t.outs} />
            </Box>

            {/* Batter / Pitcher / Count */}
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '180px' }}>
              <Box>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, letterSpacing: '0.12em', mb: '2px' }}>
                  {t.batter}
                </Typography>
                <Typography sx={{ fontFamily: BARLOW, fontSize: '0.72rem', color: C.textPrimary, letterSpacing: '0.1em' }}>
                  {batter}
                </Typography>
              </Box>
              <Box>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, letterSpacing: '0.12em', mb: '2px' }}>
                  {t.pitcher}
                </Typography>
                <Typography sx={{ fontFamily: BARLOW, fontSize: '0.72rem', color: C.textPrimary, letterSpacing: '0.1em' }}>
                  {pitcher}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, letterSpacing: '0.12em' }}>
                  {t.count}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem', color: C.cyan, letterSpacing: '0.08em' }}>
                  {balls}–{strikes}
                </Typography>
              </Box>
            </Box>

            {/* Player photos — right side */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', ml: 'auto' }}>
              {situation?.currentBatter?.id && (
                <Box sx={{ textAlign: 'center' }}>
                  <img
                    src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${situation.currentBatter.id}/headshot/67/current`}
                    alt={situation.currentBatter.name}
                    style={{ width: 56, height: 56, borderRadius: '50%', border: `2px solid ${C.accent}`, objectFit: 'cover', background: C.surface }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, mt: '2px', letterSpacing: '1px' }}>
                    AB
                  </Typography>
                </Box>
              )}
              {situation?.currentPitcher?.id && (
                <Box sx={{ textAlign: 'center' }}>
                  <img
                    src={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${situation.currentPitcher.id}/headshot/67/current`}
                    alt={situation.currentPitcher.name}
                    style={{ width: 56, height: 56, borderRadius: '50%', border: `2px solid ${C.orange || '#ff6600'}`, objectFit: 'cover', background: C.surface }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, mt: '2px', letterSpacing: '1px' }}>
                    P
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>

          {/* Recent plays */}
          {recentPlays && recentPlays.length > 0 && (
            <RecentPlaysFeed plays={recentPlays} lang={lang} />
          )}

          {/* Pick progress bars */}
          {gamePicks.length > 0 && (
            <PickProgressBars picks={gamePicks} lang={lang} />
          )}
        </Box>
      )}
    </Box>
  );
}

// ── Main LiveTracker component ────────────────────────────────────────────────

export default function LiveTracker({ lang = 'en' }) {
  const { token } = useAuth();
  const t         = T[lang] || T.en;

  const [liveGames,   setLiveGames]   = useState([]);
  const [pickProgress, setPickProgress] = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [lastUpdate,  setLastUpdate]  = useState(null);

  const fetchLiveData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Get today's games
      const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      etNow.setHours(etNow.getHours() - 5);
      const today    = etNow.toLocaleDateString('en-CA');
      const gamesRes = await fetch(`${API_URL}/api/games?date=${today}`);
      const gamesJson = await gamesRes.json();
      const allGames  = gamesJson.success ? gamesJson.data : [];

      // 2. Filter live games
      const liveGamePks = allGames
        .filter(g => {
          const simplified = (g.status?.simplified ?? '').toLowerCase();
          const abstract   = (g.status?.abstractGameState ?? '').toLowerCase();
          const detailed   = (g.status?.detailedState ?? g.status?.description ?? '').toLowerCase();
          const code       = g.status?.code ?? g.status?.codedGameState ?? '';
          return (
            simplified === 'live' ||
            abstract   === 'live' ||
            detailed   === 'in progress' ||
            detailed   === 'warmup' ||
            detailed   === 'manager challenge' ||
            code       === 'I' ||
            code       === 'MA'
          );
        })
        .map(g => g.gamePk);

      if (liveGamePks.length === 0) {
        setLiveGames([]);
        setLoading(false);
        setLastUpdate(new Date());
        return;
      }

      // 3. Fetch live data
      const liveRes  = await fetch(`${API_URL}/api/games/live`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ gamePks: liveGamePks }),
      });
      const liveJson = await liveRes.json();
      if (liveJson.success) setLiveGames(liveJson.data);

      // Auto-resolve picks for games that just finished
      if (token && liveJson?.data) {
        for (const game of liveJson.data) {
          if (game.status === 'final') {
            try {
              await fetch(`${API_URL}/api/picks/resolve-game`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ gamePk: game.gamePk }),
              });
            } catch (e) { /* silent */ }
          }
        }
      }

      // 4. Fetch pick progress (authenticated only)
      if (token) {
        try {
          const progressRes = await fetch(`${API_URL}/api/picks/live-progress`, {
            method:  'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:  `Bearer ${token}`,
            },
          });
          const progressJson = await progressRes.json();
          if (progressJson.success) setPickProgress(progressJson.data || []);
        } catch {
          // silent — picks are optional
        }
      }

      setLastUpdate(new Date());
    } catch (err) {
      console.error('[LiveTracker] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchLiveData();
    const interval = setInterval(fetchLiveData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchLiveData]);

  // Format time as HH:MM:SS
  function fmtTime(d) {
    if (!d) return '—';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', py: 2 }}>
      {/* ── Header bar ── */}
      <Box sx={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        mb:             '20px',
        pb:             '12px',
        borderBottom:   `1px solid ${C.border}`,
        flexWrap:       'wrap',
        gap:            '10px',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.85rem', letterSpacing: '0.2em', color: C.cyan }}>
            {t.title}
          </Typography>
          {/* Pulsing live dot */}
          <Box sx={{
            width:        8,
            height:       8,
            borderRadius: '50%',
            bgcolor:      C.red,
            '@keyframes livePulse': {
              '0%, 100%': { opacity: 1, boxShadow: `0 0 0 0 ${C.red}80` },
              '50%':      { opacity: 0.7, boxShadow: `0 0 0 5px transparent` },
            },
            animation: 'livePulse 1.5s ease-in-out infinite',
          }} />
          {liveGames.length > 0 && (
            <Box sx={{
              px:        '6px',
              py:        '1px',
              bgcolor:   `${C.red}18`,
              border:    `1px solid ${C.redLine}`,
              fontFamily: MONO,
              fontSize:  '0.55rem',
              color:     C.red,
              letterSpacing: '0.1em',
            }}>
              {liveGames.length} LIVE
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Subtle loading bar */}
          {loading && (
            <Box sx={{ width: '60px' }}>
              <LinearProgress
                sx={{
                  height: 2,
                  bgcolor: C.cyanDim,
                  '& .MuiLinearProgress-bar': { bgcolor: C.cyan },
                }}
              />
            </Box>
          )}
          {lastUpdate && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, letterSpacing: '0.06em' }}>
              {t.lastUpdate}: {fmtTime(lastUpdate)}
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── Content ── */}
      {liveGames.length === 0 ? (
        <Box sx={{
          textAlign: 'center',
          py:        '60px',
          border:    `1px solid ${C.border}`,
          bgcolor:   C.surface,
        }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.85rem', letterSpacing: '0.2em', color: C.textMuted, mb: '8px' }}>
            {t.noGames}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textDim }}>
            {t.noGamesDesc}
          </Typography>
        </Box>
      ) : (
        liveGames.map(game => (
          <LiveGameCard
            key={game.gamePk}
            game={game}
            picks={pickProgress}
            lang={lang}
          />
        ))
      )}
    </Box>
  );
}
