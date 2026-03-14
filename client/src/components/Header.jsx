/**
 * Header.jsx
 * Fixed top bar for H.E.X.A. V4 — logo, subtitle, language toggle, and tab bar.
 *
 * Props:
 *   lang        — 'en' | 'es'
 *   onLangToggle — (nextLang) => void
 *   activeTab   — 'game' | 'fullday' | 'parlay' | 'history'
 *   onTabChange — (tab) => void
 */

import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import LanguageToggle from './LanguageToggle';
import AuthModal from './AuthModal';
import { useAuth } from '../store/authStore';

// ── Constants ─────────────────────────────────────────────────────────────────

const MONO  = '"JetBrains Mono", "Fira Code", monospace';
const LABEL = '"Outfit", "Inter", system-ui, sans-serif';

const C = {
  bg:         '#0a0e17',
  border:     '#1e293b',
  accent:     '#f59e0b',
  accentFade: '#f59e0b09',
  textMuted:  '#94a3b8',
};

const SUBTITLE = {
  en: 'The MLB Sports Oracle',
  es: 'El Oráculo MLB',
};

// Tab order: Single Game → Full Day → Parlay → History
const TABS = [
  { value: 'game',    en: 'Single Game',    es: 'Juego Individual' },
  { value: 'fullday', en: 'Full Day',        es: 'Día Completo'     },
  { value: 'parlay',  en: 'Parlay',          es: 'Parlay'           },
  { value: 'history', en: 'History',         es: 'Historial'        },
];

// ── Statcast badge ────────────────────────────────────────────────────────────

const MONO_FONT = '"JetBrains Mono", "Fira Code", monospace';

