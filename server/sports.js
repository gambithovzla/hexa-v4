export const KNOWN_SPORTS = ['mlb', 'nba', 'nfl', 'soccer', 'nhl', 'tennis'];
export const ACTIVE_SPORTS = ['mlb', 'nba'];

export function isKnownSport(value) {
  return KNOWN_SPORTS.includes(String(value ?? '').toLowerCase());
}

export function normalizeKnownSport(value, fallback = 'mlb') {
  const normalized = String(value ?? '').toLowerCase();
  return isKnownSport(normalized) ? normalized : fallback;
}

export function normalizeSportFilter(value, { allowAll = false, fallback = '' } = {}) {
  const normalized = String(value ?? '').toLowerCase();
  if (allowAll && normalized === 'all') return 'all';
  return isKnownSport(normalized) ? normalized : fallback;
}
