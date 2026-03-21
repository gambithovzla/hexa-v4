/**
 * Header.jsx
 * Fixed top bar for H.E.X.A. V4 — logo, subtitle, language toggle, and tab bar.
 *
 * Props:
 *   lang        — 'en' | 'es'
 *   onLangToggle — (nextLang) => void
 *   activeTab   — 'game' | 'parlay' | 'history'
 *   onTabChange — (tab) => void
 */

import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import LanguageToggle from './LanguageToggle';
import AuthModal from './AuthModal';
import HexaHelpModal from './HexaHelpModal';
import PricingModal from './PricingModal';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── Constants ─────────────────────────────────────────────────────────────────

const BARLOW = '"Barlow Condensed", system-ui, sans-serif';
const DM     = '"DM Sans", system-ui, sans-serif';
const MONO   = '"JetBrains Mono", "Fira Code", monospace';

const C = {
  bg:         '#04080F',
  bgSec:      '#080D1A',
  border:     '#1A2540',
  accent:     '#0066FF',
  accentSec:  '#00D4FF',
  accentFade: 'rgba(0,102,255,0.06)',
  textPrimary:'#E8EDF5',
  textMuted:  '#5A7090',
  gold:       '#FFB800',
};

const SUBTITLE = {
  en: 'The MLB Sports Oracle',
  es: 'El Oráculo MLB',
};

const TABS = [
  { value: 'game',    en: 'Single Game', es: 'Juego Individual' },
  { value: 'parlay',  en: 'Parlay',      es: 'Parlay'           },
  { value: 'bankroll', en: 'Bankroll',    es: 'Bankroll'         },
  { value: 'history', en: 'History',     es: 'Historial'        },
];

// ── Statcast badge ────────────────────────────────────────────────────────────

