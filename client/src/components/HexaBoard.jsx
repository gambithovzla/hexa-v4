/**
 * HexaBoard — "Pizarra H.E.X.A. del Día" (Fase 2 — premium redesign).
 *
 * Landing screen. Structure:
 *   [ HERO ]      Top signal of the day, one dominant element.
 *   [ CHIPS ]     Category filters (all / offense / pitching / streaks / matchups).
 *   [ FEED ]      Remaining insights as expandable premium rows.
 *
 * The backend contract (hexaBoardService → /api/hexa/board) is unchanged:
 *
 *   data = {
 *     lastUpdatedAt: ISO string,
 *     cached:        boolean,
 *     totalGames:    number,
 *     teamsAnalyzed: number,
 *     insights: [
 *       {
 *         type: 'team_streak_hot' | 'team_streak_cold' | 'hot_offense' |
 *               'cold_offense'   | 'bullpen_heavy'   | 'hit_streak'   |
 *               'cold_batter'    | 'high_scoring_matchup',
 *         text: { en, es },
 *         icon: string,        // legacy emoji, kept for fallback avatar
 *         meta: { teamId, teamAbbr, playerId, playerName,
 *                 awayId, awayAbbr, homeId, homeAbbr, awayLast3, homeLast3 },
 *       },
 *       ...
 *     ],
 *   }
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { useHexaTheme } from '../themeProvider';
import { staggerContainer } from '../motion';
import { HeroCard, InsightCard, DataChip } from './premium';
import TeamLogo from './TeamLogo';
import PlayerHeadshot from './PlayerHeadshot';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Copy ────────────────────────────────────────────────────────────────────
const T = {
  en: {
    title:       'H.E.X.A. DAILY BOARD',
    subtitle:    'Automatic MLB intelligence · updated throughout the day',
    refresh:     'REFRESH',
    refreshing:  'REFRESHING…',
    loading:     'Computing daily signals…',
    empty:       'No significant signals for today yet.',
    emptyHint:   'Data populates as games finish and lineups are confirmed.',
    error:       'Could not load the board.',
    updated:     'Updated',
    cached:      'cached',
    fresh:       'fresh',
    games:       'games',
    teams:       'teams',
    ago:         (m) => `${m}m ago`,
    topSignal:   'TOP SIGNAL · TODAY',
    seeAll:      'SEE FEED BELOW',
    filters:     {
      all:       'ALL',
      offense:   'OFFENSE',
      pitching:  'PITCHING',
      streaks:   'STREAKS',
      matchups:  'MATCHUPS',
    },
    feedEmpty:   'No signals match this filter.',
    drillTitle:  'SIGNAL DETAIL',
    typeLabels: {
      team_streak_hot:       'TEAM · HOT STREAK',
      team_streak_cold:      'TEAM · COLD STREAK',
      hot_offense:           'OFFENSE · HEATING UP',
      cold_offense:          'OFFENSE · COOLING OFF',
      bullpen_heavy:         'PITCHING · BULLPEN RISK',
      hit_streak:            'BATTER · HIT STREAK',
      cold_batter:           'BATTER · COLD BAT',
      high_scoring_matchup:  'MATCHUP · HIGH-SCORING',
    },
  },
  es: {
    title:       'PIZARRA H.E.X.A. DEL DÍA',
    subtitle:    'Inteligencia MLB automática · se actualiza durante el día',
    refresh:     'ACTUALIZAR',
    refreshing:  'ACTUALIZANDO…',
    loading:     'Calculando señales del día…',
    empty:       'Aún no hay señales relevantes para hoy.',
    emptyHint:   'Los datos se llenan conforme terminan los juegos y se confirman los lineups.',
    error:       'No se pudo cargar la pizarra.',
    updated:     'Actualizado',
    cached:      'caché',
    fresh:       'nuevo',
    games:       'juegos',
    teams:       'equipos',
    ago:         (m) => `hace ${m}m`,
    topSignal:   'SEÑAL TOP · HOY',
    seeAll:      'VER FEED ABAJO',
    filters:     {
      all:       'TODO',
      offense:   'OFENSIVA',
      pitching:  'PITCHING',
      streaks:   'RACHAS',
      matchups:  'DUELOS',
    },
    feedEmpty:   'No hay señales para este filtro.',
    drillTitle:  'DETALLE DE LA SEÑAL',
    typeLabels: {
      team_streak_hot:       'EQUIPO · RACHA CALIENTE',
      team_streak_cold:      'EQUIPO · RACHA FRÍA',
      hot_offense:           'OFENSIVA · ENCENDIDA',
      cold_offense:          'OFENSIVA · FRÍA',
      bullpen_heavy:         'PITCHING · BULLPEN CARGADO',
      hit_streak:            'BATEADOR · RACHA DE HITS',
      cold_batter:           'BATEADOR · BATE FRÍO',
      high_scoring_matchup:  'DUELO · ALTA ANOTACIÓN',
    },
  },
};

// ── Type → intent / category maps ───────────────────────────────────────────
// Kept here so the HexaBoard is the single place that interprets the backend's
// `type` values. If new types appear, add them in one place.

const TYPE_INTENT = {
  team_streak_hot:       'action',
  team_streak_cold:      'data',
  hot_offense:           'action',
  cold_offense:          'data',
  bullpen_heavy:         'warn',
  hit_streak:            'success',
  cold_batter:           'data',
  high_scoring_matchup:  'action',
};

const CATEGORIES = ['all', 'offense', 'pitching', 'streaks', 'matchups'];

const TYPE_CATEGORY = {
  hot_offense:           'offense',
  cold_offense:          'offense',
  hit_streak:            'offense',
  cold_batter:           'offense',
  bullpen_heavy:         'pitching',
  team_streak_hot:       'streaks',
  team_streak_cold:      'streaks',
  high_scoring_matchup:  'matchups',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function minutesAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

function isPlayerInsight(insight) {
  return insight?.type === 'hit_streak' || insight?.type === 'cold_batter';
}

// Picks the avatar node for an insight — used as InsightCard's `icon` slot
// or HeroCard's `media` slot.
function InsightMedia({ insight, size = 40, tone }) {
  const m = insight?.meta ?? {};
  const color = tone?.base;

  if (insight?.type === 'high_scoring_matchup') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <TeamLogo teamId={m.awayId} abbr={m.awayAbbr} size={size} color={color} />
        <TeamLogo teamId={m.homeId} abbr={m.homeAbbr} size={size} color={color} />
      </Box>
    );
  }
  if (isPlayerInsight(insight) && m.playerId) {
    return <PlayerHeadshot playerId={m.playerId} name={m.playerName} size={size + 4} color={color} />;
  }
  if (m.teamId || m.teamAbbr) {
    return <TeamLogo teamId={m.teamId} abbr={m.teamAbbr} size={size} color={color} />;
  }
  // Fallback — legacy emoji glyph served by the backend
  return (
    <Box
      sx={{
        width:          size,
        height:         size,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        fontSize:       '1.4rem',
        lineHeight:     1,
        flexShrink:     0,
      }}
    >
      {insight?.icon ?? '•'}
    </Box>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function BrandHero() {
  const { C, SPACE } = useHexaTheme();
  return (
    <Box
      sx={{
        mb:           SPACE.lg,
        border:       `1px solid ${C.cyanLine}`,
        borderLeft:   `3px solid ${C.cyan}`,
        bgcolor:      'rgba(0,0,0,0.35)',
        position:     'relative',
        overflow:     'hidden',
        lineHeight:   0,
      }}
    >
      <Box
        component="img"
        src="/banner%20hexa%20principal.png"
        alt="H.E.X.A. — Hybrid Expert X-Analysis"
        sx={{
          width:         '100%',
          height:        'auto',
          display:       'block',
          userSelect:    'none',
          pointerEvents: 'none',
        }}
      />
    </Box>
  );
}

function BoardHeader({ t, data, ageMin, refreshing, loading, onRefresh }) {
  const { C, MONO, DISPLAY, SCALE, SPACE } = useHexaTheme();

  return (
    <Box
      sx={{
        display:        'flex',
        alignItems:     { xs: 'flex-start', sm: 'flex-end' },
        justifyContent: 'space-between',
        mb:             SPACE.lg,
        flexWrap:       'wrap',
        gap:            SPACE.md,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontFamily:    DISPLAY,
            fontWeight:    800,
            letterSpacing: '0.24em',
            fontSize:      { xs: '1.15rem', sm: '1.5rem' },
            color:         C.accent,
            textShadow:    C.accentGlow,
          }}
        >
          {t.title}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: C.textMuted, letterSpacing: '0.14em', mt: '4px' }}>
          {t.subtitle}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
        {data && (
          <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: C.textMuted, letterSpacing: '0.08em' }}>
            {t.updated}: {ageMin != null ? t.ago(ageMin) : '—'} · {data.cached ? t.cached : t.fresh}
            {data.totalGames   != null && ` · ${data.totalGames} ${t.games}`}
            {data.teamsAnalyzed != null && ` · ${data.teamsAnalyzed} ${t.teams}`}
          </Typography>
        )}
        <Box
          component="button"
          onClick={onRefresh}
          disabled={refreshing || loading}
          sx={{
            px:            SPACE.md,
            py:            '6px',
            border:        `1px solid ${C.cyanLine}`,
            bgcolor:       C.cyanDim,
            color:         C.cyan,
            fontFamily:    MONO,
            fontSize:      SCALE.micro,
            fontWeight:    700,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            cursor:        (refreshing || loading) ? 'default' : 'pointer',
            opacity:       (refreshing || loading) ? 0.5 : 1,
            transition:    'all 0.2s',
            '&:hover':     { borderColor: C.cyan, boxShadow: C.cyanGlow, color: C.textPrimary },
          }}
        >
          {refreshing ? t.refreshing : t.refresh}
        </Box>
      </Box>
    </Box>
  );
}

function LoadingSkeleton({ t }) {
  const { C, MONO, SCALE, SPACE, INTENT } = useHexaTheme();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
      {/* Hero-shaped skeleton */}
      <Box
        sx={{
          minHeight:    { xs: '32vh', md: '36vh' },
          bgcolor:      C.surface,
          border:       `1px solid ${C.border}`,
          borderLeft:   `3px solid ${INTENT.action.base}`,
          '@keyframes hxShimmer': { '0%, 100%': { opacity: 0.55 }, '50%': { opacity: 0.9 } },
          animation:    'hxShimmer 1.6s ease-in-out infinite',
        }}
      />
      {/* Row skeletons */}
      {Array.from({ length: 5 }).map((_, i) => (
        <Box
          key={i}
          sx={{
            height:     54,
            bgcolor:    C.surface,
            border:     `1px solid ${C.border}`,
            borderLeft: `3px solid ${C.textGhost}`,
            '@keyframes hxShimmer2': { '0%, 100%': { opacity: 0.55 }, '50%': { opacity: 0.9 } },
            animation:  `hxShimmer2 1.4s ease-in-out infinite`,
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
      <Typography sx={{ fontFamily: MONO, fontSize: SCALE.label, color: C.textMuted, textAlign: 'center', mt: SPACE.sm }}>
        {t.loading}
      </Typography>
    </Box>
  );
}

function FilterChips({ lang, t, active, counts, onChange }) {
  const { SPACE } = useHexaTheme();
  return (
    <Box
      sx={{
        display:     'flex',
        gap:         SPACE.sm,
        overflowX:   'auto',
        pb:          SPACE.sm,
        mb:          SPACE.lg,
        '&::-webkit-scrollbar': { height: 3 },
      }}
    >
      {CATEGORIES.map((cat) => {
        const count = counts[cat] ?? 0;
        const disabled = cat !== 'all' && count === 0;
        if (disabled) return null;
        return (
          <DataChip
            key={cat}
            variant="filter"
            intent={cat === 'matchups' ? 'action' : cat === 'pitching' ? 'warn' : cat === 'offense' ? 'success' : 'data'}
            value={`${t.filters[cat]} · ${count}`}
            active={active === cat}
            onClick={() => onChange(cat)}
          />
        );
      })}
    </Box>
  );
}

function InsightDrillDown({ insight, lang, t }) {
  const { C, MONO, SCALE, SPACE, INTENT } = useHexaTheme();
  const tone = INTENT[TYPE_INTENT[insight.type]] ?? INTENT.data;
  const text = insight.text?.[lang] ?? insight.text?.en ?? '';
  const meta = insight.meta ?? {};

  // Render meta as small stat chips — only include fields we know about.
  const metaRows = [];
  if (meta.playerName)  metaRows.push({ label: lang === 'es' ? 'JUGADOR' : 'PLAYER',  value: meta.playerName });
  if (meta.teamAbbr)    metaRows.push({ label: lang === 'es' ? 'EQUIPO'  : 'TEAM',    value: meta.teamAbbr });
  if (meta.awayAbbr && meta.homeAbbr) metaRows.push({ label: lang === 'es' ? 'DUELO' : 'MATCHUP', value: `${meta.awayAbbr} @ ${meta.homeAbbr}` });
  if (meta.awayLast3 != null && meta.homeLast3 != null) {
    metaRows.push({ label: lang === 'es' ? 'CARR. 3J' : 'R · LAST 3', value: `${meta.awayLast3} / ${meta.homeLast3}` });
  }

  return (
    <Box>
      <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: tone.base, letterSpacing: '0.22em', fontWeight: 700, textTransform: 'uppercase', mb: SPACE.sm }}>
        {t.drillTitle}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: SCALE.body, color: C.textSecondary, lineHeight: 1.6 }}>
        {text}
      </Typography>
      {metaRows.length > 0 && (
        <Box sx={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap', mt: SPACE.md }}>
          {metaRows.map((row, i) => (
            <DataChip key={i} variant="stat" intent="data" label={row.label} value={row.value} />
          ))}
        </Box>
      )}
    </Box>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function HexaBoard({ lang = 'es' }) {
  const t = T[lang] ?? T.es;
  const { C, MONO, SCALE, SPACE, INTENT } = useHexaTheme();

  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeCat,  setActiveCat]  = useState('all');
  const [expandedKey, setExpandedKey] = useState(null);

  const fetchBoard = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/hexa/board${force ? '?force=1' : ''}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Unknown error');
      setData(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchBoard(false); }, [fetchBoard]);

  const ageMin = data ? minutesAgo(data.lastUpdatedAt) : null;

  // Hero = first insight (backend orders them by salience).
  // Feed  = everything after the hero, filtered by the active category.
  const hero = data?.insights?.[0] ?? null;
  const rest = useMemo(() => data?.insights?.slice(1) ?? [], [data]);

  const filteredFeed = useMemo(() => {
    if (activeCat === 'all') return rest;
    return rest.filter((ins) => TYPE_CATEGORY[ins.type] === activeCat);
  }, [rest, activeCat]);

  // Count per category — used on the filter chips so the user can see what's
  // worth clicking before they click.
  const counts = useMemo(() => {
    const out = { all: rest.length };
    CATEGORIES.forEach((c) => { if (c !== 'all') out[c] = 0; });
    rest.forEach((ins) => {
      const cat = TYPE_CATEGORY[ins.type];
      if (cat) out[cat] = (out[cat] ?? 0) + 1;
    });
    return out;
  }, [rest]);

  const heroTone = hero ? INTENT[TYPE_INTENT[hero.type]] ?? INTENT.action : INTENT.action;
  const heroText = hero ? (hero.text?.[lang] ?? hero.text?.en ?? '') : '';

  return (
    <Box sx={{ maxWidth: 1040, mx: 'auto', width: '100%' }}>
      <BrandHero />
      <BoardHeader
        t={t}
        data={data}
        ageMin={ageMin}
        refreshing={refreshing}
        loading={loading}
        onRefresh={() => fetchBoard(true)}
      />

      {/* Loading (first load only) */}
      {loading && !data && <LoadingSkeleton t={t} />}

      {/* Error */}
      {error && !loading && (
        <Box
          sx={{
            p:       SPACE.lg,
            border:  `1px solid ${C.redLine}`,
            bgcolor: C.redDim,
            color:   C.red,
            fontFamily: MONO,
            fontSize: SCALE.body,
          }}
        >
          {t.error} — {error}
        </Box>
      )}

      {/* Empty (successful fetch, no insights) */}
      {!loading && !error && data && (!data.insights || data.insights.length === 0) && (
        <Box sx={{ p: SPACE.lg, border: `1px dashed ${C.border}`, textAlign: 'center', position: 'relative', overflow: 'hidden', minHeight: 180 }}>
          <Box
            component="img"
            src="/hexa-mascot-ghost.png"
            alt=""
            aria-hidden="true"
            sx={{
              position:      'absolute',
              bottom:        '-10px',
              right:         '16px',
              height:        140,
              width:         'auto',
              opacity:       0.1,
              pointerEvents: 'none',
              userSelect:    'none',
            }}
          />
          <Typography sx={{ fontFamily: MONO, fontSize: SCALE.body, color: C.textSecondary, letterSpacing: '0.1em' }}>
            {t.empty}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: C.textMuted, mt: SPACE.sm, letterSpacing: '0.1em' }}>
            {t.emptyHint}
          </Typography>
        </Box>
      )}

      {/* Populated state */}
      {!loading && !error && hero && (
        <>
          {/* ── 1 · Hero ───────────────────────────────────────────────── */}
          <Box sx={{ mb: SPACE.lg }}>
            <HeroCard
              intent={TYPE_INTENT[hero.type] || 'action'}
              eyebrow={t.topSignal}
              title={heroText}
              subtitle={t.typeLabels[hero.type]}
              meta={ageMin != null ? t.ago(ageMin).toUpperCase() : undefined}
              media={<InsightMedia insight={hero} size={56} tone={heroTone} />}
              cta={rest.length > 0 ? { label: t.seeAll, onClick: () => {
                // Scroll the feed section into view
                const el = document.getElementById('hexa-feed');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }} : undefined}
            />
          </Box>

          {/* ── 2 · Category filters ──────────────────────────────────── */}
          {rest.length > 0 && (
            <FilterChips
              lang={lang}
              t={t}
              active={activeCat}
              counts={counts}
              onChange={setActiveCat}
            />
          )}

          {/* ── 3 · Feed ──────────────────────────────────────────────── */}
          <Box id="hexa-feed">
            {filteredFeed.length === 0 ? (
              <Box sx={{ p: SPACE.lg, border: `1px dashed ${C.border}`, textAlign: 'center' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: SCALE.body, color: C.textSecondary, letterSpacing: '0.1em' }}>
                  {t.feedEmpty}
                </Typography>
              </Box>
            ) : (
              <motion.div
                variants={staggerContainer(0.03)}
                initial="hidden"
                animate="visible"
                style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
              >
                {filteredFeed.map((insight, i) => {
                  const key    = `${insight.type}-${i}`;
                  const intent = TYPE_INTENT[insight.type] || 'data';
                  const tone   = INTENT[intent] ?? INTENT.data;
                  const text   = insight.text?.[lang] ?? insight.text?.en ?? '';
                  return (
                    <InsightCard
                      key={key}
                      intent={intent}
                      icon={<InsightMedia insight={insight} size={40} tone={tone} />}
                      label={t.typeLabels[insight.type]}
                      title={text}
                      expanded={expandedKey === key}
                      onToggle={(open) => setExpandedKey(open ? key : null)}
                    >
                      <InsightDrillDown insight={insight} lang={lang} t={t} />
                    </InsightCard>
                  );
                })}
              </motion.div>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
