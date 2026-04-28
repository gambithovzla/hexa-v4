/**
 * HexaCyberHero — cyberpunk hero with the official HEXA mascot.
 *
 * Layout (handoff "Avatar" variant):
 *   ┌─────────────────────────────────────────────────────┐
 *   │  [HUD panel] [HUD panel]   ← left stack             │
 *   │                  ╭─────╮                            │
 *   │                  │ 🦝  │   ← /hexa-mascot.png       │
 *   │                  ╰─────╯                            │
 *   │     scan line ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔                    │
 *   │  ▱▱▱▱ floor grid in perspective ▱▱▱▱                │
 *   │  [HUD panel] [HUD panel]   ← right stack            │
 *   └─────────────────────────────────────────────────────┘
 *
 * Props:
 *   eyebrow  — small all-caps label above the headline
 *   title    — main headline
 *   subtitle — supporting copy
 *   stats    — { label, value, tone? }[]   (4–6 items, distributed L/R)
 *   cta      — { label, onClick } | undefined
 *   mascot   — image URL (defaults to /hexa-mascot.png)
 *
 * Visuals are pure CSS + framer-motion. No 3D library, no canvas — fast on
 * mobile and degrades gracefully when glows are disabled (light mode).
 */

import { Box, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import { useHexaTheme } from '../../themeProvider';
import { MONO, DISPLAY } from '../../theme';

// ── HUD stat panel ──────────────────────────────────────────────────────────
function HudPanel({ label, value, tone, C }) {
  const color = tone === 'green' ? C.green
              : tone === 'pink'  ? C.pink
              : tone === 'orange'? C.accent
              : C.cyan;
  const lineColor = tone === 'green' ? C.greenLine
                  : tone === 'pink'  ? C.pinkLine
                  : tone === 'orange'? C.accentLine
                  : C.cyanLine;

  return (
    <Box
      sx={{
        position:     'relative',
        px:           '12px',
        py:           '10px',
        minWidth:     '108px',
        bgcolor:      `linear-gradient(180deg, ${C.bg2}, ${C.bg1})`,
        background:   `linear-gradient(180deg, ${C.bg2}, ${C.bg1})`,
        border:       `1px solid ${lineColor}`,
        borderLeft:   `2px solid ${color}`,
        borderRadius: '4px',
        boxShadow:    C.glowsEnabled ? `0 4px 16px rgba(0,0,0,0.4), inset 0 0 16px ${C.cyanDim}` : 'none',
      }}
    >
      <Typography sx={{
        fontFamily: MONO, fontSize: '0.52rem', letterSpacing: '0.18em',
        textTransform: 'uppercase', color: C.ink2, lineHeight: 1,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        fontFamily: DISPLAY, fontSize: '1.1rem', fontWeight: 700,
        color: color, lineHeight: 1.2, mt: '4px',
        textShadow: C.glowsEnabled ? `0 0 8px ${color}66` : 'none',
      }}>
        {value}
      </Typography>
      {/* Decorative bracket */}
      <Box sx={{
        position: 'absolute', top: 4, right: 4,
        width: 8, height: 8,
        borderTop: `1px solid ${color}`, borderRight: `1px solid ${color}`,
      }} />
    </Box>
  );
}

// ── Floor grid (perspective) ────────────────────────────────────────────────
function FloorGrid({ C }) {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: '60%',
        pointerEvents: 'none',
        perspective: '600px',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          bottom: 0, left: '-50%', right: '-50%',
          height: '200%',
          transform: 'rotateX(70deg)',
          transformOrigin: 'bottom',
          backgroundImage: `
            linear-gradient(${C.cyanLine} 1px, transparent 1px),
            linear-gradient(90deg, ${C.cyanLine} 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
          opacity: C.glowsEnabled ? 0.55 : 0.25,
          maskImage: 'linear-gradient(0deg, black 10%, transparent 80%)',
          WebkitMaskImage: 'linear-gradient(0deg, black 10%, transparent 80%)',
        }}
      />
    </Box>
  );
}

// ── Scan line ───────────────────────────────────────────────────────────────
function ScanLine({ C }) {
  if (!C.glowsEnabled) return null;
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        left: '15%', right: '15%',
        top: 0,
        height: '2px',
        background: `linear-gradient(90deg, transparent, ${C.cyan}, transparent)`,
        boxShadow: `0 0 12px ${C.cyan}`,
        opacity: 0.7,
        '@keyframes hexa-scan': {
          '0%, 100%': { transform: 'translateY(20px)', opacity: 0 },
          '15%':      { opacity: 0.7 },
          '85%':      { opacity: 0.7 },
          '50%':      { transform: 'translateY(280px)' },
        },
        animation: 'hexa-scan 4s ease-in-out infinite',
      }}
    />
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function HexaCyberHero({
  eyebrow,
  title,
  subtitle,
  stats = [],
  cta,
  mascot = '/hexa-mascot.png',
}) {
  const { C } = useHexaTheme();
  const half = Math.ceil(stats.length / 2);
  const leftStats  = stats.slice(0, half);
  const rightStats = stats.slice(half);

  return (
    <Box
      sx={{
        position:     'relative',
        overflow:     'hidden',
        borderRadius: '14px',
        border:       `1px solid ${C.cyanLine}`,
        bgcolor:      C.bg1,
        minHeight:    { xs: 320, md: 380 },
        mb:           '24px',
        boxShadow:    C.glowsEnabled
          ? `0 12px 40px rgba(0,0,0,0.6), inset 0 0 80px rgba(34,240,255,0.05)`
          : 'none',
      }}
    >
      {/* Layered backdrop */}
      <Box aria-hidden sx={{
        position: 'absolute', inset: 0,
        background: `
          radial-gradient(ellipse 70% 60% at 50% 35%, ${C.cyanDim} 0%, transparent 60%),
          radial-gradient(ellipse 50% 40% at 90% 90%, ${C.accentDim} 0%, transparent 70%)
        `,
        pointerEvents: 'none',
      }} />
      <FloorGrid C={C} />
      <ScanLine C={C} />

      {/* Content grid */}
      <Box sx={{
        position: 'relative',
        zIndex:   1,
        height:   '100%',
        display:  'grid',
        gridTemplateColumns: { xs: '1fr', md: 'auto 1fr auto' },
        gridTemplateAreas: {
          xs: `"copy" "mascot" "stats"`,
          md: `"left mascot right"`,
        },
        gap:      { xs: '20px', md: '24px' },
        p:        { xs: '20px', md: '32px' },
        alignItems: 'center',
      }}>
        {/* Left HUD stack */}
        <Box sx={{
          gridArea: { xs: 'stats', md: 'left' },
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          alignSelf: { md: 'stretch' },
          justifyContent: { md: 'space-between' },
        }}>
          {leftStats.map((s, i) => (
            <motion.div
              key={`l-${i}`}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.4 }}
            >
              <HudPanel {...s} C={C} />
            </motion.div>
          ))}
        </Box>

        {/* Center: mascot + headline */}
        <Box sx={{
          gridArea: { xs: 'mascot', md: 'mascot' },
          display:  'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '14px',
          minWidth: 0,
        }}>
          <Box sx={{
            position: 'relative',
            width:   { xs: 130, md: 180 },
            height:  { xs: 130, md: 180 },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Box aria-hidden sx={{
              position: 'absolute', inset: 0,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${C.cyanDim} 0%, transparent 70%)`,
              filter: C.glowsEnabled ? 'blur(8px)' : 'none',
            }} />
            <motion.img
              src={mascot}
              alt="H.E.X.A. mascot"
              initial={{ y: 0 }}
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                userSelect: 'none',
                filter: C.glowsEnabled
                  ? `drop-shadow(0 0 16px ${C.cyan}) drop-shadow(0 8px 24px rgba(0,0,0,0.6))`
                  : 'none',
              }}
              draggable={false}
            />
          </Box>

          {eyebrow && (
            <Typography sx={{
              fontFamily: MONO, fontSize: '0.6rem',
              letterSpacing: '0.28em', textTransform: 'uppercase',
              color: C.cyan, fontWeight: 600,
              textShadow: C.glowsEnabled ? `0 0 8px ${C.cyan}66` : 'none',
            }}>
              {eyebrow}
            </Typography>
          )}
          <Typography sx={{
            fontFamily: DISPLAY,
            fontSize:   { xs: '1.4rem', sm: '1.8rem', md: '2.2rem' },
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: C.ink0,
            lineHeight: 1.05,
            maxWidth: 480,
          }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography sx={{
              fontFamily: DISPLAY, fontSize: '0.88rem',
              color: C.ink1, lineHeight: 1.5, maxWidth: 480,
            }}>
              {subtitle}
            </Typography>
          )}
          {cta && (
            <Box
              component="button"
              onClick={cta.onClick}
              sx={{
                mt: '4px',
                px: '18px', py: '10px',
                border: `1px solid ${C.accentLine}`,
                bgcolor: C.accentDim,
                color: C.accent,
                fontFamily: DISPLAY,
                fontSize: '0.78rem', fontWeight: 700,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                cursor: 'pointer', borderRadius: '4px',
                boxShadow: C.glowsEnabled ? C.accentGlow : 'none',
                transition: 'all 0.18s',
                '&:hover': { bgcolor: C.accent, color: '#0a0d14' },
              }}
            >
              {cta.label}
            </Box>
          )}
        </Box>

        {/* Right HUD stack */}
        <Box sx={{
          gridArea: { xs: 'stats', md: 'right' },
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          gap: '10px',
          alignSelf: 'stretch',
          justifyContent: 'space-between',
        }}>
          {rightStats.map((s, i) => (
            <motion.div
              key={`r-${i}`}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 * i + 0.1, duration: 0.4 }}
            >
              <HudPanel {...s} C={C} />
            </motion.div>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
