/**
 * ResultCard.jsx
 * Renders H.E.X.A. V4 JSON responses for single game, parlay, and full-day modes.
 *
 * Props:
 *   data  — the parsed HEXA JSON (data.data from oracle response)
 *   lang  — 'en' | 'es'
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:          '#0a0e17',
  cardBg:      '#111827',
  cardBorder:  '#1e293b',
  accent:      '#f59e0b',
  accentDim:   '#f59e0b0f',
  accentLine:  '#f59e0b33',
  textPrimary: '#f1f5f9',
  textMuted:   '#94a3b8',
  green:       '#22c55e',
  greenDim:    '#22c55e15',
  red:         '#ef4444',
  redDim:      '#ef444415',
  blue:        '#3b82f6',
  blueDim:     '#3b82f615',
  amber:       '#f59e0b',
};

const MONO  = '"JetBrains Mono", "Fira Code", monospace';
const LABEL = '"Outfit", "Inter", system-ui, sans-serif';

// ── i18n ─────────────────────────────────────────────────────────────────────
const L = {
  en: {
    masterPick:       'Master Pick',
    confidence:       'Oracle Confidence',
    oracleReport:     'Oracle Report',
    hexaHunch:        'H.E.X.A. Hunch',
    alertFlags:       'Alert Flags',
    probabilityModel: 'Win Probability',
    bestPick:         'Best Pick',
    away:             'AWAY',
    home:             'HOME',
    risk: { low: 'LOW RISK', medium: 'MED RISK', high: 'HIGH RISK' },
    combinedConf:     'Combined Confidence',
    riskLevel:        'Risk Level',
    strategyNote:     'Strategy Note',
    daySummary:       'Day Summary',
    parseError:       'The Oracle returned an unstructured response.',
    noData:           'No analysis data to display.',
    leg:              'Leg',
    odds: {
      title:      'Market Odds',
      moneyline:  'ML',
      runLine:    'RL',
      overUnder:  'O/U',
      betAmount:  'Stake',
      parlayOdds: 'Parlay Odds',
      combined:   'Combined',
      estimated:  '* Estimated odds — real lines available in regular season',
    },
  },
  es: {
    masterPick:       'Pick Principal',
    confidence:       'Confianza del Oráculo',
    oracleReport:     'Reporte del Oráculo',
    hexaHunch:        'Intuición H.E.X.A.',
    alertFlags:       'Alertas',
    probabilityModel: 'Probabilidad de Victoria',
    bestPick:         'Mejor Pick',
    away:             'VISIT',
    home:             'LOCAL',
    risk: { low: 'RIESGO BAJO', medium: 'RIESGO MED', high: 'RIESGO ALTO' },
    combinedConf:     'Confianza Combinada',
    riskLevel:        'Nivel de Riesgo',
    strategyNote:     'Nota de Estrategia',
    daySummary:       'Resumen del Día',
    parseError:       'El Oráculo devolvió una respuesta no estructurada.',
    noData:           'Sin datos de análisis.',
    leg:              'Pata',
    odds: {
      title:      'Momios del Mercado',
      moneyline:  'ML',
      runLine:    'Línea',
      overUnder:  'M/M',
      betAmount:  'Monto',
      parlayOdds: 'Momios del Parlay',
      combined:   'Combinado',
      estimated:  '* Momios estimados — líneas reales disponibles en temporada regular',
    },
  },
};

// ── Shared sub-components ────────────────────────────────────────────────────

function ConfidenceBar({ value }) {
  const num   = Math.min(100, Math.max(0, Number(value) || 0));
  const color = num >= 75 ? C.green : num >= 50 ? C.amber : C.red;
  return (
    <Box sx={{ height: 6, bgcolor: `${color}22`, borderRadius: 4, overflow: 'hidden' }}>
      <Box
        sx={{
          height: '100%',
          width: `${num}%`,
          bgcolor: color,
          borderRadius: 4,
          transformOrigin: 'left center',
          '@keyframes confGrow': {
            from: { transform: 'scaleX(0)' },
            to:   { transform: 'scaleX(1)' },
          },
          animation: 'confGrow 0.9s cubic-bezier(0.34, 1.4, 0.64, 1) forwards',
        }}
      />
    </Box>
  );
}

function RiskBadge({ risk, t }) {
  if (!risk) return null;
  const key = String(risk).toLowerCase();
  const map = {
    low:    { color: C.green, label: t.risk.low    ?? 'LOW'    },
    medium: { color: C.amber, label: t.risk.medium ?? 'MEDIUM' },
    high:   { color: C.red,   label: t.risk.high   ?? 'HIGH'   },
  };
  const cfg = map[key] ?? map.medium;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        px: '8px',
        py: '2px',
        borderRadius: '4px',
        bgcolor: `${cfg.color}18`,
        border: `1px solid ${cfg.color}44`,
        fontFamily: LABEL,
        fontSize: '0.6rem',
        fontWeight: 700,
        color: cfg.color,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        flexShrink: 0,
      }}
    >
      {cfg.label}
    </Box>
  );
}

function SectionLabel({ children }) {
  return (
    <Typography
      sx={{
        fontFamily: LABEL,
        fontSize: '0.58rem',
        fontWeight: 700,
        color: C.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '0.09em',
        mb: '6px',
      }}
    >
      {children}
    </Typography>
  );
}

function AlertFlagBadge({ flag }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        px: '8px',
        py: '3px',
        bgcolor: C.redDim,
        border: `1px solid ${C.red}44`,
        borderRadius: '4px',
        fontFamily: MONO,
        fontSize: '0.62rem',
        color: C.red,
        lineHeight: 1.4,
      }}
    >
      ⚠ {flag}
    </Box>
  );
}

// ── Odds helpers ─────────────────────────────────────────────────────────────

function fmtAm(n, decimal = false) {
  if (n == null) return '—';
  if (decimal) {
    const dec = n > 0 ? (n / 100) + 1 : (100 / Math.abs(n)) + 1;
    return dec.toFixed(2);
  }
  return n > 0 ? `+${n}` : String(n);
}

function fmtSpread(n) {
  if (n == null) return '?';
  return n > 0 ? `+${n}` : String(n);
}

function calcPayout(stake, american) {
  const s = parseFloat(stake) || 0;
  const n = Number(american);
  if (!s || !n || !isFinite(n)) return null;
  const profit = n > 0 ? s * (n / 100) : s * (100 / Math.abs(n));
  return { profit: profit.toFixed(2), total: (s + profit).toFixed(2) };
}

function decimalToAmerican(dec) {
  if (!dec || dec <= 1) return null;
  return dec >= 2 ? Math.round((dec - 1) * 100) : -Math.round(100 / (dec - 1));
}

/** Determines the most relevant American odds for a parlay leg by parsing leg.pick */
function getLegOdds(leg, oddsObj) {
  if (!oddsObj?.odds) return null;
  const pick = String(leg?.pick ?? '').toLowerCase();
  const { moneyline: ml, runLine: rl, overUnder: ou } = oddsObj.odds;

  if (pick.includes('over'))  return ou.overPrice;
  if (pick.includes('under')) return ou.underPrice;
  if (pick.includes('1.5')) {
    const parts    = String(leg?.game ?? '').split('@');
    const homeAbbr = (parts[1] ?? '').trim().split(' ')[0].toLowerCase();
    const awayAbbr = (parts[0] ?? '').trim().split(' ')[0].toLowerCase();
    if (homeAbbr && pick.includes(homeAbbr)) return rl.home.price;
    if (awayAbbr && pick.includes(awayAbbr)) return rl.away.price;
    return rl.home.price;
  }
  // moneyline — determine direction from game string
  const parts    = String(leg?.game ?? '').split('@');
  const homeAbbr = (parts[1] ?? '').trim().split(' ')[0].toLowerCase();
  const awayAbbr = (parts[0] ?? '').trim().split(' ')[0].toLowerCase();
  if (awayAbbr && pick.includes(awayAbbr)) return ml.away;
  return ml.home;
}

