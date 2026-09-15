/**
 * etDate.js — the calendar date a game belongs to, in US Eastern time.
 *
 * Slicing an ISO kickoff string (`2026-09-14T00:20Z`) gives the UTC date, which
 * for any night game in the Americas is the NEXT day: Sunday Night Football
 * kicks off 8:20pm ET and lands on the 14th, an NBA game at 10pm ET lands on
 * tomorrow. ESPN's own scoreboard buckets by ET, so a pick stored with the UTC
 * date looks for its game in a slate that does not contain it and stays pending
 * forever.
 *
 * Everything schedule-shaped (game_date, board dates, resolver lookups) uses ET.
 */

const ET_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * @param {string|Date|null} value  ISO timestamp or Date
 * @returns {string|null} YYYY-MM-DD in America/New_York, or null when unparseable
 */
export function toEtDateString(value) {
  if (!value) return null;
  // A bare YYYY-MM-DD is already a calendar date: converting it would parse as
  // UTC midnight and land on the previous ET day.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();

  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return ET_FORMATTER.format(d);
}

/** Today's date in ET. */
export function todayEtDateString() {
  return ET_FORMATTER.format(new Date());
}

/** `date` shifted by `days` (negative for earlier), staying a YYYY-MM-DD string. */
export function shiftDateString(date, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return null;
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
