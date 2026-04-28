/**
 * Shell.jsx — composes Sidebar + Topbar around the main content.
 *
 * Manages:
 *   - sidebar collapse state (persisted to localStorage)
 *   - mobile drawer open/close
 *   - desktop grid layout (sidebar fixed-left, topbar sticky-top)
 *
 * Children are rendered inside the main content column.
 */

import { useState, useEffect, useCallback } from 'react';
import { Box } from '@mui/material';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useHexaTheme } from '../../themeProvider';

const STORAGE_KEY = 'hexa_sidebar_collapsed';

export default function Shell({
  children,
  lang,
  onLangToggle,
  activeTab,
  onTabChange,
  isAdmin = false,
  performancePublic = false,
  onOracleChat,
  onMethodology,
  onPerformance,
  disabled = false,
}) {
  const { C } = useHexaTheme();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === '1';
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Detect mobile via media query so the layout flips between drawer and rail.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 899px)');
    const handler = (e) => setIsMobile(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, []);

  // Close mobile drawer on tab change.
  const handleTabChange = useCallback((tab) => {
    if (disabled) return;
    onTabChange?.(tab);
    setMobileOpen(false);
  }, [disabled, onTabChange]);

  return (
    <Box
      sx={{
        display:        'grid',
        gridTemplateColumns: {
          xs: '1fr',
          md: collapsed ? '64px 1fr' : '240px 1fr',
        },
        minHeight:      '100vh',
        bgcolor:        C.bg,
        transition:     'grid-template-columns 0.3s cubic-bezier(.4, 0, .2, 1)',
      }}
    >
      {/* Sidebar — always rendered on desktop; mobile shows as drawer when open */}
      {(!isMobile || mobileOpen) && (
        <>
          <Sidebar
            lang={lang}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            isAdmin={isAdmin}
            collapsed={!isMobile && collapsed}
            onToggleCollapse={() => setCollapsed(c => !c)}
            onOracleChat={() => { onOracleChat?.(); setMobileOpen(false); }}
            onMethodology={() => { onMethodology?.(); setMobileOpen(false); }}
            onPerformance={() => { onPerformance?.(); setMobileOpen(false); }}
            performancePublic={performancePublic}
          />
          {isMobile && mobileOpen && (
            <Box
              onClick={() => setMobileOpen(false)}
              sx={{
                position: 'fixed', inset: 0, zIndex: 1100,
                bgcolor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
              }}
            />
          )}
        </>
      )}

      {/* Main column */}
      <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, gridColumn: { xs: '1', md: 'auto' } }}>
        <Topbar
          lang={lang}
          onLangToggle={onLangToggle}
          activeTab={activeTab}
          onMobileMenu={() => setMobileOpen(true)}
        />
        <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
