export const meta = { name: 'Sky Skiff', description: 'Thing: a flying boat. Stand beside it and press left A to board or leave; left stick flies and turns, right stick climbs and dives.' };
export default function (ctx) {
  const { THREE } = ctx, kit = ctx.world.kit, M = ctx.world.models;
  const x0 = -36.7, z0 = -23.1, HOVER = 0.7;
  const craft = new THREE.Group(), tilt = new THREE.Group();
  craft.position.set(x0, ctx.groundAt(x0, z0) + HOVER, z0);
  craft.rotation.y = Math.atan2(-0.19, 0.91);
  craft.userData.noCull = true;
  craft.add(tilt); ctx.root.add(craft);

  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  const brass = lam(0xc79a3a), wood = lam(0x6b4423);
  const glow = new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const boat = M?.spawn(ctx, M.find('boat-row-large') || 'boat-row-large', { parent: tilt, position: [0, 0, 0], yaw: 0 });
  if (!boat) {                                                  // fallback hull
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 3.6), wood); hull.position.y = 0.2; tilt.add(hull);
  }
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.0, 0.12, 20), wood);
  deck.scale.set(0.75, 1, 1.5); deck.position.y = -0.02; tilt.add(deck);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 6, 40).rotateX(Math.PI / 2), glow);
  ring.position.y = -0.3; ring.scale.set(0.8, 1, 1.4); tilt.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.9, 28).rotateX(-Math.PI / 2), glow);
  ring2.position.y = -0.35; tilt.add(ring2);
  const podGeo = new THREE.CylinderGeometry(0.22, 0.3, 0.5, 12), armGeo = new THREE.BoxGeometry(0.9, 0.08, 0.14), bladeGeo = new THREE.BoxGeometry(1.3, 0.03, 0.14);
  const props = [-1, 1].map((s) => {
    const arm = new THREE.Mesh(armGeo, brass); arm.position.set(s * 1.25, 0.35, 0.9); tilt.add(arm);
    const pod = new THREE.Mesh(podGeo, brass); pod.position.set(s * 1.75, 0.4, 0.9); tilt.add(pod);
    const p = new THREE.Group(); p.position.set(s * 1.75, 0.72, 0.9);
    p.add(new THREE.Mesh(bladeGeo, wood)); const b2 = new THREE.Mesh(bladeGeo, wood); b2.rotation.y = Math.PI / 2; p.add(b2);
    tilt.add(p); return p;
  });

  const fx = kit?.particles(ctx, { count: 160, color: [0xbff4ff, 0x2a7cff], size: [0.22, 0.02], life: [0.4, 0.9], speed: [0.2, 1], gravity: 3, spread: 0.5 });
  const tmp = new THREE.Vector3(), vel = new THREE.Vector3();
  let driving = false, yawOff = 0, yawVel = 0, was = null, hinted = false, acc = 0, time = 0;

  const enter = () => {
    const pl = ctx.world.player;
    if (pl) { was = { enabled: pl.enabled, flying: pl.flying, noclip: pl.noclip }; pl.enabled = false; pl.flying = true; pl.noclip = true; }
    yawOff = ctx.rig.rotation.y - craft.rotation.y;
    driving = true;
    if (!ctx.world.audio?.sfx('levitate', { at: craft.position })) kit?.sound(ctx).tone({ freq: 200, freqEnd: 600, dur: 0.5, at: craft.position });
    ctx.world.oracle?.flare(0x66e0ff, 0.6);
    ctx.hud?.show('Left stick: fly and turn. Right stick: up and down. Left A: step out.', 6);
  };
  const exit = () => {
    const pl = ctx.world.player;
    driving = false;
    if (pl && was) { pl.enabled = was.enabled; pl.flying = was.flying; pl.noclip = was.noclip; pl.velocity?.set(0, 0, 0); }
    was = null;
    const c = Math.cos(craft.rotation.y), s = Math.sin(craft.rotation.y);
    const px = craft.position.x - 2.2 * c, pz = craft.position.z + 2.2 * s;
    ctx.rig.position.set(px, ctx.groundAt(px, pz), pz);
  };
  ctx.onDispose(() => { if (driving) exit(); });
  const dz = (v) => (Math.abs(v) > 0.14 ? v : 0);

  return {
    update(dt) {
      time += dt;
      const L = ctx.input.left, R = ctx.input.right, p = craft.position;
      const ground = ctx.groundAt(p.x, p.z);
      tmp.copy(ctx.player.feet).sub(p);
      const near = tmp.x * tmp.x + tmp.z * tmp.z < 14 && Math.abs(tmp.y) < 4;
      if (near && !driving && !hinted) { hinted = true; ctx.hud?.show('Press left A to board the sky skiff.', 4); }
      if (!near) hinted = false;
      if (L.pressed('a')) { if (driving) exit(); else if (near) enter(); }

      let thrust = 0, turn = 0, lift = 0;
      if (driving) { thrust = -dz(L.stick.y); turn = dz(L.stick.x); lift = -dz(R.stick.y); }
      const k = 1 - Math.exp(-2.2 * dt);
      yawVel += (-turn * 1.3 - yawVel) * (1 - Math.exp(-4 * dt));
      craft.rotation.y += yawVel * dt;
      const fxz = -Math.sin(craft.rotation.y), fzz = -Math.cos(craft.rotation.y), sp = thrust * (thrust > 0 ? 16 : 6);
      vel.x += (fxz * sp - vel.x) * k; vel.z += (fzz * sp - vel.z) * k;
      const wantY = driving ? lift * 6 : (ground + HOVER - p.y) * 1.2;      // unmanned: settle to boarding height
      vel.y += (Math.max(-5, Math.min(6, wantY)) - vel.y) * k;
      p.x += vel.x * dt; p.y += vel.y * dt; p.z += vel.z * dt;
      const floor = ctx.groundAt(p.x, p.z) + HOVER;
      if (p.y < floor) { p.y = floor; if (vel.y < 0) vel.y = 0; }
      if (p.y > ground + 180) { p.y = ground + 180; if (vel.y > 0) vel.y = 0; }

      const fwdSpeed = vel.x * fxz + vel.z * fzz;
      tilt.rotation.z += (yawVel * 0.28 * Math.min(1, Math.abs(fwdSpeed) / 6 + 0.3) - tilt.rotation.z) * k;
      tilt.rotation.x += (-fwdSpeed * 0.012 - tilt.rotation.x) * k;
      tilt.position.y = Math.sin(time * 1.6) * 0.05;
      const spin = (8 + Math.abs(fwdSpeed) * 2 + Math.abs(vel.y) * 3) * dt;
      props[0].rotation.y += spin; props[1].rotation.y -= spin;
      ring2.rotation.y += dt * 2; glow.opacity = 0.55 + Math.sin(time * 5) * 0.2;

      if (driving) {
        ctx.rig.position.set(p.x, p.y + 0.12 + tilt.position.y, p.z);
        ctx.rig.rotation.y = craft.rotation.y + yawOff;
        ctx.world.player?.velocity?.set(0, 0, 0);
      }
      if (fx) {
        acc += dt * (driving ? 40 + Math.abs(fwdSpeed) * 4 : 12); const n = acc | 0; acc -= n;
        if (n) { tmp.set(p.x, p.y - 0.35, p.z); fx.emit(tmp, n); }
      }
    },
  };
}
