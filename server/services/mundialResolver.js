/**
 * server/services/mundialResolver.js — resolves Mundial predictions after matches finish.
 *
 * Called from index.js every 30 min.
 * Scoring: correct H/A = +2 credits, correct Draw = +3 credits (harder to call), wrong = 0.
 */

import pool from '../db.js';
import { getSoccerGamesForDate } from '../soccer-api.js';

const CREDITS = { H: 2, A: 2, D: 3 };

function side(home, away) {
  if (home > away) return 'H';
  if (home < away) return 'A';
  return 'D';
}

export async function resolveMundialPredictions() {
  const { rows: dates } = await pool.query(`
    SELECT DISTINCT game_date::text AS game_date
    FROM mundial_predictions
    WHERE status = 'pending' AND game_date <= CURRENT_DATE
  `);
  if (!dates.length) return;

  let resolved = 0;
  for (const { game_date } of dates) {
    let games;
    try { games = await getSoccerGamesForDate('fifa.world', game_date); }
    catch (err) { console.warn(`[mundial-resolver] fetch failed ${game_date}: ${err.message}`); continue; }

    const finalGames = (games ?? []).filter(g => g.status === 'final');
    for (const game of finalGames) {
      const ah = Number(game.teams?.home?.score);
      const aa = Number(game.teams?.away?.score);
      if (isNaN(ah) || isNaN(aa)) continue;
      const actualSide = side(ah, aa);
      const eventId = game.gameId ?? String(game.gamePk);

      const { rows: preds } = await pool.query(
        `SELECT id, user_id, predicted_side FROM mundial_predictions
         WHERE event_id=$1 AND status='pending'`,
        [eventId]
      );
      for (const pred of preds) {
        const correct = pred.predicted_side === actualSide;
        const credits  = correct ? CREDITS[actualSide] : 0;
        const status   = correct ? 'correct' : 'wrong';
        await pool.query(
          `UPDATE mundial_predictions SET status=$1, actual_side=$2, credits_earned=$3, resolved_at=NOW() WHERE id=$4`,
          [status, actualSide, credits, pred.id]
        );
        if (credits > 0) {
          await pool.query(`UPDATE users SET credits=credits+$1 WHERE id=$2`, [credits, pred.user_id]);
        }
        resolved++;
      }
    }
  }
  if (resolved > 0) console.log(`[mundial-resolver] resolved ${resolved} predictions`);
}
