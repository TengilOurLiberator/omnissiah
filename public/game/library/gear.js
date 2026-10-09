// library/gear.js - shared meshes: held weapons (grip at the origin, blade along -Z), body gear for kit actors, chests.
// Installed first; other catalogue files use H.weaponMesh(type), H.gearMesh(name, colour), H.makeChest(...), H.dens(n) (density-scaled counts).
// The encounter layer (library/behaviors.js) and the boss catalogue (library/bosses.js) load with this file (core/library.js only knows the fixed list of catalogue files):
// H.behaviors = B (see docs/ENCOUNTERS.md); enemies.js calls H.installBosses(lib) at its end.
const q = (() => { try { return new URL(import.meta.url).search; } catch (err) { return ''; } })();
const [{ default: makeBehaviors }, { default: makeBosses }] = await Promise.all([import('./behaviors.js' + q), import('./bosses.js' + q)]);
export default function install(lib, H) {
  const { THREE, model } = H;
  try { H.behaviors = makeBehaviors(H); H.installBosses = (l) => makeBosses(l, H); } catch (err) { console.error('[library] encounter layer failed to load', err); }
  const PI = Math.PI, Z = [-PI / 2, 0, 0], ZR = [PI / 2, 0, 0];
  const C = { steel: 0xc9d3dc, steelD: 0x8794a3, dark: 0x2a2e36, gold: 0xd9a93c, wood: 0x80552f, woodD: 0x4d3322, leather: 0x3a2a22, red: 0xb03030, cyan: 0x58e6ff, bone: 0xe6dfc8 };

  // ------------------------------------------------------------------ held weapons
  const W = {
    sword(b) { b.cyl(0, 0, 0.08, 0.022, 0.022, 0.16, C.leather, Z); b.sph(0, 0, 0.1, 0.035, 0.035, 0.035, C.gold); b.box(0, 0, -0.09, 0.24, 0.035, 0.04, C.gold); b.box(0, 0, -0.5, 0.055, 0.012, 0.8, C.steel); b.box(0, 0.007, -0.5, 0.012, 0.006, 0.74, C.steelD); b.cone(0, 0, -0.9, 0.03, 0.1, C.steel, Z, 4); },
    greatsword(b) { b.cyl(0, 0, 0.12, 0.026, 0.026, 0.3, C.leather, Z); b.sph(0, 0, 0.14, 0.04, 0.04, 0.04, C.gold); b.box(0, 0, -0.1, 0.34, 0.045, 0.05, C.gold); b.box(0, 0, -0.68, 0.09, 0.016, 1.15, C.steel); b.box(0, 0.01, -0.68, 0.02, 0.008, 1.05, C.steelD); b.cone(0, 0, -1.26, 0.048, 0.16, C.steel, Z, 4); },
    dagger(b) { b.cyl(0, 0, 0.05, 0.02, 0.02, 0.1, C.leather, Z); b.box(0, 0, -0.05, 0.12, 0.025, 0.03, C.steelD); b.box(0, 0, -0.22, 0.04, 0.01, 0.34, C.steel); b.cone(0, 0, -0.39, 0.02, 0.07, C.steel, Z, 4); },
    axe(b) { b.cyl(0, 0, 0.12, 0.025, 0.03, 0.95, C.wood, Z); b.box(0.09, 0, -0.74, 0.2, 0.03, 0.26, C.steel); b.box(-0.03, 0, -0.74, 0.07, 0.05, 0.1, C.steelD); b.box(-0.09, 0, -0.74, 0.04, 0.03, 0.14, C.steelD); },
    warhammer(b) { b.cyl(0, 0, 0.12, 0.025, 0.03, 1.0, C.wood, Z); b.box(0, 0, -0.95, 0.14, 0.15, 0.26, C.steelD); b.box(0, 0, -0.95, 0.15, 0.1, 0.1, C.steel); b.cone(0, 0, -1.1, 0.03, 0.1, C.steel, Z, 4); b.cone(0, 0, -0.78, 0.03, 0.08, C.steel, [PI / 2, 0, 0], 4); },
    spear(b) { b.cyl(0, 0, 0.5, 0.02, 0.022, 1.9, C.wood, Z); b.cone(0, 0, -1.4, 0.05, 0.28, C.steel, Z, 4); b.box(0, 0, -1.4, 0.07, 0.02, 0.05, C.red); },
    club(b) { b.cyl(0, 0, 0.1, 0.03, 0.065, 0.75, C.wood, Z); b.sph(0, 0, -0.66, 0.075, 0.075, 0.075, C.woodD); },
    katana(b) { b.cyl(0, 0, 0.1, 0.02, 0.02, 0.2, 0x202028, Z); b.cylc(0, 0, -0.1, 0.05, 0.05, 0.015, C.gold, ZR, 8); b.box(0, 0, -0.5, 0.04, 0.012, 0.78, C.steel, [0, 0, 0]); b.box(0, 0.01, -0.92, 0.04, 0.012, 0.08, C.steel, [0.1, 0, 0]); b.box(0, 0.02, -1.0, 0.03, 0.01, 0.07, C.steel, [0.25, 0, 0]); },
    scythe(b) { b.cyl(0, 0, 0.3, 0.022, 0.026, 1.5, C.woodD, Z); for (let i = 0; i < 5; i++) b.box(i * 0.11, 0, -1.18 - i * i * 0.012, 0.14, 0.012, 0.045, C.steel, [0, -i * 0.18, 0]); },
    bow(b) { for (let i = 0; i < 6; i++) { const a = (i / 5 - 0.5) * 2.2, y = Math.sin(a) * 0.5, z = -Math.cos(a) * 0.12 + 0.06; b.box(0, y, z, 0.025, 0.2, 0.025, C.wood, [-a * 0.9, 0, 0]); } b.box(0, 0, 0.06, 0.012, 1.05, 0.008, C.leather); },
    crossbow(b) { b.box(0, 0, -0.1, 0.05, 0.06, 0.6, C.wood); b.box(0, 0.02, -0.3, 0.6, 0.025, 0.04, C.woodD); b.box(0, 0.02, -0.2, 0.5, 0.006, 0.006, C.leather); b.box(0, -0.06, 0.1, 0.04, 0.12, 0.05, C.woodD); b.box(0, 0.045, -0.3, 0.012, 0.012, 0.3, C.steel); },
    blaster(b) { b.box(0, -0.05, 0.05, 0.05, 0.14, 0.06, C.dark, [0.2, 0, 0]); b.box(0, 0.03, -0.1, 0.07, 0.1, 0.34, 0x4a5568); b.cyl(0, 0.03, -0.27, 0.025, 0.02, 0.18, C.steelD, Z); b.mode('glow'); b.box(0, 0.09, -0.08, 0.04, 0.03, 0.14, C.cyan); b.mode('solid'); },
    shotgun(b) { b.box(0, -0.02, 0.15, 0.06, 0.1, 0.32, C.wood); b.cyl(0.022, 0.02, -0.05, 0.02, 0.02, 0.62, C.dark, Z); b.cyl(-0.022, 0.02, -0.05, 0.02, 0.02, 0.62, C.dark, Z); b.box(0, -0.03, -0.2, 0.07, 0.05, 0.2, C.woodD); },
    rifle(b) { b.box(0, -0.02, 0.2, 0.05, 0.1, 0.4, C.wood); b.cyl(0, 0.02, -0.05, 0.018, 0.018, 0.95, C.dark, Z); b.box(0, 0.05, -0.1, 0.03, 0.04, 0.3, C.steelD); b.box(0, -0.08, 0.0, 0.03, 0.12, 0.04, C.woodD); },
    'magic-staff'(b) { b.cyl(0, 0, 0.5, 0.025, 0.03, 1.8, C.woodD, Z); b.mode('glow'); b.oct(0, 0, -1.4, 0.07, 0.11, 0.07, 0x9a7bff, [PI / 2, 0, 0]); b.mode('solid'); b.cone(0.05, 0, -1.3, 0.02, 0.14, C.woodD, [PI / 2, 0, 0.5], 4); b.cone(-0.05, 0, -1.3, 0.02, 0.14, C.woodD, [PI / 2, 0, -0.5], 4); },
    wand(b) { b.cyl(0, 0, 0.05, 0.012, 0.016, 0.34, 0x2a1d1a, Z); b.mode('glow'); b.sph(0, 0, -0.3, 0.02, 0.02, 0.02, 0xfff0a0); b.mode('solid'); },
    shield(b) { b.cylc(0, 0, -0.02, 0.3, 0.3, 0.05, 0x8a3b30, ZR, 10); b.cylc(0, 0, -0.05, 0.31, 0.31, 0.015, C.steelD, ZR, 10); b.sph(0, 0, -0.08, 0.075, 0.075, 0.04, C.steel); b.box(0, 0, -0.05, 0.05, 0.5, 0.012, C.gold); b.box(0, 0, -0.05, 0.5, 0.05, 0.012, C.gold); },
    torch(b) { b.cyl(0, 0, 0.1, 0.022, 0.03, 0.55, C.woodD, Z); b.mode('glow'); b.cone(0, 0, -0.45, 0.07, 0.2, 0xff7a1a, Z, 6); b.cone(0, 0, -0.47, 0.04, 0.2, 0xffd24a, Z, 6); b.mode('solid'); },
    pickaxe(b) { b.cyl(0, 0, 0.12, 0.025, 0.03, 0.9, C.wood, Z); b.box(0, 0, -0.75, 0.5, 0.045, 0.05, C.steelD); b.cone(0.28, 0, -0.75, 0.03, 0.14, C.steel, [0, 0, -PI / 2], 4); b.cone(-0.28, 0, -0.75, 0.03, 0.14, C.steel, [0, 0, PI / 2], 4); },
    boomerang(b) { b.box(0.12, 0, -0.1, 0.34, 0.025, 0.07, C.wood, [0, -0.5, 0]); b.box(-0.12, 0, -0.1, 0.34, 0.025, 0.07, C.wood, [0, 0.5, 0]); b.box(0, 0.014, -0.08, 0.1, 0.006, 0.05, C.red); },
    grenade(b) { b.sph(0, 0, 0, 0.06, 0.07, 0.06, 0x4a5a38); b.cyl(0, 0.06, 0, 0.025, 0.025, 0.03, C.steelD); b.box(0.03, 0.08, 0, 0.05, 0.01, 0.015, C.steel); },
    'skull-staff'(b) { b.cyl(0, 0, 0.5, 0.022, 0.028, 1.7, 0x2a2024, Z); b.sph(0, 0, -1.25, 0.09, 0.08, 0.09, C.bone); b.box(0, -0.06, -1.29, 0.06, 0.04, 0.05, C.bone); b.mode('glow'); b.box(0.035, 0.015, -1.31, 0.03, 0.03, 0.02, 0x7affc8); b.box(-0.035, 0.015, -1.31, 0.03, 0.03, 0.02, 0x7affc8); b.mode('solid'); },
    'rusty-sword'(b) { b.cyl(0, 0, 0.07, 0.02, 0.02, 0.14, C.leather, Z); b.box(0, 0, -0.08, 0.2, 0.03, 0.04, 0x6a5a48); b.box(0, 0, -0.42, 0.05, 0.012, 0.7, 0x8a7a68, [0, 0, 0]); b.box(0.01, 0.007, -0.5, 0.02, 0.006, 0.4, 0x6b3b22); b.cone(0, 0, -0.77, 0.026, 0.09, 0x8a7a68, Z, 4); },
    'spiked-club'(b) { b.cyl(0, 0, 0.1, 0.035, 0.08, 0.85, 0x5a3b26, Z); for (let i = 0; i < 6; i++) { const a = i * 1.05; b.cone(Math.cos(a) * 0.08, Math.sin(a) * 0.08, -0.55 - (i % 3) * 0.1, 0.02, 0.1, C.steelD, [0, 0, a - PI / 2], 4); } },
    'big-axe'(b) { b.cyl(0, 0, 0.15, 0.03, 0.035, 1.2, C.woodD, Z); b.box(0.14, 0, -0.95, 0.3, 0.035, 0.42, C.steelD); b.box(-0.14, 0, -0.95, 0.3, 0.035, 0.42, C.steelD); b.box(0, 0, -0.95, 0.08, 0.07, 0.12, C.steel); },
    'alien-blaster'(b) { b.sph(0, 0, 0.02, 0.07, 0.07, 0.1, 0x3a6a5a); b.cyl(0, 0, -0.05, 0.03, 0.02, 0.28, 0x2a4a40, Z); b.mode('glow'); b.sph(0, 0.06, 0, 0.035, 0.035, 0.05, 0x9aff6a); b.sph(0, 0, -0.34, 0.025, 0.025, 0.025, 0x9aff6a); b.mode('solid'); },
  };
  W.staff = W['magic-staff'];
  H.weaponTypes = Object.keys(W);
  H.weaponMesh = (type, o = {}) => {
    const fn = W[type] || W.sword;
    const m = model('w:' + type, fn, { own: o.own });
    if (o.scale) m.scale.multiplyScalar(o.scale);
    return m;
  };

  // ------------------------------------------------------------------ body gear for kit actors (head/pivot slots; units of a 1.7 m person)
  // head origin is the neck: head centre (0, .17, 0), top of skull y ~ .35, face front z ~ .16
  const G = {
    ironHelm(b, c) { b.sph(0, 0.27, -0.01, 0.185, 0.13, 0.19, c ?? C.steelD); b.box(0, 0.19, 0.17, 0.035, 0.12, 0.025, c ?? C.steelD); },
    hornHelm(b, c) { G.ironHelm(b, c); for (const s of [-1, 1]) { b.cone(0.16 * s, 0.28, 0, 0.045, 0.3, C.bone, [0, 0, -0.9 * s]); } },
    greatHelm(b, c, glow) {
      b.box(0, 0.2, 0, 0.36, 0.44, 0.38, c ?? 0x2a2a32); b.box(0, 0.4, 0, 0.3, 0.05, 0.3, c ?? 0x3a3a44);
      b.mode('glow'); b.box(0, 0.2, 0.192, 0.28, 0.035, 0.012, glow ?? 0xff3a2a); b.mode('solid');
      b.box(0, 0.5, -0.02, 0.04, 0.16, 0.34, 0xa02020); // plume
    },
    hood(b, c) { b.sph(0, 0.2, -0.075, 0.2, 0.21, 0.2, c ?? 0x3a2a4a); b.cone(0, 0.32, -0.12, 0.13, 0.3, c ?? 0x3a2a4a, [-0.5, 0, 0]); b.box(0, 0.0, -0.13, 0.3, 0.25, 0.12, c ?? 0x3a2a4a); },
    crown(b, c) { b.cyl(0, 0.32, 0, 0.165, 0.17, 0.07, c ?? C.gold, 0, 9); for (let i = 0; i < 5; i++) { const a = (i / 5) * PI * 2; b.cone(Math.cos(a) * 0.15, 0.39, Math.sin(a) * 0.15, 0.03, 0.12, c ?? C.gold, 0, 4); } b.mode('glow'); b.sph(0, 0.35, 0.17, 0.025, 0.025, 0.025, 0xff3a5a); b.mode('solid'); },
    ears(b, c) { for (const s of [-1, 1]) b.cone(0.15 * s, 0.2, -0.02, 0.05, 0.3, c ?? 0x5f9b3d, [-0.2, 0, -1.4 * s]); b.cone(0, 0.14, 0.16, 0.03, 0.12, c ?? 0x5f9b3d, [PI / 2, 0, 0]); },
    tusks(b, c) { for (const s of [-1, 1]) b.cone(0.07 * s, 0.07, 0.15, 0.025, 0.12, c ?? C.bone, [0.5, 0, 0.2 * s], 5); },
    mask(b, c) { b.sph(0, 0.095, 0.03, 0.18, 0.07, 0.17, c ?? 0x7a2020); b.box(0.12, 0.08, -0.12, 0.2, 0.1, 0.04, c ?? 0x7a2020, [0, 0, 0.3]); },
    skull(b) {
      b.sph(0.06, 0.2, 0.152, 0.045, 0.05, 0.03, 0x0a0a0a); b.sph(-0.06, 0.2, 0.152, 0.045, 0.05, 0.03, 0x0a0a0a);
      b.box(0, 0.135, 0.165, 0.03, 0.04, 0.02, 0x0a0a0a);
      for (let i = -2; i <= 2; i++) b.box(i * 0.03, 0.075, 0.16, 0.022, 0.035, 0.02, C.bone);
      b.box(0, 0.09, 0.15, 0.14, 0.01, 0.02, 0x0a0a0a);
    },
    eyes(b, c) { b.mode('glow'); b.box(0.06, 0.19, 0.163, 0.045, 0.035, 0.012, c ?? 0xff3a2a); b.box(-0.06, 0.19, 0.163, 0.045, 0.035, 0.012, c ?? 0xff3a2a); },
    visor(b, c) { b.box(0, 0.2, 0.1, 0.3, 0.07, 0.14, 0x14202a); b.mode('glow'); b.box(0, 0.2, 0.173, 0.26, 0.04, 0.01, c ?? 0x40e0ff); b.mode('solid'); b.cyl(0.08, 0.34, 0, 0.012, 0.012, 0.22, C.steelD); b.mode('glow'); b.sph(0.08, 0.58, 0, 0.03, 0.03, 0.03, c ?? 0xff4040); },
    bigHead(b, c) { b.sph(0, 0.3, -0.03, 0.26, 0.32, 0.25, c ?? 0x8fb0a0); for (const s of [-1, 1]) b.sph(0.11 * s, 0.22, 0.17, 0.085, 0.11, 0.05, 0x050808, [0, 0, 0.5 * s]); b.cone(0, 0.55, -0.05, 0.02, 0.2, c ?? 0x8fb0a0); b.mode('glow'); b.sph(0, 0.76, -0.05, 0.035, 0.035, 0.035, 0x9aff6a); },
    halo(b, c) { b.mode('glow'); b.tor(0, 0.5, 0, 0.16, 0.014, c ?? 0xffe9a0, [PI / 2, 0, 0], 14); },
    spikes(b, c) { for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.cone(0.27 * s, 1.3 + i * 0.01, (i - 1) * 0.06, 0.035, 0.18, c ?? C.steelD, [0, 0, -0.9 * s + (i - 1) * 0.3 * s], 5); },
    // body gear (attach to 'pivot'; absolute metres on a 1.7 m person; shoulders y 1.29, waist 0.9)
    cape(b, c) { b.mode('cloth'); b.box(0, 0.88, -0.17, 0.46, 0.86, 0.03, c ?? 0x7a1f2a); b.box(0, 1.3, -0.14, 0.52, 0.06, 0.1, c ?? 0x5a141e); },
    pauldrons(b, c) { for (const s of [-1, 1]) { b.sph(0.285 * s, 1.31, 0, 0.11, 0.07, 0.11, c ?? C.steelD); } },
    quiver(b, c) { b.cylc(0.1, 1.15, -0.17, 0.055, 0.05, 0.5, c ?? C.leather, [0, 0, 0.3]); for (let i = 0; i < 3; i++) b.box(0.15 + i * 0.015, 1.42 + i * 0.01, -0.17 + (i - 1) * 0.03, 0.02, 0.1, 0.02, C.red, [0, 0, 0.3]); },
    robe(b, c) { b.mode('cloth'); b.cyl(0, 0.04, 0, 0.26, 0.44, 0.9, c ?? 0x4a1850, 0, 9); b.cyl(0, 0.9, 0, 0.2, 0.26, 0.35, c ?? 0x4a1850, 0, 9); },
    belt(b, c) { b.box(0, 0.87, 0, 0.5, 0.07, 0.29, c ?? C.leather); b.box(0, 0.87, 0.15, 0.07, 0.07, 0.02, C.gold); },
    backpack(b, c) { b.box(0, 1.05, -0.2, 0.34, 0.42, 0.18, c ?? 0x6a4a2a); b.box(0, 0.8, -0.2, 0.3, 0.1, 0.2, 0x4a3320); },
    wings(b, c) { b.mode('cloth'); for (const s of [-1, 1]) { b.cone(0.18 * s, 1.0, -0.2, 0.1, 0.7, c ?? 0xf6f2ff, [0.25, 0, -0.85 * s]); b.cone(0.3 * s, 1.0, -0.2, 0.08, 0.55, c ?? 0xf6f2ff, [0.25, 0, -1.2 * s]); } },
    ribs(b, c) { for (let i = 0; i < 5; i++) b.box(0, 1.2 - i * 0.075, 0.075, 0.4 - i * 0.025, 0.022, 0.02, c ?? 0x15110f); b.box(0, 1.05, 0.078, 0.03, 0.32, 0.018, c ?? 0x15110f); },
    belly(b, c) { b.sph(0, 0.98, 0.09, 0.3, 0.27, 0.24, c ?? 0xc9a06a); },
    loincloth(b, c) { b.mode('cloth'); b.box(0, 0.62, 0.1, 0.3, 0.38, 0.03, c ?? 0x6a4a2a); b.box(0, 0.62, -0.1, 0.3, 0.34, 0.03, c ?? 0x6a4a2a); },
    armor(b, c) { b.box(0, 1.06, 0, 0.5, 0.55, 0.28, c ?? 0x2a2a32); b.box(0, 0.78, 0, 0.5, 0.12, 0.3, c ?? 0x1c1c22); },
    chestGlow(b, c) { b.mode('glow'); b.box(0, 1.1, 0.09, 0.14, 0.14, 0.012, c ?? 0x40e0ff); },
    tabard(b, c) { b.mode('cloth'); b.box(0, 0.95, 0.09, 0.26, 0.7, 0.02, c ?? 0xe8e4d0); b.box(0, 1.05, 0.1, 0.07, 0.3, 0.012, 0xd9a93c); b.box(0, 1.05, 0.1, 0.2, 0.07, 0.012, 0xd9a93c); },
    scarf(b, c) { b.mode('cloth'); b.tor(0, 1.3, 0, 0.14, 0.04, c ?? 0xb83a3a, [PI / 2, 0, 0]); b.box(0.1, 1.1, 0.14, 0.07, 0.35, 0.02, c ?? 0xb83a3a); },
    apron(b, c) { b.mode('cloth'); b.box(0, 0.85, 0.095, 0.34, 0.62, 0.02, c ?? 0x3a2a22); },
    goggles(b, c) { for (const s of [-1, 1]) b.tor(0.06 * s, 0.2, 0.15, 0.045, 0.012, c ?? 0x8a6a2a, 0); b.box(0, 0.2, 0.0, 0.34, 0.015, 0.02, C.leather); },
    beard(b, c) { b.sph(0, 0.04, 0.12, 0.1, 0.16, 0.07, c ?? 0xe6e6e6); },
    bigHat(b, c) { b.cyl(0, 0.3, 0, 0.3, 0.3, 0.02, c ?? 0x3a2a55, 0, 10); b.cone(0, 0.31, 0, 0.17, 0.5, c ?? 0x3a2a55, [0.15, 0, 0.1]); b.mode('glow'); b.box(0, 0.35, 0.0, 0.2, 0.025, 0.2, 0xffd24a); },
    flowerCrown(b) { for (let i = 0; i < 7; i++) { const a = (i / 7) * PI * 2; b.sph(Math.cos(a) * 0.16, 0.3, Math.sin(a) * 0.16, 0.035, 0.035, 0.035, [0xff7aa8, 0xffe27a, 0xffffff][i % 3]); } },
    strawHat(b) { b.cyl(0, 0.3, 0, 0.34, 0.34, 0.025, 0xd9bc6a, 0, 10); b.cyl(0, 0.3, 0, 0.17, 0.15, 0.13, 0xd9bc6a, 0, 8); b.cyl(0, 0.33, 0, 0.175, 0.175, 0.03, 0xb03030, 0, 8); },
    tricorn(b, c) { b.cyl(0, 0.3, 0, 0.32, 0.32, 0.03, c ?? 0x1a1a22, 0, 3); b.cyl(0, 0.32, 0, 0.18, 0.15, 0.14, c ?? 0x1a1a22, 0, 6); b.box(0, 0.42, 0.14, 0.08, 0.08, 0.02, 0xe8e4d8); b.box(0.06, 0.19, 0.162, 0.075, 0.06, 0.012, 0x0a0a0e); b.box(0, 0.24, 0.0, 0.36, 0.014, 0.012, 0x0a0a0e, [0, 0, 0.0]); },
    mantle(b, c) { b.mode('cloth'); b.sph(0, 1.28, -0.02, 0.32, 0.12, 0.24, c ?? 0xf3f3f3); },
  };
  G.helm = G.ironHelm;
  H.gearNames = Object.keys(G);
  // H.gearMesh('hornHelm', 0xcolour, extra) -> fresh Object3D sharing cached geometry
  H.gearMesh = (name, color, extra) => {
    const fn = G[name];
    if (!fn) return new THREE.Group();
    return model(`g:${name}:${color ?? ''}:${extra ?? ''}`, (b) => fn(b, color, extra));
  };
  // gear is built in reference (1.7 m person) units and parented to a body part; the helper scales it with the actor.
  // H.dress(actor, [['head','ironHelm', colour], ['pivot','cape', colour], ...])
  const SLOT = { head: 'head', pivot: 'pivot' };
  H.dress = (a, list) => {
    for (const it of list) {
      const [slot, name, color, extra] = it;
      H.gear(a, SLOT[slot] || slot, H.gearMesh(name, color, extra), 0, 0, 0);
    }
    return a;
  };
  // creatures: gear in 0.8 m reference units, parented to the head or pivot
  H.dressCreature = (a, list) => { for (const [slot, obj, x, y, z, s, rot] of list) H.gear(a, slot, obj, x ?? 0, y ?? 0, z ?? 0, s ?? 1, rot); return a; };

  // ------------------------------------------------------------------ chest (base + hinged lid)
  // makeChest({ own, wood, band, lock }) -> { group, lid (pivot Group), base, setOpen(0..1) }
  H.makeChest = (o = {}) => {
    const wood = o.wood ?? 0x7a4a26, band = o.band ?? 0x4a4f58, lock = o.lock ?? C.gold, key = `chest:${wood}:${band}:${lock}`;
    const group = new THREE.Group();
    const base = model(key + ':base', (b) => {
      b.box(0, 0.2, 0, 0.9, 0.4, 0.56, wood);
      for (const x of [-0.32, 0.32]) b.box(x, 0.2, 0, 0.07, 0.42, 0.58, band);
      b.box(0, 0.02, 0, 0.94, 0.04, 0.6, band);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.43 * sx, 0.38, 0.27 * sz, 0.05, 0.05, 0.05, lock);
    }, { own: o.own });
    const lid = new THREE.Group(); lid.position.set(0, 0.4, -0.28);
    const lidMesh = model(key + ':lid', (b) => {
      b.cylc(0, 0, 0.28, 0.28, 0.28, 0.9, wood, [0, 0, PI / 2], 9);
      for (const x of [-0.32, 0.32]) b.cylc(x, 0, 0.28, 0.295, 0.295, 0.07, band, [0, 0, PI / 2], 9);
      b.box(0, -0.07, 0.575, 0.11, 0.15, 0.03, lock);
    }, { own: o.own });
    lid.add(lidMesh);
    group.add(base, lid);
    return { group, lid, base, lidMesh, setOpen(k) { lid.rotation.x = -k * 1.9; } };
  };

  // particle counts: H.dens(n) / H.densK() (core/library.js) follow ctx.quality.density, read at emit time.

  const { rand, pick, fightOpts } = H;
  const _pt = new THREE.Vector3();
  // ---------------------------------------------------------------- shared actor helpers (used by every catalogue file)
  // pivoted body part with its own meshes: part(parent, b => { b.box(...) }, x, y, z) -> Group
  function part(parent, fn, x = 0, y = 0, z = 0) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const b = H.mk(); fn(b); g.add(b.build({ own: true }));
    parent.add(g); return g;
  }
  function puffAt(inst, a, color, n = 8, kind = 'puff') {
    if (color === undefined) return;
    _pt.set(a.position.x, a.position.y + (a.height ?? 1.5) * 0.45, a.position.z);
    inst.burst(kind, color, _pt, H.dens(n), 0.8);
  }
  // say something the first time a target is noticed
  function shout(inst, a, f, lines, gap = 8) {
    if (!f || !lines) return;
    let had = null, next = 0;
    inst.tick((dt, t) => {
      if (a.removed || a.dead) return true;
      const tg = f.target;
      if (tg && !had && t > next) { const ct = f.ctrl; if (ct) ct.say('aggro', pick(lines)); else a.say(pick(lines), 2.4); next = t + gap; } // (ctrl.say rate-limits: every spoken line is a TTS request)
      had = tg;
    }, { every: 0.3 });
  }
  // ---- model casting. Entries describe a body as an ordered candidate list; the first candidate whose model exists in world.models wins, else the entry's
  // primitive build (skin / shirt / gear ...) is used, so a missing model (or no world.models at all) changes nothing.
  //   { model, rig?, height | size, tint, bulk, tall, hold: { right: 'sword', left: 'shield-square' }, equip: { right: '1H_Sword', left: null } (KayKit heroes' own
  //     hidden weapons), weaponType (a world.weapons type dropped when the arm is lost), wscale, gore, death, hover, bob, caster, twoHanded }
  // Preferred hero models that may land later (goblin, orc, troll, dark-knight, demon, dragon...) simply come first in the list.
  H.cast = (list) => { const K = H.kit(); return K && K.pickModel && list ? K.pickModel(list) : null; };
  const modelList = (m, o) => (!m ? undefined : [].concat(m).map((c) => {
    const cc = typeof c === 'string' ? { model: c } : { ...c };
    if (cc.height) cc.height *= o.scale ?? 1;
    if (cc.size) cc.size *= o.scale ?? 1;
    if (typeof cc.tint === 'function') cc.tint = cc.tint();
    return cc;
  }));
  H.modelList = modelList;
  function biped(inst, o, s) {
    const a = inst.person({ height: (s.h ?? 1.7) * (o.scale ?? 1), skin: s.skin, shirt: s.shirt, pants: s.pants, hair: s.hair, hat: s.hat, bulk: s.bulk, tall: s.tall, speed: s.speed, model: modelList(s.model, o), gore: s.gore });
    if (!a) return {};
    a.whenPrimitive((pa) => { // only a primitive body (no model, or the model failed to load) wears the primitive gear and weapon
      if (s.gear) H.dress(pa, s.gear);
      if (s.weapon) { const w = H.weaponMesh(s.weapon); if (s.wscale) w.scale.multiplyScalar(s.wscale); pa.equip(w); }
    });
    if (s.mgear) a.whenModel((ma) => H.dress(ma, s.mgear)); // extra gear for model bodies (crown, hat ...)
    const od = o.onDeath;
    const f = inst.fight(a, fightOpts(o, {
      faction: s.faction ?? 'enemy', hp: s.hp, damage: s.dmg, attack: s.attack ?? 'melee', range: s.range, cooldown: s.cd, windup: s.windup, aggroRange: s.aggro,
      speed: s.speed, projectile: s.proj, drops: s.drops, wander: s.wander, name: o.name,
      onDeath: (fi) => { puffAt(inst, a, s.puff, 8, s.puffKind); if (s.die) s.die(a, fi); if (od) od(fi); },
    }));
    shout(inst, a, f, s.lines);
    return { a, f };
  }
  function beast(inst, o, s) {
    const a = inst.creature({ size: s.size * (o.scale ?? 1), legs: s.legs, color: s.color, accent: s.accent, eyeColor: s.eye, speed: s.speed, bulk: s.bulk, tall: s.tall, model: modelList(s.model, o), gore: s.gore });
    if (!a) return {};
    if (s.dress) a.whenPrimitive((pa) => s.dress(pa));
    const od = o.onDeath;
    const f = inst.fight(a, fightOpts(o, {
      faction: s.faction ?? 'enemy', hp: s.hp, damage: s.dmg, attack: 'melee', range: s.range, cooldown: s.cd, windup: s.windup, aggroRange: s.aggro, speed: s.speed, drops: s.drops, name: o.name,
      onDeath: (fi) => { puffAt(inst, a, s.puff ?? 0x8a7a68, 6); if (s.die) s.die(a, fi); if (od) od(fi); },
    }));
    shout(inst, a, f, s.lines, 9);
    return { a, f };
  }
  const mdl = (key, fn, own) => H.model(key, fn, { own });
  // add an object in WORLD coordinates (under the caller's root) and remove it with the instance
  function worldAdd(inst, obj) { inst.ctx.root.add(obj); inst.track(obj); inst.cleanup(() => { obj.removeFromParent(); H.disposeOwn(obj); }); return obj; }
  Object.assign(H, { part, puffAt, shout, biped, beast, mdl, worldAdd });
}
