// mr/sim.js — desktop simulation of a passthrough session, for testing without a headset. world.mr.simulate(true) fakes passthrough on the flat
// view (input.passthrough = true, 'xr:start' { passthrough }), draws a neutral grey "room" (back wall, floor), and from then on the crosshair
// ray is a god-hand: left click = trigger (cast / drop an armed summon), right click = grip (pick up, throw, quake), the palette sits in the
// lower left. NEVER enabled by default. Scripted hands for tests: world.mr.hands.scriptGame('right', {x,y,z}, { grab: true }).
// What it simulates: passthrough flags and events, the room backdrop, a table (virtual pedestal, or a "real" table with fake plane detection via
// sim.realTable(true)), pointer hands. What it cannot: tracked-hand poses, real passthrough compositing, stereo, depth, real planes/meshes.
export default function (env) {
  const { THREE, ctx, roomGroup, S, T, events, input } = env;
  const { Mesh, Group } = THREE;
  let group = null, on = false, realTable = null;
  const mats = [], geos = [];
  const mk = (geo, color, o = {}) => { geos.push(geo); const m = new THREE.MeshBasicMaterial({ color, ...o }); mats.push(m); const me = new Mesh(geo, m); me.userData.noShadow = me.userData.noOutline = me.userData.noCull = true; return me; };

  function buildRoom() {
    if (group) return;
    group = new Group(); group.name = 'mr-sim-room'; roomGroup.add(group);
    const wall = mk(new THREE.PlaneGeometry(7, 3.2), 0x9a9da3); wall.position.set(0, 1.6, -3.1); group.add(wall);
    const left = mk(new THREE.PlaneGeometry(6.2, 3.2), 0x8d9096); left.position.set(-3.5, 1.6, 0); left.rotation.y = Math.PI / 2; group.add(left);
    const right = mk(new THREE.PlaneGeometry(6.2, 3.2), 0x8d9096); right.position.set(3.5, 1.6, 0); right.rotation.y = -Math.PI / 2; group.add(right);
    const floor = mk(new THREE.PlaneGeometry(7, 6.2), 0x6d7076); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 0); group.add(floor);
    const skirt = mk(new THREE.PlaneGeometry(7, 0.12), 0x5d6066); skirt.position.set(0, 0.06, -3.09); group.add(skirt);
    for (const m of group.children) m.renderOrder = -100;
  }
  function destroyRoom() {
    if (group) { roomGroup.remove(group); group = null; }
    for (const g of geos.splice(0)) g.dispose(); for (const m of mats.splice(0)) m.dispose();
    realTable = null;
  }
  const api = {
    get on() { return on; },
    simulate(v) {
      if (v === on) return on;
      const mr = env.ctx.world.mr;
      if (v) {
        on = true; S.simulated = true; S.simulating = true; S.placed = false; S.inside = false;
        buildRoom();
        input.passthrough = true;
        try { events.emit('xr:start', { passthrough: true }); } finally { S.simulating = false; }
      } else {
        on = false; S.simulated = false; S.simFeatures = null; S.simPlanes = false;
        input.passthrough = false;
        events.emit('xr:end', {});
        destroyRoom();
        void mr;
      }
      return on;
    },
    resume() { on = true; buildRoom(); },
    // a real table: a brown slab at y and a fake detected horizontal plane (feeds mr/room.js exactly like an XR frame would)
    realTable(v = true, o = {}) {
      const y = o.y ?? 0.74, cx = o.x ?? 0.1, cz = o.z ?? -1.2, w = o.w ?? 1.5, d = o.d ?? 0.9;
      if (!v) { if (realTable) { roomGroup.remove(realTable); realTable = null; } S.simFeatures = null; S.simPlanes = false; env.parts.room && env.parts.room.exit(); return false; }
      buildRoom();
      if (!realTable) {
        realTable = new Group();
        const top = mk(new THREE.BoxGeometry(w, 0.05, d), 0x8a5a36); top.position.set(cx, y - 0.03, cz); realTable.add(top);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const leg = mk(new THREE.BoxGeometry(0.06, y, 0.06), 0x5b3a22); leg.position.set(cx + sx * (w / 2 - 0.06), y / 2, cz + sz * (d / 2 - 0.06)); realTable.add(leg); }
        roomGroup.add(realTable);
      }
      S.simFeatures = ['plane-detection']; S.simPlanes = true;
      env.features.planes = true; env.features.list = ['plane-detection'];
      env.parts.room && env.parts.room.ingest([{ id: 'sim-table', center: { x: cx, y, z: cz }, w, d, orientation: 'horizontal' },
        { id: 'sim-wall', center: { x: 0, y: 1.3, z: -3.1 }, w: 6, d: 2.6, orientation: 'vertical', normal: { x: 0, y: 0, z: 1 } }]);
      return true;
    },
    // face the camera at the table (for screenshots and tests); dist = metres back from the table
    lookAtTable(pitchDown = 0.5) {
      const cam = ctx.camera, rig = ctx.rig;
      const dx = T.x - (rig.position.x + cam.position.x), dz = T.z - (rig.position.z + cam.position.z);
      cam.rotation.order = 'YXZ'; cam.rotation.y = Math.atan2(-dx, -dz); cam.rotation.x = -pitchDown;
      cam.updateWorldMatrix(true, false);
      cam.getWorldPosition(ctx.player.head); cam.getWorldDirection(ctx.player.forward);
    },
    exit() { if (!S.simulated) destroyRoom(); },
    dispose() { destroyRoom(); },
  };
  return api;
}
