/**
 * Sidebar.jsx — cyberpunk redesign navigation chrome.
 *
 * Replaces the saturated 13-tab horizontal Header. Tabs are grouped into 4
 * sections (Principal · Inteligencia · Análisis · Cuenta). Width: 240px
 * expanded, 64px collapsed. Active item gets a left cyan rail with glow.
 *
 * Props:
 *   lang             — 'en' | 'es'
 *   activeTab        — current tab key (matches Header.jsx TABS)
 *   onTabChange      — (tabKey) => void
 *   isAdmin          — boolean
 *   collapsed        — boolean, controls width
 *   onToggleCollapse — () => void
 *   onAdminLink      — (url) => void   (for /admin/* navigations)
 *   onOracleChat     — () => void
 *   onMethodology    — () => void
 *   onPerformance    — () => void
 */

import { useMemo } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { useHexaTheme } from '../../themeProvider';
import { MONO, DISPLAY } from '../../theme';

// ── SVG icons ───────────────────────────────────────────────────────────────
const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const ICONS = {
  board:      <Icon d="M3 3h18v18H3z M3 9h18 M9 21V9" />,
  standings:  <Icon d="M3 17l6-6 4 4 8-8 M14 7h7v7" />,
  picks:      <Icon d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />,
  game:       <Icon d="M5 3v18l7-4 7 4V3z" />,
  parlay:     <Icon d="M4 6h16 M4 12h16 M4 18h10" />,
  bankroll:   <Icon d="M3 7h18v10H3z M7 7v10 M17 7v10 M12 10v4" />,
  history:    <Icon d="M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2" />,
  live:       <Icon d="M12 2v4 M12 18v4 M2 12h4 M18 12h4 M5 5l3 3 M16 16l3 3 M5 19l3-3 M16 8l3-3" />,
  gameday:    <Icon d="M3 6h18v12H3z M7 10v4 M11 8v8 M15 11v3 M19 9v6" />,
  guide:      <Icon d="M4 4h12a4 4 0 0 1 4 4v12 M4 4v16h16 M8 9h8 M8 13h6" />,
  oracle:     <Icon d="M12 2l9 5v10l-9 5-9-5V7z M12 2v20 M3 7l9 5 9-5" />,
  shadow:     <Icon d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" />,
  synergy:    <Icon d="M5 12a7 7 0 0 1 14 0 M19 12a7 7 0 0 1-14 0 M5 12h14" />,
  architect:  <Icon d="M3 21V8l9-5 9 5v13 M9 21v-7h6v7 M3 14h18" />,
  performance:<Icon d="M3 17l5-5 4 4 9-9 M14 7h7v7" />,
  backtests:  <Icon d="M4 4h16v16H4z M4 9h16 M9 9v11" />,
  dataset:    <Icon d="M5 5h14v6H5z M5 13h14v6H5z M9 8h6 M9 16h6" />,
  credit:     <Icon d="M3 7h18v10H3z M3 11h18" />,
  manual:     <Icon d="M4 4h12l4 4v12H4z M16 4v4h4 M8 12h8 M8 16h6" />,
  collapse:   <Icon d="M15 5l-7 7 7 7" />,
  expand:     <Icon d="M9 5l7 7-7 7" />,
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function L(en, es, lang) { return lang === 'es' ? es : en; }

// ── HEXA logo block ─────────────────────────────────────────────────────────
function LogoBlock({ collapsed, C }) {
  return (
    <Box
      sx={{
        display:    'flex',
        alignItems: 'center',
        gap:        '12px',
        px:         collapsed ? '8px' : '16px',
        py:         '14px',
        minHeight:  '64px',
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      <Box
        component="img"
        src="/logo-hexa.png"
        alt="HEXA"
        sx={{
          width:      '40px',
          height:     '40px',
          objectFit:  'contain',
          flexShrink: 0,
          filter:     C.glowsEnabled ? 'drop-shadow(0 0 8px rgba(34,240,255,0.45))' : 'none',
        }}
      />
      {!collapsed && (
        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Typography
            sx={{
              fontFamily:    DISPLAY,
              fontSize:      '0.95rem',
              fontWeight:    700,
              letterSpacing: '0.18em',
              color:         C.ink0,
              lineHeight:    1,
            }}
          >
            H.E.X.A.
          </Typography>
          <Typography
            sx={{
              fontFamily:    MONO,
              fontSize:      '0.52rem',
              letterSpacing: '0.16em',
              color:         C.ink2,
              lineHeight:    1.2,
              mt:            '4px',
              textTransform: 'uppercase',
            }}
          >
            ORACLE
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// ── Single nav item ─────────────────────────────────────────────────────────
function NavItem({ item, active, collapsed, onClick, C }) {
  const content = (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        position:      'relative',
        display:       'flex',
        alignItems:    'center',
        gap:           '12px',
        width:         '100%',
        px:            collapsed ? '0' : '16px',
        py:            '10px',
        minHeight:     '40px',
        background:    active
          ? `linear-gradient(90deg, ${C.cyanDim} 0%, transparent 80%)`
          : 'transparent',
        border:        'none',
        borderLeft:    active ? `2px solid ${C.cyan}` : '2px solid transparent',
        color:         active ? C.cyan : C.ink1,
        fontFamily:    DISPLAY,
        fontSize:      '0.82rem',
        fontWeight:    active ? 600 : 500,
        letterSpacing: '0.02em',
        cursor:        'pointer',
        textAlign:     'left',
        justifyContent: collapsed ? 'center' : 'flex-start',
        transition:    'background 0.18s, color 0.18s, border-color 0.18s',
        boxShadow:     active && C.glowsEnabled ? 'inset 2px 0 12px rgba(34,240,255,0.18)' : 'none',
        '&:hover': {
          color:      active ? C.cyan : C.ink0,
          background: active
            ? `linear-gradient(90deg, ${C.cyanDim} 0%, transparent 80%)`
            : `linear-gradient(90deg, ${C.cyanDim} 0%, transparent 60%)`,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: active ? C.cyan : C.ink2 }}>
        {item.icon}
      </Box>
      {!collapsed && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <Box component="span" sx={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.label}
          </Box>
          {item.badge && (
            <Box
              sx={{
                px:           '6px',
                py:           '1px',
                borderRadius: '999px',
                bgcolor:      C.greenDim,
                border:       `1px solid ${C.greenLine}`,
                color:        C.green,
                fontFamily:   MONO,
                fontSize:     '0.52rem',
                fontWeight:   700,
                letterSpacing:'0.08em',
                display:      'flex',
                alignItems:   'center',
                gap:          '4px',
              }}
            >
              <Box sx={{
                width: 5, height: 5, borderRadius: '50%', bgcolor: C.green,
                animation: 'hexa-pulse 1.4s ease-in-out infinite',
              }} />
              {item.badge}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );

  return collapsed
    ? <Tooltip title={item.label} placement="right" arrow>{content}</Tooltip>
    : content;
}

// ── Group label ─────────────────────────────────────────────────────────────
function GroupLabel({ label, collapsed, C }) {
  if (collapsed) {
    return <Box sx={{ height: '8px', mt: '12px', borderTop: `1px dashed ${C.line}` }} />;
  }
  return (
    <Typography
      sx={{
        fontFamily:    MONO,
        fontSize:      '0.55rem',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color:         C.ink3,
        px:            '16px',
        pt:            '18px',
        pb:            '6px',
      }}
    >
      {label}
    </Typography>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function Sidebar({
  lang = 'es',
  activeTab,
  onTabChange,
  isAdmin = false,
  collapsed = false,
  onToggleCollapse,
  onOracleChat,
  onMethodology,
  onPerformance,
  performancePublic = false,
}) {
  const { C } = useHexaTheme();

  const groups = useMemo(() => {
    const principal = [
      { key: 'pizarra',   tab: 'pizarra',   icon: ICONS.board,     label: L('Daily Board', 'Pizarra del día', lang) },
      { key: 'standings', tab: 'standings', icon: ICONS.standings, label: L('Standings', 'Posiciones', lang) },
      { key: 'semana',    tab: 'semana',    icon: ICONS.picks,     label: L('Picks of the week', 'Picks de la semana', lang) },
      { key: 'game',      tab: 'game',      icon: ICONS.game,      label: L('Single Game', 'Juego individual', lang) },
      isAdmin && { key: 'parlay',  tab: 'parlay',  icon: ICONS.parlay, label: 'Parlay' },
      { key: 'live',      tab: 'live',      icon: ICONS.live,      label: L('Live', 'En vivo', lang),
        badge: L('LIVE', 'EN VIVO', lang) },
    ].filter(Boolean);

    const inteligencia = [
      isAdmin && { key: 'oracle-chat', action: onOracleChat,
        icon: ICONS.oracle, label: L('Oracle Chat', 'Oracle Chat', lang) },
      isAdmin && { key: 'shadow', action: () => { window.location.href = '/admin/shadow-model'; },
        icon: ICONS.shadow, label: L('Shadow Engine', 'Shadow Engine', lang) },
      isAdmin && { key: 'synergy-runs', action: () => { window.location.href = '/admin/synergy-runs'; },
        icon: ICONS.synergy, label: L('Synergy Runs', 'Synergy Runs', lang) },
      isAdmin && { key: 'synergy', tab: 'synergy', icon: ICONS.architect,
        label: L('Architect', 'Arquitecto', lang) },
      isAdmin && { key: 'batch', tab: 'batch', icon: ICONS.synergy,
        label: L('Batch Scan', 'Batch Scan', lang) },
      isAdmin && { key: 'tools', tab: 'tools', icon: ICONS.dataset,
        label: L('Tools', 'Herramientas', lang) },
    ].filter(Boolean);

    const analisis = [
      (isAdmin || performancePublic) && { key: 'performance', action: onPerformance,
        icon: ICONS.performance, label: 'Performance' },
      isAdmin && { key: 'backtests', action: () => { window.location.href = '/admin/backtests'; },
        icon: ICONS.backtests, label: 'Backtests' },
      isAdmin && { key: 'run-test', action: () => { window.location.href = '/admin/run-backtest'; },
        icon: ICONS.backtests, label: L('Run Test', 'Run Test', lang) },
      { key: 'history', tab: 'history', icon: ICONS.history,
        label: L('History', 'Historial', lang) },
      { key: 'gameday', tab: 'gameday', icon: ICONS.gameday,
        label: L('Details', 'Detalles', lang) },
      isAdmin && { key: 'dataset', action: () => { window.location.href = '/admin/dataset'; },
        icon: ICONS.dataset, label: 'Dataset' },
    ].filter(Boolean);

    const cuenta = [
      { key: 'bankroll', tab: 'bankroll', icon: ICONS.bankroll,
        label: 'Bankroll' },
      { key: 'guide', tab: 'guide', icon: ICONS.guide,
        label: L('Guide', 'Guía', lang) },
      onMethodology && { key: 'methodology', action: onMethodology,
        icon: ICONS.manual, label: L('Methodology', 'Metodología', lang) },
    ].filter(Boolean);

    return [
      { label: L('Main',          'Principal',     lang), items: principal },
      { label: L('Intelligence',  'Inteligencia',  lang), items: inteligencia },
      { label: L('Analysis',      'Análisis',      lang), items: analisis },
      { label: L('Account',       'Cuenta',        lang), items: cuenta },
    ].filter(g => g.items.length > 0);
  }, [lang, isAdmin, performancePublic, onOracleChat, onMethodology, onPerformance]);

  const handleClick = (item) => {
    if (item.tab) onTabChange?.(item.tab);
    else if (item.action) item.action();
  };

  return (
    <Box
      component="nav"
      aria-label="HEXA navigation"
      sx={{
        position:       { xs: 'fixed', md: 'sticky' },
        top:            0,
        left:           0,
        zIndex:         { xs: 1200, md: 100 },
        height:         '100vh',
        width:          collapsed ? '64px' : '240px',
        flexShrink:     0,
        bgcolor:        C.bg1,
        borderRight:    `1px solid ${C.line}`,
        backdropFilter: 'blur(12px)',
        display:        'flex',
        flexDirection:  'column',
        transition:     'width 0.3s cubic-bezier(.4, 0, .2, 1)',
        overflow:       'hidden',
      }}
    >
      <LogoBlock collapsed={collapsed} C={C} />

      <Box
        sx={{
          flex:       1,
          overflowY:  'auto',
          overflowX:  'hidden',
          pt:         '8px',
          pb:         '12px',
        }}
      >
        {groups.map((group) => (
          <Box key={group.label}>
            <GroupLabel label={group.label} collapsed={collapsed} C={C} />
            {group.items.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                active={item.tab && item.tab === activeTab}
                collapsed={collapsed}
                onClick={() => handleClick(item)}
                C={C}
              />
            ))}
          </Box>
        ))}
      </Box>

      <Box
        sx={{
          borderTop: `1px solid ${C.line}`,
          p:         '8px',
          display:   'flex',
          justifyContent: collapsed ? 'center' : 'flex-end',
        }}
      >
        <Tooltip title={collapsed ? L('Expand','Expandir',lang) : L('Collapse','Colapsar',lang)} placement="right" arrow>
          <Box
            component="button"
            onClick={onToggleCollapse}
            sx={{
              width:        '32px',
              height:       '32px',
              border:       `1px solid ${C.line}`,
              bgcolor:      'transparent',
              color:        C.ink2,
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              justifyContent:'center',
              borderRadius: '4px',
              transition:   'all 0.18s',
              '&:hover': { color: C.cyan, borderColor: C.cyanLine, bgcolor: C.cyanDim },
            }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? ICONS.expand : ICONS.collapse}
          </Box>
        </Tooltip>
      </Box>
    </Box>
  );
}
