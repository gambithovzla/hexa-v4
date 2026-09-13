/**
 * closing-line-capture-nfl.js — closing lines + CLV for pending NFL picks.
 *
 * NOT a copy of the MLB/soccer modules, because in those sports the bet's NUMBER
 * is fixed (moneyline, ±1.5 runline, 1X2) and only the PRICE moves, so CLV is a
 * price delta. In the NFL the spread is the primary market and the line itself
 * moves: taking KC -3.5 and watching it close at KC -6.5 is a large positive CLV
 * even when the price is -110 at both ends. A price-only CLV would record that
 * as 0.0 — a number that says "no edge" about the single most informative thing
 * that happened to the bet.
 *
 * So line movement is converted into probability and added to the price term,
 * which keeps the `clv` column meaning the same thing it means for every other
 * sport: percentage points of edge captured against the close.
 *
 * The conversion treats the closing line as the market's unbiased estimate and
 * models the outcome around it — margin of victory ~ Normal(closing spread,
 * NFL_MARGIN_SD), total points ~ Normal(closing total, NFL_TOTAL_SD). The
 * probability that MY number beats that distribution, minus the 50% you would
 * get by betting the close itself, is the edge the line move handed me.
 *
 * Exported (pure, unit-tested):
 *   impliedProbPct(american)
 *   extractSignedNflPickLine(text, market)
 *   resolveNflPickSide({ pickText, market, homeAbbr, homeName, awayAbbr, awayName })
 *   lineClvPct({ market, side, openLine, closeLine })
 *   priceClvPct(openAmerican, closeAmerican)
 *   computeNflClv({ market, side, openLine, closeLine, openAmerican, closeAmerican })
 *   nflSideOdds(marketOdds, market, side) → { line, price }
 * Exported (IO):
 *   captureNflClosingLines()
 */

import pool from './db.js';
import { getNflGamesForDate } from './nfl-api.js';
import { getNflGameOdds, matchNflOddsToGame, buildMarketOddsForGame } from './nfl-odds.js';
import { tokenMatchesTeam } from './pick-resolver.js';
import { classifyNflMarket } from './services/nflLineProvenance.js';
import { normalCdf } from './services/nflPropDistributions.js';

// Empirical spread of NFL outcomes around the closing number. Margin of victory
// has sat near 13.5 points for decades; total points is tighter at ~10.5.
export const NFL_MARGIN_SD = 13.5;
export const NFL_TOTAL_SD = 10.5;

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** American odds → implied probability as a 0–100 percentage (1 decimal). */
export function impliedProbPct(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  const frac = n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  return Math.round(frac * 1000) / 10;
}

/**
 * The SIGNED line a pick claims, from the perspective of the side it names.
 * Deliberately different from extractNflPickLine() in nflLineProvenance.js,
 * which returns a magnitude: provenance only asks "is this number on the board",
 * where -3.5 and +3.5 are the same board entry. CLV asks "did the number move
 * toward me", and there the sign is the entire question — a favorite going
 * -3.5 → -6.5 gained points, an underdog going +3.5 → +6.5 lost them.
 */
