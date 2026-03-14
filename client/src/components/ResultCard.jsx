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
import { useAuth } from '../store/authStore';

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:          '#04080F',
  bgSec:       '#080D1A',
  cardBg:      '#0D1424',
  cardBgLight: '#111C30',
  cardBorder:  '#1A2540',
  accent:      '#0066FF',
  accentSec:   '#00D4FF',
  accentDim:   'rgba(0,102,255,0.08)',
  accentLine:  'rgba(0,102,255,0.25)',
  textPrimary: '#E8EDF5',
  textMuted:   '#5A7090',
  green:       '#00E676',
  greenDim:    'rgba(0,230,118,0.08)',
  red:         '#FF3D57',
  redDim:      'rgba(255,61,87,0.08)',
  blue:        '#0066FF',
  blueDim:     'rgba(0,102,255,0.08)',
  amber:       '#FFB800',
  gold:        '#FFB800',
};

const BARLOW = '"Barlow Condensed", system-ui, sans-serif';
const MONO   = '"JetBrains Mono", "Fira Code", monospace';
const LABEL  = '"DM Sans", system-ui, sans-serif';

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
  const num = Math.min(100, Math.max(0, Number(value) || 0));
  // >70%: cyan glow, 50-70%: blue glow, <50%: orange glow
  const glowColor  = num >= 70 ? C.accentSec : num >= 50 ? C.accent : '#FF9800';
  const glowRadius = num >= 70 ? '12px' : '8px';
  return (
    <Box sx={{ height: 6, bgcolor: C.cardBorder, borderRadius: '2px', overflow: 'visible', position: 'relative' }}>
      <Box
        sx={{
          height:          '100%',
          width:           `${num}%`,
          background:      `linear-gradient(90deg, ${C.accent} 0%, ${C.accentSec} 100%)`,
          borderRadius:    '2px',
          transformOrigin: 'left center',
          boxShadow:       `0 0 ${glowRadius} ${glowColor}AA, 0 0 ${glowRadius} ${glowColor}60`,
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
        display:       'inline-block',
        px:            '8px',
        py:            '2px',
        borderRadius:  '2px',
        bgcolor:       `${cfg.color}18`,
        border:        `1px solid ${cfg.color}44`,
        fontFamily:    BARLOW,
        fontSize:      '0.62rem',
        fontWeight:    700,
        color:         cfg.color,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        flexShrink:    0,
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
        fontFamily:    BARLOW,
        fontSize:      '0.7rem',
        fontWeight:    700,
        color:         C.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        mb:            '6px',
        display:       'flex',
        alignItems:    'center',
        gap:           '6px',
        '&::before': {
          content:      '""',
          display:      'inline-block',
          width:        '6px',
          height:       '6px',
          borderRadius: '50%',
          bgcolor:      C.accent,
          flexShrink:   0,
        },
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
        display:      'inline-flex',
        alignItems:   'center',
        gap:          '5px',
        px:           '10px',
        py:           '4px',
        bgcolor:      'rgba(255,61,87,0.06)',
        border:       `1px solid rgba(255,61,87,0.2)`,
        borderLeft:   `3px solid ${C.red}`,
        borderRadius: '100px',
        fontFamily:   MONO,
        fontSize:     '0.62rem',
        color:        C.red,
        lineHeight:   1.4,
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

/** Returns true only for real American odds: integer >= +100 or <= -100 */
function isValidOdds(n) {
  return n != null && isFinite(n) && Number.isInteger(Number(n)) && (n >= 100 || n <= -100);
}

/** Sanitizes an odds value — returns null if it's not a valid American odds number */
function sanitizeOdds(n) {
  const num = Number(n);
  return isValidOdds(num) ? num : null;
}

/**
 * Determines the most relevant American odds for a parlay leg from The Odds API data only.
 * Never reads from leg.odds or any Claude-generated field.
 * Returns null if no valid real odds found — caller will use estimated default.
 */
function getLegOdds(leg, oddsObj) {
  if (!oddsObj?.odds) return null;
  const pick = String(leg?.pick ?? '').toLowerCase();
  const { moneyline: ml, runLine: rl, overUnder: ou } = oddsObj.odds;

  let raw = null;
  if (pick.includes('over'))  raw = ou?.overPrice;
  else if (pick.includes('under')) raw = ou?.underPrice;
  else if (pick.includes('1.5') || pick.includes('run line')) {
    const parts    = String(leg?.game ?? '').split('@');
    const homeAbbr = (parts[1] ?? '').trim().split(/\s+/)[0].toLowerCase();
    const awayAbbr = (parts[0] ?? '').trim().split(/\s+/)[0].toLowerCase();
    if (homeAbbr && pick.includes(homeAbbr)) raw = rl?.home?.price;
    else if (awayAbbr && pick.includes(awayAbbr)) raw = rl?.away?.price;
    else raw = rl?.home?.price;
  } else {
    // moneyline — determine direction from game string
    const parts    = String(leg?.game ?? '').split('@');
    const homeAbbr = (parts[1] ?? '').trim().split(/\s+/)[0].toLowerCase();
    const awayAbbr = (parts[0] ?? '').trim().split(/\s+/)[0].toLowerCase();
    raw = (awayAbbr && pick.includes(awayAbbr)) ? ml?.away : ml?.home;
  }
  return sanitizeOdds(raw);
}

// Industry-standard estimated odds when no real API data is available
const ESTIMATED_ODDS = -110;

/** Returns -110 as the standard estimated default (used when Odds API has no data) */
function getEstimatedOdds() {
  return ESTIMATED_ODDS;
}

// ── OddsCell ──────────────────────────────────────────────────────────────────

function OddsCell({ label, home, away }) {
  return (
    <Box sx={{ bgcolor: C.bgSec, border: `1px solid ${C.cardBorder}`, borderRadius: '2px', p: '8px 6px', textAlign: 'center' }}>
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

/**
 * Shows a single clean odds line per parlay leg.
 * Detects pick type and highlights only the relevant momio.
 */
function LegOddsLine({ leg, oddsObj, t }) {
  const isEs = t?.leg === 'Pata';

  // Only use Odds API data via getLegOdds (validated, never Claude's response fields)
  const realOdds    = getLegOdds(leg, oddsObj);
  const isEstimated = realOdds == null;
  const displayOdds = realOdds ?? ESTIMATED_ODDS;

  const amFmt = (n) => n == null ? '—' : n > 0 ? `+${n}` : String(n);

  const label = isEstimated
    ? (isEs ? 'Momio est.' : 'Est. odds')
    : (isEs ? 'Momio'      : 'Odds');

  return (
    <Box sx={{ mt: '8px', pt: '6px', borderTop: `1px solid ${C.cardBorder}60`, display: 'flex', alignItems: 'center', gap: '5px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, lineHeight: 1 }}>📊</Typography>
      <Typography sx={{ fontFamily: LABEL, fontSize: '0.58rem', color: C.textMuted, flexShrink: 0 }}>
        {label}:
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700, color: C.accent }}>
        {amFmt(displayOdds)}
      </Typography>
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
    <Box sx={{ bgcolor: C.cardBg, border: `1px solid ${C.cardBorder}`, borderRadius: '2px', p: '16px' }}>
      {/* Header + format toggle */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '12px' }}>
        <SectionLabel>{t.odds.title}</SectionLabel>
        <Box
          component="button"
          onClick={toggleFmt}
          sx={{
            px: '9px', py: '3px',
            bgcolor: C.accentDim, border: `1px solid ${C.accentLine}`, borderRadius: '2px',
            fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, color: C.accentSec, cursor: 'pointer',
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
  // If a leg has no real odds (Spring Training, props, etc.) → use pick-type-aware default.
  let combinedDec    = 1;
  let estimatedCount = 0;
  const totalLegs    = legs?.length ?? 0;

  for (let i = 0; i < totalLegs; i++) {
    let american = getLegOdds(legs[i], legOdds?.[i]);
    if (american == null) {
      american = getEstimatedOdds();
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
    <Box sx={{ bgcolor: C.cardBg, border: `1px solid ${C.cardBorder}`, borderRadius: '2px', p: '16px' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '12px' }}>
        <SectionLabel>{t.odds.parlayOdds}</SectionLabel>
        <Box
          component="button"
          onClick={toggleFmt}
          sx={{
            px: '9px', py: '3px',
            bgcolor: C.accentDim, border: `1px solid ${C.accentLine}`, borderRadius: '2px',
            fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, color: C.accentSec, cursor: 'pointer',
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
          {decimal ? `${combinedDec.toFixed(2)}×` : fmtAm(combinedAmerican, false)}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textMuted }}>
          {decimal
            ? `(${fmtAm(combinedAmerican, false)})`
            : `(${combinedDec.toFixed(2)}×)`
          }
        </Typography>
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

// ── AgregarABanca button + inline form ───────────────────────────────────────

function AgregarABanca({ matchup, pick, odds }) {
  const { isAuthenticated, token } = useAuth();
  const [open,    setOpen]    = useState(false);
  const [stake,   setStake]   = useState('');
  const [busy,    setBusy]    = useState(false);
  const [success, setSuccess] = useState(false);
  const [err,     setErr]     = useState('');

  if (!isAuthenticated) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const s = Number(stake);
    if (!s || s <= 0) { setErr('Ingresa un monto válido'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/bankroll/bet', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ matchup, pick, odds, stake: s, source: 'hexa' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error al registrar');
      setSuccess(true);
      setOpen(false);
      setStake('');
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const inputSx = {
    background:   '#0a0e17',
    border:       '1px solid #1e293b',
    borderRadius: '4px',
    color:        '#f1f5f9',
    fontFamily:   '"JetBrains Mono", monospace',
    fontSize:     '0.82rem',
    padding:      '6px 10px',
    outline:      'none',
    colorScheme:  'dark',
    width:        '90px',
  };

  return (
    <Box sx={{ mt: '12px' }}>
      {success ? (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', px: '12px', py: '6px', bgcolor: '#22c55e15', border: '1px solid #22c55e44', borderRadius: '4px' }}>
          <Typography sx={{ fontFamily: LABEL, fontSize: '0.72rem', fontWeight: 700, color: '#22c55e' }}>
            ✓ Apuesta registrada en tu banca
          </Typography>
        </Box>
      ) : !open ? (
        <Box
          component="button"
          onClick={() => setOpen(true)}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            px: '12px', py: '5px',
            bgcolor: 'transparent',
            border: '1px solid #3b82f666',
            borderRadius: '4px',
            color: '#3b82f6',
            fontFamily: LABEL,
            fontSize: '0.68rem',
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.15s',
            '&:hover': { bgcolor: '#3b82f610', borderColor: '#3b82f6' },
          }}
        >
          + AGREGAR A BANCA
        </Box>
      ) : (
        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
            bgcolor: '#0a0e17', border: '1px solid #1e293b', borderRadius: '6px',
            p: '10px 12px',
          }}
        >
          <Typography sx={{ fontFamily: LABEL, fontSize: '0.65rem', color: '#94a3b8', flexShrink: 0 }}>
            Stake:
          </Typography>
          <input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="10.00"
            autoFocus
            value={stake}
            onChange={e => setStake(e.target.value)}
            style={inputSx}
          />
          <Typography sx={{ fontFamily: LABEL, fontSize: '0.6rem', color: '#475569', flexShrink: 0 }}>
            Pick: <span style={{ color: '#94a3b8' }}>{pick}</span>
          </Typography>
          <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.65rem', color: '#94a3b8', flexShrink: 0 }}>
            {odds > 0 ? `+${odds}` : odds}
          </Typography>
          {err && <Typography sx={{ fontFamily: LABEL, fontSize: '0.65rem', color: '#ef4444', width: '100%' }}>{err}</Typography>}
          <Box sx={{ display: 'flex', gap: '6px', ml: 'auto', flexShrink: 0 }}>
            <Box
              component="button"
              type="button"
              onClick={() => { setOpen(false); setErr(''); setStake(''); }}
              sx={{ px: '10px', py: '4px', bgcolor: 'transparent', border: '1px solid #1e293b', borderRadius: '4px', color: '#64748b', fontFamily: LABEL, fontSize: '0.68rem', cursor: 'pointer' }}
            >
              Cancelar
            </Box>
            <Box
              component="button"
              type="submit"
              disabled={busy}
              sx={{ px: '12px', py: '4px', bgcolor: '#3b82f6', border: 'none', borderRadius: '4px', color: '#fff', fontFamily: LABEL, fontSize: '0.68rem', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
            >
              {busy ? '…' : 'Registrar'}
            </Box>
          </Box>
        </Box>
      )}
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
          border:       `1px solid ${C.accentLine}`,
          borderLeft:   `4px solid ${C.accentSec}`,
          borderRadius: '2px',
          background:   `linear-gradient(135deg, rgba(0,102,255,0.09) 0%, #0D1424 50%, #111827 100%)`,
          boxShadow:    'inset 0 0 30px rgba(0,102,255,0.04), 0 0 20px rgba(0,102,255,0.06)',
          p:            '20px',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '12px' }}>
          <Typography
            sx={{
              fontFamily:    BARLOW,
              fontSize:      '0.72rem',
              fontWeight:    700,
              color:         C.accentSec,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
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

        {/* ── AGREGAR A BANCA ── */}
        <AgregarABanca
          matchup={hexa.matchup ?? hexa.odds?.game ?? ''}
          pick={mp.pick ?? ''}
          odds={hexa.odds?.odds?.moneyline?.home ?? null}
        />
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
              fontFamily:    BARLOW,
              fontSize:      '0.65rem',
              fontWeight:    700,
              color:         C.accentSec,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              mb:            '6px',
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
                px:           '8px',
                py:           '3px',
                bgcolor:      C.blueDim,
                border:       `1px solid ${C.blue}44`,
                borderRadius: '2px',
                fontFamily:   BARLOW,
                fontSize:     '0.68rem',
                fontWeight:   700,
                color:        C.accentSec,
                letterSpacing:'0.06em',
                textTransform:'uppercase',
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
          border:       `1px solid ${C.accentLine}`,
          borderLeft:   `4px solid ${C.accentSec}`,
          borderRadius: '2px',
          background:   `linear-gradient(135deg, rgba(0,102,255,0.09) 0%, #0D1424 50%, #111827 100%)`,
          boxShadow:    'inset 0 0 30px rgba(0,102,255,0.04), 0 0 20px rgba(0,102,255,0.06)',
          p:            '20px',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '14px' }}>
          <Typography
            sx={{
              fontFamily:    BARLOW,
              fontSize:      '0.72rem',
              fontWeight:    700,
              color:         C.accentSec,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
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
              bgcolor:      C.cardBg,
              border:       `1px solid ${C.cardBorder}`,
              borderLeft:   `3px solid ${C.accent}`,
              borderRadius: '0 2px 2px 0',
              p:            '14px 16px',
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
            <LegOddsLine leg={leg} oddsObj={hexa.legOdds?.[i]} t={t} />
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
            bgcolor:      C.accentDim,
            border:       `1px solid ${C.accentLine}`,
            borderRadius: '2px',
            p:            '10px 12px',
            mb:           '10px',
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
            border:       `1px solid ${C.cardBorder}`,
            borderLeft:   `4px solid ${C.accent}`,
            borderRadius: '2px',
            background:   `linear-gradient(135deg, rgba(0,102,255,0.07) 0%, ${C.cardBgLight} 60%)`,
            p:            '20px',
          }}
        >
          <Typography
            sx={{
              fontFamily:    BARLOW,
              fontSize:      '0.72rem',
              fontWeight:    700,
              color:         C.accentSec,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
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
