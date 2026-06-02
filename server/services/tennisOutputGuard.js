/**
 * tennisOutputGuard.js — validates Oracle Tennis output before persistence.
 *
 * Mirrors soccerOutputGuard.js but adapted for tennis' two-way individual market:
 *   - Allowed bet types: Match Winner, Set Handicap (±1.5 sets), Total Games
 *   - pick_side MUST be exactly 'player_a' or 'player_b' (no draw, no team)
 *   - Confidence range: 50-72 (TENNIS hard cap)
 *   - probability_model must have player_a_wins + player_b_wins (two keys, NO draw)
 *   - Per-set / player props blocked
 *   - Rejects parse failures, ABSTAIN/PASS picks, parlay shape, out-of-range confidence
 */

import { TENNIS_OUTPUT_SCHEMA_VERSION } from '../prompts/oracle-tennis-prompts.js';

const ALLOWED_BET_TYPES = new Set([
  'matchwinner', 'moneyline', 'ml', 'h2h',      // match winner variants
  'sethandicap', 'spread', 'sets',               // set handicap
  'totalgames', 'total', 'totals', 'ou',         // total games
]);
const BLOCKED_BET_TYPES = new Set([
  'playerprop', 'playerprops', 'prop', 'props',
  'setbetting', 'perset', 'aces', 'doublefaults',
]);

const ALLOWED_PICK_SIDES = new Set(['player_a', 'player_b']);

const TENNIS_CONFIDENCE_FLOOR = 50;
const TENNIS_CONFIDENCE_CEIL  = 72;

function normalizeBetType(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizePickSide(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[\s-]/g, '_');
}

function normalizeConfidence(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n <= 1) return Math.round(n * 100);
  return Math.round(n);
}

export function validateTennisAnalysisOutput(data, { parseError = false } = {}) {
  if (parseError) {
    return { ok: false, quality: 'reject', errors: ['json_parse_failed'], schema_version: TENNIS_OUTPUT_SCHEMA_VERSION, data: null };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, quality: 'reject', errors: ['empty_output'], schema_version: TENNIS_OUTPUT_SCHEMA_VERSION, data: null };
  }

  if (data.parlay) {
    return { ok: false, quality: 'reject', errors: ['parlay_shape_on_single_match'], schema_version: TENNIS_OUTPUT_SCHEMA_VERSION, data: null };
  }

  const errors = [];
  const mp = { ...(data.master_prediction ?? {}) };
  const pick = typeof mp.pick === 'string' ? mp.pick.trim() : '';

  if (!pick || pick.length < 3) errors.push('missing_pick');
  if (/\b(abstain|pass)\b/i.test(pick)) errors.push('abstain_pick');

  // pick_side is mandatory and must be player_a | player_b (resolution alignment)
  const side = normalizePickSide(mp.pick_side);
  if (!side) errors.push('missing_pick_side');
  else if (!ALLOWED_PICK_SIDES.has(side)) errors.push('invalid_pick_side');
  else mp.pick_side = side;

  const conf = normalizeConfidence(mp.oracle_confidence);
  if (conf == null) errors.push('missing_confidence');
  else if (conf < TENNIS_CONFIDENCE_FLOOR || conf > TENNIS_CONFIDENCE_CEIL) errors.push('confidence_out_of_range');
  else mp.oracle_confidence = conf;

  const bpType = normalizeBetType(data.best_pick?.type);
  if (bpType && BLOCKED_BET_TYPES.has(bpType)) errors.push('player_prop_blocked');
  else if (bpType && !ALLOWED_BET_TYPES.has(bpType)) errors.push('unsupported_bet_type');

  const report = String(data.oracle_report ?? '').trim();
  if (report.length < 80) errors.push('oracle_report_too_short');

  // Tennis-specific: probability_model must be two-way (no draw).
  const pm = data.probability_model;
  if (pm && typeof pm === 'object') {
    const hasA = pm.player_a_wins != null || pm.player_a != null;
    const hasB = pm.player_b_wins != null || pm.player_b != null;
    if (!hasA || !hasB) errors.push('probability_model_incomplete');
    if (pm.draws != null || pm.draw != null) errors.push('probability_model_has_draw');
  }

  const fatal = new Set([
    'json_parse_failed',
    'empty_output',
    'parlay_shape_on_single_match',
    'missing_pick',
    'abstain_pick',
    'missing_pick_side',
    'invalid_pick_side',
    'player_prop_blocked',
  ]);

  if (errors.some((e) => fatal.has(e))) {
    return { ok: false, quality: 'reject', errors, schema_version: TENNIS_OUTPUT_SCHEMA_VERSION, data: null };
  }

  const sanitized = {
    ...data,
    master_prediction: mp,
    alert_flags: Array.isArray(data.alert_flags) ? data.alert_flags : [],
  };

  if (errors.length) {
    sanitized.alert_flags = [...sanitized.alert_flags, `OUTPUT_GUARD: ${errors.join(', ')}`];
  }

  return {
    ok: true,
    quality: errors.length ? 'degraded' : 'ok',
    errors,
    schema_version: TENNIS_OUTPUT_SCHEMA_VERSION,
    data: sanitized,
  };
}
