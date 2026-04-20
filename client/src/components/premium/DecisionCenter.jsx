/**
 * DecisionCenter — 3-band premium layout for a single-game analysis result.
 *
 * Replaces the flat scroll of panels in SingleGameResult with a focused
 * structure: one dominant VERDICT, categorized WHY tabs, and an ALTERNATIVES
 * rail. External concerns (bankroll form, market odds calculator, disclaimers)
 * stay in the parent and render through named slots so legacy behavior is
 * preserved.
 *
 * Props:
 *   hexa  — parsed HEXA JSON for a single game (data.data)
 *   lang  — 'en' | 'es'
 *   slots — { bankroll?, oddsPanel?, disclaimers? } render-in-place nodes
 */

import { useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { useHexaTheme } from '../../themeProvider';
import {
  fadeUp,
  fade,
  staggerContainer,
  usePrefersReducedMotion,
  reducedVariant,
} from '../../motion';
import HeroCard from './HeroCard';
import EdgeBar from './EdgeBar';
import DataChip from './DataChip';

// ── i18n ─────────────────────────────────────────────────────────────────────
const L = {
  en: {
    verdict:      'VERDICT · TODAY',
    headline:     'HEADLINE',
    report:       'REPORT',
    flags:        'FLAGS',
    value:        'VALUE',
    alternatives: 'ALTERNATIVES',
    confidence:   'CONFIDENCE',
    risk:         'RISK',
    edge:         'EDGE',
    tier:         'TIER',
    modelProb:    'MODEL',
    impliedProb:  'IMPLIED',
    hunch:        'HEXA HUNCH',
    kelly:        'KELLY',
    winProb:      'WIN PROBABILITY',
    home:         'HOME',
    away:         'AWAY',
    bestPick:     'BEST PICK',
    altHint:      'Other angles on this matchup',
    noReport:     'No detailed report.',
    noFlags:      'No warnings flagged.',
  },
  es: {
    verdict:      'VEREDICTO · HOY',
    headline:     'TITULAR',
    report:       'REPORTE',
    flags:        'ALERTAS',
    value:        'VALOR',
    alternatives: 'ALTERNATIVAS',
    confidence:   'CONFIANZA',
    risk:         'RIESGO',
    edge:         'EDGE',
    tier:         'NIVEL',
    modelProb:    'MODELO',
    impliedProb:  'IMPLICITA',
    hunch:        'CORAZONADA HEXA',
    kelly:        'KELLY',
    winProb:      'PROBABILIDAD DE VICTORIA',
    home:         'LOCAL',
    away:         'VISIT',
    bestPick:     'MEJOR PICK',
    altHint:      'Otros ángulos de este juego',
    noReport:     'Sin reporte detallado.',
    noFlags:      'Sin alertas.',
  },
};

const RISK_LABEL = {
  en: { low: 'LOW', medium: 'MED', high: 'HIGH' },
  es: { low: 'BAJO', medium: 'MED', high: 'ALTO' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function toIntent(confidence, risk) {
  const r = String(risk || '').toLowerCase();
  if (r === 'high') return 'warn';
  if (confidence >= 75) return 'success';
  if (confidence >= 50) return 'action';
  if (confidence > 0)  return 'warn';
  return 'data';
}

function fmtPct(n, digits = 0) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return `${num.toFixed(digits)}%`;
}

function fmtEdge(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return `${num > 0 ? '+' : ''}${num.toFixed(1)}%`;
}

// ── WHY tabs ─────────────────────────────────────────────────────────────────

function WhyTabs({ hexa, lang, t }) {
  const { C, MONO, SCALE, SPACE, INTENT } = useHexaTheme();
  const mp = hexa.master_prediction ?? {};
  const vb = hexa.value_breakdown;
  const pm = hexa.probability_model;
  const flags = Array.isArray(hexa.alert_flags) ? hexa.alert_flags : [];

  const tabs = useMemo(() => {
    const list = [];
    if (mp.bet_value || mp.reasoning || hexa.hexa_hunch) {
      list.push({ key: 'headline', label: t.headline });
    }
    if (hexa.oracle_report) {
      list.push({ key: 'report', label: t.report });
    }
    if (flags.length > 0) {
      list.push({ key: 'flags', label: t.flags, badge: flags.length });
    }
    if (vb || pm || hexa.kelly_recommendation) {
      list.push({ key: 'value', label: t.value });
    }
    return list;
  }, [hexa, flags.length, t]);

  const [active, setActive] = useState(tabs[0]?.key);

  if (tabs.length === 0) return null;
  const current = active && tabs.some((x) => x.key === active) ? active : tabs[0].key;

  return (
    <Box>
      {/* Tab bar */}
      <Box
        sx={{
          display:       'flex',
          gap:           SPACE.xs,
          overflowX:     'auto',
          pb:            SPACE.xs,
          mb:            SPACE.md,
          borderBottom:  `1px solid ${C.border}`,
          '&::-webkit-scrollbar': { display: 'none' },
          scrollbarWidth: 'none',
        }}
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === current;
          const tone = isActive ? INTENT.action : INTENT.data;
          return (
            <Box
              key={tab.key}
              component="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.key)}
              sx={{
                position:      'relative',
                flexShrink:    0,
                px:            SPACE.md,
                py:            '10px',
                bgcolor:       'transparent',
                border:        'none',
                borderBottom:  `2px solid ${isActive ? tone.base : 'transparent'}`,
                color:         isActive ? tone.base : C.textSecondary,
                fontFamily:    MONO,
                fontSize:      SCALE.label,
                fontWeight:    700,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                cursor:        'pointer',
                transition:    'color 0.15s ease, border-color 0.15s ease',
                textShadow:    isActive ? tone.glow : 'none',
                display:       'inline-flex',
                alignItems:    'center',
                gap:           SPACE.xs,
                '&:hover':     { color: tone.base },
              }}
            >
              {tab.label}
              {tab.badge != null && (
                <Box
                  component="span"
                  sx={{
                    minWidth:      18,
                    height:        18,
                    px:            '5px',
                    display:       'inline-flex',
                    alignItems:    'center',
                    justifyContent:'center',
                    fontFamily:    MONO,
                    fontSize:      '10px',
                    fontWeight:    700,
                    color:         '#000',
                    bgcolor:       tone.base,
                    borderRadius:  '2px',
                    lineHeight:    1,
                  }}
                >
                  {tab.badge}
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current}
          variants={fade}
          initial="hidden"
          animate="visible"
          exit="hidden"
        >
          {current === 'headline' && <HeadlinePanel hexa={hexa} t={t} />}
          {current === 'report'   && <ReportPanel hexa={hexa} t={t} />}
          {current === 'flags'    && <FlagsPanel flags={flags} t={t} />}
          {current === 'value'    && <ValuePanel hexa={hexa} lang={lang} t={t} />}
        </motion.div>
      </AnimatePresence>
    </Box>
  );
}

function HeadlinePanel({ hexa, t }) {
  const { C, MONO, SANS, DISPLAY, SCALE, SPACE, INTENT } = useHexaTheme();
  const mp = hexa.master_prediction ?? {};
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
      {mp.bet_value && (
        <Box
          sx={{
            px:         SPACE.md,
            py:         SPACE.sm,
            bgcolor:    INTENT.action.dim,
            borderLeft: `3px solid ${INTENT.action.base}`,
          }}
        >
          <Typography
            sx={{
              fontFamily:    DISPLAY,
              fontSize:      SCALE.title,
              fontWeight:    700,
              color:         INTENT.action.base,
              letterSpacing: '0.06em',
              textShadow:    INTENT.action.glow,
              lineHeight:    1.2,
            }}
          >
            {mp.bet_value}
          </Typography>
        </Box>
      )}
      {mp.reasoning && (
        <Typography
          sx={{
            fontFamily: SANS,
            fontSize:   SCALE.body,
            color:      C.textSecondary,
            lineHeight: 1.7,
          }}
        >
          {mp.reasoning}
        </Typography>
      )}
      {hexa.hexa_hunch && (
        <Box
          sx={{
            borderLeft: `2px solid ${INTENT.data.line}`,
            bgcolor:    INTENT.data.dim,
            px:         SPACE.md,
            py:         SPACE.sm,
          }}
        >
          <Typography
            sx={{
              fontFamily:    MONO,
              fontSize:      SCALE.micro,
              color:         INTENT.data.base,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              mb:            SPACE.xs,
              textShadow:    INTENT.data.glow,
            }}
          >
            ⬡ {t.hunch}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: SCALE.label, color: C.textPrimary, lineHeight: 1.6 }}>
            {hexa.hexa_hunch}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function ReportPanel({ hexa, t }) {
  const { C, SANS, SCALE, SPACE } = useHexaTheme();
  if (!hexa.oracle_report) {
    return (
      <Typography sx={{ fontFamily: SANS, fontSize: SCALE.label, color: C.textMuted }}>
        {t.noReport}
      </Typography>
    );
  }
  return (
    <Box sx={{ px: SPACE.md, py: SPACE.md, bgcolor: C.surfaceAlt, border: `1px solid ${C.border}` }}>
      <Typography
        sx={{
          fontFamily: SANS,
          fontSize:   SCALE.body,
          color:      C.textSecondary,
          lineHeight: 1.75,
          whiteSpace: 'pre-wrap',
        }}
      >
        {hexa.oracle_report}
      </Typography>
    </Box>
  );
}

function FlagsPanel({ flags, t }) {
  const { C, MONO, SCALE, SPACE } = useHexaTheme();
  if (flags.length === 0) {
    return (
      <Typography sx={{ fontFamily: MONO, fontSize: SCALE.label, color: C.textMuted }}>
        {t.noFlags}
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
      {flags.map((flag, i) => (
        <Box
          key={i}
          sx={{
            display:    'flex',
            alignItems: 'flex-start',
            gap:        SPACE.sm,
            px:         SPACE.md,
            py:         SPACE.sm,
            bgcolor:    'rgba(255,102,0,0.06)',
            borderLeft: `2px solid rgba(255,102,0,0.5)`,
          }}
        >
          <Box
            component="span"
            sx={{
              fontFamily: MONO,
              fontSize:   SCALE.micro,
              color:      '#ff9d4d',
              letterSpacing: '0.1em',
              flexShrink: 0,
              mt:         '2px',
            }}
          >
            ⚠
          </Box>
          <Typography sx={{ fontFamily: MONO, fontSize: SCALE.label, color: C.textPrimary, lineHeight: 1.5 }}>
            {flag}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function ValuePanel({ hexa, lang, t }) {
  const { C, MONO, SCALE, SPACE, INTENT } = useHexaTheme();
  const vb = hexa.value_breakdown;
  const pm = hexa.probability_model;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
      {vb && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
          {vb.model_probability != null && (
            <DataChip label={t.modelProb} value={fmtPct(vb.model_probability, 1)} intent="data" />
          )}
          {vb.implied_probability != null && (
            <DataChip label={t.impliedProb} value={fmtPct(vb.implied_probability, 1)} intent="warn" />
          )}
          {vb.edge != null && (
            <DataChip
              label={t.edge}
              value={fmtEdge(vb.edge)}
              intent={Number(vb.edge) > 0 ? 'success' : 'warn'}
            />
          )}
          {vb.value_tier && (
            <DataChip label={t.tier} value={vb.value_tier} intent="action" />
          )}
        </Box>
      )}

      {pm && (pm.home_wins != null || pm.away_wins != null) && (
        <Box>
          <Typography
            sx={{
              fontFamily:    MONO,
              fontSize:      SCALE.micro,
              color:         C.textMuted,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              mb:            SPACE.xs,
            }}
          >
            {t.winProb}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: '2px' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: INTENT.data.base, letterSpacing: '0.12em' }}>
                  {t.away}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: SCALE.label, color: INTENT.data.base, fontWeight: 700 }}>
                  {fmtPct((Number(pm.away_wins) || 0) / 100, 0)}
                </Typography>
              </Box>
              <EdgeBar percent={(Number(pm.away_wins) || 0) / 100} intent="data" showValue={false} />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: '2px' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: INTENT.action.base, letterSpacing: '0.12em' }}>
                  {t.home}
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: SCALE.label, color: INTENT.action.base, fontWeight: 700 }}>
                  {fmtPct((Number(pm.home_wins) || 0) / 100, 0)}
                </Typography>
              </Box>
              <EdgeBar percent={(Number(pm.home_wins) || 0) / 100} intent="action" showValue={false} />
            </Box>
          </Box>
        </Box>
      )}

      {hexa.kelly_recommendation && (
        <Box
          sx={{
            bgcolor:    INTENT.action.dim,
            borderLeft: `3px solid ${INTENT.action.base}`,
            px:         SPACE.md,
            py:         SPACE.sm,
          }}
        >
          <Typography
            sx={{
              fontFamily:    MONO,
              fontSize:      SCALE.micro,
              color:         INTENT.action.base,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              mb:            SPACE.xs,
              textShadow:    INTENT.action.glow,
            }}
          >
            [ {t.kelly} ]
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: SCALE.label, color: C.textPrimary, lineHeight: 1.6 }}>
            {hexa.kelly_recommendation}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// ── Alternatives rail ────────────────────────────────────────────────────────

function AlternativesRail({ hexa, t }) {
  const { C, MONO, SCALE, SPACE } = useHexaTheme();
  const bp = hexa.best_pick;
  const alts = Array.isArray(hexa.alternatives) ? hexa.alternatives : [];

  const items = [];
  if (bp?.detail) {
    items.push({
      key:   'best',
      label: `${t.bestPick}${bp.type ? ` · ${bp.type}` : ''}`,
      value: bp.detail,
      meta:  bp.confidence != null ? `${Math.round(Number(bp.confidence) * 100)}%` : null,
      intent:'action',
    });
  }
  alts.forEach((alt, i) => {
    const label = alt.type || alt.market || alt.category || `ALT ${i + 1}`;
    const value = alt.pick || alt.detail || alt.selection || '—';
    const confNum = alt.hit_probability ?? alt.confidence;
    const meta = confNum != null ? (confNum > 1 ? `${Math.round(Number(confNum))}%` : `${Math.round(Number(confNum) * 100)}%`) : null;
    items.push({ key: `alt-${i}`, label, value, meta, intent: 'data' });
  });

  if (items.length === 0) return null;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: SPACE.sm }}>
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      SCALE.label,
            color:         C.textMuted,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            fontWeight:    700,
          }}
        >
          {t.alternatives}
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: C.textMuted, letterSpacing: '0.1em' }}>
          {t.altHint}
        </Typography>
      </Box>

      <Box
        sx={{
          display:       'flex',
          gap:           SPACE.sm,
          overflowX:     'auto',
          pb:            SPACE.xs,
          '&::-webkit-scrollbar': { display: 'none' },
          scrollbarWidth: 'none',
        }}
      >
        {items.map((item) => (
          <AltCard key={item.key} item={item} />
        ))}
      </Box>
    </Box>
  );
}

