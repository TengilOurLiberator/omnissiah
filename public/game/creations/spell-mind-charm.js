// Spell: Mind Charm. Point at an enemy and a pink spark takes hold of its mind: for 20 seconds it flips to YOUR side (a real
// faction change through combat.js), trails you, defends you and fights its old friends, a heart bobbing over its head that starts
// to flutter as the spell wears thin. Then it remembers who it was. Up to four at once; bosses (over 140 hp) shrug it off.
export const meta = { name: 'Mind Charm', description: 'Spell: an enemy fights for you for 20 seconds.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xff5fa8, LIFE = 20, MAX = 4;
  const tmp = new THREE.Vector3(), rel = new THREE.Vector3(), a = new THREE.Vector3();
  const slots = [];

  const heart = new THREE.Shape(); // a little flat heart
  heart.moveTo(0, -0.5); heart.bezierCurveTo(-0.9, 0.05, -0.55, 0.6, 0, 0.28); heart.bezierCurveTo(0.55, 0.6, 0.9, 0.05, 0, -0.5);
  const heartG = new THREE.ShapeGeometry(heart, 10);
  for (let i = 0; i < MAX; i++) {
    const m = new THREE.Mesh(heartG, new THREE.MeshBasicMaterial({ color: COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.95, fog: false }));
    m.visible = false; m.userData.noShadow = true; ctx.root.add(m); slots.push({ f: null, m, t: 0, prevFaction: 'enemy', prevFollow: null });
  }
  const sparks = kit.particles(ctx, { count: 260, color: [0xffffff, 0xff3a90], size: [0.14, 0.02], life: [0.4, 1], speed: [0.5, 2.5], gravity: -1, drag: 1 });
  const beam = kit.particles(ctx, { count: 140, color: [0xffe0f0, 0xff5fa8], size: [0.1, 0.02], life: [0.2, 0.5], speed: 0.1, drag: 1 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });

  function pick(origin, dir) { // the enemy nearest the aim ray
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
  function free(s, broke) {
    const f = s.f; s.f = null; s.m.visible = false;
    if (!f) return;
    if (f.alive && !f.removed) { f.setFaction(s.prevFaction); f.follow = s.prevFollow; if (broke) f.actor.say?.('Hey!', 1.2); }
    const A = f.actor; if (A && !A.removed) { tmp.set(A.position.x, A.position.y + (A.height ?? 1.5) + 0.3, A.position.z); sparks.emit(tmp, 18, undefined, 1.2); }
    if (!sfx('break-glass', tmp)) snd.tone({ freq: 1400, freqEnd: 300, dur: 0.3, type: 'triangle', vol: 0.1, at: tmp });
  }
  function cast({ origin, direction }) {
    const f = pick(origin, direction);
    for (let i = 0; i < 6; i++) beam.emit(tmp.copy(origin).addScaledVector(direction, i * 0.5), 2, direction, 0.6);
    if (!f) { sparks.emit(tmp.copy(origin).addScaledVector(direction, 1.2), 8); snd.tone({ freq: 700, freqEnd: 350, dur: 0.2, type: 'triangle', vol: 0.08, at: origin }); return; }
    const A = f.actor;
    tmp.set(A.position.x, A.position.y + (A.height ?? 1.5) * 0.7, A.position.z);
    if (f.maxHp > 140) { sparks.emit(tmp, 16); A.say?.('Nice try.', 1.4); snd.tone({ freq: 200, freqEnd: 120, dur: 0.3, type: 'sawtooth', vol: 0.1, at: tmp }); return; }
    let s = slots.find((q) => !q.f) ?? slots.reduce((o, q) => (q.t > o.t ? q : o)); // the longest-charmed one wakes first
    if (s.f) free(s, false);
    s.f = f; s.t = 0; s.prevFaction = f.faction; s.prevFollow = f.follow;
    f.setFaction('friendly'); f.follow = 'player'; s.m.visible = true;
    sparks.emit(tmp, 28, undefined, 1.4);
    kit.flash(ctx, tmp, { color: COLOR, intensity: 25, distance: 8, duration: 0.3 });
    if (!sfx('child-giggle', tmp)) snd.chord([784, 988, 1319], { dur: 0.5, vol: 0.12, stagger: 0.07, at: tmp });
    sfx('heal-chime', tmp); A.say?.('<3', 1.5);
    kit.haptic?.('right', 0.6, 60);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'mind-charm', name: 'Mind Charm', color: COLOR, icon: '💘', rate: 0.8, description: 'Turn an enemy to your side for 20 s.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); for (const s of slots) if (s.f) free(s, false); });

  return {
    update(dt, t) {
      for (let i = 0; i < MAX; i++) {
        const s = slots[i], f = s.f;
        if (!f) continue;
        s.t += dt;
        if (!f.alive || f.removed || f.actor.removed) { s.f = null; s.m.visible = false; continue; } // it died on our side: nothing to restore
        if (s.t >= LIFE) { free(s, true); continue; }
        const A = f.actor, left = LIFE - s.t, flutter = left < 4 ? 0.5 + 0.5 * Math.sin(t * (10 + (4 - left) * 6)) : 1;
        s.m.position.set(A.position.x, A.position.y + (A.height ?? 1.5) + 0.55 + Math.sin(t * 3 + i) * 0.08, A.position.z);
        s.m.scale.setScalar(0.6 * (1 + 0.12 * Math.sin(t * 7 + i)) * flutter); s.m.rotation.y = Math.sin(t * 1.5 + i) * 0.7;
        s.m.lookAt(ctx.player.head.x, s.m.position.y, ctx.player.head.z); s.m.material.opacity = 0.6 + 0.4 * flutter;
        if (Math.random() < dt * 5) sparks.emit(a.set(A.position.x, A.position.y + 1, A.position.z), 1);
        if (f.faction !== 'friendly') f.setFaction('friendly'); // keep the charm if something re-flipped it
      }
    },
  };
}
