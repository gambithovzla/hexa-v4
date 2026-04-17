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

import { useState, useEffect, useRef } from 'react';
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
import HexaBoard           from './components/HexaBoard';
import LearningCenter      from './components/LearningCenter';
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

function readShellState() {
  if (typeof window === 'undefined') {
    return { isMobileViewport: false, isStandalonePwa: false };
  }

  const canMatchMedia = typeof window.matchMedia === 'function';
  const isMobileViewport = canMatchMedia
    ? window.matchMedia('(max-width: 899px)').matches
    : window.innerWidth < 900;
  const isStandalonePwa = (canMatchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator?.standalone === true;

  return { isMobileViewport, isStandalonePwa };
}

function useShellMode() {
  const [shellState, setShellState] = useState(readShellState);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;

    const viewportMedia = window.matchMedia('(max-width: 899px)');
    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    const syncShellState = () => setShellState(readShellState());
    const addListener = (mediaQuery, handler) => {
      if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', handler);
      else mediaQuery.addListener(handler);
    };
    const removeListener = (mediaQuery, handler) => {
      if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', handler);
      else mediaQuery.removeListener(handler);
    };

    syncShellState();
    addListener(viewportMedia, syncShellState);
    addListener(standaloneMedia, syncShellState);
    window.addEventListener('orientationchange', syncShellState);

    return () => {
      removeListener(viewportMedia, syncShellState);
      removeListener(standaloneMedia, syncShellState);
      window.removeEventListener('orientationchange', syncShellState);
    };
  }, []);

  return {
    ...shellState,
    isMobileExperience: shellState.isMobileViewport,
  };
}

function getMatchupLabel(game) {
  if (!game) return '';
  const away = game.teams?.away?.abbreviation ?? game.teams?.away?.team?.abbreviation ?? 'AWAY';
  const home = game.teams?.home?.abbreviation ?? game.teams?.home?.team?.abbreviation ?? 'HOME';
  return `${away} @ ${home}`;
}

