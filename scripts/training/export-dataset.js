#!/usr/bin/env node
/**
 * export-dataset.js
 * Exports pick_features JOIN picks to a CSV file (and optionally Parquet)
 * ready for Python ML training.
 *
 * Usage:
 *   node scripts/training/export-dataset.js
 *   node scripts/training/export-dataset.js --from=2025-01-01
 *   node scripts/training/export-dataset.js --from=2025-01-01 --to=2025-12-31
 *   node scripts/training/export-dataset.js --source=live
 *   node scripts/training/export-dataset.js --market=moneyline
 *   node scripts/training/export-dataset.js --resolved-only
 *   node scripts/training/export-dataset.js --out=data/my-dataset.csv
 *
 * Output columns (43 total):
 *   Meta: id, pick_id, backtest_id, game_pk, game_date, source, created_at
 *   Pick: pick, market_type, side, line, prop_kind, prop_player_id
 *   Oracle: oracle_confidence, oracle_model, prompt_version, kelly_fraction
 *   Pitcher: home/away pitcher xwoba, whiff, k_pct, era, days_rest, pitches_last_start
 *   Bullpen: home/away bullpen_pitches_last_3d
 *   Hitting: home/away team_ops, lineup_avg_xwoba
 *   Park/Weather: park_factor_overall, park_factor_hr, temperature, wind_speed
 *   Context: is_day_game, is_dome, game_number_in_series, umpire_id
 *   Quality: data_quality_score, signal_coherence_score
 *   Odds: odds_ml_home, odds_ml_away, odds_ou_total
 *   Outcome: home_score, away_score, total_runs, winner_team_id, game_status, result
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pool from '../../server/db.js';

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argMap = {};
for (const a of args) {
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    argMap[k] = v ?? true;
  }
}

const FROM_DATE    = argMap.from    ?? null;
const TO_DATE      = argMap.to      ?? null;
const SOURCE       = argMap.source  ?? null;
const MARKET       = argMap.market  ?? null;
const RESOLVED_ONLY = argMap['resolved-only'] === true || argMap['resolved-only'] === 'true';
const OUT_PATH     = argMap.out     ?? `data/picks-dataset-${new Date().toISOString().slice(0, 10)}.csv`;

// ── Query ──────────────────────────────────────────────────────────────────
const COLUMNS = [
  // Meta
  'pf.id', 'pf.pick_id', 'pf.backtest_id', 'pf.game_pk', 'pf.game_date',
  'pf.source', 'pf.created_at',
  // Pick (structured)
  'pf.pick', 'pf.market_type', 'pf.side', 'pf.line',
  'pf.prop_kind', 'pf.prop_player_id',
  // Oracle metadata
  'pf.oracle_confidence', 'pf.oracle_model', 'pf.prompt_version', 'pf.kelly_fraction',
  // Pitcher features
  'pf.home_pitcher_xwoba', 'pf.away_pitcher_xwoba',
  'pf.home_pitcher_whiff', 'pf.away_pitcher_whiff',
  'pf.home_pitcher_k_pct', 'pf.away_pitcher_k_pct',
  'pf.home_pitcher_era', 'pf.away_pitcher_era',
  'pf.home_pitcher_days_rest', 'pf.away_pitcher_days_rest',
  'pf.home_pitcher_pitches_last_start', 'pf.away_pitcher_pitches_last_start',
  // Bullpen features
  'pf.home_bullpen_pitches_last_3d', 'pf.away_bullpen_pitches_last_3d',
  // Hitting features
  'pf.home_team_ops', 'pf.away_team_ops',
  'pf.home_lineup_avg_xwoba', 'pf.away_lineup_avg_xwoba',
  // Park / weather
  'pf.park_factor_overall', 'pf.park_factor_hr',
  'pf.temperature', 'pf.wind_speed',
  // Game context
  'pf.is_day_game', 'pf.is_dome', 'pf.game_number_in_series', 'pf.umpire_id',
  // Quality signals
  'pf.data_quality_score', 'pf.signal_coherence_score',
  // Odds
  'pf.odds_ml_home', 'pf.odds_ml_away', 'pf.odds_ou_total',
  // Outcomes (target variables)
  'pf.home_score', 'pf.away_score', 'pf.total_runs',
  'pf.winner_team_id', 'pf.game_status', 'pf.result',
];

// ── CSV helpers ────────────────────────────────────────────────────────────
function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function rowToCSV(row, headers) {
  return headers.map(h => escapeCSV(row[h])).join(',');
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  // Build WHERE clauses
  const conditions = [];
  const params = [];

  if (FROM_DATE) {
    params.push(FROM_DATE);
    conditions.push(`pf.game_date >= $${params.length}`);
  }
  if (TO_DATE) {
    params.push(TO_DATE);
    conditions.push(`pf.game_date <= $${params.length}`);
  }
  if (SOURCE) {
    params.push(SOURCE);
    conditions.push(`pf.source = $${params.length}`);
  }
  if (MARKET) {
    params.push(MARKET);
    conditions.push(`pf.market_type = $${params.length}`);
  }
  if (RESOLVED_ONLY) {
    conditions.push(`pf.result IS NOT NULL`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT ${COLUMNS.join(', ')}
    FROM pick_features pf
    ${where}
    ORDER BY pf.game_date ASC, pf.id ASC
  `;

  console.log(`[export] Running query with ${params.length} param(s)...`);
  const { rows } = await pool.query(sql, params);
  console.log(`[export] ${rows.length} rows returned`);

  if (rows.length === 0) {
    console.log('[export] Nothing to export.');
    await pool.end();
    return;
  }

  // Derive clean column names from "pf.column_name" aliases
  const headers = COLUMNS.map(c => c.replace(/^pf\./, ''));

  // Ensure output directory exists
  const outDir = path.dirname(OUT_PATH);
  if (outDir && outDir !== '.') fs.mkdirSync(outDir, { recursive: true });

  // Write CSV
  const csvLines = [headers.join(',')];
  for (const row of rows) {
    csvLines.push(rowToCSV(row, headers));
  }
  fs.writeFileSync(OUT_PATH, csvLines.join('\n'), 'utf8');
  console.log(`[export] CSV written → ${OUT_PATH} (${rows.length} rows, ${headers.length} columns)`);

  // Summary stats
  const resolved = rows.filter(r => r.result != null).length;
  const withScores = rows.filter(r => r.home_score != null).length;
  const withMarket = rows.filter(r => r.market_type != null).length;
  console.log(`[export] resolved=${resolved} with_scores=${withScores} with_market=${withMarket} total=${rows.length}`);
  if (withScores < resolved) {
    console.warn(`[export] ⚠ ${resolved - withScores} resolved rows are missing game scores — run backfill-pick-features.js first`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('[export] Fatal:', err.message);
  process.exit(1);
});
