# Omnissiah — 3D asset library (`public/assets/`) and `world.models`

Real glTF models (CC0 / public domain only) replace the box-and-sphere shapes. This file documents what ships, where it
came from, how the animation sharing works, the catalogue format, performance numbers and how to add more.
The AI-facing API documentation is the header comment of `public/game/core/models.js` (appended to the oracle's prompt);
this file is for humans and for whoever wires `world.models` into `kit` / `combat` / `weapons` / `library`.

## 1. Layout

```
public/assets/
  catalog.json                 the catalogue (885 models, 2 animation sets). Loaded once by core/models.js.
  <pack>/<name>.glb            curated GLBs, one folder per source pack, friendly kebab-case file names
  <pack>/<atlas>.png           the pack's shared colour atlas(es), referenced by relative URI from every GLB of the pack
  <pack>/LICENSE.txt           the licence file shipped inside the original pack (verbatim)
  anim/kaykit-rig-*.glb        shared animation sets for the KayKit "Rig_Medium" skeleton (no meshes, just clips)
  generated/                   AI-generated models (index.json + <slug>.glb) — written by the server, not by us
  _build/                      offline Node tools that produced all of the above (not used by the game)
public/game/core/models.js     world.models service
```

Total shipped: **40.5 MB** (35.1 MB of GLB/atlases in 15 packs, 4.3 MB shared animation, 0.3 MB catalogue, 1.2 MB build tools).
Only `.glb` + `.png` were copied; no FBX/OBJ/Blend sources, previews or duplicate formats. Every GLB was re-packed (section 5):
embedded textures were pulled out into one shared atlas file per pack, unused/duplicate data dropped, parts merged.

## 2. Packs, sources, licences

All licences were verified from the `LICENSE.txt` / `License.txt` inside each downloaded pack (copied next to the models). Every
one of them reads "License: (Creative Commons Zero, CC0) — free for personal, educational and commercial projects; crediting
the author is appreciated but not mandatory". Credit anyway where convenient: **Kay Lousberg (kaylousberg.com)** and **Kenney (kenney.nl)**.

| pack folder | models | MB | source (official) | atlas |
|---|---:|---:|---|---|
| `kaykit-adventurers` | 32 | 2.0 | github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 — knight, barbarian, mage, rogue, rogue-hooded + 27 weapons/shields/items | 4 x 1024² (one per hero) |
| `kaykit-skeletons` | 17 | 1.5 | github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 — 4 skeletons + 13 skeleton weapons | 1024² |
| `kaykit-dungeon` | 96 | 2.7 | github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 (curated from 203) | 1024² |
| `kaykit-medieval` | 161 | 11.0 | github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 — buildings x4 team colours, props, hex nature (tiles skipped) | 1024² |
| `kaykit-halloween` | 56 | 1.1 | github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0 | 1024² |
| `kaykit-furniture` | 46 | 0.7 | github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0 | 1024² |
| `kenney-castle` | 76 | 2.0 | kenney.nl/assets/castle-kit | 512² |
| `kenney-town` | 48 | 1.2 | kenney.nl/assets/fantasy-town-kit (non-modular subset) | 512² |
| `kenney-survival` | 58 | 0.9 | kenney.nl/assets/survival-kit | 512² |
| `kenney-pirate` | 40 | 2.2 | kenney.nl/assets/pirate-kit (ships, cannons, palms, crates…) | 512² |
| `kenney-nature` | 131 | 1.3 | kenney.nl/assets/nature-kit (trees, rocks, plants, camp props) | none (flat material colours) |
| `kenney-graveyard` | 57 | 2.2 | kenney.nl/assets/graveyard-kit (+ zombie, vampire, ghost, skeleton, keeper) | 512² |
| `kenney-pets` | 24 | 3.0 | kenney.nl/assets/cube-pets — animated animals | 512² |
| `kenney-characters` | 14 | 2.5 | kenney.nl/assets/mini-characters (12 villagers) + kenney.nl/assets/mini-dungeon (orc, mini adventurer) | 2 x 512² |
| `kenney-blasters` | 29 | 1.0 | kenney.nl/assets/blaster-kit | 512² |

Exact download URLs used (all plain HTTPS, no login):
`https://codeload.github.com/KayKit-Game-Assets/<repo>/zip/refs/heads/main` for the six KayKit repos above, and the Kenney zips
`https://kenney.nl/media/pages/assets/<slug>/<hash>/kenney_<slug>[_version].zip`, e.g.
`.../castle-kit/a395102d20-1711543616/kenney_castle-kit.zip`, `.../nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip`,
`.../cube-pets/44e58e945f-1774520254/kenney_cube-pets_1.0.zip` (find the current link on each asset page — the hash changes with
updates). Unpacked folder names expected by `_build/build.mjs`: `adv skel dun hex hal furn k_castle k_town k_survival k_pirate
k_nature k_grave k_pets k_minichar k_minidun k_blaster` under `.cache/assets-src/` (`tar -xf x.zip -C dir --strip-components=1`
for the GitHub zips; the Kenney zips unpack flat).

### Skipped, and why
* **Quaternius** (Ultimate Monsters, animated animals, RPG characters, nature…): the official download buttons lead to a Google Drive
  folder or an itch.io checkout (JavaScript flow) — skipped per the rules. This is the one real gap: **no goblins/dragons/bats**; the
  closest are the Kenney `orc`, the KayKit skeletons and `zombie`/`vampire`/`ghost`. If you can fetch Quaternius packs by hand, drop the
  GLBs in and follow section 8.
* KayKit repos not downloaded (off theme or modern/sci-fi): City Builder Bits, Space Base Bits, Restaurant Bits, Prototype Bits.
  The "Forest Nature Pack" is not published on the KayKit GitHub organisation (the org lists exactly ten repos); Kenney Nature Kit covers trees.
* Kenney "Blocky Characters" (18 voxel-style, animated) and Mini Arena/Platformer/Space/Racing/Car/Holiday/Food kits: style or theme mismatch; easy to add.
* Kenney "Animated Characters" pages offered no direct zip link. Kenney weapon-pack is 2D only.
* Not shipped from shipped packs: hex tiles/rivers/roads (terrain is world.js's job), most modular dungeon floor/wall permutations,
  42 banner colour permutations, Kenney town modular wall/roof parts, nature-kit cliffs/ground/path tiles and duplicate rock/stone variants.

## 3. Catalogue (`catalog.json`)

```jsonc
{ "version": 1, "generated": "2026-10-07",
  "models": { "knight": {
      "url": "/assets/kaykit-adventurers/knight.glb", "pack": "kaykit-adventurers", "category": "character",
      "tris": 5274, "size": [2.459, 2.467, 2.022],  // bind-pose bounds, visible parts only (metres in model units)
      "min": [-1.135, 0, -0.579],                    // bounds minimum: origin is at the feet for characters
      "height": 2.315,                               // natural standing height used by spawn({height}) — heroes: top of the bare head
      "scale": 0.8,                                  // recommended uniform scale to reach human scale (see below)
      "rigged": true, "bones": 22, "draws": 3, "materials": 1,
      "rig": "kaykit-medium", "animSets": ["kaykit-rig-adventurers","kaykit-rig-skeletons"],
      "clips": [ ...95 names... ], "tags": ["hero","knight",...], "license": "CC0-1.0",
      "equipment": { "1H_Sword": {"side":"right","default":true}, ... }, "atlas": "knight_texture" } },
  "animations": { "kaykit-rig-adventurers": { "url": ".../anim/kaykit-rig-adventurers.glb", "rig": "kaykit-medium",
                  "clips": [..76..], "durations": { "Idle": 1.07, ... } }, "kaykit-rig-skeletons": { ..95.. } },
  "packs": { "<id>": { "title", "author", "source", "license", "licenseFile", "textures": [{file,width,height,kb}], "models", "bytes" } } }
```
`category` is one of `character enemy animal weapon prop furniture building structure nature vehicle`. Counts:
nature 198, prop 210, structure 178, building 82, weapon 81, furniture 61, vehicle 23, animal 24, character 19, enemy 9.
`animated: "nodes"` marks props whose clips animate plain nodes (chest lids, crypt doors); `attach: {hand, z}` says which hand slot an item belongs in (used by `handle.hold`).

**Scale conventions.** The KayKit character/dungeon/halloween/furniture packs share one chunky scale (a knight's head top is 2.3 units),
so they are used x0.8 (knight ~1.85 m, wall 3.2 m, table 1.6 m). Tile-scale kits get bigger recommended scales: hex buildings x5,
Kenney castle/town x4, survival x3, nature trees x6, Kenney characters x2.6, graveyard x2.2, animals scaled per species
(cat 0.35 m … giraffe 5 m). `spawn()` applies it automatically; `spawn(..., {height: 1.8})` normalises to an exact metre height instead.
Weapon/held-item origins are at the grip, blade along +Y; `handle.hold(item, 'right'|'left')` puts them in the rig's hand slots with
the transform taken from the authored hero files (right: `(0,0.033,0)` rotated 180° about Y; left: `(0,0.017,0)`; shields +0.156 z). The catalogue `attach` field (`{hand, z}`) says which hand an item naturally goes in.

## 4. Characters, rigs and canonical animations

Three rig families ship; `h.play('walk')` etc. picks the best available clip per model (`models.clipFor(name, alias)` shows the choice).

| rig | models | bones | tris | draws | clips available through the aliases |
|---|---|---:|---:|---:|---|
| `kaykit-medium` (KayKit "Rig_Medium") | knight, barbarian, mage, rogue, rogue-hooded, skeleton-warrior, skeleton-mage, skeleton-rogue, skeleton-minion | 22 (23 minion) | 4.3–5.9k | 1 body (skeletons 2: glowing eyes) + visible hand items | idle→`Idle`, walk→`Walking_A`, run→`Running_A`, attack→`1H_Melee_Attack_Slice_Diagonal`, attack-2h→`2H_Melee_Attack_Slice`, shoot→`1H_Ranged_Shoot`, cast→`Spellcast_Shoot`, hit→`Hit_A`, die→`Death_A`, jump→`Jump_Full_Short`, wave→`Interact`, cheer→`Cheer`, sit→`Sit_Chair_Idle`, block→`Block` (plus 80 more; all 14 aliases exist) |
| `kenney-mini` | villager-male-a…f, villager-female-a…f, mini-adventurer, orc, zombie, vampire, ghost, bone-walker, gravekeeper | 3–7 | 0.4–1.1k | 1 | idle, walk, run→`sprint`, attack→`attack-melee-right`, shoot→`holding-right-shoot`, cast→`interact-right`, hit→`fall`, die, jump, wave/cheer→`emote-yes`, sit, block→`crouch` (all 14) |
| `kenney-animal` | beaver bee bunny cat caterpillar chick cow crab deer dog elephant fox giraffe hog koala lion monkey panda parrot penguin pets-fish pig polar tiger | 3–7 | 0.4–1.0k | 1 | idle, walk, run, hit→`gesture-negative`, wave→`gesture-positive`, cheer→`dance` (+ `eat`); no attack/die/jump/sit/cast/shoot/block — `clipFor` returns `null` |

Any exact clip name also works (`h.play('Spawn_Ground')`, `h.play('Taunt')`). Extra aliases: taunt dodge spawn pickup throw interact crouch fall dance eat
idle-combat idle-2h strafe-left strafe-right walk-back. The skeleton set adds `Spawn_Ground`, `Skeletons_Awaken_*`, `Death_C_Skeletons(_Resurrect)`, `Taunt`,
`Idle_Combat`, `Walking_D_Skeletons`, `Running_C`, `Spellcast_Summon`. Playing a clip that lives in the other set downloads that set on demand.

### How the KayKit shared animations map onto the rigs

Every KayKit character GLB (Adventurers and Skeletons) embeds all of its animations (3.5–4.7 MB each, 41 bones including 19 IK/control
helper bones that nothing is skinned to). All nine characters have the **identical skeleton**: same bone names, same hierarchy, same rest translations and rotations
(checked node by node; the only difference is a quaternion sign flip on `toes.r`). Animation is therefore retargeted **by bone name** and needs no
mapping table: AnimationMixer binds a track `hips.position` / `upperarml.quaternion` to the node of that name under whichever character it is
bound to (GLTFLoader sanitises names: `upperarm.l` becomes `upperarml`; `handle.bones` exposes both spellings).

The build step therefore splits each character into **one mesh-only GLB** (~350 kB) and two shared **clip-only GLBs**:
`anim/kaykit-rig-adventurers.glb` (76 clips from the Knight; Barbarian and Mage carry byte-identical data) and `anim/kaykit-rig-skeletons.glb`
(95 clips from the Skeleton Warrior; a superset of the former by name — the data are separately authored per pack). Tracks for the 19 IK/control
bones were dropped, scale tracks that never move and translation tracks equal to the rest pose were dropped, so each set is 1.8 / 2.6 MB
instead of 3.5 / 4.7 MB **per character**. (The Rogue's own data differs slightly; it uses the Adventurers set.)

**Proof, run headless** (`three` GLTFLoader + AnimationMixer in Node, 10 clips x 2 time samples, 20 bones, compared as bone positions in model space against the pack's own
original GLBs with the original embedded clips): shared-set clip on Knight vs Knight's own clip, shared clip on Skeleton Warrior vs its own, and the *skeleton-pack*
clip driving the *Knight* vs the original Skeleton Warrior playing it — **worst error 6e-7 model units** in all three comparisons. All 28 tracks of
`Skeletons_Awaken_Standing` resolve to bones on the Knight. The Kenney node-animated rigs (animals, zombie…) were converted at build time into a single skinned mesh
(each moving part becomes a bone, weights = 1); deformed bounds against the original node animation differ by < 1e-7 for cat, elephant, zombie and villager.

### Equipment on the heroes
Hero GLBs carry their weapons as hidden child nodes of the hand slots (`userData.equip = 'left'|'right'`, `userData.default`). Defaults visible:
knight 1H sword + rectangle shield, barbarian 2H axe, mage 2H staff, rogue knife + off-hand knife. `h.equip({right:'2H_Sword', left:null})`, `h.equipment`.
Hats, helmets, hoods and capes are baked into the body mesh (they are rigidly attached to head/chest bones in the source anyway).

## 5. What the build does to each file (`public/assets/_build/`)

`build.mjs` (curation + renames + categories) → `catalog.mjs` (parses every shipped GLB with three's GLTFLoader and measures it) → `header.mjs` (rewrites the catalogue
block in the `models.js` header); `contactsheet.mjs` renders colour contact sheets for verification (section 12.1). `gltfpack.mjs` is a small dependency-free re-packer: external/embedded image → one shared atlas per pack (relative URI);
identity `KHR_texture_transform` removed (it forces a texture clone per material); metallic forced to 0 where a material says nothing or says 1 without a map
(Kenney nature kit would render black without an environment map); Kenney nature's flat colours converted from sRGB-stored-as-linear to real linear factors; unused accessors dropped; for KayKit characters: all skinned parts + rigid hats/capes
merged into one mesh per material, unused joints dropped (41 → 22), IK nodes and animations removed (animations go to the shared sets); for Kenney node-animated rigs: converted to skinned
single meshes; for Kenney skinned characters: parts merged. Nothing in the downloads was executed.

## 6. `world.models` runtime design notes

* **One three.** `models.js` imports `GLTFLoader`, `SkeletonUtils`, `BufferGeometryUtils` from `/vendor/three/examples/jsm/...` (absolute URLs, same files the
  page's import map serves for `three/addons/`), so there is exactly one three instance.
* **Shared textures.** A GLTFLoader plugin returns one `Texture` per atlas file for the whole game (no GLB ever creates its own copy; no texture is ever cloned).
* **Materials per tier.** `ctx.quality.tier === 'quest'`: `MeshStandardMaterial` → `MeshLambertMaterial` (map/colour/emissive kept; cached per source material).
  `'pc'`: standard materials. A glTF "unlit" material (`MeshBasicMaterial`) becomes Lambert on both tiers so it reacts to the sun (no shipped pack contains one: the Kenney nature originals
  list `KHR_materials_unlit` in `extensionsUsed` but no material uses it, and the re-pack drops it, so nature ships as ordinary matte PBR; see section 12).
* **Draw calls.** Static models are merged to one geometry per material at load (`spawn`: measured average 1.17 draw calls over the 829 static models, most are exactly 1; the pirate ship goes 6→1). Skinned characters are 1 draw
  call plus visible hand items (skeletons 2). `instances()` is one `InstancedMesh` per material (a 1 500-tree forest = 2 draws).
* **Disposal.** boot.js `disposeTree()` disposes geometry/material/texture under a module root. The cache's originals are never in a root, and every shared geometry/material/texture is
  marked shared with its own `dispose` replaced by a no-op, so another creation unloading cannot damage them. GPU memory is released by `models.js` itself: entries are reference counted by
  live instances, an entry idle for 45 s has its GPU buffers freed (three re-uploads transparently on next use). Per-instance objects (skeleton bone textures, tinted materials, InstancedMesh
  matrices, weaving effects) are disposed in `remove()`. Everything spawned is released on the caller's `ctx.onDispose`.
* **Animation cost.** One `AnimationMixer` per animated instance, all stepped by `models.js`' own `update`. Within 2 m: every frame. Otherwise `stride` = 3 (outside the ~70° view cone or
  beyond 40 m), 6 (both), 12 (beyond 100 m); on the Quest tier instances beyond 25 m run at half rate. dt is accumulated, so speed stays correct. Skinned meshes use a fixed generous
  culling sphere (the bind-pose sphere is wrong once animated).
* **Hot reload.** Cache, parsed anim sets, live handles and generation jobs live in `ctx.state`; reloading `models.js` keeps animating existing handles and never refetches.
* **Generation.** `generate()` checks `/assets/generated/index.json` first (cached model → no request), otherwise sends `{type:'gen3d', id, prompt, options:{size,name}}` and follows
  `net:gen3d_status` (queued → imagining → sculpting → done|error). Placeholder: rotating wireframe icosahedron + rising motes, colour per state; on `done` the GLB is loaded, centred, stood on
  the ground, scaled so its largest side equals `size`, and pops in; on `error`: broken crystal marker + `hud.show`. 6-minute timeout.

## 7. Performance notes (Quest 3, 72 fps target)
* Rigged hero/skeleton: **22 bones**, 4.3–5.9k triangles, 1–3 draw calls (body + visible items), 1024² atlas shared. Kenney characters/animals: 3–7 bones, 0.4–1.1k triangles, 1 draw call.
  Neither rig is "too heavy"; 30 KayKit characters = ~150k triangles / ~70 draw calls (measured: 6 hero kinds x 5, default equipment), which is affordable but is the largest
  consumer — prefer Kenney villagers/animals for crowds (30 of them are ~25k triangles and 30 draw calls).
* Textures: all atlases are 1024² (KayKit, ~15 kB PNG each, ≈ 5.3 MB GPU with mips once loaded) or 512² (Kenney). None larger than 1024. Loaded textures: only the atlases of the packs in use.
  Palette atlases could be downsized to 256² without visible loss if GPU memory ever matters (they are colour swatches).
* The hex-pack nature pieces (`mountain-*`, `hills-*`) and `crypt`, `castle-*` are 1–6k triangles each — fine as single set pieces, avoid scattering them.
* JS cost measured in Node: 30 animated characters + module update ≈ 0.2 ms/frame. Real GPU skinning cost has not been measured on a headset.

## 8. Adding more assets
1. Download the pack from its **official** source, check its licence file says CC0/public domain, unpack under `.cache/assets-src/<short>/`.
2. Add a pack entry to `PACKS` in `public/assets/_build/build.mjs` and a function that picks files with `bulk(pack, dir, filter, describe)` (set `category`, `tags`, and for animated
   non-KayKit rigs `{rigidToSkin: true}` or `{mergeSkinned: true}`; skip those options for plain props).
3. `node public/assets/_build/build.mjs && node public/assets/_build/catalog.mjs && node public/assets/_build/header.mjs`
   (Node at `D:\omnissiah\tools\node\node.exe`). Adjust `recommendedScale()` in `catalog.mjs` for the new pack, and `SYNONYMS` in `models.js` if useful.
4. Quaternius-style packs that ship GLB with embedded textures also work: images are extracted to an atlas file automatically.
5. A different humanoid rig needs its own animation set: build with `buildAnimSet()` from one character and list it in the characters' `animSets`.

## 9. Server notes (for the lead)
`server/index.js` `MIME` already contains `.glb` (`model/gltf-binary`), `.gltf`, `.bin`, `.png`, `.jpg`/`.jpeg`, `.webp`, `.json`, `.ktx2`: **nothing is missing** for this asset set.
`/assets/**` is served `Cache-Control: no-cache` + ETag, i.e. revalidated on every load (≈900 cheap 304s; the largest first-time download is ~3 MB for a hero + animation sets). Adding
`public, max-age=86400` for `/assets/` (but keep `catalog.json` and `generated/index.json` `no-cache`) would be a nice win; files are static between asset rebuilds.
`public/assets/_build/` is served too; harmless, but it can be excluded from static serving if you prefer.

## 10. Known limits
* Not tested on a headset; headless Edge (SwiftShader) rendered every code path used (skinned characters, instanced forest, atlas sharing, quest tier materials, generate placeholder).
* No goblins/dragons/bats/wolves (see Skipped). `h.equip` only exists for the five KayKit heroes; skeletons use `h.hold('skeleton-blade', 'right')` etc.
* Kenney characters are a different (cuter) style and scale than KayKit; mixing them in one scene works but looks mixed.
* Skinned instancing (crowds on one draw call) is not implemented; `instances()` is for static models only.
* Spawn-time fuzzy `find()` is heuristic (synonyms table in `models.js`); unknown names produce an error handle (`h.error`, a red wireframe marker, `h.ready` still resolves).

## 11. Hero models (`public/assets/hero/`, pack `hero`) — made in Blender for this game

26 models, 4.4 MB total, all sharing ONE texture: `hero/hero-palette.png` (256x512, 32 colour families x 16 shades, flat 16 px swatches; every face of every hero model is UV-mapped to a swatch centre, so
there is a single GPU texture for the whole pack, shared by `models.js` through its uri+sampler key). Each GLB has the material `Palette` and (optionally) `Emissive`
(same palette as `emissiveTexture`, `emissiveFactor` 1 — raise `material.emissiveIntensity` / tint it to make it glow, or swap it for a pulsing material). Licences: derivatives `"CC0 (derived from KayKit, modified)"`,
everything else `"original, made for this game"`; `hero/LICENSE.txt` has the text.

### 11.1 Monsters on the shared KayKit rig (mesh-only skinned GLBs, ~3.6–4.9k tris, 1 draw call, 22 bones)
| catalogue name | derived from | what changed | natural bbox height -> recommended scale |
|---|---|---|---|
| `goblin` | Rogue | hand-built head (long ears, hooked nose, fangs, yellow slit eyes), green skin, ragged browns, big hands/feet, thin limbs, pot belly, head tilted forward | 2.30 -> 0.48 (1.1 m) |
| `goblin-shaman` | Rogue (hooded) | same head + feather/bone headdress, purple robe | 2.76 -> 0.48 |
| `orc-warrior` | Barbarian | grey-green heavy-jawed head with tusks + mohawk + red eyes, spiked iron pauldrons, chest plate, thicker arms | 2.32 -> 0.86 (2.0 m) |
| `troll` | Barbarian | blue-grey hide, huge arms/fists (radial x1.7/1.85), small thin legs, hunched, small tusked head with bulbous nose, moss patches | 1.97 -> 1.52 (3.0 m) |
| `dark-knight` | Knight | black iron, maroon cape, violet trim, swept horns + crest on the helm, spiked pauldrons | 2.66 -> 0.79 (2.1 m) |
| `demon` | Mage | red skin, charcoal robe, curled horns, fanged head, tail (weighted 100% to `hips`), small bat wings (100% to `chest`) | 2.49 -> 0.76 (1.9 m) |

NOTE: the catalogue already had a Kenney `orc`, and entries are never replaced, so the new one is `orc-warrior` (tag `orc`). `M.find('orc')` still returns the Kenney one.

Rig guarantee: bone names, hierarchy, rest transforms and inverse bind matrices are copied byte-for-byte from the shipped KayKit GLB (`graft.mjs` rebuilds the node list from the shipped file and only swaps the
mesh). Diff (three.js, bones by name, local + world matrices + IBMs): 0.0 vs the character each was derived from; 2.4e-7 goblin vs knight; 3.7e-6 troll vs skeleton-warrior (the pre-existing `toes.*`
quaternion sign flip). So `animSets: ["kaykit-rig-adventurers","kaykit-rig-skeletons"]` and `clips` (all 95 names) are identical to the heroes' and `play('walk'|'attack'|'die'|'hit'|'cast'…)` resolve to Walking_A,
1H_Melee_Attack_Slice_Diagonal, Death_A, Hit_A, Spellcast_Shoot (proved by loading `core/models.js` itself headlessly, see 11.5). They carry no held items and no `equipment`; use `h.hold('storm-hammer')` etc.
Held-item slots (`handslot.r/l`) are intact.

How they were built: `.cache/blender/tools/derive_lib.py` imports the shipped mesh-only GLB into Blender, samples the original gradient atlas at every face's UV to get its source colour, then (1) recolours by rules on that colour
(skin -> new skin family etc.), (2) reshapes with per-bone transforms blended by skin weights (`Model.deform`: scale/radial/shift/rotate about a bone, so joints never move), (3) deletes the head faces and rebuilds the head from primitives
rigidly weighted to `head`, (4) adds horns/tusks/pauldrons/tails as new geometry weighted 100% to one bone. `Model.dump()` writes the mesh (flat/smooth-by-45° normals, <=4 influences) to JSON and
`graft.mjs` writes the GLB. (This replaces Blender's own glTF export for these six: the exporter re-derives bone rest poses and would not reproduce the shipped skeleton exactly.)

### 11.2 Dragon (`dragon`, `dragon-whelp`) — from scratch, own armature, 8 baked clips
38 bones: `Root Hips Spine Chest Neck1-3 Head Jaw Mouth Tail1-6 FrontUpper/Lower/Foot_L/R BackUpper/Lower/Foot_L/R WingArm/WingFore/WingF1-3_L/R`. `Head`, `Jaw` and `Mouth` (child of `Head`, sits at the snout tip; use it as the fire
origin: `h.attach(emitter, 'Mouth')` — `models.js` bone lookup ignores case) are as requested. Clips (30 fps, own clips inside the GLB, no animation set): `idle`(3.0 s loop) `walk`(1.33 loop) `fly`(1.0 loop)
`attack`(1.37) `breathe`(2.7: rear back, lunge, hold with jaw open) `hit`(0.83) `die`(2.7, topples onto its side and stays) `roar`(2.37). `play('idle'|'walk'|'attack'|'hit'|'die')` resolve through the normal aliases;
`fly`, `breathe`, `roar` are exact names (`play('run')` returns null — no run clip). ~1.85k tris, 2 materials (`Palette`, `Emissive` = the eyes), 2 draw calls, doubleSided (membrane wings).
`dragon`: crimson/gold/bone, 7.7 m nose-to-tail-tip in the model, recommended scale 0.78 (= 6 m, ~3.4 m tall with horns, wings spread in the rest pose are 8.8 m). `dragon-whelp`: teal/violet recolour with a bigger head on the same rig, scale 0.31 (2.4 m).
Models face +Z (glTF), stand on y=0.

### 11.3 Omnissiah regalia + signature weapons (static, `Palette` + `Emissive`)
`omni-shard-a/b/c` 134–252 tris, ~1 unit, long axis = X, centred (instance them: `M.instances(ctx,'omni-shard-a',…)`), `omni-altar` 1.4k (3.5 m wide hex dais, socket at y≈1.1 for `omni-relic`), `omni-obelisk` 0.7k (5.5 m), `omni-throne` 1.1k, `omni-relic` 0.9k
(1 m, centred, for floating/rotating), `omni-gate` 1.2k (5.7 m tall arch, walk-through opening ~2.5 m wide, scale 0.9 = 5.1 m).
Weapons (`omni-blade sun-spear void-scythe storm-hammer ember-staff aegis-shield star-bow rune-dagger arc-blaster prism-rifle`, 300–1000 tris, KayKit unit scale, recommended scale 0.8): **grip at the origin, business end along −Z, +Y up** (as requested).
The existing KayKit weapons point +Y, which is what `h.hold()` assumes, so to hold one of these in a KayKit hand slot add a +90° rotation about X (`holdRotateX: 90` in the catalogue entry):
`h.attach(w, 'handslot.r', {position:[0,0.033,0], quaternion: …(0,-1,0,0)·Rx(90°)})` — or just rotate the spawned object once. `aegis-shield` faces −Z, grip behind it (`attach.hand: 'left'`). `star-bow` is vertical (limbs along Y), arrow axis −Z.

### 11.4 Rebuilding
Sources: `.cache/blender/*.blend` (one per model; `orc-warrior.blend`) and the scripts in `.cache/blender/tools/` (`hero_lib.py` palette+builders, `derive_lib.py`, `goblin.py`/`monsters.py`/`monsters2.py`,
`dragon.py`+`dragon_anim.py`+`export_dragons.py`, `props_lib.py`+`props.py`, `boot.py` loads them all). In Blender: `exec(open(r'…\tools\boot.py', encoding='utf-8-sig').read())` (also rewrites `hero-palette.png`!),
then e.g. `build_orc().dump(BL+r'\export\orc.json')`, `export_variant('dragon')`, or `export_static(MODELS[n](), n)`. Then with Node (`D:\omnissiah\tools\node\node.exe`): characters `graft.mjs dump.json <shipped.glb> out.glb --double`;
Blender-exported GLBs `finalize.mjs raw.glb out.glb [--double]` (externalises the palette texture, canonical sampler, compacts the buffer); `catalog_add.mjs` (append-only, atomic) writes the catalogue entries.
Checks: `verify.mjs file.glb [--ref shipped.glb]` (tris, materials, bbox, skin, clips, rig diff), `pose.mjs` (evaluate shared clips with three's skinning and write a static posed GLB for Blender renders), `models_test.mjs`
(`node --import ./models_register.mjs models_test.mjs`: loads the real `public/game/core/models.js` with a fetch/Image stub and spawns/plays the hero models). Previews: `.cache/blender/previews/`.

### 11.5 Known limits
* Looks verified in Blender Workbench renders and three.js posing only; not seen in the game's renderer or on a headset. Emissive parts only glow if the game raises their emissive (they show as bright palette colour otherwise).
* Derived characters inherit KayKit's T-pose rest; extra horns/tails/wings are rigid (no secondary motion). Weights were checked on walk/run/attack/cast/cheer/death frames, no tearing seen, but not every one of the 95 clips.
* Dragon wing membranes are single-sided doubleSided planes; the folded-wing idle pose is a large sail on the flank rather than a neat fold. `dragon.glb` is 1.1 MB because the clips are sampled every frame.

## 12. Colours: what the Kenney packs really look like, and how to verify colours

**Investigation result (2026-10-08): the shipped Kenney models have the colours their author intended; nothing was changed in the assets, the build or `core/models.js`.**
A report said the Nature kit "ships hue-shifted (teal leaves, salmon bark)", the Castle atlas "renders flat orange", and Graveyard `iron-fence` / `hay-bale` / `road` "are off". All of that is what the
packs look like as authored. Evidence:

* **Nature kit.** Kenney's own files say so: every `.mtl` in `k_nature/Models/OBJ format` has e.g. `leafsGreen Kd 0.1607843 0.7882353 0.6705883` (= #29C9AB, teal) and `woodBark Kd 0.886 0.514 0.341` (= #E28357, salmon);
  the pack's `Preview.png`, its `Side/*.png` and `Isometric/*.png` renders show teal trees, orange dirt, pale-blue stone (pixel check: the Side render of `tree_oak` shows leaves at RGB 39,190,161 = #29C9AB x 0.94
  shading). Those factors are display (sRGB) values written into glTF's linear `baseColorFactor` (renders in the author's previews confirm it), which is why `gltfpack.mjs` converts them to linear (`srgbFactors`, nature only) and
  forces `metallicFactor` 0 (the originals say metallic 1 and render black without an environment map). Both are correct; the shipped colour of every nature material equals the author's display colour.
* **Castle / Town / Survival / Pirate / Graveyard / Pets / Characters / Blasters.** Each pack has ONE `colormap.png` palette atlas and UV-mapped swatches. Atlas files in `public/assets` are byte-identical (md5) to the
  originals in `.cache/assets-src`; the UVs, triangle counts and material definitions of all 477 Kenney GLBs match their sources (script: parse both files, compare accessor sums; the one difference is `crops-corn-stage-d`,
  where the re-pack drops 4 mesh definitions no node uses), and so do the accessor bounding boxes of the 382 static ones (the rigged pets/characters are re-packed into skinned meshes); the originals' only
  `KHR_texture_transform` is `{texCoord: 0}` (identity, correctly removed). The castle really is peach walls + blue roofs + orange wood, the graveyard really has green iron fences, orange hay bales/wood, lavender-grey stone
  (see the packs' `Preview.png`); town stone is lavender, roofs red/teal; survival wood is orange. A plain `GLTFLoader` render of the ORIGINAL files and the shipped files through `models.js` (both tiers) agree to <= 5/255 mean RGB
  for every Kenney model outside the nature kit (89% of the comparisons < 2).
* **The build is reproducible.** `build.mjs` + `gltfpack.mjs`, run from a copy against `.cache/assets-src`, regenerate all 920 files of `public/assets` (GLBs, atlases, anim sets, licences) bit-for-bit.
* **`models.js` is not the cause.** Shared atlas textures, sampler keys, sRGB colour spaces, Lambert conversion (`color`, `map`, `emissive`, `vertexColors`) were checked in real WebGL on both tiers; no vertex colours or
  texture transforms exist in any shipped model, so nothing can be dropped or double-applied.

So the Kenney palette is simply not "natural": leaves are teal, wood is orange, stone is lavender, roads are lavender-grey, castle stone is peach. If the game wants green leaves / brown bark / earthen roads, that is an **art
direction recolour**, not a bug fix. Do it deliberately and at the source (a named material->colour table applied in `gltfpack.mjs`/`build.mjs` for the nature kit, whose materials are flat factors; for the atlas packs
by editing the shared `colormap.png` swatches or a recoloured copy of the atlas) rather than at run time. The run-time repair in `game/library/modelkit.js` (`NATURE_FIX` / `repairColours`) is exactly such a recolour with
hand-chosen target colours; it still matches every nature material of the shipped files (all 20 colour names, exact hex), so it keeps working and is harmless.

### 12.1 Verifying colours when adding or rebuilding a pack
1. Find ground truth in the download: `Preview.png`, `Sample.png`, `Previews/<model>.png` or `Side/*.png`, and the OBJ `.mtl` `Kd` values. Decide what the author intended before judging a render.
2. Render the contact sheets with `public/assets/_build/contactsheet.mjs` (Node + headless Microsoft Edge, throw-away static server on a random localhost port; no dependencies):
   `D:\omnissiah\tools\node\node.exe public\assets\_build\contactsheet.mjs --pack kenney-castle --cols orig,raw,quest,pc --maxdist 10 --out .cache\sheets --tag after`
   Columns: `orig` = the original download through plain three `GLTFLoader`; `raw` = the shipped GLB through plain `GLTFLoader`; `quest` / `pc` = the shipped GLB through the game's own `core/models.js` with
   `ctx.quality.tier` set accordingly. Neutral white light (ambient 0.75 PI + directional 0.25 PI, no tone mapping), so a lit face shows the albedo. It writes `<tag>-<pack>-NN.png` sheets, per-cell JSON (mean RGB,
   distinct-colour count, coverage, bounds) and `<tag>-<pack>-summary.json` with `dist` (RGB distance of each column from the first); `--maxdist N` prints the offenders and exits 1. Also `--names a,b`, `--limit`, `--start`, `--cell`, `--list`.
3. Look at every sheet (a wrong colour space or a dropped `KHR_texture_transform` shows as a column that differs from `orig`, or as one flat colour: `ncol` 1-3 where the model has several). Exceptions to expect: nature's `orig`
   column is nearly black (metallic 1, no environment) and its flat factors are sRGB-in-linear, so compare `raw` vs `quest` vs `pc` there (`--cols raw,quest,pc`) and judge the colours against the pack's preview images;
   KayKit heroes differ by up to ~16 in `quest`/`pc` (merged parts, Lambert vs standard specular) and a few `trees-b-*` by ~10 in `quest`.
4. Check the file-level invariants too: atlases are byte-identical to the download (or only resized), <= 1024 px, one shared file per pack; bounding boxes and triangle counts equal the source (the build never changes geometry).
## 13. Set pieces: ruins, start-zone dressing (`hero` pack, made in Blender, 2026-10-08)

17 static models, all with the shared `hero-palette.png`, materials `Palette` + `Emissive` (same as section 11), flat-shaded low poly, origin at ground centre, glTF +Y up, **front / opening faces +Z**, 1 unit = 1 m (recommended `scale` 1 unless noted). Catalogue entries carry `description`, and where relevant `tile`, `note` and `chunks` (`[{name, supports}]`, the named child nodes in the GLB and what each rests on, meant for `kit.structure`). Thumbnails: `.cache/blender/previews/sets/<name>.png`.
Spawn with `ctx.world.models.spawn(ctx, '<id>', { position, yaw })`. Size = bounding box [x, y, z] in metres at scale 1.

| id | tris | size m | what / how to use |
|---|---:|---|---|
| `pilgrim-altar` | 2408 | 5.7 x 4.1 x 5.7 | octagonal dais, altar with glowing offering orb, standing gold ring framing the sky in front (+Z); cushions for the pilgrim behind (-Z). Place at the spawn point rotated so +Z faces the Omnissiah |
| `rune-obelisk-a` | 1166 | 2.8 x 7.1 x 2.8 | four-sided obelisk, circuit runes on every face, floating crystal + ring |
| `rune-obelisk-b` | 4076 | 3.8 x 6.8 x 3.3 | hexagonal tiered obelisk, gold bands, floating gear rings |
| `rune-obelisk-c` | 1568 | 3.4 x 3.8 x 3.9 | snapped obelisk, upper half leaning on the stump, crystals |
| `waystone` | 284 | 3.6 x 3.5 x 1.1 | standing stone with a BLANK dark plaque 1.0 x 1.3 m for a text plane: centre `[0, 1.55, 0.318]`, facing +Z (`note` in the catalogue); plus a two-arm signpost on the +X side |
| `weapon-rack` | 576 | 2.8 x 2.7 x 1.25 | 3 swords, spear, axe, round shield |
| `spell-lectern` | 786 | 1.15 x 1.9 x 1.15 | open glowing book tilted toward +Z, floating orb with rings |
| `ruined-arch` | 842 | 5.8 x 6.2 x 3.3 | 3.4 m gap framed by a pillar + half arch and a broken pillar; faces +Z |
| `jetty` | 674 | 2.1 x 4.3 x 8.8 | 8 m pier on piles, extends toward +Z from the shore end (origin); deck top at y=0.6, piles reach y=-1.2: set y to the water surface (`groundAt` is the shore) |
| `camp-tent` | 164 | 4.2 x 2.0 x 3.3 | ridge tent + bedroll, door faces +Z |
| `camp-log-seat` | 264 | 4.8 x 0.5 x 2.7 | three log seats around the point (0, 0, 1.0); put the campfire there |
| `camp-tripod` | 304 | 1.4 x 1.6 x 1.2 | cooking tripod with a pot (glowing stew) to stand over a campfire |
| `colossus-head` | 2330 | 13.5 x 9.9 x 14.8 | half-buried head looking up/+Z, one glowing eye, open jaw, ear cogs, broken gear halo, rubble |
| `gear-cathedral-gate` | 3700 | 15 x 16.5 x 3.4 | gothic gate with a gear rose window, walk-through 4 m opening, glowing slits; recommended scale 0.8 |
| `floating-shrine` | 2766 | 8.9 x 11 x 10.3 | floating island, gold-roofed shrine, 3 static rings; hovers 0.85 m above y=0 |
| `floating-shrine-core` | 1578 | 8.9 x 11 x 9.1 | same without the rings |
| `shrine-rings` | 1188 | 8.7 x 6.7 x 10.3 | the three rings only, centred on the origin: put it at (0, 6.9, 0) relative to `floating-shrine-core` and spin `object.rotation.y` / tilt for an orbit |

Emissive parts use the `Emissive` material (palette as emissiveTexture), so they glow with the global bloom/toon pass; raise `emissiveIntensity` to pulse them. Static models are merged to one mesh per material at spawn (`models.js buildParts`), which is why the named chunks are not reachable from `spawn()`; see STATUS 2026-10-08 ~23:45 for the requested `keepNodes` option.
Rebuild: scripts in `tools/blender-scripts/sets/` (`run_sets.py`, `sets_pack.mjs`; sources `sets_a.py`, `sets_b.py`, `sets_c.py`; per-model catalogue data in `sets_meta.json`).
Not built (cut by the time limit): tileable aqueduct / bridge, bell tower, reliquary altar, observatory, airship, portal arch, forge, market stalls, machine throne, crystal clusters, stump house.

## 13. Gear models (`public/assets/hero/`, pack `hero`) — starter gear, relics, wearables (2026-10-08)
23 hand items / pickups / wearables, 182–1240 tris each, 1–2 draws, same `hero-palette.png` (`Palette` + `Emissive`). **Real metres, catalogue `scale: 1`** (not the 0.8 KayKit factor of section 11.3). Hand items follow section 11.3 (grip at origin, business end -Z, +Y up); pickups are bbox-centred; `cog-crown`, `pilgrim-hood`, `gear-halo` are worn (origin at the head ring / head centre / ring centre); `reliquary-lantern` hangs from the origin; `spell-tome` origin = centre of the spine. Entry fields: `attach`, `forward`, `up`, `holdRotateX`, `origin`, `doubleSided` (hood).
Starter: `pilgrim-sword pilgrim-bow pilgrim-shield novice-staff reliquary-lantern health-vial mana-vial cog-crown`. Later: `cog-greatsword lightning-spear censer-flail rune-hammer clockwork-crossbow plasma-blunderbuss fractal-staff twin-sickles eye-tower-shield grapple-gauntlet spell-tome brass-key treasure-idol pilgrim-hood gear-halo`. Which weapon type / pickup each should replace, with suggested `model:` specs: `docs/GEAR_MODELS.md`.
Rebuild: `blender.exe --background --factory-startup --python tools\blender-scripts\gear\gear_main.py -- <ids|all>` (raw GLB + thumbnails in `.cache\gear\`), then `node tools\blender-scripts\gear\finalize_gear.mjs <ids>` (writes `public/assets/hero/<id>.glb`), `node …\catalog_gear.mjs <ids>` (atomic catalogue edit), `node …\gen_doc.mjs`. `finalize_gear.mjs` can also add node clips (spec in `gear_opts.json`) — meant for vehicles, which were not built (`hover-sled brass-strider biplane`: a GLB with clips keeps its named nodes in `models.js`; a static one gets merged to one mesh).

## 13. Creature models for the starting zone (`public/assets/hero/`, made 2026-10-08 night, tool `tools/blender-scripts/creatures/`)

Nine skinned, animated creatures in pack `hero` (same `hero-palette.png`, materials `Palette` + `Emissive`, 2 draw calls, doubleSided like the dragon). Authored in metres, `scale` 1, origin at the feet (+Y up), facing +Z. Own armature (7-16 bones, rigid-skinned: every mesh part is 100% weighted to one bone), own baked clips (30 fps) `idle walk attack hit die` (+ `graze` on the moss-grazer). `rig` = the model name (not in kit's RIGS: kit treats them as generic bodies, whole-body deaths; the `die` clip exists so `kit` plays it). Bones are CamelCase: `Root Body|Hips|Chest Head Jaw Arm_L/R Forearm_L/R Leg_L/R Shin_L/R Tail* Cog Core ...` (limbs are separable per bone by skin weight if kit later gets a RIGS entry).

| id | category | tris | size (m, w x h x l) | role |
|---|---|---:|---|---|
| `cog-familiar` | character | 1202 | 0.43 x 0.72 x 0.34 | friendly companion |
| `clockwork-rabbit` | animal | 692 | 0.34 x 0.70 x 0.66 | critter (hops) |
| `brass-firefly` | animal | 392 | 0.50 x 0.21 x 0.42 | flying swarm piece (wings buzz in every clip) |
| `moss-grazer` | animal | 960 | 1.18 x 1.92 x 3.10 | big gentle ambient beast, extra clip `graze` |
| `scrap-goblin` | enemy | 976 | 0.92 x 1.35 x 0.47 | first easy enemy |
| `rust-beetle` | enemy | 568 | 0.94 x 0.50 x 1.05 | easy enemy, dies on its back |
| `wisp` | enemy | 268 | 0.72 x 0.78 x 0.35 | easy enemy / ambient (hover it; `die` shrinks it away) |
| `training-dummy` | enemy | 1028 | 1.96 x 2.12 x 1.24 | practice target, `hit` sways |
| `clockwork-sentinel` | enemy | 1956 | 3.09 x 3.95 x 2.03 | first mini-boss |

All well under the 3k (6k boss) budgets. Catalogue extras: `headBone`, `jawBone`, `emissive: 'Emissive'`, `facing: '+z'`, `bodyPlan`, `durations`, `tags` incl. `startzone`. Spawn: `ctx.world.models.spawn(ctx, 'scrap-goblin', { position, yaw })`, `h.play('attack')`.
Rebuild: `blender --background --factory-startup --python tools\blender-scripts\creatures\run.py -- <id> ...` (one `c_<id>.py` per model + `clib.py`; writes raw GLB, thumbnails and a pose sheet under `.cache/creatures/`), then `node tools\blender-scripts\creatures\register.mjs <id> ...` (finalize -> `public/assets/hero/<id>.glb`, atomic catalogue update from `meta.json`). Thumbnails: `.cache/creatures/previews/<id>.png` (+ `_poses.png`).
Verified: headless Blender renders of rest pose + 6 clip poses each (looked at); every GLB loaded through the real `core/models.js` on both tiers (quest/pc) in headless Chrome with the QA contact-sheet harness on port 92xx: 9 models, 0 console errors (`.cache/creatures/sheets/creatures-names-0{1,2}.png`). NOT verified: playing the clips in the game (only the rest pose was rendered in-game), kit/combat behaviour, Quest performance, how the emissive parts look under the game's lighting (the wisp/firefly glow rely on the game raising emissive intensity), a headset.
Not done (ran out of the session): the bosses from the original list (clockwork titan, lich king, hydra, machine-seraph, void leviathan, crystal golem, swamp witch, giant spider, fire elemental, war boar, mimic, corrupted knight, carnivorous plant). The library (`clib.py`) makes each one a ~60-line script.
