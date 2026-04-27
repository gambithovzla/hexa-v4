import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO, BARLOW } from '../theme';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const RG_L = {
  en: {
    title: 'MAINTENANCE — REGRADE PLAYER PROPS',
    desc:  'Re-grade player-prop rows in backtest_results against the real boxscore. Fixes rows stored before the prop-grading patch (where "Over 1.5 Total Bases" was compared to game total runs).',
    runDry: 'RUN DRY-RUN',
    running: 'RUNNING…',
    apply: 'APPLY UPDATES',
    applyConfirm: 'CONFIRM APPLY',
    cancel: 'CANCEL',
    confirmText: rows => `This will update ${rows} backtest_results row${rows === 1 ? '' : 's'}. Confirm?`,
    successApplied: rows => `Updated ${rows} row${rows === 1 ? '' : 's'}. Re-load the page to see refreshed stats.`,
    fromLabel: 'From (YYYY-MM-DD, optional)',
    toLabel:   'To (YYYY-MM-DD, optional)',
    limitLabel:'Row limit (optional)',
    statsHeader: 'DRY-RUN REPORT',
    propsScanned: 'Prop rows scanned',
    resolved:    'Resolved against boxscore',
    unresolved:  'Unresolvable (no box / player)',
    matches:     'Already correct',
    mismatches:  'Mismatches (would change)',
    nullToGraded:'   stored=NULL → graded',
    elapsed:     'Elapsed',
    mismatchHeader: 'MISMATCHES (showing up to 50)',
    storedLabel: 'stored',
    regradedLabel: 'regraded',
    actualLabel: 'actual',
    lineLabel:   'line',
    nothingToFix: 'No mismatches found — no action needed.',
  },
  es: {
    title: 'MANTENIMIENTO — REGRADE PROPS DE JUGADORES',
    desc:  'Re-evalúa filas de player props en backtest_results contra el boxscore real. Corrige filas guardadas antes del fix (donde "Over 1.5 Bases Totales" se comparaba contra runs totales del juego).',
    runDry: 'EJECUTAR DRY-RUN',
    running: 'EJECUTANDO…',
    apply: 'APLICAR CAMBIOS',
    applyConfirm: 'CONFIRMAR APLICAR',
    cancel: 'CANCELAR',
    confirmText: rows => `Esto actualizará ${rows} fila${rows === 1 ? '' : 's'} de backtest_results. ¿Confirmas?`,
    successApplied: rows => `${rows} fila${rows === 1 ? '' : 's'} actualizada${rows === 1 ? '' : 's'}. Recarga la página para ver las stats actualizadas.`,
    fromLabel: 'Desde (YYYY-MM-DD, opcional)',
    toLabel:   'Hasta (YYYY-MM-DD, opcional)',
    limitLabel:'Límite de filas (opcional)',
    statsHeader: 'REPORTE DRY-RUN',
    propsScanned: 'Filas escaneadas (props)',
    resolved:    'Resueltas con boxscore',
    unresolved:  'No resolubles (sin box / jugador)',
    matches:     'Ya correctas',
    mismatches:  'Diferencias (a corregir)',
    nullToGraded:'   stored=NULL → resueltas',
    elapsed:     'Tiempo',
    mismatchHeader: 'DIFERENCIAS (hasta 50)',
    storedLabel: 'guardado',
    regradedLabel: 'regrade',
    actualLabel: 'real',
    lineLabel:   'línea',
    nothingToFix: 'Sin diferencias — no hay nada que corregir.',
  },
};

function StatCard({ label, value, sub, color }) {
  return (
    <Box sx={{ border: `1px solid ${color || C.cyanLine}`, p: '12px 16px', flex: 1, minWidth: '120px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', mb: '4px' }}>{label}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.4rem', fontWeight: 700, color: color || C.cyan }}>{value}</Typography>
      {sub && <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, mt: '2px' }}>{sub}</Typography>}
    </Box>
  );
}

