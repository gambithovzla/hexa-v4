/**
 * pick-resolver-nba.js — Resolves pending NBA picks against final game scores.
 *
 * Mirrors pick-resolver.js for MLB but uses the NBA Stats API (scoreboardv2)
 * to fetch final scores. Shares parsePick / resolvePickFromFinalState logic
 * by importing from pick-resolver.js rather than duplicating it.
 *
 * Pick text formats understood (same as MLB Oracle output):
 *   "DET ML"           → Moneyline
 *   "DET ML (Away)"    → Moneyline (trailing parens stripped)
 *   "CLE -4.5"         → Point Spread
 *   "DET +6.5"         → Point Spread (underdog)
 *   "Under 210.5"      → Total Under
 *   "Over 224.5 (-110)"→ Total Over (odds stripped)
 *
 * Exported:
 *   resolveNbaPendingPicks() → { resolved, wins, losses, pushes, errors[] }
 */

import pool from './db.js';
import { getNbaGamesForDate } from './nba-api.js';
import { resolvePickFromFinalState, tokenMatchesTeam } from './pick-resolver.js';

// ── NBA game → resolver-compatible game object ────────────────────────────────

/**
 * Converts an NBA game row (from getNbaGamesForDate) into the shape that
 * resolvePickFromFinalState expects — same as the MLB resolver's game objects.
 */
function nbaGameToResolverGame(game) {
  return {
    teams: {
      home: {
        name:         game.home_team_name  ?? '',
        abbreviation: game.home_team_abbr  ?? '',
        score:        game.home_score,
      },
      away: {
        name:         game.away_team_name  ?? '',
        abbreviation: game.away_team_abbr  ?? '',
        score:        game.away_score,
      },
    },
  };
}

function isGameFinal(game) {
  if (game.home_score == null || game.away_score == null) return false;
  return /final/i.test(String(game.status ?? ''));
}

// ── Game matching ─────────────────────────────────────────────────────────────

/**
 * Finds the NBA game for a pick.
 * Primary: match by game_pk (stored as parseInt(nba_game_id), e.g. 42500206).
 * Fallback: team abbreviation matching against the matchup string.
 */
function findNbaGameForPick(pick, games) {
  const gamePkInt = pick.game_pk != null ? Number(pick.game_pk) : null;

  if (Number.isFinite(gamePkInt) && gamePkInt > 0) {
    const byId = games.find(g => parseInt(String(g.game_id), 10) === gamePkInt);
    if (byId) return byId;
  }

  // Fallback: match home/away abbreviations from matchup string ("DET @ CLE")
  if (!pick.matchup) return null;
  const parts = pick.matchup.split(/\s+[@vs.]+\s+/i);
  if (parts.length < 2) return null;
  const [awayToken, homeToken] = parts.map(p => p.trim());

  return games.find(g =>
    tokenMatchesTeam(awayToken, g.away_team_name ?? '', g.away_team_abbr ?? '') &&
    tokenMatchesTeam(homeToken, g.home_team_name ?? '', g.home_team_abbr ?? '')
  ) ?? null;
}

// ── DB update ─────────────────────────────────────────────────────────────────

async function writePickResult(pickId, result) {
  await pool.query(
    `UPDATE picks SET result = $1, updated_at = NOW() WHERE id = $2`,
    [result, pickId]
  );
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Scans all pending NBA picks, fetches final scores from the NBA Stats API,
 * and writes win/loss/push outcomes to the picks table.
 *
 * Safe to call repeatedly — only processes picks where result='pending' and
 * sport='nba'. Skips picks whose game has not yet finished.
 *
 * @returns {Promise<{ resolved: number, wins: number, losses: number, pushes: number, errors: string[] }>}
 */
export async function resolveNbaPendingPicks() {
  const summary = { resolved: 0, wins: 0, losses: 0, pushes: 0, errors: [] };

  const { rows: picks } = await pool.query(
    `SELECT id, matchup, pick, game_pk, game_date::text AS game_date
     FROM picks
     WHERE result = 'pending' AND sport = 'nba' AND deleted_at IS NULL`
  );

  if (picks.length === 0) {
    console.log('[pick-resolver-nba] No pending NBA picks found.');
    return summary;
  }

  console.log(`[pick-resolver-nba] Found ${picks.length} pending NBA pick(s).`);

  // Group by game_date
  const byDate = {};
  for (const pick of picks) {
    const date = pick.game_date?.slice(0, 10) ?? null;
    if (!date) {
      summary.errors.push(`Pick #${pick.id}: missing game_date`);
      continue;
    }
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(pick);
  }

  const gamesCache = new Map();

  async function getNbaGamesCached(date) {
    if (gamesCache.has(date)) return gamesCache.get(date);
    const games = await getNbaGamesForDate(date);
    gamesCache.set(date, games);
    return games;
  }

  for (const [date, datePicks] of Object.entries(byDate)) {
    let games;
    try {
      games = await getNbaGamesCached(date);
    } catch (err) {
      const msg = `Failed to fetch NBA games for ${date}: ${err.message}`;
      console.error(`[pick-resolver-nba] ${msg}`);
      summary.errors.push(msg);
      continue;
    }

    for (const pick of datePicks) {
      try {
        const nbaGame = findNbaGameForPick(pick, games);

        if (!nbaGame) {
          console.log(`[pick-resolver-nba] Pick #${pick.id} "${pick.matchup}": no matching game found for ${date}`);
          continue;
        }

        if (!isGameFinal(nbaGame)) {
          console.log(`[pick-resolver-nba] Pick #${pick.id} "${pick.matchup}": game not final yet (status: ${nbaGame.status})`);
          continue;
        }

        const gameObj = nbaGameToResolverGame(nbaGame);
        const { result } = resolvePickFromFinalState(pick.pick, gameObj);

        if (!result) {
          console.log(
            `[pick-resolver-nba] Pick #${pick.id} "${pick.pick}" — could not resolve ` +
            `(${nbaGame.away_team_abbr} ${nbaGame.away_score} @ ${nbaGame.home_team_abbr} ${nbaGame.home_score})`
          );
          continue;
        }

        await writePickResult(pick.id, result);
        summary.resolved++;
        if (result === 'win')  summary.wins++;
        if (result === 'loss') summary.losses++;
        if (result === 'push') summary.pushes++;

        console.log(
          `[pick-resolver-nba] Pick #${pick.id} "${pick.pick}" → ${result.toUpperCase()} ` +
          `(${nbaGame.away_team_abbr} ${nbaGame.away_score} @ ${nbaGame.home_team_abbr} ${nbaGame.home_score})`
        );
      } catch (err) {
        const msg = `Pick #${pick.id}: ${err.message}`;
        console.error(`[pick-resolver-nba] ${msg}`);
        summary.errors.push(msg);
      }
    }
  }

  console.log(
    `[pick-resolver-nba] Done. resolved=${summary.resolved} ` +
    `wins=${summary.wins} losses=${summary.losses} pushes=${summary.pushes} ` +
    `errors=${summary.errors.length}`
  );
  return summary;
}
