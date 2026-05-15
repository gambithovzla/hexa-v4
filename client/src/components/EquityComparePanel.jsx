import { Box, Typography } from '@mui/material';
import { C, MONO } from '../theme';

function signedPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function signedPp(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}pp`;
}

export default function EquityComparePanel({
  comparison,
  loading = false,
  lang = 'es',
  periodLabel = '90D',
  accent = C.accent,
  variant = 'inline',
}) {
  const title = lang === 'es'
    ? `// TÚ_vs_HEXA (${periodLabel})`
    : `// YOU_vs_HEXA (${periodLabel})`;
  const sampleLabel = lang === 'es' ? 'MUESTRA' : 'SAMPLE';

  if (loading) {
    return (
      <Box sx={{
        border: `1px solid ${C.cyanLine}`,
        background: C.surface,
        p: variant === 'compact' ? '12px 14px' : '16px 18px',
        mb: 2,
      }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: C.textMuted, letterSpacing: '2px' }}>
          {lang === 'es' ? 'Cargando comparativa…' : 'Loading comparison…'}
        </Typography>
      </Box>
    );
  }

  if (!comparison) return null;

  const rows = [
    {
      label: 'YOUR_ROI_U',
      value: signedPct(comparison.your_strategy?.roi_units),
      color: (comparison.your_strategy?.roi_units ?? 0) >= 0 ? C.green : C.red,
    },
    {
      label: 'HEXA_ROI_U',
      value: signedPct(comparison.hexa_baseline?.roi_units),
      color: (comparison.hexa_baseline?.roi_units ?? 0) >= 0 ? C.green : C.red,
    },
    {
      label: 'DELTA_ROI_U',
      value: signedPct(comparison.delta?.roi_units),
      color: (comparison.delta?.roi_units ?? 0) >= 0 ? C.green : C.red,
    },
    {
      label: 'DELTA_WINRATE',
      value: signedPp(comparison.delta?.win_rate),
      color: (comparison.delta?.win_rate ?? 0) >= 0 ? C.green : C.red,
    },
  ];

  return (
    <Box sx={{
      position: 'relative',
      border: `1px solid ${accent === C.accent ? C.accentLine : C.cyanLine}`,
      background: C.surface,
      p: variant === 'compact' ? '12px 14px' : '16px 18px',
      mb: 2,
      overflow: 'hidden',
    }}>
      <Box sx={{
        position: 'absolute', top: 0, left: 0, width: 10, height: 10,
        borderTop: `1px solid ${accent}`, borderLeft: `1px solid ${accent}`,
      }} />
      <Typography sx={{
        fontFamily: MONO, fontSize: '8px', color: C.textMuted,
        letterSpacing: '3px', textTransform: 'uppercase', mb: 1.5,
      }}>
        {title}
      </Typography>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: 1,
      }}>
        {rows.map((row) => (
          <Box key={row.label} sx={{ border: `1px solid ${C.borderLight}`, px: '10px', py: '8px' }}>
            <Typography sx={{
              fontFamily: MONO, fontSize: '8px', color: C.textMuted,
              letterSpacing: '1.5px', mb: 0.5,
            }}>
              {row.label}
            </Typography>
            <Typography sx={{ fontFamily: MONO, fontSize: '14px', color: row.color, fontWeight: 700 }}>
              {row.value}
            </Typography>
          </Box>
        ))}
      </Box>
      <Typography sx={{
        fontFamily: MONO, fontSize: '8px', color: C.textMuted,
        letterSpacing: '1px', mt: 1,
      }}>
        {sampleLabel}: YOUR={comparison.your_strategy?.sample_size ?? 0} · HEXA={comparison.hexa_baseline?.sample_size ?? 0}
      </Typography>
    </Box>
  );
}
