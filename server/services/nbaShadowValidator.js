/**
 * server/services/nbaShadowValidator.js
 *
 * Deterministic NBA shadow validator — the NBA counterpart of
 * server/services/xgboostValidator.js. Not a real XGBoost model: just a
 * transparent weighted scoring of advanced team stats + context (rest, B2B,
 * injuries, recent form) that produces a home win probability for the Oracle
 * to be compared against.
 *
 * Exports:
 *   calculateNbaShadowScore(context, gameMeta)
 *     — context  : output of buildNbaGameContext() (home, away, context_meta)
 *     — gameMeta : { homeTeamId, awayTeamId, homeAbbr, awayAbbr } (for the result)
 *     Returns { score, predicted_winner, predicted_winner_abbr, confidence, breakdown }
 *
 * The score is the predicted home-team share of the matchup on a 0-100 scale.
 * confidence is bounded 50-80 (lower than MLB because NBA picks are noisier).
 */

// ---------------------------------------------------------------------------
// Feature weights (sum to 1.0)
// ---------------------------------------------------------------------------

const FEATURE_WEIGHTS = {
  net_rating:    0.30,  // strongest single predictor
  off_rating:    0.12,  // ofense diff
  def_rating:    0.12,  // defense diff
  ts_pct:        0.10,  // shooting efficiency
  pace_match:    0.03,  // tiny — captures style mismatch
  rest:          0.12,  // back-to-backs hurt
  injuries:      0.12,  // severe injuries swing lines
  last10_form:   0.09,  // recent momentum
};

// Fixed home-court boost expressed as a delta on the normalized home score.
const HOME_COURT_BOOST = 0.035;

// Confidence band — NBA picks are inherently noisier than MLB.
const CONFIDENCE_FLOOR = 50;
const CONFIDENCE_CEIL  = 80;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map a delta to a 0..1 "advantage" score using a soft sigmoid-like curve.
 * `scale` is the delta magnitude that maps to ~0.75 advantage.
 */
function deltaToAdvantage(delta, scale) {
  if (delta == null || !Number.isFinite(delta)) return 0.5;
  if (scale <= 0) return 0.5;
  const x = delta / scale;
  // Hyperbolic-tangent-shaped curve clamped to [0,1]; smooth, no jagged edges
  const y = 0.5 + 0.5 * Math.tanh(x);
  return Math.max(0, Math.min(1, y));
}

/**
 * Pace match — penalty if paces are wildly different (the team that prefers
 * its pace is usually slightly favored). The signal is small.
 */
function paceMatchAdvantage(homePace, awayPace) {
  const hp = toNumber(homePace);
  const ap = toNumber(awayPace);
  if (hp == null || ap == null) return 0.5;
  // Slight lean toward the team with a faster home tempo (home advantage echo)
  const diff = hp - ap;
  return deltaToAdvantage(diff, 3.0);  // 3-pace-points delta ~ 0.75
}

/**
 * Rest advantage — back-to-back games are heavily penalised.
 * Returns the home team's advantage in [0,1].
 */
function restAdvantage(homeDaysRest, awayDaysRest) {
  const hr = toNumber(homeDaysRest);
  const ar = toNumber(awayDaysRest);
  if (hr == null && ar == null) return 0.5;
  const hrSafe = hr ?? 1;
  const arSafe = ar ?? 1;
  // B2B = 0 days rest. Extra penalty for that side.
  const hrAdj = hrSafe + (hrSafe === 0 ? -1.0 : 0);
  const arAdj = arSafe + (arSafe === 0 ? -1.0 : 0);
  const delta = hrAdj - arAdj;
  return deltaToAdvantage(delta, 1.5);
}

/**
 * Injury severity advantage — more severe injuries on the away side benefits
 * the home team. Severe means status in {out, out_for_season, doubtful}.
 */
function injuryAdvantage(homeSevere, awaySevere) {
  const hs = toNumber(homeSevere) ?? 0;
  const as_ = toNumber(awaySevere) ?? 0;
  // Each severe injury counts as 1 unit; scale of 2 → 0.75 advantage
  return deltaToAdvantage(as_ - hs, 2);
}

/**
 * Last-10 form advantage — extracts wins from "W-L" record string.
 */
function parseLast10Wins(recentForm) {
  if (!recentForm?.record) return null;
  const match = String(recentForm.record).match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  const wins = Number(match[1]);
  return Number.isFinite(wins) ? wins : null;
}

function last10Advantage(homeForm, awayForm) {
  const hw = parseLast10Wins(homeForm);
  const aw = parseLast10Wins(awayForm);
  if (hw == null && aw == null) return 0.5;
  return deltaToAdvantage((hw ?? 5) - (aw ?? 5), 3);
}

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

