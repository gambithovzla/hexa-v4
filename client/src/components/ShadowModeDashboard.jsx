import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO, BARLOW } from '../theme';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function StatCard({ label, value, sub, color = C.cyan }) {
  return (
    <Box sx={{ border: `1px solid ${color}55`, p: '12px 16px', minWidth: '130px', flex: 1 }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', mb: '4px' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.1rem', fontWeight: 700, color }}>
        {value ?? '—'}
      </Typography>
      {sub ? (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, mt: '3px' }}>
          {sub}
        </Typography>
      ) : null}
    </Box>
  );
}

function formatPct(numerator, denominator) {
  const num = Number(numerator ?? 0);
  const den = Number(denominator ?? 0);
  if (!den) return '—';
  return `${((num / den) * 100).toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? String(value)
    : parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderOutcome(row) {
  if (row.actual_status === 'pending') return 'PENDING';
  if (row.actual_home_score == null || row.actual_away_score == null) return row.actual_winner_abbr ?? row.actual_status ?? '—';
  return `${row.actual_winner_abbr ?? '—'} (${row.actual_away_score}-${row.actual_home_score})`;
}

function renderOracleCell(row) {
  if (row.oracle_predicted_winner_abbr) {
    return `${row.oracle_predicted_winner_abbr} ${row.oracle_confidence != null ? `(${row.oracle_confidence})` : ''}`.trim();
  }
  if (row.oracle_pick) {
    return `PICK ONLY: ${row.oracle_pick}${row.oracle_confidence != null ? ` (${row.oracle_confidence})` : ''}`;
  }
  return 'N/A';
}

function renderShadowCell(row) {
  if (row.shadow_predicted_winner_abbr) {
    return `${row.shadow_predicted_winner_abbr} ${row.shadow_confidence != null ? `(${row.shadow_confidence})` : ''}`.trim();
  }
  return 'N/A';
}

export default function ShadowModeDashboard({ onBack }) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!token) return;
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_URL}/api/admin/shadow-model`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Could not load shadow mode dashboard');
        if (!cancelled) setData(json.data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load shadow mode dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  const summary = data?.summary ?? {};
  const bySource = data?.bySource ?? [];
  const recent = data?.recent ?? [];
  const config = data?.config ?? {};
  const resolvedRuns = Number(summary.resolved_runs ?? 0);
  const disagreeRuns = Number(summary.disagree_runs ?? 0);
  const oracleCorrect = Number(summary.oracle_correct ?? 0);
  const shadowCorrect = Number(summary.shadow_correct ?? 0);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#000', p: { xs: 2, sm: 3 }, maxWidth: '100vw', overflowX: 'hidden' }}>
      <Box
        component="button"
        onClick={onBack}
        sx={{
          background: 'transparent',
          border: `1px solid ${C.cyanLine}`,
          color: C.textMuted,
          fontFamily: MONO,
          fontSize: '0.65rem',
          letterSpacing: '2px',
          padding: '6px 14px',
          cursor: 'pointer',
          mb: 3,
          '&:hover': { color: C.cyan },
        }}
      >
        ← BACK
      </Box>

      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.6rem', color: '#FF9900', letterSpacing: '0.2em', mb: 0.5 }}>
        ADMIN · SHADOW MODE
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.15rem', fontWeight: 700, color: C.textPrimary, letterSpacing: '0.08em', mb: 2 }}>
        ORACLE VS SHADOW MODEL
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, mb: 3 }}>
        Model: {config.modelKey ?? '—'} v{config.modelVersion ?? '—'} · Enabled: {config.enabled ? 'YES' : 'NO'}
      </Typography>

      {loading ? <Typography sx={{ fontFamily: MONO, color: C.textMuted }}>Loading...</Typography> : null}
      {error ? <Typography sx={{ fontFamily: MONO, color: C.red }}>{error}</Typography> : null}

      {data ? (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
            <StatCard label="Total Runs" value={summary.total_runs} />
            <StatCard label="Resolved" value={summary.resolved_runs} sub={`${summary.pending_runs ?? 0} pending`} color={C.green} />
            <StatCard label="Disagreement Rate" value={formatPct(disagreeRuns, summary.total_runs)} sub={`${summary.disagree_runs ?? 0} disagreements`} color={C.amber} />
            <StatCard label="Oracle Accuracy" value={formatPct(oracleCorrect, resolvedRuns)} sub={`${summary.oracle_correct ?? 0}/${resolvedRuns || 0}`} />
            <StatCard label="Shadow Accuracy" value={formatPct(shadowCorrect, resolvedRuns)} sub={`${summary.shadow_correct ?? 0}/${resolvedRuns || 0}`} color="#FF9900" />
            <StatCard label="Shadow Edge" value={summary.shadow_only_correct ?? 0} sub={`Oracle only: ${summary.oracle_only_correct ?? 0}`} color={C.accent} />
          </Box>

          <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface, p: '14px 16px', mb: 3 }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.cyan, letterSpacing: '0.1em', mb: 1.5 }}>
              BY SOURCE
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {bySource.map((row) => (
                <StatCard
                  key={row.source_type}
                  label={row.source_type}
                  value={row.total}
                  sub={`${row.resolved} resolved · ${row.disagreements} disagreements`}
                  color={row.source_type === 'backtest' ? '#FF9900' : C.cyan}
                />
              ))}
            </Box>
          </Box>

          <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface, p: '14px 16px' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.cyan, letterSpacing: '0.1em', mb: 1.5 }}>
              RECENT RUNS
            </Typography>

            {recent.length === 0 ? (
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
                No shadow runs yet.
              </Typography>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Box
                  sx={{
                    minWidth: '980px',
                    display: 'grid',
                    gridTemplateColumns: '130px 90px 110px 120px 120px 90px 110px 90px',
                    gap: 1,
                    pb: 1,
                    borderBottom: `1px solid ${C.border}`,
                    mb: 1,
                  }}
                >
                  {['Time', 'Source', 'Matchup', 'Oracle', 'Shadow', 'Agree', 'Outcome', 'Status'].map((label) => (
                    <Typography key={label} sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {label}
                    </Typography>
                  ))}
                </Box>

                {recent.map((row) => (
                  <Box
                    key={row.id}
                    sx={{
                      minWidth: '980px',
                      display: 'grid',
                      gridTemplateColumns: '130px 90px 110px 120px 120px 90px 110px 90px',
                      gap: 1,
                      py: '8px',
                      borderBottom: `1px solid ${C.borderSoft || C.border}`,
                    }}
                  >
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted }}>
                      {formatDateTime(row.created_at)}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textPrimary }}>
                      {row.source_type?.toUpperCase()}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textPrimary }}>
                      {row.away_team_abbr} @ {row.home_team_abbr}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.cyan }}>
                      {renderOracleCell(row)}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: '#FF9900' }}>
                      {renderShadowCell(row)}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: row.agree_with_oracle == null ? C.textMuted : row.agree_with_oracle ? C.green : C.red }}>
                      {row.agree_with_oracle == null ? 'N/A' : row.agree_with_oracle ? 'YES' : 'NO'}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textPrimary }}>
                      {renderOutcome(row)}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: row.actual_status === 'pending' ? C.textMuted : C.green }}>
                      {String(row.actual_status ?? 'pending').toUpperCase()}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </>
      ) : null}
    </Box>
  );
}
