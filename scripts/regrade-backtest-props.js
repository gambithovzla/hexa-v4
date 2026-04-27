/**
 * regrade-backtest-props.js — Re-grades player-prop rows in `backtest_results`
 * that were stored with the wrong `actual_result` due to the historical bug
 * where the loose Over/Under regex compared a prop's line against the game
 * total runs (e.g. "Wilyer Abreu Over 1.5 Total Bases" graded vs total runs).
 *
 * Strategy:
 *   1. Scan rows whose `pick` looks like a player prop.
 *   2. Fetch the boxscore once per game_pk and resolve via resolvePlayerProp.
 *   3. Compare the resolver's verdict to the stored `actual_result`.
 *   4. By default print a dry-run report. Pass --apply to write the fix.
 *
 * Usage:
 *   node scripts/regrade-backtest-props.js                  # dry-run, all rows
 *   node scripts/regrade-backtest-props.js --apply          # actually update
 *   node scripts/regrade-backtest-props.js --from 2026-04-01
 *   node scripts/regrade-backtest-props.js --to   2026-04-30
 *   node scripts/regrade-backtest-props.js --run-id <uuid>  # single backtest run
 *   node scripts/regrade-backtest-props.js --limit 50       # cap rows scanned
 *
 * Requires DATABASE_URL.
 */

import pg from 'pg';
import { getGameBoxscore, resolvePlayerProp } from '../server/props-resolver.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable required');
  process.exit(1);
}

// Same heuristic the backtest grader now uses to short-circuit prop picks.
// Kept in sync with looksLikePlayerProp() in server/index.js.
const STAT_TOKENS = '(?:total\\s+bases?|tb|bases\\s+totales|strikeouts?|ks?|ponches?|hits?|home\\s+runs?|hrs?|jonrones?|cuadrangulares?|rbis?|carreras?\\s+impulsadas?|stolen\\s+bases?|sbs?|bases?\\s+robadas?|walks?|bbs?|bases?\\s+por\\s+bolas?|runs?\\s+scored|carreras?\\s+anotadas?)';
const DIRECTIONS = '(?:over|under|m[aá]s\\s+de|menos\\s+de)';
const RE_DIR_FIRST = new RegExp(`\\b${DIRECTIONS}\\s+\\d+\\.?\\d*\\s+${STAT_TOKENS}\\b`, 'i');
const RE_STAT_FIRST = new RegExp(`\\b${STAT_TOKENS}\\s+${DIRECTIONS}\\s+\\d+\\.?\\d*\\b`, 'i');

function looksLikePlayerProp(pickStr) {
  if (!pickStr) return false;
  const s = String(pickStr);
  return RE_DIR_FIRST.test(s) || RE_STAT_FIRST.test(s);
}

function parseArgs(argv) {
  const args = { apply: false, from: null, to: null, runId: null, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--run-id') args.runId = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
  }
  return args;
}

function buildQuery(args) {
  const where = [];
  const params = [];
  if (args.from)  { params.push(args.from);  where.push(`historical_date >= $${params.length}`); }
  if (args.to)    { params.push(args.to);    where.push(`historical_date <= $${params.length}`); }
  if (args.runId) { params.push(args.runId); where.push(`run_id = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limitSql = args.limit ? `LIMIT ${args.limit}` : '';
  const sql = `
    SELECT id, run_id, historical_date, game_pk, matchup, pick, pick_type, actual_result
    FROM backtest_results
    ${whereSql}
    ORDER BY historical_date DESC, id ASC
    ${limitSql}
  `;
  return { sql, params };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log(`[regrade] mode=${args.apply ? 'APPLY' : 'dry-run'}`);
  if (args.from)  console.log(`[regrade] from=${args.from}`);
  if (args.to)    console.log(`[regrade] to=${args.to}`);
  if (args.runId) console.log(`[regrade] run_id=${args.runId}`);
  if (args.limit) console.log(`[regrade] limit=${args.limit}`);

  const { sql, params } = buildQuery(args);
  const { rows } = await pool.query(sql, params);
  console.log(`[regrade] scanning ${rows.length} backtest_results row(s)`);

  // Pre-filter to prop picks only — cheap regex pass.
  const propRows = rows.filter(r => looksLikePlayerProp(r.pick));
  console.log(`[regrade] ${propRows.length} row(s) look like player props (others skipped)`);

  // Cache boxscores per game_pk.
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
      console.warn(`[regrade] boxscore fetch failed for game_pk=${gamePk}: ${err.message}`);
      boxscoreCache.set(key, null);
      return null;
    }
  }

  const stats = {
    scanned: propRows.length,
    resolved: 0,
    unresolved: 0,
    matchesStored: 0,
    mismatches: 0,
    updated: 0,
    storedNullNowResolved: 0,
  };

  const mismatchExamples = [];

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

    if (r.actual_result == null) {
      stats.storedNullNowResolved++;
    }

    if (propResult.result === r.actual_result && newPickType === r.pick_type) {
      stats.matchesStored++;
      continue;
    }

    stats.mismatches++;
    if (mismatchExamples.length < 20) {
      mismatchExamples.push({
        id: r.id,
        date: r.historical_date,
        matchup: r.matchup,
        pick: r.pick,
        stored: r.actual_result,
        regraded: propResult.result,
        actualStat: propResult.actual,
        line: propResult.line,
      });
    }

    if (args.apply) {
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

  console.log('');
  console.log('────────────────────── REGRADE SUMMARY ──────────────────────');
  console.log(`Scanned (prop picks):           ${stats.scanned}`);
  console.log(`Resolved against boxscore:      ${stats.resolved}`);
  console.log(`Unresolvable (no box / player): ${stats.unresolved}`);
  console.log(`Already correct (match stored): ${stats.matchesStored}`);
  console.log(`Mismatches (would change):      ${stats.mismatches}`);
  console.log(`  of which stored=NULL → graded: ${stats.storedNullNowResolved}`);
  console.log(`Rows updated this run:          ${stats.updated}${args.apply ? '' : '  (dry-run; pass --apply to write)'}`);
  console.log('─────────────────────────────────────────────────────────────');

  if (mismatchExamples.length > 0) {
    console.log('');
    console.log('First mismatches (up to 20):');
    for (const e of mismatchExamples) {
      console.log(`  [${e.date}] ${e.matchup} :: "${e.pick}"`);
      console.log(`    stored=${e.stored ?? 'NULL'}  regraded=${e.regraded}  actual=${e.actualStat} vs line ${e.line}`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error('[regrade] fatal:', err);
  process.exit(1);
});
