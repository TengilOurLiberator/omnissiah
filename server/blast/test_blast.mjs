// Tests for the blast server side (no GPU, no WSL, no model): node --test server/blast/test_blast.mjs
//   pure parts (JSON repair, survey normalisation, object choice, layout, GLB bounds, prompts) and the whole pipeline against stubbed services
//   (stage order, resume, cache, JSON retry, budgets, degradation paths, image path validation).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { extractJson, repairJsonText, normaliseAnalysis, selectObjects, materialClass, physicsFor, impactPrompt } from './analysis.js';
import { computeLayout, glbBounds, scaleFor } from './layout.js';
import { sceneWrapper, platePrompt, isolatePrompt, emptyPlaceDescription, placeWords } from './prompts.js';
import { createBlast } from './service.js';

const require = createRequire('D:/omnissiah/package.json');
const sharp = require('sharp');

// ------------------------------------------------------------------------------------------------ pure parts
test('extractJson: plain, fenced, chatty, comments, trailing commas, smart quotes', () => {
  assert.deepEqual(extractJson('{"a":1}').value, { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":1,}\n```').value, { a: 1 });
  assert.deepEqual(extractJson('Here is the survey:\n{"a": [1,2,], // note\n "b": "x"}\nHope that helps').value, { a: [1, 2], b: 'x' });
  assert.deepEqual(extractJson('{“a”: “b”, "c": None, "d": True}').value, { a: 'b', c: null, d: true });
  assert.ok(extractJson('no json here').error);
  assert.ok(extractJson('').error);
  assert.ok(extractJson('{"a": ').error);
  assert.equal(repairJsonText('{"url":"http://x//y"}'), '{"url":"http://x//y"}');   // // inside a string is not a comment
});

const raw = () => ({
  scene_name: 'Study', short_caption: 'A study', setting: 'indoor', ground_type: 'wooden floor', backdrop: 'wall', horizon_y: 0.5, music_mood: 'tavern', terrain_hint: 'plain',
  ambient_sound: 'crackling fire',
  objects: [
    { id: 'desk', name: 'wooden desk', box: [0.33, 0.5, 0.67, 0.8], depth: 'mid', size_m: [1.6, 0.8, 0.8], rests_on: 'floor', interest: 2, break_material: 'wood', impact_sound: 'heavy desk crash', fully_visible: true },
    { id: 'globe', name: 'globe', box: [0.57, 0.37, 0.65, 0.56], depth: 'mid', size_m: [0.4, 0.6, 0.4], rests_on: 'object', rests_on_id: 'desk', interest: 5, break_material: 'glass' },
    { id: 'globe', name: 'second globe', box: [0.1, 0.5, 0.2, 0.7], depth: 'near', size_m: [0.4, 0.6, 0.4], interest: 4 },
    { id: 'barrel', name: 'barrel', box: [0.8, 0.5, 0.95, 0.83], depth: 'near', size_m: [0.6, 0.9, 0.6], interest: 5, materials: ['oak wood', 'iron'], count_estimate: 9 },
    { id: 'castle', name: 'huge castle', box: [0, 0, 1, 1], depth: 'far', size_m: [40, 30, 40], interest: 5 },
    { name: '', box: [0, 0, 1, 1] }, null, 'junk',
  ],
});

test('normaliseAnalysis: defaults, unique ids, clamps, material classes', () => {
  const a = normaliseAnalysis(raw(), { slug: 's', sourceImages: ['x.png'] });
  assert.equal(a.setting, 'indoor');
  assert.equal(a.music_mood, 'tavern');
  assert.equal(a.objects.length, 5);                                   // the nameless one and the non-objects are gone
  assert.equal(new Set(a.objects.map((o) => o.id)).size, 5);
  const barrel = a.objects.find((o) => o.id === 'barrel');
  assert.equal(barrel.count_estimate, 9);
  assert.equal(barrel.break_material, 'wood');
  assert.ok(a.objects.every((o) => o.box.every((v) => v >= 0 && v <= 1) && o.size_m.every((v) => v > 0 && v <= 12)));
  assert.equal(a.objects.find((o) => o.id === 'globe').rests_on, 'object');
  const bad = normaliseAnalysis({ objects: [{ name: 'chair', box: [10, 20, 300, 400] }, { name: 'mug' }] }, { slug: 'x' });
  assert.ok(bad.objects.every((o) => o.box_guessed), 'pixel boxes and missing boxes are flagged as guesses');
  assert.equal(normaliseAnalysis(null).objects.length, 0);
  assert.equal(materialClass('terracotta pot'), 'earth');
  assert.equal(materialClass('brass'), 'metal');
});

test('selectObjects: cap, distinct, no huge things, supports', () => {
  const a = normaliseAnalysis(raw(), { slug: 's' });
  const sel = selectObjects(a, { maxObjects: 3 });
  assert.ok(sel.length <= 3);
  assert.ok(!sel.some((o) => o.id === 'castle'), 'a castle is not an object');
  assert.ok(sel.every((o) => o.count >= 1 && o.count <= 4));
  assert.equal(sel.find((o) => o.id === 'barrel').count, 4, 'count_estimate is capped at 4 instances');
  const many = { objects: Array.from({ length: 30 }, (_, i) => ({ ...normaliseAnalysis({ objects: [{ name: `thing ${i}`, box: [(i % 10) / 11, Math.floor(i / 10) * 0.3, (i % 10) / 11 + 0.08, Math.floor(i / 10) * 0.3 + 0.12], size_m: [0.4, 0.4, 0.4], interest: 3 }] }).objects[0], id: `t${i}` })) };
  assert.equal(selectObjects(many, { maxObjects: 99 }).length, 14, 'the cap is 14');
  assert.equal(selectObjects(many).length, 8, 'the default is 8');
});

test('physics numbers and sound prompts', () => {
  const p = physicsFor({ size_m: [0.6, 0.9, 0.6], break_material: 'wood' });
  assert.ok(p.mass > 10 && p.mass < 120 && p.hp >= 6);
  assert.equal(physicsFor({ size_m: [3, 2, 3], break_material: 'stone' }).grabbable, false);
  assert.match(impactPrompt({ break_material: 'wood', name: 'barrel', impact_sound: 'heavy barrel thud' }), /^impact one-shot, short decay, heavy barrel thud/);
});

// a minimal binary glTF with one POSITION accessor
function makeGlb(min, max, node = {}) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, ...node }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ min, max, count: 3, componentType: 5126, type: 'VEC3' }] }));
  const pad = (4 - (json.length % 4)) % 4;
  const body = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + body.length, 8); head.writeUInt32LE(body.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, body]);
}
test('glbBounds reads accessor min/max (with node scale)', () => {
  const b = glbBounds(makeGlb([-0.5, 0, -0.25], [0.5, 1, 0.25]));
  assert.deepEqual(b.size.map((v) => +v.toFixed(3)), [1, 1, 0.5]);
  assert.deepEqual(glbBounds(makeGlb([0, 0, 0], [1, 1, 1], { scale: [2, 1, 1] })).size, [2, 1, 1]);
  assert.equal(glbBounds(Buffer.from('nope')), null);
});

