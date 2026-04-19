/**
 * content-dto.js — sanitizers for the Content API (/api/content/v1/*).
 *
 * Whitelist approach: every field returned is explicitly listed. Fields not
 * listed here are never emitted, so adding new internal columns to HEXA's
 * tables will never accidentally leak through to the content consumer.
 *
 * Explicitly excluded (never emitted by any DTO):
 *   user_id, user_email, pick_time_lima             → PII / per-user state
 *   probability_model                               → raw win counts
 *   value_breakdown                                 → raw edge/kelly math
 *   safe_candidates                                 → internal selection set
 *   kelly_recommendation                            → user-bankroll-specific
 *   closing_odds, implied_prob_closing, clv         → internal trading metrics
 *   postmortem.adjustment_signals                   → model tuning signals
 *   postmortem.training_takeaway                    → training-only
 *   any column from pick_features / shadow_model_runs / oracle_sessions
 */

function parseMaybeJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

export function toPickDTO(row) {
  if (!row) return null;
  return {
    id:                row.id,
    type:              row.type,
    game_date:         row.game_date,
    game_pk:           row.game_pk,
    matchup:           row.matchup,
    pick:              row.pick,
    language:          row.language,
    model:             row.model,
    model_risk:        row.model_risk,
    bet_value:         row.bet_value,
    oracle_confidence: row.oracle_confidence,
    oracle_report:     row.oracle_report,
    hexa_hunch:        row.hexa_hunch,
    alert_flags:       parseMaybeJson(row.alert_flags) ?? [],
    best_pick:         parseMaybeJson(row.best_pick),
    odds_at_pick:      row.odds_at_pick,
    result:            row.result,
    created_at:        row.created_at,
    postmortem_available: Boolean(row.postmortem || row.postmortem_summary),
  };
}

export function toPostmortemDTO(row) {
  if (!row) return null;
  const pm = parseMaybeJson(row.postmortem) ?? {};
  return {
    pick_id:             row.id,
    matchup:             row.matchup,
    pick:                row.pick,
    result:              row.result,
    game_date:           row.game_date,
    language:            pm.lang ?? null,
    summary:             pm.summary ?? row.postmortem_summary ?? null,
    key_factors:         Array.isArray(pm.key_factors) ? pm.key_factors : [],
    what_hexa_got_right: Array.isArray(pm.what_hexa_got_right) ? pm.what_hexa_got_right : [],
    what_hexa_missed:    Array.isArray(pm.what_hexa_missed) ? pm.what_hexa_missed : [],
    generated_at:        row.postmortem_generated_at,
  };
}

export function toInsightDTO(row) {
  if (!row) return null;
  return {
    id:          row.id,
    type:        row.type,
    title:       row.title,
    explanation: row.explanation,
    pick_id:     row.pick_id,
    week_start:  row.week_start,
    created_at:  row.created_at,
  };
}

// Public-stats response is already safe (no PII, no raw features, no model
// internals). Kept as a DTO for a single exposure surface.
export function toPerformanceDTO(stats) {
  return stats;
}
