// library/bosses.js - the BOSS catalogue (docs/ENCOUNTERS.md). Installed from enemies.js through H.installBosses(lib); built on library/behaviors.js (H.behaviors = B).
// Every boss: 2-3 phases switched by hp thresholds (a roar / stagger beat with a flare), 3-5 telegraphed specials chosen by a director, a weak point or mechanic
// the player can exploit, adds inside the population budget, a one-quad world-space health bar (B.bossBar), the 'boss' music mood, spoken intro / last words,
// a spectacular death and hero-weapon loot. Bosses: lich-king ancient-dragon troll-king dark-champion demon-lord goblin-warlord stone-colossus hive-queen herald-of-the-other-sun.
export default function install(lib, H) {
  const B = H.behaviors;
  if (!B) return;
  const { THREE, rand, pick, clamp, TAU, ground, fightOpts } = H;
  const PI = Math.PI, FLIP = [PI, 0, 0];
  const { part, biped, worldAdd } = H;
  const head = H.head;
  const def = (name, description, options, aliases, build, extra) => lib.add({ name, category: 'enemies', description, options, aliases, build, ...extra });
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
  const C = () => H.combat(), K = () => H.kit();
  const isWater = (x, z) => { try { return !!H.ctx.world.env?.isWater?.(x, z); } catch (e) { return false; } };
  const CAST = (H.CAST && H.CAST.enemies) || {};

  // ================================================================== shared boss machinery
  // brain({ phases: [0.66, 0.33], moves: [{ id, mv, w, min, max, cd: [lo, hi], dist: [lo, hi], when(c) }], gap: [1.2, 2.2], title, intro, onPhase(c, n), takeMul(c, kind, point, amount, from) -> multiplier (0 = immune), tick(c, dt), onDeath(c), flare, roar })
  function brain(spec) {
    let started = false, next = 0, tmark = null;
    const tmv = {
      name: 'phase', noInterrupt: true, interruptible: false,
      begin(c) {
        const a = c.a, p = a.position; c.invuln = true; a.stop(); a.attackAnim(0.01, 'melee'); a.atkT = -1; B.clip(a, 'Taunt', { then: 'idle' });
        tmark = H.behaviors.tele.ring(p.x, p.z, 1, spec.flare ?? 0xffd060); if (tmark) tmark.k = 1;
        c.say(c.phase === 0 ? 'phase2' : 'phase3'); B.flare(spec.flare ?? 0xffd060, 1.2);
        H.sfx(H.ctx).tone({ freq: 60, freqEnd: 140, dur: spec.roar ?? 1.6, type: 'sawtooth', vol: 0.4, at: p });
        if (c.bar) c.bar.status = 'ENRAGED';
      },
      update(c, dt) {
        tmv.t += dt; const p = c.a.position, d = spec.roar ?? 1.6;
        if (tmark) { tmark.x = p.x; tmark.z = p.z; tmark.sx = tmark.sz = 1 + (tmv.t / d) * 7; tmark.alpha = 1 - tmv.t / d; }
        if (Math.random() < dt * 20) H.burst(H.ctx, 'glow', spec.flare ?? 0xffd060, _a.set(p.x + rand(-1, 1), p.y + rand(0.5, 2.5), p.z + rand(-1, 1)), 1, 1);
        return tmv.t >= d;
      },
      end(c) { if (tmark) H.behaviors.tele.free(tmark); tmark = null; c.invuln = false; c.phase++; if (c.bar) c.bar.status = ''; if (spec.onPhase) spec.onPhase(c, c.phase); },
    };
    return {
      id: 'boss', tmv,
      attach(c) {
        c.phase = 0; c.spec = spec; c.invuln = false; c.kids = []; c.dmgIn = 1;
        B.wrapDamage(c, (amt, k, pt, from) => { if (c.invuln || c.dead) return 0; let m = spec.takeMul ? spec.takeMul(c, k, pt, amt, from) : 1; return m * (c.stunMul && c.t < c.stunUntil ? c.stunMul : 1); });
        c.bar = B.bossBar(c, { name: spec.title, phases: (spec.phases ? spec.phases.length : 0) + 1, y: spec.barY });
        for (const m of spec.moves) m.at = 0;
      },
      think(c) {
        if (!c.hasT) return false;
        if (!started) { started = true; c.say('intro'); B.mood('boss'); B.flare(spec.flare ?? 0xffd060, 0.8); if (spec.onStart) spec.onStart(c); }
        if (spec.phases && c.phase < spec.phases.length && c.hpFrac() < spec.phases[c.phase]) return c.start(tmv, false);
        if (c.t < next || c.fleeing) return false;
        let tot = 0, pick_ = null;
        for (const m of spec.moves) {
          if (c.t < m.at || c.phase < (m.min ?? 0) || c.phase > (m.max ?? 9)) continue;
          const dl = m.dist ? m.dist[0] : 0, dh = m.dist ? m.dist[1] : 99; if (c.dist < dl || c.dist > dh) continue;
          if (m.when && !m.when(c)) continue;
          const w = typeof m.w === 'function' ? m.w(c) : (m.w ?? 1); tot += w; if (Math.random() * tot < w) pick_ = m;
        }
        if (!pick_) { next = c.t + 0.5; return false; }
        pick_.at = c.t + (pick_.cd ? rand(pick_.cd[0], pick_.cd[1]) : 6); next = c.t + rand(spec.gap ? spec.gap[0] : 1.2, spec.gap ? spec.gap[1] : 2.4);
        if (pick_.before) pick_.before(c);
        c.say(pick_.id); return c.start(pick_.mv, false);
      },
      tick(c, dt) {
        if (c.bar) c.bar.update();
        if (spec.tick) spec.tick(c, dt);
      },
      death(c) {
        B.mood(null); B.flare(spec.flare ?? 0xffd060, 1.6);
        if (spec.lastWords) B.lastWords(c.a, spec.lastWords);
        if (spec.onDeath) { try { spec.onDeath(c); } catch (e) { console.error('[bosses] onDeath failed', e); } }
        for (const h of c.kids) { try { if (h && !h.removed) for (const f of h.fighters) if (f.alive && f.damage) f.damage.hit(9999, f.actor.position, 'enemy', undefined, 'magic'); } catch (e) { /* gone */ } }
      },
    };
  }
  // adds: c.kids holds live handles; addAdds(c, 'goblin', n, { around: {x,z}, r, opts }) respects a cap
  function liveKids(c) { c.kids = c.kids.filter((h) => !h.removed && h.alive > 0); let n = 0; for (const h of c.kids) n += h.alive; return n; }
  function addAdds(c, name, n, o = {}) {
    const cap = o.cap ?? 6; n = Math.min(n, cap - liveKids(c)); const p = o.at || c.a.position; let made = 0;
    for (let k = 0; k < n; k++) {
      const ang = (k / Math.max(1, n)) * TAU + rand(0, 1), r = o.r ?? 4; let x = p.x + Math.cos(ang) * r, z = p.z + Math.sin(ang) * r; if (isWater(x, z)) { x = p.x; z = p.z + 3; }
      _a.set(x, ground(x, z) + 0.2, z); H.burst(H.ctx, 'glow', o.color ?? 0xffd060, _a, 12, 1.2, _b.set(0, 2, 0));
      const h = c.inst.sub(name, { ...(o.opts || {}), x, z, rise: true, yaw: Math.atan2(head.x - x, head.z - z), worldYaw: true }); if (h) { c.kids.push(h); made++; }
    }
    return made;
  }
  // a weak point: an invisible-or-glowing damageable sphere parented to `parent` at local (x, y, z). Returns { d, obj, alive, show(bool), reset() }
  function weakPoint(i, parent, o) {
    const b = H.mk(); b.mode('glow'); b.oct(0, 0, 0, o.size ?? 0.16, (o.size ?? 0.16) * 1.3, o.size ?? 0.16, o.color ?? 0x58ffb0); b.mode('beam'); b.sph(0, 0, 0, (o.size ?? 0.16) * 2, (o.size ?? 0.16) * 2, (o.size ?? 0.16) * 2, o.color ?? 0x58ffb0);
    const obj = b.build({ own: true }); obj.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0); obj.userData.noShadow = true;
    const w = { obj, alive: true, active: true };
    w.d = i.dmg(obj, { hp: o.hp ?? 60, radius: o.radius ?? 0.35, faction: 'enemy', flash: false,
      onHit: () => { H.burst(H.ctx, 'spark', o.color ?? 0x58ffb0, w.d.lastHit.point, 6, 0.8); },
      onDeath: () => { w.alive = false; obj.visible = false; w.d.alive = false; _a.setFromMatrixPosition(obj.matrixWorld); H.burst(H.ctx, 'glow', o.color ?? 0x58ffb0, _a, 20, 1.6); H.sfx(H.ctx).tone({ freq: 900, freqEnd: 120, dur: 0.5, type: 'triangle', vol: 0.3, at: _a }); if (o.onBreak) o.onBreak(w); } });
    // gating: only hittable while `active`
    const orig = w.d.hit; w.d.hit = (...args) => (w.active && w.alive ? orig(...args) : false);
    w.show = (v) => { w.active = v; obj.visible = v && w.alive; };
    w.reset = (hp) => { w.alive = true; w.d.alive = true; w.d.hp = w.d.maxHp = hp ?? w.d.maxHp; obj.visible = w.active; };
    w.pulse = (t) => { if (obj.visible) obj.scale.setScalar(1 + Math.sin(t * 6) * 0.12); };
    parent.add(obj); return w;
  }
  const fire = (c, from, dir, o = {}) => { const cb = C(); if (cb) return cb.fire({ origin: from, direction: dir, speed: o.speed ?? 10, damage: o.dmg ?? c.f.damageAmt, from: 'enemy', by: c.f, color: o.color ?? 0xa56bff, radius: o.radius ?? 0.24, splash: o.splash ?? 0.8, gravity: o.gravity ?? 0, kind: o.kind ?? 'magic', life: o.life ?? 4 }); return null; };
  // telegraphed ground strike at (x, z): disc fills for `T`, then a blast
  function groundStrike(c, x, z, r, dmg, T, o = {}) {
    const m = B.tele.disc(x, z, r, o.color ?? 0xa56bff); const t0 = { t: 0 };
    const step = () => {
      if (c.dead && !o.afterDeath) { B.tele.free(m); return; }
      t0.t += 0.05; if (m) m.k = Math.min(1, t0.t / T);
      if (t0.t < T) { B.after(0.05, step); return; }
      B.tele.free(m); _a.set(x, ground(x, z) + 0.7, z);
      B.aoe(c, _a, r, dmg, { kind: o.kind ?? 'magic', force: o.force ?? 4 }); H.burst(H.ctx, o.burst ?? 'glow', o.color ?? 0xa56bff, _a, 22, 1.8, _b.set(0, 3, 0)); H.burst(H.ctx, 'spark', 0xffffff, _a, 14, 1.2);
      H.sfx(H.ctx).tone({ freq: 160, freqEnd: 50, dur: 0.5, vol: 0.4, at: _a }); H.sfx(H.ctx).noise({ dur: 0.4, filter: { type: 'lowpass', freq: 900, freqEnd: 150 }, vol: 0.4, at: _a });
    };
    B.after(0.05, step);
  }
  // generic one-shot move: a telegraph/anim of `T` seconds, then fn(c) once
  function simpleMove(name, T, begin, strike, tail = 0.5) {
    const mv = { name, begin(c) { mv.did = false; c.a.stop(); begin(c, mv); }, update(c, dt) { mv.t += dt; if (!mv.did && mv.t >= T) { mv.did = true; strike(c, mv); } return mv.t >= T + tail; }, end(c) { if (mv.cleanup) mv.cleanup(c); } };
    return mv;
  }
  const baseLevelHp = (hp, o) => Math.round((o.hp ?? hp) * (o.hp ? 1 : B.hpScale(o.level)));
  const dmgOf = (d, o) => Math.round(d * B.dmgScale(o.level) * 10) / 10;
  const bossDrops = (...types) => types.map((t) => ({ type: t, chance: 1 }));

  // ================================================================== LICH KING  (weak point: the phylactery in its left hand; sever / break it to expose him)
  def('lich-king', 'BOSS: crowned skeletal sorcerer. Soul-bolt volleys (lanes show first), doom circles under you, raises the dead, a closing bone cage, blinks away. His phylactery (the glowing green orb in his left hand) halves your damage until you shatter it, which stuns him and severs the arm. 3 phases', 'hp, name, level', ['lich', 'skeleton king', 'undead king', 'lich lord'], (i, o) => {
    const title = o.name ?? 'LICH KING', hp = baseLevelHp(600, o);
    let orbs = null, spawnX = 0, spawnZ = 0;
    const r = biped(i, { ...o }, {
      model: CAST.lich, mgear: [['head', 'crown', 0xb89a50]], gore: 'bones', h: 2.7, bulk: 1.1, skin: 0xcfd6d0, shirt: 0x2a1a4a, pants: 0x1a1030, hp, dmg: dmgOf(8, o), attack: 'ranged', range: 18, cd: 2.4, windup: 0.9, speed: 2.0, aggro: 26, wander: 0,
      proj: { color: 0x7a5cff, speed: 9, radius: 0.24, splash: 0.9 },
      gear: [['head', 'skull'], ['head', 'crown', 0xb89a50], ['head', 'eyes', 0x58e6ff], ['pivot', 'robe', 0x2a1a4a], ['pivot', 'cape', 0x120a24], ['pivot', 'pauldrons', 0x3a2a5a], ['pivot', 'ribs']],
      weapon: 'skull-staff', wscale: 1.1, puff: 0x7a5cff, puffKind: 'glow', drops: bossDrops('void-scythe', 'bone-staff'),
      die: (a) => { const k = K(); for (let q = 0; q < 3; q++) k?.explosion(i.ctx, _a.set(a.position.x + rand(-1, 1), a.position.y + 1 + q * 0.6, a.position.z + rand(-1, 1)), { size: 2.0, color: 0x7a5cff }); i.snd().tone({ freq: 220, freqEnd: 30, dur: 2.0, type: 'sawtooth', vol: 0.3, at: a.position }); },
    });
    const a = r.a, f = r.f; if (!a) return;
    spawnX = a.position.x; spawnZ = a.position.z;
    // phylactery in the left hand
    const wp = weakPoint(i, a.pivot, { x: 0.5, y: 1.4, z: 0.3, size: 0.13, color: 0x58ffb0, radius: 0.34, hp: 70 * B.hpScale(o.level), onBreak: () => { orb.broken = true; c.bar && (c.bar.status = 'EXPOSED'); c.stunMul = 1.4; c.stun(3.5); try { a.sever && a.sever('armL'); } catch (e) { /* ok */ } B.flare(0x58ffb0, 0.8); } });
    const orb = { wp, broken: false };
    a.whenModel(() => { const h = a.mdl.h, bone = h.bones.handslotl || h.bones['handslot.l'] || h.bones.handl; if (bone) { bone.add(wp.obj); wp.obj.position.set(0, 0.25, 0); wp.obj.scale.setScalar(1 / (h.fit || 1)); } });
    // moves
    const sum = B.summoner({ n: 3, max: 6, kinds: ['skeleton', 'skeleton-archer'], opts: { variant: 'minion', reassembled: 1 }, corpses: true, tele: 1.3, cd: [1, 2], line: 'Arise!' });
    const blink = B.phase({ land: 8, tele: 0.9, angle: 1.6, min: 0, max: 99 });
    const volley = simpleMove('volley', 0.95, (c, mv) => { const p = c.a.position; mv.lanes = []; c.a.attackAnim(0.95, 'ranged'); B.clip(c.a, 'Spellcast_Raise', { then: 'idle' }); const n = c.phase >= 1 ? 5 : 3; mv.n = n; c.sense(); const base = Math.atan2(c.tp.x - p.x, c.tp.z - p.z); for (let q = 0; q < n; q++) { const yaw = base + (q - (n - 1) / 2) * 0.26; mv.lanes.push(B.tele.rect(p.x, p.z, yaw, 0.7, 16, 0xa56bff)); mv.lanes[q].yaw0 = yaw; } },
      (c, mv) => { c.muzzle(_c); const p = c.a.position; for (let q = 0; q < mv.n; q++) { const yaw = mv.lanes[q].yaw0; _d.set(Math.sin(yaw), (c.tp.y - _c.y) / Math.max(4, c.dist) * 0.8, Math.cos(yaw)); fire(c, _c, _d, { speed: 10, dmg: c.f.damageAmt * 0.9, color: 0x7a5cff }); } H.sfx(H.ctx).tone({ freq: 500, freqEnd: 200, dur: 0.3, type: 'sawtooth', vol: 0.2, at: p }); }, 0.4);
    const volleyUpd = volley.update; volley.update = (c, dt) => { for (const l of volley.lanes || []) if (l) { l.k = Math.min(1, volley.t / 0.95); l.x = c.a.position.x; l.z = c.a.position.z; } return volleyUpd(c, dt); }; volley.cleanup = (c) => { for (const l of volley.lanes || []) B.tele.free(l); volley.lanes = []; };
    const doom = simpleMove('doom', 0.5, (c) => { c.a.attackAnim(0.5, 'ranged'); B.clip(c.a, 'Spellcast_Long', { then: 'idle' }); }, (c) => {
      const n = 2 + c.phase; groundStrike(c, head.x, head.z, 2.5, c.f.damageAmt * 1.7, 1.7, { color: 0xa56bff });
      for (let q = 1; q < n; q++) { const ang = rand(0, TAU), d = rand(2.5, 5); groundStrike(c, head.x + Math.cos(ang) * d, head.z + Math.sin(ang) * d, 2.5, c.f.damageAmt * 1.7, 1.7 + q * 0.25, { color: 0xa56bff }); }
    }, 1.8);
    const cage = simpleMove('cage', 1.1, (c, mv) => { c.a.attackAnim(0.6, 'ranged'); B.clip(c.a, 'Spellcast_Long', { then: 'idle' }); mv.cx = head.x; mv.cz = head.z; mv.ms = []; for (let q = 0; q < 8; q++) { const ang = (q / 8) * TAU; mv.ms.push(B.tele.disc(mv.cx + Math.cos(ang) * 3.2, mv.cz + Math.sin(ang) * 3.2, 0.7, 0xd8d0b8)); } },
      (c, mv) => {
        for (const m of mv.ms) B.tele.free(m); mv.ms = [];
        for (let q = 0; q < 8; q++) {
          const ang = (q / 8) * TAU, x = mv.cx + Math.cos(ang) * 3.2, z = mv.cz + Math.sin(ang) * 3.2, b = H.mk(); b.cone(0, 0, 0, 0.32, 2.4, 0xe6dfc8, [0, 0, 0.12], 6); b.cone(0.15, 0, 0.1, 0.18, 1.4, 0xd8d0b8, [0, 0, -0.2], 5);
          const mesh = b.build({ own: true }); mesh.position.set(x, ground(x, z), z); worldAdd(i, mesh);
          const hh = K()?.destructible(i.ctx, mesh, { hp: 35, material: 'stone', faction: 'enemy', block: 0.5, pieces: 6 }); if (hh) { i.cleanup(() => hh.remove()); B.after(9, () => { if (!hh.broken && !hh.removed) hh.break(); }); }
          _a.set(x, ground(x, z) + 0.3, z); H.burst(H.ctx, 'bits', 0xe6dfc8, _a, 8, 1, _b.set(0, 3, 0));
        }
        H.sfx(H.ctx).noise({ dur: 0.5, filter: { type: 'lowpass', freq: 600, freqEnd: 120 }, vol: 0.5, at: _a }); c.lastCage = c.t;
      }, 0.5);
    const c = B.attach(i, a, f, [brain({
      title, phases: [0.66, 0.33], flare: 0x7a5cff, barY: a.height + 1,
      gap: [1.4, 2.6],
      moves: [{ id: 'volley', mv: volley, w: (c) => (c.t - (c.lastCage ?? -99) < 9 ? 5 : 3), cd: [3, 5] }, { id: 'doom', mv: doom, w: 2.5, cd: [6, 9] }, { id: 'raise', mv: sum.mv, w: 2, min: 1, cd: [14, 18], when: () => sum.living() < 4 },
        { id: 'cage', mv: cage, w: 1.5, min: 1, cd: [16, 22], dist: [0, 16] }, { id: 'blink', mv: blink.mv, w: 1.2, min: 2, cd: [9, 13], dist: [0, 14] }],
      takeMul: (c) => (orb.broken ? 1.1 : 0.4),
      onPhase: (c, n) => { addAdds(c, 'skeleton', 3, { cap: 6, color: 0x7affc8, opts: { variant: 'minion', reassembled: 1 } }); if (n === 2 && orb.broken) { wp.reset(90); wp.show(true); orb.broken = false; c.stunMul = 0; c.bar && (c.bar.status = 'PHYLACTERY REFORMED'); } },
      tick: (c) => { wp.pulse(c.t); if (!orb.broken && c.bar) c.bar.status = c.bar.status === 'ENRAGED' ? 'ENRAGED' : 'SHATTER THE GREEN ORB'; },
      onDeath: () => { wp.obj.visible = false; },
      lastWords: 'The Other Sun... will rise...',
    })], { name: 'lich-king', boss: true, armor: true, noTaunt: true,
      lines: { intro: ['I have waited an age for you.', 'Kneel, mortal!'], phase2: ['Arise, my legion!'], phase3: ['You cannot slay what is already dead!'], doom: ['Be still!'], cage: ['Bones, bind them!'], volley: ['Perish!'], blink: ['Too slow.'] } });
    c.bar.name = title;
  }, { size: 1.6, distance: 9 });

  // ================================================================== ANCIENT DRAGON  (weak points: the glowing wings while it is airborne)
  def('ancient-dragon', 'BOSS: colossal red dragon. Ground phase: bite, tail sweep (circle behind it), stomp, fire breath cone. At 66% it takes off: strafing fire lanes and meteors - strike a glowing WING to bring it crashing down. 33%: furious, wing buffet that shoves you and bodies, sweeping breath', 'hp, name, scale, level', ['elder dragon', 'big dragon', 'boss dragon', 'dragon boss', 'red dragon', 'fire dragon'], (i, o) => {
    const title = o.name ?? 'ANCIENT DRAGON', k = 2.3 * (o.scale ?? 1), hp = baseLevelHp(900, o), ks = k / 2.3;
    const prim = H.dragonRig({ k, c1: 0x7a1a14, c2: 0x4a0f0c, belly: 0xc89a50, spike: 0x2a1a14, horn: 0x1a1210, eye: 0xffa020, wing: 0x5a1a2a });
    const isModel = !!H.cast(CAST.dragon);
    const m = H.monster(i, {
      rig: isModel ? H.modelRig(H.modelList(CAST.dragon, { scale: k / 2.3 }), prim) : prim,
      height: 2.6 * k * 0.9, radius: 1.6 * k * 0.9, centerY: 0.9 * k, hover: 0, bob: 0.05, bobF: 1.3, speed: 2.4, stride: 1.6, hp, death: isModel ? 'none' : 'collapse', lifeAfter: 6, eyeH: 2.8 * k * 0.5, knock: 0.05, labelSize: 0.2,
      fight: fightOpts(o, { damage: dmgOf(15, o), range: 4.6 * ks, cooldown: 3.0, windup: 1.0, aggroRange: 28, speed: 2.4, wander: 0, leash: 60, drops: bossDrops('storm-hammer', 'ember-staff') }),
      onDie: (a) => { const kk = K(); for (let q = 0; q < 4; q++) kk?.explosion(i.ctx, _a.set(a.position.x + rand(-3, 3), a.position.y + rand(1, 4), a.position.z + rand(-3, 3)), { size: 2.4, color: 0xff6a1a }); i.snd().tone({ freq: 180, freqEnd: 25, dur: 3, type: 'sawtooth', vol: 0.4, at: a.position }); },
    });
    const a = m.actor, f = m.fighter; if (!a) return;
    const setFly = (on) => { const M = a.mdl; if (M && M.ready && M.clip) { if (on) { M.clip._i = M.clip.idle; M.clip._w = M.clip.walk; if (M.clip.fly) M.clip.idle = M.clip.walk = M.clip.fly; } else if (M.clip._i !== undefined) { M.clip.idle = M.clip._i; M.clip.walk = M.clip._w; } M.state = null; } };
    const wings = [-1, 1].map((s) => weakPoint(i, a.pivot, { x: 1.4 * k * s, y: 1.0 * k, z: -0.3 * k, size: 0.2 * k, color: 0xff9a30, radius: 0.8 * k, hp: 85 * B.hpScale(o.level), onBreak: () => { if (c.air && !c.move) { c.crashNow = true; } else if (c.air) c.crashNow = true; } }));
    for (const w of wings) w.show(false);
    const mouth = (out) => { if (a.rig && a.rig.mouth && a.mdl && a.mdl.ready) return a.rig.mouth(out); const p = a.position; return out.set(p.x + Math.sin(a.yaw) * 2.4 * k, p.y + 1.55 * k + a.hover, p.z + Math.cos(a.yaw) * 2.4 * k); };
    const stomp = B.stomper({ radius: 7 * ks, tele: 1.2, dmg: 1.0, color: 0xff7a20, cd: [8, 12] });
    const breath = B.breathMove({ tele: 1.5, dur: 2.0, len: 15 * ks, half: 3.2 * ks, dmg: 0.4, color: 0xff5a1a, zone: 3 });
    const breathSweep = B.breathMove({ tele: 1.4, dur: 2.6, len: 15 * ks, half: 3.2 * ks, dmg: 0.4, color: 0xff5a1a, sweep: 1.8, zone: 3 });
    const strafe = B.strafer({ tele: 1.0, speed: 11, entry: 18, offset: 3.5 });
    const tail = simpleMove('tail', 1.1, (c, mv) => { const p = c.a.position; mv.cx = p.x - Math.sin(c.a.yaw) * 3.2 * ks; mv.cz = p.z - Math.cos(c.a.yaw) * 3.2 * ks; mv.m = B.tele.disc(mv.cx, mv.cz, 5 * ks, 0xff8a30); c.a.attackAnim(1.1, 'melee'); },
      (c, mv) => { _a.set(mv.cx, ground(mv.cx, mv.cz) + 0.6, mv.cz); B.aoe(c, _a, 5 * ks, c.f.damageAmt * 1.0, { kind: 'blunt', force: 8 }); H.burst(H.ctx, 'puff', 0x8a7a68, _a, 18, 2); H.sfx(H.ctx).tone({ freq: 90, freqEnd: 40, dur: 0.5, vol: 0.45, at: _a }); }, 0.5);
    tail.cleanup = () => { if (tail.m) B.tele.free(tail.m); tail.m = null; };
    const tailUpd = tail.update; tail.update = (c, dt) => { if (tail.m) tail.m.k = Math.min(1, tail.t / 1.1); return tailUpd(c, dt); };
    const buffet = simpleMove('buffet', 1.0, (c, mv) => { const p = c.a.position; c.sense(); mv.yaw = c.hasT ? Math.atan2(c.tp.x - p.x, c.tp.z - p.z) : c.a.yaw; mv.m = B.tele.wedge(p.x, p.z, mv.yaw, 5 * ks, 10 * ks, 0x9ad0ff); c.a.faceTo(c.tp, 1); c.a.attackAnim(1.0, 'ranged'); },
      (c, mv) => {
        const p = c.a.position, dx = head.x - p.x, dz = head.z - p.z, d = Math.hypot(dx, dz), cs = (dx * Math.sin(mv.yaw) + dz * Math.cos(mv.yaw)) / (d || 1);
        _a.set(p.x + Math.sin(mv.yaw) * 4 * ks, p.y + 1, p.z + Math.cos(mv.yaw) * 4 * ks);
        if (d < 10 * ks && cs > 0.5 && B.playerUp()) { B.aoe(c, _a, 3 * ks, c.f.damageAmt * 0.5, { kind: 'blunt', force: 3 }); B.shove(p.x, p.z, 6, 1.5); }
        const Py = H.ctx.world.physics; if (Py && Py.explode) Py.explode(_a, 8 * ks, 40);
        H.burst(H.ctx, 'puff', 0xc8c0a8, _a, 30, 3, _b.set(Math.sin(mv.yaw) * 10, 1, Math.cos(mv.yaw) * 10)); H.sfx(H.ctx).noise({ dur: 0.9, filter: { type: 'bandpass', freq: 400, freqEnd: 900 }, vol: 0.5, at: p });
      }, 0.6);
    buffet.cleanup = () => { if (buffet.m) B.tele.free(buffet.m); buffet.m = null; };
    const bu = buffet.update; buffet.update = (c, dt) => { if (buffet.m) buffet.m.k = Math.min(1, buffet.t); return bu(c, dt); };
    const takeoff = { name: 'takeoff', noInterrupt: true, interruptible: false, begin(c) { a.stop(); a.flying = true; c.say('takeoff'); setFly(true); H.sfx(H.ctx).tone({ freq: 80, freqEnd: 160, dur: 1.5, type: 'sawtooth', vol: 0.4, at: a.position }); H.burst(H.ctx, 'puff', 0xa89880, _a.set(a.position.x, a.position.y + 0.5, a.position.z), 24, 3); },
      update(c, dt) { a.hover += (8 - a.hover) * Math.min(1, dt * 1.6); if (Math.random() < dt * 20) H.burst(H.ctx, 'puff', 0xa89880, _a.set(a.position.x + rand(-3, 3), a.position.y + 0.3, a.position.z + rand(-3, 3)), 1, 1.5); return a.hover > 7.4; },
      end(c) { c.air = true; c.airT = c.t; c.wantAir = false; for (const w of wings) { if (!w.alive) w.reset(); w.show(true); } if (c.bar) c.bar.status = 'STRIKE A WING'; } };
    const land = { name: 'land', noInterrupt: true, interruptible: false, begin(c) { a.stop(); },
      update(c, dt) { a.hover += (0 - a.hover) * Math.min(1, dt * (c.crashNow ? 3.5 : 2)); return a.hover < 0.25; },
      end(c) { a.hover = 0; a.flying = false; setFly(false); const crash = c.crashNow; c.crashNow = false; c.air = false; for (const w of wings) w.show(false);
        _a.set(a.position.x, ground(a.position.x, a.position.z) + 0.5, a.position.z); B.aoe(c, _a, (crash ? 8 : 6) * ks, c.f.damageAmt * (crash ? 1.1 : 0.7), { kind: 'blunt', force: 8 }); H.burst(H.ctx, 'puff', 0x8a7a68, _a, 30, 3); K()?.explosion(i.ctx, _a, { size: 1.8, color: 0xff8a30 }); H.sfx(H.ctx).tone({ freq: 60, freqEnd: 25, dur: 0.8, vol: 0.6, at: _a });
        c.stunMul = crash ? 1.6 : 1; c.stun(crash ? 5.5 : 2); if (c.bar) c.bar.status = crash ? 'GROUNDED!' : ''; } };
    const meteors = simpleMove('meteors', 0.9, (c) => { c.a.stop(); B.clip(a, 'Taunt', { then: 'idle' }); c.a.attackAnim(0.9, 'ranged'); }, (c) => {
      for (let q = 0; q < 5; q++) { const ang = rand(0, TAU), d = q === 0 ? 0 : rand(2.5, 7), x = head.x + Math.cos(ang) * d, z = head.z + Math.sin(ang) * d; _d.set(x + rand(-6, 6), ground(x, z) + 28, z + rand(-6, 6));
        B.lob(c, { from: _d, to: { x, z }, flight: 1.6 + q * 0.18, arc: 0.5, size: 0.7, color: 0xff6a20, trail: 0xff9a40, marker: { r: 2.6, color: 0xff4a10 }, onLand: (cc, pt) => { _a.set(pt.x, pt.y + 0.5, pt.z); K()?.explosion(i.ctx, _a, { size: 1.9, color: 0xff6a20 }); B.aoe(cc, _a, 2.6, cc.f.damageAmt * 0.8, { kind: 'explosion', force: 7 }); B.zones.add(cc, { x: pt.x, z: pt.z, r: 2.0, ttl: 4, kind: 'fire', dps: 3 }); } }); }
    }, 0.8);
    const c = B.attach(i, a, f, [brain({
      title, phases: [0.66, 0.33], flare: 0xff6a20, barY: 3.2 * k * 0.9 + 1, roar: 1.8, gap: [1.6, 2.8],
      moves: [
        { id: 'takeoff', mv: takeoff, w: 100, when: (c) => c.wantAir && !c.air && c.phase === 1 },
        { id: 'land', mv: land, w: 100, when: (c) => c.air && (c.crashNow || c.phase >= 2 || c.t - c.airT > 26), cd: [0, 0] },
        { id: 'tail', mv: tail, w: 3, cd: [6, 9], when: (c) => !c.air && c.dist < 9 * ks },
        { id: 'stomp', mv: stomp.mv, w: 2, cd: [9, 13], when: (c) => !c.air && c.dist < 9 * ks },
        { id: 'breath', mv: breath, w: 3, cd: [8, 11], dist: [5, 22], when: (c) => !c.air },
        { id: 'buffet', mv: buffet, w: 2.5, min: 2, cd: [9, 12], when: (c) => !c.air && c.dist < 11 * ks },
        { id: 'sweep', mv: breathSweep, w: 2, min: 2, cd: [12, 16], dist: [5, 22], when: (c) => !c.air },
        { id: 'strafe', mv: strafe.mv, w: 4, min: 1, max: 1, cd: [5, 7], when: (c) => c.air },
        { id: 'meteors', mv: meteors, w: 2.5, min: 1, max: 1, cd: [11, 14], when: (c) => c.air },
      ],
      takeMul: (c, kd) => (c.air ? 0.45 : 1),
      onPhase: (c, n) => { if (n === 1) c.wantAir = true; if (n === 2) { c.wantAir = false; } if (n === 2) B.flare(0xff4a10, 1.4); },
      tick: (c, dt) => {
        for (const w of wings) { w.pulse(c.t); if (!w.alive && c.air && !c.crashNow) { /* onBreak flags the crash */ } }
        if (c.air && c.crashNow && c.move && c.move.name !== 'land') { /* let the current move end; the director then lands */ }
        if (c.air && c.crashNow && !c.move && c.f.state === 0) c.start(land, false);
        if (c.air && !c.move) a.hover += (8 - a.hover) * Math.min(1, dt * 1.5);
      },
      lastWords: 'Ash... and ember... all ends...',
    })], { name: 'ancient-dragon', boss: true, armor: true, noTaunt: true, talk: true, lines: { intro: ['Who dares wake the Ancient One?'], phase2: ['Behold the sky, and despair!'], phase3: ['I will burn this world to glass!'], takeoff: ['Look up, little one!'] } });
    c.mouth = mouth; c.flags.aquatic = false;
  }, { size: 3.5, distance: 14 });

  // shared by several bosses: a meteor shower (sky lobs with landing circles)
  function meteorMove(name, n, rad, dmgK, T = 0.9) {
    return simpleMove(name, T, (c) => { c.a.stop(); B.clip(c.a, 'Taunt', { then: 'idle' }); c.a.attackAnim(T, 'ranged'); }, (c) => {
      for (let q = 0; q < n; q++) {
        const ang = rand(0, TAU), d = q === 0 ? 0 : rand(2.5, 8), x = head.x + Math.cos(ang) * d, z = head.z + Math.sin(ang) * d; _d.set(x + rand(-6, 6), ground(x, z) + 26, z + rand(-6, 6));
        B.lob(c, { from: _d, to: { x, z }, flight: 1.5 + q * 0.2, arc: 0.4, size: 0.6, color: 0xff6a20, trail: 0xff9a40, marker: { r: rad, color: 0xff4a10 },
          onLand: (cc, pt) => { _a.set(pt.x, pt.y + 0.5, pt.z); K()?.explosion(H.ctx, _a, { size: 1.8, color: 0xff6a20 }); B.aoe(cc, _a, rad, cc.f.damageAmt * dmgK, { kind: 'explosion', force: 7 }); B.zones.add(cc, { x: pt.x, z: pt.z, r: rad * 0.7, ttl: 4, kind: 'fire', dps: 3 }); } });
      }
    }, 0.8);
  }
  function rockSpire(i, x, z, h, hp) {
    const b = H.mk(); b.cone(0, 0, 0, h * 0.28, h, 0x6a645a, 0, 6); b.cone(h * 0.2, 0, 0.1, h * 0.16, h * 0.62, 0x7a746a, [0, 0, -0.15], 5); b.cone(-h * 0.18, 0, -0.1, h * 0.14, h * 0.5, 0x5a544a, [0, 0, 0.18], 5);
    const mesh = b.build({ own: true }); mesh.position.set(x, ground(x, z), z); worldAdd(i, mesh);
    const hh = K()?.destructible(i.ctx, mesh, { hp, material: 'stone', faction: 'enemy', block: h * 0.28, pieces: 8 }); if (hh) i.cleanup(() => hh.remove());
    return { h: hh, x, z, mesh };
  }

  // ================================================================== TROLL KING  (mechanic: lure his charge into one of his own stalagmites)
  def('troll-king', 'BOSS: crowned troll chieftain in a ring of stalagmites. Boulder volleys, ground slams, a telegraphed CHARGE - stand behind a stalagmite so he rams it: he is impaled, stunned and takes double damage. Regenerates unless burned or kept busy; calls goblins; grab-and-toss up close. 3 phases', 'hp, name, level', ['troll chief', 'troll chieftain', 'cave king', 'king troll'], (i, o) => {
    const title = o.name ?? 'TROLL KING', hp = baseLevelHp(800, o);
    const cast = [{ model: 'troll', rig: 'kaykit-medium', height: 4.4, tint: 0xb8c8a0, hold: { right: 'great-axe' }, weaponType: 'axe' }, { model: 'orc', rig: 'kenney-mini', tint: 0xb4c2a6, height: 4.4, bulk: 1.3, hold: { right: 'great-axe' }, weaponType: 'axe' }];
    const r = biped(i, { ...o }, { model: cast, mgear: [['head', 'crown', 0xd9a93c]], h: 4.2, bulk: 1.5, skin: 0x7d8a6a, shirt: 0x6a5a40, pants: 0x4a4030, hair: 0x2a3020, hp, dmg: dmgOf(14, o), range: 3.2, cd: 2.7, windup: 1.0, speed: 2.2, aggro: 28, wander: 0,
      gear: [['head', 'tusks', 0xd8d0b0], ['head', 'crown', 0xd9a93c], ['pivot', 'loincloth', 0x6a4a2a]], weapon: 'spiked-club', wscale: 2, puff: 0x7d8a6a, drops: bossDrops('storm-hammer', 'great-axe'),
      die: (a) => { for (let q = 0; q < 3; q++) K()?.explosion(i.ctx, _a.set(a.position.x + rand(-1.5, 1.5), a.position.y + 1 + q, a.position.z + rand(-1.5, 1.5)), { size: 2.0, color: 0x9aff6a }); i.snd().tone({ freq: 90, freqEnd: 25, dur: 2.5, type: 'sawtooth', vol: 0.4, at: a.position }); } });
    const a = r.a, f = r.f; if (!a) return;
    const rocks = []; const sx = a.position.x, sz = a.position.z;
    for (let q = 0; q < 6; q++) { const ang = (q / 6) * TAU + 0.4, d = rand(8, 12), x = sx + Math.cos(ang) * d, z = sz + Math.sin(ang) * d; if (!isWater(x, z)) rocks.push(rockSpire(i, x, z, rand(3, 4.2), 90)); }
    const charge = B.charger({ tele: 1.15, len: 16, speed: 10, width: 1.6, min: 6, max: 20, dmg: 1.2, stun: 4.2, force: 10 });
    const slam = B.stomper({ radius: 6.5, tele: 1.3, dmg: 1.2, color: 0xffa030 });
    const toss = B.toss({ tele: 1.1, reach: 3.6 });
    const boulder = B.thrower({ min: 6, max: 22, windup: 1.0, flight: 1.5, radius: 2.6, dmg: 1.0, size: 0.6, color: 0x7a6a58, trail: 0x8a7a68, boom: 0, boomColor: 0x8a7a68, kind: 'blunt', force: 8 });
    const volley = simpleMove('boulders', 1.0, (c) => { c.a.attackAnim(1.0, 'ranged'); B.clip(c.a, 'Throw', { then: 'idle', speed: 0.8 }); }, (c) => {
      c.muzzle(_d); c.sense(); const n = c.phase >= 1 ? 3 : 2;
      for (let q = 0; q < n; q++) { const ang = rand(0, TAU), dd = q === 0 ? 0 : rand(2, 5); B.lob(c, { from: _d, to: { x: head.x + c.tv.x * 0.8 + Math.cos(ang) * dd, z: head.z + c.tv.z * 0.8 + Math.sin(ang) * dd }, flight: 1.5 + q * 0.25, arc: 5, size: 0.6, color: 0x7a6a58, trail: 0x8a7a68, marker: { r: 2.5, color: 0xff7a20 },
        onLand: (cc, pt) => { _a.set(pt.x, pt.y + 0.4, pt.z); B.aoe(cc, _a, 2.5, cc.f.damageAmt * 0.9, { kind: 'blunt', force: 8 }); H.burst(H.ctx, 'puff', 0x8a7a68, _a, 16, 1.6); H.sfx(H.ctx).noise({ dur: 0.3, filter: { type: 'lowpass', freq: 600, freqEnd: 120 }, vol: 0.4, at: _a }); } }); }
    }, 0.6);
    const call = simpleMove('adds', 1.3, (c) => { c.a.stop(); B.clip(c.a, 'Taunt', { then: 'idle' }); c.a.attackAnim(0.01, 'melee'); c.a.atkT = -1; }, (c) => { addAdds(c, 'goblin', 3, { cap: 6, color: 0x9aff6a, r: 5 }); if (c.phase >= 2) addAdds(c, 'orc-brute', 1, { cap: 7, r: 6 }); }, 0.5);
    const rockfall = simpleMove('rockfall', 0.8, (c) => { c.a.attackAnim(0.8, 'ranged'); B.clip(c.a, 'Taunt', { then: 'idle' }); }, (c) => { for (let q = 0; q < 6; q++) { const ang = rand(0, TAU), d = q === 0 ? 0 : rand(2, 7); groundStrike(c, head.x + Math.cos(ang) * d, head.z + Math.sin(ang) * d, 2.0, c.f.damageAmt * 0.8, 1.3 + q * 0.15, { color: 0xffa030, kind: 'blunt', burst: 'puff' }); } }, 1.8);
    const c = B.attach(i, a, f, [brain({
      title, phases: [0.66, 0.33], flare: 0x9aff6a, barY: a.height + 1, gap: [1.5, 2.6],
      moves: [{ id: 'charge', mv: charge.mv, w: 4, cd: [7, 10] }, { id: 'slam', mv: slam.mv, w: 2.5, cd: [8, 11], when: (c) => c.edge < 6 }, { id: 'boulders', mv: volley, w: 3, cd: [6, 9], dist: [6, 24] },
        { id: 'adds', mv: call, w: 2, min: 1, cd: [22, 28], when: (c) => liveKids(c) < 2 }, { id: 'toss', mv: toss.mv, w: 4, cd: [9, 12], when: (c) => c.edge < 3.6 && c.tIsPlayer }, { id: 'rockfall', mv: rockfall, w: 2.5, min: 2, cd: [10, 14] }],
      takeMul: () => 1,
      onPhase: (c, n) => { c.speedMul *= 1.15; c.speed(1); if (n === 2) c.f.damageAmt *= 1.2; },
      tick: (c) => {
        if (!c.stunMul) c.stunMul = 1.9;
        if (c.stunUntil > c.t && !c.impaled) { c.impaled = true; let best = null, bd = 6; for (const rk of rocks) { if (!rk.h || rk.h.broken) continue; const d = Math.hypot(rk.x - a.position.x, rk.z - a.position.z); if (d < bd) { bd = d; best = rk; } } if (best) { best.h.break(_a.set(Math.sin(a.yaw), 0.3, Math.cos(a.yaw))); if (c.bar) c.bar.status = 'IMPALED!'; B.flare(0x9aff6a, 0.6); } }
        if (c.stunUntil <= c.t && c.impaled) { c.impaled = false; if (c.bar && c.bar.status === 'IMPALED!') c.bar.status = ''; }
      },
      lastWords: 'Troll... king... falls...',
    }), B.regenerator({ rate: 0.012, delay: 4, burnFor: 8 })], { name: 'troll-king', boss: true, armor: true, noTaunt: true,
      lines: { intro: ['Who dares walk into my halls?', 'Troll king crush you!'], phase2: ['You hurt Troll King! GRAAH!'], phase3: ['KING ANGRY!'], charge: ['CHARGE!'], toss: ['Come here, little one!'], boulders: ['Rocks!'], adds: ['Goblins! Get him!'] } });
  }, { size: 3, distance: 12 });

  // ================================================================== THE DARK CHAMPION  (mechanic: reflect his dark bolt with a shield or a swing; shield drops in phase 2)
  const orbs = (H.S.enc.orbs ??= []);
  function reflectOrb(p, c) {
    if (!p.on || p.reflected) return; p.reflected = true; const cb = C();
    _a.set(p.x, p.y, p.z); const ap = c.a.position; _b.set(ap.x, ap.y + 1.6, ap.z);
    const dist = _a.distanceTo(_b); p.on = false;
    if (cb) cb.fire({ origin: _a, direction: _c.copy(_b).sub(_a), speed: 16, damage: 0, from: 'friendly', color: 0xffd060, radius: 0.34, splash: 0.2, kind: 'magic', life: 3 });
    H.sfx(H.ctx).tone({ freq: 1200, freqEnd: 500, dur: 0.3, type: 'triangle', vol: 0.3, at: _a }); B.flare(0xffd060, 0.5);
    B.after(dist / 16, () => { if (c.dead) return; const d = c.f.damage; d.hit(c.f.maxHp * 0.07, ap, 'player', undefined, 'magic'); c.stunMul = 1.6; c.stun(3); if (c.bar) c.bar.status = 'REFLECTED!'; B.after(3.2, () => { if (c.bar && c.bar.status === 'REFLECTED!') c.bar.status = ''; }); });
  }
  def('dark-champion', 'BOSS: the dark knight made flesh - a towering duelist. Shield and parry stance (gold ring: do not strike into it), 3-hit sword combos, dash strikes, spectral blades, and a slow DARK BOLT you can REFLECT by blocking it with a shield or swatting it with a fast swing: it staggers him. Drops his shield at 60%. 3 phases', 'hp, name, level', ['black champion', 'dark knight champion', 'death knight', 'champion of darkness'], (i, o) => {
    const title = o.name ?? 'THE DARK CHAMPION', hp = baseLevelHp(700, o);
    const cast = [{ model: 'dark-knight', rig: 'kaykit-medium', height: 2.9, hold: { right: 'greatsword', left: 'shield-spikes' }, equip: { right: null, left: null }, weaponType: 'greatsword' }, { model: 'knight', tint: 0x2c2c38, height: 2.8, bulk: 1.2, hold: { right: 'greatsword', left: 'shield-spikes' }, equip: { right: null, left: null }, weaponType: 'greatsword' }];
    const r = biped(i, { ...o }, { model: cast, h: 2.8, bulk: 1.2, skin: 0x2a2a30, shirt: 0x23232b, pants: 0x1c1c22, hp, dmg: dmgOf(12, o), range: 2.6, cd: 2.3, windup: 0.8, speed: 2.6, aggro: 28, wander: 0,
      gear: [['head', 'greatHelm', 0x2a2a32, 0xff3a2a], ['pivot', 'cape', 0x3a0f16], ['pivot', 'pauldrons', 0x2a2a34], ['pivot', 'armor', 0x23232b]], weapon: 'greatsword', wscale: 1.4, puff: 0x40404a, drops: bossDrops('omni-blade', 'aegis-shield'),
      die: (a) => { K()?.explosion(i.ctx, _a.set(a.position.x, a.position.y + 1.5, a.position.z), { size: 2.2, color: 0x8a2aff }); i.snd().tone({ freq: 300, freqEnd: 40, dur: 2, type: 'sawtooth', vol: 0.3, at: a.position }); } });
    const a = r.a, f = r.f; if (!a) return;
    const sh = B.shield({ arc: 2.2, hp: 90, down: 5, stagger: 1.5 });
    const parry = B.parry({ window: 1.6, reach: 7, cd: [6, 9], ripWindup: 0.45 });
    const dash = B.charger({ tele: 0.8, len: 10, speed: 12, width: 1.1, min: 3.5, max: 13, dmg: 1.2, selfStun: false, breaks: false, force: 8 });
    let swings = 0;
    const combo = { name: 'combo', stage: 0, st: 0, m: null,
      begin(c) { combo.stage = 0; combo.st = 0; combo.struck = false; c.a.stop(); },
      update(c, dt) {
        const aa = c.a, p = aa.position; combo.st += dt; const W = Math.max(0.5, 0.7 * (c.phase >= 2 ? 0.8 : 1));
        if (combo.st < 0.001 + dt && !combo.m) { c.sense(); if (c.hasT) aa.faceTo(c.tp, 0.3); aa.attackAnim(W, 'melee'); combo.m = B.tele.wedge(p.x, p.z, aa.yaw, 1.7, 3.8, 0xff3a2a); combo.struck = false; B.clip(aa, combo.stage === 1 ? '2H_Melee_Attack_Slice' : '2H_Melee_Attack_Chop', { then: 'idle', speed: 1 }); }
        if (combo.m) { combo.m.k = Math.min(1, combo.st / W); combo.m.x = p.x; combo.m.z = p.z; if (combo.st < W * 0.6) { c.sense(); if (c.hasT) { aa.faceTo(c.tp, 0.2); combo.m.yaw = aa.yaw; } } }
        if (!combo.struck && combo.st >= W) { combo.struck = true; _a.set(p.x + Math.sin(aa.yaw) * 2, p.y + 1, p.z + Math.cos(aa.yaw) * 2); B.aoe(c, _a, 1.9, c.f.damageAmt * 0.95, { kind: 'slash', force: 4 }); H.burst(H.ctx, 'spark', 0xffffff, _a, 10, 1); H.sfx(H.ctx).noise({ dur: 0.2, filter: { type: 'bandpass', freq: 1500, freqEnd: 400 }, vol: 0.3, at: p }); }
        if (combo.st >= W + 0.3) { B.tele.free(combo.m); combo.m = null; combo.stage++; combo.st = 0; if (combo.stage >= 3) return true; c.sense(); if (c.hasT && c.dist > 2.2) aa.walkTo(p.x + c.ux * 1.6, p.z + c.uz * 1.6); }
        return false;
      }, end(c) { if (combo.m) B.tele.free(combo.m); combo.m = null; } };
    const bolt = simpleMove('bolt', 1.3, (c, mv) => { c.a.attackAnim(1.3, 'ranged'); B.clip(c.a, 'Spellcast_Raise', { then: 'idle' }); c.sense(); mv.m = B.tele.rect(c.a.position.x, c.a.position.z, Math.atan2(c.tp.x - c.a.position.x, c.tp.z - c.a.position.z), 0.8, 18, 0x8a2aff); c.bar && (c.bar.status = 'REFLECT THE BOLT'); },
      (c, mv) => { c.muzzle(_c); c.sense(); _d.set(c.tp.x - _c.x, c.tp.y - _c.y - 0.2, c.tp.z - _c.z); const p = fire(c, _c, _d, { speed: 7.5, dmg: c.f.damageAmt * 1.2, color: 0x8a2aff, radius: 0.34, splash: 0.5, life: 6 }); if (p) { p.tag = 'orb'; p.reflected = false; p.owner = c; orbs.push(p); } }, 0.4);
    const bu = bolt.update; bolt.update = (c, dt) => { if (bolt.m) { bolt.m.k = Math.min(1, bolt.t / 1.3); bolt.m.x = c.a.position.x; bolt.m.z = c.a.position.z; } return bu(c, dt); }; bolt.cleanup = (c) => { if (bolt.m) B.tele.free(bolt.m); bolt.m = null; if (c.bar && c.bar.status === 'REFLECT THE BOLT') B.after(3, () => { if (c.bar.status === 'REFLECT THE BOLT') c.bar.status = ''; }); };
    const blades = simpleMove('blades', 0.9, (c, mv) => { c.a.stop(); B.clip(c.a, 'Spellcast_Summon', { then: 'idle' }); c.a.attackAnim(0.9, 'ranged'); mv.ms = []; for (let q = 0; q < 5; q++) { const ang = (q / 5) * TAU, p = c.a.position; mv.ms.push(B.tele.disc(p.x + Math.cos(ang) * 2.6, p.z + Math.sin(ang) * 2.6, 0.5, 0xb06aff)); } },
      (c, mv) => { for (const m of mv.ms) B.tele.free(m); mv.ms = []; for (let q = 0; q < 5; q++) B.after(0.35 * q + 0.3, () => { if (c.dead) return; const ang = (q / 5) * TAU, p = c.a.position; _c.set(p.x + Math.cos(ang) * 2.6, p.y + 1.6, p.z + Math.sin(ang) * 2.6); H.burst(H.ctx, 'glow', 0xb06aff, _c, 8, 0.8); _d.set(head.x - _c.x, head.y - 0.4 - _c.y, head.z - _c.z); fire(c, _c, _d, { speed: 11, dmg: c.f.damageAmt * 0.5, color: 0xd8b0ff, radius: 0.16, splash: 0.3, kind: 'slash', life: 3 }); H.sfx(H.ctx).tone({ freq: 1400, freqEnd: 900, dur: 0.12, type: 'sawtooth', vol: 0.12, at: _c }); }); }, 1.9);
    blades.cleanup = () => { for (const m of blades.ms || []) B.tele.free(m); blades.ms = []; };
    const hv = [new THREE.Vector3(), new THREE.Vector3()], hp0 = [new THREE.Vector3(), new THREE.Vector3()]; let hsp = [0, 0];
    const c = B.attach(i, a, f, [sh, brain({
      title, phases: [0.6, 0.25], flare: 0x8a2aff, barY: a.height + 1, gap: [1.2, 2.2],
      moves: [{ id: 'combo', mv: combo, w: 4, cd: [4, 6], dist: [0, 6] }, { id: 'guard', mv: parry.mv, w: 3, max: 0, cd: [7, 10], dist: [0, 6] }, { id: 'dash', mv: dash.mv, w: 3, cd: [6, 8], dist: [3.5, 13] },
        { id: 'bolt', mv: bolt, w: 3, cd: [8, 11], dist: [5, 22] }, { id: 'blades', mv: blades, w: 2.5, min: 1, cd: [12, 16] }],
      takeMul: () => 1,
      onPhase: (c, n) => { if (n === 1) { sh.st.up = false; const M = a.mdl; if (M && M.handNode && M.handNode.L) M.handNode.L.visible = false; if (c.bar) c.bar.status = ''; c.say('phase2'); } if (n === 2) { c.speedMul *= 1.2; c.speed(1); } },
      tick: (c, dt) => {
        // hand-swat parry: a fast controller swing through a dark bolt reflects it
        for (let k = 0; k < 2; k++) { const hd = k ? H.ctx.input.right : H.ctx.input.left; if (!hd || !hd.connected) continue; hv[k].copy(hd.position).sub(hp0[k]); hsp[k] = dt > 0 ? hv[k].length() / dt : 0; hp0[k].copy(hd.position); }
        for (let q = orbs.length - 1; q >= 0; q--) {
          const p = orbs[q]; if (!p.on || p.reflected || p.owner !== c) { orbs.splice(q, 1); continue; }
          for (let k = 0; k < 2; k++) { const hd = k ? H.ctx.input.right : H.ctx.input.left; if (!hd || !hd.connected || hsp[k] < 2.4) continue; const Wp = H.ctx.world.weapons, held = Wp && Wp.held && (k ? Wp.held.right : Wp.held.left); if (!held) continue; if (Math.hypot(hd.position.x - p.x, hd.position.y - p.y, hd.position.z - p.z) < 0.65) { reflectOrb(p, c); break; } }
        }
      },
      lastWords: 'Finally... a worthy blade...',
    })], { name: 'dark-champion', boss: true, armor: true, noTaunt: true,
      lines: { intro: ['Another challenger. Draw your steel.'], phase2: ['Enough of shields. Die.'], phase3: ['I will not kneel!'], guard: ['Try me.'], riposte: ['Predictable.'], bolt: ['Return it, if you can.'], blades: ['Blades, rise.'] } });
    // a dark bolt stopped by a held shield comes back
    H.ctx.on('combat:attack', (e) => { if (e && e.kind === 'projectile' && e.blocked && e.projectile && e.projectile.tag === 'orb' && e.projectile.owner === c && orbs.includes(e.projectile)) { const p = e.projectile; p.reflected = false; reflectOrb(p, c); } });
    c.bar.status = '';
  }, { size: 1.5, distance: 11 });

  // ================================================================== DEMON LORD  (weak point: frost - it quenches his flames and does extra damage; he is embedded after each leap slam)
  def('demon-lord', 'BOSS: towering horned demon wreathed in a ring of fire (burns anything close). Leap slams with a huge landing circle - he is stuck for a moment afterwards; meteor showers; summons imps; fire nova; flame walls. FROST hits (frost lance) quench his aura for 10 s and deal 2.5x. 3 phases', 'hp, name, level', ['archdemon', 'demon king', 'demon boss', 'hell lord', 'lord of fire'], (i, o) => {
    const title = o.name ?? 'DEMON LORD', hp = baseLevelHp(900, o);
    const cast = [{ model: 'demon', rig: 'kaykit-medium', height: 4.2, hold: { right: 'skeleton-axe' }, weaponType: 'axe' }, { model: 'skeleton-minion', tint: 0xe05040, height: 4.0, gore: 'blood', hold: { right: 'skeleton-axe' }, weaponType: 'axe' }];
    const r = biped(i, { ...o }, { model: cast, h: 4.0, bulk: 1.4, skin: 0xc03a2a, shirt: 0x4a1a1a, pants: 0x3a1010, hp, dmg: dmgOf(14, o), range: 3.2, cd: 2.6, windup: 0.9, speed: 2.8, aggro: 28, wander: 0, gear: [['head', 'hornHelm', 0xc03a2a]], weapon: 'axe', wscale: 2, puff: 0xff5a20, puffKind: 'fire', drops: bossDrops('ember-staff', 'sun-spear'),
      die: (a) => { for (let q = 0; q < 4; q++) K()?.explosion(i.ctx, _a.set(a.position.x + rand(-2, 2), a.position.y + 1 + q, a.position.z + rand(-2, 2)), { size: 2.4, color: 0xff6a1a }); i.snd().tone({ freq: 120, freqEnd: 25, dur: 3, type: 'sawtooth', vol: 0.4, at: a.position }); } });
    const a = r.a, f = r.f; if (!a) return;
    const aura = B.aura({ kind: 'fire', r: 3.8, dps: 3, color: 0xff5a1a, rate: 14 });
    const leap = B.leaper({ min: 6, max: 20, tele: 1.0, radius: 5, dmg: 1.4, fire: true, zone: 4, height: 4.5, color: 0xff4a10, force: 9, land: 1.5, clip: 'Jump_Full_Long' });
    const le = leap.mv.end; leap.mv.end = (c, intr) => { le(c, intr); if (!intr) { c.stunMul = 1.5; c.stun(2.6); if (c.bar) { c.bar.status = 'EMBEDDED - STRIKE!'; B.after(2.8, () => { if (c.bar && c.bar.status === 'EMBEDDED - STRIKE!') c.bar.status = ''; }); } } };
    const nova = B.stomper({ radius: 8, tele: 1.5, dmg: 1.2, color: 0xff6a20, reach: 99, cd: [10, 14] });
    const meteors = meteorMove('meteors', 5, 2.6, 0.8), meteors2 = meteorMove('meteors', 8, 2.6, 0.8, 0.8);
    const imps = simpleMove('imps', 1.2, (c) => { c.a.stop(); B.clip(c.a, 'Spellcast_Summon', { then: 'idle' }); c.a.attackAnim(1.2, 'ranged'); }, (c) => { addAdds(c, 'imp', 3, { cap: 6, color: 0xff5a1a, r: 5 }); }, 0.5);
    const wall = simpleMove('wall', 1.4, (c, mv) => { c.sense(); const p = c.a.position; mv.yaw = Math.atan2(head.x - p.x, head.z - p.z); mv.m = B.tele.rect(p.x, p.z, mv.yaw, 3, 16, 0xff4a10); c.a.faceTo(c.tp, 1.4); c.a.attackAnim(1.2, 'ranged'); },
      (c, mv) => { const p = c.a.position; for (let q = 1; q <= 8; q++) { const x = p.x + Math.sin(mv.yaw) * q * 2, z = p.z + Math.cos(mv.yaw) * q * 2; B.after(q * 0.08, () => { _a.set(x, ground(x, z) + 0.5, z); B.aoe(c, _a, 1.8, c.f.damageAmt * 0.7, { kind: 'fire', force: 3 }); B.zones.add(c, { x, z, r: 1.8, ttl: 5, kind: 'fire', dps: 4 }); }); } H.sfx(H.ctx).noise({ dur: 0.8, filter: { type: 'bandpass', freq: 500, freqEnd: 250 }, vol: 0.4, at: p }); }, 0.6);
    wall.cleanup = () => { if (wall.m) B.tele.free(wall.m); wall.m = null; }; const wu = wall.update; wall.update = (c, dt) => { if (wall.m) { wall.m.k = Math.min(1, wall.t / 1.4); wall.m.x = c.a.position.x; wall.m.z = c.a.position.z; } return wu(c, dt); };
    const c = B.attach(i, a, f, [aura, brain({
      title, phases: [0.66, 0.33], flare: 0xff4a10, barY: a.height + 1.2, gap: [1.4, 2.4],
      moves: [{ id: 'leap', mv: leap.mv, w: 4, cd: [8, 11], dist: [6, 20] }, { id: 'nova', mv: nova.mv, w: 2.5, cd: [11, 15], dist: [0, 9] }, { id: 'imps', mv: imps, w: 2, cd: [18, 24], when: (c) => liveKids(c) < 2 },
        { id: 'meteors', mv: meteors, w: 3, min: 1, max: 1, cd: [12, 16] }, { id: 'meteors', mv: meteors2, w: 3, min: 2, cd: [10, 13] }, { id: 'wall', mv: wall, w: 2.5, min: 2, cd: [11, 14], dist: [3, 18] }],
      takeMul: (c, kd) => { if (kd === 'frost') { c.auraOffUntil = c.t + 10; if (c.bar) c.bar.status = 'FLAMES QUENCHED'; return 2.5; } return 1; },
      onPhase: (c, n) => { c.speedMul *= 1.12; c.speed(1); },
      tick: (c) => { if (c.bar && c.auraOffUntil && c.t > c.auraOffUntil) { c.auraOffUntil = 0; if (c.bar.status === 'FLAMES QUENCHED') c.bar.status = ''; } },
      lastWords: 'The fire... goes out...',
    })], { name: 'demon-lord', boss: true, armor: true, noTaunt: true,
      lines: { intro: ['Your soul is a candle. I will snuff it.', 'Hell hungers.'], phase2: ['Rain fire!'], phase3: ['Burn! BURN!'], leap: ['Down you go!'], meteors: ['The sky weeps ash!'], imps: ['My children, feast!'] } });
  }, { size: 3, distance: 12 });

  // @@MORE
  Object.assign(H, { bossHelpers: { brain, addAdds, weakPoint, groundStrike, simpleMove, fire } });
}
