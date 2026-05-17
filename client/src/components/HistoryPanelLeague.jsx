/**
 * HistoryPanelLeague — League × Kinetic brand wrapper around <HistoryPanel>.
 *
 * Adds the broadcast-style section head ("Resultados. Sin maquillaje.")
 * and a status bar footer. Internal tabs + table render unchanged; the
 * League palette already drives all their colors through useHexaTheme().
 */

import { Box, Typography } from '@mui/material';
import HistoryPanel from './HistoryPanel';

const T = {
  en: {
    eyebrow:  '⊕ Track Record · Ledger',
    title1:   'Results.',
    title2:   'No make-up.',
    sub:      '30-day window · Deep+ signals · Audited Hexa Oracle Ledger',
    footer:   'Ledger · Hexa Oracle · Public',
  },
  es: {
    eyebrow:  '⊕ Track Record · Ledger',
    title1:   'Resultados.',
    title2:   'Sin maquillaje.',
    sub:      'Ventana 30 días · Señales Deep+ · Auditado por Hexa Oracle Ledger',
    footer:   'Ledger · Hexa Oracle · Público',
  },
};

export default function HistoryPanelLeague({ lang = 'es', sport = 'all' }) {
  const t = T[lang] ?? T.es;
  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', width: '100%' }}>
      {/* Broadcast section head */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' },
        gap: '24px',
        alignItems: 'end',
        mb: '20px',
        pb: '20px',
        borderBottom: '1px solid var(--brand-rule)',
      }}>
        <Box>
          <Box sx={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: '12px',
            letterSpacing: '.32em', color: 'var(--brand-bronze)',
            textTransform: 'uppercase', mb: '12px',
          }}>
            {t.eyebrow}
          </Box>
          <Typography sx={{
            fontFamily: "'Oswald', sans-serif", fontWeight: 700,
            fontSize: { xs: '40px', md: '56px' }, lineHeight: 0.95,
            color: 'var(--brand-cream)', letterSpacing: '-0.01em',
            textTransform: 'uppercase',
          }}>
            {t.title1}<br />
            <Box component="em" sx={{
              fontStyle: 'italic', color: 'var(--brand-volt)',
              display: 'inline-block', transform: 'skewX(-3deg)',
            }}>
              {t.title2}
            </Box>
          </Typography>
        </Box>
        <Box sx={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: '11px',
          letterSpacing: '.22em', color: 'var(--text-muted)',
          textTransform: 'uppercase', textAlign: { xs: 'left', md: 'right' },
          lineHeight: 1.8,
        }}>
          {t.sub}
        </Box>
      </Box>

      {/* Brand-framed history container */}
      <Box
        className="hexa-themed-page league-history-panel"
        sx={{
          background:    'var(--brand-navy)',
          border:        '1px solid var(--brand-rule-strong)',
          borderTop:     '4px solid var(--brand-bronze)',
          overflow:      'hidden',
        }}
      >
        <HistoryPanel lang={lang} sport={sport} embedded />
      </Box>

      <Box className="brand-statusbar">
        <span><b>◉</b> {t.footer}</span>
        <span className="end">HEXAORACLE.LAT · MMXXVI</span>
      </Box>
    </Box>
  );
}
