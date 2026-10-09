// core/kit.js — world.kit: the building blocks every creation is made from. READ THIS FIRST.
//
// USE      const kit = ctx.world.kit; if (!kit) return {};        // always guard (it may be reloading)
//   * Every factory takes YOUR ctx first. Objects are parented under ctx.root and removed with the
//     creation automatically (kit registers ctx.onDispose) — never write cleanup for kit things.
//   * Positions are WORLD coordinates (ctx.root stays at the origin). Anything taking a position accepts a
//     THREE.Vector3 or any {x,y,z}. Colours: hex number 0xff8800, CSS string, or THREE.Color.
//   * SIMULATION MODEL: kit steps everything itself in its own update(): particles, physics, grabbing,
//     people/creatures, lights, damage, gore, debris. The `update()` method on kit objects is a harmless NO-OP kept for
//     compatibility — do not call it, and do not move things that kit simulates by hand (use their API).
//
// PARTICLES  const fx = kit.particles(ctx, { count, color, size, life, speed, gravity, drag, spread, alpha, additive })
//   One pooled draw call; oldest particle is recycled when the pool is full. count default 100 (max 2000).
//   color c | [start,end]; size = diameter in m, s | [start,end]; life = seconds, s | [min,max];
//   speed = random outward m/s, s | [min,max]; gravity = m/s² down (NEGATIVE rises, e.g. -2 for flames);
//   drag = 1/s velocity decay; spread = random start radius (m); alpha = peak opacity 0..1 (default 1);
//   additive: true (default) = glowing fire/magic, false = normal blending (smoke, dust). (Additive switches itself to an
//   alpha-safe blend in mixed reality; nothing to do.)
//   fx.emit(position, n = 1, velocity?, scale = 1)   velocity (Vector3) is an added push; scale multiplies size+speed
//   fx.clear()   fx.alive   fx.object (THREE.Points)   fx.dispose()
//   Steady stream:  acc += dt * rate; const n = acc | 0; acc -= n; if (n) fx.emit(p, n, up);
//   const tr = kit.trail(ctx, particleOpts + { spacing = 0.1 });  tr.move(pos) every frame; tr.reset() on respawn.
//
// PEOPLE     const npc = kit.humanoid(ctx, { height = 1.7, skin, shirt, pants, hair, hat, x, z, yaw, speed = 1.3,
//                                            hp = 20, onDeath(npc), onHit(e), damageable = true, gore = 'blood' })
//            const pet = kit.creature(ctx, { legs = 4 (2|4|6), size = 0.8 (body length m), bodyColor, accent, speed, hp, x, z, ... })
//   Both return the same actor: .group (THREE.Group at the feet; .group.position moves it), .position, .dead, .damage
//   walkTo(x, z) | walkTo(vec3)   stop()   follow(liveVec3, distance = 2) (pass null to stop)   lookAt(liveVec3|null)
//   wave(seconds = 2)   say(text, seconds = 4) speech bubble   setSpeed(v)   onArrive(fn)   remove()
//   wander(radius = 5, centerVec3?)  idle-amble around a point; suspended while lookAt() has a target; wander(0) stops.
//   They glue themselves to the terrain, turn smoothly, animate limbs, flinch, and die by how they were killed (see GORE).
//   Identity: actor.id (stable, 'a12'), actor.name (settable: opts name/role, else the model name, else 'villager'/'creature'), actor.role (settable,
//   ''); actor.group.userData.actor = actor. kit.actors = the LIVE array of every actor (do not mutate). say() also emits 'actor:say' { actor, text, seconds }.
//   Combat helpers (core/combat.js uses them; handy for scripted fights too), options: faction = 'friendly'|'enemy'|'neutral':
//     actor.faction (get/set)  actor.height (m)  actor.speedNow (current m/s)  actor.moving (bool)
//     actor.attackAnim(windup = 0.4, kind = 'melee' | 'ranged' | 'lunge') -> total seconds   arm raises for `windup` s, then strikes
//       (humanoid swings/points, creature crouches and lunges); actor.attacking (bool), actor.strikeT = 0..1 progress of the strike
//     actor.faceTo(vec3 | {x,z}, seconds = 0.35)   turn the body toward a point right now (beats walkTo/lookAt facing)
//     actor.equip(object3D | null, weaponType?) -> previous   put a simple mesh in the humanoid's right hand (grip at the origin, blade
//       along -Z, like weapons) / a creature's mouth; null empties it.   actor.held = the equipped object or null. Pass a world.weapons
//       type name (or set object.userData.weaponType) and a severed arm drops a real pickup of that weapon.
//
// MODEL BODIES  kit.humanoid / kit.creature / kit.actor(ctx, { model, ... }) use a real animated glTF from world.models instead of boxes and spheres (same actor interface):
//   model: 'knight' | ['goblin', 'rogue-hooded'] | { model, rig?, height, size, tint, bulk, tall, hold, equip, weaponType, ... }. A LIST = the first model that exists wins; if none
//   exists, loading fails or world.models is absent, the primitive body is built from the other options (skin, shirt, color ...): nothing breaks. Fully usable at once; the model snaps in.
//   height = metres to the top of the bare head (people), size = body length (animals); tint = 0xrrggbb multiplied onto the texture (darkens / shifts: green cannot become red);
//   hover + bob float it (ghosts); gore / death: 'fade' / limbs: false; hold: { right: 'sword', left: 'shield-square' } puts catalogue items in the hands (actor.hold(item, hand,
//   weaponType) later); equip: { right: '1H_Sword', left: null } switches the KayKit heroes' own hidden weapons (null = put away); actor.equip(object3D) still works (hand bone);
//   actor.gear('head' | 'pivot', obj3D, x, y, z, scale) adds a crown / hat built for a 1.7 m person. actor.mdl = { name, ready, fell (fell back to primitives), state, h }.
//   Motion picks clips: idle / walk / run by real speed (playback rate matched to ground speed), attackAnim -> attack | attack-2h | shoot | cast | breathe by kind and held item,
//   hit reaction, wave, die; no legs left -> sits. Cube animals have no attack / die clips: they lunge and tip over instead.
//   kit.modelBody(ctx, hostActor, pivotGroup, spec, onFail) drives a model for a custom mob (library dragons: idle walk fly attack breathe hit die).
//
// BODIES     const b = kit.body(ctx, mesh, { radius = 0.2, mass = 1, bounce = 0.5, friction = 0.6, drag = 0.05,
//                                            gravity = 9.8, grabbable = false, grabRange = 0, damage = 0, damageKind = 'blunt', position,
//                                            shape = 'sphere'|'box'|'capsule'|'cylinder'|'hull', size, rotate, ccd, group })
//   With world.physics (Rapier) a body is a REAL rigid body: it tumbles, stacks, rests, sleeps, collides with the terrain, scenery (every
//   destructible / tree has a fixed collider), debris and ragdolls (mass 0/Infinity = fixed collider). shape 'sphere' (default, from radius) keeps
//   YOUR mesh orientation unless roll !== false; any other shape rotates freely: size = [w,h,d] box extents (a number = cube), [r, height] for
//   capsule/cylinder, omitted = fitted to the mesh. Crates/barrels: { shape: 'box', size: [..], mass: 8, friction: 0.7, bounce: 0.05 }.
//   Without physics, or over its budget (150 bodies quest / 600 pc), the old hand-rolled sim runs: gravity, terrain bounce, sphere–sphere only.
//   mesh is added to ctx.root if it has no parent. MOVE IT VIA b.position / b.velocity (Vector3s), not mesh.position (writes between frames
//   are picked up and pushed into the physics body; so are b.held = truthy (it follows b.position), b.invMass = 0 (pinned), b.gravity, b.drag).
//   grabbable: squeeze either hand within ~18 cm of it to hold, release to THROW with hand velocity.
//   grabRange > 0 also lets the player grab it by pointing at it from that many metres (it flies to the hand).
//   damage > 0: fast impacts hurt damageables (damage * speed / 6, of kind damageKind, along the body's velocity).
//   b.onHit(fn) fn({ kind:'ground'|'body'|'damageable', speed, point, normal?, other?, target?, static? })   static: the 'ground' was scenery
//   b.onGrab(fn(hand, info))  b.onRelease(fn(hand, { hand, velocity }))   hand = 'left' | 'right'   (grabbing pulses that controller)
//   b.applyImpulse(x,y,z)   b.held ('left'|'right'|null)   b.grounded   b.remove()   body opt from:'player' attributes impact damage
//   kit.haptic(hand 'left'|'right', strength 0..1 = 0.4, ms = 40)   controller buzz (no-op for bare hands / desktop)
//
// DAMAGE     const d = kit.damageable(ctx, object3D, { hp = 10, radius = 0.5, offsetY = 0, faction, gore, onHit(e), onDeath(d) })
//   e = { target, amount, point, hp, from, by, kind, direction }. With no onDeath the object shrinks away and is removed.
//   d.hp  d.alive  d.faction  d.hit(amount, point?, from?, by?, kind?, direction?)  d.heal(n)  d.center(outVec3)  d.remove()
//   d.lastHit = { kind, amount, point, direction, from, by, hand } (the blow being handled; do not keep the vectors)
//   KINDS: 'slash'|'pierce'|'blunt'|'explosion'|'fire'|'frost'|'shock'|'magic' (unspecified = 'blunt'). The kind decides whether limbs
//   come off, how the victim dies and how scenery breaks (see GORE / DESTRUCTION). `direction` = the way the blow travelled (optional).
//   kit.hit(point, radius, amount, { from, by, kind, direction, hand }) -> count   damages every damageable in range (linear falloff to
//        50% at the edge), also shoves bodies. THE way for any spell/projectile/trap to hurt things. Emits event 'kit:hit'.
//        from = who is attacking: 'player' (counts as 'friendly') | 'friendly' | 'enemy' | 'neutral'. A hit NEVER hurts
//        damageables of the attacker's own faction; with no `from` it hurts everything except the player (back-compatible,
//        and the player never hurts themself). Player spells/weapons should pass from:'player'; enemy attacks from:'enemy'.
//        by = optional attacker (a fighter) so kills can be credited / neutrals can retaliate. hand = 'left'|'right' buzzes that
//        controller when the blow severs something. Fire/frost/shock/magic spells: pass their kind, e.g. { from:'player', kind:'fire' }.
//        force = shove strength (N·s, default amount * 0.5): flings bodies, debris and ragdolls radially (Δv = force / mass) and a force >= 6
//        also throws a standing actor back and stuns it (actor.staggerT, about a second; combat.js fighters do not act meanwhile).
//   kit.nearestTarget(point, maxDist = 20, { hostileTo, faction }) -> live damageable | null (ignores dead; homing / direct-hit
//        tests). hostileTo:'friendly' (or 'player') returns only enemies, hostileTo:'enemy' only friendlies (+ the player);
//        faction:'neutral' only that faction. With neither option the player is never returned (spells never home on you).
//   kit.factionOf(from) -> 'enemy'|'friendly'|'neutral' ('player' -> 'friendly', unknown -> 'neutral')
//   kit.hostile(a, b) -> true when factions a and b fight (enemy <-> friendly only; neutral fights nobody unless attacked)
//
// GORE (stylised chunky-toy dismemberment; the weapons / spells you give already trigger it)   actor gore: 'blood' (default) | 'bones' | 'sparks' | 'slime' | 'none'; kit.damageable({ gore }) default none.
//   Slashes sever limbs, explosions burst, blunt blows launch ragdolls, fire chars, frost shatters, shock/magic dissolve. actor.limbs { head, armL, armR, legL, legR }, actor.sever('armL', dir?) -> bool,
//   actor.armsLeft / legsLeft / hasHead, actor.onSever = (limb, actor) => {}; event 'limb:severed' { actor, limb, kind, by }; losing the head kills. Ragdolls need world.physics.
//   kit.gore.level = 'full' | 'mild' | 'off'  — honour "less blood" / "turn the gore off" (stored in ctx.state; off = nothing comes off). kit.gore.clear() wipes parts/blood/debris now.
//   kit.dismemberable(ctx, damageable, [{ name, object3D, vital }], { gore }) -> { limbs, sever(name, dir) }  makes child meshes of a custom monster severable.
//
// DESTRUCTION (all pooled: ONE debris system, max 300 live chunks in 2 draw calls, fading after ~15 s)
//   const h = kit.destructible(ctx, object3D, { hp, material: 'wood'|'stone'|'glass'|'metal'|'crystal'|'ice'|'earth'|'cloth', pieces, radius,
//             mass = 1, faction = 'neutral', block = false, onDamage(e), onBreak(e), stages })  -> { hp, broken, hit(...), break(dir?), repair(), remove() }
//     Registers a damageable, so every weapon/spell/explosion already works on it; fighters never target it. Materials resist or fear
//     kinds (stone shrugs off slashes, ice hates fire and hammers). On break the object hides and becomes chunks of ITS volume and colours
//     (planks, blocks, shards, plates, clods, strips) + dust/sparks + a break sound. block: true also makes actors steer around it and
//     stops the player's rig (or a number = one circle of that radius).
//     stages: [{ at: 0.6 (hp fraction), tint: 0.2, hide: ['childName'], show: [...], drop: 3 (chunks), lean: 0.03, onStage(h) }] or 'auto'
//   kit.structure(ctx, [{ object3D, hp, material, supports: [indices] }], { onCollapse(i) }) -> { parts, broken(), repair(), remove() }
//     parts break individually; a part whose supports are ALL gone collapses after a beat (no supports = stands on the ground).
//   kit.fellable(ctx, treeGroup, { trunk, crown, hp = 45, block = true, onFell(h) }) -> { hp, fallen, fell(dir?), stump, remove() }
//     trunk/crown = child objects or their names. Cut or blasted, the tree topples away from the blow (creak, crash, leaves, stump).
//   kit.scorch(point, radius, { color })  burn mark; kit.crater(point, radius)  dark ring + rim of earth clods (visual only, terrain
//     untouched). kit.explosion draws both automatically near the ground.   kit.debris(point, { material, count, power, direction, colors })
//   kit.obstacle(ctx, { position, radius }) -> { position, radius, enabled, remove() }  a circle actors steer around and the player's rig
//     cannot enter (destructibles remove theirs when broken). Max 96.
//
// LABEL      const l = kit.label(ctx, text, { color = white, size = 0.12 (m per text line), position, parent, style, background = true, maxWidth = 560 });
//              l.set(text)  l.position  l.show(bool)  l.remove().  Default = a brass-edged name plate (shows within ~8 m, while looked at); text like "-14" = outlined float
//              text; background:false = bare text for signs. actor.say() = parchment speech bubble (28 chars a line, 3 lines a page). Letters keep >= ~1.2 deg.
//
// SOUND      const snd = kit.sound(ctx, { volume = 1 });   all calls take  at: position (omit = non-positional)  vol  delay
//   snd.tone({ freq = 440, freqEnd, dur = 0.3, type = 'sine', vol = 0.3, attack = 0.004, at, delay })   // freqEnd = glide
//   snd.noise({ dur = 0.2, filter: { type = 'lowpass', freq = 1000, freqEnd, q = 1 }, vol = 0.3, at })    // whoosh, crackle, boom
//   snd.chord([freqs], { dur, type, vol, stagger = 0.06, at })
//
// LIGHT      const L = kit.light(ctx, { color, intensity = 12, distance = 12, decay = 2, flicker = 0..1, position })
//   Real point light; kit keeps at most 6 alive in the scene (highest intensity near the player wins; fewer when ctx.quality.maxLights < 6).
//   Typical: intensity 10–40, distance 10–20. Move with L.position.set(..) or L.target = object3D; also L.intensity,
//   L.color, L.enabled, L.remove(). kit.flash(ctx, point, { color, intensity = 40, distance = 12, duration = 0.3 }) = brief burst.
//
// EXTRAS     kit.explosion(ctx, point, { color = 0xff7a1a, size = 1.5, damage = 0, radius, from, by, kind = 'explosion' })  fire+sparks+smoke+
//              flash+boom (+ scorch/crater near the ground; damage goes through kit.hit, so pass from:'player' for player spells)
//            kit.clamp(v,a,b) kit.lerp(a,b,t) kit.damp(a,b,rate,dt) kit.rand(a=0,b=1)
//            kit.ease.in/out/inOut/back(t 0..1)   kit.stats()
//

export const meta = { name: 'Kit', description: 'Particles, people, creatures, physics, labels, sound, lights, damage.' };

