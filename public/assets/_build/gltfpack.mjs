// gltfpack.mjs — tiny dependency-free glTF/GLB re-packer used to curate the asset packs (offline build step, Node only).
// It never runs in the game. See docs/ASSETS.md ("Adding more assets").
//
//   rebuild(gltf, opts) -> { json, bin }      writeGlb(json, bin) -> Buffer
//
// What a rebuild does:
//   * keeps only the accessors/bufferViews that are still referenced (drops embedded images, unused animations, IK nodes…)
//   * images become external relative URIs (so one shared atlas file per pack, loaded once by models.js)
//   * identity KHR_texture_transform entries are removed (they force a texture clone per material in GLTFLoader)
//   * optional: merge all skinned meshes (+ rigid hats/capes parented to bones) into ONE mesh per material, drop unused joints
//   * optional: prune animation tracks (IK/control bones, constant translation/scale tracks)
import fs from 'node:fs';
import path from 'node:path';

export function readGltf(file) {
  const buf = fs.readFileSync(file);
  let json, bin = null;
  if (buf.readUInt32LE(0) === 0x46546c67) {
    let off = 12;
    while (off < buf.length) {
      const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
      const data = buf.subarray(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
      else if (type === 0x004e4942 && !bin) bin = Buffer.from(data);
      off += 8 + len;
    }
  } else {
    json = JSON.parse(buf.toString('utf8'));
    const b = json.buffers?.[0];
    if (b?.uri && !b.uri.startsWith('data:')) bin = fs.readFileSync(path.join(path.dirname(file), decodeURIComponent(b.uri)));
    else if (b?.uri) bin = Buffer.from(b.uri.split(',')[1], 'base64');
  }
  return { json, bin, file, dir: path.dirname(file) };
}

export function writeGlb(json, bin) {
  const pad4 = (n) => (n + 3) & ~3;
  const js = Buffer.from(JSON.stringify(json), 'utf8');
  const jl = pad4(js.length), bl = pad4(bin.length);
  const out = Buffer.alloc(12 + 8 + jl + (bin.length ? 8 + bl : 0), 0);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jl, 12); out.writeUInt32LE(0x4e4f534a, 16);
  js.copy(out, 20); out.fill(0x20, 20 + js.length, 20 + jl);
  if (bin.length) {
    out.writeUInt32LE(bl, 20 + jl); out.writeUInt32LE(0x004e4942, 24 + jl);
    bin.copy(out, 28 + jl);
  }
  return out;
}

const COMP = { 5120: [1, Int8Array, 'getInt8'], 5121: [1, Uint8Array, 'getUint8'], 5122: [2, Int16Array, 'getInt16'], 5123: [2, Uint16Array, 'getUint16'], 5125: [4, Uint32Array, 'getUint32'], 5126: [4, Float32Array, 'getFloat32'] };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const CTYPE = new Map([[Float32Array, 5126], [Uint32Array, 5125], [Uint16Array, 5123], [Uint8Array, 5121], [Int16Array, 5122], [Int8Array, 5120]]);

export function readAccessor(g, i) {
  const a = g.json.accessors[i];
  if (a.sparse) throw new Error('sparse accessors are not supported');
  const bv = g.json.bufferViews[a.bufferView];
  const [sz, Arr, getter] = COMP[a.componentType];
  const n = NUM[a.type];
  const stride = bv.byteStride || sz * n;
  const out = new Arr(a.count * n);
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset, g.bin.byteLength);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[getter](base + k * stride + c * sz, true);
  return out;
}

