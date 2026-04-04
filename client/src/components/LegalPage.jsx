/**
 * LegalPage.jsx — H.E.X.A. V4
 *
 * Full-page Terms of Service and Privacy Policy viewer.
 *
 * Props:
 *   page — 'terms' | 'privacy'
 *   lang — 'en' | 'es'
 */

import { Box, Typography } from '@mui/material';

const MONO    = "'Share Tech Mono', 'JetBrains Mono', 'Courier New', monospace";
const DISPLAY = "'Orbitron', 'Share Tech Mono', monospace";
const BARLOW  = "'Barlow Condensed', 'Barlow', sans-serif";

const C = {
  bg:          '#000000',
  surface:     '#07090E',
  cyan:        '#00D9FF',
  cyanLine:    'rgba(0, 217, 255, 0.2)',
  cyanDim:     'rgba(0, 217, 255, 0.06)',
  textPrimary: '#E8F4FF',
  textMuted:   'rgba(0, 217, 255, 0.55)',
  textDim:     'rgba(0, 217, 255, 0.35)',
  accent:      '#FF6600',
  border:      'rgba(0, 217, 255, 0.15)',
};

// ── Content definitions ───────────────────────────────────────────────────────

const TERMS = {
  en: {
    title: 'Terms of Service',
    updated: 'Last updated: April 2026',
    sections: [
      {
        heading: '1. Service Description',
        body: 'H.E.X.A. V4 is an MLB analytics tool developed by Gambitho Labs. It provides statistical analysis and AI-assisted insights for informational purposes only. H.E.X.A. does not constitute betting advice and does not guarantee any outcomes.',
      },
      {
        heading: '2. Eligibility',
        body: 'You must be at least 18 years of age (or the minimum legal age in your jurisdiction, whichever is higher) to use this service. By accessing H.E.X.A., you confirm that you meet this age requirement. We reserve the right to terminate accounts found to be in violation.',
      },
      {
        heading: '3. Credits and Payments',
        body: 'Credits are purchased through Buy Me a Coffee and are non-refundable except in cases where an analysis fails (automatic credit refund is applied). Credits do not expire. Gambitho Labs is not liable for payment processor issues.',
      },
      {
        heading: '4. No Guarantee of Results',
        body: 'All analysis is based on statistical models and artificial intelligence. Past performance does not predict future results. H.E.X.A. and Gambitho Labs are not responsible for any financial losses incurred from decisions made using this service.',
      },
      {
        heading: '5. Responsible Gambling',
        body: 'We encourage all users to set personal betting limits and gamble responsibly. If you or someone you know has a gambling problem, please seek help. In the US: National Council on Problem Gambling — 1-800-522-4700 (ncpgambling.org). In Peru: contact the Ministry of Foreign Trade and Tourism or equivalent authority.',
      },
      {
        heading: '6. Data and Privacy',
        body: 'We collect your email address and usage data to provide and improve the service. We do not sell your personal data to third parties. For full details, see our Privacy Policy.',
      },
      {
        heading: '7. Changes to Terms',
        body: 'We may update these Terms of Service at any time. Continued use of H.E.X.A. after changes are posted constitutes acceptance of the revised terms. We will make reasonable efforts to notify users of significant changes.',
      },
      {
        heading: '8. Contact',
        body: 'For questions or concerns about these terms, contact us at: gambitholabs@gmail.com',
      },
    ],
  },
  es: {
    title: 'Términos de Servicio',
    updated: 'Última actualización: Abril 2026',
    sections: [
      {
        heading: '1. Descripción del Servicio',
        body: 'H.E.X.A. V4 es una herramienta de análisis de MLB desarrollada por Gambitho Labs. Proporciona análisis estadístico e información asistida por IA únicamente con fines informativos. H.E.X.A. no constituye asesoramiento de apuestas ni garantiza resultados.',
      },
      {
        heading: '2. Elegibilidad',
        body: 'Debes tener al menos 18 años de edad (o la edad legal mínima en tu jurisdicción, la que sea mayor) para usar este servicio. Al acceder a H.E.X.A., confirmas que cumples con este requisito de edad. Nos reservamos el derecho de cancelar cuentas que incumplan esta condición.',
      },
      {
        heading: '3. Créditos y Pagos',
        body: 'Los créditos se adquieren a través de Buy Me a Coffee y no son reembolsables, excepto en casos donde un análisis falla (se aplica reembolso automático de crédito). Los créditos no vencen. Gambitho Labs no es responsable de problemas con el procesador de pagos.',
      },
      {
        heading: '4. Sin Garantía de Resultados',
        body: 'Todo análisis se basa en modelos estadísticos e inteligencia artificial. El rendimiento pasado no predice resultados futuros. H.E.X.A. y Gambitho Labs no son responsables de pérdidas financieras derivadas de decisiones tomadas usando este servicio.',
      },
      {
        heading: '5. Juego Responsable',
        body: 'Alentamos a todos los usuarios a establecer límites personales de apuestas y jugar de manera responsable. Si tú o alguien que conoces tiene un problema con el juego, busca ayuda. En Perú: contacta al Ministerio de Comercio Exterior y Turismo o la autoridad equivalente. En EE.UU.: National Council on Problem Gambling — 1-800-522-4700.',
      },
      {
        heading: '6. Datos y Privacidad',
        body: 'Recopilamos tu dirección de correo electrónico y datos de uso para proporcionar y mejorar el servicio. No vendemos tus datos personales a terceros. Para más detalles, consulta nuestra Política de Privacidad.',
      },
      {
        heading: '7. Cambios en los Términos',
        body: 'Podemos actualizar estos Términos de Servicio en cualquier momento. El uso continuado de H.E.X.A. después de que se publiquen cambios constituye la aceptación de los términos revisados.',
      },
      {
        heading: '8. Contacto',
        body: 'Para preguntas o inquietudes sobre estos términos, contáctanos en: gambitholabs@gmail.com',
      },
    ],
  },
};

