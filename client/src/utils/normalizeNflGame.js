/**
 * normalizeNflGame.js — ESPN's NFL game shape → the MLB-compatible shape the
 * game pickers render.
 *
 * Extracted from GameSelector so the Parlay Architect can select NFL games too
 * without a second copy drifting from this one. Behaviour is unchanged.
 */

export default function normalizeNflGame(g) {
  let simplified = 'scheduled';
  const sid = g.game_status_id;
  if (sid != null) {
    if (sid === 3) simplified = 'final';
    else if (sid === 2) simplified = 'live';
  } else {
    const s = String(g.status ?? '').toLowerCase();
    if (/final/i.test(s)) simplified = 'final';
    else if (/in progress|halftime|qtr|quarter|ot|overtime|live/i.test(s)) simplified = 'live';
  }

  const homeScore = g.home_score ?? null;
  const awayScore = g.away_score ?? null;

  let displayTime = g.status ?? '';
  if (simplified === 'scheduled' && g.game_datetime) {
    try {
      displayTime = new Date(g.game_datetime).toLocaleString('en-US', {
        timeZone: 'America/Lima', weekday: 'short', hour: '2-digit', minute: '2-digit',
      });
    } catch { /* keep status text */ }
  }

  return {
    gamePk:   String(g.game_id),
    gameDate: g.game_date ? `${g.game_date}T00:00:00Z` : null,
    _displayTime: displayTime,
    // NFL lookups are week-scoped: carry the game's own week + kickoff date so
    // analysis doesn't have to guess from the (date-based) date picker.
    _week: g.week ?? null,
    _season: g.season ?? null,
    _seasonType: g.season_type ?? null,
    _gameDate: g.game_date ?? null,
    status: { simplified },
    teams: {
      away: {
        abbreviation: g.away_team_abbr ?? 'AWAY',
        name:         g.away_team_name ?? g.away_team_abbr ?? 'Away',
        id:           g.away_team_id ?? null,
      },
      home: {
        abbreviation: g.home_team_abbr ?? 'HOME',
        name:         g.home_team_name ?? g.home_team_abbr ?? 'Home',
        id:           g.home_team_id ?? null,
      },
    },
    linescore: (homeScore != null && awayScore != null) ? {
      teams: { away: { runs: awayScore }, home: { runs: homeScore } },
    } : null,
    _sport: 'nfl',
  };
}
