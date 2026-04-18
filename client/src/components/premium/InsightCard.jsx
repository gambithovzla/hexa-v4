/**
 * InsightCard — secondary feed card with progressive disclosure.
 *
 * Replaces the current flat HexaBoard row. Compact by default, expands
 * inline with a smooth morph when tapped. Uses layoutId so adjacent cards
 * reflow rather than jumping.
 *
 * Compose multiple InsightCards inside a <motion.div variants={staggerContainer()}>
 * for a sequential reveal on mount.
 *
 * Props:
 *   intent:     'action' | 'data' | 'success' | 'warn' | 'danger'
 *   icon:       optional node (team logo, player headshot, icon)
 *   label:      small category label on the left (e.g. "HOT BAT")
 *   title:      the insight headline — one line, bold
 *   value:      optional numeric/stat on the right (mono font)
 *   subtitle:   optional single line below title
 *   expanded:   controlled — parent decides open/closed state
 *   onToggle:   click handler; receives the new expanded state
 *   children:   content revealed when expanded
 *   href:       optional — if set, becomes a navigation affordance (not toggle)
 */

import { useId } from 'react';
import { Box, Typography } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { useHexaTheme } from '../../themeProvider';
import { fadeUp, hoverLift, drillDown, usePrefersReducedMotion, reducedVariant } from '../../motion';

export default function InsightCard({
  intent = 'data',
  icon,
  label,
  title,
  value,
  subtitle,
  expanded = false,
  onToggle,
  onClick,
  children,
}) {
  const reduced = usePrefersReducedMotion();
  const { C, MONO, DISPLAY, SCALE, INTENT, SPACE, EASE, DURATION } = useHexaTheme();
  const tone = INTENT[intent] || INTENT.data;
  const layoutId = useId();
  const clickable = Boolean(onToggle || onClick);
  const hasExpandable = Boolean(children);

  const handleClick = (e) => {
    if (onClick) onClick(e);
    if (onToggle) onToggle(!expanded);
  };

  return (
    <motion.div
      variants={reduced ? reducedVariant : fadeUp}
      layout={!reduced}
      style={{ width: '100%' }}
    >
      <motion.div
        layoutId={reduced ? undefined : `insight-${layoutId}`}
        {...(clickable && !reduced ? hoverLift : {})}
        onClick={clickable ? handleClick : undefined}
        role={clickable ? 'button' : undefined}
        aria-expanded={hasExpandable ? expanded : undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e); } } : undefined}
        style={{ outline: 'none', cursor: clickable ? 'pointer' : 'default' }}
      >
        <Box
          sx={{
            position:     'relative',
            bgcolor:      C.surface,
            border:       `1px solid ${C.border}`,
            borderLeft:   `3px solid ${tone.base}`,
            px:           SPACE.md,
            py:           SPACE.md,
            display:      'flex',
            alignItems:   'center',
            gap:          SPACE.md,
            transition:   'border-color 0.2s ease, background 0.2s ease',
            '&:hover':    clickable ? {
              bgcolor:     C.elevated,
              borderColor: tone.base,
            } : {},
          }}
        >
          {/* ── Icon / avatar slot ── */}
          {icon && (
            <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {icon}
            </Box>
          )}

          {/* ── Main column ── */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {label && (
              <Typography
                sx={{
                  fontFamily:    MONO,
                  fontSize:      SCALE.micro,
                  color:         tone.base,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  fontWeight:    700,
                  lineHeight:    1.2,
                }}
              >
                {label}
              </Typography>
            )}
            {title && (
              <Typography
                noWrap
                sx={{
                  fontFamily:    DISPLAY,
                  fontSize:      SCALE.title,
                  fontWeight:    700,
                  color:         C.textPrimary,
                  letterSpacing: '0.03em',
                  lineHeight:    1.2,
                }}
              >
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography
                noWrap
                sx={{
                  fontFamily: MONO,
                  fontSize:   SCALE.label,
                  color:      C.textSecondary,
                  lineHeight: 1.4,
                }}
              >
                {subtitle}
              </Typography>
            )}
          </Box>

          {/* ── Value (right side) ── */}
          {value !== undefined && value !== null && (
            <Box sx={{ flexShrink: 0, textAlign: 'right', pl: SPACE.sm }}>
              <Typography
                sx={{
                  fontFamily:    MONO,
                  fontSize:      SCALE.display,
                  fontWeight:    700,
                  color:         tone.base,
                  letterSpacing: '0.04em',
                  lineHeight:    1,
                  textShadow:    tone.glow,
                }}
              >
                {value}
              </Typography>
            </Box>
          )}

          {/* ── Chevron (if expandable) ── */}
          {hasExpandable && (
            <motion.div
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={{ duration: DURATION.fast, ease: EASE.out }}
              style={{
                flexShrink: 0,
                color:      tone.base,
                fontSize:   '18px',
                fontFamily: MONO,
                lineHeight: 1,
                userSelect: 'none',
              }}
              aria-hidden="true"
            >
              ›
            </motion.div>
          )}
        </Box>

        {/* ── Expandable drawer ── */}
        <AnimatePresence initial={false}>
          {expanded && hasExpandable && (
            <motion.div
              key="expand"
              variants={reduced ? reducedVariant : drillDown}
              initial={reduced ? false : 'initial'}
              animate="animate"
              exit={reduced ? undefined : 'exit'}
              layout={!reduced}
              style={{ overflow: 'hidden' }}
            >
              <Box
                sx={{
                  bgcolor:    C.surfaceAlt,
                  borderLeft: `3px solid ${tone.base}`,
                  borderRight:`1px solid ${C.border}`,
                  borderBottom:`1px solid ${C.border}`,
                  px:         SPACE.md,
                  py:         SPACE.md,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {children}
              </Box>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
