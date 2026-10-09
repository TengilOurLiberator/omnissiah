// Creations manager: every file in public/game/creations, with source viewer, disable/enable/duplicate/remove, trash and snapshots.
import { h, icon, clear, fmtBytes, fmtAgo, fmtDate, toast, confirmDialog, emptyState, copyText, debounce } from '../dom.js';
import { highlight } from '../highlight.js';

const parseStamp = (s) => { const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null; };

export default function mount(root, app) {
  const { net } = app;
  let data = { items: [], trash: [], spawnCap: 12, spawnCount: 0 };
  let snaps = [];
  let filter = 'all', query = '', selected = null, loadedOnce = false, error = null;

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by file name or description', 'aria-label': 'Search creations', on: { input: debounce((e) => { query = e.target.value.trim().toLowerCase(); paintList(); }, 80) } });
  const FILTERS = [['all', 'All'], ['live', 'Loaded'], ['off', 'Disabled'], ['spawn', 'Admin spawns']];
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Filter creations' }, FILTERS.map(([id, label]) =>
    h('button', { type: 'button', 'aria-pressed': id === 'all' ? 'true' : 'false', on: { click: (e) => { filter = id; for (const b of seg.children) b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'); paintList(); } } }, label)));
  const listBox = h('div', { class: 'list' });
  const spawnBar = h('div', { class: 'row wrap small', hidden: true });
  const countLabel = h('span', { class: 'dim small right' });
  const viewer = h('section', { class: 'card', hidden: true, id: 'creation-viewer' });
  const trashBox = h('div', { class: 'list' });
  const snapBox = h('div', { class: 'stack' });

  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Creations'), h('p', null, 'Everything the Omnissiah (or you) has made lives in one file per thing. The game hot-reloads the moment a file changes. Nothing here is ever hard-deleted.'))),
    h('div', { class: 'grid2' },
      h('div', { class: 'col' },
        h('section', { class: 'card' },
          h('div', { class: 'row wrap', style: { marginBottom: '10px' } }, h('div', { class: 'searchbox' }, icon('search', 16), search), seg),
          h('div', { class: 'row wrap', style: { marginBottom: '6px' } }, spawnBar, countLabel),
          listBox),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('trash', 15), 'Trash'), trashBox, h('p', { class: 'tiny faint', style: { marginTop: '8px' } }, 'Removed files wait in D:\\omnissiah\\.trash\\creations. Restoring never overwrites a file with the same name.')),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('restore', 15), 'Snapshots'), snapBox)),
      h('div', { class: 'col' }, viewer)));

  // ---------------------------------------------------------------- data
  async function refresh() {
    if (net.state !== 'open' || net.hasPlugin !== true) { error = net.hasPlugin === false ? 'The admin plugin is not loaded on the server.' : 'Waiting for the server…'; paintAll(); return; }
    try {
      data = await net.request('admin_creations');
      error = null; loadedOnce = true;
      paintAll();
      net.request('admin_snapshots').then((d) => { snaps = d.items; paintSnaps(); }).catch(() => {});
    } catch (err) { error = err.message; paintAll(); }
  }
  const refreshSoon = debounce(refresh, 500);
  net.on('admin_event', (m) => { if (m.kind === 'changed' && /^(creation|trash|spawn|snapshot)$/.test(m.what)) refreshSoon(); });
  net.on('reload', refreshSoon);
  net.on('plugin', refresh);

  async function act(promise, ok) {
    try { const r = await promise; if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); await refresh(); return r; } catch (err) { toast(err.message, 'error'); }
  }

  // ---------------------------------------------------------------- list
  function statusBadge(it) {
    if (!it.enabled) return h('span', { class: 'badge' }, 'Disabled');
    if (it.loaded === false) return h('span', { class: 'badge warn', title: 'Not in the game\'s module list. Usually a syntax error (the Omnissiah is asked to repair these), or the file watcher has not caught up yet.' }, 'Not loaded');
    if (it.loaded === true) return h('span', { class: 'badge ok', title: 'Listed in /api/modules: the game loads this file.' }, 'Loaded');
    return null;
  }
  function visible(it) {
    if (filter === 'live' && !(it.enabled && it.loaded !== false)) return false;
    if (filter === 'off' && it.enabled) return false;
    if (filter === 'spawn' && !it.spawn) return false;
    if (query && !`${it.name} ${it.meta?.name ?? ''} ${it.meta?.description ?? ''}`.toLowerCase().includes(query)) return false;
    return true;
  }
  function paintList() {
    clear(listBox);
    const rows = data.items.filter(visible);
    countLabel.textContent = loadedOnce ? `${rows.length} of ${data.items.length} files` : '';
    if (error && !loadedOnce) return listBox.append(emptyState('Cannot list creations', error));
    if (!rows.length) return listBox.append(emptyState(data.items.length ? 'Nothing matches' : 'No creations yet', data.items.length ? 'Try another search or filter.' : 'Ask the Omnissiah for something and it appears here.'));
    for (const it of rows) {
      const title = it.meta?.name || it.name.replace(/\.js(\.off)?$/, '');
      listBox.append(h('div', { class: `item${it.enabled ? '' : ' off'}${selected === it.name ? ' sel' : ''}`, data: { name: it.name } },
        h('div', { class: 'item-main' },
          h('div', { class: 'item-title' }, title, h('span', { class: 'mono dim small' }, it.name), statusBadge(it), it.spawn ? h('span', { class: 'badge info' }, 'Admin spawn') : null),
          h('div', { class: 'item-sub', title: it.meta?.description ?? '' }, it.meta?.description || h('i', null, 'No description in the file.')),
          h('div', { class: 'item-sub tiny' }, `${fmtBytes(it.size)} · changed ${fmtAgo(it.mtime)}`)),
        h('div', { class: 'item-actions' },
          btn('eye', `View source of ${it.name}`, () => app.go(`creations/${encodeURIComponent(it.name)}`)),
          btn('power', it.enabled ? `Disable ${it.name}` : `Enable ${it.name}`, () => toggle(it), true),
          btn('copy', `Duplicate ${it.name}`, () => act(net.write('admin_creation_duplicate', { name: it.name }), (r) => `Duplicated as ${r.name}`), true),
          btn('trash', `Remove ${it.name}`, () => remove(it), true))));
    }
  }
  const btn = (ic, label, fn, write = false) => h('button', { class: `icon-btn${write ? ' needs-write' : ''}`, type: 'button', title: label, 'aria-label': label, on: { click: fn } }, icon(ic, 17));

  function toggle(it) { return act(net.write(it.enabled ? 'admin_creation_disable' : 'admin_creation_enable', { name: it.name }), it.enabled ? `${it.name} disabled (renamed to .off)` : `${it.name} enabled`); }
  async function remove(it) {
    const ok = await confirmDialog({ title: `Remove ${it.name}?`, text: 'It disappears from the game right away. The file is moved to the trash, so you can restore it from the Trash card below.', confirm: 'Move to trash', danger: true });
    if (ok) act(net.write('admin_creation_remove', { name: it.name }), `${it.name} moved to the trash`);
  }

  function paintSpawnBar() {
    clear(spawnBar); spawnBar.hidden = !data.spawnCount;
    if (!data.spawnCount) return;
    spawnBar.append(icon('bolt', 15), h('span', null, `${data.spawnCount} of ${data.spawnCap} admin spawns in the world`),
      h('button', { class: 'btn sm danger needs-write', type: 'button', on: { click: async () => { if (await confirmDialog({ title: 'Clear all admin spawns?', text: `Removes the ${data.spawnCount} spawn file(s) created from the Library tab. They go to the trash.`, confirm: 'Clear them', danger: true })) act(net.write('admin_spawn_clear'), (r) => `Cleared ${r.cleared} spawn(s)`); } } }, 'Clear all admin spawns'));
  }

  // ---------------------------------------------------------------- source viewer
  let viewing = null;
  async function view(name) {
    selected = name; paintList();
    clear(viewer); viewer.hidden = false;
    viewer.append(h('div', { class: 'loading' }, 'Loading source…'));
    try {
      const d = await net.request('admin_creation_get', { name });
      if (selected !== name) return;
      viewing = d;
      const it = data.items.find((i) => i.name === name);
      clear(viewer);
      viewer.append(
        h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, icon('eye', 15), it?.meta?.name || name),
          h('span', { class: 'right row' },
            h('button', { class: 'btn sm', type: 'button', on: { click: async () => toast((await copyText(d.text)) ? 'Source copied' : 'Copy failed', 'ok') } }, icon('copy', 14), 'Copy'),
            h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Close viewer', on: { click: () => app.go('creations') } }, icon('x', 14)))),
        h('div', { class: 'small dim', style: { marginBottom: '10px' } }, h('span', { class: 'mono' }, name), ` · ${fmtBytes(d.size)} · ${d.text.split('\n').length} lines · read-only`),
        ...(d.truncated ? [h('div', { class: 'banner warn', style: { marginTop: 0, marginBottom: '10px' } }, `Only the first ${fmtBytes(d.text.length)} are shown.`)] : []),
        h('div', { class: 'code', tabIndex: 0, role: 'region', 'aria-label': `Source of ${name}` }, highlight(d.text)));
      if (matchMedia('(max-width: 920px)').matches) viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { clear(viewer); viewer.append(emptyState('Cannot show this file', err.message)); }
  }
  function closeViewer() { selected = null; viewing = null; viewer.hidden = true; clear(viewer); paintList(); }

  // ---------------------------------------------------------------- trash + snapshots
  function paintTrash() {
    clear(trashBox);
    if (!data.trash.length) return trashBox.append(emptyState('Trash is empty', 'Removed creations wait here until you restore them.'));
    for (const t of data.trash) {
      const when = parseStamp(t.stamp);
      trashBox.append(h('div', { class: 'item' },
        h('div', { class: 'item-main' }, h('div', { class: 'item-title mono' }, t.name), h('div', { class: 'item-sub tiny' }, `${when ? `removed ${fmtAgo(when)} (${fmtDate(when)})` : t.stamp} · ${fmtBytes(t.size)}`)),
        h('div', { class: 'item-actions' }, h('button', { class: 'btn sm needs-write', type: 'button', on: { click: () => act(net.write('admin_trash_restore', { id: t.id }), (r) => `Restored as ${r.name}`) } }, icon('restore', 14), 'Restore'))));
    }
  }
  function paintSnaps() {
    clear(snapBox);
    snapBox.append(h('p', { class: 'small dim' }, 'Before every wish the game copies its code here (the newest 30 are kept). To go back as a whole, use Undo on the Live tab, which walks back one snapshot at a time. From here you can copy a single creation back out of a snapshot; it never overwrites a file that exists.'));
    if (!snaps.length) return snapBox.append(emptyState('No snapshots yet', 'They appear after the first wish.'));
    for (const s of snaps.slice(0, 30)) {
      const label = s.label.replace(/^before\s+/i, '');
      snapBox.append(h('details', { class: 'item', style: { display: 'block', padding: '8px 6px' } },
        h('summary', { style: { cursor: 'pointer', listStyle: 'revert' } },
          h('span', { class: 'item-title', style: { display: 'inline-flex' } }, label.length > 52 ? `${label.slice(0, 52)}…` : label),
          h('span', { class: 'dim small' }, ` · ${s.t ? fmtAgo(s.t) : ''}`),
          s.removedSince.length ? h('span', { class: 'badge warn', style: { marginLeft: '8px' } }, `${s.removedSince.length} missing now`) : null,
          s.addedSince.length ? h('span', { class: 'badge info', style: { marginLeft: '6px' } }, `${s.addedSince.length} added since`) : null),
        h('div', { class: 'stack', style: { marginTop: '8px' } },
          s.creations.length ? h('div', { class: 'chips' }, s.creations.map((n) => {
            const missing = s.removedSince.includes(n);
            return h('button', { class: `chip needs-write`, type: 'button', 'aria-pressed': missing ? 'true' : 'false', title: missing ? 'Missing from the game now: click to copy it back' : 'Click to copy this version back (as a new file)', on: { click: () => act(net.write('admin_snapshot_restore_creation', { snapshot: s.id, name: n }), (r) => `Copied back as ${r.name}`) } }, n);
          })) : h('span', { class: 'dim small' }, 'No creations in this snapshot.'),
          h('span', { class: 'tiny faint' }, 'Highlighted = no longer in the game.'))));
    }
  }
  function paintAll() { paintList(); paintSpawnBar(); paintTrash(); paintSnaps(); if (selected && viewer.hidden) viewer.hidden = false; }

  paintAll();
  return {
    show(rest) {
      const name = rest?.[0];
      if (name) view(name); else if (selected) closeViewer();
      refresh();
    },
  };
}
