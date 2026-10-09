// Spell: Anti-Gravity Field. A soft violet-teal sphere 5 m wide opens where you point and weight drains out of it for 12 seconds:
// loose bodies and thrown weapons drift upward and tumble slowly, ragdolls, debris and rubble float, and YOU (if you walk in) get
// a moon-jump (gravity cut to a quarter). Nothing is held forever: gravity and drag are put back when things leave or it closes.
export const meta = { name: 'Anti-Gravity Field', description: 'Spell: a sphere where bodies float and you jump like on the moon.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x8f9bff, LIFE = 12;
  const A = { on: false, t: 0, r: 5, p: new THREE.Vector3(), bub: 0, pg: null, ours: 0 };
  const bs = [];
  for (let i = 0; i < 40; i++) bs.push({ b: null, g0: 9.8, d0: 0.05, ga: 0, da: 0 });
  const tmp = new THREE.Vector3(), tv = new THREE.Vector3(), up = new THREE.Vector3(0, 0.8, 0);
  const mr = () => (ctx.input.passthrough ? 0.32 : 1);

  const mk = (c, o, side) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side, fog: false });
  const mats = [mk(0x7a8cff, 0.1, THREE.FrontSide), mk(0x5affd8, 0.1, THREE.BackSide), mk(COLOR, 0.35, THREE.DoubleSide), mk(0xc0ffff, 0.12, THREE.FrontSide)];
  const [shellM, innerM, ringM, gridM] = mats;
  const sphereG = new THREE.SphereGeometry(1, 28, 18);
  const field = new THREE.Group(), shell = new THREE.Mesh(sphereG, shellM), inner = new THREE.Mesh(sphereG, innerM), grid = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), gridM);
  gridM.wireframe = true;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2), ringM);
  field.add(shell, inner, grid); field.visible = false; ring.visible = false; ctx.root.add(field, ring);
  for (const m of [shell, inner, grid, ring]) m.userData.noShadow = true;
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of mats) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const bubbles = kit.particles(ctx, { count: 320, color: [0xe0f4ff, 0x80b0ff], size: [0.16, 0.05], life: [1.2, 2.4], speed: [0.1, 0.4], gravity: -0.9, drag: 0.5 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 12 });

  const inside = (x, y, z, pad) => { const dx = x - A.p.x, dy = y - A.p.y, dz = z - A.p.z, r = A.r + pad; return dx * dx + dy * dy + dz * dz < r * r; };
  function releaseB(i) { const s = bs[i]; if (s.b && !s.b.removed) { if (s.b.gravity === s.ga) s.b.gravity = s.g0; if (s.b.drag === s.da) s.b.drag = s.d0; } s.b = null; }
  function releaseAll() { for (let i = 0; i < bs.length; i++) releaseB(i); setPlayerG(false); }
  function setPlayerG(on) { // moon-jump for the player while inside
    const P = ctx.world.player;
    if (!P) return;
    if (on && !A.ours) { A.pg = P.gravity; A.ours = P.gravity * 0.25; P.gravity = A.ours; }
    else if (!on && A.ours) { if (Math.abs(P.gravity - A.ours) < 1e-6) P.gravity = A.pg; A.ours = 0; }
  }
  function cast({ origin, direction }) {
    const k = mr(), aim = ctx.aimPoint(ctx.input.passthrough ? 3 : 40);
    releaseAll();
    if (aim) A.p.copy(aim); else A.p.copy(origin).addScaledVector(direction, 7 * k);
    A.r = 5 * k; A.p.y += A.r * 0.6; A.on = true; A.t = 0; field.visible = ring.visible = true;
    bubbles.emit(A.p, 30, up, 1.5); kit.flash(ctx, A.p, { color: COLOR, intensity: 25, distance: 12, duration: 0.4 });
    if (!sfx('levitate', A.p)) snd.tone({ freq: 200, freqEnd: 900, dur: 0.7, type: 'sine', vol: 0.15, at: A.p });
    sfx('shield-hum', A.p); kit.haptic?.('right', 0.4, 60);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'anti-gravity', name: 'Anti-Gravity Field', color: COLOR, icon: '🫧', rate: 1.5, description: 'A sphere where bodies float and you leap like on the moon.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); releaseAll(); });

  return {
    update(dt, t) {
      blendFix();
      if (!A.on) return;
      A.t += dt;
      const e = Math.min(1, A.t / 0.5), life = Math.min(1, (LIFE - A.t) / 1.2), r = A.r * (1 - Math.pow(1 - e, 3));
      field.position.copy(A.p); field.scale.setScalar(r); grid.rotation.y = t * 0.2; grid.rotation.x = t * 0.1;
      shellM.opacity = 0.1 * life; innerM.opacity = 0.1 * life; gridM.opacity = 0.12 * life;
      ring.position.set(A.p.x, ctx.groundAt(A.p.x, A.p.z) + 0.08, A.p.z); ring.scale.setScalar(Math.max(0.1, Math.sqrt(Math.max(0, r * r - (A.p.y - ring.position.y) ** 2)))); ringM.opacity = 0.35 * life * (0.8 + 0.2 * Math.sin(t * 3));
      glow.position.copy(A.p); glow.intensity = 5 * life;
      if (Math.random() < dt * 40 * life) { tmp.set(A.p.x + (Math.random() - 0.5) * r * 1.5, A.p.y - r * 0.5 + Math.random() * r * 0.6, A.p.z + (Math.random() - 0.5) * r * 1.5); bubbles.emit(tmp, 1, up); }
      // ragdolls, rubble and debris (Rapier): a small upward impulse each frame
      const P = ctx.world.physics;
      if (P && P.ready) P.explode(A.p, r, 0.12 * dt * 60 * life, { lift: 9 });
      // kit bodies and thrown weapons: gravity -> slightly negative, thick air
      for (let i = 0; i < bs.length; i++) { const s = bs[i]; if (s.b && (s.b.removed || !inside(s.b.position.x, s.b.position.y, s.b.position.z, 0.5))) releaseB(i); }
      const BD = ctx.world.spells?.bodies?.();
      if (BD) for (let j = 0; j < BD.length; j++) {
        const b = BD[j];
        if (b.removed || b.held || b.invMass === 0 || !inside(b.position.x, b.position.y, b.position.z, 0)) continue;
        let s = null;
        for (let i = 0; i < bs.length; i++) { if (bs[i].b === b) { s = bs[i]; break; } if (!s && !bs[i].b) s = bs[i]; }
        if (!s) continue;
        if (s.b !== b) { s.b = b; s.g0 = b.gravity; s.d0 = b.drag; s.ga = -0.2; s.da = Math.max(b.drag, 1.2); b.gravity = s.ga; b.drag = s.da; b.ph?.wake?.(); b.applyImpulse(0, 0.5 * b.mass, 0); }
      }
      // the player: feather-light while inside
      const f = ctx.player.feet, h = ctx.player.head;
      setPlayerG(inside(h.x, (f.y + h.y) / 2, h.z, 0));
      if (A.t >= LIFE) { A.on = false; field.visible = ring.visible = false; glow.intensity = 0; releaseAll(); bubbles.emit(A.p, 40, up, 2); if (!sfx('teleport', A.p)) snd.tone({ freq: 900, freqEnd: 200, dur: 0.3, vol: 0.12, at: A.p }); }
    },
  };
}
