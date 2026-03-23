/**
 * migrate.js — Create H.E.X.A. V4 tables if they don't already exist.
 *
 * Call runMigrations() once on server startup before accepting requests.
 * All statements are idempotent (IF NOT EXISTS) so they are safe to run
 * on every deploy.
 */

import pool from './db.js';

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── users ─────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT        PRIMARY KEY,
        email         TEXT        UNIQUE NOT NULL,
        password_hash TEXT        NOT NULL,
        credits       INTEGER     DEFAULT 0,
        created_at    TIMESTAMP   DEFAULT NOW()
      )
    `);

    // ── bankroll ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bankroll (
        user_id           TEXT          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        initial_bankroll  DECIMAL(12,2),
        current_bankroll  DECIMAL(12,2),
        updated_at        TIMESTAMP     DEFAULT NOW()
      )
    `);

    // ── bets ──────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bets (
        id             TEXT          PRIMARY KEY,
        user_id        TEXT          REFERENCES users(id) ON DELETE CASCADE,
        date           TIMESTAMP     DEFAULT NOW(),
        matchup        TEXT          NOT NULL,
        pick           TEXT          NOT NULL,
        odds           INTEGER       NOT NULL,
        stake          DECIMAL(12,2) NOT NULL,
        potential_win  DECIMAL(12,2) NOT NULL,
        result         TEXT          DEFAULT 'pending',
        source         TEXT          DEFAULT 'manual',
        notes          TEXT,
        pick_id        INTEGER       REFERENCES picks(id) ON DELETE SET NULL,
        created_at     TIMESTAMP     DEFAULT NOW()
      )
    `);

    // ── picks ─────────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS picks (
        id                SERIAL        PRIMARY KEY,
        user_id           TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type              VARCHAR(20)   NOT NULL,
        matchup           VARCHAR(200),
        pick              TEXT,
        oracle_confidence INTEGER,
        bet_value         VARCHAR(50),
        model_risk        VARCHAR(20),
        oracle_report     TEXT,
        hexa_hunch        TEXT,
        alert_flags       JSONB,
        probability_model JSONB,
        best_pick         JSONB,
        model             VARCHAR(50),
        language          VARCHAR(5),
        result            VARCHAR(10)   DEFAULT 'pending',
        created_at        TIMESTAMP     DEFAULT NOW()
      )
    `);

    // ── link bets → picks (safe for existing DBs) ─────────────────────────────
    await client.query(`
      ALTER TABLE bets
        ADD COLUMN IF NOT EXISTS pick_id INTEGER REFERENCES picks(id) ON DELETE SET NULL
    `);

    // ── CLV tracking columns (safe for existing DBs) ──────────────────────────
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS odds_at_pick         INTEGER`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS implied_prob_at_pick DECIMAL(5,2)`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS closing_odds          INTEGER`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS implied_prob_closing  DECIMAL(5,2)`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS clv                   DECIMAL(5,2)`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS odds_details          JSONB`);

    // ── odds_snapshots (P7 — Line Movement Tracking) ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS odds_snapshots (
        id                   SERIAL       PRIMARY KEY,
        game_id              VARCHAR(100) NOT NULL,
        game_date            DATE         NOT NULL,
        home_team            VARCHAR(100),
        away_team            VARCHAR(100),
        moneyline_home       INTEGER,
        moneyline_away       INTEGER,
        run_line_home        DECIMAL(3,1),
        run_line_home_price  INTEGER,
        run_line_away        DECIMAL(3,1),
        run_line_away_price  INTEGER,
        total                DECIMAL(4,1),
        over_price           INTEGER,
        under_price          INTEGER,
        captured_at          TIMESTAMP    DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_snapshots_game_date ON odds_snapshots(game_id, game_date)
    `);

    // ── pending_credits (BMC webhook — credits for users not yet registered) ───
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_credits (
        id           SERIAL        PRIMARY KEY,
        email        VARCHAR(255)  NOT NULL,
        credits      INTEGER       NOT NULL,
        source       VARCHAR(50)   DEFAULT 'buymeacoffee',
        purchase_id  VARCHAR(100),
        amount       DECIMAL(10,2),
        product_name VARCHAR(255),
        claimed      BOOLEAN       DEFAULT false,
        created_at   TIMESTAMP     DEFAULT NOW()
      )
    `);

    await client.query('COMMIT');
    console.log('[H.E.X.A.] Database migrations applied successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[H.E.X.A.] Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
