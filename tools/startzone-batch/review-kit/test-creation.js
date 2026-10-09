// sandbox-only creation: spawns a row of 5 catalogue ids next to 1.7 m red markers, then moves the rig back to look at them
export default async function (ctx) {
  const THREE = ctx.THREE;
  const q = new URLSearchParams(location.search);
  const row = +(q.get('row') ?? 0);
  const ROWS = [
    ['sz-barrel', 'sz-cooking-pot', 'sz-weapon-rack', 'lg-treasure-chest-gold', 'sz-stone-well'],
    ['sz-tent', 'sz-runestone-tall', 'x-statue-wolf', 'lg-cannon', 'lg-snowman'],
    ['sz-tree-oak', 'x-tree-cherry-blossom', 'lg-cactus-tall', 'sz-rowing-boat', 'sz-flower-patch'],
    ['lg-village-cottage-a', 'lg-windmill', 'lg-lighthouse', 'lg-keep', 'lg-giant-clock-face'],
  ];
  const W = ctx.world;
  window.__gt = { ready: false };
  if (!W.gen) { window.__gt = { ready: true, error: 'world.gen missing' }; return {}; }
  await W.gen.ready();
  const CFG = [[3.2, -6], [5, -10], [8, -24], [18, -46]][row]; const X = [-2, -1, 0, 1, 2].map((k) => k * CFG[0]), Z = CFG[1];
  const hs = [];
  const mat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  ROWS[row].forEach((id, i) => {
    const h = W.gen.spawn(ctx, id, { x: X[i], z: Z });
    hs.push(h);
    const half = Math.max(h.info ? h.info.box.x * h.size : 1, h.info ? h.info.box.z * h.size : 1) / 2;
    const mx = X[i] + half + 0.7, mz = Z + 1;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.7, 10), mat);
    m.position.set(mx, ctx.groundAt(mx, mz) + 0.85, mz);
    m.userData.noShadow = m.userData.noOutline = true;
    ctx.root.add(m);
  });
  await Promise.all(hs.map((h) => h.ready));
  ctx.rig.position.set(0, ctx.groundAt(0, 4), 4);
  const info = () => hs.map((h) => ({ want: h.query, id: h.id, loaded: h.loaded, err: h.error ? String(h.error.message || h.error) : '', sub: h.substituted, size: +h.size.toFixed(2), y: +h.object.position.y.toFixed(2), ground: +ctx.groundAt(h.object.position.x, h.object.position.z).toFixed(2), solid: !!h.collider, skipped: h.skipped }));
  window.__gtInfo = () => ({ items: info(), tris: ctx.renderer.info.render.triangles, calls: ctx.renderer.info.render.calls, tier: ctx.quality.tier, physics: !!W.physics, stats: W.physics && W.physics.stats ? W.physics.stats() : null });
  window.__gtRay = () => {
    const P = W.physics; if (!P || !P.raycast) return 'no raycast';
    return hs.map((h) => {
      if (!h.info) return [h.query, 'noinfo'];
      const x = h.object.position.x;
      const r = P.raycast(new THREE.Vector3(x, h.object.position.y + 0.6, Z + 14), new THREE.Vector3(0, 0, -1), 30, { groups: 'world' });
      const exp = Z + (h.info.col === 'trunk' ? Math.min(0.6, Math.max(0.15, 0.1 * Math.max(h.info.box.x, h.info.box.z) * h.size)) : h.info.box.z * h.size / 2);
      return [h.id, 'solid=' + !!h.collider, r ? 'hit z=' + r.point.z.toFixed(2) + ' kind=' + r.kind : 'miss', 'expect ' + exp.toFixed(2)];
    });
  };  setTimeout(() => { window.__gt.ready = true; }, 4000);
  return {};
}
