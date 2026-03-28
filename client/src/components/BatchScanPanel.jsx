/**
 * BatchScanPanel.jsx
 * Admin-only batch scan: select multiple games, analyze each individually in parallel,
 * display consolidated picks. Picks are auto-saved to the database.
 */

import { useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useAuth } from '../store/authStore';
import { C, BARLOW, MONO, SANS } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ── i18n ─────────────────────────────────────────────────────────────────────
const L = {
  en: {
    runBatch:    'Run Batch Scan',
    scanning:    'Scanning',
    games:       'games',
    complete:    'Scan complete',
    analyzed:    'analyzed',
    failed:      'failed',
    noGames:     'Select games from the list to scan.',
    confidence:  'Confidence',
    risk:        'Risk',
    oracleReport:'Oracle Report',
    hunch:       'Hunch',
    alerts:      'Alerts',
    saved:       'Saved to history',
    error:       'Error',
    selectAll:   'Select All',
  },
  es: {
    runBatch:    'Lanzar Batch Scan',
    scanning:    'Escaneando',
    games:       'partidos',
    complete:    'Escaneo completo',
    analyzed:    'analizados',
    failed:      'fallidos',
    noGames:     'Selecciona partidos de la lista para escanear.',
    confidence:  'Confianza',
    risk:        'Riesgo',
    oracleReport:'Reporte Oracle',
    hunch:       'Corazonada',
    alerts:      'Alertas',
    saved:       'Guardado en historial',
    error:       'Error',
    selectAll:   'Seleccionar Todos',
  },
};

// Risk badge colors
const RISK_COLORS = {
  low:    { bg: 'rgba(0,255,136,0.1)', border: 'rgba(0,255,136,0.3)', text: '#00FF88' },
  medium: { bg: 'rgba(255,170,0,0.1)',  border: 'rgba(255,170,0,0.3)',  text: '#FFAA00' },
  high:   { bg: 'rgba(255,34,68,0.1)',  border: 'rgba(255,34,68,0.3)',  text: '#FF2244' },
};

function ConfidenceBar({ value }) {
  const color = value >= 62 ? '#00FF88' : value >= 55 ? '#FFAA00' : '#FF2244';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <Box sx={{ flex: 1, height: '4px', bgcolor: C.border, borderRadius: '2px', overflow: 'hidden' }}>
        <Box sx={{ width: `${value}%`, height: '100%', bgcolor: color, borderRadius: '2px' }} />
      </Box>
      <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', fontWeight: 700, color, minWidth: '30px' }}>
        {value}%
      </Typography>
    </Box>
  );
}

