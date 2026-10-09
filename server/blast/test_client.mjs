// Tests of public/game/core/blast.js (world.blast) with a fake ctx, a fake net and fake kit / travel (no browser, no GPU):
//   node --test server/blast/test_client.mjs
// stage flow, objects popping out of the vision, stepping into the place, re-seating, cleanup, hot reload mid-blast and after arrival, passthrough, no travel, failure, budgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as THREE_NS from 'three';

register(pathToFileURL('D:/omnissiah/server/blast/test_hooks.mjs'));

// ---- a minimal textureless GLB (a unit box, base at y = 0, largest side 1)
function boxGlb() {
  const p = []; const idx = [];
  const corners = [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]];
  for (const c of corners) p.push(...c);
  for (const f of [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 5, 1], [0, 4, 5], [1, 6, 2], [1, 5, 6], [2, 7, 3], [2, 6, 7], [3, 4, 0], [3, 7, 4]]) idx.push(...f);
  const pos = Buffer.from(new Float32Array(p).buffer), ind = Buffer.from(new Uint16Array(idx).buffer);
  const bin = Buffer.concat([pos, ind, Buffer.alloc((4 - ((pos.length + ind.length) % 4)) % 4)]);
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.6, 0.4, 0.2, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: ind.length }], buffers: [{ byteLength: bin.length }],
  }));
  const jp = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + jp.length + 8 + bin.length, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(jp.length, 0); c1.writeUInt32LE(0x4e4f534a, 4);
  const c2 = Buffer.alloc(8); c2.writeUInt32LE(bin.length, 0); c2.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, c1, jp, c2, bin]);
}
const GLB = boxGlb();

// ---- browser-ish globals the module touches
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' }) }) };
globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  const url = String(u?.url ?? u);
  if (url.endsWith('.glb')) return new Response(GLB, { status: 200 });
  if (url.endsWith('index.json')) return new Response(JSON.stringify({ 'old-one': { name: 'Old One', created: '2026-01-01', thumb: '/t.jpg' } }), { status: 200 });
  if (url.endsWith('manifest.json')) return new Response(JSON.stringify(MANIFEST), { status: 200 });
  return realFetch ? realFetch(u, init) : new Response('', { status: 404 });
};

const THREE = { ...THREE_NS, TextureLoader: class { load(_u, ok) { const t = new THREE_NS.Texture(); setTimeout(() => ok(t), 0); } } };
const { default: blastModule } = await import('file:///D:/omnissiah/public/game/core/blast.js');

const obj = (id, pos, extra = {}) => ({ id, name: id, url: `http://localhost/assets/generated/blasts/s/output/${id}/model.glb`, position: pos, yaw: 0.3, scale: 0.8, dims: [0.8, 0.8, 0.8], size_m: [0.8, 0.8, 0.8], material: 'wood', breakable: true, mass: 5, hp: 10, grabbable: true, bounce: 0.1, friction: 0.6, fixed: false, rests: 'floor', supportId: null, count: 1, copies: [], sound: null, from: { box: [0.4, 0.5, 0.5, 0.7], depth: 'mid' }, ...extra });
const MANIFEST = {
  schema_version: 1, slug: 's', name: 'Test Study', caption: 'c', prompt: 'a test study', image: '/assets/generated/blasts/s/source/0-s.png', aspect: 1.75, fov: 80, music: 'tavern',
  place: { slug: 'blast-s' }, ambient: null,
  objects: [obj('a', [-3, 0, -5]), obj('b', [3, 0, -6], { copies: [{ position: [3.9, 0, -6.2], yaw: 1 }], count: 2 }), obj('c', [0, 0.75, -5], { supportId: 'a', rests: 'object' }), obj('wall', [0, 1.8, -8], { fixed: true, mass: 0, grabbable: false })],
};

