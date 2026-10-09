// lib/gen.js — shared loader for the AI-generated model set in /assets/generated/startzone/ (ids sz-*, lg-*, x-*).
// Every model is normalised: longest side = 1 unit, base at y = 0, centred in x/z. So scale === size in metres.
// Quest tier loads the light twin (q/<id>.glb, ~2.3k triangles, 512 px texture); PC tier loads the original (~19k triangles).
//
//   import { gen } from '/game/lib/gen.js';
//   const h = gen.spawn(ctx, 'sz-tree-oak', { x, z, yaw, size: 7 });        // Group, placed now, mesh appears when loaded; on the ground at (x,z)
//   h.object  h.ready (Promise, never rejects; h.error set on failure)  h.remove()
//   const f = gen.scatter(ctx, 'sz-boulder-mossy-a', [{ x, z, yaw, size }, ...]);   // instanced: one draw per material for the whole list
//   f.object  f.ready  f.remove()
//   gen.url(ctx, id)   gen.preload(ctx, [ids])   gen.box(id) -> {x,y,z} extents of the unit model once loaded (else null)
// Options: y (override ground height), sink (metres below ground, default 0.03), parent (default ctx.root), castShadow (default: PC tier only).
// Geometry and textures are cached for the page lifetime and shared by every clone; remove() only detaches (never disposes the cache).
import { GLTFLoader } from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';

const BASE = '/assets/generated/startzone/';
const cache = new Map(); // url -> Promise<{ scene, meshes:[{geometry, material, matrix}], box }>
const boxes = new Map(); // id -> {x,y,z}
const loader = new GLTFLoader();

function url(ctx, id) {
  return BASE + (ctx.quality && ctx.quality.pc ? '' : 'q/') + id + '.glb';
}

function load(ctx, id) {
  const u = url(ctx, id);
  let p = cache.get(u);
  if (!p) {
    p = loader.loadAsync(u).then((gltf) => {
      const THREE = ctx.THREE;
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const meshes = [];
      scene.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material;
        if (m && m.map) { m.map.anisotropy = 4; }
        if (m && 'metalness' in m) { m.metalness = Math.min(m.metalness, 0.1); m.roughness = Math.max(m.roughness, 0.75); }
        meshes.push({ geometry: o.geometry, material: m, matrix: o.matrixWorld.clone() });
      });
      const b = new THREE.Box3().setFromObject(scene);
      const box = { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z, minY: b.min.y };
      boxes.set(id, box);
      return { scene, meshes, box };
    });
    cache.set(u, p);
    p.catch(() => cache.delete(u));
  }
  return p;
}

const groundY = (ctx, x, z) => { try { const y = ctx.groundAt ? ctx.groundAt(x, z) : 0; return Number.isFinite(y) ? y : 0; } catch { return 0; } };
const shadows = (ctx, o) => (o.castShadow ?? !!(ctx.quality && ctx.quality.shadows));

function spawn(ctx, id, o = {}) {
  const THREE = ctx.THREE;
  const g = new THREE.Group();
  g.name = 'gen:' + id;
  const size = o.size ?? 1;
  const x = o.x ?? 0, z = o.z ?? 0;
  g.position.set(x, (o.y ?? groundY(ctx, x, z)) - (o.sink ?? 0.03), z);
  g.rotation.y = o.yaw ?? 0;
  g.scale.setScalar(size);
  (o.parent ?? ctx.root).add(g);
  const h = { id, object: g, loaded: false, error: null, remove() { g.removeFromParent(); h.removed = true; } };
  h.ready = load(ctx, id).then((t) => {
    if (h.removed) return h;
    const cast = shadows(ctx, o);
    for (const m of t.meshes) {
      const mesh = new THREE.Mesh(m.geometry, m.material);
      mesh.applyMatrix4(m.matrix);
      mesh.castShadow = cast; mesh.receiveShadow = true; mesh.userData.noOutline = true;
      g.add(mesh);
    }
    h.loaded = true; h.box = t.box;
    if (o.parent) { try { ctx.world?.style?.contact?.(g); } catch { /* style reloading */ } } // parented groups are not seen by the automatic contact-shadow sweep
    return h;
  }).catch((err) => { h.error = err; console.warn('[gen] failed to load', id, err?.message ?? err); return h; });
  if (ctx.onDispose) ctx.onDispose(() => h.remove());
  return h;
}

function scatter(ctx, id, list, o = {}) {
  const THREE = ctx.THREE;
  const g = new THREE.Group();
  g.name = 'gen-scatter:' + id;
  (o.parent ?? ctx.root).add(g);
  const f = { id, object: g, count: list.length, loaded: false, error: null, remove() { g.removeFromParent(); for (const im of g.children) im.dispose?.(); f.removed = true; } };
  f.ready = load(ctx, id).then((t) => {
    if (f.removed) return f;
    const cast = shadows(ctx, o);
    const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Euler();
    for (const m of t.meshes) {
      const im = new THREE.InstancedMesh(m.geometry, m.material, list.length);
      for (let i = 0; i < list.length; i++) {
        const it = list[i], s = it.size ?? o.size ?? 1;
        P.set(it.x, (it.y ?? groundY(ctx, it.x, it.z)) - (it.sink ?? o.sink ?? 0.03), it.z);
        Q.setFromEuler(E.set(0, it.yaw ?? 0, 0)); S.setScalar(s);
        M.compose(P, Q, S).multiply(m.matrix);
        im.setMatrixAt(i, M);
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = cast; im.receiveShadow = true; im.userData.noOutline = true;
      g.add(im);
    }
    f.loaded = true;
    return f;
  }).catch((err) => { f.error = err; console.warn('[gen] failed to load', id, err?.message ?? err); return f; });
  if (ctx.onDispose) ctx.onDispose(() => f.remove());
  return f;
}

export const gen = {
  url,
  spawn,
  scatter,
  preload: (ctx, ids) => Promise.all(ids.map((id) => load(ctx, id).catch(() => null))),
  box: (id) => boxes.get(id) ?? null,
};
