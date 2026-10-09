// Spell: Vine Snare. Thorny vines burst out of the ground in a 3-metre patch where you point and hold it for 10 seconds: enemies in
// it are rooted (speed down to 12%), dragged toward the middle and pricked by thorns (pierce damage ticks); loose bodies get tangled.
// Pink blooms open on the vine tips. Two patches at most. Vines are instanced meshes that grow, sway and wither without allocating.
export const meta = { name: 'Vine Snare', description: 'Spell: vines root and prick everything in a patch of ground.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // (Math.hypot allocates in hot loops)
  const COLOR = 0x6bd04a, LIFE = 10, R = 3.2, VINES = 40, FROM = { from: 'player', kind: 'pierce', force: 0 };
  const tmp = new THREE.Vector3(), o3 = new THREE.Object3D(), col = new THREE.Color();
  const mr = () => (ctx.input.passthrough ? 0.35 : 1);

  const vineG = new THREE.CylinderGeometry(0.04, 0.15, 1, 5, 1).translate(0, 0.5, 0), budG = new THREE.IcosahedronGeometry(0.2, 0);
  const vineM = new THREE.MeshLambertMaterial({ color: 0x46c03a, emissive: 0x1c5a14, flatShading: true }), budM = new THREE.MeshLambertMaterial({ color: 0xff6aa8, emissive: 0xc03a80, flatShading: true });
  const patches = [], slows = [];
  for (let n = 0; n < 2; n++) {
    const vines = new THREE.InstancedMesh(vineG, vineM, VINES), buds = new THREE.InstancedMesh(budG, budM, VINES);
    vines.frustumCulled = buds.frustumCulled = false; vines.visible = buds.visible = false; vines.userData.noShadow = buds.userData.noShadow = true;
    const seed = []; for (let i = 0; i < VINES; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()); seed.push({ a, r, h: 1.5 + Math.random() * 1.4, ph: Math.random() * 6.283, lean: 0.25 + Math.random() * 0.5, lag: Math.random() * 0.4 }); vines.setColorAt(i, col.setHSL(0.27 + Math.random() * 0.06, 0.6, 0.25 + Math.random() * 0.1)); }
    ctx.root.add(vines, buds); patches.push({ px: new Float32Array(VINES), pz: new Float32Array(VINES), pg: new Float32Array(VINES), cy: new Float32Array(VINES), sy: new Float32Array(VINES), on: false, t: 0, tick: 0, acc: 0, p: new THREE.Vector3(), r: R, vines, buds, seed });
  }
  for (let i = 0; i < 16; i++) slows.push({ a: null, s0: 1, ap: 1, until: 0 });
  const pollen = kit.particles(ctx, { count: 240, color: [0xfff0b0, 0x9aff70], size: [0.1, 0.02], life: [0.8, 1.6], speed: [0.1, 0.5], gravity: -0.7, drag: 0.7 });
  const leaf = kit.particles(ctx, { count: 160, additive: false, color: [0x4aa03a, 0x2a6a22], size: [0.14, 0.07], life: [0.5, 1.1], speed: [1.5, 4], gravity: 6, drag: 0.5 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });

  function slow(a, t) { // root an actor; remember its speed (and leave it alone if someone else changed it meanwhile)
    let s = null;
    for (let i = 0; i < slows.length; i++) { const q = slows[i]; if (q.a === a) { s = q; break; } if (!s && !q.a) s = q; }
    if (!s) return;
    if (s.a !== a) { s.a = a; s.s0 = a.speed; s.ap = a.speed * 0.12; a.speed = s.ap; }
    else if (Math.abs(a.speed - s.ap) > 1e-6) { s.s0 = a.speed; s.ap = a.speed * 0.12; a.speed = s.ap; } // a behaviour (a charge...) changed its speed: root the new one
    s.until = t + 0.6;
  }
  function cast({ origin, direction }) {
    const aim = ctx.aimPoint(ctx.input.passthrough ? 3 : 30), k = mr();
    if (aim) tmp.copy(aim); else { tmp.copy(origin).addScaledVector(direction, 5 * k); tmp.y = ctx.groundAt(tmp.x, tmp.z); }
    const p = patches.find((q) => !q.on) ?? patches.reduce((o, q) => (q.t > o.t ? q : o));
    p.on = true; p.t = 0; p.tick = 0.3; p.p.copy(tmp); p.r = R * k; p.vines.visible = p.buds.visible = true;
    for (let i = 0; i < VINES; i++) { const s = p.seed[i]; p.px[i] = tmp.x + Math.cos(s.a) * s.r * p.r; p.pz[i] = tmp.z + Math.sin(s.a) * s.r * p.r; p.pg[i] = ctx.groundAt(p.px[i], p.pz[i]); p.cy[i] = Math.cos(s.a + 1.57); p.sy[i] = Math.sin(s.a + 1.57); }
    leaf.emit(tmp, 30, undefined, 1.2); pollen.emit(tmp, 20, undefined, 1.5);
    kit.flash(ctx, tmp.set(p.p.x, p.p.y + 0.5, p.p.z), { color: COLOR, intensity: 18, distance: 8, duration: 0.3 });
    if (!sfx('slime-squish', p.p)) snd.noise({ dur: 0.7, filter: { type: 'bandpass', freq: 900, freqEnd: 2600, q: 0.9 }, vol: 0.4, at: p.p });
    sfx('earth-wall', p.p); kit.haptic?.('right', 0.5, 60);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'vine-snare', name: 'Vine Snare', color: COLOR, icon: '🌿', rate: 1, description: 'Thorny vines root and prick everything in a patch.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); for (const s of slows) if (s.a && !s.a.removed && Math.abs(s.a.speed - s.ap) < 1e-6) s.a.speed = s.s0; });

  return {
    update(dt, t) {
      for (let n = 0; n < patches.length; n++) {
        const p = patches[n];
        if (!p.on) continue;
        p.t += dt;
        const fade = Math.min(1, (LIFE - p.t) / 1.2);
        p.acc += dt; const redraw = p.t < 1.1 || fade < 1 || p.acc >= 0.08; // growing / withering: every frame; swaying: 12 Hz
        if (redraw) p.acc = 0;
        const mm = Math.max(0.4, mr()), vm = p.vines.instanceMatrix.array, bm = p.buds.instanceMatrix.array;
        for (let i = 0; redraw && i < VINES; i++) {
          const s = p.seed[i], g = Math.max(0, Math.min(1, (p.t - s.lag) / 0.5)) * Math.max(0, fade), e = 1 - (1 - g) * (1 - g) * (1 - g);
          const h = s.h * e * mm, hh = h > 0.01 ? h : 0.01, lean = s.lean + Math.sin(t * 2 + s.ph) * 0.1, cz = Math.cos(lean), sz = Math.sin(lean), cy = p.cy[i], sy = p.sy[i], x = p.px[i], z = p.pz[i], gy = p.pg[i], o = i * 16;
          // matrices are written straight into the instance arrays (position/yaw/ground are precomputed at cast): Ry * Rz with scale (1, h, 1)
          vm[o] = cy * cz; vm[o + 1] = sz; vm[o + 2] = -sy * cz; vm[o + 3] = 0; vm[o + 4] = -cy * sz * hh; vm[o + 5] = cz * hh; vm[o + 6] = sy * sz * hh; vm[o + 7] = 0; vm[o + 8] = sy; vm[o + 9] = 0; vm[o + 10] = cy; vm[o + 11] = 0; vm[o + 12] = x; vm[o + 13] = gy; vm[o + 14] = z; vm[o + 15] = 1;
          const bs = e > 0.01 ? e * (0.85 + 0.15 * Math.sin(t * 3 + s.ph)) : 0.01;
          bm[o] = bs; bm[o + 1] = 0; bm[o + 2] = 0; bm[o + 3] = 0; bm[o + 4] = 0; bm[o + 5] = bs; bm[o + 6] = 0; bm[o + 7] = 0; bm[o + 8] = 0; bm[o + 9] = 0; bm[o + 10] = bs; bm[o + 11] = 0;
          bm[o + 12] = x - cy * sz * hh * 0.95; bm[o + 13] = gy + cz * hh * 0.95; bm[o + 14] = z + sy * sz * hh * 0.95; bm[o + 15] = 1; // (tip of the vine)
        }
        if (redraw) { p.vines.instanceMatrix.needsUpdate = true; p.buds.instanceMatrix.needsUpdate = true; if (p.vines.instanceColor) p.vines.instanceColor.needsUpdate = true; }
        if (Math.random() < dt * 10) pollen.emit(tmp.set(p.p.x + (Math.random() - 0.5) * p.r * 1.6, p.p.y + 0.3, p.p.z + (Math.random() - 0.5) * p.r * 1.6), 1);
        p.tick -= dt;
        if (p.tick <= 0 && p.t > 0.4) {
          p.tick = 0.5; kit.hit(tmp.set(p.p.x, p.p.y + 0.6, p.p.z), p.r, 2.4, FROM);
        }
        if (p.t > 0.4) {
          const F = ctx.world.combat?.fighters;
          if (F) for (let i = 0; i < F.length; i++) {
            const a = F[i].actor;
            if (F[i].faction === 'friendly' || !a || a.dead) continue;
            const dx = p.p.x - a.position.x, dz = p.p.z - a.position.z, d = hyp(dx, dz);
            if (d >= p.r) continue;
            slow(a, t); if (d > 0.6) { const m = Math.min(d, 1.1 * dt); a.position.x += dx / d * m; a.position.z += dz / d * m; } // the vines haul it inward
            if (Math.random() < dt * 4) leaf.emit(tmp.set(a.position.x, a.position.y + 0.4, a.position.z), 2);
          }
          const BD = ctx.world.spells?.bodies?.();
          if (BD) for (let i = 0; i < BD.length; i++) { const b = BD[i]; if (!b.removed && !b.held && b.invMass !== 0 && hyp(b.position.x - p.p.x, b.position.z - p.p.z) < p.r && b.position.y < p.p.y + 2) b.velocity.multiplyScalar(Math.exp(-3 * dt)); }
        }
        if (p.t > LIFE) { p.on = false; p.vines.visible = p.buds.visible = false; leaf.emit(p.p, 20, undefined, 1.2); }
      }
      for (let i = 0; i < slows.length; i++) { const s = slows[i]; if (s.a && (t > s.until || s.a.removed)) { if (!s.a.removed && Math.abs(s.a.speed - s.ap) < 1e-6) s.a.speed = s.s0; s.a = null; } }
    },
  };
}
