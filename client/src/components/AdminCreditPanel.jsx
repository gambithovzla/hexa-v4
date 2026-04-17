/**
 * AdminCreditPanel.jsx
 * Floating panel for manually granting credits to a user.
 * Visible only to admins — rendered conditionally from Header.jsx.
 *
 * Props:
 *   lang    — 'en' | 'es'
 *   onClose — () => void
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO, BARLOW } from '../theme';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function AdminCreditPanel({ lang = 'en', onClose }) {
  const { token } = useAuth();
  const [email,   setEmail]   = useState('');
  const [amount,  setAmount]  = useState('');
  const [status,  setStatus]  = useState(null); // { type: 'success'|'error', message }
  const [loading, setLoading] = useState(false);

  const isEs = lang === 'es';

  const canSubmit = !loading && email.trim() !== '' && amount !== '';

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch(`${API_URL}/api/admin/grant-credits`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ email: email.trim(), amount: Number(amount) }),
      });

      const json = await res.json();

      if (res.ok && json.success) {
        setStatus({
          type:    'success',
          message: isEs
            ? `Nuevo saldo: ${json.credits} créditos → ${json.email}`
            : `New balance: ${json.credits} credits → ${json.email}`,
        });
        setEmail('');
        setAmount('');
      } else {
        setStatus({
          type:    'error',
          message: json.error || (isEs ? 'Error al actualizar créditos' : 'Failed to update credits'),
        });
      }
    } catch {
      setStatus({
        type:    'error',
        message: isEs ? 'Error de red' : 'Network error',
      });
    } finally {
      setLoading(false);
    }
  }

  // Shared input style (applied via style prop — not sx — so focus handlers can mutate it)
  const inputBase = {
    background:   C.surface,
    border:       `1px solid ${C.border}`,
    borderRadius: '4px',
    color:        C.textPrimary,
    fontFamily:   MONO,
    fontSize:     '0.78rem',
    padding:      '8px 10px',
    outline:      'none',
    width:        '100%',
    boxSizing:    'border-box',
    colorScheme:  'dark',
    transition:   'border-color 0.15s',
  };

  return (
    <Box
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      sx={{
        position:        'fixed',
        inset:           0,
        zIndex:          10050,
        display:         'flex',
        alignItems:      { xs: 'flex-end', sm: 'center' },
        justifyContent:  'center',
        bgcolor:         'rgba(0,0,0,0.72)',
        backdropFilter:  'blur(4px)',
        px:              { xs: 0, sm: '16px' },
      }}
    >
    <Box
      sx={{
        width:        { xs: '100%', sm: '360px' },
        maxWidth:     '100%',
        maxHeight:    { xs: '94vh', sm: '92vh' },
        overflowY:    'auto',
        background:   C.bg,
        border:       `1px solid ${C.border}`,
        borderTop:    `2px solid ${C.accent}`,
        borderRadius: { xs: '10px 10px 0 0', sm: '4px' },
        p:            '18px',
        boxShadow:    '0 8px 32px rgba(0,0,0,0.6)',
      }}
    >
      {/* ── Title row ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '16px' }}>
        <Typography
          sx={{
            fontFamily:    MONO,
            fontSize:      '0.65rem',
            color:         C.accent,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight:    700,
          }}
        >
          {isEs ? 'GESTOR DE CRÉDITOS' : 'CREDIT MANAGER'}
        </Typography>
        <Box
          component="button"
          onClick={onClose}
          sx={{
            background:  'none',
            border:      'none',
            color:       C.textMuted,
            cursor:      'pointer',
            fontSize:    '13px',
            lineHeight:  1,
            p:           '2px 4px',
            borderRadius:'2px',
            '&:hover':   { color: C.textSecondary, bgcolor: C.border },
          }}
        >
          ✕
        </Box>
      </Box>

      {/* ── Form ── */}
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
      >
        {/* User email */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <Typography
            sx={{
              fontFamily:    MONO,
              fontSize:      '0.56rem',
              color:         C.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.09em',
            }}
          >
            {isEs ? 'EMAIL DEL USUARIO' : 'USER EMAIL'}
          </Typography>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="user@example.com"
            disabled={loading}
            style={{ ...inputBase, opacity: loading ? 0.5 : 1 }}
            onFocus={e  => { e.target.style.borderColor = C.accent; }}
            onBlur={e   => { e.target.style.borderColor = C.border; }}
          />
        </Box>

        {/* Credits to add */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <Typography
            sx={{
              fontFamily:    MONO,
              fontSize:      '0.56rem',
              color:         C.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.09em',
            }}
          >
            {isEs ? 'CRÉDITOS A AÑADIR' : 'CREDITS TO ADD'}
          </Typography>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="50"
            disabled={loading}
            style={{ ...inputBase, opacity: loading ? 0.5 : 1 }}
            onFocus={e  => { e.target.style.borderColor = C.accent; }}
            onBlur={e   => { e.target.style.borderColor = C.border; }}
          />
        </Box>

        {/* Status message */}
        {status && (
          <Box
            sx={{
              p:            '8px 10px',
              borderRadius: '4px',
              bgcolor:      status.type === 'success' ? C.greenDim : C.redDim,
              border:       `1px solid ${status.type === 'success' ? C.greenLine : C.redLine}`,
            }}
          >
            <Typography
              sx={{
                fontFamily: MONO,
                fontSize:   '0.65rem',
                color:      status.type === 'success' ? C.green : C.red,
                lineHeight: 1.4,
              }}
            >
              {status.message}
            </Typography>
          </Box>
        )}

        {/* Submit button */}
        <Box
          component="button"
          type="submit"
          disabled={!canSubmit}
          sx={{
            py:            '9px',
            border:        'none',
            borderRadius:  '4px',
            background:    canSubmit ? C.accent : C.border,
            color:         canSubmit ? '#111111' : C.textMuted,
            fontFamily:    MONO,
            fontSize:      '0.7rem',
            fontWeight:    700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor:        canSubmit ? 'pointer' : 'not-allowed',
            transition:    'opacity 0.15s',
            '&:hover':     { opacity: canSubmit ? 0.88 : 1 },
          }}
        >
          {loading
            ? (isEs ? 'PROCESANDO...' : 'PROCESSING...')
            : (isEs ? 'ASIGNAR CRÉDITOS' : 'GRANT CREDITS')}
        </Box>
      </Box>
    </Box>
    </Box>
  );
}