function StatcastBadge({ lang }) {
  const [status, setStatus]   = useState(null);
  const [hovered, setHovered] = useState(false);
  const [spinning, setSpinning] = useState(false);

  const isEs = lang === 'es';

  async function fetchStatus() {
    try {
      const res = await fetch(`${API_URL}/api/savant/status`);
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setStatus(json.data);
    } catch {
      // silent fail
    }
  }

  async function handleRefresh(e) {
    e.stopPropagation();
    if (spinning) return;
    setSpinning(true);
    try {
      const res = await fetch(`${API_URL}/api/savant/refresh`, { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setStatus(json.data);
      }
    } catch {
      // silent fail
    } finally {
      setSpinning(false);
    }
  }

  useEffect(() => { fetchStatus(); }, []);

  if (!status) return null;

  const total = status.recordCounts
    ? Object.values(status.recordCounts).reduce((a, b) => a + b, 0)
    : 0;

  const hasData = total > 0;

  let timeStr = '';
  if (status.lastUpdated) {
    try {
      const d = new Date(status.lastUpdated);
      timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { /* ignore */ }
  }

  const dotColor = hasData ? '#00E676' : '#FF3D57';
  const statusLabel = hasData
    ? (isEs ? 'STATCAST EN VIVO' : 'STATCAST LIVE')
    : (isEs ? 'STATCAST OFFLINE' : 'STATCAST OFFLINE');

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
    >
      {/* Dot indicator */}
      <Box
        sx={{
          width:        6,
          height:       6,
          borderRadius: '50%',
          bgcolor:      dotColor,
          flexShrink:   0,
          ...(hasData && {
            '@keyframes statLive': {
              '0%, 100%': { opacity: 1, boxShadow: `0 0 0 0 ${dotColor}80` },
              '50%':      { opacity: 0.8, boxShadow: `0 0 0 4px transparent` },
            },
            animation: 'statLive 2s ease-in-out infinite',
          }),
        }}
      />
      <Typography
        sx={{
          fontFamily:    MONO,
          fontSize:      '0.52rem',
          color:         hasData ? '#5A7090' : '#FF3D5780',
          letterSpacing: '0.08em',
          userSelect:    'none',
          whiteSpace:    'nowrap',
        }}
      >
        {statusLabel}{hasData && timeStr ? ` · ${timeStr}` : ''}
      </Typography>

      {/* Refresh button */}
      <Box
        component="button"
        onClick={handleRefresh}
        sx={{
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          '18px',
          height:         '18px',
          p:              0,
          border:         'none',
          bgcolor:        'transparent',
          color:          C.textMuted,
          cursor:         spinning ? 'default' : 'pointer',
          opacity:        hovered ? 0.7 : 0,
          transition:     'opacity 0.15s',
          fontSize:       '0.7rem',
          lineHeight:     1,
          '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
          ...(spinning && { animation: 'spin 0.8s linear infinite' }),
          '&:hover': { opacity: hovered ? 1 : 0 },
        }}
        title={isEs ? 'Actualizar Statcast' : 'Refresh Statcast'}
      >
        🔄
      </Box>
    </Box>
  );
}

// ── Auth button / user pill ───────────────────────────────────────────────────

function AuthButton({ lang }) {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const [modalOpen, setModalOpen]       = useState(false);
  const [showPricing, setShowPricing]   = useState(false);
  const isEs = lang === 'es';

  if (isLoading) return null;

  if (!isAuthenticated) {
    return (
      <>
        <Box
          component="button"
          onClick={() => setModalOpen(true)}
          sx={{
            px:            '14px',
            py:            '5px',
            border:        `1px solid ${C.accent}`,
            borderRadius:  '2px',
            bgcolor:       C.accentFade,
            color:         C.accent,
            fontFamily:    BARLOW,
            fontSize:      '0.75rem',
            fontWeight:    700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor:        'pointer',
            whiteSpace:    'nowrap',
            flexShrink:    0,
            transition:    'all 0.15s',
            '&:hover':     { bgcolor: 'rgba(0,102,255,0.12)', color: C.accentSec },
          }}
        >
          {isEs ? 'Iniciar sesión' : 'Sign In'}
        </Box>
        <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} lang={lang} />
      </>
    );
  }

  const shortEmail = user?.email
    ? (user.email.length > 18 ? user.email.slice(0, 16) + '…' : user.email)
    : '—';

  return (
    <>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
      {/* User pill */}
      <Box
        sx={{
          display:      'flex',
          alignItems:   'center',
          gap:          '6px',
          px:           '10px',
          py:           '4px',
          border:       `1px solid ${C.border}`,
          borderRadius: '2px',
          bgcolor:      '#080D1A',
        }}
      >
        <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, userSelect: 'none' }}>
          {shortEmail}
        </Typography>
        <Box sx={{ width: '1px', height: '10px', bgcolor: C.border }} />
        <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.accent, fontWeight: 700, userSelect: 'none' }}>
          {user?.credits ?? 0} {isEs ? 'créd.' : 'cr.'}
        </Typography>
      </Box>

      {/* Credits / pricing button */}
      <Box
        component="button"
        onClick={() => setShowPricing(true)}
        title={isEs ? 'Comprar créditos' : 'Buy credits'}
        sx={{
          px:            '10px',
          py:            '4px',
          border:        `1px solid rgba(79,195,247,0.35)`,
          borderRadius:  '2px',
          bgcolor:       'rgba(79,195,247,0.06)',
          color:         '#4fc3f7',
          fontFamily:    BARLOW,
          fontSize:      '0.72rem',
          fontWeight:    700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          cursor:        'pointer',
          flexShrink:    0,
          whiteSpace:    'nowrap',
          transition:    'all 0.15s',
          '&:hover':     { bgcolor: 'rgba(79,195,247,0.12)', borderColor: '#4fc3f7' },
        }}
      >
        ⚡ {isEs ? 'Créditos' : 'Credits'}
      </Box>

      {/* Logout button */}
      <Box
        component="button"
        onClick={logout}
        title={isEs ? 'Cerrar sesión' : 'Sign out'}
        sx={{
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          '24px',
          height:         '24px',
          border:         'none',
          bgcolor:        'transparent',
          color:          C.textMuted,
          cursor:         'pointer',
          fontSize:       '0.8rem',
          borderRadius:   '2px',
          '&:hover':      { color: C.textPrimary, bgcolor: C.border },
        }}
      >
        ⏏
      </Box>
    </Box>
    {showPricing && <PricingModal onClose={() => setShowPricing(false)} lang={lang} />}
    </>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TabButton({ tab, active, lang, onClick, disabled = false }) {
  const label = lang === 'es' ? tab.es : tab.en;

  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        position:      'relative',
        display:       'inline-flex',
        alignItems:    'center',
        px:            '22px',
        py:            '12px',
        background:    active
          ? 'linear-gradient(180deg, #0066FF 0%, #0044CC 100%)'
          : 'transparent',
        border:        'none',
        borderBottom:  active ? 'none' : `2px solid #1A2540`,
        color:         active ? '#ffffff' : C.textMuted,
        fontFamily:    BARLOW,
        fontSize:      '0.82rem',
        fontWeight:    700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        cursor:        disabled ? 'default' : 'pointer',
        pointerEvents: disabled ? 'none' : 'auto',
        opacity:       disabled && !active ? 0.4 : 1,
        transition:    'all 0.15s',
        flexShrink:    0,
        boxShadow:     active
          ? '0 4px 12px rgba(0,102,255,0.4)'
          : 'inset 0 -2px 4px rgba(0,0,0,0.25)',
        borderRadius:  active ? '2px 2px 0 0' : '0',
        '&:hover': {
          color:      active ? '#ffffff' : C.textPrimary,
          background: active
            ? 'linear-gradient(180deg, #0066FF 0%, #0044CC 100%)'
            : 'rgba(255,255,255,0.03)',
        },
      }}
    >
      {label}
    </Box>
  );
}

