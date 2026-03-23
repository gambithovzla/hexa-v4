/**
 * line-movement.js — Line Movement Tracking for H.E.X.A. V4
 *
 * Exports:
 *   captureOddsSnapshot()                          — snapshot current odds for all today's games
 *   getLineMovement(homeTeam, awayTeam, gameDate)  — compute movement between first/last snapshot
 */

import pool from './db.js';
import { getGameOdds } from './odds-api.js';

// ---------------------------------------------------------------------------
// captureOddsSnapshot
// ---------------------------------------------------------------------------

/**
 * Fetches current MLB odds and stores a snapshot for every real game (non-mock).
 * Safe to call multiple times — each call inserts a new timestamped row.
 *
 * @returns {Promise<{ captured: number, games: string[] }>}
 */
export async function captureOddsSnapshot() {
  const allOdds = await getGameOdds();

  // Filter out Spring Training mock data
  const realOdds = allOdds.filter(g => g.source !== 'estimated_spring_training');

  if (!realOdds.length) {
    console.log('[line-movement] No real-odds games available — snapshot skipped');
    return { captured: 0, games: [] };
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const captured = [];

  for (const game of realOdds) {
    const { homeTeam, awayTeam, odds } = game;
    const { moneyline: ml, runLine: rl, overUnder: ou } = odds;

    // Build a deterministic game_id from team names + date
    const gameId = `${today}_${slugify(awayTeam)}_at_${slugify(homeTeam)}`;

    await pool.query(
      `INSERT INTO odds_snapshots
         (game_id, game_date, home_team, away_team,
          moneyline_home, moneyline_away,
          run_line_home, run_line_home_price,
          run_line_away, run_line_away_price,
          total, over_price, under_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        gameId,
        today,
        homeTeam,
        awayTeam,
        ml?.home   ?? null,
        ml?.away   ?? null,
        rl?.home?.spread ?? null,
        rl?.home?.price  ?? null,
        rl?.away?.spread ?? null,
        rl?.away?.price  ?? null,
        ou?.total      ?? null,
        ou?.overPrice  ?? null,
        ou?.underPrice ?? null,
      ]
    );

    captured.push(`${awayTeam} @ ${homeTeam}`);
  }

  // Log HH:MM ET
  const etTime = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York',
  }).format(new Date());

  console.log(`[line-movement] Captured snapshot for ${captured.length} games at ${etTime} ET`);
  return { captured: captured.length, games: captured };
}

// ---------------------------------------------------------------------------
// getLineMovement
// ---------------------------------------------------------------------------

/**
 * Returns opening/current odds and movement metrics for a specific game.
 *
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @param {string} gameDate  — YYYY-MM-DD
 * @returns {Promise<object|null>}  null when fewer than 2 snapshots exist
 */
export async function getLineMovement(homeTeam, awayTeam, gameDate) {
  if (!homeTeam || !awayTeam || !gameDate) return null;

  // Build the same deterministic game_id used during capture
  const gameId = `${gameDate}_${slugify(awayTeam)}_at_${slugify(homeTeam)}`;

  const { rows } = await pool.query(
    `SELECT * FROM odds_snapshots
     WHERE game_id = $1 AND game_date = $2
     ORDER BY captured_at ASC`,
    [gameId, gameDate]
  );

  if (rows.length < 2) return null;

  const opening = rows[0];
  const current = rows[rows.length - 1];

  const diff = (a, b) => (a != null && b != null ? b - a : null);

  const movement_ml_home = diff(opening.moneyline_home, current.moneyline_home);
  const movement_ml_away = diff(opening.moneyline_away, current.moneyline_away);
  const movement_total   = diff(parseFloat(opening.total), parseFloat(current.total));

  // Sharp signal: 15+ cent ML move on either side
  const sharp_signal = (
    (movement_ml_home != null && Math.abs(movement_ml_home) >= 15) ||
    (movement_ml_away != null && Math.abs(movement_ml_away) >= 15)
  );

  // Direction: home ML becoming MORE negative means money flowing to home side
  let direction = null;
  if (movement_ml_home != null && Math.abs(movement_ml_home) >= 15) {
    direction = movement_ml_home < 0 ? 'sharp on home' : 'sharp on away';
  } else if (movement_ml_away != null && Math.abs(movement_ml_away) >= 15) {
    direction = movement_ml_away < 0 ? 'sharp on away' : 'sharp on home';
  }

  // Hours between first and last snapshot
  const firstTs = new Date(opening.captured_at);
  const lastTs  = new Date(current.captured_at);
  const hoursSpan = Math.round((lastTs - firstTs) / (1000 * 60 * 60) * 10) / 10;

  return {
    opening: {
      moneyline_home: opening.moneyline_home,
      moneyline_away: opening.moneyline_away,
      total:          opening.total != null ? parseFloat(opening.total) : null,
    },
    current: {
      moneyline_home: current.moneyline_home,
      moneyline_away: current.moneyline_away,
      total:          current.total != null ? parseFloat(current.total) : null,
    },
    movement_ml_home,
    movement_ml_away,
    movement_total: movement_total != null ? Math.round(movement_total * 10) / 10 : null,
    sharp_signal,
    direction,
    snapshots_count:  rows.length,
    first_captured:   opening.captured_at,
    last_captured:    current.captured_at,
    hours_tracked:    hoursSpan,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
