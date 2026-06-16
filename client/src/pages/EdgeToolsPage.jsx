/**
 * EdgeToolsPage.jsx — bettor edge tools that don't depend on model quality.
 *
 *   Line Shop    — best price per game across books + EV vs consensus.
 *   Sharp Money  — where the line is moving (RLM / steam), sorted by strength.
 *
 * Both read from auth-only, read-only endpoints (/api/line-shop, /api/sharp-money).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Typography, Chip, CircularProgress, Button, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { MONO, DISPLAY } from '../theme';

const API_URL  = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const BG       = 'var(--bg-0)';
const SURFACE  = 'var(--bg-1)';
const SURFACE2 = 'var(--bg-2)';
const BORDER   = 'var(--border)';
const CYAN     = 'var(--neon-cyan)';
const GREEN    = 'var(--neon-green)';
const RED      = 'var(--neon-pink)';
const AMBER    = 'var(--warning)';
const MUTED    = 'var(--ink-2)';
const INK1     = 'var(--ink-1)';
const INK0     = 'var(--ink-0)';

const STRINGS = {
  es: {
    title: 'EDGE TOOLS', back: '← Volver',
    lineShop: 'LINE SHOP', sharpMoney: 'SHARP MONEY',
    date: 'Fecha',
    lineShopDesc: 'Mejor precio por casa para cada apuesta. Conseguir -145 en vez de -155 es EV gratis — no necesitas ganarle a la probabilidad de Vegas, solo al precio promedio.',
    sharpDesc: 'Dónde se mueve la línea: reverse line movement, steam y movimientos grandes. El dinero inteligente es una de las pocas señales que anticipan el cierre.',
    noLineShop: 'Sin juegos con odds para esta fecha.',
    noSharp: 'Sin señales de dinero inteligente para esta fecha.',
    bestPrice: 'Mejor precio', book: 'Casa', evGained: 'EV vs consenso',
    sharpSide: 'Lado sharp', strength: 'Fuerza', signals: 'Señales',
    avgEdge: 'EV promedio', maxEdge: 'EV máx', games: 'juegos', signalsCount: 'señales',
    loadErr: 'No se pudo cargar.',
    tierStrong: 'FUERTE', tierModerate: 'MODERADO', tierWeak: 'DÉBIL',
  },
  en: {
    title: 'EDGE TOOLS', back: '← Back',
    lineShop: 'LINE SHOP', sharpMoney: 'SHARP MONEY',
    date: 'Date',
    lineShopDesc: 'Best price per book for each bet. Getting -145 instead of -155 is free EV — you don\'t need to beat Vegas\'s probability, just the average price.',
    sharpDesc: 'Where the line is moving: reverse line movement, steam, and large moves. Sharp money is one of the few signals that anticipates the close.',
    noLineShop: 'No games with odds for this date.',
    noSharp: 'No sharp-money signals for this date.',
    bestPrice: 'Best price', book: 'Book', evGained: 'EV vs consensus',
    sharpSide: 'Sharp side', strength: 'Strength', signals: 'Signals',
    avgEdge: 'Avg EV', maxEdge: 'Max EV', games: 'games', signalsCount: 'signals',
    loadErr: 'Failed to load.',
    tierStrong: 'STRONG', tierModerate: 'MODERATE', tierWeak: 'WEAK',
  },
};

const MARKET_LABEL = {
  moneyline: 'ML', overUnder: 'O/U', runLine: 'RL',
};

function fmtOdds(v) {
  if (v == null) return '—';
  return v > 0 ? `+${v}` : String(v);
}
function fmtEdge(v) {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
}
function todayISO() {
  return new Date().toISOString().split('T')[0];
}

export default function EdgeToolsPage({ token, onBack, lang = 'es' }) {
  const T = STRINGS[lang] ?? STRINGS.es;
  const [tab, setTab] = useState('lineShop');
  const [date, setDate] = useState(todayISO());
  const [lineShop, setLineShop] = useState(null);
  const [sharp, setSharp] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const endpoint = tab === 'lineShop' ? 'line-shop' : 'sharp-money';
      const r = await fetch(`${API_URL}/api/${endpoint}?date=${date}`, { headers });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || 'error');
      if (tab === 'lineShop') setLineShop(j);
      else setSharp(j);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [tab, date, headers]);

  useEffect(() => { load(); }, [load]);

  return (
    <Box sx={{ minHeight: '100vh', background: BG, color: INK0, p: { xs: 2, md: 4 } }}>
      <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.6rem', fontWeight: 700, color: CYAN, letterSpacing: '2px' }}>
            {T.title}
          </Typography>
          <Button onClick={onBack} sx={{ fontFamily: MONO, fontSize: '11px', color: MUTED }}>{T.back}</Button>
        </Box>

        {/* Tabs */}
        <ToggleButtonGroup
          exclusive value={tab}
          onChange={(_, v) => v && setTab(v)}
          sx={{ mb: 2 }}
        >
          {['lineShop', 'sharpMoney'].map(k => (
            <ToggleButton key={k} value={k === 'sharpMoney' ? 'sharpMoney' : 'lineShop'}
              sx={{
                fontFamily: MONO, fontSize: '11px', letterSpacing: '2px', color: MUTED,
                border: `1px solid ${BORDER}`, px: 2,
                '&.Mui-selected': { color: CYAN, background: `${CYAN}14`, borderColor: CYAN },
              }}>
              {k === 'lineShop' ? T.lineShop : T.sharpMoney}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {/* Date */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, letterSpacing: '1px' }}>{T.date}:</Typography>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ background: SURFACE, color: INK0, border: `1px solid ${BORDER}`, fontFamily: MONO, fontSize: '12px', padding: '4px 8px' }} />
        </Box>

        <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: MUTED, mb: 2, lineHeight: 1.5 }}>
          {tab === 'lineShop' ? T.lineShopDesc : T.sharpDesc}
        </Typography>

        {loading && <Box sx={{ textAlign: 'center', py: 6 }}><CircularProgress size={28} sx={{ color: CYAN }} /></Box>}
        {err && !loading && <Typography sx={{ fontFamily: MONO, fontSize: '12px', color: RED }}>{T.loadErr} ({err})</Typography>}

        {!loading && !err && tab === 'lineShop' && <LineShopView data={lineShop} T={T} />}
        {!loading && !err && tab === 'sharpMoney' && <SharpMoneyView data={sharp} T={T} />}
      </Box>
    </Box>
  );
}

