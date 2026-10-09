// Thing: Strength Tester. A fairground high-striker: a tall tower with a scale from WEAK to LEGEND and a brass bell on top, and a leather
// pad at its foot. Hit the pad with anything (sword, hammer, spell, explosion, a thrown crate): a glowing puck shoots up the tower as high as
// your blow was strong (damage dealt, 0-60+), and a hard enough hit rings the bell. Shows your last hit and your best. Never breaks.
// INERT until spawned: this file only registers a library entry.
// SPAWN: ctx.world.library.spawn(ctx, 'strength-tester', { x, z, yaw })  -> handle (handle.remove() takes it away).  Summon list: Props.
export const meta = { name: 'Strength Tester', description: 'Thing: a high-striker that measures how hard you hit.' };

export default function (ctx) {
  const { THREE } = ctx;
  let undo = null;
  const H = 4.2, MAXD = 60;

  function build(c, o) {
    const kit = c.world.kit, i = o.inst;
    if (!kit || !i) return null;
    const own = (m) => { m.userData.own = true; return m; };
    const wood = own(new THREE.MeshLambertMaterial({ color: 0x7a5230 })), leather = own(new THREE.MeshLambertMaterial({ color: 0x8a3a24 })), brass = own(new THREE.MeshLambertMaterial({ color: 0xd9a52a, emissive: 0x442200 }));
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.35, 14).translate(0, 0.175, 0), wood); i.add(base);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 14).translate(0, 0.41, 0), leather); i.add(pad);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.28, H, 0.12).translate(0, 0.35 + H / 2, -0.7), wood); i.add(tower);
    const cols = [0x4aa3ff, 0x4adf9a, 0xffd24a, 0xff8a3d, 0xff3a3a];
    for (let n = 0; n < 5; n++) { const seg = new THREE.Mesh(new THREE.BoxGeometry(0.16, H / 5 - 0.06, 0.02).translate(0, 0.35 + (n + 0.5) * (H / 5), -0.63), own(new THREE.MeshBasicMaterial({ color: cols[n] }))); i.add(seg); seg.userData.own = true; }
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.34, 10, 1, true).translate(0, 0.17, 0), brass); bell.material.side = THREE.DoubleSide; bell.position.set(0, 0.35 + H + 0.05, -0.7); i.add(bell);
    const puck = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), own(new THREE.MeshBasicMaterial({ color: 0xfff0b0 }))); puck.position.set(0, 0.4, -0.58); i.add(puck);
    const lab = i.label('Hit the pad!', { size: 0.13, color: 0xffe9a0 }); lab.position.set(i.x, i.gy(0, 0) + H + 1.0, i.z);
    const fx = i.fx({ count: 160, color: [0xffffff, 0xffc84a], size: [0.12, 0.03], life: [0.4, 1], speed: [2, 6], gravity: 5, drag: 0.7 });
    const snd = i.snd(), wp = new THREE.Vector3();
    let level = 0, shown = 0, hold = 0, best = 0, swing = 0, ringed = false;
    const d = i.dmg(pad, { hp: 1e9, radius: 0.8, offsetY: 0.45, faction: 'neutral', onHit(e) {
      d.hp = d.maxHp;
      const amount = e.amount ?? 1; level = Math.min(1, amount / MAXD); shown = 0; hold = 2.5; ringed = false;
      best = Math.max(best, Math.round(amount)); lab.set(`${Math.round(amount)}   ${rank(amount)}   (best ${best})`);
      wp.set(0, 0.5, 0); pad.localToWorld(wp); fx.emit(wp, 10);
      snd.noise({ dur: 0.1, filter: { type: 'lowpass', freq: 600 }, vol: 0.25, at: wp }); snd.tone({ freq: 120, freqEnd: 70, dur: 0.15, type: 'square', vol: 0.12, at: wp });
    } });
    const rank = (a) => (a < 6 ? 'WEAK' : a < 15 ? 'Not bad' : a < 30 ? 'STRONG' : a < MAXD ? 'HERO' : 'LEGEND!');
    i.tick((dt, t) => {
      const target = level;
      if (shown < target) shown = Math.min(target, shown + dt * 2.2); // the puck climbs
      else if (hold > 0) { hold -= dt; } else shown = Math.max(0, shown - dt * 0.8);
      puck.position.y = 0.4 + shown * (H - 0.1);
      if (hold <= 0 && shown === 0) level = 0;
      if (!ringed && shown >= 0.98 && level >= 0.98) {
        ringed = true; swing = 1; wp.set(0, H + 0.4, -0.7); i.group.localToWorld(wp);
        fx.emit(wp, 50, undefined, 1.4); kit.flash(c, wp, { color: 0xffd24a, intensity: 40, distance: 12, duration: 0.4 });
        snd.chord([880, 1109, 1319, 1760], { dur: 1.6, vol: 0.2, type: 'sine', at: wp }); snd.tone({ freq: 660, freqEnd: 650, dur: 1.8, type: 'triangle', vol: 0.12, at: wp });
      }
      swing = Math.max(0, swing - dt * 0.7); bell.rotation.z = Math.sin(t * 22) * swing * 0.35;
    });
    return { dispose() { for (const m of [wood, leather, brass]) m.dispose(); } };
  }

  const register = () => {
    undo?.();
    undo = ctx.world.library?.define('strength-tester', {
      category: 'props', description: 'fairground high-striker: hit the leather pad with anything and a glowing puck climbs the tower as high as your blow was strong; the brass bell rings for a mighty hit; shows last and best',
      aliases: ['high striker', 'strength game', 'test your strength', 'hammer game', 'bell ringer game', 'strongman game', 'striker', 'strengthtester'], options: 'yaw', size: 2, distance: 6, build,
    }) ?? null;
  };
  register();
  ctx.on('module:loaded', (e) => { if (e.path === 'core/library.js') register(); });
  ctx.onDispose(() => undo?.());
  return {};
}
