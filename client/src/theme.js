// H.E.X.A. V4 — Sci-Fi Terminal Design System
// Single source of truth for all visual tokens

export const C = {
  // ── Backgrounds — absolute black foundation ──────────────────────────────
  bg:          '#000000',
  surface:     '#07090E',
  surfaceAlt:  '#050508',
  elevated:    '#0A0D14',

  // ── Borders ──────────────────────────────────────────────────────────────
  border:      'rgba(0, 217, 255, 0.2)',
  borderLight: 'rgba(0, 217, 255, 0.1)',

  // ── Neon Orange — primary actions / alerts ────────────────────────────────
  accent:      '#FF6600',
  accentDim:   'rgba(255, 102, 0, 0.08)',
  accentLine:  'rgba(255, 102, 0, 0.3)',
  accentGlow:  '0 0 8px rgba(255,102,0,0.65), 0 0 20px rgba(255,102,0,0.25)',

  // ── Electric Cyan — data / technical labels ───────────────────────────────
  cyan:        '#00D9FF',
  cyanDim:     'rgba(0, 217, 255, 0.08)',
  cyanLine:    'rgba(0, 217, 255, 0.25)',
  cyanGlow:    '0 0 8px rgba(0,217,255,0.55), 0 0 20px rgba(0,217,255,0.2)',

  // ── Neon Green — success / Safe Picks ─────────────────────────────────────
  green:       '#00FF88',
  greenDim:    'rgba(0, 255, 136, 0.08)',
  greenLine:   'rgba(0, 255, 136, 0.25)',
  greenGlow:   '0 0 8px rgba(0,255,136,0.55), 0 0 20px rgba(0,255,136,0.2)',

  // ── Semantic ──────────────────────────────────────────────────────────────
  amber:       '#FF9900',
  amberDim:    'rgba(255, 153, 0, 0.08)',
  amberLine:   'rgba(255, 153, 0, 0.25)',
  red:         '#FF2244',
  redDim:      'rgba(255, 34, 68, 0.08)',
  redLine:     'rgba(255, 34, 68, 0.25)',

  // ── Text ──────────────────────────────────────────────────────────────────
  textPrimary:   '#E8F4FF',
  textSecondary: 'rgba(0, 217, 255, 0.7)',
  textTertiary:  'rgba(0, 217, 255, 0.5)',
  textMuted:     'rgba(0, 217, 255, 0.35)',
  textDim:       'rgba(0, 217, 255, 0.2)',
  textGhost:     'rgba(0, 217, 255, 0.1)',

  // ── Legacy aliases (for components not yet migrated) ──────────────────────
  cardBg:      '#07090E',
  cardBorder:  'rgba(0, 217, 255, 0.2)',
  accentSec:   '#00D9FF',
};

// ── Font stacks — monospaced terminal aesthetic ───────────────────────────────
export const MONO    = "'Share Tech Mono', 'JetBrains Mono', 'Courier New', monospace";
export const DISPLAY = "'Orbitron', 'Share Tech Mono', monospace";

// Legacy aliases
export const BARLOW  = DISPLAY;
export const SANS    = MONO;

// ── Premium tokens (v4 redesign) ─────────────────────────────────────────────
// Additive layer on top of C / MONO / DISPLAY. Existing code keeps working.
// Use these for hero sections, premium cards, and new surfaces.

// Fluid typographic scale — designed for a "one dominant element per screen" look.
export const SCALE = {
  hero:     'clamp(2.4rem, 6vw, 4.5rem)',   // HeroCard title
  display:  'clamp(1.6rem, 3.8vw, 2.6rem)', // primary verdict / score
  title:    'clamp(1.1rem, 2.2vw, 1.4rem)', // card titles
  body:     '0.92rem',
  label:    '0.72rem',                       // HUD / section labels
  micro:    '0.62rem',                       // meta tags, timestamps
};

