// catalog.mjs — loads every shipped GLB with three's GLTFLoader (headless) and writes public/assets/catalog.json.
//   node public/assets/_build/catalog.mjs
// Metrics are measured on the real parsed scene (bind pose, default-visible equipment only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installStubs } from './nodestubs.mjs';
installStubs();
const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const sel = JSON.parse(fs.readFileSync(path.join(HERE, 'selection.json'), 'utf8').replace(/^﻿/, ''));
const loader = new GLTFLoader();
const round = (v, n = 3) => +v.toFixed(n);

function parse(file, baseUrl) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => loader.parse(ab, baseUrl, res, rej));
}

function measure(gltf) {
  const scene = gltf.scene;
  scene.traverse((o) => { if (o.userData?.equip && !o.userData.default) o.visible = false; });
  scene.updateMatrixWorld(true);
  let tris = 0, draws = 0, skinned = null, meshes = 0;
  const mats = new Set(), texs = new Set(), texFiles = new Set();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    let hidden = false; for (let p = o; p; p = p.parent) if (p.visible === false) hidden = true;
    if (hidden) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const ms = [].concat(o.material);
    draws += ms.length;
    for (const m of ms) { mats.add(m); for (const v of Object.values(m)) if (v?.isTexture) { texs.add(v); if (v.name) texFiles.add(v.name); } }
    if (o.isSkinnedMesh) { skinned ??= []; skinned.push(o); o.skeleton.update(); }
  });
  // Box3.setFromObject ignores .visible, so walk by hand
  const box = new THREE.Box3(), tmpBox = new THREE.Box3();
  (function walk(o) { if (o.visible === false) return; if (o.isMesh) { tmpBox.makeEmpty().expandByObject(o, true); box.union(tmpBox); } o.children.forEach(walk); })(scene);
  const size = box.getSize(new THREE.Vector3());
  const bones = skinned ? Math.max(...skinned.map((s) => s.skeleton.bones.length)) : 0;
  return { tris: Math.round(tris), draws, meshes, materials: mats.size, textures: texs.size, texFiles: [...texFiles], bones, rigged: !!skinned, size: [round(size.x), round(size.y), round(size.z)], min: [round(box.min.x), round(box.min.y), round(box.min.z)] };
}

// Recommended uniform scale that brings a model to roughly human scale (1 unit = 1 m, a person ~1.8 m).
// KayKit character/dungeon/halloween/furniture packs share one chunky scale (knight = 2.3 units tall): x0.8 makes the knight ~1.85 m.
const ANIMAL_M = { bunny: .3, cat: .35, dog: .55, fox: .5, pig: .9, hog: .9, cow: 1.5, deer: 1.6, elephant: 3, giraffe: 5, lion: 1.2, tiger: 1.2, panda: 1.0, polar: 1.6, koala: .6, monkey: .8, parrot: .35, penguin: .7, beaver: .4, bee: .2, caterpillar: .2, chick: .2, crab: .25, fish: .35 };
function recommendedScale(name, m, h) {
  const tags = m.tags || [];
  switch (m.pack) {
    case 'kaykit-adventurers': case 'kaykit-skeletons': case 'kaykit-dungeon': case 'kaykit-halloween': case 'kaykit-furniture': return 0.8;
    case 'kaykit-medieval': return 5;
    case 'kenney-castle': case 'kenney-town': return 4;
    case 'kenney-survival': return 3;
    case 'kenney-pirate': return 1;
    case 'kenney-characters': return 2.6;
    case 'kenney-graveyard': return 2.2;
    case 'kenney-blasters': return 1;
    case 'kenney-pets': { return ANIMAL_M[name] ? +(ANIMAL_M[name] / h).toFixed(3) : 0.3; }
    case 'kenney-nature': return tags.includes('tree') ? 6 : /rock|stone/.test(name) ? 4 : /fence|bridge|statue|tent|campfire|canoe|bed|sign|pot/.test(name) ? 3 : 3;
  }
  return 1;
}

const catalog = { version: 1, generated: new Date().toISOString().slice(0, 10), models: {}, animations: {}, packs: sel.packs };
for (const [id, a] of Object.entries(sel.animations)) {
  const g = await parse(path.join(OUT, a.url.replace('/assets/', '')), path.dirname(a.url) + '/');
  catalog.animations[id] = { url: a.url, pack: a.pack, rig: a.rig, title: a.title, clips: g.animations.map((c) => c.name), durations: Object.fromEntries(g.animations.map((c) => [c.name, round(c.duration, 2)])) };
}
let n = 0;
const names = Object.keys(sel.models).sort();
for (const name of names) {
  const m = sel.models[name];
  const file = path.join(OUT, m.url.replace('/assets/', ''));
  const gltf = await parse(file, path.dirname(m.url) + '/');
  const me = measure(gltf);
  const own = gltf.animations.map((c) => c.name).filter((c) => c !== 'static');
  const setClips = (m.animSets || []).flatMap((s) => catalog.animations[s].clips);
  const clips = [...new Set([...own, ...setClips])];
  const entry = {
    url: m.url, pack: m.pack, category: m.category, tris: me.tris, size: me.size, min: me.min,
    rigged: me.rigged, clips,
    tags: [...new Set((m.tags || []).map((t) => String(t).toLowerCase()).filter(Boolean))],
    license: sel.packs[m.pack].license,
  };
  entry.height = round(m.stand ?? me.size[1], 3);
  entry.scale = recommendedScale(name, m, entry.height);
  if (m.rig) entry.rig = m.rig;
  if (m.animSets) entry.animSets = m.animSets;
  if (me.bones) entry.bones = me.bones;
  entry.draws = me.draws; entry.materials = me.materials;
  if (own.length) entry.ownClips = own.length;
  if (own.length && !me.rigged) entry.animated = 'nodes'; // clips animate plain nodes (rigid parts), no skinning
  if (m.equipment) entry.equipment = m.equipment;
  if (m.attach) entry.attach = m.attach;
  entry.atlas = me.texFiles.length ? me.texFiles[0] : null;
  if (!entry.atlas) delete entry.atlas;
  catalog.models[name] = entry;
  n++;
}
// pack-level texture list
for (const id of Object.keys(catalog.packs)) {
  const dir = path.join(OUT, id);
  catalog.packs[id].textures = fs.readdirSync(dir).filter((f) => /\.(png|jpg|webp)$/.test(f)).map((f) => {
    const b = fs.readFileSync(path.join(dir, f));
    return { file: f, width: b.readUInt32BE(16), height: b.readUInt32BE(20), kb: Math.round(b.length / 1024) };
  });
  catalog.packs[id].models = Object.values(catalog.models).filter((m) => m.pack === id).length;
  catalog.packs[id].bytes = fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0);
}
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify(catalog));
console.log(`catalog: ${n} models, ${Object.keys(catalog.animations).length} animation sets, ${(fs.statSync(path.join(OUT, 'catalog.json')).size / 1024).toFixed(0)} KB`);



