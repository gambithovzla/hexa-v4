/**
 * HexaLiveStream.jsx — SSE-based real-time game feed (B2).
 *
 * Subscribes to GET /api/games/:gamePk/live/stream via EventSource.
 * Displays live score, inning situation, and recent play-by-play for
 * a single game. Reconnects automatically on disconnect.
 *
 * Usage:
 *   <HexaLiveStream gamePk={12345} token={jwtToken} onClose={...} />
 */

import { useState, useEffect, useRef } from 'react';
import { Box, Typography, LinearProgress, IconButton, Chip } from '@mui/material';
import { MONO, BARLOW } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const NAVY   = 'var(--bg-0)';
const SURF   = 'var(--bg-1)';
const BORDER = 'var(--border)';
const CYAN   = 'var(--neon-cyan)';
const VOLT   = 'var(--neon-green)';
const MUTED  = 'var(--ink-2)';
const INK0   = 'var(--ink-0)';
const RED    = 'var(--neon-pink)';

function ordinal(n) {
  if (!n) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatScore(live) {
  if (!live) return null;
  const away = live.linescore?.teams?.away ?? live.teams?.away;
  const home = live.linescore?.teams?.home ?? live.teams?.home;
  return { away: away?.runs ?? 0, home: home?.runs ?? 0 };
}

export default function HexaLiveStream({ gamePk, token, onClose, lang = 'es' }) {
  const [gameState, setGameState] = useState(null);
  const [plays, setPlays] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const esRef = useRef(null);
  const reconnectTimer = useRef(null);

  const connect = () => {
    if (!gamePk || !token) return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const url = `${API_URL}/api/games/${gamePk}/live/stream?interval=15000`;
    const es = new EventSource(`${url}&_auth=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.addEventListener('update', (e) => {
      try {
        const data = JSON.parse(e.data);
        setGameState(data);
        setConnected(true);
        setError(null);
        if (data.currentPlay?.description) {
          setPlays((prev) => {
            const entry = {
              ts: Date.now(),
              text: data.currentPlay.description,
              half: data.linescore?.inningHalf,
              inning: data.linescore?.currentInning,
            };
            return [entry, ...prev].slice(0, 10);
          });
        }
      } catch (_) {}
    });

    es.addEventListener('error', () => {
      setConnected(false);
      es.close();
      esRef.current = null;
      reconnectTimer.current = setTimeout(connect, 10_000);
    });
  };

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (esRef.current) esRef.current.close();
    };
  }, [gamePk, token]);

  const linescore = gameState?.linescore;
  const score = formatScore(gameState);
  const awayName = gameState?.gameData?.teams?.away?.abbreviation ?? 'AWY';
  const homeName = gameState?.gameData?.teams?.home?.abbreviation ?? 'HME';
  const inning = linescore?.currentInning;
  const half = linescore?.inningHalf;
  const outs = linescore?.outs ?? 0;
  const abstract = gameState?.gameData?.status?.abstractGameState ?? '';
  const isFinal = abstract === 'Final';
  const isLive = abstract === 'Live';

  return (
    <Box sx={{ background: SURF, border: `1px solid ${CYAN}`, borderLeft: `4px solid ${CYAN}`, p: 2.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: CYAN, letterSpacing: '2px' }}>
            HEXA LIVE
          </Typography>
          <Chip
            size="small"
            label={
              !connected ? (lang === 'en' ? 'connecting…' : 'conectando…') :
              isFinal ? 'FINAL' :
              isLive ? '● LIVE' :
              (lang === 'en' ? 'pre-game' : 'pre-partido')
            }
            sx={{
              fontFamily: MONO,
              fontSize: '9px',
              height: 18,
              bgcolor: isFinal ? MUTED : isLive ? 'rgba(195,255,0,0.15)' : SURF,
              color: isFinal ? INK0 : isLive ? VOLT : MUTED,
              border: `1px solid ${isLive ? VOLT : BORDER}`,
            }}
          />
        </Box>
        {onClose && (
          <IconButton onClick={onClose} size="small" sx={{ color: MUTED, p: 0.25 }}>✕</IconButton>
        )}
      </Box>

      {error && (
        <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: RED, mb: 1 }}>{error}</Typography>
      )}

      {!connected && !error && (
        <LinearProgress sx={{ mb: 1, bgcolor: 'rgba(255,255,255,0.05)', '& .MuiLinearProgress-bar': { bgcolor: CYAN } }} />
      )}

      {score && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 1.5 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: MUTED }}>{awayName}</Typography>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '2rem', fontWeight: 700, color: INK0, lineHeight: 1 }}>
              {score.away}
            </Typography>
          </Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: MUTED }}>@</Typography>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: MUTED }}>{homeName}</Typography>
            <Typography sx={{ fontFamily: BARLOW, fontSize: '2rem', fontWeight: 700, color: INK0, lineHeight: 1 }}>
              {score.home}
            </Typography>
          </Box>
          {inning && !isFinal && (
            <Box sx={{ ml: 'auto', textAlign: 'right' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: CYAN }}>
                {half === 'Top' ? '▲' : '▼'} {ordinal(inning)}
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED }}>
                {outs} {lang === 'en' ? 'out' : 'out'}{outs !== 1 ? 's' : ''}
              </Typography>
            </Box>
          )}
          {isFinal && (
            <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: MUTED, ml: 'auto' }}>FINAL</Typography>
          )}
        </Box>
      )}

      {plays.length > 0 && (
        <Box sx={{ borderTop: `1px solid ${BORDER}`, pt: 1 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, mb: 0.5, letterSpacing: '1px' }}>
            {lang === 'en' ? 'RECENT PLAYS' : 'JUGADAS RECIENTES'}
          </Typography>
          {plays.slice(0, 4).map((p, i) => (
            <Typography
              key={p.ts}
              sx={{
                fontFamily: MONO,
                fontSize: '9px',
                color: i === 0 ? INK0 : MUTED,
                mb: 0.25,
                opacity: 1 - i * 0.18,
              }}
            >
              {p.text}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}
