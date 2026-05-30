/**
 * server/services/nflShadowValidator.js
 *
 * Deterministic NFL shadow validator — the NFL counterpart of
 * server/services/xgboostValidator.js (MLB) and nbaShadowValidator.js (NBA).
 * Not a real model: a transparent weighted scoring of team strength (EPA diff
 * when available, else season point-differential proxy), QB availability, rest
 * (short week / off bye), injuries, and recent form, plus a small home-field
 * boost. Produces a home win share for the Oracle to be compared against.
 *
 * Exports:
 *   calculateNflShadowScore(context, gameMeta)
 *     — context  : output of buildNflGameContext() (home, away, weather, context_meta)
 *     — gameMeta : { homeTeamId, awayTeamId, homeAbbr, awayAbbr }
 *     Returns { score, predicted_winner, predicted_winner_abbr, confidence, breakdown }
 *
 * confidence is bounded 50-72 to match the NFL Oracle cap (the most efficient,
 * highest-variance market of the three sports).
 */

const FEATURE_WEIGHTS = {
  strength:   0.45,  // EPA diff or season point-differential — dominant
  qb:         0.20,  // QB availability is the NFL swing factor
  injuries:   0.13,  // severe injuries beyond QB
  form:       0.12,  // recent results
  rest:       0.10,  // off bye (+) / short week (−)
};

// NFL home field ≈ 2-2.5 pts — smaller than NBA's ~3.5, so a smaller boost.
const HOME_FIELD_BOOST = 0.025;

const CONFIDENCE_FLOOR = 50;
const CONFIDENCE_CEIL  = 72;

const SEVERE_QB = new Set(['out', 'out_for_season', 'doubtful']);

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function deltaToAdvantage(delta, scale) {
  if (delta == null || !Number.isFinite(delta)) return 0.5;
  if (scale <= 0) return 0.5;
  const y = 0.5 + 0.5 * Math.tanh(delta / scale);
  return Math.max(0, Math.min(1, y));
}

/** Team strength: prefer EPA matchup diff; fall back to season point differential. */
function strengthAdvantage(home, away) {
  const hOff = toNumber(home.epaOff), hDef = toNumber(home.epaDef);
  const aOff = toNumber(away.epaOff), aDef = toNumber(away.epaDef);
  if (hOff != null && aDef != null && hDef != null && aOff != null) {
    const homeNet = hOff - aDef;
    const awayNet = aOff - hDef;
    return deltaToAdvantage(homeNet - awayNet, 0.15); // 0.15 EPA/play gap ~ 0.75
  }
  const hPd = toNumber(home.pointDiff);
  const aPd = toNumber(away.pointDiff);
  if (hPd == null && aPd == null) return 0.5;
  return deltaToAdvantage((hPd ?? 0) - (aPd ?? 0), 60); // 60-pt season diff gap ~ 0.75
}

/** QB availability: a severe QB status on one side swings the line hard. */
function qbAdvantage(home, away) {
  const homeHit = SEVERE_QB.has(home.qbStatus?.statusKey) ? 1 : 0;
  const awayHit = SEVERE_QB.has(away.qbStatus?.statusKey) ? 1 : 0;
  if (homeHit === 0 && awayHit === 0) return 0.5;
  return deltaToAdvantage(awayHit - homeHit, 1);
}

function injuryAdvantage(homeSevere, awaySevere) {
  const hs = toNumber(homeSevere) ?? 0;
  const as_ = toNumber(awaySevere) ?? 0;
  return deltaToAdvantage(as_ - hs, 3); // 3 severe injuries gap ~ 0.75
}

function restAdvantage(home, away) {
  // Net rest "boost units": off-bye +1, short week −1.
  const hUnits = (home.isOffBye ? 1 : 0) + (home.isShortWeek ? -1 : 0);
  const aUnits = (away.isOffBye ? 1 : 0) + (away.isShortWeek ? -1 : 0);
  if (hUnits === 0 && aUnits === 0) {
    const hr = toNumber(home.restDays), ar = toNumber(away.restDays);
    if (hr == null || ar == null) return 0.5;
    return deltaToAdvantage(hr - ar, 4);
  }
  return deltaToAdvantage(hUnits - aUnits, 1.2);
}

