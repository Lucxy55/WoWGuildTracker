import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { createBlizzard, ApiError } from './lib/blizzard.js';

const root = dirname(fileURLToPath(import.meta.url));
const TTL = 60 * 60 * 1000;
const digest = s => createHash('sha256').update(s).digest();
export async function createApp(env = process.env, provider = createBlizzard(env)) {
  const store = await createStore(env.DATA_DIR || (env.WEBSITE_SITE_NAME ? join(env.HOME || '/home', 'data', 'wow-guild-tracker') : join(root, 'data')));
  const secret = env.ADMIN_TOKEN || '';
  const pending = new Map();
  const failures = new Map();
  let refreshQueue = Promise.resolve();
  let rosterCache, rosterUntil = 0;
  const staticFiles = new Map(await Promise.all(['index.html', 'app.js', 'style.css'].map(async name => [name, await readFile(join(root, 'public', name))])));
  function authorized(req) { return secret.length >= 32 && timingSafeEqual(digest(req.headers.authorization || ''), digest(`Bearer ${secret}`)); }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError('JSON body required.', 415);
    let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 32768) throw new ApiError('Request too large.', 413); }
    try { return JSON.parse(data); } catch { throw new ApiError('Invalid JSON.', 400); }
  }
  function text(value, max = 100) { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError('Invalid or missing text field.', 400); return value.trim(); }
  async function refresh(record) {
    if (record.game !== 'retail' || (record.snapshot && Date.now() - Date.parse(record.snapshot.updatedAt) < TTL)) return record;
    const failed = failures.get(record.id);
    if (failed && Date.now() < failed.until) {
      if (failed.error.status !== 404 && record.snapshot && Date.now() - Date.parse(record.snapshot.updatedAt) < 86400000) return { ...record, stale: true };
      throw failed.error;
    }
    if (pending.has(record.id)) return pending.get(record.id);
    const job = refreshQueue.then(async () => {
      try {
        const snapshot = await provider.character(record);
        failures.delete(record.id);
        await store.update(s => { const c = s.characters.find(c => c.id === record.id); if (c) c.snapshot = snapshot; });
        return { ...record, snapshot };
      } catch (e) {
        failures.set(record.id, { until: Date.now() + 60000, error: e });
        if (e.status === 404) { await store.update(s => { const c = s.characters.find(c => c.id === record.id); if (c) delete c.snapshot; }); throw e; }
        if (record.snapshot && Date.now() - Date.parse(record.snapshot.updatedAt) < 86400000) return { ...record, stale: true };
        throw e;
      }
    }).finally(() => pending.delete(record.id));
    refreshQueue = job.catch(() => {}); pending.set(record.id, job); return job;
  }
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const owner = authorized(req);
      if (path === '/healthz' && req.method === 'GET') return send(200, { ok: true });
      if (path.startsWith('/api/owner/') && !owner) return send(401, { error: 'Owner access requires a valid token (configured with at least 32 characters).' });
      if (path === '/api/config' && req.method === 'GET') return send(200, { guildName: env.GUILD_NAME || 'Your Guild', region: env.REGION || 'eu', liveConfigured: !!(env.BLIZZARD_CLIENT_ID && env.BLIZZARD_CLIENT_SECRET) });
      if (path === '/api/owner/session' && req.method === 'GET') return send(200, { ok: true });
      if (path === '/api/characters' && req.method === 'GET') {
        const game = url.searchParams.get('game') || 'retail';
        const characters = store.read().characters.filter(c => c.game === game && (owner || c.approved)).map(c => ({ ...c, snapshot: c.snapshot && (c.game === 'forever' || Date.now() - Date.parse(c.snapshot.updatedAt) < 86400000) ? c.snapshot : null }));
        return send(200, characters);
      }
      if (path === '/api/owner/roster' && req.method === 'GET') {
        if (Date.now() >= rosterUntil) { rosterCache = await provider.roster(); rosterUntil = Date.now() + TTL; }
        return send(200, rosterCache);
      }
      if (path === '/api/owner/characters' && req.method === 'POST') {
        const input = await body(req);
        if (!['retail', 'forever'].includes(input.game)) throw new ApiError('Invalid game.', 400);
        const record = { id: randomUUID(), game: input.game, name: text(input.name, 60), realm: text(input.realm, 80), approved: false };
        if (record.game === 'retail' && !/^[\p{L}\p{N}' -]+$/u.test(record.realm)) throw new ApiError('Invalid realm slug.', 400);
        await store.update(s => {
          if (s.characters.length >= 500) throw new ApiError('Limit of 500 tracked characters reached.', 409);
          if (s.characters.some(c => c.game === record.game && c.name.toLowerCase() === record.name.toLowerCase() && c.realm.toLowerCase() === record.realm.toLowerCase())) throw new ApiError('Character already added.', 409);
          s.characters.push(record);
        });
        return send(201, record);
      }
      const match = path.match(/^\/api\/(owner\/)?characters\/([a-f0-9-]+)$/);
      if (match) {
        const record = store.read().characters.find(c => c.id === match[2]);
        if (!record || (!owner && !record.approved)) return send(404, { error: 'Character not found.' });
        if (!match[1] && req.method === 'GET') {
          const result = await refresh(record);
          const current = store.read().characters.find(c => c.id === record.id);
          if (!current || (!owner && !current.approved)) return send(404, { error: 'Character not found.' });
          return send(200, { ...result, approved: current.approved });
        }
        if (match[1] && req.method === 'DELETE') { await store.update(s => { s.characters = s.characters.filter(c => c.id !== record.id); }); return send(200, { ok: true }); }
        if (match[1] && req.method === 'PATCH') {
          const input = await body(req);
          await store.update(s => {
            const c = s.characters.find(c => c.id === record.id);
            if (!c) throw new ApiError('Character not found.', 404);
            if (typeof input.approved === 'boolean') c.approved = input.approved;
            if (input.manual) {
              if (c.game !== 'forever') throw new ApiError('Manual records are only available for Forever.', 400);
              const m = input.manual;
              if (!['Tank', 'Healer', 'Damage'].includes(m.role)) throw new ApiError('Invalid role.', 400);
              if (!Number.isInteger(m.itemLevel) || m.itemLevel < 0 || m.itemLevel > 9999) throw new ApiError('Invalid item level.', 400);
              if (!Array.isArray(m.gear) || m.gear.length > 25 || !m.stats || typeof m.stats !== 'object' || Array.isArray(m.stats) || Object.keys(m.stats).length > 30) throw new ApiError('Invalid gear or stats.', 400);
              c.snapshot = { class: text(m.class), specialization: text(m.specialization), role: m.role, itemLevel: m.itemLevel, stats: Object.fromEntries(Object.entries(m.stats).map(([k, v]) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new ApiError('Stats must be numbers.', 400); return [text(k, 40), v]; })), gear: m.gear.map(i => ({ name: text(i.name), slot: text(i.slot, 40), level: Number.isInteger(i.level) && i.level >= 0 && i.level <= 9999 ? i.level : null })), source: 'Owner-entered', updatedAt: new Date().toISOString() };
            }
          });
          return send(200, { ok: true });
        }
      }
      const file = path === '/' || path.startsWith('/character/') ? 'index.html' : path.slice(1);
      if (req.method === 'GET' && staticFiles.has(file)) { res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' }); return res.end(staticFiles.get(file)); }
      send(404, { error: 'Not found.' });
    } catch (e) { send(e instanceof ApiError ? e.status : 500, { error: e instanceof ApiError ? e.message : 'The request could not be completed. Please try again.' }); }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = await createApp();
  server.listen(process.env.PORT || 3000, () => console.log('Guild tracker listening on configured PORT.'));
}
