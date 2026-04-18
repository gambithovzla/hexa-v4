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
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS kelly_recommendation TEXT`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS game_pk INTEGER`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS game_date DATE`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS postmortem_summary TEXT`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS postmortem JSONB`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS postmortem_generated_at TIMESTAMP`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS postmortem_requested_at TIMESTAMP`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS value_breakdown JSONB`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS safe_candidates JSONB`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS safe_scope TEXT`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS selection_method VARCHAR(80)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_picks_user_game_pk ON picks(user_id, game_pk)`);

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

    // ── is_admin column (safe for existing DBs) ──────────────────────────────
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false`);
    await client.query(`UPDATE users SET is_admin = true WHERE email = 'cdanielrr@hotmail.com'`);
    await client.query(`UPDATE users SET is_admin = true WHERE email = 'admin@hexa.com'`);

    // ── email verification columns (safe for existing DBs) ────────────────────
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMP DEFAULT NULL`);
    await client.query(`UPDATE users SET email_verified = true WHERE email = 'cdanielrr@hotmail.com' OR email = 'admin@hexa.com'`);

    // ── backtest_results (Shadow Mode — offline backtesting, never touches picks) ─
    await client.query(`
      CREATE TABLE IF NOT EXISTS backtest_results (
        id                  SERIAL        PRIMARY KEY,
        run_id              TEXT          NOT NULL,
        historical_date     DATE          NOT NULL,
        game_pk             INTEGER       NOT NULL,
        matchup             TEXT          NOT NULL,
        home_team           TEXT,
        away_team           TEXT,
        pick                TEXT,
        oracle_confidence   INTEGER,
        bet_value           TEXT,
        model_risk          TEXT,
        pick_type           TEXT,
        actual_home_score   INTEGER,
        actual_away_score   INTEGER,
        actual_result       TEXT,
        model               TEXT          DEFAULT 'deep',
        prompt_version      TEXT          DEFAULT 'v1',
        latency_ms          INTEGER,
        created_at          TIMESTAMP     DEFAULT NOW(),
        UNIQUE(run_id, game_pk, pick_type)
      )
    `);

    await client.query(`ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS alert_flags JSONB DEFAULT '[]'`);
    await client.query(`ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS bet_value_raw TEXT`);
    await client.query(`ALTER TABLE backtest_results ADD COLUMN IF NOT EXISTS has_critical_flags BOOLEAN DEFAULT false`);

    // ── pick_features (ML Feature Store) ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS pick_features (
        id SERIAL PRIMARY KEY,
        pick_id INTEGER,
        backtest_id INTEGER,
        game_pk INTEGER,
        game_date DATE,
        home_pitcher_xwoba DECIMAL(5,3),
        away_pitcher_xwoba DECIMAL(5,3),
        home_pitcher_whiff DECIMAL(5,2),
        away_pitcher_whiff DECIMAL(5,2),
        home_pitcher_k_pct DECIMAL(5,2),
        away_pitcher_k_pct DECIMAL(5,2),
        home_pitcher_era DECIMAL(5,2),
        away_pitcher_era DECIMAL(5,2),
        home_team_ops DECIMAL(5,3),
        away_team_ops DECIMAL(5,3),
        home_lineup_avg_xwoba DECIMAL(5,3),
        away_lineup_avg_xwoba DECIMAL(5,3),
        park_factor_overall INTEGER,
        park_factor_hr INTEGER,
        temperature DECIMAL(5,1),
        wind_speed DECIMAL(5,1),
        data_quality_score INTEGER,
        signal_coherence_score INTEGER,
        odds_ml_home INTEGER,
        odds_ml_away INTEGER,
        odds_ou_total DECIMAL(4,1),
        pick TEXT,
        result TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS shadow_model_runs (
        id SERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        pick_id INTEGER REFERENCES picks(id) ON DELETE SET NULL,
        backtest_id INTEGER REFERENCES backtest_results(id) ON DELETE SET NULL,
        source_type VARCHAR(20) NOT NULL DEFAULT 'analysis',
        analysis_mode VARCHAR(20) NOT NULL DEFAULT 'single',
        model_key VARCHAR(80) NOT NULL,
        model_version VARCHAR(40),
        game_pk INTEGER NOT NULL,
        game_date DATE,
        home_team_id INTEGER,
        away_team_id INTEGER,
        home_team_abbr VARCHAR(10),
        away_team_abbr VARCHAR(10),
        oracle_pick TEXT,
        oracle_confidence DECIMAL(5,2),
        oracle_home_win_prob DECIMAL(6,3),
        oracle_predicted_winner_id TEXT,
        oracle_predicted_winner_abbr VARCHAR(10),
        shadow_score INTEGER,
        shadow_confidence INTEGER,
        shadow_home_win_prob DECIMAL(6,3),
        shadow_predicted_winner_id TEXT,
        shadow_predicted_winner_abbr VARCHAR(10),
        agree_with_oracle BOOLEAN,
        actual_winner_id TEXT,
        actual_winner_abbr VARCHAR(10),
        actual_home_score INTEGER,
        actual_away_score INTEGER,
        actual_status VARCHAR(20) NOT NULL DEFAULT 'pending',
        feature_snapshot JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shadow_model_runs_game_pk ON shadow_model_runs(game_pk)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shadow_model_runs_created_at ON shadow_model_runs(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shadow_model_runs_status ON shadow_model_runs(actual_status)`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_shadow_model_runs_pick_unique
      ON shadow_model_runs(pick_id, model_key)
      WHERE pick_id IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_shadow_model_runs_backtest_unique
      ON shadow_model_runs(backtest_id, model_key)
      WHERE backtest_id IS NOT NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(64) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO app_settings (key, value)
      VALUES ('performance_public', 'false'::jsonb)
      ON CONFLICT (key) DO NOTHING
    `);

    // ── oracle_sessions (Oracle Chat History by day) ──────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS oracle_sessions (
        id          SERIAL        PRIMARY KEY,
        user_id     TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_key VARCHAR(100)  UNIQUE NOT NULL,
        date_et     DATE          NOT NULL,
        mode        VARCHAR(20)   NOT NULL DEFAULT 'partido',
        game_ids    JSONB         DEFAULT '[]',
        matchups    TEXT,
        messages    JSONB         NOT NULL DEFAULT '[]',
        created_at  TIMESTAMP     DEFAULT NOW(),
        updated_at  TIMESTAMP     DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_oracle_sessions_date ON oracle_sessions(date_et DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_oracle_sessions_user ON oracle_sessions(user_id, date_et DESC)`);

    // ── hexa_insights (Weekly curated hits/misses for public feed) ────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS hexa_insights (
        id          SERIAL        PRIMARY KEY,
        type        VARCHAR(20)   NOT NULL CHECK (type IN ('acierto', 'fallo')),
        title       TEXT          NOT NULL,
        explanation TEXT          NOT NULL,
        pick_id     INTEGER       REFERENCES picks(id) ON DELETE SET NULL,
        pick_data   JSONB         DEFAULT '{}',
        week_start  DATE          NOT NULL,
        created_at  TIMESTAMP     DEFAULT NOW(),
        deleted_at  TIMESTAMP     DEFAULT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_insights_week ON hexa_insights(week_start, deleted_at)`);

    await client.query('COMMIT');

    await pool.query(`
      UPDATE picks AS p
      SET game_pk = pf.game_pk,
          game_date = COALESCE(p.game_date, pf.game_date)
      FROM pick_features AS pf
      WHERE pf.pick_id = p.id
        AND (p.game_pk IS NULL OR p.game_date IS NULL)
    `);

    // Normalize pick results: 'won' → 'win', 'lost' → 'loss'
    await pool.query("UPDATE picks SET result = 'win' WHERE result = 'won'");
    await pool.query("UPDATE picks SET result = 'loss' WHERE result = 'lost'");
    console.log('[migrate] Normalized pick results (won→win, lost→loss)');

    console.log('[H.E.X.A.] Database migrations applied successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[H.E.X.A.] Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}
