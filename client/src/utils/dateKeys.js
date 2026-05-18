const LIMA_TZ = 'America/Lima';

export function getLimaDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LIMA_TZ,
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

export function getWeekStartFromDateKey(dateKey) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function getLimaWeekStart(value = new Date()) {
  const dateKey = normalizeDateKey(value) ?? getLimaDateString(value);
  if (!dateKey) return getWeekStartFromDateKey(getLimaDateString(new Date()));
  return getWeekStartFromDateKey(dateKey);
}

export function formatDateKeyShort(dateKey, locale = 'en-US') {
  const key = normalizeDateKey(dateKey);
  if (!key) return '';
  const d = new Date(`${key}T12:00:00Z`);
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatGameTimeLima(value, { hour12 = true, label = true } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: LIMA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  }).format(date);
  return label ? `${time} LIM` : time;
}
