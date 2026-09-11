/**
 * nflPropFeatureEnricher.js — Derives no-vig fair probabilities from paired
 * over/under NFL prop offers.
 *
 * The board's first signal (until a dedicated NFL-prop ML model ships) is the
 * market's own fair probability. A single American price carries the book's vig;
 * pairing the Over and Under of the same (player, propKind, line) and normalizing
 * their implied probabilities removes it. This is honest, pure, and unit-testable
 * with no external data — the player-level advanced-stat enrichment (nflverse)
 * lands with the ML sprint.
 *
 * Exported:
 *   enrichNflPropOffers(offers)  — attaches { impliedProb, fairProb, vig, pairLine }
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
 * @param {Array} offers - normalized prop offers from normalizeNflPropEvent()
 *   each: { propKind, playerName, side, line, oddsAmerican, impliedProb }
 * @returns {Array} same offers with fairProb (de-vigged) + vig attached when the
 *   opposite side exists at the same line; impliedProb only otherwise.
 */
export function enrichNflPropOffers(offers) {
  if (!Array.isArray(offers)) return [];

  // Index offers by (player, propKind, line) so we can pair over/under.
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
    const over = pair.over ? (pair.over.impliedProb ?? americanToImplied(pair.over.oddsAmerican)) : null;
    const under = pair.under ? (pair.under.impliedProb ?? americanToImplied(pair.under.oddsAmerican)) : null;

    let fairProb = null;
    let vig = null;
    let pairedBookmakerCount = 0;
    const quoted = Array.isArray(pair.over?.quotes) || Array.isArray(pair.under?.quotes);
    if (quoted) {
      const underByBook = new Map((pair.under?.quotes ?? [])
        .filter(q => q.bookmaker && q.line === o.line)
        .map(q => [q.bookmaker, americanToImplied(q.oddsAmerican)]));
      const paired = (pair.over?.quotes ?? []).flatMap(q => {
        const pOver = americanToImplied(q.oddsAmerican);
        const pUnder = underByBook.get(q.bookmaker);
        return q.line === o.line && pOver != null && pUnder != null
          ? [{ over: pOver / (pOver + pUnder), vig: pOver + pUnder - 1 }] : [];
      });
      pairedBookmakerCount = paired.length;
      if (paired.length) {
        const fairOver = paired.reduce((sum, p) => sum + p.over, 0) / paired.length;
        fairProb = round4(o.side === 'under' ? 1 - fairOver : fairOver);
        vig = round4(paired.reduce((sum, p) => sum + p.vig, 0) / paired.length);
      }
    } else if (over != null && under != null && over + under > 0) {
      const overhead = over + under;
      vig = round4(overhead - 1);
      const fair = (o.side === 'under' ? under : over) / overhead;
      fairProb = round4(fair);
    }

    return {
      ...o,
      impliedProb: round4(implied),
      fairProb,
      vig,
      pairComplete: fairProb != null,
      pairedBookmakerCount,
    };
  });
}
