import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, CircularProgress, MenuItem, Select, FormControl, InputLabel,
} from '@mui/material';
import { MONO, BARLOW } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const BG = 'var(--bg-0)';
const SURF = 'var(--bg-1)';
const BORDER = 'var(--border)';
const CYAN = 'var(--neon-cyan)';
const GREEN = 'var(--neon-green)';
const RED = 'var(--neon-pink)';
const MUTED = 'var(--ink-2)';
const INK0 = 'var(--ink-0)';

const STRINGS = {
  en: {
    title: 'Player Props Board',
    back: '← BACK',
    loading: 'Loading props…',
    noData: 'No prop lines available for this date.',
    oracleSection: 'Oracle picks (saved)',
    oracleSource: 'From your analysis — odds lines may not be posted yet.',
    calibrating: 'ML scores in calibration — lines and Savant stats still shown.',
    filters: 'Filters',
    allKinds: 'All markets',
    minEdge: 'Min |edge|',
    player: 'Player',
    market: 'Market',
    line: 'Line',
    odds: 'Odds',
    model: 'Model %',
    implied: 'Implied %',
    edge: 'Edge',
    game: 'Game',
  },
  es: {
    title: 'Tablero de Player Props',
    back: '← VOLVER',
    loading: 'Cargando props…',
    noData: 'No hay líneas de props para esta fecha.',
    oracleSection: 'Picks Oracle (guardados)',
    oracleSource: 'De tu análisis — las líneas de la casa pueden no estar publicadas aún.',
    calibrating: 'Scores ML en calibración — líneas y Savant visibles.',
    filters: 'Filtros',
    allKinds: 'Todos los mercados',
    minEdge: 'Edge mín. |edge|',
    player: 'Jugador',
    market: 'Mercado',
    line: 'Línea',
    odds: 'Odds',
    model: 'Modelo %',
    implied: 'Implícita %',
    edge: 'Edge',
    game: 'Partido',
  },
};

const KIND_LABELS = {
  en: {
    hits: 'Hits', total_bases: 'Total Bases', strikeouts: 'Strikeouts',
    home_runs: 'HR', rbis: 'RBI',
  },
  es: {
    hits: 'Hits', total_bases: 'Bases Totales', strikeouts: 'Ponches',
    home_runs: 'HR', rbis: 'RBI',
  },
};

function fmtPct(v) {
  if (v == null) return '—';
  return `${(Number(v) * 100).toFixed(1)}%`;
}

function fmtEdge(v) {
  if (v == null) return '—';
  const pct = (Number(v) * 100).toFixed(1);
  return v > 0 ? `+${pct}%` : `${pct}%`;
}

