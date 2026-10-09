# Omnissiah QA

Owner: the QA agent. Everything lives in `D:\omnissiah\tests\**`, `README.md` and this file. QA never edits game code; findings go to
`docs/review/startzone2.md` (sprint 2, all drivers) and `docs/review/opening.md` (intro / quests).
Ports: 9080 / 9443 (the harness's own server, started from a private copy of the code), Edge DevTools 9300-9449. Nothing is tested in a headset.

## Latest run (keep this section current)

**Run `tests/results/2026-10-09_14-39-09-full5/` (folder names are UTC; machine clock 16:39-17:15 on 2026-10-09), snapshot of the code taken 16:39.**
Sandbox manifest = the live one of that moment (world, meadow, style, ... models, genset, ...; startzone was added to the live manifest after the snapshot and is enabled by scenario 15).
Default scenarios 1, 10, 11, 12, 13, 14, 15, both tiers. `gear-map.json` exists since 16:20, so the console is clean.

| scenario | pc | quest |
|---|---|---|
| 1 Boot | 9/9 PASS | 8/9: "every manifest module is loaded: core/startzone.js" = the test compares the LIVE manifest (startzone added at ~17:00) with the 16:39 sandbox snapshot: harness artifact, not a game bug |
| 10 New player (awakening played through by a bot, walk, menu panels, weapons, spells, fight, death, first quest, save + reload, travel, perk) | 67/67 PASS | 67/67 PASS |
| 11 Hot reload of every core module | 186/187: `core/kit.js` reload throws a three.js `TypeError ... 'isReady'` (REAL, see bug 1) | 186/187: same |
| 12 Soak | 10/10 PASS | PASS (not listed as failing) |
| 13 Awakening paths | 12/12 PASS | 12/12 PASS |
| 14 Wave-3 surfaces | 17/17 PASS | 17/17 PASS |
| 15 Start area (startzone + meadow + genset, new player, intro skipped, first quest, walk 8 m, lectern, dummy, rack, M, typed wish, 60 s soak, models 200 + tier twins) | **33/33 PASS** | **34/36: only the budget** (below) |

**Verdict (desktop emulation, headless Edge/SwiftShader, no headset): from boot to the first quest the game is playable on both tiers** - scenario 10 (live
manifest) and scenario 15 (live manifest + startzone) both go page load -> awakening -> first quest -> walk -> menu -> spell -> weapon -> wish on pc and quest with zero console errors and zero failed requests.
The only thing the Quest tier still fails is the performance BUDGET of the spawn view (measured, docs/SPRINT2.md): **200,806 triangles (budget 120,000), 72 draw calls (budget 80, ok), ~52.6 MB visible textures (budget ~40)**.
Per owning module (visible meshes only, approximate; they add up to ~85k of the 200k, the rest is terrain/sky/grass drawn outside Mesh objects): world.js 30.8k, startzone.js 27.8k (22 meshes), spell-bloom-brush.js 9.7k (a leftover creation in the spawn view), meadow.js 5.9k, oracle.js 5.6k, campfire.js 3.0k.
PC tier (informational): 3.66 M triangles, 192 calls, ~275 MB textures (startzone.js 0.9 M, meadow.js 0.28 M, campfire.js 84k, world.js 69k).
Not verified: real frame rate on a Quest 3 (software GL has no timing), anything in a headset, audio, voice, the AI (typed wishes are only asserted on the wire).

### Run log
| run | what | result |
|---|---|---|
| `..._11-48-42-base1` (13:48, live manifest) | 1 10 11 12 13 14 | every failure = `404 /assets/hero/gear-map.json` (since fixed by the lead 16:20) except a harness race (fixed) |
| `..._12-10-55-sa2` (14:10) | 15 | first startarea run: pc 33/35, quest 35/38 (Quest 196k triangles) |
| `..._12-24-07-full2` and `12-18-50-full2` | full | INVALID: server startup 5-10 min under load, then the server's watcher dropped healthy modules (`node --check` timeout) |
| `..._12-48-12-full3` (14:48) | full | startzone.js alone 251k Quest triangles (426k total), lectern check |
| `..._13-29-54-full4` (15:29) | full | Quest 11-14 all pass bar gear-map; Quest 228k triangles; found harness bugs (saves wipe, lectern 40 s cool-down, PC loads Quest twins by design) |
| `..._dbg1` (16:03) | 10 11 14 15, pc | 10 and 11 prelude fixed, 15 pc 31/33 |
| `..._14-39-09-full5` (16:39) | full | the table above |
## How to run (one command)

```
D:\omnissiah\tools\node\node.exe D:\omnissiah\tests\run.mjs                # both tiers, scenarios 1, 10, 11, 12, 13, 14, 15 (25-40 min when the CPU is busy; server start alone can take 5+ min)
D:\omnissiah\tools\node\node.exe D:\omnissiah\tests\run.mjs --tier quest --only 15 --label try
D:\omnissiah\tools\node\node.exe D:\omnissiah\tests\dev\syntax.mjs --since 2026-10-09T12:00:00Z   # node --check of every .js under public/game, public/sys, boot.js, server; newest mtime; files changed since
```
Environment for a no-GPU machine (the harness sets the first three itself; the last two keep GPU workers from starting):
`COMMENTARY=off ORACLE_REPAIR=off STT_BACKEND=cpu GEN3D_DISTRO=none VOICE_DISTRO=none`.
Options: `--tier pc|quest|both`, `--only <ids>` (also reaches scenarios not in the default set, e.g. `2` = library sweep), `--label <text>`,
env `QA_SOAK_SECONDS` (scenario 12, default 180 game seconds), `QA_STARTAREA_INTRO=play` (scenario 15 plays the intro through instead of skipping it).
Results: `tests/results/<timestamp>-<label>/` with `results.json` (checks, notes, console errors, network failures, blocked messages, per-scenario data,
`serverDrops`), `console-<tier>.json`, `server.log`, screenshots under `<tier>/<NN-scenario>/NN-label.png`. The run summary prints the
Quest budget numbers of scenario 15 at the end.

How it works
- `tests/lib/sandbox.mjs` copies the game code (server/, public/game, public/sys, boot.js, index.html, favicon, admin) into `.cache/qa/sandbox`
  (junctions for node_modules, tools, public/assets, .cache/models) and runs OUR server from there on 9080/9443. The real `saves/` and the real
  `public/game` are never touched, hot-reload tests rewrite the copy, each run tests one stable snapshot (mtimes preserved). Never delete the
  sandbox by hand (`Remove-Item -Recurse` walks junctions): the run removes it itself (`destroySandbox`).
- A scenario may rewrite the sandbox manifest (`enableModules([[after, newModule], ...])`; scenario 15 does) - it is restored before every scenario.
- `healModules()` (before every scenario): the server drops a module from `/api/modules` when its `node --check` fails or times out (15 s); under CPU load
  that removed models/audio/ambience mid-run. The harness rewrites such files so the server re-checks them and prints/records what happened.
- One dormant hook module `creations/zz-qa-hook.js` (sandbox copy only) exposes its ctx as `window.__qaCtx`.
- `tests/lib/inject.js` (before page scripts): drops outgoing WebSocket messages that would start workers or the Claude CLI (`hello`, `gen3d`, `sfx`, `music`,
  `place`, `blast`, `npc_say`, `voice_*`, `utterance_*`) and records them in `__qa.blocked` (so a typed wish is asserted on the wire and never reaches the AI);
  `say_as_omnissiah` is answered with `say_dropped`; fakes pointer lock; wraps `events.on` to count live listeners; owns `requestAnimationFrame`: a FAST virtual
  clock (1/72 s per frame, rendering off) so SwiftShader's 1 fps does not slow game time. Screenshots and measurements switch to real rendering.
  Caveat: game time outruns the wall clock, so anything a module times with `performance.now()` (the start zone's dummy respawn) must be waited for in real time.
- Driving: keyboard/mouse events (WASD, arrows, Space, E, M, G/right mouse, left mouse), REAL mouse clicks on menu widgets, `qh.aimAt`, `player.teleport`.
- Network: `Session.models` records every .glb/.gltf request with its status (scenario 15 asserts all 200 and the right tier twin).
- `?qaintro=new|seen` (new = wipe localStorage: the awakening starts; seen = a returning player), `?qaxr=yes|no|pending` (mock `navigator.xr`), `?qafast=1`.
- Dev helpers: `tests/dev/probe.mjs <pc|quest> <script.js>`, `tests/dev/reload-probe.mjs`, `tests/dev/syntax.mjs`.

Scenarios (ids): 1 boot, 2 library sweep (not in the default set), 10 new player (plays the awakening through with a bot, then the first minutes: look, walk,
menu panels, weapons, spells, fight, death, quests, save + reload, travel, perk), 11 hot reload of every core module (after the intro was skipped), 12 soak,
13 awakening paths (skip half-way, profile from another browser, replay + saying skip), 14 wave-3 surfaces (blast inert, spell categories, ENTER VR with a mocked
navigator.xr, voice.setOpenMic), **15 start area** (below).

### Scenario 15 "startarea" (the sprint-2 playable-game check)
Sandbox manifest = the live one plus whichever of `core/startzone.js` (after library), `core/meadow.js` (after world), `core/genset.js` (after models) exist
on disk and are not listed yet. New player, both tiers: every listed module loaded (none dropped by the server, none disabled by the loader, no `module_error`),
`world.startzone` anchors; the intro starts, is skipped, the first quest starts by itself; spawn-view budget numbers; walk 8 m forward with W; walk to the
lectern (must select the starter spell); cast it at a straw dummy (`startzone:dummy-hit`), knock one down and wait for it to come back; take a weapon from the
rack with right mouse; M opens/closes the launcher and a panel; type a wish in the chat box (assert `utterance_text` on the wire); 30 s settle + 60 s soak with
registries/listeners/heap stable; zero console errors; every .glb request 200 and the Quest tier loads only `startzone/q/*.glb`, PC only the originals; at
least one generated model is requested. Budget (docs/SPRINT2.md, Quest tier only): <= 120k triangles, <= 80 draw calls, textures <= ~40 MB (estimate:
w x h x 4 x 1.33 over the visible meshes' textures); the summary also prints triangles per owning module and per-module update ms (software GL: relative only).

## Bug list (what is open now, as of the 16:39 run)

### Real bugs
1. **P1 Quest spawn view over budget** (scenario 15, quest): 200,806 triangles vs 120,000; visible textures ~52.6 MB vs ~40 MB (draw calls 72 <= 80 ok). Owners: `core/world.js` grass (30.8k counted, plus terrain/sky), `core/startzone.js` (27.8k, 22 meshes: use `gen.scatter` for repeats), a leftover `creations/spell-bloom-brush.js` costing 9.7k in the spawn view (retire), `core/meadow.js` 5.9k. The run summary prints the breakdown every time.
2. **P2 `core/kit.js` hot reload throws** a three.js `TypeError: Cannot read properties of undefined (reading 'isReady')` from `checkMaterialsReady` (`vendor/three/build/three.module.js:29913`), pc and quest, every run (scenario 11, "core/kit.js: no console errors during reload"). Cause: `public/boot.js` `syncModules` calls `renderer.compileAsync(scene, camera)` (line ~546) while `unloadModule`/`disposeTree` has just disposed the old module's materials; the `.catch` does not cover the throw inside the Set.forEach. Reload-only (hot reload during development), not reachable in normal play. Owner: lead (boot.js).
3. **P2 `server/files.js:72`**: `node --check` runs with a 15 s timeout and a timeout is treated as a syntax error, so under CPU load a healthy module silently disappears from `/api/modules` until its next edit (seen in every run on this loaded machine: quests.js, models.js, audio.js, ambience.js, world.js, perf.js, intro.js, many spells). `files.checkAll()` also checks every file one after another before the server listens (3-10 min on this machine). The harness heals dropped modules before each scenario and lists them in `results.json` (`serverDrops`).
4. **P2/P3** `core/intro.js` `debug.killFoes()` (line ~251) assigns the getter-only `fighter.hp` and throws (debug API only, the harness bot avoids it).
5. Carried over from the 10-08 run, NOT re-verified this round: library `remove()` leaves kit particle emitters behind, damaged destructibles are not fully cleaned, `#status` text overlaps the VR button, mic-blocked toast over the menu.

### Fixed during this sprint (verified by re-run)
- `404 /assets/hero/gear-map.json` (was the cause of ~14 failing checks per run): the lead created the file at 16:20; full5 has zero console errors on both tiers.
- Quests held while the intro plays, first quest after it, startzone `startzone:enter` for the lectern, dummy hits: all pass in full5.

### Harness fixes (not game bugs)
- "Omnissiah hidden in the dark": now watched per frame inside the page (`__qa.introWatch`), the fast clock outruns any CDP round trip.
- Dummy respawn is wall-clock: scenario 15 waits in real time. The lectern has a 40 s cool-down and re-arms only after the player was > 8 m away: scenario 15 goes away first.
- PC tier requesting Quest twins is by design (startzone.js uses them for colliders / mid LOD): the check is now "Quest loads only twins; PC loads at least 3 originals".
- Saves are wiped robustly between scenarios (`wipeSavesHard`); a dropped module is healed (`healModules`); the Edge DevTools port is chosen in 9300-9449 and checked free (a clash with another agent's server crashed a run); server start timeout 8 min.
- A scenario 1 failure "manifest module not loaded" can mean the live manifest changed after the sandbox snapshot (as with startzone at 17:00): re-run to confirm.
## Coverage gaps (honest list)
- Desktop emulation only, SwiftShader only: no real GPU timing, no Quest, no hand tracking, haptics, passthrough, or audio by ear. The fast virtual clock never feeds the governor.
- Typed wishes: only the client side (`utterance_text` on the wire). The server's routing to the plugins/Claude CLI is NOT exercised. `hello`, generated audio/gen3d/place/blast requests are blocked on purpose.
- The awakening is played with a bot using synthetic events for most steps; real grab/swing/cast paths are covered in scenarios 10 and 15 separately.
- Not run as separate scenarios: combat variety by damage kind, severing/gore levels, vehicles, wall/house trapping, all weapon types and spells, audio decode, voices/NPC targeting, passthrough/XR alpha.
  The library sweep (scenario 2, ~300 entries) was not repeated this sprint.
- Generated-model look (lighting, hue, scale, floating/sunk props) is judged only from screenshots by eye (`tests/results/.../<tier>/15-startarea/*.png`), not asserted.
