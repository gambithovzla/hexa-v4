import { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, BARLOW, MONO } from '../theme';
import PlayoffBracket from './PlayoffBracket';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const STANDINGS_SELECTION_KEY = 'hexa_nba_standings_selection';

const COPY = {
  en: {
    eyebrow:      'NBA standings',
    title:        'Conference & division table',
    subtitle:     'Toggle between conference view (with playoff/play-in cutoffs) and division view. Order matches the official NBA playoff race.',
    loading:      'Loading standings...',
    empty:        'No standings available right now.',
    error:        'Could not load standings.',
    season:       'Season',
    updated:      'Updated',
    focus:        'Focus',
    leader:       'Leader',
    east:         'Eastern Conference',
    west:         'Western Conference',
    viewConf:     'Conference',
    viewDiv:      'Divisions',
    confMeta:     'Seeds 1-15',
    divMeta:      '3 divisions',
    record:       'Record',
    pct:          'PCT',
    gb:           'GB',
    streak:       'Streak',
    last10:       'Last 10',
    diff:         'Pt diff',
    teams:        'Team',
    playoff:      'Playoff',
    playIn:       'Play-In',
    out:          'Out',
    playoffCut:   'Playoff cutoff',
    playInCut:    'Play-In cutoff',
    division:     'Division',
  },
  es: {
    eyebrow:      'Posiciones NBA',
    title:        'Tabla por conferencia y división',
    subtitle:     'Alterna entre vista por conferencia (con cortes de playoff/play-in) y vista por división. Orden oficial según la carrera al playoff.',
    loading:      'Cargando posiciones...',
    empty:        'No hay posiciones disponibles ahora mismo.',
    error:        'No se pudieron cargar las posiciones.',
    season:       'Temporada',
    updated:      'Actualizado',
    focus:        'Foco',
    leader:       'Líder',
    east:         'Conferencia Este',
    west:         'Conferencia Oeste',
    viewConf:     'Conferencia',
    viewDiv:      'Divisiones',
    confMeta:     'Seeds 1-15',
    divMeta:      '3 divisiones',
    record:       'Récord',
    pct:          'PCT',
    gb:           'GB',
    streak:       'Racha',
    last10:       'Últimos 10',
    diff:         'Dif. puntos',
    teams:        'Equipo',
    playoff:      'Playoff',
    playIn:       'Play-In',
    out:          'Eliminado',
    playoffCut:   'Corte playoff',
    playInCut:    'Corte play-in',
    division:     'División',
  },
};

const PLAYOFF_TONE = {
  playoff: { accentKey: 'green' },
  playIn:  { accentKey: 'accent' },
  out:     { accentKey: 'muted'  },
  unknown: { accentKey: 'muted'  },
};

function readStoredSelection() {
  if (typeof window === 'undefined') return { conference: 'East', viewMode: 'conference' };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STANDINGS_SELECTION_KEY) || '{}');
    return {
      conference: parsed.conference === 'West' ? 'West' : 'East',
      viewMode:   parsed.viewMode   === 'division' ? 'division' : 'conference',
    };
  } catch {
    return { conference: 'East', viewMode: 'conference' };
  }
}

function formatUpdated(iso, lang) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

function formatGamesBack(value) {
  if (value == null) return '-';
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function getToneStyles(accent) {
  if (accent === C.accent) return { line: C.accentLine, dim: C.accentDim };
  if (accent === C.green)  return { line: C.greenLine, dim: C.greenDim };
  return { line: C.cyanLine, dim: C.cyanDim };
}

function NbaTeamLogo({ teamId, abbr, size = 44 }) {
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
        <Typography sx={{ fontFamily: MONO, fontSize: size * 0.3, color: C.textMuted }}>
          {abbr || '—'}
        </Typography>
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={`https://cdn.nba.com/logos/nba/${teamId}/primary/L/logo.svg`}
      alt={abbr || 'team logo'}
      loading="lazy"
      onError={() => setFailed(true)}
      sx={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }}
    />
  );
}

function PanelTile({ label, value, accent = C.cyan, children }) {
  const tone = getToneStyles(accent);
  return (
    <Box sx={{ p: '12px 14px', border: `1px solid ${tone.line}`, background: 'rgba(0,0,0,0.34)', minHeight: 82 }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, letterSpacing: '0.18em', textTransform: 'uppercase', mb: 0.65 }}>
        {label}
      </Typography>
      {children ?? (
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.94rem', color: accent, letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1.1 }}>
          {value}
        </Typography>
      )}
    </Box>
  );
}

