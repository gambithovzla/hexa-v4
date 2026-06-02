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
        : s === 'soccer' ? 'var(--brand-grass, #388e3c)'
        : s === 'tennis' ? 'var(--brand-clay, #d2691e)'
        : 'var(--brand-lava)')
      : C.cyan;
  const liveryText = (s) =>
    isLeague ? (s === 'nba' ? 'var(--brand-ink)' : '#fff') : '#0a0d14';
  // Clip polygon shifts for League brand diagonal cuts; tighter at 5+ buttons
  const clipFor = (idx, total) => {
    if (!isLeague) return 'none';
    if (total <= 4) return idx === 0
      ? 'polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%)'
      : 'polygon(10px 0, 100% 0, 100% 100%, 0 100%)';
    return idx === 0
      ? 'polygon(0 0, 100% 0, calc(100% - 6px) 100%, 0 100%)'
      : 'polygon(6px 0, 100% 0, 100% 100%, 0 100%)';
  };

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
              px:            isLeague ? (renderedOptions.length > 5 ? '9px' : renderedOptions.length > 4 ? '12px' : '18px') : (renderedOptions.length > 5 ? '12px' : '16px'),
              py:            isLeague ? '6px'  : '5px',
              bgcolor:       active ? accent : 'transparent',
              color:         active ? liveryText(s) : C.ink2,
              border:        'none',
              fontFamily:    isLeague ? "'Oswald', sans-serif" : MONO,
              fontSize:      isLeague ? (renderedOptions.length > 5 ? '0.62rem' : renderedOptions.length > 4 ? '0.68rem' : '0.78rem') : (renderedOptions.length > 5 ? '0.60rem' : '0.65rem'),
              fontWeight:    700,
              letterSpacing: isLeague ? '0.10em' : '0.14em',
              cursor:        'pointer',
              textTransform: 'uppercase',
              transition:    'background 0.15s, color 0.15s',
              clipPath:      clipFor(idx, renderedOptions.length),
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
