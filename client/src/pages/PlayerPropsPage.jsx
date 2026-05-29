import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Button, CircularProgress, MenuItem, Select, FormControl, InputLabel,
  Chip, Collapse, Tooltip,
} from '@mui/material';
import HelpTip from '../components/HelpTip';
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
    playerSearch: 'Player name…',
    showSavant: 'Savant',
    hideSavant: 'Hide Savant',
    player: 'Player',
    market: 'Market',
    line: 'Line',
    odds: 'Odds',
    model: 'Model %',
    implied: 'Implied %',
    edge: 'Edge',
    game: 'Game',
    altLines: 'Alt lines',
    helpHint: 'Hover the ? icons to see what each section means.',
    mlControlLink: 'ML metrics & retrain → /admin/ml-control',
    help: {
      page: 'Daily scouting board for MLB player props. Pulls book lines (Odds API), enriches with Savant, and compares to Python XGBoost when enabled. Your saved Oracle prop picks appear even before books post lines.',
      date: 'Slate date (US Eastern). Loads games and props scheduled for that day.',
      marketFilter: 'Limit rows to one prop type: hits, strikeouts, total bases, HR, or RBI.',
      minEdge: 'Only show lines where |model % − implied %| is at least this value (0–1). Example: 0.05 = 5 points of edge.',
      refresh: 'Reload the board with current filters.',
      calibrating: 'Sidecar has prop models but public scores are gated (MLB_PROPS_ML_PUBLIC_ENABLED). Admins still see model %; everyone else sees lines + Savant only until ~100 resolved picks per market.',
      oracleSection: 'Prop picks already saved from Oracle analysis (single/safe/chat). Not live odds — your recorded recommendation for that game.',
      oracleConfidence: 'Oracle confidence at pick time (%). May differ from Python model % in the table below.',
      gameBlock: 'One MLB game. Table = available book lines matched to players + Savant snapshot.',
      player: 'Player name from the sportsbook prop offer.',
      marketCol: 'Prop market and side (OVER / UNDER).',
      lineCol: 'Book line (e.g. 5.5 strikeouts).',
      oddsCol: 'American odds for that side at snapshot time.',
      implied: 'Implied win probability from the posted odds (no vig removed).',
      model: 'Python XGBoost probability for that side (prop_* model). Empty if ML public gate is off.',
      edge: 'Model % minus implied %. Positive = model likes the bet more than the market price.',
    },
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
    playerSearch: 'Buscar jugador…',
    showSavant: 'Savant',
    hideSavant: 'Ocultar Savant',
    player: 'Jugador',
    market: 'Mercado',
    line: 'Línea',
    odds: 'Odds',
    model: 'Modelo %',
    implied: 'Implícita %',
    edge: 'Edge',
    game: 'Partido',
    altLines: 'Líneas alt.',
    helpHint: 'Pasa el cursor sobre los ? para ver qué significa cada bloque.',
    mlControlLink: 'Métricas ML y reentrenar → /admin/ml-control',
    help: {
      page: 'Tablero diario de player props MLB. Trae líneas de casas (Odds API), enriquece con Savant y compara con XGBoost Python si está activo. Tus picks Oracle guardados aparecen aunque la casa aún no publique la línea.',
      date: 'Fecha del slate (hora Este EE.UU.). Carga partidos y props de ese día.',
      marketFilter: 'Filtra por tipo: hits, ponches, bases totales, HR o RBI.',
      minEdge: 'Solo filas donde |modelo % − implícita %| ≥ este valor (0–1). Ej.: 0.05 = 5 puntos de edge.',
      refresh: 'Vuelve a cargar el tablero con los filtros actuales.',
      calibrating: 'El sidecar tiene modelos prop pero los scores públicos están con gate (MLB_PROPS_ML_PUBLIC_ENABLED). Admin ve modelo %; el resto ve líneas + Savant hasta ~100 picks resueltos por mercado.',
      oracleSection: 'Props ya guardados desde análisis Oracle (single/safe/chat). No son odds en vivo — tu recomendación registrada para ese partido.',
      oracleConfidence: 'Confianza Oracle al momento del pick (%). Puede diferir del % del modelo Python en la tabla.',
      gameBlock: 'Un partido MLB. La tabla = líneas de casa con jugador + snapshot Savant.',
      player: 'Nombre del jugador según la oferta de la casa.',
      marketCol: 'Mercado de prop y lado (OVER / UNDER).',
      lineCol: 'Línea de la casa (ej. 5.5 ponches).',
      oddsCol: 'Odds americanas de ese lado al momento del snapshot.',
      implied: 'Probabilidad implícita desde la cuota publicada (sin quitar vig).',
      model: 'Probabilidad del XGBoost Python para ese lado (modelo prop_*). Vacío si el gate público ML está apagado.',
      edge: 'Modelo % menos implícita %. Positivo = el modelo valora más la apuesta que el precio del mercado.',
    },
  },
};

function SectionHeading({ title, subtitle, help }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.25 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: CYAN, letterSpacing: '2px' }}>
          {title}
        </Typography>
        <HelpTip title={help} />
      </Box>
      {subtitle ? (
        <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 0.5 }}>
          {subtitle}
        </Typography>
      ) : null}
    </Box>
  );
}

