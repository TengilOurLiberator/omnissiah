// Thing: Pinata. A striped paper donkey hangs from a wooden frame. Hit it with anything (sword, spell, thrown crate): it swings, rattles
// and after ~8 good hits bursts into a shower of grabbable candy; eat a sweet (hold it to your face) to heal 3 hp. A fresh pinata is hung
// 25 s later. INERT until spawned: this file only registers a library entry (nothing is built at load).
// SPAWN: ctx.world.library.spawn(ctx, 'pinata', { x, z, yaw, scale })  -> handle (handle.remove() takes it away).  Summon list: Props.
export const meta = { name: 'Pinata', description: 'Thing: a hanging pinata that bursts into grabbable healing candy.' };

export default function (ctx) {
  const { THREE } = ctx;
  let undo = null;

  const COLORS = [0xff4f8b, 0xffd23f, 0x3fc1ff, 0x7bd957, 0xff8a3d, 0xb36bff];
  function mini() { // merges coloured primitives into ONE vertex-coloured mesh (1 draw call)
    const P = [], N = [], C = [], I = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), n3 = new THREE.Matrix3();
    const api = {
      add(g, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
        m.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz)); n3.getNormalMatrix(m); c.set(color);
        const p = g.attributes.position, nn = g.attributes.normal, base = P.length / 3;
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); P.push(v.x, v.y, v.z); v.fromBufferAttribute(nn, i).applyMatrix3(n3).normalize(); N.push(v.x, v.y, v.z); C.push(c.r, c.g, c.b); }
        if (g.index) for (let i = 0; i < g.index.count; i++) I.push(base + g.index.getX(i)); else for (let i = 0; i < p.count; i++) I.push(base + i);
        g.dispose(); return api;
      },
      box: (x, y, z, w, h, d, col, rx, ry, rz) => api.add(new THREE.BoxGeometry(1, 1, 1), col, x, y, z, w, h, d, rx, ry, rz),
      sph: (x, y, z, rx_, ry_, rz_, col) => api.add(new THREE.SphereGeometry(1, 10, 7), col, x, y, z, rx_, ry_, rz_),
      build() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I);
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }); mat.userData.own = true;
        return new THREE.Mesh(g, mat);
      },
    };
    return api;
  }

  function build(c, o) {
    const kit = c.world.kit, i = o.inst;
    if (!kit || !i) return null;
    const k = o.scale ?? 1;
    // ---- the frame
    const fr = mini();
    fr.box(-1.3 * k, 1.35 * k, 0, 0.16 * k, 2.7 * k, 0.16 * k, 0x7a5230).box(1.3 * k, 1.35 * k, 0, 0.16 * k, 2.7 * k, 0.16 * k, 0x7a5230).box(0, 2.7 * k, 0, 2.9 * k, 0.16 * k, 0.16 * k, 0x6a4524);
    fr.box(-1.3 * k, 0.05, 0.5 * k, 0.12 * k, 0.1, 1.2 * k, 0x6a4524, 0, 0, 0).box(1.3 * k, 0.05, 0.5 * k, 0.12 * k, 0.1, 1.2 * k, 0x6a4524);
    i.add(fr.build());
    // ---- the donkey (hangs from a pivot at the crossbar)
    const pivot = new THREE.Group(); pivot.position.set(0, 2.7 * k, 0); i.add(pivot);
    const pn = mini(), L = 1.0 * k;
    pn.box(0, -0.45 * k, 0, 0.02, 0.9 * k, 0.02, 0xcfc3a5); // rope
    for (let b = 0; b < 6; b++) pn.sph(0, -L - 0.05 * k, (b - 2.5) * 0.17 * k, 0.28 * k, 0.3 * k, 0.12 * k, COLORS[b]); // striped body
    pn.sph(0, -L + 0.14 * k, 0.55 * k, 0.17 * k, 0.17 * k, 0.17 * k, 0xffd23f).box(0, -L + 0.3 * k, 0.62 * k, 0.07 * k, 0.2 * k, 0.07 * k, 0xff4f8b, 0.3, 0, 0).box(0.1 * k, -L + 0.34 * k, 0.55 * k, 0.05 * k, 0.2 * k, 0.05 * k, 0xff4f8b).box(-0.1 * k, -L + 0.34 * k, 0.55 * k, 0.05 * k, 0.2 * k, 0.05 * k, 0xff4f8b);
    for (const z of [-0.35, 0.3]) for (const x of [-0.12, 0.12]) pn.box(x * k, -L - 0.35 * k, z * k, 0.07 * k, 0.28 * k, 0.07 * k, 0x3fc1ff);
    pn.box(0, -L - 0.05 * k, -0.52 * k, 0.04 * k, 0.04 * k, 0.22 * k, 0xffd23f);
    const pin = pn.build(); pivot.add(pin);
    const body = new THREE.Group(); i.add(body); // (damageable anchor, kept at the pinata's belly)
    let hits = 0, swing = 0, swingV = 0, state = 'hung', broke = 0, shake = 0, candy = [];
    const need = 8, hp = 8;
    const fx = i.fx({ count: 160, color: [0xffffff, 0xff4f8b], size: [0.12, 0.04], life: [0.6, 1.4], speed: [1.5, 5], gravity: 6, drag: 0.5 });
    const confetti = i.fx({ count: 240, additive: false, color: [0xffd23f, 0x3fc1ff], size: [0.1, 0.07], life: [1.2, 2.4], speed: [2, 6], gravity: 4, drag: 1.2 });
    const snd = i.snd();
    const world = new THREE.Vector3();
    const bellyAt = (out) => { pin.updateWorldMatrix(true, false); return out.set(0, -L - 0.05 * k, 0).applyMatrix4(pin.matrixWorld); };
    const d = i.dmg(body, { hp, radius: 0.55 * k, offsetY: 0, faction: 'neutral', onHit(e) {
      d.hp = Math.max(1, d.hp); if (state !== 'hung') return;
      hits++; swingV += (e.direction ? e.direction.x * 3 + e.direction.z * 3 : 3) * (Math.random() < 0.5 ? 1 : -1) * 0.6 + 2; shake = 0.4;
      bellyAt(world); fx.emit(world, 8); confetti.emit(world, 6);
      snd.noise({ dur: 0.08, filter: { type: 'bandpass', freq: 1800, q: 1 }, vol: 0.16, at: world }); snd.tone({ freq: 300 + hits * 40, freqEnd: 200, dur: 0.1, type: 'triangle', vol: 0.12, at: world });
      if (hits >= need) burst();
    } });
    function burst() {
      state = 'broken'; broke = 0; pin.visible = false; bellyAt(world);
      fx.emit(world, 90, undefined, 1.4); confetti.emit(world, 200, undefined, 1.2);
      kit.flash(c, world, { color: 0xffd23f, intensity: 40, distance: 10, duration: 0.3 });
      snd.noise({ dur: 0.35, filter: { type: 'bandpass', freq: 900, freqEnd: 300, q: 0.8 }, vol: 0.4, at: world }); snd.chord([523, 659, 784, 1046], { dur: 0.8, vol: 0.14, type: 'triangle', at: world });
      const n = c.world.perf ? c.world.perf.allow('bodies', 14) : 14;
      const geo = new THREE.SphereGeometry(0.06 * k, 7, 5);
      for (let b = 0; b < n; b++) {
        const col = COLORS[b % COLORS.length], mat = new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 }); mat.userData.own = true;
        const mesh = new THREE.Mesh(geo, mat); mesh.userData.shared = false;
        const bd = i.body(mesh, { radius: 0.06 * k, mass: 0.08, bounce: 0.55, friction: 0.5, grabbable: true, position: { x: world.x + (Math.random() - 0.5) * 0.3, y: world.y, z: world.z + (Math.random() - 0.5) * 0.3 } });
        if (!bd) { mat.dispose(); continue; }
        bd.velocity.set((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4);
        candy.push({ bd, mat, t: 0 });
      }
      i.cleanup(() => geo.dispose());
    }
    function rehang() {
      for (const cd of candy) { try { cd.bd.remove(); } catch (err) { /* gone */ } cd.mat.dispose(); }
      candy = []; hits = 0; d.hp = hp; state = 'hung'; pin.visible = true; swingV = 1.5;
    }
    i.tick((dt, t) => {
      // pendulum (a damped spring with a little drive from hits)
      swingV += -swing * 14 * dt - swingV * 0.9 * dt; swing += swingV * dt; swing = Math.max(-1.1, Math.min(1.1, swing));
      pivot.rotation.z = swing; pivot.rotation.x = Math.sin(t * 40) * shake * 0.08; shake = Math.max(0, shake - dt);
      if (state === 'broken') {
        broke += dt;
        const P = c.world.player, h = c.player.head;
        for (let b = candy.length - 1; b >= 0; b--) {
          const cd = candy[b]; cd.t += dt;
          const p = cd.bd.position;
          if (Math.hypot(p.x - h.x, p.y - h.y, p.z - h.z) < 0.28) { // eaten
            if (P && P.alive !== false) P.heal?.(3);
            fx.emit(p, 8); snd.tone({ freq: 900, freqEnd: 1500, dur: 0.12, type: 'sine', vol: 0.12, at: p });
            cd.bd.remove(); cd.mat.dispose(); candy.splice(b, 1);
          } else if (cd.t > 45) { cd.bd.remove(); cd.mat.dispose(); candy.splice(b, 1); }
        }
        if (broke > 25) rehang();
      }
    });
    return { dispose() { for (const cd of candy) cd.mat.dispose(); candy = []; } };
  }

  const register = () => {
    undo?.();
    undo = ctx.world.library?.define('pinata', {
      category: 'props', description: 'a hanging striped pinata on a wooden frame: hit it ~8 times (sword, spell, thrown crate) and it bursts into grabbable candy that heals 3 hp when you eat it; rehangs after 25 s',
      aliases: ['pinatas', 'pinata party', 'candy donkey', 'party pinata', 'candy pinata'], options: 'scale', size: 1, distance: 6, build,
    }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/library.js') register(); });
  ctx.onDispose(() => undo?.());
  return {};
}
