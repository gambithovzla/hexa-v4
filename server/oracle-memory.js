/**
 * oracle-memory.js — Feedback loop for Oracle learning
 *
 * Queries resolved picks (real + backtest) and builds a "memory block"
 * that gets injected into the Oracle's context so it learns from past results.
 *
 * The Oracle receives:
 * - Overall hit rate by bet type
 * - Confidence calibration (predicted vs actual)
 * - Common failure patterns
 * - Recent streak data
 */

import pool from './db.js';

/**
 * Builds the Oracle Memory Block from resolved picks and backtests.
 * Returns a string to inject into the Oracle's context.
 */
export async function buildOracleMemory() {
  try {
    // 1. Overall performance from REAL picks
    const realStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE result = 'win') as wins,
        COUNT(*) FILTER (WHERE result = 'loss') as losses,
        COUNT(*) FILTER (WHERE result = 'push') as pushes,
        COUNT(*) FILTER (WHERE result IN ('win','loss')) as resolved
      FROM picks
      WHERE result IN ('win','loss','push') AND deleted_at IS NULL
    `);

    // 2. Performance by bet type from REAL picks
    const byType = await pool.query(`
      SELECT
        CASE
          WHEN pick ILIKE '%moneyline%' OR pick ILIKE '%ML%' THEN 'Moneyline'
          WHEN pick ILIKE '%under%' THEN 'Under'
          WHEN pick ILIKE '%over%' THEN 'Over'
          WHEN pick ILIKE '%run line%' OR pick ILIKE '%RL%' THEN 'Run Line'
          WHEN pick ILIKE '%hits%' OR pick ILIKE '%bases%' OR pick ILIKE '%strikeout%' OR pick ILIKE '%HR%' THEN 'Player Prop'
          ELSE 'Other'
        END as bet_type,
        COUNT(*) FILTER (WHERE result = 'win') as wins,
        COUNT(*) FILTER (WHERE result = 'loss') as losses,
        COUNT(*) FILTER (WHERE result IN ('win','loss')) as total
      FROM picks
      WHERE result IN ('win','loss') AND deleted_at IS NULL
      GROUP BY bet_type
      HAVING COUNT(*) FILTER (WHERE result IN ('win','loss')) >= 2
    `);

    // 3. Confidence calibration from ALL resolved picks (real + backtest)
    const calibration = await pool.query(`
      SELECT bucket, wins, total,
        CASE WHEN total > 0 THEN ROUND((wins::numeric / total) * 100, 1) ELSE 0 END as actual_rate
      FROM (
        SELECT
          CASE
            WHEN oracle_confidence >= 65 THEN '65-70%'
            WHEN oracle_confidence >= 60 THEN '60-64%'
            WHEN oracle_confidence >= 55 THEN '55-59%'
            WHEN oracle_confidence >= 50 THEN '50-54%'
            ELSE 'under 50%'
          END as bucket,
          COUNT(*) FILTER (WHERE result = 'win' OR actual_result = 'win') as wins,
          COUNT(*) as total
        FROM (
          SELECT oracle_confidence, result, NULL as actual_result FROM picks
          WHERE result IN ('win','loss') AND deleted_at IS NULL AND oracle_confidence IS NOT NULL
          UNION ALL
          SELECT oracle_confidence, NULL as result, actual_result FROM backtest_results
          WHERE actual_result IN ('win','loss') AND oracle_confidence IS NOT NULL
        ) combined
        GROUP BY bucket
      ) buckets
      ORDER BY bucket
    `);

    // 4. Recent 10 picks performance (real only)
    const recentPicks = await pool.query(`
      SELECT pick, result, oracle_confidence, matchup,
        CASE
          WHEN pick ILIKE '%moneyline%' OR pick ILIKE '%ML%' THEN 'ML'
          WHEN pick ILIKE '%under%' THEN 'U'
          WHEN pick ILIKE '%over%' THEN 'O'
          WHEN pick ILIKE '%run line%' OR pick ILIKE '%RL%' THEN 'RL'
          ELSE 'PROP'
        END as type_short
      FROM picks
      WHERE result IN ('win','loss') AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // 5. Backtest aggregate performance
    const btStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE actual_result = 'win') as wins,
        COUNT(*) FILTER (WHERE actual_result = 'loss') as losses,
        COUNT(*) FILTER (WHERE actual_result IN ('win','loss')) as resolved
      FROM backtest_results
    `);

    // Build the memory block string
    const lines = ['=== ORACLE PERFORMANCE MEMORY (LEARN FROM THIS) ==='];
    lines.push('USE THIS DATA TO CALIBRATE YOUR CONFIDENCE. This is YOUR track record.');
    lines.push('');

    // Real picks stats
    const rs = realStats.rows[0];
    if (rs && parseInt(rs.resolved) > 0) {
      const wr = ((parseInt(rs.wins) / parseInt(rs.resolved)) * 100).toFixed(1);
      lines.push(`REAL PICKS RECORD: ${rs.wins}W-${rs.losses}L (${wr}% win rate, ${rs.resolved} resolved)`);
    } else {
      lines.push('REAL PICKS RECORD: No resolved picks yet');
    }

    // Backtest stats
    const bt = btStats.rows[0];
    if (bt && parseInt(bt.resolved) > 0) {
      const bwr = ((parseInt(bt.wins) / parseInt(bt.resolved)) * 100).toFixed(1);
      lines.push(`BACKTEST RECORD: ${bt.wins}W-${bt.losses}L (${bwr}% win rate, ${bt.resolved} resolved)`);
    }
    lines.push('');

    // By bet type
    if (byType.rows.length > 0) {
      lines.push('PERFORMANCE BY BET TYPE:');
      for (const row of byType.rows) {
        const total = parseInt(row.total);
        const wr = total > 0 ? ((parseInt(row.wins) / total) * 100).toFixed(1) : 'N/A';
        lines.push(`  ${row.bet_type}: ${row.wins}W-${row.losses}L (${wr}%) ${parseFloat(wr) < 50 ? '← UNDERPERFORMING — reduce confidence for this type' : parseFloat(wr) >= 60 ? '← STRONG — lean into this type' : ''}`);
      }
      lines.push('');
    }

    // Calibration
    if (calibration.rows.length > 0) {
      lines.push('CONFIDENCE CALIBRATION (predicted vs actual):');
      for (const row of calibration.rows) {
        const predicted = row.bucket;
        const actual = row.actual_rate;
        const total = parseInt(row.total);
        if (total >= 3) {
          const gap = parseFloat(actual) - parseFloat(predicted.split('-')[0]);
          const direction = gap > 5 ? 'UNDERCONFIDENT — you can be bolder' : gap < -5 ? 'OVERCONFIDENT — reduce your estimates' : 'CALIBRATED';
          lines.push(`  Predicted ${predicted}: Actual ${actual}% hit rate (${total} picks) → ${direction}`);
        }
      }
      lines.push('');
    }

    // Recent streak
    if (recentPicks.rows.length > 0) {
      const recentRecord = recentPicks.rows.reduce((acc, p) => {
        if (p.result === 'win') acc.w++;
        else acc.l++;
        return acc;
      }, { w: 0, l: 0 });
      lines.push(`LAST ${recentPicks.rows.length} PICKS: ${recentRecord.w}W-${recentRecord.l}L`);
      const streak = recentPicks.rows.map(p => `${p.type_short}:${p.result === 'win' ? 'W' : 'L'}`).join(', ');
      lines.push(`  Sequence: ${streak}`);

      // Detect patterns
      const recentLosses = recentPicks.rows.filter(p => p.result === 'loss');
      const lossTypes = {};
      recentLosses.forEach(p => { lossTypes[p.type_short] = (lossTypes[p.type_short] || 0) + 1; });
      const worstType = Object.entries(lossTypes).sort((a, b) => b[1] - a[1])[0];
      if (worstType && worstType[1] >= 3) {
        lines.push(`  ⚠ PATTERN: ${worstType[1]} recent losses in ${worstType[0]} — consider avoiding or reducing confidence for this bet type`);
      }
      lines.push('');
    }

    lines.push('INSTRUCTIONS: Use this data to adjust your confidence levels. If a bet type is underperforming, reduce confidence by 5-10% for that type. If calibration shows you are overconfident in a range, lower your estimates. If a specific pattern keeps losing, flag it in alert_flags.');
    lines.push('=== END ORACLE MEMORY ===');

    const memoryBlock = lines.join('\n');
    console.log(`[oracle-memory] Built memory block: ${parseInt(rs?.resolved ?? 0)} real picks, ${parseInt(bt?.resolved ?? 0)} backtest picks`);
    return memoryBlock;

  } catch (err) {
    console.warn('[oracle-memory] Failed to build memory:', err.message);
    return '=== ORACLE PERFORMANCE MEMORY ===\nNo historical data available yet.\n=== END ORACLE MEMORY ===';
  }
}
