/**
 * calibrationBlockService.js — closes the calibration→Oracle feedback loop.
 *
 * Renders an ORACLE CALIBRATION RECORD context block: stated confidence vs
 * actual win rate per market+bucket over resolved picks. The block carries
 * its own ORACLE INSTRUCTION (same pattern as the bullpen/lessons blocks),
 * so it works for the frozen MLB prompt without touching it.
 *
 * Never throws; returns '' when no bucket has enough sample. Cache 2h.
 */

import pool from '../db.js';

const MIN_BUCKET_SAMPLE = 15;
const DRIFT_THRESHOLD_PCT = 4;
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const _cache = new Map();

export function renderCalibrationBlock(rows, { sport = 'mlb' } = {}) {
  const qualifying = (rows ?? []).filter((r) => Number(r.n) >= MIN_BUCKET_SAMPLE);
  if (qualifying.length === 0) return '';

  const lines = qualifying.map((r) => {
    const stated = Number(r.statedAvg);
    const actual = Number(r.winRate);
    const delta = actual - stated;
    let verdict = '✓ calibrated';
    if (delta <= -DRIFT_THRESHOLD_PCT) verdict = `⚠ OVERCONFIDENT (${delta.toFixed(1)})`;
    else if (delta >= DRIFT_THRESHOLD_PCT) verdict = `↑ underconfident (+${delta.toFixed(1)})`;
    return `- ${r.market} | stated avg ${stated.toFixed(1)}% (bucket ${r.bucket}) → actual win rate ${actual.toFixed(1)}% over ${r.n} picks ${verdict}`;
  });

  return [
    '═══════════════════════════════════════════',
    `ORACLE CALIBRATION RECORD (${sport.toUpperCase()})`,
    '═══════════════════════════════════════════',
    `Your own stated confidence vs actual results on resolved picks (buckets with n ≥ ${MIN_BUCKET_SAMPLE}):`,
    ...lines,
    '',
    'ORACLE INSTRUCTION: Anchor your confidence to this record, not to narrative',
    'strength. If your pick lands in a bucket marked OVERCONFIDENT, state a',
    'confidence at or below the ACTUAL win rate shown for that bucket — never',
    'above it. Buckets marked underconfident may justify the upper end of your',
    'range. This record reflects your real-world accuracy; respect it.',
  ].join('\n');
}

export async function getCalibrationRows(sport) {
  const { rows } = await pool.query(
    `SELECT COALESCE(pf.market_type, 'all') AS market,
            CASE
              WHEN p.oracle_confidence >= 65 THEN '65-70'
              WHEN p.oracle_confidence >= 60 THEN '60-64'
              WHEN p.oracle_confidence >= 55 THEN '55-59'
              ELSE '50-54'
            END AS bucket,
            COUNT(*) AS n,
            ROUND(AVG(p.oracle_confidence), 1) AS stated_avg,
            ROUND(100.0 * SUM(CASE WHEN LOWER(p.result) IN ('win','won') THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate
     FROM picks p
     LEFT JOIN pick_features pf ON pf.pick_id = p.id
     WHERE COALESCE(p.sport, 'mlb') = $1
       AND p.deleted_at IS NULL
       AND LOWER(p.result) IN ('win','won','loss','lost')
       AND p.oracle_confidence IS NOT NULL
     GROUP BY 1, 2
     HAVING COUNT(*) >= ${MIN_BUCKET_SAMPLE}
     ORDER BY 1, 2`,
    [sport]
  );
  return rows.map((r) => ({
    market: r.market,
    bucket: r.bucket,
    n: Number(r.n),
    statedAvg: Number(r.stated_avg),
    winRate: Number(r.win_rate),
  }));
}

export async function buildCalibrationBlock(sport = 'mlb') {
  const now = Date.now();
  const cached = _cache.get(sport);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.block;

  try {
    const rows = await getCalibrationRows(sport);
    const block = renderCalibrationBlock(rows, { sport });
    _cache.set(sport, { block, ts: now });
    if (block) console.log(`[calibration-block] ${sport}: ${rows.length} qualifying buckets`);
    return block;
  } catch (err) {
    console.warn(`[calibration-block] ${sport} failed: ${err.message}`);
    return '';
  }
}
