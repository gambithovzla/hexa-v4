/**
 * GameSelectorLeague — League × Kinetic brand wrapper around <GameSelector>.
 *
 * The internal selector logic (fetching games, single/parlay modes, date
 * picker) is identical — we only re-skin the chrome. Brand visuals come
 * from the leagueKineticOverrides.css layer that targets MUI controls
 * under [data-brand="league-kinetic"] and from the lab-card frame here.
 */

import { Box, Typography } from '@mui/material';
import GameSelector from './GameSelector';

const T = {
  en: { title: 'Select Game', pin: '⊕ Select Game' },
  es: { title: 'Seleccionar juego', pin: '⊕ Seleccionar Juego' },
};

export default function GameSelectorLeague(props) {
  const t = T[props.language] ?? T.es;
  return (
    <Box
      sx={{
        background:    'var(--brand-navy)',
        border:        '1px solid var(--brand-rule-strong)',
        position:      'relative',
        padding:       { xs: '20px 16px 16px', md: '28px 24px 16px' },
      }}
    >
      <Box className="brand-pin">{t.pin}</Box>
      <Typography sx={{
        fontFamily: "'Oswald', sans-serif", fontWeight: 700,
        fontSize: '24px', letterSpacing: '.02em', mt: '14px', mb: '14px',
        color: 'var(--brand-cream)', textTransform: 'uppercase',
      }}>
        {t.title}
      </Typography>
      <GameSelector {...props} />
    </Box>
  );
}
