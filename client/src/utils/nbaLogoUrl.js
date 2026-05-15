/**
 * NBA team logo URL resolver.
 * ESPN API uses small numeric team IDs (1–30); NBA Stats API uses 1610612xxx.
 */
export function getNbaLogoUrl(teamId, abbr) {
  const idStr = teamId == null ? '' : String(teamId);
  if (idStr.startsWith('espn:')) {
    return `https://a.espncdn.com/i/teamlogos/nba/500/${idStr.slice(5)}.png`;
  }
  const n = Number(teamId);
  if (Number.isFinite(n) && n > 0 && n < 1000) {
    return `https://a.espncdn.com/i/teamlogos/nba/500/${n}.png`;
  }
  if (Number.isFinite(n) && n >= 1000) {
    return `https://cdn.nba.com/logos/nba/${n}/primary/L/logo.svg`;
  }
  if (abbr) {
    return `https://a.espncdn.com/i/teamlogos/nba/500/${String(abbr).toLowerCase()}.png`;
  }
  return null;
}
