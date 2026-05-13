/**
 * MLCalibrationDashboard.jsx — H.E.X.A. V4 Admin
 *
 * Shows how well the Python ML sidecar (XGBoost) is calibrated vs the legacy
 * deterministic shadow validator. Requires admin auth.
 *
 * Sections:
 *   1. Status bar — sidecar enabled/circuit state / last model version
 *   2. Stat cards — % Python scored, legacy accuracy, Python accuracy
 *   3. Reliability diagram — predicted probability bucket vs actual hit rate
 *   4. Rolling 30-day accuracy comparison — line chart
 *
 * Props:
 *   token      {string}  — JWT for Authorization header
 *   onBack     {Function} — navigate back to admin panel
 */

import { useState, useEffect, useCallback } from 'react';
import { Box, Typography, CircularProgress, Chip, Divider } from '@mui/material';
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, ReferenceLine, Tooltip, Legend,
  ResponsiveContainer, ScatterChart, Scatter,
  LineChart,
} from 'recharts';
import { C, MONO, DISPLAY } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Design tokens ─────────────────────────────────────────────────────────────
const BG      = '#0a0e1a';
const SURFACE = '#07090E';
const BORDER  = 'rgba(0,217,255,0.18)';
const CYAN    = '#00D9FF';
const GREEN   = '#00FF88';
const RED     = '#FF2244';
const AMBER   = '#FF9900';
const PURPLE  = '#B060FF';
const MUTED   = 'rgba(0,217,255,0.45)';
const DIM     = 'rgba(0,217,255,0.12)';

const CSS = `
@keyframes mcd-fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
@keyframes mcd-pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function pct(num, den) {
  if (!den || Number(den) === 0) return null;
  return ((Number(num) / Number(den)) * 100).toFixed(1);
}

function fmtPct(val, suffix = '%') {
  if (val == null) return '—';
  return `${val}${suffix}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, color = CYAN, sub, anim = 0 }) {
  return (
    <Box sx={{
      background:   SURFACE,
      border:       `1px solid ${BORDER}`,
      borderRadius: 0,
      p:            '20px 16px',
      flex:         1,
      minWidth:     120,
      position:     'relative',
      animation:    `mcd-fadeIn 0.4s ${anim * 0.07}s both`,
      '&::before': {
        content: '""', position: 'absolute',
        top: 0, left: 0, width: 8, height: 8,
        borderTop: `2px solid ${CYAN}`, borderLeft: `2px solid ${CYAN}`,
      },
      '&::after': {
        content: '""', position: 'absolute',
        bottom: 0, right: 0, width: 8, height: 8,
        borderBottom: `2px solid ${C.accent}`, borderRight: `2px solid ${C.accent}`,
      },
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '9px', letterSpacing: '3px', color: MUTED, mb: '6px', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: DISPLAY, fontSize: '28px', fontWeight: 700, color, lineHeight: 1 }}>
        {value ?? '—'}
      </Typography>
      {sub && (
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, mt: '6px' }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}

function SectionTitle({ children }) {
  return (
    <Typography sx={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '3px', color: MUTED, textTransform: 'uppercase', mb: 1.5, mt: 3 }}>
      {children}
    </Typography>
  );
}

// Custom tooltip for reliability diagram
function ReliabilityTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload ?? {};
  return (
    <Box sx={{ background: SURFACE, border: `1px solid ${BORDER}`, p: '10px 14px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: CYAN }}>
        Pred bucket: {d.bucket}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: MUTED }}>
        Actual rate: {d.actualRate != null ? `${(d.actualRate * 100).toFixed(1)}%` : '—'}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: MUTED }}>
        Count: {d.count ?? '—'}
      </Typography>
    </Box>
  );
}

