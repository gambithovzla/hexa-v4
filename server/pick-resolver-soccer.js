/**
 * pick-resolver-soccer.js — Resolves pending soccer picks against final match scores.
 *
 * Mirrors pick-resolver-nhl.js. Reuses tokenMatchesTeam from the frozen pick-resolver.js.
 *
 * Soccer-specific resolution vs other sports:
 *   - THREE outcomes: Home Win / Draw / Away Win. The DRAW is a real outcome and
 *     NEVER a push — a "Draw" pick wins if homeScore === awayScore, loses otherwise.
 *   - BTTS (Both Teams to Score): Yes wins if both teams scored ≥ 1 goal; No wins if
 *     at least one team scored 0.
 *   - Over/Under 2.5 goals: same O/U logic as other sports.
 *   - resolvePickFromFinalState is NOT used — soccer picks have a different text schema
 *     ("Arsenal Home Win", "Draw", "Over 2.5", "BTTS Yes") that the MLB-centric parser
 *     doesn't handle. We implement a dedicated soccer resolver here.
 *   - No empty-net / OT complexity: the full-time score is the final score.
 *     (90+ min extra time / penalties produce a winner — the score reflects it.)
 *
 * Pick text formats understood (from Oracle soccer output):
 *   "<TeamName> Home Win"  or  "Home Win"  → home team wins
 *   "<TeamName> Away Win"  or  "Away Win"  → away team wins
 *   "Draw"                                → scores equal
 *   "Over 2.5"  / "Under 2.5"             → goals total
 *   "BTTS Yes"  / "BTTS No"               → both teams to score
 *
 * Exported:
 *   resolveSoccerPendingPicks() → { resolved, wins, losses, pushes, errors[] }
 */

import pool from './db.js';
import { getSoccerGamesForDate } from './soccer-api.js';
import { tokenMatchesTeam } from './pick-resolver.js';
import { parseSoccerProp, getSoccerGameBoxscore, resolveSoccerPlayerProp } from './soccer-props-resolver.js';

function isGameFinal(game) {
  return game.status === 'final';
}

/**
 * Resolve a soccer pick text against a final score.
 *
 * Returns 'win' | 'loss' | 'push' | null (null = unrecognized format).
 * Note: draws in soccer are never push — they're a win when you picked "Draw".
 */
export function resolveSoccerPick(pickText, game) {
  const s = String(pickText ?? '').trim().toLowerCase();
  const homeScore = Number(game?.teams?.home?.score ?? 0);
  const awayScore = Number(game?.teams?.away?.score ?? 0);
  const homeName  = String(game?.teams?.home?.name  ?? '');
  const homeAbbr  = String(game?.teams?.home?.abbreviation ?? '');
  const awayName  = String(game?.teams?.away?.name  ?? '');
  const awayAbbr  = String(game?.teams?.away?.abbreviation ?? '');
  const totalGoals = homeScore + awayScore;

  // ── Draw ───────────────────────────────────────────────────────────────────
  if (/\b(draw|empate|tie)\b/.test(s) && !/home|away|over|under|btts/i.test(s)) {
    return homeScore === awayScore ? 'win' : 'loss';
  }

  // ── Over / Under ───────────────────────────────────────────────────────────
  const ouMatch = s.match(/^(over|under|más\s+de|mas\s+de|menos\s+de|alto|bajo)\s+(\d+\.?\d*)/i);
  if (ouMatch) {
    const dir  = /^(over|m[aá]s|alto)/i.test(ouMatch[1]) ? 'over' : 'under';
    const line = parseFloat(ouMatch[2]);
    if (dir === 'over')  return totalGoals > line ? 'win' : totalGoals < line ? 'loss' : 'push';
    return totalGoals < line ? 'win' : totalGoals > line ? 'loss' : 'push';
  }

  // ── BTTS ───────────────────────────────────────────────────────────────────
  const bttsYes = /\bbtts\s+yes\b|\bboth\s+teams?\s+to\s+score\s+yes\b/i.test(s);
  const bttsNo  = /\bbtts\s+no\b|\bboth\s+teams?\s+to\s+score\s+no\b/i.test(s);
  if (bttsYes) return (homeScore > 0 && awayScore > 0) ? 'win' : 'loss';
  if (bttsNo)  return (homeScore === 0 || awayScore === 0) ? 'win' : 'loss';

  // ── Home Win ───────────────────────────────────────────────────────────────
  const isHomeWinPick = /home\s+win|local\s+win/i.test(s) ||
    (s.endsWith('home') && !s.includes('away'));

  if (isHomeWinPick) {
    return homeScore > awayScore ? 'win' : 'loss';
  }

  // Picks like "Arsenal Home Win" — team name followed by "home win"
  const homeWinNameMatch = s.match(/^(.+?)\s+home\s+win$/i);
  if (homeWinNameMatch) {
    const teamToken = homeWinNameMatch[1].trim();
    if (tokenMatchesTeam(teamToken, homeName, homeAbbr) || tokenMatchesTeam(teamToken, awayName, awayAbbr)) {
      return homeScore > awayScore ? 'win' : 'loss';
    }
  }

  // ── Away Win ───────────────────────────────────────────────────────────────
  const isAwayWinPick = /away\s+win|visitante\s+win/i.test(s) ||
    (s.endsWith('away') && !s.includes('home'));

  if (isAwayWinPick) {
    return awayScore > homeScore ? 'win' : 'loss';
  }

  // Picks like "Real Madrid Away Win"
  const awayWinNameMatch = s.match(/^(.+?)\s+away\s+win$/i);
  if (awayWinNameMatch) {
    const teamToken = awayWinNameMatch[1].trim();
    if (tokenMatchesTeam(teamToken, awayName, awayAbbr) || tokenMatchesTeam(teamToken, homeName, homeAbbr)) {
      return awayScore > homeScore ? 'win' : 'loss';
    }
  }

  // ── Bare team name (moneyline-style fallback): "Arsenal" wins if Arsenal won ─
  // Try home team first, then away team
  if (tokenMatchesTeam(s, homeName, homeAbbr)) {
    return homeScore > awayScore ? 'win' : homeScore < awayScore ? 'loss' : null;
  }
  if (tokenMatchesTeam(s, awayName, awayAbbr)) {
    return awayScore > homeScore ? 'win' : awayScore < homeScore ? 'loss' : null;
  }

  return null;
}