// ── OddsCell ──────────────────────────────────────────────────────────────────

function OddsCell({ label, home, away }) {
  return (
    <Box sx={{ bgcolor: C.bg, borderRadius: '6px', p: '8px 6px', textAlign: 'center' }}>
      <Typography
        sx={{ fontFamily: LABEL, fontSize: '0.53rem', fontWeight: 700, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.05em', mb: '5px' }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700, color: C.green, mb: '2px' }}>
        H: {home}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700, color: C.blue }}>
        A: {away}
      </Typography>
    </Box>
  );
}

// ── PayoutRow ─────────────────────────────────────────────────────────────────

function PayoutRow({ label, stake, profit, total }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px', mb: '5px' }}>
      <Typography sx={{ fontFamily: LABEL, fontSize: '0.58rem', fontWeight: 700, color: C.textMuted, minWidth: '82px', flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.textPrimary }}>${stake}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted }}>→</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', fontWeight: 700, color: C.green }}>+${profit}</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted }}>→</Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', fontWeight: 700, color: C.amber }}>${total}</Typography>
    </Box>
  );
}

// ── LegOddsLine ───────────────────────────────────────────────────────────────

function LegOddsLine({ leg, oddsObj }) {
  const pick      = String(leg?.pick ?? '').toLowerCase();
  const isOver    = pick.includes('over');
  const isUnder   = pick.includes('under');
  const isRunLine = pick.includes('1.5') || (pick.includes('run') && pick.includes('line'));
  const isML      = !isOver && !isUnder && !isRunLine;

  // Fall back to -110 defaults when The Odds API has no data (Spring Training, etc.)
  const estimated = !oddsObj?.odds;
  const ml = oddsObj?.odds?.moneyline ?? { home: -110, away: -110 };
  const rl = oddsObj?.odds?.runLine   ?? { home: { spread: -1.5, price: -110 }, away: { spread: +1.5, price: -110 } };
  const ou = oddsObj?.odds?.overUnder ?? { total: null, overPrice: -110, underPrice: -110 };

  const am = n => (n == null ? '—' : n > 0 ? `+${n}` : String(n));
  const sp = n => (n == null ? '?' : n > 0 ? `+${n}` : String(n));

  // Inline segment: highlighted when it's the relevant market
  const Seg = ({ active, children }) => (
    <Box component="span" sx={{ fontWeight: active ? 700 : 400, color: active ? C.accent : 'inherit' }}>
      {children}
    </Box>
  );
  const Sep = () => (
    <Box component="span" sx={{ mx: '4px', opacity: 0.35 }}>|</Box>
  );

  return (
    <Box sx={{ mt: '8px', pt: '8px', borderTop: `1px solid ${C.cardBorder}60` }}>
      <Box
        component="div"
        sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px' }}
      >
        <Box component="span" sx={{ fontFamily: LABEL, fontSize: '0.51rem', fontWeight: 700, textTransform: 'uppercase', mr: '2px' }}>ML:</Box>
        <Seg active={isML}>{am(ml.home)}/{am(ml.away)}</Seg>

        <Sep />

        <Box component="span" sx={{ fontFamily: LABEL, fontSize: '0.51rem', fontWeight: 700, textTransform: 'uppercase', mr: '2px' }}>RL:</Box>
        <Seg active={isRunLine}>{sp(rl.home.spread)}{am(rl.home.price)}/{sp(rl.away.spread)}{am(rl.away.price)}</Seg>

        <Sep />

        <Box component="span" sx={{ fontFamily: LABEL, fontSize: '0.51rem', fontWeight: 700, textTransform: 'uppercase', mr: '2px' }}>
          O/U {ou.total ?? '—'}:
        </Box>
        <Seg active={isOver}>O{am(ou.overPrice)}</Seg>
        <Box component="span" sx={{ opacity: 0.4 }}>/</Box>
        <Seg active={isUnder}>U{am(ou.underPrice)}</Seg>

        {estimated && (
          <Box component="span" sx={{ ml: '6px', opacity: 0.45, fontStyle: 'italic', fontSize: '0.5rem' }}>*est.</Box>
        )}
      </Box>
    </Box>
  );
}

