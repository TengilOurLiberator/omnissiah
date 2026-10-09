// Spell: Light Orb. Cast once and a warm will-o-the-wisp drifts up from your hand and follows you at shoulder height, trailing
// sparkles and lighting the ground around you (one budgeted light; brighter the darker the sky: world.env.timeOfDay). Point at the
// GROUND and cast to send it flying to that spot, where it stays as a lantern; point at the SKY to call it back. Its glow turns
// amber and pulses when an enemy comes within 16 m: a pocket threat detector. Cast it at your own feet (aim straight down) to put
// it out. Mixed reality: a smaller, dimmer orb.
export const meta = { name: 'Light Orb', description: 'Spell: a companion light; send it ahead, call it back, watch it warn you.' };

export default function (ctx) {
  const { THREE } = ctx;
  const kit = ctx.world.kit;
  if (!kit) return {};
  const HOSTILE = { hostileTo: 'friendly' };
  const WARM = new THREE.Color(0xffe8a8), ALARM = new THREE.Color(0xff8a30);
  const O = { on: false, mode: 0, t: 0, fly: 0, p: new THREE.Vector3(), a: new THREE.Vector3(), alert: 0, fade: 0, ph: 0 }; // mode 0 follow, 1 flying to a spot, 2 parked
  const tmp = new THREE.Vector3(), tv = new THREE.Vector3(), col = new THREE.Color();
  const mr = () => (ctx.input.passthrough ? 0.5 : 1);

  const coreM = new THREE.MeshBasicMaterial({ color: 0xffffff }), haloM = new THREE.MeshBasicMaterial({ color: 0xffe8a8, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const haloB = new THREE.MeshBasicMaterial({ color: 0xffe8a8, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), orb = new THREE.Group(), core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), coreM), halo = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), haloM), halo2 = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), haloB);
  orb.add(core, halo, halo2); orb.visible = false; orb.traverse((m) => { m.userData.noShadow = true; }); ctx.root.add(orb);
  let pt = null; // mixed reality: additive must not raise framebuffer alpha (core/world.js header)
  const blendFix = () => { if (pt === ctx.input.passthrough) return; pt = ctx.input.passthrough; for (const m of [haloM, haloB]) { if (pt) { m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor; } else m.blending = THREE.AdditiveBlending; m.needsUpdate = true; } };
  const trail = kit.particles(ctx, { count: 280, color: [0xfff4d0, 0xffa040], size: [0.12, 0.02], life: [0.5, 1.1], speed: [0.05, 0.3], gravity: -0.2, drag: 0.8 });
  const snd = kit.sound(ctx);
  const sfx = (n, p) => ctx.world.audio?.sfx(n, { at: p });
  const lamp = kit.light(ctx, { color: 0xffe8a8, intensity: 0, distance: 16, flicker: 0.15 });

  function cast({ origin, direction }) {
    const f = ctx.player.feet;
    if (ctx.clock.t - (O.last ?? -9) < 0.4) return; O.last = ctx.clock.t; // (rate 0: a held trigger must not toggle it repeatedly)
    if (direction.y < -0.82) { if (O.on) { O.on = false; trail.emit(orb.position, 24, undefined, 1.5); if (!sfx('ui-close', orb.position)) snd.tone({ freq: 800, freqEnd: 300, dur: 0.2, vol: 0.1 }); } return; }
    if (!O.on) { O.on = true; O.mode = 0; O.fade = 0; O.p.copy(origin); orb.visible = true; trail.emit(origin, 20, undefined, 1.2); if (!sfx('magic-cast', origin)) snd.chord([784, 1175, 1568], { dur: 0.6, vol: 0.1, stagger: 0.06, at: origin }); kit.haptic?.('right', 0.3, 40); return; }
    const aim = direction.y < 0.1 && !ctx.input.passthrough ? ctx.aimPoint(40) : null;
    if (aim) { O.mode = 1; O.fly = 0; O.a.set(aim.x, aim.y + 1.3, aim.z); sfx('conjure-orb', origin); } else { O.mode = 0; sfx('ui-select', origin); } // sky: call it back
    kit.haptic?.('right', 0.3, 40); void f;
  }

  let off = null;
  const register = () => {
    off?.();
    off = ctx.world.spells?.register({ id: 'light-orb', name: 'Light Orb', color: 0xffd98a, icon: '💡', rate: 0, description: 'A companion light: aim at ground to place it, sky to recall, feet to snuff.', cast }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/spells.js') register(); });
  ctx.onDispose(() => off?.());

  return {
    update(dt, t) {
      blendFix();
      O.fade += ((O.on ? 1 : 0) - O.fade) * Math.min(1, dt * 4);
      if (!O.on && O.fade < 0.02) { orb.visible = false; lamp.intensity = 0; return; }
      O.t += dt; const k = mr(), h = ctx.player.head;
      if (O.mode === 0) { // follow: hover at the right shoulder, bobbing, with a little lag
        const a = O.t * 0.5; tmp.set(h.x + Math.cos(a) * 0.9 * k + ctx.player.forward.z * -0.3, h.y + 0.15 + Math.sin(O.t * 1.7) * 0.1, h.z + Math.sin(a) * 0.9 * k + ctx.player.forward.x * 0.3);
        O.p.lerp(tmp, Math.min(1, dt * 2.5));
      } else if (O.mode === 1) { O.fly = Math.min(1, O.fly + dt * 1.2); O.p.lerp(O.a, Math.min(1, dt * 5 * O.fly + 0.01)); if (O.p.distanceTo(O.a) < 0.25) O.mode = 2; }
      else { O.p.y = O.a.y + Math.sin(O.t * 1.5) * 0.08; }
      orb.position.copy(O.p); orb.scale.setScalar(k * (1 + 0.08 * Math.sin(t * 5)) * O.fade);
      // darker sky = brighter lamp; enemies near = amber alarm
      const tod = ctx.world.env && typeof ctx.world.env.timeOfDay === 'number' ? ctx.world.env.timeOfDay : 0.5, dark = 1 - Math.min(1, tod / 0.7);
      const foe = kit.nearestTarget(tv.set(O.p.x, ctx.groundAt(O.p.x, O.p.z), O.p.z), 16, HOSTILE);
      O.alert += ((foe ? 1 : 0) - O.alert) * Math.min(1, dt * 3);
      col.copy(WARM).lerp(ALARM, O.alert); haloM.color.copy(col); lamp.color = col;
      const pulse = 1 + O.alert * 0.4 * Math.sin(t * 12);
      lamp.position.copy(O.p); lamp.intensity = (5 + 22 * dark) * k * pulse * O.fade; haloM.opacity = (0.3 + 0.2 * dark) * pulse;
      if (Math.random() < dt * 30 * O.fade) trail.emit(tmp.copy(O.p).add(tv.set((Math.random() - 0.5) * 0.15, -0.05, (Math.random() - 0.5) * 0.15)), 1);
    },
  };
}
