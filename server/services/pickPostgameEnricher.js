/**
 * pickPostgameEnricher.js
 * Fills actual game scores into pick_features rows that have a result
 * but are missing home_score / away_score.
 *
 * Call enrichResolvedPickFeatures() after resolving a pick, or run
 * nightly as a background job to patch historical gaps.
 */

import pool from '../db.js';
import { getLiveGameData } from '../live-feed.js';

const BATCH_SIZE = 20;
const DELAY_MS = 300; // polite delay between MLB API calls

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Enrich a single pick_features row using live/final game data from MLB API.
 * Returns true if the row was updated, false if the game wasn't final yet.
 */
export async function enrichPickFeatureRow(row) {
  let feed;
  try {
    feed = await getLiveGameData(row.game_pk);
  } catch (err) {
    console.warn(`[pick-enricher] MLB API error for game ${row.game_pk}: ${err.message}`);
    return false;
  }

  if (feed.status !== 'final') return false;

  const homeScore = feed.home?.score ?? null;
  const awayScore = feed.away?.score ?? null;
  const totalRuns = homeScore != null && awayScore != null ? homeScore + awayScore : null;
  const winnerId = homeScore != null && awayScore != null
    ? (homeScore > awayScore ? feed.home?.id : feed.away?.id)
    : null;
  const gameStatus = feed.detailedState ?? 'Final';

  await pool.query(`
    UPDATE pick_features SET
      home_score = $1,
      away_score = $2,
      total_runs = $3,
      winner_team_id = $4,
      game_status = $5
    WHERE id = $6
      AND home_score IS NULL
  `, [homeScore, awayScore, totalRuns, winnerId, gameStatus, row.id]);

  return true;
}

/**
 * Finds pick_features rows that are resolved but lack game scores, then
 * fetches those scores from the MLB Stats API.
 *
 * @param {object} opts
 * @param {number} [opts.limit=100]  - max rows to process per call
 * @param {boolean} [opts.dryRun]   - log only, no writes
 * @returns {Promise<{processed: number, updated: number, skipped: number}>}
 */
export async function enrichResolvedPickFeatures({ limit = 100, dryRun = false } = {}) {
  const { rows } = await pool.query(`
    SELECT pf.id, pf.game_pk, pf.game_date, pf.result, pf.pick_id
    FROM pick_features pf
    WHERE pf.result IS NOT NULL
      AND pf.home_score IS NULL
      AND pf.game_pk IS NOT NULL
    ORDER BY pf.game_date ASC NULLS LAST
    LIMIT $1
  `, [limit]);

  if (rows.length === 0) {
    console.log('[pick-enricher] No rows to enrich');
    return { processed: 0, updated: 0, skipped: 0 };
  }

  // Deduplicate by game_pk — one MLB API call per unique game
  const byGame = new Map();
  for (const row of rows) {
    if (!byGame.has(row.game_pk)) byGame.set(row.game_pk, []);
    byGame.get(row.game_pk).push(row);
  }

  let updated = 0;
  let skipped = 0;

  for (const [gamePk, gameRows] of byGame) {
    let feed;
    try {
      feed = await getLiveGameData(gamePk);
    } catch (err) {
      console.warn(`[pick-enricher] MLB API error for game ${gamePk}: ${err.message}`);
      skipped += gameRows.length;
      await sleep(DELAY_MS);
      continue;
    }

    if (feed.status !== 'final') {
      skipped += gameRows.length;
      await sleep(DELAY_MS);
      continue;
    }

    const homeScore = feed.home?.score ?? null;
    const awayScore = feed.away?.score ?? null;
    const totalRuns = homeScore != null && awayScore != null ? homeScore + awayScore : null;
    const winnerId = homeScore != null && awayScore != null
      ? (homeScore > awayScore ? feed.home?.id : feed.away?.id)
      : null;
    const gameStatus = feed.detailedState ?? 'Final';

    if (dryRun) {
      console.log(`[pick-enricher] DRY RUN game=${gamePk} home=${homeScore} away=${awayScore} total=${totalRuns} winner=${winnerId} rows=${gameRows.length}`);
      updated += gameRows.length;
      await sleep(DELAY_MS);
      continue;
    }

    // Batch-update all rows for this game in one query
    const ids = gameRows.map(r => r.id);
    await pool.query(`
      UPDATE pick_features SET
        home_score = $1,
        away_score = $2,
        total_runs = $3,
        winner_team_id = $4,
        game_status = $5
      WHERE id = ANY($6::int[])
        AND home_score IS NULL
    `, [homeScore, awayScore, totalRuns, winnerId, gameStatus, ids]);

    console.log(`[pick-enricher] game=${gamePk} home=${homeScore} away=${awayScore} → updated ${gameRows.length} row(s)`);
    updated += gameRows.length;
    await sleep(DELAY_MS);
  }

  console.log(`[pick-enricher] done — processed=${rows.length} updated=${updated} skipped=${skipped}`);
  return { processed: rows.length, updated, skipped };
}
