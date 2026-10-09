// PATTERN: spell that spawns physical, grabbable objects. A mesh + kit.body = gravity, bouncing, rolling and
// collisions; `grabbable` lets the player squeeze to hold it and release to throw. Cap the count by recycling.
export const meta = { name: 'Conjure Orb', description: 'Spell: summon a glowing orb you can pick up and throw.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const MAX = 6, R = 0.13;

  const geo = new THREE.IcosahedronGeometry(R, 1), haloGeo = new THREE.SphereGeometry(R * 1.7, 12, 8);
  const orbs = [];
  const puff = kit.particles(ctx, { count: 80, color: [0xffffff, 0x88aaff], size: [0.12, 0.02], life: [0.4, 0.9], speed: [0.5, 2], gravity: 1, drag: 1.5 });
  const snd = kit.sound(ctx);
  const tmp = new THREE.Vector3();

  function spawn(at) {
    if (orbs.length >= MAX) { const old = orbs.shift(); old.body.remove(); old.light.remove(); } // oldest orb vanishes
    const color = new THREE.Color().setHSL(Math.random(), 0.9, 0.55);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.9, flatShading: true }));
    const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.add(halo);
    const body = kit.body(ctx, mesh, { position: at, radius: R, mass: 1, bounce: 0.7, grabbable: true, grabRange: 6, damage: 6, from: 'player' }); // from: thrown orbs hurt enemies, never allies
    const light = kit.light(ctx, { color, intensity: 6, distance: 6 });
    light.target = mesh; // follows the orb; kit keeps only the nearest/brightest few lights alive
    body.onHit((e) => {
      if (e.kind === 'damageable') return;
      const f = 300 + Math.min(e.speed, 8) * 90; // harder hit = higher ping
      snd.tone({ freq: f, freqEnd: f * 0.6, dur: 0.35, vol: Math.min(0.35, 0.05 + e.speed * 0.04), at: e.point });
      if (e.speed > 2) puff.emit(e.point, 6);
    });
    orbs.push({ body, halo, light, phase: Math.random() * 6 });
    puff.emit(at, 14);
    snd.chord([523, 659, 784], { dur: 0.7, vol: 0.25, stagger: 0.07, at });
  }

  function cast({ origin, direction }) {
    const aim = ctx.aimPoint(30);
    if (aim) spawn(tmp.copy(aim).setY(aim.y + 1.2)); // drops from just above where the player points
    else spawn(tmp.copy(origin).addScaledVector(direction, 0.8)); // pointing at the sky: appears in front of the hand
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'conjure-orb', name: 'Conjure Orb', color: 0x88aaff, icon: '🔮', description: 'Summon a glowing orb to grab and throw.', cast });
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      for (let i = 0; i < orbs.length; i++) {
        const o = orbs[i];
        o.halo.scale.setScalar(1 + Math.sin(t * 4 + o.phase) * 0.12 + (o.body.held ? 0.25 : 0));
      }
    },
  };
}
