/**
 * nflPropProjection.js — projects an NFL player prop and prices it against the book.
 *
 * Why this exists instead of an XGBoost model: there is no historical archive of
 * NFL player-prop *lines*, so there is nothing to pre-train on the way
 * nflverse_loader pre-trains the team markets. Waiting for 500 resolved live
 * picks means no prop signal for two seasons. This module gets a calibrated
 * probability on day one by modelling the thing explicitly instead of learning it:
 *
 *   1. BASELINE   — blend season-to-date and last-4 form, then shrink toward a
 *                   prior. A 2-game sample is noise; shrinkage keeps a fluke
 *                   120-yard week from manufacturing a fake 20% edge.
 *   2. GAME SCRIPT— the NFL-specific edge, and the reason props here can beat the
 *                   MLB equivalent. Spread and total imply how many points each
 *                   team scores, and that drives *volume*: a team down two scores
 *                   throws on every down, a team up two scores runs out the clock.
 *                   Baseball has no such coupling — a hitter gets his four at-bats
 *                   whatever the score.
 *   3. DEFENSE    — regress the opponent's allowed rate toward league average
 *                   (square-root damping: defenses are less repeatable than the
 *                   raw splits suggest).
 *   4. DISTRIBUTION — convert projected mean + dispersion into P(over) with the
 *                   family that matches the stat's shape (see nflPropDistributions).
 *   5. PRICE      — compare to the de-vigged market probability, not the raw
 *                   price, and size with fractional Kelly.
 *
 * Pure and synchronous: every input is passed in, nothing is fetched here. All
 * IO lives in nflPropCandidates.js. Returns { ok: false, reason } rather than
 * throwing, so one bad offer never takes down a slate.
 */

import {
  probOverGamma,
  probOverCount,
  probAtLeastOne,
  expectedCountFromHitProb,
} from './nflPropDistributions.js';

// ── Stat taxonomy ─────────────────────────────────────────────────────────────

/** Distribution family per prop kind. */
export const PROP_FAMILY = {
  pass_yds: 'yards',
  rush_yds: 'yards',
  reception_yds: 'yards',
  rush_rec_yds: 'yards',
  pass_rush_rec_yds: 'yards',
  longest_completion: 'yards',
  longest_rush: 'yards',
  longest_reception: 'yards',
  pass_completions: 'count',
  pass_attempts: 'count',
  pass_interceptions: 'count',
  pass_tds: 'count',
  rush_attempts: 'count',
  receptions: 'count',
  pass_rush_rec_tds: 'count',
  kicking_points: 'count',
  field_goals: 'count',
  sacks: 'count',
  tackles_assists: 'count',
  def_interceptions: 'count',
  anytime_td: 'occurrence',
  first_td: 'occurrence',
  last_td: 'occurrence',
};

/**
 * Game-script group: which side of the ball's volume this stat rides on.
 *   pass  — grows when the team trails (pass-heavy script)
 *   rush  — grows when the team leads (clock-killing script)
 *   score — grows with the team's implied point total
 *   flex  — mixed exposure (a back who catches passes)
 *   none  — no meaningful script coupling
 */
export const PROP_SCRIPT_GROUP = {
  pass_yds: 'pass',
  pass_attempts: 'pass',
  pass_completions: 'pass',
  pass_interceptions: 'pass',
  reception_yds: 'pass',
  receptions: 'pass',
  longest_completion: 'pass',
  longest_reception: 'pass',
  rush_yds: 'rush',
  rush_attempts: 'rush',
  longest_rush: 'rush',
  rush_rec_yds: 'flex',
  pass_rush_rec_yds: 'flex',
  anytime_td: 'score',
  first_td: 'score',
  last_td: 'score',
  pass_tds: 'score',
  pass_rush_rec_tds: 'score',
  kicking_points: 'score',
  field_goals: 'score',
  sacks: 'none',
  tackles_assists: 'none',
  def_interceptions: 'none',
};

/**
 * Per-game coefficient of variation priors (sd / mean), used when the player's
 * own week-to-week dispersion is unavailable or too small a sample to trust.
 * These encode how volatile each stat is in the NFL: a QB's attempts are stable
 * week to week, a receiver's yardage is not, and touchdowns are nearly random.
 */
