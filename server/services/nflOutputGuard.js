/**
 * nflOutputGuard.js — validates Oracle NFL output before persistence.
 *
 * Mirrors nbaOutputGuard.js. Rejects parse failures, empty output, parlay
 * shape, missing/ABSTAIN pick, player props, and out-of-range confidence
 * (NFL cap is 72, vs NBA 78 / MLB 70). Degrades (non-fatal) on a too-short
 * report, surfacing the issue in alert_flags. Never throws.
 */

import { NFL_OUTPUT_SCHEMA_VERSION } from '../prompts/oracle-nfl-prompts.js';
import { PRESEASON_ALERT_FLAG, PRESEASON_CONFIDENCE_CEIL } from './nflSeasonPhase.js';
import { evaluateNflLineProvenance } from './nflLineProvenance.js';

const ALLOWED_BET_TYPES = new Set(['moneyline', 'ml', 'spread', 'pointspread', 'total', 'overunder', 'ou']);
const BLOCKED_BET_TYPES = new Set(['playerprop', 'playerprops', 'prop', 'props']);

const NFL_CONFIDENCE_FLOOR = 50;
const NFL_CONFIDENCE_CEIL = 72;

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

export function validateNflAnalysisOutput(data, { parseError = false, isPreseason = false, marketOdds = null } = {}) {
  if (parseError) {
    return { ok: false, quality: 'reject', errors: ['json_parse_failed'], schema_version: NFL_OUTPUT_SCHEMA_VERSION, data: null };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, quality: 'reject', errors: ['empty_output'], schema_version: NFL_OUTPUT_SCHEMA_VERSION, data: null };
  }

  if (data.parlay) {
    return { ok: false, quality: 'reject', errors: ['parlay_shape_on_single_game'], schema_version: NFL_OUTPUT_SCHEMA_VERSION, data: null };
  }

  const errors = [];
  const mp = { ...(data.master_prediction ?? {}) };
  const pick = typeof mp.pick === 'string' ? mp.pick.trim() : '';

  if (!pick || pick.length < 3) errors.push('missing_pick');
  if (/\b(abstain|pass)\b/i.test(pick)) errors.push('abstain_pick');

  const conf = normalizeConfidence(mp.oracle_confidence);
  let preseasonCapped = false;
  if (conf == null) errors.push('missing_confidence');
  else if (conf < NFL_CONFIDENCE_FLOOR || conf > NFL_CONFIDENCE_CEIL) errors.push('confidence_out_of_range');
  else mp.oracle_confidence = conf;

  // Clamp rather than reject: the read is still worth showing in preseason, it
  // just may not claim conviction it cannot have. The cap is applied even when
  // the raw value was out of range, so a 78 cannot survive as a preseason pick.
  if (isPreseason && conf != null && conf > PRESEASON_CONFIDENCE_CEIL) {
    mp.oracle_confidence = PRESEASON_CONFIDENCE_CEIL;
    preseasonCapped = true;
  }

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
    return { ok: false, quality: 'reject', errors, schema_version: NFL_OUTPUT_SCHEMA_VERSION, data: null };
  }

  // A spread/total pick must carry a number, and the model will supply one even
  // with no MARKET ODDS block to read it from. Label that rather than let a
  // model-authored line reach the user looking like a quoted one.
  const lineProvenance = evaluateNflLineProvenance({
    betType: data.best_pick?.type,
    pickText: pick,
    detail: data.best_pick?.detail,
    marketOdds,
  });

  const sanitized = {
    ...data,
    master_prediction: mp,
    alert_flags: Array.isArray(data.alert_flags) ? data.alert_flags : [],
    line_provenance: lineProvenance,
  };

  if (lineProvenance.flag) {
    sanitized.alert_flags = [...sanitized.alert_flags, lineProvenance.flag];
  }

  if (isPreseason) {
    sanitized.alert_flags = [...sanitized.alert_flags, PRESEASON_ALERT_FLAG];
    if (preseasonCapped) {
      sanitized.alert_flags = [
        ...sanitized.alert_flags,
        `PRESEASON_CONFIDENCE_CAPPED: ${conf} → ${PRESEASON_CONFIDENCE_CEIL}`,
      ];
    }
  }

  if (errors.length) {
    sanitized.alert_flags = [...sanitized.alert_flags, `OUTPUT_GUARD: ${errors.join(', ')}`];
  }

  return {
    ok: true,
    quality: errors.length ? 'degraded' : 'ok',
    errors,
    line_provenance: lineProvenance,
    schema_version: NFL_OUTPUT_SCHEMA_VERSION,
    data: sanitized,
  };
}
