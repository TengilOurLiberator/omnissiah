# Omnissiah blast: one sentence or one picture becomes a place

"Take me to a wizard's cluttered study": the Omnissiah paints the place, looks at it, lifts the separate things out of the picture as real 3D
props, builds a world around the emptied picture, adds sound, and puts you inside it, with the props around you: grab them, throw them, smash them.
A fully local port of [image-blaster](https://github.com/neilsonnn/image-blaster) (MIT, unpacked in `D:\omnissiah\image-blaster`, never run: its skills
call paid FAL / World Labs / ElevenLabs APIs). Nothing here needs an account, an API key or a gated model.

```
words ──► [Z-Image-Turbo] ──► 1344x768 picture (eye level, level horizon, separate props)       ~/gen3d weights, read only        blast worker
or a picture in input\            │
                                  ▼
          one Claude look (api.oracle.ask, Read tool, the player's own account)  ──► image.json  (IMAGE-BLAST schema + game fields)
                                  │   what is in it, where (box, depth), how big (m), what it rests on, what it breaks like, how it sounds
                                  ▼
          [FLUX.2 klein 4B edits]  ONE pass removes the chosen objects ──► clean plate         + one isolation per object (single, complete, white)   blast worker
                                  │  (the plate is checked by comparing it with the picture inside every box; things left in place are removed in a 2nd / 3rd pass)
                                  ▼
          place: generatePlace({ image: plate })  (travel plugin: a 360 panorama around the picture, sky / light / fog / ground read from it)       travel worker
          objects: generateModel({ image: reference })  one at a time (gen3d: TRELLIS.2 -> ~20k-tri GLB)                                            gen3d worker
          layout: every object put on the ray through its box in the picture (camera 1.6 m, 80 degree view), nudged apart, supports respected
          sounds: requestAudio  one ambient loop + one impact sound per material phrase (audio plugin: MOSS-SoundEffect)                             audio worker
                                  ▼
          manifest.json  ─►  public/game/core/blast.js  (world.blast): vision painting while it works, props pop out of it, travel in, re-seat, ambience
```

## Files

| File | Role |
|---|---|
| `server/plugins/blast.js` | plugin: WebSocket `blast`, `blast_get`, `blast_list`, `blast_inputs`; `import { blast } from './blast.js'` for other plugins; wires gen3d / travel / audio lazily |
| `server/blast/service.js` | `createBlast({ root, send, oracle, services })`: the pipeline, projects, resume, cache, budgets, degradation |
| `server/blast/analysis.js` | JSON repair, normalising the survey, choosing the objects, physics numbers, sound prompts (pure) |
| `server/blast/layout.js` | image box + depth band -> position in the place; GLB bounds; scale (pure) |
| `server/blast/prompts.js` | scene wrapper, plate, isolation and empty-place prompts (pure) |
| `server/blast/uncover-prompt.md` | system prompt of the survey: the reference IMAGE-BLAST.md rules, schema and the game fields |
| `server/blast/workerclient.js` | Node side of the WSL worker (lazy start, reuse, restart once, idle stop) |
| `server/blast/worker.py`, `edit_runner.py`, `t2i_runner.py`, `start_worker.sh` | WSL worker on 127.0.0.1:18785 and its two model processes |
| `server/blast/imgtools.js` | sharp helpers: removal check, crops, white-background check, thumbnails (all optional) |
| `server/blast/cli.mjs` | blast from PowerShell |
| `server/blast/setup_env.sh`, `probe_env.sh` | installer / probe of `~/blast` |
| `server/blast/test_blast.mjs` | tests (stubbed services, no GPU) |
| `server/blast/harness/` | headless-Edge render harness of the client (real boot.js, real core modules, fake net) |
| `server/blast/lab.mjs`, `evalset.mjs`, `sheet.mjs` | the prompt lab used for the evaluation below |
| `public/game/core/blast.js` | `world.blast` (its header is the AI-facing documentation) |
| `public/assets/generated/blasts/<slug>/` | projects (below) and `index.json`, the cache listing |
| `input/` | where the player drops pictures |

## Project folder (mirrors the reference `worlds/<slug>/`; resumable)

