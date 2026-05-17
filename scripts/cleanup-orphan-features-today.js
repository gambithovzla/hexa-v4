#!/usr/bin/env node
/**
 * Deletes orphan pick_features (pick_id IS NULL, no backtest) for today (America/Lima date).
 * Usage: node --env-file=.env scripts/cleanup-orphan-features-today.js [--dry-run]
 */

import pool from '../server/db.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const todayRes = await pool.query(
    `SELECT TO_CHAR((NOW() AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD') AS today_lima`
  );
  const todayKey = todayRes.rows[0]?.today_lima;
  if (!todayKey) {
    console.error('[cleanup] Could not resolve Lima date');
    process.exit(1);
  }

  const preview = await pool.query(
    `SELECT id, game_pk, game_date, pick, result, user_email, created_at
     FROM pick_features
     WHERE pick_id IS NULL
       AND backtest_id IS NULL
       AND (
         game_date = $1::date
         OR (created_at AT TIME ZONE 'America/Lima')::date = $1::date
       )
     ORDER BY created_at DESC`,
    [todayKey]
  );

  const deletedLinked = await pool.query(
    `SELECT pf.id, pf.pick_id, pf.game_date, pf.pick, pf.user_email, p.deleted_at, p.source
     FROM pick_features pf
     INNER JOIN picks p ON p.id = pf.pick_id
     WHERE p.deleted_at IS NOT NULL
       AND COALESCE(p.source, 'live') <> 'oracle_chat'
       AND (
         pf.game_date = $1::date
         OR (pf.created_at AT TIME ZONE 'America/Lima')::date = $1::date
       )
     ORDER BY pf.created_at DESC`,
    [todayKey]
  );

  console.log(`[cleanup] Lima today: ${todayKey}`);
  console.log(`[cleanup] Orphan pick_features: ${preview.rows.length}`);
  console.log(`[cleanup] pick_features linked to deleted picks: ${deletedLinked.rows.length}`);
  for (const row of preview.rows) {
    console.log(
      `  id=${row.id} game_pk=${row.game_pk} pick=${JSON.stringify(row.pick)} ` +
      `result=${row.result ?? '—'} email=${row.user_email ?? '—'} created=${row.created_at}`
    );
  }

  if (dryRun) {
    console.log('[cleanup] Dry run — no rows deleted');
    await pool.end();
    return;
  }

  const totalToDelete = preview.rows.length + deletedLinked.rows.length;
  if (totalToDelete === 0) {
    console.log('[cleanup] Nothing to delete');
    await pool.end();
    return;
  }

  for (const row of deletedLinked.rows) {
    console.log(
      `  [deleted-pick] id=${row.id} pick_id=${row.pick_id} pick=${JSON.stringify(row.pick)} ` +
      `email=${row.user_email ?? '—'}`
    );
  }

  const delPfOrphans = await pool.query(
    `DELETE FROM pick_features
     WHERE pick_id IS NULL
       AND backtest_id IS NULL
       AND (
         game_date = $1::date
         OR (created_at AT TIME ZONE 'America/Lima')::date = $1::date
       )`,
    [todayKey]
  );

  const delPfDeleted = await pool.query(
    `DELETE FROM pick_features pf
     USING picks p
     WHERE pf.pick_id = p.id
       AND p.deleted_at IS NOT NULL
       AND COALESCE(p.source, 'live') <> 'oracle_chat'
       AND (
         pf.game_date = $1::date
         OR (pf.created_at AT TIME ZONE 'America/Lima')::date = $1::date
       )`,
    [todayKey]
  );

  const delShadow = await pool.query(
    `DELETE FROM shadow_model_runs
     WHERE pick_id IS NULL
       AND backtest_id IS NULL
       AND (
         game_date = $1::date
         OR (created_at AT TIME ZONE 'America/Lima')::date = $1::date
       )`,
    [todayKey]
  );

  const delShadowDeleted = await pool.query(
    `DELETE FROM shadow_model_runs sm
     USING picks p
     WHERE sm.pick_id = p.id
       AND p.deleted_at IS NOT NULL
       AND (
         sm.game_date = $1::date
         OR (sm.created_at AT TIME ZONE 'America/Lima')::date = $1::date
       )`,
    [todayKey]
  );

  console.log(`[cleanup] Deleted orphan pick_features: ${delPfOrphans.rowCount ?? 0}`);
  console.log(`[cleanup] Deleted pick_features (deleted picks): ${delPfDeleted.rowCount ?? 0}`);
  console.log(`[cleanup] Deleted orphan shadow_model_runs: ${delShadow.rowCount ?? 0}`);
  console.log(`[cleanup] Deleted shadow_model_runs (deleted picks): ${delShadowDeleted.rowCount ?? 0}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[cleanup] failed:', err.message);
  process.exit(1);
});
