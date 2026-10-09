// Spell: Polymorph. Zap an enemy and it vanishes in a puff of feathers: where it stood is a very confused chicken (a real library
// chicken). For 12 seconds it is harmless. Then the spell lapses and the original returns (same kind, same health fraction, fresh
// temper) wherever the chicken wandered. Kill the chicken meanwhile and the enemy stays dead. Bosses (over 140 hp) resist.
export const meta = { name: 'Polymorph', description: 'Spell: turn an enemy into a chicken for 12 seconds.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xc890ff, LIFE = 12, MAX = 3;
  const tmp = new THREE.Vector3(), rel = new THREE.Vector3();
  const slots = [];
  for (let i = 0; i < MAX; i++) slots.push({ h: null, name: '', hpf: 1, t: 0, x: 0, z: 0 });

  const ringM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 36).rotateX(-Math.PI / 2), ringM); ring.visible = false; ring.userData.noShadow = true; ctx.root.add(ring);
  let pt = null, ringT = -1; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; if (pt) { ringM.blending = THREE.CustomBlending; ringM.blendEquation = THREE.AddEquation; ringM.blendSrc = THREE.SrcAlphaFactor; ringM.blendDst = THREE.OneFactor; ringM.blendSrcAlpha = THREE.ZeroFactor; ringM.blendDstAlpha = THREE.OneFactor; } else ringM.blending = THREE.AdditiveBlending; ringM.needsUpdate = true; };
  const feathers = kit.particles(ctx, { count: 200, additive: false, color: [0xffffff, 0xf0e6d0], size: [0.12, 0.06], life: [0.8, 1.8], speed: [1, 3.5], gravity: 1.2, drag: 1.5 });
  const smoke = kit.particles(ctx, { count: 160, additive: false, color: [0xc8a0ff, 0x6a30c0], size: [0.4, 1.0], life: [0.4, 0.9], speed: [0.3, 1.5], gravity: -0.6, drag: 1.2, alpha: 0.55 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });

  function pick(origin, dir) {
    const F = ctx.world.combat?.fighters;
    let best = null, bd = 1e9;
    if (F) for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (!f.alive || f.faction !== 'enemy') continue;
      const A = f.actor; rel.set(A.position.x - origin.x, A.position.y + (A.height ?? 1.5) * 0.5 - origin.y, A.position.z - origin.z);
      const along = rel.dot(dir);
      if (along < 0.4 || along > 40) continue;
      const perp = rel.lengthSq() - along * along, reach = 0.8 + along * 0.07;
      if (perp < reach * reach && perp < bd) { bd = perp; best = f; }
    }
    return best;
  }
  function puff(x, y, z) {
    tmp.set(x, y, z); feathers.emit(tmp, 40); smoke.emit(tmp, 18, undefined, 1.2);
    ring.visible = true; ring.position.set(x, ctx.groundAt(x, z) + 0.1, z); ringT = 0;
    kit.flash(ctx, tmp, { color: COLOR, intensity: 14, distance: 8, duration: 0.25 });
  }
  function revert(s, natural) {
    const lib = ctx.world.library, ch = s.h && s.h.actors && s.h.actors[0];
    let x = s.x, z = s.z, dead = !ch || ch.dead || ch.removed;
    if (ch && !ch.removed) { x = ch.position.x; z = ch.position.z; }
    if (dead) { s.h = null; return; } // the chicken died: so did the enemy, and the corpse stays where it fell
    if (s.h) { try { s.h.remove(); } catch (e) { /* gone */ } }
    s.h = null;
    puff(x, ctx.groundAt(x, z) + 0.8, z);
    if (!natural || !lib) return;
    const h = lib.spawn(ctx, s.name, { x, z, count: 1 });
    const f = h && h.fighters && h.fighters[0];
    if (f) { f.damage.hp = Math.max(1, f.damage.maxHp * s.hpf); f.actor.say?.('...!', 1.2); }
    sfx('summon', tmp);
  }
  function cast({ origin, direction }) {
    const lib = ctx.world.library, f = pick(origin, direction);
    if (!lib) { ctx.hud?.show('Polymorph needs the library', 2); return; }
    for (let i = 0; i < 5; i++) smoke.emit(tmp.copy(origin).addScaledVector(direction, i * 0.4), 1, direction, 0.5);
    if (!f) { snd.tone({ freq: 700, freqEnd: 350, dur: 0.2, type: 'triangle', vol: 0.08, at: origin }); return; }
    const A = f.actor, x = A.position.x, z = A.position.z;
    if (f.maxHp > 140) { puff(x, A.position.y + 1, z); A.say?.('Nope.', 1.4); return; }
    let s = slots.find((q) => !q.h) ?? slots.reduce((o, q) => (q.t > o.t ? q : o));
    if (s.h) revert(s, true);
    s.name = f.libName ?? A.role ?? A.name ?? 'goblin'; s.hpf = f.hp / Math.max(1, f.maxHp); s.t = 0; s.x = x; s.z = z;
    puff(x, A.position.y + 0.9, z);
    f.remove(); // the original is gone (despawned, no death event) for the duration
    s.h = lib.spawn(ctx, 'chicken', { x, z, count: 1 });
    const ck = s.h?.actors?.[0]; if (ck) { ck.group.scale.setScalar(4); ck.say?.('BAWK!', 2); } // (a big chicken: it has to be seen above the grass)
    if (!sfx('chicken-cluck', tmp)) snd.tone({ freq: 900, freqEnd: 500, dur: 0.15, type: 'square', vol: 0.08, at: tmp });
    sfx('magic-impact', tmp);
    kit.haptic?.('right', 0.5, 60);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'polymorph', name: 'Polymorph', color: COLOR, icon: '🐔', rate: 0.8, description: 'Turn an enemy into a chicken for 12 s.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); for (const s of slots) if (s.h) { try { s.h.remove(); } catch (e) { /* gone */ } s.h = null; } });

  return {
    update(dt) {
      blendFix();
      if (ringT >= 0) { ringT += dt; const u = ringT / 0.5; if (u >= 1) { ringT = -1; ring.visible = false; } else { ring.scale.setScalar(0.5 + u * 3); ringM.opacity = 0.8 * (1 - u); } }
      for (let i = 0; i < MAX; i++) {
        const s = slots[i];
        if (!s.h) continue;
        s.t += dt;
        const ch = s.h.actors && s.h.actors[0];
        if (ch && !ch.removed && !ch.dead) { s.x = ch.position.x; s.z = ch.position.z; }
        if (s.t >= LIFE || !ch || ch.dead || ch.removed) revert(s, s.t >= LIFE);
      }
    },
  };
}
