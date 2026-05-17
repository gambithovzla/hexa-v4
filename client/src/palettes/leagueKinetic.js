/**
 * League × Kinetic palette — Hexa Oracle brand book v.2.6.
 *
 * Identity: official sports league authority (MLB/NFL broadcast packaging)
 * with a Red Bull-grade kinetic accent system. Navy uniform base, cream
 * paper contrast, sport-livery colors (lava red for MLB, volt yellow for
 * NBA), bronze for premium/elite. No neon glows — sober broadcast surface.
 *
 * Mirror keys exactly with darkPalette so the muiTheme factory and
 * `useHexaTheme().C` callers re-skin automatically.
 */

export const leagueKineticPalette = {
  mode: 'dark',
  brand: 'league-kinetic',

  // ── Canvas + panel layers (Navy uniform) ─────────────────────────────────
  bg:          '#061827',  // navy-deep canvas
  bg1:         '#0B2540',  // panel base — League Navy
  bg2:         '#102E54',  // panel raised
  bg3:         '#0a1d35',  // panel inset

  // Legacy aliases
  surface:     '#0B2540',
  surfaceAlt:  '#061827',
  elevated:    '#102E54',

  // ── Borders — cream hairlines on navy ────────────────────────────────────
  line:        'rgba(244, 236, 216, 0.14)',
  lineStrong:  'rgba(244, 236, 216, 0.30)',
  border:      'rgba(244, 236, 216, 0.22)',
  borderLight: 'rgba(244, 236, 216, 0.10)',

  // ── Lava (MLB livery / CTA / live) ───────────────────────────────────────
  accent:      '#E63946',
  accentDim:   'rgba(230, 57, 70, 0.10)',
  accentLine:  'rgba(230, 57, 70, 0.32)',
  accentGlow:  'none',  // brand book is explicit: no glows

  // ── Cream (primary text / "cyan-equivalent" role) ────────────────────────
  cyan:        '#F4ECD8',  // Programa Cream
  cyanDim:     'rgba(244, 236, 216, 0.10)',
  cyanLine:    'rgba(244, 236, 216, 0.28)',
  cyanGlow:    'none',

  // ── Volt (NBA livery / HIT chip / high edge) ─────────────────────────────
  green:       '#FFD60A',
  greenDim:    'rgba(255, 214, 10, 0.10)',
  greenLine:   'rgba(255, 214, 10, 0.28)',
  greenGlow:   'none',

  // ── Lava family (losses share the red — MISS chip is rgba lava) ──────────
  pink:        '#E63946',
  pinkDim:     'rgba(230, 57, 70, 0.12)',
  pinkLine:    'rgba(230, 57, 70, 0.28)',
  pinkGlow:    'none',

  // ── Semantic ─────────────────────────────────────────────────────────────
  amber:       '#B8985A',  // Bronze (championship)
  amberDim:    'rgba(184, 152, 90, 0.10)',
  amberLine:   'rgba(184, 152, 90, 0.28)',
  warn:        '#B8985A',
  red:         '#E63946',
  redDim:      'rgba(230, 57, 70, 0.10)',
  redLine:     'rgba(230, 57, 70, 0.28)',

  outcomeWin:      '#FFD60A',
  outcomeWinDim:   'rgba(255, 214, 10, 0.22)',
  outcomeWinLine:  'rgba(255, 214, 10, 0.45)',
  outcomeLoss:     '#E63946',
  outcomeLossDim:  'rgba(230, 57, 70, 0.22)',
  outcomeLossLine: 'rgba(230, 57, 70, 0.45)',
  outcomePush:     '#B8985A',
  outcomePushDim:  'rgba(184, 152, 90, 0.22)',
  outcomePushLine: 'rgba(184, 152, 90, 0.45)',

  // ── Text (cream-on-navy) ─────────────────────────────────────────────────
  ink0:        '#F4ECD8',
  ink1:        '#cfd6e0',
  ink2:        '#7a8a9d',
  ink3:        '#506378',
  textPrimary:   '#F4ECD8',
  textSecondary: '#cfd6e0',
  textTertiary:  '#7a8a9d',
  textMuted:     '#7a8a9d',
  textDim:       '#506378',
  textGhost:     'rgba(244, 236, 216, 0.18)',

  // ── Legacy aliases ───────────────────────────────────────────────────────
  cardBg:      '#0B2540',
  cardBorder:  'rgba(244, 236, 216, 0.22)',
  accentSec:   '#F4ECD8',

  // ── Brand-specific tokens (read by League components) ────────────────────
  navy:        '#0B2540',
  navyDeep:    '#061827',
  cream:       '#F4ECD8',
  cream2:      '#cfd6e0',
  lava:        '#E63946',
  lavaDeep:    '#B5101F',
  volt:        '#FFD60A',
  bronze:      '#B8985A',
  bronzeDeep:  '#8a6f3c',
  ink:         '#0a0a0a',

  // ── Meta flags ───────────────────────────────────────────────────────────
  glowsEnabled:     false,  // brand book forbids gradients/glows
  scanlinesEnabled: false,  // no CRT — broadcast surface, not terminal
};

export default leagueKineticPalette;
