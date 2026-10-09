// Spell: Bloom Brush (HOLD the trigger). Paint the ground with life: wherever your hand points, flowers pop up in a 1.3 m brush
// (stems that grow, blooms in random colours that spring open), with the odd toadstool among them, a drift of pollen and a soft
// chime that climbs as you paint. Up to 420 blooms live at once (the oldest wilt first) and each fades after 60 s. Standing among
// them heals you slowly (the denser the better). Pure play: no damage. In mixed reality it paints your real floor, small.
export const meta = { name: 'Bloom Brush', description: 'Spell (hold): paint flowers onto the ground; they heal you a little.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xff8ad8, MAX = 420, LIFE = 60;
  const B = { n: 0, acc: 0, on: 0, k: 0, scan: 0, near: 0, chime: 0, note: 0, dirty: false };
  const tmp = new THREE.Vector3(), o3 = new THREE.Object3D(), col = new THREE.Color(), dir = new THREE.Vector3(), a = new THREE.Vector3();
  const mr = () => (ctx.input.passthrough ? 0.4 : 1);

  const stemM = new THREE.MeshLambertMaterial({ color: 0x4ac03a, emissive: 0x1a5a14, flatShading: true }), bloomM = new THREE.MeshBasicMaterial({ color: 0xffffff }); // blooms are unlit so they glow above the grass at dusk
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.032, 1, 4, 1).translate(0, 0.5, 0), stemM, MAX), blooms = new THREE.InstancedMesh(new THREE.ConeGeometry(0.17, 0.2, 7, 1, true).rotateX(Math.PI), bloomM, MAX);
  const f = []; for (let i = 0; i < MAX; i++) f.push({ x: 0, z: 0, y: 0, h: 0, t: -1, yaw: 0, shroom: false }); // t < 0 = free
  for (let i = 0; i < MAX; i++) { o3.position.set(0, -50, 0); o3.scale.setScalar(0.0001); o3.updateMatrix(); stems.setMatrixAt(i, o3.matrix); blooms.setMatrixAt(i, o3.matrix); blooms.setColorAt(i, col.setHex(0xffffff)); }
  stems.frustumCulled = blooms.frustumCulled = false; stems.userData.noShadow = blooms.userData.noShadow = true; ctx.root.add(stems, blooms);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })); ring.visible = false; ring.userData.noShadow = true; ctx.root.add(ring);
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; const m = ring.material; if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; };
  const pollen = kit.particles(ctx, { count: 260, color: [0xfff8c0, 0xff90e0], size: [0.1, 0.02], life: [0.8, 1.8], speed: [0.1, 0.5], gravity: -0.5, drag: 0.7 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const PENT = [523, 587, 659, 784, 880, 1047];

  function plant(x, z) {
    let s = -1, oldest = 0;
    for (let i = 0; i < MAX; i++) { if (f[i].t < 0) { s = i; break; } if (f[i].t > f[oldest].t) oldest = i; }
    if (s < 0) s = oldest;
    const q = f[s]; q.x = x; q.z = z; q.y = ctx.groundAt(x, z); q.t = 0; q.yaw = Math.random() * 6.283; q.shroom = Math.random() < 0.08; q.h = q.shroom ? 0.4 + Math.random() * 0.2 : 0.6 + Math.random() * 0.5; // tall enough to stand above the meadow grass
    if (q.shroom) col.setHSL(0.02 + Math.random() * 0.04, 0.7, 0.5); else col.setHSL(Math.random(), 0.9, 0.58 + Math.random() * 0.12);
    blooms.setColorAt(s, col); if (blooms.instanceColor) blooms.instanceColor.needsUpdate = true;
    B.n = Math.min(MAX, B.n + 1);
  }
  function cast({ origin, direction, dt, first }) {
    const PA = ctx.world.player?.aim, k = mr();
    B.on = 0.12;
    if (PA && PA.valid) a.copy(PA.point); else { a.copy(origin).addScaledVector(direction, 5 * k); a.y = ctx.groundAt(a.x, a.z); }
    const h = ctx.player.head; dir.set(a.x - h.x, 0, a.z - h.z); const d = dir.length(), lim = ctx.input.passthrough ? 3 : 45; if (d > lim) { a.x = h.x + dir.x / d * lim; a.z = h.z + dir.z / d * lim; a.y = ctx.groundAt(a.x, a.z); }
    ring.visible = true; ring.position.set(a.x, a.y + 0.06, a.z); ring.scale.setScalar(1.3 * k);
    if (first) sfx('heal-chime', a);
    B.acc += dt * 16; const n = B.acc | 0; B.acc -= n;
    for (let i = 0; i < n; i++) { const ang = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 1.3 * k; plant(a.x + Math.cos(ang) * r, a.z + Math.sin(ang) * r); }
    if (Math.random() < dt * 14) pollen.emit(tmp.set(a.x + (Math.random() - 0.5) * 2 * k, a.y + 0.2, a.z + (Math.random() - 0.5) * 2 * k), 1);
    B.chime -= dt; if (B.chime <= 0) { B.chime = 0.22; snd.tone({ freq: PENT[B.note++ % PENT.length], dur: 0.35, vol: 0.05, type: 'sine', at: a }); kit.haptic?.('right', 0.15, 25); }
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'bloom-brush', name: 'Bloom Brush', color: COLOR, icon: '🌸', hold: true, description: 'Hold: paint flowers onto the ground. They heal you.', cast, onRelease() { ring.visible = false; } }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      B.on -= dt; if (B.on <= 0) ring.visible = false; else ring.material.opacity = 0.3 + 0.15 * Math.sin(t * 8);
      let live = 0, wrote = false;
      for (let i = 0; i < MAX; i++) {
        const q = f[i];
        if (q.t < 0) continue;
        q.t += dt; live++;
        if (q.t > 0.75 && q.t < LIFE - 3.2) continue; // settled: its matrices are already written (only growing and wilting blooms are recomputed)
        wrote = true;
        const grow = Math.min(1, q.t / 0.6), e = 1 + 1.70158 * Math.pow(grow - 1, 3) + 0.70158 * Math.pow(grow - 1, 2), wilt = Math.max(0, Math.min(1, (LIFE - q.t) / 3)); // springy pop; wilts at the end
        if (q.t > LIFE) { q.t = -1; o3.position.set(0, -50, 0); o3.scale.setScalar(0.0001); o3.updateMatrix(); stems.setMatrixAt(i, o3.matrix); blooms.setMatrixAt(i, o3.matrix); continue; }
        const sway = Math.sin(t * 1.5 + q.x * 2 + q.z) * 0.12, h = q.h * e * (q.shroom ? 0.6 : 1) * wilt;
        o3.position.set(q.x, q.y, q.z); o3.rotation.set(sway, q.yaw, 0); o3.scale.set(q.shroom ? 3 : 1, Math.max(0.001, h), q.shroom ? 3 : 1); o3.updateMatrix(); stems.setMatrixAt(i, o3.matrix);
        o3.position.set(q.x + Math.sin(sway) * -h, q.y + h * Math.cos(sway), q.z); o3.rotation.set(sway, q.yaw, 0); o3.scale.setScalar(Math.max(0.001, e * wilt * (q.shroom ? 1.5 : 1))); o3.updateMatrix(); blooms.setMatrixAt(i, o3.matrix);
      }
      stems.instanceMatrix.needsUpdate = blooms.instanceMatrix.needsUpdate = wrote;
      // standing among blooms mends you slowly
      B.scan -= dt;
      if (B.scan <= 0) { B.scan = 0.5; const fe = ctx.player.feet; let n = 0; for (let i = 0; i < MAX; i++) { const q = f[i]; if (q.t > 0.5 && Math.abs(q.x - fe.x) < 2 && Math.abs(q.z - fe.z) < 2) n++; } B.near = n; }
      if (B.near > 4) { const P = ctx.world.player; if (P && P.alive !== false && P.health < (P.maxHealth ?? 100)) { const hp = Math.min(1.5, B.near / 30) * dt; if (P.heal) P.heal(hp); else P.health += hp; if (Math.random() < dt * 2) pollen.emit(tmp.set(ctx.player.feet.x, ctx.player.feet.y + 0.3, ctx.player.feet.z), 1); } }
    },
  };
}
