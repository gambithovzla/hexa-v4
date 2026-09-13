/**
 * nflObjectiveDirective.js — how the NFL Oracle should CHOOSE, as opposed to
 * what market it should choose from (that is nflBetTypeDirective.js).
 *
 * Three objectives, deliberately separate from the bet-focus selector so they
 * compose: "QB props, most likely to hit" and "all markets, conviction" are both
 * expressible without duplicating nine options three times.
 *
 *   value       — the default and the historical behaviour: find where the market
 *                 is mispriced. Maximises long-run return, not hit rate.
 *   probability — pick what is most likely to happen and ignore the price. Wins
 *                 more often; wins less money. The user chooses this knowingly,
 *                 so the prompt must not quietly re-introduce value reasoning.
 *   conviction  — emulate a disciplined professional: bet rarely, fade the
 *                 narrative the market is pricing, and PASS when nothing clears
 *                 the bar. Selectivity is the point, not a side effect.
 *
 * Pure; exported for tests.
 */

export const NFL_OBJECTIVES = ['value', 'probability', 'conviction'];

const VALUE_DIRECTIVE =
  'OBJECTIVE: VALUE. Select the bet where the gap between your modelled probability and the ' +
  'market price is largest. This is the default professional posture — maximise long-run return, ' +
  'not hit rate.';

const PROBABILITY_DIRECTIVE = `MANDATORY OBJECTIVE — MAXIMUM HIT PROBABILITY.

Select the single outcome MOST LIKELY TO HAPPEN. The price is not a criterion. The user has chosen this explicitly and understands the trade-off; do not quietly re-introduce value reasoning.

1. Rank every candidate by its probability of hitting, never by edge. A -300 favourite at 78% beats a +140 underdog at 53%, even though the underdog is the better price.
2. Never prefer a lower-probability selection because it pays more. If two selections are close in probability, take the one whose outcome depends on fewer independent events.
3. Predictability differs by market. A spread with a large cushion or a total in a stable scoring environment is more predictable than any single player's stat line. Anytime-touchdown props are the LEAST predictable market on the board — scoring is close to random week to week — so take one only when its modelled probability is genuinely among the highest available, never because the name is appealing.
4. Do NOT inflate oracle_confidence to justify the pick. Confidence stays your honest estimate and the 72% cap still holds. A 66% pick reported as 66% is the point of this mode.
5. bet_value stays honest too. If the price makes the edge negative, say NO VALUE and keep the pick. In this mode a NO VALUE pick is a correct answer, not a contradiction.`;

const CONVICTION_DIRECTIVE = `MANDATORY OBJECTIVE — CONVICTION ANALYST.

Emulate a disciplined professional handicapper. Such a handicapper is profitable because of what they decline to bet, not because they find something every week.

1. SELECTIVITY IS THE EDGE. Most games are priced correctly and offer nothing. If this game does not clear the bar below, you MUST answer PASS. A PASS is a successful outcome in this mode, not a failure to analyse.

2. FADE THE NARRATIVE. The market shades lines toward famous quarterbacks, recent champions, prime-time teams and whichever story the public is telling this week. When your fundamentals — EPA differential, trenches, situational efficiency, availability — point clearly one way and the market points the other, that disagreement is the opportunity. Say plainly in oracle_report which narrative you are fading and why the data disagrees.

3. DEMAND COHERENCE. Conviction requires the independent signals to agree. Use the SIGNAL COHERENCE framework: claim conviction only at 6+ of 8 aligned. At 5 or fewer, either PASS or drop to a modest pick and label it as such — never dress a coin flip as a lock.

4. THE MARKET IS USUALLY RIGHT. Disagreeing with it is not itself insight. You need a STRUCTURAL reason it is wrong: a narrative premium on a popular side, an injury the line has not absorbed, a scheme or trench mismatch the box score hides, a spot the schedule creates. If you cannot name that reason in one sentence, you do not have a conviction play — PASS.

5. RESPECT KEY NUMBERS. Do not take a side across 3 or 7 to manufacture a play. A great read on the wrong number is a bad bet.

6. WHEN YOU DO PICK, SAY IT PLAINLY. One pick, stated with the reason it is right and the one scenario that breaks it. No hedging language.

HOW TO PASS: set master_prediction.pick to exactly "PASS", oracle_confidence to 50, bet_value to "NO VALUE", and use oracle_report to explain in plain language what you looked at and why nothing cleared the bar. Naming the closest candidate and what it was missing is useful to the user.`;

const DIRECTIVES = {
  value: VALUE_DIRECTIVE,
  probability: PROBABILITY_DIRECTIVE,
  conviction: CONVICTION_DIRECTIVE,
};

/**
 * Ranking options handed to rankPropProjections, per objective.
 *
 * `probability` drops the edge floor entirely (a negative edge is acceptable by
 * definition here) and replaces it with a floor on the modelled probability, so
 * "most likely" cannot be satisfied by the least-bad option on a thin slate.
 * `conviction` tightens every floor instead: fewer, better-supported candidates.
 */
const RANK_OPTIONS = {
  value: {},
  probability: { sortBy: 'probability', minEdge: null, minModelProb: 0.62, minConfidence: 0.5 },
  conviction: { sortBy: 'score', minEdge: 0.045, minConfidence: 0.6, minGames: 3 },
};

/** Does this objective permit a PASS instead of a pick? */
export function nflObjectiveAllowsPass(objective) {
  return normalizeObjective(objective) === 'conviction';
}

export function normalizeObjective(objective) {
  const o = String(objective ?? '').toLowerCase();
  return NFL_OBJECTIVES.includes(o) ? o : 'value';
}

/**
 * @param {string} objective  one of NFL_OBJECTIVES ('value' when unset/unknown)
 * @returns {{ objective, directive, rankOptions, allowPass }}
 */
export function resolveNflObjective(objective) {
  const o = normalizeObjective(objective);
  return {
    objective: o,
    directive: DIRECTIVES[o],
    rankOptions: { ...RANK_OPTIONS[o] },
    allowPass: o === 'conviction',
  };
}
