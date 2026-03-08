/**
 * AnalysisPanel.jsx
 * Orchestrates bet controls, API calls, and result display for H.E.X.A. V4.
 *
 * Props:
 *   selectedGames  — array of game objects (1 for single, N for parlay/fullday)
 *   mode           — 'single' | 'parlay' | 'fullDay'
 *   lang           — 'en' | 'es'
 *   onSave         — (historyEntry) => void  (optional, for useHistory)
 */

import { useState, useEffect } from 'react';
import { Box, Typography, Switch, Slider } from '@mui/material';
import ResultCard from './ResultCard';

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:          '#0a0e17',
  cardBg:      '#111827',
  cardBorder:  '#1e293b',
  accent:      '#f59e0b',
  accentDim:   '#f59e0b12',
  textPrimary: '#f1f5f9',
  textMuted:   '#94a3b8',
  green:       '#22c55e',
  red:         '#ef4444',
  amber:       '#f59e0b',
  blue:        '#3b82f6',
};

const MONO  = '"JetBrains Mono", "Fira Code", monospace';
const LABEL = '"Outfit", "Inter", system-ui, sans-serif';

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
      fullDay: 'Loading today\'s games…',
    },
    readyHint:    'Configure your options and run the Oracle.',
    parseError:   'The Oracle returned an unstructured response. Raw output:',
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
      fullDay: 'Cargando los juegos de hoy…',
    },
    readyHint:    'Configura las opciones y ejecuta el Oráculo.',
    parseError:   'El Oráculo devolvió una respuesta no estructurada. Respuesta:',
  },
};

