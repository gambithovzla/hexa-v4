/**
 * nfl-line-movement.js — NFL odds snapshots and what moved between them.
 *
 * The NFL analogue of line-movement.js, which is MLB-only. Without this there is
 * no line history for football at all, and three things stay impossible: CLV
 * (the one short-run measure of whether picks beat the market), sharp-money
 * detection for the conviction objective, and any line-movement context for the
 * Oracle.
 *
 * Not a copy of the MLB module, because the primary market differs. MLB's run
 * line is a fixed ±1.5; NFL's spread is the whole game, and where it moves
 * matters more than how far. A spread sliding from -2.5 to -3 is worth more than
 * one sliding from -5 to -6: three is the most common margin in football, and
 * crossing it changes the bet. That crossing detection is the NFL-specific part.
 *
 * The analysis half is pure and unit-tested; the capture half does IO.
 */

import pool from './db.js';
import { getNflGameOdds } from './nfl-odds.js';

/** The margins NFL games actually land on. Crossing one changes the bet. */
export const NFL_KEY_NUMBERS = [3, 7, 10, 14];

/** A move of this many cents or more is a step rather than book-to-book noise. */
const STEP_CENTS = 5;

/** A favourite at or shorter than this is the side the public is on. */
const PUBLIC_FAVOURITE_ML = -130;

/** Drift of this many cents against a favourite reads as money the other way. */
const RLM_DRIFT_CENTS = 15;

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function diff(from, to) {
  const a = num(from);
  const b = num(to);
  return a == null || b == null ? null : b - a;
}

function round1(v) {
  return v == null ? null : Math.round(v * 10) / 10;
}

/**
 * Which key numbers a spread crossed between open and current.
 *
 * Compares absolute magnitudes so the side does not have to be resolved: a home
 * favourite going -2.5 → -3.5 and a road favourite going +2.5 → +3.5 are the
 * same event from the bettor's view — the number three is no longer available.
 */
export function crossedKeyNumbers(openSpread, currentSpread) {
  const from = num(openSpread);
  const to = num(currentSpread);
  if (from == null || to == null) return [];

  const lo = Math.min(Math.abs(from), Math.abs(to));
  const hi = Math.max(Math.abs(from), Math.abs(to));
  // Strictly between the two magnitudes, or landed exactly on one from the other
  // side — sitting still on a key number is not a crossing.
  return NFL_KEY_NUMBERS.filter(k => k > lo && k <= hi && hi !== lo);
}

/**
 * Turn a game's ordered snapshots into a movement read.
 *
 * @param {Array} rows snapshots ascending by captured_at
 * @returns {object|null} null when there is nothing to compare (0 or 1 snapshot)
 */
export function analyzeNflLineMovement(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const opening = rows[0];
  const current = rows[rows.length - 1];

  const movement_ml_home = diff(opening.moneyline_home, current.moneyline_home);
  const movement_ml_away = diff(opening.moneyline_away, current.moneyline_away);
  const movement_spread_home = round1(diff(opening.spread_home, current.spread_home));
  const movement_total = round1(diff(opening.total, current.total));

  // Of the moves big enough to be steps, how many pointed the same way as the
  // overall move? Many aligned steps is steam; one jump and drift back is not.
  let alignedSteps = 0;
  let totalSteps = 0;
  for (let i = 1; i < rows.length; i++) {
    const step = diff(rows[i - 1].moneyline_home, rows[i].moneyline_home);
    if (step == null || Math.abs(step) < STEP_CENTS) continue;
    totalSteps++;
    if (movement_ml_home != null && step * movement_ml_home > 0) alignedSteps++;
  }
  const sustained_move_pct = totalSteps > 0
    ? Math.round((alignedSteps / totalSteps) * 100)
    : null;

  // Public money shortens favourites. A favourite whose price DRIFTS LONGER is
  // the books moving against the popular side.
  let reverse_line_movement = null;
  const openMlHome = num(opening.moneyline_home);
  const openMlAway = num(opening.moneyline_away);
  if (openMlHome != null && openMlHome <= PUBLIC_FAVOURITE_ML
      && movement_ml_home != null && movement_ml_home >= RLM_DRIFT_CENTS) {
    reverse_line_movement = 'against_home_favorite';
  } else if (openMlAway != null && openMlAway <= PUBLIC_FAVOURITE_ML
      && movement_ml_away != null && movement_ml_away >= RLM_DRIFT_CENTS) {
    reverse_line_movement = 'against_away_favorite';
  }

  const keyNumbersCrossed = crossedKeyNumbers(opening.spread_home, current.spread_home);

  const openedAt = opening.captured_at ? new Date(opening.captured_at) : null;
  const closedAt = current.captured_at ? new Date(current.captured_at) : null;
  const hours_tracked = openedAt && closedAt
    ? Math.round(((closedAt - openedAt) / 36e5) * 10) / 10
    : null;

  return {
    opening: {
      moneyline_home: num(opening.moneyline_home),
      moneyline_away: num(opening.moneyline_away),
      spread_home:    num(opening.spread_home),
      total:          num(opening.total),
    },
    current: {
      moneyline_home: num(current.moneyline_home),
      moneyline_away: num(current.moneyline_away),
      spread_home:    num(current.spread_home),
      total:          num(current.total),
    },
    movement_ml_home,
    movement_ml_away,
    movement_spread_home,
    movement_total,
    key_numbers_crossed: keyNumbersCrossed,
    sustained_move_pct,
    reverse_line_movement,
    book_count: num(current.bookmaker_count),
    snapshots_count: rows.length,
    first_captured: opening.captured_at ?? null,
    last_captured: current.captured_at ?? null,
    hours_tracked,
  };
}

