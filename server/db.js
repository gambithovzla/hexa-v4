/**
 * db.js — PostgreSQL connection pool for H.E.X.A. V4
 *
 * Reads DATABASE_URL from the environment. Exits with a clear error message
 * if the variable is not set, so misconfigured deploys fail fast.
 */

import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('[H.E.X.A.] FATAL: DATABASE_URL environment variable is not set.');
  console.error('[H.E.X.A.] Add DATABASE_URL=postgresql://user:pass@host:5432/dbname to your .env file.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[H.E.X.A.] Unexpected PostgreSQL pool error:', err.message);
});

export default pool;