test('layout: bearing follows the picture, distances in range, no overlap, supports, wall things', () => {
  const o = (id, box, extra = {}) => ({ id, name: id, box, depth: 'mid', size_m: [0.6, 0.6, 0.6], rests_on: 'floor', rests_on_id: null, count: 1, break_material: 'wood', ...extra });
  const objs = [
    o('left', [0.1, 0.55, 0.2, 0.75]), o('right', [0.8, 0.55, 0.9, 0.75]), o('centre', [0.45, 0.6, 0.55, 0.8]),
    o('desk', [0.3, 0.5, 0.7, 0.8], { size_m: [1.6, 0.8, 0.8] }), o('globe', [0.5, 0.38, 0.58, 0.52], { rests_on: 'table', size_m: [0.4, 0.5, 0.4] }),
    o('lamp', [0.45, 0.0, 0.55, 0.15], { rests_on: 'ceiling' }), o('dup', [0.46, 0.6, 0.54, 0.8], { count: 3 }),
  ];
  const rows = computeLayout(objs, { horizonY: 0.5, fov: 80, indoor: true });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.ok(by.left.position[0] < 0 && by.right.position[0] > 0, 'left of the picture = -X, right = +X');
  assert.ok(by.left.position[2] < 0 && by.right.position[2] < 0, 'in front of the player = -Z');
  for (const r of rows) {
    for (const p of [r.position, ...r.copies.map((c) => c.position)]) {
      const d = Math.hypot(p[0], p[2]);
      assert.ok(d >= 1.9 && d <= 14.01, `${r.id} distance ${d}`);
      assert.ok(p[2] < 0 || Math.abs(p[0]) > 1, `${r.id} is not behind the player`);
    }
  }
  assert.equal(by.globe.supportId, 'desk', 'the globe stands on the nearest extracted surface');
  assert.ok(Math.abs(by.globe.position[1] - by.desk.dims[1]) < 0.05, 'and at its height');
  assert.equal(by.lamp.fixed, true, 'ceiling things are fixed anchors');
  assert.ok(by.lamp.position[1] > 1.5);
  assert.equal(by.dup.copies.length, 2);
  // footprints of ground objects do not overlap
  const ground = [];
  for (const r of rows) if (!r.fixed && !r.supportId) { ground.push({ id: r.id, p: r.position, rad: Math.max(r.dims[0], r.dims[2]) * 0.45 }); for (const c of r.copies) ground.push({ id: r.id, p: c.position, rad: Math.max(r.dims[0], r.dims[2]) * 0.45 }); }
  for (let i = 0; i < ground.length; i++) for (let j = i + 1; j < ground.length; j++) {
    const d = Math.hypot(ground[i].p[0] - ground[j].p[0], ground[i].p[2] - ground[j].p[2]);
    assert.ok(d >= (ground[i].rad + ground[j].rad) * 0.9, `${ground[i].id} overlaps ${ground[j].id} (${d.toFixed(2)})`);
  }
  // never on the player
  assert.ok(computeLayout([o('here', [0.4, 0.95, 0.6, 1.0], { depth: 'near' })], {})[0].distance >= 2);
});

