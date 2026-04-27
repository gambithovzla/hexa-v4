import { Box, Typography } from '@mui/material';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { C, BARLOW, MONO } from '../theme';

export const WHATSAPP_SUPPORT_PHONE = '51970752104';

const COPY = {
  es: {
    label: 'Soporte',
    cta: 'Hablar por WhatsApp',
    title: 'Soporte Hexa',
    eyebrow: '// CANAL DIRECTO',
    body: 'Escribenos por WhatsApp si necesitas ayuda con tu cuenta, picks o suscripcion.',
    scope: 'Hexa ofrece analisis y picks deportivos. No procesamos apuestas.',
    aria: 'Contactar soporte de Hexa por WhatsApp',
    message: 'Hola Hexa, necesito ayuda con mi cuenta.',
  },
  en: {
    label: 'Support',
    cta: 'Chat on WhatsApp',
    title: 'Hexa Support',
    eyebrow: '// DIRECT CHANNEL',
    body: 'Message us on WhatsApp if you need help with your account, picks, or subscription.',
    scope: 'Hexa provides sports analysis and picks. We do not process bets.',
    aria: 'Contact Hexa support on WhatsApp',
    message: 'Hi Hexa, I need help with my account.',
  },
};

export function getWhatsAppSupportUrl(lang = 'es') {
  const copy = COPY[lang] ?? COPY.es;
  return `https://wa.me/${WHATSAPP_SUPPORT_PHONE}?text=${encodeURIComponent(copy.message)}`;
}

export default function WhatsAppSupport({ lang = 'es', variant = 'nav' }) {
  const copy = COPY[lang] ?? COPY.es;
  const href = getWhatsAppSupportUrl(lang);

  if (variant === 'footer') {
    return (
      <Box
        sx={{
          width: 'min(680px, 100%)',
          mx: 'auto',
          mb: '20px',
          p: { xs: '14px 14px', sm: '16px 18px' },
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr auto' },
          alignItems: 'center',
          gap: '14px',
          textAlign: 'left',
          border: `1px solid rgba(0,255,136,0.28)`,
          borderLeft: `3px solid #00FF88`,
          bgcolor: 'rgba(0,255,136,0.055)',
          boxShadow: '0 14px 28px rgba(0,0,0,0.32), 0 0 18px rgba(0,255,136,0.08)',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.58rem',
              color: '#00FF88',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              mb: '6px',
            }}
          >
            {copy.eyebrow}
          </Typography>
          <Typography
            sx={{
              fontFamily: BARLOW,
              fontSize: { xs: '0.92rem', sm: '1rem' },
              fontWeight: 800,
              color: C.textPrimary,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              mb: '6px',
            }}
          >
            {copy.title}
          </Typography>
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: '0.72rem',
              color: C.textMuted,
              lineHeight: 1.6,
            }}
          >
            {copy.body}
          </Typography>
          <Typography
            sx={{
              mt: '8px',
              fontFamily: MONO,
              fontSize: '0.62rem',
              color: 'rgba(0,217,255,0.48)',
              lineHeight: 1.5,
            }}
          >
            {copy.scope}
          </Typography>
        </Box>
        <SupportLink href={href} copy={copy} mode="footer" />
      </Box>
    );
  }

  return <SupportLink href={href} copy={copy} mode="nav" />;
}

function SupportLink({ href, copy, mode }) {
  const isFooter = mode === 'footer';

  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={copy.aria}
      title={copy.aria}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isFooter ? '8px' : '6px',
        minHeight: isFooter ? '38px' : '24px',
        px: isFooter ? '14px' : { xs: '7px', sm: '12px' },
        py: isFooter ? '9px' : '5px',
        border: '1px solid rgba(0,255,136,0.42)',
        borderRadius: 0,
        bgcolor: 'rgba(0,255,136,0.1)',
        color: '#00FF88',
        fontFamily: BARLOW,
        fontSize: isFooter ? '0.7rem' : '0.64rem',
        fontWeight: 800,
        letterSpacing: isFooter ? '0.12em' : '0.14em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'all 0.2s ease',
        boxShadow: isFooter ? '0 0 16px rgba(0,255,136,0.12)' : 'none',
        '&:hover': {
          bgcolor: 'rgba(0,255,136,0.18)',
          borderColor: 'rgba(0,255,136,0.68)',
          color: '#ffffff',
          boxShadow: '0 0 14px rgba(0,255,136,0.32), 0 0 28px rgba(0,255,136,0.08)',
        },
      }}
    >
      <WhatsAppIcon sx={{ fontSize: isFooter ? 17 : 15 }} />
      <Box component="span" sx={{ display: isFooter ? 'inline' : { xs: 'none', sm: 'inline' } }}>
        {isFooter ? copy.cta : copy.label}
      </Box>
    </Box>
  );
}
