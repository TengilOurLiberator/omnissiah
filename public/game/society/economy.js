// society/economy.js - gold, coin drops, shops (stall display + Market panel), potions, selling, bounty payment, stealing, gifts.
// Loaded by core/society.js (cache-busted import); `core` is its shared internals. Gold lives in the quests profile ('society.gold').
export default function install(core) {
  const { THREE, W, ev, DATA, ST, ctx, clamp, rand, pick, d2, now, head, ground, npcs, num } = core;
  const cap1 = (s) => String(s).replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const hand = (name) => { const h = ctx.input[name]; return h && h.connected ? h : null; };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _e = new THREE.Euler();
  let tabId = 'wares';

  // ------------------------------------------------------------------ coins: ONE instanced mesh, 24 pooled discs, magnet + auto collect
  const COIN_CAP = 24;
  const cx = new Float32Array(COIN_CAP), cy = new Float32Array(COIN_CAP), cz = new Float32Array(COIN_CAP), cvx = new Float32Array(COIN_CAP), cvy = new Float32Array(COIN_CAP), cvz = new Float32Array(COIN_CAP);
  const cval = new Float32Array(COIN_CAP), cage = new Float32Array(COIN_CAP), crest = new Uint8Array(COIN_CAP);
  let coinN = 0, coinMesh = null, toastGold = 0, toastT = 0, snd = null;
  function ensureCoins() {
    if (coinMesh) return;
    const g = new THREE.CylinderGeometry(0.07, 0.07, 0.016, 12), m = new THREE.MeshLambertMaterial({ color: 0xffc83a, emissive: 0x7a5200 });
    coinMesh = new THREE.InstancedMesh(g, m, COIN_CAP);
    coinMesh.name = 'society-coins'; coinMesh.frustumCulled = false; coinMesh.count = 0;
    coinMesh.userData.noShadow = true; coinMesh.userData.noOutline = true; coinMesh.userData.noCull = true;
    ctx.root.add(coinMesh);
  }
  function dropCoins(x, y, z, total) {
    total = Math.round(total); if (total <= 0) return;
    ensureCoins();
    const k = Math.min(6, Math.max(1, Math.ceil(total / 5))), each = Math.floor(total / k), extra = total - each * k;
    for (let i = 0; i < k; i++) {
      let j = coinN;
      if (coinN >= COIN_CAP) { // pool full: the oldest coin is paid out at once
        let o = 0; for (let q = 1; q < coinN; q++) if (cage[q] > cage[o]) o = q;
        core.earn(cval[o], 'coin'); j = o;
      } else coinN++;
      const a = rand(0, 6.283), sp = rand(1.2, 3.2);
      cx[j] = x + rand(-0.2, 0.2); cy[j] = y + 0.5; cz[j] = z + rand(-0.2, 0.2);
      cvx[j] = Math.cos(a) * sp; cvz[j] = Math.sin(a) * sp; cvy[j] = rand(3, 5.5);
      cval[j] = each + (i === 0 ? extra : 0); cage[j] = 0; crest[j] = 0;
    }
  }
  function sfxCoin(at) {
    if (W.audio?.sfx?.('pickup-coin', { at, volume: 0.7 })) return;
    const K = W.kit; if (!K) return;
    snd = snd || K.sound(ctx, { volume: 0.7 });
    snd.tone({ freq: 1500, freqEnd: 2100, dur: 0.12, type: 'triangle', vol: 0.12, at });
  }
  function collect(j) {
    core.earn(cval[j], 'coin');
    toastGold += cval[j]; toastT = 0.7;
    sfxCoin({ x: cx[j], y: cy[j], z: cz[j] });
    coinN--;
    if (j !== coinN) { cx[j] = cx[coinN]; cy[j] = cy[coinN]; cz[j] = cz[coinN]; cvx[j] = cvx[coinN]; cvy[j] = cvy[coinN]; cvz[j] = cvz[coinN]; cval[j] = cval[coinN]; cage[j] = cage[coinN]; crest[j] = crest[coinN]; }
  }
  function stepCoins(dt) {
    if (!coinN) { if (coinMesh && coinMesh.count) coinMesh.count = 0; return; }
    const hl = hand('left'), hr = hand('right');
    for (let j = coinN - 1; j >= 0; j--) {
      cage[j] += dt;
      if (!crest[j]) {
        cvy[j] -= 14 * dt; cx[j] += cvx[j] * dt; cy[j] += cvy[j] * dt; cz[j] += cvz[j] * dt;
        const gy = ground(cx[j], cz[j]) + 0.03;
        if (cy[j] < gy) { cy[j] = gy; if (cvy[j] < -1.8) { cvy[j] = -cvy[j] * 0.38; cvx[j] *= 0.6; cvz[j] *= 0.6; } else { cvy[j] = 0; crest[j] = 1; } }
      }
      const dx = head.x - cx[j], dz = head.z - cz[j], dy = head.y - 0.6 - cy[j], dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
      if (cage[j] > 0.8 && dist < 3.2) { // magnet
        const sp = (4 + (3.2 - dist) * 3) * dt / Math.max(dist, 0.1);
        cx[j] += dx * sp; cz[j] += dz * sp; cy[j] += dy * sp; crest[j] = 0; cvy[j] = 0; cvx[j] = cvz[j] = 0;
        if (dist < 0.6) { collect(j); continue; }
      }
      for (const h of [hl, hr]) if (h && cage[j] > 0.3) { const ex = h.position.x - cx[j], ey = h.position.y - cy[j], ez = h.position.z - cz[j]; if (ex * ex + ey * ey + ez * ez < 0.09) { collect(j); break; } }
      if (j < coinN && cage[j] > 150) collect(j);
    }
    coinMesh.count = coinN;
    for (let j = 0; j < coinN; j++) {
      _e.set(0, cage[j] * 3 + j, crest[j] ? 0 : cage[j] * 9 % 6.283); _q.setFromEuler(_e);
      _m.compose(_p.set(cx[j], cy[j], cz[j]), _q, _s); coinMesh.setMatrixAt(j, _m);
    }
    coinMesh.instanceMatrix.needsUpdate = true;
    if (toastT > 0) { toastT -= dt; if (toastT <= 0 && toastGold) { core.hud(`+${toastGold} gold`, 1.8); toastGold = 0; } }
  }
  function coinValueFor(f, a) {
    const name = String(f.name || a.role || '').toLowerCase();
    let v = DATA.COIN_VALUE[name];
    if (v === undefined) v = Math.max(1, Math.round((f.maxHp || 20) * 0.18 + rand(0, 2)));
    return clamp(Math.round(v * rand(0.8, 1.3)), 1, 400);
  }
  function onKill(f, a) { dropCoins(a.position.x, a.position.y, a.position.z, coinValueFor(f, a)); }
  function onQuest(e) {
    const xp = num(e?.rewards?.xp), g = Math.round((10 + xp * 0.55) * (e?.kind === 'bounty' ? 1.25 : 1));
    if (g > 0) { core.earn(g, 'quest'); core.hud(`Quest reward: +${g} gold`, 3); }
  }

  // ------------------------------------------------------------------ wares
  const isVendor = (n) => n && !n.released && !n.a.dead && (n.role === 'merchant' || n.role === 'blacksmith' || n.role === 'wizard');
  function priceMult(n) { return DATA.priceMult(core.attitude(n)); }
  function shopFor(n) {
    if (!isVendor(n)) return { open: false, reason: 'not a trader', wares: [], mult: 1, vendor: n };
    const s = n.sett;
    const att = core.attitude(n);
    if (s && core.bountyOf(s) >= DATA.BOUNTY_REFUSE) return { open: false, reason: 'refuses to trade with a wanted criminal', wares: [], mult: 1, vendor: n };
    if (att <= -45) return { open: false, reason: 'will not deal with you', wares: [], mult: 1, vendor: n };
    if (n.hidden) return { open: false, reason: 'is asleep', wares: [], mult: 1, vendor: n };
    const day = core.CK.days;
    if (!n.wareKey || n.wareDay !== day) { n.wareDay = day; n.wareList = buildWares(n, day); n.wareKey = 1; }
    const mult = priceMult(n);
    const wares = n.wareList.map((w) => ({ id: w.id, name: w.name, kind: w.kind, price: Math.max(1, Math.round(w.base * mult)), basePrice: w.base, desc: w.desc, color: w.color, ref: w }));
    return { open: true, reason: '', wares, mult, vendor: n };
  }
  function rotate(list, k, seed, day) { // k items from list, a different pick each day, stable within a day
    const out = []; const start = (seed + day * 3) % Math.max(1, list.length);
    for (let i = 0; i < Math.min(k, list.length); i++) out.push(list[(start + i * 2) % list.length]);
    return [...new Set(out)];
  }
  function buildWares(n, day) {
    const out = [];
    const W_ = DATA.STOCK[n.role] || [];
    const wk = n.role === 'merchant' ? 5 : n.role === 'blacksmith' ? 9 : 3;
    for (const t of rotate(W_, wk, n.seed, day)) out.push({ id: 'w:' + t, kind: 'weapon', key: t, name: cap1(t), base: DATA.WEAPON_PRICE[t] || 100, desc: 'A ' + t.replace(/-/g, ' ') + '.', color: '#c8d0e0' });
    if (n.role === 'merchant' || n.role === 'wizard') {
      for (const p of DATA.POTIONS) out.push({ id: 'p:' + p.id, kind: 'potion', key: p.id, name: p.name, base: p.price * (n.role === 'wizard' ? 1.3 : 1), desc: p.desc, color: '#' + p.color.toString(16).padStart(6, '0') });
    }
    if (n.role === 'merchant') {
      for (const c of rotate(DATA.COMPANIONS, 3, n.seed, day)) out.push({ id: 'c:' + c.id, kind: 'companion', key: c.id, name: c.name, base: c.price, desc: c.desc, color: '#e8c070' });
      for (const k of rotate(DATA.KITS, 5, n.seed >>> 3, day)) out.push({ id: 'k:' + k.id, kind: 'kit', key: k.id, name: k.name, base: k.price, desc: k.desc, color: '#a0d090' });
      for (const k of rotate(DATA.COSMETICS, 3, n.seed >>> 5, day)) out.push({ id: 'x:' + k.id, kind: 'cosmetic', key: k.id, name: k.name, base: k.price, desc: k.desc, color: '#e090e0' });
    }
    return out;
  }
  function vendorOf(x, maxD = 10) {
    if (x) { const n = x.a ? x : npcs.get(x) || x.society; if (n) return n; }
    let best = null, bd = maxD * maxD;
    for (const n of npcs.values()) { if (!isVendor(n) || n.hidden) continue; const dd = d2(n.a.position.x, n.a.position.z, head.x, head.z); if (dd < bd) { bd = dd; best = n; } }
    if (!best && ST.lastVendor && !ST.lastVendor.released && !ST.lastVendor.hidden && d2(ST.lastVendor.a.position.x, ST.lastVendor.a.position.z, head.x, head.z) < 22 * 22) best = ST.lastVendor;
    if (best) ST.lastVendor = best;
    return best;
  }
  function shop(x) {
    const n = vendorOf(x); if (!n) return { open: false, reason: 'no merchant nearby', wares: [], mult: 1, vendor: null };
    const s = shopFor(n);
    return { open: s.open, reason: s.reason, mult: s.mult, merchant: n.name, role: n.role, wares: s.wares.map(({ ref, ...w }) => w) };
  }

  // ------------------------------------------------------------------ buying, selling, potions
  const inv = (id) => core.pget('inv.' + id);
  const front = (d = 1.1, dy = -0.15) => { const f = ctx.player.forward; const l = Math.hypot(f.x, f.z) || 1; return { x: head.x + (f.x / l) * d, y: head.y + dy, z: head.z + (f.z / l) * d }; };
  const aheadGround = (d = 5) => { const a = ctx.aimPoint?.(25); if (a && Math.hypot(a.x - head.x, a.z - head.z) > 2) return { x: a.x, z: a.z }; const p = front(d); return { x: p.x, z: p.z }; };
  function deliver(w, n) {
    const lib = W.library;
    if (w.kind === 'weapon') {
      const h = hand('right') || hand('left'); const pos = h ? { x: h.position.x, y: h.position.y, z: h.position.z - 0.0 } : front(0.7, -0.2);
      const o = W.weapons?.create(ctx, w.key, { position: pos }); if (!o) return false;
      o.body && (o.body.__socOwned = true); o.__socOwned = true;
      return true;
    }
    if (w.kind === 'potion') { core.padd('inv.' + w.key, 1); return true; }
    if (w.kind === 'companion') {
      const c = DATA.COMPANIONS.find((k) => k.id === w.key); if (!c || !lib) return false;
      if (W.perf?.allow && W.perf.allow('actors', 1) < 1) { core.hud('Too many creatures about to bring in a new companion', 3); return false; }
      const p = front(2, 0);
      const hdl = lib.spawn(ctx, c.lib, { x: p.x, z: p.z, noPush: true }); if (!hdl) return false;
      ST.placed.push({ lib: c.lib, x: p.x, z: p.z, opts: {}, pet: true }); if (ST.placed.length > 24) ST.placed.shift();
      return true;
    }
    if (w.kind === 'kit' || w.kind === 'cosmetic') {
      const c = (w.kind === 'kit' ? DATA.KITS : DATA.COSMETICS).find((k) => k.id === w.key); if (!c || !lib) return false;
      const p = aheadGround(6), yaw = Math.atan2(head.x - p.x, head.z - p.z);
      const hdl = lib.spawn(ctx, c.lib, { x: p.x, z: p.z, yaw, noPush: true, ...(c.opts || {}) }); if (!hdl) return false;
      if (w.kind === 'kit') { ST.placed.push({ lib: c.lib, x: p.x, z: p.z, yaw, opts: c.opts || {} }); if (ST.placed.length > 24) ST.placed.shift(); }
      return true;
    }
    return false;
  }
  function buy(id, merchant) {
    const n = vendorOf(merchant);
    if (!n) { core.hud('No merchant nearby', 2); return false; }
    const sh = shopFor(n);
    if (!sh.open) { core.hud(`${n.name || 'The merchant'} ${sh.reason}`, 3); core.bark(n, 'event:poor', 1); return false; }
    const w = sh.wares.find((x) => x.id === id || x.name.toLowerCase() === String(id).toLowerCase()); if (!w) return false;
    if (core.gold() < w.price) { core.bark(n, 'event:poor', 1); core.hud(`Not enough gold: ${w.name} costs ${w.price}`, 2.5); W.audio?.sfx?.('ui-error', { volume: 0.5 }); return false; }
    if (!deliver(w.ref, n)) return false;
    core.spend(w.price, 'buy ' + w.name);
    paidTo(n, w.price, w.name);
    return true;
  }
  function paidTo(n, price, name) {
    const s = n.sett;
    if (s) { core.addRep(s, Math.min(2, price / 60), 'trade'); core.addGrowth(s, Math.min(2.5, price / 45), 'trade'); core.padd(`s${s.slot}.t`, price); }
    core.memAdd(n, Math.min(4, price / 40), 1);
    core.bark(n, 'event:buy', 1);
    W.audio?.sfx?.('pickup-coin', { at: n.a.position, volume: 0.6 });
    ev.emit('society:buy', { merchant: n.name, item: name, price });
  }
  function weaponHeld() { const H = W.weapons?.held; return (H && (H.right || H.left)) || null; }
  function sellTarget() {
    const w = weaponHeld(); if (w && !w.__socItem) return w;
    const list = W.weapons?.list ? W.weapons.list() : []; let best = null, bd = 2.2 * 2.2;
    for (const o of list) { if (o.__socItem || o.body?.removed) continue; const p = o.body.position, dd = d2(p.x, p.z, head.x, head.z); if (dd < bd) { bd = dd; best = o; } }
    return best;
  }
  function sellValue(w, n) { const base = DATA.WEAPON_PRICE[w.type] || 40; return Math.max(1, Math.round(base * DATA.SELL_FACTOR * (2 - priceMult(n)))); }
  function sell() {
    const n = vendorOf(); if (!n || (n.role !== 'merchant' && n.role !== 'blacksmith')) { core.hud('Nobody here buys weapons', 2); return 0; }
    const sh = shopFor(n); if (!sh.open) { core.hud(`${n.name || 'The trader'} ${sh.reason}`, 3); return 0; }
    const w = sellTarget(); if (!w) { core.hud('Hold a weapon out to sell it', 2.5); return 0; }
    const v = sellValue(w, n); const type = w.type;
    try { w.remove(); } catch (e) { return 0; }
    core.earn(v, 'sold ' + type); core.hud(`Sold ${cap1(type)} for ${v} gold`, 2.5);
    paidTo(n, 0, 'sold ' + type); core.memAdd(n, 1, 0);
    return v;
  }
  function payBounty(s) {
    s = s || (() => { let b = null, bb = 0; for (const x of ST.setts) { const v = core.bountyOf(x); if (v > bb) { bb = v; b = x; } } return b; })();
    if (!s) return false;
    const b = core.bountyOf(s); if (b <= 0) return false;
    if (!core.spend(b, 'bounty')) { core.hud(`The fine in ${s.name} is ${b} gold`, 3); return false; }
    core.pset(`s${s.slot}.b`, 0);
    core.addRep(s, 2, 'paid fine');
    ev.emit('society:bounty', { place: s.name, slot: s.slot, bounty: 0, delta: -b, why: 'paid' });
    ev.emit('society:pardon', { place: s.name });
    core.hud(`Bounty paid: ${b} gold. ${s.name} forgives you.`, 3.5);
    core.note(`The player paid off a ${b} gold bounty in ${s.name}.`, false);
    return true;
  }
  // potions
  function drink(id) {
    if (inv(id) < 1) return false;
    const P = W.player; if (!P) return false;
    core.padd('inv.' + id, -1);
    applyPotion(id, P);
    return true;
  }
  function applyPotion(id, P) {
    const pot = DATA.POTIONS.find((p) => p.id === id); if (!pot) return;
    const t = now();
    if (id === 'heal') { P.heal?.(60); core.hud('You feel restored', 2); }
    else if (id === 'speed') { const b = ST.buffs.speed; if (b) b.until = t + pot.seconds; else { const d = 0.4 * (typeof P.speed === 'number' ? Math.max(1, P.speed) : 4); P.speed += d; ST.buffs.speed = { until: t + pot.seconds, delta: d }; } core.hud('Swift: +40% speed for a minute', 2.5); }
    else if (id === 'strength') { ST.buffs.strength = { until: t + pot.seconds }; applyStrength(); core.hud('Strong: weapons hit 50% harder for a minute', 2.5); }
    W.audio?.sfx?.('heal-chime', { volume: 0.5 });
    ev.emit('society:potion', { id });
  }
  function applyStrength() {
    const L = W.weapons?.list ? W.weapons.list() : []; for (const w of L) if (w.__socMul === undefined) { w.__socMul = w.dmgMul ?? 1; w.dmgMul = w.__socMul * 1.5; }
  }
  function endStrength() { const L = W.weapons?.list ? W.weapons.list() : []; for (const w of L) if (w.__socMul !== undefined) { w.dmgMul = w.__socMul; w.__socMul = undefined; } }
  function stepBuffs(dt) {
    const B = ST.buffs; if (!B.speed && !B.strength) return;
    const t = now();
    if (B.speed && t > B.speed.until) { const P = W.player; if (P && typeof P.speed === 'number') P.speed -= B.speed.delta; delete B.speed; core.hud('Swiftness fades', 2); }
    if (B.strength) { if (t > B.strength.until) { endStrength(); delete B.strength; core.hud('Strength fades', 2); } else applyStrength(); }
  }

  // ------------------------------------------------------------------ gifts to and from the people
  function onGive(n) { // the dialogue said [give]: a gift if this person likes you, else a price
    const t = core.CK.days, att = core.attitude(n);
    if (!isVendor(n) && att < 15) { core.bark(n, 'custom', 1, 'I have nothing to spare.'); return; }
    if (isVendor(n) && att < 25 || n.giftDay === t) {
      if (isVendor(n)) { core.bark(n, 'custom', 1, 'Everything has a price, friend. Have a look.'); try { W.menu?.open?.('society-market'); } catch (e) { /* menu absent */ } }
      else core.bark(n, 'custom', 1, 'I gave you what I could.');
      return;
    }
    n.giftDay = t;
    const g = DATA.GIFTS[n.role] || 'bread';
    const P = W.player;
    if (g === 'heal' || g === 'speed') { core.padd('inv.' + g, 1); core.hud(`${n.name || 'They'} gives you a ${g === 'heal' ? 'healing' : 'swiftness'} draught`, 3); }
    else if (g === 'dagger') { const o = W.weapons?.create(ctx, 'dagger', { position: front(0.7, -0.2) }); if (o) core.hud(`${n.name || 'The smith'} hands you a dagger`, 3); }
    else if (g === 'coins') { dropCoins(n.a.position.x + (head.x - n.a.position.x) * 0.4, n.a.position.y, n.a.position.z + (head.z - n.a.position.z) * 0.4, 25); core.hud(`${n.name || 'The king'} tosses you some coins`, 3); }
    else { P?.heal?.(g === 'bread' ? 20 : 5); core.hud(`${n.name || 'They'} gives you ${g === 'bread' ? 'a loaf of bread' : 'a flower'}`, 3); }
    core.bark(n, 'custom', 1, 'Take it, with my thanks.');
    core.memAdd(n, 3, 0);
    W.audio?.sfx?.('pickup', { at: n.a.position, volume: 0.6 });
  }
  function gift(x, gold = 10) { // the player gives gold to a person
    const n = x?.a ? x : npcs.get(x) || x?.society; if (!n || n.kind !== 'person') return false;
    gold = Math.round(gold); if (gold < 1 || !core.spend(gold, 'gift')) return false;
    core.memAdd(n, Math.min(25, 4 + gold / 4), 4);
    if (n.sett) core.addRep(n.sett, Math.min(1.5, gold / 30), 'gift');
    core.bark(n, 'event:thanks', 1);
    return true;
  }

  // ------------------------------------------------------------------ stall displays: grab an item and pay (or run)
  const displays = new Map();            // vendor npc -> { items: [], stall }
  let dispT = 0, flasks = [];
  const _ray = new THREE.Raycaster(), _dn = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3();
  function counterPoint(n) {
    const st = core.nearestPlace('stall', n.spawn.x, n.spawn.z, 6); if (!st) return null;
    const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
    const slots = [];
    for (let k = 0; k < 3; k++) {
      const lx = -0.7 + k * 0.7, lz = 0.38;
      const x = st.x + lx * c + lz * s, z = st.z - lx * s + lz * c;
      let y = ground(x, z) + 1.05;
      if (st.group) { _o.set(x, ground(x, z) + 1.75, z); _ray.set(_o, _dn); _ray.far = 1.4; const hit = _ray.intersectObject(st.group, true)[0]; if (hit && hit.point.y > ground(x, z) + 0.55) y = hit.point.y; }
      slots.push({ x, y: y + 0.04, z, yaw: st.yaw });
    }
    return { stall: st, slots };
  }
  function makeFlask(color) {
    const g = new THREE.Group();
    const glass = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.55 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.1, 8), glass); body.position.y = 0.05; g.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.05, 6), new THREE.MeshLambertMaterial({ color: 0xcfe0ee })); neck.position.y = 0.125; g.add(neck);
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.015, 0.02, 6), new THREE.MeshLambertMaterial({ color: 0x8a5a30 })); cork.position.y = 0.158; g.add(cork);
    g.userData.noOutline = true;
    return g;
  }
  function spawnItem(n, d, k, wareRef) {
    const K = W.kit, slot = d.slots[k]; if (!K) return null;
    const it = { k, ware: wareRef, price: 0, state: 'shown', body: null, weapon: null, label: null, x: slot.x, y: slot.y, z: slot.z, seen: 0, t0: now() };
    if (wareRef.kind === 'weapon') {
      const o = W.weapons?.create(ctx, wareRef.key, { position: { x: slot.x, y: slot.y + 0.12, z: slot.z } }); if (!o) return null;
      it.weapon = o; it.body = o.body; o.__socItem = true;
      o.body.invMass = 0; o.body.velocity.set(0, 0, 0);
      o.body.mesh.rotation.y = slot.yaw + Math.PI * 0.5;
    } else if (wareRef.kind === 'potion') {
      const pot = DATA.POTIONS.find((p) => p.id === wareRef.key);
      const f = makeFlask(pot.color);
      const b = K.body(ctx, f, { radius: 0.07, mass: 0.3, bounce: 0.1, grabbable: true, grabRange: 4, position: { x: slot.x, y: slot.y + 0.08, z: slot.z } });
      b.invMass = 0; it.body = b; it.flask = { id: wareRef.key, body: b, t0: now() };
    } else return null;
    it.body.mass0 = it.body.mass || 1;
    const lab = K.label(ctx, `${wareRef.name}`, { size: 0.055, color: 0xffe9a8 });
    lab.position.set(slot.x, slot.y + 0.32, slot.z); lab.show(false); it.label = lab;
    return it;
  }
  function dropItem(it) { try { it.label?.remove(); } catch (e) { /* gone */ } it.label = null; }
  function clearDisplay(n) {
    const d = displays.get(n); if (!d) return;
    for (const it of d.items) { if (!it) continue; dropItem(it); if (it.state === 'shown') { try { if (it.weapon) it.weapon.remove(); else it.body?.remove(); } catch (e) { /* gone */ } } }
    displays.delete(n);
  }
  const _from = new THREE.Vector3(), _dir = new THREE.Vector3();
  function canSee(n, tx, ty, tz, maxD = 15) {
    const a = n.a; if (a.dead || a.removed || n.hidden || n.state === 'flee') return false;
    const ex = a.position.x, ey = a.position.y + 1.5, ez = a.position.z;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez, dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > maxD) return false;
    const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
    if (dist > 2 && (dx * fx + dz * fz) / Math.max(0.1, Math.hypot(dx, dz)) < -0.35) return false; // looking the other way
    const P = W.physics;
    if (P && P.raycast && P.ready !== false && dist > 1.5) {
      _from.set(ex, ey, ez); _dir.set(dx / dist, dy / dist, dz / dist);
      try { const hit = P.raycast(_from, _dir, dist - 0.6, { groups: 'world' }); if (hit && hit.distance < dist - 0.6) return false; } catch (e) { /* no physics */ }
    }
    return true;
  }
  function watchers(owner, x, y, z) {
    const out = [];
    for (const o of npcs.values()) { if (o.kind !== 'person' || o.hidden) continue; if (o === owner ? canSee(o, x, y, z, 14) : canSee(o, x, y, z, 12)) out.push(o); }
    return out;
  }
  function snapBack(it) { // the item vanishes from the hand and is put back on the counter next tick
    it.state = 'refused'; dropItem(it);
    try { if (it.weapon) it.weapon.remove(); else it.body.remove(); } catch (e) { /* gone */ }
    it.respawn = true;
  }
  function takeFree(it, n, why) {
    it.state = 'stolen'; it.stolenAt = now(); it.owner = n; dropItem(it);
    if (it.body) it.body.invMass = 1 / (it.body.mass0 || 1);
    if (it.flask) flasks.push(it.flask);
    if (why) core.hud(why, 1.8);
  }
  function transact(n, d, it) {
    const sh = shopFor(n);
    const price = Math.max(1, Math.round(it.ware.base * sh.mult));
    const seen = watchers(n, it.body.position.x, it.body.position.y, it.body.position.z);
    if (!seen.length) { takeFree(it, n, 'Nobody is looking...'); return; }  // unwatched: it is yours, if nobody notices later
    if (!sh.open) { // the trader will not deal with you: grabbing is thieving, and everyone saw
      snapBack(it); caught(n, it, seen); return;
    }
    if (core.gold() >= price) {
      core.spend(price, 'buy ' + it.ware.name); paidTo(n, price, it.ware.name);
      it.state = 'owned'; it.t1 = now(); dropItem(it);
      if (it.body) it.body.invMass = 1 / (it.body.mass0 || 1);
      if (it.flask) flasks.push(it.flask);
      core.hud(`Bought ${it.ware.name} for ${price} gold`, 2.5);
    } else { // too poor: it snaps back onto the counter
      core.bark(n, 'event:poor', 1); core.hud(`${it.ware.name} costs ${price} gold`, 2.5); W.audio?.sfx?.('ui-error', { at: n.a.position, volume: 0.5 });
      snapBack(it);
    }
  }
  function caught(n, it, wit) {
    const s = n.sett;
    if (s) { core.addRep(s, -6, 'theft'); core.addBounty(s, 25, 'theft'); }
    for (const o of wit) core.memAdd(o, -12, 2);
    core.bark(wit[0], 'event:theft', 1);
    core.reactAt('startle', head.x, head.z, { radius: 8, short: true });
    core.note(`The player was caught stealing ${it.ware.name} in ${s ? s.name : 'the village'}.`, true);
    ev.emit('society:theft', { item: it.ware.name, place: s?.name });
  }
  function theftSeen(n, it) {
    const wit = watchers(n, head.x, head.y, head.z);
    if (!wit.length) return false;
    it.state = 'owned'; it.t1 = now();  // (a stolen item is just owned now; the consequences follow)
    caught(n, it, wit);
    return true;
  }
  function stepDisplays(dt) {
    dispT -= dt; if (dispT > 0) return; dispT = 0.25;
    const t = now();
    for (const n of npcs.values()) {
      if (n.role !== 'merchant') continue;
      const near = d2(n.a.position.x, n.a.position.z, head.x, head.z) < 26 * 26;
      const open = near && !n.hidden && n.state === 'work' && n.arrived !== false && shopFor(n).open;
      let d = displays.get(n);
      if (!open) { if (d) clearDisplay(n); continue; }
      if (!d) {
        const cp = counterPoint(n); if (!cp) continue;
        d = { items: [null, null, null], slots: cp.slots, stall: cp.stall }; displays.set(n, d);
      }
      const sh = shopFor(n);
      const shown = sh.wares.filter((w) => w.kind === 'weapon' || w.kind === 'potion');
      for (let k = 0; k < 3; k++) {
        let it = d.items[k];
        if (it && (it.respawn || (it.state === 'owned' && t - it.t1 > 12))) { d.items[k] = it = null; }
        if (!it) {
          const ref = shown.length ? shown[(k * 2 + core.CK.days + n.seed) % shown.length] : null; if (!ref) continue;
          d.items[k] = spawnItem(n, d, k, ref.ref); continue;
        }
        if (it.state === 'shown') {
          if (it.body.removed) { dropItem(it); d.items[k] = null; continue; }
          if (it.label) { const nearP = d2(it.x, it.z, head.x, head.z) < 7 * 7; it.label.show(nearP); if (nearP) { const pr = Math.max(1, Math.round(it.ware.base * sh.mult)); const txt = `${it.ware.name}  ${pr}g`; if (it.labelText !== txt) { it.labelText = txt; it.label.set(txt); } } }
          if (it.body.held) transact(n, d, it);
        } else if (it.state === 'stolen') {
          if (t - it.stolenAt > 30) { it.state = 'owned'; it.t1 = t; }
          else if (t - (it.checkT || 0) > 0.5) { it.checkT = t; theftSeen(it.owner || n, it); }
        }
      }
    }
    for (const [n] of displays) if (n.released || !npcs.has(n.a)) clearDisplay(n);
  }
  // flasks drunk by raising them to the head; flasks handed to a person are a gift
  function stepFlasks(dt) {
    if (!flasks.length) return;
    const t = now();
    for (let i = flasks.length - 1; i >= 0; i--) {
      const f = flasks[i], b = f.body;
      if (!b || b.removed || t - f.t0 > 400) { try { b?.remove(); } catch (e) { /* gone */ } flasks.splice(i, 1); continue; }
      if (b.held) {
        const h = hand(b.held);
        if (h) { const dx = h.position.x - head.x, dy = h.position.y - (head.y - 0.12), dz = h.position.z - head.z; if (dx * dx + dy * dy + dz * dz < 0.07) { const P = W.player; if (P) applyPotion(f.id, P); b.remove(); flasks.splice(i, 1); } }
        f.wasHeld = t;
      } else if (f.wasHeld && t - f.wasHeld < 2.5) {
        for (const n of npcs.values()) { // dropped at somebody's feet: a gift
          if (n.kind !== 'person' || n.hidden) continue;
          if (d2(n.a.position.x, n.a.position.z, b.position.x, b.position.z) < 1.2 * 1.2) { core.memAdd(n, 10, 4); if (n.sett) core.addRep(n.sett, 0.6, 'gift'); core.bark(n, 'event:thanks', 1); b.remove(); flasks.splice(i, 1); break; }
        }
      }
    }
  }

  // ------------------------------------------------------------------ the Market panel (world.menu)
  let menuRef = null, unreg = null;
  function panelSpec() {
    return {
      id: 'society-market', title: 'Market', icon: 'crate',
      sig: () => core.gold() + '|' + (vendorOf()?.nid ?? '') + '|' + tabId + '|' + core.bountyOf(core.settFor(head.x, head.z, 40)) + '|' + inv('heal') + inv('speed') + inv('strength') + '|' + (weaponHeld()?.type ?? ''),
      build(ui) {
        const s = core.settFor(head.x, head.z, 40) || ST.setts[0] || null;
        ui.heading(`${core.gold()} gold`, { right: s ? `${s.name}: ${DATA.band(core.repOf(s))}` : '' });
        const bounty = s ? core.bountyOf(s) : 0;
        if (bounty > 0) ui.row(() => { ui.text(`Wanted in ${s.name}: ${bounty} gold`, { color: '#ff9070', bold: true }); ui.button('Pay fine', () => { payBounty(s); ui.refresh(); }, { kind: 'danger', disabled: core.gold() < bounty }); });
        ui.choice([{ id: 'wares', label: 'Wares' }, { id: 'sell', label: 'Sell' }, { id: 'pack', label: 'Pack' }], () => tabId, (id) => { tabId = id; ui.refresh(); });
        ui.gap(6);
        const n = vendorOf();
        if (tabId === 'pack') {
          ui.text('Potions', { bold: true });
          for (const p of DATA.POTIONS) ui.row(() => { ui.text(`${p.name} x${inv(p.id)}`, { size: 14 }); ui.button('Drink', () => { drink(p.id); ui.refresh(); }, { disabled: inv(p.id) < 1, h: 34 }); });
          const B = ST.buffs; const act = Object.keys(B).map((k) => `${k} ${Math.max(0, Math.ceil(B[k].until - now()))}s`).join(', ');
          if (act) ui.text('Active: ' + act, { size: 13, color: '#9ad8ff' });
          return;
        }
        if (!n) { ui.text('No merchant nearby. Walk up to a stall, a smithy or a wizard to trade.', { size: 14 }); return; }
        const sh = shopFor(n);
        ui.text(`${n.name || 'The trader'} the ${n.role}${sh.open ? '' : ' ' + sh.reason}`, { size: 14, color: sh.open ? '#ffe9a8' : '#ff9070' });
        if (!sh.open) return;
        if (tabId === 'sell') {
          const w = sellTarget();
          if (!w) { ui.text('Hold a weapon out, or lay one at your feet, to sell it.', { size: 14 }); return; }
          const v = sellValue(w, n);
          ui.tile({ title: cap1(w.type), sub: `Sell for ${v} gold`, icon: 'sword', color: '#c8d0e0', onClick: () => { sell(); ui.refresh(); } });
          return;
        }
        ui.text(sh.mult < 1 ? `Friendly prices (${Math.round((1 - sh.mult) * 100)}% off)` : sh.mult > 1 ? `Unfriendly prices (+${Math.round((sh.mult - 1) * 100)}%)` : 'Fair prices', { size: 12, color: '#a8b0c0' });
        ui.grid(sh.wares, { id: 'wares', cols: 2, rows: 4, tile: (w) => ({ title: w.name, sub: `${w.price} gold`, icon: w.kind === 'weapon' ? 'sword' : w.kind === 'potion' ? 'heart' : w.kind === 'companion' ? 'paw' : w.kind === 'kit' ? 'house' : 'star', color: w.color, badge: w.kind === 'potion' ? 'x' + inv(w.ref.key) : undefined, active: core.gold() >= w.price, onClick: () => { buy(w.id); ui.refresh(); } }) });
      },
    };
  }
  function maintain() {
    const m = W.menu;
    const wanted = npcs.size > 0 || core.gold() > 0; // nothing is added to the menu until a settlement or gold exists
    if (!wanted && menuRef) { try { unreg?.(); } catch (e) { /* gone */ } unreg = null; menuRef = null; }
    else if (wanted && m && m !== menuRef && m.register) { try { unreg?.(); } catch (e) { /* gone */ } unreg = null; try { unreg = m.register(panelSpec()); menuRef = m; } catch (e) { core.warn('menu register failed', e); menuRef = null; } }
    else if (!m && menuRef) { menuRef = null; unreg = null; }
    // placed kits survive a reload of this file (session memory)
    if (!restored && W.library) { restored = true; for (const p of ST.placed.slice()) { try { W.library.spawn(ctx, p.lib, { x: p.x, z: p.z, yaw: p.yaw, noPush: true, ...(p.opts || {}) }); } catch (e) { /* skip */ } } }
  }
  let restored = false;

  function update(dt, t) {
    stepCoins(dt);
    stepBuffs(dt);
    if (displays.size || npcs.size) stepDisplays(dt);
    stepFlasks(dt);
  }
  function dispose() {
    for (const n of [...displays.keys()]) clearDisplay(n);
    for (let j = coinN - 1; j >= 0; j--) core.earn(cval[j], 'coin'); coinN = 0;
    try { unreg?.(); } catch (e) { /* gone */ } unreg = null; menuRef = null;
  }
  return { update, dispose, maintain, onKill, onQuest, onGive, shopFor, shop, buy, sell, drink, payBounty, gift, coinCount: () => coinN, dropCoins, applyPotion, panelSpec, vendorOf, get displays() { return displays; } };
}

