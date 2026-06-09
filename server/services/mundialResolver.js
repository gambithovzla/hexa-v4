/**
 * server/services/mundialResolver.js — resolves Mundial predictions after matches finish.
 *
 * Called by the background job in index.js every 30 min.
 * Finds pending predictions for finished matches, awards credits, updates status.
 */

import pool from '../db.js';
import { getSoccerGamesForDate } from '../soccer-api.js';

const CREDITS_EXACT   = 5;
const CREDITS_CORRECT = 2;

function result(h, a) {
  if (h > a) return 'H';
  if (h < a) return 'A';
  return 'D';
}

export async function resolveMundialPredictions() {
  const { rows: dates } = await pool.query(`
    SELECT DISTINCT game_date::text AS game_date
    FROM mundial_predictions
    WHERE status = 'pending'
      AND game_date <= CURRENT_DATE
  `);
  if (!dates.length) return;

  let resolved = 0;
  for (const { game_date } of dates) {
    let games;
    try {
      games = await getSoccerGamesForDate('fifa.world', game_date);
    } catch (err) {
      console.warn(`[mundial-resolver] failed to fetch games for ${game_date}: ${err.message}`);
      continue;
    }
    const finalGames = (games ?? []).filter(g => g.status === 'final');
    for (const game of finalGames) {
      const ah = parseInt(game.homeScore, 10);
      const aa = parseInt(game.awayScore, 10);
      if (isNaN(ah) || isNaN(aa)) continue;
      const actualResult = result(ah, aa);

      const { rows: preds } = await pool.query(
        `SELECT id, user_id, predicted_home, predicted_away FROM mundial_predictions
         WHERE event_id = $1 AND status = 'pending'`,
        [game.id]
      );
      if (!preds.length) continue;

      for (const pred of preds) {
        const ph = pred.predicted_home;
        const pa = pred.predicted_away;
        let status, credits;
        if (ph === ah && pa === aa) {
          status = 'exact';
          credits = CREDITS_EXACT;
        } else if (result(ph, pa) === actualResult) {
          status = 'correct';
          credits = CREDITS_CORRECT;
        } else {
          status = 'wrong';
          credits = 0;
        }

        await pool.query(
          `UPDATE mundial_predictions
           SET status = $1, actual_home = $2, actual_away = $3,
               credits_earned = $4, resolved_at = NOW()
           WHERE id = $5`,
          [status, ah, aa, credits, pred.id]
        );
        if (credits > 0) {
          await pool.query(
            `UPDATE users SET credits = credits + $1 WHERE id = $2`,
            [credits, pred.user_id]
          );
        }
        resolved++;
      }
    }
  }
  if (resolved > 0) console.log(`[mundial-resolver] resolved ${resolved} predictions`);
}
