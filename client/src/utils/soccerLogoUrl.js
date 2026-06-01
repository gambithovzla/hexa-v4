/**
 * soccerLogoUrl.js — ESPN soccer team logo URLs by numeric team ID.
 *
 * ESPN pattern: https://a.espncdn.com/i/teamlogos/soccer/{size}/h/{teamId}.png
 * The team ID comes from the ESPN scoreboard API (g.teams.home.id / g.teams.away.id).
 * When the ID is null (unseeded club), returns null and TeamLogo renders nothing.
 */
export function getSoccerLogoUrl(teamId, abbr, size = 500) {
  const n = Number(teamId);
  if (Number.isFinite(n) && n > 0) {
    return `https://a.espncdn.com/i/teamlogos/soccer/${size}/h/${n}.png`;
  }
  return null;
}