// ── Help button ───────────────────────────────────────────────────────────────

function HelpButton({ lang }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Box
        component="button"
        onClick={() => setOpen(true)}
        title={lang === 'es' ? '¿Cómo funciona H.E.X.A.?' : 'How does H.E.X.A. work?'}
        sx={{
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          width:          '26px',
          height:         '26px',
          border:         `1px solid ${C.border}`,
          borderRadius:   '50%',
          bgcolor:        'transparent',
          color:          C.textMuted,
          fontFamily:     '"DM Sans", system-ui, sans-serif',
          fontSize:       '0.72rem',
          fontWeight:     700,
          cursor:         'pointer',
          flexShrink:     0,
          transition:     'all 0.15s',
          '&:hover':      { color: C.accentSec, borderColor: C.accent, bgcolor: C.accentFade },
        }}
      >
        ?
      </Box>
      <HexaHelpModal open={open} onClose={() => setOpen(false)} lang={lang} />
    </>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Header({ lang = 'en', onLangToggle, activeTab, onTabChange, disabled = false }) {
  return (
    <Box
      component="header"
      sx={{
        position:   'sticky',
        top:        0,
        zIndex:     1000,
        background: 'radial-gradient(ellipse at 50% 0%, #0D1528 0%, #04080F 70%)',
        backdropFilter:      'blur(12px)',
        WebkitBackdropFilter:'blur(12px)',
        // Gradient border bottom via pseudo-element
        '&::after': {
          content:    '""',
          position:   'absolute',
          bottom:     0,
          left:       0,
          right:      0,
          height:     '2px',
          background: 'linear-gradient(90deg, transparent 0%, #0066FF 30%, #00D4FF 70%, transparent 100%)',
        },
      }}
    >
      {/* ── Top row: logo + subtitle + controls (target: ~44px of the 72px) ── */}
      <Box
        sx={{
          display:    'flex',
          alignItems: 'center',
          px:         { xs: '16px', sm: '24px' },
          pt:         '16px',
          pb:         '8px',
          gap:        '14px',
          minHeight:  '44px',
        }}
      >
        {/* Logo block */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
          <Box
            component="img"
            src="/hexa-logo.png"
            alt="H.E.X.A."
            sx={{
              height:    { xs: '40px', sm: '48px' },
              width:     'auto',
              display:   'block',
              userSelect:'none',
              filter:    'drop-shadow(0 0 16px rgba(0,102,255,0.35))',
            }}
          />
        </Box>

        {/* Statcast status badge */}
        <StatcastBadge lang={lang} />

        {/* Auth button / user pill */}
        <AuthButton lang={lang} />

        {/* Help button */}
        <HelpButton lang={lang} />

        {/* Language toggle */}
        <LanguageToggle lang={lang} onToggle={onLangToggle} />
      </Box>

      {/* ── Tab bar (~28px of the 72px) ── */}
      <Box
        sx={{
          display:    'flex',
          alignItems: 'stretch',
          px:         { xs: '4px', sm: '12px' },
          overflowX:  'auto',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {TABS.map(tab => (
          <TabButton
            key={tab.value}
            tab={tab}
            active={activeTab === tab.value}
            lang={lang}
            onClick={disabled ? undefined : () => onTabChange(tab.value)}
            disabled={disabled}
          />
        ))}
      </Box>
    </Box>
  );
}
