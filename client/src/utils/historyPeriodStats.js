import { getLimaWeekStart, normalizeDateKey } from './dateKeys.js';

export function normalizePickResult(result) {
  const value = String(result ?? 'pending').toLowerCase();
  if (value === 'won') return 'win';
  if (value === 'lost') return 'loss';
  return value;
}

export function getEntryCalendarDate(entry) {
  const raw = entry?.date ?? entry?.gameDate ?? entry?.created_at ?? entry?.createdAt;
  return normalizeDateKey(raw);
}

export function computePickStats(entries) {
  const results = entries.map((e) => normalizePickResult(e?.result));
  const total = entries.length;
  const wins = results.filter((r) => r === 'win').length;
  const losses = results.filter((r) => r === 'loss').length;
  const pushes = results.filter((r) => r === 'push').length;
  const pending = results.filter((r) => r === 'pending').length;
  const resolved = wins + losses;
  const winRate = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;
  return { total, wins, losses, pushes, pending, winRate };
}

export function periodBucketKey(entry, mode) {
  const day = getEntryCalendarDate(entry);
  if (!day) return 'unknown';
  if (mode === 'day') return day;
  if (mode === 'week') return getLimaWeekStart(day);
  if (mode === 'month') return day.slice(0, 7);
  return day;
}

export function formatPeriodLabel(key, mode, lang = 'es') {
  const locale = lang === 'es' ? 'es-ES' : 'en-US';
  if (key === 'unknown') return lang === 'es' ? 'Sin fecha' : 'No date';

  if (mode === 'day') {
    try {
      return new Date(`${key}T12:00:00Z`).toLocaleDateString(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      });
    } catch {
      return key;
    }
  }

  if (mode === 'week') {
    const from = new Date(`${key}T12:00:00Z`);
    const to = new Date(`${key}T12:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 6);
    const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
    return `${from.toLocaleDateString(locale, opts)} – ${to.toLocaleDateString(locale, { ...opts, year: 'numeric' })}`;
  }

  if (mode === 'month') {
    const [y, m] = key.split('-').map(Number);
    try {
      return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
    } catch {
      return key;
    }
  }

  return key;
}

export function groupHistoryByPeriod(entries, mode, lang = 'es') {
  if (!mode || mode === 'total') return [];

  const groups = new Map();
  for (const entry of entries) {
    const key = periodBucketKey(entry, mode);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  return Array.from(groups.entries())
    .sort((a, b) => {
      if (a[0] === 'unknown') return 1;
      if (b[0] === 'unknown') return -1;
      return b[0].localeCompare(a[0]);
    })
    .map(([key, items]) => ({
      key,
      label: formatPeriodLabel(key, mode, lang),
      stats: computePickStats(items),
    }));
}
