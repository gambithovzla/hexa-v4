#!/usr/bin/env node
/**
 * Re-creates minimal pick_features rows for oracle_chat picks that lost them.
 * Usage: node --env-file=.env scripts/restore-chat-pick-features.js [pickId ...]
 */

import pool from '../server/db.js';
import { parsePick } from '../server/parsers/pickParser.js';
import { ORACLE_CHAT_USER_LABEL } from '../server/constants/oracleChat.js';

const DEFAULT_IDS = [764, 788];

async function restoreOne(pickId) {
  const pickRes = await pool.query(
    `SELECT id, pick, game_pk, game_date, oracle_confidence, sport, source
     FROM picks WHERE id = $1`,
    [pickId]
  );
  const pick = pickRes.rows[0];
  if (!pick) {
    console.log(`[restore] pick ${pickId}: not found`);
    return false;
  }
  if (pick.source !== 'oracle_chat') {
    console.log(`[restore] pick ${pickId}: source=${pick.source} (skip, not oracle_chat)`);
    return false;
  }

  const existing = await pool.query(
    'SELECT id FROM pick_features WHERE pick_id = $1 LIMIT 1',
    [pickId]
  );
  if (existing.rows.length > 0) {
    console.log(`[restore] pick ${pickId}: pick_features already exists (id=${existing.rows[0].id})`);
    return false;
  }

  const parsed = parsePick(pick.pick ?? '');
  const dateRes = await pool.query(
    `SELECT TO_CHAR($1::timestamptz, 'YYYY-MM-DD') AS d`,
    [pick.game_date]
  );
  const gameDate = dateRes.rows[0]?.d ?? null;

  const ins = await pool.query(
    `INSERT INTO pick_features
       (pick_id, game_pk, game_date, pick, market_type, side, line,
        prop_kind, prop_player_id, oracle_confidence, source, sport, user_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'oracle_chat',$11,$12)
     RETURNING id`,
    [
      pickId,
      pick.game_pk,
      gameDate,
      pick.pick,
      parsed.market_type,
      parsed.side,
      parsed.line,
      parsed.prop_kind,
      null,
      pick.oracle_confidence,
      pick.sport ?? 'mlb',
      ORACLE_CHAT_USER_LABEL,
    ]
  );

  console.log(
    `[restore] pick ${pickId}: created pick_features id=${ins.rows[0]?.id} ` +
    `pick=${JSON.stringify(pick.pick)} market=${parsed.market_type}`
  );
  return true;
}

async function main() {
  const ids = process.argv.slice(2).map(Number).filter(Number.isFinite);
  const targetIds = ids.length > 0 ? ids : DEFAULT_IDS;
  let restored = 0;
  for (const id of targetIds) {
    if (await restoreOne(id)) restored += 1;
  }
  console.log(`[restore] done: ${restored}/${targetIds.length} restored`);
  await pool.end();
}

main().catch((err) => {
  console.error('[restore] failed:', err.message);
  process.exit(1);
});
