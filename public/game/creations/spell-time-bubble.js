// Spell: Time Bubble. A shimmering clock-sphere 5 m wide blooms where you point and time inside it crawls to 15% for 10 seconds:
// fighters move, wind up and strike in slow motion, projectiles hang in the air, loose bodies (and thrown weapons) drift. You stay
// at full speed, in or out. Nothing is frozen for good: every speed, gravity and drag it touched is put back when it pops or the
// thing leaves. Recasting moves the bubble. Mixed reality: a 1.6 m bubble.
export const meta = { name: 'Time Bubble', description: 'Spell: a sphere where enemies, arrows and objects crawl.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xbfe8ff, LIFE = 10, K = 0.15;
  const B = { on: false, t: 0, r: 5, tick: 0, pop: -1, p: new THREE.Vector3() };
  const fs = [], bs = [];
  for (let i = 0; i < 32; i++) { fs.push({ f: null, s0: 1, ap: 1 }); bs.push({ b: null, g0: 9.8, d0: 0.05, ga: 0, da: 0 }); }
  const tmp = new THREE.Vector3();
  const mr = () => (ctx.input.passthrough ? 0.32 : 1);

  const mk = (c, o, side) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side, fog: false });
  const mats = [mk(0x7fc8ff, 0.1, THREE.FrontSide), mk(0xffe9a8, 0.12, THREE.BackSide), mk(0xdff4ff, 0.5, THREE.DoubleSide), mk(0xffffff, 0.8, THREE.DoubleSide), mk(0xdff4ff, 0, THREE.DoubleSide)];
  const [shellM, innerM, ringM, handM, popM] = mats;
  const sphereG = new THREE.SphereGeometry(1, 28, 18), ringG = new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2), ticks = new THREE.BoxGeometry(0.02, 0.02, 0.1);
  const bubble = new THREE.Group(), shell = new THREE.Mesh(sphereG, shellM), inner = new THREE.Mesh(sphereG, innerM), ring = new THREE.Mesh(ringG, ringM), pop = new THREE.Mesh(sphereG, popM);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1), handM), hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.7), handM);
  hand.geometry = hand.geometry.clone().translate(0, 0, -0.5); hand2.geometry = hand2.geometry.clone().translate(0, 0, -0.35);
  const clock = new THREE.Group(); clock.add(hand, hand2, ring);
  for (let i = 0; i < 12; i++) { const tk = new THREE.Mesh(ticks, handM), a = i * 0.5236; tk.position.set(Math.sin(a) * 0.96, 0, -Math.cos(a) * 0.96); tk.rotation.y = a; tk.scale.set(1, 1, i % 3 ? 1 : 2); clock.add(tk); }
  clock.rotation.x = Math.PI / 2; // upright clock face standing in the sphere, turned toward the player each frame
  bubble.add(shell, inner, clock); bubble.visible = false; pop.visible = false; ctx.root.add(bubble, pop);
  for (const m of [shell, inner, ring, hand, hand2, pop]) m.userData.noShadow = true;
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of mats) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const motes = kit.particles(ctx, { count: 260, color: [0xffffff, 0x80c8ff], size: [0.1, 0.02], life: [2, 3.5], speed: [0.05, 0.3], drag: 0.5 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 12 });

  function release(i) { const s = fs[i]; if (s.f && !s.f.actor.removed && Math.abs(s.f.actor.speed - s.ap) < 1e-6) s.f.actor.speed = s.s0; s.f = null; }
  function releaseB(i) { const s = bs[i]; if (s.b && !s.b.removed) { if (s.b.gravity === s.ga) s.b.gravity = s.g0; if (s.b.drag === s.da) s.b.drag = s.d0; } s.b = null; }
  function restoreAll() { for (let i = 0; i < fs.length; i++) release(i); for (let i = 0; i < bs.length; i++) releaseB(i); }
  const inside = (x, y, z, pad) => { const dx = x - B.p.x, dy = y - B.p.y, dz = z - B.p.z; return dx * dx + dy * dy + dz * dz < (B.r + pad) * (B.r + pad); };

  function cast({ origin, direction }) {
    const k = mr(), aim = ctx.aimPoint(ctx.input.passthrough ? 3 : 40);
    restoreAll();
    if (aim) B.p.copy(aim); else B.p.copy(origin).addScaledVector(direction, 7 * k);
    B.r = 5 * k; B.p.y += B.r * 0.55; B.on = true; B.t = 0; B.pop = -1; B.tick = 0; bubble.visible = true; pop.visible = false;
    motes.emit(B.p, 30, undefined, 2);
    if (!sfx('gravity-rumble', B.p)) snd.chord([196, 294, 392], { dur: 1.6, vol: 0.14, type: 'sine', stagger: 0.12, at: B.p });
    kit.flash(ctx, B.p, { color: COLOR, intensity: 30, distance: 14, duration: 0.4 });
    kit.haptic?.('right', 0.5, 80);
  }
  function end() {
    B.on = false; bubble.visible = false; restoreAll(); glow.intensity = 0;
    B.pop = 0; pop.visible = true; pop.position.copy(B.p); motes.emit(B.p, 40, undefined, 3);
    if (!sfx('teleport', B.p)) snd.tone({ freq: 1800, freqEnd: 300, dur: 0.3, type: 'triangle', vol: 0.2, at: B.p });
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'time-bubble', name: 'Time Bubble', color: COLOR, icon: '⏳', rate: 1.5, description: 'A sphere where time crawls for everything but you.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); restoreAll(); });

  return {
    update(dt, t) {
      blendFix();
      if (B.pop >= 0) { B.pop += dt; const u = B.pop / 0.5; if (u >= 1) { B.pop = -1; pop.visible = false; } else { pop.scale.setScalar(B.r * (1 + u * 0.4)); popM.opacity = 0.5 * (1 - u); } }
      if (!B.on) return;
      B.t += dt;
      const e = Math.min(1, B.t / 0.5), life = Math.min(1, (LIFE - B.t) / 1);
      bubble.position.copy(B.p); bubble.scale.setScalar(B.r * (1 - Math.pow(1 - e, 3)) * (0.97 + 0.03 * Math.sin(t * 1.5)));
      clock.lookAt(ctx.player.head.x, B.p.y, ctx.player.head.z); clock.rotateX(Math.PI / 2); hand.rotation.y = -B.t * 0.9; hand2.rotation.y = -B.t * 0.075;
      shellM.opacity = 0.1 * life; innerM.opacity = 0.12 * life; ringM.opacity = 0.5 * life; handM.opacity = 0.8 * life;
      glow.position.copy(B.p); glow.intensity = 6 * life;
      B.tick -= dt; if (B.tick <= 0) { B.tick = 1.1; snd.tone({ freq: 1500, dur: 0.05, type: 'square', vol: 0.04, at: B.p }); }
      if (Math.random() < dt * 14) { tmp.set(B.p.x + (Math.random() - 0.5) * B.r * 1.6, B.p.y + (Math.random() - 0.5) * B.r * 1.4, B.p.z + (Math.random() - 0.5) * B.r * 1.6); motes.emit(tmp, 1); }
      // fighters: slow movement + attack timers + the attack animation
      const FG = ctx.world.combat?.fighters, d1 = dt * (1 - K);
      for (let i = 0; i < fs.length; i++) { const s = fs[i]; if (s.f && (!s.f.alive || s.f.actor.removed || !inside(s.f.actor.position.x, s.f.actor.position.y + 1, s.f.actor.position.z, 0.5))) release(i); }
      if (FG) for (let j = 0; j < FG.length; j++) {
        const f = FG[j], a = f.actor;
        if (!f.alive || !a || !inside(a.position.x, a.position.y + 1, a.position.z, 0)) continue;
        let s = null;
        for (let i = 0; i < fs.length; i++) { if (fs[i].f === f) { s = fs[i]; break; } if (!s && !fs[i].f) s = fs[i]; }
        if (!s) continue;
        if (s.f !== f || Math.abs(a.speed - s.ap) > 1e-6) { s.f = f; s.s0 = a.speed; s.ap = a.speed * K; } // (a behaviour that changed its speed, e.g. a charge, is re-slowed)
        a.speed = s.ap;
        f.atkCd += d1; f.thinkT += d1; f.windT += d1; f.recT += d1;
        if (a.atkT > 0) a.atkT = Math.max(0, a.atkT - d1);
      }
      // projectiles hang: undo most of this frame's travel
      const PR = ctx.world.combat?.projectiles;
      if (PR) for (let i = 0; i < PR.length; i++) { const p = PR[i]; if (p.on && inside(p.x, p.y, p.z, 0)) { p.x -= p.vx * d1; p.y -= p.vy * d1; p.z -= p.vz * d1; } }
      // loose bodies: thin gravity and thick air while inside
      const BD = ctx.world.spells?.bodies?.();
      for (let i = 0; i < bs.length; i++) { const s = bs[i]; if (s.b && (s.b.removed || !inside(s.b.position.x, s.b.position.y, s.b.position.z, 0.5))) releaseB(i); }
      if (BD) for (let j = 0; j < BD.length; j++) {
        const b = BD[j];
        if (b.removed || b.held || b.invMass === 0 || !inside(b.position.x, b.position.y, b.position.z, 0)) continue;
        let s = null;
        for (let i = 0; i < bs.length; i++) { if (bs[i].b === b) { s = bs[i]; break; } if (!s && !bs[i].b) s = bs[i]; }
        if (!s) continue;
        if (s.b !== b) { s.b = b; s.g0 = b.gravity; s.d0 = b.drag; s.ga = b.gravity * K * K; s.da = Math.max(b.drag, 3); b.gravity = s.ga; b.drag = s.da; }
        b.velocity.multiplyScalar(Math.exp(-2 * dt));
      }
      if (B.t >= LIFE) end();
    },
  };
}
