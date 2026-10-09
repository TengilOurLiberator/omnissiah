// Thing: Target Range. Five red-and-white pop-up targets on posts fan out 8-15 m in front of a shooting bench. They flip up at random;
// hit one while it is up (spell, arrow, bolt, thrown rock, anything that damages) for 10 points, plus up to 5 for being quick. Your first hit
// starts a 45 s round with a countdown; at the end the final score and your best are shown, then it resets. INERT until spawned.
// SPAWN: ctx.world.library.spawn(ctx, 'target-range', { x, z, yaw })  -> handle (handle.remove() takes it away).  Summon list: Props.
//   The lane runs away from the bench (local -z, i.e. away from the player at spawn): stand at the bench and shoot down it.
export const meta = { name: 'Target Range', description: 'Thing: five pop-up targets with a timed scoring round.' };

export default function (ctx) {
  const { THREE } = ctx;
  let undo = null;
  const ROUND = 45, DIST = [8, 11, 14, 11.5, 9], SIDE = [-5, -2.6, 0, 2.6, 5];

  function build(c, o) {
    const kit = c.world.kit, i = o.inst;
    if (!kit || !i) return null;
    const own = (m) => { m.userData.own = true; return m; };
    const wood = own(new THREE.MeshLambertMaterial({ color: 0x7a5230 })), red = own(new THREE.MeshBasicMaterial({ color: 0xd83a3a })), white = own(new THREE.MeshBasicMaterial({ color: 0xf4f0e6 })), gold = own(new THREE.MeshBasicMaterial({ color: 0xffd24a }));
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.6), wood); bench.position.set(0, 0.95, 0); i.add(bench);
    for (const x of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.5), wood); l.position.set(x, 0.47, 0); i.add(l); }
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.04), red); sign.position.set(0, 1.5, 0.1); i.add(sign);
    const lab = i.label('Shoot a target to start', { size: 0.13, color: 0xffe9a0 }); lab.position.set(i.x, i.gy(0, 0) + 1.9, i.z);
    const fx = i.fx({ count: 160, color: [0xffffff, 0xff5a3a], size: [0.14, 0.03], life: [0.4, 1], speed: [2, 6], gravity: 6, drag: 0.6 });
    const snd = i.snd();
    const T = [];
    const discG = new THREE.CylinderGeometry(0.4, 0.4, 0.05, 20).rotateX(Math.PI / 2); discG.userData.shared = true;
    const ringG = new THREE.CylinderGeometry(0.26, 0.26, 0.055, 20).rotateX(Math.PI / 2); ringG.userData.shared = true;
    const eyeG = new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14).rotateX(Math.PI / 2); eyeG.userData.shared = true;
    const postG = new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6).translate(0, 0.65, 0); postG.userData.shared = true;
    for (let n = 0; n < 5; n++) {
      const g = new THREE.Group(), w = i.at(SIDE[n], -DIST[n]);
      g.position.set(SIDE[n], 0, -DIST[n]); i.add(g);
      g.add(new THREE.Mesh(postG, wood));
      const flip = new THREE.Group(); flip.position.set(0, 1.3, 0); g.add(flip);
      const d = new THREE.Mesh(discG, red); d.position.y = 0.4; flip.add(d);
      const r2 = new THREE.Mesh(ringG, white); r2.position.set(0, 0.4, 0.004); flip.add(r2);
      const e2 = new THREE.Mesh(eyeG, gold); e2.position.set(0, 0.4, 0.008); flip.add(e2);
      const gy = i.gy(SIDE[n], -DIST[n]);
      const t = { g, flip, up: 0, target: 0, wait: 1 + n * 0.7, tUp: 0, d: null, w, gy };
      flip.rotation.x = -Math.PI / 2; // lying flat (down)
      // hits are only registered by this damageable while the target is up
      const anchor = new THREE.Object3D(); anchor.position.set(0, 1.7, 0); g.add(anchor);
      t.d = i.dmg(anchor, { hp: 1e9, radius: 0.5, offsetY: 0, faction: 'neutral', onHit(e) {
        t.d.hp = t.d.maxHp;
        if (t.target !== 1 || t.up < 0.7) return;
        t.target = 0; t.wait = 1.2 + Math.random() * 2;
        const pts = 10 + Math.max(0, Math.min(5, Math.round(5 - t.tUp * 1.5)));
        if (round.t < 0) { round.t = 0; score = 0; }
        score += pts; lab.set(`Score ${score}  (+${pts})   ${Math.ceil(ROUND - round.t)} s`);
        const p = { x: t.w.x, y: gy + 1.7, z: t.w.z }; fx.emit(p, 22); snd.tone({ freq: 1200, freqEnd: 700, dur: 0.12, type: 'triangle', vol: 0.14, at: p }); snd.noise({ dur: 0.06, filter: { type: 'bandpass', freq: 2200, q: 2 }, vol: 0.12, at: p });
      } });
      T.push(t);
    }
    let score = 0, best = 0; const round = { t: -1, over: 0 };
    i.tick((dt) => {
      if (round.t >= 0) {
        round.t += dt;
        if (round.t >= ROUND) { best = Math.max(best, score); lab.set(`TIME!  Final ${score}   Best ${best}`); round.t = -1; round.over = 5; for (const t of T) { t.target = 0; t.wait = 6; } snd.chord([392, 523, 659], { dur: 0.7, vol: 0.14, type: 'triangle' }); }
        else lab.set(`Score ${score}   ${Math.ceil(ROUND - round.t)} s`);
      } else if (round.over > 0) { round.over -= dt; if (round.over <= 0) lab.set(best ? `Best ${best}. Shoot a target to start` : 'Shoot a target to start'); }
      for (const t of T) {
        if (t.target === 0) { t.wait -= dt; if (t.wait <= 0 && (round.over <= 0)) { t.target = 1; t.tUp = 0; snd.tone({ freq: 300, freqEnd: 500, dur: 0.1, type: 'square', vol: 0.05, at: t.w }); } }
        else t.tUp += dt;
        if (t.target === 1 && t.tUp > 5) { t.target = 0; t.wait = 1 + Math.random() * 2; }
        t.up += ((t.target - t.up) * Math.min(1, dt * 10));
        t.flip.rotation.x = -Math.PI / 2 * (1 - t.up);
      }
    });
    return { dispose() { for (const m of [wood, red, white, gold]) m.dispose(); discG.dispose(); ringG.dispose(); eyeG.dispose(); postG.dispose(); } };
  }

  const register = () => {
    undo?.();
    undo = ctx.world.library?.define('target-range', {
      category: 'props', description: 'a shooting range: five pop-up targets 8-15 m away that flip up at random; hit them with spells, arrows or thrown things for points in a timed 45 s round with a live score and best',
      aliases: ['shooting range', 'range', 'pop-up targets', 'target practice', 'popup targets', 'targets range', 'shooting gallery', 'targetrange'], options: 'yaw', size: 4, distance: 5, build,
    }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/library.js') register(); });
  ctx.onDispose(() => undo?.());
  return {};
}

