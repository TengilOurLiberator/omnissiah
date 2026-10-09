// glbtools.mjs -- minimal GLB read / write / compact helpers (no dependencies).
import fs from 'fs';

export function readGlb(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + p);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jl).toString('utf8'));
  let bin = Buffer.alloc(0);
  const off = 20 + jl;
  if (off < b.length) { const bl = b.readUInt32LE(off); bin = b.slice(off + 8, off + 8 + bl); }
  return { json, bin };
}

export function writeGlb(p, json, bin) {
  const j = Buffer.from(JSON.stringify(json), 'utf8');
  const jp = (4 - (j.length % 4)) % 4;
  const jb = Buffer.concat([j, Buffer.alloc(jp, 0x20)]);
  const bp = (4 - (bin.length % 4)) % 4;
  const bb = Buffer.concat([bin, Buffer.alloc(bp, 0)]);
  const total = 12 + 8 + jb.length + (bb.length ? 8 + bb.length : 0);
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jb.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jb.copy(out, 20);
  if (bb.length) {
    const o = 20 + jb.length;
    out.writeUInt32LE(bb.length, o); out.writeUInt32LE(0x004e4942, o + 4); bb.copy(out, o + 8);
  }
  fs.writeFileSync(p, out);
}

// Incremental binary-buffer builder
export class BinBuilder {
  constructor() { this.chunks = []; this.len = 0; this.views = []; this.accessors = []; }
  addView(buf, target) {
    const pad = (4 - (this.len % 4)) % 4;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.len += pad; }
    const view = { buffer: 0, byteOffset: this.len, byteLength: buf.length };
    if (target) view.target = target;
    this.chunks.push(buf); this.len += buf.length;
    this.views.push(view);
    return this.views.length - 1;
  }
  addAccessor(typedArray, type, componentType, opts = {}) {
    const buf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const bv = this.addView(buf, opts.target);
    const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const acc = { bufferView: bv, componentType, count: typedArray.length / nComp, type };
    if (opts.minmax) {
      const mn = new Array(nComp).fill(Infinity), mx = new Array(nComp).fill(-Infinity);
      for (let i = 0; i < typedArray.length; i++) { const c = i % nComp; if (typedArray[i] < mn[c]) mn[c] = typedArray[i]; if (typedArray[i] > mx[c]) mx[c] = typedArray[i]; }
      acc.min = mn; acc.max = mx;
    }
    if (opts.normalized) acc.normalized = true;
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }
  bin() { return Buffer.concat(this.chunks); }
}

export const SAMPLER = { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 };

// Drop unreferenced bufferViews, re-lay the binary buffer.
export function compact(json, bin) {
  const used = new Set();
  for (const a of json.accessors || []) if (a.bufferView !== undefined) used.add(a.bufferView);
  for (const i of json.images || []) if (i.bufferView !== undefined) used.add(i.bufferView);
  for (const a of json.accessors || []) { if (a.sparse) { used.add(a.sparse.indices.bufferView); used.add(a.sparse.values.bufferView); } }
  const map = new Map(); const views = []; const chunks = []; let len = 0;
  (json.bufferViews || []).forEach((bv, i) => {
    if (!used.has(i)) return;
    const pad = (4 - (len % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); len += pad; }
    const nb = { ...bv, buffer: 0, byteOffset: len };
    chunks.push(bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength)); len += bv.byteLength;
    map.set(i, views.length); views.push(nb);
  });
  json.bufferViews = views;
  for (const a of json.accessors || []) { if (a.bufferView !== undefined) a.bufferView = map.get(a.bufferView); if (a.sparse) { a.sparse.indices.bufferView = map.get(a.sparse.indices.bufferView); a.sparse.values.bufferView = map.get(a.sparse.values.bufferView); } }
  for (const i of json.images || []) if (i.bufferView !== undefined) i.bufferView = map.get(i.bufferView);
  json.buffers = [{ byteLength: len }];
  return Buffer.concat(chunks);
}

// Make every palette texture a shared external file (relative uri) with one canonical sampler, so the game
// (models.js shares textures by uri+sampler) keeps a single GPU copy of hero-palette.png.
export function externalizePalette(json, uri = 'hero-palette.png') {
  json.samplers = [{ ...SAMPLER }];
  json.images = [{ uri, name: 'hero-palette', mimeType: 'image/png' }];
  json.textures = [{ sampler: 0, source: 0 }];
  for (const m of json.materials || []) {
    const pbr = m.pbrMetallicRoughness || (m.pbrMetallicRoughness = {});
    if (pbr.baseColorTexture) { pbr.baseColorTexture = { index: 0 }; }
    if (m.emissiveTexture) m.emissiveTexture = { index: 0 };
  }
}
