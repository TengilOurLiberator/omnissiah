// headless test of core/genset.js against the REAL index.json with a mocked ctx; lib/gen.js is replaced by a recording stub (the real one is exercised in the browser test)
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'file:///D:/omnissiah/node_modules/three/build/three.module.js';

const ROOT = 'D:/omnissiah', OUT = 'D:/omnissiah/.cache/genset/t';
fs.mkdirSync(OUT, { recursive: true });
let src = fs.readFileSync(ROOT + '/public/game/core/genset.js', 'utf8');
src = src.replace("'/game/lib/gen.js'", "'./genstub.mjs'");
fs.writeFileSync(OUT + '/genset.copy.mjs', src);
fs.writeFileSync(OUT + '/genstub.mjs', `
export const calls = [];
export const gen = {
  url(ctx, id) { return '/u/' + id; }, preload(ctx, ids) { calls.push(['preload', ids]); return Promise.resolve([]); }, box() { return null; },
  spawn(ctx, id, o = {}) { const THREE = ctx.THREE; const g = new THREE.Group(); g.name = 'gen:' + id; (o.parent ?? ctx.root).add(g);
    const h = { id, object: g, loaded: false, error: null, remove() { g.removeFromParent(); h.removed = true; } };
    h.ready = Promise.resolve().then(() => { h.loaded = true; h.box = { x: 1, y: 1, z: 1 }; return h; }); calls.push(['spawn', id, o]); return h; },
  scatter(ctx, id, list, o = {}) { const THREE = ctx.THREE; const g = new THREE.Group(); (o.parent ?? ctx.root).add(g);
    const f = { id, object: g, count: list.length, loaded: false, error: null, remove() { g.removeFromParent(); } }; f.ready = Promise.resolve().then(() => { f.loaded = true; return f; }); calls.push(['scatter', id, list, o]); return f; },
};`);

let fetches = 0;
globalThis.fetch = async (url) => {
  fetches++;
  const p = ROOT + '/public' + url.split('?')[0];
  if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
};
const stub = await import('file:///' + OUT + '/genstub.mjs');
const mod = await import('file:///' + OUT + '/genset.copy.mjs');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));

function makeCtx(pc, withPhysics = true) {
  const world = {};
  const bodies = [];
  if (withPhysics) world.physics = { body(c, obj, o) { bodies.push({ pos: obj.position.clone(), rotY: obj.rotation.y, o }); const h = { removed: false, remove() { h.removed = true; } }; h.o = o; return h; } };
  world.groundHeight = (x, z) => 0.5 + 0.01 * x;
  world.isWater = (x, z) => (x - -30) ** 2 + (z - -78) ** 2 < 38 * 38;
  world.env = { waterLevel: -1.4 };
  const disposers = [];
  const ctx = { THREE, root: new THREE.Group(), world, state: {}, quality: { pc, tier: pc ? 'pc' : 'quest' }, events: { emit() {} }, groundAt: world.groundHeight, onDispose: (f) => disposers.push(f), provide(n, a) { world[n] = a; } };
  ctx.disposers = disposers; ctx.bodies = bodies;
  return ctx;
}

// 1. inert at load
const ctx = makeCtx(true);
const inst = mod.default(ctx);
eq(fetches, 0, 'nothing fetched at load');
ok(ctx.world.gen, 'world.gen provided');
const g = ctx.world.gen;
eq(g.find('mossy boulder'), null, 'find before ready returns null');
eq(g.loaded, false, 'not loaded yet');
await g.ready();
eq(fetches, 1, 'one fetch on first use');
ok(g.count() >= 360, 'count ' + g.count());
await g.ready(); eq(fetches, 1, 'cached');