function ThLabel({ label, help }) {
  return (
    <th style={{ padding: '6px 8px' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
        {label}
        <HelpTip title={help} />
      </span>
    </th>
  );
}

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
  const T = { ...(STRINGS[lang] ?? STRINGS.es), lang };
  const H = T.help ?? {};
  const KL = KIND_LABELS[lang] ?? KIND_LABELS.es;

  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
  );
  const [propKind, setPropKind] = useState('');
  const [minEdge, setMinEdge] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');
  const [showSavant, setShowSavant] = useState(false);
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

  const filteredGames = useMemo(() => {
    if (!board?.games) return [];
    const needle = playerSearch.trim().toLowerCase();
    if (!needle) return board.games;
    return board.games
      .map((g) => ({
        ...g,
        props: g.props.filter((p) => (p.playerName ?? '').toLowerCase().includes(needle)),
      }))
      .filter((g) => g.props.length > 0);
  }, [board, playerSearch]);

  return (
    <Box sx={{ minHeight: '100vh', background: BG, color: INK0, p: { xs: 1.5, md: 3 } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onBack} sx={{ color: CYAN, fontFamily: MONO, fontSize: '10px', border: `1px solid ${BORDER}` }}>
          {T.back}
        </Button>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography sx={{ fontFamily: BARLOW, fontWeight: 700, fontSize: '1.25rem', color: CYAN }}>
            {T.title}
          </Typography>
          <HelpTip title={H.page} />
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ background: SURF, color: INK0, border: `1px solid ${BORDER}`, padding: '8px', fontFamily: MONO }}
          />
          <HelpTip title={H.date} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
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
          <HelpTip title={H.marketFilter} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
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
          <HelpTip title={H.minEdge} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <input
            type="text"
            placeholder={T.playerSearch}
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            style={{ background: SURF, color: INK0, border: `1px solid ${BORDER}`, padding: '8px', width: 160, fontFamily: MONO, fontSize: '11px' }}
          />
        </Box>
        <Button
          onClick={() => setShowSavant((v) => !v)}
          size="small"
          sx={{ color: showSavant ? CYAN : MUTED, fontFamily: MONO, fontSize: '10px', border: `1px solid ${showSavant ? CYAN : BORDER}` }}
        >
          {showSavant ? T.hideSavant : T.showSavant}
        </Button>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Button onClick={load} sx={{ color: CYAN, fontFamily: MONO, border: `1px solid ${CYAN}` }}>
            ↻
          </Button>
          <HelpTip title={H.refresh} />
        </Box>
      </Box>

      {board && !board.mlPublic && board.mlEnabled && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, flex: 1 }}>
            {T.calibrating}
          </Typography>
          <HelpTip title={H.calibrating} />
        </Box>
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
          <SectionHeading
            title={T.oracleSection}
            subtitle={T.oracleSource}
            help={H.oracleSection}
          />
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
                  {p.confidence != null ? (
                    <>
                      {' · '}
                      {p.confidence}%
                      <HelpTip title={H.oracleConfidence} />
                    </>
                  ) : null}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {!loading && filteredGames.map((g) => (
        <Box key={g.gamePk} sx={{ mb: 3, background: SURF, border: `1px solid ${BORDER}`, p: 2 }}>
          <SectionHeading
            title={`${T.game}: ${g.awayTeam} @ ${g.homeTeam}${g.startTime ? ` · ${g.startTime}` : ''}`}
            help={H.gameBlock}
          />
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: '10px' }}>
              <thead>
                <tr style={{ color: MUTED, textAlign: 'left' }}>
                  <ThLabel label={T.player} help={H.player} />
                  <ThLabel label={T.market} help={H.marketCol} />
                  <ThLabel label={T.line} help={H.lineCol} />
                  <ThLabel label={T.odds} help={H.oddsCol} />
                  <ThLabel label={T.implied} help={H.implied} />
                  <ThLabel label={T.model} help={H.model} />
                  <ThLabel label={T.edge} help={H.edge} />
                  {showSavant && <th style={{ padding: '6px 8px', color: MUTED }}>xBA / xSLG</th>}
                  {showSavant && <th style={{ padding: '6px 8px', color: MUTED }}>wOBA 7d</th>}
                </tr>
              </thead>
              <tbody>
                {g.props.map((p, idx) => {
                  const edgeColor = p.edge == null ? MUTED : p.edge > 0 ? GREEN : RED;
                  return (
                    <tr key={`${p.playerName}-${p.propKind}-${p.side}-${p.line}-${idx}`} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '8px' }}>
                        <span>{p.playerName}</span>
                        {board?.mlEnabled && (
                          <Chip
                            label={board.mlPublic ? board.mlPublic : ''}
                            size="small"
                            sx={{ ml: 0.5, display: 'none' }}
                          />
                        )}
                      </td>
                      <td>{KL[p.propKind] ?? p.propKind} {p.side?.toUpperCase()}</td>
                      <td>{p.line}</td>
                      <td>{p.oddsAmerican > 0 ? `+${p.oddsAmerican}` : p.oddsAmerican}</td>
                      <td>{fmtPct(p.impliedProb)}</td>
                      <td style={{ color: p.modelProb != null ? CYAN : MUTED }}>{fmtPct(p.modelProb)}</td>
                      <td style={{ color: edgeColor, fontWeight: 700 }}>{fmtEdge(p.edge)}</td>
                      {showSavant && (
                        <td style={{ color: MUTED }}>
                          {p.savant?.xba != null ? p.savant.xba.toFixed(3) : '—'}
                          {' / '}
                          {p.savant?.xslg != null ? p.savant.xslg.toFixed(3) : '—'}
                        </td>
                      )}
                      {showSavant && (
                        <td style={{ color: MUTED }}>
                          {p.savant?.rolling7d != null ? p.savant.rolling7d.toFixed(3) : '—'}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        </Box>
      ))}

      <Box sx={{ mt: 4, textAlign: 'center' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '1px' }}>
          {T.helpHint}
        </Typography>
        <Typography
          component="a"
          href="/admin/ml-control"
          sx={{
            fontFamily: MONO,
            fontSize: '9px',
            color: CYAN,
            display: 'inline-block',
            mt: 0.75,
            textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          {T.mlControlLink}
        </Typography>
      </Box>
    </Box>
  );
}
