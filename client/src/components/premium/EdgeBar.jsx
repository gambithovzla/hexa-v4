/**
 * EdgeBar — animated confidence / edge indicator.
 *
 * Shows a percentage as a filled bar that reveals from 0 → target on mount.
 * Use inside HeroCard or verdict sections to visualize confidence at a glance.
 *
 * Props:
 *   percent:  0–100
 *   label:    left-side label (e.g. "CONFIDENCE", "EDGE")
 *   intent:   'action' | 'data' | 'success' | 'warn' | 'danger'
 *   showValue: if true, renders the "NN%" text on the right
 */

import { Box, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { useHexaTheme } from '../../themeProvider';
import { revealBar, usePrefersReducedMotion } from '../../motion';

export default function EdgeBar({
  percent = 0,
  label,
  intent = 'action',
  showValue = true,
}) {
  const reduced = usePrefersReducedMotion();
  const { C, MONO, SCALE, INTENT, GRAD, SPACE } = useHexaTheme();
  const tone = INTENT[intent] || INTENT.action;
  const safe = Math.max(0, Math.min(100, percent));

  return (
    <Box sx={{ width: '100%' }}>
      {(label || showValue) && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: SPACE.xs }}>
          {label && (
            <Typography
              sx={{
                fontFamily:    MONO,
                fontSize:      SCALE.micro,
                color:         C.textMuted,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                fontWeight:    700,
              }}
            >
              {label}
            </Typography>
          )}
          {showValue && (
            <Typography
              sx={{
                fontFamily:    MONO,
                fontSize:      SCALE.label,
                color:         tone.base,
                fontWeight:    700,
                letterSpacing: '0.04em',
                textShadow:    tone.glow,
              }}
            >
              {safe.toFixed(0)}%
            </Typography>
          )}
        </Box>
      )}
      <Box
        sx={{
          position: 'relative',
          width:    '100%',
          height:   6,
          bgcolor:  'rgba(255,255,255,0.04)',
          border:   `1px solid ${tone.line}`,
          overflow: 'hidden',
        }}
      >
        <motion.div
          variants={reduced ? undefined : revealBar(safe)}
          initial={reduced ? undefined : 'hidden'}
          animate="visible"
          style={{
            position: 'absolute',
            top:      0,
            left:     0,
            bottom:   0,
            width:    reduced ? `${safe}%` : undefined,
            background: GRAD.edgeBar,
            boxShadow:  tone.glow,
          }}
        />
      </Box>
    </Box>
  );
}