function soccerGameToShape(game) {
  return {
    teams: {
      home: { name: game.teams?.home?.name ?? '', abbreviation: game.teams?.home?.abbreviation ?? '', score: game.teams?.home?.score },
      away: { name: game.teams?.away?.name ?? '', abbreviation: game.teams?.away?.abbreviation ?? '', score: game.teams?.away?.score },
    },
  };
}

function findSoccerGameForPick(pick, games) {
  const gamePkInt = pick.game_pk != null ? Number(pick.game_pk) : null;
  if (Number.isFinite(gamePkInt) && gamePkInt > 0) {
    const byId = games.find(g => Number(g.gamePk) === gamePkInt);
    if (byId) return byId;
  }
  if (!pick.matchup) return null;
  const parts = pick.matchup.split(/\s+[@vs.]+\s+/i);
  if (parts.length < 2) return null;
  const [awayToken, homeToken] = parts.map(p => p.trim());
  const homeName = (g) => g.teams?.home?.name ?? '';
  const homeAbbr = (g) => g.teams?.home?.abbreviation ?? '';
  const awayName = (g) => g.teams?.away?.name ?? '';
  const awayAbbr = (g) => g.teams?.away?.abbreviation ?? '';
  return games.find(g =>
    tokenMatchesTeam(awayToken, awayName(g), awayAbbr(g)) &&
    tokenMatchesTeam(homeToken, homeName(g), homeAbbr(g))
  ) ?? null;
}

async function writePickResult(pickId, result) {
  await pool.query(`UPDATE picks SET result = $1, updated_at = NOW() WHERE id = $2`, [result, pickId]);
}

/**
 * Scans all pending soccer picks, fetches final scores from ESPN, and writes
 * win/loss outcomes. Safe to call repeatedly — only processes result='pending'
 * AND sport='soccer'. Skips matches not yet final. Groups by date and league.
 *
 * @returns {Promise<{ resolved, wins, losses, pushes, errors }>}
 */
