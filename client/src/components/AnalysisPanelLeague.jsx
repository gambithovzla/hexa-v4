/**
 * AnalysisPanelLeague — League × Kinetic brand wrapper around <AnalysisPanel>.
 *
 * Same "ejecutar análisis Oracle" logic, brand chrome on the outside.
 * Brand-specific styling of the internal segmented buttons / toggles
 * is handled by the [data-brand="league-kinetic"] CSS layer.
 */

import { Box, Typography } from '@mui/material';
import AnalysisPanel from './AnalysisPanel';

const T = {
  en: { title: 'Configure Analysis', pin: '⊕ Configure Analysis' },
  es: { title: 'Configurar análisis', pin: '⊕ Configurar Análisis' },
};

export default function AnalysisPanelLeague(props) {
  const t = T[props.lang] ?? T.es;
  return (
    <Box
      sx={{
        background:    'var(--brand-navy)',
        border:        '1px solid var(--brand-rule-strong)',
        position:      'relative',
        padding:       { xs: '20px 16px 16px', md: '28px 24px 16px' },
      }}
    >
      <Box className="brand-pin bronze">{t.pin}</Box>
      <Typography sx={{
        fontFamily: "'Oswald', sans-serif", fontWeight: 700,
        fontSize: '24px', letterSpacing: '.02em', mt: '14px', mb: '14px',
        color: 'var(--brand-cream)', textTransform: 'uppercase',
      }}>
        {t.title}
      </Typography>
      <AnalysisPanel {...props} />
    </Box>
  );
}
