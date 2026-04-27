/**
 * regrade-backtest-props.js — Re-grades player-prop rows in `backtest_results`
 * that were stored with the wrong `actual_result` (historical bug graded prop
 * picks against game total runs).
 *
 * Thin CLI wrapper around server/services/backtestRegrader.js. The same logic
 * powers the admin dashboard button.
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
import { regradeBacktestProps } from '../server/services/backtestRegrader.js';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable required');
  process.exit(1);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log(`[regrade] mode=${args.apply ? 'APPLY' : 'dry-run'}`);
  if (args.from)  console.log(`[regrade] from=${args.from}`);
  if (args.to)    console.log(`[regrade] to=${args.to}`);
  if (args.runId) console.log(`[regrade] run_id=${args.runId}`);
  if (args.limit) console.log(`[regrade] limit=${args.limit}`);

  const { stats, mismatches } = await regradeBacktestProps({
    pool,
    apply: args.apply,
    from: args.from,
    to: args.to,
    runId: args.runId,
    limit: args.limit,
    maxMismatchExamples: 20,
  });

  console.log('');
  console.log('────────────────────── REGRADE SUMMARY ──────────────────────');
  console.log(`Rows scanned (all picks):        ${stats.scanned}`);
  console.log(`Rows scanned (looks like prop):  ${stats.propsScanned}`);
  console.log(`Resolved against boxscore:       ${stats.resolved}`);
  console.log(`Unresolvable (no box / player):  ${stats.unresolved}`);
  console.log(`Already correct (match stored):  ${stats.matchesStored}`);
  console.log(`Mismatches (would change):       ${stats.mismatches}`);
  console.log(`  of which stored=NULL → graded:  ${stats.storedNullNowResolved}`);
  console.log(`Rows updated this run:           ${stats.updated}${args.apply ? '' : '  (dry-run; pass --apply to write)'}`);
  console.log('─────────────────────────────────────────────────────────────');

  if (mismatches.length > 0) {
    console.log('');
    console.log(`First ${mismatches.length} mismatches:`);
    for (const e of mismatches) {
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
