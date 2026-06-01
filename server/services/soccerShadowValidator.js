/**
 * server/services/soccerShadowValidator.js
 *
 * Deterministic soccer shadow validator — counterpart of nhlShadowValidator.js
 * for soccer. Not a real model: transparent weighted scoring of team strength
 * (season goal differential + league points), recent form (W-D-L from ESPN form
 * string), and implied probability extracted from the 3-way market odds. Produces
 * a home win share for comparison against the Oracle pick.
 *
 * Soccer is the most efficient market of the five sports: confidence is capped at
 * 62% to match soccerOutputGuard. When 3-way market odds are present they carry
 * the most weight (the book already prices in everything we can model); when absent
 * the score falls back to strength + form alone.
 *
 * Exports:
 *   calculateSoccerShadowScore(context, gameMeta, marketOdds?)
 *     — context    : output of buildSoccerGameContext()
 *     — gameMeta   : { homeTeamId, awayTeamId, homeAbbr, awayAbbr }
 *     — marketOdds : { threeWay: { home, draw, away } } (American odds) or null
 *     Returns { score, predicted_winner, predicted_winner_abbr, confidence, breakdown }
 */

// Weights applied when 3-way market odds are available vs. absent.
// Soccer is the most efficient market — when the book speaks, trust it heavily.
const W_WITH_ODDS    = { strength: 0.25, form: 0.20, odds: 0.55 };
const W_WITHOUT_ODDS = { strength: 0.50, form: 0.50, odds: 0.00 };

// Home field in soccer is real (~0.03–0.05 raw prob swing) but already priced in
// by the market, so only apply when we're NOT using odds as the primary signal.
const HOME_BOOST_NO_ODDS = 0.04;
const HOME_BOOST_ODDS    = 0.01;

const CONFIDENCE_FLOOR = 50;
const CONFIDENCE_CEIL  = 62;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function deltaToAdvantage(delta, scale) {
  if (delta == null || !Number.isFinite(delta)) return 0.5;
  if (scale <= 0) return 0.5;
  return Math.max(0, Math.min(1, 0.5 + 0.5 * Math.tanh(delta / scale)));
}

/** Season goal differential gap (a ~25-goal spread is dominant in top leagues). */
function strengthAdvantage(home, away) {
  const hd = toNumber(home.goalDiff);
  const ad = toNumber(away.goalDiff);
  if (hd != null && ad != null) {
    return deltaToAdvantage((hd ?? 0) - (ad ?? 0), 25);
  }
  // Fallback: use points gap when goal diff is absent
  const hp = toNumber(home.points);
  const ap = toNumber(away.points);
  if (hp != null && ap != null) {
    return deltaToAdvantage(hp - ap, 15);
  }
  return 0.5;
}

/**
 * Parse wins from a recentForm record string ("4W-1D-1L") or recent char string
 * ("WDLWW"). Returns { wins, total } or null.
 */
function parseFormRecord(recentForm) {
  if (!recentForm) return null;
  if (recentForm.record) {
    const m = String(recentForm.record).match(/(\d+)W-(\d+)D-(\d+)L/);
    if (m) {
      const wins  = Number(m[1]);
      const draws = Number(m[2]);
      const losses = Number(m[3]);
      const total = wins + draws + losses;
      return total > 0 ? { wins, total } : null;
    }
  }
  if (recentForm.recent && typeof recentForm.recent === 'string') {
    const chars = recentForm.recent.toUpperCase().split('').filter(c => 'WDL'.includes(c));
    if (chars.length === 0) return null;
    const wins = chars.filter(c => c === 'W').length;
    return { wins, total: chars.length };
  }
  return null;
}

/** Recent form: win rate over last 5-6 games → [0,1]. */
function formAdvantage(home, away) {
  const hf = parseFormRecord(home.recentForm);
  const af = parseFormRecord(away.recentForm);
  if (!hf && !af) return 0.5;
  const hRate = hf ? hf.wins / hf.total : 0.4;
  const aRate = af ? af.wins / af.total : 0.4;
  return deltaToAdvantage(hRate - aRate, 0.3);
}

