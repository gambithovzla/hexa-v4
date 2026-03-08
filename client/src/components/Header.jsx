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

import { Box, Typography } from '@mui/material';
import LanguageToggle from './LanguageToggle';

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
