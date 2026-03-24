/**
 * TerminalGuide.jsx
 * Interactive user manual — Bloomberg Terminal aesthetic.
 *
 * Props:
 *   open    — boolean
 *   onClose — () => void
 *   lang    — 'en' | 'es'
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, BARLOW, MONO, SANS } from '../theme';

// ── Content data ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'oracle',    en: '1. The Oracle',          es: '1. The Oracle'            },
  { id: 'safepick',  en: '2. Safe Pick Mode',       es: '2. Safe Pick Mode'        },
  { id: 'flags',     en: '3. Alert Flags',           es: '3. Alert Flags'           },
  { id: 'bankroll',  en: '4. Bankroll Management',   es: '4. Gestión de Bankroll'   },
];

const CONTENT = {
  oracle: {
    en: {
      title: 'THE ORACLE',
      subtitle: 'Proprietary Algorithmic Engine',
      sections: [
        {
          heading: 'What is The Oracle?',
          body: `The Oracle is H.E.X.A.'s core processing system — a proprietary algorithmic engine that ingests and cross-references over 26,000 Statcast variables in real time. Built on advanced statistical modeling, it converts raw baseball data into quantified edges and actionable probability signals.`,
        },
        {
          heading: 'Standard Mode',
          body: `Standard Mode delivers rapid analysis by processing the most impactful Statcast variables: exit velocity, xFIP, barrel rate, BABIP, sprint speed, park factors, and current-season weighted metrics. Results are returned in seconds, giving you a sharp, data-driven read on any matchup.`,
        },
        {
          heading: 'Deep Analytics Mode  ·  PREMIUM',
          body: `Deep Analytics Mode unlocks the full power of the Advanced Processing System. It runs multi-layer cross-referencing across historical databases, situational splits (day/night, L/R, home/away), pitcher fatigue curves, lineup construction patterns, umpire tendencies, and weather-adjusted trajectory models. This mode is reserved for Premium users and provides the highest-confidence output the system can generate.`,
          highlight: true,
        },
        {
          heading: 'Data Sources',
          body: `All analysis is grounded in data from MLB Statcast, the Baseball Savant API, and real-time odds feeds. No guesswork — every signal is traceable to a verifiable statistical source.`,
        },
      ],
    },
    es: {
      title: 'THE ORACLE',
      subtitle: 'Motor Algorítmico Propietario',
      sections: [
        {
          heading: '¿Qué es The Oracle?',
          body: `The Oracle es el sistema central de procesamiento de H.E.X.A. — un motor algorítmico propietario que ingiere y cruza más de 26,000 variables de Statcast en tiempo real. Construido sobre modelos estadísticos avanzados, convierte datos crudos de béisbol en ventajas cuantificadas y señales de probabilidad accionables.`,
        },
        {
          heading: 'Standard Mode',
          body: `El Modo Estándar entrega análisis rápidos procesando las variables Statcast de mayor impacto: velocidad de salida, xFIP, tasa de barril, BABIP, velocidad de carrera, factores de estadio y métricas ponderadas de la temporada actual. Los resultados se generan en segundos, brindando una lectura precisa y basada en datos de cualquier enfrentamiento.`,
        },
        {
          heading: 'Deep Analytics Mode  ·  PREMIUM',
          body: `El Modo Deep Analytics desbloquea la potencia completa del Sistema de Procesamiento Avanzado. Ejecuta cruces multicapa sobre bases de datos históricas, splits situacionales (día/noche, L/D, local/visitante), curvas de fatiga del lanzador, patrones de construcción de alineación, tendencias de árbitros y modelos de trayectoria ajustados al clima. Este modo es exclusivo para usuarios Premium y genera el output de mayor confianza que el sistema puede producir.`,
          highlight: true,
        },
        {
          heading: 'Fuentes de Datos',
          body: `Todo análisis está respaldado por datos de MLB Statcast, la API de Baseball Savant y feeds de momios en tiempo real. Sin conjeturas — cada señal es rastreable a una fuente estadística verificable.`,
        },
      ],
    },
  },

  safepick: {
    en: {
      title: 'SAFE PICK MODE',
      subtitle: '2-Credit Full-Market Scan',
      sections: [
        {
          heading: 'How it works',
          body: `Safe Pick Mode costs 2 credits and triggers a simultaneous scan across all available betting markets for a selected game. The algorithm does not guess — it calculates.`,
        },
        {
          heading: 'Markets Analyzed',
          body: `The system evaluates four market dimensions in parallel:\n\n• Moneyline — outright winner probability vs. implied odds\n• Run Line (±1.5) — spread-adjusted edge calculation\n• Over/Under — total runs model vs. posted totals\n• Player Props — stat projection vs. prop line variance`,
        },
        {
          heading: 'Expected Value Engine',
          body: `After scanning all four markets, the system applies the Expected Value formula (EV+) to each candidate:\n\nEV = (Win% × Net Profit) − (Loss% × Stake)\n\nThe market with the highest positive EV is returned as the Safe Pick. This is not a preference — it is the mathematically optimal selection given current conditions.`,
          highlight: true,
        },
        {
          heading: 'When to use Safe Pick',
          body: `Use Safe Pick Mode when you want a single, high-confidence recommendation without manually evaluating multiple markets. It is especially powerful for games with wide prop menus or inflated line movement where identifying true value is non-trivial.`,
        },
      ],
    },
    es: {
      title: 'SAFE PICK MODE',
      subtitle: 'Escaneo Completo de Mercado — 2 Créditos',
      sections: [
        {
          heading: 'Cómo funciona',
          body: `El Safe Pick Mode cuesta 2 créditos y activa un escaneo simultáneo en todos los mercados de apuestas disponibles para un juego seleccionado. El algoritmo no adivina — calcula.`,
        },
        {
          heading: 'Mercados Analizados',
          body: `El sistema evalúa cuatro dimensiones de mercado en paralelo:\n\n• Moneyline — probabilidad de ganador vs. momios implícitos\n• Run Line (±1.5) — cálculo de ventaja ajustada al spread\n• Over/Under — modelo de carreras totales vs. totales publicados\n• Props de Jugadores — proyección estadística vs. varianza de línea de prop`,
        },
        {
          heading: 'Motor de Valor Esperado',
          body: `Tras escanear los cuatro mercados, el sistema aplica la fórmula de Valor Esperado (EV+) a cada candidato:\n\nEV = (% Victoria × Ganancia Neta) − (% Derrota × Apuesta)\n\nEl mercado con el EV positivo más alto se devuelve como el Safe Pick. No es una preferencia — es la selección matemáticamente óptima dadas las condiciones actuales.`,
          highlight: true,
        },
        {
          heading: 'Cuándo usar Safe Pick',
          body: `Usa el Safe Pick Mode cuando quieras una recomendación única de alta confianza sin evaluar manualmente múltiples mercados. Es especialmente poderoso para juegos con menús de props amplios o movimiento de línea inflado donde identificar valor real no es trivial.`,
        },
      ],
    },
  },

  flags: {
    en: {
      title: 'ALERT FLAGS',
      subtitle: 'Signal Classification System',
      sections: [
        {
          heading: 'Overview',
          body: `The Advanced Processing System does not output raw probabilities alone — it overlays a three-tier flag system to communicate signal quality, risk level, and confidence grade in a format that is immediately actionable.`,
        },
        {
          heading: '🔴  Red Flags — Danger / Regression Signal',
          body: `Red Flags indicate one of two conditions:\n\n1. Statistical Regression Risk — a player or team is performing significantly above or below their established baseline, suggesting mean reversion is imminent.\n\n2. Imminent Danger — a structural disadvantage exists in the matchup (e.g., extreme pitcher/batter split, severe fatigue marker, adverse park factor alignment) that materially reduces the probability of the expected outcome.`,
          flagColor: C.red,
        },
        {
          heading: '🟡  Amber Flags — Caution / Volatility',
          body: `Amber Flags signal elevated uncertainty in the model's projection. Common triggers include:\n\n• High variance in recent sample window\n• Conflicting signals across data sources\n• Weather conditions with meaningful run-environment impact\n• Lineup volatility (late scratches, unexpected batting order changes)\n\nAmber Flags do not invalidate a pick — they indicate that position sizing should be conservative.`,
          flagColor: C.amber,
          highlight: false,
        },
        {
          heading: '🟢  Green Flags — Elite Signal / Clear Edge',
          body: `Green Flags are the system's highest-confidence markers. They fire when multiple independent data streams converge on the same conclusion:\n\n• Strong xStats alignment with actual performance\n• Favorable platoon and park factor stacking\n• Sharp money movement in the same direction\n• Historical precedent supporting the projected outcome\n\nGreen Flags represent the clearest edges the system identifies.`,
          flagColor: C.green,
          highlight: true,
        },
      ],
    },
    es: {
      title: 'ALERT FLAGS',
      subtitle: 'Sistema de Clasificación de Señales',
      sections: [
        {
          heading: 'Visión General',
          body: `El Sistema de Procesamiento Avanzado no genera solo probabilidades brutas — superpone un sistema de banderas de tres niveles para comunicar calidad de señal, nivel de riesgo y grado de confianza en un formato inmediatamente accionable.`,
        },
        {
          heading: '🔴  Banderas Rojas — Peligro / Señal de Regresión',
          body: `Las Banderas Rojas indican una de dos condiciones:\n\n1. Riesgo de Regresión Estadística — un jugador o equipo está rindiendo significativamente por encima o por debajo de su línea base establecida, sugiriendo que la regresión a la media es inminente.\n\n2. Peligro Inminente — existe una desventaja estructural en el enfrentamiento (ej. split extremo lanzador/bateador, marcador severo de fatiga, alineación adversa de factor de estadio) que reduce materialmente la probabilidad del resultado esperado.`,
          flagColor: C.red,
        },
        {
          heading: '🟡  Banderas Ámbar — Precaución / Volatilidad',
          body: `Las Banderas Ámbar señalan incertidumbre elevada en la proyección del modelo. Disparadores comunes incluyen:\n\n• Alta varianza en la ventana de muestra reciente\n• Señales conflictivas entre fuentes de datos\n• Condiciones climáticas con impacto significativo en el entorno de carreras\n• Volatilidad en la alineación (bajas de último momento, cambios inesperados en el orden al bate)\n\nLas Banderas Ámbar no invalidan un pick — indican que el tamaño de posición debe ser conservador.`,
          flagColor: C.amber,
        },
        {
          heading: '🟢  Banderas Verdes — Señal Élite / Ventaja Clara',
          body: `Las Banderas Verdes son los marcadores de mayor confianza del sistema. Se activan cuando múltiples flujos de datos independientes convergen en la misma conclusión:\n\n• Fuerte alineación de xStats con rendimiento real\n• Apilamiento favorable de platoon y factor de estadio\n• Movimiento de dinero inteligente en la misma dirección\n• Precedente histórico que respalda el resultado proyectado\n\nLas Banderas Verdes representan las ventajas más claras que el sistema identifica.`,
          flagColor: C.green,
          highlight: true,
        },
      ],
    },
  },

  bankroll: {
    en: {
      title: 'BANKROLL MANAGEMENT',
      subtitle: 'Kelly Criterion — Mathematical Stake Sizing',
      sections: [
        {
          heading: 'The Problem with Flat Betting',
          body: `Flat betting (wagering the same amount on every pick regardless of edge) is mathematically suboptimal. It ignores the most critical variable in long-term profitability: the size of your advantage on any given bet. H.E.X.A. addresses this directly.`,
        },
        {
          heading: 'The Kelly Criterion',
          body: `The system uses the Kelly Criterion — a mathematically derived formula for optimal bankroll allocation:\n\nf* = (bp − q) / b\n\nWhere:\n• f* = fraction of bankroll to wager\n• b  = net odds received (decimal odds − 1)\n• p  = estimated probability of winning\n• q  = probability of losing (1 − p)\n\nThe formula maximizes the logarithmic growth rate of your bankroll over time, which is equivalent to maximizing long-run wealth without risking ruin.`,
          highlight: true,
          mono: true,
        },
        {
          heading: 'How H.E.X.A. Applies It',
          body: `After generating its probability estimate for a given pick, the system feeds that estimate — alongside the current market odds — into the Kelly formula. The output is an exact recommended stake percentage based on the calculated edge.\n\nFor example: if the system assigns 58% win probability to a pick priced at -110 (implied 52.4%), the Kelly output will reflect that 5.6% edge with a specific, proportional stake recommendation.`,
        },
        {
          heading: 'Fractional Kelly',
          body: `H.E.X.A. applies a Fractional Kelly multiplier (typically 0.25×–0.5×) to the raw output. This reduces variance and protects against model uncertainty while preserving the edge-proportional sizing logic. It is the industry-standard approach used by professional sports bettors and quantitative traders alike.`,
        },
        {
          heading: 'Discipline is the Edge',
          body: `The Bankroll Management module is only as effective as your commitment to following it. The Kelly Criterion assumes consistent application across a large sample. Deviating from the suggested sizing — either by over-betting winners or under-betting high-edge picks — erodes the mathematical advantage the system provides.`,
        },
      ],
    },
    es: {
      title: 'GESTIÓN DE BANKROLL',
      subtitle: 'Criterio de Kelly — Dimensionamiento Matemático de Apuesta',
      sections: [
        {
          heading: 'El Problema con las Apuestas Planas',
          body: `Las apuestas planas (apostar la misma cantidad en cada pick independientemente de la ventaja) son matemáticamente subóptimas. Ignoran la variable más crítica en la rentabilidad a largo plazo: el tamaño de tu ventaja en cada apuesta. H.E.X.A. aborda esto directamente.`,
        },
        {
          heading: 'El Criterio de Kelly',
          body: `El sistema utiliza el Criterio de Kelly — una fórmula derivada matemáticamente para la asignación óptima del bankroll:\n\nf* = (bp − q) / b\n\nDonde:\n• f* = fracción del bankroll a apostar\n• b  = momios netos recibidos (momios decimales − 1)\n• p  = probabilidad estimada de victoria\n• q  = probabilidad de derrota (1 − p)\n\nLa fórmula maximiza la tasa de crecimiento logarítmico de tu bankroll en el tiempo, equivalente a maximizar la riqueza a largo plazo sin arriesgarte a la ruina.`,
          highlight: true,
          mono: true,
        },
        {
          heading: 'Cómo lo Aplica H.E.X.A.',
          body: `Tras generar su estimación de probabilidad para un pick determinado, el sistema introduce esa estimación — junto con los momios actuales del mercado — en la fórmula de Kelly. El resultado es un porcentaje exacto de apuesta recomendado basado en la ventaja calculada.\n\nPor ejemplo: si el sistema asigna 58% de probabilidad de victoria a un pick con precio de -110 (implícito 52.4%), el output de Kelly reflejará esa ventaja del 5.6% con una recomendación de apuesta específica y proporcional.`,
        },
        {
          heading: 'Kelly Fraccional',
          body: `H.E.X.A. aplica un multiplicador de Kelly Fraccional (típicamente 0.25×–0.5×) al output bruto. Esto reduce la varianza y protege contra la incertidumbre del modelo mientras preserva la lógica de dimensionamiento proporcional a la ventaja. Es el enfoque estándar de la industria utilizado por apostadores deportivos profesionales y traders cuantitativos por igual.`,
        },
        {
          heading: 'La Disciplina es la Ventaja',
          body: `El módulo de Gestión de Bankroll solo es efectivo en la medida en que te comprometas a seguirlo. El Criterio de Kelly asume aplicación consistente a lo largo de una muestra grande. Desviarse del dimensionamiento sugerido — ya sea apostando de más en ganadores o apostando de menos en picks de alta ventaja — erosiona la ventaja matemática que el sistema proporciona.`,
        },
      ],
    },
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SidebarTab({ tab, active, lang, onClick }) {
  const label = lang === 'es' ? tab.es : tab.en;
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        display:       'block',
        width:         '100%',
        textAlign:     'left',
        px:            '20px',
        py:            '14px',
        border:        'none',
        borderLeft:    active ? `2px solid ${C.accent}` : `2px solid transparent`,
        bgcolor:       active ? C.accentDim : 'transparent',
        color:         active ? C.accent : C.textTertiary,
        fontFamily:    MONO,
        fontSize:      '0.68rem',
        fontWeight:    active ? 700 : 400,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor:        'pointer',
        transition:    'all 0.15s',
        whiteSpace:    'nowrap',
        lineHeight:    1.4,
        '&:hover': {
          bgcolor: active ? C.accentDim : 'rgba(255,255,255,0.03)',
          color:   active ? C.accent : C.textSecondary,
        },
      }}
    >
      {label}
    </Box>
  );
}

function Section({ heading, body, highlight, mono, flagColor }) {
  const borderColor = flagColor ?? (highlight ? C.accentLine : C.border);
  const bgColor     = flagColor
    ? `${flagColor}0d`
    : highlight
    ? C.accentDim
    : 'transparent';

  // Format body: replace \n\n with double breaks, \n with single
  const paragraphs = body.split('\n\n');

  return (
    <Box
      sx={{
        mb:           '28px',
        pb:           '28px',
        borderBottom: `1px solid ${C.border}`,
        '&:last-child': { borderBottom: 'none', mb: 0, pb: 0 },
      }}
    >
      {/* Heading */}
      <Typography
        sx={{
          fontFamily:    MONO,
          fontSize:      '0.65rem',
          fontWeight:    700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color:         flagColor ?? (highlight ? C.accent : C.textTertiary),
          mb:            '12px',
        }}
      >
        {heading}
      </Typography>

      {/* Body */}
      <Box
        sx={{
          p:            highlight || flagColor ? '16px' : 0,
          border:       highlight || flagColor ? `1px solid ${borderColor}` : 'none',
          borderRadius: '3px',
          bgcolor:      bgColor,
        }}
      >
        {paragraphs.map((para, i) => {
          // Render bullet lines
          const lines = para.split('\n');
          return (
            <Box key={i} sx={{ mb: i < paragraphs.length - 1 ? '12px' : 0 }}>
              {lines.map((line, j) => (
                <Typography
                  key={j}
                  sx={{
                    fontFamily:  mono ? MONO : SANS,
                    fontSize:    mono ? '0.72rem' : '0.82rem',
                    lineHeight:  mono ? 1.9 : 1.75,
                    color:       C.textSecondary,
                    letterSpacing: mono ? '0.04em' : '0.01em',
                    mb:          line.startsWith('•') ? '4px' : 0,
                    pl:          line.startsWith('•') ? '4px' : 0,
                  }}
                >
                  {line}
                </Typography>
              ))}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function ContentArea({ tabId, lang }) {
  const data = CONTENT[tabId]?.[lang] ?? CONTENT[tabId]?.en;
  if (!data) return null;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Content header */}
      <Box
        sx={{
          px:           '32px',
          pt:           '28px',
          pb:           '20px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink:   0,
        }}
      >
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      '1.1rem',
            fontWeight:    700,
            letterSpacing: '0.15em',
            color:         C.textPrimary,
            mb:            '4px',
          }}
        >
          {data.title}
        </Typography>
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      '0.6rem',
            letterSpacing: '0.1em',
            color:         C.accent,
            textTransform: 'uppercase',
          }}
        >
          {data.subtitle}
        </Typography>
      </Box>

      {/* Scrollable body */}
      <Box
        sx={{
          flex:       1,
          overflowY:  'auto',
          px:         '32px',
          py:         '28px',
          scrollbarWidth: 'thin',
          scrollbarColor: `${C.border} transparent`,
          '&::-webkit-scrollbar':       { width: '4px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: C.border, borderRadius: '2px' },
        }}
      >
        {data.sections.map((section, i) => (
          <Section key={i} {...section} />
        ))}
      </Box>
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function TerminalGuide({ open, onClose, lang = 'en' }) {
  const [activeTab, setActiveTab] = useState('oracle');

  if (!open) return null;

  return (
    /* Backdrop */
    <Box
      onClick={onClose}
      sx={{
        position:        'fixed',
        inset:           0,
        zIndex:          9000,
        bgcolor:         'rgba(0,0,0,0.75)',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        p:               { xs: '12px', sm: '24px' },
      }}
    >
      {/* Modal panel */}
      <Box
        onClick={e => e.stopPropagation()}
        sx={{
          width:        '100%',
          maxWidth:     '960px',
          height:       '80vh',
          maxHeight:    '700px',
          display:      'flex',
          flexDirection:'column',
          bgcolor:      C.bg,
          border:       `1px solid ${C.border}`,
          borderRadius: '4px',
          overflow:     'hidden',
          boxShadow:    '0 24px 80px rgba(0,0,0,0.8)',
        }}
      >
        {/* ── Top bar ── */}
        <Box
          sx={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            px:             '20px',
            py:             '10px',
            bgcolor:        C.surface,
            borderBottom:   `1px solid ${C.border}`,
            flexShrink:     0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Typography
              sx={{
                fontFamily:    MONO,
                fontSize:      '0.6rem',
                fontWeight:    700,
                letterSpacing: '0.18em',
                color:         C.accent,
                textTransform: 'uppercase',
              }}
            >
              H.E.X.A. TERMINAL
            </Typography>
            <Box sx={{ width: '1px', height: '12px', bgcolor: C.border }} />
            <Typography
              sx={{
                fontFamily:    MONO,
                fontSize:      '0.55rem',
                letterSpacing: '0.1em',
                color:         C.textMuted,
                textTransform: 'uppercase',
              }}
            >
              {lang === 'es' ? 'Guía Interactiva' : 'Interactive Guide'}
            </Typography>
          </Box>

          {/* Close button */}
          <Box
            component="button"
            onClick={onClose}
            sx={{
              display:        'inline-flex',
              alignItems:     'center',
              justifyContent: 'center',
              width:          '24px',
              height:         '24px',
              border:         `1px solid ${C.border}`,
              borderRadius:   '2px',
              bgcolor:        'transparent',
              color:          C.textMuted,
              fontFamily:     MONO,
              fontSize:       '0.7rem',
              cursor:         'pointer',
              transition:     'all 0.15s',
              '&:hover':      { color: C.textPrimary, borderColor: C.textTertiary, bgcolor: C.border },
            }}
          >
            ✕
          </Box>
        </Box>

        {/* ── Body: sidebar + content ── */}
        <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar */}
          <Box
            sx={{
              width:        { xs: '160px', sm: '220px' },
              flexShrink:   0,
              bgcolor:      C.surface,
              borderRight:  `1px solid ${C.border}`,
              overflowY:    'auto',
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
              pt:           '8px',
            }}
          >
            {/* Sidebar label */}
            <Typography
              sx={{
                fontFamily:    MONO,
                fontSize:      '0.5rem',
                letterSpacing: '0.14em',
                color:         C.textDim,
                textTransform: 'uppercase',
                px:            '20px',
                pb:            '10px',
                pt:            '4px',
              }}
            >
              {lang === 'es' ? 'Módulos' : 'Modules'}
            </Typography>

            {TABS.map(tab => (
              <SidebarTab
                key={tab.id}
                tab={tab}
                active={activeTab === tab.id}
                lang={lang}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}

            {/* Sidebar footer */}
            <Box
              sx={{
                px:         '20px',
                py:         '16px',
                mt:         'auto',
                borderTop:  `1px solid ${C.border}`,
                position:   'absolute',
                bottom:     0,
                left:       0,
                width:      { xs: '160px', sm: '220px' },
              }}
            >
              <Typography
                sx={{
                  fontFamily:    MONO,
                  fontSize:      '0.48rem',
                  letterSpacing: '0.08em',
                  color:         C.textGhost,
                  lineHeight:    1.6,
                }}
              >
                H.E.X.A. V4<br />
                {lang === 'es' ? 'Motor Algorítmico' : 'Algorithmic Engine'}<br />
                {lang === 'es' ? 'Propietario' : 'Proprietary System'}
              </Typography>
            </Box>
          </Box>

          {/* Content pane */}
          <Box sx={{ flex: 1, overflow: 'hidden', bgcolor: C.bg }}>
            <ContentArea tabId={activeTab} lang={lang} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
