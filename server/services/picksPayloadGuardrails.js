export function validatePickSavePayload(payload) {
  const { type, matchup, pick } = payload ?? {};
  if (!type || !matchup || !pick) {
    return 'type, matchup, and pick are required';
  }
  return null;
}

export function normalizePickSport(sport) {
  return String(sport ?? '').toLowerCase() === 'nba' ? 'nba' : 'mlb';
}

