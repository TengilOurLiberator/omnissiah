// core/commentary.js — LIVE COMMENTARY: you watch the player and remark on it unprompted (outside wish turns; the server asks a quick separate run for one line). This module only observes and sends digests.
// ---- API for you / creations: world.commentary --------------------------------------------------------------------------------------
//   .enabled (boolean, persists, assignable)   .setEnabled(bool)   "stop commenting" -> setEnabled(false); "comment more" -> setEnabled(true) and frequency = 'chatty'
//   .frequency  'chatty' | 'normal' | 'rare'   (min gap 12 s / 25 s / 60 s; idle remark 60 s / 2 min / 5 min). Assignable; persists.  "talk less" -> 'rare'
//   .note(line, { dramatic })   feed an observation from a creation, e.g. commentary.note('The player beat the racetrack lap record: 41 s.', { dramatic: true }). A plain factual sentence with numbers.

export const meta = { name: 'Commentary', description: 'Digests what the player is doing and feeds it to the Omnissiah so it can remark unprompted.' };

const FREQ = {
  chatty: { gap: 12, dramatic: 5, idle: 60 },
  normal: { gap: 25, dramatic: 8, idle: 120 },
  rare: { gap: 60, dramatic: 15, idle: 300 },
};
const BUSY = { listening: 1, transcribing: 1, thinking: 1, coding: 1, speaking: 1 };
const WIN_MAX = 150;          // seconds: a window older than this is dropped rather than reported stale
const BOSS_RE = /boss|dragon|king|queen|lord|giant|titan|lich|demon|warlord|overlord|colossus/i;

