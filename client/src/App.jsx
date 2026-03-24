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

import { useState } from 'react';
import { ThemeProvider, createTheme, CssBaseline, Box, Typography } from '@mui/material';
import { theme as themeConfig } from './styles/theme';
import Header               from './components/Header';
import GameSelector         from './components/GameSelector';
import AnalysisPanel        from './components/AnalysisPanel';
import HistoryPanel         from './components/HistoryPanel';
import BankrollTracker      from './components/BankrollTracker';
import OracleLoadingOverlay from './components/OracleLoadingOverlay';
import MethodologyPage      from './components/MethodologyPage';
import useHistory           from './hooks/useHistory';
import { C, MONO } from './theme';

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
          fontFamily: MONO,
          fontSize:   '11px',
          color:      C.textDim,
          userSelect: 'none',
        }}
      >
        Creado por Gambitho Labs&nbsp;·&nbsp;H.E.X.A. Hybrid Expert X-Analysis
      </Typography>
    </Box>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [lang,              setLang]              = useState('en');
  const [activeTab,         setActiveTab]         = useState('game');
  const [singleGame,        setSingleGame]        = useState(null);
  const [parlayGames,       setParlayGames]       = useState([]);
  const [isAnalyzing,       setIsAnalyzing]       = useState(false);
  const [showMethodology,   setShowMethodology]   = useState(false);

  // Write-only use of useHistory — addPick is forwarded to AnalysisPanel.
  // HistoryPanel reads history via its own hook instance (remounts each visit).
  const { addPick } = useHistory();

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
                language={lang}
              />
              <AnalysisPanel
                mode="single"
                selectedGames={singleGame ? [singleGame] : []}
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
                language={lang}
              />
              <AnalysisPanel
                mode="parlay"
                selectedGames={parlayGames}
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
        </Box>

        {/* ── Footer ── */}
        <AppFooter />
      </Box>
    </ThemeProvider>
  );
}
