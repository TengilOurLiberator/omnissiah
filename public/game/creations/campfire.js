// PATTERN: ambient set-piece from NEW ART only. A stone ring cut from a generated model (sz-cooking-pot), a painted-sprite fire
// (ONE draw call: layered additive flame tongues + halo + coal bed + ground glow, all on one canvas-painted atlas), kit embers/smoke,
// a pooled warm light (kit lights never cast shadows) and crackle sounds. Everything animated is allocation-free in update().
// Budget: Quest = ring ~600 tris + fire ~250 + 3 logs ~100, 6 draw calls; PC adds generated woodpile, log bench, stump and rocks.
import { gen } from '/game/lib/gen.js';
import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';

export const meta = { name: 'Campfire', description: 'The meadow campfire: generated stone ring and logs, painted flame sprites, embers, smoke and a flickering warm light.' };
const X = 0, Z = -6;   // the intro and chapter 1 walk to this spot: do not move it
const DRESS = true;    // PC tier only: woodpile, bench, stump and rocks around the fire

export default function (ctx) {
  const { THREE } = ctx, pc = !!ctx.quality?.pc, kit = ctx.world.kit;
  const Y = ctx.groundAt(X, Z);
  const base = new THREE.Group();
  base.name = 'campfire';
  base.position.set(X, Y, Z);
  ctx.root.add(base);
  let dead = false;
  const own = [];                       // geometry / material / texture to dispose
  ctx.onDispose(() => { dead = true; for (const o of own) o.dispose(); });

  // ---------------------------------------------------------------- bare earth around the fire: a soft grass-free clearing (world.env owns ONE shared grass mask)
  const env = ctx.world.env;
  if (env?.addGrassHole) { const hole = env.addGrassHole({ x: X, z: Z, w: 4.4, d: 4.4, yaw: 0 }); ctx.onDispose(() => hole?.remove?.()); }
  else if (env?.setGrassMask) {
    const mc = document.createElement('canvas'); mc.width = mc.height = 64;
    const mg = mc.getContext('2d'), gr = mg.createRadialGradient(32, 32, 4, 32, 32, 30);
    gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000'); mg.fillStyle = '#000'; mg.fillRect(0, 0, 64, 64); mg.fillStyle = gr; mg.fillRect(0, 0, 64, 64);
    const mt = new THREE.CanvasTexture(mc); own.push(mt);
    env.setGrassMask(mt, X, Z, 8);
    ctx.onDispose(() => env.setGrassMask(null));
  }

  // ---------------------------------------------------------------- painted atlas: 4 flame tongues (128x256), a glow disc and a coal bed (256x256)
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  const rng = (s) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const layers = [[1, 1, '255,60,8', 0.5], [0.72, 0.84, '255,130,20', 0.55], [0.48, 0.62, '255,205,80', 0.65], [0.26, 0.34, '255,248,200', 0.9]];
  g.globalCompositeOperation = 'lighter';
  const tc = document.createElement('canvas'); tc.width = 128; tc.height = 256; const t2 = tc.getContext('2d');   // one tongue at a time, masked, then added to the atlas
  for (let k = 0; k < 4; k++) {
    const r = rng(11 + k * 977), bend = (k % 2 ? -1 : 1) * (8 + r() * 24), curl = 2 + r() * 6, H = 256;
    t2.globalCompositeOperation = 'source-over'; t2.clearRect(0, 0, 128, 256); t2.globalCompositeOperation = 'lighter';
    for (const [ws, hf, col, a] of layers) {
      for (let i = 0; i < 18; i++) {
        const t = i / 17, y = H - 24 - t * (H - 36) * hf, rad = 60 * ws * Math.pow(Math.max(0, 1 - Math.pow(t, 1.35)), 1.15) + 2;
        const x = 64 + Math.sin(t * curl + k) * 9 * t + bend * t * t + (r() - 0.5) * 5 * ws;
        const gr = t2.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `rgba(${col},${a * 0.55})`); gr.addColorStop(0.5, `rgba(${col},${a * 0.28})`); gr.addColorStop(1, `rgba(${col},0)`);
        t2.fillStyle = gr; t2.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
    t2.globalCompositeOperation = 'destination-in';        // soft base and a feathered tip
    const m = t2.createLinearGradient(0, 0, 0, 256); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(0.08, 'rgba(0,0,0,0.6)'); m.addColorStop(0.5, 'rgba(0,0,0,1)'); m.addColorStop(0.93, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    t2.fillStyle = m; t2.fillRect(0, 0, 128, 256);
    g.drawImage(tc, k * 128, 0);
  }
  { const gr = g.createRadialGradient(128, 384, 0, 128, 384, 128);
    gr.addColorStop(0, 'rgba(255,210,130,1)'); gr.addColorStop(0.2, 'rgba(255,150,50,0.6)'); gr.addColorStop(0.55, 'rgba(255,80,15,0.17)'); gr.addColorStop(1, 'rgba(255,40,0,0)');
    g.fillStyle = gr; g.fillRect(0, 256, 256, 256); }
  { const r = rng(5), gr = g.createRadialGradient(384, 384, 0, 384, 384, 120);   // coal bed: glow with hot specks
    gr.addColorStop(0, 'rgba(255,120,30,0.8)'); gr.addColorStop(0.7, 'rgba(255,60,10,0.45)'); gr.addColorStop(1, 'rgba(200,30,0,0)');
    g.fillStyle = gr; g.fillRect(256, 256, 256, 256);
    for (let i = 0; i < 46; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * 90, x = 384 + Math.cos(a) * d, y = 384 + Math.sin(a) * d, s = 5 + r() * 12, q = g.createRadialGradient(x, y, 0, x, y, s);
      q.addColorStop(0, 'rgba(255,190,80,0.55)'); q.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = q; g.fillRect(x - s, y - s, s * 2, s * 2); } }
  const atlas = new THREE.CanvasTexture(cv); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4; own.push(atlas);

  // ---------------------------------------------------------------- fire mesh: quads (tongues, 2 halos, coal bed) + a ground-glow disc, one geometry
  const NT = pc ? 24 : 12, NQ = NT + 3, RINGS = pc ? 3 : 2, SEG = pc ? 18 : 14, NG = 1 + RINGS * SEG, GR = 3.6;
  const NV = NQ * 4 + NG, pos = new Float32Array(NV * 3), uv = new Float32Array(NV * 2), col = new Float32Array(NV * 4), idx = [];
  const inset = 0.006, cell = (k) => k < 4 ? [k * 0.25 + inset, 0.5 + inset, 0.25 - inset * 2, 0.5 - inset * 2] : k === 4 ? [inset, inset, 0.5 - inset * 2, 0.5 - inset * 2] : [0.5 + inset, inset, 0.5 - inset * 2, 0.5 - inset * 2];
  const tongues = [], rr = rng(42);
  for (let q = 0; q < NQ; q++) {
    const k = q < NT ? (q % 4) : q === NT ? 4 : q === NT + 1 ? 4 : 5, [u0, v0, du, dv] = cell(k), o = q * 4;
    uv.set([u0, v0, u0 + du, v0, u0 + du, v0 + dv, u0, v0 + dv], o * 2);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    if (q < NT) { const inner = q % 4 > 1; tongues.push({ o, ang: rr() * 6.28, rad: rr() * (inner ? 0.1 : 0.2), life: 0.55 + rr() * 0.5, ph: rr(), w: (inner ? 0.4 : 0.62) * (0.8 + rr() * 0.5), h: (inner ? 0.95 : 1.35) * (0.75 + rr() * 0.5), sw: rr() * 6.28, inner }); }
  }
  const GO = NQ * 4;                         // ground disc: centre + rings, written once (follows the terrain), alpha animated
  pos.set([0, 0, 0], 0); uv.set([0.25, 0.25], 0);
  for (let i = 0; i < NG; i++) {
    const v = GO + i; let x = 0, z = 0, u = 0.25, w = 0.25;
    if (i > 0) { const ring = ((i - 1) / SEG | 0) + 1, a = ((i - 1) % SEG) / SEG * 6.2832, d = ring / RINGS; x = Math.cos(a) * d * GR; z = Math.sin(a) * d * GR; u = 0.25 + Math.cos(a) * d * 0.25; w = 0.25 + Math.sin(a) * d * 0.25; }
    pos[v * 3] = X + x - X; pos[v * 3 + 1] = ctx.groundAt(X + x, Z + z) - Y + 0.04; pos[v * 3 + 2] = z;
    uv[v * 2] = u; uv[v * 2 + 1] = w;
  }
  for (let s = 0; s < SEG; s++) idx.push(GO, GO + 1 + s, GO + 1 + (s + 1) % SEG);
  for (let r2 = 1; r2 < RINGS; r2++) for (let s = 0; s < SEG; s++) { const a = GO + 1 + (r2 - 1) * SEG, b = a + SEG, s1 = (s + 1) % SEG; idx.push(a + s, b + s, b + s1, a + s, b + s1, a + s1); }
  const geo = new THREE.BufferGeometry(); own.push(geo);
  const posA = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage), colA = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posA); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('color', colA); geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  own.push(mat);
  const fire = new THREE.Mesh(geo, mat);
  fire.name = 'campfire-flames'; fire.frustumCulled = false; fire.renderOrder = 5;
  fire.userData.noShadow = fire.userData.noOutline = fire.userData.noCull = true;
  base.add(fire);
  let pt = false;                                       // mixed reality: additive must leave framebuffer alpha alone (see core/world.js)
  const blend = () => { const p = !!ctx.input?.passthrough; if (p === pt) return; pt = p; mat.needsUpdate = true; if (p) { mat.blending = THREE.CustomBlending; mat.blendSrc = THREE.SrcAlphaFactor; mat.blendDst = THREE.OneFactor; mat.blendSrcAlpha = THREE.ZeroFactor; mat.blendDstAlpha = THREE.OneFactor; } else mat.blending = THREE.AdditiveBlending; };

  // ---------------------------------------------------------------- fuel logs (3 low-poly logs, painted bark) lying crossed in the ring
  const bc = document.createElement('canvas'); bc.width = 128; bc.height = 64;
  { const b = bc.getContext('2d'), r = rng(9); b.fillStyle = '#7d5232'; b.fillRect(0, 0, 128, 64);
    for (let i = 0; i < 90; i++) { b.fillStyle = r() < 0.5 ? 'rgba(40,20,8,0.3)' : 'rgba(200,140,80,0.25)'; b.fillRect(r() * 128, r() * 64, 1 + r() * 2, 8 + r() * 26); }
    b.fillStyle = 'rgba(14,8,5,0.5)'; b.fillRect(0, 0, 128, 8); b.fillRect(0, 56, 128, 8); }      // charred ends
  const bark = new THREE.CanvasTexture(bc); bark.colorSpace = THREE.SRGBColorSpace; bark.wrapS = THREE.RepeatWrapping; own.push(bark);
  const logMat = new THREE.MeshLambertMaterial({ map: bark, emissive: 0x2a0c02 }); own.push(logMat);
  const logGeos = [];
  [[0.2, 0.08, 0.1, 0.06, 0.55], [2.3, 0.1, 0.08, -0.05, 0.62], [4.2, 0.11, 0.09, 0.0, 0.5]].forEach(([yaw, y, rad, rz, len]) => {
    const c = new THREE.CylinderGeometry(rad * 0.9, rad, len, 6).rotateZ(Math.PI / 2 + rz).rotateY(yaw).translate(Math.cos(yaw) * 0.05, y, Math.sin(yaw) * 0.05);
    logGeos.push(c);
  });
  const lg = new THREE.BufferGeometry(); own.push(lg);                                 // merge by hand: one draw call
  { let n = 0, vi = 0; for (const c of logGeos) n += c.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), I = [];
    for (const c of logGeos) { P.set(c.attributes.position.array, vi * 3); N.set(c.attributes.normal.array, vi * 3); U.set(c.attributes.uv.array, vi * 2); for (const i of c.index.array) I.push(i + vi); vi += c.attributes.position.count; c.dispose(); }
    lg.setAttribute('position', new THREE.BufferAttribute(P, 3)); lg.setAttribute('normal', new THREE.BufferAttribute(N, 3)); lg.setAttribute('uv', new THREE.BufferAttribute(U, 2)); lg.setIndex(I); }
  const logs = new THREE.Mesh(lg, logMat); logs.userData.noOutline = true; logs.castShadow = pc; logs.position.y = 0.02; base.add(logs);

  let ringMat = null;
  // ---------------------------------------------------------------- stone ring: the pebble ring at the foot of sz-cooking-pot (triangles below y 0.115), the tripod is left out
  (async () => {
    try {
      const gltf = await new GLTFLoader().loadAsync(gen.url(ctx, 'sz-cooking-pot'));
      if (dead) return;
      gltf.scene.updateMatrixWorld(true);
      let src = null; gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
      const gg = src.geometry, P = gg.attributes.position, Nn = gg.attributes.normal, UV = gg.attributes.uv, I = gg.index, m = src.matrixWorld;
      const v = new THREE.Vector3(), tri = I ? I.count / 3 : P.count / 3, keep = [];
      const at = (t, k) => (I ? I.getX(t * 3 + k) : t * 3 + k);
      for (let t = 0; t < tri; t++) { let ok = true; for (let k = 0; k < 3 && ok; k++) ok = v.fromBufferAttribute(P, at(t, k)).applyMatrix4(m).y < 0.115; if (ok) keep.push(t); }
      const op = new Float32Array(keep.length * 9), on = new Float32Array(keep.length * 9), ou = new Float32Array(keep.length * 6);
      keep.forEach((t, j) => { for (let k = 0; k < 3; k++) { const i = at(t, k); v.fromBufferAttribute(P, i).applyMatrix4(m).toArray(op, j * 9 + k * 3); on.set([Nn.getX(i), Nn.getY(i), Nn.getZ(i)], j * 9 + k * 3); ou.set([UV.getX(i), UV.getY(i)], j * 6 + k * 2); } });
      const rg = new THREE.BufferGeometry(); own.push(rg);
      rg.setAttribute('position', new THREE.BufferAttribute(op, 3)); rg.setAttribute('normal', new THREE.BufferAttribute(on, 3)); rg.setAttribute('uv', new THREE.BufferAttribute(ou, 2));
      const rm = src.material.clone(); rm.metalness = 0; rm.roughness = 0.9; rm.color.setHex(0xd9d0c8); rm.emissive = new THREE.Color(0x3a1004); own.push(rm); ringMat = rm;
      const ring = new THREE.Mesh(rg, rm); ring.userData.noOutline = true; ring.scale.setScalar(1.55); ring.position.y = -0.02; ring.rotation.y = 0.6; ring.castShadow = pc; ring.receiveShadow = true; base.add(ring);
    } catch (err) { console.warn('[campfire] stone ring failed to load', err?.message ?? err); }
  })();
  if (DRESS) {                                        // generated camp props (Pell stands at about +2.6, -1.2): Quest gets the log bench only (one 2.3k-triangle twin), PC the lot
    const seat = (id, dx, dz, size, face) => { const h = gen.spawn(ctx, id, { x: X + dx, z: Z + dz, size, yaw: face ? Math.atan2(-dx, -dz) : dz * 3 }); h.ready.then(() => h.object.traverse((o) => { o.userData.noOutline = true; })); };
    seat('sz-campfire-logbench', -2.0, 0.3, 1.6, true);
    if (pc) { seat('sz-woodpile', -1.5, -2.0, 0.95, false); seat('sz-stump', 1.5, 1.7, 0.55, false); seat('sz-boulder-c', 2.6, 1.9, 0.75, false); }
  }
  // ---------------------------------------------------------------- light, particles, sound (kit)
  const glow = kit?.light(ctx, { color: 0xff8a3a, intensity: pc ? 30 : 24, distance: 16, flicker: 0.45, position: { x: X, y: Y + 0.8, z: Z } });
  const embers = kit?.particles(ctx, { count: pc ? 70 : 36, color: [0xffd27a, 0xff3a00], size: [0.05, 0.012], life: [1.6, 3.4], speed: 0.45, gravity: -0.75, drag: 0.35, spread: 0.12 });
  const smoke = kit?.particles(ctx, { count: pc ? 56 : 30, additive: false, color: [0x6e5a50, 0x1d1d22], alpha: 0.3, size: [0.35, 1.5], life: [2.8, 4.2], speed: 0.1, gravity: -0.5, drag: 0.5, spread: 0.12 });
  const snd = kit?.sound(ctx, { volume: 0.8 });
  const p = new THREE.Vector3(), push = new THREE.Vector3(), at = new THREE.Vector3(X, Y + 0.4, Z), head = ctx.player.head;
  let accE = 0, accS = 0, nextCrackle = 0.5, nextRoar = 0;

  const put = (q, cx, cy, cz, rx, ry, rz, ux, uy, uz, r, gg2, b, a) => {      // write quad q: centre, half-right vector, half-up vector, colour
    const o = q * 4;
    for (let k = 0; k < 4; k++) {
      const sx = k === 1 || k === 2 ? 1 : -1, sy = k > 1 ? 1 : -1, j = (o + k) * 3, c = (o + k) * 4;
      pos[j] = cx + rx * sx + ux * sy; pos[j + 1] = cy + ry * sx + uy * sy; pos[j + 2] = cz + rz * sx + uz * sy;
      col[c] = r; col[c + 1] = gg2; col[c + 2] = b; col[c + 3] = a;
    }
  };
  return {
    update(dt, t) {
      blend();
      const f = 0.85 + 0.15 * Math.sin(t * 11.3) + 0.1 * Math.sin(t * 23.1 + 1.3) + 0.06 * Math.sin(t * 4.7);   // global flicker ~1
      for (let i = 0; i < NT; i++) {
        const q = tongues[i], u = (t / q.life + q.ph) % 1, env = (u < 0.15 ? u / 0.15 : 1) * Math.pow(1 - u, 1.1);
        const px = Math.cos(q.ang) * q.rad, pz = Math.sin(q.ang) * q.rad, by = 0.1 + u * 0.28 * q.h, h = q.h * f * (1 - 0.35 * u) * (0.9 + 0.2 * Math.sin(t * 7 + q.sw));
        let dx = head.x - X - px, dz = head.z - Z - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const w = q.w * (1 - 0.5 * u) * 0.5, rx = dz * w, rz = -dx * w, lean = Math.sin(t * 2.6 + q.sw) * 0.09 * u + Math.sin(t * 9 + q.sw) * 0.02;
        const a = Math.min(1, env * (q.inner ? 1.0 : 0.8) * f);
        // quad corners: bottom at by, top leaning sideways; written through put() with a sheared up-vector by using two half-heights
        put(i, px + lean * 0.5, by + h * 0.5, pz + lean * 0.3, rx, 0, rz, lean * 0.5, h * 0.5, lean * 0.3, 1, 1, 1, a);
      }
      { let dx = head.x - X, dz = head.z - Z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        put(NT, 0, 0.6, 0, dz * 1.3, 0, -dx * 1.3, 0, 1.05, 0, 1, 1, 1, 0.2 * f);
        put(NT + 1, 0, 0.32, 0, dz * 0.5, 0, -dx * 0.5, 0, 0.4, 0, 1, 1, 1, 0.38 * f); }
      put(NT + 2, 0, 0.1, 0, 0.42, 0, 0, 0, 0, 0.42, 1, 1, 1, 0.75 * f);                         // coal bed (flat)
      const ga = 0.5 * f; for (let i = 0, c = GO * 4; i < NG; i++, c += 4) { col[c] = col[c + 1] = col[c + 2] = 1; col[c + 3] = ga; }
      posA.needsUpdate = colA.needsUpdate = true;
      logMat.emissiveIntensity = 0.6 + f * 0.6; if (ringMat) ringMat.emissiveIntensity = 0.5 + f * 0.7;
      if (glow) glow.intensity = (pc ? 30 : 24) * (0.9 + 0.1 * f);
      if (!kit) return;
      accE += dt * 7; accS += dt * 4.5;
      let n = accE | 0; accE -= n;
      while (n-- > 0) { push.set((Math.random() - 0.5) * 0.35 + 0.1, 0.35 + Math.random() * 0.5, (Math.random() - 0.5) * 0.35); embers.emit(p.set(X, Y + 0.5, Z), 1, push); }
      n = accS | 0; accS -= n;
      if (n) smoke.emit(p.set(X + 0.05, Y + 1.1, Z), n, push.set(0.12, 0.1, 0.02));
      if (t > nextCrackle) {                                                                      // random pops positional at the fire
        nextCrackle = t + 0.08 + Math.random() * 0.5;
        snd.noise({ dur: 0.02 + Math.random() * 0.05, filter: { type: 'bandpass', freq: 1500 + Math.random() * 3500, q: 3 }, vol: 0.1 + Math.random() * 0.2, at });
        if (Math.random() < 0.15) snd.tone({ freq: 80 + Math.random() * 60, freqEnd: 40, dur: 0.08, vol: 0.18, at });
        if (Math.random() < 0.2) embers.emit(p.set(X, Y + 0.45, Z), 3, push.set(0, 0.9, 0), 1.6);   // a pop throws a few sparks
      }
      if (t > nextRoar) {                                                                         // soft overlapping swells = fire bed
        nextRoar = t + 0.7;
        snd.noise({ dur: 1.1, attack: 0.35, filter: { type: 'lowpass', freq: 380, q: 0.7 }, vol: 0.12, at });
      }
    },
  };
}

