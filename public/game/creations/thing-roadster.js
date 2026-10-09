export const meta = { name: 'Roadster', description: 'Thing: a drivable open-top red car. Stand beside it and press left A to get in or out; left stick drives.' };
export default function (ctx) {
  const { THREE } = ctx, P = ctx.world.physics;
  if (!P) return {};
  const x = 3.8, z = 3.2, y = ctx.groundAt(x, z) + 1.1;
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  const red = lam(0xc8202a), dark = lam(0x1c1c22), chrome = lam(0xc9ccd4), tan = lam(0x8a5a36);
  const box = (w, h, d, m, px, py, pz, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(px, py, pz); parent.add(o); return o; };

  const chassis = new THREE.Group();
  chassis.position.set(x, y, z);
  ctx.root.add(chassis);
  box(1.7, 0.42, 3.5, red, 0, 0, 0, chassis);                 // tub
  box(1.5, 0.22, 1.2, red, 0, 0.3, -1.05, chassis);           // bonnet
  box(1.5, 0.2, 0.75, red, 0, 0.29, 1.3, chassis);            // boot
  box(1.8, 0.12, 0.16, chrome, 0, -0.12, -1.8, chassis);      // bumpers
  box(1.8, 0.12, 0.16, chrome, 0, -0.12, 1.8, chassis);
  box(1.3, 0.1, 1.1, dark, 0, 0.2, 0.3, chassis);             // cabin floor
  box(0.55, 0.55, 0.14, tan, -0.38, 0.5, 0.85, chassis);      // seat backs
  box(0.55, 0.55, 0.14, tan, 0.38, 0.5, 0.85, chassis);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.05), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.28, depthWrite: false }));
  glass.position.set(0, 0.62, -0.42); glass.rotation.x = -0.35; chassis.add(glass);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
  box(0.3, 0.16, 0.06, lampMat, -0.55, 0.12, -1.76, chassis);
  box(0.3, 0.16, 0.06, lampMat, 0.55, 0.12, -1.76, chassis);
  const tail = box(1.3, 0.1, 0.06, new THREE.MeshBasicMaterial({ color: 0x661010 }), 0, 0.12, 1.76, chassis);
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), dark);
  wheelRim.position.set(-0.38, 0.58, -0.2); wheelRim.rotation.x = -0.4; chassis.add(wheelRim);

  const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.BoxGeometry(0.28, 0.5, 0.12);
  const wheels = [[-0.9, -1.15, true], [0.9, -1.15, true], [-0.9, 1.15, false], [0.9, 1.15, false]].map(([wx, wz, steer]) => {
    const object = new THREE.Group(), spin = new THREE.Group();
    spin.add(new THREE.Mesh(tyreGeo, dark), new THREE.Mesh(hubGeo, chrome));
    object.add(spin); object.position.set(wx, -0.45, wz); chassis.add(object);
    return { position: [wx, -0.15, wz], radius: 0.36, steer, drive: true, brake: true, object, spin };
  });
  const car = P.vehicle(ctx, chassis, { size: [1.7, 0.5, 3.5], mass: 900, forward: '-z', wheels, engineForce: 5400, maxSteer: 0.5 });
  if (!car) return {};

  const kit = ctx.world.kit, snd = kit?.sound(ctx);
  const fx = kit?.particles(ctx, { count: 60, color: [0x999999, 0x333333], size: [0.12, 0.4], life: [0.5, 1], speed: [0.2, 0.8], gravity: -0.6, additive: false, alpha: 0.45 });
  const seat = new THREE.Vector3(-0.38, -0.6, 0.35), tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  const inp = { throttle: 0, steer: 0, brake: 1 };
  let driving = false, yawOff = 0, was = null, hinted = false, puff = 0;
  const carYaw = () => { fwd.set(0, 0, -1).applyQuaternion(chassis.quaternion); return Math.atan2(-fwd.x, -fwd.z); };
  const beep = (a, b) => snd?.tone({ freq: a, freqEnd: b, dur: 0.25, type: 'sawtooth', vol: 0.15, at: chassis.position });

  const enter = () => {
    const pl = ctx.world.player;
    up.set(0, 1, 0).applyQuaternion(chassis.quaternion);
    if (up.y < 0.4) {                                          // on its side or roof: set it upright first
      q.setFromAxisAngle(yAxis, carYaw());
      tmp.copy(chassis.position); tmp.y = ctx.groundAt(tmp.x, tmp.z) + 1.2;
      car.handle.setTransform(tmp, q); car.handle.setVelocity(0, 0, 0); car.handle.setAngularVelocity(0, 0, 0);
      chassis.position.copy(tmp); chassis.quaternion.copy(q);
    }
    if (pl) { was = { enabled: pl.enabled, flying: pl.flying, noclip: pl.noclip }; pl.enabled = false; pl.flying = true; pl.noclip = true; }
    yawOff = ctx.rig.rotation.y - carYaw();
    driving = true; tail.material.color.setHex(0xff2020);
    beep(70, 160);
    ctx.hud?.show('Left stick drives and steers. Left A to get out.', 5);
  };
  const exit = () => {
    const pl = ctx.world.player;
    driving = false; tail.material.color.setHex(0x661010);
    if (pl && was) { pl.enabled = was.enabled; pl.flying = was.flying; pl.noclip = was.noclip; pl.velocity?.set(0, 0, 0); }
    was = null;
    tmp.set(-1.8, 0, 0.3).applyQuaternion(chassis.quaternion).add(chassis.position);
    ctx.rig.position.set(tmp.x, ctx.groundAt(tmp.x, tmp.z), tmp.z);
    beep(140, 60);
  };
  ctx.onDispose(() => { if (driving) exit(); });

  return {
    update(dt) {
      const L = ctx.input.left;
      const near = tmp.copy(ctx.player.feet).sub(chassis.position).lengthSq() < 12;
      if (near && !driving && !hinted) { hinted = true; ctx.hud?.show('Press left A to drive.', 4); }
      if (!near) hinted = false;
      if (L.pressed('a')) { if (driving) exit(); else if (near) enter(); }
      if (driving) {
        const t = Math.abs(L.stick.y) > 0.12 ? -L.stick.y : 0, s = Math.abs(L.stick.x) > 0.12 ? L.stick.x : 0;
        inp.throttle = t; inp.steer = s * (1 - Math.min(0.55, Math.abs(car.speed) / 40)); inp.brake = t === 0 ? 0.25 : 0;
        car.setInput(inp);
        tmp.copy(seat).applyQuaternion(chassis.quaternion).add(chassis.position);
        ctx.rig.position.copy(tmp);
        ctx.rig.rotation.y = carYaw() + yawOff;
        ctx.world.player?.velocity?.set(0, 0, 0);
        if (fx) {
          puff += dt * (4 + Math.abs(t) * 18); const n = puff | 0; puff -= n;
          if (n) { tmp.set(0.5, -0.2, 1.85).applyQuaternion(chassis.quaternion).add(chassis.position); fx.emit(tmp, n); }
        }
      } else if (inp.brake !== 1 || inp.throttle !== 0) {
        inp.throttle = 0; inp.steer = 0; inp.brake = 1; car.setInput(inp);
      }
    },
  };
}
