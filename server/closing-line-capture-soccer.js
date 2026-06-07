/**
 * closing-line-capture-soccer.js
 * Captures closing lines for pending soccer picks and computes CLV.
 *
 * Soccer analog of closing-line-capture.js (MLB). Differences:
 *   - League-aware: picks carry `league`; games/odds are fetched per league slug.
 *   - 3-way market: the pick price comes from threeWay {home, draw, away}, total
 *     {overPrice, underPrice}, or btts {yes, no} — never a runline.
 *   - The OPENING odds are read from the pick's persisted `odds_details` snapshot
 *     (the full marketOdds JSON captured at analysis time), so this module needs
 *     no write on the pick-creation path. The CLOSING odds are fetched live near
 *     kickoff. CLV = implied_prob_closing − implied_prob_opening.
 *
 * Exported:
 *   extractSoccerPickOdds(pickStr, marketOdds) → American price | null  (pure)
 *   impliedProbPct(american)                   → 0–100 | null            (pure)
 *   computeSoccerClv(openAmerican, closeAmerican) → { clv, impliedOpen, impliedClose } (pure)
 *   captureSoccerClosingLines() → void
 */

import pool from './db.js';
import { getSoccerGamesForDate } from './soccer-api.js';
import { getSoccerGameOdds, matchSoccerOddsToGame, buildMarketOddsForGame } from './soccer-odds.js';

/** American odds → implied probability as a 0–100 percentage (1 decimal). */
export function impliedProbPct(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  const frac = n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  return Math.round(frac * 1000) / 10;
}

/**
 * Extract the American price for a soccer pick from a marketOdds snapshot
 * ({ threeWay, total, btts }). Pure — used for both the opening (from
 * odds_details) and the closing (from live odds) price. Returns null for picks
 * the 1X2/total/BTTS markets don't cover (e.g. player props).
 */
export function extractSoccerPickOdds(pickStr, marketOdds) {
  if (!pickStr || !marketOdds) return null;
  const s = String(pickStr).trim().toLowerCase();
  const tw   = marketOdds.threeWay ?? {};
  const tot  = marketOdds.total ?? {};
  const btts = marketOdds.btts ?? {};

  // Draw (never combined with home/away/over/under/btts)
  if (/\b(draw|empate|tie)\b/.test(s) && !/home|away|over|under|btts/.test(s)) {
    return tw.draw ?? null;
  }

  // Over / Under N
  const ou = s.match(/^(over|under|m[aá]s\s+de|mas\s+de|menos\s+de|alto|bajo)\s+\d/);
  if (ou) {
    const over = /^(over|m[aá]s|mas|alto)/.test(ou[1]);
    return over ? (tot.overPrice ?? null) : (tot.underPrice ?? null);
  }

  // BTTS yes / no
  if (/\bbtts\s+yes\b|both\s+teams?\s+to\s+score\s+yes/.test(s)) return btts.yes ?? null;
  if (/\bbtts\s+no\b|both\s+teams?\s+to\s+score\s+no/.test(s))   return btts.no ?? null;

  // Home / Away win ("Arsenal Home Win", "Home Win", "... away win")
  if (/home\s+win|local\s+win/.test(s) || (s.endsWith('home') && !s.includes('away'))) {
    return tw.home ?? null;
  }
  if (/away\s+win|visitante\s+win/.test(s) || (s.endsWith('away') && !s.includes('home'))) {
    return tw.away ?? null;
  }

  return null;
}

/** CLV = closing implied − opening implied (percentage points). */
export function computeSoccerClv(openAmerican, closeAmerican) {
  const impliedOpen  = impliedProbPct(openAmerican);
  const impliedClose = impliedProbPct(closeAmerican);
  const clv = (impliedOpen != null && impliedClose != null)
    ? Math.round((impliedClose - impliedOpen) * 10) / 10
    : null;
  return { clv, impliedOpen, impliedClose };
}

