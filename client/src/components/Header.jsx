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

import { useState, useEffect, useRef } from 'react';
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
  { value: 'pizarra', en: 'Board',       es: 'Pizarra',          mobileEn: 'Board',       mobileEs: 'Pizarra' },
  { value: 'semana',  en: 'Picks',       es: 'Semana',           mobileEn: 'Picks',       mobileEs: 'Semana', highlight: true },
  { value: 'game',    en: 'Single Game', es: 'Juego Individual', mobileEn: 'Game',  mobileEs: 'Juego' },
  { value: 'parlay',  en: 'Parlay',      es: 'Parlay',           mobileEn: 'Parlay',      mobileEs: 'Parlay', adminOnly: true },
  { value: 'bankroll', en: 'Bankroll',   es: 'Bankroll',         mobileEn: 'Bankroll',    mobileEs: 'Bankroll' },
  { value: 'tools',   en: 'Tools',       es: 'Herramientas',     mobileEn: 'Tools',       mobileEs: 'Herramientas' },
  { value: 'history', en: 'History',     es: 'Historial',        mobileEn: 'History',     mobileEs: 'Historial' },
  { value: 'live',    en: 'Live',        es: 'En Vivo',          mobileEn: 'Live',        mobileEs: 'En vivo' },
  { value: 'gameday', en: 'Details',     es: 'Detalles',         mobileEn: 'Details',     mobileEs: 'Detalles' },
  { value: 'guide',   en: 'Guide',       es: 'Guía',             mobileEn: 'Guide',  mobileEs: 'Guia' },
  { value: 'batch',   en: 'Batch Scan',  es: 'Batch Scan',       mobileEn: 'Batch',  mobileEs: 'Batch', adminOnly: true },
];
const PRIMARY_TAB_VALUES = new Set(['pizarra', 'semana', 'game', 'tools']);

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

function AdminActionButton({ action, active = false, onClick }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        px: action.compact ? '12px' : '14px',
        py: action.compact ? '7px' : '6px',
        border: active ? `1px solid ${action.color}` : `1px solid ${action.border}`,
        borderRadius: '0',
        bgcolor: active ? action.backgroundActive ?? action.background : action.background,
        color: action.color,
        fontFamily: MONO,
        fontWeight: 600,
        fontSize: action.compact ? '0.6rem' : '0.58rem',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'all 0.2s ease',
        boxShadow: active ? `0 0 14px ${action.glow ?? `${action.color}33`}` : 'none',
        '&:hover': {
          bgcolor: action.hoverBackground ?? action.backgroundActive ?? action.background,
          borderColor: action.hoverBorder ?? action.color,
        },
      }}
    >
      {action.label}
    </Box>
  );
}

