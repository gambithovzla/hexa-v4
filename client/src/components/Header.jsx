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
import ThemeToggle    from './ThemeToggle';
import AuthModal from './AuthModal';
import HexaHelpModal from './HexaHelpModal';
import PricingModal from './PricingModal';
import AdminCreditPanel from './AdminCreditPanel';
import TerminalGuide from './TerminalGuide';
import { useAuth } from '../store/authStore';
import { C, BARLOW, MONO } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const SUBTITLE = {
  en: 'The MLB Sports Oracle',
  es: 'El Oráculo MLB',
};

const TABS = [
  { value: 'pizarra', en: 'Board',       es: 'Pizarra'          },
  { value: 'semana',  en: 'Picks',       es: 'Semana',  highlight: true },
  { value: 'game',    en: 'Single Game', es: 'Juego Individual' },
  { value: 'parlay',  en: 'Parlay',      es: 'Parlay',           adminOnly: true },
  { value: 'bankroll', en: 'Bankroll',    es: 'Bankroll'         },
  { value: 'tools',   en: 'Tools',       es: 'Herramientas'     },
  { value: 'history', en: 'History',     es: 'Historial'        },
  { value: 'live',    en: 'Live',        es: 'En Vivo'          },
  { value: 'gameday', en: 'Gameday',     es: 'Detalle'          },
  { value: 'guide',   en: 'Guide',       es: 'Guía'             },
  { value: 'batch',   en: 'Batch Scan',  es: 'Batch Scan', adminOnly: true },
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
      const token = localStorage.getItem('hexa_token');
      const res = await fetch(`${API_URL}/api/savant/refresh`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 403 || res.status === 401) {
        // Non-admin users can't force refresh — silent fail, auto-refresh handles it
        return;
      }
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
          color:         hasData ? C.textMuted : `${C.red}80`,
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
          color:          C.textTertiary,
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
  const [authView, setAuthView]         = useState(null);
  const [showPricing, setShowPricing]   = useState(false);
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const isEs = lang === 'es';
  const logoutCopy = isEs
    ? {
        title: 'Cerrar sesion',
        body: 'Vas a cerrar la sesion actual en este dispositivo.',
        cancel: 'Cancelar',
        confirm: 'Si, cerrar',
      }
    : {
        title: 'Sign out',
        body: 'This will close your current session on this device.',
        cancel: 'Cancel',
        confirm: 'Yes, sign out',
      };

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
            border:        `1px solid ${C.cyanLine}`,
            borderRadius:  '0',
            bgcolor:       C.cyanDim,
            color:         C.cyan,
            fontFamily:    BARLOW,
            fontSize:      '0.68rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            cursor:        'pointer',
            whiteSpace:    'nowrap',
            flexShrink:    0,
            transition:    'all 0.2s',
            '&:hover':     { borderColor: C.cyan, boxShadow: C.cyanGlow, color: '#ffffff' },
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
          borderRadius: '0',
          bgcolor:      C.bg,
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
          border:        `1px solid ${C.accentLine}`,
          borderRadius:  '0',
          bgcolor:       C.accentDim,
          color:         C.accent,
          fontFamily:    BARLOW,
          fontSize:      '0.65rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          cursor:        'pointer',
          flexShrink:    0,
          whiteSpace:    'nowrap',
          transition:    'all 0.2s',
          '&:hover':     { borderColor: C.accent, boxShadow: C.accentGlow, color: '#ffffff' },
        }}
      >
        ⚡ {isEs ? 'Créditos' : 'Credits'}
      </Box>

      {/* Logout button */}
      <Box
        component="button"
        onClick={() => setConfirmLogoutOpen(true)}
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
          '&:hover':      { color: C.textSecondary, bgcolor: C.border },
        }}
      >
        ⏏
      </Box>
    </Box>
    {showPricing && (
      <PricingModal
        onClose={() => setShowPricing(false)}
        lang={lang}
        onRequestVerify={() => {
          setShowPricing(false);
          setAuthView('verify');
          setModalOpen(true);
        }}
      />
    )}
    <AuthModal
      open={modalOpen}
      onClose={() => {
        setModalOpen(false);
        setAuthView(null);
      }}
      lang={lang}
      initialView={authView}
    />
    <ActionConfirmModal
      open={confirmLogoutOpen}
      title={logoutCopy.title}
      body={logoutCopy.body}
      cancelLabel={logoutCopy.cancel}
      confirmLabel={logoutCopy.confirm}
      onClose={() => setConfirmLogoutOpen(false)}
      onConfirm={() => {
        logout();
        setConfirmLogoutOpen(false);
      }}
    />
    </>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────────

