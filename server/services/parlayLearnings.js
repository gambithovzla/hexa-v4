/**
 * parlayLearnings.js — aggregate finalized parlay_synergy_runs into per-dimension
 * performance stats so the UI can show "where am I winning/losing".
 *
 * The aggregator is a pure function over a flat list of history entries (the
 * same shape returned by GET /api/parlay-architect/history). The HTTP handler
 * loads the rows and calls this — keeps the math testable without a DB.
 */

import pool from '../db.js';

const UNKNOWN = '__unknown__';

function bumpParlayBucket(map, rawKey, entry) {
  const key = rawKey == null || rawKey === '' ? UNKNOWN : String(rawKey);
  let row = map.get(key);
  if (!row) {
    row = {
      key,
      total: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      legsHitSum: 0,
      legsHitCount: 0,
      missBy1: 0,
      avgDecOdds: 0,
      _oddsSum: 0,
      _oddsCount: 0,
    };
    map.set(key, row);
  }
  row.total++;
  if (entry.result === 'win')   row.wins++;
  if (entry.result === 'loss')  row.losses++;
  if (entry.result === 'push')  row.pushes++;
  if (entry.legs_hit != null) {
    row.legsHitSum += Number(entry.legs_hit);
    row.legsHitCount++;
  }
  if (
    entry.result === 'loss'
    && entry.legs_hit != null
    && entry.requested_legs != null
    && entry.requested_legs - entry.legs_hit === 1
  ) {
    row.missBy1++;
  }
  if (entry.combined_decimal_odds != null) {
    row.avgDecOdds += Number(entry.combined_decimal_odds);
    row._oddsSum   += Number(entry.combined_decimal_odds);
    row._oddsCount++;
  }
}

