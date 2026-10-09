// Spell: Grappling Hook. A glowing claw on a rope flies from your hand to what you point at and sticks: ground, rocks, walls, trees,
// buildings (found with a physics raycast). The rope reels you in at up to 24 m/s (world.player.velocity, so walls still stop you)
// until you arrive, 2.5 s pass or you cast again; at a ledge you pop up and over. Hook an ENEMY instead and you yank it to you (it
// is staggered and bashed on arrival). Bosses over 300 hp are too heavy: they pull you instead. Out of reach (45 m) the claw whiffs.
export const meta = { name: 'Grappling Hook', description: 'Spell: a rope that reels you to where you point, or yanks enemies to you.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x9ff0d0, REACH = 45, BASH = { from: 'player', kind: 'blunt', force: 8, direction: undefined };
  const G = { mode: 0, t: 0, fly: 0, f: null, said: 0, p: new THREE.Vector3(), o: new THREE.Vector3() }; // mode: 0 idle, 1 claw flying, 2 pulling self, 3 pulling enemy, 4 whiff
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3(), rel = new THREE.Vector3(), nrm = new THREE.Vector3();
  const SEG = 14, pos = new Float32Array(SEG * 6), geo = new THREE.BufferGeometry(), pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa); geo.setDrawRange(0, 0);
  const lineM = new THREE.LineBasicMaterial({ color: 0xd8fff0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const rope = new THREE.LineSegments(geo, lineM); rope.frustumCulled = false; rope.visible = false; rope.userData.noShadow = true; ctx.root.add(rope);
  const clawM = new THREE.MeshBasicMaterial({ color: 0xeafff6 }), haloM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const claw = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), clawM); claw.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 6), haloM)); claw.scale.set(2, 2, 3.2); claw.visible = false; claw.userData.noShadow = true; ctx.root.add(claw);
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of [lineM, haloM]) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const sparks = kit.particles(ctx, { count: 200, color: [0xffffff, 0x70ffd0], size: [0.12, 0.02], life: [0.2, 0.6], speed: [1, 4], gravity: 3, drag: 0.8 });
  const rp = kit.particles(ctx, { count: 400, color: [0xffffff, 0x70ffd0], size: [0.14, 0.05], life: [0.08, 0.18], speed: 0.02, drag: 1 }); // makes the rope readable at a distance
  const streak = kit.particles(ctx, { count: 160, color: [0xe0fff4, 0x40d0a0], size: [0.1, 0.02], life: [0.2, 0.45], speed: 0.1, drag: 1 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });

  function findEnemy(origin, d) {
    const F = ctx.world.combat?.fighters;
    let best = null, bd = 1e9;
    if (F) for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (!f.alive || f.faction !== 'enemy') continue;
      const A = f.actor; rel.set(A.position.x - origin.x, A.position.y + (A.height ?? 1.5) * 0.5 - origin.y, A.position.z - origin.z);
      const along = rel.dot(d);
      if (along < 0.5 || along > REACH) continue;
      const perp = rel.lengthSq() - along * along, reach = 0.7 + along * 0.05;
      if (perp < reach * reach && perp < bd) { bd = perp; best = f; }
    }
    return best;
  }
  function stop(fx) {
    if (G.mode === 2 && fx) { const P = ctx.world.player; if (P && G.p.y - ctx.player.feet.y > 1.2) P.launch?.(dir.copy(G.p).sub(ctx.player.feet).setY(0).normalize().x * 2, 4.5, dir.z * 2); } // pop over the ledge
    G.mode = 0; claw.visible = false; rope.visible = false;
  }
  function cast({ origin, direction }) {
    if (ctx.clock.t - (G.last ?? -9) < 0.3) return; G.last = ctx.clock.t; // (rate 0: holding the trigger must not re-hook and cancel the pull)
    stop(false);
    G.o.copy(origin); G.f = findEnemy(origin, direction); G.t = 0; G.fly = 0;
    const PX = ctx.world.physics;
    if (G.f) { const A = G.f.actor; G.p.set(A.position.x, A.position.y + (A.height ?? 1.5) * 0.6, A.position.z); }
    else {
      let hit = null;
      if (PX && PX.ready) { const r = PX.raycast(origin, direction, REACH, { groups: 'world' }); if (r) { G.p.copy(r.point); nrm.copy(r.normal); hit = r.kind; } }
      if (!hit) { const aim = ctx.aimPoint(REACH); if (aim) { G.p.copy(aim); nrm.set(0, 1, 0); hit = 'ground'; } }
      if (!hit) { G.p.copy(origin).addScaledVector(direction, 12); G.mode = 4; } // nothing to hook
      else G.p.addScaledVector(nrm, 0.25);
    }
    if (G.mode !== 4) G.mode = 1;
    claw.visible = rope.visible = true; claw.position.copy(origin);
    if (!sfx('chain-rattle', origin)) snd.noise({ dur: 0.25, filter: { type: 'bandpass', freq: 2500, q: 2 }, vol: 0.2, at: origin });
    kit.haptic?.('right', 0.5, 40);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'grapple', name: 'Grappling Hook', color: COLOR, icon: '🪝', rate: 0, description: 'Reel yourself to where you point, or yank an enemy to you.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); });

  return {
    update(dt, t) {
      blendFix();
      if (G.mode === 0) return;
      const P = ctx.world.player, R = ctx.input.right, hand = R.connected ? R.position : ctx.player.head;
      G.t += dt;
      let tip = G.p;
      if (G.mode === 1 || G.mode === 4) { // the claw flies out in ~0.14 s
        G.fly = Math.min(1, G.fly + dt / (G.mode === 4 ? 0.2 : 0.14));
        claw.position.lerpVectors(G.o, G.p, G.fly); tip = claw.position;
        if (G.fly >= 1) {
          if (G.mode === 4) { stop(false); return; }
          G.t = 0; G.mode = G.f ? 3 : 2; sparks.emit(G.p, 14);
          kit.flash(ctx, G.p, { color: COLOR, intensity: 20, distance: 6, duration: 0.2 });
          if (!sfx('clang', G.p)) snd.tone({ freq: 1800, freqEnd: 900, dur: 0.15, type: 'triangle', vol: 0.15, at: G.p });
          kit.haptic?.('right', 0.8, 60);
        }
      }
      if (G.mode === 2 && P && P.velocity) { // reel yourself in
        const f = ctx.player.feet, h = ctx.player.head;
        dir.set(G.p.x - h.x, G.p.y - (f.y + 0.9), G.p.z - h.z); const d = dir.length();
        if (d < 1.8 || G.t > 2.5 || P.alive === false) { stop(true); sparks.emit(G.p, 10); return; }
        dir.multiplyScalar(1 / d); const sp = Math.min(24, 9 + d * 2);
        P.velocity.set(dir.x * sp, dir.y * sp + (dir.y > 0.15 ? 2 : 0), dir.z * sp); // (the player module applies it, collides, and carries it as momentum after)
        streak.emit(h, 2); if (Math.random() < dt * 20) streak.emit(tmp.copy(h).addScaledVector(dir, -0.6).setY(h.y - 0.4), 1);
        kit.haptic?.('right', 0.2, 30);
      } else if (G.mode === 3) { // yank the enemy
        const f = G.f, A = f && f.actor;
        if (!f || !f.alive || !A || A.removed) { stop(false); return; }
        const h = ctx.player.head, heavy = f.maxHp > 300;
        G.p.set(A.position.x, A.position.y + (A.height ?? 1.5) * 0.6, A.position.z);
        dir.set(h.x - A.position.x, 0, h.z - A.position.z); const d = dir.length();
        if (heavy && P && P.velocity) { dir.set(G.p.x - h.x, 0, G.p.z - h.z).normalize(); P.velocity.set(dir.x * 16, 0, dir.z * 16); if (d < 3 || G.t > 1.5) stop(false); }
        else {
          if (d < 1.9 || G.t > 2) { BASH.direction = dir.normalize().multiplyScalar(-1).setY(0.2); kit.hit(G.p, 1.4, 8, BASH); sparks.emit(G.p, 16); sfx('blunt-armor', G.p); stop(false); return; }
          dir.multiplyScalar(1 / d); const m = Math.min(d - 1.6, 17 * dt); A.position.x += dir.x * m; A.position.z += dir.z * m; A.kx = A.kz = 0; A.staggerT = Math.max(A.staggerT, 0.4); A.atkT = -1;
        }
        tip = G.p;
      }
      // the rope: a drooping curve from the hand to the claw
      const sag = G.mode === 1 || G.mode === 4 ? 0.5 * (1 - G.fly) : 0.04;
      let w = 0, px = hand.x, py = hand.y, pz = hand.z;
      for (let k = 1; k <= SEG; k++) {
        const u = k / SEG, x = hand.x + (tip.x - hand.x) * u, y = hand.y + (tip.y - hand.y) * u - Math.sin(Math.PI * u) * sag * (G.mode === 4 ? 2 : 1), z = hand.z + (tip.z - hand.z) * u;
        pos[w++] = px; pos[w++] = py; pos[w++] = pz; pos[w++] = x; pos[w++] = y; pos[w++] = z; px = x; py = y; pz = z;
      }
      geo.setDrawRange(0, w / 3); pa.needsUpdate = true;
      for (let k = 0; k < 10; k++) rp.emit(tmp.lerpVectors(hand, tip, Math.random()), 1);
      claw.position.copy(tip); claw.rotation.y = t * 8; claw.visible = true;
    },
  };
}