```
blasts/<slug>/
  project.json            options, seeds, timings per stage, warnings, status
  image.json              the survey (reference flat schema + setting, ground_type, backdrop, terrain_hint, music_mood, horizon_y, view_problems, objects[])
  source/0-<slug>.png     the scene picture (generated, or the player's, copied)          source/0-<slug>.json  the same survey, per image
  source/1-<slug>-plate.png   the clean plate
  output/<object>/object.json  reference.png  model.glb  impact.ogg
  output/world/place.json     the travel place (slug in public/assets/generated/places)
  output/sfx/ambient.ogg  sounds.json
  thumb.jpg  status.jsonl (every status message, for replay)  manifest.json (what the game loads)
```
The slug is `<words>-<hash>` of the normalised prompt + seed (or of the picture's bytes): the same wish answers from the cache at once. A re-run skips every stage whose
file exists. `options.force: true` starts over. A failed object is skipped, a failed stage degrades (no plate: the place is built from the picture; no place: the props
stand in the current world; no audio: silent; no survey: place only; no image worker: no blast).

## Protocol

Client `{ type:'blast', id, prompt | image, options:{ maxObjects (8, cap 14), seed, budgetMs (12 min), force, fantasy } }` (`image` = a file in `D:\omnissiah\input`
or a path inside the game folder: checked for location, extension, size <= 25 MB and magic bytes), `{ type:'blast_get', id | slug }` (replays the progress to a late or reloaded
client), `{ type:'blast_list' }`, `{ type:'blast_inputs' }`.
Server `{ type:'blast_status', id, slug, stage:'queued'|'image'|'uncover'|'plate'|'place'|'objects'|'layout'|'sounds'|'done', state:'running'|'done'|'skipped'|'error', message, progress:{done,total}, result }`.
`result`: stage `image` done = `{ slug, image, thumb, aspect, fov }` (the picture exists: the vision appears); `objects` = `{ object: { id, name, url, from:{box,depth}, position, yaw, scale, dims, mass, ... } }`
per finished object; `layout` done = the manifest (sounds still pending: the player can step in), `done` = the final manifest with the sounds.
Server side: `import { blast } from './plugins/blast.js'; await blast({ prompt, image, options })` -> manifest | null (never throws).

## What is installed where

* WSL `~/blast/venv`: a venv with `--system-site-packages` of `~/gen3d/env` (torch 2.7.1+cu128, diffusers 0.41, transformers 5.19; read only) + scipy. ~0.15 GB.
* WSL `~/blast/klein4b`: FLUX.2 [klein] 4B (Black Forest Labs), **Apache-2.0, not gated**: transformer 7.75 GB, Qwen3 text encoder 8 GB, VAE 0.17 GB (bf16): 15 GB.
* Z-Image-Turbo (Apache-2.0) is **not** copied: `t2i_runner.py` reads `~/gen3d/zimage-turbo-bf16` read-only.
* `/opt/trellis`, `~/gen3d`, `~/voice`, `~/audio`, `~/rig`, `~/travel` are untouched. Windows side: only the files listed above, `.cache\blast\` (logs, work files), `input\`.

## Edit model: choice and evaluation

Candidates (official pages checked): **FLUX.2 [klein] 4B** (Apache-2.0, ungated, ~13 GB VRAM, diffusers `Flux2KleinPipeline`, text-to-image + single/multi-reference edit, 4 steps,
distilled) and **Qwen-Image-Edit(-2509)** (Apache-2.0, 20B DiT + a 7B Qwen2.5-VL encoder: ~57 GB of bf16 weights, `QwenImageEditPlusPipeline`, 40 steps, true-CFG).
klein was installed first and measured on both jobs on six scenes (study, tavern, forest camp, sci-fi lab, market street, cave with treasure; 41 edits). It met the bar, so the
57 GB Qwen download (and a quantised build that would have to fight the 20 GB WSL RAM cap while three other generators run) was not started: see "Honest verdict".

**Object isolation** (`prompts.js: isolatePrompt`): the reference 3D skill's wording ("Isolate the <target> from this image. Reproduce it exactly as shown ... centered ... white background ...
one single object") + where it stands in words made from the box (never the model's free text, which may name other objects) + "the same stylised painted game-art look, not a photograph"
(without that sentence the look drifted to photo-real: leather, bone) + "including parts hidden behind other things" (occluded parts are completed). 36 of 36 isolations in the six
scenes that I inspected (21 of the evaluation set, 23 in the three showcases) showed exactly the named object, whole, centred, on pure white, in the painted look; only wrongly boxed things
(a "clay pot" given iron hoops) were interpretations. A check (`whiteStats`: border white, content area) re-rolls an isolation once, from a crop of the object's box, when it fails.
**Clean plate** (`platePrompt`): the reference's removal-only rule in one pass: "Remove the A, B and C, and everything standing or lying on them. Show the empty <ground> and the bare <backdrop>
behind them. Keep everything else exactly as it is ..." Short noun phrases worked, long descriptions of several similar things made klein add look-alikes. A single pass removed
everything in tavern, camp, lab and study(v1); in market and cave it left some objects, and in some seeds the biggest furniture. Hence the check: the plate is compared with the picture inside
every object's box (`imgtools.boxChange`, mean absolute RGB difference; untouched boxes read 2-3, removed ones 13+): boxes under 12 are "left in place" and a second pass on the
plate names only those (a third for the stubborn ones). On the study the second pass removed desk, cabinet and globe that pass one left; tavern's barrel the same.
Timings, RTX 5090 shared with other jobs: cold start 9 s, text encoder load + encode 8-32 s, DiT load 8-10 s, then **2.5-3 s per edit** (all edits of a stage are ONE batch: both big models load once);
VRAM peak **9.8-10 GB** (text encoder, then DiT; never both), RAM peak 8 GB while loading. Z-Image scene picture: 14 GB peak, 17-35 s warm (more when the GPU is busy).

## Measured: full blasts (RTX 5090 shared with other agents' generators; WSL 20 GB cap; `project.json` -> `timings`)

| Showcase (cache slug) | total | image | survey | plate + refs | place | objects | sounds |
|---|---|---|---|---|---|---|---|
| a wizard's cluttered tower study at night (`a-wizard-s-cluttered-tower-stu-9dd9bf`), 8 objects | 1025 s | 166 s (2 pictures: the first had a person) | 93 s (2 calls) | 122 s | 183 s | 376 s | 82 s |
| an abandoned greenhouse overgrown with glowing plants (`an-abandoned-greenhouse-overgr-accbd6`), 7 objects | 695 s | 53 s | 35 s | 68 s | 35 s | 406 s | 98 s |

| a goblin market in a canyon at dusk, wooden stalls with crates, barrels, clay jars and hanging lanterns (`a-goblin-market-in-a-canyon-at-10d17c`), 8 objects | 566 s | 53 s | 43 s | 70 s | 43 s | 274 s | 81 s |

(The pre-blasted showcases are in the cache: `world.blast.open('<slug>')` is instant. A first attempt with the bare words "a goblin market in a canyon at dusk" gave an empty canyon with three tiny figures and nothing to lift:
describe the things you want, as the header of `core/blast.js` tells the Omnissiah to.)

The objects stage is the long one and mostly waits in gen3d's single FIFO queue (other generators were using TRELLIS: 13-190 s per object, ~50 s when the worker is yours alone);
the place took 35 s warm and up to 180 s when the GPU was busy. A blast on an otherwise idle machine should be ~6-9 minutes; the default budget is 12 minutes (the objects stage
stops starting new objects when only the time for layout and sounds is left; the place is made BEFORE the objects so that it is never what gets cut). Cached: instant. Resumed project: seconds.
Peaks (own torch peaks reported by the runners): Z-Image 14.0 GB, klein 9.8 GB, never together; whole-system maxima sampled during the afternoon (all generators together): GPU 27.4 GB of 32, WSL 19.9 GB of 20 with 11 GB of swap in use.

## Known limits (honest)

* The plate is the weakest step: in a busy wide picture with small things klein sometimes keeps an object, or swaps it for a look-alike (showcase 1: a pedestal became a barrel, a chair stayed;
  greenhouse: one block figure stayed). The box check catches "left in place" (up to 3 passes), not "replaced by a look-alike". Objects stand where the plate (mostly) emptied them, so a leftover reads as a duplicate.
* The place is the travel panorama built around the plate: the picture is visible straight ahead (a faint rectangular frame can remain), the rest is invented from the prompt; no parallax, flat ground (the
  terrain preset is forced flat unless the survey says rolling / hills, grass only on grass ground). Things are 4-9 m away (distances are pulled in to 60 % of the picture's) and keep the picture's bearings.
* Z-Image-Turbo has no negative prompt: pictures sometimes contain a person or look down from above (the survey reports it and the picture is dreamed again, up to twice); vague prompts give sparse scenes.
* Time is dominated by queues in gen3d (one FIFO for everyone) and by a busy GPU; on an idle machine expect ~6-9 minutes.
* The Qwen-Image-Edit alternative was not measured (57 GB, would not fit the shared RAM cap); the choice rests on klein's measured results.

## Differences from the original image-blaster

* **A panorama place instead of a Marble Gaussian-splat world.** The environment is the travel pipeline's 360 panorama built around the clean plate (the plate is the view straight ahead),
  with the game's terrain, light, fog and ground colours read from it. You cannot walk far into the picture and there is no parallax in the backdrop; the props are real geometry on real ground.
* **3D**: TRELLIS.2 through gen3d (about 20k triangles, one texture, Y up, base at 0) instead of Hunyuan 3D; objects are scaled to their surveyed real size (not user-placed in an editor).
* **Sound**: MOSS-SoundEffect through the audio plugin: one 20 s ambient loop + one impact per distinct material phrase (cap 8); no ffmpeg post-processing step here, the audio worker
  already trims, fades and normalises.
* **No confirmation step**: objects are chosen automatically (distinct, complete, mid-ground, grab-or-break-worthy, supports first; up to 8, cap 14; `count_estimate` becomes instanced copies, cap 4).
* **One look instead of a conversation**: the survey is one `api.oracle.ask` call (plus one retry only for invalid JSON, plus one re-dream of the picture when the survey finds it flawed), spending the player's own Claude usage.
* **Physics and play**: every object is a `kit.body` (Rapier box collider fitted to the model) with `kit.destructible` of its material, its own impact sound, and a mass from its size and material.

## Run it

```powershell
# one blast, no game server needed (starts the WSL workers it needs; first run of the day loads models: add ~2 minutes)
D:\omnissiah\tools\node\node.exe D:\omnissiah\server\blast\cli.mjs "a goblin market in a canyon at dusk, stalls, crates, barrels, lanterns"
D:\omnissiah\tools\node\node.exe D:\omnissiah\server\blast\cli.mjs --image castle.png --max 6 --budget 20      # castle.png in D:\omnissiah\input
```
In the game: "take me to a wizard's cluttered study" (the Omnissiah calls `world.blast.create(...)`), or `blast the picture castle.png`. Pictures go into `D:\omnissiah\input\`
(PNG / JPG / WebP, <= 25 MB; best: one coherent place at eye level with a few distinct things in the middle distance). `world.blast.list()` lists the cache; `world.blast.open(slug)` is instant.
By hand: `wsl.exe -d Ubuntu -- bash /mnt/d/omnissiah/server/blast/start_worker.sh --port 18785` (Node then reuses it), `Invoke-RestMethod http://127.0.0.1:18785/health`. Logs: `.cache\blast\worker.log`, `t2i.log`, `edit.log`.

## Resources

* GPU: nothing stays resident between jobs except CUDA contexts; the worker unloads both models when a blast leaves the edit stage (so TRELLIS gets the memory) and after 7 idle minutes; Node stops the
  worker after 15 idle minutes. Peaks: Z-Image 14 GB, klein 10 GB (never together; the worker kills the other runner first).
* RAM: WSL is capped at 20 GB. The blast worker's runners peak at ~8 GB while loading weights; TRELLIS (gen3d) holds 11-16 GB. Run a blast while gen3d is idle for the best times;
  with other generators running everything slows down (swap).
* Disk: ~15 GB for klein, ~2-4 MB per project (+ models ~1 MB each).

## Tests

```powershell
D:\omnissiah\tools\node\node.exe --test D:\omnissiah\server\blast\test_blast.mjs            # pure parts + the pipeline against stubs (stage order, resume, cache, JSON retry, budgets, degradation, path validation)
D:\omnissiah\tools\node\node.exe D:\omnissiah\server\blast\harness\run.mjs <slug> arrive      # headless Edge: real boot.js + real core modules, fake net replaying the project's statuses; frames in .cache\blast\harness\
```

## Uninstall

```powershell
wsl.exe -d Ubuntu -- bash -c "rm -rf ~/blast"                                   # venv + klein (15 GB); nothing else of the other agents is touched
Remove-Item -Recurse D:\omnissiah\server\blast, D:\omnissiah\server\plugins\blast.js, D:\omnissiah\public\game\core\blast.js, D:\omnissiah\public\assets\generated\blasts, D:\omnissiah\.cache\blast
# and the "core/blast.js" line in public\game\manifest.json; D:\omnissiah\input may stay
```

## Licences

FLUX.2 [klein] 4B Apache-2.0; Z-Image-Turbo Apache-2.0; TRELLIS.2 MIT (its background remover briaai/RMBG-2.0 is CC BY-NC 4.0, as noted in gen3d's README); MOSS-SoundEffect Apache-2.0;
sharp Apache-2.0; image-blaster (reference only) MIT.