function AltCard({ item }) {
  const { C, MONO, SCALE, SPACE, INTENT } = useHexaTheme();
  const tone = INTENT[item.intent] || INTENT.data;
  return (
    <Box
      sx={{
        flexShrink:  0,
        minWidth:    '220px',
        maxWidth:    '280px',
        px:          SPACE.md,
        py:          SPACE.sm,
        bgcolor:     C.surface,
        border:      `1px solid ${C.border}`,
        borderLeft:  `3px solid ${tone.base}`,
        display:     'flex',
        flexDirection:'column',
        gap:         SPACE.xs,
        transition:  'border-color 0.2s ease, background 0.2s ease',
        '&:hover':   { borderColor: tone.base, bgcolor: C.elevated },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.sm }}>
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      SCALE.micro,
            color:         tone.base,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            fontWeight:    700,
            whiteSpace:    'nowrap',
            overflow:      'hidden',
            textOverflow:  'ellipsis',
            textShadow:    tone.glow,
          }}
        >
          {item.label}
        </Typography>
        {item.meta && (
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize:   SCALE.micro,
              color:      C.textMuted,
              letterSpacing: '0.08em',
              flexShrink: 0,
            }}
          >
            {item.meta}
          </Typography>
        )}
      </Box>
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize:   SCALE.label,
          color:      C.textPrimary,
          lineHeight: 1.4,
        }}
      >
        {item.value}
      </Typography>
    </Box>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function DecisionCenter({ hexa, lang = 'en', slots = {} }) {
  const t = L[lang] ?? L.en;
  const rTone = RISK_LABEL[lang] ?? RISK_LABEL.en;
  const { C, MONO, SCALE, SPACE, INTENT } = useHexaTheme();
  const reduced = usePrefersReducedMotion();

  const mp = hexa.master_prediction ?? {};
  const bp = hexa.best_pick ?? {};
  const confidenceSeed = Number(mp.oracle_confidence);
  const bestPickConfidence = Number(bp.confidence);
  const confidence = Math.min(
    100,
    Math.max(
      0,
      Number.isFinite(confidenceSeed)
        ? confidenceSeed
        : (Number.isFinite(bestPickConfidence) ? (bestPickConfidence <= 1 ? bestPickConfidence * 100 : bestPickConfidence) : 0)
    )
  );
  const risk = String(hexa.model_risk || '').toLowerCase();
  const intent = toIntent(confidence, risk);

  return (
    <motion.div
      variants={reduced ? reducedVariant : staggerContainer()}
      initial="hidden"
      animate="visible"
      style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}
    >
      {/* ── BAND 1 · VERDICT ── */}
      <motion.div variants={reduced ? reducedVariant : fadeUp}>
        <HeroCard
          intent={intent}
          eyebrow={t.verdict}
          title={mp.pick || bp.detail || '—'}
          meta={hexa.matchup || hexa.odds?.game || undefined}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
            <EdgeBar percent={confidence} label={t.confidence} intent={intent} />
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
              {risk && (
                <DataChip
                  label={t.risk}
                  value={rTone[risk] || risk.toUpperCase()}
                  intent={risk === 'low' ? 'success' : risk === 'high' ? 'warn' : 'action'}
                />
              )}
              {hexa.value_breakdown?.edge != null && (
                <DataChip
                  label={t.edge}
                  value={fmtEdge(hexa.value_breakdown.edge)}
                  intent={Number(hexa.value_breakdown.edge) > 0 ? 'success' : 'warn'}
                />
              )}
              {hexa.value_breakdown?.value_tier && (
                <DataChip
                  label={t.tier}
                  value={hexa.value_breakdown.value_tier}
                  intent="action"
                />
              )}
            </Box>
          </Box>
        </HeroCard>
      </motion.div>

      {/* Slot · bankroll form (owned by parent) */}
      {slots.bankroll && (
        <motion.div variants={reduced ? reducedVariant : fadeUp}>
          {slots.bankroll}
        </motion.div>
      )}

      {/* ── BAND 2 · WHY ── */}
      <motion.div variants={reduced ? reducedVariant : fadeUp}>
        <WhyTabs hexa={hexa} lang={lang} t={t} />
      </motion.div>

      {/* ── BAND 3 · ALTERNATIVES ── */}
      <motion.div variants={reduced ? reducedVariant : fadeUp}>
        <AlternativesRail hexa={hexa} t={t} />
      </motion.div>

      {/* Slot · market odds + bet calculator */}
      {slots.oddsPanel && (
        <motion.div variants={reduced ? reducedVariant : fadeUp}>
          {slots.oddsPanel}
        </motion.div>
      )}

      {/* Slot · disclaimers */}
      {slots.disclaimers && (
        <motion.div variants={reduced ? reducedVariant : fadeUp}>
          {slots.disclaimers}
        </motion.div>
      )}
    </motion.div>
  );
}
