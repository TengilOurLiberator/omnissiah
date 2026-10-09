// society/life.js - the daily life of adopted NPCs: routines by hour, fleeing and returning, shelter, reactions and barks.
// Loaded by core/society.js (cache-busted import); `core` is its shared internals. Each NPC thinks ~2x/s; everything here is a target change through the kit actor API.
export default function install(core) {
  const { THREE, W, ev, DATA, BARKS, ST, ctx, clamp, rand, pick, d2, now, head, ground, npcs, num } = core;
  const hourNow = () => core.CK.time * 24;
  const thr = new Float32Array(64); let thrN = 0;           // enemy fighters near the player: x, z pairs
  let armed = false, thrT = 0, slowT = 0;
  const _v = new THREE.Vector3();

  // ------------------------------------------------------------------ helpers
  function goto(n, x, z, mul = 1) {
    const a = n.a;
    n.gx = x; n.gz = z; n.arrived = false; n.goalAt = now();
    a.wander?.(0);
    a.walkTo(x, z);
    const sp = n.baseSpeed * mul;
    if (a.speed !== sp) a.setSpeed(sp);
  }
  const distTo = (n, x, z) => Math.sqrt(d2(n.a.position.x, n.a.position.z, x, z));
  function arrivedAt(n, r = 1.3) {
    const dd = d2(n.a.position.x, n.a.position.z, n.gx, n.gz);
    if (dd < r * r || (!n.a.hasGoal && dd < 9)) { n.arrived = true; return true; }
    return false;
  }
  function nearThreat(x, z, r) {
    const r2 = r * r;
    for (let i = 0; i < thrN; i++) { const dx = thr[i * 2] - x, dz = thr[i * 2 + 1] - z; if (dx * dx + dz * dz < r2) return i + 1; }
    return 0;
  }
  function ring(n, spot, grow = 1) { // this person's fixed place around a gathering spot
    const ang = ((n.seed % 628) / 100), r = spot.r * (0.65 + (((n.seed >>> 6) % 35) / 100)) * grow;
    return { x: spot.x + Math.cos(ang) * r, z: spot.z + Math.sin(ang) * r };
  }
  const _ring = { x: 0, z: 0 };
  function ringInto(n, spot, grow = 1) { const p = ring(n, spot, grow); _ring.x = p.x; _ring.z = p.z; return _ring; }
  function shelterFor(n, maxD = 45) { // nearest enclosed place with a door
    const a = n.a, s = n.sett;
    if (n.home && n.kind !== 'animal') return n.home;
    let best = null, bd = maxD * maxD;
    const kinds = n.kind === 'animal' ? ['barn'] : ['house', 'tavern', 'church', 'smithy', 'barn'];
    for (const p of (s ? s.places : core.places)) { if (!kinds.includes(p.kind)) continue; const dd = d2(p.x, p.z, a.position.x, a.position.z); if (dd < bd) { bd = dd; best = p; } }
    return best || n.home;
  }
  function setState(n, st, t) {
    n.state = st; n.since = t; n.goalAt = 0; n.arrived = false; n.workInit = false; n.dozing = false;
    n.visited[st] = (n.visited[st] || 0) + 1;
    n.offDuty = (n.role === 'blacksmith' || n.role === 'farmer') && st !== 'work';
    if (n.a.society === n && n.speedMul !== 1) { n.speedMul = 1; n.a.setSpeed(n.baseSpeed); }
  }

  // ------------------------------------------------------------------ the thinking function
  function think(n, t) {
    const a = n.a;
    if (a.removed || a.dead) { core.release(n, a.dead ? 'dead' : 'gone'); return; }
    if (n.kind === 'ally') { thinkAlly(n, t); return; }
    const px = a.position.x, pz = a.position.z;
    // somebody else is steering this person (voices: [follow] / [stay]): hands off
    if ((a.followTarget && a.followTarget !== n.ownFollow && n.kind !== 'animal') || t < n.followUntil && a.followTarget) { if (n.state !== 'external') { setState(n, 'external', t); if (n.hidden) core.unhide(n); } return; }
    if (t < n.stayUntil) { if (n.state !== 'stay') { setState(n, 'stay', t); a.wander?.(0); a.stop?.(); } return; }
    if (n.state === 'external' || n.state === 'stay') { setState(n, 'idle', t); n.followUntil = 0; }
    const hd = Math.sqrt(d2(px, pz, head.x, head.z));
    n.distPlayer = hd;
    // stuck behind scenery? after ~16 s without progress, slip through when unseen (or after ~32 s regardless)
    if (n.goalAt && !n.arrived && !n.hidden) {
      if (t - (n.progT || 0) > 8) {
        const moved = d2(px, pz, n.progX || 0, n.progZ || 0);
        if (n.progT && moved < 1.4 && distTo(n, n.gx, n.gz) > 2.5) n.stuck = (n.stuck | 0) + 1; else n.stuck = 0;
        n.progT = t; n.progX = px; n.progZ = pz;
        if (n.stuck >= 2 && (hd > 18 || n.stuck >= 4)) { a.position.set(n.gx + rand(-0.4, 0.4), ground(n.gx, n.gz), n.gz + rand(-0.4, 0.4)); n.stuck = 0; n.arrived = true; n.visited.unstuck = (n.visited.unstuck | 0) + 1; }
      }
    } else { n.progT = t; n.progX = px; n.progZ = pz; n.stuck = 0; }

    // ---- danger
    let scared = t < n.scareUntil;
    if (!scared && !n.brave) {
      if (n.brave === undefined) n.brave = n.role === 'guard' || n.traits.includes('brave') && (n.seed & 3) === 0;
      if (!n.brave && nearThreat(px, pz, n.kind === 'animal' ? 11 : 15)) { scared = true; n.scareUntil = t + 4; if (n.state !== 'flee') core.bark(n, 'event:flee', 1); }
    } else if (!scared && n.brave && nearThreat(px, pz, 15) && n.kind === 'person' && n.state !== 'alert') { n.state = 'alert'; a.wander?.(0); a.stop?.(); }
    if (scared) n.calmUntil = Math.max(n.calmUntil || 0, t + 7);
    if (scared || (n.state === 'flee' && t < n.calmUntil)) { if (n.state !== 'flee') setState(n, 'flee', t); runFlee(n, t, px, pz); return; }
    if (n.state === 'flee') { // calm again: come back out
      setState(n, 'return', t);
      if (n.hidden) core.unhide(n);
      core.bark(n, 'event:calm', 1);
    }
    if (n.state === 'alert') { if (!nearThreat(px, pz, 18)) setState(n, 'idle', t); else return; }
    if (n.kind === 'person' && n.role === 'guard') guardAttitude(n, t);

    // ---- a reaction in progress (crowd, cheer, mourn, greet, weapon) has priority over the schedule
    if (n.react) {
      if (t < n.react.until && !n.hidden) { runReact(n, t); return; }
      endReact(n, t);
    }

    // ---- what should I be doing now?
    let task;
    const hj = (hourNow() + 24 - n.jit) % 24;
    if (n.kind === 'animal') task = n.role === 'wild' || !n.home ? 'work' : (core.rainy || hj < 5 || hj >= 21.5) ? 'sleep' : 'work';
    else if (core.rainy && n.role !== 'guard' && !n.hidden && n.state !== 'shelter') task = 'shelter';
    else if (core.rainy && n.role !== 'guard') task = 'shelter';
    else task = DATA.taskAt(n.role, hj);
    if (n.role === 'pet') task = 'work';
    if (task !== n.state) {
      setState(n, task, t);
      if (n.distPlayer < 22) { const k = task === 'sleep' ? 'sleep' : task === 'wake' ? 'wake' : task === 'meal' ? 'meal' : task === 'gather' ? 'gather' : task === 'shelter' ? 'weather' : null; if (k && n.kind === 'person' && (n.seed + (t | 0)) % 3 === 0) core.bark(n, k); }
    }
    n.task = task;

    switch (task) {
      case 'sleep': case 'shelter': runIndoors(n, t, px, pz, task); break;
      case 'wake': runWake(n, t); break;
      case 'work': runWork(n, t, px, pz); break;
      case 'meal': runSpot(n, t, n.sett?.mealSpot); break;
      case 'gather': runSpot(n, t, n.sett?.gatherSpot); break;
      default: break;
    }
    // ---- manners: greet the player, back away from a drawn weapon, idle talk
    if (n.kind === 'person' && !n.hidden) manners(n, t, hd);
    else if (n.kind === 'animal' && n.role === 'livestock' && !n.hidden && hd < 3 && t > (n.greetAt || 0)) { n.greetAt = t + 30; }
    // snap to the goal when nobody can see it happen (a fast clock must still produce the full day)
    if (!n.hidden && n.goalAt && !n.arrived && hd > 55 && t - n.goalAt > 28 && distTo(n, n.gx, n.gz) > 5) { a.position.set(n.gx + rand(-1, 1), ground(n.gx, n.gz), n.gz + rand(-1, 1)); n.arrived = true; }
  }

  // ---- flee
  function runFlee(n, t, px, pz) {
    const a = n.a;
    if (n.hidden) return;
    if (n.state === 'flee' && !n.fleeInit) { n.fleeInit = true; a.lookAt?.(null); if (n.kind === 'person') a.wave?.(0); }
    const sh = shelterFor(n, 40);
    if (sh && n.role !== 'wild') {
      const dd = distTo(n, sh.door.x, sh.door.z);
      if (dd < 1.6 || (t - n.since > 18 && dd < 7)) { core.hide(n, 'fled'); n.fleeInit = false; return; }
      if (!n.goalAt || t - n.goalAt > 3) goto(n, sh.door.x, sh.door.z, 1.9);
      return;
    }
    if (!n.goalAt || t - n.goalAt > 2.5 || n.arrived) {
      let ax = px - head.x, az = pz - head.z;
      const ti = nearThreat(px, pz, 40);
      if (ti) { ax = px - thr[(ti - 1) * 2]; az = pz - thr[(ti - 1) * 2 + 1]; }
      const l = Math.hypot(ax, az) || 1;
      goto(n, px + (ax / l) * 14 + rand(-3, 3), pz + (az / l) * 14 + rand(-3, 3), 1.9);
    } else arrivedAt(n, 1);
  }

  // ---- indoors (sleep / shelter)
  function runIndoors(n, t, px, pz, task) {
    const a = n.a;
    if (n.hidden) return;
    const home = task === 'shelter' ? shelterFor(n) : n.home;
    if (!home) { if (!n.dozing) { n.dozing = true; a.wander?.(0); a.stop?.(); a.lookAt?.(null); } return; }
    const dd = distTo(n, home.door.x, home.door.z);
    if (dd < 1.6 || (t - n.since > 45 && dd < 8)) { core.hide(n, task); return; }
    if (!n.goalAt || t - n.goalAt > 7) goto(n, home.door.x, home.door.z, task === 'shelter' ? 1.5 : n.role === 'child' ? 1 : 1.1);
  }
  function runWake(n, t) {
    if (n.hidden) {
      const h = n.home;
      const door = h ? h.door : n.stash || n.spawn;
      core.unhide(n, door.x, door.z);
      core.bark(n, 'wake');
    }
    runWork(n, t, n.a.position.x, n.a.position.z);
  }

  // ---- a gathering (meal / evening)
  function runSpot(n, t, spot) {
    const a = n.a;
    if (n.hidden) { runWake(n, t); return; }
    if (!spot) { if (!n.dozing) { n.dozing = true; a.wander?.(1.5, n.spawn); } return; }
    const p = ringInto(n, spot, n.role === 'bard' && n.state === 'gather' ? 0.7 : 1);
    if (!n.goalAt || distTo(n, p.x, p.z) > 6 && t - n.goalAt > 8) goto(n, p.x, p.z, 1);
    if (n.arrived || arrivedAt(n, 1.4)) {
      if (!n.seated) { n.seated = true; a.wander?.(0.7, { x: p.x, z: p.z }); n.arrivedAt = t; }
      if (spot.vec && !a.lookTarget) a.lookAt?.(spot.vec);
    } else { n.seated = false; }
  }

  // ---- work, by role
  function pickArea(n, cx, cz, rad) { return { x: cx + rand(-rad, rad), z: cz + rand(-rad, rad) }; }
  function runWork(n, t, px, pz) {
    const a = n.a, s = n.sett;
    if (n.hidden) { core.unhide(n); }
    if (a.lookTarget && n.seated) { a.lookAt?.(null); n.seated = false; }
    n.seated = false;
    switch (n.role) {
      case 'farmer': {
        const w = n.work, cx = w ? w.x : n.spawn.x, cz = w ? w.z : n.spawn.z, rad = w ? clamp(w.r * 0.8, 2.5, 6) : 3;
        if (!n.workInit) { n.workInit = true; n.nextPick = 0; }
        if (n.arrived || arrivedAt(n, 1.2)) { if (t > (n.nextPick || 0)) { const p = pickArea(n, cx, cz, rad); goto(n, p.x, p.z, 0.9); n.nextPick = t + rand(9, 15); } }
        else if (!n.goalAt) { const p = pickArea(n, cx, cz, rad); goto(n, p.x, p.z, 0.9); }
        break;
      }
      case 'merchant': case 'blacksmith': {
        if (distTo(n, n.spawn.x, n.spawn.z) > 1.4) { if (!n.goalAt || t - n.goalAt > 8) goto(n, n.spawn.x, n.spawn.z, 1); } else { n.arrived = true; if (a.wanderOn) a.wander(0); }
        break;
      }
      case 'bard': {
        const late = (hourNow() + 24 - n.jit) % 24 >= 17.5;
        if (late && s && s.gatherSpot) { runSpot(n, t, s.gatherSpot); n.state = 'work'; return; }
        errand(n, t, 0.8, ['well', 'stall', 'tavern', 'church']);
        break;
      }
      case 'guard': patrol(n, t); break;
      case 'child': play(n, t); break;
      case 'king': court(n, t); break;
      case 'wizard': { if (!n.workInit) { n.workInit = true; a.wander(3.5, { x: n.spawn.x, z: n.spawn.z }); } break; }
      case 'livestock': case 'wild': {
        if (n.hiddenBefore || !n.workInit) { n.workInit = true; if (n.pen) { a.wander(clamp(n.pen.r, 3, 7), { x: n.pen.x, z: n.pen.z }); } else a.wander(6, { x: n.spawn.x, z: n.spawn.z }); }
        break;
      }
      case 'pet': { if (!n.workInit) { n.workInit = true; a.wander(8, s ? { x: s.cx, z: s.cz } : { x: n.spawn.x, z: n.spawn.z }); } break; }
      default: errand(n, t, 1, ['well', 'stall', 'tavern', 'church', 'sign', 'house', 'mill', 'fire']);
    }
  }
  function errand(n, t, mul, kinds) {
    const a = n.a, s = n.sett;
    if (!s) { if (!n.workInit) { n.workInit = true; a.wander(5, { x: n.spawn.x, z: n.spawn.z }); } return; }
    if (n.arrived || arrivedAt(n, 1.8)) {
      if (!n.errandWait) { n.errandWait = t + rand(7, 16); a.wander(1.4, { x: n.gx, z: n.gz }); if (n.role === 'villager' && (n.seed + (t | 0)) % 4 === 0 && n.distPlayer < 20) core.bark(n, 'work'); }
      if (t > n.errandWait) { n.errandWait = 0; n.goalAt = 0; n.arrived = false; }
    }
    if (!n.goalAt && !n.errandWait) {
      const cand = [];
      for (const p of s.places) if (kinds.includes(p.kind) && p !== n.home) cand.push(p);
      if (!cand.length) { a.wander(5, { x: s.cx, z: s.cz }); n.errandWait = t + 10; return; }
      const p = cand[(Math.random() * cand.length) | 0];
      goto(n, p.door.x + rand(-1.2, 1.2), p.door.z + rand(-1.2, 1.2), mul);
    }
  }
  function patrol(n, t) {
    const a = n.a, s = n.sett;
    if (!s) { if (!n.workInit) { n.workInit = true; a.wander(6, { x: n.spawn.x, z: n.spawn.z }); } return; }
    if (n.until && t < n.until) return;
    if (!s.route) { // door points around the settlement, in angular order
      const pts = s.places.filter((p) => p.kind === 'house' || p.kind === 'tavern' || p.kind === 'church' || p.kind === 'stall' || p.kind === 'well' || p.kind === 'smithy' || p.kind === 'tower');
      pts.sort((p, q) => Math.atan2(p.z - s.cz, p.x - s.cx) - Math.atan2(q.z - s.cz, q.x - s.cx));
      s.route = pts;
    }
    if (!s.route.length) { if (!n.workInit) { n.workInit = true; a.wander(6, { x: s.cx, z: s.cz }); } return; }
    if (n.arrived || arrivedAt(n, 1.8)) {
      if (n.goalAt) { n.until = t + rand(3, 6) * (hourNow() >= 20 || hourNow() < 6 ? 3 : 1); a.lookAt?.(null); n.goalAt = 0; n.arrived = false; n.route = (n.route + 1 + (n.seed & 1)) % s.route.length; return; }
    }
    if (!n.goalAt) { const p = s.route[n.route % s.route.length]; goto(n, p.door.x + rand(-1, 1), p.door.z + rand(-1, 1), 0.85); }
  }
  function court(n, t) {
    const a = n.a, s = n.sett;
    if (!s) { if (!n.workInit) { n.workInit = true; a.wander(2.5, { x: n.spawn.x, z: n.spawn.z }); } return; }
    if (n.until && t < n.until) { if (n.distPlayer < 7 && !a.lookTarget) { a.lookAt?.(head); a.wave?.(2); } return; }
    if (n.arrived || arrivedAt(n, 1.8)) { if (n.goalAt) { n.until = t + rand(18, 36); n.goalAt = 0; n.arrived = false; a.wander(1.2, { x: n.gx, z: n.gz }); return; } }
    if (!n.goalAt) {
      a.lookAt?.(null);
      const seats = s.places.filter((p) => p.kind === 'throne' || p.kind === 'church' || p.kind === 'well' || p.kind === 'tavern');
      const p = seats.length ? seats[(Math.random() * seats.length) | 0] : null;
      if (p) goto(n, p.door.x, p.door.z, 0.8); else { a.wander(4, { x: s.cx, z: s.cz }); n.until = t + 20; }
    }
  }
  // children play tag in pairs; a lone child races between spots round the well
  function play(n, t) {
    const a = n.a, s = n.sett;
    const home = s ? { x: s.mealSpot?.x ?? s.cx, z: s.mealSpot?.z ?? s.cz } : n.spawn;
    if (n.it && n.mate && !n.mate.hidden && !n.mate.a.removed) {
      if (a.followTarget !== n.mate.a.position) { n.ownFollow = n.mate.a.position; a.wander?.(0); a.follow(n.mate.a.position, 0.7); a.setSpeed(n.baseSpeed * 1.5); }
      if (distTo(n, n.mate.a.position.x, n.mate.a.position.z) < 1.2 && t > (n.tagT || 0)) { // tagged!
        n.tagT = n.mate.tagT = t + 3; n.it = false; n.mate.it = true; a.follow(null); n.ownFollow = null; a.setSpeed(n.baseSpeed);
        core.bark(n.mate, 'tag', 1, 'Tag! You are it!');
        goto(n, home.x + rand(-7, 7), home.z + rand(-7, 7), 1.5);
      }
      return;
    }
    if (a.followTarget === n.ownFollow && n.ownFollow) { a.follow(null); n.ownFollow = null; }
    if (n.mate && !n.mate.hidden && !n.mate.it && n.mate.a.followTarget === n.a.position) { // being chased: run away from the chaser
      if (!n.goalAt || t - n.goalAt > 1.6 || n.arrived) {
        const dx = a.position.x - n.mate.a.position.x, dz = a.position.z - n.mate.a.position.z, l = Math.hypot(dx, dz) || 1;
        let tx = a.position.x + (dx / l) * 8 + rand(-3, 3), tz = a.position.z + (dz / l) * 8 + rand(-3, 3);
        if (d2(tx, tz, home.x, home.z) > 15 * 15) { tx = home.x + rand(-6, 6); tz = home.z + rand(-6, 6); }
        goto(n, tx, tz, 1.6);
      }
      return;
    }
    if (n.arrived || arrivedAt(n, 1.5) || !n.goalAt) {
      if (!n.goalAt || t - n.goalAt > 1.5) goto(n, home.x + rand(-8, 8), home.z + rand(-8, 8), 1.4);
      if (n.distPlayer < 16 && (n.seed + (t | 0)) % 9 === 0) core.bark(n, 'work');
    }
  }
  function pairChildren(s) { // called from slowTick: assign tag partners among the settlement's children
    const kids = [];
    for (const n of npcs.values()) if (n.role === 'child' && n.sett === s && !n.hidden) kids.push(n);
    kids.sort((x, y) => x.a.seq - y.a.seq);
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (i % 2 === 0 && kids[i + 1]) { const o = kids[i + 1]; if (k.mate !== o) { k.mate = o; o.mate = k; k.it = true; o.it = false; } }
      else if (i % 2 === 0) { k.mate = null; k.it = false; }
    }
  }

  // ---- allies: only flavour, and only when nothing is happening
  function thinkAlly(n, t) {
    const a = n.a; if (a.dead || a.removed) { core.release(n, 'gone'); return; }
    if (nearThreat(a.position.x, a.position.z, 32) || (n.fighter?.target)) return;
    if (t < n.nextBark || n.distPlayer > 26) { n.distPlayer = Math.sqrt(d2(a.position.x, a.position.z, head.x, head.z)); return; }
    n.distPlayer = Math.sqrt(d2(a.position.x, a.position.z, head.x, head.z));
    let mate = null;
    for (const o of npcs.values()) if (o !== n && o.kind === 'ally' && !o.a.dead && d2(o.a.position.x, o.a.position.z, a.position.x, a.position.z) < 36) { mate = o; break; }
    if (mate && Math.random() < 0.6) core.chat(n, mate); else core.bark(n, 'ally');
    n.nextBark = t + rand(30, 70);
  }

  // ---- guards and the law
  function guardAttitude(n, t) {
    const s = n.sett; if (!s) return;
    const b = core.bountyOf(s), near = d2(head.x, head.z, s.cx, s.cz) < (s.r + 25) ** 2;
    const f = n.fighter || n.a.damage?.fighter || core.fighterOf(n.a);
    const wanted = b >= DATA.BOUNTY_HOSTILE && near;
    if (f) {
      if (wanted && f.faction !== 'enemy') { n.faction0 = f.faction; try { f.setFaction('enemy'); f.setTarget?.('player'); } catch (e) { core.warn('guard flip failed', e); } core.bark(n, 'event:bounty', 1); }
      else if (!wanted && n.faction0 && f.faction === 'enemy' && b < 10) { try { f.setFaction(n.faction0); f.setTarget?.(null); } catch (e) { /* gone */ } n.faction0 = null; core.bark(n, 'event:pardon', 1); }
    } else if (wanted && n.distPlayer < 14) { // a guard without a combat brain can only shout and shadow you
      if (!n.shadow) { n.shadow = true; n.a.lookAt?.(head); core.bark(n, 'event:bounty', 1); }
    } else if (n.shadow && !wanted) { n.shadow = false; n.a.lookAt?.(null); }
  }

  // ---- reactions
  function reactAt(kind, x, z, o = {}) {
    const t = now(); let count = 0;
    const rad = o.radius || 30, max = o.max || 99;
    for (const n of npcs.values()) {
      if (n === o.exclude || n.hidden || n.a.dead || n.kind === 'ally') continue;
      const dd = d2(n.a.position.x, n.a.position.z, x, z);
      if (dd > rad * rad) continue;
      switch (kind) {
        case 'startle': if (n.kind !== 'ally') { n.scareUntil = Math.max(n.scareUntil, t + (o.short ? 2 : 5)); count++; } break;
        case 'crowd': {
          if (n.kind !== 'person' || n.role === 'guard' && n.brave && Math.random() < 0.6 || n.state === 'flee' || n.state === 'sleep' || n.state === 'external') break;
          const chance = n.role === 'child' || n.traits.includes('curious') || n.traits.includes('nosy') ? 0.95 : 0.5;
          if (Math.random() > chance) break;
          n.react = { kind, until: t + 11, x, z, done: false, loud: !!o.loud }; count++; break;
        }
        case 'cheer': if (n.kind === 'person' && count < 6 && (!o.sett || n.sett === o.sett) && n.state !== 'flee') { n.react = { kind, until: t + 3.5, x, z, done: false }; count++; } break;
        case 'mourn': if (n.kind === 'person' && count < 4 && (!o.sett || n.sett === o.sett) && dd < 20 * 20 && n.state !== 'flee') { n.react = { kind, until: t + 11, x, z, done: false }; count++; } break;
        default: break;
      }
      if (count >= max) break;
    }
    return count;
  }
  function runReact(n, t) {
    const a = n.a, r = n.react;
    if (!r.done) {
      r.done = true;
      switch (r.kind) {
        case 'crowd': {
          const ang = (n.seed % 628) / 100, rr = 5.5 + ((n.seed >>> 5) % 25) / 10;
          goto(n, r.x + Math.cos(ang) * rr, r.z + Math.sin(ang) * rr, 1.3);
          n.reactVec = n.reactVec || { x: 0, y: 0, z: 0 }; n.reactVec.x = r.x; n.reactVec.z = r.z; n.reactVec.y = ground(r.x, r.z) + 3;
          break;
        }
        case 'cheer': a.stop?.(); a.wander?.(0); a.lookAt?.(head); a.wave?.(2.5); core.bark(n, 'event:cheer', 1); core.ctx.audio && W.audio?.sfx?.('crowd-cheer', { at: a.position, volume: 0.5 }); break;
        case 'mourn': goto(n, r.x + rand(-1.5, 1.5), r.z + rand(-1.5, 1.5), 0.9); core.bark(n, 'event:mourn', 1); break;
        case 'greet': a.stop?.(); a.wander?.(0); a.lookAt?.(head); a.wave?.(2); core.bark(n, 'greet', 1); break;
        case 'weapon': { const dx = a.position.x - head.x, dz = a.position.z - head.z, l = Math.hypot(dx, dz) || 1; goto(n, a.position.x + (dx / l) * 3.5, a.position.z + (dz / l) * 3.5, 1.2); a.lookAt?.(head); core.bark(n, 'event:weapon', 1); break; }
        default: break;
      }
    } else if (r.kind === 'crowd') {
      if ((n.arrived || arrivedAt(n, 1.6)) && !r.looked) { r.looked = true; a.lookAt?.(n.reactVec); core.bark(n, 'event:gasp', 1); }
    }
  }
  function endReact(n, t) {
    const a = n.a;
    n.react = null;
    if (a.lookTarget === n.reactVec) a.lookAt?.(null);
    if (a.lookTarget === head) a.lookAt?.(null);
    n.state = 'idle'; n.since = 0; n.goalAt = 0;
  }
  // ---- manners
  function manners(n, t, hd) {
    const a = n.a;
    if (n.state === 'work' || n.state === 'meal' || n.state === 'gather' || n.state === 'idle' || n.state === 'return') {
      const att = core.attitude(n);
      if (hd < 6.5 && hd > 1.6) {
        if (armed && n.role !== 'guard' && !n.brave && t > (n.weaponAt || 0) && hd < 5.5) { n.weaponAt = t + 25; n.react = { kind: 'weapon', until: t + 4, x: head.x, z: head.z, done: false }; return; }
        if (t > n.greetAt && hd > 3.4) {
          const fx = ctx.player.forward.x, fz = ctx.player.forward.z, dx = a.position.x - head.x, dz = a.position.z - head.z;
          if ((dx * fx + dz * fz) > hd * 0.35) {
            n.greetAt = t + 70;
            if (att < -30) { n.react = { kind: 'weapon', until: t + 3, x: head.x, z: head.z, done: false }; return; }
            if (n.role !== 'merchant' && n.role !== 'blacksmith' || Math.random() < 0.5) n.react = { kind: 'greet', until: t + 3.5, x: head.x, z: head.z, done: false };
            return;
          }
        }
      }
      if (t > n.nextBark && hd < 22 && !n.hidden) ambient(n, t);
    }
  }
  function ambient(n, t) {
    n.nextBark = t + rand(20, 45);
    const r = Math.random();
    if (core.rainy && r < 0.45) { core.bark(n, 'weather'); return; }
    if (r < 0.55) { // two neighbours talking
      for (const o of npcs.values()) if (o !== n && o.kind === 'person' && !o.hidden && o.state !== 'flee' && d2(o.a.position.x, o.a.position.z, n.a.position.x, n.a.position.z) < 25 && o.distPlayer < 26) { if (core.chat(n, o)) return; break; }
    }
    if (r < 0.7 && (n.mem.flags || n.mem.talks)) { core.bark(n, 'memory'); return; }
    if (r < 0.8) { if (core.bark(n, 'time')) return; }
    core.bark(n, n.state === 'meal' ? 'meal' : n.state === 'gather' ? 'gather' : 'work');
  }

  // ------------------------------------------------------------------ per frame / per second
  function tick(dt, t) {
    thrT -= dt;
    if (thrT <= 0) { thrT = 0.4; refreshThreats(); }
    slowT -= dt;
    if (slowT <= 0) { slowT = 1; slowStep(); }
  }
  function refreshThreats() {
    thrN = 0;
    const C = W.combat; if (!C || !C.fighters) { return; }
    const F = C.fighters, hx = head.x, hz = head.z;
    for (let i = 0; i < F.length && thrN < 30; i++) {
      const f = F[i]; if (!f.alive || f.faction !== 'enemy' || f.reserve || !f.actor) continue;
      const p = f.actor.position; if ((p.x - hx) ** 2 + (p.z - hz) ** 2 > 80 * 80) continue;
      thr[thrN * 2] = p.x; thr[thrN * 2 + 1] = p.z; thrN++;
    }
    for (const s of ST.setts) { // enemies inside a settlement for long enough overrun it
      let c = 0; const r2 = s.r * s.r; for (let i = 0; i < thrN; i++) if ((thr[i * 2] - s.cx) ** 2 + (thr[i * 2 + 1] - s.cz) ** 2 < r2) c++;
      if (c) { s.threat += 0.4 * c; if (s.threat > 60) { s.threat = 0; core.addGrowth(s, -3, 'raid'); core.addRep(s, 0, 'raid'); core.note(`${s.name} was overrun by enemies and has lost some of its prosperity.`, false); } }
      else s.threat = Math.max(0, s.threat - 0.8);
    }
  }
  function slowStep() {
    const H = W.weapons?.held; const w = H && (H.right || H.left);
    armed = !!w && (w.kind === 'melee' || w.kind === 'ranged');
    const hr = hourNow();
    for (const s of ST.setts) {
      const near = d2(head.x, head.z, s.cx, s.cz) < 170 * 170;
      if (near && s.tier !== core.tierOf(s)) core.applyTier(s);
      // an evening fire when the settlement has none
      if (s.needFire || s.fire) {
        const night = hr >= 17.6 && hr < 22.8;
        if (night && near && !s.fire && W.library) {
          const ang = (core.hash('f' + s.slot) % 628) / 100, base = s.mealSpot || { x: s.cx, z: s.cz };
          const fx = base.x + Math.cos(ang) * 4.5, fz = base.z + Math.sin(ang) * 4.5;
          try { s.fire = W.library.spawn(ctx, 'bonfire', { x: fx, z: fz, scale: 0.6, noPush: true }); s.fireAt = { x: fx, z: fz }; } catch (e) { core.warn('evening fire failed', e); }
        } else if (!night && s.fire) { try { s.fire.remove(); } catch (e) { /* gone */ } s.fire = null; }
      }
      pairChildren(s);
    }
  }
  function dispose() { thrN = 0; }
  return { think, tick, reactAt, slowTick: () => {}, dispose, nearThreat, get threats() { return thrN; } };
}
