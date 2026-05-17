#!/usr/bin/env node
import pool from '../server/db.js';
import { ORACLE_CHAT_USER_LABEL } from '../server/constants/oracleChat.js';

const r1 = await pool.query(
  `UPDATE pick_features SET user_email = $1
   WHERE source = 'oracle_chat' AND (user_email IS NULL OR BTRIM(user_email) = '')`,
  [ORACLE_CHAT_USER_LABEL]
);
const r2 = await pool.query(
  `UPDATE picks SET user_email = $1
   WHERE source = 'oracle_chat' AND (user_email IS NULL OR BTRIM(user_email) = '')`,
  [ORACLE_CHAT_USER_LABEL]
);
console.log(`pick_features: ${r1.rowCount ?? 0}, picks: ${r2.rowCount ?? 0}`);
await pool.end();