class Builder {
  constructor() { this.chunks = []; this.len = 0; this.bufferViews = []; this.accessors = []; this.imageBytes = []; }
  addBytes(buf) {
    const pad = (4 - (this.len & 3)) & 3;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.len += pad; }
    const off = this.len;
    this.chunks.push(buf); this.len += buf.length;
    return off;
  }
  addAccessor(arr, type, { target, normalized, minmax } = {}) {
    const off = this.addBytes(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
    const view = { buffer: 0, byteOffset: off, byteLength: arr.byteLength };
    if (target) view.target = target;
    this.bufferViews.push(view);
    const n = NUM[type];
    const acc = { bufferView: this.bufferViews.length - 1, componentType: CTYPE.get(arr.constructor), count: arr.length / n, type };
    if (normalized) acc.normalized = true;
    if (minmax) {
      const min = new Array(n).fill(Infinity), max = new Array(n).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) { const c = i % n; if (arr[i] < min[c]) min[c] = arr[i]; if (arr[i] > max[c]) max[c] = arr[i]; }
      acc.min = min; acc.max = max;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }
  finish() { return Buffer.concat(this.chunks, this.len); }
}

// ---- small matrix helpers (column-major 4x4 like glTF)
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function trs(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
    (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
    (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1];
}
function inv(m) { // general 4x4 inverse
  const a = m, o = new Array(16);
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7], a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  d = 1 / d;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d; o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d; o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d; o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d; o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
  return o;
}

const isIdentityTT = (t) => {
  const off = t.offset || [0, 0], sc = t.scale || [1, 1];
  return Math.abs(off[0]) < 1e-6 && Math.abs(off[1]) < 1e-6 && Math.abs(sc[0] - 1) < 1e-6 && Math.abs(sc[1] - 1) < 1e-6 && Math.abs(t.rotation || 0) < 1e-6 && !(t.texCoord > 0);
};
function cleanTextureInfos(o) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(cleanTextureInfos); return; }
  const tt = o.extensions?.KHR_texture_transform;
  if (tt && typeof o.index === 'number' && isIdentityTT(tt)) {
    delete o.extensions.KHR_texture_transform;
    if (!Object.keys(o.extensions).length) delete o.extensions;
  }
  for (const k of Object.keys(o)) if (typeof o[k] === 'object') cleanTextureInfos(o[k]);
}
function collectExtensions(o, set) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach((x) => collectExtensions(x, set)); return; }
  if (o.extensions) for (const k of Object.keys(o.extensions)) set.add(k);
  for (const k of Object.keys(o)) if (k !== 'extensions' && typeof o[k] === 'object') collectExtensions(o[k], set);
}

/**
 * opts:
 *   imageUri(i, imageDef, bytes|null) -> string   REQUIRED (decide the external uri for each image; bytes = embedded data)
 *   dropNode(name, idx) -> bool                    remove node + subtree (IK helpers…)
 *   mergeSkinned: bool                             merge all skinned meshes into one mesh per material
 *   bakeRigid(name, idx, parentJointName) -> bool  (with mergeSkinned) bake rigid meshes under a bone into the merged skin mesh
 *   keepJoint(name) -> bool                        (with mergeSkinned) drop joints that carry no weights unless this says keep
 *   mergedName: string
 *   animations: false | true | (animDef, i) => bool
 *   trackFilter({ node, path, values, comp, rest }) -> bool
 *   noMeshes: bool                                 drop every mesh/skin (animation-only file)
 *   nodeExtras(name) -> object|undefined           extras to attach to retained nodes
 *   report: object                                 filled with stats
 */
