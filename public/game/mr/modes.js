// mr/modes.js — the MR game modes. Each mode is small but finished: gods-table (sandbox), tower-defence, arena, bowling (+ marbles).
// A mode = { title, icon, enter(), exit(), update(dt, t), items() -> palette entries, status() -> board lines, score(), event(name, data) }.
// Everything a mode spawns belongs to the mr module's ctx (library handles / kit bodies) and is removed when the mode ends or MR exits.
export default function (env) {
  const { THREE, ctx, S, stage, world, events } = env;
  const { Vector3, Group, Mesh } = THREE;
  const clamp = THREE.MathUtils.clamp;
  const lib = () => world.library, kit = () => world.kit, hands = () => env.parts.hands, st = () => env.parts.stage;
  const owned = [];                 // library handles spawned by the current mode
  const dispo = [];
  const keep = (x) => { dispo.push(x); return x; };
  const note = (line, dramatic) => { try { world.commentary && world.commentary.note && world.commentary.note(line, { dramatic: !!dramatic }); } catch (e) { /* optional */ } };
  const xp = (n, why) => { try { world.quests && world.quests.grantXp && n > 0 && world.quests.grantXp(Math.round(n), why); } catch (e) { /* optional */ } };
  const hud = (t, s = 2) => { try { ctx.hud && ctx.hud.show(t, s); } catch (e) { /* optional */ } };
  const best = (id) => { try { return JSON.parse(localStorage.getItem('omni.mr.best') || '{}')[id] || 0; } catch (e) { return 0; } };
  const saveBest = (id, v) => { try { const o = JSON.parse(localStorage.getItem('omni.mr.best') || '{}'); if (v > (o[id] || 0)) { o[id] = v; localStorage.setItem('omni.mr.best', JSON.stringify(o)); return true; } } catch (e) { /* private mode */ } return false; };
  const has = (n) => { const L = lib(); try { return !!(L && L.has(n)); } catch (e) { return false; } };
  const pick = (...names) => names.find(has) ?? null;

  function spawn(name, p, opts = {}) {
    const L = lib();
    if (!L || !name) return null;
    try {
      const h = L.spawn(ctx, name, { x: p.x, z: p.z, ...opts });
      if (h) owned.push(h);
      return h;
    } catch (err) { console.error('[mr] spawn failed', name, err); return null; }
  }
  function clearOwned() {
    for (const h of owned.splice(0)) { try { h.remove && h.remove(); } catch (e) { /* gone */ } }
  }
  const arm = (a) => { const H = hands(); if (H) H.arm(a); };
  const inDisc = (p, m = 1.2) => Math.hypot(p.x, p.z) <= env.radius - m;

  // =============================================================== God's Table
  function godsTable() {
    const stat = { kills: 0, thrown: 0, quakes: 0, flicks: 0, paths: 0 };
    let killOff = null, thrOff = null;
    const FAV_DEFAULT = [['goblin'], ['knight'], ['village'], ['oak-tree', 'pine-tree'], ['troll', 'ogre']];
    const favs = () => {
      let f = S.favs;
      if (!f) { try { f = JSON.parse(localStorage.getItem('omni.mr.fav') || 'null'); } catch (e) { f = null; } }
      if (!Array.isArray(f) || !f.length) f = FAV_DEFAULT.map((l) => pick(...l)).filter(Boolean);
      S.favs = f.filter(has).slice(0, 5);
      return S.favs;
    };
    const ICON = { goblin: '👺', knight: '🛡', village: '🏘', 'oak-tree': '🌳', 'pine-tree': '🌲', troll: '👹', ogre: '👹' };
    return {
      title: "God's Table", icon: '🌍',
      enter() {
        killOff = events.on('combat:kill', (e) => { if (e && (e.by === 'player' || e.by === 'friendly')) { stat.kills++; if (stat.kills % 10 === 0) note(`The giant has smitten ${stat.kills} tiny creatures on the table.`, stat.kills >= 30); } });
        thrOff = events.on('mr:throw', () => { stat.thrown++; });
      },
      exit() { killOff && killOff(); thrOff && thrOff(); xp(stat.kills * 2 + stat.thrown, "God's Table"); },
      items() {
        return favs().map((n) => ({
          id: 'sum:' + n, icon: ICON[n] ?? n.slice(0, 2).toUpperCase(), label: n.replace(/-/g, ' '), color: '#8fb4ff',
          active: () => { const a = hands() && hands().armed; return !!a && a.id === 'sum:' + n; },
          onTap() {
            const H = hands(); if (!H) return;
            if (H.armed && H.armed.id === 'sum:' + n) { H.disarm(); return; }
            H.arm({ id: 'sum:' + n, label: n, color: 0x8fb4ff, radius: 1.6, keep: true, place: (p) => !!spawn(n, p, n === 'village' ? {} : {}) });
          },
        }));
      },
      status: () => ["God's Table", `smitten ${stat.kills}   thrown ${stat.thrown}`, `quakes ${stat.quakes}   flicks ${stat.flicks}`],
      score: () => stat.kills * 10 + stat.thrown * 2 + stat.quakes * 5,
      event(n) { if (n === 'quake') stat.quakes++; else if (n === 'flick') stat.flicks++; else if (n === 'path') stat.paths++; },
      update() {},
      stat,
    };
  }

  // =============================================================== Tower Defence
  const PATH = [[-13.6, 5.2], [-9.5, 5.6], [-6.2, 3.2], [-4.2, -0.8], [-0.5, -2.6], [3.6, -1.6], [5.8, 2.2], [9.2, 2.8], [11.2, -0.6]];
  const SHRINE = { x: 11.2, z: -0.6 };
  const WAVES = [
    [['goblin', 4]], [['goblin', 6]], [['goblin', 5], ['skeleton', 2]], [['orc-brute', 2], ['goblin', 5]],
    [['skeleton', 6], ['orc-brute', 1]], [['wolf', 6], ['goblin', 5]], [['troll', 1], ['goblin', 6]], [['ogre', 1], ['orc-brute', 2], ['skeleton', 6]],
  ];
  const TOWERS = [
    { id: 'archer', name: 'archer', cost: 30, icon: '🏹', color: 0x7fe3a0 }, { id: 'mage', name: 'mage', cost: 50, icon: '🔮', color: 0x8c9aff },
    { id: 'knight', name: 'knight', cost: 40, icon: '🛡', color: 0xa8c4ff }, { id: 'healer', name: 'healer', cost: 40, icon: '✚', color: 0xffffff },
  ];
  function distToPath(x, z) {
    let d = 1e9;
    for (let i = 0; i < PATH.length - 1; i++) {
      const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
      const t = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1);
      d = Math.min(d, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
    }
    return d;
  }
  function towerDefence() {
    const g = new Group(); g.name = 'mr-td'; g.visible = false; stage.add(g);
    const T = { phase: 'build', wave: 0, gold: 100, hp: 20, kills: 0, score: 0, queue: [], spawnT: 0, foes: [], towers: [], countdown: 25, over: false, bestNew: false };
    function build() { // path ribbon, gate, shrine
      const pos = [], idx = [], W = 1.25;
      PATH.forEach(([x, z], i) => {
        const a = PATH[Math.max(0, i - 1)], b = PATH[Math.min(PATH.length - 1, i + 1)];
        let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        pos.push(x - dz * W, 0.05, z + dx * W, x + dz * W, 0.05, z - dx * W);
        if (i > 0) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      });
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      const ribbon = new Mesh(geo, keep(new THREE.MeshLambertMaterial({ color: 0xc9a96e, side: THREE.DoubleSide })));
      ribbon.userData.noShadow = ribbon.userData.noOutline = true; g.add(ribbon);
      const wood = keep(new THREE.MeshLambertMaterial({ color: 0x7a5535 }));
      const post = keep(new THREE.CylinderGeometry(0.25, 0.3, 4.2, 6).translate(0, 2.1, 0)), beam = keep(new THREE.BoxGeometry(3.6, 0.5, 0.5));
      const [gx, gz] = PATH[0];
      const p1 = new Mesh(post, wood), p2 = new Mesh(post, wood), lt = new Mesh(beam, wood);
      p1.position.set(gx + 0.2, 0, gz - 1.7); p2.position.set(gx + 0.2, 0, gz + 1.7); lt.position.set(gx + 0.2, 4.2, gz); lt.rotation.y = Math.PI / 2;
      g.add(p1, p2, lt);
      const base = new Mesh(keep(new THREE.CylinderGeometry(1.8, 2.2, 0.8, 8).translate(0, 0.4, 0)), keep(new THREE.MeshLambertMaterial({ color: 0x8a8d99 })));
      const crystal = new Mesh(keep(new THREE.OctahedronGeometry(1.3).scale(1, 1.7, 1).translate(0, 3.2, 0)), keep(new THREE.MeshLambertMaterial({ color: 0x66e0ff, emissive: 0x2288aa })));
      base.position.set(SHRINE.x, 0, SHRINE.z); crystal.position.set(SHRINE.x, 0, SHRINE.z);
      g.add(base, crystal); T.crystal = crystal;
    }
    build();
    const waveList = (i) => WAVES[Math.min(i, WAVES.length - 1)].map(([n, c]) => [pick(n, 'goblin'), c]);
    function placeTower(def, p) {
      if (T.over || T.gold < def.cost || !inDisc(p) || distToPath(p.x, p.z) < 1.5 || T.towers.length >= 14) { hud(T.gold < def.cost ? 'Not enough gold' : 'Cannot build there', 1.4); return false; }
      const h = spawn(pick(def.name), p, { faction: 'friendly', yaw: 0 });
      if (!h) return false;
      T.gold -= def.cost; T.towers.push(h);
      for (const f of h.fighters || []) { f.follow = null; f.leash = 12; f.aggro = 15; f.homeX = p.x; f.homeZ = p.z; try { f.actor.wander && f.actor.wander(0); } catch (e) { /* ignore */ } }
      const mark = new Mesh(keep(new THREE.CylinderGeometry(1.0, 1.2, 0.35, 10).translate(0, 0.17, 0)), keep(new THREE.MeshLambertMaterial({ color: def.color })));
      mark.position.set(p.x, 0, p.z); g.add(mark);
      return true;
    }
    function startWave() {
      if (T.phase !== 'build' || T.over) return false;
      T.wave++; T.phase = 'wave';
      T.queue = [];
      for (const [n, c] of waveList(T.wave - 1)) for (let i = 0; i < c; i++) T.queue.push(n);
      T.queue.sort(() => Math.random() - 0.5);
      T.spawnT = 0.2;
      hud(`Wave ${T.wave} / ${WAVES.length}`, 2);
      return true;
    }
    function spawnFoe(name) {
      const h = spawn(name, { x: PATH[0][0] + 0.5, z: PATH[0][1] }, { faction: 'enemy' });
      if (!h) return;
      for (const f of h.fighters || []) {
        f.follow = null; f.aggro = 5.5; f.leash = 120; f.homeX = PATH[1][0]; f.homeZ = PATH[1][1]; f.returning = true;
        try { f.actor.wander && f.actor.wander(0); } catch (e) { /* ignore */ }
        T.foes.push({ f, wp: 1, bounty: clamp(Math.round(f.maxHp / 4), 5, 25), hp0: f.maxHp });
      }
    }
    function end(won) {
      T.over = true; T.phase = won ? 'won' : 'lost';
      T.score = T.kills * 10 + Math.max(0, T.hp) * 5 + T.gold + (won ? 100 : 0);
      T.bestNew = saveBest('tower-defence', T.score);
      xp(T.score / 6, 'Tower defence');
      note(won ? `The player defended the tiny shrine through all ${WAVES.length} waves, score ${T.score}.` : `The tiny shrine fell on wave ${T.wave}; the giant scored ${T.score}.`, true);
      hud(won ? `Victory! Score ${T.score}` : `The shrine has fallen. Score ${T.score}`, 4);
      events.emit('mr:score', { mode: 'tower-defence', score: T.score, won });
    }
    return {
      title: 'Tower Defence', icon: '🏰',
      enter() { g.visible = true; st() && st().maskTrees((x, z) => distToPath(x, z) < 3.4 || Math.hypot(x - SHRINE.x, z - SHRINE.z) < 4); },
      exit() { stage.remove(g); st() && st().maskTrees(null); clearOwned(); T.foes.length = 0; T.towers.length = 0; hands() && hands().disarm(); },
      items() {
        const it = TOWERS.map((d) => ({
          id: 'tw:' + d.id, icon: d.icon, label: `${d.name} ${d.cost}g`, color: '#' + d.color.toString(16).padStart(6, '0'), disabled: () => T.gold < d.cost,
          active: () => { const a = hands() && hands().armed; return !!a && a.id === 'tw:' + d.id; },
          onTap() {
            const H = hands(); if (!H) return;
            if (H.armed && H.armed.id === 'tw:' + d.id) { H.disarm(); return; }
            H.arm({ id: 'tw:' + d.id, label: d.name, color: d.color, radius: 1.5, keep: true, place: (p) => placeTower(d, p) });
          },
        }));
        it.push({ id: 'td:go', icon: T.over ? '↻' : '▶', label: T.over ? 'again' : T.phase === 'build' ? 'wave' : '...', color: '#ffd877', onTap() { if (T.over) api_restart(); else startWave(); } });
        return it;
      },
      status() {
        if (T.over) return [T.phase === 'won' ? 'VICTORY' : 'SHRINE LOST', `score ${T.score}${T.bestNew ? '  NEW BEST' : ''}`, `best ${best('tower-defence')}`];
        return ['Tower Defence', `wave ${T.wave}/${WAVES.length}  gold ${T.gold}`, `shrine ${Math.max(0, T.hp)}/20  kills ${T.kills}`, T.phase === 'build' ? `build! next wave in ${Math.ceil(T.countdown)}s` : `foes ${T.foes.length + T.queue.length}`];
      },
      score: () => (T.over ? T.score : T.kills * 10 + T.hp * 5 + T.gold),
      event() {},
      update(dt, t) {
        if (T.crystal) { T.crystal.rotation.y += dt * 0.8; T.crystal.position.y = Math.sin(t * 2) * 0.25; }
        if (T.over) return;
        if (T.phase === 'build') { T.countdown -= dt; if (T.countdown <= 0) { T.countdown = 25; startWave(); } }
        if (T.phase === 'wave') {
          T.spawnT -= dt;
          if (T.queue.length && T.spawnT <= 0) { spawnFoe(T.queue.pop()); T.spawnT = 1.1; }
        }
        T.tick = (T.tick ?? 0) - dt;
        if (T.tick > 0) return;
        T.tick = 0.25;
        for (let i = T.foes.length - 1; i >= 0; i--) {
          const e = T.foes[i], f = e.f;
          if (!f.alive) { T.foes.splice(i, 1); if (f.hp <= 0 || f.dead) { T.kills++; T.gold += e.bounty; } continue; }
          const p = f.actor.position;
          if (Math.hypot(p.x - SHRINE.x, p.z - SHRINE.z) < 2.6) {
            T.hp -= clamp(Math.ceil(e.hp0 / 30), 1, 6);
            st() && st().ripple(SHRINE, 5, 0xff6644, 0.8);
            T.foes.splice(i, 1); try { f.remove(); } catch (er) { /* ignore */ }
            if (T.hp <= 0) { end(false); return; }
            continue;
          }
          const w = PATH[e.wp];
          if (w && Math.hypot(p.x - w[0], p.z - w[1]) < 2.2 && e.wp < PATH.length - 1) { e.wp++; const nw = PATH[e.wp]; f.homeX = nw[0]; f.homeZ = nw[1]; f.returning = !f.tgt; }
          else if (!f.tgt && !f.returning) { f.returning = true; }
        }
        if (T.phase === 'wave' && !T.queue.length && !T.foes.length) {
          T.gold += 20 + T.wave * 5; T.phase = 'build'; T.countdown = 25;
          for (const h of T.towers) for (const f of h.fighters || []) if (f.alive) f.heal(f.maxHp * 0.5);
          if (T.wave >= WAVES.length) end(true); else hud(`Wave ${T.wave} cleared`, 1.8);
        }
      },
      T,
      startWave, placeTower: (id, p) => placeTower(TOWERS.find((d) => d.id === id), p), api_restart,
    };
    function api_restart() { return env.parts.modes && env.parts.modes.restart(); }
  }

  // =============================================================== Arena
  function arena() {
    const A = { fighters: { blue: [], red: [] }, phase: 'place', result: '', score: 0, tick: 0 };
    const BLUE = ['knight', 'archer', 'mage', 'knight', 'paladin'], RED = ['goblin', 'orc-brute', 'skeleton', 'goblin-archer', 'goblin-shaman'];
    function squad(team, p) {
      const names = (team === 'blue' ? BLUE : RED).map((n, i) => pick(n, team === 'blue' ? 'knight' : 'goblin')).filter(Boolean);
      names.forEach((n, i) => {
        const a = (i / names.length) * 6.28, q = { x: clamp(p.x + Math.cos(a) * 1.6, -13, 13), z: clamp(p.z + Math.sin(a) * 1.6, -13, 13) };
        const h = spawn(n, q, { faction: team === 'blue' ? 'friendly' : 'enemy', yaw: team === 'blue' ? -1.57 : 1.57 });
        if (!h) return;
        for (const f of h.fighters || []) {
          f.follow = null; f.aggro = 60; f.leash = 140; f.homeX = q.x; f.homeZ = q.z;
          try { f.actor.wander && f.actor.wander(0); } catch (e) { /* ignore */ }
          if (A.phase === 'place') f.actor.staggerT = 99999;
          A.fighters[team].push(f);
        }
      });
      return true;
    }
    const alive = (team) => A.fighters[team].filter((f) => f.alive).length;
    function fight() {
      if (A.phase !== 'place' || (!alive('blue') && !alive('red'))) return false;
      A.phase = 'fight';
      for (const t of ['blue', 'red']) for (const f of A.fighters[t]) if (f.alive) f.actor.staggerT = 0;
      hud('FIGHT!', 1.6);
      return true;
    }
    function clear() { clearOwned(); A.fighters.blue.length = 0; A.fighters.red.length = 0; A.phase = 'place'; A.result = ''; A.score = 0; }
    return {
      title: 'Arena', icon: '⚔',
      enter() { clear(); },
      exit() { clear(); hands() && hands().disarm(); },
      items() {
        const mkArm = (team, icon, label, col) => ({
          id: 'ar:' + team, icon, label, color: col,
          active: () => { const a = hands() && hands().armed; return !!a && a.id === 'ar:' + team; },
          onTap() {
            const H = hands(); if (!H) return;
            if (H.armed && H.armed.id === 'ar:' + team) { H.disarm(); return; }
            H.arm({ id: 'ar:' + team, label, color: team === 'blue' ? 0x6ad0ff : 0xff6a50, radius: 2.4, keep: true, place: (p) => (A.phase === 'place' ? squad(team, p) : false) });
          },
        });
        return [mkArm('blue', '🔷', 'blue army', '#6ad0ff'), mkArm('red', '🔶', 'red army', '#ff7a6b'),
          { id: 'ar:go', icon: '⚔', label: A.phase === 'place' ? 'fight!' : 'again', color: '#ffd877', onTap() { if (A.phase === 'place') fight(); else clear(); } }];
      },
      status: () => ['Arena', A.phase === 'place' ? 'drop two armies, then FIGHT' : A.result || 'battle!', `blue ${alive('blue')}   red ${alive('red')}`],
      score: () => A.score,
      event() {},
      update(dt) {
        A.tick -= dt; if (A.tick > 0) return; A.tick = 0.4;
        if (A.phase !== 'fight') return;
        const b = alive('blue'), r = alive('red');
        if (b && r) return;
        A.phase = 'done';
        A.result = b ? `BLUE wins (${b} left)` : r ? `RED wins (${r} left)` : 'Everyone fell';
        A.score = (b + r) * 10;
        xp(A.score + 10, 'Arena'); saveBest('arena', A.score);
        note(`Arena on the table: ${A.result}. The giant looked on.`, false);
        events.emit('mr:score', { mode: 'arena', score: A.score, result: A.result });
        hud(A.result, 3.5);
      },
      A, fight, squad, clear,
    };
  }

  // =============================================================== Bowling / Marbles
  function bowling() {
    const B = { variant: 'bowling', frame: 1, roll: 1, score: 0, pins: [], balls: [], marbles: [], launched: null, settleT: 0, downBefore: 0, over: false, shots: 0 };
    const g = new Group(); g.name = 'mr-bowl'; g.visible = false; stage.add(g);
    const mats = { pin: keep(new THREE.MeshLambertMaterial({ color: 0xf4efe6 })), band: keep(new THREE.MeshLambertMaterial({ color: 0xd23b3b })), ball: keep(new THREE.MeshLambertMaterial({ color: 0x23306a })), lane: keep(new THREE.MeshLambertMaterial({ color: 0xb98a55 })) };
    const pinGeo = keep(new THREE.CylinderGeometry(0.28, 0.42, 1.6, 10)), headGeo = keep(new THREE.SphereGeometry(0.3, 10, 8)), ballGeo = keep(new THREE.SphereGeometry(0.55, 16, 12)), marbleGeo = keep(new THREE.SphereGeometry(0.33, 12, 10));
    const lane = new Mesh(keep(new THREE.BoxGeometry(5.2, 0.12, 24)), mats.lane); lane.position.set(0, 0.06, 0); lane.userData.noShadow = true; g.add(lane);
    const ring = new Mesh(keep(new THREE.RingGeometry(3.0, 3.2, 40).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }))); ring.position.y = 0.08; g.add(ring);
    const gone = [];
    function body(mesh, o) { const K = kit(); if (!K) return null; mesh.userData.noOutline = true; return K.body(ctx, mesh, o); }
    function mkPin(x, z) {
      const m = new Group(); const a = new Mesh(pinGeo, mats.pin); const h = new Mesh(headGeo, mats.pin); h.position.y = 1.0; const band = new Mesh(keep(new THREE.CylinderGeometry(0.31, 0.31, 0.16, 10)), mats.band); band.position.y = 0.45; m.add(a, h, band);
      m.position.set(x, 0.95, z);
      const b = body(m, { radius: 0.5, mass: 1.2, bounce: 0.25, friction: 0.5, shape: 'cylinder', size: [0.42, 1.7], position: m.position });
      if (b) { b.userData = { x, z }; B.pins.push(b); }
    }
    function mkBall(x, z) {
      const m = new Mesh(ballGeo, mats.ball); m.position.set(x, 0.6, z);
      const b = body(m, { radius: 0.55, mass: 6, bounce: 0.3, friction: 0.35, drag: 0.02, position: m.position });
      if (b) B.balls.push(b);
    }
    function layout() {
      for (const p of B.pins.splice(0)) p.remove();
      for (const p of B.marbles.splice(0)) p.remove();
      if (B.variant === 'bowling') {
        lane.visible = true; ring.visible = false;
        let n = 0;
        for (let r = 0; r < 4; r++) for (let c = 0; c <= r; c++) { mkPin((c - r / 2) * 1.35, -6.8 - r * 1.2); n++; }
        void n;
      } else {
        lane.visible = false; ring.visible = true;
        for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283; const m = new Mesh(marbleGeo, new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(i / 10, 0.7, 0.55) })); dispoMat(m.material); m.position.set(Math.cos(a) * 1.6, 0.4, Math.sin(a) * 1.6 - 1); const b = body(m, { radius: 0.33, mass: 0.6, bounce: 0.5, friction: 0.2, drag: 0.03, position: m.position }); if (b) B.marbles.push(b); }
      }
      B.downBefore = 0; B.settleT = 0; B.launched = null;
    }
    const dispoMat = (m) => keep(m);
    function rack() {
      while (B.balls.length < (B.variant === 'bowling' ? 3 : 1)) { const i = B.balls.length; mkBall(B.variant === 'bowling' ? (i - 1) * 2.2 : 0, B.variant === 'bowling' ? 8.6 : 5.6); }
    }
    const _up = new Vector3();
    const isDown = (b) => { _up.set(0, 1, 0).applyQuaternion(b.mesh.quaternion); return _up.y < 0.72 || b.position.y < 0.3 || Math.hypot(b.position.x, b.position.z) > env.radius + 0.3; };
    const outRing = (b) => Math.hypot(b.position.x, b.position.z + 1) > 3.2;
    function countDown() { return B.variant === 'bowling' ? B.pins.filter(isDown).length : B.marbles.filter(outRing).length; }
    function startOver() { B.frame = 1; B.roll = 1; B.score = 0; B.over = false; B.shots = 0; for (const b of B.balls.splice(0)) b.remove(); layout(); rack(); }
    function finishRoll() {
      const down = countDown(), got = down - B.downBefore;
      B.score += got; B.downBefore = down; B.shots++;
      const ball = B.launched; B.launched = null;
      if (ball) { const i = B.balls.indexOf(ball); if (i >= 0) B.balls.splice(i, 1); gone.push({ b: ball, t: 1.5 }); }
      if (got > 0) { st() && st().ripple({ x: 0, z: B.variant === 'bowling' ? -7 : -1 }, 5, 0xffe9a0, 0.8); }
      const strike = B.variant === 'bowling' && down >= 10;
      if (strike && B.roll === 1) { B.score += 5; hud('STRIKE!', 1.6); }
      if (B.variant === 'bowling') {
        if (strike || B.roll === 2) { B.frame++; B.roll = 1; if (B.frame > 5) return endGame(); for (const p of B.pins.splice(0)) gone.push({ b: p, t: 0.6 }); setTimeout_(() => layoutOnly(), 800); }
        else B.roll = 2;
      } else if (B.shots >= 6 || down >= 10) return endGame();
      rack();
    }
    let pend = [];
    const setTimeout_ = (fn, ms) => pend.push({ t: ms / 1000, fn });
    function layoutOnly() { if (B.over) return; layout(); }
    function endGame() {
      B.over = true; const isNew = saveBest(B.variant, B.score);
      xp(B.score * 3 + 10, "Giant's " + B.variant); note(`Giant's ${B.variant} on the table: ${B.score} points${isNew ? ', a new best' : ''}.`, isNew);
      hud(`Game over: ${B.score} points`, 3.5); events.emit('mr:score', { mode: 'bowling', variant: B.variant, score: B.score });
    }
    return {
      title: "Giant's Bowling", icon: '🎳',
      enter() { g.visible = true; st() && st().showTrees(false); startOver(); },
      exit() { stage.remove(g); st() && st().showTrees(true); for (const b of [...B.pins, ...B.balls, ...B.marbles]) b.remove(); for (const x of gone.splice(0)) x.b.remove(); B.pins.length = B.balls.length = B.marbles.length = 0; pend = []; },
      items: () => [
        { id: 'bw:var', icon: B.variant === 'bowling' ? '🎳' : '🔮', label: B.variant === 'bowling' ? 'bowling' : 'marbles', color: '#ffd877', onTap() { B.variant = B.variant === 'bowling' ? 'marbles' : 'bowling'; startOver(); } },
        { id: 'bw:again', icon: '↻', label: 'restart', color: '#a8c4ff', onTap() { startOver(); } },
      ],
      status: () => ["Giant's " + (B.variant === 'bowling' ? 'Bowling' : 'Marbles'), B.over ? `FINAL ${B.score}  best ${best(B.variant)}` : B.variant === 'bowling' ? `frame ${Math.min(B.frame, 5)}/5  roll ${B.roll}` : `shot ${B.shots + 1}/6`, `score ${B.score}`, 'grab a ball, fling it'],
      score: () => B.score,
      event() {},
      update(dt) {
        for (let i = pend.length - 1; i >= 0; i--) { pend[i].t -= dt; if (pend[i].t <= 0) { const f = pend.splice(i, 1)[0]; f.fn(); } }
        for (let i = gone.length - 1; i >= 0; i--) { gone[i].t -= dt; if (gone[i].t <= 0) { gone.splice(i, 1)[0].b.remove(); } }
        if (B.over) return;
        if (!B.launched) {
          for (const b of B.balls) if (!b.held && b.velocity.length() > 2.5 && !b.launchedAt) { b.launchedAt = true; B.launched = b; B.settleT = 0; break; }
        } else {
          const b = B.launched;
          if (b.removed) { B.launched = null; return; }
          B.settleT += dt;
          const slow = b.velocity.length() < 0.5 && b.position.y < 1.2;
          const far = Math.hypot(b.position.x, b.position.z) > env.radius + 0.5;
          if ((slow && B.settleT > 2.2) || far || B.settleT > 7) {
            const pinsMoving = B.pins.some((p) => p.velocity.length() > 0.6) || B.marbles.some((p) => p.velocity.length() > 0.5);
            if (!pinsMoving || B.settleT > 9) finishRoll();
          }
        }
      },
      B, finishRoll, startOver, layout,
    };
  }

  // =============================================================== registry
  const makers = { 'gods-table': godsTable, 'tower-defence': towerDefence, arena, bowling };
  const ORDER = ['gods-table', 'tower-defence', 'arena', 'bowling'];
  let cur = null, curId = null;
  const api = {
    list: () => ORDER.map((id) => ({ id, title: (cur && curId === id ? cur : { title: id }).title, current: id === curId })),
    get current() { return cur; },
    get id() { return curId; },
    titles: { 'gods-table': "God's Table", 'tower-defence': 'Tower Defence', arena: 'Arena', bowling: "Giant's Bowling" },
    icons: { 'gods-table': '🌍', 'tower-defence': '🏰', arena: '⚔', bowling: '🎳' },
    set(name, quiet) {
      if (name === 'bowling-marbles') name = 'bowling';
      if (!makers[name]) return false;
      if (cur) { try { cur.exit(); } catch (e) { console.error('[mr] mode exit', e); } cur = null; clearOwned(); }
      curId = name; S.mode = name;
      cur = makers[name]();
      try { cur.enter(); } catch (e) { console.error('[mr] mode enter', e); }
      env.parts.palette && env.parts.palette.dirty && env.parts.palette.dirty();
      if (!quiet) hud(cur.title, 1.6);
      return true;
    },
    next() { return api.set(ORDER[(ORDER.indexOf(curId) + 1) % ORDER.length]); },
    restart() { return api.set(curId, true); },
    items: () => (cur ? cur.items() : []),
    status: () => (cur ? cur.status() : []),
    score: () => (cur ? cur.score() : 0),
    event(n, d) { cur && cur.event && cur.event(n, d); },
    enter() { if (!cur) api.set(S.mode || 'gods-table', true); },
    exit() { if (cur) { try { cur.exit(); } catch (e) { /* ignore */ } cur = null; curId = null; } clearOwned(); },
    update(dt, t) {
      if (!cur || !env.active) return;
      cur.update(dt, t);
      api.statusT = (api.statusT ?? 0) - dt;
      if (api.statusT <= 0) { api.statusT = 0.25; st() && st().setBoard(cur.status()); }
    },
    dispose() { api.exit(); for (const o of dispo) { try { o.dispose && o.dispose(); } catch (e) { /* ignore */ } } },
  };
  return api;
}