export async function resolveSoccerPendingPicks() {
  const summary = { resolved: 0, wins: 0, losses: 0, pushes: 0, errors: [] };

  const { rows: picks } = await pool.query(
    `SELECT id, matchup, pick, game_pk, game_date::text AS game_date, league
     FROM picks
     WHERE result = 'pending' AND sport = 'soccer' AND deleted_at IS NULL`
  );

  if (picks.length === 0) {
    console.log('[pick-resolver-soccer] No pending soccer picks found.');
    return summary;
  }

  console.log(`[pick-resolver-soccer] Found ${picks.length} pending soccer pick(s).`);

  const byDateAndLeague = {};
  for (const pick of picks) {
    const date   = pick.game_date?.slice(0, 10) ?? null;
    const league = pick.league ?? null;
    if (!date || !league) {
      summary.errors.push(`Pick #${pick.id}: missing game_date or league`);
      continue;
    }
    const key = `${date}::${league}`;
    (byDateAndLeague[key] ??= { date, league, picks: [] }).picks.push(pick);
  }

  const gamesCache = new Map();
  async function getGamesCached(date, league) {
    const key = `${date}::${league}`;
    if (gamesCache.has(key)) return gamesCache.get(key);
    const games = await getSoccerGamesForDate(league, date);
    gamesCache.set(key, games);
    return games;
  }

  for (const { date, league, picks: datePicks } of Object.values(byDateAndLeague)) {
    let games;
    try {
      games = await getGamesCached(date, league);
    } catch (err) {
      const msg = `Failed to fetch soccer games for ${date} / ${league}: ${err.message}`;
      console.error(`[pick-resolver-soccer] ${msg}`);
      summary.errors.push(msg);
      continue;
    }

    for (const pick of datePicks) {
      try {
        const soccerGame = findSoccerGameForPick(pick, games);
        if (!soccerGame) {
          console.log(`[pick-resolver-soccer] Pick #${pick.id} "${pick.matchup}": no matching game for ${date}/${league}`);
          continue;
        }
        if (!isGameFinal(soccerGame)) {
          console.log(`[pick-resolver-soccer] Pick #${pick.id} "${pick.matchup}": game not final (status: ${soccerGame.status})`);
          continue;
        }

        // Player props resolve against the ESPN boxscore, not the final score.
        if (parseSoccerProp(pick.pick)) {
          let players;
          try {
            players = await getSoccerGameBoxscore(league, soccerGame.gameId ?? soccerGame.gamePk);
          } catch (err) {
            summary.errors.push(`Pick #${pick.id}: boxscore fetch failed — ${err.message}`);
            continue;
          }
          const propRes = resolveSoccerPlayerProp(pick.pick, players);
          if (!propRes?.result) {
            console.log(
              `[pick-resolver-soccer] Pick #${pick.id} "${pick.pick}" — prop unresolved ` +
              `(${propRes?.error ?? 'no match'})`
            );
            continue;
          }
          await writePickResult(pick.id, propRes.result);
          summary.resolved++;
          if (propRes.result === 'win')  summary.wins++;
          if (propRes.result === 'loss') summary.losses++;
          if (propRes.result === 'push') summary.pushes++;
          console.log(
            `[pick-resolver-soccer] Pick #${pick.id} prop "${pick.pick}" → ${propRes.result.toUpperCase()} ` +
            `(${propRes.playerName} ${propRes.propType}=${propRes.actual} vs ${propRes.line})`
          );
          continue;
        }

        const gameShape = soccerGameToShape(soccerGame);
        const result = resolveSoccerPick(pick.pick, gameShape);

        if (!result) {
          console.log(
            `[pick-resolver-soccer] Pick #${pick.id} "${pick.pick}" — could not resolve ` +
            `(${soccerGame.teams?.away?.abbreviation} ${soccerGame.teams?.away?.score} @ ` +
            `${soccerGame.teams?.home?.abbreviation} ${soccerGame.teams?.home?.score})`
          );
          continue;
        }

        await writePickResult(pick.id, result);
        summary.resolved++;
        if (result === 'win')  summary.wins++;
        if (result === 'loss') summary.losses++;
        if (result === 'push') summary.pushes++;

        console.log(
          `[pick-resolver-soccer] Pick #${pick.id} "${pick.pick}" → ${result.toUpperCase()} ` +
          `(${soccerGame.teams?.away?.abbreviation} ${soccerGame.teams?.away?.score} @ ` +
          `${soccerGame.teams?.home?.abbreviation} ${soccerGame.teams?.home?.score})`
        );
      } catch (err) {
        const msg = `Pick #${pick.id}: ${err.message}`;
        console.error(`[pick-resolver-soccer] ${msg}`);
        summary.errors.push(msg);
      }
    }
  }

  console.log(
    `[pick-resolver-soccer] Done. resolved=${summary.resolved} ` +
    `wins=${summary.wins} losses=${summary.losses} pushes=${summary.pushes} errors=${summary.errors.length}`
  );
  return summary;
}