function ActionConfirmModal({
  open,
  title,
  body,
  cancelLabel,
  confirmLabel,
  onClose,
  onConfirm,
}) {
  if (!open) return null;

  return (
    <Box
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(0,0,0,0.84)',
        backdropFilter: 'blur(6px)',
        px: 2,
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: '380px',
          bgcolor: C.surface,
          border: `1px solid ${C.accentLine}`,
          borderLeft: `3px solid ${C.accent}`,
          boxShadow: `0 0 28px rgba(0,0,0,0.88), 0 0 26px rgba(255,102,0,0.08)`,
          p: { xs: '20px', sm: '24px' },
        }}
      >
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: '0.66rem',
            color: C.accent,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            mb: 1,
          }}
        >
          // SESSION CONTROL
        </Typography>
        <Typography
          sx={{
            fontFamily: BARLOW,
            fontSize: '0.98rem',
            fontWeight: 800,
            color: C.textPrimary,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            mb: 1.5,
          }}
        >
          {title}
        </Typography>
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize: '0.72rem',
            lineHeight: 1.7,
            color: C.textSecondary,
            mb: 3,
          }}
        >
          {body}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.25 }}>
          <Box
            component="button"
            onClick={onClose}
            sx={{
              flex: 1,
              py: '10px',
              border: `1px solid ${C.border}`,
              bgcolor: 'transparent',
              color: C.textMuted,
              fontFamily: BARLOW,
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': {
                color: C.textPrimary,
                borderColor: C.cyanLine,
                bgcolor: C.cyanDim,
              },
            }}
          >
            {cancelLabel}
          </Box>
          <Box
            component="button"
            onClick={onConfirm}
            sx={{
              flex: 1,
              py: '10px',
              border: `1px solid ${C.accentLine}`,
              bgcolor: C.accentDim,
              color: C.accent,
              fontFamily: BARLOW,
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              boxShadow: C.accentGlow,
              transition: 'all 0.2s',
              '&:hover': {
                color: '#ffffff',
                bgcolor: 'rgba(255,102,0,0.18)',
              },
            }}
          >
            {confirmLabel}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function TabButton({ tab, active, lang, onClick, disabled = false }) {
  const label = lang === 'es' ? tab.es : tab.en;
  const isHighlight = tab.highlight && !active;

  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        position:      'relative',
        display:       'inline-flex',
        alignItems:    'center',
        gap:           isHighlight ? '5px' : '0',
        px:            '20px',
        py:            '11px',
        background:    active ? C.cyanDim : isHighlight ? 'rgba(0,255,136,0.05)' : 'transparent',
        border:        'none',
        borderBottom:  active
          ? `1px solid ${C.cyan}`
          : isHighlight
            ? '1px solid rgba(0,255,136,0.30)'
            : '1px solid transparent',
        color:         active ? C.cyan : isHighlight ? '#00FF88' : C.textMuted,
        fontFamily:    BARLOW,
        fontSize:      '0.72rem',
        fontWeight:    isHighlight ? 700 : 'inherit',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        cursor:        disabled ? 'default' : 'pointer',
        pointerEvents: disabled ? 'none' : 'auto',
        opacity:       disabled && !active ? 0.35 : 1,
        transition:    'all 0.2s',
        flexShrink:    0,
        boxShadow:     active
          ? `0 1px 0 ${C.cyan}, 0 0 10px rgba(0,217,255,0.2)`
          : isHighlight
            ? '0 0 14px rgba(0,255,136,0.15)'
            : 'none',
        '&:hover': {
          color:      active ? C.cyan : isHighlight ? '#00FF88' : C.textSecondary,
          background: active ? C.cyanDim : isHighlight ? 'rgba(0,255,136,0.10)' : 'rgba(0,217,255,0.04)',
          textShadow: active ? `0 0 8px rgba(0,217,255,0.6)` : isHighlight ? '0 0 10px rgba(0,255,136,0.6)' : 'none',
        },
      }}
    >
      {isHighlight && <span style={{ fontSize: '8px', opacity: 0.8 }}>✦</span>}
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
          width:          '24px',
          height:         '24px',
          border:         `1px solid ${C.border}`,
          borderRadius:   '0',
          bgcolor:        'transparent',
          color:          C.textMuted,
          fontFamily:     MONO,
          fontSize:       '0.65rem',
          cursor:         'pointer',
          flexShrink:     0,
          transition:     'all 0.2s',
          '&:hover':      { color: C.cyan, borderColor: C.cyanLine, bgcolor: C.cyanDim, boxShadow: C.cyanGlow },
        }}
      >
        ?
      </Box>
      <HexaHelpModal open={open} onClose={() => setOpen(false)} lang={lang} />
    </>
  );
}

