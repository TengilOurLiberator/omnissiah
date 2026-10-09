// games/arena.js - HORDE MODE in a ring of standing stones: ten escalating waves (goblins -> skeletons/orcs -> wolves/trolls, a boss on waves 5 and 10),
// a 12 s break between waves with three shop pedestals (heal / better weapon / ally), gold from every kill. Score = wave reached x 100 + kills.
export const meta = {
  name: 'arena', title: 'Arena Survival', aliases: ['survival', 'horde', 'arena survival', 'horde mode', 'wave survival', 'gladiator pit'], icon: 'âš”ï¸',
  description: 'survive ten waves in a ring of stones; spend kill gold on healing, weapons and allies between waves', hint: 'Survive the waves. Poke a pedestal to shop', distance: 0, size: 9, par: 1000,
};

const CAP = 10, BREAK = 12, MAX_ALLIES = 4;
const NODROP = { drops: [] }; // no loot on the field: weapons come from the shop, nothing is left behind after the round
const LADDER = [['sword', 0, 'SWORD'], ['katana', 30, 'KATANA'], ['warhammer', 55, 'HAMMER'], ['omni-blade', 90, 'OMNI-BLADE'], ['storm-hammer', 130, 'STORM HAMMER']];
const GOLD = { goblin: 3, 'goblin-archer': 4, skeleton: 4, 'skeleton-archer': 5, wolf: 4, 'orc-brute': 8, troll: 14, 'dark-knight': 12, 'lich-king': 60, 'ancient-dragon': 90 };
const PADS = [{ id: 'heal', base: 15, color: 0xe0405a }, { id: 'weapon', base: 0, color: 0xe8c040 }, { id: 'ally', base: 40, color: 0x4a9aff }];
// [[enemy, count], ...] per wave; 5 and 10 are boss waves (the boss is added by bossFor)
const PLAN = [null, [['goblin', 4]], [['goblin', 6]], [['goblin', 5], ['goblin-archer', 2]], [['goblin', 4], ['skeleton', 3], ['orc-brute', 1]], [['goblin', 3]],
  [['skeleton', 5], ['orc-brute', 2], ['skeleton-archer', 2]], [['wolf', 5], ['skeleton', 4], ['orc-brute', 2]], [['troll', 1], ['wolf', 4], ['skeleton', 4]], [['troll', 2], ['orc-brute', 3], ['wolf', 4]], [['wolf', 3]]];