// ── OddsPanel (single game) ───────────────────────────────────────────────────

function OddsPanel({ odds, hexa, t }) {
  const [decimal, setDecimal] = useState(() => {
    try { return localStorage.getItem('hexaOddsFormat') === 'decimal'; } catch { return false; }
  });
  const [stake, setStake] = useState('10');

  const toggleFmt = () => {
    const next = !decimal;
    setDecimal(next);
    try { localStorage.setItem('hexaOddsFormat', next ? 'decimal' : 'american'); } catch {}
  };

  const { moneyline: ml, runLine: rl, overUnder: ou } = odds;
  const f = (n) => fmtAm(n, decimal);

  // Determine best-pick odds from bp.type
  const bp = hexa?.best_pick;
  let bpOdds = null;
  if (bp) {
    const tp = String(bp.type ?? '').toLowerCase();
    if (tp.includes('over'))                                          bpOdds = ou.overPrice;
    else if (tp.includes('under'))                                    bpOdds = ou.underPrice;
    else if (tp.includes('run') || tp.includes('spread') || tp.includes('line')) bpOdds = rl.home.price;
    else                                                              bpOdds = ml.home;
  }

  const mpPayout = calcPayout(stake, ml.home);
  const bpPayout = bpOdds != null ? calcPayout(stake, bpOdds) : null;

  return (
    <Box sx={{ bgcolor: C.cardBg, border: `1px solid ${C.cardBorder}`, borderRadius: '8px', p: '16px' }}>
      {/* Header + format toggle */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '12px' }}>
        <SectionLabel>{t.odds.title}</SectionLabel>
        <Box
          component="button"
          onClick={toggleFmt}
          sx={{
            px: '9px', py: '3px',
            bgcolor: C.accentDim, border: `1px solid ${C.accentLine}`, borderRadius: '4px',
            fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, color: C.accent, cursor: 'pointer',
          }}
        >
          {decimal ? 'US | ●DEC' : '●US | DEC'}
        </Box>
      </Box>

      {/* 3-column odds table */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', mb: '14px' }}>
        <OddsCell
          label={t.odds.moneyline}
          home={f(ml.home)}
          away={f(ml.away)}
        />
        <OddsCell
          label={t.odds.runLine}
          home={rl.home.spread != null ? `${fmtSpread(rl.home.spread)} ${f(rl.home.price)}` : '—'}
          away={rl.away.spread != null ? `${fmtSpread(rl.away.spread)} ${f(rl.away.price)}` : '—'}
        />
        <OddsCell
          label={`${t.odds.overUnder} ${ou.total ?? '—'}`}
          home={`O ${f(ou.overPrice)}`}
          away={`U ${f(ou.underPrice)}`}
        />
      </Box>

      {/* Bet calculator */}
      <Box sx={{ borderTop: `1px solid ${C.cardBorder}`, pt: '12px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '10px' }}>
          <Typography sx={{ fontFamily: LABEL, fontSize: '0.6rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>
            {t.odds.betAmount}
          </Typography>
          <Box
            component="input"
            type="number"
            min="1"
            value={stake}
            onChange={e => setStake(e.target.value)}
            sx={{
              width: '72px', bgcolor: C.bg, border: `1px solid ${C.cardBorder}`,
              borderRadius: '4px', color: C.textPrimary, fontFamily: MONO,
              fontSize: '0.78rem', px: '8px', py: '4px', outline: 'none',
              '&:focus': { borderColor: C.accent },
            }}
          />
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted }}>USD</Typography>
        </Box>
        {mpPayout && <PayoutRow label={t.masterPick} stake={stake} profit={mpPayout.profit} total={mpPayout.total} />}
        {bpPayout && <PayoutRow label={t.bestPick}   stake={stake} profit={bpPayout.profit} total={bpPayout.total} />}
      </Box>
    </Box>
  );
}

// ── ParlayOddsPanel ───────────────────────────────────────────────────────────

function ParlayOddsPanel({ legOdds, legs, t }) {
  const [decimal, setDecimal] = useState(() => {
    try { return localStorage.getItem('hexaOddsFormat') === 'decimal'; } catch { return false; }
  });
  const [stake, setStake] = useState('10');

  const toggleFmt = () => {
    const next = !decimal;
    setDecimal(next);
    try { localStorage.setItem('hexaOddsFormat', next ? 'decimal' : 'american'); } catch {}
  };

  // Correct parlay math: convert each leg to decimal, multiply, convert back.
  // If a leg has no real odds (Spring Training, props, etc.) → use -110 as default.
  const DEFAULT_ODDS = -110; // 1.909 decimal
  let combinedDec    = 1;
  let estimatedCount = 0;
  const totalLegs    = legs?.length ?? 0;

  for (let i = 0; i < totalLegs; i++) {
    let american = getLegOdds(legs[i], legOdds?.[i]);
    if (american == null) {
      american = DEFAULT_ODDS;
      estimatedCount++;
    }
    // American → decimal conversion
    const dec = american > 0 ? (american / 100) + 1 : (100 / Math.abs(american)) + 1;
    combinedDec *= dec;
  }

  const combinedAmerican = totalLegs > 0 ? decimalToAmerican(combinedDec) : null;
  if (combinedAmerican == null) return null;

  const hasEstimated = estimatedCount > 0;
  const f      = (n) => fmtAm(n, decimal);
  const payout = calcPayout(stake, combinedAmerican);

  return (
    <Box sx={{ bgcolor: C.cardBg, border: `1px solid ${C.cardBorder}`, borderRadius: '8px', p: '16px' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '12px' }}>
        <SectionLabel>{t.odds.parlayOdds}</SectionLabel>
        <Box
          component="button"
          onClick={toggleFmt}
          sx={{
            px: '9px', py: '3px',
            bgcolor: C.accentDim, border: `1px solid ${C.accentLine}`, borderRadius: '4px',
            fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, color: C.accent, cursor: 'pointer',
          }}
        >
          {decimal ? 'US | ●DEC' : '●US | DEC'}
        </Box>
      </Box>

      {/* Combined odds display */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', mb: hasEstimated ? '6px' : '12px' }}>
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.62rem', color: C.textMuted, flexShrink: 0 }}>
          {t.odds.combined}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '1.05rem', fontWeight: 700, color: C.accent }}>
          {f(combinedAmerican)}
        </Typography>
        {!decimal && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textMuted }}>
            ({combinedDec.toFixed(2)}×)
          </Typography>
        )}
      </Box>

      {/* Estimated odds notice */}
      {hasEstimated && (
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.6rem', color: C.textMuted, fontStyle: 'italic', opacity: 0.7, mb: '12px' }}>
          {t.odds.estimated}
        </Typography>
      )}

      {/* Calculator */}
      <Box sx={{ borderTop: `1px solid ${C.cardBorder}`, pt: '12px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '10px' }}>
          <Typography sx={{ fontFamily: LABEL, fontSize: '0.6rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>
            {t.odds.betAmount}
          </Typography>
          <Box
            component="input"
            type="number"
            min="1"
            value={stake}
            onChange={e => setStake(e.target.value)}
            sx={{
              width: '72px', bgcolor: C.bg, border: `1px solid ${C.cardBorder}`,
              borderRadius: '4px', color: C.textPrimary, fontFamily: MONO,
              fontSize: '0.78rem', px: '8px', py: '4px', outline: 'none',
              '&:focus': { borderColor: C.accent },
            }}
          />
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted }}>USD</Typography>
        </Box>
        {payout && <PayoutRow label={t.odds.parlayOdds} stake={stake} profit={payout.profit} total={payout.total} />}
      </Box>
    </Box>
  );
}

