// core/blast.js — world.blast: "blast" a sentence or a picture into a whole scene. A place (generated 360 sky + ground, via world.travel) with the picture's objects standing in it
//   as real physical props you can grab, throw and smash (each is a generated 3D model), and its own sounds. PREFER IT FOR "take me to..", "show me..", "build me a scene of..".
//   (plain change of scenery, no props -> world.travel.go;  standard things -> world.library;  ONE new object -> world.models.generate.)
// USE   const h = ctx.world.blast.create('a goblin market in a canyon at dusk');   // or create({ prompt, options }) or create({ image: 'castle.png' })  (file name in D:\omnissiah\input)
//   return {}  — it runs by itself for MINUTES (first time: 8-14 min; the same sentence again: instant). The player never waits in limbo: as soon as the picture exists it hovers before them as
//   a softly glowing vision with the current stage beneath it, the objects pop out of it one by one onto the ground in front of them, and when the world is ready they are carried into it.
//   h.ready (Promise -> h once the player stands in the place, or null on failure)  h.state 'queued'|'running'|'arrived'|'failed'|'removed'  h.stage  h.message  h.progress {done,total}
//   h.slug  h.manifest (once known)  h.props (live prop records)  h.remove() (cleans up this blast, does not travel back)
// API   blast.create(promptOrOpts) -> h     opts { prompt | image, options: { maxObjects: 8 (max 14), seed, budgetMs, fantasy: true for magical scenes, force: true to redo } }
//       blast.list() -> array of finished blasts [{ slug, name, caption, thumb, prompt, objects, created }] (also awaitable: await blast.list() reads the cache fresh)
//       blast.open(slug) -> h   instant, from the cache (no generation)     blast.inputs() -> Promise<[{ name, path, size }]>  the pictures in D:\omnissiah\input
//       blast.current -> { slug, name, ... } | null    blast.home() -> leave: removes the props and travels back (world.travel.home)    blast.cleanup()
//       events: 'blast:progress' { id, slug, stage, state, message, progress }   'blast:arrive' { slug, name, objects }   'blast:home'
// GOOD PROMPTS: ONE coherent place, named with a few distinct things you can pick up:  "a wizard's cluttered tower study at night, big oak desk with a globe and a skull, potion cabinet, barrels"
//   "an abandoned greenhouse overgrown with glowing plants, clay pots, watering cans, a rusty wheelbarrow". Say the time of day and the mood. Not: crowds, battles, abstract ideas.
//   For magical scenes pass options.fantasy = true. Mixed reality: no place — the things appear on the real floor around the player. Budgets: <= 14 objects (+ copies), they obey world.perf.
export const meta = { name: 'Blast', description: 'A sentence or a picture becomes a place with physical props and sound (local image-blaster).' };

import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';

const BASE = '/assets/generated/blasts';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (x) => x * x * (3 - 2 * x);