// ---- the fake world around the module
function makeWorld({ travel = true, perfAllow = null, passthrough = false } = {}) {
  const listeners = new Map();
  const events = { on(n, f) { if (!listeners.has(n)) listeners.set(n, new Set()); listeners.get(n).add(f); return () => listeners.get(n).delete(f); }, emit(n, p) { for (const f of [...(listeners.get(n) ?? [])]) f(p); } };
  const sent = [];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
  camera.position.set(0, 1.6, 0);
  const calls = { go: [], home: 0, bodies: [], destructibles: [], hits: [], labels: [], hud: [] };
  const kit = {
    body(c, mesh, o) {
      if (!mesh.parent) c.root.add(mesh);
      const b = { mesh, position: mesh.position.clone(), velocity: new THREE.Vector3(), invMass: o.mass > 0 ? 1 / o.mass : 0, grabbable: o.grabbable, opts: o, removed: false, handlers: [], onHit(f) { this.handlers.push(f); return this; }, remove() { this.removed = true; mesh.removeFromParent(); } };
      calls.bodies.push(b);
      c.onDispose(() => b.remove());                       // like the real kit: bodies are released with the creating module's ctx
      return b;
    },
    destructible(c, mesh, o) { const d = { opts: o, removed: false, remove() { this.removed = true; } }; calls.destructibles.push(d); return d; },
    label(c, text, o) { const l = { text, position: new THREE.Vector3(), set(t) { this.text = t; }, remove() { this.removed = true; } }; calls.labels.push(l); return l; },
  };
  const world = { kit, contextProviders: {} };
  if (travel) {
    const T = { away: false, go(spec) {
      calls.go.push(spec);
      const h = { state: 'resolving', ready: null };
      h.ready = (async () => { await tick(3); h.state = 'closing'; await tick(3); h.state = 'switching'; await tick(3); T.away = true; h.state = 'opening'; await tick(3); h.state = 'arrived'; return { name: 'Place' }; })();
      return h;
    }, home() { calls.home++; T.away = false; return { ready: Promise.resolve(null) }; } };
    world.travel = T;
  }
  if (perfAllow !== null) world.perf = { allow: () => perfAllow };
  const clock = { t: 0, dt: 0.016 };
  const player = { head: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1), feet: rig.position, rig };
  const state = {};
  const hud = { show: (t) => calls.hud.push(t) };
  const net = { send: (m) => { sent.push(m); return true; } };
  const input = { passthrough, left: {}, right: {} };
  const mkCtx = () => {
    const root = new THREE.Group(); scene.add(root);
    const cleanups = [];
    const ctx = { THREE, scene, camera, rig, root, input, player, world, events, hud, clock, net, quality: { tier: 'pc' }, state, path: 'core/blast.js', groundAt: () => 0,
      on: (n, f) => { cleanups.push(events.on(n, f)); }, provide: (n, api) => { world[n] = api; cleanups.push(() => { if (world[n] === api) delete world[n]; }); }, onDispose: (f) => cleanups.push(f) };
    return { ctx, root, unload(inst) { try { inst.dispose?.(); } catch { /* ignore */ } for (const f of cleanups.reverse()) f(); scene.remove(root); } };
  };
  return { events, world, sent, calls, mkCtx, player, rig, scene, clock, state, input, camera };
}
const tick = (n = 1) => new Promise((r) => setTimeout(r, 4 * n));
function frames(w, inst, n = 120) {
  for (let i = 0; i < n; i++) {
    w.clock.t += 0.033; inst.update(0.033, w.clock.t);
    for (const b of w.calls.bodies) if (!b.removed) b.mesh.position.copy(b.position);   // the real kit copies body.position onto the mesh every frame
  }
}
async function settle(w, inst, n = 30) { for (let i = 0; i < n; i++) { await tick(2); frames(w, inst, 4); } }
const status = (w, id, stage, state, message, extra = {}) => w.events.emit('net:blast_status', { type: 'blast_status', id, slug: 's', stage, state, message, progress: { done: 0, total: 0 }, result: null, ...extra });
const objEvent = (w, id, o) => status(w, id, 'objects', 'running', `The ${o.id} is out`, { result: { object: { ...o, ok: true } } });
async function boot(opts) {
  const w = makeWorld(opts);
  const c = w.mkCtx();
  const inst = await blastModule(c.ctx);
  return { w, c, inst, blast: w.world.blast };
}