// ── SINGLE GAME ───────────────────────────────────────────────────────────────

function ProbabilityBar({ homeWins, awayWins, t }) {
  const h = Number(homeWins) || 0;
  const a = Number(awayWins) || 0;
  const total = h + a || 1;
  const homePct = Math.round((h / total) * 100);
  const awayPct = 100 - homePct;

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          height: 10,
          borderRadius: '5px',
          overflow: 'hidden',
          mb: '6px',
        }}
      >
        <Box
          sx={{
            width: `${awayPct}%`,
            bgcolor: C.blue,
            transition: 'width 0.6s ease',
          }}
        />
        <Box
          sx={{
            width: `${homePct}%`,
            bgcolor: C.green,
            transition: 'width 0.6s ease',
          }}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.blue, fontWeight: 700 }}>
          {t.away} {awayPct}%
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.green, fontWeight: 700 }}>
          {t.home} {homePct}%
        </Typography>
      </Box>
    </Box>
  );
}

function SingleGameResult({ hexa, t }) {
  const mp         = hexa.master_prediction ?? {};
  const bp         = hexa.best_pick;
  const pm         = hexa.probability_model;
  const confidence = Math.min(100, Math.max(0, Number(mp.oracle_confidence) || 0));
  const confColor  = confidence >= 75 ? C.green : confidence >= 50 ? C.amber : C.red;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Master Pick ── */}
      <Box
        sx={{
          border: `1.5px solid ${C.accent}`,
          borderRadius: '10px',
          background: `linear-gradient(135deg, ${C.accentDim} 0%, ${C.cardBg} 60%)`,
          p: '20px',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '12px' }}>
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.62rem',
              fontWeight: 700,
              color: C.accent,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
            }}
          >
            ◆ {t.masterPick}
          </Typography>
          <RiskBadge risk={hexa.model_risk} t={t} />
        </Box>

        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: '1.05rem',
            fontWeight: 700,
            color: C.textPrimary,
            lineHeight: 1.4,
            mb: '6px',
          }}
        >
          {mp.pick ?? '—'}
        </Typography>

        {mp.bet_value && (
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.75rem',
              color: C.textMuted,
              mb: '14px',
            }}
          >
            {mp.bet_value}
          </Typography>
        )}

        <SectionLabel>{t.confidence}</SectionLabel>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Box sx={{ flex: 1 }}>
            <ConfidenceBar value={confidence} />
          </Box>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.82rem',
              fontWeight: 700,
              color: confColor,
              flexShrink: 0,
              minWidth: '36px',
              textAlign: 'right',
            }}
          >
            {confidence}%
          </Typography>
        </Box>
      </Box>

      {/* ── Oracle Report ── */}
      {hexa.oracle_report && (
        <Box>
          <SectionLabel>{t.oracleReport}</SectionLabel>
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.82rem',
              color: C.textPrimary,
              lineHeight: 1.75,
            }}
          >
            {hexa.oracle_report}
          </Typography>
        </Box>
      )}

      {/* ── H.E.X.A. Hunch ── */}
      {hexa.hexa_hunch && (
        <Box
          sx={{
            borderLeft: `3px solid ${C.accent}`,
            pl: '16px',
            py: '6px',
            bgcolor: C.accentDim,
            borderRadius: '0 6px 6px 0',
          }}
        >
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.6rem',
              fontWeight: 700,
              color: C.accent,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              mb: '6px',
            }}
          >
            🧠 {t.hexaHunch}
          </Typography>
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.8rem',
              color: C.textMuted,
              fontStyle: 'italic',
              lineHeight: 1.65,
            }}
          >
            {hexa.hexa_hunch}
          </Typography>
        </Box>
      )}

      {/* ── Alert Flags ── */}
      {hexa.alert_flags?.length > 0 && (
        <Box>
          <SectionLabel>{t.alertFlags}</SectionLabel>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {hexa.alert_flags.map((flag, i) => (
              <AlertFlagBadge key={i} flag={flag} />
            ))}
          </Box>
        </Box>
      )}

      {/* ── Probability Model ── */}
      {pm && (
        <Box
          sx={{
            bgcolor: C.cardBg,
            border: `1px solid ${C.cardBorder}`,
            borderRadius: '8px',
            p: '16px',
          }}
        >
          <SectionLabel>{t.probabilityModel}</SectionLabel>
          <ProbabilityBar homeWins={pm.home_wins} awayWins={pm.away_wins} t={t} />
        </Box>
      )}

      {/* ── Best Pick ── */}
      {bp && (
        <Box
          sx={{
            bgcolor: C.cardBg,
            border: `1px solid ${C.cardBorder}`,
            borderRadius: '8px',
            p: '16px',
          }}
        >
          <SectionLabel>{t.bestPick}</SectionLabel>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '8px' }}>
            <Box
              sx={{
                px: '8px',
                py: '3px',
                bgcolor: C.blueDim,
                border: `1px solid ${C.blue}44`,
                borderRadius: '4px',
                fontFamily: LABEL,
                fontSize: '0.65rem',
                fontWeight: 700,
                color: C.blue,
              }}
            >
              {bp.type}
            </Box>
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: '0.75rem',
                fontWeight: 700,
                color: Number(bp.confidence) >= 0.75 ? C.green : C.amber,
              }}
            >
              {Math.round(Number(bp.confidence) * 100)}%
            </Typography>
          </Box>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.82rem',
              fontWeight: 600,
              color: C.textPrimary,
            }}
          >
            {bp.detail}
          </Typography>
        </Box>
      )}

      {/* ── Market Odds + Bet Calculator ── */}
      {hexa.odds?.odds && <OddsPanel odds={hexa.odds.odds} hexa={hexa} t={t} />}
    </Box>
  );
}

