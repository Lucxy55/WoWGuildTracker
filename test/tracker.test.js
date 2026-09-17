import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { createBlizzard, ApiError } from '../lib/blizzard.js';

test('approval, game separation, cache, persistence and access boundaries', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'guild-test-'));
  const secret = 'test-secret-with-at-least-thirty-two-characters';
  let calls = 0;
  const env = { DATA_DIR: dir, ADMIN_TOKEN: secret };
  const provider = { character: async () => { calls++; return { class: 'Paladin', role: 'Tank', itemLevel: 100, stats: {}, gear: [], updatedAt: new Date().toISOString() }; }, roster: async () => [] };
  let server = await createApp(env, provider);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', data, owner = false) => {
    const r = await fetch(origin + path, { method, headers: { ...(owner ? { Authorization: `Bearer ${secret}` } : {}), 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
    return { status: r.status, data: await r.json() };
  };
  t.after(async () => { await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  assert.equal((await request('/api/owner/session')).status, 401);
  const added = await request('/api/owner/characters', 'POST', { game: 'retail', name: 'Tester', realm: 'argent-dawn' }, true);
  assert.equal(added.status, 201);
  const id = added.data.id;
  assert.equal((await request(`/api/owner/characters/${id}`, 'PATCH', { raider: true })).status, 401);
  assert.equal((await request(`/api/owner/characters/${id}`, 'PATCH', { raider: 'yes' }, true)).status, 400);
  assert.equal((await request(`/api/owner/characters/${id}`, 'PATCH', { raider: true }, true)).status, 200);
  assert.deepEqual((await request('/api/characters')).data, []);
  assert.equal((await request(`/api/characters/${id}`)).status, 404);
  assert.equal((await request(`/api/owner/characters/${id}`, 'PATCH', { approved: true })).status, 401);
  assert.equal((await request(`/api/owner/characters/${id}`, 'PATCH', { approved: true }, true)).status, 200);
  await Promise.all([request(`/api/characters/${id}`), request(`/api/characters/${id}`)]);
  assert.equal(calls, 1, 'concurrent requests are deduplicated');
  await request(`/api/characters/${id}`); assert.equal(calls, 1, 'cached profile reused');
  assert.equal((await request('/api/characters')).data.length, 1);
  assert.equal((await request('/api/characters')).data[0].raider, true);
  assert.deepEqual((await request('/api/characters?game=forever')).data, []);
  const forever = await request('/api/owner/characters', 'POST', { game: 'forever', name: 'Tester', realm: 'Normal' }, true);
  const manual = { class: 'Mage', specialization: 'Frost', role: 'Damage', itemLevel: 60, stats: { intellect: 120 }, gear: [{ slot: 'Head', name: 'A helm', level: 60 }] };
  assert.equal((await request(`/api/owner/characters/${forever.data.id}`, 'PATCH', { manual, approved: true }, true)).status, 200);
  assert.equal((await request(`/api/characters/${forever.data.id}`)).data.snapshot.source, 'Owner-entered');
  assert.equal(calls, 1, 'Forever never uses guessed Blizzard endpoints');
  assert.equal((await request('/api/owner/characters', 'POST', { game: 'retail', name: 'TESTER', realm: 'ARGENT-DAWN' }, true)).status, 409);
  assert.equal((await request('/api/owner/characters', 'POST', { game: 'unknown', name: 'X', realm: 'Y' }, true)).status, 400);
  await new Promise(r => server.close(r)); server = await createApp(env, provider);
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await request('/api/characters')).data[0].snapshot.itemLevel, 100);
  assert.equal((await request('/api/characters')).data[0].raider, true, 'raider membership survives restart');
  await request(`/api/owner/characters/${id}`, 'PATCH', { raider: false }, true);
  assert.equal((await request('/api/characters')).data[0].raider, false);
  assert.equal((await request('/api/characters')).data[0].approved, true, 'removing raider membership preserves approval');
  await request(`/api/owner/characters/${id}`, 'PATCH', { approved: false }, true);
  assert.equal((await request(`/api/characters/${id}`)).status, 404);
  assert.equal((await fetch(origin + '/.env')).status, 404);
  assert.match((await fetch(origin + '/')).headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('Blizzard OAuth, namespaces, normalization and partial equipment failure', async () => {
  const seen = [];
  const provider = createBlizzard({ REGION: 'eu', BLIZZARD_CLIENT_ID: 'id', BLIZZARD_CLIENT_SECRET: 'secret' }, async (url, options) => {
    seen.push({ url: String(url), options });
    const path = new URL(url).pathname;
    if (path === '/token') return Response.json({ access_token: 'token', expires_in: 3600 });
    assert.equal(options.headers.Authorization, 'Bearer token');
    if (path.includes('/media/')) return Response.json({ assets: [{ key: 'icon', value: 'https://render-eu.worldofwarcraft.com/icons/56/classicon_paladin.jpg' }] });
    if (path.endsWith('/equipment')) return new Response('', { status: 503 });
    if (path.endsWith('/statistics')) return Response.json({ health: 5000, strength: { effective: 200 } });
    if (path.includes('playable-specialization')) return Response.json({ role: { name: 'Tank' } });
    return Response.json({ name: 'Tester', equipped_item_level: 100, character_class: { id: 2, name: 'Paladin' }, active_spec: { id: 66, name: 'Protection' } });
  });
  const result = await provider.character({ game: 'retail', name: 'Tester', realm: 'Argent-Dawn' });
  assert.equal(result.role, 'Tank'); assert.equal(result.stats.strength, 200);
  assert.equal(result.classIcon, 'https://render-eu.worldofwarcraft.com/icons/56/classicon_paladin.jpg');
  assert.equal(result.specIcon, result.classIcon);
  await provider.character({ game: 'retail', name: 'Another', realm: 'Argent-Dawn' });
  assert.equal(seen.filter(r => r.url.includes('/media/')).length, 2, 'media is cached across characters');
  assert.equal(result.warnings.length, 1); assert.deepEqual(result.gear, []);
  assert.equal(seen.filter(r => r.url.endsWith('/token')).length, 1);
  assert.ok(seen.some(r => r.url.includes('namespace=static-eu')));
  assert.ok(seen.some(r => r.url.includes('/argent-dawn/tester?namespace=profile-eu')));
  await assert.rejects(() => provider.character({ game: 'forever' }), ApiError);
});

test('stale fallback, failure backoff, 404 deletion and revocation during refresh', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'guild-failure-test-'));
  const secret = 'test-secret-with-at-least-thirty-two-characters';
  const snapshot = { updatedAt: new Date(Date.now() - 7200000).toISOString(), itemLevel: 100 };
  await writeFile(join(dir, 'tracker.json'), JSON.stringify({ characters: [
    { id: 'aaa', game: 'retail', name: 'Stale', realm: 'test', approved: true, snapshot },
    { id: 'bbb', game: 'retail', name: 'Missing', realm: 'test', approved: true, snapshot },
    { id: 'ccc', game: 'retail', name: 'Slow', realm: 'test', approved: true }
  ] }));
  let calls = 0, release, started;
  const began = new Promise(r => { started = r; });
  const provider = { character: async c => {
    calls++;
    if (c.id === 'aaa') throw new ApiError('Unavailable', 502);
    if (c.id === 'bbb') throw new ApiError('Missing', 404);
    started(); await new Promise(r => { release = r; }); return { ...snapshot, updatedAt: new Date().toISOString() };
  } };
  const server = await createApp({ DATA_DIR: dir, ADMIN_TOKEN: secret }, provider);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(r => server.close(r)); await rm(dir, { recursive: true, force: true }); });
  assert.equal((await (await fetch(origin + '/api/characters/aaa')).json()).stale, true);
  await fetch(origin + '/api/characters/aaa'); assert.equal(calls, 1);
  assert.equal((await fetch(origin + '/api/characters/bbb')).status, 404);
  const list = await (await fetch(origin + '/api/characters')).json();
  assert.equal(list.find(c => c.id === 'bbb').snapshot, null);
  const inFlight = fetch(origin + '/api/characters/ccc'); await began;
  await fetch(origin + '/api/owner/characters/ccc', { method: 'PATCH', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: false }) });
  release(); assert.equal((await inFlight).status, 404);
});
