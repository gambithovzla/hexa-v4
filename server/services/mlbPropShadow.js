import pool from '../db.js';
import { predictProp, buildPropMLFeaturePayload, isEnabled } from './mlModelClient.js';

const PROP_KIND_TO_MARKET = {
  hits: 'prop_hits',
  strikeouts: 'prop_strikeouts',
  total_bases: 'prop_total_bases',
  home_runs: 'prop_home_runs',
  rbis: 'prop_rbis',
};

export async function scorePropPickFeatures({ featureRowId, propKind, gameFeatures = {}, propFeatures = {} }) {
  if (!isEnabled() || !featureRowId || !propKind) return null;
  const market = PROP_KIND_TO_MARKET[String(propKind).toLowerCase()];
  if (!market) return null;

  const payload = buildPropMLFeaturePayload({ ...gameFeatures, ...propFeatures });
  const prediction = await predictProp(propKind, payload);
  if (!prediction) return null;

  await pool.query(
    `UPDATE pick_features
     SET python_prop_prob = $1, python_prop_market = $2
     WHERE id = $3`,
    [prediction.probability, market, featureRowId],
  );

  return prediction;
}
