/**
 * ImperdibleSoccerPage.jsx — H.E.X.A. V4 Admin · Pick Imperdible Soccer
 *
 * Soccer analog of ImperdiblePage.jsx. Select games from a league + date,
 * analyze them, and the engine returns a SINGLE highest-conviction lock
 * (or PASS). All six leagues supported via a league selector.
 *
 * Key differences vs MLB imperdible:
 *   - Requires leagueSlug param (soccer is league-aware)
 *   - Conviction gate: 60% (vs 72% MLB / 70% NFL) — soccer cap is 62%
 *   - Gate: model-certified (no lineup confirmed gate — alineaciones ~1h pre-kick)
 *   - Endpoints: /api/soccer/imperdible/{games|analyze|history}
 *   - Flag: IMPERDIBLE_SOCCER_ENABLED
 *
 * Admin-only. Route: /admin/imperdible-soccer
 */

import { useState, useEffect, useCallback } from 'react';
import { Box, Typography, CircularProgress, Button, Chip, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { MONO, BARLOW } from '../theme';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const BG     = 'var(--bg-0)';
const SURF   = 'var(--bg-1)';
const BORDER = 'var(--border)';
const GRASS  = '#2d6a2d';   // soccer grass-green accent
const GREEN  = 'var(--outcome-win)';
const RED    = 'var(--outcome-loss)';
const AMBER  = 'var(--warning)';
const MUTED  = 'var(--ink-2)';

const LEAGUES = [
  { value: 'eng.1', label: 'Premier League' },
  { value: 'esp.1', label: 'La Liga' },
  { value: 'ita.1', label: 'Serie A' },
  { value: 'ger.1', label: 'Bundesliga' },
  { value: 'fra.1', label: 'Ligue 1' },
  { value: 'usa.1', label: 'MLS' },
];

const T = (lang, es, en) => (lang === 'es' ? es : en);

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

function fmtPct(n) {
  return n == null ? '—' : `${Number(n).toFixed(1)}%`;
}

function ConvictionBar({ value }) {
  const v = Math.max(0, Math.min(99, Number(value) || 0));
  const color = v >= 60 ? GREEN : v >= 54 ? AMBER : RED;
  return (
    <Box sx={{ width: '100%', height: 8, bgcolor: 'var(--bg-2)', borderRadius: 4, overflow: 'hidden' }}>
      <Box sx={{ width: `${v}%`, height: '100%', bgcolor: color }} />
    </Box>
  );
}

export default function ImperdibleSoccerPage({ token, lang = 'es', onBack }) {
  const [date, setDate] = useState(todayKey());
  const [league, setLeague] = useState('eng.1');
  const [games, setGames] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loadingGames, setLoadingGames] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadGames = useCallback(async () => {
    setLoadingGames(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/soccer/imperdible/games?league=${league}&date=${date}`, { headers: authHeaders });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'failed');
      setGames(data.games || []);
      setSelected(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingGames(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, league]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/soccer/imperdible/history?limit=30`, { headers: authHeaders });
      const data = await res.json();
      if (data.success) setHistory(data);
    } catch { /* non-critical */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadGames(); }, [loadGames]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const toggle = (gameId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId); else next.add(gameId);
      return next;
    });
  };

  const analyze = async () => {
    if (selected.size === 0) return;
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_URL}/api/soccer/imperdible/analyze`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ leagueSlug: league, gameIds: [...selected], date, lang }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'failed');
      setResult(data);
      loadHistory();
    } catch (e) {
      setError(e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: 'var(--ink-0)', p: { xs: 2, md: 4 }, fontFamily: BARLOW }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography sx={{ fontFamily: MONO, fontSize: 12, color: GRASS, letterSpacing: 2 }}>H.E.X.A. V4 · ADMIN · ⚽ SOCCER</Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 28, lineHeight: 1 }}>PICK IMPERDIBLE</Typography>
          <Typography sx={{ color: MUTED, fontSize: 13, mt: 0.5 }}>
            {T(lang, 'El lock del día: máxima convicción, modelo certificado, mercado 3-vías.',
              'Lock of the day: max conviction, model-certified, 3-way market.')}
          </Typography>
        </Box>
        <Button onClick={onBack} sx={{ color: MUTED, fontFamily: MONO }}>← {T(lang, 'Volver', 'Back')}</Button>
      </Box>

      {error && (
        <Box sx={{ bgcolor: 'rgba(255,0,0,0.08)', border: `1px solid ${RED}`, borderRadius: 1, p: 1.5, mb: 2 }}>
          <Typography sx={{ color: RED, fontFamily: MONO, fontSize: 13 }}>{error}</Typography>
        </Box>
      )}

      {/* ── League + Date selector ────────────────────────────────────────── */}
      <Box sx={{ bgcolor: SURF, border: `1px solid ${BORDER}`, borderRadius: 2, p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel sx={{ fontFamily: MONO, fontSize: '11px', color: MUTED }}>Liga</InputLabel>
            <Select
              value={league}
              label="Liga"
              onChange={(e) => setLeague(e.target.value)}
              sx={{ fontFamily: MONO, fontSize: '12px', color: 'var(--ink-0)', border: `1px solid ${BORDER}` }}
            >
              {LEAGUES.map((l) => (
                <MenuItem key={l.value} value={l.value}>{l.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ background: 'var(--bg-2)', color: 'var(--ink-0)', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '6px 10px', fontFamily: MONO }}
          />
          <Button onClick={loadGames} disabled={loadingGames}
            sx={{ fontFamily: MONO, fontSize: 12, color: GRASS, border: `1px solid ${BORDER}` }}>
            {loadingGames ? '…' : T(lang, 'Refrescar', 'Refresh')}
          </Button>
        </Box>

        {loadingGames ? (
          <CircularProgress size={20} sx={{ color: GRASS }} />
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 1 }}>
            {games.map((g) => {
              const isSel = selected.has(g.gameId ?? g.gamePk);
              return (
                <Box
                  key={g.gameId ?? g.gamePk}
                  onClick={() => g.selectable && toggle(g.gameId ?? g.gamePk)}
                  sx={{
                    p: 1.2,
                    borderRadius: 1.5,
                    border: `1px solid ${isSel ? GRASS : BORDER}`,
                    bgcolor: isSel ? 'rgba(45,106,45,0.10)' : 'var(--bg-2)',
                    cursor: g.selectable ? 'pointer' : 'not-allowed',
                    opacity: g.selectable ? 1 : 0.45,
                  }}
                >
                  <Typography sx={{ fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>{g.matchup}</Typography>
                  {g.startTime && (
                    <Typography sx={{ fontFamily: MONO, fontSize: 10, color: MUTED, mt: 0.25 }}>
                      {String(g.startTime).slice(11, 16)} UTC
                    </Typography>
                  )}
                  <Chip
                    size="small"
                    label={g.lineupStatus ?? (g.selectable ? 'selectable' : 'final')}
                    sx={{
                      mt: 0.5, height: 18, fontSize: 10, fontFamily: MONO,
                      color: g.selectable ? GREEN : MUTED,
                      bgcolor: 'transparent', border: `1px solid ${g.selectable ? GREEN : MUTED}`,
                    }}
                  />
                </Box>
              );
            })}
            {games.length === 0 && (
              <Typography sx={{ color: MUTED, fontFamily: MONO, fontSize: 13 }}>
                {T(lang, 'No hay partidos para esta liga y fecha.', 'No matches for this league and date.')}
              </Typography>
            )}
          </Box>
        )}

        <Button
          onClick={analyze}
          disabled={analyzing || selected.size === 0}
          sx={{
            mt: 2, bgcolor: GRASS, color: '#fff', fontFamily: MONO, fontWeight: 800,
            '&:hover': { bgcolor: GRASS, opacity: 0.85 }, '&.Mui-disabled': { bgcolor: 'var(--bg-2)', color: MUTED },
          }}
        >
          {analyzing
            ? T(lang, 'ANALIZANDO…', 'ANALYZING…')
            : `${T(lang, 'BUSCAR IMPERDIBLE', 'FIND THE LOCK')} (${selected.size})`}
        </Button>
      </Box>

      {result && <ResultView result={result} lang={lang} />}
      {history && <HistoryView history={history} lang={lang} />}
    </Box>
  );
}

function ResultView({ result, lang }) {
  const isLock = result.verdict === 'CONFIRM' && result.imperdible;
  const lock = result.imperdible;
  return (
    <Box sx={{ mb: 3 }}>
      {isLock ? (
        <Box sx={{ bgcolor: 'rgba(45,106,45,0.06)', border: '2px solid #2d6a2d', borderRadius: 2, p: 2.5 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: '#2d6a2d', letterSpacing: 2 }}>
            ✓ {T(lang, 'IMPERDIBLE CONFIRMADO', 'LOCK CONFIRMED')} ⚽
          </Typography>
          <Typography sx={{ fontWeight: 900, fontSize: 26, mt: 0.5 }}>{lock.pick}</Typography>
          <Typography sx={{ color: MUTED, fontSize: 13 }}>
            {lock.matchup} · {lock.marketType}
            {lock.odds != null ? ` · ${lock.odds > 0 ? '+' : ''}${lock.odds}` : ''}
            {lock.league ? ` · ${lock.league}` : ''}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4,1fr)' }, gap: 2, mt: 2 }}>
            <Metric label={T(lang, 'Convicción', 'Conviction')} value={fmtPct(lock.conviction)} big />
            <Metric label={T(lang, 'Consenso', 'Consensus')} value={fmtPct(lock.consensusProb)} />
            <Metric label="Modelo / Mercado / Shadow" value={`${fmtPct(lock.components?.modelProb)} · ${fmtPct(lock.components?.impliedProb)} · ${fmtPct(lock.components?.shadowProb)}`} small />
            <Metric label={T(lang, 'Stake sugerido', 'Suggested stake')} value={lock.recommendedStakeFraction != null ? `${(lock.recommendedStakeFraction * 100).toFixed(1)}% ${T(lang, 'banca', 'bankroll')}` : '—'} />
          </Box>

          <Box sx={{ mt: 2 }}><ConvictionBar value={lock.conviction} /></Box>

          {lock.headline  && <Typography sx={{ mt: 2, fontWeight: 700, fontSize: 15 }}>{lock.headline}</Typography>}
          {lock.rationale && <Typography sx={{ color: MUTED, fontSize: 13, mt: 0.5 }}>{lock.rationale}</Typography>}

          {result.arbiter?.disqualifiers_checked?.length > 0 && (
            <Box sx={{ mt: 1.5, display: 'flex', gap: 0.7, flexWrap: 'wrap' }}>
              {result.arbiter.disqualifiers_checked.map((d, i) => (
                <Chip key={i} size="small" label={d} sx={{ height: 20, fontSize: 10, fontFamily: MONO, color: MUTED, border: `1px solid var(--border)`, bgcolor: 'transparent' }} />
              ))}
            </Box>
          )}
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: MUTED, mt: 1.5 }}>
            {T(lang, 'Árbitro', 'Arbiter')}: {result.arbiter?.model} · conf {fmtPct(result.arbiter?.confidence)}
            {result.savedPickId ? ` · pick #${result.savedPickId}` : ''}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ bgcolor: 'rgba(255,176,32,0.06)', border: `2px solid var(--warning)`, borderRadius: 2, p: 2.5 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 11, color: AMBER, letterSpacing: 2 }}>
            ⊘ {T(lang, 'SIN IMPERDIBLE HOY', 'NO LOCK TODAY')}
          </Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 18, mt: 0.5 }}>
            {result.arbiter?.headline || REASON_TEXT(result.reason, lang)}
          </Typography>
          {result.arbiter?.rationale && <Typography sx={{ color: MUTED, fontSize: 13, mt: 0.5 }}>{result.arbiter.rationale}</Typography>}
          {result.bestRejected && (
            <Typography sx={{ color: MUTED, fontSize: 12, fontFamily: MONO, mt: 1 }}>
              {T(lang, 'Mejor rechazado', 'Best rejected')}: {result.bestRejected.pick}
              · conv {fmtPct(result.bestRejected.conviction)}
              · {(result.bestRejected.gate?.failedReasons || []).join(', ')}
            </Typography>
          )}
        </Box>
      )}

      {Array.isArray(result.slate) && result.slate.length > 0 && (
        <Box sx={{ mt: 2, bgcolor: SURF, border: `1px solid var(--border)`, borderRadius: 2, p: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: 12, color: MUTED, mb: 1 }}>
            {T(lang, 'SLATE ANALIZADO', 'ANALYZED SLATE')} ({result.slate.length})
          </Typography>
          {result.slate.slice(0, 15).map((c) => (
            <Box key={c.candidateId} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.6, borderBottom: `1px solid var(--border)` }}>
              <Typography sx={{ fontFamily: MONO, fontSize: 12, minWidth: 50, color: (c.gate?.pass ? GREEN : MUTED) }}>
                {fmtPct(c.conviction)}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.pick}</Typography>
                <Typography sx={{ fontSize: 10, color: MUTED, fontFamily: MONO }}>
                  {c.matchup} · {c.marketType} · cons {fmtPct(c.consensusProb)}
                  {!c.gate?.pass && c.gate?.failedReasons?.length ? ` · ✗ ${c.gate.failedReasons[0]}` : ''}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

function REASON_TEXT(reason, lang) {
  const map = {
    no_games_found:  T(lang, 'No se encontraron partidos.', 'No matches found.'),
    no_candidates:   T(lang, 'Sin candidatos en el slate.', 'No candidates in the slate.'),
    gate_not_cleared: T(lang, 'Ningún candidato cruzó el umbral de convicción.', 'No candidate cleared the conviction gate.'),
    arbiter_veto:    T(lang, 'El árbitro vetó todos los candidatos.', 'The arbiter vetoed all candidates.'),
    model_not_certified: T(lang, 'Modelo soccer no entrenado aún — sin lock.', 'Soccer model not trained yet — no lock.'),
  };
  return map[reason] || reason;
}

function Metric({ label, value, big, small, color }) {
  return (
    <Box>
      <Typography sx={{ fontFamily: MONO, fontSize: 10, color: MUTED, letterSpacing: 1 }}>{label}</Typography>
      <Typography sx={{ fontWeight: 800, fontSize: big ? 28 : small ? 13 : 18, color: color ?? (big ? GREEN : 'var(--ink-0)') }}>
        {value}
      </Typography>
    </Box>
  );
}

function HistoryView({ history, lang }) {
  const eq   = (history.equity && history.equity.summary) || {};
  const runs = history.runs || [];
  return (
    <Box sx={{ bgcolor: SURF, border: `1px solid var(--border)`, borderRadius: 2, p: 2 }}>
      <Typography sx={{ fontFamily: MONO, fontSize: 12, color: '#2d6a2d', letterSpacing: 2, mb: 1.5 }}>
        {T(lang, 'HISTORIAL & EQUITY', 'HISTORY & EQUITY')}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5,1fr)' }, gap: 2, mb: 2 }}>
        <Metric label="W-L-P" value={`${eq.wins ?? 0}-${eq.losses ?? 0}-${eq.pushes ?? 0}`}
          color={(eq.wins ?? 0) > (eq.losses ?? 0) ? GREEN : (eq.losses ?? 0) > (eq.wins ?? 0) ? RED : 'var(--ink-0)'} />
        <Metric label={T(lang, 'Aciertos', 'Hit rate')} value={fmtPct(eq.winRate)}
          color={(eq.winRate ?? 0) >= 0.6 ? GREEN : (eq.winRate ?? 0) < 0.5 ? RED : AMBER} />
        <Metric label="ROI" value={fmtPct(eq.roi)}
          color={(eq.roi ?? 0) > 0 ? GREEN : (eq.roi ?? 0) < 0 ? RED : 'var(--ink-0)'} />
        <Metric label={T(lang, 'Unidades', 'Units')} value={eq.unitProfit != null ? `${eq.unitProfit >= 0 ? '+' : ''}${Number(eq.unitProfit).toFixed(2)}u` : '—'}
          color={eq.unitProfit != null ? (eq.unitProfit > 0 ? GREEN : eq.unitProfit < 0 ? RED : 'var(--ink-0)') : MUTED} />
        <Metric label="Max DD" value={eq.maxDrawdown != null ? `${Number(eq.maxDrawdown).toFixed(2)}u` : '—'}
          color={eq.maxDrawdown != null && eq.maxDrawdown < 0 ? RED : 'var(--ink-0)'} />
      </Box>
      {runs.map((r) => (
        <Box key={r.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.6, borderBottom: `1px solid var(--border)` }}>
          <Chip
            size="small"
            label={r.verdict === 'CONFIRM' ? 'LOCK' : 'PASS'}
            sx={{ height: 18, fontSize: 9, fontFamily: MONO, color: r.verdict === 'CONFIRM' ? GREEN : MUTED, border: `1px solid ${r.verdict === 'CONFIRM' ? GREEN : 'var(--border)'}`, bgcolor: 'transparent' }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.pick || r.headline || REASON_TEXT(r.reason, lang)}
            </Typography>
            <Typography sx={{ fontSize: 10, color: MUTED, fontFamily: MONO }}>
              {r.matchup ? `${r.matchup}${r.league ? ` · ${r.league}` : ''}` : `${r.slate_size} ${T(lang, 'partidos', 'matches')}`}
              {' · '}conv {fmtPct(r.conviction)} · {String(r.created_at).slice(0, 10)}
            </Typography>
          </Box>
          {r.result && r.result !== 'pending' && (
            <Typography sx={{ fontFamily: MONO, fontSize: 12, fontWeight: 800, color: /win|won/i.test(r.result) ? GREEN : /loss|lost/i.test(r.result) ? RED : MUTED }}>
              {r.result.toUpperCase()}
            </Typography>
          )}
        </Box>
      ))}
      {runs.length === 0 && (
        <Typography sx={{ color: MUTED, fontFamily: MONO, fontSize: 13 }}>
          {T(lang, 'Sin corridas todavía.', 'No runs yet.')}
        </Typography>
      )}
    </Box>
  );
}