function slugify(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/**
 * The key snapshots of one game group under.
 *
 * The odds provider's own event id when there is one, because the obvious
 * alternative — date plus team names — breaks twice over. Team names differ
 * between the odds feed and ESPN, and the "date" of a Monday night game is the
 * next day in UTC, so a slug built at capture time would not match one built at
 * read time. The slug remains only as a fallback for events with no id.
 */
export function nflSnapshotGameId({ eventId = null, gameDate = null, awayTeam = null, homeTeam = null } = {}) {
  if (eventId) return `evt:${eventId}`;
  if (!gameDate || !homeTeam || !awayTeam) return null;
  return `${gameDate}_${slugify(awayTeam)}_at_${slugify(homeTeam)}`;
}

/**
 * Capture one snapshot of every priced NFL game in the window.
 *
 * Called on a schedule. The value is entirely in the accumulation: a single
 * snapshot says nothing, and the first useful read needs a day or two of them.
 */
export async function captureNflOddsSnapshot({ date = null, seasonType = null } = {}) {
  let events;
  try {
    events = await getNflGameOdds({ date, seasonType });
  } catch (err) {
    console.error(`[nfl-line-movement] odds fetch failed: ${err.message}`);
    return { captured: 0, games: [] };
  }
  if (!events?.length) {
    console.log('[nfl-line-movement] no NFL odds available — snapshot skipped');
    return { captured: 0, games: [] };
  }

  const captured = [];
  for (const ev of events) {
    const gameDate = ev.commenceTime ? String(ev.commenceTime).split('T')[0] : null;
    if (!gameDate || !ev.homeTeam || !ev.awayTeam) continue;

    const gameId = nflSnapshotGameId({
      eventId: ev.eventId, gameDate, awayTeam: ev.awayTeam, homeTeam: ev.homeTeam,
    });
    if (!gameId) continue;
    try {
      await pool.query(
        `INSERT INTO nfl_odds_snapshots
           (game_id, game_date, home_team, away_team,
            moneyline_home, moneyline_away,
            spread_home, spread_home_price, spread_away, spread_away_price,
            total, over_price, under_price, bookmaker_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          gameId,
          gameDate,
          ev.homeTeam,
          ev.awayTeam,
          ev.moneyline?.home ?? null,
          ev.moneyline?.away ?? null,
          ev.spread?.home ?? null,
          ev.spread?.homePrice ?? null,
          ev.spread?.away ?? null,
          ev.spread?.awayPrice ?? null,
          ev.total?.line ?? null,
          ev.total?.overPrice ?? null,
          ev.total?.underPrice ?? null,
          ev.bookmakerCount ?? null,
        ]
      );
      captured.push(gameId);
    } catch (err) {
      console.error(`[nfl-line-movement] snapshot insert failed for ${gameId}: ${err.message}`);
    }
  }

  console.log(`[nfl-line-movement] captured ${captured.length}/${events.length} NFL games`);
  return { captured: captured.length, games: captured };
}

/**
 * Movement for one game. Never throws — a missing history is a null, not an
 * error, because every consumer treats "no line history yet" as no signal.
 */
export async function getNflLineMovement({ eventId = null, gameDate = null, homeTeam = null, awayTeam = null } = {}) {
  const gameId = nflSnapshotGameId({ eventId, gameDate, homeTeam, awayTeam });
  if (!gameId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT moneyline_home, moneyline_away, spread_home, total,
              bookmaker_count, captured_at
         FROM nfl_odds_snapshots
        WHERE game_id = $1
        ORDER BY captured_at ASC`,
      [gameId]
    );
    return analyzeNflLineMovement(rows);
  } catch (err) {
    console.warn(`[nfl-line-movement] lookup failed for ${gameId}: ${err.message}`);
    return null;
  }
}
