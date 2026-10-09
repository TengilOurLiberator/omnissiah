// Spell: Storm Cloud. A brooding thunderhead gathers above your head and trails you for 18 seconds. Every second or so it marks
// an enemy near you with a crackling ring, rumbles, and half a heartbeat later a bolt hammers that spot (shock damage + a shove).
// With nobody to strike it still flickers and rains. Recasting renews it. In mixed reality it hangs low and small.
export const meta = { name: 'Storm Cloud', description: 'Spell: a thunderhead that follows you and smites nearby enemies.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const HOSTILE = { hostileTo: 'friendly' };
  const COLOR = 0x8fb0ff, LIFE = 18, SEG = 11, BOLTS = 4, FROM = { from: 'player', kind: 'shock', force: 4, direction: undefined };
  const S = { t: -1, next: 1, wait: 0, mark: false, hx: 0, hy: 0, hz: 0, grow: 0, flick: 0, rain: 0, lastT: 0 };
  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), cp = new THREE.Vector3();
  const mr = () => (ctx.input.passthrough ? 0.35 : 1);

  const cloud = new THREE.Group(); cloud.visible = false; ctx.root.add(cloud);
  const puffG = new THREE.IcosahedronGeometry(1, 1), puffM = new THREE.MeshLambertMaterial({ color: 0x2c303f, emissive: 0x05070f, flatShading: true });
  const puffs = [];
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(puffG, puffM), a = (i / 9) * 6.283 + (i % 2) * 0.4, r = i === 0 ? 0 : 0.9 + (i % 3) * 0.45;
    m.position.set(Math.cos(a) * r, (i % 3) * 0.12 - 0.1, Math.sin(a) * r); m.scale.set(1.2 + (i % 4) * 0.2, 0.6 + (i % 3) * 0.1, 1.2 + ((i + 1) % 4) * 0.2); m.userData.noShadow = true; m.userData.p = m.position.y;
    cloud.add(m); puffs.push(m);
  }
  const flashM = new THREE.MeshBasicMaterial({ color: 0xdce8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const flashMesh = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8), flashM); flashMesh.scale.y = 0.45; flashMesh.userData.noShadow = true; cloud.add(flashMesh);
  const ringM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 36).rotateX(-Math.PI / 2), ringM); ring.visible = false; ring.userData.noShadow = true; ctx.root.add(ring);
  const lineM = new THREE.LineBasicMaterial({ color: 0xeaf2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const pos = new Float32Array(BOLTS * 2 * SEG * 6), geo = new THREE.BufferGeometry(), pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa); geo.setDrawRange(0, 0);
  const bolt = new THREE.LineSegments(geo, lineM); bolt.frustumCulled = false; bolt.userData.noShadow = true; ctx.root.add(bolt);
  const bolts = []; for (let i = 0; i < BOLTS; i++) bolts.push({ life: 0, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 });
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of [flashM, ringM, lineM]) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const rain = kit.particles(ctx, { count: 500, color: [0xd0e0ff, 0x7090ff], size: [0.05, 0.03], life: [0.4, 0.7], speed: 0, gravity: 22, drag: 0.05, alpha: 0.6 });
  const sparks = kit.particles(ctx, { count: 220, color: [0xffffff, 0x6a8cff], size: [0.14, 0.02], life: [0.2, 0.6], speed: [2, 7], gravity: 8, drag: 0.8 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 14 });

  function cast() {
    const k = mr(), h = ctx.player.head;
    const fresh = S.t < 0;
    S.t = 0; S.grow = fresh ? 0 : S.grow; S.next = 0.9; S.mark = false;
    if (fresh) { S.hx = h.x; S.hz = h.z; S.hy = ctx.player.feet.y + 5.5 * k; }
    cloud.visible = true;
    if (!sfx('thunder-crack', h)) snd.noise({ dur: 1, filter: { type: 'lowpass', freq: 400, freqEnd: 60, q: 0.8 }, vol: 0.5 });
    kit.haptic?.('left', 0.4, 80); kit.haptic?.('right', 0.5, 80);
  }
  function strike(x, z, harm) {
    const y = ctx.groundAt(x, z);
    let b = bolts[0]; for (let i = 0; i < BOLTS; i++) { if (bolts[i].life <= 0) { b = bolts[i]; break; } if (bolts[i].life < b.life) b = bolts[i]; }
    b.life = 0.28; b.x = cloud.position.x + (Math.random() - 0.5) * 0.8; b.y = cloud.position.y - 0.2; b.z = cloud.position.z + (Math.random() - 0.5) * 0.8; b.tx = x; b.tz = z; b.ty = y;
    at.set(x, y + 0.2, z);
    if (harm) { FROM.direction = up; kit.hit(at, 2.3, 18, FROM); kit.scorch(at, 1.2); }
    sparks.emit(at, 22); kit.flash(ctx, at, { color: 0xbcd0ff, intensity: 70, distance: 18, duration: 0.3 });
    S.flick = 1;
    if (!sfx('lightning-zap', at)) snd.noise({ dur: 0.3, filter: { type: 'highpass', freq: 1800, q: 0.8 }, vol: 0.5, at });
    snd.noise({ dur: 0.9, filter: { type: 'lowpass', freq: 500, freqEnd: 60, q: 0.7 }, vol: 0.5, at, delay: 0.1 });
    kit.haptic?.('right', 0.4, 50);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'storm-cloud', name: 'Storm Cloud', color: COLOR, icon: '⛈️', rate: 1, description: 'A thunderhead that follows you and smites enemies.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      let w = 0;
      for (let i = 0; i < BOLTS; i++) { // jagged bolts: two strands each, re-jittered every frame
        const b = bolts[i];
        if (b.life <= 0) continue;
        b.life -= dt;
        for (let s = 0; s < 2; s++) {
          let px = b.x, py = b.y, pz = b.z;
          for (let k = 1; k <= SEG; k++) {
            const u = k / SEG, j = Math.sin(Math.PI * u) * (s ? 1.2 : 0.55);
            const x = b.x + (b.tx - b.x) * u + (Math.random() - 0.5) * j, y = b.y + (b.ty - b.y) * u, z = b.z + (b.tz - b.z) * u + (Math.random() - 0.5) * j;
            pos[w++] = px; pos[w++] = py; pos[w++] = pz; pos[w++] = x; pos[w++] = y; pos[w++] = z; px = x; py = y; pz = z;
          }
        }
      }
      geo.setDrawRange(0, w / 3); pa.needsUpdate = true; bolt.visible = w > 0; lineM.opacity = 0.9;
      if (S.t < 0) return;
      S.t += dt;
      const k = mr(), h = ctx.player.head, life = Math.min(1, (LIFE - S.t) / 1.2);
      S.grow = Math.min(1, S.grow + dt * 1.4);
      const g = Math.min(S.grow, Math.max(0, life));
      S.hx += (h.x - S.hx) * Math.min(1, dt * 1.6); S.hz += (h.z - S.hz) * Math.min(1, dt * 1.6); S.hy += (ctx.player.feet.y + 5.5 * k - S.hy) * Math.min(1, dt * 2);
      cloud.position.set(S.hx, S.hy + Math.sin(t * 0.8) * 0.12, S.hz); cloud.scale.setScalar(Math.max(0.01, g) * k * 0.9); cloud.rotation.y = t * 0.1;
      S.flick = Math.max(0, S.flick - dt * 4);
      flashM.opacity = S.flick * 0.8; puffM.emissive.setRGB(0.06 + S.flick * 0.5, 0.08 + S.flick * 0.55, 0.16 + S.flick * 0.8);
      glow.position.set(S.hx, S.hy - 0.8, S.hz); glow.intensity = (3 + 40 * S.flick) * g;
      S.rain += dt * 90 * g; const n = S.rain | 0; S.rain -= n;
      for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 2.4 * k; rain.emit(tmp.set(S.hx + Math.cos(a) * r, S.hy - 0.6, S.hz + Math.sin(a) * r), 1); }
      if (S.t > LIFE) { S.t = -1; cloud.visible = false; ring.visible = false; glow.intensity = 0; sparks.emit(cloud.position, 12); return; }
      if (S.mark) { // telegraph: a crackling ring on the victim's spot, then the bolt
        S.wait -= dt;
        ring.visible = true; ring.position.set(at.x, ctx.groundAt(at.x, at.z) + 0.07, at.z); ring.scale.setScalar(2.2 * (0.6 + 0.4 * (S.wait / 0.55))); ringM.opacity = 0.75 + 0.2 * Math.sin(t * 40);
        if (S.wait <= 0) { S.mark = false; ring.visible = false; strike(at.x, at.z, true); S.next = 0.8 + Math.random() * 0.7; }
      } else {
        S.next -= dt;
        if (S.next <= 0) {
          cp.set(S.hx, ctx.groundAt(S.hx, S.hz), S.hz);
          const tg = kit.nearestTarget(cp, 15 * k + 2, HOSTILE);
          if (tg) { tg.center(at); S.mark = true; S.wait = 0.55; S.flick = 0.6; sfx('thunder-crack', at); snd.tone({ freq: 90, freqEnd: 50, dur: 0.5, type: 'sawtooth', vol: 0.12, at }); }
          else { S.next = 1.6 + Math.random() * 1.5; const a = Math.random() * 6.283; strike(S.hx + Math.cos(a) * 9 * k, S.hz + Math.sin(a) * 9 * k, false); }
        }
      }
    },
  };
}