/** Convert American odds to raw implied probability (includes vig). */
function americanToRawProb(american) {
  const n = toNumber(american);
  if (n == null) return null;
  if (n >= 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

/**
 * Extract de-vigged home win probability from 3-way market odds.
 * Returns null if any leg is missing.
 */
function oddsAdvantage(marketOdds) {
  const tw = marketOdds?.threeWay;
  if (!tw) return null;
  const rawH = americanToRawProb(tw.home);
  const rawD = americanToRawProb(tw.draw);
  const rawA = americanToRawProb(tw.away);
  if (rawH == null || rawD == null || rawA == null) return null;
  const total = rawH + rawD + rawA;
  if (total <= 0) return null;
  // De-vig: normalise to sum to 1, return home win fraction (0–1)
  return rawH / total;
}

/**
 * @param {object} context    — from buildSoccerGameContext()
 * @param {object} gameMeta   — { homeTeamId, awayTeamId, homeAbbr, awayAbbr }
 * @param {object} [marketOdds] — { threeWay: { home, draw, away } } (American odds)
 */
export function calculateSoccerShadowScore(context, gameMeta = {}, marketOdds = null) {
  const home = context?.home ?? {};
  const away = context?.away ?? {};

  const oddsAdv    = oddsAdvantage(marketOdds);
  const oddsPresent = oddsAdv != null;
  const W          = oddsPresent ? W_WITH_ODDS : W_WITHOUT_ODDS;
  const homeBoost  = oddsPresent ? HOME_BOOST_ODDS : HOME_BOOST_NO_ODDS;

  const strAdv  = strengthAdvantage(home, away);
  const formAdv = formAdvantage(home, away);
  const oAdv    = oddsPresent ? oddsAdv : 0.5;

  const rawHomeAdvantage =
    W.strength * strAdv  +
    W.form     * formAdv +
    W.odds     * oAdv;

  const homeAdvantage = Math.max(0, Math.min(1, rawHomeAdvantage + homeBoost));
  const homeScoreNorm = homeAdvantage * 100;
  const homeWins      = homeScoreNorm >= 50;

  const homeId   = String(gameMeta.homeTeamId ?? home.teamId ?? 'home');
  const awayId   = String(gameMeta.awayTeamId ?? away.teamId ?? 'away');
  const homeAbbr = String(gameMeta.homeAbbr ?? home.teamAbbr ?? 'HOME');
  const awayAbbr = String(gameMeta.awayAbbr ?? away.teamAbbr ?? 'AWAY');

  const predictedWinnerId   = homeWins ? homeId   : awayId;
  const predictedWinnerAbbr = homeWins ? homeAbbr : awayAbbr;

  const scoreDiff  = Math.abs(homeScoreNorm - 50);
  const rawConf    = CONFIDENCE_FLOOR + Math.min(scoreDiff * 1.0, CONFIDENCE_CEIL - CONFIDENCE_FLOOR);
  const completeness = toNumber(context?.context_meta?.overallCompleteness) ?? 1;
  const confidence   = Math.round(Math.min(CONFIDENCE_CEIL, Math.max(CONFIDENCE_FLOOR,
    rawConf * (0.65 + 0.35 * completeness)
  )));
  const score = Math.round(Math.min(100, Math.max(0, homeScoreNorm)));

  console.log(
    `[soccerShadowValidator] ${homeAbbr} vs ${awayAbbr} → ` +
    `homeScore=${homeScoreNorm.toFixed(1)} winner=${predictedWinnerAbbr} ` +
    `conf=${confidence} oddsPresent=${oddsPresent} completeness=${completeness}`
  );

  return {
    score,
    predicted_winner: predictedWinnerId,
    predicted_winner_abbr: predictedWinnerAbbr,
    confidence,
    breakdown: {
      strAdv, formAdv, oddsAdv,
      oddsPresent,
      homeAdvantage,
      rawConfidence: Math.round(rawConf),
      completeness,
      weights: W,
    },
  };
}

export const SOCCER_SHADOW_MODEL_KEY     = 'soccer_shadow_validator_v1';
export const SOCCER_SHADOW_MODEL_VERSION = '1';
