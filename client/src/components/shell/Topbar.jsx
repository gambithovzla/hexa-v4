/**
 * Topbar.jsx — cyberpunk redesign top chrome.
 *
 * Sits above the content column. Holds breadcrumb, search hint (⌘K stub),
 * statcast badge, credits / auth pill, and the language + theme toggles.
 *
 * Heavy admin actions moved to the Sidebar — Topbar stays calm.
 *
 * Props:
 *   lang             — 'en' | 'es'
 *   onLangToggle     — (lang) => void
 *   activeTab        — current tab key (for breadcrumb)
 *   onMobileMenu     — () => void   (opens sidebar drawer on mobile)
 *   onMethodology    — () => void
 *   onPerformance    — () => void   (only used to surface inside topbar — main link is in sidebar)
 */

import { useState, useEffect } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import LanguageToggle from '../LanguageToggle';
import ThemeToggle from '../ThemeToggle';
import AuthModal from '../AuthModal';
import HexaHelpModal from '../HexaHelpModal';
import PricingModal from '../PricingModal';
import WhatsAppSupport from '../WhatsAppSupport';
import { useAuth } from '../../store/authStore';
import { useHexaTheme } from '../../themeProvider';
import { MONO, DISPLAY } from '../../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Tab → human label map (for breadcrumb) ──────────────────────────────────
const CRUMBS = {
  pizarra:   { en: 'Daily Board',     es: 'Pizarra del día' },
  standings: { en: 'Standings',       es: 'Posiciones' },
  semana:    { en: 'Picks of the Week', es: 'Picks de la semana' },
  game:      { en: 'Single Game',     es: 'Juego individual' },
  parlay:    { en: 'Parlay',          es: 'Parlay' },
  bankroll:  { en: 'Bankroll',        es: 'Bankroll' },
  history:   { en: 'History',         es: 'Historial' },
  live:      { en: 'Live',            es: 'En vivo' },
  gameday:   { en: 'Details',         es: 'Detalles' },
  guide:     { en: 'Guide',           es: 'Guía' },
  synergy:   { en: 'Architect',       es: 'Arquitecto' },
  batch:     { en: 'Batch Scan',      es: 'Batch Scan' },
  tools:     { en: 'Tools',           es: 'Herramientas' },
};

