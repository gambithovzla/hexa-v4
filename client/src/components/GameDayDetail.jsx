import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import { C, BARLOW, MONO } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const POLL_INTERVAL = 30_000;

const COPY = {
  en: {
    title: 'GAMEDAY DETAIL',
    subtitle: 'Game timeline, score context, and play filters without leaving Hexa.',
    selectGame: 'Select game',
    playByPlay: 'Play by play',
    all: 'All',
    scoring: 'Scoring',
    hits: 'Hits',
    outs: 'Outs',
    oldest: 'Start',
    newest: 'Latest',
    noGames: 'No games found for this date.',
    noGameSelected: 'Select a game to view the full timeline.',
    noPlays: 'No completed plays are available yet.',
    loading: 'Loading gameday feed',
    final: 'Final',
    live: 'Live',
    scheduled: 'Scheduled',
    runs: 'R',
    hitsShort: 'H',
    errors: 'E',
    totalPlays: 'Plays',
    scoringPlays: 'Scoring',
    homeRuns: 'HR',
    strikeouts: 'K',
    count: 'Count',
    outsAfter: 'outs',
    source: 'MLB Gameday feed',
    refresh: 'Refresh',
    viewHighlight: 'View official highlights',
    boxscoreTitle: 'Final box score',
    boxscoreSubtitle: 'Player-level batting and pitching lines',
    boxscoreLive: 'Live box score',
    boxscoreCollapse: 'Hide',
    boxscoreExpand: 'Show',
    batting: 'Batting',
    pitching: 'Pitching',
    player: 'Player',
    noBattingData: 'No batting data yet.',
    noPitchingData: 'No pitching data yet.',
    bat: { ab: 'AB', r: 'R', h: 'H', bb: 'BB', rbi: 'RBI', hr: 'HR' },
    pit: { ip: 'IP', h: 'H', er: 'ER', bb: 'BB', k: 'K' },
  },
  es: {
    title: 'DETALLE GAMEDAY',
    subtitle: 'Linea del juego, contexto del marcador y filtros sin salir de Hexa.',
    selectGame: 'Seleccionar juego',
    playByPlay: 'Jugada por jugada',
    all: 'Todo',
    scoring: 'Anotaciones',
    hits: 'Hits',
    outs: 'Outs',
    oldest: 'Inicio',
    newest: 'Reciente',
    noGames: 'No hay juegos para esta fecha.',
    noGameSelected: 'Selecciona un juego para ver la linea completa.',
    noPlays: 'Todavia no hay jugadas completas disponibles.',
    loading: 'Cargando feed del juego',
    final: 'Final',
    live: 'En vivo',
    scheduled: 'Programado',
    runs: 'C',
    hitsShort: 'H',
    errors: 'E',
    totalPlays: 'Jugadas',
    scoringPlays: 'Carreras',
    homeRuns: 'HR',
    strikeouts: 'K',
    count: 'Conteo',
    outsAfter: 'outs',
    source: 'Feed Gameday MLB',
    refresh: 'Actualizar',
    viewHighlight: 'Ver highlights oficiales',
    boxscoreTitle: 'Resumen final',
    boxscoreSubtitle: 'Estadisticas individuales de bateo y pitcheo',
    boxscoreLive: 'Resumen en vivo',
    boxscoreCollapse: 'Ocultar',
    boxscoreExpand: 'Ver',
    batting: 'Bateo',
    pitching: 'Pitcheo',
    player: 'Jugador',
    noBattingData: 'Aun no hay estadisticas de bateo.',
    noPitchingData: 'Aun no hay estadisticas de pitcheo.',
    bat: { ab: 'AB', r: 'C', h: 'H', bb: 'BB', rbi: 'CP', hr: 'J' },
    pit: { ip: 'IP', h: 'H', er: 'CL', bb: 'BB', k: 'P' },
  },
};

function todayStr() {
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  etNow.setHours(etNow.getHours() - 5);
  return etNow.toLocaleDateString('en-CA');
}

function statusOf(game) {
  const simplified = game?.status?.simplified;
  if (simplified) return simplified;
  const description = String(game?.status?.description ?? '').toLowerCase();
  if (description.includes('final')) return 'final';
  if (description.includes('progress') || description.includes('warmup')) return 'live';
  return 'scheduled';
}

function teamAbbr(side) {
  return side?.abbreviation ?? side?.team?.abbreviation ?? '---';
}

