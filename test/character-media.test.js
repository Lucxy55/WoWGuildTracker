import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCharacterRender } from '../lib/character-media.js';
import { createBlizzard } from '../lib/blizzard.js';

const host = 'https://render.worldofwarcraft.com/eu/character/';
test('prefer full render, fall back to portrait or legacy media, reject untrusted URLs', () => {
  const assets = [
    { key: 'avatar', value: host + 'avatar.jpg' },
    { key: 'main', value: host + 'main.jpg' },
    { key: 'main-raw', value: host + 'main.png' }
  ];
  assert.equal(selectCharacterRender({ assets }), host + 'main.png');
  assert.equal(selectCharacterRender({ assets: assets.slice(0, 2) }), host + 'main.jpg');
  assert.equal(selectCharacterRender({ assets: assets.slice(0, 1) }), host + 'avatar.jpg');
  assert.equal(selectCharacterRender({ render_url: host + 'legacy.jpg' }), host + 'legacy.jpg');
  for (const value of ['http://render.worldofwarcraft.com/image.png', 'https://evil.example/image.png', 'https://render.worldofwarcraft.com.evil.example/image.png', 'https://user:password@render.worldofwarcraft.com/image.png', 'javascript:alert(1)']) {
    assert.equal(selectCharacterRender({ assets: [{ key: 'main-raw', value }] }), null);
  }
  assert.equal(selectCharacterRender(null), null);
  assert.equal(selectCharacterRender({ assets: {} }), null);
});

test('optional media errors preserve character data and successful media uses profile namespace', async () => {
  for (const status of [200, 404, 503]) {
    let mediaUrl;
    const provider = createBlizzard({ REGION: 'eu', BLIZZARD_CLIENT_ID: 'id', BLIZZARD_CLIENT_SECRET: 'secret' }, async url => {
      const path = new URL(url).pathname;
      if (path === '/token') return Response.json({ access_token: 'token', expires_in: 3600 });
      if (path.endsWith('/character-media')) {
        mediaUrl = new URL(url);
        return status === 200 ? Response.json({ assets: [{ key: 'main-raw', value: host + 'main.png' }] }) : new Response('', { status });
      }
      if (path.endsWith('/equipment')) return Response.json({ equipped_items: [] });
      if (path.endsWith('/statistics')) return Response.json({ health: 100 });
      return Response.json({ name: 'Tester', equipped_item_level: 120 });
    });
    const c = await provider.character({ game: 'retail', realm: 'draenor', name: 'Tester' });
    assert.equal(c.characterRender, status === 200 ? host + 'main.png' : null);
    assert.equal(c.itemLevel, 120);
    assert.equal(c.stats.health, 100);
    assert.equal(mediaUrl.searchParams.get('namespace'), 'profile-eu');
  }
});
