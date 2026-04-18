/**
 * Legacy entry — kept so old imports (`import { theme } from './styles/theme'`)
 * continue to resolve. The real MUI theme is now built dynamically by
 * buildMuiTheme(palette) in ./muiTheme.js, invoked by ThemeProvider.
 *
 * This static export is a dark-mode snapshot used as a fallback only.
 */

export { theme, buildMuiTheme } from './muiTheme.js';
