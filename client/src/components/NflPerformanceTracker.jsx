import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../store/authStore';
import { BARLOW, MONO } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const colors = { green: '#59d8ad', amber: '#f3bf72', red: '#ff8585', muted: '#a6b7c9', cyan: '#7ed9f2' };
const pct = value => value == null ? '—' : `${(Number(value) * 100).toFixed(1)}%`;
const money = value => Number(value ?? 0).toFixed(2);

function Metric({ label, value, detail, color = colors.cyan }) {
  return <Box sx={{ p: 1.5, border: '1px solid #38546c', bgcolor: '#142132', minWidth: 0 }}>
    <Typography sx={{ fontFamily: MONO, fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</Typography>
    <Typography sx={{ fontFamily: BARLOW, fontSize: 27, fontWeight: 800, color, lineHeight: 1.3 }}>{value}</Typography>
    {detail && <Typography sx={{ fontFamily: MONO, fontSize: 10, color: colors.muted }}>{detail}</Typography>}
  </Box>;
}

function PnlPath({ bets, lang }) {
  const points = useMemo(() => {
    const settled = bets.filter(b => b.result != null && Number.isFinite(Number(b.pnl)))
      .sort((a, b) => Date.parse(a.settled_at) - Date.parse(b.settled_at));
    let sum = 0;
    return [0, ...settled.map(b => (sum += Number(b.pnl)))];
  }, [bets]);
  if (points.length < 2) return <Typography sx={{ fontSize: 12, color: colors.muted }}>
    {lang === 'es' ? 'La curva aparece cuando haya tickets liquidados.' : 'The curve appears after tickets settle.'}
  </Typography>;
  const min = Math.min(...points), max = Math.max(...points);
  const span = Math.max(1, max - min);
  const coords = points.map((p, i) => `${(i / (points.length - 1) * 100).toFixed(2)},${(48 - (p - min) / span * 42).toFixed(2)}`).join(' ');
  const zero = 48 - (0 - min) / span * 42;
  return <Box>
    <svg role="img" aria-label={lang === 'es' ? 'Evolución del beneficio liquidado' : 'Settled profit progression'}
      viewBox="0 0 100 54" preserveAspectRatio="none" style={{ width: '100%', height: 110, display: 'block' }}>
      {zero >= 0 && zero <= 54 && <line x1="0" x2="100" y1={zero} y2={zero} stroke="#4a6075" strokeDasharray="2 2" strokeWidth="0.5" />}
      <polyline points={coords} fill="none" stroke={points.at(-1) >= 0 ? colors.green : colors.red} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
    <Typography sx={{ fontFamily: MONO, fontSize: 10, color: colors.muted }}>
      {lang === 'es' ? 'P/L acumulado de tickets liquidados' : 'Cumulative P/L from settled tickets'} · {money(points.at(-1))}
    </Typography>
  </Box>;
}

export default function NflPerformanceTracker({ lang = 'es' }) {
  const { token } = useAuth();
  const [bets, setBets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [recent, setRecent] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const spanish = lang === 'es';

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [betsResponse, performanceResponse] = await Promise.all([
        fetch(`${API_URL}/api/nfl/bets`, { headers }),
        fetch(`${API_URL}/api/nfl/performance`, { headers }),
      ]);
      const [b, p] = await Promise.all([betsResponse.json(), performanceResponse.json()]);
      if (!betsResponse.ok || !b.success) throw new Error(b.error || 'NFL ticket history unavailable');
      if (!performanceResponse.ok || !p.success) throw new Error(p.error || 'NFL decision history unavailable');
      setBets(b.bets ?? []);
      setSummary(b.summary);
      setPerformance(p.summary);
      setRecent(p.recent ?? []);
      setTruncated(Boolean(b.truncated || p.truncated));
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);
  const filtered = recent.filter(row => filter === 'all' || row.decision === filter);
  const clv = bets.filter(b => b.clv != null);
  const positiveClv = clv.filter(b => Number(b.clv) > 0).length;
  const counts = performance?.decisionCounts ?? { BET: 0, WATCH: 0, NO_BET: 0 };
  const total = performance?.evaluatedQuotes ?? 0;

  return <Box sx={{ p: { xs: 2, md: 3 }, border: '1px solid #38546c', bgcolor: '#0d1724', color: '#e8edf4', display: 'grid', gap: 2.2 }}>
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <Box>
        <Typography sx={{ fontFamily: MONO, color: colors.cyan, fontSize: 11, letterSpacing: 2 }}>NFL · BET365</Typography>
        <Typography sx={{ fontFamily: BARLOW, fontSize: { xs: 24, md: 31 }, fontWeight: 800 }}>
          {spanish ? 'Centro de seguimiento' : 'Tracking center'}
        </Typography>
        <Typography sx={{ fontSize: 12, color: colors.muted }}>
          {spanish ? 'Decisiones evaluadas, tickets colocados y resultados reales son registros distintos.'
            : 'Evaluated decisions, placed tickets, and real outcomes are separate records.'}
        </Typography>
      </Box>
      <button type="button" onClick={refresh} disabled={loading || !token} style={{ color: '#fff', background: '#284866', border: 0, padding: '9px 13px', cursor: 'pointer' }}>
        {loading ? '...' : spanish ? 'Actualizar' : 'Refresh'}
      </button>
    </Box>
    {error && <Typography role="alert" sx={{ color: colors.red, fontSize: 12 }}>{error}</Typography>}
    {!error && !performance && <Typography sx={{ color: colors.muted, fontSize: 12 }}>
      {loading ? (spanish ? 'Cargando seguimiento...' : 'Loading tracking...') : (spanish ? 'Sin datos todavía.' : 'No data yet.')}
    </Typography>}
    {performance && <>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', md: 'repeat(5,minmax(0,1fr))' }, gap: 1 }}>
        <Metric label={spanish ? 'Cuotas evaluadas' : 'Quotes evaluated'} value={total} detail={spanish ? 'Incluye no apostar' : 'Includes no bet'} />
        <Metric label="BET / WATCH / NO BET" value={`${counts.BET} / ${counts.WATCH} / ${counts.NO_BET}`} detail={spanish ? 'Decisiones, no tickets' : 'Decisions, not tickets'} color={colors.amber} />
        <Metric label={spanish ? 'Tickets liquidados' : 'Settled tickets'} value={summary?.settled ?? 0} detail={`${summary?.pending ?? 0} ${spanish ? 'pendientes' : 'pending'}`} />
        <Metric label="ROI" value={pct(summary?.roi)} detail={spanish ? 'Solo importe liquidado' : 'Settled stake only'} color={summary?.roi >= 0 ? colors.green : colors.red} />
        <Metric label="P/L" value={money(summary?.pnl)} detail={spanish ? 'Ganancia / pérdida real' : 'Realized profit / loss'} color={summary?.pnl >= 0 ? colors.green : colors.red} />
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' }, gap: 1.5 }}>
        <Box sx={{ p: 1.6, bgcolor: '#142132', border: '1px solid #38546c' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: colors.cyan, mb: 1 }}>{spanish ? 'RESULTADO REAL' : 'REALIZED RESULT'}</Typography>
          <PnlPath bets={bets} lang={lang} />
          <Typography sx={{ fontSize: 11, color: colors.muted, mt: 1 }}>
            CLV {spanish ? 'positivo' : 'positive'}: {clv.length ? `${positiveClv}/${clv.length}` : '—'}
            {' · '}{spanish ? 'Solo tickets con cierre comparable' : 'Only tickets with comparable close'}
          </Typography>
        </Box>
        <Box sx={{ p: 1.6, bgcolor: '#142132', border: '1px solid #38546c' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: colors.cyan, mb: 1 }}>{spanish ? 'CALIBRACIÓN POR MERCADO' : 'CALIBRATION BY MARKET'}</Typography>
          {Object.entries(performance.calibrationByMarket ?? {}).length === 0
            ? <Typography sx={{ fontSize: 12, color: colors.muted }}>{spanish ? 'Sin resultados suficientes aún.' : 'No graded results yet.'}</Typography>
            : Object.entries(performance.calibrationByMarket).map(([market, row]) => <Box key={market} sx={{ display: 'flex', justifyContent: 'space-between', py: .6, borderBottom: '1px solid #314359', fontFamily: MONO, fontSize: 12 }}>
              <span>{market}</span><span>Brier {Number(row.brier).toFixed(4)} · N={row.n} · {spanish ? 'certificados' : 'certified'} {row.certifiedN}</span>
            </Box>)}
          <Typography sx={{ fontSize: 10, color: colors.muted, mt: 1 }}>
            {spanish ? 'Primera cuota por partido y mercado; pushes excluidos. No equivale a rentabilidad.'
              : 'First quote per game and market; pushes excluded. This is not profitability.'}
          </Typography>
        </Box>
      </Box>
      <Box>
        <Typography sx={{ fontFamily: MONO, fontSize: 11, color: colors.cyan, mb: 1 }}>{spanish ? 'DECISIONES RECIENTES' : 'RECENT DECISIONS'}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          {['all', 'BET', 'WATCH', 'NO_BET'].map(option => <button key={option} type="button" onClick={() => setFilter(option)} aria-pressed={filter === option}
            style={{ padding: '5px 9px', border: `1px solid ${filter === option ? colors.cyan : '#38546c'}`, background: filter === option ? '#1b3448' : '#142132', color: '#e8edf4', cursor: 'pointer' }}>
            {option === 'all' ? (spanish ? 'Todas' : 'All') : option}
          </button>)}
        </Box>
        <Box sx={{ maxHeight: 255, overflow: 'auto', display: 'grid', gap: .5 }}>
          {filtered.length === 0 && <Typography sx={{ color: colors.muted, fontSize: 12 }}>{spanish ? 'Sin decisiones en esta vista.' : 'No decisions in this view.'}</Typography>}
          {filtered.map(row => <Box key={row.id} sx={{ p: 1, bgcolor: '#142132', display: 'flex', flexWrap: 'wrap', gap: 1.2, alignItems: 'center', justifyContent: 'space-between', fontFamily: MONO, fontSize: 11 }}>
            <span>#{row.game_pk} · {row.market} {row.side} {row.line == null ? '' : row.line} @ {Number(row.decimal_odds).toFixed(2)}</span>
            <span style={{ color: row.decision === 'BET' ? colors.green : row.decision === 'WATCH' ? colors.amber : colors.muted }}>{row.decision}</span>
            <span>{row.result ?? (spanish ? 'pendiente' : 'pending')}{row.bet_id ? ` · ticket #${row.bet_id}` : ''}</span>
          </Box>)}
        </Box>
        {truncated && <Typography sx={{ color: colors.amber, fontSize: 10, mt: 1 }}>
          {spanish ? 'Vista limitada a los registros más recientes; los totales de esta vista pueden estar truncados.' : 'Showing recent records only; totals in this view may be truncated.'}
        </Typography>}
      </Box>
    </>}
  </Box>;
}
