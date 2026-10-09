// Spell: Rune Trap. Draw a violet glyph on the ground where you point. It needs a second to ink itself in, then waits (up to four,
// 45 s each). When an enemy steps near, the runes flare for half a second (your cue to back off, and the warning to the victim) and
// the glyph detonates; traps close together set each other off in a chain. Tracked hands: press a flat palm toward the ground.
export const meta = { name: 'Rune Trap', description: 'Spell: a glyph that explodes when an enemy steps on it.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const HOSTILE = { hostileTo: 'friendly' };
  const COLOR = 0xb060ff, MAX = 4, ARM = 1, LIFE = 45, TRIG = 0.5, BLAST = { from: 'player', kind: 'explosion', force: 14 };
  const tmp = new THREE.Vector3(), tv = new THREE.Vector3(), up = new THREE.Vector3(0, 1.4, 0);
  const mr = () => (ctx.input.passthrough ? 0.35 : 1);

  const ringG = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2), discG = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), tickG = new THREE.PlaneGeometry(0.1, 0.22).rotateX(-Math.PI / 2);
  const star = new Float32Array(5 * 2 * 3); // a pentagram inscribed in the ring
  for (let i = 0; i < 5; i++) { const a = (i * 2 / 5) * 6.2832 + 1.5708, b = ((i + 1) * 2 / 5) * 6.2832 + 1.5708; star.set([Math.cos(a) * 0.84, 0.01, Math.sin(a) * 0.84, Math.cos(b) * 0.84, 0.01, Math.sin(b) * 0.84], i * 6); }
  const starG = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(star, 3));
  const mats = [];
  const gm = (o) => { const m = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }); mats.push(m); return m; };
  const traps = [];
  for (let i = 0; i < MAX; i++) {
    const g = new THREE.Group(), m1 = gm(), m2 = gm(), lm = new THREE.LineBasicMaterial({ color: 0xe0b0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); mats.push(lm);
    const ring = new THREE.Mesh(ringG, m1), disc = new THREE.Mesh(discG, m2), lines = new THREE.LineSegments(starG, lm);
    g.add(ring, disc, lines);
    for (let k = 0; k < 8; k++) { const tk = new THREE.Mesh(tickG, m1), a = k * 0.7854; tk.position.set(Math.cos(a) * 1.12, 0.01, Math.sin(a) * 1.12); tk.rotation.y = -a; g.add(tk); }
    g.visible = false; g.traverse((o) => { o.userData.noShadow = true; }); ctx.root.add(g);
    traps.push({ g, m1, m2, lm, on: false, t: 0, trig: -1, chk: 0, p: new THREE.Vector3(), ph: i });
  }
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of mats) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const motes = kit.particles(ctx, { count: 260, color: [0xf0d8ff, 0x9040ff], size: [0.12, 0.02], life: [0.5, 1], speed: [0.1, 0.5], gravity: -1.5, drag: 0.8 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const gesture = { cool: 0 };

  function place(x, z) {
    let tr = traps.find((q) => !q.on) ?? traps.reduce((o, q) => (q.t > o.t ? q : o)); // the oldest fizzles
    tr.on = true; tr.t = 0; tr.trig = -1; tr.chk = 0.3; tr.p.set(x, ctx.groundAt(x, z), z); tr.g.visible = true; tr.g.position.set(x, tr.p.y + 0.3, z); // (above the grass)
    motes.emit(tr.p, 14, undefined, 0.8);
    if (!sfx('shield-hum', tr.p)) snd.chord([220, 330, 440], { dur: 0.8, vol: 0.1, type: 'triangle', stagger: 0.08, at: tr.p });
    kit.haptic?.('right', 0.4, 50);
  }
  function cast({ origin, direction }) {
    const aim = ctx.aimPoint(ctx.input.passthrough ? 3 : 30);
    if (aim) place(aim.x, aim.z); else { tmp.copy(origin).addScaledVector(direction, 2.5 * mr()); place(tmp.x, tmp.z); }
  }
  function arm(tr, delay) { if (tr.on && tr.trig < 0 && tr.t > ARM) { tr.trig = delay; sfx('magic-impact', tr.p); snd.tone({ freq: 880, freqEnd: 1760, dur: TRIG, type: 'square', vol: 0.06, at: tr.p }); } }
  function detonate(tr) {
    const k = mr(), p = tr.p;
    tr.on = false; tr.g.visible = false;
    kit.explosion(ctx, p, { color: COLOR, size: 2.4 * Math.max(0.5, k) });
    kit.hit(tmp.set(p.x, p.y + 0.4, p.z), 4.2 * k, 38, BLAST);
    ctx.world.physics?.explode?.(p, 5.5 * k, 12, { lift: 0.5 });
    motes.emit(tmp.set(p.x, p.y + 0.3, p.z), 40, undefined, 2);
    kit.flash(ctx, tmp.set(p.x, p.y + 1, p.z), { color: 0xd0a0ff, intensity: 70, distance: 20, duration: 0.4 });
    kit.haptic?.('left', 0.7, 100); kit.haptic?.('right', 0.7, 100);
    for (const o of traps) if (o !== tr && o.on && o.p.distanceToSquared(p) < 36) arm(o, TRIG * 0.4 + 0.12 * (o.ph + 1)); // chain reaction
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'rune-trap', name: 'Rune Trap', color: COLOR, icon: '🔯', rate: 0.6, description: 'A glyph that detonates when an enemy steps on it.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      const R = ctx.input.right, F = R.fingers, k = mr();
      gesture.cool -= dt;
      if (R.tracked && R.connected && gesture.cool <= 0 && F.gesture === 'open' && F.palmNormal.y < -0.8 && F.palm.y < ctx.player.head.y - 0.55 && ctx.world.spells?.current()?.id === 'rune-trap' && !ctx.world.weapons?.held?.right) {
        gesture.cool = 1.2; place(F.palm.x, F.palm.z); // a flat palm pressed toward the ground inks a rune beneath it
      }
      for (let i = 0; i < MAX; i++) {
        const tr = traps[i];
        if (!tr.on) continue;
        tr.t += dt;
        const ink = Math.min(1, tr.t / ARM), fade = Math.min(1, (LIFE - tr.t) / 2), pulse = 0.5 + 0.5 * Math.sin(t * 3 + tr.ph);
        let a = (0.45 + 0.25 * pulse) * ink * fade;
        if (tr.trig >= 0) { // flaring: brighter, faster, rising
          tr.trig -= dt; const u = 1 - Math.max(0, tr.trig) / TRIG;
          a = 0.6 + 0.4 * Math.sin(t * 50); tr.g.position.y = tr.p.y + 0.3 + u * 0.25; tr.g.scale.setScalar(k * (1 + u * 0.25));
          if (Math.random() < dt * 40) motes.emit(tmp.set(tr.p.x + (Math.random() - 0.5) * 2 * k, tr.p.y + 0.1, tr.p.z + (Math.random() - 0.5) * 2 * k), 1);
          if (tr.trig <= 0) { detonate(tr); continue; }
        } else {
          tr.g.scale.setScalar(k * (0.5 + 0.5 * ink)); tr.g.rotation.y = t * 0.15 * (1 + tr.ph * 0.2);
          if (tr.t > ARM) { tr.chk -= dt; if (tr.chk <= 0) { tr.chk = 0.1; if (kit.nearestTarget(tv.set(tr.p.x, tr.p.y + 0.8, tr.p.z), 2.3 * k, HOSTILE)) arm(tr, TRIG); } }
          if (tr.t > LIFE) { tr.on = false; tr.g.visible = false; motes.emit(tr.p, 8); continue; }
        }
        tr.m1.opacity = a; tr.m2.opacity = a * 0.3; tr.lm.opacity = a * 1.4;
        if (tr.trig < 0 && Math.random() < dt * 8 * ink) motes.emit(tmp.set(tr.p.x + (Math.random() - 0.5) * 1.8 * k, tr.p.y + 0.3, tr.p.z + (Math.random() - 0.5) * 1.8 * k), 1, up);
        tr.g.rotation.y += dt * 0.0;
      }
    },
  };
}
