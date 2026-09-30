/** Read-only, sanitized live probe. Never prints credentials or touches the DB. */
import { getNflGamesForWeek } from '../nfl-api.js';
import { getOddsApiIoNflBoard } from '../services/nflBet365OddsApiIo.js';

if (!process.env.ODDS_API_IO_KEY) {
  console.log(JSON.stringify({ status: 'missing_ODDS_API_IO_KEY',
    availableOddsVariableNames: Object.keys(process.env).filter(name =>
      /ODDS|API_IO/i.test(name)).sort() }));
  process.exitCode = 2;
} else {
  try {
    const games = await getNflGamesForWeek({});
    const next = games.filter(game => Date.parse(game.game_datetime) > Date.now())
      .sort((a, b) => Date.parse(a.game_datetime) - Date.parse(b.game_datetime));
    if (!next.length) {
      console.log(JSON.stringify({ status: 'no_upcoming_nfl_games', scheduleCount: games.length }));
    } else {
      const results = [];
      for (const game of next.slice(0, 3)) {
        const board = await getOddsApiIoNflBoard(game);
        const markets = Object.fromEntries(['moneyline', 'spread', 'total'].map(market =>
          [market, board.quotes.filter(quote => quote.market === market).length]));
        results.push({ gameId: game.game_id, home: game.home_team_name,
          away: game.away_team_name, kickoffAt: game.game_datetime,
          status: board.status, eventId: board.eventId ?? null,
          fetchedAt: board.fetchedAt ?? null, quoteCounts: markets,
          sample: board.quotes.slice(0, 3).map(({ market, side, line, decimalOdds,
            providerMarketUpdatedAt }) => ({ market, side, line, decimalOdds,
              providerMarketUpdatedAt })) });
        if (board.status === 'ok') break;
      }
      console.log(JSON.stringify({ status: 'probed', results }, null, 2));
    }
  } catch (error) {
    console.error(JSON.stringify({ status: 'probe_failed', message: error.message }));
    process.exitCode = 1;
  }
}
