# Omnissiah travel: generated places

"Take me to a volcanic island": the Omnissiah paints a seamless 360 panorama with a local model, reads the sky, fog, sun, ground and
sea colours from it, and switches the whole stage (sky dome, light, fog, terrain character, ground and grass colour, water, dressing,
music mood) under a closing iris of light. `home()` puts the twilight field back exactly as it was.

```
text --> [Z-Image-Turbo, periodic latent canvas] --> 2048x1024 panorama --> analyze.py (seam, poles, palette, sun, ground, sea)
         ~/travel/venv (shares ~/gen3d/env)           + 4096x2048 + 64x32 blur      --> places/<slug>/{pano_2048.jpg,pano_4096.webp,tiny.webp,meta.json}
client:  core/travel.js  --> world.env.setSkyColors / setLight / setFog / setGround / setTerrain / setOcean / setSkyPano ...  (core/world.js)
```

## Files

| File | Role |
|---|---|
| `public/game/core/travel.js` | `world.travel` (go / home / current / list / preload), the iris, rules, dressing, hot-reload resume |
| `public/game/core/world.js` | additions only: terrain character parameters (JS + GLSL twin), `env.setTerrain / setGround / setGrass / setMotes / setStones / setOcean / setLight / setSkyPano / snapshot / restore / batch`, the panorama in the sky shader |
| `server/plugins/travel.js` | plugin: WebSocket `place` -> `place_status` |
| `server/travel/service.js` | `createTravel({ root, send })`: queue, cache by slug, atomic `places/index.json`, lazy WSL worker (same pattern as gen3d.js, port 18780) |
| `server/travel/worker.py`, `start_worker.sh` | WSL HTTP worker (stdlib): FIFO queue, one job at a time, kills the model process after 10 idle minutes |
| `server/travel/pano_runner.py` | text -> periodic panorama (Z-Image-Turbo), optional refine pass |
| `server/travel/analyze.py` | seam check + heal, pole fix, horizon, palette / sun / ground / sea, outputs, re-projected verification sheet (`--views`), `--redo` |
| `server/travel/atlas.json`, `make_atlas.mjs` | the 12 starter destinations (prompt, seed, spec) and the script that builds / refreshes them |
| `public/assets/generated/places/**` | cache: one folder per place + `index.json` |

## Protocol

Client `{ type:'place', id, prompt, options:{ seed?, hi?:'fast'|'refine', slug?, name?, spec?, force? } }` ->
server `{ type:'place_status', id, state:'queued'|'dreaming'|'done'|'error', message, url, hi, preview, meta, progress? }`.
`url` 2048x1024 JPEG (Quest), `hi` 4096x2048 WebP (PC), `preview` 64x32 blurred WebP (placeholder / lighting). `meta` = derived world state
(see below) plus the `spec` and `name`. Same prompt + seed = cache hit (instant `done`). `options.slug` is sanitised to `[a-z0-9-]`.

## From a picture (`options.image`) and for other plugins (`generatePlace`)

* `options.image`: an absolute path under `D:\omnissiah` to a PNG / JPG / WebP (rejected otherwise; the path never leaves the server except as
  a `/mnt/d/...` path to the local worker). The picture is projected as a rectilinear view centred on -Z (what the player sees straight ahead from
  spawn), `options.fov` = its horizontal field of view in degrees (default 80, 30..150), `options.horizonY` = where the horizon sits in the
  picture, 0.1..0.9 from the top (default 0.5). Z-Image then invents the rest around it: the picture's latents are re-injected, noised to the current
  level, at every denoising step everywhere except the cells that must be invented (RePaint style; the cells next to the edge are repainted so the
  model blends the join), with the same periodic latent canvas as text places, so the result wraps seamlessly. The original pixels are pasted back
  with a wide feather afterwards. The prompt (give a description of the scene!) is extended with "the scene of the photograph in the middle of the
  image continues seamlessly all around it with the same light, colours, materials and style". The derived world state is the same as for text
  places and `meta.fromImage = true` (the client then does not swing the panorama to keep the sun away from the Omnissiah: the picture stays in front).
  Slug = prompt + seed + image path / size / mtime. ~90-130 s (cold worker included).
  Known limit (checked on a test picture): the invented surroundings follow the prompt more than the photograph, so a short generic prompt gives a
  plausible but different-looking neighbourhood and a faint "sticker" frame; describe the scene and its light in the prompt.
