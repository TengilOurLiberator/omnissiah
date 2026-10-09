# Improvement guide for AI agents (and people)

A list of things that would make Omnissiah better, written so that a coding agent can pick one up and finish it without
knowing the project's history. Pick **one** task, do it completely, and open a pull request (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

Status of the game today: the starting area is playable on a desktop browser from boot to the first quest, and looks right
on the PC graphics tier. It has not been properly tested in a headset, and the standalone Quest tier is over its budget.

## Before you start: how to work in this repository

1. **Read first:** [GETTING_STARTED.md](GETTING_STARTED.md), then [CONTRACT.md](CONTRACT.md) (the module API). Every core module under
   `public/game/core/` starts with a comment header that documents its API; those headers are also fed to the in-game AI, so keep them short and true.
2. **How the game is built:** no build step. `public/boot.js` is the stable core (renderer, XR session, input, hot module loader).
   Everything under `public/game/` is a hot-swappable module: `export default function (ctx) { ...; return { update(dt, t), dispose() } }`.
   `public/game/manifest.json` lists the core modules in load order; every file in `public/game/creations/` loads automatically.
3. **Rules that keep the game alive:**
   - A module must clean up everything in `dispose()` and survive being hot-reloaded twice with no leaked objects or listeners.
   - Nothing is created at load unless it belongs in the default scene. Features wait until asked for.
   - Never allocate per frame in `update()`. Respect `ctx.quality` (tiers `pc` / `quest`) and `world.perf` (`allow`, `canSpawn`).
   - Scenery and props come from the generated hand-painted set through `world.gen` (see [GENERATED_ASSETS.md](GENERATED_ASSETS.md)), not from flat-coloured primitives.
   - Every file you write must pass `node --check`. Land complete files, not half-edits.
4. **How to verify** (do not skip; "it should work" is not evidence):
   - `node tests/run.mjs` — the automated play-through on both tiers. It starts its own server on ports 9080/9443.
   - Look at the result: run the server (`COMMENTARY=off ORACLE_REPAIR=off` so the AI is not called), open
     `http://localhost:8080/?quality=quest` and `?quality=pc`, or take headless screenshots
     (`chrome --headless=new --window-size=1280,720 --virtual-time-budget=20000 --screenshot=out.png <url>`), and actually inspect them.
   - Report numbers for anything visual or heavy: triangles and draw calls from `renderer.info`, per-module milliseconds from `window.game.modules`.
   - Say plainly what you could not verify. Nobody can test a headset from a terminal: list what a human should check in VR.
5. **Budgets:** standalone Quest 3 targets 72 fps: from the spawn view ≤ 120k triangles, ≤ 80 draw calls, ≤ ~40 MB of textures in view. The PC tier has far more room.
6. **Do not** add paid services, API keys, tracking, or new network destinations. Changes under `server/`, to dependencies, start scripts or the AI prompts need the owner's approval (see CONTRIBUTING).

Each task below gives: **Why**, **Where**, **Done when**. Sizes: S = hours, M = a day, L = several days.

---

## A. Graphics

### A1. Painted characters instead of block figures (L) — the biggest visible gap
- **Why:** Scenery is hand-painted and generated; the people and creatures are still flat-shaded block models. The pilgrim "Pell" at the campfire is the first character a player meets.
- **Where:** `tools/characters/` (runner, prompt list, a working Quest-light script `lite_blender.py`), `server/gen3d.js` (text → image → TRELLIS → UniRig rigging), `public/game/core/models.js` (rigged models; note the header says rigged cache entries register at load, but the code needs `refreshGenerated()`/`registerGenerated()` first), `public/game/campaign/act1.js` and the intro for Pell.
- **Notes:** the rigging stage has never completed end to end. It needs the GPU to itself (one generation worker at a time). Prompts must ask for one character, T-pose, arms out, nothing held; attach props such as a staff separately.
- **Done when:** a rigged, animated Pell (idle, walk, talk, wave) in the painted style stands by the fire on both tiers with a Quest-light twin; at least a goblin, a skeleton and two villagers exist the same way; screenshots show them next to the props; no regression in `tests/run.mjs`.

### A2. Soft, light grass on the Quest tier (M)
- **Why:** Quest-tier grass is hard flat spikes and costs ~115k of the ~200k triangles in the spawn view.
- **Where:** the grass layer in `public/game/core/world.js` (`makeGrassLayer` and friends). A finished rework (soft "card" tufts at 45–51k triangles, plus `world.env.addGrassHole`) was written but **not landed** because after a teleport or a long walk the draw list refills to only ~1.5k tufts instead of ~7k. The idea: 3 leaning cards per tuft with blades cut out in the fragment shader, root colour = terrain colour, density thinning with distance.
- **Done when:** Quest grass ≤ 60k triangles in the spawn view, visibly softer in before/after screenshots, refills fully after teleporting 300 m away and back, the campfire clearing still works, PC tier unchanged or better, `world.js` hot-reloads cleanly.

