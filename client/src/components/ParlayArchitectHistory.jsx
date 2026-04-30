import { useState, useMemo, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO, BARLOW } from '../theme';

const L = {
  en: {
    title: 'HISTORY',
    empty: 'No runs recorded yet. Results appear here after each analysis.',
    emptyFiltered: 'No runs match the current filters.',
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
    missBy:   (n) => `MISS BY ${n}`,
    stats: {
      total:    'Total',
      resolved: 'Resolved',
      winRate:  'Win Rate',
    },
    dateSelector: {
      title:   'DATE',
      all:     'ALL',
      jump:    'jump to date',
    },
    filters: {
      title:   'FILTERS',
      result:  'Result',
      mode:    'Mode',
      synergy: 'Synergy',
      missBy:  'Miss by',
      sort:    'Sort',
      anyResult:    'All',
      resultWin:    'Wins',
      resultLoss:   'Losses',
      resultPush:   'Pushes',
      resultPend:   'Pending',
      missAny:      'Any',
      miss1:        'Lost by 1',
      miss2:        'Lost by 2',
      miss3:        'Lost by 3+',
      missClean:    'Clean wins',
      anyMode:      'All modes',
      anySynergy:   'All synergies',
      sortRecent:   'Recent',
      sortOddsDesc: 'Odds ↓',
      sortOddsAsc:  'Odds ↑',
      sortLegsHit:  'Legs hit ↓',
      reset:        'reset',
    },
  },
  es: {
    title: 'HISTORIAL',
    empty: 'Aún no hay corridas. Los resultados aparecen aquí después de cada análisis.',
    emptyFiltered: 'Ningún parlay coincide con los filtros activos.',
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
    missBy:   (n) => `FALLÓ POR ${n}`,
    stats: {
      total:    'Total',
      resolved: 'Resueltas',
      winRate:  'Win Rate',
    },
    dateSelector: {
      title:   'FECHA',
      all:     'TODAS',
      jump:    'ir a fecha',
    },
    filters: {
      title:   'FILTROS',
      result:  'Resultado',
      mode:    'Modo',
      synergy: 'Sinergia',
      missBy:  'Falló por',
      sort:    'Orden',
      anyResult:    'Todos',
      resultWin:    'Ganados',
      resultLoss:   'Perdidos',
      resultPush:   'Empates',
      resultPend:   'Pendientes',
      missAny:      'Cualquiera',
      miss1:        'Falló por 1',
      miss2:        'Falló por 2',
      miss3:        'Falló por 3+',
      missClean:    'Ganados completos',
      anyMode:      'Todos los modos',
      anySynergy:   'Todas las sinergias',
      sortRecent:   'Recientes',
      sortOddsDesc: 'Momios ↓',
      sortOddsAsc:  'Momios ↑',
      sortLegsHit:  'Patas acertadas ↓',
      reset:        'limpiar',
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

function actualLegCount(entry) {
  const explicit = Number(entry?.actual_legs);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (Array.isArray(entry?.legs) && entry.legs.length > 0) return entry.legs.length;
  if (Array.isArray(entry?.leg_results) && entry.leg_results.length > 0) return entry.leg_results.length;
  const requested = Number(entry?.requested_legs);
  return Number.isFinite(requested) && requested > 0 ? requested : 0;
}

function missedLegCount(entry) {
  if (entry?.result !== 'loss') return null;
  if (Array.isArray(entry.leg_results) && entry.leg_results.length > 0) {
    return entry.leg_results.filter(lr => lr?.result === 'loss').length;
  }
  if (entry.legs_hit == null) return null;
  return Math.max(0, actualLegCount(entry) - Number(entry.legs_hit));
}

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

function MissByBadge({ entry, t }) {
  const miss = missedLegCount(entry);
  if (miss == null) return null;
  if (miss <= 0) return null;
  const color = miss === 1 ? C.amber : miss === 2 ? `${C.amber}` : C.red;
  return (
    <Box sx={{ border: `1px solid ${color}40`, bgcolor: `${color}10`, px: '5px', py: '1px', flexShrink: 0 }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color, letterSpacing: '0.1em', fontWeight: 700 }}>
        {t.missBy(miss)}
      </Typography>
    </Box>
  );
}

function ResolveButtons({ entry, t, onMark, onAutoResolve }) {
  const [legsHit, setLegsHit] = useState('');
  const [autoState, setAutoState] = useState({ busy: false, message: null, color: null });

  const isLocalOnly = typeof entry.id === 'string' ? !entry.id.startsWith('db_') : true;
  const totalLegs = actualLegCount(entry);
  const defaultLegsHit = (outcome) => {
    if (legsHit !== '') return Number(legsHit);
    if (outcome === 'win') return totalLegs;
    return null;
  };

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
            max={totalLegs || undefined}
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
          <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted }}>/{totalLegs || '—'}</Typography>
        </Box>
        {[
          { key: 'win',  label: t.markWin,  color: C.green },
          { key: 'loss', label: t.markLoss, color: C.red   },
          { key: 'push', label: t.markPush, color: C.amber },
        ].map(({ key, label, color }) => (
          <Box
            key={key}
            onClick={() => onMark(entry.id, key, defaultLegsHit(key))}
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
  const totalLegs = actualLegCount(entry);

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
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px', px: '12px', py: '9px', flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <ResultBadge result={entry.result} t={t} />
          <MissByBadge entry={entry} t={t} />
          {entry.legs_hit != null && entry.result !== 'pending' && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted }}>
              {entry.legs_hit}/{totalLegs || '—'}
            </Typography>
          )}
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: modeColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {entry.mode}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted }}>
            {totalLegs || entry.requested_legs}L
          </Typography>
        </Box>

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

      <Box sx={{ px: '12px', pb: '8px' }}>
        <ResolveButtons entry={entry} t={t} onMark={onMark} onAutoResolve={onAutoResolve} />
      </Box>

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

