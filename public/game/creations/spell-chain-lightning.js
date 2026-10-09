// Spell: chain lightning. A bolt leaps from the hand to the first thing it finds, then arcs onward from
// target to target (and crawls across the grass when it runs out of things to strike).
export const meta = { name: 'Chain Lightning', description: 'Spell: a bolt that arcs from target to target.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};

  const COLOR = 0x7fb0ff, ARCS = 16, STRANDS = 3, SEG = 10, LIFE = 0.38;
  const JUMPS = 7, RANGE = 9, REACH = 45, DAMAGE = 12;

  // ---- one LineSegments holds every arc ----
  const VERTS = ARCS * STRANDS * SEG * 2;
  const pos = new Float32Array(VERTS * 3), col = new Float32Array(VERTS * 3);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3), colAttr = new THREE.BufferAttribute(col, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage); colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  geo.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  lines.frustumCulled = false;
  ctx.root.add(lines);

  const arcs = [];
  for (let i = 0; i < ARCS; i++) arcs.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), life: 0 });

  const sparks = kit.particles(ctx, { count: 400, color: [0xf0f8ff, 0x3a5cff], size: [0.14, 0.02], life: [0.15, 0.5], speed: [1, 4.5], gravity: 5, drag: 2 });
  const glowFx = kit.particles(ctx, { count: 60, color: [0xcfe4ff, 0x4060ff], size: [0.9, 0.2], life: [0.12, 0.25], speed: 0.1, alpha: 0.6 });
  const snd = kit.sound(ctx);

  // ---- chain state (one live chain; a new cast restarts it) ----
  const chain = { active: false, at: new THREE.Vector3(), left: 0, timer: 0, n: 0, wild: false };
  const visited = new Array(JUMPS + 2).fill(null);
  let visitedN = 0;
  const probe = new THREE.Vector3(), c = new THREE.Vector3(), bestPos = new THREE.Vector3(), tmp = new THREE.Vector3();
  let best = null, bestD = 0;

  const centerOf = (t, out) => {
    if (typeof t.center === 'function') t.center(out);
    else if (t.object?.getWorldPosition) t.object.getWorldPosition(out);
    else out.copy(probe);
    return out;
  };
  const seen = (t) => { for (let i = 0; i < visitedN; i++) if (visited[i] === t) return true; return false; };
  const consider = (t, from) => {
    if (!t || t.alive === false || seen(t)) return;
    centerOf(t, c);
    const d = c.distanceToSquared(from);
    if (d < bestD) { best = t; bestD = d; bestPos.copy(c); }
  };
  function findNext(from) {
    best = null; bestD = RANGE * RANGE;
    consider(kit.nearestTarget(from, RANGE), from);
    for (let r = 2.5; r < RANGE; r += 2.5) {
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4 + r;
        probe.set(from.x + Math.cos(a) * r, from.y, from.z + Math.sin(a) * r);
        consider(kit.nearestTarget(probe, 3), from);
      }
    }
    return best;
  }

  function addArc(a, b) {
    let arc = arcs[0];
    for (let i = 0; i < ARCS; i++) { if (arcs[i].life <= 0) { arc = arcs[i]; break; } if (arcs[i].life < arc.life) arc = arcs[i]; }
    arc.a.copy(a); arc.b.copy(b); arc.life = LIFE;
    const len = a.distanceTo(b), n = Math.min(14, 3 + (len | 0));
    for (let i = 0; i < n; i++) sparks.emit(tmp.lerpVectors(a, b, Math.random()), 1, undefined, 0.5);
    dirty = 0;
  }

  function strike(point, power, step) {
    sparks.emit(point, 22);
    glowFx.emit(point, 3);
    kit.hit(point, 1.1, power, { kind: 'shock' });
    kit.flash(ctx, point, { color: COLOR, intensity: 30, distance: 10, duration: 0.14 });
    const f = 900 + step * 220 + Math.random() * 200;
    snd.noise({ dur: 0.12, filter: { type: 'highpass', freq: 2200, q: 0.8 }, vol: 0.3, at: point });
    snd.tone({ freq: f, freqEnd: f * 0.25, dur: 0.14, type: 'sawtooth', vol: 0.09, at: point });
  }

  function cast({ origin, direction }) {
    visitedN = 0;
    let target = null;
    const end = chain.at;
    end.copy(origin).addScaledVector(direction, REACH);
    for (let d = 1.4; d < REACH; d += 0.6) {
      probe.copy(origin).addScaledVector(direction, d);
      const g = ctx.groundAt(probe.x, probe.z);
      if (probe.y <= g + 0.05) { end.set(probe.x, g + 0.05, probe.z); break; }
      const t = kit.nearestTarget(probe, 0.9);
      if (t && t.alive !== false) { target = t; centerOf(t, end); break; }
    }
    if (target) visited[visitedN++] = target;
    addArc(origin, end);
    sparks.emit(origin, 12);
    strike(end, DAMAGE, 0);
    snd.noise({ dur: 0.9, filter: { type: 'lowpass', freq: 500, freqEnd: 70, q: 0.7 }, vol: 0.4, at: origin });
    snd.tone({ freq: 140, freqEnd: 45, dur: 0.5, type: 'sawtooth', vol: 0.1, at: origin });
    ctx.world.oracle?.pulse?.(0.5);
    chain.active = true; chain.left = JUMPS; chain.timer = 0.07; chain.n = 0; chain.wild = false;
  }

  function jump() {
    const from = chain.at;
    const t = findNext(from);
    chain.n++;
    if (t) {
      if (visitedN < visited.length) visited[visitedN++] = t;
      addArc(from, bestPos);
      from.copy(bestPos);
    } else {
      // nothing left to strike: crawl across the grass for a few forks, if we are near the ground
      if (from.y - ctx.groundAt(from.x, from.z) > 3) { chain.active = false; return; }
      if (!chain.wild) { chain.wild = true; chain.left = Math.min(chain.left, 4); }
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 2.5;
      probe.set(from.x + Math.cos(a) * r, 0, from.z + Math.sin(a) * r);
      probe.y = ctx.groundAt(probe.x, probe.z) + 0.05;
      addArc(from, probe);
      from.copy(probe);
    }
    strike(from, DAMAGE * Math.pow(0.82, chain.n), chain.n);
    if (--chain.left <= 0) chain.active = false;
  }

  // ---- jagged geometry, rebuilt ~25 times a second while anything is alive ----
  let dirty = 0, shown = false;
  function rebuild() {
    let w = 0, any = false;
    for (let i = 0; i < ARCS; i++) {
      const arc = arcs[i];
      if (arc.life <= 0) continue;
      any = true;
      const a = arc.a, b = arc.b, f = Math.min(1, arc.life / LIFE * 1.4);
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      for (let s = 0; s < STRANDS; s++) {
        const amp = Math.min(0.7, len * (s === 0 ? 0.05 : 0.12));
        const cr = (s === 0 ? 1 : 0.4) * f, cg = (s === 0 ? 1 : 0.6) * f, cb = f;
        let px = a.x, py = a.y, pz = a.z;
        for (let k = 1; k <= SEG; k++) {
          const u = k / SEG, env = Math.sin(Math.PI * u) * amp * 2;
          const x = a.x + dx * u + (Math.random() - 0.5) * env;
          const y = a.y + dy * u + (Math.random() - 0.5) * env;
          const z = a.z + dz * u + (Math.random() - 0.5) * env;
          pos[w] = px; pos[w + 1] = py; pos[w + 2] = pz; pos[w + 3] = x; pos[w + 4] = y; pos[w + 5] = z;
          col[w] = cr; col[w + 1] = cg; col[w + 2] = cb; col[w + 3] = cr; col[w + 4] = cg; col[w + 5] = cb;
          w += 6; px = x; py = y; pz = z;
        }
      }
    }
    geo.setDrawRange(0, w / 3);
    posAttr.needsUpdate = true; colAttr.needsUpdate = true;
    shown = any;
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'chain-lightning', name: 'Chain Lightning', color: COLOR, icon: '⚡', description: 'A shock bolt that arcs from target to target, then crawls over the grass.', cast }) ?? null;
    if (off && !ctx.state.selected) { ctx.state.selected = true; ctx.world.spells?.select?.('chain-lightning'); }
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt) {
      if (chain.active) {
        chain.timer -= dt;
        if (chain.timer <= 0) { chain.timer = 0.07; jump(); }
      }
      let live = false;
      for (let i = 0; i < ARCS; i++) if (arcs[i].life > 0) { arcs[i].life -= dt; live = true; }
      if (!live && !shown) return;
      dirty -= dt;
      if (dirty <= 0 || !live) { dirty = 0.04; rebuild(); }
    },
  };
}