// ── Shared helpers ────────────────────────────────────────────────────────────

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
        mb: '8px',
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
          width: '100%',
          background: C.cardBorder,
          border: `1px solid ${C.cardBorder}`,
          borderRadius: '7px',
          color: C.textPrimary,
          fontFamily: LABEL,
          fontSize: '0.8rem',
          padding: '8px 10px',
          cursor: 'pointer',
          outline: 'none',
          colorScheme: 'dark',
          appearance: 'none',
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%2394a3b8' d='M6 8L0 0h12z'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 10px center',
          paddingRight: '28px',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Box>
  );
}

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
          return (
            <Box
              key={o.value}
              component="button"
              onClick={() => onChange(o.value)}
              sx={{
                flex: 1,
                py: '7px',
                px: '4px',
                border: `1px solid ${active ? C.accent : C.cardBorder}`,
                borderRadius: '7px',
                bgcolor: active ? C.accentDim : 'transparent',
                color: active ? C.accent : C.textMuted,
                fontFamily: LABEL,
                fontSize: '0.72rem',
                fontWeight: active ? 700 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
                '&:hover': { borderColor: active ? C.accent : '#2d3f55', color: active ? C.accent : C.textPrimary },
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
          return (
            <Box
              key={o.value}
              component="button"
              onClick={() => onChange(o.value)}
              sx={{
                flex: 1,
                py: '7px',
                px: '4px',
                border: `1px solid ${active ? C.accent : C.cardBorder}`,
                borderRadius: '7px',
                bgcolor: active ? C.accentDim : 'transparent',
                color: active ? C.accent : C.textMuted,
                fontFamily: LABEL,
                fontSize: '0.72rem',
                fontWeight: active ? 700 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
                '&:hover': { borderColor: active ? C.accent : '#2d3f55', color: active ? C.accent : C.textPrimary },
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
          borderTopColor: C.accent,
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
        bgcolor: '#ef444410',
        border: `1px solid ${C.red}44`,
        borderRadius: '10px',
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
          border: `1px solid ${C.red}`,
          borderRadius: '7px',
          bgcolor: 'transparent',
          color: C.red,
          fontFamily: LABEL,
          fontSize: '0.78rem',
          fontWeight: 600,
          cursor: 'pointer',
          '&:hover': { bgcolor: `${C.red}15` },
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

// ── Run button ────────────────────────────────────────────────────────────────

function RunButton({ canAnalyze, loading, onClick, t }) {
  const active = canAnalyze && !loading;
  return (
    <Box
      component="button"
      onClick={active ? onClick : undefined}
      sx={{
        width: '100%',
        py: '12px',
        border: `1px solid ${active ? C.accent : C.cardBorder}`,
        borderRadius: '8px',
        background: active
          ? `linear-gradient(135deg, ${C.accent} 0%, #d97706 100%)`
          : C.cardBg,
        color: active ? '#0a0e17' : C.textMuted,
        fontFamily: LABEL,
        fontSize: '0.875rem',
        fontWeight: 700,
        cursor: active ? 'pointer' : 'not-allowed',
        letterSpacing: '0.02em',
        transition: 'all 0.2s',
        '&:hover': active
          ? { transform: 'translateY(-1px)', boxShadow: `0 4px 20px ${C.accent}44` }
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

  const [betType,     setBetType]     = useState('all');
  const [riskProfile, setRiskProfile] = useState('balanced');
  const [modelMode,   setModelMode]   = useState('fast');
  const [webSearch,   setWebSearch]   = useState(false);
  const [parlayLegs,  setParlayLegs]  = useState(2);
  const [result,      setResult]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);

  // Sync parlay legs with actual selection count
  useEffect(() => {
    if (mode === 'parlay' && selectedGames.length >= 2) {
      setParlayLegs(Math.min(6, selectedGames.length));
    }
  }, [selectedGames.length, mode]);

  // Reset result when mode or selection changes
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [mode, selectedGames.length]);

  const canAnalyze =
    (mode === 'single'  && selectedGames.length === 1) ||
    (mode === 'parlay'  && selectedGames.length >= 2)  ||
    (mode === 'fullDay' && selectedGames.length > 0);

  async function handleAnalyze() {
    if (!canAnalyze) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      let endpoint, body;

      if (mode === 'single') {
        const g = selectedGames[0];
        endpoint = '/api/analyze/game';
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
        endpoint = '/api/analyze/parlay';
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
      } else {
        // fullDay
        endpoint = '/api/analyze/full-day';
        body = {
          date:        selectedGames[0]?.gameDate?.split('T')[0]
                         ?? new Date().toISOString().split('T')[0],
          lang,
          betType,
          riskProfile,
          webSearch,
          model:       modelMode,
        };
      }

      const res  = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const json = await res.json();

      if (json.success) {
        setResult(json.data);
        onSave?.({
          type:   mode === 'fullDay' ? 'fullday' : mode,
          games:  selectedGames,
          result: json.data,
          date:   new Date().toISOString(),
        });
      } else {
        setError(json.error ?? 'Unknown error');
      }
    } catch (e) {
      setError(e.message ?? 'Network error');
    } finally {
      setLoading(false);
    }
  }

  // Parsed HEXA JSON lives at result.data (oracle returns { data, rawText, parseError, ... })
  const hexaData   = result?.data ?? null;
  const parseError = result?.parseError ?? false;
  const rawText    = result?.rawText ?? '';

  return (
    <Box sx={{ bgcolor: C.bg, display: 'flex', flexDirection: 'column', gap: '16px', p: 2 }}>

      {/* ── Controls card ── */}
      <Box
        sx={{
          bgcolor: C.cardBg,
          border: `1px solid ${C.cardBorder}`,
          borderRadius: '10px',
          p: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
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

        {/* Web search toggle */}
        <WebSearchToggle value={webSearch} onChange={setWebSearch} t={t} />

        {/* Run button */}
        <RunButton canAnalyze={canAnalyze} loading={loading} onClick={handleAnalyze} t={t} />
      </Box>

      {/* ── Loading ── */}
      {loading && <OracleSpinner t={t} />}

      {/* ── Error ── */}
      {!loading && error && (
        <ErrorDisplay error={error} onRetry={handleAnalyze} t={t} />
      )}

      {/* ── Parse error: show raw text ── */}
      {!loading && !error && result && parseError && (
        <Box
          sx={{
            bgcolor: C.cardBg,
            border: `1px solid ${C.cardBorder}`,
            borderRadius: '10px',
            p: '20px',
          }}
        >
          <Typography
            sx={{
              fontFamily: LABEL,
              fontSize: '0.75rem',
              color: C.amber,
              mb: '10px',
            }}
          >
            {t.parseError}
          </Typography>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.7rem',
              color: C.textMuted,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {rawText}
          </Typography>
        </Box>
      )}

      {/* ── Result ── */}
      {!loading && !error && hexaData && !parseError && (
        <ResultCard data={hexaData} lang={lang} />
      )}

      {/* ── Empty state ── */}
      {!loading && !error && !result && (
        <EmptyState mode={mode} canAnalyze={canAnalyze} t={t} />
      )}
    </Box>
  );
}
