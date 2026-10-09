// Spell: Meteor. Marks the ground where you point; a glowing ring contracts for a heartbeat, then a meteor tears down
// out of the sky and detonates. Telegraphed so enemies (and you) can see it coming. Pooled meteors, rings and shockwaves.
export const meta = { name: 'Meteor', description: 'Spell: call a meteor down on the spot you point at.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xff5a1a, POOL = 3, FALL = 1.15, RADIUS = 4.6, DAMAGE = 60, FROM = { from: 'player', kind: 'explosion', force: 34 };
  const tmp = new THREE.Vector3();

  const rockG = new THREE.IcosahedronGeometry(0.85, 1), haloG = new THREE.SphereGeometry(1.7, 12, 8);
  const rockM = new THREE.MeshLambertMaterial({ color: 0x4a2c1c, emissive: 0xff4a10, emissiveIntensity: 0.9, flatShading: true });
  const haloM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
  const ringG = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), discG = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  const mk = (a) => new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: a, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const meteors = [];
  for (let i = 0; i < POOL; i++) {
    const rock = new THREE.Mesh(rockG, rockM); rock.add(new THREE.Mesh(haloG, haloM)); rock.visible = false;
    const outer = new THREE.Mesh(ringG, mk(0.8)), inner = new THREE.Mesh(ringG, mk(0.9)), disc = new THREE.Mesh(discG, mk(0.12));
    for (const m of [rock, outer, inner, disc]) { m.visible = false; ctx.root.add(m); }
    meteors.push({ rock, outer, inner, disc, alive: false, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
  }
  const waves = [];
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(ringG, mk(0.8)); m.visible = false; ctx.root.add(m); waves.push({ m, t: -1 }); }
  const trail = kit.particles(ctx, { count: 400, color: [0xffd070, 0xff3000], size: [0.9, 0.1], life: [0.3, 0.8], speed: 0.4, drag: 1, gravity: -0.5 });
  const smoke = kit.particles(ctx, { count: 160, additive: false, color: [0x666666, 0x222222], alpha: 0.5, size: [0.6, 1.8], life: [0.8, 1.8], speed: [0.2, 1], gravity: -0.6, drag: 0.8 });
  const debris = kit.particles(ctx, { count: 200, color: [0xffe0a0, 0xff5010], size: [0.14, 0.03], life: [0.6, 1.5], speed: [5, 14], gravity: 12, drag: 0.3 });
  const snd = kit.sound(ctx);

  function cast({ origin, direction }) {
    const m = meteors.find((x) => !x.alive);
    if (!m) return;
    const aim = ctx.aimPoint(90);
    if (aim) m.to.copy(aim);
    else { m.to.copy(origin).addScaledVector(direction, 30); m.to.y = ctx.groundAt(m.to.x, m.to.z); }
    const side = Math.random() < 0.5 ? -1 : 1;
    m.from.set(m.to.x + 20 * side, m.to.y + 60, m.to.z - 14);
    m.alive = true; m.t = 0;
    for (const o of [m.outer, m.inner, m.disc]) { o.visible = true; o.position.set(m.to.x, m.to.y + 0.08, m.to.z); }
    m.outer.scale.setScalar(RADIUS); m.disc.scale.setScalar(RADIUS);
    snd.noise({ dur: FALL + 0.3, filter: { type: 'lowpass', freq: 160, freqEnd: 500, q: 1 }, vol: 0.5, at: m.to });
    snd.tone({ freq: 1500, freqEnd: 260, dur: FALL, type: 'sawtooth', vol: 0.07, at: m.to, delay: 0.15 });
    ctx.input.right.pulse?.(0.6, 80);
  }
  function impact(m) {
    const p = m.to;
    m.alive = false; m.rock.visible = m.outer.visible = m.inner.visible = m.disc.visible = false;
    kit.explosion(ctx, p, { color: COLOR, size: 4.6 });
    kit.hit(p, RADIUS, DAMAGE, FROM); // force 34: throws standing actors back, flings crates, debris and ragdolls
    const P0 = ctx.world.physics;
    if (P0 && P0.ready) P0.explode(p, RADIUS * 1.9, 16, { lift: 0.6 }); // the shock reaches further than the fireball
    tmp.set(p.x, p.y + 0.4, p.z);
    debris.emit(tmp, 50); smoke.emit(tmp, 14); trail.emit(tmp, 20);
    kit.flash(ctx, tmp, { color: 0xffb070, intensity: 120, distance: 30, duration: 0.5 });
    snd.tone({ freq: 70, freqEnd: 24, dur: 1.2, vol: 0.9, at: p });
    snd.noise({ dur: 1.4, filter: { type: 'lowpass', freq: 900, freqEnd: 60, q: 0.7 }, vol: 1, at: p });
    const w = waves.find((x) => x.t < 0) ?? waves[0]; w.t = 0; w.m.visible = true; w.m.position.set(p.x, p.y + 0.15, p.z);
    const d = Math.hypot(p.x - ctx.player.head.x, p.z - ctx.player.head.z);
    if (d < 30) { const s = Math.min(1, 1.3 - d / 25); kit.haptic?.('left', s, 160); kit.haptic?.('right', s, 160); }
    const P = ctx.world.player;
    if (P?.launch && d < 7 && d > 0.1) P.launch(((ctx.player.head.x - p.x) / d) * 5, 3.5, ((ctx.player.head.z - p.z) / d) * 5); // blast knocks you back
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'meteor', name: 'Meteor', color: COLOR, icon: '☄️', rate: 1.2, description: 'Marks the ground, then a meteor falls.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      for (let i = 0; i < POOL; i++) {
        const m = meteors[i];
        if (!m.alive) continue;
        m.t += dt;
        const u = Math.min(1, m.t / FALL), pulse = 0.75 + 0.25 * Math.sin(t * 20);
        m.inner.scale.setScalar(Math.max(0.1, RADIUS * (1 - u)));
        m.outer.material.opacity = 0.45 + 0.4 * pulse; m.disc.material.opacity = 0.06 + 0.2 * u;
        if (m.t > 0.2) {
          const e = u * u, r = m.rock;
          r.visible = true;
          r.position.lerpVectors(m.from, m.to, e); r.rotation.x += dt * 4; r.rotation.y += dt * 3;
          r.scale.setScalar(0.6 + 0.6 * u);
          trail.emit(r.position, 6); if (Math.random() < 0.6) smoke.emit(r.position, 1);
        }
        if (m.t >= FALL) impact(m);
      }
      for (let i = 0; i < waves.length; i++) {
        const w = waves[i];
        if (w.t < 0) continue;
        w.t += dt;
        const u = w.t / 0.55;
        if (u >= 1) { w.t = -1; w.m.visible = false; continue; }
        w.m.scale.setScalar(1 + u * 11); w.m.material.opacity = 0.8 * (1 - u);
      }
    },
  };
}
