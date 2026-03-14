/**
 * MUI theme configuration for Hexa Oracle
 * Premium Sports Intelligence Platform palette
 */

export const theme = {
  palette: {
    mode: 'dark',
    primary: {
      main:  '#0066FF',
      light: '#00D4FF',
      dark:  '#0050CC',
    },
    secondary: {
      main:  '#00D4FF',
      light: '#66E5FF',
      dark:  '#00A0C0',
    },
    success: {
      main: '#00E676',
    },
    warning: {
      main: '#FF9800',
    },
    error: {
      main: '#FF3D57',
    },
    background: {
      default: '#04080F',
      paper:   '#0D1424',
    },
    text: {
      primary:   '#E8EDF5',
      secondary: '#5A7090',
    },
    divider: 'rgba(26,37,64,0.8)',
  },
  typography: {
    fontFamily: '"DM Sans", system-ui, sans-serif',
    h6:        { fontWeight: 700, fontFamily: '"Barlow Condensed", system-ui, sans-serif' },
    subtitle1: { fontWeight: 600 },
  },
  shape: {
    borderRadius: 2,
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border:          '1px solid #1A2540',
          borderRadius:    2,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background:   '#04080F',
          borderBottom: '1px solid #1A2540',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'uppercase',
          fontWeight:    700,
          borderRadius:  2,
          fontFamily:    '"Barlow Condensed", system-ui, sans-serif',
          letterSpacing: '0.06em',
        },
        containedPrimary: {
          background: 'linear-gradient(135deg, #0066FF 0%, #00D4FF 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #0050CC 0%, #0066FF 100%)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700, borderRadius: 2 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'uppercase',
          fontFamily:    '"Barlow Condensed", system-ui, sans-serif',
          fontWeight:    700,
          letterSpacing: '0.06em',
        },
      },
    },
  },
};
