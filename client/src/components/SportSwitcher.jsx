import { Box } from '@mui/material';
import { MONO } from '../theme';
import { useHexaTheme } from '../themeProvider';
import { getActiveSportOptions } from '../config/sports';

export default function SportSwitcher({ sport = 'mlb', onChange, options }) {
  const { C } = useHexaTheme();
  const renderedOptions = Array.isArray(options) && options.length > 0
    ? options
    : getActiveSportOptions();

  return (
    <Box
      sx={{
        display:      'inline-flex',
        border:       `1px solid ${C.line}`,
        borderRadius: '3px',
        overflow:     'hidden',
      }}
    >
      {renderedOptions.map(({ sport: s, shortLabel }) => (
        <Box
          key={s}
          component="button"
          onClick={() => onChange?.(s)}
          sx={{
            px:            '16px',
            py:            '5px',
            bgcolor:       sport === s ? C.cyan : 'transparent',
            color:         sport === s ? '#0a0d14' : C.ink2,
            border:        'none',
            fontFamily:    MONO,
            fontSize:      '0.65rem',
            fontWeight:    700,
            letterSpacing: '0.14em',
            cursor:        'pointer',
            textTransform: 'uppercase',
            transition:    'background 0.15s, color 0.15s',
            '&:hover':     sport !== s ? { color: C.cyan } : {},
          }}
        >
          {shortLabel ?? s.toUpperCase()}
        </Box>
      ))}
    </Box>
  );
}
