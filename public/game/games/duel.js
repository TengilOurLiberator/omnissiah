// games/duel.js - Sword Duel: a ladder of up to five fencers, each sharper than the last. A bout is first to 3 touches. You are handed a sword (and, in VR, a shield).
// Opponents show a red marker over their head while they wind up: swing your blade across your chest as the blow lands to PARRY (they reel, and a touch in the next 1.5 s is a counter),
// or hold the shield up to block (VR; on desktop the sword alone). Nobody gets hurt: a touch against you costs one of your 4 hearts (a won bout gives one back), your health is never touched.
export const meta = {
  name: 'duel', title: 'Sword Duel', aliases: ['sword duel', 'duelling', 'dueling', 'fencing', 'swordfight', 'sword fight', 'tournament', 'jousting', 'knight duel', 'ladder'], icon: '⚔️',
  description: 'a tournament ladder of five fencers: first to 3 touches, parry the red wind-up, counter-hit', hint: 'First to 3 touches. Parry when the red mark shows', distance: 2, size: 8, par: 1100, physics: false,
};

const LADDER = [
  { name: 'Apprentice', model: 'rogue-hooded', tint: 0x9ab0c8, h: 1.75, windup: 0.9, cooldown: 2.7, speed: 1.9 },
  { name: 'Bandit', model: 'rogue', tint: 0x7a6660, h: 1.78, windup: 0.72, cooldown: 2.3, speed: 2.3 },
  { name: 'Knight', model: 'knight', h: 1.95, windup: 0.6, cooldown: 1.95, speed: 2.5, shield: true },
  { name: 'Barbarian', model: 'barbarian', h: 2.0, windup: 0.5, cooldown: 1.6, speed: 2.9 },
  { name: 'Black Knight', model: 'dark-knight', h: 2.1, windup: 0.42, cooldown: 1.3, speed: 3.1, shield: true },
];
const TOUCHES = 3, HEARTS = 4, ROUND = 300, NOEQ = { right: null, left: null };

