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
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS ml_opinion JSONB`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS value_breakdown JSONB`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS safe_candidates JSONB`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS safe_scope TEXT`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS selection_method VARCHAR(80)`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS calibrated_confidence INTEGER`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS conviction_tier VARCHAR(8)`);
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

    // ── odds_snapshots v2 — per-book data for consensus / RLM detection ───────
    await client.query(`ALTER TABLE odds_snapshots ADD COLUMN IF NOT EXISTS bookmaker_count INTEGER`);
    await client.query(`ALTER TABLE odds_snapshots ADD COLUMN IF NOT EXISTS books_ml_home   JSONB`);
    await client.query(`ALTER TABLE odds_snapshots ADD COLUMN IF NOT EXISTS books_ml_away   JSONB`);
    await client.query(`ALTER TABLE odds_snapshots ADD COLUMN IF NOT EXISTS books_total      JSONB`);

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

    // ── bmc_processed_purchases (dedup across webhook + poller) ──────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS bmc_processed_purchases (
        purchase_id  VARCHAR(100)  PRIMARY KEY,
        source       VARCHAR(20)   NOT NULL,
        email        VARCHAR(255),
        credits      INTEGER,
        product_name VARCHAR(255),
        amount       DECIMAL(10,2),
        processed_at TIMESTAMP     DEFAULT NOW()
      )
    `);

    // Seed: mark BMC purchases that were already credited manually before
    // the poller existed. ON CONFLICT DO NOTHING makes this idempotent and
    // safe to leave in place across redeploys.
    await client.query(`
      INSERT INTO bmc_processed_purchases (purchase_id, source, email, credits, product_name, amount)
      VALUES ('6472416', 'manual', 'enriquerafael2002@gmail.com', 50, 'HEXA All-Star - 50 Credits', 19.99)
      ON CONFLICT (purchase_id) DO NOTHING
    `);

    // ── nowpayments_invoices (active gateway — crypto via NowPayments) ────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS nowpayments_invoices (
        id            SERIAL        PRIMARY KEY,
        order_id      VARCHAR(100)  UNIQUE NOT NULL,
        user_id       TEXT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invoice_id    VARCHAR(255),
        plan_id       VARCHAR(50)   NOT NULL,
        credits       INTEGER       NOT NULL,
        price_usd     DECIMAL(10,2) NOT NULL,
        pay_currency  VARCHAR(20),
        status        VARCHAR(20)   DEFAULT 'new',
        created_at    TIMESTAMP     DEFAULT NOW(),
        completed_at  TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_np_invoices_user_id ON nowpayments_invoices(user_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_np_invoices_status  ON nowpayments_invoices(status)`);

    // ── is_admin column (safe for existing DBs) ──────────────────────────────
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false`);
    await client.query(`UPDATE users SET is_admin = true WHERE email = 'cdanielrr@hotmail.com'`);
    await client.query(`UPDATE users SET is_admin = true WHERE email = 'admin@hexa.com'`);

    // ── email verification columns (safe for existing DBs) ────────────────────
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires TIMESTAMP DEFAULT NULL`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_code_hash TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP DEFAULT NULL`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMP DEFAULT NULL`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_attempts INTEGER DEFAULT 0`);
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
        dedupe_key  TEXT          DEFAULT NULL,
        created_at  TIMESTAMP     DEFAULT NOW(),
        deleted_at  TIMESTAMP     DEFAULT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_insights_week ON hexa_insights(week_start, deleted_at)`);
    await client.query(`ALTER TABLE hexa_insights ADD COLUMN IF NOT EXISTS dedupe_key TEXT DEFAULT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_dedupe_key ON hexa_insights(dedupe_key)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS content_queue (
        id SERIAL PRIMARY KEY,
        type VARCHAR(40) NOT NULL,
        lang VARCHAR(5) NOT NULL DEFAULT 'es',
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        publish_target VARCHAR(20) NOT NULL DEFAULT 'x',
        title TEXT NOT NULL,
        format VARCHAR(20) NOT NULL DEFAULT 'single_post',
        posts JSONB NOT NULL DEFAULT '[]'::jsonb,
        hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
        cta TEXT,
        visual_brief TEXT,
        compliance_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
        source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        generated_with TEXT,
        scheduled_for TIMESTAMP NULL,
        approved_at TIMESTAMP NULL,
        approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        published_at TIMESTAMP NULL,
        publish_result JSONB NULL,
        last_error TEXT NULL,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_content_queue_status ON content_queue(status, created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_content_queue_scheduled ON content_queue(status, scheduled_for)`);

    // ── user_email + Lima timezone timestamp for auditing ─────────────────────
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS user_email TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS pick_time_lima TIMESTAMP DEFAULT NULL`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS user_email TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS pick_time_lima TIMESTAMP DEFAULT NULL`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS user_email TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS pick_time_lima TIMESTAMP DEFAULT NULL`);

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

    await pool.query(`
      UPDATE picks SET user_email = 'Oraclechat'
      WHERE source = 'oracle_chat' AND (user_email IS NULL OR BTRIM(user_email) = '')
    `);
    await pool.query(`
      UPDATE pick_features SET user_email = 'Oraclechat'
      WHERE source = 'oracle_chat' AND (user_email IS NULL OR BTRIM(user_email) = '')
    `);

    console.log('[H.E.X.A.] Database migrations applied successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[H.E.X.A.] Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * runParlaySynergyMigrations()
 * Creates the parlay_synergy_runs table and its indexes.
 * Separate from runMigrations() per the brief — safe to run on every deploy.
 * Note: user_id is TEXT to match the existing users(id) TEXT primary key.
 */
export async function runParlaySynergyMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS parlay_synergy_runs (
        id                BIGSERIAL PRIMARY KEY,
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_email        VARCHAR(255),
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        game_date         DATE NOT NULL,

        requested_legs    INTEGER NOT NULL,
        mode              VARCHAR(32) NOT NULL,
        game_pks          JSONB NOT NULL,
        language          VARCHAR(8) DEFAULT 'en',
        engine            VARCHAR(16) DEFAULT 'sonnet',
        model             VARCHAR(16) DEFAULT 'fast',

        candidate_pool    JSONB NOT NULL,
        composed_top3     JSONB NOT NULL,
        architect_output  JSONB NOT NULL,

        chosen_legs       JSONB NOT NULL,
        combined_prob     NUMERIC(6,4),
        combined_dec_odds NUMERIC(10,2),
        synergy_type      VARCHAR(64),
        warnings          JSONB,

        resolved          BOOLEAN DEFAULT false,
        hit               BOOLEAN,
        legs_hit          INTEGER,
        resolved_at       TIMESTAMPTZ,

        shadow_old_parlay JSONB,
        shadow_old_hit    BOOLEAN,

        timings           JSONB,
        credits_charged   INTEGER,
        is_admin_run      BOOLEAN DEFAULT false
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_parlay_synergy_runs_user_date
        ON parlay_synergy_runs(user_id, game_date DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_parlay_synergy_runs_resolved
        ON parlay_synergy_runs(resolved, game_date DESC) WHERE resolved = false
    `);

    await client.query(`
      ALTER TABLE parlay_synergy_runs
        ADD COLUMN IF NOT EXISTS leg_results JSONB
    `);

    await client.query(`
      ALTER TABLE parlay_synergy_runs
        ADD COLUMN IF NOT EXISTS bet_type VARCHAR(32)
    `);

    await client.query(`
      ALTER TABLE parlay_synergy_runs
        ADD COLUMN IF NOT EXISTS market_focus VARCHAR(32)
    `);

    await client.query('COMMIT');
    console.log('[migrate] parlay_synergy_runs table ready');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] parlay_synergy_runs migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Sprint 1 — dataset gaps: new columns on pick_features for real ML training
export async function runSprint1Migrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Game outcomes — required for moneyline, O/U, and run-line models
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_score INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_score INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS total_runs INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS winner_team_id INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS game_status VARCHAR(32)`);

    // Team-strength features — the only MLB signals available both live
    // (standings) and in free history (schedule scores). They carry the
    // runline/moneyline pre-training frame, where Statcast columns are NaN.
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_runs_for_avg DECIMAL(5,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_runs_for_avg DECIMAL(5,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_runs_against_avg DECIMAL(5,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_runs_against_avg DECIMAL(5,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_run_diff_avg DECIMAL(5,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_run_diff_avg DECIMAL(5,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_win_pct DECIMAL(5,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_win_pct DECIMAL(5,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_venue_win_pct DECIMAL(5,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_venue_win_pct DECIMAL(5,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_last10_wins DECIMAL(4,1)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_last10_wins DECIMAL(4,1)`);

    // Structured pick fields — replaces unstructured text for training
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS market_type VARCHAR(16)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS side VARCHAR(16)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS line DECIMAL(6,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_kind VARCHAR(32)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_id INTEGER`);

    // Pitcher fatigue / context features
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_pitcher_days_rest INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_pitcher_days_rest INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_pitcher_pitches_last_start INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_pitcher_pitches_last_start INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_bullpen_pitches_last_3d INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_bullpen_pitches_last_3d INTEGER`);

    // Game context
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS is_day_game BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS is_dome BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS game_number_in_series INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS umpire_id INTEGER`);

    // Oracle metadata for model versioning and auditing
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(32)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS oracle_model VARCHAR(48)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS oracle_confidence INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS kelly_fraction DECIMAL(6,4)`);

    // Source flag: separates real picks from admin tests and backtest rows
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'live'`);

    // Indexes for efficient export queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pick_features_source ON pick_features(source)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pick_features_market_type ON pick_features(market_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pick_features_game_date ON pick_features(game_date)`);

    await client.query('COMMIT');
    console.log('[migrate] sprint-1 pick_features columns ready');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] sprint-1 migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Sprint 5 (deferred) — MLB Player Props per-batter/per-pitcher snapshot columns
export async function runPlayerPropsMlbMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_name TEXT`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_xwoba DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_xba DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_xslg DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_k_pct DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_bb_pct DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_avg_exit_velocity DECIMAL(7,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_barrel_pct DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_hard_hit_pct DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_rolling_woba_14d DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_rolling_woba_7d DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_rolling_woba_21d DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_ops_vs_lhp DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_player_ops_vs_rhp DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_opponent_pitcher_hand VARCHAR(1)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_opponent_pitcher_xwoba_against DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_opponent_pitcher_k_pct DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_odds_american INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS prop_implied_prob DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS python_prop_prob DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS python_prop_market VARCHAR(32)`);
    await client.query('COMMIT');
    console.log('[migrate] player-props-mlb columns ready');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] player-props-mlb migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Sprint 3 — Node ↔ Python sidecar: persist Python model score alongside
// the existing legacy shadow validator score in shadow_model_runs.
export async function runSprint3Migrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Python model result columns (all nullable — sidecar may be disabled or down)
    await client.query(`
      ALTER TABLE shadow_model_runs
        ADD COLUMN IF NOT EXISTS python_model_score   DECIMAL(6,4)
    `);
    await client.query(`
      ALTER TABLE shadow_model_runs
        ADD COLUMN IF NOT EXISTS python_model_version VARCHAR(80)
    `);
    // Status of the Python call: 'ok' | 'disabled' | 'unavailable' | 'error'
    await client.query(`
      ALTER TABLE shadow_model_runs
        ADD COLUMN IF NOT EXISTS python_model_status  VARCHAR(20)
    `);

    await client.query('COMMIT');
    console.log('[migrate] sprint-3 shadow_model_runs Python columns ready');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] sprint-3 migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Admin ML Control Center — audit log for manual retrains, plus picks
// provenance columns (source + chat_session_id) for chat-sourced picks.
export async function runAdminMLControlCenterMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Audit log of manual retrains triggered from the admin UI.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ml_retrain_log (
        id           SERIAL       PRIMARY KEY,
        user_id      TEXT         REFERENCES users(id) ON DELETE SET NULL,
        market       VARCHAR(32)  NOT NULL,
        scope        VARCHAR(32)  NOT NULL DEFAULT 'market',
        status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
        brier        DECIMAL(8,5),
        logloss      DECIMAL(8,5),
        n_train      INTEGER,
        n_test       INTEGER,
        duration_ms  INTEGER,
        error        TEXT,
        response     JSONB,
        created_at   TIMESTAMP    DEFAULT NOW(),
        finished_at  TIMESTAMP
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ml_retrain_log_created ON ml_retrain_log(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ml_retrain_log_user ON ml_retrain_log(user_id, created_at DESC)`);

    // Pick provenance — distinguishes formal picks from chat-extracted ones.
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'formal'`);
    await client.query(`ALTER TABLE picks ADD COLUMN IF NOT EXISTS chat_session_id INTEGER REFERENCES oracle_sessions(id) ON DELETE SET NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_picks_source ON picks(source)`);

    // Backfill existing rows so the new column is meaningful for queries.
    await client.query(`UPDATE picks SET source = 'formal' WHERE source IS NULL`);

    await client.query('COMMIT');
    console.log('[migrate] admin-ml-control-center tables ready (ml_retrain_log + picks.source/chat_session_id)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] admin-ml-control-center migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Sprint 7 — NBA scaffolding
// Adds sport column to picks/pick_features, creates nba_games and
// nba_team_stats tables. Default 'mlb' keeps all existing rows valid.
export async function runNbaScaffoldingMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Sport discriminator ───────────────────────────────────────────────────
    await client.query(`ALTER TABLE picks        ADD COLUMN IF NOT EXISTS sport VARCHAR(10) DEFAULT 'mlb'`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS sport VARCHAR(10) DEFAULT 'mlb'`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_picks_sport ON picks(sport)`);

    // ── NBA games cache ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS nba_games (
        id              BIGSERIAL    PRIMARY KEY,
        game_id         VARCHAR(20)  UNIQUE NOT NULL,
        game_date       DATE         NOT NULL,
        home_team_id    INTEGER      NOT NULL,
        away_team_id    INTEGER      NOT NULL,
        home_team_abbr  VARCHAR(5)   NOT NULL,
        away_team_abbr  VARCHAR(5)   NOT NULL,
        home_team_name  VARCHAR(60),
        away_team_name  VARCHAR(60),
        status          VARCHAR(40),
        home_score      INTEGER,
        away_score      INTEGER,
        arena           VARCHAR(100),
        national_tv     VARCHAR(50),
        season          VARCHAR(10),
        created_at      TIMESTAMPTZ  DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nba_games_date ON nba_games(game_date DESC)`);

    // ── NBA team stats cache (one row per team per season) ────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS nba_team_stats (
        team_id     INTEGER      NOT NULL,
        season      VARCHAR(10)  NOT NULL,
        team_abbr   VARCHAR(5),
        team_name   VARCHAR(60),
        wins        INTEGER,
        losses      INTEGER,
        off_rating  DECIMAL(7,3),
        def_rating  DECIMAL(7,3),
        net_rating  DECIMAL(7,3),
        pace        DECIMAL(7,3),
        ts_pct      DECIMAL(6,4),
        reb_pct     DECIMAL(6,4),
        ast_pct     DECIMAL(6,4),
        updated_at  TIMESTAMPTZ  DEFAULT NOW(),
        PRIMARY KEY (team_id, season)
      )
    `);

    await client.query('COMMIT');
    console.log('[migrate] nba-scaffolding ready (nba_games, nba_team_stats, sport column)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] nba-scaffolding migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sprint 7.1 — NBA dataset + shadow_model isolation.
 *
 * Adds `sport` discriminator to `shadow_model_runs` so we can keep MLB and
 * NBA validator runs cleanly separated, and tacks NBA-specific feature
 * columns onto `pick_features` so a single feature store works for both
 * sports without losing the per-pitch MLB schema.
 *
 * All changes are nullable + idempotent (`IF NOT EXISTS`). MLB-only rows
 * keep their NBA columns NULL and vice versa.
 */
export async function runNbaDatasetMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── shadow_model_runs: sport discriminator ──────────────────────────────
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS sport VARCHAR(10) DEFAULT 'mlb'`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shadow_model_runs_sport ON shadow_model_runs(sport)`);

    // ── pick_features: NBA team identity (already in shadow_model_runs) ─────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_team_id INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_team_id INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_team_abbr VARCHAR(8)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_team_abbr VARCHAR(8)`);

    // ── pick_features: NBA advanced team stats ──────────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_off_rating DECIMAL(7,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_off_rating DECIMAL(7,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_def_rating DECIMAL(7,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_def_rating DECIMAL(7,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_net_rating DECIMAL(7,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_net_rating DECIMAL(7,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_pace DECIMAL(7,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_pace DECIMAL(7,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_ts_pct DECIMAL(6,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_ts_pct DECIMAL(6,4)`);

    // ── pick_features: NBA context (rest, B2B, injuries, form) ──────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_rest_days INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_rest_days INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_is_b2b BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_is_b2b BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_injuries_severe INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_injuries_severe INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_last10_wins INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_last10_wins INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS context_completeness DECIMAL(5,4)`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_pick_features_sport ON pick_features(sport)`);

    await client.query('COMMIT');
    console.log('[migrate] sprint-7.1 ready (shadow_model_runs.sport + pick_features NBA columns)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] sprint-7.1 migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sprint 9a — NFL scaffolding. Mirrors runNbaScaffoldingMigrations.
 *
 * Reuses the `sport` discriminator already on picks/pick_features (default
 * 'mlb'). Adds NFL cache tables keyed by week (not date) — the structural NFL
 * difference. Idempotent.
 */
export async function runNflScaffoldingMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── NFL games cache (keyed by season/seasonType/week) ─────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS nfl_games (
        id              BIGSERIAL    PRIMARY KEY,
        game_id         VARCHAR(20)  UNIQUE NOT NULL,
        season          INTEGER,
        season_type     SMALLINT,
        week            SMALLINT,
        game_date       DATE,
        home_team_id    INTEGER      NOT NULL,
        away_team_id    INTEGER      NOT NULL,
        home_team_abbr  VARCHAR(5),
        away_team_abbr  VARCHAR(5),
        home_team_name  VARCHAR(60),
        away_team_name  VARCHAR(60),
        status          VARCHAR(40),
        home_score      INTEGER,
        away_score      INTEGER,
        stadium         VARCHAR(100),
        dome            BOOLEAN,
        national_tv     VARCHAR(50),
        created_at      TIMESTAMPTZ  DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nfl_games_week ON nfl_games(season, season_type, week)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nfl_games_date ON nfl_games(game_date DESC)`);

    // ── NFL team stats cache (one row per team per season) ────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS nfl_team_stats (
        team_id           INTEGER      NOT NULL,
        season            INTEGER      NOT NULL,
        team_abbr         VARCHAR(5),
        team_name         VARCHAR(60),
        conference        VARCHAR(3),
        division          VARCHAR(10),
        wins              INTEGER,
        losses            INTEGER,
        ties              INTEGER,
        points_for        INTEGER,
        points_against    INTEGER,
        epa_off           DECIMAL(7,4),
        epa_def           DECIMAL(7,4),
        success_rate_off  DECIMAL(6,4),
        success_rate_def  DECIMAL(6,4),
        proe              DECIMAL(7,4),
        pace_sec_play     DECIMAL(7,3),
        plays_per_game    DECIMAL(7,3),
        redzone_td_pct    DECIMAL(6,4),
        third_down_pct    DECIMAL(6,4),
        pressure_rate     DECIMAL(6,4),
        updated_at        TIMESTAMPTZ  DEFAULT NOW(),
        PRIMARY KEY (team_id, season)
      )
    `);

    await client.query('COMMIT');
    console.log('[migrate] nfl-scaffolding ready (nfl_games, nfl_team_stats)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] nfl-scaffolding migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sprint 9.1 — NFL dataset isolation. Mirrors runNbaDatasetMigrations.
 *
 * `shadow_model_runs.sport` and `pick_features.home/away_team_id/abbr` already
 * exist from the NBA migrations — reused. This only tacks on NFL-specific
 * feature columns (nullable + idempotent). MLB/NBA rows keep them NULL.
 */
export async function runNflDatasetMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── pick_features: NFL advanced team stats (nflverse) ───────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_epa_off DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_epa_off DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_epa_def DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_epa_def DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_success_rate DECIMAL(6,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_success_rate DECIMAL(6,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_proe DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_proe DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_pace DECIMAL(7,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_pace DECIMAL(7,3)`);

    // ── pick_features: NFL rest / schedule context ──────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_rest_days INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_rest_days INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_is_short_week BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_is_short_week BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_is_off_bye BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_is_off_bye BOOLEAN`);

    // ── pick_features: QB availability (the dominant NFL variable) ──────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS qb_home_tier SMALLINT`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS qb_away_tier SMALLINT`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS qb_home_active BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS qb_away_active BOOLEAN`);

    // ── pick_features: weather + line + injuries ────────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS wind_mph DECIMAL(5,1)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS is_dome BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS spread_close DECIMAL(5,1)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS total_close DECIMAL(5,1)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS injuries_home_severe INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS injuries_away_severe INTEGER`);

    // ── pick_features: NFL player props (Fase 2 — pooled nfl_prop model) ─────
    // prop_kind / side / line / prop_odds_american / prop_implied_prob already
    // exist (MLB props). These add the NFL-specific player + market signals.
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS nfl_prop_fair_prob DECIMAL(7,4)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS nfl_prop_player_season_avg DECIMAL(8,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS nfl_prop_player_recent_avg DECIMAL(8,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS nfl_prop_player_games INTEGER`);

    await client.query('COMMIT');
    console.log('[migrate] nfl-dataset ready (pick_features NFL columns)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] nfl-dataset migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sprint 10a — NHL scaffolding. Mirrors runNflScaffoldingMigrations but keyed by
 * DATE (the NBA cadence), not week. Reuses the `sport` discriminator already on
 * picks/pick_features (default 'mlb'). Idempotent.
 */
export async function runNhlScaffoldingMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── NHL games cache (keyed by date) ───────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS nhl_games (
        id              BIGSERIAL    PRIMARY KEY,
        game_id         VARCHAR(20)  UNIQUE NOT NULL,
        season          INTEGER,
        season_type     SMALLINT,
        game_date       DATE,
        home_team_id    INTEGER      NOT NULL,
        away_team_id    INTEGER      NOT NULL,
        home_team_abbr  VARCHAR(5),
        away_team_abbr  VARCHAR(5),
        home_team_name  VARCHAR(60),
        away_team_name  VARCHAR(60),
        status          VARCHAR(40),
        home_score      INTEGER,
        away_score      INTEGER,
        arena           VARCHAR(100),
        national_tv     VARCHAR(50),
        created_at      TIMESTAMPTZ  DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_nhl_games_date ON nhl_games(game_date DESC)`);

    // ── NHL team stats cache (one row per team per season) ─────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS nhl_team_stats (
        team_id           INTEGER,
        team_abbr         VARCHAR(5)   NOT NULL,
        season            INTEGER      NOT NULL,
        team_name         VARCHAR(60),
        conference        VARCHAR(10),
        division          VARCHAR(16),
        wins              INTEGER,
        losses            INTEGER,
        ot_losses         INTEGER,
        points            INTEGER,
        points_pct        DECIMAL(5,3),
        goals_for         INTEGER,
        goals_against     INTEGER,
        goal_diff         INTEGER,
        gf_per_game       DECIMAL(5,2),
        ga_per_game       DECIMAL(5,2),
        pp_pct            DECIMAL(5,2),
        pk_pct            DECIMAL(5,2),
        shots_for_per_game     DECIMAL(5,2),
        shots_against_per_game DECIMAL(5,2),
        faceoff_pct       DECIMAL(5,2),
        updated_at        TIMESTAMPTZ  DEFAULT NOW(),
        PRIMARY KEY (team_abbr, season)
      )
    `);

    await client.query('COMMIT');
    console.log('[migrate] nhl-scaffolding ready (nhl_games, nhl_team_stats)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] nhl-scaffolding migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sprint 10.1 — NHL dataset isolation. Mirrors runNflDatasetMigrations.
 *
 * `shadow_model_runs.sport`, `pick_features.home/away_team_id/abbr`,
 * `home/away_rest_days`, `home/away_injuries_severe` and `home/away_last10_wins`
 * already exist from the NBA/NFL migrations — reused. This only tacks on
 * NHL-specific feature columns (nullable + idempotent). Other sports keep NULL.
 */
export async function runNhlDatasetMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── pick_features: NHL team strength ──────────────────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_goal_diff INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_goal_diff INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_gf_per_game DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_gf_per_game DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_ga_per_game DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_ga_per_game DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_points_pct DECIMAL(5,3)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_points_pct DECIMAL(5,3)`);

    // ── pick_features: NHL special teams ──────────────────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_pp_pct DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_pp_pct DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_pk_pct DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_pk_pct DECIMAL(5,2)`);

    // ── pick_features: NHL schedule + goalie + line ───────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_is_b2b BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_is_b2b BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS goalie_home_confirmed BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS goalie_away_confirmed BOOLEAN`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS puck_line_close DECIMAL(4,1)`);

    await client.query('COMMIT');
    console.log('[migrate] nhl-dataset ready (pick_features NHL columns)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] nhl-dataset migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function runPickAlignedShadowMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS pick_market_type VARCHAR(20)`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS pick_side VARCHAR(10)`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS pick_line DECIMAL(6,2)`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS prop_kind VARCHAR(32)`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS oracle_pick_prob DECIMAL(7,4)`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS legacy_pick_prob DECIMAL(7,4)`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS python_pick_prob DECIMAL(7,4)`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS python_pick_market VARCHAR(32)`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS pick_agree_legacy BOOLEAN`);
    await client.query(`ALTER TABLE shadow_model_runs ADD COLUMN IF NOT EXISTS pick_agree_python BOOLEAN`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_shadow_model_runs_pick_market ON shadow_model_runs(pick_market_type)`);
    await client.query('COMMIT');
    console.log('[migrate] pick-aligned shadow_model_runs columns ready');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] pick-aligned shadow migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Pick Imperdible — admin-only "lock of the slate" mode.
// One row per analysis run (the full analyzed slate = dataset for the future
// conviction model). The selected lock itself lives in `picks` with
// type='imperdible' / source='imperdible' so it reuses resolver + equity but
// stays isolated from default training (sidecar filters source='live').
export async function runImperdibleMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS imperdible_runs (
        id                    BIGSERIAL    PRIMARY KEY,
        user_id               TEXT         REFERENCES users(id) ON DELETE SET NULL,
        sport                 VARCHAR(10)  DEFAULT 'mlb',
        lang                  VARCHAR(5)   DEFAULT 'en',
        game_pks              INTEGER[]    DEFAULT '{}',
        slate_size            INTEGER      DEFAULT 0,
        verdict               VARCHAR(12)  NOT NULL,
        reason                VARCHAR(40),
        selected_pick_id      INTEGER      REFERENCES picks(id) ON DELETE SET NULL,
        selected_candidate_id VARCHAR(80),
        conviction            DECIMAL(5,1),
        consensus_prob        DECIMAL(5,1),
        arbiter_confidence    DECIMAL(5,1),
        headline              TEXT,
        rationale             TEXT,
        candidates            JSONB,
        arbiter               JSONB,
        excluded              JSONB,
        created_at            TIMESTAMP    DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_imperdible_runs_created ON imperdible_runs(created_at DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_imperdible_runs_verdict ON imperdible_runs(verdict)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_imperdible_runs_pick ON imperdible_runs(selected_pick_id)`);
    await client.query('COMMIT');
    console.log('[migrate] imperdible_runs table ready');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] imperdible migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Postgres-backed odds cache shared across consumers (Imperdible, Safe,
// Parlay Architect, Oracle Chat). Survives redeploys and avoids re-fetching
// the same alt-line / props menu multiple times per day.
export async function runOddsCacheMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS odds_cache (
        id          BIGSERIAL    PRIMARY KEY,
        cache_key   VARCHAR(200) NOT NULL UNIQUE,
        sport       VARCHAR(10)  NOT NULL DEFAULT 'mlb',
        scope       VARCHAR(40)  NOT NULL,
        subject     VARCHAR(120),
        payload     JSONB        NOT NULL,
        markets     TEXT,
        quota       JSONB,
        key_slot    VARCHAR(20),
        fetched_at  TIMESTAMPTZ  DEFAULT NOW(),
        expires_at  TIMESTAMPTZ  NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_odds_cache_expires ON odds_cache(expires_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_odds_cache_scope_subject ON odds_cache(scope, subject)`);
    await client.query('COMMIT');
    console.log('[migrate] odds_cache table ready');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] odds_cache migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * runEnsembleBackfillMigration()
 *
 * One-time backfill: rows in shadow_model_runs that have python_pick_prob
 * populated but python_model_score / python_model_status still NULL were
 * created while the recordShadowModelRun bug existed — _enrichWithPythonScore
 * was skipped when pickAligned.python_pick_prob was already set.
 *
 * This sets python_model_score = python_pick_prob and python_model_status =
 * 'ok' for those rows so the ensemble training SQL can find them.
 * Idempotent: re-running does nothing if already applied.
 */
export async function runEnsembleBackfillMigration() {
  try {
    // Pass 1: rows that have python_pick_prob but not python_model_score
    const r1 = await pool.query(`
      UPDATE shadow_model_runs
      SET python_model_score  = python_pick_prob,
          python_model_status = 'ok',
          updated_at          = NOW()
      WHERE python_pick_prob IS NOT NULL
        AND (python_model_status IS DISTINCT FROM 'ok'
             OR python_model_score IS NULL)
    `);
    // Pass 2: rows that have python_model_score but not python_pick_prob.
    // For moneyline: invert using pick_side (away → 1 - score).
    // For overunder/runline: same inversion logic (model scores are pick-direction agnostic
    // pre-Sprint 8c, so treat 'over'/'home_rl' as non-inverted, rest as inverted).
    const r2 = await pool.query(`
      UPDATE shadow_model_runs
      SET python_pick_prob = CASE
            WHEN pick_side IN ('away', 'under', 'away_rl') THEN 1.0 - python_model_score
            ELSE python_model_score
          END,
          updated_at = NOW()
      WHERE python_model_score IS NOT NULL
        AND python_pick_prob   IS NULL
        AND pick_side          IS NOT NULL
    `);
    console.log(`[migrate] ensemble backfill: pass1=${r1.rowCount} pass2=${r2.rowCount} rows updated`);
  } catch (err) {
    console.error('[migrate] ensemble backfill failed:', err.message);
    throw err;
  }
}

export async function runNbaPlayerStatsMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nba_player_stats (
        id          BIGSERIAL    PRIMARY KEY,
        player_id   INTEGER      NOT NULL,
        player_name VARCHAR(100) NOT NULL,
        team_id     INTEGER      NOT NULL,
        team_abbr   VARCHAR(5),
        season      VARCHAR(10)  NOT NULL,
        gp          INTEGER,
        min_pg      DECIMAL(5,2),
        pts_pg      DECIMAL(6,3),
        reb_pg      DECIMAL(6,3),
        ast_pg      DECIMAL(6,3),
        stl_pg      DECIMAL(6,3),
        blk_pg      DECIMAL(6,3),
        tov_pg      DECIMAL(6,3),
        fg_pct      DECIMAL(6,4),
        fg3_pct     DECIMAL(6,4),
        ft_pct      DECIMAL(6,4),
        ts_pct      DECIMAL(6,4),
        efg_pct     DECIMAL(6,4),
        usg_pct     DECIMAL(6,4),
        plus_minus  DECIMAL(7,3),
        updated_at  TIMESTAMPTZ  DEFAULT NOW(),
        UNIQUE (player_id, season)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_nba_player_stats_team
        ON nba_player_stats(team_id, season)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_nba_player_stats_name
        ON nba_player_stats(player_name, season)
    `);
    console.log('[migrate] nba_player_stats table ready');
  } catch (err) {
    console.error('[migrate] nba_player_stats migration failed:', err.message);
    throw err;
  }
}

export async function runNewsletterMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id                  BIGSERIAL PRIMARY KEY,
        email               VARCHAR(255) NOT NULL UNIQUE,
        unsubscribe_token   VARCHAR(64)  NOT NULL,
        lang                VARCHAR(5)   NOT NULL DEFAULT 'es',
        active              BOOLEAN      NOT NULL DEFAULT true,
        subscribed_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
        unsubscribed_at     TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_email
        ON newsletter_subscribers(email)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_active
        ON newsletter_subscribers(active)
    `);
    console.log('[migrate] newsletter_subscribers table ready');
  } catch (err) {
    console.error('[migrate] newsletter migrations failed:', err.message);
    throw err;
  }
}

export async function runCsvBacktestMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS csv_backtest_runs (
        id          BIGSERIAL    PRIMARY KEY,
        run_id      VARCHAR(128) NOT NULL,
        matchup     TEXT         NOT NULL,
        pick        TEXT         NOT NULL,
        result      VARCHAR(16)  NOT NULL,
        home_score  REAL,
        away_score  REAL,
        game_date   DATE,
        confidence  REAL,
        notes       TEXT,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_csv_backtest_runs_run_id
        ON csv_backtest_runs(run_id)
    `);
    console.log('[migrate] csv_backtest_runs table ready');
  } catch (err) {
    console.error('[migrate] csv backtest migrations failed:', err.message);
    throw err;
  }
}

export async function runBeatReporterMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS beat_injury_signals (
        id                BIGSERIAL    PRIMARY KEY,
        tweet_id          VARCHAR(64)  NOT NULL UNIQUE,
        reporter_handle   VARCHAR(64)  NOT NULL,
        reporter_team     VARCHAR(8),
        tweet_text        TEXT         NOT NULL,
        tweet_created_at  TIMESTAMPTZ,
        signal            VARCHAR(16)  NOT NULL DEFAULT 'none',
        player_name       VARCHAR(128),
        team_abbr         VARCHAR(8),
        confidence        REAL         NOT NULL DEFAULT 0,
        summary           VARCHAR(256),
        classified_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_beat_injury_signals_team
        ON beat_injury_signals(team_abbr, classified_at DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_beat_injury_signals_signal
        ON beat_injury_signals(signal, classified_at DESC)
    `);
    console.log('[migrate] beat_injury_signals table ready');
  } catch (err) {
    console.error('[migrate] beat reporter migrations failed:', err.message);
    throw err;
  }
}

export async function runPgvectorMigrations() {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pick_embeddings (
        id          BIGSERIAL   PRIMARY KEY,
        pick_id     BIGINT      NOT NULL REFERENCES picks(id) ON DELETE CASCADE,
        embedding   vector(1536),
        model       VARCHAR(64) NOT NULL DEFAULT 'text-embedding-3-small',
        embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(pick_id)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pick_embeddings_pick_id
        ON pick_embeddings(pick_id)
    `);
    console.log('[migrate] pick_embeddings table ready');
    // IVFFlat index requires at least 1 row — create lazily after first embed
  } catch (err) {
    // pgvector not installed — RAG similarity search will be skipped silently
    console.warn(`[migrate] pgvector unavailable: ${err.message}. RAG disabled.`);
  }
}

export async function runFeatureFlagsMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        key          VARCHAR(128) PRIMARY KEY,
        enabled      BOOLEAN      NOT NULL DEFAULT false,
        rollout_pct  INT          NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
        metadata     JSONB        NOT NULL DEFAULT '{}',
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    console.log('[migrate] feature_flags table ready');
  } catch (err) {
    console.error('[migrate] feature flags migrations failed:', err.message);
    throw err;
  }
}

export async function runJobQueueMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS job_queue (
        id           BIGSERIAL    PRIMARY KEY,
        type         VARCHAR(64)  NOT NULL,
        payload      JSONB        NOT NULL DEFAULT '{}',
        status       VARCHAR(16)  NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','running','done','failed')),
        priority     INT          NOT NULL DEFAULT 0,
        attempts     INT          NOT NULL DEFAULT 0,
        max_attempts INT          NOT NULL DEFAULT 3,
        scheduled_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        run_at       TIMESTAMPTZ,
        done_at      TIMESTAMPTZ,
        error        TEXT,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_job_queue_pending
        ON job_queue (type, scheduled_at)
        WHERE status = 'pending'
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_job_queue_created_at
        ON job_queue (created_at DESC)
    `);
    console.log('[migrate] job_queue table ready');
  } catch (err) {
    console.error('[migrate] job queue migrations failed:', err.message);
    throw err;
  }
}

/**
 * Sprint 11a — Soccer scaffolding.
 *
 * Adds:
 *   - `league VARCHAR(32)` on `picks` and `pick_features` — second dimension
 *     alongside `sport='soccer'` so every soccer pick is tied to a specific league.
 *   - `soccer_games` cache table (keyed by league + date).
 */
export async function runSoccerScaffoldingMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── league column on picks + pick_features ────────────────────────────────
    await client.query(`ALTER TABLE picks         ADD COLUMN IF NOT EXISTS league VARCHAR(32)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS league VARCHAR(32)`);

    // ── soccer_games cache (league-aware, keyed by league+game_id) ────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS soccer_games (
        id              BIGSERIAL    PRIMARY KEY,
        game_id         VARCHAR(20)  NOT NULL,
        league          VARCHAR(32)  NOT NULL,
        game_date       DATE,
        home_team_id    VARCHAR(20),
        away_team_id    VARCHAR(20),
        home_team_abbr  VARCHAR(10),
        away_team_abbr  VARCHAR(10),
        home_team_name  VARCHAR(80),
        away_team_name  VARCHAR(80),
        status          VARCHAR(40),
        home_score      INTEGER,
        away_score      INTEGER,
        venue           VARCHAR(120),
        created_at      TIMESTAMPTZ  DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  DEFAULT NOW(),
        UNIQUE (game_id, league)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_soccer_games_date_league ON soccer_games(game_date DESC, league)`);

    await client.query('COMMIT');
    console.log('[migrate] soccer-scaffolding ready (league column, soccer_games)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] soccer-scaffolding migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sprint 11.1 — Soccer dataset isolation.
 *
 * Adds soccer-specific feature columns to `pick_features`. Other sports keep NULL.
 * Mirrors runNhlDatasetMigrations.
 */
export async function runSoccerDatasetMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── team form / goals ─────────────────────────────────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_goals_for     DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_goals_for     DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_goals_against DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_goals_against DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_goal_diff     INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_goal_diff     INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_points        INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_points        INTEGER`);

    // ── xG (null until FBref/Understat integration) ───────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_xg  DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_xg  DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_xga DECIMAL(5,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_xga DECIMAL(5,2)`);

    // ── odds market ───────────────────────────────────────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS draw_price DECIMAL(6,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS btts_yes_price DECIMAL(6,2)`);

    await client.query('COMMIT');
    console.log('[migrate] soccer-dataset ready (pick_features soccer columns)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] soccer-dataset migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sprint 12a — Tennis scaffolding.
 *
 * Tennis is the first individual sport. It reuses the `league` column Soccer
 * added (here `league` holds the tour: 'atp' | 'wta') and the home/away slots
 * of pick_features (player A → home slot, player B → away slot). This migration
 * adds only the `tennis_matches` cache table; the `league` column already exists.
 */
export async function runTennisScaffoldingMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // `league` column on picks/pick_features already added by Soccer (11a);
    // tennis reuses it for the tour. Re-assert idempotently in case tennis
    // ships before soccer in some environment.
    await client.query(`ALTER TABLE picks         ADD COLUMN IF NOT EXISTS league VARCHAR(32)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS league VARCHAR(32)`);

    // ── tennis_matches cache (tour-aware, keyed by tour+match_id) ─────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS tennis_matches (
        id                BIGSERIAL    PRIMARY KEY,
        match_id          VARCHAR(20)  NOT NULL,
        tour              VARCHAR(8)   NOT NULL,
        tournament_id     VARCHAR(20),
        tournament_name   VARCHAR(160),
        surface           VARCHAR(10),
        round             VARCHAR(80),
        round_depth       INTEGER,
        best_of           INTEGER,
        match_date        DATE,
        player_a_id       VARCHAR(20),
        player_b_id       VARCHAR(20),
        player_a_name     VARCHAR(120),
        player_b_name     VARCHAR(120),
        status            VARCHAR(40),
        status_name       VARCHAR(40),
        score_json        JSONB,
        winner            VARCHAR(8),
        created_at        TIMESTAMPTZ  DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  DEFAULT NOW(),
        UNIQUE (match_id, tour)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tennis_matches_date_tour ON tennis_matches(match_date DESC, tour)`);

    await client.query('COMMIT');
    console.log('[migrate] tennis-scaffolding ready (tennis_matches, league reused as tour)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] tennis-scaffolding migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sprint 12a — Tennis dataset isolation.
 *
 * Adds tennis-specific feature columns to `pick_features`, reusing the home/away
 * slots (player A → home, player B → away). Other sports keep NULL.
 * Mirrors runSoccerDatasetMigrations.
 */
export async function runTennisDatasetMigrations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── ELO (surface + overall) — null until Sackmann fetcher (12b) ───────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_elo_surface DECIMAL(7,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_elo_surface DECIMAL(7,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_elo_overall DECIMAL(7,2)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_elo_overall DECIMAL(7,2)`);

    // ── rankings ──────────────────────────────────────────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_rank INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_rank INTEGER`);

    // ── head-to-head (total + by surface) ─────────────────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS h2h_total_wins_home   INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS h2h_total_wins_away   INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS h2h_surface_wins_home INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS h2h_surface_wins_away INTEGER`);

    // ── match context + fatigue ───────────────────────────────────────────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS surface VARCHAR(10)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS tournament_round INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS best_of INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_rest_days INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_rest_days INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS home_sets_played_tourney INTEGER`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS away_sets_played_tourney INTEGER`);

    // ── odds market (set handicap / total games — irregular coverage) ─────────
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS set_handicap_close DECIMAL(4,1)`);
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS total_games_close  DECIMAL(4,1)`);

    // ── pick orientation — needed to derive "player A won" from result for ML ──
    // (tennis has no box-score columns; pick_side + result give the binary target)
    await client.query(`ALTER TABLE pick_features ADD COLUMN IF NOT EXISTS pick_side VARCHAR(10)`);

    await client.query('COMMIT');
    console.log('[migrate] tennis-dataset ready (pick_features tennis columns)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] tennis-dataset migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function runMundialMigrations() {
  // Drop old schema if it still has predicted_side (breaking change to exact-score)
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='mundial_predictions' AND column_name='predicted_side') THEN
        DROP TABLE mundial_predictions CASCADE;
      END IF;
    END $$
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mundial_predictions (
      id              BIGSERIAL PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id        VARCHAR(64) NOT NULL,
      home_team       VARCHAR(128) NOT NULL,
      away_team       VARCHAR(128) NOT NULL,
      game_date       DATE NOT NULL,
      predicted_home  SMALLINT NOT NULL DEFAULT 0,
      predicted_away  SMALLINT NOT NULL DEFAULT 0,
      actual_home     SMALLINT,
      actual_away     SMALLINT,
      credits_earned  INTEGER DEFAULT 0,
      status          VARCHAR(20) DEFAULT 'pending',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      resolved_at     TIMESTAMPTZ,
      CONSTRAINT uq_mundial_user_event UNIQUE (user_id, event_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mundial_user   ON mundial_predictions(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mundial_event  ON mundial_predictions(event_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mundial_date   ON mundial_predictions(game_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mundial_status ON mundial_predictions(status)`);
  console.log('[migrate] mundial_predictions ready');
}

export async function runSportAccessMigrations() {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sport_access TEXT[] DEFAULT '{mlb}'`);
  console.log('[migrate] sport_access column ready');
}
