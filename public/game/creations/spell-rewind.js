// Spell: Rewind. The module quietly remembers where you stood (and how healthy you were) for the last 6 seconds. Cast it and time
// runs backwards for YOU: a trail of cyan afterimages retraces your steps, a clock ring unwinds, and you reappear where you were 5
// seconds ago with at least the health you had then. A panic button that rewards remembering where you were safe. Mixed reality:
// only the health part (your living room is not rewound). Needs 1.5 s of history; the memory restarts after each rewind.
export const meta = { name: 'Rewind', description: 'Spell: return to where you stood 5 seconds ago, with the health you had.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x9fe8d8, N = 64, HZ = 10, BACK = 5;
  const H = { x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), hp: new Float32Array(N), n: 0, i: 0, acc: 0, anim: -1 };
  const tmp = new THREE.Vector3(), o3 = new THREE.Object3D(), from = new THREE.Vector3(), to = new THREE.Vector3();
  const ghosts = 8;

  const mk = (o, side) => new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending, side, fog: false });
  const gM = mk(0.45, THREE.FrontSide), ringM = mk(0.7, THREE.DoubleSide), flashM = new THREE.MeshBasicMaterial({ color: 0xd8fff4, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
  const mats = [gM, ringM];
  const ghost = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.22, 1.1, 3, 8).translate(0, 0.8, 0), gM, ghosts);
  ghost.frustumCulled = false; ghost.visible = false; ghost.userData.noShadow = true;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), ringM); ring.visible = false; ring.userData.noShadow = true;
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 1).translate(0, 0, -0.5), ringM); hand.visible = false; hand.userData.noShadow = true;
  ctx.root.add(ghost, ring, hand);
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), flashM); flash.position.set(0, 0, -0.3); flash.renderOrder = 100; flash.frustumCulled = false; ctx.camera.add(flash);
  ctx.onDispose(() => { flash.removeFromParent(); flash.geometry.dispose(); flashM.dispose(); });
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of mats) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const motes = kit.particles(ctx, { count: 300, color: [0xffffff, 0x60e0c0], size: [0.14, 0.02], life: [0.4, 1], speed: [0.2, 1.2], gravity: -0.5, drag: 0.8 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });

  const at = (k) => (H.i - 1 - k + N * 4) % N; // k samples ago
  function cast() {
    const P = ctx.world.player, f = ctx.player.feet;
    if (H.n < HZ * 1.5) { ctx.hud?.show('Not enough history yet', 1.2); return; }
    const k = Math.min(H.n - 1, BACK * HZ), s = at(k);
    from.set(f.x, f.y, f.z); to.set(H.x[s], H.y[s], H.z[s]);
    if (ctx.input.passthrough) to.copy(from); // never move a living room
    for (let g = 0; g < ghosts; g++) { const q = at(Math.round((k * (g + 1)) / ghosts)); o3.position.set(H.x[q], H.y[q], H.z[q]); o3.scale.setScalar(0.8 + 0.2 * Math.sin(g)); o3.rotation.set(0, g, 0); o3.updateMatrix(); ghost.setMatrixAt(g, o3.matrix); }
    ghost.instanceMatrix.needsUpdate = true; ghost.visible = true; ring.visible = hand.visible = true; H.anim = 0;
    motes.emit(tmp.set(from.x, from.y + 1, from.z), 36, undefined, 1.6);
    if (P && P.teleport && !ctx.input.passthrough) { P.teleport(to.x, to.z); if (to.y > ctx.groundAt(to.x, to.z) + 0.5) ctx.rig.position.y = to.y; }
    if (P && typeof P.health === 'number' && H.hp[s] > P.health) P.health = Math.min(P.maxHealth ?? 100, H.hp[s]); // you were healthier then
    motes.emit(tmp.set(to.x, to.y + 1, to.z), 40, undefined, 1.8);
    kit.flash(ctx, tmp.set(to.x, to.y + 1.2, to.z), { color: COLOR, intensity: 50, distance: 12, duration: 0.4 });
    flashM.opacity = 0.7;
    if (!sfx('teleport', to)) snd.tone({ freq: 1500, freqEnd: 100, dur: 0.4, type: 'sawtooth', vol: 0.12 });
    sfx('heartbeat', to); snd.tone({ freq: 220, freqEnd: 880, dur: 0.5, type: 'triangle', vol: 0.1, at: to, delay: 0.1 });
    kit.haptic?.('left', 0.7, 80); kit.haptic?.('right', 0.7, 80);
    H.n = 0; // start a new timeline
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'rewind', name: 'Rewind', color: COLOR, icon: '⏪', rate: 4, description: 'Return to where you stood 5 seconds ago.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      const f = ctx.player.feet, P = ctx.world.player;
      H.acc += dt;
      if (H.acc >= 1 / HZ) { H.acc -= 1 / HZ; if (H.acc > 1 / HZ) H.acc = 0; const i = H.i; H.x[i] = f.x; H.y[i] = f.y; H.z[i] = f.z; H.hp[i] = P && typeof P.health === 'number' ? P.health : 100; H.i = (i + 1) % N; H.n = Math.min(N, H.n + 1); }
      flashM.opacity = Math.max(0, flashM.opacity - dt * 2.5); flash.visible = flashM.opacity > 0.01;
      if (H.anim < 0) return;
      H.anim += dt; const u = H.anim / 1.1;
      if (u >= 1) { H.anim = -1; ghost.visible = ring.visible = hand.visible = false; return; }
      gM.opacity = 0.45 * (1 - u); ringM.opacity = 0.7 * (1 - u);
      ring.position.set(f.x, f.y + 0.06, f.z); ring.scale.setScalar(0.6 + u * 1.6); hand.position.set(f.x, f.y + 0.1, f.z); hand.rotation.y = u * 18; hand.scale.setScalar(0.5 + u);
    },
  };
}
