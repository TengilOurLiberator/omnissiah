// PATTERN: spell with a projectile pool. Pre-built bolts are recycled (no allocation per cast or per frame),
// trails are one shared kit particle emitter, impacts go through kit.hit + kit.explosion so ANY damageable reacts.
// Player spells pass { from: 'player' } so they hurt enemies and neutrals but never you or your allies.
// Registration pattern: register in the body, unregister in dispose, and re-register when core/spells.js reloads.
// `rate` makes holding the trigger auto-repeat; icon/description show up on the spell wheel.
export const meta = { name: 'Firebolt', description: 'Spell: hurl a fiery bolt that explodes on impact.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const POOL = 8, SPEED = 30, COLOR = 0xff6a1a, FROM = { from: 'player', kind: 'fire' };

  const coreGeo = new THREE.SphereGeometry(0.07, 10, 8), glowGeo = new THREE.SphereGeometry(0.16, 10, 8);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
  const glowMat = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
  const bolts = [];
  for (let i = 0; i < POOL; i++) {
    const mesh = new THREE.Mesh(coreGeo, coreMat);
    mesh.add(new THREE.Mesh(glowGeo, glowMat));
    mesh.visible = false;
    ctx.root.add(mesh);
    bolts.push({ mesh, alive: false, v: new THREE.Vector3(), prev: new THREE.Vector3(), age: 0 });
  }
  const trail = kit.particles(ctx, { count: 260, color: [0xffc060, 0xff3000], size: [0.2, 0.02], life: [0.25, 0.5], speed: 0.3, drag: 1 });
  const puff = kit.particles(ctx, { count: 60, color: [0xfff0b0, 0xff5010], size: [0.3, 0.05], life: [0.1, 0.3], speed: [0.5, 2], drag: 3 });
  const snd = kit.sound(ctx);
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 8 }); // follows the newest live bolt
  const tmp = new THREE.Vector3();

  function cast({ origin, direction }) {
    let b = bolts.find((x) => !x.alive) ?? bolts.reduce((o, x) => (x.age > o.age ? x : o)); // recycle the oldest
    b.alive = true; b.age = 0; b.mesh.visible = true;
    b.mesh.position.copy(origin); b.prev.copy(origin);
    b.v.copy(direction).multiplyScalar(SPEED);
    puff.emit(origin, 8, tmp.copy(direction).multiplyScalar(2)); // muzzle flash
    snd.noise({ dur: 0.35, filter: { type: 'bandpass', freq: 700, freqEnd: 2600, q: 1.2 }, vol: 0.25, at: origin });
    snd.tone({ freq: 240, freqEnd: 90, dur: 0.25, type: 'sawtooth', vol: 0.07, at: origin });
    kit.haptic?.('right', 0.4, 35);
  }

  function explode(b) {
    const p = b.mesh.position;
    p.y = Math.max(p.y, ctx.groundAt(p.x, p.z) + 0.05);
    kit.hit(p, 1.8, 14, FROM);
    kit.explosion(ctx, p, { color: COLOR, size: 1.5 });
    b.alive = false; b.mesh.visible = false;
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'firebolt', name: 'Firebolt', color: COLOR, icon: '🔥', rate: 0.3, description: 'A fiery bolt that explodes on impact.', cast });
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); }); // spells.js was reloaded
  ctx.onDispose(() => off?.());

  return {
    update(dt) {
      let lead = null;
      for (let i = 0; i < POOL; i++) {
        const b = bolts[i];
        if (!b.alive) continue;
        const p = b.mesh.position;
        b.age += dt;
        b.prev.copy(p);
        b.v.y -= 1.5 * dt; // a slight arc
        p.addScaledVector(b.v, dt);
        trail.emit(tmp.lerpVectors(b.prev, p, 0.33), 1);
        trail.emit(tmp.lerpVectors(b.prev, p, 0.66), 1);
        trail.emit(p, 1);
        const t = kit.nearestTarget(p, 0.5);
        if (p.y <= ctx.groundAt(p.x, p.z) + 0.05 || (t && t.faction !== 'friendly')) { explode(b); continue; } // fly past allies
        if (b.age > 3) { b.alive = false; b.mesh.visible = false; continue; }
        lead = p;
      }
      if (lead) { glow.position.copy(lead); glow.intensity = 14; } else glow.intensity = 0;
    },
  };
}
