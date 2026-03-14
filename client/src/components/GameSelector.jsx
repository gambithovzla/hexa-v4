import { useState, useEffect } from 'react';
import { Box, Checkbox, Skeleton, Typography } from '@mui/material';

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:             '#04080F',
  bgSec:          '#080D1A',
  cardBg:         '#0D1424',
  cardBorder:     '#1A2540',
  selectedBorder: '#0066FF',
  accent:         '#0066FF',
  accentSec:      '#00D4FF',
  accentDim:      'rgba(0,102,255,0.08)',
  accentLine:     'rgba(0,102,255,0.25)',
  textPrimary:    '#E8EDF5',
  textMuted:      '#5A7090',
  scheduledGreen: '#00E676',
  liveOrange:     '#FF9800',
  finalRed:       '#FF3D57',
  scheduledGray:  '#5A7090',
};

const BARLOW = '"Barlow Condensed", system-ui, sans-serif';
const MONO   = '"JetBrains Mono", "Fira Code", "Courier New", monospace';
const LABEL  = '"DM Sans", system-ui, sans-serif';

// ── MLB Team Colors ───────────────────────────────────────────────────────────
const MLB_COLORS = {
  NYY: '#003087', BOS: '#BD3039', LAD: '#005A9C', SF:  '#FD5A1E',
  HOU: '#EB6E1F', ATL: '#CE1141', NYM: '#002D72', CHC: '#0E3386',
  STL: '#C41E3A', PHI: '#E81828', MIA: '#00A3E0', WSH: '#AB0003',
  BAL: '#DF4601', TOR: '#134A8E', TB:  '#092C5C', MIN: '#002B5C',
  CLE: '#E31937', CWS: '#27251F', DET: '#0C2340', KC:  '#004687',
  TEX: '#003278', OAK: '#003831', SEA: '#0C2C56', LAA: '#BA0021',
  ARI: '#A71930', COL: '#333366', SD:  '#2F241D', MIL: '#FFC52F',
  CIN: '#C6011F', PIT: '#FDB827',
};

