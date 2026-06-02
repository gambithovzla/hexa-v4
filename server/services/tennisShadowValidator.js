/**
 * server/services/tennisShadowValidator.js
 *
 * Deterministic Tennis shadow validator — the tennis counterpart of
 * xgboostValidator.js (MLB), nbaShadowValidator.js, nflShadowValidator.js and
 * nhlShadowValidator.js. Not a real model: a transparent scoring that starts
 * from the surface-ELO logistic win expectancy and nudges it by head-to-head
 * (on surface) and recent form. Individual sport, so it produces P(player A
 * wins) — player A occupies the "home" slot, player B the "away" slot.
 *
 * Exports:
 *   calculateTennisShadowScore(context, matchMeta)
 *     — context   : output of buildTennisMatchContext() (playerA, playerB, h2h, …)
 *     — matchMeta : { surface }
 *     Returns { score, predicted_winner, predicted_winner_name, confidence, breakdown }
 *       score = P(player A wins) × 100
 *       predicted_winner = 'player_a' | 'player_b'
 *
 * confidence is bounded 50-72 to match the Tennis Oracle cap (efficient
 * ATP/WTA top tier, single-match retirement variance).
 */

const CONFIDENCE_FLOOR = 50;
const CONFIDENCE_CEIL  = 72;

// How much H2H and form can shift the ELO base win probability (in prob points).
const H2H_MAX_SHIFT  = 0.08;
const FORM_MAX_SHIFT = 0.06;

function toNumber(value) {
  if (value == null || value === '') return null; // Number(null) === 0 — guard it
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/** Standard ELO win expectancy for A given ratings. */
function eloExpectancy(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/** Logistic on a rank gap (lower rank number is better). ~40 ranks ≈ 0.73. */
function rankExpectancy(rankA, rankB) {
  // rankB - rankA positive means A is higher-ranked (smaller number) → favored
  return clamp01(0.5 + 0.5 * Math.tanh((rankB - rankA) / 40));
}

function parseRecordWins(recentForm) {
  if (!recentForm?.record) return null;
  const m = String(recentForm.record).match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  const wins = Number(m[1]);
  return Number.isFinite(wins) ? wins : null;
}

/**
 * @param {object} context   — from buildTennisMatchContext()
 * @param {object} matchMeta — { surface }
 */
export function calculateTennisShadowScore(context, matchMeta = {}) {
  const a = context?.playerA ?? {};
  const b = context?.playerB ?? {};
  const h2h = context?.h2h ?? null;
  const surface = matchMeta.surface ?? context?.surface ?? null;

  // ── Base win probability for A ────────────────────────────────────────────
  let base = 0.5;
  let baseSource = 'neutral';
  const eloAS = toNumber(a.eloSurface), eloBS = toNumber(b.eloSurface);
  const eloAO = toNumber(a.eloOverall), eloBO = toNumber(b.eloOverall);
  const rankA = toNumber(a.rank), rankB = toNumber(b.rank);
  if (eloAS != null && eloBS != null) {
    base = eloExpectancy(eloAS, eloBS);
    baseSource = 'elo_surface';
  } else if (eloAO != null && eloBO != null) {
    base = eloExpectancy(eloAO, eloBO);
    baseSource = 'elo_overall';
  } else if (rankA != null && rankB != null) {
    base = rankExpectancy(rankA, rankB);
    baseSource = 'rank';
  }

  // ── H2H shift (surface H2H preferred, else overall) ───────────────────────
  let h2hShift = 0;
  if (h2h) {
    const sa = toNumber(h2h.aWinsSurface) ?? 0;
    const sb = toNumber(h2h.bWinsSurface) ?? 0;
    const ta = toNumber(h2h.aWins) ?? 0;
    const tb = toNumber(h2h.bWins) ?? 0;
    const useSurface = (sa + sb) >= 2;
    const wa = useSurface ? sa : ta;
    const wb = useSurface ? sb : tb;
    if (wa + wb > 0) {
      // signed dominance in [-1, 1], dampened by sample size
      const dominance = (wa - wb) / (wa + wb);
      const sample = Math.min(1, (wa + wb) / 5);
      h2hShift = dominance * sample * H2H_MAX_SHIFT;
    }
  }

  // ── Form shift (recent wins delta) ────────────────────────────────────────
  let formShift = 0;
  const fa = parseRecordWins(a.recentForm);
  const fb = parseRecordWins(b.recentForm);
  if (fa != null || fb != null) {
    const diff = (fa ?? 5) - (fb ?? 5); // out of ~10
    formShift = Math.tanh(diff / 5) * FORM_MAX_SHIFT;
  }

  const pA = clamp01(base + h2hShift + formShift);
  const scoreNorm = pA * 100;
  const aWins = scoreNorm >= 50;

  const aName = a.playerName ?? 'Player A';
  const bName = b.playerName ?? 'Player B';
  const predictedWinner     = aWins ? 'player_a' : 'player_b';
  const predictedWinnerName = aWins ? aName : bName;

  const scoreDiff  = Math.abs(scoreNorm - 50);
  const rawConf    = CONFIDENCE_FLOOR + Math.min(scoreDiff * 1.4, CONFIDENCE_CEIL - CONFIDENCE_FLOOR);
  const confidence = Math.round(Math.min(CONFIDENCE_CEIL, Math.max(CONFIDENCE_FLOOR, rawConf)));
  const score      = Math.round(Math.min(100, Math.max(0, scoreNorm)));

  const completeness  = toNumber(context?.context_meta?.overallCompleteness) ?? 1;
  const adjConfidence = Math.round(confidence * (0.6 + 0.4 * completeness));

  console.log(
    `[tennisShadowValidator] ${aName} vs ${bName} (${surface ?? 'surface n/a'}) → ` +
    `pA=${scoreNorm.toFixed(1)} winner=${predictedWinnerName} ` +
    `conf=${adjConfidence} (base=${baseSource}, raw=${confidence}, completeness=${completeness})`
  );

  return {
    score,
    predicted_winner: predictedWinner,
    predicted_winner_name: predictedWinnerName,
    confidence: adjConfidence,
    breakdown: {
      base,
      baseSource,
      h2hShift,
      formShift,
      pA,
      rawConfidence: confidence,
      completeness,
    },
  };
}

export const TENNIS_SHADOW_MODEL_KEY     = 'tennis_shadow_validator_v1';
export const TENNIS_SHADOW_MODEL_VERSION = '1';
