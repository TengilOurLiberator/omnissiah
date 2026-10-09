// Spell: Arcane Shield. A shimmering dome of hexagonal force surrounds you for a few seconds; world.player.invulnerable
// is held up while it lasts. Attacks that land on it ripple the dome and throw sparks. Recasting refreshes it.
export const meta = { name: 'Arcane Shield', description: 'Spell: a temporary invulnerability bubble.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x6ab4ff, DURATION = 8, RADIUS = 1.55;
  const sh = { left: 0, pop: 0, ripple: 0 };
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();

  const dome = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: COLOR, wireframe: true, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  const film = new THREE.Mesh(new THREE.IcosahedronGeometry(0.98, 2), new THREE.MeshBasicMaterial({ color: 0x3a78ff, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  dome.add(shell, film, hit); dome.visible = false; ctx.root.add(dome);
  const sparks = kit.particles(ctx, { count: 240, color: [0xffffff, 0x6ab4ff], size: [0.11, 0.02], life: [0.3, 0.9], speed: [0.5, 3], gravity: 1.5, drag: 0.8 });
  const snd = kit.sound(ctx);
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 8 });

  function cast() {
    const was = sh.left > 0;
    sh.left = DURATION; sh.pop = was ? 0.5 : 0; dome.visible = true;
    const c = ctx.player.head;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.283, y = Math.random() * 2 - 1, r = Math.sqrt(1 - y * y);
      sparks.emit(tmp.set(c.x + Math.cos(a) * r * RADIUS, ctx.player.feet.y + 1 + y * RADIUS * 0.9, c.z + Math.sin(a) * r * RADIUS), 1);
    }
    snd.chord([392, 587, 784, 1175], { dur: 1.2, vol: 0.16, type: 'triangle', stagger: 0.06 });
    snd.noise({ dur: 0.5, filter: { type: 'bandpass', freq: 800, freqEnd: 3000, q: 0.8 }, vol: 0.2 });
    kit.haptic?.('left', 0.5, 60); kit.haptic?.('right', 0.5, 60);
  }
  // combat tells us when something strikes the player: ripple the dome there
  ctx.on('combat:attack', (e) => {
    if (sh.left <= 0 || !e.target || !e.target.isPlayer || !e.point) return;
    const c = ctx.player.head;
    dir.set(e.point.x - c.x, e.point.y - c.y, e.point.z - c.z).normalize();
    tmp.copy(c).setY(ctx.player.feet.y + 1).addScaledVector(dir, RADIUS);
    hit.position.copy(tmp).sub(dome.position); sh.ripple = 1;
    sparks.emit(tmp, 18); kit.flash(ctx, tmp, { color: COLOR, intensity: 20, distance: 6, duration: 0.12 });
    snd.tone({ freq: 1200, freqEnd: 400, dur: 0.25, type: 'triangle', vol: 0.15, at: tmp }); snd.tone({ freq: 130, freqEnd: 60, dur: 0.2, vol: 0.25, at: tmp });
    kit.haptic?.('left', 0.8, 50); kit.haptic?.('right', 0.8, 50);
  });

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'arcane-shield', name: 'Arcane Shield', color: COLOR, icon: '🛡️', rate: 1, description: 'A dome that makes you untouchable for a few seconds.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); });

  return {
    update(dt, t) {
      if (sh.left <= 0) return;
      sh.left -= dt; sh.pop += dt;
      const P = ctx.world.player;
      if (P && P.invulnerable !== true && !(P.invulnerable >= sh.left)) P.invulnerable = sh.left;
      const c = ctx.player.head, k = Math.min(1, sh.pop / 0.3), s = RADIUS * (k < 1 ? 1 + 1.70158 * Math.pow(k - 1, 3) + 0.70158 * Math.pow(k - 1, 2) : 1);
      dome.position.set(c.x, ctx.player.feet.y + 1, c.z); dome.scale.setScalar(Math.max(0.05, s));
      shell.rotation.y += dt * 0.4; shell.rotation.x += dt * 0.15;
      const fade = sh.left < 1.2 ? 0.5 + 0.5 * Math.sin(t * 30) : 1;
      shell.material.opacity = 0.32 * fade + sh.ripple * 0.3; film.material.opacity = 0.08 * fade + sh.ripple * 0.12;
      sh.ripple = Math.max(0, sh.ripple - dt * 3); hit.material.opacity = sh.ripple; hit.scale.setScalar(1 + (1 - sh.ripple) * 4);
      glow.position.copy(dome.position); glow.intensity = 6 * fade;
      if (Math.random() < dt * 8) sparks.emit(tmp.set(c.x + (Math.random() - 0.5) * 2 * RADIUS * 0.8, ctx.player.feet.y + 0.2 + Math.random() * 1.8, c.z + (Math.random() - 0.5) * 2 * RADIUS * 0.8), 1);
      if (sh.left <= 0) { // pop
        dome.visible = false; glow.intensity = 0;
        for (let i = 0; i < 50; i++) { const a = Math.random() * 6.283, y = Math.random() * 2 - 1, r = Math.sqrt(1 - y * y); sparks.emit(tmp.set(c.x + Math.cos(a) * r * RADIUS, ctx.player.feet.y + 1 + y * RADIUS, c.z + Math.sin(a) * r * RADIUS), 1); }
        snd.noise({ dur: 0.4, filter: { type: 'highpass', freq: 2500, q: 0.7 }, vol: 0.25 }); snd.tone({ freq: 900, freqEnd: 200, dur: 0.35, type: 'triangle', vol: 0.15 });
      }
    },
  };
}
