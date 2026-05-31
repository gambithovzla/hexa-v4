/**
 * nhlOutputGuard.js — validates Oracle NHL output before persistence.
 *
 * Mirrors nflOutputGuard.js. Rejects parse failures, empty output, parlay
 * shape, missing/ABSTAIN pick, player props, and out-of-range confidence
 * (NHL cap is 70, like MLB). Degrades (non-fatal) on a too-short report,
 * surfacing the issue in alert_flags. Never throws.
 */

import { NHL_OUTPUT_SCHEMA_VERSION } from '../prompts/oracle-nhl-prompts.js';

const ALLOWED_BET_TYPES = new Set(['moneyline', 'ml', 'puckline', 'puck', 'spread', 'total', 'overunder', 'ou']);
const BLOCKED_BET_TYPES = new Set(['playerprop', 'playerprops', 'prop', 'props']);

const NHL_CONFIDENCE_FLOOR = 50;
const NHL_CONFIDENCE_CEIL = 70;

function normalizeBetType(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function normalizeConfidence(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n <= 1) return Math.round(n * 100);
  return Math.round(n);
}

export function validateNhlAnalysisOutput(data, { parseError = false } = {}) {
  if (parseError) {
    return { ok: false, quality: 'reject', errors: ['json_parse_failed'], schema_version: NHL_OUTPUT_SCHEMA_VERSION, data: null };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, quality: 'reject', errors: ['empty_output'], schema_version: NHL_OUTPUT_SCHEMA_VERSION, data: null };
  }

  if (data.parlay) {
    return { ok: false, quality: 'reject', errors: ['parlay_shape_on_single_game'], schema_version: NHL_OUTPUT_SCHEMA_VERSION, data: null };
  }

  const errors = [];
  const mp = { ...(data.master_prediction ?? {}) };
  const pick = typeof mp.pick === 'string' ? mp.pick.trim() : '';

  if (!pick || pick.length < 3) errors.push('missing_pick');
  if (/\b(abstain|pass)\b/i.test(pick)) errors.push('abstain_pick');

  const conf = normalizeConfidence(mp.oracle_confidence);
  if (conf == null) errors.push('missing_confidence');
  else if (conf < NHL_CONFIDENCE_FLOOR || conf > NHL_CONFIDENCE_CEIL) errors.push('confidence_out_of_range');
  else mp.oracle_confidence = conf;

  const bpType = normalizeBetType(data.best_pick?.type);
  if (bpType && BLOCKED_BET_TYPES.has(bpType)) errors.push('player_prop_blocked');
  else if (bpType && !ALLOWED_BET_TYPES.has(bpType)) errors.push('unsupported_bet_type');

  const report = String(data.oracle_report ?? '').trim();
  if (report.length < 80) errors.push('oracle_report_too_short');

  const fatal = new Set([
    'json_parse_failed',
    'empty_output',
    'parlay_shape_on_single_game',
    'missing_pick',
    'abstain_pick',
    'player_prop_blocked',
  ]);

  if (errors.some((e) => fatal.has(e))) {
    return { ok: false, quality: 'reject', errors, schema_version: NHL_OUTPUT_SCHEMA_VERSION, data: null };
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
    schema_version: NHL_OUTPUT_SCHEMA_VERSION,
    data: sanitized,
  };
}
