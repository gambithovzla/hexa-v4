import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO, BARLOW } from '../theme';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function StatCard({ label, value, sub, color }) {
  return (
    <Box sx={{ border: `1px solid ${color || C.cyanLine}`, p: '12px 16px', flex: 1, minWidth: '110px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', mb: '4px' }}>{label}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.2rem', fontWeight: 700, color: color || C.cyan }}>{value ?? '—'}</Typography>
      {sub && <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, mt: '2px' }}>{sub}</Typography>}
    </Box>
  );
}

function CoverageBar({ label, count, total }) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(0) : 0;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: '6px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, width: '140px' }}>{label}</Typography>
      <Box sx={{ flex: 1, height: '8px', background: C.surface, border: `1px solid ${C.border}`, position: 'relative' }}>
        <Box sx={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${pct}%`, background: pct > 80 ? C.green : pct > 50 ? C.amber : C.red, transition: 'width 0.3s' }} />
      </Box>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: pct > 80 ? C.green : pct > 50 ? C.amber : C.red, width: '40px', textAlign: 'right' }}>{pct}%</Typography>
    </Box>
  );
}

export default function DatasetDashboard({ lang = 'en', onBack }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState('');

  async function fetchDashboard() {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/feature-store`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDashboard();
  }, [token]);

  async function runBackfill() {
    setBackfilling(true);
    setBackfillMessage('Running feature-store backfill...');
    try {
      const res = await fetch(`${API_URL}/api/admin/feature-store/backfill`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Backfill failed');
      const summary = json.data ?? {};
      setBackfillMessage(`Backfill complete: ${summary.rebuilt ?? 0} rebuilt, ${summary.failed ?? 0} failed, ${summary.scanned ?? 0} scanned.`);
      await fetchDashboard();
    } catch (err) {
      setBackfillMessage(err.message || 'Backfill failed');
    } finally {
      setBackfilling(false);
    }
  }

  const s = data?.summary;
  const fc = data?.featureCoverage;
  const sc = data?.statcastCache;
  const total = parseInt(fc?.total ?? 0);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#000', p: { xs: 2, sm: 3 }, maxWidth: '100vw', overflowX: 'hidden' }}>
      <Box component="button" onClick={onBack} sx={{
        background: 'transparent', border: `1px solid ${C.cyanLine}`, color: C.textMuted,
        fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '2px', padding: '6px 14px',
        cursor: 'pointer', mb: 3, '&:hover': { color: C.cyan },
      }}>← BACK</Box>

      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.6rem', color: C.accent, letterSpacing: '0.2em', mb: 0.5 }}>
        ADMIN · ML TRAINING DATA
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.2rem', fontWeight: 700, color: C.textPrimary, letterSpacing: '0.08em', mb: 3 }}>
        FEATURE STORE & DATASET
      </Typography>

      {loading && <Typography sx={{ fontFamily: MONO, color: C.textMuted }}>Loading...</Typography>}

      {data && (
        <>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
            <StatCard label="Total Records" value={s?.total_records} />
            <StatCard label="Real Picks" value={s?.from_real_picks} color={C.green} />
            <StatCard label="Backtests" value={s?.from_backtests} color={C.amber} />
            <StatCard label="Pending" value={s?.pending} />
            <StatCard label="Win/Loss" value={`${s?.wins ?? 0}W-${s?.losses ?? 0}L`} />
            <StatCard label="Date Range" value={`${s?.earliest_date?.split('T')[0] ?? '—'} → ${s?.latest_date?.split('T')[0] ?? '—'}`} />
          </Box>

          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, letterSpacing: '0.1em', mb: 1 }}>
            STATCAST CACHE STATUS (live system)
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
            <StatCard label="Years Loaded" value={(sc?.yearsLoaded ?? []).join(', ') || 'â€”'} color={C.green} />
            <StatCard label="Pitcher xStats" value={sc?.recordCounts?.xStatsPitcher ?? 0} color={C.green} />
            <StatCard label="Batter xStats" value={sc?.recordCounts?.xStatsBatter ?? 0} color={C.green} />
            <StatCard label="Pitch Arsenal" value={sc?.recordCounts?.pitchArsenal ?? 0} color={C.green} />
            <StatCard label="Rolling Pitcher" value={sc?.recordCounts?.rollingPitcher ?? 0} color={C.green} />
            <StatCard label="Rolling Batter" value={sc?.recordCounts?.rollingBatter ?? 0} color={C.green} />
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
            <Box component="button" onClick={runBackfill} disabled={backfilling} sx={{
              background: 'transparent',
              border: `1px solid ${backfilling ? C.border : C.accent}`,
              color: backfilling ? C.textMuted : C.accent,
              fontFamily: MONO,
              fontSize: '0.6rem',
              letterSpacing: '0.12em',
              padding: '8px 12px',
              cursor: backfilling ? 'default' : 'pointer',
            }}>
              {backfilling ? 'RUNNING...' : 'RUN BACKFILL'}
            </Box>
            {backfillMessage && (
              <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted }}>
                {backfillMessage}
              </Typography>
            )}
          </Box>

          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, letterSpacing: '0.1em', mb: 1 }}>
            FEATURE COVERAGE (saved ML dataset only)
          </Typography>
          <Box sx={{ border: `1px solid ${C.border}`, p: 2, mb: 3 }}>
            <CoverageBar label="Home P xwOBA" count={parseInt(fc?.has_home_xwoba ?? 0)} total={total} />
            <CoverageBar label="Away P xwOBA" count={parseInt(fc?.has_away_xwoba ?? 0)} total={total} />
            <CoverageBar label="Home P Whiff%" count={parseInt(fc?.has_home_whiff ?? 0)} total={total} />
            <CoverageBar label="Home Lineup xwOBA" count={parseInt(fc?.has_home_lineup ?? 0)} total={total} />
            <CoverageBar label="Temperature" count={parseInt(fc?.has_temperature ?? 0)} total={total} />
            <CoverageBar label="Odds" count={parseInt(fc?.has_odds ?? 0)} total={total} />
            <CoverageBar label="Park Factor" count={parseInt(fc?.has_park ?? 0)} total={total} />
            <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, mt: 1 }}>
              These bars measure what was saved into pick_features for ML training, not whether the live Statcast cache is loaded.
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, mt: 0.5 }}>
              Goal: all bars at 90%+ before training ML model. Need 1,000+ records.
            </Typography>
          </Box>

          {(data.winRateByTemperature ?? []).length > 0 && (
            <>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, letterSpacing: '0.1em', mb: 1 }}>
                WIN RATE BY TEMPERATURE
              </Typography>
              <Box sx={{ border: `1px solid ${C.border}`, mb: 3 }}>
                {data.winRateByTemperature.map((row, i) => {
                  const t = parseInt(row.total);
                  const hr = t > 0 ? ((parseInt(row.wins) / t) * 100).toFixed(1) : '—';
                  return (
                    <Box key={i} sx={{ display: 'flex', p: '6px 12px', gap: 2, borderBottom: `1px solid ${C.border}` }}>
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textPrimary, flex: 1 }}>{row.temp_bucket}</Typography>
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textSecondary }}>{row.wins}W / {row.total} total</Typography>
                      <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: parseFloat(hr) >= 55 ? C.green : C.red }}>{hr}%</Typography>
                    </Box>
                  );
                })}
              </Box>
            </>
          )}

          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, letterSpacing: '0.1em', mb: 1 }}>
            RECENT RECORDS ({(data.recent ?? []).length} latest)
          </Typography>
          <Box sx={{ border: `1px solid ${C.border}`, overflowX: 'auto' }}>
            <Box sx={{ minWidth: '700px' }}>
              <Box sx={{ display: 'flex', p: '6px 10px', borderBottom: `1px solid ${C.border}`, background: C.surface }}>
                {['DATE', 'PICK', 'RESULT', 'H.xwOBA', 'A.xwOBA', 'H.Whiff', 'TEMP', 'DQ', 'ML.H', 'O/U'].map(h => (
                  <Typography key={h} sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, letterSpacing: '0.08em', flex: h === 'PICK' ? 2 : 1, minWidth: h === 'PICK' ? '120px' : '50px' }}>{h}</Typography>
                ))}
              </Box>
              {(data.recent ?? []).map((row, i) => (
                <Box key={i} sx={{ display: 'flex', p: '5px 10px', borderBottom: `1px solid ${C.border}`, '&:hover': { background: C.surface } }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textSecondary, flex: 1, minWidth: '50px' }}>{row.game_date?.split('T')[0]?.slice(5)}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.cyan, flex: 2, minWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.pick}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', flex: 1, minWidth: '50px', fontWeight: 700,
                    color: row.result === 'win' ? C.green : row.result === 'loss' ? C.red : C.textMuted
                  }}>{row.result?.toUpperCase() ?? '—'}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textSecondary, flex: 1, minWidth: '50px' }}>{row.home_pitcher_xwoba ?? '—'}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textSecondary, flex: 1, minWidth: '50px' }}>{row.away_pitcher_xwoba ?? '—'}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textSecondary, flex: 1, minWidth: '50px' }}>{row.home_pitcher_whiff ? `${parseFloat(row.home_pitcher_whiff).toFixed(1)}%` : '—'}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textSecondary, flex: 1, minWidth: '50px' }}>{row.temperature ? `${parseFloat(row.temperature).toFixed(0)}F` : '—'}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textSecondary, flex: 1, minWidth: '50px' }}>{row.data_quality_score ?? '—'}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textSecondary, flex: 1, minWidth: '50px' }}>{row.odds_ml_home ?? '—'}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textSecondary, flex: 1, minWidth: '50px' }}>{row.odds_ou_total ?? '—'}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          <Box sx={{ mt: 4, textAlign: 'center' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted }}>
              GAMBITHO LABS · ML FEATURE STORE · {s?.total_records ?? 0} records · Target: 1,000+
            </Typography>
          </Box>
        </>
      )}
    </Box>
  );
}
