// Spell: Blink. Point at the ground and snap there: a bright flash, you dissolve into sparks and reform at the destination.
// Uses world.player.teleport(x, z); with physics a wall/house/gate in the way stops the leap short (raycast at chest height). A flash plane parented to the camera sells the jump (removed on dispose).
export const meta = { name: 'Blink', description: 'Spell: teleport to the spot you point at.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x7fe8ff, MAX = 45;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), tmp = new THREE.Vector3();

  const ringG = new THREE.RingGeometry(0.8, 1, 36).rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.visible = false; ctx.root.add(m); rings.push({ m, t: -1 });
  }
  // full-screen flash: a big plane just in front of the eyes, drawn over everything
  const flashM = new THREE.MeshBasicMaterial({ color: 0xcff6ff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
  const flashPlane = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), flashM);
  flashPlane.position.set(0, 0, -0.3); flashPlane.renderOrder = 100; flashPlane.frustumCulled = false;
  ctx.camera.add(flashPlane);
  ctx.onDispose(() => { flashPlane.removeFromParent(); flashPlane.geometry.dispose(); flashM.dispose(); });
  let flash = 0, ringI = 0;

  const dissolve = kit.particles(ctx, { count: 400, color: [0xffffff, 0x3ad0ff], size: [0.16, 0.02], life: [0.3, 0.9], speed: [0.5, 3.5], gravity: -1.2, drag: 1.2, spread: 0.35 });
  const streak = kit.particles(ctx, { count: 200, color: [0xe8fdff, 0x40a0ff], size: [0.12, 0.02], life: [0.2, 0.6], speed: 0.3, drag: 1 });
  const snd = kit.sound(ctx);

  function ring(p) { const r = rings[ringI++ % 2]; r.t = 0; r.m.visible = true; r.m.position.set(p.x, p.y + 0.05, p.z); }
  function cast({ origin, direction }) {
    const P = ctx.world.player;
    if (!P || !P.teleport) { ctx.hud?.show('Blink needs the player module', 2); return; }
    const aim = ctx.aimPoint(MAX);
    if (aim) b.copy(aim);
    else { // pointing at the sky: leap forward along the ground
      const f = ctx.player.forward, h = Math.hypot(f.x, f.z) || 1;
      b.set(ctx.player.head.x + (f.x / h) * 12, 0, ctx.player.head.z + (f.z / h) * 12); b.y = ctx.groundAt(b.x, b.z);
    }
    a.copy(ctx.player.feet);
    const PX = ctx.world.physics;
    if (PX && PX.ready) { // walls, houses and gates stop the leap: land just short of the first solid thing on the way (chest height)
      const hd = ctx.player.head;
      tmp.set(b.x - hd.x, 0, b.z - hd.z); const len = tmp.length();
      if (len > 0.5) {
        tmp.multiplyScalar(1 / len);
        const hit = PX.raycast({ x: hd.x, y: a.y + 1.0, z: hd.z }, tmp, len, { groups: 'world' });
        if (hit && hit.kind === 'static') { const k = Math.max(0, hit.distance - 0.7); b.x = hd.x + tmp.x * k; b.z = hd.z + tmp.z * k; b.y = ctx.groundAt(b.x, b.z); }
      }
    }
    dissolve.emit(tmp.set(a.x, a.y + 1, a.z), 60); dissolve.emit(tmp.set(a.x, a.y + 0.3, a.z), 30);
    const n = Math.min(60, 8 + a.distanceTo(b) * 2 | 0);
    for (let i = 0; i < n; i++) streak.emit(tmp.lerpVectors(a, b, i / n).setY(a.y + 1.1 + (b.y - a.y) * (i / n)), 1);
    ring(a);
    snd.tone({ freq: 1500, freqEnd: 120, dur: 0.22, type: 'sawtooth', vol: 0.12, at: a }); snd.noise({ dur: 0.25, filter: { type: 'bandpass', freq: 3000, freqEnd: 400, q: 1 }, vol: 0.3, at: a });
    P.teleport(b.x, b.z);
    ring(b);
    dissolve.emit(tmp.set(b.x, b.y + 1, b.z), 70, undefined, 1.3);
    kit.flash(ctx, tmp.set(b.x, b.y + 1.2, b.z), { color: COLOR, intensity: 50, distance: 14, duration: 0.3 });
    snd.tone({ freq: 200, freqEnd: 1800, dur: 0.28, type: 'sine', vol: 0.18, at: b }); snd.chord([784, 1175, 1568], { dur: 0.5, vol: 0.12, stagger: 0.04, at: b });
    flash = 1;
    kit.haptic?.('left', 0.7, 60); kit.haptic?.('right', 0.7, 60);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'blink', name: 'Blink', color: COLOR, icon: '✨', rate: 0.5, description: 'Teleport to where you point.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt) {
      flash = Math.max(0, flash - dt * 4.5);
      flashM.opacity = flash * 0.75; flashPlane.visible = flash > 0.001;
      for (let i = 0; i < 2; i++) {
        const r = rings[i];
        if (r.t < 0) continue;
        r.t += dt;
        const u = r.t / 0.45;
        if (u >= 1) { r.t = -1; r.m.visible = false; continue; }
        r.m.scale.setScalar(0.4 + u * 3); r.m.material.opacity = 0.9 * (1 - u);
      }
    },
  };
}
