#!/usr/bin/env node

/**
 * Audit and rotate the password of an admin account.
 *
 * Audit (read-only):
 *   node --env-file=.env scripts/ops/rotate-admin-password.js
 *
 * Rotate (asks for the new password with hidden input, never prints it):
 *   node --env-file=.env scripts/ops/rotate-admin-password.js --rotate
 *
 * Rotate with a generated password written to a file (mode 600), never printed:
 *   node --env-file=.env scripts/ops/rotate-admin-password.js --rotate --generate-to=<path>
 *
 * Options:
 *   --email=<addr>   account to inspect (default admin@hexa.com)
 *
 * DATABASE_URL must be the PUBLIC Postgres URL when run outside Railway.
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import readline from 'node:readline';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const ROTATE = args.includes('--rotate');
const EMAIL = (args.find((a) => a.startsWith('--email='))?.slice(8) ?? 'admin@hexa.com').toLowerCase();
const GENERATE_TO = args.find((a) => a.startsWith('--generate-to='))?.slice(14) ?? null;
const MIN_LENGTH = 20;

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    // readline has no public "no echo" option; this is the standard workaround.
    rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); };
    rl.question(question, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

async function auditActivity(client, userId) {
  const { rows: tables } = await client.query(`
    SELECT c.table_name,
           bool_or(c2.column_name = 'created_at') AS has_created_at
      FROM information_schema.columns c
      LEFT JOIN information_schema.columns c2
        ON c2.table_schema = c.table_schema AND c2.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'user_id'
     GROUP BY c.table_name
     ORDER BY c.table_name`);

  console.log('\nActivity linked to this account (tables with user_id):');
  for (const { table_name: table, has_created_at: hasCreatedAt } of tables) {
    const sql = hasCreatedAt
      ? `SELECT COUNT(*)::int AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM "${table}" WHERE user_id = $1`
      : `SELECT COUNT(*)::int AS n FROM "${table}" WHERE user_id = $1`;
    try {
      const { rows: [r] } = await client.query(sql, [userId]);
      if (r.n === 0) continue;
      const range = hasCreatedAt ? `  first=${r.first?.toISOString?.() ?? r.first}  last=${r.last?.toISOString?.() ?? r.last}` : '';
      console.log(`  ${table.padEnd(32)} rows=${String(r.n).padEnd(6)}${range}`);
    } catch (err) {
      console.log(`  ${table.padEnd(32)} (skipped: ${err.message})`);
    }
  }
}

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new pg.Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `SELECT id, email, is_admin, credits, email_verified, created_at,
              password_reset_requested_at, password_reset_attempts
         FROM users WHERE lower(email) = $1`,
      [EMAIL]
    );
    if (rows.length === 0) {
      console.log(`[admin-rotate] ${EMAIL} does not exist — nothing to rotate.`);
      return;
    }
    const u = rows[0];
    console.log(`[admin-rotate] account ${u.email}`);
    console.log(`  id=${u.id}`);
    console.log(`  is_admin=${u.is_admin}  credits=${u.credits}  email_verified=${u.email_verified}`);
    console.log(`  created_at=${u.created_at?.toISOString?.()}`);
    console.log(`  password_reset_requested_at=${u.password_reset_requested_at ?? 'never'}  reset_attempts=${u.password_reset_attempts ?? 0}`);

    const { rows: admins } = await client.query(
      `SELECT email, created_at FROM users WHERE is_admin = true ORDER BY created_at`
    );
    console.log(`\nAll admin accounts (${admins.length}):`);
    for (const a of admins) console.log(`  ${a.email}  created_at=${a.created_at?.toISOString?.()}`);

    await auditActivity(client, u.id);

    if (!ROTATE) {
      console.log('\nRead-only audit done. Re-run with --rotate to set a new password.');
      return;
    }

    let pw1;
    if (GENERATE_TO) {
      if (fs.existsSync(GENERATE_TO)) throw new Error(`${GENERATE_TO} already exists — refusing to overwrite`);
      pw1 = randomBytes(24).toString('base64url');
      fs.writeFileSync(GENERATE_TO, `${u.email}\n${pw1}\n`, { mode: 0o600, flag: 'wx' });
      console.log(`\n[admin-rotate] generated password written to ${GENERATE_TO}`);
    } else {
      pw1 = await promptHidden(`\nNew password for ${u.email} (min ${MIN_LENGTH} chars, hidden): `);
      if (pw1.length < MIN_LENGTH) throw new Error(`password must be at least ${MIN_LENGTH} characters`);
      const pw2 = await promptHidden('Repeat it: ');
      if (pw1 !== pw2) throw new Error('passwords do not match');
    }

    const hash = await bcrypt.hash(pw1, 10);
    const { rowCount } = await client.query(
      `UPDATE users
          SET password_hash = $1,
              password_reset_code_hash = NULL,
              password_reset_expires = NULL,
              password_reset_attempts = 0
        WHERE id = $2`,
      [hash, u.id]
    );
    console.log(`[admin-rotate] password updated (${rowCount} row). Existing JWTs stay valid until JWT_SECRET is rotated.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(`[admin-rotate] FAIL ${err.message}`);
  process.exitCode = 1;
});
