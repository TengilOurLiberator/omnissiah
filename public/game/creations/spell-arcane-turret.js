// Spell: Arcane Turret. A floating crystal sentinel unfolds where you point (at head height, ringed by orbiting runes) and for 22
// seconds snaps arcane bolts at the nearest enemy within 18 m, swivelling to track it, with a muzzle flash and a tracer. Bolts are
// real combat.js projectiles (friendly), so shields and walls interact with them. It is a friendly damageable (40 hp): enemies shoot
// it, and it bursts into shards when destroyed. Two at most; the older one is withdrawn. Mixed reality: a 25 cm gem.
export const meta = { name: 'Arcane Turret', description: 'Spell: a floating crystal that shoots nearby enemies.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const HOSTILE = { hostileTo: 'friendly' };
  const COLOR = 0xc08cff, LIFE = 22, RANGE = 18, MAX = 2, FROM = { from: 'player', kind: 'magic', force: 0 };
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), mz = new THREE.Vector3(), tc = new THREE.Vector3();
  const mr = () => (ctx.input.passthrough ? 0.25 : 1);
  const turrets = [];

  const crystalG = new THREE.OctahedronGeometry(0.28, 0), runeG = new THREE.TetrahedronGeometry(0.07, 0);
  const bodyM = new THREE.MeshLambertMaterial({ color: 0xa070ff, emissive: 0x5a2aa0, flatShading: true }), runeM = new THREE.MeshBasicMaterial({ color: 0xf0d8ff });
  const haloM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; if (pt) { haloM.blending = THREE.CustomBlending; haloM.blendEquation = THREE.AddEquation; haloM.blendSrc = THREE.SrcAlphaFactor; haloM.blendDst = THREE.OneFactor; haloM.blendSrcAlpha = THREE.ZeroFactor; haloM.blendDstAlpha = THREE.OneFactor; } else haloM.blending = THREE.AdditiveBlending; haloM.needsUpdate = true; };
  const sparks = kit.particles(ctx, { count: 260, color: [0xffffff, 0xb070ff], size: [0.14, 0.02], life: [0.2, 0.7], speed: [1, 5], gravity: 3, drag: 0.8 });
  const trace = kit.particles(ctx, { count: 300, color: [0xf0e0ff, 0x9050ff], size: [0.1, 0.02], life: [0.15, 0.35], speed: 0.05, drag: 1 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });

  function make(x, y, z) {
    const g = new THREE.Group(), body = new THREE.Mesh(crystalG, bodyM), halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), haloM); body.scale.y = 1.5;
    const orbit = new THREE.Group(); for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(runeG, runeM), a = i * 1.5708; r.position.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5); orbit.add(r); }
    g.add(body, halo, orbit); g.position.set(x, y, z); g.traverse((m) => { m.userData.noShadow = true; }); ctx.root.add(g);
    const tu = { g, body, orbit, t: 0, cd: 0.6, face: 0, d: null, y0: y, flash: 0 };
    tu.d = kit.damageable(ctx, g, { hp: 40, radius: 0.45, faction: 'friendly', onDeath: () => destroy(tu, true) });
    return tu;
  }
  function destroy(tu, burst) {
    const i = turrets.indexOf(tu); if (i < 0) return;
    turrets.splice(i, 1);
    sparks.emit(tu.g.position, burst ? 40 : 20, undefined, 1.4);
    if (burst) { kit.flash(ctx, tu.g.position, { color: COLOR, intensity: 30, distance: 8, duration: 0.3 }); if (!sfx('break-crystal', tu.g.position)) snd.noise({ dur: 0.3, filter: { type: 'highpass', freq: 2500, q: 0.8 }, vol: 0.3, at: tu.g.position }); }
    tu.d.remove(); tu.g.removeFromParent();
  }
  function cast({ origin, direction }) {
    const k = mr(), aim = ctx.aimPoint(ctx.input.passthrough ? 3 : 30);
    if (aim) tmp.copy(aim); else tmp.copy(origin).addScaledVector(direction, 3 * k);
    tmp.y = (aim ? aim.y : ctx.groundAt(tmp.x, tmp.z)) + 1.5 * k;
    if (turrets.length >= MAX) destroy(turrets[0], false);
    const tu = make(tmp.x, tmp.y, tmp.z); tu.g.scale.setScalar(0.01 + 0.0); tu.s = k; turrets.push(tu);
    sparks.emit(tmp, 30, undefined, 1.3); kit.flash(ctx, tmp, { color: COLOR, intensity: 30, distance: 9, duration: 0.3 });
    if (!sfx('summon', tmp)) snd.chord([523, 784, 1047], { dur: 0.6, vol: 0.12, stagger: 0.06, at: tmp });
    kit.haptic?.('right', 0.5, 50);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'arcane-turret', name: 'Arcane Turret', color: COLOR, icon: '🔮', rate: 1, description: 'A floating crystal that shoots nearby enemies.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); });

  return {
    update(dt, t) {
      blendFix();
      for (let i = turrets.length - 1; i >= 0; i--) {
        const tu = turrets[i];
        tu.t += dt; tu.cd -= dt; tu.flash = Math.max(0, tu.flash - dt * 6);
        const e = Math.min(1, tu.t / 0.5), life = Math.min(1, (LIFE - tu.t) / 1);
        tu.g.scale.setScalar(Math.max(0.01, (tu.s ?? 1) * (1 - Math.pow(1 - e, 3)) * life));
        tu.g.position.y = tu.y0 + Math.sin(t * 2 + i) * 0.08; tu.orbit.rotation.y = t * 2.5; tu.body.rotation.y = tu.face; bodyM.emissive.setRGB(0.35 + tu.flash, 0.16 + tu.flash * 0.6, 0.63 + tu.flash * 0.3);
        if (tu.t >= LIFE) { destroy(tu, false); continue; }
        if (tu.cd > 0 || tu.t < 0.6) continue;
        const p = tu.g.position, tg = kit.nearestTarget(p, RANGE, HOSTILE);
        if (!tg) continue;
        tg.center(tc); dir.subVectors(tc, p); const d = dir.length(); if (d < 0.5) continue; dir.multiplyScalar(1 / d);
        tu.face = Math.atan2(dir.x, dir.z); tu.cd = 0.55; tu.flash = 1; mz.copy(p).addScaledVector(dir, 0.4 * (tu.s ?? 1));
        const C = ctx.world.combat;
        if (C && C.fire) C.fire({ origin: mz, direction: dir, speed: 28, damage: 7, from: 'friendly', color: COLOR, radius: 0.12, splash: 0.4, life: 1.5 });
        else { FROM.direction = dir; kit.hit(tc, 0.6, 7, FROM); }
        for (let k = 1; k < 5; k++) trace.emit(tmp.copy(mz).addScaledVector(dir, k * Math.min(d, 20) * 0.04), 1);
        sparks.emit(mz, 5, dir, 0.6);
        if (!sfx('arcane-bolt', mz)) snd.tone({ freq: 900, freqEnd: 300, dur: 0.12, type: 'square', vol: 0.06, at: mz });
      }
    },
  };
}
