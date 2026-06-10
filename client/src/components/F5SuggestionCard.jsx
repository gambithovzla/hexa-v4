import { Box, Typography } from '@mui/material';
import { MONO, BARLOW } from '../theme';
import { useHexaTheme } from '../themeProvider';

function formatAmerican(odds) {
  if (odds == null || !Number.isFinite(Number(odds))) return null;
  const n = Number(odds);
  return n > 0 ? `+${n}` : `${n}`;
}

export default function F5SuggestionCard({ suggestion, lang = 'es' }) {
  const { C, isLeague } = useHexaTheme();
  if (!suggestion?.suggested) return null;

  const isEs = lang === 'es';
  const pickedOdds = formatAmerican(suggestion.f5Line?.picked);

  return (
    <Box sx={{
      border: `1px solid ${C.amberLine ?? C.amber}`,
      bgcolor: C.amberDim ?? 'transparent',
      p: '12px 14px',
      mb: 2,
    }}>
      <Typography sx={{
        fontFamily: isLeague ? "'Oswald', sans-serif" : BARLOW,
        fontSize: '0.72rem',
        fontWeight: 700,
        color: C.amber,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        mb: '6px',
      }}>
        {isEs ? '⚡ Tesis de abridor — considerar F5' : '⚡ Starter thesis — consider F5'}
      </Typography>

      <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textPrimary, fontWeight: 700, mb: '8px' }}>
        {suggestion.suggestedPick}
        {pickedOdds ? ` (${pickedOdds})` : ''}
        {' — '}
        {isEs ? 'ganador primeros 5 innings' : 'first-5-innings winner'}
      </Typography>

      {Array.isArray(suggestion.reasons) && suggestion.reasons.map((reason, i) => (
        <Typography key={i} sx={{ fontFamily: MONO, fontSize: '0.62rem', color: C.textSecondary, lineHeight: 1.6 }}>
          · {reason}
        </Typography>
      ))}

      {suggestion.f5Line?.bookCount > 0 && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, mt: '6px' }}>
          {isEs
            ? `Línea F5 consenso de ${suggestion.f5Line.bookCount} book(s)`
            : `F5 line consensus from ${suggestion.f5Line.bookCount} book(s)`}
        </Typography>
      )}

      <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, mt: '8px', lineHeight: 1.5 }}>
        {suggestion.note}
      </Typography>
    </Box>
  );
}
