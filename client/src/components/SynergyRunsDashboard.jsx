import { useState, useEffect, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO, BARLOW } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const L = {
  en: {
    title: 'SYNERGY RUNS',
    subtitle: '// PARLAY ARCHITECT — OBSERVABILITY DASHBOARD',
    back: '← BACK',
    refresh: 'REFRESH',
    loading: 'Loading runs...',
    empty: 'No synergy runs recorded yet.',
    errorLoad: 'Failed to load runs.',
    stats: {
      total: 'Total Runs',
      resolved: 'Resolved',
      winRate: 'Win Rate',
      avgProb: 'Avg Prob',
      avgOdds: 'Avg Odds',
      fallbackRate: 'Fallback Rate',
    },
    cols: {
      date: 'Date',
      mode: 'Mode',
      legs: 'Legs',
      synergy: 'Synergy',
      prob: 'Prob',
      odds: 'Odds',
      model: 'Model',
      timing: 'Time',
      status: 'Status',
      actions: '',
    },
    fallback: 'FALLBACK',
    unresolved: 'UNRESOLVED',
    hit: 'HIT',
    miss: 'MISS',
    markHit: 'HIT',
    markMiss: 'MISS',
    legsHit: 'Legs hit',
    details: 'DETAILS',
    hide: 'HIDE',
    chosenLegs: 'Chosen Legs',
    archDecision: 'Architect Decision',
    overrode: 'Overrode composer',
    shadowLabel: 'Shadow (Legacy)',
    noShadow: '—',
    resolveError: 'Failed to resolve run.',
    confirmHit: 'Mark as HIT?',
    confirmMiss: 'Mark as MISS?',
  },
  es: {
    title: 'CORRIDAS SYNERGY',
    subtitle: '// PARLAY ARCHITECT — PANEL DE OBSERVABILIDAD',
    back: '← VOLVER',
    refresh: 'ACTUALIZAR',
    loading: 'Cargando corridas...',
    empty: 'Aún no hay corridas registradas.',
    errorLoad: 'Error al cargar corridas.',
    stats: {
      total: 'Total',
      resolved: 'Resueltas',
      winRate: 'Win Rate',
      avgProb: 'Prob Media',
      avgOdds: 'Momios Medios',
      fallbackRate: 'Tasa Fallback',
    },
    cols: {
      date: 'Fecha',
      mode: 'Modo',
      legs: 'Patas',
      synergy: 'Sinergia',
      prob: 'Prob',
      odds: 'Momios',
      model: 'Modelo',
      timing: 'Tiempo',
      status: 'Estado',
      actions: '',
    },
    fallback: 'FALLBACK',
    unresolved: 'PENDIENTE',
    hit: 'GANADO',
    miss: 'PERDIDO',
    markHit: 'GANÓ',
    markMiss: 'PERDIÓ',
    legsHit: 'Patas acertadas',
    details: 'DETALLE',
    hide: 'OCULTAR',
    chosenLegs: 'Patas Elegidas',
    archDecision: 'Decisión del Arquitecto',
    overrode: 'Sobrescribió compositor',
    shadowLabel: 'Shadow (Legado)',
    noShadow: '—',
    resolveError: 'Error al resolver la corrida.',
    confirmHit: '¿Marcar como GANADO?',
    confirmMiss: '¿Marcar como PERDIDO?',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPct(v) {
  return v != null ? `${(Number(v) * 100).toFixed(1)}%` : '—';
}

function fmtOdds(v) {
  return v != null ? Number(v).toFixed(2) : '—';
}

function fmtDate(iso) {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function modeColor(mode) {
  return { conservative: C.green, balanced: C.cyan, aggressive: C.amber, dreamer: C.red }[mode] ?? C.textMuted;
}

function actualLegCount(run) {
  const explicit = Number(run?.actual_legs);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (Array.isArray(run?.chosen_legs) && run.chosen_legs.length > 0) return run.chosen_legs.length;
  if (Array.isArray(run?.leg_results) && run.leg_results.length > 0) return run.leg_results.length;
  const requested = Number(run?.requested_legs);
  return Number.isFinite(requested) && requested > 0 ? requested : null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, color }) {
  return (
    <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface, p: '12px 14px', flex: 1, minWidth: '110px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.12em', mb: '4px' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '1.1rem', fontWeight: 700, color: color ?? C.textPrimary }}>
        {value}
      </Typography>
    </Box>
  );
}