// SVG noise texture overlay (data URI)
const NOISE_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`;

// ── i18n ─────────────────────────────────────────────────────────────────────
const L = {
  en: {
    title:       'Select a Game',
    noGames:     'No games scheduled for this date.',
    noGamesHint: 'Pick another date to search.',
    selectAll:   'Select All',
    deselectAll: 'Deselect All',
    analyze:     'Analyze Game',
    analyzing:   'Analyzing…',
    selectHint:  'Select a game to continue',
    tbd:         'TBD',
    live:        'LIVE',
    final:       'FINAL',
    scheduled:   'Scheduled',
    legs:        'legs',
    parlayHint:  'Pick 2–6 games for your parlay',
    awaySP:      'Away SP',
    homeSP:      'Home SP',
    vs:          'vs',
    error:       'Failed to load games',
  },
  es: {
    title:       'Seleccionar Juego',
    noGames:     'No hay juegos para esta fecha.',
    noGamesHint: 'Elige otra fecha para buscar.',
    selectAll:   'Seleccionar Todo',
    deselectAll: 'Deseleccionar Todo',
    analyze:     'Analizar Juego',
    analyzing:   'Analizando…',
    selectHint:  'Selecciona un juego para continuar',
    tbd:         'TBD',
    live:        'EN VIVO',
    final:       'FINAL',
    scheduled:   'Programado',
    legs:        'patas',
    parlayHint:  'Elige 2–6 juegos para tu parlay',
    awaySP:      'Lanzador V',
    homeSP:      'Lanzador L',
    vs:          'vs',
    error:       'Error al cargar los juegos',
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function getAbbr(side) {
  return (
    side?.abbreviation ??
    side?.team?.abbreviation ??
    (side?.team?.name ?? '???').slice(0, 3).toUpperCase()
  );
}

function getPitcher(side) {
  return side?.probablePitcher?.fullName ?? null;
}

function getTeamId(side) {
  return side?.team?.id ?? side?.id ?? null;
}

function getScore(game) {
  const away = game.linescore?.teams?.away?.runs;
  const home = game.linescore?.teams?.home?.runs;
  if (away == null || home == null) return null;
  return { away, home };
}

function getTime(game) {
  if (!game.gameDate) return '—';
  return new Date(game.gameDate).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Hybrid status detection: trusts the MLB API first, then falls back to
 * wall-clock time when the API lags (e.g. double-headers, delayed games).
 *
 * Returns: 'scheduled' | 'live' | 'final'
 */
function getStatus(game) {
  // 1. Trust explicit API fields
  const abs      = game.status?.abstractGameState ?? '';
  const detailed = game.status?.detailedState ?? '';
  const coded    = game.status?.codedGameState  ?? '';

  if (
    abs === 'Live' ||
    detailed === 'In Progress' || detailed === 'Warmup' || detailed === 'Manager Challenge' ||
    coded === 'I'
  ) return 'live';

  if (
    abs === 'Final' ||
    detailed === 'Final' || detailed === 'Game Over' ||
    detailed === 'Completed Early' || detailed === 'Postponed' ||
    coded === 'F' || coded === 'O'
  ) return 'final';

  // 2. Time-based fallback for when the API still says 'Preview'/'Scheduled'
  //    but the game has clearly started or ended by the clock
  if (game.gameDate) {
    const gameMs  = new Date(game.gameDate).getTime();
    const nowMs   = Date.now();
    const elapsed = nowMs - gameMs;          // negative = future
    if (elapsed >= 4 * 60 * 60 * 1000) return 'final';  // 4 h+ past start → over
    if (elapsed >= 0)                  return 'live';    // past start, < 4 h → in progress
  }

  return 'scheduled';
}

/** Returns true only for games that haven't started yet */
function isSelectable(game) {
  return getStatus(game) === 'scheduled';
}

// ── TeamLogo ──────────────────────────────────────────────────────────────────
function TeamLogo({ teamId, abbr, color }) {
  const [failed, setFailed] = useState(false);
  if (!teamId || failed) return null;
  return (
    <Box
      component="img"
      src={`https://www.mlb.com/team-logos/${teamId}.svg`}
      alt={abbr}
      onError={() => setFailed(true)}
      sx={{
        width: 52, height: 52, objectFit: 'contain', flexShrink: 0,
        filter: color ? `drop-shadow(0 0 8px ${color}90)` : 'none',
        transition: 'filter 0.2s',
      }}
    />
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────
function StatusBadge({ status, t }) {
  const map = {
    scheduled: { label: t.scheduled, color: C.scheduledGreen, pulse: false },
    live:      { label: t.live,      color: C.liveOrange,     pulse: true  },
    final:     { label: t.final,     color: C.finalRed,       pulse: false },
  };
  const { label, color, pulse } = map[status] ?? map.scheduled;

  return (
    <Box
      component="span"
      sx={{
        display:       'inline-flex',
        alignItems:    'center',
        gap:           '5px',
        px:            '7px',
        py:            '2px',
        borderRadius:  '2px',
        // SCHEDULED: outlined (transparent bg), others: subtle fill
        bgcolor:       status === 'scheduled' ? 'transparent' : `${color}18`,
        border:        `1px solid ${color}${status === 'scheduled' ? '88' : '44'}`,
        fontFamily:    BARLOW,
        fontSize:      '0.62rem',
        fontWeight:    700,
        color,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        flexShrink:    0,
      }}
    >
      {pulse && (
        <Box
          sx={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            bgcolor: color,
            flexShrink: 0,
            '@keyframes hexaPulse': {
              '0%, 100%': { opacity: 1, transform: 'scale(1)' },
              '50%':       { opacity: 0.25, transform: 'scale(0.65)' },
            },
            animation: 'hexaPulse 1.5s ease-in-out infinite',
          }}
        />
      )}
      {label}
    </Box>
  );
}

