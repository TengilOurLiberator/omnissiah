// Builds RECOMMENDED shorter module headers (the API docs the Omnissiah receives) from the current ones, into server/eval/headers/<module>.header.txt.
// It never touches public/game. The files can be A/B tested with `run.mjs --headers server/eval/headers`, and applied by the lead / module owners
// (replace the leading `//` comment block of core/<module>.js with the file's text; `node server/eval/apply-headers.mjs --dry` shows what would change).
// Everything cut is either (a) implementation detail the Omnissiah never needs when writing a creation, (b) a duplicate of another header or of the manual,
// or (c) player-facing control detail. API signatures and behaviour he can use are kept verbatim.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';
import { headerLines } from './extract-headers.mjs';

const game = path.join(ROOT, 'public', 'game');
const outDir = path.join(ROOT, 'server', 'eval', 'headers');
fs.mkdirSync(outDir, { recursive: true });
const warnings = [];
const MOJI = [['\u00e2\u20ac\u201d', '\u2014'], ['\u00e2\u20ac\u201c', '\u2013'], ['\u00e2\u20ac\u00a6', '\u2026'], ['\u00e2\u20ac\u2122', '\u2019'], ['\u00e2\u20ac\u02dc', '\u2018'], ['\u00e2\u20ac\u0153', '\u201c'], ['\u00e2\u2020\u2019', '\u2192']];
const unmoji = (s) => MOJI.reduce((t, [a, b]) => t.split(a).join(b), s);
const orig = (name) => unmoji(headerLines(path.join(game, 'core', name + '.js')).join('\n'));

// drop(text, fromRe, toRe): remove lines from the first line matching fromRe up to (not including) the first later line matching toRe (or the end)
function drop(text, fromRe, toRe, label) {
  const lines = text.split('\n');
  const a = lines.findIndex((l) => fromRe.test(l));
  if (a < 0) { warnings.push(`no match for drop start ${fromRe} (${label})`); return text; }
  let b = toRe ? lines.findIndex((l, i) => i > a && toRe.test(l)) : lines.length;
  if (b < 0) b = lines.length;
  return [...lines.slice(0, a), ...lines.slice(b)].join('\n');
}
function replaceBlock(text, fromRe, toRe, replacement, label) {
  const lines = text.split('\n');
  const a = lines.findIndex((l) => fromRe.test(l));
  if (a < 0) { warnings.push(`no match for block start ${fromRe} (${label})`); return text; }
  let b = toRe ? lines.findIndex((l, i) => i > a && toRe.test(l)) : lines.length;
  if (b < 0) b = lines.length;
  return [...lines.slice(0, a), replacement, ...lines.slice(b)].join('\n');
}
const sub = (text, from, to, label) => { if (!text.includes(from)) { warnings.push(`substring not found (${label}): ${from.slice(0, 50)}`); return text; } return text.replace(from, to); };
const write = (name, text) => { text = text.replace(/\n{3,}/g, '\n').replace(/\n\/\/\s*$/gm, '\n//').trimEnd() + '\n'; fs.writeFileSync(path.join(outDir, name + '.header.txt'), text); };

// ---------------------------------------------------------------- hand-written replacements for modules whose header is mostly internals
write('world', `// core/world.js — the stage: twilight field, sky, light, fog, grass, glow-motes, far standing stones, a lake. Nothing to call except the services below.
// THE LAKE: centre (-30, -78), ~48 m long, up to ~1.7 m deep.
// MIXED REALITY (Quest passthrough, env.passthrough / ctx.input.passthrough true): sky, terrain, lake, grass, mist and stones are hidden, scene.background/fog are null, groundHeight is 0 everywhere (the real floor),
//   the rig sits at the origin; the player's real room is the stage. Keep things small and near (within ~2.5 m); never set scene.background or fog. kit.particles already uses an alpha-safe blend there.
//
//   world.groundHeight(x, z) -> metres, allocation-free. Within 60 m of the origin it is ±~1.4 m and smooth (h(0,0) = 0); beyond, soft hills up to ±25 m; the lake is a bowl.
//
//   world.env — restyle the world cheaply (all colour args: THREE.Color | 0xRRGGBB | 'css string'). Changes ease in over ~1.5 s. All methods return env.
//       setSkyColors({ zenith, horizon, mid? })  sky gradient (fog and light tint follow the horizon)
//       setFog(color|null|undefined, density?)   null = re-follow horizon, undefined = unchanged; density is FogExp2, clamped [0.0036, 0.05] (default ~0.0046)
//       setGrassColor(color)                     grass + ground tint
//       setTimeOfDay(t)                          0 = deep night (stars, aurora), 0.5 = twilight (default), 1 = golden hour. Resets custom sky/fog colours.
//       setStars(0..1)  setAurora(0..1)  setWind(0..1 | null = natural gusts)  setTransition(seconds; 0 = instant)
//       setWater({ color, level, enabled })      the lake: shallow tint, surface height (clamped [-2.0, -0.6], default -1.4), enabled:false hides it
//       isWater(x, z) -> boolean                 true where the lake covers the ground (keep things out of it / splash into it)
//     Read-only: env.wind, env.timeOfDay, env.passthrough, env.waterLevel, env.lake { x, z, radius }, env.palette (live colours, do not mutate), env.sunDirection.
//     Whole-place changes (terrain, ground palette, ocean, sky picture) belong to world.travel; do not call env.setTerrain / setGround / setOcean / setSkyPano yourself.
//   Restore anything you change when your creation is disposed (or use a library weather/time entry: night, dusk, day, rain, snow, storm, fog-bank, aurora restore themselves).
`);