function teamId(side) {
  return side?.id ?? side?.team?.id ?? null;
}

function gameScore(game) {
  const away = game?.teams?.away?.score ?? game?.linescore?.teams?.away?.runs;
  const home = game?.teams?.home?.score ?? game?.linescore?.teams?.home?.runs;
  if (away == null || home == null) return null;
  return { away, home };
}

function teamLogoUrl(id) {
  return id ? `https://www.mlbstatic.com/team-logos/${id}.svg` : null;
}

function playerHeadshotUrl(id) {
  return id
    ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${id}/headshot/67/current`
    : null;
}

function StatusBadge({ status, t }) {
  const color = status === 'live' ? C.amber : status === 'final' ? C.green : C.textMuted;
  const label = status === 'live' ? t.live : status === 'final' ? t.final : t.scheduled;

  return (
    <Box
      component="span"
      sx={{
        px: '7px',
        py: '2px',
        border: `1px solid ${color}55`,
        borderRadius: '2px',
        color,
        fontFamily: BARLOW,
        fontSize: '0.58rem',
        letterSpacing: 0,
        textTransform: 'uppercase',
        bgcolor: status === 'scheduled' ? 'transparent' : `${color}14`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Box>
  );
}

function TeamLogo({ id, alt, size = 24 }) {
  const [failed, setFailed] = useState(false);
  const src = teamLogoUrl(id);
  if (!src || failed) return null;
  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      sx={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

function GameListItem({ game, selected, onClick, t }) {
  const away = game?.teams?.away ?? {};
  const home = game?.teams?.home ?? {};
  const awayAbbr = teamAbbr(away);
  const homeAbbr = teamAbbr(home);
  const status = statusOf(game);
  const score = gameScore(game);

  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        width: '100%',
        display: 'block',
        textAlign: 'left',
        p: '12px',
        border: `1px solid ${selected ? C.cyanLine : C.border}`,
        borderLeft: `3px solid ${selected ? C.cyan : status === 'live' ? C.amber : 'transparent'}`,
        borderRadius: '4px',
        bgcolor: selected ? C.cyanDim : C.surface,
        color: C.textPrimary,
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        '&:hover': {
          bgcolor: selected ? C.cyanDim : C.elevated,
          borderColor: selected ? C.cyanLine : C.border,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', mb: '9px' }}>
        <StatusBadge status={status} t={t} />
        <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.6rem', letterSpacing: 0 }}>
          {game?.gameDate ? new Date(game.gameDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <TeamLogo id={teamId(away)} alt={awayAbbr} size={26} />
        <Typography sx={{ fontFamily: MONO, color: C.textPrimary, fontSize: '0.95rem', fontWeight: 700, letterSpacing: 0 }}>
          {awayAbbr}
        </Typography>
        <Typography sx={{ fontFamily: MONO, color: score ? C.textPrimary : C.textMuted, fontSize: '0.9rem', fontWeight: 700, letterSpacing: 0 }}>
          {score ? `${score.away}-${score.home}` : 'vs'}
        </Typography>
        <Typography sx={{ fontFamily: MONO, color: C.textPrimary, fontSize: '0.95rem', fontWeight: 700, letterSpacing: 0 }}>
          {homeAbbr}
        </Typography>
        <TeamLogo id={teamId(home)} alt={homeAbbr} size={26} />
      </Box>
    </Box>
  );
}

function SummaryChip({ label, value, tone = C.cyan }) {
  return (
    <Box
      sx={{
        minWidth: 76,
        px: '10px',
        py: '7px',
        border: `1px solid ${tone}44`,
        borderRadius: '4px',
        bgcolor: `${tone}10`,
      }}
    >
      <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.55rem', letterSpacing: 0, textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, color: tone, fontSize: '0.95rem', fontWeight: 700, letterSpacing: 0 }}>
        {value ?? 0}
      </Typography>
    </Box>
  );
}

function GameSummary({ data, t }) {
  if (!data) return null;

  const rows = [
    { team: data.away, label: data.away?.abbreviation ?? 'AWY' },
    { team: data.home, label: data.home?.abbreviation ?? 'HOM' },
  ];

  return (
    <Box sx={{ border: `1px solid ${C.border}`, borderRadius: '4px', bgcolor: C.surface, p: '14px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap', mb: '14px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <TeamLogo id={data.away?.id} alt={data.away?.abbreviation} size={30} />
          <Typography sx={{ fontFamily: BARLOW, color: C.textPrimary, fontSize: '1rem', fontWeight: 800, letterSpacing: 0 }}>
            {data.away?.abbreviation} {data.away?.score} - {data.home?.score} {data.home?.abbreviation}
          </Typography>
          <TeamLogo id={data.home?.id} alt={data.home?.abbreviation} size={30} />
        </Box>
        <StatusBadge status={data.status} t={t} />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 44px 44px 44px', gap: '6px', mb: '14px' }}>
        <Box />
        {[t.runs, t.hitsShort, t.errors].map(label => (
          <Typography key={label} sx={{ fontFamily: MONO, color: C.textMuted, textAlign: 'center', fontSize: '0.58rem', letterSpacing: 0 }}>
            {label}
          </Typography>
        ))}
        {rows.map(row => (
          <Box key={row.label} sx={{ display: 'contents' }}>
            <Typography sx={{ fontFamily: MONO, color: C.textSecondary, fontSize: '0.68rem', letterSpacing: 0 }}>
              {row.label}
            </Typography>
            <Typography sx={{ fontFamily: MONO, color: C.accent, textAlign: 'center', fontSize: '0.72rem', fontWeight: 700, letterSpacing: 0 }}>
              {row.team?.score ?? 0}
            </Typography>
            <Typography sx={{ fontFamily: MONO, color: C.textPrimary, textAlign: 'center', fontSize: '0.72rem', letterSpacing: 0 }}>
              {row.team?.hits ?? 0}
            </Typography>
            <Typography sx={{ fontFamily: MONO, color: C.textMuted, textAlign: 'center', fontSize: '0.72rem', letterSpacing: 0 }}>
              {row.team?.errors ?? 0}
            </Typography>
          </Box>
        ))}
      </Box>

      <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <SummaryChip label={t.totalPlays} value={data.summary?.totalPlays} />
        <SummaryChip label={t.scoringPlays} value={data.summary?.scoringPlays} tone={C.green} />
        <SummaryChip label={t.hitsShort} value={data.summary?.hits} tone={C.accent} />
        <SummaryChip label={t.homeRuns} value={data.summary?.homeRuns} tone={C.amber} />
        <SummaryChip label={t.strikeouts} value={data.summary?.strikeouts} tone={C.red} />
      </Box>
    </Box>
  );
}

function FilterButton({ active, children, onClick }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        px: '10px',
        py: '7px',
        border: `1px solid ${active ? C.cyanLine : C.border}`,
        borderRadius: '4px',
        bgcolor: active ? C.cyanDim : 'transparent',
        color: active ? C.cyan : C.textMuted,
        fontFamily: MONO,
        fontSize: '0.62rem',
        letterSpacing: 0,
        textTransform: 'uppercase',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        '&:hover': { color: active ? C.cyan : C.textSecondary, bgcolor: active ? C.cyanDim : C.borderLight },
      }}
    >
      {children}
    </Box>
  );
}

function PlayRow({ play, lang, t }) {
  const [imgFailed, setImgFailed] = useState(false);
  const eventLabel = play?.eventLabel?.[lang] ?? play?.event ?? 'Play';
  const image = playerHeadshotUrl(play?.batter?.id);
  const tone = play.isScoring ? C.green : play.hasHit ? C.accent : play.isOut ? C.red : C.cyan;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '42px 1fr', sm: '54px 1fr auto' },
        gap: '12px',
        alignItems: 'start',
        py: '12px',
        borderBottom: `1px solid ${C.borderLight}`,
      }}
    >
      <Box sx={{ width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', border: `1px solid ${tone}66`, bgcolor: C.surfaceAlt }}>
        {image && !imgFailed ? (
          <Box
            component="img"
            src={image}
            alt={play?.batter?.name ?? ''}
            onError={() => setImgFailed(true)}
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
            <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.7rem', letterSpacing: 0 }}>
              {String(play?.batter?.name ?? '?').slice(0, 1)}
            </Typography>
          </Box>
        )}
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', mb: '6px' }}>
          <Box
            component="span"
            sx={{
              px: '8px',
              py: '2px',
              border: `1px solid ${tone}66`,
              borderRadius: '999px',
              color: tone,
              bgcolor: `${tone}10`,
              fontFamily: BARLOW,
              fontSize: '0.62rem',
              fontWeight: 800,
              letterSpacing: 0,
              textTransform: 'uppercase',
            }}
          >
            {eventLabel}
          </Box>
          <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.58rem', letterSpacing: 0 }}>
            {play?.batter?.name}
          </Typography>
        </Box>

        <Typography sx={{ fontFamily: MONO, color: C.textPrimary, fontSize: '0.75rem', lineHeight: 1.55, letterSpacing: 0 }}>
          {play?.description || `${play?.batter?.name ?? ''} - ${eventLabel}`}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', mt: '7px' }}>
          <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.58rem', letterSpacing: 0 }}>
            {t.count}: {play?.count?.balls ?? 0}-{play?.count?.strikes ?? 0}
          </Typography>
          <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.58rem', letterSpacing: 0 }}>
            {play?.count?.outs ?? 0} {t.outsAfter}
          </Typography>
          {play?.pitchCount > 0 && (
            <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.58rem', letterSpacing: 0 }}>
              {play.pitchCount} pitches
            </Typography>
          )}
        </Box>
      </Box>

      <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'right', minWidth: 70 }}>
        <Typography sx={{ fontFamily: MONO, color: C.accent, fontSize: '0.82rem', fontWeight: 700, letterSpacing: 0 }}>
          {play?.awayScore ?? 0}-{play?.homeScore ?? 0}
        </Typography>
        <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.54rem', letterSpacing: 0, textTransform: 'uppercase' }}>
          {play?.pitcher?.teamAbbreviation ?? ''}
        </Typography>
      </Box>
    </Box>
  );
}

function PlayTimeline({ plays, lang, t }) {
  const grouped = useMemo(() => {
    const result = [];
    const byKey = new Map();

    plays.forEach(play => {
      const key = `${play.inning}-${play.halfInning}`;
      if (!byKey.has(key)) {
        const group = { key, label: play.inningLabel, plays: [] };
        byKey.set(key, group);
        result.push(group);
      }
      byKey.get(key).plays.push(play);
    });

    return result;
  }, [plays]);

  if (plays.length === 0) {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, borderRadius: '4px', bgcolor: C.surface, py: '46px', textAlign: 'center' }}>
        <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.75rem', letterSpacing: 0 }}>
          {t.noPlays}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ border: `1px solid ${C.border}`, borderRadius: '4px', bgcolor: C.surface, px: { xs: '12px', sm: '16px' } }}>
      {grouped.map(group => (
        <Box key={group.key} sx={{ py: '10px' }}>
          <Box sx={{ position: 'sticky', top: 105, zIndex: 1, bgcolor: C.surface, py: '8px', borderBottom: `1px solid ${C.border}` }}>
            <Typography sx={{ fontFamily: BARLOW, color: C.cyan, fontSize: '0.72rem', fontWeight: 800, letterSpacing: 0, textTransform: 'uppercase' }}>
              {group.label}
            </Typography>
          </Box>
          {group.plays.map(play => (
            <PlayRow key={play.id} play={play} lang={lang} t={t} />
          ))}
        </Box>
      ))}
    </Box>
  );
}

function BoxscoreHeadshot({ id, name, tone }) {
  const [failed, setFailed] = useState(false);
  const src = playerHeadshotUrl(id);
  return (
    <Box
      sx={{
        width: 26,
        height: 26,
        borderRadius: '50%',
        overflow: 'hidden',
        border: `1px solid ${tone}55`,
        bgcolor: C.surfaceAlt,
        flexShrink: 0,
      }}
    >
      {src && !failed ? (
        <Box
          component="img"
          src={src}
          alt={name ?? ''}
          onError={() => setFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
          <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.6rem', letterSpacing: 0 }}>
            {String(name ?? '?').slice(0, 1)}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function StatCell({ value, tone = C.textPrimary, accent = false }) {
  const isZero = value === 0 || value === '0' || value === '0.0' || value == null;
  return (
    <Typography
      sx={{
        fontFamily: MONO,
        textAlign: 'center',
        fontSize: '0.74rem',
        fontWeight: accent ? 800 : 600,
        letterSpacing: 0,
        color: isZero ? C.textMuted : tone,
      }}
    >
      {value ?? 0}
    </Typography>
  );
}

function BattingTable({ batters, t, tone }) {
  if (!batters || batters.length === 0) {
    return (
      <Box sx={{ py: '20px', textAlign: 'center' }}>
        <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.66rem', letterSpacing: 0 }}>
          {t.noBattingData}
        </Typography>
      </Box>
    );
  }

  const cols = '1fr 36px 30px 30px 32px 36px 32px';

  return (
    <Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: cols,
          gap: '6px',
          alignItems: 'center',
          py: '8px',
          px: '10px',
          borderBottom: `1px solid ${tone}33`,
          bgcolor: `${tone}08`,
        }}
      >
        <Typography sx={{ fontFamily: BARLOW, color: tone, fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {t.player}
        </Typography>
        {[t.bat.ab, t.bat.r, t.bat.h, t.bat.bb, t.bat.rbi, t.bat.hr].map(label => (
          <Typography
            key={label}
            sx={{ fontFamily: MONO, color: C.textMuted, textAlign: 'center', fontSize: '0.56rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}
          >
            {label}
          </Typography>
        ))}
      </Box>

      {batters.map((b, idx) => (
        <Box
          key={`${b.id}-${idx}`}
          sx={{
            display: 'grid',
            gridTemplateColumns: cols,
            gap: '6px',
            alignItems: 'center',
            py: '8px',
            px: '10px',
            borderBottom: `1px solid ${C.borderLight}`,
            transition: 'background 0.15s',
            '&:hover': { bgcolor: `${tone}10` },
            '&:last-of-type': { borderBottom: 'none' },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <BoxscoreHeadshot id={b.id} name={b.name} tone={tone} />
            <Typography
              sx={{
                fontFamily: MONO,
                color: C.textPrimary,
                fontSize: '0.7rem',
                letterSpacing: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {b.name}
            </Typography>
          </Box>
          <StatCell value={b.atBats} />
          <StatCell value={b.runs ?? null} tone={C.green} />
          <StatCell value={b.hits} tone={C.accent} accent />
          <StatCell value={b.walks} tone={C.cyan} />
          <StatCell value={b.rbi} tone={C.green} accent />
          <StatCell value={b.homeRuns} tone={C.amber} accent />
        </Box>
      ))}
    </Box>
  );
}

function PitchingTable({ pitchers, t, tone }) {
  if (!pitchers || pitchers.length === 0) {
    return (
      <Box sx={{ py: '20px', textAlign: 'center' }}>
        <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.66rem', letterSpacing: 0 }}>
          {t.noPitchingData}
        </Typography>
      </Box>
    );
  }

  const cols = '1fr 44px 30px 32px 30px 32px';

  return (
    <Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: cols,
          gap: '6px',
          alignItems: 'center',
          py: '8px',
          px: '10px',
          borderBottom: `1px solid ${tone}33`,
          bgcolor: `${tone}08`,
        }}
      >
        <Typography sx={{ fontFamily: BARLOW, color: tone, fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {t.player}
        </Typography>
        {[t.pit.ip, t.pit.h, t.pit.er, t.pit.bb, t.pit.k].map(label => (
          <Typography
            key={label}
            sx={{ fontFamily: MONO, color: C.textMuted, textAlign: 'center', fontSize: '0.56rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}
          >
            {label}
          </Typography>
        ))}
      </Box>

      {pitchers.map((p, idx) => (
        <Box
          key={`${p.id}-${idx}`}
          sx={{
            display: 'grid',
            gridTemplateColumns: cols,
            gap: '6px',
            alignItems: 'center',
            py: '8px',
            px: '10px',
            borderBottom: `1px solid ${C.borderLight}`,
            transition: 'background 0.15s',
            '&:hover': { bgcolor: `${tone}10` },
            '&:last-of-type': { borderBottom: 'none' },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <BoxscoreHeadshot id={p.id} name={p.name} tone={tone} />
            <Typography
              sx={{
                fontFamily: MONO,
                color: C.textPrimary,
                fontSize: '0.7rem',
                letterSpacing: 0,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {p.name}
            </Typography>
          </Box>
          <StatCell value={p.ip} tone={C.cyan} accent />
          <StatCell value={p.hits} tone={C.accent} />
          <StatCell value={p.earnedRuns} tone={C.red} accent />
          <StatCell value={p.walks} />
          <StatCell value={p.strikeOuts} tone={C.cyan} accent />
        </Box>
      ))}
    </Box>
  );
}

function TeamTabButton({ active, tone, label, logoId, onClick }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        px: '14px',
        py: '8px',
        border: `1px solid ${active ? tone : C.border}`,
        borderBottom: 'none',
        borderTopLeftRadius: '4px',
        borderTopRightRadius: '4px',
        bgcolor: active ? `${tone}14` : 'transparent',
        color: active ? tone : C.textMuted,
        fontFamily: BARLOW,
        fontSize: '0.7rem',
        fontWeight: 800,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
        top: '1px',
        '&:hover': { color: tone, borderColor: `${tone}66` },
      }}
    >
      <TeamLogo id={logoId} alt={label} size={18} />
      {label}
    </Box>
  );
}

function BoxscoreTable({ data, t }) {
  const [expanded, setExpanded] = useState(true);
  const [side, setSide] = useState('away');

  const playerStats = data?.playerStats;
  const status = data?.status;
  const isLive = status === 'live';
  const isFinal = status === 'final';

  const hasAny = useMemo(() => {
    if (!playerStats) return false;
    const a = playerStats.away ?? {};
    const h = playerStats.home ?? {};
    return (
      (a.batters?.length ?? 0) > 0 ||
      (a.pitchers?.length ?? 0) > 0 ||
      (h.batters?.length ?? 0) > 0 ||
      (h.pitchers?.length ?? 0) > 0
    );
  }, [playerStats]);

  if (!playerStats || !hasAny || (!isLive && !isFinal)) return null;

  const titleLabel = isFinal ? t.boxscoreTitle : t.boxscoreLive;
  const headerTone = isFinal ? C.green : C.amber;
  const sideTone = side === 'away' ? C.cyan : C.accent;
  const teamData = side === 'away' ? data.away : data.home;
  const teamStats = playerStats[side] ?? { batters: [], pitchers: [] };

  return (
    <Box
      sx={{
        border: `1px solid ${C.border}`,
        borderRadius: '4px',
        bgcolor: C.surface,
        overflow: 'hidden',
        boxShadow: `inset 0 1px 0 ${headerTone}22`,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
          px: '14px',
          py: '12px',
          borderBottom: expanded ? `1px solid ${C.border}` : 'none',
          background: `linear-gradient(90deg, ${headerTone}14 0%, transparent 60%)`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <Box
            sx={{
              width: 6,
              height: 22,
              bgcolor: headerTone,
              boxShadow: `0 0 8px ${headerTone}99`,
              borderRadius: '2px',
            }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontFamily: BARLOW, color: headerTone, fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {titleLabel}
            </Typography>
            <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.6rem', letterSpacing: 0, mt: '2px' }}>
              {t.boxscoreSubtitle}
            </Typography>
          </Box>
        </Box>

        <Box
          component="button"
          onClick={() => setExpanded(v => !v)}
          sx={{
            px: '12px',
            py: '6px',
            border: `1px solid ${C.border}`,
            borderRadius: '3px',
            bgcolor: 'transparent',
            color: C.textMuted,
            fontFamily: BARLOW,
            fontSize: '0.62rem',
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            transition: 'all 0.15s',
            '&:hover': { color: C.cyan, borderColor: C.cyanLine },
          }}
        >
          {expanded ? `- ${t.boxscoreCollapse}` : `+ ${t.boxscoreExpand}`}
        </Box>
      </Box>

      {expanded && (
        <Box sx={{ p: { xs: '10px', sm: '14px' } }}>
          <Box sx={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${C.border}`, mb: '12px' }}>
            <TeamTabButton
              active={side === 'away'}
              tone={C.cyan}
              label={data.away?.abbreviation ?? 'AWY'}
              logoId={data.away?.id}
              onClick={() => setSide('away')}
            />
            <TeamTabButton
              active={side === 'home'}
              tone={C.accent}
              label={data.home?.abbreviation ?? 'HOM'}
              logoId={data.home?.id}
              onClick={() => setSide('home')}
            />
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
              gap: { xs: '14px', lg: '18px' },
            }}
          >
            <Box sx={{ border: `1px solid ${sideTone}33`, borderRadius: '3px', overflow: 'hidden' }}>
              <Box
                sx={{
                  px: '12px',
                  py: '8px',
                  bgcolor: `${sideTone}10`,
                  borderBottom: `1px solid ${sideTone}33`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <Typography sx={{ fontFamily: BARLOW, color: sideTone, fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  {t.batting}
                </Typography>
                <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.58rem', letterSpacing: 0 }}>
                  {teamData?.abbreviation ?? ''}
                </Typography>
              </Box>
              <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 360 }}>
                  <BattingTable batters={teamStats.batters} t={t} tone={sideTone} />
                </Box>
              </Box>
            </Box>

            <Box sx={{ border: `1px solid ${sideTone}33`, borderRadius: '3px', overflow: 'hidden' }}>
              <Box
                sx={{
                  px: '12px',
                  py: '8px',
                  bgcolor: `${sideTone}10`,
                  borderBottom: `1px solid ${sideTone}33`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <Typography sx={{ fontFamily: BARLOW, color: sideTone, fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  {t.pitching}
                </Typography>
                <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.58rem', letterSpacing: 0 }}>
                  {teamData?.abbreviation ?? ''}
                </Typography>
              </Box>
              <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 340 }}>
                  <PitchingTable pitchers={teamStats.pitchers} t={t} tone={sideTone} />
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * HighlightLinkButton — conditional "View official highlights" external link.
 * Renders nothing unless the backend confirms MLB highlights exist for the
 * game. We never embed video or expose CDN URLs — only a link to mlb.com.
 */
function HighlightLinkButton({ gamePk, label }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!gamePk) { setInfo(null); return; }
    let cancelled = false;
    fetch(`${API_URL}/api/games/${gamePk}/highlights-link`)
      .then(r => r.json())
      .then(j => { if (!cancelled && j?.success) setInfo(j.data); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [gamePk]);

  if (!info?.available || !info.externalUrl) return null;

  return (
    <Box
      component="a"
      href={info.externalUrl}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        alignSelf: 'flex-start',
        px: '14px', py: '8px',
        border: `1px solid ${C.accentLine}`,
        bgcolor: C.accentDim,
        color: C.accent,
        fontFamily: BARLOW,
        fontSize: '0.72rem',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        transition: 'all 0.2s',
        '&:hover': { borderColor: C.accent, boxShadow: C.accentGlow, color: '#fff' },
      }}
    >
      ▶ {label} ↗
    </Box>
  );
}

export default function GameDayDetail({ lang = 'en' }) {
  const t = COPY[lang] ?? COPY.en;

  const [date, setDate] = useState(todayStr);
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [gameData, setGameData] = useState(null);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [playsLoading, setPlaysLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortMode, setSortMode] = useState('oldest');
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchGames = useCallback(async () => {
    setGamesLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/games?date=${date}`);
      const json = await res.json();
      const list = json.success ? json.data : [];
      setGames(list);
      setSelectedGame(prev => {
        if (prev && list.some(game => String(game.gamePk) === String(prev.gamePk))) {
          return list.find(game => String(game.gamePk) === String(prev.gamePk));
        }
        return list.find(game => statusOf(game) === 'live') || list.find(game => statusOf(game) === 'final') || list[0] || null;
      });
    } catch (err) {
      setError(err.message);
      setGames([]);
      setSelectedGame(null);
    } finally {
      setGamesLoading(false);
    }
  }, [date]);

  const fetchPlayByPlay = useCallback(async () => {
    if (!selectedGame?.gamePk) {
      setGameData(null);
      return;
    }

    setPlaysLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/games/${selectedGame.gamePk}/play-by-play`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Could not load play-by-play');
      setGameData(json.data);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err.message);
      setGameData(null);
    } finally {
      setPlaysLoading(false);
    }
  }, [selectedGame]);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  useEffect(() => {
    fetchPlayByPlay();
  }, [fetchPlayByPlay]);

  useEffect(() => {
    if (statusOf(selectedGame) !== 'live') return undefined;
    const interval = setInterval(fetchPlayByPlay, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchPlayByPlay, selectedGame]);

  const filteredPlays = useMemo(() => {
    const plays = Array.isArray(gameData?.plays) ? gameData.plays : [];
    const next = plays.filter(play => {
      if (filter === 'scoring') return play.isScoring;
      if (filter === 'hits') return play.hasHit;
      if (filter === 'outs') return play.isOut;
      return true;
    });
    return sortMode === 'newest' ? [...next].reverse() : next;
  }, [filter, gameData, sortMode]);

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto', py: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
          mb: '18px',
          pb: '12px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontFamily: BARLOW, color: C.cyan, fontSize: '0.92rem', fontWeight: 800, letterSpacing: 0 }}>
            {t.title}
          </Typography>
          <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.68rem', letterSpacing: 0, mt: '4px' }}>
            {t.subtitle}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="date"
            value={date}
            onChange={event => setDate(event.target.value)}
            style={{
              background: C.surfaceAlt,
              border: `1px solid ${C.border}`,
              borderRadius: '4px',
              color: C.textPrimary,
              fontFamily: 'Share Tech Mono, JetBrains Mono, Courier New, monospace',
              fontSize: '0.72rem',
              padding: '7px 9px',
              cursor: 'pointer',
              outline: 'none',
              colorScheme: 'dark',
            }}
          />
          <FilterButton active={false} onClick={fetchPlayByPlay}>{t.refresh}</FilterButton>
        </Box>
      </Box>

      {(gamesLoading || playsLoading) && (
        <Box sx={{ mb: '12px' }}>
          <LinearProgress
            sx={{
              height: 2,
              bgcolor: C.cyanDim,
              '& .MuiLinearProgress-bar': { bgcolor: C.cyan },
            }}
          />
        </Box>
      )}

      {error && (
        <Box sx={{ border: `1px solid ${C.redLine}`, borderRadius: '4px', bgcolor: C.redDim, p: '10px', mb: '12px' }}>
          <Typography sx={{ fontFamily: MONO, color: C.red, fontSize: '0.68rem', letterSpacing: 0 }}>
            {error}
          </Typography>
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '330px 1fr' }, gap: '18px', alignItems: 'start' }}>
        <Box sx={{ border: `1px solid ${C.border}`, borderRadius: '4px', bgcolor: C.surfaceAlt, p: '12px' }}>
          <Typography sx={{ fontFamily: BARLOW, color: C.textPrimary, fontSize: '0.78rem', fontWeight: 800, letterSpacing: 0, mb: '10px' }}>
            {t.selectGame}
          </Typography>

          {games.length === 0 && !gamesLoading ? (
            <Box sx={{ py: '34px', textAlign: 'center' }}>
              <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.7rem', letterSpacing: 0 }}>
                {t.noGames}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '9px', maxHeight: { xs: 'none', md: 'calc(100vh - 260px)' }, overflowY: 'auto' }}>
              {games.map(game => (
                <GameListItem
                  key={game.gamePk}
                  game={game}
                  selected={String(selectedGame?.gamePk) === String(game.gamePk)}
                  onClick={() => setSelectedGame(game)}
                  t={t}
                />
              ))}
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
          {!selectedGame ? (
            <Box sx={{ border: `1px solid ${C.border}`, borderRadius: '4px', bgcolor: C.surface, py: '70px', textAlign: 'center' }}>
              <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.75rem', letterSpacing: 0 }}>
                {t.noGameSelected}
              </Typography>
            </Box>
          ) : (
            <>
              <GameSummary data={gameData} t={t} />

              <BoxscoreTable data={gameData} t={t} />

              <HighlightLinkButton gamePk={selectedGame.gamePk} label={t.viewHighlight} />

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <Box>
                  <Typography sx={{ fontFamily: BARLOW, color: C.textPrimary, fontSize: '0.82rem', fontWeight: 800, letterSpacing: 0 }}>
                    {t.playByPlay}
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.58rem', letterSpacing: 0, mt: '2px' }}>
                    {t.source}{lastUpdate ? ` - ${lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
                  <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>{t.all}</FilterButton>
                  <FilterButton active={filter === 'scoring'} onClick={() => setFilter('scoring')}>{t.scoring}</FilterButton>
                  <FilterButton active={filter === 'hits'} onClick={() => setFilter('hits')}>{t.hits}</FilterButton>
                  <FilterButton active={filter === 'outs'} onClick={() => setFilter('outs')}>{t.outs}</FilterButton>
                  <FilterButton active={sortMode === 'newest'} onClick={() => setSortMode(sortMode === 'newest' ? 'oldest' : 'newest')}>
                    {sortMode === 'newest' ? t.newest : t.oldest}
                  </FilterButton>
                </Box>
              </Box>

              {playsLoading && !gameData ? (
                <Box sx={{ border: `1px solid ${C.border}`, borderRadius: '4px', bgcolor: C.surface, py: '46px', textAlign: 'center' }}>
                  <Typography sx={{ fontFamily: MONO, color: C.textMuted, fontSize: '0.75rem', letterSpacing: 0 }}>
                    {t.loading}
                  </Typography>
                </Box>
              ) : (
                <PlayTimeline plays={filteredPlays} lang={lang} t={t} />
              )}
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
}