function RegradePanel({ lang, token }) {
  const t = RG_L[lang] ?? RG_L.en;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState('');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null); // last dry-run / apply response
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [appliedMsg, setAppliedMsg] = useState(null);

  async function call(apply) {
    setRunning(true);
    setError(null);
    setAppliedMsg(null);
    if (!apply) setReport(null); // fresh dry-run resets report; apply keeps it for context
    try {
      const body = { apply };
      if (from)  body.from  = from;
      if (to)    body.to    = to;
      if (limit) body.limit = parseInt(limit, 10);
      const res = await fetch(`${API_URL}/api/admin/regrade-backtest-props`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setReport(json.data);
      if (apply) {
        setAppliedMsg(t.successApplied(json.data.stats.updated));
        setConfirming(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  const stats = report?.stats;
  const mismatches = report?.mismatches ?? [];
  const canApply = report && !report.apply && stats?.mismatches > 0;

  const inputStyle = {
    background: '#000', border: `1px solid ${C.border}`, color: C.textPrimary,
    fontFamily: MONO, fontSize: '0.65rem', padding: '6px 8px', outline: 'none',
    width: '100%', maxWidth: '180px',
  };

  const btnStyle = (color, disabled) => ({
    background: disabled ? 'transparent' : 'rgba(0,0,0,0.6)',
    border: `1px solid ${disabled ? C.borderLight : color}`,
    color: disabled ? C.textMuted : color,
    fontFamily: MONO, fontSize: '0.65rem', letterSpacing: '0.12em',
    padding: '7px 14px', cursor: disabled ? 'not-allowed' : 'pointer',
    textTransform: 'uppercase', fontWeight: 700,
    '&:hover': disabled ? {} : { boxShadow: `0 0 12px ${color}40` },
  });

  return (
    <Box sx={{ border: `1px solid ${C.amber}`, p: '14px 16px', mb: 3 }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.amber, letterSpacing: '0.1em', mb: '4px' }}>
        {t.title}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, lineHeight: 1.5, mb: 2 }}>
        {t.desc}
      </Typography>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-end', mb: 2 }}>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, mb: '4px' }}>
            {t.fromLabel}
          </Typography>
          <input type="text" placeholder="YYYY-MM-DD" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
        </Box>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, mb: '4px' }}>
            {t.toLabel}
          </Typography>
          <input type="text" placeholder="YYYY-MM-DD" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
        </Box>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, mb: '4px' }}>
            {t.limitLabel}
          </Typography>
          <input type="number" min="1" max="5000" value={limit} onChange={e => setLimit(e.target.value)} style={inputStyle} />
        </Box>
      </Box>

      {/* Buttons */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
        <Box component="button" onClick={() => call(false)} disabled={running} sx={btnStyle(C.cyan, running)}>
          {running ? t.running : t.runDry}
        </Box>
        {canApply && !confirming && (
          <Box component="button" onClick={() => setConfirming(true)} disabled={running} sx={btnStyle(C.amber, running)}>
            {t.apply} ({stats.mismatches})
          </Box>
        )}
        {confirming && (
          <>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.amber, alignSelf: 'center' }}>
              {t.confirmText(stats.mismatches)}
            </Typography>
            <Box component="button" onClick={() => call(true)} disabled={running} sx={btnStyle(C.red, running)}>
              {running ? t.running : t.applyConfirm}
            </Box>
            <Box component="button" onClick={() => setConfirming(false)} disabled={running} sx={btnStyle(C.textMuted, running)}>
              {t.cancel}
            </Box>
          </>
        )}
      </Box>

      {error && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.red, mb: 1 }}>
          {error}
        </Typography>
      )}
      {appliedMsg && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.green, mb: 1 }}>
          ✓ {appliedMsg}
        </Typography>
      )}

      {/* Report */}
      {report && stats && (
        <Box sx={{ borderTop: `1px solid ${C.borderLight}`, pt: 2, mt: 1 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.cyan, letterSpacing: '0.1em', mb: 1 }}>
            {t.statsHeader} {report.apply ? '· APPLIED' : ''}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '4px 16px', mb: mismatches.length > 0 ? 2 : 0 }}>
            <StatLine label={t.propsScanned} value={stats.propsScanned} />
            <StatLine label={t.resolved}     value={stats.resolved} />
            <StatLine label={t.matches}      value={stats.matchesStored} />
            <StatLine label={t.unresolved}   value={stats.unresolved} color={stats.unresolved > 0 ? C.amber : C.textSecondary} />
            <StatLine label={t.mismatches}   value={stats.mismatches} color={stats.mismatches > 0 ? C.red : C.green} />
            <StatLine label={t.nullToGraded} value={stats.storedNullNowResolved} />
            <StatLine label={t.elapsed}      value={`${report.elapsed_ms}ms`} />
          </Box>

          {stats.mismatches === 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.green, mt: 1 }}>
              ✓ {t.nothingToFix}
            </Typography>
          )}

          {mismatches.length > 0 && (
            <>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, letterSpacing: '0.1em', mt: 2, mb: 1 }}>
                {t.mismatchHeader}
              </Typography>
              <Box sx={{ border: `1px solid ${C.border}`, maxHeight: '320px', overflowY: 'auto' }}>
                {mismatches.map((m, i) => (
                  <Box key={m.id ?? i} sx={{ p: '6px 10px', borderBottom: `1px solid ${C.border}`, '&:last-child': { borderBottom: 'none' } }}>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textPrimary }}>
                      [{m.date}] <span style={{ color: C.cyan }}>{m.matchup}</span> :: {m.pick}
                    </Typography>
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, mt: '2px' }}>
                      {t.storedLabel}=
                      <span style={{ color: m.stored === 'win' ? C.red : m.stored === 'loss' ? C.amber : C.textMuted, fontWeight: 600 }}>
                        {(m.stored ?? 'NULL').toUpperCase()}
                      </span>
                      {' → '}
                      {t.regradedLabel}=
                      <span style={{ color: m.regraded === 'win' ? C.green : m.regraded === 'loss' ? C.red : C.amber, fontWeight: 600 }}>
                        {m.regraded.toUpperCase()}
                      </span>
                      {' · '}
                      {t.actualLabel}={m.actualStat} {t.lineLabel} {m.line} ({m.propType})
                    </Typography>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

function StatLine({ label, value, color }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: '2px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted }}>{label}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: color ?? C.textPrimary, fontWeight: 600 }}>{value}</Typography>
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

          {/* Maintenance — regrade player props */}
          <RegradePanel lang={lang} token={token} />

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