export default function (ctx) {
  const THREE = ctx.THREE;
  const S = ctx.state;                                   // survives hot reloads
  if (typeof S.enabled !== 'boolean') S.enabled = true;
  if (!FREQ[S.frequency]) S.frequency = 'normal';
  const firsts = (S.firsts ??= {});
  const life = (S.life ??= { kills: 0, deaths: 0, sent: 0, spells: 0 });

  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
  const round1 = (n) => Math.round(n * 10) / 10;
  const round2 = (n) => Math.round(n * 100) / 100;
  const cleanName = (s, fb) => {
    if (typeof s !== 'string') return fb;
    s = s.replace(/\.js$/, '').replace(/[_]+/g, ' ').trim();
    return s ? s.slice(0, 40) : fb;
  };
  const article = (w) => (/^(a|an|the) /i.test(w) ? w : (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w);
  const pluralWord = (w) => {
    if (/s$/.test(w)) return w;
    if (/(wolf|elf|thief|dwarf)$/.test(w)) return w.replace(/f$/, 'ves');
    if (/(bow|sword|spear|axe|snow|fire|war|gate)man$/.test(w)) return w.replace(/man$/, 'men');
    if (/[^aeiou]y$/.test(w)) return w.replace(/y$/, 'ies');
    if (/(ch|sh|x|z)$/.test(w)) return w + 'es';
    return w + 's';
  };
  const plural = (n, w) => (n === 1 ? `1 ${w}` : `${n} ${pluralWord(w)}`);
  const pluralName = (n, w) => (n === 1 ? article(w) : `${n} ${pluralWord(w)}`);
  const ORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const ordinal = (n) => (n >= 1 && n <= 10 ? ORD[n] : `number ${n}`);
  const listJoin = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const metres = (m) => `${Math.round(m)} metres`;
  const secsText = (s) => `${Math.max(1, Math.round(s))} seconds`;

  // ------------------------------------------------------------------ the observation window (zeroed after each send)
  const W = {
    firstT: 0, lastT: 0, n: 0,
    spells: {}, spellTotal: 0, spellHits: 0,
    grabbed: {}, dropped: [], fired: {}, fireTotal: 0, hits: {}, hitTotal: 0, hitDmg: 0, maxHit: 0,
    kills: [], allyKills: 0, maxStreak: 0, streakSpan: 0, boss: null, friendly: [], friendlyByPlayer: 0, cleared: false,
    dmg: 0, hurts: 0, hurtFrom: {}, minHealth: Infinity, lastHealth: -1,
    deaths: [], escaped: -1, escapedTo: 0,
    walk: 0, fly: 0, drive: 0, driveT: 0, maxSpeed: 0, jumps: 0,
    objGrabs: [], throws: [],
    waves: 0, points: 0, fists: 0,
    creations: [], notes: [],
    peakEnemies: 0, peakAllies: 0, enemiesNow: 0, alliesNow: 0,
    firsts: {}, dramatic: false,
  };
  let moveWinT = 0;           // age of the movement counters: they expire like the rest of the window
  function resetWindow() {
    moveWinT = 0;
    W.firstT = W.lastT = 0; W.n = 0;
    for (const k in W.spells) delete W.spells[k];
    W.spellTotal = 0; W.spellHits = 0;
    for (const k in W.grabbed) delete W.grabbed[k];
    W.dropped.length = 0;
    for (const k in W.fired) delete W.fired[k];
    W.fireTotal = 0;
    for (const k in W.hits) delete W.hits[k];
    W.hitTotal = 0; W.hitDmg = 0; W.maxHit = 0;
    W.kills.length = 0; W.allyKills = 0; W.maxStreak = 0; W.streakSpan = 0; W.boss = null;
    W.friendly.length = 0; W.friendlyByPlayer = 0; W.cleared = false;
    W.dmg = 0; W.hurts = 0;
    for (const k in W.hurtFrom) delete W.hurtFrom[k];
    W.minHealth = Infinity;
    W.deaths.length = 0; W.escaped = -1; W.escapedTo = 0;
    W.walk = 0; W.fly = 0; W.drive = 0; W.driveT = 0; W.maxSpeed = 0; W.jumps = 0;
    W.objGrabs.length = 0; W.throws.length = 0;
    W.waves = 0; W.points = 0; W.fists = 0;
    W.creations.length = 0; W.notes.length = 0;
    W.peakEnemies = 0; W.peakAllies = 0;
    for (const k in W.firsts) delete W.firsts[k];
    W.dramatic = false;
  }
  function touch(now) { if (W.n === 0) W.firstT = now; W.n++; W.lastT = now; }
  // true the first time `key` is seen this session (persisted in ctx.state)
  function first(key) { if (firsts[key]) return false; firsts[key] = 1; return true; }

  // ------------------------------------------------------------------ session-level bookkeeping
  let nowT = ctx.clock ? ctx.clock.t : 0;
  let stateName = 'idle';
  let lastBusyEnd = -99, lastSpeak = -99;
  let lastSent = nowT;                       // the greeting just happened: the first remark waits one full gap
  let lastIdleSent = nowT;
  let lastActivity = nowT;
  let settled = false;
  const act = () => { lastActivity = nowT; };
  const nowFn = () => (ctx.clock ? ctx.clock.t : nowT);

  // recent attributions for kills
  const lastSpell = { id: '', t: -99 }, lastWeapon = { type: '', t: -99 };
  const castLast = {};                        // per-spell: last cast event time (hold spells fire every frame: count a burst once)
  const killTimes = new Float64Array(16); let killTimesN = 0;
  let nearDead = false, nearMin = 1e9, deathAt = -99;

  // ------------------------------------------------------------------ events
  const on = (name, fn) => ctx.on(name, (e) => { if (S.enabled && !ctx.world.intro?.active) fn(e || {}); }); // silent during the tutorial

  function spellDisplay(id) {
    try {
      const list = ctx.world.spells && ctx.world.spells.list && ctx.world.spells.list();
      if (list) for (let i = 0; i < list.length; i++) if (list[i].id === id) return String(list[i].name || id).toLowerCase();
    } catch (err) { /* spells reloading */ }
    return String(id).replace(/[-_]+/g, ' ');
  }
  on('spell:cast', (e) => {
    const now = nowFn(); act();
    const id = typeof e.id === 'string' ? e.id : 'a spell';
    const prev = castLast[id];
    castLast[id] = now;
    lastSpell.id = id; lastSpell.t = now;
    if (prev !== undefined && now - prev < 0.35) return;      // continuation of a held spell
    touch(now);
    W.spells[id] = (W.spells[id] | 0) + 1; W.spellTotal++; life.spells++;
    if (first('spell')) W.firsts.spell = 1;
  });
  on('kit:hit', (e) => {
    if (num(e.hits) > 0 && nowFn() - lastSpell.t < 2 && lastWeapon.t < lastSpell.t) { W.spellHits += e.hits | 0; }
  });
  on('weapon:grab', (e) => {
    const now = nowFn(); act(); touch(now);
    const type = cleanName(e.type, 'weapon').replace(/-/g, ' ');
    W.grabbed[type] = (W.grabbed[type] | 0) + 1;
    if (first('weapon:' + type)) W.firsts['grab:' + type] = 1;
  });
  on('weapon:fire', (e) => {
    const now = nowFn(); act(); touch(now);
    const type = cleanName(e.type, 'weapon').replace(/-/g, ' ');
    W.fired[type] = (W.fired[type] | 0) + 1; W.fireTotal++;
    lastWeapon.type = type; lastWeapon.t = now;
  });
  on('weapon:hit', (e) => {
    const now = nowFn(); act(); touch(now);
    const type = cleanName(e.type, 'weapon').replace(/-/g, ' ');
    W.hits[type] = (W.hits[type] | 0) + 1; W.hitTotal++;
    const a = num(e.amount); W.hitDmg += a; if (a > W.maxHit) W.maxHit = a;
    lastWeapon.type = type; lastWeapon.t = now;
  });
  on('combat:kill', (e) => {
    const now = nowFn(); act(); touch(now);
    const v = e.victim || {};
    const name = cleanName(v.name, v.faction === 'friendly' ? 'ally' : 'enemy');
    const by = e.by;
    const byPlayer = by === 'player';
    if (v.faction === 'friendly') {
      W.friendly.push(name);
      if (byPlayer) { W.friendlyByPlayer++; W.dramatic = true; }
      else if (by !== 'enemy' && by !== 'friendly') { /* unknown cause */ }
      return;
    }
    if (!byPlayer) { if (by && typeof by === 'object') W.allyKills++; return; }
    let weapon;
    if (now - lastWeapon.t < 0.9) weapon = `with the ${lastWeapon.type}`;
    else if (now - lastSpell.t < 1.6) weapon = `with the ${spellDisplay(lastSpell.id)} spell`;
    else weapon = 'by other means';
    const boss = num(v.maxHp) >= 150 || BOSS_RE.test(name);
    W.kills.push({ name, weapon, t: now, boss });
    if (W.kills.length > 120) W.kills.shift();
    life.kills++;
    if (boss) { W.boss = name; W.dramatic = true; }
    if (first('kill')) W.firsts.kill = 1;
    // streak: player kills in the last 10 s
    killTimes[killTimesN++ & 15] = now;
    let n = 0, oldest = now;
    for (let i = 0; i < 16; i++) { const k = killTimes[i]; if (k > 0 && now - k <= 10) { n++; if (k < oldest) oldest = k; } }
    if (n > W.maxStreak) { W.maxStreak = n; W.streakSpan = now - oldest; }
    if (n >= 5) W.dramatic = true;
  });
  on('player:hurt', (e) => {
    const now = nowFn(); act(); touch(now);
    W.dmg += num(e.amount); W.hurts++;
    const from = typeof e.from === 'string' ? e.from : (e.from && e.from.name) || 'enemies';
    W.hurtFrom[from] = (W.hurtFrom[from] | 0) + 1;
    const h = num(e.health, -1);
    if (h >= 0) { W.lastHealth = h; if (h < W.minHealth) W.minHealth = h; }
  });
  on('player:died', (e) => {
    const now = nowFn(); act(); touch(now);
    let by = e.by;
    if (by && typeof by === 'object') by = cleanName(by.name, by.faction ? `an ${by.faction}` : '');
    else if (typeof by !== 'string' || !by) by = '';
    W.deaths.push(by);
    W.dramatic = true; life.deaths++; nearDead = false; deathAt = now;
  });
  on('player:respawn', () => { act(); nearDead = false; });
  on('modules:synced', () => { settled = true; });
  on('module:loaded', (e) => {
    if (!settled || typeof e.path !== 'string' || !e.path.startsWith('creations/')) return;
    const now = nowFn(); touch(now);
    W.creations.push(cleanName(e.path.slice(10), 'something'));
  });
  ctx.on('oracle:state', (s) => {
    if (typeof s !== 'string') return;
    if (BUSY[stateName] && !BUSY[s]) lastBusyEnd = nowFn();
    stateName = s;
    if (BUSY[s]) act();
  });
  ctx.on('net:speak', () => { lastSpeak = nowFn(); });

  // ------------------------------------------------------------------ polling state (no allocation after this point)
  let px = 0, pz = 0, havePrev = false, fastRun = 0, fastPendDist = 0, fastPendT = 0, wasGrounded = true, jumpCool = 0;
  let stillWatchT = 0, stillReportAt = 25, pollEnemyT = 0, prevEnemies = 0;
  const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3();
  const heldType = ['', ''];
  const hold = [
    { obj: null, base: 0, x0: 0, z0: 0, y0: 0, t0: 0 },
    { obj: null, base: 0, x0: 0, z0: 0, y0: 0, t0: 0 },
  ];
  const fl = [
    { obj: null, name: '', x0: 0, z0: 0, maxD: 0, px: 0, py: 0, pz: 0, still: 0, t0: 0 },
    { obj: null, name: '', x0: 0, z0: 0, maxD: 0, px: 0, py: 0, pz: 0, still: 0, t0: 0 },
  ];
  // gesture trackers per hand
  const gs = [0, 1].map(() => ({ x: 0, dir: 0, ext: 0, revT: new Float64Array(6), revN: 0, pointT: 0, fistT: 0, waveCool: 0, pointCool: 0, fistCool: 0, wasOpen: false }));

  function objName(o) {
    let n = o && o.name;
    if (typeof n !== 'string' || !n || /^(group|mesh|object3d|scene|points)$/i.test(n)) n = o && o.userData && typeof o.userData.name === 'string' ? o.userData.name : '';
    return cleanName(n, '');
  }

  function poll(dt, now) {
    const P = ctx.world.player;
    const head = ctx.player.head;
    // ---- movement
    moveWinT += dt;
    if (moveWinT > WIN_MAX) { moveWinT = 0; W.walk = W.fly = W.drive = W.driveT = W.maxSpeed = 0; W.jumps = 0; }
    if (!havePrev) { px = head.x; pz = head.z; havePrev = true; }
    else {
      const dx = head.x - px, dz = head.z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      px = head.x; pz = head.z;
      if (dist < 25) {                                       // bigger jumps are teleports (blink, respawn)
        const speed = dist / dt;
        if (speed > 0.35) act();
        if (P && P.flying) { if (speed > 1) W.fly += dist; fastRun = 0; fastPendDist = fastPendT = 0; }
        else if (speed > 9.5) {                              // far above running speed: a vehicle
          fastRun += dt; fastPendDist += dist; fastPendT += dt;
          if (fastRun >= 2) { W.drive += fastPendDist; W.driveT += fastPendT; fastPendDist = fastPendT = 0; }
          if (speed > W.maxSpeed) W.maxSpeed = speed;
        } else {
          fastRun = Math.max(0, fastRun - dt * 2); fastPendDist = fastPendT = 0;
          if (speed > 0.3 && (!P || P.grounded !== false)) W.walk += dist;
        }
        // standing still, watching the Omnissiah
        let watching = false;
        const O = ctx.world.oracle;
        if (O) {
          _d.copy(O.position).sub(head);
          const l = _d.length();
          if (l > 0.01) watching = (_d.x * ctx.player.forward.x + _d.y * ctx.player.forward.y + _d.z * ctx.player.forward.z) / l > 0.9;
        }
        if (speed < 0.25 && watching) stillWatchT += dt;
        else { stillWatchT = Math.max(0, stillWatchT - dt * 2); if (stillWatchT === 0) stillReportAt = 25; }
      }
    }
    jumpCool -= dt;
    if (P) {
      const g = P.grounded !== false;
      if (wasGrounded && !g && num(P.velocity && P.velocity.y) > 1 && jumpCool <= 0) { W.jumps++; jumpCool = 0.4; touch(now); }
      wasGrounded = g;
      // near-death escape
      const max = num(P.maxHealth, 100), h = num(P.health, max);
      if (P.alive !== false) {
        if (h <= max * 0.2) { if (!nearDead) { nearDead = true; nearMin = h; } else if (h < nearMin) nearMin = h; }
        else if (nearDead && h >= max * 0.5) { nearDead = false; W.escaped = nearMin; W.escapedTo = h; W.dramatic = true; touch(now); }
      }
    }
    // ---- controls count as activity
    for (let i = 0; i < 2; i++) {
      const H = i ? ctx.input.right : ctx.input.left;
      if (H && H.connected && (H.trigger > 0.2 || H.squeeze > 0.2 || Math.abs(H.stick.x) > 0.3 || Math.abs(H.stick.y) > 0.3)) act();
    }
    // ---- fighters on the field (1 Hz)
    pollEnemyT += dt;
    if (pollEnemyT >= 1) {
      pollEnemyT = 0;
      const C = ctx.world.combat;
      if (C && typeof C.count === 'function') {
        let en = 0, al = 0;
        try { en = C.count('enemy') | 0; al = C.count('friendly') | 0; } catch (err) { en = al = 0; }
        W.enemiesNow = en; W.alliesNow = al;
        if (en > W.peakEnemies) W.peakEnemies = en;
        if (al > W.peakAllies) W.peakAllies = al;
        if (prevEnemies > 0 && en === 0 && W.kills.length > 0) { W.cleared = true; touch(now); }
        prevEnemies = en;
      }
    }
    // ---- weapons put down
    const WH = ctx.world.weapons && ctx.world.weapons.held;
    for (let i = 0; i < 2; i++) {
      const w = WH ? (i ? WH.right : WH.left) : null;
      const t = w && w.type ? cleanName(w.type, 'weapon').replace(/-/g, ' ') : '';
      if (heldType[i] && !t) { W.dropped.push(heldType[i]); touch(now); act(); }
      heldType[i] = t;
    }
    // ---- kit objects grabbed and thrown (anything that ends up parented to a hand anchor and is not a weapon)
    for (let i = 0; i < 2; i++) {
      const H = i ? ctx.input.right : ctx.input.left;
      const kids = H && H.anchor && H.anchor.children;
      if (!kids) continue;
      const hd = hold[i];
      if (!hd.obj) {
        if (!(H.squeeze > 0.5) || heldType[i]) hd.base = kids.length;
        else if (kids.length > hd.base) {
          hd.obj = kids[kids.length - 1]; hd.t0 = now;
          hd.obj.getWorldPosition(_p); hd.x0 = _p.x; hd.z0 = _p.z; hd.y0 = _p.y;
          const nm = objName(hd.obj) || 'object';
          W.objGrabs.push(nm); touch(now); act();
        }
      } else if (hd.obj.parent !== H.anchor) {              // let go: follow its flight
        const f = fl[i];
        f.obj = hd.obj; f.name = objName(hd.obj); f.t0 = now; f.still = 0;
        if (f.obj.parent) { f.obj.getWorldPosition(_p); f.x0 = f.px = _p.x; f.py = _p.y; f.z0 = f.pz = _p.z; } else { f.obj = null; }
        f.maxD = 0;
        hd.obj = null; hd.base = kids.length;
      }
      const f = fl[i];
      if (f.obj) {
        if (!f.obj.parent) { endFlight(f, now); continue; }
        f.obj.getWorldPosition(_p);
        const d = Math.hypot(_p.x - f.x0, _p.z - f.z0);
        if (d > f.maxD) f.maxD = d;
        const sp = Math.sqrt((_p.x - f.px) ** 2 + (_p.y - f.py) ** 2 + (_p.z - f.pz) ** 2) / dt;
        f.px = _p.x; f.py = _p.y; f.pz = _p.z;
        if (sp < 0.8) f.still += dt; else f.still = 0;
        if (f.still > 0.5 || now - f.t0 > 8) endFlight(f, now);
      }
    }
  }
  function endFlight(f, now) {
    if (f.maxD >= 4) {
      W.throws.push({ name: f.name || 'object', d: f.maxD }); touch(now); act();
      if (first('throw')) W.firsts.throw = 1;
    }
    f.obj = null;
  }

  // ---- hand-tracking gestures (per frame, a handful of float ops; only for tracked hands)
  function gestureTick(dt, now) {
    const O = ctx.world.oracle;
    const head = ctx.player.head, fw = ctx.player.forward;
    const hl = Math.hypot(fw.x, fw.z) || 1;
    for (let i = 0; i < 2; i++) {
      const H = i ? ctx.input.right : ctx.input.left;
      const g = gs[i];
      g.waveCool -= dt; g.pointCool -= dt; g.fistCool -= dt;
      if (!H || !H.connected) { g.revN = 0; g.pointT = 0; g.fistT = 0; continue; }
      let pointing = false;
      if (H.tracked && H.fingers) {
        const F = H.fingers, gest = F.gesture;
        // wave: an open hand sweeping side to side at head/chest height
        if (gest === 'open' && F.wrist.y > head.y - 0.7) {
          const x = ((F.wrist.x - head.x) * -fw.z + (F.wrist.z - head.z) * fw.x) / hl;
          if (!g.wasOpen) { g.ext = x; g.dir = 0; g.revN = 0; g.wasOpen = true; }
          else if (g.dir === 0) { if (Math.abs(x - g.ext) > 0.045) { g.dir = x > g.ext ? 1 : -1; g.ext = x; } }
          else if (g.dir > 0) {
            if (x > g.ext) g.ext = x;
            else if (g.ext - x > 0.045) { g.dir = -1; g.ext = x; g.revT[g.revN++ % 6] = now; }
          } else {
            if (x < g.ext) g.ext = x;
            else if (x - g.ext > 0.045) { g.dir = 1; g.ext = x; g.revT[g.revN++ % 6] = now; }
          }
          if (g.revN >= 4 && g.waveCool <= 0) {
            let recent = 0;
            for (let k = 0; k < 6; k++) if (now - g.revT[k] < 2.5) recent++;
            if (recent >= 4) { g.waveCool = 20; W.waves++; touch(now); act(); g.revN = 0; if (first('wave')) W.firsts.wave = 1; }
          }
          act();
        } else { g.wasOpen = false; g.revN = 0; }
        // raised fist
        if (gest === 'fist' && F.wrist.y > head.y) { g.fistT += dt; if (g.fistT > 1 && g.fistCool <= 0) { g.fistCool = 30; W.fists++; touch(now); act(); } }
        else g.fistT = Math.max(0, g.fistT - dt);
        // pointing a finger at the Omnissiah
        if (gest === 'point' && O) {
          _d.copy(F.index).sub(F.wrist).normalize();
          _o.copy(O.position).sub(F.wrist).normalize();
          pointing = _d.dot(_o) > 0.985;
        }
      } else if (O && i === 1 && H.trigger < 0.2) {
        // a controller held steady on the Omnissiah for a few seconds
        _o.copy(O.position).sub(H.position).normalize();
        pointing = H.direction.dot(_o) > 0.994;
        if (pointing) { g.pointT += dt * 0.4; pointing = false; } else g.pointT = Math.max(0, g.pointT - dt);
      }
      if (pointing) g.pointT += dt;
      else if (H.tracked) g.pointT = Math.max(0, g.pointT - dt);
      if (g.pointT > 1.2 && g.pointCool <= 0) { g.pointCool = 30; g.pointT = 0; W.points++; touch(now); act(); }
    }
  }

  // ------------------------------------------------------------------ scan: what is notable? (numbers only unless `build`)
  let maxP = 0, dram = false;
  const out = [];
  const mark = (p, d) => { if (p > maxP) maxP = p; if (d) dram = true; };
  const emit = (p, s) => { out.push({ p, s }); };

  function scan(build, now) {
    maxP = 0; dram = W.dramatic; out.length = 0;
    // deaths
    if (W.deaths.length) {
      mark(10, true);
      if (build) {
        const last = W.deaths[W.deaths.length - 1];
        const who = last ? `to ${article(last)}` : '';
        emit(10, W.deaths.length > 1 ? `Died ${W.deaths.length} times${last ? ` (last ${who})` : ''}; ${ordinal(life.deaths)} death overall.`
          : `Died${last ? ` ${who}` : ''}; ${ordinal(life.deaths)} death.`);
      }
    }
    // kills
    const nk = W.kills.length;
    if (W.boss) { mark(9, true); if (build) emit(9, `Slew ${article(W.boss)}, a boss-class enemy.`); }
    if (W.maxStreak >= 5) { mark(8, true); if (build) emit(8, `Kill streak: ${W.maxStreak} kills in ${secsText(W.streakSpan)}.`); }
    if (nk > 0) {
      mark(4 + Math.min(2, (nk / 4) | 0), false);
      if (build) {
        // group by victim + weapon, biggest groups first
        const groups = [];
        for (let i = 0; i < nk; i++) {
          const k = W.kills[i];
          let g = null;
          for (let j = 0; j < groups.length; j++) if (groups[j].name === k.name && groups[j].weapon === k.weapon) { g = groups[j]; break; }
          if (!g) groups.push(g = { name: k.name, weapon: k.weapon, n: 0 });
          g.n++;
        }
        groups.sort((a, b) => b.n - a.n);
        const parts = [];
        for (let j = 0; j < groups.length && j < 3; j++) parts.push(`${pluralName(groups[j].n, groups[j].name)} ${groups[j].weapon}`);
        if (groups.length > 3) parts.push(`${nk - groups[0].n - groups[1].n - groups[2].n} others`);
        const span = W.kills[nk - 1].t - W.kills[0].t;
        emit(5, `Killed ${listJoin(parts)}${nk > 1 && span >= 1 ? ` in ${secsText(span)}` : ''}${W.firsts.kill ? '; first kill of the session' : ''}.`);
      }
    }
    if (W.friendly.length) {
      mark(W.friendlyByPlayer ? 7 : 5, !!W.friendlyByPlayer);
      if (build) emit(W.friendlyByPlayer ? 7 : 5, W.friendlyByPlayer ? `Killed ${W.friendlyByPlayer === 1 ? 'a friendly' : W.friendlyByPlayer + ' friendlies'} (${listJoin(W.friendly.slice(0, 3))}).` : `Lost ${plural(W.friendly.length, 'ally')}${W.friendly.length <= 3 ? ` (${listJoin(W.friendly)})` : ''}.`);
    }
    if (W.allyKills > 0) { mark(3, false); if (build) emit(3, `Allies killed ${plural(W.allyKills, 'enemy')}.`); }
    if (W.cleared) { mark(3, false); if (build) emit(3, 'The field is clear of enemies.'); }
    // damage
    if (W.hurts > 0) {
      mark(W.dmg >= 15 ? 4 : 3, false);
      if (build) {
        const froms = Object.keys(W.hurtFrom).slice(0, 3);
        const h = W.lastHealth >= 0 ? `; health now ${Math.round(W.lastHealth)}/${Math.round(num(ctx.world.player && ctx.world.player.maxHealth, 100))}` : '';
        emit(W.dmg >= 15 ? 4 : 3, `Took ${Math.round(W.dmg)} damage in ${plural(W.hurts, 'hit')}${froms.length ? ` from ${listJoin(froms)}` : ''}${h}.`);
      }
    }
    if (W.escaped >= 0) { mark(8, true); if (build) emit(8, `Escaped near-death at ${Math.round(W.escaped)} health and recovered to ${Math.round(W.escapedTo)}.`); }
    // spells
    if (W.spellTotal > 0) {
      const p = W.spellTotal >= 4 || W.firsts.spell ? 4 : 3;
      mark(p, false);
      if (build) {
        const ids = Object.keys(W.spells).sort((a, b) => W.spells[b] - W.spells[a]).slice(0, 3);
        const parts = ids.map((id) => `${spellDisplay(id)} ${W.spells[id] === 1 ? 'once' : W.spells[id] + ' times'}`);
        emit(p, `Cast ${listJoin(parts)}${W.spellHits > 0 ? ` (${plural(W.spellHits, 'hit')} landed)` : ''}${W.firsts.spell ? '; first spell of the session' : ''}.`);
      }
    }
    // weapons
    const gk = W.grabbed; let grabN = 0, grabFirst = false;
    for (const k in gk) { grabN++; if (W.firsts['grab:' + k]) grabFirst = true; }
    if (grabN > 0) {
      mark(grabFirst ? 4 : 3, false);
      if (build) emit(grabFirst ? 4 : 3, `Picked up ${listJoin(Object.keys(gk).slice(0, 3).map((k) => article(k) + (W.firsts['grab:' + k] ? ' for the first time' : '')))}.`);
    }
    if (W.hitTotal > 0) {
      const p = W.hitTotal >= 4 ? 4 : 3;
      mark(p, false);
      if (build) {
        const ts = Object.keys(W.hits).sort((a, b) => W.hits[b] - W.hits[a]);
        emit(p, `Landed ${plural(W.hitTotal, 'hit')} with the ${ts[0]}${W.maxHit > 0 ? ` (best ${Math.round(W.maxHit)} damage)` : ''}.`);
      }
    }
    if (W.fireTotal >= 6) {
      mark(4, false);
      if (build) { const ts = Object.keys(W.fired).sort((a, b) => W.fired[b] - W.fired[a]); emit(4, `Fired the ${ts[0]} ${W.fired[ts[0]]} times.`); }
    }
    if (W.dropped.length) { mark(2, false); if (build) emit(2, `Put down the ${W.dropped[W.dropped.length - 1]}.`); }
    // movement
    if (W.drive >= 40) { mark(5, false); if (build) emit(5, `Drove for ${secsText(W.driveT)} at up to ${Math.round(W.maxSpeed)} m/s (about ${metres(W.drive)}).`); }
    if (W.fly >= 80) { mark(4, false); if (build) emit(4, `Flew ${metres(W.fly)}.`); }
    if (W.walk >= 60) { mark(W.walk >= 250 ? 4 : 3, false); if (build) emit(W.walk >= 250 ? 4 : 3, `Walked ${metres(W.walk)}.`); }
    if (W.jumps >= 5) { mark(3, false); if (build) emit(3, `Jumped ${W.jumps} times.`); }
    // things grabbed and thrown
    if (W.throws.length) {
      mark(5, false);
      if (build) {
        let best = W.throws[0];
        for (let i = 1; i < W.throws.length; i++) if (W.throws[i].d > best.d) best = W.throws[i];
        const what = best.name === 'object' ? 'something' : article(best.name);
        emit(5, (W.throws.length === 1 ? `Threw ${what} ${metres(best.d)}` : `Threw things ${W.throws.length} times; the farthest, ${what}, flew ${metres(best.d)}`) + (W.firsts.throw ? '; first throw of the session.' : '.'));
      }
    } else if (W.objGrabs.length) { mark(3, false); if (build) emit(3, `Picked up ${listJoin(W.objGrabs.slice(0, 3).map((n) => (n === 'object' ? 'an object' : article(n))))}.`); }
    // presence and gestures
    if (stillWatchT >= stillReportAt) { mark(5, false); if (build) emit(5, `Has been standing still watching you for ${secsText(stillWatchT)}.`); }
    if (W.waves) { mark(6, false); if (build) emit(6, (W.waves > 1 ? `Waved at you ${W.waves} times` : 'Waved at you') + (W.firsts.wave ? ' for the first time.' : '.')); }
    if (W.points) { mark(5, false); if (build) emit(5, 'Pointed straight at you.'); }
    if (W.fists) { mark(5, false); if (build) emit(5, 'Raised a fist toward you.'); }
    // creations (weak context) and notes (strong)
    if (W.creations.length) { mark(2, false); if (build) emit(2, `New ${W.creations.length === 1 ? 'creation' : 'creations'} appeared: ${listJoin(W.creations.slice(0, 3))}.`); }
    for (let i = 0; i < W.notes.length; i++) {
      const n = W.notes[i];
      mark(n.dramatic ? 8 : 5, n.dramatic);
      if (build) emit(n.dramatic ? 8 : 5, n.text);
    }
    if (build && maxP >= 4 && (W.enemiesNow > 0 || W.alliesNow > 0)) emit(2, `${plural(W.enemiesNow, 'enemy')} and ${plural(W.alliesNow, 'ally')} on the field now.`);
  }

  // the final 1-5 lines (highest priority first), with weak context only when something strong is present
  function buildLines(now) {
    scan(true, now);
    if (maxP < 4) return null;
    out.sort((a, b) => b.p - a.p);
    const lines = [];
    for (let i = 0; i < out.length && lines.length < 5; i++) lines.push(out[i].s);
    return lines;
  }

  // ------------------------------------------------------------------ sending
  const busy = () => !!BUSY[stateName];
  function sendLines(lines, now) {
    const P = ctx.world.player;
    const f = ctx.player.feet, fw = ctx.player.forward;
    const msg = {
      type: 'activity',
      lines,
      context: {
        player: { position: [round2(f.x), round2(f.y), round2(f.z)], forward: [round2(fw.x), round2(fw.y), round2(fw.z)] },
        health: P && typeof P.health === 'number' ? Math.round(P.health) : null,
        maxHealth: P && typeof P.maxHealth === 'number' ? Math.round(P.maxHealth) : null,
      },
    };
    let ok = true;
    try { if (ctx.net && ctx.net.send) ok = ctx.net.send(msg) !== false; } catch (err) { ok = false; }
    if (!ok) return false;
    lastSent = now; life.sent++;
    if (stillWatchT >= stillReportAt) stillReportAt = stillWatchT + 60;   // do not repeat "still watching" every message
    resetWindow();
    return true;
  }

  function tick(now, force) {
    if (!S.enabled) return;
    if (W.n > 0 && now - W.firstT > WIN_MAX && !force) resetWindow();   // too stale to be worth reporting
    if (busy() || now - lastBusyEnd < 3 || now - lastSpeak < 4) return;
    const f = FREQ[S.frequency];
    scan(false, now);
    const gap = now - lastSent;
    if (maxP >= 4) {
      // let a burst of events finish so one digest covers it: wait for a short lull (1 s when dramatic, 4 s otherwise),
      // but never hold a continuing fight back for more than 15 s
      const lull = now - W.lastT;
      const ready = force || (dram ? lull >= 1 : lull >= 4 || now - W.firstT >= 15);
      if (ready && (force || gap >= (dram ? f.dramatic : f.gap))) {
        const lines = buildLines(now);
        if (lines && sendLines(lines, now)) lastIdleSent = now;
      }
      return;
    }
    // a gentle idle remark
    const idle = now - lastActivity;
    if (idle >= 60 && now - lastIdleSent >= f.idle && gap >= f.gap) {
      lastIdleSent = now;
      sendLines([`Has done nothing for ${secsText(idle)}; standing idle.`], now);
    }
  }

  // ------------------------------------------------------------------ public API
  const api = {
    get enabled() { return !!S.enabled; },
    set enabled(v) { setEnabled(v); },
    setEnabled,
    get frequency() { return S.frequency; },
    set frequency(v) { if (FREQ[v]) S.frequency = v; },
    note(line, opts) {
      if (!S.enabled || typeof line !== 'string') return false;
      const text = line.trim().replace(/\s+/g, ' ').slice(0, 240);
      if (!text) return false;
      const now = nowFn(); touch(now); act();
      const dramatic = !!(opts && opts.dramatic);
      W.notes.push({ text, dramatic });
      if (W.notes.length > 8) W.notes.shift();
      if (dramatic) W.dramatic = true;
      return true;
    },
    preview() { return buildLines(nowFn()) || []; },
    flush() { tick(nowFn(), true); return true; },
  };
  function setEnabled(v) {
    const b = !!v;
    if (b && !S.enabled) { resetWindow(); lastSent = nowFn(); }
    S.enabled = b;
    if (!b) resetWindow();
    return b;
  }
  ctx.provide('commentary', api);

  // ------------------------------------------------------------------ per-frame
  let accPoll = 0, accTick = 0;
  return {
    update(dt, t) {
      nowT = t;
      if (!S.enabled) return;
      gestureTick(dt, t);
      accPoll += dt;
      if (accPoll >= 0.25) { poll(accPoll, t); accPoll = 0; }
      accTick += dt;
      if (accTick >= 0.5) { accTick = 0; tick(t, false); }
    },
    dispose() { /* everything lives in ctx.state / event subscriptions, which boot cleans up */ },
  };
}

