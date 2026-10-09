// mr/palette.js — the wrist palette: eight round buttons on the back of the LEFT hand (controller: floating above it; desktop simulation: pinned
// in the lower left of the view). Poke with the right fingertip / controller tip, or point and click. Slot 0 cycles the mode, slots 1-5 are the
// mode's own buttons (summon favourites, towers, armies...), 6 = step in / out, 7 = reset the table. Tapping a summon ARMS it: a pinch over the
// table drops it there. Also registers a "Table" page in world.menu when the menu exists (full favourites picker, scale and height sliders).
export default function (env) {
  const { THREE, ctx, roomGroup, S, T, world, input } = env;
  const { Vector3, Mesh } = THREE;
  const W = 0.112, Hh = 0.056, CW = 512, CH = 256;
  const clamp = THREE.MathUtils.clamp;
  const hasDoc = typeof document !== 'undefined' && !!document.createElement;
  let cv = null, g = null, tex = null, mesh = null;
  const mat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide });
  if (hasDoc) {
    try {
      cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; g = cv.getContext('2d');
      tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
      mat.map = tex;
    } catch (e) { cv = g = tex = null; }
  }
  mesh = new Mesh(new THREE.PlaneGeometry(W, Hh), mat);
  mesh.renderOrder = 900; mesh.visible = false; mesh.frustumCulled = false; mesh.userData.noShadow = mesh.userData.noOutline = mesh.userData.noCull = true;
  roomGroup.add(mesh);

  const slots = new Array(8).fill(null);
  let hover = -1, pressed = -1, pressT = 0, dirtyFlag = true, capturing = null, lastDraw = 0, shown = false;
  const poke = { left: { d: 9, cell: -1, inside: false, cd: 0 }, right: { d: 9, cell: -1, inside: false, cd: 0 } };

  function build() {
    const M = env.parts.modes, mr = world.mr;
    const mid = M && M.id ? M.id : S.mode;
    const items = M && M.items ? M.items().slice(0, 5) : [];
    slots[0] = { icon: (M && M.icons[mid]) || '🌍', label: (M && M.titles[mid]) || 'mode', color: '#ffd877', onTap() { M && M.next(); } };
    for (let i = 0; i < 5; i++) slots[1 + i] = items[i] ?? null;
    slots[6] = { icon: env.inside ? '⬇' : '⬆', label: env.inside ? 'step out' : 'step in', color: '#a8e6ff', onTap() { mr && mr.stepIn(!env.inside); } };
    slots[7] = { icon: '⟲', label: 'reset', color: '#ff9f8a', onTap() { mr && mr.reset(); } };
  }
  function roundRect(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function draw() {
    if (!g) return;
    build();
    g.clearRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(12,14,36,0.78)'; roundRect(2, 2, CW - 4, CH - 4, 26); g.fill();
    g.strokeStyle = 'rgba(160,170,255,0.55)'; g.lineWidth = 3; g.stroke();
    const cw = (CW - 20) / 4, ch = (CH - 20) / 2;
    for (let i = 0; i < 8; i++) {
      const s = slots[i], cx = 10 + (i % 4) * cw, cy = 10 + ((i / 4) | 0) * ch;
      const hot = i === hover, down = i === pressed;
      g.fillStyle = down ? 'rgba(255,216,119,0.55)' : hot ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.08)';
      roundRect(cx + 4, cy + 4, cw - 8, ch - 8, 18); g.fill();
      if (!s) continue;
      const act = s.active && s.active(), dis = s.disabled && s.disabled();
      if (act) { g.strokeStyle = '#ffd877'; g.lineWidth = 5; roundRect(cx + 4, cy + 4, cw - 8, ch - 8, 18); g.stroke(); }
      g.globalAlpha = dis ? 0.35 : 1;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '56px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif'; g.fillStyle = '#fff';
      g.fillText(s.icon, cx + cw / 2, cy + ch * 0.42);
      g.font = '700 21px sans-serif'; g.fillStyle = s.color || '#fff';
      g.fillText(String(s.label).slice(0, 12), cx + cw / 2, cy + ch * 0.82);
      g.globalAlpha = 1;
    }
    tex.needsUpdate = true;
  }

  // ---- placement
  const _a = new Vector3(), _b = new Vector3(), _n = new Vector3(), _l = new Vector3(), _q = new THREE.Quaternion();
  const hv = new Vector3(), ri = new Vector3(), up = new Vector3(0, 1, 0);
  function place() {
    const head = ctx.player.head, L = input.left;
    let ok = false;
    const ov = env.parts.hands && env.parts.hands.hands ? env.parts.hands.hands.left : null;
    if (ov && ov.valid && ov.kind === 'hand') {
      const F = L.fingers;
      _a.copy(F.palmNormal).negate();                                   // out of the back of the hand
      hv.copy(head).sub(F.palm).normalize();
      if (_a.dot(hv) > 0.3) { mesh.position.copy(F.wrist).addScaledVector(_a, 0.085).addScaledVector(_b.copy(F.palm).sub(F.wrist).normalize(), -0.02); ok = true; }
    } else if (ov && ov.valid && ov.kind === 'script') { mesh.position.copy(ov.palm).add(_a.set(0, 0.08, 0)); ok = true; }
    else if (ov && ov.valid && ov.kind === 'controller') { mesh.position.copy(L.position).add(_a.set(0, 0.1, 0)); ok = true; }
    else if (!ctx.input.presenting || (ov && ov.kind === 'mouse')) {
      ctx.camera.updateWorldMatrix(true, false);
      mesh.position.set(-0.16, -0.115, -0.42).applyMatrix4(ctx.camera.matrixWorld); ok = true;
    }
    mesh.visible = ok && env.grow > 0.4;
    if (!mesh.visible) return;
    // billboard to the head, upright-ish
    mesh.lookAt(head);
  }
  const _b2 = new THREE.Matrix4();

  // ---- hit tests: a point (poke) or a ray (point & click) against the palette plane
  function cellAt(local) { // local = point in the panel's own frame
    const u = (local.x + W / 2) / W, v = 1 - (local.y + Hh / 2) / Hh;
    if (u < 0 || u > 1 || v < 0 || v > 1) return -1;
    const c = Math.min(3, (u * 4) | 0), r = Math.min(1, (v * 2) | 0);
    return r * 4 + c;
  }
  function toLocal(p, out) { mesh.updateMatrixWorld(true); return out.copy(p).applyMatrix4(_b2.copy(mesh.matrixWorld).invert()); }
  function tap(i) {
    const s = slots[i]; if (!s) return false;
    if (s.disabled && s.disabled()) return false;
    pressed = i; pressT = 0.18; dirtyFlag = true;
    try { s.onTap && s.onTap(); } catch (err) { console.error('[mr] palette tap', err); }
    dirtyFlag = true;
    ctx.events.emit('mr:palette', { slot: i, id: s.id });
    return true;
  }

  const api = {
    get capturing() { return capturing; },
    slots, tap, dirty() { dirtyFlag = true; },
    get mesh() { return mesh; },
    enter() { dirtyFlag = true; registerMenu(); },
    exit() { mesh.visible = false; capturing = null; hover = -1; unregisterMenu(); },
    update(dt, t) {
      if (!env.active) return;
      build();
      place();
      capturing = null;
      if (mesh.visible) {
        const Hn = env.parts.hands && env.parts.hands.hands;
        let nh = -1;
        for (const n of ['right', 'left']) {
          const h = Hn && Hn[n];
          if (!h || !h.valid || h.mode !== 'idle') { poke[n].d = 9; continue; }
          const pk = poke[n]; pk.cd -= dt;
          if (h.kind === 'mouse') {
            if (n !== 'right') continue;
            mesh.updateMatrixWorld(true);
            _n.set(0, 0, 1).transformDirection(mesh.matrixWorld);
            const o = ctx.player.head, d = h.dir, dn = d.dot(_n);
            if (Math.abs(dn) < 1e-4) continue;
            const tt = _a.copy(mesh.position).sub(o).dot(_n) / dn;
            if (tt <= 0) continue;
            toLocal(_b.copy(o).addScaledVector(d, tt), _l);
            const c = cellAt(_l);
            if (c >= 0) { capturing = n; nh = c; if (h.trigP && pk.cd <= 0) { pk.cd = 0.4; tap(c); } }
            continue;
          }
          // fingertip / controller tip poke
          if (n !== 'right') continue;
          toLocal(h.tip, _l);
          const c = Math.abs(_l.z) < 0.07 ? cellAt(_l) : -1;
          if (c >= 0) {
            capturing = n; nh = c;
            const entering = pk.d > 0.014 && _l.z <= 0.014 && _l.z > -0.05;
            if (entering && pk.cd <= 0) { pk.cd = 0.45; tap(c); }
          }
          pk.d = Math.abs(_l.z) < 0.15 ? _l.z : 9;
        }
        if (nh !== hover) { hover = nh; dirtyFlag = true; }
      }
      if (pressT > 0) { pressT -= dt; if (pressT <= 0) { pressed = -1; dirtyFlag = true; } }
      if (dirtyFlag || t - lastDraw > 0.5) { if (t - lastDraw > 0.07) { lastDraw = t; dirtyFlag = false; draw(); } }
    },
    dispose() { unregisterMenu(); roomGroup.remove(mesh); mesh.geometry.dispose(); mat.dispose(); tex && tex.dispose(); },
  };

  // ---- world.menu page
  let menuOff = null, menuRef = null;
  function registerMenu() {
    const menu = world.menu;
    if (!menu || !menu.register || menuRef === menu) return;
    unregisterMenu();
    try {
      menuOff = menu.register({
        id: 'mr', title: 'Table', icon: 'map',
        sig: () => `${S.mode}|${T.s.toFixed(3)}|${T.y.toFixed(2)}|${(S.favs || []).join(',')}`,
        build(ui) {
          const mr = world.mr, M = env.parts.modes;
          ui.heading('Mixed reality table');
          ui.choice((M ? M.list() : []).map((m) => ({ id: m.id, label: M.titles[m.id] })), () => S.mode, (id) => { mr && mr.setMode(id); ui.refresh(); }, { label: 'Mode' });
          ui.slider('Scale  1 : N', { min: 10, max: 50, step: 1, get: () => Math.round(1 / (S.sBase || 0.05)), set: (v) => mr && mr.setScaleBase(1 / v), fmt: (v) => `1:${v}` });
          ui.slider('Table height (cm)', { min: 40, max: 120, step: 5, get: () => Math.round(T.y * 100), set: (v) => { T.y = v / 100; S.tableH = T.y; S.onSurface = false; S.userMoved = true; }, fmt: (v) => `${v}` });
          ui.row(() => {
            ui.button('Reset table', () => mr && mr.reset(), {});
            ui.button(env.inside ? 'Step out' : 'Step in', () => { mr && mr.stepIn(!env.inside); ui.refresh(); }, { kind: 'primary' });
          });
          ui.divider();
          ui.text('Summon favourites (tap to star, max 5)', { size: 12, color: '#a4abdc' });
          const L = world.library;
          const names = L && L.list ? L.list().filter((e) => ['enemies', 'allies', 'life', 'structures', 'nature', 'props'].includes(e.category)).map((e) => e.name) : [];
          ui.grid(names, { id: 'mrfav', cols: 3, rows: 4, tile: (n) => ({ title: n, active: (S.favs || []).includes(n), h: 40, onClick: () => toggleFav(n) }) });
        },
      });
      menuRef = menu;
    } catch (err) { console.warn('[mr] menu page failed', err); }
  }
  function toggleFav(n) {
    let f = Array.isArray(S.favs) ? S.favs.slice() : [];
    const i = f.indexOf(n);
    if (i >= 0) f.splice(i, 1); else { f.push(n); if (f.length > 5) f.shift(); }
    S.favs = f;
    try { localStorage.setItem('omni.mr.fav', JSON.stringify(f)); } catch (e) { /* private mode */ }
    const M = env.parts.modes; if (M && M.id === 'gods-table') M.restart();
    dirtyFlag = true;
  }
  function unregisterMenu() { try { menuOff && menuOff(); } catch (e) { /* gone */ } menuOff = null; menuRef = null; }
  ctx.on('module:loaded', (e) => { if (env.active && e && e.path === 'core/menu.js') { menuRef = null; registerMenu(); } });
  return api;
}
