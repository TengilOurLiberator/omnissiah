// Spell: Sky Disc. A rune-ringed disc of light materialises under your feet and carries you. HOLD THE TRIGGER and it flies along
// where your hand points (point up to climb, down to sink); let go and it hovers. Walk off the edge and you fall like normal (the disc
// lingers 6 s and a press calls it back under you). Aim straight down and pull the trigger to descend gently and dismiss it.
// The rig is moved by hand (core/player.js adopts it). Max 40 s of flight, then it lowers you to the ground. Mixed reality: tiny and low.
export const meta = { name: 'Sky Disc', description: 'Spell: ride a flying disc steered by your pointing hand.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // (Math.hypot allocates in hot loops)
  const COLOR = 0x7fd8ff, R = 1.25, FLY = 40, MAXV = 9;
  const D = { thrust: 0, dx: 0, dy: 0, dz: 0, on: false, t: 0, ride: false, off: 0, end: false, fade: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tick: 0 };
  const tmp = new THREE.Vector3(), tv = new THREE.Vector3();
  const mr = () => (ctx.input.passthrough ? 0.35 : 1);

  const disc = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ color: 0x39455a, emissive: 0x0c1830, flatShading: true });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.85, 0.14, 24), metal), trim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xbff0ff }));
  trim.position.y = 0.07;
  const runeM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const runes = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.82, 6).rotateX(-Math.PI / 2), runeM); runes.position.y = 0.081;
  const glowM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const under = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24).rotateX(Math.PI / 2), glowM); under.position.y = -0.1;
  disc.add(base, trim, runes, under);
  for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), trim.material), a = i * 1.0472; c.position.set(Math.cos(a) * 1.05, 0.2, Math.sin(a) * 1.05); c.scale.y = 1.8; disc.add(c); }
  disc.visible = false; disc.traverse((m) => { m.userData.noShadow = true; }); ctx.root.add(disc);
  const mats = [runeM, glowM];
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of mats) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const trail = kit.particles(ctx, { count: 360, color: [0xffffff, 0x50b8ff], size: [0.16, 0.02], life: [0.4, 1], speed: [0.1, 0.5], gravity: 0.3, drag: 0.8 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 8 });

  function under_() { const f = ctx.player.feet; D.x = f.x; D.z = f.z; D.y = f.y + 0.02; D.vx = D.vy = D.vz = 0; }
  function cast({ direction, first }) {
    const f = ctx.player.feet, k = mr();
    D.thrust = 0.12; D.dx = direction.x; D.dy = direction.y; D.dz = direction.z; // while held: fly where the hand points
    if (!first) return;
    if (D.on && D.ride) { if (direction.y < -0.85) D.end = true; return; } // point straight down and pull: land and dismiss
    if (!D.on) { D.on = true; D.t = 0; D.end = false; D.fade = 0; disc.visible = true; disc.scale.setScalar(k); trail.emit(tmp.set(f.x, f.y + 0.1, f.z), 30, undefined, 1.5); kit.flash(ctx, tmp.set(f.x, f.y + 0.3, f.z), { color: COLOR, intensity: 30, distance: 9, duration: 0.3 }); }
    under_(); D.ride = true; D.off = 0; D.end = false;
    if (!sfx('levitate', f)) snd.tone({ freq: 300, freqEnd: 900, dur: 0.5, vol: 0.15 });
    kit.haptic?.('right', 0.5, 60);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'sky-disc', name: 'Sky Disc', color: COLOR, icon: '🛸', hold: true, description: 'Ride a disc: hold the trigger to fly where you point; aim straight down and pull to land.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      if (!D.on) return;
      D.t += dt; D.fade = Math.min(1, D.fade + dt * 3);
      const k = mr(), rig = ctx.rig, f = ctx.player.feet;
      // riding: are the feet over the disc?
      const over = hyp(f.x - D.x, f.z - D.z) < R * k + 0.25 && Math.abs(f.y - (D.y + 0.1)) < 0.9;
      if (D.ride && !over && D.t > 0.3) { D.ride = false; D.off = 0; }
      if (!D.ride) { D.off += dt; if (over && D.off < 6 && D.t > 0.3 && !D.end) D.ride = true; }
      // flight: thrust along the hand while the trigger is held; the cast tap itself counts
      D.thrust -= dt;
      const live = D.ride && !D.end && D.t < FLY && D.thrust > 0 && D.dy > -0.85 && !ctx.world.menu?.capturing;
      const ax = live ? D.dx * 10 : 0, ay = live ? D.dy * 10 : 0, az = live ? D.dz * 10 : 0, damp = Math.exp(-(live ? 0.6 : 1.8) * dt);
      D.vx = (D.vx + ax * dt) * damp; D.vy = (D.vy + ay * dt) * damp; D.vz = (D.vz + az * dt) * damp;
      if (D.end || D.t >= FLY || (!D.ride && D.off > 0)) D.vy = Math.min(D.vy, 0) - (D.end || D.t >= FLY ? 1.5 : 0.6 * Math.min(1, D.off));
      const sp = hyp(D.vx, D.vy, D.vz), m = MAXV * k; if (sp > m) { D.vx *= m / sp; D.vy *= m / sp; D.vz *= m / sp; }
      D.x += D.vx * dt; D.y += D.vy * dt; D.z += D.vz * dt;
      const g2 = ctx.groundAt(D.x, D.z) + 0.02; D.y = Math.min(Math.max(D.y, g2), g2 + 40);
      if (D.ride) { rig.position.x += D.vx * dt; rig.position.z += D.vz * dt; rig.position.y = D.y + 0.1; ctx.world.player?.velocity?.setY?.(0); }
      disc.position.set(D.x, D.y, D.z); disc.rotation.y += dt * (0.6 + sp * 0.15); disc.scale.setScalar(k * Math.min(1, D.fade) * (D.t > FLY + 3 ? 0.01 : 1));
      runeM.opacity = (0.45 + 0.2 * Math.sin(t * 4)) * D.fade; glowM.opacity = 0.35 * D.fade;
      glow.position.set(D.x, D.y - 0.3, D.z); glow.intensity = 6 * D.fade;
      if (sp > 0.5 && Math.random() < dt * 40) trail.emit(tv.set(D.x + (Math.random() - 0.5) * 1.6 * k, D.y - 0.1, D.z + (Math.random() - 0.5) * 1.6 * k), 1);
      if (D.y <= g2 + 0.05 && (D.end || D.t >= FLY || (!D.ride && D.off > 6))) { // landed / abandoned: dismiss
        D.on = false; D.ride = false; disc.visible = false; glow.intensity = 0; trail.emit(tmp.set(D.x, D.y + 0.2, D.z), 24, undefined, 1.5);
        if (!sfx('teleport', tmp)) snd.tone({ freq: 800, freqEnd: 200, dur: 0.3, vol: 0.1, at: tmp });
      }
    },
  };
}
