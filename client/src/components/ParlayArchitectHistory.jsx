import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO, BARLOW } from '../theme';

const L = {
  en: {
    title: 'HISTORY',
    empty: 'No runs recorded yet. Results appear here after each analysis.',
    pending: 'PENDING',
    win:     'WIN',
    loss:    'LOSS',
    push:    'PUSH',
    markWin:  'WIN',
    markLoss: 'LOSS',
    markPush: 'PUSH',
    auto:     'AUTO',
    autoBusy: 'GRADING…',
    autoPending: (resolved, total) => `${resolved}/${total} games final — try again later`,
    autoNoLegs: 'Nothing to grade',
    autoLocalOnly: 'Local-only run — sign in to enable auto-grade',
    autoError: (msg) => `Auto-grade failed: ${msg}`,
    legPending: 'PEND',
    legUnresolved: 'N/A',
    legsHit:  'legs hit',
    showLegs: 'LEGS',
    hideLegs: 'HIDE',
    thesis:   'THESIS',
    warnings: 'WARNINGS',
    fallback: 'FALLBACK',
    prob:     'Prob',
    odds:     'Odds',
    edge:     'Edge',
    delete:   '✕',
    stats: {
      total:   'Total',
      resolved:'Resolved',
      winRate: 'Win Rate',
    },
  },
  es: {
    title: 'HISTORIAL',
    empty: 'Aún no hay corridas. Los resultados aparecen aquí después de cada análisis.',
    pending: 'PENDIENTE',
    win:     'GANADO',
    loss:    'PERDIDO',
    push:    'EMPATE',
    markWin:  'GANÓ',
    markLoss: 'PERDIÓ',
    markPush: 'EMPATE',
    auto:     'AUTO',
    autoBusy: 'CALIFICANDO…',
    autoPending: (resolved, total) => `${resolved}/${total} juegos finalizados — reintenta luego`,
    autoNoLegs: 'Nada que calificar',
    autoLocalOnly: 'Corrida local — inicia sesión para auto-calificar',
    autoError: (msg) => `Auto-calificación falló: ${msg}`,
    legPending: 'PEND',
    legUnresolved: 'N/A',
    legsHit:  'patas acertadas',
    showLegs: 'PATAS',
    hideLegs: 'OCULTAR',
    thesis:   'TESIS',
    warnings: 'ADVERTENCIAS',
    fallback: 'FALLBACK',
    prob:     'Prob',
    odds:     'Momios',
    edge:     'Edge',
    delete:   '✕',
    stats: {
      total:   'Total',
      resolved:'Resueltas',
      winRate: 'Win Rate',
    },
  },
};

const MODE_COLOR = {
  conservative: C.green,
  balanced:     C.cyan,
  aggressive:   C.amber,
  dreamer:      C.red,
};

function fmtPct(v)  { return v != null ? `${(Number(v) * 100).toFixed(1)}%` : '—'; }
function fmtOdds(v) { return v != null ? `×${Number(v).toFixed(2)}` : '—'; }
function fmtEdge(v) { return v != null ? `${Number(v).toFixed(1)}` : '—'; }