function SelectorButton({ label, meta, active, onClick, accent = C.cyan }) {
  const tone = getToneStyles(accent);
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        position: 'relative',
        display: 'grid', gap: '6px', alignContent: 'center',
        minHeight: 76, px: '14px', py: '12px',
        border: `1px solid ${active ? tone.line : C.border}`,
        background: active ? tone.dim : 'linear-gradient(180deg, rgba(16,22,32,0.98), rgba(5,7,12,0.96))',
        boxShadow: active ? '0 12px 28px rgba(0,0,0,0.42)' : '0 8px 18px rgba(0,0,0,0.24)',
        color: active ? accent : C.textSecondary,
        cursor: 'pointer', transition: 'all 0.2s ease', overflow: 'hidden',
        '&::before': {
          content: '""', position: 'absolute', top: 0, left: 12, right: 12, height: 3,
          background: active ? accent : 'rgba(255,255,255,0.05)',
        },
        '&:hover': { borderColor: tone.line, color: accent, transform: 'translateY(-1px)' },
      }}
    >
      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.86rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: active ? C.textPrimary : C.textMuted }}>
        {meta}
      </Typography>
    </Box>
  );
}

function MetaPill({ label, value, accent = C.cyan }) {
  const tone = getToneStyles(accent);
  return (
    <Box sx={{ px: '8px', py: '6px', border: `1px solid ${tone.line}`, background: 'rgba(255,255,255,0.03)', minWidth: 66 }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: accent, mt: 0.35 }}>
        {value}
      </Typography>
    </Box>
  );
}

function PlayoffBadge({ status, copy }) {
  const map = {
    playoff: { label: copy.playoff, color: C.green,      bg: 'rgba(0,200,140,0.12)' },
    playIn:  { label: copy.playIn,  color: C.accent,     bg: 'rgba(255,102,0,0.12)' },
    out:     { label: copy.out,     color: C.textMuted,  bg: 'rgba(255,255,255,0.04)' },
  };
  const cfg = map[status] ?? null;
  if (!cfg) return null;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center',
        px: '7px', py: '2px',
        border: `1px solid ${cfg.color}66`,
        background: cfg.bg,
        fontFamily: MONO, fontSize: '0.54rem', fontWeight: 700,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: cfg.color,
      }}
    >
      {cfg.label}
    </Box>
  );
}

function CutoffDivider({ label, color }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, my: 0.4 }}>
      <Box sx={{ flex: 1, height: '1px', background: `${color}55` }} />
      <Typography
        sx={{
          fontFamily: MONO, fontSize: '0.54rem', color,
          letterSpacing: '0.2em', textTransform: 'uppercase',
          px: 1, py: 0.4,
          border: `1px solid ${color}55`,
          background: 'rgba(0,0,0,0.4)',
        }}
      >
        {label}
      </Typography>
      <Box sx={{ flex: 1, height: '1px', background: `${color}55` }} />
    </Box>
  );
}