/**
 * @param {object} context   — from buildNbaGameContext()
 * @param {object} gameMeta  — { homeTeamId, awayTeamId, homeAbbr, awayAbbr }
 */
export function calculateNbaShadowScore(context, gameMeta = {}) {
  const home = context?.home ?? {};
  const away = context?.away ?? {};

  // Differentials (home minus away — positive means home advantage)
  const netDiff   = (toNumber(home.netRating) ?? 0) - (toNumber(away.netRating) ?? 0);
  const offDiff   = (toNumber(home.offRating) ?? 0) - (toNumber(away.offRating) ?? 0);
  // Defensive: LOWER is better. We invert so positive favors home defensively.
  const defDiff   = (toNumber(away.defRating) ?? 0) - (toNumber(home.defRating) ?? 0);
  const tsDiff    = (toNumber(home.tsPct) ?? 0) - (toNumber(away.tsPct) ?? 0);

  const netAdv    = deltaToAdvantage(netDiff, 5);
  const offAdv    = deltaToAdvantage(offDiff, 5);
  const defAdv    = deltaToAdvantage(defDiff, 5);
  const tsAdv     = deltaToAdvantage(tsDiff,  0.02);  // 2 percentage-points
  const paceAdv   = paceMatchAdvantage(home.pace, away.pace);
  const restAdv   = restAdvantage(home.daysRest, away.daysRest);
  const injAdv    = injuryAdvantage(home.injuries?.severeCount, away.injuries?.severeCount);
  const formAdv   = last10Advantage(home.recentForm, away.recentForm);

  // Weighted blend — produces a raw [0,1] home advantage
  const rawHomeAdvantage =
    FEATURE_WEIGHTS.net_rating   * netAdv  +
    FEATURE_WEIGHTS.off_rating   * offAdv  +
    FEATURE_WEIGHTS.def_rating   * defAdv  +
    FEATURE_WEIGHTS.ts_pct       * tsAdv   +
    FEATURE_WEIGHTS.pace_match   * paceAdv +
    FEATURE_WEIGHTS.rest         * restAdv +
    FEATURE_WEIGHTS.injuries     * injAdv  +
    FEATURE_WEIGHTS.last10_form  * formAdv;

  // Apply home court boost
  const homeAdvantage = Math.max(0, Math.min(1, rawHomeAdvantage + HOME_COURT_BOOST));

  // Normalize to 0-100 home win share
  const homeScoreNorm = homeAdvantage * 100;
  const homeWins = homeScoreNorm >= 50;

  const homeId   = String(gameMeta.homeTeamId ?? home.teamId ?? 'home');
  const awayId   = String(gameMeta.awayTeamId ?? away.teamId ?? 'away');
  const homeAbbr = String(gameMeta.homeAbbr ?? home.teamAbbr ?? 'HOME');
  const awayAbbr = String(gameMeta.awayAbbr ?? away.teamAbbr ?? 'AWAY');

  const predictedWinnerId   = homeWins ? homeId   : awayId;
  const predictedWinnerAbbr = homeWins ? homeAbbr : awayAbbr;

  // Confidence — distance from 50, mapped to 50-80
  const scoreDiff = Math.abs(homeScoreNorm - 50);
  const rawConf   = CONFIDENCE_FLOOR + Math.min(scoreDiff * 1.5, CONFIDENCE_CEIL - CONFIDENCE_FLOOR);
  const confidence = Math.round(Math.min(CONFIDENCE_CEIL, Math.max(CONFIDENCE_FLOOR, rawConf)));

  const score = Math.round(Math.min(100, Math.max(0, homeScoreNorm)));

  // Penalise confidence when data quality is poor
  const completeness = toNumber(context?.context_meta?.overallCompleteness) ?? 1;
  const adjConfidence = Math.round(confidence * (0.6 + 0.4 * completeness));

  console.log(
    `[nbaShadowValidator] ${homeAbbr} vs ${awayAbbr} → ` +
    `homeScore=${homeScoreNorm.toFixed(1)} winner=${predictedWinnerAbbr} ` +
    `conf=${adjConfidence} (raw=${confidence}, completeness=${completeness})`
  );

  return {
    score,
    predicted_winner: predictedWinnerId,
    predicted_winner_abbr: predictedWinnerAbbr,
    confidence: adjConfidence,
    breakdown: {
      netAdv,
      offAdv,
      defAdv,
      tsAdv,
      paceAdv,
      restAdv,
      injAdv,
      formAdv,
      homeAdvantage,
      rawConfidence: confidence,
      completeness,
    },
  };
}

export const NBA_SHADOW_MODEL_KEY     = 'nba_shadow_validator_v1';
export const NBA_SHADOW_MODEL_VERSION = '1';
