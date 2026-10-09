// boundary-edge ratio per GLB (after welding by position): high = holes / torn mesh
import fs from 'fs';
const SZ = 'D:/omnissiah/public/assets/generated/startzone/';
function parse(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12); const json = JSON.parse(b.slice(20, 20 + jl).toString());
  const bin = b.slice(20 + jl + 8);
  const prim = json.meshes[0].primitives[0];
  const acc = (i) => json.accessors[i]; const bv = (i) => json.bufferViews[i];
  const pa = acc(prim.attributes.POSITION), pv = bv(pa.bufferView);
  const pos = new Float32Array(bin.buffer, bin.byteOffset + (pv.byteOffset || 0) + (pa.byteOffset || 0), pa.count * 3);
  const ia = acc(prim.indices), iv = bv(ia.bufferView);
  const ctor = ia.componentType === 5125 ? Uint32Array : ia.componentType === 5123 ? Uint16Array : Uint8Array;
  const idx = new ctor(bin.buffer, bin.byteOffset + (iv.byteOffset || 0) + (ia.byteOffset || 0), ia.count);
  return { pos, idx };
}
function stats(file) {
  const { pos, idx } = parse(file);
  const key = new Map(); const map = new Int32Array(pos.length / 3);
  for (let i = 0; i < map.length; i++) {
    const k = Math.round(pos[3 * i] * 1e4) + ',' + Math.round(pos[3 * i + 1] * 1e4) + ',' + Math.round(pos[3 * i + 2] * 1e4);
    let v = key.get(k); if (v === undefined) { v = key.size; key.set(k, v); } map[i] = v;
  }
  const edges = new Map();
  for (let f = 0; f < idx.length; f += 3) {
    const a = map[idx[f]], b = map[idx[f + 1]], c = map[idx[f + 2]];
    if (a === b || b === c || a === c) continue;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) { const k = x < y ? x * 4194304 + y : y * 4194304 + x; edges.set(k, (edges.get(k) || 0) + 1); }
  }
  let bd = 0; for (const n of edges.values()) if (n === 1) bd++;
  return { tris: idx.length / 3, edges: edges.size, boundary: bd, ratio: +(bd / edges.size).toFixed(4) };
}
const ids = fs.readdirSync(SZ).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));
const out = {};
for (const id of ids) { try { out[id] = { o: stats(SZ + id + '.glb'), q: stats(SZ + 'q/' + id + '.glb') }; } catch (e) { out[id] = { err: String(e) }; } }
fs.writeFileSync('D:/omnissiah/.cache/genset/holes.json', JSON.stringify(out));
const rows = Object.entries(out).filter(([, v]) => v.o).sort((a, b) => b[1].o.ratio - a[1].o.ratio);
console.log('orig top 25:'); for (const [id, v] of rows.slice(0, 25)) console.log(id, v.o.ratio, 'q', v.q.ratio);
const rq = Object.entries(out).filter(([, v]) => v.q).sort((a, b) => b[1].q.ratio - a[1].q.ratio);
console.log('q top 40:'); for (const [id, v] of rq.slice(0, 40)) console.log(id, v.q.ratio, 'o', v.o.ratio);
console.log('errors', Object.entries(out).filter(([, v]) => v.err).length);
