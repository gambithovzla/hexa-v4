import { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import TeamLogo from './TeamLogo';
import { C, BARLOW, MONO } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const STANDINGS_SELECTION_KEY = 'hexa_standings_selection';

const COPY = {
  en: {
    eyebrow: 'MLB standings',
    title: 'League and division table',
    subtitle: 'Switch between the full AL or NL table, or drill into each division without changing pages.',
    loading: 'Loading standings...',
    empty: 'No standings available right now.',
    error: 'Could not load standings.',
    season: 'Season',
    updated: 'Updated',
    focus: 'Focus',
    leader: 'Leader',
    league: 'League',
    division: 'Division',
    viewLeague: 'Full league',
    viewDivision: 'Divisions',
    record: 'Record',
    pct: 'PCT',
    gb: 'GB',
    streak: 'Streak',
    last10: 'Last 10',
    diff: 'Run diff',
    teams: 'Team',
    divisionShort: 'Div',
  },
  es: {
    eyebrow: 'Tabla de posiciones',
    title: 'Tabla por liga y division',
    subtitle: 'Mira la tabla completa de la Americana o Nacional, o baja a cada division sin cambiar de pantalla.',
    loading: 'Cargando posiciones...',
    empty: 'No hay posiciones disponibles ahora mismo.',
    error: 'No se pudieron cargar las posiciones.',
    season: 'Temporada',
    updated: 'Actualizado',
    focus: 'Foco',
    leader: 'Lider',
    league: 'Liga',
    division: 'Division',
    viewLeague: 'Liga completa',
    viewDivision: 'Divisiones',
    record: 'Record',
    pct: 'PCT',
    gb: 'GB',
    streak: 'Racha',
    last10: 'Ultimos 10',
    diff: 'Dif. carreras',
    teams: 'Equipo',
    divisionShort: 'Div',
  },
};

const DIVISION_LABELS = {
  east: { en: 'East', es: 'Este' },
  central: { en: 'Central', es: 'Central' },
  west: { en: 'West', es: 'Oeste' },
};

function readStoredSelection() {
  if (typeof window === 'undefined') {
    return { mode: 'league', league: 'AL', division: 'east' };
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(STANDINGS_SELECTION_KEY) || '{}');
    return {
      mode: parsed.mode || 'league',
      league: parsed.league || 'AL',
      division: parsed.division || 'east',
    };
  } catch {
    return { mode: 'league', league: 'AL', division: 'east' };
  }
}

function formatUpdated(iso, lang) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

function getToneStyles(accent) {
  if (accent === C.accent) {
    return { line: C.accentLine, dim: C.accentDim };
  }
  if (accent === C.green) {
    return { line: C.greenLine, dim: C.greenDim };
  }
  return { line: C.cyanLine, dim: C.cyanDim };
}

function getPctValue(team) {
  const raw = Number(team?.pct);
  if (Number.isFinite(raw)) return raw;
  const wins = Number(team?.wins ?? 0);
  const losses = Number(team?.losses ?? 0);
  const total = wins + losses;
  return total > 0 ? wins / total : 0;
}