function TabButton({ tab, active, lang, onClick, disabled = false, tabRef = null }) {
  const label = lang === 'es' ? tab.es : tab.en;
  const mobileLabel = lang === 'es' ? (tab.mobileEs ?? tab.es) : (tab.mobileEn ?? tab.en);
  const isHighlight = tab.highlight && !active;

  return (
    <Box
      ref={tabRef}
      component="button"
      onClick={onClick}
      sx={{
        position:      'relative',
        display:       'inline-flex',
        alignItems:    'center',
        justifyContent:'center',
        gap:           isHighlight ? '5px' : '0',
        px:            { xs: '16px', sm: '18px' },
        py:            { xs: '12px', sm: '11px' },
        background:    active
          ? 'linear-gradient(180deg, rgba(0,217,255,0.18), rgba(0,217,255,0.08))'
          : isHighlight
            ? 'linear-gradient(180deg, rgba(0,255,136,0.12), rgba(0,255,136,0.04))'
            : 'linear-gradient(180deg, rgba(16,22,32,0.98), rgba(5,7,12,0.96))',
        border:        active
          ? `1px solid ${C.cyan}`
          : isHighlight
            ? '1px solid rgba(0,255,136,0.35)'
            : `1px solid ${C.border}`,
        borderBottom:  active
          ? `2px solid ${C.cyan}`
          : isHighlight
            ? '2px solid rgba(0,255,136,0.55)'
            : '2px solid rgba(0,217,255,0.08)',
        color:         active ? C.cyan : isHighlight ? '#00FF88' : C.textMuted,
        fontFamily:    BARLOW,
        fontSize:      { xs: '0.68rem', sm: '0.72rem' },
        fontWeight:    isHighlight ? 700 : 'inherit',
        letterSpacing: { xs: '0.1em', sm: '0.12em' },
        textTransform: 'uppercase',
        cursor:        disabled ? 'default' : 'pointer',
        pointerEvents: disabled ? 'none' : 'auto',
        opacity:       disabled && !active ? 0.35 : 1,
        transition:    'all 0.2s ease',
        flexShrink:    0,
        minHeight:     46,
        minWidth:      { xs: 'max-content', sm: 0 },
        scrollSnapAlign: 'center',
        boxShadow:     active
          ? '0 10px 24px rgba(0,0,0,0.45), 0 0 18px rgba(0,217,255,0.2), inset 0 1px 0 rgba(255,255,255,0.06)'
          : isHighlight
            ? '0 10px 22px rgba(0,0,0,0.45), 0 0 16px rgba(0,255,136,0.15), inset 0 1px 0 rgba(255,255,255,0.04)'
            : '0 8px 18px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.03)',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '1px 1px auto 1px',
          height: '38%',
          background: active
            ? 'linear-gradient(180deg, rgba(255,255,255,0.12), transparent)'
            : 'linear-gradient(180deg, rgba(255,255,255,0.04), transparent)',
          pointerEvents: 'none',
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          left: 10,
          right: 10,
          bottom: 4,
          height: 2,
          background: active
            ? C.cyan
            : isHighlight
              ? '#00FF88'
              : 'rgba(0,217,255,0.18)',
          boxShadow: active ? `0 0 10px ${C.cyan}` : 'none',
          opacity: active || isHighlight ? 1 : 0.45,
        },
        '&:hover': {
          color:      active ? C.cyan : isHighlight ? '#00FF88' : C.textSecondary,
          background: active
            ? 'linear-gradient(180deg, rgba(0,217,255,0.22), rgba(0,217,255,0.1))'
            : isHighlight
              ? 'linear-gradient(180deg, rgba(0,255,136,0.18), rgba(0,255,136,0.06))'
              : 'linear-gradient(180deg, rgba(18,28,40,1), rgba(6,10,16,0.98))',
          borderColor: active ? C.cyan : isHighlight ? '#00FF88' : C.cyanLine,
          textShadow: active ? `0 0 8px rgba(0,217,255,0.6)` : isHighlight ? '0 0 10px rgba(0,255,136,0.6)' : 'none',
          transform: 'translateY(-1px)',
        },
      }}
    >
      {isHighlight && <span style={{ fontSize: '8px', opacity: 0.8 }}>✦</span>}
      <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
        {mobileLabel}
      </Box>
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
        {label}
      </Box>
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
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const tabRefs = useRef({});
  const desktopTabs = TABS.filter(tab => !tab.adminOnly || isAdmin);
  const mobileTabs = desktopTabs.filter(tab => !PRIMARY_TAB_VALUES.has(tab.value));
  const adminActions = isAdmin
    ? [
        {
          key: 'oracle',
          label: 'ORACLE CHAT',
          color: '#f97316',
          border: 'rgba(249,115,22,0.4)',
          background: 'rgba(249,115,22,0.15)',
          backgroundActive: 'rgba(249,115,22,0.22)',
          onClick: onOracleChat,
        },
        {
          key: 'backtests',
          label: 'BACKTESTS',
          color: '#FF9900',
          border: 'rgba(255,153,0,0.3)',
          background: 'rgba(255,153,0,0.08)',
          backgroundActive: 'rgba(255,153,0,0.14)',
          onClick: () => { window.location.href = '/admin/backtests'; },
        },
        {
          key: 'run-test',
          label: 'RUN TEST',
          color: '#FF9900',
          border: 'rgba(255,102,0,0.3)',
          background: 'rgba(255,102,0,0.08)',
          backgroundActive: 'rgba(255,102,0,0.14)',
          onClick: () => { window.location.href = '/admin/run-backtest'; },
        },
        {
          key: 'dataset',
          label: 'DATASET',
          color: '#00FF88',
          border: 'rgba(0,255,136,0.3)',
          background: 'rgba(0,255,136,0.08)',
          backgroundActive: 'rgba(0,255,136,0.14)',
          onClick: () => { window.location.href = '/admin/dataset'; },
        },
        {
          key: 'shadow',
          label: 'SHADOW',
          color: '#00E5FF',
          border: 'rgba(0,255,255,0.3)',
          background: 'rgba(0,255,255,0.08)',
          backgroundActive: 'rgba(0,255,255,0.14)',
          onClick: () => { window.location.href = '/admin/shadow-model'; },
        },
        {
          key: 'credits',
          label: 'CREDIT MGR',
          color: '#f97316',
          border: 'rgba(249,115,22,0.4)',
          background: 'rgba(249,115,22,0.15)',
          backgroundActive: 'rgba(249,115,22,0.25)',
          onClick: () => setShowCreditPanel(v => !v),
        },
      ]
    : [];

  useEffect(() => {
    const node = tabRefs.current[activeTab];
    if (node?.scrollIntoView) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeTab]);

  useEffect(() => {
    setShowAdminMenu(false);
  }, [activeTab]);

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
          overflow:   'visible',
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

        {isAdmin && (
          <Box sx={{ position: 'relative', display: { xs: 'block', md: 'none' }, flexShrink: 0 }}>
            <Box
              component="button"
              onClick={() => setShowAdminMenu(v => !v)}
              sx={{
                px: '14px',
                py: '7px',
                border: showAdminMenu ? `1px solid ${C.accent}` : `1px solid ${C.accentLine}`,
                bgcolor: showAdminMenu ? 'rgba(255,102,0,0.2)' : C.accentDim,
                color: C.accent,
                fontFamily: MONO,
                fontSize: '0.62rem',
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                boxShadow: showAdminMenu ? C.accentGlow : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              Admin
            </Box>
            {showAdminMenu && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: 'min(320px, calc(100vw - 32px))',
                  p: '12px',
                  display: 'grid',
                  gap: '10px',
                  border: `1px solid ${C.accentLine}`,
                  bgcolor: 'rgba(6,8,14,0.98)',
                  boxShadow: '0 18px 36px rgba(0,0,0,0.78), 0 0 18px rgba(255,102,0,0.08)',
                  zIndex: 1100,
                }}
              >
                <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: C.textMuted, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                  Admin controls
                </Typography>
                <Box sx={{ display: 'grid', gap: '8px' }}>
                  {adminActions.map((action) => (
                    <AdminActionButton
                      key={action.key}
                      action={{ ...action, compact: true }}
                      active={action.key === 'credits' && showCreditPanel}
                      onClick={() => {
                        action.onClick?.();
                        setShowAdminMenu(false);
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* Oracle Chat button — admin only */}
        {isAdmin && (
          <Box
            component="button"
            onClick={onOracleChat}
            sx={{
              display:        { xs: 'none', md: 'inline-flex' },
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
            display: { xs: 'none', md: 'inline-flex' },
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
            display: { xs: 'none', md: 'inline-flex' },
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
            display: { xs: 'none', md: 'inline-flex' },
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
            display: { xs: 'none', md: 'inline-flex' },
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
          <Box sx={{ position: 'relative', flexShrink: 0, display: { xs: 'none', md: 'block' } }}>
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
          display:    { xs: 'none', md: 'flex' },
          alignItems: 'stretch',
          px:         { xs: '4px', sm: '12px' },
          overflowX:  'auto',
          flexWrap:   'nowrap',
          scrollSnapType: 'x proximity',
          scrollPaddingInline: '12px',
          WebkitOverflowScrolling: 'touch',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {desktopTabs.map(tab => (
          <TabButton
            key={tab.value}
            tab={tab}
            active={activeTab === tab.value}
            lang={lang}
            onClick={disabled ? undefined : () => onTabChange(tab.value)}
            disabled={disabled}
            tabRef={(node) => { tabRefs.current[tab.value] = node; }}
          />
        ))}
      </Box>
      <Box
        sx={{
          display: { xs: 'flex', md: 'none' },
          alignItems: 'stretch',
          gap: '8px',
          px: '8px',
          pb: '8px',
          overflowX: 'auto',
          flexWrap: 'nowrap',
          scrollSnapType: 'x proximity',
          scrollPaddingInline: '12px',
          WebkitOverflowScrolling: 'touch',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {mobileTabs.map(tab => (
          <TabButton
            key={tab.value}
            tab={tab}
            active={activeTab === tab.value}
            lang={lang}
            onClick={disabled ? undefined : () => onTabChange(tab.value)}
            disabled={disabled}
            tabRef={(node) => { tabRefs.current[tab.value] = node; }}
          />
        ))}
      </Box>
      {showCreditPanel && (
        <AdminCreditPanel
          lang={lang}
          onClose={() => setShowCreditPanel(false)}
        />
      )}
    </Box>
  );
}
