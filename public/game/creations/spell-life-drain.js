// Spell: Life Drain (HOLD the trigger). A crimson tether leaps from your hand to the enemy in your sights and siphons its life
// into yours: it takes magic damage every tick and you heal 60% of what it actually lost. Aim away and the tether frays and
// finds nothing. Channelled beam: cast() runs every frame; the target is locked while it stays in range.
export const meta = { name: 'Life Drain', description: 'Spell (hold): siphon health from an enemy.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const HOSTILE = { hostileTo: 'friendly' };
  const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // (Math.hypot allocates in hot loops)
  const COLOR = 0xd0203c, SEG = 16, TICK = 0.18, DPS = 15, FROM = { from: 'player', kind: 'magic', force: 0, direction: undefined };
  const D = { f: null, tick: 0, beat: 0, on: 0, acc: 0, k: 0, t: 0, dealt: 0 };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), rel = new THREE.Vector3(), dv = new THREE.Vector3(), q = new THREE.Vector3(), chest = new THREE.Vector3(), up = new THREE.Vector3(0, 1.3, 0);
  const mr = () => (ctx.input.passthrough ? 0.5 : 1);

  const STR = 5, pos = new Float32Array(STR * SEG * 2 * 3);
  const geo = new THREE.BufferGeometry(), pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa); geo.setDrawRange(0, 0);
  const lineM = new THREE.LineBasicMaterial({ color: 0xff3050, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const tether = new THREE.LineSegments(geo, lineM); tether.frustumCulled = false; tether.userData.noShadow = true; ctx.root.add(tether);
  const orbM = new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), orbM); orb.visible = false; orb.userData.noShadow = true; ctx.root.add(orb);
  const src = new THREE.Mesh(orb.geometry, orbM); src.visible = false; src.userData.noShadow = true; ctx.root.add(src); // glow where the tether leaves your hand
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of [lineM, orbM]) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const motes = kit.particles(ctx, { count: 360, color: [0xffd0d8, 0xb0102c], size: [0.26, 0.05], life: [0.3, 0.6], speed: [0.1, 0.6], drag: 1.2 });
  const green = kit.particles(ctx, { count: 160, color: [0xe8ffe8, 0x40e080], size: [0.12, 0.02], life: [0.6, 1.1], speed: [0.1, 0.4], gravity: -1.2 });
  const snd = kit.sound(ctx);
  const sfx = (n, at) => ctx.world.audio?.sfx(n, { at });
  const pulseFb = (at) => snd.tone({ freq: 70, freqEnd: 45, dur: 0.22, vol: 0.3, at });
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 7 });

  function pick(origin, dir) { // enemy nearest to the aim ray (forgiving cone)
    const F = ctx.world.combat?.fighters;
    if (!F) { const t = kit.nearestTarget(q.copy(origin).addScaledVector(dir, 6), 4, HOSTILE); return t && t.fighter ? t.fighter : null; }
    let best = null, bd = 1e9;
    for (let i = 0; i < F.length; i++) {
      const f = F[i];
      if (!f.alive || f.faction !== 'enemy') continue;
      const A = f.actor; rel.set(A.position.x - origin.x, A.position.y + (A.height ?? 1.5) * 0.5 - origin.y, A.position.z - origin.z);
      const along = rel.dot(dir);
      if (along < 0.4 || along > 16) continue;
      const perp = rel.lengthSq() - along * along, reach = 0.8 + along * 0.07;
      if (perp < reach * reach && perp < bd) { bd = perp; best = f; }
    }
    return best;
  }
  function chestPos(out) { const h = ctx.player.head; return out.set(h.x, h.y - 0.35, h.z); }

  function cast({ origin, direction, dt, first }) {
    D.on = 0.15; D.t += dt;
    if (first) { D.f = null; sfx('wraith-whisper', origin); }
    if (D.f && (!D.f.alive || hyp(D.f.actor.position.x - origin.x, D.f.actor.position.z - origin.z) > 20)) D.f = null;
    if (!D.f) { D.f = pick(origin, direction); if (D.f) { D.beat = 0; sfx('monster-bite', D.f.actor.position); } }
    a.copy(origin);
    if (D.f) {
      const A = D.f.actor; b.set(A.position.x, A.position.y + (A.height ?? 1.5) * 0.6, A.position.z);
      D.k = Math.min(1, D.k + dt * 6);
    } else { b.copy(origin).addScaledVector(direction, 2.5 * mr()); D.k = Math.max(0.25, D.k - dt * 3); } // a frayed stub finds nothing
    D.tick -= dt;
    if (D.f && D.tick <= 0) {
      D.tick = TICK;
      const f = D.f, hp0 = f.hp;
      FROM.direction = dv.subVectors(b, a).normalize();
      kit.hit(b, 0.4, DPS * TICK, FROM);
      D.dealt = Math.max(0, hp0 - f.hp);
      const P = ctx.world.player;
      if (D.dealt > 0 && P) { if (P.heal) P.heal(D.dealt * 0.6); else if (typeof P.health === 'number') P.health = Math.min(P.maxHealth ?? 100, P.health + D.dealt * 0.6); }
      kit.haptic?.('right', 0.3, 35);
      motes.emit(b, 5, undefined, 0.8);
    }
    D.beat -= dt;
    if (D.f && D.beat <= 0) { D.beat = 0.62; if (!sfx('heartbeat', b)) pulseFb(b); }
    // motes stream from the victim to you, green sparks bloom on your chest
    D.acc += dt * 150; const n = D.acc | 0; D.acc -= n;
    for (let i = 0; i < n && D.f; i++) { q.lerpVectors(b, a, Math.random() * 0.5); dv.subVectors(a, b).multiplyScalar(2.2); motes.emit(q, 1, dv, 0.5); }
    if (D.f && Math.random() < dt * 22) green.emit(chestPos(chest), 1, up);
    glow.position.copy(b); glow.intensity = D.f ? 8 : 0;
  }
  function onRelease() {
    D.f = null; D.on = 0; glow.intensity = 0;
    if (!sfx('heal-chime', ctx.player.head)) snd.tone({ freq: 400, freqEnd: 120, dur: 0.3, type: 'sine', vol: 0.12 });
  }

  function draw(t) { // 3 strands: same curve, different wobble phase; one vertex pair per segment
    let w = 0;
    const sag = 0.35 * Math.min(1, a.distanceTo(b) / 6);
    for (let s = 0; s < STR; s++) {
      const amp = (s === 0 ? 0.03 : 0.1) * (D.f ? 1 : 3), ph = t * (9 + s * 3) + s * 2;
      let px = a.x, py = a.y, pz = a.z;
      for (let k = 1; k <= SEG; k++) {
        const u = k / SEG, e = Math.sin(Math.PI * u), wob = Math.sin(u * 18 - ph) * amp * e;
        const x = a.x + (b.x - a.x) * u + wob, y = a.y + (b.y - a.y) * u - e * sag + Math.cos(u * 14 - ph) * amp * e, z = a.z + (b.z - a.z) * u - wob;
        pos[w++] = px; pos[w++] = py; pos[w++] = pz; pos[w++] = x; pos[w++] = y; pos[w++] = z;
        px = x; py = y; pz = z;
      }
    }
    geo.setDrawRange(0, w / 3); pa.needsUpdate = true;
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'life-drain', name: 'Life Drain', color: COLOR, icon: '🩸', hold: true, description: 'Hold: siphon an enemy\'s life into your own.', cast, onRelease }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      D.on -= dt; blendFix();
      const live = D.on > 0;
      tether.visible = live; orb.visible = live && !!D.f;
      if (!live) { D.f = null; glow.intensity = 0; src.visible = false; return; }
      lineM.opacity = 0.35 + 0.6 * D.k;
      draw(t);
      if (orb.visible) { orb.position.copy(b); orb.scale.setScalar((0.5 + Math.sin(t * 14) * 0.08) * mr()); src.visible = true; src.position.copy(a); src.scale.setScalar((0.07 + Math.sin(t * 20) * 0.015) * mr()); } else src.visible = false;
    },
  };
}
