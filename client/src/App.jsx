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
import { Box, Typography } from '@mui/material';
import { Shell }             from './components/shell';
import GameSelectorClassic  from './components/GameSelector';
import AnalysisPanelClassic from './components/AnalysisPanel';
import GameSelectorLeague   from './components/GameSelectorLeague';
import AnalysisPanelLeague  from './components/AnalysisPanelLeague';
import HistoryPanelClassic  from './components/HistoryPanel';
import HistoryPanelLeague   from './components/HistoryPanelLeague';
import InsightsSemana       from './components/InsightsSemana';
import BankrollTracker      from './components/BankrollTracker';
import OddsLab              from './components/OddsLab';
import XContentStudio       from './components/XContentStudio';
import OracleLoadingOverlay from './components/OracleLoadingOverlay';
import MethodologyPage      from './components/MethodologyPage';
import LegalPage            from './components/LegalPage';
import OracleChat          from './components/OracleChat';
import PerformanceDashboard from './pages/PerformanceDashboard';
import DevUIShowcase       from './pages/DevUIShowcase';
import ParlayArchitect     from './pages/ParlayArchitect';
import PerformancePage      from './components/PerformancePage';
import BatchScanPanel      from './components/BatchScanPanel';
import BacktestDashboard  from './components/BacktestDashboard';
import BacktestRunner     from './components/BacktestRunner';
import DatasetDashboard  from './components/DatasetDashboardV2';
import ShadowModeDashboard    from './components/ShadowModeDashboard';
import SynergyRunsDashboard  from './components/SynergyRunsDashboard';
import MLCalibrationDashboard from './pages/MLCalibrationDashboard';
import AdminMLControlCenter   from './pages/AdminMLControlCenter';
import PlayerPropsPage        from './pages/PlayerPropsPage';
import EquityDashboard        from './pages/EquityDashboard';
import LiveTracker         from './components/LiveTracker';
import NBALiveTracker      from './components/NBALiveTracker';
import GameDayDetail       from './components/GameDayDetail';
import HexaBoard           from './components/HexaBoard';
import HexaBoardLeague     from './components/HexaBoardLeague';
import LearningCenter      from './components/LearningCenter';
import MLBStandingsPanel   from './components/MLBStandingsPanel';
import NBAStandingsPanel   from './components/NBAStandingsPanel';
import SportSwitcher       from './components/SportSwitcher';
import WhatsAppSupport     from './components/WhatsAppSupport';
import useHistory           from './hooks/useHistory';
import { C, MONO, BARLOW } from './theme';
import { useSport } from './context/SportContext';
import { useHexaTheme } from './themeProvider';
import { getActiveSportOptions, SPORT_META } from './config/sports';
import { getSportCapability } from './config/sportCapabilities';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// MUI ThemeProvider + CssBaseline are mounted globally in main.jsx via the
// HEXA ThemeProvider, so route-level wrappers were removed here.

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

// Compact onboarding card shown on mobile before a game is selected.
// Desktop shows the equivalent inside AnalysisPanel's EmptyState.
function MobileOnboardingCard({ lang }) {
  const isEs = lang === 'es';
  const title = isEs ? 'INICIO RÁPIDO' : 'QUICK START';
  const steps = isEs
    ? [
        'Elige un partido de la lista.',
        'Selecciona tu enfoque (moneyline, totales, props…).',
        'Presiona Ejecutar Oráculo — recibes odds, edge y razonamiento.',
      ]
    : [
        'Pick a game from the list.',
        'Choose your bet focus (moneyline, totals, props…).',
        'Hit Run Oracle — get odds, edge, and reasoning.',
      ];
  const hint = isEs ? '¿Primera vez? Mira la pestaña Guía para un recorrido.' : 'New here? Check the Guide tab for a walkthrough.';

  return (
    <Box
      sx={{
        mb:           '14px',
        border:       `1px solid ${C.cyanLine}`,
        borderLeft:   `3px solid ${C.accent}`,
        bgcolor:      'rgba(0,229,255,0.04)',
        borderRadius: '4px',
        p:            '14px 16px',
        display:      'flex',
        flexDirection:'column',
        gap:          '10px',
      }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.accent, letterSpacing: '0.18em', fontWeight: 700 }}>
        {title}
      </Typography>
      <Box component="ol" sx={{ m: 0, pl: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {steps.map((step, i) => (
          <Box key={i} component="li" sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <Box
              sx={{
                flexShrink:    0,
                width:         '18px',
                height:        '18px',
                borderRadius:  '50%',
                border:        `1px solid ${C.cyan}`,
                color:         C.cyan,
                fontFamily:    MONO,
                fontSize:      '0.62rem',
                fontWeight:    700,
                display:       'flex',
                alignItems:    'center',
                justifyContent:'center',
                lineHeight:    1,
                mt:            '1px',
              }}
            >
              {i + 1}
            </Box>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '0.8rem', color: C.textPrimary, lineHeight: 1.5 }}>
              {step}
            </Typography>
          </Box>
        ))}
      </Box>
      <Typography sx={{ mt: '2px', fontFamily: MONO, fontSize: '0.62rem', color: C.textMuted, lineHeight: 1.5 }}>
        {hint}
      </Typography>
    </Box>
  );
}

