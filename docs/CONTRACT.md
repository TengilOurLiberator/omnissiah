# Sky Oracle — architecture contract

A WebXR (three.js) game for Meta Quest 3, served from a Node server on the player's Windows PC.
The player stands in an open field under a giant fractal sphere (the **oracle**). They speak to it;
it answers aloud and fulfils requests by writing/editing game code, which is hot-loaded without
leaving VR.

Target: Quest 3 browser at 72–90 fps in stereo. Also must run in a desktop browser (mouse/keyboard)
for testing. Plain ES modules, no build step, no TypeScript.

## Layout

```
package.json               type: module. deps: three, ws, selfsigned, @huggingface/transformers
server/
  index.js                 HTTPS + static + WebSocket + wiring          (server-infra)
  files.js                 game dir listing, watcher, syntax check, snapshots/undo (server-infra)
  stt.js                   speech-to-text (local Whisper)               (server-infra)
  tts.js                   text-to-speech (Windows SAPI → wav)          (server-infra)
  oracle.js                drives Claude Code CLI as the oracle         (server-oracle)
public/
  index.html               DONE. has #chat input, #status span, #log div
  boot.js                  DONE. stable core: renderer, XR, input, hot loader. READ IT.
  sys/net.js hud.js voice.js   stable client services imported by boot.js   (client)
  game/                    HOT-SWAPPABLE. The oracle's working directory; it may edit anything here.
    manifest.json          DONE. { "core": [paths in load order] }
    core/world.js          field, sky, light, world.groundHeight         (world)
    core/ambience.js       procedural wind + drone soundscape            (world)
    core/kit.js            world.kit building blocks + grab/throw        (kit)
    core/oracle.js         the fractal sphere + world.oracle             (fractal)
    core/player.js         locomotion, pointer, hands                    (gameplay)
    core/spells.js         spell registry + casting, world.spells        (gameplay)
    creations/*.js         things the oracle makes; hand-written examples (gameplay)
server/omnissiah-prompt.md persona + coding manual for the Omnissiah     (server-oracle)
```

## Game module API (what boot.js gives every file under public/game)

```js
export const meta = { name: 'Campfire', description: 'one line' };   // optional
export default function (ctx) {          // may be async
  // build things, add them to ctx.root
  return { update(dt, t) {}, dispose() {} };   // both optional
}
```

`ctx`:

| member | meaning |
|---|---|
| `THREE` | the three.js namespace. Never import three or anything else by bare specifier in creations; relative imports of other game files are allowed but discouraged (they are not hot-versioned). |
| `root` | a `THREE.Group` owned by this module, already in the scene. **Add everything here.** On unload boot removes it and disposes all geometries/materials/textures under it. |
| `scene, camera, renderer, rig` | shared. Move the player by moving/rotating `rig`, never `camera`. If you change `scene.background`, `scene.fog` or anything outside `root`, restore it in `dispose()`. |
| `input` | `input.left` / `input.right`: `{ connected, position, direction, quaternion` (world-space, updated each frame)`, trigger, squeeze` (0..1)`, stick:{x,y}, down:{trigger,squeeze,a,b,stickPress}, pressed(name), released(name), anchor }`. `anchor` is a Group that follows the hand — parent wands/held items to it (and remove them in `dispose`). `input.presenting` = in VR. Desktop is emulated: mouse = right hand, WASD = left stick, arrows = right stick, T = left trigger, E/Q = right a/b. |
| `player` | `{ head: Vector3, forward: Vector3` (world)`, feet: Vector3` (= rig.position)`, rig }` |
| `world` | registry of services from other modules; any may be missing while it reloads — always guard (`ctx.world.spells?.register(...)`). |
| `provide(name, api)` | publish `world[name]`; auto-removed on unload. |
| `events`, `on(name, fn)` | global event bus. Use `ctx.on` (auto-unsubscribed), `ctx.events.emit(name, payload)`. |
| `onDispose(fn)` | extra cleanup. |
| `groundAt(x, z)` | terrain height (0 if world not loaded). |
| `aimPoint(maxDistance = 80)` | ground point the right hand points at → fresh `Vector3` or `null`. |
| `state` | plain object that survives hot reloads of this file (in-memory only). |
| `audio` | `{ listener: THREE.AudioListener, context: AudioContext }` |
| `clock` | `{ t, dt }` seconds |
| `hud` | `hud.show(text, seconds)` toast in front of the player |
| `net` | `net.send(obj)` to server |
| `path` | this module's path, e.g. `creations/campfire.js` |

