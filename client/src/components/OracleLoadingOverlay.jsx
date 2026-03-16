/**
 * OracleLoadingOverlay.jsx
 * Full-screen loading overlay shown while H.E.X.A. analysis is running.
 * Renders the official logo with a pulse animation, rotating status messages,
 * and an infinite progress bar.
 */

import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';

const BARLOW = '"Barlow Condensed", system-ui, sans-serif';

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
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
        pointerEvents:   'all',
        userSelect:      'none',
        gap:             '28px',
      }}
    >
      {/* Logo with pulse */}
      <Box
        sx={{
          '@keyframes hexaPulse': {
            '0%, 100%': { transform: 'scale(1)',    opacity: 1    },
            '50%':      { transform: 'scale(1.05)', opacity: 0.92 },
          },
          animation: 'hexaPulse 2s ease-in-out infinite',
        }}
      >
        <Box
          component="img"
          src="/hexa-logo.png"
          alt="H.E.X.A."
          sx={{
            width:  '180px',
            height: 'auto',
            display: 'block',
            // Fallback glow when image fails to load
            filter: 'drop-shadow(0 0 24px rgba(0,102,255,0.5))',
          }}
          onError={e => { e.target.style.display = 'none'; }}
        />
      </Box>

      {/* Rotating status message */}
      <Typography
        key={msgIndex}
        sx={{
          fontFamily:    BARLOW,
          fontSize:      '18px',
          fontWeight:    600,
          color:         '#4fc3f7',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          textAlign:     'center',
          px:            '16px',
          '@keyframes fadeInMsg': {
            from: { opacity: 0, transform: 'translateY(4px)' },
            to:   { opacity: 1, transform: 'translateY(0)'   },
          },
          animation: 'fadeInMsg 0.4s ease-out forwards',
        }}
      >
        {messages[msgIndex]}
      </Typography>

      {/* Infinite progress bar */}
      <Box
        sx={{
          width:        '260px',
          height:       '2px',
          bgcolor:      'rgba(79,195,247,0.15)',
          borderRadius: '1px',
          overflow:     'hidden',
          position:     'relative',
        }}
      >
        <Box
          sx={{
            position:     'absolute',
            top:          0,
            left:         0,
            height:       '100%',
            width:        '45%',
            borderRadius: '1px',
            background:   'linear-gradient(90deg, transparent 0%, #4fc3f7 50%, transparent 100%)',
            '@keyframes hexaProgress': {
              '0%':   { transform: 'translateX(-100%)' },
              '100%': { transform: 'translateX(320%)' },
            },
            animation: 'hexaProgress 1.6s ease-in-out infinite',
          }}
        />
      </Box>
    </Box>
  );
}
