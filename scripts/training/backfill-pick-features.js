#!/usr/bin/env node
/**
 * backfill-pick-features.js
 * Fills missing columns on historical pick_features rows:
 *   - home_score / away_score / total_runs / winner_team_id / game_status (from MLB API)
 *   - market_type / side / line / prop_kind (from pick text via pickParser)
 *   - source flag (defaults to 'live' for pre-existing rows that lack it)
 *
 * Usage:
 *   node scripts/training/backfill-pick-features.js
 *   node scripts/training/backfill-pick-features.js --dry-run
 *   node scripts/training/backfill-pick-features.js --scores-only
 *   node scripts/training/backfill-pick-features.js --parse-only
 *   node scripts/training/backfill-pick-features.js --batch 50
 */

import 'dotenv/config';
import pool from '../../server/db.js';
import { enrichResolvedPickFeatures } from '../../server/services/pickPostgameEnricher.js';
import { parsePick } from '../../server/parsers/pickParser.js';

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SCORES_ONLY = args.includes('--scores-only');
const PARSE_ONLY = args.includes('--parse-only');
const batchArg = args.find(a => a.startsWith('--batch='));
const BATCH = batchArg ? parseInt(batchArg.split('=')[1], 10) : 200;

console.log(`[backfill] Starting — dry_run=${DRY_RUN} scores_only=${SCORES_ONLY} parse_only=${PARSE_ONLY} batch=${BATCH}`);

// ── Phase 1: Backfill game scores ─────────────────────────────────────────
async function backfillScores() {
  console.log('\n[backfill] Phase 1: filling game scores from MLB API...');
  const { processed, updated, skipped } = await enrichResolvedPickFeatures({
    limit: BATCH,
    dryRun: DRY_RUN,
  });
  console.log(`[backfill] scores — processed=${processed} updated=${updated} skipped=${skipped}`);
}

// ── Phase 2: Parse pick text → structured fields ──────────────────────────
async function backfillParsedPick() {
  console.log('\n[backfill] Phase 2: parsing pick text → market_type / side / line / prop_kind...');

  const { rows } = await pool.query(`
    SELECT pf.id, pf.pick, p.matchup
    FROM pick_features pf
    LEFT JOIN picks p ON p.id = pf.pick_id
    WHERE pf.market_type IS NULL
      AND pf.pick IS NOT NULL
    LIMIT $1
  `, [BATCH]);

  console.log(`[backfill] ${rows.length} rows need pick parsing`);
  if (rows.length === 0) return;

  let updated = 0;
  for (const row of rows) {
    // Infer home/away from matchup string "AWAY @ HOME" or "HOME vs AWAY"
    const ctx = extractTeamCtx(row.matchup);
    const parsed = parsePick(row.pick, ctx);

    if (!parsed.market_type) continue; // can't parse, skip

    if (DRY_RUN) {
      console.log(`[backfill] DRY RUN id=${row.id} pick="${row.pick}" → market=${parsed.market_type} side=${parsed.side} line=${parsed.line} kind=${parsed.prop_kind}`);
      updated++;
      continue;
    }

    await pool.query(`
      UPDATE pick_features SET
        market_type     = $1,
        side            = $2,
        line            = $3,
        prop_kind       = $4
      WHERE id = $5
        AND market_type IS NULL
    `, [parsed.market_type, parsed.side, parsed.line, parsed.prop_kind, row.id]);

    updated++;
  }

  console.log(`[backfill] parsed pick text for ${updated}/${rows.length} rows`);
}

// ── Phase 3: Set source = 'live' on rows that predate the source column ───
async function backfillSource() {
  console.log('\n[backfill] Phase 3: setting source = \'live\' on pre-existing rows...');

  if (DRY_RUN) {
    const { rows } = await pool.query(`SELECT COUNT(*) AS n FROM pick_features WHERE source IS NULL`);
    console.log(`[backfill] DRY RUN — would update ${rows[0].n} rows to source='live'`);
    return;
  }

  const res = await pool.query(`
    UPDATE pick_features SET source = 'live'
    WHERE source IS NULL
  `);
  console.log(`[backfill] updated ${res.rowCount} rows to source='live'`);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function extractTeamCtx(matchup) {
  if (!matchup) return {};
  // "NYY @ BOS" or "NYY vs BOS"
  const m = String(matchup).match(/([A-Z]{2,3})\s*(?:@|vs\.?)\s*([A-Z]{2,3})/i);
  if (!m) return {};
  const [, team1, team2] = m;
  const isAtFormat = String(matchup).includes('@');
  return isAtFormat
    ? { awayAbbr: team1.toUpperCase(), homeAbbr: team2.toUpperCase() }
    : { homeAbbr: team1.toUpperCase(), awayAbbr: team2.toUpperCase() };
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  try {
    if (!PARSE_ONLY) await backfillScores();
    if (!SCORES_ONLY) await backfillParsedPick();
    if (!SCORES_ONLY && !PARSE_ONLY) await backfillSource();
    console.log('\n[backfill] Done.');
  } catch (err) {
    console.error('[backfill] Fatal error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
