// core/art.js — world.art: generated 2D art (icons, cards, portraits, title). Inert until asked: nothing is fetched at load.
//   Files: /assets/generated/art/** with the manifest art.json (array of {id, kind, file, w, h, prompt, group, name, alias?}); alias entries share another entry's file.
//   kinds: 'icon' (256x256: every spell id = world.spells id, 'cat-offence|control|movement|defence|summon|utility|favourites|recent', library things/weapons by name e.g. 'sword', 'chest'),
//          'card' (768x432: quest ids from core/quests.js, story chapters 'ch1'..'ch12' / 'intro', plus the card ids 'q-*' / 'chapter-*'), 'portrait' (512x512: 'hob', 'wren', 'quill', 'gorm', 'cassian', 'pip', ...),
//          'title' ('title-bg' 1920x1080, 'wordmark-bg' and 'wordmark' 1024x1024).
//   world.art.icon(id) | card(id) | portrait(id) | title(id = 'title-bg') -> THREE.Texture (sRGB, mipmapped) or null. Same id = same cached texture; the first call starts the load and
//       the texture fills in when its image arrives (a map can be assigned at once). null = unknown id, or the manifest is not loaded yet: the first call starts that load,
//       and `art:ready` is emitted when it is in (art.ready is the same as a Promise) — call again then. Do not dispose these textures yourself.
//   art.url(id, kind?) -> '/assets/generated/art/..' or null (kind omitted: icon, card, portrait, title in that order). art.has(id, kind?) -> bool (false until ready).
//   art.list(kind?) -> [{ id, kind, name, group, w, h, url, alias? }] ([] until ready; groups: spell|category|item, quest|chapter, npc, title|wordmark).
//   art.load(kind, id) -> Promise<THREE.Texture|null> (resolves when the image has arrived; never rejects). art.preload(kind, [ids]) -> Promise.
//   art.draw(g2d, id, x, y, w, h, kind = 'icon') -> bool: draws onto a 2D canvas context if the image has arrived (else starts the load and returns false; redraw on `art:loaded`).
//   art.release(kind, id) / art.flush() free textures (cards, portraits and titles are also evicted oldest-first beyond 10 of each). Events: `art:ready`, `art:loaded { kind, id }`.
export const meta = { name: 'Art', description: 'Generated icons, cards, portraits and title art as lazily loaded textures (world.art).' };

const BASE = '/assets/generated/art/';
const KINDS = ['icon', 'card', 'portrait', 'title'];
const KEEP = { icon: 200, card: 10, portrait: 10, title: 6 };

