/**
 * PricingModal.jsx
 * Buy Me a Coffee credit purchase modal for H.E.X.A. V4.
 *
 * Props:
 *   onClose — () => void
 *   lang    — 'en' | 'es'
 */

import { Box, Typography } from '@mui/material';
import { useAuth } from '../store/authStore';
import { C, BARLOW, MONO, SANS } from '../theme';

const DM = SANS;

const PLANS = [
  {
    id:        'rookie',
    label:     'HEXA Rookie',
    price:     '$7.99',
    credits:   { en: '15 credits', es: '15 créditos' },
    href:      'https://buymeacoffee.com/Gambitho/e/522545',
    highlight: false,
    badge:     null,
    btnLabel:  { en: 'Buy Rookie', es: 'Comprar Rookie' },
  },
  {
    id:        'allstar',
    label:     'HEXA All-Star',
    price:     '$19.99',
    credits:   { en: '50 credits', es: '50 créditos' },
    href:      'https://buymeacoffee.com/Gambitho/e/522546',
    highlight: true,
    badge:     'MÁS POPULAR',
    btnLabel:  { en: 'Buy All-Star', es: 'Comprar All-Star' },
  },
  {
    id:        'mvp',
    label:     'HEXA MVP',
    price:     '$39.99',
    credits:   { en: '120 credits', es: '120 créditos' },
    href:      'https://buymeacoffee.com/Gambitho/e/522547',
    highlight: false,
    badge:     null,
    btnLabel:  { en: 'Buy MVP', es: 'Comprar MVP' },
  },
];

function PlanCard({ plan, lang }) {
  const isEs = lang === 'es';
  return (
    <Box
      sx={{
        display:       'flex',
        flexDirection: 'column',
        p:             '20px 18px',
        bgcolor:       C.surface,
        border:        `1px solid ${plan.highlight ? C.accent : C.border}`,
        borderRadius:  0,
        position:      'relative',
        minWidth:      0,
        boxShadow:     plan.highlight ? `0 0 24px rgba(79,195,247,0.12)` : 'none',
      }}
    >
      {/* Badge */}
      {plan.badge && (
        <Box sx={{
          position:  'absolute',
          top:       '-1px',
          left:      '50%',
          transform: 'translateX(-50%)',
          px:        '10px',
          py:        '2px',
          bgcolor:   C.accent,
          borderRadius: 0,
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
      </Box>

      {/* Credits */}
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.accent, fontWeight: 700, mb: '8px' }}>
        {isEs ? plan.credits.es : plan.credits.en}
      </Typography>

      {/* Beta badge */}
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', mb: '12px', px: '7px', py: '3px', bgcolor: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.3)', borderRadius: 0, alignSelf: 'flex-start' }}>
        <Typography sx={{ fontFamily: BARLOW, fontSize: '0.58rem', fontWeight: 800, color: '#FFB800', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          🚀 Beta Founding Price
        </Typography>
      </Box>

      {/* Buy button — direct BMC link */}
      <Box
        component="a"
        href={plan.href}
        target="_blank"
        rel="noopener noreferrer"
        sx={{
          mt:             'auto',
          px:             '12px',
          py:             '8px',
          border:         `1px solid ${plan.highlight ? C.accent : C.border}`,
          borderRadius:   0,
          bgcolor:        plan.highlight ? C.accentDim : 'transparent',
          color:          plan.highlight ? C.accent : C.textPrimary,
          fontFamily:     BARLOW,
          fontSize:       '0.78rem',
          fontWeight:     700,
          letterSpacing:  '0.08em',
          textTransform:  'uppercase',
          cursor:         'pointer',
          transition:     'all 0.15s',
          textDecoration: 'none',
          display:        'block',
          textAlign:      'center',
          '&:hover':      { bgcolor: plan.highlight ? 'rgba(79,195,247,0.15)' : 'rgba(255,255,255,0.04)', borderColor: plan.highlight ? C.accent : '#2a4060' },
        }}
      >
        {isEs ? plan.btnLabel.es : plan.btnLabel.en}
      </Box>
    </Box>
  );
}

export default function PricingModal({ onClose, lang = 'es' }) {
  const { user } = useAuth();
  const isEs = lang === 'es';

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
          maxWidth:  '700px',
          maxHeight: '90vh',
          overflowY: 'auto',
          bgcolor:   C.bg,
          border:    `1px solid ${C.border}`,
          boxShadow: '0 0 60px rgba(79,195,247,0.1), 0 24px 48px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', px: '24px', pt: '20px', pb: '16px', borderBottom: `1px solid ${C.border}` }}>
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
              border:         `1px solid ${C.border}`,
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

        {/* Plan grid */}
        <Box
          sx={{
            display:             'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
            gap:                 '1px',
            p:                   '24px',
            bgcolor:             C.border,
          }}
        >
          {PLANS.map(plan => (
            <PlanCard key={plan.id} plan={plan} lang={lang} />
          ))}
        </Box>

        {/* Footer note */}
        <Box sx={{ px: '24px', pb: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Typography sx={{ fontFamily: DM, fontSize: '0.72rem', color: C.textMuted, lineHeight: 1.6 }}>
            {isEs
              ? 'Los créditos nunca vencen. Pagos procesados de forma segura por Buy Me a Coffee.'
              : 'Credits never expire. Payments securely processed by Buy Me a Coffee.'}
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
