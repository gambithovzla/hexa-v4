/**
 * pick-resolver.js
 * Resolves pending Oracle picks against actual MLB game results.
 *
 * Exported:
 *   resolvePendingPicks() → { resolved, wins, losses, pushes, errors[] }
 */

import pool from './db.js';
import { getTodayGames } from './mlb-api.js';

// ── MLB abbreviation → nickname (all 30 franchises) ──────────────────────────

const ABBR_TO_NICKNAME = {
  // AL East
  NYY: 'Yankees',
  BOS: 'Red Sox',
  TOR: 'Blue Jays',
  BAL: 'Orioles',
  TB:  'Rays',
  // AL Central
  CLE: 'Guardians',
  DET: 'Tigers',
  CWS: 'White Sox',
  KC:  'Royals',
  MIN: 'Twins',
  // AL West
  HOU: 'Astros',
  SEA: 'Mariners',
  TEX: 'Rangers',
  LAA: 'Angels',
  OAK: 'Athletics',
  // NL East
  ATL: 'Braves',
  NYM: 'Mets',
  PHI: 'Phillies',
  MIA: 'Marlins',
  WSH: 'Nationals',
  // NL Central
  MIL: 'Brewers',
  CHC: 'Cubs',
  STL: 'Cardinals',
  CIN: 'Reds',
  PIT: 'Pirates',
  // NL West
  LAD: 'Dodgers',
  SF:  'Giants',
  SD:  'Padres',
  COL: 'Rockies',
  ARI: 'Diamondbacks',
};

// Nickname → abbreviation (lowercase keys for case-insensitive lookup)
const NICKNAME_TO_ABBR = Object.fromEntries(
  Object.entries(ABBR_TO_NICKNAME).map(([abbr, nick]) => [nick.toLowerCase(), abbr])
);

// ── Team matching helpers ─────────────────────────────────────────────────────

/**
 * Returns true if `token` identifies the team given by (teamName, teamAbbr).
 * Accepts: abbreviation ("NYY"), full name ("New York Yankees"), nickname ("Yankees").
 */
function tokenMatchesTeam(token, teamName, teamAbbr) {
  if (!token) return false;
  const t = token.trim().toLowerCase();

  // Direct abbreviation match
  if (teamAbbr && t === teamAbbr.toLowerCase()) return true;

  // Full / partial name match (e.g. "New York Yankees" or "Yankees")
  if (teamName && teamName.toLowerCase().includes(t)) return true;

  // Nickname via reverse map  → abbreviation comparison
  const abbrFromNick = NICKNAME_TO_ABBR[t];
  if (abbrFromNick && teamAbbr && abbrFromNick === teamAbbr) return true;

  return false;
}

/**
 * Finds the game that corresponds to a matchup string.
 * Supports formats: "NYY vs BOS", "NYY @ BOS", "New York Yankees vs Boston Red Sox", etc.
 * Returns the game object or null.
 */
function findGame(matchup, games) {
  if (!matchup) return null;
  const parts = matchup.split(/\s+(?:vs\.?|@|at|-)\s+/i);
  if (parts.length < 2) return null;

  const [token1, token2] = parts;

  for (const game of games) {
    const home = game.teams?.home;
    const away = game.teams?.away;
    if (!home || !away) continue;

    // Standard: token1=away, token2=home  OR  token1=home, token2=away
    const direct   = tokenMatchesTeam(token1, away.name, away.abbreviation) &&
                     tokenMatchesTeam(token2, home.name, home.abbreviation);
    const reversed = tokenMatchesTeam(token1, home.name, home.abbreviation) &&
                     tokenMatchesTeam(token2, away.name, away.abbreviation);

    if (direct || reversed) return game;
  }
  return null;
}

// ── Pick parsing ──────────────────────────────────────────────────────────────

/**
 * Parses a pick string into structured components.
 *
 * Examples:
 *   "NYY Moneyline"       → { type: 'moneyline', team: 'NYY', line: null }
 *   "NYY -1.5 Run Line"   → { type: 'runline_fav', team: 'NYY', line: 1.5 }
 *   "BOS +1.5 Run Line"   → { type: 'runline_dog', team: 'BOS', line: 1.5 }
 *   "Over 8.5"            → { type: 'over',  team: null, line: 8.5 }
 *   "Under 8.5"           → { type: 'under', team: null, line: 8.5 }
 *
 * Returns null if the string cannot be parsed.
 */
function parsePick(pickStr) {
  if (!pickStr) return null;
  const s = pickStr.trim();

  // Over / Under
  let m = s.match(/^Over\s+(\d+\.?\d*)$/i);
  if (m) return { type: 'over', team: null, line: parseFloat(m[1]) };

  m = s.match(/^Under\s+(\d+\.?\d*)$/i);
  if (m) return { type: 'under', team: null, line: parseFloat(m[1]) };

  // TEAM Moneyline
  m = s.match(/^(.+?)\s+Moneyline$/i);
  if (m) return { type: 'moneyline', team: m[1].trim(), line: null };

  // TEAM +X.X Run Line  (underdog)
  m = s.match(/^(.+?)\s+\+(\d+\.?\d*)\s+Run\s+Line$/i);
  if (m) return { type: 'runline_dog', team: m[1].trim(), line: parseFloat(m[2]) };

  // TEAM -X.X Run Line  (favorite)
  m = s.match(/^(.+?)\s+-(\d+\.?\d*)\s+Run\s+Line$/i);
  if (m) return { type: 'runline_fav', team: m[1].trim(), line: parseFloat(m[2]) };

  return null;
}

// ── Result resolution ─────────────────────────────────────────────────────────

