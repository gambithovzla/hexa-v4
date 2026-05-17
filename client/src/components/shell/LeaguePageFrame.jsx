import { Box } from '@mui/material';
import { useHexaTheme } from '../../themeProvider';

export default function LeaguePageFrame({ children, className, sx = {} }) {
  const { C, isLeague } = useHexaTheme();
  return (
    <Box
      className={[isLeague ? 'hexa-themed-page league-page-frame' : 'hexa-themed-page', className].filter(Boolean).join(' ')}
      sx={{
        minHeight: '100vh',
        bgcolor: C.bg,
        color: C.textPrimary,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
