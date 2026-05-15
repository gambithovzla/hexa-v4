/**
 * EquityDashboard.jsx — H.E.X.A. V4 Admin
 *
 * Equity curve, drawdown, Sharpe ratio and monthly P&L breakdown.
 * Admin-only. Route: /admin/equity
 *
 * Props:
 *   token  {string}   — JWT
 *   onBack {Function} — navigate back
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import {
  ComposedChart, AreaChart, Area, Bar, BarChart, Line,
  XAxis, YAxis, ReferenceLine,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { C, MONO, BARLOW } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Design tokens ──────────────────────────────────────────────────────────────
const BG     = '#07090E';
const SURF   = '#0c0f1a';
const BORDER = 'rgba(0,229,255,0.15)';
const CYAN   = '#00E5FF';
const GREEN  = '#00FF88';
const RED    = '#FF2244';
const AMBER  = '#FF9900';
const MUTED  = 'rgba(0,229,255,0.4)';
const DIM    = 'rgba(0,229,255,0.08)';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n, decimals = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}

function fmtPct(n) {
  if (n == null) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function fmtUnits(n) {
  if (n == null) return '—';
  const v = Number(n);
  return (v >= 0 ? '+' : '') + v.toFixed(2) + 'u';
}

function shortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color = CYAN, sub, small }) {
  return (
    <Box sx={{
      flex:         1,
      minWidth:     '130px',
      background:   SURF,
      border:       `1px solid ${BORDER}`,
      p:            '16px 14px',
      position:     'relative',
      overflow:     'hidden',
    }}>
      <Box sx={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '2px',
        background: color, opacity: 0.5,
      }} />
      <Typography sx={{
        fontFamily:    MONO, fontSize: '0.58rem', color: MUTED,
        letterSpacing: '0.18em', textTransform: 'uppercase', mb: '6px',
      }}>
        {label}
      </Typography>
      <Typography sx={{
        fontFamily:  BARLOW, fontSize: small ? '1.2rem' : '1.6rem',
        fontWeight:  800, color, lineHeight: 1,
      }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: MUTED, mt: '4px' }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}

function SectionHeader({ children }) {
  return (
    <Typography sx={{
      fontFamily:    MONO, fontSize: '0.6rem', color: MUTED,
      letterSpacing: '0.2em', textTransform: 'uppercase',
      mb: '12px', display: 'flex', alignItems: 'center', gap: '6px',
    }}>
      <span style={{ color: CYAN, opacity: 0.6 }}>{'// '}</span>
      {children}
    </Typography>
  );
}

function SportTab({ value, active, onClick }) {
  return (
    <Box
      component="button"
      onClick={() => onClick(value)}
      sx={{
        px: '14px', py: '5px',
        bgcolor:       active ? CYAN : 'transparent',
        color:         active ? '#0a0d14' : MUTED,
        border:        `1px solid ${active ? CYAN : BORDER}`,
        fontFamily:    MONO, fontSize: '0.62rem', fontWeight: 700,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        cursor:        'pointer', transition: 'all 0.15s',
        '&:hover':     !active ? { color: CYAN } : {},
      }}
    >
      {value.toUpperCase()}
    </Box>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────
function EquityTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <Box sx={{ bgcolor: '#0a0d14', border: `1px solid ${BORDER}`, p: '10px 12px', minWidth: '160px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: MUTED, mb: '4px' }}>
        {shortDate(d.date)}
      </Typography>
      {d.pick && (
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.72rem', color: '#eee', mb: '4px' }} noWrap>
          {d.pick}
        </Typography>
      )}
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: d.result === 'win' ? GREEN : d.result === 'loss' ? RED : AMBER }}>
        {d.result?.toUpperCase()} {d.units != null ? (d.units >= 0 ? `+${d.units}u` : `${d.units}u`) : ''}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: CYAN, mt: '2px' }}>
        Cum: {fmtUnits(d.cumUnits)}
      </Typography>
    </Box>
  );
}

function DrawdownTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <Box sx={{ bgcolor: '#0a0d14', border: `1px solid ${BORDER}`, p: '8px 12px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: MUTED }}>{shortDate(d.date)}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: RED }}>
        DD: {d.drawdown >= 0 ? '0.00u' : `${d.drawdown}u`}
      </Typography>
    </Box>
  );
}

// ── Monthly table ──────────────────────────────────────────────────────────────
function MonthlyTable({ monthly }) {
  if (!monthly?.length) return (
    <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: MUTED, py: '12px' }}>
      No monthly data available.
    </Typography>
  );

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: '0.68rem' }}>
        <Box component="thead">
          <Box component="tr">
            {['Month', 'Picks', 'W', 'L', 'P', 'Win%', 'Units', 'ROI'].map(h => (
              <Box key={h} component="th" sx={{
                color: MUTED, letterSpacing: '0.12em', textTransform: 'uppercase',
                textAlign: h === 'Month' ? 'left' : 'right',
                pb: '8px', pr: '12px', fontWeight: 400, whiteSpace: 'nowrap',
              }}>
                {h}
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {monthly.map(m => {
            const unitColor = m.units > 0 ? GREEN : m.units < 0 ? RED : MUTED;
            return (
              <Box key={m.month} component="tr" sx={{
                borderTop: `1px solid ${BORDER}`,
                '&:hover': { bgcolor: DIM },
              }}>
                <Box component="td" sx={{ color: CYAN, py: '7px', pr: '12px' }}>{m.month}</Box>
                <Box component="td" sx={{ color: '#ccc', textAlign: 'right', pr: '12px' }}>{m.picks}</Box>
                <Box component="td" sx={{ color: GREEN, textAlign: 'right', pr: '12px' }}>{m.wins}</Box>
                <Box component="td" sx={{ color: RED,   textAlign: 'right', pr: '12px' }}>{m.losses}</Box>
                <Box component="td" sx={{ color: AMBER, textAlign: 'right', pr: '12px' }}>{m.pushes}</Box>
                <Box component="td" sx={{ color: '#ccc', textAlign: 'right', pr: '12px' }}>{fmtPct(m.winRate)}</Box>
                <Box component="td" sx={{ color: unitColor, textAlign: 'right', pr: '12px', fontWeight: 700 }}>
                  {m.units >= 0 ? '+' : ''}{fmt(m.units, 2)}u
                </Box>
                <Box component="td" sx={{ color: unitColor, textAlign: 'right', fontWeight: 700 }}>
                  {fmtPct(m.roi)}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

// ── Sport breakdown cards ──────────────────────────────────────────────────────
function SportBreakdown({ bySport }) {
  if (!bySport || Object.keys(bySport).length === 0) return null;
  return (
    <Box sx={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      {Object.entries(bySport).map(([sp, s]) => (
        <Box key={sp} sx={{
          flex: 1, minWidth: '160px',
          background: SURF, border: `1px solid ${BORDER}`, p: '14px',
        }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: CYAN, letterSpacing: '0.2em', textTransform: 'uppercase', mb: '8px', fontWeight: 700 }}>
            {sp}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {[
              { label: 'Picks',   value: s.picks },
              { label: 'Record',  value: `${s.wins}W-${s.losses}L-${s.pushes}P` },
              { label: 'Win%',    value: fmtPct(s.winRate) },
              { label: 'Units',   value: fmtUnits(s.units), color: s.units >= 0 ? GREEN : RED },
              { label: 'ROI',     value: fmtPct(s.roi),    color: s.roi >= 0 ? GREEN : RED },
            ].map(({ label, value, color }) => (
              <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: MUTED }}>{label}</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: color ?? '#ccc', fontWeight: 600 }}>{value}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

// ── Monte Carlo: forward bankroll simulation ──────────────────────────────────

function fmtUsd(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 10_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function FanTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <Box sx={{ bgcolor: '#0a0d14', border: `1px solid ${BORDER}`, p: '10px 12px', minWidth: '160px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: MUTED, mb: '4px' }}>
        Pick #{d.t}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: GREEN }}>P90: {fmtUsd(d.p90)}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: CYAN }}>P75: {fmtUsd(d.p75)}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: '#fff', fontWeight: 700 }}>P50: {fmtUsd(d.p50)}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: AMBER }}>P25: {fmtUsd(d.p25)}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: RED }}>P10: {fmtUsd(d.p10)}</Typography>
    </Box>
  );
}

function MonteCarloPanel({ token, sport, startDate, endDate, sampleSize }) {
  const [horizon,       setHorizon]       = useState(162);
  const [nSims,         setNSims]         = useState(5_000);
  const [bankroll,      setBankroll]      = useState(1_000);
  const [strategy,      setStrategy]      = useState('flat');
  const [flatStake,     setFlatStake]     = useState(10);
  const [percentStake,  setPercentStake]  = useState(2);
  const [result,        setResult]        = useState(null);
  const [running,       setRunning]       = useState(false);
  const [error,         setError]         = useState(null);
  const [durationMs,    setDurationMs]    = useState(null);

  const canRun = (sampleSize ?? 0) >= 10;

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const body = {
        sport, startDate, endDate,
        horizonPicks:     horizon,
        nSims,
        startingBankroll: bankroll,
        stakeStrategy:    strategy,
        flatStake:        Number(flatStake),
        percentStake:     Number(percentStake) / 100,
      };
      const res = await fetch(`${API_URL}/api/admin/ml/equity/simulate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed');
      setResult(json.data);
      setDurationMs(json.duration_ms ?? null);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }, [token, sport, startDate, endDate, horizon, nSims, bankroll, strategy, flatStake, percentStake]);

  const fanData = useMemo(() => {
    if (!result) return [];
    return result.percentiles.map((p) => ({ ...p }));
  }, [result]);

  const histData = useMemo(() => {
    if (!result) return [];
    return result.histogram.map((h) => ({
      x:      Math.round((h.binStart + h.binEnd) / 2),
      count:  h.count,
    }));
  }, [result]);

  const controlInput = {
    background:   '#0a0d14',
    border:       `1px solid ${BORDER}`,
    color:        '#ccc',
    fontFamily:   MONO,
    fontSize:     '0.72rem',
    padding:      '5px 8px',
    outline:      'none',
    width:        '90px',
    borderRadius: '2px',
  };
  const controlLabel = { fontFamily: MONO, fontSize: '0.58rem', color: MUTED, letterSpacing: '0.16em', textTransform: 'uppercase' };

  const s = result?.summary;

  return (
    <Box sx={{ background: SURF, border: `1px solid ${BORDER}`, p: '20px', mb: '24px' }}>
      <SectionHeader>Monte Carlo — Forward Bankroll Simulation</SectionHeader>

      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: '#bbb', mb: '14px', lineHeight: 1.55, maxWidth: '720px' }}>
        Bootstraps {sampleSize ?? '—'} resolved pick outcomes from the current filter, then projects{' '}
        <span style={{ color: CYAN }}>{nSims.toLocaleString()}</span> alternative futures over{' '}
        <span style={{ color: CYAN }}>{horizon}</span> picks. P10/P50/P90 = pessimistic/typical/optimistic band.
        Past edge assumed to persist — not a true forecast.
      </Typography>

      {/* Controls */}
      <Box sx={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'flex-end', mb: '16px' }}>
        <Box>
          <Box sx={controlLabel}>Horizon (picks)</Box>
          <input type="number" min={10} max={2000} step={10} value={horizon}
            onChange={(e) => setHorizon(Math.max(10, Math.min(2000, Number(e.target.value) || 0)))}
            style={controlInput} />
        </Box>
        <Box>
          <Box sx={controlLabel}>Simulations</Box>
          <Box component="select" value={nSims} onChange={(e) => setNSims(Number(e.target.value))}
            sx={{ ...controlInput, width: '110px' }}>
            <option value={1_000}>1,000</option>
            <option value={5_000}>5,000</option>
            <option value={10_000}>10,000</option>
            <option value={25_000}>25,000</option>
          </Box>
        </Box>
        <Box>
          <Box sx={controlLabel}>Bankroll (USD)</Box>
          <input type="number" min={100} step={100} value={bankroll}
            onChange={(e) => setBankroll(Math.max(100, Number(e.target.value) || 100))}
            style={controlInput} />
        </Box>
        <Box>
          <Box sx={controlLabel}>Strategy</Box>
          <Box component="select" value={strategy} onChange={(e) => setStrategy(e.target.value)}
            sx={{ ...controlInput, width: '120px' }}>
            <option value="flat">Flat stake</option>
            <option value="percent">% of bankroll</option>
          </Box>
        </Box>
        {strategy === 'flat' ? (
          <Box>
            <Box sx={controlLabel}>Stake / pick (USD)</Box>
            <input type="number" min={1} step={1} value={flatStake}
              onChange={(e) => setFlatStake(Math.max(1, Number(e.target.value) || 1))}
              style={controlInput} />
          </Box>
        ) : (
          <Box>
            <Box sx={controlLabel}>% of bankroll</Box>
            <input type="number" min={0.1} max={20} step={0.1} value={percentStake}
              onChange={(e) => setPercentStake(Math.max(0.1, Math.min(20, Number(e.target.value) || 0.1)))}
              style={controlInput} />
          </Box>
        )}
        <Box
          component="button"
          onClick={run}
          disabled={!canRun || running}
          sx={{
            px: '18px', py: '8px',
            bgcolor:       canRun && !running ? CYAN : 'transparent',
            color:         canRun && !running ? '#0a0d14' : MUTED,
            border:        `1px solid ${canRun && !running ? CYAN : BORDER}`,
            fontFamily:    MONO, fontSize: '0.7rem', fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            cursor:        canRun && !running ? 'pointer' : 'not-allowed',
            transition:    'all 0.15s',
          }}
        >
          {running ? 'Running…' : '▶ Simulate'}
        </Box>
        {durationMs != null && !running && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: MUTED }}>{durationMs}ms</Typography>
        )}
      </Box>

      {!canRun && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: AMBER }}>
          Need at least 10 resolved picks for the selected filter to bootstrap.
        </Typography>
      )}

      {error && (
        <Box sx={{ border: `1px solid ${RED}44`, bgcolor: `${RED}0D`, p: '10px 14px', mb: '14px' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: RED }}>{error}</Typography>
        </Box>
      )}

      {result && s && (
        <>
          {/* Summary cards */}
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mt: '8px', mb: '20px' }}>
            <StatCard
              label="P(profit)"
              value={fmtPct(s.pProfit * 100)}
              color={s.pProfit >= 0.6 ? GREEN : s.pProfit >= 0.4 ? AMBER : RED}
              sub={`vs P(ruin) ${(s.pRuin * 100).toFixed(2)}%`}
            />
            <StatCard
              label="Median Terminal"
              value={fmtUsd(s.medianTerminal)}
              color={s.medianTerminal > bankroll ? GREEN : RED}
              sub={`P10 ${fmtUsd(s.p10Terminal)} · P90 ${fmtUsd(s.p90Terminal)}`}
            />
            <StatCard
              label="Mean Terminal"
              value={fmtUsd(s.meanTerminal)}
              color={s.meanTerminal > bankroll ? GREEN : RED}
              sub={`worst ${fmtUsd(s.worstCase)} · best ${fmtUsd(s.bestCase)}`}
            />
            <StatCard
              label="Expected Max DD"
              value={fmtUsd(s.expectedMaxDrawdown)}
              color={s.expectedMaxDrawdown < -bankroll * 0.3 ? RED : s.expectedMaxDrawdown < -bankroll * 0.15 ? AMBER : MUTED}
              sub="average peak-to-trough"
            />
            <StatCard
              label="Hist Mean Units"
              value={s.historicalMeanUnits >= 0 ? `+${s.historicalMeanUnits.toFixed(3)}` : s.historicalMeanUnits.toFixed(3)}
              color={s.historicalMeanUnits > 0 ? GREEN : RED}
              sub={`σ ${s.historicalStdUnits.toFixed(2)}`}
              small
            />
          </Box>

          {/* Fan chart */}
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: MUTED, letterSpacing: '0.16em', mb: '6px' }}>
            PERCENTILE BANDS (P10 / P25 / P50 / P75 / P90)
          </Typography>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={fanData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={BORDER} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t"
                tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
                tickLine={false} axisLine={false}
                tickFormatter={(v) => `#${v}`}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
                tickLine={false} axisLine={false}
                tickFormatter={(v) => fmtUsd(v)}
                width={56}
              />
              <ReferenceLine y={bankroll} stroke={MUTED} strokeDasharray="4 4"
                label={{ value: 'Start', position: 'right', fill: MUTED, fontSize: 10, fontFamily: MONO }} />
              <Tooltip content={<FanTooltip />} />
              {/* Outer band p10-p90 */}
              <Area type="monotone" dataKey="p90" stroke="none" fill={`${CYAN}26`} stackId="a" connectNulls={false} />
              <Area type="monotone" dataKey="p10" stroke="none" fill={BG}     stackId="b" connectNulls={false} />
              {/* P25/P75 lines */}
              <Line type="monotone" dataKey="p75" stroke={CYAN} strokeWidth={1} dot={false} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="p25" stroke={AMBER} strokeWidth={1} dot={false} strokeDasharray="3 3" />
              {/* Median */}
              <Line type="monotone" dataKey="p50" stroke="#fff" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Histogram of terminal bankroll */}
          <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: MUTED, letterSpacing: '0.16em', mt: '20px', mb: '6px' }}>
            TERMINAL BANKROLL DISTRIBUTION ({nSims.toLocaleString()} sims)
          </Typography>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={histData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={BORDER} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="x"
                tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
                tickLine={false} axisLine={false}
                tickFormatter={(v) => fmtUsd(v)}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
                tickLine={false} axisLine={false}
                width={40}
              />
              <ReferenceLine x={bankroll} stroke={MUTED} strokeDasharray="4 4" />
              <Tooltip
                cursor={{ fill: `${CYAN}1A` }}
                contentStyle={{ background: '#0a0d14', border: `1px solid ${BORDER}`, fontFamily: MONO, fontSize: 11 }}
                formatter={(v) => [v, 'paths']}
                labelFormatter={(v) => `≈ ${fmtUsd(v)}`}
              />
              <Bar dataKey="count" fill={GREEN} opacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </Box>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function EquityDashboard({ token, onBack }) {
  const [sport,     setSport]     = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sport });
      if (startDate) params.set('startDate', startDate);
      if (endDate)   params.set('endDate', endDate);
      const res = await fetch(`${API_URL}/api/admin/ml/equity?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed');
      setData(json.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sport, startDate, endDate, token]);

  useEffect(() => { load(); }, [load]);

  const s = data?.summary;
  const series = data?.series ?? [];

  // Recharts needs numeric x-axis; use index
  const chartData = series.map((p, i) => ({ ...p, i: i + 1 }));

  const inputStyle = {
    background:   SURF,
    border:       `1px solid ${BORDER}`,
    color:        '#ccc',
    fontFamily:   MONO,
    fontSize:     '0.7rem',
    padding:      '5px 9px',
    outline:      'none',
    colorScheme:  'dark',
    borderRadius: '2px',
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: '#e0e0e0', p: { xs: '16px', md: '24px 32px' } }}>

      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', mb: '24px', flexWrap: 'wrap' }}>
        <Box
          component="button"
          onClick={onBack}
          sx={{
            px: '12px', py: '6px', bgcolor: 'transparent',
            border: `1px solid ${BORDER}`, color: CYAN,
            fontFamily: MONO, fontSize: '0.62rem', letterSpacing: '0.14em',
            textTransform: 'uppercase', cursor: 'pointer',
            '&:hover': { borderColor: CYAN },
          }}
        >
          ← Back
        </Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: MUTED, letterSpacing: '0.2em' }}>
          // HEXA
        </Typography>
        <Typography sx={{ fontFamily: BARLOW, fontSize: '1.1rem', fontWeight: 800, color: CYAN, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Equity Dashboard
        </Typography>
      </Box>

      {/* ── Filters ── */}
      <Box sx={{ display: 'flex', gap: '8px', mb: '24px', flexWrap: 'wrap', alignItems: 'center' }}>
        {['all', 'mlb', 'nba'].map(sp => (
          <SportTab key={sp} value={sp} active={sport === sp} onClick={setSport} />
        ))}
        <Box sx={{ mx: '4px', width: '1px', height: '24px', bgcolor: BORDER }} />
        <input
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          placeholder="Start"
          style={inputStyle}
        />
        <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: MUTED }}>→</Typography>
        <input
          type="date"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          placeholder="End"
          style={inputStyle}
        />
        {(startDate || endDate) && (
          <Box
            component="button"
            onClick={() => { setStartDate(''); setEndDate(''); }}
            sx={{ px: '8px', py: '4px', bgcolor: 'transparent', border: `1px solid ${BORDER}`, color: MUTED, fontFamily: MONO, fontSize: '0.6rem', cursor: 'pointer' }}
          >
            Clear
          </Box>
        )}
      </Box>

      {/* ── Loading / error ── */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: '60px' }}>
          <CircularProgress size={28} sx={{ color: CYAN }} />
        </Box>
      )}
      {error && (
        <Box sx={{ border: `1px solid ${RED}44`, bgcolor: `${RED}0D`, p: '12px 16px', mb: '20px' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: RED }}>{error}</Typography>
        </Box>
      )}

      {!loading && data && (
        <>
          {/* ── Summary stat cards ── */}
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mb: '28px' }}>
            <StatCard
              label="Total Picks"
              value={s.totalPicks}
              color={CYAN}
              sub={`${s.wins}W · ${s.losses}L · ${s.pushes}P`}
            />
            <StatCard
              label="Win Rate"
              value={fmtPct(s.winRate)}
              color={s.winRate >= 55 ? GREEN : s.winRate >= 50 ? AMBER : RED}
            />
            <StatCard
              label="Unit Profit"
              value={fmtUnits(s.unitProfit)}
              color={s.unitProfit >= 0 ? GREEN : RED}
              sub={`Peak: ${fmtUnits(s.peakUnits)}`}
            />
            <StatCard
              label="ROI"
              value={fmtPct(s.roi)}
              color={s.roi >= 0 ? GREEN : RED}
              sub="flat bet"
            />
            <StatCard
              label="Max Drawdown"
              value={fmtUnits(s.maxDrawdown)}
              color={s.maxDrawdown < -10 ? RED : s.maxDrawdown < -5 ? AMBER : MUTED}
            />
            <StatCard
              label="Sharpe"
              value={fmt(s.sharpe, 2)}
              color={s.sharpe >= 0.5 ? GREEN : s.sharpe >= 0 ? AMBER : RED}
              sub="per-pick"
              small
            />
          </Box>

          {/* ── Equity curve chart ── */}
          {chartData.length > 0 && (
            <Box sx={{ background: SURF, border: `1px solid ${BORDER}`, p: '20px', mb: '16px' }}>
              <SectionHeader>Cumulative Units</SectionHeader>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={BORDER} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="i"
                    tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `#${v}`}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `${v}u`}
                    width={40}
                  />
                  <ReferenceLine y={0} stroke={MUTED} strokeDasharray="4 4" />
                  <Tooltip content={<EquityTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="cumUnits"
                    stroke={CYAN}
                    strokeWidth={2}
                    fill={DIM}
                    dot={false}
                    activeDot={{ r: 4, fill: CYAN }}
                  />
                  <Bar
                    dataKey="units"
                    fill={GREEN}
                    opacity={0.35}
                    radius={[1, 1, 0, 0]}
                    maxBarSize={8}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
          )}

          {/* ── Drawdown chart ── */}
          {chartData.length > 0 && (
            <Box sx={{ background: SURF, border: `1px solid ${BORDER}`, p: '20px', mb: '24px' }}>
              <SectionHeader>Drawdown</SectionHeader>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={BORDER} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="i" hide />
                  <YAxis
                    tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `${v}u`}
                    width={40}
                  />
                  <ReferenceLine y={0} stroke={MUTED} />
                  <Tooltip content={<DrawdownTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="drawdown"
                    stroke={RED}
                    strokeWidth={1.5}
                    fill={`${RED}22`}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          )}

          {/* ── Sport breakdown ── */}
          {data.bySport && Object.keys(data.bySport).length > 1 && (
            <Box sx={{ mb: '24px' }}>
              <SectionHeader>By Sport</SectionHeader>
              <SportBreakdown bySport={data.bySport} />
            </Box>
          )}

          {/* ── Monthly breakdown ── */}
          <Box sx={{ background: SURF, border: `1px solid ${BORDER}`, p: '20px', mb: '24px' }}>
            <SectionHeader>Monthly Breakdown</SectionHeader>
            <MonthlyTable monthly={data.monthly} />
          </Box>

          {/* ── Monte Carlo forward simulation ── */}
          <MonteCarloPanel
            token={token}
            sport={sport}
            startDate={startDate}
            endDate={endDate}
            sampleSize={series.length}
          />

          {/* ── Empty state ── */}
          {chartData.length === 0 && (
            <Box sx={{ textAlign: 'center', py: '48px' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: MUTED }}>
                No resolved picks found for the selected filters.
              </Typography>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
