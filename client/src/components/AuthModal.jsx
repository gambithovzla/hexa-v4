/**
 * AuthModal.jsx — H.E.X.A. V4 | Secure Access Portal
 *
 * Props:
 *   open       — boolean
 *   onClose    — () => void
 *   lang       — 'en' | 'es'
 *   defaultTab — 'login' | 'register'  (optional)
 */

import { useState, useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
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
    login:           'Login',
    register:        'Register',
    email:           'User ID // Email',
    password:        'Auth Key // Password',
    submitLogin:     'Authenticate',
    submitReg:       'Create Access',
    loading:         'Verifying…',
    switchToReg:     "No account? → Register",
    switchToLogin:   'Have access? → Login',
    close:           'Close',
    bootLine1:       'Establishing secure connection…',
    bootLine2:       'H.E.X.A. SECURE ACCESS PORTAL',
    bootLineEs1:     'Estableciendo conexión segura…',
    bootLineEs2:     'PORTAL DE ACCESO SEGURO H.E.X.A.',
    verifyTitle:     'VERIFY YOUR EMAIL',
    verifySent:      (email) => `We sent a 6-digit code to ${email}`,
    verifyCode:      'Verification Code',
    verifySubmit:    'Verify',
    verifyResend:    'Resend code',
    verifyResending: 'Sending…',
    verifySentOk:    'Code resent!',
    verifySkip:      'Verify later',
    verifyCoachTitle:'Registration complete',
    verifyCoachBody: 'Enter the 6-digit code in this same window to finish activating your account.',
    verifyCoachHint: 'Check your inbox, spam, or promotions tab if the email takes a moment.',
    verifyCoachCta:  'Enter code now',
    verifyHelper:    'Paste the 6 digits below.',
    verifyPlaceholder:'6-digit code',
    verifyStepLabel: 'STEP 2 // EMAIL CODE',
    verifyResendCountdown: (s) => `Resend in ${s}s`,
    verifyCancelRegister: 'Cancel registration',
    verifyBlockedHint:    'You must verify your email to activate your account.',
    forgotLink:      'Forgot password?',
    forgotTitle:     'RESET ACCESS KEY',
    forgotStepLabel: 'RECOVERY // EMAIL',
    forgotBody:      'Enter your account email and we will send a 6-digit reset code.',
    forgotSubmit:    'Send reset code',
    forgotBack:      'Back to login',
    resetTitle:      'SET NEW PASSWORD',
    resetStepLabel:  'RECOVERY // RESET CODE',
    resetSent:       (email) => `If ${email} exists, a reset code was sent.`,
    resetHelper:     'Paste the 6 digits and choose a new password.',
    newPassword:     'New Auth Key // Password',
    resetSubmit:     'Update password',
    resetSuccess:    'Password updated. Log in with your new password.',
  },
  es: {
    login:           'Iniciar sesión',
    register:        'Registrarse',
    email:           'ID Usuario // Email',
    password:        'Clave Auth // Contraseña',
    submitLogin:     'Autenticar',
    submitReg:       'Crear Acceso',
    loading:         'Verificando…',
    switchToReg:     '¿Sin cuenta? → Registrarse',
    switchToLogin:   '¿Ya tienes acceso? → Login',
    close:           'Cerrar',
    bootLine1:       'Estableciendo conexión segura…',
    bootLine2:       'PORTAL DE ACCESO SEGURO H.E.X.A.',
    bootLineEs1:     'Establishing secure connection…',
    bootLineEs2:     'H.E.X.A. SECURE ACCESS PORTAL',
    verifyTitle:     'VERIFICA TU EMAIL',
    verifySent:      (email) => `Enviamos un código de 6 dígitos a ${email}`,
    verifyCode:      'Código de Verificación',
    verifySubmit:    'Verificar',
    verifyResend:    'Reenviar código',
    verifyResending: 'Enviando…',
    verifySentOk:    '¡Código reenviado!',
    verifySkip:      'Verificar después',
    verifyCoachTitle:'Registro completado',
    verifyCoachBody: 'Ingresa el codigo de 6 digitos en esta misma ventana para activar tu cuenta.',
    verifyCoachHint: 'Revisa bandeja principal, spam o promociones si el correo tarda un poco.',
    verifyCoachCta:  'Ingresar codigo',
    verifyHelper:    'Pega abajo los 6 digitos.',
    verifyPlaceholder:'Codigo de 6 digitos',
    verifyStepLabel: 'PASO 2 // CODIGO EMAIL',
    verifyResendCountdown: (s) => `Reenviar en ${s}s`,
    verifyCancelRegister: 'Cancelar registro',
    verifyBlockedHint:    'Debes verificar tu email para activar tu cuenta.',
    forgotLink:      'Olvide mi contrasena',
    forgotTitle:     'RECUPERAR CLAVE',
    forgotStepLabel: 'RECUPERACION // EMAIL',
    forgotBody:      'Ingresa el email de tu cuenta y enviaremos un codigo de 6 digitos.',
    forgotSubmit:    'Enviar codigo',
    forgotBack:      'Volver al login',
    resetTitle:      'NUEVA CONTRASENA',
    resetStepLabel:  'RECUPERACION // CODIGO',
    resetSent:       (email) => `Si ${email} existe, enviamos un codigo de recuperacion.`,
    resetHelper:     'Pega los 6 digitos y elige una nueva contrasena.',
    newPassword:     'Nueva Clave Auth // Contrasena',
    resetSubmit:     'Actualizar contrasena',
    resetSuccess:    'Contrasena actualizada. Inicia sesion con tu nueva clave.',
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
function InputField({
  label,
  type,
  value,
  onChange,
  disabled,
  placeholder,
  inputMode,
  maxLength,
  inputRef,
  autoFocus = false,
  showToggle = false,
}) {
  const [focused,   setFocused]   = useState(false);
  const [showPass,  setShowPass]  = useState(false);
  const resolvedType = showToggle ? (showPass ? 'text' : 'password') : type;
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
      <Box sx={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type={resolvedType}
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          inputMode={inputMode}
          maxLength={maxLength}
          autoFocus={autoFocus}
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
            padding:      showToggle ? '10px 38px 10px 14px' : '10px 14px',
            outline:      'none',
            width:        '100%',
            boxSizing:    'border-box',
            colorScheme:  'dark',
            opacity:      disabled ? 0.5 : 1,
            boxShadow:    focused ? NC.cyanGlow : 'none',
            transition:   'border-color 0.2s, box-shadow 0.2s',
          }}
        />
        {showToggle && (
          <Box
            component="button"
            type="button"
            onClick={() => setShowPass(s => !s)}
            disabled={disabled}
            tabIndex={-1}
            sx={{
              position:       'absolute',
              right:          '10px',
              top:            '50%',
              transform:      'translateY(-50%)',
              background:     'transparent',
              border:         'none',
              cursor:         disabled ? 'default' : 'pointer',
              color:          focused ? NC.cyan : NC.textMuted,
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              p:              0,
              opacity:        disabled ? 0.4 : 1,
              transition:     'color 0.2s',
              '&:hover':      { color: NC.cyan },
            }}
          >
            {showPass
              ? <VisibilityOffIcon sx={{ fontSize: '16px' }} />
              : <VisibilityIcon    sx={{ fontSize: '16px' }} />}
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ── 6-digit OTP input (mobile-friendly, auto-advance, paste support) ─────────
function OTPInput({ value, onChange, length = 6, disabled, autoFocus }) {
  const refs = useRef([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function updateValue(next) {
    onChange(next.replace(/\D/g, '').slice(0, length));
  }

  function handleChange(idx, raw) {
    const digit = raw.replace(/\D/g, '').slice(-1);
    const arr = digits.slice();
    arr[idx] = digit;
    updateValue(arr.join(''));
    if (digit && idx < length - 1) {
      refs.current[idx + 1]?.focus();
      refs.current[idx + 1]?.select?.();
    }
  }

  function handleKeyDown(idx, e) {
    if (e.key === 'Backspace') {
      if (!digits[idx] && idx > 0) {
        e.preventDefault();
        const arr = digits.slice();
        arr[idx - 1] = '';
        updateValue(arr.join(''));
        refs.current[idx - 1]?.focus();
      }
      return;
    }
    if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault();
      refs.current[idx - 1]?.focus();
      refs.current[idx - 1]?.select?.();
    }
    if (e.key === 'ArrowRight' && idx < length - 1) {
      e.preventDefault();
      refs.current[idx + 1]?.focus();
      refs.current[idx + 1]?.select?.();
    }
  }

  function handlePaste(e) {
    const pasted = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    e.preventDefault();
    updateValue(pasted);
    const nextIdx = Math.min(pasted.length, length - 1);
    setTimeout(() => {
      refs.current[nextIdx]?.focus();
      refs.current[nextIdx]?.select?.();
    }, 0);
  }

  return (
    <Box sx={{ display: 'flex', gap: { xs: '6px', sm: '8px' }, justifyContent: 'center', width: '100%' }}>
      {digits.map((d, i) => {
        const filled = Boolean(d);
        return (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={d}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select?.()}
            aria-label={`digit ${i + 1}`}
            style={{
              flex:          '1 1 0',
              minWidth:      0,
              maxWidth:      '52px',
              aspectRatio:   '1 / 1.2',
              textAlign:     'center',
              background:    filled ? 'rgba(255,102,0,0.08)' : NC.cyanDim,
              border:        `1px solid ${filled ? NC.orange : NC.cyanLine}`,
              borderRadius:  '0',
              color:         NC.textPrimary,
              fontFamily:    MONO,
              fontSize:      '22px',
              fontWeight:    700,
              letterSpacing: '0',
              padding:       '0',
              outline:       'none',
              colorScheme:   'dark',
              opacity:       disabled ? 0.5 : 1,
              boxShadow:     filled ? `0 0 10px rgba(255,102,0,0.35)` : 'none',
              transition:    'border-color 0.15s, box-shadow 0.15s, background 0.15s',
            }}
          />
        );
      })}
    </Box>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AuthModal({ open, onClose, lang = 'en', defaultTab = 'login', initialView = null }) {
  const t = L[lang] ?? L.en;
  const { login, register, logout, verifyEmail, resendCode, requestPasswordReset, resetPassword, user } = useAuth();

  const [tab,           setTab]           = useState(defaultTab);
  const [email,         setEmail]         = useState('');
  const [password,      setPassword]      = useState('');
  const [resetCode,     setResetCode]     = useState('');
  const [resetPassword_, setResetPassword_] = useState('');
  const [resetEmail,    setResetEmail]    = useState('');
  const [authMode,      setAuthMode]      = useState('auth'); // 'auth' | 'forgot' | 'reset'
  const [success,       setSuccess]       = useState('');
  const [error,         setError]         = useState('');
  const [loading,       setLoading]       = useState(false);
  const [verifyStep,    setVerifyStep]    = useState(false);
  const [verifyEmail_,  setVerifyEmail_]  = useState('');
  const [verifyCode,    setVerifyCode]    = useState('');
  const [verifySource,  setVerifySource]  = useState('login');
  const [resendStatus,  setResendStatus]  = useState('idle'); // 'idle' | 'sending' | 'sent'
  const [resendCooldown, setResendCooldown] = useState(0);
  const [ageConfirmed,  setAgeConfirmed]  = useState(false);

  const isBlockingVerify = verifyStep && verifySource === 'register';

  // Reset form when modal opens
  useEffect(() => {
    if (!open) return;
    setTab(defaultTab);
    setEmail('');
    setPassword('');
    setResetCode('');
    setResetPassword_('');
    setResetEmail('');
    setAuthMode('auth');
    setSuccess('');
    setError('');
    setLoading(false);
    setVerifyCode('');
    setResendStatus('idle');
    setAgeConfirmed(false);
    setVerifyStep(false);
    setVerifySource('login');
    setVerifyEmail_('');
    setResendCooldown(0);
  }, [open, defaultTab]);

  // Handle initialView='verify' (e.g. from Header's "verify email" button)
  useEffect(() => {
    if (!open || initialView !== 'verify') return;
    if (!user || user.email_verified !== false) return;
    setVerifyEmail_(user.email ?? '');
    setVerifySource('login');
    setVerifyStep(true);
    setResendCooldown(0);
  }, [open, initialView, user]);

  useEffect(() => {
    setError('');
    setSuccess('');
  }, [tab]);

  // Countdown tick for resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const id = setInterval(() => {
      setResendCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') {
        const user = await login(email, password);
        if (user && user.email_verified === false) {
          setVerifyEmail_(email);
          setVerifySource('login');
          setVerifyStep(true);
          setResendCooldown(0);
          setLoading(false);
          return;
        }
        onClose();
      } else {
        await register(email, password);
        setVerifyEmail_(email);
        setVerifySource('register');
        setVerifyStep(true);
        setResendCooldown(60);
      }
    } catch (err) {
      setError(err.message ?? 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setResetEmail(email);
      setResetCode('');
      setResetPassword_('');
      setAuthMode('reset');
    } catch (err) {
      setError(err.message ?? 'Failed to request password reset');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await resetPassword(resetEmail || email, resetCode.trim(), resetPassword_);
      setSuccess(t.resetSuccess);
      setPassword('');
      setResetCode('');
      setResetPassword_('');
      setAuthMode('auth');
      setTab('login');
    } catch (err) {
      setError(err.message ?? 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifyEmail(verifyCode.trim());
      onClose();
    } catch (err) {
      setError(err.message ?? 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || resendStatus === 'sending') return;
    setResendStatus('sending');
    try {
      await resendCode();
      setResendStatus('sent');
      setResendCooldown(60);
      setTimeout(() => setResendStatus('idle'), 3000);
    } catch {
      setResendStatus('idle');
    }
  }

  function handleCancelRegister() {
    logout();
    onClose();
  }

  function handleBackdropClick(e) {
    if (isBlockingVerify) return;
    if (e.target === e.currentTarget) onClose();
  }

  const canSubmit = !loading && email && password && (tab === 'login' || ageConfirmed);
  const canForgotSubmit = !loading && email;
  const canResetSubmit = !loading && (resetEmail || email) && resetCode.length >= 6 && resetPassword_.length >= 6;

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
        {/* Close button — hidden while blocking post-register verification */}
        {!isBlockingVerify && (
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
        )}

        {/* Boot sequence header */}
        <BootHeader lang={lang} />

        {verifyStep ? (
          /* ── Verification step ── */
          <Box component="form" onSubmit={handleVerify} sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Prominent banner — post-register celebratory / blocking message */}
            <Box
              sx={{
                border: `1px solid ${NC.orangeLine}`,
                borderLeft: `3px solid ${NC.orange}`,
                bgcolor: NC.orangeDim,
                px: '14px',
                py: '12px',
                boxShadow: `0 0 18px rgba(255,102,0,0.12)`,
              }}
            >
              <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: NC.orange, letterSpacing: '2px', textTransform: 'uppercase', mb: '6px' }}>
                {t.verifyStepLabel}
              </Typography>
              <Typography sx={{ fontFamily: DISPLAY, fontSize: '13px', color: NC.textPrimary, letterSpacing: '2px', textTransform: 'uppercase', mb: '8px' }}>
                {verifySource === 'register' ? t.verifyCoachTitle : t.verifyTitle}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: NC.textMuted, lineHeight: 1.7, mb: '4px' }}>
                {t.verifySent(verifyEmail_)}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: NC.textDim, lineHeight: 1.7 }}>
                {t.verifyCoachHint}
              </Typography>
              {isBlockingVerify && (
                <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: NC.orange, letterSpacing: '0.04em', mt: '8px' }}>
                  ⚠ {t.verifyBlockedHint}
                </Typography>
              )}
            </Box>

            {/* 6-digit OTP */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px', mt: '6px' }}>
              <Typography sx={{
                fontFamily:    MONO,
                fontSize:      '7px',
                color:         NC.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '3px',
                textAlign:     'center',
              }}>
                {t.verifyCode}
              </Typography>
              <OTPInput
                value={verifyCode}
                onChange={setVerifyCode}
                length={6}
                disabled={loading}
                autoFocus
              />
            </Box>

            {/* Error */}
            {error && (
              <Box sx={{ bgcolor: NC.redDim, border: `1px solid ${NC.redLine}`, borderRadius: '0', px: '12px', py: '8px' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: NC.red }}>⚠ {error}</Typography>
              </Box>
            )}

            {/* Verify button */}
            <Box
              component="button"
              type="submit"
              disabled={loading || verifyCode.length < 6}
              sx={{
                mt:            '4px',
                py:            '13px',
                border:        `1px solid ${verifyCode.length >= 6 ? NC.orange : NC.cyanLine}`,
                borderRadius:  '0',
                background:    verifyCode.length >= 6 ? NC.orangeDim : 'transparent',
                color:         verifyCode.length >= 6 ? NC.orange : NC.textDim,
                fontFamily:    MONO,
                fontSize:      '10px',
                letterSpacing: '4px',
                textTransform: 'uppercase',
                cursor:        verifyCode.length >= 6 && !loading ? 'pointer' : 'not-allowed',
                transition:    'all 0.2s',
                '&:hover':     verifyCode.length >= 6 ? { background: 'rgba(255,102,0,0.2)', color: '#ffffff' } : {},
              }}
            >
              {loading ? t.loading : t.verifySubmit}
            </Box>

            {/* Resend + cancel/skip */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <Typography
                onClick={resendCooldown === 0 && resendStatus !== 'sending' ? handleResend : undefined}
                sx={{
                  fontFamily:    MONO,
                  fontSize:      '9px',
                  color:         resendStatus === 'sent' ? NC.green : resendCooldown > 0 ? NC.textDim : NC.textMuted,
                  cursor:        resendCooldown === 0 && resendStatus !== 'sending' ? 'pointer' : 'default',
                  letterSpacing: '0.04em',
                  '&:hover':     resendCooldown === 0 && resendStatus !== 'sending' ? { color: NC.cyan } : {},
                  transition:    'color 0.2s',
                }}
              >
                {resendStatus === 'sending'
                  ? t.verifyResending
                  : resendStatus === 'sent'
                  ? t.verifySentOk
                  : resendCooldown > 0
                  ? t.verifyResendCountdown(resendCooldown)
                  : t.verifyResend}
              </Typography>
              <Typography
                onClick={isBlockingVerify ? handleCancelRegister : onClose}
                sx={{
                  fontFamily:    MONO,
                  fontSize:      '9px',
                  color:         NC.textDim,
                  cursor:        'pointer',
                  letterSpacing: '0.04em',
                  '&:hover':     { color: NC.textMuted },
                  transition:    'color 0.2s',
                }}
              >
                {isBlockingVerify ? t.verifyCancelRegister : t.verifySkip}
              </Typography>
            </Box>
          </Box>
        ) : authMode === 'forgot' ? (
          <Box component="form" onSubmit={handleForgotSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Box
              sx={{
                border: `1px solid ${NC.orangeLine}`,
                borderLeft: `3px solid ${NC.orange}`,
                bgcolor: NC.orangeDim,
                px: '14px',
                py: '12px',
              }}
            >
              <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: NC.orange, letterSpacing: '2px', textTransform: 'uppercase', mb: '6px' }}>
                {t.forgotStepLabel}
              </Typography>
              <Typography sx={{ fontFamily: DISPLAY, fontSize: '13px', color: NC.textPrimary, letterSpacing: '2px', textTransform: 'uppercase', mb: '8px' }}>
                {t.forgotTitle}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: NC.textMuted, lineHeight: 1.7 }}>
                {t.forgotBody}
              </Typography>
            </Box>

            <InputField label={t.email} type="email" value={email} onChange={setEmail} disabled={loading} autoFocus />

            {error && (
              <Box sx={{ bgcolor: NC.redDim, border: `1px solid ${NC.redLine}`, borderRadius: '0', px: '12px', py: '8px' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: NC.red }}>! {error}</Typography>
              </Box>
            )}

            <Box
              component="button"
              type="submit"
              disabled={!canForgotSubmit}
              sx={{
                mt: '4px',
                py: '13px',
                border: `1px solid ${canForgotSubmit ? NC.orange : NC.cyanLine}`,
                borderRadius: '0',
                background: canForgotSubmit ? NC.orangeDim : 'transparent',
                color: canForgotSubmit ? NC.orange : NC.textDim,
                fontFamily: MONO,
                fontSize: '10px',
                letterSpacing: '4px',
                textTransform: 'uppercase',
                cursor: canForgotSubmit ? 'pointer' : 'not-allowed',
                boxShadow: canForgotSubmit ? NC.orangeGlow : 'none',
                transition: 'all 0.2s',
                '&:hover': canForgotSubmit ? { background: 'rgba(255,102,0,0.2)', color: '#ffffff' } : {},
              }}
            >
              {loading ? t.loading : t.forgotSubmit}
            </Box>

            <Typography
              onClick={() => {
                setAuthMode('auth');
                setError('');
                setSuccess('');
              }}
              sx={{
                fontFamily: MONO,
                fontSize: '9px',
                color: NC.textMuted,
                textAlign: 'center',
                cursor: 'pointer',
                letterSpacing: '0.06em',
                '&:hover': { color: NC.cyan },
                transition: 'color 0.2s',
              }}
            >
              {t.forgotBack}
            </Typography>
          </Box>
        ) : authMode === 'reset' ? (
          <Box component="form" onSubmit={handleResetSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Box
              sx={{
                border: `1px solid ${NC.orangeLine}`,
                borderLeft: `3px solid ${NC.orange}`,
                bgcolor: NC.orangeDim,
                px: '14px',
                py: '12px',
              }}
            >
              <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: NC.orange, letterSpacing: '2px', textTransform: 'uppercase', mb: '6px' }}>
                {t.resetStepLabel}
              </Typography>
              <Typography sx={{ fontFamily: DISPLAY, fontSize: '13px', color: NC.textPrimary, letterSpacing: '2px', textTransform: 'uppercase', mb: '8px' }}>
                {t.resetTitle}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: NC.textMuted, lineHeight: 1.7, mb: '4px' }}>
                {t.resetSent(resetEmail || email)}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: NC.textDim, lineHeight: 1.7 }}>
                {t.resetHelper}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Typography sx={{
                fontFamily: MONO,
                fontSize: '7px',
                color: NC.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '3px',
                textAlign: 'center',
              }}>
                {t.verifyCode}
              </Typography>
              <OTPInput
                value={resetCode}
                onChange={setResetCode}
                length={6}
                disabled={loading}
                autoFocus
              />
            </Box>

            <InputField label={t.newPassword} type="password" value={resetPassword_} onChange={setResetPassword_} disabled={loading} showToggle />

            {error && (
              <Box sx={{ bgcolor: NC.redDim, border: `1px solid ${NC.redLine}`, borderRadius: '0', px: '12px', py: '8px' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: NC.red }}>! {error}</Typography>
              </Box>
            )}
            {success && (
              <Box sx={{ bgcolor: 'rgba(0,255,136,0.08)', border: `1px solid rgba(0,255,136,0.3)`, borderRadius: '0', px: '12px', py: '8px' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: NC.green }}>{success}</Typography>
              </Box>
            )}

            <Box
              component="button"
              type="submit"
              disabled={!canResetSubmit}
              sx={{
                mt: '4px',
                py: '13px',
                border: `1px solid ${canResetSubmit ? NC.orange : NC.cyanLine}`,
                borderRadius: '0',
                background: canResetSubmit ? NC.orangeDim : 'transparent',
                color: canResetSubmit ? NC.orange : NC.textDim,
                fontFamily: MONO,
                fontSize: '10px',
                letterSpacing: '4px',
                textTransform: 'uppercase',
                cursor: canResetSubmit ? 'pointer' : 'not-allowed',
                boxShadow: canResetSubmit ? NC.orangeGlow : 'none',
                transition: 'all 0.2s',
                '&:hover': canResetSubmit ? { background: 'rgba(255,102,0,0.2)', color: '#ffffff' } : {},
              }}
            >
              {loading ? t.loading : t.resetSubmit}
            </Box>

            <Typography
              onClick={() => {
                setAuthMode('auth');
                setError('');
              }}
              sx={{
                fontFamily: MONO,
                fontSize: '9px',
                color: NC.textMuted,
                textAlign: 'center',
                cursor: 'pointer',
                letterSpacing: '0.06em',
                '&:hover': { color: NC.cyan },
                transition: 'color 0.2s',
              }}
            >
              {t.forgotBack}
            </Typography>
          </Box>
        ) : (
          <>
            {/* Tab bar */}
            <TabBar tab={tab} setTab={setTab} t={t} />

            {/* Form */}
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <InputField label={t.email}    type="email"    value={email}    onChange={setEmail}    disabled={loading} />
              <InputField label={t.password} type="password" value={password} onChange={setPassword} disabled={loading} showToggle />

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

              {/* Age confirmation — register only */}
              {success && (
                <Box sx={{
                  bgcolor:      'rgba(0,255,136,0.08)',
                  border:       '1px solid rgba(0,255,136,0.3)',
                  borderRadius: '0',
                  px:           '12px',
                  py:           '8px',
                }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: NC.green, letterSpacing: '0.04em' }}>
                    {success}
                  </Typography>
                </Box>
              )}

              {tab === 'register' && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="checkbox"
                    id="age-confirm"
                    checked={ageConfirmed}
                    onChange={e => setAgeConfirmed(e.target.checked)}
                    disabled={loading}
                    style={{
                      accentColor: NC.cyan,
                      width: '14px',
                      height: '14px',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  />
                  <label htmlFor="age-confirm" style={{
                    fontFamily: MONO,
                    fontSize: '9px',
                    color: NC.textMuted,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                    lineHeight: 1.5,
                  }}>
                    {lang === 'es'
                      ? 'Confirmo que soy mayor de 18 años'
                      : 'I confirm I am 18 years or older'}
                  </label>
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

              {tab === 'login' && (
                <Typography
                  onClick={() => {
                    setAuthMode('forgot');
                    setError('');
                    setSuccess('');
                  }}
                  sx={{
                    fontFamily:    MONO,
                    fontSize:      '9px',
                    color:         NC.orange,
                    textAlign:     'center',
                    cursor:        'pointer',
                    letterSpacing: '0.06em',
                    '&:hover':     { color: NC.textPrimary },
                    transition:    'color 0.2s',
                  }}
                >
                  {t.forgotLink}
                </Typography>
              )}

              {/* Switch tab link */}
              <Typography
                onClick={() => {
                  setSuccess('');
                  setTab(tab === 'login' ? 'register' : 'login');
                }}
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
          </>
        )}
      </Box>
    </Box>
  );
}
