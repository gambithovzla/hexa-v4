/**
 * prop-brier-gate.js — counts resolved prop picks per prop_kind for go-live gate.
 *
 * Usage: node --env-file=.env scripts/training/prop-brier-gate.js
 */
import pool from '../../server/db.js';

const MIN_RESOLVED = Number(process.env.MLB_PROPS_ML_MIN_RESOLVED ?? 100);
const PROP_KINDS = ['hits', 'strikeouts', 'total_bases', 'home_runs', 'rbis'];

async function main() {
  const { rows } = await pool.query(`
    SELECT prop_kind, COUNT(*)::int AS n
    FROM pick_features
    WHERE COALESCE(sport, 'mlb') = 'mlb'
      AND market_type = 'prop'
      AND prop_kind = ANY($1::text[])
      AND result IN ('win', 'loss', 'won', 'lost')
    GROUP BY prop_kind
    ORDER BY prop_kind
  `, [PROP_KINDS]);

  const counts = Object.fromEntries(PROP_KINDS.map((k) => [k, 0]));
  for (const row of rows) counts[row.prop_kind] = row.n;

  console.log(`[prop-brier-gate] min resolved per market: ${MIN_RESOLVED}`);
  let allPass = true;
  for (const kind of PROP_KINDS) {
    const n = counts[kind] ?? 0;
    const pass = n >= MIN_RESOLVED;
    if (!pass) allPass = false;
    console.log(`  ${kind.padEnd(14)} ${String(n).padStart(5)}  ${pass ? 'PASS' : 'FAIL'}`);
  }
  console.log(allPass ? '\nGate: PASS — safe to set MLB_PROPS_ML_PUBLIC_ENABLED=1' : '\nGate: FAIL — keep MLB_PROPS_ML_PUBLIC_ENABLED=0');
  await pool.end();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('[prop-brier-gate] failed:', err.message);
  process.exit(1);
});
