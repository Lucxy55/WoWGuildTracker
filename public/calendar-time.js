export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time';
export function localInput(instant) {
  const date = new Date(instant);
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function localToUtc(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a valid local date and time.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || localInput(date) !== value) throw new Error('That local time does not exist, possibly because clocks move forward. Choose another time.');
  return date.toISOString();
}
export const localDay = instant => localInput(instant).slice(0, 10);
export function overlapsDay(event, day) {
  const start = new Date(`${day}T00:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return new Date(event.start) < end && new Date(event.end) > start;
}
export function eventTime(instant) {
  return new Date(instant).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}
