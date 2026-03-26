/**
 * AuthModal.jsx — H.E.X.A. V4 | Secure Access Portal
 *
 * Props:
 *   open       — boolean
 *   onClose    — () => void
 *   lang       — 'en' | 'es'
 *   defaultTab — 'login' | 'register'  (optional)
 */

import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../store/authStore';

// ── Sci-Fi Design Tokens (aligned with Phase A global system) ─────────────────
const NC = {
  bg:          '#000000',
  surface:     '#07090E',
  cyan:        '#00D9FF',
  cyanDim:     'rgba(0, 217, 255, 0.07)',
  cyanLine:    'rgba(0, 217, 255, 0.25)',
  cyanGlow:    '0 0 8px rgba(0,217,255,0.55), 0 0 20px rgba(0,217,255,0.2)',
  orange:      '#FF6600',
  orangeDim:   'rgba(255, 102, 0, 0.1)',
  orangeLine:  'rgba(255, 102, 0, 0.3)',
  orangeGlow:  '0 0 8px rgba(255,102,0,0.65), 0 0 20px rgba(255,102,0,0.25)',
  green:       '#00FF88',
  red:         '#FF2244',
  redDim:      'rgba(255, 34, 68, 0.07)',
  redLine:     'rgba(255, 34, 68, 0.25)',
  textPrimary: '#E8F4FF',
  textMuted:   'rgba(0, 217, 255, 0.5)',
  textDim:     'rgba(0, 217, 255, 0.3)',
};

const MONO    = "'Share Tech Mono', 'JetBrains Mono', 'Courier New', monospace";
const DISPLAY = "'Orbitron', 'Share Tech Mono', monospace";

// ── i18n ─────────────────────────────────────────────────────────────────────
const L = {
  en: {
    login:         'Login',
    register:      'Register',
    email:         'User ID // Email',
    password:      'Auth Key // Password',
    submitLogin:   'Authenticate',
    submitReg:     'Create Access',
    loading:       'Verifying…',
    switchToReg:   "No account? → Register",
    switchToLogin: 'Have access? → Login',
    close:         'Close',
    bootLine1:     'Establishing secure connection…',
    bootLine2:     'H.E.X.A. SECURE ACCESS PORTAL',
    bootLineEs1:   'Estableciendo conexión segura…',
    bootLineEs2:   'PORTAL DE ACCESO SEGURO H.E.X.A.',
  },
  es: {
    login:         'Iniciar sesión',
    register:      'Registrarse',
    email:         'ID Usuario // Email',
    password:      'Clave Auth // Contraseña',
    submitLogin:   'Autenticar',
    submitReg:     'Crear Acceso',
    loading:       'Verificando…',
    switchToReg:   '¿Sin cuenta? → Registrarse',
    switchToLogin: '¿Ya tienes acceso? → Login',
    close:         'Cerrar',
    bootLine1:     'Estableciendo conexión segura…',
    bootLine2:     'PORTAL DE ACCESO SEGURO H.E.X.A.',
    bootLineEs1:   'Establishing secure connection…',
    bootLineEs2:   'H.E.X.A. SECURE ACCESS PORTAL',
  },
};

