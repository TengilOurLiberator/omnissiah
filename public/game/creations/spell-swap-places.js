// Spell: Swap Places. Point at any fighter and you trade places with it in a flash of violet: you land where it stood, it lands where you
// were, dizzy for a second and facing the wrong way. Drag a brute away from your friends, get out of a pack, put a boss between you and
// its archers. Mixed reality never moves your living room, so there the target is yanked to arm's length in front of you instead.
export const meta = { name: 'Swap Places', description: 'Spell: trade places with the fighter you point at.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xb27cff, REACH = 40, DIZZY = 1.2;
  const tmp = new THREE.Vector3(), rel = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  let S = null, pt = null, ringT = [-1, -1];

  function build() { // everything heavy is created on the first cast, so an unused spell costs nothing
    const mats = [];
    const mk = (opacity) => { const m = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }); mats.push(m); return m; };
    const rings = [0, 1].map(() => { const r = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 36).rotateX(-Math.PI / 2), mk(0)); r.visible = false; r.userData.noShadow = r.userData.noOutline = r.userData.noCull = true; ctx.root.add(r); return r; });
    const link = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5), mk(0)); link.visible = false; link.userData.noShadow = link.userData.noOutline = link.userData.noCull = true; ctx.root.add(link);
    return { mats, rings, link, linkT: -1,
      smoke: kit.particles(ctx, { count: 160, color: [0xf0e0ff, 0x6a30c0], size: [0.5, 0.15], life: [0.4, 0.9], speed: [0.5, 2.5], gravity: -0.5, drag: 1.2, alpha: 0.7 }),
      sparks: kit.particles(ctx, { count: 160, color: [0xffffff, COLOR], size: [0.14, 0.02], life: [0.3, 0.8], speed: [1, 5], gravity: 1, drag: 1 }),
      snd: kit.sound(ctx) };
  }
  const blendFix = () => { // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
    if (!S || pt === ctx.input.passthrough) return; pt = ctx.input.passthrough;
    for (const m of S.mats) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; }
  };

  function pick(origin, dir) {
    const F = ctx.world.combat?.fighters;
    let best = null, bd = 1e9;
    if (F) for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (!f.alive || !f.actor) continue;
      const A = f.actor; rel.set(A.position.x - origin.x, A.position.y + (A.height ?? 1.5) * 0.5 - origin.y, A.position.z - origin.z);
      const along = rel.dot(dir);
      if (along < 0.4 || along > REACH) continue;
      const perp = rel.lengthSq() - along * along, reach = 0.9 + along * 0.07;
      if (perp < reach * reach && perp < bd) { bd = perp; best = f; }
    }
    return best;
  }
  function puff(i, x, z) {
    const y = ctx.groundAt(x, z);
    S.rings[i].position.set(x, y + 0.1, z); S.rings[i].visible = true; ringT[i] = 0;
    S.smoke.emit(tmp.set(x, y + 1, z), 22, undefined, 1); S.sparks.emit(tmp, 26);
    kit.flash(ctx, tmp.set(x, y + 1.2, z), { color: COLOR, intensity: 30, distance: 9, duration: 0.3 });
  }
  function cast({ origin, direction }) {
    S ??= build();
    const f = pick(origin, direction), P = ctx.world.player, feet = ctx.player.feet;
    if (!f) { S.snd.tone({ freq: 600, freqEnd: 300, dur: 0.18, type: 'triangle', vol: 0.08, at: origin }); S.smoke.emit(tmp.copy(origin).addScaledVector(direction, 1.2), 4, direction, 0.4); return; }
    const A = f.actor, mr = !!ctx.input.passthrough;
    a.set(A.position.x, A.position.y, A.position.z); b.set(feet.x, feet.y, feet.z);
    if (mr) { // arm's length in front of you, you stay put
      const h = Math.hypot(direction.x, direction.z) || 1; A.position.x = b.x + (direction.x / h) * 1.8; A.position.z = b.z + (direction.z / h) * 1.8;
    } else {
      A.position.x = b.x; A.position.z = b.z; A.kx = A.kz = 0;
      if (P?.teleport) P.teleport(a.x, a.z);
      if (a.y > ctx.groundAt(a.x, a.z) + 0.5) ctx.rig.position.y = a.y; // it stood on something high
    }
    A.kx = A.kz = 0; A.staggerT = Math.max(A.staggerT || 0, DIZZY); A.atkT = -1;
    A.faceTo?.({ x: A.position.x + direction.x * 5, z: A.position.z + direction.z * 5 }, 0.1);
    puff(0, a.x, a.z); puff(1, A.position.x, A.position.z);
    S.link.visible = true; S.linkT = 0; S.link.position.set(a.x, a.y + 1.2, a.z); S.link.lookAt(A.position.x, A.position.y + 1.2, A.position.z); S.link.scale.set(1, 1, Math.hypot(A.position.x - a.x, A.position.y - a.y, A.position.z - a.z) || 1);
    if (ctx.world.audio?.sfx('teleport', { at: a }) !== true) S.snd.tone({ freq: 1400, freqEnd: 150, dur: 0.35, type: 'sawtooth', vol: 0.1, at: a });
    S.snd.chord([392, 523, 784], { dur: 0.5, vol: 0.1, type: 'triangle', at: A.position });
    kit.haptic?.('right', 0.7, 70); kit.haptic?.('left', 0.5, 50);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'swap-places', name: 'Swap Places', category: 'control', color: COLOR, icon: '🔀', rate: 1.2, description: 'Trade places with the fighter you point at.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt) {
      if (!S) return;
      blendFix();
      for (let i = 0; i < 2; i++) {
        if (ringT[i] < 0) continue;
        ringT[i] += dt; const u = ringT[i] / 0.55, r = S.rings[i];
        if (u >= 1) { ringT[i] = -1; r.visible = false; } else { r.scale.setScalar(0.4 + u * 3.2); r.material.opacity = 0.8 * (1 - u); }
      }
      if (S.linkT >= 0) {
        S.linkT += dt; const u = S.linkT / 0.4;
        if (u >= 1) { S.linkT = -1; S.link.visible = false; } else S.link.material.opacity = 0.7 * (1 - u);
      }
    },
  };
}