function parseOddsDetails(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function findSoccerGameForPick(pick, games) {
  const gamePkInt = pick.game_pk != null ? Number(pick.game_pk) : null;
  if (Number.isFinite(gamePkInt) && gamePkInt > 0) {
    const byId = games.find(g => Number(g.gamePk) === gamePkInt);
    if (byId) return byId;
  }
  if (!pick.matchup) return null;
  const parts = pick.matchup.split(/\s+(?:@|vs\.?|-)\s+/i);
  if (parts.length < 2) return null;
  const [tok1, tok2] = parts.map(t => t.trim().toLowerCase());
  return games.find(g => {
    const homeN = (g.teams?.home?.name ?? '').toLowerCase();
    const awayN = (g.teams?.away?.name ?? '').toLowerCase();
    const homeA = (g.teams?.home?.abbreviation ?? '').toLowerCase();
    const awayA = (g.teams?.away?.abbreviation ?? '').toLowerCase();
    const m1 = (tok1 === awayA || awayN.includes(tok1)) && (tok2 === homeA || homeN.includes(tok2));
    const m2 = (tok1 === homeA || homeN.includes(tok1)) && (tok2 === awayA || awayN.includes(tok2));
    return m1 || m2;
  }) ?? null;
}

/**
 * Finds pending soccer picks that have an opening odds snapshot (`odds_details`)
 * but no closing odds yet, and whose match starts within 30 minutes (or has
 * started), then captures the closing line and computes CLV. League-aware:
 * picks are grouped by (date, league) to minimise ESPN / Odds API calls.
 */
export async function captureSoccerClosingLines() {
  const { rows: picks } = await pool.query(`
    SELECT id, matchup, pick, game_pk, game_date::text AS game_date, league, odds_details
    FROM picks
    WHERE result = 'pending'
      AND sport = 'soccer'
      AND deleted_at IS NULL
      AND odds_details IS NOT NULL
      AND closing_odds IS NULL
  `);

  if (picks.length === 0) {
    console.log('[closing-line-soccer] No soccer picks awaiting closing-line capture.');
    return;
  }
  console.log(`[closing-line-soccer] Checking ${picks.length} soccer pick(s)...`);

  const byDateLeague = {};
  for (const pick of picks) {
    const date   = pick.game_date?.slice(0, 10) ?? null;
    const league = pick.league ?? null;
    if (!date || !league) continue;
    (byDateLeague[`${date}::${league}`] ??= { date, league, picks: [] }).picks.push(pick);
  }

  const now = Date.now();
  const THIRTY_MIN_MS = 30 * 60 * 1000;

  for (const { date, league, picks: datePicks } of Object.values(byDateLeague)) {
    let games;
    let oddsEvents = [];
    try {
      games = await getSoccerGamesForDate(league, date);
    } catch (err) {
      console.error(`[closing-line-soccer] games fetch failed (${date}/${league}): ${err.message}`);
      continue;
    }
    try {
      oddsEvents = await getSoccerGameOdds({ leagueSlug: league, date });
    } catch (err) {
      console.warn(`[closing-line-soccer] odds fetch failed (${date}/${league}): ${err.message}`);
      continue;
    }

    for (const pick of datePicks) {
      try {
        const game = findSoccerGameForPick(pick, games);
        if (!game) continue;

        // Only capture near/after kickoff (the line is "closing").
        const startMs = game.gameDate ? new Date(game.gameDate).getTime() : null;
        if (startMs && startMs - now > THIRTY_MIN_MS) continue;

        const openingOdds = parseOddsDetails(pick.odds_details);
        const openAmerican = extractSoccerPickOdds(pick.pick, openingOdds);
        if (openAmerican == null) continue; // prop / unrecognized — no 1X2 baseline

        const match = matchSoccerOddsToGame(oddsEvents, game.teams?.home?.name, game.teams?.away?.name);
        const closingOdds = match ? buildMarketOddsForGame(match) : null;
        const closeAmerican = extractSoccerPickOdds(pick.pick, closingOdds);
        if (closeAmerican == null) continue;

        const { clv, impliedOpen, impliedClose } = computeSoccerClv(openAmerican, closeAmerican);
        if (impliedClose == null) continue;

        await pool.query(`
          UPDATE picks
          SET odds_at_pick         = COALESCE(odds_at_pick, $1),
              implied_prob_at_pick = COALESCE(implied_prob_at_pick, $2),
              closing_odds         = $3,
              implied_prob_closing = $4,
              clv                  = $5
          WHERE id = $6
        `, [openAmerican, impliedOpen, closeAmerican, impliedClose, clv, pick.id]);

        console.log(
          `[closing-line-soccer] Pick #${pick.id} "${pick.pick}": ` +
          `open ${openAmerican} (${impliedOpen}%) → close ${closeAmerican} (${impliedClose}%) → ` +
          `CLV ${clv != null ? (clv >= 0 ? '+' : '') + clv : '?'}%`
        );
      } catch (err) {
        console.error(`[closing-line-soccer] Pick #${pick.id}: ${err.message}`);
      }
    }
  }

  console.log('[closing-line-soccer] Soccer closing-line capture pass complete.');
}
