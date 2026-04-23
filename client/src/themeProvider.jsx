/**
 * ThemeProvider — active-palette source of truth.
 *
 * Wraps the whole app (in main.jsx) and exposes the HEXA theme via the
 * useHexaTheme() hook. Owns three concerns:
 *
 *   1. User preference:   'light' | 'dark' | 'system'  (persisted in localStorage)
 *   2. System resolution: if preference is 'system', listen to prefers-color-scheme
 *   3. Token derivation:  builds C / GRAD / SHADOW / INTENT from the active palette
 *
 * Also applies:
 *   - `data-theme="light|dark"` on the root <html> element, so index.css
 *     CSS variables can swap under [data-theme="..."] selectors.
 *   - The MUI ThemeProvider (so MUI components recolor automatically).
 *
 * Non-migrated components keep importing { C } from '../theme' and continue
 * to see dark tokens — no breaking change. Components opting in to theming
 * switch their imports to `const { C } = useHexaTheme()`.
 */

import { createContext, useContext, useEffect, useMemo } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme, CssBaseline } from '@mui/material';
import darkPalette from './palettes/dark.js';
import { buildTokens, MONO, DISPLAY, SCALE, SPACE, EASE, DURATION, RADIUS } from './theme.js';
import { buildMuiTheme } from './styles/muiTheme.js';

// ── Context ──────────────────────────────────────────────────────────────────
const HexaThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const mode         = 'dark';
  const resolvedMode = 'dark';
  const setMode      = () => {};  // theme is fixed — no-op
  const palette = darkPalette;

  // Rebuild palette-dependent tokens whenever the effective palette changes.
  const tokens = useMemo(() => buildTokens(palette), [palette]);

  // Build the MUI theme from the same palette — MUI components follow.
  const muiTheme = useMemo(() => createTheme(buildMuiTheme(palette)), [palette]);

  // Reflect the active theme on <html> so index.css vars respond.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', resolvedMode);
    // Hint to the browser so form controls / scrollbars pick the right defaults.
    document.documentElement.style.colorScheme = resolvedMode;
  }, [resolvedMode]);

  const value = useMemo(() => ({
    // Static, palette-independent bundle for convenience
    MONO, DISPLAY, SCALE, SPACE, EASE, DURATION, RADIUS,
    // Palette-dependent, rebuilt on mode change
    C:      tokens.C,
    GRAD:   tokens.GRAD,
    SHADOW: tokens.SHADOW,
    INTENT: tokens.INTENT,
    // Mode controls
    mode,            // what the user selected: 'light' | 'dark' | 'system'
    resolvedMode,    // what is actually rendered: 'light' | 'dark'
    setMode,
    isLight: resolvedMode === 'light',
    isDark:  resolvedMode === 'dark',
  }), [tokens, mode, resolvedMode]);

  return (
    <HexaThemeContext.Provider value={value}>
      <MuiThemeProvider theme={muiTheme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </HexaThemeContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useHexaTheme() {
  const ctx = useContext(HexaThemeContext);
  if (!ctx) {
    throw new Error('useHexaTheme() must be used inside <ThemeProvider>. Check main.jsx.');
  }
  return ctx;
}