const PRIVACY = {
  en: {
    title: 'Privacy Policy',
    updated: 'Last updated: April 2026',
    sections: [
      {
        heading: '1. Data We Collect',
        body: 'We collect: (a) email address and hashed password when you register; (b) analysis history associated with your account; (c) bankroll data if you use the BankrollTracker feature; (d) usage metadata such as timestamps and credit transactions.',
      },
      {
        heading: '2. How We Use Your Data',
        body: 'Your data is used to: provide and operate the H.E.X.A. service; improve analysis quality and model accuracy; process payments via Buy Me a Coffee; send transactional emails (e.g., email verification). We do not use your data for advertising.',
      },
      {
        heading: '3. Third-Party Services',
        body: 'We share data with the following trusted third parties only as necessary to operate the service: Anthropic (AI analysis processing); Buy Me a Coffee (payment processing); MLB Stats API (public baseball data — no personal data shared). We do not sell your personal data.',
      },
      {
        heading: '4. Data Retention',
        body: 'Your account data is retained for as long as your account is active. To request deletion of your data, email us at gambitholabs@gmail.com. We will process deletion requests within 30 days.',
      },
      {
        heading: '5. Cookies and Storage',
        body: 'We use localStorage to store session tokens for authentication. We do not use tracking cookies or third-party advertising cookies. No cross-site tracking is performed.',
      },
      {
        heading: '6. GDPR (EU Users)',
        body: 'If you are located in the European Union, you have the right to access, correct, or delete your personal data. You may also request a portable export of your data. To exercise these rights, contact gambitholabs@gmail.com.',
      },
      {
        heading: '7. Peru — Ley 29733',
        body: 'Cumplimos con la Ley N° 29733 de Protección de Datos Personales del Perú y su reglamento. Sus datos personales son tratados con las medidas de seguridad adecuadas y no son transferidos a terceros sin su consentimiento, salvo las excepciones legales aplicables.',
      },
      {
        heading: '8. Contact',
        body: 'For privacy-related questions or data requests, contact us at: gambitholabs@gmail.com',
      },
    ],
  },
  es: {
    title: 'Política de Privacidad',
    updated: 'Última actualización: Abril 2026',
    sections: [
      {
        heading: '1. Datos que Recopilamos',
        body: 'Recopilamos: (a) dirección de correo electrónico y contraseña encriptada al registrarte; (b) historial de análisis asociado a tu cuenta; (c) datos de bankroll si usas la función BankrollTracker; (d) metadatos de uso como marcas de tiempo y transacciones de créditos.',
      },
      {
        heading: '2. Cómo Usamos tus Datos',
        body: 'Tus datos se usan para: proveer y operar el servicio H.E.X.A.; mejorar la calidad del análisis y la precisión del modelo; procesar pagos a través de Buy Me a Coffee; enviar correos transaccionales (p.ej., verificación de email). No usamos tus datos para publicidad.',
      },
      {
        heading: '3. Servicios de Terceros',
        body: 'Compartimos datos con los siguientes terceros de confianza solo en la medida necesaria para operar el servicio: Anthropic (procesamiento de análisis IA); Buy Me a Coffee (procesamiento de pagos); MLB Stats API (datos públicos de béisbol — no se comparten datos personales). No vendemos tus datos personales.',
      },
      {
        heading: '4. Retención de Datos',
        body: 'Tus datos de cuenta se conservan mientras tu cuenta esté activa. Para solicitar la eliminación de tus datos, envíanos un correo a gambitholabs@gmail.com. Procesaremos las solicitudes de eliminación en un plazo de 30 días.',
      },
      {
        heading: '5. Cookies y Almacenamiento',
        body: 'Usamos localStorage para almacenar tokens de sesión para autenticación. No utilizamos cookies de seguimiento ni cookies de publicidad de terceros. No se realiza seguimiento entre sitios.',
      },
      {
        heading: '6. RGPD (Usuarios de la UE)',
        body: 'Si te encuentras en la Unión Europea, tienes derecho a acceder, corregir o eliminar tus datos personales. También puedes solicitar una exportación portátil de tus datos. Para ejercer estos derechos, contacta a gambitholabs@gmail.com.',
      },
      {
        heading: '7. Perú — Ley 29733',
        body: 'Cumplimos con la Ley N° 29733 de Protección de Datos Personales del Perú y su reglamento. Sus datos personales son tratados con las medidas de seguridad adecuadas y no son transferidos a terceros sin su consentimiento, salvo las excepciones legales aplicables.',
      },
      {
        heading: '8. Contacto',
        body: 'Para preguntas relacionadas con privacidad o solicitudes de datos, contáctanos en: gambitholabs@gmail.com',
      },
    ],
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function LegalPage({ page = 'terms', lang = 'en' }) {
  const content = page === 'privacy'
    ? (PRIVACY[lang] ?? PRIVACY.en)
    : (TERMS[lang] ?? TERMS.en);

  function handleBack() {
    window.history.back();
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.bg, color: C.textPrimary, fontFamily: MONO }}>
      {/* Header bar */}
      <Box sx={{
        borderBottom: `1px solid ${C.cyanLine}`,
        px: { xs: 3, sm: 6 },
        py: '14px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        position: 'sticky',
        top: 0,
        bgcolor: C.bg,
        zIndex: 10,
      }}>
        {/* Back button */}
        <Box
          component="button"
          onClick={handleBack}
          sx={{
            border: `1px solid ${C.cyanLine}`,
            bgcolor: 'transparent',
            color: C.textMuted,
            fontFamily: MONO,
            fontSize: '0.7rem',
            letterSpacing: '0.1em',
            px: '12px',
            py: '6px',
            cursor: 'pointer',
            transition: 'all 0.15s',
            '&:hover': { color: C.cyan, borderColor: C.cyan },
          }}
        >
          ← Back
        </Box>

        {/* Title */}
        <Typography sx={{
          fontFamily: DISPLAY,
          fontSize: { xs: '0.75rem', sm: '0.9rem' },
          letterSpacing: '0.2em',
          color: C.cyan,
          textTransform: 'uppercase',
          textShadow: '0 0 10px rgba(0,217,255,0.3)',
        }}>
          H.E.X.A. V4 // {content.title}
        </Typography>
      </Box>

      {/* Content */}
      <Box sx={{
        maxWidth: '780px',
        mx: 'auto',
        px: { xs: 3, sm: 6 },
        py: { xs: 4, sm: 6 },
      }}>
        {/* Page title */}
        <Typography sx={{
          fontFamily: DISPLAY,
          fontSize: { xs: '1.4rem', sm: '1.8rem' },
          fontWeight: 700,
          color: C.cyan,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          textShadow: '0 0 20px rgba(0,217,255,0.25)',
          mb: '8px',
        }}>
          {content.title}
        </Typography>

        <Typography sx={{
          fontFamily: MONO,
          fontSize: '0.65rem',
          color: C.textDim,
          letterSpacing: '0.08em',
          mb: '40px',
        }}>
          {content.updated}
        </Typography>

        {/* Divider */}
        <Box sx={{ height: '1px', bgcolor: C.cyanLine, mb: '40px' }} />

        {/* Sections */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '36px' }}>
          {content.sections.map((section, i) => (
            <Box key={i}>
              <Typography sx={{
                fontFamily: BARLOW,
                fontSize: '0.85rem',
                fontWeight: 700,
                color: C.cyan,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                mb: '10px',
              }}>
                {section.heading}
              </Typography>
              <Typography sx={{
                fontFamily: MONO,
                fontSize: '0.78rem',
                color: C.textPrimary,
                lineHeight: 1.8,
                letterSpacing: '0.03em',
              }}>
                {section.body}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Footer */}
        <Box sx={{
          mt: '60px',
          pt: '24px',
          borderTop: `1px solid ${C.cyanLine}`,
          display: 'flex',
          gap: '24px',
          flexWrap: 'wrap',
        }}>
          <Box
            component="a"
            href={page === 'terms' ? '/privacy' : '/terms'}
            sx={{
              fontFamily: MONO,
              fontSize: '0.65rem',
              color: C.textMuted,
              textDecoration: 'none',
              letterSpacing: '0.06em',
              '&:hover': { color: C.cyan },
            }}
          >
            {page === 'terms'
              ? (lang === 'es' ? '→ Política de Privacidad' : '→ Privacy Policy')
              : (lang === 'es' ? '→ Términos de Servicio' : '→ Terms of Service')}
          </Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textDim, letterSpacing: '0.06em' }}>
            © 2026 Gambitho Labs
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