// ── Statcast pill ───────────────────────────────────────────────────────────
function StatcastPill({ lang, C }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/api/savant/status`)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (alive && j?.success) setStatus(j.data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!status) return null;

  const total = status.recordCounts
    ? Object.values(status.recordCounts).reduce((a, b) => a + b, 0) : 0;
  const live = total > 0;
  const dotColor = live ? C.green : C.pink;
  const label = live
    ? (lang === 'es' ? 'STATCAST EN VIVO' : 'STATCAST LIVE')
    : (lang === 'es' ? 'STATCAST OFFLINE' : 'STATCAST OFFLINE');

  return (
    <Box
      sx={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          '8px',
        px:           '10px',
        py:           '5px',
        border:       `1px solid ${live ? C.greenLine : C.pinkLine}`,
        bgcolor:      live ? C.greenDim : C.pinkDim,
        borderRadius: '999px',
        flexShrink:   0,
      }}
    >
      <Box sx={{
        width: 6, height: 6, borderRadius: '50%', bgcolor: dotColor,
        animation: live ? 'hexa-pulse 1.6s ease-in-out infinite' : 'none',
      }} />
      <Typography sx={{
        fontFamily: MONO, fontSize: '0.56rem', letterSpacing: '0.16em',
        color: live ? C.green : C.pink, textTransform: 'uppercase', fontWeight: 600,
      }}>
        {label}
      </Typography>
    </Box>
  );
}

// ── Auth / credits cluster ──────────────────────────────────────────────────
function AuthCluster({ lang, C }) {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const [authOpen, setAuthOpen]       = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);

  if (isLoading) return null;

  if (!isAuthenticated) {
    return (
      <>
        <Box
          component="button"
          onClick={() => setAuthOpen(true)}
          sx={{
            px: '14px', py: '6px',
            border: `1px solid ${C.cyanLine}`,
            bgcolor: C.cyanDim,
            color: C.cyan,
            fontFamily: DISPLAY,
            fontSize: '0.72rem', fontWeight: 600,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            borderRadius: '4px', cursor: 'pointer', flexShrink: 0,
            transition: 'all 0.18s',
            '&:hover': { borderColor: C.cyan, boxShadow: C.glowsEnabled ? C.cyanGlow : 'none' },
          }}
        >
          {lang === 'es' ? 'Iniciar sesión' : 'Sign In'}
        </Box>
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} lang={lang} />
      </>
    );
  }

  const initial = (user?.email || '?').slice(0, 1).toUpperCase();

  return (
    <>
      {/* Credits pill (orange) */}
      <Box
        component="button"
        onClick={() => setPricingOpen(true)}
        title={lang === 'es' ? 'Comprar créditos' : 'Buy credits'}
        sx={{
          display:      'inline-flex',
          alignItems:   'center',
          gap:          '6px',
          px:           '10px',
          py:           '5px',
          border:       `1px solid ${C.accentLine}`,
          bgcolor:      C.accentDim,
          color:        C.accent,
          borderRadius: '999px',
          fontFamily:   MONO,
          fontSize:     '0.66rem',
          fontWeight:   700,
          letterSpacing:'0.08em',
          cursor:       'pointer',
          flexShrink:   0,
          transition:   'all 0.18s',
          '&:hover':    { borderColor: C.accent, boxShadow: C.glowsEnabled ? C.accentGlow : 'none' },
        }}
      >
        <Box component="span" sx={{ fontSize: '0.8rem', lineHeight: 1 }}>⚡</Box>
        {user?.credits ?? 0}
        <Box component="span" sx={{ color: C.ink2, fontSize: '0.56rem' }}>
          {lang === 'es' ? 'créd.' : 'cr.'}
        </Box>
      </Box>

      {/* Hex avatar */}
      <Tooltip title={user?.email || ''} placement="bottom" arrow>
        <Box
          sx={{
            width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: C.cyan,
            fontFamily: DISPLAY, fontWeight: 700, fontSize: '0.85rem',
            background: `linear-gradient(135deg, ${C.cyanDim}, ${C.bg2})`,
            border: `1px solid ${C.cyanLine}`,
            clipPath: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
            flexShrink: 0,
            userSelect: 'none',
          }}
        >
          {initial}
        </Box>
      </Tooltip>

      {/* Logout */}
      <Tooltip title={lang === 'es' ? 'Cerrar sesión' : 'Sign out'} placement="bottom" arrow>
        <Box
          component="button"
          onClick={logout}
          aria-label="Sign out"
          sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28,
            border: `1px solid ${C.line}`,
            bgcolor: 'transparent',
            color: C.ink2,
            fontSize: '0.85rem',
            cursor: 'pointer', flexShrink: 0, borderRadius: '4px',
            transition: 'all 0.18s',
            '&:hover': { color: C.pink, borderColor: C.pinkLine, bgcolor: C.pinkDim },
          }}
        >
          ⏏
        </Box>
      </Tooltip>

      {pricingOpen && (
        <PricingModal lang={lang} onClose={() => setPricingOpen(false)} onRequestVerify={() => setPricingOpen(false)} />
      )}
    </>
  );
}

// ── Help button ─────────────────────────────────────────────────────────────
function HelpBtn({ lang, C }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip title={lang === 'es' ? '¿Cómo funciona H.E.X.A.?' : 'How does H.E.X.A. work?'}>
        <Box
          component="button"
          onClick={() => setOpen(true)}
          aria-label="Help"
          sx={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28,
            border: `1px solid ${C.line}`,
            bgcolor: 'transparent',
            color: C.ink2,
            fontFamily: MONO, fontSize: '0.7rem', fontWeight: 700,
            cursor: 'pointer', flexShrink: 0, borderRadius: '4px',
            transition: 'all 0.18s',
            '&:hover': { color: C.cyan, borderColor: C.cyanLine, bgcolor: C.cyanDim },
          }}
        >
          ?
        </Box>
      </Tooltip>
      <HexaHelpModal open={open} onClose={() => setOpen(false)} lang={lang} />
    </>
  );
}

// ── Mobile menu icon ────────────────────────────────────────────────────────
function MobileMenuBtn({ onClick, C }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      aria-label="Menu"
      sx={{
        display: { xs: 'inline-flex', md: 'none' },
        alignItems: 'center', justifyContent: 'center',
        width: 36, height: 36,
        border: `1px solid ${C.line}`,
        bgcolor: 'transparent',
        color: C.ink0,
        cursor: 'pointer',
        borderRadius: '4px',
        flexShrink: 0,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M3 6h18 M3 12h18 M3 18h18" />
      </svg>
    </Box>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function Topbar({ lang = 'es', onLangToggle, activeTab, onMobileMenu }) {
  const { C } = useHexaTheme();
  const crumb = CRUMBS[activeTab];
  const crumbLabel = crumb ? (lang === 'es' ? crumb.es : crumb.en) : '';

  return (
    <Box
      component="header"
      sx={{
        position:       'sticky',
        top:            0,
        zIndex:         50,
        height:         '72px',
        px:             { xs: '12px', sm: '20px' },
        display:        'flex',
        alignItems:     'center',
        gap:            '14px',
        bgcolor:        'rgba(10, 16, 21, 0.7)',
        backdropFilter: 'blur(16px)',
        borderBottom:   `1px solid ${C.line}`,
      }}
    >
      <MobileMenuBtn onClick={onMobileMenu} C={C} />

      {/* Breadcrumb */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0, flex: 1 }}>
        <Typography sx={{
          fontFamily: MONO, fontSize: '0.62rem', letterSpacing: '0.18em',
          color: C.ink3, textTransform: 'uppercase', flexShrink: 0,
          display: { xs: 'none', sm: 'block' },
        }}>
          HEXA /
        </Typography>
        <Typography
          noWrap
          sx={{
            fontFamily: DISPLAY, fontSize: { xs: '0.92rem', sm: '1rem' },
            fontWeight: 600, color: C.ink0, letterSpacing: '0.01em',
          }}
        >
          {crumbLabel}
        </Typography>
      </Box>

      {/* Search hint (visual only — wire later) */}
      <Box
        sx={{
          display:      { xs: 'none', lg: 'inline-flex' },
          alignItems:   'center',
          gap:          '8px',
          px:           '12px',
          py:           '6px',
          minWidth:     '200px',
          border:       `1px solid ${C.line}`,
          bgcolor:      C.bg1,
          borderRadius: '6px',
          color:        C.ink3,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.7rem', flex: 1 }}>
          {lang === 'es' ? 'Buscar…' : 'Search…'}
        </Box>
        <Box component="span" sx={{
          fontFamily: MONO, fontSize: '0.6rem',
          px: '6px', py: '1px', border: `1px solid ${C.line}`, borderRadius: '3px',
        }}>
          ⌘K
        </Box>
      </Box>

      <Box sx={{ display: { xs: 'none', md: 'inline-flex' } }}>
        <StatcastPill lang={lang} C={C} />
      </Box>

      <AuthCluster lang={lang} C={C} />

      <Box sx={{ display: { xs: 'none', md: 'inline-flex' } }}>
        <ThemeToggle lang={lang} layout="compact" />
      </Box>

      <LanguageToggle lang={lang} onToggle={onLangToggle} />

      <Box sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
        <HelpBtn lang={lang} C={C} />
      </Box>

      <Box sx={{ display: { xs: 'none', md: 'inline-flex' } }}>
        <WhatsAppSupport lang={lang} />
      </Box>
    </Box>
  );
}
