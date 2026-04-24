import { Box, Typography } from '@mui/material';
import { C, MONO } from '../theme';

const RISK_KEYS = [
  'pitching_dominance',
  'bullpen_exposure',
  'weather_exposure',
  'lineup_variance',
  'umpire_sensitivity',
  'ballpark_bias',
];

const RISK_LABELS = {
  pitching_dominance: { en: 'Pitch', es: 'Pitch' },
  bullpen_exposure:   { en: 'BP',    es: 'BP'    },
  weather_exposure:   { en: 'Wthr',  es: 'Clima' },
  lineup_variance:    { en: 'Lineup',es: 'Lin.'  },
  umpire_sensitivity: { en: 'Ump',   es: 'Ump'   },
  ballpark_bias:      { en: 'Park',  es: 'Parque'},
};

const SCRIPT_COLOR = {
  pitchers_duel: C.cyan,
  slugfest:      C.accent,
  bullpen_fade:  C.amber,
  wind_out:      C.green,
  wind_in:       C.red,
  neutral:       C.textMuted,
};

function riskColor(val) {
  if (val >= 0.7) return C.red;
  if (val >= 0.4) return C.amber;
  return C.green;
}

function fmtOdds(odds) {
  if (odds == null) return '—';
  return odds > 0 ? `+${odds}` : String(odds);
}

export default function ParlayLegCard({ leg, lang = 'en', index }) {
  const rv = leg.riskVector ?? {};
  const scriptColor = SCRIPT_COLOR[leg.gameScript] ?? C.textMuted;

  return (
    <Box sx={{
      border: `1px solid ${C.border}`,
      bgcolor: C.surface,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Left accent stripe */}
      <Box sx={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: '3px',
        bgcolor: C.accent,
        boxShadow: `0 0 8px ${C.accent}88`,
      }} />

      <Box sx={{ pl: '14px', pr: '12px', pt: '10px', pb: '10px' }}>
        {/* Row 1: index + matchup + script */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', mb: '4px', flexWrap: 'wrap' }}>
          <Box sx={{
            bgcolor: C.accent,
            color: '#000',
            fontFamily: MONO,
            fontWeight: 700,
            fontSize: '0.58rem',
            px: '5px',
            py: '1px',
            lineHeight: 1.4,
            flexShrink: 0,
          }}>
            LEG {index}
          </Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.72rem', color: C.textSecondary, flex: 1 }}>
            {leg.matchup ?? ''}
          </Typography>
          {leg.gameScript && leg.gameScript !== 'neutral' && (
            <Box sx={{
              border: `1px solid ${scriptColor}40`,
              bgcolor: `${scriptColor}12`,
              px: '5px',
              py: '1px',
            }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.56rem', color: scriptColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {leg.gameScript.replace(/_/g, ' ')}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Row 2: pick */}
        <Typography sx={{ fontFamily: MONO, fontSize: '0.88rem', color: C.textPrimary, fontWeight: 700, mb: '6px', lineHeight: 1.3 }}>
          {leg.pick}
        </Typography>

        {/* Row 3: type + odds + edge + prob */}
        <Box sx={{ display: 'flex', gap: '16px', flexWrap: 'wrap', mb: '8px' }}>
          <Stat label="Type"  value={leg.type ?? '—'}                 color={C.textSecondary} />
          <Stat label="Odds"  value={fmtOdds(leg.odds)}               color={C.cyan}          />
          <Stat label="Edge"  value={leg.edge != null ? `${Number(leg.edge).toFixed(1)}%` : '—'} color={C.green} />
          <Stat label="Prob"  value={leg.modelProbability != null ? `${leg.modelProbability}%` : '—'} color={C.amber} />
        </Box>

        {/* Row 4: risk vector mini-bars */}
        {RISK_KEYS.some(k => rv[k] != null) && (
          <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {RISK_KEYS.map(k => {
              const val = rv[k] ?? 0;
              const label = RISK_LABELS[k]?.[lang] ?? k;
              const color = riskColor(val);
              return (
                <Box key={k} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', minWidth: '28px' }}>
                  <Box sx={{ width: '28px', height: '4px', bgcolor: C.borderLight, overflow: 'hidden', position: 'relative' }}>
                    <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(val * 100)}%`, bgcolor: color }} />
                  </Box>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: C.textMuted, textAlign: 'center' }}>
                    {label}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}

        {/* Row 5: reasoning snippet */}
        {leg.reasoning && (
          <Typography sx={{
            fontFamily: MONO,
            fontSize: '0.62rem',
            color: C.textMuted,
            mt: '8px',
            lineHeight: 1.5,
            borderTop: `1px solid ${C.borderLight}`,
            pt: '6px',
          }}>
            {leg.reasoning.slice(0, 160)}{leg.reasoning.length > 160 ? '…' : ''}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function Stat({ label, value, color }) {
  return (
    <Box>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.78rem', color: color ?? C.textPrimary, fontWeight: 600 }}>
        {value}
      </Typography>
    </Box>
  );
}
