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
import { C, BARLOW, MONO, SANS } from '../theme';
import DecisionCenter from './premium/DecisionCenter';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── i18n ─────────────────────────────────────────────────────────────────────
const L = {
  en: {
    safePick:         'SAFE PICK',
    hitProbability:   'HIT PROBABILITY',
    otherSafeOptions: 'OTHER SAFE OPTIONS',
    masterPick:       'Master Pick',
    confidence:       'Oracle Confidence',
    oracleReport:     'Oracle Report',
    explainPick:      'Explain Pick',
    hideExplanation:  'Hide Explanation',
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
    modelProb:        'Model Prob',
    impliedProb:      'Vegas Implied',
    edge:             'Edge',
    valueTier:        'Value Tier',
    selectionScope:   'Selection Scope',
    topCandidates:    'Top Candidates',
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
    disclaimers: {
      humanTitle:   '⚠️ IMPORTANT NOTICE',
      humanBody:    'H.E.X.A. is an advanced statistical analysis system. All analysis is subject to unpredictable human factors: last-minute injuries, manager decisions, real-time weather conditions, and natural game variance. Sports betting carries financial risk. Only bet what you can afford to lose.',
      lineupTitle:  '📋 LINEUPS',
      lineupBody:   'For greater accuracy, it is recommended to wait until official lineups are released (generally 3–4 hours before game time) before requesting analysis.',
      showMore:     'Show',
      showLess:     'Hide',
    },
  },
  es: {
    safePick:         'PICK SEGURO',
    hitProbability:   'PROBABILIDAD DE ACIERTO',
    otherSafeOptions: 'OTRAS OPCIONES SEGURAS',
    masterPick:       'Pick Principal',
    confidence:       'Confianza del Oráculo',
    oracleReport:     'Reporte del Oráculo',
    explainPick:      'Explicar Pick',
    hideExplanation:  'Ocultar Explicación',
    hexaHunch:        'Corazonada H.E.X.A.',
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
    modelProb:        'Prob. Modelo',
    impliedProb:      'Implícita Vegas',
    edge:             'Edge',
    valueTier:        'Nivel de Valor',
    selectionScope:   'Alcance de Selección',
    topCandidates:    'Top Candidatos',
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
    disclaimers: {
      humanTitle:   '⚠️ AVISO IMPORTANTE',
      humanBody:    'H.E.X.A. es un sistema de análisis estadístico avanzado. Todo análisis está sujeto al factor humano impredecible: lesiones de último momento, decisiones del manager, condiciones climáticas en tiempo real y varianza natural del juego. Las apuestas deportivas conllevan riesgo financiero. Apuesta solo lo que estás dispuesto a perder.',
      lineupTitle:  '📋 ALINEACIONES',
      lineupBody:   'Para mayor precisión, se recomienda esperar a que las alineaciones oficiales sean publicadas (generalmente 3–4 horas antes del juego) antes de solicitar el análisis.',
      showMore:     'Ver',
      showLess:     'Ocultar',
    },
  },
};

// ── Disclaimers (collapsible) ────────────────────────────────────────────────

function formatEngineLabel(value, lang = 'en') {
  const key = String(value ?? '').toLowerCase();
  if (key === 'grok') return 'Grok';
  if (key === 'dual') return lang === 'es' ? 'Dual (Sonnet + Grok)' : 'Dual (Sonnet + Grok)';
  if (key === 'sonnet') return 'Sonnet';
  return value ? String(value) : '—';
}

function formatProviderModel(provider, model) {
  const providerLabel = provider ? String(provider).toUpperCase() : '—';
  if (!model) return providerLabel;
  return `${providerLabel} · ${model}`;
}

function EngineMetaCard({ meta, lang = 'en' }) {
  if (!meta || typeof meta !== 'object') return null;

  const shouldShow = (
    meta.requested_engine &&
    (meta.requested_engine !== 'sonnet' || meta.shadow_provider || meta.divergence || (meta.notes?.length ?? 0) > 0)
  );
  if (!shouldShow) return null;

  const labels = lang === 'es'
    ? {
        title: 'Motor de Analisis',
        requested: 'Solicitado',
        primary: 'Visible',
        shadow: 'Shadow',
        status: 'Estado',
        agreed: 'Sonnet y Grok coincidieron.',
        diverged: 'Sonnet y Grok discreparon en el pick principal.',
        unavailable: 'Shadow no disponible en esta corrida.',
      }
    : {
        title: 'Analysis Engine',
        requested: 'Requested',
        primary: 'Visible',
        shadow: 'Shadow',
        status: 'Status',
        agreed: 'Sonnet and Grok agreed on the top pick.',
        diverged: 'Sonnet and Grok disagreed on the top pick.',
        unavailable: 'Shadow engine was unavailable for this run.',
      };

  let statusText = '';
  if (meta.requested_engine === 'dual') {
    if (!meta.shadow_provider) statusText = labels.unavailable;
    else statusText = meta.divergence ? labels.diverged : labels.agreed;
  } else {
    statusText = formatProviderModel(meta.primary_provider, meta.primary_model);
  }

  return (
    <Box
      sx={{
        border: `1px solid ${C.border}`,
        bgcolor: 'rgba(255,255,255,0.02)',
        p: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: '0.64rem', color: C.cyan, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        {labels.title}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted }}>
          {labels.requested}: {formatEngineLabel(meta.requested_engine, lang)}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textSecondary }}>
          {labels.primary}: {formatProviderModel(meta.primary_provider, meta.primary_model)}
        </Typography>
        {meta.shadow_provider && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textSecondary }}>
            {labels.shadow}: {formatProviderModel(meta.shadow_provider, meta.shadow_model)}
          </Typography>
        )}
      </Box>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: meta.divergence ? C.amber : C.textSecondary, lineHeight: 1.6 }}>
        {labels.status}: {statusText}
      </Typography>
      {Array.isArray(meta.notes) && meta.notes.length > 0 && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, lineHeight: 1.6 }}>
          {meta.notes.join(' ')}
        </Typography>
      )}
    </Box>
  );
}

