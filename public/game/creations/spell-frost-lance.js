// Spell: Frost Lance. A piercing ice shard that flies through everything in its path; fighters it touches are chilled
// (slowed and encased in ice for a moment when world.combat is present). Pooled shards, pooled ice blocks, no per-frame allocation.
export const meta = { name: 'Frost Lance', description: 'Spell: a piercing ice shard that chills what it hits.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x8fe8ff, POOL = 5, SPEED = 60, RANGE = 70, DAMAGE = 16, FROM = { from: 'player', kind: 'frost' };
  const FWD = new THREE.Vector3(0, 0, -1), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  const geo = new THREE.OctahedronGeometry(0.5, 0);
  const coreM = new THREE.MeshBasicMaterial({ color: 0xeafcff });
  const haloM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  const shards = [];
  for (let i = 0; i < POOL; i++) {
    const mesh = new THREE.Mesh(geo, coreM), halo = new THREE.Mesh(geo, haloM);
    mesh.scale.set(0.07, 0.07, 1.2); halo.scale.set(2.8, 2.8, 1.4);
    mesh.add(halo); mesh.visible = false; ctx.root.add(mesh);
    shards.push({ mesh, alive: false, dist: 0, dir: new THREE.Vector3(), hit: [null, null, null, null, null, null, null, null], hitN: 0 });
  }
  const frost = kit.particles(ctx, { count: 320, color: [0xffffff, 0x58c8ff], size: [0.17, 0.02], life: [0.3, 0.7], speed: [0.1, 0.6], gravity: 0.5, drag: 1.5 });
  const shatter = kit.particles(ctx, { count: 200, color: [0xffffff, 0x8fe8ff], size: [0.1, 0.015], life: [0.3, 0.9], speed: [2, 7], gravity: 7, drag: 0.4 });
  const snd = kit.sound(ctx);
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 8 });

  // ice blocks around chilled fighters
  const iceGeo = new THREE.IcosahedronGeometry(1, 0), iceM = new THREE.MeshLambertMaterial({ color: 0xaee8ff, emissive: 0x2a66aa, transparent: true, opacity: 0.55, flatShading: true });
  const frozen = [];
  for (let i = 0; i < 6; i++) { const mesh = new THREE.Mesh(iceGeo, iceM); mesh.visible = false; ctx.root.add(mesh); frozen.push({ a: null, mesh, t: 0, speed0: 1, h: 1.7 }); }
  function chill(p) {
    const F = ctx.world.combat?.fighters;
    if (!F) return;
    for (let i = 0; i < F.length; i++) {
      const f = F[i], a = f.actor;
      if (!a || f.alive === false || f.faction === 'friendly') continue;
      const h = a.height ?? 1.7;
      if (Math.hypot(a.position.x - p.x, a.position.z - p.z) > 1.2 || Math.abs(a.position.y + h * 0.5 - p.y) > h) continue;
      let z = null;
      for (let k = 0; k < frozen.length; k++) if (frozen[k].a === a) { z = frozen[k]; break; }
      if (!z) for (let k = 0; k < frozen.length; k++) if (!frozen[k].a) { z = frozen[k]; z.a = a; z.speed0 = a.speed; z.h = h; z.mesh.visible = true; break; }
      if (z) z.t = 2.6;
    }
  }

  function cast({ origin, direction }) {
    let s = shards.find((x) => !x.alive) ?? shards.reduce((o, x) => (x.dist > o.dist ? x : o));
    s.alive = true; s.dist = 0; s.hitN = 0; s.hit.fill(null); s.dir.copy(direction);
    s.mesh.position.copy(origin); s.mesh.quaternion.setFromUnitVectors(FWD, direction); s.mesh.visible = true;
    frost.emit(origin, 18, tmp.copy(direction).multiplyScalar(2.5));
    snd.noise({ dur: 0.3, filter: { type: 'highpass', freq: 2500, freqEnd: 6500, q: 0.8 }, vol: 0.25, at: origin });
    snd.chord([1568, 2093, 2637], { dur: 0.5, vol: 0.18, stagger: 0.035, at: origin });
    ctx.input.right.pulse?.(0.5, 40);
  }
  function strike(s, p, t) {
    kit.hit(p, 0.5, DAMAGE, FROM);
    shatter.emit(p, 22); frost.emit(p, 8);
    kit.flash(ctx, p, { color: COLOR, intensity: 18, distance: 7, duration: 0.15 });
    snd.tone({ freq: 2400, freqEnd: 900, dur: 0.25, type: 'triangle', vol: 0.12, at: p });
    chill(p);
    if (s.hitN < s.hit.length) s.hit[s.hitN++] = t;
  }
  function stop(s, p) { s.alive = false; s.mesh.visible = false; shatter.emit(p, 14); snd.tone({ freq: 3000, freqEnd: 1200, dur: 0.2, type: 'triangle', vol: 0.08, at: p }); }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'frost-lance', name: 'Frost Lance', color: COLOR, icon: '❄️', rate: 0.45, description: 'Piercing ice that slows what it hits.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt) {
      let lead = null;
      for (let i = 0; i < POOL; i++) {
        const s = shards[i];
        if (!s.alive) continue;
        const p = s.mesh.position, step = SPEED * dt;
        p.addScaledVector(s.dir, step); s.dist += step;
        frost.emit(p, 2); if (Math.random() < 0.5) shatter.emit(p, 1);
        for (let k = 0; k < 2; k++) { // sweep the last metre of travel for targets
          tmp2.copy(p).addScaledVector(s.dir, -k * step * 0.5);
          const t = kit.nearestTarget(tmp2, 0.5);
          if (t && t.faction !== 'friendly' && !s.hit.includes(t)) { strike(s, tmp2, t); break; }
        }
        if (p.y <= ctx.groundAt(p.x, p.z) + 0.05 || s.dist > RANGE) { stop(s, p); continue; }
        lead = p;
      }
      if (lead) { glow.position.copy(lead); glow.intensity = 14; } else glow.intensity = 0;
      for (let i = 0; i < frozen.length; i++) { // chilled fighters
        const z = frozen[i];
        if (!z.a) continue;
        z.t -= dt;
        const a = z.a;
        if (z.t <= 0 || a.dead || a.removed) { if (!a.removed) a.setSpeed(z.speed0); z.a = null; z.mesh.visible = false; shatter.emit(z.mesh.position, 16); continue; }
        a.setSpeed(z.speed0 * 0.12);
        z.mesh.position.set(a.position.x, a.position.y + z.h * 0.5, a.position.z);
        z.mesh.scale.set(z.h * 0.3, z.h * 0.55, z.h * 0.3).multiplyScalar(0.9 + 0.1 * Math.min(1, z.t * 3));
        z.mesh.rotation.y += dt * 0.5;
        if (Math.random() < dt * 14) frost.emit(z.mesh.position, 1);
      }
    },
  };
}
