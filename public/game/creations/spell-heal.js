// Spell: Healing Light (HOLD the trigger). Soft green motes spiral up around you while it restores your health and
// mends friendly fighters within reach. Continuous spell: cast() runs every frame while held, onRelease() on let-go.
export const meta = { name: 'Healing Light', description: 'Spell (hold): restore your health and nearby allies.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x55ff9a, RATE = 14, ALLY_RATE = 10, REACH = 9, NOTES = [523, 659, 784, 988, 784, 659];
  const st = { acc: 0, chime: 0, buzz: 0, note: 0, active: 0, k: 0 };
  const p = new THREE.Vector3(), up = new THREE.Vector3(0, 1.4, 0);

  const motes = kit.particles(ctx, { count: 420, color: [0xe8ffe8, 0x2fe27a], size: [0.13, 0.02], life: [0.7, 1.4], speed: [0.1, 0.4], gravity: -1.1, drag: 0.6 });
  const glint = kit.particles(ctx, { count: 120, color: [0xffffff, 0x9affc0], size: [0.3, 0.05], life: [0.15, 0.35], speed: 0.3 });
  const snd = kit.sound(ctx);
  const ringM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40).rotateX(-Math.PI / 2), ringM);
  ring.visible = false; ctx.root.add(ring);
  const glow = kit.light(ctx, { color: COLOR, intensity: 0, distance: 7 });

  function cast({ origin, dt, first }) {
    const P = ctx.world.player, feet = ctx.player.feet, head = ctx.player.head;
    st.active = 0.15;
    if (first) { glint.emit(origin, 12); snd.chord([523, 784, 1047], { dur: 0.7, vol: 0.14, type: 'sine', stagger: 0.05 }); }
    if (P && P.heal) P.heal(RATE * dt);
    else if (P && typeof P.health === 'number') P.health = Math.min(P.maxHealth ?? 100, P.health + RATE * dt);
    const F = ctx.world.combat?.fighters;
    if (F) for (let i = 0; i < F.length; i++) {
      const f = F[i], a = f.actor;
      if (!a || f.faction !== 'friendly' || f.alive === false || !f.heal) continue;
      if (Math.hypot(a.position.x - feet.x, a.position.z - feet.z) > REACH) continue;
      f.heal(ALLY_RATE * dt);
      if (Math.random() < dt * 20) motes.emit(p.set(a.position.x, a.position.y + 0.3, a.position.z), 2, up);
    }
    // motes spiral up around the player and stream from the hand
    st.acc += dt * 70; const n = st.acc | 0; st.acc -= n;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * 6.283, r = 0.55 + Math.random() * 0.7;
      motes.emit(p.set(head.x + Math.cos(ang) * r, feet.y + 0.1 + Math.random() * 0.3, head.z + Math.sin(ang) * r), 1, up);
    }
    motes.emit(origin, 1, up);
    st.chime -= dt;
    if (st.chime <= 0) { st.chime = 0.34; snd.tone({ freq: NOTES[st.note++ % NOTES.length], dur: 0.5, vol: 0.08, type: 'sine' }); }
    st.buzz -= dt;
    if (st.buzz <= 0) { st.buzz = 0.18; kit.haptic?.('right', 0.18, 30); }
  }
  function onRelease() {
    glint.emit(p.copy(ctx.player.head).setY(ctx.player.feet.y + 1), 14);
    snd.tone({ freq: 1568, freqEnd: 2093, dur: 0.35, vol: 0.08 });
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'heal', name: 'Healing Light', color: COLOR, icon: '💚', hold: true, description: 'Hold: restore yourself and nearby allies.', cast, onRelease }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      st.active -= dt;
      const on = st.active > 0;
      st.k += ((on ? 1 : 0) - st.k) * Math.min(1, dt * 8);
      ring.visible = st.k > 0.02;
      if (ring.visible) {
        ring.position.set(ctx.player.head.x, ctx.player.feet.y + 0.06, ctx.player.head.z);
        ring.scale.setScalar(1.1 + 0.15 * Math.sin(t * 6)); ring.rotation.y = t; ringM.opacity = 0.5 * st.k;
      }
      glow.position.set(ctx.player.head.x, ctx.player.feet.y + 1.2, ctx.player.head.z); glow.intensity = 9 * st.k;
    },
  };
}
