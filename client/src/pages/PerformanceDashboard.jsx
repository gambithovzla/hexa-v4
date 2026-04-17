/**
 * PerformanceDashboard.jsx — H.E.X.A. V4
 *
 * PUBLIC page — no auth required.
 * Shows verified oracle pick performance: win rate, ROI, unit profit,
 * breakdown by bet type / model, and a cumulative ROI curve chart.
 *
 * Props:
 *   onBack — () => void  (returns user to main app)
 */

import { useState, useEffect, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import {
  LineChart, Line, XAxis, YAxis, ReferenceLine,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { C, MONO, DISPLAY } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Design tokens (local shortcuts) ──────────────────────────────────────────
const BG      = '#0a0e1a';          // page background (slightly lighter than absolute black)
const SURFACE = '#07090E';
const BORDER  = 'rgba(0,217,255,0.18)';
const CYAN    = '#00D9FF';
const GREEN   = '#00FF88';
const RED     = '#FF2244';
const AMBER   = '#FF9900';
const MUTED   = 'rgba(0,217,255,0.45)';
const DIM     = 'rgba(0,217,255,0.2)';

// ── Keyframe injection ────────────────────────────────────────────────────────
const CSS = `
@keyframes pd-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
@keyframes pd-fadeIn { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
`;

// ── Sub-components ────────────────────────────────────────────────────────────

/** Stat card — large centered number with a label */
function StatCard({ label, value, color = CYAN, sub }) {
  return (
    <Box sx={{
      background:    SURFACE,
      border:        `1px solid ${BORDER}`,
      borderRadius:  0,
      p:             '20px 16px',
      position:      'relative',
      flex:          1,
      minWidth:      0,
      animation:     'pd-fadeIn 0.4s ease both',
      '&::before': {
        content:   '""',
        position:  'absolute',
        top: 0, left: 0,
        width: 10, height: 10,
        borderTop:  `2px solid ${CYAN}`,
        borderLeft: `2px solid ${CYAN}`,
      },
      '&::after': {
        content:   '""',
        position:  'absolute',
        bottom: 0, right: 0,
        width: 10, height: 10,
        borderBottom: `2px solid ${C.accent}`,
        borderRight:  `2px solid ${C.accent}`,
      },
    }}>
      {/* Label */}
      <Typography sx={{
        fontFamily:    MONO,
        fontSize:      '9px',
        letterSpacing: '3px',
        color:         MUTED,
        mb:            '8px',
        textTransform: 'uppercase',
      }}>
        {label}
      </Typography>

      {/* Value */}
      <Typography sx={{
        fontFamily:  MONO,
        fontSize:    { xs: '28px', sm: '34px' },
        fontWeight:  700,
        color,
        lineHeight:  1,
        textShadow:  `0 0 12px ${color}55`,
        letterSpacing: '-0.5px',
      }}>
        {value}
      </Typography>

      {/* Sub-label */}
      {sub && (
        <Typography sx={{
          fontFamily: MONO,
          fontSize:   '10px',
          color:      DIM,
          mt:         '6px',
        }}>
          {sub}
        </Typography>
      )}
    </Box>
  );
}

/** Skeleton shimmer block */
function Skeleton({ width = '100%', height = 24, mb = 0 }) {
  return (
    <Box sx={{
      width, height,
      background: `linear-gradient(90deg, ${SURFACE} 0%, rgba(0,217,255,0.05) 50%, ${SURFACE} 100%)`,
      backgroundSize: '200% 100%',
      animation: 'pd-pulse 1.4s ease infinite',
      borderRadius: 0,
      mb: `${mb}px`,
    }} />
  );
}

/** Period filter pill button */
function PeriodBtn({ label, active, onClick }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        fontFamily:    MONO,
        fontSize:      '11px',
        letterSpacing: '2px',
        px:            '14px',
        py:            '6px',
        border:        `1px solid ${active ? CYAN : BORDER}`,
        background:    active ? `rgba(0,217,255,0.1)` : 'transparent',
        color:         active ? CYAN : MUTED,
        cursor:        'pointer',
        outline:       'none',
        borderRadius:  0,
        transition:    'all 0.15s',
        textShadow:    active ? `0 0 8px ${CYAN}` : 'none',
        '&:hover': {
          borderColor: CYAN,
          color:       CYAN,
        },
      }}
    >
      {label}
    </Box>
  );
}