// ── Boot sequence text component ──────────────────────────────────────────────
function BootHeader({ lang }) {
  const isEs = lang === 'es';
  const line1 = isEs ? 'Estableciendo conexión segura…' : 'Establishing secure connection…';
  const line2 = isEs ? 'PORTAL DE ACCESO H.E.X.A.' : 'H.E.X.A. SECURE ACCESS PORTAL';

  return (
    <Box sx={{ mb: '24px' }}>
      {/* Terminal ID line */}
      <Typography sx={{
        fontFamily:    MONO,
        fontSize:      '7px',
        color:         NC.textDim,
        letterSpacing: '2px',
        textTransform: 'uppercase',
        mb:            '8px',
      }}>
        // SYS_INIT · PROTOCOL_AUTH_V4
      </Typography>

      {/* Animated boot line */}
      <Typography sx={{
        fontFamily:    MONO,
        fontSize:      '9px',
        color:         NC.cyan,
        letterSpacing: '1.5px',
        mb:            '10px',
        '@keyframes bootBlink': {
          '0%, 49%':  { opacity: 1 },
          '50%, 100%': { opacity: 0 },
        },
        '&::after': {
          content:   '"_"',
          display:   'inline-block',
          animation: 'bootBlink 1s step-end infinite',
          color:     NC.cyan,
          ml:        '2px',
        },
      }}>
        {line1}
      </Typography>

      {/* Main portal title — Orbitron */}
      <Typography sx={{
        fontFamily:    DISPLAY,
        fontSize:      '14px',
        color:         NC.textPrimary,
        letterSpacing: '3px',
        textShadow:    `0 0 12px rgba(0,217,255,0.35)`,
        lineHeight:    1.2,
      }}>
        {line2}
      </Typography>
    </Box>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
function TabBar({ tab, setTab, t }) {
  return (
    <Box sx={{
      display:      'flex',
      borderBottom: `1px solid ${NC.cyanLine}`,
      mb:           '24px',
      gap:          '2px',
    }}>
      {['login', 'register'].map(key => {
        const active = tab === key;
        return (
          <Box
            key={key}
            component="button"
            onClick={() => setTab(key)}
            sx={{
              flex:          1,
              py:            '10px',
              border:        'none',
              borderBottom:  `2px solid ${active ? NC.cyan : 'transparent'}`,
              bgcolor:       active ? NC.cyanDim : 'transparent',
              color:         active ? NC.cyan : NC.textMuted,
              fontFamily:    MONO,
              fontSize:      '9px',
              letterSpacing: '3px',
              textTransform: 'uppercase',
              cursor:        'pointer',
              transition:    'all 0.2s',
              boxShadow:     active ? `0 2px 8px rgba(0,217,255,0.3)` : 'none',
              '&:hover':     { color: active ? NC.cyan : NC.textPrimary },
            }}
          >
            {key === 'login' ? t.login : t.register}
          </Box>
        );
      })}
    </Box>
  );
}

// ── Neon input field ──────────────────────────────────────────────────────────
function InputField({ label, type, value, onChange, disabled }) {
  const [focused, setFocused] = useState(false);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <Typography sx={{
        fontFamily:    MONO,
        fontSize:      '7px',
        color:         focused ? NC.cyan : NC.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '3px',
        transition:    'color 0.2s',
      }}>
        {label}
      </Typography>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          background:   NC.cyanDim,
          border:       `1px solid ${focused ? NC.cyan : NC.cyanLine}`,
          borderRadius: '0',
          color:        NC.textPrimary,
          fontFamily:   MONO,
          fontSize:     '12px',
          letterSpacing:'0.06em',
          padding:      '10px 14px',
          outline:      'none',
          width:        '100%',
          boxSizing:    'border-box',
          colorScheme:  'dark',
          opacity:      disabled ? 0.5 : 1,
          boxShadow:    focused ? NC.cyanGlow : 'none',
          transition:   'border-color 0.2s, box-shadow 0.2s',
        }}
      />
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AuthModal({ open, onClose, lang = 'en', defaultTab = 'login' }) {
  const t = L[lang] ?? L.en;
  const { login, register } = useAuth();

  const [tab,      setTab]      = useState(defaultTab);
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  // Reset form on open / tab change
  useEffect(() => {
    if (open) {
      setTab(defaultTab);
      setEmail('');
      setPassword('');
      setError('');
      setLoading(false);
    }
  }, [open, defaultTab]);

  useEffect(() => { setError(''); }, [tab]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') await login(email, password);
      else                 await register(email, password);
      onClose();
    } catch (err) {
      setError(err.message ?? 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  const canSubmit = !loading && email && password;

  return (
    <Box
      onClick={handleBackdropClick}
      sx={{
        position:        'fixed',
        inset:           0,
        width:           '100vw',
        height:          '100vh',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: 'rgba(0,0,0,0.88)',
        backdropFilter:  'blur(4px)',
        zIndex:          9999,
        px:              '16px',
      }}
    >
      {/* ── Card ── */}
      <Box
        sx={{
          position:     'relative',
          zIndex:       10000,
          width:        '100%',
          maxWidth:     '420px',
          maxHeight:    '90vh',
          overflowY:    'auto',
          bgcolor:      NC.surface,
          border:       `1px solid ${NC.cyanLine}`,
          borderRadius: '0',
          p:            { xs: '24px 20px', sm: '32px 28px' },
          boxShadow:    `0 0 40px rgba(0,0,0,0.9), 0 0 60px rgba(0,217,255,0.08)`,

          /* Corner brackets */
          '&::before': {
            content:    '""',
            position:   'absolute',
            top:        0,
            left:       0,
            width:      '16px',
            height:     '16px',
            borderTop:  `2px solid ${NC.cyan}`,
            borderLeft: `2px solid ${NC.cyan}`,
          },
          '&::after': {
            content:      '""',
            position:     'absolute',
            bottom:       0,
            right:        0,
            width:        '16px',
            height:       '16px',
            borderBottom: `2px solid ${NC.orange}`,
            borderRight:  `2px solid ${NC.orange}`,
          },
        }}
      >
        {/* Close button */}
        <Box
          component="button"
          onClick={onClose}
          title={t.close}
          sx={{
            position:       'absolute',
            top:            '12px',
            right:          '12px',
            width:          '24px',
            height:         '24px',
            border:         `1px solid ${NC.cyanLine}`,
            bgcolor:        'transparent',
            color:          NC.textMuted,
            fontFamily:     MONO,
            fontSize:       '10px',
            cursor:         'pointer',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            borderRadius:   '0',
            transition:     'all 0.15s',
            '&:hover':      { color: NC.cyan, borderColor: NC.cyan, boxShadow: NC.cyanGlow },
          }}
        >
          ✕
        </Box>

        {/* Boot sequence header */}
        <BootHeader lang={lang} />

        {/* Tab bar */}
        <TabBar tab={tab} setTab={setTab} t={t} />

        {/* Form */}
        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <InputField label={t.email}    type="email"    value={email}    onChange={setEmail}    disabled={loading} />
          <InputField label={t.password} type="password" value={password} onChange={setPassword} disabled={loading} />

          {/* Error */}
          {error && (
            <Box sx={{
              bgcolor:      NC.redDim,
              border:       `1px solid ${NC.redLine}`,
              borderRadius: '0',
              px:           '12px',
              py:           '8px',
              position:     'relative',
              '&::before': {
                content:    '""',
                position:   'absolute',
                top:        0,
                left:       0,
                width:      '6px',
                height:     '6px',
                borderTop:  `1px solid ${NC.red}`,
                borderLeft: `1px solid ${NC.red}`,
              },
            }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: NC.red, letterSpacing: '0.04em' }}>
                ⚠ {error}
              </Typography>
            </Box>
          )}

          {/* Submit */}
          <Box
            component="button"
            type="submit"
            disabled={!canSubmit}
            sx={{
              mt:            '4px',
              py:            '13px',
              border:        `1px solid ${canSubmit ? NC.orange : NC.cyanLine}`,
              borderRadius:  '0',
              background:    canSubmit ? NC.orangeDim : 'transparent',
              color:         canSubmit ? NC.orange : NC.textDim,
              fontFamily:    MONO,
              fontSize:      '10px',
              letterSpacing: '4px',
              textTransform: 'uppercase',
              cursor:        canSubmit ? 'pointer' : 'not-allowed',
              boxShadow:     canSubmit ? NC.orangeGlow : 'none',
              transition:    'all 0.2s',
              '@keyframes authPulse': {
                '0%, 100%': { boxShadow: '0 0 6px rgba(255,102,0,0.3)' },
                '50%':      { boxShadow: '0 0 18px rgba(255,102,0,0.8), 0 0 36px rgba(255,102,0,0.2)' },
              },
              animation:     canSubmit ? 'authPulse 2s ease-in-out infinite' : 'none',
              '&:hover':     canSubmit ? { background: 'rgba(255,102,0,0.2)', color: '#ffffff' } : {},
            }}
          >
            {loading ? t.loading : (tab === 'login' ? t.submitLogin : t.submitReg)}
          </Box>

          {/* Switch tab link */}
          <Typography
            onClick={() => setTab(tab === 'login' ? 'register' : 'login')}
            sx={{
              fontFamily:    MONO,
              fontSize:      '9px',
              color:         NC.textMuted,
              textAlign:     'center',
              cursor:        'pointer',
              letterSpacing: '0.06em',
              '&:hover':     { color: NC.cyan },
              transition:    'color 0.2s',
            }}
          >
            {tab === 'login' ? t.switchToReg : t.switchToLogin}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
