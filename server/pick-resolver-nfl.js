/**
 * pick-resolver-nfl.js — Resolves pending NFL picks against final game scores.
 *
 * Mirrors pick-resolver-nba.js. Reuses resolvePickFromFinalState + tokenMatchesTeam
 * from the frozen pick-resolver.js (no duplication). NFL spreads/totals on whole
 * numbers PUSH frequently — resolvePickFromFinalState already returns 'push', and
 * this resolver counts it.
 *
 * Pick text formats understood (same Oracle output schema as MLB/NBA):
 *   "KC ML"            → Moneyline
 *   "KC -2.5"          → Point Spread (favorite)
 *   "BUF +3"           → Point Spread (dog; PUSH if margin lands exactly on 3)
 *   "Under 44.5"       → Total Under
 *   "Over 47.5 (-110)" → Total Over (odds stripped)
 *
 * Exported:
 *   resolveNflPendingPicks() → { resolved, wins, losses, pushes, skipped[], errors[] }
 *
 * Lookup is by the pick's own game id first (ESPN's per-event summary), because
 * a stored game_date that is not kickoff day — a chat pick saved on the day it
 * was asked, say — leaves the date slate empty and the pick pending forever.
 * The date slate is the fallback for picks with no usable game id.
 *
 * Shadow-run back-fill is intentionally omitted here (NFL shadow runs land in
 * Sprint 9.1); add it alongside nflShadowPersistence.
 */

import pool from './db.js';
import { getNflGamesForDate, getNflGameById } from './nfl-api.js';
import { resolvePickFromFinalState, tokenMatchesTeam } from './pick-resolver.js';
import { shiftDateString } from './utils/etDate.js';
import { updateShadowModelRunsForGame } from './shadow-model.js';
import { parseNflProp, getNflGameBoxscore, resolveNflPlayerProp } from './nfl-props-resolver.js';

