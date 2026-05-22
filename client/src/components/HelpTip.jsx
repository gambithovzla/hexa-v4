import { useCallback, useMemo, useState } from 'react';
import { Box, ClickAwayListener, Tooltip, Typography } from '@mui/material';
import { MONO } from '../theme';

function useCanHover() {
  return useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }, []);
}

/**
 * Help (?) control that works on PWA / touch: tap toggles the tooltip.
 * On desktop with a fine pointer, hover still opens it.
 */
export default function HelpTip({ title, sx = {}, placement = 'top', maxWidth = 340 }) {
  const [open, setOpen] = useState(false);
  const canHover = useCanHover();

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen((prev) => !prev);
  }, []);

  if (!title) return null;

  return (
    <ClickAwayListener onClickAway={close}>
      <Box component="span" sx={{ display: 'inline-flex', verticalAlign: 'middle' }}>
        <Tooltip
          open={open}
          onClose={close}
          disableFocusListener
          disableHoverListener
          disableTouchListener
          title={(
            <Typography
              component="span"
              sx={{
                fontFamily: MONO,
                fontSize: '11px',
                lineHeight: 1.55,
                display: 'block',
                maxWidth,
                whiteSpace: 'pre-wrap',
              }}
            >
              {title}
            </Typography>
          )}
          arrow
          placement={placement}
          slotProps={{
            popper: {
              sx: { zIndex: 1400 },
            },
          }}
        >
          <Box
            component="button"
            type="button"
            aria-label="help"
            aria-expanded={open}
            onClick={toggle}
            onMouseEnter={canHover ? () => setOpen(true) : undefined}
            onMouseLeave={canHover ? close : undefined}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              ml: 0.5,
              p: 0,
              border: '1px solid var(--ink-2)',
              borderRadius: '50%',
              bgcolor: 'transparent',
              color: 'var(--ink-2)',
              fontFamily: MONO,
              fontSize: '9px',
              lineHeight: 1,
              cursor: 'pointer',
              flexShrink: 0,
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
              '&:hover': canHover ? { color: 'var(--neon-cyan)', borderColor: 'var(--neon-cyan)' } : {},
              '&:focus-visible': {
                outline: '1px solid var(--neon-cyan)',
                outlineOffset: 2,
              },
              ...sx,
            }}
          >
            ?
          </Box>
        </Tooltip>
      </Box>
    </ClickAwayListener>
  );
}