function StatcastBadge({ lang }) {
  const [status, setStatus]   = useState(null);   // null = loading/failed
  const [hovered, setHovered] = useState(false);
  const [spinning, setSpinning] = useState(false);

  const isEs = lang === 'es';

  async function fetchStatus() {
    try {
      const res = await fetch('/api/savant/status');
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
      const res = await fetch('/api/savant/refresh', { method: 'POST' });
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

  // Format time HH:MM from ISO string
  let timeStr = '';
  if (status.lastUpdated) {
    try {
      const d = new Date(status.lastUpdated);
      timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { /* ignore */ }
  }

  const dot   = hasData ? '🟢' : '🔴';
  const label = hasData
    ? (isEs ? `Statcast: ${total} registros${timeStr ? ` · ${timeStr}` : ''}` : `Statcast: ${total} records${timeStr ? ` · ${timeStr}` : ''}`)
    : (isEs ? 'Statcast: Sin datos' : 'Statcast: No data');

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
    >
      <Typography
        sx={{
          fontFamily:    MONO_FONT,
          fontSize:      '0.55rem',
          color:         hasData ? '#64748b' : '#ef444480',
          letterSpacing: '0.02em',
          userSelect:    'none',
          whiteSpace:    'nowrap',
        }}
      >
        {dot} {label}
      </Typography>

      {/* Refresh button — visible only on hover */}
      <Box
        component="button"
        onClick={handleRefresh}
        sx={{
          display:    'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width:      '18px',
          height:     '18px',
          p:          0,
          border:     'none',
          bgcolor:    'transparent',
          color:      C.textMuted,
          cursor:     spinning ? 'default' : 'pointer',
          opacity:    hovered ? 0.7 : 0,
          transition: 'opacity 0.15s',
          fontSize:   '0.7rem',
          lineHeight: 1,
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
  const [modalOpen, setModalOpen] = useState(false);
  const isEs = lang === 'es';

  if (isLoading) return null;

  if (!isAuthenticated) {
    return (
      <>
        <Box
          component="button"
          onClick={() => setModalOpen(true)}
          sx={{
            px:           '12px',
            py:           '5px',
            border:       `1px solid ${C.accent}`,
            borderRadius: '6px',
            bgcolor:      C.accentFade,
            color:        C.accent,
            fontFamily:   LABEL,
            fontSize:     '0.72rem',
            fontWeight:   700,
            cursor:       'pointer',
            whiteSpace:   'nowrap',
            flexShrink:   0,
            transition:   'all 0.15s',
            '&:hover':    { bgcolor: `${C.accent}20` },
          }}
        >
          {isEs ? 'Iniciar sesión' : 'Sign In'}
        </Box>
        <AuthModal open={modalOpen} onClose={() => setModalOpen(false)} lang={lang} />
      </>
    );
  }

  // Authenticated — show email (truncated) + credits + logout
  const shortEmail = user?.email
    ? (user.email.length > 18 ? user.email.slice(0, 16) + '…' : user.email)
    : '—';

  return (
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
          borderRadius: '6px',
          bgcolor:      '#0f172a',
        }}
      >
        <Typography sx={{ fontFamily: MONO_FONT, fontSize: '0.6rem', color: C.textMuted, userSelect: 'none' }}>
          {shortEmail}
        </Typography>
        <Box sx={{ width: '1px', height: '10px', bgcolor: C.border }} />
        <Typography sx={{ fontFamily: MONO_FONT, fontSize: '0.6rem', color: C.accent, fontWeight: 700, userSelect: 'none' }}>
          {user?.credits ?? 0} {isEs ? 'créd.' : 'cr.'}
        </Typography>
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
          borderRadius:   '4px',
          '&:hover':      { color: C.textPrimary, bgcolor: '#1e293b' },
        }}
      >
        ⏏
      </Box>
    </Box>
  );
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TabButton({ tab, active, lang, onClick }) {
  const label = lang === 'es' ? tab.es : tab.en;

  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        position:      'relative',
        display:       'inline-flex',
        alignItems:    'center',
        px:            '20px',
        py:            '11px',
        background:    active ? 'rgba(245, 158, 11, 0.07)' : 'transparent',
        border:        'none',
        borderBottom:  active ? `2px solid ${C.accent}` : '2px solid transparent',
        color:         active ? C.accent : C.textMuted,
        fontFamily:    LABEL,
        fontSize:      '0.8rem',
        fontWeight:    active ? 700 : 500,
        letterSpacing: '0.01em',
        cursor:        'pointer',
        transition:    'color 0.15s, background 0.15s, border-color 0.15s',
        flexShrink:    0,
        '&:hover': {
          color:      active ? C.accent : '#cbd5e1',
          background: active ? 'rgba(245, 158, 11, 0.07)' : 'rgba(255,255,255,0.03)',
        },
      }}
    >
      {label}
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function Header({ lang = 'en', onLangToggle, activeTab, onTabChange }) {
  return (
    <Box
      component="header"
      sx={{
        position:     'sticky',
        top:          0,
        zIndex:       1000,
        background:   `linear-gradient(180deg, ${C.accentFade} 0%, ${C.bg} 100%)`,
        borderBottom: `1px solid ${C.border}`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        // Compensate for transparent gradient — keep bg fully opaque
        bgcolor:      C.bg,
      }}
    >
      {/* ── Top row: logo + subtitle + language toggle ── */}
      <Box
        sx={{
          display:        'flex',
          alignItems:     'center',
          px:             { xs: '16px', sm: '24px' },
          pt:             '14px',
          pb:             '8px',
          gap:            '12px',
        }}
      >
        {/* Logo block */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            component="span"
            sx={{
              fontFamily: MONO,
              fontSize:   { xs: '18px', sm: '24px' },
              fontWeight: 700,
              lineHeight: 1.1,
              background: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor:  'transparent',
              backgroundClip:       'text',
              display:    'block',
              userSelect: 'none',
            }}
          >
            ◆ H.E.X.A. V4
          </Typography>
          <Typography
            component="span"
            sx={{
              fontFamily:    LABEL,
              fontSize:      '11px',
              fontWeight:    500,
              color:         C.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              display:       'block',
              mt:            '2px',
            }}
          >
            {SUBTITLE[lang] ?? SUBTITLE.en}
          </Typography>
        </Box>

        {/* Statcast status badge */}
        <StatcastBadge lang={lang} />

        {/* Auth button / user pill */}
        <AuthButton lang={lang} />

        {/* Language toggle */}
        <LanguageToggle lang={lang} onToggle={onLangToggle} />
      </Box>

      {/* ── Tab bar ── */}
      <Box
        sx={{
          display:    'flex',
          alignItems: 'stretch',
          px:         { xs: '4px', sm: '12px' },
          overflowX:  'auto',
          // Hide scrollbar but keep scrollable on small screens
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
            onClick={() => onTabChange(tab.value)}
          />
        ))}
      </Box>
    </Box>
  );
}
