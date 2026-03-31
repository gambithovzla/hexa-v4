/**
 * PerformancePage.jsx — H.E.X.A. V4
 *
 * Public landing page mounted at /performance.
 * Renders PerformanceDashboard as a full-page takeover.
 * The back button navigates to the app root (/).
 *
 * No auth required — accessible by anyone.
 */

import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { theme as themeConfig } from '../styles/theme';
import PerformanceDashboard from '../pages/PerformanceDashboard';

const muiTheme = createTheme(themeConfig);

export default function PerformancePage() {
  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <PerformanceDashboard onBack={() => { window.location.href = '/'; }} />
    </ThemeProvider>
  );
}
