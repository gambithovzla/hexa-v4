/**
 * HexaHelpModal.jsx
 * "¿Cómo funciona H.E.X.A.?" — 3-tab educational modal.
 *
 * Props:
 *   open    — boolean
 *   onClose — () => void
 *   lang    — 'en' | 'es'
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';

const BARLOW = '"Barlow Condensed", system-ui, sans-serif';
const MONO   = '"JetBrains Mono", "Fira Code", monospace';
const LABEL  = '"DM Sans", system-ui, sans-serif';

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
};

// ── Sub-components ────────────────────────────────────────────────────────────

function ModeCard({ icon, title, cost, description }) {
  return (
    <Box sx={{
      display:      'flex',
      gap:          '12px',
      p:            '14px 16px',
      bgcolor:      C.cardBg,
      border:       `1px solid ${C.cardBorder}`,
      borderLeft:   `3px solid ${C.accent}`,
      borderRadius: '2px',
    }}>
      <Typography sx={{ fontSize: '1.25rem', lineHeight: 1, flexShrink: 0, mt: '2px' }}>{icon}</Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', mb: '4px', flexWrap: 'wrap' }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.9rem', fontWeight: 800, color: C.textPrimary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {title}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', fontWeight: 700, color: C.accentSec }}>
            {cost}
          </Typography>
        </Box>
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.78rem', color: C.textMuted, lineHeight: 1.65 }}>
          {description}
        </Typography>
      </Box>
    </Box>
  );
}

function CreditPlanRow({ plan, credits, price, highlight }) {
  return (
    <Box sx={{
      display:     'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap:         '8px',
      px:          '12px',
      py:          '10px',
      bgcolor:     highlight ? C.accentDim : 'transparent',
      border:      `1px solid ${highlight ? C.accentLine : C.cardBorder}`,
      borderRadius:'2px',
      alignItems:  'center',
    }}>
      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.78rem', fontWeight: highlight ? 800 : 600, color: highlight ? C.accentSec : C.textPrimary, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {plan}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', fontWeight: 700, color: C.accentSec, textAlign: 'center' }}>
        {credits}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textMuted, textAlign: 'right' }}>
        {price}
      </Typography>
    </Box>
  );
}

function DataSourceCard({ icon, title, description }) {
  return (
    <Box sx={{
      display:      'flex',
      gap:          '10px',
      p:            '12px 14px',
      bgcolor:      C.cardBg,
      border:       `1px solid ${C.cardBorder}`,
      borderLeft:   `3px solid ${C.accentSec}`,
      borderRadius: '2px',
    }}>
      <Typography sx={{ fontSize: '1.1rem', lineHeight: 1, flexShrink: 0, mt: '2px' }}>{icon}</Typography>
      <Box>
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.82rem', fontWeight: 800, color: C.accentSec, textTransform: 'uppercase', letterSpacing: '0.06em', mb: '3px' }}>
          {title}
        </Typography>
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.75rem', color: C.textMuted, lineHeight: 1.6 }}>
          {description}
        </Typography>
      </Box>
    </Box>
  );
}

// ── Tab content ───────────────────────────────────────────────────────────────

function TabModes({ lang }) {
  const isEs = lang === 'es';
  const modes = [
    {
      icon: '🧠',
      title: 'SINGLE DEEP',
      cost: isEs ? '2 créditos' : '2 credits',
      description: isEs
        ? 'Análisis profundo con razonamiento detallado. Examina matchups de pitchers, tendencias ofensivas, bullpen, factores de estadio y más. ~30 segundos.'
        : 'Deep analysis with detailed reasoning. Examines pitcher matchups, offensive trends, bullpen, park factors and more. ~30 seconds.',
    },
    {
      icon: '✨',
      title: 'SINGLE PREMIUM',
      cost: isEs ? '5 créditos' : '5 credits',
      description: isEs
        ? 'Análisis con máxima profundidad de razonamiento. Modelo Opus con capacidad analítica superior para los picks de mayor valor.'
        : 'Analysis with maximum reasoning depth. Opus model with superior analytical capability for highest-value picks.',
    },
    {
      icon: '🃏',
      title: 'PARLAY DEEP',
      cost: isEs ? '8 créditos' : '8 credits',
      description: isEs
        ? 'Análisis profundo de parlay. Razonamiento detallado para cada pierna del parlay con máxima precisión.'
        : 'Deep parlay analysis. Detailed reasoning for each parlay leg with maximum precision.',
    },
    {
      icon: '✨',
      title: 'PARLAY PREMIUM',
      cost: isEs ? '15 créditos' : '15 credits',
      description: isEs
        ? 'Parlay con razonamiento independiente por pick. Modelo Opus evalúa cada pierna de forma autónoma para máxima precisión combinada.'
        : 'Parlay with independent reasoning per pick. Opus model evaluates each leg autonomously for maximum combined precision.',
    },
    {
      icon: '🌐',
      title: 'WEB INTEL',
      cost: isEs ? '+3 créditos (Solo Single)' : '+3 credits (Single only)',
      description: isEs
        ? 'Añade búsqueda en tiempo real: lesiones confirmadas, clima, noticias de último momento y alineaciones del día. Solo disponible en modo Single Game.'
        : 'Adds real-time search: confirmed injuries, weather, breaking news and daily lineups. Only available in Single Game mode.',
    },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {modes.map((m, i) => <ModeCard key={i} {...m} />)}
    </Box>
  );
}

function TabCredits({ lang }) {
  const isEs = lang === 'es';
  const plans = [
    { plan: isEs ? 'Free'       : 'Free',        credits: isEs ? '5 al registrarse' : '5 on signup', price: isEs ? 'Gratis' : 'Free'  },
    { plan: 'HEXA Rookie',                        credits: '15',                                        price: '$7.99'                   },
    { plan: 'HEXA All-Star',                      credits: '50',                                        price: '$19.99',   highlight: true },
    { plan: 'HEXA MVP',                           credits: '120',                                       price: '$39.99'                  },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Title */}
      <Typography sx={{ fontFamily: BARLOW, fontSize: '1rem', fontWeight: 800, color: C.textPrimary, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {isEs ? '¿Cómo funcionan los créditos?' : 'How do credits work?'}
      </Typography>

      {/* Table header */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', px: '12px', pb: '6px', borderBottom: `1px solid ${C.cardBorder}` }}>
        {[isEs ? 'Plan' : 'Plan', isEs ? 'Créditos' : 'Credits', isEs ? 'Precio' : 'Price'].map((h, i) => (
          <Typography key={i} sx={{ fontFamily: BARLOW, fontSize: '0.65rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: i === 2 ? 'right' : i === 1 ? 'center' : 'left' }}>
            {h}
          </Typography>
        ))}
      </Box>

      {/* Plan rows */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {plans.map((p, i) => <CreditPlanRow key={i} {...p} />)}
      </Box>

      {/* Note */}
      <Box sx={{ p: '12px 14px', bgcolor: C.accentDim, border: `1px solid ${C.accentLine}`, borderRadius: '2px' }}>
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.75rem', color: C.textMuted, lineHeight: 1.65 }}>
          {isEs
            ? 'Los créditos nunca vencen. Úsalos cuando quieras, en los análisis que quieras.'
            : 'Credits never expire. Use them whenever you want, on whatever analyses you want.'}
        </Typography>
      </Box>

      {/* Example */}
      <Box sx={{ p: '14px 16px', bgcolor: C.cardBg, border: `1px solid ${C.cardBorder}`, borderLeft: `3px solid ${C.accent}`, borderRadius: '2px' }}>
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.78rem', fontWeight: 800, color: C.accentSec, textTransform: 'uppercase', letterSpacing: '0.08em', mb: '8px' }}>
          {isEs ? 'Ejemplo: Con 50 créditos (HEXA All-Star) puedes hacer:' : 'Example: With 50 credits (HEXA All-Star) you can run:'}
        </Typography>
        {[
          isEs ? '25 análisis Single Deep, ó' : '25 Single Deep analyses, or',
          isEs ? '10 análisis Single Premium, ó' : '10 Single Premium analyses, or',
          isEs ? '6 análisis Parlay Deep, ó' : '6 Parlay Deep analyses, or',
          isEs ? '3 análisis Parlay Premium' : '3 Parlay Premium analyses',
        ].map((line, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: '6px', mb: '4px' }}>
            <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: C.accent, flexShrink: 0 }} />
            <Typography sx={{ fontFamily: LABEL, fontSize: '0.75rem', color: C.textMuted }}>{line}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function TabOracle({ lang }) {
  const isEs = lang === 'es';
  const sources = [
    {
      icon: '📊',
      title: 'Baseball Savant (Statcast)',
      description: isEs
        ? 'xwOBA, Exit Velocity, Whiff%, Barrel%, Sprint Speed y más de 16 leaderboards actualizados diariamente.'
        : 'xwOBA, Exit Velocity, Whiff%, Barrel%, Sprint Speed and 16+ leaderboards updated daily.',
    },
    {
      icon: '⚾',
      title: 'MLB Stats API',
      description: isEs
        ? 'Estadísticas de pitchers, ofensiva de equipos, alineaciones confirmadas y datos históricos.'
        : 'Pitcher statistics, team offense, confirmed lineups and historical data.',
    },
    {
      icon: '🎰',
      title: 'The Odds API',
      description: isEs
        ? 'Momios reales del mercado en tiempo real de los principales sportsbooks.'
        : 'Real-time market odds from major sportsbooks.',
    },
    {
      icon: '⚙️',
      title: isEs ? 'Motor de Análisis H.E.X.A.' : 'H.E.X.A. Analysis Engine',
      description: isEs
        ? 'Procesa toda esta información y genera picks con nivel de confianza, alertas de riesgo y razonamiento detallado basado en datos.'
        : 'Processes all this information to generate picks with confidence levels, risk alerts and detailed data-driven reasoning.',
    },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Intro */}
      <Box sx={{ p: '14px 16px', bgcolor: C.cardBg, border: `1px solid ${C.cardBorder}`, borderRadius: '2px' }}>
        <Typography sx={{ fontFamily: LABEL, fontSize: '0.82rem', color: C.textPrimary, lineHeight: 1.75 }}>
          {isEs
            ? 'H.E.X.A. (Hybrid Expert X-Analysis) es un motor de análisis deportivo que combina múltiples fuentes de datos para generar picks con respaldo estadístico:'
            : 'H.E.X.A. (Hybrid Expert X-Analysis) is a sports analysis engine that combines multiple data sources to generate statistically-backed picks:'}
        </Typography>
      </Box>

      {/* Data sources */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {sources.map((s, i) => <DataSourceCard key={i} {...s} />)}
      </Box>

      {/* Conclusion */}
      <Box sx={{ p: '12px 16px', bgcolor: 'rgba(0,212,255,0.06)', border: `1px solid rgba(0,212,255,0.2)`, borderRadius: '2px', textAlign: 'center' }}>
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.88rem', fontWeight: 800, color: C.accentSec, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {isEs
            ? 'El resultado: picks respaldados por estadísticas, no por intuición.'
            : 'The result: statistically-backed picks, not gut feelings.'}
        </Typography>
      </Box>
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function HexaHelpModal({ open, onClose, lang = 'en' }) {
  const [activeTab, setActiveTab] = useState(0);
  const isEs = lang === 'es';

  if (!open) return null;

  const tabs = [
    { label: isEs ? 'Los Modos'    : 'The Modes'   },
    { label: isEs ? 'Los Créditos' : 'Credits'     },
    { label: isEs ? 'El Oráculo'   : 'The Oracle'  },
  ];

  return (
    /* Backdrop */
    <Box
      onClick={onClose}
      sx={{
        position:        'fixed',
        top:             0,
        left:            0,
        width:           '100vw',
        height:          '100vh',
        zIndex:          9999,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: 'rgba(0,0,0,0.85)',
      }}
    >
      {/* Panel */}
      <Box
        onClick={e => e.stopPropagation()}
        sx={{
          position:      'relative',
          zIndex:        10000,
          width:         '90%',
          maxWidth:      '800px',
          maxHeight:     '90vh',
          overflowY:     'auto',
          display:       'flex',
          flexDirection: 'column',
          bgcolor:       C.bg,
          border:        `1px solid ${C.cardBorder}`,
          borderRadius:  '4px',
          boxShadow:     '0 0 60px rgba(0,102,255,0.2), 0 24px 48px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', px: '20px', pt: '18px', pb: '14px', borderBottom: `1px solid ${C.cardBorder}`, flexShrink: 0 }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '1.05rem', fontWeight: 800, color: C.textPrimary, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              {isEs ? '¿Cómo funciona H.E.X.A.?' : 'How does H.E.X.A. work?'}
            </Typography>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '0.62rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.25em', mt: '2px' }}>
              Hybrid Expert X-Analysis
            </Typography>
          </Box>
          {/* Close */}
          <Box
            component="button"
            onClick={onClose}
            sx={{
              display:        'inline-flex',
              alignItems:     'center',
              justifyContent: 'center',
              width:          '28px',
              height:         '28px',
              border:         `1px solid ${C.cardBorder}`,
              borderRadius:   '2px',
              bgcolor:        'transparent',
              color:          C.textMuted,
              cursor:         'pointer',
              fontSize:       '0.9rem',
              flexShrink:     0,
              transition:     'all 0.15s',
              '&:hover':      { color: C.textPrimary, borderColor: C.accent },
            }}
          >
            ✕
          </Box>
        </Box>

        {/* Tab bar */}
        <Box sx={{ display: 'flex', borderBottom: `1px solid ${C.cardBorder}`, flexShrink: 0 }}>
          {tabs.map((tab, i) => (
            <Box
              key={i}
              component="button"
              onClick={() => setActiveTab(i)}
              sx={{
                flex:          1,
                py:            '10px',
                border:        'none',
                borderBottom:  activeTab === i ? `2px solid ${C.accentSec}` : '2px solid transparent',
                bgcolor:       activeTab === i ? 'rgba(0,102,255,0.06)' : 'transparent',
                color:         activeTab === i ? C.accentSec : C.textMuted,
                fontFamily:    BARLOW,
                fontSize:      '0.75rem',
                fontWeight:    700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                cursor:        'pointer',
                transition:    'all 0.15s',
                '&:hover':     { color: activeTab === i ? C.accentSec : C.textPrimary },
              }}
            >
              {tab.label}
            </Box>
          ))}
        </Box>

        {/* Tab content */}
        <Box sx={{ p: '20px', scrollbarWidth: 'thin', scrollbarColor: `${C.cardBorder} ${C.bgSec}` }}>
          {activeTab === 0 && <TabModes   lang={lang} />}
          {activeTab === 1 && <TabCredits lang={lang} />}
          {activeTab === 2 && <TabOracle  lang={lang} />}
        </Box>
      </Box>
    </Box>
  );
}
