/**
 * AnalysisPanel.jsx
 * Orchestrates bet controls, API calls, and result display for H.E.X.A. V4.
 *
 * Props:
 *   selectedGames  — array of game objects (1 for single, N for parlay)
 *   mode           — 'single' | 'parlay'
 *   lang           — 'en' | 'es'
 *   onSave         — (historyEntry) => void  (optional, for useHistory)
 */

import { useState, useEffect } from 'react';
import { Box, Typography, Switch, Slider } from '@mui/material';
import ResultCard from './ResultCard';
import AuthModal from './AuthModal';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:          '#04080F',
  bgSec:       '#080D1A',
  cardBg:      '#0D1424',
  cardBorder:  '#1A2540',
  accent:      '#0066FF',
  accentSec:   '#00D4FF',
  accentDim:   'rgba(0,102,255,0.08)',
  accentLine:  'rgba(0,102,255,0.25)',
  textPrimary: '#E8EDF5',
  textMuted:   '#5A7090',
  green:       '#00E676',
  red:         '#FF3D57',
  amber:       '#FFB800',
  blue:        '#0066FF',
  overlay:     'rgba(4,8,15,0.85)',
};

const BARLOW = '"Barlow Condensed", system-ui, sans-serif';
const MONO   = '"JetBrains Mono", "Fira Code", monospace';
const LABEL  = '"DM Sans", system-ui, sans-serif';

// ── i18n ─────────────────────────────────────────────────────────────────────
const L = {
  en: {
    betType: {
      label:      'Bet Focus',
      all:        'All Types',
      moneyline:  'Moneyline',
      runline:    'Run Line',
      totals:     'Over/Under',
      playerprops:'Player Props',
    },
    riskProfile: {
      label:        'Risk Profile',
      conservative: 'Conservative',
      balanced:     'Balanced',
      aggressive:   'Aggressive',
    },
    modelSelect: {
      label: 'Analysis Model',
      fast:  '⚡ Fast',
      deep:  '🧠 Deep',
    },
    webSearch:    'Web Intel',
    parlayLegs:   'Parlay Legs',
    runOracle:    'Run Oracle Analysis',
    analyzing:    'The Oracle is analyzing…',
    retry:        'Retry',
    error:        'Analysis failed',
    emptyHint: {
      single:  'Select a game on the left to begin.',
      parlay:  'Select 2–6 games on the left to build your parlay.',
    },
    readyHint:    'Configure your options and run the Oracle.',
    parseError:   'Analysis could not be processed. Please retry.',
    lineupDialog: {
      title:    '⚠️ Unconfirmed Lineups',
      body:     (n, total) => `${n} of ${total} game${total > 1 ? 's' : ''} have unconfirmed lineups. Analysis will be based on probable starters and team tendencies.`,
      continue: 'Continue Anyway',
      cancel:   'Cancel',
    },
    lineupBadge: {
      confirmed:   '✓ LINEUP',
      probable:    '~ PROBABLE',
      unavailable: '? NO LINEUP',
    },
  },
  es: {
    betType: {
      label:      'Enfoque de Apuesta',
      all:        'Todos los Tipos',
      moneyline:  'Moneyline',
      runline:    'Línea de Carreras',
      totals:     'Totales (O/U)',
      playerprops:'Props de Jugador',
    },
    riskProfile: {
      label:        'Perfil de Riesgo',
      conservative: 'Conservador',
      balanced:     'Equilibrado',
      aggressive:   'Agresivo',
    },
    modelSelect: {
      label: 'Modelo de Análisis',
      fast:  '⚡ Fast',
      deep:  '🧠 Deep',
    },
    webSearch:    'Intel Web',
    parlayLegs:   'Patas del Parlay',
    runOracle:    'Ejecutar Análisis Oracle',
    analyzing:    'El Oráculo está analizando…',
    retry:        'Reintentar',
    error:        'Error en el análisis',
    emptyHint: {
      single:  'Selecciona un juego a la izquierda para comenzar.',
      parlay:  'Selecciona 2–6 juegos a la izquierda para tu parlay.',
    },
    readyHint:    'Configura las opciones y ejecuta el Oráculo.',
    parseError:   'No se pudo procesar el análisis. Por favor, reintenta.',
    lineupDialog: {
      title:    '⚠️ Alineación no confirmada',
      body:     (n, total) => `${n} de ${total} partido${total > 1 ? 's' : ''} no tiene${total > 1 ? 'n' : ''} alineación confirmada. El análisis se basará en lanzadores probables y tendencias del equipo.`,
      continue: 'Continuar de todas formas',
      cancel:   'Cancelar',
    },
    lineupBadge: {
      confirmed:   '✓ LINEUP',
      probable:    '~ PROBABLE',
      unavailable: '? SIN LINEUP',
    },
  },
};

