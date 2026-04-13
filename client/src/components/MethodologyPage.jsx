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

import { useState, useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { C as GC, BARLOW as GB, MONO as GM } from '../theme';

const METHODOLOGY_CSS = `
@keyframes slideReveal { from { opacity:0; transform:translateY(24px) } to { opacity:1; transform:translateY(0) } }
@keyframes expandLine { from { width:0 } to { width:100% } }
@keyframes numberGlow { 0%,100% { text-shadow:0 0 0 rgba(0,217,255,0) } 50% { text-shadow:0 0 20px rgba(0,217,255,0.5) } }
@keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
@keyframes float { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-8px) } }
@media (prefers-reduced-motion:reduce) { * { animation:none!important; transition:none!important } }
`;

function useInView(ref) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.15 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return visible;
}

function useCounter(end, duration, enabled) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const start = Date.now();
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(end * eased));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [enabled]);
  return val;
}

function AnimatedSection({ children, delay = 0 }) {
  const ref = useRef(null);
  const visible = useInView(ref);
  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(24px)',
      transition: `opacity 0.5s ease ${delay}s, transform 0.5s ease ${delay}s`,
    }}>
      {children}
    </div>
  );
}

// ── Sci-Fi design tokens (aligned with Phase A/B/C global system) ─────────────

const BARLOW = GB;
const DM     = GM;
const MONO   = GM;

const C = {
  bg:          GC.bg,
  bgCard:      GC.surface,
  bgCardHover: GC.elevated,
  border:      GC.cyanLine,
  accent:      GC.accent,
  accentSec:   GC.accent,
  accentFade:  GC.accentDim,
  gold:        GC.cyan,
  textPrimary: GC.textPrimary,
  textMuted:   GC.textSecondary,
  textDim:     GC.textMuted,
  green:       GC.green,
  cyan:        GC.cyan,
  cyanLine:    GC.cyanLine,
  cyanDim:     GC.cyanDim,
  cyanGlow:    GC.cyanGlow,
  accentLine:  GC.accentLine,
  accentGlow:  GC.accentGlow,
  greenLine:   GC.greenLine,
  greenDim:    GC.greenDim,
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
      { label: 'Quality filter',  body: 'Only high-conviction spots survive the final threshold before reaching the user.' },
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
      { label: 'Filtro de calidad',    body: 'Solo los spots de alta convicción sobreviven el umbral final antes de llegar al usuario.' },
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
        p:            '20px 22px',
        border:       `1px solid ${C.cyanLine}`,
        borderRadius: 0,
        bgcolor:      C.bgCard,
        display:      'flex',
        gap:          '16px',
        position:     'relative',
        transition:   'border-color 0.2s, box-shadow 0.2s',
        '&::before': {
          content:   '""',
          position:  'absolute',
          top: 0, left: 0,
          width: '10px', height: '10px',
          borderTop:  `1px solid ${C.cyan}`,
          borderLeft: `1px solid ${C.cyan}`,
        },
        '&:hover': {
          borderColor: C.cyan,
          boxShadow:   `0 0 16px rgba(0,217,255,0.12)`,
        },
      }}
    >
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize:   '1.3rem',
          color:      C.accent,
          lineHeight: 1,
          flexShrink: 0,
          mt:         '2px',
          textShadow: `0 0 10px ${C.accent}88`,
        }}
      >
        {icon}
      </Typography>
      <Box>
        <Typography
          sx={{
            fontFamily:    BARLOW,
            fontSize:      '0.85rem',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            color:         C.textPrimary,
            mb:            '8px',
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize:   '0.78rem',
            color:      C.textMuted,
            lineHeight: 1.7,
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
    <Box sx={{ display: 'flex', gap: '20px', position: 'relative' }}>
      {/* Connector line */}
      {!isLast && (
        <Box
          sx={{
            position:   'absolute',
            top:        '36px',
            left:       '17px',
            width:      '1px',
            bottom:     '-24px',
            background: `linear-gradient(${C.cyan}, transparent)`,
          }}
        />
      )}

      {/* Step number — square neon */}
      <Box
        sx={{
          width:          '36px',
          height:         '36px',
          borderRadius:   0,
          border:         `1px solid ${C.accentLine}`,
          bgcolor:        C.accentFade,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          flexShrink:     0,
          boxShadow:      `0 0 8px rgba(255,102,0,0.25)`,
        }}
      >
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize:   '0.6rem',
            color:      C.accent,
            letterSpacing: '1px',
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
            fontSize:      '0.85rem',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            color:         C.textPrimary,
            mb:            '6px',
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize:   '0.78rem',
            color:      C.textMuted,
            lineHeight: 1.7,
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
        gap:          '14px',
        alignItems:   'flex-start',
        py:           '14px',
        borderBottom: `1px solid ${C.cyanLine}`,
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      {/* Neon green bracket indicator */}
      <Box sx={{ flexShrink: 0, mt: '3px' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.green, lineHeight: 1, textShadow: `0 0 8px ${C.green}88` }}>▶</Typography>
      </Box>
      <Box>
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      '0.78rem',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            color:         C.textPrimary,
            mb:            '4px',
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize:   '0.75rem',
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
        fontSize:      '0.6rem',
        letterSpacing: '3px',
        textTransform: 'uppercase',
        color:         C.textMuted,
        mb:            '8px',
        display:       'flex',
        alignItems:    'center',
        gap:           '6px',
      }}
    >
      <span style={{ color: C.textDim }}>[</span>
      {children}
      <span style={{ color: C.textDim }}>]</span>
    </Typography>
  );
}