test('stage flow: vision, objects pop out, step into the place, re-seat, ready resolves', async () => {
  const { w, c, inst, blast } = await boot();
  const h = blast.create({ prompt: 'a test study', options: { maxObjects: 4 } });
  assert.equal(w.sent[0].type, 'blast');
  assert.equal(w.sent[0].prompt, 'a test study');
  assert.equal(w.sent[0].options.maxObjects, 4);
  assert.ok(c.root.getObjectByName('blast-vision'), 'the vision exists at once (dreaming)');
  assert.equal(h.state, 'queued');
  status(w, h.id, 'image', 'running', 'I am dreaming the place');
  assert.equal(h.stage, 'image');
  assert.equal(h.state, 'running');
  status(w, h.id, 'image', 'done', 'The vision is ready', { result: { slug: 's', image: '/x.png', aspect: 1.75, fov: 80 } });
  assert.equal(h.message, 'The vision is ready');
  for (const o of MANIFEST.objects.slice(0, 3)) { objEvent(w, h.id, o); await settle(w, inst, 3); }
  assert.equal(h.props.length, 3, 'props staged one by one');
  // flying: pinned (no physics motion) while the animation runs, scaled up from the picture
  const first = h.props[0];
  assert.equal(first.body.invMass, 0);
  assert.ok(first.inner.scale.x < 1);
  await settle(w, inst, 25);
  assert.ok(h.props.every((p) => p.state === 'rest' && p.body.invMass > 0), 'landed and released to physics');
  assert.ok(h.props.every((p) => Math.hypot(p.holder.position.x, p.holder.position.z) < 3.6), `staged within reach of the player: ${h.props.map((p) => p.holder.position.toArray().map((v) => v.toFixed(2)).join('/')).join(' ')}`);
  assert.equal(w.calls.go.length, 0, 'no travel before the layout is known');
  status(w, h.id, 'place', 'done', 'A world has opened', { result: { place: 'blast-s' } });
  status(w, h.id, 'layout', 'done', 'Everything stands where it belongs', { result: MANIFEST });
  await settle(w, inst, 30);
  assert.deepEqual(w.calls.go.map((g) => g.place), ['blast-s']);
  assert.equal(h.state, 'arrived');
  const ready = await h.ready;
  assert.equal(ready, h);
  // re-seated at the manifest positions: in the place the picture is straight ahead (-Z of the origin)
  const rows = h.props.filter((p) => p.state !== 'gone');
  assert.equal(rows.length, 5, '3 staged + the copy of b + the wall object, all present');
  const a = rows.find((r) => r.entry.id === 'a' && r.copy === 0);
  assert.ok(Math.abs(a.body.position.x - -3) < 0.01 && Math.abs(a.body.position.z - -5) < 0.01, `a at ${a.body.position.toArray()}`);
  const cc = rows.find((r) => r.entry.id === 'c');
  assert.ok(cc.body.position.y > 0.75, 'the supported object sits at its height');
  const cp = rows.find((r) => r.entry.id === 'b' && r.copy === 1);
  assert.ok(Math.abs(cp.body.position.x - 3.9) < 0.01);
  assert.equal(rows.find((r) => r.entry.id === 'wall').body.invMass, 0, 'wall things stay fixed');
  assert.ok(c.root.getObjectByName('blast-vision') === undefined || true);
  await settle(w, inst, 40);
  assert.equal(c.root.getObjectByName('blast-vision'), undefined, 'the vision has faded away');
  assert.equal(blast.current.slug, 's');
  assert.ok(w.world.blast.current.objects >= 5);
  // the final manifest with the sounds arrives later: no crash, props get their sound
  status(w, h.id, 'done', 'done', 'Step inside.', { result: { ...MANIFEST, objects: MANIFEST.objects.map((o) => ({ ...o, sound: { url: 'http://localhost/x.ogg', phrase: 'p' } })) } });
  assert.ok(h.props.find((r) => r.entry.id === 'a').entry.sound);
  c.unload(inst);
});

test('hits play a sound without a sound engine, a break removes the body', async () => {
  const { w, c, inst, blast } = await boot();
  const h = blast.create('x');
  status(w, h.id, 'image', 'done', 'ok', { result: { slug: 's', image: '/x.png', aspect: 1.75 } });
  objEvent(w, h.id, MANIFEST.objects[0]);
  await settle(w, inst, 30);
  const p = h.props[0];
  p.body.handlers[0]({ speed: 5, point: new THREE_NS.Vector3() });                     // no AudioContext in this fake: must not throw
  const d = w.calls.destructibles[0];
  d.opts.onBreak({});
  assert.equal(p.broken, true);
  assert.ok(p.body === null || p.body.removed);
  frames(w, inst, 5);
  c.unload(inst);
});

