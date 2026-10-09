// Spell: Fissure. Slam the earth and a glowing crack races away from your feet along the line you point, 24 m at 20 m/s. Every
// metre and a half the ground heaves behind the crack's tip: dust, a bang, and a shove that throws standing enemies, crates and
// ragdolls up and aside. The scar glows orange for a few seconds, then cools to ash. One fissure at a time. Mixed reality: 5 m.
export const meta = { name: 'Fissure', description: 'Spell: a crack tears across the ground, heaving everything along it.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xff7a2a, SEGS = 26, LEN = 24, SPEED = 20, GLOW = 7, HEAVE = { from: 'player', kind: 'blunt', force: 9, direction: undefined };
  const F = { on: false, d: 0, x: 0, z: 0, dx: 0, dz: 0, len: LEN, next: 0, i: 0, rumble: 0 };
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), tip = new THREE.Vector3();
  const mr = () => (ctx.input.passthrough ? 0.25 : 1);

  const planeG = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ashM = new THREE.MeshBasicMaterial({ color: 0x1a1210, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const lavaM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, fog: false });
  const segs = [];
  for (let i = 0; i < SEGS; i++) {
    const g = new THREE.Group(), ash = new THREE.Mesh(planeG, ashM.clone()), lava = new THREE.Mesh(planeG, lavaM.clone());
    ash.scale.set(1.5, 1, 1.9); lava.scale.set(0.7, 1, 1.9); lava.position.y = 0.01; ash.position.y = -0.01; g.add(ash, lava); g.visible = false; g.traverse((o) => { o.userData.noShadow = true; }); ctx.root.add(g);
    segs.push({ g, lava, age: -1 });
  }
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const s of segs) { const m = s.lava.material; if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const dust = kit.particles(ctx, { count: 360, additive: false, color: [0x9a8a70, 0x5a4a3a], alpha: 0.5, size: [0.5, 1.4], life: [0.6, 1.3], speed: [0.8, 2.6], gravity: -0.2, drag: 1.4 });
  const embers = kit.particles(ctx, { count: 300, color: [0xffe0a0, 0xff4a10], size: [0.1, 0.02], life: [0.5, 1.4], speed: [2, 6], gravity: 6, drag: 0.5 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 12, flicker: 0.5 });

  function cast({ origin, direction }) {
    const k = mr(), h = ctx.player.feet;
    dir.set(direction.x, 0, direction.z); if (dir.lengthSq() < 1e-4) dir.set(ctx.player.forward.x, 0, ctx.player.forward.z);
    dir.normalize();
    F.on = true; F.d = 0; F.dx = dir.x; F.dz = dir.z; F.x = h.x + dir.x * 1.4 * Math.max(0.4, k); F.z = h.z + dir.z * 1.4 * Math.max(0.4, k); F.len = LEN * k; F.next = 0; F.rumble = 0;
    tip.set(F.x, ctx.groundAt(F.x, F.z), F.z);
    if (!sfx('ground-slam', tip)) snd.tone({ freq: 80, freqEnd: 30, dur: 0.6, vol: 0.8, at: tip });
    sfx('earth-wall', tip);
    kit.haptic?.('right', 0.9, 120); kit.haptic?.('left', 0.6, 80);
  }
  function heave(x, z) {
    const y = ctx.groundAt(x, z), s = segs[F.i++ % SEGS];
    s.age = 0; s.g.visible = true; s.g.position.set(x, y + 0.32, z); // (lifted above the grass) s.g.rotation.y = Math.atan2(F.dx, F.dz); s.g.scale.setScalar(Math.max(0.3, mr() * 1.2 + 0.0));
    tip.set(x, y + 0.3, z); HEAVE.direction = dir.set(F.dx, 0.5, F.dz);
    kit.hit(tip, 1.9 * Math.max(0.4, mr()), 12, HEAVE);
    ctx.world.physics?.explode?.(tip, 2.4 * Math.max(0.4, mr()), 7, { lift: 0.9 });
    dust.emit(tip, 14, undefined, 1.4); embers.emit(tip, 10);
    glow.position.set(x, y + 0.6, z); glow.intensity = 14;
    if (F.i % 2) snd.noise({ dur: 0.35, filter: { type: 'lowpass', freq: 500, freqEnd: 80, q: 1 }, vol: 0.4, at: tip });
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'fissure', name: 'Fissure', color: COLOR, icon: '🌋', rate: 1.6, description: 'A crack races along the ground, heaving everything.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      if (F.on) {
        const step = SPEED * dt;
        F.d += step; F.x += F.dx * step; F.z += F.dz * step;
        while (F.next <= F.d) { F.next += 1.5 * Math.max(0.4, mr()); const w = Math.sin(F.next * 0.55) * 0.35; heave(F.x - F.dz * w, F.z + F.dx * w); }
        F.rumble -= dt; if (F.rumble <= 0) { F.rumble = 0.06; kit.haptic?.('right', 0.35, 40); }
        if (F.d >= F.len) { F.on = false; embers.emit(tip, 20, undefined, 1.5); }
      }
      let lit = 0;
      for (let i = 0; i < SEGS; i++) {
        const s = segs[i];
        if (s.age < 0) continue;
        s.age += dt;
        if (s.age > GLOW + 2) { s.age = -1; s.g.visible = false; continue; }
        const a = Math.max(0, 1 - s.age / GLOW), fl = 0.85 + 0.15 * Math.sin(t * 9 + i);
        s.lava.material.opacity = 0.9 * a * a * fl; s.g.children[0].material.opacity = 0.85 * Math.min(1, (GLOW + 2 - s.age) / 2);
        if (a > 0.5 && Math.random() < dt * 4) embers.emit(tmp.set(s.g.position.x, s.g.position.y + 0.1, s.g.position.z), 1);
        lit = Math.max(lit, a);
      }
      if (!F.on) glow.intensity = Math.max(0, glow.intensity - dt * 20);
    },
  };
}
