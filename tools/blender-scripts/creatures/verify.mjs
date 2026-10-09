// verify.mjs -- load hero GLBs with three's GLTFLoader (texture stub) and report tris / materials / bbox / skin / clips;
// for rigged derivatives diff the skeleton against a shipped KayKit character.
//   node verify.mjs <file.glb> [--ref /abs/path/shipped.glb] [--json]
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readGlb } from './glbtools.mjs';

function makeLoader() {
  const loader = new GLTFLoader();
  loader.register((parser) => ({ name: 'stub_tex', loadTexture(idx) { const t = new THREE.Texture(); t.name = 'stub' + idx; return Promise.resolve(t); } }));
  return loader;
}
export async function load(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return makeLoader().parseAsync(ab, path.dirname(file) + '/');
}

export function stats(gltf, file) {
  const raw = readGlb(file).json;
  let tris = 0, skinned = false; const mats = new Set(); const box = new THREE.Box3(); const meshes = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry; const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    tris += n; meshes.push(o.name + ':' + n);
    [].concat(o.material).forEach((m) => mats.add(m.name));
    if (o.isSkinnedMesh) { skinned = true; const b = new THREE.Box3().setFromBufferAttribute(g.attributes.position); box.union(b); }
    else box.union(new THREE.Box3().setFromObject(o));
  });
  const size = box.getSize(new THREE.Vector3());
  const bones = []; gltf.scene.traverse((o) => { if (o.isBone) bones.push(o.name); });
  const imgs = (raw.images || []).map((i) => i.uri || ('embedded:' + i.mimeType));
  return {
    file: path.basename(file), kb: Math.round(fs.statSync(file).size / 1024), tris, meshes: meshes.length, materials: [...mats], images: imgs, skinned, bones: bones.length,
    clips: gltf.animations.map((a) => `${a.name}:${a.duration.toFixed(2)}s`),
    size: size.toArray().map((x) => +x.toFixed(3)), min: box.min.toArray().map((x) => +x.toFixed(3)), max: box.max.toArray().map((x) => +x.toFixed(3)),
    nodes: raw.nodes.length, extensions: raw.extensionsUsed || [],
  };
}

// compare skeletons: bone names, parent names, local matrices, world matrices, inverse bind matrices
export function rigDiff(gltfA, gltfB) {
  const collect = (g) => {
    g.scene.updateMatrixWorld(true);
    const m = new Map(); const order = [];
    g.scene.traverse((o) => { if (o.isBone) { m.set(o.name, o); order.push(o.name); } });
    let sk = null; g.scene.traverse((o) => { if (o.isSkinnedMesh) sk = o.skeleton; });
    return { m, order, sk };
  };
  const A = collect(gltfA), B = collect(gltfB);
  const out = { sameNames: A.order.join() === B.order.join(), nA: A.order.length, nB: B.order.length, maxLocal: 0, maxWorld: 0, maxIBM: 0, parentMismatch: [], worst: '' };
  const maxAbs = (a, b) => { let d = 0; for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(a.elements[i] - b.elements[i])); return d; };
  for (const [name, a] of A.m) {
    const b = B.m.get(name);
    if (!b) { out.parentMismatch.push('missing ' + name); continue; }
    if ((a.parent?.name) !== (b.parent?.name)) out.parentMismatch.push(name);
    a.updateMatrix(); b.updateMatrix();
    const dl = maxAbs(a.matrix, b.matrix); const dw = maxAbs(a.matrixWorld, b.matrixWorld);
    if (dl > out.maxLocal) { out.maxLocal = dl; out.worst = name; }
    out.maxWorld = Math.max(out.maxWorld, dw);
  }
  if (A.sk && B.sk) {
    const ia = new Map(A.sk.bones.map((b, i) => [b.name, A.sk.boneInverses[i]]));
    for (let i = 0; i < B.sk.bones.length; i++) { const x = ia.get(B.sk.bones[i].name); if (x) out.maxIBM = Math.max(out.maxIBM, maxAbs(x, B.sk.boneInverses[i])); else out.parentMismatch.push('skin bone missing ' + B.sk.bones[i].name); }
    out.skinBoneOrderSame = A.sk.bones.map((b) => b.name).join() === B.sk.bones.map((b) => b.name).join();
  }
  out.pass = out.sameNames && !out.parentMismatch.length && out.maxLocal < 1e-4 && out.maxWorld < 1e-4 && out.maxIBM < 1e-4;
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('verify.mjs')) {
  const args = process.argv.slice(2);
  const refIdx = args.indexOf('--ref');
  const ref = refIdx >= 0 ? args.splice(refIdx, 2)[1] : null;
  const files = args.filter((a) => !a.startsWith('--'));
  const refG = ref ? await load(ref) : null;
  for (const f of files) {
    const g = await load(f);
    const s = stats(g, f);
    console.log(JSON.stringify(s));
    if (refG && s.skinned) console.log('  rigDiff vs ' + path.basename(ref) + ': ' + JSON.stringify(rigDiff(refG, g)));
  }
}