write('style', `// core/style.js — world.style: ONE global, toggleable look for everything in the scene (also things created later). Settings persist across hot reloads.
//   const style = ctx.world.style;                       // guard: it may be reloading
//   style.preset('storybook' | 'flat' | 'noir' | 'neon' | 'pastel')   // restyle the whole world in one call ('storybook' is the default look)
//   style.set({ toon, bands, softness, rim, rimColor, saturation, fill, outline, outlineWidth, outlineColor, reflections, reflectionStrength, contactShadows })
//   style.get() -> copy of the settings     style.presets -> the settings each preset applies
//   toon true|false|0..1 banded light on every lit material (bands 2..6, softness 0.02..1)    rim 0..1.5 fresnel rim light (rimColor: colour or null = sky tint)
//   saturation -1..1: +0.2 punchier, -0.3 pastel, -1 black and white    fill 0..1 lifts shadowed sides (soft, pastel look)
//   outline true|false ink outlines on characters/props (PC tier only; outlineWidth px, outlineColor)    reflections true|false (sky reflections on metals/glTF)
//   contactShadows true|false soft blob shadows under things (the Quest's substitute for shadow maps)
//   Opt an object out with  object.userData.noOutline = true  /  object.userData.noShadow = true.
//   Examples:  style.preset('noir')   style.set({ bands: 2, rim: 0.8, rimColor: 0x66ccff })   style.set({ saturation: -1 })   Event 'style:changed' fires after every change.
//   "Comic book" = preset('flat') or set({ bands: 2, outline: true, saturation: 0.3 });  "black and white" = preset('noir') or set({ saturation: -1 }).
`);

write('oracle', `// core/oracle.js — THE OMNISSIAH'S OWN BODY: a colossal raymarched Mandelbulb star-mind (obsidian body, molten-gold veins, corona, three crystal rings, runes, arcs, god rays, a hex-iris eye
// that follows the player). It reacts to spells, kills, damage, deaths and new creations by itself, and falls asleep after ~100 s of nothing. Everything lives under ctx.root.
// ---- HOOKS for you / creations (safe at any time; bad arguments are ignored) ------------------------------------------------------------
//   world.oracle.position (Vector3), .radius, setState(s), pulse(strength), getState()
//   world.oracle.flare(color, strength = 1)        colour burst: tints the core + corona + eye, sparks arcs and a sound ring. color: 0xff4400 | '#ff4400' | THREE.Color | [r,g,b] (0..1)
//   world.oracle.beamTo(point, { color, duration = 1.6 })   beam of light from the core to a world point (Vector3 or [x,y,z]) with an impact disc; up to 3 at once -> bool
//   world.oracle.setMood('serene' | 'wrathful' | 'joyful' | 'ominous' | 'default')   cross-fades palette, tempo, heartbeat, lightning rate (null = default) -> bool;  getMood()
//   world.oracle.lookAt(point | null)              the eye follows this world point instead of the player (null = watch the player)
//   world.oracle.wake()    world.oracle.creation(point?)  the full "act of creation" set-piece at a point (default: where the player aims; it already plays for every new creation file)
//   world.oracle.limitQuality(maxTier | null) / .quality   (core/perf.js owns these; do not call)
// To change how you LOOK for good ("turn yourself blue", "more rings"), edit this file's palette/uniform constants; for a moment, use flare/setMood. In mixed reality you hover as a small apparition near the table.
`);

