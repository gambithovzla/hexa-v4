/** Database integration check; only runs against a disposable hexa_test* DB. */
import assert from 'node:assert/strict';
import pool from '../db.js';
import { resolveNflPendingBets } from '../services/nflBetResolver.js';
import { resolveNflQuoteOutcomes } from '../services/nflQuoteOutcomeResolver.js';
import { summarizeNflQuoteDecisions } from '../services/nflProspectiveReport.js';

async function main() {
  if (process.env.NFL_INTEGRATION_TEST_DB !== 'true') throw new Error('NFL_INTEGRATION_TEST_DB=true required');
  const name = (await pool.query('SELECT current_database() AS name')).rows[0].name;
  if (!name.startsWith('hexa_test')) throw new Error('Disposable hexa_test* database required');
  const userId = `nfl-integration-${Date.now()}`;
  const fakeGame = { game_id: '999999', game_status_id: 3, home_score: 24, away_score: 21 };
  const lookup = async () => fakeGame;
  try {
    await pool.query('INSERT INTO users (id,email,password_hash) VALUES ($1,$2,$3)',
      [userId, `${userId}@example.invalid`, 'not-a-real-password']);
    const decisions = [];
    for (const [market, side, line, decision, probability] of [
      ['spread', 'home', -3, 'NO_BET', 0.55],
      ['moneyline', 'away', null, 'WATCH', 0.45],
      ['moneyline', 'home', null, 'BET', 0.6],
    ]) {
      const { rows } = await pool.query(`INSERT INTO nfl_quote_decisions
        (user_id,game_pk,season,season_type,week,bookmaker,market,side,line,
         decimal_odds,observed_at,kickoff_at,model_probability,decision,reasons,snapshot)
        VALUES ($1,999999,2026,2,1,'bet365',$2,$3,$4,1.91,
                NOW()-INTERVAL '1 day',NOW()-INTERVAL '20 hours',$5,$6,'[]',$7)
        RETURNING id`, [userId, market, side, line, probability, decision,
        JSON.stringify({ decision: { model: { certified: false } } })]);
      decisions.push(rows[0].id);
    }
    await pool.query(`INSERT INTO nfl_bet_ledger
      (decision_id,user_id,game_pk,season,season_type,week,bookmaker,market,side,
       accepted_decimal,stake)
      VALUES ($1,$2,999999,2026,2,1,'bet365','moneyline','home',1.91,10)`, [decisions[2], userId]);

    const quotes = await resolveNflQuoteOutcomes({ database: pool, lookup });
    const bets = await resolveNflPendingBets({ database: pool, lookup });
    assert.equal(quotes.graded, 3);
    assert.equal(bets.settled, 1);
    const { rows } = await pool.query(`SELECT d.*, o.result, b.id AS bet_id
      FROM nfl_quote_decisions d
      JOIN nfl_quote_outcomes o ON o.decision_id = d.id
      LEFT JOIN nfl_bet_ledger b ON b.decision_id = d.id
      WHERE d.user_id = $1 ORDER BY d.id`, [userId]);
    const report = summarizeNflQuoteDecisions(rows);
    assert.equal(report.evaluatedQuotes, 3);
    assert.equal(report.gradedQuotes, 3);
    assert.equal(report.ticketedQuotes, 1);
    assert.equal(report.roi, null);
    const settled = await pool.query(`SELECT s.result,s.pnl FROM nfl_bet_settlements s
      JOIN nfl_bet_ledger b ON b.id = s.bet_id WHERE b.user_id = $1`, [userId]);
    assert.equal(settled.rows[0].result, 'win');
    assert.equal(Number(settled.rows[0].pnl), 9.1);
    console.log('NFL quote outcomes, ticket settlement and report verified on', name);
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
}

try {
  await main();
} finally {
  await pool.end();
}