/** Minimal breakdown table */
function BreakdownTable({ title, rows, cols }) {
  return (
    <Box sx={{
      flex:       1,
      minWidth:   0,
      background: SURFACE,
      border:     `1px solid ${BORDER}`,
      p:          '16px',
    }}>
      {/* Table title */}
      <Typography sx={{
        fontFamily:    MONO,
        fontSize:      '8px',
        letterSpacing: '3px',
        color:         MUTED,
        mb:            '12px',
        textTransform: 'uppercase',
      }}>
        {title}
      </Typography>

      {/* Header row */}
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, mb: '6px' }}>
        {cols.map(c => (
          <Typography key={c} sx={{
            fontFamily:    MONO,
            fontSize:      '8px',
            letterSpacing: '2px',
            color:         DIM,
            textTransform: 'uppercase',
          }}>
            {c}
          </Typography>
        ))}
      </Box>

      {/* Divider */}
      <Box sx={{ borderTop: `1px solid ${DIM}`, mb: '8px' }} />

      {/* Data rows */}
      {rows.length === 0 ? (
        <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: DIM }}>—</Typography>
      ) : rows.map((row, i) => (
        <Box key={i} sx={{
          display:             'grid',
          gridTemplateColumns: `repeat(${cols.length}, 1fr)`,
          py:                  '4px',
          borderBottom:        i < rows.length - 1 ? `1px solid rgba(0,217,255,0.06)` : 'none',
        }}>
          {row.map((cell, j) => (
            <Typography key={j} sx={{
              fontFamily: MONO,
              fontSize:   '12px',
              color:      j === 0 ? C.textPrimary : MUTED,
              fontWeight: j === 0 ? 600 : 400,
            }}>
              {cell}
            </Typography>
          ))}
        </Box>
      ))}
    </Box>
  );
}

/** Custom recharts tooltip */
function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const roiColor = d.cumulativeRoi >= 0 ? GREEN : RED;
  return (
    <Box sx={{
      background: '#0a0e1a',
      border:     `1px solid ${BORDER}`,
      p:          '8px 12px',
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, mb: '2px' }}>
        PICK #{d.pickNumber}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '13px', color: roiColor }}>
        {d.cumulativeRoi >= 0 ? '+' : ''}{d.cumulativeRoi.toFixed(2)}%
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: DIM, mt: '2px' }}>
        {d.result?.toUpperCase()}
      </Typography>
    </Box>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PERIODS = [
  { label: '7D',           value: '7'      },
  { label: '30D',          value: '30'     },
  { label: '2026 SEASON',  value: 'season' },
];

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
}

