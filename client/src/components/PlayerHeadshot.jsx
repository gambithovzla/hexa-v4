/**
 * PlayerHeadshot — circular MLB player headshot with scanline overlay.
 *
 * Uses MLB's public headshot CDN. Falls back to monospaced initials inside
 * a neon ring if the image fails to load or playerId is missing.
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { C, MONO } from '../theme';

function initials(name) {
  if (!name) return '—';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
}

export default function PlayerHeadshot({ playerId, name, size = 40, color = C.cyan }) {
  const [failed, setFailed] = useState(false);
  const spot = Math.max(60, Math.round(size * 2));
  const src = playerId
    ? `https://midfield.mlbstatic.com/v1/people/${playerId}/spots/${spot}`
    : null;
  const showFallback = !src || failed;

  const ringStyles = {
    width:        size,
    height:       size,
    borderRadius: '50%',
    border:       `1px solid ${color}`,
    bgcolor:      C.surfaceAlt,
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    flexShrink:   0,
    overflow:     'hidden',
    position:     'relative',
    boxShadow:    `0 0 6px ${color}55, inset 0 0 4px ${color}22`,
  };

  if (showFallback) {
    return (
      <Box sx={ringStyles}>
        <Typography sx={{
          fontFamily:    MONO,
          fontSize:      size * 0.36,
          color,
          letterSpacing: '0.04em',
          lineHeight:    1,
        }}>
          {initials(name)}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={ringStyles}>
      <Box
        component="img"
        src={src}
        alt={name || 'player headshot'}
        loading="lazy"
        onError={() => setFailed(true)}
        sx={{
          width:     '100%',
          height:    '100%',
          objectFit: 'cover',
          display:   'block',
          filter:    'saturate(0.9) contrast(1.05)',
        }}
      />
      {/* Subtle scanlines for terminal/oracle look */}
      <Box
        aria-hidden="true"
        sx={{
          position:   'absolute',
          inset:      0,
          pointerEvents: 'none',
          background: `repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 2px,
            ${color}18 2px,
            ${color}18 3px
          )`,
          mixBlendMode: 'overlay',
        }}
      />
      {/* Inner neon glow */}
      <Box
        aria-hidden="true"
        sx={{
          position:   'absolute',
          inset:      0,
          borderRadius: '50%',
          boxShadow:  `inset 0 0 8px ${color}44`,
          pointerEvents: 'none',
        }}
      />
    </Box>
  );
}