* `import { generatePlace } from './travel.js'` (server/plugins): `await generatePlace({ prompt, image?, options? })` ->
  `{ slug, url, hi, preview, meta, cached } | null`. Same queue, cache, worker and index as the player's requests; never throws (null = failed or
  refused, the reason is logged). Works before / without the plugin being loaded (it makes its own service on the same files). Then on the game side
  `world.travel.go({ place: slug, dressing: [...] })` (a place already in the cache; if the client's list is stale it is re-read; a place without a spec gets
  a guessed terrain / water / cover from its words and picture; the spec keys given in `go` always win) and `await handle.ready` (resolves with
  `world.travel.current` when the player has arrived, `null` if the journey failed).

## How a panorama is made

* **Model**: Z-Image-Turbo (Tongyi-MAI, Apache-2.0, not gated), the weights already installed for gen3d under `~/gen3d/zimage-turbo-bf16`, read only.
  It was not trained as a panorama model, but "seamless equirectangular 360 degree panorama ... horizon exactly across the middle" works well.
  9 steps, guidance 0, bf16. A bf16 DiT needs ~13 GB; when less than 18 GB of VRAM are free `pano_runner.py` keeps the big linears in float8
  (per-tensor scale, up-cast per call: peak ~8 GB, slightly softer). Encoder and DiT are never on the GPU together or between jobs.
* **Seamless wrap**: Z-Image is a transformer, so there is nothing to give circular padding. The latent canvas is the panorama plus 16 latent columns
  (128 px) on each side, the start noise is periodic, and after every denoising step each pair of columns that must be equal (pad <-> opposite
  edge of the core) is averaged. The model always sees real context on both sides of the seam; the VAE decodes the padded latent and the pad
  is cropped. Measured: mean abs pixel difference across the wrap / median difference of adjacent columns = **0.83 .. 1.45** over the atlas
  (1.0 = indistinguishable from any other column). `analyze.py` would cross-fade a strip if the ratio exceeded 1.6 (never needed). Re-projected
  views straddling the seam and the +-180 degree "back" view were inspected for every place.
* **Poles**: rows above 66 degrees latitude are blurred and blended toward the row mean (nothing pinches). The nadir is hidden by the terrain.
* **4096x2048**: by default a Lanczos 2x + mild unsharp (honest: no new detail). `hi: 'refine'` runs a second Z-Image img2img pass at 4096x2048
  (strength 0.4, same periodic trick): crisper, but ~4 more minutes (see timings). Use it for places you will keep.
* **Not used**: HunyuanWorld 1.0's panorama stage (PanoDiT LoRAs, community licence) sits on top of FLUX.1-dev / FLUX.1-Fill-dev, which are gated
  (login + licence), so it is out under the "no accounts, tokens or gated models" rule; HY-World 2.0's HY-Pano 2.0 is listed as not yet released
  (July 2026 checklist). If you ever accept a login, `pano_runner.py` is the only file to swap.

## What is derived (`meta`, computed in `analyze.py`, colours are sRGB hex from linear averages)

`sky.{zenith,mid,horizon}` (trimmed per-column means of the bands 55-90, 14-38 and -1.5..5.5 degrees), `fog.{color,density}` (horizon band; density from
the contrast of the hazy band), `sun.{dir,elevation,azimuth,color,strength,visible}` (Y^6-weighted centroid of the sky above the horizon, or the
blurred peak when a compact bright disc exists), `ground.{a,b,mid,mean,far}` (k-means of the lower hemisphere, the two most populous clusters
are the ground), `sea` (band -16..-3), `stars` (from the zenith luminance), `horizon_deg` (detected sky/ground edge, clamped to +-1.5 degrees:
the detector was wrong on canopies and mountains), `seam`, `files`, `bytes`. `core/travel.js` turns that into `world.env` calls; the ground albedo
is divided by the irradiance the chosen lights give, so that lit ground ~ the picture's ground.

## Timings and resources (RTX 5090, shared with other agents' jobs)

* Cold worker start 9 s, first job after idle ~45-60 s (loads encoder + DiT), later jobs 37-65 s when the GPU is otherwise idle; 100-450 s observed when
  other generators were running at the same time. Denoise itself: ~11 s for the 2304x1024 padded canvas. `refine`: +220-250 s.