function parseGamesBack(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).trim();
  if (!normalized || normalized === '-' || normalized === '--') return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatGamesBack(value) {
  const numeric = parseGamesBack(value);
  if (numeric == null || numeric <= 0) return '-';
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

function PanelTile({ label, value, accent = C.cyan, children }) {
  const tone = getToneStyles(accent);

  return (
    <Box
      sx={{
        p: '12px 14px',
        border: `1px solid ${tone.line}`,
        background: 'rgba(0,0,0,0.34)',
        minHeight: 82,
      }}
    >
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

function SelectorButton({ label, meta, active, onClick, accent = C.cyan, compact = false }) {
  const tone = getToneStyles(accent);

  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        position: 'relative',
        display: 'grid',
        gap: compact ? '4px' : '6px',
        alignContent: 'center',
        justifyItems: compact ? 'center' : 'start',
        minHeight: compact ? 68 : 76,
        px: compact ? '10px' : '14px',
        py: compact ? '10px' : '12px',
        border: `1px solid ${active ? tone.line : C.border}`,
        background: active ? tone.dim : 'linear-gradient(180deg, rgba(16,22,32,0.98), rgba(5,7,12,0.96))',
        boxShadow: active
          ? '0 12px 28px rgba(0,0,0,0.42)'
          : '0 8px 18px rgba(0,0,0,0.24)',
        color: active ? accent : C.textSecondary,
        textAlign: compact ? 'center' : 'left',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 12,
          right: 12,
          height: 3,
          background: active ? accent : 'rgba(255,255,255,0.05)',
        },
        '&:hover': {
          borderColor: tone.line,
          color: accent,
          transform: 'translateY(-1px)',
        },
      }}
    >
      <Typography sx={{ fontFamily: BARLOW, fontSize: compact ? '0.8rem' : '0.86rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'inherit' }}>
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
    <Box
      sx={{
        px: '8px',
        py: '6px',
        border: `1px solid ${tone.line}`,
        background: 'rgba(255,255,255,0.03)',
        minWidth: 66,
      }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: accent, mt: 0.35 }}>
        {value}
      </Typography>
    </Box>
  );
}

