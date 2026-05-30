/**
 * NFL team logo URL resolver.
 * ESPN serves NFL logos by lowercase abbreviation (the canonical NFL id source).
 * Handles common aliases so a stale abbr still resolves.
 */
const ABBR_ALIASES = { JAC: 'jax', WAS: 'wsh', LA: 'lar', SD: 'lac', OAK: 'lv', STL: 'lar' };

export function getNflLogoUrl(teamId, abbr) {
  if (abbr) {
    const up = String(abbr).toUpperCase();
    const slug = ABBR_ALIASES[up] ?? up.toLowerCase();
    return `https://a.espncdn.com/i/teamlogos/nfl/500/${slug}.png`;
  }
  const n = Number(teamId);
  if (Number.isFinite(n) && n > 0) {
    return `https://a.espncdn.com/i/teamlogos/nfl/500/${n}.png`;
  }
  return null;
}
