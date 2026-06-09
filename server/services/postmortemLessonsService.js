import pool from '../db.js';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
let _cache = null;
let _cacheTs = 0;

/**
 * Aggregates adjustment_signals from recent MLB postmortems.
 * Returns top signals weighted by frequency.
 */
export async function getRecentLessons({ sport = 'mlb', days = 30, maxLessons = 6 } = {}) {
  const now = Date.now();
  if (_cache && now - _cacheTs < CACHE_TTL_MS) return _cache;

  try {
    const { rows } = await pool.query(
      `SELECT postmortem
       FROM picks
       WHERE sport = $1
         AND postmortem IS NOT NULL
         AND postmortem->>'adjustment_signals' IS NOT NULL
         AND created_at > NOW() - ($2 || ' days')::INTERVAL
         AND result IN ('win', 'loss', 'push')
       ORDER BY created_at DESC
       LIMIT 80`,
      [sport, String(days)]
    );

    // Count signal frequency
    const freq = new Map();
    for (const row of rows) {
      const signals = row.postmortem?.adjustment_signals;
      if (!Array.isArray(signals)) continue;
      for (const sig of signals) {
        const clean = String(sig ?? '').trim();
        if (clean.length < 10) continue;
        // Normalize: lowercase first 60 chars as grouping key
        const key = clean.toLowerCase().slice(0, 60);
        if (!freq.has(key)) freq.set(key, { text: clean, count: 0 });
        freq.get(key).count += 1;
      }
    }

    // Sort by frequency, take top N
    const sorted = [...freq.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, maxLessons);

    _cache = sorted;
    _cacheTs = now;
    return sorted;
  } catch (err) {
    console.warn('[lessons] getRecentLessons failed:', err.message);
    return [];
  }
}

/**
 * Builds the LESSONS LEARNED context block for the Oracle.
 */
export async function buildLessonsBlock(sport = 'mlb') {
  const lessons = await getRecentLessons({ sport });
  if (!lessons.length) return null;

  const lines = ['=== ORACLE LESSONS LEARNED (from recent postmortem analysis) ==='];
  lines.push('These patterns were extracted from analyzing recent picks in this system. Use them to calibrate confidence and avoid known failure modes:');
  for (const l of lessons) {
    const freq = l.count > 1 ? ` [seen ${l.count}x]` : '';
    lines.push(`• ${l.text}${freq}`);
  }
  lines.push('ORACLE INSTRUCTION: When any lesson above is directly relevant to this game\'s matchup, factor it into your confidence. Recurring lessons with count > 2 are strong calibration signals.');
  return lines.join('\n');
}
