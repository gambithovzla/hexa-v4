/**
 * historical-fetcher.js — Fetches completed MLB games for a target date
 *
 * Usage: node scripts/training/historical-fetcher.js 2026-04-01
 *
 * Outputs JSON to stdout with games that have final scores.
 * Does NOT call the Oracle. Does NOT write to any database.
 * This is a read-only data gathering script.
 */

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB API ${res.status}: ${url}`);
  return res.json();
}

async function getCompletedGames(date) {
  const url = `${MLB_BASE}/schedule?date=${date}&sportId=1&hydrate=team,linescore,probablePitcher,lineups`;
  const data = await fetchJSON(url);

  const games = [];
  for (const dateObj of data.dates ?? []) {
    for (const game of dateObj.games ?? []) {
      const status = game.status?.detailedState ?? '';
      if (!status.toLowerCase().includes('final')) continue;

      const home = game.teams?.home;
      const away = game.teams?.away;

      games.push({
        gamePk: game.gamePk,
        gameDate: date,
        status: 'final',
        home: {
          id: home?.team?.id,
          name: home?.team?.name,
          abbreviation: home?.team?.abbreviation,
          score: home?.score ?? 0,
          pitcher: home?.probablePitcher ? {
            id: home.probablePitcher.id,
            fullName: home.probablePitcher.fullName,
            throwingHand: home.probablePitcher.pitchHand?.code ?? null,
          } : null,
        },
        away: {
          id: away?.team?.id,
          name: away?.team?.name,
          abbreviation: away?.team?.abbreviation,
          score: away?.score ?? 0,
          pitcher: away?.probablePitcher ? {
            id: away.probablePitcher.id,
            fullName: away.probablePitcher.fullName,
            throwingHand: away.probablePitcher.pitchHand?.code ?? null,
          } : null,
        },
        venue: game.venue?.name ?? null,
        totalRuns: (home?.score ?? 0) + (away?.score ?? 0),
      });
    }
  }

  return games;
}

// Main
const targetDate = process.argv[2];
if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
  console.error('Usage: node scripts/training/historical-fetcher.js YYYY-MM-DD');
  process.exit(1);
}

try {
  const games = await getCompletedGames(targetDate);
  console.log(JSON.stringify({ date: targetDate, totalGames: games.length, games }, null, 2));
} catch (err) {
  console.error(`Error fetching games for ${targetDate}:`, err.message);
  process.exit(1);
}
