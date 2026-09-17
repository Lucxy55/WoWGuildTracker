import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server.js';
import { validateEvent } from '../lib/events.js';

const sample = { title: 'Guild raid', description: 'Meet at the entrance', game: 'retail', kind: 'raid', start: '2026-09-17T19:00:00.000Z', end: '2026-09-17T22:00:00.000Z' };
test('event validation rejects invalid, timezone-less and reversed dates', () => {
  assert.deepEqual(validateEvent(sample), sample);
  for (const changes of [{ start: '2026-09-17T19:00' }, { start: '2026-02-30T19:00:00.000Z' }, { end: sample.start }, { end: '2026-10-17T22:00:00.000Z' }, { game: 'unknown' }, { title: '' }, { kind: 'unknown' }]) {
    assert.throws(() => validateEvent({ ...sample, ...changes }));
  }
});

test('calendar owner authorization, game filtering, editing, persistence and legacy store upgrade', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'guild-calendar-'));
  await writeFile(join(dir, 'tracker.json'), JSON.stringify({ characters: [] }));
  const secret = 'test-calendar-secret-over-thirty-two-characters';
  const env = { DATA_DIR: dir, ADMIN_TOKEN: secret };
  let server, base;
  async function start() { server = await createApp(env); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; }
  await start();
  t.after(async () => { await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  const request = async (path, method = 'GET', data, owner = false) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(owner ? { Authorization: `Bearer ${secret}` } : {}) }, body: data ? JSON.stringify(data) : undefined });
  assert.deepEqual(await (await request('/api/events')).json(), []);
  assert.equal((await request('/api/owner/events', 'POST', sample)).status, 401);
  const added = await request('/api/owner/events', 'POST', sample, true);
  assert.equal(added.status, 201); const event = await added.json();
  assert.equal((await (await request('/api/events')).json()).length, 1);
  assert.equal((await (await request('/api/events?game=forever')).json()).length, 0);
  assert.equal((await request(`/api/owner/events/${event.id}`, 'PATCH', sample)).status, 401);
  assert.equal((await request(`/api/owner/events/${event.id}`, 'PATCH', { ...sample, game: 'all', title: 'Guild social' }, true)).status, 200);
  assert.equal((await (await request('/api/events?game=forever')).json())[0].title, 'Guild social');
  await new Promise(r => server.close(r)); await start();
  assert.equal((await (await request('/api/events')).json())[0].start, sample.start);
  assert.equal((await request('/calendar')).status, 200);
  assert.equal((await request('/calendar-time.js')).status, 200);
  assert.equal((await request(`/api/owner/events/${event.id}`, 'DELETE')).status, 401);
  assert.equal((await request(`/api/owner/events/${event.id}`, 'DELETE', null, true)).status, 200);
  assert.deepEqual(await (await request('/api/events')).json(), []);
  assert.equal((await request(`/api/owner/events/${event.id}`, 'DELETE', null, true)).status, 404);
});

test('browser date helpers convert local dates across zones, midnight and daylight saving', () => {
  const module = new URL('../public/calendar-time.js', import.meta.url).href;
  for (const [zone, input, expected] of [
    ['Europe/London', '2026-09-17T20:00', '2026-09-17T19:00:00.000Z'],
    ['America/New_York', '2026-09-17T15:00', '2026-09-17T19:00:00.000Z'],
    ['Asia/Tokyo', '2026-09-18T04:00', '2026-09-17T19:00:00.000Z'],
    ['Europe/London', '2026-12-17T20:00', '2026-12-17T20:00:00.000Z']
  ]) {
    const script = `import assert from 'node:assert/strict'; import { localToUtc, localDay, overlapsDay } from ${JSON.stringify(module)}; assert.equal(localToUtc(${JSON.stringify(input)}),${JSON.stringify(expected)}); assert.equal(localDay(${JSON.stringify(expected)}),${JSON.stringify(input.slice(0,10))}); const event={start:localToUtc('2026-09-17T23:00'),end:localToUtc('2026-09-18T01:00')}; assert.equal(overlapsDay(event,'2026-09-17'),true); assert.equal(overlapsDay(event,'2026-09-18'),true); assert.equal(overlapsDay(event,'2026-09-19'),false);`;
    execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: zone } });
  }
  execFileSync(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; import {localToUtc} from ${JSON.stringify(module)}; assert.throws(()=>localToUtc('2026-03-29T01:30'));`], { env: { ...process.env, TZ: 'Europe/London' } });
});
