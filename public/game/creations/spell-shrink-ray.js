// Spell: Shrink Ray. Zap an enemy and it shrinks to 40% for 15 seconds: tiny, scurrying (+40% speed) and hitting at 40% strength,
// then it pops back to full size with a squeak. Point the ray at your OWN FEET instead and you swell to a giant (2.6x, 25 s): longer
// stride, higher jumps, and every few steps your footfalls stomp the ground and bowl nearby enemies over. Zap your feet again to end it
// early. (No giants in mixed reality: your living room would not survive.) Everything is restored on expiry and on unload.
export const meta = { name: 'Shrink Ray', description: 'Spell: shrink an enemy; aim at your feet to become a giant.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // (Math.hypot allocates in hot loops)
  const COLOR = 0xffb347, SHRINK = 0.4, LIFE = 15, GIANT = 2.6, GLIFE = 25, STOMP = { from: 'player', kind: 'blunt', force: 7, direction: undefined };
  const slots = [];
  for (let i = 0; i < 8; i++) slots.push({ f: null, a: null, t: 0, k: 1, spd0: 1, spd: 1, dmg0: 1, rad0: 0.5 });
  const G = { on: 0, t: 0, k: 1, walked: 0, sp0: 4, jp0: 4.8, spMul: 1, fx: 0, fz: 0, has: false };
  const tmp = new THREE.Vector3(), rel = new THREE.Vector3();

  const beam = kit.particles(ctx, { count: 400, color: [0xffffff, 0xffa030], size: [0.28, 0.06], life: [0.2, 0.5], speed: 0.1, drag: 1 });
  const pop = kit.particles(ctx, { count: 200, color: [0xfff0c0, 0xff9020], size: [0.2, 0.03], life: [0.3, 0.8], speed: [1, 4], gravity: 2, drag: 1 });
  const dust = kit.particles(ctx, { count: 200, additive: false, color: [0x9a8a70, 0x6a5a48], alpha: 0.5, size: [0.4, 1.2], life: [0.5, 1.1], speed: [1, 3], gravity: -0.2, drag: 1.5 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });

  function pick(origin, dir) {
    const F = ctx.world.combat?.fighters;
    let best = null, bd = 1e9;
    if (F) for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (!f.alive || f.faction === 'friendly') continue;
      const A = f.actor; rel.set(A.position.x - origin.x, A.position.y + (A.height ?? 1.5) * 0.5 - origin.y, A.position.z - origin.z);
      const along = rel.dot(dir);
      if (along < 0.4 || along > 40) continue;
      const perp = rel.lengthSq() - along * along, reach = 0.8 + along * 0.07;
      if (perp < reach * reach && perp < bd) { bd = perp; best = f; }
    }
    return best;
  }
  function restore(s, squeak) {
    const f = s.f, a = s.a;
    s.f = null;
    if (!a || a.removed) return;
    a.group.scale.setScalar(1);
    if (Math.abs(a.speed - s.spd) < 1e-6) a.speed = s.spd0;
    if (f && !f.removed) f.damageAmt = s.dmg0;
    if (a.damage) a.damage.radius = s.rad0;
    tmp.set(a.position.x, a.position.y + (a.height ?? 1.5) * 0.5, a.position.z); pop.emit(tmp, 18);
    if (squeak) { sfx('child-giggle', tmp); a.say?.('!', 1); }
  }
  function endGiant(fx) {
    const P = ctx.world.player;
    if (!G.on) return;
    G.on = 0; ctx.rig.scale.setScalar(1);
    if (P) { if (Math.abs(P.speed - G.sp0 * G.spMul) < 1e-6) P.speed = G.sp0; if (Math.abs(P.jumpSpeed - G.jp0 * 1.35) < 1e-6) P.jumpSpeed = G.jp0; }
    if (fx) { dust.emit(tmp.set(ctx.player.feet.x, ctx.player.feet.y + 0.2, ctx.player.feet.z), 30, undefined, 1.5); sfx('land-thud', ctx.player.feet); }
  }
  function cast({ origin, direction }) {
    const P = ctx.world.player;
    if (ctx.clock.t - (G.last ?? -9) < 0.4) return; G.last = ctx.clock.t; // (rate 0: a held trigger must not flip the giant toggle back and forth)
    if (direction.y < -0.82 && P) { // pointed at your own feet
      if (ctx.input.passthrough) { ctx.hud?.show('No giants in your living room', 2); return; }
      if (G.on) { endGiant(true); return; }
      G.on = 1; G.t = 0; G.k = 1; G.walked = 0; G.sp0 = P.speed; G.jp0 = P.jumpSpeed; G.spMul = 1.9; P.speed = G.sp0 * G.spMul; P.jumpSpeed = G.jp0 * 1.35; G.has = false;
      const fe = ctx.player.feet; pop.emit(tmp.set(fe.x, fe.y + 1, fe.z), 40, undefined, 1.5); dust.emit(tmp.set(fe.x, fe.y + 0.1, fe.z), 30, undefined, 1.5);
      kit.flash(ctx, tmp.set(fe.x, fe.y + 1, fe.z), { color: COLOR, intensity: 30, distance: 10, duration: 0.4 });
      if (!sfx('golem-rumble', fe)) snd.tone({ freq: 60, freqEnd: 150, dur: 0.8, type: 'sawtooth', vol: 0.15 });
      ctx.hud?.show('You are a giant', 2); kit.haptic?.('right', 0.8, 120); kit.haptic?.('left', 0.8, 120);
      return;
    }
    const f = pick(origin, direction);
    const reach = f ? Math.min(30, Math.hypot(f.actor.position.x - origin.x, f.actor.position.z - origin.z)) : 6;
    for (let i = 0; i * 0.35 < reach; i++) beam.emit(tmp.copy(origin).addScaledVector(direction, i * 0.35), 2, direction, 0.5); // a visible orange ray to the target
    if (!f) { snd.tone({ freq: 900, freqEnd: 500, dur: 0.2, type: 'triangle', vol: 0.08, at: origin }); return; }
    let s = slots.find((q) => q.f === f) ?? slots.find((q) => !q.f) ?? slots.reduce((o, q) => (q.t > o.t ? q : o));
    if (s.f && s.f !== f) restore(s, false);
    const a = f.actor;
    if (s.f !== f) { s.f = f; s.a = a; s.k = 1; s.spd0 = a.speed; s.dmg0 = f.damageAmt; s.rad0 = a.damage ? a.damage.radius : 0.5; s.spd = a.speed; }
    s.t = 0; a.speed = s.spd = s.spd0 * 1.4; f.damageAmt = s.dmg0 * SHRINK; if (a.damage) a.damage.radius = s.rad0 * SHRINK;
    tmp.set(a.position.x, a.position.y + (a.height ?? 1.5) * 0.6, a.position.z); pop.emit(tmp, 24, undefined, 1.2);
    kit.flash(ctx, tmp, { color: COLOR, intensity: 25, distance: 7, duration: 0.25 });
    if (!sfx('magic-impact', tmp)) snd.tone({ freq: 1200, freqEnd: 300, dur: 0.3, type: 'sine', vol: 0.12, at: tmp });
    kit.haptic?.('right', 0.5, 50);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'shrink-ray', name: 'Shrink Ray', color: COLOR, icon: '🔬', rate: 0, description: 'Shrink an enemy; aim at your own feet to become a giant.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); for (const s of slots) if (s.f) restore(s, false); endGiant(false); });

  return {
    update(dt, t) {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i], f = s.f;
        if (!f) continue;
        const a = s.a;
        if (!f.alive || f.removed || !a || a.removed) { if (a && !a.removed && a.dead) a.group.scale.setScalar(1); s.f = null; continue; }
        s.t += dt;
        const left = LIFE - s.t, want = left < 0.5 ? 1 : SHRINK, wob = left < 3 ? 1 + 0.08 * Math.sin(t * 25) : 1; // flickers before it pops back
        s.k += (want - s.k) * Math.min(1, dt * 9); a.group.scale.setScalar(s.k * wob);
        if (s.t >= LIFE) restore(s, true);
      }
      if (!G.on) return;
      const P = ctx.world.player, f = ctx.player.feet;
      G.t += dt; G.k += ((G.t > GLIFE - 0.8 ? 1 : GIANT) - G.k) * Math.min(1, dt * 5); ctx.rig.scale.setScalar(G.k); // swells in, shrinks back for the last 0.8 s
      if (!G.has) { G.fx = f.x; G.fz = f.z; G.has = true; }
      G.walked += hyp(f.x - G.fx, f.z - G.fz); G.fx = f.x; G.fz = f.z;
      if (G.walked > 2.4) { // a stomp every few strides
        G.walked = 0; tmp.set(f.x, f.y + 0.3, f.z); STOMP.direction = rel.set(0, 0.4, 0);
        kit.hit(tmp, 4.2, 6, STOMP); ctx.world.physics?.explode?.(tmp, 4.5, 8, { lift: 0.6 });
        dust.emit(tmp, 14, undefined, 1.4); kit.haptic?.('left', 0.7, 60); kit.haptic?.('right', 0.7, 60);
        if (!sfx('ground-slam', tmp)) snd.noise({ dur: 0.4, filter: { type: 'lowpass', freq: 300, freqEnd: 60, q: 1 }, vol: 0.5, at: tmp });
      }
      if (G.t >= GLIFE || (P && !P.alive)) endGiant(true);
    },
  };
}
