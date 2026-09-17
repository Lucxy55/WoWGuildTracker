# Guild Ledger · WoW Guild Tracker

Two pages for **Node 24 LTS / Azure App Service Linux F1**. No production dependencies, framework, build step, external database, polling or scheduled jobs.

## Features

- Guild roster: equipped item level, class, specialization, role, search and explicit owner approval.
- Raiders section: owner-managed membership, per-game team cards and role counts. Use **Add to raiders** / **Remove from raiders** in owner controls. Only approved characters appear publicly; raider membership does not approve a character. Membership persists across refreshes and restarts.
- Class and specialization icons on rosters, raider cards and character details, using Blizzard's Retail media API. Media lookups are cached for a day per class/spec; images load directly from Blizzard. Existing profiles gain icons on their next profile refresh after the one-hour cache expires. Missing media and manual Forever profiles use text fallbacks.
- Character details: stats, equipped gear and Retail Wowhead item links.
- Character appearance: static Blizzard Armory render on Retail detail pages, preferring the full transparent render and falling back to available portraits. Images load directly from Blizzard with no viewer library or image proxy. Missing media, failed images and Forever profiles show a fallback. Media URLs refresh with the existing one-hour profile cache; existing cached profiles gain images after their next expired-cache refresh.
- Owner-only guild roster discovery; selected members enter a pending queue.
- Retail / Forever switcher with separate identities. **Forever is manual only** until a documented live API is verified. Enter class, spec, role, item level, stats and gear through owner controls. The identity label does not assume a Retail realm.
- Best-in-slot automation is deferred; a guide link is provided. BiS depends on patch, content and spec.
- One-hour persisted profile cache, deduplicated and queued requests, one-minute failure backoff, and stale fallback limited to 24 hours. Blizzard 404 responses remove saved profiles.

## Local setup

Install Node 24, copy `.env.example` to `.env`, configure settings, then run:

```sh
npm start
# Open http://localhost:3000
npm test
```

No install step is needed. The roster starts empty; no sample data is presented as live data.

Generate an owner secret, then set it as `ADMIN_TOKEN`:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use **Owner access** in the header. The token remains in browser memory only. Reload or lock controls to end the session. Use HTTPS in production. This is a single-owner bearer token, not a multi-user account system. Rotate the token in Azure settings if disclosed.

## Blizzard configuration

Create a client at the [Battle.net developer portal](https://develop.battle.net/). Store credentials on the server, never in browser JavaScript or GitHub.

| Setting | Meaning |
| --- | --- |
| `BLIZZARD_CLIENT_ID` | Developer client ID |
| `BLIZZARD_CLIENT_SECRET` | Developer client secret |
| `ADMIN_TOKEN` | Random owner secret of at least 32 characters |
| `REGION` | `eu`, `us`, `kr` or `tw`; default `eu` |
| `GUILD_NAME` | Display name |
| `GUILD_REALM` | Realm slug, e.g. `argent-dawn` |
| `GUILD_SLUG` | Guild URL slug, e.g. `your-guild` |
| `DATA_DIR` | Persistent writable directory |

The server obtains an OAuth client-credentials token from `https://oauth.battle.net/token`. Retail uses `profile-{region}` for guild roster, character summary, equipment and statistics, and `static-{region}` for specialization role. No Armory scraping is used.

1. Unlock owner controls.
2. Add a character by name and realm slug, or select members using **Find members in configured guild**.
3. Refresh profiles or visit the detail page to load data. Click **Approve** to publish the character.
4. For Forever, add a record using a ruleset/identity label, visit its detail page and use **Edit Forever profile**. Stats and gear currently use owner-facing JSON fields.

Guests/alts are allowed: approval is not proof of guild membership. Discovery does not automatically approve or remove members. Public users cannot submit or edit records. Profiles show the API's latest available snapshot, not historical progression or simulation results. Blizzard may take time to reflect game changes.

## Azure deployment from GitHub

1. Commit these files to your repository.
2. Select an App Service Web App using Linux, **Node 24 LTS**, and the **F1 Free** plan. Check availability in your region.
3. Set startup command to **`node server.js`**. The app listens on Azure's `PORT`.
4. Add the settings above in Azure environment variables, including **`DATA_DIR=/home/data/wow-guild-tracker`** and `NODE_ENV=production`. Enable HTTPS Only. Keep secrets out of GitHub.
5. In Deployment Center, connect `Lucxy55/WoWGuildTracker` and your branch. Let Azure generate the deployment workflow. There is no frontend build step. Add `npm test` before deployment if desired.
6. Check `/healthz`, open the site, unlock owner access, then add and approve characters.

Free App Service has CPU/storage quotas, cold starts, no Always On and no SLA. Refreshes happen on character visits or **Refresh profiles**, only when the one-hour cache expires. Large rosters take time because upstream calls are queued. The store supports up to 500 characters across both games.

The app writes `DATA_DIR/tracker.json` atomically, outside the deployment folder. **Back up this file.** Run one Node process and one instance: this store does not implement cross-process locking. Do not use PM2 cluster mode. Replace `lib/store.js` with shared storage if scaling out. Owner approvals persist across restarts. Revoking approval hides subsequent requests but cannot retract previously downloaded data.

## Validation and limits

`npm test` uses isolated storage and mocked Blizzard responses to exercise HTTP authorization, approval privacy, persistence, game separation, cache coalescing and response mapping. Live Blizzard integration needs your credentials. This project does not create Azure resources or publish itself to GitHub.

References: [Blizzard profile APIs](https://develop.battle.net/documentation/world-of-warcraft/profile-apis), [OAuth](https://develop.battle.net/documentation/guides/using-oauth), [Azure Node configuration](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs), [Azure quotas](https://learn.microsoft.com/en-us/azure/app-service/web-sites-monitor).
