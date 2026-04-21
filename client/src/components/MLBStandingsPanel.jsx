import { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, BARLOW, MONO } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const COPY = {
  en: {
    eyebrow: 'League standings',
    title: 'Conference and division table',
    subtitle: 'Tap a league and division to switch quickly with minimal scroll.',
    loading: 'Loading standings...',
    empty: 'No standings available right now.',
    error: 'Could not load standings.',
    season: 'Season',
    updated: 'Updated',
    columns: { team: 'Team', w: 'W', l: 'L', pct: 'PCT', gb: 'GB' },
    meta: { streak: 'Streak', last10: 'Last 10', diff: 'Run diff' },
  },
  es: {
    eyebrow: 'Tabla de posiciones',
    title: 'Conferencia y division',
    subtitle: 'Toca la liga y la division para cambiar rapido con el menor scroll posible.',
    loading: 'Cargando posiciones...',
    empty: 'No hay posiciones disponibles ahora mismo.',
    error: 'No se pudieron cargar las posiciones.',
    season: 'Temporada',
    updated: 'Actualizado',
    columns: { team: 'Equipo', w: 'W', l: 'L', pct: 'PCT', gb: 'GB' },
    meta: { streak: 'Racha', last10: 'Ultimos 10', diff: 'Dif. carreras' },
  },
};

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

function SelectorRail({ items, activeKey, onChange }) {
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        overflowX: 'auto',
        pb: 0.5,
        scrollSnapType: 'x proximity',
        '&::-webkit-scrollbar': { display: 'none' },
        scrollbarWidth: 'none',
      }}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Box
            key={item.key}
            component="button"
            onClick={() => onChange(item.key)}
            sx={{
              flexShrink: 0,
              scrollSnapAlign: 'center',
              px: '14px',
              py: '10px',
              border: `1px solid ${active ? C.cyan : C.border}`,
              bgcolor: active ? C.cyanDim : 'rgba(255,255,255,0.02)',
              color: active ? C.cyan : C.textSecondary,
              fontFamily: BARLOW,
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              minHeight: 42,
            }}
          >
            {item.label}
          </Box>
        );
      })}
    </Box>
  );
}