function MobileAnalysisDock({ open, lang, matchup, onOpenAnalysis, isStandalonePwa }) {
  if (!open || !matchup) return null;

  const isEs = lang === 'es';

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        zIndex: 1200,
        mx: 'auto',
        maxWidth: '420px',
        border: `1px solid ${isStandalonePwa ? C.accentLine : C.cyanLine}`,
        borderLeft: `3px solid ${C.accent}`,
        bgcolor: 'rgba(7,9,14,0.96)',
        boxShadow: isStandalonePwa
          ? `0 0 26px rgba(255,102,0,0.12), 0 14px 36px rgba(0,0,0,0.72)`
          : `0 0 20px rgba(0,217,255,0.08), 0 14px 36px rgba(0,0,0,0.72)`,
        backdropFilter: 'blur(10px)',
        px: '14px',
        py: '12px',
        '@keyframes mobileDockIn': {
          from: { opacity: 0, transform: 'translateY(14px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        animation: 'mobileDockIn 0.22s ease-out',
      }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, letterSpacing: '0.16em', textTransform: 'uppercase', mb: '4px' }}>
        {isStandalonePwa ? '// APP ACTION' : '// QUICK ACTION'}
      </Typography>
      <Typography sx={{ fontFamily: BARLOW, fontSize: '0.84rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.05em', mb: '10px' }}>
        {matchup}
      </Typography>
      <Box
        component="button"
        onClick={onOpenAnalysis}
        sx={{
          width: '100%',
          py: '11px',
          border: `1px solid ${C.accentLine}`,
          bgcolor: C.accentDim,
          color: C.accent,
          fontFamily: BARLOW,
          fontSize: '0.78rem',
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          boxShadow: C.accentGlow,
          transition: 'all 0.2s',
          '&:hover': {
            bgcolor: 'rgba(255,102,0,0.18)',
            color: '#ffffff',
          },
        }}
      >
        {isEs ? 'Ir al analisis' : 'Open analysis'}
      </Box>
    </Box>
  );
}

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
  const [activeTab,         setActiveTab]         = useState('pizarra');
  const [singleGame,        setSingleGame]        = useState(null);
  const [parlayGames,       setParlayGames]       = useState([]);
  const [batchGames,        setBatchGames]        = useState([]);
  const [selectedDate,      setSelectedDate]      = useState('');
  const [isAnalyzing,       setIsAnalyzing]       = useState(false);
  const [showMethodology,   setShowMethodology]   = useState(false);
  const [showOracleChat,    setShowOracleChat]    = useState(false);
  const [showPerformance,   setShowPerformance]   = useState(false);
  const [isAdmin,           setIsAdmin]           = useState(false);
  const [performancePublic, setPerformancePublic] = useState(false);
  const [highlightAnalysisPanel, setHighlightAnalysisPanel] = useState(false);
  const { isMobileExperience, isStandalonePwa } = useShellMode();
  const analysisPanelRef = useRef(null);
  const analysisScrollTimerRef = useRef(null);
  const analysisFlashTimerRef = useRef(null);

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

  // Fetch the performance-public flag so we know whether to expose the page
  useEffect(() => {
    fetch(`${API_URL}/api/settings/performance-public`)
      .then(r => r.json())
      .then(data => setPerformancePublic(Boolean(data?.enabled)))
      .catch(() => setPerformancePublic(false));
  }, []);

  useEffect(() => {
    localStorage.setItem('hexa_lang', lang);
  }, [lang]);

  // Write-only use of useHistory — addPick is forwarded to AnalysisPanel.
  // HistoryPanel reads history via its own hook instance (remounts each visit).
  const { addPick } = useHistory();
  const selectedMatchupLabel = getMatchupLabel(singleGame);

  useEffect(() => () => {
    window.clearTimeout(analysisScrollTimerRef.current);
    window.clearTimeout(analysisFlashTimerRef.current);
  }, []);

  function focusAnalysisPanel() {
    if (!isMobileExperience) return;

    window.clearTimeout(analysisScrollTimerRef.current);
    window.clearTimeout(analysisFlashTimerRef.current);
    setHighlightAnalysisPanel(true);

    analysisScrollTimerRef.current = window.setTimeout(() => {
      analysisPanelRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 140);

    analysisFlashTimerRef.current = window.setTimeout(() => {
      setHighlightAnalysisPanel(false);
    }, 1800);
  }

  function handleSingleGameSelect(game) {
    setSingleGame(game);
    if (game && activeTab === 'game') {
      focusAnalysisPanel();
    }
  }

  // Performance landing — admin always, public only when toggle is ON
  if (window.location.pathname === '/performance') {
    if (!isAdmin && !performancePublic) {
      return (
        <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: C.bg, color: C.textPrimary, fontFamily: BARLOW, p: 3, textAlign: 'center' }}>
          <Box>
            <Typography sx={{ fontFamily: BARLOW, fontWeight: 800, letterSpacing: '2px', fontSize: '1.1rem', color: C.accent, mb: 1 }}>
              PERFORMANCE DASHBOARD
            </Typography>
            <Typography sx={{ fontFamily: BARLOW, color: C.textMuted, fontSize: '0.9rem' }}>
              {lang === 'es' ? 'Esta página aún no es pública.' : 'This page is not yet public.'}
            </Typography>
          </Box>
        </Box>
      );
    }
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

  // Render Performance Dashboard as a full-page takeover (admin always;
  // public only when the performance_public flag is enabled)
  if (showPerformance && (isAdmin || performancePublic)) {
    return (
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <PerformanceDashboard onBack={() => setShowPerformance(false)} isAdmin={isAdmin} performancePublic={performancePublic} onTogglePublic={setPerformancePublic} />
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
          performancePublic={performancePublic}
          onOracleChat={() => setShowOracleChat(true)}
        />

        {/* ── Main content ── */}
        <Box
          component="main"
          sx={{
            flex:      1,
            px:        { xs: 2, sm: 3 },
            py:        3,
            pb:        isMobileExperience && activeTab === 'game' && singleGame ? 14 : 3,
            maxWidth:  1440,
            mx:        'auto',
            width:     '100%',
          }}
        >
          {/* Pizarra H.E.X.A. — landing tab */}
          {activeTab === 'pizarra' && (
            <HexaBoard lang={lang} />
          )}

          {/* Single game */}
          {activeTab === 'game' && (
            <Box sx={TAB_LAYOUT}>
              <GameSelector
                mode="single"
                onSelectGame={handleSingleGameSelect}
                onDateChange={setSelectedDate}
                language={lang}
              />
              <Box
                ref={analysisPanelRef}
                sx={{
                  scrollMarginTop: { xs: '104px', md: '84px' },
                  borderRadius: '4px',
                  ...(highlightAnalysisPanel && {
                    '@keyframes analysisPanelPulse': {
                      '0%': { boxShadow: '0 0 0 rgba(255,102,0,0)' },
                      '35%': { boxShadow: '0 0 0 1px rgba(255,102,0,0.35), 0 0 28px rgba(255,102,0,0.16)' },
                      '100%': { boxShadow: '0 0 0 rgba(255,102,0,0)' },
                    },
                    animation: 'analysisPanelPulse 1.4s ease-out 1',
                  }),
                }}
              >
                <AnalysisPanel
                  mode="single"
                  selectedGames={singleGame ? [singleGame] : []}
                  selectedDate={selectedDate}
                  lang={lang}
                  onSave={addPick}
                  setIsAnalyzing={setIsAnalyzing}
                />
              </Box>
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

          {/* Guía H.E.X.A. — learning center */}
          {activeTab === 'guide' && (
            <LearningCenter lang={lang} />
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

        <MobileAnalysisDock
          open={activeTab === 'game' && isMobileExperience && Boolean(singleGame)}
          lang={lang}
          matchup={selectedMatchupLabel}
          onOpenAnalysis={focusAnalysisPanel}
          isStandalonePwa={isStandalonePwa}
        />

        {/* ── Footer ── */}
        <AppFooter />
      </Box>
    </ThemeProvider>
  );
}
