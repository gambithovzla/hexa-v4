import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { MONO, BARLOW } from '../theme';
import { useHexaTheme } from '../themeProvider';

function AgreeChip({ agree }) {
  const { C } = useHexaTheme();
  if (agree == null) {
    return (
      <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted }}>N/A</Typography>
    );
  }
  const color = agree ? (C.outcomeWin ?? C.green) : (C.outcomeLoss ?? C.red);
  return (
    <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color, fontWeight: 700, letterSpacing: '0.1em' }}>
      {agree ? 'AGREE' : 'DISAGREE'}
    </Typography>
  );
}

function SourceRow({ label, source, agree }) {
  const { C, isLeague } = useHexaTheme();
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '72px 1fr auto',
      gap: '8px',
      alignItems: 'center',
      py: '6px',
      borderBottom: `1px solid ${C.border}`,
    }}>
      <Typography sx={{
        fontFamily: isLeague ? "'Oswald', sans-serif" : MONO,
        fontSize: '0.62rem',
        color: C.textMuted,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
      }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: C.textPrimary, lineHeight: 1.4 }}>
        {source?.label ?? '—'}
      </Typography>
      <AgreeChip agree={agree} />
    </Box>
  );
}

export default function AdminMlOpinionCard({ mlOpinion, lang = 'es' }) {
  const { C, isLeague } = useHexaTheme();
  const [gameMlOpen, setGameMlOpen] = useState(false);

  if (!mlOpinion) return null;

  const isEs = lang === 'es';
  const pickLabel = mlOpinion.pickText
    ? `${mlOpinion.pickText}${mlOpinion.market_type ? ` · ${mlOpinion.market_type}` : ''}`
    : '—';

  return (
    <Box sx={{
      border: `1px solid ${isLeague ? C.amberLine : C.cyanLine}`,
      bgcolor: isLeague ? C.amberDim : C.cyanDim,
      p: '12px 14px',
      mb: 2,
    }}>
      <Typography sx={{
        fontFamily: isLeague ? "'Oswald', sans-serif" : BARLOW,
        fontSize: '0.72rem',
        fontWeight: 700,
        color: isLeague ? C.amber : C.cyan,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        mb: '6px',
      }}>
        {isEs ? 'Opinión ML (admin)' : 'ML Opinion (admin)'}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: C.textSecondary, mb: '10px' }}>
        {pickLabel}
      </Typography>

      <SourceRow label="ORACLE" source={mlOpinion.oracle} agree={null} />
      <SourceRow label="LEGACY" source={mlOpinion.legacy} agree={mlOpinion.agree?.legacy} />
      <SourceRow label="PYTHON" source={mlOpinion.python} agree={mlOpinion.agree?.python} />

      {mlOpinion.gameMl && (
        <Box sx={{ mt: '8px' }}>
          <Box
            component="button"
            type="button"
            onClick={() => setGameMlOpen((v) => !v)}
            sx={{
              border: 'none',
              bgcolor: 'transparent',
              color: C.textMuted,
              fontFamily: MONO,
              fontSize: '0.58rem',
              cursor: 'pointer',
              p: 0,
              letterSpacing: '0.08em',
            }}
          >
            {gameMlOpen ? '▼' : '▶'} {isEs ? 'Referencia moneyline del partido' : 'Game moneyline reference'}
          </Box>
          {gameMlOpen && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: C.textMuted, mt: '6px', lineHeight: 1.6 }}>
              Oracle {mlOpinion.gameMl.oracle_home_win_prob != null ? `${(mlOpinion.gameMl.oracle_home_win_prob * 100).toFixed(0)}% home` : '—'}
              {' · '}
              Legacy {mlOpinion.gameMl.legacy_home_win_prob != null ? `${(mlOpinion.gameMl.legacy_home_win_prob * 100).toFixed(0)}%` : '—'}
              {' · '}
              Python {mlOpinion.gameMl.python_home_win_prob != null ? `${(mlOpinion.gameMl.python_home_win_prob * 100).toFixed(0)}%` : '—'}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
