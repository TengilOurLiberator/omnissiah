// 3D previews with the three.js the game server already serves at /vendor/three/ (resolved through the import map in index.html).
// Both viewers return { dispose() } and release every GPU resource; each creates its own short-lived WebGL context.
let threeP = null;
const loadThree = () => (threeP ??= Promise.all([import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/controls/OrbitControls.js')])
  .then(([THREE, g, o]) => ({ THREE, GLTFLoader: g.GLTFLoader, OrbitControls: o.OrbitControls })));

function makeRenderer(THREE, container) {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.prepend(canvas);
  const size = () => { const w = container.clientWidth || 600, h = container.clientHeight || 400; renderer.setSize(w, h, false); return [w, h]; };
  return { renderer, canvas, size };
}
function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material ?? [])) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose?.(); }
  });
}

export async function modelViewer(container, url, { onInfo } = {}) {
  const { THREE, GLTFLoader, OrbitControls } = await loadThree();
  const { renderer, canvas, size } = makeRenderer(THREE, container);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a2450, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.2); sun.position.set(3, 6, 4); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8aa0ff, 1.0); rim.position.set(-4, 2, -3); scene.add(rim);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 1.6;
  controls.addEventListener('start', () => { controls.autoRotate = false; });
  let raf = 0, disposed = false, mixer = null, model = null;
  const clock = new THREE.Clock();
  const resize = () => { const [w, h] = size(); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  const tick = () => { if (disposed) return; raf = requestAnimationFrame(tick); const dt = clock.getDelta(); mixer?.update(dt); controls.update(); renderer.render(scene, camera); };
  tick();
  const gltf = await new GLTFLoader().loadAsync(url);
  if (disposed) { disposeTree(gltf.scene); return { dispose() {} }; }
  model = gltf.scene; scene.add(model);
  let tris = 0; model.traverse((o) => { if (o.isMesh && o.geometry) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  const box = new THREE.Box3().setFromObject(model), sz = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  const dim = Math.max(sz.x, sz.y, sz.z) || 1;
  model.position.sub(ctr); model.position.y += sz.y / 2;                       // stand on the floor, centred
  const floor = new THREE.Mesh(new THREE.CircleGeometry(dim * 0.62, 48), new THREE.MeshBasicMaterial({ color: 0x1a1f63, transparent: true, opacity: 0.55 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  camera.position.set(dim * 1.15, dim * 0.85, dim * 1.5); controls.target.set(0, sz.y / 2, 0); controls.minDistance = dim * 0.4; controls.maxDistance = dim * 6; controls.update();
  if (gltf.animations?.length) { mixer = new THREE.AnimationMixer(model); mixer.clipAction(gltf.animations[0]).play(); }
  onInfo?.({ triangles: Math.round(tris), size: [sz.x, sz.y, sz.z], clips: gltf.animations?.length ?? 0 });
  return {
    controls,
    dispose() {
      disposed = true; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      if (model) disposeTree(model); floor.geometry.dispose(); floor.material.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}

export async function panoViewer(container, url) {
  const { THREE } = await loadThree();
  const { renderer, canvas, size } = makeRenderer(THREE, container);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 100);
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.SphereGeometry(20, 64, 40); geo.scale(-1, 1, 1);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
  scene.add(mesh);
  let yaw = 0, pitch = 0, drag = null, auto = true, raf = 0, disposed = false;
  const resize = () => { const [w, h] = size(); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  const down = (e) => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; auto = false; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; };
  const move = (e) => { if (!drag) return; const k = camera.fov / canvas.clientHeight; yaw = drag.yaw + (e.clientX - drag.x) * k * Math.PI / 180; pitch = Math.max(-1.4, Math.min(1.4, drag.pitch + (e.clientY - drag.y) * k * Math.PI / 180)); };
  const up = () => { drag = null; canvas.style.cursor = 'grab'; };
  const wheel = (e) => { e.preventDefault(); camera.fov = Math.max(30, Math.min(100, camera.fov + e.deltaY * 0.04)); camera.updateProjectionMatrix(); };
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('wheel', wheel, { passive: false });
  const tick = () => { if (disposed) return; raf = requestAnimationFrame(tick); if (auto) yaw += 0.0015; camera.rotation.set(pitch, yaw, 0, 'YXZ'); renderer.render(scene, camera); };
  tick();
  return { dispose() { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); geo.dispose(); mesh.material.dispose(); tex.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); } };
}