function finalizeParlayBuckets(map) {
  const out = [];
  for (const row of map.values()) {
    const decided = row.wins + row.losses;
    out.push({
      key:        row.key === UNKNOWN ? null : row.key,
      total:      row.total,
      wins:       row.wins,
      losses:     row.losses,
      pushes:     row.pushes,
      winRate:    decided > 0 ? row.wins / decided : null,
      avgLegsHit: row.legsHitCount > 0 ? row.legsHitSum / row.legsHitCount : null,
      missBy1:    row.missBy1,
      avgDecOdds: row._oddsCount > 0 ? row._oddsSum / row._oddsCount : null,
    });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

function bumpLegBucket(map, rawKey, legResult) {
  const key = rawKey == null || rawKey === '' ? UNKNOWN : String(rawKey);
  let row = map.get(key);
  if (!row) {
    row = { key, total: 0, wins: 0, losses: 0, pushes: 0 };
    map.set(key, row);
  }
  row.total++;
  if (legResult === 'win')   row.wins++;
  if (legResult === 'loss')  row.losses++;
  if (legResult === 'push')  row.pushes++;
}

function finalizeLegBuckets(map) {
  const out = [];
  for (const row of map.values()) {
    const decided = row.wins + row.losses;
    out.push({
      key:     row.key === UNKNOWN ? null : row.key,
      total:   row.total,
      wins:    row.wins,
      losses:  row.losses,
      pushes:  row.pushes,
      winRate: decided > 0 ? row.wins / decided : null,
    });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

/**
 * Build per-dimension aggregates from history entries.
 *
 * @param {object[]} entries — same shape as GET /api/parlay-architect/history
 * @param {object}   opts
 * @param {boolean=} opts.includePending — if false (default) ignore unresolved runs
 * @returns {object}
 */
export function aggregateLearnings(entries, { includePending = false } = {}) {
  const summary = {
    totalRuns:      Array.isArray(entries) ? entries.length : 0,
    totalResolved:  0,
    wins:           0,
    losses:         0,
    pushes:         0,
    pending:        0,
    overallWinRate: null,
  };

  const byMode     = new Map();
  const byBetType  = new Map();
  const byEngine   = new Map();
  const byModel    = new Map();
  const bySynergy  = new Map();
  const byLegCount = new Map();
  const byLegType  = new Map();

  const missBreakdown = { missBy1: 0, missBy2: 0, missBy3plus: 0, totalLosses: 0 };

  for (const e of entries ?? []) {
    if (!e) continue;
    if (e.result === 'pending') {
      summary.pending++;
      if (!includePending) continue;
    } else {
      summary.totalResolved++;
      if (e.result === 'win')  summary.wins++;
      if (e.result === 'loss') summary.losses++;
      if (e.result === 'push') summary.pushes++;
    }

    if (e.result === 'pending' && !includePending) continue;

    bumpParlayBucket(byMode,     e.mode,                       e);
    bumpParlayBucket(byBetType,  e.bet_type ?? e.market_focus, e);
    bumpParlayBucket(byEngine,   e.engine,                     e);
    bumpParlayBucket(byModel,    e.model,                      e);
    bumpParlayBucket(bySynergy,  e.synergy_type,               e);
    bumpParlayBucket(byLegCount, e.requested_legs,             e);

    // Per-leg-type aggregate. We index leg_results by candidateId so reordered
    // legs don't desync from results.
    if (Array.isArray(e.legs) && Array.isArray(e.leg_results)) {
      const byCand = new Map();
      e.leg_results.forEach((lr, i) => {
        const k = lr?.candidateId ?? `__idx_${i}`;
        byCand.set(k, lr);
      });
      e.legs.forEach((leg, i) => {
        const key = leg?.candidateId ?? `__idx_${i}`;
        const lr  = byCand.get(key) ?? e.leg_results[i];
        if (!lr || !lr.result) return;
        bumpLegBucket(byLegType, leg?.type, lr.result);
      });
    }

    if (e.result === 'loss' && e.legs_hit != null && e.requested_legs != null) {
      const miss = e.requested_legs - e.legs_hit;
      missBreakdown.totalLosses++;
      if      (miss === 1) missBreakdown.missBy1++;
      else if (miss === 2) missBreakdown.missBy2++;
      else if (miss >= 3) missBreakdown.missBy3plus++;
    }
  }

  const decided = summary.wins + summary.losses;
  summary.overallWinRate = decided > 0 ? summary.wins / decided : null;

  return {
    summary,
    missBreakdown,
    byMode:     finalizeParlayBuckets(byMode),
    byBetType:  finalizeParlayBuckets(byBetType),
    byEngine:   finalizeParlayBuckets(byEngine),
    byModel:    finalizeParlayBuckets(byModel),
    bySynergy:  finalizeParlayBuckets(bySynergy),
    byLegCount: finalizeParlayBuckets(byLegCount),
    byLegType:  finalizeLegBuckets(byLegType),
  };
}

/**
 * Load this user's history rows and aggregate. Mirrors the SELECT used by
 * GET /api/parlay-architect/history but keeps rows lighter.
 *
 * @param {string|number} userId
 * @returns {Promise<object>}
 */
export async function loadLearningsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT
       id, game_date, mode, requested_legs,
       engine, model, bet_type, market_focus,
       composed_top3, architect_output,
       combined_dec_odds, synergy_type,
       resolved, hit, legs_hit, leg_results
     FROM parlay_synergy_runs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 500`,
    [String(userId)],
  );

  const entries = rows.map(row => {
    const architectOutput = row.architect_output ?? {};
    const composedTop3    = row.composed_top3 ?? [];
    const chosenIndex     = architectOutput.chosen_index ?? 0;
    const chosenParlay    = composedTop3[chosenIndex] ?? composedTop3[0] ?? null;
    return {
      id:                    `db_${row.id}`,
      date:                  row.game_date,
      mode:                  row.mode,
      requested_legs:        row.requested_legs,
      engine:                row.engine ?? null,
      model:                 row.model ?? null,
      bet_type:              row.bet_type ?? null,
      market_focus:          row.market_focus ?? null,
      synergy_type:          row.synergy_type ?? null,
      combined_decimal_odds: row.combined_dec_odds ?? null,
      legs:                  chosenParlay?.legs ?? [],
      result:                row.resolved ? (row.hit ? 'win' : 'loss') : 'pending',
      legs_hit:              row.legs_hit ?? null,
      leg_results:           row.leg_results ?? null,
    };
  });

  return aggregateLearnings(entries);
}
