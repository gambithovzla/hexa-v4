/**
 * closing-line-capture.js
 * Captures closing lines for pending picks and calculates CLV.
 *
 * Exported:
 *   captureClosingLines() → void
 */

import pool from './db.js';
import { getTodayGames } from './mlb-api.js';
import { getGameOdds, matchOddsToGame, calculateImpliedProbability } from './odds-api.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parses a pick string and extracts the relevant American odds price
 * from a matched odds object, given the matchup string ("AWAY @ HOME").
 *
 * @param {string} pickStr     — e.g. "NYY Moneyline", "Over 8.5"
 * @param {object} matchedOdds — result from matchOddsToGame()
 * @param {string} matchupStr  — e.g. "NYY @ BOS"
 * @returns {number|null}      — American odds integer or null
 */
function extractPickOdds(pickStr, matchedOdds, matchupStr) {
  if (!pickStr || !matchedOdds?.odds) return null;
  const s   = pickStr.trim();
  const odd = matchedOdds.odds;

  // Determine away team abbreviation from matchup (format: "AWAY @ HOME" or "AWAY vs HOME")
  const awayToken = (matchupStr ?? '').split(/\s+(?:@|vs\.?)\s+/i)[0]?.trim().toUpperCase();

  // Over — "Over 8.5", "O 8.5", "Más de 8.5", "Mas de 8.5"
  if (/^(?:Over|O|M[aá]s\s+de)\s+\d/i.test(s)) {
    return odd.overUnder?.overPrice ?? null;
  }

  // Under — "Under 8.5", "U 8.5", "Menos de 8.5"
  if (/^(?:Under|U|Menos\s+de)\s+\d/i.test(s)) {
    return odd.overUnder?.underPrice ?? null;
  }

  // Over with team prefix — "NYY Alta 8.5"
  if (/Alta\s+\d/i.test(s)) return odd.overUnder?.overPrice ?? null;

  // Under with team prefix — "NYY Baja 8.5"
  if (/Baja\s+\d/i.test(s)) return odd.overUnder?.underPrice ?? null;

  // Moneyline — "NYY Moneyline", "NYY ML", "NYY A ganar", "NYY Dinero"
  const mlMatch = s.match(/^(.+?)\s+(?:Moneyline|ML|A\s+ganar|Dinero)$/i);
  if (mlMatch) {
    const token = mlMatch[1].trim().toUpperCase();
    const isAway = token === awayToken ||
      matchedOdds.awayTeam?.toUpperCase().includes(token);
    return isAway ? (odd.moneyline?.away ?? null) : (odd.moneyline?.home ?? null);
  }

  // Run Line favorite — "NYY -1.5 Run Line"
  const rlFavMatch = s.match(/^(.+?)\s+-\d+\.?\d*\s+(?:Run\s+Line|RL|L[ií]nea\s+de\s+Carrera)$/i);
  if (rlFavMatch) {
    const token = rlFavMatch[1].trim().toUpperCase();
    const isAway = token === awayToken;
    return isAway ? (odd.runLine?.away?.price ?? null) : (odd.runLine?.home?.price ?? null);
  }

  // Run Line underdog — "NYY +1.5 Run Line"
  const rlDogMatch = s.match(/^(.+?)\s+\+\d+\.?\d*\s+(?:Run\s+Line|RL|L[ií]nea\s+de\s+Carrera)$/i);
  if (rlDogMatch) {
    const token = rlDogMatch[1].trim().toUpperCase();
    const isAway = token === awayToken;
    return isAway ? (odd.runLine?.away?.price ?? null) : (odd.runLine?.home?.price ?? null);
  }

  return null;
}

/**
 * Finds the game in a games list that corresponds to a matchup string.
 * Supports: "NYY @ BOS", "NYY vs BOS", "NYY - BOS", etc.
 */