// ── Date selector ─────────────────────────────────────────────────────────────

function DateChip({ date, summary, isActive, onClick, label }) {
  const wins   = summary?.wins   ?? 0;
  const losses = summary?.losses ?? 0;
  const total  = summary?.total  ?? 0;
  return (
    <Box
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        flexShrink: 0,
        border: `1px solid ${isActive ? C.cyan : C.borderLight}`,
        bgcolor: isActive ? `${C.cyan}18` : 'transparent',
        px: '10px',
        py: '5px',
        minWidth: '80px',
        '&:hover': { borderColor: C.cyan },
      }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: isActive ? C.cyan : C.textPrimary, fontWeight: 700, letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      {summary && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, mt: '2px', letterSpacing: '0.06em' }}>
          {total} · <span style={{ color: C.green }}>{wins}W</span> <span style={{ color: C.red }}>{losses}L</span>
        </Typography>
      )}
    </Box>
  );
}

function HistoryDateSelector({ groupedDates, grouped, selectedDate, onSelect, t }) {
  const dateSummaries = useMemo(() => {
    const map = new Map();
    for (const d of groupedDates) {
      const list = grouped[d] ?? [];
      const wins   = list.filter(e => e.result === 'win').length;
      const losses = list.filter(e => e.result === 'loss').length;
      map.set(d, { total: list.length, wins, losses });
    }
    return map;
  }, [groupedDates, grouped]);

  function fmtChipLabel(d) {
    const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}-${m[3]}` : d;
  }

  return (
    <Box sx={{ mb: '12px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', mb: '6px' }}>
        <Typography sx={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '0.66rem', letterSpacing: '0.18em', color: C.cyan, textTransform: 'uppercase' }}>
          {t.dateSelector.title}
        </Typography>
        <input
          type="date"
          value={selectedDate && selectedDate !== 'all' ? selectedDate : ''}
          onChange={e => e.target.value && onSelect(e.target.value)}
          title={t.dateSelector.jump}
          style={{
            background: 'transparent',
            border: `1px solid ${C.borderLight}`,
            color: '#E8F4FF',
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: '0.62rem',
            padding: '3px 6px',
            outline: 'none',
            cursor: 'pointer',
          }}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: '6px', overflowX: 'auto', pb: '4px' }}>
        <DateChip
          date="all"
          summary={null}
          isActive={selectedDate === 'all'}
          onClick={() => onSelect('all')}
          label={t.dateSelector.all}
        />
        {groupedDates.map(d => (
          <DateChip
            key={d}
            date={d}
            summary={dateSummaries.get(d)}
            isActive={selectedDate === d}
            onClick={() => onSelect(d)}
            label={fmtChipLabel(d)}
          />
        ))}
      </Box>
    </Box>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterChip({ label, isActive, color = C.cyan, onClick }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        border: `1px solid ${isActive ? color : C.borderLight}`,
        bgcolor: isActive ? `${color}18` : 'transparent',
        px: '7px',
        py: '2px',
        '&:hover': { borderColor: color },
      }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: isActive ? color : C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: isActive ? 700 : 400 }}>
        {label}
      </Typography>
    </Box>
  );
}

function FilterRow({ label, children }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.54rem', color: C.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', minWidth: '70px' }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function HistoryFilterBar({ filters, setFilters, availableModes, availableSynergies, t }) {
  const isDefault = filters.result === 'all'
    && filters.missBy === 'any'
    && filters.modes.length === 0
    && filters.synergy === 'all'
    && filters.sort === 'recent';

  const resultOptions = [
    { key: 'all',     label: t.filters.anyResult,  color: C.cyan },
    { key: 'win',     label: t.filters.resultWin,  color: C.green },
    { key: 'loss',    label: t.filters.resultLoss, color: C.red },
    { key: 'push',    label: t.filters.resultPush, color: C.amber },
    { key: 'pending', label: t.filters.resultPend, color: C.textMuted },
  ];
  const missOptions = [
    { key: 'any',   label: t.filters.missAny    },
    { key: 1,       label: t.filters.miss1      },
    { key: 2,       label: t.filters.miss2      },
    { key: '3plus', label: t.filters.miss3      },
    { key: 'clean', label: t.filters.missClean  },
  ];
  const sortOptions = [
    { key: 'recent',    label: t.filters.sortRecent   },
    { key: 'oddsDesc',  label: t.filters.sortOddsDesc },
    { key: 'oddsAsc',   label: t.filters.sortOddsAsc  },
    { key: 'legsHit',   label: t.filters.sortLegsHit  },
  ];

  function toggleMode(mode) {
    setFilters(f => ({
      ...f,
      modes: f.modes.includes(mode) ? f.modes.filter(m => m !== mode) : [...f.modes, mode],
    }));
  }
  function reset() {
    setFilters({ result: 'all', missBy: 'any', modes: [], synergy: 'all', sort: 'recent' });
  }

  return (
    <Box sx={{
      mb: '12px',
      border: `1px solid ${C.borderLight}`,
      borderLeft: `3px solid ${C.cyan}`,
      bgcolor: 'rgba(0,0,0,0.25)',
      px: '12px',
      py: '10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontFamily: BARLOW, fontWeight: 800, fontSize: '0.66rem', letterSpacing: '0.18em', color: C.accent, textTransform: 'uppercase' }}>
          {t.filters.title}
        </Typography>
        {!isDefault && (
          <Box onClick={reset} sx={{ cursor: 'pointer', '&:hover': { color: C.cyan } }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.54rem', color: C.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {t.filters.reset}
            </Typography>
          </Box>
        )}
      </Box>

      <FilterRow label={t.filters.result}>
        {resultOptions.map(opt => (
          <FilterChip
            key={opt.key}
            label={opt.label}
            color={opt.color}
            isActive={filters.result === opt.key}
            onClick={() => setFilters(f => ({ ...f, result: opt.key }))}
          />
        ))}
      </FilterRow>

      <FilterRow label={t.filters.missBy}>
        {missOptions.map(opt => (
          <FilterChip
            key={String(opt.key)}
            label={opt.label}
            color={C.amber}
            isActive={filters.missBy === opt.key}
            onClick={() => setFilters(f => ({ ...f, missBy: opt.key }))}
          />
        ))}
      </FilterRow>

      {availableModes.length > 0 && (
        <FilterRow label={t.filters.mode}>
          {availableModes.map(m => (
            <FilterChip
              key={m}
              label={m}
              color={MODE_COLOR[m] ?? C.cyan}
              isActive={filters.modes.includes(m)}
              onClick={() => toggleMode(m)}
            />
          ))}
        </FilterRow>
      )}

      {availableSynergies.length > 0 && (
        <FilterRow label={t.filters.synergy}>
          <select
            value={filters.synergy}
            onChange={e => setFilters(f => ({ ...f, synergy: e.target.value }))}
            style={{
              background: 'transparent',
              border: `1px solid ${C.borderLight}`,
              color: '#E8F4FF',
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '0.62rem',
              padding: '2px 4px',
              outline: 'none',
              cursor: 'pointer',
              maxWidth: '220px',
            }}
          >
            <option value="all">{t.filters.anySynergy}</option>
            {availableSynergies.map(s => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </FilterRow>
      )}

      <FilterRow label={t.filters.sort}>
        {sortOptions.map(opt => (
          <FilterChip
            key={opt.key}
            label={opt.label}
            isActive={filters.sort === opt.key}
            onClick={() => setFilters(f => ({ ...f, sort: opt.key }))}
          />
        ))}
      </FilterRow>
    </Box>
  );
}

// ── Filtering / sorting helpers ──────────────────────────────────────────────

function entryMatchesFilters(entry, filters) {
  if (filters.result !== 'all' && entry.result !== filters.result) return false;
  if (filters.modes.length > 0 && !filters.modes.includes(entry.mode)) return false;
  if (filters.synergy !== 'all' && entry.synergy_type !== filters.synergy) return false;

  if (filters.missBy !== 'any') {
    if (filters.missBy === 'clean') {
      if (!(entry.result === 'win' && entry.legs_hit === actualLegCount(entry))) return false;
    } else {
      const miss = missedLegCount(entry);
      if (miss == null) return false;
      if (filters.missBy === '3plus') {
        if (miss < 3) return false;
      } else if (miss !== filters.missBy) {
        return false;
      }
    }
  }
  return true;
}

function sortEntries(entries, sort) {
  const arr = [...entries];
  switch (sort) {
    case 'oddsDesc':
      arr.sort((a, b) => (b.combined_decimal_odds ?? -Infinity) - (a.combined_decimal_odds ?? -Infinity));
      break;
    case 'oddsAsc':
      arr.sort((a, b) => (a.combined_decimal_odds ?? Infinity) - (b.combined_decimal_odds ?? Infinity));
      break;
    case 'legsHit':
      arr.sort((a, b) => (b.legs_hit ?? -1) - (a.legs_hit ?? -1));
      break;
    default:
      arr.sort((a, b) => new Date(b.created_at ?? 0) - new Date(a.created_at ?? 0));
      break;
  }
  return arr;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ParlayArchitectHistory({ lang = 'en', grouped, groupedDates, stats, winRate, onMark, onAutoResolve, onDelete }) {
  const t = L[lang] ?? L.en;

  const [selectedDate, setSelectedDate] = useState(() => groupedDates[0] ?? 'all');
  const [filters, setFilters] = useState({
    result:  'all',
    missBy:  'any',
    modes:   [],
    synergy: 'all',
    sort:    'recent',
  });

  // Keep selectedDate valid when groupedDates changes (e.g. new entry added)
  useEffect(() => {
    if (selectedDate !== 'all' && !groupedDates.includes(selectedDate)) {
      setSelectedDate(groupedDates[0] ?? 'all');
    }
  }, [groupedDates, selectedDate]);

  const allEntries = useMemo(() => {
    const out = [];
    for (const d of groupedDates) for (const e of (grouped[d] ?? [])) out.push(e);
    return out;
  }, [grouped, groupedDates]);

  const availableModes = useMemo(() => {
    const set = new Set();
    for (const e of allEntries) if (e.mode) set.add(e.mode);
    return Array.from(set);
  }, [allEntries]);
  const availableSynergies = useMemo(() => {
    const set = new Set();
    for (const e of allEntries) if (e.synergy_type) set.add(e.synergy_type);
    return Array.from(set).sort();
  }, [allEntries]);

  const filteredEntries = useMemo(() => {
    const dateScoped = selectedDate === 'all'
      ? allEntries
      : (grouped[selectedDate] ?? []);
    const filtered = dateScoped.filter(e => entryMatchesFilters(e, filters));
    return sortEntries(filtered, filters.sort);
  }, [allEntries, grouped, selectedDate, filters]);

  // For sort=recent + date=all, render with date subheaders. Otherwise flat.
  const renderGrouped = filters.sort === 'recent' && selectedDate === 'all';
  const groupedFiltered = useMemo(() => {
    if (!renderGrouped) return null;
    const map = new Map();
    for (const e of filteredEntries) {
      const d = e.date ?? 'unknown';
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(e);
    }
    return map;
  }, [filteredEntries, renderGrouped]);

  const isEmptyAll = groupedDates.length === 0;
  const isEmptyFiltered = !isEmptyAll && filteredEntries.length === 0;

  return (
    <Box sx={{ mt: '32px' }}>
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

      {isEmptyAll ? (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted, letterSpacing: '0.06em', py: '16px' }}>
          {t.empty}
        </Typography>
      ) : (
        <>
          <HistoryDateSelector
            groupedDates={groupedDates}
            grouped={grouped}
            selectedDate={selectedDate}
            onSelect={setSelectedDate}
            t={t}
          />
          <HistoryFilterBar
            filters={filters}
            setFilters={setFilters}
            availableModes={availableModes}
            availableSynergies={availableSynergies}
            t={t}
          />

          {isEmptyFiltered ? (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.66rem', color: C.textMuted, letterSpacing: '0.06em', py: '16px' }}>
              {t.emptyFiltered}
            </Typography>
          ) : renderGrouped ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {[...groupedFiltered.keys()].map(date => (
                <Box key={date}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, letterSpacing: '0.14em', textTransform: 'uppercase', mb: '6px' }}>
                    {date}
                  </Typography>
                  <Box sx={{ border: `1px solid ${C.borderLight}`, bgcolor: C.surface }}>
                    {groupedFiltered.get(date).map(entry => (
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
          ) : (
            <Box sx={{ border: `1px solid ${C.borderLight}`, bgcolor: C.surface }}>
              {filteredEntries.map(entry => (
                <Box key={entry.id}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, letterSpacing: '0.14em', textTransform: 'uppercase', px: '12px', pt: '6px' }}>
                    {entry.date}
                  </Typography>
                  <HistoryEntry
                    entry={entry}
                    t={t}
                    lang={lang}
                    onMark={onMark}
                    onAutoResolve={onAutoResolve}
                    onDelete={onDelete}
                  />
                </Box>
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