// 2. find
const idx = JSON.parse(fs.readFileSync(ROOT + '/public/assets/generated/startzone/index.json', 'utf8'));
const byId = Object.fromEntries(idx.items.map((e) => [e.id, e]));
const t = (q, want) => { const r = g.find(q); ok(Array.isArray(want) ? want.includes(r) : r === want, `find("${q}") -> ${r}, want ${want}`); };
t('mossy boulder', ['sz-boulder-a', 'sz-boulder-c', 'sz-boulder-b']);
t('sz-tent', 'sz-tent');
t('a tent', ['sz-tent', 'lg-desert-tent', 'lg-enemy-tent-small']);
t('oak tree', ['sz-tree-oak', 'x-tree-oak-big', 'x-tree-oak-young']);
t('windmill', 'lg-windmill');
t('lighthouse', 'lg-lighthouse');
t('treasure chest', ['lg-treasure-chest-gold', 'lg-treasure-chest-ornate', 'lg-dungeon-chest']);
t('castle', ['lg-keep', 'lg-castle-wall', 'lg-castle-corner-tower']);
t('spooky graveyard', null === g.find('spooky graveyard') ? 'x' : g.find('spooky graveyard'));
t('boat', ['sz-rowing-boat', 'lg-small-sailboat', 'lg-rowboat-small', 'lg-mire-boat', 'lg-sailing-ship', 'lg-fishing-boat', 'lg-ship-wreck']);
t('barrel', 'sz-barrel');
t('village house', ['lg-village-cottage-a', 'lg-village-cottage-b', 'lg-village-longhouse', 'lg-village-inn']);
t('big pine trees', ['sz-tree-pine', 'x-tree-pine-tall', 'lg-snow-pine']);
eq(g.find('xqzzy flurble'), null, 'nonsense -> null');
eq(g.find(''), null, 'empty -> null');
eq(g.find(42), null, 'non-string -> null');
const all = g.find('tree', { all: true });
ok(Array.isArray(all) && all.length > 8, 'find all returns many trees: ' + all.length);
ok(!g.find('red potion') || g.find('red potion') !== 'lg-potion-red', 'rejected potion-red is not in the index');
for (const rej of JSON.parse(fs.readFileSync(ROOT + '/tools/startzone-batch/rejected.json', 'utf8'))) ok(!g.info(rej.id), 'rejected id absent from index: ' + rej.id);

// 3. list/info/groups
const grp = g.groups();
ok(grp.length >= 25 && grp.every((x) => x.group && x.count > 0), 'groups: ' + grp.length);
eq(g.list({ group: 'shrine' }).sort(), ['sz-offering-pedestal', 'sz-pilgrim-statue', 'sz-shrine-altar'], 'list group shrine');
ok(g.list({ tag: 'tree' }).length >= 15, 'list tag tree');
ok(g.list({ hero: true }).length === idx.items.filter((e) => e.hero).length, 'list hero');
ok(g.list({ tier: 'pc' }).length === idx.items.filter((e) => e.tier === 'pc').length, 'list tier pc');
ok(g.list({ group: 'nature', search: 'mushroom' }).length >= 1, 'list group+search');
eq(g.list({}).length, idx.items.length, 'list all');
const inf = g.info('sz-tent');
eq([inf.name, inf.size_m, inf.tier, inf.solid, inf.ground], ['Pilgrim Tent', 3, 'all', true, true], 'info sz-tent');
eq(g.info('nope'), null, 'info unknown');
eq(g.box('sz-tent'), { x: 0.97, y: 0.77, z: 1 }, 'box');

