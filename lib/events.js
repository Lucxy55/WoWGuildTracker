import { ApiError } from './blizzard.js';

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
  return { title, description, game: input.game, kind: input.kind, start: dates[0].toISOString(), end: dates[1].toISOString() };
}
