/**
 * ThemeProvider — active-palette source of truth.
 *
 * Wraps the whole app (in main.jsx) and exposes the HEXA theme via the
 * useHexaTheme() hook. Owns two concerns:
 *
 *   1. Brand preference:  'classic' | 'league-kinetic'  (persisted in localStorage; default league-kinetic)
 *   2. Token derivation:  builds C / GRAD / SHADOW / INTENT from the active palette
 *
 * Mode is hard-locked to 'dark' — the light variants are not in active use
 * (brand book is designed dark-first; light looked unfinished). Palette
 * files + light CSS rules stay in the codebase so the toggle can return
 * later without rebuilding the tokens.
 *
 * Applies on <html>:
 *   - `data-theme="dark"` (constant)             → CSS-var defaults in index.css
 *   - `data-brand="classic|league-kinetic"`     → drives brand override layer
 *
 * Non-migrated components keep importing { C } from '../theme' and continue
 * to see dark/classic tokens — no breaking change.
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
const BRAND_KEY = 'hexa.theme.brand';
const BRAND_LEAGUE_DEFAULT_MIGRATION_KEY = 'hexa.theme.brand.leagueDefault.v1';

// Mode is locked to 'dark'. The light palettes + light CSS rules stay in
// the codebase for now (cheap to keep, useful if the toggle returns), but
// neither the user nor the OS preference can switch it. setMode is a no-op.
const VALID_BRANDS = ['classic', 'league-kinetic'];
const DEFAULT_BRAND = 'league-kinetic';

function readStored(key, valid, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v && valid.includes(v)) return v;
  } catch { /* localStorage unavailable */ }
  return fallback;
}

function readInitialBrand() {
  if (typeof window === 'undefined') return DEFAULT_BRAND;
  try {
    const migrated = window.localStorage.getItem(BRAND_LEAGUE_DEFAULT_MIGRATION_KEY);
    if (!migrated) {
      const stored = window.localStorage.getItem(BRAND_KEY);
      if (!stored || stored === 'classic') {
        window.localStorage.setItem(BRAND_KEY, DEFAULT_BRAND);
      }
      window.localStorage.setItem(BRAND_LEAGUE_DEFAULT_MIGRATION_KEY, '1');
    }
  } catch { /* localStorage unavailable */ }
  return readStored(BRAND_KEY, VALID_BRANDS, DEFAULT_BRAND);
}

// ── Context ──────────────────────────────────────────────────────────────────
const HexaThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  // Mode is hard-coded to 'dark'. The toggle that used to live in the
  // Topbar/Sidebar was removed because the brand book is designed
  // dark-first; light mode looked unfinished. setMode is kept as a no-op
  // so older callers (ThemeToggle) don't crash if they get re-introduced.
  const mode         = 'dark';
  const resolvedMode = 'dark';
  const setMode      = useCallback(() => { /* locked to dark */ }, []);

  const [brand, setBrandState] = useState(() => readInitialBrand());

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

  // Reflect brand on <html> so CSS-var layers respond. data-theme is fixed
  // to 'dark' — set once at boot and never changes. theme-color follows brand.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-brand', brand);
    document.documentElement.style.colorScheme = 'dark';

    const meta = document.getElementById('hexa-theme-color');
    if (meta) {
      meta.setAttribute('content', brand === 'league-kinetic' ? '#0B2540' : '#05080a');
    }
  }, [brand]);

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
