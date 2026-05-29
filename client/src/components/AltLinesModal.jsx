/**
 * AltLinesModal.jsx — Alternate prop lines viewer (B10).
 *
 * Fetches all available lines (main + alternate) for a player from
 * GET /api/mlb/props/alt-lines?eventId=&player= and displays them
 * in a modal sorted by line value with implied probabilities.
 */

import { useState, useEffect } from 'react';
import {
  Box, Typography, CircularProgress, Modal, IconButton,
} from '@mui/material';
import { MONO } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const NAVY   = 'var(--bg-0)';
const SURF   = 'var(--bg-1)';
const BORDER = 'var(--border)';
const CYAN   = 'var(--neon-cyan)';
const MUTED  = 'var(--ink-2)';
const INK0   = 'var(--ink-0)';
const GREEN  = 'var(--neon-green)';
const RED    = 'var(--neon-pink)';

function fmtOdds(o) {
  if (o == null) return '—';
  return Number(o) > 0 ? `+${o}` : String(o);
}

function fmtPct(v) {
  if (v == null) return '—';
  return `${(Number(v) * 100).toFixed(1)}%`;
}

export default function AltLinesModal({ open, onClose, eventId, playerName, propKind, token, lang = 'es' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const kindLabels = lang === 'en'
    ? { hits: 'Hits', total_bases: 'Total Bases', strikeouts: 'K', home_runs: 'HR', rbis: 'RBI' }
    : { hits: 'Hits', total_bases: 'Bases Tot.', strikeouts: 'Ponches', home_runs: 'HR', rbis: 'RBI' };

  useEffect(() => {
    if (!open || !eventId || !token) return;
    setLoading(true);
    setError(null);
    setData(null);
    const params = new URLSearchParams({ eventId });
    if (playerName) params.set('player', playerName);
    fetch(`${API_URL}/api/mlb/props/alt-lines?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.success) setData(d.data); else setError(d.error ?? 'Error'); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, eventId, playerName, token]);

  const filtered = propKind ? (data ?? []).filter((g) => g.propKind === propKind) : (data ?? []);

  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: { xs: '95vw', sm: 540 },
          maxHeight: '80vh',
          overflowY: 'auto',
          background: NAVY,
          border: `1px solid ${CYAN}`,
          borderLeft: `4px solid ${CYAN}`,
          p: 3,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '12px', color: CYAN, letterSpacing: '2px' }}>
            {lang === 'en' ? 'ALT LINES' : 'LÍNEAS ALTERNATIVAS'}
            {playerName ? ` — ${playerName}` : ''}
          </Typography>
          <IconButton onClick={onClose} size="small" sx={{ color: MUTED }}>✕</IconButton>
        </Box>

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} sx={{ color: CYAN }} />
          </Box>
        )}

        {error && (
          <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: RED }}>{error}</Typography>
        )}

        {!loading && !error && filtered.length === 0 && (
          <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: MUTED }}>
            {lang === 'en' ? 'No alternate lines available.' : 'Sin líneas alternativas disponibles.'}
          </Typography>
        )}

        {filtered.map((group) => (
          <Box key={`${group.player}-${group.propKind}`} sx={{ mb: 2.5 }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: CYAN, letterSpacing: '1px', mb: 0.5 }}>
              {group.player} — {kindLabels[group.propKind] ?? group.propKind}
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: '10px' }}>
                <thead>
                  <tr style={{ color: MUTED, textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px' }}>{lang === 'en' ? 'Line' : 'Línea'}</th>
                    <th style={{ padding: '4px 8px' }}>{lang === 'en' ? 'Side' : 'Lado'}</th>
                    <th style={{ padding: '4px 8px' }}>{lang === 'en' ? 'Odds' : 'Cuota'}</th>
                    <th style={{ padding: '4px 8px' }}>{lang === 'en' ? 'Implied' : 'Implícita'}</th>
                    <th style={{ padding: '4px 8px' }}>{lang === 'en' ? 'Type' : 'Tipo'}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((l, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '6px 8px', color: INK0, fontWeight: 700 }}>{l.line}</td>
                      <td style={{ padding: '6px 8px', color: INK0 }}>{l.direction?.toUpperCase()}</td>
                      <td style={{ padding: '6px 8px', color: l.odds > 0 ? GREEN : RED }}>{fmtOdds(l.odds)}</td>
                      <td style={{ padding: '6px 8px', color: MUTED }}>{fmtPct(l.implied)}</td>
                      <td style={{ padding: '6px 8px', color: l.isAlternate ? MUTED : CYAN }}>
                        {l.isAlternate ? (lang === 'en' ? 'alt' : 'alt') : (lang === 'en' ? 'main' : 'principal')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Box>
        ))}
      </Box>
    </Modal>
  );
}