function ResultBadge({ result, t }) {
  const map = {
    pending: { label: t.pending, color: C.textMuted,  bg: 'transparent', border: C.borderLight },
    win:     { label: t.win,     color: C.green,      bg: `${C.green}12`, border: `${C.green}40` },
    loss:    { label: t.loss,    color: C.red,        bg: C.redDim,       border: C.redLine },
    push:    { label: t.push,    color: C.amber,      bg: C.amberDim,     border: C.amberLine },
  };
  const s = map[result] ?? map.pending;
  return (
    <Box sx={{ border: `1px solid ${s.border}`, bgcolor: s.bg, px: '6px', py: '2px', flexShrink: 0 }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: s.color, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
        {s.label}
      </Typography>
    </Box>
  );
}

function ResolveButtons({ entry, t, onMark, onAutoResolve }) {
  const [legsHit, setLegsHit] = useState('');
  const [autoState, setAutoState] = useState({ busy: false, message: null, color: null });

  const isLocalOnly = typeof entry.id === 'string' ? !entry.id.startsWith('db_') : true;

  async function handleAuto() {
    if (!onAutoResolve || autoState.busy) return;
    setAutoState({ busy: true, message: null, color: null });
    const out = await onAutoResolve(entry.id);
    if (!out?.ok) {
      setAutoState({ busy: false, message: t.autoError(out?.reason ?? 'unknown'), color: C.red });
      return;
    }
    const d = out.data;
    if (d.totalLegs === 0) {
      setAutoState({ busy: false, message: t.autoNoLegs, color: C.amber });
      return;
    }
    if (d.status === 'pending') {
      setAutoState({ busy: false, message: t.autoPending(d.legsResolved, d.totalLegs), color: C.amber });
      return;
    }
    // resolved — entry.result will update via the hook; clear local message
    setAutoState({ busy: false, message: null, color: null });
  }

  if (entry.result !== 'pending') {
    return (
      <Box
        onClick={() => onMark(entry.id, 'pending', null)}
        sx={{ cursor: 'pointer', opacity: 0.5, '&:hover': { opacity: 1 } }}
      >
        <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          undo
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <input
            type="number"
            min={0}
            max={entry.requested_legs}
            value={legsHit}
            onChange={e => setLegsHit(e.target.value)}
            placeholder="—"
            title={t.legsHit}
            style={{
              width: '28px',
              background: 'transparent',
              border: `1px solid ${C.borderLight}`,
              color: '#E8F4FF',
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '0.64rem',
              padding: '2px 3px',
              outline: 'none',
              textAlign: 'center',
            }}
          />
          <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted }}>/{entry.requested_legs}</Typography>
        </Box>
        {[
          { key: 'win',  label: t.markWin,  color: C.green },
          { key: 'loss', label: t.markLoss, color: C.red   },
          { key: 'push', label: t.markPush, color: C.amber },
        ].map(({ key, label, color }) => (
          <Box
            key={key}
            onClick={() => onMark(entry.id, key, legsHit !== '' ? Number(legsHit) : null)}
            sx={{
              border: `1px solid ${color}40`,
              bgcolor: `${color}10`,
              px: '6px',
              py: '2px',
              cursor: 'pointer',
              '&:hover': { bgcolor: `${color}22` },
            }}
          >
            <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
              {label}
            </Typography>
          </Box>
        ))}
        {onAutoResolve && (
          <Box
            onClick={isLocalOnly ? undefined : handleAuto}
            title={isLocalOnly ? t.autoLocalOnly : undefined}
            sx={{
              border: `1px solid ${C.cyan}40`,
              bgcolor: `${C.cyan}10`,
              px: '6px',
              py: '2px',
              cursor: isLocalOnly || autoState.busy ? 'not-allowed' : 'pointer',
              opacity: isLocalOnly ? 0.4 : autoState.busy ? 0.7 : 1,
              '&:hover': isLocalOnly || autoState.busy ? {} : { bgcolor: `${C.cyan}22` },
            }}
          >
            <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.cyan, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
              {autoState.busy ? t.autoBusy : t.auto}
            </Typography>
          </Box>
        )}
      </Box>
      {autoState.message && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.54rem', color: autoState.color ?? C.textMuted, letterSpacing: '0.04em' }}>
          {autoState.message}
        </Typography>
      )}
    </Box>
  );
}

