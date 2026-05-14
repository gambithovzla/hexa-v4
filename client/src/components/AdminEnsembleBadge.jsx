/**
 * AdminEnsembleBadge.jsx — admin-only ML breakdown for a single pick.
 *
 * Rendered as a collapsed chip below each PickCard when the viewer is an
 * admin. Clicking expands to show the 3-source probabilities (Oracle /
 * Legacy / Python XGBoost), the ensemble's combined probability, the
 * learned weights, and a green/red correctness mark when the game is
 * already resolved.
 *
 * Data comes from GET /api/admin/picks/:pickId/ensemble-breakdown which
 * reads the latest shadow_model_runs row for the pick and (when all 3
 * sources are present) calls the Python ensemble in real time.
 *
 * Lazy: only fetches when expanded.
 *
 * Props:
 *   pickId  number  required
 *   token   string  JWT
 */

import { useState, useCallback } from 'react';
import { Box, Typography, CircularProgress, Tooltip } from '@mui/material';
import { C, MONO, DISPLAY } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const KEYFRAMES = `
@keyframes aeb-fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
`;

const COLORS = {
  oracle:   C.amber,
  legacy:   C.accent,
  python:   C.cyan,
  ensemble: C.green,
};

const LABELS = {
  oracle:   'ORACLE',
  legacy:   'LEGACY',
  python:   'PYTHON',
  ensemble: 'ENSEMBLE',
};

function fmtPct(p) {
  if (p == null || !Number.isFinite(Number(p))) return '—';
  return `${(Number(p) * 100).toFixed(1)}%`;
}

function fmtWeight(w) {
  if (w == null || !Number.isFinite(Number(w))) return '—';
  const n = Number(w);
  return `${n >= 0 ? '+' : ''}${n.toFixed(3)}`;
}

function ProbBar({ label, value, color, correct = null }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, Number(value))) * 100;
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '4px' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: C.ink2, letterSpacing: '2px' }}>
          {label}
          {correct === true  && <span style={{ color: C.green, marginLeft: 6 }}>✓</span>}
          {correct === false && <span style={{ color: C.red,   marginLeft: 6 }}>✗</span>}
        </Typography>
        <Typography sx={{ fontFamily: DISPLAY, fontSize: '11px', color, fontWeight: 700 }}>
          {fmtPct(value)}
        </Typography>
      </Box>
      <Box sx={{ position: 'relative', height: 4, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
        <Box sx={{
          position: 'absolute', top: 0, left: 0, height: '100%', width: `${pct}%`,
          background: color, opacity: value == null ? 0.15 : 1,
          transition: 'width 0.4s ease-out',
          boxShadow: value != null ? `0 0 8px ${color}80` : 'none',
        }} />
      </Box>
    </Box>
  );
}