function TeamRow({ team, rank, copy, selected, leader, onToggle, viewMode }) {
  const runDiffAccent = team.runDiff == null ? C.textSecondary : team.runDiff >= 0 ? C.green : C.red;
  const gamesBack = viewMode === 'league' ? team.leagueGamesBack : team.gamesBack;

  return (
    <Box
      component="button"
      onClick={onToggle}
      sx={{
        width: '100%',
        textAlign: 'left',
        p: '14px',
        border: `1px solid ${selected ? C.cyanLine : leader ? C.accentLine : C.border}`,
        borderLeft: `3px solid ${selected ? C.cyan : leader ? C.accent : 'rgba(0,217,255,0.18)'}`,
        background: selected
          ? 'linear-gradient(180deg, rgba(0,217,255,0.12), rgba(0,217,255,0.04))'
          : leader
            ? 'linear-gradient(180deg, rgba(255,102,0,0.12), rgba(255,102,0,0.03))'
            : 'linear-gradient(180deg, rgba(12,16,24,0.96), rgba(4,6,10,0.94))',
        boxShadow: selected
          ? '0 14px 30px rgba(0,0,0,0.42)'
          : '0 12px 24px rgba(0,0,0,0.24)',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        '&:hover': {
          borderColor: C.cyanLine,
          transform: 'translateY(-1px)',
        },
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: '34px 46px minmax(0,1fr) auto', gap: 1.25, alignItems: 'center' }}>
        <Box
          sx={{
            width: 34,
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${leader ? C.accentLine : C.border}`,
            background: leader ? C.accentDim : 'rgba(255,255,255,0.03)',
          }}
        >
          <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: leader ? C.accent : C.textMuted }}>
            #{rank}
          </Typography>
        </Box>

        <TeamLogo
          teamId={team.teamId}
          abbr={team.abbreviation}
          size={44}
          color={leader ? C.accent : C.cyan}
          glow={false}
          variant="plain"
        />

        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.94rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.02 }}>
            {team.abbreviation || team.name}
          </Typography>
          <Typography noWrap sx={{ fontFamily: MONO, fontSize: '0.64rem', color: C.textMuted, mt: 0.25 }}>
            {team.fullName}
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
        {viewMode === 'league' && (
          <MetaPill label={copy.divisionShort} value={team.divisionLabel || '-'} accent={C.accent} />
        )}
        <MetaPill label={copy.record} value={`${team.wins}-${team.losses}`} accent={leader ? C.accent : C.cyan} />
        <MetaPill label={copy.gb} value={formatGamesBack(gamesBack)} accent={C.cyan} />
        <MetaPill label={copy.last10} value={team.last10 || '-'} accent={C.textPrimary} />
        <MetaPill label={copy.diff} value={team.runDiff != null ? `${team.runDiff > 0 ? '+' : ''}${team.runDiff}` : '-'} accent={runDiffAccent} />
      </Box>

      {selected && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.1 }}>
          <MetaPill label={copy.streak} value={team.streak || '-'} accent={team.streak?.startsWith('W') ? C.green : C.accent} />
          <MetaPill label={copy.pct} value={team.pct ?? '-'} accent={C.cyan} />
          <MetaPill label={copy.teams} value={team.fullName || team.name || '-'} accent={C.textPrimary} />
        </Box>
      )}
    </Box>
  );
}

export default function MLBStandingsPanel({ lang = 'es' }) {
  const copy = COPY[lang] ?? COPY.es;
  const storedSelection = readStoredSelection();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeMode, setActiveMode] = useState(storedSelection.mode);
  const [activeLeague, setActiveLeague] = useState(storedSelection.league);
  const [activeDivision, setActiveDivision] = useState(storedSelection.division);
  const [selectedTeamId, setSelectedTeamId] = useState(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');

    fetch(`${API_URL}/api/mlb/standings`)
      .then((r) => r.json())
      .then((json) => {
        if (!mounted) return;
        if (!json?.success) throw new Error(json?.error || 'fetch failed');
        setData(json.data || null);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message || 'fetch failed');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STANDINGS_SELECTION_KEY, JSON.stringify({
      mode: activeMode,
      league: activeLeague,
      division: activeDivision,
    }));
  }, [activeDivision, activeLeague, activeMode]);

  const leagues = data?.leagues ?? [];
  const currentLeague = leagues.find((league) => league.key === activeLeague) ?? leagues[0] ?? null;

  useEffect(() => {
    if (!leagues.length) return;
    if (!leagues.some((league) => league.key === activeLeague)) {
      setActiveLeague(leagues[0].key);
    }
  }, [activeLeague, leagues]);

  useEffect(() => {
    if (!currentLeague) return;
    if (!currentLeague.divisions.some((division) => division.key === activeDivision)) {
      setActiveDivision(currentLeague.divisions[0]?.key ?? 'east');
    }
  }, [activeDivision, currentLeague]);

  const currentDivision = useMemo(() => (
    currentLeague?.divisions?.find((division) => division.key === activeDivision)
      ?? currentLeague?.divisions?.[0]
      ?? null
  ), [activeDivision, currentLeague]);

  const leagueTeams = useMemo(() => {
    const flattened = (currentLeague?.divisions ?? []).flatMap((division) => {
      const divisionLabel = division.name?.[lang] ?? DIVISION_LABELS[division.key]?.[lang] ?? division.key;
      return (division.teams ?? []).map((team) => ({
        ...team,
        divisionKey: division.key,
        divisionLabel,
      }));
    });

    const sorted = [...flattened].sort((a, b) => (
      getPctValue(b) - getPctValue(a)
      || Number(b.wins ?? 0) - Number(a.wins ?? 0)
      || Number(a.losses ?? 0) - Number(b.losses ?? 0)
      || Number(b.runDiff ?? -9999) - Number(a.runDiff ?? -9999)
      || String(a.fullName ?? a.name ?? '').localeCompare(String(b.fullName ?? b.name ?? ''))
    ));

    const leader = sorted[0];
    if (!leader) return [];

    return sorted.map((team, index) => {
      const gb = ((leader.wins - team.wins) + (team.losses - leader.losses)) / 2;
      return {
        ...team,
        leagueRank: index + 1,
        leagueGamesBack: gb <= 0 ? '-' : gb,
      };
    });
  }, [currentLeague, lang]);

  const currentTeams = activeMode === 'league'
    ? leagueTeams
    : (currentDivision?.teams ?? []).map((team) => ({
        ...team,
        divisionLabel: currentDivision?.name?.[lang] ?? DIVISION_LABELS[currentDivision?.key]?.[lang] ?? currentDivision?.key,
      }));

  useEffect(() => {
    if (!currentTeams.some((team) => team.teamId === selectedTeamId)) {
      setSelectedTeamId(currentTeams[0]?.teamId ?? null);
    }
  }, [currentTeams, selectedTeamId]);

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

  if (!currentLeague || !currentDivision || currentTeams.length === 0) {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface, p: 2.5 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textMuted }}>
          {copy.empty}
        </Typography>
      </Box>
    );
  }

  const currentDivisionLabel = currentDivision.name?.[lang] ?? DIVISION_LABELS[currentDivision.key]?.[lang] ?? currentDivision.key;
  const focusValue = activeMode === 'league'
    ? (currentLeague.name?.[lang] ?? currentLeague.key)
    : `${currentLeague.key} ${currentDivisionLabel}`;
  const leader = currentTeams[0] ?? null;

  return (
    <Box
      sx={{
        position: 'relative',
        p: { xs: 2, sm: 2.5 },
        border: `1px solid ${C.border}`,
        background: 'linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))',
        boxShadow: 'inset 0 0 32px rgba(0,0,0,0.75)',
        overflow: 'hidden',
        display: 'grid',
        gap: 2,
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          width: 18,
          height: 18,
          borderTop: `2px solid ${C.cyan}`,
          borderLeft: `2px solid ${C.cyan}`,
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 18,
          height: 18,
          borderRight: `2px solid ${C.accent}`,
          borderBottom: `2px solid ${C.accent}`,
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
        <PanelTile label={copy.season} value={data?.season ?? '-'} accent={C.cyan} />
        <PanelTile label={copy.updated} value={formatUpdated(data?.updatedAt, lang)} accent={C.accent} />
        <PanelTile label={copy.focus} value={focusValue} accent={C.green} />
        <PanelTile label={copy.leader} accent={activeMode === 'league' ? C.green : C.accent}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TeamLogo
              teamId={leader?.teamId}
              abbr={leader?.abbreviation}
              size={34}
              color={activeMode === 'league' ? C.green : C.accent}
              glow={false}
              variant="plain"
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontFamily: BARLOW, fontSize: '0.82rem', fontWeight: 800, color: activeMode === 'league' ? C.green : C.accent, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
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
          label={copy.viewLeague}
          meta={copy.league}
          active={activeMode === 'league'}
          onClick={() => {
            setActiveMode('league');
            setSelectedTeamId(null);
          }}
          accent={C.green}
        />
        <SelectorButton
          label={copy.viewDivision}
          meta={copy.division}
          active={activeMode === 'division'}
          onClick={() => {
            setActiveMode('division');
            setSelectedTeamId(null);
          }}
          accent={C.cyan}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
        {(leagues.length > 0 ? leagues : []).map((league) => (
          <SelectorButton
            key={league.key}
            label={league.key}
            meta={league.name?.[lang] ?? league.key}
            active={league.key === currentLeague.key}
            onClick={() => {
              setActiveLeague(league.key);
              setSelectedTeamId(null);
            }}
            accent={C.cyan}
          />
        ))}
      </Box>

      {activeMode === 'division' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.25 }}>
          {(currentLeague.divisions ?? []).map((division) => {
            const localLabel = division.name?.[lang] ?? DIVISION_LABELS[division.key]?.[lang] ?? division.key;
            return (
              <SelectorButton
                key={division.key}
                label={`${currentLeague.key} ${localLabel}`}
                meta={`${copy.division} ${localLabel}`}
                active={division.key === currentDivision.key}
                onClick={() => {
                  setActiveDivision(division.key);
                  setSelectedTeamId(null);
                }}
                compact
              />
            );
          })}
        </Box>
      )}

      <Box sx={{ display: 'grid', gap: 1.1 }}>
        {currentTeams.map((team, index) => (
          <TeamRow
            key={team.teamId ?? `${team.abbreviation}-${index}`}
            team={team}
            rank={activeMode === 'league' ? (team.leagueRank ?? index + 1) : index + 1}
            copy={copy}
            selected={selectedTeamId === team.teamId}
            leader={index === 0}
            viewMode={activeMode}
            onToggle={() => setSelectedTeamId((value) => (value === team.teamId ? null : team.teamId))}
          />
        ))}
      </Box>
    </Box>
  );
}