function signedPct(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function signedU(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}u`;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PerformanceDashboard({ onBack, isAdmin = false, performancePublic = false, onTogglePublic }) {
  const [period,    setPeriod]    = useState('30');
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  const fetchStats = useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('hexa_token');
      const res = await fetch(`${API_URL}/api/picks/public-stats?period=${p}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Unknown error');
      setData(json.data);
      setFetchedAt(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats(period);
  }, [period, fetchStats]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const positiveRoi = data && data.roi >= 0;
  const roiLineColor = positiveRoi ? CYAN : RED;

  const byTypeRows = data
    ? Object.entries(data.breakdown?.byType ?? {}).map(([type, s]) => [
        capitalize(type),
        String(s.wins),
        String(s.losses),
        `${s.winRate.toFixed(1)}%`,
      ])
    : [];

  const byModelRows = data
    ? Object.entries(data.breakdown?.byModel ?? {}).map(([model, s]) => [
        capitalize(model),
        String(s.wins),
        String(s.losses),
        `${s.roi >= 0 ? '+' : ''}${s.roi.toFixed(1)}%`,
      ])
    : [];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Box sx={{
      minHeight:   '100vh',
      bgcolor:     BG,
      color:       C.textPrimary,
      fontFamily:  MONO,
      px:          { xs: 2, sm: 4, md: 6 },
      py:          4,
    }}>
      {/* Inject keyframes */}
      <style>{CSS}</style>

      {/* ── Back button ──────────────────────────────────────────────────────── */}
      {onBack && (
        <Box
          component="button"
          onClick={onBack}
          sx={{
            fontFamily:    MONO,
            fontSize:      '10px',
            letterSpacing: '2px',
            color:         MUTED,
            background:    'transparent',
            border:        'none',
            cursor:        'pointer',
            mb:            3,
            px:            0,
            display:       'flex',
            alignItems:    'center',
            gap:           '6px',
            '&:hover':     { color: CYAN },
          }}
        >
          ← BACK
        </Box>
      )}

      {/* ── HEADER ───────────────────────────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        {/* Eyebrow label */}
        <Typography sx={{
          fontFamily:    MONO,
          fontSize:      '9px',
          letterSpacing: '4px',
          color:         C.accent,
          textTransform: 'uppercase',
          mb:            '8px',
        }}>
          // GAMBITHO LABS · H.E.X.A. V4
        </Typography>

        {/* Main title */}
        <Typography sx={{
          fontFamily:    DISPLAY,
          fontSize:      { xs: '26px', sm: '36px', md: '44px' },
          fontWeight:    800,
          letterSpacing: '4px',
          color:         CYAN,
          textShadow:    `0 0 20px ${CYAN}66`,
          lineHeight:    1.1,
          mb:            '10px',
        }}>
          ORACLE PERFORMANCE
        </Typography>

        {/* Subtitle */}
        <Typography sx={{
          fontFamily:    MONO,
          fontSize:      { xs: '12px', sm: '14px' },
          color:         MUTED,
          letterSpacing: '1px',
          mb:            3,
        }}>
          Verified saved picks. Resolved results only. No cherry-picking.
        </Typography>

        {/* Period filters + timestamp row */}
        <Box sx={{
          display:    'flex',
          alignItems: 'center',
          flexWrap:   'wrap',
          gap:        '8px',
          mb:         '10px',
        }}>
          {PERIODS.map(p => (
            <PeriodBtn
              key={p.value}
              label={p.label}
              active={period === p.value}
              onClick={() => setPeriod(p.value)}
            />
          ))}
        </Box>

        {/* Last updated */}
        <Typography sx={{
          fontFamily:    MONO,
          fontSize:      '9px',
          letterSpacing: '1.5px',
          color:         DIM,
        }}>
          LAST UPDATED: {fetchedAt ? fmtTs(fetchedAt) : '—'}
        </Typography>

        {isAdmin && (
          <Box sx={{
            mt: '14px',
            p: '10px 14px',
            border: `1px solid ${C.accentLine}`,
            background: C.accentDim,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '12px',
          }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '2px', color: C.accent, textTransform: 'uppercase' }}>
              ADMIN · PUBLIC VISIBILITY
            </Typography>
            <Box
              component="button"
              onClick={async () => {
                const next = !performancePublic;
                try {
                  const token = localStorage.getItem('hexa_token');
                  const res = await fetch(`${API_URL}/api/settings/performance-public`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ enabled: next }),
                  });
                  const json = await res.json();
                  if (json.success && typeof onTogglePublic === 'function') onTogglePublic(Boolean(json.enabled));
                } catch { /* noop */ }
              }}
              sx={{
                fontFamily: MONO,
                fontSize: '10px',
                letterSpacing: '2px',
                px: '10px',
                py: '4px',
                border: `1px solid ${performancePublic ? CYAN : C.border}`,
                background: performancePublic ? `${CYAN}22` : 'transparent',
                color: performancePublic ? CYAN : MUTED,
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {performancePublic ? 'PUBLIC · ON' : 'PUBLIC · OFF'}
            </Box>
          </Box>
        )}
      </Box>

      {/* ── ERROR STATE ──────────────────────────────────────────────────────── */}
      {error && (
        <Box sx={{
          border:  `1px solid ${C.redLine}`,
          p:       '16px',
          mb:      3,
          background: C.redDim,
        }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '12px', color: RED }}>
            ERROR: {error}
          </Typography>
        </Box>
      )}

      {/* ── LOADING SKELETON ─────────────────────────────────────────────────── */}
      {loading && (
        <Box>
          {/* Stat cards skeleton */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            {[...Array(4)].map((_, i) => (
              <Box key={i} sx={{ flex: 1, minWidth: '140px', border: `1px solid ${BORDER}`, p: '20px 16px', background: SURFACE }}>
                <Skeleton height={10} mb={12} />
                <Skeleton height={36} mb={8} />
                <Skeleton width="60%" height={10} />
              </Box>
            ))}
          </Box>
          {/* Tables skeleton */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            {[...Array(2)].map((_, i) => (
              <Box key={i} sx={{ flex: 1, minWidth: '200px', border: `1px solid ${BORDER}`, p: '16px', background: SURFACE }}>
                <Skeleton height={10} mb={16} />
                {[...Array(4)].map((_, j) => <Skeleton key={j} height={16} mb={8} />)}
              </Box>
            ))}
          </Box>
          {/* Chart skeleton */}
          <Box sx={{ border: `1px solid ${BORDER}`, p: '16px', background: SURFACE, height: 220 }}>
            <Skeleton height={10} mb={16} />
            <Skeleton height={160} />
          </Box>
        </Box>
      )}

      {/* ── LOW DATA STATE ───────────────────────────────────────────────────── */}
      {!loading && !error && data && data.totalPicks < 10 && (
        <Box sx={{
          border:     `1px solid ${BORDER}`,
          p:          '40px 24px',
          textAlign:  'center',
          background: SURFACE,
        }}>
          <Typography sx={{
            fontFamily:    MONO,
            fontSize:      '20px',
            color:         MUTED,
            letterSpacing: '2px',
            mb:            '10px',
          }}>
            ◌
          </Typography>
          <Typography sx={{
            fontFamily:    MONO,
            fontSize:      '13px',
            color:         MUTED,
            letterSpacing: '1px',
          }}>
            Not enough data yet — check back soon.
          </Typography>
          <Typography sx={{
            fontFamily: MONO,
            fontSize:   '10px',
            color:      DIM,
            mt:         '8px',
          }}>
            ({data.totalPicks} resolved pick{data.totalPicks !== 1 ? 's' : ''} in this window · need at least 10)
          </Typography>
        </Box>
      )}

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────────── */}
      {!loading && !error && data && data.totalPicks >= 10 && (
        <Box sx={{ animation: 'pd-fadeIn 0.4s ease' }}>

          {/* ── STATS GRID ─────────────────────────────────────────────────── */}
          <Box sx={{
            display:  'flex',
            gap:      2,
            mb:       3,
            flexWrap: 'wrap',
          }}>
            <StatCard
              label="WIN RATE"
              value={`${data.winRate.toFixed(1)}%`}
              color={CYAN}
              sub={`${data.wins + data.losses} decided picks`}
            />
            <StatCard
              label="RECORD"
              value={`${data.wins}-${data.losses}-${data.pushes}`}
              color={C.textPrimary}
              sub="W · L · P"
            />
            <StatCard
              label="ROI"
              value={signedPct(data.roi)}
              color={data.roi >= 0 ? GREEN : RED}
              sub="flat 1-unit stake"
            />
            <StatCard
              label="UNITS"
              value={signedU(data.unitProfit)}
              color={data.unitProfit >= 0 ? GREEN : RED}
              sub={`over ${data.totalPicks} picks`}
            />
          </Box>

          {/* ── BREAKDOWN TABLES ─────────────────────────────────────────────── */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            <BreakdownTable
              title="BY BET TYPE"
              cols={['Type', 'W', 'L', 'Win%']}
              rows={byTypeRows}
            />
            <BreakdownTable
              title="BY MODEL"
              cols={['Model', 'W', 'L', 'ROI%']}
              rows={byModelRows}
            />
          </Box>

          {/* ── ROI CURVE CHART ──────────────────────────────────────────────── */}
          <Box sx={{
            background: SURFACE,
            border:     `1px solid ${BORDER}`,
            p:          '16px',
            position:   'relative',
            '&::before': {
              content: '""', position: 'absolute',
              top: 0, left: 0, width: 10, height: 10,
              borderTop: `2px solid ${CYAN}`, borderLeft: `2px solid ${CYAN}`,
            },
            '&::after': {
              content: '""', position: 'absolute',
              bottom: 0, right: 0, width: 10, height: 10,
              borderBottom: `2px solid ${C.accent}`, borderRight: `2px solid ${C.accent}`,
            },
          }}>
            {/* Chart header */}
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 2 }}>
              <Typography sx={{
                fontFamily:    MONO,
                fontSize:      '8px',
                letterSpacing: '3px',
                color:         MUTED,
                textTransform: 'uppercase',
              }}>
                ROI CURVE
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: DIM }}>
                cumulative ROI % per pick
              </Typography>
            </Box>

            {/* Chart */}
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                data={data.roiCurve}
                margin={{ top: 4, right: 12, bottom: 0, left: 0 }}
              >
                {/* Zero reference */}
                <ReferenceLine
                  y={0}
                  stroke="rgba(255,255,255,0.12)"
                  strokeDasharray="4 4"
                />

                <XAxis
                  dataKey="pickNumber"
                  tick={{ fontFamily: MONO, fontSize: 9, fill: DIM }}
                  axisLine={{ stroke: DIM }}
                  tickLine={false}
                  label={{
                    value: 'Pick #',
                    position: 'insideBottomRight',
                    offset: -4,
                    style: { fontFamily: MONO, fontSize: 9, fill: DIM },
                  }}
                />

                <YAxis
                  tick={{ fontFamily: MONO, fontSize: 9, fill: DIM }}
                  axisLine={{ stroke: DIM }}
                  tickLine={false}
                  tickFormatter={v => `${v >= 0 ? '+' : ''}${v}%`}
                  width={46}
                />

                <Tooltip content={<ChartTooltip />} />

                <Line
                  type="monotone"
                  dataKey="cumulativeRoi"
                  stroke={roiLineColor}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{
                    r:           4,
                    fill:        roiLineColor,
                    stroke:      BG,
                    strokeWidth: 2,
                  }}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Legend */}
            <Box sx={{ mt: 1, display: 'flex', gap: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Box sx={{ width: 12, height: 2, background: roiLineColor, boxShadow: `0 0 4px ${roiLineColor}` }} />
                <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: DIM }}>
                  CUMULATIVE ROI
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Box sx={{ width: 12, height: 2, background: 'rgba(255,255,255,0.12)', borderTop: '1px dashed rgba(255,255,255,0.12)' }} />
                <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: DIM }}>
                  BREAKEVEN
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* ── Footer note ──────────────────────────────────────────────────── */}
          <Box sx={{ mt: 3, pt: '12px', borderTop: `1px solid ${DIM}` }}>
            <Typography sx={{
              fontFamily: MONO,
              fontSize:   '9px',
              color:      'rgba(255,102,0,0.7)',
              letterSpacing: '1px',
            }}>
              ROI calculated using flat 1-unit stakes · American odds · Won: profit = odds/100 (+ odds) or 100/|odds| (− odds) · Push = 0u
            </Typography>
          </Box>

        </Box>
      )}
    </Box>
  );
}
