// Generated assets: conjured models (3D preview), places (360 preview), blast projects, and sounds / music (play).
import { h, icon, clear, append, fmtBytes, fmtAgo, toast, confirmDialog, emptyState, copyText, modal, debounce, fmtDuration } from '../dom.js';

const GEN = '/assets/generated';
const SECTIONS = [['models', 'Models'], ['places', 'Places'], ['blasts', 'Blasts'], ['audio', 'Audio']];

async function fetchJson(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}
const hue = (s) => { let x = 7; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const byNewest = (a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0);
const when = (iso) => { const t = Date.parse(iso); return t ? fmtAgo(t) : ''; };

export default function mount(root, app) {
  const { net } = app;
  let section = 'models', query = '';
  const data = { models: null, places: null, blasts: null, audio: null };
  let openViewer = null;

  const body = h('div');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search prompts and names', 'aria-label': 'Search assets', on: { input: debounce((e) => { query = e.target.value.trim().toLowerCase(); paint(); }, 90) } });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Asset type' }, SECTIONS.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': 'false', data: { id }, on: { click: () => app.go(`assets/${id}`) } }, label)));
  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Generated assets'), h('p', null, 'Everything the Omnissiah has conjured on the PC: 3D models, 360° places, blasted pictures and sounds. Click to preview; deleting moves files to .trash, never erases them.'))),
    h('div', { class: 'row wrap', style: { marginBottom: '14px' } }, seg, h('div', { class: 'searchbox', style: { maxWidth: '380px' } }, icon('search', 16), search)),
    body);

  // ---------------------------------------------------------------- loading
  async function load(which, force) {
    if (data[which] && !force) return;
    if (which === 'models') { const j = await fetchJson(`${GEN}/index.json`); data.models = Object.entries(j ?? {}).map(([slug, v]) => ({ slug, ...v })).sort(byNewest); data.modelsMissing = j === null; }
    if (which === 'places') { const j = await fetchJson(`${GEN}/places/index.json`); data.places = Object.entries(j ?? {}).map(([slug, v]) => ({ slug, ...v })).sort(byNewest); data.placesMissing = j === null; }
    if (which === 'blasts') {
      let list = null;
      if (net.state === 'open') { list = await new Promise((resolve) => { const off = net.on('blast_list', (m) => { off(); resolve(m.projects); }); net.send({ type: 'blast_list' }); setTimeout(() => { off(); resolve(null); }, 2500); }); }
      if (!Array.isArray(list)) { const j = await fetchJson(`${GEN}/blasts/index.json`); list = j ? Object.entries(j).map(([slug, v]) => ({ slug, ...v })) : null; }
      data.blasts = (list ?? []).sort(byNewest); data.blastsMissing = list === null;
    }
    if (which === 'audio') {
      let present = null; // ask the plugin which indexes exist, so missing ones do not become 404s in the console
      if (net.hasPlugin === true) { try { present = await net.request('admin_assets_present', {}, { timeout: 3000 }); } catch { /* fetch blindly */ } }
      const get = (key, url) => (present && !present[key] ? Promise.resolve(null) : fetchJson(url));
      const [pack, sfx, music] = await Promise.all([get('pack', `${GEN}/audio/pack.json`), get('sfx', `${GEN}/audio/sfx/index.json`), get('music', `${GEN}/audio/music/index.json`)]);
      data.audio = { pack: Object.entries(pack ?? {}).map(([name, v]) => ({ name, ...v })), sfx: Object.entries(sfx ?? {}).map(([slug, v]) => ({ slug, ...v })).sort(byNewest), music: Object.entries(music ?? {}).map(([slug, v]) => ({ slug, ...v })).sort(byNewest) };
    }
  }

  // ---------------------------------------------------------------- shared card bits
  const matches = (...fields) => !query || fields.join(' ').toLowerCase().includes(query);
  const canDelete = () => net.hasPlugin === true;
  async function copyPrompt(p) { toast((await copyText(p)) ? 'Prompt copied' : 'Copy failed', 'ok'); }
  async function del(kind, slug, label) {
    if (!(await confirmDialog({ title: `Delete ${label}?`, text: 'The files are moved to D:\\omnissiah\\.trash\\assets with a note on how to restore them. The game stops seeing them immediately.', confirm: 'Move to trash', danger: true }))) return false;
    try { await net.write('admin_asset_delete', { kind, slug }); toast(`${label} moved to the trash`, 'ok'); data[kind === 'model' ? 'models' : kind === 'place' ? 'places' : kind === 'blast' ? 'blasts' : 'audio'] = null; await load(section, true); paint(); return true; } catch (err) { toast(err.message, 'error'); return false; }
  }
  const actions = (...btns) => h('div', { class: 'asset-actions' }, btns);
  const smallBtn = (label, ic, fn, extra = '') => h('button', { class: `btn sm ${extra}`, type: 'button', on: { click: fn } }, icon(ic, 14), label);
  function closeViewer() { try { openViewer?.dispose(); } catch { /* gone */ } openViewer = null; }

  // ---------------------------------------------------------------- models
  function modelCard(m) {
    const a = hue(m.slug);
    return h('article', { class: 'asset' },
      h('button', { class: 'asset-thumb', type: 'button', 'aria-label': `Preview ${m.prompt ?? m.slug} in 3D`, style: { background: `radial-gradient(circle at 50% 38%, hsl(${a} 55% 38%), hsl(${(a + 40) % 360} 60% 12%))` }, on: { click: () => app.go(`assets/models/${encodeURIComponent(m.slug)}`) } },
        icon('cube', 54), h('span', { class: 'tag badge gold' }, m.quality ?? 'model')),
      h('div', { class: 'asset-body' },
        h('h3', { title: m.prompt }, m.prompt ?? m.slug),
        h('div', { class: 'asset-meta' }, m.triangles ? h('span', { class: 'badge' }, `${Math.round(m.triangles / 1000)}k tris`) : null, m.bytes ? h('span', { class: 'badge' }, fmtBytes(m.bytes)) : null, h('span', { class: 'badge', 'data-ago': Date.parse(m.created) || 0 }, when(m.created))),
        actions(smallBtn('Preview 3D', 'eye', () => app.go(`assets/models/${encodeURIComponent(m.slug)}`), 'primary'), smallBtn('Prompt', 'copy', () => copyPrompt(m.prompt ?? '')),
          canDelete() ? h('button', { class: 'icon-btn needs-write', type: 'button', title: 'Delete', 'aria-label': `Delete ${m.slug}`, on: { click: () => del('model', m.slug, m.prompt ?? m.slug) } }, icon('trash', 16)) : null)));
  }
  function showModel(slug) {
    const m = data.models?.find((x) => x.slug === slug);
    if (!m) return toast('That model is not in the index.', 'error');
    const stage = h('div', { class: 'viewer' }, h('div', { class: 'overlay' }, 'Loading model…'), h('div', { class: 'hint' }, 'Drag to orbit · scroll to zoom · right-drag to pan'));
    const info = h('div', { class: 'asset-meta' }, m.triangles ? h('span', { class: 'badge' }, `${m.triangles.toLocaleString('en-US')} triangles`) : null, m.bytes ? h('span', { class: 'badge' }, fmtBytes(m.bytes)) : null, m.texture ? h('span', { class: 'badge' }, `${m.texture}px texture`) : null, m.seconds ? h('span', { class: 'badge' }, `made in ${fmtDuration(m.seconds)}`) : null);
    const dlg = modal({ title: m.prompt ?? m.slug, wide: true, onClose: () => { closeViewer(); if (location.hash.startsWith('#assets/models/')) history.replaceState(null, '', '#assets/models'); },
      body: [stage, info, h('div', { class: 'small dim mono' }, m.url ?? ''), h('p', { class: 'small' }, h('span', { class: 'dim' }, 'Prompt: '), m.prompt ?? '')],
      actions: [h('a', { class: 'btn', href: m.url, download: `${m.slug}.glb` }, icon('download', 15), 'Download .glb'), h('button', { class: 'btn', type: 'button', on: { click: () => copyPrompt(m.prompt ?? '') } }, icon('copy', 15), 'Copy prompt')] });
    import('../viewer.js').then(({ modelViewer }) => modelViewer(stage, m.url, { onInfo: (i) => { stage.querySelector('.overlay')?.remove(); append(info, [h('span', { class: 'badge info' }, `${i.size.map((n) => n.toFixed(2)).join(' × ')} m`), i.clips ? h('span', { class: 'badge info' }, `${i.clips} animation${i.clips > 1 ? 's' : ''}`) : null]); } }))
      .then((v) => { if (!dlg.isConnected) v.dispose(); else openViewer = v; })
      .catch((err) => { const o = stage.querySelector('.overlay'); if (o) o.textContent = `Cannot show this model: ${err?.message ?? err}`; });
  }

  // ---------------------------------------------------------------- places
  const swatch = (c) => h('i', { title: c, style: { display: 'inline-block', width: '16px', height: '16px', borderRadius: '5px', background: /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#333', border: '1px solid rgba(255,255,255,.2)' } });
  function placeCard(p) {
    const cols = [p.meta?.sky?.zenith, p.meta?.sky?.horizon, p.meta?.ground?.mid, p.meta?.sea].filter(Boolean);
    return h('article', { class: 'asset' },
      h('button', { class: 'asset-thumb', type: 'button', 'aria-label': `Preview ${p.name ?? p.slug} in 360 degrees`, on: { click: () => app.go(`assets/places/${encodeURIComponent(p.slug)}`) } }, h('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async' }), h('span', { class: 'tag badge gold' }, '360°')),
      h('div', { class: 'asset-body' },
        h('h3', { title: p.name }, p.name ?? p.slug),
        h('p', { title: p.prompt }, p.prompt ?? ''),
        h('div', { class: 'row', style: { gap: '4px' } }, cols.map(swatch), h('span', { class: 'badge right', 'data-ago': Date.parse(p.created) || 0 }, when(p.created))),
        actions(smallBtn('Look around', 'eye', () => app.go(`assets/places/${encodeURIComponent(p.slug)}`), 'primary'), smallBtn('Prompt', 'copy', () => copyPrompt(p.prompt ?? '')),
          canDelete() ? h('button', { class: 'icon-btn needs-write', type: 'button', title: 'Delete', 'aria-label': `Delete ${p.slug}`, on: { click: () => del('place', p.slug, p.name ?? p.slug) } }, icon('trash', 16)) : null)));
  }
  function showPlace(slug) {
    const p = data.places?.find((x) => x.slug === slug);
    if (!p) return toast('That place is not in the index.', 'error');
    const stage = h('div', { class: 'viewer' }, h('div', { class: 'overlay' }, 'Loading panorama…'), h('div', { class: 'hint' }, 'Drag to look around · scroll to zoom'));
    const sun = p.meta?.sun;
    const dlg = modal({ title: p.name ?? p.slug, wide: true, onClose: () => { closeViewer(); if (location.hash.startsWith('#assets/places/')) history.replaceState(null, '', '#assets/places'); },
      body: [stage, h('p', { class: 'small' }, h('span', { class: 'dim' }, 'Prompt: '), p.prompt ?? ''),
        h('div', { class: 'asset-meta' }, p.seed != null ? h('span', { class: 'badge' }, `seed ${p.seed}`) : null, sun ? h('span', { class: 'badge' }, `sun ${Math.round(sun.elevation)}° high`) : null, p.meta?.fog ? h('span', { class: 'badge' }, `fog ${p.meta.fog.density}`) : null)],
      actions: [h('a', { class: 'btn', href: p.hi ?? p.url, target: '_blank', rel: 'noopener' }, icon('eye', 15), 'Open full image'), h('button', { class: 'btn', type: 'button', on: { click: () => copyPrompt(p.prompt ?? '') } }, icon('copy', 15), 'Copy prompt')] });
    import('../viewer.js').then(({ panoViewer }) => panoViewer(stage, p.url)).then((v) => { stage.querySelector('.overlay')?.remove(); if (!dlg.isConnected) v.dispose(); else openViewer = v; })
      .catch((err) => { const o = stage.querySelector('.overlay'); if (o) o.textContent = `Cannot show this place: ${err?.message ?? err}`; });
  }

  // ---------------------------------------------------------------- blasts
  function blastCard(b) {
    return h('article', { class: 'asset' },
      h('button', { class: 'asset-thumb', type: 'button', 'aria-label': `Details of ${b.name ?? b.slug}`, on: { click: () => app.go(`assets/blasts/${encodeURIComponent(b.slug)}`) } }, b.thumb ? h('img', { src: b.thumb, alt: '', loading: 'lazy', decoding: 'async' }) : icon('blast', 54), h('span', { class: 'tag badge gold' }, b.place ? 'place' : 'blast')),
      h('div', { class: 'asset-body' },
        h('h3', { title: b.name }, b.name ?? b.slug),
        h('p', { title: b.caption ?? b.prompt }, b.caption ?? b.prompt ?? ''),
        h('div', { class: 'asset-meta' }, h('span', { class: 'badge' }, `${b.objects ?? 0} object${b.objects === 1 ? '' : 's'}`), b.seconds ? h('span', { class: 'badge' }, fmtDuration(b.seconds)) : null, h('span', { class: 'badge', 'data-ago': Date.parse(b.created) || 0 }, when(b.created))),
        actions(smallBtn('Details', 'eye', () => app.go(`assets/blasts/${encodeURIComponent(b.slug)}`), 'primary'), smallBtn('Prompt', 'copy', () => copyPrompt(b.prompt ?? '')),
          canDelete() ? h('button', { class: 'icon-btn needs-write', type: 'button', title: 'Delete', 'aria-label': `Delete ${b.slug}`, on: { click: () => del('blast', b.slug, b.name ?? b.slug) } }, icon('trash', 16)) : null)));
  }
  async function showBlast(slug) {
    const b = data.blasts?.find((x) => x.slug === slug);
    if (!b) return toast('That blast is not in the index.', 'error');
    const base = `${GEN}/blasts/${encodeURIComponent(slug)}`;
    const [man, proj] = await Promise.all([fetchJson(`${base}/manifest.json`), fetchJson(`${base}/project.json`)]);
    const objs = man?.objects ?? [];
    const warnings = proj?.warnings ?? [];
    modal({ title: b.name ?? slug, wide: true, onClose: () => { closeViewer(); if (location.hash.startsWith('#assets/blasts/')) history.replaceState(null, '', '#assets/blasts'); },
      body: [
        h('p', { class: 'small' }, h('span', { class: 'dim' }, 'Prompt: '), man?.prompt ?? b.prompt ?? ''),
        h('div', { class: 'compare' }, man?.image ?? b.image ? figure(man?.image ?? b.image, 'Source picture') : null, man?.plate ? figure(man.plate, 'Clean plate (objects removed)') : null),
        man?.setting ? h('p', { class: 'small dim' }, `${man.setting.kind ?? ''} · ${man.setting.time_of_day ?? ''} · ${man.setting.ground ?? ''}`) : null,
        h('h3', { class: 'card-title', style: { marginTop: '6px' } }, `Objects (${objs.length})`),
        objs.length ? h('div', { class: 'thumbs' }, objs.map((o) => h('figure', null, o.reference ? h('img', { src: o.reference, alt: '', loading: 'lazy' }) : h('div', { class: 'empty' }, 'no picture'), h('figcaption', { title: o.name }, o.name ?? o.id), o.url ? h('button', { class: 'btn sm', type: 'button', on: { click: () => viewObject(o) } }, icon('cube', 13), 'View 3D') : h('span', { class: 'badge' }, 'not built')))) : h('p', { class: 'dim small' }, 'No objects were extracted.'),
        warnings.length ? h('div', { class: 'banner warn', style: { marginTop: '4px' } }, icon('lock', 15), h('span', null, warnings.join(' · '))) : null,
        proj?.timings ? h('p', { class: 'tiny faint' }, Object.entries(proj.timings).map(([k, v]) => `${k} ${fmtDuration(v)}`).join(' · ')) : null,
      ].filter(Boolean),
      actions: [h('button', { class: 'btn', type: 'button', on: { click: () => copyPrompt(b.prompt ?? '') } }, icon('copy', 15), 'Copy prompt')] });
  }
  const figure = (src, cap) => h('figure', { style: { margin: 0, display: 'grid', gap: '4px' } }, h('img', { src, alt: cap, loading: 'lazy', style: { width: '100%', borderRadius: '10px', border: '1px solid var(--edge)' } }), h('figcaption', { class: 'tiny dim' }, cap));
  function viewObject(o) {
    const stage = h('div', { class: 'viewer' }, h('div', { class: 'overlay' }, 'Loading model…'));
    modal({ title: o.name ?? o.id, wide: true, onClose: closeViewer, body: [stage] });
    import('../viewer.js').then(({ modelViewer }) => modelViewer(stage, o.url, { onInfo: () => stage.querySelector('.overlay')?.remove() })).then((v) => { openViewer = v; }).catch((e) => { const ov = stage.querySelector('.overlay'); if (ov) ov.textContent = `Cannot show this model: ${e?.message ?? e}`; });
  }

  // ---------------------------------------------------------------- audio
  const player = new Audio(); let playingKey = null, playingBtn = null;
  player.addEventListener('ended', stopPlay); player.addEventListener('error', () => { if (playingKey) toast('That sound could not be played.', 'error'); stopPlay(); });
  function stopPlay() { playingBtn?.setAttribute('aria-pressed', 'false'); if (playingBtn?.classList.contains('play')) playingBtn.replaceChildren(icon('play', 16)); playingKey = null; playingBtn = null; try { player.pause(); } catch { /* idle */ } }
  function playBtn(url, label, text) {
    const b = h('button', { class: text ? 'chip' : 'play', type: 'button', 'aria-pressed': 'false', 'aria-label': `Play ${label}`, title: 'Play / stop' }, text ? `▶ ${text}` : icon('play', 16));
    b.addEventListener('click', () => {
      if (playingKey === url) return stopPlay();
      stopPlay(); player.src = url; player.volume = 0.8;
      player.play().then(() => { playingKey = url; playingBtn = b; b.setAttribute('aria-pressed', 'true'); if (b.classList.contains('play')) b.replaceChildren(icon('stop', 16)); }).catch(() => toast('The browser blocked or could not play that file.', 'error'));
    });
    return b;
  }
  function audioPanel(a) {
    const frag = h('div', { class: 'stack' });
    const gen = (title, kind, rows) => h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon(kind === 'music' ? 'note' : 'bolt', 15), title),
      rows.length ? h('div', { class: 'list' }, rows.filter((r) => matches(r.slug, r.prompt)).map((r) => h('div', { class: 'item' }, playBtn(r.url, r.prompt ?? r.slug),
        h('div', { class: 'item-main' }, h('div', { class: 'item-title' }, r.prompt ?? r.slug), h('div', { class: 'item-sub tiny' }, [r.seconds ? `${r.seconds}s` : '', r.loop ? 'loop' : '', when(r.created)].filter(Boolean).join(' · '))),
        h('div', { class: 'item-actions' }, h('button', { class: 'icon-btn', type: 'button', title: 'Copy prompt', 'aria-label': 'Copy prompt', on: { click: () => copyPrompt(r.prompt ?? '') } }, icon('copy', 16)),
          canDelete() ? h('button', { class: 'icon-btn needs-write', type: 'button', title: 'Delete', 'aria-label': `Delete ${r.slug}`, on: { click: () => del(kind, r.slug, r.prompt ?? r.slug) } }, icon('trash', 16)) : null))))
        : emptyState(`No generated ${kind === 'music' ? 'music' : 'sound effects'} yet`, `They appear here once the Omnissiah (or a wish) generates some. The index file ${GEN}/audio/${kind}/index.json does not exist yet.`));
    const kinds = ['oneshot', 'loop', 'music', 'stinger'];
    const pack = a.pack.filter((p) => matches(p.name, p.kind));
    const packCard = h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('bolt', 15), `Starter pack (${a.pack.length})`),
      a.pack.length ? h('div', null, kinds.map((k) => { const rows = pack.filter((p) => p.kind === k); return rows.length ? h('div', null, h('h3', { class: 'label', style: { margin: '12px 0 4px', textTransform: 'capitalize' } }, `${k === 'oneshot' ? 'One-shots' : k === 'loop' ? 'Ambient loops' : k === 'music' ? 'Music' : 'Stingers'} (${rows.length})`),
        h('div', { class: 'list' }, rows.map((p) => h('div', { class: 'item' }, playBtn(p.url, p.name), h('div', { class: 'item-main' }, h('div', { class: 'item-title mono' }, p.name), h('div', { class: 'item-sub tiny' }, `${p.variants?.length ?? 1} variant${(p.variants?.length ?? 1) > 1 ? 's' : ''}${p.durations?.[0] ? ` · ${p.durations[0]}s` : ''}${p.bpm ? ` · ${p.bpm} bpm` : ''}`)),
          p.variants?.length > 1 ? h('div', { class: 'item-actions' }, p.variants.slice(1, 4).map((v, i) => playBtn(v, `${p.name} variant ${i + 2}`, `v${i + 2}`))) : null)))) : null; }))
        : emptyState('No starter pack found', `${GEN}/audio/pack.json is missing.`),
      h('p', { class: 'tiny faint', style: { marginTop: '8px' } }, 'The starter pack is part of the game and cannot be deleted here.'));
    frag.append(gen('Generated sound effects', 'sfx', a.sfx), gen('Generated music', 'music', a.music), packCard);
    return frag;
  }

  // ---------------------------------------------------------------- paint
  function paint() {
    clear(body);
    for (const b of seg.children) b.setAttribute('aria-pressed', b.dataset.id === section ? 'true' : 'false');
    const d = data[section];
    if (!d) return body.append(h('div', { class: 'loading' }, 'Loading…'));
    if (section === 'audio') return body.append(audioPanel(d));
    const rows = d.filter((x) => matches(x.slug, x.prompt, x.name, x.caption));
    const missing = data[`${section}Missing`];
    if (!d.length) return body.append(emptyState(missing ? 'Nothing generated yet' : `No ${section} yet`, section === 'models' ? 'Ask the Omnissiah to conjure something: "conjure a clay teapot".' : section === 'places' ? 'Ask him to take you somewhere: "take me to a volcanic island".' : 'Drop a picture on the Settings tab and blast it.'));
    if (!rows.length) return body.append(emptyState('Nothing matches that search', null));
    const card = { models: modelCard, places: placeCard, blasts: blastCard }[section];
    body.append(h('p', { class: 'small dim', style: { margin: '0 0 10px' } }, `${rows.length} of ${d.length}`), h('div', { class: 'gallery' }, rows.map(card)));
  }

  async function show(rest) {
    const sec = SECTIONS.some(([id]) => id === rest?.[0]) ? rest[0] : section;
    section = sec; paint();
    await load(sec); paint();
    const slug = rest?.[1];
    if (slug) { if (sec === 'models') showModel(slug); else if (sec === 'places') showPlace(slug); else if (sec === 'blasts') showBlast(slug); }
  }
  net.on('plugin', () => { if (!root.hidden && section === 'blasts') { data.blasts = null; load('blasts').then(paint); } });
  net.on('admin_event', (m) => { if (m.kind === 'changed' && m.what === 'asset' && !root.hidden) { data[section] = null; load(section, true).then(paint); } });
  net.on('gen3d_status', (m) => { if (m.state === 'done') data.models = null; });
  net.on('place_status', (m) => { if (m.state === 'done') data.places = null; });
  net.on('blast_status', (m) => { if (m.state === 'done') data.blasts = null; });
  return { show, hide() { stopPlay(); closeViewer(); } };
}
