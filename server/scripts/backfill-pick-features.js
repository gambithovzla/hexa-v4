import dotenv from 'dotenv';
import pool from '../db.js';
import { getTodayGames } from '../mlb-api.js';
import { buildContext } from '../context-builder.js';
import { refreshCache, getCacheStatus } from '../savant-fetcher.js';
import { savePickFeatures } from '../feature-store.js';

dotenv.config();

function normalizeDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value).trim();
  if (!str) return null;
  const match = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function shiftDateString(dateString, days) {
  const [year, month, day] = String(dateString).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return shifted.toISOString().slice(0, 10);
}

function buildDateCandidates(preferredDate) {
  const resolved = normalizeDateInput(preferredDate);
  if (!resolved) return [];
  return [...new Set([
    resolved,
    shiftDateString(resolved, -1),
    shiftDateString(resolved, 1),
  ])];
}

function parseArgs(argv) {
  const out = { dryRun: false, limit: null, refresh: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--no-refresh') out.refresh = false;
    else if (arg === '--limit') out.limit = Number(argv[i + 1]) || null, i++;
  }
  return out;
}

function buildOddsData(row) {
  const odds = {};

  if (row.odds_ml_home != null || row.odds_ml_away != null) {
    odds.moneyline = {
      home: row.odds_ml_home != null ? Number(row.odds_ml_home) : null,
      away: row.odds_ml_away != null ? Number(row.odds_ml_away) : null,
    };
  }

  if (row.odds_ou_total != null) {
    odds.overUnder = {
      total: Number(row.odds_ou_total),
    };
  }

  return Object.keys(odds).length ? { odds } : null;
}

function calcAvgXwoba(batters = []) {
  const withData = batters.filter((b) => b?.savant?.xwOBA != null);
  if (!withData.length) return null;
  return withData.reduce((sum, b) => sum + b.savant.xwOBA, 0) / withData.length;
}

async function findGameForFeatureRow(gamePk, gameDate) {
  const dateCandidates = buildDateCandidates(gameDate);
  for (const date of dateCandidates) {
    const games = await getTodayGames(date);
    const gameData = games.find((g) => String(g.gamePk) === String(gamePk));
    if (gameData) return { gameData, matchedDate: date };
  }
  return { gameData: null, matchedDate: normalizeDateInput(gameDate) };
}

async function main() {
  const { dryRun, limit, refresh } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for backfill');
  }

  console.log(`[backfill] Starting pick_features backfill${dryRun ? ' (dry-run)' : ''}...`);

  if (refresh) {
    console.log('[backfill] Refreshing Savant cache before processing...');
    await refreshCache();
    console.log('[backfill] Savant cache:', JSON.stringify(getCacheStatus()));
  }

  const params = [];
  let limitClause = '';
  if (limit != null && Number.isFinite(limit) && limit > 0) {
    params.push(limit);
    limitClause = `LIMIT $${params.length}`;
  }

  const { rows } = await pool.query(`
    SELECT
      pf.id,
      pf.pick_id,
      pf.backtest_id,
      pf.game_pk,
      pf.game_date,
      pf.pick,
      pf.result,
      pf.odds_ml_home,
      pf.odds_ml_away,
      pf.odds_ou_total
    FROM pick_features pf
    WHERE pf.home_pitcher_xwoba IS NULL
      AND pf.away_pitcher_xwoba IS NULL
      AND pf.home_pitcher_whiff IS NULL
      AND pf.away_pitcher_whiff IS NULL
      AND pf.home_lineup_avg_xwoba IS NULL
      AND pf.away_lineup_avg_xwoba IS NULL
    ORDER BY pf.game_date DESC, pf.id DESC
    ${limitClause}
  `, params);

  console.log(`[backfill] Rows queued: ${rows.length}`);

  let updated = 0;
  let previewed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const label = `pf#${row.id} game=${row.game_pk} date=${normalizeDateInput(row.game_date)}`;

    if (!row.pick_id && !row.backtest_id) {
      console.warn(`[backfill] Skipping ${label} — no pick_id/backtest_id link`);
      skipped++;
      continue;
    }

    try {
      const { gameData, matchedDate } = await findGameForFeatureRow(row.game_pk, row.game_date);
      if (!gameData) {
        console.warn(`[backfill] Skipping ${label} — game not found in MLB schedule lookup`);
        skipped++;
        continue;
      }

      const oddsData = buildOddsData(row);
      const contextResult = await buildContext(gameData, oddsData);
      const features = contextResult?._features ?? {};

      const preview = {
        home_pitcher_xwoba: features.homePitcherSavant?.xwOBA_against ?? null,
        away_pitcher_xwoba: features.awayPitcherSavant?.xwOBA_against ?? null,
        home_pitcher_whiff: features.homePitcherSavant?.whiff_percent ?? null,
        away_pitcher_whiff: features.awayPitcherSavant?.whiff_percent ?? null,
        home_lineup_avg_xwoba: calcAvgXwoba(features.savantBatters?.home ?? []),
        away_lineup_avg_xwoba: calcAvgXwoba(features.savantBatters?.away ?? []),
      };

      console.log(`[backfill] ${label} -> ${JSON.stringify(preview)}`);

      if (dryRun) {
        previewed++;
        continue;
      }

      await savePickFeatures({
        pickId: row.pick_id,
        backtestId: row.backtest_id,
        gamePk: Number(row.game_pk),
        gameDate: matchedDate,
        ...features,
        oddsData: features.oddsData ?? oddsData,
        pick: row.pick,
        result: row.result,
      });

      updated++;
    } catch (err) {
      console.warn(`[backfill] Failed ${label}: ${err.message}`);
      failed++;
    }
  }

  const summary = dryRun
    ? `[backfill] Done. previewed=${previewed} skipped=${skipped} failed=${failed}`
    : `[backfill] Done. updated=${updated} skipped=${skipped} failed=${failed}`;
  console.log(summary);
  await pool.end();
}

main().catch(async (err) => {
  console.error('[backfill] Fatal:', err.message);
  try {
    await pool.end();
  } catch {}
  process.exitCode = 1;
});
