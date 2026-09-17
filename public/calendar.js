import { browserZone, localInput, localToUtc, localDay, overlapsDay, eventTime } from './calendar-time.js';

export async function renderCalendar({ view, api, owner, game, esc, isCurrent, notice }) {
  const events = await api(`/api/events?game=${game}`);
  if (!isCurrent()) return;
  let month = new Date(); month.setDate(1); month.setHours(12, 0, 0, 0);
  let selected = localDay(new Date()), editing = null;
  const zone = browserZone();
  function draw() {
    const year = month.getFullYear(), m = month.getMonth();
    const offset = (new Date(year, m, 1).getDay() + 6) % 7;
    const days = new Date(year, m + 1, 0).getDate();
    const cells = Array.from({ length: offset }, () => '<span class="calendar-blank" aria-hidden="true"></span>');
    for (let day = 1; day <= days; day++) {
      const date = localDay(new Date(year, m, day, 12));
      const count = events.filter(e => overlapsDay(e, date)).length;
      cells.push(`<button class="calendar-day ${date === selected ? 'selected' : ''}" data-day="${date}" aria-pressed="${date === selected}" ${date === localDay(new Date()) ? 'aria-current="date"' : ''} aria-label="${date}, ${count} events"><span>${day}</span>${count ? `<small>${count} <span class="event-word">event${count === 1 ? '' : 's'}</span></small>` : ''}</button>`);
    }
    const dayEvents = events.filter(e => overlapsDay(e, selected));
    const cards = dayEvents.map(e => `<article class="event-card"><div class="actions"><span class="badge ${e.kind === 'raid' ? 'raid-badge' : ''}">${e.kind === 'raid' ? 'Raid' : 'Other event'}</span><span class="subtle">${e.game === 'all' ? 'Both games' : esc(e.game)}</span></div><h3>${esc(e.title)}</h3><p><time datetime="${esc(e.start)}">${esc(eventTime(e.start))}</time><br>to <time datetime="${esc(e.end)}">${esc(eventTime(e.end))}</time></p>${e.description ? `<p class="event-notes">${esc(e.description)}</p>` : ''}${owner ? `<div class="actions"><button data-edit="${e.id}">Edit</button><button data-delete="${e.id}">Delete event</button></div>` : ''}</article>`).join('');
    view.innerHTML = `<a class="back" href="/">← Guild roster</a><div class="hero"><div><p class="eyebrow">${esc(game.toUpperCase())} / GUILD EVENTS</p><h1>Guild calendar</h1><p>Raid nights and everything in between.</p></div></div><div class="note">All dates and times are shown in your browser’s timezone: <strong>${esc(zone)}</strong>.</div><div class="calendar-layout"><section class="panel panel-content"><div class="calendar-heading"><button id="month-prev" aria-label="Previous month">←</button><h2>${esc(month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h2><button id="month-next" aria-label="Next month">→</button></div><button id="calendar-today">Today</button><div class="calendar-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<span class="weekday">${d}</span>`).join('')}${cells.join('')}</div></section><section class="panel panel-content"><h2>${esc(new Date(selected + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</h2>${cards || '<p>No events scheduled for this day.</p>'}</section></div>${owner ? `<section class="panel panel-content event-editor"><h2>${editing ? 'Edit event' : 'Schedule an event'}</h2><p class="subtle">Enter times in ${esc(zone)}. Everyone will see the equivalent time in their own timezone.</p><form id="event-form"><div class="fields"><label>Title<input name="title" maxlength="120" required></label><label>Type<select name="kind"><option value="raid">Raid</option><option value="other">Other event</option></select></label><label>Game<select name="game"><option value="retail">Retail</option><option value="forever">Forever</option><option value="all">Both games</option></select></label><label>Start (your local time)<input name="start" type="datetime-local" min="2000-01-01T00:00" max="2099-12-31T23:59" required></label><label>End (your local time)<input name="end" type="datetime-local" min="2000-01-01T00:00" max="2099-12-31T23:59" required></label></div><p id="time-preview" class="subtle" aria-live="polite"></p><label>Notes<textarea name="description" maxlength="2000" placeholder="Meeting point, difficulty, requirements…"></textarea></label><p id="event-error" role="alert"></p><div class="actions"><button class="primary">${editing ? 'Save changes' : 'Create event'}</button>${editing ? '<button id="cancel-edit" type="button">Cancel edit</button>' : ''}</div></form></section>` : ''}`;
    view.querySelector('#month-prev').onclick = () => { month.setMonth(m - 1); selected = localDay(month); editing = null; draw(); };
    view.querySelector('#month-next').onclick = () => { month.setMonth(m + 1); selected = localDay(month); editing = null; draw(); };
    view.querySelector('#calendar-today').onclick = () => { month = new Date(); selected = localDay(month); month.setDate(1); editing = null; draw(); };
    for (const button of view.querySelectorAll('[data-day]')) button.onclick = () => { selected = button.dataset.day; editing = null; draw(); };
    for (const button of view.querySelectorAll('[data-edit]')) button.onclick = () => { editing = events.find(e => e.id === button.dataset.edit); draw(); view.querySelector('#event-form input').focus(); };
    for (const button of view.querySelectorAll('[data-delete]')) button.onclick = async () => {
      if (!confirm('Delete this event from the guild calendar?')) return;
      button.disabled = true;
      try { await api(`/api/owner/events/${button.dataset.delete}`, 'DELETE'); if (!isCurrent()) return; events.splice(events.findIndex(e => e.id === button.dataset.delete), 1); editing = null; draw(); notice('Event deleted.'); }
      catch (error) { notice(error.message); button.disabled = false; }
    };
    const form = view.querySelector('#event-form');
    if (!form) return;
    const defaults = editing || { game, kind: 'raid', title: '', description: '' };
    for (const key of ['title', 'description', 'game', 'kind']) form.elements[key].value = defaults[key];
    form.elements.start.value = editing ? localInput(editing.start) : selected + 'T20:00';
    form.elements.end.value = editing ? localInput(editing.end) : selected + 'T23:00';
    const preview = () => {
      try { view.querySelector('#time-preview').textContent = `${eventTime(localToUtc(form.elements.start.value))} → ${eventTime(localToUtc(form.elements.end.value))}. When clocks go back, a repeated hour uses its first occurrence.`; }
      catch (error) { view.querySelector('#time-preview').textContent = error.message; }
    };
    form.elements.start.oninput = preview; form.elements.end.oninput = preview; preview();
    view.querySelector('#cancel-edit')?.addEventListener('click', () => { editing = null; draw(); });
    form.onsubmit = async event => {
      event.preventDefault(); const button = form.querySelector('button[type="submit"],button.primary'); button.disabled = true;
      try {
        const input = Object.fromEntries(new FormData(form));
        // Preserve an unedited instant in a repeated DST hour.
        for (const key of ['start', 'end']) input[key] = editing && input[key] === localInput(editing[key]) ? editing[key] : localToUtc(input[key]);
        if (new Date(input.end) <= new Date(input.start)) throw new Error('End time must be after start time.');
        const id = editing?.id;
        const saved = await api(id ? `/api/owner/events/${id}` : '/api/owner/events', id ? 'PATCH' : 'POST', input);
        if (!isCurrent()) return;
        if (id) events[events.findIndex(e => e.id === id)] = { ...input, id }; else events.push(saved);
        events.sort((a,b) => a.start.localeCompare(b.start));
        selected = localDay(input.start); month = new Date(input.start); month.setDate(1);
        editing = null;
        // Remove events moved into the other game's calendar from this view.
        for (let i = events.length - 1; i >= 0; i--) if (![game, 'all'].includes(events[i].game)) events.splice(i, 1);
        draw(); notice('Event saved. Times are converted automatically for each visitor.');
      } catch (error) { const target = form.querySelector('#event-error'); if (target) target.textContent = error.message; button.disabled = false; }
    };
  }
  draw();
}
