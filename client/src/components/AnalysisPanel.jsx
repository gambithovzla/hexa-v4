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
import { C, BARLOW, MONO, SANS } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── i18n ─────────────────────────────────────────────────────────────────────
const L = {
  en: {
    betType: {
      label:      'Bet Focus',
      all:        'All Types',
      moneyline:  'Moneyline',
      runline:    'Run Line',
      totals:     'Over/Under',
      pitcherprops:'🔥 Pitcher Props (Strikeouts)',
      batterprops: '🦇 Batter Props (HR, Hits)',
    },
    modelSelect: {
      label:   'Analysis Model',
      deep:    '🧠 Deep',
      premium: '✨ Premium',
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
      pitcherprops:'🔥 Pitcher Props (Ponches)',
      batterprops: '🦇 Batter Props (HR, Hits)',
    },
    modelSelect: {
      label:   'Modelo de Análisis',
      deep:    '🧠 Deep',
      premium: '✨ Premium',
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
        fontFamily:    MONO,
        fontSize:      '10px',
        fontWeight:    700,
        color:         C.textDim,
        textTransform: 'uppercase',
        letterSpacing: '2px',
        mb:            '8px',
        display:       'flex',
        alignItems:    'center',
        gap:           '6px',
        '&::before': {
          content:      '""',
          display:      'inline-block',
          width:        '5px',
          height:       '5px',
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
    { value: 'Pitcher Props', label: t.betType.pitcherprops },
    { value: 'Batter Props',  label: t.betType.batterprops  },
  ];

  return (
    <Box>
      <SectionLabel>{t.betType.label}</SectionLabel>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width:             '100%',
          background:        C.surfaceAlt,
          border:            `1px solid ${C.border}`,
          borderRadius:      '2px',
          color:             C.textPrimary,
          fontFamily:        MONO,
          fontSize:          '11px',
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

function ModelPicker({ value, onChange, t, lang }) {
  const safeActive = value === 'safe';
  const options = [
    { value: 'deep',    label: t.modelSelect.deep    },
    { value: 'premium', label: t.modelSelect.premium },
  ];

  return (
    <Box>
      <SectionLabel>{t.modelSelect.label}</SectionLabel>
      <Box sx={{ display: 'flex', gap: '4px' }}>
        {/* Safe Pick button */}
        <Box
          component="button"
          onClick={() => onChange('safe')}
          sx={{
            flex:          1,
            border:        `1px solid ${safeActive ? 'rgba(34,197,94,0.3)' : '#2a2a2a'}`,
            borderRadius:  '3px',
            background:    safeActive ? 'rgba(34,197,94,0.1)' : 'transparent',
            color:         safeActive ? '#22c55e' : '#666',
            fontFamily:    "'Barlow Condensed', sans-serif",
            fontWeight:    700,
            fontSize:      '11px',
            letterSpacing: '1.5px',
            padding:       '6px 14px',
            cursor:        'pointer',
            transition:    'all 0.15s',
          }}
        >
          SAFE PICK
        </Box>

        {/* Deep / Premium */}
        {options.map(o => {
          const active = value === o.value;
          return (
            <Box
              key={o.value}
              component="button"
              onClick={() => onChange(o.value)}
              sx={{
                flex:          1,
                py:            '7px',
                px:            '4px',
                border:        `1px solid ${active ? C.accentLine : C.border}`,
                borderRadius:  '2px',
                background:    active ? C.accentDim : 'transparent',
                color:         active ? C.accent : C.textMuted,
                fontFamily:    MONO,
                fontSize:      '10px',
                fontWeight:    700,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                cursor:        'pointer',
                transition:    'all 0.15s',
                '&:hover':     { color: active ? C.accent : C.textSecondary },
              }}
            >
              {o.label}
            </Box>
          );
        })}
      </Box>

      {/* Safe Pick descriptive text */}
      {safeActive && (
        <Box sx={{
          fontFamily:  "'JetBrains Mono', monospace",
          fontSize:    '10px',
          color:       '#22c55e',
          background:  'rgba(34,197,94,0.05)',
          border:      '1px solid rgba(34,197,94,0.1)',
          borderRadius:'3px',
          padding:     '8px 12px',
          marginTop:   '8px',
        }}>
          {lang === 'es'
            ? 'H.E.X.A. evaluará TODOS los tipos de apuesta y te dará el que tenga mayor probabilidad de acierto.'
            : 'H.E.X.A. will evaluate ALL bet types and give you the one with the highest probability of hitting.'}
        </Box>
      )}
    </Box>
  );
}

function WebSearchToggle({ value, onChange, t }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <Box>
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: C.textSecondary, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
          {t.webSearch}
        </Typography>
        <Typography sx={{ fontFamily: SANS, fontSize: '0.65rem', color: C.textMuted }}>
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
          '& .MuiSlider-rail':  { bgcolor: C.border },
          '& .MuiSlider-mark':  { bgcolor: C.border },
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
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: `2px solid ${C.border}`,
          borderTopColor: C.accent,
          '@keyframes oracleSpin': { to: { transform: 'rotate(360deg)' } },
          animation: 'oracleSpin 0.75s linear infinite',
        }}
      />
      <Box sx={{ textAlign: 'center' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '2px', color: C.textMuted, textTransform: 'uppercase', mb: '4px' }}>
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
        bgcolor: C.redDim,
        border: `1px solid ${C.redLine}`,
        borderRadius: '2px',
        p: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        textAlign: 'center',
      }}
    >
      <Typography sx={{ fontFamily: SANS, fontSize: '0.875rem', color: C.red, fontWeight: 600 }}>
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
          fontFamily: SANS,
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
      <Typography sx={{ fontFamily: SANS, fontSize: '0.85rem', color: C.red, fontWeight: 600 }}>
        {isEs ? 'Sin créditos — próximamente recarga' : 'No credits remaining — top-up coming soon'}
      </Typography>
    </Box>
  );
}

