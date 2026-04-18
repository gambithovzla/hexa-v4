/**
 * Light palette — "Day terminal".
 *
 * Design intent: HEXA at noon. The sci-fi terminal identity survives but
 * translates to ink-on-paper. Background is a warm cream (not clinical
 * white); accents are the same hues as dark mode but deep and saturated
 * enough to read on light without the neon glow. Glows disabled entirely —
 * they look grimy on light surfaces.
 *
 * Every key mirrors darkPalette exactly so the hook can swap them 1:1.
 */

export const lightPalette = {
  mode: 'light',

  // ── Backgrounds — warm paper ───────────────────────────────────────────
  bg:          '#F5F2EB',   // cream paper (main canvas)
  surface:     '#FFFFFF',   // card face
  surfaceAlt:  '#EEE9DE',   // nested / expanded drawer
  elevated:    '#FFFFFF',

  // ── Borders — deep teal instead of neon cyan ───────────────────────────
  border:      'rgba(0, 93, 125, 0.24)',
  borderLight: 'rgba(0, 93, 125, 0.12)',

  // ── Deep Orange (was Neon Orange) ──────────────────────────────────────
  accent:      '#C44200',
  accentDim:   'rgba(196, 66, 0, 0.08)',
  accentLine:  'rgba(196, 66, 0, 0.35)',
  accentGlow:  'none',

  // ── Deep Teal (was Electric Cyan) ──────────────────────────────────────
  cyan:        '#005D7D',
  cyanDim:     'rgba(0, 93, 125, 0.08)',
  cyanLine:    'rgba(0, 93, 125, 0.28)',
  cyanGlow:    'none',

  // ── Forest Green (was Neon Green) ──────────────────────────────────────
  green:       '#007A40',
  greenDim:    'rgba(0, 122, 64, 0.08)',
  greenLine:   'rgba(0, 122, 64, 0.28)',
  greenGlow:   'none',

  // ── Semantic ───────────────────────────────────────────────────────────
  amber:       '#A05E00',
  amberDim:    'rgba(160, 94, 0, 0.08)',
  amberLine:   'rgba(160, 94, 0, 0.3)',
  red:         '#A8173A',
  redDim:      'rgba(168, 23, 58, 0.08)',
  redLine:     'rgba(168, 23, 58, 0.3)',

  // ── Text — near-black ink on cream ─────────────────────────────────────
  textPrimary:   '#0A1014',
  textSecondary: 'rgba(10, 16, 20, 0.72)',
  textTertiary:  'rgba(10, 16, 20, 0.58)',
  textMuted:     'rgba(10, 16, 20, 0.44)',
  textDim:       'rgba(10, 16, 20, 0.26)',
  textGhost:     'rgba(10, 16, 20, 0.12)',

  // ── Legacy aliases ─────────────────────────────────────────────────────
  cardBg:      '#FFFFFF',
  cardBorder:  'rgba(0, 93, 125, 0.24)',
  accentSec:   '#005D7D',

  // ── Meta flags ─────────────────────────────────────────────────────────
  glowsEnabled:     false,
  scanlinesEnabled: false,
};

export default lightPalette;
