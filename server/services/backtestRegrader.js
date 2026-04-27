/**
 * backtestRegrader.js — shared regrade logic for player-prop rows in
 * `backtest_results`. Used by the CLI script (scripts/regrade-backtest-props.js)
 * and the admin endpoint that powers the dashboard button.
 *
 * Historical bug: rows were graded by a loose Over/Under regex that compared
 * the prop's line against game total runs (e.g. "Wilyer Abreu Over 1.5 Total
 * Bases" compared 1.5 to home+away score → almost always WIN). This module
 * pre-filters likely props, fetches the GUMBO boxscore once per game, runs
 * resolvePlayerProp, and reports / writes the corrections.
 */

import { getGameBoxscore, resolvePlayerProp } from '../props-resolver.js';

const STAT_TOKENS = '(?:total\\s+bases?|tb|bases\\s+totales|strikeouts?|ks?|ponches?|hits?|home\\s+runs?|hrs?|jonrones?|cuadrangulares?|rbis?|carreras?\\s+impulsadas?|stolen\\s+bases?|sbs?|bases?\\s+robadas?|walks?|bbs?|bases?\\s+por\\s+bolas?|runs?\\s+scored|carreras?\\s+anotadas?)';
const DIRECTIONS = '(?:over|under|m[aá]s\\s+de|menos\\s+de)';
const RE_DIR_FIRST = new RegExp(`\\b${DIRECTIONS}\\s+\\d+\\.?\\d*\\s+${STAT_TOKENS}\\b`, 'i');
const RE_STAT_FIRST = new RegExp(`\\b${STAT_TOKENS}\\s+${DIRECTIONS}\\s+\\d+\\.?\\d*\\b`, 'i');

/**
 * Same heuristic the runtime grader uses (server/index.js#looksLikePlayerProp)
 * — kept duplicated here intentionally to avoid coupling this admin/cli flow
 * to the request-handling module.
 */
export function looksLikePlayerProp(pickStr) {
  if (!pickStr) return false;
  const s = String(pickStr);
  return RE_DIR_FIRST.test(s) || RE_STAT_FIRST.test(s);
}

function buildScanQuery({ from, to, runId, limit }) {
  const where = [];
  const params = [];
  if (from)  { params.push(from);  where.push(`historical_date >= $${params.length}`); }
  if (to)    { params.push(to);    where.push(`historical_date <= $${params.length}`); }
  if (runId) { params.push(runId); where.push(`run_id = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limitSql = limit ? `LIMIT ${parseInt(limit, 10)}` : '';
  return {
    sql: `
      SELECT id, run_id, historical_date, game_pk, matchup, pick, pick_type, actual_result
      FROM backtest_results
      ${whereSql}
      ORDER BY historical_date DESC, id ASC
      ${limitSql}
    `,
    params,
  };
}

/**
 * Run the regrade pass.
 *
 * @param {object}  opts
 * @param {object}  opts.pool      pg Pool instance
 * @param {boolean} opts.apply     when true, write the corrected result/pick_type
 * @param {string=} opts.from      historical_date >= (YYYY-MM-DD)
 * @param {string=} opts.to        historical_date <= (YYYY-MM-DD)
 * @param {string=} opts.runId     restrict to a single backtest run
 * @param {number=} opts.limit     cap rows scanned
 * @param {function=} opts.onLog   optional logger ({level, msg}) → use console by default
 * @param {number=} opts.maxMismatchExamples default 50
 *
 * @returns {Promise<{
 *   stats: { scanned, propsScanned, resolved, unresolved, matchesStored, mismatches, updated, storedNullNowResolved },
 *   mismatches: Array<{ id, date, matchup, pick, stored, regraded, actualStat, line, propType }>,
 *   apply: boolean,
 * }>}
 */
export async function regradeBacktestProps({
  pool,
  apply = false,
  from = null,
  to = null,
  runId = null,
  limit = null,
  onLog = null,
  maxMismatchExamples = 50,
} = {}) {
  if (!pool) throw new Error('regradeBacktestProps: pool is required');
  const log = (level, msg) => {
    if (onLog) { onLog({ level, msg }); return; }
    if (level === 'warn') console.warn(msg); else console.log(msg);
  };

  const { sql, params } = buildScanQuery({ from, to, runId, limit });
  const { rows } = await pool.query(sql, params);
  log('info', `[regrade] scanning ${rows.length} backtest_results row(s) (apply=${apply})`);

  const propRows = rows.filter(r => looksLikePlayerProp(r.pick));
  log('info', `[regrade] ${propRows.length} look like player props (others skipped)`);

  const boxscoreCache = new Map();
  async function getBoxscore(gamePk) {
    if (!gamePk) return null;
    const key = String(gamePk);
    if (boxscoreCache.has(key)) return boxscoreCache.get(key);
    try {
      const data = await getGameBoxscore(gamePk);
      boxscoreCache.set(key, data);
      return data;
    } catch (err) {
      log('warn', `[regrade] boxscore fetch failed for game_pk=${gamePk}: ${err.message}`);
      boxscoreCache.set(key, null);
      return null;
    }
  }

  const stats = {
    scanned: rows.length,
    propsScanned: propRows.length,
    resolved: 0,
    unresolved: 0,
    matchesStored: 0,
    mismatches: 0,
    updated: 0,
    storedNullNowResolved: 0,
  };
  const mismatches = [];

  for (const r of propRows) {
    const players = await getBoxscore(r.game_pk);
    if (!players) {
      stats.unresolved++;
      continue;
    }
    const propResult = resolvePlayerProp(r.pick, players);
    if (!propResult || !propResult.result) {
      stats.unresolved++;
      continue;
    }
    stats.resolved++;
    const newPickType = `prop_${propResult.propType}`;

    if (r.actual_result == null) stats.storedNullNowResolved++;

    if (propResult.result === r.actual_result && newPickType === r.pick_type) {
      stats.matchesStored++;
      continue;
    }

    stats.mismatches++;
    if (mismatches.length < maxMismatchExamples) {
      mismatches.push({
        id: r.id,
        date: r.historical_date,
        matchup: r.matchup,
        pick: r.pick,
        stored: r.actual_result,
        regraded: propResult.result,
        actualStat: propResult.actual,
        line: propResult.line,
        propType: propResult.propType,
      });
    }

    if (apply) {
      await pool.query(
        `UPDATE backtest_results
            SET actual_result = $1,
                pick_type     = $2
          WHERE id = $3`,
        [propResult.result, newPickType, r.id]
      );
      stats.updated++;
    }
  }

  return { stats, mismatches, apply };
}