export const PROP_CV_PRIOR = {
  pass_yds: 0.30,
  pass_attempts: 0.20,
  pass_completions: 0.22,
  pass_interceptions: 0.95,
  pass_tds: 0.65,
  rush_yds: 0.52,
  rush_attempts: 0.34,
  reception_yds: 0.66,
  receptions: 0.44,
  rush_rec_yds: 0.46,
  pass_rush_rec_yds: 0.29,
  pass_rush_rec_tds: 0.60,
  longest_completion: 0.42,
  longest_rush: 0.55,
  longest_reception: 0.50,
  kicking_points: 0.45,
  field_goals: 0.50,
  sacks: 0.90,
  tackles_assists: 0.38,
  def_interceptions: 1.10,
  anytime_td: 0.70,
  first_td: 0.70,
  last_td: 0.70,
};

// ── Tunable model constants ───────────────────────────────────────────────────

export const LEAGUE_AVG_TOTAL = 44.5;
export const LEAGUE_AVG_TEAM_POINTS = LEAGUE_AVG_TOTAL / 2;

/**
 * Script sensitivity. `spreadPerPoint` is the fractional change in projected
 * volume per point of spread, signed from the player's team's perspective
 * (positive spread = underdog). A +7 dog throws ~7% more than neutral; a 7-point
 * favorite runs ~9% more. Caps keep a 17-point line from producing absurdities.
 */
const SCRIPT_SENSITIVITY = {
  pass: { spreadPerPoint: 0.0100, totalExponent: 0.35, cap: 0.14 },
  rush: { spreadPerPoint: -0.0130, totalExponent: 0.20, cap: 0.16 },
  flex: { spreadPerPoint: -0.0020, totalExponent: 0.28, cap: 0.10 },
  score: { spreadPerPoint: 0, totalExponent: 0, cap: 0.40 },
  none: { spreadPerPoint: 0, totalExponent: 0, cap: 0 },
};

const SCORE_POINTS_EXPONENT = 0.85; // implied-points elasticity for scoring props
const DEFENSE_DAMPING = 0.5;        // sqrt regression on opponent allowed rates
const DEFENSE_CAP = 0.18;           // max ±18% from matchup alone
const RECENT_WEIGHT = 0.42;         // last-4 form vs season-to-date
const SHRINK_PSEUDO_GAMES = 4.0;    // games of prior weight in the shrinkage
const SD_PRIOR_PSEUDO_GAMES = 4;    // sample weight when blending measured sd
// Last season's averages are a real prior but a weak one — rosters, schemes and
// roles change over an offseason. Capping the effective sample keeps Week 1
// projections honest: the market keeps most of the weight until current-season
// games accumulate.
const PRIOR_SEASON_EFFECTIVE_GAMES = 3;
const KELLY_FRACTION = 0.25;        // quarter Kelly
const KELLY_CAP = 0.02;             // never stake more than 2% of bankroll

const UNAVAILABLE_STATUSES = new Set(['out', 'ir', 'injured reserve', 'doubtful', 'suspended']);
const DEGRADED_STATUSES = new Set(['questionable', 'gtd', 'game-time decision', 'limited']);

// ── Small helpers ─────────────────────────────────────────────────────────────