function LegResultBadge({ legResult, t }) {
  if (!legResult) return null;
  const r = legResult.result;
  const map = {
    win:  { label: t.win,  color: C.green },
    loss: { label: t.loss, color: C.red   },
    push: { label: t.push, color: C.amber },
  };
  const s = r ? map[r] : null;
  const fallback = legResult.status === 'pending'
    ? { label: t.legPending, color: C.textMuted }
    : { label: t.legUnresolved, color: C.textMuted };
  const { label, color } = s ?? fallback;
  return (
    <Box
      title={legResult.reason ?? legResult.status ?? ''}
      sx={{ border: `1px solid ${color}40`, bgcolor: `${color}12`, px: '4px', py: '0px', flexShrink: 0 }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
        {label}
      </Typography>
    </Box>
  );
}

function LegDetail({ leg, index, lang, legResult, t }) {
  return (
    <Box sx={{ borderLeft: `2px solid ${C.accent}`, pl: '10px', py: '2px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', mb: '2px', flexWrap: 'wrap' }}>
        <Box sx={{ bgcolor: C.accent, color: '#000', fontFamily: MONO, fontSize: '0.52rem', fontWeight: 700, px: '4px', py: '1px', flexShrink: 0 }}>
          {index}
        </Box>
        <LegResultBadge legResult={legResult} t={t} />
        <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textPrimary, fontWeight: 600 }}>
          {leg.pick}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
          {leg.matchup}
        </Typography>
        {leg.odds != null && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.cyan }}>
            {leg.odds > 0 ? `+${leg.odds}` : leg.odds}
          </Typography>
        )}
        {leg.edge != null && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.green }}>
            edge {Number(leg.edge).toFixed(1)}%
          </Typography>
        )}
      </Box>
      {legResult?.actual != null && legResult?.line != null && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, lineHeight: 1.5, mt: '1px' }}>
          actual: {legResult.actual} · line: {legResult.line}
        </Typography>
      )}
      {leg.reasoning && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, lineHeight: 1.5, mt: '2px' }}>
          {leg.reasoning.slice(0, 200)}{leg.reasoning.length > 200 ? '…' : ''}
        </Typography>
      )}
    </Box>
  );
}