function StatusBadge({ run, t }) {
  const totalLegs = actualLegCount(run);
  if (!run.resolved) {
    const isFallback = run.architect_output?._fallback;
    return (
      <Box sx={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {isFallback && (
          <Box sx={{ border: `1px solid ${C.amberLine}`, bgcolor: C.amberDim, px: '5px', py: '1px' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.amber, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t.fallback}</Typography>
          </Box>
        )}
        <Box sx={{ border: `1px solid ${C.borderLight}`, px: '5px', py: '1px' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t.unresolved}</Typography>
        </Box>
      </Box>
    );
  }
  const color = run.hit ? C.green : C.red;
  const label = run.hit ? t.hit : t.miss;
  return (
    <Box sx={{ border: `1px solid ${color}40`, bgcolor: `${color}12`, px: '5px', py: '1px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
        {label}{run.legs_hit != null ? ` (${run.legs_hit}/${totalLegs ?? run.requested_legs})` : ''}
      </Typography>
    </Box>
  );
}

function ResolveControls({ run, t, token, onResolved }) {
  const [legsHit, setLegsHit] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const totalLegs = actualLegCount(run);

  async function resolve(hit) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/parlay-synergy/${run.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ hit, legs_hit: legsHit !== '' ? Number(legsHit) : (hit ? totalLegs : null) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'error');
      onResolved(run.id, hit, legsHit !== '' ? Number(legsHit) : (hit ? totalLegs : null));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted }}>{t.legsHit}:</Typography>
        <input
          type="number"
          min={0}
          max={totalLegs ?? undefined}
          value={legsHit}
          onChange={e => setLegsHit(e.target.value)}
          placeholder="—"
          style={{
            width: '32px',
            background: 'transparent',
            border: `1px solid ${C.borderLight}`,
            color: '#E8F4FF',
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: '0.68rem',
            padding: '2px 4px',
            outline: 'none',
            textAlign: 'center',
          }}
        />
      </Box>
      <ActionBtn label={t.markHit}  color={C.green} onClick={() => resolve(true)}  disabled={busy} />
      <ActionBtn label={t.markMiss} color={C.red}   onClick={() => resolve(false)} disabled={busy} />
      {err && <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.red }}>{err}</Typography>}
    </Box>
  );
}