function num(v) {
  // Number(null) and Number('') are 0, not NaN — without this guard a missing
  // average would be read as a real zero and drag every blend and factor down.
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function round(v, digits = 4) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function normalizeStatus(status) {
  return String(status ?? '').toLowerCase().trim();
}

// ── Step 1: baseline ──────────────────────────────────────────────────────────

/**
 * Implied points for the player's own team, from the game total and that team's
 * spread (negative = favorite).
 */
export function impliedTeamPoints({ total, teamSpread }) {
  const t = num(total);
  const s = num(teamSpread);
  if (t == null || s == null) return null;
  return t / 2 - s / 2;
}

/** Weighted blend of season-to-date and last-4 form. */
export function blendSeasonRecent({ seasonAvg, recentAvg, games }) {
  const season = num(seasonAvg);
  const recent = num(recentAvg);
  if (season == null && recent == null) return null;
  if (recent == null) return season;
  if (season == null) return recent;
  const g = num(games) ?? 0;
  // Below 5 games "recent" is most of "season" already — double-counting it just
  // amplifies noise, so it earns only half weight.
  const w = g > 4 ? RECENT_WEIGHT : RECENT_WEIGHT * 0.5;
  return recent * w + season * (1 - w);
}

/**
 * Shrink the player's own baseline toward a prior, with weight falling as the
 * sample grows. The prior is the market's own expectation (the line, or for
 * occurrence props the expected count implied by the de-vigged price) — the
 * honest Bayesian choice when we have nothing better, and the thing that stops a
 * one-game sample from printing a 30% edge.
 */
export function shrinkToPrior({ baseline, games, prior }) {
  const b = num(baseline);
  const p = num(prior);
  if (b == null) return p;
  if (p == null) return b;
  const g = Math.max(0, num(games) ?? 0);
  const w = SHRINK_PSEUDO_GAMES / (g + SHRINK_PSEUDO_GAMES);
  return b * (1 - w) + p * w;
}

/** The prior mean for a prop: the line itself, except for occurrence props. */
export function priorMeanFor({ propKind, line, marketProb }) {
  if (PROP_FAMILY[propKind] === 'occurrence') {
    const implied = expectedCountFromHitProb(marketProb);
    return implied ?? 0.5;
  }
  return num(line);
}

// ── Step 2: game script ───────────────────────────────────────────────────────

/**
 * Volume multiplier from the projected game script.
 * Scoring props key off the team's implied point total; volume props key off the
 * spread (who is chasing) and the total (how many plays are coming).
 */
export function gameScriptFactor({ propKind, teamSpread, total }) {
  const group = PROP_SCRIPT_GROUP[propKind] ?? 'none';
  const cfg = SCRIPT_SENSITIVITY[group];
  if (!cfg || group === 'none') return 1;

  const s = num(teamSpread);
  const t = num(total);

  if (group === 'score') {
    const pts = impliedTeamPoints({ total: t, teamSpread: s });
    if (pts == null || pts <= 0) return 1;
    const raw = (pts / LEAGUE_AVG_TEAM_POINTS) ** SCORE_POINTS_EXPONENT;
    return clamp(raw, 1 - cfg.cap, 1 + cfg.cap);
  }

  let factor = 1;
  if (s != null) factor *= 1 + cfg.spreadPerPoint * s;
  if (t != null && t > 0 && cfg.totalExponent) {
    factor *= (t / LEAGUE_AVG_TOTAL) ** cfg.totalExponent;
  }
  return clamp(factor, 1 - cfg.cap, 1 + cfg.cap);
}

// ── Step 3: opponent defense ──────────────────────────────────────────────────

/**
 * Matchup multiplier from the opponent's allowed rate for this stat, regressed
 * toward league average. `allowedPerGame` and `leagueAvgAllowed` must be in the
 * same units (both per-game); either missing → neutral 1.0.
 */
export function defenseFactor({ allowedPerGame, leagueAvgAllowed }) {
  const allowed = num(allowedPerGame);
  const league = num(leagueAvgAllowed);
  if (allowed == null || league == null || league <= 0 || allowed <= 0) return 1;
  const raw = (allowed / league) ** DEFENSE_DAMPING;
  return clamp(raw, 1 - DEFENSE_CAP, 1 + DEFENSE_CAP);
}

// ── Step 4: dispersion ────────────────────────────────────────────────────────

/**
 * Projected standard deviation. A measured per-game sd is better than a prior,
 * but only once there are enough games for it to mean anything, so the two are
 * blended by sample size.
 */
export function projectedDispersion({ propKind, mean, playerStd, games }) {
  const m = num(mean);
  if (m == null || m <= 0) return null;
  const cv = PROP_CV_PRIOR[propKind] ?? 0.5;
  const priorSd = cv * m;
  const measured = num(playerStd);
  if (measured == null || measured <= 0) return priorSd;
  const g = Math.max(0, num(games) ?? 0);
  const w = g / (g + SD_PRIOR_PSEUDO_GAMES);
  return measured * w + priorSd * (1 - w);
}

// ── Step 5: pricing ───────────────────────────────────────────────────────────

export function americanToDecimal(odds) {
  const n = num(odds);
  if (n == null || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

/**
 * Fractional-Kelly stake as a fraction of bankroll, capped. Returns 0 when the
 * bet has no edge at the offered price.
 */
export function kellyStake({ modelProb, oddsAmerican }) {
  const p = num(modelProb);
  const dec = americanToDecimal(oddsAmerican);
  if (p == null || dec == null || dec <= 1) return 0;
  const b = dec - 1;
  const full = (p * b - (1 - p)) / b;
  if (!Number.isFinite(full) || full <= 0) return 0;
  return round(Math.min(full * KELLY_FRACTION, KELLY_CAP), 4);
}

/**
 * Data-quality score in [0,1]. Low confidence does not mean "do not bet" on its
 * own — it means the edge needs to be bigger to clear the bar downstream.
 */
export function confidenceScore({ games, pairedBookmakerCount, hasDefenseData, availabilityStatus, fromPriorSeason = false }) {
  const g = Math.max(0, num(games) ?? 0);
  const sample = clamp(g / 6, 0, 1) * (fromPriorSeason ? 0.8 : 1);
  const books = num(pairedBookmakerCount) ?? 0;
  const market = books >= 3 ? 1 : books >= 1 ? 0.7 : 0.35;
  const defense = hasDefenseData ? 1 : 0.75;
  const status = normalizeStatus(availabilityStatus);
  const health = !status || status === 'active' ? 1 : DEGRADED_STATUSES.has(status) ? 0.6 : 0.8;
  return round(sample * 0.35 + market * 0.3 + defense * 0.15 + health * 0.2, 3);
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Project one prop offer and price it.
 *
 * @param {object} args
 * @param {string} args.propKind   canonical kind (pass_yds, anytime_td, …)
 * @param {'over'|'under'} args.side  the side being offered
 * @param {number} args.line
 * @param {object} args.player     { seasonAvg, recentAvg, games, playerStd, position }
 * @param {object} [args.environment] { teamSpread, total } — player's team perspective
 * @param {object} [args.defense]  { allowedPerGame, leagueAvgAllowed }
 * @param {object} [args.availability] { status }
 * @param {object} [args.market]   { fairProb, impliedProb, oddsAmerican, pairedBookmakerCount }
 * @returns {object} projection result, or { ok: false, reason }
 */
export function projectProp({
  propKind,
  side,
  line,
  player = {},
  environment = {},
  defense = {},
  availability = null,
  market = {},
} = {}) {
  const family = PROP_FAMILY[propKind];
  if (!family) return { ok: false, reason: 'unsupported_prop_kind' };

  const sideLc = String(side ?? '').toLowerCase();
  if (sideLc !== 'over' && sideLc !== 'under') return { ok: false, reason: 'invalid_side' };

  const lineNum = num(line);
  if (lineNum == null || lineNum < 0) return { ok: false, reason: 'invalid_line' };

  const status = normalizeStatus(availability?.status);
  if (UNAVAILABLE_STATUSES.has(status)) return { ok: false, reason: `player_unavailable:${status}` };

  const marketProb = num(market.fairProb) ?? num(market.impliedProb);

  const seasonAvg = num(player.seasonAvg);
  const recentAvg = num(player.recentAvg);
  if (seasonAvg == null && recentAvg == null) return { ok: false, reason: 'no_player_history' };

  // A prior-season row carries a full 17-game sample, but it is not 17 games of
  // evidence about *this* season — cap it so the market shrinkage stays dominant.
  const fromPriorSeason = player.fromPriorSeason === true;
  const rawGames = num(player.games) ?? 0;
  const games = fromPriorSeason ? Math.min(rawGames, PRIOR_SEASON_EFFECTIVE_GAMES) : rawGames;
  const blended = blendSeasonRecent({ seasonAvg, recentAvg, games: rawGames });
  if (blended == null || blended <= 0) return { ok: false, reason: 'no_baseline' };

  const script = gameScriptFactor({
    propKind,
    teamSpread: environment.teamSpread,
    total: environment.total,
  });
  const dFactor = defenseFactor({
    allowedPerGame: defense.allowedPerGame,
    leagueAvgAllowed: defense.leagueAvgAllowed,
  });
  // A questionable player who suits up is usually snap-limited; shade the
  // projection rather than pretending the tag carries no information.
  const healthFactor = DEGRADED_STATUSES.has(status) ? 0.92 : 1;

  // Order matters. The player's own averages are script-neutral — they average
  // over every game state he has played. The book's line is NOT: it already
  // prices this game's spread, total, and matchup. So the adjustments apply to
  // our form estimate only, and the shrinkage toward the market happens after.
  // Adjusting the blended result instead would apply this game's script to a
  // number that already contains it, double-counting it into fake edges.
  const adjustedForm = blended * script * dFactor * healthFactor;
  const prior = priorMeanFor({ propKind, line: lineNum, marketProb });
  const baseline = blended;
  const projectedMean = shrinkToPrior({ baseline: adjustedForm, games, prior });
  if (!(projectedMean > 0)) return { ok: false, reason: 'non_positive_projection' };

  const projectedSd = projectedDispersion({
    propKind,
    mean: projectedMean,
    playerStd: player.playerStd,
    games,
  });

  let probOver = null;
  let probPush = 0;
  let distribution = null;

  if (family === 'yards') {
    distribution = 'gamma';
    probOver = probOverGamma(lineNum, projectedMean, projectedSd);
  } else if (family === 'count') {
    const variance = projectedSd != null ? projectedSd * projectedSd : null;
    const res = probOverCount(lineNum, projectedMean, variance);
    if (res) {
      distribution = variance != null && variance > projectedMean * 1.05 ? 'negbinom' : 'poisson';
      probOver = res.over;
      probPush = res.push;
    }
  } else {
    distribution = 'occurrence';
    probOver = probAtLeastOne(projectedMean);
  }

  if (probOver == null) return { ok: false, reason: 'distribution_failed' };

  const probUnder = clamp(1 - probOver - (probPush ?? 0), 0, 1);
  const modelProb = sideLc === 'over' ? probOver : probUnder;
  const edge = marketProb != null ? modelProb - marketProb : null;

  const confidence = confidenceScore({
    games,
    pairedBookmakerCount: market.pairedBookmakerCount,
    hasDefenseData: dFactor !== 1,
    availabilityStatus: status,
    fromPriorSeason,
  });

  return {
    ok: true,
    propKind,
    side: sideLc,
    line: lineNum,
    family,
    distribution,
    baseline: round(baseline, 3),
    blendedForm: round(blended, 3),
    adjustedForm: round(adjustedForm, 3),
    prior: round(prior, 3),
    factors: {
      script: round(script, 4),
      defense: round(dFactor, 4),
      health: round(healthFactor, 4),
    },
    impliedTeamPoints: round(
      impliedTeamPoints({ total: environment.total, teamSpread: environment.teamSpread }),
      2
    ),
    projectedMean: round(projectedMean, 3),
    projectedSd: round(projectedSd, 3),
    probOver: round(probOver, 4),
    probUnder: round(probUnder, 4),
    probPush: round(probPush ?? 0, 4),
    modelProb: round(modelProb, 4),
    marketProb: round(marketProb, 4),
    edge: round(edge, 4),
    kellyStake: kellyStake({ modelProb, oddsAmerican: market.oddsAmerican }),
    confidence,
    sampleGames: games,
    fromPriorSeason,
    priorSeasonYear: player.priorSeasonYear ?? null,
    rationale: buildRationale({
      propKind,
      side: sideLc,
      line: lineNum,
      blended,
      adjustedForm,
      projectedMean,
      script,
      dFactor,
      modelProb,
      marketProb,
      edge,
      games: rawGames,
      status,
      fromPriorSeason,
      priorSeasonYear: player.priorSeasonYear ?? null,
    }),
  };
}

function pct(p) {
  return p == null ? 'n/a' : `${(p * 100).toFixed(1)}%`;
}

function signedPct(f) {
  const delta = (f - 1) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

function buildRationale({
  propKind, side, line, blended, adjustedForm, projectedMean,
  script, dFactor, modelProb, marketProb, edge, games, status,
  fromPriorSeason, priorSeasonYear,
}) {
  const parts = [];
  const sampleLabel = fromPriorSeason
    ? `${games} game(s) in ${priorSeasonYear ?? 'the prior season'}`
    : `${games} game(s)`;
  parts.push(
    `${propKind} ${side} ${line}: form ${blended == null ? 'n/a' : blended.toFixed(1)} over ${sampleLabel}`
  );
  if (script !== 1) parts.push(`game script ${signedPct(script)}`);
  if (dFactor !== 1) parts.push(`matchup ${signedPct(dFactor)}`);
  if (status && status !== 'active') parts.push(`status ${status}`);
  if (adjustedForm != null && Math.abs(adjustedForm - blended) > 0.05) {
    parts.push(`adjusted ${adjustedForm.toFixed(1)}`);
  }
  parts.push(`projection ${projectedMean.toFixed(1)} after market shrink`);
  parts.push(`model ${pct(modelProb)} vs market ${pct(marketProb)}`);
  if (edge != null) parts.push(`edge ${edge >= 0 ? '+' : ''}${(edge * 100).toFixed(1)} pts`);
  return parts.join(' · ');
}

// ── Ranking ───────────────────────────────────────────────────────────────────

/**
 * Rank projected props by expected value, gated on data quality.
 *
 * The gate matters more than the sort: a 12% "edge" built on two games and one
 * bookmaker is a data artifact, not a bet. minEdge scales with (1 - confidence)
 * so thin data has to clear a higher bar.
 */
export function rankPropProjections(projections, {
  minEdge = 0.03,
  maxEdge = 0.25,
  minConfidence = 0.45,
  minGames = 2,
  limit = 12,
} = {}) {
  const eligible = (projections ?? []).filter((p) => {
    if (!p?.ok) return false;
    if (p.edge == null) return false;
    if (p.confidence < minConfidence) return false;
    if (p.sampleGames < minGames) return false;
    // An edge this large against a liquid market is a data fault — a mismatched
    // player, a stale line, an alt line read as the main one — far more often
    // than it is free money. Drop it rather than lead the board with it.
    if (p.edge > maxEdge) return false;
    const required = minEdge * (1 + (1 - p.confidence));
    return p.edge >= required;
  });

  return eligible
    .map((p) => ({ ...p, score: round(p.edge * p.confidence, 5) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
