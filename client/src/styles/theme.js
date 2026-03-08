/**
 * MUI theme configuration for Hexa Oracle
 * Dark baseball-inspired palette
 */

export const theme = {
  palette: {
    mode: 'dark',
    primary: {
      main: '#0A84FF',      // Electric blue
      light: '#5AC8FA',
      dark: '#0060CC',
    },
    secondary: {
      main: '#FF375F',      // MLB red accent
      light: '#FF6B8A',
      dark: '#CC002E',
    },
    success: {
      main: '#34C759',
    },
    warning: {
      main: '#FF9F0A',
    },
    error: {
      main: '#FF3B30',
    },
    background: {
      default: '#0D0D0D',
      paper: '#1A1A2E',
    },
    text: {
      primary: '#F5F5F7',
      secondary: '#A1A1AA',
    },
    divider: 'rgba(255,255,255,0.08)',
  },
  typography: {
    fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
    h6: { fontWeight: 700 },
    subtitle1: { fontWeight: 600 },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'linear-gradient(135deg, #0D0D0D 0%, #1A1A2E 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
        },
        containedPrimary: {
          background: 'linear-gradient(135deg, #0A84FF 0%, #0060CC 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #5AC8FA 0%, #0A84FF 100%)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none' },
      },
    },
  },
};
