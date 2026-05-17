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
