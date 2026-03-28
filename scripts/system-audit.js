/**
 * scripts/system-audit.js — H.E.X.A. V4 Pre-Opening Day System Audit
 *
 * Usage:  node scripts/system-audit.js
 *         npm run audit
 *
 * Runs 4 health checks against the PostgreSQL DB and the in-memory Statcast
 * cache module, then prints a structured report to stdout.
 *
 * Exit codes:
 *   0  — all checks passed (warnings are acceptable)
 *   1  — one or more checks failed or DATABASE_URL is not set
 */

import 'dotenv/config';
import pg from 'pg';
import { getCacheStatus } from '../server/savant-fetcher.js';

const { Pool } = pg;

// ── Colour helpers (no external deps) ─────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const DIM    = '\x1b[2m';

const ok   = (msg) => `${GREEN}✔ PASS${RESET}  ${msg}`;
const warn = (msg) => `${YELLOW}⚠ WARN${RESET}  ${msg}`;
const fail = (msg) => `${RED}✘ FAIL${RESET}  ${msg}`;
const info = (msg) => `${DIM}  →${RESET} ${msg}`;

// ── Audit runner ──────────────────────────────────────────────────────────────

const EXPECTED_STATCAST_RECORDS = 26_018;

async function runAudit() {
  const startTime = Date.now();
  const results   = [];   // { label, status: 'pass'|'warn'|'fail', lines: string[] }

  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║       H.E.X.A. V4 — PRE-OPENING DAY AUDIT       ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${RESET}`);
  console.log(`${DIM}  Started: ${new Date().toISOString()}${RESET}\n`);

  // ── Validate DATABASE_URL early ──────────────────────────────────────────────

  if (!process.env.DATABASE_URL) {
    console.error(fail('DATABASE_URL environment variable is not set.'));
    console.error(info('Set DATABASE_URL in your .env file before running the audit.'));
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
  });

  // ── CHECK 1: DB Connection ───────────────────────────────────────────────────

  {
    const label = 'Check 1 — DB Connection (PostgreSQL)';
    const lines = [];
    let status  = 'pass';

    try {
      const res = await pool.query('SELECT version(), NOW() AS server_time');
      const row = res.rows[0];
      lines.push(ok('Successfully connected to PostgreSQL'));
      lines.push(info(`Server: ${row.version.split(' ').slice(0, 2).join(' ')}`));
      lines.push(info(`Server time: ${row.server_time.toISOString()}`));
      lines.push(info(`DATABASE_URL host: ${new URL(process.env.DATABASE_URL).hostname}`));
    } catch (err) {
      status = 'fail';
      lines.push(fail(`Could not connect to PostgreSQL: ${err.message}`));
    }

    results.push({ label, status, lines });
  }

  // ── CHECK 2: Statcast Cache ──────────────────────────────────────────────────

  {
    const label = 'Check 2 — Statcast Cache (in-memory leaderboards)';
    const lines = [];
    let status  = 'pass';

    try {
      const cacheStatus = getCacheStatus();
      const counts      = cacheStatus.recordCounts ?? {};
      const total       = Object.values(counts).reduce((sum, n) => sum + n, 0);
      const populated   = total > 0;

      lines.push(info('Statcast data uses an in-memory cache (no DB table). Cache is populated at server startup.'));
      lines.push(info(`Expected total records across all leaderboards: ${EXPECTED_STATCAST_RECORDS.toLocaleString()}`));
      lines.push(info(`Current cached total: ${total.toLocaleString()} records`));

      if (populated) {
        const pct = ((total / EXPECTED_STATCAST_RECORDS) * 100).toFixed(1);
        if (total >= EXPECTED_STATCAST_RECORDS * 0.9) {
          lines.push(ok(`Cache is populated — ${total.toLocaleString()} records (${pct}% of expected)`));
        } else {
          status = 'warn';
          lines.push(warn(`Cache partially populated — ${total.toLocaleString()} / ${EXPECTED_STATCAST_RECORDS.toLocaleString()} records (${pct}%)`));
        }

        // Show per-leaderboard breakdown (non-zero entries only)
        const populated_boards = Object.entries(counts).filter(([, n]) => n > 0);
        if (populated_boards.length > 0) {
          lines.push(info('Leaderboard breakdown (populated):'));
          for (const [key, count] of populated_boards) {
            lines.push(info(`  ${key.padEnd(22)} ${count.toLocaleString()} records`));
          }
        }

        if (cacheStatus.lastUpdated) {
          lines.push(info(`Last updated: ${cacheStatus.lastUpdated} (${cacheStatus.age_minutes} min ago)`));
        }
      } else {
        status = 'warn';
        lines.push(warn('Cache is empty — server has not been started or cache module not initialised in this process.'));
        lines.push(info('This is expected when running the audit script standalone (outside the live server).'));
        lines.push(info('Start the server and re-run to validate populated cache counts.'));
      }

      // Validate the module itself is importable and returns expected shape
      if (typeof getCacheStatus === 'function' && typeof counts === 'object') {
        lines.push(ok('savant-fetcher module imported successfully — getCacheStatus() is functional'));
      }
    } catch (err) {
      status = 'fail';
      lines.push(fail(`Failed to read Statcast cache status: ${err.message}`));
    }

    results.push({ label, status, lines });
  }

  // ── CHECK 3: Economy & Credits ───────────────────────────────────────────────

  {
    const label = 'Check 3 — Economy & Credits (users table)';
    const lines = [];
    let status  = 'pass';

    try {
      // 3a. Verify the credits column exists on users
      const colRes = await pool.query(`
        SELECT column_name, data_type, column_default
        FROM   information_schema.columns
        WHERE  table_schema = 'public'
          AND  table_name   = 'users'
          AND  column_name  = 'credits'
      `);

      if (colRes.rowCount === 0) {
        status = 'fail';
        lines.push(fail('Column users.credits does NOT exist — economy system is not migrated'));
      } else {
        const col = colRes.rows[0];
        lines.push(ok(`Column users.credits exists (type: ${col.data_type}, default: ${col.column_default ?? 'none'})`));
      }

      // 3b. Count total users and users with credits
      const usersRes = await pool.query(`
        SELECT
          COUNT(*)                          AS total_users,
          COUNT(*) FILTER (WHERE credits > 0) AS users_with_credits,
          MAX(credits)                      AS max_credits,
          SUM(credits)                      AS total_credits
        FROM users
      `);

      if (usersRes.rowCount > 0) {
        const { total_users, users_with_credits, max_credits, total_credits } = usersRes.rows[0];
        lines.push(info(`Total registered users: ${total_users}`));
        lines.push(info(`Users with credits > 0: ${users_with_credits}`));
        lines.push(info(`Total credits in system: ${total_credits ?? 0}`));

        if (parseInt(users_with_credits, 10) === 0) {
          status = status === 'fail' ? 'fail' : 'warn';
          lines.push(warn('No users have credits assigned yet — assign credits to the admin account before Opening Day'));
        } else {
          lines.push(ok(`Admin/users have credits — max single balance: ${max_credits} credits`));
        }
      }

      // 3c. Show admin-level user (highest credits)
      const adminRes = await pool.query(`
        SELECT email, credits, created_at
        FROM   users
        WHERE  credits > 0
        ORDER  BY credits DESC
        LIMIT  1
      `);

      if (adminRes.rowCount > 0) {
        const admin = adminRes.rows[0];
        lines.push(info(`Top credits holder: ${admin.email} — ${admin.credits} credits (registered ${new Date(admin.created_at).toLocaleDateString()})`));
      }
    } catch (err) {
      status = 'fail';
      lines.push(fail(`Economy check failed: ${err.message}`));
    }

    results.push({ label, status, lines });
  }

  // ── CHECK 4: Bankroll & Kelly / CLV ─────────────────────────────────────────

  {
    const label = 'Check 4 — Bankroll & Kelly / CLV (bankroll + bets + picks tables)';
    const lines = [];
    let status  = 'pass';

    // Required columns for each table
    const requirements = {
      bankroll: ['user_id', 'initial_bankroll', 'current_bankroll', 'updated_at'],
      bets:     ['id', 'user_id', 'stake', 'potential_win', 'result', 'odds'],
      picks:    ['id', 'user_id', 'odds_at_pick', 'closing_odds', 'clv'],
    };

    try {
      const colsRes = await pool.query(`
        SELECT table_name, column_name
        FROM   information_schema.columns
        WHERE  table_schema = 'public'
          AND  table_name   = ANY($1)
        ORDER  BY table_name, ordinal_position
      `, [Object.keys(requirements)]);

      // Group by table
      const presentCols = {};
      for (const { table_name, column_name } of colsRes.rows) {
        if (!presentCols[table_name]) presentCols[table_name] = new Set();
        presentCols[table_name].add(column_name);
      }

      for (const [table, requiredCols] of Object.entries(requirements)) {
        const present = presentCols[table] ?? new Set();

        if (present.size === 0) {
          status = 'fail';
          lines.push(fail(`Table "${table}" does not exist or has no columns`));
          continue;
        }

        const missing = requiredCols.filter(c => !present.has(c));

        if (missing.length === 0) {
          lines.push(ok(`Table "${table}" has all required columns (${requiredCols.join(', ')})`));
        } else {
          status = 'fail';
          lines.push(fail(`Table "${table}" is missing column(s): ${missing.join(', ')}`));
        }
      }

      // ROI summary from bets (if any resolved bets exist)
      const roiRes = await pool.query(`
        SELECT
          COUNT(*)                                           AS total_bets,
          COUNT(*) FILTER (WHERE result = 'win')            AS wins,
          COUNT(*) FILTER (WHERE result = 'loss')           AS losses,
          COUNT(*) FILTER (WHERE result = 'pending')        AS pending,
          SUM(stake)                                        AS total_staked,
          SUM(potential_win) FILTER (WHERE result = 'win')  AS total_won,
          SUM(stake)         FILTER (WHERE result = 'loss') AS total_lost
        FROM bets
      `);

      if (roiRes.rowCount > 0) {
        const r = roiRes.rows[0];
        const staked = parseFloat(r.total_staked) || 0;
        const won    = parseFloat(r.total_won)    || 0;
        const lost   = parseFloat(r.total_lost)   || 0;
        const roi    = staked > 0 ? (((won - lost) / staked) * 100).toFixed(2) : null;

        lines.push(info(`Bets on record: ${r.total_bets} total (${r.wins} wins / ${r.losses} losses / ${r.pending} pending)`));
        if (roi !== null) {
          lines.push(info(`Calculated ROI: ${roi}%  (staked: $${staked.toFixed(2)}, won: $${won.toFixed(2)}, lost: $${lost.toFixed(2)})`));
        }
      }

      // CLV data availability in picks
      const clvRes = await pool.query(`
        SELECT
          COUNT(*)                             AS total_picks,
          COUNT(*) FILTER (WHERE clv IS NOT NULL) AS picks_with_clv,
          ROUND(AVG(clv) FILTER (WHERE clv IS NOT NULL), 2) AS avg_clv
        FROM picks
      `);

      if (clvRes.rowCount > 0) {
        const { total_picks, picks_with_clv, avg_clv } = clvRes.rows[0];
        lines.push(info(`Picks on record: ${total_picks} total, ${picks_with_clv} with CLV data`));
        if (parseInt(picks_with_clv, 10) > 0) {
          lines.push(info(`Average CLV: ${avg_clv}%`));
          lines.push(ok('CLV (Closing Line Value) tracking is operational'));
        } else {
          lines.push(info('No CLV data yet — CLV columns exist and are ready to receive data'));
        }
      }
    } catch (err) {
      status = 'fail';
      lines.push(fail(`Bankroll/Kelly check failed: ${err.message}`));
    }

    results.push({ label, status, lines });
  }

  // ── Print structured report ──────────────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  let   allPassed = true;

  console.log(`${BOLD}${CYAN}── AUDIT RESULTS ──────────────────────────────────────${RESET}\n`);

  for (const { label, status, lines } of results) {
    const badge =
      status === 'pass' ? `${GREEN}[PASS]${RESET}` :
      status === 'warn' ? `${YELLOW}[WARN]${RESET}` :
                          `${RED}[FAIL]${RESET}`;

    console.log(`  ${badge} ${BOLD}${label}${RESET}`);
    for (const line of lines) {
      console.log(`         ${line}`);
    }
    console.log();

    if (status === 'fail') allPassed = false;
  }

  // ── Summary ─────────────────────────────────────────────────────────────────

  const passCount = results.filter(r => r.status === 'pass').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const failCount = results.filter(r => r.status === 'fail').length;

  console.log(`${BOLD}${CYAN}── SUMMARY ─────────────────────────────────────────────${RESET}`);
  console.log(`  ${GREEN}Passed${RESET}: ${passCount}  ${YELLOW}Warnings${RESET}: ${warnCount}  ${RED}Failed${RESET}: ${failCount}`);
  console.log(`  Completed in ${elapsed}s`);

  if (allPassed) {
    console.log(`\n  ${GREEN}${BOLD}✔ System is ready for Opening Day.${RESET}\n`);
  } else {
    console.log(`\n  ${RED}${BOLD}✘ One or more checks failed — review the output above before Opening Day.${RESET}\n`);
  }

  await pool.end();
  process.exit(allPassed ? 0 : 1);
}

runAudit().catch((err) => {
  console.error(`\n${RED}${BOLD}[AUDIT] Fatal error:${RESET}`, err.message);
  process.exit(1);
});
