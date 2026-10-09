// Cheat sheet: everything that already exists in this game, on one page. Click a thing to use or find it.
import { h, icon, clear, toast, copyText, emptyState, debounce } from '../dom.js';
import { keyGrid } from '../keys.js';

const CAT_ORDER = ['offence', 'control', 'movement', 'defence', 'summon', 'utility'];
const titleCase = (s) => s[0].toUpperCase() + s.slice(1);

export default function mount(root, app) {
  const { net } = app;
  let data = null, error = null, query = '';
  const body = h('div');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search spells, creations, library, places…', 'aria-label': 'Search the cheat sheet', on: { input: debounce((e) => { query = e.target.value.trim().toLowerCase(); paint(); }, 90) } });
  const copyBtn = h('button', { class: 'btn', type: 'button', on: { click: async () => toast((await copyText(asText())) ? 'Cheat sheet copied as text' : 'Copy failed', 'ok') } }, icon('copy', 15), 'Copy as text');
  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Cheat sheet'), h('p', null, 'Everything already made: spells, creations, the library, places and scenes that exist, models and quests. Click a thing to use it as a wish or to open it.')),
      h('span', { class: 'right row wrap' }, copyBtn)),
    h('div', { class: 'row wrap', style: { marginBottom: '14px' } }, h('div', { class: 'searchbox' }, icon('search', 16), search)),
    body);

  async function load() {
    if (net.state !== 'open' || net.hasPlugin !== true) { error = net.hasPlugin === false ? 'The admin plugin is not loaded on the server.' : 'Waiting for the server…'; paint(); return; }
    try { data = await net.request('admin_cheatsheet', {}, { timeout: 15000 }); error = null; } catch (e) { error = e.message; }
    paint();
  }
  const soon = debounce(load, 600);
  net.on('plugin', load); net.on('reload', () => { if (!root.hidden) soon(); });
  net.on('admin_event', (m) => { if (m.kind === 'changed' && !root.hidden && /^(creation|trash|spawn|asset|save)$/.test(m.what)) soon(); });
  net.on('place_status', (m) => { if (m.state === 'done' && !root.hidden) soon(); });
  net.on('gen3d_status', (m) => { if (m.state === 'done' && !root.hidden) soon(); });

  const ok = (...f) => !query || f.join(' ').toLowerCase().includes(query);
  const chip = (label, sub, title, fn, cls = '') => h('button', { class: `tag-chip ${cls}`, type: 'button', title, on: { click: fn } }, label, sub ? h('small', null, sub) : null);
  function section(title, count, ...kids) { return h('section', { class: 'card' }, h('h2', { class: 'card-title' }, title, h('span', { class: 'faint', style: { fontWeight: 500, letterSpacing: 0 } }, count)), ...kids); }
  const chips = (arr) => (arr.length ? h('div', { class: 'chips' }, arr) : h('p', { class: 'dim small' }, 'Nothing matches.'));

  function paint() {
    clear(body);
    if (!data) return body.append(emptyState(error ? 'Cannot build the cheat sheet' : 'Loading…', error));
    const spells = data.spells.filter((s) => ok(s.name, s.id, s.description, s.category));
    const cats = [...new Set([...CAT_ORDER, ...spells.map((s) => s.category)])].filter((c) => spells.some((s) => s.category === c));
    const creations = data.creations.filter((c) => ok(c.name, c.title, c.description));
    const lib = data.library.map((c) => ({ ...c, names: c.names.filter((n) => ok(n, c.title)) })).filter((c) => c.names.length);
    const places = data.places.filter((p) => ok(p.name, p.prompt, p.slug));
    const blasts = data.blasts.filter((p) => ok(p.name, p.caption, p.prompt));
    const models = data.models.filter((m) => ok(m.prompt));
    const quests = data.quests.filter((q) => ok(q.title, q.state));
    const libTotal = data.library.reduce((n, c) => n + c.names.length, 0);

    body.append(h('div', { class: 'grid2' },
      h('div', { class: 'col' },
        section('Spells', `${data.spells.length} by wheel category`,
          cats.length ? cats.map((c) => h('div', { class: 'cheat-sec', style: { marginTop: c === cats[0] ? 0 : '14px' } }, h('h3', null, titleCase(c), h('span', { class: 'n' }, spells.filter((s) => s.category === c).length)),
            chips(spells.filter((s) => s.category === c).map((s) => chip(`${s.icon ? `${s.icon} ` : ''}${s.name}`, '', `${s.description || s.id} — click to copy the name`, async () => { await copyText(s.name); toast(`${s.name}: ${s.description || 'copied'}`, 'ok'); }, s.enabled ? '' : 'off'))))) : chips([]),
          h('p', { class: 'tiny faint', style: { marginTop: '10px' } }, 'In game: hold A (or E) for the wheel, point at a category, release on a spell. Struck-through spells are disabled creations.')),
        section('Creations', `${creations.length} of ${data.creations.length}`, chips(creations.map((c) => chip(c.title || c.name.replace(/\.js(\.off)?$/, ''), c.name.endsWith('.off') ? 'disabled' : '', c.description || c.name, () => app.go(`creations/${encodeURIComponent(c.name)}`), c.enabled ? '' : 'off')))),
        section('Library', `${libTotal} things${data.libraryUnlisted ? ` (+${data.libraryUnlisted} built at game start)` : ''}`,
          lib.map((c) => h('div', { class: 'cheat-sec' }, h('h3', null, c.title, h('span', { class: 'n' }, c.names.length)), chips(c.names.map((n) => chip(n, '', `Ask him to summon ${n}`, () => app.wish(`summon ${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n.replace(/-/g, ' ')}`)))))),
          lib.length ? null : chips([]))),
      h('div', { class: 'col' },
        section('Keyboard & mouse', 'desktop', keyGrid()),
        section('Places already dreamed up', `${places.length}`, chips(places.map((p) => chip(p.name || p.slug, '', `${p.prompt}\nClick: ask him to take you there`, () => app.wish(`take me to ${(p.name || p.slug).toLowerCase()}`)))), h('p', { class: 'tiny faint', style: { marginTop: '8px' } }, 'Cached places load instantly; a new one takes minutes to generate.')),
        section('Blasted scenes', `${blasts.length}`, blasts.length ? chips(blasts.map((b) => chip(b.name || b.slug, '', b.caption || b.prompt, () => app.go(`assets/blasts/${encodeURIComponent(b.slug)}`)))) : h('p', { class: 'dim small' }, 'None yet: drop a picture on the Settings tab.')),
        section('Conjured models', `${models.length}`, models.length ? chips(models.map((m) => chip(m.prompt || m.slug, '', 'Open the 3D preview', () => app.go(`assets/models/${encodeURIComponent(m.slug)}`)))) : h('p', { class: 'dim small' }, 'None yet: ask him to "conjure a clay teapot".')),
        section('Quests', `${quests.length}`, quests.length ? h('div', { class: 'list' }, quests.map((q) => h('div', { class: 'item' }, h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, q.title, q.kind === 'bounty' ? h('span', { class: 'badge info' }, 'bounty') : null)), h('span', { class: `badge ${q.state === 'done' ? 'ok' : q.state === 'active' ? 'gold' : ''}` }, q.state)))) : h('p', { class: 'dim small' }, 'No quests started in the saved profile.')))));
  }

  function asText() {
    if (!data) return '';
    const L = ['OMNISSIAH CHEAT SHEET', ''];
    L.push('SPELLS'); for (const c of CAT_ORDER.concat([...new Set(data.spells.map((s) => s.category))].filter((c) => !CAT_ORDER.includes(c)))) { const s = data.spells.filter((x) => x.category === c); if (s.length) L.push(`  ${titleCase(c)}: ${s.map((x) => x.name).join(', ')}`); }
    L.push('', 'CREATIONS', `  ${data.creations.map((c) => c.title || c.name).join(', ')}`, '', 'LIBRARY'); for (const c of data.library) L.push(`  ${c.title}: ${c.names.join(', ')}`);
    L.push('', 'PLACES', `  ${data.places.map((p) => p.name || p.slug).join(', ')}`, '', 'BLASTED SCENES', `  ${data.blasts.map((p) => p.name || p.slug).join(', ') || '-'}`);
    L.push('', 'KEYS', '  W A S D move · Shift sprint · Space/Q jump · arrows turn · mouse look/cast/grab · E spell wheel · G grab · T hold to talk · N tap to talk · M menu · V enter VR');
    return L.join('\n');
  }
  paint();
  return { show() { load(); } };
}
