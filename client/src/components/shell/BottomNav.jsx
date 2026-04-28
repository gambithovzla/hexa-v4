/**
 * BottomNav — mobile-only 5-tab nav with hexagonal central FAB.
 *
 * Layout:
 *   [ Board ] [ Live ] [ FAB ] [ History ] [ Account ]
 *
 * The FAB triggers Oracle Chat for admins, or jumps to "Picks of the week"
 * (semana tab) for everyone else — that's the most engagement-heavy place
 * for non-admin users.
 *
 * Uses safe-area-inset-bottom so it doesn't sit under the iOS home bar.
 *
 * Props mirror Shell — only used when isMobile.
 */

import { Box } from '@mui/material';
import { useHexaTheme } from '../../themeProvider';
import { MONO } from '../../theme';

const Icon = ({ d, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const ICONS = {
  board:   <Icon d="M3 3h18v18H3z M3 9h18 M9 21V9" />,
  live:    <Icon d="M3 12h4 M17 12h4 M12 3v4 M12 17v4 M5 5l3 3 M16 16l3 3 M5 19l3-3 M16 8l3-3" />,
  oracle:  <Icon d="M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5" size={28} />,
  game:    <Icon d="M12 2l9 5v10l-9 5-9-5V7z M12 8v4 M12 16h.01" size={28} />,
  history: <Icon d="M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2" />,
  account: <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
};

function L(en, es, lang) { return lang === 'es' ? es : en; }

function NavBtn({ icon, label, active, onClick, C }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        flex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '2px',
        py: '8px',
        bgcolor: 'transparent',
        border: 'none',
        color: active ? C.cyan : C.ink2,
        cursor: 'pointer',
        minHeight: 56,
        position: 'relative',
        transition: 'color 0.18s',
        '&:hover': { color: active ? C.cyan : C.ink0 },
      }}
    >
      {active && (
        <Box sx={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 28, height: 2, bgcolor: C.cyan,
          boxShadow: C.glowsEnabled ? `0 0 8px ${C.cyan}` : 'none',
        }} />
      )}
      {icon}
      <Box component="span" sx={{
        fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.12em',
        textTransform: 'uppercase', fontWeight: active ? 700 : 500,
      }}>
        {label}
      </Box>
    </Box>
  );
}

export default function BottomNav({
  lang = 'es',
  activeTab,
  onTabChange,
  isAdmin = false,
  onOracleChat,
}) {
  const { C } = useHexaTheme();

  const fabIsOracle = isAdmin && Boolean(onOracleChat);
  const fabAction = fabIsOracle ? onOracleChat : () => onTabChange?.('game');
  const fabLabel  = fabIsOracle
    ? L('Oracle', 'Oracle', lang)
    : L('Game', 'Juego', lang);
  const fabIcon = fabIsOracle ? ICONS.oracle : ICONS.game;

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 0, right: 0,
        bottom: 0,
        zIndex: 1000,
        display: { xs: 'flex', md: 'none' },
        alignItems: 'stretch',
        height: 'calc(64px + env(safe-area-inset-bottom))',
        pb:     'env(safe-area-inset-bottom)',
        bgcolor: 'rgba(10, 16, 21, 0.92)',
        backdropFilter: 'blur(16px)',
        borderTop: `1px solid ${C.line}`,
      }}
    >
      <NavBtn
        icon={ICONS.board}
        label={L('Board', 'Pizarra', lang)}
        active={activeTab === 'pizarra'}
        onClick={() => onTabChange?.('pizarra')}
        C={C}
      />
      <NavBtn
        icon={ICONS.live}
        label={L('Live', 'En vivo', lang)}
        active={activeTab === 'live'}
        onClick={() => onTabChange?.('live')}
        C={C}
      />

      {/* Central hex FAB */}
      <Box sx={{ width: 80, position: 'relative', display: 'flex', justifyContent: 'center' }}>
        <Box
          component="button"
          onClick={fabAction}
          aria-label={fabLabel}
          sx={{
            position: 'absolute',
            top: -22,
            width: 64, height: 64,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${C.cyan}, ${C.accent})`,
            color: '#0a0d14',
            border: 'none',
            cursor: 'pointer',
            clipPath: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)',
            boxShadow: C.glowsEnabled
              ? `0 0 24px ${C.cyan}, 0 8px 24px rgba(0,0,0,0.6)`
              : '0 4px 12px rgba(0,0,0,0.2)',
            transition: 'transform 0.18s',
            '&:active': { transform: 'scale(0.95)' },
          }}
        >
          {fabIcon}
        </Box>
        <Box component="span" sx={{
          position: 'absolute', bottom: 6,
          fontFamily: MONO, fontSize: '0.55rem', letterSpacing: '0.12em',
          textTransform: 'uppercase', fontWeight: 700, color: C.ink1,
        }}>
          {fabLabel}
        </Box>
      </Box>

      <NavBtn
        icon={ICONS.history}
        label={L('History', 'Historial', lang)}
        active={activeTab === 'history'}
        onClick={() => onTabChange?.('history')}
        C={C}
      />
      <NavBtn
        icon={ICONS.account}
        label={L('Bankroll', 'Bankroll', lang)}
        active={activeTab === 'bankroll'}
        onClick={() => onTabChange?.('bankroll')}
        C={C}
      />
    </Box>
  );
}
