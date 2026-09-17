// Only permit Blizzard's render hosts; never forward API credentials to image URLs.
export function selectCharacterRender(media) {
  const assets = Array.isArray(media?.assets) ? media.assets : [];
  const candidates = ['main-raw', 'main', 'inset', 'avatar'].map(key => assets.find(asset => asset.key === key)?.value);
  candidates.push(media?.render_url, media?.bust_url, media?.avatar_url);
  for (const value of candidates) {
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        /^render(?:-(?:eu|us|kr|tw))?\.worldofwarcraft\.com$/.test(url.hostname)) return url.href;
    } catch { /* Missing or malformed optional media must not break a profile. */ }
  }
  return null;
}