Rules: a module that throws on load is unloaded and reported to the server; an `update` that throws
is disabled and reported. Keep per-frame allocation near zero. Budget per creation: ≲ 20 draw calls
(use `InstancedMesh` for crowds/particles), no shadows maps > 1024, no post-processing.

### Shared services and events

| name | provider | shape |
|---|---|---|
| `world.groundHeight(x, z)` | core/world.js | terrain height in metres. Field is gently rolling, flat-ish (±1.5 m) within 60 m of origin. |
| `world.oracle` | core/oracle.js | `{ position: Vector3` (world; high in the sky, visible from spawn looking forward −Z and up ~35°)`, radius, setState(s), pulse(strength) }` |
| `world.spells` | core/spells.js | `register({ id, name, color, cast({ origin, direction, hand, ctx }) })` → returns `unregister()` fn; `list()`, `current()`, `select(id)` |
| event `oracle:state` | sys/voice.js + sys/net.js | payload `'idle' \| 'listening' \| 'transcribing' \| 'thinking' \| 'coding' \| 'speaking'` |
| event `oracle:level` | sys/voice.js | 0..1 loudness of the oracle's voice, emitted every frame while speaking (0 otherwise) |
| event `spell:cast` | core/spells.js | `{ id, origin, direction }` |
| events `net:<type>` | sys/net.js | every server→client message, plus `net:open`, `net:close` |
| events `module:loaded`, `modules:synced` | boot.js | |

### world.kit — building blocks for creations (core/kit.js)

The Omnissiah composes most creations from these, so they must be robust, pooled and cheap.
Every factory takes the calling module's `ctx` first so objects land under that module's `root`
and are cleaned up with it. Full signatures live in the header comment of `core/kit.js`.

| call | gives |
|---|---|
| `kit.particles(ctx, { count, color, size, life, speed, gravity, spread, additive })` | one-draw-call pooled emitter: `{ object, emit(position, n, velocity?), update(dt), dispose() }` |
| `kit.humanoid(ctx, { height, skin, shirt, pants, hair })` | stylised person from primitives: `{ group, walkTo(x, z), lookAt(vec3), say(text, seconds), wave(), setSpeed(v), update(dt) }` — walks on terrain, animated limbs |
| `kit.creature(ctx, { legs, bodyColor, size })` | simple quadruped/critter with the same movement interface |
| `kit.body(ctx, mesh, { radius, mass, bounce, grabbable })` | simple physics: gravity, terrain bounce, sphere–sphere collisions, **grab with squeeze and throw**: `{ mesh, velocity, onHit(fn), update(dt), remove() }` |
| `kit.label(ctx, text, { color, size })` | billboard text sprite |
| `kit.sound(ctx)` | procedural WebAudio one-shots, positional: `{ tone({freq, dur, type, at}), noise({dur, filter, at}), chord([...]) }` |
| `kit.light(ctx, { color, intensity, distance, flicker })` | budgeted point light (kit caps the global count) |
| `kit.damageable(ctx, object, { hp, radius, onHit, onDeath })` + `kit.hit(point, radius, amount)` | lets spells/projectiles affect things generically |

Controls: **hold left trigger = talk to the oracle** (owned by sys/voice.js). Left stick = move,
right stick = snap turn (core/player.js). Right trigger = cast current spell, right `a` = next spell
(core/spells.js). Either squeeze grabs `kit.body` objects (core/kit.js). `b` and left `a`/`b` are
free for creations.

