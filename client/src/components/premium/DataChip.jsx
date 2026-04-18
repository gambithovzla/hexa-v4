/**
 * DataChip — compact inline stat / filter / navigation element.
 *
 * Three visual variants share the same primitive:
 *   - 'stat'    (default): label + value, no interaction
 *   - 'filter': toggleable, shows active/inactive state
 *   - 'nav':    acts as a navigation pill (used in StatMuse-style explore strips)
 *
 * Chips are small, dense, and always tappable with a comfortable 36px min height
 * for mobile. Use inside horizontal scrolls (rails) or wrap grids.
 *
 * Props:
 *   intent:   'action' | 'data' | 'success' | 'warn' | 'danger' (default 'data')
 *   variant:  'stat' | 'filter' | 'nav'
 *   label:    small uppercase label (top or left depending on variant)
 *   value:    primary value (stat variant) or displayed text (filter/nav)
 *   active:   filter variant — is this filter selected
 *   onClick:  click handler; chip becomes tappable
 *   icon:     optional leading node
 */

import { Box, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { useHexaTheme } from '../../themeProvider';
import { hoverLift, usePrefersReducedMotion } from '../../motion';

export default function DataChip({
  intent = 'data',
  variant = 'stat',
  label,
  value,
  active = false,
  onClick,
  icon,
}) {
  const reduced = usePrefersReducedMotion();
  const { C, MONO, SCALE, INTENT, SPACE } = useHexaTheme();
  const tone = INTENT[intent] || INTENT.data;
  const clickable = Boolean(onClick);

  const isActive = variant === 'filter' ? active : false;

  return (
    <motion.div
      {...(clickable && !reduced ? hoverLift : {})}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
      aria-pressed={variant === 'filter' ? isActive : undefined}
      style={{
        display:     'inline-flex',
        outline:     'none',
        cursor:      clickable ? 'pointer' : 'default',
        flexShrink:  0,
      }}
    >
      <Box
        sx={{
          minHeight:    36,
          display:      'inline-flex',
          alignItems:   'center',
          gap:          SPACE.sm,
          px:           SPACE.md,
          py:           '6px',
          bgcolor:      isActive ? tone.base : C.surface,
          color:        isActive ? '#000' : C.textPrimary,
          border:       `1px solid ${isActive ? tone.base : tone.line}`,
          fontFamily:   MONO,
          transition:   'background 0.2s ease, border-color 0.2s ease, color 0.2s ease',
          whiteSpace:   'nowrap',
          '&:hover':    clickable ? {
            borderColor: tone.base,
            bgcolor:     isActive ? tone.base : tone.dim,
            boxShadow:   tone.glow,
          } : {},
        }}
      >
        {icon && <Box sx={{ display: 'flex', alignItems: 'center' }}>{icon}</Box>}

        {variant === 'stat' && (
          <>
            {label && (
              <Typography
                component="span"
                sx={{
                  fontSize:      SCALE.micro,
                  color:         C.textMuted,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  fontWeight:    700,
                }}
              >
                {label}
              </Typography>
            )}
            {value !== undefined && value !== null && (
              <Typography
                component="span"
                sx={{
                  fontSize:      SCALE.label,
                  color:         tone.base,
                  fontWeight:    700,
                  letterSpacing: '0.04em',
                  textShadow:    tone.glow,
                }}
              >
                {value}
              </Typography>
            )}
          </>
        )}

        {(variant === 'filter' || variant === 'nav') && (
          <Typography
            component="span"
            sx={{
              fontSize:      SCALE.label,
              fontWeight:    700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color:         isActive ? '#000' : C.textPrimary,
            }}
          >
            {value ?? label}
          </Typography>
        )}
      </Box>
    </motion.div>
  );
}