// 4. spawn (PC)
const h = g.spawn(ctx, 'sz-tent', { x: 4, z: -6, yaw: 1 });
eq([h.id, h.info.id, h.size], ['sz-tent', 'sz-tent', 3], 'spawn sync fields when index loaded');
ok(Math.abs(h.object.position.y - (0.5 + 0.04 - 0.03)) < 0.6, 'on the ground-ish y=' + h.object.position.y);
eq(h.object.scale.x, 3, 'natural size scale');
eq(h.object.rotation.y, 1, 'yaw');
ok(h.object.parent === ctx.root, 'under ctx.root');
await h.ready;
ok(h.loaded && !h.error, 'loaded');
const sp = stub.calls.filter((c) => c[0] === 'spawn' && c[1] === 'sz-tent');
eq(sp.length, 1, 'gen.spawn called once');
ok(ctx.bodies.length === 1 && ctx.bodies[0].o.type === 'fixed' && ctx.bodies[0].o.group === 'world' && ctx.bodies[0].o.shape === 'box', 'solid tent gets one fixed world box collider');
const bx = ctx.bodies[0].o.size; ok(Math.abs(bx[0] - 0.97 * 3) < 0.02 && Math.abs(bx[1] - 0.77 * 3) < 0.02, 'collider size ' + bx);
ok(Math.abs(ctx.bodies[0].pos.y - (h.object.position.y + 0.03 + 0.77 * 3 / 2)) < 0.01, 'collider centre y');
// size / height / position array / solid override
const h2 = g.spawn(ctx, 'sz-tree-oak', { position: [2, 0, 3], height: 14 });
ok(Math.abs(h2.size - 14 / byId['sz-tree-oak'].box.y) < 1e-6, 'height option -> size ' + h2.size);
eq([h2.object.position.x, h2.object.position.z], [2, 3], 'position array');
const trunk = ctx.bodies[ctx.bodies.length - 1]; eq(trunk.o.shape, 'cylinder', 'tree collider is a trunk cylinder');
const n0 = ctx.bodies.length;
g.spawn(ctx, 'sz-barrel', { x: 1, z: 1, solid: false }); eq(ctx.bodies.length, n0, 'solid:false -> no collider');
const hb = g.spawn(ctx, 'sz-bridge', { x: 1, z: 1 }); eq(ctx.bodies.length, n0, 'bridge is walk-through');
const hy = g.spawn(ctx, 'sz-barrel', { x: 0, z: 0, y: 5 }); ok(Math.abs(hy.object.position.y - (5 - 0.03)) < 1e-9, 'explicit y');
// query spawn
const hq = g.spawn(ctx, 'a mossy boulder', { x: 3, z: 3 }); ok(hq.id && /boulder/.test(hq.id), 'query spawn resolves ' + hq.id);
const hn = g.spawn(ctx, 'flurblezork', { x: 0, z: 0 }); await hn.ready; ok(hn.error && !hn.id, 'unknown query -> error not throw');
// water
const hw = g.spawn(ctx, 'sz-rowing-boat', { x: -30, z: -78 }); ok(Math.abs(hw.object.position.y - (-1.4 - 0.3 - 0.03)) < 1e-9, 'boat floats at water level y=' + hw.object.position.y);
const hl = g.spawn(ctx, 'sz-rowing-boat', { x: 20, z: 0 }); ok(hl.object.position.y > 0, 'boat on land sits on ground');
// remove
const nb = ctx.bodies.length; h.remove(); ok(h.removed && h.object.parent === null, 'remove detaches'); ok(ctx.bodies[0] && true, 'ok');
h.remove(); // idempotent
// big building on a slope sits on the lowest corner
const hbig = g.spawn(ctx, 'lg-village-longhouse', { x: 10, z: 0 }); ok(hbig.object.position.y <= (0.5 + 0.1) - 0.03 + 1e-6, 'big footprint uses lowest corner y=' + hbig.object.position.y);

