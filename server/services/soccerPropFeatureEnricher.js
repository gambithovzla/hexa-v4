/**
 * soccerPropFeatureEnricher.js — Derives no-vig fair probabilities from paired
 * over/under soccer prop offers.
 *
 * Identical logic to nflPropFeatureEnricher.js: pair the Over and Under of the
 * same (player, propKind, line) and normalize their implied probabilities to
 * remove the book's vig. Yes-markets (anytime_goal, card — no paired under) get
 * only impliedProb, no fairProb.
 *
 * Exported:
 *   enrichSoccerPropOffers(offers)  — attaches { impliedProb, fairProb, vig, pairComplete }
 */

function americanToImplied(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

function normKey(name) {
  return String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function round4(v) {
  return v == null ? null : Math.round(v * 1e4) / 1e4;
}

/**
 * @param {Array} offers - normalized prop offers from normalizeSoccerPropEvent()
 *   each: { propKind, playerName, side, line, oddsAmerican, impliedProb }
 * @returns {Array} same offers with fairProb (de-vigged) + vig when the opposite
 *   side exists at the same line; impliedProb only for yes-markets.
 */
export function enrichSoccerPropOffers(offers) {
  if (!Array.isArray(offers)) return [];

  const byPair = new Map();
  for (const o of offers) {
    const k = `${o.propKind}|${normKey(o.playerName)}|${o.line}`;
    const pair = byPair.get(k) ?? {};
    pair[o.side] = o;
    byPair.set(k, pair);
  }

  return offers.map((o) => {
    const implied = o.impliedProb ?? americanToImplied(o.oddsAmerican);
    const k = `${o.propKind}|${normKey(o.playerName)}|${o.line}`;
    const pair = byPair.get(k) ?? {};
    const over  = pair.over  ? (pair.over.impliedProb  ?? americanToImplied(pair.over.oddsAmerican))  : null;
    const under = pair.under ? (pair.under.impliedProb ?? americanToImplied(pair.under.oddsAmerican)) : null;

    let fairProb = null;
    let vig = null;
    if (over != null && under != null && over + under > 0) {
      const overhead = over + under;
      vig = round4(overhead - 1);
      fairProb = round4((o.side === 'under' ? under : over) / overhead);
    }

    return {
      ...o,
      impliedProb: round4(implied),
      fairProb,
      vig,
      pairComplete: over != null && under != null,
    };
  });
}
