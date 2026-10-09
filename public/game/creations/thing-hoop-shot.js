// Thing: Hoop Shot. A basketball hoop on a pole (solid backboard and rim) with two grabbable, bouncy orange balls at its foot. Pick a ball up
// with the squeeze button, throw it through the ring from above: each basket scores 2 (3 from beyond 6 m) with a swish, a spark burst and a
// floating tally. A ball that is lost far away comes back to the foot of the pole. INERT until spawned: this file only registers a library entry.
// SPAWN: ctx.world.library.spawn(ctx, 'hoop-shot', { x, z, yaw })  -> handle (handle.remove() takes it away).  Summon list: Props.
export const meta = { name: 'Hoop Shot', description: 'Thing: a basketball hoop and two throwable balls that score baskets.' };

export default function (ctx) {
  const { THREE } = ctx;
  let undo = null;

  function build(c, o) {
    const kit = c.world.kit, i = o.inst;
    if (!kit || !i) return null;
    const ground = i.gy(0, 0), RIM_Y = ground + 2.7, RIM_R = 0.23;
    const own = (m) => { m.userData.own = true; return m; };
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8).translate(0, 1.6, 0), own(new THREE.MeshLambertMaterial({ color: 0x5a606c }))); i.add(pole);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.06), own(new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }))); board.position.set(0, RIM_Y + 0.3, -0.6 - RIM_R); i.add(board);
    const sq = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.02), own(new THREE.MeshBasicMaterial({ color: 0xd83a3a }))); sq.position.set(0, RIM_Y + 0.1, -0.6 - RIM_R + 0.04); i.add(sq);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.7), pole.material); arm.position.set(0, RIM_Y - 0.1, -0.3); i.add(arm);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, 0.025, 6, 20).rotateX(Math.PI / 2), own(new THREE.MeshBasicMaterial({ color: 0xff6a1a }))); rim.position.set(0, RIM_Y, -0.6 - RIM_R * 0 - 0.0); i.add(rim);
    const rimW = i.at(0, 0.6); // the ring centre is 0.6 m in front of the pole (local +z is the front)
    const BZ = 0.6 - RIM_R - 0.05; rim.position.set(0, RIM_Y, 0.6); board.position.set(0, RIM_Y + 0.3, BZ); sq.position.set(0, RIM_Y + 0.1, BZ + 0.035); arm.geometry.dispose(); arm.geometry = new THREE.BoxGeometry(0.08, 0.08, BZ); arm.position.set(0, RIM_Y - 0.1, BZ / 2);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(RIM_R, RIM_R * 0.6, 0.35, 10, 1, true).translate(0, -0.18, 0), own(new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.6 }))); net.position.set(0, RIM_Y, 0.6); i.add(net);
    const fixed = [];
    const bw = i.at(0, 0.6 - RIM_R - 0.05);
    const bmesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.1), own(new THREE.MeshBasicMaterial({ visible: false })));
    const bb = i.body(bmesh, { shape: 'box', size: [1.2, 0.8, 0.1], mass: 0, bounce: 0.5, position: { x: bw.x, y: RIM_Y + 0.3, z: bw.z } }); if (bb) { fixed.push(bb); if (o.yaw && bb.quaternion) bb.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw); }
    const rimGeo = new THREE.SphereGeometry(0.03, 5, 4); rimGeo.userData.shared = true; const rimMat = own(new THREE.MeshBasicMaterial({ visible: false }));
    for (let a = 0; a < 6; a++) { const ang = (a / 6) * Math.PI * 2, w = i.at(Math.cos(ang) * RIM_R, 0.6 + Math.sin(ang) * RIM_R); const b = i.body(new THREE.Mesh(rimGeo, rimMat), { radius: 0.035, mass: 0, bounce: 0.4, position: { x: w.x, y: RIM_Y, z: w.z } }); if (b) fixed.push(b); }
    const lab = i.label('Baskets 0', { size: 0.14, color: 0xffb066 }); lab.position.set(i.x, RIM_Y + 1.2, i.z);
    const fx = i.fx({ count: 140, color: [0xffffff, 0xff9a3a], size: [0.12, 0.03], life: [0.4, 1], speed: [1.5, 5], gravity: 5, drag: 0.7 });
    const snd = i.snd();
    const ballGeo = new THREE.SphereGeometry(0.12, 14, 10); ballGeo.userData.shared = true;
    const ballMat = own(new THREE.MeshLambertMaterial({ color: 0xe8741e }));
    const balls = [];
    const home = (n) => i.at(n ? 0.5 : -0.5, 2.2);
    for (let n = 0; n < 2; n++) {
      const w = home(n), b = i.body(new THREE.Mesh(ballGeo, ballMat), { radius: 0.12, mass: 0.6, bounce: 0.78, friction: 0.5, grabbable: true, grabRange: 3, position: { x: w.x, y: ground + 0.2, z: w.z } });
      if (b) balls.push({ b, py: ground + 0.2, from: 0 });
    }
    let score = 0, cool = 0;
    i.tick((dt) => {
      cool -= dt;
      for (let n = 0; n < balls.length; n++) {
        const q = balls[n], p = q.b.position;
        if (cool <= 0 && q.py > RIM_Y && p.y <= RIM_Y && q.b.velocity.y < 0) {
          const dx = p.x - rimW.x, dz = p.z - rimW.z;
          if (Math.hypot(dx, dz) < RIM_R - 0.02) {
            const far = Math.hypot(q.sx - rimW.x, q.sz - rimW.z) > 6, pts = far ? 3 : 2; score += pts; cool = 0.5;
            lab.set(`Baskets ${score}${far ? '  (3 pointer!)' : ''}`);
            fx.emit({ x: rimW.x, y: RIM_Y - 0.1, z: rimW.z }, 30, undefined, 1); kit.flash(c, { x: rimW.x, y: RIM_Y, z: rimW.z }, { color: 0xffb066, intensity: 20, distance: 7, duration: 0.25 });
            snd.noise({ dur: 0.25, filter: { type: 'bandpass', freq: 3500, q: 1.5 }, vol: 0.14, at: rimW }); snd.chord([659, 880, 1175], { dur: 0.35, vol: 0.12, type: 'triangle', at: rimW });
            q.b.velocity.x *= 0.3; q.b.velocity.z *= 0.3;
          }
        }
        if (q.b.held) { q.sx = p.x; q.sz = p.z; }
        else if (q.sx === undefined) { q.sx = p.x; q.sz = p.z; }
        q.py = p.y;
        if (Math.hypot(p.x - i.x, p.z - i.z) > 25 || p.y < ground - 5) { const w = home(n); q.b.position.set(w.x, ground + 0.5, w.z); q.b.velocity.set(0, 0, 0); q.sx = w.x; q.sz = w.z; }
      }
    });
    return { dispose() { rimGeo.dispose(); ballGeo.dispose(); ballMat.dispose(); rimMat.dispose(); } };
  }

  const register = () => {
    undo?.();
    undo = ctx.world.library?.define('hoop-shot', {
      category: 'props', description: 'basketball hoop on a pole with two grabbable bouncy balls: throw them through the ring from above to score 2 (3 from far away); solid backboard and rim',
      aliases: ['hoop', 'basketball hoop', 'basketball', 'basket', 'hoops', 'basketball game', 'hoopshot', 'free throw'], options: 'yaw', size: 1, distance: 7, build,
    }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/library.js') register(); });
  ctx.onDispose(() => undo?.());
  return {};
}

