/**
 * buildMuiTheme(palette) — returns a MUI theme config object driven by the
 * active HEXA palette. Called by ThemeProvider on every mode switch.
 *
 * The old `export const theme = { ... }` (in theme.js) is replaced by this
 * factory. Kept in the same file so existing imports of `./styles/theme`
 * continue to work via the re-export at the bottom.
 */

import darkPalette from '../palettes/dark.js';

const FONT_MONO    = '"Share Tech Mono", "JetBrains Mono", "Courier New", monospace';
const FONT_DISPLAY = '"Orbitron", "Share Tech Mono", monospace';

export function buildMuiTheme(palette) {
  const isLight = palette.mode === 'light';
  const CYAN   = palette.cyan;
  const ORANGE = palette.accent;
  const GREEN  = palette.green;
  const BG     = palette.bg;
  const CARD   = palette.surface;
  const TEXT   = palette.textPrimary;

  return {
    palette: {
      mode: palette.mode,
      primary: {
        main:  ORANGE,
        light: isLight ? '#E06A2A' : '#FF8833',
        dark:  isLight ? '#932F00' : '#CC4400',
      },
      secondary: {
        main:  CYAN,
        light: isLight ? '#3A819C' : '#33E5FF',
        dark:  isLight ? '#00435A' : '#0099CC',
      },
      success: { main: GREEN },
      warning: { main: palette.amber },
      error:   { main: palette.red },
      background: {
        default: BG,
        paper:   CARD,
      },
      text: {
        primary:   TEXT,
        secondary: palette.textSecondary,
      },
      divider: palette.borderLight,
    },
    typography: {
      fontFamily: FONT_MONO,
      h1: { fontFamily: FONT_DISPLAY, fontWeight: 700, letterSpacing: '0.1em' },
      h2: { fontFamily: FONT_DISPLAY, fontWeight: 700, letterSpacing: '0.08em' },
      h3: { fontFamily: FONT_DISPLAY, fontWeight: 600, letterSpacing: '0.06em' },
      h4: { fontFamily: FONT_DISPLAY, fontWeight: 600, letterSpacing: '0.06em' },
      h5: { fontFamily: FONT_DISPLAY, fontWeight: 600, letterSpacing: '0.04em' },
      h6: { fontFamily: FONT_DISPLAY, fontWeight: 600, letterSpacing: '0.04em' },
      subtitle1: { fontFamily: FONT_MONO, fontWeight: 400, letterSpacing: '0.06em' },
      subtitle2: { fontFamily: FONT_MONO, fontWeight: 400, letterSpacing: '0.06em' },
      body1:     { fontFamily: FONT_MONO, letterSpacing: '0.03em' },
      body2:     { fontFamily: FONT_MONO, letterSpacing: '0.03em' },
      button:    { fontFamily: FONT_MONO, letterSpacing: '0.1em' },
      caption:   { fontFamily: FONT_MONO, letterSpacing: '0.08em' },
      overline:  { fontFamily: FONT_MONO, letterSpacing: '0.12em' },
    },
    shape: { borderRadius: 0 },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            background:      CARD,
            border:          `1px solid ${palette.cyanLine}`,
            borderRadius:    0,
            boxShadow:       isLight
              ? '0 1px 3px rgba(10,16,20,0.06)'
              : `inset 0 0 40px rgba(0,0,0,0.8), 0 0 1px rgba(0,217,255,0.1)`,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            background:      CARD,
            border:          `1px solid ${palette.borderLight}`,
            borderRadius:    0,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            background:   isLight
              ? 'rgba(255, 255, 255, 0.92)'
              : 'rgba(0, 0, 0, 0.95)',
            borderBottom: `1px solid ${palette.cyanLine}`,
            boxShadow:    isLight
              ? '0 1px 2px rgba(10,16,20,0.05), 0 1px 0 rgba(0,93,125,0.12)'
              : `0 0 20px rgba(0,0,0,0.8), 0 1px 0 rgba(0,217,255,0.15)`,
            backdropFilter: 'blur(8px)',
            color: TEXT,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform:  'uppercase',
            fontWeight:     400,
            borderRadius:   0,
            fontFamily:     FONT_MONO,
            letterSpacing:  '0.12em',
            fontSize:       '0.75rem',
            padding:        '8px 20px',
            transition:     'all 0.2s ease',
          },
          containedPrimary: {
            background:  ORANGE,
            color:       isLight ? '#FFFFFF' : '#000000',
            border:      `1px solid ${ORANGE}`,
            boxShadow:   isLight
              ? '0 2px 6px rgba(196,66,0,0.25)'
              : `0 0 12px rgba(255,102,0,0.4)`,
            '&:hover': {
              background: isLight ? '#A93800' : '#FF8833',
              boxShadow:  isLight
                ? '0 4px 12px rgba(196,66,0,0.35)'
                : `0 0 20px rgba(255,102,0,0.7), 0 0 40px rgba(255,102,0,0.3)`,
            },
          },
          containedSecondary: {
            background:  CYAN,
            color:       isLight ? '#FFFFFF' : '#000000',
            border:      `1px solid ${CYAN}`,
            boxShadow:   isLight
              ? '0 2px 6px rgba(0,93,125,0.25)'
              : `0 0 12px rgba(0,217,255,0.4)`,
            '&:hover': {
              background: isLight ? '#00435A' : '#33E5FF',
              boxShadow:  isLight
                ? '0 4px 12px rgba(0,93,125,0.35)'
                : `0 0 20px rgba(0,217,255,0.7), 0 0 40px rgba(0,217,255,0.3)`,
            },
          },
          outlined: {
            borderColor: palette.cyanLine,
            color:       CYAN,
            '&:hover': {
              borderColor: CYAN,
              background:  palette.cyanDim,
              boxShadow:   palette.cyanGlow !== 'none' ? `0 0 12px rgba(0,217,255,0.3)` : 'none',
            },
          },
          outlinedPrimary: {
            borderColor: palette.accentLine,
            color:       ORANGE,
            '&:hover': {
              borderColor: ORANGE,
              background:  palette.accentDim,
              boxShadow:   palette.accentGlow !== 'none' ? `0 0 12px rgba(255,102,0,0.3)` : 'none',
            },
          },
          text: {
            color: CYAN,
            '&:hover': {
              background: palette.cyanDim,
              color:      isLight ? palette.textPrimary : '#FFFFFF',
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            color:        CYAN,
            borderRadius: 0,
            transition:   'all 0.2s ease',
            '&:hover': {
              background: palette.cyanDim,
              color:      isLight ? palette.textPrimary : '#FFFFFF',
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontFamily:    FONT_MONO,
            fontWeight:    400,
            borderRadius:  0,
            letterSpacing: '0.08em',
            fontSize:      '0.7rem',
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform:  'uppercase',
            fontFamily:     FONT_MONO,
            fontWeight:     400,
            letterSpacing:  '0.1em',
            fontSize:       '0.72rem',
            color:          palette.textTertiary,
            '&.Mui-selected': { color: CYAN },
            '&:hover': {
              color:      CYAN,
              background: palette.cyanDim,
            },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: {
            backgroundColor: CYAN,
            boxShadow:       palette.cyanGlow !== 'none' ? `0 0 8px ${CYAN}` : 'none',
            height:          1,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            fontFamily:   FONT_MONO,
            borderRadius: 0,
            background:   isLight ? '#FFFFFF' : 'rgba(0, 217, 255, 0.03)',
            '& .MuiOutlinedInput-notchedOutline': { borderColor: palette.border },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: palette.cyanLine },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: CYAN,
              boxShadow:   `0 0 0 1px ${palette.cyanLine}`,
            },
          },
          input: {
            fontFamily:    FONT_MONO,
            letterSpacing: '0.04em',
            color:         TEXT,
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            fontFamily:    FONT_MONO,
            letterSpacing: '0.08em',
            color:         palette.textTertiary,
            fontSize:      '0.75rem',
            '&.Mui-focused': { color: CYAN },
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          icon: { color: palette.textTertiary },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            fontFamily:    FONT_MONO,
            letterSpacing: '0.04em',
            background:    CARD,
            '&:hover':          { background: palette.cyanDim },
            '&.Mui-selected':   { background: palette.cyanDim, color: CYAN },
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            background: palette.surfaceAlt,
            border:     `1px solid ${palette.cyanLine}`,
            boxShadow:  isLight
              ? '0 8px 32px rgba(10,16,20,0.14)'
              : `0 8px 32px rgba(0,0,0,0.9), 0 0 20px rgba(0,217,255,0.1)`,
            borderRadius: 0,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            background:   palette.surfaceAlt,
            border:       `1px solid ${palette.cyanLine}`,
            borderRadius: 0,
            boxShadow:    isLight
              ? '0 16px 48px rgba(10,16,20,0.16)'
              : `0 0 60px rgba(0,0,0,0.95), 0 0 30px rgba(0,217,255,0.1)`,
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: { borderColor: palette.borderLight },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            fontFamily:    FONT_MONO,
            background:    palette.surfaceAlt,
            border:        `1px solid ${palette.cyanLine}`,
            color:         CYAN,
            borderRadius:  0,
            letterSpacing: '0.06em',
            fontSize:      '0.7rem',
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            borderRadius: 0,
            background:   palette.cyanDim,
            height:       2,
          },
          bar: {
            background: `linear-gradient(90deg, ${CYAN}, ${ORANGE})`,
            boxShadow:  palette.cyanGlow !== 'none' ? `0 0 8px rgba(0,217,255,0.5)` : 'none',
          },
        },
      },
      MuiCircularProgress: {
        styleOverrides: { root: { color: CYAN } },
      },
      MuiSlider: {
        styleOverrides: {
          root:  { color: CYAN },
          thumb: { boxShadow: palette.cyanGlow !== 'none' ? `0 0 8px rgba(0,217,255,0.6)` : '0 1px 3px rgba(10,16,20,0.15)' },
          track: { boxShadow: palette.cyanGlow !== 'none' ? `0 0 4px rgba(0,217,255,0.4)` : 'none' },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          switchBase: {
            '&.Mui-checked': { color: CYAN },
            '&.Mui-checked + .MuiSwitch-track': { backgroundColor: palette.cyanLine },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            fontFamily:    FONT_MONO,
            borderBottom:  `1px solid ${palette.borderLight}`,
            letterSpacing: '0.04em',
            fontSize:      '0.75rem',
          },
          head: {
            color:         CYAN,
            letterSpacing: '0.1em',
            fontWeight:    400,
            background:    palette.cyanDim,
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            background:  BG,
            color:       TEXT,
            fontFamily:  FONT_MONO,
            scrollbarColor: `${palette.cyanLine} ${BG}`,
            scrollbarWidth: 'thin',
          },
        },
      },
    },
  };
}

// ── Backwards-compat export ─────────────────────────────────────────────────
// Old code does `import { theme } from './styles/theme'`. That import still
// works and resolves to the dark MUI theme (the hook is the new path forward).
export const theme = buildMuiTheme(darkPalette);
