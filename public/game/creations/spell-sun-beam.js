// Spell: Sun Beam (HOLD to charge, RELEASE to call it down). A gold ring swells on the ground where you point and the sky
// brightens while you hold; let go and the Omnissiah drops a column of sunlight there. The beam burns what stands in it and
// follows where your hand points (5 m/s) until it ends in a flash. Charge longer = wider, hotter, longer. Tracked hands: raise an
// open palm toward the sky to charge, lower it or make a fist to release.
export const meta = { name: 'Sun Beam', description: 'Spell (hold + release): call a column of sunlight down from the Omnissiah.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // (Math.hypot allocates in hot loops)
  const COLOR = 0xffd34a, MAXC = 2.2, MINC = 0.55, FIRE = { from: 'player', kind: 'fire', force: 0 }, BLAST = { from: 'player', kind: 'explosion', force: 12 };
  const S = { mode: 0, c: 0, hold: 0, beam: 0, dur: 1, pw: 0, tick: 0, ready: false, gest: false, p: new THREE.Vector3(), o: new THREE.Vector3() };
  const tmp = new THREE.Vector3(), tv = new THREE.Vector3();
  const mr = () => (ctx.input.passthrough ? 0.35 : 1);

  const cylG = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0), ringG = new THREE.RingGeometry(0.7, 1, 48).rotateX(-Math.PI / 2);
  const mk = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const mats = [mk(0xfff4c0, 0), mk(0xffb830, 0), mk(COLOR, 0), mk(0xfff0a0, 0), mk(0xffffff, 0)];
  const [colM, shellM, ringM, ring2M, orbM] = mats;
  const column = new THREE.Mesh(cylG, colM), shell = new THREE.Mesh(cylG, shellM), ring = new THREE.Mesh(ringG, ringM), ring2 = new THREE.Mesh(ringG, ring2M);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), orbM);
  for (const m of [column, shell, ring, ring2, orb]) { m.visible = false; m.userData.noShadow = true; m.frustumCulled = false; ctx.root.add(m); }
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of mats) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const motes = kit.particles(ctx, { count: 420, color: [0xffffff, 0xffc030], size: [0.18, 0.03], life: [0.5, 1.2], speed: [0.2, 1.2], gravity: -2.5, drag: 0.6, spread: 0.5 });
  const sparks = kit.particles(ctx, { count: 200, color: [0xfff0b0, 0xff6a10], size: [0.14, 0.02], life: [0.4, 1], speed: [2, 7], gravity: 8, drag: 0.4 });
  const snd = kit.sound(ctx);
  const sfx = (n, at) => ctx.world.audio?.sfx(n, { at });
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 18 });

  function setTarget(origin, dir) { // where the ring sits: the ground the hand points at (never beyond reach)
    const A = ctx.world.player?.aim, lim = ctx.input.passthrough ? 3.2 : 70;
    if (A && A.valid) S.p.copy(A.point); else { S.p.copy(origin).addScaledVector(dir, 14 * mr()); S.p.y = ctx.groundAt(S.p.x, S.p.z); }
    const h = ctx.player.head, dx = S.p.x - h.x, dz = S.p.z - h.z, d = hyp(dx, dz);
    if (d > lim) { S.p.x = h.x + dx / d * lim; S.p.z = h.z + dz / d * lim; S.p.y = ctx.groundAt(S.p.x, S.p.z); }
  }
  function begin() {
    S.mode = 1; S.c = 0; S.ready = false;
    ctx.world.oracle?.flare?.(COLOR, 0.7);
    if (!sfx('shield-hum', S.p)) snd.chord([262, 392, 523], { dur: 1.5, vol: 0.12, type: 'sine', stagger: 0.2 });
  }
  function charge(dt) {
    S.c = Math.min(MAXC, S.c + dt);
    if (!S.ready && S.c >= 1.4) { S.ready = true; ctx.world.oracle?.flare?.(0xffffff, 0.5); snd.tone({ freq: 1568, dur: 0.3, vol: 0.1, at: S.p }); kit.haptic?.('right', 0.6, 60); }
  }
  function fire() {
    if (S.mode !== 1) return;
    if (S.c < MINC) { S.mode = 0; snd.tone({ freq: 300, freqEnd: 120, dur: 0.2, type: 'triangle', vol: 0.12 }); return; }
    const c = S.c / MAXC;
    S.mode = 2; S.pw = c; S.dur = 1.2 + 1.6 * c; S.beam = S.dur; S.tick = 0;
    ctx.world.oracle?.beamTo?.(S.p, { color: 0xffe9a0, duration: S.dur });
    ctx.world.oracle?.flare?.(0xfff0b0, 1);
    kit.flash(ctx, tmp.set(S.p.x, S.p.y + 3, S.p.z), { color: 0xfff0c0, intensity: 80, distance: 26, duration: 0.5 });
    sparks.emit(S.p, 40);
    if (!sfx('thunder-crack', S.p)) snd.tone({ freq: 90, freqEnd: 30, dur: 0.9, vol: 0.8, at: S.p });
    kit.haptic?.('left', 0.7, 120); kit.haptic?.('right', 0.9, 120);
  }
  function cast({ origin, direction, dt, first }) {
    if (S.mode === 2) return;
    S.hold = 0.12; S.o.copy(origin);
    setTarget(origin, direction);
    if (first || S.mode === 0) begin();
    charge(dt);
  }
  function onRelease() { S.hold = 0; if (!S.gest) fire(); }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'sun-beam', name: 'Sun Beam', color: COLOR, icon: '☀️', hold: true, description: 'Hold to charge, release: a column of sunlight.', cast, onRelease }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      const R = ctx.input.right, F = R.fingers, k = mr();
      if (R.tracked && R.connected && ctx.world.spells?.current()?.id === 'sun-beam' && !ctx.world.weapons?.held?.right) { // raise an open palm to the sky
        const up = F.gesture === 'open' && F.palmNormal.y > 0.7 && F.palm.y > ctx.player.head.y - 0.25;
        if (up && S.mode !== 2) { S.gest = true; S.hold = 0.12; if (S.mode === 0) { tv.copy(R.direction); setTarget(F.palm, tv); begin(); S.o.copy(F.palm); } else setTarget(F.palm, R.direction); charge(dt); }
        else if (S.gest) { S.gest = false; fire(); }
      }
      if (S.mode === 1) {
        if (S.hold <= 0) fire(); else S.hold -= dt;
      }
      const vis1 = S.mode === 1, c = Math.min(1, S.c / MAXC);
      ring.visible = ring2.visible = vis1 || S.mode === 2; orb.visible = vis1;
      if (vis1) {
        const r = (1.3 + 2.4 * c) * k;
        ring.position.copy(S.p).y += 0.3; ring.scale.setScalar(r); ringM.opacity = 0.5 + 0.4 * c + 0.1 * Math.sin(t * 20);
        column.visible = true; column.position.copy(S.p); column.scale.set(r * 0.1, 30, r * 0.1); colM.opacity = 0.08 + 0.4 * c; // a thin shaft of light grows as you charge
        ring2.position.copy(ring.position); ring2.scale.setScalar(r * (1 - 0.85 * c)); ring2.rotation.y = t * 2; ring2M.opacity = 0.5;
        orb.position.copy(S.o); orb.scale.setScalar((0.02 + 0.05 * c) * (1 + 0.15 * Math.sin(t * 25))); orbM.opacity = 0.9;
        glow.position.set(S.p.x, S.p.y + 3, S.p.z); glow.intensity = 3 + 22 * c;
        if (Math.random() < dt * (10 + 40 * c)) { tmp.set(S.p.x + (Math.random() - 0.5) * r * 1.6, S.p.y + 0.1, S.p.z + (Math.random() - 0.5) * r * 1.6); motes.emit(tmp, 1); }
      } else if (S.mode === 2) {
        S.beam -= dt;
        const e = Math.min(1, (S.dur - S.beam) / 0.18) * Math.min(1, S.beam / 0.3), r = (1.0 + 2.2 * S.pw) * k * (0.9 + 0.1 * Math.sin(t * 40));
        const A = ctx.world.player?.aim; // the beam drifts toward where the hand points
        if (A && A.valid) { tmp.subVectors(A.point, S.p); const d = tmp.length(); if (d > 0.05) { S.p.addScaledVector(tmp, Math.min(1, 5 * k * dt / d)); S.p.y = ctx.groundAt(S.p.x, S.p.z); } }
        column.visible = shell.visible = true;
        column.position.copy(S.p); column.scale.set(r * 0.3, 90, r * 0.3); colM.opacity = 0.6 * e;
        shell.position.copy(S.p); shell.scale.set(r * 0.8, 90, r * 0.8); shellM.opacity = 0.25 * e;
        ring.position.copy(S.p).y += 0.3; ring.scale.setScalar(r * 1.3); ringM.opacity = 0.7 * e; ring2.position.copy(ring.position); ring2.scale.setScalar(r * (1.6 + 0.4 * Math.sin(t * 9))); ring2M.opacity = 0.3 * e;
        glow.position.set(S.p.x, S.p.y + 2, S.p.z); glow.intensity = 30 * e;
        if (Math.random() < dt * 60) { tmp.set(S.p.x + (Math.random() - 0.5) * r, S.p.y + 0.2, S.p.z + (Math.random() - 0.5) * r); motes.emit(tmp, 1, tv.set(0, 5, 0)); }
        if (Math.random() < dt * 14) sparks.emit(tmp.set(S.p.x, S.p.y + 0.2, S.p.z), 1);
        S.tick -= dt;
        if (S.tick <= 0) { S.tick = 0.2; kit.hit(tmp.set(S.p.x, S.p.y + 0.6, S.p.z), r * 1.1, 5 + 8 * S.pw, FIRE); kit.scorch(S.p, r * 0.8); }
        if (S.beam <= 0) {
          S.mode = 0; column.visible = shell.visible = ring.visible = ring2.visible = false; glow.intensity = 0;
          kit.explosion(ctx, S.p, { color: 0xffd070, size: 1.8 + 2 * S.pw });
          kit.hit(tmp.set(S.p.x, S.p.y + 0.5, S.p.z), r * 1.6 + 1, 20 + 25 * S.pw, BLAST);
          ctx.world.physics?.explode?.(S.p, r * 2.2, 10, { lift: 0.5 });
          snd.noise({ dur: 0.8, filter: { type: 'lowpass', freq: 1500, freqEnd: 80, q: 0.8 }, vol: 0.7, at: S.p });
        }
      } else { glow.intensity = 0; column.visible = shell.visible = false; }
    },
  };
}
