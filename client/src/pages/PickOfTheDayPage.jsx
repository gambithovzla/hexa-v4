/**
 * PickOfTheDayPage.jsx — H.E.X.A. V4 Admin · Pick del Día para Ganar
 *
 * One button → the single best pick to WIN for the date, inside a payout window
 * (default -150..+120) with an anti-vig gate, or an honest PASS. Built for the
 * "one daily $100 bet, I keep 15% of the winnings" use case, so it also shows the
 * expected profit on $100 and the 15% cut.
 *
 * Admin-only. Route: /admin/pick-of-the-day
 * Props: token {string}, lang {string}, onBack {Function}
 */

import { useState } from 'react';
import { Box, Typography, CircularProgress, Button, Chip } from '@mui/material';
import { MONO, BARLOW } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const BG = 'var(--bg-0)';
const SURF = 'var(--bg-1)';
const BORDER = 'var(--border)';
const CYAN = 'var(--neon-cyan)';
const GREEN = 'var(--outcome-win)';
const RED = 'var(--outcome-loss)';
const AMBER = 'var(--warning)';
const MUTED = 'var(--ink-2)';

const T = (lang, es, en) => (lang === 'es' ? es : en);

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function fmtPct(n) {
  return n == null ? '—' : `${Number(n).toFixed(1)}%`;
}

