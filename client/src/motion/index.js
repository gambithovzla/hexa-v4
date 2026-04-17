/**
 * Motion primitives — shared Framer Motion variants and helpers.
 *
 * Every premium component imports from here so the product feels coherent
 * in motion. All timings come from theme.js (EASE / DURATION) so tuning
 * happens in one place.
 *
 * All variants respect prefers-reduced-motion via usePrefersReducedMotion().
 */

import { useEffect, useState } from 'react';
import { EASE, DURATION } from '../theme';

// ── Reduced-motion hook ──────────────────────────────────────────────────────
// Reads OS/browser preference and keeps it in sync. Components gate their
// animations on this so accessibility is honored without per-component boilerplate.
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', sync);
    else mq.addListener(sync);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', sync);
      else mq.removeListener(sync);
    };
  }, []);

  return reduced;
}

// ── Variants ─────────────────────────────────────────────────────────────────

// Fade-up — default entry for cards/rows. Pair with staggerChildren on parent.
export const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE.out } },
};

// Fade — for content swaps (tab content, etc).
export const fade = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.fast, ease: EASE.out } },
};

// Hero pop — slight overshoot for the single dominant element.
export const heroPop = {
  hidden:  { opacity: 0, y: 24, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: DURATION.slow, ease: EASE.pop } },
};

// Stagger container — wraps a list of fadeUp children.
export const staggerContainer = (delay = 0) => ({
  hidden:  {},
  visible: {
    transition: {
      staggerChildren: DURATION.stagger,
      delayChildren:   delay,
    },
  },
});

// Drill-down — used with layoutId to morph a row into an expanded panel.
export const drillDown = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION.base, ease: EASE.inOut } },
  exit:    { opacity: 0, transition: { duration: DURATION.fast, ease: EASE.inOut } },
};

// Reveal bar — animates width from 0 → target%. Pair with a numeric target.
// Usage: <motion.div variants={revealBar(73)} initial="hidden" animate="visible" />
export const revealBar = (percent) => ({
  hidden:  { width: '0%' },
  visible: {
    width: `${Math.max(0, Math.min(100, percent))}%`,
    transition: { duration: DURATION.slow, ease: EASE.out, delay: 0.1 },
  },
});

// Pulse — infinite loop for LIVE indicators and active signals. Use sparingly.
export const pulse = (color = '#00D9FF') => ({
  animate: {
    opacity:    [0.5, 1, 0.5],
    boxShadow:  [
      `0 0 0 0 ${color}00`,
      `0 0 12px 2px ${color}66`,
      `0 0 0 0 ${color}00`,
    ],
    transition: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' },
  },
});

// Hover lift — shared tap/hover affordance for clickable premium cards.
export const hoverLift = {
  whileHover: { y: -2, transition: { duration: DURATION.fast, ease: EASE.out } },
  whileTap:   { y: 0, scale: 0.995, transition: { duration: 0.1 } },
};

// Helper — strip animations when reduced motion is on.
// Returns a no-op-ish variant object compatible with Framer's API.
export const reducedVariant = {
  hidden:  { opacity: 1 },
  visible: { opacity: 1 },
};