// ── Line Shop ────────────────────────────────────────────────────────────────
function LineShopView({ data, T }) {
  if (!data?.games?.length) return <Empty text={T.noLineShop} />;
  return (
    <>
      <SummaryBar items={[
        [`${data.summary.gameCount}`, T.games],
        [fmtEdge(data.summary.avgEdgePts), T.avgEdge],
        [fmtEdge(data.summary.maxEdgePts), T.maxEdge],
      ]} />
      {data.games.map((g, i) => (
        <Box key={g.eventId || i} sx={{ background: SURFACE, border: `1px solid ${BORDER}`, p: 2, mb: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography sx={{ fontFamily: DISPLAY, fontSize: '1rem', fontWeight: 700, color: INK0 }}>{g.matchup}</Typography>
            {g.maxEdgePts > 0 && (
              <Chip label={`${T.maxEdge} ${fmtEdge(g.maxEdgePts)}`} size="small"
                sx={{ fontFamily: MONO, fontSize: '9px', color: GREEN, border: `1px solid ${GREEN}`, background: `${GREEN}14`, height: 20 }} />
            )}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
            {g.outcomes.map((o, j) => (
              <Box key={j} sx={{ background: SURFACE2, border: `1px solid ${BORDER}`, p: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: MUTED, letterSpacing: '1px' }}>
                    {MARKET_LABEL[o.market] || o.market}
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '12px', color: INK1 }}>{o.label}</Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: CYAN }}>{o.book}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.05rem', fontWeight: 700, color: INK0 }}>{fmtOdds(o.price)}</Typography>
                  {o.edgeVsConsensusPts != null && (
                    <Typography sx={{ fontFamily: MONO, fontSize: '9px', color: o.edgeVsConsensusPts > 0 ? GREEN : MUTED }}>
                      {fmtEdge(o.edgeVsConsensusPts)}
                    </Typography>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </>
  );
}

// ── Sharp Money ──────────────────────────────────────────────────────────────
const TIER_COLOR = { strong: GREEN, moderate: AMBER, weak: MUTED };
function SharpMoneyView({ data, T }) {
  if (!data?.games?.length) return <Empty text={T.noSharp} />;
  const tierLabel = (t) => t === 'strong' ? T.tierStrong : t === 'moderate' ? T.tierModerate : T.tierWeak;
  return (
    <>
      <SummaryBar items={[
        [`${data.summary.gameCount}`, T.games],
        [`${data.summary.signalCount}`, T.signalsCount],
        [`${data.summary.strongCount ?? 0}`, T.tierStrong],
      ]} />
      {data.games.map((g, i) => (
        <Box key={i} sx={{ background: SURFACE, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${TIER_COLOR[g.tier]}`, p: 2, mb: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Typography sx={{ fontFamily: DISPLAY, fontSize: '1rem', fontWeight: 700, color: INK0 }}>{g.matchup}</Typography>
            <Chip label={`${tierLabel(g.tier)} · ${g.score}`} size="small"
              sx={{ fontFamily: MONO, fontSize: '9px', color: TIER_COLOR[g.tier], border: `1px solid ${TIER_COLOR[g.tier]}`, background: `${TIER_COLOR[g.tier]}14`, height: 20 }} />
          </Box>
          {g.sharpSide && (
            <Typography sx={{ fontFamily: MONO, fontSize: '11px', color: INK1, mb: 0.5 }}>
              {T.sharpSide}: <span style={{ color: TIER_COLOR[g.tier] }}>{g.sharpSide}</span>
            </Typography>
          )}
          <Typography sx={{ fontFamily: MONO, fontSize: '10px', color: MUTED, lineHeight: 1.5 }}>
            {g.reasons.join(' · ')}
          </Typography>
        </Box>
      ))}
    </>
  );
}

// ── Shared ───────────────────────────────────────────────────────────────────
function SummaryBar({ items }) {
  return (
    <Box sx={{ display: 'flex', gap: 3, mb: 2, flexWrap: 'wrap' }}>
      {items.map(([val, label], i) => (
        <Box key={i}>
          <Typography sx={{ fontFamily: DISPLAY, fontSize: '1.2rem', fontWeight: 700, color: INK0 }}>{val}</Typography>
          <Typography sx={{ fontFamily: MONO, fontSize: '8px', color: MUTED, letterSpacing: '1px', textTransform: 'uppercase' }}>{label}</Typography>
        </Box>
      ))}
    </Box>
  );
}
function Empty({ text }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6 }}>
      <Typography sx={{ fontFamily: MONO, fontSize: '12px', color: MUTED }}>{text}</Typography>
    </Box>
  );
}