## WebSocket protocol (`wss://<host>/ws`)

Text frames are JSON; binary frames are microphone audio.

Client → server
- `{ type:'hello', client:'quest'|'desktop' }`
- `{ type:'utterance_text', text, context }`
- `{ type:'utterance_audio_start', sampleRate, context }`, then binary frames of **mono Int16 PCM**,
  then `{ type:'utterance_audio_end' }`
- `{ type:'module_error', path, message, stack }`
- `{ type:'command', name:'undo'|'reset' }`

`context = { player:{ position:[x,y,z], forward:[x,y,z] }, aimPoint:[x,y,z]|null, modules:[paths] }`

Server → client
- `{ type:'status', state }` — same values as `oracle:state` minus `listening`
- `{ type:'transcript', text }` — what the player was heard to say
- `{ type:'speak', text, audio }` — `audio` is a URL like `/tts/<id>.wav`, or `null` if TTS failed
- `{ type:'reload', modules:[{ path, version }] }` — full ordered listing; `version` = mtime in ms
- `{ type:'notice', level:'info'|'error', text }`

HTTP: `GET /api/modules` → `{ modules:[{path,version}] }` (manifest `core` in order, then
`creations/*.js` sorted by name). Static: `/` → `public/`, `/vendor/three/` → `node_modules/three/`,
`/tts/` → generated wavs. All `/game/*` responses `Cache-Control: no-store`.

## Server internals

`files.js` → `createFiles({ gameDir, onChange })`:
- `listModules()` → `[{path, version}]`
- watches `gameDir` recursively; debounced ~400 ms; for each changed `.js` runs a syntax check
  (`process.execPath --check <file>`); calls `onChange({ modules, syntaxErrors:[{path, message}] })`.
  Files with syntax errors are **excluded from the listing** until fixed.
- `snapshot(label)` copies gameDir into `.snapshots/<timestamp>-<label>/` (keep last 30);
  `undo()` restores the most recent snapshot and returns its label or `null`.
- `checkAll()` → current syntax errors.

`oracle.js` → `createOracle({ gameDir, files, send, speak })`:
- `handleUtterance(text, context)` → Promise; serialised (queue) so turns never overlap.
- `handleModuleError({ path, message, stack })` → feeds a runtime error back for self-repair
  (max 2 automatic repair turns per player request, then `files.undo()` + apology).
- `handleSyntaxErrors(errors)` → same repair path.
- `reset()` forgets the conversation.
- `greet()` → speaks a short awakening line; index.js calls it on the first client `hello` after
  server start (fixed lines, no model call).
