// core/society.js - world.society: the LIVING WORLD. It adopts the peaceful actors that already exist (villagers, farmers, merchants, smiths, bards, children, kings, guards,
// farm animals, pets) and gives them days, homes, work, meals, gossip, memory of the player, a bounty system and a gold economy. It never spawns people itself, except
// the few extra villagers/guards/lanterns of a growing settlement. Populate with the library ("a village", "a farm", "a market"); society animates what stands there.
//
// FOR THE AI   const S = ctx.world.society; if (!S) return {};
//   S.clock       { time (0..1 of a day: 0 midnight, .25 sunrise, .5 noon, .75 sunset), hour (0..24), phase, day, running, rate (day-fractions/s, default 1/1200 = 20 min), set(t|hour), pause(), resume() }
//                 It drives world.env.timeOfDay (night -> twilight -> golden noon) only while NPCs are adopted; it YIELDS to env.setTimeOfDay / weather / travel and holds ~90 s. S.clock.pause() before you restyle the sky.
//   S.adopt(actor, { role, home, work })  give any kit actor a life now ('villager','farmer','merchant','blacksmith','bard','child','king','wizard','guard'); home/work = {x,z} | Vector3 | Object3D | library handle. S.release(actor)
//   S.npc(actorOrId) -> { id, name, role, traits, relation, state, task, home, work, settlement, attitude, memory }   S.npcs()   S.settlements() -> [{ name, x, z, tier, reputation, band, bounty, npcs }]
//   S.gold   S.earn(n, why)  S.spend(n) -> bool    pay the player: S.earn(50, 'a reward')    S.reputation(settlementOrNpc?) -> -100..100 (nearest settlement by default)   S.bounty   S.payBounty()
//   S.shop(actor) -> { open, reason, wares: [{ id, name, price, kind, desc }] }   S.buy(id, merchant?)   S.sell()   S.drink(id)   S.say(actor, text) = a rate-limited bark
//   Events on ctx.events: society:reputation { place, value, delta, band, why }  society:gold { gold, delta, why }  society:bark { actor, text, kind }  society:bounty { place, bounty }  society:tier { place, tier }
// WHAT IT DOES   Daily routines by hour (sleep indoors, wake, work, meal, evening campfire/tavern); flee fights and return when calm; shelter from rain; react to the player (wave, back off from a drawn
//   weapon, crowd round spectacles, cheer kills, mourn the dead). Barks are rate-limited (one every ~4.5 s near the player). Each NPC has a stable name, two traits and a relation written to
//   actor.npcName / actor.persona / actor.voiceId, and voices.js talk gets mood, activity and memory of the player (contextProviders.npc is wrapped).
//   Harming villagers drops the settlement's reputation and sets a BOUNTY: guards turn hostile at 30, merchants refuse to trade; pay it (panel 'Market' or S.payBounty()) or wait it out (-8 per game hour).
//   Protecting and trading raises prosperity: tiers add lanterns, a stall, villagers, a guard. Gold: quests, coins from slain enemies, selling weapons; spend at stalls (grab an item off the display, or the Market panel).
// HOOKS you can set on any group: group.userData.society = { kind:'house'|'tavern'|'church'|'smithy'|'stall'|'well'|'fire'|'crops'|'barn'|'tower', door:[lx,lz], cap, role }. See docs/SOCIETY.md.
// Profile data lives under quests stats 'society.*' (gold, per-settlement s0..s3, per-NPC memory). Budgets: <= 40 adopted on Quest (80 PC), each NPC thinks ~2x/s staggered, nothing runs without adoptable actors.

export const meta = { name: 'Society', description: 'Daily routines, reputation, bounty, gold economy and growing settlements for peaceful NPCs.' };

