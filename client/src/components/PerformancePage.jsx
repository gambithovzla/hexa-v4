/**
 * PerformancePage.jsx — H.E.X.A. V4
 *
 * Public landing page mounted at /performance.
 * Renders PerformanceDashboard as a full-page takeover.
 * The back button navigates to the app root (/).
 *
 * No auth required — accessible by anyone. Admins who visit with a valid
 * token see the public-visibility toggle; everyone else sees a read-only
 * dashboard.
 */

import { useEffect, useState } from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { theme as themeConfig } from '../styles/theme';
import PerformanceDashboard from '../pages/PerformanceDashboard';

const muiTheme = createTheme(themeConfig);
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function PerformancePage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [performancePublic, setPerformancePublic] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('hexa_token');
    if (token) {
      fetch(`${API_URL}/api/auth/is-admin`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(data => setIsAdmin(Boolean(data?.isAdmin)))
        .catch(() => setIsAdmin(false));
    }
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/settings/performance-public`)
      .then(r => r.json())
      .then(data => setPerformancePublic(Boolean(data?.enabled)))
      .catch(() => setPerformancePublic(false));
  }, []);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <PerformanceDashboard
        onBack={() => { window.location.href = '/'; }}
        isAdmin={isAdmin}
        performancePublic={performancePublic}
        onTogglePublic={setPerformancePublic}
      />
    </ThemeProvider>
  );
}