// ── GameCard ──────────────────────────────────────────────────────────────────
function GameCard({ game, isSelected, onClick, showCheckbox, checkboxDisabled, t }) {
  const away    = getAbbr(game.teams?.away);
  const home    = getAbbr(game.teams?.home);
  const awayId  = getTeamId(game.teams?.away);
  const homeId  = getTeamId(game.teams?.home);
  const awayP   = getPitcher(game.teams?.away) ?? t.tbd;
  const homeP   = getPitcher(game.teams?.home) ?? t.tbd;
  const time    = getTime(game);
  const status  = getStatus(game);
  const score   = getScore(game);

  // Games that have started/ended cannot be selected at all
  const blocked = status !== 'scheduled';

  // Team colors for gradients and logo glows
  const awayColor = MLB_COLORS[away] ?? '#1A3060';
  const homeColor = MLB_COLORS[home] ?? '#1A3060';

  const leftBorderColor = isSelected
    ? C.accentSec
    : status === 'live'
      ? C.liveOrange
      : 'transparent';

  const leftBorderWidth = isSelected ? '4px' : '3px';

  const boxShadow = isSelected
    ? `0 0 20px rgba(0,212,255,0.22), 0 0 40px rgba(0,102,255,0.1), inset 0 0 20px rgba(0,102,255,0.04)`
    : status === 'live'
      ? `0 0 8px rgba(255,152,0,0.15)`
      : 'none';

  // 15% opacity = 26 in hex (38/255)
  const cardBackground = `${NOISE_BG}, linear-gradient(135deg, ${awayColor}26 0%, ${C.cardBg} 40%, ${C.cardBg} 60%, ${homeColor}26 100%)`;

  return (
    <Box
      onClick={blocked ? undefined : onClick}
      sx={{
        position:     'relative',
        background:   cardBackground,
        border:       `1px solid ${isSelected ? C.accentSec + '50' : C.cardBorder}`,
        borderLeft:   `${leftBorderWidth} solid ${leftBorderColor}`,
        borderRadius: '2px',
        p:            '14px',
        cursor:       blocked ? 'not-allowed' : 'pointer',
        opacity:      status === 'final' ? 0.5 : 1,
        transition:   'border-color 0.15s, box-shadow 0.2s, transform 0.15s, opacity 0.15s',
        boxShadow,
        transform:    isSelected ? 'scale(1.01)' : 'none',
        '&:hover': blocked ? {} : {
          transform:  isSelected ? 'scale(1.01)' : 'translateY(-2px) scale(1.005)',
          boxShadow:  isSelected
            ? `0 0 24px rgba(0,212,255,0.3), 0 0 50px rgba(0,102,255,0.15)`
            : `0 6px 24px rgba(0,102,255,0.18), 0 0 0 1px ${awayColor}50`,
          borderColor: isSelected ? C.accentSec + '70' : awayColor + '60',
        },
      }}
    >
      {/* Header row: [STATUS BADGE]  ────  [TIME PILL] [CHECKBOX] */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mb: '12px' }}>
        <StatusBadge status={status} t={t} />
        <Box sx={{ flex: 1 }} />
        <Box
          component="span"
          sx={{
            px:           '8px',
            py:           '2px',
            borderRadius: '100px',
            bgcolor:      'rgba(255,255,255,0.04)',
            border:       `1px solid ${C.cardBorder}`,
            fontFamily:   MONO,
            fontSize:     '0.64rem',
            color:        C.textMuted,
            letterSpacing:'0.04em',
            flexShrink:   0,
          }}
        >
          {time}
        </Box>
        {showCheckbox && (
          <Checkbox
            checked={isSelected}
            disabled={blocked || checkboxDisabled}
            onClick={e => e.stopPropagation()}
            onChange={(blocked || checkboxDisabled) ? undefined : onClick}
            size="small"
            sx={{
              p: '3px',
              color: C.cardBorder,
              '&.Mui-checked': { color: C.accent },
            }}
          />
        )}
      </Box>

      {/* Matchup: [AWAY LOGO] [AWAY ABR]  vs  [HOME ABR] [HOME LOGO] */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          mb: '12px',
        }}
      >
        {/* Away team */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <TeamLogo teamId={awayId} abbr={away} color={awayColor} />
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '1.2rem',
              fontWeight: 700,
              color: C.textPrimary,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            {away}
          </Typography>
        </Box>

        {(status === 'live' || status === 'final') && score != null ? (
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: status === 'live' ? C.liveOrange : C.textPrimary,
              flexShrink: 0,
              letterSpacing: '0.04em',
              ...(status === 'live' ? {
                '@keyframes scorePulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.45 },
                },
                animation: 'scorePulse 2s ease-in-out infinite',
              } : {}),
            }}
          >
            {score.away} – {score.home}
          </Typography>
        ) : (
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.65rem',
              color: C.textMuted,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {t.vs}
          </Typography>
        )}

        {/* Home team */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '1.2rem',
              fontWeight: 700,
              color: C.textPrimary,
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            {home}
          </Typography>
          <TeamLogo teamId={homeId} abbr={home} color={homeColor} />
        </Box>
      </Box>

      {/* Pitchers */}
      <Box
        sx={{
          display: 'flex',
          gap: '10px',
          pt: '10px',
          borderTop: `1px solid ${C.cardBorder}`,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontFamily:    BARLOW,
              fontSize:      '0.6rem',
              color:         C.textMuted,
              fontWeight:    700,
              mb:            '3px',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            {t.awaySP}
          </Typography>
          <Typography
            noWrap
            sx={{
              fontFamily: MONO,
              fontSize: '0.68rem',
              color: C.textMuted,
              fontStyle: 'italic',
            }}
          >
            {awayP}
          </Typography>
        </Box>

        <Box sx={{ width: '1px', bgcolor: C.cardBorder, flexShrink: 0 }} />

        <Box sx={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
          <Typography
            sx={{
              fontFamily:    BARLOW,
              fontSize:      '0.6rem',
              color:         C.textMuted,
              fontWeight:    700,
              mb:            '3px',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            {t.homeSP}
          </Typography>
          <Typography
            noWrap
            sx={{
              fontFamily: MONO,
              fontSize: '0.68rem',
              color: C.textMuted,
              fontStyle: 'italic',
            }}
          >
            {homeP}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

// ── AnalyzeButton ─────────────────────────────────────────────────────────────
function AnalyzeButton({ canAnalyze, analyzing, onClick, t }) {
  const active = canAnalyze && !analyzing;
  return (
    <Box
      component="button"
      onClick={active ? onClick : undefined}
      sx={{
        width:         '100%',
        py:            '13px',
        px:            2,
        mt:            3,
        border:        `1px solid ${active ? C.accentSec + '80' : C.cardBorder}`,
        borderRadius:  '2px',
        background:    active
          ? `linear-gradient(135deg, ${C.accent} 0%, ${C.accentSec} 100%)`
          : C.cardBg,
        color:         active ? '#fff' : C.textMuted,
        fontFamily:    BARLOW,
        fontSize:      '15px',
        fontWeight:    700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        cursor:        active ? 'pointer' : 'not-allowed',
        transition:    'all 0.2s',
        boxShadow:     active
          ? '0 0 30px rgba(0,102,255,0.5), 0 4px 15px rgba(0,0,0,0.3)'
          : 'none',
        '@keyframes analyzeButtonPulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(0,102,255,0)' },
          '50%':      { boxShadow: '0 0 14px rgba(0,102,255,0.18)' },
        },
        animation: !active ? 'analyzeButtonPulse 3s ease-in-out infinite' : 'none',
        '&:hover': active
          ? {
              transform: 'scale(1.01) translateY(-1px)',
              boxShadow: '0 0 40px rgba(0,102,255,0.65), 0 0 20px rgba(0,212,255,0.25), 0 6px 20px rgba(0,0,0,0.35)',
            }
          : {},
      }}
    >
      {analyzing ? t.analyzing : active ? t.analyze : t.selectHint}
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GameSelector({
  // New props
  mode = 'single',
  onSelectGame,
  onSelectMultiple,
  // Backward compat (App.jsx passes these)
  onSelect,
  onAnalyze,
  analyzing = false,
  language = 'en',
}) {
  const t = L[language] ?? L.en;

  const [date, setDate]         = useState(todayStr);
  const [games, setGames]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [fetchErr, setFetchErr] = useState(null);

  // single selection
  const [singleGame, setSingleGame] = useState(null);
  // parlay / fullDay selection
  const [selectedIds, setSelectedIds] = useState(new Set());

  // ── Font injection ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!document.querySelector('link[data-hexa-fonts]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.setAttribute('data-hexa-fonts', '');
      link.href =
        'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@400;600;700&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  // ── Fetch games ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchErr(null);
    setSingleGame(null);
    setSelectedIds(new Set());

    fetch(`/api/games?date=${date}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        const list = json.success ? json.data : [];
        // Debug: log the full MLB API game object so we can inspect all status fields
        if (list.length > 0) {
          console.log('[GameSelector] Sample game object (status fields):', {
            gamePk:        list[0].gamePk,
            gameDate:      list[0].gameDate,
            status:        list[0].status,
            computedStatus: getStatus(list[0]),
          });
        }
        setGames(list);
        // fullDay: auto-select only schedulable games on load
        if (mode === 'fullDay') {
          const selectable = list.filter(isSelectable);
          setSelectedIds(new Set(selectable.map(g => g.gamePk)));
          onSelectMultiple?.(selectable);
        }
      })
      .catch(() => { if (!cancelled) setFetchErr(t.error); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleSingleClick(game) {
    if (!isSelectable(game)) return; // block live/final games
    const next = singleGame?.gamePk === game.gamePk ? null : game;
    setSingleGame(next);
    onSelectGame?.(next);
    onSelect?.(next);
  }

  function handleCheckbox(game) {
    if (!isSelectable(game)) return; // block finished/live games
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(game.gamePk)) {
        next.delete(game.gamePk);
      } else {
        if (mode === 'parlay' && next.size >= 6) return prev; // cap at 6
        next.add(game.gamePk);
      }
      const selected = games.filter(g => next.has(g.gamePk));
      onSelectMultiple?.(selected);
      return next;
    });
  }

  function handleSelectAll() {
    // In fullDay only select games that haven't started
    const targets = mode === 'fullDay' ? games.filter(isSelectable) : games;
    setSelectedIds(new Set(targets.map(g => g.gamePk)));
    onSelectMultiple?.(targets);
  }

  function handleDeselectAll() {
    setSelectedIds(new Set());
    onSelectMultiple?.([]);
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  // single/fullDay: show all games sorted scheduled → live → final.
  // parlay: only selectable (scheduled) games.
  const STATUS_SORT = { scheduled: 0, live: 1, final: 2 };
  const displayGames = mode === 'parlay'
    ? games.filter(isSelectable)
    : [...games].sort((a, b) => STATUS_SORT[getStatus(a)] - STATUS_SORT[getStatus(b)]);

  // "Select All" state only counts selectable games
  const selectableGames = games.filter(isSelectable);
  const isAllSelected   = selectableGames.length > 0 && selectableGames.every(g => selectedIds.has(g.gamePk));

  const canAnalyze =
    (mode === 'single'  && singleGame != null) ||
    (mode === 'parlay'  && selectedIds.size >= 2) ||
    (mode === 'fullDay' && selectedIds.size > 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ bgcolor: C.bg, p: 2, minHeight: '100%' }}>

      {/* ── Header: title + date picker ── */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
          gap: 2,
        }}
      >
        <Typography
          sx={{
            fontFamily:    BARLOW,
            fontSize:      '1.1rem',
            fontWeight:    800,
            color:         C.textPrimary,
            flexShrink:    0,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          {t.title}
        </Typography>

        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{
            background: C.cardBg,
            border: `1px solid ${C.cardBorder}`,
            borderRadius: '2px',
            color: C.textPrimary,
            fontFamily: MONO,
            fontSize: '0.72rem',
            padding: '5px 9px',
            cursor: 'pointer',
            outline: 'none',
            colorScheme: 'dark',
          }}
        />
      </Box>

      {/* ── fullDay controls ── */}
      {mode === 'fullDay' && !loading && games.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Checkbox
            checked={isAllSelected}
            indeterminate={selectedIds.size > 0 && !isAllSelected}
            onChange={isAllSelected ? handleDeselectAll : handleSelectAll}
            size="small"
            sx={{
              p: '2px',
              color: C.cardBorder,
              '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: C.accent },
            }}
          />
          <Typography
            onClick={isAllSelected ? handleDeselectAll : handleSelectAll}
            sx={{
              fontFamily: LABEL,
              fontSize: '0.75rem',
              fontWeight: 600,
              color: C.accent,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            {isAllSelected ? t.deselectAll : t.selectAll}
          </Typography>
        </Box>
      )}

      {/* ── Parlay leg counter ── */}
      {mode === 'parlay' && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 2,
            gap: 1,
          }}
        >
          <Typography
            sx={{ fontFamily: LABEL, fontSize: '0.72rem', color: C.textMuted }}
          >
            {t.parlayHint}
          </Typography>
          <Box
            sx={{
              bgcolor: selectedIds.size >= 2 ? C.accentDim : C.cardBg,
              border: `1px solid ${selectedIds.size >= 2 ? C.accentLine : C.cardBorder}`,
              borderRadius: '2px',
              px: 1.5,
              py: '3px',
              fontFamily: MONO,
              fontSize: '0.72rem',
              fontWeight: 700,
              color: selectedIds.size >= 2 ? C.accent : C.textMuted,
              transition: 'all 0.2s',
              flexShrink: 0,
            }}
          >
            {selectedIds.size} / 6 {t.legs}
          </Box>
        </Box>
      )}

      {/* ── Game grid ── */}
      {loading ? (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            gap: 2,
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={i}
              variant="rectangular"
              height={165}
              sx={{ borderRadius: '2px', bgcolor: C.cardBg, transform: 'none' }}
            />
          ))}
        </Box>
      ) : fetchErr ? (
        <Box sx={{ textAlign: 'center', py: 5 }}>
          <Typography
            sx={{ fontFamily: LABEL, fontSize: '0.875rem', color: C.finalRed }}
          >
            {fetchErr}
          </Typography>
        </Box>
      ) : games.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 7 }}>
          <Typography
            sx={{ fontFamily: LABEL, fontSize: '0.875rem', color: C.textMuted, mb: 1 }}
          >
            {t.noGames}
          </Typography>
          <Typography
            sx={{ fontFamily: LABEL, fontSize: '0.75rem', color: C.scheduledGray }}
          >
            {t.noGamesHint}
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            gap: 2,
          }}
        >
          {displayGames.map(game => {
            const isSelected =
              mode === 'single'
                ? singleGame?.gamePk === game.gamePk
                : selectedIds.has(game.gamePk);
            // GameCard handles live/final blocking internally via getStatus()
            // checkboxDisabled here is only for the parlay 6-game cap
            const checkboxDisabled = mode === 'parlay' && selectedIds.size >= 6 && !isSelected;

            return (
              <GameCard
                key={game.gamePk}
                game={game}
                isSelected={isSelected}
                showCheckbox={mode !== 'single'}
                checkboxDisabled={checkboxDisabled}
                onClick={
                  mode === 'single'
                    ? () => handleSingleClick(game)
                    : () => handleCheckbox(game)
                }
                t={t}
              />
            );
          })}
        </Box>
      )}

      {/* ── Analyze button (single mode, backward compat with App.jsx) ── */}
      {mode === 'single' && onAnalyze && (
        <AnalyzeButton
          canAnalyze={canAnalyze}
          analyzing={analyzing}
          onClick={onAnalyze}
          t={t}
        />
      )}
    </Box>
  );
}