export default function (ctx) {
  const THREE = ctx.THREE;
  const { Vector3, Color, MathUtils, Quaternion, Matrix4 } = THREE;
  const state = ctx.state;
  const reg = (state.reg ??= {});
  for (const k of ['particles', 'bodies', 'actors', 'damageables', 'lights', 'parts', 'bleeds', 'delays', 'destructibles', 'falls', 'obstacles', 'rags']) reg[k] ??= [];
  state.actorSeq ??= 0;
  const impl = (state.impl ??= {}); // handlers stored on objects call through here, so a reloaded kit.js takes over objects made by an older one
  const groundAt = ctx.groundAt;
  const Q = ctx.quality || {};                 // live: core/perf.js mutates it (density, maxLights, animStride ...)
  state.frameNo ??= 0;                         // kit frame counter (shared across reloads)
  state.densBase ??= Math.max(Q.density > 0 ? Q.density : 1, Q.pc ? 2.5 : 1); // the tier's density at level 0 (self-calibrating: the highest ever seen)
  // density scale, 1 at level 0 (= tier base) down to 0.12; never above 1 (level 0 looks exactly as before)
  function densK() {
    const d = Q.density;
    if (!(d > 0)) return 1;
    if (d > state.densBase) state.densBase = d;
    const k = d / state.densBase;
    return k >= 0.999 ? 1 : k < 0.12 ? 0.12 : k;
  }
  // scaled burst size for chunks / clods: never below min(lo, n)
  const kb = (n, lo = 1) => { const k = densK(); return k >= 1 ? n : Math.max(Math.min(n, lo), Math.round(n * k)); };

  // ------------------------------------------------------------------ small utilities
  const noop = () => {};
  const clamp = MathUtils.clamp, lerp = MathUtils.lerp;
  const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const ease = {
    in: (t) => t * t,
    out: (t) => 1 - (1 - t) * (1 - t),
    inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    back: (t) => { const c = 2.70158; return 1 + c * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); },
  };
  const wrapAng = (a) => { while (a > Math.PI) a -= 6.283185307; while (a < -Math.PI) a += 6.283185307; return a; };
  const dropFrom = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); } };
  const pair = (v, d) => (Array.isArray(v) ? [v[0], v[1] ?? v[0]] : [v ?? d, v ?? d]);
  const cleanup = (c, fn) => { if (c && c.onDispose) c.onDispose(fn); };
  const safe = (where, fn, a, b) => { try { fn(a, b); } catch (err) { console.error(`[kit] ${where} failed`, err); } };
  const _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _n = new Vector3(), _t = new Vector3();
  const _flash = new Color(1, 0.15, 0.05);
  const _v2 = new THREE.Vector2();

  function disposeObject(o) {
    o.traverse((m) => {
      for (const mat of [].concat(m.material ?? [])) {
        if (mat.userData && mat.userData.keep) continue; // shared kit materials (stumps) outlive any one actor
        for (const v of Object.values(mat)) if (v && v.isTexture) v.dispose();
        mat.dispose();
      }
    }); // geometries of kit parts are shared; creations' own geometry is disposed with their root
  }

  // shared unit geometries for people/creatures (re-uploaded automatically if some root disposal frees them)
  const G = {};
  function geos() {
    if (!G.box) {
      G.box = new THREE.BoxGeometry(1, 1, 1);
      G.boxTop = new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0); // pivot at top, hangs down
      G.sphere = new THREE.SphereGeometry(1, 10, 8);
      G.cone = new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0);
    }
    return G;
  }

  // ------------------------------------------------------------------ particles
  const P_VERT = `
    attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uPx;
    void main() {
      vColor = aColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uPx / max(gl_Position.w, 0.02), 0.0, 220.0);
    }`;
  const P_FRAG = `
    varying vec4 vColor;
    void main() {
      vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0;
      if (r > 1.0 || vColor.a < 0.004) discard;
      float f = 1.0 - r; f *= f;
      gl_FragColor = vec4(vColor.rgb, vColor.a * f);
      #include <colorspace_fragment>
    }`;

  // Mixed reality: AdditiveBlending would raise framebuffer alpha and paint opaque black over the room (see core/world.js), so
  // additive emitters switch to a blend that leaves alpha alone while ctx.input.passthrough is true.
  function applyBlend(e) {
    if (e.additive === undefined) e.additive = e.material.blending === THREE.AdditiveBlending || e.material.blending === THREE.CustomBlending;
    if (!e.additive) return;
    const pt = !!(ctx.input && ctx.input.passthrough);
    if (e.pt === pt) return;
    e.pt = pt;
    const m = e.material;
    if (pt) {
      m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
      m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    } else m.blending = THREE.AdditiveBlending;
  }

  function particles(c, o = {}) {
    const N =Math.max(1, Math.min(2000, (o.count ?? 100) | 0));
    const [l0, l1] = pair(o.life, 1), [s0, s1] = pair(o.size, 0.2), [v0, v1] = pair(o.speed, 0);
    const cols = Array.isArray(o.color) ? o.color : [o.color ?? 0xffffff];
    const geometry = new THREE.BufferGeometry();
    const posA = new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const colA = new THREE.BufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const sizA = new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', posA);
    geometry.setAttribute('aColor', colA);
    geometry.setAttribute('aSize', sizA);
    const material = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: 500 } }, vertexShader: P_VERT, fragmentShader: P_FRAG,
      transparent: true, depthWrite: false, blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const object = new THREE.Points(geometry, material);
    object.frustumCulled = false;
    object.visible = false;
    object.renderOrder = o.additive === false ? 5 : 6;
    // per-eye pixel scale so point size is right in stereo and on desktop
    object.onBeforeRender = (renderer, scene, camera) => {
      const h = camera.viewport ? camera.viewport.w : renderer.getDrawingBufferSize(_v2).y;
      material.uniforms.uPx.value = h * 0.5;
    };
    (c.root ?? ctx.root).add(object);
    const e = {
      N, pos: posA.array, vel: new Float32Array(N * 3), age: new Float32Array(N), life: new Float32Array(N),
      sv: new Float32Array(N), col: colA.array, siz: sizA.array, live: 0, cursor: 0,
      g: o.gravity ?? 0, drag: o.drag ?? 0, spread: o.spread ?? 0, alpha: o.alpha ?? 1,
      s0, s1, c0: new Color(cols[0]), c1: new Color(cols[1] ?? cols[0]), geometry, material, object, posA, colA, sizA,
      alive: 0, additive: o.additive !== false, pt: false, hi: 0,
    };
    applyBlend(e);
    // put: the raw emission (no density scaling / cap); emit: what everyone calls. An empty emitter restarts at slot 0 so a small burst in a
    // big pool only draws / uploads the slots it used (e.hi = highest slot in use + 1).
    e.put = (p, n, v, scale) => {
      if (e.live <= 0) { e.cursor = 0; e.hi = 0; }
      for (let k = 0; k < n; k++) {
        const i = e.cursor; e.cursor = (i + 1) % N;
        if (i >= e.hi) e.hi = i + 1;
        if (e.age[i] >= e.life[i]) e.live++;
        e.age[i] = 0; e.life[i] = rand(l0, l1);
        const j = i * 3, sp = scale * rand(v0, v1);
        const z = Math.random() * 2 - 1, a = Math.random() * 6.2832, r = Math.sqrt(1 - z * z), sr = e.spread;
        e.vel[j] = r * Math.cos(a) * sp + (v ? v.x : 0);
        e.vel[j + 1] = z * sp + (v ? v.y : 0);
        e.vel[j + 2] = r * Math.sin(a) * sp + (v ? v.z : 0);
        e.pos[j] = p.x + (Math.random() * 2 - 1) * sr;
        e.pos[j + 1] = p.y + (Math.random() * 2 - 1) * sr;
        e.pos[j + 2] = p.z + (Math.random() * 2 - 1) * sr;
        e.sv[i] = rand(0.8, 1.2) * scale;
      }
      object.visible = true;
    };
    e.emit = (p, n = 1, v, scale = 1) => { n = emitCount(e, n); if (n > 0) e.put(p, n, v, scale); };
    e.clear = () => {
      for (let i = 0; i < N; i++) { e.age[i] = e.life[i] = 0; e.siz[i] = 0; e.col[i * 4 + 3] = 0; }
      e.live = 0; e.cursor = 0; e.hi = 0; sizA.needsUpdate = colA.needsUpdate = true; object.visible = false;
    };
    e.update = noop;
    e.dispose = () => {
      if (e.disposed) return;
      e.disposed = true; dropFrom(reg.particles, e);
      object.removeFromParent(); geometry.dispose(); material.dispose();
    };
    Object.defineProperty(e, 'alive', { get: () => e.live });
    reg.particles.push(e);
    cleanup(c, e.dispose);
    return e;
  }

  // ---- density scaling + the per-tier cap on live particles (all emitters together)
  let liveLeft = 1e9; // refreshed every kit frame (see update): cap - particles alive; emit() spends it
  const liveCap = () => Math.round((Q.pc ? 12000 : 3000) * Math.max(0.3, densK()));
  function capCount(e, n) {
    if (n > liveLeft) n = liveLeft > 0 ? liveLeft : (e.live <= 0 ? 1 : 0); // an idle emitter always gets its one particle: effects never vanish
    liveLeft -= n;
    return n;
  }
  function emitCount(e, n) {
    if (!(n > 0)) return 0;
    const k = densK();
    if (k < 1) {
      if (n <= 1) { if (e.live > 0 && Math.random() >= k) return 0; }   // a running single-particle stream thins out; the first one always shows
      else { const m = n * k, f = m | 0; n = Math.max(1, f + (Math.random() < m - f ? 1 : 0)); }
    }
    return capCount(e, n);
  }

  function stepEmitter(e, dt) {
    if (e.live <= 0) return;
    const { pos, vel, age, life, sv, col, siz } = e;
    const g = e.g * dt, dk = e.drag > 0 ? Math.exp(-e.drag * dt) : 1, c0 = e.c0, c1 = e.c1;
    const hi = e.hi > 0 ? Math.min(e.hi, e.N) : e.N; // emitters made by an older kit.js have no .hi: they step and upload everything
    for (let i = 0; i < hi; i++) {
      if (age[i] >= life[i]) continue;
      const a = (age[i] += dt), u = a / life[i], j = i * 3, k = i * 4;
      if (u >= 1) { siz[i] = 0; col[k + 3] = 0; e.live--; continue; }
      vel[j + 1] -= g;
      vel[j] *= dk; vel[j + 1] *= dk; vel[j + 2] *= dk;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      siz[i] = (e.s0 + (e.s1 - e.s0) * u) * sv[i];
      col[k] = c0.r + (c1.r - c0.r) * u; col[k + 1] = c0.g + (c1.g - c0.g) * u; col[k + 2] = c0.b + (c1.b - c0.b) * u;
      col[k + 3] = e.alpha * Math.min(1, u * 10) * (1 - u * u);
    }
    if (e.hi > 0) { // upload only the slots in use (three: bufferSubData of that range); the range objects are reused: nothing allocated per frame
      e.geometry.setDrawRange(0, hi);
      const rg = e.rng || (e.rng = [{ start: 0, count: 0 }, { start: 0, count: 0 }, { start: 0, count: 0 }]);
      rg[0].count = hi * 3; rg[1].count = hi * 4; rg[2].count = hi;
      const R0 = e.posA.updateRanges, R1 = e.colA.updateRanges, R2 = e.sizA.updateRanges;
      R0.length = 0; R0.push(rg[0]); R1.length = 0; R1.push(rg[1]); R2.length = 0; R2.push(rg[2]);
    }
    e.posA.needsUpdate = e.colA.needsUpdate = e.sizA.needsUpdate = true;
    if (e.live <= 0) { e.object.visible = false; if (e.hi > 0) { e.hi = 0; e.cursor = 0; } }
  }

  // trails: at lower density the points are spaced wider (never fewer than one per move) instead of dropping random single particles
  function trail(c, o = {}) {
    const fx = particles(c, o), spacing = o.spacing ?? 0.1, last = new Vector3();
    let has = false;
    const put1 = (p, scale) => { const n = capCount(fx, 1); if (n > 0) fx.put(p, n, undefined, scale); };
    return {
      emitter: fx, object: fx.object,
      move(p, scale = 1) {
        if (has) {
          const dx = p.x - last.x, dy = p.y - last.y, dz = p.z - last.z, k0 = densK(), sp = k0 < 1 ? spacing / Math.max(k0, 0.25) : spacing;
          const n = Math.min(24, Math.ceil(Math.sqrt(dx * dx + dy * dy + dz * dz) / sp));
          for (let k = 1; k <= n; k++) put1(_t.set(last.x + dx * k / n, last.y + dy * k / n, last.z + dz * k / n), scale);
        } else put1(p, scale);
        last.set(p.x, p.y, p.z); has = true;
      },
      reset() { has = false; }, update: noop, dispose: fx.dispose,
    };
  }

  // ------------------------------------------------------------------ lights (global cap, constant-count pool => no shader recompiles)
  // The WHOLE pool is created here, once, at intensity 0 and its size never changes afterwards: three recompiles every lit material whenever
  // the number of lights in the scene changes. ctx.quality.maxLights (read every frame) only decides how many of them are lit; the rest are
  // parked at intensity 0 (dimmest / farthest first), never removed or hidden.
  const MAX_LIGHTS = 6;
  const pool = (state.lightPool ??= []);
  while (pool.length < MAX_LIGHTS) { const l = new THREE.PointLight(0xffffff, 0, 10, 2); l.name = 'kit-light-' + pool.length; pool.push(l); }
  for (const l of pool) ctx.root.add(l);
  const top = [];
  const lightCap = () => { const m = Q.maxLights; return m == null ? MAX_LIGHTS : m < 0 ? 0 : m > pool.length ? pool.length : m | 0; };

  function light(c, o = {}, selfExpiring = false) {
    const h = {
      position: new Vector3(), target: null, color: new Color(o.color ?? 0xffaa55), intensity: o.intensity ?? 12,
      distance: o.distance ?? 12, decay: o.decay ?? 2, flicker: o.flicker ?? 0, enabled: true, ttl: -1, ttl0: 1,
      seed: Math.random() * 100, eff: 0, score: 0, active: false, removed: false,
    };
    if (o.position) h.position.set(o.position.x, o.position.y, o.position.z);
    h.remove = () => { h.removed = true; dropFrom(reg.lights, h); };
    h.update = noop;
    reg.lights.push(h);
    if (!selfExpiring) cleanup(c, h.remove);
    return h;
  }
  function flash(c, p, o = {}) {
    const h = light(c, { color: o.color ?? 0xffcc88, intensity: o.intensity ?? 40, distance: o.distance ?? 12, position: p }, true);
    h.ttl = h.ttl0 = o.duration ?? 0.3;
    return h;
  }
  function stepLights(dt, t) {
    const L = reg.lights, head = ctx.player.head, cap = lightCap();
    top.length = 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const h = L[i];
      if (h.ttl >= 0) { h.ttl -= dt; if (h.ttl <= 0) { h.remove(); continue; } }
      if (h.target) h.target.getWorldPosition(h.position);
      let f = 1;
      if (h.flicker > 0) {
        const s = h.seed;
        f = 1 + h.flicker * 0.6 * (Math.sin(t * 13 + s) * 0.4 + Math.sin(t * 29.3 + s * 1.7) * 0.35 + Math.sin(t * 5.1 + s * 0.3) * 0.25);
      }
      h.eff = h.enabled ? h.intensity * f * (h.ttl >= 0 ? h.ttl / h.ttl0 : 1) : 0;
      if (h.eff <= 0.01) continue;
      const dx = h.position.x - head.x, dy = h.position.y - head.y, dz = h.position.z - head.z;
      h.score = (h.eff / (1 + dx * dx + dy * dy + dz * dz)) * (h.active ? 1.4 : 1);
      if (cap <= 0) continue;
      if (top.length < cap) top.push(h);
      else if (h.score > top[top.length - 1].score) top[top.length - 1] = h;
      else continue;
      for (let k = top.length - 1; k > 0 && top[k].score > top[k - 1].score; k--) { const x = top[k]; top[k] = top[k - 1]; top[k - 1] = x; }
    }
    for (let i = 0; i < L.length; i++) L[i].active = false;
    for (let i = 0; i < top.length; i++) {
      const l = pool[i], h = top[i];
      l.color.copy(h.color); l.position.copy(h.position);
      l.intensity = h.eff; l.distance = h.distance; l.decay = h.decay;
      h.active = true;
    }
    // unused pooled lights stay in the scene at intensity 0: a constant light count avoids shader recompiles
    for (let i = top.length; i < pool.length; i++) pool[i].intensity = 0;
  }

  // ------------------------------------------------------------------ damage
  // factions: 'enemy' | 'friendly' | 'neutral'. 'player' counts as friendly; anything unknown/unset is neutral.
  const factionOf = (f) => (f === 'player' || f === 'friendly' ? 'friendly' : f === 'enemy' ? 'enemy' : 'neutral');
  const hostile = (a, b) => { a = factionOf(a); b = factionOf(b); return (a === 'enemy' && b === 'friendly') || (a === 'friendly' && b === 'enemy'); };

  // d.hit(amount, point, from, by, kind, direction): kind = 'slash'|'pierce'|'blunt'|'explosion'|'fire'|'frost'|'shock'|'magic' (default
  // 'blunt'), direction = the way the blow travelled (Vector3, optional; derived from point -> centre when missing). `kind` may also be
  // an object { kind, direction, hand } (what kit.hit passes). Handlers read d.lastHit: { kind, amount, point, direction, from, by, hand }.
  function dhit(d, amount, point, from, by, kind, direction) {
    if (!d.alive || d.removed) return false;
    let hand;
    if (kind && typeof kind === 'object') { direction = kind.direction; hand = kind.hand; kind = kind.kind; }
    const L = d.lastHit || (d.lastHit = newInfo()); // (damageables made by an older kit.js lack it)
    L.kind = typeof kind === 'string' ? kind : 'blunt';
    if (d.mul) amount *= d.mul[L.kind] ?? 1; // destructibles resist some kinds of damage
    L.amount = amount; L.from = from; L.by = by; L.hand = hand;
    d.center(_c);
    if (point) L.point.set(point.x, point.y, point.z); else L.point.copy(_c);
    if (direction && (direction.x || direction.y || direction.z)) { L.direction.set(direction.x, direction.y, direction.z).normalize(); L.hasDir = true; }
    else { // no direction given: from the point of impact through the target's centre
      L.direction.set(_c.x - L.point.x, _c.y - L.point.y, _c.z - L.point.z);
      if (L.direction.lengthSq() < 1e-4) L.direction.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      L.direction.y = Math.max(L.direction.y, 0) + 0.15;
      L.direction.normalize(); L.hasDir = false;
    }
    d.hp -= amount; d.flash = 1;
    if (d.gore) safe('gore', impl.goreHit, d, d.hp <= 0);
    if (d.onHit) safe('onHit', d.onHit, { target: d, amount, point, hp: d.hp, from, by, kind: L.kind, direction: L.direction });
    if (d.hp <= 0 && d.alive) die(d);
    return true;
  }
  function die(d) {
    d.hp = 0; d.alive = false;
    if (d.gore) safe('goreKill', impl.goreKill, d);
    if (d.onDeath) safe('onDeath', d.onDeath, d, d.lastHit);
    else { d.dying = 0; d.scale0 = d.object.scale.clone(); }
  }
  impl.dhit = dhit;

  function damageable(c, object, o = {}) {
    const mats = [];
    if (o.flash !== false) {
      object.traverse((m) => {
        for (const mm of [].concat(m.material ?? [])) if (mm.emissive && !mats.some((x) => x.m === mm)) mats.push({ m: mm, e: mm.emissive.clone() });
      });
    }
    const d = {
      object, hp: o.hp ?? 10, maxHp: o.hp ?? 10, radius: o.radius ?? 0.5, offsetY: o.offsetY ?? 0, alive: true, removed: false,
      onHit: o.onHit, onDeath: o.onDeath, mats, flash: 0, dying: -1, scale0: null,
      faction: o.faction, isPlayer: o.isPlayer === true, fighter: null,
      gore: null, box: null, mul: null,
      lastHit: { kind: 'blunt', amount: 0, from: undefined, by: undefined, hand: undefined, point: new Vector3(), direction: new Vector3(0, 0, 1), hasDir: false },
    };
    d.hit = (amount = 1, point, from, by, kind, direction) => impl.dhit(d, amount, point, from, by, kind, direction);
    d.heal = (n = 1) => { if (d.alive) d.hp = Math.min(d.maxHp, d.hp + n); };
    d.center = (out) => { object.getWorldPosition(out); out.y += d.offsetY; return out; };
    d.remove = () => { d.removed = true; dropFrom(reg.damageables, d); };
    d.update = noop;
    reg.damageables.push(d);
    cleanup(c, d.remove);
    if (o.gore !== undefined && !o.noGore) { // gore on a plain object: hit spurts and a death effect by damage kind
      const bb = new THREE.Box3().setFromObject(object), ctr = object.worldToLocal(bb.getCenter(new Vector3()));
      attachGore(d, makeTarget(object, object, { kind: 'generic', limbs: {}, h: Math.max(0.3, bb.max.y - bb.min.y), coreCenter: ctr, bodyCenter: ctr }, { gore: o.gore }));
    }
    return d;
  }
  // distance from point p to the damageable's surface: its box when it has one (walls, buildings), else its sphere (<= 0 inside)
  function surfDist(d, p, clampZero) {
    if (d.box) {
      const m = d.object.matrixWorld.elements, ox = m[12], oy = m[13], oz = m[14], b = d.box;
      const dx = Math.max(ox + b.min.x - p.x, 0, p.x - (ox + b.max.x)), dy = Math.max(oy + b.min.y - p.y, 0, p.y - (oy + b.max.y)), dz = Math.max(oz + b.min.z - p.z, 0, p.z - (oz + b.max.z));
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    d.center(_c);
    const r = Math.sqrt((_c.x - p.x) ** 2 + (_c.y - p.y) ** 2 + (_c.z - p.z) ** 2) - d.radius;
    return clampZero && r < 0 ? 0 : r;
  }
  // A once-per-frame cached world centre per damageable: the broad phase of hit / nearestTarget / damageSweep (Object3D.getWorldPosition walks the
  // whole parent chain on every call, and fighters, projectiles and melee sweeps call these dozens of times a frame). Objects made or moved since
  // the cache was taken are never rejected by more than the 2 m margin; the exact test still decides everything inside it.
  function cacheCenter(d) { d.center(_c); d.cx = _c.x; d.cy = _c.y; d.cz = _c.z; d.cf = state.frameNo; }
  function farOff(d, p, reach) { // true when damageable d (a sphere target) is surely farther than `reach` + its radius from p
    if (d.cf !== state.frameNo) cacheCenter(d);
    const lim = reach + d.radius + 2, ex = d.cx - p.x, ey = d.cy - p.y, ez = d.cz - p.z;
    return ex * ex + ey * ey + ez * ez > lim * lim;
  }
  function stepDamageables(dt) {
    const D = reg.damageables;
    for (let i = D.length - 1; i >= 0; i--) {
      const d = D[i];
      if (d.flash > 0) {
        d.flash = Math.max(0, d.flash - dt * 3.5);
        for (let k = 0; k < d.mats.length; k++) d.mats[k].m.emissive.copy(d.mats[k].e).lerp(_flash, d.flash * 0.8);
      }
      if (d.dying >= 0) {
        d.dying += dt;
        const k = 1 - d.dying / 0.35;
        if (k <= 0) { d.object.removeFromParent(); disposeObject(d.object); d.remove(); continue; }
        d.object.scale.copy(d.scale0).multiplyScalar(ease.out(k));
      }
    }
  }
  const HITO = { kind: 'blunt', direction: undefined, hand: undefined }; // scratch handed to d.hit (read synchronously)
  function hit(point, radius = 1, amount = 1, opts) {
    let n = 0;
    const from = opts && opts.from ? opts.from : undefined, by = opts ? opts.by : undefined, ff = from ? factionOf(from) : null;
    const kind = opts && opts.kind ? opts.kind : 'blunt', dirIn = opts ? opts.direction : undefined, hand = opts ? opts.hand : undefined;
    const D = reg.damageables, frc = opts && opts.force !== undefined ? opts.force : kind === 'explosion' ? amount * 0.6 : kind === 'blunt' ? amount * 0.25 : 0;
    for (let i = D.length - 1; i >= 0; i--) { // backwards: a hit may remove/add damageables (swap-removal) without skipping any
      const d = D[i];
      if (!d || !d.alive) continue;
      if (ff ? factionOf(d.faction) === ff : d.isPlayer) continue; // never hurt the attacker's own side; unattributed hits never hurt the player
      if (!d.box && farOff(d, point, radius)) continue;
      const dist = surfDist(d, point, true); // metres from the point to the target's surface (0 inside)
      if (dist > radius) continue;
      const f = radius > 0 ? 1 - 0.5 * clamp(dist / radius, 0, 1) : 1;
      HITO.kind = kind; HITO.direction = dirIn; HITO.hand = hand;
      const A = d.actor;
      d.hit(amount * f, point, from, by, HITO);
      if (A && !A.dead && !A.removed && frc * f >= 6) knockActor(A, point, frc * f); // strong blows (explosions, hammers, force push) stagger a standing fighter
      n++;
    }
    const B = reg.bodies, force = opts && opts.force !== undefined ? opts.force : amount * 0.5;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.ph || b.held || b.invMass === 0) continue;
      _a.copy(b.position).sub(_t.set(point.x, point.y, point.z));
      const dist = _a.length(), reach = radius + b.radius;
      if (dist > reach) continue;
      const k = Math.min(14, (force * (1 - dist / reach)) / Math.max(b.mass, 0.2));
      _a.y += 0.5 * dist; _a.normalize();
      b.velocity.addScaledVector(_a, k);
    }
    const PHs = PH();
    if (PHs && force > 0) PHs.explode(point, radius, force); // Rapier bodies, debris and ragdolls: one radial impulse
    ctx.events.emit('kit:hit', { point, radius, amount, hits: n, from, by, kind });
    return n;
  }
  function nearestTarget(point, maxDist = 20, opts) {
    let best = null, bd = Infinity;
    const hf = opts && opts.hostileTo ? factionOf(opts.hostileTo) : null, only = opts && opts.faction ? factionOf(opts.faction) : null;
    const D = reg.damageables;
    for (let i = 0; i < D.length; i++) {
      const d = D[i];
      if (!d.alive) continue;
      if (d.isPlayer && !hf && !only) continue; // spells never home on the player unless asked
      if (hf || only) {
        const df = factionOf(d.faction);
        if (hf && !hostile(hf, df)) continue;
        if (only && df !== only) continue;
      }
      if (!d.box && farOff(d, point, Math.min(maxDist, bd))) continue;
      const dist = surfDist(d, point, false);
      if (dist <= maxDist && dist < bd) { bd = dist; best = d; }
    }
    return best;
  }

  // ------------------------------------------------------------------ physics bodies + grab/throw
  function body(c, mesh, o = {}) {
    const root = c.root ?? ctx.root;
    if (o.position) mesh.position.set(o.position.x, o.position.y, o.position.z);
    if (!mesh.parent) root.add(mesh);
    const mass = o.mass ?? 1;
    const b = {
      mesh, root, radius: o.radius ?? 0.2, mass, invMass: mass > 0 && isFinite(mass) ? 1 / mass : 0,
      bounce: o.bounce ?? 0.5, friction: o.friction ?? 0.6, drag: o.drag ?? 0.05, gravity: o.gravity ?? 9.8,
      grabbable: !!o.grabbable, grabRange: o.grabRange ?? 0, damage: o.damage ?? 0, roll: o.roll !== false, from: o.from, dmgKind: o.damageKind ?? 'blunt',
      position: mesh.position.clone(), velocity: new Vector3(), hold: new Vector3(), held: null, grounded: false,
      cool: 0, removed: false, handlers: { hit: [], grab: [], release: [] },
    };
    b.onHit = (fn) => { b.handlers.hit.push(fn); return b; };
    b.onGrab = (fn) => { b.handlers.grab.push(fn); return b; };
    b.onRelease = (fn) => { b.handlers.release.push(fn); return b; };
    b.applyImpulse = (x, y, z) => {
      if (b.ph) { if (b.invMass) b.ph.applyImpulse(x, y, z); return b; }
      if (b.invMass) b.velocity.x += x * b.invMass, b.velocity.y += y * b.invMass, b.velocity.z += z * b.invMass;
      return b;
    };
    b.update = noop;
    b.remove = () => {
      if (b.removed) return;
      b.removed = true; dropFrom(reg.bodies, b); b.held = null;
      if (b.ph) { b.ph.user = null; b.ph.remove(); b.ph = null; }
      mesh.removeFromParent(); disposeObject(mesh);
      mesh.traverse((m) => m.geometry?.dispose?.());
    };
    reg.bodies.push(b);
    cleanup(c, b.remove);
    physAttach(b, c, mesh, o);
    return b;
  }

  // ---- Rapier backing (core/physics.js). With world.physics present a kit body is a Rapier body; without it (or over its budget) the
  // hand-rolled simulation below runs exactly as before. b.position / b.velocity stay plain Vector3s that others may read AND write:
  // writes made between frames are detected in syncPhysBody and pushed into Rapier.
  const PH = () => { const p = ctx.world.physics; return p && p.ready ? p : null; };
  function physAttach(b, c, mesh, o) {
    const P = PH();
    if (!P || o.physics === false) return;
    const fixed = !(b.invMass > 0);
    const shape = o.shape && o.shape !== 'sphere' ? o.shape : 'sphere';
    const boxy = shape !== 'sphere';
    const rotate = o.rotate !== undefined ? !!o.rotate : boxy ? true : b.roll;
    const size = o.size !== undefined ? o.size : shape === 'sphere' ? b.radius : undefined;
    mesh.updateWorldMatrix(true, false);
    const h = P.body({ root: b.root }, mesh, {
      shape, size, mass: fixed ? 1 : b.mass, friction: b.friction, restitution: Math.min(0.95, b.bounce), linearDamping: b.drag, type: fixed ? 'fixed' : 'dynamic',
      rotate, ccd: o.ccd ?? (!fixed && b.radius < 0.45 && (b.grabbable || b.damage > 0)), group: o.group, position: b.position, angularDamping: o.angularDamping,
    });
    if (!h) return; // over the physics budget: this body runs on the old simulation
    b.ph = h; h.user = b; b.shape = shape;
    b._held = false; b._g = b.gravity; b._d = b.drag; b._mode = fixed ? 'fixed' : 'dynamic';
    b._px = b.position.x; b._py = b.position.y; b._pz = b.position.z; b._vx = b._vy = b._vz = 0;
    if (b.gravity !== 9.8) h.setGravityScale(b.gravity / 9.8);
    h.onContact(bodyContactRelay);
  }
  function bodyContactRelay(e) { impl.bodyContact(e); } // indirection so a reloaded kit.js takes over bodies made by an older one
  // physics contact -> the old kit.body hit event ('ground' | 'body'; scenery counts as 'ground' with e.static = true)
  impl.bodyContact = (e) => {
    const b = e.self && e.self.user;
    if (!b || b.removed || !b.handlers.hit.length) return;
    const o = e.other && e.other.user ? e.other.user : null;
    fire(b, 'hit', { kind: o ? 'body' : 'ground', speed: e.speed, other: o || undefined, point: e.point.clone(), normal: e.normal.clone(), static: e.kind === 'static' });
  };
  function fire(b, type, e) {
    const fs = b.handlers[type];
    // hit handlers get the event; grab/release handlers get the hand name ('left'|'right') then the event
    for (let i = 0; i < fs.length; i++) safe(`body ${type} handler`, fs[i], type === 'hit' ? e : e.hand, e);
  }
  // controller buzz; silently nothing for bare hands / desktop
  function haptic(hand, strength = 0.4, ms = 40) {
    const h = ctx.input && ctx.input[hand];
    if (h && typeof h.pulse === 'function') { try { h.pulse(strength, ms); } catch (err) { /* no haptics */ } }
  }

  function stepOne(b, dt) {
    const v = b.velocity, p = b.position;
    v.y -= b.gravity * dt;
    if (b.drag > 0) v.multiplyScalar(Math.exp(-b.drag * dt));
    p.addScaledVector(v, dt);
    b.cool -= dt;
    const gy = groundAt(p.x, p.z);
    b.grounded = false;
    if (p.y - b.radius < gy) {
      p.y = gy + b.radius;
      const gx = (groundAt(p.x + 0.3, p.z) - groundAt(p.x - 0.3, p.z)) / 0.6;
      const gz = (groundAt(p.x, p.z + 0.3) - groundAt(p.x, p.z - 0.3)) / 0.6;
      _n.set(-gx, 1, -gz).normalize();
      const vn = v.dot(_n);
      if (vn < 0) {
        if (-vn > 0.8 && b.handlers.hit.length) fire(b, 'hit', { kind: 'ground', speed: -vn, point: p.clone().addScaledVector(_n, -b.radius), normal: _n.clone() });
        v.addScaledVector(_n, -(-vn < 0.6 ? 1 : 1 + b.bounce) * vn); // tiny impacts just stop (no endless micro-bounce)
      }
      b.grounded = true;
      const vn2 = v.dot(_n); // rolling friction on the tangential part
      const fk = Math.exp(-b.friction * dt);
      v.x = _n.x * vn2 + (v.x - _n.x * vn2) * fk; v.y = _n.y * vn2 + (v.y - _n.y * vn2) * fk; v.z = _n.z * vn2 + (v.z - _n.z * vn2) * fk;
      if (gx * gx + gz * gz < 0.015) { // gentle slope: slow rolls settle instead of creeping downhill forever
        const s2 = v.lengthSq();
        if (s2 < 0.04) v.set(0, 0, 0); else if (s2 < 0.5) v.multiplyScalar(Math.exp(-5 * dt));
      }
    }
    damageSweep(b);
  }
  function ownDamageable(b, d) { // d.object is b.mesh, an ancestor of it, or one of its descendants
    const m = b.mesh, o = d.object;
    if (!m || !o) return false;
    if (m === o) return true;
    for (let p = m.parent; p; p = p.parent) if (p === o) return true;
    for (let p = o.parent; p; p = p.parent) if (p === m) return true;
    return false;
  }
  // a fast body that touches a damageable bounces off it and (with damage > 0) hurts it. Returns true when it changed the velocity.
  function damageSweep(b) {
    const v = b.velocity, p = b.position, sp2 = v.lengthSq();
    if (!(sp2 > 9 && b.cool <= 0)) return false;
    const D = reg.damageables;
    for (let i = 0; i < D.length; i++) {
      const d = D[i];
      if (!d.alive) continue;
      if (d.isPlayer) continue; // your own thrown things pass through you
      if (farOff(d, p, b.radius)) continue;
      if (ownDamageable(b, d)) continue; // a body never bounces off the damageable that IS (or contains / is part of) itself
      d.center(_c);
      const dx = p.x - _c.x, dy = p.y - _c.y, dz = p.z - _c.z, r = b.radius + d.radius;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      const speed = Math.sqrt(sp2);
      _n.set(dx, dy, dz).normalize();
      v.addScaledVector(_n, -1.4 * v.dot(_n));
      b.cool = 0.3;
      if (b.damage > 0 && !(b.from && factionOf(d.faction) === factionOf(b.from))) d.hit((b.damage * speed) / 6, p, b.from, undefined, b.dmgKind, v);
      if (b.handlers.hit.length) fire(b, 'hit', { kind: 'damageable', speed, point: p.clone(), normal: _n.clone(), target: d });
      return true;
    }
    return false;
  }

  const _pq = new Quaternion();
  function syncPhysBody(b, dt) {
    const ph = b.ph;
    if (ph.removed) { b.ph = null; b.remove(); return; } // the physics world dropped it (fell out of the world)
    b.cool -= dt;
    const want = b.held ? 'kinematic' : b.invMass === 0 ? 'fixed' : 'dynamic';
    if (want !== ph.type) {
      if (want === 'dynamic') {
        ph.setType('dynamic');
        b.mesh.updateWorldMatrix(true, false); b.mesh.getWorldQuaternion(_pq);
        ph.setTransform(b.position, ph.rotate ? _pq : undefined);
        ph.setVelocity(b.velocity);
        ph.wake();
      } else if (want === 'kinematic') ph.setType('kinematic');
      else { ph.setType('fixed'); ph.setTransform(b.position); }
      b._px = b.position.x; b._py = b.position.y; b._pz = b.position.z;
    }
    if (want === 'kinematic') { // held (by a hand, a weapon grip, telekinesis ...): the body follows b.position and the mesh's orientation
      b.mesh.updateWorldMatrix(true, false); b.mesh.getWorldQuaternion(_pq);
      ph.follow(b.position, _pq);
      return;
    }
    if (want === 'fixed') {
      if (Math.abs(b.position.x - b._px) + Math.abs(b.position.y - b._py) + Math.abs(b.position.z - b._pz) > 1e-6) { ph.setTransform(b.position); b._px = b.position.x; b._py = b.position.y; b._pz = b.position.z; }
      return;
    }
    const v = b.velocity, p = b.position;
    if (v.x !== b._vx || v.y !== b._vy || v.z !== b._vz) { ph.setVelocity(v); ph.wake(); }          // someone wrote b.velocity
    if (Math.abs(p.x - b._px) + Math.abs(p.y - b._py) + Math.abs(p.z - b._pz) > 1e-6) { ph.setTransform(p); ph.wake(); } // ... or b.position
    if (b.gravity !== b._g) { b._g = b.gravity; ph.setGravityScale(b.gravity / 9.8); }
    if (b.drag !== b._d) { b._d = b.drag; ph.linDamp = b.drag; ph.setDamping(b.drag); }
    if (damageSweep(b)) ph.setVelocity(v);
    p.copy(ph.position); v.copy(ph.velocity);
    b._px = p.x; b._py = p.y; b._pz = p.z; b._vx = v.x; b._vy = v.y; b._vz = v.z;
    b.grounded = ph.contacts > 0 && Math.abs(v.y) < 1.6;
  }

  function stepBodies(dt) {
    const B = reg.bodies;
    for (let i = B.length - 1; i >= 0; i--) {
      const b = B[i];
      if (b.ph) { if (PH()) safe('body sync', syncPhysBody, b, dt); continue; }
      if (b.held || b.invMass === 0) continue;
      try {
        const sp = b.velocity.length();
        const n = clamp(Math.ceil((sp * dt) / Math.max(0.05, b.radius)), 1, 4);
        for (let k = 0; k < n; k++) stepOne(b, dt / n);
      } catch (err) { console.error('[kit] body step failed; removing', err); b.remove(); }
    }
    for (let i = 0; i < B.length; i++) {
      const A = B[i];
      if (!A || A.ph) continue;
      for (let j = i + 1; j < B.length; j++) {
        const Bb = B[j];
        if (!Bb || Bb.ph) continue;
        const r = A.radius + Bb.radius;
        const dx = Bb.position.x - A.position.x, dy = Bb.position.y - A.position.y, dz = Bb.position.z - A.position.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r || d2 < 1e-10) continue;
        const wa = A.held ? 0 : A.invMass, wb = Bb.held ? 0 : Bb.invMass, ws = wa + wb;
        if (ws === 0) continue;
        const dist = Math.sqrt(d2), nx = dx / dist, ny = dy / dist, nz = dz / dist, ov = r - dist;
        A.position.x -= nx * ov * wa / ws; A.position.y -= ny * ov * wa / ws; A.position.z -= nz * ov * wa / ws;
        Bb.position.x += nx * ov * wb / ws; Bb.position.y += ny * ov * wb / ws; Bb.position.z += nz * ov * wb / ws;
        const vn = (Bb.velocity.x - A.velocity.x) * nx + (Bb.velocity.y - A.velocity.y) * ny + (Bb.velocity.z - A.velocity.z) * nz;
        if (vn >= 0) continue;
        const e = -vn < 0.5 ? 0 : (A.bounce + Bb.bounce) * 0.5, jn = (-(1 + e) * vn) / ws;
        A.velocity.x -= nx * jn * wa; A.velocity.y -= ny * jn * wa; A.velocity.z -= nz * jn * wa;
        Bb.velocity.x += nx * jn * wb; Bb.velocity.y += ny * jn * wb; Bb.velocity.z += nz * jn * wb;
        if (-vn > 0.8) {
          if (A.handlers.hit.length) fire(A, 'hit', { kind: 'body', speed: -vn, other: Bb, point: _a.copy(A.position).addScaledVector(_n.set(nx, ny, nz), A.radius).clone() });
          if (Bb.handlers.hit.length) fire(Bb, 'hit', { kind: 'body', speed: -vn, other: A, point: _a.copy(Bb.position).addScaledVector(_n.set(-nx, -ny, -nz), Bb.radius).clone() });
        }
      }
    }
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.ph || b.held || b.invMass === 0) continue;
      b.mesh.position.copy(b.position);
      if (b.roll && b.grounded) {
        const s = Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.z * b.velocity.z);
        if (s > 0.05) { _a.set(b.velocity.z / s, 0, -b.velocity.x / s); b.mesh.rotateOnWorldAxis(_a, (s * dt) / b.radius); }
      }
    }
  }

  const HANDS = ['left', 'right'];
  const mkGrab = () => ({ body: null, vel: new Vector3(), prev: new Vector3(), has: false });
  const grab = { left: mkGrab(), right: mkGrab() };

  function releaseBody(g, throwIt) {
    const b = g.body; g.body = null;
    if (!b) return;
    const name = b.held;
    b.held = null;
    if (b.removed) return;
    b.mesh.updateWorldMatrix(true, false);
    b.root.attach(b.mesh); // keeps the world transform
    b.position.copy(b.mesh.position);
    if (throwIt) {
      b.velocity.copy(g.vel).multiplyScalar(1.1);
      const s = b.velocity.length();
      if (s > 18) b.velocity.multiplyScalar(18 / s);
    } else b.velocity.set(0, 0, 0);
    if (b.handlers.release.length) fire(b, 'release', { hand: name, velocity: b.velocity });
  }
  function tryGrab(name, h, g) {
    let best = null, bd = Infinity;
    const B = reg.bodies;
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (!b.grabbable || b.held) continue;
      const d = b.position.distanceTo(h.position) - b.radius;
      if (d < 0.18 && d < bd) { bd = d; best = b; }
    }
    if (!best) {
      bd = Infinity;
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        if (!b.grabbable || b.held || !(b.grabRange > 0)) continue;
        _a.copy(b.position).sub(h.position);
        const along = _a.dot(h.direction);
        if (along < 0 || along > b.grabRange) continue;
        const perp = _a.lengthSq() - along * along, reach = b.radius + 0.3;
        if (perp < reach * reach && perp < bd) { bd = perp; best = b; }
      }
    }
    if (!best) return;
    best.held = name; g.body = best;
    h.anchor.updateWorldMatrix(true, false);
    h.anchor.attach(best.mesh); // reparent to the hand: no lag while the player walks or turns
    best.hold.set(0, 0, -Math.min(best.radius * 0.7, 0.2));
    best.velocity.set(0, 0, 0);
    haptic(name, 0.25, 25);
    if (best.handlers.grab.length) fire(best, 'grab', { hand: name });
  }
  function stepGrab(dt) {
    for (let hi = 0; hi < 2; hi++) {
      const name = HANDS[hi], h = ctx.input[name], g = grab[name];
      if (g.body && g.body.removed) g.body = null;
      if (!h || !h.connected) { if (g.body) releaseBody(g, false); g.has = false; continue; }
      if (g.has && dt > 0) {
        const ix = (h.position.x - g.prev.x) / dt, iy = (h.position.y - g.prev.y) / dt, iz = (h.position.z - g.prev.z) / dt;
        if (ix * ix + iy * iy + iz * iz < 1600) { // ignore teleport / snap-turn spikes
          const k = 1 - Math.exp(-dt * 20);
          g.vel.x += (ix - g.vel.x) * k; g.vel.y += (iy - g.vel.y) * k; g.vel.z += (iz - g.vel.z) * k;
        }
      } else g.vel.set(0, 0, 0);
      g.prev.copy(h.position); g.has = true;
      if (!g.body) { if (h.pressed('squeeze')) tryGrab(name, h, g); }
      else if (!h.down.squeeze) { releaseBody(g, true); continue; }
      if (g.body) {
        const b = g.body;
        b.mesh.position.lerp(b.hold, 1 - Math.exp(-22 * dt));
        b.position.copy(h.position).addScaledVector(h.direction, -b.hold.z);
        b.velocity.copy(g.vel);
      }
    }
  }
  // objects held by a previous version of this file: drop them cleanly
  for (const b of reg.bodies) {
    if (b.held && !b.removed) { b.mesh.updateWorldMatrix(true, false); b.root.attach(b.mesh); b.position.copy(b.mesh.position); b.held = null; }
  }

  // ------------------------------------------------------------------ labels
  // Painted text in the world: one painter, four looks (o.style, else picked from the text): 'bubble' (parchment, dark ink, a tail; actor.say), 'plate' (dark walnut, brass rim,
  // parchment text; names and captions, the default), 'float' (outlined warm numerals, chosen for text like "-14"; damage numbers) and 'plain' (background:false: bare text for signs).
  // One pooled canvas texture per label, painted when its text or page changes; per frame only scale and opacity move. Letters grow with the distance so a capital stays about 1.2 deg
  // tall (bubble up to 2.2x, plate 1.8x, float 2x); plates fade in within ~8 m and only while looked at; bubbles fade out beyond ~26 m; all of it hides while a menu panel is open.
  const LB = (state.lbl ??= { list: [], pool: [], t: 0 });
  const LFONT = 'Candara, "Segoe UI", "Gill Sans MT", "Gill Sans", Optima, "Trebuchet MS", system-ui, Roboto, Arial, sans-serif';
  const LK = { bubble: { px: 40, maxK: 2.2 }, plate: { px: 38, maxK: 1.8 }, float: { px: 56, maxK: 2 }, plain: { px: 44, maxK: 1 } };
  const labelStyle = (t, o) => (o.style && LK[o.style] ? o.style : o.background === false ? 'plain' : /^[+\-−]?\d+(\.\d+)?!?$/.test(t.trim()) ? 'float' : 'plate');
  const sstep = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
  function takeCanvas() {
    const e = LB.pool.pop();
    if (e) return e;
    const cv = document.createElement('canvas'), tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    return { cv, g: cv.getContext('2d'), tex };
  }
  const giveCanvas = (e) => { if (LB.pool.length < 24) LB.pool.push(e); else e.tex.dispose(); };
  function wrapChars(t, max) { // greedy words, at most `max` characters a line, a longer word is cut
    const lines = [];
    let line = '';
    for (let w of String(t).split(/\s+/)) {
      if (!w) continue;
      while (w.length > max) { if (line) { lines.push(line); line = ''; } lines.push(w.slice(0, max)); w = w.slice(max); }
      const test = line ? line + ' ' + w : w;
      if (line && test.length > max) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }
  function wrapPx(g, t, maxW) {
    const lines = [];
    let line = '';
    for (const w of String(t).split(/\s+/)) {
      if (!w) continue;
      const test = line ? line + ' ' + w : w;
      if (line && g.measureText(test).width > maxW) { lines.push(line); line = w; } else line = test;
    }
    lines.push(line);
    return lines;
  }
  function rr(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  const brass = (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#f0d089'); gr.addColorStop(0.5, '#8a6226'); gr.addColorStop(1, '#c99a4e'); return gr; };
  function paintLabel(l) {
    const st = l.st, K = LK[st], PX = K.px, e = l.e, g = e.g, cv = e.cv, size = l.size;
    let lines, W, H, cen = 0;
    if (st === 'bubble') {
      const LH = 52, PADX = 28, TOP = 18, BOT = 20, TAIL = 26, M = 14, pg = l.pages;
      lines = pg[Math.min(l.page, pg.length - 1)].slice();
      if (pg.length > 1) { if (l.page < pg.length - 1) lines[lines.length - 1] += ' …'; if (l.page > 0) lines[0] = '… ' + lines[0]; }
      g.font = `600 ${PX}px ${LFONT}`;
      let widest = 0; for (const s of lines) widest = Math.max(widest, g.measureText(s).width);
      const bw = Math.ceil(widest + PADX * 2), bh = lines.length * LH + TOP + BOT;
      W = bw + M * 2; H = bh + TAIL + M * 2;
      if (W !== cv.width || H !== cv.height) { cv.width = W; cv.height = H; e.tex.dispose(); }
      g.clearRect(0, 0, W, H);
      const x = M, y = M, r = 24, tx = W / 2, tw = 15;
      const path = () => {
        g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + bw - r, y); g.arcTo(x + bw, y, x + bw, y + r, r); g.lineTo(x + bw, y + bh - r); g.arcTo(x + bw, y + bh, x + bw - r, y + bh, r);
        g.lineTo(tx + tw, y + bh); g.quadraticCurveTo(tx + 3, y + bh + TAIL * 0.35, tx, y + bh + TAIL); g.quadraticCurveTo(tx - 4, y + bh + TAIL * 0.3, tx - tw, y + bh);
        g.lineTo(x + r, y + bh); g.arcTo(x, y + bh, x, y + bh - r, r); g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
      };
      g.lineJoin = 'round';
      g.save(); g.shadowColor = 'rgba(40,24,8,0.45)'; g.shadowBlur = 11; g.shadowOffsetY = 3;
      const fill = g.createLinearGradient(0, y, 0, y + bh); fill.addColorStop(0, '#f8edd0'); fill.addColorStop(1, '#ecdcb6');
      path(); g.fillStyle = fill; g.fill(); g.restore();
      const vg = g.createRadialGradient(W / 2, y + bh / 2, bh * 0.25, W / 2, y + bh / 2, Math.max(bw, bh) * 0.62);
      vg.addColorStop(0, 'rgba(170,125,60,0)'); vg.addColorStop(1, 'rgba(170,125,60,0.20)');
      path(); g.fillStyle = vg; g.fill();
      path(); g.lineWidth = 3.5; g.strokeStyle = brass(g, W, H); g.stroke();
      rr(g, x + 7, y + 7, bw - 14, bh - 14, r - 6); g.lineWidth = 1; g.strokeStyle = 'rgba(150,105,45,0.32)'; g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#3a2714'; g.font = `600 ${PX}px ${LFONT}`;
      for (let i = 0; i < lines.length; i++) g.fillText(lines[i], W / 2, y + TOP + LH * (i + 0.5) + 1);
      cen = M / H;
    } else if (st === 'plate') {
      const LH = 46, PADX = 24, PADY = 12, M = 10;
      g.font = `600 ${PX}px ${LFONT}`;
      lines = wrapPx(g, l.text, l.maxW);
      let widest = 0; for (const s of lines) widest = Math.max(widest, g.measureText(s).width);
      const bw = Math.ceil(widest + PADX * 2), bh = lines.length * LH + PADY * 2;
      W = bw + M * 2; H = bh + M * 2;
      if (W !== cv.width || H !== cv.height) { cv.width = W; cv.height = H; e.tex.dispose(); }
      g.clearRect(0, 0, W, H);
      g.lineJoin = 'round';
      g.save(); g.shadowColor = 'rgba(16,8,2,0.5)'; g.shadowBlur = 8; g.shadowOffsetY = 2;
      const fill = g.createLinearGradient(0, M, 0, M + bh); fill.addColorStop(0, l.bg ?? 'rgba(62,44,29,0.95)'); fill.addColorStop(1, l.bg ?? 'rgba(34,23,14,0.95)');
      rr(g, M, M, bw, bh, 15); g.fillStyle = fill; g.fill(); g.restore();
      rr(g, M, M, bw, bh, 15); g.lineWidth = 3; g.strokeStyle = brass(g, W, H); g.stroke();
      rr(g, M + 6, M + 6, bw - 12, bh - 12, 10); g.lineWidth = 1; g.strokeStyle = 'rgba(240,208,137,0.24)'; g.stroke();
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 ${PX}px ${LFONT}`;
      g.fillStyle = 'rgba(10,5,0,0.55)'; for (let i = 0; i < lines.length; i++) g.fillText(lines[i], W / 2 + 1.5, M + PADY + LH * (i + 0.5) + 2.5);
      g.fillStyle = l.color; for (let i = 0; i < lines.length; i++) g.fillText(lines[i], W / 2, M + PADY + LH * (i + 0.5) + 1);
      cen = M / H;
    } else if (st === 'float') {
      const LH = 66, M = 16;
      g.font = `700 ${PX}px ${LFONT}`;
      lines = wrapPx(g, l.text, l.maxW);
      let widest = 0; for (const s of lines) widest = Math.max(widest, g.measureText(s).width);
      W = Math.ceil(widest + M * 2); H = lines.length * LH + M * 2;
      if (W !== cv.width || H !== cv.height) { cv.width = W; cv.height = H; e.tex.dispose(); }
      g.clearRect(0, 0, W, H);
      g.lineJoin = 'round'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${PX}px ${LFONT}`;
      g.save(); g.shadowColor = 'rgba(30,16,4,0.55)'; g.shadowBlur = 8; g.shadowOffsetY = 3; g.lineWidth = 10; g.strokeStyle = 'rgba(44,26,10,0.9)';
      for (let i = 0; i < lines.length; i++) g.strokeText(lines[i], W / 2, M + LH * (i + 0.5)); g.restore();
      g.fillStyle = l.color; for (let i = 0; i < lines.length; i++) g.fillText(lines[i], W / 2, M + LH * (i + 0.5));
      cen = 0.1;
    } else { // plain
      const LH = Math.round(PX * 1.2), PAD = 16;
      g.font = `600 ${PX}px ${LFONT}`;
      lines = wrapPx(g, l.text, l.maxW);
      let widest = 0; for (const s of lines) widest = Math.max(widest, g.measureText(s).width);
      W = Math.ceil(widest + PAD * 2); H = lines.length * LH + PAD * 2;
      if (W !== cv.width || H !== cv.height) { cv.width = W; cv.height = H; e.tex.dispose(); }
      g.clearRect(0, 0, W, H);
      g.font = `600 ${PX}px ${LFONT}`; g.fillStyle = l.color; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let i = 0; i < lines.length; i++) g.fillText(lines[i], W / 2, PAD + PX * 0.6 + i * LH);
    }
    e.tex.needsUpdate = true;
    l.uw = (W / PX) * size; l.uh = (H / PX) * size;
    l.sprite.center.set(0.5, cen);
    l.sprite.scale.set(l.uw * l.k, l.uh * l.k, 1);
  }
  function makeLabel(c, text, o, parent) {
    const size = o.size ?? 0.12, e = takeCanvas();
    const mat = new THREE.SpriteMaterial({ map: e.tex, transparent: true, depthWrite: false, depthTest: o.depthTest ?? true, fog: false, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 20; sprite.userData.noShadow = sprite.userData.noOutline = true;
    const col = '#' + new Color(o.color ?? 0xffffff).getHexString();
    const white = col === '#ffffff';
    const l = {
      sprite, object: sprite, position: sprite.position, removed: false, update: noop, size, e, st: 'plate', text: '', maxW: o.maxWidth ?? 560, color: col, bg: typeof o.background === 'string' ? o.background : null,
      pages: [['']], page: 0, span: 0, t0: 0, uw: 1, uh: 1, k: 1, alpha: 0, want: true, blank: true,
      set(t, so) {
        t = String(t);
        const st = labelStyle(t, o);
        if (t === l.text && st === l.st && !so) return;
        l.text = t; l.blank = !t.trim(); l.page = 0; l.t0 = LB.t;
        if (so && so.span > 0) l.span = so.span;
        if (st !== l.st && st === 'float') mat.opacity = 1;
        l.st = st;
        l.color = st === 'plate' && white ? '#f6ead2' : st === 'float' && white ? '#ffe3a0' : col;
        if (st === 'bubble') { const ls = wrapChars(t, 28); l.pages = []; for (let i = 0; i < ls.length; i += 3) l.pages.push(ls.slice(i, i + 3)); }
        paintLabel(l);
      },
      show(v = true) { l.want = !!v; if (v) sprite.visible = true; else if (l.st === 'float' || l.st === 'plain') sprite.visible = false; },
      remove() {
        if (l.removed) return;
        l.removed = true; dropFrom(LB.list, l); sprite.removeFromParent(); mat.dispose();
        if (l.e) { giveCanvas(l.e); l.e = null; }
      },
    };
    l.set(text, o.style === 'bubble' ? { span: o.span } : undefined);
    if (l.st === 'float') mat.opacity = 1; else mat.opacity = 0;
    parent.add(sprite);
    LB.list.push(l);
    return l;
  }
  const _eye = new Vector3(), _gz = new Vector3(), _lp = new Vector3();
  function stepLabels(dt) {
    const L = LB.list;
    LB.t += dt;
    if (!L.length) return;
    const cam = ctx.camera;
    if (!cam) return;
    cam.getWorldPosition(_eye); cam.getWorldDirection(_gz);
    const menuOpen = !!(ctx.world && ctx.world.menu && ctx.world.menu.isOpen);
    for (let i = L.length - 1; i >= 0; i--) {
      const l = L[i];
      if (l.removed) { L.splice(i, 1); continue; }
      const sp = l.sprite, st = l.st;
      sp.getWorldPosition(_lp);
      const dx = _lp.x - _eye.x, dy = _lp.y - _eye.y, dz = _lp.z - _eye.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
      if (st === 'plain') continue;
      const K = LK[st], em = Math.max(l.size, d * 0.0299), k = Math.min(K.maxK, em / l.size);
      if (Math.abs(k - l.k) > 0.004) { l.k = k; sp.scale.set(l.uw * k, l.uh * k, 1); }
      if (st === 'float') { if (menuOpen && sp.visible) sp.visible = false; else if (!menuOpen && l.want && !sp.visible) sp.visible = true; continue; }
      let target = l.want && !l.blank && !menuOpen ? 1 : 0;
      if (target) {
        if (st === 'plate') target = (1 - sstep((d - 6.5) / 2)) * sstep(((dx * _gz.x + dy * _gz.y + dz * _gz.z) / d - 0.574) / 0.31);
        else target = 1 - sstep((d - 18) / 8);
      }
      l.alpha += (target - l.alpha) * (1 - Math.exp(-dt * (target > l.alpha ? 14 : 5)));
      if (l.alpha < 0.01 && target === 0) { l.alpha = 0; sp.visible = false; } else { sp.visible = true; sp.material.opacity = l.alpha; }
      if (st === 'bubble' && l.pages.length > 1 && l.span > 0) { // long speech turns its pages in step with the line
        const np = Math.min(l.pages.length - 1, Math.max(0, Math.floor(((LB.t - l.t0) / l.span) * l.pages.length)));
        if (np !== l.page) { l.page = np; paintLabel(l); }
      }
    }
  }
  function label(c, text, o = {}) {
    const l = makeLabel(c, text, o, o.parent ?? c.root ?? ctx.root);
    if (o.position) l.position.set(o.position.x, o.position.y, o.position.z);
    cleanup(c, l.remove);
    return l;
  }

  // ------------------------------------------------------------------ sound
  let voices = 0;
  function noiseBuffer(ac) {
    let nb = state.noise;
    if (!nb || nb.ctx !== ac) {
      const buf = ac.createBuffer(1, (ac.sampleRate * 2) | 0, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      state.noise = nb = { ctx: ac, buf };
    }
    return nb.buf;
  }
  function sound(c, so = {}) {
    const audio = c.audio ?? ctx.audio, ac = audio?.context, out = audio?.listener?.getInput?.() ?? ac?.destination;
    if (!ac || !out) return { tone: noop, noise: noop, chord: noop };
    const master = so.volume ?? 1, live = new Set();
    let dead = false;
    cleanup(c, () => { dead = true; for (const s of live) { try { s.stop(); } catch (e) { /* already stopped */ } } live.clear(); });

    // src -> [filter ->] env -> [panner ->] out
    function play(o, src, dur, filter) {
      if (dead || voices >= 24) return;
      if (ac.state === 'suspended') ac.resume?.();
      const t0 = ac.currentTime + (o.delay || 0);
      const env = ac.createGain(), vol = Math.max(0.0002, (o.vol ?? 0.3) * master);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(vol, t0 + Math.min(o.attack ?? 0.004, dur * 0.5));
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let panner = null;
      src.connect(filter ?? env);
      if (filter) filter.connect(env);
      if (o.at) {
        panner = ac.createPanner();
        panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
        panner.refDistance = 1.5; panner.rolloffFactor = 1.1; panner.maxDistance = 200;
        if (panner.positionX) { panner.positionX.value = o.at.x; panner.positionY.value = o.at.y; panner.positionZ.value = o.at.z; }
        else panner.setPosition(o.at.x, o.at.y, o.at.z);
        env.connect(panner); panner.connect(out);
      } else env.connect(out);
      voices++; live.add(src);
      src.onended = () => {
        voices--; live.delete(src);
        try { src.disconnect(); filter?.disconnect(); env.disconnect(); panner?.disconnect(); } catch (e) { /* ignore */ }
      };
      return t0;
    }
    const tone = (o = {}) => {
      const dur = o.dur ?? 0.3, osc = ac.createOscillator();
      osc.type = o.type ?? 'sine';
      const t0 = ac.currentTime + (o.delay || 0), f = o.freq ?? 440;
      osc.frequency.setValueAtTime(f, t0);
      if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + dur);
      if (play(o, osc, dur) !== undefined) { osc.start(t0); osc.stop(t0 + dur + 0.05); }
    };
    return {
      tone,
      noise(o = {}) {
        const dur = o.dur ?? 0.2, src = ac.createBufferSource(), fo = o.filter ?? {}, f = ac.createBiquadFilter();
        src.buffer = noiseBuffer(ac); src.loop = true;
        const t0 = ac.currentTime + (o.delay || 0), f0 = fo.freq ?? 1000;
        f.type = fo.type ?? 'lowpass'; f.Q.value = fo.q ?? 1;
        f.frequency.setValueAtTime(f0, t0);
        if (fo.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(10, fo.freqEnd), t0 + dur);
        if (play(o, src, dur, f) !== undefined) { src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05); }
      },
      chord(freqs, o = {}) {
        const n = freqs.length, st = o.stagger ?? 0.06;
        for (let i = 0; i < n; i++) tone({ ...o, freq: freqs[i], vol: (o.vol ?? 0.3) / Math.sqrt(n), delay: (o.delay || 0) + i * st, dur: o.dur ?? 0.8 });
      },
    };
  }

  // ------------------------------------------------------------------ explosion
  const fxCache = new WeakMap();
  function explosion(c, p, o = {}) {
    const size = o.size ?? 1.5, scale = size / 1.5, key = new Color(o.color ?? 0xff7a1a).getHex();
    let m = fxCache.get(c);
    if (!m) {
      m = { colors: new Map(), smoke: null, snd: sound(c) };
      m.smoke = particles(c, { count: 60, additive: false, color: [0x585858, 0x1c1c1c], alpha: 0.55, size: [0.5, 1.7], life: [1.2, 2.2], speed: [0.5, 1.6], gravity: -0.8, drag: 1.2 });
      fxCache.set(c, m);
    }
    let f = m.colors.get(key);
    if (!f) {
      const hot = new Color(key).lerp(new Color(1, 1, 1), 0.6);
      f = {
        fire: particles(c, { count: 120, color: [hot, key], size: [0.8, 0.25], life: [0.3, 0.65], speed: [1.5, 4], gravity: -1.5, drag: 2.2, spread: 0.12 }),
        sparks: particles(c, { count: 90, color: [hot, key], size: [0.08, 0.02], life: [0.5, 1.1], speed: [3, 9], gravity: 9, drag: 0.4 }),
      };
      m.colors.set(key, f);
    }
    f.fire.emit(p, Math.round(12 + 10 * scale), undefined, scale);
    f.sparks.emit(p, Math.round(10 + 8 * scale), undefined, scale);
    m.smoke.emit(p, Math.round(4 + 3 * scale), undefined, scale);
    flash(c, p, { color: key, intensity: 30 * size, distance: 6 + 4 * size, duration: 0.35 });
    m.snd.noise({ dur: 0.55, filter: { type: 'lowpass', freq: 1400, freqEnd: 90, q: 0.8 }, vol: 0.7, at: p, attack: 0.003 });
    m.snd.tone({ freq: 120, freqEnd: 32, dur: 0.5, vol: 0.6, at: p });
    if (o.damage) hit(p, o.radius ?? size, o.damage, { from: o.from, by: o.by, kind: o.kind ?? 'explosion', direction: o.direction });
    // ground marks (purely visual): a scorch where it burned the earth, a crater for the big ones
    if (p.y - groundAt(p.x, p.z) < size * 1.4 + 0.5 && o.scorch !== false) {
      scorch(p, size * 0.9, { color: o.scorchColor });
      if (size >= 3) crater(p, size * 0.55);
    }
  }

  // ------------------------------------------------------------------ gore + destruction: settings, shared effects, pooled systems
  // Everything here is pooled (parts, debris, decals, bleeds) and keeps its data in ctx.state, so a hot-reloaded kit.js adopts it.
  const GORE_LEVELS = ['full', 'mild', 'off'];
  state.goreLevel ??= 'full';
  const LIM = { parts: 60, blood: 60, scorch: 20, debris: 300, bleeds: 32 };
  const UPV = new Vector3(0, 1, 0);
  // scratch for the gore code only (never share with the older utilities: gore runs inside hit() inside other loops)
  const gA = new Vector3(), gB = new Vector3(), gC = new Vector3(), gD = new Vector3(), gE = new Vector3(), gF = new Vector3();
  const sP = new Vector3(), sS = new Vector3(), sQ = new Quaternion();
  const gQ = new Quaternion(), gQ2 = new Quaternion(), gM = new Matrix4(), gCol = new Color();
  const isFull = () => state.goreLevel === 'full';
  const rsign = () => (Math.random() < 0.5 ? -1 : 1);
  const after = (sec, fn) => { reg.delays.push({ t: sec, fn }); };
  const goreApi = {
    get level() { return state.goreLevel; },
    set level(v) { if (GORE_LEVELS.includes(v)) state.goreLevel = v; },
    levels: GORE_LEVELS,
    caps: LIM,
    get queue() { return state.goreQ ? state.goreQ.length : 0; }, // model cuts waiting for their turn (kit.gore.budget = { jobs, ms } per frame)
    clear() { // wipe loose parts, blood and debris right now
      while (state.goreQ && state.goreQ.length) impl.endJob(state.goreQ.shift());
      for (let i = reg.parts.length - 1; i >= 0; i--) recyclePart(reg.parts[i]);
      for (const pool of [DEC.blood, DEC.scorch]) for (const it of pool.items) if (it.st) killDecal(pool, it);
      for (const c of DB.all) if (c.live) freeChunk(c);
      reg.bleeds.length = 0;
    },
    stats: () => ({
      level: state.goreLevel, parts: reg.parts.length, bleeds: reg.bleeds.length, debris: DB.live,
      blood: DEC.blood.items.reduce((n, it) => n + (it.st ? 1 : 0), 0), scorch: DEC.scorch.items.reduce((n, it) => n + (it.st ? 1 : 0), 0),
    }),
  };

  // ---- shared particle effects (lazy; recreated when kit.js reloads)
  let FX = null;
  function fx() {
    if (FX) return FX;
    const mk = (o) => { const e = particles(ctx, o); e.shared = true; return e; }; // shared kit effects: not counted as a creation's particle systems
    FX = {
      blood: mk({ count: 480, additive: false, color: [0xe8151c, 0x8c0a11], size: [0.11, 0.05], life: [0.55, 1.1], speed: [0.8, 3.4], gravity: 9.5, drag: 0.15 }),
      mist: mk({ count: 160, additive: false, color: [0xc8121a, 0x6e080d], alpha: 0.6, size: [0.35, 0.9], life: [0.35, 0.8], speed: [0.5, 2.2], gravity: 0.6, drag: 2 }),
      slime: mk({ count: 300, additive: false, color: [0x8cf05a, 0x3fa82a], size: [0.13, 0.06], life: [0.5, 1.1], speed: [0.8, 3.2], gravity: 8, drag: 0.3 }),
      oil: mk({ count: 160, additive: false, color: [0x2c2c30, 0x111114], size: [0.09, 0.05], life: [0.5, 1.0], speed: [0.8, 3], gravity: 9.5, drag: 0.2 }),
      sparks: mk({ count: 360, color: [0xfff4c0, 0xff8a24], size: [0.08, 0.015], life: [0.25, 0.7], speed: [2, 7], gravity: 9, drag: 0.4 }),
      bone: mk({ count: 240, additive: false, color: [0xf2ecd8, 0xb8ae94], size: [0.09, 0.05], life: [0.5, 1.1], speed: [1.5, 4.5], gravity: 10, drag: 0.2 }),
      dust: mk({ count: 200, additive: false, color: [0xa39578, 0x5c5244], alpha: 0.55, size: [0.35, 1.0], life: [0.6, 1.4], speed: [0.6, 2.2], gravity: -0.2, drag: 1.3 }),
      puff: mk({ count: 120, additive: false, color: [0xeef3f6, 0xaab4bc], alpha: 0.45, size: [0.3, 0.8], life: [0.5, 1.1], speed: [0.5, 1.8], gravity: -0.1, drag: 1.6 }),
      smoke: mk({ count: 120, additive: false, color: [0x555555, 0x181818], alpha: 0.5, size: [0.3, 1.0], life: [0.8, 1.8], speed: [0.3, 1.0], gravity: -0.9, drag: 1 }),
      ash: mk({ count: 200, additive: false, color: [0x4a4540, 0x151311], alpha: 0.9, size: [0.1, 0.05], life: [1.2, 2.4], speed: [0.5, 2.2], gravity: -0.1, drag: 0.9 }),
      ember: mk({ count: 160, color: [0xffd070, 0xff3a08], size: [0.07, 0.01], life: [0.6, 1.5], speed: [0.4, 1.6], gravity: -1.3, drag: 0.5 }),
      ice: mk({ count: 200, additive: false, color: [0xf0fcff, 0x9ad8f0], size: [0.1, 0.05], life: [0.5, 1.1], speed: [1.5, 5], gravity: 9, drag: 0.3 }),
      glint: mk({ count: 160, color: [0xffffff, 0x9fd8ff], size: [0.07, 0.01], life: [0.3, 0.8], speed: [1, 4.5], gravity: 6, drag: 0.5 }),
      shock: mk({ count: 160, color: [0xd8fbff, 0x30b8ff], size: [0.16, 0.02], life: [0.7, 1.5], speed: [0.4, 1.8], gravity: -0.8, drag: 0.7 }),
      magic: mk({ count: 160, color: [0xf0d8ff, 0x8a3cff], size: [0.16, 0.02], life: [0.7, 1.5], speed: [0.4, 1.8], gravity: -0.8, drag: 0.7 }),
    };
    return FX;
  }
  // what: 'spurt' (droplets / chips) or 'mist' (a cloud). gore: 'blood' | 'bones' | 'sparks' | 'slime' | 'none'
  function goreFx(gore, what, p, n, v, sc = 1) {
    const l = state.goreLevel;
    if (l === 'off' || gore === 'none' || n <= 0) return;
    const F = fx();
    if (l === 'mild') { F.sparks.emit(p, Math.ceil(n * 0.6), v, sc * 0.9); return; } // no gore: everything becomes harmless sparks
    const mist = what === 'mist';
    switch (gore) {
      case 'bones': (mist ? F.dust : F.bone).emit(p, n, v, sc); break;
      case 'sparks': if (mist) F.smoke.emit(p, Math.ceil(n * 0.5), v, sc * 0.7); else { F.sparks.emit(p, n, v, sc); F.oil.emit(p, n >> 1, v, sc); } break;
      case 'slime': (mist ? F.slime : F.slime).emit(p, n, v, mist ? sc * 1.5 : sc); break;
      default: (mist ? F.mist : F.blood).emit(p, n, v, sc);
    }
  }

  // ---- procedural sounds (rate limited so a 30-body explosion does not eat the voice pool)
  let GS = null;
  const gT = {};
  let gWin = 0, gCnt = 0;
  function gsnd(kind, p, big = 1) {
    if (ctx.world.audio?.enabled !== false && ctx.world.audio?.replaces?.has(kind)) return; // the recorded pack covers this moment
    const now = ctx.clock ? ctx.clock.t : 0;
    if (gT[kind] > now - 0.06) return;
    if (now - gWin > 0.4) { gWin = now; gCnt = 0; }
    if (++gCnt > 9) return;
    gT[kind] = now;
    GS ??= sound(ctx, { volume: 1 });
    const s = GS, at = p, v = big;
    switch (kind) {
      case 'slash':
        s.noise({ dur: 0.2, filter: { type: 'bandpass', freq: 2600, freqEnd: 500, q: 1.1 }, vol: 0.3 * v, at, attack: 0.002 });
        s.tone({ freq: 150, freqEnd: 55, dur: 0.2, type: 'triangle', vol: 0.34 * v, at });
        s.noise({ dur: 0.3, filter: { type: 'lowpass', freq: 900, freqEnd: 160 }, vol: 0.34 * v, at, delay: 0.03 }); break;
      case 'pierce':
        s.noise({ dur: 0.08, filter: { type: 'highpass', freq: 2600 }, vol: 0.25 * v, at });
        s.tone({ freq: 240, freqEnd: 90, dur: 0.14, type: 'triangle', vol: 0.3 * v, at }); break;
      case 'blunt':
        s.tone({ freq: 95, freqEnd: 34, dur: 0.34, vol: 0.55 * v, at });
        s.noise({ dur: 0.22, filter: { type: 'lowpass', freq: 520, freqEnd: 120 }, vol: 0.5 * v, at, attack: 0.002 });
        s.noise({ dur: 0.16, filter: { type: 'bandpass', freq: 1500, q: 1.4 }, vol: 0.18 * v, at, delay: 0.02 }); break;
      case 'burst':
        s.noise({ dur: 0.6, filter: { type: 'lowpass', freq: 1100, freqEnd: 90, q: 0.8 }, vol: 0.7 * v, at, attack: 0.003 });
        s.tone({ freq: 70, freqEnd: 28, dur: 0.5, vol: 0.55 * v, at });
        s.noise({ dur: 0.35, filter: { type: 'bandpass', freq: 700, freqEnd: 220, q: 0.9 }, vol: 0.4 * v, at, delay: 0.06 }); break;
      case 'fire':
        s.noise({ dur: 0.7, filter: { type: 'bandpass', freq: 2200, freqEnd: 900, q: 0.7 }, vol: 0.28 * v, at });
        s.noise({ dur: 0.5, filter: { type: 'lowpass', freq: 700, freqEnd: 200 }, vol: 0.28 * v, at, delay: 0.1 }); break;
      case 'frost':
        s.noise({ dur: 0.3, filter: { type: 'highpass', freq: 3500 }, vol: 0.3 * v, at });
        for (let i = 0; i < 4; i++) s.tone({ freq: 2400 + Math.random() * 2600, freqEnd: 1800, dur: 0.18 + Math.random() * 0.2, type: 'triangle', vol: 0.1 * v, at, delay: i * 0.035 }); break;
      case 'shock':
        s.tone({ freq: 2400, freqEnd: 300, dur: 0.28, type: 'sawtooth', vol: 0.16 * v, at });
        s.noise({ dur: 0.2, filter: { type: 'highpass', freq: 2400 }, vol: 0.3 * v, at }); break;
      case 'magic':
        s.chord([880, 1318, 1760], { dur: 0.7, type: 'sine', vol: 0.22 * v, stagger: 0.04, at });
        s.tone({ freq: 1200, freqEnd: 200, dur: 0.5, type: 'triangle', vol: 0.12 * v, at }); break;
      case 'thud':
        s.tone({ freq: 110, freqEnd: 45, dur: 0.16, vol: 0.28 * v, at });
        s.noise({ dur: 0.1, filter: { type: 'lowpass', freq: 500 }, vol: 0.25 * v, at }); break;
      default: break;
    }
  }
  // material break sounds
  function breakSound(material, p, big = 1) {
    if (ctx.world.audio?.enabled !== false && ctx.world.audio?.replaces?.has('break:' + material)) return; // pack covers it
    const now = ctx.clock ? ctx.clock.t : 0;
    if (gT.brk > now - 0.04) return;
    gT.brk = now;
    GS ??= sound(ctx, { volume: 1 });
    const s = GS, at = p, v = Math.min(1.6, big);
    switch (material) {
      case 'stone': s.noise({ dur: 0.7, filter: { type: 'lowpass', freq: 1000, freqEnd: 80, q: 0.8 }, vol: 0.7 * v, at, attack: 0.003 }); s.tone({ freq: 75, freqEnd: 30, dur: 0.6, vol: 0.6 * v, at }); s.noise({ dur: 0.25, filter: { type: 'highpass', freq: 2200 }, vol: 0.18 * v, at, delay: 0.05 }); break;
      case 'glass': s.noise({ dur: 0.45, filter: { type: 'highpass', freq: 3200 }, vol: 0.4 * v, at }); for (let i = 0; i < 5; i++) s.tone({ freq: 2800 + Math.random() * 3200, freqEnd: 2000, dur: 0.15 + Math.random() * 0.2, type: 'triangle', vol: 0.1 * v, at, delay: i * 0.04 }); break;
      case 'metal': s.tone({ freq: 520, freqEnd: 480, dur: 0.6, type: 'square', vol: 0.1 * v, at }); s.tone({ freq: 790, freqEnd: 760, dur: 0.5, type: 'triangle', vol: 0.14 * v, at }); s.tone({ freq: 1330, dur: 0.4, type: 'triangle', vol: 0.1 * v, at }); s.noise({ dur: 0.3, filter: { type: 'bandpass', freq: 1800, q: 1 }, vol: 0.3 * v, at }); s.tone({ freq: 90, freqEnd: 40, dur: 0.3, vol: 0.4 * v, at }); break;
      case 'crystal': s.chord([1760, 2093, 2637, 3136], { dur: 0.8, type: 'triangle', vol: 0.3 * v, stagger: 0.03, at }); s.noise({ dur: 0.3, filter: { type: 'highpass', freq: 3600 }, vol: 0.25 * v, at }); break;
      case 'ice': s.noise({ dur: 0.35, filter: { type: 'bandpass', freq: 2400, freqEnd: 1400, q: 0.9 }, vol: 0.4 * v, at }); for (let i = 0; i < 4; i++) s.tone({ freq: 2200 + Math.random() * 1800, freqEnd: 1600, dur: 0.2, type: 'triangle', vol: 0.09 * v, at, delay: 0.05 + i * 0.04 }); s.tone({ freq: 130, freqEnd: 50, dur: 0.25, vol: 0.3 * v, at }); break;
      case 'earth': s.tone({ freq: 85, freqEnd: 38, dur: 0.4, vol: 0.5 * v, at }); s.noise({ dur: 0.45, filter: { type: 'lowpass', freq: 520, freqEnd: 100 }, vol: 0.5 * v, at }); break;
      case 'cloth': s.noise({ dur: 0.3, filter: { type: 'lowpass', freq: 650, freqEnd: 200 }, vol: 0.22 * v, at, attack: 0.02 }); break;
      default: /* wood */ s.noise({ dur: 0.28, filter: { type: 'bandpass', freq: 1300, freqEnd: 300, q: 1 }, vol: 0.5 * v, at, attack: 0.002 }); s.tone({ freq: 240, freqEnd: 80, dur: 0.22, type: 'triangle', vol: 0.4 * v, at }); s.noise({ dur: 0.35, filter: { type: 'highpass', freq: 1800 }, vol: 0.2 * v, at, delay: 0.05 });
    }
  }

  // ---- ground decals: instanced alpha-tested quads (opaque, so nothing to sort and no framebuffer alpha), fade by shrinking
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  function blobTexture(kind) {
    const N = 64, data = new Uint8Array(N * N * 4), rnd = mulberry(kind === 'scorch' ? 77 : 12345);
    const dots = [], rays = [];
    for (let i = 0; i < 7; i++) dots.push([rnd() * 6.283, 0.66 + rnd() * 0.26, 0.05 + rnd() * 0.06]);
    for (let i = 0; i < 9; i++) rays.push([rnd() * 6.283, 0.2 + rnd() * 0.3]);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = ((x + 0.5) / N) * 2 - 1, v = ((y + 0.5) / N) * 2 - 1, r = Math.sqrt(u * u + v * v), th = Math.atan2(v, u);
        let edge, a, shade;
        if (kind === 'scorch') {
          edge = 0.5 + 0.09 * Math.sin(4 * th + 0.5) + 0.07 * Math.sin(7 * th + 1) + 0.06 * Math.sin(11 * th + 2) + 0.04 * Math.sin(17 * th);
          for (const q of rays) { let dA = Math.abs(th - q[0]); if (dA > 3.1416) dA = 6.2832 - dA; edge = Math.max(edge, 0.45 + q[1] * Math.max(0, 1 - dA / 0.1)); }
          a = r < edge ? 1 : 0;
          shade = 0.28 + 0.72 * Math.pow(Math.min(1, r / edge), 1.4);
        } else {
          edge = 0.5 + 0.1 * Math.sin(5 * th + 1.3) + 0.07 * Math.sin(9 * th + 0.4) + 0.05 * Math.sin(14 * th + 2) + 0.06 * Math.sin(3 * th);
          a = r < edge ? 1 : 0;
          for (const d of dots) { const dx = u - Math.cos(d[0]) * d[1], dy = v - Math.sin(d[0]) * d[1]; if (dx * dx + dy * dy < d[2] * d[2]) a = 1; }
          shade = 0.8 + 0.2 * (1 - Math.min(1, r / edge));
        }
        const i = (y * N + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = Math.round(255 * shade); data[i + 3] = a * 255;
      }
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  function newDecalPool(kind, cap) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ map: blobTexture(kind), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new Matrix4().makeScale(0, 0, 0), white = new Color(1, 1, 1);
    for (let i = 0; i < cap; i++) { mesh.setMatrixAt(i, zero); mesh.setColorAt(i, white); }
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; mesh.name = `kit-${kind}-decals`;
    const items = [];
    for (let i = 0; i < cap; i++) items.push({ i, st: 0, p: new Vector3(), q: new Quaternion(), size: 1, age: 0, delay: 0, life: 30 });
    return { kind, cap, mesh, items, cur: 0 };
  }
  let DEC = null;
  function ensureDecals() {
    let D = state.dec;
    if (!D || D.v !== 1) {
      if (D) for (const k of ['blood', 'scorch']) { D[k].mesh.removeFromParent(); D[k].mesh.dispose?.(); }
      D = state.dec = { v: 1, blood: newDecalPool('blood', LIM.blood), scorch: newDecalPool('scorch', LIM.scorch) };
    }
    ctx.root.add(D.blood.mesh); ctx.root.add(D.scorch.mesh);
    return D;
  }
  const ZEROM = new Matrix4().makeScale(0, 0, 0);
  function killDecal(pool, it) { it.st = 0; pool.mesh.setMatrixAt(it.i, ZEROM); pool.mesh.instanceMatrix.needsUpdate = true; }
  const wS = new Vector3();
  function writeDecal(pool, it, k) {
    wS.set(it.size * k, it.size * k, it.size * k);
    gM.compose(it.p, it.q, wS);
    pool.mesh.setMatrixAt(it.i, gM);
    pool.mesh.instanceMatrix.needsUpdate = true;
  }
  // x, z on the ground; size = diameter. Oldest decal is recycled when the pool is full.
  function placeDecal(pool, x, z, size, color, delay, life, lift) {
    const it = pool.items[pool.cur];
    pool.cur = (pool.cur + 1) % pool.cap;
    const e = 0.4, gy = groundAt(x, z);
    gB.set(groundAt(x - e, z) - groundAt(x + e, z), 2 * e, groundAt(x, z - e) - groundAt(x, z + e)).normalize();
    it.p.set(x, gy + (lift ?? 0.03), z);
    gQ.setFromUnitVectors(UPV, gB); gQ2.setFromAxisAngle(UPV, Math.random() * 6.2832);
    it.q.copy(gQ).multiply(gQ2);
    it.size = size; it.age = 0; it.delay = delay || 0; it.life = life; it.st = 1;
    pool.mesh.setColorAt(it.i, color); pool.mesh.instanceColor.needsUpdate = true;
    if (it.delay <= 0) writeDecal(pool, it, 0.001); else { pool.mesh.setMatrixAt(it.i, ZEROM); pool.mesh.instanceMatrix.needsUpdate = true; }
    return it;
  }
  function stepDecalPool(pool, dt) {
    const items = pool.items;
    for (let i = 0; i < pool.cap; i++) {
      const it = items[i];
      if (it.st === 0) continue;
      it.age += dt;
      const a = it.age - it.delay;
      if (a < 0) continue;
      if (a >= it.life - it.delay) { killDecal(pool, it); continue; }
      const fade = it.life - it.age;
      if (a < 0.22) writeDecal(pool, it, ease.back(Math.min(1, a / 0.2)));
      else if (fade < 2) { writeDecal(pool, it, Math.max(0.001, fade / 2)); it.st = 2; }
      else if (it.st === 1) { writeDecal(pool, it, 1); it.st = 3; }
    }
  }
  const SPLAT = { blood: [0xb4121a, 0x8e0d14, 0xc81a22], slime: [0x58cc3a, 0x3fa82a, 0x6edc4a], sparks: [0x18181c, 0x242428] };
  function placeSplat(x, z, size, gore, delay = 0) {
    if (state.goreLevel !== 'full') return;
    const cols = SPLAT[gore];
    if (!cols) return;
    gCol.set(cols[(Math.random() * cols.length) | 0]);
    placeDecal(DEC.blood, x, z, size, gCol, delay, rand(26, 34));
  }
  // blood leaving p with velocity v lands somewhere ahead: put a splat there when it arrives
  function splatAhead(p, v, size, gore) {
    if (state.goreLevel !== 'full' || !SPLAT[gore]) return;
    const gy = groundAt(p.x, p.z), hgt = Math.max(0, p.y - gy), g = 9.5;
    const t = (v.y + Math.sqrt(v.y * v.y + 2 * g * hgt)) / g;
    if (t > 2.5 || !isFinite(t)) return;
    placeSplat(p.x + v.x * t, p.z + v.z * t, size, gore, t);
  }
  // purely visual scorch mark. color = tint of the burn
  function scorch(point, radius = 1.2, o = {}) {
    if (!point) return null;
    gCol.set(o.color ?? 0x15110e);
    return placeDecal(DEC.scorch, point.x, point.z, Math.max(0.3, radius * 2), gCol, 0, o.life ?? 45, o.lift ?? 0.035);
  }
  let craterT = 0, craterN = 0;
  // dark scorched ring + raised rim of earth clods. Visual only: the terrain height is untouched (world.groundHeight has a GLSL twin).
  function crater(point, radius = 2) {
    if (!point) return;
    const now = ctx.clock ? ctx.clock.t : 0;
    if (now - craterT > 1) { craterT = now; craterN = 0; }
    if (++craterN > 3) return;
    const x = point.x, z = point.z, gy = groundAt(x, z);
    gCol.set(0x3a2e22); placeDecal(DEC.scorch, x, z, radius * 3.3, gCol, 0, 60, 0.03);
    gCol.set(0x0c0907); placeDecal(DEC.scorch, x, z, radius * 2.1, gCol, 0, 60, 0.04);
    const n = kb(clamp(Math.round(6 + radius * 5), 8, 28), 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.2832 + Math.random() * 0.4, rr = radius * rand(1.05, 1.35);
      const sz = rand(0.14, 0.34) * Math.min(2, 0.6 + radius * 0.35);
      gA.set(sz, sz * rand(0.55, 0.9), sz * rand(0.8, 1.1));
      gCol.setHSL(0.07 + rand(-0.01, 0.015), rand(0.25, 0.4), rand(0.16, 0.28));
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      if (i % 2) { // half the clods are thrown and land around the rim
        gB.set(Math.cos(a) * rand(2, 5), rand(4, 8), Math.sin(a) * rand(2, 5));
        gC.set(x, gy + 0.3, z);
        spawnChunk(1, gC, gB, gA, gCol, rand(36, 44));
      } else { // the rest are simply there, popping up with the eruption
        gC.set(px, groundAt(px, pz) + gA.y * 0.4, pz); gB.set(0, 0.5, 0);
        const c = spawnChunk(1, gC, gB, gA, gCol, rand(36, 44));
        if (c) c.w.multiplyScalar(0.1);
      }
    }
    fx().dust.emit(gC.set(x, gy + 0.2, z), Math.round(10 + radius * 5), undefined, 0.8 + radius * 0.3);
  }

  // ---- debris: ONE pooled system (2 instanced meshes: boxes and icosahedra) for every chunk of broken stuff, up to LIM.debris live
  let DB = null;
  function ensureDebris() {
    let D = state.dbr;
    if (!D || D.v !== 1) {
      if (D) for (const s of D.shapes) { s.mesh.removeFromParent(); s.mesh.dispose?.(); }
      const mat = new THREE.MeshLambertMaterial({ flatShading: true });
      const geos = [new THREE.BoxGeometry(1, 1, 1), new THREE.IcosahedronGeometry(0.5, 0)];
      D = state.dbr = { v: 1, shapes: [], free: [], live: 0, all: [] };
      for (let k = 0; k < 2; k++) {
        const m = new THREE.InstancedMesh(geos[k], mat, LIM.debris);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.setColorAt(0, new Color(1, 1, 1)); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        m.count = 0; m.frustumCulled = false; m.name = k ? 'kit-debris-ico' : 'kit-debris-box';
        D.shapes.push({ mesh: m, act: [] });
      }
      for (let i = 0; i < LIM.debris; i++) {
        const c = { sh: 0, idx: -1, p: new Vector3(), v: new Vector3(), q: new Quaternion(), tq: new Quaternion(), w: new Vector3(), s: new Vector3(), col: new Color(), age: 0, life: 10, rest: 0, settle: 0, r: 0.1, hh: 0.05, live: false, bounce: 0.35, shrinkT: 1.2 };
        D.free.push(c); D.all.push(c);
      }
    }
    for (const s of D.shapes) ctx.root.add(s.mesh);
    return D;
  }
  function writeChunk(c, sc) {
    wS.set(c.s.x * sc, c.s.y * sc, c.s.z * sc);
    gM.compose(c.p, c.q, wS);
    DB.shapes[c.sh].mesh.setMatrixAt(c.idx, gM);
  }
  function freeChunk(c) {
    if (c.ph) { c.ph.remove(); c.ph = null; }
    c.phNew = false;
    const S = DB.shapes[c.sh], last = S.act.pop();
    if (last !== c) {
      S.act[c.idx] = last; last.idx = c.idx;
      S.mesh.setColorAt(last.idx, last.col); S.mesh.instanceColor.needsUpdate = true;
      writeChunk(last, last.life - last.age < last.shrinkT ? Math.max(0.001, (last.life - last.age) / last.shrinkT) : 1);
    }
    S.mesh.count = S.act.length; S.mesh.instanceMatrix.needsUpdate = true;
    c.live = false; c.idx = -1; DB.free.push(c); DB.live--;
  }
  // shape 0 = box, 1 = icosahedron. s = full dimensions (m). Returns the chunk (or null).
  function spawnChunk(shape, p, v, s, col, life) {
    let c = DB.free.pop();
    if (!c) { // pool full: recycle the oldest chunk
      let best = null;
      for (let i = 0; i < DB.all.length; i++) { const q = DB.all[i]; if (q.live && (!best || q.age > best.age)) best = q; }
      if (!best) return null;
      freeChunk(best); c = DB.free.pop();
    }
    c.live = true; c.sh = shape; c.age = 0; c.life = life; c.rest = 0; c.settle = 0; c.bounce = 0.35;
    c.p.set(p.x, p.y, p.z); c.v.set(v.x, v.y, v.z);
    c.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    c.w.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(rand(4, 12));
    c.s.set(s.x, s.y, s.z); c.col.copy(col);
    c.hh = Math.min(s.x, s.y, s.z) * 0.5;
    c.r = clamp(((s.x + s.y + s.z) / 3) * 0.42, 0.025, 1);
    c.ph = null; c.phNew = true; c.dirty = false; // a Rapier body is attached on the first step (velocities may still be adjusted by the spawner)
    const S = DB.shapes[shape];
    c.idx = S.act.length; S.act.push(c); S.mesh.count = S.act.length;
    S.mesh.setColorAt(c.idx, c.col); S.mesh.instanceColor.needsUpdate = true;
    writeChunk(c, 1); S.mesh.instanceMatrix.needsUpdate = true;
    DB.live++;
    return c;
  }
  function flattenChunk(c) {
    const s = c.s, k = s.x <= s.y && s.x <= s.z ? 0 : s.y <= s.z ? 1 : 2;
    gA.set(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0).applyQuaternion(c.q);
    gB.set(0, gA.y >= 0 ? 1 : -1, 0);
    gQ.setFromUnitVectors(gA, gB);
    c.tq.copy(c.q).premultiply(gQ);
    c.hh = Math.min(s.x, s.y, s.z) * 0.5; c.settle = 0; c.rest = 1;
  }
  // give a chunk a real box body (when the physics budget allows; otherwise it keeps the cheap sim below)
  const NOCTX = {};
  let physMade = 0;
  function physChunk(c) {
    const P = PH();
    if (!P || !P.canSpawn('debris')) return;
    const s = c.s, k = c.sh === 1 ? 0.8 : 1, vol = s.x * s.y * s.z * k * k * k;
    const h = P.body(NOCTX, null, {
      shape: 'box', size: [Math.max(0.03, s.x * k), Math.max(0.03, s.y * k), Math.max(0.03, s.z * k)], position: c.p, quaternion: c.q, mass: clamp(600 * vol, 0.05, 60),
      friction: 0.8, restitution: c.bounce * 0.7, group: 'debris', recycle: true, linearDamping: 0.12, angularDamping: 0.5, softCcd: 0.3,
    });
    if (!h) return;
    h.setVelocity(c.v.x, c.v.y, c.v.z); h.setAngularVelocity(c.w.x, c.w.y, c.w.z);
    c.ph = h; c.dirty = true; physMade++;
  }
  function stepDebris(dt) {
    if (!DB.live) return;
    physMade = 0;
    for (let k = 0; k < 2; k++) {
      const S = DB.shapes[k], A = S.act;
      let any = false;
      for (let i = A.length - 1; i >= 0; i--) {
        const c = A[i];
        c.age += dt;
        if (c.age >= c.life) { freeChunk(c); any = true; continue; }
        const shrink = c.life - c.age < c.shrinkT;
        if (c.phNew && physMade < 24) { c.phNew = false; physChunk(c); }
        if (c.ph) { // a Rapier chunk: the pose comes from the physics world
          const ph = c.ph;
          if (ph.removed) { c.ph = null; c.rest = 2; } // fell out of the world: stay where it was
          else {
            if (ph.awake || c.dirty || shrink) {
              c.p.copy(ph.rp); c.q.copy(ph.rq); c.dirty = ph.awake;
              writeChunk(c, shrink ? Math.max(0.001, (c.life - c.age) / c.shrinkT) : 1); any = true;
            }
            continue;
          }
        }
        if (c.rest >= 2 && !shrink) continue;
        if (c.rest === 0) {
          c.v.y -= 9.8 * dt;
          c.p.x += c.v.x * dt; c.p.y += c.v.y * dt; c.p.z += c.v.z * dt;
          const wl = c.w.length();
          if (wl > 1e-3) { gQ.setFromAxisAngle(gA.copy(c.w).multiplyScalar(1 / wl), wl * dt); c.q.premultiply(gQ); }
          const gy = groundAt(c.p.x, c.p.z);
          if (c.p.y - c.r < gy) {
            c.p.y = gy + c.r;
            if (c.v.y < -1.3) { c.v.y *= -c.bounce; c.v.x *= 0.7; c.v.z *= 0.7; c.w.multiplyScalar(0.6); }
            else {
              c.v.y = 0; const f = Math.exp(-6 * dt); c.v.x *= f; c.v.z *= f; c.w.multiplyScalar(f);
              if (c.v.x * c.v.x + c.v.z * c.v.z < 0.25 || c.age > 5) flattenChunk(c);
            }
          }
        } else if (c.rest === 1) {
          c.q.slerp(c.tq, 1 - Math.exp(-14 * dt));
          const gy = groundAt(c.p.x, c.p.z);
          c.p.y += (gy + c.hh - c.p.y) * Math.min(1, dt * 14);
          c.settle += dt;
          if (c.settle > 0.5) { c.rest = 2; c.p.y = gy + c.hh; c.q.copy(c.tq); }
        }
        writeChunk(c, shrink ? Math.max(0.001, (c.life - c.age) / c.shrinkT) : 1);
        any = true;
      }
      if (any) S.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---- material tables + what an object looks like (box + colours sampled from its meshes)
  const MAT = {
    wood: { hp: 30, col: 0x8a5a30, shape: 'plank' }, stone: { hp: 120, col: 0x82807c, shape: 'block' },
    glass: { hp: 6, col: 0xbfe4ee, shape: 'shard' }, metal: { hp: 150, col: 0x8d96a0, shape: 'plate' },
    crystal: { hp: 40, col: 0x9a7bff, shape: 'shard' }, ice: { hp: 25, col: 0xcdeeff, shape: 'shard' },
    earth: { hp: 60, col: 0x6b5238, shape: 'clod' }, cloth: { hp: 8, col: 0xb04a3a, shape: 'strip' },
  };
  // damage multipliers by kind (what a stone wall shrugs off, what ice hates ...). kinds not listed = 1
  const MUL = {
    wood: { slash: 1.3, pierce: 0.7, blunt: 0.9, explosion: 1.3, fire: 1.6, frost: 0.3, shock: 0.5 },
    stone: { slash: 0.25, pierce: 0.2, blunt: 1.2, explosion: 1.4, fire: 0.1, frost: 0.1, shock: 0.2, magic: 0.8 },
    glass: { blunt: 1.2, explosion: 1.5, fire: 0.3, frost: 0.5, shock: 0.3 },
    metal: { slash: 0.3, pierce: 0.3, blunt: 0.8, explosion: 1.2, fire: 0.1, frost: 0.1, shock: 0.6, magic: 0.8 },
    crystal: { slash: 0.5, pierce: 0.5, blunt: 1.3, explosion: 1.3, fire: 0.2, frost: 0.2, shock: 0.3, magic: 1.5 },
    ice: { slash: 0.8, pierce: 0.7, blunt: 1.4, explosion: 1.4, fire: 2, frost: 0.2, shock: 0.3, magic: 0.8 },
    earth: { slash: 0.5, pierce: 0.5, explosion: 1.5, fire: 0.1, frost: 0.1, shock: 0.1, magic: 0.6 },
    cloth: { slash: 1.5, blunt: 0.5, fire: 3, frost: 0.1, shock: 0.3 },
  };
  const geoColCache = new WeakMap();
  function geoColor(geo) {
    if (geoColCache.has(geo)) return geoColCache.get(geo);
    let r = null;
    const a = geo.attributes && geo.attributes.color;
    if (a && a.count) {
      let sr = 0, sg = 0, sb = 0, k = 0;
      const n = a.count, step = Math.max(1, (n / 64) | 0);
      for (let i = 0; i < n; i += step) { sr += a.getX(i); sg += a.getY(i); sb += a.getZ(i); k++; }
      r = [sr / k, sg / k, sb / k];
    }
    geoColCache.set(geo, r);
    return r;
  }
  function profile(obj) {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) { const p = new Vector3().setFromMatrixPosition(obj.matrixWorld); box.min.set(p.x - 0.25, p.y, p.z - 0.25); box.max.set(p.x + 0.25, p.y + 0.5, p.z + 0.25); }
    const size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
    const cols = [];
    obj.traverse((m) => {
      if (!m.isMesh || !m.material || m.visible === false) return;
      const mat = [].concat(m.material)[0];
      const c = new Color(mat.color ? mat.color : 0x888888);
      const gc = m.geometry && geoColor(m.geometry);
      if (gc && mat.vertexColors) { c.r *= gc[0]; c.g *= gc[1]; c.b *= gc[2]; }
      let w = 0.05;
      if (m.geometry) {
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const rr = m.geometry.boundingSphere ? m.geometry.boundingSphere.radius : 0.3, sc = Math.cbrt(Math.abs(m.matrixWorld.determinant())) || 1;
        w = (rr * sc) * (rr * sc);
      }
      cols.push({ c, w });
    });
    let total = 0;
    for (const e of cols) total += e.w;
    return { box, size, center, cols, total };
  }
  function pickColor(prof, out) {
    if (!prof.cols.length) return out.set(0x888888);
    let r = Math.random() * prof.total;
    for (const e of prof.cols) { r -= e.w; if (r <= 0) return out.copy(e.c); }
    return out.copy(prof.cols[prof.cols.length - 1].c);
  }
  function chunkDims(shape, u, out) { // returns the geometry (0 box, 1 ico)
    switch (shape) {
      case 'plank': out.set(u * rand(0.25, 0.45), u * rand(0.18, 0.32), u * rand(1.4, 3.2)); return 0;
      case 'block': { const a = u * rand(0.7, 1.3); out.set(a, a * rand(0.6, 1.1), a * rand(0.7, 1.2)); return 1; }
      case 'shard': out.set(u * rand(0.2, 0.45), u * rand(1.0, 2.0), u * rand(0.35, 0.7)); return 1;
      case 'plate': out.set(u * rand(1.2, 2.4), u * rand(0.08, 0.14), u * rand(0.9, 1.8)); return 0;
      case 'clod': { const a = u * rand(0.6, 1.2); out.set(a, a * rand(0.6, 0.9), a); return 1; }
      default: out.set(u * rand(1.4, 2.4), u * rand(0.04, 0.08), u * rand(0.5, 1.0)); return 0; // strip
    }
  }
  const TINT = { glass: 0xcfeaf2, ice: 0xcdeeff, metal: 0x8d96a0 };
  // Chunks matching an object's volume and colours. o: { count, direction, power = 3, mass = 1, size = 1, tint, life, shape }
  function debrisForObject(obj, material, o = {}) {
    const mt = MAT[material] || MAT.wood, prof = profile(obj), shape = o.shape ?? mt.shape;
    const sz = prof.size, vol = Math.max(0.001, sz.x * sz.y * sz.z), ext = Math.max(sz.x, sz.y, sz.z, 0.05);
    const n = kb(clamp(o.count ?? Math.round(8 + 6 * Math.cbrt(vol)), 3, 48), 3);
    const u = clamp(ext * 0.16, 0.07, 0.55) * (o.size ?? 1), power = o.power ?? 3, im = 1 / Math.sqrt(Math.max(0.2, o.mass ?? 1));
    const dir = o.direction, tint = o.tint ?? TINT[material];
    let made = 0;
    lastProf = prof;
    for (let i = 0; i < n; i++) {
      gC.set(prof.box.min.x + Math.random() * sz.x, prof.box.min.y + Math.random() * sz.y, prof.box.min.z + Math.random() * sz.z);
      pickColor(prof, gCol);
      if (tint != null) gCol.lerp(gQCol.set(tint), material === 'metal' ? 0.35 : 0.6);
      gCol.multiplyScalar(rand(0.85, 1.1));
      const sh = chunkDims(shape, u, gD);
      gB.copy(gC).sub(prof.center);
      const l = gB.length() || 1;
      gB.multiplyScalar((rand(1.2, 3.2) * (power / 3)) / l);
      if (dir) gB.addScaledVector(dir, power * rand(0.5, 1.1));
      gB.multiplyScalar(im);
      gB.y += rand(1.2, 3.4);
      if (spawnChunk(sh, gC, gB, gD, gCol, rand(13, 17))) made++;
    }
    return made;
  }
  const gQCol = new Color();
  // plain burst of n chunks (flesh, bone, scrap, ice) around a point
  function chunkBurst(center, n, o) {
    const cols = o.colors, power = o.power ?? 4, dir = o.direction;
    n = kb(n);
    for (let i = 0; i < n; i++) {
      gCol.set(cols[(Math.random() * cols.length) | 0]).multiplyScalar(rand(0.8, 1.15));
      const u = rand(o.size?.[0] ?? 0.08, o.size?.[1] ?? 0.16);
      const sh = chunkDims(o.shape ?? 'clod', u, gD);
      gC.set(center.x + rand(-0.15, 0.15), center.y + rand(-0.15, 0.15), center.z + rand(-0.15, 0.15));
      gB.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize().multiplyScalar(power * rand(0.5, 1.2));
      if (dir) gB.addScaledVector(dir, power * 0.5);
      gB.y += rand(1, 3);
      spawnChunk(sh, gC, gB, gD, gCol, o.life ?? rand(10, 13));
    }
  }

  // ---- loose parts: severed limbs, body halves, launched bodies. Each is a Group (holder) centred on the part, simulated here.
  function newPart(holder, o) {
    const P = {
      holder, v: new Vector3(), w: new Vector3(), s0: holder.scale.clone(), r: o.r ?? 0.06, axis: o.axis ? o.axis.clone() : new Vector3(0, 1, 0),
      tq: new Quaternion(), rest: 0, settle: 0, age: 0, life: o.life ?? 12, gore: o.gore ?? 'blood', stumps: o.stumps ?? [],
      whole: !!o.whole, actor: o.actor ?? null, kind: o.kind ?? 'limb', dead: false, thudT: -9,
    };
    ctx.root.add(holder);
    reg.parts.push(P);
    while (reg.parts.length > LIM.parts) { // cap: recycle the oldest
      let best = 0;
      for (let i = 1; i < reg.parts.length; i++) if (reg.parts[i].age > reg.parts[best].age) best = i;
      recyclePart(reg.parts[best]);
    }
    return P;
  }
  // severed limbs / body halves / launched bodies as Rapier boxes fitted to their meshes (capped by the tier; the rest use the old sim)
  function initPartPhysics(P) {
    P.ph = null;
    const Py = PH();
    if (!Py || P.dead) return;
    let n = 0;
    for (const q of reg.parts) if (q.ph) n++;
    if (n >= Py.caps.parts || !Py.canSpawn('part')) return;
    P.holder.updateMatrixWorld(true);
    const h = Py.body({ root: ctx.root }, P.holder, { shape: 'box', mass: Math.min(25, 1 + P.r * P.r * 60), friction: 0.9, restitution: 0.2, linearDamping: 0.1, angularDamping: 1.0, ccd: true });
    if (!h) return;
    h.noEvict = true; h.user = P;
    h.setVelocity(P.v.x, P.v.y, P.v.z); h.setAngularVelocity(P.w.x, P.w.y, P.w.z);
    h.onContact(partContactRelay);
    P.ph = h;
  }
  function partContactRelay(e) { impl.partContact(e); }
  impl.partContact = (e) => {
    const P = e.self && e.self.user;
    if (P && !P.dead && e.speed > 2.2 && e.kind !== 'body') partImpact(P, e.speed);
  };
  function recyclePart(P) {
    if (P.dead) return;
    P.dead = true;
    if (P.ph) { P.ph.user = null; P.ph.remove(); P.ph = null; }
    P.holder.removeFromParent();
    const pg = P.holder.userData.geos; // parts cut out of a model own their geometry (see model bodies below)
    if (pg) { for (const g of pg) g.dispose(); P.holder.userData.geos = null; }
    dropFrom(reg.parts, P);
    if (P.actor && !P.actor.removed) { try { P.actor.remove(); } catch (err) { /* gone */ } }
  }
  // world position / direction of stump i of a part
  function partStump(P, i, outPos, outDir) {
    const st = P.stumps[i], h = P.holder;
    outPos.copy(st.pos).multiply(h.scale).applyQuaternion(h.quaternion).add(h.position);
    if (outDir) outDir.copy(st.dir).applyQuaternion(h.quaternion);
    return outPos;
  }
  function flattenPart(P) {
    const h = P.holder;
    gA.copy(P.axis).applyQuaternion(h.quaternion);
    gB.set(gA.x, 0, gA.z);
    if (gB.lengthSq() < 1e-4) gB.set(Math.cos(Math.random() * 6.28), 0, Math.sin(Math.random() * 6.28));
    gB.normalize();
    gQ.setFromUnitVectors(gA.normalize(), gB);
    P.tq.copy(h.quaternion).premultiply(gQ);
    P.rest = 1; P.settle = 0;
  }
  function stepParts(dt) {
    const A = reg.parts, calm = state.goreLevel !== 'full';
    for (let i = A.length - 1; i >= 0; i--) {
      const P = A[i], h = P.holder;
      P.age += dt;
      const life = calm ? Math.min(P.life, 3.2) : P.life;
      if (P.age > life + 1.2) { recyclePart(P); continue; }
      if (P.pending) continue; // the cut for this part is still queued (see the gore queue): nothing to simulate yet
      if (P.ph === undefined) initPartPhysics(P);
      if (P.ph) { // a Rapier body drives the holder; the cheap sim below is for parts over the physics budget
        if (P.ph.removed) { P.ph = null; P.rest = 2; }
        else if (P.rest < 2 && P.age > 0.6 && P.ph.asleep) { P.rest = 2; partRest(P); }
        else if (P.kind === 'body' && P.age > 1.0 && (P.topples | 0) < 3 && P.ph.velocity.lengthSq() < 0.5) { // a tumbling body must not come to rest standing on its head or feet: tip it over
          gA.set(0, 1, 0).applyQuaternion(h.quaternion);
          if (Math.abs(gA.y) > 0.72) { P.topples = (P.topples | 0) + 1; P.ph.applyTorque(rand(-1, 1) * 1.6 * P.ph.mass, 0, rand(-1, 1) * 1.6 * P.ph.mass); }
        }
      }
      if (!P.ph && P.rest < 2) {
        if (P.rest === 0) {
          P.v.y -= 9.8 * dt;
          h.position.x += P.v.x * dt; h.position.y += P.v.y * dt; h.position.z += P.v.z * dt;
          const wl = P.w.length();
          if (wl > 1e-3) { gQ.setFromAxisAngle(gA.copy(P.w).multiplyScalar(1 / wl), wl * dt); h.quaternion.premultiply(gQ); }
          const gy = groundAt(h.position.x, h.position.z);
          if (h.position.y - P.r < gy) {
            h.position.y = gy + P.r;
            const vy = P.v.y;
            if (vy < -2.2) partImpact(P, -vy);
            if (vy < -1.6) { P.v.y = -vy * 0.28; P.v.x *= 0.6; P.v.z *= 0.6; P.w.multiplyScalar(0.55); }
            else {
              P.v.y = 0; const f = Math.exp(-5 * dt); P.v.x *= f; P.v.z *= f; P.w.multiplyScalar(f);
              if (P.v.x * P.v.x + P.v.z * P.v.z < 0.3 || P.age > 4) { flattenPart(P); partRest(P); }
            }
          }
        } else {
          h.quaternion.slerp(P.tq, 1 - Math.exp(-12 * dt));
          const gy = groundAt(h.position.x, h.position.z);
          h.position.y += (gy + P.r - h.position.y) * Math.min(1, dt * 12);
          P.settle += dt;
          if (P.settle > 0.5) { P.rest = 2; h.quaternion.copy(P.tq); }
        }
      }
      if (P.age > life) { // sink + shrink away
        const k = Math.max(0.001, 1 - (P.age - life) / 1.2);
        h.scale.copy(P.s0).multiplyScalar(k);
      }
    }
  }
  function partImpact(P, speed) {
    const h = P.holder;
    if (P.age - P.thudT < 0.15) return;
    P.thudT = P.age;
    gE.copy(h.position);
    goreFx(P.gore, 'spurt', gE, Math.min(10, 2 + speed), undefined, 0.5);
    if (isFull() && P.stumps.length && P.age < 6) placeSplat(h.position.x, h.position.z, rand(0.35, 0.7), P.gore);
    gsnd('thud', gE, Math.min(1.2, 0.5 + speed * 0.1));
  }
  function partRest(P) {
    P.v.set(0, 0, 0); P.w.set(0, 0, 0);
    if (isFull() && P.whole) placeSplat(P.holder.position.x, P.holder.position.z, rand(1.0, 1.6), P.gore, 0.1);
  }

  // ---- bleeding stumps: a short pulsing spurt-drip. Either on a part (P.stumps[i]) or on an object (a stump mesh on a living body).
  function addBleed(o) {
    const B = reg.bleeds;
    if (state.goreLevel !== 'full') return; // mild / off: no drips
    if (B.length >= LIM.bleeds) { // recycle the one closest to finishing
      let best = 0;
      for (let i = 1; i < B.length; i++) if (B[i].t / B[i].T > B[best].t / B[best].T) best = i;
      B.splice(best, 1);
    }
    B.push({ part: o.part ?? null, i: o.i ?? 0, obj: o.obj ?? null, dir: o.dir ? o.dir.clone() : new Vector3(0, 1, 0), t: 0, T: o.T ?? 2.2, next: 0, k: 0, s: o.s ?? 1, gore: o.gore ?? 'blood' });
  }
  function stepBleeds(dt) {
    const B = reg.bleeds;
    for (let i = B.length - 1; i >= 0; i--) {
      const b = B[i];
      b.t += dt;
      if (b.t >= b.T || (b.part && b.part.dead) || (b.obj && !b.obj.parent) || state.goreLevel === 'off') { B[i] = B[B.length - 1]; B.pop(); continue; }
      b.next -= dt;
      if (b.next > 0) continue;
      b.k = (b.k + 1) & 3;
      b.next = b.k === 0 ? 0.32 : 0.075; // pulse, pulse, pulse, pause
      const u = b.t / b.T;
      if (b.part) { partStump(b.part, b.i, gE, gF); }
      else {
        b.obj.updateWorldMatrix(true, false);
        gE.set(0, 0, 0).applyMatrix4(b.obj.matrixWorld);
        gF.copy(b.dir).transformDirection(b.obj.matrixWorld);
      }
      const sp = (2.6 * (1 - u) + 0.7) * (b.k === 1 ? 1.25 : 1);
      gD.copy(gF).multiplyScalar(sp); gD.y += 0.6;
      goreFx(b.gore, 'spurt', gE, Math.round((6 * (1 - u) + 1) * b.s), gD, 0.75);
      if (Math.random() < 0.5 * (1 - u)) splatAhead(gE, gD, rand(0.14, 0.3), b.gore);
    }
  }
  // spurt out of point p along unit dir
  function spurt(gore, p, dir, n, speed, size) {
    gD.copy(dir).multiplyScalar(speed);
    goreFx(gore, 'spurt', p, n, gD, 1);
    goreFx(gore, 'mist', p, Math.max(2, n >> 2), gD, 0.8);
    if (isFull()) { splatAhead(p, gD, size ?? rand(0.4, 0.8), gore); if (n > 12) { gD.multiplyScalar(0.6); splatAhead(p, gD, rand(0.25, 0.5), gore); } }
  }

  // ------------------------------------------------------------------ dismemberment + death styles
  // A "target" describes what can come off a damageable: named limbs { obj, center, joint, r, axis, vital, stump } plus the core that
  // stays behind. Kit humanoids/creatures build one themselves; kit.dismemberable() builds one for custom meshes.
  const SEV_SPEED = { slash: 3.4, pierce: 2.2, blunt: 5, explosion: 6, fire: 2, frost: 2, shock: 2.5, magic: 3 };
  const LCH = { slash: 1.25, explosion: 1.1, blunt: 0.3, pierce: 0.22 }; // sever chance per (damage / max hp)
  const GIB_COLORS = { blood: [0xb01018, 0x8a0c12, 0xd8a090], bones: [0xece6d0, 0xcfc6aa], sparks: [0x6a6e76, 0x3a3d44, 0x8d96a0], slime: [0x6edc4a, 0x4cb830] };
  const stumpMats = {};
  function stumpMat(gore) {
    let m = stumpMats[gore];
    if (!m) {
      const mk = (c, e) => { const mm = new THREE.MeshLambertMaterial({ color: c, emissive: e }); mm.userData.keep = true; return mm; };
      m = stumpMats[gore] = gore === 'bones' ? mk(0xe9e1c8, 0x1a1810) : gore === 'sparks' ? mk(0x2a2a30, 0x7a2a08) : gore === 'slime' ? mk(0x5fd23c, 0x1a4a0c) : gore === 'none' ? mk(0x6a5048, 0x000000) : mk(0xb0121a, 0x3a0408);
    }
    return m;
  }
  const newInfo = () => ({ kind: 'blunt', amount: 0, from: undefined, by: undefined, hand: undefined, point: new Vector3(), direction: new Vector3(0, 0, 1), hasDir: false });
  const infoOf = (T) => (T.d ? T.d.lastHit : T.dummy);

  function makeTarget(group, frame, def, o) {
    const T = {
      d: null, group, frame, gore: o.gore ?? 'blood', actor: o.actor ?? null, kind: def.kind ?? 'generic', h: def.h ?? 1.7,
      limbs: {}, names: [], pub: {}, core: def.core ?? [], coreCenter: def.coreCenter ? def.coreCenter.clone() : new Vector3(0, 0.8, 0),
      bodyCenter: def.bodyCenter ? def.bodyCenter.clone() : new Vector3(0, 0.8, 0), coreR: def.coreR ?? 0.2, torso: def.torso ?? null,
      waist: def.waist ?? null, style: null, dummy: newInfo(), heldLimb: def.heldLimb ?? null,
    };
    for (const name of Object.keys(def.limbs)) {
      const L = def.limbs[name];
      L.name = name; L.attached = true; L.T = T; L.weight ??= 1; L.kind ??= 'part'; L.vital = !!L.vital; L.axis ??= new Vector3(0, 1, 0);
      L.sdir ??= new Vector3(0, 1, 0);
      L.sever = (dir) => impl.severPub(T, L, dir);
      T.limbs[name] = L; T.names.push(name); T.pub[name] = L;
    }
    const alias = def.alias ?? {};
    for (const al of Object.keys(alias)) if (T.limbs[alias[al]]) T.pub[al] = T.limbs[alias[al]];
    return T;
  }
  function attachGore(d, T) { d.gore = T; T.d = d; return T; }

  // part holders: reparent objects (keeping their world transform) into a Group centred on the part, then simulate that Group
  function groupPart(frame, localCenter, objs, o) {
    frame.updateWorldMatrix(true, true);
    frame.matrixWorld.decompose(sP, sQ, sS);
    const c = localCenter.clone().multiply(sS).applyQuaternion(sQ).add(sP);
    const holder = new THREE.Group();
    holder.position.copy(c); holder.quaternion.copy(sQ); holder.scale.copy(sS);
    ctx.root.add(holder); holder.updateMatrixWorld(true);
    for (const ob of objs) holder.attach(ob);
    return newPart(holder, o);
  }
  const bodyCenterOf = (T, out) => (T.d ? T.d.center(out) : T.group.getWorldPosition(out));
  // A limb has no scene object while a model body's glTF is still loading (or for a rig that never mapped it): such a limb has no place to
  // cut, so searches skip it (hasObj) and anything that only needs a position falls back to `fb` (default: the body's centre).
  const hasObj = (L) => !!(L && L.obj && L.obj.matrixWorld);
  function limbWorld(L, out, fb) {
    if (hasObj(L)) return out.copy(L.center).applyMatrix4(L.obj.matrixWorld);
    return fb ? out.copy(fb) : L && L.T ? bodyCenterOf(L.T, out) : out.set(0, 0, 0);
  }

  function severLimb(T, L, dirIn, o) {
    o = o || {};
    if (!L.attached) return false;
    const I = infoOf(T), a = T.actor, obj = L.obj, gore = T.gore, quiet = !!o.quiet;
    L.attached = false;
    const dir = new Vector3().copy(dirIn || I.direction);
    if (dir.lengthSq() < 1e-6) dir.set(rand(-1, 1), 0.3, rand(-1, 1));
    dir.normalize();
    let holder, sp, nrm, rr = L.r, axisL = L.axis, job = null;
    if (L.model) { // a limb of a model body: cut its triangles out of the skinned mesh, collapse its bones (see model bodies)
      const R = modelDetach(a, T, L, dir);
      holder = R.holder; sp = R.sp; nrm = R.nrm; rr = R.r; axisL = R.axis; job = R.job;
      if (R.stump) { L.stump = R.stump; L.sdir = R.sdir; }
    } else {
      obj.updateWorldMatrix(true, false);
      obj.matrixWorld.decompose(sP, sQ, sS);
      const wc = L.center.clone().multiply(sS).applyQuaternion(sQ).add(sP);
      holder = new THREE.Group();
      holder.position.copy(wc); holder.quaternion.copy(sQ); holder.scale.copy(sS);
      ctx.root.add(holder); holder.updateMatrixWorld(true);
      holder.attach(obj);
      sp = L.joint.clone().sub(L.center); nrm = sp.lengthSq() > 1e-8 ? sp.clone().normalize() : new Vector3(0, 1, 0);
    }
    const P = newPart(holder, { r: rr, axis: axisL, gore, stumps: [{ pos: sp, dir: nrm }], kind: 'limb' });
    if (job) enqueueCut(job, P, null); // model body: the real cut follows within a few frames
    const kind = I.kind;
    let spd = (SEV_SPEED[kind] ?? 3) * rand(0.75, 1.25) * (o.power ?? 1);
    if (T.d) spd *= 0.85 + Math.min(1, I.amount / Math.max(1, T.d.maxHp)) * 0.4;
    P.v.copy(dir).multiplyScalar(spd);
    P.v.y += rand(1.4, 3.2) + (kind === 'explosion' ? rand(1.5, 3) : 0);
    if (P.v.lengthSq() > 144) P.v.multiplyScalar(12 / P.v.length()); // never faster than 12 m/s
    P.w.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(5, 13));
    // the stump left on the body
    if (L.stump && !quiet) {
      L.stump.material = stumpMat(gore); L.stump.visible = true;
      if (gore !== 'none') addBleed({ obj: L.stump, dir: L.sdir, T: 2.4, s: 1, gore });
    }
    if (gore !== 'none') addBleed({ part: P, i: 0, T: quiet ? 1.2 : 2.0, s: 0.8, gore });
    // spurt from the cut
    const wp = new Vector3(), wd = new Vector3();
    partStump(P, 0, wp, wd);
    if (gore !== 'none') spurt(gore, wp, wd, quiet ? 8 : 20, quiet ? 2.6 : 3.4);
    if (!quiet) {
      gsnd(SOUND_KIND[kind] ?? 'slash', wp, 1.1);
      const hand = I.hand || (I.by === 'left' || I.by === 'right' ? I.by : I.by && I.by.hand); // whoever swung it, if we know
      if (hand === 'left' || hand === 'right') haptic(hand, 0.95, 90);
    }
    if (a) limbLost(a, T, L, P);
    ctx.events.emit('limb:severed', { actor: a, target: T.d, limb: L.name, kind, by: I.by, part: P });
    if (L.vital && T.d && T.d.alive) { T.forceStyle = 'headless'; T.d.hp = 0; die(T.d); } // losing the head kills
    return true;
  }
  const SOUND_KIND = { slash: 'slash', pierce: 'pierce', blunt: 'blunt', explosion: 'burst', fire: 'slash', frost: 'frost', shock: 'shock', magic: 'magic' };
  function severPub(T, L, dir) {
    if (!L.attached || state.goreLevel === 'off') return false;
    const I = infoOf(T);
    I.kind = 'slash'; I.amount = (T.d ? T.d.maxHp : 20) * 0.5; I.by = undefined; I.hand = undefined; I.hasDir = true;
    if (T.group.updateWorldMatrix) T.group.updateWorldMatrix(true, true);
    limbWorld(L, I.point);
    if (dir && (dir.x || dir.y || dir.z)) I.direction.set(dir.x, dir.y, dir.z).normalize();
    else I.direction.set(rand(-1, 1), 0.2, rand(-1, 1)).normalize();
    return severLimb(T, L, I.direction, {});
  }
  impl.severPub = severPub;

  // what an actor can still do after losing a limb (combat.js reads these; the 'limb:severed' event announces the change)
  function limbLost(a, T, L, P) {
    if (L.kind === 'arm') a.armsLeft = Math.max(0, a.armsLeft - 1);
    else if (L.kind === 'leg') { a.legsLeft = Math.max(0, a.legsLeft - 1); a.legMul = legSpeedMul(a); }
    else if (L.kind === 'head') a.hasHead = false;
    if (T.heldLimb === L.name) dropHeld(a, P);
    a.lastSevered = L.name;
    if (a.onSever) safe('onSever', a.onSever, L.name, a);
  }
  function legSpeedMul(a) {
    if (a.legsTotal <= 0) return 1;
    if (a.legsTotal === 2) return a.legsLeft >= 2 ? 1 : a.legsLeft === 1 ? 0.38 : 0.14;
    return Math.max(0.18, Math.pow(a.legsLeft / a.legsTotal, 1.4));
  }
  // the held weapon: a known type becomes a real pickup (world.weapons); otherwise its model simply stays on the severed arm
  function dropHeld(a, P) {
    const obj = a.held;
    if (!obj) return;
    a.held = null;
    const type = a.heldType || (obj.userData && (obj.userData.weaponType || obj.userData.weapon)) || null;
    const W = ctx.world.weapons;
    if (!type || !W || !W.create || !W.types) return;
    let known = false;
    try { known = W.types().includes(String(type)); } catch (err) { known = false; }
    if (!known) return;
    obj.updateWorldMatrix(true, false);
    const pos = new Vector3().setFromMatrixPosition(obj.matrixWorld);
    let w = null;
    try { w = W.create(a.ctx || ctx, String(type), { position: pos }); } catch (err) { w = null; }
    if (w && w.body) { obj.removeFromParent(); w.body.velocity.copy(P.v).multiplyScalar(0.8); w.body.velocity.y += 1; a.heldType = null; }
  }

  // ---- reacting to hits and deaths (called by damageable.hit)
  function hitSpurt(T, I, lethal) {
    if ((I.kind === 'fire' || I.kind === 'frost' || I.kind === 'shock' || I.kind === 'magic') && T.gore !== 'sparks') return;
    const n = clamp(Math.round(3 + I.amount * 0.5), 3, 16);
    gD.copy(I.direction).multiplyScalar(2.2);
    goreFx(T.gore, 'spurt', I.point, n, gD, 0.7);
    if (n > 8 && isFull()) splatAhead(I.point, gD, rand(0.25, 0.5), T.gore);
  }
  function goreHitImpl(d, lethal) {
    const T = d.gore, I = d.lastHit;
    if (!T || state.goreLevel === 'off') return;
    hitSpurt(T, I, lethal);
    if (lethal || !T.names.length) return;
    const k = LCH[I.kind];
    if (!k) return;
    const ratio = I.amount / Math.max(1, d.maxHp);
    if (ratio < 0.06) return;
    T.group.updateWorldMatrix(true, true);
    if (I.kind === 'explosion') { // several parts at once, nearer the blast = likelier
      for (let i = 0; i < T.names.length; i++) {
        const L = T.limbs[T.names[i]];
        if (!L || !L.attached || !hasObj(L)) continue;
        const wc = limbWorld(L, new Vector3()), dist = wc.distanceTo(I.point);
        if (Math.random() < clamp(ratio * k * (1.2 - 0.4 * Math.min(1, dist / 2.5)), 0, 0.95) * L.weight) {
          wc.sub(I.point); wc.y += 0.4;
          severLimb(T, L, wc, {});
          if (!d.alive) break;
        }
      }
      return;
    }
    let best = null, bd = Infinity; // slash / blunt / pierce: the limb nearest the hit, unless the torso is nearer
    for (let i = 0; i < T.names.length; i++) {
      const L = T.limbs[T.names[i]];
      if (!L || !L.attached || !hasObj(L)) continue;
      const dist = limbWorld(L, gA).distanceTo(I.point);
      if (dist < bd) { bd = dist; best = L; }
    }
    if (!best || bd > T.h * 0.45) return;
    T.frame.localToWorld(gB.copy(T.coreCenter));
    if (gB.distanceTo(I.point) * 0.8 < bd && T.kind !== 'generic') return;
    if (Math.random() < clamp(ratio * k, 0, 0.92) * best.weight) severLimb(T, best, null, {});
  }
  impl.goreHit = goreHitImpl;

  function chooseStyle(T, I) {
    if (T.deathOverride) return T.deathOverride; // e.g. ghosts always 'fade'
    if (state.goreLevel === 'off') return 'fall';
    switch (I.kind) {
      case 'slash':
        if (T.kind === 'humanoid') {
          const gy = T.actor ? T.actor.position.y : I.point.y, rel = (I.point.y - gy) / T.h;
          if (rel > 0.3 && rel < 0.7 && Math.random() < 0.55) return 'bisect';
        }
        return 'decapitate';
      case 'explosion': return T.kind === 'generic' || !T.actor || I.amount >= T.d.maxHp * 1.6 || !PH() ? 'burst' : 'launch'; // a modest blast throws a ragdoll; overkill bursts it
      case 'blunt': return T.kind === 'generic' ? 'fall' : 'launch';
      case 'fire': return 'char';
      case 'frost': return 'shatter';
      case 'shock': case 'magic': return 'disintegrate';
      default: return 'fall';
    }
  }
  function goreKillImpl(d) {
    const T = d.gore, I = d.lastHit, a = T.actor;
    d.flash = 0;
    const style = T.forceStyle || chooseStyle(T, I);
    T.forceStyle = null;
    T.style = style === 'headless' ? 'decapitate' : style;
    if (a) a.deathStyle = T.style;
    switch (style) {
      case 'decapitate': styleDecap(T, I); break;
      case 'bisect': styleBisect(T, I); break;
      case 'burst': styleBurst(T, I); break;
      case 'launch': styleLaunch(T, I); break;
      case 'char': styleChar(T, I); break;
      case 'shatter': styleShatter(T, I); break;
      case 'disintegrate': styleDisintegrate(T, I); break;
      case 'fade': if (T.actor) T.actor.fx = { style: 'fade', t: 0, mats: null, acc: 0 }; break;
      default: styleFall(T, I);
    }
  }
  impl.goreKill = goreKillImpl;

  function styleFall(T, I) {
    if (T.actor && tryRagdoll(T, I)) { // the body goes limp and falls as jointed bodies
      if (T.actor.gore !== 'bones' && T.actor.gore !== 'none') { const c = bodyCenterOf(T, new Vector3()); placeSplat(c.x, c.z, rand(0.9, 1.4), T.gore, 0.9); }
      return;
    }
    if (!T.actor || T.gore === 'bones' || T.gore === 'none') return;
    const c = bodyCenterOf(T, new Vector3());
    placeSplat(c.x, c.z, rand(0.9, 1.4), T.gore, 0.6);
  }
  function styleDecap(T, I) {
    let L = T.limbs.head;
    if (!L || !L.attached) {
      L = null;
      let bd = Infinity;
      if (T.names.length) {
        T.group.updateWorldMatrix(true, true);
        for (let i = 0; i < T.names.length; i++) { const q = T.limbs[T.names[i]]; if (!q || !q.attached || !hasObj(q)) continue; const dd = limbWorld(q, gA).distanceTo(I.point); if (dd < bd) { bd = dd; L = q; } }
      }
    }
    if (L) severLimb(T, L, I.direction, { power: 1.2 });
    else { const c = bodyCenterOf(T, new Vector3()); gsnd('slash', c, 1); }
    styleFall(T, I);
  }
  function styleBisect(T, I) {
    const a = T.actor;
    if (a && a.mdl && !a.mdl.fell) { if (!modelBisect(T, I)) styleDecap(T, I); return; }
    if (!a || T.kind !== 'humanoid' || !T.torso) { styleDecap(T, I); return; }
    const piv = T.frame, h = T.h, gore = T.gore, dir = I.direction.clone();
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(rand(-1, 1), 0, rand(-1, 1));
    dir.normalize();
    piv.updateWorldMatrix(true, true);
    const up = [], lo = [];
    for (const n of ['head', 'armL', 'armR']) { const L = T.limbs[n]; if (L && L.attached) { L.attached = false; up.push(L.obj); } }
    up.push(T.torso);
    if (T.waist) { T.waist.material = stumpMat(gore); T.waist.visible = true; up.push(T.waist); }
    for (const n of ['legL', 'legR']) {
      const L = T.limbs[n];
      if (L && L.attached) { L.attached = false; lo.push(L.obj); if (L.stump) { L.stump.material = stumpMat(gore); L.stump.visible = true; lo.push(L.stump); } }
    }
    const upP = groupPart(piv, new Vector3(0, 0.66 * h, 0), up, { whole: true, r: 0.12 * h, gore, kind: 'half', stumps: [{ pos: new Vector3(0, -0.19 * h, 0), dir: new Vector3(0, -1, 0) }] });
    const loP = groupPart(piv, new Vector3(0, 0.24 * h, 0), lo, { whole: true, r: 0.1 * h, gore, kind: 'half', stumps: [{ pos: new Vector3(0, 0.23 * h, 0), dir: new Vector3(0, 1, 0) }] });
    upP.v.copy(dir).multiplyScalar(rand(2.6, 4)); upP.v.y = rand(2.5, 3.8); upP.w.set(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).multiplyScalar(rand(3, 6));
    loP.v.copy(dir).multiplyScalar(rand(0.8, 1.6)); loP.v.y = rand(0.8, 1.6); loP.w.set(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).multiplyScalar(rand(2, 4));
    a.armsLeft = 0; a.legsLeft = 0; a.legMul = 0.14;
    dropHeld(a, upP);
    if (gore !== 'none') {
      addBleed({ part: upP, i: 0, T: 2.6, s: 1.4, gore }); addBleed({ part: loP, i: 0, T: 2.6, s: 1.2, gore });
      const wp = new Vector3(), wd = new Vector3();
      partStump(upP, 0, wp, wd); spurt(gore, wp, wd, 26, 3.2, rand(0.8, 1.2));
      partStump(loP, 0, wp, wd); spurt(gore, wp, wd, 18, 2.6, rand(0.6, 1));
    }
    gsnd('slash', bodyCenterOf(T, new Vector3()), 1.4);
    a.gibbed = true; a.gibT = 0.05;
  }
  function styleBurst(T, I) {
    const a = T.actor, gore = T.gore, c = bodyCenterOf(T, new Vector3()), origin = I.point.clone();
    T.group.updateWorldMatrix(true, true);
    for (let i = 0; i < T.names.length; i++) {
      const L = T.limbs[T.names[i]];
      if (!L || !L.attached) continue;
      const dir = limbWorld(L, new Vector3(), origin).sub(origin); // (a limb with no object yet flies off in a random direction) // outward from the blast, flatter than straight up
      dir.y = 0;
      if (dir.lengthSq() < 0.04) dir.set(rand(-1, 1), 0, rand(-1, 1));
      dir.normalize(); dir.y = 0.3; dir.normalize();
      severLimb(T, L, dir, { quiet: true, power: 1.1 });
    }
    const out = c.clone().sub(origin); out.y = Math.max(out.y, 0) + 0.3; if (out.lengthSq() < 1e-4) out.set(0, 1, 0); out.normalize();
    if (a && a.mdl && !a.mdl.fell) { // a model body: the torso is cut out of the skinned mesh and the rest of the model disappears
      const P = modelCore(a, T);
      if (P) {
        P.v.copy(out).multiplyScalar(rand(2.5, 4.5)); P.v.y += rand(1.5, 2.8); P.w.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(rand(4, 9));
        if (gore !== 'none') addBleed({ part: P, i: 0, T: 1.0, s: 0.8, gore });
      }
      a.gibbed = true; a.gibT = 0.05;
    } else if (a && T.core.length) {
      const P = groupPart(T.frame, T.coreCenter, T.core, { whole: true, r: T.coreR, gore, kind: 'core', stumps: [{ pos: new Vector3(0, T.coreR * 0.6, 0), dir: new Vector3(0, 1, 0) }] });
      P.v.copy(out).multiplyScalar(rand(2.5, 4.5)); P.v.y += rand(1.5, 2.8); P.w.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(rand(4, 9));
      if (gore !== 'none') addBleed({ part: P, i: 0, T: 1.0, s: 0.8, gore });
      a.gibbed = true; a.gibT = 0.05;
    } else if (!a) { // an opaque custom object: scatter its volume and hide it
      debrisForObject(T.group, 'earth', { count: 12, power: 5, direction: out, shape: 'block', size: 0.8 });
      T.group.visible = false;
    }
    if (state.goreLevel === 'full' && GIB_COLORS[gore]) chunkBurst(c, 8, { colors: GIB_COLORS[gore], power: 5, size: [0.06, 0.14], shape: gore === 'sparks' ? 'plate' : 'clod', direction: out });
    gD.set(0, 2.5, 0);
    goreFx(gore, 'mist', c, 16, gD, 1.6);
    goreFx(gore, 'spurt', c, 44, gD, 1.5);
    for (let i = 0; i < 7; i++) {
      const an = Math.random() * 6.283, r = rand(0.5, 2.3);
      placeSplat(c.x + Math.cos(an) * r, c.z + Math.sin(an) * r, rand(0.7, 1.5), gore, rand(0.15, 0.7));
    }
    gsnd('burst', c, 1.25);
  }
  function styleLaunch(T, I) {
    const a = T.actor;
    if (!a) return;
    const gore = T.gore, dir = I.direction.clone();
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(rand(-1, 1), 0, rand(-1, 1));
    dir.normalize();
    if (tryRagdoll(T, I)) { // physics ragdoll instead of one flying slab
      gD.copy(dir).multiplyScalar(2.5);
      goreFx(gore, 'spurt', I.point, 16, gD, 1.2);
      goreFx(gore, 'mist', I.point, 5, gD, 1);
      gsnd('blunt', I.point, 1.1);
      return;
    }
    const P = groupPart(T.frame, T.bodyCenter, [T.frame], { whole: true, r: T.coreR * 0.8, gore, kind: 'body', actor: a, axis: new Vector3(0, 1, 0) });
    const spd = clamp(5 + I.amount * 0.1, 5, 9);
    P.v.copy(dir).multiplyScalar(spd); P.v.y = rand(3.5, 5.5);
    P.w.crossVectors(dir, UPV).multiplyScalar(rand(5, 9) * rsign()).addScaledVector(gA.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)), 2);
    gD.copy(dir).multiplyScalar(2.5);
    goreFx(gore, 'spurt', I.point, 16, gD, 1.2);
    goreFx(gore, 'mist', I.point, 5, gD, 1);
    gsnd('blunt', I.point, 1.1);
    a.gibbed = true; a.gibT = Infinity; // the actor lives on inside the flying body and is removed with it
  }
  function styleChar(T, I) {
    const c = bodyCenterOf(T, new Vector3());
    gsnd('fire', c, 0.9);
    if (T.actor) { T.actor.fx = { style: 'char', t: 0, mats: null, acc: 0 }; return; }
    const g = T.group;
    for (let i = 0; i < 6; i++) after(i * 0.12, () => { const F = fx(); F.ember.emit(c, 6, UPV, 1); F.smoke.emit(c, 2, UPV, 1); });
    after(0.8, () => { const F = fx(); F.ash.emit(c, 30, UPV, 1.2); g.visible = false; });
  }
  function styleShatter(T, I) {
    if (T.actor) { T.actor.fx = { style: 'shatter', t: 0, mats: null }; return; }
    shatterNow(T);
  }
  function shatterNow(T) {
    const I = infoOf(T), c = bodyCenterOf(T, new Vector3()), F = fx();
    debrisForObject(T.group, 'ice', { count: 24, power: 3.4, direction: I.direction, size: 0.9 });
    F.ice.emit(c, 26, undefined, 1.2); F.glint.emit(c, 18, undefined, 1); F.puff.emit(c, 8, undefined, 1);
    gsnd('frost', c, 1.2);
    T.group.visible = false;
    if (T.actor) { T.actor.gibbed = true; T.actor.gibT = 0.1; }
  }
  const GLOWS = { shock: [0x55d8ff, 'shock'], magic: [0xb070ff, 'magic'] };
  function styleDisintegrate(T, I) {
    const g = GLOWS[I.kind] || GLOWS.magic;
    if (T.actor) { T.actor.fx = { style: 'disintegrate', t: 0, mats: null, glow: new Color(g[0]), fxName: g[1], acc: 0, kind: I.kind }; return; }
    const c = bodyCenterOf(T, new Vector3()), grp = T.group;
    after(0.15, () => { const F = fx(); F[g[1]].emit(c, 40, UPV, 1.4); gsnd(I.kind === 'shock' ? 'shock' : 'magic', c, 1); grp.visible = false; });
  }

  // ------------------------------------------------------------------ ragdolls: a dead actor becomes jointed Rapier bodies (core/physics.js)
  // KayKit rig (heroes, goblins, orcs, skeletons ...): 11 bodies (pelvis, torso, head, 2x upper/lower arm, 2x upper/lower leg) built from the CURRENT
  // animated pose, with hinge elbows/knees and cone-limited ball joints. Every bone is carried rigidly by one body; each frame the bones'
  // rotations (and the hips' position) are written back, so the skinned mesh flops. Frames of the bodies are "rest aligned": rotated by the bone's
  // bind-pose inverse so that in the T-pose every body frame equals the model frame, which makes joint axes and limits mean the same thing for
  // every body. Primitive humanoids ragdoll from their limb meshes (6 bodies). Anything else tumbles as one body (styleLaunch's part).
  const KK_NEED = ['hips', 'spine', 'chest', 'head', 'upperarml', 'lowerarml', 'wristl', 'handl', 'upperarmr', 'lowerarmr', 'wristr', 'handr', 'upperlegl', 'lowerlegl', 'footl', 'toesl', 'upperlegr', 'lowerlegr', 'footr', 'toesr'];
  const KK_CARRY = {
    pelvis: ['hips'], torso: ['spine', 'chest'], head: ['head'],
    armUL: ['upperarml'], armLL: ['lowerarml', 'wristl', 'handl', 'handslotl'], armUR: ['upperarmr'], armLR: ['lowerarmr', 'wristr', 'handr', 'handslotr'],
    legUL: ['upperlegl'], legLL: ['lowerlegl', 'footl', 'toesl'], legUR: ['upperlegr'], legLR: ['lowerlegr', 'footr', 'toesr'],
  };
  const KK_LIMB = { armUL: 'armL', armLL: 'armL', armUR: 'armR', armLR: 'armR', legUL: 'legL', legLL: 'legL', legUR: 'legR', legLR: 'legR', head: 'head' };
  const rQ1 = new Quaternion(), rQ2 = new Quaternion(), rQ3 = new Quaternion(), rM1 = new Matrix4(), rM2 = new Matrix4();
  const rV1 = new Vector3(), rV2 = new Vector3(), rV3 = new Vector3(), rV4 = new Vector3();

  // base velocity of a dying body: its own motion plus the blow
  function deathVelocity(a, I, out) {
    out.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)).multiplyScalar(a.speedNow * 0.8);
    const k = I.kind === 'explosion' ? 6 : I.kind === 'blunt' ? clamp(3 + I.amount * 0.03, 3, 5.5) : I.kind === 'pierce' ? 1.8 : I.kind === 'slash' ? 2 : 1.2;
    rV4.copy(I.direction); rV4.y = 0;
    if (rV4.lengthSq() < 1e-4) rV4.set(rand(-1, 1), 0, rand(-1, 1));
    rV4.normalize();
    out.addScaledVector(rV4, k);
    out.y += I.kind === 'explosion' ? 4 : I.kind === 'blunt' ? 2.2 : 0.6;
    return out;
  }


  // per-model collider fit: the extents of the mesh vertices owned (dominant skin weight) by each ragdoll body, in bind-space axes (the rest pose:
  // T-pose, facing +Z), relative to the body's frame bone. Cached per geometry.
  const KK_FRAME = { pelvis: 'hips', torso: 'spine', head: 'head', armUL: 'upperarml', armLL: 'lowerarml', armUR: 'upperarmr', armLR: 'lowerarmr', legUL: 'upperlegl', legLL: 'lowerlegl', legUR: 'upperlegr', legLR: 'lowerlegr' };
  function kkFit(M) {
    const key = M.skins.map((sm) => sm.geometry.uuid).join('|');
    state.kkFit ??= new Map();
    let F = state.kkFit.get(key);
    if (F) return F;
    const owner = new Map();
    for (const part of Object.keys(KK_CARRY)) for (const n of KK_CARRY[part]) owner.set(n, part);
    const acc = {}, restP = new Map();
    for (const sm of M.skins) {
      const sk = sm.skeleton, bn = sk.bones.map((b) => b.name), part = bn.map((n) => owner.get(n) || null);
      sk.bones.forEach((b, i) => restP.set(b.name, new Vector3().setFromMatrixPosition(new Matrix4().copy(sk.boneInverses[i]).invert())));
      const pa = sm.geometry.attributes.position, si = sm.geometry.attributes.skinIndex, sw = sm.geometry.attributes.skinWeight;
      if (!pa || !si || !sw) return null;
      for (let v = 0; v < pa.count; v++) {
        let bj = 0, bw = -1;
        for (let j = 0; j < 4; j++) { const w = sw.getComponent(v, j); if (w > bw) { bw = w; bj = si.getComponent(v, j); } }
        const pn = part[bj];
        if (!pn) continue;
        const A = acc[pn] ??= { min: new Vector3(1e9, 1e9, 1e9), max: new Vector3(-1e9, -1e9, -1e9), n: 0 };
        const x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v);
        if (x < A.min.x) A.min.x = x; if (y < A.min.y) A.min.y = y; if (z < A.min.z) A.min.z = z;
        if (x > A.max.x) A.max.x = x; if (y > A.max.y) A.max.y = y; if (z > A.max.z) A.max.z = z;
        A.n++;
      }
    }
    F = {};
    for (const part of Object.keys(KK_FRAME)) {
      const A = acc[part], fr = restP.get(KK_FRAME[part]);
      if (!A || A.n < 6 || !fr) continue;
      F[part] = { center: A.min.clone().add(A.max).multiplyScalar(0.5), size: A.max.clone().sub(A.min), frameRest: fr.clone() };
    }
    for (const nm of ['pelvis', 'torso', 'head', 'armUL', 'armLL', 'armUR', 'armLR', 'legUL', 'legLL', 'legUR', 'legLR']) if (!F[nm]) { F[nm] = null; }
    state.kkFit.set(key, F);
    return F;
  }
  function kayKitRagdoll(a, T, I) {
    const M = a.mdl, Py = PH(), B = M.h.bones, sm = M.skins[0];
    if (!Py || !sm || !sm.skeleton) return null;
    for (const n of KK_NEED) if (!B[n]) return null;
    const sk = sm.skeleton;
    a.group.updateWorldMatrix(true, true);
    M.h.root.updateWorldMatrix(true, true);
    sm.updateWorldMatrix(true, false);
    const bind = rM1.copy(sm.bindMatrix).invert().premultiply(sm.matrixWorld), qRef = new Quaternion();
    bind.decompose(rV1, qRef, rV2);
    const bi = new Map(sk.bones.map((b, i) => [b.name, i]));
    const restQ = (name) => { const i = bi.get(name); rM2.copy(sk.boneInverses[i]).invert().premultiply(bind); rM2.decompose(rV1, rQ1, rV2); return rQ1; };
    const wp = (n) => new Vector3().setFromMatrixPosition(B[n].matrixWorld);
    const s = rV2.x || 1; // world scale of the model (bind-space units -> metres)
    const FIT = kkFit(M);
    if (!FIT) return null;
    const lost = (part) => { const L = T.limbs[KK_LIMB[part]]; return !!(L && !L.attached); };
    const defs = []; // { name, frame, parent, shape, axis, mass, joint }
    const add = (d) => { if (!KK_LIMB[d.name] || !lost(d.name)) defs.push(d); };
    add({ name: 'pelvis', frame: 'hips', parent: null, shape: 'box', mass: 10 });
    add({ name: 'torso', frame: 'spine', parent: 'pelvis', shape: 'box', mass: 16, joint: { anchor: wp('spine'), cone: 0.55 } });
    add({ name: 'head', frame: 'head', parent: 'torso', shape: 'sphere', mass: 5, joint: { anchor: wp('head'), cone: 0.85 } });
    for (const sd of ['l', 'r']) {
      const S = sd.toUpperCase(), ax = sd === 'l' ? [1, 0, 0] : [-1, 0, 0];
      add({ name: 'armU' + S, frame: 'upperarm' + sd, parent: 'torso', shape: 'capsule', axis: ax, mass: 2.2, joint: { anchor: wp('upperarm' + sd), cone: 1.9 } });
      add({ name: 'armL' + S, frame: 'lowerarm' + sd, parent: 'armU' + S, shape: 'capsule', axis: ax, mass: 1.8, joint: { anchor: wp('lowerarm' + sd), type: 'revolute', axis: [0, 1, 0], limits: sd === 'l' ? [-2.5, 0.12] : [-0.12, 2.5] } });
      add({ name: 'legU' + S, frame: 'upperleg' + sd, parent: 'pelvis', shape: 'capsule', axis: [0, -1, 0], mass: 7, joint: { anchor: wp('upperleg' + sd), cone: 1.35 } });
      add({ name: 'legL' + S, frame: 'lowerleg' + sd, parent: 'legU' + S, shape: 'capsule', axis: [0, -1, 0], mass: 4, joint: { anchor: wp('lowerleg' + sd), type: 'revolute', axis: [1, 0, 0], limits: [-0.12, 2.6] } });
    }
    const have = new Set(defs.map((d) => d.name));
    const parts = [], recs = [];
    for (const d of defs) {
      const fb = B[d.frame], fp = wp(d.frame), F = FIT[d.name];
      if (!F) continue;
      const qBone = new Quaternion().setFromRotationMatrix(rM2.extractRotation(fb.matrixWorld));
      const qBody = qBone.clone().multiply(restQ(d.frame).clone().invert()).multiply(qRef);
      const inv = qBody.clone().invert();
      // collider: the mesh's own extents in the rest-aligned body frame (bind-space axes == body-local axes), scaled to metres
      const center = F.center.clone().sub(F.frameRest).multiplyScalar(s), size = F.size.clone().multiplyScalar(s);
      let sz, cq = null;
      if (d.shape === 'sphere') sz = [Math.max(0.05, Math.max(size.y, size.z) * 0.5 * 0.94)]; // (not the width: goblin ears)
      else if (d.shape === 'box') sz = [Math.max(0.05, size.x * 0.96), Math.max(0.05, size.y * 0.96), Math.max(0.05, size.z * 0.96)];
      else {
        const ax = new Vector3(d.axis[0], d.axis[1], d.axis[2]), len = Math.abs(ax.x) * size.x + Math.abs(ax.y) * size.y + Math.abs(ax.z) * size.z;
        const perp = ax.x ? (size.y + size.z) / 2 : ax.y ? (size.x + size.z) / 2 : (size.x + size.y) / 2;
        const r = Math.max(0.03, perp * 0.5 * 0.9);
        sz = [r, Math.max(len, r * 2.2)];
        cq = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), ax);
      }
      let parent = d.parent; while (parent && !have.has(parent)) parent = parent === 'torso' ? 'pelvis' : null; // a missing link: hang from the pelvis
      const spec = { name: d.name, parent, pos: fp, quat: qBody, shape: d.shape, size: sz, center: [center.x, center.y, center.z], mass: d.mass * clamp(s, 0.5, 2), ccd: d.shape === 'capsule' };
      if (cq) spec.cquat = [cq.x, cq.y, cq.z, cq.w];
      if (d.joint) spec.joint = { anchor: d.joint.anchor, type: d.joint.type || 'spherical', axis: d.joint.axis, limits: d.joint.limits, cone: d.joint.cone };
      parts.push(spec);
      // bones carried by this body: their pose relative to the body frame
      for (const bn of KK_CARRY[d.name]) {
        const b = B[bn]; if (!b) continue;
        const bq = new Quaternion().setFromRotationMatrix(rM2.extractRotation(b.matrixWorld));
        recs.push({ bone: b, part: d.name, relQ: inv.clone().multiply(bq), relPos: bn === 'hips' ? new Vector3().setFromMatrixPosition(b.matrixWorld).sub(fp).applyQuaternion(inv) : null, root: bn === 'hips', wq: new Quaternion(), parent: null, depth: 0 });
      }
    }    // order bones parent-first and link each to its nearest carried ancestor
    const byBone = new Map(recs.map((r) => [r.bone, r]));
    for (const r of recs) { let p = r.bone.parent, dpt = 0; while (p && !byBone.has(p)) { p = p.parent; if (++dpt > 40) break; } r.parent = p ? byBone.get(p) : null; }
    for (const r of recs) { let d = 0, p = r.parent; while (p) { d++; p = p.parent; } r.depth = d; }
    recs.sort((x, y) => x.depth - y.depth);
    const vel = deathVelocity(a, I, new Vector3());
    const rd = Py.ragdoll({}, { parts, velocity: vel, maxAge: 99 }); // the actor's own linger timeline removes it
    if (!rd) return null;
    rd.kk = { recs, M };
    rd.finalize = kkFinalize;
    // variation: the blow spins the body
    const spin = rV4.set(rand(-1, 1), rand(-0.4, 0.4), rand(-1, 1)).normalize().multiplyScalar(I.kind === 'explosion' || I.kind === 'blunt' ? rand(2, 5) : rand(0.5, 1.5));
    for (const h of rd.list) h.setAngularVelocity(spin.x, spin.y, spin.z);
    // the animation hands over to physics
    if (M.h.mixer) { try { M.h.mixer.stopAllAction(); } catch (err) { /* nothing playing */ } }
    M.h._current = null; M.h.currentClip = null;
    for (const sm2 of M.skins) sm2.frustumCulled = false;
    kkFinalize(rd);
    return rd;
  }
  const kfQ = new Quaternion(), kfP = new Quaternion(), kfV = new Vector3(), kfM = new Matrix4(), kfS = new Vector3();
  function kkFinalize(rd) {
    const K = rd.kk;
    if (!K) return;
    const recs = K.recs;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i], h = rd.parts[r.part];
      if (!h) continue;
      kfQ.copy(h.rq).multiply(r.relQ);
      r.wq.copy(kfQ);
      const bone = r.bone;
      if (r.parent) kfP.copy(r.parent.wq);
      else { bone.parent.updateWorldMatrix(true, false); bone.parent.matrixWorld.decompose(kfV, kfP, kfS); }
      bone.quaternion.copy(kfP.invert().multiply(kfQ));
      if (r.root) { // the hips carry the body's position
        bone.parent.updateWorldMatrix(true, false);
        kfV.copy(r.relPos).applyQuaternion(h.rq).add(h.rp);
        kfM.copy(bone.parent.matrixWorld).invert();
        bone.position.copy(kfV.applyMatrix4(kfM));
      }
    }
  }

  // primitive (box) humanoid: torso, head, 2 arms, 2 legs as bodies carrying the existing meshes
  function holderOf(frame, localCenter, objs) {
    frame.updateWorldMatrix(true, true);
    frame.matrixWorld.decompose(sP, sQ, sS);
    const c = localCenter.clone().multiply(sS).applyQuaternion(sQ).add(sP);
    const holder = new THREE.Group();
    holder.position.copy(c); holder.quaternion.copy(sQ); holder.scale.copy(sS);
    ctx.root.add(holder); holder.updateMatrixWorld(true);
    for (const ob of objs) holder.attach(ob);
    return holder;
  }
  function primitiveRagdoll(a, T, I) {
    const Py = PH(), piv = T.frame, h = T.h;
    if (!Py || !T.torso || !T.limbs.armL || !T.limbs.armR || !T.limbs.legL || !T.limbs.legR) return null;
    piv.updateWorldMatrix(true, true);
    const vel = deathVelocity(a, I, new Vector3());
    const holders = [], specs = [];
    const world = (x, y, z) => piv.localToWorld(new Vector3(x * h, y * h, z * h));
    const mk = (name, parent, objs, lc, shape, size, mass, anchor, cone) => {
      const hold = holderOf(piv, new Vector3(lc[0] * h, lc[1] * h, lc[2] * h), objs);
      const rec = { name, holder: hold, ph: null };
      holders.push(rec);
      const spec = { name, parent, pos: hold.position.clone(), quat: hold.quaternion.clone(), shape, size, mass, ccd: true };
      if (anchor) spec.joint = { anchor, cone };
      spec.apply = (hh) => { hold.position.copy(hh.rp); hold.quaternion.copy(hh.rq); };
      specs.push(spec);
    };
    const sc = h * piv.getWorldScale(rV3).x;
    mk('torso', null, [T.torso], [0, 0.625, 0], 'box', [0.28 * sc, 0.31 * sc, 0.16 * sc], 18);
    if (T.limbs.head.attached) mk('head', 'torso', [T.limbs.head.obj], [0, 0.9, 0], 'sphere', [0.1 * sc], 5, world(0, 0.8, 0), 0.9);
    for (const [nm, sx] of [['armL', 0.18], ['armR', -0.18]]) if (T.limbs[nm].attached) mk(nm, 'torso', [T.limbs[nm].obj], [sx, 0.59, 0], 'capsule', [0.045 * sc, 0.34 * sc], 3, world(sx, 0.76, 0), 1.9);
    for (const [nm, sx] of [['legL', 0.075], ['legR', -0.075]]) if (T.limbs[nm].attached) mk(nm, 'torso', [T.limbs[nm].obj], [sx, 0.235, 0], 'capsule', [0.06 * sc, 0.47 * sc], 7, world(sx, 0.47, 0), 1.3);
    const rd = Py.ragdoll({}, { parts: specs, velocity: vel, maxAge: 99 });
    if (!rd) { for (const r of holders) { for (const c of r.holder.children.slice()) piv.attach(c); r.holder.removeFromParent(); } return null; }
    for (const r of holders) r.ph = rd.parts[r.name];
    rd.holders = holders;
    const spin = rV4.set(rand(-1, 1), rand(-0.4, 0.4), rand(-1, 1)).normalize().multiplyScalar(rand(1, 3));
    for (const hh of rd.list) hh.setAngularVelocity(spin.x, spin.y, spin.z);
    const hold = a.held; if (hold) a.held = null; // the weapon stays in the hand it is parented to
    void hold;
    return rd;
  }

  // called when an actor dies (before its death animation would start). Returns true when physics took over the body.
  function tryRagdoll(T, I) {
    const a = T.actor, Py = PH();
    if (!Py || !a || a.rag || T.deathOverride || a.removed) return false;
    if (Py.pressure > 0.9) return false;
    if (a.mdl && a.mdl.fell) return false;
    let rd = null;
    try {
      if (a.mdl) { if (a.mdl.ready && a.mdl.rigName === 'kaykit-medium' && a.mdl.skins.length) rd = kayKitRagdoll(a, T, I); }
      else if (T.kind === 'humanoid' && T.torso) rd = primitiveRagdoll(a, T, I);
    } catch (err) { console.error('[kit] ragdoll failed; using the old death', err); rd = null; }
    if (!rd) return false;
    a.rag = rd; a.deathStyle = a.deathStyle || 'ragdoll';
    rd.actor = a;
    if (!rd.holders || !rd.kk) { /* primitive: meshes were moved into holders */ }
    reg.rags.push(rd);
    const P = { v: new Vector3().copy(rd.list[0] ? rd.list[0].velocity : rV1.set(0, 0, 0)) };
    dropHeld(a, P); // a weapon with a known type becomes its own pickup
    a.ragdoll = true;
    ctx.events.emit('actor:ragdoll', { actor: a, rag: rd });
    return true;
  }

  // timelines for kit actors that die in place (fire / frost / shock / magic); called from stepActor while a.dead
  const CHARC = new Color(0x120f0d), ICEC = new Color(0xbfe6f8);
  function collectMats(group) {
    const out = [], seen = new Set();
    group.traverse((m) => {
      for (const mm of [].concat(m.material ?? [])) if (mm && mm.color && !seen.has(mm) && !(mm.userData && mm.userData.keep)) { seen.add(mm); out.push({ m: mm, c: mm.color.clone() }); }
    });
    return out;
  }
  function stepDeathFx(a, dt) {
    const f = a.fx, T = a.T, t = (f.t += dt), F = fx();
    if (!f.mats) { if (a.mdl) modelOwnMats(a.mdl); f.mats = collectMats(a.group); } // model materials are shared: take private copies first
    switch (f.style) {
      case 'fade': { // ghosts: thin out and puff away
        const k = Math.min(1, t / 0.9);
        for (const e of f.mats) { e.m.transparent = true; e.m.depthWrite = false; e.m.opacity = 1 - k; }
        f.acc += dt * 20; const n = f.acc | 0; f.acc -= n;
        if (n && t < 0.9) { gE.set(a.position.x + rand(-0.25, 0.25), a.position.y + rand(0.1, 0.9) * a.height, a.position.z + rand(-0.25, 0.25)); F.puff.emit(gE, n, UPV, 0.7); }
        if (t >= 1) { a.group.visible = false; a.gibbed = true; a.gibT = 0.1; }
        break;
      }
      case 'char': {
        const k = Math.min(1, t / 0.9);
        for (const e of f.mats) e.m.color.copy(e.c).lerp(CHARC, k * 0.94);
        f.acc += dt * 38;
        const n = f.acc | 0; f.acc -= n;
        if (n && t < 1.6) {
          gE.set(a.position.x + rand(-0.25, 0.25), a.position.y + rand(0.05, 0.5) * a.height, a.position.z + rand(-0.25, 0.25));
          F.ember.emit(gE, n, UPV, 0.9); if (Math.random() < 0.5) F.smoke.emit(gE, 1, UPV, 0.8);
        }
        if (t >= 1.7) {
          gE.set(a.position.x, a.position.y + a.height * 0.3, a.position.z);
          F.ash.emit(gE, 36, UPV, 1.3); F.smoke.emit(gE, 6, UPV, 1.1);
          chunkBurst(gE, 5, { colors: [0x1a1512, 0x2c2420], power: 2, size: [0.05, 0.1], shape: 'block' });
          a.group.visible = false; a.gibbed = true; a.gibT = 0.1;
        }
        break;
      }
      case 'shatter': {
        a.fxHold = true;
        const k = Math.min(1, t / 0.1);
        for (const e of f.mats) { e.m.color.copy(e.c).lerp(ICEC, 0.75 * k); if (e.m.emissive) e.m.emissive.setRGB(0.08 * k, 0.2 * k, 0.28 * k); }
        if (t >= 0.13) shatterNow(T);
        break;
      }
      default: { // disintegrate
        a.fxHold = true;
        const k = Math.min(1, t / 0.32);
        for (const e of f.mats) if (e.m.emissive) e.m.emissive.copy(f.glow).multiplyScalar(k * 1.1);
        f.acc += dt * 60;
        const n = f.acc | 0; f.acc -= n;
        if (n && t < 0.34) { gE.set(a.position.x + rand(-0.2, 0.2), a.position.y + rand(0.1, 0.95) * a.height, a.position.z + rand(-0.2, 0.2)); F[f.fxName].emit(gE, n, UPV, 0.8); }
        if (t >= 0.34) {
          gE.set(a.position.x, a.position.y + a.height * 0.5, a.position.z);
          F[f.fxName].emit(gE, 44, UPV, 1.5);
          gsnd(f.kind === 'shock' ? 'shock' : 'magic', gE, 1);
          a.group.visible = false; a.gibbed = true; a.gibT = 0.1;
        }
      }
    }
  }

  // custom meshes: kit.dismemberable(ctx, damageable, [{ name, object3D, vital }], { gore }) -> { limbs, sever(name, dir) }
  function dismemberable(c, d, parts, o = {}) {
    if (!d || !d.object || !Array.isArray(parts)) return null;
    const group = d.object, gore = o.gore ?? 'blood';
    group.updateWorldMatrix(true, true);
    const gbox = new THREE.Box3().setFromObject(group), gc = gbox.getCenter(new Vector3()), gsize = gbox.getSize(new Vector3());
    const defs = {};
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] || {}, obj = p.object3D ?? p.object ?? p.obj;
      if (!obj) continue;
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) continue;
      const size = box.getSize(new Vector3()), cw = box.getCenter(new Vector3()), jw = gc.clone().clamp(box.min, box.max);
      const center = obj.worldToLocal(cw.clone()), joint = obj.worldToLocal(jw.clone());
      const axis = center.clone().sub(joint);
      if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
      axis.normalize();
      const r = clamp(Math.min(size.x, size.y, size.z) * 0.5, 0.04, 0.3);
      const stump = new THREE.Mesh(geos().sphere, stumpMat(gore));
      stump.visible = false;
      const par = obj.parent || group;
      par.add(stump);
      stump.position.copy(par.worldToLocal(jw.clone()));
      stump.scale.setScalar(r * 0.9);
      defs[p.name ?? `part${i}`] = { obj, kind: 'part', center, joint, r, axis, vital: !!p.vital, stump, sdir: new Vector3(0, 1, 0) };
    }
    const T = makeTarget(group, group, { kind: 'generic', limbs: defs, h: Math.max(0.3, gsize.y), coreCenter: group.worldToLocal(gc.clone()), bodyCenter: group.worldToLocal(gc.clone()) }, { gore });
    attachGore(d, T);
    return { limbs: T.pub, target: T, sever: (name, dir) => (T.pub[name] ? T.pub[name].sever(dir) : false) };
  }

  // ------------------------------------------------------------------ destructible environments
  const resolveObj = (root, ref) => (!ref ? null : typeof ref === 'string' ? root.getObjectByName(ref) : ref.isObject3D ? ref : null);
  let lastProf = null;
  const _hideRec = (h, ob, vis) => { h.hidden.push({ ob, vis: ob.visible }); ob.visible = vis; };

  // dust / sparks / glints at p for a material
  function breakDust(material, p, n, sc = 1) {
    const F = fx();
    switch (material) {
      case 'metal': F.sparks.emit(p, n + 6, undefined, sc); F.smoke.emit(p, Math.max(1, n >> 2), undefined, sc * 0.8); break;
      case 'glass': F.glint.emit(p, n * 2, undefined, sc); F.puff.emit(p, Math.max(1, n >> 2), undefined, sc * 0.7); break;
      case 'crystal': F.glint.emit(p, n, undefined, sc); F.magic.emit(p, n, undefined, sc * 0.8); break;
      case 'ice': F.ice.emit(p, n, undefined, sc); F.puff.emit(p, Math.max(1, n >> 1), undefined, sc); break;
      case 'cloth': F.puff.emit(p, n, undefined, sc); break;
      default: F.dust.emit(p, n, undefined, sc);
    }
  }
  // a couple of chips flying off at a hit point
  function hitChips(h, p, dir, amount) {
    const mt = MAT[h.material], n = amount > 8 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      pickColor(h.prof, gCol);
      const sh = chunkDims(mt.shape, rand(0.05, 0.1), gD);
      gB.set(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).multiplyScalar(2);
      if (dir) gB.addScaledVector(dir, 1.5);
      spawnChunk(sh, p, gB, gD, gCol, rand(8, 12));
    }
    breakDust(h.material, p, 2 + (amount > 8 ? 2 : 0), 0.5);
  }

  function ensureOwnMats(h) {
    if (h.mats) return h.mats;
    h.mats = [];
    h.object.traverse((m) => {
      if (!m.isMesh || !m.material) return;
      const orig = m.material, clone = Array.isArray(orig) ? orig.map((x) => x.clone()) : orig.clone();
      m.material = clone;
      h.mats.push({ mesh: m, orig, clone, c0: [].concat(clone).map((x) => (x.color ? x.color.clone() : null)) });
    });
    return h.mats;
  }
  function restoreMats(h) {
    if (!h.mats) return;
    for (const e of h.mats) { e.mesh.material = e.orig; for (const mm of [].concat(e.clone)) mm.dispose(); }
    h.mats = null;
  }
  function applyStage(h, st) {
    st.done = true;
    for (const r of st.hide || []) { const ob = resolveObj(h.object, r); if (ob) _hideRec(h, ob, false); }
    for (const r of st.show || []) { const ob = resolveObj(h.object, r); if (ob) _hideRec(h, ob, true); }
    if (st.tint) {
      for (const e of ensureOwnMats(h)) [].concat(e.clone).forEach((mm) => { if (mm.color) mm.color.multiplyScalar(1 - clamp(st.tint, 0, 0.9)); });
    }
    if (st.lean) { h.lean0 ??= h.object.rotation.clone(); h.object.rotation.z += st.lean * rsign(); h.object.rotation.x += st.lean * 0.5 * rsign(); }
    gC.setFromMatrixPosition(h.object.matrixWorld); gC.y += h.prof.size.y * 0.5;
    if (st.drop) {
      for (let i = 0; i < st.drop; i++) {
        pickColor(h.prof, gCol);
        const sh = chunkDims(MAT[h.material].shape, rand(0.06, 0.14) * Math.max(1, h.prof.size.y * 0.3), gD);
        gA.set(gC.x + rand(-0.5, 0.5) * h.prof.size.x, gC.y + rand(-0.4, 0.5) * h.prof.size.y, gC.z + rand(-0.5, 0.5) * h.prof.size.z);
        gB.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1));
        spawnChunk(sh, gA, gB, gD, gCol, rand(10, 14));
      }
    }
    breakDust(h.material, gC, 5 + (st.drop || 0), 0.9);
    breakSound(h.material, gC, 0.4);
    if (st.onStage) safe('stage', st.onStage, h, st);
  }
  function destructHit(h, e) {
    if (h.broken) return;
    const d = h.damage, frac = d.hp / h.maxHp;
    h.shake = Math.min(0.2, h.shake + 0.08 + e.amount * 0.004);
    if (e.point) hitChips(h, e.point, e.direction, e.amount);
    for (const st of h.stages) if (!st.done && frac <= st.at) applyStage(h, st);
    if (h.opts.onDamage) safe('onDamage', h.opts.onDamage, { target: h, amount: e.amount, point: e.point, hp: d.hp, kind: e.kind, direction: e.direction, from: e.from, by: e.by });
  }
  function doBreak(h, dirIn, o) {
    if (h.broken) return;
    o = o || {};
    h.broken = true;
    dropCollider(h);
    const d = h.damage, obj = h.object, kind = o.kind ?? 'blunt', mat = h.material;
    d.alive = false; d.hp = 0;
    dropFrom(reg.damageables, d); // a broken thing is no longer a target (repair() puts it back)
    const dir = new Vector3();
    if (dirIn && (dirIn.x || dirIn.y || dirIn.z)) dir.set(dirIn.x, dirIn.y, dirIn.z).normalize(); else dir.set(rand(-1, 1), 0.3, rand(-1, 1)).normalize();
    const power = o.power ?? (kind === 'explosion' ? 7 : kind === 'blunt' ? 3.6 : kind === 'slash' ? 3 : 2.6);
    obj.updateWorldMatrix(true, true);
    const made = debrisForObject(obj, mat, { direction: dir, power, mass: h.mass, count: h.opts.pieces });
    const prof = lastProf, c = prof.center.clone(), sz = prof.size, vol = Math.max(0.001, sz.x * sz.y * sz.z);
    h.wasVisible = obj.visible;
    obj.visible = false;
    const nd = clamp(Math.round(6 + 4 * Math.cbrt(vol)), 6, 40);
    for (let i = 0; i < 3; i++) {
      gA.set(prof.box.min.x + Math.random() * sz.x, prof.box.min.y + Math.random() * sz.y * 0.8, prof.box.min.z + Math.random() * sz.z);
      breakDust(mat, gA, Math.ceil(nd / 3), 0.8 + Math.cbrt(vol) * 0.3);
    }
    breakSound(mat, c, 0.7 + Math.cbrt(vol) * 0.35);
    if (ctx.player && ctx.player.head.distanceTo(c) < 7) { haptic('left', 0.35, 50); haptic('right', 0.35, 50); }
    for (const ob of h.obstacles) ob.enabled = false;
    ctx.events.emit('kit:break', { object: obj, handle: h, material: mat, point: c, direction: dir, kind, pieces: made });
    if (h.opts.onBreak) safe('onBreak', h.opts.onBreak, { target: h, object: obj, material: mat, point: c, direction: dir, kind });
  }
  function destructRepair(h) {
    if (h.removed) return;
    const d = h.damage;
    h.broken = false; d.alive = true; d.hp = d.maxHp;
    if (!reg.damageables.includes(d)) reg.damageables.push(d);
    h.object.visible = h.wasVisible !== false;
    for (let i = h.hidden.length - 1; i >= 0; i--) h.hidden[i].ob.visible = h.hidden[i].vis;
    h.hidden.length = 0;
    restoreMats(h);
    if (h.lean0) { h.object.rotation.copy(h.lean0); h.lean0 = null; }
    for (const st of h.stages) st.done = false;
    for (const ob of h.obstacles) ob.enabled = true;
    sceneryCollider(h, h.ctx, h.object, h.opts.collide, h.opts.collider);
  }
  impl.destructHit = destructHit;
  impl.destructBreak = (h) => doBreak(h, h.damage.lastHit.direction, { kind: h.damage.lastHit.kind, amount: h.damage.lastHit.amount });
  impl.destructForce = (h, dir, bo) => {
    if (h.broken || h.removed) return false;
    h.damage.lastHit.kind = (bo && bo.kind) || 'blunt';
    doBreak(h, dir, bo);
    return true;
  };

  // kit.destructible(ctx, object3D, { hp, material, pieces, radius, mass, faction, block, onDamage, onBreak, stages }) -> handle
  function destructible(c, obj, o = {}) {
    const material = MAT[o.material] ? o.material : 'wood', mt = MAT[material];
    obj.updateWorldMatrix(true, true);
    const prof = profile(obj), wp = new Vector3().setFromMatrixPosition(obj.matrixWorld), hp = o.hp ?? mt.hp;
    const h = {
      object: obj, material, maxHp: hp, broken: false, ctx: c, opts: o, stages: [], hidden: [], mats: null, shake: 0, shakeOff: new Vector3(),
      lean0: null, removed: false, wasVisible: obj.visible, obstacles: [], mass: o.mass ?? 1, prof,
    };
    const rad = o.radius ?? Math.max(0.3, 0.5 * Math.max(prof.size.x, prof.size.y, prof.size.z));
    const d = damageable(c, obj, {
      hp, radius: rad, offsetY: prof.center.y - wp.y, faction: o.faction ?? 'neutral', flash: false,
      onHit(e) { impl.destructHit(h, e); },
      onDeath() { impl.destructBreak(h); },
    });
    d.box = { min: prof.box.min.clone().sub(wp), max: prof.box.max.clone().sub(wp) };
    d.mul = MUL[material];
    h.damage = d;
    Object.defineProperty(h, 'hp', { get: () => d.hp, set: (v) => { d.hp = v; }, enumerable: true });
    h.hit = (amount = 1, point, from, by, kind, direction) => d.hit(amount, point, from, by, kind, direction);
    h.break = (direction, bo) => impl.destructForce(h, direction, bo);
    h.repair = () => impl.destructRepair(h);
    h.remove = () => {
      if (h.removed) return;
      h.removed = true; d.remove(); dropFrom(reg.destructibles, h);
      dropCollider(h);
      for (const ob of h.obstacles) ob.remove();
    };
    let sts = o.stages;
    if (sts === 'auto' || sts === true) sts = [{ at: 0.66, tint: 0.15, drop: 2 }, { at: 0.33, tint: 0.3, drop: 4, lean: 0.03 }];
    if (Array.isArray(sts)) h.stages = sts.map((s) => Object.assign({ at: 0.5 }, s, { done: false }));
    if (o.block) { // circle obstacles so actors steer around it and the player cannot walk through
      const sx = prof.size.x, sz = prof.size.z;
      if (typeof o.block === 'number') h.obstacles.push(obstacle(c, { position: { x: prof.center.x, y: 0, z: prof.center.z }, radius: o.block }));
      else {
        const long = Math.max(sx, sz), short = Math.max(0.3, Math.min(sx, sz)), n = clamp(Math.ceil(long / (short * 0.9)), 1, 8);
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (long - short);
          h.obstacles.push(obstacle(c, { position: { x: prof.center.x + (sx >= sz ? t : 0), y: 0, z: prof.center.z + (sx >= sz ? 0 : t) }, radius: short * 0.5 }));
        }
      }
    }
    reg.destructibles.push(h);
    cleanup(c, h.remove);
    sceneryCollider(h, c, obj, o.collide, o.collider);
    return h;
  }
  // A fixed Rapier collider fitted to a destructible / tree trunk, so bodies, debris and ragdolls collide with scenery. Actors and the
  // player still use kit.obstacle circles. collide:false opts out; huge hollow things (houses, > 60 m³ or > 9 m wide) get none unless collide:true.
  function sceneryCollider(h, c, obj, collide, shape) {
    const P = PH();
    if (!P || collide === false || h.ph || h.material === 'cloth') return;
    const sz = h.prof.size;
    if (collide !== true && (sz.x * sz.y * sz.z > 60 || Math.max(sz.x, sz.z) > 9 || sz.y > 14)) return;
    if (Math.max(sz.x, sz.y, sz.z) < 0.08) return;
    obj.updateWorldMatrix(true, true);
    const blocking = h.trunk ? !(h.opts && h.opts.block === false) : !!(h.opts && h.opts.block); // block:true things stop walkers too; the rest only stop bodies
    h.ph = P.body({ root: c.root ?? ctx.root }, obj, { type: 'fixed', shape: shape || 'box', friction: 0.7, restitution: 0.1, group: blocking ? 'world' : 'prop' });
    if (h.ph) h.ph.user = h;
  }
  // Walkers (kit actors within 40 m of the player) move through a Rapier kinematic character controller: buildings, walls and blocking scenery
  // stop them, they step over curbs, and they shove loose bodies. Beyond the tier's cap (10 quest / 28 pc) or far away they use the old steering only.
  function physWalk(a, p) {
    const Py = PH();
    if (!Py || !Py.character) return;
    const hd = ctx.player.head, dx0 = p.x - hd.x, dz0 = p.z - hd.z;
    if (dx0 * dx0 + dz0 * dz0 > 1600) { if (a.ch) { a.ch.remove(); a.ch = null; } return; }
    let ch = a.ch;
    if (ch && (ch.removed || !Py.stats)) { a.ch = ch = null; }
    if (!ch) {
      if (a.chRetry > ctx.clock.t) return;
      ch = a.ch = Py.character({}, { radius: clamp(a.obsR * 1.1, 0.18, 0.5), height: Math.max(0.7, a.height * 0.9) });
      if (!ch) { a.chRetry = ctx.clock.t + 1.5; return; }
      ch.teleport(p.x, groundAt(p.x, p.z) + 0.02, p.z);
      return;
    }
    const mx = p.x - ch.position.x, mz = p.z - ch.position.z, gy = groundAt(p.x, p.z);
    if (mx * mx + mz * mz > 9) { ch.teleport(p.x, gy + 0.02, p.z); return; } // it was teleported (follower catch-up)
    ch.move(mx, clamp(gy - ch.position.y, -0.6, 0.6), mz);
    p.x = ch.position.x; p.z = ch.position.z;
  }
  function dropCollider(h) { if (h.ph) { h.ph.remove(); h.ph = null; } }
  function stepDestructibles(dt) {
    const D = reg.destructibles;
    for (let i = 0; i < D.length; i++) {
      const h = D[i];
      if (!h.shakeOff || (h.shake <= 0 && h.shakeOff.lengthSq() === 0)) continue;
      h.object.position.sub(h.shakeOff);
      h.shake = Math.max(0, h.shake - dt * 0.5);
      const amp = h.shake * 0.12;
      if (amp > 0 && !h.broken) h.shakeOff.set(rand(-1, 1) * amp, 0, rand(-1, 1) * amp); else h.shakeOff.set(0, 0, 0);
      h.object.position.add(h.shakeOff);
    }
  }

  // kit.structure(ctx, [{ object3D, hp, material, supports:[indices], ...destructible opts }], { onCollapse(i) })
  function structure(c, parts, o = {}) {
    const n = parts.length, gone = new Array(n).fill(false), pending = new Array(n).fill(false), hs = new Array(n);
    let removed = false;
    const S = { parts: hs, removed: false };
    function check() {
      if (removed) return;
      for (let i = 0; i < n; i++) {
        if (gone[i] || pending[i]) continue;
        const sup = parts[i].supports;
        if (!sup || !sup.length) continue;
        let all = true;
        for (const j of sup) if (!gone[j]) { all = false; break; }
        if (!all) continue;
        pending[i] = true; // its supports are gone: it comes down after a beat
        after(rand(0.3, 0.8), () => {
          if (removed || gone[i] || hs[i].removed) return;
          hs[i].break(gA.set(rand(-0.4, 0.4), -1, rand(-0.4, 0.4)), { power: 1.2, kind: 'blunt' });
          if (o.onCollapse) safe('onCollapse', o.onCollapse, i);
        });
      }
    }
    for (let i = 0; i < n; i++) {
      const p = parts[i], ob = p.object3D ?? p.object;
      const userBreak = p.onBreak;
      hs[i] = destructible(c, ob, Object.assign({}, p, {
        onBreak(e) { gone[i] = true; if (userBreak) safe('onBreak', userBreak, e); check(); },
      }));
    }
    S.broken = () => gone.reduce((k, g) => k + (g ? 1 : 0), 0);
    S.remove = () => { removed = true; S.removed = true; for (const h of hs) h.remove(); };
    S.repair = () => { for (let i = 0; i < n; i++) { gone[i] = false; pending[i] = false; hs[i].repair(); } };
    S.break = (i, dir) => (hs[i] ? hs[i].break(dir) : false);
    cleanup(c, S.remove);
    return S;
  }

  // kit.fellable(ctx, treeGroup, { trunk, crown, hp, block, onFell }) -> { object, hp, fallen, fell(direction), stump, remove() }
  function fellable(c, tree, o = {}) {
    tree.updateWorldMatrix(true, true);
    const trunk = resolveObj(tree, o.trunk) || tree, crown = resolveObj(tree, o.crown);
    const tb = new THREE.Box3().setFromObject(trunk), tsz = tb.getSize(new Vector3());
    const base = new Vector3().setFromMatrixPosition(tree.matrixWorld);
    const H = Math.max(0.8, tsz.y), r0 = clamp(Math.min(tsz.x, tsz.z) * 0.45, 0.08, 1.2), hp = o.hp ?? 45;
    const h = { object: tree, trunk, crown, fallen: false, falling: false, stump: null, ctx: c, opts: o, removed: false, H, r0, base, fall: null, obstacles: [], prof: profile(trunk) };
    const d = damageable(c, tree, {
      hp, radius: Math.max(0.5, H * 0.3), offsetY: H * 0.45, faction: 'neutral', flash: false,
      onHit(e) { if (e.point && !h.falling) { breakDust('wood', e.point, 3, 0.5); hitChips(h2(h), e.point, e.direction, e.amount); } },
      onDeath() { impl.treeFall(h); },
    });
    d.box = { min: tb.min.clone().sub(base).subScalar(0.15), max: tb.max.clone().sub(base).addScalar(0.15) };
    d.mul = MUL.wood;
    h.damage = d;
    Object.defineProperty(h, 'hp', { get: () => d.hp, set: (v) => { d.hp = v; }, enumerable: true });
    h.hit = (amount = 1, point, from, by, kind, direction) => d.hit(amount, point, from, by, kind, direction);
    h.fell = (dir) => { if (h.falling || h.fallen || h.removed) return false; d.lastHit.kind = 'blunt'; if (dir) d.lastHit.direction.set(dir.x, dir.y, dir.z).normalize(); d.alive = false; d.hp = 0; impl.treeFall(h); return true; };
    h.remove = () => { if (h.removed) return; h.removed = true; d.remove(); dropFrom(reg.destructibles, h); dropFrom(reg.falls, h); dropCollider(h); for (const ob of h.obstacles) ob.remove(); };
    if (o.block !== false) h.obstacles.push(obstacle(c, { position: { x: base.x, y: 0, z: base.z }, radius: r0 + 0.12 }));
    reg.destructibles.push(h);
    cleanup(c, h.remove);
    sceneryCollider(h, c, trunk, o.collide, 'cylinder');
    return h;
  }
  const h2 = (h) => ({ material: 'wood', prof: h.prof }); // hitChips wants {material, prof}
  function treeFall(h) {
    if (h.falling || h.fallen) return;
    h.falling = true;
    dropCollider(h);
    const tree = h.object, I = h.damage.lastHit, c = h.ctx;
    const dir = new Vector3(I.direction.x, 0, I.direction.z);
    if (dir.lengthSq() < 1e-4) dir.set(rand(-1, 1), 0, rand(-1, 1));
    dir.normalize();
    for (const ob of h.obstacles) ob.enabled = false;
    // the stump stays behind
    const sh = clamp(h.H * 0.12, 0.25, 0.7);
    pickColor(h.prof, gCol);
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(h.r0 * 0.95, h.r0 * 1.2, sh, 8), new THREE.MeshLambertMaterial({ color: gCol.clone(), flatShading: true }));
    stump.position.set(h.base.x, groundAt(h.base.x, h.base.z) + sh / 2 - 0.03, h.base.z);
    (c.root ?? ctx.root).add(stump);
    h.stump = stump;
    h.fall = { t: 0, T: clamp(0.9 + h.H * 0.2, 1.3, 3.2), axis: new Vector3(dir.z, 0, -dir.x), q0: tree.quaternion.clone(), dir };
    reg.falls.push(h);
    GS ??= sound(ctx, { volume: 1 });
    gC.set(h.base.x, h.base.y + h.H * 0.4, h.base.z);
    GS.tone({ freq: 150, freqEnd: 70, dur: 0.9, type: 'sawtooth', vol: 0.12, at: gC });
    GS.noise({ dur: 0.9, filter: { type: 'bandpass', freq: 700, freqEnd: 300, q: 2 }, vol: 0.25, at: gC, attack: 0.05 });
    breakSound('wood', gC, 0.8);
  }
  function stepFalls(dt) {
    const F = reg.falls;
    for (let i = F.length - 1; i >= 0; i--) {
      const h = F[i], f = h.fall, tree = h.object;
      f.t += dt;
      const u = Math.min(1, f.t / f.T), ang = 1.55 * (u * u * (1.5 - 0.5 * u));
      gQ.setFromAxisAngle(f.axis, ang);
      tree.quaternion.copy(gQ).multiply(f.q0);
      if (u < 1) continue;
      F[i] = F[F.length - 1]; F.pop();
      h.falling = false; h.fallen = true;
      dropFrom(reg.damageables, h.damage);
      tree.updateWorldMatrix(true, true);
      const dir = f.dir;
      if (h.crown) debrisForObject(h.crown, 'earth', { shape: 'clod', count: 22, power: 3, size: 0.5, direction: dir });
      debrisForObject(h.trunk, 'wood', { count: 12, power: 2.2, direction: dir });
      const pr = lastProf;
      gC.copy(pr.center); gC.y = groundAt(gC.x, gC.z) + 0.2;
      breakDust('earth', gC, 14, 1.4); breakDust('wood', gC, 8, 1);
      gsnd('thud', gC, 2);
      breakSound('earth', gC, 1.4);
      if (ctx.player.head.distanceTo(gC) < 14) { haptic('left', 0.5, 80); haptic('right', 0.5, 80); }
      tree.visible = false;
      ctx.events.emit('kit:fell', { object: tree, handle: h, direction: dir });
      if (h.opts.onFell) safe('onFell', h.opts.onFell, h);
    }
  }

  // ---- obstacles: circles that kit actors steer around and that stop the player's rig (removed with their owner / when broken)
  function obstacle(c, o = {}) {
    const p = o.position || o;
    const ob = {
      position: p.isVector3 ? p : { x: p.x ?? 0, y: p.y ?? 0, z: p.z ?? 0 },
      radius: Math.max(0.05, o.radius ?? 0.5), enabled: true, removed: false,
    };
    if (!isFinite(ob.position.x) || !isFinite(ob.position.z)) ob.enabled = false;
    ob.remove = () => { if (ob.removed) return; ob.removed = true; ob.enabled = false; dropFrom(reg.obstacles, ob); };
    if (reg.obstacles.length >= 96) { ob.enabled = false; ob.removed = true; return ob; }
    reg.obstacles.push(ob);
    cleanup(c, ob.remove);
    return ob;
  }
  function steerObstacles(a) {
    const O = reg.obstacles;
    if (!O.length) return;
    const p = a.group.position, ar = a.obsR || 0.3, side = a.seed > 10 ? 1 : -1;
    for (let i = 0; i < O.length; i++) {
      const o = O[i];
      if (!o.enabled) continue;
      let dx = p.x - o.position.x, dz = p.z - o.position.z;
      const r = o.radius + ar, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
      const pen = r - d, nx = dx / d, nz = dz / d;
      p.x += nx * pen - nz * pen * 0.5 * side; p.z += nz * pen + nx * pen * 0.5 * side; // out, plus a sideways nudge so they slide around
    }
  }
  function stepPlayerObstacles(dt) {
    const O = reg.obstacles;
    if (!O.length || !ctx.rig || !ctx.player) return;
    const wp = ctx.world.player;
    if (wp && (wp.physical || wp.noclip)) return; // a Rapier character controller (player.js) owns the rig's collisions, or the player is flying through walls: the legacy circles must not fight it
    const head = ctx.player.head;
    let px = 0, pz = 0;
    for (let i = 0; i < O.length; i++) {
      const o = O[i];
      if (!o.enabled) continue;
      let dx = head.x - o.position.x, dz = head.z - o.position.z;
      const r = o.radius + 0.28, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
      px += (dx / d) * (r - d); pz += (dz / d) * (r - d);
    }
    if (px !== 0 || pz !== 0) {
      const m = Math.hypot(px, pz), cap = 6 * dt, k = m > cap ? cap / m : 1; // never a violent shove
      ctx.rig.position.x += px * k; ctx.rig.position.z += pz * k;
    }
  }
  function stepDelays(dt) {
    const A = reg.delays;
    for (let i = A.length - 1; i >= 0; i--) {
      const e = A[i];
      e.t -= dt;
      if (e.t > 0) continue;
      A[i] = A[A.length - 1]; A.pop();
      safe('delay', e.fn);
    }
  }
  // kit.debris(point, { material, count, power, size, direction, colors, sound }) — a burst of generic chunks (dust and a break sound included)
  function debrisAt(point, o = {}) {
    const mt = MAT[o.material] || MAT.wood, n = clamp(o.count ?? 12, 1, 60);
    chunkBurst(point, n, { colors: o.colors ?? [o.color ?? mt.col], power: o.power ?? 4, size: o.size ?? [0.08, 0.2], shape: mt.shape, direction: o.direction, life: o.life ?? 14 }); // (scales itself)
    breakDust(o.material || 'wood', point, Math.ceil(n / 2), 0.9);
    if (o.sound !== false) breakSound(o.material || 'wood', point, 0.6);
  }

  // ------------------------------------------------------------------ model-backed bodies (world.models)
  // kit.humanoid / kit.creature accept `model`: the body is then a world.models.spawn() character driven by the same actor interface. Motion states pick
  // clips (idle / walk / run by real speed, attack by type + held item, hit, die, wave), equipment goes into the hand bones, and dismemberment collapses
  // the limb's bone chain while the limb's own triangles (selected by skin weight) are cut out of the mesh as a loose flying part.
  // RIGS is the per-rig data: which bones form which limb. Anything not listed degrades (no limbs -> whole-body deaths only).
  const KK_ARM = (s) => ['upperarm' + s, 'lowerarm' + s, 'wrist' + s, 'hand' + s, 'handslot' + s];
  const KK_LEG = (s) => ['upperleg' + s, 'lowerleg' + s, 'foot' + s, 'toes' + s];
  const RIGS = {
    'kaykit-medium': {
      kind: 'humanoid', held: 'armR', hand: { armR: 'R', armL: 'L' }, sit: 'Sit_Floor_Idle',
      limbs: {
        head: { kind: 'head', root: 'head', bones: ['head'], vital: true, weight: 0.85 },
        armL: { kind: 'arm', root: 'upperarml', bones: KK_ARM('l'), side: 1 }, armR: { kind: 'arm', root: 'upperarmr', bones: KK_ARM('r'), side: -1 },
        legL: { kind: 'leg', root: 'upperlegl', bones: KK_LEG('l'), weight: 0.9, side: 1 }, legR: { kind: 'leg', root: 'upperlegr', bones: KK_LEG('r'), weight: 0.9, side: -1 },
      },
      lower: ['hips', ...KK_LEG('l'), ...KK_LEG('r')], // triangles on these bones are the lower half when bisected, the rest the upper half
      gait: { walk: 0.6, run: 1.5, runAt: 0.95 }, gearHead: 2.3, gearBody: 0.8,
    },
    'kenney-mini': {
      kind: 'humanoid', held: 'armR', hand: { armR: 'R', armL: 'L' }, sit: 'sit',
      limbs: {
        head: { kind: 'head', root: 'head', bones: ['head'], vital: true, weight: 0.85 },
        armL: { kind: 'arm', root: 'arm-left', bones: ['arm-left'], side: 1 }, armR: { kind: 'arm', root: 'arm-right', bones: ['arm-right'], side: -1 },
        legL: { kind: 'leg', root: 'leg-left', bones: ['leg-left'], weight: 0.9, side: 1 }, legR: { kind: 'leg', root: 'leg-right', bones: ['leg-right'], weight: 0.9, side: -1 },
      },
      lower: ['root', 'leg-left', 'leg-right'],
      gait: { walk: 0.55, run: 1.6, runAt: 0.9 }, gearHead: 2.3, gearBody: 0.75,
    },
    'kenney-animal': { // cube animals: legs (and a head / tail bone on some); everything else is body. Limbs without bones are dropped when the model loads.
      kind: 'creature', dynamic: true, held: 'head', sit: 'sit',
      limbs: {
        head: { kind: 'head', root: 'Group', bones: ['Group'], vital: true, weight: 0.8 },
        tail: { kind: 'tail', root: 'tail', bones: ['tail'] },
        leg0: { kind: 'leg', root: null, bones: [], weight: 0.9 }, leg1: { kind: 'leg', root: null, bones: [], weight: 0.9 },
        leg2: { kind: 'leg', root: null, bones: [], weight: 0.9 }, leg3: { kind: 'leg', root: null, bones: [], weight: 0.9 },
      },
      lower: null,
      gait: { walk: 0.9, run: 2.1, runAt: 2.2 },
    },
  };
  RIGS.generic = { kind: 'humanoid', held: null, hand: {}, limbs: {}, lower: null, gait: { walk: 0.6, run: 1.5, runAt: 0.95 } };
  const rigNameOf = (info) => (info && RIGS[info.rig] ? info.rig : info && info.category === 'animal' ? 'kenney-animal' : null);
  state.mdlTint ??= new Map(); // `${materialUuid}:${hex}` -> tinted material shared by every actor with that tint
  state.mdlExt ??= new Map();  // per-geometry cache: which triangle belongs to which limb / body half
  const HITF = { '1H_Melee_Attack_Slice_Diagonal': 0.42, '1H_Melee_Attack_Chop': 0.45, '2H_Melee_Attack_Slice': 0.4, '2H_Melee_Attack_Chop': 0.45, '1H_Ranged_Shoot': 0.5, '2H_Ranged_Shoot': 0.5, Spellcast_Shoot: 0.45, 'attack-melee-right': 0.5, 'holding-right-shoot': 0.5 };
  const ALL_FALL = ['sit', 'die'];
  const mM = new Matrix4(), mP = new Vector3(), mQ = new Vector3(), mR = new Vector3();

  // choose the first candidate model that exists. spec: 'knight' | ['goblin', 'rogue-hooded'] | { model, rig?, tint, height, hold, equip, ... } | [ {…}, {…} ]
  function pickModel(spec) {
    const Mo = ctx.world.models;
    if (!Mo || !Mo.has) return null;
    for (const s of Array.isArray(spec) ? spec : [spec]) {
      const cand = typeof s === 'string' ? { model: s } : s;
      if (!cand || !cand.model || !Mo.has(cand.model)) continue;
      const info = Mo.info(cand.model);
      if (!info) continue;
      if (cand.rig && info.rig !== cand.rig) continue;
      const rn = rigNameOf(info);
      return { ...cand, name: cand.model, info, rigName: rn, kind: rn ? RIGS[rn].kind : 'humanoid' };
    }
    return null;
  }

  function modelTarget(rig, h, len, kind, noLimbs) {
    const limbs = {};
    if (!noLimbs) for (const nm of Object.keys(rig.limbs)) {
      const d = rig.limbs[nm];
      limbs[nm] = { model: true, kind: d.kind, vital: !!d.vital, weight: d.weight ?? 1, side: d.side ?? 1, obj: null, center: new Vector3(0, 0.5 * h, 0), joint: new Vector3(), r: 0.06 * h, axis: new Vector3(0, 1, 0), stump: null, sdir: new Vector3(0, 1, 0), def: d };
    }
    const T = { kind, h, core: [], torso: null, coreCenter: new Vector3(0, 0.6 * h, 0), bodyCenter: new Vector3(0, 0.5 * h, 0), coreR: (kind === 'humanoid' ? 0.16 * h : 0.2 * len), heldLimb: rig.held, limbs };
    if (kind === 'creature') T.alias = { legL: 'leg0', legR: 'leg1' };
    return T;
  }

  function startModelActor(c, group, pivot, cand, o, kind) {
    const Mo = ctx.world.models, info = cand.info;
    const rig = RIGS[cand.rigName] ?? RIGS.generic;
    const opt = (k) => (cand[k] !== undefined ? cand[k] : o[k]);
    const horiz = Math.max(info.size[0], info.size[2]) || 1;
    let height, len;
    if (rig.kind === 'creature') { len = opt('size') ?? 0.8; height = len * info.height / horiz; }
    else { height = opt('height') ?? info.height * info.scale; len = height * 0.5; }
    const top = info.size[1] * (height / info.height);
    const bulk = opt('bulk') ?? 1;
    const hasDie = !!Mo.clipFor(cand.name, 'die');
    const cfg = {
      kind: rig.kind, speed: rig.kind === 'creature' ? 1.5 : 1.3, stride: 1, anim: modelAnim, eyeH: top * 0.93, hp: rig.kind === 'creature' ? 12 : 20,
      radius: (rig.kind === 'creature' ? 0.45 * len : 0.32 * height) * bulk, centerY: rig.kind === 'creature' ? 0.5 * height : 0.5 * height, labelY: top + 0.25,
      deadAxis: hasDie ? 'x' : rig.kind === 'creature' ? 'z' : 'x', deadAng: hasDie ? 0 : rig.kind === 'creature' ? Math.PI * 0.5 : -1.5, deadLift: hasDie ? 0 : rig.kind === 'creature' ? 0.3 * height : 0.09 * height,
      armsTotal: Object.values(rig.limbs).filter((l) => l.kind === 'arm').length, legsTotal: Object.values(rig.limbs).filter((l) => l.kind === 'leg').length,
      obsR: (rig.kind === 'creature' ? 0.3 * len : 0.17 * height) * bulk, noFlash: true, target: modelTarget(rig, height, len, rig.kind, opt('limbs') === false),
    };
    const a = makeActor(c, group, pivot, cfg, o);
    if (!o.name && !o.role) a.name = cand.name;
    const M = a.mdl = {
      a, o, cand, name: cand.name, info, rig, rigName: cand.rigName, kind: rig.kind, height, len, top, h: null, ready: false, fell: false, fn: [],
      clip: {}, state: null, hitT: 0, atkClip: null, collapsed: [], own: null, flashing: false, skins: [], ext: null, items: [], holds: [], handNode: { R: null, L: null },
      heldNode: null, wantObj: null, onFallback: [], caster: false, twoHanded: false, tintHex: null, hasDie,
      hover: opt('hover') ?? 0, bob: opt('bob') ?? 0, bobF: opt('bobF') ?? 1.6,
    };
    if (cand.gore !== undefined) a.gore = cand.gore;
    if (cand.death && a.T) a.T.deathOverride = cand.death;
    M.walkV = rig.gait.walk * (rig.kind === 'creature' ? len : height); M.runV = rig.gait.run * (rig.kind === 'creature' ? len : height); M.runAt = rig.gait.runAt * (rig.kind === 'creature' ? len : height);
    const h = M.h = Mo.spawn(c, cand.name, { parent: pivot, position: [0, 0, 0], height, play: 'idle', castShadow: opt('castShadow') });
    const ph = h.object.getObjectByName('model-loading'); if (ph) ph.visible = false; // nothing visible until the model arrives
    if (bulk !== 1 || opt('tall')) h.object.scale.set(bulk, opt('tall') ?? 1, bulk);
    h.ready.then(() => { if (!a.removed && !M.fell) finishModel(a); });
    a.whenPrimitive = (fn) => { if (!a.mdl || a.mdl.fell) fn(a); else if (!a.mdl.ready) a.mdl.onFallback.push(fn); }; // run fn only if the body turns out to be primitive
    a.whenModel = (fn) => { if (!a.mdl || a.mdl.fell) return; if (a.mdl.ready) fn(a); else a.mdl.fn.push(fn); };
    // gear(slot 'head' | 'pivot', obj, x, y, z, scale, rot): an extra object (crown, hat, cape...) built in 1.7 m person units like the library's body gear
    a.gear = (slot, obj, x = 0, y = 0, z = 0, s = 1, rot) => {
      if (slot !== 'head' && slot !== 'pivot') return null;
      a.whenModel(() => {
        // the library builds gear for a 1.7 m person (head ~0.35 m); these chunky models have much bigger heads, hence the per-rig factors
        const k = (M.height / 1.7) * (slot === 'head' ? (M.cand.gearHead ?? rig.gearHead ?? 1) : (M.cand.gearBody ?? rig.gearBody ?? 1)), g = new THREE.Group();
        obj.position.set(x, y, z); obj.scale.multiplyScalar(s);
        if (rot) { if (typeof rot === 'number') obj.rotation.y = rot; else obj.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0); }
        g.add(obj);
        const bone = slot === 'head' ? M.h.bones.head : null;
        g.scale.setScalar(bone ? k / (M.h.fit || 1) : k);
        (bone || a.pivot).add(g);
      });
      return obj;
    };
    return a;
  }

  // A model body for a host that is NOT a kit actor (the library's custom "mobs": dragons, flyers). The host keeps its own movement / combat; this only drives the
  // model: returns { anim(a, dt, t, m), hit(a), die(a), mouth(outVec3), mdl } to use as the mob rig, or null (after calling onFail) when the model is missing.
  //   spec: same candidate list as kit.humanoid's `model`, plus flies: true (idle and walk both play the 'fly' clip, no speed matching)
  function modelBody(c, a, pivot, spec, onFail) {
    const Mo = ctx.world.models, cand = pickModel(spec);
    if (!cand) { if (onFail) onFail(); return null; }
    const info = cand.info, height = cand.height ?? info.height * info.scale;
    const M = a.mdl = {
      a, o: {}, cand, name: cand.name, info, rig: RIGS[cand.rigName] ?? RIGS.generic, rigName: cand.rigName, kind: 'humanoid', height, len: height * 0.5, top: info.size[1] * (height / info.height),
      h: null, ready: false, fell: false, fn: [], clip: {}, state: null, hitT: 0, atkClip: null, collapsed: [], own: null, flashing: false, skins: [], ext: null, items: [], holds: [],
      handNode: { R: null, L: null }, heldNode: null, wantObj: null, onFallback: [], caster: false, twoHanded: false, tintHex: null, hasDie: !!Mo.clipFor(cand.name, 'die'),
      hover: 0, bob: 0, bobF: 1.6, host: true, onFail, flies: !!cand.flies,
    };
    const rig = M.rig;
    M.walkV = rig.gait.walk * height; M.runV = rig.gait.run * height; M.runAt = rig.gait.runAt * height;
    const h = M.h = Mo.spawn(c, cand.name, { parent: pivot, position: [0, 0, 0], height, play: 'idle' });
    const ph = h.object.getObjectByName('model-loading'); if (ph) ph.visible = false;
    h.ready.then(() => { if (!a.removed && !M.fell) finishModel(a); });
    const R = {
      mdl: M, anim: modelAnim, hit: modelHit, die: modelDie,
      mouth(out) { const b = M.h.bones.Mouth || M.h.bones.Jaw || M.h.bones.Head || M.h.bones.head; if (b && M.ready) { b.updateWorldMatrix(true, false); return out.setFromMatrixPosition(b.matrixWorld); } return out.set(a.position.x, a.position.y + M.height * 0.6, a.position.z); },
      dispose() { modelDispose(a); },
    };
    return R;
  }

  function fallbackPrimitive(a) {
    const M = a.mdl;
    if (M.fell) return;
    M.fell = true; M.ready = false;
    try { M.h.remove(); } catch (err) { /* gone */ }
    const o = M.o, cfg = (M.kind === 'creature' ? buildCreature : buildHumanoid)(o, a.group, a.pivot);
    a.adopt(cfg);
    console.warn(`[kit] model "${M.name}" unavailable (${M.h.error || 'not loaded'}); using the primitive body`);
    for (const fn of M.onFallback.splice(0)) safe('onFallback', fn, a);
  }

  function finishModel(a) {
    const M = a.mdl, h = M.h, Mo = ctx.world.models;
    if (!h || h.error || !h.loaded || !h.root) {
      if (M.host) { M.fell = true; M.ready = false; try { h.remove(); } catch (err) { /* gone */ } console.warn(`[kit] model "${M.name}" unavailable (${h && h.error}); using the primitive rig`); if (M.onFail) M.onFail(); return; }
      fallbackPrimitive(a); return;
    }
    const opt = (k) => (M.cand[k] !== undefined ? M.cand[k] : M.o[k]);
    h.root.traverse((o) => { if (o.isSkinnedMesh) M.skins.push(o); });
    if (!M.rigName && h.bones.upperarml && h.bones.upperlegl) { // an unknown rig with the KayKit bone names is KayKit
      M.rigName = 'kaykit-medium'; M.rig = RIGS[M.rigName]; M.kind = 'humanoid';
      a.adopt({ ...a.cfg, kind: 'humanoid', target: modelTarget(M.rig, M.height, M.len, 'humanoid', opt('limbs') === false), armsTotal: 2, legsTotal: 2 });
      if (M.cand.gore !== undefined) a.gore = M.cand.gore;
      if (M.cand.death && a.T) a.T.deathOverride = M.cand.death;
    }
    const rig = M.rig;
    // limbs: resolve bones, keep those that exist
    if (a.T) {
      const bones = h.bones, T = a.T, names = Object.keys(T.limbs);
      if (rig.dynamic) { // animals: leg bones sorted front-to-back, left-to-right
        const legs = Object.keys(bones).filter((n) => /^leg-/.test(n)).sort((p, q) => (bones[q].position.z - bones[p].position.z) || (bones[q].position.x - bones[p].position.x));
        legs.forEach((n, i) => { const d = T.limbs['leg' + i]; if (d) { d.def = { ...d.def, root: n, bones: [n] }; d.side = bones[n].position.x >= 0 ? 1 : -1; } });
      }
      M.ext = modelExt(M);
      const keep = [];
      for (const nm of names) {
        const L = T.limbs[nm], d = L.def, bone = d.root ? bones[d.root] : null, E = M.ext && M.ext.limbs[nm];
        if (!bone || !E) { delete T.limbs[nm]; continue; }
        if (nm === 'head' && rig.dynamic && Math.abs(bone.position.z) < 0.2) { delete T.limbs[nm]; continue; } // a 'Group' bone that is not a head
        L.obj = bone; L.rootBone = bone; L.name = nm;
        L.chain = []; for (const bn of d.bones) { const bb = bones[bn]; if (bb) L.chain.push(bb); }
        if (!L.attached) { const cb = L.chain.length ? L.chain[0] : bone; cb.scale.setScalar(0.001); if (!M.collapsed.includes(cb)) M.collapsed.push(cb); } // cut off while the glTF was still loading: it arrives already gone
        L.center.copy(E.centerBone); L.joint.set(0, 0, 0);
        L.axis.copy(L.center).normalize(); if (L.axis.lengthSq() < 0.5) L.axis.set(0, 1, 0);
        L.r = clamp((nm === 'head' ? Math.max(E.size.x, E.size.y, E.size.z) * 0.5 : Math.min(E.size.x, E.size.y, E.size.z) * 0.5) * h.fit, 0.025, 0.4);
        keep.push(nm);
      }
      T.names = keep; T.pub = {};
      for (const nm of keep) T.pub[nm] = T.limbs[nm];
      if (T.alias) for (const al of Object.keys(T.alias)) if (T.limbs[T.alias[al]]) T.pub[al] = T.limbs[T.alias[al]]; // (a rig with fewer mapped legs has no alias for the missing one)
      a.limbs = T.pub;
      a.armsTotal = a.armsLeft = keep.filter((n) => T.limbs[n].kind === 'arm').length; a.legsTotal = a.legsLeft = keep.filter((n) => T.limbs[n].kind === 'leg').length;
      if (!T.limbs[T.heldLimb]) T.heldLimb = null;
    }
    // clips
    const want = ['idle', 'walk', 'run', 'attack', 'attack-2h', 'shoot', 'cast', 'hit', 'die', 'jump', 'wave', 'cheer'];
    for (const k of want) M.clip[k] = h.clipFor(k) || null;
    M.clip.sit = h.clipFor(rig.sit || 'sit') || null;
    M.clip.breathe = h.clipFor('breathe') || null; M.clip.fly = h.clipFor('fly') || null;
    if (M.flies && M.clip.fly) M.clip.idle = M.clip.walk = M.clip.run = M.clip.fly; // flyers flap whether hovering or moving
    if (!M.clip.walk) M.clip.walk = M.clip.run; if (!M.clip.run) M.clip.run = M.clip.walk;
    if (!M.clip.wave) M.clip.wave = M.clip.cheer;
    M.caster = opt('caster') ?? (info_tag(M.info, 'caster') || info_tag(M.info, 'mage'));
    // colour variants, equipment
    const tint = opt('tint');
    if (tint !== undefined && tint !== null) modelTint(M, tint);
    const eq = opt('equip');
    if (eq !== undefined && h.equip) h.equip(eq);
    if (h._equipNodes) for (const x of h._equipNodes) if (x.node.visible) M.handNode[x.side === 'left' ? 'L' : 'R'] = x.node;
    M.twoHanded = opt('twoHanded') ?? (!!(M.handNode.R && /^2H_/.test(M.handNode.R.name)));
    if (M.handNode.R && !a.held) { a.held = M.handNode.R; a.heldType = opt('weaponType') ?? null; }
    const hold = opt('hold');
    if (hold) for (const hand of ['right', 'left']) if (hold[hand]) modelHold(a, hold[hand], hand, hand === 'right' ? opt('weaponType') : undefined);
    for (const hs of M.holds.splice(0)) applyHold(M, hs);
    if (M.wantObj) mountPrimitive(M, M.wantObj);
    if (h.bones.handslotr && !M.host) a.muzzleAt = (out) => { const b = h.bones.handslotr; b.updateWorldMatrix(true, false); return out.setFromMatrixPosition(b.matrixWorld); }; // combat shoots from the hand
    M.ready = true;
    h.play('idle', { fade: 0 });
    M.state = 'idle';
    for (const fn of M.fn.splice(0)) safe('whenModel', fn, a);
    M.onFallback.length = 0;
    warmModel(M);
  }
  // ---- pre-warm: what the first sever / ragdoll of a model would otherwise compile or compute in the middle of the fight
  const warmed = (state.warmedMats ??= new WeakSet());
  const WQ = (state.warmQ ??= []); // idle-time jobs, one per frame (only while the gore queue is empty)
  function warmModel(M) {
    try {
      const R = ctx.renderer;
      if (R && typeof R.compile === 'function' && ctx.scene && ctx.camera) { // the part meshes use the model's own materials on plain (non-skinned) meshes: a different program
        const warm = new THREE.Scene();
        for (const sm of M.skins) for (const m of [].concat(sm.material)) if (m && !warmed.has(m)) { warmed.add(m); warm.add(new THREE.Mesh(sm.geometry, m)); }
        if (warm.children.length) { const p = R.compileAsync ? R.compileAsync(warm, ctx.camera, ctx.scene) : (R.compile(warm, ctx.camera, ctx.scene), null); if (p && p.catch) p.catch(() => {}); }
      }
    } catch (err) { /* optional */ }
    if (M.rigName === 'kaykit-medium' && M.skins.length) WQ.push(() => { if (!M.fell && PH()) kkFit(M); }); // the ragdoll collider fit (a pass over every vertex), cached per geometry
  }
  function stepWarm() {
    if (!WQ.length || state.goreQ.length) return;
    const f = WQ.shift();
    try { f(); } catch (err) { /* optional */ }
  }
  const info_tag = (info, t) => !!(info && info.tags && info.tags.includes(t));

  // ---- colour variants: a tinted copy of each material, cached and shared (no per-actor clones)
  function tintedMat(m, hex) {
    const key = m.uuid + ':' + hex;
    let t = state.mdlTint.get(key);
    if (!t) {
      t = m.clone();
      t.color.multiply(gCol.set(hex));
      t.userData = { keep: true, tinted: true }; t.dispose = noop; // shared: never disposed with any one actor
      state.mdlTint.set(key, t);
    }
    return t;
  }
  function modelTint(M, hex) {
    M.tintHex = hex;
    for (const sm of M.skins) sm.material = Array.isArray(sm.material) ? sm.material.map((m) => tintedMat(m, hex)) : tintedMat(sm.material, hex);
  }
  // private material copies, for effects that change colour / emissive / opacity (hit flash, char, ice, fade); released afterwards
  const NO_OWN = { orig: new Map(), list: [] }; // read-only stand-in: the model is not loaded yet / failed / was replaced by the primitive body, so there is nothing to clone and nothing to release
  function modelOwnMats(M) {
    if (M.own) return M.own;
    const h = M.h;
    if (M.fell || !h || h.removed || h.error || !h.loaded || !h.root) return NO_OWN; // (a death effect or hit flash before the glTF arrived: the invisible placeholder has no materials worth copying)
    const own = { orig: new Map(), list: [] };
    const cl = (m) => { const c = m.clone(); c.userData = {}; own.list.push(c); return c; };
    M.h.root.traverse((o) => { if (!o.isMesh) return; own.orig.set(o, o.material); o.material = Array.isArray(o.material) ? o.material.map(cl) : cl(o.material); });
    return (M.own = own);
  }
  function modelReleaseMats(M) {
    const own = M.own;
    if (!own) return;
    M.own = null;
    for (const [o, m] of own.orig) o.material = m;
    for (const c of own.list) c.dispose();
  }
  const baseMat = (M, sm) => (M.own && M.own.orig.has(sm) ? M.own.orig.get(sm) : sm.material);

  // ---- per-geometry limb data: which limb / body half each triangle belongs to (by dominant skin weight), limb centres in bone space
  function modelExt(M) {
    const skins = M.skins, rig = M.rig;
    if (!skins.length) return null;
    const key = skins.map((s) => s.geometry.uuid).join('|') + '#' + M.rigName + '#' + Object.keys(M.a.T ? M.a.T.limbs : {}).join(',');
    let E = state.mdlExt.get(key);
    if (E) return E;
    const names = ['core', ...Object.keys(rig.limbs)], li = (n) => names.indexOf(n);
    const bl = new Map();
    for (const nm of Object.keys(rig.limbs)) {
      const d = M.a.T && M.a.T.limbs[nm] ? M.a.T.limbs[nm].def : rig.limbs[nm];
      for (const b of d.bones) bl.set(b, li(nm));
    }
    const lower = new Set(rig.lower || []);
    E = { names, meshes: [], limbs: {} };
    const acc = names.map(() => ({ sum: new Vector3(), n: 0, min: new Vector3(1e9, 1e9, 1e9), max: new Vector3(-1e9, -1e9, -1e9) }));
    const w = new Float32Array(names.length), hw = new Float32Array(2);
    skins.forEach((sm, mi) => {
      const geom = sm.geometry, pa = geom.attributes.position, si = geom.attributes.skinIndex, sw = geom.attributes.skinWeight, idx = geom.index ? geom.index.array : null;
      const bn = sm.skeleton.bones.map((b) => b.name), bLimb = bn.map((n) => (bl.has(n) ? bl.get(n) : 0)), bHalf = bn.map((n) => (lower.has(n) ? 1 : 0));
      const tc = (idx ? idx.length : pa.count) / 3, tl = new Uint8Array(tc), th = new Uint8Array(tc);
      for (let t = 0; t < tc; t++) {
        w.fill(0); hw[0] = hw[1] = 0;
        for (let k = 0; k < 3; k++) {
          const v = idx ? idx[t * 3 + k] : t * 3 + k;
          for (let j = 0; j < 4; j++) { const wt = sw.getComponent(v, j); if (wt > 0) { const b = si.getComponent(v, j); w[bLimb[b]] += wt; hw[bHalf[b]] += wt; } }
        }
        let best = 0; for (let j = 1; j < names.length; j++) if (w[j] > w[best]) best = j;
        tl[t] = best; th[t] = hw[1] > hw[0] ? 1 : 0;
        const A = acc[best];
        for (let k = 0; k < 3; k++) {
          const v = idx ? idx[t * 3 + k] : t * 3 + k;
          mP.set(pa.getX(v), pa.getY(v), pa.getZ(v));
          A.sum.add(mP); A.n++; A.min.min(mP); A.max.max(mP);
        }
      }
      E.meshes.push({ tl, th });
    });
    const sm0 = skins[0], sk = sm0.skeleton;
    for (let j = 1; j < names.length; j++) {
      const A = acc[j]; if (!A.n) continue;
      const nm = names[j], d = M.a.T && M.a.T.limbs[nm] ? M.a.T.limbs[nm].def : rig.limbs[nm];
      const bi = sk.bones.findIndex((b) => b.name === d.root); if (bi < 0) continue;
      const cg = A.sum.clone().multiplyScalar(1 / A.n);
      E.limbs[nm] = { centerBone: cg.clone().applyMatrix4(sm0.bindMatrix).applyMatrix4(sk.boneInverses[bi]), size: A.max.clone().sub(A.min), tris: A.n / 3 };
    }
    state.mdlExt.set(key, E);
    return E;
  }

  // ---- snapBones: the world skin matrices of every skinned mesh of M, taken NOW (the cut may happen a few frames later, queued; see the gore queue)
  function snapBones(M) {
    if (M.snap && M.snapF === state.frameNo) return M.snap; // two limbs of one victim in the same frame share the pose
    M.h.root.updateWorldMatrix(true, true);
    const out = [];
    for (let mi = 0; mi < M.skins.length; mi++) {
      const sm = M.skins[mi], sk = sm.skeleton, nb = Math.min(sk.bones.length, 64), a = new Float32Array(nb * 16);
      for (let b = 0; b < nb; b++) { mM.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b]).multiply(sm.bindMatrix); mM.toArray(a, b * 16); }
      out.push(a);
    }
    M.snap = out; M.snapF = state.frameNo;
    return out;
  }
  // cut a part out of the skinned meshes: every triangle for which pred(limbIndex, half) is true, skinned on the CPU with the bone matrices of `snap`
  // (default: the current pose), centred on its own centroid. Returns { holder, center, min, max } (holder not yet in the scene) or null.
  function buildPart(M, pred, snap) {
    const E = M.ext;
    if (!E || !M.skins.length) return null;
    if (!snap) snap = snapBones(M);
    const built = [];
    let total = 0;
    const sum = new Vector3(), mn = new Vector3(1e9, 1e9, 1e9), mx = new Vector3(-1e9, -1e9, -1e9);
    for (let mi = 0; mi < M.skins.length; mi++) {
      const sm = M.skins[mi], me = E.meshes[mi], geom = sm.geometry;
      const idx = geom.index ? geom.index.array : null, pa = geom.attributes.position, na = geom.attributes.normal, ua = geom.attributes.uv, si = geom.attributes.skinIndex, sw = geom.attributes.skinWeight;
      const remap = new Int32Array(pa.count).fill(-1);
      let nv = 0, nt = 0;
      for (let t = 0; t < me.tl.length; t++) {
        if (!pred(me.tl[t], me.th[t])) continue;
        nt++;
        for (let k = 0; k < 3; k++) { const v = idx ? idx[t * 3 + k] : t * 3 + k; if (remap[v] < 0) remap[v] = nv++; }
      }
      if (!nt) continue;
      const SM = snap[mi]; // skin matrices of this mesh at the moment of the blow
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = ua ? new Float32Array(nv * 2) : null, I = new Uint32Array(nt * 3);
      for (let v = 0; v < pa.count; v++) {
        const r = remap[v]; if (r < 0) continue;
        const px = pa.getX(v), py = pa.getY(v), pz = pa.getZ(v), nx = na.getX(v), ny = na.getY(v), nz = na.getZ(v);
        let ox = 0, oy = 0, oz = 0, qx = 0, qy = 0, qz = 0;
        for (let k = 0; k < 4; k++) {
          const wt = sw.getComponent(v, k); if (wt === 0) continue;
          const o = si.getComponent(v, k) * 16;
          ox += wt * (SM[o] * px + SM[o + 4] * py + SM[o + 8] * pz + SM[o + 12]);
          oy += wt * (SM[o + 1] * px + SM[o + 5] * py + SM[o + 9] * pz + SM[o + 13]);
          oz += wt * (SM[o + 2] * px + SM[o + 6] * py + SM[o + 10] * pz + SM[o + 14]);
          qx += wt * (SM[o] * nx + SM[o + 4] * ny + SM[o + 8] * nz);
          qy += wt * (SM[o + 1] * nx + SM[o + 5] * ny + SM[o + 9] * nz);
          qz += wt * (SM[o + 2] * nx + SM[o + 6] * ny + SM[o + 10] * nz);
        }
        const ql = Math.hypot(qx, qy, qz) || 1;
        P[r * 3] = ox; P[r * 3 + 1] = oy; P[r * 3 + 2] = oz; N[r * 3] = qx / ql; N[r * 3 + 1] = qy / ql; N[r * 3 + 2] = qz / ql;
        if (U) { U[r * 2] = ua.getX(v); U[r * 2 + 1] = ua.getY(v); }
        sum.x += ox; sum.y += oy; sum.z += oz; total++;
        if (ox < mn.x) mn.x = ox; if (oy < mn.y) mn.y = oy; if (oz < mn.z) mn.z = oz;
        if (ox > mx.x) mx.x = ox; if (oy > mx.y) mx.y = oy; if (oz > mx.z) mx.z = oz;
      }
      let q = 0;
      for (let t = 0; t < me.tl.length; t++) {
        if (!pred(me.tl[t], me.th[t])) continue;
        for (let k = 0; k < 3; k++) I[q++] = remap[idx ? idx[t * 3 + k] : t * 3 + k];
      }
      built.push({ sm, P, N, U, I });
    }
    if (!built.length || !total) return null;
    const center = sum.multiplyScalar(1 / total);
    const holder = new THREE.Group();
    holder.position.copy(center);
    const geos = [];
    for (const b of built) {
      for (let i = 0; i < b.P.length; i += 3) { b.P[i] -= center.x; b.P[i + 1] -= center.y; b.P[i + 2] -= center.z; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(b.N, 3));
      if (b.U) g.setAttribute('uv', new THREE.BufferAttribute(b.U, 2));
      g.setIndex(new THREE.BufferAttribute(b.I, 1));
      g.computeBoundingSphere();
      geos.push(g);
      const mesh = new THREE.Mesh(g, baseMat(M, b.sm));
      holder.add(mesh);
    }
    holder.userData.geos = geos;
    return { holder, center, min: mn, max: mx };
  }

  // a plain stand-in when the model is not loaded yet / has no usable limb data
  function standInPart(M, L, wc) {
    const T = M.a.T, h = M.height, r = (L && L.r) || 0.06 * h;
    const key = 'standin' + (M.tintHex ?? 0);
    state.mdlStand ??= {};
    const mat = state.mdlStand[key] ??= Object.assign(new THREE.MeshLambertMaterial({ color: M.tintHex ?? 0xc9a98a }), { userData: { keep: true } });
    const holder = new THREE.Group();
    const m = new THREE.Mesh(geos().sphere, mat);
    const long = L && (L.kind === 'arm' || L.kind === 'leg');
    m.scale.set(r, long ? r * 3 : r, r);
    holder.add(m); holder.position.copy(wc);
    return { holder, center: wc.clone(), min: wc.clone().addScalar(-r), max: wc.clone().addScalar(r) };
  }

  // ---- the gore queue. Cutting a part out of a skinned model (CPU-skin every vertex, build geometry) is the most expensive thing a kill does and a blast
  // kills many victims in ONE frame, so: the pose is snapshotted when the blow lands, the part exists at once as an empty placeholder (it bleeds,
  // counts against the parts cap, carries the dropped weapon) and a few jobs per frame (kit.gore.budget) fill the placeholders in with the real cut.
  // Jobs are plain data, finished through impl.*, so a hot-reloaded kit.js completes jobs queued by the old one. Newest parts win: the cap recycles
  // the oldest, and a job whose placeholder was recycled is skipped without any work.
  const GQ = (state.goreQ ??= []);
  const GB = (state.goreBudget ??= { jobs: Q.pc ? 8 : 3, ms: Q.pc ? 6 : 2.5 });
  goreApi.budget = GB;
  function extCounts(E) { // triangles per limb index and per body half, counted once per geometry set
    if (E.cnt) return E;
    E.cnt = new Array(E.names.length).fill(0); E.half = [0, 0];
    for (const me of E.meshes) for (let t = 0; t < me.tl.length; t++) { E.cnt[me.tl[t]]++; E.half[me.th[t]]++; }
    return E;
  }
  function endJob(job) {
    if (job.hold && job.hold.gibHold > 0) job.hold.gibHold--;
    if (job.group && --job.group.left <= 0) { try { if (job.group.M.h.object) job.group.M.h.object.visible = false; } catch (err) { /* gone */ } }
  }
  function enqueueCut(job, P, hold) {
    job.P = P; P.pending = true; job.hold = hold || null;
    if (hold) hold.gibHold = (hold.gibHold | 0) + 1;
    GQ.push(job);
  }
  // a pending part: an empty holder at p with provisional stump data (its bleeding / spurts start right away)
  function placeholderPart(p, o) {
    const holder = new THREE.Group();
    holder.position.copy(p);
    return newPart(holder, o);
  }
  function fillPart(P, part) { // move the cut meshes into the placeholder; keeps whatever was attached to it (a dropped weapon) where it was
    const H = P.holder, extras = H.children.slice();
    H.updateMatrixWorld(true);
    for (const e of extras) ctx.root.attach(e);
    H.position.copy(part.center);
    H.updateMatrixWorld(true);
    for (const c of part.holder.children.slice()) H.add(c);
    H.userData.geos = part.holder.userData.geos;
    for (const e of extras) H.attach(e);
    P.pending = false;
  }
  function runJob(job) {
    const P = job.P;
    let part = null;
    try {
      if (!P.dead) {
        const M = job.M, pred = job.kind === 'limb' ? (tl) => tl === job.li : job.kind === 'half' ? (tl, th) => th === job.half : (tl) => job.keep[tl];
        part = M.ready || M.ext ? buildPart(M, pred, job.snap) : null;
        if (!part && job.kind === 'limb') part = standInPart(M, job.L, P.holder.position);
        if (part) {
          fillPart(P, part);
          if (job.kind === 'limb') { // the stump of the cut, now that the part's real centre is known
            const sp = job.joint.clone().sub(part.center);
            P.stumps[0].pos.copy(sp); P.stumps[0].dir.copy(sp.lengthSq() > 1e-8 ? sp.clone().normalize() : UPV);
            if (sp.lengthSq() > 1e-8) P.axis.copy(sp).multiplyScalar(-1).normalize();
          } else if (job.kind === 'half') {
            const y = job.half === 0 ? part.min.y - part.center.y + 0.02 * job.h : part.max.y - part.center.y - 0.02 * job.h;
            P.stumps[0].pos.set(0, y, 0);
            const m = new THREE.Mesh(geos().sphere, stumpMat(P.gore)); // a red cut face
            m.scale.set(0.15 * job.h, 0.03 * job.h, 0.1 * job.h); m.position.set(0, y, 0); m.userData.noShadow = true;
            P.holder.add(m);
          }
        } else P.pending = false;
      }
    } catch (err) { console.error('[kit] gore cut failed', err); P.pending = false; }
    endJob(job);
  }
  impl.runJob = runJob; impl.endJob = endJob;
  function stepGoreQueue() {
    if (!GQ.length) return;
    const t0 = performance.now(), maxJ = Math.max(1, GB.jobs | 0), maxMs = GB.ms > 0 ? GB.ms : 1e9;
    for (let n = 0; n < maxJ && GQ.length; n++) {
      impl.runJob(GQ.shift());
      if (performance.now() - t0 > maxMs) break;
    }
  }

  // sever one limb of a model body (called by severLimb): returns what severLimb needs to continue
  function modelDetach(a, T, L, dir) {
    const M = a.mdl, h = M.height, bone = L.rootBone;
    const joint = new Vector3();
    if (bone) { bone.updateWorldMatrix(true, false); joint.setFromMatrixPosition(bone.matrixWorld); } else joint.set(a.position.x, a.position.y + 0.6 * h, a.position.z);
    let part = null, job = null;
    const li = M.ready && M.ext && !M.fell && bone ? M.ext.names.indexOf(L.name) : -1;
    if (li >= 0 && extCounts(M.ext).cnt[li] > 0) {
      // the cut happens a few frames later from this pose; until then an empty holder sits at the limb's (bone-space) centre
      const cw = L.center.clone().applyMatrix4(bone.matrixWorld);
      part = { holder: new THREE.Group(), center: cw };
      part.holder.position.copy(cw);
      job = { kind: 'limb', M, snap: snapBones(M), li, L, joint, P: null, hold: null, group: null };
    } else part = standInPart(M, L, joint.clone().addScaledVector(dir, 0.1 * h));
    // whatever was held in this hand goes with the arm
    const hs = M.rig.hand && M.rig.hand[L.name];
    if (hs && M.handNode[hs]) { part.holder.updateMatrixWorld(true); part.holder.attach(M.handNode[hs]); }
    if (bone) for (const cb of (L.chain && L.chain.length ? L.chain.slice(0, 1) : [bone])) { cb.scale.setScalar(0.001); if (!M.collapsed.includes(cb)) M.collapsed.push(cb); }
    // the stump on the body
    let stump = null, sdir = null;
    if (bone && bone.parent) {
      const pb = bone.parent;
      stump = new THREE.Mesh(geos().sphere, stumpMat(T.gore));
      stump.visible = false; stump.userData.noShadow = true;
      pb.add(stump);
      pb.updateWorldMatrix(true, false);
      stump.position.copy(joint).applyMatrix4(mM.copy(pb.matrixWorld).invert());
      stump.scale.setScalar(Math.max(0.01, (L.r * 0.9) / (pb.matrixWorld.getMaxScaleOnAxis() || 1)));
      stump.updateWorldMatrix(true, false);
      const wd = mQ.copy(joint).sub(bodyCenterOf(T, mR)); if (wd.lengthSq() < 1e-6) wd.set(0, 1, 0);
      sdir = wd.clone().transformDirection(mM.copy(stump.matrixWorld).invert());
    }
    const sp = joint.clone().sub(part.center);
    const nrm = sp.lengthSq() > 1e-8 ? sp.clone().normalize() : new Vector3(0, 1, 0);
    const axis = sp.lengthSq() > 1e-8 ? sp.clone().multiplyScalar(-1).normalize() : new Vector3(0, 1, 0);
    return { holder: part.holder, sp, nrm, axis, r: L.r, stump, sdir, job };
  }

  function modelBisect(T, I) {
    const a = T.actor, M = a.mdl, gore = T.gore, h = T.h;
    if (!M.ready || !M.ext || !M.rig.lower) return false;
    const E = extCounts(M.ext);
    if (!E.half[0] || !E.half[1]) return false; // nothing to cut: the caller decapitates instead
    const dir = I.direction.clone();
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(rand(-1, 1), 0, rand(-1, 1));
    dir.normalize();
    for (const nm of T.names) { const L = T.limbs[nm]; if (L && L.attached) L.attached = false; }
    // two placeholders at the waist (bleeding at once); the cut halves are filled in over the next frames from the pose of the blow
    const wc = bodyCenterOf(T, new Vector3()), snap = snapBones(M), grp = { left: 2, M };
    const upP = placeholderPart(wc, { whole: true, r: 0.12 * h, gore, kind: 'half', stumps: [{ pos: new Vector3(0, 0, 0), dir: new Vector3(0, -1, 0) }] });
    const loP = placeholderPart(wc, { whole: true, r: 0.1 * h, gore, kind: 'half', stumps: [{ pos: new Vector3(0, 0, 0), dir: new Vector3(0, 1, 0) }] });
    enqueueCut({ kind: 'half', half: 0, h, M, snap, group: grp }, upP, a);
    enqueueCut({ kind: 'half', half: 1, h, M, snap, group: grp }, loP, a);
    upP.v.copy(dir).multiplyScalar(rand(2.6, 4)); upP.v.y = rand(2.5, 3.8); upP.w.set(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).multiplyScalar(rand(3, 6));
    loP.v.copy(dir).multiplyScalar(rand(0.8, 1.6)); loP.v.y = rand(0.8, 1.6); loP.w.set(rand(-1, 1), rand(-0.3, 0.3), rand(-1, 1)).multiplyScalar(rand(2, 4));
    a.armsLeft = 0; a.legsLeft = 0; a.legMul = 0.14;
    for (const k of ['R', 'L']) if (M.handNode[k]) { upP.holder.updateMatrixWorld(true); upP.holder.attach(M.handNode[k]); }
    dropHeld(a, upP);
    // (the model itself is hidden when the second half has been cut: see endJob)
    if (gore !== 'none') {
      addBleed({ part: upP, i: 0, T: 2.6, s: 1.4, gore }); addBleed({ part: loP, i: 0, T: 2.6, s: 1.2, gore });
      const wp = new Vector3(), wd = new Vector3();
      partStump(upP, 0, wp, wd); spurt(gore, wp, wd, 26, 3.2, rand(0.8, 1.2));
      partStump(loP, 0, wp, wd); spurt(gore, wp, wd, 18, 2.6, rand(0.6, 1));
    }
    gsnd('slash', bodyCenterOf(T, new Vector3()), 1.4);
    a.gibbed = true; a.gibT = 0.05;
    return true;
  }
  // explosion: the torso (core + whatever limbs are still on) as one part; the model itself disappears
  function modelCore(a, T) {
    const M = a.mdl;
    let P = null;
    if (M.ready && M.ext) {
      const E = extCounts(M.ext), names = E.names, keep = names.map((n, i) => i === 0 || (T.limbs[n] && T.limbs[n].attached));
      let tris = 0;
      for (let i = 0; i < keep.length; i++) if (keep[i]) tris += E.cnt[i];
      if (tris > 0) {
        P = placeholderPart(bodyCenterOf(T, new Vector3()), { whole: true, r: T.coreR, gore: T.gore, kind: 'core', stumps: [{ pos: new Vector3(0, T.coreR * 0.6, 0), dir: new Vector3(0, 1, 0) }] });
        enqueueCut({ kind: 'core', M, snap: snapBones(M), keep, group: { left: 1, M } }, P, a); // the model is hidden when the torso has been cut
      }
    }
    if (!P) M.h.object.visible = false;
    return P;
  }

  // ---- animation: states -> clips
  function clipDur(M, name) {
    M.dur ??= {};
    if (M.dur[name]) return M.dur[name];
    const Mo = ctx.world.models, cat = Mo && Mo.catalog && Mo.catalog.animations;
    let d = 0;
    if (cat) for (const id of M.info.animSets || []) { const dd = cat[id] && cat[id].durations && cat[id].durations[name]; if (dd) { d = dd; break; } }
    if (!d && M.h._current && M.h.currentClip === name) d = M.h._current.getClip().duration;
    if (d) M.dur[name] = d;
    return d || 0.8;
  }
  function modelAnim(a, dt, t, m) {
    const M = a.mdl;
    if (!M || !M.ready) return;
    const h = M.h, pv = a.pivot, sp = a.speedNow;
    for (let i = 0; i < M.collapsed.length; i++) M.collapsed[i].scale.setScalar(0.001); // a severed limb stays gone (clips may rewrite scale)
    const d = a.damage;
    if (d && d.flash > 0.02) { // hit flash needs private materials for a moment
      const own = modelOwnMats(M);
      for (const c of own.list) if (c.emissive) { if (!c.userData.e0) c.userData.e0 = c.emissive.clone(); c.emissive.copy(c.userData.e0).lerp(_flash, d.flash * 0.8); }
      M.flashing = true; M.ownIdle = 0;
    } else if (M.flashing) { // flash over: emissive back to normal; the private copies stay a few seconds for the next hit (cloning every material per blow is wasted work)
      M.flashing = false; M.ownIdle = 0;
      if (M.own) for (const c of M.own.list) if (c.userData.e0) c.emissive.copy(c.userData.e0);
    } else if (M.own && !a.fx && (M.ownIdle = (M.ownIdle || 0) + dt) > 2.5) modelReleaseMats(M);
    // state
    let st;
    const crawl = a.legsTotal > 0 && a.legsLeft === 0 && M.clip.sit;
    if (a.atkT >= 0) st = 'attack';
    else if (M.hitT > 0) { M.hitT -= dt; st = 'hit'; }
    else if (crawl) st = 'sit';
    else if (a.waveT > 0 && M.clip.wave) st = 'wave';
    else if (sp > 0.12 && M.clip.walk) st = (M.state === 'run' ? sp > M.runAt * 0.8 : sp > M.runAt) && M.clip.run ? 'run' : 'walk';
    else st = 'idle';
    if (st !== M.state) {
      if (M.state === 'attack') M.atkClip = null;
      M.state = st;
      const name = M.clip[st];
      if (name) h.play(name, { fade: st === 'hit' ? 0.05 : 0.2, loop: st !== 'hit' });
    }
    if ((st === 'walk' || st === 'run') && !M.flies && h._current && h.currentClip === M.clip[st]) {
      const ref = st === 'run' ? M.runV : M.walkV;
      h._current.setEffectiveTimeScale(clamp(sp / ref, st === 'run' ? 0.55 : 0.45, st === 'run' ? 1.6 : 1.7));
    }
    // procedural body motion: lunge for clip-less attackers, sag / hop after losing legs
    let py = 0, pz = 0, rx = 0, rz = 0;
    if (a.atkT >= 0 && !M.atkClip) {
      const L = M.kind === 'creature' ? M.len : M.height * 0.5;
      pz = (-0.14 * a.atkRaise + 0.4 * a.atkSwing) * L; rx = -0.3 * a.atkRaise + 0.12 * a.atkSwing;
    }
    if (M.kind === 'creature') {
      if (a.waveT > 0 && !M.clip.wave) py += Math.abs(Math.sin(t * 9)) * 0.18 * M.len;
      if (a.legsTotal && a.legsLeft < a.legsTotal) {
        let tilt = 0;
        for (const nm of a.T ? a.T.names : []) { const Ll = a.T.limbs[nm]; if (Ll && Ll.kind === 'leg' && !Ll.attached) tilt += Ll.side; }
        py -= (1 - a.legsLeft / a.legsTotal) * M.height * 0.45; rz = clamp((tilt / a.legsTotal) * -0.5, -0.5, 0.5);
      }
    } else if (a.legsTotal === 2 && a.legsLeft === 1) {
      const lR = a.limbs.legR && a.limbs.legR.attached;
      py += Math.abs(Math.sin(a.phase * 0.5)) * 0.05 * M.height * Math.min(1, m); rz = (lR ? 1 : -1) * 0.16;
      a.phase += sp * dt * 3;
    }
    if (M.hover) py += M.hover + (M.bob ? Math.sin(t * M.bobF + a.seed) * M.bob : 0); // floating things (ghosts, flyers)
    pv.position.y = py; pv.position.z = pz; pv.rotation.x = rx; pv.rotation.z = rz;
  }
  function modelAttack(a) {
    const M = a.mdl;
    if (!M || M.fell || !M.ready) return;
    const k = a.atkKind;
    const order = k === 'ranged' ? (M.clip.breathe ? ['breathe', 'attack'] : M.caster ? ['cast', 'shoot', 'attack'] : ['shoot', 'cast', 'attack']) : k === 'melee' ? (M.twoHanded ? ['attack-2h', 'attack'] : ['attack', 'attack-2h']) : ['attack'];
    let name = null;
    for (const al of order) if (M.clip[al]) { name = M.clip[al]; break; }
    M.state = 'attack';
    if (!name) { M.atkClip = null; return; }
    const dur = clipDur(M, name), ts = clamp((dur * (HITF[name] ?? 0.45)) / (a.atkW + 0.04), 0.45, 3.2);
    M.atkClip = name;
    M.h.play(name, { loop: false, fade: 0.08, speed: ts });
  }
  function modelHit(a) {
    const M = a.mdl;
    if (!M || M.fell || !M.ready || a.atkT >= 0 || M.hitT > 0 || !M.clip.hit) return;
    M.hitT = 0.3; M.state = 'hit';
    M.h.play(M.clip.hit, { loop: false, fade: 0.05, speed: 1.7 });
  }
  function modelDie(a) {
    const M = a.mdl;
    if (!M || M.fell) return;
    M.state = 'dead';
    if (a.rag) return; // the ragdoll drives the bones
    if (a.gibbed && a.gibT < 100) { if (M.h.object && !(a.gibHold > 0)) M.h.object.visible = false; return; } // burst / bisect / shatter already replaced the body (queued cuts hide it when done)
    if (!M.ready) { if (M.h && M.h.object) M.h.object.visible = true; return; }
    if (M.clip.die) M.h.play(M.clip.die, { loop: false, fade: 0.08 });
  }
  function modelDispose(a) {
    const M = a.mdl;
    if (!M) return;
    modelReleaseMats(M);
    for (const it of M.items) { try { it.remove(); } catch (err) { /* gone */ } }
    M.items.length = 0;
    try { M.h.remove(); } catch (err) { /* gone */ }
  }

  // ---- equipment in the hand bones
  function modelHold(a, item, hand, type) {
    const M = a.mdl;
    if (!M || M.fell) return null;
    const hs = { item, hand: hand === 'left' ? 'left' : 'right', type };
    if (M.ready) applyHold(M, hs); else M.holds.push(hs);
    return a;
  }
  function applyHold(M, hs) {
    const a = M.a, Mo = ctx.world.models, side = hs.hand === 'left' ? 'L' : 'R';
    let node = null;
    if (typeof hs.item === 'string') {
      if (!Mo.has(hs.item)) return;
      const sc = M.cand.wscale ?? M.o.wscale ?? clamp(M.height / 1.8, 0.5, 2.4);
      const it = Mo.spawn(a.ctx, hs.item, { parent: M.h.object, position: [0, 0, 0], scale: sc, play: false });
      holdIn(M, it, hs.hand);
      M.items.push(it); node = it.object;
      const nfo = Mo.info(hs.item); if (nfo && nfo.tags && nfo.tags.includes('two-handed') && side === 'R') M.twoHanded = true;
    } else if (hs.item && hs.item.isObject3D) node = mountObject(M, hs.item, hs.hand);
    if (!node) return;
    // anything the hero model carried by default in that hand is put away
    if (M.h._equipNodes) for (const x of M.h._equipNodes) if (x.side === hs.hand && x.node.visible) x.node.visible = false;
    if (M.handNode[side] && M.handNode[side] !== node) M.handNode[side].removeFromParent();
    M.handNode[side] = node;
    if (side === 'R') { a.held = node; a.heldType = hs.type ?? null; M.heldNode = node; }
  }
  // a plain Object3D weapon (grip at the origin, blade along -Z) in a hand: wrapped so the blade points along the forearm
  function mountObject(M, obj, hand) {
    const g = new THREE.Group();
    obj.rotation.x = Math.PI / 2; // our weapons point along -Z, catalogue items (and the hand slots) along +Y
    g.add(obj);
    g.scale.setScalar((M.height / 1.7) / (M.h.fit || 1));
    holdIn(M, g, hand);
    return g;
  }
  // put an item (model handle or Object3D, blade along +Y) in a hand: KayKit rigs have hand slots; the Kenney mini rig has none, so the item goes on the
  // end of the arm bone, turned against the arm's rest rotation so it points up (tilted a little forward)
  const _hq = new THREE.Quaternion(), _hx = new Vector3(1, 0, 0);
  function holdIn(M, item, hand) {
    const h = M.h;
    if (h.bones.handslotr) { h.hold(item, hand); return; }
    const side = hand === 'left' ? 'L' : 'R', arm = h.bones[side === 'L' ? 'arm-left' : 'arm-right'];
    if (!arm) return;
    const E = M.ext && M.ext.limbs[side === 'L' ? 'armL' : 'armR'], c = E ? E.centerBone : null;
    if (!arm.userData.restQ) arm.userData.restQ = arm.quaternion.clone();
    _hq.copy(arm.userData.restQ).invert().multiply(mQ4.setFromAxisAngle(_hx, 0.45));
    h.attach(item, arm.name, { position: c ? [c.x * 1.8, c.y * 1.8, c.z * 1.8 + 0.02] : [0, -0.2, 0.02], quaternion: [_hq.x, _hq.y, _hq.z, _hq.w] });
  }
  const mQ4 = new THREE.Quaternion();
  function mountPrimitive(M, obj) {
    const node = mountObject(M, obj, 'right');
    if (M.h._equipNodes) for (const x of M.h._equipNodes) if (x.side === 'right' && x.node.visible) x.node.visible = false;
    if (M.handNode.R) M.handNode.R.removeFromParent();
    M.handNode.R = node; M.heldNode = node;
  }
  function modelEquip(a, obj, type) {
    const M = a.mdl, prev = a.held;
    if (M.wantObj && M.wantObj.parent) M.wantObj.removeFromParent();
    if (M.heldNode && M.heldNode !== a.held) M.heldNode.removeFromParent();
    if (prev && prev !== obj) prev.removeFromParent();
    const hl = a.T && a.T.heldLimb ? a.T.limbs[a.T.heldLimb] : null;
    if (hl && !hl.attached) { a.held = null; a.heldType = null; M.wantObj = null; return prev; }
    M.wantObj = obj || null;
    a.held = obj || null;
    a.heldType = obj ? type || (obj.userData && obj.userData.weaponType) || null : null;
    if (M.ready) {
      if (obj) mountPrimitive(M, obj);
      else { if (M.handNode.R) M.handNode.R.removeFromParent(); M.handNode.R = null; M.heldNode = null; }
    }
    return prev;
  }

  // ------------------------------------------------------------------ actors: humanoid + creature
  function makeActor(c, group, pivot, cfg, o) {
    const a = {
      kind: cfg.kind, group, pivot, position: group.position, speed: o.speed ?? cfg.speed, stride: cfg.stride, anim: cfg.anim,
      eyeH: cfg.eyeH, yaw: o.yaw ?? 0, speedNow: 0, phase: 0, seed: Math.random() * 20, placed: false,
      hasGoal: false, gx: 0, gz: 0, followTarget: null, followDist: 2, lookTarget: null, lookYaw: 0, lookPitch: 0,
      wanderOn: false, wr: 5, wcx: 0, wcz: 0, wtimer: 0, arriveFn: null, waveT: 0, sayT: 0, label: null, kx: 0, kz: 0,
      dead: false, deadT: 0, deadAxis: cfg.deadAxis, deadAng: cfg.deadAng, deadLift: cfg.deadLift, removed: false, damage: null,
      height: cfg.labelY - 0.1, held: null, atkT: -1, atkW: 0.4, atkKind: 'melee', atkRaise: 0, atkSwing: 0, faceT: 0, faceX: 0, faceZ: 0, _faction: o.faction,
      // dismemberment (see "gore" above): limbs { name: { attached, sever(dir) } }, what is left of the body, how it died
      ctx: c, T: null, limbs: {}, armsTotal: cfg.armsTotal ?? 0, armsLeft: cfg.armsTotal ?? 0, legsTotal: cfg.legsTotal ?? 0, legsLeft: cfg.legsTotal ?? 0,
      hasHead: true, legMul: 1, gibbed: false, gibT: 0.05, fx: null, fxHold: false, deathStyle: null, heldType: null, lastSevered: null, onSever: null,
      obsR: cfg.obsR ?? 0.3,
      // identity for other systems (voices, quests, commentary): a stable id, a name and a role (both settable: actor.name = 'Garrick')
      id: 'a' + (++state.actorSeq), seq: state.actorSeq, name: o.name ?? o.role ?? null, role: o.role ?? '', staggerT: 0, rag: null, ragdoll: null, ch: null, vx: 0, vz: 0,
    };
    if (!a.name) a.name = cfg.kind === 'creature' ? 'creature' : 'villager';
    group.userData.actor = a; // lets other systems (voices) go from a mesh / group to its actor
    Object.defineProperty(a, 'gore', { get: () => (a.T ? a.T.gore : 'none'), set: (v) => { if (a.T) a.T.gore = v; }, enumerable: true, configurable: true });
    a.sever = (name, direction) => { const L = a.limbs[name]; return L ? L.sever(direction) : false; };
    Object.defineProperty(a, 'faction', {
      get: () => (a.damage ? a.damage.faction : a._faction),
      set: (v) => { a._faction = v; if (a.damage) a.damage.faction = v; },
      enumerable: true, configurable: true,
    });
    Object.defineProperty(a, 'moving', { get: () => a.speedNow > 0.15, configurable: true });
    Object.defineProperty(a, 'attacking', { get: () => a.atkT >= 0, configurable: true });
    Object.defineProperty(a, 'strikeT', { get: () => (a.atkT >= a.atkW ? Math.min(1, (a.atkT - a.atkW) / 0.16) : 0), configurable: true });
    a.labelY = cfg.labelY; a.cfg = cfg; a.goreType = o.gore ?? 'blood';
    const heldSlot = new THREE.Group();
    heldSlot.rotation.y = Math.PI; // a weapon's blade (-Z) points along the actor's forward (+Z)
    a.heldSlot = heldSlot;
    // (re)apply a body configuration: used at creation and when a model body falls back to the primitive one
    a.adopt = (cf) => {
      a.cfg = cf; a.kind = cf.kind; a.stride = cf.stride; a.anim = cf.anim; a.eyeH = cf.eyeH; a.labelY = cf.labelY; a.height = cf.labelY - 0.1;
      a.deadAxis = cf.deadAxis; a.deadAng = cf.deadAng; a.deadLift = cf.deadLift;
      a.armsTotal = a.armsLeft = cf.armsTotal ?? 0; a.legsTotal = a.legsLeft = cf.legsTotal ?? 0; a.obsR = cf.obsR ?? 0.3; a.hasHead = true; a.legMul = 1;
      if (cf.target) { a.T = makeTarget(group, pivot, cf.target, { gore: a.T ? a.T.gore : a.goreType, actor: a }); a.limbs = a.T.pub; } else { a.T = null; a.limbs = {}; }
      if (cf.heldParent || cf.heldPos) {
        (cf.heldParent ?? pivot).add(heldSlot);
        heldSlot.position.set(cf.heldPos[0], cf.heldPos[1], cf.heldPos[2]);
        heldSlot.scale.setScalar(cf.heldScale ?? 1);
      } else heldSlot.removeFromParent();
      if (a.damage) {
        a.damage.radius = cf.radius; a.damage.offsetY = cf.centerY;
        a.damage.mats = [];
        if (!cf.noFlash) group.traverse((m) => { for (const mm of [].concat(m.material ?? [])) if (mm.emissive && !a.damage.mats.some((x) => x.m === mm)) a.damage.mats.push({ m: mm, e: mm.emissive.clone() }); });
        if (a.T) attachGore(a.damage, a.T);
      }
    };
    a.adopt(cfg);
    // model hooks (no-ops on a primitive body): hold(item, hand, weaponType) puts a catalogue model (or a plain Object3D) in a hand bone;
    // whenPrimitive(fn) runs fn only if the body is / becomes primitive; whenModel(fn) only once the model is in
    a.hold = (item, hand, type) => (a.mdl && !a.mdl.fell ? modelHold(a, item, hand, type) : null);
    a.whenPrimitive = (fn) => { fn(a); };
    a.whenModel = () => {};
    a.equip = (obj, type) => { // type (optional): a world.weapons type, so losing the arm drops a real pickup of that weapon
      if (a.mdl && !a.mdl.fell) return modelEquip(a, obj, type);
      const prev = a.held;
      if (prev) prev.removeFromParent();
      const hl = a.T && a.T.heldLimb ? a.T.limbs[a.T.heldLimb] : null;
      if (hl && !hl.attached) { a.held = null; a.heldType = null; return prev; } // nothing left to hold it with
      a.held = obj || null;
      a.heldType = obj ? type || (obj.userData && obj.userData.weaponType) || null : null;
      if (obj) heldSlot.add(obj);
      return prev;
    };
    a.faceTo = (v, seconds = 0.35) => { if (v) { a.faceX = v.x; a.faceZ = v.z; a.faceT = seconds; } return a; };
    // windup seconds raising the weapon/arm (the telegraph), then a 0.16 s strike and 0.34 s recovery. Returns total seconds.
    a.attackAnim = (windup = 0.4, kind) => {
      if (a.dead) return 0;
      a.atkW = Math.max(0.05, windup); a.atkT = 0; a.atkKind = kind ?? (a.kind === 'creature' ? 'lunge' : 'melee');
      if (a.mdl) modelAttack(a);
      return a.atkW + 0.5;
    };
    group.position.set(o.x ?? o.position?.x ?? 0, 0, o.z ?? o.position?.z ?? 0);
    group.rotation.y = a.yaw;
    a.walkTo = (x, z) => { if (x && typeof x === 'object') { z = x.z; x = x.x; } a.gx = x; a.gz = z; a.hasGoal = true; a.followTarget = null; return a; };
    a.stop = () => { a.hasGoal = false; a.followTarget = null; return a; };
    a.follow = (target, dist = 2) => { a.followTarget = target || null; a.followDist = dist; if (target) a.hasGoal = false; return a; };
    a.lookAt = (v) => { a.lookTarget = v || null; return a; };
    a.wave = (s = 2) => { a.waveT = s; return a; };
    a.setSpeed = (v) => { a.speed = v; return a; };
    a.onArrive = (fn) => { a.arriveFn = fn; return a; };
    a.wander = (radius = 5, center) => {
      a.wanderOn = radius > 0; a.wr = radius;
      a.wcx = center ? center.x : group.position.x; a.wcz = center ? center.z : group.position.z;
      a.wtimer = rand(0.5, 2);
      return a;
    };
    a.say = (text, seconds = 4) => {
      if (a.dead) return a;
      if (!a.label) { a.label = makeLabel(c, text, { size: 0.08, style: 'bubble', span: seconds }, group); a.label.position.set(0, a.labelY, 0); } else a.label.set(text, { span: seconds });
      a.label.show(true); a.sayT = Math.max(seconds, Math.min(9, 1.3 + 0.055 * String(text).length)); // stays long enough to read
      ctx.events.emit('actor:say', { actor: a, text: String(text), seconds }); // the voice system listens
      return a;
    };
    a.update = noop;
    a.remove = () => {
      if (a.removed) return;
      a.removed = true; dropFrom(reg.actors, a);
      a.label?.remove(); a.damage?.remove();
      if (a.ch) { a.ch.remove(); a.ch = null; }
      if (a.rag) {
        const rd = a.rag; a.rag = null; dropFrom(reg.rags, rd);
        try { rd.remove(); } catch (err) { /* gone */ }
        if (rd.holders) for (const r of rd.holders) { r.holder.removeFromParent(); disposeObject(r.holder); }
      }
      if (a.mdl) modelDispose(a);
      group.removeFromParent(); disposeObject(group);
    };
    // idempotent: combat.js calls it for actors made with damageable:false
    a.setupDamage = (oo = {}) => {
      if (a.damage) return a.damage;
      a.damage = damageable(c, group, {
        hp: oo.hp ?? a.cfg.hp, radius: a.cfg.radius, offsetY: a.cfg.centerY, faction: oo.faction ?? a._faction, flash: a.cfg.noFlash ? false : undefined,
        onHit(e) {
          if (e.point && !a.dead) {
            const dx = group.position.x - e.point.x, dz = group.position.z - e.point.z, n = Math.sqrt(dx * dx + dz * dz) || 1, k = Math.min(e.amount * 0.25, 4);
            a.kx += (dx / n) * k; a.kz += (dz / n) * k;
          }
          if (a.mdl && !a.dead) modelHit(a);
          if (oo.onHit) oo.onHit(e);
        },
        onDeath() {
          a.dead = true; a.deadT = 0; a.hasGoal = false; a.followTarget = null; a.wanderOn = false; a.atkT = -1;
          a.label?.show(false);
          if (a.mdl) modelDie(a);
          if (oo.onDeath) oo.onDeath(a);
        },
      });
      a.damage.actor = a;
      if (a.T) attachGore(a.damage, a.T);
      return a.damage;
    };
    if (o.damageable !== false) a.setupDamage(o);
    (c.root ?? ctx.root).add(group);
    reg.actors.push(a);
    cleanup(c, a.remove);
    return a;
  }

  // a ragdolled corpse lingers ~12 s, then shrinks about its pelvis (KayKit) / piece by piece (primitive) and goes
  function stepRagActor(a) {
    const rd = a.rag, linger = state.goreLevel === 'full' ? 12 : 3.8;
    if (a.deadT <= linger) return;
    const s = 1 - (a.deadT - linger) / 1.0;
    if (s <= 0) { a.remove(); return; }
    if (rd.holders) { for (const r of rd.holders) { r.s0 ??= r.holder.scale.x; r.holder.scale.setScalar(Math.max(0.001, s) * r.s0); } }
    else if (rd.frozen) a.group.visible = s > 0.5;
    else { a.group.scale.setScalar(Math.max(0.001, s)); if (rd.finalize) rd.finalize(rd); }
  }
  // a strong blow (explosion, hammer, force push) throws a standing actor back and stuns it for a moment (combat.js reads actor.staggerT)
  function knockActor(a, point, force) {
    const p = a.group.position, dx = p.x - point.x, dz = p.z - point.z, n = Math.sqrt(dx * dx + dz * dz) || 1, k = clamp(force * 0.4, 1, 8);
    a.kx += (dx / n) * k; a.kz += (dz / n) * k;
    a.staggerT = Math.max(a.staggerT, clamp(force * 0.05, 0.25, 0.9));
    a.atkT = -1; a.atkRaise = a.atkSwing = 0;
    if (a.mdl) modelHit(a);
  }
  function stepActor(a, dt, t) {
    const g = a.group, p = g.position;
    if (!a.placed) { p.y = groundAt(p.x, p.z); a.placed = true; }
    if (a.dead) {
      a.deadT += dt;
      if (a.ch) { a.ch.remove(); a.ch = null; }
      if (a.gibbed) { if (a.deadT > a.gibT && !(a.gibHold > 0)) a.remove(); return; } // blown apart / launched: the pieces live on in kit's part system (gibHold: cuts still queued)
      if (a.fx) stepDeathFx(a, dt); // char / shatter / disintegrate timelines
      if (a.gibbed) return;
      if (a.fxHold) { p.y += (groundAt(p.x, p.z) - p.y) * Math.min(1, dt * 10); return; } // frozen / glowing before it goes
      if (a.rag) { stepRagActor(a); return; } // physics owns the body
      if (a.deadAxis !== 'x') a.pivot.rotation.x = 0;
      if (a.deadAxis !== 'z') a.pivot.rotation.z = 0;
      a.pivot.position.z = 0;
      const k = ease.out(Math.min(1, a.deadT * 3));
      a.pivot.rotation[a.deadAxis] = a.deadAng * k;
      a.pivot.position.y = a.deadLift * k;
      const linger = state.goreLevel === 'full' ? 12 : 3.8; // bodies stay ~12 s, then sink away
      if (a.deadT > linger) { const s = 1 - (a.deadT - linger) / 1.0; if (s <= 0) { a.remove(); return; } g.scale.setScalar(s); }
      p.y += (groundAt(p.x, p.z) - p.y) * Math.min(1, dt * 10);
      return;
    }
    if (a.kx !== 0 || a.kz !== 0) {
      p.x += a.kx * dt; p.z += a.kz * dt;
      const k = Math.exp(-7 * dt); a.kx *= k; a.kz *= k;
      if (Math.abs(a.kx) + Math.abs(a.kz) < 0.02) a.kx = a.kz = 0;
    }
    let want = 0, tx = 0, tz = 0, face = false;
    const ft = a.followTarget;
    if (ft) {
      const dx = ft.x - p.x, dz = ft.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d > a.followDist) {
        want = d > a.followDist + 4 ? a.speed * 1.8 : a.speed;
        if (d < a.followDist + 0.8) want *= 0.6;
        tx = ft.x; tz = ft.z; face = true;
      }
    } else if (a.hasGoal) {
      const dx = a.gx - p.x, dz = a.gz - p.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d < 0.12) { a.hasGoal = false; if (a.arriveFn) safe('onArrive', a.arriveFn, a); }
      else { want = a.speed * Math.min(1, 0.35 + d); tx = a.gx; tz = a.gz; face = true; }
    } else if (a.wanderOn && !a.lookTarget) {
      a.wtimer -= dt;
      if (a.wtimer <= 0) {
        const ang = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * a.wr;
        a.walkTo(a.wcx + Math.cos(ang) * r, a.wcz + Math.sin(ang) * r);
        a.wtimer = rand(3, 8);
      }
    }
    want *= a.legMul === undefined ? 1 : a.legMul; // hopping / crawling after losing legs
    if (a.staggerT > 0) { a.staggerT -= dt; want = 0; a.atkT = -1; a.atkRaise = a.atkSwing = 0; } // knocked back: stunned
    a.speedNow += (want - a.speedNow) * Math.min(1, dt * 6);
    let yawT = a.yaw, turn = false, diff = 0, rate = 5;
    if (a.faceT > 0) {
      a.faceT -= dt;
      const fx = a.faceX - p.x, fz = a.faceZ - p.z;
      if (fx * fx + fz * fz > 0.0004) { yawT = Math.atan2(fx, fz); turn = true; rate = 9; }
    } else if (face) { yawT = Math.atan2(tx - p.x, tz - p.z); turn = true; }
    else if (a.lookTarget) {
      const lx = a.lookTarget.x - p.x, lz = a.lookTarget.z - p.z;
      if (lx * lx + lz * lz > 0.04) { yawT = Math.atan2(lx, lz); turn = true; }
    }
    if (a.atkT >= 0) { // attack phases: windup [0,W] raise, strike 0.16 s swing, recover 0.34 s
      a.atkT += dt;
      const W = a.atkW, u = a.atkT;
      if (u < W) { const r = u / W; a.atkRaise = r * r * (3 - 2 * r); a.atkSwing = 0; }
      else if (u < W + 0.16) { const s = (u - W) / 0.16; a.atkRaise = 1 - s; a.atkSwing = s; }
      else if (u < W + 0.5) { a.atkRaise = 0; a.atkSwing = 1 - ease.inOut((u - W - 0.16) / 0.34); }
      else { a.atkT = -1; a.atkRaise = a.atkSwing = 0; }
    }
    if (turn) {
      diff = wrapAng(yawT - a.yaw);
      const mx = rate * dt;
      a.yaw += diff < -mx ? -mx : diff > mx ? mx : diff;
      g.rotation.y = a.yaw;
      diff = wrapAng(yawT - a.yaw);
    }
    if (a.speedNow > 0.01) {
      const f = a.speedNow * Math.max(0, 1 - Math.abs(diff) / 1.1);
      p.x += Math.sin(a.yaw) * f * dt; p.z += Math.cos(a.yaw) * f * dt;
    }
    // perf: an actor hidden by the distance culler (or by anyone) is not seen: it keeps moving and thinking (position, AI and arrival stay correct) but
    // skips the physics character, most ground snapping and nearly all animation. Seen actors animate every frame up close; farther away every
    // animStride-th frame (animStride is 1 at level 0, so only the always-on far strides below apply there: > 80 m every 2nd, > 160 m every 3rd).
    const culled = g.userData.perfCulled === true || g.visible === false;
    if (reg.obstacles.length) steerObstacles(a);
    if (!culled) { if (a.walls !== false) physWalk(a, p); } else if (a.ch) { a.ch.remove(); a.ch = null; }
    if (!culled) p.y += (groundAt(p.x, p.z) - p.y) * Math.min(1, dt * 14);
    else if (((state.frameNo + (a.seq | 0)) & 3) === 0) p.y += (groundAt(p.x, p.z) - p.y) * Math.min(1, dt * 56);
    a.phase += a.speedNow * dt * a.stride;
    if (a.waveT > 0) a.waveT -= dt;
    if (a.sayT > 0) { a.sayT -= dt; if (a.sayT <= 0 && a.label) a.label.show(false); }
    let stride = 1;
    if (culled) stride = 12;
    else {
      const hd0 = ctx.player.head, hx = p.x - hd0.x, hz = p.z - hd0.z, d2 = hx * hx + hz * hz, as = Q.animStride > 1 ? Q.animStride : 1;
      stride = d2 > 25600 ? Math.max(as, 3) : d2 > 6400 ? Math.max(as, 2) : d2 > 144 ? as : 1;
    }
    let an = a.animN === undefined ? (a.seq | 0) % Math.ceil(stride) : a.animN; // staggered start so strided actors do not all animate on the same frame
    a.animAcc = (a.animAcc || 0) + dt;
    if (++an >= stride) {
      an = 0;
      const dtA = a.animAcc; a.animAcc = 0;
      let ly = 0, lp = 0;
      const lt = a.lookTarget;
      if (lt) {
        const dx = lt.x - p.x, dz = lt.z - p.z, hd = Math.sqrt(dx * dx + dz * dz);
        if (hd < 14) {
          ly = clamp(wrapAng(Math.atan2(dx, dz) - a.yaw), -1.1, 1.1);
          lp = clamp(Math.atan2(lt.y - (p.y + a.eyeH), Math.max(hd, 0.3)), -0.5, 0.5);
        }
      }
      const lk = Math.min(1, dtA * 8);
      a.lookYaw += (ly - a.lookYaw) * lk; a.lookPitch += (lp - a.lookPitch) * lk;
      a.anim(a, dtA, t, Math.min(1.5, a.speedNow / (a.speed || 1)));
    }
    a.animN = an;
  }

  // the primitive (boxes and spheres) person: builds its meshes into `pivot` and returns the body configuration for makeActor
  function buildHumanoid(o, group, pivot) {
    const h = o.height ?? 1.7, geo = geos();
    const mk = (col) => new THREE.MeshLambertMaterial({ color: col });
    const skinM = mk(o.skin ?? 0xe0ac86), shirtM = mk(o.shirt ?? 0x3d6fb0), pantsM = mk(o.pants ?? 0x3b3a45), shoeM = mk(0x2a2220);
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x14100e });
    const part =(g, m, sx, sy, sz, x, y, z, par = pivot) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.scale.set(sx * h, sy * h, sz * h); mesh.position.set(x * h, y * h, z * h);
      par.add(mesh);
      return mesh;
    };
    const leg = (x) => {
      const pv = new THREE.Group(); pv.position.set(x * h, 0.47 * h, 0); pivot.add(pv);
      part(geo.boxTop, pantsM, 0.12, 0.47, 0.13, 0, 0, 0, pv);
      part(geo.box, shoeM, 0.13, 0.05, 0.2, 0, -0.445, 0.035, pv);
      return pv;
    };
    const arm = (x) => {
      const pv = new THREE.Group(); pv.position.set(x * h, 0.76 * h, 0); pivot.add(pv);
      part(geo.boxTop, shirtM, 0.075, 0.3, 0.085, 0, 0, 0, pv);
      part(geo.sphere, skinM, 0.045, 0.045, 0.045, 0, -0.32, 0, pv);
      return pv;
    };
    const legL = leg(0.075), legR = leg(-0.075), armL = arm(0.18), armR = arm(-0.18);
    const torso = part(geo.box, shirtM, 0.28, 0.31, 0.15, 0, 0.625, 0);
    const head = new THREE.Group(); head.position.set(0, 0.8 * h, 0); pivot.add(head);
    part(geo.sphere, skinM, 0.095, 0.105, 0.1, 0, 0.1, 0, head);
    part(geo.box, eyeM, 0.02, 0.025, 0.012, 0.037, 0.11, 0.092, head);
    part(geo.box, eyeM, 0.02, 0.025, 0.012, -0.037, 0.11, 0.092, head);
    if (o.hair != null) part(geo.sphere, mk(o.hair), 0.103, 0.1, 0.108, 0, 0.125, -0.012, head);
    if (o.hat != null) {
      const hm = mk(o.hat);
      part(geo.cone, hm, 0.11, 0.2, 0.11, 0, 0.19, 0, head);
      part(geo.sphere, hm, 0.17, 0.014, 0.17, 0, 0.185, 0, head);
    }
    // what can come off (kit's gore system moves these Object3Ds out into flying parts); stumps are appended AFTER the six body parts
    const V = (x, y, z) => new Vector3(x, y, z);
    const stump = (x, y, z, sx, sy, sz) => {
      const m = new THREE.Mesh(geo.sphere, stumpMat('blood'));
      m.position.set(x * h, y * h, z * h); m.scale.set(sx * h, sy * h, sz * h); m.visible = false; pivot.add(m);
      return m;
    };
    const target = {
      kind: 'humanoid', h, core: [torso], torso, coreCenter: V(0, 0.625 * h, 0), bodyCenter: V(0, 0.5 * h, 0), coreR: 0.16 * h, heldLimb: 'armR',
      waist: stump(0, 0.468, 0, 0.135, 0.02, 0.075),
      limbs: {
        head: { obj: head, kind: 'head', center: V(0, 0.1 * h, 0), joint: V(0, 0, 0), r: 0.1 * h, vital: true, weight: 0.85, stump: stump(0, 0.795, 0, 0.05, 0.035, 0.05), sdir: V(0, 1, 0.1) },
        armL: { obj: armL, kind: 'arm', center: V(0, -0.17 * h, 0), joint: V(0, 0, 0), r: 0.045 * h, stump: stump(0.168, 0.755, 0, 0.05, 0.045, 0.055), sdir: V(1, 0.5, 0) },
        armR: { obj: armR, kind: 'arm', center: V(0, -0.17 * h, 0), joint: V(0, 0, 0), r: 0.045 * h, stump: stump(-0.168, 0.755, 0, 0.05, 0.045, 0.055), sdir: V(-1, 0.5, 0) },
        legL: { obj: legL, kind: 'leg', center: V(0, -0.235 * h, 0), joint: V(0, 0, 0), r: 0.07 * h, weight: 0.9, stump: stump(0.075, 0.47, 0, 0.06, 0.03, 0.07), sdir: V(0.3, -0.7, 0) },
        legR: { obj: legR, kind: 'leg', center: V(0, -0.235 * h, 0), joint: V(0, 0, 0), r: 0.07 * h, weight: 0.9, stump: stump(-0.075, 0.47, 0, 0.06, 0.03, 0.07), sdir: V(-0.3, -0.7, 0) },
      },
    };
    const anim = (a, dt, t, m) => {
      const lm = a.limbs, aL = lm.armL.attached, aR = lm.armR.attached, lL = lm.legL.attached, lR = lm.legR.attached;
      const s = Math.sin(a.phase), mm = Math.min(m, 1), amp = 0.85 * Math.min(m, 1.3), idle = 1 - mm;
      if (lL) legL.rotation.x = s * amp;
      if (lR) legR.rotation.x = -s * amp;
      if (aL) armL.rotation.x = -s * amp * 0.8;
      if (aR) armR.rotation.x = s * amp * 0.8;
      const sway = Math.sin(t * 1.4 + a.seed) * 0.02 * idle;
      if (aL) armL.rotation.z = 0.05 + sway;
      if (aR) armR.rotation.z = -0.05 - sway;
      if (a.held && aR) armR.rotation.x = -0.9 + s * amp * 0.15; // carrying something: hold it out in front
      if (a.waveT > 0 && aR) { armR.rotation.x = -2.7; armR.rotation.z = -0.2 + Math.sin(t * 11) * 0.5; }
      let lean = 0;
      const wa = aR ? armR : aL ? armL : null; // the arm that attacks (the other one is gone)
      if (a.atkT >= 0) {
        const raise = a.atkRaise, sw = a.atkSwing;
        if (wa) {
          const rest = wa.rotation.x;
          if (a.atkKind === 'ranged') {
            const rp = a.atkT > a.atkW + 0.16 ? Math.min(1, (a.atkT - a.atkW - 0.16) / 0.34) : 0;
            const aim = a.atkT < a.atkW ? raise : 1 - ease.inOut(rp);
            wa.rotation.x = rest + (-1.5 - rest) * aim - 0.4 * sw;
            if (aL && wa !== armL) armL.rotation.x = -0.5 * aim; // off hand steadies
          } else {
            wa.rotation.x = rest + (-2.6 - rest) * raise + (0.9 - rest) * sw;
            lean = -0.12 * raise + 0.3 * sw;
          }
          wa.rotation.z = wa === armR ? -0.05 : 0.05;
        } else lean = -0.12 * raise + 0.3 * sw; // no arms left: a headbutt
      }
      pivot.rotation.x = lean;
      pivot.rotation.z = 0;
      pivot.position.y = Math.abs(Math.cos(a.phase)) * 0.03 * h * mm;
      pivot.position.z = 0;
      let hx = -a.lookPitch;
      const legs = (lL ? 1 : 0) + (lR ? 1 : 0);
      if (legs === 1) { // hopping on one leg
        pivot.position.y += Math.abs(Math.sin(a.phase * 0.5)) * 0.1 * h * mm;
        pivot.rotation.z = (lR ? 1 : -1) * 0.16;
      } else if (legs === 0) { // dragging itself along on its belly
        pivot.rotation.x = 1.35 + lean * 0.5;
        pivot.position.z = -0.42 * h;
        pivot.position.y = 0.01 * h + Math.abs(Math.sin(a.phase)) * 0.015 * h * mm;
        if (aL) armL.rotation.x = -2.7 + s * 0.5;
        if (aR) armR.rotation.x = -2.7 - s * 0.5;
        hx = -1.1;
      }
      if (lm.head.attached) { head.rotation.y = a.lookYaw; head.rotation.x = hx; }
    };
    return {
      kind: 'humanoid', speed: 1.3, stride: 6.2832 / (0.74 * h), anim, eyeH: 0.93 * h, hp: 20, radius: 0.32 * h, centerY: 0.5 * h,
      labelY: (o.hat != null ? 1.22 : 1.08) * h + 0.1, deadAxis: 'x', deadAng: -1.5, deadLift: 0.09 * h,
      heldParent: armR, heldPos: [0, -0.33 * h, 0.01 * h], heldScale: h / 1.7,
      armsTotal: 2, legsTotal: 2, obsR: 0.17 * h, target,
    };
  }
  // kit.humanoid(ctx, { model: 'knight' | ['goblin', 'rogue-hooded'] | { model, tint, height, hold, equip }, ... }) builds a model-backed person when the
  // model exists (world.models), otherwise (or if loading fails) the primitive one
  function humanoid(c, o = {}) {
    const group = new THREE.Group(), pivot = new THREE.Group();
    group.add(pivot);
    const cand = o.model ? pickModel(o.model) : null;
    if (cand) return startModelActor(c, group, pivot, cand, o, cand.kind === 'creature' ? 'creature' : 'humanoid');
    return makeActor(c, group, pivot, buildHumanoid(o, group, pivot), o);
  }

  function buildCreature(o, group, pivot) {
    const L = o.size ?? 0.8, geo = geos(), legsN = clamp(Math.round((o.legs ?? 4) / 2) * 2, 2, 6), legLen = 0.34 * L;
    const base = new Color(o.bodyColor ?? 0x9a6b3f);
    const bodyM = new THREE.MeshLambertMaterial({ color: base });
    const legM = new THREE.MeshLambertMaterial({ color: base.clone().multiplyScalar(0.65) });
    const accM = new THREE.MeshLambertMaterial({ color: o.accent ?? base.clone().lerp(new Color(1, 1, 1), 0.4) });
    const eyeM = new THREE.MeshBasicMaterial({ color: o.eyeColor ?? 0x101010 });
    const part =(g, m, sx, sy, sz, x, y, z, par = pivot) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.scale.set(sx * L, sy * L, sz * L); mesh.position.set(x * L, y * L, z * L);
      par.add(mesh);
      return mesh;
    };
    const body1 = part(geo.sphere, bodyM, 0.2, 0.19, 0.5, 0, 0.34 + 0.16, 0);
    const body2 = part(geo.sphere, accM, 0.15, 0.1, 0.4, 0, 0.34 + 0.08, 0.02);
    const head = new THREE.Group(); head.position.set(0, legLen + 0.28 * L, 0.4 * L); pivot.add(head);
    part(geo.sphere, bodyM, 0.17, 0.16, 0.18, 0, 0, 0, head);
    part(geo.box, accM, 0.1, 0.08, 0.1, 0, -0.03, 0.17, head);
    part(geo.cone, bodyM, 0.05, 0.12, 0.05, 0.09, 0.1, -0.02, head);
    part(geo.cone, bodyM, 0.05, 0.12, 0.05, -0.09, 0.1, -0.02, head);
    part(geo.box, eyeM, 0.035, 0.035, 0.02, 0.065, 0.04, 0.15, head);
    part(geo.box, eyeM, 0.035, 0.035, 0.02, -0.065, 0.04, 0.15, head);
    const tail = new THREE.Group(); tail.position.set(0, legLen + 0.24 * L, -0.46 * L); pivot.add(tail);
    part(geo.box, accM, 0.05, 0.05, 0.3, 0, 0, -0.15, tail);
    tail.rotation.x = 0.5;
    const legs = [], pairs = legsN / 2;
    for (let pi = 0; pi < pairs; pi++) {
      const z = pairs === 1 ? 0 : 0.3 - (0.6 * pi) / (pairs - 1);
      for (let side = 0; side < 2; side++) {
        const pv = new THREE.Group(); pv.position.set((side ? -0.12 : 0.12) * L, legLen + 0.04 * L, z * L); pivot.add(pv);
        part(geo.boxTop, legM, 0.07, 0.34 + 0.04, 0.07, 0, 0, 0, pv);
        pv.userData.ph = ((pi + side) % 2) * Math.PI;
        legs.push(pv);
      }
    }
    // what can come off: head, tail and every leg (leg0..legN-1; legL / legR = the first pair)
    const V = (x, y, z) => new Vector3(x, y, z);
    const stump = (x, y, z, sx, sy, sz) => {
      const m = new THREE.Mesh(geo.sphere, stumpMat('blood'));
      m.position.set(x * L, y * L, z * L); m.scale.set(sx * L, sy * L, sz * L); m.visible = false; pivot.add(m);
      return m;
    };
    const limbDefs = {
      head: { obj: head, kind: 'head', center: V(0, 0, 0.05 * L), joint: V(0, 0, -0.1 * L), r: 0.16 * L, vital: true, weight: 0.8, stump: stump(0, 0.6, 0.3, 0.09, 0.08, 0.09), sdir: V(0, 0.4, 1) },
      tail: { obj: tail, kind: 'tail', center: V(0, 0, -0.15 * L), joint: V(0, 0, 0), r: 0.04 * L, stump: stump(0, 0.58, -0.45, 0.045, 0.045, 0.045), sdir: V(0, 0.4, -1) },
    };
    const legNames = [];
    for (let i = 0; i < legs.length; i++) {
      const pv = legs[i], nm = `leg${i}`;
      legNames.push(nm);
      limbDefs[nm] = { obj: pv, kind: 'leg', center: V(0, -0.19 * L, 0), joint: V(0, 0, 0), r: 0.04 * L, weight: 0.9, side: pv.position.x > 0 ? 1 : -1, stump: stump(pv.position.x / L, pv.position.y / L, pv.position.z / L, 0.05, 0.03, 0.05), sdir: V(pv.position.x > 0 ? 0.5 : -0.5, -0.5, 0) };
    }
    const target = {
      kind: 'creature', h: legLen + 0.5 * L, core: [body1, body2], coreCenter: V(0, 0.5 * L, 0), bodyCenter: V(0, 0.45 * L, 0), coreR: 0.2 * L,
      heldLimb: 'head', limbs: limbDefs, alias: { legL: 'leg0', legR: 'leg1' },
    };
    const anim = (a, dt, t, m) => {
      const lm = a.limbs, mm = Math.min(m, 1), amp = 0.7 * Math.min(m, 1.3);
      let miss = 0, tilt = 0;
      for (let i = 0; i < legs.length; i++) {
        const Ll = lm[legNames[i]];
        if (Ll.attached) legs[i].rotation.x = Math.sin(a.phase + legs[i].userData.ph) * amp;
        else { miss++; tilt += Ll.side; }
      }
      pivot.position.y = Math.abs(Math.sin(a.phase)) * 0.03 * L * mm + (a.waveT > 0 ? Math.abs(Math.sin(t * 9)) * 0.18 * L : 0) - (miss / legs.length) * legLen * 0.8;
      pivot.rotation.z = miss ? clamp((tilt / legs.length) * -0.5, -0.5, 0.5) : 0; // sags toward the side that lost legs
      if (lm.tail.attached) tail.rotation.y = Math.sin(t * (4 + 4 * (1 - mm)) + a.seed) * (0.25 + 0.3 * (1 - mm));
      let bite = 0;
      if (a.atkT >= 0) { // crouch back and rear up for the windup, then lunge forward
        pivot.position.z = (-0.14 * a.atkRaise + 0.4 * a.atkSwing) * L;
        pivot.rotation.x = -0.3 * a.atkRaise + 0.12 * a.atkSwing;
        bite = 0.5 * a.atkSwing;
      } else { pivot.position.z = 0; pivot.rotation.x = 0; }
      if (lm.head.attached) { head.rotation.y = a.lookYaw; head.rotation.x = -a.lookPitch + bite; }
    };
    return {
      kind: 'creature', speed: 1.5, stride: 6.2832 / (1.15 * L), anim, eyeH: legLen + 0.3 * L, hp: 12, radius: 0.45 * L, centerY: 0.4 * L,
      labelY: legLen + 0.55 * L + 0.1, deadAxis: 'z', deadAng: Math.PI, deadLift: legLen + 0.36 * L,
      heldParent: head, heldPos: [0, -0.06 * L, 0.2 * L], heldScale: L / 0.8,
      armsTotal: 0, legsTotal: legs.length, obsR: 0.3 * L, target,
    };
  }
  // kit.creature(ctx, { model: 'dog', size: bodyLengthMetres, tint, ... }) -> same options as humanoid's model
  function creature(c, o = {}) {
    const group = new THREE.Group(), pivot = new THREE.Group();
    group.add(pivot);
    const cand = o.model ? pickModel(o.model) : null;
    if (cand) return startModelActor(c, group, pivot, cand, o, cand.kind === 'humanoid' ? 'humanoid' : 'creature');
    return makeActor(c, group, pivot, buildCreature(o, group, pivot), o);
  }

  // ------------------------------------------------------------------ main update
  function stage(list, fn, dt, t) {
    for (let i = list.length - 1; i >= 0; i--) {
      try { fn(list[i], dt, t); } catch (err) {
        console.error('[kit] simulation error; removing the offending object', err);
        const e = list[i];
        if (e) { if (e.remove) e.remove(); else if (e.dispose) e.dispose(); dropFrom(list, e); }
      }
    }
  }
  // pooled systems keep their meshes in ctx.state; adopt them into this version's root (the old root was disposed on reload)
  DEC = ensureDecals(); DB = ensureDebris();
  for (const a of reg.actors) { if (a.group && a.group.userData) a.group.userData.actor = a; a.id ??= 'a' + (++state.actorSeq); a.name ??= a.kind === 'creature' ? 'creature' : 'villager'; a.role ??= ''; } // adopt actors made by an older kit.js
  for (const P of reg.parts) { ctx.root.add(P.holder); if (P.ph) P.ph.parent0 = ctx.root; }
  for (const rd of reg.rags) if (rd.holders) for (const hd of rd.holders) { ctx.root.add(hd.holder); if (hd.ph) hd.ph.parent0 = ctx.root; }
  impl.dhit = dhit; impl.goreHit = goreHitImpl; impl.goreKill = goreKillImpl; impl.severPub = severPub;
  impl.destructHit = destructHit; impl.treeFall = treeFall;
  impl.destructBreak = (h) => doBreak(h, h.damage.lastHit.direction, { kind: h.damage.lastHit.kind, amount: h.damage.lastHit.amount });
  impl.destructForce = (h, dir, bo) => {
    if (h.broken || h.removed) return false;
    h.damage.lastHit.kind = (bo && bo.kind) || 'blunt';
    doBreak(h, dir, bo);
    return true;
  };
  impl.destructRepair = destructRepair;

  // kit.actor(ctx, { model, ... }): a humanoid or a creature depending on the model's rig (primitive person when no model resolves)
  function actor(c, o = {}) {
    const cand = o.model ? pickModel(o.model) : null;
    return cand && cand.kind === 'creature' ? creature(c, o) : humanoid(c, o);
  }
  const api = {
    version: 7, physics: () => PH(), get actors() { return reg.actors; }, actor, pickModel, modelBody, rigs: RIGS, particles, trail, humanoid, creature, body, label, sound, light, flash, damageable, hit, nearestTarget,
    explosion, clamp, lerp, damp, rand, ease, haptic, factionOf, hostile,
    gore: goreApi, dismemberable, destructible, structure, fellable, obstacle, debris: debrisAt,
    scorch: (point, radius, o) => { scorch(point, radius, o); }, crater,
    stats: () => ({
      particlesLive: reg.particles.reduce((n, e) => n + (e.live | 0), 0), particleCap: liveCap(), goreQueue: GQ.length, lightsOn: pool.reduce((n, l) => n + (l.intensity > 0.01 ? 1 : 0), 0),
      particles: reg.particles.reduce((n, e) => n + (e.shared ? 0 : 1), 0), bodies: reg.bodies.length, actors: reg.actors.length, damageables: reg.damageables.length, lights: reg.lights.length, voices,
      parts: reg.parts.length, debris: DB.live, bleeds: reg.bleeds.length, destructibles: reg.destructibles.length, obstacles: reg.obstacles.length,
      decals: DEC.blood.items.reduce((n, it) => n + (it.st ? 1 : 0), 0) + DEC.scorch.items.reduce((n, it) => n + (it.st ? 1 : 0), 0),
      ragdolls: reg.rags.length, physicsBodies: reg.bodies.reduce((n, b) => n + (b.ph ? 1 : 0), 0), physics: !!PH(),
    }),
  };
  ctx.provide('kit', api);
  // pre-warm at load: the shared effect emitters (15 pooled systems), unit geometry and stump materials exist before the first fight, and their
  // shader programs are compiled off the critical path where the browser can (renderer.compileAsync)
  // (the shader programs are compiled when boot announces 'modules:synced': a program is keyed by the scene's lights, which later modules still add)
  try { fx(); geos(); for (const g of ['blood', 'bones', 'sparks', 'slime', 'none']) stumpMat(g); } catch (err) { console.warn('[kit] pre-warm skipped', err); }
  ctx.on('modules:synced', () => {
    try {
      const R = ctx.renderer;
      if (!R || typeof R.compile !== 'function' || !ctx.scene || !ctx.camera) return;
      const warm = new THREE.Scene(), F = fx();
      warm.add(new THREE.Points(F.blood.geometry, F.blood.material));      // every particle material shares this program (the emitters are invisible until used)
      warm.add(new THREE.Mesh(geos().sphere, stumpMat('blood')));          // stumps, cut faces, stand-in limbs: Lambert + emissive
      const p = R.compileAsync ? R.compileAsync(warm, ctx.camera, ctx.scene) : (R.compile(warm, ctx.camera, ctx.scene), null);
      if (p && p.catch) p.catch(() => {});
    } catch (err) { /* optional */ }
  });

  return {
    update(dt, t) {
      dt = Math.min(dt, 0.05);
      state.frameNo++;
      { let live = 0; const E = reg.particles; for (let i = 0; i < E.length; i++) live += E[i].live | 0; liveLeft = liveCap() - live; } // this frame's particle budget
      safe('grab', stepGrab, dt);
      safe('bodies', stepBodies, dt);
      stage(reg.actors, stepActor, dt, t);
      stepDamageables(dt);
      safe('lights', stepLights, dt, t);
      safe('labels', stepLabels, dt);
      safe('delays', stepDelays, dt);
      safe('goreq', stepGoreQueue);
      safe('warm', stepWarm);
      safe('parts', stepParts, dt);
      safe('bleeds', stepBleeds, dt);
      safe('falls', stepFalls, dt);
      safe('destructibles', stepDestructibles, dt);
      safe('debris', stepDebris, dt);
      safe('blood', stepDecalPool, DEC.blood, dt);
      safe('scorch', stepDecalPool, DEC.scorch, dt);
      safe('obstacles', stepPlayerObstacles, dt);
      const pt = !!(ctx.input && ctx.input.passthrough);
      if (pt !== state.lastPT) { state.lastPT = pt; for (const e of reg.particles) applyBlend(e); } // mixed reality: additive particles must not write alpha
      stage(reg.particles, stepEmitter, dt);
    },
    dispose() {
      for (const name of HANDS) if (grab[name].body) releaseBody(grab[name], false);
      for (const l of pool) ctx.scene.add(l); // the light pool outlives this root: a reload (or the next instance) adopts it, the scene's light count never changes
    },
  };
}
