/**
 * HeroCard — the single dominant surface on a screen.
 *
 * Use for "HEXA's top signal of the day" on the home board, or the verdict
 * band on the decision screen. Only one HeroCard should be visible at once —
 * that's the whole point. Height is viewport-aware so it commands attention
 * on mobile without requiring a second scroll.
 *
 * Props:
 *   intent:   'action' | 'data' | 'success' | 'warn' | 'danger'
 *   eyebrow:  small uppercase label above title (e.g. "TOP SIGNAL")
 *   title:    large display text — the actual statement
 *   subtitle: supporting line below title
 *   meta:     optional inline meta (right side, e.g. timestamp or confidence)
 *   cta:      { label, onClick } — primary action; the card is also clickable
 *   onClick:  fires on tap of the card body
 *   media:    optional node (logo, headshot, illustration) rendered right-side
 *   children: optional extra content below subtitle (e.g. an EdgeBar)
 */

import { Box, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { C, MONO, DISPLAY, SCALE, GRAD, SHADOW, INTENT, SPACE } from '../../theme';
import { heroPop, hoverLift, usePrefersReducedMotion, reducedVariant } from '../../motion';

const INTENT_GRAD = {
  action:  GRAD.heroOrange,
  warn:    GRAD.heroOrange,
  danger:  GRAD.heroOrange,
  data:    GRAD.heroCyan,
  success: GRAD.heroGreen,
};

const INTENT_SHADOW = {
  action:  SHADOW.heroOrange,
  warn:    SHADOW.heroOrange,
  danger:  SHADOW.heroOrange,
  data:    SHADOW.heroCyan,
  success: SHADOW.heroGreen,
};

export default function HeroCard({
  intent = 'action',
  eyebrow,
  title,
  subtitle,
  meta,
  cta,
  onClick,
  media,
  children,
}) {
  const reduced = usePrefersReducedMotion();
  const tone = INTENT[intent] || INTENT.action;
  const clickable = Boolean(onClick || cta?.onClick);

  const handleClick = (e) => {
    if (onClick) onClick(e);
    else if (cta?.onClick) cta.onClick(e);
  };

  return (
    <motion.div
      variants={reduced ? reducedVariant : heroPop}
      initial="hidden"
      animate="visible"
      {...(clickable && !reduced ? hoverLift : {})}
      onClick={clickable ? handleClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e); } } : undefined}
      style={{
        position:   'relative',
        cursor:     clickable ? 'pointer' : 'default',
        outline:    'none',
      }}
    >
      <Box
        sx={{
          position:        'relative',
          overflow:        'hidden',
          minHeight:       { xs: '38vh', md: '44vh' },
          background:      C.surface,
          border:          `1px solid ${tone.line}`,
          borderLeft:      `3px solid ${tone.base}`,
          boxShadow:       INTENT_SHADOW[intent] || SHADOW.heroOrange,
          p:               { xs: SPACE.lg, md: SPACE.xl },
          display:         'flex',
          flexDirection:   'column',
          justifyContent:  'space-between',
          gap:             SPACE.md,
          // Hover glow intensifies when clickable
          '&::before': {
            content:    '""',
            position:   'absolute',
            inset:      0,
            background: INTENT_GRAD[intent] || GRAD.heroOrange,
            pointerEvents: 'none',
            transition: 'opacity 0.4s ease',
          },
          // Subtle animated sweep — pure CSS, cheap, respects reduced motion
          '&::after': {
            content:    '""',
            position:   'absolute',
            inset:      0,
            background: GRAD.sweep,
            pointerEvents: 'none',
          },
          '&:hover::before': clickable ? { opacity: 1.2 } : {},
          // Corner brackets — terminal identity accent
          '& .hex-bracket-tl, & .hex-bracket-br': {
            position: 'absolute',
            width:    14,
            height:   14,
            pointerEvents: 'none',
          },
          '& .hex-bracket-tl': {
            top: 0, left: 0,
            borderTop:  `2px solid ${tone.base}`,
            borderLeft: `2px solid ${tone.base}`,
          },
          '& .hex-bracket-br': {
            bottom: 0, right: 0,
            borderBottom: `2px solid ${tone.base}`,
            borderRight:  `2px solid ${tone.base}`,
          },
        }}
      >
        <Box className="hex-bracket-tl" />
        <Box className="hex-bracket-br" />

        {/* ── Top row — eyebrow + meta ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md, position: 'relative', zIndex: 1 }}>
          {eyebrow && (
            <Typography
              sx={{
                fontFamily:    MONO,
                fontSize:      SCALE.label,
                letterSpacing: '0.22em',
                color:         tone.base,
                textTransform: 'uppercase',
                fontWeight:    700,
                textShadow:    tone.glow,
              }}
            >
              {eyebrow}
            </Typography>
          )}
          {meta && (
            <Typography sx={{ fontFamily: MONO, fontSize: SCALE.micro, color: C.textMuted, letterSpacing: '0.12em' }}>
              {meta}
            </Typography>
          )}
        </Box>

        {/* ── Middle — title + media ── */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: SPACE.lg, position: 'relative', zIndex: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {title && (
              <Typography
                sx={{
                  fontFamily:    DISPLAY,
                  fontSize:      SCALE.hero,
                  lineHeight:    1.02,
                  fontWeight:    800,
                  color:         C.textPrimary,
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                  wordBreak:     'break-word',
                }}
              >
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography
                sx={{
                  mt:         SPACE.sm,
                  fontFamily: MONO,
                  fontSize:   SCALE.body,
                  color:      C.textSecondary,
                  lineHeight: 1.5,
                }}
              >
                {subtitle}
              </Typography>
            )}
          </Box>
          {media && (
            <Box sx={{ flexShrink: 0, display: { xs: 'none', sm: 'flex' }, alignItems: 'center', justifyContent: 'center' }}>
              {media}
            </Box>
          )}
        </Box>

        {/* ── Optional extra content (EdgeBar, stat row, etc) ── */}
        {children && <Box sx={{ position: 'relative', zIndex: 1 }}>{children}</Box>}

        {/* ── CTA ── */}
        {cta && (
          <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'flex-start' }}>
            <Box
              component="button"
              onClick={(e) => { e.stopPropagation(); cta.onClick?.(e); }}
              sx={{
                display:        'inline-flex',
                alignItems:     'center',
                gap:            SPACE.sm,
                px:             SPACE.lg,
                py:             SPACE.sm,
                bgcolor:        tone.base,
                color:          '#000',
                border:         `1px solid ${tone.base}`,
                fontFamily:     MONO,
                fontSize:       SCALE.label,
                fontWeight:     700,
                letterSpacing:  '0.18em',
                textTransform:  'uppercase',
                cursor:         'pointer',
                boxShadow:      tone.glow,
                transition:     'transform 0.15s ease, box-shadow 0.2s ease',
                '&:hover':      { transform: 'translateY(-1px)', boxShadow: `${tone.glow}, 0 6px 20px rgba(0,0,0,0.6)` },
                '&:active':     { transform: 'translateY(0)' },
              }}
            >
              {cta.label}
              <Box component="span" sx={{ fontSize: '1em', lineHeight: 1 }}>→</Box>
            </Box>
          </Box>
        )}
      </Box>
    </motion.div>
  );
}