function SectionTitle({ children }) {
  return (
    <Typography
      component="h2"
      sx={{
        fontFamily:    BARLOW,
        fontSize:      { xs: '1.5rem', md: '2rem' },
        letterSpacing: '4px',
        textTransform: 'uppercase',
        color:         C.textPrimary,
        mb:            { xs: 3, md: 5 },
        textShadow:    `0 0 20px rgba(0,217,255,0.2)`,
      }}
    >
      {children}
    </Typography>
  );
}

function HeroCounter({ lang }) {
  const ref = useRef(null);
  const visible = useInView(ref);
  const count = useCounter(26000, 2000, visible);
  return (
    <Box ref={ref} sx={{ textAlign:'center' }}>
      <Typography sx={{ fontFamily:MONO, fontSize:'2.5rem', fontWeight:700, color:C.accent, animation: visible ? 'numberGlow 2s ease' : 'none' }}>
        {count.toLocaleString()}+
      </Typography>
      <Typography sx={{ fontFamily:MONO, fontSize:'0.65rem', color:C.textMuted, letterSpacing:'4px', textTransform:'uppercase', mt:'8px' }}>
        {lang === 'es' ? 'VARIABLES STATCAST ANALIZADAS EN TIEMPO REAL' : 'STATCAST VARIABLES ANALYZED IN REAL-TIME'}
      </Typography>
      <Box sx={{ width:'100%', maxWidth:'300px', height:'1px', bgcolor:C.accent, mx:'auto', mt:'16px', animation: visible ? 'expandLine 1s ease forwards' : 'none' }} />
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MethodologyPage({ lang = 'en', onBack, onToggleLang }) {
  const t = COPY[lang] ?? COPY.en;
  const [activeLevel, setActiveLevel] = useState(0);

  return (
    <Box
      sx={{
        minHeight:       '100vh',
        width:           '100%',
        backgroundColor: '#000000',
        display:         'flex',
        flexDirection:   'column',
        position:        'relative',
        overflow:        'hidden',
        zIndex:          0,
      }}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} style={{
          position:'absolute',
          width: 2, height: 2,
          borderRadius: '50%',
          background: 'rgba(0,217,255,0.06)',
          left: `${(i * 8.3) % 100}%`,
          top: `${(i * 13.7 + 5) % 90}%`,
          animation: `float ${6 + (i % 4)}s ease-in-out infinite ${i * 0.5}s`,
          pointerEvents: 'none',
        }} />
      ))}
      <style>{METHODOLOGY_CSS}</style>
      {/* ── Minimal top bar ── */}
      <Box
        component="header"
        sx={{
          position:        'sticky',
          top:             0,
          zIndex:          1000,
          bgcolor:         'rgba(0,0,0,0.97)',
          backdropFilter:  'blur(8px)',
          borderBottom:    `1px solid ${C.cyanLine}`,
          boxShadow:       `0 1px 0 rgba(0,217,255,0.08)`,
          display:         'flex',
          alignItems:      'center',
          px:              { xs: 2, sm: 3 },
          py:              '10px',
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
            px:            '12px',
            py:            '6px',
            border:        `1px solid ${C.cyanLine}`,
            borderRadius:  0,
            bgcolor:       'transparent',
            color:         C.textMuted,
            fontFamily:    MONO,
            fontSize:      '0.65rem',
            letterSpacing: '2px',
            textTransform: 'uppercase',
            cursor:        'pointer',
            flexShrink:    0,
            transition:    'all 0.15s',
            '&:hover':     { color: C.cyan, borderColor: C.cyan, boxShadow: C.cyanGlow },
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
              background:    C.cyanDim,
              border:        `1px solid ${C.cyanLine}`,
              color:         C.cyan,
              minWidth:      '122px',
              padding:       '8px 18px',
              borderRadius:  0,
              fontFamily:    MONO,
              fontSize:      '0.72rem',
              letterSpacing: '1px',
              cursor:        'pointer',
              flexShrink:    0,
              transition:    'all 0.15s',
              '&:hover':     { boxShadow: C.cyanGlow },
            }}
          >
            {lang === 'es' ? 'English' : 'Español'}
          </Box>
        )}
      </Box>

      {/* ── Hero ── */}
      <Box
        sx={{
          background:  C.bg,
          borderBottom:`1px solid ${C.cyanLine}`,
          py:          { xs: 8, md: 12 },
          px:          { xs: 2, sm: 3 },
          textAlign:   'center',
        }}
      >
        {/* Terminal boot prefix */}
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      '0.6rem',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            color:         C.textMuted,
            mb:            '10px',
          }}
        >
          // H.E.X.A._SYSTEM_DOCS · ANALYTICAL_FRAMEWORK_v4
        </Typography>

        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      '0.65rem',
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color:         C.cyan,
            mb:            '20px',
            textShadow:    C.cyanGlow,
          }}
        >
          {t.heroEyebrow}
        </Typography>

        <Typography
          component="h1"
          sx={{
            fontFamily:    BARLOW,
            fontSize:      { xs: '2.2rem', sm: '3.2rem', md: '4rem' },
            letterSpacing: '6px',
            textTransform: 'uppercase',
            lineHeight:    1,
            color:         C.textPrimary,
            mb:            '24px',
            textShadow:    `0 0 30px rgba(0,217,255,0.15)`,
          }}
        >
          {t.heroTitle}
        </Typography>

        <Typography
          sx={{
            fontFamily: MONO,
            fontSize:   { xs: '0.78rem', md: '0.85rem' },
            color:      C.textMuted,
            lineHeight: 1.8,
            maxWidth:   600,
            mx:         'auto',
          }}
        >
          {t.heroSub}
        </Typography>
        <Box sx={{ mt: '40px' }}>
          <HeroCounter lang={lang} />
        </Box>
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
          {t.pillars.map((p, i) => (
            <AnimatedSection key={p.label} delay={i * 0.1}>
              <PillarCard icon={p.icon} label={p.label} body={p.body} />
            </AnimatedSection>
          ))}
        </Box>
      </Section>

      {/* ── Divider ── */}
      <Box sx={{ borderTop: `1px solid ${C.border}` }} />

      {/* ── Signal Hierarchy ── */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '6rem 2rem' }}>
        <div style={{ marginBottom: '0.75rem', fontFamily: GM, fontSize: '0.6rem', letterSpacing: 4, textTransform: 'uppercase', color: GC.textMuted }}>
          <span style={{ color: GC.textDim }}>[ </span>{lang === 'es' ? '02 — JERARQUÍA DE SEÑALES' : '02 — SIGNAL HIERARCHY'}<span style={{ color: GC.textDim }}> ]</span>
        </div>
        <h2 style={{ fontFamily: GB, fontSize: 'clamp(1.5rem, 4vw, 2.4rem)', color: GC.textPrimary, letterSpacing: 4, textTransform: 'uppercase', lineHeight: 1.1, marginBottom: '1rem', textShadow: '0 0 20px rgba(0,217,255,0.15)' }}>
          {lang === 'es' ? <>Cuando los datos se contradicen,<br/>H.E.X.A. sabe cuál manda.</> : <>When data conflicts,<br/>H.E.X.A. knows which signal wins.</>}
        </h2>
        <p style={{ fontFamily: GM, fontSize: '0.8rem', lineHeight: 1.8, color: GC.textMuted, maxWidth: 600, marginBottom: '3rem' }}>
          {lang === 'es' ? 'No todas las señales pesan igual. Este es el orden de prioridad que resuelve conflictos entre datos.' : 'Not all signals carry equal weight. This is the priority order that resolves data conflicts.'}
        </p>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 280px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SIGNAL_HIERARCHY.map((h, i) => (
              <AnimatedSection key={i} delay={i * 0.1}>
              <div onClick={() => setActiveLevel(i)} style={{
                display: 'flex', alignItems: 'center', gap: '1rem', padding: '10px 14px',
                borderRadius: 0, cursor: 'pointer',
                border: `1px solid ${activeLevel === i ? GC.accentLine : 'transparent'}`,
                background: activeLevel === i ? GC.accentDim : 'transparent',
                transition: 'all 0.2s ease',
              }}>
                <span style={{ fontFamily: GM, fontSize: '1rem', color: activeLevel === i ? GC.accent : GC.textMuted, minWidth: 30, transition: 'color 0.2s', textShadow: activeLevel === i ? `0 0 8px ${GC.accent}88` : 'none' }}>{h.level}</span>
                <span style={{ fontFamily: GB, fontSize: '0.78rem', letterSpacing: 2, textTransform: 'uppercase', color: activeLevel === i ? GC.textPrimary : GC.textMuted, transition: 'color 0.2s' }}>{h.name}</span>
              </div>
              </AnimatedSection>
            ))}
          </div>
          <div style={{ flex: 1, background: GC.surface, border: `1px solid ${GC.cyanLine}`, borderRadius: 0, padding: '2.5rem', position: 'relative', overflow: 'hidden', minHeight: 240, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 280 }}>
            {/* Top-left corner bracket */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: 14, height: 14, borderTop: `2px solid ${GC.cyan}`, borderLeft: `2px solid ${GC.cyan}` }} />
            {/* Left neon accent bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: 2, height: '100%', background: `linear-gradient(${GC.accent}, transparent)` }} />
            <div style={{ fontFamily: GM, fontSize: '0.6rem', letterSpacing: 3, textTransform: 'uppercase', color: GC.accent, marginBottom: '0.75rem' }}>
              {lang === 'es' ? 'PRIORIDAD' : 'PRIORITY'} {SIGNAL_HIERARCHY[activeLevel].level}
            </div>
            <div style={{ fontFamily: GB, fontSize: '1.6rem', letterSpacing: 3, textTransform: 'uppercase', color: GC.textPrimary, marginBottom: '1rem' }}>
              {SIGNAL_HIERARCHY[activeLevel].name}
            </div>
            <p style={{ fontFamily: GM, fontSize: '0.78rem', lineHeight: 1.8, color: GC.textMuted, maxWidth: 480 }}>
              {lang === 'es' ? SIGNAL_HIERARCHY[activeLevel].desc : SIGNAL_HIERARCHY[activeLevel].descEn}
            </p>
            <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, height: 3, background: GC.cyanDim, borderRadius: 0, overflow: 'hidden', maxWidth: 200 }}>
                <div style={{ height: '100%', width: `${SIGNAL_HIERARCHY[activeLevel].weight}%`, background: GC.accent, boxShadow: `0 0 8px ${GC.accent}88`, transition: 'width 0.5s ease' }} />
              </div>
              <span style={{ fontFamily: GM, fontSize: '0.65rem', color: GC.textMuted, letterSpacing: 2 }}>
                {lang === 'es' ? 'PESO_REL' : 'REL_WEIGHT'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Divider ── */}
      <Box sx={{ borderTop: `1px solid ${C.border}` }} />

      {/* ── Data Integrity ── */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '6rem 2rem' }}>
        <div style={{ marginBottom: '0.75rem', fontFamily: GM, fontSize: '0.6rem', letterSpacing: 4, textTransform: 'uppercase', color: GC.textMuted }}>
          <span style={{ color: GC.textDim }}>[ </span>{lang === 'es' ? '03 — INTEGRIDAD DE DATOS' : '03 — DATA INTEGRITY'}<span style={{ color: GC.textDim }}> ]</span>
        </div>
        <h2 style={{ fontFamily: GB, fontSize: 'clamp(1.5rem, 4vw, 2.4rem)', color: GC.textPrimary, letterSpacing: 4, textTransform: 'uppercase', lineHeight: 1.1, marginBottom: '1rem', textShadow: '0 0 20px rgba(0,217,255,0.15)' }}>
          {lang === 'es' ? <>Si los datos son incompletos,<br/>la confianza baja. Siempre.</> : <>If data is incomplete,<br/>confidence drops. Always.</>}
        </h2>
        <p style={{ fontFamily: GM, fontSize: '0.8rem', lineHeight: 1.8, color: GC.textMuted, maxWidth: 600, marginBottom: '3rem' }}>
          {lang === 'es'
            ? 'Antes de cada análisis, H.E.X.A. calcula un score de calidad de datos (0-100) que determina qué tipos de apuesta están disponibles y cuánto se penaliza la confianza. Sin teatro.'
            : 'Before every analysis, H.E.X.A. calculates a data quality score (0-100) that determines which bet types are available and how much confidence is penalized. No theater.'}
        </p>
        <div style={{ background: GC.surface, border: `1px solid ${GC.cyanLine}`, borderRadius: 0, padding: '2rem', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 14, height: 14, borderTop: `2px solid ${GC.cyan}`, borderLeft: `2px solid ${GC.cyan}` }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 1, background: GC.cyanLine, overflow: 'hidden' }}>
            {/* FULL */}
            <div style={{ background: GC.bg, padding: '1.5rem', textAlign: 'center', borderRight: `1px solid ${GC.cyanLine}` }}>
              <div style={{ fontFamily: GM, fontSize: '1.6rem', color: GC.green, marginBottom: '0.5rem', textShadow: `0 0 12px ${GC.green}66` }}>80-100</div>
              <div style={{ fontFamily: GM, fontSize: '0.6rem', letterSpacing: 3, textTransform: 'uppercase', color: GC.textMuted, marginBottom: '0.75rem' }}>
                {lang === 'es' ? 'ANÁLISIS_COMPLETO' : 'FULL_ANALYSIS'}
              </div>
              <p style={{ fontFamily: GM, fontSize: '0.72rem', lineHeight: 1.6, color: GC.textMuted }}>
                {lang === 'es'
                  ? 'Todos los datos disponibles. Todos los tipos de apuesta habilitados. Máxima confianza.'
                  : 'All data available. All bet types enabled. Maximum confidence.'}
              </p>
            </div>
            {/* STANDARD */}
            <div style={{ background: GC.bg, padding: '1.5rem', textAlign: 'center', borderRight: `1px solid ${GC.cyanLine}` }}>
              <div style={{ fontFamily: GM, fontSize: '1.6rem', color: GC.cyan, marginBottom: '0.5rem', textShadow: `0 0 12px ${GC.cyan}66` }}>60-79</div>
              <div style={{ fontFamily: GM, fontSize: '0.6rem', letterSpacing: 3, textTransform: 'uppercase', color: GC.textMuted, marginBottom: '0.75rem' }}>
                {lang === 'es' ? 'ANÁLISIS_ESTÁNDAR' : 'STANDARD_ANALYSIS'}
              </div>
              <p style={{ fontFamily: GM, fontSize: '0.72rem', lineHeight: 1.6, color: GC.textMuted }}>
                {lang === 'es'
                  ? 'Props solo con datos Statcast confirmados del jugador. Confianza ajustada.'
                  : 'Props only with confirmed player Statcast data. Adjusted confidence.'}
              </p>
            </div>
            {/* LIMITED */}
            <div style={{ background: GC.bg, padding: '1.5rem', textAlign: 'center', borderRight: `1px solid ${GC.cyanLine}` }}>
              <div style={{ fontFamily: GM, fontSize: '1.6rem', color: GC.accent, marginBottom: '0.5rem', textShadow: `0 0 12px ${GC.accent}66` }}>40-59</div>
              <div style={{ fontFamily: GM, fontSize: '0.6rem', letterSpacing: 3, textTransform: 'uppercase', color: GC.textMuted, marginBottom: '0.75rem' }}>
                {lang === 'es' ? 'ANÁLISIS_LIMITADO' : 'LIMITED_ANALYSIS'}
              </div>
              <p style={{ fontFamily: GM, fontSize: '0.72rem', lineHeight: 1.6, color: GC.textMuted }}>
                {lang === 'es'
                  ? 'Solo Moneyline y Over/Under. Confianza penalizada -15%. Riesgo elevado.'
                  : 'Moneyline and Over/Under only. Confidence penalized -15%. Elevated risk.'}
              </p>
            </div>
            {/* MINIMAL */}
            <div style={{ background: GC.bg, padding: '1.5rem', textAlign: 'center' }}>
              <div style={{ fontFamily: GM, fontSize: '1.6rem', color: GC.red, marginBottom: '0.5rem', textShadow: `0 0 12px ${GC.red}66` }}>0-39</div>
              <div style={{ fontFamily: GM, fontSize: '0.6rem', letterSpacing: 3, textTransform: 'uppercase', color: GC.textMuted, marginBottom: '0.75rem' }}>
                {lang === 'es' ? 'ANÁLISIS_MÍNIMO' : 'MINIMAL_ANALYSIS'}
              </div>
              <p style={{ fontFamily: GM, fontSize: '0.72rem', lineHeight: 1.6, color: GC.textMuted }}>
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
            <AnimatedSection key={step.num} delay={i * 0.1}>
              <ProcessStep
                num={step.num}
                label={step.label}
                body={step.body}
                isLast={i === t.steps.length - 1}
              />
            </AnimatedSection>
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
            border:       `1px solid ${C.cyanLine}`,
            borderRadius: 0,
            bgcolor:      C.bgCard,
            px:           3,
            maxWidth:     640,
            position:     'relative',
            transition:   'transform 0.2s, box-shadow 0.2s',
            cursor:       'pointer',
            '&:hover':    { transform: 'translateY(-3px)', boxShadow: `0 4px 20px rgba(0,217,255,0.1)` },
            '&::before': {
              content:   '""',
              position:  'absolute',
              top: 0, left: 0,
              width: '10px', height: '10px',
              borderTop:  `1px solid ${C.cyan}`,
              borderLeft: `1px solid ${C.cyan}`,
            },
          }}
        >
          {t.edges.map((e, i) => (
            <AnimatedSection key={e.label} delay={i * 0.1}>
              <EdgeItem label={e.label} body={e.body} />
            </AnimatedSection>
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
            fontFamily: MONO,
            fontSize:   '0.72rem',
            color:      C.textDim,
            lineHeight: 1.7,
            maxWidth:   560,
            mx:         'auto',
            mb:         3,
            border:     `1px solid ${C.cyanLine}`,
            px:         '16px', py: '12px',
            position:   'relative',
            '&::before': {
              content: '""', position: 'absolute', top: 0, left: 0,
              width: '8px', height: '8px',
              borderTop: `1px solid ${C.cyan}`, borderLeft: `1px solid ${C.cyan}`,
            },
          }}
        >
          {t.disclaimer}
        </Typography>
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      '0.6rem',
            color:         C.textDim,
            letterSpacing: '2px',
            textTransform: 'uppercase',
          }}
        >
          {t.footerLine}
        </Typography>
      </Box>
    </Box>
  );
}
