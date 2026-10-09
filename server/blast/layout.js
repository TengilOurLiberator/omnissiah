// Where each object stands in the generated place. The place's panorama is built around the source picture (the view straight ahead, toward -Z), so the
// objects are put on the rays through their picture boxes: same bearing and same elevation as in the painting, at the distance where that ray meets the floor
// (camera 1.6 m above it, level, horizontal field of view `fov`). Pure functions: unit-tested in test_blast.mjs.
import { clamp, physicsFor } from './analysis.js';

const BAND = { near: [2.0, 4.6], mid: [4.0, 8.6], far: [8.0, 14.0] };
const SUPPORT_H = { floor: 0, table: 0.75, shelf: 1.25, wall: 1.4, ceiling: 2.5, object: 0.75 };
const MIN_R = 2.0, MAX_R = 14.0;
const hash01 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; };

// Bounding box of a binary glTF (POSITION accessor min/max of every mesh primitive, node translation/scale applied when present). -> { min, max, size } | null
export function glbBounds(buf) {
  try {
    if (!buf || buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return null;
    const jsonLen = buf.readUInt32LE(12);
    if (buf.readUInt32LE(16) !== 0x4e4f534a) return null;
    const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const visit = (ni, parent) => {
      const n = gltf.nodes?.[ni];
      if (!n) return;
      const t = n.translation || [0, 0, 0], s = n.scale || [1, 1, 1];
      const m = { t: [parent.t[0] + parent.s[0] * t[0], parent.t[1] + parent.s[1] * t[1], parent.t[2] + parent.s[2] * t[2]], s: [parent.s[0] * s[0], parent.s[1] * s[1], parent.s[2] * s[2]] };
      if (n.mesh !== undefined) {
        for (const p of gltf.meshes?.[n.mesh]?.primitives ?? []) {
          const a = gltf.accessors?.[p.attributes?.POSITION];
          if (!a?.min || !a?.max) continue;
          for (let k = 0; k < 3; k++) {
            const lo = m.t[k] + m.s[k] * a.min[k], hi = m.t[k] + m.s[k] * a.max[k];
            min[k] = Math.min(min[k], lo, hi); max[k] = Math.max(max[k], lo, hi);
          }
        }
      }
      for (const c of n.children ?? []) visit(c, m);
    };
    const scene = gltf.scenes?.[gltf.scene ?? 0];
    for (const ni of scene?.nodes ?? []) visit(ni, { t: [0, 0, 0], s: [1, 1, 1] });
    if (!Number.isFinite(min[0])) return null;
    return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
  } catch { return null; }
}

// Uniform scale that makes the GLB (largest side 1) as big as the survey says the real thing is. Uses the longest estimated side, cross-checked against
// the estimated height and the model's actual proportions (the survey's three numbers are not always consistent with each other).
export function scaleFor(o, glbSize) {
  const [w, h, d] = o.size_m;
  const s1 = Math.max(w, h, d);
  if (!glbSize) return s1;
  const gl = Math.max(glbSize[0], glbSize[1], glbSize[2]) || 1;
  const gy = glbSize[1] / gl;
  if (gy < 0.08) return s1;
  const s2 = h / gy;
  return s2 / s1 > 0.5 && s2 / s1 < 2 ? Math.sqrt(s1 * s2) : s1;
}

// objects: selected survey objects (each { id, name, box, depth, size_m, rests_on, rests_on_id, count, break_material, glb?: { size:[x,y,z] } }); only those with
// a model should be passed. -> [{ id, position:[x,y,z], yaw, scale, dims:[w,h,d], rests, fixed, supportId, copies:[{position,yaw}], bearing_deg, distance }]
export function computeLayout(objects, { horizonY = 0.5, fov = 80, aspect = 16 / 9, eye = 1.6, indoor = false, compress = 0.6 } = {}) {
  const f = 0.5 / Math.tan((fov * Math.PI) / 360);
  const maxR = indoor ? 11 : MAX_R;
  const items = objects.map((o) => {
    const scale = scaleFor(o, o.glb?.size);
    const g = o.glb?.size ? o.glb.size.map((v) => v / (Math.max(...o.glb.size) || 1)) : [o.size_m[0], o.size_m[1], o.size_m[2]].map((v) => v / Math.max(...o.size_m));
    return { o, scale, dims: [g[0] * scale, g[1] * scale, g[2] * scale], cx: (o.box[0] + o.box[2]) / 2, cy: (o.box[1] + o.box[3]) / 2, x: 0, z: 0, y: 0, rests: o.rests_on, supportId: null, fixed: false };
  });
  const byId = new Map(items.map((it) => [it.o.id, it]));

  // 1. who stands on whom: an explicit support, else (table / shelf) the extracted object under the bottom centre of its box
  for (const it of items) {
    const o = it.o;
    if (o.rests_on === 'wall' || o.rests_on === 'ceiling' || o.rests_on === 'floor') continue;
    let sup = o.rests_on_id ? byId.get(o.rests_on_id) : null;
    if (sup === it) sup = null;
    if (!sup) {
      const bx = it.cx, by = o.box[3];
      let best = null;
      for (const c of items) {
        if (c === it) continue;
        const [x0, y0, x1, y1] = c.o.box;
        const area = c.dims[0] * c.dims[2];
        if (area < 0.12 || c.dims[1] < 0.25) continue;                     // not a surface
        if (bx < x0 - 0.01 || bx > x1 + 0.01) continue;
        if (by < y0 - 0.04 || by > y1 + 0.02) continue;                    // its bottom is not on that object
        if (c.dims[1] <= it.dims[1] * 0.9 && c.dims[1] < 0.3) continue;
        if (!best || (y1 - y0) * (x1 - x0) > (best.o.box[3] - best.o.box[1]) * (best.o.box[2] - best.o.box[0])) best = c;
      }
      sup = best;
    }
    // no cycles
    for (let p = sup, n = 0; p && n < 6; p = p.supportId ? byId.get(p.supportId) : null, n++) if (p === it) { sup = null; break; }
    it.supportId = sup ? sup.o.id : null;
  }

  // 2. ground objects (and wall / ceiling things) from the picture rays
  for (const it of items) {
    const o = it.o;
    const sh = SUPPORT_H[o.rests_on] ?? 0;
    const xn = it.cx - 0.5;
    const bearing = Math.atan2(xn, f);
    const band = BAND[o.depth] ?? BAND.mid;
    let z;
    if (o.rests_on === 'wall' || o.rests_on === 'ceiling') {
      z = clamp(o.depth === 'near' ? 3.6 : o.depth === 'far' ? 9 : 6.2, band[0], maxR);
      it.fixed = true;
    } else {
      const base = it.supportId ? 0 : sh;                                         // a supported object is placed on its support later
      const yn = (o.box[3] - horizonY) / aspect;                                  // bottom edge below the horizon, in picture-width units
      const h = eye - base;
      z = yn > 0.004 && h > 0.2 ? (f * h) / yn : band[1] * 1.6;
      z = clamp(z, band[0] * 0.55, band[1] * 1.45);
    }
    let r = clamp(z / Math.cos(bearing), MIN_R + 0.3, maxR);
    // A picture is a wide, flat view: its far things would stand 10 m away, out of reach and tiny. Bearing (where they appear in the sky) is kept exactly,
    // the distance is pulled in so that everything stays within a short walk.
    if (!it.fixed) r = clamp(MIN_R + 0.3 + (r - MIN_R - 0.3) * compress, MIN_R + 0.3, maxR);
    it.bearing = bearing;
    it.r = r;
    it.x = r * Math.sin(bearing);
    it.z = -r * Math.cos(bearing);
    if (it.fixed) {
      const yc = eye - ((it.cy - horizonY) / aspect) * (r * Math.cos(bearing)) / f;
      it.y = clamp(yc - it.dims[1] / 2, 0.2, 4);
    }
  }

  // 3. copies of the same thing (count > 1): a short row beside the first, alternating sides
  const nodes = [];
  for (const it of items) {
    it.nodes = [{ it, x: it.x, z: it.z, copy: -1 }];
    const n = it.o.count > 1 && !it.fixed && !it.supportId ? Math.min(4, it.o.count) : 1;
    const step = Math.max(it.dims[0], it.dims[2]) * 1.25 + 0.15;
    for (let k = 1; k < n; k++) {
      const side = k % 2 ? 1 : -1, mag = Math.ceil(k / 2) * step;
      const tx = Math.cos(it.bearing), tz = Math.sin(it.bearing);                  // tangent to the bearing circle
      it.nodes.push({ it, x: it.x + side * mag * tx + (hash01(it.o.id + k) - 0.5) * 0.3, z: it.z + side * mag * tz - 0.2 * k, copy: k - 1 });
    }
    for (const nd of it.nodes) { nd.rad = Math.max(0.12, 0.5 * Math.max(it.dims[0], it.dims[2]) * 0.9); nodes.push(nd); }
  }

  // 4. relax: no overlapping footprints, nothing on or near the player, nothing outside the walkable ring
  const ground = nodes.filter((nd) => !nd.it.fixed && !nd.it.supportId);
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < ground.length; i++) {
      for (let j = i + 1; j < ground.length; j++) {
        const a = ground[i], b = ground[j];
        let dx = b.x - a.x, dz = b.z - a.z;
        let dist = Math.hypot(dx, dz);
        const need = a.rad + b.rad + 0.08;
        if (dist >= need) continue;
        if (dist < 1e-4) { dx = hash01(a.it.o.id) - 0.5; dz = hash01(b.it.o.id) - 0.5; dist = Math.hypot(dx, dz) || 1; }
        const push = (need - dist) / 2 + 0.01;
        // the heavier / bigger one moves less
        const wa = a.rad, wb = b.rad, tot = wa + wb;
        a.x -= (dx / dist) * push * (wb / tot) * 2; a.z -= (dz / dist) * push * (wb / tot) * 2;
        b.x += (dx / dist) * push * (wa / tot) * 2; b.z += (dz / dist) * push * (wa / tot) * 2;
        moved = true;
      }
    }
    for (const nd of ground) {
      const d = Math.hypot(nd.x, nd.z) || 0.001;
      const lo = MIN_R + nd.rad, hi = maxR;
      if (d < lo || d > hi) { const k = clamp(d, lo, hi) / d; nd.x *= k; nd.z *= k; moved = true; }
      // do not wander far from the picture direction: the object must still sit where the painting shows it
      const ang = Math.atan2(nd.x, -nd.z);
      const ref = nd.it.bearing, lim = 0.28;
      if (Math.abs(ang - ref) > lim) { const a2 = ref + clamp(ang - ref, -lim, lim); nd.x = d * Math.sin(a2); nd.z = -d * Math.cos(a2); }
    }
    if (!moved) break;
  }

  // 5. supported objects: on top of their support (at the same picture-relative offset), with the support's resolved position
  const topOf = (it) => (it.supportId ? (topOf(byId.get(it.supportId)) + byId.get(it.supportId).dims[1]) : it.y);
  for (const it of items) {
    if (!it.supportId) continue;
    const s = byId.get(it.supportId);
    const sw = Math.max(0.05, s.o.box[2] - s.o.box[0]);
    const off = clamp(((it.cx - s.cx) / sw) * s.dims[0], -s.dims[0] * 0.4, s.dims[0] * 0.4);
    const sn = s.nodes[0];
    const ang = Math.atan2(sn.x, -sn.z);
    it.nodes[0].x = sn.x + off * Math.cos(ang);
    it.nodes[0].z = sn.z + off * Math.sin(ang);
    it.y = topOf(it);
    it.bearing = Math.atan2(it.nodes[0].x, -it.nodes[0].z);
  }
  // supported objects sharing one support: do not stack them in the same spot
  for (const it of items) {
    if (!it.supportId) continue;
    for (const other of items) {
      if (other === it || other.supportId !== it.supportId || items.indexOf(other) > items.indexOf(it)) continue;
      const a = it.nodes[0], b = other.nodes[0];
      const need = 0.5 * (Math.max(it.dims[0], it.dims[2]) + Math.max(other.dims[0], other.dims[2])) * 0.8;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < need) { const ang = Math.atan2(a.x, -a.z); a.x += (need - d + 0.02) * Math.cos(ang); a.z += (need - d + 0.02) * Math.sin(ang); }
    }
  }

  return items.map((it) => {
    const faceYaw = (nd) => Math.atan2(-nd.x, -nd.z) + (hash01(it.o.id + 'y') - 0.5) * 0.7;
    const main = it.nodes[0];
    const dist = Math.hypot(main.x, main.z);
    return {
      id: it.o.id,
      position: [round2(main.x), round2(it.y), round2(main.z)],
      yaw: round2(faceYaw(main)),
      scale: round3(it.scale),
      dims: it.dims.map(round2),
      rests: it.supportId ? 'object' : it.rests,
      supportId: it.supportId,
      fixed: it.fixed,
      distance: round2(dist),
      bearing_deg: round2((Math.atan2(main.x, -main.z) * 180) / Math.PI),
      copies: it.nodes.slice(1).map((nd) => ({ position: [round2(nd.x), round2(it.y), round2(nd.z)], yaw: round2(faceYaw(nd) + (hash01(it.o.id + nd.copy) - 0.5) * 1.2) })),
    };
  });
}
const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;

// numbers the client needs besides placement (mass, grab, hp, ...) merged with the layout row
export function propSpec(o, row) {
  const p = physicsFor({ ...o, size_m: row.dims });
  return { mass: p.mass, grabbable: !row.fixed && p.grabbable, hp: p.hp, bounce: p.bounce, friction: p.friction };
}
