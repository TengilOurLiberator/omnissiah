// Thing: Crate Pyramid. Ten wooden crates stacked 4-3-2-1 (real rigid bodies) plus a heavy iron ball to throw. Knock them down with the ball,
// a spell, an explosion or a sword; a label counts the crates you have toppled and when all ten are down it celebrates and restacks
// itself 6 s later. INERT until spawned: this file only registers a library entry.
// SPAWN: ctx.world.library.spawn(ctx, 'crate-pyramid', { x, z, yaw })  -> handle (handle.remove() takes it away).  Summon list: Props.
export const meta = { name: 'Crate Pyramid', description: 'Thing: a stack of physics crates and an iron ball to knock them down with.' };

export default function (ctx) {
  const { THREE } = ctx;
  let undo = null;

  function build(c, o) {
    const kit = c.world.kit, i = o.inst;
    if (!kit || !i) return null;
    const S = 0.5 * (o.scale ?? 1), rows = [4, 3, 2, 1];
    const geo = new THREE.BoxGeometry(S, S, S); geo.userData.shared = true;
    const ballGeo = new THREE.SphereGeometry(0.17, 12, 8); ballGeo.userData.shared = true;
    const mats = [0xb5833f, 0xa67634, 0xc29150].map((col) => { const m = new THREE.MeshLambertMaterial({ color: col }); m.userData.own = true; return m; });
    const iron = new THREE.MeshLambertMaterial({ color: 0x4a4e58 }); iron.userData.own = true;
    const ground = i.gy(0, 0);
    const crates = [];
    let ball = null, state = 'up', timer = 0, down = 0;
    const lab = i.label('Crates 0 / 10', { size: 0.13, color: 0xffd98a }); lab.position.set(i.x, ground + 3.1, i.z);
    const fx = i.fx({ count: 200, color: [0xffffff, 0xffc84a], size: [0.14, 0.03], life: [0.5, 1.2], speed: [3, 8], gravity: 6, drag: 0.6 });
    const snd = i.snd();
    const home = [];
    function stack() {
      const n = c.world.perf ? c.world.perf.allow('bodies', 11) : 11;
      let made = 0;
      for (let r = 0; r < rows.length; r++) for (let q = 0; q < rows[r]; q++) {
        if (made >= n - 1) break;
        const lx = (q - (rows[r] - 1) / 2) * (S * 1.04), w = i.at(lx, 0), mesh = new THREE.Mesh(geo, mats[(r + q) % 3]);
        const pos = { x: w.x, y: ground + S * 0.5 + r * (S * 1.01) + 0.02, z: w.z };
        const b = i.body(mesh, { shape: 'box', size: [S, S, S], mass: 6, friction: 0.7, bounce: 0.05, position: pos });
        if (!b) continue;
        if (o.yaw && b.quaternion) { b.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.yaw); }
        crates.push(b); home.push(pos); made++;
      }
    }
    function throwBall() {
      const w = i.at(0, 4.5), m = new THREE.Mesh(ballGeo, iron);
      ball = i.body(m, { radius: 0.17, mass: 5, bounce: 0.2, friction: 0.5, grabbable: true, grabRange: 4, damage: 6, position: { x: w.x, y: ground + 0.3, z: w.z } });
    }
    stack(); throwBall();
    function restack() {
      for (const b of crates) { try { b.remove(); } catch (err) { /* gone */ } }
      crates.length = 0; home.length = 0; stack(); down = 0; state = 'up'; lab.set('Crates 0 / 10');
    }
    i.tick((dt) => {
      if (state === 'up') {
        let n = 0;
        for (let k = 0; k < crates.length; k++) { const p = crates[k].position, h = home[k]; if (Math.hypot(p.x - h.x, p.z - h.z) > 1.1 || p.y < h.y - 0.35) n++; }
        if (n !== down) { down = n; lab.set(`Crates ${down} / ${crates.length}`); snd.tone({ freq: 500 + down * 60, freqEnd: 420 + down * 60, dur: 0.1, type: 'square', vol: 0.08, at: { x: i.x, y: ground + 1, z: i.z } }); }
        if (crates.length && down >= crates.length - 1) { state = 'won'; timer = 0; lab.set('FLATTENED!'); for (let f = 0; f < 4; f++) fx.emit({ x: i.x + (f - 1.5) * 0.8, y: ground + 1.2, z: i.z }, 30, undefined, 1); kit.flash(c, { x: i.x, y: ground + 2, z: i.z }, { color: 0xffc84a, intensity: 40, distance: 12, duration: 0.4 }); snd.chord([523, 659, 784, 1046], { dur: 0.8, vol: 0.16, type: 'triangle', at: { x: i.x, y: ground + 1, z: i.z } }); }
      } else { timer += dt; if (timer > 6) restack(); }
      if (ball && ball.position) { const p = ball.position; if (p.y < ground - 5 || Math.hypot(p.x - i.x, p.z - i.z) > 40) { const w = i.at(0, 4.5); ball.position.set(w.x, ground + 0.4, w.z); ball.velocity.set(0, 0, 0); } }
    }, { every: 0.1 });
    return { dispose() { geo.dispose(); ballGeo.dispose(); for (const m of mats) m.dispose(); iron.dispose(); } };
  }

  const register = () => {
    undo?.();
    undo = ctx.world.library?.define('crate-pyramid', {
      category: 'props', description: 'a pyramid of ten real wooden crates plus a heavy iron ball: topple them with the ball, a spell or an explosion; counts crates down and restacks itself',
      aliases: ['crate pyramid', 'crate stack game', 'knock down crates', 'crate tower', 'cratepyramid', 'pyramid of crates', 'box pyramid'], options: 'yaw', size: 3, distance: 8, build,
    }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/library.js') register(); });
  ctx.onDispose(() => undo?.());
  return {};
}