function findGameForMatchup(matchup, games) {
  if (!matchup || !games?.length) return null;
  const parts = matchup.split(/\s+(?:vs\.?|@|at|-)\s+/i);
  if (parts.length < 2) return null;

  const [tok1, tok2] = parts.map(t => t.trim().toLowerCase());

  for (const game of games) {
    const home = game.teams?.home;
    const away = game.teams?.away;
    if (!home || !away) continue;

    const homeN  = (home.name ?? '').toLowerCase();
    const awayN  = (away.name ?? '').toLowerCase();
    const homeAb = (home.abbreviation ?? '').toLowerCase();
    const awayAb = (away.abbreviation ?? '').toLowerCase();

    const match1 = (tok1 === awayAb || awayN.includes(tok1)) && (tok2 === homeAb || homeN.includes(tok2));
    const match2 = (tok1 === homeAb || homeN.includes(tok1)) && (tok2 === awayAb || awayN.includes(tok2));

    if (match1 || match2) return game;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Finds pending picks without closing_odds whose game is about to start
 * (within 30 minutes) or has already started, then captures the closing line
 * and computes CLV = implied_prob_closing − implied_prob_at_pick.
 */
export async function captureClosingLines() {
  // 1. Fetch pending picks that have opening odds but no closing odds yet
  const { rows: picks } = await pool.query(`
    SELECT id, matchup, pick, implied_prob_at_pick, created_at
    FROM picks
    WHERE result = 'pending'
      AND odds_at_pick IS NOT NULL
      AND closing_odds IS NULL
  `);

  if (picks.length === 0) {
    console.log('[closing-line] No picks awaiting closing-line capture.');
    return;
  }

  console.log(`[closing-line] Checking ${picks.length} pick(s) for closing-line capture...`);

  // Fetch current odds once (cached for 5 min inside getGameOdds)
  let allOdds = [];
  try {
    allOdds = await getGameOdds();
  } catch (err) {
    console.error('[closing-line] Failed to fetch odds:', err.message);
    return;
  }

  // Group picks by date (from created_at) to minimise MLB API calls
  const byDate = {};
  for (const pick of picks) {
    const date = new Date(pick.created_at).toISOString().split('T')[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(pick);
  }

  const now = Date.now();

  for (const [date, datePicks] of Object.entries(byDate)) {
    let games;
    try {
      games = await getTodayGames(date);
    } catch (err) {
      console.error(`[closing-line] Failed to fetch games for ${date}:`, err.message);
      continue;
    }

    for (const pick of datePicks) {
      try {
        // 2. Find the game for this pick's matchup
        const game = findGameForMatchup(pick.matchup, games);
        if (!game) {
          console.log(`[closing-line] Pick #${pick.id}: no matching game found for "${pick.matchup}"`);
          continue;
        }

        // 3. Check game start time — only capture if within 30 min or already started
        const gameStartMs = game.gameDate ? new Date(game.gameDate).getTime() : null;
        const THIRTY_MIN_MS = 30 * 60 * 1000;
        if (gameStartMs && gameStartMs - now > THIRTY_MIN_MS) {
          // Game starts in more than 30 minutes — too early to capture closing line
          continue;
        }

        // 4. Get current odds for this game
        const matchedOdds = matchOddsToGame(allOdds, game.teams?.home?.name, game.teams?.away?.name);
        if (!matchedOdds) {
          console.log(`[closing-line] Pick #${pick.id}: no odds found for "${pick.matchup}"`);
          continue;
        }

        // 5. Extract closing odds for the specific pick type
        const closingOdds = extractPickOdds(pick.pick, matchedOdds, pick.matchup);
        if (closingOdds == null) {
          console.log(`[closing-line] Pick #${pick.id}: could not extract closing odds for "${pick.pick}"`);
          continue;
        }

        const impliedProbClosing = calculateImpliedProbability(closingOdds);
        if (impliedProbClosing == null) continue;

        // 6. Calculate CLV = closing implied prob − opening implied prob
        const clv = pick.implied_prob_at_pick != null
          ? Math.round((impliedProbClosing - parseFloat(pick.implied_prob_at_pick)) * 100) / 100
          : null;

        // 7. Persist closing line data
        await pool.query(`
          UPDATE picks
          SET closing_odds         = $1,
              implied_prob_closing = $2,
              clv                  = $3
          WHERE id = $4
        `, [closingOdds, impliedProbClosing, clv, pick.id]);

        const openProb = pick.implied_prob_at_pick != null ? parseFloat(pick.implied_prob_at_pick).toFixed(1) : '?';
        console.log(
          `[closing-line] Pick #${pick.id}: opening ${pick.odds_at_pick ?? '?'} (${openProb}%) → ` +
          `closing ${closingOdds} (${impliedProbClosing.toFixed(1)}%) → CLV: ${clv != null ? (clv >= 0 ? '+' : '') + clv.toFixed(1) : '?'}%`
        );
      } catch (err) {
        console.error(`[closing-line] Pick #${pick.id}: unexpected error — ${err.message}`);
      }
    }
  }

  console.log('[closing-line] Closing-line capture pass complete.');
}
