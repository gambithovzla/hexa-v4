/**
 * Dark palette — HEXA's cyberpunk dashboard look (post-redesign).
 *
 * History: this used to be `pure black + #00D9FF cyan + #FF6600 orange`. The
 * cyberpunk redesign (handoff `design_handoff_hexa_upgrade`) shifts the
 * palette one step bluer/cleaner and introduces a layered-panel background
 * system (`bg-1/2/3`) on top of the canvas.
 *
 * BACKWARDS COMPAT: every legacy key (bg, surface, accent, cyan, green…)
 * still exists. We only changed their *values*. New tokens (`bg1`, `bg2`,
 * `bg3`, `line`, `lineStrong`, `ink0..3`, `red` family, `warn`) are added.
 */

export const darkPalette = {
  mode: 'dark',

  // ── Canvas + panel layers (new cyberpunk system) ────────────────────────
  bg:          '#05080a',  // canvas
  bg1:         '#0a1015',  // panel base
  bg2:         '#0f1820',  // panel raised
  bg3:         '#15212c',  // panel raised+

  // Legacy aliases (so existing components still resolve)
  surface:     '#0a1015',
  surfaceAlt:  '#05080a',
  elevated:    '#0f1820',

  // ── Borders ─────────────────────────────────────────────────────────────
  line:        '#1a2c38',
  lineStrong:  '#25404f',
  border:      'rgba(34, 240, 255, 0.22)',
  borderLight: 'rgba(34, 240, 255, 0.10)',

  // ── Neon Orange (CTAs críticos) ─────────────────────────────────────────
  accent:      '#FF7A1A',
  accentDim:   'rgba(255, 122, 26, 0.10)',
  accentLine:  'rgba(255, 122, 26, 0.32)',
  accentGlow:  '0 0 10px rgba(255,122,26,0.55), 0 0 24px rgba(255,122,26,0.22)',

  // ── Electric Cyan (primario) ────────────────────────────────────────────
  cyan:        '#22F0FF',
  cyanDim:     'rgba(34, 240, 255, 0.10)',
  cyanLine:    'rgba(34, 240, 255, 0.28)',
  cyanGlow:    '0 0 10px rgba(34,240,255,0.50), 0 0 24px rgba(34,240,255,0.20)',

  // ── Neon Green (wins / live) ────────────────────────────────────────────
  green:       '#2BFF88',
  greenDim:    'rgba(43, 255, 136, 0.10)',
  greenLine:   'rgba(43, 255, 136, 0.28)',
  greenGlow:   '0 0 10px rgba(43,255,136,0.50), 0 0 24px rgba(43,255,136,0.20)',

  // ── Pink (losses) — new ─────────────────────────────────────────────────
  pink:        '#FF3D6E',
  pinkDim:     'rgba(255, 61, 110, 0.10)',
  pinkLine:    'rgba(255, 61, 110, 0.28)',
  pinkGlow:    '0 0 10px rgba(255,61,110,0.50), 0 0 24px rgba(255,61,110,0.20)',

  // ── Semantic ────────────────────────────────────────────────────────────
  amber:       '#FFD23F',
  amberDim:    'rgba(255, 210, 63, 0.10)',
  amberLine:   'rgba(255, 210, 63, 0.28)',
  warn:        '#FFD23F',
  red:         '#FF3D6E',
  redDim:      'rgba(255, 61, 110, 0.10)',
  redLine:     'rgba(255, 61, 110, 0.28)',

  // ── Text (ink scale) ────────────────────────────────────────────────────
  ink0:        '#e6f7ff',
  ink1:        '#aac4d2',
  ink2:        '#6f8a98',
  ink3:        '#3d5563',
  textPrimary:   '#e6f7ff',
  textSecondary: '#aac4d2',
  textTertiary:  '#6f8a98',
  textMuted:     '#6f8a98',
  textDim:       '#3d5563',
  textGhost:     'rgba(170, 196, 210, 0.18)',

  // ── Legacy aliases ──────────────────────────────────────────────────────
  cardBg:      '#0a1015',
  cardBorder:  'rgba(34, 240, 255, 0.22)',
  accentSec:   '#22F0FF',

  // ── Meta flags ──────────────────────────────────────────────────────────
  glowsEnabled:     true,
  scanlinesEnabled: true,
};

export default darkPalette;
