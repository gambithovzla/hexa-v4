import { useState, useEffect } from 'react';
import { Box, Checkbox, Skeleton, Typography } from '@mui/material';
import { C, BARLOW, MONO, SANS } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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
    selected:    'Selected',
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
    selected:    'Seleccionado',
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
  // MLB "today" shouldn't flip until 5am ET (west coast games end ~1am ET)
  const now = new Date();
  // Subtract 5 hours from ET to create an effective "MLB day" boundary at 5am ET
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  etNow.setHours(etNow.getHours() - 5);
  return etNow.toLocaleDateString('en-CA');
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
  // 0. Trust simplified status from mlb-api.js normalization if present
  if (game.status?.simplified) return game.status.simplified;

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
    if (elapsed >= 5.5 * 60 * 60 * 1000) return 'final'; // 5.5 h+ past start → over (accounts for extras)
    if (elapsed >= 30 * 60 * 1000)        return 'live';  // 30+ min past start, < 5.5 h → in progress
    // < 30 min since start: stay 'scheduled' so the API can update (delays are common)
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
      }}
    />
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────
function StatusBadge({ status, t }) {
  const map = {
    scheduled: { label: t.scheduled, color: C.green, pulse: false },
    live:      { label: t.live,      color: C.amber, pulse: true  },
    final:     { label: t.final,     color: C.red,   pulse: false },
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

  const awayColor = MLB_COLORS[away] ?? '#666';
  const homeColor = MLB_COLORS[home] ?? '#666';

  const leftBorderColor = isSelected ? C.accent : status === 'live' ? C.amber : 'transparent';

  return (
    <Box
      onClick={blocked ? undefined : onClick}
      sx={{
        position:     'relative',
        background:   isSelected ? C.accentDim : C.surface,
        border:       `1px solid ${isSelected ? C.accentLine : C.border}`,
        borderLeft:   `3px solid ${leftBorderColor}`,
        borderRadius: '4px',
        p:            '14px',
        cursor:       blocked ? 'not-allowed' : 'pointer',
        opacity:      status === 'final' ? 0.5 : 1,
        boxShadow:    isSelected ? `0 0 0 1px rgba(255,102,0,0.12), 0 0 20px rgba(255,102,0,0.1)` : 'none',
        transform:    isSelected ? 'translateY(-1px)' : 'none',
        transition:   'border-color 0.15s, opacity 0.15s, box-shadow 0.15s, transform 0.15s',
        '&:hover': blocked ? {} : {
          borderColor: isSelected ? C.accentLine : C.border,
          background:  isSelected ? C.accentDim : C.elevated,
        },
      }}
    >
      {isSelected && (
        <Box
          component="span"
          sx={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            px: '6px',
            py: '2px',
            border: `1px solid ${C.accentLine}`,
            bgcolor: C.accentDim,
            color: C.accent,
            fontFamily: BARLOW,
            fontSize: '0.56rem',
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          {t.selected}
        </Box>
      )}

      {/* Header row: [STATUS BADGE]  ────  [TIME PILL] [CHECKBOX] */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mb: '12px' }}>
        <StatusBadge status={status} t={t} />
        <Box sx={{ flex: 1 }} />
        <Box
          component="span"
          sx={{
            px:           '8px',
            py:           '2px',
            borderRadius: '2px',
            bgcolor:      'transparent',
            border:       `1px solid ${C.border}`,
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
              color: C.border,
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
              color: status === 'live' ? C.amber : C.textPrimary,
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
              fontFamily: SANS,
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
          borderTop: `1px solid ${C.border}`,
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

        <Box sx={{ width: '1px', bgcolor: C.border, flexShrink: 0 }} />

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
        border:        `1px solid ${active ? C.accentLine : C.border}`,
        borderRadius:  '2px',
        background:    active ? C.accent : C.surface,
        color:         active ? '#fff' : C.textMuted,
        fontFamily:    BARLOW,
        fontSize:      '15px',
        fontWeight:    700,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        cursor:        active ? 'pointer' : 'not-allowed',
        transition:    'all 0.15s',
        '&:hover': active
          ? { background: '#fb923c' }
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
  onDateChange,
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

  // ── Notify parent of date changes ────────────────────────────────────────
  useEffect(() => { onDateChange?.(date); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch games ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchErr(null);
    setSingleGame(null);
    setSelectedIds(new Set());
    onSelectGame?.(null);
    onSelect?.(null);
    onSelectMultiple?.([]);

    fetch(`${API_URL}/api/games?date=${date}`)
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
            background: C.surfaceAlt,
            border: `1px solid ${C.border}`,
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
              color: C.border,
              '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: C.accent },
            }}
          />
          <Typography
            onClick={isAllSelected ? handleDeselectAll : handleSelectAll}
            sx={{
              fontFamily: SANS,
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
            sx={{ fontFamily: SANS, fontSize: '0.72rem', color: C.textMuted }}
          >
            {t.parlayHint}
          </Typography>
          <Box
            sx={{
              bgcolor: selectedIds.size >= 2 ? C.accentDim : C.surface,
              border: `1px solid ${selectedIds.size >= 2 ? C.accentLine : C.border}`,
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
              sx={{ borderRadius: '2px', bgcolor: C.surface, transform: 'none' }}
            />
          ))}
        </Box>
      ) : fetchErr ? (
        <Box sx={{ textAlign: 'center', py: 5 }}>
          <Typography
            sx={{ fontFamily: SANS, fontSize: '0.875rem', color: C.red }}
          >
            {fetchErr}
          </Typography>
        </Box>
      ) : games.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 7 }}>
          <Typography
            sx={{ fontFamily: SANS, fontSize: '0.875rem', color: C.textMuted, mb: 1 }}
          >
            {t.noGames}
          </Typography>
          <Typography
            sx={{ fontFamily: SANS, fontSize: '0.75rem', color: C.textMuted }}
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