// ── Guide button ──────────────────────────────────────────────────────────────

function GuideButton({ lang }) {
  const [open, setOpen] = useState(false);
  const label = '[ MANUAL ]';
  return (
    <>
      <Box
        component="button"
        onClick={() => setOpen(v => !v)}
        sx={{
          px:            '16px',
          py:            '6px',
          border:        `1px solid ${open ? C.accentLine : 'rgba(255,102,0,0.2)'}`,
          borderRadius:  '0',
          bgcolor:       open ? C.accentDim : 'transparent',
          color:         C.accent,
          fontFamily:    BARLOW,
          fontSize:      '0.68rem',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          cursor:        'pointer',
          whiteSpace:    'nowrap',
          flexShrink:    0,
          transition:    'all 0.2s ease',
          '&:hover':     { bgcolor: C.accentDim, borderColor: C.accentLine, boxShadow: C.accentGlow },
        }}
      >
        {label}
      </Box>
      <TerminalGuide open={open} onClose={() => setOpen(false)} lang={lang} />
    </>
  );
}

// ── Performance link ──────────────────────────────────────────────────────────

function PerformanceLink() {
  return (
    <Box
      component="button"
      onClick={() => { window.location.href = '/performance'; }}
      sx={{
        px:            '16px',
        py:            '6px',
        border:        '1px solid rgba(0,255,136,0.4)',
        borderRadius:  '0',
        bgcolor:       'rgba(0,255,136,0.12)',
        color:         '#00FF88',
        fontFamily:    BARLOW,
        fontSize:      '0.68rem',
        fontWeight:    700,
        letterSpacing: '2px',
        textTransform: 'uppercase',
        cursor:        'pointer',
        whiteSpace:    'nowrap',
        flexShrink:    0,
        transition:    'all 0.2s ease',
        '@keyframes perfPulse': {
          '0%, 100%': { boxShadow: '0 0 6px rgba(0,255,136,0.3)' },
          '50%':      { boxShadow: '0 0 14px rgba(0,255,136,0.6), 0 0 28px rgba(0,255,136,0.15)' },
        },
        animation: 'perfPulse 2.4s ease-in-out infinite',
        '&:hover': {
          bgcolor:     'rgba(0,255,136,0.25)',
          borderColor: 'rgba(0,255,136,0.6)',
          boxShadow:   '0 0 14px rgba(0,255,136,0.6), 0 0 28px rgba(0,255,136,0.15)',
        },
      }}
    >
      PERFORMANCE
    </Box>
  );
}

// ── Methodology link ──────────────────────────────────────────────────────────

