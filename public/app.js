const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = ''; // In memory only: never persist the owner secret in browser storage.
let game = localStorage.getItem('guild-game') === 'forever' ? 'forever' : 'retail';
let config, records = [], generation = 0;
$('#game').value = game;
const notice = message => { $('#notice').textContent = message; };
async function api(path, method = 'GET', data) {
  const response = await fetch(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed.'); return result;
}
const when = value => value ? new Date(value).toLocaleString() : 'Not fetched yet';
const metric = (label, value) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
function icon(url, label) {
  const safe = typeof url === 'string' && /^https:\/\/render(?:-(?:eu|us|kr|tw))?\.worldofwarcraft\.com\/(?:eu\/|us\/|kr\/|tw\/)?icons\//.test(url);
  return '<span class="game-icon" aria-hidden="true"><span>' + esc((label || '?').slice(0, 2).toUpperCase()) + '</span>' + (safe ? '<img src="' + esc(url) + '" alt="" width="28" height="28" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>';
}
function identity(s) {
  return '<span class="identity-line">' + icon(s.classIcon, s.class) + '<span>' + esc(s.class) + '</span></span><span class="identity-line spec-line">' + icon(s.specIcon, s.specialization) + '<span>' + esc(s.specialization) + '</span></span>';
}
function characterArt(c) {
  const url = c.snapshot?.characterRender;
  const safe = typeof url === 'string' && /^https:\/\/render(?:-(?:eu|us|kr|tw))?\.worldofwarcraft\.com\//.test(url);
  const fallback = c.game === 'forever' ? 'Character renders are not yet available for Forever.' : 'Blizzard has no character render available. It may appear after your next in-game logout and profile refresh.';
  return `<figure class="character-art"><div class="render-stage"><div class="render-fallback" ${safe ? 'hidden' : ''}><span aria-hidden="true">◇</span><p>${esc(fallback)}</p></div>${safe ? `<img class="character-render" src="${esc(url)}" alt="${esc(c.name)} — character appearance from Blizzard" width="960" height="720" decoding="async" referrerpolicy="no-referrer">` : ''}</div><figcaption>Character appearance · ${safe ? 'Blizzard Armory render' : 'Image unavailable'}</figcaption></figure>`;
}
document.addEventListener('error', e => {
  if (!e.target.matches?.('.character-render')) return;
  const figure = e.target.closest('.character-art');
  e.target.hidden = true;
  figure.querySelector('.render-fallback').hidden = false;
  figure.querySelector('.render-fallback p').textContent = 'The character image could not be loaded. Your statistics and gear are still available below.';
  figure.querySelector('figcaption').textContent = 'Character appearance · Image unavailable';
}, true);
document.addEventListener('error', e => { if (e.target.matches?.('.game-icon img')) e.target.hidden = true; }, true);
function raidersSection() {
  const team = records.filter(c => c.approved && c.raider === true);
  const counts = ['Tank', 'Healer', 'Damage'].map(role => role + ': ' + team.filter(c => c.snapshot?.role === role).length);
  const unknown = team.filter(c => !['Tank', 'Healer', 'Damage'].includes(c.snapshot?.role)).length;
  if (unknown) counts.push('Unknown role: ' + unknown);
  return '<section class="panel raiders"><div class="toolbar"><h2>Raiders <span class="badge">' + team.length + '</span></h2><span class="subtle">' + counts.join(' · ') + '</span></div>' + (team.length ? '<div class="raider-grid">' + team.map(c => '<article class="raider-card"><a href="/character/' + c.id + '">' + esc(c.name) + '</a><p class="subtle">' + esc(c.realm) + '</p>' + identity(c.snapshot || {}) + '<p>' + esc(c.snapshot?.role) + ' · Item level ' + esc(c.snapshot?.itemLevel) + '</p></article>').join('') + '</div>' : '<div class="empty"><h2>No raiders selected yet</h2><p>' + (token ? 'Use Add to raiders in the roster below. Only approved characters appear in this section.' : 'The owner has not selected any approved raiders for this game yet.') + '</p></div>') + '</section>';
}
function row(c) {
  const s = c.snapshot || {};
  return `<tr><td><a href="/character/${c.id}">${esc(c.name)}</a><small>${esc(c.realm)}</small></td><td>${identity(s)}</td><td>${esc(s.role)}</td><td class="gear-level">${esc(s.itemLevel)}</td><td><span class="badge ${c.approved ? '' : 'pending'}">${c.approved ? 'Approved' : 'Pending'}</span>${c.raider ? ' <span class="badge">Raider</span>' : ''}<small>${s.source ? esc(s.source) : 'Awaiting profile'}</small></td>${token ? `<td><button data-raider="${c.id}" data-value="${!c.raider}" aria-pressed="${c.raider === true}">${c.raider ? 'Remove from raiders' : 'Add to raiders'}</button> <button data-approve="${c.id}" data-value="${!c.approved}">${c.approved ? 'Unapprove' : 'Approve'}</button> <button data-remove="${c.id}">Remove</button></td>` : ''}</tr>`;
}
function filterRows() {
  const query = $('#search').value.toLowerCase();
  const shown = records.filter(c => `${c.name} ${c.realm} ${c.snapshot?.class || ''} ${c.snapshot?.role || ''}`.toLowerCase().includes(query));
  $('#rows').innerHTML = shown.map(row).join('');
  $('#empty-filter').hidden = shown.length > 0;
}
async function guild() {
  const turn = ++generation;
  const data = await api(`/api/characters?game=${game}`); if (turn !== generation) return;
  records = data;
  const approved = records.filter(c => c.approved), levels = approved.map(c => c.snapshot?.itemLevel).filter(v => typeof v === 'number');
  $('#view').innerHTML = `<div class="hero"><div><p class="eyebrow">${game === 'retail' ? 'RETAIL' : 'FOREVER'} / ${esc(config.region.toUpperCase())} / GUILD ROSTER</p><h1>${esc(config.guildName)}</h1><p>Your guild. Every character. One place.</p></div><span class="badge">${approved.length} approved members</span></div>
  ${game === 'forever' ? '<div class="note">Forever records are owner-entered. Live character API support has not yet been verified.</div>' : !config.liveConfigured ? '<div class="note">Live data is not connected yet. Add Blizzard API credentials to your server settings to load profiles.</div>' : ''}
  <div class="metrics">${metric('Approved characters', approved.length)}${metric('Average equipped item level', levels.length ? Math.round(levels.reduce((a,b) => a+b,0)/levels.length) : '—')}${metric('Tanks / Healers', `${approved.filter(c => c.snapshot?.role === 'Tank').length} / ${approved.filter(c => c.snapshot?.role === 'Healer').length}`)}${metric('Damage dealers', approved.filter(c => c.snapshot?.role === 'Damage').length)}</div>
  ${raidersSection()}
  <section class="panel"><div class="toolbar"><h2>Character roster</h2><div class="actions"><input id="search" aria-label="Search characters" placeholder="Search name, class or role…">${game === 'retail' && config.liveConfigured ? '<button id="refresh">Refresh profiles</button>' : ''}</div></div><div class="table-wrap"><table><thead><tr><th>Character</th><th>Class / Specialization</th><th>Role</th><th>Item level</th><th>Status</th>${token ? '<th>Owner controls</th>' : ''}</tr></thead><tbody id="rows"></tbody></table></div><div id="empty-filter" class="empty"><h2>No characters to display</h2><p>${token ? 'Add a character below, then approve it to make it visible to everyone.' : 'Approved guild characters will appear here once the site owner adds them.'}</p></div></section>
  <p class="subtle">Profiles refresh on character visits, or with Refresh profiles. Cached for one hour. Average includes ${levels.length} available profiles.</p>
  ${token ? `<details open><summary>Owner workspace</summary><section class="panel panel-content"><h2>Add a character</h2><form id="add"><div class="fields"><label>Character name<input name="name" required maxlength="60"></label><label>${game === 'retail' ? 'Realm slug (for example, argent-dawn)' : 'Ruleset / identity (your label)'}<input name="realm" required maxlength="80"></label></div><button class="primary">Add for approval</button></form>${game === 'retail' ? '<hr><button id="load-roster">Find members in configured guild</button><div id="roster-results"></div>' : ''}</section></details>` : ''}`;
  $('#search').addEventListener('input', filterRows); filterRows();
  $('#refresh')?.addEventListener('click', async e => {
    e.target.disabled = true; let failed = 0;
    for (const c of records) { if (turn !== generation) return; try { await api(`/api/characters/${c.id}`); } catch { failed++; } }
    if (turn !== generation) return;
    notice(failed ? `${failed} profiles could not be refreshed. Available data was kept.` : 'Profiles updated. Recent cached profiles were reused.'); await guild();
  });
  $('#add')?.addEventListener('submit', async e => {
    e.preventDefault(); const values = Object.fromEntries(new FormData(e.target));
    await action(async () => { await api('/api/owner/characters', 'POST', { ...values, game }); await guild(); });
  });
  $('#load-roster')?.addEventListener('click', () => action(async () => {
    const members = await api('/api/owner/roster');
    $('#roster-results').innerHTML = '<p>Select members to add to your approval queue.</p>';
    for (const member of members) {
      const button = document.createElement('button'); button.textContent = `${member.name} · ${member.realm}`;
      button.addEventListener('click', () => action(async () => { await api('/api/owner/characters', 'POST', { name: member.name, realm: member.realm, game: 'retail' }); button.disabled = true; button.textContent += ' · Added'; notice('Character added pending approval. Reload the roster to review.'); }));
      $('#roster-results').append(button);
    }
  }));
}
async function character(id) {
  const turn = ++generation;
  $('#view').innerHTML = '<p>Loading character profile…</p>';
  const c = await api(`/api/characters/${id}`); if (turn !== generation) return;
  game = c.game; $('#game').value = game;
  const s = c.snapshot || {};
  $('#view').innerHTML = `<a class="back" href="/">← Back to guild</a><div class="character-hero panel"><div class="character-summary"><p class="eyebrow">${esc(c.game.toUpperCase())} / ${esc(c.realm)}</p><h1>${esc(c.name)}</h1><div class="character-identity">${identity(s)}</div><p>${esc(s.role)}${c.raider ? ' · Raider' : ''}</p><span class="badge">${esc(s.source || 'No profile yet')}</span></div>${characterArt(c)}</div>
  ${c.stale ? '<div class="note">Blizzard is unavailable. Showing the last saved profile, which may be out of date.</div>' : ''}${(s.warnings || []).map(w => `<div class="note">${esc(w)}</div>`).join('')}
  <div class="metrics">${metric('Equipped item level', s.itemLevel)}${metric('Level', s.level)}${metric('Role', s.role)}${metric('Faction', s.faction)}</div>
  <div class="grid"><section class="panel panel-content"><h2>Character statistics</h2>${Object.keys(s.stats || {}).length ? Object.entries(s.stats).map(([key,value]) => `<div class="stat"><span>${esc(key.replaceAll('_',' '))}</span><strong>${esc(value)}</strong></div>`).join('') : '<p>No statistics available.</p>'}<p class="subtle">Updated: ${esc(when(s.updatedAt))}</p>${s.lastLogin ? `<p class="subtle">Last in-game login: ${esc(when(s.lastLogin))}</p>` : ''}</section>
  <section class="panel"><div class="toolbar"><h2>Equipped gear</h2><span class="subtle">${(s.gear || []).length} items</span></div><div class="table-wrap"><table><thead><tr><th>Slot</th><th>Item</th><th>Level</th></tr></thead><tbody>${(s.gear || []).map(i => `<tr><td>${esc(i.slot)}</td><td>${c.game === 'retail' && Number.isInteger(i.id) ? `<a href="https://www.wowhead.com/item=${i.id}" target="_blank" rel="noopener noreferrer">${esc(i.name)} ↗</a>` : esc(i.name)}</td><td class="gear-level">${esc(i.level)}</td></tr>`).join('')}</tbody></table></div>${!s.gear?.length ? '<p class="panel-content">No equipment available.</p>' : ''}</section></div>
  <section class="panel panel-content"><h2>Best in slot</h2><p>Recommendations depend on your game, patch, specialization and content. Automated best-in-slot lists are not included in this first version.</p><a href="https://www.wowhead.com/guides" target="_blank" rel="noopener noreferrer">Browse Wowhead guides ↗</a></section>
  ${token && game === 'forever' ? `<details><summary>Edit Forever profile</summary><form id="manual" class="panel panel-content"><div class="fields"><label>Class<input name="class" value="${esc(s.class || '')}" required></label><label>Specialization<input name="specialization" value="${esc(s.specialization || '')}" required></label><label>Role<select name="role">${['Tank','Healer','Damage'].map(r => `<option ${s.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label><label>Equipped item level<input name="itemLevel" type="number" min="0" max="9999" value="${s.itemLevel || 0}" required></label></div><label>Statistics JSON (example: {"strength": 200})<textarea name="stats">${esc(JSON.stringify(s.stats || {}, null, 2))}</textarea></label><label>Gear JSON (example: [{"slot":"Head","name":"Helm","level":60}])<textarea name="gear">${esc(JSON.stringify(s.gear || [], null, 2))}</textarea></label><button class="primary">Save manual profile</button></form></details>` : ''}`;
  $('#manual')?.addEventListener('submit', e => { e.preventDefault(); action(async () => { const m = Object.fromEntries(new FormData(e.target)); m.itemLevel = Number(m.itemLevel); m.stats = JSON.parse(m.stats); m.gear = JSON.parse(m.gear); await api(`/api/owner/characters/${id}`, 'PATCH', { manual: m }); await character(id); }); });
}
async function action(fn) { try { await fn(); } catch (error) { notice(error.message); } }
async function route() {
  notice('');
  try { if (!config) config = await api('/api/config'); const match = location.pathname.match(/^\/character\/([a-f0-9-]+)$/); await (match ? character(match[1]) : guild()); }
  catch (e) { $('#view').innerHTML = `<a href="/">← Back to guild</a><div class="empty"><h1>Unable to load this view</h1><p>${esc(e.message)}</p><button id="retry">Try again</button></div>`; $('#retry').onclick = route; }
}
document.addEventListener('click', e => {
  const link = e.target.closest('a[href^="/"]');
  if (link && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) { e.preventDefault(); history.pushState({}, '', link.getAttribute('href')); route(); }
  const approve = e.target.closest('[data-approve]');
  if (approve) action(async () => { await api(`/api/owner/characters/${approve.dataset.approve}`, 'PATCH', { approved: approve.dataset.value === 'true' }); await guild(); });
  const raider = e.target.closest('[data-raider]');
  if (raider) action(async () => { raider.disabled = true; try { await api('/api/owner/characters/' + raider.dataset.raider, 'PATCH', { raider: raider.dataset.value === 'true' }); await guild(); } finally { raider.disabled = false; } });
  const remove = e.target.closest('[data-remove]');
  if (remove && confirm('Remove this character from the tracker?')) action(async () => { await api(`/api/owner/characters/${remove.dataset.remove}`, 'DELETE'); await guild(); });
});
$('#game').onchange = () => { game = $('#game').value; localStorage.setItem('guild-game', game); history.pushState({}, '', '/'); route(); };
$('#owner-toggle').onclick = () => { if (token) { token = ''; $('#owner-toggle').textContent = 'Owner access'; route(); } else $('#login').showModal(); };
$('#cancel-login').onclick = () => $('#login').close();
$('#login-form').onsubmit = async e => { e.preventDefault(); token = $('#token').value; try { await api('/api/owner/session'); $('#token').value = ''; $('#login-error').textContent = ''; $('#login').close(); $('#owner-toggle').textContent = 'Lock owner controls'; route(); } catch (error) { token = ''; $('#login-error').textContent = error.message; } };
window.addEventListener('popstate', route);
route();
