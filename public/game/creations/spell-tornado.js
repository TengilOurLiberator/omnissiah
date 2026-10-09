// Spell: Tornado. A howling funnel spins up where you point and wanders off along that heading for 9 seconds, curving as it goes.
// Its winds suck loose bodies, debris and ragdolls into a spiral and haul them skyward (a Rapier impulse aimed at a point that orbits
// the funnel), and every 0.7 s the core batters enemies with a shove strong enough to throw them. It never lifts you. One at a time.
// Mixed reality: a knee-high 1 m funnel.
export const meta = { name: 'Tornado', description: 'Spell: a wandering funnel that lifts bodies and flings enemies.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // (Math.hypot allocates in hot loops)
  const COLOR = 0xcfc4b0, LIFE = 9, RINGS = 22, FROM = { from: 'player', kind: 'blunt', force: 9, direction: undefined };
  const T = { on: false, t: 0, x: 0, z: 0, h: 0, tick: 0, k: 1, spin: 0, howl: 0 };
  const tmp = new THREE.Vector3(), q = new THREE.Vector3(), o3 = new THREE.Object3D(), tv = new THREE.Vector3();
  const mr = () => (ctx.input.passthrough ? 0.3 : 1);

  const ringM = new THREE.MeshBasicMaterial({ color: 0x8a7a66, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }); // dusty brown, normal blending (reads against a bright sky)
  const funnel = new THREE.InstancedMesh(new THREE.TorusGeometry(1, 0.17, 6, 24).rotateX(Math.PI / 2), ringM, RINGS);
  funnel.frustumCulled = false; funnel.visible = false; funnel.userData.noShadow = true; ctx.root.add(funnel);
  const blendFix = () => {}; // (normal-blended dust: nothing to switch for mixed reality)
  const dust = kit.particles(ctx, { count: 600, additive: false, color: [0xb09a7a, 0x6a5a48], alpha: 0.45, size: [0.4, 1.3], life: [0.7, 1.5], speed: [0.2, 1], gravity: -0.4, drag: 1.1 });
  const debris = kit.particles(ctx, { count: 300, additive: false, color: [0x5a4a38, 0x3c6a2a], size: [0.12, 0.06], life: [0.8, 1.6], speed: 0.1, gravity: 0, drag: 0.1 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const glow = kit.light(ctx, { color: 0xb8c0d8, intensity: 0, distance: 10 });

  function cast({ origin, direction }) {
    const k = mr(), aim = ctx.aimPoint(ctx.input.passthrough ? 3 : 35);
    if (aim) { T.x = aim.x; T.z = aim.z; } else { T.x = origin.x + direction.x * 8 * k; T.z = origin.z + direction.z * 8 * k; }
    const h = ctx.player.head; T.h = Math.atan2(T.x - h.x, T.z - h.z); T.on = true; T.t = 0; T.tick = 0.4; T.k = k; funnel.visible = true; T.howl = 0;
    tmp.set(T.x, ctx.groundAt(T.x, T.z), T.z); dust.emit(tmp, 40, undefined, 2);
    sfx('elemental-roar', tmp);
    kit.haptic?.('right', 0.5, 80); kit.haptic?.('left', 0.4, 60);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'tornado', name: 'Tornado', color: COLOR, icon: '🌪️', rate: 2, description: 'A wandering funnel that lifts bodies and flings enemies.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      if (!T.on) return;
      T.t += dt; T.spin += dt * 6;
      const k = T.k, life = Math.min(1, T.t / 0.8) * Math.min(1, (LIFE - T.t) / 1.2), P = ctx.world.physics;
      T.h += Math.sin(T.t * 0.7) * 0.45 * dt; // it meanders
      T.x += Math.sin(T.h) * 2.4 * k * dt; T.z += Math.cos(T.h) * 2.4 * k * dt;
      const gy = ctx.groundAt(T.x, T.z);
      for (let i = 0; i < RINGS; i++) {
        const u = i / (RINGS - 1), r = (0.5 + 2.4 * u * u + 0.4 * u) * k * life, y = gy + u * 9 * k * life;
        const ang = T.spin * (1.5 - u) + i, ca = Math.cos(ang) * r, sa = Math.sin(ang) * r, m = funnel.instanceMatrix.array, o = i * 16; // (matrix written in place: yaw + scale (r, 1, r))
        m[o] = ca; m[o + 1] = 0; m[o + 2] = -sa; m[o + 3] = 0; m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0; m[o + 8] = sa; m[o + 9] = 0; m[o + 10] = ca; m[o + 11] = 0;
        m[o + 12] = T.x + Math.sin(T.spin * 0.4 + u * 3) * 0.25 * k * u; m[o + 13] = y; m[o + 14] = T.z + Math.cos(T.spin * 0.4 + u * 3) * 0.25 * k * u; m[o + 15] = 1;
      }
      funnel.instanceMatrix.needsUpdate = true;
      // swirl of dust and flying debris around the funnel
      for (let n = 0; n < 8; n++) {
        const u = Math.random(), a = Math.random() * 6.283, r = (0.5 + 1.8 * u * u) * k * life;
        tmp.set(T.x + Math.cos(a) * r, gy + 0.2 + u * 6.5 * k * life, T.z + Math.sin(a) * r);
        (n < 2 ? debris : dust).emit(tmp, 1, q.set(-Math.sin(a) * 7 * k, 2.5 * (1 - u), Math.cos(a) * 7 * k));
      }
      glow.position.set(T.x, gy + 3 * k, T.z); glow.intensity = 3 * life;
      // winds: bodies, ragdoll parts and debris are pulled toward a point that orbits the core, and up
      const rr = 3.4 * k * life;
      if (P && P.ready && rr > 0.3) {
        const a = T.spin * 1.7;
        q.set(T.x + Math.cos(a) * 1.4 * k, gy + 1.2 * k, T.z + Math.sin(a) * 1.4 * k);
        T.odd = !T.odd; if (T.odd) P.explode(q, rr, -7.2 * dt * 60 * life, { lift: -2.2 }); // (every other frame, twice the push: halves the Rapier call cost)
      }
      const BD = ctx.world.spells?.bodies?.();
      if (BD) for (let i = 0; i < BD.length; i++) { // classic-sim bodies (and any the physics skipped)
        const b = BD[i];
        if (b.removed || b.held || b.invMass === 0 || (b.ph && P && P.ready)) continue;
        const dx = T.x - b.position.x, dz = T.z - b.position.z, d = hyp(dx, dz);
        if (d > rr || d < 0.01) continue;
        b.velocity.x += (dx / d * 6 - dz / d * 7) * dt; b.velocity.z += (dz / d * 6 + dx / d * 7) * dt; b.velocity.y += 16 * dt * (1 - d / rr);
      }
      T.tick -= dt;
      if (T.tick <= 0) {
        T.tick = 0.7; FROM.direction = tv.set(Math.cos(T.spin), 0.6, Math.sin(T.spin));
        kit.hit(tmp.set(T.x, gy + 1, T.z), 2.6 * k + 0.4, 5, FROM);
        kit.haptic?.('right', 0.2, 40);
      }
      T.howl -= dt; if (T.howl <= 0) { T.howl = 0.9; snd.noise({ dur: 1.1, filter: { type: 'bandpass', freq: 500 + 150 * Math.sin(t), q: 0.8 }, vol: 0.28 * life, at: tmp.set(T.x, gy + 1, T.z) }); }
      if (T.t >= LIFE) { T.on = false; funnel.visible = false; glow.intensity = 0; dust.emit(tmp.set(T.x, gy + 0.5, T.z), 30, undefined, 2); }
    },
  };
}