export default function PlayerPropsPage({ token, onBack, lang = 'es' }) {
  const T = STRINGS[lang] ?? STRINGS.es;
  const KL = KIND_LABELS[lang] ?? KIND_LABELS.es;

  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
  );
  const [propKind, setPropKind] = useState('');
  const [minEdge, setMinEdge] = useState('');
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date });
      if (propKind) params.set('propKind', propKind);
      if (minEdge) params.set('minEdge', minEdge);
      const res = await fetch(`${API_URL}/api/mlb/props/board?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setBoard(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, date, propKind, minEdge]);

  useEffect(() => { load(); }, [load]);

  return (
    <Box sx={{ minHeight: '100vh', background: BG, color: INK0, p: { xs: 1.5, md: 3 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onBack} sx={{ color: CYAN, fontFamily: MONO, fontSize: '10px', border: `1px solid ${BORDER}` }}>
          {T.back}
        </Button>
        <Typography sx={{ fontFamily: BARLOW, fontWeight: 700, fontSize: '1.25rem', color: CYAN }}>
          {T.title}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ background: SURF, color: INK0, border: `1px solid ${BORDER}`, padding: '8px', fontFamily: MONO }}
        />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED }}>{T.market}</InputLabel>
          <Select
            value={propKind}
            label={T.market}
            onChange={(e) => setPropKind(e.target.value)}
            sx={{ fontFamily: MONO, fontSize: '11px', color: INK0, border: `1px solid ${BORDER}` }}
          >
            <MenuItem value="">{T.allKinds}</MenuItem>
            {Object.keys(KL).map((k) => (
              <MenuItem key={k} value={k}>{KL[k]}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <input
          type="number"
          step="0.01"
          min="0"
          max="1"
          placeholder={T.minEdge}
          value={minEdge}
          onChange={(e) => setMinEdge(e.target.value)}
          style={{ background: SURF, color: INK0, border: `1px solid ${BORDER}`, padding: '8px', width: 120, fontFamily: MONO }}
        />
        <Button onClick={load} sx={{ color: CYAN, fontFamily: MONO, border: `1px solid ${CYAN}` }}>
          ↻
        </Button>
      </Box>

      {board && !board.mlPublic && board.mlEnabled && (
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, mb: 2 }}>
          {T.calibrating}
        </Typography>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={28} sx={{ color: CYAN }} />
        </Box>
      )}

      {error && (
        <Typography sx={{ color: RED, fontFamily: MONO, fontSize: '11px' }}>{error}</Typography>
      )}

      {!loading && !error && (board?.games?.length ?? 0) === 0 && (board?.oraclePropPicks?.length ?? 0) === 0 && (
        <Typography sx={{ fontFamily: MONO, color: MUTED }}>{T.noData}</Typography>
      )}

      {!loading && (board?.oraclePropPicks?.length ?? 0) > 0 && (
        <Box sx={{ mb: 3, background: SURF, border: `1px solid ${CYAN}`, p: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: CYAN, mb: 0.5, letterSpacing: '2px' }}>
            {T.oracleSection}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mb: 1.5 }}>
            {T.oracleSource}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {board.oraclePropPicks.map((p) => (
              <Box
                key={p.pickId}
                sx={{
                  border: `1px solid ${BORDER}`,
                  borderLeft: `3px solid ${CYAN}`,
                  p: '10px 12px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 1,
                  alignItems: 'center',
                }}
              >
                <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: INK0, fontWeight: 700 }}>
                  {p.pick}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED }}>
                  {p.matchup} · {KL[p.propKind] ?? p.propKind} {p.side?.toUpperCase()} {p.line}
                  {p.confidence != null ? ` · ${p.confidence}%` : ''}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {!loading && board?.games?.map((g) => (
        <Box key={g.gamePk} sx={{ mb: 3, background: SURF, border: `1px solid ${BORDER}`, p: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: CYAN, mb: 1.5, letterSpacing: '2px' }}>
            {T.game}: {g.awayTeam} @ {g.homeTeam}
            {g.startTime ? ` · ${g.startTime}` : ''}
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: '10px' }}>
              <thead>
                <tr style={{ color: MUTED, textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>{T.player}</th>
                  <th>{T.market}</th>
                  <th>{T.line}</th>
                  <th>{T.odds}</th>
                  <th>{T.implied}</th>
                  <th>{T.model}</th>
                  <th>{T.edge}</th>
                </tr>
              </thead>
              <tbody>
                {g.props.map((p, idx) => {
                  const edgeColor = p.edge == null ? MUTED : p.edge > 0 ? GREEN : RED;
                  return (
                    <tr key={`${p.playerName}-${p.propKind}-${p.side}-${p.line}-${idx}`} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '8px' }}>{p.playerName}</td>
                      <td>{KL[p.propKind] ?? p.propKind} {p.side?.toUpperCase()}</td>
                      <td>{p.line}</td>
                      <td>{p.oddsAmerican > 0 ? `+${p.oddsAmerican}` : p.oddsAmerican}</td>
                      <td>{fmtPct(p.impliedProb)}</td>
                      <td>{fmtPct(p.modelProb)}</td>
                      <td style={{ color: edgeColor, fontWeight: 700 }}>{fmtEdge(p.edge)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