write('perf', `// core/perf.js — world.perf: measures every frame, keeps 72 fps by itself (degrades grass, particles, crowds, sky, outlines ... then recovers), and tells you what you can afford.
// BUDGET PER EYE (world.perf.budget holds the LIVE numbers and they shrink when the governor degrades):
//   'quest' (standalone headset): scene <= ~150 draw calls, <= ~200k triangles, ONE light, <= 24 fighters, <= 80 kit bodies, <= 24 particle systems. Prefer InstancedMesh / models.instances / kit.particles.
//   'pc' (desktop or Link): <= ~1500 draw calls, <= ~4M triangles, <= 80 fighters. Creation rule everywhere: <= 20 draw calls, no per-frame allocation, no new lights, no shadow maps, share geometries and materials.
// ASK BEFORE YOU SPAWN (guard: ctx.world.perf?.…):
//   perf.allow(kind, n) -> how many of n fit right now (spawn that many instead of refusing)   perf.canSpawn(kind, n = 1) -> bool   perf.headroom(kind) -> units left
//   kind: 'fighters' | 'bodies' | 'particles' | 'actors' | 'drawCalls' | 'triangles'.   Library spawns, waves and combat.fighter() already do this for you.
//   const n = ctx.world.perf ? ctx.world.perf.allow('fighters', 20) : 20;   // spawn n, not 20
// READ: perf.stats() -> { tier, fps, frameMs, p95, level, calls, tris, ... } (shared object: copy)   perf.report() text   perf.overlay(true|false) debug panel   perf.mode = 'auto' | 'quality' | 'performance'
// Every change fires 'quality:changed' and mutates ctx.quality (density, maxLights, ...). Far objects are hidden (userData.perfCulled); set userData.noCull = true on anything that must always render.
`);

write('ambience', `// core/ambience.js — procedural wind + sacred drone + bell chimes; world.audio (core/audio.js) crossfades recorded ambience beds in by what stands around the player (forest, village, tavern, dungeon, ...).
//   world.ambience = { setVolume(v) 0..2 (1 default), setMood('serene' | 'luminous' | 'ominous'), getMood(), getVolume(), getZone() }.  Ducks while the Omnissiah speaks. Wind follows world.env.wind.
`);

write('commentary', `// core/commentary.js — LIVE COMMENTARY: you watch the player and remark on it unprompted (outside wish turns; the server asks a quick separate run for one line). This module only observes and sends digests.
// ---- API for you / creations: world.commentary --------------------------------------------------------------------------------------
//   .enabled (boolean, persists, assignable)   .setEnabled(bool)   "stop commenting" -> setEnabled(false); "comment more" -> setEnabled(true) and frequency = 'chatty'
//   .frequency  'chatty' | 'normal' | 'rare'   (min gap 12 s / 25 s / 60 s; idle remark 60 s / 2 min / 5 min). Assignable; persists.  "talk less" -> 'rare'
//   .note(line, { dramatic })   feed an observation from a creation, e.g. commentary.note('The player beat the racetrack lap record: 41 s.', { dramatic: true }). A plain factual sentence with numbers.
`);

write('spells', `// core/spells.js — world.spells: the spell registry, casting and the spell wheel.
//   world.spells.register({ id, name, color, cast(args), icon?, description?, rate?, hold?, onRelease? }) -> unregister()
//     id string (re-registering an id replaces it: hot-swap). name/color/icon (emoji or 1-2 letters)/description (one short sentence) show on the wheel.
//     A spell registered after startup becomes the SELECTED one automatically (and is announced): no need to call select().
//     cast({ origin, direction, hand, ctx }): FRESH Vector3s (hand tip + pointing ray); hand = input.right. A spell uses its own creation's ctx. Runs in try/catch.
//     rate (seconds): holding the trigger auto-repeats the cast every \`rate\` s.
//     hold: true -> continuous spell: cast() is called EVERY FRAME while the trigger is held with { origin, direction, hand, ctx, dt, first, hold: true } (REUSED vectors: copy, never keep);
//       onRelease({ hand, ctx }) once when released / switched away. Keep per-frame work allocation-free.
//   world.spells.list() -> [{ id, name, color, icon, description, hold, rate }]   current()   select(id) -> bool (use it to switch to an EXISTING spell)
//   world.spells.bodies() -> live kit bodies, for pull/push/grab spells
// CONTROLS (tell the player): right trigger casts; right A tap = next spell, hold A = the spell wheel (point at one, release); a weapon in the right hand takes the trigger instead.
// Emits 'spell:cast' { id, origin, direction } and 'spell:select' { id }. About 30 starter spells already exist as creations/spell-*.js (the loaded-module list names them; Grep 'export const meta' creations/spell-*.js for descriptions): check before writing a new one.
`);

