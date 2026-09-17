import { ApiError } from './blizzard.js';
import { expandEvent } from '../public/recurrence.js';

export function validateEvent(input) {
  if (!input || typeof input !== 'object') throw new ApiError('Event details required.', 400);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!title || title.length > 120 || description.length > 2000) throw new ApiError('Use a title up to 120 characters and notes up to 2000 characters.', 400);
  if (!['retail', 'forever', 'all'].includes(input.game) || !['raid', 'other'].includes(input.kind)) throw new ApiError('Invalid event game or type.', 400);
  const dates = ['start', 'end'].map(key => {
    const value = input[key];
    if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new ApiError('Event times must be UTC timestamps between 2000 and 2099.', 400);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new ApiError('Invalid event date.', 400);
    return date;
  });
  const duration = dates[1] - dates[0];
  if (duration <= 0 || duration > 7 * 86400000) throw new ApiError('End time must follow start time, with a maximum duration of seven days.', 400);
  const event = { title, description, game: input.game, kind: input.kind, start: dates[0].toISOString(), end: dates[1].toISOString() };
  if (input.recurrence != null) {
    const r = input.recurrence;
    if (r.frequency !== 'weekly' || typeof r.timeZone !== 'string' || r.timeZone.length > 100) throw new ApiError('Choose weekly recurrence and a valid timezone.', 400);
    try { new Intl.DateTimeFormat('en', { timeZone: r.timeZone }).format(); }
    catch { throw new ApiError('Invalid recurrence timezone.', 400); }
    event.recurrence = { frequency: 'weekly', timeZone: r.timeZone, until: null, excluded: [] };
  }
  return event;
}

export function removeOccurrence(event, scope, occurrence) {
  if (!event.recurrence || !['one', 'future'].includes(scope) || typeof occurrence !== 'string') throw new ApiError('Select an occurrence and deletion scope.', 400);
  const time = Date.parse(occurrence);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== occurrence) throw new ApiError('Invalid occurrence.', 400);
  const match = expandEvent(event, occurrence, new Date(time + 1).toISOString()).some(e => e.start === occurrence);
  if (!match) throw new ApiError('This occurrence does not exist or has already been removed.', 404);
  if (scope === 'future') event.recurrence.until = occurrence;
  else {
    if (event.recurrence.excluded.length >= 1000) throw new ApiError('Too many exceptions. End this series and create a new one.', 409);
    event.recurrence.excluded.push(occurrence);
  }
}