function DisclaimerBlock({ title, body, accentColor }) {
  const [open, setOpen] = useState(false);
  return (
    <Box
      sx={{
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: '0 4px 4px 0',
        bgcolor: `${accentColor}0A`,
        overflow: 'hidden',
      }}
    >
      <Box
        component="button"
        onClick={() => setOpen(v => !v)}
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', px: '12px', py: '8px', background: 'none', border: 'none',
          cursor: 'pointer', gap: '8px',
        }}
      >
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.67rem', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'left' }}>
          {title}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </Typography>
      </Box>
      {open && (
        <Typography sx={{ fontFamily: SANS, fontSize: '0.73rem', color: C.textMuted, lineHeight: 1.65, px: '12px', pb: '10px' }}>
          {body}
        </Typography>
      )}
    </Box>
  );
}

function Disclaimers({ t }) {
  const d = t.disclaimers;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', mt: '4px' }}>
      <DisclaimerBlock title={d.humanTitle}  body={d.humanBody}  accentColor={C.amber} />
      <DisclaimerBlock title={d.lineupTitle} body={d.lineupBody} accentColor={C.accent} />
    </Box>
  );
}

// ── Shared sub-components ────────────────────────────────────────────────────

function ConfidenceBar({ value }) {
  const num = Math.min(100, Math.max(0, Number(value) || 0));
  const circ = 94.2;
  const strokeColor = num >= 75 ? C.green : num >= 50 ? C.cyan : C.accent;
  return (
    <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
      <svg viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', width: 36, height: 36 }}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(0,217,255,0.08)" strokeWidth="2" />
        <circle
          cx="18" cy="18" r="15" fill="none"
          stroke={strokeColor} strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (circ * num / 100)}
          style={{ filter: `drop-shadow(0 0 3px ${strokeColor})` }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: MONO, fontSize: '9px', color: strokeColor,
        textShadow: `0 0 6px ${strokeColor}`,
      }}>
        {num}
      </div>
    </div>
  );
}

function RiskBadge({ risk, t }) {
  if (!risk) return null;
  const key = String(risk).toLowerCase();
  const map = {
    low:    { color: C.green, bg: C.greenDim, border: C.greenLine, label: t.risk.low    ?? 'LOW'    },
    medium: { color: C.amber, bg: C.amberDim, border: C.amberLine, label: t.risk.medium ?? 'MEDIUM' },
    high:   { color: C.red,   bg: C.redDim,   border: C.redLine,   label: t.risk.high   ?? 'HIGH'   },
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
        bgcolor:       cfg.bg,
        border:        `1px solid ${cfg.border}`,
        fontFamily:    MONO,
        fontSize:      '9px',
        fontWeight:    700,
        color:         cfg.color,
        letterSpacing: '1px',
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
      component="div"
      sx={{
        fontFamily:    MONO,
        fontSize:      '8px',
        color:         C.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '3px',
        mb:            '8px',
        display:       'flex',
        alignItems:    'center',
        gap:           '4px',
      }}
    >
      <span style={{ color: C.cyan, opacity: 0.7 }}>[ </span>
      {children}
      <span style={{ color: C.cyan, opacity: 0.7 }}> ]</span>
    </Typography>
  );
}

// Collapsible explanation block: label + toggle button that reveals the body.
// Used for oracle_report so casual users see the pick first and can opt in to
// read the full statistical reasoning.
function ExplainPickSection({ label, body, t }) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ borderBottom: `1px solid ${C.border}`, pb: '16px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', mb: open ? '10px' : '0' }}>
        <SectionLabel>{label}</SectionLabel>
        <Box
          component="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          sx={{
            flexShrink:    0,
            display:       'inline-flex',
            alignItems:    'center',
            gap:           '6px',
            px:            '10px',
            py:            '5px',
            border:        `1px solid ${C.accentLine}`,
            bgcolor:       open ? C.accentDim : 'transparent',
            color:         C.accent,
            fontFamily:    MONO,
            fontSize:      '10px',
            fontWeight:    700,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            cursor:        'pointer',
            transition:    'all 0.15s',
            mb:            '8px',
            '&:hover':     { bgcolor: C.accentDim, borderColor: C.accent },
          }}
        >
          <span style={{ opacity: 0.85 }}>{open ? '−' : '+'}</span>
          {open ? t.hideExplanation : t.explainPick}
        </Box>
      </Box>
      {open && (
        <Typography
          sx={{
            fontFamily: SANS,
            fontSize:   '13px',
            color:      C.textSecondary,
            lineHeight: 1.8,
          }}
        >
          {body}
        </Typography>
      )}
    </Box>
  );
}