function fmtOdds(n) {
  if (n == null) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

const REASON_TEXT = (reason, lang) => {
  const map = {
    no_candidate_clears_gate: T(lang, 'Ningún juego superó el filtro hoy (cuota o ventaja insuficiente).',
      'No game cleared the filter today (odds or edge insufficient).'),
    odds_too_short: T(lang, 'cuota demasiado baja (paga poco)', 'odds too short (pays too little)'),
    odds_too_long: T(lang, 'cuota demasiado alta (muy arriesgado)', 'odds too long (too risky)'),
    no_edge_over_breakeven: T(lang, 'sin ventaja sobre el break-even', 'no edge over break-even'),
    model_prob_below_min: T(lang, 'probabilidad del modelo baja', 'model probability too low'),
    data_quality_below_min: T(lang, 'datos insuficientes', 'insufficient data'),
    lineup_not_confirmed: T(lang, 'lineup no confirmado', 'lineup not confirmed'),
    no_market_price: T(lang, 'sin cuota de mercado', 'no market price'),
    no_model_prob: T(lang, 'sin probabilidad del modelo', 'no model probability'),
  };
  return map[reason] || reason;
};

function Metric({ label, value, big, small, color }) {
  return (
    <Box>
      <Typography sx={{ fontFamily: MONO, fontSize: 10, color: MUTED, letterSpacing: 1 }}>{label}</Typography>
      <Typography sx={{ fontWeight: 800, fontSize: big ? 26 : small ? 13 : 18, color: color ?? (big ? GREEN : 'var(--ink-0)') }}>{value}</Typography>
    </Box>
  );
}

export default function PickOfTheDayPage({ token, lang = 'en', onBack }) {
  const [date, setDate] = useState(todayKey());
  const [oddsFloor, setOddsFloor] = useState(-150);
  const [oddsCeiling, setOddsCeiling] = useState(120);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/pick-of-the-day/analyze`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          date,
          lang,
          oddsFloorAmerican: Number(oddsFloor),
          oddsCeilingAmerican: Number(oddsCeiling),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'failed');
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: 'var(--ink-0)', p: { xs: 2, md: 4 }, fontFamily: BARLOW }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: 12, color: CYAN, letterSpacing: 2 }}>H.E.X.A. V4 · ADMIN</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 28, lineHeight: 1 }}>PICK DEL DÍA</Typography>
          <Typography sx={{ color: MUTED, fontSize: 13, mt: 0.5 }}>
            {T(lang, 'El mejor pick del día para ganar, en una cuota que pague bien — o PASS honesto.',
              'The best pick of the day to win, at odds that pay — or an honest PASS.')}
          </Typography>
        </Box>
        <Button onClick={onBack} sx={{ color: MUTED, fontFamily: MONO }}>← {T(lang, 'Volver', 'Back')}</Button>
      </Box>

      {error && (
        <Box sx={{ bgcolor: 'rgba(255,0,0,0.08)', border: `1px solid ${RED}`, borderRadius: 1, p: 1.5, mb: 2 }}>
          <Typography sx={{ color: RED, fontFamily: MONO, fontSize: 13 }}>{error}</Typography>
        </Box>
      )}

      {/* ── Controls ────────────────────────────────────────────────────── */}
      <Box sx={{ bgcolor: SURF, border: `1px solid ${BORDER}`, borderRadius: 2, p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography sx={{ fontFamily: MONO, fontSize: 10, color: MUTED, letterSpacing: 1, mb: 0.5 }}>{T(lang, 'FECHA', 'DATE')}</Typography>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ background: 'var(--bg-2)', color: 'var(--ink-0)', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '6px 10px', fontFamily: MONO }}
            />
          </Box>
          <Box>
            <Typography sx={{ fontFamily: MONO, fontSize: 10, color: MUTED, letterSpacing: 1, mb: 0.5 }}>{T(lang, 'CUOTA MÍN (favorito)', 'ODDS FLOOR (fav)')}</Typography>
            <input
              type="number"
              value={oddsFloor}
              onChange={(e) => setOddsFloor(e.target.value)}
              style={{ width: 90, background: 'var(--bg-2)', color: 'var(--ink-0)', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '6px 10px', fontFamily: MONO }}
            />
          </Box>
          <Box>
            <Typography sx={{ fontFamily: MONO, fontSize: 10, color: MUTED, letterSpacing: 1, mb: 0.5 }}>{T(lang, 'CUOTA MÁX (dog)', 'ODDS CEILING (dog)')}</Typography>
            <input
              type="number"
              value={oddsCeiling}
              onChange={(e) => setOddsCeiling(e.target.value)}
              style={{ width: 90, background: 'var(--bg-2)', color: 'var(--ink-0)', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '6px 10px', fontFamily: MONO }}
            />
          </Box>
          <Button
            onClick={analyze}
            disabled={analyzing}
            sx={{
              bgcolor: CYAN, color: '#000', fontFamily: MONO, fontWeight: 800, px: 3, height: 40,
              '&:hover': { bgcolor: CYAN, opacity: 0.85 }, '&.Mui-disabled': { bgcolor: 'var(--bg-2)', color: MUTED },
            }}
          >
            {analyzing ? T(lang, 'BUSCANDO…', 'SEARCHING…') : T(lang, 'BUSCAR PICK DEL DÍA', 'FIND PICK OF THE DAY')}
          </Button>
        </Box>
        <Typography sx={{ color: MUTED, fontSize: 11, fontFamily: MONO, mt: 1.5 }}>
          {T(lang, 'Analiza todos los juegos con lineup confirmado. Los lineups salen ~1-2h antes del juego.',
            'Analyzes every game with a confirmed lineup. Lineups post ~1-2h before game time.')}
        </Typography>
      </Box>

      {analyzing && <CircularProgress size={24} sx={{ color: CYAN }} />}

      {result && <ResultView result={result} lang={lang} />}
    </Box>
  );
}

function ResultView({ result, lang }) {
  const isPick = result.status === 'PICK' && result.pick;
  const p = result.pick;

  // Tangible economics for the $100/day deal: profit on a $100 win + the 15% cut.
  const profit100 = isPick && p.payoutDecimal != null ? (p.payoutDecimal - 1) * 100 : null;
  const cut15 = profit100 != null ? profit100 * 0.15 : null;

  return (
    <Box sx={{ mb: 3 }}>
      {isPick ? (
        <Box sx={{ bgcolor: 'rgba(0,255,136,0.06)', border: `2px solid ${GREEN}`, borderRadius: 2, p: 2.5 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: GREEN, letterSpacing: 2 }}>
            ✓ {T(lang, 'PICK DEL DÍA', 'PICK OF THE DAY')}
          </Typography>
          <Typography sx={{ fontWeight: 900, fontSize: 28, mt: 0.5 }}>{p.pick}</Typography>
          <Typography sx={{ color: MUTED, fontSize: 13 }}>
            {(p.marketType || '').toUpperCase()}{p.odds != null ? ` · ${fmtOdds(p.odds)}` : ''}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4,1fr)' }, gap: 2, mt: 2 }}>
            <Metric label={T(lang, 'Prob. de ganar', 'Win probability')} value={fmtPct(p.winProbability)} big />
            <Metric label={T(lang, 'Break-even cuota', 'Odds break-even')} value={fmtPct(p.breakeven)} />
            <Metric
              label={T(lang, 'Ventaja sobre break-even', 'Edge over break-even')}
              value={p.edgeOverBreakeven != null ? `+${Number(p.edgeOverBreakeven).toFixed(1)}%` : '—'}
              color={GREEN}
            />
            <Metric label={T(lang, 'Pago (decimal)', 'Payout (decimal)')} value={p.payoutDecimal != null ? Number(p.payoutDecimal).toFixed(2) : '—'} />
          </Box>

          {profit100 != null && (
            <Box sx={{ mt: 2, p: 1.5, bgcolor: 'var(--bg-2)', borderRadius: 1.5 }}>
              <Typography sx={{ fontFamily: MONO, fontSize: 11, color: MUTED, letterSpacing: 1, mb: 0.5 }}>
                {T(lang, 'SI APUESTA $100 Y GANA', 'IF $100 IS BET AND WINS')}
              </Typography>
              <Typography sx={{ fontSize: 15 }}>
                {T(lang, 'Ganancia', 'Profit')}: <b style={{ color: GREEN }}>${profit100.toFixed(0)}</b>
                {'  ·  '}
                {T(lang, 'Tu 15%', 'Your 15%')}: <b style={{ color: CYAN }}>${cut15.toFixed(2)}</b>
              </Typography>
            </Box>
          )}

          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: MUTED, mt: 1.5 }}>
            {T(lang, 'Modelo', 'Model')}: {fmtPct(p.components?.modelProb)} · {T(lang, 'Mercado', 'Market')}: {fmtPct(p.components?.impliedProb)}
            {p.components?.mlProb != null ? ` · ML: ${fmtPct(p.components.mlProb)}` : ''}
            {' · '}{T(lang, 'convicción', 'conviction')} {fmtPct(p.conviction)}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ bgcolor: 'rgba(255,176,32,0.06)', border: `2px solid ${AMBER}`, borderRadius: 2, p: 2.5 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: AMBER, letterSpacing: 2 }}>
            ⊘ {T(lang, 'HOY NO HAY PICK', 'NO PICK TODAY')}
          </Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 18, mt: 0.5 }}>{REASON_TEXT(result.reason, lang)}</Typography>
          <Typography sx={{ color: MUTED, fontSize: 13, mt: 0.5 }}>
            {T(lang, 'No forzar un pick es la decisión correcta los días flojos. La rentabilidad sale en el mes.',
              'Not forcing a pick is the right call on weak days. Profit comes over the month.')}
          </Typography>
        </Box>
      )}

      {/* Slate context */}
      <Typography sx={{ fontFamily: MONO, fontSize: 11, color: MUTED, mt: 1.5 }}>
        {result.confirmedGames}/{result.totalGames} {T(lang, 'juegos con lineup · candidatos evaluados', 'games with lineup · candidates considered')}: {result.considered} · {T(lang, 'elegibles', 'eligible')}: {result.eligibleCount}
      </Typography>

      {/* Rejected list — why other candidates didn't make it */}
      {Array.isArray(result.rejected) && result.rejected.length > 0 && (
        <Box sx={{ mt: 2, bgcolor: SURF, border: `1px solid ${BORDER}`, borderRadius: 2, p: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 12, color: MUTED, mb: 1 }}>
            {T(lang, 'DESCARTADOS', 'REJECTED')} ({result.rejected.length})
          </Typography>
          {result.rejected.slice(0, 12).map((c, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.6, borderBottom: `1px solid ${BORDER}` }}>
              <Typography sx={{ fontFamily: MONO, fontSize: 12, minWidth: 56, color: MUTED }}>{fmtOdds(c.odds)}</Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.pick}</Typography>
                {Array.isArray(c.reasons) && c.reasons.length > 0 && (
                  <Typography sx={{ fontSize: 10, color: MUTED, fontFamily: MONO }}>
                    ✗ {c.reasons.map((r) => REASON_TEXT(r, lang)).join(', ')}
                  </Typography>
                )}
                {c.winProbability != null && (
                  <Typography sx={{ fontSize: 10, color: MUTED, fontFamily: MONO }}>{T(lang, 'prob', 'prob')} {fmtPct(c.winProbability)}</Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
