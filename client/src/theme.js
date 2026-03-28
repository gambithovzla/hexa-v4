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