function TeamRow({ team, rank, copy, selected, leader, onToggle, showPlayoffBadge, showDivision }) {
  const diffNum = Number(team.diff);
  const diffAccent = !Number.isFinite(diffNum) ? C.textSecondary : diffNum >= 0 ? C.green : C.red;
  const diffLabel = !Number.isFinite(diffNum) ? '-' : (diffNum > 0 ? `+${diffNum.toFixed(1)}` : diffNum.toFixed(1));
  const streakAccent = team.streak?.toString().toUpperCase().startsWith('W') ? C.green : C.accent;

  return (
    <Box
      component="button"
      onClick={onToggle}
      sx={{
        width: '100%', textAlign: 'left', p: '14px',
        border: `1px solid ${selected ? C.cyanLine : leader ? C.accentLine : C.border}`,
        borderLeft: `3px solid ${selected ? C.cyan : leader ? C.accent : 'rgba(0,217,255,0.18)'}`,
        background: selected
          ? 'linear-gradient(180deg, rgba(0,217,255,0.12), rgba(0,217,255,0.04))'
          : leader
            ? 'linear-gradient(180deg, rgba(255,102,0,0.12), rgba(255,102,0,0.03))'
            : 'linear-gradient(180deg, rgba(12,16,24,0.96), rgba(4,6,10,0.94))',
        boxShadow: selected ? '0 14px 30px rgba(0,0,0,0.42)' : '0 12px 24px rgba(0,0,0,0.24)',
        cursor: 'pointer', transition: 'all 0.2s ease',
        '&:hover': { borderColor: C.cyanLine, transform: 'translateY(-1px)' },
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: '34px 46px minmax(0,1fr) auto', gap: 1.25, alignItems: 'center' }}>
        <Box
          sx={{
            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${leader ? C.accentLine : C.border}`,
            background: leader ? C.accentDim : 'rgba(255,255,255,0.03)',
          }}
        >
          <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: leader ? C.accent : C.textMuted }}>
            #{rank}
          </Typography>
        </Box>

        <NbaTeamLogo teamId={team.teamId} abbr={team.abbreviation} size={44} />

        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '0.94rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.02 }}>
              {team.abbreviation || team.name}
            </Typography>
            {showPlayoffBadge && <PlayoffBadge status={team.playoffStatus} copy={copy} />}
          </Box>
          <Typography noWrap sx={{ fontFamily: MONO, fontSize: '0.64rem', color: C.textMuted, mt: 0.25 }}>
            {team.fullName}
            {showDivision && team.division ? ` · ${team.division}` : ''}
          </Typography>
        </Box>

        <Box sx={{ textAlign: 'right', minWidth: 74 }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.9rem', fontWeight: 800, color: leader ? C.accent : C.textPrimary, letterSpacing: '0.06em' }}>
            {team.wins}-{team.losses}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.64rem', color: C.cyan, mt: 0.2 }}>
            {team.pct ?? '-'}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.35 }}>
        <MetaPill label={copy.record} value={`${team.wins}-${team.losses}`} accent={leader ? C.accent : C.cyan} />
        <MetaPill label={copy.gb}     value={formatGamesBack(team.gamesBack)} accent={C.cyan} />
        <MetaPill label={copy.last10} value={team.last10 || '-'} accent={C.textPrimary} />
        <MetaPill label={copy.diff}   value={diffLabel} accent={diffAccent} />
        <MetaPill label={copy.streak} value={team.streak || '-'} accent={streakAccent} />
      </Box>

      {selected && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.1 }}>
          <MetaPill label={copy.pct} value={team.pct ?? '-'} accent={C.cyan} />
          <MetaPill label="HOME" value={team.home || '-'} accent={C.cyan} />
          <MetaPill label="ROAD" value={team.road || '-'} accent={C.cyan} />
          <MetaPill label={copy.teams} value={team.fullName || team.name || '-'} accent={C.textPrimary} />
        </Box>
      )}
    </Box>
  );
}

export default function NBAStandingsPanel({ lang = 'es' }) {
  const copy = COPY[lang] ?? COPY.es;
  const stored = readStoredSelection();
  const [data, setData] = useState(null);
  const [bracket, setBracket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [conference, setConference] = useState(stored.conference);
  const [viewMode, setViewMode] = useState(stored.viewMode);
  const [selectedTeamId, setSelectedTeamId] = useState(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');

    Promise.all([
      fetch(`${API_URL}/api/nba/standings`).then(r => r.json()),
      fetch(`${API_URL}/api/nba/playoffs`).then(r => r.json()).catch(() => null),
    ])
      .then(([standingsJson, bracketJson]) => {
        if (!mounted) return;
        if (!standingsJson?.success) throw new Error(standingsJson?.error || 'fetch failed');
        setData(standingsJson.data || null);
        if (bracketJson?.success) setBracket(bracketJson.data || null);
      })
      .catch(err => { if (mounted) setError(err.message || 'fetch failed'); })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STANDINGS_SELECTION_KEY, JSON.stringify({ conference, viewMode }));
  }, [conference, viewMode]);

  const conferences = data?.conferences ?? [];
  const current = useMemo(
    () => conferences.find(c => c.key === conference) ?? conferences[0] ?? null,
    [conference, conferences],
  );

  if (loading) {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface, p: 2.5 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textMuted }}>
          {copy.loading}
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ border: `1px solid ${C.redLine}`, bgcolor: C.redDim, p: 2.5 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.red }}>
          {copy.error}
        </Typography>
      </Box>
    );
  }

  if (!current || (current.teams ?? []).length === 0) {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface, p: 2.5 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textMuted }}>
          {copy.empty}
        </Typography>
      </Box>
    );
  }

  const teams = current.teams ?? [];
  const leader = teams[0] ?? null;
  const focusValue = current.name?.[lang] ?? current.name?.en ?? current.key;

  return (
    <Box
      sx={{
        position: 'relative', p: { xs: 2, sm: 2.5 },
        border: `1px solid ${C.border}`,
        background: 'linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))',
        boxShadow: 'inset 0 0 32px rgba(0,0,0,0.75)',
        overflow: 'hidden', display: 'grid', gap: 2,
        '&::before': {
          content: '""', position: 'absolute', top: 0, left: 0,
          width: 18, height: 18,
          borderTop: `2px solid ${C.cyan}`, borderLeft: `2px solid ${C.cyan}`,
        },
        '&::after': {
          content: '""', position: 'absolute', right: 0, bottom: 0,
          width: 18, height: 18,
          borderRight: `2px solid ${C.accent}`, borderBottom: `2px solid ${C.accent}`,
        },
      }}
    >
      <Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.cyan, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
          {copy.eyebrow}
        </Typography>
        <Typography sx={{ fontFamily: BARLOW, fontSize: { xs: '1.18rem', sm: '1.42rem' }, fontWeight: 800, color: C.textPrimary, textTransform: 'uppercase', letterSpacing: '0.08em', mt: 0.5 }}>
          {copy.title}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textMuted, mt: 0.8, lineHeight: 1.7, maxWidth: 760 }}>
          {copy.subtitle}
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', lg: 'repeat(4, minmax(0,1fr))' }, gap: 1.25 }}>
        <PanelTile label={copy.season}  value={data?.season ?? '-'} accent={C.cyan} />
        <PanelTile label={copy.updated} value={formatUpdated(data?.updatedAt, lang)} accent={C.accent} />
        <PanelTile label={copy.focus}   value={focusValue} accent={C.green} />
        <PanelTile label={copy.leader}  accent={C.accent}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <NbaTeamLogo teamId={leader?.teamId} abbr={leader?.abbreviation} size={34} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontFamily: BARLOW, fontSize: '0.82rem', fontWeight: 800, color: C.accent, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {leader?.abbreviation || '-'}
              </Typography>
              <Typography noWrap sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, mt: 0.15 }}>
                {leader?.fullName || '-'}
              </Typography>
            </Box>
          </Box>
        </PanelTile>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
        <SelectorButton
          label={copy.viewConf}
          meta={copy.confMeta}
          active={viewMode === 'conference'}
          onClick={() => { setViewMode('conference'); setSelectedTeamId(null); }}
          accent={C.green}
        />
        <SelectorButton
          label={copy.viewDiv}
          meta={copy.divMeta}
          active={viewMode === 'division'}
          onClick={() => { setViewMode('division'); setSelectedTeamId(null); }}
          accent={C.cyan}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
        <SelectorButton
          label={copy.east}
          meta="East"
          active={conference === 'East'}
          onClick={() => { setConference('East'); setSelectedTeamId(null); }}
          accent={C.cyan}
        />
        <SelectorButton
          label={copy.west}
          meta="West"
          active={conference === 'West'}
          onClick={() => { setConference('West'); setSelectedTeamId(null); }}
          accent={C.accent}
        />
      </Box>

      {viewMode === 'conference' ? (
        <Box sx={{ display: 'grid', gap: 1.1 }}>
          {teams.map((team, index) => {
            const rank = team.conferenceRank ?? index + 1;
            const row = (
              <TeamRow
                key={team.teamId ?? `${team.abbreviation}-${index}`}
                team={team}
                rank={rank}
                copy={copy}
                selected={selectedTeamId === team.teamId}
                leader={index === 0}
                showPlayoffBadge
                onToggle={() => setSelectedTeamId(v => v === team.teamId ? null : team.teamId)}
              />
            );
            const dividers = [];
            if (rank === 6) dividers.push(<CutoffDivider key={`cut-pl-${team.teamId}`} label={copy.playoffCut}  color={C.green} />);
            if (rank === 10) dividers.push(<CutoffDivider key={`cut-pi-${team.teamId}`} label={copy.playInCut}  color={C.accent} />);
            return [row, ...dividers];
          })}
        </Box>
      ) : (
        <Box sx={{ display: 'grid', gap: 2 }}>
          {(current.divisions ?? []).map(div => (
            <Box key={div.key} sx={{ display: 'grid', gap: 1 }}>
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.2,
                  px: '12px', py: '8px',
                  border: `1px solid ${C.cyanLine}`,
                  background: 'rgba(0,217,255,0.05)',
                }}
              >
                <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                  {copy.division}
                </Typography>
                <Typography sx={{ fontFamily: BARLOW, fontSize: '0.92rem', fontWeight: 800, color: C.cyan, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {div.name?.[lang] ?? div.name?.en ?? div.key}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
                  {(div.teams ?? []).length} {copy.teams.toLowerCase()}{(div.teams ?? []).length === 1 ? '' : 's'}
                </Typography>
              </Box>
              <Box sx={{ display: 'grid', gap: 1.1 }}>
                {(div.teams ?? []).map((team, index) => (
                  <TeamRow
                    key={team.teamId ?? `${team.abbreviation}-${index}`}
                    team={team}
                    rank={team.divisionRank ?? index + 1}
                    copy={copy}
                    selected={selectedTeamId === team.teamId}
                    leader={index === 0}
                    showPlayoffBadge
                    onToggle={() => setSelectedTeamId(v => v === team.teamId ? null : team.teamId)}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {bracket && (
        <Box sx={{ mt: 1, pt: 2, borderTop: `1px solid ${C.border}` }}>
          <PlayoffBracket data={bracket} lang={lang} />
        </Box>
      )}
    </Box>
  );
}