export default function (g) {
  const { THREE } = g, kit = g.world.kit, combat = g.world.combat, Wp = g.world.weapons, K = g.k;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const cz = -4.5 * K; // where the opponent comes from (local z)
  g.pedestalAt(-1.2, 0.2); g.boardAt(-1.5, 1.75, -3.0);

  // ---- arena dressing: a ring of banner posts, and the red "he is winding up" marker
  const ab = g.builder();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, lx = Math.cos(a) * 5.2 * K, lz = cz * 0.55 + Math.sin(a) * 5.2 * K, w = g.at(lx, 0, lz), gy = g.ground(lx, lz) - g.y;
    ab.cyl(0.05, 0.07, 2.2, 0x6a4a2a, w.x - g.x, gy + 1.1, w.z - g.z, 6); ab.box(0.5, 0.7, 0.03, i % 2 ? 0xc03a3a : 0x3a5ac0, w.x - g.x + 0.27, gy + 1.8, w.z - g.z);
  }
  const posts = ab.mesh(); posts.position.set(g.x, g.y, g.z); posts.userData.noShadow = true; g.add(posts);
  const mark = g.add(g.mesh(g.geoCyl(0.0001, 0.11, 0.22, 12), 0xff2a1a, 0, 0, 0, { basic: true })); mark.rotation.x = Math.PI; mark.visible = false; mark.userData.noShadow = true;

  // ---- state
  let pBout = 0, lvl = 1, bout = -1, hearts = HEARTS, touchesOn = 0, touchesAgainst = 0, cur = null, wait = 0, parries = 0, blocks = 0, counters = 0, beaten = 0, flawless = 0, openUntil = -9, lastTouch = -9, playing = false, endT = -1, lostRun = false;
  const events = []; // raw log for tests
  const status = () => g.status(cur ? `${cur.spec.name} ${bout + 1}/${LADDER.length}  ${touchesOn}-${touchesAgainst}  hearts ${hearts}` : '');
  const chest = (out) => out.set(g.head.x, g.head.y - 0.3, g.head.z);

  function spawnBout() {
    if (cur) { try { cur.f.remove(); } catch (err) { /* gone */ } try { cur.npc.remove?.(); } catch (err) { /* gone */ } }
    bout++; touchesOn = touchesAgainst = pBout = 0;
    const spec = LADDER[bout]; if (!kit || !combat) { g.end({ score: g.score, detail: 'no combat engine' }); return; }
    const lvlK = 1 - 0.06 * (lvl - 1); // higher level: faster fencers
    const w = g.at(0, 0, cz, _a);
    const hold = spec.shield ? { right: 'sword', left: 'shield-spikes' } : { right: 'sword' };
    const npc = kit.humanoid(g.ctx, { x: w.x, z: w.z, yaw: g.yaw, height: spec.h, hp: 3 * 100, name: spec.name, gore: 'sparks', limbs: false, shirt: 0x7a2a2a, pants: 0x2a2a30, damageable: true,
      model: [spec.tint !== undefined ? { model: spec.model, tint: spec.tint, height: spec.h, hold, equip: NOEQ, weaponType: 'sword', gore: 'sparks', limbs: false } : { model: spec.model, height: spec.h, hold, equip: NOEQ, weaponType: 'sword', gore: 'sparks', limbs: false }] });
    if (!npc) { g.end({ score: g.score, detail: 'could not spawn the opponent' }); return; }
    const f = combat.fighter(g.ctx, npc, { faction: 'enemy', hp: 3 * 100, attack: 'melee', damage: 8, range: 1.7, windup: spec.windup * lvlK, cooldown: spec.cooldown * lvlK, speed: spec.speed, aggroRange: 60, leash: 90, wander: 0, name: spec.name, reserve: false });
    if (!f) { npc.remove?.(); g.end({ score: g.score, detail: 'no fighter budget' }); return; }
    cur = { spec, npc, f, over: false };
    g.round({ remove() { try { f.remove(); } catch (err) { /* gone */ } try { npc.remove?.(); } catch (err) { /* gone */ } } });
    const d = f.damage, prev = d.onHit;
    d.onHit = (e) => { try { prev?.(e); } catch (err) { /* ok */ } touchOn(cur, e); };
    g.float(g.at(0, 2.3, cz, _b), spec.name, 0xffe27a); g.sfx('bell', _b, 0.7); status();
  }
  function win(c) {
    if (c.over) return; c.over = true; beaten++; const base = 100 + 50 * bout, flaw = touchesAgainst === 0, at = c.npc.position;
    if (flaw) flawless++;
    events.push({ t: 'won', bout, base, flaw }); g.addScore(base, at, 'BEATEN +' + base, 0x7fe3a0);
    if (flaw) g.addScore(100, _b.copy(at).setY(at.y + 0.6), 'FLAWLESS +100', 0xffd23a);
    hearts = Math.min(HEARTS, hearts + 1); g.sfx('win'); g.note(`The player beat ${c.spec.name}, opponent ${bout + 1} of ${LADDER.length}, ${touchesAgainst} touches against.`, bout >= 3);
    if (bout >= LADDER.length - 1) endT = 2.5; else wait = 3.2;
    status();
  }
  function touchOn(c, e) { // the player's blade landed on the opponent
    if (!c || c !== cur || c.over || !playing || g.state !== 'play') return;
    if (e.from !== 'player' && e.from !== 'friendly') { c.f.damage.hp = (TOUCHES - touchesOn) * 100; return; }
    if (g.time - lastTouch < 0.55) { c.f.damage.hp = (TOUCHES - touchesOn) * 100; return; }
    lastTouch = g.time; touchesOn++;
    const counter = g.time < openUntil, pts = counter ? 55 : 15; if (counter) counters++;
    events.push({ t: 'touch', counter, pts });
    c.f.damage.hp = (TOUCHES - touchesOn) * 100;
    c.npc.staggerT = Math.max(c.npc.staggerT || 0, 0.45);
    g.addScore(pts, e.point ?? c.npc.position, counter ? 'COUNTER +' + pts : 'TOUCH +' + pts, counter ? 0xffd23a : undefined); g.pulse('both', 0.8, 90); g.sfx('clang', e.point, 1);
    if (touchesOn >= TOUCHES) { c.f.damage.hp = 0; win(c); }
    status();
  }
  const _g = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3();
  const bladeNear = (e) => { // an actively swung blade (grip -> tip) passing within 0.7 m of where the blow lands = a parry
    for (const hand of ['right', 'left']) {
      const w = Wp && Wp.held[hand]; if (!w || w.kind !== 'melee' || !(w.sp > 2.0) || !w.cur || !w.cur.length) continue;
      const hd = g.hands[hand === 'right' ? 1 : 0]; _g.copy(hd.pos); _t.copy(w.cur[w.cur.length - 1]); _d.subVectors(_t, _g);
      const l2 = _d.lengthSq() || 1e-6, u = clamp(_b.subVectors(e.point, _g).dot(_d) / l2, 0, 1);
      if (_b.copy(_g).addScaledVector(_d, u).distanceTo(e.point) < 0.7) return hand;
    }
    return null;
  };
  function onAttack(e) { // the opponent's blow lands on the player
    if (!cur || cur.over || !playing || g.state !== 'play' || e.attacker !== cur.f || !e.target || !e.target.isPlayer) return;
    let hand = null, how = 'block';
    if (e.blocked) hand = 'both'; else { hand = bladeNear(e); if (hand) { e.blocked = true; how = 'parry'; } }
    if (e.blocked) {
      if (how === 'parry') { parries++; pBout++; openUntil = g.time + 1.5; cur.npc.staggerT = 1.0; const pp = pBout <= 3 ? 15 : 0; events.push({ t: 'parry', pts: pp }); if (pp) g.addScore(pp, _b.copy(e.point), 'PARRY +' + pp, 0xffd23a); else g.float(_b.copy(e.point), 'PARRY', 0xffd23a); g.sfx('clang', e.point, 1); g.pulse(hand, 1, 100); }
      else { blocks++; cur.npc.staggerT = Math.max(cur.npc.staggerT || 0, 0.4); events.push({ t: 'block' }); g.float(_b.copy(e.point), 'blocked', 0xeceeff); }
      status(); return;
    }
    e.damage = 0; touchesAgainst++; hearts--; events.push({ t: 'hit' });
    g.float(_b.copy(e.point), 'touched', 0xff7a6b); g.sfx('miss', e.point, 0.8); g.pulse('both', 1, 120); status();
    if (touchesAgainst >= TOUCHES) { /* touches are per bout; hearts decide the run */ }
    if (hearts <= 0) { lostRun = true; endT = 1.6; cur.over = true; g.note(`The player lost the duel ladder to ${cur.spec.name}.`, false); }
  }
  const off = g.gctx.events?.on ? g.gctx.events.on('combat:attack', onAttack) : null;
  function giveGear() { if (!Wp || g.heldType('right') || g.heldType('left')) return; const s = g.give('sword'); if (s && s.held && g.gctx.input.presenting) g.give('shield', s.held === 'right' ? 'left' : 'right'); }

  return {
    reset(level) {
      lvl = level; bout = -1; hearts = HEARTS; touchesOn = touchesAgainst = 0; cur = null; wait = 0; parries = blocks = counters = beaten = flawless = 0; openUntil = lastTouch = -9; playing = false; endT = -1; lostRun = false; events.length = 0;
      mark.visible = false; g.status('');
    },
    play(level) {
      lvl = level; playing = true; g.setTime(ROUND); giveGear(); wait = 1.2; g.status('En garde!');
      g.every(2, () => { if (playing && !g.heldType('right') && !g.heldType('left') && !(Wp && Wp.list().some((w) => w.type === 'sword'))) giveGear(); });
    },
    update(dt) {
      if (endT >= 0) { endT -= dt; if (endT < 0) { playing = false; g.end({ score: g.score, detail: `${beaten}/${LADDER.length} beaten${flawless ? ', ' + flawless + ' flawless' : ''}, ${parries} parries` }); return; } }
      else if (!cur && wait > 0 || (cur && cur.over && wait > 0)) { wait -= dt; if (wait <= 0 && bout < LADDER.length - 1) spawnBout(); }
      if (cur && !cur.over && !cur.f.alive) win(cur);
      if (cur && !cur.over && cur.f.state === 1) { mark.visible = true; mark.position.copy(cur.npc.position); mark.position.y += cur.spec.h + 0.45 + Math.sin(g.time * 14) * 0.04; } else mark.visible = false;
      if (g.timeLeft <= 0) { playing = false; g.end({ score: g.score, detail: `${beaten}/${LADDER.length} beaten, time up` }); }
    },
    stop() { playing = false; cur = null; mark.visible = false; },
    dispose() { try { off?.(); } catch (err) { /* gone */ } },
    info: { events, LADDER, onAttack, touchOn, get cur() { return cur; }, get hearts() { return hearts; }, get touchesOn() { return touchesOn; }, get touchesAgainst() { return touchesAgainst; }, get bout() { return bout; }, get beaten() { return beaten; }, get parries() { return parries; }, get blocks() { return blocks; }, get counters() { return counters; }, get flawless() { return flawless; }, get lost() { return lostRun; } },
  };
}
