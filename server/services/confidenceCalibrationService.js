import pool from '../db.js';

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h
const _cache = new Map(); // key: `${sport}_${market}` → calibration table

/**
 * Returns the historically calibrated win rate for a given market+confidence bucket.
 * Falls back to raw Oracle confidence if insufficient data.
 *
 * @param {object} opts
 * @param {string} opts.sport
 * @param {string} opts.marketType  - 'moneyline'|'overunder'|'runline'|'prop'|null
 * @param {number} opts.rawConfidence - Oracle raw confidence (50-70)
 * @returns {Promise<{ calibrated: number, sampleSize: number, bucket: string }>}
 */
export async function getCalibratedConfidence({ sport = 'mlb', marketType = null, rawConfidence }) {
  if (!rawConfidence) return { calibrated: rawConfidence, sampleSize: 0, bucket: null };

  const cacheKey = `${sport}_${marketType ?? 'all'}`;
  const now = Date.now();

  let table = _cache.get(cacheKey);
  if (!table || now - table._ts > CACHE_TTL_MS) {
    table = await _loadCalibrationTable(sport, marketType);
    table._ts = now;
    _cache.set(cacheKey, table);
  }

  const bucket = getBucket(rawConfidence);
  const row = table[bucket];
  if (!row || row.n < 15) {
    return { calibrated: rawConfidence, sampleSize: row?.n ?? 0, bucket };
  }

  // Shrinkage: blend observed win rate toward raw Oracle confidence
  // More data → more weight on observed; less data → stay closer to Oracle
  const priorWeight = Math.max(0, 1 - row.n / 200); // at 200+ samples, pure observed
  const calibrated = Math.round(
    priorWeight * rawConfidence + (1 - priorWeight) * row.winRatePct
  );

  // Clamp to [45, 72] — don't go below 45 or above cap
  return {
    calibrated: Math.min(72, Math.max(45, calibrated)),
    sampleSize: row.n,
    bucket,
    observedWinRate: row.winRatePct,
  };
}

function getBucket(conf) {
  if (conf >= 65) return '65-70';
  if (conf >= 60) return '60-64';
  if (conf >= 55) return '55-59';
  return '50-54';
}

async function _loadCalibrationTable(sport, marketType) {
  try {
    const marketFilter = marketType
      ? `AND pf.market_type = '${marketType.replace(/'/g, "''")}'`
      : '';
    const { rows } = await pool.query(
      `SELECT
         CASE
           WHEN p.oracle_confidence >= 65 THEN '65-70'
           WHEN p.oracle_confidence >= 60 THEN '60-64'
           WHEN p.oracle_confidence >= 55 THEN '55-59'
           ELSE '50-54'
         END AS bucket,
         COUNT(*) AS n,
         ROUND(100.0 * SUM(CASE WHEN p.result = 'win' THEN 1 ELSE 0 END) / COUNT(*), 1) AS win_rate
       FROM picks p
       LEFT JOIN pick_features pf ON pf.pick_id = p.id
       WHERE p.sport = $1
         AND p.result IN ('win','loss')
         AND p.oracle_confidence IS NOT NULL
         ${marketFilter}
       GROUP BY 1`,
      [sport]
    );

    const table = {};
    for (const r of rows) {
      table[r.bucket] = { n: Number(r.n), winRatePct: Number(r.win_rate) };
    }
    return table;
  } catch (err) {
    console.warn('[calibration] _loadCalibrationTable failed:', err.message);
    return {};
  }
}
