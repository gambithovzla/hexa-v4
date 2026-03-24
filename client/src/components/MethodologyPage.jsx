/**
 * MethodologyPage.jsx — H.E.X.A. V4
 *
 * Full-scroll landing page explaining how H.E.X.A. operates.
 * Rendered independently of the tab system — no React Router needed.
 *
 * Props:
 *   lang   — 'en' | 'es'
 *   onBack — () => void  (returns user to main app)
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';

// ── Fonts / colours ──────────────────────────────────────────────────────────

const BARLOW = '"Barlow Condensed", system-ui, sans-serif';
const DM     = '"DM Sans", system-ui, sans-serif';
const MONO   = '"JetBrains Mono", "Fira Code", monospace';

const C = {
  bg:          '#111111',
  bgCard:      '#111111',
  bgCardHover: '#111111',
  border:      '#2a2a2a',
  accent:      '#f97316',
  accentSec:   '#f97316',
  accentFade:  'rgba(249,115,22,0.08)',
  gold:        '#f59e0b',
  textPrimary: '#E8EDF5',
  textMuted:   '#888888',
  textDim:     '#555555',
  green:       '#22c55e',
};

// ── Localised copy ────────────────────────────────────────────────────────────

const COPY = {
  en: {
    back:         '← Back to H.E.X.A.',
    heroEyebrow:  'The System Behind the Picks',
    heroTitle:    'How H.E.X.A. Works',
    heroSub:
      'H.E.X.A. (Hybrid Expert X-Analysis) is a multi-layer analytical framework built exclusively for MLB. Every recommendation is the product of six interlocking signal engines operating in real time.',

    pillarsTitle: 'Six Signal Engines',
    pillars: [
      {
        icon: '◈',
        label: 'Statcast Data Layer',
        body:
          'We ingest live and historical Statcast feeds — exit velocity, launch angle, barrel rate, sprint speed and 40+ additional metrics — refreshed every cycle to capture the most current player performance state.',
      },
      {
        icon: '◉',
        label: 'Probabilistic Modeling',
        body:
          'Each matchup is evaluated through Bayesian probability models calibrated against five seasons of granular play-by-play data. The output is a win-probability distribution, not a single point estimate.',
      },
      {
        icon: '◆',
        label: 'Pitcher / Batter Matrix',
        body:
          'Plate-discipline metrics (chase rate, contact %, whiff %) are cross-referenced against opposing pitcher tendencies by pitch type and location zone, generating an edge score for each at-bat profile.',
      },
      {
        icon: '◇',
        label: 'Situational Context Engine',
        body:
          'Park factors, weather conditions, rest differential, home/away splits and bullpen workload are layered onto the base model. Context adjusts the raw edge score before any recommendation is issued.',
      },
      {
        icon: '▣',
        label: 'Line Movement Monitor',
        body:
          'Opening lines and sharp-money signals are tracked continuously. When market movement contradicts model output by a statistically meaningful margin, the system flags the discrepancy and re-weights its confidence.',
      },
      {
        icon: '▲',
        label: 'Confidence Calibration',
        body:
          'All six signals are aggregated into a single Confidence Index (0–100). Only matchups crossing a proprietary threshold are surfaced to users — the system deliberately abstains rather than force low-quality picks.',
      },
    ],

    processTitle: 'From Data to Pick',
    steps: [
      { num: '01', label: 'Ingest',     body: 'Raw Statcast records, line data and contextual variables are pulled and validated.' },
      { num: '02', label: 'Score',      body: 'Each signal engine scores the matchup independently along its own dimension.' },
      { num: '03', label: 'Aggregate',  body: 'Scores are weighted and combined into a unified Confidence Index for the game.' },
      { num: '04', label: 'Filter',     body: 'Matchups below threshold are suppressed. Quality over quantity — always.' },
      { num: '05', label: 'Deliver',    body: 'Qualifying picks are surfaced with full signal breakdowns for transparent review.' },
    ],

    edgeTitle: 'The H.E.X.A. Edge',
    edges: [
      { label: 'Data recency',    body: 'Statcast refreshes prevent stale signals from skewing output.' },
      { label: 'No gut picks',    body: 'Every recommendation is traceable to specific model inputs — no black boxes.' },
      { label: 'Parlay integrity',body: 'Parlay legs are checked for correlation risk before bundling.' },
      { label: 'Bankroll aware',  body: 'The built-in tracker surfaces ROI and unit trends to keep you disciplined.' },
    ],

    disclaimer:
      'H.E.X.A. provides analytical insights to support your own decision-making. No system eliminates variance in sports betting. Always bet within your means.',

    footerLine: 'H.E.X.A. Hybrid Expert X-Analysis · Powered by Gambitho Labs',
  },

  es: {
    back:         '← Volver a H.E.X.A.',
    heroEyebrow:  'El Sistema Detrás de los Picks',
    heroTitle:    'Cómo Funciona H.E.X.A.',
    heroSub:
      'H.E.X.A. (Hybrid Expert X-Analysis) es un marco analítico multicapa construido exclusivamente para la MLB. Cada recomendación es el producto de seis motores de señal interconectados que operan en tiempo real.',

    pillarsTitle: 'Seis Motores de Señal',
    pillars: [
      {
        icon: '◈',
        label: 'Capa de Datos Statcast',
        body:
          'Ingerimos feeds Statcast en vivo e históricos — velocidad de salida, ángulo de lanzamiento, tasa de barrel, velocidad de carrera y más de 40 métricas adicionales — actualizados cada ciclo para capturar el estado más actual del rendimiento del jugador.',
      },
      {
        icon: '◉',
        label: 'Modelado Probabilístico',
        body:
          'Cada encuentro se evalúa mediante modelos de probabilidad bayesianos calibrados con cinco temporadas de datos granulares jugada por jugada. La salida es una distribución de probabilidad de victoria, no una estimación puntual única.',
      },
      {
        icon: '◆',
        label: 'Matriz Pitcher / Bateador',
        body:
          'Las métricas de disciplina de plato (tasa de persecución, contacto %, whiff %) se cruzan con las tendencias del lanzador oponente por tipo de pitcheo y zona de ubicación, generando una puntuación de ventaja para cada perfil de turno al bate.',
      },
      {
        icon: '◇',
        label: 'Motor de Contexto Situacional',
        body:
          'Los factores de parque, condiciones climáticas, diferencial de descanso, divisiones local/visitante y carga de trabajo del bullpen se superponen al modelo base. El contexto ajusta la puntuación bruta de ventaja antes de emitir cualquier recomendación.',
      },
      {
        icon: '▣',
        label: 'Monitor de Movimiento de Línea',
        body:
          'Las líneas de apertura y las señales de dinero afilado se rastrean continuamente. Cuando el movimiento del mercado contradice la salida del modelo por un margen estadísticamente significativo, el sistema marca la discrepancia y repondera su confianza.',
      },
      {
        icon: '▲',
        label: 'Calibración de Confianza',
        body:
          'Las seis señales se agregan en un único Índice de Confianza (0–100). Solo los encuentros que superan un umbral propietario se presentan a los usuarios — el sistema se abstiene deliberadamente en lugar de forzar picks de baja calidad.',
      },
    ],

    processTitle: 'Del Dato al Pick',
    steps: [
      { num: '01', label: 'Ingesta',    body: 'Se obtienen y validan registros Statcast brutos, datos de línea y variables contextuales.' },
      { num: '02', label: 'Puntuación', body: 'Cada motor de señal puntúa el encuentro de forma independiente en su propia dimensión.' },
      { num: '03', label: 'Agregación', body: 'Las puntuaciones se ponderan y combinan en un Índice de Confianza unificado para el juego.' },
      { num: '04', label: 'Filtrado',   body: 'Los encuentros por debajo del umbral se suprimen. Calidad sobre cantidad — siempre.' },
      { num: '05', label: 'Entrega',    body: 'Los picks que califican se presentan con desgloses completos de señales para revisión transparente.' },
    ],

    edgeTitle: 'La Ventaja H.E.X.A.',
    edges: [
      { label: 'Actualidad de datos',  body: 'Las actualizaciones de Statcast evitan que señales obsoletas distorsionen la salida.' },
      { label: 'Sin picks intuitivos', body: 'Cada recomendación es rastreable a entradas de modelo específicas — sin cajas negras.' },
      { label: 'Integridad del parlay',body: 'Las patas del parlay se verifican por riesgo de correlación antes de agruparse.' },
      { label: 'Bankroll consciente',  body: 'El rastreador integrado muestra ROI y tendencias de unidades para mantener la disciplina.' },
    ],

    disclaimer:
      'H.E.X.A. proporciona información analítica para apoyar tu propia toma de decisiones. Ningún sistema elimina la varianza en las apuestas deportivas. Siempre apuesta dentro de tus posibilidades.',

    footerLine: 'H.E.X.A. Hybrid Expert X-Analysis · Desarrollado por Gambitho Labs',
  },
};

// ── Signal hierarchy data ─────────────────────────────────────────────────────

const SIGNAL_HIERARCHY = [
  { level: '01', name: 'CONTACTO REAL',      desc: 'Datos Statcast de la temporada actual: calidad de contacto medida, no estimada. Es la señal más predictiva que existe en baseball.',                                                                                       descEn: 'Current season Statcast data: measured contact quality, not estimated. The most predictive signal in baseball.',                                              weight: 95 },
  { level: '02', name: 'FORMA INMEDIATA',    desc: 'Rendimiento en ventanas de 7 y 14 días. Cuando un bateador está en racha o un pitcher en crisis, esto domina sobre los promedios.',                                                                                        descEn: 'Performance in 7 and 14-day windows. When a batter is hot or a pitcher is struggling, this dominates over averages.',                                        weight: 80 },
  { level: '03', name: 'TEMPORADA COMPLETA', desc: 'Promedios estabilizados de la temporada. Sirven como ancla cuando los datos de corto plazo son ruidosos o la muestra es pequeña.',                                                                                         descEn: 'Stabilized season averages. They serve as an anchor when short-term data is noisy or sample size is small.',                                                  weight: 65 },
  { level: '04', name: 'TENDENCIA HISTÓRICA',desc: 'Comparación multi-año. Detecta regresiones, breakouts y cambios de perfil. Contexto — nunca anula los datos actuales.',                                                                                                   descEn: 'Multi-year comparison. Detects regressions, breakouts and profile changes. Context — never overrides current data.',                                          weight: 45 },
  { level: '05', name: 'MERCADO DE ODDS',    desc: 'Las líneas de las casas de apuesta representan la opinión agregada del mercado. H.E.X.A. las usa para encontrar gaps de valor, no para validar picks.',                                                                    descEn: 'Sportsbook lines represent the aggregated market opinion. H.E.X.A. uses them to find value gaps, not to validate picks.',                                     weight: 30 },
  { level: '06', name: 'ENTORNO FÍSICO',     desc: 'Clima y park factors son modificadores obligatorios. Un análisis sin considerar viento a favor en Wrigley está incompleto.',                                                                                               descEn: 'Weather and park factors are mandatory modifiers. An analysis without considering tailwind at Wrigley is incomplete.',                                        weight: 20 },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function PillarCard({ icon, label, body }) {
  return (
    <Box
      sx={{
        p:            3,
        border:       `1px solid ${C.border}`,
        borderRadius: '4px',
        bgcolor:      C.bgCard,
        display:      'flex',
        gap:          2,
        transition:   'border-color 0.2s, background 0.2s',
        '&:hover': {
          borderColor: C.accent,
          bgcolor:     C.bgCardHover,
        },
      }}
    >
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize:   '1.4rem',
          color:      C.accentSec,
          lineHeight: 1,
          flexShrink: 0,
          mt:         '2px',
        }}
      >
        {icon}
      </Typography>
      <Box>
        <Typography
          sx={{
            fontFamily:    BARLOW,
            fontSize:      '1rem',
            fontWeight:    700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color:         C.textPrimary,
            mb:            '6px',
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontFamily: DM,
            fontSize:   '0.875rem',
            color:      C.textMuted,
            lineHeight: 1.65,
          }}
        >
          {body}
        </Typography>
      </Box>
    </Box>
  );
}

function ProcessStep({ num, label, body, isLast }) {
  return (
    <Box sx={{ display: 'flex', gap: 3, position: 'relative' }}>
      {/* Connector line */}
      {!isLast && (
        <Box
          sx={{
            position: 'absolute',
            top:      '36px',
            left:     '19px',
            width:    '2px',
            bottom:   '-24px',
            background: C.accent,
          }}
        />
      )}

      {/* Step number bubble */}
      <Box
        sx={{
          width:          '40px',
          height:         '40px',
          borderRadius:   '50%',
          border:         `2px solid ${C.accent}`,
          bgcolor:        C.accentFade,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          flexShrink:     0,
        }}
      >
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize:   '0.65rem',
            color:      C.accentSec,
            fontWeight: 700,
          }}
        >
          {num}
        </Typography>
      </Box>

      {/* Content */}
      <Box sx={{ pb: 3 }}>
        <Typography
          sx={{
            fontFamily:    BARLOW,
            fontSize:      '1.05rem',
            fontWeight:    700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color:         C.textPrimary,
            mb:            '4px',
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontFamily: DM,
            fontSize:   '0.875rem',
            color:      C.textMuted,
            lineHeight: 1.65,
          }}
        >
          {body}
        </Typography>
      </Box>
    </Box>
  );
}

