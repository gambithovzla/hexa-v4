import pool from '../db.js';
import { findNflGame } from './nflGameLookup.js';
import { gradeNflSelectionFromGame } from './nflBetSettlement.js';

/** Grade every observed bet365 quote, including WATCH and NO_BET decisions. */
export async function resolveNflQuoteOutcomes({ database = pool, lookup = findNflGame } = {}) {
  const summary = { pending: 0, graded: 0, skipped: 0, errors: [] };
  const { rows } = await database.query(`
    SELECT d.* FROM nfl_quote_decisions d
    WHERE d.kickoff_at < NOW() - INTERVAL '2 hours'
      AND d.kickoff_at > NOW() - INTERVAL '30 days'
      AND NOT EXISTS (SELECT 1 FROM nfl_quote_outcomes o WHERE o.decision_id = d.id)
    ORDER BY d.kickoff_at ASC, d.id ASC LIMIT 500
  `);
  summary.pending = rows.length;
  const games = new Map();
  for (const decision of rows) {
    try {
      const key = String(decision.game_pk);
      if (!games.has(key)) games.set(key, await lookup({
        gameId: decision.game_pk, season: decision.season,
        seasonType: decision.season_type, week: decision.week,
      }));
      const outcome = gradeNflSelectionFromGame(decision, games.get(key));
      if (!outcome.result) {
        summary.skipped += 1;
        continue;
      }
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM nfl_quote_decisions WHERE id = $1 FOR UPDATE', [decision.id]);
        const saved = await client.query(`
          INSERT INTO nfl_quote_outcomes (decision_id, result, source, evidence)
          SELECT $1,$2,'espn_final',$3
          WHERE NOT EXISTS (SELECT 1 FROM nfl_quote_outcomes WHERE decision_id = $1)
          RETURNING id
        `, [decision.id, outcome.result, JSON.stringify(outcome.evidence)]);
        await client.query('COMMIT');
        if (saved.rows.length) summary.graded += 1;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      summary.errors.push({ decisionId: decision.id, message: error.message });
    }
  }
  return summary;
}