export default function (g) {
  const { THREE } = g, W = g.world, kit = W.kit, K = g.k, ev = g.gctx.events;
  const R = Math.max(6.2, 9 * K), SR = R - 0.7, PR = 2.8 * K; // ring radius, enemy spawn radius, shop radius
  const centre = g.at(0, 0, 0);
  g.boardAt(0, 2.0, -(PR + 0.9)); g.pedestalAt(-(R + 1.2) * 0.5, (R + 1.2) * 0.86); // the start / stop pedestal stands OUTSIDE the ring behind you: swinging in a fight must never hit the red stop button

  // ---- scenery: 36 standing stones, 4 braziers (flames flicker), all one draw call + 4 flames
  const sb = g.builder();
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2, lx = Math.cos(a) * R, lz = Math.sin(a) * R, h = 1.2 + Math.random() * 0.9, w = 0.6 + Math.random() * 0.4, shade = 0x8a8d96 + ((Math.random() * 3) | 0) * 0x080808;
    sb.box(w, h, w * 0.8, shade, lx, g.ground(lx, lz) - g.y + h / 2 - 0.15, lz, -a + (Math.random() - 0.5) * 0.4);
  }
  const flames = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2, lx = Math.cos(a) * (R + 0.25), lz = Math.sin(a) * (R + 0.25), gy = g.ground(lx, lz) - g.y;
    sb.cyl(0.18, 0.26, 0.9, 0x3a3c44, lx, gy + 0.45, lz, 8); sb.cyl(0.3, 0.2, 0.18, 0x23252b, lx, gy + 0.95, lz, 8);
    const f = g.add(g.sph(0.2, 0xff8a24, 0, 0, 0, { basic: true })); f.scale.y = 1.6; f.position.copy(g.at(lx, gy + 1.2, lz)); flames.push(f);
  }
  const ring = g.add(sb.mesh()); ring.position.copy(centre); ring.position.y = g.y; ring.rotation.y = g.yaw; ring.userData.noShadow = false;
  const pw = g.at(-(R + 1.2) * 0.5, 0, (R + 1.2) * 0.86); if (kit?.label) g.track(kit.label(g.ctx, 'START / STOP', { size: 0.09, position: { x: pw.x, y: g.ground(-(R + 1.2) * 0.5, (R + 1.2) * 0.86) + 1.5, z: pw.z } }));
  // ---- shop pedestals (hidden outside the break)
  const pads = PADS.map((d, i) => {
    const a = (i - 1) * 0.68, lx = Math.sin(a) * PR, lz = -Math.cos(a) * PR, w = g.at(lx, 0, lz), gy = g.ground(lx, lz);
    const b = g.builder(); b.cyl(0.18, 0.26, 0.8, 0x6a6e7a, 0, 0.4, 0, 12); b.cyl(0.28, 0.22, 0.08, d.color, 0, 0.84, 0, 12);
    const base = g.add(b.mesh()); base.position.set(w.x, gy, w.z);
    const icon = d.id === 'heal' ? g.sph(0.11, d.color, 0, 0, 0, { basic: true }) : d.id === 'weapon' ? g.box(0.07, 0.34, 0.07, d.color, 0, 0, 0, { basic: true }) : g.cyl(0.001, 0.12, 0.26, d.color, 0, 0, 0, { basic: true });
    g.add(icon); icon.position.set(w.x, gy + 1.12, w.z); if (d.id === 'weapon') icon.rotation.z = 0.6;
    const label = kit?.label ? g.track(kit.label(g.ctx, d.id.toUpperCase(), { size: 0.085, position: { x: w.x, y: gy + 1.5, z: w.z } })) : null;
    const dmg = kit?.damageable ? g.track(kit.damageable(g.ctx, icon, { hp: 1e9, radius: 0.3, faction: 'neutral', onHit: (e) => { if (padsOn && !(e && e.from === 'enemy')) buy(i); } })) : null;
    base.visible = icon.visible = false; label?.show(false);
    return { d, base, icon, label, dmg, top: icon.position };
  });

  // ---- state
  let lvl = 1, wave = 0, kills = 0, killsWave = 0, gold = 0, tier = 0, phase = 'none', tBreak = 0, tWave = 0, tInfo = 0, cool = 0, padsOn = false, playing = false, dying = false, cleared = false, foes = 0;
  let wh = null, myWeapon = null, allyN = 0, seen = new Set();
  const allies = [];
  const lib = () => W.library, hp = () => W.player?.health ?? 100;
  const price = (i) => { const d = PADS[i]; const base = d.id === 'weapon' ? (LADDER[tier + 1]?.[1] ?? 0) : d.base; return Math.round(base * (1 + 0.06 * (wave - 1))); };
  function labels() {
    pads.forEach((p, i) => {
      const t = p.d.id === 'weapon' ? (tier + 1 < LADDER.length ? `${LADDER[tier + 1][2]} ${price(i)}g` : 'MAXED') : p.d.id === 'heal' ? `HEAL ${price(i)}g` : `ALLY ${price(i)}g`;
      p.label?.set(t);
    });
  }
  function showPads(on) {
    padsOn = on; for (const p of pads) { p.base.visible = p.icon.visible = on; p.label?.show(on); } if (on) labels();
  }
  const say = (txt, color) => g.float(g.at(0, 2.3, -PR * 0.6), txt, color ?? 0xffe27a);
  function status() {
    const t = phase === 'break' ? `Shop ${Math.ceil(tBreak)}s   Gold ${gold}` : `Gold ${gold}   Foes ${foes}   HP ${Math.round(hp() / 5) * 5}`;
    g.status(t);
  }

  // ---- shop
  function buy(i) {
    if (!padsOn || cool > 0 || !playing) return;
    cool = 0.7; const p = pads[i], id = p.d.id, cost = price(i), at = p.top;
    const refuse = (txt) => { g.float(at, txt, 0xff7a6b); g.sfx('miss', at, 0.7); };
    if (id === 'weapon' && tier + 1 >= LADDER.length) return refuse('Maxed out');
    if (gold < cost) return refuse(`Need ${cost}g`);
    if (id === 'heal') { const P = W.player; if (!P || P.health >= P.maxHealth - 1) return refuse('Already healthy'); P.heal?.(60); } else if (id === 'weapon') {
      myWeapon?.remove?.(); myWeapon = null; const type = LADDER[tier + 1][0];
      myWeapon = g.give(type) ?? (W.weapons?.create ? g.round(W.weapons.create(g.ctx, type, { position: { x: at.x, y: at.y + 0.4, z: at.z } })) : null);
      if (!myWeapon) return refuse('No weapon available'); tier++;
    } else {
      if (allyN >= MAX_ALLIES) return refuse('Squad is full');
      const a = Math.random() * 6.28, h = g.spawn(allyN % 2 ? 'archer' : 'knight', { x: g.head.x + Math.cos(a) * 1.6, z: g.head.z + Math.sin(a) * 1.6, noPush: true });
      if (!h) return refuse('No room for an ally'); allies.push(h); allyN++;
    }
    gold -= cost; labels(); status(); g.float(at, id === 'heal' ? '+60 HP' : id === 'weapon' ? LADDER[tier][2] : 'ALLY JOINS', 0x7fe3a0); g.pop(at, 18, 'spark'); g.sfx('big', at, 0.6); g.pulse('both', 0.5, 80);
  }
  function pointsAt(h, t, r) {
    const p = h.inp.position, d = h.inp.direction, dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z, k = dx * d.x + dy * d.y + dz * d.z;
    if (k < 0.1 || k > 8) return false; const ex = p.x + d.x * k - t.x, ey = p.y + d.y * k - t.y, ez = p.z + d.z * k - t.z; return ex * ex + ey * ey + ez * ez < r * r;
  }
  function shopInput() {
    for (const h of g.hands) {
      if (!h.ok) continue; const held = W.weapons?.held?.[h.name];
      for (let i = 0; i < pads.length; i++) {
        const t = pads[i].top, dx = h.pos.x - t.x, dz = h.pos.z - t.z, dy = h.pos.y - t.y;
        if ((dx * dx + dz * dz < 0.0625 && dy > -0.25 && dy < 0.25 && h.speed > 0.9) || (!held && h.inp.pressed?.('trigger') && pointsAt(h, t, 0.28))) { buy(i); return; }
      }
    }
  }

  // ---- waves
  function sweepLoot(all) { // swords and bows dropped by severed arms are products of the fight: clear them between waves and at the end (never the ones in a hand, except at the end)
    const list = W.weapons?.list?.(); if (!list) return;
    for (const w of list.slice()) if (!seen.has(w) && w !== myWeapon && (all || !w.held)) { try { w.remove(); } catch (err) { /* gone */ } }
  }
  function bossFor(n) { // library bosses when present (category 'bosses'), else the old lich / dragon, else a beefed-up troll / golem (exact names: has() is fuzzy)
    const L = lib(); if (!L) return null;
    const names = L.list ? L.list().map((e) => e.name) : [], pool = (L.byCategory?.('bosses') ?? []).filter((c) => names.includes(c));
    if (pool.length) return { name: n < CAP ? pool[0] : pool[pool.length - 1], count: 1, opts: NODROP };
    const named = (n < CAP ? ['lich-king'] : ['ancient-dragon', 'lich-king']).find((c) => names.includes(c));
    if (named) return { name: named, count: 1, opts: { drops: [], hp: n < CAP ? 350 : 520, name: named === 'lich-king' ? 'LICH KING' : 'ANCIENT DRAGON' } };
    return n < CAP ? { name: 'troll', count: 1, opts: { drops: [], hp: 300, scale: 1.35, name: 'TROLL CHIEFTAIN' } } : { name: 'stone-golem', count: 1, opts: { drops: [], hp: 500, name: 'STONE COLOSSUS' } };
  }
  function startWave(n) {
    const L = lib(); if (!L?.wave) { g.end({ score: wave * 100 + kills, text: 'No library' }); return; }
    wh?.remove?.(); showPads(false); sweepLoot(false);
    wave = n; killsWave = 0; cleared = false; tWave = 0; phase = 'fight';
    const m = 1 + 0.15 * (lvl - 1), spec = PLAN[n].map(([name, c]) => ({ name, count: Math.max(1, Math.round(c * m)), opts: NODROP })), boss = (n === 5 || n === CAP) ? bossFor(n) : null;
    if (boss) spec.unshift(boss);
    wh = g.round(L.wave(g.ctx, spec, { around: { x: centre.x, z: centre.z }, radius: SR, delay: 0.45, onCleared: () => { cleared = true; } }));
    g.headline(`WAVE ${n}`); g.setScore(wave * 100 + kills); status();
    say(boss ? 'BOSS WAVE ' + n : 'WAVE ' + n, boss ? 0xff7a6b : 0xffe27a); g.sfx(boss ? 'boom' : 'big');
    if (boss) g.note(`Wave ${n} brings a boss, ${boss.name}.`, true); else if (n === 1) g.note('The arena horde has begun.', false);
  }
  function endWave() {
    const bonus = 8 + 4 * wave; gold += bonus; cleared = false;
    if (wave >= CAP) { g.sfx('win'); g.end({ score: wave * 100 + kills + 100, rating: (wave * 100 + kills + 100) / meta.par, text: 'VICTORY', detail: `survived all ${CAP} waves, ${kills} kills` }); return; }
    phase = 'break'; tBreak = BREAK; showPads(true); status();
    say(`WAVE ${wave} CLEARED  +${bonus}g`, 0x7fe3a0); g.pop(g.at(0, 1.6, -1.5), 30, 'confetti'); g.sfx('win');
  }
  function sweep() { // soft-lock guard: stragglers that never arrive are dispersed
    for (const f of wh?.fighters ?? []) if (f.alive) f.remove();
    say('Stragglers scatter', 0xa4abdc); cleared = true;
  }

  // ---- events (venue lifetime; ignored unless a round is on)
  const offKill = ev?.on?.('combat:kill', (e) => {
    if (!playing || !e || !e.victim || e.victim.faction !== 'enemy') return;
    const p = e.victim.actor?.position; if (!p) return;
    const dx = p.x - centre.x, dz = p.z - centre.z; if (dx * dx + dz * dz > (R + 4) * (R + 4)) return;
    const worth = GOLD[e.victim.name] ?? (e.victim.maxHp >= 200 ? 60 : 4); kills++; killsWave++; gold += worth; g.setScore(wave * 100 + kills);
    g.float(p, `+${worth}g`, 0xffd23a); g.sfx('coin', p, 0.45);
  });
  const offDied = ev?.on?.('player:died', () => { if (playing) dying = true; });

  return {
    reset(level) {
      lvl = level; wave = kills = killsWave = gold = tier = allyN = 0; phase = 'none'; cleared = dying = playing = false; wh = myWeapon = null; allies.length = 0; foes = 0;
      showPads(false); g.headline(''); g.status('');
    },
    play() {
      playing = true; seen = new Set(W.weapons?.list?.() ?? []); W.player?.heal?.(1000); myWeapon = g.give('sword'); g.status(''); startWave(1);
    },
    update(dt, t) {
      cool -= dt; for (let i = 0; i < flames.length; i++) flames[i].scale.y = 1.5 + Math.sin(t * 9 + i * 2) * 0.25;
      for (const p of pads) if (padsOn) p.icon.rotation.y += dt * 2;
      if (dying) { dying = false; const s = wave * 100 + kills; g.note(`The player fell on wave ${wave} with ${kills} kills.`, true); g.end({ score: s, rating: s / meta.par, text: `FELL W${wave}`, detail: `wave ${wave}, ${kills} kills` }); return; }
      if (phase === 'fight') {
        tWave += dt; tInfo -= dt;
        if (cleared) endWave();
        else if (tWave > (wave === 5 || wave === CAP ? 260 : 110 + 8 * wave)) sweep();
        else if (tInfo <= 0) { tInfo = 0.5; foes = W.combat?.count?.('enemy') ?? 0; status(); }
      } else if (phase === 'break') {
        tBreak -= dt; shopInput(); tInfo -= dt;
        if (tInfo <= 0) { tInfo = 0.25; status(); }
        if (tBreak <= 0) startWave(wave + 1);
      }
    },
    idle(dt, t) { for (let i = 0; i < flames.length; i++) flames[i].scale.y = 1.5 + Math.sin(t * 9 + i * 2) * 0.25; },
    stop() { playing = false; phase = 'none'; showPads(false); sweepLoot(true); },
    dispose() { playing = false; try { offKill?.(); offDied?.(); } catch (err) { /* gone */ } },
    info: { get wave() { return wave; }, get kills() { return kills; }, get gold() { return gold; }, get phase() { return phase; }, get tier() { return tier; }, get allies() { return allies; }, get wh() { return wh; }, pads, R, centre, buy, set gold(v) { gold = v; } },
  };
}





