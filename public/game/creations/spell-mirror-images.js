// Spell: Mirror Images. Three shimmering copies of you step out of your reflection and scatter, running and waving for 14 seconds.
// They are real friendly fighters that never attack: every enemy within 18 m that was coming for YOU is redirected (setTarget) to the
// nearest copy, so the pack splits and you get breathing room (or a clear shot). A copy pops into glass shards when it is hit hard enough, and all of them shatter when the
// spell ends. Recasting replaces the old set. Respects the perf fighter budget.
export const meta = { name: 'Mirror Images', description: 'Spell: decoys that draw enemies away from you.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // (Math.hypot allocates in hot loops)
  const COLOR = 0x8fe0ff, LIFE = 14, N = 3;
  const decoys = [], M = { ret: 0 };
  const tmp = new THREE.Vector3();

  const shards = kit.particles(ctx, { count: 320, color: [0xffffff, 0x8fe0ff], size: [0.14, 0.03], life: [0.4, 1], speed: [1.5, 5], gravity: 6, drag: 0.6 });
  const ringM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 36).rotateX(-Math.PI / 2), ringM); ring.visible = false; ring.userData.noShadow = true; ctx.root.add(ring);
  let pt = null, ringT = -1; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; if (pt) { ringM.blending = THREE.CustomBlending; ringM.blendEquation = THREE.AddEquation; ringM.blendSrc = THREE.SrcAlphaFactor; ringM.blendDst = THREE.OneFactor; ringM.blendSrcAlpha = THREE.ZeroFactor; ringM.blendDstAlpha = THREE.OneFactor; } else ringM.blending = THREE.AdditiveBlending; ringM.needsUpdate = true; };
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });

  function pop(d, hit) {
    const a = d.actor;
    if (a && !a.removed) { tmp.set(a.position.x, a.position.y + 0.9, a.position.z); shards.emit(tmp, 30, undefined, 1.2); if (!sfx('break-glass', tmp)) snd.tone({ freq: 2200, freqEnd: 600, dur: 0.25, type: 'triangle', vol: 0.12, at: tmp }); if (d.f) { try { d.f.remove(); } catch (e) { /* gone */ } } else a.remove(); }
    d.actor = null; d.f = null;
  }
  function clear() { for (const d of decoys) if (d.actor) pop(d, false); decoys.length = 0; }
  function cast() {
    const combat = ctx.world.combat, f0 = ctx.player.feet, h = ctx.player.head;
    clear();
    const height = Math.max(1.2, h.y - f0.y + 0.12), want = ctx.world.perf?.allow ? Math.min(N, ctx.world.perf.allow('fighters', N)) : N;
    for (let i = 0; i < want; i++) {
      const a0 = (i / N) * 6.2832 + Math.atan2(ctx.player.forward.x, ctx.player.forward.z), r = 1.2 * (ctx.input.passthrough ? 0.5 : 1), x = f0.x + Math.sin(a0) * r, z = f0.z + Math.cos(a0) * r;
      const a = kit.humanoid(ctx, { height, skin: 0xbfefff, shirt: 0x5fb4ff, pants: 0x3a64c8, hair: 0xe0f8ff, x, z, hp: 25, speed: 3.8, gore: 'sparks' });
      if (!a) continue;
      a.group.traverse((m) => { if (m.isMesh && m.visible && m.material && m.material.isMeshLambertMaterial) { m.material.transparent = true; m.material.opacity = 0.62; m.material.emissive.setHex(0x2a6a9a); } });
      let f = null;
      if (combat?.fighter) f = combat.fighter(ctx, a, { faction: 'friendly', attack: 'none', follow: null, hp: 25, speed: 3.8, wander: 7, reserve: false, name: 'Mirror' });
      a.wave?.(1.5);
      decoys.push({ actor: a, f, t: 0 });
      shards.emit(tmp.set(x, f0.y + 0.8, z), 18, undefined, 0.8);
    }
    ring.visible = true; ring.position.set(f0.x, ctx.groundAt(f0.x, f0.z) + 0.08, f0.z); ringT = 0;
    kit.flash(ctx, tmp.set(f0.x, f0.y + 1.2, f0.z), { color: COLOR, intensity: 35, distance: 10, duration: 0.3 });
    if (!sfx('teleport', f0)) snd.chord([1047, 1319, 1568], { dur: 0.5, vol: 0.12, stagger: 0.05, at: f0 });
    sfx('summon', f0); kit.haptic?.('right', 0.5, 60);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'mirror-images', name: 'Mirror Images', color: COLOR, icon: '🪞', rate: 1.5, description: 'Three decoys that draw enemies away from you.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); clear(); });

  return {
    update(dt, t) {
      blendFix();
      if (ringT >= 0) { ringT += dt; const u = ringT / 0.6; if (u >= 1) { ringT = -1; ring.visible = false; } else { ring.scale.setScalar(0.6 + u * 3); ringM.opacity = 0.8 * (1 - u); } }
      M.ret -= dt;
      if (M.ret <= 0 && decoys.length) { // enemies already locked on to YOU are redirected to the nearest decoy (combat.js only switches targets when a new one is much closer)
        M.ret = 0.4; const F = ctx.world.combat?.fighters, h = ctx.player.head;
        if (F) for (let i = 0; i < F.length; i++) {
          const f = F[i];
          if (!f.alive || f.faction !== 'enemy' || (f.tgt && !f.tgt.isPlayer) || hyp(f.actor.position.x - h.x, f.actor.position.z - h.z) > 18) continue;
          let best = null, bd = 1e9;
          for (let k = 0; k < decoys.length; k++) { const d = decoys[k]; if (!d.f || !d.f.alive) continue; const dd = hyp(f.actor.position.x - d.actor.position.x, f.actor.position.z - d.actor.position.z); if (dd < bd) { bd = dd; best = d.f; } }
          if (best) f.setTarget(best);
        }
      }
      for (let i = decoys.length - 1; i >= 0; i--) {
        const d = decoys[i], a = d.actor;
        if (!a) { decoys.splice(i, 1); continue; }
        d.t += dt;
        const dead = a.removed || a.dead || (d.f && !d.f.alive);
        if (dead || d.t >= LIFE) { pop(d, dead); decoys.splice(i, 1); continue; }
        if (d.t > LIFE - 2 && Math.sin(t * 30) > 0.2) a.group.visible = false; else a.group.visible = true; // flickers out
        if (Math.random() < dt * 6) shards.emit(tmp.set(a.position.x, a.position.y + 0.3 + Math.random() * 1.2, a.position.z), 1, undefined, 0.3);
        if (d.t % 3 < dt) a.wave?.(1);
      }
    },
  };
}