### A3. `world.env.addGrassHole` (S, can ship with A2)
- **Why:** paths, the spawn circle and the camp lie under tall grass. Three modules already call `world.env.addGrassHole?.(...)` behind guards (`creations/campfire.js`, `core/startzone.js`, games).
- **Done when:** `addGrassHole({x,z,r})` and `addGrassHole({x,z,w,d,yaw})` return `{ remove() }`, support many holes with a soft edge, cost nothing per frame, survive terrain re-centring, and the dirt paths in the starting zone are visibly clear of grass.

### A4. Generated weapons and a proper weapon set (M)
- **Why:** the starter sword, bow, shield, staff and hammer use simple flat-palette models; the axe is still a grey placeholder; ~40 other weapon types are procedural shapes.
- **Where:** `public/game/core/weapons.js` (data-driven hook reading `public/assets/hero/gear-map.json`), `docs/GEAR_MODELS.md`, `tools/weapons/` (prompt list and runner, never completed a run).
- **Notes:** generated models have arbitrary orientation: compute the long axis and grip point per model and store a grip transform; make ≤ 1200-triangle Quest twins. The bow needs its string and draw animation kept.
- **Done when:** at least sword, axe, hammer, dagger, spear, mace, staff and shield look painted in the hand (first-person screenshots on both tiers), sit correctly on the rack, and melee/bow behaviour is unchanged.

### A5. Standalone Quest budget (M)
- **Why:** the spawn view is ~200k triangles and ~53 MB of textures on the Quest tier.
- **Where:** `core/world.js` (grass, see A2), `core/startzone.js` (~28k), `core/meadow.js` (~6k), `core/perf.js` (governor), texture sizes of the `q/` model twins, `creations/spell-bloom-brush.js` (a leftover ~10k triangles).
- **Done when:** the Quest tier is within the budget in section 5 above from the spawn view and three other viewpoints, measured and reported, with no visible loss in screenshots.

### A6. UI skin, finished (S–M)
- **Why:** the parchment-and-brass UI is in place for bubbles, toasts and banners, but leftovers remain.
- **Where and what:** `core/quests.js` — banner heading is ALL-CAPS ("NEW LABOUR") and a "+0 XP" flashes during reward count-up; `core/menu.js` — panels still use the old indigo background (use `UI.color.glassTop/glassBottom` from `public/sys/hud.js`) and the "Look of the world" chip should read `world.style.name`; `core/intro.js` — should use `hud.objective(text)` instead of its own hint bar; the quest tracker and banner overlap by ~20 px at 1280 wide; three-line subtitles collide with the chat box when looking up.
- **Done when:** screenshots at 1280×720 and 1920×1080 show one coherent skin with no overlaps, and the VR (world-space) versions are checked for size (cap height ≥ ~1.2° of view).

### A7. Lighting and atmosphere polish (M)
- **Ideas:** time-of-day that moves slowly; light shafts through the trees on the PC tier; water with reflection and shore foam; soft cloud shadows drifting over the meadow; better night (moonlight, lantern pools); weather that changes the light, not only adds particles.
- **Where:** `core/style.js` (the `painterly` preset), `core/world.js` env API, `core/ambience.js`.
- **Done when:** before/after screenshot pairs at three times of day on both tiers, with numbers showing the Quest tier did not get slower.

## B. Physics and feel

