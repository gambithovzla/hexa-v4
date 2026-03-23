/**
 * db.js — PostgreSQL connection pool for H.E.X.A. V4
 *
 * If DATABASE_URL is not set, runs in no-op mode: all DB operations
 * are mocked and return empty results so the process can continue.
 */

import pg from 'pg';

const { Pool } = pg;

let pool;

if (!process.env.DATABASE_URL) {
  console.warn('[DB] WARNING: No database configured. Picks will not be saved.');

  // Mock pool: all queries silently return empty results
  pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => {},
    }),
    on: () => {},
    end: async () => {},
  };
} else {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  pool.on('error', (err) => {
    console.error('[H.E.X.A.] Unexpected PostgreSQL pool error:', err.message);
  });
}

export default pool;
