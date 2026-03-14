/**
 * AuthModal.jsx — Login / Register modal for H.E.X.A. V4
 *
 * Props:
 *   open     — boolean
 *   onClose  — () => void
 *   lang     — 'en' | 'es'
 *   defaultTab — 'login' | 'register'  (optional)
 */

import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../store/authStore';

// ── Design tokens (match Header / AnalysisPanel) ──────────────────────────────
const C = {
  bg:          '#0a0e17',
  overlay:     'rgba(0,0,0,0.75)',
  cardBg:      '#111827',
  cardBorder:  '#1e293b',
  accent:      '#f59e0b',
  accentDim:   '#f59e0b18',
  textPrimary: '#f1f5f9',
  textMuted:   '#94a3b8',
  red:         '#ef4444',
};

const MONO  = '"JetBrains Mono", "Fira Code", monospace';
const LABEL = '"Outfit", "Inter", system-ui, sans-serif';

// ── i18n ─────────────────────────────────────────────────────────────────────
const L = {
  en: {
    login:         'Login',
    register:      'Register',
    email:         'Email',
    password:      'Password',
    submitLogin:   'Sign In',
    submitReg:     'Create Account',
    loading:       'Please wait…',
    switchToReg:   "Don't have an account? Register",
    switchToLogin: 'Already have an account? Login',
    creditsNote:   '10 free credits on sign-up',
    close:         'Close',
  },
  es: {
    login:         'Iniciar sesión',
    register:      'Registrarse',
    email:         'Correo electrónico',
    password:      'Contraseña',
    submitLogin:   'Entrar',
    submitReg:     'Crear Cuenta',
    loading:       'Espera…',
    switchToReg:   '¿No tienes cuenta? Regístrate',
    switchToLogin: '¿Ya tienes cuenta? Inicia sesión',
    creditsNote:   '10 créditos gratis al registrarte',
    close:         'Cerrar',
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function TabBar({ tab, setTab, t }) {
  return (
    <Box sx={{ display: 'flex', borderBottom: `1px solid ${C.cardBorder}`, mb: '24px' }}>
      {['login', 'register'].map(key => {
        const active = tab === key;
        return (
          <Box
            key={key}
            component="button"
            onClick={() => setTab(key)}
            sx={{
              flex: 1,
              py: '12px',
              border: 'none',
              borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
              bgcolor: 'transparent',
              color: active ? C.accent : C.textMuted,
              fontFamily: LABEL,
              fontSize: '0.85rem',
              fontWeight: active ? 700 : 500,
              cursor: 'pointer',
              transition: 'all 0.15s',
              '&:hover': { color: active ? C.accent : C.textPrimary },
            }}
          >
            {key === 'login' ? t.login : t.register}
          </Box>
        );
      })}
    </Box>
  );
}

function InputField({ label, type, value, onChange, disabled }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <Typography sx={{ fontFamily: LABEL, fontSize: '0.72rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {label}
      </Typography>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        style={{
          background:   C.cardBorder,
          border:       `1px solid #2d3f55`,
          borderRadius: '7px',
          color:        C.textPrimary,
          fontFamily:   LABEL,
          fontSize:     '0.875rem',
          padding:      '10px 12px',
          outline:      'none',
          width:        '100%',
          boxSizing:    'border-box',
          colorScheme:  'dark',
          opacity:      disabled ? 0.5 : 1,
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

  // Reset form when modal opens or tab changes
  useEffect(() => {
    if (open) {
      setTab(defaultTab);
      setEmail('');
      setPassword('');
      setError('');
      setLoading(false);
    }
  }, [open, defaultTab]);

  useEffect(() => {
    setError('');
  }, [tab]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') {
        await login(email, password);
      } else {
        await register(email, password);
      }
      onClose();
    } catch (err) {
      setError(err.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  // Close on backdrop click
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <Box
      onClick={handleBackdropClick}
      sx={{
        position:        'fixed',
        top:             0,
        left:            0,
        right:           0,
        bottom:          0,
        width:           '100vw',
        height:          '100vh',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: 'rgba(0,0,0,0.8)',
        zIndex:          9999,
      }}
    >
      <Box
        sx={{
          position:     'relative',
          zIndex:       10000,
          width:        '100%',
          maxWidth:     '400px',
          maxHeight:    '90vh',
          overflowY:    'auto',
          bgcolor:      C.cardBg,
          border:       `1px solid ${C.cardBorder}`,
          borderRadius: '14px',
          p:            '28px',
          boxShadow:    `0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px ${C.cardBorder}`,
        }}
      >
        {/* Close button */}
        <Box
          component="button"
          onClick={onClose}
          title={t.close}
          sx={{
            position:  'absolute',
            top:       '14px',
            right:     '14px',
            width:     '28px',
            height:    '28px',
            border:    'none',
            bgcolor:   'transparent',
            color:     C.textMuted,
            fontSize:  '1rem',
            cursor:    'pointer',
            display:   'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '6px',
            '&:hover': { color: C.textPrimary, bgcolor: '#1e293b' },
          }}
        >
          ✕
        </Box>

        {/* Logo */}
        <Typography
          sx={{
            fontFamily: MONO,
            fontSize:   '1.1rem',
            fontWeight: 700,
            background: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor:  'transparent',
            backgroundClip: 'text',
            mb: '20px',
            userSelect: 'none',
          }}
        >
          ◆ H.E.X.A. V4
        </Typography>

        {/* Tab bar */}
        <TabBar tab={tab} setTab={setTab} t={t} />

        {/* Form */}
        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <InputField label={t.email}    type="email"    value={email}    onChange={setEmail}    disabled={loading} />
          <InputField label={t.password} type="password" value={password} onChange={setPassword} disabled={loading} />

          {/* Error */}
          {error && (
            <Box
              sx={{
                bgcolor:      '#ef444412',
                border:       `1px solid ${C.red}44`,
                borderRadius: '7px',
                px:           '12px',
                py:           '8px',
              }}
            >
              <Typography sx={{ fontFamily: LABEL, fontSize: '0.78rem', color: C.red }}>
                {error}
              </Typography>
            </Box>
          )}

          {/* Credits note on register tab */}
          {tab === 'register' && (
            <Typography sx={{ fontFamily: LABEL, fontSize: '0.72rem', color: C.accent, textAlign: 'center' }}>
              ✦ {t.creditsNote}
            </Typography>
          )}

          {/* Submit */}
          <Box
            component="button"
            type="submit"
            disabled={loading || !email || !password}
            sx={{
              mt:           '4px',
              py:           '12px',
              border:       'none',
              borderRadius: '8px',
              background:   (loading || !email || !password)
                ? C.cardBorder
                : `linear-gradient(135deg, ${C.accent} 0%, #d97706 100%)`,
              color:        (loading || !email || !password) ? C.textMuted : '#0a0e17',
              fontFamily:   LABEL,
              fontSize:     '0.875rem',
              fontWeight:   700,
              cursor:       (loading || !email || !password) ? 'not-allowed' : 'pointer',
              letterSpacing:'0.02em',
              transition:   'all 0.2s',
              '&:hover':    (!loading && email && password)
                ? { transform: 'translateY(-1px)', boxShadow: `0 4px 20px ${C.accent}44` }
                : {},
            }}
          >
            {loading ? t.loading : (tab === 'login' ? t.submitLogin : t.submitReg)}
          </Box>

          {/* Switch tab link */}
          <Typography
            onClick={() => setTab(tab === 'login' ? 'register' : 'login')}
            sx={{
              fontFamily: LABEL,
              fontSize:   '0.75rem',
              color:      C.textMuted,
              textAlign:  'center',
              cursor:     'pointer',
              '&:hover':  { color: C.accent },
              transition: 'color 0.15s',
            }}
          >
            {tab === 'login' ? t.switchToReg : t.switchToLogin}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
