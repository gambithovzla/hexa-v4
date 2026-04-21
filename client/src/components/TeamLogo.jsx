/**
 * TeamLogo — circular MLB team logo with neon-tinted border.
 *
 * Uses MLB's public static logo CDN. Falls back to monospaced abbreviation
 * inside a neon ring if the image fails to load or teamId is missing.
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO } from '../theme';

export default function TeamLogo({
  teamId,
  abbr,
  size = 36,
  color = C.cyan,
  glow = true,
  variant = 'ring',
}) {
  const [failed, setFailed] = useState(false);
  const src = teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : null;
  const showFallback = !src || failed;
  const isPlain = variant === 'plain';

  const ringStyles = {
    width:        size,
    height:       size,
    borderRadius: isPlain ? 0 : '50%',
    border:       isPlain ? 'none' : `1px solid ${color}`,
    bgcolor:      isPlain ? 'transparent' : C.surfaceAlt,
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    flexShrink:   0,
    boxShadow:    isPlain ? 'none' : glow ? `0 0 6px ${color}55, inset 0 0 4px ${color}22` : 'none',
    overflow:     'hidden',
    position:     'relative',
  };

  if (showFallback) {
    return (
      <Box sx={ringStyles}>
        <Typography sx={{
          fontFamily:    MONO,
          fontSize:      size * 0.32,
          fontWeight:    600,
          color: isPlain ? C.textPrimary : color,
          letterSpacing: '0.04em',
          lineHeight:    1,
        }}>
          {abbr || '—'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={ringStyles}>
      <Box
        component="img"
        src={src}
        alt={abbr || 'team logo'}
        loading="lazy"
        onError={() => setFailed(true)}
        sx={{
          width:     isPlain ? '100%' : '78%',
          height:    isPlain ? '100%' : '78%',
          objectFit: 'contain',
          filter:    isPlain ? 'none' : `drop-shadow(0 0 3px ${color}66)`,
        }}
      />
    </Box>
  );
}
