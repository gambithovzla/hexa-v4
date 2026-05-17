/**
 * League × Kinetic palette — Light variant.
 *
 * Inversion of the dark brand: cream paper canvas + navy ink. Useful for
 * "programa" surfaces (the Brand Book itself prints this way). Lava and
 * volt accents stay saturated enough to read on cream without glow.
 *
 * v1 ships this as "acceptable, not pixel-perfect" — the dark variant
 * is the canonical brand presentation.
 */

export const leagueKineticLightPalette = {
  mode: 'light',
  brand: 'league-kinetic',

  // ── Cream paper canvas ───────────────────────────────────────────────────
  bg:          '#F9F5E8',
  bg1:         '#F4ECD8',
  bg2:         '#EDE6CF',
  bg3:         '#ffffff',
  surface:     '#F4ECD8',
  surfaceAlt:  '#EDE6CF',
  elevated:    '#ffffff',

  // ── Borders — navy hairlines ─────────────────────────────────────────────
  line:        'rgba(11, 37, 64, 0.15)',
  lineStrong:  'rgba(11, 37, 64, 0.30)',
  border:      'rgba(11, 37, 64, 0.18)',
  borderLight: 'rgba(11, 37, 64, 0.10)',

  // ── Lava (still red — saturation reads on cream) ────────────────────────
  accent:      '#E63946',
  accentDim:   'rgba(230, 57, 70, 0.08)',
  accentLine:  'rgba(230, 57, 70, 0.35)',
  accentGlow:  'none',

  // ── Navy ink in the "cyan" slot for primary text ────────────────────────
  cyan:        '#0B2540',
  cyanDim:     'rgba(11, 37, 64, 0.08)',
  cyanLine:    'rgba(11, 37, 64, 0.28)',
  cyanGlow:    'none',

  // ── Volt (NBA) ──────────────────────────────────────────────────────────
  green:       '#B8985A',  // bronze stands in for "win" on light because volt-on-cream is unreadable
  greenDim:    'rgba(184, 152, 90, 0.10)',
  greenLine:   'rgba(184, 152, 90, 0.28)',
  greenGlow:   'none',

  // ── Lava family for losses ──────────────────────────────────────────────
  pink:        '#B5101F',  // lava-deep on cream
  pinkDim:     'rgba(181, 16, 31, 0.08)',
  pinkLine:    'rgba(181, 16, 31, 0.3)',
  pinkGlow:    'none',

  // ── Semantic ────────────────────────────────────────────────────────────
  amber:       '#8a6f3c',  // bronze-deep
  amberDim:    'rgba(138, 111, 60, 0.08)',
  amberLine:   'rgba(138, 111, 60, 0.3)',
  warn:        '#8a6f3c',
  red:         '#B5101F',
  redDim:      'rgba(181, 16, 31, 0.08)',
  redLine:     'rgba(181, 16, 31, 0.28)',

  outcomeWin:      '#007A40',
  outcomeWinDim:   'rgba(0, 122, 64, 0.12)',
  outcomeWinLine:  'rgba(0, 122, 64, 0.35)',
  outcomeLoss:     '#B5101F',
  outcomeLossDim:  'rgba(181, 16, 31, 0.12)',
  outcomeLossLine: 'rgba(181, 16, 31, 0.35)',
  outcomePush:     '#8a6f3c',
  outcomePushDim:  'rgba(138, 111, 60, 0.14)',
  outcomePushLine: 'rgba(138, 111, 60, 0.35)',

  // ── Navy ink ────────────────────────────────────────────────────────────
  ink0:        '#0B2540',
  ink1:        'rgba(11, 37, 64, 0.78)',
  ink2:        'rgba(11, 37, 64, 0.58)',
  ink3:        'rgba(11, 37, 64, 0.38)',
  textPrimary:   '#0B2540',
  textSecondary: 'rgba(11, 37, 64, 0.72)',
  textTertiary:  'rgba(11, 37, 64, 0.55)',
  textMuted:     'rgba(11, 37, 64, 0.48)',
  textDim:       'rgba(11, 37, 64, 0.30)',
  textGhost:     'rgba(11, 37, 64, 0.12)',

  // ── Legacy aliases ──────────────────────────────────────────────────────
  cardBg:      '#ffffff',
  cardBorder:  'rgba(11, 37, 64, 0.18)',
  accentSec:   '#0B2540',

  // ── Brand-specific tokens (mirror) ──────────────────────────────────────
  navy:        '#0B2540',
  navyDeep:    '#061827',
  cream:       '#F4ECD8',
  cream2:      '#EDE6CF',
  lava:        '#E63946',
  lavaDeep:    '#B5101F',
  volt:        '#FFD60A',
  bronze:      '#B8985A',
  bronzeDeep:  '#8a6f3c',
  ink:         '#0a0a0a',

  // ── Meta flags ──────────────────────────────────────────────────────────
  glowsEnabled:     false,
  scanlinesEnabled: false,
};

export default leagueKineticLightPalette;