export function extractSignedNflPickLine(text, market) {
  const s = String(text ?? '');
  if (market === 'total') {
    const m = s.match(/\b(?:over|under|o|u)\s*[:\s]?\s*(\d+(?:\.\d+)?)/i);
    return m ? Number(m[1]) : null;
  }
  if (market === 'spread') {
    // A price in parentheses is not the line: "KC -3.5 (-110)" is one number.
    const m = s.replace(/\([^)]*\)/g, '').match(/([+-]\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  }
  return null;
}

/**
 * Which side of the market the pick is on: 'home'|'away' for spread/moneyline,
 * 'over'|'under' for totals. Returns null when the text names neither team,
 * which is the correct outcome for a pick this module cannot score.
 */
export function resolveNflPickSide({ pickText, market, homeAbbr, homeName, awayAbbr, awayName } = {}) {
  const s = String(pickText ?? '').trim();
  if (!s) return null;

  if (market === 'total') {
    if (/\b(over|o)\b|m[aá]s\s+de|alto/i.test(s)) return 'over';
    if (/\b(under|u)\b|menos\s+de|bajo/i.test(s)) return 'under';
    return null;
  }

  if (market !== 'spread' && market !== 'moneyline') return null;

  // Team tokens are alphabetic runs; a price or a line is not a team.
  const tokens = s.replace(/\([^)]*\)/g, ' ').match(/[A-Za-zÁÉÍÓÚÑáéíóúñ.']{2,}/g) ?? [];
  for (const token of tokens) {
    if (tokenMatchesTeam(token, homeName ?? '', homeAbbr ?? '')) return 'home';
    if (tokenMatchesTeam(token, awayName ?? '', awayAbbr ?? '')) return 'away';
  }
  return null;
}

/** The line and price a marketOdds snapshot offers for one side. */
export function nflSideOdds(marketOdds, market, side) {
  if (!marketOdds || !market || !side) return { line: null, price: null };

  if (market === 'spread') {
    const sp = marketOdds.spread ?? {};
    return side === 'home'
      ? { line: sp.home ?? null, price: sp.homePrice ?? null }
      : { line: sp.away ?? null, price: sp.awayPrice ?? null };
  }
  if (market === 'total') {
    const t = marketOdds.total ?? {};
    return side === 'over'
      ? { line: t.line ?? null, price: t.overPrice ?? null }
      : { line: t.line ?? null, price: t.underPrice ?? null };
  }
  if (market === 'moneyline') {
    const ml = marketOdds.moneyline ?? {};
    return { line: null, price: (side === 'home' ? ml.home : ml.away) ?? null };
  }
  return { line: null, price: null };
}

/**
 * Percentage points of edge the LINE move handed the bettor.
 *
 * Spread: both lines are signed from the bettor's own side, so a bet at
 * openLine wins when the margin beats -openLine, while the market now centers
 * that margin at -closeLine. The gap between them, in standard deviations, is
 * simply (openLine - closeLine) / sd.
 *
 * Total: an Over wants the close above its number, an Under below it.
 *
 * Moneyline has no line, so it returns 0 and the price term carries the CLV.
 */
export function lineClvPct({ market, side, openLine, closeLine } = {}) {
  if (market === 'moneyline') return 0;
  // Number(null) is 0, so a bare Number() would read a missing line as a pick-em
  // and report a confident CLV for a pick that never had a number to compare.
  const open = numOrNull(openLine);
  const close = numOrNull(closeLine);
  if (open == null || close == null) return null;

  let z;
  if (market === 'spread') {
    z = (open - close) / NFL_MARGIN_SD;
  } else if (market === 'total') {
    if (side !== 'over' && side !== 'under') return null;
    z = (side === 'over' ? close - open : open - close) / NFL_TOTAL_SD;
  } else {
    return null;
  }

  return Math.round((normalCdf(z) - 0.5) * 1000) / 10;
}

/** Percentage points of edge from the PRICE move alone. */
export function priceClvPct(openAmerican, closeAmerican) {
  const impliedOpen = impliedProbPct(openAmerican);
  const impliedClose = impliedProbPct(closeAmerican);
  if (impliedOpen == null || impliedClose == null) return null;
  return Math.round((impliedClose - impliedOpen) * 10) / 10;
}

/**
 * Total CLV in percentage points, plus its decomposition. The two terms answer
 * different questions — "did I get a better number" and "did I get better juice
 * on it" — and a bettor who beat the number but paid more vig deserves to see
 * both, not a single figure that hides the trade.
 */
export function computeNflClv({ market, side, openLine, closeLine, openAmerican, closeAmerican } = {}) {
  const lineClv = lineClvPct({ market, side, openLine, closeLine });
  const priceClv = priceClvPct(openAmerican, closeAmerican);
  const impliedOpen = impliedProbPct(openAmerican);
  const impliedClose = impliedProbPct(closeAmerican);

  const parts = [lineClv, priceClv].filter(v => v != null);
  const clv = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) * 10) / 10 : null;

  return { clv, lineClv, priceClv, impliedOpen, impliedClose };
}

// ── IO ────────────────────────────────────────────────────────────────────────

const THIRTY_MIN_MS = 30 * 60 * 1000;

