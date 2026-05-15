export const ALL_SPORTS = ['mlb', 'nba', 'nfl', 'soccer', 'nhl', 'tennis'];
export const ACTIVE_SPORTS = ['mlb', 'nba'];

export const SPORT_META = {
  mlb: { shortLabel: 'MLB', displayName: 'Baseball', active: true },
  nba: { shortLabel: 'NBA', displayName: 'Basketball', active: true },
  nfl: { shortLabel: 'NFL', displayName: 'Football', active: false },
  soccer: { shortLabel: 'SOCCER', displayName: 'Soccer', active: false },
  nhl: { shortLabel: 'NHL', displayName: 'Hockey', active: false },
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