export default function (ctx) {
  const THREE = ctx.THREE;
  const { Vector3, Group, Mesh } = THREE;
  const world = ctx.world;
  const S = ctx.state;
  S.cur ??= null;                       // { id, slug, prompt, manifest, phase } — survives hot reloads
  S.known ??= [];                       // last cache listing
  const quest = () => !!ctx.quality && ctx.quality.tier === 'quest';
  const mr = () => !!(ctx.input && ctx.input.passthrough);
  const hud = (t, s = 4) => { try { ctx.hud.show(t, s); } catch { /* optional */ } };
  const emit = (n, p) => { try { ctx.events.emit(n, p); } catch { /* optional */ } };
  let disposed = false;

  // ------------------------------------------------------------------ GLB cache (own loader; shared geometry per url, cloned per instance)
  const loader = new GLTFLoader();
  const glbs = new Map();               // url -> Promise<{ scene, size: Vector3, center: Vector3 }>
  function loadGlb(url) {
    let p = glbs.get(url);
    if (p) return p;
    p = new Promise((resolve, reject) => {
      loader.load(url, (gltf) => {
        const scene = gltf.scene;
        scene.traverse((o) => {
          if (!o.isMesh) return;
          o.userData.noOutline = false;
          if (quest()) { // the headset takes the cheap material (world.style still bands its light)
            const conv = (m) => (m && m.isMeshStandardMaterial ? new THREE.MeshLambertMaterial({ name: m.name, color: m.color.clone(), map: m.map ?? null, vertexColors: m.vertexColors, side: m.side, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest }) : m);
            o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
          }
        });
        const box = new THREE.Box3().setFromObject(scene);
        resolve({ scene, size: box.getSize(new Vector3()), center: box.getCenter(new Vector3()), box });
      }, undefined, (err) => reject(err instanceof Error ? err : new Error(`could not load ${url}`)));
    });
    glbs.set(url, p);
    p.catch(() => glbs.delete(url));
    return p;
  }

  // ------------------------------------------------------------------ sound (own small engine on the game's AudioContext: loops, positional hits)
  const ac = ctx.audio && ctx.audio.context;
  const buffers = new Map();            // url -> Promise<AudioBuffer|null>
  function loadBuffer(url) {
    if (!ac || !url) return Promise.resolve(null);
    let p = buffers.get(url);
    if (!p) {
      p = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((b) => ac.decodeAudioData(b)).catch((err) => { console.warn('[blast] sound', url, err && err.message); return null; });
      buffers.set(url, p);
    }
    return p;
  }
  let ambient = null;                   // { src, gain, url }
  async function startAmbient(url, volume = 0.5) {
    if (!ac || !url || (world.audio && world.audio.enabled === false)) return;
    if (ambient && ambient.url === url) return;
    stopAmbient(1.5);
    const buf = await loadBuffer(url);
    if (!buf || disposed) return;
    try {
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      const src = ac.createBufferSource(), gain = ac.createGain();
      src.buffer = buf; src.loop = true; gain.gain.value = 0;
      src.connect(gain); gain.connect(ac.destination);
      src.start();
      gain.gain.setTargetAtTime(volume, ac.currentTime, 1.2);
      ambient = { src, gain, url };
    } catch (err) { console.warn('[blast] ambient failed', err); }
  }
  function stopAmbient(fade = 1.5) {
    const a = ambient; ambient = null;
    if (!a) return;
    try { a.gain.gain.setTargetAtTime(0, ac.currentTime, fade / 3); a.src.stop(ac.currentTime + fade + 0.2); } catch { /* already stopped */ }
  }
  let hits = 0;
  const _pl = new Vector3();
  async function playHit(url, at, volume, fallbackName) {
    const A = world.audio;
    const buf = ac && url ? await loadBuffer(url) : null;
    if (!buf || !ac || ac.state !== 'running' || hits >= 6) { if (fallbackName && A && A.sfx) A.sfx(fallbackName, { at, volume }); return; }
    if (A && A.enabled === false) return;
    try {
      const src = ac.createBufferSource(), g = ac.createGain(), p = ac.createPanner();
      src.buffer = buf; src.playbackRate.value = 0.94 + Math.random() * 0.12; g.gain.value = clamp(volume, 0.05, 1.2);
      p.panningModel = quest() ? 'equalpower' : 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.5; p.rolloffFactor = 1.3;
      if (p.positionX) { p.positionX.value = at.x; p.positionY.value = at.y; p.positionZ.value = at.z; } else p.setPosition(at.x, at.y, at.z);
      src.connect(g); g.connect(p); p.connect(ac.destination);
      hits++; src.onended = () => { hits--; try { src.disconnect(); g.disconnect(); p.disconnect(); } catch { /* ignore */ } };
      src.start();
    } catch { /* best effort */ }
  }

  // ------------------------------------------------------------------ run state (one blast at a time)
  let run = null;       // { id, slug, handle, vision, props:[], manifest, frame, stage, disposed, travelled, listeners }

  // ---- the frame: where the layout's coordinates live in the world. In a place: the origin, the picture straight ahead (-Z). Otherwise: where the player stood and looked.
  function playerFrame() {
    const f = ctx.player.forward, feet = ctx.player.feet;
    const yaw = Math.atan2(-f.x, -f.z);        // 0 = -Z; the layout's -Z maps onto where the player looks
    return { x: feet.x, z: feet.z, yaw, compress: 1 };
  }
  const placeFrame = () => ({ x: 0, z: 0, yaw: 0, compress: 1 });
  function toWorld(frame, p, out = new Vector3()) {
    let x = p[0], z = p[2];
    if (frame.fn || frame.compress !== 1) { const r = Math.hypot(x, z) || 1, r2 = frame.fn ? frame.fn(r) : r * frame.compress; x *= r2 / r; z *= r2 / r; }
    const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
    // rotate about Y by frame.yaw (three: +yaw turns -Z toward -X)
    return out.set(frame.x + x * c + z * s, 0, frame.z - x * s + z * c);
  }
  const groundOf = (x, z) => ctx.groundAt(x, z);

  // ------------------------------------------------------------------ the vision: the picture hovering before the player while the blast runs
  function makeGlowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 8, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,236,190,0.9)'); grd.addColorStop(0.55, 'rgba(255,214,150,0.28)'); grd.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function makeVision(frameInfo) {
    const group = new Group(); group.name = 'blast-vision';
    const W = mr() ? 1.9 : 4.2, H = W / (frameInfo.aspect || 16 / 9);
    const dist = mr() ? 2.2 : 4.6;
    const f = ctx.player.forward, head = ctx.player.head;
    const fx = f.x, fz = f.z, fl = Math.hypot(fx, fz) || 1;
    group.position.set(head.x + (fx / fl) * dist, Math.max(head.y, groundOf(head.x, head.z) + 1.5) + 0.15, head.z + (fz / fl) * dist);
    group.lookAt(head.x, group.position.y, head.z);       // the plane faces the player (+Z of a plane toward the lookAt target)
    const tag = (m) => { m.userData.noShadow = true; m.userData.noOutline = true; m.userData.noCull = true; m.userData._shadowed = true; m.userData.noBlob = true; m.frustumCulled = false; return m; };
    const halo = tag(new Mesh(new THREE.PlaneGeometry(W * 1.55, H * 1.9), new THREE.MeshBasicMaterial({ map: makeGlowTexture(), transparent: true, opacity: 0, depthWrite: false, fog: false })));
    halo.position.z = -0.06; halo.renderOrder = 5;
    const frame = tag(new Mesh(new THREE.PlaneGeometry(W * 1.045, H * 1.07), new THREE.MeshBasicMaterial({ color: 0x3a2a18, transparent: true, opacity: 0, fog: false })));
    frame.position.z = -0.02; frame.renderOrder = 6;
    const canvas = tag(new Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: 0x1c1830, transparent: true, opacity: 0, fog: false, toneMapped: false })));
    canvas.renderOrder = 7;
    group.add(halo, frame, canvas);
    // drifting motes (plain alpha blending: no additive, so mixed reality stays correct)
    const N = 90, pos = new Float32Array(N * 3), seeds = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { seeds[i * 3] = Math.random() * 6.283; seeds[i * 3 + 1] = 0.55 + Math.random() * 0.75; seeds[i * 3 + 2] = Math.random(); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = tag(new THREE.Points(mg, new THREE.PointsMaterial({ color: 0xffe2a8, size: mr() ? 0.025 : 0.04, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true, fog: false })));
    motes.renderOrder = 8;
    group.add(motes);
    ctx.root.add(group);
    const v = { group, halo, frame, canvas, motes, mg, pos, seeds, W, H, want: 1, fade: 0, label: null, tex: null, loadedAt: -1, t: 0, base: group.position.clone() };
    // the line beneath the picture
    const K = world.kit;
    if (K && K.label) { try { v.label = K.label(ctx, ' ', { size: mr() ? 0.07 : 0.11, position: new Vector3(group.position.x, group.position.y - H / 2 - 0.34, group.position.z), color: '#ffe9c4' }); } catch { v.label = null; } }
    v.setText = (t) => { if (v.label && v.text !== t) { v.text = t; try { v.label.set(t); } catch { /* ignore */ } } };
    return v;
  }
  function visionImage(v, url) {
    new THREE.TextureLoader().load(url, (t) => {
      if (disposed || !run || run.vision !== v) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      v.canvas.material.map = t; v.canvas.material.color.set(0xffffff); v.canvas.material.needsUpdate = true; v.tex = t; v.loadedAt = v.t;
    }, undefined, () => { /* the picture stays dark */ });
  }
  function updateVision(v, dt) {
    v.t += dt;
    v.fade += (v.want - v.fade) * Math.min(1, dt * 1.6);
    const shown = v.loadedAt >= 0 ? Math.min(1, (v.t - v.loadedAt) / 1.4) : 0;
    v.canvas.material.opacity = v.fade * (0.25 + 0.75 * ease(shown));
    v.frame.material.opacity = v.fade * 0.95;
    v.halo.material.opacity = v.fade * (0.5 + 0.12 * Math.sin(v.t * 1.3)) * (0.6 + 0.4 * shown);
    v.motes.material.opacity = v.fade * 0.8;
    v.group.position.y = v.base.y + Math.sin(v.t * 0.8) * 0.035;
    const P = v.pos, S2 = v.seeds, rx = v.W * 0.62, ry = v.H * 0.66;
    for (let i = 0; i < P.length / 3; i++) {
      const a = S2[i * 3] + v.t * (0.05 + S2[i * 3 + 2] * 0.07), k = S2[i * 3 + 1];
      P[i * 3] = Math.cos(a) * rx * k; P[i * 3 + 1] = Math.sin(a * 1.3 + i) * ry * k + Math.sin(v.t * 0.7 + i) * 0.1; P[i * 3 + 2] = Math.sin(a * 0.7) * 0.25 - 0.05;
    }
    v.mg.attributes.position.needsUpdate = true;
    if (v.label) v.label.position.set(v.group.position.x, v.group.position.y - v.H / 2 - 0.34, v.group.position.z);
  }
  function disposeVision(v) {
    if (!v) return;
    try { v.label && v.label.remove(); } catch { /* ignore */ }
    v.group.removeFromParent();
    v.group.traverse((o) => { o.geometry && o.geometry.dispose(); if (o.material) { o.material.map && o.material.map.dispose(); o.material.dispose(); } });
  }
  // a point on the picture (normalised box centre) in world space
  function pictureSpot(v, box, out) {
    const u = (box[0] + box[2]) / 2 - 0.5, w = 0.5 - (box[1] + box[3]) / 2;
    out.set(u * v.W, w * v.H, 0.12).applyMatrix4(v.group.matrixWorld);
    return out;
  }

  // ------------------------------------------------------------------ props
  // record: { entry, copy, holder, inner, body, destructible, state, anim, pinned, broken, size:[w,h,d] }
  function propBudget(n) { const P = world.perf; return P && P.allow ? P.allow('bodies', n) : n; }
  async function makeProp(entry, copyIndex, startPos, lands) {
    const K = world.kit;
    if (!K || !run) return null;
    const my = run;
    let g;
    try { g = await loadGlb(entry.url); } catch (err) { console.warn('[blast] model', entry.id, err && err.message); return null; }
    if (disposed || run !== my) return null;
    const sc = entry.scale || 1;
    const model = g.scene.clone(true);
    model.traverse((o) => { if (o.isMesh) { o.geometry = o.geometry.clone(); o.userData.noOutline = false; } });
    const w = g.size.x * sc, h = g.size.y * sc, d = g.size.z * sc;
    const c = g.center.clone().multiplyScalar(sc);
    const holder = new Group(); holder.name = `blast:${entry.id}`;
    const inner = new Group(); inner.add(model); model.scale.setScalar(sc);
    inner.position.set(-c.x, -c.y, -c.z);
    holder.add(inner);
    holder.rotation.y = lands.yaw;
    const rec = { entry, copy: copyIndex, holder, inner, body: null, destructible: null, state: 'flying', anim: null, broken: false, size: [w, h, d], center: c, lands: lands.pos.clone(), lastHit: 0 };
    holder.position.copy(startPos);
    ctx.root.add(holder);
    const radius = clamp(Math.max(w, d) * 0.5, 0.08, 1.2);
    const fixed = !!entry.fixed;
    const mass = fixed ? 0 : clamp(entry.mass || 3, 0.2, 150);
    rec.body = K.body(ctx, holder, {
      shape: 'box', size: [Math.max(0.04, w), Math.max(0.04, h), Math.max(0.04, d)], radius, mass, bounce: entry.bounce ?? 0.15, friction: entry.friction ?? 0.6,
      grabbable: !!entry.grabbable && !fixed, grabRange: entry.grabbable && !fixed && !quest() ? 2.5 : 0, position: startPos, damage: 0,
    });
    rec.wasInvMass = rec.body.invMass;
    rec.body.invMass = 0;                   // pinned while it flies out of the picture
    rec.body.velocity.set(0, 0, 0);
    if (K.destructible) {
      try {
        rec.destructible = K.destructible(ctx, holder, {
          hp: entry.hp, material: entry.material || 'wood', mass: entry.mass, collide: false, faction: 'neutral',
          onBreak: () => { rec.broken = true; rec.state = 'broken'; try { rec.body && rec.body.remove(); } catch { /* gone */ } rec.body = null; },
        });
      } catch (err) { console.warn('[blast] destructible', err && err.message); }
    }
    if (rec.body) {
      rec.body.onHit((e) => {
        if (!e || e.speed < 1.5) return;
        const t = ctx.clock.t;
        if (t - rec.lastHit < 0.18) return;
        rec.lastHit = t;
        const at = e.point || rec.holder.position;
        playHit(entry.sound && entry.sound.url, at, clamp(0.25 + e.speed * 0.12, 0.2, 1) * (entry.material === 'glass' ? 0.8 : 1), entry.material === 'stone' ? 'debris-thud' : 'debris-thud');
      });
    }
    my.props.push(rec);
    return rec;
  }
  function releaseProp(rec) {
    if (!rec.body || rec.broken) return;
    rec.body.invMass = rec.entry.fixed ? 0 : rec.wasInvMass;
    rec.body.velocity.set(0, 0, 0);
    rec.state = 'rest';
  }
  function removeProp(rec) {
    rec.state = 'gone';
    try { rec.destructible && rec.destructible.remove(); } catch { /* gone */ }
    try { rec.body && rec.body.remove(); } catch { /* gone */ }
    rec.holder.removeFromParent();
  }
  // where an object stands on the ground at layout position p (a [x,y,z] row) in `frame`
  function standingPos(rec, p, frame, out = new Vector3()) {
    toWorld(frame, p, out);
    out.y = groundOf(out.x, out.z) + p[1] + rec.size[1] / 2 + 0.02 + (p[1] > 0.05 ? 0.03 : 0);
    return out;
  }
  function entriesOf(m) {
    const list = [];
    for (const o of m.objects || []) {
      list.push({ entry: o, copy: 0, p: o.position, yaw: o.yaw });
      (o.copies || []).forEach((cp, i) => list.push({ entry: o, copy: i + 1, p: cp.position, yaw: cp.yaw }));
    }
    return list;
  }

  // ------------------------------------------------------------------ staging (objects pop out of the picture in front of the player)
  const _a = new Vector3(), _b = new Vector3();
  async function stageObject(obj) {
    if (!run || !run.vision) return;
    run.stagedIds ??= new Set();
    if (run.stagedIds.has(obj.id)) return;
    run.stagedIds.add(obj.id);
    const n = 1;
    if (propBudget(1) < 1) return;
    const frame = run.stageFrame ??= playerFrame();
    const start = pictureSpot(run.vision, obj.from ? obj.from.box : [0.4, 0.4, 0.6, 0.6], new Vector3());
    // the staging fan: nearer than the painting and spread wider than the picture shows, so everything is within reach and nothing overlaps
    const bearing = Math.atan2(obj.position[0], -obj.position[2]), dist = Math.hypot(obj.position[0], obj.position[2]);
    const rad = Math.max(0.15, 0.5 * Math.max(...(obj.dims || [0.4, 0.4, 0.4])) * 0.9);
    let a = clamp(bearing * 2.2, -1.05, 1.05), r = clamp(0.2 * dist + 1.3, 1.8, 3.1);
    const placed = run.stagedAt ??= [];
    for (let iter = 0; iter < 30; iter++) {
      let moved = false;
      for (const o of placed) {
        const x = r * Math.sin(a), z = -r * Math.cos(a), dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), need = rad + o.rad + 0.1;
        if (d < need) { a += (a >= o.a ? 1 : -1) * ((need - d) / r + 0.02); r = clamp(r + (iter % 2 ? 0.12 : -0.0), 1.8, 3.4); moved = true; }
      }
      if (!moved) break;
    }
    placed.push({ a, r, x: r * Math.sin(a), z: -r * Math.cos(a), rad });
    const sp = [r * Math.sin(a), obj.position[1], -r * Math.cos(a)];
    const lands = { pos: new Vector3(), yaw: obj.yaw + frame.yaw };
    lands.pos.copy(standingPosFor(obj, sp, frame));
    const rec = await makeProp({ ...obj, hp: obj.hp, copies: [] }, 0, start, lands);
    if (!rec) { run && run.stagedIds && run.stagedIds.delete(obj.id); return; }
    rec.anim = { t: 0, dur: 1.6 + Math.random() * 0.4, from: start.clone(), to: lands.pos.clone(), arc: 0.7 + Math.random() * 0.5, spin: (Math.random() - 0.5) * 5 };
    rec.inner.scale.setScalar(0.04);
    void n;
  }
  function standingPosFor(obj, p, frame) {
    // size is not known before the GLB loads: use the estimate (scaled dims) for the first resting height; makeProp's body settles under gravity anyway
    const h = (obj.dims && obj.dims[1]) || 0.5;
    const out = toWorld(frame, p, new Vector3());
    out.y = groundOf(out.x, out.z) + (obj.fixed ? p[1] : 0) + h / 2 + 0.03;
    return out;
  }

  // ------------------------------------------------------------------ arriving in the place (or settling in the current world)
  function reseatAll(manifest, frame, { settle = true } = {}) {
    if (!run) return;
    const rows = entriesOf(manifest);
    const done = new Set();
    for (const row of rows) {
      let rec = run.props.find((r) => r.entry.id === row.entry.id && r.copy === row.copy && !r.broken && r.state !== 'gone' && !done.has(r));
      if (rec) done.add(rec);
      if (!rec) { // not staged (late, over budget, or a copy): make it where it belongs
        spawnFinal(row, frame, settle);
        continue;
      }
      rec.entry = Object.assign(rec.entry, { ...row.entry, copies: [] });
      standingPos(rec, row.p, frame, rec.lands);
      rec.anim = null; rec.inner.scale.setScalar(1); rec.inner.position.set(-rec.center.x, -rec.center.y, -rec.center.z);
      rec.holder.rotation.set(0, row.yaw + frame.yaw, 0);
      if (rec.body) { rec.body.position.copy(rec.lands); rec.body.velocity.set(0, 0, 0); rec.body.invMass = 0; rec.state = 'pinned'; rec.pinUntil = ctx.clock.t + (settle ? 0.9 : 0.2); }
      else rec.holder.position.copy(rec.lands);
    }
    // anything staged that the final layout dropped (should not happen) is removed
    for (const rec of run.props) if (!done.has(rec) && !rows.some((r) => r.entry.id === rec.entry.id && r.copy === rec.copy) && rec.state !== 'gone') removeProp(rec);
  }
  async function spawnFinal(row, frame, settle) {
    if (!run || propBudget(1) < 1) return;
    const start = new Vector3(), lands = { pos: new Vector3(), yaw: row.yaw + frame.yaw };
    const dims = row.entry.dims || [0.5, 0.5, 0.5];
    toWorld(frame, row.p, lands.pos); lands.pos.y = groundOf(lands.pos.x, lands.pos.z) + row.p[1] + dims[1] / 2 + 0.03;
    start.copy(lands.pos);
    const rec = await makeProp({ ...row.entry, copies: [] }, row.copy, start, lands);
    if (!rec || !run) return;
    standingPos(rec, row.p, frame, rec.lands);
    if (rec.body) { rec.body.position.copy(rec.lands); rec.body.velocity.set(0, 0, 0); rec.state = 'pinned'; rec.pinUntil = ctx.clock.t + (settle ? 0.9 : 0.2); rec.anim = { t: 0, dur: 0.6, from: rec.lands.clone(), to: rec.lands.clone(), arc: 0, spin: 0, pop: true }; }
    rec.inner.scale.setScalar(0.04);
  }

  // keep the player facing the picture direction after arriving (the layout assumes -Z is where the picture is)
  function faceForward() {
    try {
      const f = ctx.player.forward;
      const yaw = Math.atan2(-f.x, -f.z);
      const head = ctx.player.head.clone();
      ctx.rig.rotation.y -= yaw;
      // keep the head where it was (the rig turns about its own origin)
      const nh = new Vector3(); ctx.camera.getWorldPosition(nh);
      ctx.rig.position.x += head.x - nh.x; ctx.rig.position.z += head.z - nh.z;
    } catch { /* optional */ }
  }

  async function stepIntoPlace(my, manifest) {
    const T = world.travel;
    if (mr()) return false;
    if (!manifest.place || !manifest.place.slug) return false;
    if (!T || !T.go) { hud('The world cannot carry you right now; the things will stand here.', 5); return false; }
    my.travelState = 'going';
    if (my.vision) my.vision.want = 0;
    const h = T.go({ place: manifest.place.slug });
    my.travelHandle = h;
    const res = await h.ready;
    if (disposed || run !== my) return false;
    if (!res) { hud('The journey faltered; the things will stand here.', 5); my.travelState = 'failed'; return false; }
    my.travelState = 'arrived';
    return true;
  }

  // ------------------------------------------------------------------ status handling
  function onStatus(m) {
    if (!run || disposed) return;
    if (m.id !== run.id && m.slug !== run.slug) return;
    if (m.slug && !run.slug) run.slug = m.slug;
    const h = run.handle;
    h.stage = m.stage; h.message = m.message; h.progress = m.progress || h.progress;
    if (m.state === 'error' && (m.stage === 'image' || m.stage === 'done') && !run.manifest) { fail(m.message); return; }
    h.state = h.state === 'arrived' ? 'arrived' : 'running';
    S.cur = { ...(S.cur || {}), id: run.id, slug: run.slug, prompt: run.prompt, stage: m.stage };
    if (run.vision) run.vision.setText(m.message || '');
    emit('blast:progress', { id: run.id, slug: run.slug, stage: m.stage, state: m.state, message: m.message, progress: m.progress });
    switch (m.stage) {
      case 'image':
        if (m.state === 'done' && m.result && m.result.image) {
          run.aspect = m.result.aspect || 16 / 9;
          if (!run.vision) run.vision = makeVision({ aspect: run.aspect });
          visionImage(run.vision, m.result.image);
          run.vision.setText(m.message || '');
          if (m.result.slug) run.slug = m.result.slug;
          hud('A vision forms before you.', 4);
        }
        break;
      case 'objects':
        if (m.result && m.result.object && m.result.object.ok && m.result.object.url) { run.objs.set(m.result.object.id, m.result.object); if (run.vision && !run.arrivedPlace && !run.manifest) stageObject(m.result.object); }
        break;
      case 'layout':
        if (m.state === 'done' && m.result && m.result.objects) onManifest(m.result, false);
        break;
      case 'done':
        if (m.state === 'done' && m.result && m.result.objects) onManifest(m.result, true);
        else if (m.state === 'error' && !run.manifest) fail(m.message);
        break;
      default: break;
    }
  }
  function fail(message) {
    if (!run) return;
    const my = run;
    my.handle.state = 'failed'; my.handle.message = message;
    hud(message || 'The vision failed.', 6);
    if (my.vision) my.vision.setText(message || 'The vision failed.');
    my.resolveReady(null);
    setTimeout(() => { if (run === my) { disposeVision(my.vision); my.vision = null; } }, 8000);
    emit('blast:failed', { slug: my.slug, message });
  }
  async function onManifest(manifest, final) {
    const my = run;
    if (!my) return;
    if (my.manifest && !final) return;
    const first = !my.manifest;
    my.manifest = manifest; my.handle.manifest = manifest;
    S.cur = { ...(S.cur || {}), id: my.id, slug: manifest.slug, prompt: my.prompt, manifest, phase: my.arrivedPlace ? 'arrived' : 'staging' };
    if (final && !first) { applySounds(manifest); return; }
    if (!first) return;
    let frame;
    const wentIn = await stepIntoPlace(my, manifest);
    if (disposed || run !== my) return;
    my.arrivedPlace = wentIn;
    if (wentIn) { faceForward(); frame = placeFrame(); }
    else { frame = playerFrame(); frame.fn = mr() ? (r) => clamp(0.28 * r + 0.5, 0.9, 3.0) : (r) => clamp(r * 0.62, 1.8, 9); }
    my.frame = frame;
    reseatAll(manifest, frame, { settle: true });
    if (my.vision) my.vision.want = 0;                       // fades out, then update() removes it
    applySounds(manifest);
    if (manifest.music && world.audio && world.audio.setMood && wentIn) { try { world.audio.setMood(manifest.music); } catch { /* optional */ } }
    my.handle.state = 'arrived';
    S.cur.phase = 'arrived';
    emit('blast:arrive', { slug: manifest.slug, name: manifest.name, objects: (manifest.objects || []).length, place: !!wentIn });
    hud(wentIn ? `You stand in ${manifest.name}.` : `${manifest.name}: the things are here.`, 5);
    my.resolveReady(my.handle);
  }
  function applySounds(manifest) {
    if (!run) return;
    for (const rec of run.props) { const o = (manifest.objects || []).find((x) => x.id === rec.entry.id); if (o && o.sound) rec.entry.sound = o.sound; }
    for (const o of manifest.objects || []) if (o.sound && o.sound.url) loadBuffer(o.sound.url);
    if (manifest.ambient && manifest.ambient.url && (run.arrivedPlace || mr())) startAmbient(manifest.ambient.url, 0.5);
  }

  // ------------------------------------------------------------------ creating / opening / leaving
  function newRun(id, prompt) {
    const handle = { id, slug: null, state: 'queued', stage: 'queued', message: 'Gathering my thoughts', progress: { done: 0, total: 0 }, manifest: null, props: null, ready: null, remove: () => { if (run && run.handle === handle) cleanup(); } };
    const r = { id, slug: null, prompt, handle, vision: null, props: [], objs: new Map(), manifest: null, frame: null, arrivedPlace: false, aspect: 16 / 9, resolveReady: null };
    handle.ready = new Promise((res) => { r.resolveReady = res; });
    Object.defineProperty(handle, 'props', { get: () => r.props, enumerable: true });
    return r;
  }
  function create(input) {
    const o = typeof input === 'string' ? { prompt: input } : (input || {});
    const prompt = typeof o.prompt === 'string' ? o.prompt.trim() : '';
    if (!prompt && !o.image) { const h = { state: 'failed', message: 'Say what you wish to see.', ready: Promise.resolve(null), remove() {} }; hud(h.message); return h; }
    cleanup({ keepTravel: true });
    const id = `blast-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
    run = newRun(id, prompt || String(o.image));
    run.vision = makeVision({ aspect: 16 / 9 });
    run.vision.setText('I am gathering my thoughts');
    S.cur = { id, slug: null, prompt: run.prompt, phase: 'starting' };
    if (!ctx.net || !ctx.net.send({ type: 'blast', id, prompt: prompt || undefined, image: o.image || undefined, options: o.options || {} })) fail('I cannot reach my own mind right now (no connection to the server).');
    else hud('The Omnissiah begins to dream. This takes a few minutes; the vision will appear.', 6);
    return run.handle;
  }
  async function open(slug) {
    cleanup({ keepTravel: true });
    const id = `blast-open-${Date.now().toString(36)}`;
    run = newRun(id, String(slug));
    const my = run;
    my.handle.state = 'running';
    try {
      const r = await fetch(`${BASE}/${encodeURIComponent(String(slug).replace(/[^a-z0-9-]/g, ''))}/manifest.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`I know of no vision called "${slug}".`);
      const manifest = await r.json();
      if (disposed || run !== my) return my.handle;
      my.slug = manifest.slug; my.handle.slug = manifest.slug; my.prompt = manifest.prompt || manifest.name;
      my.aspect = manifest.aspect || 16 / 9;
      await onManifest(manifest, false);
      if (my.handle.state !== 'arrived') my.resolveReady(null);
    } catch (err) { fail(String(err && err.message ? err.message : err)); }
    return my.handle;
  }
  function cleanup(o = {}) {
    const r = run; run = null;
    stopAmbient(1.2);
    if (!r) return;
    for (const rec of r.props) removeProp(rec);
    disposeVision(r.vision);
    r.handle.state = r.handle.state === 'arrived' || r.handle.state === 'running' || r.handle.state === 'queued' ? 'removed' : r.handle.state;
    try { r.resolveReady(null); } catch { /* resolved */ }
    S.cur = null;
    void o;
  }
  function home() {
    const had = !!run;
    const slug = run && run.slug;
    cleanup();
    const T = world.travel;
    let h = null;
    if (T && T.home && T.away) h = T.home();
    if (had) emit('blast:home', { slug });
    return h || { ready: Promise.resolve(null) };
  }

  // ------------------------------------------------------------------ cache listing
  async function refreshList() {
    try {
      const r = await fetch(`${BASE}/index.json`, { cache: 'no-cache' });
      const j = r.ok ? await r.json() : {};
      S.known = Object.entries(j).map(([slug, e]) => ({ slug, ...e })).sort((a, b) => String(b.created).localeCompare(String(a.created)));
    } catch { /* keep the old list */ }
    return S.known.slice();
  }
  function list() { const arr = S.known.slice(); arr.then = (res, rej) => refreshList().then(res, rej); refreshList(); return arr; }
  function inputs() {
    return new Promise((resolve) => {
      const id = `inp-${Date.now().toString(36)}`;
      const off = ctx.events.on('net:blast_inputs', (m) => { if (m.id !== id) return; off(); resolve(m.files || []); });
      if (!ctx.net || !ctx.net.send({ type: 'blast_inputs', id })) { off(); resolve([]); }
      setTimeout(() => { off(); resolve([]); }, 4000);
    });
  }

  ctx.on('net:blast_status', onStatus);
  ctx.on('net:blast_list', (m) => { if (Array.isArray(m.projects)) S.known = m.projects; });
  ctx.on('net:open', () => { if (run && !run.manifest && run.handle.state !== 'failed') ctx.net.send({ type: 'blast_get', id: run.id, slug: run.slug || undefined }); }); // the socket came back: catch up

  const api = {
    create, open, list, inputs, home, cleanup: () => cleanup(),
    get current() { return run && run.manifest ? { slug: run.manifest.slug, name: run.manifest.name, caption: run.manifest.caption, place: run.manifest.place && run.manifest.place.slug, objects: run.props.length, state: run.handle.state } : null; },
    get active() { return run ? run.handle : null; },
    refresh: refreshList,
  };
  ctx.provide('blast', api);
  refreshList();

  // hot reload while a blast is in flight (or standing): pick the thread up again
  if (S.cur && S.cur.id) {
    const cur = S.cur;
    run = newRun(cur.id, cur.prompt || '');
    run.slug = cur.slug;
    run.handle.state = 'running';
    if (cur.manifest && cur.phase === 'arrived') {
      // already standing in it: put everything back at its place, no ceremony
      const my = run;
      my.manifest = cur.manifest; my.handle.manifest = cur.manifest;
      my.arrivedPlace = !!(world.travel && world.travel.away && cur.manifest.place);
      my.frame = my.arrivedPlace ? placeFrame() : playerFrame();
      if (!my.arrivedPlace) my.frame.fn = (r) => clamp(r * 0.62, 1.8, 9);
      reseatAll(cur.manifest, my.frame, { settle: true });
      applySounds(cur.manifest);
      my.handle.state = 'arrived'; my.resolveReady(my.handle);
    } else { run.vision = makeVision({ aspect: 16 / 9 }); if (!ctx.net || !ctx.net.send({ type: 'blast_get', id: cur.id, slug: cur.slug || undefined })) fail('I lost the thread of the vision.'); }
  }

  // ------------------------------------------------------------------ per frame
  return {
    update(dt) {
      if (!run) return;
      const t = ctx.clock.t;
      if (run.vision) { updateVision(run.vision, dt); if (run.vision.want === 0 && run.vision.fade < 0.02) { disposeVision(run.vision); run.vision = null; } }
      // travel in progress: put the things where they belong the moment the iris has closed (the sky has changed under us)
      const th = run.travelHandle;
      if (th && !run.reseated && (th.state === 'opening' || th.state === 'arrived') && run.manifest) { run.reseated = true; faceForward(); reseatAll(run.manifest, placeFrame(), { settle: true }); }
      for (let i = run.props.length - 1; i >= 0; i--) {
        const rec = run.props[i];
        if (rec.state === 'gone') { run.props.splice(i, 1); continue; }
        if (rec.broken) continue;
        const a = rec.anim;
        if (a) { // flying out of the picture
          a.t += dt;
          const k = clamp(a.t / a.dur, 0, 1), e = ease(k);
          if (!a.pop) {
            _a.lerpVectors(a.from, a.to, e); _a.y += Math.sin(k * Math.PI) * a.arc;
            rec.body ? rec.body.position.copy(_a) : rec.holder.position.copy(_a);
            rec.holder.rotation.y += a.spin * dt * (1 - k);
          }
          const s = clamp(0.04 + e * 1.0, 0.04, 1);
          rec.inner.scale.setScalar(s); rec.inner.position.set(-rec.center.x * s, -rec.center.y * s, -rec.center.z * s);
          if (k >= 1) { rec.anim = null; rec.inner.scale.setScalar(1); rec.inner.position.set(-rec.center.x, -rec.center.y, -rec.center.z); if (rec.state === 'flying') releaseProp(rec); }
        } else if (rec.state === 'pinned' && t >= (rec.pinUntil ?? 0)) { rec.pinUntil = 0; releaseProp(rec); }
        if (rec.body && rec.body.removed) rec.body = null;
        // a body that fell out of the world: bring it back to where it belongs
        if (rec.body && rec.body.position.y < groundOf(rec.body.position.x, rec.body.position.z) - 6) { rec.body.position.copy(rec.lands); rec.body.position.y += 1; rec.body.velocity.set(0, 0, 0); }
      }
    },
    dispose() {
      disposed = true;
      // the run's props and vision live under ctx.root and go with it; the sounds are ours
      stopAmbient(0.3);
      for (const p of glbs.values()) p.then((g) => g.scene.traverse((o) => { if (o.isMesh) { o.geometry && o.geometry.dispose(); for (const m of [].concat(o.material)) { m && m.map && m.map.dispose(); m && m.dispose(); } } })).catch(() => {});
      glbs.clear(); buffers.clear();
    },
  };
}
