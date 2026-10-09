// Spell: Force Push. A cone of pressure shoves physics bodies and fighters away from you and bruises what it hits.
// With a bare tracked hand, thrust an open palm forward (while this spell is selected) to cast along the palm normal.
export const meta = { name: 'Force Push', description: 'Spell: a shockwave cone that shoves bodies and fighters.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x9ad0ff, RANGE = 11, COS = 0.79, FROM = { from: 'player', kind: 'blunt', force: 9, direction: undefined };
  const Z = new THREE.Vector3(0, 0, 1), tmp = new THREE.Vector3(), rel = new THREE.Vector3(), pn = new THREE.Vector3(), po = new THREE.Vector3();
  const ringG = new THREE.RingGeometry(0.82, 1, 36);
  const rings = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.visible = false; ctx.root.add(m);
    rings.push({ m, t: -1, delay: 0, o: new THREE.Vector3(), d: new THREE.Vector3() });
  }
  const wind = kit.particles(ctx, { count: 300, color: [0xffffff, 0x7fb8ff], size: [0.22, 0.04], life: [0.25, 0.5], speed: [0.5, 2.5], drag: 2.2 });
  const dust = kit.particles(ctx, { count: 120, additive: false, color: [0x9a8a70, 0x6a5a48], alpha: 0.4, size: [0.3, 0.9], life: [0.5, 1.1], speed: [1, 3], gravity: -0.3, drag: 2 });
  const snd = kit.sound(ctx);
  const palm = { prev: new THREE.Vector3(), has: false, cool: 0 };

  function cast({ origin, direction }) {
    const o = rings.length;
    for (let k = 0, n = 0; k < o && n < 4; k++) { // four staggered shock rings travelling down the cone
      const r = rings[k];
      if (r.t >= 0) continue;
      r.t = 0; r.delay = n * 0.06; r.o.copy(origin); r.d.copy(direction); r.m.quaternion.setFromUnitVectors(Z, direction); n++;
    }
    wind.emit(origin, 36, tmp.copy(direction).multiplyScalar(14), 1.2);
    // bodies in the cone
    const B = ctx.world.spells?.bodies?.() ?? [];
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.removed || b.held || b.invMass === 0) continue;
      rel.subVectors(b.position, origin);
      const d = rel.length();
      if (d > RANGE || d < 0.01 || rel.dot(direction) / d < COS) continue;
      const k = (24 * (1 - d / RANGE) + 7) / Math.max(0.5, b.mass);
      b.velocity.addScaledVector(direction, k); b.velocity.y += 2.5;
    }
    // fighters in the cone get knocked back. With physics, kit.hit({ force >= 6 }) below throws a standing actor and stuns it, and shoves
    // ragdolls and debris too; without it kit actors carry a knock-back velocity (kx, kz).
    const phys = !!ctx.world.physics?.ready;
    const F = phys ? null : ctx.world.combat?.fighters;
    if (F) for (let i = 0; i < F.length; i++) {
      const a = F[i].actor;
      if (!a || F[i].faction === 'friendly') continue;
      rel.set(a.position.x - origin.x, a.position.y + 0.8 - origin.y, a.position.z - origin.z);
      const d = rel.length();
      if (d > RANGE || d < 0.01 || rel.dot(direction) / d < COS) continue;
      const k = 28 * (1 - d / RANGE) + 10, h = Math.hypot(direction.x, direction.z) || 1;
      a.kx += (direction.x / h) * k; a.kz += (direction.z / h) * k;
    }
    FROM.direction = direction;
    for (const [d, r, dmg, f] of [[2.2, 2.2, 6, 10], [5, 3.2, 6, 9], [8.5, 4.2, 5, 8]]) { FROM.force = phys ? f : undefined; kit.hit(tmp.copy(origin).addScaledVector(direction, d), r, dmg, FROM); }
    FROM.direction = undefined;
    dust.emit(tmp.copy(origin).addScaledVector(direction, 2), 8, direction);
    snd.noise({ dur: 0.5, filter: { type: 'lowpass', freq: 1200, freqEnd: 120, q: 0.8 }, vol: 0.7, at: origin });
    snd.noise({ dur: 0.35, filter: { type: 'highpass', freq: 1500, freqEnd: 5000, q: 0.7 }, vol: 0.25, at: origin });
    snd.tone({ freq: 110, freqEnd: 36, dur: 0.45, vol: 0.6, at: origin });
    kit.flash(ctx, tmp.copy(origin).addScaledVector(direction, 1), { color: COLOR, intensity: 25, distance: 9, duration: 0.18 });
    kit.haptic?.('right', 0.9, 80);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'force-push', name: 'Force Push', color: COLOR, icon: '💨', rate: 0.6, description: 'A shockwave cone. Tracked hand: thrust an open palm.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt) {
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        if (r.t < 0) continue;
        r.t += dt;
        const u = (r.t - r.delay) / 0.45;
        if (u < 0) continue;
        if (u >= 1) { r.t = -1; r.m.visible = false; continue; }
        const e = 1 - (1 - u) * (1 - u), dist = 0.4 + e * 9;
        r.m.visible = true; r.m.position.copy(r.o).addScaledVector(r.d, dist);
        r.m.scale.setScalar(0.15 + dist * 0.42); r.m.material.opacity = 0.75 * (1 - u);
      }
      // bare hand: a quick open-palm thrust casts
      const R = ctx.input.right, F = R.fingers;
      palm.cool -= dt;
      if (R.tracked && R.connected && F.gesture === 'open' && ctx.world.spells?.current()?.id === 'force-push' && !ctx.world.weapons?.held?.right && !ctx.world.menu?.capturing) {
        if (palm.has && dt > 0) {
          const v = tmp.subVectors(F.palm, palm.prev).multiplyScalar(1 / dt).dot(F.palmNormal);
          if (v > 2.2 && palm.cool <= 0) { palm.cool = 0.6; pn.copy(F.palmNormal); po.copy(F.palm).addScaledVector(pn, 0.1); cast({ origin: po, direction: pn }); }
        }
        palm.prev.copy(F.palm); palm.has = true;
      } else palm.has = false;
    },
  };
}
