/**
 * pick-resolver-nhl.js — Resolves pending NHL picks against final game scores.
 *
 * Mirrors pick-resolver-nfl.js. Reuses resolvePickFromFinalState + tokenMatchesTeam
 * from the frozen pick-resolver.js (no duplication). The final NHL score already
 * reflects overtime and shootout outcomes (the winner gets credited the extra
 * goal in ESPN's final), so moneyline, the ±1.5 puck line, and the total all
 * resolve off the final scores the same way the MLB/NFL resolvers do.
 *
 * Pick text formats understood (same Oracle output schema as MLB/NBA/NFL):
 *   "TOR ML"           → Moneyline
 *   "COL -1.5"         → Puck Line (favorite must win by 2+)
 *   "MTL +1.5"         → Puck Line (dog; covers on any 1-goal loss or win)
 *   "Under 6.5"        → Total Under
 *   "Over 6 (-110)"    → Total Over (odds stripped)
 *
 * Exported:
 *   resolveNhlPendingPicks() → { resolved, wins, losses, pushes, errors[] }
 */

import pool from './db.js';
import { getNhlGamesForDate } from './nhl-api.js';
import { resolvePickFromFinalState, tokenMatchesTeam } from './pick-resolver.js';
import { updateShadowModelRunsForGame } from './shadow-model.js';

function nhlGameToResolverGame(game) {
  return {
    teams: {
      home: { name: game.home_team_name ?? '', abbreviation: game.home_team_abbr ?? '', score: game.home_score },
      away: { name: game.away_team_name ?? '', abbreviation: game.away_team_abbr ?? '', score: game.away_score },
    },
  };
}

function isGameFinal(game) {
  if (game.home_score == null || game.away_score == null) return false;
  return game.game_status_id === 3 || /final/i.test(String(game.status ?? ''));
}

/**
 * Finds the NHL game for a pick. Primary: game_pk (== parseInt(game_id)).
 * Fallback: team abbreviation matching against the matchup string.
 */
function findNhlGameForPick(pick, games) {
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

async function writePickResult(pickId, result) {
  await pool.query(`UPDATE picks SET result = $1, updated_at = NOW() WHERE id = $2`, [result, pickId]);
}

/**
 * Scans all pending NHL picks, fetches final scores from ESPN, and writes
 * win/loss/push outcomes. Safe to call repeatedly — only processes
 * result='pending' AND sport='nhl'. Skips games not yet final.
 *
 * @returns {Promise<{ resolved, wins, losses, pushes, errors }>}
 */
export async function resolveNhlPendingPicks() {
  const summary = { resolved: 0, wins: 0, losses: 0, pushes: 0, errors: [] };

  const { rows: picks } = await pool.query(
    `SELECT id, matchup, pick, game_pk, game_date::text AS game_date
     FROM picks
     WHERE result = 'pending' AND sport = 'nhl' AND deleted_at IS NULL`
  );

  if (picks.length === 0) {
    console.log('[pick-resolver-nhl] No pending NHL picks found.');
    return summary;
  }

  console.log(`[pick-resolver-nhl] Found ${picks.length} pending NHL pick(s).`);

  const byDate = {};
  for (const pick of picks) {
    const date = pick.game_date?.slice(0, 10) ?? null;
    if (!date) {
      summary.errors.push(`Pick #${pick.id}: missing game_date`);
      continue;
    }
    (byDate[date] ??= []).push(pick);
  }

  const gamesCache = new Map();
  async function getGamesCached(date) {
    if (gamesCache.has(date)) return gamesCache.get(date);
    const games = await getNhlGamesForDate(date);
    gamesCache.set(date, games);
    return games;
  }

  for (const [date, datePicks] of Object.entries(byDate)) {
    let games;
    try {
      games = await getGamesCached(date);
    } catch (err) {
      const msg = `Failed to fetch NHL games for ${date}: ${err.message}`;
      console.error(`[pick-resolver-nhl] ${msg}`);
      summary.errors.push(msg);
      continue;
    }

    for (const pick of datePicks) {
      try {
        const nhlGame = findNhlGameForPick(pick, games);
        if (!nhlGame) {
          console.log(`[pick-resolver-nhl] Pick #${pick.id} "${pick.matchup}": no matching game for ${date}`);
          continue;
        }
        if (!isGameFinal(nhlGame)) {
          console.log(`[pick-resolver-nhl] Pick #${pick.id} "${pick.matchup}": game not final (status: ${nhlGame.status})`);
          continue;
        }

        const { result } = resolvePickFromFinalState(pick.pick, nhlGameToResolverGame(nhlGame));
        if (!result) {
          console.log(
            `[pick-resolver-nhl] Pick #${pick.id} "${pick.pick}" — could not resolve ` +
            `(${nhlGame.away_team_abbr} ${nhlGame.away_score} @ ${nhlGame.home_team_abbr} ${nhlGame.home_score})`
          );
          continue;
        }

        await writePickResult(pick.id, result);
        summary.resolved++;
        if (result === 'win')  summary.wins++;
        if (result === 'loss') summary.losses++;
        if (result === 'push') summary.pushes++;

        // Back-fill any pending NHL shadow_model_runs row for this game so the
        // admin shadow dashboard shows oracle vs shadow vs actual.
        try {
          await updateShadowModelRunsForGame({
            gamePk:     parseInt(String(nhlGame.game_id), 10),
            homeTeamId: nhlGame.home_team_id ?? null,
            awayTeamId: nhlGame.away_team_id ?? null,
            homeAbbr:   nhlGame.home_team_abbr ?? null,
            awayAbbr:   nhlGame.away_team_abbr ?? null,
            homeScore:  nhlGame.home_score,
            awayScore:  nhlGame.away_score,
          });
        } catch (err) {
          console.warn(`[pick-resolver-nhl] shadow_model back-fill failed for game ${nhlGame.game_id}: ${err.message}`);
        }

        console.log(
          `[pick-resolver-nhl] Pick #${pick.id} "${pick.pick}" → ${result.toUpperCase()} ` +
          `(${nhlGame.away_team_abbr} ${nhlGame.away_score} @ ${nhlGame.home_team_abbr} ${nhlGame.home_score})`
        );
      } catch (err) {
        const msg = `Pick #${pick.id}: ${err.message}`;
        console.error(`[pick-resolver-nhl] ${msg}`);
        summary.errors.push(msg);
      }
    }
  }

  console.log(
    `[pick-resolver-nhl] Done. resolved=${summary.resolved} ` +
    `wins=${summary.wins} losses=${summary.losses} pushes=${summary.pushes} errors=${summary.errors.length}`
  );
  return summary;
}
