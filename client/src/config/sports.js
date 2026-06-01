export const ALL_SPORTS = ['mlb', 'nba', 'nfl', 'nhl', 'soccer', 'tennis'];
export const ACTIVE_SPORTS = ['mlb', 'nba', 'nfl', 'nhl', 'soccer'];

export const SPORT_META = {
  mlb: { shortLabel: 'MLB', displayName: 'Baseball', active: true },
  nba: { shortLabel: 'NBA', displayName: 'Basketball', active: true },
  nfl: { shortLabel: 'NFL', displayName: 'Football', active: true },
  nhl: { shortLabel: 'NHL', displayName: 'Hockey', active: true },
  soccer: { shortLabel: 'SOC', displayName: 'Soccer', active: true },
  tennis: { shortLabel: 'TENNIS', displayName: 'Tennis', active: false },
};

export function isKnownSport(value) {
  return ALL_SPORTS.includes(String(value ?? '').toLowerCase());
}

export function normalizeSport(value, fallback = 'mlb') {
  const normalized = String(value ?? '').toLowerCase();
  return isKnownSport(normalized) ? normalized : fallback;
}

export function normalizeSportFilter(value, { allowAll = true, fallback = 'all' } = {}) {
  const normalized = String(value ?? '').toLowerCase();
  if (allowAll && normalized === 'all') return 'all';
  if (isKnownSport(normalized)) return normalized;
  return fallback;
}

export function getActiveSportOptions() {
  return ACTIVE_SPORTS.map((sport) => ({ sport, ...SPORT_META[sport] }));
}
