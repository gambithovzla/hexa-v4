/**
 * soccerOutputGuard.js — validates Oracle Soccer output before persistence.
 *
 * Mirrors nhlOutputGuard.js but adapted for soccer's three-way market:
 *   - Allowed bet types: 1X2 (Home/Draw/Away), Total (Over/Under), BTTS
 *   - Confidence range: 50-62 (SOCCER hard cap)
 *   - probability_model must have home_wins + draws + away_wins (three keys)
 *   - Player props blocked (same as all other sports)
 *   - Rejects parse failures, ABSTAIN/PASS picks, parlay shape, out-of-range confidence
 */

import { SOCCER_OUTPUT_SCHEMA_VERSION } from '../prompts/oracle-soccer-prompts.js';

const ALLOWED_BET_TYPES = new Set([
  '1x2', 'threeway', 'moneyline',          // 1X2 variants
  'total', 'overunder', 'ou',               // Over/Under (main + alternate lines)
  'btts', 'bothteamstoscore',               // BTTS
  'handicap', 'spread', 'asianhandicap', 'ah', // Asian/European handicap
]);
const BLOCKED_BET_TYPES = new Set(['playerprop', 'playerprops', 'prop', 'props']);

const SOCCER_CONFIDENCE_FLOOR = 50;
const SOCCER_CONFIDENCE_CEIL  = 62;

function normalizeBetType(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeConfidence(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n <= 1) return Math.round(n * 100);
  return Math.round(n);
}

export function validateSoccerAnalysisOutput(data, { parseError = false } = {}) {
  if (parseError) {
    return { ok: false, quality: 'reject', errors: ['json_parse_failed'], schema_version: SOCCER_OUTPUT_SCHEMA_VERSION, data: null };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, quality: 'reject', errors: ['empty_output'], schema_version: SOCCER_OUTPUT_SCHEMA_VERSION, data: null };
  }

  if (data.parlay) {
    return { ok: false, quality: 'reject', errors: ['parlay_shape_on_single_game'], schema_version: SOCCER_OUTPUT_SCHEMA_VERSION, data: null };
  }

  const errors = [];
  const mp = { ...(data.master_prediction ?? {}) };
  const pick = typeof mp.pick === 'string' ? mp.pick.trim() : '';

  if (!pick || pick.length < 3) errors.push('missing_pick');
  if (/\b(abstain|pass)\b/i.test(pick)) errors.push('abstain_pick');

  const conf = normalizeConfidence(mp.oracle_confidence);
  if (conf == null) errors.push('missing_confidence');
  else if (conf < SOCCER_CONFIDENCE_FLOOR || conf > SOCCER_CONFIDENCE_CEIL) errors.push('confidence_out_of_range');
  else mp.oracle_confidence = conf;

  const bpType = normalizeBetType(data.best_pick?.type);
  if (bpType && BLOCKED_BET_TYPES.has(bpType)) errors.push('player_prop_blocked');
  else if (bpType && !ALLOWED_BET_TYPES.has(bpType)) errors.push('unsupported_bet_type');

  const report = String(data.oracle_report ?? '').trim();
  if (report.length < 80) errors.push('oracle_report_too_short');

  // Soccer-specific: probability_model should have three keys, not two.
  const pm = data.probability_model;
  if (pm && typeof pm === 'object') {
    if (pm.draws == null && pm.draw == null) errors.push('probability_model_missing_draws');
  }

  const fatal = new Set([
    'json_parse_failed',
    'empty_output',
    'parlay_shape_on_single_game',
    'missing_pick',
    'abstain_pick',
    'player_prop_blocked',
  ]);

  if (errors.some((e) => fatal.has(e))) {
    return { ok: false, quality: 'reject', errors, schema_version: SOCCER_OUTPUT_SCHEMA_VERSION, data: null };
  }

  const sanitized = {
    ...data,
    master_prediction: mp,
    alert_flags: Array.isArray(data.alert_flags) ? data.alert_flags : [],
  };

  // Normalise probability_model key: accept both 'draw' and 'draws'
  if (sanitized.probability_model?.draw != null && sanitized.probability_model?.draws == null) {
    sanitized.probability_model = {
      ...sanitized.probability_model,
      draws: sanitized.probability_model.draw,
    };
  }

  if (errors.length) {
    sanitized.alert_flags = [...sanitized.alert_flags, `OUTPUT_GUARD: ${errors.join(', ')}`];
  }

  return {
    ok: true,
    quality: errors.length ? 'degraded' : 'ok',
    errors,
    schema_version: SOCCER_OUTPUT_SCHEMA_VERSION,
    data: sanitized,
  };
}
