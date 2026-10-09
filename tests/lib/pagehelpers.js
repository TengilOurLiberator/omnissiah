// Page-side helpers (evaluated after the game booted; see T.load). Everything hangs off window.__qh.
(() => {
  const g = window.game, w = g.world, qa = window.__qa;
  const qh = window.__qh = {};
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  // Registry counts that must return to baseline after something is removed.
  qh.snap = () => {
    const k = (w.kit && w.kit.stats && w.kit.stats()) || {}, c = (w.combat && w.combat.stats && w.combat.stats()) || {};
    const p = (w.physics && w.physics.stats && w.physics.stats()) || {}, m = (w.models && w.models.stats && w.models.stats()) || {};
    let objs = 0, meshes = 0, lights = 0;
    g.scene.traverse((o) => { objs++; if (o.isMesh || o.isPoints || o.isLine) meshes++; if (o.isLight) lights++; });
    return {
      kit_actors: num(k.actors), kit_damageables: num(k.damageables), kit_bodies: num(k.bodies), kit_destructibles: num(k.destructibles),
      kit_obstacles: num(k.obstacles), kit_lights: num(k.lights), kit_particleSystems: num(k.particles),
      combat_fighters: num(c.fighters), combat_reserves: num(c.reserves),
      phys_bodies: num(p.bodies), phys_colliders: num(p.colliders), phys_joints: num(p.joints), phys_ragdolls: num(p.ragdolls), phys_characters: num(p.characters), phys_vehicles: num(p.vehicles),
      models_instancesLive: num(m.instancesLive), models_mixers: num(m.mixers), models_animated: num(m.animated),
      scene_objects: objs, scene_meshes: meshes, scene_lights: lights,
      weapons: (w.weapons && w.weapons.list ? w.weapons.list().length : 0),
    };
  };
  qh.diff = (a, b, tol = {}) => { const out = {}; for (const key of Object.keys(a)) { const d = (b[key] ?? 0) - a[key]; if (Math.abs(d) > (tol[key] ?? 0)) out[key] = d; } return out; };
  qh.visibleMeshes = (root) => {
    let n = 0;
    const walk = (o) => { if (!o.visible) return; if ((o.isMesh || o.isPoints || o.isLine) && (o.isInstancedMesh ? o.count > 0 : true)) n++; for (const c of o.children) walk(c); };
    walk(root); return n;
  };
  qh.envJson = () => { try { return JSON.stringify(w.env.snapshot()); } catch (e) { return 'ERR ' + e; } };
  qh.envDiff = (a, b) => { try { const A = JSON.parse(a), B = JSON.parse(b); for (const o of [A, B]) { if (o.terrain) delete o.terrain.rev; delete o.v; } const out = []; for (const key of Object.keys(A)) if (JSON.stringify(A[key]) !== JSON.stringify(B[key])) out.push(key); return out; } catch { return ['unparsable']; } };
  qh.broken = () => { const out = []; for (const p of g.renderer.info.programs || []) { const d = p.diagnostics; if (d && d.runnable === false) out.push(String(p.name) + ':' + String(p.cacheKey).slice(0, 40)); } return out; };
  qh.heap = () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : -1);
  qh.blockedTypes = (since = 0) => qa.blocked.slice(since).map((b) => b.type);
  qh.sentTypes = (since = 0) => qa.sent.slice(since).map((b) => b.type);
  // dispatch helpers
  qh.key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true }));
  qh.freezePlayer = (on) => { w.player.invulnerable = on ? Infinity : 0; };
  qh.faceForward = () => { g.camera.rotation.set(0, 0, 0); g.rig.rotation.set(0, 0, 0); };
  // ---- aiming / mouse (desktop emulation; the pointer lock is faked by __qa.lock)
  const V = g.THREE.Vector3;
  qh.aimAt = (x, y, z) => {
    const head = g.player.head, dx = x - head.x, dy = y - head.y, dz = z - head.z;
    g.camera.rotation.set(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz) - g.rig.rotation.y, 0);
  };
  qh.canvas = () => document.querySelector('canvas');
  qh.mouseDown = (button = 0) => qh.canvas().dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true }));
  qh.mouseUp = (button = 0) => window.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true }));
  qh.mouseMove = (cx, cy) => window.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, bubbles: true }));
  qh.hold = async (button, seconds) => { qa.lock(true); qh.mouseDown(button); await qa.wait(seconds); qh.mouseUp(button); await qa.waitFrames(2); };
  // screen position of a widget on a menu surface (win | launcher)
  qh.widgetScreen = (obj, wd, fx = 0.5) => {
    const s = obj.surf, r = obj.rectOf(wd);
    const v = new V((r.x + r.w * fx - s.w / 2) * s.mpp, (s.h / 2 - (r.y + r.h / 2)) * s.mpp, 0);
    s.mesh.localToWorld(v); v.project(g.camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight, ndcZ: v.z };
  };
  // real mouse click on a menu widget (pointer lock OFF so the menu's desktop pointer is used); returns whether the widget's click ran
  qh.realClick = async (obj, wd, fx = 0.5) => {
    qa.lock(false);
    const ptr = w.menu._t.ptr.right;
    let p = qh.widgetScreen(obj, wd, fx);
    for (let i = 0; i < 90 && (p.x < 2 || p.y < 2 || p.x > window.innerWidth - 2 || p.y > window.innerHeight - 2); i++) { await qa.waitFrames(1); p = qh.widgetScreen(obj, wd, fx); }
    if (p.x < 2 || p.y < 2 || p.x > window.innerWidth - 2 || p.y > window.innerHeight - 2) { try { w.menu._t.placeWindow(); } catch {} await qa.waitFrames(6); p = qh.widgetScreen(obj, wd, fx); qh.replaced = (qh.replaced || 0) + 1; }
    if (p.x < 0 || p.y < 0 || p.x > window.innerWidth || p.y > window.innerHeight) return { ok: false, why: 'offscreen', p };
    // the panel may still be gliding toward the player: keep re-aiming until the pointer is on this widget
    let hovered = false;
    for (let i = 0; i < 40 && !hovered; i++) { p = qh.widgetScreen(obj, wd, fx); qh.mouseMove(p.x, p.y); await qa.waitFrames(1); hovered = !!(ptr.wd && ptr.wd.key === wd.key); }
    if (!hovered) return { ok: false, why: 'pointer never hovered the widget', p, hoverKey: ptr.wd && ptr.wd.key, mode: ptr.mode };
    qh.mouseDown(0);
    for (let i = 0; i < 4; i++) { p = qh.widgetScreen(obj, wd, fx); qh.mouseMove(p.x, p.y); await qa.waitFrames(1); }
    qh.mouseUp(0); await qa.waitFrames(4);
    return { ok: true, p };
  };
  // ---- the awakening (core/intro.js)
  // Wait until the intro has started by itself (a new player): resolves true/false.
  // Also watches the Omnissiah for up to 6 game seconds after the start: qh.introHid = true when it was seen hidden ("darkness", the first
  // ~4 s of the script). The fast virtual clock runs game time during every CDP round trip, so a test cannot sample that window afterwards.
  qh.introHid = null;
  qh.waitIntroStart = async (maxGame = 40) => {
    const t0 = qa.gameTime; qh.introHid = false;
    while (!(w.intro && w.intro.running) && qa.gameTime - t0 < maxGame) await qa.wait(0.25);
    const started = !!(w.intro && w.intro.running);
    if (started) { const t1 = qa.gameTime; while (qa.gameTime - t1 < 6) { const o = g.scene.getObjectByName('module:core/oracle.js'); if (o && o.visible === false) { qh.introHid = true; break; } await qa.wait(0.1); } }
    return started;
  };
  // Skip the intro the supported way and wait until it has really finished; returns a small report.
  qh.skipIntro = async () => {
    const r = { wasRunning: !!(w.intro && w.intro.running) };
    r.skipReturned = w.intro ? w.intro.skip() : null;
    for (let i = 0; i < 60 && w.intro && w.intro.running; i++) await qa.wait(0.25);
    r.running = !!(w.intro && w.intro.running); r.done = !!(w.intro && w.intro.done);
    return r;
  };
  // Play the intro through with a "bot" that does what each wait asks for, using the wait metadata the story engine publishes
  // (intro.debug.waiting() -> [{ kind, label, bot, t }]). Real actions where cheap (aim at him, press M), the wait's own event otherwise.
  // A wait that is still open after `stuckAfter` game seconds is forced with debug.skipWait() and reported in `forced`.
  qh.playIntro = async ({ maxGame = 1200, stuckAfter = 30, stopAt = null } = {}) => {
    const I = w.intro, steps = [], forced = [], t0 = qa.gameTime; let key = '', keyT = qa.gameTime, acted = false, stoppedAt = null, walking = false;
    const stopRe = stopAt ? new RegExp(stopAt, 'i') : null;
    while (I.running && qa.gameTime - t0 < maxGame) {
      const waits = I.debug.waits().filter((x) => !x.done);
      const lw = waits.find((x) => x.bot && x.bot.type !== 'say') || waits.find((x) => x.bot) || waits[0];
      const k = lw ? lw.kind + '|' + lw.label : 'none';
      if (stopRe && lw && stopRe.test(lw.label || '')) { stoppedAt = lw.label; break; }
      if (walking && !(lw && lw.bot && lw.bot.type === 'walk')) { qh.key('keyup', 'KeyW'); walking = false; }
      if (k !== key) { key = k; keyT = qa.gameTime; acted = false; steps.push({ at: Math.round(qa.gameTime - t0), kind: lw && lw.kind, label: lw && lw.label, bot: lw && lw.bot && lw.bot.type }); }
      const b = lw && lw.bot;
      if (b && !acted && qa.gameTime - keyT > 0.4) {
        acted = true;
        if (b.type === 'look') { const p = w.oracle && w.oracle.position; if (p) qh.aimAt(p.x, p.y, p.z); acted = false; }   // keep aiming until the hold completes
        else if (b.type === 'event') { for (let i = 0; i < (b.times || 1); i++) g.events.emit(b.name, b.payload); }
        else if (b.type === 'walk') { qh.key('keydown', 'KeyW'); walking = true; }
        else if (b.type === 'menu') { qh.key('keydown', 'KeyM'); qh.key('keyup', 'KeyM'); }
        // (intro.debug.killFoes() throws: it assigns the getter-only fighter.hp; do the real thing instead: a lethal hit on each live enemy)
        else if (b.type === 'kill') { for (const f of [...(w.combat.fighters ?? [])]) if (f.faction === 'enemy' && f.alive) { try { w.kit.hit(f.actor.group.position, 1.6, 99999, { from: 'player' }); } catch { /* gone */ } } acted = false; }
      }
      if (lw && !['say', 'delay', 'tick', 'glitch', 'near'].includes(lw.kind) && !(b && b.type === 'sleep') && qa.gameTime - keyT > stuckAfter && qa.gameTime - keyT < 1e9) {
        forced.push(k); I.debug.skipWait(); keyT = qa.gameTime;
      }
      await qa.wait(0.25);
    }
    if (walking) qh.key('keyup', 'KeyW');
    return { steps, forced, stoppedAt, gameSeconds: Math.round(qa.gameTime - t0), stillRunning: !!I.running, done: !!I.done };
  };
  window.__qaLoaded = true;
})();



