/**
 * backup.js — Exports critical tables to JSON files
 *
 * Usage: node scripts/backup.js
 *
 * Exports: picks, backtest_results, users (sin password_hash), bets, bankroll
 * Output: scripts/backups/backup-YYYY-MM-DD-HHmmss.json
 *
 * Requires DATABASE_URL environment variable
 */

import pg from 'pg';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable required');
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = join(__dirname, 'backups');

  try { mkdirSync(backupDir, { recursive: true }); } catch {}

  console.log(`[backup] Starting backup at ${new Date().toISOString()}`);

  const backup = {};

  // Users (sin password hash por seguridad)
  const users = await pool.query('SELECT id, email, credits, is_admin, email_verified, created_at FROM users ORDER BY created_at');
  backup.users = users.rows;
  console.log(`[backup] Users: ${users.rows.length}`);

  // Picks (incluyendo soft-deleted)
  const picks = await pool.query('SELECT * FROM picks ORDER BY created_at');
  backup.picks = picks.rows;
  console.log(`[backup] Picks: ${picks.rows.length}`);

  // Backtest results
  try {
    const bt = await pool.query('SELECT * FROM backtest_results ORDER BY created_at');
    backup.backtest_results = bt.rows;
    console.log(`[backup] Backtest results: ${bt.rows.length}`);
  } catch {
    backup.backtest_results = [];
    console.log(`[backup] Backtest results: table not found (skipping)`);
  }

  // Bets
  try {
    const bets = await pool.query('SELECT * FROM bets ORDER BY created_at');
    backup.bets = bets.rows;
    console.log(`[backup] Bets: ${bets.rows.length}`);
  } catch {
    backup.bets = [];
    console.log(`[backup] Bets: table not found (skipping)`);
  }

  // Bankroll
  try {
    const bankroll = await pool.query('SELECT * FROM bankroll');
    backup.bankroll = bankroll.rows;
    console.log(`[backup] Bankroll: ${bankroll.rows.length}`);
  } catch {
    backup.bankroll = [];
    console.log(`[backup] Bankroll: table not found (skipping)`);
  }

  // Odds snapshots
  try {
    const odds = await pool.query('SELECT * FROM odds_snapshots ORDER BY captured_at DESC LIMIT 500');
    backup.odds_snapshots = odds.rows;
    console.log(`[backup] Odds snapshots: ${odds.rows.length} (last 500)`);
  } catch {
    backup.odds_snapshots = [];
  }

  // Metadata
  backup._meta = {
    created_at: new Date().toISOString(),
    tables: Object.keys(backup).filter(k => k !== '_meta'),
    total_records: Object.entries(backup).filter(([k]) => k !== '_meta').reduce((sum, [, v]) => sum + (Array.isArray(v) ? v.length : 0), 0),
  };

  const filename = `backup-${timestamp}.json`;
  const filepath = join(backupDir, filename);
  writeFileSync(filepath, JSON.stringify(backup, null, 2));

  console.log(`\n[backup] ✅ Saved to ${filepath}`);
  console.log(`[backup] Total records: ${backup._meta.total_records}`);

  await pool.end();
}

main().catch(err => {
  console.error('[backup] Fatal error:', err.message);
  process.exit(1);
});
