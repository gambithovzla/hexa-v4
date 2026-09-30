import pool from '../db.js';
import { findNflGame } from './nflGameLookup.js';
import { settleNflBetFromGame } from './nflBetSettlement.js';

/** Resolve recorded tickets without inferring that an analysis pick was placed. */
export async function resolveNflPendingBets({ database = pool, lookup = findNflGame } = {}) {
  const summary = { pending: 0, settled: 0, skipped: 0, errors: [] };
  const { rows } = await database.query(`
    SELECT b.*, d.kickoff_at
    FROM nfl_bet_ledger b
    JOIN nfl_quote_decisions d ON d.id = b.decision_id
    WHERE d.kickoff_at < NOW() - INTERVAL '2 hours'
      AND d.kickoff_at > NOW() - INTERVAL '30 days'
      AND NOT EXISTS (SELECT 1 FROM nfl_bet_settlements s WHERE s.bet_id = b.id)
    ORDER BY d.kickoff_at ASC LIMIT 100
  `);
  summary.pending = rows.length;
  const games = new Map();
  for (const bet of rows) {
    try {
      const key = String(bet.game_pk);
      if (!games.has(key)) games.set(key, await lookup({
        gameId: bet.game_pk, season: bet.season,
        seasonType: bet.season_type, week: bet.week,
      }));
      const settlement = settleNflBetFromGame(bet, games.get(key));
      if (!settlement.result) {
        summary.skipped += 1;
        continue;
      }
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT id FROM nfl_bet_ledger WHERE id = $1 FOR UPDATE', [bet.id]);
        const saved = await client.query(`
          INSERT INTO nfl_bet_settlements (bet_id, result, pnl, source, evidence)
          SELECT $1,$2,$3,'espn_final',$4
          WHERE NOT EXISTS (SELECT 1 FROM nfl_bet_settlements WHERE bet_id = $1)
          RETURNING id
        `, [bet.id, settlement.result, settlement.pnl, JSON.stringify(settlement.evidence)]);
        await client.query('COMMIT');
        if (saved.rows.length) summary.settled += 1;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      summary.errors.push({ betId: bet.id, message: error.message });
    }
  }
  return summary;
}
