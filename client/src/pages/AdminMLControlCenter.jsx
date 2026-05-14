/**
 * AdminMLControlCenter.jsx — H.E.X.A. V4 Admin
 *
 * Unified control center for the ML pipeline:
 *   - HUD status bar (sidecar enabled, URL, latency, circuit state, ensemble status)
 *   - Per-market cards (Moneyline / OverUnder / Runline) with Brier, ROI, n_train,
 *     last trained, individual "RETRAIN" button + global "RETRAIN ALL"
 *   - Reliability diagrams per market (tabbed)
 *   - Rolling 30-day accuracy chart (legacy vs python)
 *   - Ensemble Meta-Learner panel with learned weights, per-source Brier, retrain
 *   - Retrain audit log (last 50 attempts from ml_retrain_log)
 *
 * Admin-only. Polls /api/admin/ml/status every 10 seconds for live HUD.
 *
 * Props:
 *   token   — JWT (admin)
 *   onBack  — navigate back
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Typography, Chip, CircularProgress, Button, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import {
  ComposedChart, Bar, Line, LineChart,
  XAxis, YAxis, ReferenceLine, Tooltip as RTooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { C, MONO, DISPLAY } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Palette ──────────────────────────────────────────────────────────────────
const BG      = C.bg;
const SURFACE = C.bg1;
const SURFACE2 = C.bg2;
const BORDER  = C.border;
const CYAN    = C.cyan;
const GREEN   = C.green;
const RED     = C.red;
const AMBER   = C.amber;
const ACCENT  = C.accent;
const MUTED   = C.ink2;
const INK1    = C.ink1;
const INK0    = C.ink0;
const DIM     = 'rgba(34,240,255,0.10)';

const MARKETS = ['moneyline', 'overunder', 'runline'];
const MARKET_LABELS = { moneyline: 'Moneyline', overunder: 'Over / Under', runline: 'Runline' };
const MARKET_TINTS  = { moneyline: CYAN, overunder: GREEN, runline: AMBER };

// ── CSS animations (mounted once) ────────────────────────────────────────────
const CSS = `
@keyframes amlc-fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes amlc-pulse  { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes amlc-border-flow {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes amlc-scan {
  0%   { transform: translateY(-100%); opacity: 0; }
  50%  { opacity: 0.5; }
  100% { transform: translateY(100%); opacity: 0; }
}
@keyframes amlc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.amlc-flow-border {
  background: linear-gradient(90deg, ${CYAN} 0%, ${GREEN} 35%, ${ACCENT} 65%, ${CYAN} 100%);
  background-size: 200% 100%;
  animation: amlc-border-flow 6s linear infinite;
}
.amlc-scan-line {
  position: absolute; inset: 0; pointer-events: none; overflow: hidden;
}
.amlc-scan-line::before {
  content: ''; position: absolute; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, ${CYAN}, transparent);
  animation: amlc-scan 3.5s ease-in-out infinite;
}
`;

// ── Helpers ──────────────────────────────────────────────────────────────────
function pct(num, den) {
  if (!den || Number(den) === 0) return null;
  return ((Number(num) / Number(den)) * 100).toFixed(1);
}
function fmtBrier(v) { return v == null ? '—' : Number(v).toFixed(4); }
function fmtPercent(v, digits = 1) { return v == null ? '—' : `${(Number(v) * 100).toFixed(digits)}%`; }
function fmtROI(v) { return v == null ? '—' : `${v >= 0 ? '+' : ''}${(Number(v) * 100).toFixed(1)}%`; }
function fmtMs(v) { return v == null ? '—' : `${v}ms`; }
function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toISOString().slice(0, 16).replace('T', ' '); }
  catch { return '—'; }
}
function timeAgo(v) {
  if (!v) return '—';
  const diff = Date.now() - new Date(v).getTime();
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Corner-bracket decorator (reused everywhere) ─────────────────────────────
function CornerBrackets({ color = CYAN, size = 10 }) {
  const ext = `2px solid ${color}`;
  return (
    <>
      <Box sx={{ position: 'absolute', top: 0, left: 0, width: size, height: size, borderTop: ext, borderLeft: ext }} />
      <Box sx={{ position: 'absolute', top: 0, right: 0, width: size, height: size, borderTop: ext, borderRight: ext }} />
      <Box sx={{ position: 'absolute', bottom: 0, left: 0, width: size, height: size, borderBottom: ext, borderLeft: ext }} />
      <Box sx={{ position: 'absolute', bottom: 0, right: 0, width: size, height: size, borderBottom: ext, borderRight: ext }} />
    </>
  );
}

// ── HUD: top status overlay ──────────────────────────────────────────────────
function HUDStatusBar({ status, loading, onRefresh }) {
  const enabled         = !!status?.enabled;
  const ensembleEnabled = !!status?.ensemble_enabled;
  const circuit         = status?.circuit?.state ?? 'unknown';
  const sidecarUrl      = status?.sidecar_url ?? '—';
  const latency         = status?.health_latency_ms;
  const healthOk        = !!status?.health?.status && status.health.status === 'ok';
  const lastRetrain     = status?.last_retrain;

  const circuitColor = circuit === 'closed' ? GREEN : circuit === 'half-open' ? AMBER : circuit === 'open' ? RED : MUTED;
  const sidecarColor = enabled && healthOk ? GREEN : enabled ? AMBER : RED;

  return (
    <Box sx={{
      position:     'relative',
      background:   `linear-gradient(135deg, ${SURFACE} 0%, ${SURFACE2} 100%)`,
      border:       `1px solid ${BORDER}`,
      p:            '14px 18px',
      mb:           2,
      overflow:     'hidden',
      animation:    'amlc-fadeIn 0.3s both',
    }}>
      {/* Animated flow accent on top edge */}
      <Box className="amlc-flow-border" sx={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
      }} />
      <CornerBrackets color={CYAN} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        {/* Title block */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 220 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px' }}>
            HEXA.ML // CONTROL CENTER
          </Typography>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.05rem', fontWeight: 700, color: INK0, lineHeight: 1.1 }}>
            Model Operations Dashboard
          </Typography>
        </Box>

        <Box sx={{ flex: 1, minWidth: 200 }} />

        {/* Indicator pills */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <StatusPill label="Sidecar"   value={enabled ? (healthOk ? 'ONLINE' : 'DEGRADED') : 'OFFLINE'} color={sidecarColor} pulse={!healthOk && enabled} />
          <StatusPill label="Circuit"   value={String(circuit).toUpperCase()} color={circuitColor} pulse={circuit === 'half-open'} />
          <StatusPill label="Ensemble"  value={ensembleEnabled ? 'ENABLED' : 'DISABLED'} color={ensembleEnabled ? GREEN : MUTED} />
          <StatusPill label="Latency"   value={fmtMs(latency)} color={latency != null && latency < 800 ? GREEN : latency != null ? AMBER : MUTED} />
        </Box>

        <Tooltip title="Refresh now">
          <Button
            onClick={onRefresh}
            disabled={loading}
            sx={{
              minWidth: 0, p: '6px 10px', border: `1px solid ${BORDER}`, color: CYAN,
              fontFamily: MONO, fontSize: '10px', letterSpacing: '2px',
              '&:hover': { background: DIM, borderColor: CYAN },
            }}
          >
            {loading ? <CircularProgress size={12} sx={{ color: CYAN }} /> : '↻ SYNC'}
          </Button>
        </Tooltip>
      </Box>

      {/* Sub-row: detail strip */}
      <Box sx={{ display: 'flex', gap: 3, mt: 1.5, flexWrap: 'wrap', fontFamily: MONO, fontSize: '10px', color: MUTED }}>
        <span>URL: <span style={{ color: INK1 }}>{sidecarUrl || '(none)'}</span></span>
        <span>FAILURES: <span style={{ color: status?.circuit?.failures ? AMBER : INK1 }}>{status?.circuit?.failures ?? 0}</span></span>
        <span>LAST RETRAIN: <span style={{ color: INK1 }}>
          {lastRetrain ? `${lastRetrain.market} → ${lastRetrain.status} · ${timeAgo(lastRetrain.created_at)}` : 'never'}
        </span></span>
      </Box>
    </Box>
  );
}

