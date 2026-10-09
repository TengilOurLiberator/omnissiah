// Spell: Venom Flask. Lob a glass flask of green brew: a real physics body that arcs, tumbles and bounces. It shatters on the first
// thing it hits and a poison cloud blooms there for 9 seconds, blistering everyone inside (magic damage ticks) and dragging their
// speed down to under half while they breathe it. Three clouds at most; the oldest thins out first.
export const meta = { name: 'Venom Flask', description: 'Spell: throw a flask that bursts into a lingering poison cloud.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // (Math.hypot allocates in hot loops)
  const COLOR = 0x6bff3a, LIFE = 9, R = 3.4, FROM = { from: 'player', kind: 'magic', force: 0 };
  const tmp = new THREE.Vector3(), tv = new THREE.Vector3();
  const mr = () => (ctx.input.passthrough ? 0.4 : 1);

  const glassG = new THREE.SphereGeometry(0.085, 12, 8), glassM = new THREE.MeshLambertMaterial({ color: 0x9cffb0, emissive: 0x2a8a30, transparent: true, opacity: 0.8 }), corkG = new THREE.CylinderGeometry(0.02, 0.025, 0.07, 6);
  const corkM = new THREE.MeshLambertMaterial({ color: 0x8a6a40 });
  const flasks = [], clouds = [], slows = [];
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    d.visible = false; d.userData.noShadow = true; ctx.root.add(d); clouds.push({ d, on: false, t: 0, tick: 0, hiss: 0, acc: 0, p: new THREE.Vector3(), r: 1 });
  }
  for (let i = 0; i < 16; i++) slows.push({ a: null, s0: 1, ap: 1, until: 0 });
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const c of clouds) { const m = c.d.material; if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const fog = kit.particles(ctx, { count: 700, additive: false, color: [0x7aff4a, 0x2a8a1a], alpha: 0.4, size: [1.3, 2.6], life: [1.2, 2.2], speed: [0.1, 0.5], gravity: -0.25, drag: 0.8, spread: 0.3 });
  const glow = kit.particles(ctx, { count: 200, color: [0xe8ffc0, 0x70ff30], size: [0.12, 0.02], life: [0.6, 1.4], speed: [0.1, 0.5], gravity: -0.9, drag: 0.6 });
  const shards = kit.particles(ctx, { count: 120, color: [0xffffff, 0x9cffb0], size: [0.1, 0.02], life: [0.4, 0.9], speed: [2, 6], gravity: 10, drag: 0.3 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const glowL = kit.light(ctx, { color: COLOR, intensity: 0, distance: 9 });

  function slow(a, t) { // slow an actor while it stands in a cloud; remembers the speed to restore (and leaves it alone if someone else changed it)
    let s = null;
    for (let i = 0; i < slows.length; i++) { const q = slows[i]; if (q.a === a) { s = q; break; } if (!s && !q.a) s = q; }
    if (!s) return;
    if (s.a !== a) { s.a = a; s.s0 = a.speed; s.ap = a.speed * 0.45; a.speed = s.ap; }
    else if (Math.abs(a.speed - s.ap) > 1e-6) { s.s0 = a.speed; s.ap = a.speed * 0.45; a.speed = s.ap; } // a behaviour (a charge...) changed its speed: slow the new one
    s.until = t + 0.7;
  }
  function shatter(f) {
    if (!f.on) return;
    f.on = false; f.mesh.visible = false; const p = f.body.position;
    tmp.copy(p).setY(Math.max(p.y, ctx.groundAt(p.x, p.z) + 0.1));
    f.body.remove();
    let c = clouds.find((q) => !q.on) ?? clouds.reduce((o, q) => (q.t > o.t ? q : o));
    c.on = true; c.t = 0; c.tick = 0.1; c.p.copy(tmp); c.r = R * mr(); c.d.visible = true; c.d.position.set(tmp.x, tmp.y + 0.05, tmp.z);
    shards.emit(tmp, 24); fog.emit(tmp, 14, undefined, 1.3); glow.emit(tmp, 16);
    kit.flash(ctx, tmp, { color: COLOR, intensity: 30, distance: 9, duration: 0.3 });
    if (!sfx('break-glass', tmp)) snd.noise({ dur: 0.25, filter: { type: 'highpass', freq: 3000, q: 0.8 }, vol: 0.4, at: tmp });
    sfx('slime-splat', tmp); snd.noise({ dur: 0.7, filter: { type: 'bandpass', freq: 2500, freqEnd: 900, q: 1.4 }, vol: 0.2, at: tmp });
  }
  function cast({ origin, direction }) {
    let f = flasks.find((q) => !q.on);
    if (!f && flasks.length < 3) { const mesh = new THREE.Mesh(glassG, glassM), cork = new THREE.Mesh(corkG, corkM); cork.position.y = 0.1; mesh.add(cork); f = { mesh, on: false, body: null, age: 0 }; flasks.push(f); }
    if (!f) { f = flasks[0]; shatter(f); flasks.push(flasks.shift()); } // the oldest flask bursts early to make room
    f.mesh.visible = true; f.on = true; f.age = 0;
    f.body = kit.body(ctx, f.mesh, { position: origin, radius: 0.09, mass: 0.4, bounce: 0.15, friction: 0.4, from: 'player' });
    const aim = ctx.aimPoint(ctx.input.passthrough ? 3 : 32), v = f.body.velocity; // a lob that lands where you point (a straight throw when aiming at the sky)
    if (aim) { const T = Math.max(0.45, Math.min(2, aim.distanceTo(origin) / 15)); v.subVectors(aim, origin).multiplyScalar(1 / T); v.y += 4.9 * T; }
    else { v.copy(direction).multiplyScalar(15 * (ctx.input.passthrough ? 0.5 : 1)); v.y += 3; }
    f.body.onHit(() => shatter(f));
    if (!sfx('weapon-throw', origin)) snd.noise({ dur: 0.2, filter: { type: 'bandpass', freq: 900, freqEnd: 2200, q: 1 }, vol: 0.2, at: origin });
    kit.haptic?.('right', 0.35, 40);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'venom-flask', name: 'Venom Flask', color: COLOR, icon: '🧪', rate: 0.8, description: 'Throw a flask: a poison cloud that slows and blisters.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); for (const s of slows) if (s.a && !s.a.removed && Math.abs(s.a.speed - s.ap) < 1e-6) s.a.speed = s.s0; });

  return {
    update(dt, t) {
      blendFix();
      for (let i = 0; i < flasks.length; i++) {
        const f = flasks[i];
        if (!f.on) continue;
        f.age += dt; f.mesh.rotation.x += dt * 9; f.mesh.rotation.z += dt * 5;
        if (f.age > 0.08 && f.body.position.y <= ctx.groundAt(f.body.position.x, f.body.position.z) + 0.12) shatter(f);
        else if (f.age > 4) shatter(f);
      }
      let lit = null;
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        if (!c.on) continue;
        c.t += dt;
        const e = Math.min(1, c.t / 0.9), life = Math.min(1, (LIFE - c.t) / 2), r = c.r * (0.35 + 0.65 * e) * (0.85 + 0.15 * life);
        c.d.scale.setScalar(r); c.d.material.opacity = 0.2 * life * (0.8 + 0.2 * Math.sin(t * 4 + i));
        c.acc += dt * 70 * life * Math.max(0.4, c.r / R); const n = c.acc | 0; c.acc -= n;
        for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * r; fog.emit(tmp.set(c.p.x + Math.cos(a) * d, c.p.y + 0.15 + Math.random() * 0.4, c.p.z + Math.sin(a) * d), 1); }
        if (Math.random() < dt * 16) glow.emit(tmp.set(c.p.x + (Math.random() - 0.5) * r * 1.6, c.p.y + 0.2, c.p.z + (Math.random() - 0.5) * r * 1.6), 1);
        c.tick -= dt;
        if (c.tick <= 0) {
          c.tick = 0.5; kit.hit(tmp.set(c.p.x, c.p.y + 0.8, c.p.z), r, 2.8, FROM);
          const F = ctx.world.combat?.fighters;
          if (F) for (let k = 0; k < F.length; k++) { const a = F[k].actor; if (F[k].faction === 'friendly' || !a || a.dead) continue; if (hyp(a.position.x - c.p.x, a.position.z - c.p.z) < r) slow(a, t); }
        }
        c.hiss -= dt; if (c.hiss <= 0) { c.hiss = 0.9; snd.noise({ dur: 0.8, filter: { type: 'bandpass', freq: 3200, q: 0.6 }, vol: 0.06 * life, at: c.p }); }
        if (c.t > LIFE) { c.on = false; c.d.visible = false; }
        else lit = c;
      }
      // keep the slow only while they stay in the cloud
      for (let i = 0; i < slows.length; i++) { const s = slows[i]; if (s.a && (t > s.until || s.a.removed)) { if (!s.a.removed && Math.abs(s.a.speed - s.ap) < 1e-6) s.a.speed = s.s0; s.a = null; } }
      if (lit) { glowL.position.set(lit.p.x, lit.p.y + 1, lit.p.z); glowL.intensity = 6; } else glowL.intensity = 0;
    },
  };
}