### B1. Weapon pickup and holding (M) — reported by the owner as "weird kinks"
- **Why:** grabbing, holding and dropping weapons feels wrong in places.
- **Where:** `core/weapons.js`, `core/physics.js` (Rapier), `core/player.js` (hands), `core/startzone.js` (rack weapons are pinned until grabbed; grab sphere 0.4 m).
- **Investigate and fix:** grab distance and which hand takes the weapon; snapping to the grip versus keeping the hand offset; weapons clipping through the world or the player while held; a dropped weapon blocking or pushing the player; throw velocity (use the hand's recent velocity history, not one frame); two-handed weapons; the desktop mapping (left click should swing whichever hand holds a weapon; a rack weapon goes to the right hand while **G** is the left grip); weapons sinking into or bouncing off terrain; held weapons after a hot reload.
- **Done when:** a scripted test covers grab → swing → hit registers → drop → re-grab → throw for sword, axe and bow on desktop and with simulated controllers, with no errors, no stuck weapons and no player displacement; plus a short list of what must be felt in a headset.

### B2. Physical hands and world collisions (M)
- **Ideas:** hands that cannot pass through solid props; weapons with weight (heavier weapons lag the hand slightly); impact feedback scaled by speed (haptics, sound, sparks); the player capsule versus the 77 static colliders in the starting zone (tent, stones, cart, jetty deck) — walk every one and fix snagging; scaling the player (`world.player.setScale`) with reach and grab range following.
- **Done when:** a walk-through test touches every collider in the starting zone without getting stuck, and held objects never tunnel through static geometry at normal swing speeds.

### B3. Hot-reload race in the loader (S)
- **Why:** reloading a module throws `Cannot read properties of undefined (reading 'isReady')` from three.js: `renderer.compileAsync` in `public/boot.js` polls materials that the reload just disposed. Harmless but noisy, and every wish hot-reloads.
- **Done when:** no error over 20 consecutive reloads of `core/kit.js` and `core/oracle.js`, and first-use shader hitches are no worse.

## C. The opening and gameplay

### C1. Desktop spell wheel and menu off-screen (S)
- **Why:** on a flat screen the spell wheel is centred on the right-hand anchor, which sits low and right of the view.
- **Where:** `core/spells.js` `openWheel()`, and the same cause in `core/menu.js`.
- **Done when:** when `!ctx.input.presenting`, both appear centred in view (e.g. `head + forward * 0.75`) and are fully usable with mouse and keys.

### C2. Wake word and speech (S) — needs owner approval (server)
- **Why:** hands-free speech only acts when the transcript contains his name, and speech recognition spells it many ways.
- **Where:** the wake check in `server/index.js` (`runAudio`), `server/stt/worker.py` (add `hotwords`/`initial_prompt` "Omnissiah"). A tested regex is in the voice work notes: it should accept "Omnisiah", "Omnissia", "Om Nissiah", "Machine-God" and reject "omission", "ominous".
- **Done when:** synthesized test phrases in several voices are recognised ≥ 95% of the time and common false positives are rejected.

### C3. The story, playable (L)
- **Why:** a 12-chapter story is written ([STORY.md](STORY.md)) and implemented in `core/campaign.js` (lazy, passes an automated play-through) but is not enabled and has never been reviewed by a human or played with real voices.
- **Done when:** chapter 1 ("The Wanderer's Fire", set in the starting meadow) is enabled, flows from the end of the intro, uses the painted starting zone and characters (see A1), restores every colour and setting when it ends (the `glitch` effect in `campaign/engine.js` currently leaves colours changed, and eclipse level 0 resets time of day to 0.5 instead of the saved value), and is covered by `tests/run.mjs`.

### C4. Mini-games (M)
- **Why:** four are written and bot-tested (`public/game/games/`: archery, whack-a-goblin, balloon pop, sword duel); nine more were started. `core/games.js` is disabled.
- **Done when:** the four finished games are reachable from the wrist menu and by asking him, are inert until started, use painted props, and clean up completely.

### C5. More to do in the first ten minutes (M)
- **Ideas:** fishing off the jetty; a bell that starts a timed challenge; a target range with a score board (a toy exists: `creations/thing-target-range.js`); cooking at the fire; a familiar companion that follows and reacts; secrets in the stone ring.
- **Done when:** each is discoverable without instructions, completes in under two minutes, and has a visible reward.

## D. The in-game AI

### D1. He should build with the painted set (S–M) — needs owner approval (prompts)
- **Why:** `world.gen` (365 reviewed models) exists and its header tells him to use it first, but this has not been measured.
- **Where:** `server/eval/` (a wish test harness with stubs), [WISHES.md](WISHES.md), `server/omnissiah-prompt.md`, `core/genset.js` header.
- **Done when:** on the wish suite, scenery and prop wishes use `world.gen` in ≥ 90% of cases where a fitting model exists, with no loss in pass rate or speed.

### D2. Safer wishes (M) — needs owner approval (server)
- **Ideas:** restrict what generated code may touch; run a static check on creations before loading; a "preview, then keep" flow; automatic removal of creations that cost too much.

## E. Housekeeping

- **E1 (S):** `tests/run.mjs` — add the default live game with the starting zone enabled to the new-player scenario; re-run the library sweep.
- **E2 (S):** `creations/spell-bloom-brush.js` leaves ~10k triangles in the scene; make it clean up.
- **E3 (S):** the campfire uses the single shared `setGrassMask`; move it to `addGrassHole` once A3 lands.
- **E4 (M):** one-command setup scripts and notes for the optional local AI workers under `server/` (they were configured by hand on one machine).
- **E5 (S):** a `docs/HEADSET_CHECKLIST.md`: the things only a person in VR can verify (frame rate, scale, grip offsets, text sharpness, hand tracking, microphone, mixed reality), so testers can report in a consistent format.

---

## Reporting

In the pull request, say: what a player will notice, how you tested it (commands, screenshots, numbers), what you could not
verify, and anything a human should try in the headset. Honest "not verified" lines are valued more than optimistic claims.
