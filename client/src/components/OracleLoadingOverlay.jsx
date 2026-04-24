/**
 * OracleLoadingOverlay.jsx
 * Full-screen loading overlay shown while H.E.X.A. analysis is running.
 * Shows the mascot with a scan-line animation, rotating status messages,
 * and an infinite progress bar.
 */

import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO } from '../theme';

const MESSAGES_ES = [
  'Consultando Statcast...',
  'Analizando tendencias históricas...',
  'Cruzando datos de pitcheo...',
  'Evaluando métricas ofensivas...',
  'Calculando probabilidades...',
  'El Oráculo está procesando...',
  'Verificando alineaciones...',
  'Analizando momios...',
];

const MESSAGES_EN = [
  'Consulting Statcast...',
  'Analyzing historical trends...',
  'Cross-referencing pitching data...',
  'Evaluating offensive metrics...',
  'Calculating probabilities...',
  'The Oracle is processing...',
  'Verifying lineups...',
  'Analyzing odds...',
];

export default function OracleLoadingOverlay({ lang = 'en' }) {
  const messages = lang === 'es' ? MESSAGES_ES : MESSAGES_EN;
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setMsgIndex(i => (i + 1) % messages.length);
    }, 2500);
    return () => clearInterval(id);
  }, [messages.length]);

  return (
    <Box
      sx={{
        position:        'fixed',
        inset:           0,
        zIndex:          9999,
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        bgcolor:         'rgba(0,0,0,0.96)',
        backdropFilter:  'blur(8px)',
        pointerEvents:   'all',
        userSelect:      'none',
        gap:             '20px',
      }}
    >
      {/* Mascot with glow-pulse + scan-line */}
      <Box
        sx={{
          position:   'relative',
          width:      { xs: 'min(240px, 58vw)', sm: 'min(320px, 38vw)', md: 340 },
          flexShrink: 0,
          '@keyframes hexaGlow': {
            '0%, 100%': { filter: 'drop-shadow(0 0 16px rgba(0,217,255,0.35))' },
            '50%':      { filter: 'drop-shadow(0 0 36px rgba(0,217,255,0.75))' },
          },
          animation: 'hexaGlow 2.4s ease-in-out infinite',
        }}
      >
        <Box
          component="img"
          src="/hexa-analyzing.png"
          alt="H.E.X.A."
          sx={{ width: '100%', height: 'auto', display: 'block' }}
          onError={e => { e.target.style.display = 'none'; }}
        />

        {/* Horizontal scan line sweeping top → bottom */}
        <Box
          sx={{
            position:   'absolute',
            top:        0,
            left:       '-10%',
            right:      '-10%',
            height:     '3px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(0,217,255,0.85) 50%, transparent 100%)',
            boxShadow:  '0 0 10px rgba(0,217,255,0.6)',
            '@keyframes hexaScan': {
              '0%':   { top: '0%',   opacity: 0 },
              '8%':   { opacity: 1              },
              '92%':  { opacity: 1              },
              '100%': { top: '105%', opacity: 0 },
            },
            animation: 'hexaScan 2.4s ease-in-out infinite',
          }}
        />

        {/* Bottom glow base */}
        <Box
          sx={{
            position:   'absolute',
            bottom:     '-16px',
            left:       '8%',
            right:      '8%',
            height:     '32px',
            background: 'radial-gradient(ellipse at center, rgba(0,217,255,0.28) 0%, transparent 70%)',
            '@keyframes hexaBasePulse': {
              '0%, 100%': { opacity: 0.5 },
              '50%':      { opacity: 1   },
            },
            animation: 'hexaBasePulse 2.4s ease-in-out infinite',
          }}
        />
      </Box>

      {/* Title block */}
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      { xs: '1.05rem', sm: '1.25rem' },
            fontWeight:    700,
            letterSpacing: '0.34em',
            color:         C.textPrimary,
            lineHeight:    1,
          }}
        >
          H.E.X.A.
        </Typography>
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      '0.52rem',
            letterSpacing: '0.22em',
            color:         C.cyan,
            textTransform: 'uppercase',
          }}
        >
          {lang === 'es' ? '// ANALIZANDO' : '// ANALYZING'}
        </Typography>
      </Box>

      {/* Rotating status message */}
      <Typography
        key={msgIndex}
        sx={{
          fontFamily:    MONO,
          fontSize:      { xs: '0.68rem', sm: '0.78rem' },
          color:         C.accent,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          textAlign:     'center',
          px:            '24px',
          maxWidth:      340,
          '@keyframes fadeInMsg': {
            from: { opacity: 0, transform: 'translateY(5px)' },
            to:   { opacity: 1, transform: 'translateY(0)'   },
          },
          animation: 'fadeInMsg 0.4s ease-out forwards',
        }}
      >
        {messages[msgIndex]}
      </Typography>

      {/* Progress bar */}
      <Box
        sx={{
          width:    { xs: '220px', sm: '300px' },
          height:   '2px',
          bgcolor:  C.border,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <Box
          sx={{
            position:   'absolute',
            inset:      '0 auto 0 0',
            width:      '40%',
            background: `linear-gradient(90deg, transparent 0%, ${C.cyan} 50%, transparent 100%)`,
            '@keyframes hexaProgress': {
              '0%':   { transform: 'translateX(-100%)' },
              '100%': { transform: 'translateX(360%)' },
            },
            animation: 'hexaProgress 1.6s ease-in-out infinite',
          }}
        />
      </Box>

      {/* Footer label */}
      <Typography
        sx={{
          fontFamily:    MONO,
          fontSize:      '0.48rem',
          letterSpacing: '0.2em',
          color:         C.textMuted,
          textTransform: 'uppercase',
        }}
      >
        HYBRID EXPERT X-ANALYSIS
      </Typography>
    </Box>
  );
}
