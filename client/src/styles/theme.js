/**
 * H.E.X.A. V4 — MUI Theme | Sci-Fi Terminal Aesthetic
 */

const FONT_MONO    = '"Share Tech Mono", "JetBrains Mono", "Courier New", monospace';
const FONT_DISPLAY = '"Orbitron", "Share Tech Mono", monospace';

const CYAN   = '#00D9FF';
const ORANGE = '#FF6600';
const GREEN  = '#00FF88';
const BLACK  = '#000000';
const CARD   = '#07090E';

export const theme = {
  palette: {
    mode: 'dark',
    primary: {
      main:  ORANGE,
      light: '#FF8833',
      dark:  '#CC4400',
    },
    secondary: {
      main:  CYAN,
      light: '#33E5FF',
      dark:  '#0099CC',
    },
    success: {
      main: GREEN,
    },
    warning: {
      main: '#FF9900',
    },
    error: {
      main: '#FF2244',
    },
    background: {
      default: BLACK,
      paper:   CARD,
    },
    text: {
      primary:   '#E8F4FF',
      secondary: 'rgba(0, 217, 255, 0.6)',
    },
    divider: 'rgba(0, 217, 255, 0.15)',
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
  shape: {
    borderRadius: 0,
  },
  components: {
    // ── Card ─────────────────────────────────────────────────────────────────
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          background:      CARD,
          border:          `1px solid rgba(0, 217, 255, 0.2)`,
          borderRadius:    0,
          boxShadow:       `inset 0 0 40px rgba(0,0,0,0.8), 0 0 1px rgba(0,217,255,0.1)`,
        },
      },
    },
    // ── Paper ─────────────────────────────────────────────────────────────────
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          background:      CARD,
          border:          `1px solid rgba(0, 217, 255, 0.15)`,
          borderRadius:    0,
        },
      },
    },
    // ── AppBar ────────────────────────────────────────────────────────────────
    MuiAppBar: {
      styleOverrides: {
        root: {
          background:   `rgba(0, 0, 0, 0.95)`,
          borderBottom: `1px solid rgba(0, 217, 255, 0.25)`,
          boxShadow:    `0 0 20px rgba(0,0,0,0.8), 0 1px 0 rgba(0,217,255,0.15)`,
          backdropFilter: 'blur(8px)',
        },
      },
    },
    // ── Button ────────────────────────────────────────────────────────────────
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
          color:       '#000000',
          border:      `1px solid ${ORANGE}`,
          boxShadow:   `0 0 12px rgba(255,102,0,0.4)`,
          '&:hover': {
            background: '#FF8833',
            boxShadow:  `0 0 20px rgba(255,102,0,0.7), 0 0 40px rgba(255,102,0,0.3)`,
          },
        },
        containedSecondary: {
          background:  CYAN,
          color:       '#000000',
          border:      `1px solid ${CYAN}`,
          boxShadow:   `0 0 12px rgba(0,217,255,0.4)`,
          '&:hover': {
            background: '#33E5FF',
            boxShadow:  `0 0 20px rgba(0,217,255,0.7), 0 0 40px rgba(0,217,255,0.3)`,
          },
        },
        outlined: {
          borderColor:  `rgba(0, 217, 255, 0.4)`,
          color:        CYAN,
          '&:hover': {
            borderColor: CYAN,
            background:  `rgba(0, 217, 255, 0.06)`,
            boxShadow:   `0 0 12px rgba(0,217,255,0.3)`,
          },
        },
        outlinedPrimary: {
          borderColor: `rgba(255, 102, 0, 0.4)`,
          color:       ORANGE,
          '&:hover': {
            borderColor: ORANGE,
            background:  `rgba(255, 102, 0, 0.06)`,
            boxShadow:   `0 0 12px rgba(255,102,0,0.3)`,
          },
        },
        text: {
          color: CYAN,
          '&:hover': {
            background:  `rgba(0, 217, 255, 0.06)`,
            color:       '#FFFFFF',
          },
        },
      },
    },
    // ── IconButton ────────────────────────────────────────────────────────────
    MuiIconButton: {
      styleOverrides: {
        root: {
          color:        CYAN,
          borderRadius: 0,
          transition:   'all 0.2s ease',
          '&:hover': {
            background: `rgba(0, 217, 255, 0.08)`,
            color:      '#FFFFFF',
          },
        },
      },
    },
    // ── Chip ─────────────────────────────────────────────────────────────────
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
    // ── Tab ──────────────────────────────────────────────────────────────────
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform:  'uppercase',
          fontFamily:     FONT_MONO,
          fontWeight:     400,
          letterSpacing:  '0.1em',
          fontSize:       '0.72rem',
          color:          'rgba(0, 217, 255, 0.5)',
          '&.Mui-selected': {
            color: CYAN,
          },
          '&:hover': {
            color:      CYAN,
            background: `rgba(0, 217, 255, 0.05)`,
          },
        },
      },
    },
    // ── Tabs indicator ───────────────────────────────────────────────────────
    MuiTabs: {
      styleOverrides: {
        indicator: {
          backgroundColor: CYAN,
          boxShadow:       `0 0 8px ${CYAN}`,
          height:          1,
        },
      },
    },
    // ── Input / TextField ────────────────────────────────────────────────────
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          fontFamily:   FONT_MONO,
          borderRadius: 0,
          background:   `rgba(0, 217, 255, 0.03)`,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: `rgba(0, 217, 255, 0.2)`,
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: `rgba(0, 217, 255, 0.5)`,
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: CYAN,
            boxShadow:   `0 0 0 1px rgba(0,217,255,0.3)`,
          },
        },
        input: {
          fontFamily:    FONT_MONO,
          letterSpacing: '0.04em',
          color:         '#E8F4FF',
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontFamily:    FONT_MONO,
          letterSpacing: '0.08em',
          color:         'rgba(0, 217, 255, 0.5)',
          fontSize:      '0.75rem',
          '&.Mui-focused': {
            color: CYAN,
          },
        },
      },
    },
    // ── Select ───────────────────────────────────────────────────────────────
    MuiSelect: {
      styleOverrides: {
        icon: {
          color: `rgba(0, 217, 255, 0.5)`,
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontFamily:    FONT_MONO,
          letterSpacing: '0.04em',
          background:    CARD,
          '&:hover': {
            background: `rgba(0, 217, 255, 0.08)`,
          },
          '&.Mui-selected': {
            background: `rgba(0, 217, 255, 0.12)`,
            color:      CYAN,
          },
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          background: '#050508',
          border:     `1px solid rgba(0, 217, 255, 0.2)`,
          boxShadow:  `0 8px 32px rgba(0,0,0,0.9), 0 0 20px rgba(0,217,255,0.1)`,
          borderRadius: 0,
        },
      },
    },
    // ── Dialog / Modal ───────────────────────────────────────────────────────
    MuiDialog: {
      styleOverrides: {
        paper: {
          background:   '#050508',
          border:       `1px solid rgba(0, 217, 255, 0.25)`,
          borderRadius: 0,
          boxShadow:    `0 0 60px rgba(0,0,0,0.95), 0 0 30px rgba(0,217,255,0.1)`,
        },
      },
    },
    // ── Divider ───────────────────────────────────────────────────────────────
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: `rgba(0, 217, 255, 0.12)`,
        },
      },
    },
    // ── Tooltip ───────────────────────────────────────────────────────────────
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontFamily:    FONT_MONO,
          background:    '#050508',
          border:        `1px solid rgba(0, 217, 255, 0.25)`,
          color:         CYAN,
          borderRadius:  0,
          letterSpacing: '0.06em',
          fontSize:      '0.7rem',
        },
      },
    },
    // ── LinearProgress ───────────────────────────────────────────────────────
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          background:   `rgba(0, 217, 255, 0.08)`,
          height:       2,
        },
        bar: {
          background: `linear-gradient(90deg, ${CYAN}, ${ORANGE})`,
          boxShadow:  `0 0 8px rgba(0,217,255,0.5)`,
        },
      },
    },
    // ── CircularProgress ─────────────────────────────────────────────────────
    MuiCircularProgress: {
      styleOverrides: {
        root: {
          color: CYAN,
        },
      },
    },
    // ── Slider ───────────────────────────────────────────────────────────────
    MuiSlider: {
      styleOverrides: {
        root:  { color: CYAN },
        thumb: { boxShadow: `0 0 8px rgba(0,217,255,0.6)` },
        track: { boxShadow: `0 0 4px rgba(0,217,255,0.4)` },
      },
    },
    // ── Switch ───────────────────────────────────────────────────────────────
    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          '&.Mui-checked': {
            color: CYAN,
          },
          '&.Mui-checked + .MuiSwitch-track': {
            backgroundColor: `rgba(0, 217, 255, 0.4)`,
          },
        },
      },
    },
    // ── TableCell ────────────────────────────────────────────────────────────
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontFamily:    FONT_MONO,
          borderBottom:  `1px solid rgba(0, 217, 255, 0.1)`,
          letterSpacing: '0.04em',
          fontSize:      '0.75rem',
        },
        head: {
          color:         CYAN,
          letterSpacing: '0.1em',
          fontWeight:    400,
          background:    `rgba(0, 217, 255, 0.04)`,
        },
      },
    },
    // ── CssBaseline ──────────────────────────────────────────────────────────
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background:  '#000000',
          fontFamily:  FONT_MONO,
          scrollbarColor: `rgba(0, 217, 255, 0.2) #000000`,
          scrollbarWidth: 'thin',
        },
      },
    },
  },
};
