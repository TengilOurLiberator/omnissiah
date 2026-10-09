// Library & spawn: the generated catalogue of ready-made things, with "spawn in front of the player".
import { h, icon, clear, toast, confirmDialog, emptyState, debounce } from '../dom.js';

export default function mount(root, app) {
  const { net } = app;
  let lib = { entries: [], categories: [], spawnCap: 12, spawnCount: 0 };
  let cat = 'all', query = '', count = 1, error = null, loaded = false;

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search the catalogue: goblin, tavern, rain, sword…', 'aria-label': 'Search the library', on: { input: debounce((e) => { query = e.target.value.trim().toLowerCase(); paintGrid(); }, 90) } });
  const chipBox = h('div', { class: 'chips', role: 'group', 'aria-label': 'Categories' });
  const countOut = h('output', { 'aria-live': 'polite' }, '1');
  const stepper = h('div', { class: 'stepper', role: 'group', 'aria-label': 'How many to spawn' },
    h('button', { type: 'button', 'aria-label': 'Fewer', on: { click: () => setCount(count - 1) } }, '−'), countOut, h('button', { type: 'button', 'aria-label': 'More', on: { click: () => setCount(count + 1) } }, '+'));
  const spawnInfo = h('span', { class: 'small dim' });
  const clearBtn = h('button', { class: 'btn sm danger needs-write', type: 'button', hidden: true, on: { click: clearAll } }, 'Clear all admin spawns');
  const grid = h('div', { class: 'lib-grid' });
  const unlistedNote = h('p', { class: 'small dim', style: { marginTop: '14px' }, hidden: true });
  const resultLabel = h('span', { class: 'small dim' });

  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Library & spawn'), h('p', null, 'The ready-made things the Omnissiah can summon in a heartbeat. Spawn one in front of the player to test, to show off, or to set a scene.'))),
    h('div', { class: 'sticky-bar' },
      h('div', { class: 'row wrap' }, h('div', { class: 'searchbox' }, icon('search', 16), search), h('span', { class: 'label' }, 'Spawn'), stepper, h('span', { class: 'label' }, 'at a time')),
      chipBox,
      h('div', { class: 'row wrap' }, resultLabel, h('span', { class: 'right row' }, spawnInfo, clearBtn))),
    grid,
    unlistedNote,
    h('p', { class: 'tiny faint', style: { marginTop: '16px' } }, 'Each spawn writes a small file named admin-spawn-N.js into the creations folder, so it shows up (and can be removed) on the Creations tab. Because creations load every time the game starts, spawns come back after a reload until you clear them. At most 12 at once.'));

  function setCount(n) { count = Math.max(1, Math.min(20, n)); countOut.textContent = String(count); }

  async function refresh() {
    if (net.state !== 'open' || net.hasPlugin !== true) { error = net.hasPlugin === false ? 'The admin plugin is not loaded on the server.' : 'Waiting for the server…'; paintAll(); return; }
    try { lib = await net.request('admin_library'); error = null; loaded = true; } catch (err) { error = err.message; }
    paintAll();
  }
  net.on('plugin', refresh);
  const soon = debounce(refresh, 400);
  net.on('admin_event', (m) => { if (m.kind === 'changed' && /^(spawn|creation|trash)$/.test(m.what)) soon(); });

  function paintChips() {
    clear(chipBox);
    const mk = (id, label, n) => h('button', { class: 'chip', type: 'button', 'aria-pressed': cat === id ? 'true' : 'false', on: { click: () => { cat = id; paintChips(); paintGrid(); } } }, label, h('span', { class: 'n' }, String(n)));
    chipBox.append(mk('all', 'All', lib.entries.length), ...lib.categories.map((c) => mk(c.id, c.title, c.count)));
  }
  function paintGrid() {
    clear(grid);
    if (!loaded) { grid.append(emptyState(error ? 'The catalogue is not available' : 'Loading the catalogue…', error)); resultLabel.textContent = ''; return; }
    if (!lib.entries.length) { grid.append(emptyState('The catalogue could not be read', 'The header comment of public/game/core/library.js has no entries the panel understands.')); return; }
    const rows = lib.entries.filter((e) => (cat === 'all' || e.category === cat) && (!query || `${e.name} ${e.description} ${e.options}`.toLowerCase().includes(query)));
    resultLabel.textContent = `${rows.length} thing${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) { grid.append(emptyState('Nothing matches that', 'Try a shorter word.')); return; }
    const frag = document.createDocumentFragment();
    const titleOf = (id) => lib.categories.find((c) => c.id === id)?.title ?? id;
    for (const e of rows) {
      frag.append(h('article', { class: 'lib-card' },
        h('h3', null, e.name, cat === 'all' ? h('span', { class: 'badge tiny' }, titleOf(e.category)) : null),
        h('p', null, e.description),
        e.options ? h('div', { class: 'opts' }, `options: ${e.options}`) : null,
        h('button', { class: 'btn sm primary needs-write', type: 'button', 'aria-label': `Spawn ${e.name} in front of the player`, on: { click: (ev) => spawn(e, ev.currentTarget) } }, icon('bolt', 14), count > 1 ? `Spawn ×${count}` : 'Spawn in front of player')));
    }
    grid.append(frag);
  }
  function paintStatus() {
    spawnInfo.textContent = `Admin spawns: ${lib.spawnCount}/${lib.spawnCap}`;
    unlistedNote.hidden = !lib.unlisted;
    unlistedNote.textContent = lib.unlisted ? `${lib.unlisted} more things (for example the weapon types) are built from lists when the game starts and cannot be read as text here. Ask for them by name, e.g. "give me a katana".` : '';
    clearBtn.hidden = !lib.spawnCount;
  }
  function paintAll() { paintChips(); paintGrid(); paintStatus(); }

  async function spawn(e, button) {
    button.disabled = true;
    try {
      const r = await net.write('admin_spawn', { name: e.name, count });
      toast(`${e.name}${count > 1 ? ` ×${count}` : ''} spawned (${r.name}). It appears in front of the player within a second or two.`, 'ok');
      lib.spawnCount = r.count; paintStatus();
    } catch (err) { toast(err.message, 'error'); } finally { button.disabled = false; }
  }
  async function clearAll() {
    if (!(await confirmDialog({ title: 'Clear all admin spawns?', text: `Removes the ${lib.spawnCount} spawn file(s) made from this tab; things they spawned vanish. The files go to the trash.`, confirm: 'Clear them', danger: true }))) return;
    try { const r = await net.write('admin_spawn_clear'); toast(`Cleared ${r.cleared} spawn(s).`, 'ok'); refresh(); } catch (err) { toast(err.message, 'error'); }
  }

  const stepWatch = new MutationObserver(() => paintGrid());
  stepWatch.observe(countOut, { childList: true, characterData: true, subtree: true });
  paintAll();
  return { show() { refresh(); } };
}
