/**
 * ThemeProvider — active-palette source of truth.
 *
 * Wraps the whole app (in main.jsx) and exposes the HEXA theme via the
 * useHexaTheme() hook. Owns four concerns:
 *
 *   1. Mode preference:    'light' | 'dark' | 'system'  (persisted in localStorage)
 *   2. Brand preference:   'classic' | 'league-kinetic'  (persisted independently)
 *   3. System resolution:  when mode='system', listens to prefers-color-scheme
 *   4. Token derivation:   builds C / GRAD / SHADOW / INTENT from the active palette
 *
 * Applies on <html>:
 *   - `data-theme="light|dark"`    → drives :root CSS-var swap in index.css
 *   - `data-brand="classic|league-kinetic"` → drives brand override layer
 *
 * Non-migrated components keep importing { C } from '../theme' and continue
 * to see dark/classic tokens — no breaking change. Components opting in to
 * theming switch their imports to `const { C } = useHexaTheme()`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme, CssBaseline } from '@mui/material';
import darkPalette from './palettes/dark.js';
import lightPalette from './palettes/light.js';
import leagueKineticPalette from './palettes/leagueKinetic.js';
import leagueKineticLightPalette from './palettes/leagueKineticLight.js';
import { buildTokens, MONO, DISPLAY, SCALE, SPACE, EASE, DURATION, RADIUS } from './theme.js';
import { buildMuiTheme } from './styles/muiTheme.js';

// ── Storage keys ─────────────────────────────────────────────────────────────
const MODE_KEY  = 'hexa.theme.mode';
const BRAND_KEY = 'hexa.theme.brand';

// 'dark' was removed from the user-selectable mode set; SYSTEM still
// resolves to dark when the OS prefers it. Any pre-existing 'dark' value
// in localStorage gets transparently coerced to 'system' on read so
// returning users don't get stuck on an invalid option.
const VALID_MODES  = ['light', 'system'];
const VALID_BRANDS = ['classic', 'league-kinetic'];

function readStored(key, valid, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === 'dark' && key === 'hexa.theme.mode') return 'system';
    if (v && valid.includes(v)) return v;
  } catch { /* localStorage unavailable */ }
  return fallback;
}

function detectSystemMode() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// ── Context ──────────────────────────────────────────────────────────────────
const HexaThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [mode,  setModeState]  = useState(() => readStored(MODE_KEY,  VALID_MODES,  'system'));
  const [brand, setBrandState] = useState(() => readStored(BRAND_KEY, VALID_BRANDS, 'classic'));
  const [systemMode, setSystemMode] = useState(() => detectSystemMode());

  // Listen for OS-level theme changes (only matters when mode === 'system')
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e) => setSystemMode(e.matches ? 'light' : 'dark');
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else if (mq.removeListener) mq.removeListener(handler);
    };
  }, []);

  const resolvedMode = mode === 'system' ? systemMode : mode;

  const setMode = useCallback((next) => {
    if (!VALID_MODES.includes(next)) return;
    setModeState(next);
    try { window.localStorage.setItem(MODE_KEY, next); } catch { /* ignore */ }
  }, []);

  const setBrand = useCallback((next) => {
    if (!VALID_BRANDS.includes(next)) return;
    setBrandState(next);
    try { window.localStorage.setItem(BRAND_KEY, next); } catch { /* ignore */ }
  }, []);

  // Pick the active palette across the (brand × mode) matrix.
  const palette = useMemo(() => {
    if (brand === 'league-kinetic') {
      return resolvedMode === 'light' ? leagueKineticLightPalette : leagueKineticPalette;
    }
    return resolvedMode === 'light' ? lightPalette : darkPalette;
  }, [brand, resolvedMode]);

  // Rebuild palette-dependent tokens whenever the effective palette changes.
  const tokens   = useMemo(() => buildTokens(palette),              [palette]);
  const muiTheme = useMemo(() => createTheme(buildMuiTheme(palette)), [palette]);

  // Reflect mode + brand on <html> so CSS-var layers respond.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', resolvedMode);
    document.documentElement.setAttribute('data-brand', brand);
    document.documentElement.style.colorScheme = resolvedMode;

    // Keep <meta name="theme-color"> in sync with the active canvas so the
    // mobile system chrome (Android URL bar, iOS status bar) matches the
    // skin. The boot script in index.html sets the first value; this keeps
    // it live across runtime toggles.
    const meta = document.getElementById('hexa-theme-color');
    if (meta) {
      const color =
        brand === 'league-kinetic'
          ? (resolvedMode === 'light' ? '#F9F5E8' : '#0B2540')
          : (resolvedMode === 'light' ? '#F5F2EB' : '#05080a');
      meta.setAttribute('content', color);
    }
  }, [resolvedMode, brand]);

  const value = useMemo(() => ({
    // Static, palette-independent bundle for convenience
    MONO, DISPLAY, SCALE, SPACE, EASE, DURATION, RADIUS,
    // Palette-dependent, rebuilt on mode/brand change
    C:      tokens.C,
    GRAD:   tokens.GRAD,
    SHADOW: tokens.SHADOW,
    INTENT: tokens.INTENT,
    palette,
    // Mode controls
    mode,            // user selection: 'light' | 'dark' | 'system'
    resolvedMode,    // what is actually rendered: 'light' | 'dark'
    setMode,
    isLight: resolvedMode === 'light',
    isDark:  resolvedMode === 'dark',
    // Brand controls
    brand,           // 'classic' | 'league-kinetic'
    setBrand,
    isClassic: brand === 'classic',
    isLeague:  brand === 'league-kinetic',
  }), [tokens, palette, mode, resolvedMode, setMode, brand, setBrand]);

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