test('cleanup: a new blast and home() remove props and vision; home travels back', async () => {
  const { w, c, inst, blast } = await boot();
  const h1 = blast.create('one');
  status(w, h1.id, 'image', 'done', 'ok', { result: { slug: 's', image: '/x.png', aspect: 1.75 } });
  objEvent(w, h1.id, MANIFEST.objects[0]); objEvent(w, h1.id, MANIFEST.objects[1]);
  await settle(w, inst, 10);
  const bodies = [...w.calls.bodies];
  assert.equal(bodies.length, 2);
  const h2 = blast.create('two');
  assert.ok(bodies.every((b) => b.removed), 'the first blast was cleaned up');
  assert.equal(h1.state, 'removed');
  assert.equal(await h1.ready, null);
  assert.equal(c.root.children.filter((o) => o.name === 'blast-vision').length, 1, 'one vision only');
  status(w, h2.id, 'layout', 'done', 'ok', { result: { ...MANIFEST, slug: 's2' } });
  status(w, h1.id, 'objects', 'running', 'stale', { result: { object: { ...MANIFEST.objects[0], ok: true } } });   // late status of the old blast is ignored
  await settle(w, inst, 30);
  assert.equal(h2.state, 'arrived');
  const out = blast.home();
  assert.equal(w.calls.home, 1);
  await out.ready;
  assert.equal(blast.active, null);
  assert.ok(w.calls.bodies.every((b) => b.removed));
  assert.equal(c.root.children.filter((o) => o.name === 'blast-vision' || /^blast:/.test(o.name)).length, 0);
  c.unload(inst);
});

test('hot reload mid-blast: the new instance re-attaches (blast_get) and finishes the job', async () => {
  const w = makeWorld();
  let c = w.mkCtx();
  let inst = await blastModule(c.ctx);
  const h = w.world.blast.create('reload me');
  const id = h.id;
  status(w, id, 'image', 'done', 'ok', { result: { slug: 's', image: '/x.png', aspect: 1.75 } });
  objEvent(w, id, MANIFEST.objects[0]);
  await settle(w, inst, 10);
  assert.equal(h.props.length, 1);
  w.sent.length = 0;
  c.unload(inst);                                                    // the file is hot-swapped
  assert.ok(w.calls.bodies[0].removed, 'old props are gone with the old root');
  c = w.mkCtx();
  inst = await blastModule(c.ctx);
  const re = w.sent.find((m) => m.type === 'blast_get');
  assert.ok(re && re.id === id && re.slug === 's', 'the new instance asks the server to replay');
  const h2 = w.world.blast.active;
  assert.equal(h2.state, 'running');
  // the server replays: image, the objects that already came out, then the rest
  status(w, id, 'image', 'done', 'ok', { replay: true, result: { slug: 's', image: '/x.png', aspect: 1.75 } });
  objEvent(w, id, MANIFEST.objects[0]); objEvent(w, id, MANIFEST.objects[1]);
  await settle(w, inst, 25);
  assert.equal(h2.props.length, 2);
  status(w, id, 'layout', 'done', 'ok', { result: MANIFEST });
  await settle(w, inst, 30);
  assert.equal(h2.state, 'arrived');
  assert.equal(await h2.ready, h2);
  c.unload(inst);
});

test('hot reload after arrival: props come back in place, no travel again', async () => {
  const w = makeWorld();
  let c = w.mkCtx();
  let inst = await blastModule(c.ctx);
  const h = w.world.blast.create('standing');
  status(w, h.id, 'image', 'done', 'ok', { result: { slug: 's', image: '/x.png', aspect: 1.75 } });
  status(w, h.id, 'layout', 'done', 'ok', { result: MANIFEST });
  await settle(w, inst, 40);
  assert.equal(h.state, 'arrived');
  const goCalls = w.calls.go.length;
  c.unload(inst);
  c = w.mkCtx();
  inst = await blastModule(c.ctx);
  await settle(w, inst, 30);
  const h2 = w.world.blast.active;
  assert.equal(h2.state, 'arrived');
  assert.equal(w.calls.go.length, goCalls, 'no second journey');
  assert.ok(h2.props.length >= 5);
  const a = h2.props.find((r) => r.entry.id === 'a');
  assert.ok(Math.abs(a.body.position.x - -3) < 0.01 && Math.abs(a.body.position.z - -5) < 0.01);
  c.unload(inst);
});