function parseRecordWins(recentForm) {
  if (!recentForm?.record) return null;
  const m = String(recentForm.record).match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  const wins = Number(m[1]);
  return Number.isFinite(wins) ? wins : null;
}

function formAdvantage(home, away) {
  const hw = parseRecordWins(home.recentForm);
  const aw = parseRecordWins(away.recentForm);
  if (hw == null && aw == null) return 0.5;
  return deltaToAdvantage((hw ?? 3) - (aw ?? 3), 2.5);
}

/**
 * @param {object} context   — from buildNflGameContext()
 * @param {object} gameMeta  — { homeTeamId, awayTeamId, homeAbbr, awayAbbr }
 */
export function calculateNflShadowScore(context, gameMeta = {}) {
  const home = context?.home ?? {};
  const away = context?.away ?? {};

  const strAdv  = strengthAdvantage(home, away);
  const qbAdv   = qbAdvantage(home, away);
  const injAdv  = injuryAdvantage(home.injuries?.severeCount, away.injuries?.severeCount);
  const formAdv = formAdvantage(home, away);
  const restAdv = restAdvantage(home, away);

  const rawHomeAdvantage =
    FEATURE_WEIGHTS.strength * strAdv  +
    FEATURE_WEIGHTS.qb       * qbAdv   +
    FEATURE_WEIGHTS.injuries * injAdv  +
    FEATURE_WEIGHTS.form     * formAdv +
    FEATURE_WEIGHTS.rest     * restAdv;

  const homeAdvantage = Math.max(0, Math.min(1, rawHomeAdvantage + HOME_FIELD_BOOST));
  const homeScoreNorm = homeAdvantage * 100;
  const homeWins = homeScoreNorm >= 50;

  const homeId   = String(gameMeta.homeTeamId ?? home.teamId ?? 'home');
  const awayId   = String(gameMeta.awayTeamId ?? away.teamId ?? 'away');
  const homeAbbr = String(gameMeta.homeAbbr ?? home.teamAbbr ?? 'HOME');
  const awayAbbr = String(gameMeta.awayAbbr ?? away.teamAbbr ?? 'AWAY');

  const predictedWinnerId   = homeWins ? homeId   : awayId;
  const predictedWinnerAbbr = homeWins ? homeAbbr : awayAbbr;

  const scoreDiff  = Math.abs(homeScoreNorm - 50);
  const rawConf    = CONFIDENCE_FLOOR + Math.min(scoreDiff * 1.3, CONFIDENCE_CEIL - CONFIDENCE_FLOOR);
  const confidence = Math.round(Math.min(CONFIDENCE_CEIL, Math.max(CONFIDENCE_FLOOR, rawConf)));
  const score      = Math.round(Math.min(100, Math.max(0, homeScoreNorm)));

  const completeness  = toNumber(context?.context_meta?.overallCompleteness) ?? 1;
  const adjConfidence = Math.round(confidence * (0.6 + 0.4 * completeness));

  console.log(
    `[nflShadowValidator] ${homeAbbr} vs ${awayAbbr} → ` +
    `homeScore=${homeScoreNorm.toFixed(1)} winner=${predictedWinnerAbbr} ` +
    `conf=${adjConfidence} (raw=${confidence}, completeness=${completeness})`
  );

  return {
    score,
    predicted_winner: predictedWinnerId,
    predicted_winner_abbr: predictedWinnerAbbr,
    confidence: adjConfidence,
    breakdown: {
      strAdv, qbAdv, injAdv, formAdv, restAdv,
      homeAdvantage,
      rawConfidence: confidence,
      completeness,
    },
  };
}

export const NFL_SHADOW_MODEL_KEY     = 'nfl_shadow_validator_v1';
export const NFL_SHADOW_MODEL_VERSION = '1';
