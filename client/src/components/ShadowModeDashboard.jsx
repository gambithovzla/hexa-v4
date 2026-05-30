import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { MONO, BARLOW } from '../theme';
import { useHexaTheme } from '../themeProvider';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function StatCard({ label, value, sub, color }) {
  const { C } = useHexaTheme();
  const accent = color ?? C.cyan;
  return (
    <Box sx={{ border: `1px solid ${accent}55`, p: '12px 16px', minWidth: '130px', flex: 1 }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', mb: '4px' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.1rem', fontWeight: 700, color: accent }}>
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

function formatPctProb(prob) {
  const n = Number(prob);
  if (!Number.isFinite(n)) return '';
  const pct = n <= 1 ? n * 100 : n;
  return ` ${pct.toFixed(0)}%`;
}

function renderOracleCell(row) {
  if (row.pick_market_type && row.oracle_pick) {
    const prob = formatPctProb(row.oracle_pick_prob);
    return `${row.oracle_pick}${prob}`;
  }

  const isSafeRun = String(row.analysis_mode ?? '').startsWith('safe');

  if (isSafeRun && row.oracle_pick) {
    return `PICK: ${row.oracle_pick}${row.oracle_confidence != null ? ` (${row.oracle_confidence})` : ''}`;
  }
  if (row.oracle_predicted_winner_abbr) {
    return `${row.oracle_predicted_winner_abbr} ${row.oracle_confidence != null ? `(${row.oracle_confidence})` : ''}`.trim();
  }
  if (row.oracle_pick) {
    return `PICK: ${row.oracle_pick}${row.oracle_confidence != null ? ` (${row.oracle_confidence})` : ''}`;
  }
  return 'N/A';
}

function renderShadowCell(row) {
  if (row.pick_market_type && row.python_pick_prob != null) {
    const market = row.python_pick_market ? ` [${row.python_pick_market}]` : '';
    return `PY${formatPctProb(row.python_pick_prob)}${market}`;
  }
  if (row.pick_market_type && row.legacy_pick_prob != null) {
    return `LEG${formatPctProb(row.legacy_pick_prob)}`;
  }
  if (row.shadow_predicted_winner_abbr) {
    return `${row.shadow_predicted_winner_abbr} ${row.shadow_confidence != null ? `(${row.shadow_confidence})` : ''}`.trim();
  }
  return 'N/A';
}

function resolveAgree(row) {
  if (row.pick_agree_python != null) return row.pick_agree_python;
  return row.agree_with_oracle;
}

export default function ShadowModeDashboard({ onBack }) {
  const { C, isLeague } = useHexaTheme();
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [sport, setSport] = useState(() => localStorage.getItem('hexa_admin_shadow_sport') || 'mlb');

  useEffect(() => {
    localStorage.setItem('hexa_admin_shadow_sport', sport);
  }, [sport]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!token) return;
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_URL}/api/admin/shadow-model?sport=${sport}`, {
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
  }, [token, sport]);

  const summary = data?.summary ?? {};
  const bySource = data?.bySource ?? [];
  const recent = data?.recent ?? [];
  const config = data?.config ?? {};
  const resolvedRuns = Number(summary.resolved_runs ?? 0);
  const disagreeRuns = Number(summary.disagree_runs ?? 0);
  const oracleCorrect = Number(summary.oracle_correct ?? 0);
  const shadowCorrect = Number(summary.shadow_correct ?? 0);

  return (
    <Box className="hexa-themed-page" sx={{ minHeight: '100vh', bgcolor: isLeague ? C.bg : '#000', p: { xs: 2, sm: 3 }, maxWidth: '100vw', overflowX: 'hidden' }}>
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
      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, mb: 2 }}>
        Model: {config.modelKey ?? '—'} v{config.modelVersion ?? '—'} · Enabled: {config.enabled ? 'YES' : 'NO'} · Sport: {config.sport ?? sport}
      </Typography>

      {/* Sport toggle */}
      <Box sx={{ display: 'inline-flex', border: `1px solid ${C.cyanLine}`, mb: 3, overflow: 'hidden' }}>
        {['mlb', 'nba', 'nfl'].map(s => (
          <Box
            key={s}
            component="button"
            onClick={() => setSport(s)}
            sx={{
              px: '14px', py: '5px',
              bgcolor: sport === s ? C.cyan : 'transparent',
              color:   sport === s ? '#0a0d14' : C.textMuted,
              border: 'none',
              fontFamily: MONO, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.14em',
              cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >
            {s.toUpperCase()}
          </Box>
        ))}
      </Box>

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
                    minWidth: '1200px',
                    display: 'grid',
                    gridTemplateColumns: '110px 130px 150px 110px 120px 120px 80px 110px 80px',
                    gap: 1,
                    pb: 1,
                    borderBottom: `1px solid ${C.border}`,
                    mb: 1,
                  }}
                >
                  {['Hora Lima', 'Usuario', 'Matchup', 'Source', 'Oracle', 'Shadow', 'Agree', 'Outcome', 'Status'].map((label) => (
                    <Typography key={label} sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {label}
                    </Typography>
                  ))}
                </Box>

                {recent.map((row) => (
                  <Box
                    key={row.id}
                    sx={{
                      minWidth: '1200px',
                      display: 'grid',
                      gridTemplateColumns: '110px 130px 150px 110px 120px 120px 80px 110px 80px',
                      gap: 1,
                      py: '8px',
                      borderBottom: `1px solid ${C.borderSoft || C.border}`,
                    }}
                  >
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted }}>
                      {(() => {
                        const runAt = row.pick_time_lima
                          ? new Date(row.pick_time_lima).toLocaleString('es-PE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })
                          : formatDateTime(row.created_at);
                        const gameDay = row.game_date
                          ? new Date(`${String(row.game_date).slice(0, 10)}T12:00:00`).toLocaleDateString('es-PE', { month: 'short', day: 'numeric' })
                          : null;
                        return gameDay ? `${runAt} · juego ${gameDay}` : runAt;
                      })()}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.user_email ?? '—'}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textPrimary }}>
                      {row.away_team_abbr} @ {row.home_team_abbr}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textPrimary }}>
                      {row.source_type?.toUpperCase()}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.cyan }}>
                      {renderOracleCell(row)}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: '#FF9900' }}>
                      {renderShadowCell(row)}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: resolveAgree(row) == null ? C.textMuted : resolveAgree(row) ? (C.outcomeWin ?? C.green) : (C.outcomeLoss ?? C.red), fontWeight: 700 }}>
                      {resolveAgree(row) == null ? 'N/A' : resolveAgree(row) ? 'YES' : 'NO'}
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
