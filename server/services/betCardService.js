/**
 * betCardService.js — Daily Bet Card: the selectivity layer that turns
 * signals the system already computes (pick-aligned model probs, conviction
 * tier, calibrated confidence, market CLV history) into an explicit
 * bet / no-bet decision per pending pick of the day.
 *
 * Philosophy (mirrors the Imperdible): model certification + agreement +
 * positive edge + healthy market, or NO BET. Emitting zero bets on a full
 * slate is a correct output, not a failure mode.
 *
 * Read-only over picks / pick_features / shadow_model_runs. Never touches
 * frozen files.
 *
 * Edge semantics: impliedProb comes from the pick's own American price
 * (vig included), so the computed edge UNDERSTATES the de-vigged true edge.
 * Intentional — conservative by construction.
 */

import pool from '../db.js';

export const DEFAULT_THRESHOLDS = {
  minEdge: 0.03,
  minClvSample: 30,
  clvWindowPicks: 200,
  minCalibrated: 52,
  kellyFraction: 0.25,
  maxStakeUnits: 2,
};

export function americanToImpliedProb(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

export function americanToNetPayout(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? 100 / -n : n / 100;
}

export function normalizeProb(value) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const p = n > 1 ? n / 100 : n;
  return p >= 0 && p <= 1 ? p : null;
}

export function isFullAgreementTier(tier) {
  if (typeof tier !== 'string') return false;
  const m = tier.match(/^(\d+)\/(\d+)$/);
  return Boolean(m) && m[1] === m[2] && Number(m[2]) >= 2;
}

/**
 * Fractional Kelly stake in units (1u = 1% bankroll), capped.
 * Returns 0 when the bet has no positive expectation.
 */
export function kellyStakeUnits({ modelProb, oddsAtPick, thresholds = DEFAULT_THRESHOLDS }) {
  const p = normalizeProb(modelProb);
  const b = americanToNetPayout(oddsAtPick);
  if (p == null || b == null) return null;
  const kelly = (b * p - (1 - p)) / b;
  if (kelly <= 0) return 0;
  const units = thresholds.kellyFraction * kelly * 100;
  return Math.round(Math.min(units, thresholds.maxStakeUnits) * 100) / 100;
}

/**
 * Evaluates the hard gates for one candidate pick. Pure.
 *
 * @param {object} candidate
 *   { modelProb, modelSource, oddsAtPick, convictionTier,
 *     calibratedConfidence, sport, marketType }
 * @param {object} opts
 *   { clvTable: { 'sport:market': { avgClv, n } }, thresholds }
 * @returns {{ passed: boolean, edge, impliedProb, stakeUnits, gates: [] }}
 */
export function evaluateGates(candidate, { clvTable = {}, thresholds = DEFAULT_THRESHOLDS } = {}) {
  const gates = [];
  const modelProb = normalizeProb(candidate.modelProb);
  const impliedProb = americanToImpliedProb(candidate.oddsAtPick);

  if (modelProb == null) {
    gates.push({ key: 'model_certified', status: 'fail', detail: 'no pick-aligned model probability' });
  } else {
    gates.push({
      key: 'model_certified',
      status: 'pass',
      detail: `${candidate.modelSource ?? 'model'} P(pick)=${(modelProb * 100).toFixed(1)}%`,
    });
  }

  let edge = null;
  if (impliedProb == null) {
    gates.push({ key: 'edge', status: 'fail', detail: 'no odds_at_pick — cannot price the bet' });
  } else if (modelProb == null) {
    gates.push({ key: 'edge', status: 'fail', detail: 'no model probability — cannot compute edge' });
  } else {
    edge = modelProb - impliedProb;
    const detail = `edge ${(edge * 100).toFixed(1)}% (model ${(modelProb * 100).toFixed(1)}% vs implied ${(impliedProb * 100).toFixed(1)}%, vig included)`;
    gates.push({ key: 'edge', status: edge >= thresholds.minEdge ? 'pass' : 'fail', detail });
  }

  if (isFullAgreementTier(candidate.convictionTier)) {
    gates.push({ key: 'conviction', status: 'pass', detail: `full agreement ${candidate.convictionTier}` });
  } else if (candidate.convictionTier) {
    gates.push({ key: 'conviction', status: 'fail', detail: `partial agreement ${candidate.convictionTier}` });
  } else {
    gates.push({ key: 'conviction', status: 'fail', detail: 'no conviction tier yet (shadow run pending?)' });
  }

  const clvKey = `${candidate.sport ?? 'mlb'}:${candidate.marketType ?? 'unknown'}`;
  const clv = clvTable[clvKey];
  if (clv && clv.n >= thresholds.minClvSample) {
    gates.push({
      key: 'market_clv',
      status: clv.avgClv >= 0 ? 'pass' : 'fail',
      detail: `${clvKey} avg CLV ${clv.avgClv.toFixed(2)} over last ${clv.n} picks`,
    });
  } else {
    gates.push({
      key: 'market_clv',
      status: 'neutral',
      detail: `${clvKey} insufficient CLV sample (n=${clv?.n ?? 0} < ${thresholds.minClvSample})`,
    });
  }

  const calibrated = candidate.calibratedConfidence != null ? Number(candidate.calibratedConfidence) : null;
  if (calibrated == null) {
    gates.push({ key: 'calibration', status: 'neutral', detail: 'no calibrated confidence stored' });
  } else {
    gates.push({
      key: 'calibration',
      status: calibrated >= thresholds.minCalibrated ? 'pass' : 'fail',
      detail: `calibrated ${calibrated}% (floor ${thresholds.minCalibrated}%)`,
    });
  }

  const passed = gates.every((g) => g.status !== 'fail');
  const stakeUnits = passed
    ? kellyStakeUnits({ modelProb, oddsAtPick: candidate.oddsAtPick, thresholds })
    : null;

  return { passed, edge, impliedProb, modelProb, stakeUnits, gates };
}