// ── PARLAY ────────────────────────────────────────────────────────────────────

function ParlayResult({ hexa, t }) {
  const p       = hexa.parlay ?? {};
  const confRaw = Number(p.combined_confidence) || 0;
  const confPct = confRaw <= 1 ? Math.round(confRaw * 100) : Math.round(confRaw);
  const confColor = confPct >= 75 ? C.green : confPct >= 50 ? C.amber : C.red;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── Header ── */}
      <Box
        sx={{
          border: `1.5px solid ${C.accent}`,
          borderRadius: '10px',
          background: `linear-gradient(135deg, ${C.accentDim} 0%, ${C.cardBg} 60%)`,
          p: '20px',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '14px' }}>
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.62rem',
              fontWeight: 700,
              color: C.accent,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
            }}
          >
            ◆ {t.combinedConf}
          </Typography>
          {p.risk_level && (
            <RiskBadge risk={p.risk_level} t={t} />
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Box sx={{ flex: 1 }}>
            <ConfidenceBar value={confPct} />
          </Box>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.85rem',
              fontWeight: 700,
              color: confColor,
              flexShrink: 0,
              minWidth: '40px',
              textAlign: 'right',
            }}
          >
            {confPct}%
          </Typography>
        </Box>
      </Box>

      {/* ── Legs ── */}
      {p.legs?.map((leg, i) => {
        const legConf    = Number(leg.confidence) || 0;
        const legConfPct = legConf <= 1 ? Math.round(legConf * 100) : Math.round(legConf);
        const legColor   = legConfPct >= 75 ? C.green : legConfPct >= 50 ? C.amber : C.red;

        return (
          <Box
            key={i}
            sx={{
              bgcolor: C.cardBg,
              border: `1px solid ${C.cardBorder}`,
              borderLeft: `3px solid ${C.accent}`,
              borderRadius: '0 8px 8px 0',
              p: '14px 16px',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '6px' }}>
              <Typography
                sx={{
                  fontFamily: LABEL,
                  fontSize: '0.65rem',
                  color: C.textMuted,
                }}
              >
                {t.leg} {i + 1} — {leg.game}
              </Typography>
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: legColor,
                  flexShrink: 0,
                }}
              >
                {legConfPct}%
              </Typography>
            </Box>

            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: '0.85rem',
                fontWeight: 700,
                color: C.textPrimary,
                mb: leg.reasoning ? '8px' : 0,
              }}
            >
              {leg.pick}
            </Typography>

            {leg.reasoning && (
              <Typography
                sx={{
                  fontFamily: LABEL,
                  fontSize: '0.73rem',
                  color: C.textMuted,
                  lineHeight: 1.6,
                }}
              >
                {leg.reasoning}
              </Typography>
            )}

            {/* Per-leg odds summary line */}
            <LegOddsLine leg={leg} oddsObj={hexa.legOdds?.[i]} />
          </Box>
        );
      })}

      {/* ── Strategy Note ── */}
      {p.strategy_note && (
        <Box
          sx={{
            borderLeft: `3px solid ${C.textMuted}`,
            pl: '16px',
            py: '6px',
          }}
        >
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.78rem',
              color: C.textMuted,
              fontStyle: 'italic',
              lineHeight: 1.65,
            }}
          >
            {p.strategy_note}
          </Typography>
        </Box>
      )}

      {/* ── Parlay Odds + Combined Calculator ── */}
      {p.legs?.length > 0 && (
        <ParlayOddsPanel legOdds={hexa.legOdds ?? []} legs={p.legs} t={t} />
      )}
    </Box>
  );
}

