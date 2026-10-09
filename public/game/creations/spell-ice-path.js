// Spell: Ice Path. Frost races out from under your feet along the way you face and freezes a 3-metre-wide, 16 m road of glassy ice
// (one slab every 0.04 s, popping up in sequence). Stand on it and you glide: it accelerates you along the road (gently, up to
// 8 m/s; the stick still steers and a jump still jumps). Enemies caught on it skate helplessly down the road and cannot attack while
// they slide; loose bodies slip along too. It melts after 25 seconds. Mixed reality: a 3 m rug.
export const meta = { name: 'Ice Path', description: 'Spell: a road of ice that makes you glide and enemies skate.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x9fe8ff, TILES = 16, LIFE = 25;
  const I = { on: false, t: 0, x: 0, z: 0, dx: 0, dz: -1, n: 0, ride: 0, tile: 1, wide: 3, len: 16, sfxT: 0 };
  const tmp = new THREE.Vector3(), o3 = new THREE.Object3D(), col = new THREE.Color();
  const mr = () => (ctx.input.passthrough ? 0.2 : 1);

  const slabM = new THREE.MeshLambertMaterial({ color: 0xbfeeff, emissive: 0x2a6ea8, transparent: true, opacity: 0.8, flatShading: true });
  const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.12, 1), slabM, TILES);
  slabs.frustumCulled = false; slabs.visible = false; slabs.userData.noShadow = true;
  for (let i = 0; i < TILES; i++) slabs.setColorAt(i, col.setHSL(0.54 + Math.random() * 0.04, 0.7, 0.8 + Math.random() * 0.12));
  ctx.root.add(slabs);
  const shine = kit.particles(ctx, { count: 360, color: [0xffffff, 0x70d0ff], size: [0.12, 0.02], life: [0.5, 1.2], speed: [0.1, 0.6], gravity: -0.4, drag: 0.8 });
  const chips = kit.particles(ctx, { count: 160, color: [0xffffff, 0xaee8ff], size: [0.1, 0.02], life: [0.3, 0.8], speed: [1.5, 4], gravity: 6, drag: 0.5 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });

  function cast({ direction }) {
    const k = mr(), f = ctx.player.feet;
    tmp.set(direction.x, 0, direction.z); if (tmp.lengthSq() < 1e-4) tmp.set(ctx.player.forward.x, 0, ctx.player.forward.z);
    tmp.normalize();
    I.on = true; I.t = 0; I.n = 0; I.dx = tmp.x; I.dz = tmp.z; I.tile = Math.max(0.25, k); I.len = TILES * I.tile; I.wide = 3 * Math.max(0.3, k);
    I.x = f.x - I.dx * 0.8 * I.tile; I.z = f.z - I.dz * 0.8 * I.tile; I.ride = 0; slabs.visible = true;
    tmp.set(f.x, f.y, f.z); shine.emit(tmp, 20, undefined, 1.4);
    if (!sfx('ice-cast', tmp)) snd.chord([1568, 2093, 2637], { dur: 0.5, vol: 0.14, stagger: 0.04, at: tmp });
    sfx('ice-crack', tmp); kit.haptic?.('right', 0.5, 60); kit.haptic?.('left', 0.4, 50);
  }
  const onIce = (x, z, out) => { // is (x, z) on a finished slab? -> along-distance
    const rx = x - I.x, rz = z - I.z, along = rx * I.dx + rz * I.dz, lat = Math.abs(rx * -I.dz + rz * I.dx);
    out.set(along, lat, 0);
    return along >= 0 && along < Math.min(I.n, TILES) * I.tile && lat < I.wide * 0.5;
  };

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'ice-path', name: 'Ice Path', color: COLOR, icon: '🧊', rate: 1.5, description: 'A road of ice: you glide, enemies skate.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      if (!I.on) return;
      I.t += dt;
      const melt = Math.max(0, Math.min(1, (LIFE - I.t) / 2.5)), want = Math.min(TILES, (I.t / 0.04) | 0);
      while (I.n < want) { // a new slab pops up
        const i = I.n++, c = (i + 0.5) * I.tile, x = I.x + I.dx * c, z = I.z + I.dz * c;
        tmp.set(x, ctx.groundAt(x, z) + 0.05, z); chips.emit(tmp, 3); if (i % 3 === 0) shine.emit(tmp, 2);
      }
      const animating = I.t < 1.2 || I.t > LIFE - 2.7; // only the slabs popping up and melting move; the finished road is static
      for (let i = 0; animating && i < TILES; i++) {
        const c = (i + 0.5) * I.tile, x = I.x + I.dx * c, z = I.z + I.dz * c, born = Math.min(1, Math.max(0, (I.t - i * 0.04) / 0.25)), e = 1 - Math.pow(1 - born, 3);
        const s = e * melt * (0.96 + 0.04 * Math.sin(t * 2 + i));
        o3.position.set(x, ctx.groundAt(x, z) + 0.04 + 0.04 * e, z); o3.rotation.set(0, Math.atan2(I.dx, I.dz), 0); o3.scale.set(I.wide * Math.max(0.01, s), Math.max(0.2, e), I.tile * 1.02 * Math.max(0.01, s)); o3.updateMatrix(); slabs.setMatrixAt(i, o3.matrix);
      }
      if (animating) slabs.instanceMatrix.needsUpdate = true;
      slabM.opacity = 0.8 * Math.max(0.3, melt);
      if (Math.random() < dt * 14) { tmp.set(I.x + I.dx * Math.random() * I.len + (Math.random() - 0.5) * I.wide, 0, I.z + I.dz * Math.random() * I.len); tmp.y = ctx.groundAt(tmp.x, tmp.z) + 0.15; shine.emit(tmp, 1); }
      const P = ctx.world.player, f = ctx.player.feet;
      if (P && P.velocity && P.grounded !== false && onIce(f.x, f.z, tmp)) { // glide
        I.ride = Math.min(1, I.ride + dt / 0.8);
        const v = P.velocity, sp = v.x * I.dx + v.z * I.dz;
        if (sp < 8) { const a = 30 * I.ride * dt; v.x += I.dx * a; v.z += I.dz * a; }
        if (Math.random() < dt * 25) shine.emit(tmp.set(f.x, f.y + 0.05, f.z), 1);
        I.sfxT -= dt; if (I.sfxT <= 0) { I.sfxT = 0.35; snd.noise({ dur: 0.4, filter: { type: 'highpass', freq: 3500, q: 0.6 }, vol: 0.06 * I.ride }); }
      } else I.ride = Math.max(0, I.ride - dt * 2);
      const F = ctx.world.combat?.fighters;
      if (F) for (let i = 0; i < F.length; i++) { // enemies skate and cannot act while they slide
        const f2 = F[i], a = f2.actor;
        if (!a || f2.faction === 'friendly' || a.dead || !onIce(a.position.x, a.position.z, tmp)) continue;
        a.kx += I.dx * 45 * dt; a.kz += I.dz * 45 * dt; a.staggerT = Math.max(a.staggerT, 0.2); a.atkT = -1;
        if (Math.random() < dt * 8) chips.emit(tmp.set(a.position.x, a.position.y + 0.1, a.position.z), 2);
      }
      const BD = ctx.world.spells?.bodies?.();
      if (BD) for (let i = 0; i < BD.length; i++) { const b = BD[i]; if (!b.removed && !b.held && b.invMass !== 0 && b.position.y < ctx.groundAt(b.position.x, b.position.z) + 0.8 && onIce(b.position.x, b.position.z, tmp)) { b.velocity.x += I.dx * 5 * dt; b.velocity.z += I.dz * 5 * dt; } }
      if (I.t >= LIFE) { I.on = false; slabs.visible = false; chips.emit(tmp.set(I.x + I.dx * I.len * 0.5, ctx.groundAt(I.x, I.z), I.z + I.dz * I.len * 0.5), 30, undefined, 2); }
    },
  };
}
