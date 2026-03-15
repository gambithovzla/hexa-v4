/**
 * PricingModal.jsx
 * Lemon Squeezy credit purchase modal for H.E.X.A. V4.
 *
 * Props:
 *   onClose — () => void
 *   lang    — 'en' | 'es'
 */

import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const BARLOW = '"Barlow Condensed", system-ui, sans-serif';
const DM     = '"DM Sans", system-ui, sans-serif';
const MONO   = '"JetBrains Mono", "Fira Code", monospace';

const C = {
  bg:          '#0a1628',
  cardBg:      '#0d1f38',
  cardBorder:  '#1a3050',
  accent:      '#4fc3f7',
  accentDim:   'rgba(79,195,247,0.08)',
  accentLine:  'rgba(79,195,247,0.25)',
  textPrimary: '#E8EDF5',
  textMuted:   '#5A7090',
  green:       '#00E676',
};

const PLANS = [
  {
    id:         'free',
    label:      'Free',
    price:      '$0',
    period:     null,
    credits:    { en: '5 credits on signup', es: '5 créditos al registrarse' },
    variantId:  null,
    highlight:  false,
    badge:      null,
    betaBadge:  false,
    btnLabel:   { en: 'Current Plan', es: 'Plan actual' },
    disabled:   true,
  },
  {
    id:         'starter',
    label:      'Starter',
    price:      '$7.99',
    period:     null,
    credits:    { en: '30 credits', es: '30 créditos' },
    variantId:  '1407032',
    highlight:  false,
    badge:      null,
    betaBadge:  true,
    btnLabel:   { en: 'Buy Starter', es: 'Comprar Starter' },
    disabled:   false,
  },
  {
    id:         'mvp',
    label:      'MVP',
    price:      '$19.99',
    period:     { en: '/mo', es: '/mes' },
    credits:    { en: '80 credits/mo', es: '80 créditos/mes' },
    variantId:  '1407417',
    highlight:  true,
    badge:      'MÁS POPULAR',
    betaBadge:  true,
    btnLabel:   { en: 'Subscribe MVP', es: 'Suscribirse MVP' },
    disabled:   false,
  },
  {
    id:         'addon',
    label:      'Add-on',
    price:      '$4.99',
    period:     null,
    credits:    { en: '18 credits', es: '18 créditos' },
    variantId:  '1407425',
    highlight:  false,
    badge:      null,
    betaBadge:  true,
    btnLabel:   { en: 'Buy Add-on', es: 'Comprar Add-on' },
    disabled:   false,
  },
];

function PlanCard({ plan, lang, onBuy, loading }) {
  const isEs = lang === 'es';
  return (
    <Box
      sx={{
        display:       'flex',
        flexDirection: 'column',
        p:             '20px 18px',
        bgcolor:       C.cardBg,
        border:        `1px solid ${plan.highlight ? C.accent : C.cardBorder}`,
        borderRadius:  0,
        position:      'relative',
        minWidth:      0,
        boxShadow:     plan.highlight ? `0 0 24px rgba(79,195,247,0.12)` : 'none',
      }}
    >
      {/* Badge */}
      {plan.badge && (
        <Box sx={{
          position:      'absolute',
          top:           '-1px',
          left:          '50%',
          transform:     'translateX(-50%)',
          px:            '10px',
          py:            '2px',
          bgcolor:       C.accent,
          borderRadius:  0,
        }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.6rem', fontWeight: 800, color: '#000', letterSpacing: '0.12em' }}>
            {plan.badge}
          </Typography>
        </Box>
      )}

      {/* Plan name */}
      <Typography sx={{ fontFamily: BARLOW, fontSize: '1rem', fontWeight: 800, color: plan.highlight ? C.accent : C.textPrimary, textTransform: 'uppercase', letterSpacing: '0.12em', mb: '8px' }}>
        {plan.label}
      </Typography>

      {/* Price */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '2px', mb: '6px' }}>
        <Typography sx={{ fontFamily: BARLOW, fontSize: '1.8rem', fontWeight: 900, color: C.textPrimary, lineHeight: 1 }}>
          {plan.price}
        </Typography>
        {plan.period && (
          <Typography sx={{ fontFamily: DM, fontSize: '0.72rem', color: C.textMuted }}>
            {isEs ? plan.period.es : plan.period.en}
          </Typography>
        )}
      </Box>

      {/* Credits */}
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.accent, fontWeight: 700, mb: '8px' }}>
        {isEs ? plan.credits.es : plan.credits.en}
      </Typography>

      {/* Beta badge */}
      {plan.betaBadge && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', mb: '12px', px: '7px', py: '3px', bgcolor: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.3)', borderRadius: 0, alignSelf: 'flex-start' }}>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.58rem', fontWeight: 800, color: '#FFB800', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            🚀 Beta Founding Price
          </Typography>
        </Box>
      )}

      {/* Buy button */}
      <Box
        component="button"
        disabled={plan.disabled || loading === plan.variantId}
        onClick={() => !plan.disabled && onBuy(plan.variantId)}
        sx={{
          mt:            'auto',
          px:            '12px',
          py:            '8px',
          border:        `1px solid ${plan.disabled ? C.cardBorder : plan.highlight ? C.accent : C.cardBorder}`,
          borderRadius:  0,
          bgcolor:       plan.disabled
            ? 'transparent'
            : plan.highlight
              ? C.accentDim
              : 'transparent',
          color:         plan.disabled ? C.textMuted : plan.highlight ? C.accent : C.textPrimary,
          fontFamily:    BARLOW,
          fontSize:      '0.78rem',
          fontWeight:    700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor:        plan.disabled ? 'default' : 'pointer',
          transition:    'all 0.15s',
          opacity:       loading && loading !== plan.variantId ? 0.5 : 1,
          '&:hover':     !plan.disabled ? { bgcolor: plan.highlight ? 'rgba(79,195,247,0.15)' : 'rgba(255,255,255,0.04)', borderColor: plan.highlight ? C.accent : '#2a4060' } : {},
        }}
      >
        {loading === plan.variantId
          ? (isEs ? 'Redirigiendo…' : 'Redirecting…')
          : (isEs ? plan.btnLabel.es : plan.btnLabel.en)
        }
      </Box>
    </Box>
  );
}