/**
 * Determines whether a parsed pick won, lost, or pushed given a final game.
 * Returns 'win' | 'loss' | 'push' | null (null = unable to determine).
 */
function resolvePickResult(parsed, game) {
  const home = game.teams.home;
  const away = game.teams.away;
  const homeScore = Number(home.score);
  const awayScore = Number(away.score);

  if (isNaN(homeScore) || isNaN(awayScore)) return null;

  // ── Totals bets ────────────────────────────────────────────────────────────
  if (parsed.type === 'over') {
    const total = homeScore + awayScore;
    if (total > parsed.line) return 'win';
    if (total < parsed.line) return 'loss';
    return 'push';
  }

  if (parsed.type === 'under') {
    const total = homeScore + awayScore;
    if (total < parsed.line) return 'win';
    if (total > parsed.line) return 'loss';
    return 'push';
  }

  // ── Team bets: identify which side was picked ──────────────────────────────
  const pickedHome = tokenMatchesTeam(parsed.team, home.name, home.abbreviation);
  const pickedAway = tokenMatchesTeam(parsed.team, away.name, away.abbreviation);

  if (!pickedHome && !pickedAway) return null; // team not identified

  const pickedScore = pickedHome ? homeScore : awayScore;
  const otherScore  = pickedHome ? awayScore : homeScore;
  const diff        = pickedScore - otherScore; // positive = picked team winning

  if (parsed.type === 'moneyline') {
    if (diff > 0) return 'win';
    if (diff < 0) return 'loss';
    return 'push';
  }

  if (parsed.type === 'runline_fav') {
    // -1.5 → picked team must win by 2+ (diff > 1.5)
    if (diff > parsed.line) return 'win';
    if (diff < parsed.line) return 'loss';
    return 'push';
  }

  if (parsed.type === 'runline_dog') {
    // +1.5 → picked team must not lose by more than 1.5
    // Covers if diff + line > 0
    const margin = diff + parsed.line;
    if (margin > 0) return 'win';
    if (margin < 0) return 'loss';
    return 'push';
  }

  return null;
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Fetches all pending picks, groups by date, resolves each against actual
 * game results, and writes the outcome ('win' | 'loss' | 'push') to the DB.
 *
 * @returns {Promise<{ resolved: number, wins: number, losses: number, pushes: number, errors: string[] }>}
 */
export async function resolvePendingPicks() {
  const summary = { resolved: 0, wins: 0, losses: 0, pushes: 0, errors: [] };

  // 1. Fetch all pending picks (system job — no user_id filter)
  const { rows: picks } = await pool.query(
    "SELECT id, matchup, pick, created_at FROM picks WHERE result = 'pending'"
  );

  if (picks.length === 0) {
    console.log('[pick-resolver] No pending picks found.');
    return summary;
  }

  console.log(`[pick-resolver] Found ${picks.length} pending pick(s). Starting resolution...`);

  // 2. Group picks by date (YYYY-MM-DD from created_at)
  const byDate = {};
  for (const pick of picks) {
    const date = new Date(pick.created_at).toISOString().split('T')[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(pick);
  }

  // 3. Process each date
  for (const [date, datePicks] of Object.entries(byDate)) {
    let games;
    try {
      games = await getTodayGames(date);
    } catch (err) {
      const msg = `Failed to fetch games for ${date}: ${err.message}`;
      console.error(`[pick-resolver] ${msg}`);
      summary.errors.push(msg);
      continue;
    }

    for (const pick of datePicks) {
      try {
        // a. Find the game for this matchup
        const game = findGame(pick.matchup, games);
        if (!game) {
          console.log(
            `[pick-resolver] Pick #${pick.id}: "${pick.matchup}" — no matching game found for ${date}`
          );
          continue;
        }

        // b. Skip if not final yet
        if (game.status?.simplified !== 'final') {
          console.log(
            `[pick-resolver] Pick #${pick.id}: "${pick.matchup}" — status: ${game.status?.simplified} (not final)`
          );
          continue;
        }

        // c. Parse the pick string
        const parsed = parsePick(pick.pick);
        if (!parsed) {
          const msg = `Pick #${pick.id}: unparseable pick string "${pick.pick}"`;
          console.warn(`[pick-resolver] ${msg}`);
          summary.errors.push(msg);
          continue;
        }

        // d. Determine result
        const result = resolvePickResult(parsed, game);
        if (!result) {
          const msg = `Pick #${pick.id}: could not resolve "${pick.pick}" for matchup "${pick.matchup}"`;
          console.warn(`[pick-resolver] ${msg}`);
          summary.errors.push(msg);
          continue;
        }

        // e. Persist result
        await pool.query('UPDATE picks SET result = $1 WHERE id = $2', [result, pick.id]);

        const awayScore = game.teams.away.score;
        const homeScore = game.teams.home.score;
        console.log(
          `[pick-resolver] Pick #${pick.id}: "${pick.matchup}" — pick: "${pick.pick}" — result: ${result.toUpperCase()} (score: ${awayScore}-${homeScore})`
        );

        summary.resolved++;
        if (result === 'win')  summary.wins++;
        if (result === 'loss') summary.losses++;
        if (result === 'push') summary.pushes++;

      } catch (err) {
        const msg = `Pick #${pick.id}: unexpected error — ${err.message}`;
        console.error(`[pick-resolver] ${msg}`);
        summary.errors.push(msg);
      }
    }
  }

  console.log(
    `[pick-resolver] Done — resolved: ${summary.resolved}, wins: ${summary.wins}, ` +
    `losses: ${summary.losses}, pushes: ${summary.pushes}, errors: ${summary.errors.length}`
  );
  return summary;
}