function fmtPct(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)}%` : '—';
}

function fmtAmericanOdds(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num > 0 ? `+${num}` : `${num}`;
}

function BreakdownCell({ label, value, accent = C.cyan }) {
  return (
    <Box sx={{
      minWidth: '92px',
      p: '8px 10px',
      bgcolor: C.surfaceAlt,
      border: `1px solid ${C.border}`,
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.48rem', color: C.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: accent }}>
        {value}
      </Typography>
    </Box>
  );
}

function ValueBreakdownPanel({ breakdown, t }) {
  if (!breakdown) return null;
  const edgeValue = Number(breakdown.edge);
  const edgeColor = !Number.isFinite(edgeValue)
    ? C.textMuted
    : edgeValue > 0
      ? C.green
      : C.red;

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      <BreakdownCell label={t.modelProb ?? 'Model Prob'} value={fmtPct(breakdown.model_probability)} accent={C.cyan} />
      <BreakdownCell label={t.impliedProb ?? 'Vegas Implied'} value={fmtPct(breakdown.implied_probability)} accent={C.amber} />
      <BreakdownCell label={t.edge ?? 'Edge'} value={Number.isFinite(edgeValue) ? `${edgeValue > 0 ? '+' : ''}${edgeValue.toFixed(1)}%` : '—'} accent={edgeColor} />
      <BreakdownCell label={t.valueTier ?? 'Value Tier'} value={breakdown.value_tier ?? '—'} accent={C.accent} />
      {breakdown.odds != null ? (
        <BreakdownCell label="Odds" value={fmtAmericanOdds(breakdown.odds)} accent={C.textPrimary} />
      ) : null}
    </Box>
  );
}

function getFlagColor(flag) {
  const text = String(flag).toLowerCase();
  if (text.includes('limitad') || text.includes('limited') ||
      text.includes('no disponible') || text.includes('unavailable') ||
      text.includes('no confiable') || text.includes('unreliable') ||
      text.includes('spring training') ||
      text.includes('mínima') || text.includes('minimal') ||
      text.includes('reducida') || text.includes('reduced') ||
      text.includes('problemas') || text.includes('problems') ||
      text.includes('sin confirmar') || text.includes('unconfirmed') ||
      text.includes('riesgo') || text.includes('risk') ||
      text.includes('no disponibles') || text.includes('mixtas') ||
      text.includes('disagrees') || text.includes('elevated to high') ||
      text.includes('cannot be applied')) {
    return { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.15)' };
  }
  if (text.includes('hot') || text.includes('streak') || text.includes('!') ||
      text.includes('caliente') || text.includes('racha') ||
      text.includes('coherencia') || text.includes('coherence') ||
      text.includes('regression') || text.includes('regresión') ||
      text.includes('jumped') || text.includes('increased') || text.includes('subió') ||
      text.includes('bb/9') || text.includes('era') ||
      text.includes('command') || text.includes('control') ||
      text.includes('walk') || text.includes('bases on balls')) {
    return { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.15)' };
  }
  if (text.includes('%') || text.includes('elite') || text.includes('whiff') ||
      text.includes('dominan') || text.includes('strong')) {
    return { color: '#22c55e', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.12)' };
  }
  return { color: '#666', bg: '#1a1a1a', border: '#2a2a2a' };
}

function AlertFlagBadge({ flag }) {
  const flagColors = getFlagColor(flag);
  return (
    <Box
      sx={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          '4px',
        fontFamily:   MONO,
        fontSize:     '10px',
        color:        flagColors.color,
        background:   flagColors.bg,
        border:       `1px solid ${flagColors.border}`,
        padding:      '3px 8px',
        borderRadius: '2px',
        lineHeight:   1.4,
      }}
    >
      {flag}
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

function normalizePickText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s.+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTeamAliases(team = {}) {
  const name = String(team?.name ?? '').trim();
  const abbreviation = String(team?.abbreviation ?? team?.team?.abbreviation ?? '').trim();
  const words = name.split(/\s+/).filter(Boolean);
  const nickname = words.length ? words[words.length - 1] : '';
  const city = words.length > 1 ? words.slice(0, -1).join(' ') : '';

  return [abbreviation, name, nickname, city]
    .map((entry) => normalizePickText(entry))
    .filter(Boolean);
}

function extractAmericanOddsFromText(text) {
  const match = String(text ?? '').match(/([+-]\d{3,4})/);
  return sanitizeOdds(match ? Number(match[1]) : null);
}

function pickContainsAny(text, aliases = []) {
  return aliases.some((alias) => alias && text.includes(alias));
}

function inferBankrollMarketType({ pick, bestPickType = null }) {
  const type = normalizePickText(bestPickType);
  const normalizedPick = normalizePickText(pick);

  if (type.includes('moneyline')) return 'moneyline';
  if (type.includes('runline')) return 'runline';
  if (type.includes('over-under') || type.includes('overunder') || type.includes('totals')) return 'overunder';
  if (type.includes('playerprop') || type.includes('prop')) return 'playerprop';

  if (/\bover\b|\bunder\b|\bmas\b|\bmenos\b/.test(normalizedPick)) {
    if (/\bhits?\b|\bstrikeouts?\b|\bhr\b|\bhome run\b|\btotal bases?\b|\brbi\b|\bsb\b/.test(normalizedPick)) {
      return 'playerprop';
    }
    return 'overunder';
  }

  if (normalizedPick.includes('run line') || normalizedPick.includes('linea')) return 'runline';
  if (normalizedPick.includes('moneyline') || normalizedPick.includes(' ml')) return 'moneyline';
  return 'moneyline';
}

function inferBankrollOdds({ pick, bestPickType, oddsData, gameData }) {
  const odds = oddsData?.odds ?? oddsData ?? {};
  const marketType = inferBankrollMarketType({ pick, bestPickType });
  const normalizedPick = normalizePickText(pick);
  const embeddedOdds = extractAmericanOddsFromText(pick);

  if (marketType === 'playerprop') return embeddedOdds;
  if (marketType === 'overunder') {
    const isUnder = /\bunder\b|\bmenos\b|\bbaja\b/.test(normalizedPick);
    return sanitizeOdds(isUnder ? odds?.overUnder?.underPrice : odds?.overUnder?.overPrice) ?? embeddedOdds;
  }

  const homeAliases = buildTeamAliases(gameData?.teams?.home);
  const awayAliases = buildTeamAliases(gameData?.teams?.away);
  const referencesHome = pickContainsAny(normalizedPick, homeAliases);
  const referencesAway = pickContainsAny(normalizedPick, awayAliases);

  if (marketType === 'runline') {
    if (referencesHome && !referencesAway) return sanitizeOdds(odds?.runLine?.home?.price) ?? embeddedOdds;
    if (referencesAway && !referencesHome) return sanitizeOdds(odds?.runLine?.away?.price) ?? embeddedOdds;
    return embeddedOdds;
  }

  if (marketType === 'moneyline') {
    if (referencesHome && !referencesAway) return sanitizeOdds(odds?.moneyline?.home) ?? embeddedOdds;
    if (referencesAway && !referencesHome) return sanitizeOdds(odds?.moneyline?.away) ?? embeddedOdds;
  }

  return embeddedOdds;
}

function getGameMatchupLabel(game) {
  if (!game) return '';
  const away = game.teams?.away?.abbreviation ?? game.teams?.away?.team?.abbreviation ?? 'AWAY';
  const home = game.teams?.home?.abbreviation ?? game.teams?.home?.team?.abbreviation ?? 'HOME';
  return `${away} @ ${home}`;
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
    <Box sx={{ bgcolor: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: '2px', p: '8px 6px', textAlign: 'center' }}>
      <Typography
        sx={{ fontFamily: MONO, fontSize: '9px', fontWeight: 700, color: C.textDim,
          textTransform: 'uppercase', letterSpacing: '1px', mb: '5px' }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700, color: C.textPrimary, mb: '2px' }}>
        H: {home}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700, color: C.textSecondary }}>
        A: {away}
      </Typography>
    </Box>
  );
}

// ── PayoutRow ─────────────────────────────────────────────────────────────────

function PayoutRow({ label, stake, profit, total }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '5px', mb: '5px' }}>
      <Typography sx={{ fontFamily: SANS, fontSize: '0.58rem', fontWeight: 700, color: C.textMuted, minWidth: '82px', flexShrink: 0 }}>
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
    <Box sx={{ mt: '8px', pt: '6px', borderTop: `1px solid ${C.border}60`, display: 'flex', alignItems: 'center', gap: '5px' }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, lineHeight: 1 }}>📊</Typography>
      <Typography sx={{ fontFamily: SANS, fontSize: '0.58rem', color: C.textMuted, flexShrink: 0 }}>
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
    <Box sx={{ bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: '2px', p: '16px' }}>
      {/* Header + format toggle */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '12px' }}>
        <SectionLabel>{t.odds.title}</SectionLabel>
        <Box
          component="button"
          onClick={toggleFmt}
          sx={{
            px: '9px', py: '3px',
            bgcolor: C.accentDim, border: `1px solid ${C.accentLine}`, borderRadius: '2px',
            fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, color: C.textSecondary, cursor: 'pointer',
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
      <Box sx={{ borderTop: `1px solid ${C.border}`, pt: '12px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '10px' }}>
          <Typography sx={{ fontFamily: SANS, fontSize: '0.6rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>
            {t.odds.betAmount}
          </Typography>
          <Box
            component="input"
            type="number"
            min="1"
            value={stake}
            onChange={e => setStake(e.target.value)}
            sx={{
              width: '72px', bgcolor: C.bg, border: `1px solid ${C.border}`,
              borderRadius: '2px', color: C.textPrimary, fontFamily: MONO,
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
    <Box sx={{ bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: '2px', p: '16px' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '12px' }}>
        <SectionLabel>{t.odds.parlayOdds}</SectionLabel>
        <Box
          component="button"
          onClick={toggleFmt}
          sx={{
            px: '9px', py: '3px',
            bgcolor: C.accentDim, border: `1px solid ${C.accentLine}`, borderRadius: '2px',
            fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, color: C.textSecondary, cursor: 'pointer',
          }}
        >
          {decimal ? 'US | ●DEC' : '●US | DEC'}
        </Box>
      </Box>

      {/* Combined odds display */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', mb: hasEstimated ? '6px' : '12px' }}>
        <Typography sx={{ fontFamily: SANS, fontSize: '0.62rem', color: C.textMuted, flexShrink: 0 }}>
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
        <Typography sx={{ fontFamily: SANS, fontSize: '0.6rem', color: C.textMuted, fontStyle: 'italic', opacity: 0.7, mb: '12px' }}>
          {t.odds.estimated}
        </Typography>
      )}

      {/* Calculator */}
      <Box sx={{ borderTop: `1px solid ${C.border}`, pt: '12px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '10px' }}>
          <Typography sx={{ fontFamily: SANS, fontSize: '0.6rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>
            {t.odds.betAmount}
          </Typography>
          <Box
            component="input"
            type="number"
            min="1"
            value={stake}
            onChange={e => setStake(e.target.value)}
            sx={{
              width: '72px', bgcolor: C.bg, border: `1px solid ${C.border}`,
              borderRadius: '2px', color: C.textPrimary, fontFamily: MONO,
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

function AgregarABanca({ matchup, pick, odds, confidence, lang = 'en' }) {
  const { isAuthenticated, token } = useAuth();
  const [open,            setOpen]            = useState(false);
  const [stake,           setStake]           = useState('');
  const [busy,            setBusy]            = useState(false);
  const [success,         setSuccess]         = useState(false);
  const [err,             setErr]             = useState('');
  const [kellySuggestion, setKellySuggestion] = useState(null);
  const normalizedOdds = sanitizeOdds(odds);
  const canRegister = Boolean(matchup && pick && normalizedOdds != null);
  const pickIncludesOdds = extractAmericanOddsFromText(pick) != null;
  const copy = lang === 'es'
    ? {
        add: '+ AGREGAR A BANCA',
        saved: 'Apuesta registrada en tu banca',
        invalidStake: 'Ingresa un monto valido',
        missingBetMeta: 'No se pudo registrar este pick porque faltan el partido o los momios.',
        missingBetMetaHint: 'Este pick todavia no tiene el partido o los momios detectados para registrarlo.',
        submitError: 'Error al registrar',
        matchup: 'PARTIDO',
        pick: 'PICK',
        stake: 'STAKE',
        cancel: 'Cancelar',
        submit: 'Registrar',
      }
    : {
        add: '+ ADD TO BANKROLL',
        saved: 'Bet saved to your bankroll',
        invalidStake: 'Enter a valid stake',
        missingBetMeta: 'This pick cannot be saved yet because matchup or odds are missing.',
        missingBetMetaHint: 'This pick still does not have a detected matchup or odds for bankroll tracking.',
        submitError: 'Error while saving',
        matchup: 'MATCHUP',
        pick: 'PICK',
        stake: 'STAKE',
        cancel: 'Cancel',
        submit: 'Save',
      };

  if (!isAuthenticated) return null;

  async function fetchKelly() {
    if (normalizedOdds == null || !confidence) return;
    try {
      const res  = await fetch(
        `${API_URL}/api/bankroll/kelly?odds=${normalizedOdds}&confidence=${confidence}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (json.success) setKellySuggestion(json.data.suggestedStake);
    } catch {}
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canRegister) { setErr(copy.missingBetMeta); return; }
    const s = Number(stake);
    if (!s || s <= 0) { setErr('Ingresa un monto válido'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`${API_URL}/api/bankroll/bet`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ matchup, pick, odds: normalizedOdds, stake: s, source: 'hexa' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? copy.submitError);
      setSuccess(true);
      setOpen(false);
      setStake('');
      setKellySuggestion(null);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      const message = String(e?.message ?? '');
      if (/matchup,\s*pick,\s*odds,\s*and stake are required/i.test(message)) {
        setErr(copy.missingBetMeta);
      } else if (/stake must be positive/i.test(message)) {
        setErr(copy.invalidStake);
      } else {
        setErr(message || copy.submitError);
      }
    } finally {
      setBusy(false);
    }
  }

  const inputSx = {
    background:   C.bg,
    border:       `1px solid ${C.border}`,
    borderRadius: '2px',
    color:        C.textPrimary,
    fontFamily:   MONO,
    fontSize:     '0.82rem',
    padding:      '6px 10px',
    outline:      'none',
    colorScheme:  'dark',
    width:        '90px',
  };

  return (
    <Box sx={{ mt: '12px' }}>
      {success ? (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', px: '12px', py: '6px', bgcolor: C.greenDim, border: `1px solid ${C.greenLine}`, borderRadius: '2px' }}>
          <Typography sx={{ fontFamily: SANS, fontSize: '0.72rem', fontWeight: 700, color: C.green }}>
            ✓ Apuesta registrada en tu banca
          </Typography>
        </Box>
      ) : !open ? (
        <>
        <Box
          component="button"
          disabled={!canRegister}
          onClick={() => {
            if (!canRegister) return;
            setOpen(true);
            fetchKelly();
          }}
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            px: '12px', py: '5px',
            bgcolor: canRegister ? C.surfaceAlt : C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: '3px',
            color: canRegister ? C.accent : C.textDim,
            fontFamily: BARLOW,
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '2px',
            cursor: canRegister ? 'pointer' : 'not-allowed',
            opacity: canRegister ? 1 : 0.55,
            transition: 'all 0.15s',
            '&:hover': canRegister ? { bgcolor: C.accentDim, borderColor: C.accentLine } : {},
          }}
        >
          {copy.add}
        </Box>
        {!canRegister && (
          <Typography sx={{ fontFamily: SANS, fontSize: '0.68rem', color: C.textMuted, mt: '6px' }}>
            {copy.missingBetMetaHint}
          </Typography>
        )}
        </>
      ) : (
        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
            bgcolor: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: '3px',
            p: '10px 12px',
          }}
        >
          <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: C.textMuted, flexShrink: 0 }}>
            {copy.stake}:
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
          {matchup && (
            <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: C.textMuted, width: '100%' }}>
              {copy.matchup}: <span style={{ color: C.textSecondary }}>{matchup}</span>
            </Typography>
          )}
          <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: C.textDim, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            {copy.pick}: <span style={{ color: C.textSecondary, marginLeft: '4px' }}>{pick}</span>
            {kellySuggestion && (
              <Box
                component="span"
                onClick={() => setStake(String(kellySuggestion))}
                sx={{
                  ml: '8px', px: '6px', py: '2px',
                  borderRadius: '2px',
                  border: `1px solid ${C.greenLine}`,
                  background: C.greenDim,
                  color: C.green,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  userSelect: 'none',
                  '&:hover': { background: C.greenDim },
                }}
              >
                Kelly: ${kellySuggestion}
              </Box>
            )}
          </Typography>
          {!pickIncludesOdds && normalizedOdds != null && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textMuted, flexShrink: 0 }}>
              {fmtAmericanOdds(normalizedOdds)}
            </Typography>
          )}
          {err && <Typography sx={{ fontFamily: SANS, fontSize: '0.65rem', color: C.red, width: '100%' }}>{err}</Typography>}
          <Box sx={{ display: 'flex', gap: '6px', ml: 'auto', flexShrink: 0 }}>
            <Box
              component="button"
              type="button"
              onClick={() => { setOpen(false); setErr(''); setStake(''); }}
              sx={{ px: '10px', py: '4px', bgcolor: 'transparent', border: `1px solid ${C.border}`, borderRadius: '2px', color: C.textMuted, fontFamily: MONO, fontSize: '0.68rem', cursor: 'pointer' }}
            >
              {copy.cancel}
            </Box>
            <Box
              component="button"
              type="submit"
              disabled={busy}
              sx={{ px: '12px', py: '4px', bgcolor: C.accent, border: 'none', borderRadius: '2px', color: '#fff', fontFamily: BARLOW, fontSize: '0.68rem', fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* AWAY — Cyan neon bar */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '5px' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: C.cyan, letterSpacing: '3px', textTransform: 'uppercase' }}>
            {t.away}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: C.cyan, textShadow: `0 0 6px ${C.cyan}` }}>
            {awayPct}%
          </Typography>
        </Box>
        <Box sx={{
          position: 'relative', height: '5px',
          background: 'rgba(0,217,255,0.07)',
          border: '1px solid rgba(0,217,255,0.12)',
        }}>
          <Box sx={{
            position: 'absolute', left: 0, top: 0, height: '100%',
            width: `${awayPct}%`,
            background: `linear-gradient(90deg, ${C.cyan}, rgba(0,217,255,0.5))`,
            boxShadow: '0 0 8px rgba(0,217,255,0.7), 0 0 18px rgba(0,217,255,0.25)',
            transition: 'width 0.9s ease',
          }} />
        </Box>
      </Box>

      {/* HOME — Orange neon bar */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '5px' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: C.accent, letterSpacing: '3px', textTransform: 'uppercase' }}>
            {t.home}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: C.accent, textShadow: `0 0 6px ${C.accent}` }}>
            {homePct}%
          </Typography>
        </Box>
        <Box sx={{
          position: 'relative', height: '5px',
          background: 'rgba(255,102,0,0.07)',
          border: '1px solid rgba(255,102,0,0.12)',
        }}>
          <Box sx={{
            position: 'absolute', left: 0, top: 0, height: '100%',
            width: `${homePct}%`,
            background: `linear-gradient(90deg, ${C.accent}, rgba(255,102,0,0.5))`,
            boxShadow: '0 0 8px rgba(255,102,0,0.7), 0 0 18px rgba(255,102,0,0.25)',
            transition: 'width 0.9s ease',
          }} />
        </Box>
      </Box>

    </Box>
  );
}