export default function (ctx) {
  const THREE = ctx.THREE;
  let manifest = null, mPromise = null, mFail = 0, disposed = false;
  const byKind = { icon: new Map(), card: new Map(), portrait: new Map(), title: new Map() };
  const tex = new Map();     // file -> { tex, kind, id, state: 'loading'|'ready'|'failed', t, promise }
  let loader = null;
  const emit = (n, p) => { try { ctx.events?.emit(n, p); } catch (e) { /* a listener threw */ } };

  const norm = (id) => {
    let s = String(id ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    if (s.startsWith('cat:')) s = 'cat-' + s.slice(4);
    return s;
  };

  function loadManifest() {
    if (manifest) return Promise.resolve(manifest);
    if (mPromise) return mPromise;
    if (performance.now() - mFail < 10000 && mFail) return Promise.resolve(null);
    mPromise = fetch(BASE + 'art.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('art.json ' + r.status); return r.json(); }).then((list) => {
      if (disposed) return null;
      const arr = Array.isArray(list) ? list : (Array.isArray(list?.items) ? list.items : []);
      for (const e of arr) { if (e && e.id && e.file && byKind[e.kind]) byKind[e.kind].set(norm(e.id), e); }
      manifest = arr;
      emit('art:ready', { count: arr.length });
      return arr;
    }).catch(() => { mFail = performance.now(); return null; }).finally(() => { mPromise = null; });
    return mPromise;
  }

  const entry = (kind, id) => (byKind[kind] ? byKind[kind].get(norm(id)) : undefined) || null;
  const urlOf = (e) => BASE + e.file;

  function evict(kind) {
    const mine = [];
    for (const r of tex.values()) if (r.kind === kind && r.state === 'ready') mine.push(r);
    if (mine.length <= KEEP[kind]) return;
    mine.sort((a, b) => a.t - b.t);
    for (let i = 0; i < mine.length - KEEP[kind]; i++) drop(mine[i]);
  }
  function drop(r) { tex.delete(r.file); try { r.tex.dispose(); } catch (e) { /* ignore */ } }

  function acquire(kind, id) {
    if (disposed) return null;
    if (!manifest) { loadManifest(); return null; }
    const e = entry(kind, id);
    if (!e) return null;
    let r = tex.get(e.file);
    if (r && r.state === 'failed') { if (performance.now() - r.t < 30000) return null; tex.delete(e.file); r = null; }
    if (r) { r.t = performance.now(); return r; }
    loader ||= new THREE.TextureLoader();
    const t = new THREE.Texture();
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.name = 'art:' + e.file;
    r = { file: e.file, tex: t, kind: e.kind, id: e.id, state: 'loading', t: performance.now(), promise: null };
    r.promise = new Promise((resolve) => {
      loader.load(urlOf(e), (loaded) => {
        if (disposed || tex.get(e.file) !== r) { try { loaded.dispose(); } catch (x) { /* ignore */ } resolve(null); return; }
        t.image = loaded.image; t.needsUpdate = true; r.state = 'ready'; r.t = performance.now();
        loaded.dispose(); // the loader's own Texture shell (the image lives on in t)
        emit('art:loaded', { kind: e.kind, id: e.id });
        evict(e.kind);
        resolve(t);
      }, undefined, () => { r.state = 'failed'; r.t = performance.now(); resolve(null); });
    });
    tex.set(e.file, r);
    return r;
  }

  const get = (kind, id) => { const r = acquire(kind, id); return r ? r.tex : null; };

  const api = {
    icon: (id) => get('icon', id),
    card: (id) => get('card', id),
    portrait: (id) => get('portrait', id),
    title: (id = 'title-bg') => get('title', id),
    get ready() { return loadManifest().then((m) => !!m); },
    url(id, kind) {
      if (!manifest) { loadManifest(); return null; }
      for (const k of kind ? [kind] : KINDS) { const e = entry(k, id); if (e) return urlOf(e); }
      return null;
    },
    has(id, kind) { if (!manifest) return false; for (const k of kind ? [kind] : KINDS) if (entry(k, id)) return true; return false; },
    list(kind) {
      if (!manifest) { loadManifest(); return []; }
      const out = [];
      for (const k of kind ? [kind] : KINDS) for (const e of byKind[k]?.values() || []) out.push({ id: e.id, kind: e.kind, name: e.name, group: e.group, w: e.w, h: e.h, url: urlOf(e), ...(e.alias ? { alias: e.alias } : {}) });
      return out;
    },
    async load(kind, id) {
      try {
        if (!manifest) await loadManifest();
        const r = acquire(kind, id);
        if (!r) return null;
        return r.state === 'ready' ? r.tex : await r.promise;
      } catch (e) { return null; }
    },
    preload(kind, ids) { return Promise.all((ids || []).map((id) => api.load(kind, id))); },
    draw(g, id, x, y, w, h, kind = 'icon') {
      const r = acquire(kind, id);
      if (!r || r.state !== 'ready') return false;
      try { g.drawImage(r.tex.image, x, y, w, h); return true; } catch (e) { return false; }
    },
    release(kind, id) { const e = manifest && entry(kind, id); const r = e && tex.get(e.file); if (r) drop(r); },
    flush() { for (const r of Array.from(tex.values())) drop(r); },
    stats() { let n = 0, ready = 0; for (const r of tex.values()) { n++; if (r.state === 'ready') ready++; } return { manifest: !!manifest, textures: n, ready }; },
  };

  ctx.provide('art', api);
  return {
    dispose() { disposed = true; api.flush(); },
  };
}
