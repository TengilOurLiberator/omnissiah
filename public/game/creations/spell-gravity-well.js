// Spell: Gravity Well. A singularity blooms where you point and drags nearby physics bodies and enemies toward it for a few
// seconds, grinding them, then collapses in a violent burst. One well at a time.
export const meta = { name: 'Gravity Well', description: 'Spell: a singularity that pulls things in, then bursts.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x9b5cff, LIFE = 3.4, PULL = 11, BURST = 6.5, FROM = { from: 'player', kind: 'explosion', force: 20 };
  const well = { on: false, t: 0, tick: 0, hum: 0, p: new THREE.Vector3() };
  const tmp = new THREE.Vector3(), tv = new THREE.Vector3();

  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  const rimM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 40).rotateX(-Math.PI / 2), rimM);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.35, 14, 10), new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide }));
  const shock = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xd9b8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  core.add(halo);
  for (const m of [core, disc, shock]) { m.visible = false; ctx.root.add(m); }
  let shockT = -1;
  const swirl = kit.particles(ctx, { count: 400, color: [0xe6d0ff, 0x6a2cff], size: [0.16, 0.02], life: [0.5, 0.9], speed: 0, drag: 0.2 });
  const burst = kit.particles(ctx, { count: 220, color: [0xffffff, 0x9b5cff], size: [0.18, 0.03], life: [0.4, 1.1], speed: [4, 12], gravity: 2, drag: 0.6 });
  const snd = kit.sound(ctx);
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 14 });

  function cast({ origin, direction }) {
    if (well.on) return;
    const aim = ctx.aimPoint(60);
    if (aim) well.p.copy(aim); else { well.p.copy(origin).addScaledVector(direction, 14); well.p.y = Math.max(well.p.y, ctx.groundAt(well.p.x, well.p.z)); }
    well.p.y += 1.7;
    well.on = true; well.t = 0; well.tick = 0; well.hum = 0;
    core.visible = disc.visible = true; core.position.copy(well.p); disc.position.copy(well.p);
    burst.emit(well.p, 24, undefined, 0.5);
    snd.tone({ freq: 90, freqEnd: 400, dur: 0.5, type: 'sawtooth', vol: 0.1, at: well.p }); snd.chord([196, 233, 294], { dur: 1.2, vol: 0.14, type: 'triangle', at: well.p });
    kit.haptic?.('right', 0.5, 70);
  }
  function collapse() {
    well.on = false; core.visible = disc.visible = false;
    const p = well.p;
    kit.explosion(ctx, p, { color: COLOR, size: 4.2 });
    kit.hit(p, BURST, 45, FROM);
    burst.emit(p, 80);
    const P = ctx.world.physics;
    if (P && P.ready) P.explode(p, BURST * 1.5, 24, { lift: 0.5 }); // every Rapier body, debris chunk and ragdoll that was orbiting gets flung
    const B = ctx.world.spells?.bodies?.() ?? [];
    for (let i = 0; i < B.length; i++) { // outward blast for kit bodies on the classic simulation
      const b = B[i];
      if (b.removed || b.held || b.invMass === 0 || (b.ph && P && P.ready)) continue;
      tmp.subVectors(b.position, p);
      const d = tmp.length();
      if (d < BURST * 1.5) b.velocity.addScaledVector(tmp.normalize(), 16 * (1 - d / (BURST * 1.5)) + 4);
    }
    shockT = 0; shock.visible = true; shock.position.copy(p);
    kit.flash(ctx, p, { color: 0xd9b8ff, intensity: 90, distance: 24, duration: 0.45 });
    snd.tone({ freq: 160, freqEnd: 22, dur: 1.1, vol: 0.9, at: p }); snd.noise({ dur: 0.9, filter: { type: 'lowpass', freq: 2000, freqEnd: 80, q: 0.8 }, vol: 0.9, at: p });
    kit.haptic?.('left', 0.8, 120); kit.haptic?.('right', 0.8, 120);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'gravity-well', name: 'Gravity Well', color: COLOR, icon: '🌀', rate: 0.8, description: 'A singularity pulls everything in, then bursts.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      if (shockT >= 0) {
        shockT += dt;
        const u = shockT / 0.5;
        if (u >= 1) { shockT = -1; shock.visible = false; } else { shock.scale.setScalar(0.5 + u * BURST * 1.6); shock.material.opacity = 0.5 * (1 - u); }
      }
      if (!well.on) { glow.intensity = 0; return; }
      well.t += dt;
      const u = well.t / LIFE, p = well.p;
      core.scale.setScalar(0.22 + 0.2 * u + Math.sin(t * 30) * 0.015); disc.scale.setScalar(1.4 + 0.5 * u); disc.rotation.y += dt * 5;
      glow.position.copy(p); glow.intensity = 10 + 30 * u;
      for (let k = 0; k < 4; k++) { // accretion swirl: ring of motes spiralling inward
        const a = Math.random() * 6.283, r = 2.6 + Math.random() * 1.6;
        tmp.set(p.x + Math.cos(a) * r, p.y + (Math.random() - 0.5) * 0.8, p.z + Math.sin(a) * r);
        tv.set(-Math.cos(a) * 3.5 - Math.sin(a) * 4.5, -0.3, -Math.sin(a) * 3.5 + Math.cos(a) * 4.5);
        swirl.emit(tmp, 1, tv);
      }
      const P = ctx.world.physics, phys = !!(P && P.ready);
      // physics: one inward radial impulse on every dynamic body / ragdoll part / debris chunk in range (negative explode = pull)
      if (phys) P.explode(p, 11, -PULL * (0.6 + u) * dt * 3.5, { lift: -0.7 }); // (a little upward too: lifts resting things off the ground so they can fall in)
      const B = ctx.world.spells?.bodies?.() ?? [];
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        if (b.removed || b.held || b.invMass === 0 || (b.ph && phys)) continue;
        tmp.subVectors(p, b.position);
        const d = tmp.length();
        if (d > 11 || d < 0.01) continue;
        const a = PULL * (1 - d / 11) * (0.6 + u);
        tmp.multiplyScalar(1 / d);
        b.velocity.addScaledVector(tmp, a * dt);
        b.velocity.x += -tmp.z * 2 * dt; b.velocity.z += tmp.x * 2 * dt; // a little swirl
        if (d < 2.5) b.velocity.multiplyScalar(Math.exp(-1.5 * dt));
      }
      const F = ctx.world.combat?.fighters;
      if (F) for (let i = 0; i < F.length; i++) { // drag enemies in: slide the actor toward the well (the well holds them near the middle)
        const a = F[i].actor;
        if (!a || F[i].faction === 'friendly') continue;
        const dx = p.x - a.position.x, dz = p.z - a.position.z, d = Math.hypot(dx, dz);
        if (d > 11 || d < 0.9) continue;
        const s = (2 + 5 * (1 - d / 11)) * dt;
        a.position.x += (dx / d) * s; a.position.z += (dz / d) * s;
      }
      well.tick -= dt;
      if (well.tick <= 0) { well.tick = 0.4; kit.hit(p, 3.6, 3.5, { from: 'player', kind: 'magic', force: 0 }); }
      well.hum -= dt;
      if (well.hum <= 0) { well.hum = 0.45; snd.tone({ freq: 55 + 90 * u, freqEnd: 50 + 100 * u, dur: 0.5, type: 'sawtooth', vol: 0.06, at: p }); snd.noise({ dur: 0.45, filter: { type: 'bandpass', freq: 300 + 700 * u, q: 2 }, vol: 0.12, at: p }); }
      if (well.t >= LIFE) collapse();
    },
  };
}