function nflGameToResolverGame(game) {
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
 * Finds the NFL game for a pick. Primary: game_pk (== parseInt(game_id)).
 * Fallback: team abbreviation matching against the matchup string.
 */
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

async function writePickResult(pickId, result) {
  await pool.query(`UPDATE picks SET result = $1, updated_at = NOW() WHERE id = $2`, [result, pickId]);
}

/**
 * Scans all pending NFL picks, fetches final scores from ESPN, and writes
 * win/loss/push outcomes. Safe to call repeatedly — only processes
 * result='pending' AND sport='nfl'. Skips games not yet final.
 *
 * @returns {Promise<{ resolved, wins, losses, pushes, skipped, errors }>}
 */
export async function resolveNflPendingPicks() {
  const summary = { resolved: 0, wins: 0, losses: 0, pushes: 0, skipped: [], errors: [] };

  const { rows: picks } = await pool.query(
    `SELECT p.id, p.matchup, p.pick,
            COALESCE(p.game_pk, pf.game_pk) AS game_pk,
            COALESCE(p.game_date::text, pf.game_date::text) AS game_date
     FROM picks p
     LEFT JOIN LATERAL (
       SELECT game_pk, game_date FROM pick_features WHERE pick_id = p.id LIMIT 1
     ) pf ON TRUE
     WHERE p.result = 'pending' AND p.sport = 'nfl' AND p.deleted_at IS NULL`
  );

  if (picks.length === 0) {
    console.log('[pick-resolver-nfl] No pending NFL picks found.');
    return summary;
  }

  console.log(`[pick-resolver-nfl] Found ${picks.length} pending NFL pick(s).`);

  const gamesCache = new Map();
  async function getGamesCached(date) {
    if (gamesCache.has(date)) return gamesCache.get(date);
    const games = await getNflGamesForDate(date).catch((err) => {
      console.warn(`[pick-resolver-nfl] games for ${date} failed: ${err.message}`);
      return [];
    });
    gamesCache.set(date, games);
    return games;
  }

  const skip = (pick, reason) => {
    summary.skipped.push({ pickId: pick.id, matchup: pick.matchup ?? null, reason });
    console.log(`[pick-resolver-nfl] Pick #${pick.id} "${pick.matchup}" skipped: ${reason}`);
  };

  /** Event id first (date-independent), then that date's slate. */
  async function locateGame(pick) {
    const gamePkInt = pick.game_pk != null ? Number(pick.game_pk) : null;
    if (Number.isFinite(gamePkInt) && gamePkInt > 0) {
      const byId = await getNflGameById(gamePkInt);
      if (byId) return byId;
    }
    const date = pick.game_date?.slice(0, 10) ?? null;
    if (!date) return null;
    // Picks saved before game_date moved to ET carry the UTC date, which is the
    // next day for a Sunday-night or Monday-night kickoff.
    for (const candidate of [date, shiftDateString(date, -1), shiftDateString(date, 1)]) {
      if (!candidate) continue;
      const hit = findNflGameForPick(pick, await getGamesCached(candidate));
      if (hit) return hit;
    }
    return null;
  }

  for (const pick of picks) {
    const date = pick.game_date?.slice(0, 10) ?? null;
    try {
      const nflGame = await locateGame(pick);
      if (!nflGame) {
        skip(pick, date ? `no matching game (game_pk=${pick.game_pk ?? 'null'}, date=${date})` : 'no game_pk and no game_date');
        continue;
      }
      if (!isGameFinal(nflGame)) {
        skip(pick, `game not final (${nflGame.status ?? 'unknown status'})`);
        continue;
      }

      // Player props resolve against the ESPN boxscore, not the final score.
      if (parseNflProp(pick.pick)) {
        let players;
        try {
          players = await getNflGameBoxscore(parseInt(String(nflGame.game_id), 10));
        } catch (err) {
          summary.errors.push(`Pick #${pick.id}: boxscore fetch failed — ${err.message}`);
          continue;
        }
        const propRes = resolveNflPlayerProp(pick.pick, players);
        if (!propRes?.result) {
          skip(pick, `prop unresolved (${propRes?.error ?? 'no match'})`);
          continue;
        }
        await writePickResult(pick.id, propRes.result);
        summary.resolved++;
        if (propRes.result === 'win')  summary.wins++;
        if (propRes.result === 'loss') summary.losses++;
        if (propRes.result === 'push') summary.pushes++;
        console.log(
          `[pick-resolver-nfl] Pick #${pick.id} prop "${pick.pick}" → ${propRes.result.toUpperCase()} ` +
          `(${propRes.playerName} ${propRes.propType}=${propRes.actual} vs ${propRes.line})`
        );
        continue;
      }

      const { result } = resolvePickFromFinalState(pick.pick, nflGameToResolverGame(nflGame));
      if (!result) {
        skip(pick, `pick text not understood: "${pick.pick}" ` +
          `(${nflGame.away_team_abbr} ${nflGame.away_score} @ ${nflGame.home_team_abbr} ${nflGame.home_score})`);
        continue;
      }

      await writePickResult(pick.id, result);
      summary.resolved++;
      if (result === 'win')  summary.wins++;
      if (result === 'loss') summary.losses++;
      if (result === 'push') summary.pushes++;

      // Back-fill any pending NFL shadow_model_runs row for this game so the
      // admin shadow dashboard shows oracle vs shadow vs actual.
      try {
        await updateShadowModelRunsForGame({
          gamePk:     parseInt(String(nflGame.game_id), 10),
          homeTeamId: nflGame.home_team_id ?? null,
          awayTeamId: nflGame.away_team_id ?? null,
          homeAbbr:   nflGame.home_team_abbr ?? null,
          awayAbbr:   nflGame.away_team_abbr ?? null,
          homeScore:  nflGame.home_score,
          awayScore:  nflGame.away_score,
        });
      } catch (err) {
        console.warn(`[pick-resolver-nfl] shadow_model back-fill failed for game ${nflGame.game_id}: ${err.message}`);
      }

      console.log(
        `[pick-resolver-nfl] Pick #${pick.id} "${pick.pick}" → ${result.toUpperCase()} ` +
        `(${nflGame.away_team_abbr} ${nflGame.away_score} @ ${nflGame.home_team_abbr} ${nflGame.home_score})`
      );
    } catch (err) {
      const msg = `Pick #${pick.id}: ${err.message}`;
      console.error(`[pick-resolver-nfl] ${msg}`);
      summary.errors.push(msg);
    }
  }

  console.log(
    `[pick-resolver-nfl] Done. resolved=${summary.resolved} ` +
    `wins=${summary.wins} losses=${summary.losses} pushes=${summary.pushes} ` +
    `skipped=${summary.skipped.length} errors=${summary.errors.length}`
  );
  return summary;
}