* VRAM peak 12.7 GB (bf16 path, measured), 15.6 GB with the refine pass; idle footprint ~0.2 GB (CUDA context). RAM ~2 GB. Worker unloads after 10 idle min.
* Disk: each place ~0.3-0.6 MB (jpg) + ~0.3-1 MB (webp) + a few KB; the 12-place atlas is a few MB. Environment: `~/travel/venv` (venv with
  `--system-site-packages` of `~/gen3d/env`; only scipy + opencv-python-headless are installed into it) ~0.2 GB. No model files of its own.

## Quest budget

One 2048x1024 texture with mips (~11 MB), freed when you leave; no extra draw calls (the panorama is read by the existing sky dome shader, the
sky still takes the under-horizon early-out, and with a panorama on, the procedural clouds and (at stars 0) the star block are skipped, so the
sky is cheaper than the original); the iris is one transparent sphere visible only during a journey. An ocean uses the existing water shader on a
3200 m quad that follows the player (Quest: the cheap water variant). Dressing is capped at 36 library spawns on the Quest (x0.6 counts), 90 on PC.

## Adding a destination

1. Add `{ slug, name, seed, prompt, spec }` to `atlas.json` (spec fields: see the header of `core/travel.js`; `keywords` drive prompt matching).
2. `D:\omnissiah\tools\node\node.exe D:\omnissiah\server\travel\make_atlas.mjs` (generates what is missing, merges specs into `index.json`).
   `--force slug` regenerates, `--specs-only` only re-merges specs / `meta.json`, `--hi refine` makes 4096 refined panoramas.
3. Verify: `analyze.py --views pano_2048.jpg sheet.png` writes a 7-view contact sheet.

Anything else the player asks for is generated at run time (`go('a candy kingdom')`): palette placeholder at once, sharpened in about a minute.

## Tier B / Tier C

* **Tier B (parallax / solidity): not shipped.** The panorama is only the far backdrop (the near ground is real geometry), and the things in it are
  kilometres away: a few metres of head or body movement shift them by far less than a pixel, so a depth-displaced sphere (Depth Anything V2-Small,
  Apache-2.0; Base/Large are CC-BY-NC) would only add stretch artefacts. HunyuanWorld 1.0-Lite layered meshes need the gated FLUX stack (see above).
  It would pay off only for a place the player can walk through at the scale of the picture.
* **Tier C (Gaussian-splat worlds), research note.** World Labs' Spark (MIT) targets three.js r180 (documented minimum r179, README pins 0.180.0); the game
  is pinned to r170 and several modules patch r170 shader chunks (`style.js`: lights_lambert / phong / physical pars chunks, `world.js` shader includes), so
  the upgrade must be done by the lead as its own task: re-diff those chunks (r171-r180 reworked shadow, light and colour-space code), re-test the XR path
  and the `three/addons` imports (VRButton, XRHandModelFactory, EffectComposer), then add `@sparkjsdev/spark` (Spark 2.x requires creating a `SparkRenderer`
  and adding it to the scene; streaming LoD for big scenes). Memory on Quest: a splat costs ~16-32 bytes per splat in the packed formats, so a 1M-splat
  scene is 16-32 MB plus sorting work every frame on the Adreno GPU: realistic only at 0.3-1M splats, which means heavily decimated scenes. HY-World 2.0
  (Tencent, April 2026) produces meshes and 3DGS from text / images; its checklist (cnb.cool mirror) marks WorldMirror 2.0 (reconstruction) as released
  and the HY-Pano 2.0 + WorldStereo 2.0 generation stages as not yet released, so text -> splat-world is not available locally today. Sketch: panorama ->
  (later) WorldStereo expansion -> WorldMirror 3DGS -> `.spz` -> `SplatMesh` placed at the origin, terrain hidden, `world.travel` unchanged.

## Uninstall

```powershell
wsl.exe -d Ubuntu -- bash -c "rm -rf ~/travel"                 # the venv (the gen3d install is untouched)
Remove-Item -Recurse D:\omnissiah\server\travel, D:\omnissiah\server\plugins\travel.js, D:\omnissiah\public\game\core\travel.js, D:\omnissiah\public\assets\generated\places, D:\omnissiah\.cache\travel
# the world.js additions are inert without travel.js; leave them or revert from .snapshots
```

## Licences worth knowing

Z-Image-Turbo Apache-2.0; scipy BSD, opencv Apache-2.0 / BSD, sharp / three.js MIT. No gated models, no accounts.