// ---------------------------------------------------------------- operation-based trimming of the big headers
{ // kit.js
  let t = orig('kit');
  t = drop(t, /^\/\/ PERFORMANCE \(core\/perf\.js scales ctx\.quality/, /^\/\/ HOT RELOAD/, 'kit perf');
  t = drop(t, /^\/\/ HOT RELOAD/, null, 'kit hot');
  t = replaceBlock(t, /^\/\/ GORE \(stylised/, /^\/\/ DESTRUCTION/, `// GORE (stylised chunky-toy dismemberment; the weapons / spells you give already trigger it)   actor gore: 'blood' (default) | 'bones' | 'sparks' | 'slime' | 'none'; kit.damageable({ gore }) default none.
//   Slashes sever limbs, explosions burst, blunt blows launch ragdolls, fire chars, frost shatters, shock/magic dissolve. actor.limbs { head, armL, armR, legL, legR }, actor.sever('armL', dir?) -> bool,
//   actor.armsLeft / legsLeft / hasHead, actor.onSever = (limb, actor) => {}; event 'limb:severed' { actor, limb, kind, by }; losing the head kills. Ragdolls need world.physics.
//   kit.gore.level = 'full' | 'mild' | 'off'  — honour "less blood" / "turn the gore off" (stored in ctx.state; off = nothing comes off). kit.gore.clear() wipes parts/blood/debris now.
//   kit.dismemberable(ctx, damageable, [{ name, object3D, vital }], { gore }) -> { limbs, sever(name, dir) }  makes child meshes of a custom monster severable.
//`, 'kit gore');
  t = drop(t, /^\/\/   Dismemberment: a limb's bones collapse/, /^\/\/   People: knight barbarian/, 'kit dismember');
  t = drop(t, /^\/\/   People: knight barbarian/, /^\/\/   kit\.modelBody/, 'kit people');
  t = drop(t, /^\/\/     Scenery colliders: with world\.physics/, /^\/\/   kit\.structure/, 'kit colliders');
  write('kit', t);
}
{ // combat.js
  let t = orig('combat');
  t = drop(t, /^\/\/ PERFORMANCE \(core\/perf\.js\)/, /^\/\/ PROJECTILES/, 'combat perf');
  t = drop(t, /^\/\/   PHYSICS \(when world\.physics exists\)/, /^\/\/   MODEL ACTORS/, 'combat physics');
  t = drop(t, /^\/\/ HOT RELOAD/, null, 'combat hot');
  write('combat', t);
}
{ // weapons.js
  let t = orig('weapons');
  t = drop(t, /^\/\/ PLAYING /, /^\/\/ CUSTOM/, 'weapons playing');
  t = drop(t, /^\/\/   model: \{ name: 'sword'/, /^\/\/   tick\(weapon/, 'weapons model fit');
  t = drop(t, /^\/\/ HOT RELOAD/, null, 'weapons hot');
  t = sub(t, '// CUSTOM   W.define', '// PLAYING: squeeze near a weapon (or point at it within 5 m and squeeze) to hold it; release to throw; a held weapon takes that hand\'s trigger. Melee damage scales with swing speed (2 -> 5.5 m/s = 30% -> 100%);\n//   bows draw while the trigger is held; shields block from the front. Two-handed guns aim along the line between both hands.\n// CUSTOM   W.define', 'weapons custom');
  write('weapons', t);
}
{ // models.js: condensed catalogue
  let t = orig('models');
  t = replaceBlock(t, /^\/\/ CATALOGUE \(generated/, /^\/\/ CATALOG-END/, `// CATALOGUE (most used; M.find('wizard tower') -> the best catalogue name or null at run time, M.list({ category, search }) -> names; names are kebab-case)
// CATALOG-BEGIN
//   heroes (KayKit rig, ~95 clips, hidden weapons: h.equip): barbarian knight mage rogue rogue-hooded.   villagers (tiny, 1 draw): villager-{male,female}-{a..f} gravekeeper mini-adventurer
//   enemies: bone-walker ghost orc skeleton-mage skeleton-minion skeleton-rogue skeleton-warrior vampire zombie (+ goblin troll demon dark-knight goblin-shaman orc-warrior via the KayKit rig)
//   animals (cute cubes: idle/walk/run/eat/dance): beaver bee bunny cat caterpillar chick cow crab deer dog elephant fox giraffe hog koala lion monkey panda parrot penguin pets-fish pig polar tiger
//   weapons (origin = grip; use h.hold): sword greatsword dagger axe great-axe staff wand crossbow spellbook shield-{round,square,spikes,badge} blaster-{a..r} grenade-{a,b} tool-{axe,hammer,hoe,pickaxe,shovel}
//   buildings, each in -red -blue -green -yellow: archeryrange barracks blacksmith castle church home-a home-b lumbermill market mine tavern tower-a tower-b tower-catapult watermill well windmill
//   structures: castle-* (wall-*, tower-*, gate, bridge-*), dungeon wall-*/floor-*/pillar/stairs, village/graveyard fence-*, crypt-*, hedge-*, road*, bridge-{wood,stone,straight}, arch, fountain-*, pillar-*, tower-complete-*
//   vehicles & siege: boat-row-{large,small} ship-{small,medium,large,ghost,wreck,pirate-*} cannon cannon-mobile siege-{ballista,catapult,ram,tower,trebuchet} (+ -demolished)
//   props: barrel box crate chest chest-gold coin key lantern torch campfire-{pit,stand,logs,stones} candle-* cart wheelbarrow workbench-* anvil bucket altar-stone banner-* flag-* grave* gravestone-* skull ribcage
//     pumpkin-* hay-bale sack shelves signpost stall-* tent-* tool-paddle weaponrack urn-* target
//   furniture: armchair bed-* bench bookcases/shelf-* cabinet-* chair-* couch lamp-* rug-* stool table-*    trees: tree tree-{oak,pine-*,palm-*,dead-*,autumn,fat,tall,thin,detailed,...} trees-{a,b}-*
//   nature: bush/plant-bush-*, flower-{red,yellow,purple}-*, grass, mushroom-*, rock-* rocks-* stone-*, stump-*, log*, hill-*, hills-*, mountain-*, cactus-*, cloud-*, crop-*, waterlily-*, waterplant-*, lily-*
//   campsite: bed campfire-{bricks,logs,planks,stones} canoe pot-{large,small} sign statue-{block,column,head,obelisk,ring} tent-{detailed-*,small-*}
// CATALOG-END`, 'models catalogue');
  write('models', t);
}
{ // menu.js
  let t = orig('menu');
  t = drop(t, /^\/\/ HOOKS for other modules/, null, 'menu hooks');
  write('menu', t);
}
{ // travel.js
  let t = orig('travel');
  t = drop(t, /^\/\/ HOW IT WORKS/, null, 'travel how');
  write('travel', t);
}
{ // physics.js
  let t = orig('physics');
  t = drop(t, /^\/\/ HOT RELOAD/, null, 'physics hot');
  write('physics', t);
}
{ // audio.js
  let t = orig('audio');
  t = drop(t, /^\/\/   DOUBLING /, /^\/\/ PACK NAMES/, 'audio doubling');
  write('audio', t);
}
{ // games.js: the "writing a game" authoring reference is rarely needed; point at it instead
  let t = orig('games');
  t = replaceBlock(t, /^\/\/ WRITING A GAME/, null, `// WRITING A NEW GAME (only when the wish is a game no entry covers): games/<file>.js with  export const meta = { name, title, aliases[], description, hint, icon, distance, size, par, physics };
//   export default function (g) { build the venue; return { reset(level), play(level), update(dt, t), stop?(why), dispose?() } }.  Read an existing file in games/ for the g.* helper API (g.at, g.builder, g.body, g.spawn,
//   g.addScore, g.setTime, g.end, g.later, g.every, g.sfx, g.pop, g.float, g.hands ...) before writing one; a simple one-off game can be a plain creation instead.`, 'games writing');
  write('games', t);
}

// library: compact catalogue generated from the live entries (headless boot of the real library)
fs.writeFileSync(path.join(ROOT, '.cache', 'eval', 'headers-build-warnings.txt'), warnings.join('\n'));
console.log('headers written to', outDir);
if (warnings.length) console.log('WARNINGS:\n' + warnings.join('\n'));



