// core/combat.js — world.combat: give kit actors (humanoid/creature) a FIGHTING BRAIN. READ kit.js FIRST (actors, damage, factions).
//
// USE      const combat = ctx.world.combat; if (!combat) return {};        // always guard (it may be reloading)
//   const npc = kit.humanoid(ctx, { x, z, shirt: 0x802020 });
//   const f = combat.fighter(ctx, npc, { faction: 'enemy', hp: 30, attack: 'melee' });
//   Factions: 'enemy' fights the player and friendlies; 'friendly' (the player's side) fights enemies; 'neutral' fights
//   nobody unless attacked (then it fights back against whoever hit it for ~25 s). The player is 'friendly'.
//   The brain does everything: notices targets, chases, telegraphs (wind-up) and attacks, returns home, dies. Do NOT also
//   drive the actor with walkTo/follow/lookAt yourself (say()/wave()/equip() are fine). Pass your creation's ctx; the fighter
//   is despawned with it. Everything is cheap (staggered AI, pooled projectiles); 30 fighters at once is fine.
//
// FIGHTER   const f = combat.fighter(ctx, actor, opts)  -> fighter | null
//   opts (all optional):
//     faction   'enemy' (default) | 'friendly' | 'neutral'
//     hp        starting/max hit points (default: the actor's, 20 humanoid / 12 creature)
//     attack    'melee' (default) | 'ranged' | 'none' (never attacks: a pet / civilian that just follows or wanders)
//     damage    per hit (default 6 melee, 5 ranged). The player has 100 hp: keep enemy damage 3–10 so fights stay fun.
//     range     melee reach in m (default 1.5, creatures 1.2)  /  ranged shooting distance (default 14)
//     cooldown  seconds between attacks (default 1.8 melee, 2.4 ranged)
//     windup    seconds of visible wind-up before the blow lands (default 0.55 melee, 0.6 ranged). The player can dodge it.
//     aggroRange  notice distance (default 16; ranged: range + 4)       speed  chase speed m/s (default 2.4 enemy, 3.0 friendly)
//     leash     max distance from home (the player, for followers) before it gives up and returns (default 40, followers 28)
//     follow    'player' | null. Friendlies default to 'player': they trail the player and defend them. Set null to hold ground.
//     wander    idle patrol radius around home (default 3; 0 = stand still)
//     projectile  { color, speed = 10, radius = 0.16, gravity = 0, splash = 0.3, damage, kind = 'pierce' }  for attack:'ranged'
//     damageKind  what its melee blows count as: 'slash' (creatures, armed people; default) | 'blunt' (bare fists) | 'pierce' | 'fire' ...
//                 (kit damage kinds; decides whether the victim loses a limb or how it dies, see "gore" in core/kit.js)
//     name      label for you; onDeath(f) callback; drops: see below
//     drops     on death: 'sword' (a weapon type) | { type, chance = 1 } | [ ... ] | function(f, position). Needs world.weapons.
//   Returns f = { actor, faction, hp, maxHp, alive, target, name, state, reserve, setFaction(f), setTarget(t), heal(n), activate(), release(), remove() }
//     (or null: the actor is dead / removed, or too many reserves are waiting)
//     faction (get/set), hp/maxHp/alive (live), target = what it is fighting now (a fighter, the player or a damageable) | null
//     setTarget(t): fighter | damageable | 'player' | null; a forced target is kept until it dies (null clears)
//     remove() despawns brain AND actor (no death event); release() only detaches the brain and leaves the actor standing.
//   A small health bar floats above anything hurt. Hits that kill a fighter emit 'combat:kill' { victim: f, by, style } where
//   by = the killing fighter, 'player' or a faction name (or null); style = how kit made it die ('burst', 'decapitate', 'char' ...).
//   LOST LIMBS  kit actors can be dismembered (kit.js). Combat reads actor.armsLeft / armsTotal / hasHead and reacts to the event
//   'limb:severed' { actor, limb, kind, by }: a one-armed fighter hits for 55%, an armless melee fighter headbutts (35% damage, 65% reach)
//   or flees (coin flip), an armless ranged fighter flees; a lost swing/shot is cancelled. Lost legs just slow it (actor.legMul).
//   f.fleeing (bool) tells you which. Custom actors without armsTotal are unaffected.
//   MODEL ACTORS  kit actors built from world.models (kit.humanoid({ model })) work exactly like primitive ones. Ranged fighters shoot from actor.muzzleAt(outVec3) when it exists
//   (return true after writing the world position: model bodies use the hand bone, dragons the Mouth bone); attack clips are timed so the blow lands when the wind-up ends.
//
// QUERIES   combat.fighters                the live list of ACTIVE fighters (alive only; do not mutate); combat.reserves = the dormant ones (below)
//   combat.nearest(point, { faction, hostileTo, maxDist = 30 }) -> fighter | null     (hostileTo:'enemy' = fighters enemies fight)
//   combat.count(faction?) -> number of living fighters (reserves included)       combat.clear(faction?) despawn all (or one faction's) fighters
//   combat.maxAttackers (2) how many melee fighters may swing at the same target at once (others circle and wait). Follows ctx.quality.density
//     (2 at full detail, 1 at half or less) until a creation assigns its own number (assign null to go back to following density).
//
// PROJECTILES (the same pool fighters use; handy for turrets/traps)
//   combat.fire({ origin: vec3, direction: vec3, speed = 10, damage = 5, from = 'enemy', by, color, radius = 0.16, splash = 0.3,
//                 gravity = 0, life = 3.5 })      flies, leaves a glowing trail, hurts hostile things via kit.hit(..., { from })
//   combat.projectiles                       pool array; entries with .on === true are in flight { x,y,z, vx,vy,vz, from, kill() }
//   Event 'combat:attack' { attacker, target, point, damage, kind:'melee'|'projectile', blocked } fires just BEFORE damage is
//   applied; a handler may set e.blocked = true (shield) or lower e.damage.
//
// PLAYER   (core/player.js) world.player.health / maxHealth / alive / damage(n, { from, point }) / heal(n) / invulnerable / respawn().
//   Events: 'player:hurt' { amount, health }, 'player:died', 'player:respawn', 'combat:kill'. Enemies hurt the player through
//   kit.hit(..., { from:'enemy' }); player spells must pass { from:'player' } so they hurt enemies but never you or allies.
//