// ── Safe Pick Result ──────────────────────────────────────────────────────────

function SafePickResult({ data, lang, t }) {
  const sp          = data.safe_pick ?? {};
  const alts        = data.alternatives ?? [];
  const candidates  = data.safe_candidates ?? [sp, ...alts].filter(Boolean);
  const hitProb     = Number(sp.hit_probability) || 0;
  const probColor   = hitProb >= 75 ? C.green : hitProb >= 55 ? C.amber : C.red;
  const circumference = 125.6;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── SAFE PICK SHIELD HEADER ── */}
      <Box sx={{
        background:   C.greenDim,
        border:       `1px solid ${C.greenLine}`,
        borderRadius: '0',
        p:            '20px',
        position:     'relative',
        boxShadow:    `inset 0 0 40px rgba(0,0,0,0.8), 0 0 2px rgba(0,255,136,0.15)`,
        '&::before': {
          content: '""', position: 'absolute', top: 0, left: 0,
          width: '14px', height: '14px',
          borderTop: `2px solid ${C.green}`, borderLeft: `2px solid ${C.green}`,
        },
        '&::after': {
          content: '""', position: 'absolute', bottom: 0, right: 0,
          width: '14px', height: '14px',
          borderBottom: `2px solid ${C.green}`, borderRight: `2px solid ${C.green}`,
        },
      }}>
        {/* Shield icon + label */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: '16px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Animated neon green shield */}
            <Box
              sx={{
                flexShrink: 0,
                '@keyframes shieldPulse': {
                  '0%, 100%': {
                    filter:    'drop-shadow(0 0 4px rgba(0,255,136,0.6))',
                    transform: 'scale(1)',
                  },
                  '50%': {
                    filter:    'drop-shadow(0 0 14px rgba(0,255,136,1)) drop-shadow(0 0 28px rgba(0,255,136,0.35))',
                    transform: 'scale(1.06)',
                  },
                },
                animation: 'shieldPulse 2s ease-in-out infinite',
              }}
            >
              <svg width="34" height="40" viewBox="0 0 34 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M17 2L3 8.5V21C3 29.5 9.5 37.5 17 39C24.5 37.5 31 29.5 31 21V8.5L17 2Z"
                  stroke="#00FF88"
                  strokeWidth="1.5"
                  fill="rgba(0,255,136,0.08)"
                />
                <path
                  d="M11 20.5L15 24.5L23 16.5"
                  stroke="#00FF88"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Box>
            <Box>
              <Typography sx={{
                fontFamily:    MONO,
                fontSize:      '9px',
                letterSpacing: '3px',
                color:         C.green,
                textTransform: 'uppercase',
                textShadow:    `0 0 8px rgba(0,255,136,0.6)`,
              }}>
                {t.safePick ?? 'SAFE PICK'}
              </Typography>
              <Typography sx={{
                fontFamily:    MONO,
                fontSize:      '7px',
                color:         C.textMuted,
                letterSpacing: '2px',
                textTransform: 'uppercase',
                mt:            '2px',
              }}>
                // ESCANEO_INTRAGAME ACTIVO
              </Typography>
            </Box>
          </Box>

          {/* Bet type badge */}
          <Typography sx={{
            fontFamily:    MONO,
            fontSize:      '8px',
            letterSpacing: '1px',
            color:         probColor,
            background:    `${probColor}18`,
            border:        `1px solid ${probColor}40`,
            padding:       '3px 10px',
            borderRadius:  '0',
            textTransform: 'uppercase',
            textShadow:    `0 0 6px ${probColor}`,
          }}>
            {sp.type ?? 'ML'}
          </Typography>
        </Box>

        {/* THE PICK — Orbitron large */}
        <Typography sx={{
          fontFamily:    BARLOW,
          fontWeight:    700,
          fontSize:      '26px',
          color:         '#ffffff',
          letterSpacing: '2px',
          lineHeight:    1.1,
          mb:            '16px',
          textShadow:    `0 0 16px rgba(0,255,136,0.25)`,
        }}>
          {sp.pick ?? '—'}
        </Typography>

        {/* HIT PROBABILITY ring + reasoning */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Box sx={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}>
            <svg viewBox="0 0 52 52" style={{ transform: 'rotate(-90deg)', width: 52, height: 52 }}>
              <circle cx="26" cy="26" r="22" fill="none" stroke="rgba(0,255,136,0.08)" strokeWidth="3"/>
              <circle
                cx="26" cy="26" r="22" fill="none"
                stroke={probColor} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference - (circumference * hitProb / 100)}
                style={{ filter: `drop-shadow(0 0 4px ${probColor})` }}
              />
            </svg>
            <Box sx={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: MONO, fontSize: '11px', color: probColor,
              textShadow: `0 0 6px ${probColor}`,
            }}>
              {hitProb}%
            </Box>
          </Box>
          <Box>
            <Typography sx={{ fontFamily: MONO, fontSize: '7px', color: C.textMuted, letterSpacing: '2px', textTransform: 'uppercase', mb: '4px' }}>
              {t.hitProbability ?? 'HIT PROBABILITY'}
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: C.textSecondary, lineHeight: 1.6 }}>
              {sp.reasoning ?? ''}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ mt: '14px' }}>
          <ValueBreakdownPanel
            breakdown={{
              model_probability: sp.model_probability ?? sp.hit_probability ?? null,
              implied_probability: sp.implied_probability ?? null,
              edge: sp.edge ?? null,
              value_tier: sp.edge != null
                ? (Number(sp.edge) > 5 ? 'PLUS EV' : Number(sp.edge) > 0 ? 'SMALL EDGE' : 'SAFE ONLY')
                : 'SAFE ONLY',
              odds: sp.odds ?? null,
            }}
            t={t}
          />
        </Box>
      </Box>

      {/* ── ALTERNATIVES ── */}
      {data.safe_scope && (
        <Box sx={{ borderLeft: `2px solid ${C.greenLine}`, pl: '12px', py: '4px' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: C.textSecondary, lineHeight: 1.7 }}>
            <span style={{ color: C.green }}>{t.selectionScope ?? 'Selection Scope'}:</span> {data.safe_scope}
          </Typography>
        </Box>
      )}

      {candidates.length > 1 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <SectionLabel>{t.topCandidates ?? 'Top Candidates'}</SectionLabel>
          {candidates.slice(1, 4).map((alt, i) => (
            <Box key={i} sx={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: '0',
              p: '10px 12px',
              gap: '12px',
            }}>
              <Box sx={{ flex: 1, minWidth: 0, mr: '12px' }}>
                <Typography sx={{ fontFamily: BARLOW, fontWeight: 700, fontSize: '14px', color: C.textPrimary, letterSpacing: '1px' }}>
                  #{alt.rank ?? i + 2} {alt.pick}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: C.textMuted, mt: '3px', lineHeight: 1.5 }}>
                  {alt.reasoning}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', mt: '8px' }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.cyan }}>
                    {t.modelProb ?? 'Model Prob'} {fmtPct(alt.model_probability ?? alt.hit_probability)}
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.amber }}>
                    {t.impliedProb ?? 'Vegas Implied'} {fmtPct(alt.implied_probability)}
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: Number(alt.edge) > 0 ? C.green : C.textMuted }}>
                    {t.edge ?? 'Edge'} {Number.isFinite(Number(alt.edge)) ? `${Number(alt.edge) > 0 ? '+' : ''}${Number(alt.edge).toFixed(1)}%` : '—'}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '13px', color: C.amber, textShadow: `0 0 6px ${C.amber}` }}>
                  {alt.hit_probability}%
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: C.textMuted }}>
                  {fmtAmericanOdds(alt.odds)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* ── GAME OVERVIEW ── */}
      {data.game_overview && (
        <Box sx={{ borderLeft: `2px solid ${C.cyanLine}`, pl: '12px', py: '4px' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: C.textSecondary, lineHeight: 1.7 }}>
            {data.game_overview}
          </Typography>
        </Box>
      )}

      {/* ── ALERT FLAGS ── */}
      {data.alert_flags?.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {data.alert_flags.map((flag, i) => {
            const fc = getFlagColor(flag);
            return (
              <Typography key={i} sx={{
                fontFamily: MONO, fontSize: '10px', color: fc.color,
                background: fc.bg, border: `1px solid ${fc.border}`,
                padding: '3px 8px', borderRadius: '0', letterSpacing: '0.04em',
              }}>
                {flag}
              </Typography>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function SingleGameResult({ hexa, t, lang = 'en', selectedGame = null }) {
  const mp         = hexa.master_prediction ?? {};
  const bp         = hexa.best_pick;
  const valueBreakdown = hexa.value_breakdown ?? null;
  const confidence = Math.min(100, Math.max(0, Number(mp.oracle_confidence) || 0));
  const pickText   = mp.pick ?? bp?.detail ?? '';
  const bankrollMatchup = String(hexa.matchup ?? hexa.odds?.game ?? getGameMatchupLabel(selectedGame) ?? '').trim();
  const bankrollOdds = sanitizeOdds(valueBreakdown?.odds)
    ?? inferBankrollOdds({ pick: pickText, bestPickType: bp?.type, oddsData: hexa.odds, gameData: selectedGame });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <EngineMetaCard meta={hexa.engine_meta} lang={lang} />
      <DecisionCenter
        hexa={hexa}
        lang={lang}
        slots={{
          bankroll: (
            <AgregarABanca
              matchup={bankrollMatchup}
              pick={pickText}
              odds={bankrollOdds}
              confidence={confidence}
              lang={lang}
            />
          ),
          oddsPanel: hexa.odds?.odds ? <OddsPanel odds={hexa.odds.odds} hexa={hexa} t={t} /> : null,
          disclaimers: <Disclaimers t={t} />,
        }}
      />
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
          background:   C.bg,
          border:       `1px solid ${C.border}`,
          borderRadius: '4px',
          p:            '20px',
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '14px' }}>
          <Typography
            sx={{
              fontFamily:    MONO,
              fontSize:      '10px',
              fontWeight:    700,
              color:         C.accent,
              textTransform: 'uppercase',
              letterSpacing: '2px',
            }}
          >
            {t.combinedConf}
          </Typography>
          {p.risk_level && <RiskBadge risk={p.risk_level} t={t} />}
        </Box>
        <Box
          sx={{
            display:      'flex',
            alignItems:   'center',
            gap:          '10px',
            bgcolor:      C.surfaceAlt,
            border:       `1px solid ${C.border}`,
            borderRadius: '3px',
            px:           '12px',
            py:           '8px',
          }}
        >
          <ConfidenceBar value={confPct} />
          <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', fontWeight: 700, color: confColor }}>
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
              bgcolor:      C.surface,
              border:       `1px solid ${C.border}`,
              borderLeft:   `3px solid ${C.accent}`,
              borderRadius: '0 4px 4px 0',
              p:            '14px 16px',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '6px' }}>
              <Typography
                sx={{
                  fontFamily: MONO,
                  fontSize:   '10px',
                  color:      C.textDim,
                  letterSpacing: '1px',
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
                  fontFamily: SANS,
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
              fontFamily: SANS,
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
        bgcolor: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: '4px',
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
            fontFamily: SANS,
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
            background:   C.bg,
            border:       `1px solid ${C.border}`,
            borderRadius: '4px',
            p:            '20px',
          }}
        >
          <Typography
            sx={{
              fontFamily:    MONO,
              fontSize:      '10px',
              fontWeight:    700,
              color:         C.accent,
              textTransform: 'uppercase',
              letterSpacing: '2px',
              mb: '10px',
            }}
          >
            {t.daySummary}
          </Typography>
          <Typography
            sx={{
              fontFamily: SANS,
              fontSize: '13px',
              color: C.textSecondary,
              lineHeight: 1.8,
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

export default function ResultCard({ data, lang = 'en', selectedGames = [] }) {
  const t = L[lang] ?? L.en;

  if (!data) {
    return (
      <Typography sx={{ fontFamily: SANS, fontSize: '0.82rem', color: C.textMuted }}>
        {t.noData}
      </Typography>
    );
  }

  // ── Safe Pick Multi-Game (parlay safe mode) ────────────────────────────────
  if (data?.mode === 'safe_multi' && data?.results) {
    return (
      <Box>
        {/* Summary header */}
        <Box sx={{
          mb: '16px', p: '14px',
          bgcolor: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: '2px',
        }}>
          <Typography sx={{
            fontFamily: MONO, fontSize: '8px', color: C.accent,
            textTransform: 'uppercase', letterSpacing: '3px', mb: '4px',
          }}>
            [ SAFE_PICK_SCAN // {data.summary?.analyzed ?? data.results.length} {lang === 'es' ? 'PARTIDOS' : 'GAMES'} ]
          </Typography>
          <Typography sx={{
            fontFamily: SANS, fontSize: '0.75rem', color: C.textSecondary,
          }}>
            {lang === 'es'
              ? `${data.summary?.analyzed ?? data.results.length} partidos analizados — 1 pick seguro por partido`
              : `${data.summary?.analyzed ?? data.results.length} games analyzed — 1 safe pick per game`}
          </Typography>
        </Box>

        {/* Individual safe pick cards */}
        {data.results.map((r, i) => {
          if (r.error) {
            return (
              <Box key={i} sx={{
                mb: '12px', p: '14px', bgcolor: C.surface,
                border: '1px solid rgba(255,34,68,0.3)', borderRadius: '2px',
              }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', fontWeight: 700, color: C.textPrimary }}>
                  {r.matchup ?? `Game ${i + 1}`}
                </Typography>
                <Typography sx={{ fontFamily: SANS, fontSize: '0.75rem', color: '#FF2244', mt: '4px' }}>
                  Error: {r.error}
                </Typography>
              </Box>
            );
          }

          const sp = r.data?.safe_pick;
          if (!sp) return null;

          const conf = Math.min(100, Math.max(0, Number(sp.hit_probability) || 0));
          const confColor = conf >= 62 ? C.green : conf >= 55 ? C.amber : C.red;
          const alerts = r.data?.alert_flags ?? [];
          const alts = r.data?.alternatives ?? [];

          return (
            <Box key={i} sx={{
              mb: '12px', bgcolor: C.surface,
              border: `1px solid ${C.border}`, borderRadius: '2px',
              overflow: 'hidden',
            }}>
              {/* Matchup header */}
              <Box sx={{
                p: '12px 14px',
                borderBottom: `1px solid ${C.border}`,
                bgcolor: C.surfaceAlt,
              }}>
                <Typography sx={{
                  fontFamily: MONO, fontSize: '0.85rem', fontWeight: 700, color: C.textPrimary,
                }}>
                  {r.matchup}
                </Typography>
                {r.data?.game_overview && (
                  <Typography sx={{
                    fontFamily: SANS, fontSize: '0.7rem', color: C.textMuted, mt: '4px', lineHeight: 1.5,
                  }}>
                    {r.data.game_overview}
                  </Typography>
                )}
              </Box>

              <Box sx={{ p: '14px' }}>
                {/* Main pick */}
                <Box sx={{
                  bgcolor: C.accentDim, border: `1px solid ${C.accentLine}`,
                  borderRadius: '2px', p: '10px 12px', mb: '10px',
                }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                      <Typography sx={{
                        fontFamily: MONO, fontSize: '0.55rem', color: C.accent,
                        textTransform: 'uppercase', letterSpacing: '2px', mb: '4px',
                      }}>
                        SAFE PICK
                      </Typography>
                      <Typography sx={{
                        fontFamily: MONO, fontSize: '0.9rem', fontWeight: 700, color: C.accent,
                      }}>
                        {sp.pick}
                      </Typography>
                      <Typography sx={{
                        fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, mt: '2px',
                      }}>
                        {sp.type}
                      </Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography sx={{
                        fontFamily: MONO, fontSize: '1.1rem', fontWeight: 700, color: confColor,
                      }}>
                        {conf}%
                      </Typography>
                      <Typography sx={{
                        fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted,
                        textTransform: 'uppercase', letterSpacing: '1px',
                      }}>
                        {lang === 'es' ? 'PROBABILIDAD' : 'HIT PROB'}
                      </Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Confidence bar */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '10px' }}>
                  <Box sx={{ flex: 1, height: '4px', bgcolor: C.border, borderRadius: '2px', overflow: 'hidden' }}>
                    <Box sx={{ width: `${conf}%`, height: '100%', bgcolor: confColor, borderRadius: '2px', transition: 'width 0.5s ease' }} />
                  </Box>
                </Box>

                {/* Reasoning */}
                {sp.reasoning && (
                  <Typography sx={{
                    fontFamily: SANS, fontSize: '0.75rem', color: C.textSecondary,
                    lineHeight: 1.7, mb: '10px',
                  }}>
                    {sp.reasoning}
                  </Typography>
                )}

                {/* Alternatives */}
                {alts.length > 0 && (
                  <Box sx={{ mt: '8px', pt: '8px', borderTop: `1px solid ${C.border}` }}>
                    <Typography sx={{
                      fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted,
                      textTransform: 'uppercase', letterSpacing: '2px', mb: '6px',
                    }}>
                      {lang === 'es' ? 'OTRAS OPCIONES SEGURAS' : 'OTHER SAFE OPTIONS'}
                    </Typography>
                    {alts.map((alt, j) => (
                      <Box key={j} sx={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        py: '4px',
                      }}>
                        <Typography sx={{ fontFamily: SANS, fontSize: '0.72rem', color: C.textSecondary }}>
                          {alt.pick} ({alt.type})
                        </Typography>
                        <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', fontWeight: 700, color: C.textMuted }}>
                          {alt.hit_probability}%
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}

                {/* Alert flags */}
                {alerts.length > 0 && (
                  <Box sx={{ mt: '8px', pt: '8px', borderTop: `1px solid ${C.border}` }}>
                    <Typography sx={{
                      fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted,
                      textTransform: 'uppercase', letterSpacing: '2px', mb: '4px',
                    }}>
                      ALERTS
                    </Typography>
                    {alerts.map((flag, j) => (
                      <Typography key={j} sx={{
                        fontFamily: SANS, fontSize: '0.65rem', color: C.textMuted, mb: '2px',
                      }}>
                        • {flag}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  }

  // Safe Pick
  if (data.safe_pick) {
    return <SafePickResult data={data} lang={lang} t={t} />;
  }

  // Single game
  if (data.master_prediction || data.best_pick || data.oracle_report) {
    return <SingleGameResult hexa={data} t={t} lang={lang} selectedGame={selectedGames[0] ?? null} />;
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
        bgcolor: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: '4px',
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