function ActionBtn({ label, color, onClick, disabled }) {
  return (
    <Box
      onClick={disabled ? undefined : onClick}
      sx={{
        border: `1px solid ${color}50`,
        bgcolor: `${color}10`,
        px: '8px',
        py: '3px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        '&:hover': disabled ? {} : { bgcolor: `${color}20` },
      }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
        {label}
      </Typography>
    </Box>
  );
}

function RunDetail({ run, t, lang }) {
  const legs = run.chosen_legs ?? [];
  const archOut = run.architect_output ?? {};
  const timings = run.timings ?? {};

  return (
    <Box sx={{ px: '14px', pb: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Chosen leg IDs */}
      {legs.length > 0 && (
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.12em', mb: '4px' }}>
            {t.chosenLegs}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {legs.map((leg, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.borderLight}`, px: '6px', py: '2px' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.cyan }}>{leg?.candidateId ?? leg?.pick ?? leg}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Architect decision fields */}
      <Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.12em', mb: '4px' }}>
          {t.archDecision}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {[
            { k: 'decision',         v: archOut.decision },
            { k: 'confidence',       v: archOut.confidence_in_decision != null ? `${archOut.confidence_in_decision}%` : null },
            { k: 'synergy_type',     v: archOut.synergy_type },
            { k: '_fallback',        v: archOut._fallback ? 'yes' : 'no', col: archOut._fallback ? C.amber : C.green },
          ].filter(({ v }) => v != null).map(({ k, v, col }) => (
            <Box key={k}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted }}>{k}</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: col ?? C.textSecondary }}>{String(v)}</Typography>
            </Box>
          ))}
        </Box>
        {archOut.synergy_thesis && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.64rem', color: C.textMuted, mt: '6px', lineHeight: 1.55, borderLeft: `2px solid ${C.borderLight}`, pl: '8px' }}>
            {archOut.synergy_thesis}
          </Typography>
        )}
      </Box>

      {/* Timings */}
      <Box sx={{ display: 'flex', gap: '16px' }}>
        {[
          { label: 'Composer', v: timings.composer_ms },
          { label: 'LLM',      v: timings.llm_ms },
          { label: 'Total',    v: timings.total_ms },
        ].map(({ label, v }) => (
          <Box key={label}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, textTransform: 'uppercase' }}>{label}</Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.cyan }}>{fmtMs(v)}</Typography>
          </Box>
        ))}
      </Box>

      {/* Shadow result preview */}
      {run.shadow_old_parlay && (
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.12em', mb: '4px' }}>
            {t.shadowLabel}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {JSON.stringify(run.shadow_old_parlay).slice(0, 300)}…
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function RunRow({ run, t, lang, token, onResolved }) {
  const [expanded, setExpanded] = useState(false);
  const archOut = run.architect_output ?? {};
  const timings = run.timings ?? {};
  const totalLegs = actualLegCount(run);

  return (
    <>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: '80px 80px 44px 1fr 58px 58px 120px 60px auto 80px',
        gap: '4px',
        alignItems: 'center',
        px: '12px',
        py: '8px',
        borderBottom: `1px solid ${C.borderLight}`,
        bgcolor: expanded ? 'rgba(0,217,255,0.02)' : 'transparent',
        '&:hover': { bgcolor: 'rgba(0,217,255,0.02)' },
      }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted }}>{fmtDate(run.game_date ?? run.created_at)}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: modeColor(run.mode), textTransform: 'uppercase' }}>{run.mode ?? '—'}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.cyan, textAlign: 'center' }}>{totalLegs ?? run.requested_legs ?? '—'}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.synergy_type ? run.synergy_type.replace(/_/g, ' ') : '—'}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.green }}>{fmtPct(run.combined_prob)}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.cyan }}>{fmtOdds(run.combined_dec_odds)}</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.54rem', color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.model ?? '—'} · {fmtMs(timings.total_ms)}</Typography>
        <StatusBadge run={run} t={t} />
        {!run.resolved && <ResolveControls run={run} t={t} token={token} onResolved={onResolved} />}
        {run.resolved && <Box />}
        <Box
          onClick={() => setExpanded(x => !x)}
          sx={{ cursor: 'pointer', border: `1px solid ${C.borderLight}`, px: '6px', py: '3px', textAlign: 'center', justifySelf: 'end', '&:hover': { borderColor: C.cyan } }}
        >
          <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {expanded ? t.hide : t.details}
          </Typography>
        </Box>
      </Box>
      {expanded && <RunDetail run={run} t={t} lang={lang} />}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SynergyRunsDashboard({ lang = 'en', onBack }) {
  const t = L[lang] ?? L.en;
  const token = localStorage.getItem('hexa_token');

  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/parlay-synergy/recent`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'error');
      setRuns(json.data ?? []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  function handleResolved(id, hit, legs_hit) {
    setRuns(prev => prev.map(r =>
      r.id === id ? { ...r, resolved: true, hit, legs_hit: legs_hit ?? r.legs_hit } : r
    ));
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const resolved  = runs.filter(r => r.resolved);
  const wins      = resolved.filter(r => r.hit);
  const winRate   = resolved.length > 0 ? `${((wins.length / resolved.length) * 100).toFixed(1)}%` : '—';
  const avgProb   = runs.length > 0
    ? fmtPct(runs.reduce((s, r) => s + (Number(r.combined_prob) || 0), 0) / runs.length)
    : '—';
  const avgOdds   = runs.length > 0
    ? fmtOdds(runs.reduce((s, r) => s + (Number(r.combined_dec_odds) || 0), 0) / runs.length)
    : '—';
  const fallbacks = runs.filter(r => r.architect_output?._fallback).length;
  const fallbackRate = runs.length > 0 ? `${((fallbacks / runs.length) * 100).toFixed(1)}%` : '—';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.bg, display: 'flex', flexDirection: 'column' }}>
      {/* Header bar */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: { xs: 2, sm: 3 },
        py: '12px',
        borderBottom: `1px solid ${C.border}`,
        bgcolor: C.surface,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Box onClick={onBack} sx={{ cursor: 'pointer', '&:hover': { opacity: 0.7 } }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textMuted, letterSpacing: '0.1em' }}>{t.back}</Typography>
          </Box>
          <Box>
            <Typography sx={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.2em', color: C.accent, textTransform: 'uppercase' }}>
              {t.title}
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, letterSpacing: '0.1em' }}>
              {t.subtitle}
            </Typography>
          </Box>
        </Box>
        <Box
          onClick={fetchRuns}
          sx={{ border: `1px solid ${C.border}`, px: '10px', py: '5px', cursor: 'pointer', '&:hover': { borderColor: C.cyan } }}
        >
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {t.refresh}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ flex: 1, px: { xs: 2, sm: 3 }, py: 3, maxWidth: 1440, mx: 'auto', width: '100%' }}>

        {/* Summary stats */}
        {runs.length > 0 && (
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mb: 3 }}>
            <StatCard label={t.stats.total}        value={runs.length}         color={C.textPrimary} />
            <StatCard label={t.stats.resolved}     value={resolved.length}     color={C.cyan} />
            <StatCard label={t.stats.winRate}       value={winRate}             color={wins.length > 0 ? C.green : C.textMuted} />
            <StatCard label={t.stats.avgProb}       value={avgProb}             color={C.cyan} />
            <StatCard label={t.stats.avgOdds}       value={avgOdds}             color={C.amber} />
            <StatCard label={t.stats.fallbackRate}  value={fallbackRate}        color={fallbacks > 0 ? C.amber : C.green} />
          </Box>
        )}

        {/* Content */}
        {loading && (
          <Box sx={{ py: '40px', textAlign: 'center' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {t.loading}
            </Typography>
          </Box>
        )}

        {loadError && (
          <Box sx={{ border: `1px solid ${C.redLine}`, bgcolor: C.redDim, p: '14px', mb: 2 }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.red }}>{t.errorLoad}: {loadError}</Typography>
          </Box>
        )}

        {!loading && !loadError && runs.length === 0 && (
          <Box sx={{ py: '60px', textAlign: 'center' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {t.empty}
            </Typography>
          </Box>
        )}

        {!loading && runs.length > 0 && (
          <Box sx={{ border: `1px solid ${C.border}`, bgcolor: C.surface }}>
            {/* Column headers */}
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: '80px 80px 44px 1fr 58px 58px 120px 60px auto 80px',
              gap: '4px',
              px: '12px',
              py: '6px',
              borderBottom: `1px solid ${C.border}`,
              bgcolor: C.elevated,
            }}>
              {[t.cols.date, t.cols.mode, t.cols.legs, t.cols.synergy, t.cols.prob, t.cols.odds, t.cols.model, t.cols.status, t.cols.actions, ''].map((col, i) => (
                <Typography key={i} sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {col}
                </Typography>
              ))}
            </Box>

            {/* Rows */}
            {runs.map(run => (
              <RunRow
                key={run.id}
                run={run}
                t={t}
                lang={lang}
                token={token}
                onResolved={handleResolved}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