function StatusPill({ label, value, color, pulse = false }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      px: '8px', py: '4px', border: `1px solid ${color}`,
      background: 'rgba(0,0,0,0.35)',
      animation: pulse ? 'amlc-pulse 1.5s ease-in-out infinite' : 'none',
    }}>
      <Box sx={{ width: 6, height: 6, background: color, borderRadius: '50%', boxShadow: `0 0 6px ${color}` }} />
      <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '1.5px' }}>{label}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '10px', color, fontWeight: 700, letterSpacing: '1px' }}>{value}</Typography>
    </Box>
  );
}

// ── Per-market card with retrain action ──────────────────────────────────────
function MarketCard({ market, manifest, onRetrain, busy, index = 0 }) {
  const tint = MARKET_TINTS[market];
  const data = manifest?.markets?.[market] ?? null;
  const trained = data && !data.skipped && !data.error;
  const nTrain = data?.n_train ?? null;
  const brier  = data?.brier_test ?? null;
  const roi    = data?.roi_kelly25_test ?? null;
  const trainedAt = data?.trained_at ?? null;
  const early   = nTrain != null && nTrain < 60;

  return (
    <Box sx={{
      position: 'relative', flex: 1, minWidth: 240,
      background: SURFACE, border: `1px solid ${BORDER}`,
      p: '18px 16px 16px', overflow: 'hidden',
      animation: `amlc-fadeIn 0.4s ${index * 0.08}s both`,
      '&:hover .amlc-mc-scan': { opacity: 1 },
    }}>
      <CornerBrackets color={tint} size={12} />
      {/* hover scan effect */}
      <Box className="amlc-scan-line amlc-mc-scan" sx={{ opacity: 0, transition: 'opacity 0.3s' }} />

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px', textTransform: 'uppercase' }}>
            MARKET // {market}
          </Typography>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.15rem', fontWeight: 700, color: tint, mt: '2px', lineHeight: 1.1 }}>
            {MARKET_LABELS[market]}
          </Typography>
        </Box>
        {early && (
          <Tooltip title="Training set is below the standard floor of 60. Model is statistically thin — treat predictions as exploratory.">
            <Chip
              label="EARLY MODEL"
              size="small"
              sx={{ fontFamily: MONO, fontSize: '8px', color: AMBER, border: `1px solid ${AMBER}`, background: 'transparent', height: 18, letterSpacing: '1.5px' }}
            />
          </Tooltip>
        )}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 2 }}>
        <Metric label="BRIER" value={fmtBrier(brier)} color={brier != null && brier < 0.22 ? GREEN : brier != null ? AMBER : MUTED} />
        <Metric label="ROI KELLY 25%" value={fmtROI(roi)} color={roi != null && roi > 0 ? GREEN : roi != null ? RED : MUTED} />
        <Metric label="N TRAIN" value={nTrain ?? '—'} color={INK1} />
        <Metric label="N TEST"  value={data?.n_test ?? '—'} color={INK1} />
      </Box>

      <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 2 }}>
        TRAINED: <span style={{ color: INK1 }}>{trainedAt ? `${fmtDate(trainedAt)} (${timeAgo(trainedAt)})` : 'never'}</span>
      </Typography>
      {!trained && data?.error && (
        <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: RED, mt: 0.5 }}>
          ERROR: {String(data.error).slice(0, 90)}
        </Typography>
      )}
      {!trained && data?.skipped && (
        <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: AMBER, mt: 0.5 }}>
          SKIPPED — need more resolved picks (configured floor: {data?.min_train_size_used})
        </Typography>
      )}

      <Button
        onClick={() => onRetrain(market)}
        disabled={busy}
        sx={{
          mt: 2, width: '100%', py: '8px',
          border: `1px solid ${tint}`, color: tint, background: 'transparent',
          fontFamily: MONO, fontSize: '10px', letterSpacing: '2px',
          '&:hover': { background: `${tint}1A`, boxShadow: `0 0 14px ${tint}40` },
          '&:disabled': { opacity: 0.4, borderColor: MUTED, color: MUTED },
        }}
      >
        {busy ? '⟳ TRAINING…' : `▶ RETRAIN ${market.toUpperCase()}`}
      </Button>
    </Box>
  );
}