export const meta = { name: 'Combat', description: 'Factions, fighter brains, ranged projectiles, health bars.' };

export default function (ctx) {
  const THREE = ctx.THREE;
  const { Vector3, Color, Matrix4, Quaternion } = THREE;
  const S = ctx.state;
  const fighters = (S.fighters ??= []);
  const reserves = (S.reserves ??= []); // dormant fighters waiting for room under the perf budget
  const projs = (S.projs ??= []);
  S.seq ??= 0;
  const MAXP = 48, MAXBARS = 32, MAXRES = 64;
  const IDLE = 0, WIND = 1, RECOVER = 2;
  const Q = ctx.quality || {};
  const thinkK = () => { const k = Q.fighterThink; return k > 1 ? (k > 8 ? 8 : k) : 1; }; // think interval multiplier (perf: 1 at level 0)
  S.densBase ??= Math.max(Q.density > 0 ? Q.density : 1, Q.pc ? 2.5 : 1);
  function densK() { // 1 at the tier's base density, lower under load (same calibration as core/kit.js)
    const d = Q.density;
    if (!(d > 0)) return 1;
    if (d > S.densBase) S.densBase = d;
    const k = d / S.densBase;
    return k >= 0.999 ? 1 : k < 0.12 ? 0.12 : k;
  }
  const isCulled = (A) => { const g = A.group; return !!g && (g.userData.perfCulled === true || g.visible === false); };

  // ------------------------------------------------------------------ small utilities
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dropFrom = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); } };
  const fOf = (f) => (f === 'player' || f === 'friendly' ? 'friendly' : f === 'enemy' ? 'enemy' : 'neutral');
  const hostile = (a, b) => { a = fOf(a); b = fOf(b); return (a === 'enemy' && b === 'friendly') || (a === 'friendly' && b === 'enemy'); };
  const kit = () => ctx.world.kit;
  const playerD = () => ctx.world.player?.damageable ?? null;
  const playerUp = () => { const P = ctx.world.player; return !P || P.alive !== false; };
  const _v = new Vector3(), _w = new Vector3(), _right = new Vector3(), _toCam = new Vector3(), _fwd = new Vector3(0, 0, 1);
  const _muz = new Vector3();
  const _q = new Quaternion(), _cq = new Quaternion(), _m = new Matrix4(), _s = new Vector3(), _col = new Color();
  const OPT = { hostileTo: undefined, faction: undefined }; // scratch options for kit.nearestTarget (read synchronously)
  const HITO = { from: 'enemy', by: undefined, kind: 'slash', direction: undefined }, _dirv = new Vector3(); // scratch options for kit.hit

  // ---- what is left of a fighter's body. Kit actors track armsLeft / armsTotal / hasHead (see "gore" in core/kit.js) and announce each
  // lost limb with the event 'limb:severed' { actor, limb, kind, by }. One-armed fighters hit weaker, armless melee fighters headbutt
  // (short reach, weak) or flee, armless ranged fighters flee; losing legs only slows them (kit does that: actor.legMul).
  const armless = (f) => f.actor.armsTotal > 0 && (f.actor.armsLeft ?? f.actor.armsTotal) <= 0;
  function limbMul(f) {
    const A = f.actor;
    if (!(A.armsTotal > 0)) return 1;
    const left = A.armsLeft ?? A.armsTotal;
    return left >= A.armsTotal ? 1 : left > 0 ? 0.55 : 0.35;
  }
  const reachOf = (f) => f.range * (armless(f) ? 0.65 : 1);
  function canStrike(f) {
    const A = f.actor;
    if (!armless(f)) return true;
    return f.attack === 'melee' && A.hasHead !== false && !f.fleeing; // a headbutt
  }
  ctx.on('limb:severed', (e) => {
    const a = e && e.actor, f = a && a.damage && a.damage.fighter;
    if (!f || f.removed || f.dead) return;
    cancelAttack(f); // the swing / shot dies with the limb
    if (armless(f)) f.fleeing = f.attack === 'ranged' || Math.random() < 0.5; // no arms: run, or go for a headbutt
  });
  const FACTION_COLOR = { enemy: 0xff5a30, friendly: 0x6ad0ff, neutral: 0xffd070 };

  function cdist(p, d) { d.center(_v); return Math.hypot(_v.x - p.x, _v.y - p.y, _v.z - p.z); }

  // ------------------------------------------------------------------ visuals: projectiles (2 instanced meshes), health bars (2)
  const own = [];
  const mkMesh = (geo, mat, n) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, _col.set(0xffffff)); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false;
    ctx.root.add(m); own.push(geo, mat);
    return m;
  };
  const coreMesh = mkMesh(new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), MAXP);
  coreMesh.renderOrder = 7;
  // tail: cone whose wide base sits at the projectile and whose tip trails behind along -Z (unit length)
  const tailMesh = mkMesh(new THREE.ConeGeometry(1, 1, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }), MAXP);
  tailMesh.renderOrder = 6;
  const barBg = mkMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x0b0d14, transparent: true, opacity: 0.7, depthWrite: false, fog: false }), MAXBARS);
  const barFill = mkMesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false, toneMapped: false, fog: false }), MAXBARS);
  barBg.renderOrder = 30; barFill.renderOrder = 31;
  // bolts and arrows that hit scenery stay stuck in it for a few seconds (up to 24)
  const MAXSTUCK = 24, stuck = (S.stuck ??= []);
  const stuckMesh = mkMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), MAXSTUCK);
  let stuckDirty = true;
  ctx.onDispose(() => { for (const o of own) o.dispose?.(); });

  // impact sparks: one cheap particle emitter per colour (max 4), created lazily
  const sparkSets = new Map();
  function spark(color, p, n = 10) {
    const K = kit(); if (!K?.particles) return;
    let e = sparkSets.get(color);
    if (!e) {
      if (sparkSets.size >= 4) e = sparkSets.values().next().value;
      else {
        const hot = new Color(color).lerp(new Color(1, 1, 1), 0.55);
        e = K.particles(ctx, { count: 90, color: [hot, color], size: [0.14, 0.03], life: [0.2, 0.45], speed: [1.5, 4.5], gravity: 6, drag: 1.5 });
        sparkSets.set(color, e);
      }
    }
    e.emit(p, n);
  }
  let snd = null;
  const sfxT = {};
  function sfx(kind, p) {
    if (ctx.world.audio?.enabled !== false && ctx.world.audio?.replaces?.has('combat:' + kind)) return; // pack covers it
    const K = kit(); if (!K?.sound) return;
    const now = ctx.clock.t;
    if (sfxT[kind] > now - 0.07) return;
    sfxT[kind] = now;
    snd ??= K.sound(ctx, { volume: 0.8 });
    switch (kind) {
      case 'windup': snd.tone({ freq: 150, freqEnd: 230, dur: 0.22, type: 'triangle', vol: 0.09, at: p }); break;
      case 'swing': snd.noise({ dur: 0.16, filter: { type: 'bandpass', freq: 1200, freqEnd: 300, q: 1.2 }, vol: 0.16, at: p }); break;
      case 'hit': snd.tone({ freq: 160, freqEnd: 60, dur: 0.14, type: 'square', vol: 0.12, at: p }); snd.noise({ dur: 0.08, filter: { type: 'lowpass', freq: 900 }, vol: 0.18, at: p }); break;
      case 'shot': snd.tone({ freq: 820, freqEnd: 280, dur: 0.14, type: 'sawtooth', vol: 0.07, at: p }); break;
      case 'impact': snd.noise({ dur: 0.12, filter: { type: 'bandpass', freq: 1800, freqEnd: 600 }, vol: 0.12, at: p }); break;
      case 'death': snd.tone({ freq: 220, freqEnd: 45, dur: 0.45, type: 'sawtooth', vol: 0.12, at: p }); break;
    }
  }

  // ------------------------------------------------------------------ projectiles
  function newProj() {
    return {
      on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, speed: 1, life: 0, r: 0.16, dmg: 5, splash: 0.3, g: 0, from: 'enemy', by: null, kind: 'pierce',
      color: new Color(), colorHex: 0xffffff, q: { hostileTo: 'enemy', faction: undefined },
      kill() { this.on = false; },
    };
  }
  if (projs.length === 0) for (let i = 0; i < MAXP; i++) projs.push(newProj());

  function fire(o) {
    const org = o.origin, dir = o.direction;
    if (!org || !dir) return null;
    let p = null;
    for (let i = 0; i < MAXP; i++) if (!projs[(S.pcur + i) % MAXP]?.on) { p = projs[(S.pcur + i) % MAXP]; break; }
    S.pcur = ((S.pcur ?? 0) + 1) % MAXP;
    if (!p) p = projs[S.pcur];
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1, sp = o.speed ?? 10;
    p.on = true; p.x = org.x; p.y = org.y; p.z = org.z;
    p.vx = (dir.x / len) * sp; p.vy = (dir.y / len) * sp; p.vz = (dir.z / len) * sp; p.speed = sp;
    p.life = o.life ?? 3.5; p.r = o.radius ?? 0.16; p.dmg = o.damage ?? 5; p.splash = o.splash ?? 0.3; p.g = o.gravity ?? 0;
    p.from = o.from ?? 'enemy'; p.by = o.by ?? null; p.kind = o.kind ?? 'pierce';
    p.colorHex = new Color(o.color ?? FACTION_COLOR[fOf(p.from)]).getHex();
    p.color.set(p.colorHex);
    // who it can hit: neutral shooters (provoked) hit whoever provoked them
    const ff = fOf(p.from);
    if (ff === 'neutral') { p.q.hostileTo = undefined; p.q.faction = p.by?.provokedBy ?? 'friendly'; }
    else { p.q.hostileTo = ff; p.q.faction = undefined; }
    return p;
  }
  S.pcur ??= 0;

  function addStuck(p, hx, hy, hz) {
    if (stuck.length >= MAXSTUCK) stuck.shift();
    const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
    stuck.push({ x: hx, y: hy, z: hz, dx: p.vx / sp, dy: p.vy / sp, dz: p.vz / sp, age: 0, color: p.colorHex, len: 0.4 + p.r * 2 });
    stuckDirty = true;
  }
  function stepStuck(dt) {
    for (let i = stuck.length - 1; i >= 0; i--) { const s = stuck[i]; s.age += dt; if (s.age > 7) { stuck.splice(i, 1); stuckDirty = true; } }
    if (!stuckDirty) return;
    stuckDirty = false;
    for (let i = 0; i < stuck.length; i++) {
      const s = stuck[i];
      _fwd.set(s.dx, s.dy, s.dz);
      _q.setFromUnitVectors(_toCam.set(0, 0, 1), _fwd);
      _v.set(s.x - s.dx * s.len * 0.35, s.y - s.dy * s.len * 0.35, s.z - s.dz * s.len * 0.35);
      _s.set(0.035, 0.035, s.len);
      stuckMesh.setMatrixAt(i, _m.compose(_v, _q, _s)); stuckMesh.setColorAt(i, _col.set(s.color));
    }
    stuckMesh.count = stuck.length;
    if (stuck.length) { stuckMesh.instanceMatrix.needsUpdate = true; stuckMesh.instanceColor.needsUpdate = true; }
  }

  function impact(p, tgt, K) {
    _v.set(p.x, p.y, p.z);
    if (tgt) {
      const e = { attacker: p.by, target: tgt, point: _v.clone(), damage: p.dmg, kind: 'projectile', projectile: p, blocked: false };
      ctx.events.emit('combat:attack', e);
      if (!e.blocked && e.damage > 0) {
        HITO.from = p.from; HITO.by = p.by ?? undefined; HITO.kind = p.kind; HITO.direction = _dirv.set(p.vx, p.vy, p.vz);
        K.hit(_v, p.splash, e.damage, HITO);
      }
      if (e.blocked) { spark(0xffffff, _v, 8); sfx('impact', _v); p.on = false; return; }
    }
    spark(p.colorHex, _v, tgt ? 12 : 7);
    sfx('impact', _v);
    p.on = false;
  }

  const _o = new Vector3(), _d = new Vector3();
  function stepProjectiles(dt, K) {
    let n = 0;
    const Py = ctx.world.physics && ctx.world.physics.ready ? ctx.world.physics : null;
    for (let i = 0; i < MAXP; i++) {
      const p = projs[i];
      if (!p.on) continue;
      p.life -= dt;
      if (p.life <= 0) { p.on = false; continue; }
      const steps = Math.min(4, Math.max(1, Math.ceil((p.speed * dt) / 0.3))), h = dt / steps;
      for (let s = 0; s < steps && p.on; s++) {
        p.vy -= p.g * h;
        const ox = p.x, oy = p.y, oz = p.z;
        p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;
        if (Py) { // walls, props and the terrain collider (core/physics.js): the bolt stops where its path crosses them
          const sx = p.x - ox, sy = p.y - oy, sz = p.z - oz, sl = Math.hypot(sx, sy, sz);
          if (sl > 1e-5) {
            const hit = Py.raycast(_o.set(ox, oy, oz), _d.set(sx, sy, sz), sl, { groups: 'world' });
            if (hit) { p.x = hit.point.x; p.y = hit.point.y; p.z = hit.point.z; if (p.kind === 'pierce') addStuck(p, p.x, p.y, p.z); impact(p, null, K); break; }
          }
        }
        if (p.y < ctx.groundAt(p.x, p.z) + 0.05) { if (p.kind === 'pierce') addStuck(p, p.x, ctx.groundAt(p.x, p.z), p.z); impact(p, null, K); break; }
        _w.set(p.x, p.y, p.z);
        const t = K.nearestTarget(_w, p.r, p.q);
        if (t) { impact(p, t, K); break; }
      }
      if (!p.on) continue;
      const sp = Math.hypot(p.vx, p.vy, p.vz) || 1;
      _v.set(p.x, p.y, p.z);
      _s.set(p.r, p.r, p.r);
      coreMesh.setMatrixAt(n, _m.compose(_v, _q.identity(), _s));
      coreMesh.setColorAt(n, p.color);
      _fwd.set(p.vx / sp, p.vy / sp, p.vz / sp);
      _q.setFromUnitVectors(_toCam.set(0, 0, 1), _fwd);
      const tl = clamp(sp * 0.07, 0.3, 1.4);
      _s.set(p.r * 1.25, p.r * 1.25, tl);
      tailMesh.setMatrixAt(n, _m.compose(_v, _q, _s));
      tailMesh.setColorAt(n, p.color);
      n++;
    }
    coreMesh.count = tailMesh.count = n;
    if (n) {
      coreMesh.instanceMatrix.needsUpdate = tailMesh.instanceMatrix.needsUpdate = true;
      coreMesh.instanceColor.needsUpdate = tailMesh.instanceColor.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ health bars
  // Bars are billboards: they are rebuilt and uploaded only when something a bar shows changed (a position, a health fraction, a label lift, which bars
  // exist) or the head turned more than ~1 degree since the orientation they hold (the head is never perfectly still in VR, so a tolerance is needed:
  // a bar facing half a degree off is not distinguishable). Standing hurt fighters in a still view cost nothing per frame.
  const barSel = new Array(MAXBARS), barSig = new Float32Array(MAXBARS * 5), _hq = new Quaternion();
  let barN = -1, haveBarQ = false;
  function stepBars() {
    ctx.camera.getWorldQuaternion(_cq);
    let dirty = false;
    if (!haveBarQ || Math.abs(_cq.x * _hq.x + _cq.y * _hq.y + _cq.z * _hq.z + _cq.w * _hq.w) < 0.99996) { _hq.copy(_cq); haveBarQ = true; dirty = true; }
    const head = ctx.player.head;
    let n = 0;
    for (let i = 0; i < fighters.length && n < MAXBARS; i++) {
      const f = fighters[i], A = f.actor, d = f.damage;
      if (!d.alive || d.hp >= d.maxHp) continue;
      const p = A.position;
      if (Math.abs(p.x - head.x) + Math.abs(p.z - head.z) > 45 || isCulled(A)) continue; // (a hidden actor must not leave a floating bar)
      const frac = clamp(d.hp / d.maxHp, 0, 1), lift = A.label && A.label.sprite && A.label.sprite.visible ? 0.3 : 0, k = n * 5;
      if (Math.abs(barSig[k] - p.x) > 1e-3 || Math.abs(barSig[k + 1] - p.y) > 1e-3 || Math.abs(barSig[k + 2] - p.z) > 1e-3 || Math.abs(barSig[k + 3] - frac) > 1e-5 || Math.abs(barSig[k + 4] - lift) > 1e-5 || barSel[n] !== f) {
        barSig[k] = p.x; barSig[k + 1] = p.y; barSig[k + 2] = p.z; barSig[k + 3] = frac; barSig[k + 4] = lift; barSel[n] = f; dirty = true;
      }
      n++;
    }
    if (n !== barN) { barN = n; dirty = true; }
    if (!dirty) return; // nothing moved: the instance buffers on the GPU are still right
    _right.set(1, 0, 0).applyQuaternion(_hq);
    _toCam.set(0, 0, 1).applyQuaternion(_hq);
    for (let b = 0; b < n; b++) {
      const f = barSel[b], A = f.actor, d = f.damage, p = A.position, k = b * 5;
      const frac = barSig[k + 3], w = clamp((A.height ?? 1.7) * 0.38, 0.4, 1.1);
      _v.set(p.x, p.y + (A.height ?? 1.7) + 0.12 + barSig[k + 4], p.z);
      _s.set(w + 0.04, 0.1, 1);
      barBg.setMatrixAt(b, _m.compose(_v, _hq, _s));
      const fw = Math.max(0.001, w * frac);
      _v.addScaledVector(_right, -(w - fw) / 2).addScaledVector(_toCam, 0.012);
      _s.set(fw, 0.065, 1);
      barFill.setMatrixAt(b, _m.compose(_v, _hq, _s));
      barFill.setColorAt(b, _col.setHSL(0.33 * frac, 0.85, 0.5));
    }
    barBg.count = barFill.count = n;
    if (n) { barBg.instanceMatrix.needsUpdate = barFill.instanceMatrix.needsUpdate = true; barFill.instanceColor.needsUpdate = true; }
  }

  // ------------------------------------------------------------------ brain
  function cancelAttack(f) {
    f.state = IDLE;
    const A = f.actor;
    if (A.atkT >= 0) { A.atkT = -1; A.atkRaise = A.atkSwing = 0; }
  }

  function targetOf(t) { // anything accepted by setTarget -> damageable | null
    if (!t) return null;
    if (t === 'player') return playerD();
    if (t.damage && t.actor) return t.damage; // fighter
    if (t === ctx.world.player) return playerD();
    if (typeof t.center === 'function' && 'alive' in t) return t;
    return null;
  }
  function pubTarget(f) {
    const t = f.tgt;
    if (!t) return null;
    if (t.fighter) return t.fighter;
    if (t.isPlayer) return ctx.world.player ?? t;
    return t;
  }

  function provoke(f, ff, by) {
    f.provokedBy = ff; f.provokeT = 25;
    let t = by && by.damage && by.damage.alive ? by.damage : null;
    if (!t && ff === 'friendly') t = playerD();
    if (t) { f.tgt = t; f.forced = false; f.atkCd = Math.max(f.atkCd, 0.4); }
  }

  // a dormant reserve joins the fight: now (hit, given a target, activate()) or when the perf budget has room (see update)
  function activate(f) {
    if (!f.reserve || f.removed || f.dead) return false;
    const i = reserves.indexOf(f); if (i >= 0) reserves.splice(i, 1);
    f.reserve = false;
    fighters.push(f);
    const A = f.actor;
    f.homeX = A.position.x; f.homeZ = A.position.z; f.thinkT = rand(0, 0.3); f.atkCd = 0.6 + Math.random() * 0.8;
    try {
      const rw = f.resumeWander; f.resumeWander = null;
      if (rw && A.wander) A.wander(rw.r, { x: rw.x, z: rw.z });
      else if (!f.follow && f.wanderOpt !== 0 && A.wander && !A.wanderOn) A.wander(f.wanderOpt ?? 3, { x: f.homeX, z: f.homeZ });
    } catch (err) { /* actor gone */ }
    return true;
  }

  function onHit(f, e) {
    if (f.removed) return;
    if (f.reserve) activate(f); // somebody is hitting it: it fights back whatever the budget says
    f.lastFrom = e.from ?? f.lastFrom;
    if (e.by) f.lastBy = e.by;
    if (e.amount > 0 && f.state === WIND && f.windT > 0.12) { cancelAttack(f); f.atkCd = Math.max(f.atkCd, 0.9); } // a solid hit staggers the wind-up
    const ff = e.from ? fOf(e.from) : null;
    if (!ff || ff === f.faction) return;
    if (f.faction === 'neutral') provoke(f, ff, e.by);
    else if (!f.tgt && hostile(f.faction, ff)) {
      const t = (e.by && e.by.damage && e.by.damage.alive ? e.by.damage : null) ?? (e.from === 'player' || ff === 'friendly' ? playerD() : null);
      if (t) f.tgt = t;
    }
  }

  function dropLoot(f) {
    const dr = f.drops;
    if (!dr) return;
    const p = f.actor.position;
    try {
      if (typeof dr === 'function') { dr(f, p); return; }
      const W = ctx.world.weapons;
      if (!W || !W.create) return;
      for (const item of Array.isArray(dr) ? dr : [dr]) {
        const spec = typeof item === 'string' ? { type: item } : item;
        if (!spec || Math.random() > (spec.chance ?? 1)) continue;
        W.create(f.ctx ?? ctx, spec.type ?? spec.weapon, { position: new Vector3(p.x + rand(-0.3, 0.3), p.y + 0.6, p.z + rand(-0.3, 0.3)) });
      }
    } catch (err) { console.error('[combat] drops failed', err); }
  }

  function onDeath(f) {
    if (f.dead || f.removed) return;
    f.dead = true; f.state = IDLE; // step() drops it from the live list on its next visit
    const by = f.lastBy ?? f.lastFrom ?? null;
    const p = f.actor.position;
    _v.set(p.x, p.y + 0.8, p.z);
    const style = f.actor.deathStyle || null; // 'bisect' | 'decapitate' | 'burst' | 'launch' | 'char' | 'shatter' | 'disintegrate' | 'fall'
    if (!style || style === 'fall') spark(FACTION_COLOR[f.faction] ?? 0xffffff, _v, 14); // gory deaths carry their own effects
    sfx('death', _v);
    ctx.events.emit('combat:kill', { victim: f, by: by === 'friendly' ? 'player' : by, style });
    if (f.onDeath) { try { f.onDeath(f); } catch (err) { console.error('[combat] onDeath failed', err); } }
    dropLoot(f);
  }

  function release(f) {
    if (f.removed) return;
    f.removed = true; dropFrom(fighters, f);
    const ri = reserves.indexOf(f); if (ri >= 0) reserves.splice(ri, 1); // (ordered: reserves join the fight oldest first)
    if (f.damage && f.damage.fighter === f) f.damage.fighter = null;
    try { f.actor.stop?.(); f.actor.lookAt?.(null); } catch (err) { /* actor gone */ }
  }
  function remove(f) {
    if (f.removed) return;
    release(f);
    try { f.actor.remove?.(); } catch (err) { /* already removed */ }
  }

  function setTarget(f, t) {
    const d = targetOf(t);
    f.tgt = d && d.alive ? d : null;
    f.forced = !!f.tgt;
    if (f.tgt && f.reserve) activate(f);
    if (f.tgt) f.atkCd = Math.max(f.atkCd, 0.3);
    else cancelAttack(f);
  }
  function setFaction(f, v) {
    f.damage.faction = v; f.actor._faction = v;
    f.tgt = null; f.forced = false; f.provokedBy = null; f.provokeT = 0;
    cancelAttack(f);
  }

  function retarget(f, K) {
    const A = f.actor, p = A.position;
    let best = null;
    if (f.provokedBy && f.faction === 'neutral') {
      OPT.hostileTo = undefined; OPT.faction = f.provokedBy;
      best = K.nearestTarget(p, f.aggro * 1.5, OPT);
    } else if (f.faction !== 'neutral') {
      OPT.hostileTo = f.faction; OPT.faction = undefined;
      best = K.nearestTarget(p, f.aggro, OPT);
      if (f.follow === 'player') { // defend the player: whatever is threatening them comes first
        const t2 = K.nearestTarget(ctx.player.head, 14, OPT);
        if (t2) best = t2;
      }
    }
    const cur = f.tgt;
    if (cur && cur.alive && !cur.removed) {
      if (f.forced) return;
      const dc = cdist(p, cur);
      if (!best) { if (dc > f.aggro * 1.8) f.tgt = null; return; }
      if (best !== cur && cdist(p, best) * 1.35 + 1.5 < dc) f.tgt = best;
      return;
    }
    f.forced = false;
    f.tgt = best;
    if (best) f.atkCd = Math.max(f.atkCd, 0.5 + Math.random() * 0.5); // a beat to react before the first blow
  }

  function think(f, K, culled) {
    const A = f.actor, p = A.position, dt = f.sinceThink;
    f.sinceThink = 0;
    if (f.provokeT > 0) { f.provokeT -= dt; if (f.provokeT <= 0) f.provokedBy = null; }
    if (f.tgt && (!f.tgt.alive || f.tgt.removed)) { f.tgt = null; f.forced = false; }
    if (f.attack !== 'none' && !culled) retarget(f, K); // (a culled fighter, out of sight, does not scan for targets; it keeps its current one)

    // leash: anchor is the player for followers, home otherwise
    const follower = f.follow === 'player' && playerUp();
    const head = ctx.player.head;
    const ax = follower ? head.x : f.homeX, az = follower ? head.z : f.homeZ;
    const selfD = Math.hypot(p.x - ax, p.z - az);
    if (f.tgt) {
      f.tgt.center(_v);
      if (Math.hypot(_v.x - ax, _v.z - az) > f.leash || selfD > f.leash * 1.2) { f.tgt = null; f.forced = false; f.returning = true; cancelAttack(f); }
    }
    if (follower && selfD > 60) { // way too far behind: catch up instantly, out of sight behind the player
      p.x = head.x - ctx.player.forward.x * 4; p.z = head.z - ctx.player.forward.z * 4; A.kx = A.kz = 0;
    }

    if (f.fleeing) { // lost its arms: run from whatever it was fighting (or from the player)
      if (f.tgt && f.tgt.alive) f.tgt.center(_v); else _v.copy(head);
      const fx = p.x - _v.x, fz = p.z - _v.z, fd = Math.hypot(fx, fz) || 1;
      A.lookAt(null);
      A.walkTo(p.x + (fx / fd) * 8, p.z + (fz / fd) * 8);
      return;
    }
    const t = f.tgt;
    if (t && t.alive) {
      t.center(_v); f.aim.copy(_v);
      A.lookAt(f.aim);
      if (f.state !== IDLE) return;
      const dx = _v.x - p.x, dz = _v.z - p.z, hd = Math.hypot(dx, dz) || 0.001, tr = t.radius, rg = reachOf(f);
      if (f.attack === 'ranged') {
        const ideal = f.range * 0.65;
        if (hd > f.range * 0.9) A.walkTo(_v.x - (dx / hd) * ideal, _v.z - (dz / hd) * ideal);
        else if (hd < f.range * 0.28) A.walkTo(p.x - (dx / hd) * 4, p.z - (dz / hd) * 4); // back off to shooting distance
        else if (Math.random() < 0.3) { const sgn = Math.random() < 0.5 ? -1 : 1; A.walkTo(p.x - (dz / hd) * 2 * sgn, p.z + (dx / hd) * 2 * sgn); }
        else A.stop();
      } else if (hd - tr > rg * 0.8) {
        const stop = tr + rg * 0.55;
        A.walkTo(_v.x - (dx / hd) * stop, _v.z - (dz / hd) * stop);
      } else A.stop();
      return;
    }
    // nothing to fight
    if (follower) { A.lookAt(head); A.follow(head, f.followDist); return; }
    A.lookAt(null);
    if (f.returning || selfD > f.leash) {
      f.returning = true;
      A.walkTo(f.homeX, f.homeZ);
      if (selfD < 1.5) f.returning = false;
    }
  }

  // physics raycast against scenery (fixed colliders + terrain): is there a wall between the shooter and its target?
  function blockedLOS(f) {
    const Py = ctx.world.physics;
    if (!Py || !Py.ready || !f.tgt) return false;
    const A = f.actor, p = A.position, t = f.tgt;
    t.center(_w);
    _o.set(p.x, p.y + (A.height ?? 1.7) * 0.62, p.z);
    _d.set(_w.x - _o.x, _w.y - _o.y, _w.z - _o.z);
    const dist = _d.length() - t.radius * 0.8;
    if (dist < 0.5) return false;
    return !!Py.raycast(_o, _d, dist, { groups: 'world' });
  }

  function beginAttack(f) {
    const A = f.actor;
    if (f.attack === 'ranged' && blockedLOS(f)) { // no clear shot: step sideways to find one
      f.atkCd = 0.7 + Math.random() * 0.5;
      const p = A.position, sgn = Math.random() < 0.5 ? -1 : 1;
      f.tgt.center(_w);
      const dx = _w.x - p.x, dz = _w.z - p.z, hd = Math.hypot(dx, dz) || 1;
      A.walkTo(p.x - (dz / hd) * 3 * sgn, p.z + (dx / hd) * 3 * sgn);
      return;
    }
    if (f.attack === 'melee') { // don't gang up on one target all at once
      let n = 0;
      for (let i = 0; i < fighters.length; i++) { const g = fighters[i]; if (g !== f && g.state === WIND && g.tgt === f.tgt && g.attack === 'melee') n++; }
      if (n >= api.maxAttackers) { f.atkCd = 0.5 + Math.random() * 0.6; return; }
    }
    A.stop();
    f.state = WIND; f.windT = f.windup * rand(0.92, 1.12); f.atkCd = f.cooldown * rand(0.9, 1.15);
    A.attackAnim?.(f.windT, f.attack === 'ranged' ? 'ranged' : A.kind === 'creature' ? 'lunge' : 'melee');
    sfx('windup', A.position);
  }

  function strike(f, K) {
    const A = f.actor, t = f.tgt, p = A.position;
    if (!t || !t.alive) return;
    t.center(_v);
    if (f.attack === 'ranged') {
      let mx = p.x + Math.sin(A.yaw) * 0.45, my = p.y + (A.height ?? 1.7) * 0.62, mz = p.z + Math.cos(A.yaw) * 0.45;
      if (A.muzzleAt && A.muzzleAt(_muz)) { mx = _muz.x; my = _muz.y; mz = _muz.z; } // model bodies shoot from the hand / mouth bone
      _w.set(_v.x - mx, _v.y - my, _v.z - mz);
      const len = _w.length() || 1, sp = 0.03 * len;
      _w.x += rand(-sp, sp); _w.y += rand(-sp, sp); _w.z += rand(-sp, sp);
      fire({ origin: _fwd.set(mx, my, mz), direction: _w, speed: f.proj.speed ?? 10, damage: (f.proj.damage ?? f.damageAmt) * limbMul(f), radius: f.proj.radius,
        splash: f.proj.splash, gravity: f.proj.gravity, color: f.proj.color ?? FACTION_COLOR[f.faction], from: f.faction, by: f, kind: f.proj.kind });
      sfx('shot', p);
      return;
    }
    sfx('swing', p);
    const edge = Math.hypot(_v.x - p.x, _v.z - p.z) - t.radius;
    if (edge > reachOf(f) * 1.25 + 0.25 || Math.abs(_v.y - (p.y + 1)) > 3) return; // they stepped out of reach: a miss
    const e = { attacker: f, target: t, point: _v.clone(), damage: f.damageAmt * limbMul(f), kind: 'melee', blocked: false };
    ctx.events.emit('combat:attack', e);
    if (e.blocked) { spark(0xffffff, e.point, 8); sfx('impact', e.point); return; }
    if (e.damage > 0) {
      _dirv.set(e.point.x - p.x, 0.1, e.point.z - p.z).normalize();
      HITO.from = f.faction; HITO.by = f; HITO.kind = armless(f) ? 'blunt' : f.dmgKind; HITO.direction = _dirv;
      K.hit(e.point, 0.25, e.damage, HITO);
    }
    spark(FACTION_COLOR[f.faction] ?? 0xffffff, e.point, 8);
    sfx('hit', e.point);
  }

  function step(f, dt, K) {
    const A = f.actor, d = f.damage;
    if (f.dead) { dropFrom(fighters, f); return; }
    if (A.removed || d.removed) { release(f); return; }
    if (!d.alive || A.dead) { onDeath(f); dropFrom(fighters, f); return; }
    if (A.staggerT > 0) { // knocked back by a strong blow (kit.hit force): no thinking and no swings until it recovers
      if (f.state !== IDLE) cancelAttack(f);
      f.atkCd = Math.max(f.atkCd, 0.45);
      return;
    }
    f.atkCd -= dt;
    f.sinceThink += dt;
    f.thinkT -= dt;
    if (f.thinkT <= 0) {
      const culled = isCulled(A);
      f.thinkT = rand(0.18, 0.34) * thinkK() * (culled ? 3 : 1);
      think(f, K, culled);
    }
    if (f.state === WIND) {
      const t = f.tgt;
      if (!t || !t.alive) { cancelAttack(f); return; }
      f.windT -= dt;
      if (f.windT > 0.12) { t.center(f.aim); A.faceTo?.(f.aim, 0.2); } // tracks the target, then commits: sidestep!
      if (f.windT <= 0) { strike(f, K); f.state = RECOVER; f.recT = 0.5; }
    } else if (f.state === RECOVER) {
      f.recT -= dt;
      if (f.recT <= 0) { f.state = IDLE; f.thinkT = Math.min(f.thinkT, 0.05); }
    } else if (f.atkCd <= 0 && f.tgt && f.attack !== 'none' && !f.fleeing && canStrike(f)) {
      const t = f.tgt;
      if (!t.alive) { f.tgt = null; return; }
      t.center(_v);
      const p = A.position, hd = Math.hypot(_v.x - p.x, _v.z - p.z);
      if (f.attack === 'ranged' ? hd <= f.range : hd - t.radius <= reachOf(f)) beginAttack(f);
    }
  }

  // ------------------------------------------------------------------ fighter factory
  function fighter(c, actor, o = {}) {
    try {
      if (!actor || !actor.position || actor.removed || actor.dead) return null;
      if (actor.damage && actor.damage.fighter) release(actor.damage.fighter);
      // population governor: over the perf budget the fighter becomes a dormant RESERVE (see PERFORMANCE above) instead of one more brain
      let reserve = false;
      const PF = ctx.world.perf;
      if (PF && o.reserve !== false) reserve = !(typeof PF.allow === 'function' ? PF.allow('fighters', 1) >= 1 : typeof PF.canSpawn === 'function' ? PF.canSpawn('fighters', 1) : true);
      if (reserve && reserves.length >= MAXRES) return null;
      const dmg = actor.damage ?? (actor.setupDamage ? actor.setupDamage({ hp: o.hp }) : null);
      if (!dmg) return null;
      const faction = fOf(o.faction ?? 'enemy');
      const attack = o.attack ?? 'melee';
      const creature = actor.kind === 'creature';
      if (o.hp != null) { dmg.hp = dmg.maxHp = o.hp; }
      dmg.faction = faction; actor._faction = faction;
      const range = o.range ?? (attack === 'ranged' ? 14 : creature ? 1.2 : 1.5);
      const follow = o.follow !== undefined ? o.follow : faction === 'friendly' ? 'player' : null;
      const speed = o.speed ?? (faction === 'friendly' ? 3 : 2.4) * (creature ? 1.25 : 1);
      const id = ++S.seq, pr = o.projectile ?? {};
      const f = {
        id, actor, damage: dmg, ctx: c, name: o.name ?? null, attack, damageAmt: o.damage ?? (attack === 'ranged' ? 5 : 6), range,
        cooldown: o.cooldown ?? (attack === 'ranged' ? 2.4 : 1.8), windup: o.windup ?? (attack === 'ranged' ? 0.6 : 0.55),
        aggro: o.aggroRange ?? (attack === 'ranged' ? range + 4 : 16), speed, leash: o.leash ?? (follow ? 28 : 40), follow,
        followDist: 2.2 + (id % 3) * 0.7, proj: pr, onDeath: o.onDeath ?? null, drops: o.drops ?? null,
        homeX: actor.position.x, homeZ: actor.position.z,
        tgt: null, forced: false, returning: false, state: IDLE, windT: 0, recT: 0, atkCd: 0.6 + Math.random() * 0.8,
        thinkT: rand(0, 0.3), sinceThink: 0, provokedBy: null, provokeT: 0, lastBy: null, lastFrom: null, removed: false, dead: false,
        aim: new Vector3(), fleeing: false, dmgKindOpt: o.damageKind ?? null, reserve, wanderOpt: o.wander, resumeWander: null,
        get dmgKind() { return this.dmgKindOpt ?? (this.actor.kind === 'creature' || this.actor.held ? 'slash' : 'blunt'); },
        get faction() { return this.damage.faction ?? 'neutral'; },
        set faction(v) { S.impl.setFaction(this, fOf(v)); },
        get hp() { return this.damage.hp; },
        get maxHp() { return this.damage.maxHp; },
        get alive() { return !this.removed && !this.dead && this.damage.alive; },
        get target() { return pubTarget(this); },
        setFaction(v) { S.impl.setFaction(this, fOf(v)); return this; },
        setTarget(t) { S.impl.setTarget(this, t); return this; },
        heal(n = 1) { this.damage.heal(n); return this; },
        activate() { return S.impl.activate(this); },
        release() { S.impl.release(this); },
        remove() { S.impl.remove(this); },
      };
      actor.setSpeed?.(speed);
      if (reserve) { // dormant: stands still, no brain
        if (actor.wanderOn && actor.wander) { f.resumeWander = { r: actor.wr, x: actor.wcx, z: actor.wcz }; actor.wander(0); }
        actor.stop?.();
      } else if (!follow && o.wander !== 0 && actor.wander && !actor.wanderOn) actor.wander(o.wander ?? 3, { x: f.homeX, z: f.homeZ });
      dmg.fighter = f;
      const prevHit = dmg.onHit, prevDeath = dmg.onDeath;
      dmg.onHit = (e) => { if (prevHit) prevHit(e); S.impl.onHit(f, e); };
      dmg.onDeath = (d) => { if (prevDeath) prevDeath(d); S.impl.onDeath(f); };
      (reserve ? reserves : fighters).push(f);
      if (c && c.onDispose) c.onDispose(() => release(f));
      return f;
    } catch (err) {
      console.error('[combat] fighter() failed', err);
      return null;
    }
  }

  // implementation table: handlers stored on fighters/damageables call through this so a hot-reloaded file takes over
  S.impl = { onHit, onDeath, release, remove, setTarget, setFaction, activate };

  // ------------------------------------------------------------------ queries
  function nearest(point, o = {}) {
    let best = null, bd = (o.maxDist ?? 30);
    for (let pass = 0; pass < 2; pass++) { // active fighters, then the dormant reserves (they are still there to be hit)
      const L = pass ? reserves : fighters;
      for (let i = 0; i < L.length; i++) {
        const f = L[i];
        if (!f.alive) continue;
        if (o.faction && f.faction !== fOf(o.faction)) continue;
        if (o.hostileTo && !hostile(o.hostileTo, f.faction)) continue;
        const p = f.actor.position, d = Math.hypot(p.x - point.x, p.y + 0.8 - point.y, p.z - point.z);
        if (d <= bd) { bd = d; best = f; }
      }
    }
    return best;
  }
  function count(faction) {
    let n = 0;
    const ff = faction ? fOf(faction) : null;
    for (let i = 0; i < fighters.length; i++) if (fighters[i].alive && (!ff || fighters[i].faction === ff)) n++;
    for (let i = 0; i < reserves.length; i++) if (reserves[i].alive && (!ff || reserves[i].faction === ff)) n++;
    return n;
  }
  function clear(faction) {
    const ff = faction ? fOf(faction) : null;
    for (const L of [reserves, fighters]) {
      for (let i = L.length - 1; i >= 0; i--) {
        const f = L[i];
        if (f && (!ff || f.faction === ff)) remove(f);
      }
    }
    for (let i = 0; i < MAXP; i++) if (!ff || fOf(projs[i].from) === ff) projs[i].on = false;
  }

  const api = {
    version: 2, fighter, fighters, reserves, nearest, count, clear, fire, projectiles: projs,
    // melee fighters allowed to swing at one target at once: 2 at full density, fewer under load, unless a creation assigns its own number
    get maxAttackers() { return S.maxAtk != null ? S.maxAtk : Math.max(1, Math.round(2 * densK())); },
    set maxAttackers(v) { S.maxAtk = v == null || !isFinite(+v) ? null : Math.max(0, +v); },
    stats: () => ({ fighters: fighters.length, reserves: reserves.length, projectiles: projs.reduce((n, p) => n + (p.on ? 1 : 0), 0) }),
  };
  ctx.provide('combat', api);

  return {
    update(dt) {
      dt = Math.min(dt, 0.05);
      const K = kit();
      if (!K || !K.nearestTarget) return;
      for (let i = fighters.length - 1; i >= 0; i--) {
        const f = fighters[i];
        if (!f) continue;
        try { step(f, dt, K); } catch (err) {
          console.error('[combat] fighter error; removing it', err);
          release(f);
        }
      }
      if (reserves.length) { // dormant fighters: housekeeping only, then the oldest ones join the fight while the perf budget has room
        for (let i = reserves.length - 1; i >= 0; i--) {
          const f = reserves[i];
          if (!f) continue;
          try {
            const A = f.actor, d = f.damage;
            if (f.dead) { reserves.splice(i, 1); continue; }
            if (A.removed || d.removed) { release(f); continue; }
            if (!d.alive || A.dead) { onDeath(f); const j = reserves.indexOf(f); if (j >= 0) reserves.splice(j, 1); continue; }
          } catch (err) { console.error('[combat] reserve error; removing it', err); release(f); }
        }
        const PF = ctx.world.perf;
        for (let n = 0; n < 2 && reserves.length; n++) {
          if (PF && (typeof PF.allow === 'function' ? PF.allow('fighters', 1) < 1 : typeof PF.canSpawn === 'function' && !PF.canSpawn('fighters', 1))) break;
          activate(reserves[0]);
        }
      }
      stepProjectiles(dt, K);
      stepStuck(dt);
      stepBars();
    },
    dispose() { /* fighters and projectiles live in ctx.state; visuals are removed with ctx.root */ },
  };
}
