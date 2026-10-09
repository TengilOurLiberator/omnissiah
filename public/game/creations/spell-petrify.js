// Spell: Petrify (HOLD the trigger on an enemy). A cold grey gaze: while you keep the enemy in your sights it stiffens (slower and
// slower, a stone shell creeping over it), and after 1.5 s it is a statue for 7 seconds: rooted, harmless, hp untouched. Look away
// early and it thaws. A statue is brittle: any heavy blow (hammer, explosion, shove) shatters it for 30 bonus damage. Bosses resist.
export const meta = { name: 'Petrify', description: 'Spell (hold): stare an enemy into a brittle statue.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xb9c4a8, GAZE = 1.5, STONE = 7, N = 4;
  const P = { on: 0, s: null, said: 0 };
  const tmp = new THREE.Vector3(), rel = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const slots = [];

  const box = new THREE.BoxGeometry(1, 1, 1), ball = new THREE.SphereGeometry(1, 10, 8);
  for (let i = 0; i < N; i++) { // a unit-height stone person, scaled to the victim
    const mat = new THREE.MeshLambertMaterial({ color: 0xb9b5a8, emissive: 0x3a3a34, flatShading: true, transparent: true, opacity: 0 }), g = new THREE.Group();
    const part = (geo, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.userData.noShadow = true; g.add(m); };
    part(box, 0.36, 0.42, 0.2, 0, 0.64, 0); part(box, 0.3, 0.44, 0.17, 0, 0.22, 0); part(ball, 0.12, 0.13, 0.12, 0, 0.9, 0); part(box, 0.08, 0.36, 0.09, 0.24, 0.64, 0); part(box, 0.08, 0.36, 0.09, -0.24, 0.64, 0);
    g.visible = false; ctx.root.add(g);
    slots.push({ f: null, a: null, g, mat, state: 0, prog: 0, t: 0, s0: 1, ap: 1, h: 1.6 });
  }
  const lineG = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const lineM = new THREE.LineBasicMaterial({ color: 0xdfe8c8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const gaze = new THREE.Line(lineG, lineM); gaze.frustumCulled = false; gaze.visible = false; gaze.userData.noShadow = true; ctx.root.add(gaze);
  const reM = new THREE.MeshBasicMaterial({ color: 0xe8f0d0, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), reM); reticle.visible = false; reticle.renderOrder = 50; reticle.userData.noShadow = true; ctx.root.add(reticle);
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of [lineM, reM]) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const dust = kit.particles(ctx, { count: 280, additive: false, color: [0xb0aaa0, 0x6a655c], alpha: 0.5, size: [0.2, 0.7], life: [0.5, 1.2], speed: [0.4, 2], gravity: 0.6, drag: 1.5 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });

  function pick(origin, dir) {
    const F = ctx.world.combat?.fighters;
    let best = null, bd = 1e9;
    if (F) for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (!f.alive || f.faction !== 'enemy') continue;
      const A = f.actor; rel.set(A.position.x - origin.x, A.position.y + (A.height ?? 1.5) * 0.5 - origin.y, A.position.z - origin.z);
      const along = rel.dot(dir);
      if (along < 0.4 || along > 24) continue;
      const perp = rel.lengthSq() - along * along, reach = 0.8 + along * 0.07;
      if (perp < reach * reach && perp < bd) { bd = perp; best = f; }
    }
    return best;
  }
  function release(s, shatter) {
    const A = s.a;
    if (A && !A.removed) { if (Math.abs(A.speed - s.ap) < 1e-6) A.speed = s.s0; A.staggerT = 0; tmp.set(A.position.x, A.position.y + s.h * 0.5, A.position.z); dust.emit(tmp, shatter ? 36 : 14, undefined, 1.2); if (shatter) kit.debris?.(tmp, { material: 'stone', count: 10, power: 4 }); }
    s.f = null; s.a = null; s.state = 0; s.g.visible = false;
  }
  function centre(s, out) { return out.set(s.a.position.x, s.a.position.y + s.h * 0.55, s.a.position.z); }
  function cast({ origin, direction, dt, first }) {
    P.on = 0.12;
    let s = P.s;
    if (first) s = null;
    if (s && (!s.f || !s.f.alive || s.state === 0)) s = null;
    if (s) { rel.subVectors(centre(s, tmp), origin); const al = rel.dot(direction); if (al < 0.3 || rel.lengthSq() - al * al > 1.6 + al * al * 0.01) s = null; } // looked away
    if (!s) {
      const f = pick(origin, direction);
      if (f && f.maxHp > 140) { if (P.said <= 0) { f.actor.say?.('Hmph.', 1.2); P.said = 2; } } else if (f) {
        s = slots.find((q) => q.f === f) ?? slots.find((q) => !q.f);
        if (s && s.f !== f) { s.f = f; s.a = f.actor; s.s0 = f.actor.speed; s.ap = s.s0; s.state = 1; s.prog = 0; s.h = f.actor.height ?? 1.6; s.g.visible = true; s.mat.opacity = 0; if (!sfx('wraith-whisper', f.actor.position)) snd.tone({ freq: 300, freqEnd: 180, dur: 0.4, vol: 0.08 }); }
      }
    }
    P.s = s;
    if (s && s.state === 1) { s.prog = Math.min(1, s.prog + dt / GAZE); a.copy(origin); centre(s, b); }
    else if (s) { a.copy(origin); centre(s, b); }
    if (s) { lineG.attributes.position.setXYZ(0, a.x, a.y, a.z); lineG.attributes.position.setXYZ(1, b.x, b.y, b.z); lineG.attributes.position.needsUpdate = true; }
    gaze.visible = !!s && s.state === 1;
    kit.haptic?.('right', 0.12 + 0.3 * (s ? s.prog : 0), 30);
  }
  function onRelease() { P.on = 0; P.s = null; gaze.visible = false; }

  ctx.on('kit:hit', (e) => { // a statue is brittle
    if (!e.point || (e.kind !== 'blunt' && e.kind !== 'explosion') || !(e.amount >= 8)) return;
    for (let i = 0; i < N; i++) {
      const s = slots[i];
      if (s.state !== 2 || !s.a || s.a.removed) continue;
      centre(s, tmp);
      if (tmp.distanceTo(e.point) <= (e.radius || 0) + 0.8) { s.f.damage.hit(30, e.point, 'player', null, 'blunt'); release(s, true); sfx('break-stone', e.point); kit.haptic?.('right', 0.6, 60); }
    }
  });

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'petrify', name: 'Petrify', color: COLOR, icon: '🗿', hold: true, description: 'Hold your gaze on an enemy: it turns to brittle stone.', cast, onRelease }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); for (const s of slots) if (s.f) release(s, false); });

  return {
    update(dt, t) {
      blendFix();
      P.on -= dt; P.said -= dt;
      const gazing = P.on > 0;
      reticle.visible = gazing && !!P.s && P.s.state === 1;
      for (let i = 0; i < N; i++) {
        const s = slots[i];
        if (s.state === 0) continue;
        const A = s.a, f = s.f;
        if (!f || !f.alive || !A || A.removed || A.dead) { release(s, false); continue; }
        s.g.position.set(A.position.x, A.position.y, A.position.z); s.g.rotation.y = A.yaw; s.g.scale.set(s.h * 1.35, s.h, s.h * 1.35); // (a little wider than the body it entombs)
        if (s.state === 1) {
          if (!(gazing && P.s === s)) { s.prog -= dt * 1.2; if (s.prog <= 0) { release(s, false); continue; } }
          if (Math.abs(A.speed - s.ap) > 1e-6) s.s0 = A.speed; // a behaviour changed its speed: slow from the new value
          const k = 1 - 0.92 * s.prog, d1 = dt * (1 - k);
          A.speed = s.s0 * k; s.ap = A.speed; f.atkCd += d1; f.windT += d1; if (A.atkT > 0) A.atkT = Math.max(0, A.atkT - d1);
          s.mat.opacity = 0.7 * s.prog; if (Math.random() < dt * 14 * s.prog) dust.emit(tmp.set(A.position.x, A.position.y + s.h * Math.random(), A.position.z), 1);
          if (s.prog >= 1) {
            s.state = 2; s.t = 0; A.speed = 0; s.ap = 0; centre(s, tmp); dust.emit(tmp, 40, undefined, 1.4);
            kit.flash(ctx, tmp, { color: 0xc8d0b8, intensity: 25, distance: 8, duration: 0.3 });
            if (!sfx('golem-rumble', tmp)) snd.noise({ dur: 0.6, filter: { type: 'lowpass', freq: 500, freqEnd: 90, q: 1 }, vol: 0.5, at: tmp });
            kit.haptic?.('right', 0.8, 90);
          }
        } else {
          s.t += dt; A.staggerT = Math.max(A.staggerT, 0.3); A.speed = 0; s.mat.opacity = 0.92;
          if (s.t > STONE - 1.5) s.g.position.x += Math.sin(t * 60) * 0.015; // trembling: the spell is giving out
          if (s.t >= STONE) release(s, true);
        }
      }
      if (reticle.visible && P.s) {
        centre(P.s, tmp); reticle.position.copy(tmp).y += P.s.h * 0.55; reticle.lookAt(ctx.player.head); reticle.scale.setScalar(0.9 - 0.55 * P.s.prog); reM.opacity = 0.4 + 0.5 * P.s.prog;
      }
    },
  };
}
