/**
 * closing-line-capture-props.js
 * Captures closing lines + CLV for MLB *player prop* picks (market_type='prop').
 *
 * The main closing-line-capture.js only handles moneyline / over-under / runline,
 * because prop odds live behind a separate event-specific endpoint (hydrateOddsForGame)
 * and the pick text needs the player+kind+line parser. That gap is why prop CLV
 * coverage was 0% — props simply had no capture path.
 *
 * Additive: this is a brand-new module that imports the frozen-adjacent helpers
 * (odds-api hydrate, pickParser) and the matchup-game finder from the main
 * capture module. Nothing in the original capture flow changes.
 *
 * Exported:
 *   captureClosingLinesProps() → void
 */

import pool from './db.js';
import { getTodayGames } from './mlb-api.js';
import {
  getGameOdds,
  matchOddsToGame,
  hydrateOddsForGame,
  calculateImpliedProbability,
} from './odds-api.js';
import { parsePick } from './parsers/pickParser.js';
import { findGameForMatchup } from './closing-line-capture.js';

// prop_kind (our canonical) → The Odds API market key.
const KIND_TO_MARKET = {
  hits: 'batter_hits',
  total_bases: 'batter_total_bases',
  home_runs: 'batter_home_runs',
  rbis: 'batter_rbis',
  strikeouts: 'pitcher_strikeouts',
};

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finds the matching prop offer price for a parsed pick within a hydrated
 * odds object's playerProps. Matches on market key + player (fuzzy by
 * last-name overlap) + direction; prefers the exact line, else the closest.
 *
 * @returns {number|null} American odds price, or null if no match.
 */
export function matchPropOdds(parsed, playerProps) {
  if (!parsed || parsed.market_type !== 'prop' || !playerProps) return null;
  const marketKey = KIND_TO_MARKET[parsed.prop_kind];
  if (!marketKey) return null;

  const offers = playerProps[marketKey];
  if (!offers?.length) return null;

  const side = parsed.side === 'over' ? 'over' : parsed.side === 'under' ? 'under' : null;
  if (!side) return null;

  const wantName = normalizeName(parsed.prop_player_name);
  const wantTokens = new Set(wantName.split(' ').filter(t => t.length > 2));

  // Candidate offers: same direction + name overlap.
  const candidates = offers.filter(o => {
    if (o.direction !== side) return false;
    const offerName = normalizeName(o.normalizedPlayerName ?? o.playerName);
    const offerTokens = offerName.split(' ').filter(t => t.length > 2);
    return offerTokens.some(t => wantTokens.has(t));
  });
  if (!candidates.length) return null;

  // Prefer exact line match; otherwise the offer with the closest line.
  const wantLine = Number(parsed.line);
  if (Number.isFinite(wantLine)) {
    let best = null, bestDelta = Infinity;
    for (const c of candidates) {
      const delta = Math.abs(Number(c.line) - wantLine);
      if (delta < bestDelta) { bestDelta = delta; best = c; }
    }
    if (best) return best.price ?? null;
  }
  return candidates[0].price ?? null;
}

/**
 * Captures closing lines for prop picks that have opening odds but no closing
 * odds yet. Mirrors captureClosingLines() but routes through the event-specific
 * props endpoint and the prop matcher.
 */
export async function captureClosingLinesProps() {
  const { rows: picks } = await pool.query(`
    SELECT id, matchup, pick, implied_prob_at_pick, created_at
    FROM picks
    WHERE COALESCE(sport, 'mlb') = 'mlb'
      AND market_type = 'prop'
      AND odds_at_pick IS NOT NULL
      AND closing_odds IS NULL
      AND (
        result = 'pending'
        OR (result IN ('win','loss','push') AND created_at > NOW() - INTERVAL '6 hours')
      )
  `);

  if (picks.length === 0) {
    console.log('[closing-line-props] No prop picks awaiting capture.');
    return;
  }

  console.log(`[closing-line-props] Checking ${picks.length} prop pick(s)...`);

  let allOdds = [];
  try {
    allOdds = await getGameOdds();
  } catch (err) {
    console.error('[closing-line-props] Failed to fetch odds:', err.message);
    return;
  }

  const byDate = {};
  for (const pick of picks) {
    const date = new Date(pick.created_at).toISOString().split('T')[0];
    (byDate[date] ??= []).push(pick);
  }

  const now = Date.now();
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

  for (const [date, datePicks] of Object.entries(byDate)) {
    let games;
    try {
      games = await getTodayGames(date);
    } catch (err) {
      console.error(`[closing-line-props] Failed to fetch games for ${date}:`, err.message);
      continue;
    }

    for (const pick of datePicks) {
      try {
        const parsed = parsePick(pick.pick);
        if (parsed?.market_type !== 'prop') continue;

        const game = findGameForMatchup(pick.matchup, games);
        if (!game) {
          console.log(`[closing-line-props] Pick #${pick.id}: no game for "${pick.matchup}"`);
          continue;
        }

        const gameStartMs = game.gameDate ? new Date(game.gameDate).getTime() : null;
        if (gameStartMs && gameStartMs - now > THREE_HOURS_MS) continue;

        let matchedOdds = matchOddsToGame(allOdds, game.teams?.home?.name, game.teams?.away?.name);
        if (!matchedOdds) {
          console.log(`[closing-line-props] Pick #${pick.id}: no odds for "${pick.matchup}"`);
          continue;
        }

        // Props live behind the event-specific endpoint — hydrate before matching.
        matchedOdds = await hydrateOddsForGame(matchedOdds);
        const closingOdds = matchPropOdds(parsed, matchedOdds.playerProps);
        if (closingOdds == null) {
          console.log(`[closing-line-props] Pick #${pick.id}: no prop offer match for "${pick.pick}"`);
          continue;
        }

        const impliedProbClosing = calculateImpliedProbability(closingOdds);
        if (impliedProbClosing == null) continue;

        const clv = pick.implied_prob_at_pick != null
          ? Math.round((impliedProbClosing - parseFloat(pick.implied_prob_at_pick)) * 100) / 100
          : null;

        await pool.query(`
          UPDATE picks
          SET closing_odds = $1, implied_prob_closing = $2, clv = $3
          WHERE id = $4
        `, [closingOdds, impliedProbClosing, clv, pick.id]);

        console.log(
          `[closing-line-props] Pick #${pick.id}: "${pick.pick}" → closing ${closingOdds} ` +
          `(${impliedProbClosing.toFixed(1)}%) → CLV: ${clv != null ? (clv >= 0 ? '+' : '') + clv.toFixed(1) : '?'}%`
        );
      } catch (err) {
        console.error(`[closing-line-props] Pick #${pick.id}: ${err.message}`);
      }
    }
  }

  console.log('[closing-line-props] Prop closing-line capture pass complete.');
}