- The persona + coding manual is `server/omnissiah-prompt.md`, passed with `--system-prompt-file`
  (it replaces Claude Code's default system prompt; there is no CLAUDE.md in the game folder).
- `send(msg)` broadcasts a server→client message; `await speak(text)` synthesises + broadcasts `speak`.

`stt.js` → `createStt()` → `{ transcribe(int16Array, sampleRate) → Promise<string>, ready }`
`tts.js` → `createTts({ outDir })` → `{ synthesize(text) → Promise<urlPath|null> }`

---

# v2 additions: Quest 3 input, combat, weapons, library

## Input additions (boot.js — DONE)

- `input.left/right.tracked` — true while that hand is a bare tracked hand (Quest hand tracking), false for a
  controller or desktop. `input.passthrough` — true in mixed reality. Events `xr:start { passthrough }`, `xr:end`.
- `hand.fingers` (valid while `tracked`): world-space `wrist, palm, thumb, index, middle, ring, pinky` (Vector3,
  fingertips), `palmNormal` (Vector3 out of the palm), `pinch.{index,middle,ring,pinky}` 0..1 against the thumb,
  `curl.{index,middle,ring,pinky}` 0..1, `gesture`: `'open' | 'fist' | 'point' | 'pinch' | 'none'`.
- Bare-hand gestures are mapped to the normal buttons, so all existing code works with hands: index pinch =
  `trigger`, fist or middle pinch = `squeeze`, ring pinch = `a`, pinky pinch = `b`. Left ring-pinch also walks toward
  where the left hand points (emulated left stick); pinky pinches snap-turn (emulated right stick). boot.js draws a
  jointed hand model itself while tracked.
- `hand.pulse(strength 0..1, ms)` — controller haptics (no-op for bare hands / desktop).

## Factions and combat (core/combat.js → `world.combat`)

Builds on kit damageables. Three factions: `'enemy'`, `'friendly'`, `'neutral'`; the player is `'friendly'`.
Enemies fight the player and friendlies; friendlies fight enemies; neutrals fight nobody unless attacked.

- `combat.fighter(ctx, actor, opts)` — give a kit actor (humanoid/creature) a brain. `opts`: `faction`, `hp`,
  `damage`, `attack: 'melee' | 'ranged' | 'none'`, `range`, `cooldown`, `aggroRange`, `speed`, `leash` (max chase
  distance from home), `follow: 'player' | null` (friendlies), `projectile: { color, speed }`, `name`,
  `onDeath(f)`, `drops`. Returns `{ actor, faction, hp, maxHp, alive, target, setFaction(f), setTarget(t), heal(n),
  remove() }`. Draws a small health bar above the head when hurt.
- `combat.fighters` (live list), `combat.nearest(point, { faction, hostileTo, maxDist })`,
  `combat.count(faction)`, `combat.clear(faction?)` (despawn), `combat.wave(ctx, spec)` helper is NOT here (library).
- Damage attribution: `kit.hit(point, radius, amount, { from })` where `from` is a faction or `'player'`
  (treated as friendly). Hits never hurt the attacker's own faction. `kit.hit` with no `from` hurts everyone
  (back-compatible). Damageables gain an optional `faction` field.
- Player health lives on `world.player`: `health`, `maxHealth`, `alive`, `damage(amount, { from, point })`,
  `heal(n)`, `invulnerable` (seconds), `respawn()`. On death: fade, respawn at origin with full health after 3 s.
  HUD: red vignette pulse when hurt, a health arc on the left wrist. Events: `player:hurt { amount, health }`,
  `player:died`, `player:respawn`, `combat:kill { victim, by }`.

## Weapons (core/weapons.js → `world.weapons`)

Holdable items built on `kit.body` (grab with squeeze). While a weapon is held in a hand, that hand's trigger
uses the weapon instead of casting spells.

- `weapons.create(ctx, type, { position, ...overrides })` → `{ type, body, held ('left'|'right'|null), remove() }`.
- `weapons.define(type, spec)` — add a new type. `spec`: `build(THREE) → Object3D` (grip at the origin, pointing
  along −Z), `kind: 'melee' | 'ranged' | 'shield' | 'tool'`, `damage`, `reach`, `grip: { position, rotation }`,
  ranged: `fire({ origin, direction, weapon, ctx })` or `projectile: { speed, gravity, color, damage, radius,
  explosive }`, `rate`, `ammo`, `sound`, `twoHanded`.
- `weapons.types()` → names. `weapons.held.left/right` → weapon | null.
- Built-in types (at least): `sword, greatsword, dagger, axe, warhammer, spear, club, katana, scythe, bow,
  crossbow, blaster, shotgun, rifle, magic-staff, wand, shield, torch, pickaxe, boomerang, grenade`.
- Melee damage comes from swing speed of the blade tip against damageables (with haptic pulse on hit); ranged
  weapons fire on trigger from the muzzle; a shield blocks projectiles and melee from the front.

## Spells (core/spells.js) additions

- `register` spec gains optional `icon` (emoji or 1–2 letters), `description`, `rate`, `hold` (fires continuously
  while held: `cast` is called every frame with `dt`), `onRelease()`.
- Spell wheel: hold right `a` to open a radial menu at the hand, point/move toward a spell, release to select
  (a quick tap still cycles). Trigger yields to a held weapon: `if (ctx.world.weapons?.held.right) return`.
- With a tracked right hand: index pinch casts along the pointing ray.

## Library (core/library.js → `world.library`) — phase 2

`library.spawn(ctx, name, { x, z, position, count, spread, ...opts })` instantly creates a ready-made thing
(weapon, enemy, ally, creature, structure, nature, prop, effect). `library.list()` → `[{ name, category,
description }]`. `library.wave(ctx, [{ name, count }], { around, radius })` spawns an enemy wave.

## v3 additions: quality tiers, models, generated models (in progress)

- `ctx.quality` (boot.js, DONE): `{ tier: 'pc' | 'quest', pc, shadows, bloom, supersample, density, maxLights, detail }`.
  `'quest'` = standalone headset GPU; `'pc'` = desktop GPU (flat or through Link). On PC, boot enables shadow maps
  and automatically sets `castShadow`/`receiveShadow` on solid meshes (opt out: `object.userData.noShadow = true`);
  the sun's shadow-casting light belongs to world.js. Bloom runs only in the flat desktop view.
- `world.models` (core/models.js): glTF models from `public/assets/` (CC0 packs) and generated ones.
  `models.spawn(ctx, name, { position, scale, yaw })` → `{ object, play(clip, { loop, fade }), clips, mixer, remove() }`;
  `models.has(name)`, `models.list()`, `models.preload([names])`, `models.instances(ctx, name, transforms)`.
  `models.generate(ctx, prompt, { position, size, name })` → placeholder handle that becomes the generated model.
- Generation protocol (WebSocket): client `{ type: 'gen3d', id, prompt, options }` → server
  `{ type: 'gen3d_status', id, state: 'queued' | 'imagining' | 'sculpting' | 'done' | 'error', url, message }`.
  Results are cached under `public/assets/generated/<slug>.glb` with `index.json` (`{ slug: { prompt, url, created } }`).
- `world.style` (core/style.js): global look — toon/rim shading, environment reflections, contact shadows.

---

# v4 additions: plugins, voices, generated audio, physics, menu, quests, perf, travel

## Server plugins (DONE in server/index.js — do not edit index.js; add a file under server/plugins/)

`server/plugins/<name>.js` default-exports `async (api) => ({ name, messages, utterance, routes, shutdown })`.
- `messages: { '<type>': async (msg, ws) => {} }` handles client WebSocket messages of that type.
- `utterance: async (text, context) => boolean` — return true to consume a player utterance (the Omnissiah then
  does not hear it). `context` is what the client sent, including anything from `world.contextProviders`.
- `routes: [{ prefix: '/x/', dir: '<abs dir>', cache }]` extra static folders. `shutdown: async () => {}`.
- `api`: `{ root, publicDir, cacheDir, broadcast(msg), reply(ws, msg), notice(level, text), log, files, oracle,
  services, sapiTts }`. `services.tts = { synthesize(text, { voice }) → Promise<urlPath | null> }` is what the
  Omnissiah speaks through; a plugin may replace it (SAPI remains the automatic fallback when it returns null).
  `oracle.quick(input, promptFilePath) → Promise<string>`: one short low-effort Claude run without tools (system
  prompt from a file) returning one cleaned line, `''` on failure or when the model answers `PASS`. `oracle.busy`.
- Static: everything under `public/` is served; `/vendor/rapier/` → `node_modules/@dimforge/rapier3d-compat/`.
- Local model workers run inside WSL Ubuntu, bind to 127.0.0.1, start lazily, unload/exit when idle, and never
  kill processes they did not start. Ports: gen3d 18765 (exists), voice 18770, audio 18775, travel 18780.
  The GPU (32 GB) is shared with the game when played through Link: measure and keep peaks modest.
  WSL has a 20 GB RAM cap; `server/gen3d/README.md` describes how the gen3d worker copes.

## Client hooks (DONE in boot.js)

- `world.contextProviders.<name> = () => jsonable | null` — merged into the context sent with every player
  utterance (e.g. `npc` = the NPC the player is addressing).
- `ctx.quality` is mutable; whoever changes it emits `quality:changed` on the event bus.

## New modules and their services

| module | service | owner agent |
|---|---|---|
| `core/physics.js` | `world.physics` — Rapier world: bodies, colliders, joints, raycasts, ragdolls | physics |
| `core/audio.js` | `world.audio` — `sfx(nameOrPrompt, { at, volume })`, `music(moodOrPrompt)`, generated + cached | audio |
| `core/voices.js` | `world.voices` — spoken NPC lines, talking to NPCs | voice |
| `core/menu.js` | `world.menu` — wrist menu: library browser, settings, chat history | menu |
| `core/quests.js` | `world.quests` — persistent quests, progression, save data | quests |
| `core/perf.js` | `world.perf` — frame-time governor that scales `ctx.quality` | perf |
| `core/travel.js` | `world.travel` — generated places | travel (later) |

Events: `actor:say { actor, text, seconds }` (kit emits whenever an actor's `say()` is called),
`quality:changed`, `quest:started | quest:progress | quest:completed`, `music:changed`.

## Protocols (WebSocket)

- NPC speech: client `{ type:'npc_say', id, text, voice, emotion }` → server broadcast `{ type:'npc_voice', id, audio }`.
- Talking to an NPC: the client adds `npc: { id, name, role, persona, faction, mood }` to the utterance context
  (through `world.contextProviders.npc`) while the player addresses one; the voice plugin consumes the utterance and
  broadcasts `{ type:'npc_reply', id, text, audio }`.
- Generated audio: client `{ type:'sfx', id, prompt, seconds }` / `{ type:'music', id, prompt, seconds }` → server
  `{ type:'audio_status', id, kind, state: 'queued'|'generating'|'done'|'error', url, message }`. Cache:
  `public/assets/generated/audio/{sfx,music}/<slug>.<ext>` with `index.json` per kind.
- Save data: client `{ type:'save_get', key }` → `{ type:'save_data', key, data }`; `{ type:'save_set', key, data }`.
  Stored as JSON under `D:\omnissiah\saves\`.

## v5 addition: blast — a prompt or picture becomes the world (local image-blaster)

Reference: `D:\omnissiah\image-blaster` (MIT; its own skills call paid FAL / World Labs APIs — never run them; reuse
its schema and prompt rules from `.claude/skills/image-blast-uncover/IMAGE-BLAST.md`). Local port:
1. image: the player's words → a scene image (Z-Image-Turbo, already in WSL `~/gen3d`) — or a user picture from `D:\omnissiah\input\`.
2. uncover: Claude looks at the image (`oracle.ask(input, { cwd, tools: 'Read', promptFile })`) → `image.json`
   (scene description, lighting, atmosphere, ambient sound, de-duplicated rigid objects).
3. plate + object references: a local image-EDIT model removes the objects (clean plate) and isolates each object
   on a plain background.
4. objects → GLB through gen3d with `options.image` (TRELLIS.2); 5. place from the plate through the travel
   pipeline with `options.image`; 6. ambient loop + per-object impact sounds through the audio plugin.
- `core/blast.js` → `world.blast`: `create(promptOrImagePath, opts)` → handle with staged progress; the result is a
  place (via `world.travel`) dressed with the extracted objects as physical, breakable props at plausible positions.
- Server: `server/plugins/blast.js`, `server/blast/**`, WSL `~/blast`, port 18785. Messages: client
  `{ type:'blast', id, prompt | image, options }` → server `{ type:'blast_status', id, stage, state, message, result }`.
  Projects are stored under `public/assets/generated/blasts/<slug>/` (image.json, source, plate, objects, sounds).
- `oracle.ask` (DONE in server/oracle.js) is exposed to plugins as `api.oracle.ask`.