function HistoryEntry({ entry, t, lang, onMark, onAutoResolve, onDelete }) {
  const [showLegs, setShowLegs] = useState(false);
  const modeColor = MODE_COLOR[entry.mode] ?? C.textMuted;

  // Index leg_results by candidateId (falls back to position) so order changes
  // in chosen_legs don't desync the badges.
  const legResultsByCandidate = (() => {
    const map = new Map();
    if (!Array.isArray(entry.leg_results)) return map;
    entry.leg_results.forEach((lr, i) => {
      const key = lr?.candidateId ?? `__idx_${i}`;
      map.set(key, lr);
    });
    return map;
  })();
  function getLegResult(leg, i) {
    if (!Array.isArray(entry.leg_results)) return null;
    if (leg?.candidateId && legResultsByCandidate.has(leg.candidateId)) {
      return legResultsByCandidate.get(leg.candidateId);
    }
    return entry.leg_results[i] ?? null;
  }

  return (
    <Box sx={{ borderBottom: `1px solid ${C.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
      {/* Main row */}
      <Box sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        px: '12px',
        py: '9px',
        flexWrap: 'wrap',
      }}>
        {/* Left: result badge + mode + legs count */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <ResultBadge result={entry.result} t={t} />
          {entry.legs_hit != null && entry.result !== 'pending' && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted }}>
              {entry.legs_hit}/{entry.requested_legs}
            </Typography>
          )}
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: modeColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {entry.mode}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
            {entry.requested_legs}L
          </Typography>
        </Box>

        {/* Center: synergy type + stats */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {entry.synergy_type && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.cyan, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', mb: '1px' }}>
              {entry.synergy_type.replace(/_/g, ' ')}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
              {t.prob} <span style={{ color: C.green }}>{fmtPct(entry.combined_probability)}</span>
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
              {t.odds} <span style={{ color: C.cyan }}>{fmtOdds(entry.combined_decimal_odds)}</span>
            </Typography>
            {entry.combined_edge_score != null && (
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
                {t.edge} <span style={{ color: C.accent }}>{fmtEdge(entry.combined_edge_score)}</span>
              </Typography>
            )}
            {entry._fallback && (
              <Box sx={{ border: `1px solid ${C.amberLine}`, px: '4px', py: '0px' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.amber }}>{t.fallback}</Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* Right: action buttons */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <Box
            onClick={() => setShowLegs(x => !x)}
            sx={{ border: `1px solid ${C.borderLight}`, px: '6px', py: '3px', cursor: 'pointer', '&:hover': { borderColor: C.cyan } }}
          >
            <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {showLegs ? t.hideLegs : t.showLegs}
            </Typography>
          </Box>
          <Box
            onClick={() => onDelete(entry.id)}
            sx={{ border: `1px solid ${C.borderLight}`, px: '6px', py: '3px', cursor: 'pointer', '&:hover': { borderColor: C.red, color: C.red } }}
          >
            <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted }}>
              {t.delete}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Resolve row */}
      <Box sx={{ px: '12px', pb: '8px' }}>
        <ResolveButtons entry={entry} t={t} onMark={onMark} onAutoResolve={onAutoResolve} />
      </Box>

      {/* Expanded: thesis + legs */}
      {showLegs && (
        <Box sx={{ px: '12px', pb: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {entry.synergy_thesis && (
            <Box sx={{ borderLeft: `2px solid ${C.borderLight}`, pl: '10px' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '3px' }}>
                {t.thesis}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textSecondary, lineHeight: 1.6 }}>
                {entry.synergy_thesis}
              </Typography>
            </Box>
          )}
          {entry.warnings?.length > 0 && (
            <Box>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.54rem', color: C.amber, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '4px' }}>
                ⚠ {t.warnings}
              </Typography>
              {entry.warnings.map((w, i) => (
                <Typography key={i} sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, lineHeight: 1.5 }}>· {w}</Typography>
              ))}
            </Box>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {entry.legs.map((leg, i) => (
              <LegDetail
                key={leg.candidateId ?? i}
                leg={leg}
                index={i + 1}
                lang={lang}
                t={t}
                legResult={getLegResult(leg, i)}
              />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ParlayArchitectHistory({ lang = 'en', grouped, groupedDates, stats, winRate, onMark, onAutoResolve, onDelete }) {
  const t = L[lang] ?? L.en;

  return (
    <Box sx={{ mt: '32px' }}>
      {/* Section header */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '14px', mb: '12px', pb: '8px', borderBottom: `1px solid ${C.borderLight}` }}>
        <Typography sx={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '0.82rem', letterSpacing: '0.2em', color: C.accent, textTransform: 'uppercase' }}>
          {t.title}
        </Typography>
        {stats.total > 0 && (
          <Box sx={{ display: 'flex', gap: '12px' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
              {t.stats.total}: <span style={{ color: C.textSecondary }}>{stats.total}</span>
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
              {t.stats.resolved}: <span style={{ color: C.textSecondary }}>{stats.resolved}</span>
            </Typography>
            {winRate != null && (
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
                {t.stats.winRate}: <span style={{ color: winRate >= 50 ? C.green : C.red, fontWeight: 700 }}>{winRate}%</span>
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {groupedDates.length === 0 ? (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted, letterSpacing: '0.06em', py: '16px' }}>
          {t.empty}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {groupedDates.map(date => (
            <Box key={date}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, letterSpacing: '0.14em', textTransform: 'uppercase', mb: '6px' }}>
                {date}
              </Typography>
              <Box sx={{ border: `1px solid ${C.borderLight}`, bgcolor: C.surface }}>
                {grouped[date].map(entry => (
                  <HistoryEntry
                    key={entry.id}
                    entry={entry}
                    t={t}
                    lang={lang}
                    onMark={onMark}
                    onAutoResolve={onAutoResolve}
                    onDelete={onDelete}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
