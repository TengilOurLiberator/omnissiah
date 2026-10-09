// finalize_gear.mjs -- raw Blender GLB -> shipped hero GLB (shared external palette texture, canonical sampler, compact buffer, optional node clips).
//   node finalize_gear.mjs name1 name2 ...        reads .cache/gear/export/<name>_raw.glb, writes public/assets/hero/<name>.glb
// Options per model are in OPTS below (doubleSided for open shells like hoods; clips = node animation specs in glTF space).
import fs from 'fs';
import { readGlb, writeGlb, compact, externalizePalette } from './glbtools.mjs';

const RAW = 'D:/omnissiah/.cache/gear/export', OUT = 'D:/omnissiah/public/assets/hero';
export const OPTS = JSON.parse(fs.readFileSync(new URL('./gear_opts.json', import.meta.url), 'utf8'));

// ---- node animation: clips = { name: { duration, tracks: [{ node, path: 'rotation'|'translation', axis:[x,y,z] (rotation), keys: [[t, value]] }] } }
//      rotation value = degrees about `axis` (applied on top of the node's rest rotation); translation value = [dx,dy,dz] added to the rest translation.
function addClips(json, bin, clips) {
  const chunks = [bin]; let len = bin.length;
  const push = (arr) => {
    const pad = (4 - (len % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); len += pad; }
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const view = { buffer: 0, byteOffset: len, byteLength: b.length };
    chunks.push(b); len += b.length;
    json.bufferViews.push(view); return json.bufferViews.length - 1;
  };
  json.accessors ||= []; json.bufferViews ||= []; json.animations = [];
  const byName = new Map(json.nodes.map((n, i) => [n.name, i]));
  for (const [cname, clip] of Object.entries(clips)) {
    const anim = { name: cname, samplers: [], channels: [] };
    for (const tr of clip.tracks) {
      const ni = byName.get(tr.node);
      if (ni === undefined) throw new Error(`clip ${cname}: node ${tr.node} not found (have ${[...byName.keys()].join(',')})`);
      const node = json.nodes[ni];
      const times = new Float32Array(tr.keys.map((k) => k[0]));
      const tIn = json.accessors.push({ bufferView: push(times), componentType: 5126, count: times.length, type: 'SCALAR', min: [Math.min(...times)], max: [Math.max(...times)] }) - 1;
      let out, type;
      if (tr.path === 'rotation') {
        const r0 = node.rotation || [0, 0, 0, 1], ax = tr.axis, al = Math.hypot(...ax);
        out = new Float32Array(tr.keys.length * 4);
        tr.keys.forEach((k, i) => {
          const h = (k[1] * Math.PI / 180) / 2, s = Math.sin(h) / al, q = [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)];
          // result = r0 * q  (rotate about the node's own axis after its rest rotation)
          const [x1, y1, z1, w1] = r0, [x2, y2, z2, w2] = q;
          out.set([w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2, w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2, w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2], i * 4);
        });
        type = 'VEC4';
      } else {
        const t0 = node.translation || [0, 0, 0];
        out = new Float32Array(tr.keys.length * 3);
        tr.keys.forEach((k, i) => out.set([t0[0] + k[1][0], t0[1] + k[1][1], t0[2] + k[1][2]], i * 3));
        type = 'VEC3';
      }
      const tOut = json.accessors.push({ bufferView: push(out), componentType: 5126, count: tr.keys.length, type }) - 1;
      anim.samplers.push({ input: tIn, output: tOut, interpolation: 'LINEAR' });
      anim.channels.push({ sampler: anim.samplers.length - 1, target: { node: ni, path: tr.path } });
    }
    json.animations.push(anim);
  }
  return Buffer.concat(chunks);
}

export function finalizeOne(name) {
  const { json, bin } = readGlb(`${RAW}/${name}_raw.glb`);
  externalizePalette(json);
  json.asset = { version: '2.0', generator: 'omnissiah gear (Blender glTF exporter + finalize_gear.mjs)' };
  const o = OPTS[name] || {};
  for (const m of json.materials || []) {
    if (m.name === 'Emissive') m.emissiveFactor = [1, 1, 1];
    if (o.double) m.doubleSided = true;
    delete m.extensions;
  }
  json.extensionsUsed = (json.extensionsUsed || []).filter((e) => json.materials?.some((m) => m.extensions && e in m.extensions));
  if (!json.extensionsUsed.length) delete json.extensionsUsed;
  delete json.extensionsRequired;
  let nb = compact(json, bin);
  if (o.clips) nb = addClips(json, nb, o.clips);
  json.buffers = [{ byteLength: nb.length }];
  writeGlb(`${OUT}/${name}.glb`, json, nb);
  return `${OUT}/${name}.glb`;
}

if (process.argv[1] && process.argv[1].endsWith('finalize_gear.mjs')) {
  for (const n of process.argv.slice(2)) console.log('finalized', finalizeOne(n), fs.statSync(`${OUT}/${n}.glb`).size, 'bytes');
}
