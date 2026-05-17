/**
 * OracleLoadingOverlayLeague — broadcast-style analysis wait (League × Kinetic).
 * Distinct from Classic: no mascot scanline; live strip, phase pipeline, ticker.
 */

import { useState, useEffect, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { useHexaTheme } from '../themeProvider';
import { LOADING_MESSAGES_EN, LOADING_MESSAGES_ES } from './oracleLoadingMessages.js';

const MONO = "'JetBrains Mono', 'Share Tech Mono', monospace";
const DISPLAY = "'Oswald', 'Barlow Condensed', sans-serif";

const PHASES = [
  { id: 'statcast', en: 'STATCAST', es: 'STATCAST' },
  { id: 'lineups',  en: 'LINEUPS',  es: 'ALINEACIONES' },
  { id: 'odds',     en: 'ODDS',     es: 'MOMIOS' },
  { id: 'model',    en: 'MODEL',    es: 'MODELO' },
  { id: 'oracle',   en: 'ORACLE',   es: 'ORACLE' },
];

const TICKER_SNIPPETS = {
  en: ['STATCAST', 'LINEUPS', 'MARKET ODDS', 'SHADOW MODEL', 'ORACLE DEEP', 'EDGE SCAN'],
  es: ['STATCAST', 'ALINEACIONES', 'MOMIOS', 'MODELO SOMBRA', 'ORACLE DEEP', 'ESCANEO EDGE'],
};

const COPY = {
  en: {
    live:       'LIVE',
    stripMid:   'HEXA ORACLE',
    stripRight: 'ANALYSIS IN PROGRESS',
    deep:       'DEEP MODE',
    title1:     'GAME',
    title2:     'READ',
    subtitle:   'IN PROGRESS',
    footer:     'HEXA ORACLE · BROADCAST INTELLIGENCE',
    phaseDone:  'OK',
  },
  es: {
    live:       'EN VIVO',
    stripMid:   'HEXA ORACLE',
    stripRight: 'ANÁLISIS EN CURSO',
    deep:       'MODO DEEP',
    title1:     'LECTURA',
    title2:     'DE JORNADA',
    subtitle:   'EN CURSO',
    footer:     'HEXA ORACLE · INTELIGENCIA BROADCAST',
    phaseDone:  'OK',
  },
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return reduced;
}

function PhaseCard({ label, state, reducedMotion }) {
  const isActive = state === 'active';
  const isDone = state === 'done';
  return (
    <Box
      className="brand-phase-card"
      sx={{
        flex:          '0 0 auto',
        minWidth:      { xs: '72px', sm: '88px' },
        px:            { xs: '10px', sm: '12px' },
        py:            '10px',
        border:        `1px solid ${isActive ? 'var(--sport-accent)' : 'var(--brand-rule-strong)'}`,
        bgcolor:       isActive ? 'var(--sport-accent)' : isDone ? 'rgba(184, 152, 90, 0.12)' : 'rgba(0,0,0,0.35)',
        color:         isActive ? 'var(--sport-accent-text, #0a0a0a)' : 'var(--brand-cream)',
        clipPath:      'polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
        transition:    reducedMotion ? 'none' : 'background 0.2s, border-color 0.2s, color 0.2s',
      }}
    >
      <Typography sx={{
        fontFamily: DISPLAY, fontSize: { xs: '0.72rem', sm: '0.82rem' }, fontWeight: 700,
        letterSpacing: '0.14em', lineHeight: 1.1, textAlign: 'center',
      }}>
        {label}
      </Typography>
      {isDone && (
        <Typography sx={{
          fontFamily: MONO, fontSize: '0.5rem', letterSpacing: '0.2em',
          textAlign: 'center', mt: '4px', color: 'var(--brand-bronze)',
        }}>
          ✓
        </Typography>
      )}
    </Box>
  );
}

export default function OracleLoadingOverlayLeague({ lang = 'en', sport = 'mlb' }) {
  const { C } = useHexaTheme();
  const t = COPY[lang] ?? COPY.en;
  const messages = lang === 'es' ? LOADING_MESSAGES_ES : LOADING_MESSAGES_EN;
  const reducedMotion = usePrefersReducedMotion();
  const [tick, setTick] = useState(0);

  const phaseIndex = tick % PHASES.length;
  const msgIndex = tick % messages.length;
  const progressPct = ((phaseIndex + 1) / PHASES.length) * 100;
  const sportLabel = sport === 'nba' ? 'NBA' : 'MLB';

  const tickerItems = useMemo(() => {
    const snippets = TICKER_SNIPPETS[lang] ?? TICKER_SNIPPETS.en;
    const current = messages[msgIndex]?.replace(/\.\.\.$/, '') ?? '';
    const row = [...snippets, current, sportLabel].filter(Boolean);
    return [...row, ...row];
  }, [lang, messages, msgIndex, sportLabel]);

  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 2500);
    return () => clearInterval(id);
  }, []);

  return (
    <Box
      className="hexa-themed-page league-analysis-overlay"
      sx={{
        position:       'fixed',
        inset:          0,
        zIndex:         9999,
        display:        'flex',
        flexDirection:  'column',
        bgcolor:        'rgba(6, 24, 39, 0.97)',
        pointerEvents:  'all',
        userSelect:     'none',
        overflow:       'hidden',
      }}
    >
      <Box className="brand-broadcast-strip" sx={{ flexShrink: 0, width: '100%' }}>
        <span className="live-dot" style={{ animation: reducedMotion ? 'none' : undefined }} />
        <span>{t.live}</span>
        <span className="sep">|</span>
        <span>{t.stripMid}</span>
        <span className="sep">|</span>
        <span>{t.stripRight}</span>
        <Box className="right" sx={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
          <span>{sportLabel}</span>
          <span>{t.deep}</span>
        </Box>
      </Box>

      <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: { xs: 2, sm: 3 },
        py: { xs: 3, sm: 4 },
        gap: { xs: 2.5, sm: 3 },
        width: '100%',
        maxWidth: 720,
        mx: 'auto',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', justifyContent: 'center' }}>
          <Box className="brand-shield" sx={{ width: 48, height: 52, fontSize: 22 }}>H</Box>
          <Box>
            <Typography className="brand-osw brand-skew" sx={{
              fontSize: { xs: '2rem', sm: '2.75rem' }, lineHeight: 0.95,
              color: 'var(--brand-cream)', textTransform: 'uppercase',
            }}>
              {t.title1}
            </Typography>
            <Typography className="brand-osw" sx={{
              fontSize: { xs: '2rem', sm: '2.75rem' }, lineHeight: 0.95,
              color: 'var(--sport-accent)', textTransform: 'uppercase',
            }}>
              {t.title2}
            </Typography>
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.58rem', letterSpacing: '0.28em',
              color: C.textMuted, textTransform: 'uppercase', mt: 0.5,
            }}>
              {t.subtitle}
            </Typography>
          </Box>
        </Box>

        <Box sx={{
          width: '100%', maxWidth: 420, height: 6, bgcolor: 'rgba(0,0,0,0.45)',
          border: '1px solid var(--brand-rule-strong)', overflow: 'hidden',
          clipPath: 'polygon(0 0, 100% 0, calc(100% - 6px) 100%, 6px 100%)',
        }}>
          <Box sx={{
            height: '100%',
            width: `${progressPct}%`,
            bgcolor: 'var(--sport-accent)',
            transition: reducedMotion ? 'none' : 'width 0.45s ease-out',
          }} />
        </Box>

        <Box sx={{
          display: 'flex',
          gap: { xs: '6px', sm: '8px' },
          width: '100%',
          maxWidth: 520,
          overflowX: 'auto',
          pb: 0.5,
          justifyContent: { xs: 'flex-start', sm: 'center' },
          '&::-webkit-scrollbar': { height: 4 },
          '&::-webkit-scrollbar-thumb': { background: 'var(--brand-rule-strong)' },
        }}>
          {PHASES.map((phase, i) => {
            let state = 'pending';
            if (i < phaseIndex) state = 'done';
            else if (i === phaseIndex) state = 'active';
            const label = lang === 'es' ? phase.es : phase.en;
            return (
              <PhaseCard key={phase.id} label={label} state={state} reducedMotion={reducedMotion} />
            );
          })}
        </Box>

        <Typography
          key={msgIndex}
          sx={{
            fontFamily: MONO,
            fontSize: { xs: '0.72rem', sm: '0.82rem' },
            color: 'var(--brand-cream-2)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            textAlign: 'center',
            minHeight: '1.4em',
            maxWidth: 400,
            animation: reducedMotion ? 'none' : 'leagueMsgSnap 0.15s ease-out',
            '@keyframes leagueMsgSnap': {
              from: { opacity: 0 },
              to:   { opacity: 1 },
            },
          }}
        >
          ▸ {messages[msgIndex]}
        </Typography>

        <Typography sx={{
          fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.22em',
          color: C.textMuted, textTransform: 'uppercase', textAlign: 'center',
        }}>
          {t.footer}
        </Typography>
      </Box>

      <Box className="brand-ticker" sx={{ flexShrink: 0, width: '100%' }}>
        <Box
          className="brand-ticker-track"
          sx={{ animation: reducedMotion ? 'none' : undefined }}
        >
          {tickerItems.map((item, i) => (
            <span key={`${item}-${i}`}>
              {i > 0 && <span className="ticker-sep">·</span>}
              <span className="ticker-game">{item}</span>
              {i % 3 === 2 && <i>LIVE</i>}
            </span>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
