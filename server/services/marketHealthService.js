/**
 * marketHealthService.js — closes the effectiveness feedback loop.
 *
 * The system already captures closing-line value (picks.clv) and realized win
 * rate per market, but those signals were read-only (CLV report + Bet Card gate)
 * — the Oracle never saw them, so it kept emitting picks at full confidence on
 * markets the market was systematically fading. This service turns that history
 * into a graduated per-market verdict (healthy / caution / degrade) and a context
 * block the Oracle reads, so a market with sustained negative CLV raises the
 * conviction bar at *generation* time instead of only being filtered afterward.
 *
 * Pure verdict logic is unit-tested; the DB reader is cached + never throws.
 */

import pool from '../db.js';

// CLV is stored in percentage points (closing implied prob − pick-time implied
// prob): positive = the market moved toward our side after we bet = real edge.
export const MARKET_HEALTH_THRESHOLDS = {
  minClvSample: 25,
  minWinRateSample: 25,
  degradeClv: -1.5,   // sustained loss of 1.5+ CLV points = the market fades us
  cautionClv: -0.5,
  healthyClv: 0.5,
  badWinRate: 45,     // win rate this low escalates to degrade
  weakWinRate: 48,
  strongWinRate: 55,
};

const _SEVERITY = { healthy: 0, neutral: 1, caution: 2, degrade: 3 };
const _BY_RANK = ['healthy', 'neutral', 'caution', 'degrade'];

function escalate(current, target) {
  return _BY_RANK[Math.max(_SEVERITY[current], _SEVERITY[target])];
}

/**
 * Classify one market's health from its rolling CLV + win rate.
 *
 * @param {{ avgClv:number|null, clvN:number, observedWinRate:number|null, winRateN:number }} stats
 * @param {object} [thresholds]
 * @returns {{ verdict:'healthy'|'caution'|'degrade'|'neutral', reason:string }}
 */
export function classifyMarketHealth(
  { avgClv, clvN = 0, observedWinRate, winRateN = 0 } = {},
  thresholds = MARKET_HEALTH_THRESHOLDS,
) {
  const haveClv = clvN >= thresholds.minClvSample && avgClv != null && Number.isFinite(avgClv);
  const haveWr = winRateN >= thresholds.minWinRateSample && observedWinRate != null && Number.isFinite(observedWinRate);

  let verdict = 'neutral';
  const reasons = [];

  if (haveClv) {
    if (avgClv <= thresholds.degradeClv) verdict = 'degrade';
    else if (avgClv < thresholds.cautionClv) verdict = 'caution';
    else if (avgClv >= thresholds.healthyClv) verdict = 'healthy';
    reasons.push(`avg CLV ${avgClv >= 0 ? '+' : ''}${avgClv.toFixed(1)}pts over ${clvN}`);
  }

  if (haveWr) {
    if (observedWinRate < thresholds.badWinRate) verdict = escalate(verdict, 'degrade');
    else if (observedWinRate < thresholds.weakWinRate) verdict = escalate(verdict, 'caution');
    else if (verdict === 'neutral' && observedWinRate >= thresholds.strongWinRate) verdict = 'healthy';
    reasons.push(`win rate ${observedWinRate.toFixed(0)}% over ${winRateN}`);
  }

  return { verdict, reason: reasons.length ? reasons.join(', ') : 'insufficient sample' };
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const _cache = new Map(); // sport → { _ts, health }

/**
 * Per-market health for a sport over the recent window, keyed by market_type.
 * Cached 1h; returns {} on any DB error (the context block is non-essential).
 *
 * @param {string} sport
 * @returns {Promise<Object<string,{verdict,reason,avgClv,clvN,observedWinRate,winRateN}>>}
 */
export async function getMarketHealth(sport = 'mlb', { windowDays = 120 } = {}) {
  const now = Date.now();
  const cached = _cache.get(sport);
  if (cached && now - cached._ts < CACHE_TTL_MS) return cached.health;

  try {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(pf.market_type, 'unknown') AS market_type,
         AVG(p.clv) AS avg_clv,
         COUNT(p.clv) AS clv_n,
         100.0 * AVG(CASE WHEN p.result = 'win' THEN 1 WHEN p.result = 'loss' THEN 0 END) AS win_rate,
         COUNT(*) FILTER (WHERE p.result IN ('win','loss')) AS winrate_n
       FROM picks p
       LEFT JOIN pick_features pf ON pf.pick_id = p.id
       WHERE COALESCE(p.sport, 'mlb') = $1
         AND p.deleted_at IS NULL
         AND p.created_at > NOW() - ($2 || ' days')::interval
       GROUP BY 1`,
      [sport, String(windowDays)],
    );

    const health = {};
    for (const r of rows) {
      if (!r.market_type || r.market_type === 'unknown') continue;
      const avgClv = r.avg_clv != null ? Number(r.avg_clv) : null;
      const clvN = Number(r.clv_n) || 0;
      const observedWinRate = r.win_rate != null ? Number(r.win_rate) : null;
      const winRateN = Number(r.winrate_n) || 0;
      const { verdict, reason } = classifyMarketHealth({ avgClv, clvN, observedWinRate, winRateN });
      health[r.market_type] = { verdict, reason, avgClv, clvN, observedWinRate, winRateN };
    }
    _cache.set(sport, { _ts: now, health });
    return health;
  } catch (err) {
    console.warn(`[market-health] getMarketHealth(${sport}) failed: ${err.message}`);
    return cached?.health ?? {};
  }
}

const _VERDICT_TAG = {
  degrade: '⚠ DEGRADE',
  caution: '◐ CAUTION',
  healthy: '✓ HEALTHY',
};

const _MARKET_LABEL = {
  moneyline: 'MONEYLINE',
  overunder: 'OVER/UNDER',
  runline: 'RUN LINE',
  prop: 'PLAYER PROPS',
};

/**
 * Render the market-health context block. Only surfaces markets with an
 * actionable verdict (degrade/caution/healthy) — neutral/low-sample markets are
 * omitted so the Oracle isn't flooded with non-signal. Returns '' when nothing
 * is actionable.
 *
 * @param {Object<string,{verdict,reason}>} health
 * @returns {string}
 */
export function buildMarketHealthBlock(health = {}) {
  const actionable = Object.entries(health).filter(([, h]) => h.verdict && h.verdict !== 'neutral');
  if (!actionable.length) return '';

  // Most severe first.
  actionable.sort((a, b) => _SEVERITY[b[1].verdict] - _SEVERITY[a[1].verdict]);

  const lines = [
    '=== MARKET HEALTH (model feedback loop — recent CLV + win rate) ===',
    'CLV = how far the market moved toward our pick after we bet (positive = real edge).',
  ];
  for (const [market, h] of actionable) {
    const label = _MARKET_LABEL[market] ?? market.toUpperCase();
    lines.push(`- ${label}: ${_VERDICT_TAG[h.verdict] ?? h.verdict} — ${h.reason}`);
  }
  lines.push(
    'ORACLE INSTRUCTION: For any market flagged DEGRADE, raise the conviction bar — only emit a pick when the edge is strong and multiple independent signals agree; otherwise prefer a different market or PASS. For CAUTION, trim confidence ~3-5%. HEALTHY markets need no adjustment.',
  );
  return lines.join('\n');
}
