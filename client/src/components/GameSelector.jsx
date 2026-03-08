import { useState, useEffect } from 'react';
import { Box, Checkbox, Skeleton, Typography } from '@mui/material';

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:             '#0a0e17',
  cardBg:         '#111827',
  cardBorder:     '#1e293b',
  selectedBorder: '#f59e0b',
  accent:         '#f59e0b',
  accentDim:      '#f59e0b22',
  accentLine:     '#f59e0b44',
  textPrimary:    '#f1f5f9',
  textMuted:      '#94a3b8',
  liveGreen:      '#22c55e',
  finalRed:       '#ef4444',
  scheduledGray:  '#64748b',
};

const MONO  = '"JetBrains Mono", "Fira Code", "Courier New", monospace';
const LABEL = '"Outfit", "Inter", system-ui, sans-serif';

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

function getTime(game) {
  if (!game.gameDate) return '—';
  return new Date(game.gameDate).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatus(game) {
  const s = game.status?.abstractGameState ?? '';
  if (s === 'Live') return 'live';
  if (s === 'Final') return 'final';
  return 'scheduled';
}

// ── StatusBadge ───────────────────────────────────────────────────────────────
function StatusBadge({ status, t }) {
  const map = {
    live:      { label: t.live,      color: C.liveGreen,     pulse: true },
    final:     { label: t.final,     color: C.finalRed,      pulse: false },
    scheduled: { label: t.scheduled, color: C.scheduledGray, pulse: false },
  };
  const { label, color, pulse } = map[status] ?? map.scheduled;

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        px: '7px',
        py: '2px',
        borderRadius: '4px',
        bgcolor: `${color}1a`,
        border: `1px solid ${color}44`,
        fontFamily: LABEL,
        fontSize: '0.6rem',
        fontWeight: 700,
        color,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        flexShrink: 0,
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
  const awayP   = getPitcher(game.teams?.away) ?? t.tbd;
  const homeP   = getPitcher(game.teams?.home) ?? t.tbd;
  const time    = getTime(game);
  const status  = getStatus(game);
  const dimmed  = checkboxDisabled && !isSelected;

  return (
    <Box
      onClick={dimmed ? undefined : onClick}
      sx={{
        bgcolor: C.cardBg,
        border: `1.5px solid ${isSelected ? C.selectedBorder : C.cardBorder}`,
        borderRadius: '10px',
        p: '14px',
        cursor: dimmed ? 'not-allowed' : 'pointer',
        opacity: dimmed ? 0.45 : 1,
        transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.12s, opacity 0.15s',
        boxShadow: isSelected
          ? `0 0 0 1px ${C.selectedBorder}50, 0 4px 24px ${C.selectedBorder}18`
          : 'none',
        position: 'relative',
        '&:hover': dimmed ? {} : {
          borderColor: isSelected ? C.selectedBorder : '#2d3f55',
          transform: 'translateY(-2px)',
        },
      }}
    >
      {/* Checkbox */}
      {showCheckbox && (
        <Box sx={{ position: 'absolute', top: 6, right: 6 }}>
          <Checkbox
            checked={isSelected}
            disabled={dimmed}
            onClick={e => e.stopPropagation()}
            onChange={dimmed ? undefined : onClick}
            size="small"
            sx={{
              p: '3px',
              color: C.cardBorder,
              '&.Mui-checked': { color: C.accent },
            }}
          />
        </Box>
      )}

      {/* Status + time */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '10px' }}>
        <StatusBadge status={status} t={t} />
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: '0.68rem',
            color: C.textMuted,
            flexShrink: 0,
            ml: 1,
          }}
        >
          {time}
        </Typography>
      </Box>

      {/* Matchup abbreviations */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          mb: '12px',
        }}
      >
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: '1.4rem',
            fontWeight: 700,
            color: C.textPrimary,
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}
        >
          {away}
        </Typography>
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
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: '1.4rem',
            fontWeight: 700,
            color: C.textPrimary,
            letterSpacing: '-0.02em',
            lineHeight: 1,
          }}
        >
          {home}
        </Typography>
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
              fontFamily: LABEL,
              fontSize: '0.58rem',
              color: C.textMuted,
              fontWeight: 700,
              mb: '3px',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
            }}
          >
            {t.awaySP}
          </Typography>
          <Typography
            noWrap
            sx={{
              fontFamily: MONO,
              fontSize: '0.68rem',
              color: awayP === t.tbd ? C.textMuted : C.textPrimary,
              fontStyle: awayP === t.tbd ? 'italic' : 'normal',
            }}
          >
            {awayP}
          </Typography>
        </Box>

        <Box sx={{ width: '1px', bgcolor: C.cardBorder, flexShrink: 0 }} />

        <Box sx={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.58rem',
              color: C.textMuted,
              fontWeight: 700,
              mb: '3px',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
            }}
          >
            {t.homeSP}
          </Typography>
          <Typography
            noWrap
            sx={{
              fontFamily: MONO,
              fontSize: '0.68rem',
              color: homeP === t.tbd ? C.textMuted : C.textPrimary,
              fontStyle: homeP === t.tbd ? 'italic' : 'normal',
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
        width: '100%',
        py: '11px',
        px: 2,
        mt: 3,
        border: `1px solid ${active ? C.accent : C.cardBorder}`,
        borderRadius: '8px',
        background: active
          ? `linear-gradient(135deg, ${C.accent} 0%, #d97706 100%)`
          : C.cardBg,
        color: active ? '#0a0e17' : C.textMuted,
        fontFamily: LABEL,
        fontSize: '0.875rem',
        fontWeight: 700,
        cursor: active ? 'pointer' : 'not-allowed',
        transition: 'all 0.2s',
        '&:hover': active
          ? { transform: 'translateY(-1px)', boxShadow: `0 4px 16px ${C.accent}44` }
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
        setGames(list);
        // fullDay: auto-select all on load
        if (mode === 'fullDay') {
          const allIds = new Set(list.map(g => g.gamePk));
          setSelectedIds(allIds);
          const all = list;
          onSelectMultiple?.(all);
        }
      })
      .catch(() => { if (!cancelled) setFetchErr(t.error); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleSingleClick(game) {
    const next = singleGame?.gamePk === game.gamePk ? null : game;
    setSingleGame(next);
    onSelectGame?.(next);
    onSelect?.(next);
  }

  function handleCheckbox(game) {
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
    const next = new Set(games.map(g => g.gamePk));
    setSelectedIds(next);
    onSelectMultiple?.(games);
  }

  function handleDeselectAll() {
    setSelectedIds(new Set());
    onSelectMultiple?.([]);
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const isAllSelected = games.length > 0 && games.every(g => selectedIds.has(g.gamePk));
  const canAnalyze =
    (mode === 'single'  && singleGame != null) ||
    (mode === 'parlay'  && selectedIds.size >= 2) ||
    (mode === 'fullDay' && selectedIds.size > 0);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ bgcolor: C.bg, p: 2 }}>

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
            fontFamily: LABEL,
            fontSize: '1rem',
            fontWeight: 700,
            color: C.textPrimary,
            flexShrink: 0,
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
            borderRadius: '6px',
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
              borderRadius: '6px',
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
              sx={{ borderRadius: '10px', bgcolor: C.cardBg, transform: 'none' }}
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
          {games.map(game => {
            const isSelected =
              mode === 'single'
                ? singleGame?.gamePk === game.gamePk
                : selectedIds.has(game.gamePk);
            const checkboxDisabled =
              mode === 'parlay' && selectedIds.size >= 6 && !isSelected;

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