// Gradients — used as backgrounds or overlays on HeroCard / premium rails.
// Each ends in transparent so it layers cleanly on #000.
export const GRAD = {
  heroOrange: 'radial-gradient(120% 80% at 0% 0%, rgba(255,102,0,0.22) 0%, rgba(255,102,0,0.04) 45%, transparent 70%)',
  heroCyan:   'radial-gradient(120% 80% at 100% 0%, rgba(0,217,255,0.18) 0%, rgba(0,217,255,0.04) 45%, transparent 70%)',
  heroGreen:  'radial-gradient(120% 80% at 50% 100%, rgba(0,255,136,0.16) 0%, rgba(0,255,136,0.03) 50%, transparent 75%)',
  // Vertical fade used to darken bottom of hero imagery so text stays readable.
  fadeBottom: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.7) 70%, #000 100%)',
  // Diagonal sweep for surfaces that need "motion" without animation.
  sweep:      'linear-gradient(135deg, rgba(0,217,255,0.04) 0%, transparent 40%, transparent 60%, rgba(255,102,0,0.04) 100%)',
  // Edge bar fill — cyan → orange gradient communicating edge/confidence.
  edgeBar:    `linear-gradient(90deg, #00D9FF 0%, #00FF88 50%, #FF6600 100%)`,
};

// Shadow ramp — depth for premium surfaces. Layered glows, not grey blurs.
export const SHADOW = {
  sm: '0 2px 12px rgba(0,0,0,0.6)',
  md: '0 8px 32px rgba(0,0,0,0.8), 0 0 1px rgba(0,217,255,0.2)',
  lg: '0 16px 48px rgba(0,0,0,0.9), 0 0 24px rgba(0,217,255,0.08)',
  heroOrange: '0 20px 60px rgba(0,0,0,0.95), 0 0 40px rgba(255,102,0,0.18)',
  heroCyan:   '0 20px 60px rgba(0,0,0,0.95), 0 0 40px rgba(0,217,255,0.18)',
  heroGreen:  '0 20px 60px rgba(0,0,0,0.95), 0 0 40px rgba(0,255,136,0.18)',
};

// Radius — we stay square (terminal identity) except one optional premium radius.
export const RADIUS = {
  none: 0,
  sharp: 2,        // barely-there softening for rail chips
};

// Spacing rhythm — 4pt grid aligned with MUI's 8pt (MUI spacing = x * 8).
// Use SPACE.md instead of writing '16px' literals in premium components.
export const SPACE = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '40px',
  xxl: '64px',
};

// Animation timing — all premium components share these easings so the
// product feels coherent in motion, not a collage of 5 different curves.
export const EASE = {
  // Expressive easeOutExpo — snap in, settle.
  out:    [0.16, 1, 0.3, 1],
  // Gentle easeInOutCubic — for drill-downs and morphs.
  inOut:  [0.65, 0, 0.35, 1],
  // Spring-like easeOutBack — for hero reveals (tiny overshoot).
  pop:    [0.34, 1.56, 0.64, 1],
};

export const DURATION = {
  fast:    0.18,
  base:    0.32,
  slow:    0.6,
  stagger: 0.04,
};

// Semantic color helper — maps an intent to its neon triplet.
// Used by InsightCard / DataChip to avoid prop-drilling 3 colors.
export const INTENT = {
  action:  { base: C.accent, line: C.accentLine, dim: C.accentDim, glow: C.accentGlow },
  data:    { base: C.cyan,   line: C.cyanLine,   dim: C.cyanDim,   glow: C.cyanGlow },
  success: { base: C.green,  line: C.greenLine,  dim: C.greenDim,  glow: C.greenGlow },
  warn:    { base: C.amber,  line: C.amberLine,  dim: C.amberDim,  glow: C.accentGlow },
  danger:  { base: C.red,    line: C.redLine,    dim: C.redDim,    glow: C.accentGlow },
};
