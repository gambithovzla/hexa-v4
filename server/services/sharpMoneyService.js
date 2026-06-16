/**
 * sharpMoneyService.js — detects where the sharp money is across today's slate.
 *
 * line-movement.js already computes the raw ingredients per game (reverse line
 * movement, sustained/steam move %, ML move magnitude, book count). This layer
 * combines them into a single sharp-money classification per game + a board
 * sorted by signal strength — so "the books are moving against the public on
 * X" becomes a first-class, scannable signal instead of buried fields.
 *
 * The thesis: line movement driven by sharp money is one of the few public
 * signals that anticipates the closing line. A favorite whose price drifts
 * LONGER despite public money (RLM) is the books respecting sharp action.
 *
 * Read-only. classifySharpMoney is pure (unit-tested); buildSharpMoneyBoard
 * orchestrates over the day's games. Touches no frozen files.
 */

import { getTodayGames } from '../mlb-api.js';
import { getLineMovement } from '../line-movement.js';

const TIER = { STRONG: 'strong', MODERATE: 'moderate', WEAK: 'weak', NONE: 'none' };

/**
 * Scores a single game's line movement into a sharp-money signal.
 * Pure function — takes a getLineMovement() result (or null), returns a
 * classification with the contributing reasons made explicit.
 *
 * @param {object|null} lm — result of getLineMovement()
 * @returns {{tier, score, side, reasons: string[]}}
 */
export function classifySharpMoney(lm) {
  const reasons = [];
  if (!lm) return { tier: TIER.NONE, score: 0, side: null, reasons: ['no line movement data'] };

  let score = 0;
  let side = null;

  // 1. Reverse line movement — the strongest classic sharp tell. A favorite
  //    drifting longer despite public money on it = books respecting sharps.
  if (lm.reverse_line_movement === 'against_home_favorite') {
    score += 45;
    side = 'away'; // sharps are on the dog / against the home favorite
    reasons.push('reverse line movement against home favorite');
  } else if (lm.reverse_line_movement === 'against_away_favorite') {
    score += 45;
    side = 'home';
    reasons.push('reverse line movement against away favorite');
  }

  // 2. Sustained / steam move — many aligned snapshot steps beat one jump that
  //    drifts back. Only meaningful when there were real steps to align.
  if (lm.sustained_move_pct != null) {
    if (lm.sustained_move_pct >= 70) {
      score += 25;
      reasons.push(`steam move (${lm.sustained_move_pct}% of steps aligned)`);
    } else if (lm.sustained_move_pct >= 50) {
      score += 12;
      reasons.push(`moderately sustained move (${lm.sustained_move_pct}%)`);
    }
  }

  // 3. Magnitude of the ML move (either side). Bigger move = stronger conviction.
  const maxMove = Math.max(
    lm.movement_ml_home != null ? Math.abs(lm.movement_ml_home) : 0,
    lm.movement_ml_away != null ? Math.abs(lm.movement_ml_away) : 0,
  );
  if (maxMove >= 25) {
    score += 20;
    reasons.push(`large line move (${maxMove}¢)`);
  } else if (maxMove >= 15) {
    score += 12;
    reasons.push(`notable line move (${maxMove}¢)`);
  }

  // 4. Direction (when RLM didn't already set it) from the sharp_signal field.
  if (!side && lm.direction) {
    if (lm.direction.includes('home')) side = 'home';
    else if (lm.direction.includes('away')) side = 'away';
    reasons.push(lm.direction);
  }

  // 5. Confidence gate: thin books (<3) are noisy. Halve the score and flag it
  //    so a 2-book wobble never masquerades as a steam move.
  if (lm.book_count != null && lm.book_count < 3) {
    score = Math.round(score * 0.5);
    reasons.push(`thin book coverage (${lm.book_count})`);
  }

  let tier = TIER.NONE;
  if (score >= 60) tier = TIER.STRONG;
  else if (score >= 35) tier = TIER.MODERATE;
  else if (score >= 15) tier = TIER.WEAK;

  return { tier, score: Math.min(score, 100), side, reasons };
}

/**
 * Builds the sharp-money board for a date: every game with at least a WEAK
 * signal, sorted by score descending.
 *
 * @param {object} opts
 * @param {string} [opts.date] — YYYY-MM-DD (defaults to today)
 * @returns {Promise<{date, games, summary}>}
 */
export async function buildSharpMoneyBoard({ date } = {}) {
  const day = date || new Date().toISOString().split('T')[0];
  let games = [];
  try {
    games = await getTodayGames(day);
  } catch (err) {
    console.error(`[sharp-money] failed to fetch games for ${day}: ${err.message}`);
    return { date: day, games: [], summary: { gameCount: 0, signalCount: 0 } };
  }

  const results = [];
  for (const game of games ?? []) {
    const home = game.teams?.home?.name;
    const away = game.teams?.away?.name;
    if (!home || !away) continue;

    let lm = null;
    try {
      lm = await getLineMovement(home, away, day);
    } catch {
      lm = null;
    }
    const signal = classifySharpMoney(lm);
    if (signal.tier === TIER.NONE) continue;

    results.push({
      matchup: `${away} @ ${home}`,
      homeTeam: home,
      awayTeam: away,
      sharpSide: signal.side === 'home' ? home : signal.side === 'away' ? away : null,
      tier: signal.tier,
      score: signal.score,
      reasons: signal.reasons,
      movement: lm ? {
        ml_home: lm.movement_ml_home,
        ml_away: lm.movement_ml_away,
        sustained_pct: lm.sustained_move_pct,
        reverse_line_movement: lm.reverse_line_movement,
        book_count: lm.book_count,
        hours_tracked: lm.hours_tracked,
      } : null,
    });
  }

  results.sort((a, b) => b.score - a.score);

  return {
    date: day,
    games: results,
    summary: {
      gameCount: (games ?? []).length,
      signalCount: results.length,
      strongCount: results.filter(r => r.tier === TIER.STRONG).length,
    },
  };
}
