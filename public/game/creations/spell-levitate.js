// Spell: Levitate (toggle). Cast once to float up and fly (world.player.flying: left stick moves along where you look, right
// stick / B go up and down); cast again to drop gently. Cyan motes drift down from your feet while you hover.
export const meta = { name: 'Levitate', description: 'Spell: toggle flight.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const COLOR = 0x7fffe8;
  const st = ctx.state;
  const p = new THREE.Vector3(), vv = new THREE.Vector3(), down = new THREE.Vector3(0, -1.2, 0);
  let lift = 0, acc = 0;

  const motes = kit.particles(ctx, { count: 260, color: [0xe6fffa, 0x2fd6c0], size: [0.14, 0.02], life: [0.6, 1.2], speed: [0.1, 0.5], gravity: 0.6, drag: 0.8, spread: 0.3 });
  const snd = kit.sound(ctx);
  const ringM = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2), ringM);
  ring.visible = false; ctx.root.add(ring);
  let burst = -1;

  function burstAt(feet, up) {
    for (let i = 0; i < 32; i++) { const a = (i / 32) * 6.283; motes.emit(p.set(feet.x + Math.cos(a) * 0.6, feet.y + 0.05, feet.z + Math.sin(a) * 0.6), 1, vv.set(Math.cos(a) * 1.2, up ? 1.5 : -0.3, Math.sin(a) * 1.2)); }
    burst = 0; ring.visible = true; ring.position.set(feet.x, feet.y + 0.05, feet.z);
  }
  function cast() {
    const P = ctx.world.player;
    if (!P) { ctx.hud?.show('Levitate needs the player module', 2); return; }
    const feet = ctx.player.feet;
    P.flying = !P.flying;
    st.ours = P.flying;
    if (P.flying) {
      lift = 1.1; burstAt(feet, true);
      snd.tone({ freq: 220, freqEnd: 880, dur: 0.6, type: 'sine', vol: 0.18 }); snd.chord([523, 659, 784, 1047], { dur: 0.8, vol: 0.12, type: 'triangle', stagger: 0.06 });
      ctx.hud?.show('Levitating — cast again to land', 2.2);
    } else {
      lift = 0; burstAt(feet, false);
      snd.tone({ freq: 700, freqEnd: 180, dur: 0.5, type: 'sine', vol: 0.16 });
      ctx.hud?.show('Landing', 1.2);
    }
    kit.haptic?.('right', 0.5, 60); kit.haptic?.('left', 0.5, 60);
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'levitate', name: 'Levitate', color: COLOR, icon: '🕊️', rate: 0.6, description: 'Toggle flight.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => { off?.(); const P = ctx.world.player; if (P && st.ours && P.flying) P.flying = false; st.ours = false; });

  return {
    update(dt, t) {
      const P = ctx.world.player;
      if (lift > 0) { lift -= dt; ctx.rig.position.y += 2.4 * dt; } // gentle lift-off
      if (P && P.flying && st.ours) {
        const f = ctx.player.feet;
        acc += dt * 28; const n = acc | 0; acc -= n;
        if (n) motes.emit(p.set(f.x, f.y + 0.05, f.z), n, down);
        ring.visible = true; ring.position.set(f.x, f.y + 0.04, f.z); ring.rotation.y = t * 2; ringM.opacity = 0.35 + 0.15 * Math.sin(t * 4); ring.scale.setScalar(1);
      } else if (burst >= 0) {
        burst += dt;
        const u = burst / 0.5;
        if (u >= 1) { burst = -1; ring.visible = false; } else { ring.scale.setScalar(1 + u * 2.5); ringM.opacity = 0.7 * (1 - u); }
      } else ring.visible = false;
    },
  };
}