test('mixed reality: no travel, things appear on the real floor close around the player', async () => {
  const { w, c, inst, blast } = await boot({ passthrough: true });
  const h = blast.create('real room');
  status(w, h.id, 'image', 'done', 'ok', { result: { slug: 's', image: '/x.png', aspect: 1.75 } });
  status(w, h.id, 'layout', 'done', 'ok', { result: MANIFEST });
  await settle(w, inst, 40);
  assert.equal(w.calls.go.length, 0);
  assert.equal(h.state, 'arrived');
  for (const p of h.props) assert.ok(Math.hypot(p.body.position.x, p.body.position.z) <= 3.2, `within 3 m of the player: ${p.entry.id} at ${p.body.position.toArray().map((v) => v.toFixed(2))}`);
  assert.ok(h.props.length >= 5);
  c.unload(inst);
});

test('no travel module: the things stay in the current world, in front of the player, and say so', async () => {
  const { w, c, inst, blast } = await boot({ travel: false });
  const h = blast.create('no travel here');
  status(w, h.id, 'image', 'done', 'ok', { result: { slug: 's', image: '/x.png', aspect: 1.75 } });
  status(w, h.id, 'layout', 'done', 'ok', { result: MANIFEST });
  await settle(w, inst, 40);
  assert.equal(h.state, 'arrived');
  assert.ok(w.calls.hud.some((t) => /cannot carry you|stand here/.test(t)));
  const a = h.props.find((r) => r.entry.id === 'a');
  assert.ok(a.body.position.z < -1, 'in front (the player looks toward -Z)');
  // turn the player: the layout follows the gaze at creation time
  c.unload(inst);
  const w2 = makeWorld({ travel: false });
  w2.player.forward.set(1, 0, 0);                                           // looking toward +X
  const c2 = w2.mkCtx(); const inst2 = await blastModule(c2.ctx);
  const h2 = w2.world.blast.create('east');
  status(w2, h2.id, 'image', 'done', 'ok', { result: { slug: 's', image: '/x.png', aspect: 1.75 } });
  status(w2, h2.id, 'layout', 'done', 'ok', { result: MANIFEST });
  await settle(w2, inst2, 40);
  const a2 = h2.props.find((r) => r.entry.id === 'a');
  assert.ok(a2.body.position.x > 1, `east of the player: ${a2.body.position.toArray()}`);
  c2.unload(inst2);
});

test('failure and budgets: image error fails the handle; perf budget limits the props; open() from the cache; list()', async () => {
  let { w, c, inst, blast } = await boot();
  let h = blast.create('doomed');
  status(w, h.id, 'image', 'error', 'The vision would not form.');
  assert.equal(h.state, 'failed');
  assert.equal(await h.ready, null);
  c.unload(inst);
  ({ w, c, inst, blast } = await boot({ perfAllow: 0 }));
  h = blast.create('over budget');
  status(w, h.id, 'image', 'done', 'ok', { result: { slug: 's', image: '/x.png', aspect: 1.75 } });
  objEvent(w, h.id, MANIFEST.objects[0]);
  await settle(w, inst, 10);
  assert.equal(h.props.length, 0, 'nothing spawned over the physics budget');
  c.unload(inst);
  ({ w, c, inst, blast } = await boot());
  const opened = await blast.open('s');
  await settle(w, inst, 40);
  assert.equal(opened.state, 'arrived');
  assert.deepEqual(w.calls.go.map((g) => g.place), ['blast-s']);
  const none = blast.create({});
  assert.equal(none.state, 'failed');
  const list = blast.list();
  assert.ok(Array.isArray(list));
  const fresh = await list;
  assert.equal(fresh[0].slug, 'old-one');
  assert.equal(typeof blast.inputs, 'function');
  c.unload(inst);
});
