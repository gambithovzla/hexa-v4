#!/usr/bin/env node
import pool from '../server/db.js';

const IDS = [764, 778, 787, 788];

async function main() {
  const { rows } = await pool.query(
    `SELECT id, type, source, pick, matchup, user_email, chat_session_id,
            deleted_at, result, game_pk, game_date, created_at
     FROM picks
     WHERE id = ANY($1::int[])
     ORDER BY id`,
    [IDS]
  );
  console.log(`Found ${rows.length} picks (may be soft-deleted):\n`);
  for (const r of rows) {
    console.log(JSON.stringify(r, null, 2));
    console.log('---');
  }

  const pf = await pool.query(
    `SELECT id, pick_id, source, pick, user_email, game_date
     FROM pick_features
     WHERE pick_id = ANY($1::int[])`,
    [IDS]
  );
  console.log(`\npick_features remaining for those pick_ids: ${pf.rows.length}`);
  for (const r of pf.rows) {
    console.log(JSON.stringify(r));
  }

  const chatToday = await pool.query(
    `SELECT p.id, p.source, p.type, p.pick, p.deleted_at, pf.id AS pf_id, pf.source AS pf_source
     FROM picks p
     LEFT JOIN pick_features pf ON pf.pick_id = p.id
     WHERE p.source = 'oracle_chat'
       AND (
         p.game_date = (NOW() AT TIME ZONE 'America/Lima')::date
         OR (p.created_at AT TIME ZONE 'America/Lima')::date = (NOW() AT TIME ZONE 'America/Lima')::date
       )
     ORDER BY p.id DESC
     LIMIT 20`
  );
  console.log(`\nOracle chat picks today: ${chatToday.rows.length}`);
  for (const r of chatToday.rows) {
    console.log(JSON.stringify(r));
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
