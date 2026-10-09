// Spell: Earth Wall. A row of stone slabs erupts from the ground where you point, launching whatever stood there, and
// stands for 20 s as a solid barrier: physics bodies bounce off it and the slabs soak up hits (they are damageables on the
// friendly side). Then it sinks back. Two walls at most.
export const meta = { name: 'Earth Wall', description: 'Spell: raise a stone wall that blocks for 20 seconds.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xa89880, SEGS = 7, GAP = 1.05, LIFE = 20, FROM = { from: 'player', kind: 'blunt' }, FORCE = { from: 'player', kind: 'blunt', force: 9 };
  const walls = [];
  const tmp = new THREE.Vector3();

  const boxG = new THREE.BoxGeometry(1, 1, 1);
  const stoneM = new THREE.MeshLambertMaterial({ color: 0x77706a, flatShading: true }), moss = new THREE.MeshLambertMaterial({ color: 0x59664a, flatShading: true });
  const dust = kit.particles(ctx, { count: 260, additive: false, color: [0xa89880, 0x6a5e50], alpha: 0.6, size: [0.4, 1.3], life: [0.6, 1.4], speed: [0.8, 2.6], gravity: -0.2, drag: 1.2 });
  const chips = kit.particles(ctx, { count: 160, additive: false, color: [0x8a8076, 0x4a443e], size: [0.1, 0.06], life: [0.6, 1.3], speed: [2, 6], gravity: 12, drag: 0.3 });
  const snd = kit.sound(ctx);

  function slab(wall, p, yaw, h) {
    const g = new THREE.Group(), sm = stoneM.clone(), mm = moss.clone(); // own materials: hit-flash must not light up every slab
    const m = new THREE.Mesh(boxG, sm); m.scale.set(1.12, h, 0.65); m.position.y = h / 2; g.add(m);
    for (let k = 0; k < 2; k++) { const c = new THREE.Mesh(boxG, k ? mm : sm); c.scale.set(0.5 + Math.random() * 0.3, 0.35 + Math.random() * 0.3, 0.5); c.position.set((Math.random() - 0.5) * 0.7, h + 0.05, (Math.random() - 0.5) * 0.2); c.rotation.set(Math.random() * 0.5, Math.random() * 3, Math.random() * 0.5); g.add(c); }
    g.rotation.y = yaw; g.position.set(p.x, p.y - h - 0.2, p.z); ctx.root.add(g);
    const s = { g, h, y0: p.y, alive: true, bodies: [], d: null, mats: [sm, mm] };
    s.d = kit.damageable(ctx, g, {
      hp: 90, radius: 0.9, offsetY: 1.0, faction: 'friendly',
      onDeath(d) { chips.emit(tmp.set(p.x, p.y + 1, p.z), 24); dust.emit(tmp, 8); snd.noise({ dur: 0.5, filter: { type: 'lowpass', freq: 700, freqEnd: 100, q: 0.8 }, vol: 0.5, at: tmp }); s.alive = false; g.visible = false; d.remove(); for (const b of s.bodies) b.remove(); s.bodies.length = 0; s.ph?.remove(); s.ph = null; },
    });
    const P = ctx.world.physics;
    if (P && P.ready) { // a kinematic slab-shaped collider that rides the rising group: shoves bodies as it erupts, then blocks walkers, NPCs, bodies and ragdolls
      s.ph = P.body(ctx, g, { type: 'kinematic', shape: 'box', size: [1.12, h, 0.65], center: [0, h / 2, 0], group: 'world', friction: 0.8 });
    }
    if (!s.ph) for (const y of [0.6, 1.7]) s.bodies.push(kit.body(ctx, new THREE.Group(), { position: { x: p.x, y: p.y + y, z: p.z }, radius: 0.62, mass: 0 })); // classic: immovable spheres
    wall.slabs.push(s);
    kit.hit(tmp.set(p.x, p.y + 0.3, p.z), 1.6, 8, FORCE); // the eruption launches whatever stood there (force >= 6: actors fly too)
    dust.emit(tmp.set(p.x, p.y + 0.2, p.z), 10); chips.emit(tmp, 6, undefined, 0.8);
  }
  function remove(w) {
    for (const s of w.slabs) { if (s.alive) { s.d.remove(); for (const b of s.bodies) b.remove(); } s.ph?.remove(); s.ph = null; s.g.removeFromParent(); for (const m of s.mats) m.dispose(); }
    w.slabs.length = 0; walls.splice(walls.indexOf(w), 1);
  }
  function cast({ origin, direction }) {
    const aim = ctx.aimPoint(28);
    const c = aim ? tmp.copy(aim) : tmp.copy(origin).addScaledVector(direction, 8);
    if (!aim) c.y = ctx.groundAt(c.x, c.z);
    const cx = c.x, cz = c.z, h = Math.hypot(direction.x, direction.z) || 1, fx = direction.x / h, fz = direction.z / h;
    const rx = -fz, rz = fx, yaw = Math.atan2(-rz, rx); // wall runs perpendicular to where you face
    if (walls.length >= 2) remove(walls[0]);
    const w = { slabs: [], t: 0 };
    walls.push(w);
    for (let i = 0; i < SEGS; i++) {
      const o = (i - (SEGS - 1) / 2) * GAP, x = cx + rx * o, z = cz + rz * o;
      slab(w, { x, y: ctx.groundAt(x, z), z }, yaw, 1.9 + Math.random() * 0.8 - Math.abs(i - 3) * 0.12);
    }
    snd.noise({ dur: 0.8, filter: { type: 'lowpass', freq: 500, freqEnd: 90, q: 1 }, vol: 0.9, at: { x: cx, y: ctx.groundAt(cx, cz), z: cz } });
    snd.tone({ freq: 70, freqEnd: 35, dur: 0.6, vol: 0.7, at: { x: cx, y: ctx.groundAt(cx, cz), z: cz } });
    kit.haptic?.('right', 0.8, 90); kit.haptic?.('left', 0.5, 60);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'earth-wall', name: 'Earth Wall', color: COLOR, icon: '🧱', rate: 1, description: 'Raise a stone wall that blocks for 20 s.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt) {
      for (let i = walls.length - 1; i >= 0; i--) {
        const w = walls[i];
        w.t += dt;
        for (let k = 0; k < w.slabs.length; k++) {
          const s = w.slabs[k];
          if (!s.alive) continue;
          const rise = kit.ease.back(Math.min(1, w.t / (0.45 + k * 0.04))) , sink = w.t > LIFE ? Math.min(1, (w.t - LIFE) / 0.7) : 0;
          s.g.position.y = s.y0 - (s.h + 0.2) * (1 - rise) - (s.h + 0.2) * sink;
          if (sink > 0 && Math.random() < dt * 10) dust.emit(tmp.set(s.g.position.x, s.y0 + 0.2, s.g.position.z), 1);
        }
        if (w.t > LIFE + 0.8) remove(w);
      }
    },
  };
}