// Reliability diagram: expected = 45° line, actual = scatter/bar
function ReliabilityDiagram({ data }) {
  if (!data?.length) {
    return (
      <Box sx={{ color: MUTED, fontFamily: MONO, fontSize: '12px', py: 3, textAlign: 'center' }}>
        No calibration data available yet. Train the model first.
      </Box>
    );
  }

  // Build chart data from manifest's reliability_diagram (or calibration buckets)
  const chartData = data.map((bucket) => ({
    bucket: bucket.label ?? `${(bucket.pred_mean * 100).toFixed(0)}%`,
    perfect: bucket.pred_mean,
    actual: bucket.actual_frac,
    actualRate: bucket.actual_frac,
    count: bucket.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <XAxis
          dataKey="bucket"
          tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
          label={{ value: 'Predicted Probability', position: 'insideBottom', offset: -4, fontFamily: MONO, fontSize: 10, fill: MUTED }}
        />
        <YAxis
          tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
          domain={[0, 1]}
          tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
        />
        <Tooltip content={<ReliabilityTooltip />} />
        {/* Perfect calibration reference */}
        <Line type="linear" dataKey="perfect" stroke={DIM} strokeDasharray="4 4" dot={false} name="Perfect" strokeWidth={1} />
        {/* Actual hit rate bars */}
        <Bar dataKey="actual" fill={CYAN} opacity={0.75} name="Actual hit rate" radius={[2,2,0,0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// Custom tooltip for rolling 30d chart
function RollingTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ background: SURFACE, border: `1px solid ${BORDER}`, p: '10px 14px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, mb: 0.5 }}>{label}</Typography>
      {payload.map((p) => (
        <Typography key={p.name} sx={{ fontFamily: MONO, fontSize: '11px', color: p.stroke ?? p.color }}>
          {p.name}: {p.value != null ? `${p.value}%` : '—'}
        </Typography>
      ))}
    </Box>
  );
}

function Rolling30dChart({ data }) {
  if (!data?.length) {
    return (
      <Box sx={{ color: MUTED, fontFamily: MONO, fontSize: '12px', py: 3, textAlign: 'center' }}>
        No resolved picks in the last 30 days.
      </Box>
    );
  }

  // Convert to % accuracy per day
  const chartData = [...data].reverse().map((row) => ({
    day: row.day?.slice(5) ?? '', // MM-DD
    legacy: row.resolved > 0 ? Number(pct(row.legacy_hits, row.resolved)) : null,
    python: row.resolved > 0 ? Number(pct(row.python_hits, row.resolved)) : null,
    resolved: Number(row.resolved),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <XAxis dataKey="day" tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }} />
        <YAxis
          tickFormatter={(v) => `${v}%`}
          domain={[0, 100]}
          tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
        />
        <ReferenceLine y={50} stroke={DIM} strokeDasharray="4 4" />
        <Tooltip content={<RollingTooltip />} />
        <Legend
          formatter={(value) => (
            <span style={{ fontFamily: MONO, fontSize: 10, color: MUTED }}>{value}</span>
          )}
        />
        <Line type="monotone" dataKey="legacy" stroke={AMBER} strokeWidth={1.5} dot={false} name="Legacy validator" connectNulls />
        <Line type="monotone" dataKey="python" stroke={CYAN}  strokeWidth={2}   dot={false} name="Python XGBoost"    connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Circuit state chip ────────────────────────────────────────────────────────

function CircuitChip({ state }) {
  const color = state === 'closed' ? GREEN : state === 'half-open' ? AMBER : RED;
  const label = state === 'closed' ? 'Circuit closed ✓' : state === 'half-open' ? 'Circuit half-open' : 'Circuit OPEN';
  return (
    <Chip
      label={label}
      size="small"
      sx={{ fontFamily: MONO, fontSize: '10px', color, border: `1px solid ${color}`, background: 'transparent', height: 22 }}
    />
  );
}

// ── Build reliability buckets from manifest ───────────────────────────────────
// The Python sidecar returns calibration.manifest which contains per-market
// reliability_diagram arrays (from calibration.py).
function extractReliabilityData(calibration, market = 'moneyline') {
  if (!calibration?.manifest) return [];
  const m = calibration.manifest?.[market];
  if (!m?.reliability_diagram) return [];
  return m.reliability_diagram;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MLCalibrationDashboard({ token, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeMarket, setActiveMarket] = useState('moneyline');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/ml-calibration`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Unknown error');
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ minHeight: '100vh', background: BG, p: { xs: 2, sm: 3 } }}>
      <style>{CSS}</style>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Box
          component="button"
          onClick={onBack}
          sx={{ background: 'none', border: `1px solid ${BORDER}`, color: CYAN, fontFamily: MONO, fontSize: '11px', px: 1.5, py: 0.5, cursor: 'pointer', '&:hover': { borderColor: CYAN } }}
        >
          ← BACK
        </Box>
        <Typography sx={{ fontFamily: DISPLAY, fontSize: { xs: '16px', sm: '20px' }, fontWeight: 700, color: CYAN }}>
          ML CALIBRATION DASHBOARD
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Box
          component="button"
          onClick={fetchData}
          disabled={loading}
          sx={{ background: 'none', border: `1px solid ${BORDER}`, color: MUTED, fontFamily: MONO, fontSize: '10px', px: 1.5, py: 0.5, cursor: loading ? 'wait' : 'pointer' }}
        >
          {loading ? '...' : 'REFRESH'}
        </Box>
      </Box>

      {/* Loading */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress sx={{ color: CYAN }} size={32} />
        </Box>
      )}

      {/* Error */}
      {!loading && error && (
        <Box sx={{ border: `1px solid ${RED}`, p: 2, color: RED, fontFamily: MONO, fontSize: '12px' }}>
          Error: {error}
        </Box>
      )}

      {/* Content */}
      {!loading && !error && data && (
        <Box sx={{ animation: 'mcd-fadeIn 0.4s ease both' }}>

          {/* ── Status bar ──────────────────────────────────────────────── */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 3, p: '10px 14px', border: `1px solid ${BORDER}`, background: SURFACE }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED }}>SIDECAR:</Typography>
            <Chip
              label={data.enabled ? 'ENABLED' : 'DISABLED'}
              size="small"
              sx={{ fontFamily: MONO, fontSize: '10px', color: data.enabled ? GREEN : RED, border: `1px solid ${data.enabled ? GREEN : RED}`, background: 'transparent', height: 22 }}
            />
            {data.circuit && <CircuitChip state={data.circuit.state} />}
            {data.circuit?.failures > 0 && (
              <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: AMBER }}>
                {data.circuit.failures} consecutive failure{data.circuit.failures !== 1 ? 's' : ''}
              </Typography>
            )}
            {data.calibration?.manifest?.trained_at && (
              <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, ml: 'auto' }}>
                last trained: {new Date(data.calibration.manifest.trained_at).toLocaleString()}
              </Typography>
            )}
          </Box>

          {/* ── Stat cards ──────────────────────────────────────────────── */}
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
            <StatCard
              anim={0} label="Python Scored" color={CYAN}
              value={data.shadow_comparison?.python_scored ?? '—'}
              sub={`${data.shadow_comparison?.python_disabled ?? 0} disabled · ${data.shadow_comparison?.python_unavailable ?? 0} unavailable`}
            />
            <StatCard
              anim={1} label="Legacy Accuracy" color={AMBER}
              value={fmtPct(pct(data.shadow_comparison?.legacy_correct, data.shadow_comparison?.legacy_resolved))}
              sub={`${data.shadow_comparison?.legacy_correct ?? 0} / ${data.shadow_comparison?.legacy_resolved ?? 0} resolved`}
            />
            <StatCard
              anim={2} label="Python Accuracy" color={CYAN}
              value={fmtPct(pct(data.shadow_comparison?.python_correct, data.shadow_comparison?.python_resolved))}
              sub={`${data.shadow_comparison?.python_correct ?? 0} / ${data.shadow_comparison?.python_resolved ?? 0} scored+resolved`}
            />
            <StatCard
              anim={3} label="Avg Python Prob" color={PURPLE}
              value={data.shadow_comparison?.avg_python_prob != null ? Number(data.shadow_comparison.avg_python_prob).toFixed(3) : '—'}
              sub="home win probability (moneyline)"
            />
          </Box>

          <Divider sx={{ borderColor: BORDER, mb: 2 }} />

          {/* ── Market selector ─────────────────────────────────────────── */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            {['moneyline', 'overunder', 'runline'].map((m) => (
              <Box
                key={m}
                component="button"
                onClick={() => setActiveMarket(m)}
                sx={{
                  background: activeMarket === m ? `${CYAN}22` : 'none',
                  border: `1px solid ${activeMarket === m ? CYAN : BORDER}`,
                  color: activeMarket === m ? CYAN : MUTED,
                  fontFamily: MONO, fontSize: '10px', px: 1.5, py: 0.5,
                  cursor: 'pointer', textTransform: 'uppercase',
                  '&:hover': { borderColor: CYAN, color: CYAN },
                }}
              >
                {m}
              </Box>
            ))}
          </Box>

          {/* ── Reliability diagram ──────────────────────────────────────── */}
          <SectionTitle>Reliability Diagram — {activeMarket}</SectionTitle>
          <Box sx={{ background: SURFACE, border: `1px solid ${BORDER}`, p: '16px 12px', mb: 3 }}>
            {data.enabled ? (
              <ReliabilityDiagram data={extractReliabilityData(data.calibration, activeMarket)} />
            ) : (
              <Box sx={{ color: MUTED, fontFamily: MONO, fontSize: '12px', py: 3, textAlign: 'center' }}>
                Enable the sidecar (ML_SIDECAR_ENABLED=true) and run a training pass to see calibration.
              </Box>
            )}
            <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 1.5, textAlign: 'center' }}>
              Bars above the dashed line = model is underconfident. Bars below = overconfident. Perfect calibration = bars touch the line.
            </Typography>
          </Box>

          {/* ── Rolling 30d accuracy ─────────────────────────────────────── */}
          <SectionTitle>Rolling 30-Day Accuracy — Legacy vs Python</SectionTitle>
          <Box sx={{ background: SURFACE, border: `1px solid ${BORDER}`, p: '16px 12px', mb: 3 }}>
            <Rolling30dChart data={data.rolling_30d} />
            <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 1.5, textAlign: 'center' }}>
              Daily moneyline accuracy. 50% = random baseline. Higher is better.
            </Typography>
          </Box>

          {/* ── Raw manifest ─────────────────────────────────────────────── */}
          {data.calibration && (
            <>
              <SectionTitle>Raw Calibration Manifest</SectionTitle>
              <Box sx={{ background: SURFACE, border: `1px solid ${BORDER}`, p: 2, overflow: 'auto', maxHeight: 300 }}>
                <Typography component="pre" sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(data.calibration, null, 2)}
                </Typography>
              </Box>
            </>
          )}

          {/* Footer */}
          <Box sx={{ mt: 4, pt: 2, borderTop: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED }}>
              H.E.X.A. ML Sidecar — Sprint 3
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED }}>
              Data from shadow_model_runs · Python model: XGBoost + Platt calibration
            </Typography>
          </Box>

        </Box>
      )}
    </Box>
  );
}
