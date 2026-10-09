// mr/stage.js â€” the visible diorama: the table disc, its rim and glow, a pedestal, tiny trees, markers and effects (rings, trails, auras),
// the status board, and the comfort vignette. Everything in GAME space lives in env.stage (miniaturised at draw time by core/mr.js);
// room-space things (board, vignette) live in env.roomGroup. Materials: Lambert/Basic only; glow uses the alpha-safe additive blend.
export default function (env) {
  const { THREE, ctx, stage, roomGroup, S, T } = env;
  const { Mesh, Group, Vector3, Color } = THREE;
  const R0 = 15;
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
  const tag = (m) => { m.userData.noShadow = true; m.userData.noOutline = true; m.userData.noCull = true; return m; };
  const lam = (c, o = {}) => keep(new THREE.MeshLambertMaterial({ color: c, ...o }));
  // additive that leaves framebuffer alpha alone (the passthrough alpha rule)
  const glowMat = (c, o = {}) => keep(new THREE.MeshBasicMaterial({
    color: c, transparent: true, depthWrite: false, fog: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, ...o,
  }));
  const softMat = (c, o = {}) => keep(new THREE.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, fog: false, ...o }));

  const top = new Group(); top.name = 'mr-table'; stage.add(top);

  // ---- the grass disc: a polar grid with jittered vertex colours (flat: physics and groundHeight say y = 0)
  function discGeometry() {
    const rings = 16, segs = 72, pos = [], col = [], idx = [];
    const c0 = new Color(0x62a04a), c1 = new Color(0x4d8a3e), c2 = new Color(0x8aa65a), tmp = new Color();
    pos.push(0, 0, 0); col.push(c0.r, c0.g, c0.b);
    for (let r = 1; r <= rings; r++) {
      const rr = (r / rings) * R0;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        pos.push(x, 0, z);
        const h = hash(x * 0.7, z * 0.7), h2 = hash(x * 0.21 + 9, z * 0.21 - 4);
        tmp.copy(c0).lerp(c1, h).lerp(c2, h2 * 0.45);
        const edge = Math.max(0, (r / rings - 0.86) / 0.14);
        tmp.multiplyScalar(1 - edge * 0.22);
        col.push(tmp.r, tmp.g, tmp.b);
      }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let r = 1; r < rings; r++) {
      const a = 1 + (r - 1) * segs, b = 1 + r * segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        idx.push(a + s, a + s1, b + s, a + s1, b + s1, b + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return keep(g);
  }
  const disc = tag(new Mesh(discGeometry(), lam(0xffffff, { vertexColors: true }))); disc.name = 'mr-disc'; top.add(disc);
  const wall = tag(new Mesh(keep(new THREE.CylinderGeometry(R0, R0 * 1.012, 1.1, 72, 1, true).translate(0, -0.55, 0)), lam(0x6d5139, { side: THREE.DoubleSide }))); top.add(wall);
  const bottom = tag(new Mesh(keep(new THREE.CircleGeometry(R0 * 1.012, 48).rotateX(Math.PI / 2).translate(0, -1.1, 0)), lam(0x3a2c20))); top.add(bottom);
  const lip = tag(new Mesh(keep(new THREE.TorusGeometry(R0 + 0.05, 0.28, 6, 96).rotateX(Math.PI / 2).translate(0, 0.03, 0)), lam(0xb08a52))); top.add(lip);
  const rim = tag(new Mesh(keep(new THREE.RingGeometry(R0 - 0.1, R0 + 0.9, 96).rotateX(-Math.PI / 2).translate(0, 0.06, 0)), glowMat(0xffd88a, { opacity: 0.22, side: THREE.DoubleSide })));
  rim.renderOrder = 4; top.add(rim);
  const halo = tag(new Mesh(keep(new THREE.RingGeometry(R0 + 0.6, R0 + 3.4, 96).rotateX(-Math.PI / 2).translate(0, 0.04, 0)), glowMat(0xffd88a, { opacity: 0.07, side: THREE.DoubleSide })));
  halo.renderOrder = 3; top.add(halo);

  // ---- virtual pedestal (hidden when a real surface carries the table)
  const colMat = lam(0x4b4a58), baseMat = lam(0x34333f);
  const column = tag(new Mesh(keep(new THREE.CylinderGeometry(2.4, 3.2, 1, 24).translate(0, -0.5, 0)), colMat)); stage.add(column);
  const basePlate = tag(new Mesh(keep(new THREE.CylinderGeometry(5.2, 5.6, 0.5, 32).translate(0, 0.25, 0)), baseMat)); stage.add(basePlate);

  // ---- tiny trees round the rim (2 draw calls)
  const NT = 44;
  const trunkG = keep(new THREE.CylinderGeometry(0.18, 0.28, 1.7, 6).translate(0, 0.85, 0));
  const crownG = keep(new THREE.ConeGeometry(1.5, 4.2, 7).translate(0, 3.6, 0));
  const trunks = tag(new THREE.InstancedMesh(trunkG, lam(0x6b4a2e), NT));
  const crowns = tag(new THREE.InstancedMesh(crownG, lam(0xffffff), NT));
  trunks.frustumCulled = crowns.frustumCulled = false;
  const treeSpec = [];
  { // deterministic ring of trees with gaps
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new Vector3(), sc = new Vector3(), c = new Color();
    for (let i = 0; i < NT; i++) {
      const a = (i / NT) * Math.PI * 2 + (hash(i, 3) - 0.5) * 0.12;
      const r = 11.9 + hash(i, 7) * 2.3;
      const k = 0.7 + hash(i, 11) * 0.8;
      treeSpec.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, k, tint: hash(i, 13) });
    }
    treeSpec.forEach((t, i) => {
      p.set(t.x, 0, t.z); q.setFromAxisAngle(new Vector3(0, 1, 0), t.tint * 6); sc.setScalar(t.k);
      m.compose(p, q, sc); trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, c.setHSL(0.27 + t.tint * 0.06, 0.45, 0.2 + t.tint * 0.1));
    });
    trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  }
  top.add(trunks, crowns);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new Vector3(), _s = new Vector3(), _up = new Vector3(0, 1, 0);
  let maskFn = null, maskVer = 0;
  function remaskTrees() { // trees that stand where a mode needs room (a path) shrink away
    treeSpec.forEach((t, i) => {
      const hide = maskFn ? maskFn(t.x, t.z) : false;
      _p.set(t.x, 0, t.z); _q.setFromAxisAngle(_up, t.tint * 6); _s.setScalar(hide ? 0.0001 : t.k);
      _m.compose(_p, _q, _s); trunks.setMatrixAt(i, _m); crowns.setMatrixAt(i, _m);
    });
    trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = true;
  }

  // ---- markers and effects (game space)
  const ringG = keep(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2));
  const mkRing = (color, opacity = 0.8) => { const m = tag(new Mesh(ringG, softMat(color, { opacity, side: THREE.DoubleSide }))); m.visible = false; m.renderOrder = 6; stage.add(m); return m; };
  const hoverRing = mkRing(0xffe9a0, 0.85), talkRing = mkRing(0x9fe8ff, 0.95), ghostRing = mkRing(0xffffff, 0.9), selectRing = mkRing(0x9dff9d, 0.9);
  const beamG = keep(new THREE.CylinderGeometry(0.07, 0.07, 1, 6).translate(0, 0.5, 0));
  const ghostBeam = tag(new Mesh(beamG, softMat(0xffffff, { opacity: 0.55 }))); ghostBeam.visible = false; ghostBeam.renderOrder = 6; stage.add(ghostBeam);
  const ripples = [];
  for (let i = 0; i < 6; i++) { const m = mkRing(0xffffff, 0); m.userData.t = -1; ripples.push(m); }
  function ripple(pos, radius = 3, color = 0xffe9a0, life = 0.9) {
    const m = ripples.find((r) => r.userData.t < 0) ?? ripples[0];
    m.position.set(pos.x, 0.08, pos.z); m.userData.t = 0; m.userData.life = life; m.userData.r = radius;
    m.material.color.set(color); m.visible = true; m.scale.setScalar(0.2);
  }
  const pillars = [];
  for (let i = 0; i < 3; i++) { const b = tag(new Mesh(beamG, glowMat(0xfff0b0, { opacity: 0 }))); b.visible = false; b.userData.t = -1; b.renderOrder = 7; stage.add(b); pillars.push(b); }
  function pulse(pos, radius = 3) { // "something arrived here"
    ripple(pos, radius * 1.4, 0xfff0b0, 1.2);
    const b = pillars.find((p) => p.userData.t < 0) ?? pillars[0];
    b.position.set(pos.x, 0, pos.z); b.userData.t = 0; b.userData.life = 1.2; b.userData.r = Math.max(0.4, radius * 0.25); b.visible = true;
  }
  // aura dome (open palm over the table)
  const domeG = keep(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  const dome = tag(new Mesh(domeG, softMat(0x7affc0, { opacity: 0.0, side: THREE.DoubleSide }))); dome.visible = false; dome.renderOrder = 5; stage.add(dome);
  const domeRing = mkRing(0x7affc0, 0.9);
  // quake bump
  const bump = tag(new Mesh(keep(new THREE.ConeGeometry(1, 1, 10).translate(0, 0.5, 0)), lam(0x6a4a30))); bump.visible = false; stage.add(bump);
  // drawn path trail
  const TRAIL_N = 160;
  const trailGeo = keep(new THREE.BufferGeometry());
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  trailGeo.setDrawRange(0, 0);
  const trail = tag(new THREE.Line(trailGeo, keep(new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, depthWrite: false, fog: false, opacity: 0.95 }))));
  trail.frustumCulled = false; trail.renderOrder = 7; trail.visible = false; stage.add(trail);
  function setTrail(points) {
    if (!points || points.length < 1) { trail.visible = false; return; }
    const a = trailGeo.attributes.position.array, n = Math.min(points.length, TRAIL_N);
    for (let i = 0; i < n; i++) { const p = points[i]; a[i * 3] = p.x; a[i * 3 + 1] = 0.12; a[i * 3 + 2] = p.z; }
    trailGeo.attributes.position.needsUpdate = true; trailGeo.setDrawRange(0, n); trail.visible = n > 1;
  }

  // ---- status board (room space, billboards towards the head)
  let board = null;
  if (typeof document !== 'undefined' && document.createElement) {
    try {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
      const g = cv.getContext('2d');
      const tex = keep(new THREE.CanvasTexture(cv)); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
      const mat = keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
      const m = tag(new Mesh(keep(new THREE.PlaneGeometry(0.34, 0.1275)), mat)); m.renderOrder = 20; m.visible = false;
      roomGroup.add(m);
      board = { cv, g, tex, mesh: m, text: '', has: false };
    } catch (e) { board = null; }
  }
  function setBoard(lines) {
    if (!board) return;
    const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
    if (text === board.text) return;
    board.text = text;
    board.has = !!text;
    if (!text) { board.mesh.visible = false; return; }
    const g = board.g, ls = text.split('\n');
    g.clearRect(0, 0, 512, 192);
    g.fillStyle = 'rgba(10,12,28,0.72)'; g.beginPath(); g.roundRect ? g.roundRect(4, 4, 504, 184, 22) : g.rect(4, 4, 504, 184); g.fill();
    g.strokeStyle = 'rgba(255,216,119,0.8)'; g.lineWidth = 3; g.stroke();
    g.textAlign = 'left'; g.textBaseline = 'middle';
    ls.slice(0, 4).forEach((l, i) => {
      g.font = `${i === 0 ? 700 : 600} ${i === 0 ? 40 : 34}px sans-serif`;
      g.fillStyle = i === 0 ? '#ffd877' : '#ffffff';
      g.fillText(l, 24, 36 + i * 44);
    });
    board.tex.needsUpdate = true;
  }

  // ---- comfort vignette (a veil on the camera for the step-in transition)
  const vigMat = keep(new THREE.ShaderMaterial({
    uniforms: { uAmt: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform float uAmt; void main(){ float r = length(vUv - 0.5) * 2.0; float a = uAmt * (0.5 + 0.5 * smoothstep(0.1, 0.8, r)); gl_FragColor = vec4(0.0, 0.0, 0.02, a); }',
    transparent: true, depthTest: false, depthWrite: false, fog: false,
  }));
  const veil = tag(new Mesh(keep(new THREE.PlaneGeometry(1.9, 1.9)), vigMat));
  veil.position.set(0, 0, -0.32); veil.renderOrder = 10000; veil.frustumCulled = false; veil.visible = false;
  ctx.camera.add(veil);

  // ---- state
  let rimHot = 0, rimHotT = 0, t0 = 0;
  const hover = { on: false, pos: new Vector3(), r: 1 };
  const _v = new Vector3();

  const api = {
    disc, ripple, pulse, setTrail, setBoard, mkRing,
    get trail() { return trail; },
    setRimHot(v) { rimHotT = v ? 1 : 0; },
    setHover(pos, r = 1) { if (!pos) { hover.on = false; hoverRing.visible = false; return; } hover.on = true; hover.pos.copy(pos); hover.r = r; },
    setTalk(actor) {
      if (!actor) { talkRing.visible = false; return; }
      talkRing.visible = true; const p = actor.group.position; talkRing.position.set(p.x, p.y + 0.1, p.z);
      talkRing.scale.setScalar(Math.max(0.8, (actor.height ?? 1.7) * 0.45));
    },
    setGhost(pos, color = 0xffffff, r = 1.2) {
      if (!pos) { ghostRing.visible = false; ghostBeam.visible = false; return; }
      ghostRing.visible = ghostBeam.visible = true;
      ghostRing.position.set(pos.x, 0.1, pos.z); ghostRing.scale.setScalar(r);
      ghostRing.material.color.set(color); ghostBeam.material.color.set(color);
      ghostBeam.position.set(pos.x, 0, pos.z); ghostBeam.scale.set(1, 7, 1);
    },
    setSelect(pos, r = 1) { if (!pos) { selectRing.visible = false; return; } selectRing.visible = true; selectRing.position.set(pos.x, 0.1, pos.z); selectRing.scale.setScalar(r); },
    setAura(pos, r) {
      if (!pos) { dome.visible = domeRing.visible = false; return; }
      dome.visible = domeRing.visible = true;
      dome.position.set(pos.x, 0, pos.z); dome.scale.setScalar(r); dome.material.opacity = 0.16 + Math.sin(t0 * 6) * 0.04;
      domeRing.position.set(pos.x, 0.1, pos.z); domeRing.scale.setScalar(r);
    },
    setBump(pos, h, r = 1.6) { if (!pos || h <= 0.01) { bump.visible = false; return; } bump.visible = true; bump.position.set(pos.x, 0, pos.z); bump.scale.set(r, h, r); },
    maskTrees(fn) { maskFn = fn; maskVer++; remaskTrees(); },
    showTrees(v) { trunks.visible = crowns.visible = v; },
    treeSpec,
    enter() { top.visible = true; },
    exit() {
      for (const r of ripples) { r.visible = false; r.userData.t = -1; }
      for (const b of pillars) { b.visible = false; b.userData.t = -1; }
      hoverRing.visible = talkRing.visible = ghostRing.visible = selectRing.visible = ghostBeam.visible = dome.visible = domeRing.visible = bump.visible = trail.visible = false;
      veil.visible = false;
      if (board) board.mesh.visible = false;
    },
    update(dt, t) {
      t0 = t;
      const inside = env.inside, onSurf = !!S.onSurface;
      const R = env.radius, k = R / R0;
      disc.scale.set(k, 1, k); wall.scale.set(k, 1, k); bottom.scale.set(k, 1, k); lip.scale.set(k, 1, k); rim.scale.set(k, 1, k); halo.scale.set(k, 1, k);
      const showPed = !onSurf && !inside;
      column.visible = basePlate.visible = showPed;
      if (showPed) {
        const fy = env.floorY;
        column.scale.set(1, Math.max(0.01, -1.1 - fy), 1); column.position.y = -1.1;
        basePlate.position.y = fy;
      }
      halo.visible = !inside;
      // rim glow breathes; brighter while a hand is near the rim (it can be grabbed)
      rimHot += (rimHotT - rimHot) * Math.min(1, dt * 8);
      rim.material.opacity = 0.2 + 0.05 * Math.sin(t * 1.6) + rimHot * 0.5;
      if (hover.on) { hoverRing.visible = true; hoverRing.position.set(hover.pos.x, 0.1, hover.pos.z); hoverRing.scale.setScalar(hover.r * (1 + 0.06 * Math.sin(t * 8))); }
      for (const r of ripples) {
        if (r.userData.t < 0) continue;
        r.userData.t += dt / r.userData.life;
        const u = r.userData.t;
        if (u >= 1) { r.userData.t = -1; r.visible = false; continue; }
        r.scale.setScalar(0.2 + (r.userData.r - 0.2) * (1 - (1 - u) * (1 - u)));
        r.material.opacity = 0.9 * (1 - u);
      }
      for (const b of pillars) {
        if (b.userData.t < 0) continue;
        b.userData.t += dt / b.userData.life;
        const u = b.userData.t;
        if (u >= 1) { b.userData.t = -1; b.visible = false; continue; }
        b.scale.set(b.userData.r * (1 - u * 0.6), 4 + 14 * u, b.userData.r * (1 - u * 0.6));
        b.material.opacity = 0.55 * (1 - u);
      }
      // veil + board
      const vg = env.vignette;
      veil.visible = vg > 0.01; vigMat.uniforms.uAmt.value = vg;
      if (board && board.has) {
        const p = _v.set(-R * 0.62, 2.2, R * 0.84); env.toRoom(p, board.mesh.position); board.mesh.position.y = T.y + 0.2;
        const head = ctx.player.head;
        board.mesh.rotation.y = Math.atan2(head.x - board.mesh.position.x, head.z - board.mesh.position.z);
        board.mesh.visible = !inside && env.grow > 0.6;
      } else if (board) board.mesh.visible = false;
    },
    dispose() {
      for (const o of disposables) { try { o.dispose && o.dispose(); } catch (e) { /* ignore */ } }
      ctx.camera.remove(veil);
    },
  };
  return api;
}
