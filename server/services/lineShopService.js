/**
 * lineShopService.js — best available price per game across books.
 *
 * Line shopping is the one edge that does NOT depend on model quality: getting
 * -145 instead of -155 on the same bet is free EV. The Odds API already returns
 * every US book per event; normalizeEvent now attaches a `lineShop` block with
 * the best price + book + EV-vs-consensus per outcome. This service shapes those
 * into a per-game board sorted by the value available.
 *
 * Read-only. Imports getGameOdds (not frozen) — touches nothing else.
 */

import { getGameOdds } from '../odds-api.js';

/**
 * Collects the non-null line-shop outcomes for one game into a flat list of
 * sides, each with the best book, price, and EV gained vs consensus.
 */
function flattenOutcomes(game) {
  const ls = game.lineShop;
  if (!ls) return [];
  const out = [];
  const push = (market, side, label, node) => {
    if (node && node.price != null) {
      out.push({
        market, side, label,
        price: node.price,
        book: node.book,
        bookCount: node.bookCount,
        edgeVsConsensusPts: node.edgeVsConsensusPts,
      });
    }
  };
  push('moneyline', 'home', game.homeTeam, ls.moneyline?.home);
  push('moneyline', 'away', game.awayTeam, ls.moneyline?.away);
  push('overUnder', 'over', `Over ${game.odds?.overUnder?.total ?? ''}`.trim(), ls.overUnder?.over);
  push('overUnder', 'under', `Under ${game.odds?.overUnder?.total ?? ''}`.trim(), ls.overUnder?.under);
  push('runLine', 'home', `${game.homeTeam} RL`, ls.runLine?.home);
  push('runLine', 'away', `${game.awayTeam} RL`, ls.runLine?.away);
  return out;
}

/**
 * Builds the line-shop board for a date. Each game carries its best-price
 * outcomes; the board is sorted by the single biggest edge available so the
 * juiciest shopping opportunities surface first.
 *
 * @param {object} opts
 * @param {string} [opts.date] — YYYY-MM-DD; defaults to today inside getGameOdds.
 * @returns {Promise<{date, games, summary}>}
 */
export async function buildLineShopBoard({ date } = {}) {
  const allOdds = await getGameOdds(date ? { date } : {});
  const real = (allOdds ?? []).filter(g => g.source !== 'estimated_spring_training' && g.lineShop);

  const games = real.map(g => {
    const outcomes = flattenOutcomes(g);
    const maxEdge = outcomes.reduce(
      (m, o) => (o.edgeVsConsensusPts != null && o.edgeVsConsensusPts > m ? o.edgeVsConsensusPts : m),
      0,
    );
    return {
      eventId: g.eventId,
      commenceTime: g.commenceTime,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      matchup: `${g.awayTeam} @ ${g.homeTeam}`,
      outcomes,
      maxEdgePts: +maxEdge.toFixed(2),
    };
  });

  games.sort((a, b) => b.maxEdgePts - a.maxEdgePts);

  const allEdges = games.flatMap(g => g.outcomes.map(o => o.edgeVsConsensusPts).filter(e => e != null));
  const avgEdge = allEdges.length
    ? +(allEdges.reduce((s, e) => s + e, 0) / allEdges.length).toFixed(2)
    : 0;

  return {
    date: date || new Date().toISOString().split('T')[0],
    games,
    summary: {
      gameCount: games.length,
      outcomeCount: allEdges.length,
      avgEdgePts: avgEdge,
      maxEdgePts: games.length ? games[0].maxEdgePts : 0,
    },
  };
}