function parseOddsDetails(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

function findNflGameForPick(pick, games) {
  const gamePkInt = pick.game_pk != null ? Number(pick.game_pk) : null;
  if (Number.isFinite(gamePkInt) && gamePkInt > 0) {
    const byId = games.find(g => parseInt(String(g.game_id), 10) === gamePkInt);
    if (byId) return byId;
  }
  if (!pick.matchup) return null;
  const parts = pick.matchup.split(/\s+[@vs.]+\s+/i);
  if (parts.length < 2) return null;
  const [awayToken, homeToken] = parts.map(p => p.trim());
  return games.find(g =>
    tokenMatchesTeam(awayToken, g.away_team_name ?? '', g.away_team_abbr ?? '') &&
    tokenMatchesTeam(homeToken, g.home_team_name ?? '', g.home_team_abbr ?? '')
  ) ?? null;
}

/**
 * Captures the closing line for pending NFL picks whose kickoff is within 30
 * minutes (or past) and computes CLV. Opening odds come from the pick's own
 * `odds_details` snapshot, so nothing is needed on the pick-creation path.
 *
 * Safe to call repeatedly: only picks with no closing_odds are considered, and
 * a pick this module cannot score (a prop, an unnamed side, a market the books
 * no longer post) is skipped rather than written with a guessed number.
 */
export async function captureNflClosingLines() {
  const { rows: picks } = await pool.query(`
    SELECT id, matchup, pick, best_pick, game_pk, game_date::text AS game_date, odds_details
    FROM picks
    WHERE result = 'pending'
      AND sport = 'nfl'
      AND deleted_at IS NULL
      AND odds_details IS NOT NULL
      AND closing_odds IS NULL
  `);

  if (picks.length === 0) {
    console.log('[closing-line-nfl] No NFL picks awaiting closing-line capture.');
    return;
  }
  console.log(`[closing-line-nfl] Checking ${picks.length} NFL pick(s)...`);

  const byDate = {};
  for (const pick of picks) {
    const date = pick.game_date?.slice(0, 10);
    if (!date) continue;
    (byDate[date] ??= []).push(pick);
  }

  const now = Date.now();

  for (const [date, datePicks] of Object.entries(byDate)) {
    let games = [];
    let oddsEvents = [];
    try {
      games = await getNflGamesForDate(date);
    } catch (err) {
      console.error(`[closing-line-nfl] games fetch failed (${date}): ${err.message}`);
      continue;
    }
    try {
      oddsEvents = await getNflGameOdds({ date, seasonType: games[0]?.season_type ?? null });
    } catch (err) {
      console.warn(`[closing-line-nfl] odds fetch failed (${date}): ${err.message}`);
      continue;
    }

    for (const pick of datePicks) {
      try {
        const game = findNflGameForPick(pick, games);
        if (!game) continue;

        const startMs = game.game_datetime ? new Date(game.game_datetime).getTime() : null;
        if (startMs && startMs - now > THIRTY_MIN_MS) continue;

        const betType = parseOddsDetails(pick.best_pick)?.type ?? null;
        const market = classifyNflMarket(betType, pick.pick);
        if (!market || market === 'prop') continue; // props close on their own endpoint

        const side = resolveNflPickSide({
          pickText: pick.pick,
          market,
          homeAbbr: game.home_team_abbr,
          homeName: game.home_team_name,
          awayAbbr: game.away_team_abbr,
          awayName: game.away_team_name,
        });
        if (!side) continue;

        const openingOdds = parseOddsDetails(pick.odds_details);
        const open = nflSideOdds(openingOdds, market, side);

        const match = matchNflOddsToGame(oddsEvents, game.home_team_name, game.away_team_name);
        const closingOdds = match ? buildMarketOddsForGame(match) : null;
        const close = nflSideOdds(closingOdds, market, side);
        if (close.price == null && close.line == null) continue;

        // The pick text is the contract the user actually holds, so its line
        // beats the snapshot's whenever both exist.
        const openLine = extractSignedNflPickLine(pick.pick, market) ?? open.line;

        const { clv, lineClv, priceClv, impliedOpen, impliedClose } = computeNflClv({
          market,
          side,
          openLine,
          closeLine: close.line,
          openAmerican: open.price,
          closeAmerican: close.price,
        });
        if (clv == null) continue;

        await pool.query(`
          UPDATE picks
          SET odds_at_pick         = COALESCE(odds_at_pick, $1),
              implied_prob_at_pick = COALESCE(implied_prob_at_pick, $2),
              closing_odds         = $3,
              implied_prob_closing = $4,
              closing_line         = $5,
              clv                  = $6
          WHERE id = $7
        `, [open.price, impliedOpen, close.price, impliedClose, close.line, clv, pick.id]);

        const lineNote = market === 'moneyline'
          ? ''
          : ` | line ${openLine} → ${close.line} (${lineClv >= 0 ? '+' : ''}${lineClv}%)`;
        console.log(
          `[closing-line-nfl] Pick #${pick.id} "${pick.pick}" [${market}/${side}]: ` +
          `price ${open.price} → ${close.price} (${priceClv != null ? (priceClv >= 0 ? '+' : '') + priceClv : '?'}%)` +
          `${lineNote} → CLV ${clv >= 0 ? '+' : ''}${clv}%`
        );
      } catch (err) {
        console.error(`[closing-line-nfl] Pick #${pick.id}: ${err.message}`);
      }
    }
  }

  console.log('[closing-line-nfl] NFL closing-line capture pass complete.');
}
