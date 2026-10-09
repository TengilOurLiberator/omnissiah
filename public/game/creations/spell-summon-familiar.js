// Spell: Summon Familiar. A small glowing spirit-hound appears in a ring of light, follows you and fights your enemies.
// Uses world.combat (a friendly fighter) when present; otherwise a simple built-in chase-and-bite brain. Max 3, each lasts ~75 s.
export const meta = { name: 'Summon Familiar', description: 'Spell: a small friendly spirit that follows and fights for you.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x57d6ff, MAX = 3, LIFE = 75, FROM = { from: 'player', kind: 'pierce' }, ENEMY = { hostileTo: 'friendly' };
  const fams = [];
  const tmp = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 2.2, 0);

  const sparkle = kit.particles(ctx, { count: 300, color: [0xffffff, 0x57d6ff], size: [0.12, 0.02], life: [0.4, 1], speed: [0.2, 1.2], gravity: -0.8, drag: 0.8 });
  const wisp = kit.particles(ctx, { count: 160, color: [0xd6f6ff, 0x2a8cff], size: [0.18, 0.02], life: [0.3, 0.6], speed: 0.1, drag: 1 });
  const snd = kit.sound(ctx);
  const ringM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 36).rotateX(-Math.PI / 2), ringM);
  ring.visible = false; ctx.root.add(ring);
  let ringT = -1;

  function poof(p) {
    sparkle.emit(tmp.set(p.x, p.y + 0.3, p.z), 30, undefined, 1.2);
    snd.chord([1047, 1319, 1568], { dur: 0.45, vol: 0.1, stagger: 0.04, at: p });
  }
  function drop(f) {
    const i = fams.indexOf(f);
    if (i >= 0) fams.splice(i, 1);
    poof(f.actor.position);
    if (f.fighter) f.fighter.remove(); else f.actor.remove();
  }
  function cast({ origin, direction }) {
    const aim = ctx.aimPoint(16);
    if (aim) tmp.copy(aim); else { tmp.copy(origin).addScaledVector(direction, 2.5); tmp.y = ctx.groundAt(tmp.x, tmp.z); }
    const x = tmp.x, z = tmp.z, y = tmp.y;
    pos.set(x, y + 0.3, z);
    if (fams.length >= MAX) drop(fams[0]);
    const actor = kit.creature(ctx, { legs: 4, size: 0.55, bodyColor: COLOR, accent: 0xe8fbff, eyeColor: 0xffffff, speed: 4.2, hp: 30, x, z });
    if (!actor) return;
    let fighter = null;
    const combat = ctx.world.combat;
    if (combat?.fighter) {
      fighter = combat.fighter(ctx, actor, { faction: 'friendly', hp: 30, damage: 6, attack: 'melee', range: 1.3, cooldown: 0.8, windup: 0.25, aggroRange: 16, speed: 4.4, follow: 'player', wander: 0, name: 'Familiar' });
    } else actor.follow(ctx.player.head, 2.5);
    fams.push({ actor, fighter, t: 0, bite: 0 });
    ring.visible = true; ring.position.set(x, y + 0.06, z); ringT = 0;
    sparkle.emit(pos, 40, up);
    kit.flash(ctx, pos, { color: COLOR, intensity: 30, distance: 8, duration: 0.3 });
    snd.chord([523, 784, 1047, 1568], { dur: 0.7, vol: 0.14, stagger: 0.07, at: pos });
    snd.tone({ freq: 900, freqEnd: 1500, dur: 0.12, type: 'square', vol: 0.05, at: pos, delay: 0.3 });
    kit.haptic?.('right', 0.5, 60);
    actor.say?.('!', 1.2);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'summon-familiar', name: 'Summon Familiar', color: COLOR, icon: '🐺', rate: 1.2, description: 'A spirit-hound that fights beside you.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt) {
      if (ringT >= 0) {
        ringT += dt;
        const u = ringT / 0.7;
        if (u >= 1) { ringT = -1; ring.visible = false; } else { ring.scale.setScalar(0.5 + u * 2.2); ringM.opacity = 0.9 * (1 - u); }
      }
      for (let i = fams.length - 1; i >= 0; i--) {
        const f = fams[i], a = f.actor;
        f.t += dt;
        if (a.removed) { fams.splice(i, 1); continue; }
        if (a.dead) { if (f.t > -1) { f.t = -9; poof(a.position); } continue; }
        if (f.t > LIFE) { drop(f); continue; }
        if (Math.random() < dt * 24) wisp.emit(tmp.set(a.position.x, a.position.y + 0.35, a.position.z), 1);
        if (f.fighter) continue; // combat.js drives it
        f.bite -= dt; // fallback brain: chase the nearest enemy, bite when close
        const t = kit.nearestTarget(a.position, 12, ENEMY);
        if (t) {
          t.center(tmp);
          if (Math.hypot(tmp.x - a.position.x, tmp.z - a.position.z) < 1.5 + t.radius) { a.stop(); if (f.bite <= 0) { f.bite = 0.8; kit.hit(tmp, 0.8, 6, FROM); a.attackAnim?.(0.1, 'lunge'); } }
          else a.walkTo(tmp.x, tmp.z);
        } else if (!a.followTarget) a.follow(ctx.player.head, 2.5);
      }
    },
  };
}
