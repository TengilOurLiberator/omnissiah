// Player & progress: the saved profile (saves/profile.json via the save plugin's save_get), quests, and export / import / reset.
import { h, icon, clear, fmtNum, fmtDuration, fmtDate, fmtAgo, prettify, toast, confirmDialog, emptyState } from '../dom.js';

const xpForLevel = (L) => (L <= 1 ? 0 : Math.round(140 * Math.pow(L - 1, 1.65)));   // same curve as core/quests.js
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const top = (obj, n = 8) => Object.entries(isObj(obj) ? obj : {}).filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1]).slice(0, n);

export default function mount(root, app) {
  const { net } = app;
  let profile, loadedAt = 0, err = null;
  const body = h('div');
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Choose a save file to import', on: { change: onFile } });
  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Player & progress'), h('p', null, 'The saved profile of whoever plays on this PC: level, favour, titles, stats and quests. Read live from the save file.'))),
    body, fileInput);

  // ---------------------------------------------------------------- data
  function request() {
    return new Promise((resolve) => {
      if (net.state !== 'open') return resolve({ error: 'Not connected to the server.' });
      const off = net.on('save_data', (m) => { if (m.key === 'profile') { off(); clearTimeout(t); resolve(m); } });
      const t = setTimeout(() => { off(); resolve({ error: 'The server did not answer. Is the save plugin loaded?' }); }, 3500);
      net.send({ type: 'save_get', key: 'profile' });
    });
  }
  async function load() {
    const m = await request();
    err = m.error ?? null; profile = m.error ? profile : m.data; loadedAt = Date.now();
    paint();
  }
  net.on('save_data', (m) => { if (m.key === 'profile' && !root.hidden && m.data !== undefined && loadedAt && Date.now() - loadedAt > 400) { profile = m.data; loadedAt = Date.now(); paint(); } });
  net.on('plugin', load); net.on('state', (s) => { if (s === 'open') load(); });
  const poll = setInterval(() => { if (!root.hidden && !document.hidden) load(); }, 10000);

  // ---------------------------------------------------------------- view
  const stat = (label, value) => h('div', { class: 'stat' }, h('b', null, value), h('span', null, label));
  function table(title, rows, unit = 'times') {
    return h('section', { class: 'card' }, h('h2', { class: 'card-title' }, title),
      rows.length ? h('table', { class: 'tbl' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('td', null, prettify(k)), h('td', { class: 'num' }, fmtNum(v)))))) : h('p', { class: 'dim small' }, `Nothing ${unit} yet.`));
  }
  function questRows(p) {
    const defs = { ...(isObj(p.offered) ? p.offered : {}), ...(isObj(p.gen) ? p.gen : {}) };
    const out = [];
    for (const [id, q] of Object.entries(isObj(p.q) ? p.q : {})) {
      const def = defs[id];
      const steps = Array.isArray(def?.steps) ? def.steps : null;
      const idx = Number(q.i) || 0;
      const step = steps?.[Math.min(idx, steps.length - 1)];
      const prog = Array.isArray(q.p) ? q.p[idx] : null;
      out.push({ id, state: q.s, title: def?.title ?? prettify(id), kind: def?.kind ?? (id.startsWith('b') && def ? 'bounty' : 'story'), text: q.s === 'done' ? 'Completed' : step ? `${step.text ?? step.type}${step.count > 1 ? ` (${prog ?? 0}/${step.count})` : ''}` : `Step ${idx + 1}`, reward: def?.rewards });
    }
    return out;
  }
  function paint() {
    clear(body);
    if (err && !profile) return body.append(emptyState('Cannot read the profile', err));
    if (!isObj(profile)) return body.append(emptyState('No saved profile yet', 'It is created the first time someone plays and the game sends its first save.'));
    const p = profile, s = isObj(p.stats) ? p.stats : {};
    const L = Math.max(1, Number(p.level) || 1), xp = Number(p.xp) || 0;
    const lo = xpForLevel(L), hi = xpForLevel(L + 1), pct = L >= 60 ? 100 : Math.max(0, Math.min(100, ((xp - lo) / Math.max(1, hi - lo)) * 100));
    const favour = Math.max(0, Math.min(100, Number(p.favour) || 0));
    const titles = Array.isArray(p.titles) ? p.titles : [];
    const quests = questRows(p);

    body.append(
      h('div', { class: 'grid2' },
        h('div', { class: 'col' },
          h('section', { class: 'card' },
            h('div', { class: 'level-hero' },
              h('div', { class: 'level-badge', 'aria-label': `Level ${L}` }, h('div', null, h('b', null, String(L)), h('span', null, 'Level'))),
              h('div', { class: 'grow stack', style: { minWidth: '220px' } },
                h('div', null, h('div', { style: { fontSize: '20px', fontWeight: 650 } }, p.title ? prettify(p.title) : 'Wanderer'), h('div', { class: 'small dim' }, `${fmtNum(Math.round(xp))} XP${L >= 60 ? ' (max level)' : ` · ${fmtNum(Math.max(0, hi - xp))} to level ${L + 1}`}`)),
                h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'Experience towards the next level', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: `${pct}%` } })),
                h('div', { class: 'row small' }, h('span', { class: 'dim' }, 'Omnissiah\'s favour'), h('span', { class: 'right gold' }, `${favour.toFixed(1)} / 100`)),
                h('div', { class: 'meter cyan', role: 'progressbar', 'aria-label': 'Favour', 'aria-valuenow': Math.round(favour), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: `${favour}%` } })))),
            h('hr', { class: 'sep' }),
            h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Titles'),
            titles.length ? h('div', { class: 'chips' }, titles.map((t) => h('span', { class: `badge ${t === p.title ? 'gold' : ''}` }, prettify(t)))) : h('span', { class: 'dim small' }, 'None yet'),
            h('p', { class: 'tiny faint', style: { marginTop: '12px' } }, `Profile ${p.id ?? '?'} · created ${p.created ? fmtDate(p.created) : '?'} · last saved ${p.updated ? fmtAgo(p.updated) : '?'}`)),
          h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Stats'),
            h('div', { class: 'stat-grid' },
              stat('Enemies slain', fmtNum(s.kills ?? 0)), stat('Bosses', fmtNum(s.bosses ?? 0)), stat('Deaths', fmtNum(s.deaths ?? 0)), stat('Wishes made', fmtNum(s.wishes ?? 0)),
              stat('Things summoned', fmtNum(s.summoned ?? 0)), stat('Models conjured', fmtNum(s.models ?? 0)), stat('Creations', fmtNum(s.creations ?? 0)), stat('Things broken', fmtNum(s.broken ?? 0)),
              stat('Trees felled', fmtNum(s.felled ?? 0)), stat('Spells cast', fmtNum(s.spellCasts ?? 0)), stat('Conversations', fmtNum(s.talks ?? 0)), stat('Quests done', fmtNum(s.quests ?? 0)),
              stat('Walked', `${((s.walked ?? 0) / 1000).toFixed(2)} km`), stat('Flown', `${((s.flown ?? 0) / 1000).toFixed(2)} km`), stat('Driven', `${((s.driven ?? 0) / 1000).toFixed(2)} km`), stat('Time played', fmtDuration(s.playSec ?? 0)),
              stat('Sessions', fmtNum(s.sessions ?? 0)), stat('Flawless streak', fmtNum(s.streak ?? 0)))),
          h('div', { class: 'grid2 even', style: { marginTop: '16px' } }, table('Kills by enemy', top(s.killsBy)), table('Favourite spells', top(s.spells), 'cast'))),
        h('div', { class: 'col' },
          h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Quests & labours'),
            quests.length ? h('div', { class: 'list' }, quests.map((q) => h('div', { class: 'item' },
              h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, q.title, h('span', { class: `badge ${q.state === 'done' ? 'ok' : q.state === 'active' ? 'gold' : ''}` }, q.state === 'done' ? 'done' : q.state ?? '?'), q.kind === 'bounty' ? h('span', { class: 'badge info' }, 'bounty') : null),
                h('div', { class: 'item-sub wrap2' }, q.text), q.reward ? h('div', { class: 'item-sub tiny' }, `Reward: ${[q.reward.xp ? `${q.reward.xp} XP` : '', q.reward.favour ? `+${q.reward.favour} favour` : '', q.reward.title ? `title "${q.reward.title}"` : ''].filter(Boolean).join(', ')}`) : null)))) : h('p', { class: 'dim small' }, 'No quests started.')),
          table('Weapons used', top(s.weapons), 'used'),
          h('section', { class: 'card' },
            h('h2', { class: 'card-title' }, 'Save file'),
            h('p', { class: 'small dim', style: { marginBottom: '12px' } }, 'Back up the whole save, restore one, or start the journey over. A running game picks up an import or reset within a second. Reset and import keep the old file in D:\\omnissiah\\.trash\\saves.'),
            h('div', { class: 'row wrap' },
              h('button', { class: 'btn', type: 'button', on: { click: exportSave } }, icon('download', 16), 'Export save'),
              h('button', { class: 'btn needs-write', type: 'button', on: { click: () => fileInput.click() } }, icon('upload', 16), 'Import save…'),
              h('button', { class: 'btn danger needs-write', type: 'button', on: { click: resetSave } }, icon('restore', 16), 'Reset progress…'))))));
  }

  // ---------------------------------------------------------------- actions
  async function exportSave() {
    try {
      const d = await net.request('admin_save_export');
      const blob = new Blob([JSON.stringify(d.bundle, null, 2)], { type: 'application/json' });
      const t = new Date(), p2 = (n) => String(n).padStart(2, '0');
      const a = h('a', { href: URL.createObjectURL(blob), download: `omnissiah-save-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}.json` });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Exported ${Object.keys(d.bundle.keys).length} save entr${Object.keys(d.bundle.keys).length === 1 ? 'y' : 'ies'}.`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function onFile() {
    const f = fileInput.files?.[0]; fileInput.value = '';
    if (!f) return;
    if (f.size > 1024 * 1024) return toast('That file is too big to be a save (limit 1 MB).', 'error');
    let json;
    try { json = JSON.parse(await f.text()); } catch { return toast('That is not a JSON file.', 'error'); }
    const prof = json?.format === 'omnissiah-save' ? json.keys?.profile : json;
    const summary = isObj(prof) ? `Level ${prof.level ?? '?'}, ${fmtNum(Math.round(Number(prof.xp) || 0))} XP, favour ${Math.round(Number(prof.favour) || 0)}` : 'no profile inside';
    if (!(await confirmDialog({ title: 'Import this save?', text: `File: ${f.name} (${summary}). It replaces the current progress.`, detail: 'The current save is copied to the trash first.', confirm: 'Replace my progress', danger: true }))) return;
    try { const r = await net.write('admin_save_import', { bundle: json }); toast(`Imported: ${r.imported.join(', ')}`, 'ok'); setTimeout(load, 600); } catch (e) { toast(e.message, 'error'); }
  }
  async function resetSave() {
    if (!(await confirmDialog({ title: 'Reset all progress?', text: 'Level, XP, favour, titles, stats and quests go back to a brand-new player.', confirm: 'Continue', danger: true }))) return;
    if (!(await confirmDialog({ title: 'Really reset? This cannot be undone from here.', text: 'Your current save is kept in D:\\omnissiah\\.trash\\saves, but the game starts again from level 1 right now.', confirm: 'Yes, reset everything', danger: true }))) return;
    try { await net.write('admin_save_reset'); toast('Progress reset.', 'ok'); setTimeout(load, 600); } catch (e) { toast(e.message, 'error'); }
  }

  paint();
  return { show() { load(); }, destroy() { clearInterval(poll); } };
}
