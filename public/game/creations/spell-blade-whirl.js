// Spell: Blade Whirl. Three spectral blades spin around you for 14 seconds, slicing anything hostile that wanders into the ring.
// Cast again while they are out and they fly wide in a screaming 5-metre sweep before snapping back to your side. A moving shield
// of edges, not a projectile: it works best when you stand your ground. Slash damage, so it takes limbs (honours the gore setting).
export const meta = { name: 'Blade Whirl', description: 'Spell: spectral blades orbit you; recast to sweep them outward.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const HOSTILE = { hostileTo: 'friendly' };
  const COLOR = 0x9ff0ff, N = 3, LIFE = 14, FROM = { from: 'player', kind: 'slash', force: 2, direction: undefined };
  const W = { t: -1, a: 0, burst: -1, swish: 0, mem: [], memT: [] };
  const tmp = new THREE.Vector3(), tan = new THREE.Vector3(), c = new THREE.Vector3(), tv = new THREE.Vector3();
  const mr = () => (ctx.input.passthrough ? 0.4 : 1);

  const bladeG = new THREE.OctahedronGeometry(1, 0).scale(0.07, 0.02, 0.55), haloG = new THREE.OctahedronGeometry(1, 0).scale(0.17, 0.08, 0.68), coreM = new THREE.MeshBasicMaterial({ color: 0xeafdff }), haloM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const ringM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2), ringM); ring.visible = false; ring.userData.noShadow = true; ctx.root.add(ring);
  const blades = [];
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(bladeG, coreM), h = new THREE.Mesh(haloG, haloM);
    m.add(h); m.visible = false; m.userData.noShadow = h.userData.noShadow = true; ctx.root.add(m); blades.push(m);
  }
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of [haloM, ringM]) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const trail = kit.particles(ctx, { count: 500, color: [0xffffff, 0x40c8ff], size: [0.12, 0.02], life: [0.18, 0.4], speed: 0.05, drag: 1 });
  const spark = kit.particles(ctx, { count: 160, color: [0xffffff, 0x9ff0ff], size: [0.1, 0.02], life: [0.2, 0.6], speed: [1.5, 5], gravity: 5, drag: 0.8 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  for (let i = 0; i < 16; i++) { W.mem.push(null); W.memT.push(0); }

  function cast() {
    const h = ctx.player.head;
    if (W.t < 0 || W.t > LIFE - 1) { W.t = 0; W.burst = -1; for (const b of blades) b.visible = true; spark.emit(tmp.set(h.x, ctx.player.feet.y + 1.1, h.z), 20, undefined, 1.2); if (!sfx('boomerang-whirl', h)) snd.noise({ dur: 0.6, filter: { type: 'bandpass', freq: 600, freqEnd: 2600, q: 1.2 }, vol: 0.35 }); }
    else if (W.burst < 0) { W.burst = 0; if (!sfx('swing-heavy', h)) snd.noise({ dur: 0.5, filter: { type: 'bandpass', freq: 400, freqEnd: 3000, q: 1 }, vol: 0.4 }); ctx.world.audio?.sfx('boomerang-whirl', { at: h }); }
    kit.haptic?.('right', 0.5, 60); kit.haptic?.('left', 0.5, 60);
  }
  function seen(d, t) { // per-victim cooldown: one blade pass hurts once, not every frame
    for (let i = 0; i < 16; i++) if (W.mem[i] === d && t < W.memT[i]) return true;
    return false;
  }
  function note(d, t) { let k = 0; for (let i = 0; i < 16; i++) { if (!W.mem[i] || t >= W.memT[i]) { k = i; break; } if (W.memT[i] < W.memT[k]) k = i; } W.mem[k] = d; W.memT[k] = t + 0.45; }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'blade-whirl', name: 'Blade Whirl', color: COLOR, icon: '🌀', rate: 0.8, description: 'Orbiting blades; recast to sweep them wide.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      if (W.t < 0) return;
      W.t += dt;
      const k = mr(), h = ctx.player.head, fade = Math.min(1, (LIFE - W.t) / 1), grow = Math.min(1, W.t / 0.4);
      let burst = 0;
      if (W.burst >= 0) { W.burst += dt; const u = W.burst / 1.3; if (u >= 1) W.burst = -1; else burst = Math.sin(Math.PI * Math.min(1, u * 1.1)); }
      const r = (1.35 + 3.9 * burst) * k * (0.3 + 0.7 * grow);
      W.a += dt * (6 + 9 * burst);
      c.set(h.x, ctx.player.feet.y + 1.1 * Math.max(0.6, k), h.z);
      ring.visible = burst > 0.02; ring.position.copy(c); ring.scale.setScalar(r); ringM.opacity = 0.3 * burst;
      for (let i = 0; i < N; i++) {
        const b = blades[i], a = W.a + i * 2.0944, s = Math.sin(a), co = Math.cos(a);
        b.position.set(c.x + co * r, c.y + Math.sin(t * 2.3 + i * 2) * 0.18 * k, c.z + s * r); b.rotation.y = -a; b.rotation.z = Math.sin(t * 9 + i) * 0.25;
        b.visible = fade > 0.02 && (fade > 0.9 || Math.sin(t * 40) > -0.3); b.scale.setScalar(k * (0.4 + 0.6 * grow) * (1 + 0.5 * burst));
        trail.emit(b.position, 2); if (burst > 0.1) trail.emit(tv.copy(b.position).addScaledVector(tan.set(s, 0, -co), 0.25 * k), 1);
        const d = kit.nearestTarget(b.position, (0.55 + 0.25 * burst) * k, HOSTILE);
        if (d && !seen(d, t)) {
          note(d, t); tan.set(-s, 0.05, co); FROM.direction = tan;
          kit.hit(d.center(tmp), 0.6, 8 + 4 * burst, FROM);
          spark.emit(tmp, 10, tan, 0.8); kit.haptic?.('right', 0.5, 40);
          if (!sfx('slash-flesh', tmp)) snd.noise({ dur: 0.12, filter: { type: 'highpass', freq: 2500, q: 0.8 }, vol: 0.3, at: tmp });
        }
      }
      W.swish -= dt; if (W.swish <= 0) { W.swish = 0.55 - 0.2 * burst; sfx('swing-light', c); snd.noise({ dur: 0.18, filter: { type: 'bandpass', freq: 1500, q: 2 }, vol: 0.05, at: c }); }
      if (W.t > LIFE) { W.t = -1; for (const b of blades) b.visible = false; ring.visible = false; spark.emit(c, 16); }
    },
  };
}
