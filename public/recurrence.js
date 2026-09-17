const DAY = 86400000, WEEK = 7 * DAY;
// Wall-clock parts represented as UTC for calendar arithmetic, not as an instant.
function wallTime(instant, formatter) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second, new Date(instant).getUTCMilliseconds());
}
function formatterFor(zone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}
function instantFor(wall, formatter) {
  // Probe both sides of a clock change; choose the first occurrence of repeated hours.
  const offsets = new Set([-2, -1, 0, 1, 2].map(d => {
    const probe = wall + d * DAY;
    return wallTime(probe, formatter) - probe;
  }));
  const matches = [...offsets].map(offset => wall - offset).filter(time => wallTime(time, formatter) === wall);
  return matches.length ? Math.min(...matches) : null;
}

export function expandEvent(event, from, to) {
  const fromTime = new Date(from).getTime(), toTime = new Date(to).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime <= fromTime || toTime - fromTime > 93 * DAY) throw new Error('Use a calendar range of up to 93 days.');
  if (!event.recurrence) return new Date(event.start) < toTime && new Date(event.end) > fromTime ? [event] : [];
  const format = formatterFor(event.recurrence.timeZone);
  const start = wallTime(event.start, format), end = wallTime(event.end, format);
  const first = Math.max(0, Math.floor((fromTime - start) / WEEK) - 2);
  const last = Math.max(first, Math.ceil((toTime - start) / WEEK) + 2);
  const occurrences = [];
  for (let n = first; n <= last; n++) {
    const wallStart = start + n * WEEK, wallEnd = end + n * WEEK;
    const occurrenceStart = n === 0 ? Date.parse(event.start) : instantFor(wallStart, format);
    const occurrenceEnd = n === 0 ? Date.parse(event.end) : instantFor(wallEnd, format);
    // Nonexistent wall-clock times on a spring-forward day are skipped.
    if (occurrenceStart === null || occurrenceEnd === null || occurrenceEnd <= occurrenceStart) continue;
    const startIso = new Date(occurrenceStart).toISOString();
    if (event.recurrence.until && startIso >= event.recurrence.until) continue;
    if (event.recurrence.excluded?.includes(startIso)) continue;
    if (occurrenceStart < toTime && occurrenceEnd > fromTime) occurrences.push({ ...event, start: startIso, end: new Date(occurrenceEnd).toISOString() });
  }
  return occurrences;
}
