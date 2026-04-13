/**
 * App.jsx — H.E.X.A. V4 root component.
 *
 * State ownership:
 *   lang        — shared with all components so Claude responds in the right language
 *   activeTab   — controls which tab panel is visible
 *   singleGame  — last game selected in the Single tab
 *   parlayGames — games selected in the Parlay tab
 *
 * History:
 *   App owns one useHistory() instance solely for addPick (write side).
 *   HistoryPanel owns its own instance for reading/mutation — it remounts
 *   on each tab visit so it always reads the latest localStorage snapshot.
 */

import { useState, useEffect } from 'react';
import { ThemeProvider, createTheme, CssBaseline, Box, Typography } from '@mui/material';
import { theme as themeConfig } from './styles/theme';
import Header               from './components/Header';
import GameSelector         from './components/GameSelector';
import AnalysisPanel        from './components/AnalysisPanel';
import HistoryPanel         from './components/HistoryPanel';
import BankrollTracker      from './components/BankrollTracker';
import OddsLab              from './components/OddsLab';
import OracleLoadingOverlay from './components/OracleLoadingOverlay';
import MethodologyPage      from './components/MethodologyPage';
import LegalPage            from './components/LegalPage';
import OracleChat          from './components/OracleChat';
import PerformanceDashboard from './pages/PerformanceDashboard';
import PerformancePage      from './components/PerformancePage';
import BatchScanPanel      from './components/BatchScanPanel';
import BacktestDashboard  from './components/BacktestDashboard';
import BacktestRunner     from './components/BacktestRunner';
import DatasetDashboard  from './components/DatasetDashboardV2';
import ShadowModeDashboard from './components/ShadowModeDashboard';
import LiveTracker         from './components/LiveTracker';
import GameDayDetail       from './components/GameDayDetail';
import useHistory           from './hooks/useHistory';
import { C, MONO, BARLOW } from './theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const muiTheme = createTheme(themeConfig);

// Two-column layout used on game / parlay tabs
const TAB_LAYOUT = {
  display:             'grid',
  gridTemplateColumns: { xs: '1fr', md: '380px 1fr' },
  gap:                 3,
  alignItems:          'start',
};

// ── Footer ────────────────────────────────────────────────────────────────────

