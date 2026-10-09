// Spell: Fire Stream (HOLD the trigger). A roaring flamethrower cone: pooled flame particles, a flickering light, scorching
// damage ticks along the cone through kit.hit. Continuous spell: cast() runs every frame while held.
export const meta = { name: 'Fire Stream', description: 'Spell (hold): a flamethrower cone.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0xff6a1a, FROM = { from: 'player', kind: 'fire' }, CONE_D = [1.8, 3.8, 6.2], CONE_R = [1, 1.5, 2.1];
  const fs = { acc: 0, tick: 0, roar: 0, buzz: 0, active: 0 };
  const v = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Vector3();

  const flame = kit.particles(ctx, { count: 700, color: [0xfff2b0, 0xff3a00], size: [0.12, 0.9], life: [0.35, 0.8], speed: [0.5, 2.6], gravity: -1.6, drag: 1.5, spread: 0.05 });
  const smoke = kit.particles(ctx, { count: 160, additive: false, color: [0x555555, 0x1a1a1a], alpha: 0.35, size: [0.4, 1.4], life: [0.8, 1.6], speed: [0.2, 0.8], gravity: -0.9, drag: 1 });
  const embers = kit.particles(ctx, { count: 140, color: [0xffe0a0, 0xff5010], size: [0.07, 0.015], life: [0.5, 1.2], speed: [1, 4], gravity: 5, drag: 0.4 });
  const snd = kit.sound(ctx);
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 12, flicker: 0.6 });

  function cast({ origin, direction, dt, first }) {
    fs.active = 0.12;
    if (first) { snd.noise({ dur: 0.35, filter: { type: 'lowpass', freq: 600, freqEnd: 2200, q: 0.8 }, vol: 0.5, at: origin }); snd.tone({ freq: 70, freqEnd: 120, dur: 0.3, type: 'sawtooth', vol: 0.15, at: origin }); }
    fs.acc += dt * 190; const n = fs.acc | 0; fs.acc -= n;
    if (n) { v.copy(direction).multiplyScalar(12); flame.emit(origin, n, v); if (n > 1) flame.emit(p.copy(origin).addScaledVector(direction, 0.5), 1, v); }
    if (Math.random() < dt * 14) smoke.emit(p.copy(origin).addScaledVector(direction, 3 + Math.random() * 3), 1, direction);
    glow.position.copy(origin).addScaledVector(direction, 3); glow.intensity = 16;
    fs.tick -= dt;
    if (fs.tick <= 0) {
      fs.tick = 0.1;
      for (let i = 0; i < 3; i++) kit.hit(p.copy(origin).addScaledVector(direction, CONE_D[i]), CONE_R[i], 2.6, FROM);
      e.copy(origin).addScaledVector(direction, 8); // where the flames reach: scorch the ground
      if (e.y < ctx.groundAt(e.x, e.z) + 1.5) { e.y = ctx.groundAt(e.x, e.z) + 0.1; embers.emit(e, 3); }
    }
    fs.roar -= dt;
    if (fs.roar <= 0) { fs.roar = 0.2; snd.noise({ dur: 0.32, filter: { type: 'bandpass', freq: 500 + Math.random() * 300, q: 0.7 }, vol: 0.32, at: origin, attack: 0.04 }); snd.tone({ freq: 60, dur: 0.3, type: 'sawtooth', vol: 0.05, at: origin }); }
    fs.buzz -= dt;
    if (fs.buzz <= 0) { fs.buzz = 0.05; kit.haptic?.('right', 0.3, 40); }
  }
  function onRelease() { glow.intensity = 0; snd.noise({ dur: 0.25, filter: { type: 'highpass', freq: 1500, q: 0.8 }, vol: 0.15 }); }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'fire-stream', name: 'Fire Stream', color: COLOR, icon: '🔥', hold: true, description: 'Hold: spray a cone of fire.', cast, onRelease }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e2) => { if (e2.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt) {
      fs.active -= dt;
      if (fs.active <= 0 && glow.intensity > 0) glow.intensity = Math.max(0, glow.intensity - dt * 60);
    },
  };
}
