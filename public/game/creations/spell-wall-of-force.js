// Spell: Wall of Force (HOLD the trigger, shape with BOTH hands). While you hold, a pale blue panel hangs 3.5 m ahead, as wide as the
// gap between your hands (the way a picture frame scales with your hands) and aligned with the line between them. Release to make it
// solid for 10 s: physics bodies, ragdolls and walkers cannot pass and hostile projectiles burst on it with a ripple (yours pass).
// Controller or mouse: hands are fixed at about 0.5 m apart so the wall is ~3 m. Tracked hands: raise both open palms facing out.
export const meta = { name: 'Wall of Force', description: 'Spell (hold, two hands): shape a barrier between your hands.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // (Math.hypot allocates in hot loops)
  const COLOR = 0x7fb8ff, LIFE = 10, H = 2.6, DIST = 3.5, MAXW = 2;
  const pv = { on: 0, x: 0, z: 0, yaw: 0, w: 3, gest: false };
  const tmp = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const walls = [];
  const mk = (o) => new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const mats = [];
  function panel() {
    const g = new THREE.Group(), fm = mk(0.14), em = new THREE.LineBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    mats.push(fm, em);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), fm), edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)), em);
    const grid = new THREE.LineSegments(gridG, em);
    g.add(plane, edge, grid); g.visible = false; g.traverse((m) => { m.userData.noShadow = true; }); ctx.root.add(g);
    return { g, plane, fm, em, grid };
  }
  const gl = []; for (let i = 1; i < 8; i++) gl.push(-0.5 + i / 8, 0, 0, -0.5 + i / 8, 1, 0); for (let i = 1; i < 5; i++) gl.push(-0.5, i / 5, 0, 0.5, i / 5, 0);
  const gridG = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
  const preview = panel();
  for (let i = 0; i < MAXW; i++) walls.push({ ...panel(), on: false, t: 0, flash: 0, x: 0, z: 0, yaw: 0, w: 3, obs: [], ph: null, y: 0 });
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of mats) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const sparks = kit.particles(ctx, { count: 200, color: [0xffffff, 0x70b0ff], size: [0.12, 0.02], life: [0.2, 0.6], speed: [1, 4], gravity: 2, drag: 1 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 10 });

  function shape(L, R) { // pose from the two hands (world positions)
    const h = ctx.player.head, k = ctx.input.passthrough ? 0.4 : 1;
    a.set(L.x, 0, L.z); b.set(R.x, 0, R.z); c.copy(b).sub(a);
    let span = c.length(); const mx = (L.x + R.x) / 2, mz = (L.z + R.z) / 2;
    let fx = mx - h.x, fz = mz - h.z; const fl = hyp(fx, fz);
    if (fl < 0.05) { fx = ctx.player.forward.x; fz = ctx.player.forward.z; } else { fx /= fl; fz /= fl; }
    if (span < 0.05) { c.set(-fz, 0, fx); span = 0.5; } else c.multiplyScalar(1 / span);
    const dist = Math.max(0.8, DIST * k), w = Math.min(9, Math.max(1.6, span * 6)) * Math.max(0.4, k);
    pv.x = h.x + fx * dist; pv.z = h.z + fz * dist; pv.w = w; pv.yaw = Math.atan2(c.x, c.z) - Math.PI / 2;
  }
  function pose(o, x, z, w, yaw, y) { o.g.position.set(x, y, z); o.g.rotation.y = yaw; o.g.scale.set(w, H * Math.max(0.4, ctx.input.passthrough ? 0.5 : 1), 1); }
  function cast() {
    pv.on = 0.12; pv.gest = false;
    const R = ctx.input.right, L = ctx.input.left;
    shape(L.connected ? L.position : ctx.player.head, R.position); // (the same call every frame while held: it follows your hands)
  }
  function commit() {
    pv.on = 0;
    const wl = walls.find((q) => !q.on) ?? walls.reduce((o, q) => (q.t > o.t ? q : o));
    close(wl);
    wl.on = true; wl.t = 0; wl.x = pv.x; wl.z = pv.z; wl.w = pv.w; wl.yaw = pv.yaw; wl.y = ctx.groundAt(pv.x, pv.z); wl.flash = 1; wl.g.visible = true;
    pose(wl, wl.x, wl.z, wl.w, wl.yaw, wl.y);
    const cs = Math.cos(wl.yaw), sn = Math.sin(wl.yaw), n = Math.min(8, Math.max(2, Math.ceil(wl.w / 1.1)));
    for (let i = 0; i < n; i++) { const o = (i / (n - 1) - 0.5) * (wl.w - 0.6); wl.obs.push(kit.obstacle(ctx, { position: new THREE.Vector3(wl.x + cs * o, 0, wl.z - sn * o), radius: 0.6 })); }
    const PX = ctx.world.physics;
    if (PX && PX.ready) wl.ph = PX.body(ctx, wl.g, { type: 'kinematic', shape: 'box', size: [1, H, 0.2], center: [0, H / 2, 0], group: 'world' }) ?? null;
    sparks.emit(tmp.set(wl.x, wl.y + 1.2, wl.z), 40, undefined, 1.5); kit.flash(ctx, tmp.set(wl.x, wl.y + 1.5, wl.z), { color: COLOR, intensity: 40, distance: 12, duration: 0.3 });
    if (!sfx('shield-hum', tmp)) snd.chord([262, 392, 523], { dur: 0.9, vol: 0.14, type: 'sine', stagger: 0.08, at: tmp });
    sfx('earth-wall', tmp); kit.haptic?.('left', 0.7, 80); kit.haptic?.('right', 0.7, 80);
  }
  function close(w) {
    for (const o of w.obs) o.remove(); w.obs.length = 0;
    if (w.ph) { w.ph.remove(); w.ph = null; }
    if (w.on) { sparks.emit(tmp.set(w.x, w.y + 1.2, w.z), 30, undefined, 1.5); }
    w.on = false; w.g.visible = false;
  }
  function onRelease() { if (!pv.gest) commit(); }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'wall-of-force', name: 'Wall of Force', color: COLOR, icon: '🛡️', hold: true, description: 'Hold, spread your hands: a barrier as wide as the gap.', cast, onRelease }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); for (const w of walls) close(w); });

  return {
    update(dt, t) {
      blendFix();
      const L = ctx.input.left, R = ctx.input.right, FL = L.fingers, FR = R.fingers;
      if (L.tracked && R.tracked && L.connected && R.connected && ctx.world.spells?.current()?.id === 'wall-of-force' && !ctx.world.weapons?.held?.right) { // both open palms out
        const f = ctx.player.forward, out = FL.gesture === 'open' && FR.gesture === 'open' && FL.palmNormal.dot(f) > 0.5 && FR.palmNormal.dot(f) > 0.5;
        if (out) { pv.gest = true; pv.on = 0.12; shape(FL.palm, FR.palm); } else if (pv.gest) { pv.gest = false; commit(); }
      }
      pv.on -= dt;
      const showing = pv.on > 0;
      preview.g.visible = showing;
      if (showing) { pose(preview, pv.x, pv.z, pv.w, pv.yaw, ctx.groundAt(pv.x, pv.z)); preview.fm.opacity = 0.08 + 0.05 * Math.sin(t * 8); preview.em.opacity = 0.6; }
      const PR = ctx.world.combat?.projectiles;
      let lit = null;
      for (let i = 0; i < MAXW; i++) {
        const w = walls[i];
        if (!w.on) continue;
        w.t += dt; w.flash = Math.max(0, w.flash - dt * 3);
        const life = Math.min(1, (LIFE - w.t) / 1.5), shim = 0.12 + 0.04 * Math.sin(t * 3 + i);
        w.fm.opacity = (shim + 0.4 * w.flash) * life; w.em.opacity = (0.7 + 0.3 * w.flash) * life * (life < 1 ? 0.5 + 0.5 * Math.sin(t * 30) : 1);
        const cs = Math.cos(w.yaw), sn = Math.sin(w.yaw);
        if (PR) for (let k = 0; k < PR.length; k++) { // hostile projectiles burst on the panel
          const p = PR[k];
          if (!p.on || p.from === 'friendly' || p.from === 'player') continue;
          const dx = p.x - w.x, dz = p.z - w.z, along = dx * cs - dz * sn, norm = dx * sn + dz * cs;
          if (Math.abs(along) < w.w / 2 && Math.abs(norm) < 0.45 && p.y > w.y - 0.2 && p.y < w.y + H) {
            tmp.set(p.x, p.y, p.z); if (p.kill) p.kill(); else p.on = false;
            sparks.emit(tmp, 16); w.flash = 1; kit.flash(ctx, tmp, { color: COLOR, intensity: 20, distance: 6, duration: 0.15 });
            if (!sfx('shield-block', tmp)) snd.tone({ freq: 1200, freqEnd: 400, dur: 0.2, type: 'triangle', vol: 0.15, at: tmp }); kit.haptic?.('left', 0.5, 40);
          }
        }
        if (Math.random() < dt * 12) sparks.emit(tmp.set(w.x + cs * (Math.random() - 0.5) * w.w, w.y + Math.random() * H, w.z - sn * (Math.random() - 0.5) * w.w), 1);
        lit = w;
        if (w.t >= LIFE) close(w);
      }
      if (lit) { glow.position.set(lit.x, lit.y + 1.4, lit.z); glow.intensity = 5; } else glow.intensity = 0;
    },
  };
}
