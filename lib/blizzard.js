import { selectCharacterRender } from './character-media.js';

export class ApiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export function createBlizzard(env = process.env, fetcher = fetch) {
  let token, expires = 0, tokenPending;
  const region = env.REGION || 'eu';
  if (!['eu', 'us', 'kr', 'tw'].includes(region)) throw new Error('Invalid REGION');
  const locale = { eu: 'en_GB', us: 'en_US', kr: 'ko_KR', tw: 'zh_TW' }[region];
  async function accessToken() {
    if (token && Date.now() < expires) return token;
    if (!env.BLIZZARD_CLIENT_ID || !env.BLIZZARD_CLIENT_SECRET) throw new ApiError('Blizzard credentials are not configured.', 503);
    if (!tokenPending) tokenPending = (async () => {
      const r = await fetcher('https://oauth.battle.net/token', {
        method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Basic ${Buffer.from(`${env.BLIZZARD_CLIENT_ID}:${env.BLIZZARD_CLIENT_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials'
      });
      if (!r.ok) throw new ApiError('Blizzard authentication failed. Check server credentials.');
      const data = await r.json(); token = data.access_token; expires = Date.now() + (data.expires_in - 60) * 1000;
      return token;
    })().finally(() => { tokenPending = null; });
    return tokenPending;
  }
  async function request(path, family = 'profile') {
    const url = new URL(`https://${region}.api.blizzard.com${path}`);
    url.search = new URLSearchParams({ namespace: `${family}-${region}`, locale });
    const r = await fetcher(url, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) {
      if (r.status === 401) { token = null; expires = 0; }
      const error = new ApiError(r.status === 404 ? 'Character or guild is unavailable in Blizzard’s API.' : r.status === 429 ? 'Blizzard is busy. Please try again later.' : 'Blizzard data is temporarily unavailable.', r.status === 404 ? 404 : 502);
      error.upstreamStatus = r.status;
      throw error;
    }
    return r.json();
  }
  const part = value => encodeURIComponent(value.toLowerCase());
  const mediaCache = new Map();
  async function icon(kind, id) {
    if (!Number.isInteger(id)) return null;
    const key = `${kind}/${id}`;
    let entry = mediaCache.get(key);
    if (!entry || entry.until < Date.now()) {
      entry = { until: Date.now() + 86400000, value: request(`/data/wow/media/${key}`, 'static').then(data => {
        const value = data.assets?.find(a => a.key === 'icon')?.value;
        return typeof value === 'string' && /^https:\/\/render(?:-(?:eu|us|kr|tw))?\.worldofwarcraft\.com\/(?:eu\/|us\/|kr\/|tw\/)?icons\//.test(value) ? value : null;
      }).catch(() => { entry.until = Date.now() + 60000; return null; }) };
      if (mediaCache.size >= 256) mediaCache.delete(mediaCache.keys().next().value);
      mediaCache.set(key, entry);
    }
    return entry.value;
  }
  return {
    async roster() {
      if (!env.GUILD_REALM || !env.GUILD_SLUG) throw new ApiError('Set GUILD_REALM and GUILD_SLUG on the server.', 503);
      const data = await request(`/data/wow/guild/${part(env.GUILD_REALM)}/${part(env.GUILD_SLUG)}/roster`);
      return (data.members || []).map(({ character: c }) => ({ name: c.name, realm: c.realm.slug, level: c.level }));
    },
    async character(record) {
      if (record.game !== 'retail') throw new ApiError('Forever live API support has not been verified. Use owner-entered records.', 422);
      const base = `/profile/wow/character/${part(record.realm)}/${part(record.name)}`;
      const profile = await request(base);
      const results = await Promise.allSettled([request(`${base}/equipment`), request(`${base}/statistics`), profile.active_spec?.id ? request(`/data/wow/playable-specialization/${profile.active_spec.id}`, 'static') : Promise.resolve(null), request(`${base}/character-media`)]);
      const [equipment, statistics, spec, media] = results.map(r => r.status === 'fulfilled' ? r.value : null);
      const [classIcon, specIcon] = await Promise.all([icon('playable-class', profile.character_class?.id), icon('playable-specialization', profile.active_spec?.id)]);
      const characterRender = selectCharacterRender(media);
      const mediaResult = results[3];
      const hasMedia = (Array.isArray(media?.assets) && media.assets.some(a => ['main-raw', 'main', 'inset', 'avatar'].includes(a.key) && a.value)) || media?.render_url || media?.bust_url || media?.avatar_url;
      const mediaStatus = mediaResult.status === 'rejected'
        ? { state: 'request-failed', httpStatus: mediaResult.reason?.upstreamStatus || null }
        : { state: characterRender ? 'available' : hasMedia ? 'unsupported-url' : 'no-image' };
      return {
        classIcon, specIcon, characterRender, mediaStatus,
        name: profile.name, level: profile.level, class: profile.character_class?.name || 'Unknown',
        specialization: profile.active_spec?.name || 'Unknown', role: spec?.role?.name || 'Unknown',
        itemLevel: profile.equipped_item_level ?? null, faction: profile.faction?.name || '',
        guild: profile.guild?.name || '', lastLogin: profile.last_login_timestamp || null,
        stats: statistics ? Object.fromEntries(['health', 'strength', 'agility', 'intellect', 'stamina', 'armor', 'mastery', 'versatility', 'melee_crit', 'melee_haste', 'spell_crit', 'spell_haste'].filter(k => statistics[k] !== undefined).map(k => [k, typeof statistics[k] === 'number' ? statistics[k] : statistics[k].effective ?? statistics[k].value ?? statistics[k].rating ?? null])) : {},
        gear: (equipment?.equipped_items || []).map(i => ({ id: i.item.id, name: i.name, slot: i.slot.name, level: i.level?.value ?? null, quality: i.quality?.type || 'COMMON' })),
        warnings: results.slice(0, 2).flatMap((r, i) => r.status === 'rejected' ? [`${i ? 'Statistics' : 'Equipment'} could not be loaded.`] : []),
        updatedAt: new Date().toISOString(), source: 'Blizzard API'
      };
    }
  };
}