export function rebuild(g, opts) {
  const J = g.json;
  const B = new Builder();
  const out = { asset: { version: '2.0', generator: 'omnissiah gltfpack' }, scene: 0, scenes: [{ name: J.scenes?.[J.scene ?? 0]?.name || 'Scene', nodes: [] }], nodes: [] };
  const nodes = J.nodes || [];
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  const world = new Array(nodes.length);
  const restWorld = (i) => (world[i] ??= mul(parent[i] >= 0 ? restWorld(parent[i]) : I4(), trs(nodes[i])));
  const dropped = new Set();
  const markDropped = (i) => { dropped.add(i); (nodes[i].children || []).forEach(markDropped); };
  nodes.forEach((n, i) => { if (opts.dropNode?.(n.name, i)) markDropped(i); });

  // ---- joint bookkeeping (skins)
  const skinJoints = (J.skins || []).map((s) => s.joints);
  const jointOf = new Map(); // node -> {skin, index}
  skinJoints.forEach((js, si) => js.forEach((nIdx, k) => { if (!jointOf.has(nIdx)) jointOf.set(nIdx, { skin: si, index: k }); }));
  const nearestJointAncestor = (i) => { for (let p = parent[i]; p >= 0; p = parent[p]) if (jointOf.has(p)) return p; return -1; };

  const accMap = new Map();
  const copyAccessor = (i, target) => {
    const key = i + ':' + (target || 0);
    if (accMap.has(key)) return accMap.get(key);
    const a = J.accessors[i];
    const arr = readAccessor(g, i);
    const idx = B.addAccessor(arr, a.type, { target, normalized: a.normalized, minmax: !!a.min });
    if (a.min && B.accessors[idx]) { B.accessors[idx].min = a.min; B.accessors[idx].max = a.max; }
    accMap.set(key, idx);
    return idx;
  };
  const copyPrimitive = (p) => {
    const np = { attributes: {} };
    for (const [k, v] of Object.entries(p.attributes)) np.attributes[k] = copyAccessor(v, 34962);
    if (p.indices !== undefined) np.indices = copyAccessor(p.indices, 34963);
    if (p.material !== undefined) np.material = p.material;
    if (p.mode !== undefined) np.mode = p.mode;
    if (p.extensions || p.targets) throw new Error('primitive extensions/morph targets not supported');
    return np;
  };

  // ---- mesh merging (skinned characters)
  const merge = (opts.mergeSkinned || opts.rigidToSkin) ? { groups: new Map(), skin: null, anchorParent: null, joints: null, skinnedNodes: new Set() } : null;
  let keptJoints = null, jointRemap = null;
  if (merge && opts.rigidToSkin) { // plain node-animated rig (no skin): every mesh node becomes a bone, parts baked into one skinned mesh
    merge.rigid = nodes.map((n, i) => i).filter((i) => nodes[i].mesh !== undefined && nodes[i].skin === undefined && !dropped.has(i));
    merge.rigidIndex = new Map(merge.rigid.map((i, k) => [i, k]));
    merge.anchorParent = -1;
  } else if (merge) {
    const skinnedNodes = nodes.map((n, i) => i).filter((i) => nodes[i].skin !== undefined && !dropped.has(i));
    const skinIdx = nodes[skinnedNodes[0]].skin;
    // several skins are fine when they share the same joints (Kenney exports one skin object per body part)
    const sameJoints = (a, b) => JSON.stringify(J.skins[a].joints) === JSON.stringify(J.skins[b].joints);
    if (skinnedNodes.some((i) => nodes[i].skin !== skinIdx && !sameJoints(nodes[i].skin, skinIdx))) throw new Error('skins with different joints');
    merge.skin = skinIdx; merge.skinnedNodes = new Set(skinnedNodes);
    merge.anchorParent = parent[skinnedNodes[0]];
    // which joints carry weights
    const used = new Set();
    for (const i of skinnedNodes) for (const p of J.meshes[nodes[i].mesh].primitives) {
      const jo = readAccessor(g, p.attributes.JOINTS_0), w = readAccessor(g, p.attributes.WEIGHTS_0);
      const wf = J.accessors[p.attributes.WEIGHTS_0].normalized ? (J.accessors[p.attributes.WEIGHTS_0].componentType === 5121 ? 255 : 65535) : 1;
      for (let k = 0; k < jo.length; k++) if (w[k] / wf > 0.001) used.add(jo[k]);
    }
    const sj = skinJoints[skinIdx];
    sj.forEach((nIdx, k) => { if (!dropped.has(nIdx) && opts.keepJoint?.(nodes[nIdx].name)) used.add(k); });
    // rigid parts need their ancestor joint
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.mesh === undefined || n.skin !== undefined || dropped.has(i)) continue;
      const aj = nearestJointAncestor(i);
      if (aj >= 0 && opts.bakeRigid?.(n.name, i, nodes[aj].name)) used.add(jointOf.get(aj).index);
    }
    keptJoints = sj.map((n, k) => k).filter((k) => used.has(k));
    jointRemap = new Map(keptJoints.map((k, newK) => [k, newK]));
    merge.joints = keptJoints;
  }
  const mergeIn = (key, posArr, norArr, uvArr, jointArr, weightArr, idxArr) => {
    let gr = merge.groups.get(key);
    if (!gr) merge.groups.set(key, (gr = { pos: [], nor: [], uv: [], jnt: [], wgt: [], idx: [], base: 0, hasUv: !!uvArr }));
    gr.pos.push(posArr); gr.nor.push(norArr); if (uvArr) gr.uv.push(uvArr); gr.jnt.push(jointArr); gr.wgt.push(weightArr);
    gr.idx.push(idxArr.map((v) => v + gr.base));
    gr.base += posArr.length / 3;
  };
  const concat = (list, Arr) => { const n = list.reduce((s, a) => s + a.length, 0); const o = new Arr(n); let off = 0; for (const a of list) { o.set(a, off); off += a.length; } return o; };

  // bake a rigid mesh into the merged skinned mesh: vertices transformed by T, weight 1 on joint `newJ`
  function bakeMesh(meshIdx, T, newJ) {
    for (const p of J.meshes[meshIdx].primitives) {
      const pos = readAccessor(g, p.attributes.POSITION), nor = readAccessor(g, p.attributes.NORMAL);
      const uv = p.attributes.TEXCOORD_0 !== undefined ? readAccessor(g, p.attributes.TEXCOORD_0) : null;
      const idx = p.indices !== undefined ? readAccessor(g, p.indices) : Uint32Array.from({ length: pos.length / 3 }, (_, k) => k);
      const np = new Float32Array(pos.length), nn = new Float32Array(nor.length);
      for (let k = 0; k < pos.length; k += 3) {
        const x = pos[k], y = pos[k + 1], z = pos[k + 2];
        np[k] = T[0] * x + T[4] * y + T[8] * z + T[12]; np[k + 1] = T[1] * x + T[5] * y + T[9] * z + T[13]; np[k + 2] = T[2] * x + T[6] * y + T[10] * z + T[14];
        const a = nor[k], b = nor[k + 1], c = nor[k + 2];
        const nx = T[0] * a + T[4] * b + T[8] * c, ny = T[1] * a + T[5] * b + T[9] * c, nz = T[2] * a + T[6] * b + T[10] * c;
        const l = Math.hypot(nx, ny, nz) || 1; nn[k] = nx / l; nn[k + 1] = ny / l; nn[k + 2] = nz / l;
      }
      const count = pos.length / 3;
      const jt = new Uint8Array(count * 4), wt = new Float32Array(count * 4);
      for (let k = 0; k < count; k++) { jt[k * 4] = newJ; wt[k * 4] = 1; }
      mergeIn(p.material ?? 0, np, nn, uv ? Float32Array.from(uv) : null, jt, wt, Array.from(idx));
    }
  }
  // ---- nodes
  const nodeMap = new Map();
  const meshOut = [];
  const meshMap = new Map();
  const stats = { merged: 0, baked: 0, droppedNodes: dropped.size };
  function addNode(i) {
    const n = nodes[i];
    if (dropped.has(i)) return -1;
    if (merge && merge.skinnedNodes.has(i)) return -1;
    const isMesh = n.mesh !== undefined;
    if (opts.noMeshes && isMesh) return -1;
    let dropMesh = false;
    if (merge?.rigid && isMesh && n.skin === undefined) { bakeMesh(n.mesh, restWorld(i), merge.rigidIndex.get(i)); stats.baked++; dropMesh = true; }
    else if (merge && isMesh && n.skin === undefined) {
      const aj = nearestJointAncestor(i);
      if (aj >= 0 && opts.bakeRigid?.(n.name, i, nodes[aj].name)) {
        const M = restWorld(i);
        const skinnedWorldInv = inv(restWorld([...merge.skinnedNodes][0]));
        bakeMesh(n.mesh, mul(skinnedWorldInv, M), jointRemap.get(jointOf.get(aj).index));
        stats.baked++;
        return -1;
      }
    }
    const idx = out.nodes.length;
    const nn = {};
    if (n.name !== undefined) nn.name = n.name;
    if (n.matrix) nn.matrix = n.matrix; else {
      if (n.translation) nn.translation = n.translation;
      if (n.rotation) nn.rotation = n.rotation;
      if (n.scale) nn.scale = n.scale;
    }
    const ex = opts.nodeExtras?.(n.name, i, n);
    if (ex) nn.extras = ex; else if (n.extras) nn.extras = n.extras;
    out.nodes.push(nn);
    nodeMap.set(i, idx);
    if (isMesh && !dropMesh) {
      if (!meshMap.has(n.mesh)) {
        const m = J.meshes[n.mesh];
        meshOut.push({ name: m.name, primitives: m.primitives.map(copyPrimitive) });
        meshMap.set(n.mesh, meshOut.length - 1);
      }
      nn.mesh = meshMap.get(n.mesh);
      if (n.skin !== undefined) nn._skin = n.skin; // resolved below (non-merged skins)
    }
    const kids = [];
    for (const c of n.children || []) { const ci = addNode(c); if (ci >= 0) kids.push(ci); }
    if (kids.length) nn.children = kids;
    return idx;
  }
  const sceneRoots = J.scenes[J.scene ?? 0].nodes;

  // First pass: collect merge data from skinned nodes (before building nodes).
  if (merge && !merge.rigid) {
    const skinIdx = merge.skin;
    const sj = skinJoints[skinIdx];
    for (const i of merge.skinnedNodes) {
      for (const p of J.meshes[nodes[i].mesh].primitives) {
        const pos = readAccessor(g, p.attributes.POSITION), nor = readAccessor(g, p.attributes.NORMAL);
        const uv = p.attributes.TEXCOORD_0 !== undefined ? readAccessor(g, p.attributes.TEXCOORD_0) : null;
        const jo = readAccessor(g, p.attributes.JOINTS_0);
        const wa = J.accessors[p.attributes.WEIGHTS_0];
        const w = readAccessor(g, p.attributes.WEIGHTS_0);
        const wf = wa.normalized ? (wa.componentType === 5121 ? 255 : 65535) : 1;
        const count = pos.length / 3;
        const jt = new Uint8Array(count * 4), wt = new Float32Array(count * 4);
        for (let k = 0; k < count; k++) {
          let sum = 0;
          const tmpJ = [], tmpW = [];
          for (let c = 0; c < 4; c++) {
            const oj = jo[k * 4 + c], ww = w[k * 4 + c] / wf;
            if (ww > 0.001 && jointRemap.has(oj)) { tmpJ.push(jointRemap.get(oj)); tmpW.push(ww); sum += ww; }
          }
          if (!sum) { tmpJ.push(0); tmpW.push(1); sum = 1; }
          for (let c = 0; c < tmpJ.length; c++) { jt[k * 4 + c] = tmpJ[c]; wt[k * 4 + c] = tmpW[c] / sum; }
        }
        const idx = p.indices !== undefined ? readAccessor(g, p.indices) : Uint32Array.from({ length: count }, (_, k) => k);
        mergeIn(p.material ?? 0, Float32Array.from(pos), Float32Array.from(nor), uv ? Float32Array.from(uv) : null, jt, wt, Array.from(idx));
        stats.merged++;
      }
    }
  }
  for (const r of sceneRoots) { const ri = addNode(r); if (ri >= 0) out.scenes[0].nodes.push(ri); }

  // merged mesh node + skin
  if (merge) {
    const prims = [];
    for (const [mat, gr] of merge.groups) {
      const pos = concat(gr.pos, Float32Array), nor = concat(gr.nor, Float32Array), jnt = concat(gr.jnt, Uint8Array), wgt = concat(gr.wgt, Float32Array);
      const idxAll = gr.idx.flat();
      const idx = pos.length / 3 < 65535 ? Uint16Array.from(idxAll) : Uint32Array.from(idxAll);
      const prim = { attributes: { POSITION: B.addAccessor(pos, 'VEC3', { target: 34962, minmax: true }), NORMAL: B.addAccessor(nor, 'VEC3', { target: 34962 }), JOINTS_0: B.addAccessor(jnt, 'VEC4', { target: 34962 }), WEIGHTS_0: B.addAccessor(wgt, 'VEC4', { target: 34962 }) }, indices: B.addAccessor(idx, 'SCALAR', { target: 34963 }), material: mat };
      if (gr.hasUv) prim.attributes.TEXCOORD_0 = B.addAccessor(concat(gr.uv, Float32Array), 'VEC2', { target: 34962 });
      prims.push(prim);
    }
    meshOut.push({ name: opts.mergedName || 'Body', primitives: prims });
    if (merge.rigid) {
      const ibm = new Float32Array(merge.rigid.length * 16);
      merge.rigid.forEach((oi, k) => ibm.set(inv(restWorld(oi)), k * 16));
      out.skins = [{ name: 'Skin', joints: merge.rigid.map((oi) => nodeMap.get(oi)), inverseBindMatrices: B.addAccessor(ibm, 'MAT4') }];
    } else {
    const sj = skinJoints[merge.skin];
    const ibmAll = readAccessor(g, J.skins[merge.skin].inverseBindMatrices);
    const ibm = new Float32Array(keptJoints.length * 16);
    keptJoints.forEach((k, nk) => ibm.set(ibmAll.subarray(k * 16, k * 16 + 16), nk * 16));
    out.skins = [{ name: 'Skin', joints: keptJoints.map((k) => nodeMap.get(sj[k])), inverseBindMatrices: B.addAccessor(ibm, 'MAT4') }];
    }
    const mi = out.nodes.length;
    out.nodes.push({ name: opts.mergedName || 'Body', mesh: meshOut.length - 1, skin: 0 });
    const ap = merge.anchorParent;
    if (ap >= 0 && nodeMap.has(ap)) (out.nodes[nodeMap.get(ap)].children ??= []).push(mi); else out.scenes[0].nodes.push(mi);
  } else if (!opts.noMeshes && J.skins) {
    // keep skins as they are
    out.skins = J.skins.map((s) => ({
      name: s.name,
      joints: s.joints.map((n) => nodeMap.get(n)).filter((n) => n !== undefined),
      inverseBindMatrices: copyAccessor(s.inverseBindMatrices),
    }));
    for (const n of out.nodes) { if (n._skin !== undefined) { n.skin = n._skin; delete n._skin; } }
    for (const s of out.skins) if (s.joints.length !== J.skins[out.skins.indexOf(s)].joints.length) throw new Error('dropped joint of a kept skin');
  }
  for (const n of out.nodes) delete n._skin;
  if (meshOut.length) out.meshes = meshOut;

  // ---- materials / textures / images
  if (J.materials && !opts.noMeshes) {
    out.materials = JSON.parse(JSON.stringify(J.materials));
    cleanTextureInfos(out.materials);
    // Kenney's nature kit declares unlit but ships PBR materials with metallic = 1 (black without an environment map); the glTF default
    // for a material that says nothing is also metallic = 1. All our kits are matte colour/atlas art, so force metallic 0 (unless a map drives it).
    for (const m of out.materials) {
      const pbr = (m.pbrMetallicRoughness ??= {});
      if (!pbr.metallicRoughnessTexture && (pbr.metallicFactor === undefined || pbr.metallicFactor >= 0.9)) pbr.metallicFactor = 0;
      // Kenney's flat-colour kits store display (sRGB) colours in baseColorFactor, which glTF reads as linear: washed-out colours. Convert.
      if (opts.srgbFactors && pbr.baseColorFactor && !pbr.baseColorTexture) {
        const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
        pbr.baseColorFactor = [lin(pbr.baseColorFactor[0]), lin(pbr.baseColorFactor[1]), lin(pbr.baseColorFactor[2]), pbr.baseColorFactor[3] ?? 1].map((v) => +v.toFixed(5));
      }
    }
    if (J.textures) out.textures = JSON.parse(JSON.stringify(J.textures));
    if (J.samplers) out.samplers = JSON.parse(JSON.stringify(J.samplers));
    if (J.images) {
      out.images = J.images.map((im, i) => {
        let bytes = null;
        if (im.bufferView !== undefined) {
          const bv = J.bufferViews[im.bufferView];
          bytes = g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
        } else if (im.uri && !im.uri.startsWith('data:')) bytes = fs.readFileSync(path.join(g.dir, decodeURIComponent(im.uri)));
        const uri = opts.imageUri(i, im, bytes);
        return { uri, name: im.name, ...(im.mimeType ? { mimeType: im.mimeType } : {}) };
      });
      for (const im of out.images) if (!im.name) delete im.name;
    }
    // Prune unreferenced textures? (keep indices stable — they are tiny)
  }

  // ---- animations
  if (opts.animations && J.animations) {
    out.animations = [];
    J.animations.forEach((a, ai) => {
      if (typeof opts.animations === 'function' && !opts.animations(a, ai)) return;
      const samplers = [], channels = [];
      const sMap = new Map();
      for (const c of a.channels) {
        const ni = nodeMap.get(c.target.node);
        if (ni === undefined) continue;
        const n = nodes[c.target.node];
        const s = a.samplers[c.sampler];
        const comp = c.target.path === 'rotation' ? 4 : c.target.path === 'weights' ? 1 : 3;
        const values = readAccessor(g, s.output);
        if (opts.trackFilter && !opts.trackFilter({ node: n.name, path: c.target.path, values, comp, rest: n[c.target.path] })) continue;
        if (!sMap.has(c.sampler)) {
          const times = readAccessor(g, s.input);
          const inI = B.addAccessor(times, 'SCALAR', { minmax: true });
          const outI = B.addAccessor(values, comp === 4 ? 'VEC4' : comp === 1 ? 'SCALAR' : 'VEC3');
          samplers.push({ input: inI, output: outI, interpolation: s.interpolation || 'LINEAR' });
          sMap.set(c.sampler, samplers.length - 1);
        }
        channels.push({ sampler: sMap.get(c.sampler), target: { node: ni, path: c.target.path } });
      }
      if (channels.length) out.animations.push({ name: a.name, samplers, channels });
    });
    if (!out.animations.length) delete out.animations;
  }

  out.accessors = B.accessors; out.bufferViews = B.bufferViews;
  const bin = B.finish();
  if (bin.length) out.buffers = [{ byteLength: bin.length }]; else { delete out.accessors; delete out.bufferViews; }
  if (!out.accessors?.length) { delete out.accessors; delete out.bufferViews; }
  if (merge && merge.skinnedNodes.size) { // the glTF spec ignores a skinned mesh node's own transform; warn if the source relied on one
    const W = restWorld([...merge.skinnedNodes][0]);
    const idn = I4();
    if (W.some((v, k) => Math.abs(v - idn[k]) > 1e-5)) stats.warnSkinnedMeshTransform = true;
  }
  const ext = new Set(); collectExtensions(out, ext);
  if (ext.size) out.extensionsUsed = [...ext];
  if (opts.report) Object.assign(opts.report, stats, { joints: keptJoints?.length });
  return { json: out, bin };
}
