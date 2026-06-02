/**
 * Tennis player headshot URL resolver.
 * ESPN serves player headshots by numeric athlete id (from the scoreboard API,
 * g.players.a.id / g.players.b.id). When the id is null (unseeded/qualifier),
 * returns null and TeamLogo renders nothing (the name still shows).
 */
export function getTennisLogoUrl(athleteId) {
  const n = Number(athleteId);
  if (Number.isFinite(n) && n > 0) {
    return `https://a.espncdn.com/i/headshots/tennis/players/full/${n}.png`;
  }
  return null;
}