export default function AdminEnsembleBadge({ pickId, token }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [data, setData]         = useState(null);
  const [error, setError]       = useState(null);

  const load = useCallback(async () => {
    if (data || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_URL}/api/admin/picks/${pickId}/ensemble-breakdown`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `http ${r.status}`);
      setData(j);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [pickId, token, data, loading]);

  const toggle = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    if (next) load();
  }, [expanded, load]);

  if (!pickId || !token) return null;

  return (
    <Box sx={{ mt: '8px' }}>
      <style>{KEYFRAMES}</style>
      <Box
        component="button"
        type="button"
        onClick={toggle}
        sx={{
          width: '100%', cursor: 'pointer', background: 'transparent',
          border: `1px solid ${C.cyanLine}`,
          color: C.cyan, fontFamily: MONO, fontSize: '8px',
          letterSpacing: '2.5px', textTransform: 'uppercase',
          py: '6px', px: '10px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          transition: 'all 0.2s',
          '&:hover': { background: C.cyanDim, borderColor: C.cyan },
        }}
      >
        <span>
          <span style={{ marginRight: 6 }}>{expanded ? '▼' : '▶'}</span>
          ADMIN // ML BREAKDOWN
        </span>
        <span style={{ color: C.ink2, fontSize: '7px' }}>SHADOW + ENSEMBLE</span>
      </Box>

      {expanded && (
        <Box sx={{
          mt: '6px',
          background: C.bg1, border: `1px solid ${C.cyanLine}`,
          p: '12px 14px',
          animation: 'aeb-fadeIn 0.25s both',
        }}>
          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
              <CircularProgress size={12} sx={{ color: C.cyan }} />
              <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.ink2 }}>
                Querying shadow_model_runs…
              </Typography>
            </Box>
          )}

          {error && (
            <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.red }}>
              ERROR: {error}
            </Typography>
          )}

          {!loading && !error && data && data.sources == null && (
            <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.ink2, py: 1 }}>
              {data.reason ?? 'No shadow run available for this pick yet.'}
            </Typography>
          )}

          {!loading && !error && data?.sources && (
            <>
              <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: C.ink2, letterSpacing: '2px', mb: 1 }}>
                P(HOME WIN) — PER SOURCE
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <ProbBar
                  label={LABELS.oracle}
                  value={data.sources.oracle}
                  color={COLORS.oracle}
                  correct={data.resolution?.oracle_correct}
                />
                <ProbBar
                  label={LABELS.legacy}
                  value={data.sources.legacy}
                  color={COLORS.legacy}
                  correct={data.resolution?.legacy_correct}
                />
                <ProbBar
                  label={LABELS.python}
                  value={data.sources.python}
                  color={COLORS.python}
                  correct={data.resolution?.python_correct}
                />
                {data.ensemble && (
                  <ProbBar
                    label={LABELS.ensemble}
                    value={data.ensemble.probability}
                    color={COLORS.ensemble}
                    correct={data.resolution?.ensemble_correct}
                  />
                )}
              </Box>

              {data.ensemble?.weights && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: C.ink2, letterSpacing: '2px', mb: '6px' }}>
                    ENSEMBLE WEIGHTS — Σ in logit space
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <WeightChip label="oracle"    value={data.ensemble.weights.oracle} />
                    <WeightChip label="legacy"    value={data.ensemble.weights.legacy} />
                    <WeightChip label="python"    value={data.ensemble.weights.python} />
                    <WeightChip label="intercept" value={data.ensemble.weights.intercept} />
                  </Box>
                  <Tooltip
                    title="Logit-space coefficients learned by the meta-learner. Positive = source agrees with truth; negative = inverted. Higher absolute value = more weight assigned to that source."
                    placement="top"
                  >
                    <Typography sx={{
                      fontFamily: MONO, fontSize: '7.5px', color: C.ink3, mt: '6px',
                      letterSpacing: '1.5px', cursor: 'help', textTransform: 'uppercase',
                    }}>
                      ⓘ what do these mean?
                    </Typography>
                  </Tooltip>
                </Box>
              )}

              {data.resolution && (
                <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: C.ink2, mt: 1.5, letterSpacing: '1.5px' }}>
                  FINAL · {data.teams?.away ?? '?'} {data.resolution.actual_away_score} @
                  {' '}{data.teams?.home ?? '?'} {data.resolution.actual_home_score} ·
                  {' '}home {data.resolution.home_won ? 'WON' : 'LOST'}
                </Typography>
              )}

              {!data.ensemble && data.sources && (
                <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: C.amber, mt: 1.5 }}>
                  Ensemble not applied — need all 3 sources + ENSEMBLE_ENABLED=true.
                </Typography>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

function WeightChip({ label, value }) {
  const num = Number(value);
  const valid = Number.isFinite(num);
  const tint = !valid ? C.ink2 : num > 0 ? C.green : num < 0 ? C.red : C.ink2;
  return (
    <Box sx={{
      px: '8px', py: '4px', border: `1px solid ${tint}`,
      background: 'transparent', minWidth: 72,
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '7px', color: C.ink2, letterSpacing: '1.5px' }}>
        {label.toUpperCase()}
      </Typography>
      <Typography sx={{ fontFamily: DISPLAY, fontSize: '11px', color: tint, fontWeight: 700 }}>
        {fmtWeight(value)}
      </Typography>
    </Box>
  );
}