async function loadMarketClvTable(thresholds) {
  const { rows } = await pool.query(
    `SELECT sport, market_type, AVG(clv) AS avg_clv, COUNT(*) AS n
     FROM (
       SELECT COALESCE(p.sport, 'mlb') AS sport,
              COALESCE(pf.market_type, 'unknown') AS market_type,
              p.clv,
              ROW_NUMBER() OVER (
                PARTITION BY COALESCE(p.sport, 'mlb'), COALESCE(pf.market_type, 'unknown')
                ORDER BY p.created_at DESC
              ) AS rn
       FROM picks p
       LEFT JOIN pick_features pf ON pf.pick_id = p.id
       WHERE p.clv IS NOT NULL AND p.deleted_at IS NULL
     ) t
     WHERE rn <= $1
     GROUP BY sport, market_type`,
    [thresholds.clvWindowPicks]
  );
  const table = {};
  for (const r of rows) {
    table[`${r.sport}:${r.market_type}`] = { avgClv: Number(r.avg_clv), n: Number(r.n) };
  }
  return table;
}

async function loadCandidates({ date, sport }) {
  const params = [date];
  let sportFilter = '';
  if (sport) {
    params.push(sport);
    sportFilter = `AND COALESCE(p.sport, 'mlb') = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT p.id, p.pick, p.matchup, p.game_date, p.odds_at_pick,
            p.oracle_confidence, p.calibrated_confidence, p.conviction_tier,
            p.type, p.source, COALESCE(p.sport, 'mlb') AS sport,
            COALESCE(smr.pick_market_type, pf.market_type) AS market_type,
            smr.python_pick_prob, smr.legacy_pick_prob,
            smr.pick_agree_legacy, smr.pick_agree_python
     FROM picks p
     LEFT JOIN pick_features pf ON pf.pick_id = p.id
     LEFT JOIN LATERAL (
       SELECT pick_market_type, python_pick_prob, legacy_pick_prob,
              pick_agree_legacy, pick_agree_python
       FROM shadow_model_runs s
       WHERE s.pick_id = p.id
       ORDER BY s.created_at DESC
       LIMIT 1
     ) smr ON TRUE
     WHERE p.game_date = $1
       AND p.deleted_at IS NULL
       AND (p.result IS NULL OR LOWER(p.result) IN ('pending', ''))
       AND p.type IS DISTINCT FROM 'imperdible'
       ${sportFilter}
     ORDER BY p.created_at ASC`,
    params
  );
  return rows;
}

/**
 * Builds the Bet Card for a date: every pending pick of the day evaluated
 * against the hard gates, split into bets (all gates green) and rejected.
 */
export async function buildBetCard({ date, sport = null, thresholds = DEFAULT_THRESHOLDS } = {}) {
  const targetDate = date || new Date().toISOString().split('T')[0];
  const [clvTable, rows] = await Promise.all([
    loadMarketClvTable(thresholds),
    loadCandidates({ date: targetDate, sport }),
  ]);

  const bets = [];
  const rejected = [];

  for (const row of rows) {
    const pythonProb = normalizeProb(row.python_pick_prob);
    const legacyProb = normalizeProb(row.legacy_pick_prob);
    const candidate = {
      modelProb: pythonProb ?? legacyProb,
      modelSource: pythonProb != null ? 'python' : legacyProb != null ? 'legacy' : null,
      oddsAtPick: row.odds_at_pick,
      convictionTier: row.conviction_tier,
      calibratedConfidence: row.calibrated_confidence,
      sport: row.sport,
      marketType: row.market_type,
    };
    const verdict = evaluateGates(candidate, { clvTable, thresholds });

    const entry = {
      pickId: row.id,
      pick: row.pick,
      matchup: row.matchup,
      sport: row.sport,
      marketType: row.market_type ?? null,
      source: row.source ?? null,
      oddsAtPick: row.odds_at_pick ?? null,
      oracleConfidence: row.oracle_confidence ?? null,
      calibratedConfidence: row.calibrated_confidence ?? null,
      convictionTier: row.conviction_tier ?? null,
      modelSource: candidate.modelSource,
      modelProb: verdict.modelProb,
      impliedProb: verdict.impliedProb,
      edge: verdict.edge,
      stakeUnits: verdict.stakeUnits,
      gates: verdict.gates,
    };

    if (verdict.passed) bets.push(entry);
    else rejected.push(entry);
  }

  bets.sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));

  return {
    date: targetDate,
    sport: sport ?? 'all',
    thresholds,
    summary: {
      candidates: rows.length,
      bets: bets.length,
      rejected: rejected.length,
      noBetIsValid: true,
    },
    bets,
    rejected,
    clvTable,
  };
}
