/**
 * ResultCard.jsx
 * Renders H.E.X.A. V4 JSON responses for single game, parlay, and full-day modes.
 *
 * Props:
 *   data  — the parsed HEXA JSON (data.data from oracle response)
 *   lang  — 'en' | 'es'
 */

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
