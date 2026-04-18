/**
 * DevUIShowcase — /dev/ui
 *
 * Storybook-style demo for the premium component library. Lives at a stable
 * URL so the team can validate the design direction before it rolls into
 * production screens. Bilingual toggle included.
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { useHexaTheme } from '../themeProvider';
import { HeroCard, InsightCard, DataChip, EdgeBar } from '../components/premium';
import ThemeToggle from '../components/ThemeToggle';
import { staggerContainer } from '../motion';

const T = {
  en: {
    back:         '← Back to app',
    title:        'HEXA PREMIUM · UI LAB',
    subtitle:     'Component showcase — Phase 1 of the premium redesign',
    langToggle:   'ES',
    heroSection:     '01 · HERO CARD',
    heroHint:        'One dominant element per screen. Tap to fire the CTA.',
    heroEyebrow:     'TOP SIGNAL · TODAY',
    heroTitle:       'Take Dodgers ML',
    heroSub:         'Cy Young favorite on the mound vs a bullpen game. HEXA projects +8.4% edge.',
    heroMeta:        'UPDATED 2M AGO',
    heroCta:         'Open Analysis',
    insightSection:  '02 · INSIGHT CARDS',
    insightHint:     'Compact by default. Tap to drill into reasoning — siblings reflow smoothly.',
    insight1Label:   'HOT BAT',
    insight1Title:   'Aaron Judge · 12-game streak',
    insight1Sub:     '14 H in last 30 AB · .467 avg',
    insight2Label:   'BULLPEN RISK',
    insight2Title:   'Astros · 3rd bullpen game in 5 days',
    insight2Sub:     'ERA 5.8 over last 10 innings',
    insight3Label:   'COLD OFFENSE',
    insight3Title:   'Padres · 2.1 R/G last 7 days',
    insight3Sub:     'K rate spiked to 28.4%',
    drillTitle:      'Why HEXA flagged this',
    drillBody:       'Streak strength validated against BABIP regression. Judge\'s exit velocity last 7 days sits at 95.2 mph — top 3% in MLB. Matchup tomorrow vs LHP historically favorable (.318 vs LHP career).',
    chipsSection:    '03 · DATA CHIPS',
    chipsHint:       'Inline, dense, always tappable. Three variants share the same primitive.',
    chipsStats:      'STAT VARIANT',
    chipsFilters:    'FILTER VARIANT (tap to toggle)',
    chipsNav:        'NAV VARIANT (StatMuse-style explore)',
    edgeSection:     '04 · EDGE BAR',
    edgeHint:        'Animated reveal on mount. Pair with HeroCard verdict.',
  },
  es: {
    back:         '← Volver a la app',
    title:        'HEXA PREMIUM · LAB UI',
    subtitle:     'Vitrina de componentes — Fase 1 del rediseño premium',
    langToggle:   'EN',
    heroSection:     '01 · HERO CARD',
    heroHint:        'Un elemento dominante por pantalla. Toca para disparar el CTA.',
    heroEyebrow:     'SEÑAL TOP · HOY',
    heroTitle:       'Dodgers ML',
    heroSub:         'Cy Young en el montículo contra un bullpen game. HEXA proyecta +8.4% de edge.',
    heroMeta:        'ACTUALIZADO HACE 2M',
    heroCta:         'Abrir Análisis',
    insightSection:  '02 · INSIGHT CARDS',
    insightHint:     'Compacta por defecto. Toca para abrir el razonamiento — las hermanas reflowean suave.',
    insight1Label:   'BATE CALIENTE',
    insight1Title:   'Aaron Judge · racha de 12 juegos',
    insight1Sub:     '14 H en últimos 30 AB · .467 avg',
    insight2Label:   'RIESGO BULLPEN',
    insight2Title:   'Astros · 3er bullpen game en 5 días',
    insight2Sub:     'ERA 5.8 en últimos 10 innings',
    insight3Label:   'OFENSIVA FRÍA',
    insight3Title:   'Padres · 2.1 C/J últimos 7 días',
    insight3Sub:     'Tasa de K subió a 28.4%',
    drillTitle:      'Por qué HEXA lo marcó',
    drillBody:       'Fuerza de racha validada contra regresión BABIP. Velocidad de salida de Judge últimos 7 días: 95.2 mph — top 3% en MLB. Matchup mañana vs zurdo históricamente favorable (.318 vs LHP carrera).',
    chipsSection:    '03 · DATA CHIPS',
    chipsHint:       'Inline, densos, siempre tocables. Tres variantes comparten la misma primitiva.',
    chipsStats:      'VARIANTE STAT',
    chipsFilters:    'VARIANTE FILTER (toca para alternar)',
    chipsNav:        'VARIANTE NAV (explora tipo StatMuse)',
    edgeSection:     '04 · EDGE BAR',
    edgeHint:        'Reveal animado al aparecer. Se combina con el veredicto del HeroCard.',
  },
};

function SectionHeader({ label, hint }) {
  const { C, MONO, SCALE, SPACE } = useHexaTheme();
  return (
    <Box sx={{ mb: SPACE.md }}>
      <Typography
        sx={{
          fontFamily:    MONO,
          fontSize:      SCALE.label,
          color:         C.cyan,
          letterSpacing: '0.22em',
          fontWeight:    700,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Typography>
      <Typography sx={{ mt: '4px', fontFamily: MONO, fontSize: SCALE.micro, color: C.textMuted, letterSpacing: '0.1em' }}>
        {hint}
      </Typography>
    </Box>
  );
}

export default function DevUIShowcase() {
  const [lang, setLang] = useState(() => localStorage.getItem('hexa_lang') || 'es');
  const [expanded, setExpanded] = useState(null);
  const [filters, setFilters] = useState({ offense: true, pitching: false, bullpen: false, trends: false });
  const t = T[lang];
  const { C, MONO, DISPLAY, SCALE, SPACE } = useHexaTheme();

  const toggleLang = () => {
    const next = lang === 'es' ? 'en' : 'es';
    localStorage.setItem('hexa_lang', next);
    setLang(next);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.bg, color: C.textPrimary, pb: SPACE.xxl }}>
      {/* ── Top bar ── */}
      <Box
        sx={{
          position:     'sticky',
          top:          0,
          zIndex:       10,
          bgcolor:      C.bg,
          backdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${C.border}`,
          px:           { xs: SPACE.md, md: SPACE.lg },
          py:           SPACE.md,
          display:      'flex',
          alignItems:   'center',
          justifyContent:'space-between',
          gap:          SPACE.md,
          flexWrap:     'wrap',
        }}
      >
        <Box
          component="button"
          onClick={() => { window.location.href = '/'; }}
          sx={{
            fontFamily:   MONO,
            fontSize:     SCALE.label,
            color:        C.cyan,
            bgcolor:      'transparent',
            border:       `1px solid ${C.border}`,
            px:           SPACE.md,
            py:           '6px',
            cursor:       'pointer',
            letterSpacing:'0.14em',
            textTransform:'uppercase',
            '&:hover':    { borderColor: C.cyan, boxShadow: C.cyanGlow },
          }}
        >
          {t.back}
        </Box>

        <Box sx={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
          <Typography
            noWrap
            sx={{
              fontFamily:    DISPLAY,
              fontSize:      SCALE.title,
              fontWeight:    800,
              color:         C.accent,
              letterSpacing: '0.18em',
              textShadow:    C.accentGlow,
            }}
          >
            {t.title}
          </Typography>
          <Typography
            noWrap
            sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: C.textMuted, letterSpacing: '0.12em' }}
          >
            {t.subtitle}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <ThemeToggle lang={lang} layout="pill" />
          <Box
            component="button"
            onClick={toggleLang}
            sx={{
              fontFamily:   MONO,
              fontSize:     SCALE.label,
              color:        C.accent,
              bgcolor:      'transparent',
              border:       `1px solid ${C.accentLine}`,
              px:           SPACE.md,
              py:           '6px',
              cursor:       'pointer',
              letterSpacing:'0.14em',
              minWidth:     44,
              '&:hover':    { borderColor: C.accent, boxShadow: C.accentGlow },
            }}
          >
            {t.langToggle}
          </Box>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1100, mx: 'auto', px: { xs: SPACE.md, md: SPACE.lg }, pt: SPACE.xl, display: 'flex', flexDirection: 'column', gap: SPACE.xxl }}>

        {/* ── 01 · HERO CARD ── */}
        <Box>
          <SectionHeader label={t.heroSection} hint={t.heroHint} />
          <HeroCard
            intent="action"
            eyebrow={t.heroEyebrow}
            title={t.heroTitle}
            subtitle={t.heroSub}
            meta={t.heroMeta}
            cta={{ label: t.heroCta, onClick: () => alert('CTA clicked') }}
          >
            <EdgeBar percent={73} label={lang === 'es' ? 'CONFIANZA' : 'CONFIDENCE'} intent="action" />
          </HeroCard>
        </Box>

        {/* ── 02 · INSIGHT CARDS ── */}
        <Box>
          <SectionHeader label={t.insightSection} hint={t.insightHint} />
          <motion.div
            variants={staggerContainer(0.05)}
            initial="hidden"
            animate="visible"
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <InsightCard
              intent="success"
              label={t.insight1Label}
              title={t.insight1Title}
              subtitle={t.insight1Sub}
              value=".467"
              expanded={expanded === 1}
              onToggle={(open) => setExpanded(open ? 1 : null)}
            >
              <Typography sx={{ fontFamily: MONO, fontSize: SCALE.label, color: C.green, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, mb: SPACE.sm }}>
                {t.drillTitle}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: SCALE.body, color: C.textSecondary, lineHeight: 1.6 }}>
                {t.drillBody}
              </Typography>
            </InsightCard>

            <InsightCard
              intent="warn"
              label={t.insight2Label}
              title={t.insight2Title}
              subtitle={t.insight2Sub}
              value="5.8"
              expanded={expanded === 2}
              onToggle={(open) => setExpanded(open ? 2 : null)}
            >
              <Typography sx={{ fontFamily: MONO, fontSize: SCALE.body, color: C.textSecondary, lineHeight: 1.6 }}>
                {t.drillBody}
              </Typography>
            </InsightCard>

            <InsightCard
              intent="data"
              label={t.insight3Label}
              title={t.insight3Title}
              subtitle={t.insight3Sub}
              value="2.1"
              expanded={expanded === 3}
              onToggle={(open) => setExpanded(open ? 3 : null)}
            >
              <Typography sx={{ fontFamily: MONO, fontSize: SCALE.body, color: C.textSecondary, lineHeight: 1.6 }}>
                {t.drillBody}
              </Typography>
            </InsightCard>
          </motion.div>
        </Box>

        {/* ── 03 · DATA CHIPS ── */}
        <Box>
          <SectionHeader label={t.chipsSection} hint={t.chipsHint} />

          <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: C.textMuted, letterSpacing: '0.18em', mt: SPACE.md, mb: SPACE.sm, textTransform: 'uppercase' }}>
            {t.chipsStats}
          </Typography>
          <Box sx={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
            <DataChip label="ERA" value="3.24" intent="data" />
            <DataChip label="WHIP" value="1.08" intent="data" />
            <DataChip label="K/9" value="11.2" intent="success" />
            <DataChip label="HR/9" value="1.4" intent="warn" />
            <DataChip label="EDGE" value="+8.4%" intent="action" />
          </Box>

          <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: C.textMuted, letterSpacing: '0.18em', mt: SPACE.lg, mb: SPACE.sm, textTransform: 'uppercase' }}>
            {t.chipsFilters}
          </Typography>
          <Box sx={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
            {Object.entries(filters).map(([key, active]) => (
              <DataChip
                key={key}
                variant="filter"
                intent="action"
                value={key.toUpperCase()}
                active={active}
                onClick={() => setFilters((f) => ({ ...f, [key]: !f[key] }))}
              />
            ))}
          </Box>

          <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: C.textMuted, letterSpacing: '0.18em', mt: SPACE.lg, mb: SPACE.sm, textTransform: 'uppercase' }}>
            {t.chipsNav}
          </Typography>
          <Box sx={{ display: 'flex', gap: SPACE.sm, overflowX: 'auto', pb: SPACE.sm, '&::-webkit-scrollbar': { height: 4 } }}>
            <DataChip variant="nav" intent="data"    value="GAMES TODAY" onClick={() => {}} />
            <DataChip variant="nav" intent="success" value="HOT BATS"    onClick={() => {}} />
            <DataChip variant="nav" intent="action"  value="PITCHING"    onClick={() => {}} />
            <DataChip variant="nav" intent="warn"    value="BULLPEN"     onClick={() => {}} />
            <DataChip variant="nav" intent="data"    value="TRENDS"      onClick={() => {}} />
            <DataChip variant="nav" intent="success" value="STREAKS"     onClick={() => {}} />
          </Box>
        </Box>

        {/* ── 04 · EDGE BAR ── */}
        <Box>
          <SectionHeader label={t.edgeSection} hint={t.edgeHint} />
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
            <EdgeBar percent={38} label={lang === 'es' ? 'EDGE BAJO'    : 'LOW EDGE'}    intent="data" />
            <EdgeBar percent={62} label={lang === 'es' ? 'EDGE MEDIO'   : 'MID EDGE'}    intent="warn" />
            <EdgeBar percent={84} label={lang === 'es' ? 'EDGE ALTO'    : 'HIGH EDGE'}   intent="success" />
            <EdgeBar percent={94} label={lang === 'es' ? 'MAX CONFIANZA': 'MAX CONFIDENCE'} intent="action" />
          </Box>
        </Box>

      </Box>
    </Box>
  );
}
