// Spell: Telekinesis (HOLD the trigger). Point at a physics object (an orb, a dropped weapon, a crate...) and hold: it is lifted
// by an invisible hand and follows where you point. Right stick up/down pulls it closer / pushes it away. LET GO TO FLING it with
// the speed of your hand. Needs world.spells.bodies() (kit has no public list of bodies). With physics the object stays a REAL dynamic body
// steered by velocity (b.ph): it collides with walls and shoves crates, gravity is off while held. Without it: the old kinematic hold.
export const meta = { name: 'Telekinesis', description: 'Spell (hold): lift an object at range, release to fling it.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xd36bff, REACH = 30;
  const tk = { b: null, phys: false, g: 9.8, dist: 5, vel: new THREE.Vector3(), prev: new THREE.Vector3(), aim: new THREE.Vector3(), buzz: 0, snd: 0 };
  const rel = new THREE.Vector3(), tmp = new THREE.Vector3();
  const beam = kit.particles(ctx, { count: 360, color: [0xffffff, 0xd36bff], size: [0.1, 0.02], life: [0.2, 0.5], speed: [0.05, 0.4], drag: 1 });
  const aura = kit.particles(ctx, { count: 160, color: [0xf0d8ff, 0xa040ff], size: [0.12, 0.02], life: [0.3, 0.7], speed: [0.2, 1], gravity: -0.5 });
  const snd = kit.sound(ctx);
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 8 });

  function pick(origin, dir) {
    const B = ctx.world.spells?.bodies?.() ?? [];
    let best = null, bd = Infinity;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.removed || b.held || b.invMass === 0) continue;
      rel.subVectors(b.position, origin);
      const along = rel.dot(dir);
      if (along < 0.3 || along > REACH) continue;
      const perp = rel.lengthSq() - along * along, reach = b.radius + 0.45 + along * 0.04;
      if (perp < reach * reach && perp < bd) { bd = perp; best = b; }
    }
    return best;
  }
  function cast({ origin, direction, dt, first }) {
    if (first) {
      tk.b = pick(origin, direction);
      if (!tk.b) { beam.emit(tmp.copy(origin).addScaledVector(direction, 1.5), 10, direction); snd.tone({ freq: 300, freqEnd: 150, dur: 0.15, type: 'triangle', vol: 0.1, at: origin }); return; }
      const b = tk.b;
      tk.dist = Math.max(1.6, Math.min(14, rel.subVectors(b.position, origin).dot(direction)));
      tk.phys = !!(b.ph && !b.ph.removed && ctx.world.physics?.ready);
      if (tk.phys) { tk.g = b.gravity; b.gravity = 0; b.velocity.set(0, 0, 0); b.ph.wake(); } else b.held = 'tk'; // physical: steered by velocity below
      b.velocity.set(0, 0, 0); tk.vel.set(0, 0, 0); tk.prev.copy(b.position);
      snd.chord([330, 440, 554], { dur: 0.6, vol: 0.12, type: 'triangle', stagger: 0.05, at: b.position });
      kit.haptic?.('right', 0.5, 60);
    }
    const b = tk.b;
    if (!b) return;
    if (b.removed) { tk.b = null; return; }
    tk.dist = Math.max(1.2, Math.min(18, tk.dist - ctx.input.right.stick.y * 5 * dt));
    tk.aim.copy(origin).addScaledVector(direction, tk.dist);
    const gy = ctx.groundAt(tk.aim.x, tk.aim.z) + b.radius;
    if (tk.aim.y < gy) tk.aim.y = gy;
    tk.prev.copy(b.position);
    if (tk.phys && b.ph && !b.ph.removed) { // spring toward the aim point by velocity: walls stop it, crates get shoved, it spins gently
      rel.subVectors(tk.aim, b.position).multiplyScalar(14);
      const s = rel.length(); if (s > 30) rel.multiplyScalar(30 / s);
      b.velocity.copy(rel); b.ph.setAngularVelocity(0.6, 1.5, 0.3); b.ph.wake();
    } else {
      b.position.lerp(tk.aim, 1 - Math.exp(-14 * dt));
      b.mesh.position.copy(b.position);
      b.mesh.rotation.y += dt * 1.5; b.mesh.rotation.x += dt * 0.7;
    }
    const k = 1 - Math.exp(-14 * dt); // smoothed velocity for the fling
    if (tk.phys && b.ph && !b.ph.removed) { const pv = b.ph.velocity; tk.vel.x += (pv.x - tk.vel.x) * k; tk.vel.y += (pv.y - tk.vel.y) * k; tk.vel.z += (pv.z - tk.vel.z) * k; } // the body's real speed
    else { tk.vel.x += ((b.position.x - tk.prev.x) / dt - tk.vel.x) * k; tk.vel.y += ((b.position.y - tk.prev.y) / dt - tk.vel.y) * k; tk.vel.z += ((b.position.z - tk.prev.z) / dt - tk.vel.z) * k; }
    for (let i = 0; i < 3; i++) beam.emit(tmp.lerpVectors(origin, b.position, Math.random()), 1);
    aura.emit(b.position, 2, undefined, 0.6);
    glow.position.copy(b.position); glow.intensity = 8;
    tk.buzz -= dt;
    if (tk.buzz <= 0) { tk.buzz = 0.12; kit.haptic?.('right', 0.12, 25); }
  }
  function onRelease() {
    glow.intensity = 0;
    const b = tk.b; tk.b = null;
    if (!b || b.removed) return;
    if (tk.phys) { b.gravity = tk.g ?? 9.8; if (b.ph && !b.ph.removed) b.ph.setAngularVelocity(2, 3, 1); } else b.held = null;
    tk.phys = false;
    b.velocity.copy(tk.vel).multiplyScalar(1.35);
    const s = b.velocity.length();
    if (s > 26) b.velocity.multiplyScalar(26 / s);
    aura.emit(b.position, 12, b.velocity, 0.3);
    snd.noise({ dur: 0.3, filter: { type: 'bandpass', freq: 600, freqEnd: 2200, q: 1 }, vol: 0.25 + Math.min(0.3, s * 0.02), at: b.position });
    snd.tone({ freq: 500, freqEnd: 150, dur: 0.25, type: 'sawtooth', vol: 0.08, at: b.position });
    kit.haptic?.('right', 0.6, 50);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'telekinesis', name: 'Telekinesis', color: COLOR, icon: '🧲', hold: true, description: 'Hold on an object to lift it. Release to fling.', cast, onRelease }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); if (tk.b && !tk.b.removed) { if (tk.phys) tk.b.gravity = tk.g ?? 9.8; else tk.b.held = null; tk.b = null; } });

  return {
    update() {
      if (tk.b && tk.b.removed) { tk.b = null; glow.intensity = 0; }
    },
  };
}