// ── FULL DAY ──────────────────────────────────────────────────────────────────

function FullDayGameRow({ game, t }) {
  const mp  = game.master_prediction ?? {};
  const conf = Math.min(100, Math.max(0, Number(mp.oracle_confidence) || 0));

  return (
    <Box
      sx={{
        bgcolor: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderRadius: '8px',
        p: '16px',
      }}
    >
      {/* Matchup + risk */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '10px' }}>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: '0.9rem',
            fontWeight: 700,
            color: C.textPrimary,
          }}
        >
          {game.matchup}
        </Typography>
        <RiskBadge risk={game.model_risk} t={t} />
      </Box>

      {/* Master pick mini-card */}
      {mp.pick && (
        <Box
          sx={{
            bgcolor: C.accentDim,
            border: `1px solid ${C.accentLine}`,
            borderRadius: '6px',
            p: '10px 12px',
            mb: '10px',
          }}
        >
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.8rem',
              fontWeight: 700,
              color: C.accent,
              mb: '6px',
            }}
          >
            {mp.pick}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Box sx={{ flex: 1 }}>
              <ConfidenceBar value={conf} />
            </Box>
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize: '0.65rem',
                fontWeight: 700,
                color: conf >= 75 ? C.green : conf >= 50 ? C.amber : C.red,
                flexShrink: 0,
              }}
            >
              {conf}%
            </Typography>
          </Box>
        </Box>
      )}

      {/* Oracle report (3-line clamp) */}
      {game.oracle_report && (
        <Typography
          sx={{
            fontFamily: LABEL,
            fontSize: '0.75rem',
            color: C.textMuted,
            lineHeight: 1.6,
            mb: '10px',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {game.oracle_report}
        </Typography>
      )}

      {/* Alert flags inline */}
      {game.alert_flags?.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {game.alert_flags.map((flag, i) => (
            <AlertFlagBadge key={i} flag={flag} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function FullDayResult({ hexa, t }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Day summary */}
      {hexa.day_summary && (
        <Box
          sx={{
            border: `1.5px solid ${C.accent}`,
            borderRadius: '10px',
            background: `linear-gradient(135deg, ${C.accentDim} 0%, ${C.cardBg} 60%)`,
            p: '20px',
          }}
        >
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.62rem',
              fontWeight: 700,
              color: C.accent,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              mb: '10px',
            }}
          >
            ◆ {t.daySummary}
          </Typography>
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.85rem',
              color: C.textPrimary,
              lineHeight: 1.75,
            }}
          >
            {hexa.day_summary}
          </Typography>
        </Box>
      )}

      {/* Per-game rows */}
      {hexa.games?.map((game, i) => (
        <FullDayGameRow key={i} game={game} t={t} />
      ))}
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function ResultCard({ data, lang = 'en' }) {
  const t = L[lang] ?? L.en;

  if (!data) {
    return (
      <Typography sx={{ fontFamily: LABEL, fontSize: '0.82rem', color: C.textMuted }}>
        {t.noData}
      </Typography>
    );
  }

  // Single game
  if (data.master_prediction) {
    return <SingleGameResult hexa={data} t={t} />;
  }

  // Parlay
  if (data.parlay) {
    return <ParlayResult hexa={data} t={t} />;
  }

  // Full day
  if (data.games) {
    return <FullDayResult hexa={data} t={t} />;
  }

  // Unknown shape — show raw JSON
  return (
    <Box
      sx={{
        bgcolor: C.cardBg,
        border: `1px solid ${C.cardBorder}`,
        borderRadius: '8px',
        p: 2,
      }}
    >
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize: '0.72rem',
          color: C.textMuted,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {JSON.stringify(data, null, 2)}
      </Typography>
    </Box>
  );
}
