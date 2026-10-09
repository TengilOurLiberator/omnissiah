# Omnissiah performance: governor, budgets, audit, first headset session

Status: nothing in this document has been measured on a Quest 3. Everything marked *proxy* was measured with software
rendering (SwiftShader) in headless Edge, which only tells you how much each knob removes relative to the others.
Everything marked *estimate* is reasoning from the code. Replace both with real numbers after the first headset session
(see section 7).

Files: `public/game/core/perf.js` (the governor, `world.perf`), `core/style.js` and `core/world.js` (live-tunable),
`server/plugins/perf.js` (report log). Source of truth for the knobs is the `LADDERS` / `DEFAULTS` tables at the top of `perf.js`.

---------------------------------------------------------------------------------------------------------------------------

## 1. What `world.perf` does

Every frame (no allocation, ~0.1 us of work in Node): frame interval from the rAF clock into a 360-frame ring + histogram
(p50 / p95 / p99, % frames over budget, worst hitch), `renderer.info` (draw calls and triangles **per eye**: the XR render
counts both eyes, so perf divides by the camera count; `programs`, `geometries`, `textures`), counts from services every 0.5 s
(`kit.stats()`, `combat.fighters`, `models.stats()`, `physics.stats()` if it exists), JS time per module (perf wraps every
module's `update` found in `window.game.modules`, 2 `performance.now()` calls each), CPU time spent inside `renderer.render`
(the CPU cost of building draw calls: usually the real Quest bottleneck), and GPU time through
`EXT_disjoint_timer_query_webgl2` when the browser has it (feature-detected, `gpuMs = -1` when not; the Quest browser probably
does not expose it, desktop Chrome does).

**Budget** = the display refresh: `session.frameRate` in XR (72 / 80 / 90 / 120, re-read on `frameratechange`), else an estimate,
else 72 on `quest` / 90 on `pc`; 60 Hz for the flat desktop view. A missed vsync at 72 Hz is ~27.8 ms, not 14 ms, so a frame
counts as *missed* above 1.25 x budget, and "locked at half rate" is detected explicitly (>= 75 % of the last 64 frames within
1.7 to 2.4 x budget): the governor then reacts after 0.9 s instead of 1.5 s. Frames > 250 ms (shader compiles, GC, tab
switches) are counted as hitches and are **not** fed to the governor.

**Governor** (`createGovernor`, pure, tested in Node): `level` 0 = best .. `floor`.
- degrade after 1.5 s over budget (bad-frame fraction > 25 % or EMA > 1.2 x budget); 2 rungs at once if the EMA is > 2.2 x budget;
- recover after 12 s comfortably under (no more than 4 % missed frames; and, when measured, CPU < 85 % and GPU < 85 % of the
  budget), one rung at a time;
- 2 s settle time after every change; the display rate is lowered first (90 -> 72) before any visual is sacrificed;
- never oscillates: when a rung recovered into fails again within 30 s, retrying it is blocked for 30 s, then 60, 120 ... up to 300 s;
  a rung that survives 30 s resets its penalty. (Synthetic trace, near-budget scene: probes at 16, 49, 112, 235, 477, 780 s.)
- the floor is a hard lower bound; reaching it while still over budget sends a report (rate limited to once per 3 min).

Modes (`perf.mode`, persisted in localStorage `omnissiah.perf`): `'auto'` (default), `'quality'` (pinned at level 0, governor
off), `'performance'` (starts at rung 4 on Quest / 3 on PC, can still go lower, never recovers above it), `'manual'`
(only `perf.setLevel(n)`). A new session starts at most 2 rungs better than where the last one ended.

### API (also in the AI-facing header of `perf.js`)

```
perf.stats()            shared object: tier fps frameMs p50 p95 p99 overPct worstMs hz budgetMs level floor rung mode calls tris
                        points lines programs geometries textures cpuMs renderCpuMs gpuMs(-1 n/a) bound('cpu'|'gpu'|'?'|'-')
                        halfRate culled xr drops recoveries hitches supersampleNext counts{fighters bodies particles actors lights parts debris animated ...}
perf.report()           multi-line string (see 7.2)
perf.level / .floor / .rung / .mode (get+set) / .ladder() / .setLevel(n) / .tune({dropAfter, recoverAfter, settle, hitchMs, ...})
perf.budget             { fighters bodies particles actors drawCalls triangles }  LIVE, shrinks to 40 % at the floor
perf.canSpawn(kind, n)  kind: fighters|bodies|particles|actors|drawCalls|triangles (+ aliases)   unknown kinds are never refused
perf.allow(kind, n)     how many of n fit now;  perf.headroom(kind)
perf.mark(name) / perf.since(name)   cost of what a creation added (calls, tris, geometries, textures, ms), wait a few frames
perf.overlay(bool)      head-locked canvas panel, redrawn <= 2 Hz (fps, p95/p99, draws, tris, cpu/gpu, level, population)
perf.modules()          JS ms per module, sorted;   perf.recommended()  { supersample, reason } for the next session
perf.setFrameRate(hz), perf.setTarget(hz) (flat-view budget), perf.cull(bool), perf.sendReport(reason), perf.history
world.contextProviders.perf = () => ({ tier, fps, level })      (sent with every utterance)
```
Events: `quality:changed { changed, level, rung, reason, tier }` (`changed` holds only the knobs whose value changed),
`perf:floor { level, tier }`.

### Distance culler (in perf.js)

Top-level children of every `module:*` root except world / oracle / style / perf / player / spells / menu / commentary / quests /
voices / audio / ambience are hidden (`visible = false`, `userData.perfCulled = true`) when
`distance(head, bounding-box centre) - bounding radius > quality.cull`, shown again inside 0.92 x that. Bounds are measured once
per 6 s per object (<= 3 measures per frame, so a spawn burst is spread out), the check itself is a few multiplications on
`matrixWorld`. Skipped: `userData.noCull`, lights, points, lines, sprites, instanced meshes, any mesh with
`frustumCulled = false`, objects with a bounding radius > 120 m, and anything that was already hidden by its owner (perf only
un-hides what it hid). There is no fade: fog is already 85 % at 300 m, so popping is invisible beyond ~250 m; at the deepest
rungs (cull 140 / 100 m) it is visible. Culled things still *simulate*, mixers included (see hook H5).

---------------------------------------------------------------------------------------------------------------------------

## 2. The ladders (cumulative; level N = defaults + rungs 1..N)

Knobs and who consumes them today:

| knob (`ctx.quality.<field>`) | consumer | live now? |
|---|---|---|
| `foveation` (fov) | perf: `renderer.xr.setFoveation` | yes (XR only; three applies boot's 1.0 at session start, perf re-applies its baseline 0.5 on `xr:start`) |
| `grass` 0..1 | world.js: instance count + patch radius (+ tufts on PC) | yes |
| `motes` 0..1 | world.js: glow-mote instance count | yes |
| `sky` 0/1/2 | world.js: uniform, stars/aurora/clouds skipped at 0 (+ second PC layers at <2) | yes |
| `water` 0/1/2 | world.js: off / cheap ripples / full | yes |
| `mist`, `terrainDetail`, `shadowMap`, `skyLate` | world.js (PC features and the late-sky switch) | yes |
| `blobs`, `outlines`, `outlineCap`, `reflections`, `rim` | style.js | yes |
| `cull` (m) | perf culler | yes |
| `density` (x tier base) | modules that read `ctx.quality.density` | **nobody reads it yet** except the old world.js grass (now `grass`) -> hook H3 |
| `maxLights` | kit.js | **not read** (kit has `const MAX_LIGHTS = 6`) -> hook H2 |
| `gore` + `kit.gore.caps.parts/bleeds` | perf writes the caps directly | yes (parts, bleeds only; debris/decal pools are fixed-size) |
| `animStride` (anim) | models.js `tick` | **not read** -> hook H5 |
| `fighterThink` (think) | combat.js `think` interval | **not read** -> hook H4 |
| `oracle` -> `world.oracle.limitQuality(n \| null)` | oracle.js | **hook missing** -> H6 |
| `bloom` | perf toggles `quality.bloomPass.enabled` (flat view) | yes |

Quest ladder (defaults: foveation 0.5, grass 1, sky 1, water 2, blobs 120, cull 380 m, density 1, lights 6):

| L | rung | sets | what the player notices |
|---|---|---|---|
| 1 | foveation | fov 1.0 | blur at the edge of the lens |
| 2 | grass-80 | grass .8, motes .8 | a little thinner grass |
| 3 | cull-300 | cull 300, blobs 64, anim 1.5 | nothing (fog) |
| 4 | sky-lite | sky 0, water 1 | no stars / clouds / aurora, flatter lake ripples |
| 5 | density-75 | density .75, gore .75, grass .6, think 1.5 | slightly smaller crowds / sparks |
| 6 | cull-200 | cull 200, anim 2, oracle <= 1 | far objects vanish earlier; fractal one tier lower |
| 7 | grass-40 | grass .4, motes .5, rim off, blobs 32 | sparse grass, no rim light |
| 8 | density-50 | density .5, gore .5, lights 4, cull 140, anim 3, think 2, oracle 0 | visible pop-out at 140 m, fewer particles |
| 9 | floor | grass .15, motes .25, water off, density .35, gore .25, lights 3, cull 100, anim 4, think 3, blobs 16, skyLate | bare field, no lake; still recognisably the game (screenshot below) |

PC (desktop / Link) ladder (defaults: foveation 0, shadow 4096, outlines 150, bloom, mist, cull 700 m): 1 shadow-2k, 2 bloom-off +
mist-off, 3 outlines-80 + reflections-off + terrain-detail-off, 4 grass-70 + density-.72 + shadow 1024 + foveation .5, 5 sky 1 +
outlines off + cull 450 + anim 1.5, 6 shadow off + grass .45 + density .48 + water lite + blobs 64 + foveation 1, 7 floor (sky 0,
grass .25, density .32, gore .5, lights 6, cull 250, blobs 32, anim 3, think 2, oracle 1). The 5090 should sit at level 0; on
Link perf also raises the display rate (72 -> 90 -> 120) when the CPU/GPU measures show < 50 % use, and falls back with a back-off.

Framebuffer scale cannot change inside a WebXR session. perf computes `perf.recommended().supersample` (x0.85 after a session that
hit the floor or averaged above 55 % of the ladder; x1.1 after 2+ minutes at level 0 without a drop; clamped 0.6..1.0 on Quest,
0.8..1.8 on PC) and writes it to `localStorage['omnissiah.supersample']` at session end -> hook H1.

Shadow "off" on PC is deliberately **not** `sun.castShadow = false` (that changes the light state and recompiles every lit
material): it stops the shadow pass (`renderer.shadowMap.autoUpdate = false`) and zeroes `sun.shadow.intensity`.
Reflections off *does* change `scene.environment` and costs a one-time program recompile (PC only, deep rung).

---------------------------------------------------------------------------------------------------------------------------

## 3. Hooks wanted from files perf does not own

| # | file | hook | why |
|---|---|---|---|
| H1 | boot.js | read `localStorage['omnissiah.supersample']` before `setFramebufferScaleFactor` and call it for **both** tiers (today only PC calls it): `const r = parseFloat(localStorage.getItem('omnissiah.supersample')); if (r > 0) quality.supersample = r; renderer.xr.setFramebufferScaleFactor(quality.supersample);`. Also change `renderer.xr.setFoveation?.(1)` to 0.5 (perf takes over on `xr:start` anyway). | the only way to change resolution; Quest default scale is 1.0 |
| H1b | boot.js | per-module timing: wrap `m.instance.update(...)` in the main loop with `performance.now()` pairs and store `m.ms` (perf does this itself today by wrapping `instance.update` from `window.game.modules`; native timing would also capture hot-reload edge cases) | JS time per module |
| H1c | boot.js | `window.game.perf` is not needed; but `sweepShadows` (boot.js:98) walks the whole scene every 0.5 s on PC: allow `quality.shadowSweep = false` | PC CPU hitch |
| H2 | kit.js | `MAX_LIGHTS = Math.min(6, ctx.quality.maxLights)` read **every frame** in `stepLights`; **pre-create all pool lights at load** (the pool grows lazily from 0, every growth step recompiles every lit material, a visible stall in the middle of the first fight) and keep the count constant; changing `maxLights` at runtime should only lower `intensity`/`visible` of lights above the cap if the count stays constant | 6 point lights are evaluated per lit fragment even at intensity 0 |
| H3 | kit.js, library, weapons, combat | multiply particle counts / gore bursts / crowd sizes by `ctx.quality.density` (and re-read it per spawn); `kit.particles` clamp `count` | density is the governor's main population knob |
| H4 | combat.js | `f.thinkT = rand(0.18, 0.34) * (ctx.quality.fighterThink ?? 1)`; set `world.combat.maxAttackers` from `quality.density` (it is already a live number); ask `world.perf?.allow('fighters', n)` in `combat.fighter` / `library.wave` and return `null` / trim | population governor |
| H5 | models.js | in `tick`: multiply `stride` by `ctx.quality.animStride ?? 1`; **skip the mixer entirely when `this.object.visible === false` or `userData.perfCulled`** (an ancestor flag: walk once per 0.5 s); cap fully-animated characters (nearest 12) | skinned characters are the biggest CPU item |
| H6 | oracle.js | `world.oracle.limitQuality(maxTier \| null)`: clamp `vrCap` (0..2); and expose `world.oracle.quality()` returning `{ level, cap, frameEma }`. perf calls `limitQuality(1)` at rung 6 and `(0)` at rung 8, `null` otherwise. Its own 18.5 ms / 2.5 s governor stays; perf only lowers the ceiling. Corona/shock/sound-ring quads (see audit A1) should be skipped at tier 0 | the fractal is probably the most expensive thing on screen |
| H7 | spells.js | the pointer dot (`spells.js:145`, opaque, `depthTest:false`) is the one object that breaks a depth-tested sky; set `dot.renderOrder = 1e6 + 1` (and `material.transparent = true`) so perf can use `skyLate` | late-sky draws the sky after the opaque pass so terrain-covered sky pixels are never shaded |
| H8 | library.js / combat.js | `if (world.perf && !world.perf.canSpawn('fighters', n)) n = world.perf.allow('fighters', n)`; the Omnissiah prompt already contains the perf header | population governor |

---------------------------------------------------------------------------------------------------------------------------

## 4. Static audit (Quest standalone). Severity: estimate.

A = GPU fill / shader, B = CPU per frame, C = hitches and allocations. "Knob" = what mitigates it; **own** = already implemented in
the files perf owns, **hook Hn** = needs another owner (section 3).

### A. GPU

| id | where | finding | sev | knob |
|---|---|---|---|---|
| A1 | `oracle.js:375,830` + shaders (`CORONA_R = 2.8`, `SHOCK_R = 5.5`, 6 sound rings at 3.3 radii) | the additive corona quad is 2.8 sphere radii *half*-size: the sphere sits 270 m away with radius 76 m, so the quad spans roughly +/-38 degrees: a large share of each eye buffer runs the corona shader (plus 12 god-ray quads, 640 motes, 66 runes, ribbons, eye, all additive, blended = read-modify-write). The raymarch itself is 28..46 steps x 4..6 iterations over a ~30 degree disc | HIGH | H6 (skip corona/rays below tier 1; quad size by tier); oracle self-governor; foveation (own) |
| A2 | `world.js` `SKY_FRAG` (line ~191) | the dome is drawn first with `depthTest:false` over **every** pixel, then the terrain covers the lower half: 6+ hash31 per star, 2 fbm (3 octaves each), aurora with atan, per fragment | HIGH (before) | own: pixels below the horizon (`d.y < -0.04`) now take a 4-instruction path; `sky` 0 skips stars/aurora/clouds; `skyLate` (needs H7) |
| A3 | `world.js` `GRASS_VERT` (~350) | 22 000 instances x 9 vertices = 198 k vertices per eye, each evaluating `terrainH` (about 20 sines + the lake bowl) and `patchVal` (3 more). Vertex-bound on a tiled mobile GPU. ~30 % of the instances were beyond the fade distance and still paid it | HIGH | own: early-out for faded instances (moves 0 cost to ~70 %), `grass` knob (count + patch), glow motes call `terrainH` twice per vertex (`GLOW_VERT`, 360 x 4 vertices: small). Further option for the owner of world.js: one height lookup per *instance* (a 128x128 height texture re-rendered on re-centre) instead of per vertex = 9x less |
| A4 | `style.js` `STYLE_PARS` | the toon patch runs `styleSat()` three times per light per fragment and `styleRim` (a `pow`) on every lit fragment; `styleBand` has `floor/smoothstep/mix`. With 1 hemi + 1 sun + up to 6 point lights this is ~8 light evaluations per lit pixel; the terrain (about half the screen) is a Lambert material with all of them | MED | own: `rim` knob (uniform, free); `maxLights` (H2) is the big one; removing the patch entirely (`style.set({toon:0, rim:0, saturation:0})`) is a recompile, last resort |
| A5 | `world.js` `WATER_FRAG` (~602) | transparent full-quad lake: 4 cosines + 2 noise + fbm lace + foam + fresnel + sky lookup per fragment, drawn over the terrain (overdraw) | MED | own: `water` 1 (skips ripples+noise+lace), 0 (off) |
| A6 | `style.js` outlines | PC only: an inverted hull per mesh doubles draw calls and skinned work for up to 150 meshes | MED on PC, 0 on Quest | own: `outlines`, `outlineCap` |
| A7 | `boot.js:16` `antialias: true` | 4x MSAA on the XR layer costs tile memory and resolve bandwidth on Adreno; usually worth it, measure with/without | LOW-MED | none yet (boot) |
| A8 | `kit.js` particles / `library/effects.js` weather | one `Points` draw per emitter but each particle is a large soft sprite: additive overdraw scales with count x size^2. Rain up to 5000 streaks, storms 5200, up to 96 px points | MED | H3 (`density`), cap `effects` fields |
| A9 | `player.js:262` low-health vignette | a full-view alpha quad while health < 25 % | LOW-MED | none |
| A10 | `sys/hud.js` | 56 degree wide transparent quad with `depthTest:false` while subtitles/toasts show | LOW-MED | none |
| A11 | all `MeshStandardMaterial` / glTF with an environment | `scene.environment` is set on PC only; Quest has none (reflections off) | OK | `reflections` |

### B. CPU (JS main thread; the Quest CPU is far weaker than a PC core, assume 4-6x slower than your desktop numbers)

| id | where | finding | sev | knob |
|---|---|---|---|---|
| B1 | `models.js` `update` -> `tick` (~730-745, 956) | every animated character calls `mixer.update` every frame within 25 m on Quest (stride 2 beyond, 3 behind the player); no cap on animated characters; dead bodies keep ticking for 12 s; three then skins every visible `SkinnedMesh` | HIGH at 15+ characters | H5 |
| B2 | `renderer.render` CPU submit (measured by perf as `renderCpuMs`) | draw-call count x per-draw state changes. A humanoid is 12-15 meshes unmerged (6 after library `slim()`), glTF characters 1-2 draws, villages ~25 pieces | HIGH | cull (own), population budget (own, needs H8), `library.countDraws(root)` to check a handle |
| B3 | `kit.js` `nearestTarget` / `hit` (~486-533) | O(damageables) per call with `getWorldPosition` chain walks per sphere target; called from every fighter think, every projectile sub-step, every melee sweep sample | MED (HIGH with hundreds of damageables) | H4 (think rate), cheap radial reject |
| B4 | `combat.js` `think` (~410-516) | every 0.18-0.34 s per fighter: `retarget` -> `nearestTarget`, followers twice | MED | H4 (`fighterThink`), population budget |
| B5 | `weapons.js` `meleeStep` (~1177-1222) | while a melee weapon moves faster than 2 m/s: points x up to 6 samples x `foe()` (up to 3 target scans each) per frame | MED | none |
| B6 | `kit.js` `stepEmitter` (~298) | per live emitter, per frame: 3 attribute uploads of up to 2000 particles | MED | H3 |
| B7 | `kit.js` `stepLights` (~358) | per frame, light scoring over all logical lights (cheap), but see C1 | LOW | - |
| B8 | `style.js` blob sweep | was: every 0.5 s `traverse` + `Box3.setFromObject` + `updateWorldMatrix(true, true)` of every top-level object in one frame | MED (before) | own: time-sliced (~0.6 ms per frame), 4 s footprint cache |
| B9 | `style.js` outline sweep | PC only: full traversal of all module roots every 0.4 s | MED on PC | `outlines` off |
| B10 | `boot.js:98` `sweepShadows` | PC only: `scene.traverse` every 0.5 s | LOW-MED on PC | H1c |
| B11 | `world.js` terrain re-centre | every 32 m: 11.7 k vertices x ~20 sines + normals + 3 buffer uploads in **one** frame (31 k vertices on PC). On Quest estimated 15-30 ms | MED (before) | own: the vertex loop now runs in slices (900 / 2400 vertices per frame) into scratch buffers and commits in one cheap pass |
| B12 | `library.js` tickers (~604-619) | every live ticker runs every frame; no distance LOD | LOW-MED | cull does not stop them (H5-like) |
| B13 | `physics` (Rapier) | not read (module did not exist when this audit was written); expect stepping cost to scale with bodies/colliders; `perf.budget.bodies` counts kit bodies | ? | measure |
| B14 | `hud.js` `items.filter` per frame while anything shows | tiny array allocation | LOW | - |
| B15 | `style.js` `updateBlobs` | 120 `groundHeight` calls (15 sines each) per frame | LOW-MED | own: `blobs` cap |

### C. Hitches, allocation, uploads

| id | where | finding | sev | knob |
|---|---|---|---|---|
| C1 | `kit.js` light pool (~382) | `new PointLight` created lazily up to 6: every time the active light count grows, three recompiles every lit program (hundreds of ms on a mobile CPU) in the middle of the action | HIGH | H2: pre-create all pooled lights at load; never change the count |
| C2 | `kit.js` gore on model bodies (`buildPart`, `severLimb`, `modelBisect`, ~1825, 2688) | CPU skin cuts + new geometry per limb per victim; a group kill does many in one frame | HIGH | `kit.gore.level = 'mild'/'off'`; defer one cut per frame (kit) |
| C3 | first-use lazy pools (gore emitters, weapon emitters, `trailFor`, explosions) | the first blood spray compiles 15 emitters worth of programs and allocates their buffers | HIGH (first time) | pre-warm at load with `renderer.compile` (boot hook) |
| C4 | `library.spawn({ count: N })` N <= 80, `library.wave` | synchronous creation of N actors (clone skeleton, materials, bindings) in one frame | MED | `perf.allow('fighters', n)` + stagger (H8) |
| C5 | forests (`nature.js` ~733-744, `modelkit.js` ~363-376) | O(N^2) placement for 400 trees; promotion of the nearest trees to fellable objects re-evaluated every 0.5 s with array/Set allocation | MED | cap count on Quest |
| C6 | `models.js` `finishModel` | 14+ `clipFor` calls (Set + Map each) per spawned character | LOW-MED | cache per rig |
| C7 | canvas textures | `kit.label` (1 canvas per label; re-upload on text change, `dispose` on resize), HUD 1024x512 re-uploaded on every alpha step of a toast (about 17 per toast), player health arc, spell atlas | LOW-MED | keep text static |
| C8 | `kit.js` hit flash (`modelOwnMats`, ~2620) | clones every material of a character on the first hit-flash and disposes it afterwards: allocation + new program instances per hit episode | MED | cached flash material |
| C9 | `library/modelkit.js` `paletteOf` | 64x64 canvas `getImageData` per texture on first use | LOW | - |
| C10 | `models.js` GPU trim (~987) | idle cache entries free their GPU buffers after 45 s: re-upload on next spawn | LOW-MED | - |
| C11 | audio setup | impulse responses (voice 168 k samples/channel, ambience 2.6 s IR + 6 s noise) on first gesture | LOW-MED | - |
| C12 | `renderer.compile` | nothing in boot warms programs: every new material/light combination compiles on first draw | MED | boot: `renderer.compileAsync(scene, camera)` after module sync |

### Shader compilation is itself a hitch

Anything that changes a program key (light count, `scene.environment`, fog on/off, toon patch on/off, `castShadow` on lights, a
new material type) recompiles. perf's rungs were chosen to avoid this: all of them are uniform values, instance counts, draw
ranges, `visible`, or cap numbers. The two exceptions are called out above (PC reflections, light count in H2).

---------------------------------------------------------------------------------------------------------------------------

## 5. Proxy measurements (software rendering, relative numbers only)

Everything in this section is **software-rendered proxy data** (SwiftShader in headless Edge, 1280x720 drawn twice per frame into two
half-width viewports to imitate stereo, `tier: 'quest'`, real core modules, 6 other agents were using the same CPU: expect about
+/-10 % noise). Absolute milliseconds are meaningless for the headset. Draw calls and triangles are exact counts. "best frame ms" is the
fastest of 15 samples per level (3 interleaved passes over all levels, so slow drift in machine load hits every level equally).
The scene: the library's `village`, two `forest`s (140 + 100 trees), 16 goblins and 14 knights (neutral, so they stay alive), a
campfire, the real fractal oracle (which, as designed, self-governs to its lowest VR tier in a slow environment; so the proxy
understates what the fractal costs at its upper tiers), grass, motes, lake, toon patch, contact shadows. **184 draw calls and 325k triangles per
eye at level 0** is already above the 150-220 / 200-300k Quest budget: this is the scene the governor exists for.

### 5.1 Quest ladder, scene within 80 m (the full-fill-rate case)

| L | rung | best frame ms | relative | draw calls / eye | triangles / eye |
|---|---|---|---|---|---|
| 0 | full | 329.6 | 1.00 | 184 | 325k |
| 1 | foveation | 293.2 | 0.89 | 184 | 325k |
| 2 | grass-80 | 277.2 | 0.84 | 184 | 312k |
| 3 | cull-300 | 269.2 | 0.82 | 184 | 312k |
| 4 | sky-lite | 277.8 | 0.84 | 184 | 312k |
| 5 | density-75 | 227.8 | 0.69 | 184 | 298k |
| 6 | cull-200 | 237.9 | 0.72 | 184 | 298k |
| 7 | grass-40 | 188.4 | 0.57 | 183 | 284k |
| 8 | density-50 | 200.9 | 0.61 | 183 | 284k |
| 9 | floor | 154.3 | 0.47 | 182 | 267k |

Level 0 to the floor: **0.47x** the frame time in this proxy (level 1's 0.89 is noise: foveation has no effect outside XR; the noise floor of this\nmeasurement is about +/-10 %). The big steps are the ones that remove
shaded pixels or vertices (foveation does nothing here: no XR; grass, density, the far/dense grass patch, sky), not draw calls: the
draw calls of everything within ~100 m are untouched by any rung, because nothing there may be hidden. That is the population
budget's job (`canSpawn` / `allow`), which needs hooks H4/H8 to bite.
Screenshots at level 0 and at the floor were inspected: same scene, same composition; at the floor the grass is a sparse tuft field,
there is no lake ripple/foam, no clouds or aurora, the fractal is at its lowest raymarch tier, characters/houses/trees unchanged.

### 5.2 Quest ladder with a far field (3 villages and 2 forests at 150-330 m): the culler

| L | rung | best frame ms | relative | draw calls / eye | triangles / eye | objects culled |
|---|---|---|---|---|---|---|
| 0 | full | 336.6 | 1.00 | 369 | 446k | 0 |
| 1 | foveation | 333.8 | 0.99 | 369 | 446k | 0 |
| 2 | grass-80 | 291.1 | 0.86 | 369 | 433k | 0 |
| 3 | cull-300 | 301.5 | 0.90 | 318 | 406k | 27 |
| 4 | sky-lite | 290.8 | 0.86 | 318 | 406k | 27 |
| 5 | density-75 | 252.2 | 0.75 | 318 | 392k | 27 |
| 6 | cull-200 | 253.1 | 0.75 | 253 | 355k | 56 |
| 7 | grass-40 | 201.2 | 0.60 | 253 | 341k | 56 |
| 8 | density-50 | 201.5 | 0.60 | 185 | 284k | 86 |
| 9 | floor | 156.8 | 0.47 | 184 | 267k | 86 |

Draw calls per eye fall from 369 to 184 and triangles from 446k to 267k as the radius shrinks
(380 -> 300 -> 200 -> 140 -> 100 m). In this software proxy the frame time is dominated by fill rate and the vertex-bound grass, so culling
shows up mostly in the counts; on a real mobile GPU with a weak CPU the draw-call count is the cost that matters (hence "render submit" in the report).

### 5.3 PC tier ladder (Link / desktop settings: 4096 shadow map, tufts, outlines, mist, bloom switch), 960x540 stereo

| L | rung | best frame ms | relative | draw calls / eye | triangles / eye |
|---|---|---|---|---|---|
| 0 | full | 2085.2 | 1.00 | 356 | 993k |
| 1 | shadow-2k | 2061 | 0.99 | 356 | 993k |
| 2 | bloom-off | 2048.2 | 0.98 | 339 | 993k |
| 3 | outlines-80 | 2006.7 | 0.96 | 273 | 913k |
| 4 | grass-70 | 1452.7 | 0.70 | 259 | 755k |
| 5 | sky-lite | 1442.5 | 0.69 | 186 | 667k |
| 6 | shadow-off | 938.7 | 0.45 | 186 | 535k |
| 7 | floor | 527.9 | 0.25 | 185 | 421k |

Shadow map 4096 -> 1024 -> off and the grass/tuft thinning are the large steps here (SwiftShader rasterises the shadow pass in software, a real
5090 will not care). All PC shaders (SKY_PC, GRASS_PC + shadow lookup, terrain detail uniform) compiled and rendered through every level.

### 5.4 The governor on real (slow) frames

Auto mode, budget set to ~217 ms (frames at level 0 ~330 ms, at the floor ~125 ms in that run), real-time constants unchanged
(1.5 s / 12 s / 2 s settle): the governor walked **L0 -> L9 one rung at a time** (a rung every 3 to 18 s depending on how clearly the frames were over budget; two at once when the EMA is > 2.2 x budget), reached the floor
after ~86 s, and sent the floor report. After the budget was relaxed it climbed back **one rung per ~14 s** (12 s comfortable + 2 s settle):

```
43 s: 1 -> 2 (over budget: ema 322.0ms bad 100%)
47 s: 2 -> 3 (over budget: ema 270.4ms bad 14%)
51 s: 3 -> 4 (over budget: ema 277.1ms bad 61%)
54 s: 4 -> 5 (over budget: ema 274.2ms bad 49%)
61 s: 5 -> 6 (over budget: ema 362.8ms bad 95%)
79 s: 6 -> 7 (over budget: ema 271.8ms bad 23%)
83 s: 7 -> 8 (over budget: ema 296.0ms bad 84%)
86 s: 8 -> 9 (over budget: ema 347.6ms bad 100%)
171 s: 9 -> 8 (comfortably under budget 0s)
185 s: 8 -> 7 (comfortably under budget 0s)
199 s: 7 -> 6 (comfortably under budget 0s)
213 s: 6 -> 5 (comfortably under budget 0s)
```
A second run with a budget the system could meet (target 364 ms, level 0 = 427 ms, level 2 = 383 ms): L0 -> L1 after 4 s, -> L2 after 3 s more, then **stable for 130 s without a single
further change or probe** (frames within 1.25 x budget count as on time, so the governor does not chase the last 5 %), and after the budget was relaxed
L2 -> L1 -> L0 at 14 s intervals.
Level trace of the first run (about every 6 s): 1s L0, 9s L2, 15s L4, 22s L5, 29s L6, 36s L6, 43s L7, 50s L9, 56s L9, 63s L9, 70s L9, 77s L9, 83s L9, 90s L9, 96s L9, 103s L9, 109s L9, 116s L9.

---------------------------------------------------------------------------------------------------------------------------

## 6. Tests that were run

- `.cache/test-perf/gov.test.mjs` (Node, 66 assertions, deleted after the session): synthetic traces fed to `createGovernor` and to
  the real `perf.js` default export with a fake ctx and real three.js objects: steady 72 (no change); slow ramp (a few backed-off
  probes only, ends within budget); sudden heavy scene (first drop 1.5 to 3.5 s after the spike, settles within budget); isolated hitches
  and a 600 ms stall (ignored); oscillation near budget (probes at 16/49/112/235/477/780 s, never a flip-flop); locked-at-half-rate
  (descends one rung per ~3 s, flag clears once fixed); hopeless trace (stops at the floor, one report); quality / performance /
  auto mode bounds; recovery is one rung per >= 12 s; culler hysteresis (no flicker on a boundary), `noCull`, exempt roots,
  `frustumCulled = false` skipped, never un-hides what a module hid, dispose restores; `canSpawn` / `allow` / budget shrink;
  `quality:changed` payloads; steady-state `update()` retains no memory (0 B/frame over 200 k frames) and costs ~0.1 us in Node.
- `server/plugins/perf.js` written to a temp dir and exercised directly (header + text appended, timestamp, tier).
- Proxy bench (section 5): real `world`, `style`, `perf`, `physics`, `kit`, `models`, `combat`, `oracle`, `player`, `spells`,
  `weapons`, `library` modules in headless Edge on SwiftShader, a village + two forests + 16 goblins + 14 knights, rendered twice per
  frame into two half-width viewports to imitate stereo.
- The PC-tier ladder and every PC shader path (sky, grass + shadow lookup, terrain detail, shadow map resize/off) were rendered through all levels in the same proxy.\n- NOT tested: anything on a headset; XR `frameRate` / `updateTargetFrameRate` / `fixedFoveation` paths (feature-detected, no device);
  the GPU timer path (SwiftShader does not expose it); `physics` module costs.

---------------------------------------------------------------------------------------------------------------------------

## 7. First headset session

### 7.1 Before you put it on
1. Make the hooks in section 3 you can (H1 first: without it the framebuffer scale stays 1.0 and `supersample` recommendations are ignored).
2. Start the server; load the game in the Quest browser; enter VR.
3. Say "turn on the performance overlay" or run in the console of a desktop session `game.world.perf.overlay(true)`; for the headset, the
   wrist menu (when it exposes it) or ask the Omnissiah to run `ctx.world.perf.overlay(true)` in a creation. The panel sits at the lower left, head-locked.

### 7.2 What the overlay and `perf.report()` mean (read top to bottom)

```
perf quest L3/9 [cull-300] mode=auto xr 72Hz budget 13.9ms fov=1 grass=0.8 cull=300m
fps 71.8 ema 13.9ms p50 13.9 p95 14.3 p99 27.7 worst 83ms over 2.1% halfRate=no hitches=4
draws/eye 143 tris/eye 187k pts 3400 progs 41 geo 233 tex 58 culled 12
cpu 9.8ms (render submit 4.1) gpu n/a bound cpu  js: kit 2.9  combat 1.1  models 0.9  world 0.6
kit particles 12 bodies 33 actors 31 lights 6 parts 4 debris 12 | fighters 30 proj 3 | anim 31/31 | budget f19 d171 t232k
governor drops 3 recoveries 1 failedTrials 1 | next supersample 0.85 (hit the floor)
history: 12s 0>1 over budget: ema 21.4ms bad 61% | 31s 1>2 ...
```

Look in this order:
1. **`xr 72Hz budget`**: is the budget what you expect? If it says 90 or 120 on Quest, perf lowers it itself; if it stays at a rate you did
   not choose, `supportedFrameRates` is missing in that browser.
2. **fps / p95 / p99 / halfRate**. `fps` ~72 and p99 < 20 ms: fine, stop. `halfRate=YES`: every frame costs more than one vsync;
   the governor is descending, check `L` rises and eventually the frame time falls back to 13.9. p95 ok but p99 high: hitches (below).
3. **`bound`** (shown while over budget): `cpu` means `cpu` (js + render submit) > 85 % of the budget -> the knobs that help are
   population (density, fighters), culling, animation rate; `gpu` (needs the timer extension, probably `n/a` on Quest) or `?` (no
   measure: look at `cpu`: if cpu is well under budget and frames still miss, it is the GPU: fill rate).
4. **`render submit`** vs **`js`**: submit > 5 ms = too many draw calls (draws/eye > 200?). js dominated by one module: that module is
   the suspect (`perf.modules()` has all of them).
5. **draws/eye, tris/eye**: compare with the budget line. Over by a lot after summoning something: ask `perf.since('name')` or
   `library.countDraws`.
6. **level / history**: what rung did the governor stop at, and how fast. Level 0 with no drops after two minutes in a busy scene:
   the headroom is real, raise `quality.supersample` (H1 does it automatically next time).
7. **`culled`**: how many objects the culler hides; > 0 only when things are farther than `cull`.

| symptom | probable cause | first thing to try |
|---|---|---|
| 36 fps (half rate) in an empty field | fractal + sky + grass fill rate | `perf.setLevel(4)` and see if it holds; check `oracle` tier; H1 supersample 0.8 |
| fine standing, drops when walking | terrain re-centre (should be sliced), model streaming, grass | look for `worst` spikes at every ~32 m |
| fine until a fight starts | fighters x think x animations, gore bursts, lights (C1) | `fighters`, `anim`, `lights` in the report; H2/H4/H5 |
| one big stall (> 250 ms) the first time something appears | shader/program compile or lazy pool (C1/C3/C12) | `progs` jumps in the report across the stall |
| `L` oscillates | should not happen: look at `failedTrials` and history; report it | `perf.tune({ recoverAfter: 30 })` |
| levels fall to the floor and stay | scene content over the budget even at the floor | the population budget: ask the AI for less; check `draws/eye` |
| `gpu n/a`, `bound ?` | normal on Quest | use `cpu` and the symptom table |
| stutter after a long time | memory growth (`geo`, `tex` in the report rise) | `perf.mark`/`since` around creations |

### 7.3 Capturing numbers from the headset

`perf.js` sends `{ type: 'perf_report', reason, tier, level, xr, hz, text }` through `ctx.net.send` 60 s into every XR session, when the
governor reaches the floor (once per 3 minutes), and when the session ends. `server/plugins/perf.js` appends each one with a
timestamp and the client tier to **`D:\omnissiah\.cache\perf-reports.log`** (rotated at 2 MB). Nothing else needs to run.
You can also trigger one by hand: `game.world.perf.sendReport('manual')`. The persisted settings live in `localStorage['omnissiah.perf']`
(mode, last level per tier, supersample recommendation) and `['omnissiah.supersample']`.

---------------------------------------------------------------------------------------------------------------------------

## 8. What is least certain

- Which rung buys the most on a real Adreno 740 is **unknown**: the order of the Quest ladder is an informed guess (invisible and
  peripheral first, then CPU-side, then visible). The overlay's history and the report log will show which rung actually rescues frames; reorder
  `LADDERS` accordingly.
- `session.frameRate` / `updateTargetFrameRate` / `supportedFrameRates` in the Quest browser: feature-detected, never exercised.
- Whether the Quest browser exposes `EXT_disjoint_timer_query_webgl2`: if yes, `gpuMs` lights up and the `bound` diagnosis and recovery checks sharpen.
- `renderer.info.render.calls` in XR counts both eyes (three renders each object per eye unless multiview is on); perf divides by the camera count.
  If the Quest browser path uses multiview the division would halve the true number: compare once with the overlay.
- Foveation: boot sets 1.0 before the session; perf re-applies its own value 400 ms after `xr:start`. Dynamic foveation levels differ by browser version.
- The culler hides objects other modules may expect visible (e.g. a module reading `mesh.visible` to decide a character is alive).
  It marks `userData.perfCulled`; objects a module hid itself are never un-hidden.


---------------------------------------------------------------------------------------------------------------------------

## 9. Round two (partial, 2026-10-08 evening): grass, governor false floors

Status: what is listed here is verified with software-rendered proxy data and Node tests; nothing has run on a headset.

### 9.1 Why the governor hit the floor on the RTX 5090 (evidence: `.cache/perf-reports.log`)
- Reports from 12:52-13:01 (flat, 60 Hz budget): `ema 22.2 ms, p50 = p95 = p99 = 22.3, draws 0, cpu 0.0 ms`: a throttled pane (45 fps rAF) with nothing
  drawn. Reports from 18:48 on (`xr=yes`, 72 Hz): frames alternating 13.8 / 27.8 ms (half rate) while `cpu 1.4 ms, gpu 0.7 ms`: the rate was limited
  by the compositor / headset runtime pacing, not by the scene. One report shows `gpu 2042 ms` and `hitches=141`: a tab that was hidden / throttled.
  In every case cpu + gpu were under 15 % of the budget, yet the governor walked down to the floor, and then also cut the stored supersample
  recommendation (1.4 -> 0.86 on a 5090) and stored a low "last level" that the next session resumed from.
- Fix (`core/perf.js`): (1) a hidden tab (`document.visibilityState`) is not measured at all, and the first second after it comes back is ignored
  (`visibilitychange` also resets the governor window); (2) EXTERNAL PACING: when the frame is over budget but module JS + render submit and the
  GPU timer are each under 50 % of the budget, the frame is fed to the governor as a comfortable one (so it can also climb back after an earlier false
  descent) and counted in `stats().external` (shown as `EXTERNAL PACING n%` in `report()`); the supersample recommendation is not lowered in such a
  session. Needs `EXT_disjoint_timer_query_webgl2` to rule the GPU out, so on Quest (no timer) only the hidden-tab rule applies. (3) GPU timer samples above
  250 ms are dropped (stalled tab, not our cost) and up to 64 queries per frame are kept (a bloom composer renders ~10 passes). Also new: `perf.summary()`.
- Not covered: a visible, throttled pane without the GPU timer; main-thread time outside module updates and render submit (boot's own input / voice / HUD
  / composer CPU work) is not in the 50 % test.
- Tests: `.cache/perf2/gov-test.mjs` (Node, real three, fake ctx, 9 assertions): real heavy load still descends (level 3); 36 fps externally paced for
  240 s stays at level 0 (8,600 external frames); a false level 5 recovers to 0 in 90 s while externally paced; no GPU timer still degrades; hidden tab
  and the first second after it never degrade; GPU-bound 26 ms frames degrade.

### 9.2 Grass (audit A3)
- `world.js`: the vertex shader no longer evaluates the terrain (about 30 sines per vertex, 9 vertices per tuft, 2 eyes). Each tuft's ground height, height
  variation and patch value are computed on the CPU once per world cell (cache), and the draw contains a compact list of only the tufts inside the fade radius
  (+1.6 m), rebuilt in <= 0.6 ms slices when the player moved 0.6 m (teleport: hidden until rebuilt, then grows in 0.4 s). Grass knob: the torus keeps
  its size, the count is `count * g / ps^2` and only the fade radius shrinks, so a knob change never moves a tuft or re-evaluates the terrain.
- Proxy (software GL, stereo, Quest tier): the grass drew 1000 of 1043 ms of a frame; list compaction takes the flat quest-tier idle scene from 219k to
  151k triangles per eye (VR counts: 93k); PC 604k -> 499k. Level-0 pixel diff against the previous version: PC mean 0.01-0.04 (passthrough identical), Quest
  mean 0.005-0.03 (differences are single wind-sampled blade edges and unrelated UI panels).
- The quest-tier *flat* view used 60,000 tufts (19 per m2, 180k triangles); it is now 46,000 (14.7 per m2, the same density as the headset's 15 per m2). The
  headset itself always used 22,000 tufts.
- OFF by default, unverified in motion: `quality.grassSector` (skip tufts behind the player, ~25 % fewer) and `quality.grassLod` (far tufts as one wider blade, a
  second 3-vertex mesh). The LOD changes the look at distance and needs tuning; the sector needs a head-turn test.

### 9.3 Still open, in order of value
1. Re-measure grass/vertex cost with `.cache/perf2/bench-grass.mjs`; decide on sector / LOD.
2. `world.js` terrain re-centre: commit step (indices + normals) still runs in one frame (slice it).
3. `style.js`: `#define`-gate rim / fill / toon, one batched recompile per quality change; PC terrain `customProgramCacheKey` ignores the style patch.
4. `sys/hud.js` (ring vignette, size the subtitle quad to its content, fade a lone toast by opacity), `quests.js` (beacon target 8 Hz, banner redraw 10 Hz),
   `voices.js` (reuse scan buffers, throttle `setTargetAtTime`, cache `cast()` while talking).
5. perf.js: startup self-benchmark, ladder reorder from real measurements, wire the new knobs; memory budget table.
6. For other owners: `player.js:262` low-health full-view quad (A9) should be a ring mesh; kit/oracle hooks H2-H6 as in section 3.
