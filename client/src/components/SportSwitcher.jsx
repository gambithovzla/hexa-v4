import { Box } from '@mui/material';
import { MONO } from '../theme';
import { useHexaTheme } from '../themeProvider';
import { getActiveSportOptions } from '../config/sports';

export default function SportSwitcher({ sport = 'mlb', onChange, options }) {
  const { C, isLeague } = useHexaTheme();
  const renderedOptions = Array.isArray(options) && options.length > 0
    ? options
    : getActiveSportOptions();

  // League brand uses livery accent (lava for MLB, volt for NBA), driven by
  // var(--sport-accent) which the brand CSS layer flips on body[data-sport].
  // Each button must compute its own accent locally so the *inactive* side
  // also previews its livery on hover — not just the active one.
  const liveryFor = (s) =>
    isLeague
      ? (s === 'nba' ? 'var(--brand-volt)'
        : s === 'nfl' ? 'var(--brand-field, #2e7d32)'
        : s === 'nhl' ? 'var(--brand-ice, #29b6f6)'
        : s === 'tennis' ? 'var(--brand-clay, #d2691e)'
        : 'var(--brand-lava)')
      : C.cyan;
  const liveryText = (s) =>
    isLeague ? (s === 'nba' ? 'var(--brand-ink)' : '#fff') : '#0a0d14';

  return (
    <Box
      sx={{
        display:      'inline-flex',
        border:       `1px solid ${isLeague ? 'var(--brand-rule-strong, rgba(244,236,216,.3))' : C.line}`,
        borderRadius: isLeague ? 0 : '3px',
        overflow:     'hidden',
        background:   isLeague ? 'rgba(0,0,0,.4)' : 'transparent',
        padding:      isLeague ? '3px' : 0,
      }}
    >
      {renderedOptions.map(({ sport: s, shortLabel }, idx) => {
        const active = sport === s;
        const accent = liveryFor(s);
        return (
          <Box
            key={s}
            component="button"
            onClick={() => onChange?.(s)}
            sx={{
              px:            isLeague ? '18px' : '16px',
              py:            isLeague ? '6px'  : '5px',
              bgcolor:       active ? accent : 'transparent',
              color:         active ? liveryText(s) : C.ink2,
              border:        'none',
              fontFamily:    isLeague ? "'Oswald', sans-serif" : MONO,
              fontSize:      isLeague ? '0.78rem' : '0.65rem',
              fontWeight:    700,
              letterSpacing: isLeague ? '0.12em' : '0.14em',
              cursor:        'pointer',
              textTransform: 'uppercase',
              transition:    'background 0.15s, color 0.15s',
              clipPath:      isLeague
                ? (idx === 0
                    ? 'polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%)'
                    : 'polygon(10px 0, 100% 0, 100% 100%, 0 100%)')
                : 'none',
              '&:hover': active ? {} : { color: accent },
            }}
          >
            {shortLabel ?? s.toUpperCase()}
          </Box>
        );
      })}
    </Box>
  );
}