test('scaleFor: survey size cross-checked with the model proportions', () => {
  const o = { size_m: [0.6, 0.9, 0.6] };
  assert.ok(Math.abs(scaleFor(o, null) - 0.9) < 1e-9);
  assert.ok(Math.abs(scaleFor(o, [0.67, 1, 0.67]) - 0.9) < 0.01);
  assert.ok(Math.abs(scaleFor({ size_m: [2, 0.2, 0.2] }, [1, 0.5, 0.2]) - 2) < 0.01, 'inconsistent height estimate is ignored');
});

test('prompts: shape of the three edit / image prompts', () => {
  assert.match(sceneWrapper('a goblin market'), /^a goblin market\. /);
  assert.match(sceneWrapper('a goblin market'), /eye height/);
  assert.equal(platePrompt(['barrel', 'chest']).startsWith('Remove the barrel and chest'), true);
  assert.match(platePrompt(['a', 'b', 'c'], { ground: 'grass', backdrop: 'forest' }), /Remove the a, b and c.*empty grass and the bare forest/);
  const ip = isolatePrompt({ name: 'wooden barrel', box: [0.8, 0.5, 0.95, 0.83], depth: 'near', description: 'A barrel with iron hoops', materials: ['oak'] });
  assert.match(ip, /Isolate the wooden barrel \(foreground, far right of the picture/);
  assert.match(ip, /plain pure white background/);
  assert.equal(placeWords(null), '');
  const d = emptyPlaceDescription({ scene_name: 'Study', environment: 'A wooden study', literal_description: 'A desk stands in the centre. The floor is wooden planks. A barrel stands right.', lighting: 'Warm candle light.' }, ['wooden desk', 'barrel']);
  assert.ok(!/desk|barrel/i.test(d.replace(/^Study: empty A wooden study[^.]*\./, '')), d);
  assert.match(d, /wooden planks/);
});

// ------------------------------------------------------------------------------------------------ the pipeline against stubs
async function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-test-'));
  fs.mkdirSync(path.join(root, 'public', 'assets', 'generated'), { recursive: true });
  fs.mkdirSync(path.join(root, 'input'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  return root;
}
const png = (file, color, w = 96, h = 54) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toFile(file);

function stubs(root, over = {}) {
  const calls = { generate: 0, edit: [], unload: 0, ask: 0, model: [], place: 0, audio: [] };
  const worker = {
    generate: async ({ out }) => { calls.generate++; await png(out, '#335577'); return { ok: true, out }; },
    edit: async (items) => {
      calls.edit.push(items.map((i) => i.id));
      const out = [];
      for (const it of items) {
        if (it.id.startsWith('plate')) await png(it.out, '#eeeeee'); else await png(it.out, '#ffffff', 64, 64);
        if (!it.id.startsWith('plate')) { // a "single object" on white: dark square in the middle
          await sharp(it.out).composite([{ input: { create: { width: 24, height: 24, channels: 3, background: '#553311' } }, left: 20, top: 20 }]).png().toFile(it.out + '.t'); fs.renameSync(it.out + '.t', it.out);
        }
        out.push({ id: it.id, ok: true, out: it.out });
      }
      return { ok: true, items: out, stats: {} };
    },
    unload: async () => { calls.unload++; },
    shutdown: async () => {},
  };
  const surveyJson = JSON.stringify(raw());
  const oracle = { ask: async () => { calls.ask++; return surveyJson; } };
  const services = {
    worker,
    generateModel: async ({ prompt, image }) => {
      calls.model.push(prompt);
      assert.ok(fs.existsSync(image), 'the isolation image exists');
      const slug = `m-${calls.model.length}`;
      fs.writeFileSync(path.join(root, 'public', 'assets', 'generated', `${slug}.glb`), makeGlb([-0.4, 0, -0.4], [0.4, 1, 0.4]));
      return { url: `/assets/generated/${slug}.glb`, slug, meta: {} };
    },
    generatePlace: async () => { calls.place++; return { slug: 'blast-place', url: '/p.jpg', preview: '/t.webp' }; },
    requestAudio: async ({ prompt, loop }) => {
      calls.audio.push(prompt);
      const slug = `a-${calls.audio.length}`;
      fs.mkdirSync(path.join(root, 'public', 'assets', 'generated', 'audio', 'sfx'), { recursive: true });
      fs.writeFileSync(path.join(root, 'public', 'assets', 'generated', 'audio', 'sfx', `${slug}.ogg`), Buffer.alloc(200, 1));
      return { url: `/assets/generated/audio/sfx/${slug}.ogg`, slug };
    },
    ...over.services,
  };
  const sent = [];
  const svc = createBlast({ root, send: (m) => sent.push(m), log: () => {}, oracle: over.oracle === undefined ? oracle : over.oracle, services });
  return { svc, calls, sent, services };
}

test('pipeline: stages in order, manifest, project folder, cache index', async () => {
  const root = await makeRoot();
  const { svc, calls, sent } = stubs(root);
  const m = await svc.request({ id: 'c1', prompt: "a wizard's study at night", options: { maxObjects: 4 } });
  assert.ok(m, 'a manifest came back');
  const stages = sent.filter((s) => s.id === 'c1').map((s) => `${s.stage}:${s.state}`);
  const firstOf = (k) => stages.findIndex((s) => s.startsWith(k));
  const order = ['queued', 'image', 'uncover', 'plate', 'place', 'objects', 'layout', 'sounds', 'done'].map(firstOf);
  assert.deepEqual([...order].sort((a, b) => a - b), order, `stage order: ${stages.join(' ')}`);
  assert.ok(stages.includes('image:done') && stages.includes('done:done') && stages.includes('layout:done'));
  const imageDone = sent.find((s) => s.stage === 'image' && s.state === 'done');
  assert.match(imageDone.result.image, /^\/assets\/generated\/blasts\/.+\/source\/0-.+\.png$/);
  assert.equal(m.objects.length, 4);
  assert.ok(m.objects.every((o) => o.url.endsWith('model.glb') && o.position.length === 3 && o.scale > 0 && o.mass > 0));
  assert.equal(m.place.slug, 'blast-place');
  assert.ok(m.ambient && m.ambient.url.includes('/blasts/'), 'ambient copied into the project');
  assert.ok(m.objects.some((o) => o.sound), 'impact sounds attached');
  assert.equal(calls.edit.length, 1, 'plate and all references are ONE batch when the checks pass');
  assert.equal(calls.edit[0][0], 'plate');
  assert.ok(calls.unload >= 1, 'the image worker is unloaded before the 3D stage');
  assert.equal(calls.ask, 1, 'one model call per blast');
  const dir = path.join(root, 'public', 'assets', 'generated', 'blasts', m.slug);
  for (const f of ['project.json', 'image.json', 'manifest.json', `source/0-${m.slug}.png`, `source/1-${m.slug}-plate.png`, `output/world/place.json`, 'output/sfx/ambient.ogg']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.ok(fs.existsSync(path.join(dir, 'output', m.objects[0].id, 'object.json')));
  const idx = JSON.parse(fs.readFileSync(path.join(root, 'public', 'assets', 'generated', 'blasts', 'index.json'), 'utf8'));
  assert.ok(idx[m.slug].thumb && idx[m.slug].objects === 4);
  assert.equal(svc.list().length, 1);
  // the objects stage announced every object as it came out
  const popped = sent.filter((s) => s.stage === 'objects' && s.result?.object?.ok);
  assert.equal(popped.length, 4);
  assert.ok(popped.every((p) => p.result.object.url && p.result.object.from?.box));
});

test('cache: same prompt again answers at once without any service call; resume skips finished stages', async () => {
  const root = await makeRoot();
  const a = stubs(root);
  const m1 = await a.svc.request({ id: 'x', prompt: 'a cave with treasure' });
  const before = JSON.stringify(a.calls);
  const m2 = await a.svc.request({ id: 'y', prompt: 'A cave with   treasure!' });   // normalised: same slug
  assert.equal(m2.slug, m1.slug);
  assert.equal(JSON.stringify(a.calls), before, 'no service was called');
  assert.ok(a.sent.some((s) => s.id === 'y' && s.stage === 'done' && s.state === 'done'));
  // new service instance, project half done: remove the manifest + status, keep the files -> only layout/sounds-ish work is redone
  const dir = path.join(root, 'public', 'assets', 'generated', 'blasts', m1.slug);
  fs.rmSync(path.join(dir, 'manifest.json')); fs.rmSync(path.join(dir, 'output', 'world'), { recursive: true });
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')); delete p.status; fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(p));
  const b = stubs(root);
  const m3 = await b.svc.request({ id: 'z', prompt: 'a cave with treasure' });
  assert.equal(m3.objects.length, m1.objects.length);
  assert.equal(b.calls.generate, 0, 'image not regenerated');
  assert.equal(b.calls.ask, 0, 'survey not asked again');
  assert.equal(b.calls.edit.length, 0, 'no edits again');
  assert.equal(b.calls.model.length, 0, 'no models again');
  assert.equal(b.calls.place, 1, 'only the missing place is made');
  assert.equal(b.calls.audio.length, 0, 'sounds are kept');
  // force redoes everything
  const c = stubs(root);
  await c.svc.request({ id: 'w', prompt: 'a cave with treasure', options: { force: true } });
  assert.equal(c.calls.generate, 1);
});

test('uncover: invalid JSON is retried once with the error fed back, then degrades', async () => {
  const root = await makeRoot();
  let n = 0;
  const inputs = [];
  const oracle = { ask: async (input) => { inputs.push(input); n++; return n === 1 ? 'Sure! {"scene_name": "x", "objects": [ oops' : JSON.stringify(raw()); } };
  const s1 = stubs(root, { oracle });
  const m = await s1.svc.request({ id: 'r', prompt: 'retry me' });
  assert.equal(n, 2);
  assert.match(inputs[1], /not valid JSON/);
  assert.ok(m.objects.length > 0);
  const root2 = await makeRoot();
  const s2 = stubs(root2, { oracle: { ask: async () => 'total nonsense' } });
  const m2 = await s2.svc.request({ id: 'r2', prompt: 'a quiet room with a chair' });
  assert.ok(m2, 'still a result');
  assert.equal(m2.objects.length, 0, 'no survey -> no objects');
  assert.ok(m2.place, 'but the place is built from the picture');
  assert.equal(m2.stats.degraded, true);
  assert.equal(s2.calls.edit.length, 0);
  const root3 = await makeRoot();
  const s3 = stubs(root3, { oracle: null });
  const m3 = await s3.svc.request({ id: 'r3', prompt: 'no oracle' });
  assert.ok(m3 && m3.objects.length === 0 && m3.place);
});

test('degradation: no edit worker, no 3D, no place, no audio, failing objects', async () => {
  let root = await makeRoot();
  let s = stubs(root, { services: { worker: null } });
  assert.equal(await s.svc.request({ id: 'a', prompt: 'no worker' }), null, 'without any image worker there is no picture and so no blast');
  assert.ok(s.sent.some((x) => x.stage === 'image' && x.state === 'error'));

  root = await makeRoot();
  s = stubs(root, { services: { generatePlace: undefined, requestAudio: null } });
  s.services.generatePlace = null;
  s = stubs(root, { services: { generatePlace: null, requestAudio: null } });
  const m = await s.svc.request({ id: 'b', prompt: 'no place no audio' });
  assert.equal(m.place, null);
  assert.equal(m.ambient, null);
  assert.ok(m.objects.length > 0 && m.objects.every((o) => o.sound === null));
  assert.ok(m.warnings.some((w) => /place/.test(w)) && m.warnings.some((w) => /audio/.test(w)));

  root = await makeRoot();
  let k = 0;
  s = stubs(root, { services: { generateModel: async ({ image }) => { k++; if (k % 2 === 0) return null; if (k === 3) throw new Error('boom'); const slug = `q${k}`; fs.writeFileSync(path.join(root, 'public', 'assets', 'generated', `${slug}.glb`), makeGlb([-0.5, 0, -0.5], [0.5, 1, 0.5])); return { url: `/assets/generated/${slug}.glb`, slug }; } } });
  const m2 = await s.svc.request({ id: 'c', prompt: 'some objects fail' });
  assert.ok(m2.objects.length >= 1 && m2.objects.length < 4, `objects that failed are skipped (${m2.objects.length})`);
  assert.ok(m2.place);

  root = await makeRoot();
  s = stubs(root, { services: { worker: { generate: async () => { throw new Error('gpu on fire'); }, edit: async () => ({ ok: false, error: 'x', items: [] }), unload: async () => {} } } });
  assert.equal(await s.svc.request({ id: 'd', prompt: 'worker throws' }), null);   // never throws into the caller
});

test('edit failures: the plate is skipped, the place uses the picture; weak references still produce objects', async () => {
  const root = await makeRoot();
  const s = stubs(root, { services: { worker: { generate: async ({ out }) => { await png(out, '#224466'); return { ok: true, out }; }, edit: async () => ({ ok: false, error: 'no edit model', items: [] }), unload: async () => {} } } });
  const m = await s.svc.request({ id: 'e', prompt: 'edit model missing' });
  assert.ok(m);
  assert.equal(m.plate, null);
  assert.equal(m.objects.length, 0);
  assert.ok(m.place, 'the place is built from the source picture');
  assert.equal(s.calls.place, 1);
});

test('plate retry: objects left in place trigger a second pass naming only them', async () => {
  const root = await makeRoot();
  const s = stubs(root);
  const orig = s.services.worker.edit;
  let first = true;
  s.services.worker.edit = async (items) => {
    if (first && items[0].id === 'plate') { first = false; const r = await orig(items); await png(items[0].out, '#335577'); return r; }   // plate identical to the source: nothing was removed
    return orig(items);
  };
  const m = await s.svc.request({ id: 'p', prompt: 'stubborn clutter' });
  assert.ok(m);
  assert.ok(s.calls.edit.length >= 2, `a retry batch ran (${JSON.stringify(s.calls.edit)})`);
  assert.ok(s.calls.edit[1].includes('plate2'));
});

test('budget: with no time left the objects are skipped and the blast still finishes', async () => {
  const root = await makeRoot();
  const s = stubs(root);
  const m = await s.svc.request({ id: 'bud', prompt: 'hurry', options: { budgetMs: 60000 } });   // the minimum budget is 60 s, and 3.5 min are always kept for the place
  assert.ok(m);
  assert.equal(m.objects.length, 0);
  assert.ok(m.warnings.some((w) => /out of time/.test(w)));
  assert.ok(m.place, 'the place still gets made');
});

test('image input: validation of the path and the file', async () => {
  const root = await makeRoot();
  const s = stubs(root);
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.png`);
  await png(outside, '#ff0000');
  await png(path.join(root, 'input', 'castle.png'), '#aa8844');
  fs.writeFileSync(path.join(root, 'input', 'fake.png'), Buffer.from('this is not a picture at all, just text'.repeat(10)));
  fs.writeFileSync(path.join(root, 'input', 'notes.txt'), 'hello'.repeat(50));
  const bad = async (image) => { const before = s.sent.length; const r = await s.svc.request({ id: `v${before}`, image }); assert.equal(r, null, String(image)); const last = s.sent.at(-1); assert.equal(last.state, 'error'); assert.match(last.message, /Bad picture/); return last.message; };
  assert.match(await bad(outside), /inside the game folder/);
  assert.match(await bad('..\\..\\Windows\\win.ini'), /inside the game folder/);
  assert.match(await bad('input/../../x.png'), /inside the game folder/);
  assert.match(await bad('notes.txt'), /\.png, \.jpg or \.webp/);
  assert.match(await bad('fake.png'), /not a picture/);
  assert.match(await bad('missing.png'), /ENOENT|no such file/i);
  // a good picture by bare name (input folder) and by relative path: both work and give the same project
  const m1 = await s.svc.request({ id: 'g1', image: 'castle.png' });
  assert.ok(m1);
  assert.ok(fs.readFileSync(path.join(root, 'public', 'assets', 'generated', 'blasts', m1.slug, 'source', `0-${m1.slug}.png`)).length > 100);
  assert.equal(s.calls.generate, 0, 'a given picture is never regenerated');
  const m2 = await s.svc.request({ id: 'g2', image: 'input/castle.png' });
  assert.equal(m2.slug, m1.slug);
  assert.equal(m1.prompt, null);
  fs.rmSync(outside, { force: true });
  assert.equal(await s.svc.request({ id: 'g3' }), null, 'neither prompt nor picture');
});

test('status replay for late clients (hot reload) and blast_get on a finished project', async () => {
  const root = await makeRoot();
  const s = stubs(root);
  const m = await s.svc.request({ id: 'orig', prompt: 'replay me', options: { maxObjects: 3 } });
  const got = [];
  s.svc.replay('late', m.slug, (x) => got.push(x));
  assert.ok(got.length >= 5);
  assert.ok(got.every((g) => g.replay === true && g.id === 'late'));
  assert.equal(got.filter((g) => g.stage === 'objects' && g.result?.object).length, 3, 'every object that came out is replayed');
  assert.equal(got.at(-1).stage, 'done');
  assert.equal(got.at(-1).result.slug, m.slug);
  const unknown = [];
  s.svc.replay('late2', 'nothing-here', (x) => unknown.push(x));
  assert.equal(unknown[0].state, 'error');
  // a fresh server (nothing in memory) still replays from the manifest on disk
  const s2 = stubs(root);
  const got2 = [];
  s2.svc.replay('late3', m.slug, (x) => got2.push(x));
  assert.equal(got2.at(-1).result.slug, m.slug);
});

test('plugin: message handlers, blast_list, blast_inputs, blast_get, never throws', async () => {
  const root = await makeRoot();
  const { default: plugin } = await import('../plugins/blast.js');
  const broadcast = [], replies = [];
  const api = { root, publicDir: path.join(root, 'public'), cacheDir: path.join(root, '.cache'), broadcast: (m) => broadcast.push(m), reply: (_ws, m) => replies.push(m), notice() {}, log() {}, files: null, oracle: { ask: async () => '' }, services: {}, sapiTts: null };
  await png(path.join(root, 'input', 'a.png'), '#112233');
  fs.writeFileSync(path.join(root, 'input', 'readme.txt'), 'x');
  const p = await plugin(api);
  assert.equal(p.name, 'blast');
  assert.deepEqual(Object.keys(p.messages).sort(), ['blast', 'blast_get', 'blast_inputs', 'blast_list']);
  await p.messages.blast_inputs({ id: 'i1' }, {});
  assert.deepEqual(replies.at(-1).files.map((f) => f.name), ['a.png']);
  assert.equal(replies.at(-1).files[0].path, 'input/a.png');
  await p.messages.blast_list({ id: 'l1' }, {});
  assert.deepEqual(replies.at(-1).projects, []);
  await p.messages.blast_get({ id: 'g1', slug: 'nothing-here' }, {});
  assert.equal(replies.at(-1).state, 'error');
  // junk never throws
  await p.messages.blast({ prompt: 42 }, {});
  await p.messages.blast({}, {});
  await p.messages.blast({ id: 'bad', image: '../../x.png' }, {});
  assert.ok(broadcast.some((m) => m.id === 'bad' && m.state === 'error'));
  assert.equal(typeof p.status().cached, 'number');
  await p.shutdown();
});

test('a second request for the same scene while it is running attaches to it', async () => {
  const root = await makeRoot();
  const s = stubs(root);
  const a = s.svc.request({ id: 'one', prompt: 'twice at once' });
  const b = s.svc.request({ id: 'two', prompt: 'twice at once' });
  const [ma, mb] = await Promise.all([a, b]);
  assert.equal(ma.slug, mb.slug);
  assert.equal(s.calls.generate, 1);
  assert.ok(s.sent.some((x) => x.id === 'two' && x.stage === 'done'));
});