// 5. Quest tier: pc-only substitution / skip
const cq = makeCtx(false);
const mq = mod.default(cq); // fresh module instance, state separate => index loads again
await cq.world.gen.ready();
const gq = cq.world.gen;
const sub = gq.spawn(cq, 'sz-flower-patch', { x: 0, z: -3 });
eq([sub.substituted, sub.id], ['sz-flower-patch', 'x-plant-lavender'], 'pc-only flower patch -> alt on Quest');
const sk = gq.spawn(cq, 'x-statue-giant-spider', { x: 0, z: -3 }); ok(sk.info && sk.id, 'giant spider resolves on quest via alt');
const noalt = idx.items.filter((e) => e.tier === 'pc' && !e.alt);
console.log('pc-only entries without alt:', noalt.length);
ok(gq.find('meadow flowers') && gq.find('flower patch'), 'quest find still resolves');
const scq = gq.scatter(cq, 'sz-bush', [{ x: 1, z: 1 }, { x: 2, z: 2, size: 2 }]); await scq.ready;
const sc = stub.calls.filter((c) => c[0] === 'scatter').pop();
eq(sc[2].map((i) => i.size), [1.4, 2], 'scatter default size from catalogue'); eq(sc[2].length, 2, 'scatter list');
// 6. scatter on PC with colliders for solid
const before = ctx.bodies.length;
const sf = g.scatter(ctx, 'sz-barrel', [{ x: 1, z: 1 }, { x: 2, z: 2 }, { x: 3, z: 3 }]); await sf.ready;
eq(ctx.bodies.length - before, 3, 'scatter solid: one collider per item (<=24)');
const sf2 = g.scatter(ctx, 'sz-barrel', Array.from({ length: 30 }, (_, i) => ({ x: i, z: 5 }))); await sf2.ready;
eq(ctx.bodies.length - before, 3, 'scatter >24: no colliders');
sf.remove(); ok(sf.colliders.every((k) => k.removed), 'scatter remove removes colliders');
// 7. no physics: still spawns
const cn = makeCtx(true, false); mod.default(cn); await cn.world.gen.ready();
const hn2 = cn.world.gen.spawn(cn, 'sz-tent', { x: 0, z: -4 }); await hn2.ready; ok(hn2.loaded && !hn2.collider, 'works without world.physics');
// 8. index failure then retry
const cf = makeCtx(true); const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('offline'); };
mod.default(cf); const rf = await cf.world.gen.ready(); ok(!cf.world.gen.loaded, 'failed load leaves loaded=false');
const hf = cf.world.gen.spawn(cf, 'sz-tent', { x: 0, z: 0 }); await hf.ready; ok(hf.error, 'spawn without index -> h.error, no throw');
globalThis.fetch = realFetch;
// 9. spawn BEFORE the index is loaded (deferred path)
const cd = makeCtx(true); mod.default(cd);
const hd = cd.world.gen.spawn(cd, 'lg-windmill', { x: 5, z: -9, yaw: 0.5 });
eq(hd.id, null, 'deferred: id unknown before index'); ok(hd.object.parent === cd.root, 'deferred: slot placed now');
await hd.ready; eq(hd.id, 'lg-windmill', 'deferred: resolved after load'); eq(hd.object.scale.x, 10, 'deferred: natural size applied'); ok(hd.loaded, 'deferred loaded');
// 9b. lib/gen.js compatibility + parent rule
const pgrp = new THREE.Group(); ctx.root.add(pgrp); const nb2 = ctx.bodies.length;
g.spawn(ctx, 'sz-tent', { x: 1, z: 1, parent: pgrp }); eq(ctx.bodies.length, nb2, 'parent given -> no auto collider');
g.spawn(ctx, 'sz-tent', { x: 1, z: 1, parent: pgrp, solid: true }); eq(ctx.bodies.length, nb2 + 1, 'parent + solid:true -> collider');
await g.preload(ctx, ['sz-tent', 'a mossy boulder']); const pl = stub.calls.filter((c) => c[0] === 'preload').pop(); eq(pl[1][0], 'sz-tent', 'preload passes ids'); ok(/boulder/.test(pl[1][1]), 'preload resolves queries');
eq(g.url(ctx, 'sz-tent'), '/u/sz-tent', 'url passthrough'); eq(g.box('sz-tent').x, 0.97, 'box from index');
// 10. dispose cleanup
for (const f of ctx.disposers) f(); ok(h2.removed, 'ctx.onDispose removes handles');
// 11. catalogue ids all resolvable and header present
const header = fs.readFileSync(ROOT + '/public/game/core/genset.js', 'utf8').split('\n'); let end = 0; while (end < header.length && /^\s*(\/\/|$)/.test(header[end])) end++;
const hdr = header.slice(0, end).join('\n');
ok(hdr.includes('CATALOG-BEGIN') && /use world\.gen FIRST/.test(hdr) && /world\.models\.generate/.test(hdr), 'header has the directive');
console.log('header bytes', Buffer.byteLength(hdr), 'lines', end);
const missing = [];
for (const e of idx.items) if (!hdr.includes(e.id.replace(/^(sz|lg|x)-/, '').split('-').pop())) missing.push(e.id);
ok(missing.length === 0, 'every id has its last token in the header: ' + missing.slice(0, 5));
console.log(`genset test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);