// ── Shared helpers ────────────────────────────────────────────────────────────

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
        mb:            '8px',
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

// ── Controls sub-components ───────────────────────────────────────────────────

function BetTypeSelect({ value, onChange, t }) {
  const options = [
    { value: 'all',         label: t.betType.all         },
    { value: 'moneyline',   label: t.betType.moneyline   },
    { value: 'runline',     label: t.betType.runline      },
    { value: 'totals',      label: t.betType.totals       },
    { value: 'playerprops', label: t.betType.playerprops  },
  ];

  return (
    <Box>
      <SectionLabel>{t.betType.label}</SectionLabel>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width:             '100%',
          background:        C.bgSec,
          border:            `1px solid ${C.cardBorder}`,
          borderRadius:      '2px',
          color:             C.textPrimary,
          fontFamily:        LABEL,
          fontSize:          '0.8rem',
          padding:           '8px 10px',
          cursor:            'pointer',
          outline:           'none',
          colorScheme:       'dark',
          appearance:        'none',
          backgroundImage:   `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%235A7090' d='M6 8L0 0h12z'/%3E%3C/svg%3E")`,
          backgroundRepeat:  'no-repeat',
          backgroundPosition:'right 10px center',
          paddingRight:      '28px',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Box>
  );
}

const RISK_CFG = {
  conservative: { color: '#00E676', glow: 'rgba(0,230,118,0.35)',  dim: 'rgba(0,230,118,0.08)'  },
  balanced:     { color: '#0066FF', glow: 'rgba(0,102,255,0.35)',  dim: 'rgba(0,102,255,0.08)'  },
  aggressive:   { color: '#FF9800', glow: 'rgba(255,152,0,0.35)', dim: 'rgba(255,152,0,0.08)' },
};