function AppFooter() {
  return (
    <Box
      component="footer"
      sx={{
        mt:         6,
        py:         '14px',
        px:         3,
        borderTop:  `1px solid ${C.border}`,
        textAlign:  'center',
      }}
    >
      <Typography
        sx={{
          fontFamily:   BARLOW,
          fontSize:     '18px',
          fontWeight:   800,
          letterSpacing:'4px',
          color:        C.accent,
          textShadow:   '0 0 12px rgba(255,102,0,0.3)',
          userSelect:   'none',
          lineHeight:   1.2,
        }}
      >
        GAMBITHO LABS
      </Typography>
      <Typography
        sx={{
          fontFamily: MONO,
          fontSize:   '12px',
          color:      C.textMuted,
          userSelect: 'none',
          mt:         '4px',
        }}
      >
        H.E.X.A. Hybrid Expert X-Analysis
      </Typography>
    </Box>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [lang,              setLang]              = useState(() => localStorage.getItem('hexa_lang') || 'es');
  const [activeTab,         setActiveTab]         = useState('game');
  const [singleGame,        setSingleGame]        = useState(null);
  const [parlayGames,       setParlayGames]       = useState([]);
  const [batchGames,        setBatchGames]        = useState([]);
  const [selectedDate,      setSelectedDate]      = useState('');
  const [isAnalyzing,       setIsAnalyzing]       = useState(false);
  const [showMethodology,   setShowMethodology]   = useState(false);
  const [showOracleChat,    setShowOracleChat]    = useState(false);
  const [showPerformance,   setShowPerformance]   = useState(false);
  const [isAdmin,           setIsAdmin]           = useState(false);

  // Check admin status on mount
  useEffect(() => {
    const token = localStorage.getItem('hexa_token');
    if (token) {
      fetch(`${API_URL}/api/auth/is-admin`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(data => setIsAdmin(data.isAdmin || false))
        .catch(() => setIsAdmin(false));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('hexa_lang', lang);
  }, [lang]);

  // Write-only use of useHistory — addPick is forwarded to AnalysisPanel.
  // HistoryPanel reads history via its own hook instance (remounts each visit).
  const { addPick } = useHistory();

  // Public landing — /performance is accessible without login
  if (window.location.pathname === '/performance') {
    return <PerformancePage />;
  }

  if (window.location.pathname === '/terms') return <LegalPage page="terms" lang={lang} />;
  if (window.location.pathname === '/privacy') return <LegalPage page="privacy" lang={lang} />;
  if (window.location.pathname === '/admin/backtests') {
    return <BacktestDashboard lang={lang} onBack={() => { window.location.href = '/'; }} />;
  }
  if (window.location.pathname === '/admin/run-backtest') {
    return <BacktestRunner lang={lang} onBack={() => { window.location.href = '/'; }} />;
  }
  if (window.location.pathname === '/admin/dataset') {
    return <DatasetDashboard lang={lang} onBack={() => { window.location.href = '/'; }} />;
  }
  if (window.location.pathname === '/admin/shadow-model') {
    return <ShadowModeDashboard onBack={() => { window.location.href = '/'; }} />;
  }


  // Render Oracle Chat as a full-page takeover (admin only)
  if (showOracleChat) {
    return <OracleChat lang={lang} onBack={() => setShowOracleChat(false)} />;
  }

  // Render Performance Dashboard as a full-page takeover (public — no auth required)
  if (showPerformance) {
    return (
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <PerformanceDashboard onBack={() => setShowPerformance(false)} />
      </ThemeProvider>
    );
  }

  // Render Methodology as a full-page takeover (no tab, no header)
  if (showMethodology) {
    return (
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <MethodologyPage lang={lang} onBack={() => setShowMethodology(false)} onToggleLang={() => setLang(prev => prev === 'es' ? 'en' : 'es')} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <Box
        sx={{
          minHeight:       '100vh',
          bgcolor:         C.bg,
          display:         'flex',
          flexDirection:   'column',
        }}
      >
        {/* ── Oracle loading overlay (blocks UI during analysis) ── */}
        {isAnalyzing && <OracleLoadingOverlay lang={lang} />}

        {/* ── Sticky header + tab bar ── */}
        <Header
          lang={lang}
          onLangToggle={setLang}
          activeTab={activeTab}
          onTabChange={isAnalyzing ? () => {} : setActiveTab}
          disabled={isAnalyzing}
          onMethodology={() => setShowMethodology(true)}
          onPerformance={() => setShowPerformance(true)}
          isAdmin={isAdmin}
          onOracleChat={() => setShowOracleChat(true)}
        />

        {/* ── Main content ── */}
        <Box
          component="main"
          sx={{
            flex:      1,
            px:        { xs: 2, sm: 3 },
            py:        3,
            maxWidth:  1440,
            mx:        'auto',
            width:     '100%',
          }}
        >
          {/* Single game */}
          {activeTab === 'game' && (
            <Box sx={TAB_LAYOUT}>
              <GameSelector
                mode="single"
                onSelectGame={setSingleGame}
                onDateChange={setSelectedDate}
                language={lang}
              />
              <AnalysisPanel
                mode="single"
                selectedGames={singleGame ? [singleGame] : []}
                selectedDate={selectedDate}
                lang={lang}
                onSave={addPick}
                setIsAnalyzing={setIsAnalyzing}
              />
            </Box>
          )}

          {/* Parlay */}
          {activeTab === 'parlay' && (
            <Box sx={TAB_LAYOUT}>
              <GameSelector
                mode="parlay"
                onSelectMultiple={setParlayGames}
                onDateChange={setSelectedDate}
                language={lang}
              />
              <AnalysisPanel
                mode="parlay"
                selectedGames={parlayGames}
                selectedDate={selectedDate}
                lang={lang}
                onSave={addPick}
                setIsAnalyzing={setIsAnalyzing}
              />
            </Box>
          )}

          {/* History — remounts on each visit so it re-reads localStorage */}
          {activeTab === 'history' && (
            <HistoryPanel lang={lang} />
          )}

          {activeTab === 'bankroll' && (
            <BankrollTracker lang={lang} />
          )}

          {activeTab === 'tools' && (
            <OddsLab lang={lang} />
          )}

          {/* Live Tracker */}
          {activeTab === 'live' && (
            <LiveTracker lang={lang} />
          )}

          {/* Gameday play-by-play detail */}
          {activeTab === 'gameday' && (
            <GameDayDetail lang={lang} />
          )}

          {/* Batch Scan (admin only) */}
          {activeTab === 'batch' && isAdmin && (
            <Box sx={TAB_LAYOUT}>
              <GameSelector
                mode="fullDay"
                onSelectMultiple={setBatchGames}
                language={lang}
              />
              <BatchScanPanel
                selectedGames={batchGames}
                lang={lang}
                setIsAnalyzing={setIsAnalyzing}
              />
            </Box>
          )}
        </Box>

        {/* ── Footer ── */}
        <AppFooter />
      </Box>
    </ThemeProvider>
  );
}
