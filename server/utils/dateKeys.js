/**
 * Calendar date helpers — Lima (America/Lima) for user-facing buckets.
 */

export function getLimaDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function normalizeDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) return getLimaDateString(value);
  const s = String(value).trim();
  const plain = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (plain) return plain[1];
  const isoPrefix = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoPrefix) return getLimaDateString(s);
  const embedded = s.match(/(\d{4}-\d{2}-\d{2})/);
  return embedded ? embedded[1] : null;
}

/**
 * Resolve the calendar date for a game row (picks / pick_features / dataset).
 * Prefers MLB officialDate; ISO gameDate is converted via Lima, not UTC slice.
 */
export function formatGameTimeLima(value, { hour12 = true, label = true } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  }).format(date);
  return label ? `${time} LIM` : time;
}

export function resolveGameCalendarDate(gameData, fallbackDate = null) {
  const official = normalizeDateKey(gameData?.officialDate);
  if (official) return official;

  const isoSource = gameData?.gameDate ?? gameData?.game_date;
  if (isoSource) {
    const lima = getLimaDateString(isoSource);
    if (lima) return lima;
    return normalizeDateKey(isoSource);
  }

  return normalizeDateKey(fallbackDate);
}
