import pool from '../db.js';

export async function purgePickTrainingRows(pickId) {
  const pickRes = await pool.query(
    `SELECT id, game_pk, game_date, pick, source FROM picks WHERE id = $1`,
    [pickId]
  );
  const pick = pickRes.rows[0];
  if (!pick) return { pickFeatures: 0, orphans: 0, shadowRuns: 0, chatPreserved: false };

  let pickFeaturesDeleted = 0;
  if (pick.source === 'oracle_chat') {
    console.log(`[pickTrainingCleanup] preserving pick_features for oracle_chat pick ${pickId}`);
  } else {
    const pfRes = await pool.query(
      'DELETE FROM pick_features WHERE pick_id = $1',
      [pickId]
    );
    pickFeaturesDeleted = pfRes.rowCount ?? 0;
  }

  let orphanCount = 0;
  if (pick.game_pk != null && pick.pick) {
    const orphanRes = await pool.query(
      `DELETE FROM pick_features
       WHERE pick_id IS NULL
         AND game_pk = $1
         AND game_date IS NOT DISTINCT FROM $2
         AND pick = $3`,
      [pick.game_pk, pick.game_date, pick.pick]
    );
    orphanCount = orphanRes.rowCount ?? 0;
  }

  const shadowRes = await pool.query(
    'DELETE FROM shadow_model_runs WHERE pick_id = $1',
    [pickId]
  );

  return {
    pickFeatures: pickFeaturesDeleted,
    orphans: orphanCount,
    shadowRuns: shadowRes.rowCount ?? 0,
    chatPreserved: pick.source === 'oracle_chat',
  };
}

export const DATASET_PICK_VISIBILITY_SQL = `
  AND (
    pf.backtest_id IS NOT NULL
    OR pf.pick_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM picks px
      WHERE px.id = pf.pick_id AND px.deleted_at IS NOT NULL
    )
  )
`;
