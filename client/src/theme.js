// H.E.X.A. V4 — Sci-Fi Terminal Design System
//
// History: this file used to hard-code dark-mode tokens. With the
// light/system/dark theming system (feat/theme-modes), colors now live in
// /palettes/{dark,light}.js and are resolved at runtime by the ThemeProvider.
//
// BACKWARDS-COMPAT CONTRACT:
//   Legacy components do `import { C, GRAD, SHADOW, INTENT } from '../theme'`.
//   That import keeps working and always returns the DARK palette — treated
//   as a safe fallback until the component is migrated to useHexaTheme().
//   Palette-independent exports (MONO/DISPLAY/SCALE/SPACE/EASE/DURATION/RADIUS)
//   are shared across modes and also exported statically.
//
// Migrated components should prefer:
//   const { C, GRAD, SHADOW, INTENT } = useHexaTheme();
// so they reflect the user's theme selection.

import darkPalette from './palettes/dark.js';

// ── Font stacks — palette-independent ───────────────────────────────────────
// Cyberpunk redesign: Space Grotesk for display copy, JetBrains Mono for
// numerals/labels. Orbitron + Share Tech Mono are kept in the stack as
// fallback so anything still referencing them visually degrades gracefully.
export const MONO    = "'JetBrains Mono', 'Share Tech Mono', 'SF Mono', 'Courier New', monospace";
export const DISPLAY = "'Space Grotesk', 'Orbitron', system-ui, sans-serif";

// Legacy aliases
export const BARLOW  = DISPLAY;
export const SANS    = MONO;

// ── Palette-independent tokens ──────────────────────────────────────────────
// These don't change between light and dark — they're about rhythm and motion.

export const SCALE = {
  hero:     'clamp(2.4rem, 6vw, 4.5rem)',
  display:  'clamp(1.6rem, 3.8vw, 2.6rem)',
  title:    'clamp(1.1rem, 2.2vw, 1.4rem)',
  body:     '0.92rem',
  label:    '0.72rem',
  micro:    '0.62rem',
};

export const RADIUS = {
  none:  0,
  sharp: 2,
};

export const SPACE = {
  xs:  '4px',
  sm:  '8px',
  md:  '16px',
  lg:  '24px',
  xl:  '40px',
  xxl: '64px',
};

export const EASE = {
  out:   [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
  pop:   [0.34, 1.56, 0.64, 1],
};

export const DURATION = {
  fast:    0.18,
  base:    0.32,
  slow:    0.6,
  stagger: 0.04,
};

// ── Token derivation ────────────────────────────────────────────────────────
// Given a palette (dark or light), build the full set of palette-dependent
// tokens. Gradient/shadow opacities are palette-aware: in light mode they
// pull back so a "heroOrange" doesn't feel like a blast of radiation on cream.

function withAlpha(hex, alpha) {
  // Accepts #RGB / #RRGGBB and appends 2-hex alpha.
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  return `#${full}${a}`;
}

export function buildTokens(palette) {
  const isLight = palette.mode === 'light';

  // Gradient intensity — dark mode leans on radial neon splashes, light mode
  // keeps a hint but stays readable.
  const gAlpha = isLight
    ? { hero: 0.14, sweep: 0.03, fade: 0.55 }
    : { hero: 0.22, sweep: 0.04, fade: 0.7 };

  const GRAD = {
    heroOrange: `radial-gradient(120% 80% at 0% 0%, ${withAlpha(palette.accent, gAlpha.hero)} 0%, ${withAlpha(palette.accent, gAlpha.hero * 0.2)} 45%, transparent 70%)`,
    heroCyan:   `radial-gradient(120% 80% at 100% 0%, ${withAlpha(palette.cyan, gAlpha.hero * 0.85)} 0%, ${withAlpha(palette.cyan, gAlpha.hero * 0.2)} 45%, transparent 70%)`,
    heroGreen:  `radial-gradient(120% 80% at 50% 100%, ${withAlpha(palette.green, gAlpha.hero * 0.75)} 0%, ${withAlpha(palette.green, gAlpha.hero * 0.15)} 50%, transparent 75%)`,
    fadeBottom: isLight
      ? `linear-gradient(180deg, transparent 0%, rgba(245,242,235,${gAlpha.fade}) 70%, ${palette.bg} 100%)`
      : `linear-gradient(180deg, transparent 0%, rgba(0,0,0,${gAlpha.fade}) 70%, ${palette.bg} 100%)`,
    sweep: `linear-gradient(135deg, ${withAlpha(palette.cyan, gAlpha.sweep)} 0%, transparent 40%, transparent 60%, ${withAlpha(palette.accent, gAlpha.sweep)} 100%)`,
    edgeBar: `linear-gradient(90deg, ${palette.cyan} 0%, ${palette.green} 50%, ${palette.accent} 100%)`,
  };

  // Shadows — dark uses heavy black + colored glow; light uses soft lift only.
  const SHADOW = isLight
    ? {
        sm:         '0 1px 2px rgba(10,16,20,0.06)',
        md:         '0 4px 16px rgba(10,16,20,0.08), 0 0 0 1px rgba(10,16,20,0.04)',
        lg:         '0 12px 40px rgba(10,16,20,0.12), 0 2px 6px rgba(10,16,20,0.06)',
        heroOrange: '0 12px 40px rgba(196,66,0,0.12), 0 2px 6px rgba(10,16,20,0.08)',
        heroCyan:   '0 12px 40px rgba(0,93,125,0.12), 0 2px 6px rgba(10,16,20,0.08)',
        heroGreen:  '0 12px 40px rgba(0,122,64,0.12), 0 2px 6px rgba(10,16,20,0.08)',
      }
    : {
        sm:         '0 2px 12px rgba(0,0,0,0.6)',
        md:         '0 8px 32px rgba(0,0,0,0.8), 0 0 1px rgba(0,217,255,0.2)',
        lg:         '0 16px 48px rgba(0,0,0,0.9), 0 0 24px rgba(0,217,255,0.08)',
        heroOrange: '0 20px 60px rgba(0,0,0,0.95), 0 0 40px rgba(255,102,0,0.18)',
        heroCyan:   '0 20px 60px rgba(0,0,0,0.95), 0 0 40px rgba(0,217,255,0.18)',
        heroGreen:  '0 20px 60px rgba(0,0,0,0.95), 0 0 40px rgba(0,255,136,0.18)',
      };

  // Intent mapping — 1 base, 1 line, 1 dim, 1 glow per intent.
  const INTENT = {
    action:  { base: palette.accent, line: palette.accentLine, dim: palette.accentDim, glow: palette.accentGlow },
    data:    { base: palette.cyan,   line: palette.cyanLine,   dim: palette.cyanDim,   glow: palette.cyanGlow },
    success: { base: palette.green,  line: palette.greenLine,  dim: palette.greenDim,  glow: palette.greenGlow },
    warn:    { base: palette.amber,  line: palette.amberLine,  dim: palette.amberDim,  glow: palette.accentGlow },
    danger:  { base: palette.red,    line: palette.redLine,    dim: palette.redDim,    glow: palette.accentGlow },
  };

  return { C: palette, GRAD, SHADOW, INTENT };
}

// ── Static exports (dark fallback) for legacy imports ───────────────────────
// Everything downstream that isn't theme-aware yet reads from here.

const darkTokens = buildTokens(darkPalette);

export const C      = darkTokens.C;
export const GRAD   = darkTokens.GRAD;
export const SHADOW = darkTokens.SHADOW;
export const INTENT = darkTokens.INTENT;