export default async function (ctx) {
  const THREE = ctx.THREE;
  const W = ctx.world, ev = ctx.events, ST = ctx.state;
  const q = (() => { try { return new URL(import.meta.url).search; } catch (e) { return ''; } })();
  const DATA = await import(`../society/data.js${q}`);
  const BARKS = await import(`../society/barks.js${q}`);

  // ------------------------------------------------------------------ state that survives hot reloads of this file
  ST.clock ??= { time: -1, rate: 1 / 1200, running: true, hold: 0, lastTod: -1, days: 0, rising: true, hours: 0, ext: false };
  ST.pending ??= [];                 // profile writes made before quests had loaded
  ST.claimed ??= {};                 // settlement slot -> true (this session)
  ST.placed ??= [];                  // things the player bought and placed: re-created after a reload of this file
  ST.buffs ??= {};                   // potion buffs { id: { until, delta } }
  ST.setts ??= [];
  ST.seen ??= 0;
  const CK = ST.clock;

  // ------------------------------------------------------------------ utilities
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const now = () => (ctx.clock ? ctx.clock.t : 0);
  const head = ctx.player.head;
  const ground = (x, z) => ctx.groundAt(x, z);
  const d2 = (ax, az, bx, bz) => (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
  const r1 = (v) => Math.round(v * 10) / 10;
  const warn = (...a) => { try { console.warn('[society]', ...a); } catch (e) { /* no console */ } };
  const tierQuest = () => (ctx.quality?.tier || 'quest') === 'quest';
  const capNpcs = () => (tierQuest() ? 40 : 80);
  const hud = (t, s = 3) => { try { ctx.hud?.show?.(t, s); } catch (e) { /* no hud */ } };
  const note = (line, dramatic) => { try { W.commentary?.note?.(line, { dramatic: !!dramatic }); } catch (e) { /* commentary reloading */ } };
  const hour = () => CK.time * 24;
  const core = { ctx, THREE, W, ev, ST, DATA, BARKS, CK, TAU, clamp, rand, pick, hash, now, head, ground, d2, num, r1, warn, hud, note, hour, tierQuest, capNpcs };

  // ------------------------------------------------------------------ profile store (quests stats 'society.*'; numbers only)
  const Qr = () => { const Q = W.quests; return Q && Q.ready ? Q : null; };
  function pget(path) { const Q = Qr(); if (!Q) { let v = 0; for (const op of ST.pending) if (op.path === path) v = op.op === 'set' ? op.v : v + op.v; return v; } return num(Q.stat('society.' + path)); }
  function padd(path, d) { if (!d) return pget(path); const Q = Qr(); if (!Q) { ST.pending.push({ op: 'add', path, v: d }); return pget(path); } return num(Q.stat('society.' + path, d)); }
  function pset(path, v) { const Q = Qr(); if (!Q) { ST.pending.push({ op: 'set', path, v }); return v; } const cur = num(Q.stat('society.' + path)); if (cur !== v) Q.stat('society.' + path, v - cur); return v; }
  function hydrate() {
    if (!ST.pending.length || !Qr()) return;
    const ops = ST.pending.splice(0);
    for (const op of ops) { if (op.op === 'set') pset(op.path, op.v); else padd(op.path, op.v); }
  }
  core.pget = pget; core.padd = padd; core.pset = pset;
  // per-NPC memory packs into one number: (affinity + 100) + talks * 1000 + flags * 100000  (flags: 1 helped, 2 hurt, 4 gifted, 8 saw a killing)
  const packMem = (m) => clamp(Math.round(m.aff), -100, 100) + 100 + clamp(m.talks | 0, 0, 99) * 1000 + (m.flags & 15) * 100000;
  const unpackMem = (v, m) => { v = num(v); if (!v) { m.aff = 0; m.talks = 0; m.flags = 0; return m; } m.aff = (v % 1000) - 100; m.talks = Math.floor(v / 1000) % 100; m.flags = Math.floor(v / 100000) & 15; return m; };

  // ------------------------------------------------------------------ gold
  const goldNow = () => Math.max(0, pget('gold'));
  function earn(n, why = '') {
    n = Math.round(num(n)); if (n <= 0) return goldNow();
    const g = padd('gold', n);
    ev.emit('society:gold', { gold: g, delta: n, why });
    return g;
  }
  function spend(n, why = '') {
    n = Math.round(num(n)); if (n < 0) return false;
    if (n === 0) return true;
    if (goldNow() < n) return false;
    const g = padd('gold', -n);
    ev.emit('society:gold', { gold: g, delta: -n, why });
    return true;
  }
  core.earn = earn; core.spend = spend; core.gold = goldNow;

  // ------------------------------------------------------------------ the clock
  let skyOwned = false, weatherKind = 'clear';
  const env = () => W.env;
  const phaseNow = () => DATA.phaseOf(hour());
  const clock = {
    get time() { return CK.time < 0 ? 0.25 : CK.time; }, get hour() { return clock.time * 24; }, get phase() { return DATA.phaseOf(clock.hour); }, get day() { return CK.days; },
    get running() { return CK.running; }, set running(v) { CK.running = !!v; },
    get rate() { return CK.rate; }, set rate(v) { if (isFinite(v) && v >= 0) CK.rate = +v; },
    get external() { return CK.ext || CK.hold > 0; },
    set(t) { t = +t; if (!isFinite(t)) return clock; if (t > 1) t /= 24; CK.time = ((t % 1) + 1) % 1; CK.rising = CK.time < 0.5; CK.hold = 0; writeSky(true); return clock; },
    pause() { CK.running = false; return clock; }, resume() { CK.running = true; return clock; },
  };
  core.clock = clock;
  function writeSky(force) {
    const E = env(); if (!E || !E.setTimeOfDay || E.passthrough) return;
    if (!force && (skyOwned || CK.hold > 0 || W.travel?.current)) return;
    const v = clamp(DATA.todFromTime(CK.time), 0, 1);
    if (!force && Math.abs(v - CK.lastTod) < 0.004) return;
    try { E.setTimeOfDay(v); CK.lastTod = E.timeOfDay ?? v; } catch (e) { warn('setTimeOfDay failed', e); }
  }
  function clockStep(dt) {
    const E = env();
    if (CK.time < 0) { CK.time = DATA.timeFromTod(E?.timeOfDay ?? 0.5, true); CK.rising = true; CK.lastTod = E?.timeOfDay ?? 0.5; }
    const tod = E?.timeOfDay;
    if (typeof tod === 'number' && Math.abs(tod - CK.lastTod) > 0.003) { // somebody else set the time of day (the Omnissiah, a weather effect restoring it, travel): adopt it and yield
      CK.time = DATA.timeFromTod(tod, CK.rising); CK.lastTod = tod; CK.hold = 90; CK.ext = true;
    }
    if (CK.hold > 0) { CK.hold -= dt; if (CK.hold <= 0) { CK.ext = false; CK.lastTod = typeof tod === 'number' ? tod : CK.lastTod; } return; }
    if (skyOwned || W.travel?.current) { CK.ext = true; if (typeof tod === 'number') { CK.time = DATA.timeFromTod(tod, CK.rising); CK.lastTod = tod; } return; }
    CK.ext = false;
    if (!CK.running) return;
    const prev = CK.time;
    CK.time += dt * CK.rate;
    CK.hours += dt * CK.rate * 24;
    if (CK.time >= 1) { CK.time -= 1; CK.days++; onNewDay(); }
    if ((prev < 0.5) !== (CK.time < 0.5)) CK.rising = CK.time < 0.5;
    writeSky(false);
    if (CK.hours >= 1) { const h = Math.floor(CK.hours); CK.hours -= h; hourly(h); }
  }

  // ------------------------------------------------------------------ places and settlements
  const places = []; const placeMap = new Map();
  let scanR = 0, scanC = 0, scanEpoch = 1, scanWait = 0, placesChanged = false, placesReady = false, scanSky = {}, scanStarted = false;
  core.places = places;
  const kindOfName = (nm) => { for (const [re, info] of DATA.STRUCT) if (re.test(nm)) return info; return null; };
  function makePlace(g, nm, info, ud) {
    const p = { id: g.uuid, name: nm, kind: ud?.kind || info.kind, group: g, x: g.position.x, z: g.position.z, yaw: g.rotation.y, depth: info.depth, doorOff: info.door, cap: ud?.cap ?? info.cap ?? 0, guards: !!info.guards,
      door: { x: 0, z: 0 }, doorOk: false, ud, residents: 0, seen: scanEpoch, r: info.depth, sett: null, vec: { x: g.position.x, y: 0, z: g.position.z }, synth: false };
    placeDoor(p);
    return p;
  }
  const _bb = new THREE.Box3(), _sz = new THREE.Vector3();
  function placeDoor(p) {
    const g = p.group;
    p.x = g.position.x; p.z = g.position.z; p.yaw = g.rotation.y;
    let half = p.depth;
    if (p.ud?.door && Array.isArray(p.ud.door)) { // explicit door in local metres [lx, lz]
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), lx = p.ud.door[0], lz = p.ud.door[1];
      p.door.x = p.x + lx * c + lz * s; p.door.z = p.z - lx * s + lz * c; p.doorOk = true; p.vec.y = ground(p.x, p.z); return p;
    }
    if (p.ud?.door && typeof p.ud.door === 'object') { p.door.x = p.ud.door.x; p.door.z = p.ud.door.z; p.doorOk = true; p.vec.y = ground(p.x, p.z); return p; }
    if (!p.synth && p.doorOff > 0 && (p.kind === 'house' || p.kind === 'tavern' || p.kind === 'church' || p.kind === 'smithy')) {
      _bb.makeEmpty(); try { _bb.setFromObject(g); } catch (e) { /* odd child */ }
      if (!_bb.isEmpty()) { _bb.getSize(_sz); const h2 = Math.max(_sz.x, _sz.z) * 0.5; if (h2 > 0.8 && h2 < 9) { half = Math.max(half, h2 * 0.8); p.doorOk = true; } }
    } else p.doorOk = true;
    p.r = half;
    const d = half + p.doorOff;
    p.door.x = p.x + Math.sin(p.yaw) * d; p.door.z = p.z + Math.cos(p.yaw) * d;
    p.vec.y = ground(p.x, p.z);
    return p;
  }
  function addScenarioPlaces(g, name) {
    const sc = DATA.SCENARIO[name]; if (!sc) return;
    const c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);
    const wx = (lx, lz) => g.position.x + lx * c + lz * s, wz = (lx, lz) => g.position.z - lx * s + lz * c;
    const mk = (suffix, kind, lx, lz, r) => {
      const id = g.uuid + ':' + suffix; let p = placeMap.get(id);
      if (!p) {
        p = { id, name: name + ':' + suffix, kind, group: g, x: wx(lx, lz), z: wz(lx, lz), yaw: g.rotation.y, depth: r, doorOff: 0, cap: kind === 'barn' ? 12 : 0, guards: false, door: { x: wx(lx, lz), z: wz(lx, lz) }, doorOk: true, residents: 0, seen: scanEpoch, r, sett: null, vec: { x: wx(lx, lz), y: ground(wx(lx, lz), wz(lx, lz)), z: wz(lx, lz) }, synth: true };
        placeMap.set(id, p); places.push(p); placesChanged = true;
      } else p.seen = scanEpoch;
    };
    if (sc.barn) mk('barn', 'barn', sc.barn[0], sc.barn[1] + 0.8, 4);
    if (sc.crops) mk('crops', 'crops', sc.crops[0][0], sc.crops[0][1], sc.crops[1]);
    if (sc.pen) mk('pen', 'pen', sc.pen[0], sc.pen[1], sc.pen[2]);
    // the scenario group itself marks a settlement kind (used to name it)
  }
  function scanStep(budget) {
    const sc = ctx.scene.children;
    while (budget > 0) {
      if (scanR >= sc.length) { finishScan(); return; }
      const root = sc[scanR]; const ch = root.children;
      if (!ch || scanC >= ch.length) { scanR++; scanC = 0; budget--; continue; }
      const g = ch[scanC++]; budget--;
      if (!g || !g.isObject3D) continue;
      const ud = g.userData && g.userData.society;
      let nm = g.name;
      if (ud || (nm && nm.length > 4 && nm.charCodeAt(0) === 108 && nm.charCodeAt(3) === 58)) {
        if (nm.startsWith('lib:')) { nm = nm.slice(4); const st = nm.indexOf('*'); if (st > 0) nm = nm.slice(0, st); }
        if (DATA.SKY_OWNERS.has(nm)) scanSky[nm] = true;
        let p = placeMap.get(g.uuid);
        if (p) { p.seen = scanEpoch; if (!p.doorOk) placeDoor(p); else if (Math.abs(p.x - g.position.x) + Math.abs(p.z - g.position.z) > 0.5) { placeDoor(p); placesChanged = true; } continue; }
        if (DATA.SCENARIO[nm]) { addScenarioPlaces(g, nm); }
        const info = ud ? { kind: ud.kind || 'prop', door: 1, depth: ud.depth || 2, cap: ud.cap, guards: !!ud.guards } : kindOfName(nm);
        if (!info) continue;
        p = makePlace(g, nm, info, ud);
        placeMap.set(g.uuid, p); places.push(p); placesChanged = true;
      }
    }
  }
  function finishScan() {
    for (let i = places.length - 1; i >= 0; i--) {
      const p = places[i];
      if (p.seen !== scanEpoch || (p.group.parent === null)) { placeMap.delete(p.id); places[i] = places[places.length - 1]; places.pop(); placesChanged = true; }
    }
    // scenario places whose parent group is still there but were not re-added this pass keep seen via addScenarioPlaces; others dropped above
    skyOwned = false; weatherKind = 'clear';
    for (const k in scanSky) { if (DATA.SKY_OWNERS.has(k)) skyOwned = true; }
    weatherKind = scanSky.storm ? 'storm' : scanSky.rain ? 'rain' : scanSky.snow ? 'snow' : 'clear';
    scanSky = {};
    core.rainy = weatherKind !== 'clear'; core.weatherKind = weatherKind;
    scanEpoch++; scanR = 0; scanC = 0; scanWait = 2.5;
    placesReady = true;
    if (placesChanged) { placesChanged = false; rebuildSettlements(); }
  }
  const ANCHOR = new Set(['house', 'tavern', 'church', 'smithy', 'stall', 'well', 'barn', 'mill', 'tower']);
  function claimSlot(cx, cz, used) {
    let best = -1, bd = 1e9;
    for (let s = 0; s < 4; s++) { if (ST.claimed[s] || used.has(s)) continue; const v = pget(`s${s}.v`); if (v <= 0) continue; const dd = Math.sqrt(d2(pget(`s${s}.x`), pget(`s${s}.z`), cx, cz)); if (dd < 60 && dd < bd) { bd = dd; best = s; } }
    if (best < 0) { let bg = -1e9; for (let s = 0; s < 4; s++) { if (ST.claimed[s] || used.has(s)) continue; const v = pget(`s${s}.v`); if (v <= 0) continue; const g = pget(`s${s}.g`) + v * 0.01; if (g > bg) { bg = g; best = s; } } }
    if (best < 0) for (let s = 0; s < 4; s++) if (!ST.claimed[s] && !used.has(s) && pget(`s${s}.v`) <= 0) { best = s; break; }
    if (best < 0) { let lo = 1e9; for (let s = 0; s < 4; s++) { if (ST.claimed[s] || used.has(s)) continue; const sc = pget(`s${s}.g`) + pget(`s${s}.v`); if (sc < lo) { lo = sc; best = s; } } if (best >= 0) for (const k of ['r', 'b', 'g', 'v', 'k']) pset(`s${best}.${k}`, 0); }
    if (best < 0) best = 3; // everything claimed this session: share the last slot
    return best;
  }
  function rebuildSettlements() {
    const anchors = places.filter((p) => ANCHOR.has(p.kind));
    const par = anchors.map((_, i) => i);
    const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) if (d2(anchors[i].x, anchors[i].z, anchors[j].x, anchors[j].z) < 42 * 42) par[find(i)] = find(j);
    const groups = new Map();
    for (let i = 0; i < anchors.length; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(anchors[i]); }
    const prev = ST.setts, next = [], used = new Set();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      let cx = 0, cz = 0; for (const p of list) { cx += p.x; cz += p.z; } cx /= list.length; cz /= list.length;
      let r = 0; for (const p of list) r = Math.max(r, Math.sqrt(d2(p.x, p.z, cx, cz)));
      let s = null, bd = 30;
      for (const o of prev) { if (used.has(o.slot) || o.taken) continue; const dd = Math.sqrt(d2(o.cx, o.cz, cx, cz)); if (dd < bd) { bd = dd; s = o; } }
      if (s) { s.taken = true; } else {
        const slot = claimSlot(cx, cz, used);
        s = { slot, name: DATA.SETTLE_NAMES[(slot * 5 + (hash('sett' + slot) % 3)) % DATA.SETTLE_NAMES.length], items: [], fire: null, tier: -1, threat: 0, taken: true, spotsAt: 0, gatherSpot: null, mealSpot: null, growthT: 0, cheerT: 0, protT: 0, protN: 0 };
        if (!ST.claimed[slot]) {
          ST.claimed[slot] = true;
          const v = pget(`s${slot}.v`); padd(`s${slot}.v`, 1);
          if (v > 0 && pget(`s${slot}.r`) >= 6) padd(`s${slot}.g`, 1); // a return visit to a settlement you are on good terms with: it grows a little
        }
      }
      used.add(s.slot);
      s.cx = cx; s.cz = cz; s.r = r + 12; s.kind = 'village';
      s.places = list.slice();
      for (const p of places) if (!ANCHOR.has(p.kind) && d2(p.x, p.z, cx, cz) < s.r * s.r) s.places.push(p);
      for (const p of s.places) p.sett = s;
      for (const p of places) { if (p.synth && d2(p.x, p.z, cx, cz) < (s.r + 10) ** 2 && !s.places.includes(p)) { s.places.push(p); p.sett = s; } }
      s.kind = s.places.some((p) => p.name.startsWith('farm:')) ? 'farm' : s.places.some((p) => p.kind === 'stall') && s.places.length > 8 ? 'market' : 'village';
      pset(`s${s.slot}.x`, Math.round(cx)); pset(`s${s.slot}.z`, Math.round(cz));
      pickSpots(s);
      next.push(s);
    }
    for (const o of prev) if (!o.taken) { for (const it of o.items) { try { it.h?.remove?.(); } catch (e) { /* gone */ } } o.items.length = 0; try { o.fire?.remove?.(); } catch (e) { /* gone */ } o.fire = null; }
    for (const s of next) s.taken = false;
    ST.setts = next;
    core.setts = next;
    for (const n of core.npcs.values()) core.rebind(n);
    ev.emit('society:settlements', { count: next.length });
  }
  const firstOf = (s, kinds) => { for (const k of kinds) for (const p of s.places) if (p.kind === k) return p; return null; };
  function pickSpots(s) {
    const fire = firstOf(s, ['fire']), tav = firstOf(s, ['tavern']), well = firstOf(s, ['well']), stall = firstOf(s, ['stall']);
    const sp = (p, useDoor) => (p ? { x: useDoor ? p.door.x : p.x, z: useDoor ? p.door.z : p.z, vec: p.vec, place: p, r: p.kind === 'fire' ? 2.4 : p.kind === 'tavern' ? 2.8 : 2.8 } : null);
    s.gatherSpot = sp(fire, false) || sp(tav, true) || sp(well, false) || { x: s.cx, z: s.cz, vec: { x: s.cx, y: ground(s.cx, s.cz), z: s.cz }, place: null, r: 3 };
    s.mealSpot = sp(well, false) || sp(stall, true) || sp(tav, true) || { x: s.cx, z: s.cz, vec: { x: s.cx, y: ground(s.cx, s.cz), z: s.cz }, place: null, r: 3 };
    s.needFire = !fire;
    const house = firstOf(s, ['house']);
    s.guardPost = firstOf(s, ['tower']) || firstOf(s, ['well']) || house;
  }
  const settFor = (x, z, extra = 20) => { let best = null, bd = 1e12; for (const s of ST.setts) { const dd = d2(x, z, s.cx, s.cz); const lim = (s.r + extra) ** 2; if (dd < lim && dd < bd) { bd = dd; best = s; } } return best; };
  core.settFor = settFor;
  const nearestPlace = (kind, x, z, maxD = 60, sett = null) => { let best = null, bd = maxD * maxD; for (const p of places) { if (p.kind !== kind) continue; if (sett && p.sett !== sett) continue; const dd = d2(p.x, p.z, x, z); if (dd < bd) { bd = dd; best = p; } } return best; };
  core.nearestPlace = nearestPlace; core.firstOf = firstOf;

  // ------------------------------------------------------------------ reputation, bounty, prosperity (per settlement slot)
  const repOf = (s) => (s ? num(pget(`s${s.slot}.r`)) : 0);
  const bountyOf = (s) => (s ? Math.max(0, num(pget(`s${s.slot}.b`))) : 0);
  const growthOf = (s) => (s ? num(pget(`s${s.slot}.g`)) : 0);
  const tierOf = (s) => { const g = growthOf(s); let t = 0; for (const th of DATA.TIER_AT) if (g >= th) t++; return t; };
  function addRep(s, delta, why = '') {
    if (!s || !delta) return 0;
    const before = repOf(s), after = clamp(r1(before + delta), -100, 100);
    if (after === before) return before;
    pset(`s${s.slot}.r`, after);
    const b0 = DATA.band(before), b1 = DATA.band(after);
    ev.emit('society:reputation', { place: s.name, slot: s.slot, value: after, delta: r1(after - before), band: b1, why });
    if (b0 !== b1) note(`${s.name} now regards the player as ${b1} (${Math.round(after)} of 100).`, Math.abs(after) >= 25);
    return after;
  }
  function addBounty(s, n, why = '') {
    if (!s || !n) return 0;
    const before = bountyOf(s), after = clamp(Math.round(before + n), 0, 500);
    if (after === before) return before;
    pset(`s${s.slot}.b`, after);
    ev.emit('society:bounty', { place: s.name, slot: s.slot, bounty: after, delta: after - before, why });
    if (before < DATA.BOUNTY_HOSTILE && after >= DATA.BOUNTY_HOSTILE) { hud(`Wanted in ${s.name}: ${after} gold`, 3.5); note(`The player is now wanted in ${s.name} (bounty ${after} gold); the guards are hostile.`, true); }
    if (before > 0 && after === 0) note(`The bounty on the player in ${s.name} has been cleared.`, false);
    return after;
  }
  function addGrowth(s, n, why = '') {
    if (!s || !n) return 0;
    const before = growthOf(s), after = clamp(r1(before + n), -20, 90);
    pset(`s${s.slot}.g`, after);
    const t0 = tierOf({ slot: s.slot }), prevTier = s.tier;
    if (t0 !== prevTier) applyTier(s);
    return after;
  }
  core.repOf = repOf; core.bountyOf = bountyOf; core.growthOf = growthOf; core.tierOf = tierOf; core.addRep = addRep; core.addBounty = addBounty; core.addGrowth = addGrowth;
  function hourly(h) { // in-game hours passed: bounties wear off while you keep your head down
    for (let s = 0; s < 4; s++) { const b = num(pget(`s${s}.b`)); if (b > 0) { const nb = Math.max(0, b - DATA.BOUNTY_DECAY_PER_HOUR * h); pset(`s${s}.b`, nb); const sett = ST.setts.find((x) => x.slot === s); if (sett && b >= DATA.BOUNTY_HOSTILE && nb < DATA.BOUNTY_HOSTILE) { ev.emit('society:bounty', { place: sett.name, slot: s, bounty: nb, delta: nb - b, why: 'time' }); if (nb === 0) ev.emit('society:pardon', { place: sett.name }); } } }
  }
  function onNewDay() {
    for (const s of ST.setts) {
      const r = repOf(s), b = bountyOf(s);
      if (r >= 25 && b < 10) addGrowth(s, 1, 'day'); else if (r <= -30) addGrowth(s, -1, 'day');
      if (r > 0) pset(`s${s.slot}.r`, r1(r - 0.5)); else if (r < 0) pset(`s${s.slot}.r`, r1(r + 0.5)); // people forget a little
    }
  }

  // ------------------------------------------------------------------ NPC registry, identity, memory
  const npcs = new Map();           // actor -> npc
  const byNid = new Map();
  core.npcs = npcs; core.byNid = byNid;
  ST.ord ??= {};
  const genderOf = (a, role) => { const m = String(a.mdl?.name || a.role || ''); if (/female|woman|girl|queen/.test(m)) return 'f'; if (/\bmale|\bman\b|boy|king/.test(m)) return 'm'; return role === 'bard' ? 'f' : role === 'king' || role === 'blacksmith' || role === 'farmer' ? 'm' : null; };
  function assignIdentity(n) {
    const slot = n.sett ? n.sett.slot : -1, role = n.role;
    const key = slot + '|' + role;
    const ord = (ST.ord[key] = (ST.ord[key] ?? -1) + 1);
    n.ord = ord;
    const seed = slot >= 0 ? hash(`${slot}|${role}|${ord % 6}`) : hash(`free|${n.a.id}`);
    n.seed = seed;
    n.nid = slot >= 0 ? `${slot}${role.slice(0, 3)}${ord % 6}` : `x${n.a.id}`;
    n.persist = slot >= 0 && ord < 6;
    if (byNid.has(n.nid) && byNid.get(n.nid) !== n) n.nid += '_' + n.a.id; // more than six of a role: the extras are not remembered
    byNid.set(n.nid, n);
    if (n.kind === 'animal') { n.name = null; n.traits = []; n.rel = null; n.persist = false; return; }
    const g = n.gender = genderOf(n.a, role) || ((seed & 1) ? 'f' : 'm');
    const list = g === 'f' ? DATA.NAMES_F : DATA.NAMES_M;
    let name = list[seed % list.length], tries = 0;
    const taken = new Set(); for (const o of npcs.values()) if (o !== n && o.name) taken.add(o.name);
    while (taken.has(name) && tries++ < list.length) name = list[(seed + tries * 7) % list.length];
    n.name = name;
    const t1 = DATA.TRAITS[(seed >>> 3) % DATA.TRAITS.length]; let t2 = DATA.TRAITS[(seed >>> 9) % DATA.TRAITS.length]; if (t2 === t1) t2 = DATA.TRAITS[((seed >>> 9) + 5) % DATA.TRAITS.length];
    n.traits = [t1, t2];
    n.rel = null;
    const others = []; for (const o of npcs.values()) if (o !== n && o.kind === 'person' && o.sett === n.sett && o.name && o.nid !== n.nid) others.push(o);
    if (others.length) { const o = others[(seed >>> 5) % others.length]; n.rel = { type: DATA.RELATIONS[(seed >>> 11) % DATA.RELATIONS.length], nid: o.nid, name: o.name, role: o.role }; }
    unpackMem(n.persist ? pget(`n.${n.nid}`) : 0, n.mem);
    n.a.npcName = n.name;
    n.a.voiceId = n.nid;
    refreshPersona(n);
  }
  function saveMem(n) { if (n.persist) pset(`n.${n.nid}`, packMem(n.mem)); }
  function memAdd(n, aff, flag = 0, talk = 0) { n.mem.aff = clamp(n.mem.aff + aff, -100, 100); n.mem.flags |= flag; n.mem.talks = clamp(n.mem.talks + talk, 0, 99); saveMem(n); }
  const attitude = (n) => (n.sett ? repOf(n.sett) : 0) * 0.6 + n.mem.aff * 0.4;
  const activityText = (n) => ({ sleep: 'about to sleep', wake: 'just up for the day', work: ({ farmer: 'tending the crops', blacksmith: 'working the forge', merchant: 'minding your stall', bard: 'playing for coins', child: 'playing tag', guard: 'on patrol', king: 'holding court', wizard: 'pondering', villager: 'doing your chores' })[n.role] || 'working', meal: 'eating your meal', gather: 'resting by the fire', shelter: 'sheltering from the weather', flee: 'running from danger', return: 'getting back to normal' })[n.state] || 'going about your day';
  function refreshPersona(n) {
    if (n.kind === 'animal' || !n.name) return;
    const a = n.a, s = n.sett, att = attitude(n), r = s ? repOf(s) : 0;
    let m = '';
    if (n.mem.flags & 2) m = 'The player hurt you once; you are wary.';
    else if (n.mem.flags & 8) m = 'You saw the player kill a neighbour; you fear them.';
    else if (n.mem.flags & 1) m = 'The player once helped you; you are grateful.';
    else if (att >= 25) m = 'You like the player.'; else if (att <= -25) m = 'You distrust the player.';
    if (n.mem.flags & 4 && !(n.mem.flags & 2)) m += ' They gave you a gift.';
    const bits = [`${n.name}, a ${n.traits[0]}, ${n.traits[1]} ${DATA.ROLE_INFO[n.role]?.text || n.role}${s ? ' of ' + s.name : ''}.`];
    if (n.rel) bits.push(`${n.rel.type[0].toUpperCase()}${n.rel.type.slice(1)} of ${n.rel.name} the ${n.rel.role}.`);
    bits.push(`It is ${DATA.phaseOf(hour())}; you are ${activityText(n)}.`);
    if (m) bits.push(m);
    if (s && bountyOf(s) >= DATA.BOUNTY_HOSTILE) bits.push('The player is wanted here.');
    let p = bits.join(' ');
    if (p.length > DATA.PERSONA_MAX) p = p.slice(0, DATA.PERSONA_MAX - 1).replace(/\s+\S*$/, '') + '.';
    a.persona = p;
    return p;
  }
  core.refreshPersona = refreshPersona; core.memAdd = memAdd; core.attitude = attitude; core.saveMem = saveMem;

  // ------------------------------------------------------------------ barks (rate limited, authored pools)
  core.lastBark = -99; core.barkGap = 4.5; core.barkQueue = [];
  const fmt = (s, n) => s.replace('{place}', n?.sett?.name || 'this place').replace('{friend}', n?.rel?.name || 'old Wat');
  function linePool(n, kind) {
    switch (kind) {
      case 'greet': return BARKS.GREET[n.role === 'child' ? 'child' : DATA.greetBand(attitude(n))];
      case 'work': return BARKS.WORK[n.role] || BARKS.WORK.villager;
      case 'meal': return BARKS.MEAL; case 'gather': return BARKS.EVENING; case 'sleep': return BARKS.SLEEPY; case 'wake': return BARKS.DAWN;
      case 'weather': return BARKS.WEATHER[weatherKind] || BARKS.WEATHER.clear;
      case 'time': { const p = phaseNow(); return p === 'night' ? BARKS.TIME.night : p === 'dawn' ? BARKS.TIME.dawn : p === 'evening' ? BARKS.TIME.dusk : null; }
      case 'memory': return (n.mem.flags & 8) ? BARKS.MEMORY.killer : (n.mem.flags & 2) ? BARKS.MEMORY.hurt : (n.mem.flags & 1) ? BARKS.MEMORY.helped : (n.mem.flags & 4) ? BARKS.MEMORY.gifted : n.mem.talks > 0 ? BARKS.MEMORY.talked : null;
      case 'ally': return BARKS.ALLY;
      default: return kind.startsWith('event:') ? BARKS.EVENT[kind.slice(6)] : null;
    }
  }
  function lineFor(n, kind) {
    const pool = linePool(n, kind); if (!pool || !pool.length) return null;
    let s = pool[(Math.random() * pool.length) | 0];
    if (s === n.lastLine && pool.length > 1) s = pool[(Math.random() * pool.length) | 0];
    n.lastLine = s;
    return fmt(s, n);
  }
  // say(n, kind|{text}) -> true if the bark was spoken. prio 1 = event (allowed after 1.5 s), 0 = ambient (after the barkGap).
  function bark(n, kind, prio = 0, text = null) {
    const a = n.a; if (!a || a.dead || a.removed || n.hidden || n.kind === 'animal') return false;
    const t = now();
    const near = d2(a.position.x, a.position.z, head.x, head.z) < 26 * 26;
    if (!near) return false;
    if (t - core.lastBark < (prio ? 1.5 : core.barkGap)) return false;
    const line = text || lineFor(n, kind); if (!line) return false;
    core.lastBark = t;
    n.ownSay = true; try { a.say(line, Math.max(2.8, Math.min(5, line.length * 0.075))); } finally { n.ownSay = false; }
    n.nextBark = t + rand(24, 55);
    ev.emit('society:bark', { actor: a, text: line, kind, npc: n });
    return true;
  }
  core.bark = bark; core.lineFor = lineFor;
  function say(actorOrNpc, text) { const n = actorOrNpc?.a ? actorOrNpc : npcs.get(actorOrNpc); if (!n) return false; return bark(n, 'custom', 1, String(text)); }
  // two neighbours chatting: a speaks now, b answers ~2.6 s later (one pair at a time, counts as one bark)
  function chat(n, o) {
    const t = now(); if (t - core.lastBark < core.barkGap + 1.5) return false;
    const pool = n.kind === 'ally' ? BARKS.ALLY_CHAT : BARKS.CHAT, c = pool[(Math.random() * pool.length) | 0];
    if (!bark(n, 'chat', 0, fmt(c.a, n))) return false;
    core.barkQueue.push({ at: t + 2.6, n: o, text: fmt(c.b, o) });
    o.nextBark = t + rand(24, 55);
    core.lastBark = t + 1.6; // the answer counts: nothing else speaks for a moment
    return true;
  }
  core.chat = chat;
  function barkQueueStep(t) {
    const Q = core.barkQueue;
    for (let i = Q.length - 1; i >= 0; i--) {
      const e = Q[i]; if (e.at > t) continue;
      Q.splice(i, 1);
      const n = e.n; if (!n || n.a.removed || n.a.dead || n.hidden) continue;
      n.ownSay = true; try { n.a.say(e.text, 3); } finally { n.ownSay = false; }
      ev.emit('society:bark', { actor: n.a, text: e.text, kind: 'chat', npc: n });
    }
  }

  // ------------------------------------------------------------------ vault (indoors) and doors
  const VAULT_X = 7000, VAULT_Z = 7000;
  function hide(n, why = 'inside') {
    const a = n.a; if (n.hidden) return;
    n.stash = { x: a.position.x, z: a.position.z };
    n.hidden = true; n.hideWhy = why;
    a.hidden = true;
    a.group.visible = false;
    a.hasGoal = false; a.stop?.(); a.wander?.(0); a.lookAt?.(null); a.follow?.(null);
    a.position.set(VAULT_X + (n.seed % 97), 0, VAULT_Z + (n.seed % 89));
    if (a.damage) { if (n.dmgOff === undefined) { n.dmgOff = a.damage.offsetY; } a.damage.offsetY = -400; }
    if (a.label) a.label.show?.(false);
    n.visited.inside = (n.visited.inside || 0) + 1;
  }
  function unhide(n, x, z) {
    const a = n.a; if (!n.hidden) return;
    n.hidden = false; a.hidden = false;
    const sx = x ?? n.stash?.x ?? n.spawn.x, sz = z ?? n.stash?.z ?? n.spawn.z;
    a.position.set(sx + rand(-0.3, 0.3), ground(sx, sz), sz + rand(-0.3, 0.3));
    a.group.visible = true; if (a.group.userData) a.group.userData.perfCulled = false;
    if (a.damage && n.dmgOff !== undefined) a.damage.offsetY = n.dmgOff;
    n.visited.out = (n.visited.out || 0) + 1;
  }
  core.hide = hide; core.unhide = unhide;

  // ------------------------------------------------------------------ binding an NPC to its settlement, home and work
  function chooseHome(n) {
    const s = n.sett, a = n.a;
    const px = a.position.x, pz = a.position.z;
    let kinds = ['house'];
    if (n.role === 'livestock') kinds = ['barn']; else if (n.role === 'blacksmith') kinds = ['smithy', 'house']; else if (n.role === 'guard') kinds = ['house', 'tower'];
    else if (n.role === 'wild') return null;
    let best = null, bs = 1e12;
    const list = s ? s.places : places;
    for (const p of list) {
      if (!kinds.includes(p.kind)) continue;
      const dd = d2(p.x, p.z, px, pz);
      if (!s && dd > 45 * 45) continue;
      const crowd = p.cap && p.residents >= p.cap ? 1e6 : 0;
      const sc = dd + crowd + (kinds.indexOf(p.kind)) * 400;
      if (sc < bs) { bs = sc; best = p; }
    }
    if (!best && n.kind === 'person') { // no house about: a farm hand sleeps in the barn
      for (const p of list) if (p.kind === 'barn' && d2(p.x, p.z, px, pz) < 60 * 60) { best = p; break; }
    }
    return best;
  }
  function rebind(n) {
    if (n.forced) return;
    const a = n.a, hx = n.hidden && n.stash ? n.stash.x : a.position.x, hz = n.hidden && n.stash ? n.stash.z : a.position.z;
    const s = settFor(n.spawn.x, n.spawn.z, 25) || settFor(hx, hz, 25);
    if (n.home) n.home.residents = Math.max(0, n.home.residents - 1);
    n.sett = s;
    if (!n.nid || (n.nid[0] === 'x' && s)) { if (n.nid) byNid.delete(n.nid); assignIdentity(n); } // a free villager that found a settlement gets a remembered identity
    n.home = chooseHome(n);
    if (n.home) n.home.residents++;
    n.work = null;
    if (n.role === 'farmer') n.work = s ? firstOf(s, ['crops']) : nearestPlace('crops', n.spawn.x, n.spawn.z, 40);
    if (n.role === 'livestock') n.pen = s ? firstOf(s, ['pen']) : null;
  }
  core.rebind = rebind;

  // ------------------------------------------------------------------ adoption
  const fmap = new Map();
  function refreshFighters() {
    fmap.clear();
    const C = W.combat; if (!C) return;
    const add = (f) => { if (f && f.actor) fmap.set(f.actor, f); };
    if (C.fighters) for (let i = 0; i < C.fighters.length; i++) add(C.fighters[i]);
    if (C.reserves) for (let i = 0; i < C.reserves.length; i++) add(C.reserves[i]);
  }
  core.fighterOf = (a) => fmap.get(a) || a.damage?.fighter || null;
  function adopt(a, o = {}) {
    if (!a || a.removed || a.dead || !a.group) return null;
    if (npcs.has(a)) { const n = npcs.get(a); if (o.role && o.role !== n.role) setRole(n, o.role); applyOverrides(n, o); return n; }
    const f = fmap.get(a) || a.damage?.fighter || null;
    let cls = DATA.classify(a, f);
    if (o.role) { cls = { role: DATA.ROLE_INFO[o.role] ? o.role : 'villager', kind: DATA.ROLE_INFO[o.role]?.kind || 'person' }; if (cls.kind === 'ally' && !f) cls.kind = 'person'; }
    else if (!cls) return null;
    if (!o.role && a.noSociety) return null;
    if ((a.faction ?? f?.faction) === 'enemy' && !o.force) return null;
    const p = a.position;
    const n = {
      a, role: cls.role, kind: cls.kind, fighter: f, sett: null, home: null, work: null, pen: null, name: null, traits: [], rel: null, gender: null, nid: '', seed: hash('s' + a.id), ord: 0, persist: false,
      mem: { aff: 0, talks: 0, flags: 0 }, state: 'idle', since: now(), nextThink: now() + rand(0, 0.8), nextBark: now() + rand(8, 30), lastLine: '', ownSay: false,
      spawn: { x: p.x, z: p.z }, gx: p.x, gz: p.z, hasGoal: false, hidden: false, stash: null, hideWhy: '', offDuty: false, baseSpeed: a.speed || 1.2, speedMul: 1,
      scareUntil: 0, calmSince: 0, react: null, stayUntil: 0, followUntil: 0, talkUntil: 0, greetAt: 0, waveUntil: 0, lookUntil: 0, hurtT: 0, jit: 0, visited: {}, forced: !!(o.home || o.work || o.role), listeners: null,
      origSay: null, origFaceTo: null, dmgOff: undefined, prevHit: null, prevDie: null, hitWrap: null, dieWrap: null, area: 1.5, task: '', wake: 0, errandAt: 0, route: 0, roleForced: o.role || '', ownFollow: null, tag: null,
    };
    n.jit = ((n.seed >>> 4) % 60) / 100;       // 0..0.6 h: wake/bed times differ per person
    wrap(n);
    a.society = n;
    npcs.set(a, n);
    if (o.home) setPoint(n, 'home', o.home);
    if (o.work) setPoint(n, 'work', o.work);
    if (o.role) n.roleForced = o.role;
    if (placesReady) { rebind(n); n.forced = !!(o.home || o.work); if (o.home) setPoint(n, 'home', o.home); if (o.work) setPoint(n, 'work', o.work); } else n.needBind = true;
    if (!n.nid && placesReady) assignIdentity(n);
    if (a.wander && n.kind !== 'animal') a.wander(0);
    ev.emit('society:adopt', { actor: a, npc: n });
    return n;
  }
  function setRole(n, role) { if (!DATA.ROLE_INFO[role]) return; n.role = role; n.kind = DATA.ROLE_INFO[role].kind; n.roleForced = role; n.state = 'idle'; n.since = 0; }
  function applyOverrides(n, o) { if (o.home) setPoint(n, 'home', o.home); if (o.work) setPoint(n, 'work', o.work); }
  const _w = new THREE.Vector3();
  function pointOf(v) {
    if (!v) return null;
    if (typeof v.x === 'number' && typeof v.z === 'number') return { x: v.x, z: v.z };
    if (Array.isArray(v)) return { x: v[0], z: v[2] ?? v[1] };
    const o = v.group || v.object || (v.objects && v.objects[0]) || v.position && v || v; // library handle / Object3D
    if (o && o.getWorldPosition) { o.getWorldPosition(_w); return { x: _w.x, z: _w.z }; }
    if (v.position && typeof v.position.x === 'number') return { x: v.position.x, z: v.position.z };
    return null;
  }
  function setPoint(n, which, v) {
    const p = pointOf(v); if (!p) return;
    const pl = { id: 'manual:' + which + n.a.id, name: 'manual', kind: which === 'home' ? 'house' : 'work', group: null, x: p.x, z: p.z, yaw: 0, depth: 1, doorOff: 0, cap: 0, guards: false, door: { x: p.x, z: p.z }, doorOk: true, residents: 0, seen: 0, r: 1, sett: n.sett, vec: { x: p.x, y: ground(p.x, p.z), z: p.z }, synth: true, manual: true };
    if (which === 'home') n.home = pl; else n.work = pl;
    n.forced = true;
  }
  function wrap(n) {
    const a = n.a;
    // 1. speech: sleeping people say nothing; library greetings are replaced by wary lines when this person remembers the player badly
    n.origSay = a.say;
    a.say = function (text, secs) {
      const nn = a.society;
      if (!nn || nn.released) return n.origSay.call(a, text, secs);
      if (nn.hidden) return a;
      if (!nn.ownSay) {
        if (nn.kind === 'person' && attitude(nn) < -18 && !/^[~!]/.test(String(text)) && now() - core.lastBark > 1) text = pick(BARKS.GREET[attitude(nn) < -45 ? 'hostile' : 'wary']).replace('{place}', nn.sett?.name || 'here');
        core.lastBark = Math.max(core.lastBark, now() - core.barkGap + 2.5); // library chatter also counts against the global limiter
      }
      return n.origSay.call(a, text, secs);
    };
    // 2. a person who is off duty must not keep hammering the anvil / hoeing the air for the library's own brain
    n.origFaceTo = a.faceTo;
    a.faceTo = function (v, secs) { const nn = a.society; if (nn && !nn.released && nn.offDuty && now() > nn.talkUntil && !nn.reactFace) return a; return n.origFaceTo.call(a, v, secs); };
    const desc = Object.getOwnPropertyDescriptor(a, 'attacking');
    n.attDesc = desc || null;
    if (desc && desc.configurable) Object.defineProperty(a, 'attacking', { get: () => { const nn = a.society; return (nn && !nn.released && nn.offDuty) || a.atkT >= 0; }, configurable: true });
    // 3. harm bookkeeping through the damageable's own hooks
    const d = a.damage;
    if (d) {
      n.prevHit = d.onHit; n.prevDie = d.onDeath;
      n.hitWrap = (e) => { try { if (n.prevHit) n.prevHit(e); } finally { onNpcHurt(n, e); } };
      n.dieWrap = (dd, last) => { try { if (n.prevDie) n.prevDie(dd, last); } finally { onNpcDeath(n, dd, last); } };
      d.onHit = n.hitWrap; if (n.prevDie) d.onDeath = n.dieWrap; else { n.dieWrap = null; }
    }
  }
  function release(a, why = '') {
    const n = a && a.society ? a.society : npcs.get(a);
    if (!n || n.released) return false;
    n.released = true;
    if (n.hidden) unhide(n);
    const x = n.a;
    if (n.origSay) x.say = n.origSay;
    if (n.origFaceTo) x.faceTo = n.origFaceTo;
    if (n.attDesc) { try { Object.defineProperty(x, 'attacking', n.attDesc); } catch (e) { /* frozen */ } }
    const d = x.damage;
    if (d) { if (d.onHit === n.hitWrap) d.onHit = n.prevHit; if (n.dieWrap && d.onDeath === n.dieWrap) d.onDeath = n.prevDie; }
    if (!x.removed && !x.dead) { x.lookAt?.(null); if (n.kind === 'animal') x.wander?.(6, { x: x.position.x, z: x.position.z }); }
    if (n.home) n.home.residents = Math.max(0, n.home.residents - 1);
    x.society = undefined; x.hidden = false; x.persona = undefined; if (x.voiceId === n.nid) x.voiceId = undefined;
    if (x.npcName === n.name) x.npcName = undefined;
    npcs.delete(x); if (byNid.get(n.nid) === n) byNid.delete(n.nid);
    ev.emit('society:release', { actor: x, why });
    return true;
  }
  core.release = (n, why) => release(n.a, why);

  // ------------------------------------------------------------------ harm, kills and help (the reputation rules)
  function witnessesOf(n, radius = 18) { // adopted people (not the victim) who could have seen it
    const out = []; const a = n.a;
    for (const o of npcs.values()) { if (o === n || o.kind !== 'person' || o.hidden || o.a.dead) continue; if (d2(o.a.position.x, o.a.position.z, a.position.x, a.position.z) < radius * radius) out.push(o); }
    return out;
  }
  const HARM = { person: [-1.5, 4, -14, 40], child: [-3, 8, -22, 70], livestock: [-0.4, 1, -3, 8], pet: [-1.5, 2, -7, 14], wild: [0, 0, -0.5, 0], ally: [0, 0, 0, 0] };
  function onNpcHurt(n, e) {
    if (n.released || !e || e.from !== 'player') return;
    const t = now(); if (t - n.hurtT < 0.6) return; n.hurtT = t;
    const kindKey = n.role === 'child' ? 'child' : n.role === 'pet' ? 'pet' : n.kind === 'animal' ? (n.role === 'wild' ? 'wild' : 'livestock') : n.kind === 'ally' ? 'ally' : 'person';
    const h = HARM[kindKey];
    const s = n.sett || settFor(n.a.position.x, n.a.position.z, 25);
    if (h[0] && s) addRep(s, h[0], 'hurt ' + n.role);
    const wit = h[1] ? witnessesOf(n) : [];
    if (h[1] && s) addBounty(s, wit.length || n.kind === 'person' ? h[1] : Math.ceil(h[1] / 3), 'hurt ' + n.role);
    if (kindKey === 'person' || kindKey === 'child') memAdd(n, -14, 2);
    n.scareUntil = t + 8;
    n.state = 'react'; n.since = 0;
    bark(n, 'event:hurt', 1);
    for (const o of wit) { o.scareUntil = Math.max(o.scareUntil, t + 5); memAdd(o, -3, 0); }
    if (s) addGrowth(s, -0.3, 'abuse');
    refreshPersona(n);
  }
  function onNpcDeath(n, dd, last) {
    if (n.released) return;
    const byPlayer = (last && last.from === 'player') || (dd && dd.lastHit && dd.lastHit.from === 'player');
    const s = n.sett || settFor(n.a.position.x, n.a.position.z, 25);
    const t = now();
    const kindKey = n.role === 'child' ? 'child' : n.role === 'pet' ? 'pet' : n.kind === 'animal' ? (n.role === 'wild' ? 'wild' : 'livestock') : n.kind === 'ally' ? 'ally' : 'person';
    const h = HARM[kindKey];
    const wit = witnessesOf(n, 24);
    if (byPlayer) {
      if (s && h[2]) addRep(s, h[2], 'killed ' + n.role);
      if (s && h[3]) addBounty(s, wit.length || n.kind === 'person' ? h[3] : Math.ceil(h[3] / 3), 'killed ' + n.role);
      if (s && (kindKey === 'person' || kindKey === 'child')) addGrowth(s, -6, 'murder');
      if (kindKey === 'person' || kindKey === 'child') note(`The player killed ${n.name || 'a villager'}${s ? ' of ' + s.name : ''}${wit.length ? ' in front of witnesses' : ''}.`, true);
      for (const o of wit) { memAdd(o, -12, 8); o.scareUntil = t + 7; }
    } else if (s && (kindKey === 'person' || kindKey === 'child')) addGrowth(s, -3, 'death');
    if (kindKey === 'person' || kindKey === 'child') {
      core.reactAt('mourn', n.a.position.x, n.a.position.z, { exclude: n, sett: s });
      memAdd(n, 0, 0); if (n.persist) pset(`n.${n.nid}`, packMem(n.mem));
    }
    ev.emit('society:death', { npc: n, byPlayer, witnesses: wit.length });
  }

  // ------------------------------------------------------------------ events: spectacles, kills, quests, talking
  function nearestSettOfPlayer(extra = 30) { return settFor(head.x, head.z, extra); }
  const REACT_SPELLS = /meteor|fire|storm|lightning|summon|conjure|gravity|levitate|blink|portal|nova|rain|ice|frost|force/i;
  ctx.on('spell:cast', (e) => {
    if (!npcs.size || !e) return;
    const id = String(e.id || '');
    if (!REACT_SPELLS.test(id) || now() - (core.spellT ?? -9) < 6) return;
    core.spellT = now();
    const o = e.origin; const dir = e.direction;
    const x = (o?.x ?? head.x) + (dir?.x ?? 0) * 10, z = (o?.z ?? head.z) + (dir?.z ?? 0) * 10;
    core.reactAt('crowd', x, z, { radius: 40, max: 6, loud: /meteor|storm|nova|summon/.test(id) });
  });
  ctx.on('kit:hit', (e) => {
    if (!npcs.size || !e || !e.point) return;
    if ((e.kind === 'explosion' || e.amount >= 25) && e.from !== 'enemy') core.reactAt('startle', e.point.x, e.point.z, { radius: 16 });
  });
  ctx.on('weapon:fire', () => { if (npcs.size) core.reactAt('startle', head.x, head.z, { radius: 6, short: true }); });
  ctx.on('combat:kill', (e) => {
    if (!e || !e.victim) return;
    const v = e.victim, a = v.actor;
    if (!a) return;
    if (v.faction !== 'enemy' && a.faction !== 'enemy') return;
    const by = e.by;
    const mine = by === 'player' || by === 'friendly' || (by && by.faction === 'friendly');
    if (!mine) return;
    const x = a.position.x, z = a.position.z;
    const s = settFor(x, z, 28);
    if (s) {
      const t = now();
      if (t - s.protT > 4) { s.protT = t; addGrowth(s, 0.6, 'defended'); addRep(s, by === 'player' ? 0.8 : 0.3, 'defended'); padd(`s${s.slot}.k`, 1); }
      core.reactAt('cheer', x, z, { radius: 26, sett: s });
    }
    if (core.eco) core.eco.onKill(v, a);
  });
  ctx.on('quest:completed', (e) => {
    const s = nearestSettOfPlayer(60);
    if (s) { addRep(s, 2, 'quest'); addGrowth(s, 2, 'quest'); }
    if (core.eco) core.eco.onQuest(e);
  });
  ctx.on('voices:reply', (e) => {
    const a = e && e.actor, n = a && a.society; if (!n) return;
    const t = now();
    const intent = e.intent;
    memAdd(n, 0.5, 0, 0); n.talkUntil = t + 8;
    if (intent === 'stay') n.stayUntil = t + 180;
    else if (intent === 'follow') n.followUntil = t + 900;
    else if (intent === 'flee') n.scareUntil = t + 9;
    if (intent === 'give' && core.eco) core.eco.onGive(n);
    refreshPersona(n);
  });

  // reactions toward a place; implemented in life.js (core exposes the entry point so events can call it before life is loaded)
  core.reactAt = (...args) => (core.life ? core.life.reactAt(...args) : 0);

  // ------------------------------------------------------------------ growth: a settlement the player protects improves, one that is abused declines
  const GROWTH = [
    { tier: 1, lib: 'lantern', slot: 0 }, { tier: 1, lib: 'lantern', slot: 1 }, { tier: 1, lib: 'market-stall', slot: 2, opts: {} },
    { tier: 2, lib: 'villager', slot: 3 }, { tier: 2, lib: 'villager', slot: 4 }, { tier: 2, lib: 'knight', slot: 5, guard: true }, { tier: 2, lib: 'lantern', slot: 6 }, { tier: 2, lib: 'lantern', slot: 7 },
    { tier: 3, lib: 'banner', slot: 8 }, { tier: 3, lib: 'fire-basket', slot: 9 }, { tier: 3, lib: 'child', slot: 10 }, { tier: 3, lib: 'villager', slot: 11 },
  ];
  function growthSpot(s, slot) { // fixed slots on a ring inside the settlement; deterministic per settlement slot, moved off buildings
    const base = ((hash('g' + s.slot) % 628) / 100);
    const R = clamp(s.r * 0.45, 6, 13);
    for (let k = 0; k < 12; k++) {
      const ang = base + slot * 0.97 + k * 0.5, rr = R + (k % 3) * 2.2 + (slot % 3);
      const x = s.cx + Math.cos(ang) * rr, z = s.cz + Math.sin(ang) * rr;
      if (W.env?.isWater?.(x, z)) continue;
      let ok = true;
      for (const p of places) { const lim = (p.r || 2) + 2.2; if (d2(p.x, p.z, x, z) < lim * lim) { ok = false; break; } }
      if (ok) for (const it of s.items) if (it.x !== undefined && d2(it.x, it.z, x, z) < 6) { ok = false; break; }
      if (ok) return { x, z };
    }
    return null;
  }
  function applyTier(s) {
    const lib = W.library; if (!lib) return;
    const tier = tierOf(s), old = s.tier < 0 ? tier : s.tier, up = tier > old;
    // despawn what the tier no longer pays for
    for (let i = s.items.length - 1; i >= 0; i--) { const it = s.items[i]; if (it.tier > tier) { try { it.h?.remove?.(); } catch (e) { /* gone */ } s.items.splice(i, 1); } }
    for (const g of GROWTH) {
      if (g.tier > tier || s.items.some((it) => it.slot === g.slot)) continue;
      const pop = g.lib === 'villager' || g.lib === 'knight' || g.lib === 'child';
      if (pop && W.perf?.allow && W.perf.allow('actors', 1) < 1) continue;
      const sp = growthSpot(s, g.slot); if (!sp) continue;
      let h = null;
      try {
        const opts = { x: sp.x, z: sp.z, noPush: true, yaw: Math.atan2(s.cx - sp.x, s.cz - sp.z), ...(g.opts || {}) };
        if (g.guard) { opts.faction = 'neutral'; opts.follow = null; opts.wander = 0; opts.name = 'Guard'; }
        h = lib.spawn(ctx, g.lib, opts);
      } catch (e) { warn('growth spawn failed', g.lib, e); }
      if (h) s.items.push({ slot: g.slot, tier: g.tier, lib: g.lib, h, x: sp.x, z: sp.z });
    }
    s.tier = tier;
    if (tier !== old) {
      ev.emit('society:tier', { place: s.name, tier, previous: old });
      if (up) { hud(`${s.name} is growing (level ${tier})`, 3.5); note(`${s.name} has grown to prosperity level ${tier} thanks to the player.`, false); const n0 = firstNpcIn(s); if (n0) bark(n0, 'event:tier', 1); }
      else note(`${s.name} has declined to level ${tier}.`, false);
    }
  }
  function firstNpcIn(s) { for (const n of npcs.values()) if (n.sett === s && !n.hidden && n.kind === 'person') return n; return null; }
  core.applyTier = applyTier;

  // ------------------------------------------------------------------ extra systems (loaded files)
  core.life = (await import(`../society/life.js${q}`)).default(core);
  core.eco = (await import(`../society/economy.js${q}`)).default(core);

  // ------------------------------------------------------------------ voices: enrich the NPC context the dialogue plugin receives
  let origNpcProvider = null;
  function npcProvider() {
    const r = origNpcProvider ? origNpcProvider() : null;
    if (!r) return r;
    try {
      const n = byNid.get(r.id);
      if (!n || n.released) return r;
      refreshPersona(n);
      n.talkUntil = now() + 8;
      const t = now(); if (t - (n.lastTalkMem ?? -99) > 25) { n.lastTalkMem = t; memAdd(n, 0.6, 0, 1); }
      r.persona = n.a.persona || r.persona;
      const att = attitude(n);
      if (r.mood === 'calm') r.mood = n.state === 'flee' ? 'afraid' : att >= 40 ? 'warm' : att <= -25 ? 'wary' : n.state === 'sleep' || n.state === 'gather' && phaseNow() === 'night' ? 'sleepy' : n.state === 'meal' ? 'relaxed' : n.role === 'child' ? 'bright' : 'calm';
      if (Array.isArray(r.nearby)) {
        r.nearby.unshift(`it is ${phaseNow()}${core.rainy ? ' and ' + weatherKind : ''}; you are ${activityText(n)}`);
        if (n.sett && bountyOf(n.sett) >= DATA.BOUNTY_HOSTILE) r.nearby.push('the player is wanted by the guards here');
        if (n.role === 'merchant' || n.role === 'blacksmith' || n.role === 'wizard') { const sh = core.eco?.shopFor(n); if (sh && sh.open) r.nearby.push('you sell: ' + sh.wares.slice(0, 5).map((w) => `${w.name} ${w.price}g`).join(', ')); else if (sh) r.nearby.push('you refuse to trade with the player'); }
        if (r.nearby.length > 6) r.nearby.length = 6;
      }
    } catch (e) { warn('npc context failed', e); }
    return r;
  }
  function maintainProviders() {
    const cp = W.contextProviders; if (!cp) return;
    if (cp.npc !== npcProvider && cp.npc !== undefined) { origNpcProvider = cp.npc; cp.npc = npcProvider; }
    else if (cp.npc === undefined && origNpcProvider) { origNpcProvider = null; }
    if (cp.society !== societyProvider) cp.society = societyProvider;
  }
  function societyProvider() {
    const s = nearestSettOfPlayer(30);
    if (!s) return npcs.size ? { place: null, gold: goldNow(), hour: Math.floor(hour()) } : null;
    return { place: s.name, kind: s.kind, reputation: DATA.band(repOf(s)), bounty: bountyOf(s), tier: s.tier, gold: goldNow(), time: phaseNow() };
  }

  // ------------------------------------------------------------------ the public API
  const api = {
    clock, earn, spend, say,
    get gold() { return goldNow(); },
    get bounty() { const s = nearestSettOfPlayer(40) || ST.setts[0]; return bountyOf(s); },
    get weather() { return weatherKind; },
    adopt, release,
    band: (v) => DATA.band(typeof v === 'number' ? v : api.reputation(v)),
    reputation(x) {
      if (typeof x === 'number') return repOf(ST.setts[x] || null);
      if (x && x.a && x.role) return r1(attitude(x));
      if (x && x.society) return r1(attitude(x.society));
      if (x && typeof x === 'object' && 'slot' in x) return repOf(x);
      if (typeof x === 'string') { const s = ST.setts.find((t) => t.name.toLowerCase() === x.toLowerCase() || t.kind === x); if (s) return repOf(s); const n = byNid.get(x); if (n) return r1(attitude(n)); }
      return repOf(nearestSettOfPlayer(40) || ST.setts[0] || null);
    },
    npc(x) {
      const n = typeof x === 'string' ? (byNid.get(x) || [...npcs.values()].find((o) => o.a.id === x)) : npcs.get(x) || x?.society;
      return n ? describe(n) : null;
    },
    npcs() { return [...npcs.values()].map(describe); },
    settlements() { return ST.setts.map(describeSett); },
    settlement(i = 0) { const s = typeof i === 'object' ? i : ST.setts[i]; if (!s) return null; const d = describeSett(s); d.addGrowth = (n, why) => addGrowth(s, n, why || 'api'); d.addRep = (n, why) => addRep(s, n, why || 'api'); d.addBounty = (n, why) => addBounty(s, n, why || 'api'); return d; },
    payBounty(s) { return core.eco ? core.eco.payBounty(s) : false; },
    shop(a) { return core.eco ? core.eco.shop(a) : { open: false, reason: 'no economy', wares: [] }; },
    buy(id, merchant) { return core.eco ? core.eco.buy(id, merchant) : false; },
    sell() { return core.eco ? core.eco.sell() : 0; },
    gift(x, g) { return core.eco ? core.eco.gift(x, g) : false; },
    drink(id) { return core.eco ? core.eco.drink(id) : false; },
    stats() { return { npcs: npcs.size, places: places.length, settlements: ST.setts.length, coins: core.eco?.coinCount() ?? 0, thinks: core.thinks | 0, barkGap: core.barkGap }; },
    _core: core,
  };
  function describe(n) {
    return { id: n.nid, actorId: n.a.id, name: n.name, role: n.role, kind: n.kind, traits: n.traits.slice(), relation: n.rel ? { ...n.rel } : null, state: n.state, task: n.task, hidden: n.hidden,
      home: n.home ? { x: n.home.x, z: n.home.z, kind: n.home.kind } : null, work: n.work ? { x: n.work.x, z: n.work.z, kind: n.work.kind } : null, settlement: n.sett ? n.sett.name : null,
      attitude: r1(attitude(n)), memory: { affinity: n.mem.aff, talks: n.mem.talks, helped: !!(n.mem.flags & 1), hurt: !!(n.mem.flags & 2), gifted: !!(n.mem.flags & 4), sawKilling: !!(n.mem.flags & 8) },
      visited: { ...n.visited }, persona: n.a.persona || '' };
  }
  function describeSett(s) {
    const r = repOf(s);
    return { slot: s.slot, name: s.name, kind: s.kind, x: s.cx, z: s.cz, radius: s.r, tier: s.tier, prosperity: growthOf(s), reputation: r, band: DATA.band(r), bounty: bountyOf(s), npcs: [...npcs.values()].filter((n) => n.sett === s).length, places: s.places.length, items: s.items.length };
  }
  ctx.provide('society', api);
  ctx.onDispose(() => {
    const cp = W.contextProviders;
    if (cp) { if (cp.npc === npcProvider) { if (origNpcProvider) cp.npc = origNpcProvider; else delete cp.npc; } if (cp.society === societyProvider) delete cp.society; }
  });

  // ------------------------------------------------------------------ per frame
  let scanActorsT = 0, maintT = 0, thinkCursor = 0, thinkAcc = 0, idleT = 0, hydT = 0;
  core.thinks = 0;
  const THINK_HZ = 2;
  const list = [];
  function candidateScan() {
    const K = W.kit; if (!K) return;
    const all = typeof K.actors === 'function' ? K.actors() : K.actors; if (!all) return;
    refreshFighters();
    let added = 0; const cap = capNpcs();
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a || a.removed || a.dead || npcs.has(a) || a.noSociety || !a.group || a.group.parent === null) continue;
      if (a.society && a.society.released === false) continue;
      if (npcs.size >= cap) break;
      if (a.__socSkip === 2) continue;
      const n = adopt(a);
      if (!n) { a.__socSkip = (a.__socSkip | 0) + 1; if (a.__socSkip > 3) a.__socSkip = 2; } else added++;
    }
  }
  function sweep() { // drop npcs whose actors are gone
    for (const [a, n] of npcs) { if (a.removed || a.dead && !n.hidden && a.deadT > 20 || !a.group || a.group.parent === null) release(a, 'gone'); }
  }
  function update(dt, t) {
    dt = Math.min(dt, 0.1);
    hydT += dt; if (hydT > 0.5) { hydT = 0; hydrate(); }
    scanActorsT += dt;
    if (scanActorsT >= 1) {
      scanActorsT = 0;
      if (!scanStarted) scanStarted = true;
      candidateScan();
      sweep();
      if (core.life) core.life.slowTick();
    }
    // places: a pass over the scene every few seconds while there is anything to place (and once at the start)
    if (npcs.size || !placesReady || ST.setts.length) {
      if (scanWait > 0) scanWait -= dt; else scanStep(200);
    }
    if (placesReady) for (const n of npcs.values()) if (n.needBind) { n.needBind = false; rebind(n); if (!n.nid) assignIdentity(n); }
    maintT += dt;
    if (maintT >= 1) { maintT = 0; maintainProviders(); if (core.eco) core.eco.maintain(); }
    if (npcs.size) {
      idleT = 0;
      clockStep(dt);
      // staggered thinking: about THINK_HZ per npc per second
      thinkAcc += npcs.size * THINK_HZ * dt;
      let k = Math.min(npcs.size, thinkAcc | 0); thinkAcc -= k;
      if (k > 0) {
        list.length = 0; for (const n of npcs.values()) list.push(n);
        const T = now();
        while (k-- > 0 && list.length) {
          thinkCursor = (thinkCursor + 1) % list.length;
          const n = list[thinkCursor];
          if (n.released) continue;
          core.thinks++;
          try { core.life.think(n, T); } catch (err) { if (!n.errd) { n.errd = true; warn('think failed for', n.role, err); } }
        }
      }
      core.life.tick(dt, t);
    } else {
      idleT += dt;
    }
    barkQueueStep(now());
    core.eco.update(dt, t);
  }
  function dispose() {
    for (const a of [...npcs.keys()]) release(a, 'reload');
    ST.ord = {};
    for (const s of ST.setts) { for (const it of s.items) { try { it.h?.remove?.(); } catch (e) { /* gone */ } } s.items.length = 0; try { s.fire?.remove?.(); } catch (e) { /* gone */ } s.fire = null; s.tier = -1; s.route = null; }
    try { core.eco.dispose(); } catch (e) { warn('economy dispose failed', e); }
    try { core.life.dispose(); } catch (e) { warn('life dispose failed', e); }
  }
  return { update, dispose };
}