// ── Credit cost logic ─────────────────────────────────────────────────────────

const BASE_COST = {
  single:  { deep: 2, premium: 5  },
  parlay:  { deep: 8, premium: 15 },
};
const WEB_INTEL_COST = 3; // only for single game

function calcCreditCost(mode, modelMode, webSearch) {
  if (modelMode === 'safe') return 2;
  const base = BASE_COST[mode]?.[modelMode] ?? 1;
  const webBonus = (mode === 'single' && webSearch) ? WEB_INTEL_COST : 0;
  return base + webBonus;
}

const ACTION_SANS = {
  en: {
    single:  { deep: 'Single Deep Analysis', premium: 'Single Premium Analysis', safe: 'Safe Pick Analysis' },
    parlay:  { deep: 'Parlay Deep Analysis',  premium: 'Parlay Premium Analysis',  safe: 'Safe Pick Analysis' },
  },
  es: {
    single:  { deep: 'Análisis Single Deep', premium: 'Análisis Single Premium', safe: 'Análisis Safe Pick' },
    parlay:  { deep: 'Análisis Parlay Deep',  premium: 'Análisis Parlay Premium',  safe: 'Análisis Safe Pick' },
  },
};

// ── CreditCostIndicator ───────────────────────────────────────────────────────

function CreditCostIndicator({ cost, userCredits, isAuthenticated, lang, mode, modelMode }) {
  const isEs        = lang === 'es';
  const credits     = isAuthenticated ? (userCredits ?? 0) : null;
  const hasEnough   = credits === null || credits >= cost;
  const actionLabel = ACTION_SANS[isEs ? 'es' : 'en']?.[mode]?.[modelMode] ?? '';

  return (
    <Box
      sx={{
        p:            '12px 14px',
        bgcolor:      hasEnough ? C.accentDim : C.redDim,
        border:       `1px solid ${hasEnough ? C.accentLine : C.redLine}`,
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
          <Typography component="span" sx={{ fontFamily: MONO, fontSize: '0.9rem', fontWeight: 700, color: hasEnough ? C.accent : C.red }}>
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
        border:        'none',
        borderRadius:  '3px',
        background:    active ? C.accent : C.border,
        color:         active ? '#111111' : C.textMuted,
        fontFamily:    BARLOW,
        fontSize:      '13px',
        fontWeight:    700,
        cursor:        active ? 'pointer' : 'not-allowed',
        letterSpacing: '1px',
        textTransform: 'uppercase',
        transition:    'opacity 0.15s',
        '&:hover':     active ? { opacity: 0.88 } : {},
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
  setIsAnalyzing,
}) {
  const t = L[lang] ?? L.en;
  const { isAuthenticated, token, user, updateCredits } = useAuth();

  const [betType,     setBetType]     = useState('all');
  const [modelMode,   setModelMode]   = useState('deep');
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
    setIsAnalyzing?.(true);
    setError(null);
    setResult(null);

    try {
      let endpoint, body;

      if (modelMode === 'safe') {
        const g = selectedGames[0];
        endpoint = `${API_URL}/api/analyze/safe`;
        body = {
          gameId: g.gamePk,
          date:   g.gameDate?.split('T')[0],
          lang,
        };
      } else if (mode === 'single') {
        const g = selectedGames[0];
        endpoint = `${API_URL}/api/analyze/game`;
        body = {
          gameId:      g.gamePk,
          date:        g.gameDate?.split('T')[0],
          lang,
          betType,
          riskProfile: 'balanced',
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
          riskProfile: 'balanced',
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
            setIsAnalyzing?.(false);
            return;
          }
          throw new Error(json.error ?? 'Server error');
        }
      } catch (e) {
        if (e.message === '__no_credits__') { setError('__no_credits__'); setLoading(false); setIsAnalyzing?.(false); return; }
        await new Promise(r => setTimeout(r, 2000));
        try {
          json = await doFetch();
          if (!json.success) throw new Error(json.error ?? 'Server error');
        } catch (e2) {
          setError(e2.message ?? 'Network error');
          setLoading(false);
          setIsAnalyzing?.(false);
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
        type:     mode,
        games:    selectedGames,
        result:   json.data,
        date:     new Date().toISOString(),
        model:    modelMode,
        language: lang,
      });
    } catch (e) {
      setError(e.message ?? 'Network error');
    } finally {
      setLoading(false);
      setIsAnalyzing?.(false);
    }
  }

  // ── extractHexaData: tries every possible path to find a valid HEXA object ─
  function extractHexaData(response) {
    const isHexa = (obj) =>
      obj && typeof obj === 'object' &&
      (obj.master_prediction || obj.parlay || obj.games || obj.safe_pick);

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
          bgcolor:      C.surface,
          border:       `1px solid ${C.border}`,
          borderRadius: '4px',
          p:            '20px',
          display:      'flex',
          flexDirection:'column',
          gap:          '18px',
        }}
      >
        {/* Bet type — hidden in safe mode (system decides) */}
        {modelMode !== 'safe' && (
          <BetTypeSelect value={betType} onChange={setBetType} t={t} />
        )}

        {/* Model picker */}
        <ModelPicker value={modelMode} onChange={setModelMode} t={t} lang={lang} />

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

        {/* Web search toggle — single game only, not in safe mode */}
        {mode === 'single' && modelMode !== 'safe' && (
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
          bgcolor: 'rgba(17,17,17,0.92)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Box sx={{
            position: 'relative', zIndex: 10000,
            bgcolor: C.surface, border: `1px solid ${C.amberLine}`,
            borderLeft: `3px solid ${C.amber}`,
            borderRadius: '4px', p: '28px', maxWidth: '420px', width: '90%',
          }}>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '0.9rem', fontWeight: 700, color: C.amber, textTransform: 'uppercase', letterSpacing: '0.1em', mb: '12px' }}>
              {t.lineupDialog.title}
            </Typography>
            <Typography sx={{ fontFamily: SANS, fontSize: '0.83rem', color: C.textPrimary, lineHeight: 1.65, mb: '24px' }}>
              {t.lineupDialog.body(unconfirmedGames.length, selectedGames.length)}
            </Typography>
            <Box sx={{ display: 'flex', gap: '10px' }}>
              <Box
                component="button"
                onClick={() => { setLineupDialogOpen(false); runAnalysis(); }}
                sx={{
                  flex: 1, py: '10px', fontFamily: BARLOW, fontSize: '0.8rem', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  bgcolor: C.accent, color: '#111111', border: 'none', borderRadius: '2px', cursor: 'pointer',
                  '&:hover': { opacity: 0.88 },
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
                  bgcolor: C.surfaceAlt, color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: '2px', cursor: 'pointer',
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
