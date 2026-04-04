import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO, BARLOW } from '../theme';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function StatCard({ label, value, sub, color }) {
  return (
    <Box sx={{ border: `1px solid ${color || C.cyanLine}`, p: '12px 16px', flex: 1, minWidth: '120px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', mb: '4px' }}>{label}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.4rem', fontWeight: 700, color: color || C.cyan }}>{value}</Typography>
      {sub && <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, mt: '2px' }}>{sub}</Typography>}
    </Box>
  );
}

export default function BacktestDashboard({ lang = 'en', onBack }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/api/admin/backtest-stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (json.success) setData(json.data);
        else setError(json.error);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const s = data?.summary;
  const resolved = s ? parseInt(s.wins) + parseInt(s.losses) : 0;
  const winRate = resolved > 0 ? ((parseInt(s.wins) / resolved) * 100).toFixed(1) : '—';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#000', p: { xs: 2, sm: 3 }, maxWidth: '100vw', overflowX: 'hidden' }}>
      <Box component="button" onClick={onBack} sx={{
        background: 'transparent', border: `1px solid ${C.cyanLine}`, color: C.textMuted,
        fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '2px', padding: '6px 14px',
        cursor: 'pointer', mb: 3, '&:hover': { color: C.cyan, borderColor: C.cyan },
      }}>← BACK</Box>

      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.6rem', color: C.accent, letterSpacing: '0.2em', mb: 1 }}>
        ADMIN ONLY · SHADOW MODE
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.3rem', fontWeight: 700, color: C.textPrimary, letterSpacing: '0.08em', mb: 3 }}>
        BACKTEST DASHBOARD
      </Typography>

      {loading && <Typography sx={{ fontFamily: MONO, color: C.textMuted }}>Loading...</Typography>}
      {error && <Typography sx={{ fontFamily: MONO, color: C.red }}>{error}</Typography>}

      {data && (
        <>
          {/* Summary cards */}
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
            <StatCard label="Total Picks" value={s.total} />
            <StatCard label="Win Rate" value={`${winRate}%`} color={parseFloat(winRate) >= 55 ? C.green : parseFloat(winRate) >= 50 ? C.amber : C.red} />
            <StatCard label="Record" value={`${s.wins}W-${s.losses}L`} sub={`${s.pushes}P · ${s.unresolved} unresolved`} />
            <StatCard label="Avg Confidence" value={`${s.avg_confidence}%`} />
            <StatCard label="Avg Latency" value={`${(s.avg_latency_ms / 1000).toFixed(1)}s`} />
          </Box>

          {/* Confidence calibration */}
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, letterSpacing: '0.1em', mb: 1, mt: 3 }}>
            CONFIDENCE CALIBRATION
          </Typography>
          <Box sx={{ border: `1px solid ${C.border}`, mb: 3 }}>
            <Box sx={{ display: 'flex', borderBottom: `1px solid ${C.border}`, p: '8px 12px', gap: 2 }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, flex: 1 }}>BUCKET</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, width: 60, textAlign: 'right' }}>TOTAL</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, width: 60, textAlign: 'right' }}>WINS</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, width: 70, textAlign: 'right' }}>HIT RATE</Typography>
            </Box>
            {(data.byConfidence ?? []).map((row, i) => {
              const total = parseInt(row.wins) + parseInt(row.losses);
              const hr = total > 0 ? ((parseInt(row.wins) / total) * 100).toFixed(1) : '—';
              return (
                <Box key={i} sx={{ display: 'flex', p: '6px 12px', gap: 2, borderBottom: `1px solid ${C.border}`, '&:last-child': { borderBottom: 'none' } }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textPrimary, flex: 1 }}>{row.bucket}%</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textSecondary, width: 60, textAlign: 'right' }}>{row.total}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.green, width: 60, textAlign: 'right' }}>{row.wins}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: parseFloat(hr) >= 55 ? C.green : C.red, width: 70, textAlign: 'right' }}>{hr}%</Typography>
                </Box>
              );
            })}
          </Box>

          {/* By pick type */}
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, letterSpacing: '0.1em', mb: 1 }}>
            BY PICK TYPE
          </Typography>
          <Box sx={{ border: `1px solid ${C.border}`, mb: 3 }}>
            {(data.byType ?? []).map((row, i) => {
              const total = parseInt(row.wins) + parseInt(row.losses);
              const hr = total > 0 ? ((parseInt(row.wins) / total) * 100).toFixed(1) : '—';
              return (
                <Box key={i} sx={{ display: 'flex', p: '6px 12px', gap: 2, borderBottom: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textPrimary, flex: 1, textTransform: 'uppercase' }}>{row.pick_type}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textSecondary }}>{row.wins}W-{row.losses}L</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: parseFloat(hr) >= 55 ? C.green : C.red }}>{hr}%</Typography>
                </Box>
              );
            })}
          </Box>

          {/* By flags */}
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, letterSpacing: '0.1em', mb: 1 }}>
            FLAGS IMPACT
          </Typography>
          <Box sx={{ border: `1px solid ${C.border}`, mb: 3 }}>
            {(data.byFlags ?? []).map((row, i) => {
              const total = parseInt(row.wins) + parseInt(row.losses);
              const hr = total > 0 ? ((parseInt(row.wins) / total) * 100).toFixed(1) : '—';
              const label = row.has_critical_flags ? '⚠ WITH CRITICAL FLAGS' : '✅ CLEAN (no critical flags)';
              return (
                <Box key={i} sx={{ display: 'flex', p: '6px 12px', gap: 2, borderBottom: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: row.has_critical_flags ? C.amber : C.green, flex: 1 }}>{label}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textSecondary }}>{row.wins}W-{row.losses}L</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: parseFloat(hr) >= 55 ? C.green : C.red }}>{hr}%</Typography>
                </Box>
              );
            })}
          </Box>

          {/* Run history */}
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, letterSpacing: '0.1em', mb: 1 }}>
            RUN HISTORY
          </Typography>
          <Box sx={{ border: `1px solid ${C.border}`, mb: 3 }}>
            {(data.runs ?? []).map((run, i) => {
              const total = parseInt(run.wins) + parseInt(run.losses);
              const hr = total > 0 ? ((parseInt(run.wins) / total) * 100).toFixed(1) : '—';
              return (
                <Box key={i} sx={{ display: 'flex', p: '6px 12px', gap: 2, borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.cyan, minWidth: '180px' }}>{run.run_id}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textSecondary }}>{run.date}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textPrimary }}>{run.wins}W-{run.losses}L</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: parseFloat(hr) >= 55 ? C.green : C.red }}>{hr}%</Typography>
                </Box>
              );
            })}
          </Box>

          {/* Recent picks */}
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, letterSpacing: '0.1em', mb: 1 }}>
            RECENT BACKTEST PICKS
          </Typography>
          <Box sx={{ border: `1px solid ${C.border}` }}>
            {(data.recent ?? []).map((pick, i) => (
              <Box key={i} sx={{ p: '8px 12px', borderBottom: `1px solid ${C.border}`, '&:last-child': { borderBottom: 'none' } }}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textPrimary, minWidth: '120px' }}>{pick.matchup}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.cyan }}>{pick.pick}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>{pick.oracle_confidence}%</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', fontWeight: 700,
                    color: pick.actual_result === 'win' ? C.green : pick.actual_result === 'loss' ? C.red : C.amber
                  }}>
                    {pick.actual_result?.toUpperCase() ?? 'PENDING'}
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted }}>
                    {pick.actual_away_score}-{pick.actual_home_score}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>

          <Box sx={{ mt: 4, textAlign: 'center' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted }}>
              GAMBITHO LABS · SHADOW MODE · INTERNAL USE ONLY
            </Typography>
          </Box>
        </>
      )}
    </Box>
  );
}