function RiskProfilePicker({ value, onChange, t }) {
  const options = [
    { value: 'conservative', label: t.riskProfile.conservative },
    { value: 'balanced',     label: t.riskProfile.balanced     },
    { value: 'aggressive',   label: t.riskProfile.aggressive   },
  ];

  return (
    <Box>
      <SectionLabel>{t.riskProfile.label}</SectionLabel>
      <Box sx={{ display: 'flex', gap: '6px' }}>
        {options.map(o => {
          const active = value === o.value;
          const cfg    = RISK_CFG[o.value];
          return (
            <Box
              key={o.value}
              component="button"
              onClick={() => onChange(o.value)}
              sx={{
                flex:          1,
                py:            '7px',
                px:            '4px',
                border:        `1px solid ${active ? cfg.color + '80' : C.cardBorder}`,
                borderRadius:  '2px',
                bgcolor:       active ? cfg.dim : 'transparent',
                color:         active ? cfg.color : C.textMuted,
                fontFamily:    BARLOW,
                fontSize:      '0.75rem',
                fontWeight:    700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor:        'pointer',
                transition:    'all 0.15s',
                boxShadow:     active ? `0 0 12px ${cfg.glow}` : 'none',
                '&:hover':     {
                  borderColor: cfg.color + '60',
                  color:       active ? cfg.color : C.textPrimary,
                  boxShadow:   `0 0 8px ${cfg.glow}`,
                },
              }}
            >
              {o.label}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

const MODEL_CFG = {
  fast: {
    gradient: 'linear-gradient(135deg, #0066FF 0%, #00D4FF 100%)',
    glow:     'rgba(0,212,255,0.35)',
    dim:      'rgba(0,102,255,0.08)',
    color:    '#00D4FF',
  },
  deep: {
    gradient: 'linear-gradient(135deg, #6B21A8 0%, #9333EA 100%)',
    glow:     'rgba(147,51,234,0.4)',
    dim:      'rgba(107,33,168,0.12)',
    color:    '#C084FC',
  },
};

function ModelPicker({ value, onChange, t }) {
  const options = [
    { value: 'fast', label: t.modelSelect.fast },
    { value: 'deep', label: t.modelSelect.deep },
  ];

  return (
    <Box>
      <SectionLabel>{t.modelSelect.label}</SectionLabel>
      <Box sx={{ display: 'flex', gap: '6px' }}>
        {options.map(o => {
          const active = value === o.value;
          const cfg    = MODEL_CFG[o.value];
          return (
            <Box
              key={o.value}
              component="button"
              onClick={() => onChange(o.value)}
              sx={{
                flex:          1,
                py:            '7px',
                px:            '4px',
                border:        `1px solid ${active ? cfg.color + '70' : C.cardBorder}`,
                borderRadius:  '2px',
                background:    active ? cfg.gradient : 'transparent',
                color:         active ? '#ffffff' : C.textMuted,
                fontFamily:    BARLOW,
                fontSize:      '0.75rem',
                fontWeight:    700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor:        'pointer',
                transition:    'all 0.15s',
                boxShadow:     active ? `0 0 16px ${cfg.glow}, inset 0 1px 0 rgba(255,255,255,0.1)` : 'none',
                textShadow:    active ? `0 0 12px ${cfg.color}` : 'none',
                '&:hover':     {
                  borderColor: cfg.color + '60',
                  color:       active ? '#ffffff' : C.textPrimary,
                  boxShadow:   `0 0 10px ${cfg.glow}`,
                },
              }}
            >
              {o.label}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function WebSearchToggle({ value, onChange, t }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Box>
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.8rem', color: C.textPrimary, fontWeight: 600 }}>
          {t.webSearch}
        </Typography>
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.65rem', color: C.textMuted }}>
          Live news &amp; injury data
        </Typography>
      </Box>
      <Switch
        checked={value}
        onChange={e => onChange(e.target.checked)}
        size="small"
        sx={{
          '& .MuiSwitch-switchBase.Mui-checked': { color: C.accent },
          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: C.accent },
        }}
      />
    </Box>
  );
}

function ParlayLegsSlider({ value, min, max, onChange, t }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: '4px' }}>
        <SectionLabel>{t.parlayLegs}</SectionLabel>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.78rem', fontWeight: 700, color: C.accent }}>
          {value}
        </Typography>
      </Box>
      <Slider
        value={value}
        min={min}
        max={max}
        step={1}
        marks
        onChange={(_, v) => onChange(v)}
        sx={{
          color: C.accent,
          '& .MuiSlider-thumb': { bgcolor: C.accent, width: 14, height: 14 },
          '& .MuiSlider-rail':  { bgcolor: C.cardBorder },
          '& .MuiSlider-mark':  { bgcolor: C.cardBorder },
          '& .MuiSlider-markActive': { bgcolor: C.accent },
        }}
      />
    </Box>
  );
}

// ── Loading / Error / Empty states ────────────────────────────────────────────

function OracleSpinner({ t }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 7, gap: '20px' }}>
      <Box
        sx={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          border: `3px solid ${C.cardBorder}`,
          borderTopColor: C.accentSec,
          '@keyframes oracleSpin': { to: { transform: 'rotate(360deg)' } },
          animation: 'oracleSpin 0.75s linear infinite',
        }}
      />
      <Box sx={{ textAlign: 'center' }}>
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.875rem', color: C.textMuted, mb: '4px' }}>
          {t.analyzing}
        </Typography>
        <Box sx={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
          {[0, 1, 2].map(i => (
            <Box
              key={i}
              sx={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                bgcolor: C.accent,
                '@keyframes dotPulse': {
                  '0%, 80%, 100%': { opacity: 0.2, transform: 'scale(0.8)' },
                  '40%':           { opacity: 1,   transform: 'scale(1)'   },
                },
                animation: `dotPulse 1.2s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function ErrorDisplay({ error, onRetry, t }) {
  return (
    <Box
      sx={{
        bgcolor: 'rgba(255,61,87,0.06)',
        border: `1px solid rgba(255,61,87,0.28)`,
        borderRadius: '2px',
        p: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        textAlign: 'center',
      }}
    >
      <Typography sx={{ fontFamily: LABEL, fontSize: '0.875rem', color: C.red, fontWeight: 600 }}>
        {t.error}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textMuted }}>
        {error}
      </Typography>
      <Box
        component="button"
        onClick={onRetry}
        sx={{
          px: '20px',
          py: '8px',
          border:        `1px solid ${C.red}`,
          borderRadius:  '2px',
          bgcolor:       'transparent',
          color:         C.red,
          fontFamily:    BARLOW,
          fontSize:      '0.8rem',
          fontWeight:    700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          cursor:        'pointer',
          '&:hover':     { bgcolor: 'rgba(255,61,87,0.1)' },
        }}
      >
        {t.retry}
      </Box>
    </Box>
  );
}

function EmptyState({ mode, canAnalyze, t }) {
  const msg = !canAnalyze ? (t.emptyHint[mode] ?? t.emptyHint.single) : t.readyHint;
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 8,
        gap: '14px',
        minHeight: 240,
      }}
    >
      <Typography sx={{ fontSize: '2rem', lineHeight: 1 }}>⚾</Typography>
      <Typography
        sx={{
          fontFamily: LABEL,
          fontSize: '0.82rem',
          color: C.textMuted,
          textAlign: 'center',
          maxWidth: 300,
          lineHeight: 1.65,
        }}
      >
        {msg}
      </Typography>
    </Box>
  );
}


function NoCreditsMessage({ lang }) {
  const isEs = lang === 'es';
  return (
    <Box
      sx={{
        bgcolor:      'rgba(255,61,87,0.06)',
        border:       `1px solid rgba(255,61,87,0.28)`,
        borderRadius: '2px',
        p:            '14px 20px',
        textAlign:    'center',
      }}
    >
      <Typography sx={{ fontFamily: LABEL, fontSize: '0.85rem', color: C.red, fontWeight: 600 }}>
        {isEs ? 'Sin créditos — próximamente recarga' : 'No credits remaining — top-up coming soon'}
      </Typography>
    </Box>
  );
}

// ── Credit cost logic ─────────────────────────────────────────────────────────

const BASE_COST = {
  single:  { fast: 1,  deep: 2  },
  parlay:  { fast: 4,  deep: 8  },
};
const WEB_INTEL_COST = 3; // only for single game

function calcCreditCost(mode, modelMode, webSearch) {
  const base = BASE_COST[mode]?.[modelMode] ?? 1;
  const webBonus = (mode === 'single' && webSearch) ? WEB_INTEL_COST : 0;
  return base + webBonus;
}

const ACTION_LABEL = {
  en: {
    single:  { fast: 'Single Fast Analysis', deep: 'Single Deep Analysis' },
    parlay:  { fast: 'Parlay Fast Analysis',  deep: 'Parlay Deep Analysis'  },
  },
  es: {
    single:  { fast: 'Análisis Single Fast', deep: 'Análisis Single Deep' },
    parlay:  { fast: 'Análisis Parlay Fast',  deep: 'Análisis Parlay Deep'  },
  },
};

// ── CreditCostIndicator ───────────────────────────────────────────────────────

function CreditCostIndicator({ cost, userCredits, isAuthenticated, lang, mode, modelMode }) {
  const isEs        = lang === 'es';
  const credits     = isAuthenticated ? (userCredits ?? 0) : null;
  const hasEnough   = credits === null || credits >= cost;
  const actionLabel = ACTION_LABEL[isEs ? 'es' : 'en']?.[mode]?.[modelMode] ?? '';

  return (
    <Box
      sx={{
        p:            '12px 14px',
        bgcolor:      hasEnough ? 'rgba(0,102,255,0.05)' : 'rgba(255,61,87,0.06)',
        border:       `1px solid ${hasEnough ? C.accentLine : 'rgba(255,61,87,0.3)'}`,
        borderRadius: '2px',
        display:      'flex',
        flexDirection:'column',
        gap:          '6px',
      }}
    >
      {/* Action name */}
      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {actionLabel}
      </Typography>

      {/* Cost + balance row */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Typography component="span" sx={{ fontSize: '0.75rem' }}>⚡</Typography>
          <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.9rem', fontWeight: 700, color: hasEnough ? C.accentSec : C.red }}>
            {cost}
          </Typography>
          <Typography component="span" sx={{ fontFamily: BARLOW, fontSize: '0.68rem', color: C.textMuted, letterSpacing: '0.06em' }}>
            {isEs ? 'créditos' : 'credits'}
          </Typography>
        </Box>

        {isAuthenticated && credits !== null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '0.64rem', color: C.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {isEs ? 'Saldo:' : 'Balance:'}
            </Typography>
            <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.72rem', fontWeight: 700, color: hasEnough ? C.green : C.red }}>
              {credits}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Insufficient warning */}
      {isAuthenticated && !hasEnough && (
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.68rem', fontWeight: 700, color: C.red, letterSpacing: '0.06em' }}>
          ⚠ {isEs
            ? `Necesitas ${cost} créditos. Tu saldo es ${credits}.`
            : `You need ${cost} credits. Your balance is ${credits}.`}
        </Typography>
      )}
    </Box>
  );
}

function RunButton({ canAnalyze, loading, onClick, t }) {
  const active = canAnalyze && !loading;
  return (
    <Box
      component="button"
      onClick={active ? onClick : undefined}
      sx={{
        width:         '100%',
        py:            '14px',
        border:        `1px solid ${active ? C.accentSec + '80' : C.cardBorder}`,
        borderRadius:  '2px',
        background:    active
          ? `linear-gradient(135deg, ${C.accent} 0%, ${C.accentSec} 100%)`
          : C.cardBg,
        color:         active ? '#ffffff' : C.textMuted,
        fontFamily:    BARLOW,
        fontSize:      '15px',
        fontWeight:    800,
        cursor:        active ? 'pointer' : 'not-allowed',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        transition:    'all 0.2s',
        boxShadow:     active
          ? '0 0 30px rgba(0,102,255,0.5), 0 4px 15px rgba(0,0,0,0.3)'
          : 'none',
        '@keyframes runButtonPulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(0,102,255,0)' },
          '50%':      { boxShadow: '0 0 14px rgba(0,102,255,0.18)' },
        },
        animation: !active ? 'runButtonPulse 3s ease-in-out infinite' : 'none',
        '&:hover':  active
          ? {
              transform: 'scale(1.01) translateY(-1px)',
              boxShadow: '0 0 50px rgba(0,102,255,0.65), 0 0 25px rgba(0,212,255,0.3), 0 6px 20px rgba(0,0,0,0.35)',
            }
          : {},
      }}
    >
      {loading ? t.analyzing : t.runOracle}
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalysisPanel({
  selectedGames = [],
  mode = 'single',
  lang = 'en',
  onSave,
}) {
  const t = L[lang] ?? L.en;
  const { isAuthenticated, token, user, updateCredits } = useAuth();

  const [betType,     setBetType]     = useState('all');
  const [riskProfile, setRiskProfile] = useState('balanced');
  const [modelMode,   setModelMode]   = useState('fast');
  const [webSearch,   setWebSearch]   = useState(false);
  const [parlayLegs,  setParlayLegs]  = useState(2);
  const [result,      setResult]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [authModalOpen,    setAuthModalOpen]    = useState(false);
  const [lineupDialogOpen, setLineupDialogOpen] = useState(false);

  // Sync parlay legs with actual selection count
  useEffect(() => {
    if (mode === 'parlay' && selectedGames.length >= 2) {
      setParlayLegs(Math.min(6, selectedGames.length));
    }
  }, [selectedGames.length, mode]);

  // Reset result when mode or selection changes; clear webSearch for non-single modes
  useEffect(() => {
    setResult(null);
    setError(null);
    if (mode !== 'single') setWebSearch(false);
  }, [mode, selectedGames.length]);

  const canAnalyze =
    (mode === 'single' && selectedGames.length === 1) ||
    (mode === 'parlay' && selectedGames.length >= 2);

  const creditCost    = calcCreditCost(mode, modelMode, webSearch);
  const userCredits   = user?.credits ?? 0;
  const hasEnoughCredits = !isAuthenticated || userCredits >= creditCost;

  // Lineup status helpers
  const unconfirmedGames = selectedGames.filter(g => g.lineupStatus !== 'confirmed');

  function handleAnalyze() {
    if (!canAnalyze) return;

    // Auth gate
    if (!isAuthenticated) {
      setAuthModalOpen(true);
      return;
    }

    // Credits gate
    if (userCredits < creditCost) {
      setError('__no_credits__');
      return;
    }

    // Lineup confirmation gate
    if (unconfirmedGames.length > 0) {
      setLineupDialogOpen(true);
      return;
    }

    runAnalysis();
  }

  async function runAnalysis() {
    setLineupDialogOpen(false);
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      let endpoint, body;

      if (mode === 'single') {
        const g = selectedGames[0];
        endpoint = `${API_URL}/api/analyze/game`;
        body = {
          gameId:      g.gamePk,
          date:        g.gameDate?.split('T')[0],
          lang,
          betType,
          riskProfile,
          webSearch,
          model:       modelMode,
        };
      } else if (mode === 'parlay') {
        endpoint = `${API_URL}/api/analyze/parlay`;
        body = {
          gameIds:     selectedGames.map(g => g.gamePk),
          date:        selectedGames[0]?.gameDate?.split('T')[0],
          lang,
          betType,
          riskProfile,
          webSearch,
          parlayLegs,
          model:       modelMode,
        };
      }

      // Auto-retry once after 2 s on any failure (network error or success:false)
      const doFetch = () =>
        fetch(endpoint, {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body:    JSON.stringify(body),
        }).then(r => r.json());

      let json;
      try {
        json = await doFetch();
        if (!json.success) {
          // Map 'No credits remaining' to sentinel so UI shows the right message
          if (json.error === 'No credits remaining') {
            setError('__no_credits__');
            setLoading(false);
            return;
          }
          throw new Error(json.error ?? 'Server error');
        }
      } catch (e) {
        if (e.message === '__no_credits__') { setError('__no_credits__'); setLoading(false); return; }
        await new Promise(r => setTimeout(r, 2000));
        try {
          json = await doFetch();
          if (!json.success) throw new Error(json.error ?? 'Server error');
        } catch (e2) {
          setError(e2.message ?? 'Network error');
          setLoading(false);
          return;
        }
      }

      // Update credit count in auth store if returned
      if (typeof json.credits === 'number') {
        updateCredits(json.credits);
      }

      // Success path
      setResult(json);
      onSave?.({
        type:   mode,
        games:  selectedGames,
        result: json.data,
        date:   new Date().toISOString(),
      });
    } catch (e) {
      setError(e.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  }

  // ── extractHexaData: tries every possible path to find a valid HEXA object ─
  function extractHexaData(response) {
    const isHexa = (obj) =>
      obj && typeof obj === 'object' &&
      (obj.master_prediction || obj.parlay || obj.games);

    const tryParse = (str) => {
      try {
        let cleaned = str.replace(/```json/gi, '').replace(/```/g, '').trim();
        const first = cleaned.indexOf('{');
        const last  = cleaned.lastIndexOf('}');
        if (first !== -1 && last > first) {
          const parsed = JSON.parse(cleaned.substring(first, last + 1));
          if (isHexa(parsed)) return parsed;
        }
      } catch { /* fall through */ }
      return null;
    };

    // Walk all candidate paths
    const candidates = [
      response?.data,
      response?.analysis?.data,
      response?.analysis,
      response,
    ];

    for (const c of candidates) {
      if (!c) continue;
      if (isHexa(c))               return c;
      if (typeof c === 'string') {
        const parsed = tryParse(c);
        if (parsed)                return parsed;
      }
    }

    // Last resort: rawText field
    const raw = response?.rawText ?? response?.analysis?.rawText;
    if (raw && typeof raw === 'string') {
      const parsed = tryParse(raw);
      if (parsed) return parsed;
    }

    return null;
  }

  const hexaData = extractHexaData(result);

  return (
    <Box sx={{ bgcolor: C.bg, display: 'flex', flexDirection: 'column', gap: '16px', p: 2 }}>

      {/* ── Controls card ── */}
      <Box
        sx={{
          bgcolor:      C.cardBg,
          border:       `1px solid ${C.cardBorder}`,
          borderLeft:   `1px solid ${C.cardBorder}`,
          borderRadius: '2px',
          p:            '20px',
          display:      'flex',
          flexDirection:'column',
          gap:          '18px',
          boxShadow:    'inset 3px 0 12px rgba(0,102,255,0.12), inset 0 0 40px rgba(0,102,255,0.02)',
        }}
      >
        {/* Bet type + Risk profile side by side on wide screens */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: '16px',
          }}
        >
          <BetTypeSelect value={betType} onChange={setBetType} t={t} />
          <RiskProfilePicker value={riskProfile} onChange={setRiskProfile} t={t} />
        </Box>

        {/* Model picker */}
        <ModelPicker value={modelMode} onChange={setModelMode} t={t} />

        {/* Parlay legs slider (only in parlay mode) */}
        {mode === 'parlay' && selectedGames.length >= 2 && (
          <ParlayLegsSlider
            value={parlayLegs}
            min={2}
            max={Math.min(6, selectedGames.length)}
            onChange={setParlayLegs}
            t={t}
          />
        )}

        {/* Web search toggle — single game only */}
        {mode === 'single' && (
          <WebSearchToggle value={webSearch} onChange={setWebSearch} t={t} />
        )}

        {/* Credit cost indicator */}
        <CreditCostIndicator
          cost={creditCost}
          userCredits={isAuthenticated ? userCredits : null}
          isAuthenticated={isAuthenticated}
          lang={lang}
          mode={mode}
          modelMode={modelMode}
        />

        {/* Lineup status badges — shown when games are selected */}
        {selectedGames.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {selectedGames.map((g, i) => {
              const status = g.lineupStatus ?? 'unavailable';
              const badgeLabel = t.lineupBadge[status] ?? t.lineupBadge.unavailable;
              const badgeColor = status === 'confirmed' ? C.green : status === 'probable' ? C.amber : C.textMuted;
              const gameName = g.teams?.away?.abbreviation && g.teams?.home?.abbreviation
                ? `${g.teams.away.abbreviation}@${g.teams.home.abbreviation}`
                : `G${i + 1}`;
              return (
                <Box
                  key={g.gamePk ?? i}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    border: `1px solid ${badgeColor}44`,
                    borderRadius: '2px',
                    px: '7px', py: '3px',
                    bgcolor: `${badgeColor}0D`,
                  }}
                >
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted }}>{gameName}</Typography>
                  <Typography sx={{ fontFamily: BARLOW, fontSize: '0.62rem', fontWeight: 700, color: badgeColor, letterSpacing: '0.06em' }}>{badgeLabel}</Typography>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Run button — disabled when insufficient credits */}
        {isAuthenticated && !hasEnoughCredits ? (
          <NoCreditsMessage lang={lang} />
        ) : (
          <RunButton
            canAnalyze={canAnalyze && hasEnoughCredits}
            loading={loading}
            onClick={handleAnalyze}
            t={t}
          />
        )}
      </Box>

      {/* ── Auth modal ── */}
      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} lang={lang} />

      {/* ── Lineup confirmation dialog ── */}
      {lineupDialogOpen && (
        <Box sx={{
          position: 'fixed', inset: 0, zIndex: 9999,
          bgcolor: 'rgba(4,8,15,0.88)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Box sx={{
            position: 'relative', zIndex: 10000,
            bgcolor: C.cardBg, border: `1px solid ${C.amber}44`,
            borderLeft: `4px solid ${C.amber}`,
            borderRadius: '4px', p: '28px', maxWidth: '420px', width: '90%',
          }}>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '0.9rem', fontWeight: 700, color: C.amber, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '12px' }}>
              {t.lineupDialog.title}
            </Typography>
            <Typography sx={{ fontFamily: LABEL, fontSize: '0.83rem', color: C.textPrimary, lineHeight: 1.65, mb: '24px' }}>
              {t.lineupDialog.body(unconfirmedGames.length, selectedGames.length)}
            </Typography>
            <Box sx={{ display: 'flex', gap: '10px' }}>
              <Box
                component="button"
                onClick={() => { setLineupDialogOpen(false); runAnalysis(); }}
                sx={{
                  flex: 1, py: '10px', fontFamily: BARLOW, fontSize: '0.8rem', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  bgcolor: C.accent, color: '#fff', border: 'none', borderRadius: '2px', cursor: 'pointer',
                  '&:hover': { bgcolor: '#0052cc' },
                }}
              >
                {t.lineupDialog.continue}
              </Box>
              <Box
                component="button"
                onClick={() => setLineupDialogOpen(false)}
                sx={{
                  flex: 1, py: '10px', fontFamily: BARLOW, fontSize: '0.8rem', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  bgcolor: 'transparent', color: C.textMuted, border: `1px solid ${C.cardBorder}`, borderRadius: '2px', cursor: 'pointer',
                  '&:hover': { color: C.textPrimary },
                }}
              >
                {t.lineupDialog.cancel}
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* ── Loading ── */}
      {loading && <OracleSpinner t={t} />}

      {/* ── No credits error ── */}
      {!loading && error === '__no_credits__' && (
        <NoCreditsMessage lang={lang} />
      )}

      {/* ── Error ── */}
      {!loading && error && error !== '__no_credits__' && (
        <ErrorDisplay error={error} onRetry={handleAnalyze} t={t} />
      )}

      {/* ── Parse-error fallback — friendly message, never raw JSON ── */}
      {!loading && !error && result && !hexaData && (
        <ErrorDisplay error={t.parseError} onRetry={handleAnalyze} t={t} />
      )}

      {/* ── Result ── */}
      {!loading && !error && hexaData && (
        <ResultCard data={hexaData} lang={lang} />
      )}

      {/* ── Empty state ── */}
      {!loading && !error && !result && (
        <EmptyState mode={mode} canAnalyze={canAnalyze} t={t} />
      )}
    </Box>
  );
}