function TeamRow({ team, rank, copy, selected, onToggle }) {
  return (
    <Box
      component="button"
      onClick={onToggle}
      sx={{
        width: '100%',
        textAlign: 'left',
        border: `1px solid ${selected ? C.cyanLine : C.border}`,
        background: selected ? C.cyanDim : 'rgba(0,0,0,0.26)',
        p: '12px 14px',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) repeat(4, minmax(30px, auto))', gap: 1, alignItems: 'center' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textMuted }}>
          #{rank}
        </Typography>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.86rem', fontWeight: 800, color: C.textPrimary, lineHeight: 1.1 }}>
            {team.abbreviation || team.name}
          </Typography>
          <Typography noWrap sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, mt: 0.2 }}>
            {team.fullName}
          </Typography>
        </Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textPrimary, textAlign: 'center' }}>{team.wins}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textPrimary, textAlign: 'center' }}>{team.losses}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.cyan, textAlign: 'center' }}>{team.pct ?? '-'}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textSecondary, textAlign: 'center' }}>{team.gamesBack ?? '-'}</Typography>
      </Box>

      {selected && (
        <Box sx={{ mt: 1.25, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ px: '8px', py: '4px', border: `1px solid ${C.border}`, bgcolor: 'rgba(255,255,255,0.03)' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted }}>{copy.meta.streak}</Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textPrimary }}>{team.streak || '-'}</Typography>
          </Box>
          <Box sx={{ px: '8px', py: '4px', border: `1px solid ${C.border}`, bgcolor: 'rgba(255,255,255,0.03)' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted }}>{copy.meta.last10}</Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textPrimary }}>{team.last10 || '-'}</Typography>
          </Box>
          <Box sx={{ px: '8px', py: '4px', border: `1px solid ${C.border}`, bgcolor: 'rgba(255,255,255,0.03)' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted }}>{copy.meta.diff}</Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: team.runDiff >= 0 ? C.green : C.red }}>
              {team.runDiff != null ? `${team.runDiff > 0 ? '+' : ''}${team.runDiff}` : '-'}
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default function MLBStandingsPanel({ lang = 'es' }) {
  const copy = COPY[lang] ?? COPY.es;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeLeague, setActiveLeague] = useState('AL');
  const [activeDivision, setActiveDivision] = useState('east');
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

  const leagues = data?.leagues ?? [];
  const leagueOptions = leagues.map((league) => ({ key: league.key, label: league.key }));
  const currentLeague = leagues.find((league) => league.key === activeLeague) ?? leagues[0] ?? null;
  const divisionOptions = (currentLeague?.divisions ?? []).map((division) => ({
    key: division.key,
    label: division.name?.[lang] ?? division.key,
  }));

  useEffect(() => {
    if (!currentLeague) return;
    if (!currentLeague.divisions.some((division) => division.key === activeDivision)) {
      setActiveDivision(currentLeague.divisions[0]?.key ?? 'east');
      setSelectedTeamId(null);
    }
  }, [activeDivision, currentLeague]);

  const currentDivision = useMemo(() => (
    currentLeague?.divisions?.find((division) => division.key === activeDivision) ?? currentLeague?.divisions?.[0] ?? null
  ), [activeDivision, currentLeague]);

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

  if (!currentLeague || !currentDivision) {
    return (
      <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface, p: 2.5 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textMuted }}>
          {copy.empty}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface, p: { xs: 2, sm: 2.5 }, display: 'grid', gap: 2 }}>
      <Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.cyan, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
          {copy.eyebrow}
        </Typography>
        <Typography sx={{ fontFamily: BARLOW, fontSize: { xs: '1.05rem', sm: '1.22rem' }, fontWeight: 800, color: C.textPrimary, textTransform: 'uppercase', letterSpacing: '0.08em', mt: 0.5 }}>
          {copy.title}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textMuted, mt: 0.8, lineHeight: 1.6 }}>
          {copy.subtitle}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
        <Box sx={{ px: '10px', py: '8px', border: `1px solid ${C.border}`, bgcolor: 'rgba(255,255,255,0.02)' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted }}>{copy.season}</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textPrimary }}>{data?.season ?? '-'}</Typography>
        </Box>
        <Box sx={{ px: '10px', py: '8px', border: `1px solid ${C.border}`, bgcolor: 'rgba(255,255,255,0.02)' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted }}>{copy.updated}</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textPrimary }}>{formatUpdated(data?.updatedAt, lang)}</Typography>
        </Box>
      </Box>

      <SelectorRail items={leagueOptions} activeKey={currentLeague.key} onChange={(value) => { setActiveLeague(value); setSelectedTeamId(null); }} />
      <SelectorRail items={divisionOptions} activeKey={currentDivision.key} onChange={(value) => { setActiveDivision(value); setSelectedTeamId(null); }} />

      <Box sx={{ display: 'grid', gap: 1 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '40px minmax(0,1fr) repeat(4, minmax(30px, auto))', gap: 1, px: '14px' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted }}>#</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted }}>{copy.columns.team}</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, textAlign: 'center' }}>{copy.columns.w}</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, textAlign: 'center' }}>{copy.columns.l}</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, textAlign: 'center' }}>{copy.columns.pct}</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, textAlign: 'center' }}>{copy.columns.gb}</Typography>
        </Box>

        {currentDivision.teams.map((team, index) => (
          <TeamRow
            key={team.teamId ?? `${team.abbreviation}-${index}`}
            team={team}
            rank={index + 1}
            copy={copy}
            selected={selectedTeamId === team.teamId}
            onToggle={() => setSelectedTeamId((value) => (value === team.teamId ? null : team.teamId))}
          />
        ))}
      </Box>
    </Box>
  );
}