export default function PricingModal({ onClose, lang = 'es' }) {
  const { user } = useAuth();
  const isEs = lang === 'es';
  const [loading, setLoading] = useState(null);
  const [successMsg, setSuccessMsg] = useState('');

  // Check for ?payment=success on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success') {
      setSuccessMsg(isEs
        ? '✅ ¡Pago exitoso! Tus créditos se acreditarán en segundos.'
        : '✅ Payment successful! Your credits will be added in seconds.');
      params.delete('payment');
      const newUrl = window.location.pathname + (params.toString() ? `?${params}` : '');
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  async function handleBuy(variantId) {
    if (!variantId || !user) return;
    setLoading(variantId);
    try {
      const res = await fetch(`${API_URL}/api/lemon/checkout`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${localStorage.getItem('hexa_token')}`,
        },
        body: JSON.stringify({
          variantId,
          userEmail: user.email,
          userId:    user.id,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(isEs ? 'Error al crear el checkout. Inténtalo de nuevo.' : 'Checkout error. Please try again.');
      }
    } catch {
      alert(isEs ? 'Error de red. Inténtalo de nuevo.' : 'Network error. Please try again.');
    } finally {
      setLoading(null);
    }
  }

  return (
    /* Overlay */
    <Box
      onClick={onClose}
      sx={{
        position:        'fixed',
        top:             0,
        left:            0,
        width:           '100vw',
        height:          '100vh',
        zIndex:          9999,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: 'rgba(0,0,0,0.85)',
      }}
    >
      {/* Modal box */}
      <Box
        onClick={e => e.stopPropagation()}
        sx={{
          position:  'relative',
          zIndex:    10000,
          width:     '90%',
          maxWidth:  '800px',
          maxHeight: '90vh',
          overflowY: 'auto',
          bgcolor:   C.bg,
          border:    `1px solid ${C.cardBorder}`,
          boxShadow: '0 0 60px rgba(79,195,247,0.1), 0 24px 48px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', px: '24px', pt: '20px', pb: '16px', borderBottom: `1px solid ${C.cardBorder}` }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '1.1rem', fontWeight: 800, color: C.textPrimary, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
              {isEs ? '⚡ Créditos H.E.X.A.' : '⚡ H.E.X.A. Credits'}
            </Typography>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '0.62rem', fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.25em', mt: '2px' }}>
              {isEs ? 'Elige tu plan' : 'Choose your plan'}
            </Typography>
          </Box>

          {/* Current credits */}
          {user && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: C.accent, fontWeight: 700, mr: '16px' }}>
              {user.credits ?? 0} {isEs ? 'créd. actuales' : 'current cr.'}
            </Typography>
          )}

          {/* Close */}
          <Box
            component="button"
            onClick={onClose}
            sx={{
              display:        'inline-flex',
              alignItems:     'center',
              justifyContent: 'center',
              width:          '28px',
              height:         '28px',
              border:         `1px solid ${C.cardBorder}`,
              borderRadius:   0,
              bgcolor:        'transparent',
              color:          C.textMuted,
              cursor:         'pointer',
              fontSize:       '0.9rem',
              flexShrink:     0,
              '&:hover':      { color: C.textPrimary, borderColor: C.accent },
            }}
          >
            ✕
          </Box>
        </Box>

        {/* Success banner */}
        {successMsg && (
          <Box sx={{ mx: '24px', mt: '16px', p: '12px 16px', bgcolor: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.3)' }}>
            <Typography sx={{ fontFamily: DM, fontSize: '0.82rem', color: C.green }}>{successMsg}</Typography>
          </Box>
        )}

        {/* Plan grid */}
        <Box
          sx={{
            display:             'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
            gap:                 '1px',
            p:                   '24px',
            bgcolor:             C.cardBorder,
          }}
        >
          {PLANS.map(plan => (
            <PlanCard key={plan.id} plan={plan} lang={lang} onBuy={handleBuy} loading={loading} />
          ))}
        </Box>

        {/* Footer note */}
        <Box sx={{ px: '24px', pb: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Typography sx={{ fontFamily: DM, fontSize: '0.72rem', color: C.textMuted, lineHeight: 1.6 }}>
            {isEs
              ? 'Los créditos nunca vencen (excepto el plan MVP que se renueva mensualmente). Pagos procesados de forma segura por Lemon Squeezy.'
              : 'Credits never expire (except MVP plan which renews monthly). Payments securely processed by Lemon Squeezy.'}
          </Typography>
          <Typography sx={{ fontFamily: BARLOW, fontSize: '0.68rem', fontWeight: 700, color: '#FFB800', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            🚀 {isEs
              ? 'Precios de lanzamiento — Temporada 2026. Los precios subirán una vez validado el modelo.'
              : 'Launch pricing — 2026 Season. Prices will increase once the model is validated.'}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