// Back bar shown on mobile when analysis view has taken over the screen.
// Tapping "back" returns the user to the game selector.
function MobileBackBar({ lang, matchup, onBack }) {
  const isEs = lang === 'es';
  return (
    <Box
      sx={{
        position:       'sticky',
        top:            0,
        zIndex:         5,
        display:        'flex',
        alignItems:     'center',
        gap:            '10px',
        px:             '12px',
        py:             '10px',
        mb:             '12px',
        border:         `1px solid ${C.cyanLine}`,
        borderLeft:     `3px solid ${C.accent}`,
        bgcolor:        'rgba(7,9,14,0.94)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <Box
        component="button"
        onClick={onBack}
        aria-label={isEs ? 'Volver' : 'Back'}
        sx={{
          display:        'inline-flex',
          alignItems:     'center',
          gap:            '6px',
          px:             '10px',
          py:             '6px',
          border:         `1px solid ${C.border}`,
          bgcolor:        'transparent',
          color:          C.cyan,
          fontFamily:     MONO,
          fontSize:       '11px',
          letterSpacing:  '2px',
          textTransform:  'uppercase',
          cursor:         'pointer',
          '&:hover':      { borderColor: C.cyan },
        }}
      >
        ← {isEs ? 'Volver' : 'Back'}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          {isEs ? '// Analisis' : '// Analysis'}
        </Typography>
        <Typography
          noWrap
          sx={{ fontFamily: BARLOW, fontSize: '0.82rem', fontWeight: 800, color: C.textPrimary, letterSpacing: '0.04em' }}
        >
          {matchup || (isEs ? 'Partido seleccionado' : 'Selected game')}
        </Typography>
      </Box>
    </Box>
  );
}

function AppFooter({ lang }) {
  return (
    <Box
      component="footer"
      sx={{
        mt:         6,
        pt:         '14px',
        pb:         { xs: 'calc(14px + env(safe-area-inset-bottom))', md: '14px' },
        px:         3,
        borderTop:  `1px solid ${C.border}`,
        textAlign:  'center',
      }}
    >
      <WhatsAppSupport lang={lang} variant="footer" />
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

function SportComingSoon({ lang, title, subtitle }) {
  return (
    <Box
      sx={{
        position: 'relative',
        p: { xs: 4, sm: 5 },
        border: `1px solid ${C.cyanLine}`,
        background: 'linear-gradient(180deg, rgba(7,9,14,0.98), rgba(2,4,8,0.96))',
        boxShadow: 'inset 0 0 32px rgba(0,0,0,0.75)',
        overflow: 'hidden',
        textAlign: 'center',
        '&::before': {
          content: '""', position: 'absolute', top: 0, left: 0,
          width: 18, height: 18,
          borderTop: `2px solid ${C.cyan}`, borderLeft: `2px solid ${C.cyan}`,
        },
        '&::after': {
          content: '""', position: 'absolute', right: 0, bottom: 0,
          width: 18, height: 18,
          borderRight: `2px solid ${C.accent}`, borderBottom: `2px solid ${C.accent}`,
        },
      }}
    >
      <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.cyan, letterSpacing: '0.22em', textTransform: 'uppercase', mb: 1 }}>
        {lang === 'es' ? 'Próximamente' : 'Coming soon'}
      </Typography>
      <Typography sx={{ fontFamily: BARLOW, fontSize: { xs: '1.4rem', sm: '1.7rem' }, fontWeight: 800, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1 }}>
        {title}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.78rem', color: C.textMuted, maxWidth: 540, mx: 'auto', lineHeight: 1.7 }}>
        {subtitle}
      </Typography>
    </Box>
  );
}

function LockedModuleView({ lang, onBack, title, subtitle }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.bg, color: C.textPrimary }}>
      <Box sx={{ p: 2 }}>
        <Box
          component="button"
          onClick={onBack}
          sx={{
            background: 'transparent',
            border: `1px solid ${C.cyanLine}`,
            color: C.textMuted,
            fontFamily: MONO,
            fontSize: '0.65rem',
            letterSpacing: '2px',
            padding: '6px 14px',
            cursor: 'pointer',
            '&:hover': { color: C.cyan },
          }}
        >
          ← BACK
        </Box>
      </Box>
      <Box sx={{ maxWidth: 980, mx: 'auto', px: 3 }}>
        <SportComingSoon lang={lang} title={title} subtitle={subtitle} />
      </Box>
    </Box>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { sport, setSport } = useSport();
  const { isLeague } = useHexaTheme();
  const GameSelector  = isLeague ? GameSelectorLeague  : GameSelectorClassic;
  const AnalysisPanel = isLeague ? AnalysisPanelLeague : AnalysisPanelClassic;
  const HistoryPanel  = isLeague ? HistoryPanelLeague  : HistoryPanelClassic;
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
  const { isMobileExperience } = useShellMode();
  const adminOnlyTabs = ['parlay', 'tools', 'batch', 'synergy'];
  const sportOptions = getActiveSportOptions();

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

  useEffect(() => {
    setSingleGame(null);
    setParlayGames([]);
    setBatchGames([]);
  }, [sport]);

  useEffect(() => {
    if (!isAdmin && adminOnlyTabs.includes(activeTab)) {
      setActiveTab('pizarra');
    }
  }, [activeTab, isAdmin]);

  // Write-only use of useHistory — addPick is forwarded to AnalysisPanel.
  // HistoryPanel reads history via its own hook instance (remounts each visit).
  const { addPick } = useHistory();
  const selectedMatchupLabel = getMatchupLabel(singleGame);
  const showMobileAnalysisFull = isMobileExperience && activeTab === 'game' && Boolean(singleGame);
  const sportAwareTabs = new Set(['pizarra', 'standings', 'game', 'parlay', 'history', 'live', 'gameday', 'synergy', 'batch']);

  const boardCapability = getSportCapability('board', sport, lang);
  const oracleChatCapability = getSportCapability('oracleChat', sport, lang);
  const parlayCapability = getSportCapability('parlayBuilder', sport, lang);
  const parlayArchitectCapability = getSportCapability('parlayArchitect', sport, lang);
  const batchCapability = getSportCapability('batchScan', sport, lang);
  const gameDetailCapability = getSportCapability('gameDetail', sport, lang);
  const sportLabel = SPORT_META[sport]?.shortLabel ?? sport.toUpperCase();

  // When mobile switches into analysis view (game selected), jump to top so the
  // MobileBackBar is the first thing the user sees instead of mid-panel scroll.
  useEffect(() => {
    if (showMobileAnalysisFull) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [showMobileAnalysisFull]);

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

  // Premium UI lab — showcase route for the component library (Fase 1).
  if (window.location.pathname === '/dev/ui') {
    return <DevUIShowcase />;
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
  if (window.location.pathname === '/admin/synergy-runs') {
    return <SynergyRunsDashboard lang={lang} onBack={() => { window.location.href = '/'; }} />;
  }
  if (window.location.pathname === '/admin/ml-calibration') {
    const token = localStorage.getItem('hexa_token');
    return <MLCalibrationDashboard token={token} onBack={() => { window.location.href = '/'; }} />;
  }
  if (window.location.pathname === '/admin/ml-control') {
    const token = localStorage.getItem('hexa_token');
    return <AdminMLControlCenter token={token} lang={lang} onBack={() => { window.location.href = '/'; }} />;
  }
  if (window.location.pathname === '/admin/equity') {
    const token = localStorage.getItem('hexa_token');
    return <EquityDashboard token={token} onBack={() => { window.location.href = '/'; }} />;
  }
  if (window.location.pathname === '/props') {
    const token = localStorage.getItem('hexa_token');
    return <PlayerPropsPage token={token} lang={lang} onBack={() => { window.location.href = '/'; }} />;
  }


  // Render Oracle Chat as a full-page takeover (admin only)
  if (showOracleChat) {
    if (!oracleChatCapability.enabled) {
      return (
        <LockedModuleView
          lang={lang}
          onBack={() => setShowOracleChat(false)}
          title={lang === 'es' ? `Oracle Chat ${sportLabel}` : `${sportLabel} Oracle Chat`}
          subtitle={oracleChatCapability.message}
        />
      );
    }
    return <OracleChat lang={lang} sport={sport} onBack={() => setShowOracleChat(false)} />;
  }

  // Render Performance Dashboard as a full-page takeover (admin always;
  // public only when the performance_public flag is enabled)
  if (showPerformance && (isAdmin || performancePublic)) {
    return (
      <PerformanceDashboard onBack={() => setShowPerformance(false)} isAdmin={isAdmin} performancePublic={performancePublic} onTogglePublic={setPerformancePublic} />
    );
  }

  // Render Methodology as a full-page takeover (no tab, no header)
  if (showMethodology) {
    return (
      <MethodologyPage lang={lang} onBack={() => setShowMethodology(false)} onToggleLang={() => setLang(prev => prev === 'es' ? 'en' : 'es')} />
    );
  }

  return (
    <>
      {/* ── Oracle loading overlay (blocks UI during analysis) ── */}
      {isAnalyzing && <OracleLoadingOverlay lang={lang} />}

      <Shell
        lang={lang}
        onLangToggle={setLang}
        activeTab={activeTab}
        onTabChange={isAnalyzing ? () => {} : setActiveTab}
        disabled={isAnalyzing}
        isAdmin={isAdmin}
        performancePublic={performancePublic}
        onOracleChat={() => setShowOracleChat(true)}
        oracleChatOpen={showOracleChat}
        onMethodology={() => setShowMethodology(true)}
        onPerformance={() => setShowPerformance(true)}
      >
        <Box
          sx={{
            px:        { xs: 2, sm: 3 },
            py:        3,
            pb:        { xs: 'calc(20px + env(safe-area-inset-bottom))', md: '24px' },
            maxWidth:  1440,
            mx:        'auto',
            width:     '100%',
          }}
        >
          {sportAwareTabs.has(activeTab) && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
              <Box sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, letterSpacing: '0.16em' }}>
                {lang === 'es' ? 'DEPORTE ACTIVO' : 'ACTIVE SPORT'} · {sportLabel}
              </Box>
              <SportSwitcher sport={sport} onChange={setSport} options={sportOptions} />
            </Box>
          )}

          {/* Pizarra H.E.X.A. — landing tab */}
          {activeTab === 'pizarra' && (
            boardCapability.enabled
              ? (isLeague
                  ? <HexaBoardLeague lang={lang} sport={sport} />
                  : <HexaBoard       lang={lang} sport={sport} />)
              : <SportComingSoon
                lang={lang}
                title={lang === 'es' ? `Pizarra ${sportLabel}` : `${sportLabel} Board`}
                subtitle={boardCapability.message}
              />
          )}

          {activeTab === 'standings' && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              {sport === 'nba'
                ? <NBAStandingsPanel lang={lang} />
                : <MLBStandingsPanel lang={lang} />}
            </Box>
          )}

          {/* Single game */}
          {activeTab === 'game' && (
            showMobileAnalysisFull ? (
              <Box>
                <MobileBackBar
                  lang={lang}
                  matchup={selectedMatchupLabel}
                  onBack={() => setSingleGame(null)}
                />
                <AnalysisPanel
                  mode="single"
                  sport={sport}
                  selectedGames={singleGame ? [singleGame] : []}
                  selectedDate={selectedDate}
                  lang={lang}
                  onSave={addPick}
                  setIsAnalyzing={setIsAnalyzing}
                />
              </Box>
            ) : (
              <Box sx={isMobileExperience ? { display: 'block' } : TAB_LAYOUT}>
                {isMobileExperience && <MobileOnboardingCard lang={lang} />}
                <GameSelector
                  mode="single"
                  sport={sport}
                  onSportChange={s => { setSport(s); setSingleGame(null); }}
                  onSelectGame={setSingleGame}
                  onDateChange={setSelectedDate}
                  language={lang}
                />
                {!isMobileExperience && (
                  <AnalysisPanel
                    mode="single"
                    sport={sport}
                    selectedGames={singleGame ? [singleGame] : []}
                    selectedDate={selectedDate}
                    lang={lang}
                    onSave={addPick}
                    setIsAnalyzing={setIsAnalyzing}
                  />
                )}
              </Box>
            )
          )}

          {/* Parlay */}
          {activeTab === 'parlay' && (
            parlayCapability.enabled ? (
              <Box sx={TAB_LAYOUT}>
                <GameSelector
                  mode="parlay"
                  sport={sport}
                  onSelectMultiple={setParlayGames}
                  onDateChange={setSelectedDate}
                  language={lang}
                />
                <AnalysisPanel
                  mode="parlay"
                  sport={sport}
                  selectedGames={parlayGames}
                  selectedDate={selectedDate}
                  lang={lang}
                  onSave={addPick}
                  setIsAnalyzing={setIsAnalyzing}
                />
              </Box>
            ) : (
              <SportComingSoon
                lang={lang}
                title={lang === 'es' ? `Parlay ${sportLabel}` : `${sportLabel} Parlay`}
                subtitle={parlayCapability.message}
              />
            )
          )}

          {/* Semana — public weekly showcase (no auth required) */}
          {activeTab === 'semana' && (
            <InsightsSemana lang={lang} />
          )}

          {/* History — remounts on each visit so it re-reads localStorage */}
          {activeTab === 'history' && (
            <HistoryPanel lang={lang} sport={sport} />
          )}

          {activeTab === 'bankroll' && (
            <BankrollTracker lang={lang} />
          )}

          {activeTab === 'tools' && isAdmin && (
            <Box sx={{ display: 'grid', gap: 3 }}>
              <OddsLab lang={lang} />
              <XContentStudio lang={lang} />
            </Box>
          )}

          {/* Live Tracker */}
          {activeTab === 'live' && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              {sport === 'nba'
                ? <NBALiveTracker lang={lang} />
                : <LiveTracker lang={lang} />}
            </Box>
          )}

          {/* Gameday play-by-play detail */}
          {activeTab === 'gameday' && (
            <Box sx={{ display: 'grid', gap: 2 }}>
              {gameDetailCapability.enabled
                ? <GameDayDetail lang={lang} />
                : <SportComingSoon
                  lang={lang}
                  title={lang === 'es' ? `Detalles ${sportLabel}` : `${sportLabel} Details`}
                  subtitle={gameDetailCapability.message}
                />}
            </Box>
          )}

          {/* Guía H.E.X.A. — learning center */}
          {activeTab === 'guide' && (
            <LearningCenter lang={lang} />
          )}

          {/* Parlay Architect — Synergy Engine (admin only) */}
          {activeTab === 'synergy' && isAdmin && (
            parlayArchitectCapability.enabled
              ? <ParlayArchitect lang={lang} sport={sport} />
              : <SportComingSoon
                lang={lang}
                title={lang === 'es' ? `Arquitecto ${sportLabel}` : `${sportLabel} Architect`}
                subtitle={parlayArchitectCapability.message}
              />
          )}

          {/* Batch Scan (admin only) */}
          {activeTab === 'batch' && isAdmin && (
            batchCapability.enabled ? (
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
            ) : (
              <SportComingSoon
                lang={lang}
                title={lang === 'es' ? `Batch ${sportLabel}` : `${sportLabel} Batch`}
                subtitle={batchCapability.message}
              />
            )
          )}
        </Box>

        {/* ── Footer ── */}
        <AppFooter lang={lang} />
      </Shell>
    </>
  );
}