function MethodologyLink({ lang, onClick }) {
  const label = lang === 'es' ? 'Metodología' : 'Methodology';
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        px:            '16px',
        py:            '6px',
        border:        `1px solid rgba(255,102,0,0.2)`,
        borderRadius:  '0',
        bgcolor:       'transparent',
        color:         C.accent,
        fontFamily:    BARLOW,
        fontSize:      '0.68rem',
        letterSpacing: '2px',
        textTransform: 'uppercase',
        cursor:        'pointer',
        whiteSpace:    'nowrap',
        flexShrink:    0,
        transition:    'all 0.2s ease',
        '&:hover':     { bgcolor: C.accentDim, borderColor: C.accentLine, boxShadow: C.accentGlow },
      }}
    >
      {label}
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Header({ lang = 'en', onLangToggle, activeTab, onTabChange, disabled = false, onMethodology, onPerformance, isAdmin = false, performancePublic = false, onOracleChat }) {
  const [showCreditPanel, setShowCreditPanel] = useState(false);

  return (
    <Box
      component="header"
      sx={{
        position:       'sticky',
        top:            0,
        zIndex:         1000,
        background:     `rgba(0,0,0,0.97)`,
        borderBottom:   `1px solid ${C.border}`,
        boxShadow:      `0 1px 0 rgba(0,217,255,0.12), 0 4px 20px rgba(0,0,0,0.8)`,
        backdropFilter: 'blur(8px)',
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
          flexWrap:   'wrap',
          overflow:   'hidden',
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
            }}
          />
        </Box>

        {/* Statcast status badge */}
        <StatcastBadge lang={lang} />

        {/* Auth button / user pill */}
        <AuthButton lang={lang} />

        {/* Oracle Chat button — admin only */}
        {isAdmin && (
          <Box
            component="button"
            onClick={onOracleChat}
            sx={{
              px:            '16px',
              py:            '6px',
              border:        '1px solid rgba(249,115,22,0.4)',
              borderRadius:  '3px',
              bgcolor:       'rgba(249,115,22,0.15)',
              color:         '#f97316',
              fontFamily:    MONO,
              fontWeight:    500,
              fontSize:      '10px',
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              cursor:        'pointer',
              whiteSpace:    'nowrap',
              flexShrink:    0,
              transition:    'all 0.2s ease',
              '&:hover':     { bgcolor: 'rgba(249,115,22,0.25)', borderColor: 'rgba(249,115,22,0.6)' },
            }}
          >
            ORACLE CHAT
          </Box>
        )}

        {/* Backtest Dashboard button — admin only */}
        {isAdmin && (
          <Box component="button" onClick={() => { window.location.href = '/admin/backtests'; }} sx={{
            px: '10px', py: '5px',
            border: `1px solid rgba(255,153,0,0.3)`,
            background: 'rgba(255,153,0,0.08)',
            color: '#FF9900',
            fontFamily: MONO, fontSize: '0.58rem', letterSpacing: '1.5px',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            '&:hover': { background: 'rgba(255,153,0,0.15)', borderColor: 'rgba(255,153,0,0.5)' },
          }}>
            BACKTESTS
          </Box>
        )}

        {isAdmin && (
          <Box component="button" onClick={() => { window.location.href = '/admin/run-backtest'; }} sx={{
            px: '10px', py: '5px',
            border: '1px solid rgba(255,102,0,0.3)',
            background: 'rgba(255,102,0,0.08)',
            color: '#FF9900',
            fontFamily: MONO, fontSize: '0.58rem', letterSpacing: '1.5px',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            '&:hover': { background: 'rgba(255,102,0,0.15)', borderColor: 'rgba(255,102,0,0.5)' },
          }}>
            RUN TEST
          </Box>
        )}

        {isAdmin && (
          <Box component="button" onClick={() => { window.location.href = '/admin/dataset'; }} sx={{
            px: '10px', py: '5px',
            border: '1px solid rgba(0,255,136,0.3)',
            background: 'rgba(0,255,136,0.08)',
            color: '#00FF88',
            fontFamily: MONO, fontSize: '0.58rem', letterSpacing: '1.5px',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            '&:hover': { background: 'rgba(0,255,136,0.15)', borderColor: 'rgba(0,255,136,0.5)' },
          }}>
            DATASET
          </Box>
        )}

        {isAdmin && (
          <Box component="button" onClick={() => { window.location.href = '/admin/shadow-model'; }} sx={{
            px: '10px', py: '5px',
            border: '1px solid rgba(0,255,255,0.3)',
            background: 'rgba(0,255,255,0.08)',
            color: '#00E5FF',
            fontFamily: MONO, fontSize: '0.58rem', letterSpacing: '1.5px',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            '&:hover': { background: 'rgba(0,255,255,0.15)', borderColor: 'rgba(0,255,255,0.5)' },
          }}>
            SHADOW
          </Box>
        )}

        {/* Credit Manager button + panel — admin only */}
        {isAdmin && (
          <Box sx={{ position: 'relative', flexShrink: 0 }}>
            <Box
              component="button"
              onClick={() => setShowCreditPanel(v => !v)}
              sx={{
                px:            '16px',
                py:            '6px',
                border:        showCreditPanel
                  ? '1px solid rgba(249,115,22,0.7)'
                  : '1px solid rgba(249,115,22,0.4)',
                borderRadius:  '3px',
                bgcolor:       showCreditPanel
                  ? 'rgba(249,115,22,0.25)'
                  : 'rgba(249,115,22,0.15)',
                color:         '#f97316',
                fontFamily:    MONO,
                fontWeight:    500,
                fontSize:      '10px',
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                cursor:        'pointer',
                whiteSpace:    'nowrap',
                transition:    'all 0.2s ease',
                '&:hover':     { bgcolor: 'rgba(249,115,22,0.25)', borderColor: 'rgba(249,115,22,0.6)' },
              }}
            >
              CREDIT MGR
            </Box>

            {showCreditPanel && (
              <AdminCreditPanel
                lang={lang}
                onClose={() => setShowCreditPanel(false)}
              />
            )}
          </Box>
        )}

        {/* Guide button */}
        <GuideButton lang={lang} />

        {/* Performance link — admin always, public only when toggle is ON */}
        {(isAdmin || performancePublic) && <PerformanceLink />}

        {/* Methodology link */}
        <MethodologyLink lang={lang} onClick={onMethodology} />

        {/* Help button */}
        <HelpButton lang={lang} />

        {/* Theme toggle (LIGHT / SYSTEM / DARK) */}
        <ThemeToggle lang={lang} layout="pill" />

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
          flexWrap:   'nowrap',
          WebkitOverflowScrolling: 'touch',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {TABS.filter(tab => !tab.adminOnly || isAdmin).map(tab => (
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