function Metric({ label, value, color = INK0 }) {
  return (
    <Box>
      <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: MUTED, letterSpacing: '2px', mb: '2px' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.1rem', fontWeight: 700, color, lineHeight: 1.1 }}>
        {value}
      </Typography>
    </Box>
  );
}

// ── Reliability diagram (per-market tabs) ────────────────────────────────────
function ReliabilityPanel({ manifest, market }) {
  const buckets = manifest?.markets?.[market]?.reliability_diagram ?? [];
  if (!buckets.length) {
    return <EmptyChart text="No calibration buckets yet — train the model first." />;
  }
  const data = buckets.map((b) => ({
    bucket: b.label ?? `${Math.round(((b.pred_mean ?? 0) * 100))}%`,
    perfect: b.pred_mean,
    actual:  b.actual_frac,
    count:   b.count,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <XAxis
          dataKey="bucket"
          tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
          label={{ value: 'Predicted prob bucket', position: 'insideBottom', offset: -4, fontFamily: MONO, fontSize: 10, fill: MUTED }}
        />
        <YAxis
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
          domain={[0, 1]}
          tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }}
        />
        <RTooltip
          contentStyle={{ background: SURFACE, border: `1px solid ${BORDER}`, fontFamily: MONO, fontSize: 11 }}
          formatter={(value, name) => [typeof value === 'number' ? value.toFixed(3) : value, name]}
        />
        <Line type="linear" dataKey="perfect" stroke={MUTED} strokeDasharray="3 5" dot={false} name="Perfect calibration" strokeWidth={1} />
        <Bar dataKey="actual" fill={MARKET_TINTS[market]} opacity={0.85} name="Actual hit rate" radius={[2, 2, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function EmptyChart({ text }) {
  return (
    <Box sx={{ color: MUTED, fontFamily: MONO, fontSize: '11px', py: 4, textAlign: 'center' }}>
      {text}
    </Box>
  );
}

// ── Rolling 30d chart ────────────────────────────────────────────────────────
function Rolling30dChart({ rolling }) {
  if (!rolling?.length) return <EmptyChart text="No resolved shadow runs in the last 30 days." />;
  const data = [...rolling].reverse().map((r) => ({
    day:    r.day?.slice(5) ?? '',
    legacy: r.resolved > 0 ? Number(pct(r.legacy_hits, r.resolved)) : null,
    python: r.resolved > 0 ? Number(pct(r.python_hits, r.resolved)) : null,
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <XAxis dataKey="day" tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }} />
        <YAxis tickFormatter={(v) => `${v}%`} domain={[0, 100]} tick={{ fontFamily: MONO, fontSize: 10, fill: MUTED }} />
        <ReferenceLine y={50} stroke={MUTED} strokeDasharray="4 4" />
        <RTooltip contentStyle={{ background: SURFACE, border: `1px solid ${BORDER}`, fontFamily: MONO, fontSize: 11 }} />
        <Legend formatter={(v) => <span style={{ fontFamily: MONO, fontSize: 10, color: MUTED }}>{v}</span>} />
        <Line type="monotone" dataKey="legacy" stroke={AMBER} strokeWidth={1.6} dot={false} name="Legacy validator" connectNulls />
        <Line type="monotone" dataKey="python" stroke={CYAN}  strokeWidth={2.2} dot={false} name="Python XGBoost"    connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Ensemble panel ───────────────────────────────────────────────────────────
function EnsemblePanel({ ensemble, onRetrain, busy }) {
  const enabled = ensemble?.enabled;
  const m = ensemble?.manifest?.manifest?.markets?.moneyline
        ?? ensemble?.manifest?.markets?.moneyline
        ?? null;

  return (
    <Box sx={{ position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`, p: '20px 18px', mt: 3, overflow: 'hidden' }}>
      <CornerBrackets color={GREEN} size={14} />
      <Box className="amlc-flow-border" sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px' }} />

      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px' }}>
            META-LEARNER // SPRINT 4
          </Typography>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.2rem', fontWeight: 700, color: GREEN, lineHeight: 1.1 }}>
            Ensemble Combiner
          </Typography>
        </Box>
        <Button
          onClick={onRetrain}
          disabled={busy || !enabled}
          sx={{
            border: `1px solid ${GREEN}`, color: GREEN, fontFamily: MONO, fontSize: '10px', letterSpacing: '2px',
            px: 2, py: '6px',
            '&:hover': { background: `${GREEN}1A`, boxShadow: `0 0 14px ${GREEN}40` },
            '&:disabled': { opacity: 0.4, borderColor: MUTED, color: MUTED },
          }}
        >
          {busy ? '⟳ TRAINING…' : '▶ RETRAIN ENSEMBLE'}
        </Button>
      </Box>

      {/* Explanation block — always visible */}
      <Box sx={{ background: 'rgba(43,255,136,0.04)', border: `1px solid ${GREEN}33`, p: '12px 14px', mb: 2 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: INK1, lineHeight: 1.6 }}>
          The ensemble is a calibrated <strong style={{ color: GREEN }}>LogisticRegression</strong> that combines three sources of
          home-win probability — the <strong style={{ color: AMBER }}>Oracle</strong> (Claude/Grok),
          the <strong style={{ color: ACCENT }}>Legacy</strong> deterministic validator, and the trained
          <strong style={{ color: CYAN }}> Python XGBoost</strong> — into a single calibrated number.
          Each source enters in logit space; the model learns per-source weights against resolved games.
          A saved artifact only beats the best individual source on out-of-sample Brier (or you use <code>--force</code>).
        </Typography>
      </Box>

      {!enabled && (
        <EmptyChart text="Ensemble disabled. Set ENSEMBLE_ENABLED=true on the server to enable." />
      )}
      {enabled && !m && (
        <EmptyChart text="Ensemble enabled but not yet trained — click RETRAIN ENSEMBLE once ≥50 resolved picks have all 3 sources." />
      )}
      {enabled && m && (
        <>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '2px', mb: 1 }}>
            BRIER SCORES (lower is better)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
            <BrierBadge label="Oracle"   value={m.brier_oracle} color={AMBER} />
            <BrierBadge label="Legacy"   value={m.brier_legacy} color={ACCENT} />
            <BrierBadge label="Python"   value={m.brier_python} color={CYAN} />
            <BrierBadge label="ENSEMBLE" value={m.brier_test}   color={GREEN} highlight />
          </Box>

          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '2px', mb: 1 }}>
            LEARNED WEIGHTS (logit-space coefficients)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <WeightBadge label="Oracle"    value={m.coef_oracle} />
            <WeightBadge label="Legacy"    value={m.coef_legacy} />
            <WeightBadge label="Python"    value={m.coef_python} />
            <WeightBadge label="Intercept" value={m.intercept} />
          </Box>

          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 2 }}>
            n_train={m.n_train} · n_test={m.n_test} · trained {m.trained_at ? timeAgo(m.trained_at) : '—'}
          </Typography>
        </>
      )}
    </Box>
  );
}

function BrierBadge({ label, value, color, highlight = false }) {
  return (
    <Box sx={{
      position: 'relative', minWidth: 96, px: '10px', py: '6px',
      border: `1px solid ${color}`, background: highlight ? `${color}1A` : 'transparent',
      boxShadow: highlight ? `0 0 10px ${color}40` : 'none',
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: MUTED, letterSpacing: '2px' }}>{label}</Typography>
      <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.05rem', fontWeight: 700, color }}>{fmtBrier(value)}</Typography>
    </Box>
  );
}

function WeightBadge({ label, value }) {
  const num = Number(value);
  const valid = Number.isFinite(num);
  const c = !valid ? MUTED : num > 0 ? GREEN : num < 0 ? RED : MUTED;
  return (
    <Box sx={{ minWidth: 96, px: '10px', py: '6px', border: `1px solid ${BORDER}` }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: MUTED, letterSpacing: '2px' }}>{label}</Typography>
      <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.05rem', fontWeight: 700, color: c }}>
        {valid ? (num >= 0 ? '+' : '') + num.toFixed(3) : '—'}
      </Typography>
    </Box>
  );
}

// ── Chat-sourced picks section ───────────────────────────────────────────────

function ChatPicksSection({ stats }) {
  const s = stats?.summary;
  if (!s) {
    return (
      <Box sx={{ position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`, p: '16px 18px', mt: 3, overflow: 'hidden' }}>
        <CornerBrackets color={ACCENT} />
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, letterSpacing: '2px' }}>
          Loading chat-sourced picks…
        </Typography>
      </Box>
    );
  }
  const total   = Number(s.total ?? 0);
  const wins    = Number(s.wins ?? 0);
  const losses  = Number(s.losses ?? 0);
  const pending = Number(s.pending ?? 0);
  const sessions = Number(s.unique_sessions ?? 0);
  const settled = wins + losses;
  const winRate = settled > 0 ? ((wins / settled) * 100).toFixed(1) : null;

  return (
    <Box sx={{ position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`, p: '18px 18px 16px', mt: 3, overflow: 'hidden' }}>
      <CornerBrackets color={ACCENT} size={12} />

      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1 }}>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px' }}>
            ORACLE CHAT // TRAINING BUCKET
          </Typography>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.15rem', fontWeight: 700, color: ACCENT, lineHeight: 1.1 }}>
            Chat-sourced Picks
          </Typography>
        </Box>
      </Box>

      <Box sx={{ background: 'rgba(255,122,26,0.05)', border: `1px solid ${ACCENT}33`, p: '10px 12px', mb: 2 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: INK1, lineHeight: 1.6 }}>
          Picks extracted from Oracle chat sessions, stored with <code>source='oracle_chat'</code>.
          By default these are <strong>excluded</strong> from training (the Python sidecar filters on
          <code> source = 'live'</code>) to avoid biasing the model with hypothetical questions. They
          remain available for opt-in retraining or for tracking the Oracle's casual judgement quality.
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1.5 }}>
        <Metric label="TOTAL"      value={total} color={CYAN} />
        <Metric label="WINS"       value={wins} color={GREEN} />
        <Metric label="LOSSES"     value={losses} color={RED} />
        <Metric label="PENDING"    value={pending} color={AMBER} />
        <Metric label="WIN RATE"   value={winRate ? `${winRate}%` : '—'} color={winRate && Number(winRate) >= 50 ? GREEN : MUTED} />
      </Box>

      <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 2 }}>
        SESSIONS: <span style={{ color: INK1 }}>{sessions}</span>
        {' · '}FIRST: <span style={{ color: INK1 }}>{s.first_at ? new Date(s.first_at).toISOString().slice(0,10) : '—'}</span>
        {' · '}LAST: <span style={{ color: INK1 }}>{s.last_at ? timeAgo(s.last_at) : '—'}</span>
      </Typography>

      {stats?.by_market?.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
          {stats.by_market.map((m) => (
            <Box key={m.market_type} sx={{
              px: '8px', py: '4px', border: `1px solid ${BORDER}`,
              fontFamily: MONO, fontSize: '9px', color: INK1, letterSpacing: '1.5px',
            }}>
              <span style={{ color: MUTED }}>{(m.market_type || '?').toUpperCase()}: </span>
              <span style={{ color: MARKET_TINTS[m.market_type] ?? ACCENT, fontWeight: 700 }}>{m.n}</span>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ── Retrain audit log ────────────────────────────────────────────────────────
function RetrainLog({ rows }) {
  if (!rows?.length) return <EmptyChart text="No retrains logged yet. Click RETRAIN above to fire the first one." />;
  return (
    <Box sx={{ border: `1px solid ${BORDER}`, background: SURFACE, maxHeight: 360, overflowY: 'auto' }}>
      <Box sx={{
        display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr 0.7fr 0.7fr 0.7fr 1.5fr',
        background: SURFACE2, borderBottom: `1px solid ${BORDER}`,
        px: '12px', py: '8px',
        fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '2px', textTransform: 'uppercase',
      }}>
        <span>When</span><span>Market</span><span>Status</span><span>Brier</span><span>N_train</span><span>Duration</span><span>By</span>
      </Box>
      {rows.map((r) => (
        <Box key={r.id} sx={{
          display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.7fr 0.7fr 0.7fr 0.7fr 1.5fr',
          borderBottom: `1px solid ${C.line}`, px: '12px', py: '8px',
          fontFamily: MONO, fontSize: '10px', color: INK1,
          '&:hover': { background: SURFACE2 },
        }}>
          <span>{timeAgo(r.created_at)}</span>
          <span style={{ color: MARKET_TINTS[r.market] ?? INK1 }}>{r.market}</span>
          <span style={{ color: r.status === 'success' ? GREEN : RED }}>{r.status}</span>
          <span>{fmtBrier(r.brier)}</span>
          <span>{r.n_train ?? '—'}</span>
          <span>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}</span>
          <span style={{ color: MUTED }} title={r.user_email ?? ''}>{r.user_email?.split('@')[0] ?? '—'}</span>
        </Box>
      ))}
    </Box>
  );
}

// ── Toast for retrain feedback ───────────────────────────────────────────────
function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onClose, 6_000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  const c = toast.kind === 'error' ? RED : toast.kind === 'warn' ? AMBER : GREEN;
  return (
    <Box sx={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: SURFACE, border: `1px solid ${c}`, p: '12px 16px',
      boxShadow: `0 0 20px ${c}40`, animation: 'amlc-fadeIn 0.25s both',
      maxWidth: 420,
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: c, letterSpacing: '2px', mb: 0.5 }}>
        {toast.title}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: INK1 }}>
        {toast.message}
      </Typography>
    </Box>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function AdminMLControlCenter({ token, onBack }) {
  const [status, setStatus]         = useState(null);
  const [calibration, setCalibration] = useState(null);
  const [ensemble, setEnsemble]     = useState(null);
  const [logRows, setLogRows]       = useState([]);
  const [chatStats, setChatStats]   = useState(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyMarket, setBusyMarket] = useState(null);   // string | 'ensemble' | 'all'
  const [activeMarket, setActiveMarket] = useState('moneyline');
  const [toast, setToast]           = useState(null);
  const pollRef = useRef(null);

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  // ── Fetchers ──────────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/status`, { headers });
      if (!r.ok) throw new Error(`status http ${r.status}`);
      const json = await r.json();
      setStatus(json);
    } catch (err) {
      console.warn('[AdminMLControlCenter] status fetch failed', err.message);
    }
  }, [headers]);

  const fetchCalibration = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/ml-calibration`, { headers });
      if (!r.ok) throw new Error(`calibration http ${r.status}`);
      setCalibration(await r.json());
    } catch (err) {
      console.warn('[AdminMLControlCenter] calibration fetch failed', err.message);
    }
  }, [headers]);

  const fetchEnsemble = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/ensemble`, { headers });
      if (!r.ok) throw new Error(`ensemble http ${r.status}`);
      setEnsemble(await r.json());
    } catch (err) {
      console.warn('[AdminMLControlCenter] ensemble fetch failed', err.message);
    }
  }, [headers]);

  const fetchLog = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/retrain-log?limit=50`, { headers });
      if (!r.ok) throw new Error(`log http ${r.status}`);
      const json = await r.json();
      setLogRows(json?.data ?? []);
    } catch (err) {
      console.warn('[AdminMLControlCenter] log fetch failed', err.message);
    }
  }, [headers]);

  const fetchChatStats = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/chat-picks-stats`, { headers });
      if (!r.ok) throw new Error(`chat-stats http ${r.status}`);
      setChatStats(await r.json());
    } catch (err) {
      console.warn('[AdminMLControlCenter] chat-stats fetch failed', err.message);
    }
  }, [headers]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchStatus(), fetchCalibration(), fetchEnsemble(), fetchLog(), fetchChatStats()]);
    setRefreshing(false);
  }, [fetchStatus, fetchCalibration, fetchEnsemble, fetchLog, fetchChatStats]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await refreshAll();
      if (alive) setLoading(false);
    })();
    pollRef.current = setInterval(fetchStatus, 10_000);
    return () => {
      alive = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshAll, fetchStatus]);

  // ── Retrain actions ───────────────────────────────────────────────────────
  const handleRetrain = useCallback(async (market) => {
    setBusyMarket(market);
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/retrain`, {
        method: 'POST', headers, body: JSON.stringify({ market }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `http ${r.status}`);
      const m = j?.metrics ?? {};
      setToast({
        kind: 'ok', title: `RETRAIN OK · ${market}`,
        message: `Brier ${fmtBrier(m.brier)} · n_train=${m.nTrain ?? '?'} · ${(j.duration_ms / 1000).toFixed(1)}s`,
      });
      await Promise.all([fetchCalibration(), fetchLog(), fetchStatus()]);
    } catch (err) {
      setToast({ kind: 'error', title: `RETRAIN FAILED · ${market}`, message: err.message });
      await fetchLog();
    } finally {
      setBusyMarket(null);
    }
  }, [headers, fetchCalibration, fetchLog, fetchStatus]);

  const handleRetrainEnsemble = useCallback(async () => {
    setBusyMarket('ensemble');
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/retrain/ensemble`, {
        method: 'POST', headers, body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `http ${r.status}`);
      setToast({
        kind: 'ok', title: 'ENSEMBLE RETRAINED',
        message: `Brier ${fmtBrier(j?.metrics?.brier)} · ${(j.duration_ms / 1000).toFixed(1)}s`,
      });
      await Promise.all([fetchEnsemble(), fetchLog(), fetchStatus()]);
    } catch (err) {
      setToast({ kind: 'error', title: 'ENSEMBLE RETRAIN FAILED', message: err.message });
      await fetchLog();
    } finally {
      setBusyMarket(null);
    }
  }, [headers, fetchEnsemble, fetchLog, fetchStatus]);

  const handleRetrainAll = useCallback(async () => {
    setBusyMarket('all');
    try {
      const r = await fetch(`${API_URL}/api/admin/ml/retrain`, {
        method: 'POST', headers, body: JSON.stringify({ market: 'all' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error ?? `http ${r.status}`);
      setToast({
        kind: 'ok', title: 'RETRAIN ALL OK',
        message: `Completed in ${(j.duration_ms / 1000).toFixed(1)}s — see retrain log for per-market metrics.`,
      });
      await Promise.all([fetchCalibration(), fetchLog(), fetchStatus()]);
    } catch (err) {
      setToast({ kind: 'error', title: 'RETRAIN ALL FAILED', message: err.message });
      await fetchLog();
    } finally {
      setBusyMarket(null);
    }
  }, [headers, fetchCalibration, fetchLog, fetchStatus]);

  // ── Render ────────────────────────────────────────────────────────────────
  const manifest = calibration?.calibration?.manifest ?? null;
  const ensembleManifest = ensemble;
  const rolling = calibration?.rolling_30d ?? [];

  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{CSS}</style>
        <CircularProgress sx={{ color: CYAN }} />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', background: BG, color: INK0, p: { xs: 1.5, md: 3 } }}>
      <style>{CSS}</style>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Back + global retrain */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button
          onClick={onBack}
          sx={{ color: CYAN, fontFamily: MONO, fontSize: '10px', letterSpacing: '2px', border: `1px solid ${BORDER}`, px: 2, py: '6px' }}
        >
          ← BACK
        </Button>
        <Button
          onClick={handleRetrainAll}
          disabled={busyMarket != null}
          sx={{
            border: `1px solid ${ACCENT}`, color: ACCENT, fontFamily: MONO, fontSize: '11px', letterSpacing: '2px',
            px: 2.5, py: '8px', fontWeight: 700,
            '&:hover': { background: `${ACCENT}1A`, boxShadow: `0 0 18px ${ACCENT}50` },
            '&:disabled': { opacity: 0.4, borderColor: MUTED, color: MUTED },
          }}
        >
          {busyMarket === 'all' ? '⟳ TRAINING ALL MARKETS…' : '▶▶ RETRAIN ALL MARKETS'}
        </Button>
      </Box>

      <HUDStatusBar status={status} loading={refreshing} onRefresh={refreshAll} />

      {/* Per-market cards */}
      <SectionTitle>Per-Market Models</SectionTitle>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        {MARKETS.map((m, i) => (
          <MarketCard
            key={m}
            market={m}
            manifest={manifest}
            onRetrain={handleRetrain}
            busy={busyMarket === m || busyMarket === 'all'}
            index={i}
          />
        ))}
      </Box>

      {/* Reliability + rolling */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.4fr 1fr' }, gap: 2, mb: 3 }}>
        <Box sx={{ position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`, p: '16px 14px' }}>
          <CornerBrackets color={CYAN} />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
            <SectionTitle inline>Reliability Diagram</SectionTitle>
            <ToggleButtonGroup
              value={activeMarket}
              exclusive
              size="small"
              onChange={(_, v) => v && setActiveMarket(v)}
              sx={{
                '& .MuiToggleButton-root': {
                  fontFamily: MONO, fontSize: '9px', letterSpacing: '2px',
                  color: MUTED, border: `1px solid ${BORDER}`, py: '4px', px: '10px',
                  '&.Mui-selected': { color: INK0, background: DIM, borderColor: CYAN },
                },
              }}
            >
              {MARKETS.map((m) => (
                <ToggleButton key={m} value={m}>{m.toUpperCase()}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
          <ReliabilityPanel manifest={manifest} market={activeMarket} />
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 1 }}>
            Bars at the dashed 45° line = perfect calibration. Bars below = over-confident. Bars above = under-confident.
          </Typography>
        </Box>

        <Box sx={{ position: 'relative', background: SURFACE, border: `1px solid ${BORDER}`, p: '16px 14px' }}>
          <CornerBrackets color={AMBER} />
          <SectionTitle>Rolling 30d — Legacy vs Python</SectionTitle>
          <Rolling30dChart rolling={rolling} />
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mt: 1 }}>
            Daily moneyline hit-rate from <code>shadow_model_runs</code>. 50% baseline = random.
          </Typography>
        </Box>
      </Box>

      {/* Ensemble */}
      <EnsemblePanel
        ensemble={ensembleManifest}
        onRetrain={handleRetrainEnsemble}
        busy={busyMarket === 'ensemble' || busyMarket === 'all'}
      />

      {/* Chat-sourced picks bucket */}
      <ChatPicksSection stats={chatStats} />

      {/* Retrain audit log */}
      <SectionTitle>Retrain Audit Log</SectionTitle>
      <RetrainLog rows={logRows} />

      {/* Player Props banner — Sprint 5 placeholder */}
      <Box sx={{
        mt: 3, position: 'relative',
        background: `linear-gradient(135deg, ${SURFACE} 0%, ${SURFACE2} 100%)`,
        border: `1px dashed ${ACCENT}66`, p: '16px 18px', overflow: 'hidden',
      }}>
        <CornerBrackets color={ACCENT} />
        <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '3px' }}>
          SPRINT 5 // PLAYER PROPS
        </Typography>
        <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.05rem', fontWeight: 700, color: ACCENT, mt: '4px' }}>
          Hits, Total Bases, Strikeouts — coming soon
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: INK1, mt: 1, maxWidth: 720 }}>
          Player-prop training requires per-batter features (xBA, xSLG, splits vs handedness, recent form 7d/14d) that are
          not yet in the pipeline. A dedicated sprint will extend <code>savant-fetcher</code> with batter leaderboards and
          add per-<code>prop_kind</code> models alongside the existing game-level ones.
        </Typography>
      </Box>

      <Box sx={{ mt: 3, textAlign: 'center', fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '2px' }}>
        HEXA.ML CONTROL CENTER · POLL INTERVAL 10s · LIVE
      </Box>
    </Box>
  );
}

function SectionTitle({ children, inline = false }) {
  return (
    <Typography sx={{
      fontFamily: MONO, fontSize: '10px', letterSpacing: '3px',
      color: MUTED, textTransform: 'uppercase',
      mb: inline ? 0 : 1.5, mt: inline ? 0 : 1,
    }}>
      // {children}
    </Typography>
  );
}