function EdgeItem({ label, body }) {
  return (
    <Box
      sx={{
        display:      'flex',
        gap:          2,
        alignItems:   'flex-start',
        py:           2,
        borderBottom: `1px solid ${C.border}`,
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Box
        sx={{
          width:        '6px',
          height:       '6px',
          borderRadius: '50%',
          bgcolor:      C.green,
          flexShrink:   0,
          mt:           '6px',
        }}
      />
      <Box>
        <Typography
          sx={{
            fontFamily: DM,
            fontSize:   '0.875rem',
            fontWeight: 700,
            color:      C.textPrimary,
            mb:         '2px',
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontFamily: DM,
            fontSize:   '0.85rem',
            color:      C.textMuted,
            lineHeight: 1.6,
          }}
        >
          {body}
        </Typography>
      </Box>
    </Box>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ children, sx = {} }) {
  return (
    <Box
      component="section"
      sx={{
        maxWidth: 960,
        mx:       'auto',
        px:       { xs: 2, sm: 3, md: 4 },
        py:       { xs: 5, md: 8 },
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

function SectionLabel({ children }) {
  return (
    <Typography
      sx={{
        fontFamily:    MONO,
        fontSize:      '0.65rem',
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color:         C.accentSec,
        mb:            1,
      }}
    >
      {children}
    </Typography>
  );
}

function SectionTitle({ children }) {
  return (
    <Typography
      component="h2"
      sx={{
        fontFamily:    BARLOW,
        fontSize:      { xs: '1.8rem', md: '2.4rem' },
        fontWeight:    700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color:         C.textPrimary,
        mb:            { xs: 3, md: 5 },
      }}
    >
      {children}
    </Typography>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MethodologyPage({ lang = 'en', onBack, onToggleLang }) {
  const t = COPY[lang] ?? COPY.en;
  const [activeLevel, setActiveLevel] = useState(0);

  return (
    <Box
      sx={{
        minHeight:     '100vh',
        bgcolor:       C.bg,
        display:       'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── Minimal top bar ── */}
      <Box
        component="header"
        sx={{
          position:        'sticky',
          top:             0,
          zIndex:          1000,
          bgcolor:         C.bg,
          borderBottom:    `1px solid ${C.border}`,
          display:         'flex',
          alignItems:      'center',
          px:              { xs: 2, sm: 3 },
          py:              '12px',
          gap:             3,
        }}
      >
        {/* Back button */}
        <Box
          component="button"
          onClick={onBack}
          sx={{
            display:       'inline-flex',
            alignItems:    'center',
            gap:           '6px',
            px:            '14px',
            py:            '6px',
            border:        `1px solid ${C.border}`,
            borderRadius:  '2px',
            bgcolor:       'transparent',
            color:         C.textMuted,
            fontFamily:    MONO,
            fontSize:      '0.7rem',
            letterSpacing: '0.06em',
            cursor:        'pointer',
            flexShrink:    0,
            transition:    'all 0.15s',
            '&:hover':     { color: C.textPrimary, borderColor: C.accent },
          }}
        >
          {t.back}
        </Box>

        {/* Logo */}
        <Box
          component="img"
          src="/hexa-logo.png"
          alt="H.E.X.A."
          sx={{
            height:    { xs: '32px', sm: '38px' },
            width:     'auto',
            userSelect:'none',
            filter:    'none',
          }}
        />

        {/* Spacer */}
        <Box sx={{ flex: 1 }} />

        {/* Language toggle */}
        {onToggleLang && (
          <Box
            component="button"
            onClick={onToggleLang}
            sx={{
              background:    '#1c1c1c',
              border:        '1px solid #2a2a2a',
              color:         '#888',
              padding:       '6px 12px',
              borderRadius:  '3px',
              fontFamily:    MONO,
              fontWeight:    500,
              fontSize:      '11px',
              letterSpacing: '1px',
              cursor:        'pointer',
              flexShrink:    0,
              '&:hover':     { color: '#aaa', borderColor: '#3a3a3a' },
            }}
          >
            {lang === 'es' ? 'EN' : 'ES'}
          </Box>
        )}
      </Box>

      {/* ── Hero ── */}
      <Box
        sx={{
          background:  '#111111',
          borderBottom:`1px solid ${C.border}`,
          py:          { xs: 8, md: 12 },
          px:          { xs: 2, sm: 3 },
          textAlign:   'center',
        }}
      >
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      '0.65rem',
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color:         C.accentSec,
            mb:            2,
          }}
        >
          {t.heroEyebrow}
        </Typography>

        <Typography
          component="h1"
          sx={{
            fontFamily:    BARLOW,
            fontSize:      { xs: '2.6rem', sm: '3.8rem', md: '5rem' },
            fontWeight:    700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            lineHeight:    1,
            color:         '#E8EDF5',
            mb:            3,
          }}
        >
          {t.heroTitle}
        </Typography>

        <Typography
          sx={{
            fontFamily: DM,
            fontSize:   { xs: '0.95rem', md: '1.1rem' },
            color:      C.textMuted,
            lineHeight: 1.7,
            maxWidth:   640,
            mx:         'auto',
          }}
        >
          {t.heroSub}
        </Typography>
      </Box>

      {/* ── Six Signal Engines ── */}
      <Section>
        <SectionLabel>{t.pillarsTitle}</SectionLabel>
        <SectionTitle>{t.pillarsTitle}</SectionTitle>
        <Box
          sx={{
            display:             'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap:                 2,
          }}
        >
          {t.pillars.map(p => (
            <PillarCard key={p.label} icon={p.icon} label={p.label} body={p.body} />
          ))}
        </Box>
      </Section>

      {/* ── Divider ── */}
      <Box sx={{ borderTop: `1px solid ${C.border}` }} />

      {/* ── Signal Hierarchy ── */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '6rem 2rem' }}>
        <div style={{ marginBottom: '0.75rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: '0.75rem', letterSpacing: 4, textTransform: 'uppercase', color: '#f97316' }}>
          {lang === 'es' ? '02 — JERARQUÍA DE SEÑALES' : '02 — SIGNAL HIERARCHY'}
        </div>
        <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', color: '#fff', lineHeight: 1.1, marginBottom: '1rem' }}>
          {lang === 'es' ? <>Cuando los datos se contradicen,<br/>H.E.X.A. sabe cuál manda.</> : <>When data conflicts,<br/>H.E.X.A. knows which signal wins.</>}
        </h2>
        <p style={{ fontSize: '1rem', lineHeight: 1.7, color: '#888888', maxWidth: 600, marginBottom: '3rem' }}>
          {lang === 'es' ? 'No todas las señales pesan igual. Este es el orden de prioridad que resuelve conflictos entre datos.' : 'Not all signals carry equal weight. This is the priority order that resolves data conflicts.'}
        </p>
        <div style={{ display: 'flex', gap: '3rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SIGNAL_HIERARCHY.map((h, i) => (
              <div key={i} onClick={() => setActiveLevel(i)} style={{
                display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem',
                borderRadius: 3, cursor: 'pointer', border: '1px solid transparent',
                background: activeLevel === i ? '#1c1c1c' : 'transparent',
                borderColor: activeLevel === i ? '#2a2a2a' : 'transparent',
                transition: 'all 0.3s ease',
              }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: '1.5rem', color: activeLevel === i ? '#f97316' : '#333333', minWidth: 36, transition: 'color 0.3s ease' }}>{h.level}</span>
                <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: '0.9rem', letterSpacing: 1.5, color: activeLevel === i ? '#fff' : '#888888', transition: 'color 0.3s ease' }}>{h.name}</span>
              </div>
            ))}
          </div>
          <div style={{ flex: 1, background: '#1c1c1c', border: '1px solid #2a2a2a', borderRadius: 4, padding: '2.5rem', position: 'relative', overflow: 'hidden', minHeight: 240, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 280 }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: 3, height: '100%', background: '#f97316' }} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: '0.7rem', letterSpacing: 3, textTransform: 'uppercase', color: '#f97316', marginBottom: '0.75rem' }}>
              {lang === 'es' ? 'PRIORIDAD' : 'PRIORITY'} {SIGNAL_HIERARCHY[activeLevel].level}
            </div>
            <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: '1.8rem', color: '#fff', marginBottom: '1rem' }}>
              {SIGNAL_HIERARCHY[activeLevel].name}
            </div>
            <p style={{ fontSize: '0.95rem', lineHeight: 1.8, color: '#aaaaaa', maxWidth: 480 }}>
              {lang === 'es' ? SIGNAL_HIERARCHY[activeLevel].desc : SIGNAL_HIERARCHY[activeLevel].descEn}
            </p>
            <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', maxWidth: 200 }}>
                <div style={{ height: '100%', width: `${SIGNAL_HIERARCHY[activeLevel].weight}%`, background: '#f97316', borderRadius: 2, transition: 'width 0.6s ease' }} />
              </div>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '0.8rem', color: '#555555', letterSpacing: 1 }}>
                {lang === 'es' ? 'PESO RELATIVO' : 'RELATIVE WEIGHT'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Divider ── */}
      <Box sx={{ borderTop: `1px solid ${C.border}` }} />

      {/* ── Data Integrity ── */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '6rem 2rem' }}>
        <div style={{ marginBottom: '0.75rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: '0.75rem', letterSpacing: 4, textTransform: 'uppercase', color: '#f97316' }}>
          {lang === 'es' ? '03 — INTEGRIDAD DE DATOS' : '03 — DATA INTEGRITY'}
        </div>
        <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', color: '#fff', lineHeight: 1.1, marginBottom: '1rem' }}>
          {lang === 'es' ? <>Si los datos son incompletos,<br/>la confianza baja. Siempre.</> : <>If data is incomplete,<br/>confidence drops. Always.</>}
        </h2>
        <p style={{ fontSize: '1rem', lineHeight: 1.7, color: '#888888', maxWidth: 600, marginBottom: '3rem' }}>
          {lang === 'es'
            ? 'Antes de cada análisis, H.E.X.A. calcula un score de calidad de datos (0-100) que determina qué tipos de apuesta están disponibles y cuánto se penaliza la confianza. Sin teatro.'
            : 'Before every analysis, H.E.X.A. calculates a data quality score (0-100) that determines which bet types are available and how much confidence is penalized. No theater.'}
        </p>
        <div style={{ background: '#1c1c1c', border: '1px solid #2a2a2a', borderRadius: 4, padding: '3rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 1, background: '#2a2a2a', borderRadius: 3, overflow: 'hidden' }}>
            {/* FULL */}
            <div style={{ background: '#111111', padding: '1.5rem', textAlign: 'center' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: '1.6rem', color: '#22c55e', marginBottom: '0.5rem' }}>80-100</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: '0.7rem', letterSpacing: 2, textTransform: 'uppercase', color: '#888888', marginBottom: '0.75rem' }}>
                {lang === 'es' ? 'ANÁLISIS COMPLETO' : 'FULL ANALYSIS'}
              </div>
              <p style={{ fontSize: '0.78rem', lineHeight: 1.5, color: '#666666' }}>
                {lang === 'es'
                  ? 'Todos los datos disponibles. Todos los tipos de apuesta habilitados. Máxima confianza.'
                  : 'All data available. All bet types enabled. Maximum confidence.'}
              </p>
            </div>
            {/* STANDARD */}
            <div style={{ background: '#111111', padding: '1.5rem', textAlign: 'center' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: '1.6rem', color: '#f97316', marginBottom: '0.5rem' }}>60-79</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: '0.7rem', letterSpacing: 2, textTransform: 'uppercase', color: '#888888', marginBottom: '0.75rem' }}>
                {lang === 'es' ? 'ANÁLISIS ESTÁNDAR' : 'STANDARD ANALYSIS'}
              </div>
              <p style={{ fontSize: '0.78rem', lineHeight: 1.5, color: '#666666' }}>
                {lang === 'es'
                  ? 'Props solo con datos Statcast confirmados del jugador. Confianza ajustada.'
                  : 'Props only with confirmed player Statcast data. Adjusted confidence.'}
              </p>
            </div>
            {/* LIMITED */}
            <div style={{ background: '#111111', padding: '1.5rem', textAlign: 'center' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: '1.6rem', color: '#f59e0b', marginBottom: '0.5rem' }}>40-59</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: '0.7rem', letterSpacing: 2, textTransform: 'uppercase', color: '#888888', marginBottom: '0.75rem' }}>
                {lang === 'es' ? 'ANÁLISIS LIMITADO' : 'LIMITED ANALYSIS'}
              </div>
              <p style={{ fontSize: '0.78rem', lineHeight: 1.5, color: '#666666' }}>
                {lang === 'es'
                  ? 'Solo Moneyline y Over/Under. Confianza penalizada -15%. Riesgo elevado.'
                  : 'Moneyline and Over/Under only. Confidence penalized -15%. Elevated risk.'}
              </p>
            </div>
            {/* MINIMAL */}
            <div style={{ background: '#111111', padding: '1.5rem', textAlign: 'center' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: '1.6rem', color: '#f87171', marginBottom: '0.5rem' }}>0-39</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: '0.7rem', letterSpacing: 2, textTransform: 'uppercase', color: '#888888', marginBottom: '0.75rem' }}>
                {lang === 'es' ? 'ANÁLISIS MÍNIMO' : 'MINIMAL ANALYSIS'}
              </div>
              <p style={{ fontSize: '0.78rem', lineHeight: 1.5, color: '#666666' }}>
                {lang === 'es'
                  ? 'Solo Moneyline. Confianza -25%. Riesgo alto obligatorio. Máxima transparencia.'
                  : 'Moneyline only. Confidence -25%. High risk mandatory. Maximum transparency.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Divider ── */}
      <Box sx={{ borderTop: `1px solid ${C.border}` }} />

      {/* ── Process ── */}
      <Section>
        <SectionLabel>{t.processTitle}</SectionLabel>
        <SectionTitle>{t.processTitle}</SectionTitle>
        <Box sx={{ maxWidth: 560 }}>
          {t.steps.map((step, i) => (
            <ProcessStep
              key={step.num}
              num={step.num}
              label={step.label}
              body={step.body}
              isLast={i === t.steps.length - 1}
            />
          ))}
        </Box>
      </Section>

      {/* ── Divider ── */}
      <Box sx={{ borderTop: `1px solid ${C.border}` }} />

      {/* ── The Edge ── */}
      <Section>
        <SectionLabel>{t.edgeTitle}</SectionLabel>
        <SectionTitle>{t.edgeTitle}</SectionTitle>
        <Box
          sx={{
            border:       `1px solid ${C.border}`,
            borderRadius: '4px',
            bgcolor:      C.bgCard,
            px:           3,
            maxWidth:     640,
          }}
        >
          {t.edges.map(e => (
            <EdgeItem key={e.label} label={e.label} body={e.body} />
          ))}
        </Box>
      </Section>

      {/* ── Divider ── */}
      <Box sx={{ borderTop: `1px solid ${C.border}` }} />

      {/* ── Disclaimer / footer ── */}
      <Box
        component="footer"
        sx={{
          py:        { xs: 4, md: 6 },
          px:        { xs: 2, sm: 3 },
          textAlign: 'center',
          mt:        'auto',
        }}
      >
        <Typography
          sx={{
            fontFamily: DM,
            fontSize:   '0.8rem',
            color:      C.textDim,
            lineHeight: 1.6,
            maxWidth:   560,
            mx:         'auto',
            mb:         3,
          }}
        >
          {t.disclaimer}
        </Typography>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize:   '0.6rem',
            color:      C.textDim,
            letterSpacing: '0.1em',
          }}
        >
          {t.footerLine}
        </Typography>
      </Box>
    </Box>
  );
}
