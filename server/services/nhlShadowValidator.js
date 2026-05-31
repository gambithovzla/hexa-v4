/**
 * server/services/nhlShadowValidator.js
 *
 * Deterministic NHL shadow validator — the NHL counterpart of
 * xgboostValidator.js (MLB), nbaShadowValidator.js (NBA) and
 * nflShadowValidator.js (NFL). Not a real model: a transparent weighted scoring
 * of team strength (season goal differential), special teams (PP%/PK% when
 * available), goalie availability, recent form and rest/back-to-back, plus a
 * small home-ice boost. Produces a home win share for the Oracle to be compared
 * against.
 *
 * Exports:
 *   calculateNhlShadowScore(context, gameMeta)
 *     — context  : output of buildNhlGameContext() (home, away, context_meta)
 *     — gameMeta : { homeTeamId, awayTeamId, homeAbbr, awayAbbr }
 *     Returns { score, predicted_winner, predicted_winner_abbr, confidence, breakdown }
 *
 * confidence is bounded 50-70 to match the NHL Oracle cap (low-scoring,
 * high-variance, fairly efficient market).
 */

const FEATURE_WEIGHTS = {
  strength:    0.42,  // season goal differential — dominant
  specialTeams: 0.16, // PP%/PK% edge (when available)
  goalie:      0.16,  // starting-goalie availability swing
  form:        0.14,  // recent results
  rest:        0.12,  // back-to-back (−) / extra rest (+)
};

// NHL home ice is a small, already-priced edge — smaller boost than NBA/NFL.
const HOME_ICE_BOOST = 0.02;

const CONFIDENCE_FLOOR = 50;
const CONFIDENCE_CEIL  = 70;

const SEVERE_GOALIE = new Set(['out', 'out_for_season', 'doubtful']);

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

/** Team strength: season goal differential gap (a ~25-goal season gap ~ 0.75). */
function strengthAdvantage(home, away) {
  const hd = toNumber(home.goalDiff);
  const ad = toNumber(away.goalDiff);
  if (hd == null && ad == null) {
    // fall back to GF/GA per game net rate
    const hNet = (toNumber(home.goalsForPerGame) ?? 0) - (toNumber(home.goalsAgainstPerGame) ?? 0);
    const aNet = (toNumber(away.goalsForPerGame) ?? 0) - (toNumber(away.goalsAgainstPerGame) ?? 0);
    return deltaToAdvantage(hNet - aNet, 0.6);
  }
  return deltaToAdvantage((hd ?? 0) - (ad ?? 0), 25);
}

/** Special teams: (PP − opp PK) net for each side; neutral when data absent. */
function specialTeamsAdvantage(home, away) {
  const hPP = toNumber(home.ppPct), hPK = toNumber(home.pkPct);
  const aPP = toNumber(away.ppPct), aPK = toNumber(away.pkPct);
  if (hPP == null || aPP == null || hPK == null || aPK == null) return 0.5;
  const homeNet = (hPP - (100 - aPK));
  const awayNet = (aPP - (100 - hPK));
  return deltaToAdvantage(homeNet - awayNet, 8);
}

/** Goalie availability: a severe goalie status on one side swings the line. */
function goalieAdvantage(home, away) {
  const homeHit = SEVERE_GOALIE.has(home.goalieStatus?.statusKey) ? 1 : 0;
  const awayHit = SEVERE_GOALIE.has(away.goalieStatus?.statusKey) ? 1 : 0;
  if (homeHit === 0 && awayHit === 0) return 0.5;
  return deltaToAdvantage(awayHit - homeHit, 1);
}

function restAdvantage(home, away) {
  const hB2B = home.isBackToBack ? -1 : 0;
  const aB2B = away.isBackToBack ? -1 : 0;
  if (hB2B === 0 && aB2B === 0) {
    const hr = toNumber(home.restDays), ar = toNumber(away.restDays);
    if (hr == null || ar == null) return 0.5;
    return deltaToAdvantage(hr - ar, 3);
  }
  return deltaToAdvantage(hB2B - aB2B, 1.2);
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
  return deltaToAdvantage((hw ?? 4) - (aw ?? 4), 3);
}

/**
 * @param {object} context   — from buildNhlGameContext()
 * @param {object} gameMeta  — { homeTeamId, awayTeamId, homeAbbr, awayAbbr }
 */
export function calculateNhlShadowScore(context, gameMeta = {}) {
  const home = context?.home ?? {};
  const away = context?.away ?? {};

  const strAdv  = strengthAdvantage(home, away);
  const stAdv   = specialTeamsAdvantage(home, away);
  const golAdv  = goalieAdvantage(home, away);
  const formAdv = formAdvantage(home, away);
  const restAdv = restAdvantage(home, away);

  const rawHomeAdvantage =
    FEATURE_WEIGHTS.strength     * strAdv  +
    FEATURE_WEIGHTS.specialTeams * stAdv   +
    FEATURE_WEIGHTS.goalie       * golAdv  +
    FEATURE_WEIGHTS.form         * formAdv +
    FEATURE_WEIGHTS.rest         * restAdv;

  const homeAdvantage = Math.max(0, Math.min(1, rawHomeAdvantage + HOME_ICE_BOOST));
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
    `[nhlShadowValidator] ${homeAbbr} vs ${awayAbbr} → ` +
    `homeScore=${homeScoreNorm.toFixed(1)} winner=${predictedWinnerAbbr} ` +
    `conf=${adjConfidence} (raw=${confidence}, completeness=${completeness})`
  );

  return {
    score,
    predicted_winner: predictedWinnerId,
    predicted_winner_abbr: predictedWinnerAbbr,
    confidence: adjConfidence,
    breakdown: {
      strAdv, stAdv, golAdv, formAdv, restAdv,
      homeAdvantage,
      rawConfidence: confidence,
      completeness,
    },
  };
}

export const NHL_SHADOW_MODEL_KEY     = 'nhl_shadow_validator_v1';
export const NHL_SHADOW_MODEL_VERSION = '1';
