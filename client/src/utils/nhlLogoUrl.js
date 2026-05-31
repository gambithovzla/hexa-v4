/**
 * NHL team logo URL resolver.
 * ESPN serves NHL logos by lowercase abbreviation (the canonical NHL id source
 * we use). Handles common aliases so a stale abbr still resolves.
 */
const ABBR_ALIASES = {
  LAK: 'la', SJS: 'sj', TBL: 'tb', NJD: 'nj', WAS: 'wsh', MON: 'mtl',
  VEG: 'vgk', LV: 'vgk', CLS: 'cbj', CLB: 'cbj',
  ARI: 'utah', ARZ: 'utah', PHX: 'utah', UTA: 'utah',
};

export function getNhlLogoUrl(teamId, abbr) {
  if (abbr) {
    const up = String(abbr).toUpperCase();
    const slug = ABBR_ALIASES[up] ?? up.toLowerCase();
    return `https://a.espncdn.com/i/teamlogos/nhl/500/${slug}.png`;
  }
  const n = Number(teamId);
  if (Number.isFinite(n) && n > 0) {
    return `https://a.espncdn.com/i/teamlogos/nhl/500/${n}.png`;
  }
  return null;
}
