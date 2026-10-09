// Spell: Spirit Wolves. A pack of three spectral wolves tears out of your hand's spirit-light and hunts: each picks a DIFFERENT
// enemy (nearest to where you point, within 28 m), races across the terrain at 14 m/s with legs pumping, leaps and bites (slash,
// 14 dmg + a shove), then bounds on to the next prey, up to three bites each or 6 s, ending in a howl and a puff of light. With
// no enemies they bound off in the direction you point and fade. Pooled meshes; one pack at a time.
export const meta = { name: 'Spirit Wolves', description: 'Spell: three spectral wolves hunt down different enemies.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // (Math.hypot allocates in hot loops)
  const COLOR = 0x9fe8ff, N = 3, LIFE = 6, SPEED = 14, FROM = { from: 'player', kind: 'slash', force: 3, direction: undefined };
  const tmp = new THREE.Vector3(), tc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const mr = () => (ctx.input.passthrough ? 0.4 : 1);

  const coreM = new THREE.MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.85 }), haloM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const boxG = new THREE.BoxGeometry(1, 1, 1);
  const wolves = [];
  for (let n = 0; n < N; n++) {
    const g = new THREE.Group(), part = (sx, sy, sz, x, y, z, m = coreM) => { const q = new THREE.Mesh(boxG, m); q.scale.set(sx, sy, sz); q.position.set(x, y, z); g.add(q); return q; };
    part(0.28, 0.3, 0.7, 0, 0.55, 0); const head = part(0.24, 0.24, 0.3, 0, 0.66, 0.5); part(0.12, 0.1, 0.2, 0, 0.6, 0.72); part(0.08, 0.16, 0.06, 0.08, 0.84, 0.46); part(0.08, 0.16, 0.06, -0.08, 0.84, 0.46);
    const tail = part(0.07, 0.07, 0.5, 0, 0.62, -0.55); part(0.5, 0.55, 1.2, 0, 0.58, 0.05, haloM);
    const legs = []; for (let i = 0; i < 4; i++) { const l = new THREE.Group(); l.position.set(i % 2 ? 0.1 : -0.1, 0.42, i < 2 ? 0.25 : -0.25); const s = new THREE.Mesh(boxG, coreM); s.scale.set(0.07, 0.4, 0.07); s.position.y = -0.2; l.add(s); g.add(l); legs.push(l); }
    g.visible = false; g.traverse((m) => { m.userData.noShadow = true; }); ctx.root.add(g);
    wolves.push({ g, legs, head, tail, on: false, t: 0, bites: 0, f: null, x: 0, z: 0, y: 0, yaw: 0, leap: 0, cd: 0, ph: n, dx: 0, dz: 0, hit: false });
  }
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; if (pt) { haloM.blending = THREE.CustomBlending; haloM.blendEquation = THREE.AddEquation; haloM.blendSrc = THREE.SrcAlphaFactor; haloM.blendDst = THREE.OneFactor; haloM.blendSrcAlpha = THREE.ZeroFactor; haloM.blendDstAlpha = THREE.OneFactor; } else haloM.blending = THREE.AdditiveBlending; haloM.needsUpdate = true; };
  const mist = kit.particles(ctx, { count: 500, color: [0xe8fcff, 0x50b8ff], size: [0.3, 0.04], life: [0.3, 0.8], speed: [0.1, 0.6], gravity: -0.3, drag: 1 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const taken = (f) => { for (const w of wolves) if (w.on && w.f === f) return true; return false; };
  function prey(w, from) {
    const F = ctx.world.combat?.fighters;
    let best = null, bd = 1e9;
    if (F) for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (!f.alive || f.faction !== 'enemy' || taken(f) && w.bites === 0) continue;
      const d = hyp(f.actor.position.x - from.x, f.actor.position.z - from.z);
      if (d < 28 && d < bd) { bd = d; best = f; }
    }
    return best;
  }
  function cast({ origin, direction }) {
    const k = mr(), aim = ctx.aimPoint(40);
    coreM.opacity = 0.85; for (const w of wolves) { w.on = false; w.g.visible = false; }
    for (let n = 0; n < N; n++) {
      const w = wolves[n], a = (n - 1) * 0.5 + Math.atan2(direction.x, direction.z), off = (n - 1) * 0.5;
      w.on = true; w.t = 0; w.bites = 0; w.leap = 0; w.cd = 0.15 * n; w.hit = false; w.f = null;
      w.x = origin.x + Math.cos(a) * off; w.z = origin.z - Math.sin(a) * off; w.y = ctx.groundAt(w.x, w.z); w.yaw = a; w.dx = Math.sin(a); w.dz = Math.cos(a);
      w.g.visible = true; w.g.scale.setScalar(k);
      tc.set(aim ? aim.x : origin.x + direction.x * 12, 0, aim ? aim.z : origin.z + direction.z * 12);
      w.f = prey(w, tc);
      mist.emit(tmp.set(w.x, w.y + 0.5, w.z), 16, undefined, 1.2);
    }
    if (!sfx('wolf-howl', origin)) snd.tone({ freq: 400, freqEnd: 700, dur: 0.8, type: 'sine', vol: 0.15, at: origin });
    sfx('summon', origin); kit.haptic?.('right', 0.6, 70);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'spirit-wolves', name: 'Spirit Wolves', color: COLOR, icon: '🐺', rate: 2, description: 'Three spectral wolves hunt different enemies.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      for (let n = 0; n < N; n++) {
        const w = wolves[n];
        if (!w.on) continue;
        w.t += dt; w.cd -= dt;
        const k = mr();
        if (w.f && (!w.f.alive || w.f.removed)) w.f = null;
        if (!w.f && w.bites > 0 && w.cd <= 0) { w.f = prey(w, tmp.set(w.x, 0, w.z)); w.cd = 0.3; }
        let sp = SPEED * k, bite = false;
        if (w.cd > 0 && w.bites === 0) sp = 0;
        if (w.f) {
          const A = w.f.actor, dx = A.position.x - w.x, dz = A.position.z - w.z, d = hyp(dx, dz);
          w.dx = dx / (d || 1); w.dz = dz / (d || 1); { const da = Math.atan2(w.dx, w.dz) - w.yaw; w.yaw += Math.atan2(Math.sin(da), Math.cos(da)) * Math.min(1, dt * 12); }
          if (d < 1.8 * k + 0.4 && w.leap <= 0) { w.leap = 0.45; w.hit = false; }
          if (d < 0.9 * k) sp *= 0.3;
        } else { w.dx = Math.sin(w.yaw); w.dz = Math.cos(w.yaw); }
        w.x += w.dx * sp * dt; w.z += w.dz * sp * dt;
        let lift = 0;
        if (w.leap > 0) { // the leap: an arc, and the bite lands at the top
          w.leap -= dt; lift = Math.sin(Math.PI * (1 - w.leap / 0.45)) * 0.9 * k;
          if (!w.hit && w.leap < 0.22 && w.f) {
            w.hit = true; w.bites++; const A = w.f.actor; tc.set(A.position.x, A.position.y + (A.height ?? 1.5) * 0.6, A.position.z); FROM.direction = up.set(w.dx, 0.2, w.dz);
            kit.hit(tc, 0.9, 14, FROM); mist.emit(tc, 14, undefined, 1.2); kit.flash(ctx, tc, { color: COLOR, intensity: 20, distance: 6, duration: 0.15 }); kit.haptic?.('right', 0.4, 40);
            if (!sfx('wolf-growl', tc)) snd.noise({ dur: 0.2, filter: { type: 'bandpass', freq: 400, q: 1 }, vol: 0.3, at: tc }); sfx('slash-flesh', tc);
            w.cd = 0.25; w.f = null;
          }
        }
        const gy = ctx.groundAt(w.x, w.z); w.y += (gy - w.y) * Math.min(1, dt * 14);
        w.g.position.set(w.x, w.y + lift, w.z); w.g.rotation.y = w.yaw;
        const ph = t * 22 + w.ph; for (let i = 0; i < 4; i++) w.legs[i].rotation.x = Math.sin(ph + (i % 2) * 3.14 + (i < 2 ? 0 : 1.57)) * (sp > 0 ? 0.9 : 0.1);
        w.g.position.y += Math.abs(Math.sin(ph * 0.5)) * 0.08 * k; w.tail.rotation.y = Math.sin(ph * 0.5) * 0.5;
        if (sp > 0) mist.emit(tmp.set(w.x - w.dx * 0.5, w.y + 0.45 * k, w.z - w.dz * 0.5), 2);
        if (w.t > LIFE - 0.7) coreM.opacity = Math.max(0.1, (LIFE - w.t) * 1.2);
        if (w.t >= LIFE || w.bites >= 3 || (!w.f && w.bites === 0 && w.t > 3)) { w.on = false; w.g.visible = false; mist.emit(tmp.set(w.x, w.y + 0.6, w.z), 24, undefined, 1.5); sfx('wolf-howl', w.g.position); }
      }
    },
  };
}
