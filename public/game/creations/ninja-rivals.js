export const meta = { name: 'Ninja rivals', description: 'Naruto and Sasuke sprint about and duel each other endlessly with fists, spiralling orbs and lightning.' };
export default function (ctx) {
  const kit = ctx.world.kit, combat = ctx.world.combat, env = ctx.world.env;
  if (!kit || !combat) return {};
  let cx = -31.4, cz = -99;
  for (let i = 0; i < 12 && env?.isWater?.(cx, cz); i++) cz -= 5;       // step off the lake onto dry land
  cz -= 4;

  const naruto = kit.humanoid(ctx, { height: 1.66, skin: 0xf2c79a, shirt: 0xff7a14, pants: 0xff7a14, hair: 0xffd92e, x: cx - 4, z: cz, speed: 5.5, hp: 400, gore: 'none', name: 'Naruto', role: 'ninja' });
  const sasuke = kit.humanoid(ctx, { height: 1.7, skin: 0xf0d2b4, shirt: 0x26306e, pants: 0xe8e8ee, hair: 0x14141c, x: cx + 4, z: cz, speed: 5.5, hp: 400, gore: 'none', name: 'Sasuke', role: 'rogue' });
  naruto.npcName = 'Naruto'; naruto.persona = 'Naruto, a loud, cheerful, stubborn young ninja who dreams of being Hokage and will never give up on his friend Sasuke.';
  sasuke.npcName = 'Sasuke'; sasuke.persona = 'Sasuke, a cold, proud, brooding ninja rival of few words who seeks power above all.';
  const opts = { hp: 400, damage: 5, cooldown: 0.9, windup: 0.3, speed: 6, aggroRange: 40, leash: 60, wander: 6, follow: null, damageKind: 'blunt' };
  const fn = combat.fighter(ctx, naruto, { ...opts, faction: 'friendly', name: 'Naruto' });
  const fs = combat.fighter(ctx, sasuke, { ...opts, faction: 'enemy', name: 'Sasuke' });
  if (fn && fs) { fn.setTarget(fs); fs.setTarget(fn); }

  const orb = kit.particles(ctx, { count: 220, color: [0xd8f6ff, 0x2a8cff], size: [0.28, 0.03], life: [0.3, 0.7], speed: [1, 6], drag: 2 });
  const bolt = kit.particles(ctx, { count: 220, color: [0xffffff, 0x8f6bff], size: [0.2, 0.02], life: [0.15, 0.45], speed: [3, 10], drag: 3 });
  const snd = kit.sound(ctx), A = () => ctx.world.audio;
  const p = new ctx.THREE.Vector3(), push = new ctx.THREE.Vector3();
  const linesN = ['Sasuke!', 'Rasengan!', 'I will bring you home!', 'Believe it!'], linesS = ['Naruto!', 'Chidori!', 'You are in my way.', 'Hn. Too slow.'];
  let timer = 2.5, turn = 0, said = 0;
  naruto.say('Sasuke!', 3);

  return {
    update(dt) {
      if (!fn || !fs) return;
      if (fn.alive && fn.hp < fn.maxHp * 0.5) fn.heal(fn.maxHp);      // the duel never ends
      if (fs.alive && fs.hp < fs.maxHp * 0.5) fs.heal(fs.maxHp);
      if (fn.alive && fs.alive) { if (fn.target !== fs) fn.setTarget(fs); if (fs.target !== fn) fs.setTarget(fn); }
      timer -= dt;
      if (timer > 0 || !fn.alive || !fs.alive) return;
      timer = 2.6 + Math.random() * 1.8;
      const nar = (turn++ & 1) === 0, a = nar ? naruto : sasuke, b = nar ? sasuke : naruto;
      push.copy(b.position).sub(a.position);
      const d = push.length();
      if (d > 7 || d < 0.01) { timer = 0.6; return; }
      push.multiplyScalar(5 / d);
      p.copy(b.position); p.y += 1;
      a.faceTo(b.position, 0.15); a.attackAnim(0.15, 'lunge');
      (nar ? orb : bolt).emit(p, 90, push);
      kit.flash?.(ctx, p, { color: nar ? 0x4aa8ff : 0xa98bff, intensity: 30, distance: 10, duration: 0.25 });
      kit.hit(p, 1.3, 6, { from: nar ? 'friendly' : 'enemy', by: nar ? fn : fs, kind: 'blunt', direction: push, force: 10 });
      if (!A()?.sfx(nar ? 'magic-impact' : 'lightning-zap', { at: p })) snd.noise({ dur: 0.3, filter: { freq: nar ? 900 : 3000 }, at: p });
      if ((said++ % 2) === 0) { const L = nar ? linesN : linesS; a.say(L[(Math.random() * L.length) | 0], 2.5); }
    },
  };
}
