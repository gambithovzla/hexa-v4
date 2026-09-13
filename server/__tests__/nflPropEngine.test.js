/**
 * nflPropEngine.test.js — NFL player-prop projection engine (Sprint 9.8).
 *
 * Covers the numerical core against closed-form values, the projection chain's
 * direction and ordering, the gates that keep thin data off the board, and the
 * market-verification guardrail that stops a fabricated prop from reaching a user.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lnGamma,
  normalCdf,
  gammaCdf,
  poissonCdf,
  poissonPmf,
  negBinomialCdf,
  incompleteBeta,
  probOverGamma,
  probOverCount,
  probAtLeastOne,
  expectedCountFromHitProb,
} from '../services/nflPropDistributions.js';

import {
  projectProp,
  rankPropProjections,
  gameScriptFactor,
  defenseFactor,
  blendSeasonRecent,
  shrinkToPrior,
  impliedTeamPoints,
  projectedDispersion,
  kellyStake,
  PROP_FAMILY,
} from '../services/nflPropProjection.js';

import { verifyNflPropPick, playerNamesMatch } from '../services/nflPropVerification.js';
import { validateNflAnalysisOutput } from '../services/nflOutputGuard.js';
import { resolveNflBetTypeDirective, NFL_BET_TYPES, isNflPropFocus } from '../services/nflBetTypeDirective.js';
import { findNflDefenseAllowed, PROP_DEFENSE_STAT } from '../nfl-defense-fetcher.js';
import { nflPropLabel, propOffersFromRanked } from '../services/nflPropCandidates.js';

const close = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);

// ── Distributions ─────────────────────────────────────────────────────────────

test('lnGamma matches known factorials', () => {
  close(Math.exp(lnGamma(5)), 24, 1e-8);   // Γ(5) = 4!
  close(Math.exp(lnGamma(0.5)), Math.sqrt(Math.PI), 1e-8);
});

test('normalCdf matches standard normal table values', () => {
  close(normalCdf(0), 0.5, 1e-12);
  close(normalCdf(1.959963985), 0.975, 1e-7);
  close(normalCdf(-1.959963985), 0.025, 1e-7);
});

test('gammaCdf matches the exponential special case', () => {
  // Gamma(shape=1, scale=1) is Exponential(1): CDF(x) = 1 - e^-x
  close(gammaCdf(1, 1, 1), 1 - Math.exp(-1), 1e-10);
  close(gammaCdf(2.5, 1, 1), 1 - Math.exp(-2.5), 1e-10);
});

test('poissonCdf and pmf match hand-computed values', () => {
  // P(X<=3 | λ=2) = e^-2 (1 + 2 + 2 + 4/3)
  const expected = Math.exp(-2) * (1 + 2 + 2 + 4 / 3);
  close(poissonCdf(3, 2), expected, 1e-10);
  close(poissonPmf(0, 2), Math.exp(-2), 1e-12);
});

test('incompleteBeta matches a closed-form case', () => {
  // I_0.5(2,3) = 0.6875
  close(incompleteBeta(2, 3, 0.5), 0.6875, 1e-9);
});

test('negBinomial requires overdispersion and is wider than Poisson', () => {
  assert.equal(negBinomialCdf(3, 2, 2), null, 'variance == mean is not overdispersed');
  const nb = negBinomialCdf(3, 2, 4);
  const po = poissonCdf(3, 2);
  assert.ok(nb != null);
  // More dispersion → more mass in the tails → less mass in the middle bulk.
  assert.ok(nb < po, `overdispersed CDF ${nb} should sit below Poisson ${po}`);
});

test('probAtLeastOne is not the expected count', () => {
  // The classic anytime-TD error: 0.6 expected TDs is a 45% chance, not 60%.
  close(probAtLeastOne(0.6), 1 - Math.exp(-0.6), 1e-12);
  assert.ok(probAtLeastOne(0.6) < 0.6);
  close(expectedCountFromHitProb(probAtLeastOne(0.6)), 0.6, 1e-9);
});

test('integer count lines carry push mass, half lines do not', () => {
  const half = probOverCount(5.5, 5, 5);
  const whole = probOverCount(5, 5, 5);
  assert.equal(half.push, 0);
  assert.ok(whole.push > 0, 'an integer line can push');
  close(whole.over + whole.under + whole.push, 1, 1e-9);
  close(half.over + half.under, 1, 1e-9);
});

test('gamma skew puts the median below the mean', () => {
  // A projection above the line can still be under 50% to clear it — the
  // property a mean-vs-line comparison misses entirely.
  const p = probOverGamma(280, 285, 90);
  assert.ok(p < 0.5, `expected sub-50% over-probability, got ${p}`);
});

// ── Projection chain ──────────────────────────────────────────────────────────

test('implied team points splits the total by the spread', () => {
  close(impliedTeamPoints({ total: 48, teamSpread: -6 }), 27, 1e-9);
  close(impliedTeamPoints({ total: 48, teamSpread: 6 }), 21, 1e-9);
});

test('season/recent blend leans on recent form only with enough games', () => {
  const fewGames = blendSeasonRecent({ seasonAvg: 100, recentAvg: 200, games: 3 });
  const manyGames = blendSeasonRecent({ seasonAvg: 100, recentAvg: 200, games: 10 });
  assert.ok(manyGames > fewGames, 'recent form earns more weight as the sample grows');
  assert.equal(blendSeasonRecent({ seasonAvg: 100, recentAvg: null, games: 8 }), 100);
});

test('shrinkage toward the prior fades as the sample grows', () => {
  const thin = shrinkToPrior({ baseline: 100, games: 1, prior: 50 });
  const thick = shrinkToPrior({ baseline: 100, games: 16, prior: 50 });
  assert.ok(thin < thick, 'a one-game sample is pulled harder toward the prior');
  assert.ok(thick > 85 && thick < 100);
});

test('game script moves passing and rushing in opposite directions', () => {
  const dogPass = gameScriptFactor({ propKind: 'pass_yds', teamSpread: 7, total: 44.5 });
  const favPass = gameScriptFactor({ propKind: 'pass_yds', teamSpread: -7, total: 44.5 });
  const dogRush = gameScriptFactor({ propKind: 'rush_yds', teamSpread: 7, total: 44.5 });
  const favRush = gameScriptFactor({ propKind: 'rush_yds', teamSpread: -7, total: 44.5 });

  assert.ok(dogPass > 1 && favPass < 1, 'underdogs throw more');
  assert.ok(favRush > 1 && dogRush < 1, 'favorites run more');
});

test('scoring props scale with the implied team total, and stay capped', () => {
  const high = gameScriptFactor({ propKind: 'anytime_td', teamSpread: -10, total: 54 });
  const low = gameScriptFactor({ propKind: 'anytime_td', teamSpread: 10, total: 36 });
  assert.ok(high > 1.1, `high-scoring script should lift TD props, got ${high}`);
  assert.ok(low < 0.9, `low-scoring script should cut TD props, got ${low}`);

  const absurd = gameScriptFactor({ propKind: 'anytime_td', teamSpread: -30, total: 80 });
  assert.ok(absurd <= 1.4, 'the cap holds against nonsense inputs');
});

test('game script is neutral for stats with no script coupling', () => {
  assert.equal(gameScriptFactor({ propKind: 'tackles_assists', teamSpread: 10, total: 50 }), 1);
});

test('defense factor is damped and capped', () => {
  const soft = defenseFactor({ allowedPerGame: 280, leagueAvgAllowed: 220 });
  const tough = defenseFactor({ allowedPerGame: 160, leagueAvgAllowed: 220 });
  assert.ok(soft > 1 && tough < 1);
  // sqrt damping: a 27% raw gap must not become a 27% projection swing
  assert.ok(soft < 1.27, `expected damping, got ${soft}`);
  assert.equal(defenseFactor({ allowedPerGame: null, leagueAvgAllowed: 220 }), 1);
});

test('dispersion blends measured std toward the prior by sample size', () => {
  const thin = projectedDispersion({ propKind: 'rush_yds', mean: 100, playerStd: 10, games: 1 });
  const thick = projectedDispersion({ propKind: 'rush_yds', mean: 100, playerStd: 10, games: 30 });
  assert.ok(thin > thick, 'a 1-game std is mostly prior; a 30-game std is mostly measured');
  assert.ok(Math.abs(thick - 10) < Math.abs(thin - 10));
});

test('game script is applied before the market shrink, not after', () => {
  // The book's line already prices this game's script. Applying the adjustment
  // after blending with the line would double-count it; this asserts the
  // projection stays below the naive (double-counted) value.
  const r = projectProp({
    propKind: 'pass_yds', side: 'over', line: 250,
    player: { seasonAvg: 250, recentAvg: 250, games: 8 },
    environment: { teamSpread: 7, total: 50 },
    market: { fairProb: 0.5, impliedProb: 0.5, oddsAmerican: -110, pairedBookmakerCount: 4 },
  });
  assert.ok(r.ok);
  const naiveDoubleCount = 250 * r.factors.script;
  assert.ok(
    r.projectedMean < naiveDoubleCount,
    `projection ${r.projectedMean} must sit below the double-counted ${naiveDoubleCount}`
  );
  assert.ok(r.projectedMean > 250, 'but still above the unadjusted baseline');
});

test('a neutral spot against a fair line produces no meaningful edge', () => {
  const r = projectProp({
    propKind: 'receptions', side: 'over', line: 4.5,
    player: { seasonAvg: 4.5, recentAvg: 4.5, games: 8 },
    environment: { teamSpread: 0, total: 44.5 },
    market: { fairProb: 0.5, impliedProb: 0.5, oddsAmerican: -110, pairedBookmakerCount: 4 },
  });
  assert.ok(r.ok);
  assert.ok(Math.abs(r.edge) < 0.06, `expected a near-zero edge, got ${r.edge}`);
});

test('projection refuses players who are out, and those with no history', () => {
  const base = {
    propKind: 'rush_yds', side: 'over', line: 50,
    player: { seasonAvg: 70, recentAvg: 70, games: 6 },
    market: { fairProb: 0.5, oddsAmerican: -110 },
  };
  assert.equal(projectProp({ ...base, availability: { status: 'OUT' } }).ok, false);
  assert.equal(projectProp({ ...base, availability: { status: 'Doubtful' } }).ok, false);
  assert.equal(projectProp({ ...base, player: {} }).reason, 'no_player_history');
  assert.equal(projectProp({ ...base, propKind: 'made_up_stat' }).reason, 'unsupported_prop_kind');
  assert.equal(projectProp({ ...base, side: 'maybe' }).reason, 'invalid_side');
});

test('a questionable player is shaded down rather than ignored', () => {
  const args = {
    propKind: 'reception_yds', side: 'over', line: 60,
    player: { seasonAvg: 70, recentAvg: 70, games: 8 },
    market: { fairProb: 0.5, oddsAmerican: -110 },
  };
  const healthy = projectProp(args);
  const questionable = projectProp({ ...args, availability: { status: 'questionable' } });
  assert.ok(questionable.projectedMean < healthy.projectedMean);
  assert.ok(questionable.confidence < healthy.confidence);
});

test('every prop kind has a distribution family', () => {
  for (const kind of Object.keys(PROP_DEFENSE_STAT)) {
    assert.ok(PROP_FAMILY[kind], `${kind} needs a distribution family`);
  }
});

test('kelly stake is fractional, capped, and zero without edge', () => {
  assert.equal(kellyStake({ modelProb: 0.4, oddsAmerican: -110 }), 0);
  const stake = kellyStake({ modelProb: 0.62, oddsAmerican: -110 });
  assert.ok(stake > 0 && stake <= 0.02, `expected a capped positive stake, got ${stake}`);
});

// ── Ranking gates ─────────────────────────────────────────────────────────────

const proj = (over) => ({
  ok: true, edge: over.edge ?? 0.05, confidence: over.confidence ?? 0.9,
  sampleGames: over.sampleGames ?? 8, ...over,
});

test('ranking demands a bigger edge from lower-confidence projections', () => {
  const confident = proj({ edge: 0.04, confidence: 0.95, name: 'a' });
  const shaky = proj({ edge: 0.04, confidence: 0.5, name: 'b' });
  const ranked = rankPropProjections([confident, shaky], { minEdge: 0.03 });
  assert.deepEqual(ranked.map(r => r.name), ['a'], 'the thin-data 4% edge must not clear the bar');
});

test('ranking drops implausible edges and thin samples', () => {
  const absurd = proj({ edge: 0.40, confidence: 0.9, name: 'absurd' });
  const thin = proj({ edge: 0.10, confidence: 0.9, sampleGames: 1, name: 'thin' });
  const good = proj({ edge: 0.08, confidence: 0.9, name: 'good' });
  const ranked = rankPropProjections([absurd, thin, good]);
  assert.deepEqual(ranked.map(r => r.name), ['good']);
});

test('ranking sorts by edge weighted by confidence', () => {
  const a = proj({ edge: 0.10, confidence: 0.5, name: 'a' });
  const b = proj({ edge: 0.09, confidence: 0.95, name: 'b' });
  const ranked = rankPropProjections([a, b], { minConfidence: 0.4 });
  assert.equal(ranked[0].name, 'b', 'a well-supported 9% beats a shaky 10%');
});

test('an explicit prop request can drop the edge floor without dropping data quality', () => {
  const noEdge = proj({ edge: 0.001, confidence: 0.8, name: 'flat' });
  assert.equal(rankPropProjections([noEdge]).length, 0);
  assert.equal(rankPropProjections([noEdge], { minEdge: 0, minConfidence: 0.35 }).length, 1);
  const thin = proj({ edge: 0.05, confidence: 0.2, name: 'thin' });
  assert.equal(rankPropProjections([thin], { minEdge: 0, minConfidence: 0.35 }).length, 0);
});

// ── Market verification ───────────────────────────────────────────────────────

const OFFERS = [
  { propKind: 'rush_yds', playerName: 'Saquon Barkley', side: 'over', line: 74.5, oddsAmerican: -115 },
  { propKind: 'rush_yds', playerName: 'Saquon Barkley', side: 'under', line: 74.5, oddsAmerican: -105 },
  { propKind: 'anytime_td', playerName: 'A.J. Brown', side: 'over', line: 0.5, oddsAmerican: 145 },
];

test('player name matching tolerates punctuation and initials but not strangers', () => {
  assert.ok(playerNamesMatch('A.J. Brown', 'AJ Brown'));
  assert.ok(playerNamesMatch('P. Mahomes', 'Patrick Mahomes'));
  assert.ok(playerNamesMatch('Odell Beckham Jr.', 'Odell Beckham'));
  assert.ok(!playerNamesMatch('Antonio Brown', 'A.J. Brown'));
  assert.ok(!playerNamesMatch('Josh Allen', 'Keenan Allen'));
});

test('verification accepts a posted prop and rejects invented ones', () => {
  assert.ok(verifyNflPropPick({ pickText: 'Saquon Barkley Over 74.5 Rushing Yards (-115)', propOffers: OFFERS }).ok);
  assert.ok(verifyNflPropPick({ pickText: 'A.J. Brown Anytime TD', propOffers: OFFERS }).ok);

  assert.match(
    verifyNflPropPick({ pickText: 'Saquon Barkley Over 60.5 Rushing Yards', propOffers: OFFERS }).reason,
    /prop_line_not_offered/
  );
  assert.equal(
    verifyNflPropPick({ pickText: 'Jalen Hurts Over 250.5 Passing Yards', propOffers: OFFERS }).reason,
    'prop_kind_not_offered'
  );
  assert.equal(
    verifyNflPropPick({ pickText: 'Jalen Hurts Over 74.5 Rushing Yards', propOffers: OFFERS }).reason,
    'prop_player_not_offered'
  );
  assert.equal(verifyNflPropPick({ pickText: 'anything', propOffers: [] }).reason, 'no_prop_market_offered');
});

// ── Output guard ──────────────────────────────────────────────────────────────

const analysis = (type, pick) => ({
  master_prediction: { pick, oracle_confidence: 64 },
  best_pick: { type, detail: pick },
  oracle_report: 'x'.repeat(300),
});

test('props stay blocked when the flag is off', () => {
  const res = validateNflAnalysisOutput(analysis('PlayerProp', 'Saquon Barkley Over 74.5 Rushing Yards'), {});
  assert.equal(res.ok, false);
  assert.ok(res.errors.includes('player_prop_blocked'));
});

test('an enabled prop pick passes only when it matches the offered market', () => {
  const good = validateNflAnalysisOutput(
    analysis('PlayerProp', 'Saquon Barkley Over 74.5 Rushing Yards'),
    { propsEnabled: true, propOffers: OFFERS }
  );
  assert.equal(good.ok, true);
  assert.equal(good.data.prop_selection.propKind, 'rush_yds');
  assert.equal(good.data.prop_selection.line, 74.5);

  const invented = validateNflAnalysisOutput(
    analysis('PlayerProp', 'Saquon Barkley Over 60.5 Rushing Yards'),
    { propsEnabled: true, propOffers: OFFERS }
  );
  assert.equal(invented.ok, false);
  assert.ok(invented.errors.some(e => e.startsWith('prop_not_in_market')));
});

test('a prop pick is exempt from the team-market line provenance check', () => {
  // "Over 74.5" would otherwise be read as a game total and flagged as a mismatch.
  const res = validateNflAnalysisOutput(
    analysis('PlayerProp', 'Saquon Barkley Over 74.5 Rushing Yards'),
    { propsEnabled: true, propOffers: OFFERS, marketOdds: { total: { line: 47.5 }, spread: { home: -3 } } }
  );
  assert.equal(res.ok, true);
  assert.equal(res.data.line_provenance.status, 'not_applicable');
});

test('team-market picks are unaffected by the props flag', () => {
  for (const propsEnabled of [false, true]) {
    const res = validateNflAnalysisOutput(analysis('Spread', 'KC -2.5'), { propsEnabled, propOffers: OFFERS });
    assert.equal(res.ok, true, `spread pick should pass with propsEnabled=${propsEnabled}`);
  }
});

// ── Bet focus ─────────────────────────────────────────────────────────────────

test('bet focus maps to directives and prop-kind filters', () => {
  assert.ok(NFL_BET_TYPES.includes('td_scorer'));
  assert.ok(isNflPropFocus('rec_props'));
  assert.ok(!isNflPropFocus('spread'));

  const td = resolveNflBetTypeDirective('td_scorer', { propsAvailable: true });
  assert.deepEqual(td.propKinds, ['anytime_td', 'first_td', 'last_td']);
  assert.ok(td.propsRequested);
  assert.match(td.directive, /MANDATORY BET TYPE/);

  assert.equal(resolveNflBetTypeDirective('spread', {}).propKinds, null);
  assert.equal(resolveNflBetTypeDirective('garbage', {}).betType, 'all', 'unknown focus falls back to all');
});

test('an unavailable prop market degrades honestly instead of silently', () => {
  const res = resolveNflBetTypeDirective('props', { propsAvailable: false });
  assert.ok(res.unavailable);
  assert.match(res.directive, /REQUESTED BET TYPE UNAVAILABLE/);
  assert.match(res.directive, /state in the first line of oracle_report/);
});

test('the default focus mentions props only when they are available', () => {
  assert.match(resolveNflBetTypeDirective('all', { propsAvailable: false }).directive, /No player props/);
  assert.match(resolveNflBetTypeDirective('all', { propsAvailable: true }).directive, /player props/);
});

// ── Defense lookup + labels ───────────────────────────────────────────────────

test('defense lookup resolves the right stat and tolerates gaps', () => {
  const payload = {
    byAbbr: { KC: { games: 5, pass_yds: 260, total_tds: 2.4 } },
    league: { pass_yds: 220, total_tds: 2.1 },
    isFallback: false, season: 2026,
  };
  assert.equal(findNflDefenseAllowed(payload, 'KC', 'reception_yds').stat, 'pass_yds');
  assert.equal(findNflDefenseAllowed(payload, 'KC', 'anytime_td').allowedPerGame, 2.4);
  assert.equal(findNflDefenseAllowed(payload, 'KC', 'tackles_assists'), null);
  assert.equal(findNflDefenseAllowed(payload, 'BUF', 'pass_yds'), null);
  assert.equal(findNflDefenseAllowed(null, 'KC', 'pass_yds'), null);
});

test('prop labels are human-readable and degrade for unknown kinds', () => {
  assert.equal(nflPropLabel('reception_yds'), 'Receiving Yards');
  assert.equal(nflPropLabel('anytime_td'), 'Anytime TD');
  assert.equal(nflPropLabel('weird_kind'), 'weird kind');
});

test('the guard menu is derived from exactly what was ranked', () => {
  const offers = propOffersFromRanked([
    { propKind: 'rush_yds', playerName: 'X', side: 'over', line: 50, modelProb: 0.6, marketProb: 0.5, edge: 0.1, confidence: 0.9, oddsAmerican: -110 },
  ]);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].line, 50);
  assert.ok(verifyNflPropPick({ pickText: 'X Over 50 Rushing Yards', propOffers: offers }).ok);
});

// ── Prior-season fallback (Week 1) ────────────────────────────────────────────

import { findNflPlayerPropStat as findStat } from '../nfl-player-fetcher.js';

const WEEK1_PAYLOAD = {
  season: 2026,
  players: {},  // nobody has played a 2026 game yet
  priorSeason: {
    season: 2025,
    players: {
      'saquon barkley': {
        name: 'Saquon Barkley', team: 'PHI', position: 'RB', games: 17,
        season_avg: { rush_yds: 105.4 }, recent_avg: { rush_yds: 98.0 },
        season_std: { rush_yds: 42.1 },
      },
    },
  },
};

test('Week 1 falls back to last season rather than projecting nothing', () => {
  const stat = findStat(WEEK1_PAYLOAD, 'Saquon Barkley', 'rush_yds');
  assert.ok(stat, 'a player with no current-season games must still resolve');
  assert.equal(stat.fromPriorSeason, true);
  assert.equal(stat.priorSeasonYear, 2025);
  assert.equal(stat.seasonAvg, 105.4);
});

test('the current season takes over once it has enough games', () => {
  const payload = {
    ...WEEK1_PAYLOAD,
    players: {
      'saquon barkley': {
        name: 'Saquon Barkley', team: 'PHI', games: 4,
        season_avg: { rush_yds: 70 }, recent_avg: { rush_yds: 70 },
      },
    },
  };
  const stat = findStat(payload, 'Saquon Barkley', 'rush_yds');
  assert.equal(stat.fromPriorSeason, false);
  assert.equal(stat.seasonAvg, 70);
});

test('a thin current-season sample defers to last season', () => {
  const payload = {
    ...WEEK1_PAYLOAD,
    players: {
      'saquon barkley': {
        name: 'Saquon Barkley', team: 'PHI', games: 1,
        season_avg: { rush_yds: 12 },  // one bad game is not a projection
        recent_avg: { rush_yds: 12 },
      },
    },
  };
  const stat = findStat(payload, 'Saquon Barkley', 'rush_yds');
  assert.equal(stat.fromPriorSeason, true, 'one game is noise, last season is the better prior');
});

test('a rookie with neither current nor prior history resolves to nothing', () => {
  assert.equal(findStat(WEEK1_PAYLOAD, 'Some Rookie', 'rush_yds'), null);
});

test('prior-season form is weighted down, not treated as 17 games of evidence', () => {
  const common = {
    propKind: 'rush_yds', side: 'over', line: 80,
    player: { seasonAvg: 105, recentAvg: 105, games: 17 },
    environment: { teamSpread: 0, total: 44.5 },
    market: { fairProb: 0.5, impliedProb: 0.5, oddsAmerican: -110, pairedBookmakerCount: 4 },
  };
  const current = projectProp(common);
  const prior = projectProp({
    ...common,
    player: { ...common.player, fromPriorSeason: true, priorSeasonYear: 2025 },
  });

  assert.ok(current.ok && prior.ok);
  assert.equal(prior.fromPriorSeason, true);
  assert.ok(prior.sampleGames < current.sampleGames, 'effective sample must be capped');
  assert.ok(
    prior.projectedMean < current.projectedMean,
    'with less evidence the projection sits closer to the market line'
  );
  assert.ok(prior.edge < current.edge, 'and the claimed edge shrinks with it');
  assert.ok(prior.confidence < current.confidence);
  assert.match(prior.rationale, /2025/, 'the rationale must say the form is not current-season');
});
