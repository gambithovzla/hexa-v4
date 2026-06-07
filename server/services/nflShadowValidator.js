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
  strength:    0.38,  // EPA diff or season point-differential — dominant
  qb:          0.18,  // QB availability is the NFL swing factor
  situational: 0.14,  // red zone TD% + 3rd-down conv% differential
  trenches:    0.10,  // sack rate differential (pass rush vs O-line)
  injuries:    0.10,  // severe injuries beyond QB
  form:        0.06,  // recent results
  rest:        0.04,  // off bye (+) / short week (−)
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

/**
 * Team strength: prefer EPA matchup diff; fall back to season point differential.
 * Returns null (signal absent → re-weighted out) when neither EPA nor point
 * differential is available for either team.
 */
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
  if (hPd == null && aPd == null) return null;
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
    if (hr == null || ar == null) return null; // absent → re-weighted out
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
  if (hw == null && aw == null) return null; // absent → re-weighted out
  return deltaToAdvantage((hw ?? 3) - (aw ?? 3), 2.5);
}

/**
 * Situational efficiency: red zone TD% and 3rd-down conversion rate.
 * Both are scoring efficiency metrics; higher = better offense / better defense
 * (interpreted by perspective: off vs def columns).
 */
function situationalAdvantage(home, away) {
  const hRzOff = toNumber(home.redZoneTdPctOff);
  const aRzOff = toNumber(away.redZoneTdPctOff);
  const hRzDef = toNumber(home.redZoneTdPctDef);
  const aRzDef = toNumber(away.redZoneTdPctDef);
  const h3dOff = toNumber(home.thirdDownConvOff);
  const a3dOff = toNumber(away.thirdDownConvOff);
  const h3dDef = toNumber(home.thirdDownConvDef);
  const a3dDef = toNumber(away.thirdDownConvDef);

  // Net score contributions: (home off advantage − away def resistance) for each team.
  const rzBothPresent = hRzOff != null && aRzOff != null && hRzDef != null && aRzDef != null;
  const tdBothPresent = h3dOff != null && a3dOff != null && h3dDef != null && a3dDef != null;
  if (!rzBothPresent && !tdBothPresent) return null; // absent → re-weighted out

  let scores = [];
  if (rzBothPresent) {
    const homeRzNet = hRzOff - aRzDef;  // home offense vs away defense in RZ
    const awayRzNet = aRzOff - hRzDef;
    scores.push(deltaToAdvantage(homeRzNet - awayRzNet, 0.15));
  }
  if (tdBothPresent) {
    const home3dNet = h3dOff - a3dDef;
    const away3dNet = a3dOff - h3dDef;
    scores.push(deltaToAdvantage(home3dNet - away3dNet, 0.12));
  }
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

/**
 * Trenches: sack rate differential.
 * sack_rate_def = sacks forced / dropbacks (higher = better pass rush).
 * sack_rate_off = sacks allowed / dropbacks (lower = better O-line).
 * Net = (home pass-rush edge) vs (away pass-rush edge).
 */
function trenchesAdvantage(home, away) {
  const hSackDef = toNumber(home.sackRateDef);
  const aSackDef = toNumber(away.sackRateDef);
  const hSackOff = toNumber(home.sackRateOff);
  const aSackOff = toNumber(away.sackRateOff);
  if (hSackDef == null && aSackDef == null && hSackOff == null && aSackOff == null) return null; // absent → re-weighted out

  // Pass-rush advantage: how often home defense sacks vs away defense sacks.
  const rushAdv = (hSackDef != null && aSackDef != null)
    ? deltaToAdvantage(hSackDef - aSackDef, 0.03)
    : 0.5;
  // O-line advantage: how well home O-line protects vs away O-line.
  const olineAdv = (hSackOff != null && aSackOff != null)
    ? deltaToAdvantage(aSackOff - hSackOff, 0.03)  // lower sack rate allowed = better
    : 0.5;

  return (rushAdv + olineAdv) / 2;
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
  const sitAdv  = situationalAdvantage(home, away);
  const trAdv   = trenchesAdvantage(home, away);
  const injAdv  = injuryAdvantage(home.injuries?.severeCount, away.injuries?.severeCount);
  const formAdv = formAdvantage(home, away);
  const restAdv = restAdvantage(home, away);

  // Re-normalize weights over the signals that actually have data. An absent
  // signal (null) gets its weight redistributed proportionally to the present
  // ones instead of silently injecting a neutral 0.5 that dilutes discrimination
  // — this matters off-season when situational/trenches stats are unavailable
  // (24% of the weight collapsing to neutral would flatten every pick to ~0.5).
  const signals = [
    { w: FEATURE_WEIGHTS.strength,    adv: strAdv },
    { w: FEATURE_WEIGHTS.qb,          adv: qbAdv },
    { w: FEATURE_WEIGHTS.situational, adv: sitAdv },
    { w: FEATURE_WEIGHTS.trenches,    adv: trAdv },
    { w: FEATURE_WEIGHTS.injuries,    adv: injAdv },
    { w: FEATURE_WEIGHTS.form,        adv: formAdv },
    { w: FEATURE_WEIGHTS.rest,        adv: restAdv },
  ];
  const present = signals.filter(s => s.adv != null);
  const totalWeight = present.reduce((s, x) => s + x.w, 0) || 1;
  const rawHomeAdvantage = present.length
    ? present.reduce((s, x) => s + (x.w / totalWeight) * x.adv, 0)
    : 0.5;
  const signalCoverage = +(totalWeight.toFixed(2)); // share of the model with data

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
      strAdv, qbAdv, sitAdv, trAdv, injAdv, formAdv, restAdv,
      homeAdvantage,
      signalCoverage,
      rawConfidence: confidence,
      completeness,
    },
  };
}

export const NFL_SHADOW_MODEL_KEY     = 'nfl_shadow_validator_v1';
export const NFL_SHADOW_MODEL_VERSION = '1';