// Single result card for a batch-scanned game
function BatchResultCard({ result, t }) {
  const [expanded, setExpanded] = useState(false);

  if (result.error) {
    return (
      <Box sx={{
        bgcolor: C.surface, border: `1px solid rgba(255,34,68,0.3)`, borderRadius: '4px', p: '14px',
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', fontWeight: 700, color: C.textPrimary }}>
            {result.matchup ?? `Game ${result.gameId}`}
          </Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: '#FF2244' }}>
            {t.error}: {result.error}
          </Typography>
        </Box>
      </Box>
    );
  }

  const d = result.data ?? {};
  const mp = d.master_prediction ?? {};
  const conf = Math.min(100, Math.max(0, Number(mp.oracle_confidence) || 0));
  const risk = d.model_risk ?? 'medium';
  const riskStyle = RISK_COLORS[risk] ?? RISK_COLORS.medium;

  return (
    <Box
      sx={{
        bgcolor: C.surface, border: `1px solid ${C.border}`, borderRadius: '4px', p: '14px',
        cursor: 'pointer', transition: 'border-color 0.2s',
        '&:hover': { borderColor: C.accentLine },
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header row: matchup + pick + confidence */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: '8px' }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', fontWeight: 700, color: C.textPrimary }}>
          {result.matchup}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Risk badge */}
          <Box sx={{
            px: '6px', py: '2px', borderRadius: '2px',
            bgcolor: riskStyle.bg, border: `1px solid ${riskStyle.border}`,
          }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', fontWeight: 700, color: riskStyle.text, textTransform: 'uppercase' }}>
              {risk}
            </Typography>
          </Box>
          {/* Saved indicator */}
          {result.pickId && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.5rem', color: '#00FF88', letterSpacing: '1px' }}>
              ✓ {t.saved}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Pick line */}
      {mp.pick && (
        <Box sx={{
          bgcolor: C.accentDim, border: `1px solid ${C.accentLine}`, borderRadius: '2px',
          p: '8px 10px', mb: '8px',
        }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.8rem', fontWeight: 700, color: C.accent }}>
            {mp.pick}
          </Typography>
          {mp.bet_value && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: C.textMuted, mt: '2px' }}>
              {mp.bet_value}
            </Typography>
          )}
        </Box>
      )}

      {/* Confidence bar */}
      <ConfidenceBar value={conf} />

      {/* Expanded details */}
      {expanded && (
        <Box sx={{ mt: '12px', pt: '12px', borderTop: `1px solid ${C.border}` }}>
          {/* Oracle Report */}
          {d.oracle_report && (
            <Box sx={{ mb: '10px' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '2px', mb: '4px' }}>
                {t.oracleReport}
              </Typography>
              <Typography sx={{ fontFamily: SANS, fontSize: '0.78rem', color: C.textSecondary, lineHeight: 1.6 }}>
                {d.oracle_report}
              </Typography>
            </Box>
          )}

          {/* Hunch */}
          {d.hexa_hunch && (
            <Box sx={{ mb: '10px' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '2px', mb: '4px' }}>
                {t.hunch}
              </Typography>
              <Typography sx={{ fontFamily: SANS, fontSize: '0.75rem', color: C.textSecondary, fontStyle: 'italic' }}>
                {d.hexa_hunch}
              </Typography>
            </Box>
          )}

          {/* Alert Flags */}
          {d.alert_flags?.length > 0 && (
            <Box>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '2px', mb: '4px' }}>
                {t.alerts}
              </Typography>
              {d.alert_flags.map((flag, i) => (
                <Typography key={i} sx={{ fontFamily: SANS, fontSize: '0.72rem', color: C.textSecondary, mb: '2px' }}>
                  • {flag}
                </Typography>
              ))}
            </Box>
          )}

          {/* K Props */}
          {d.k_props_analysis && (
            <Box sx={{ mt: '10px' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: C.textMuted, textTransform: 'uppercase', letterSpacing: '2px', mb: '4px' }}>
                K PROPS
              </Typography>
              {['home_pitcher', 'away_pitcher'].map(key => {
                const kp = d.k_props_analysis?.[key];
                if (!kp) return null;
                return (
                  <Typography key={key} sx={{ fontFamily: SANS, fontSize: '0.72rem', color: C.textSecondary, mb: '2px' }}>
                    {kp.name}: {kp.k_line} → {kp.recommendation} ({kp.confidence}%) — {kp.key_reason}
                  </Typography>
                );
              })}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export default function BatchScanPanel({ selectedGames = [], lang = 'en', setIsAnalyzing }) {
  const t = L[lang] ?? L.en;
  const { token } = useAuth();

  const [loading, setLoading]   = useState(false);
  const [results, setResults]   = useState(null);
  const [progress, setProgress] = useState('');

  const canScan = selectedGames.length > 0 && !loading;

  async function runBatchScan() {
    if (!canScan) return;
    setLoading(true);
    setResults(null);
    setIsAnalyzing?.(true);
    setProgress(`${t.scanning} ${selectedGames.length} ${t.games}...`);

    try {
      const res = await fetch(`${API_URL}/api/analyze/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          gameIds: selectedGames.map(g => g.gamePk),
          lang,
          date: selectedGames[0]?.gameDate?.split('T')[0],
        }),
      });

      const json = await res.json();

      if (!json.success) {
        setProgress(`Error: ${json.error}`);
        return;
      }

      setResults(json.data);
      const s = json.data.summary;
      setProgress(`${t.complete}: ${s.analyzed} ${t.analyzed}, ${s.failed} ${t.failed}`);
    } catch (err) {
      setProgress(`Error: ${err.message}`);
    } finally {
      setLoading(false);
      setIsAnalyzing?.(false);
    }
  }

  return (
    <Box>
      {/* Run button */}
      <Box
        component="button"
        onClick={runBatchScan}
        disabled={!canScan}
        sx={{
          width: '100%',
          py: '12px',
          mb: '16px',
          bgcolor: canScan ? 'rgba(255,102,0,0.12)' : C.surface,
          border: `1px solid ${canScan ? 'rgba(255,102,0,0.4)' : C.border}`,
          borderRadius: '2px',
          color: canScan ? '#FF6600' : C.textMuted,
          fontFamily: MONO,
          fontSize: '0.75rem',
          fontWeight: 700,
          letterSpacing: '3px',
          textTransform: 'uppercase',
          cursor: canScan ? 'pointer' : 'default',
          transition: 'all 0.2s',
          '&:hover': canScan ? { bgcolor: 'rgba(255,102,0,0.18)' } : {},
          animation: loading ? 'pulse 1.5s ease infinite' : 'none',
          '@keyframes pulse': {
            '0%,100%': { opacity: 1 },
            '50%': { opacity: 0.6 },
          },
        }}
      >
        {loading
          ? `${t.scanning} ${selectedGames.length} ${t.games}...`
          : `${t.runBatch} (${selectedGames.length} ${t.games})`}
      </Box>

      {/* Progress / status */}
      {progress && (
        <Typography sx={{
          fontFamily: MONO, fontSize: '0.65rem', color: C.textMuted,
          textAlign: 'center', mb: '16px', letterSpacing: '1px',
        }}>
          {progress}
        </Typography>
      )}

      {/* No games hint */}
      {selectedGames.length === 0 && !results && (
        <Typography sx={{
          fontFamily: SANS, fontSize: '0.85rem', color: C.textMuted,
          textAlign: 'center', py: '40px',
        }}>
          {t.noGames}
        </Typography>
      )}

      {/* Results list */}
      {results?.results && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {results.results.map((r, i) => (
            <BatchResultCard key={r.gameId ?? i} result={r} t={t} />
          ))}
        </Box>
      )}
    </Box>
  );
}
