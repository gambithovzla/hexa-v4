/**
 * HexaBoardLeague — Pizarra del día rendered in the League × Kinetic brand.
 *
 * Drop-in replacement for HexaBoard when useHexaTheme().brand === 'league-kinetic'.
 * Same backend contract (/api/hexa/board or /api/nba/board), same insights data,
 * different presentation:
 *
 *   [BROADCAST STRIP]   Sistema en línea · Modelo activo · Latencia
 *   [HERO SCOREBOARD]   Big title (left) + stat tiles + Signal Top card (right)
 *   [TICKER]            Animated scrolling insights
 *   [GAMES GRID]        3-col grid of insight cards in broadcast style
 *
 * Uses the brand utility classes from leagueKineticOverrides.css plus the
 * standard MUI `sx` prop with CSS-var tokens, so dark/light still works.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useHexaTheme } from '../themeProvider';
import TeamLogo from './TeamLogo';
import PlayerHeadshot from './PlayerHeadshot';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Copy ────────────────────────────────────────────────────────────────────
const T = {
  en: {
    eyebrow:    'Intelligence · Real-Time',
    title1:     'Daily board',
    title2:     'live read.',
    sub:        (n, s) => `${n} games analyzed · ${s} signals generated`,
    topSignal:  'Top signal · Today',
    pickLine:   'Hexa Oracle · Daily Read',
    scoreboard: 'Scoreboard · Day',
    feedHint:   (n) => `${n} signals · sorted by salience`,
    refresh:    'Refresh',
    refreshing: 'Refreshing…',
    online:     'System online · Deep mode',
    coverage:   'Coverage 100%',
    empty:      'No significant signals yet.',
    emptyHint:  'Data populates as games finish and lineups confirm.',
    error:      'Could not load the board.',
    games:      'Games',
    signals:    'Signals',
    teams:      'Active Teams',
    today:      'Today',
    all:        'All',
    typeLabels: {
      team_streak_hot:      'Team · Hot streak',
      team_streak_cold:     'Team · Cold streak',
      hot_offense:          'Offense · Heating',
      cold_offense:         'Offense · Cooling',
      bullpen_heavy:        'Pitching · Bullpen risk',
      hit_streak:           'Batter · Hit streak',
      cold_batter:          'Batter · Cold bat',
      high_scoring_matchup: 'Matchup · High-scoring',
    },
  },
  es: {
    eyebrow:    'Inteligencia · Tiempo Real',
    title1:     'Lectura',
    title2:     'de jornada.',
    sub:        (n, s) => `${n} juegos analizados · ${s} señales generadas`,
    topSignal:  'Señal top · Hoy',
    pickLine:   'Hexa Oracle · Lectura del día',
    scoreboard: 'Scoreboard · Jornada',
    feedHint:   (n) => `${n} señales · orden por saliencia`,
    refresh:    'Actualizar',
    refreshing: 'Actualizando…',
    online:     'Sistema en línea · Deep',
    coverage:   'Cobertura 100%',
    empty:      'Aún no hay señales relevantes para hoy.',
    emptyHint:  'Los datos llegan al cerrar juegos y confirmar lineups.',
    error:      'No se pudo cargar la pizarra.',
    games:      'Juegos',
    signals:    'Señales',
    teams:      'Equipos activos',
    today:      'Hoy',
    all:        'Todos',
    typeLabels: {
      team_streak_hot:      'Equipo · Racha caliente',
      team_streak_cold:     'Equipo · Racha fría',
      hot_offense:          'Ofensiva · Encendida',
      cold_offense:         'Ofensiva · Fría',
      bullpen_heavy:        'Pitching · Bullpen cargado',
      hit_streak:           'Bateador · Racha de hits',
      cold_batter:          'Bateador · Bate frío',
      high_scoring_matchup: 'Duelo · Alta anotación',
    },
  },
};

// ── Type → intent map (controls livery accent per card) ────────────────────
const TYPE_INTENT = {
  team_streak_hot:      'hit',
  team_streak_cold:     'cold',
  hot_offense:          'hit',
  cold_offense:         'cold',
  bullpen_heavy:        'warn',
  hit_streak:           'elite',
  cold_batter:          'cold',
  high_scoring_matchup: 'live',
};

// Maps intent → CSS variable used for the card border / chip color
const INTENT_ACCENT = {
  hit:   'var(--brand-volt)',
  elite: 'var(--brand-bronze)',
  live:  'var(--brand-lava)',
  warn:  'var(--brand-bronze)',
  cold:  'rgba(244, 236, 216, 0.30)',
};

const INTENT_CHIP = {
  hit:   { en: '⊕ HIT',     es: '⊕ HIT'      },
  elite: { en: '⊕ ELITE',   es: '⊕ ELITE'    },
  live:  { en: '⊕ LIVE',    es: '⊕ EN VIVO'  },
  warn:  { en: '⚠ WARN',    es: '⚠ ALERTA'   },
  cold:  { en: 'COLD',      es: 'FRÍO'       },
};

function minutesAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

const LEAGUE_MEDIA_ACCENT = 'var(--brand-bronze)';

function isPlayerInsight(ins) {
  return ins?.type === 'hit_streak' || ins?.type === 'cold_batter';
}

function pickInsightMedia(ins, size = 36) {
  const m = ins?.meta ?? {};
  if (ins?.type === 'high_scoring_matchup') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <TeamLogo teamId={m.awayId} abbr={m.awayAbbr} size={size} color={LEAGUE_MEDIA_ACCENT} variant="plain" glow={false} />
        <TeamLogo teamId={m.homeId} abbr={m.homeAbbr} size={size} color={LEAGUE_MEDIA_ACCENT} variant="plain" glow={false} />
      </Box>
    );
  }
  if (isPlayerInsight(ins) && m.playerId) {
    return <PlayerHeadshot playerId={m.playerId} name={m.playerName} size={size} color={LEAGUE_MEDIA_ACCENT} />;
  }
  if (m.teamId || m.teamAbbr) {
    return <TeamLogo teamId={m.teamId} abbr={m.teamAbbr} size={size} color={LEAGUE_MEDIA_ACCENT} variant="plain" glow={false} />;
  }
  return null;
}

function tickerPrimary(ins) {
  const m = ins?.meta ?? {};
  if (m.playerName) return m.playerName;
  if (m.teamName) return m.teamName;
  if (m.awayAbbr && m.homeAbbr) return `${m.awayAbbr} @ ${m.homeAbbr}`;
  return m.teamAbbr ?? '';
}

function tickerHook(ins, lang) {
  const txt = (ins.text?.[lang] ?? ins.text?.en ?? '').trim();
  if (!txt) return '';
  const name = ins.meta?.playerName || ins.meta?.teamName;
  let hook = txt;
  if (name && hook.toLowerCase().startsWith(name.toLowerCase())) {
    hook = hook.slice(name.length).replace(/^[\s,·\-–]+/, '').trim();
  }
  const max = 54;
  return hook.length > max ? `${hook.slice(0, max - 1)}…` : hook;
}

// ── Hero scoreboard ─────────────────────────────────────────────────────────
function HeroScoreboard({ t, data, lang }) {
  const totalGames    = data?.totalGames    ?? '—';
  const teamsAnalyzed = data?.teamsAnalyzed ?? '—';
  const insightsCount = data?.insights?.length ?? '—';
  const hero          = data?.insights?.[0] ?? null;
  const heroType      = hero ? (t.typeLabels[hero.type] ?? '—') : '';
  const heroText      = hero ? (hero.text?.[lang] ?? hero.text?.en ?? '') : '';
  const heroIntent    = hero ? (TYPE_INTENT[hero.type] || 'live') : 'live';
  const heroAccent    = INTENT_ACCENT[heroIntent];

  return (
    <Box
      sx={{
        background:    'linear-gradient(180deg, rgba(11,37,64,0) 0%, rgba(11,37,64,.8) 100%), linear-gradient(90deg, var(--brand-navy) 0%, #102E54 100%)',
        border:        '1px solid var(--brand-rule-strong)',
        position:      'relative',
        overflow:      'hidden',
        mb:            '18px',
        '&::before': {
          content: '""', position: 'absolute', inset: 0,
          backgroundImage:
            'linear-gradient(rgba(244,236,216,.04) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(244,236,216,.04) 1px, transparent 1px)',
          backgroundSize: '32px 32px', pointerEvents: 'none',
        },
        '&::after': {
          content: '""', position: 'absolute', right: 0, top: 0, bottom: 0,
          width: '6px', background: heroAccent,
        },
      }}
    >
      {/* Top broadcast strip */}
      <Box
        sx={{
          display:        'flex',
          alignItems:     'center',
          gap:            '14px',
          padding:        '10px 22px',
          borderBottom:   '1px solid var(--brand-rule)',
          fontFamily:     "'JetBrains Mono', monospace",
          fontSize:       '11px',
          letterSpacing:  '0.18em',
          textTransform:  'uppercase',
          background:     'rgba(6,24,39,.4)',
          position:       'relative',
          zIndex:         1,
          color:          'var(--brand-cream)',
          flexWrap:       'wrap',
        }}
      >
        <Box sx={{
          width: 8, height: 8, background: 'var(--brand-volt)',
          borderRadius: '50%', animation: 'brand-pulse 1.4s infinite',
        }} />
        <span>{t.online}</span>
        <span style={{ opacity: 0.3 }}>|</span>
        <span style={{ color: 'var(--brand-cream-2)' }}>{t.coverage}</span>
        <Box sx={{ marginLeft: 'auto', display: { xs: 'none', sm: 'flex' }, gap: '18px', color: 'var(--text-muted)' }}>
          <span>{t.today.toUpperCase()} · {new Date().toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US')}</span>
        </Box>
      </Box>

      {/* Hero body — 2 columns on desktop, stacked on mobile */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.3fr 1fr' },
          gap: 0,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Left — title + stats */}
        <Box sx={{ p: { xs: '24px', md: '36px 32px 28px' } }}>
          <Box sx={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', letterSpacing: '.28em',
            color: heroAccent, textTransform: 'uppercase', mb: '14px',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <Box component="span" sx={{ width: '24px', height: '2px', background: heroAccent }} />
            {t.eyebrow}
          </Box>
          <Typography
            sx={{
              fontFamily: "'Oswald', sans-serif", fontWeight: 700,
              fontSize: { xs: '40px', md: '64px' }, lineHeight: 0.95,
              color: 'var(--brand-cream)', letterSpacing: '-0.01em',
              textTransform: 'uppercase', margin: 0,
            }}
          >
            {t.title1}<br />
            <Box component="em" sx={{ fontStyle: 'italic', color: heroAccent, display: 'inline-block', transform: 'skewX(-3deg)' }}>
              {t.title2}
            </Box>
          </Typography>
          <Typography sx={{
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 500, fontSize: '20px',
            color: 'var(--brand-cream-2)', mt: '14px', maxWidth: '520px', letterSpacing: '.02em',
          }}>
            {t.sub(totalGames, insightsCount)}
          </Typography>

          {/* Stats grid */}
          <Box sx={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            mt: '26px', pt: '18px', borderTop: '1px solid var(--brand-rule)',
          }}>
            {[
              { l: t.games,   v: totalGames    },
              { l: t.signals, v: insightsCount },
              { l: t.teams,   v: teamsAnalyzed },
            ].map((s, i, arr) => (
              <Box key={s.l} sx={{
                display: 'flex', flexDirection: 'column', gap: '4px',
                pr: '20px',
                borderRight: i < arr.length - 1 ? '1px solid var(--brand-rule)' : 'none',
              }}>
                <Box sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9.5px', letterSpacing: '.28em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  {s.l}
                </Box>
                <Box sx={{ fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: '42px', lineHeight: 1, color: 'var(--brand-cream)' }}>
                  {s.v}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Right — signal card */}
        <Box sx={{
          p: { xs: '24px', md: '36px 32px 28px' },
          borderLeft: { xs: 'none', md: '1px solid var(--brand-rule)' },
          borderTop:  { xs: '1px solid var(--brand-rule)', md: 'none' },
          background: 'rgba(6,24,39,.55)', position: 'relative',
        }}>
          <Box
            sx={{
              display:    'inline-block', background: heroAccent,
              color:      heroIntent === 'hit' ? 'var(--brand-ink)' : '#fff',
              fontFamily: "'Oswald', sans-serif", fontWeight: 700,
              fontSize:   '11px', letterSpacing: '.22em', textTransform: 'uppercase',
              padding:    '5px 12px',
              clipPath:   'polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
            }}
          >
            ⊕ {t.topSignal}
          </Box>

          {hero ? (
            <>
              <Box sx={{
                fontFamily: "'Oswald', sans-serif", fontWeight: 700,
                fontSize: '14px', letterSpacing: '.18em', textTransform: 'uppercase',
                mt: '14px', color: 'var(--brand-cream-2)',
              }}>
                {heroType}
              </Box>
              <Box sx={{ mt: '8px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                {pickInsightMedia(hero, 48)}
              </Box>
              <Box sx={{
                mt: '18px', padding: '14px',
                background: 'rgba(0,0,0,.32)', border: '1px solid var(--brand-rule)',
                borderLeft: `3px solid ${heroAccent}`,
                clipPath: 'polygon(0 0, 100% 0, 100% 100%, 10px 100%)',
              }}>
                <Box sx={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: '10px',
                  letterSpacing: '.22em', color: 'var(--text-muted)', textTransform: 'uppercase',
                }}>
                  {t.pickLine}
                </Box>
                <Typography sx={{
                  fontFamily: 'Helvetica Neue, sans-serif', fontSize: '14.5px',
                  color: 'var(--brand-cream)', mt: '6px', lineHeight: 1.5,
                }}>
                  {heroText}
                </Typography>
              </Box>
            </>
          ) : (
            <Typography sx={{
              fontFamily: 'Helvetica Neue, sans-serif', fontSize: '14px',
              color: 'var(--text-muted)', mt: '18px',
            }}>
              {t.empty}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ── Ticker (animated horizontal feed) ──────────────────────────────────────
function BoardTicker({ data, lang }) {
  const insights = data?.insights ?? [];
  if (insights.length === 0) return null;

  const source = insights.slice(1, 12);
  const items = [...source, ...source];

  return (
    <Box className="brand-ticker" sx={{ mb: '18px' }}>
      <Box className="brand-ticker-track">
        {items.map((ins, idx) => {
          const primary = tickerPrimary(ins);
          const hook = tickerHook(ins, lang);
          const media = pickInsightMedia(ins, 22);
          const key = `${ins.type}-${ins.meta?.playerId ?? ins.meta?.teamId ?? ins.meta?.awayAbbr ?? ''}-${idx}`;

          return (
            <Box key={key} component="span" className="ticker-item">
              {media && <span className="ticker-avatar">{media}</span>}
              <span className="ticker-copy">
                {primary && <b className="ticker-name">{primary}</b>}
                {hook && <span className="ticker-hook">{hook}</span>}
              </span>
              <span className="ticker-sep">/</span>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// ── Insight card (1 cell of the 3-col grid) ────────────────────────────────
function InsightCard({ ins, lang, t }) {
  const intent  = TYPE_INTENT[ins.type] || 'cold';
  const accent  = INTENT_ACCENT[intent];
  const chip    = INTENT_CHIP[intent]?.[lang] ?? '';
  const txt     = ins.text?.[lang] ?? ins.text?.en ?? '';
  const typeLbl = t.typeLabels[ins.type] ?? ins.type.toUpperCase();
  const isElite = intent === 'elite';
  const isLive  = intent === 'live';

  return (
    <Box
      sx={{
        background: 'var(--brand-navy)',
        border: `1px solid ${isLive || isElite ? accent : 'var(--brand-rule)'}`,
        borderLeft: `3px solid ${accent}`,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header strip */}
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', background: 'rgba(0,0,0,.35)',
        borderBottom: '1px solid var(--brand-rule)',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '10px',
        letterSpacing: '.18em', textTransform: 'uppercase',
      }}>
        <span style={{ color: 'var(--brand-cream)' }}>{typeLbl}</span>
        {chip && (
          <Box sx={{
            fontFamily: "'Oswald', sans-serif", fontWeight: 700, fontSize: '10px',
            letterSpacing: '.18em', padding: '2px 8px',
            background: intent === 'cold' ? 'transparent' : accent,
            color: intent === 'cold' ? 'var(--text-muted)' : (intent === 'hit' ? 'var(--brand-ink)' : '#fff'),
            border: intent === 'cold' ? '1px solid var(--brand-rule-strong)' : 'none',
          }}>
            {chip}
          </Box>
        )}
      </Box>

      {/* Body */}
      <Box sx={{ p: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
        <Box>{pickInsightMedia(ins, 32)}</Box>
        <Typography sx={{
          fontFamily: 'Helvetica Neue, sans-serif', fontSize: '13.5px',
          color: 'var(--brand-cream)', lineHeight: 1.5,
        }}>
          {txt}
        </Typography>
      </Box>
    </Box>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function HexaBoardLeague({ lang = 'es', sport = 'mlb' }) {
  const isNba    = sport === 'nba';
  const isNfl    = sport === 'nfl';
  const isNhl    = sport === 'nhl';
  const isSoccer = sport === 'soccer';
  const t = T[lang] ?? T.es;
  const { C } = useHexaTheme();

  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBoard = useCallback(async (force = false) => {
    if (isNhl) return;
    if (force) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const boardPath = isNba ? '/api/nba/board'
        : isNfl ? '/api/nfl/board'
        : isSoccer ? '/api/soccer/board'
        : '/api/hexa/board';
      const res = await fetch(`${API_URL}${boardPath}${force ? '?force=1' : ''}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Unknown error');
      setData(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isNba, isNfl, isNhl, isSoccer]);

  useEffect(() => { fetchBoard(false); }, [fetchBoard]);

  const ageMin = data ? minutesAgo(data.lastUpdatedAt) : null;
  const rest   = useMemo(() => data?.insights?.slice(1) ?? [], [data]);

  if (isNhl) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '2rem', fontWeight: 800, color: 'var(--brand-ice, #29b6f6)', letterSpacing: '0.08em', mb: 1 }}>
          NHL
        </Typography>
        <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', color: C.textMuted, mb: 0.5 }}>
          {lang === 'es' ? 'Pizarra NHL llega en una fase posterior' : 'NHL Board ships in a later phase'}
        </Typography>
        <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.72rem', color: C.textMuted, opacity: 0.6 }}>
          {lang === 'es' ? 'Usa la tab JUEGO para analizar partidos NHL.' : 'Use the GAME tab to analyze NHL matchups.'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', width: '100%', px: { xs: '4px', md: 0 } }}>
      <HeroScoreboard t={t} data={data} lang={lang} />
      <BoardTicker data={data} lang={lang} />

      {/* Section head */}
      <Box className="brand-section-head">
        <Box>
          <Box className="title">
            <span className="bar-acc" />{t.scoreboard}
          </Box>
          <Box className="lbl" sx={{ mt: '6px' }}>
            {data ? t.feedHint(rest.length) : '...'}
          </Box>
        </Box>
        <Box sx={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: '11px',
          letterSpacing: '.22em', color: 'var(--text-muted)', textTransform: 'uppercase',
        }}>
          {ageMin != null ? `${t.refresh.toUpperCase()} · ${ageMin}m` : t.refresh.toUpperCase()}
          <Box component="button" onClick={() => fetchBoard(true)} sx={{
            ml: '10px', padding: '4px 10px', background: 'transparent',
            border: '1px solid var(--brand-rule-strong)',
            color: 'var(--brand-cream)', fontFamily: "'Oswald', sans-serif",
            fontWeight: 700, fontSize: '11px', letterSpacing: '.18em',
            textTransform: 'uppercase', cursor: 'pointer',
            opacity: refreshing ? 0.5 : 1,
          }}>
            {refreshing ? t.refreshing : '↻'}
          </Box>
        </Box>
      </Box>

      {/* Loading */}
      {loading && !data && (
        <Box sx={{ p: '32px', border: '1px dashed var(--brand-rule)', textAlign: 'center' }}>
          <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-muted)', letterSpacing: '.18em' }}>
            //{' '}{t.refreshing}
          </Typography>
        </Box>
      )}

      {/* Error */}
      {error && !loading && (
        <Box sx={{
          p: '20px', border: '1px solid var(--brand-lava)',
          background: 'rgba(230,57,70,0.10)', color: 'var(--brand-lava)',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {t.error} — {error}
        </Box>
      )}

      {/* Empty */}
      {!loading && !error && data && rest.length === 0 && (
        <Box sx={{ p: '32px', border: '1px dashed var(--brand-rule)', textAlign: 'center' }}>
          <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '13px', color: 'var(--brand-cream-2)', letterSpacing: '.1em' }}>
            {t.empty}
          </Typography>
          <Typography sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: 'var(--text-muted)', mt: '8px', letterSpacing: '.1em' }}>
            {t.emptyHint}
          </Typography>
        </Box>
      )}

      {/* Grid of remaining insights */}
      {!loading && !error && rest.length > 0 && (
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' },
          gap: '12px',
        }}>
          {rest.map((ins, idx) => (
            <InsightCard key={`${ins.type}-${idx}`} ins={ins} lang={lang} t={t} />
          ))}
        </Box>
      )}

      {/* Status bar footer */}
      <Box className="brand-statusbar">
        <span><b>◉</b> {t.online}</span>
        <span>· {t.coverage}</span>
        {ageMin != null && <span>· {t.refresh}: {ageMin}m</span>}
        <span className="end">HEXAORACLE.LAT · MMXXVI</span>
      </Box>
    </Box>
  );
}
