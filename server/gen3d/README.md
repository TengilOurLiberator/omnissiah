# Omnissiah gen3d: local text -> 3D

Turns a wish ("a purple dragon") into a game-ready `.glb` in about 40 s (warm) on the local RTX 5090, for free:

```
wish --> [Z-Image-Turbo, text->image] --> 1024 px picture --> [TRELLIS.2-4B, image->3D] --> decimate + bake --> .glb
         (~/gen3d/env, Apache-2.0)                            (/opt/trellis, existing env)     (bake.py)
```

Game protocol: client `{type:'gen3d', id, prompt, options:{quality:'low'|'standard'|'high', seed?, image?, animate?}}` ->
server `{type:'gen3d_status', id, state:'queued'|'imagining'|'sculpting'|'done'|'error', message, url, progress?}`.
Results are cached in `public/assets/generated/<slug>.glb` + `index.json` (`{slug:{prompt,url,created,quality,triangles,bytes,...}}`);
asking again for the same prompt+quality answers `done` immediately. `exporting` inside the worker is reported as `sculpting`
("Baking a game-ready model").

## Image input and the plugin API (server side)

`options.image` = absolute path (it must be inside `D:\omnissiah`) of a PNG / JPG / WEBP showing ONE object on a plain background. The
text-to-image stage is skipped, the picture goes straight to TRELLIS.2 (which removes the background itself); decimation, texture,
normalisation and output are identical to a text job. The prompt becomes optional (a label, and what `animate: 'auto'` looks at). The cache key is
`sha1(image bytes) + quality + seed` (slug `<prompt words>-<8 hex>`), index.json gets `from_image: true, image_hash`. Works from the WebSocket message
too, but it is meant for server plugins:

```js
import { generateModel } from '../gen3d.js';          // from server/plugins/<name>.js
const r = await generateModel({ prompt: 'a cut-out lamp', image: 'D:\\omnissiah\\.cache\\blast\\cut1.png',
                                options: { quality: 'standard', animate: false, onStatus: (m) => {} } });
// -> { url: '/assets/generated/a-cut-out-lamp-1a2b3c4d.glb', slug, meta: <index.json entry> }   or null on any failure; never throws
```

`generateModel` uses the same instance as `createGen3d` (one queue, one cache, one WSL worker; `createGen3d` now returns the existing instance for a
root, so index.js and plugins share it). The browser does not see plugin requests (`gen3d_status` for them goes only to `onStatus`). Bad input (path outside
the game folder, not a picture, missing file) gives `null`. Check: `node server\gen3d\test_generate_model.mjs <image> low`. A real image job was run
(`test.mjs "..." low --image x.png`): 307 s on a busy machine, no imagining stage.

## Files

| File | Role |
|---|---|
| `server/gen3d.js` | Node module `createGen3d({root, send})`; started lazily by `server/index.js`; talks HTTP to the worker on 127.0.0.1 |
| `worker.py` | stdlib HTTP service in WSL: FIFO queue, one job at a time, owns the two runners, unloads them after 10 idle minutes |
| `t2i_runner.py` | text->image, own env `~/gen3d/env`; holds the prompt template |
| `trellis_runner.py` | image->GLB, existing env `/opt/trellis/mamba/envs/trellis2` |
| `bake.py` | fork of `o_voxel.postprocess.to_glb` (normalised colour sampling, no dark blotches) |
| `render_glb.py` | verification: turntable contact sheet of GLBs (nvdiffrast) |
| `start_worker.sh`, `test.mjs` (`--image`, `--animate`), `setup_t2i_env.sh`, `dl_zimage.sh`, `convert_bf16.py` | launcher, CLI test, install/convert scripts |

## Rigged / animated models (EXPERIMENTAL, opt-in: `options.animate: true`)

**Status: working for several creatures, not finished, OFF by default.** Nothing in the normal text/image -> model path touches it: only a request with
`options.animate === true` (or the maintenance value `'redo'`) reaches the rig stage; `false`, missing and the old `'auto'` all give the plain static model.
If rigging fails, times out or finds nothing to move, the static model is delivered anyway with the status `Done (static: <reason>)`.

What it does: UniRig (skeleton + skin weights) on the finished mesh -> clean-up (<= 36 bones, smoothed, <= 4 influences) -> body-plan analysis -> baked
procedural clips -> skinned GLB (stock GLTFLoader, no extensions). Cache layout: `<slug>.glb` is ALWAYS the static model (index `url`); the rigged twin is
`<slug>.rigged.glb` (index `rigged_url`, plus `rigged, bodyPlan, humanoid, clips, height, size, speeds, headBone, mouthBone, mouth, bones, limbs, counts, events`).
`animate:true` on a cached static prompt rigs the existing mesh (no regeneration); a request with `animate` omitted always gets the static file.
Status messages (state `sculpting`): "Finding its bones", "Teaching it to walk". Budget: 360 s for the added rigging time, else static.

| File | Role |
|---|---|
| `rig_runner.py` | JSON-lines runner (rig env `~/rig/env`), started lazily by worker.py only for animate jobs; validates its output |
| `unirig_engine.py` | in-process UniRig without Blender (own voxelisation, `shim/flash_attn` stand-in, SDPA instead of flash attention) |
| `rigkit/` | numpy toolkit: `skeleton.py` clean-up, `analysis.py` body plan, `gait.py` clips, `pose.py` FK/IK, `glb.py` writer, `lbs.py` + `validate.py` independent checks, `geomrig.py` geometric rigger (experimental), `viz.py` PIL renders |
| `render_sheet.mjs` + `viewer/sheet.html` | contact sheets of rigged GLBs through three.js in headless Edge (random high port) |
| `test_models_node.mjs`, `test_creatures.mjs`, `test_pipeline_check.mjs`, `test_generate_model.mjs` | headless models.js test (+H5), end-to-end creatures, real-job check, plugin API check |
| `setup_rig_env.sh` | installs the env (see below) |

Install (WSL, `~/rig`, nothing else touched): micromamba Python 3.11 env 8.9 GB (torch 2.7.1+cu128, spconv-cu126 2.3.8, torch_scatter/torch_cluster from the PyG
cu128 wheels, transformers 4.51.3, numpy 1.26.4, trimesh; `bpy` 4.2 is installed but NOT usable/needed: it wants libSM and the pipeline avoids Blender), UniRig repo 46 MB
(`~/rig/UniRig`, MIT), checkpoints 5.5 GB in `~/rig/hf` (HF `VAST-AI/UniRig`: skeleton 1.4 GB, skin 4.4 GB; model card says MIT; the training data
Articulation-XL2.0 / Objaverse licences were not audited). spconv runs on the RTX 5090 (sm_120) without a rebuild. `~/rig/HY-Motion-1.0` (40 MB repo clone only,
no weights) was cloned for evaluation and is unused.

Body plans: biped (humanoid when it has arms), quadruped, multileg (6, 8, ...), winged, serpent, floating, blob, vehicle, plant (plant stays static unless forced). Clips: idle
walk run attack attack-2 hit die everywhere (plants: idle/wind/hit/die); legged ones jump taunt; winged fly hover; people wave cheer dance bow. Legs are 2-bone/FABRIK IK on
planted feet (biped alternating, quadruped lateral-sequence walk / diagonal trot, tripod gait for 6, ripple wave for 8), foot-slide measured numerically (0.05-0.11 of body
speed on the knight/golem); tails/spines/wings/serpent waves are phase-lagged sines; loops are exactly closed. Metadata `speeds.walk|run` (model units/s) lets models.js match
kit's playback to ground speed.

Measured (RTX 5090 shared with other agents; times vary a lot with contention): UniRig skeleton 2-20 s + skin 1-5 s warm, model load ~15 s warm / 2-3 min cold,
clip generation + write + validation < 2 s, VRAM peak 5.3 GB (UniRig only), runner RAM ~5 GB while loaded. Whole upgrade of a cached mesh: 20-105 s; text -> rigged
creature 190-570 s on the busy machine (about 25-70 s of it rigging).

Verdicts from renders (three.js in Edge, `.cache/gen3d/rigwork/*.png`): knight - good (clean skeleton with fingers, convincing walk/run, attack, wave, die); golem - good;
dragon (winged biped) - plausible, wings flap, hind legs walk; six-legged crystal beast (4 legs in reality) - walks, head/neck bend in attack tears the mesh a bit;
spider - 7 of 8 legs found, walks; snake (coiled pose) - alive but the coil deforms oddly; owl - legs too short so it hops, no wing bones (folded wings are not separate);
grey wolf - FAILED: the generated mesh is a diagonal 3/4 pose with overlapping paws and UniRig returned an unusable skeleton (7-bone blob), so it was un-rigged.
Goblin and jellyfish were never rigged (their generation was killed by memory pressure). HY-Motion / any text-to-motion model: not done (below).

HY-Motion 1.0: NOT installed. Its licence (Tencent HY-MOTION community licence) does not apply in the EU, UK and South Korea and forbids use of outputs there; this PC reports
CEST, so it is probably unusable here, and it needs 24-26 GB VRAM (the GPU is shared). People get a small procedural repertoire instead (wave cheer dance bow taunt jump).
MoMask / T2M-GPT (HumanML3D-trained) were not evaluated.

Known gaps / what is left: classification depends on UniRig's skeleton being symmetric and sane (3/4-view meshes break it; `geomrig.py` + the foot-count gate in
`pipeline.rig_gated` is an unfinished attempt that only triggers when the feet disagree with the skeleton and could not rescue the wolf); no wing detection for folded wings;
kit.js uses its own gait constants (models.js compensates, see its header); `animate:'auto'` (`looksAlive` in gen3d.js) is disabled; the horse / goblin / jellyfish set of the
brief was not completed. Resume: `node server\gen3d\test_creatures.mjs out.json "<prompt>" --animate true` (or `redo` for a cached one),
`node --import ./server/gen3d/register_hooks.mjs server/gen3d/test_models_node.mjs` for the game-side check, `node server\gen3d\render_sheet.mjs out.png x.rigged.glb --clips walk,idle`.
Uninstall the rig part: delete the WSL folder `~/rig` (about 14.5 GB) and the `*.rigged.glb` files (index fields are then ignored).

## What was installed (all inside WSL `Ubuntu`, nothing in `/opt/trellis` was modified)

* `~/gen3d/env`: micromamba Python 3.12, torch 2.7.1+cu128 (same torch/CUDA as trellis2; Blackwell sm_120 works), diffusers 0.41, transformers 5.19. ~6 GB.
* `~/gen3d/zimage-turbo-bf16`: Tongyi-MAI/Z-Image-Turbo (Apache-2.0, not gated), re-saved as bf16: 12 GB DiT + 7.5 GB Qwen3 text encoder. ~20 GB.
  (FLUX.1-schnell is `gated: auto`, i.e. needs a login, so it was not used.)
* `~/gen3d/mamba`: micromamba root used to create the env.
* `~/.flex_gemm/autotune_cache.json`: written by TRELLIS itself; first runs of new mesh sizes are slower until it fills.
* Total ~27 GB. Windows side: only files under `D:\omnissiah\server\gen3d\`, `server\gen3d.js`, `public\assets\generated\`, `.cache\gen3d\` (logs, `jobs\` intermediates).

## Test a generation (PowerShell, game server not needed)

```powershell
D:\omnissiah\tools\node\node.exe D:\omnissiah\server\gen3d\test.mjs "a wooden treasure chest" "a stone well" standard
# quality is one of low | standard | high (applies to all prompts of the call)
```

It starts the WSL worker, prints the same `gen3d_status` messages a game client would see, copies the GLB to
`public\assets\generated\` and stops the worker. To run the worker by hand instead (then Node re-uses it on port 18765):

```powershell
wsl.exe -d Ubuntu -- bash /mnt/d/omnissiah/server/gen3d/start_worker.sh --port 18765
Invoke-RestMethod -Method Post http://127.0.0.1:18765/generate -ContentType application/json -Body '{"prompt":"a lantern","quality":"low"}'
Invoke-RestMethod http://127.0.0.1:18765/jobs/<job>      # state, progress, glb_path, image_path, stats
Invoke-RestMethod http://127.0.0.1:18765/health
Invoke-RestMethod -Method Post http://127.0.0.1:18765/shutdown -Body '{}' -ContentType application/json
```

Logs: `D:\omnissiah\.cache\gen3d\worker.log`, `t2i.log`, `trellis.log`, `worker.stdout.log`. Per-job intermediates
(`image.png`, `cutout.png`, `model.glb`, `stats.json`) in `.cache\gen3d\jobs\<job>\` (safe to delete).

Render a check sheet of GLBs:
`wsl -d Ubuntu -- bash -c "export LD_LIBRARY_PATH=/opt/trellis/mamba/envs/trellis2/targets/x86_64-linux/lib:/opt/trellis/mamba/envs/trellis2/lib:/usr/lib/wsl/lib; /opt/trellis/mamba/envs/trellis2/bin/python /mnt/d/omnissiah/server/gen3d/render_glb.py out.png a.glb b.glb"`

## Output format

Plain glTF 2.0 binary, one mesh, one material, loads with stock three.js `GLTFLoader` (no Draco/meshopt/KTX2/WebP).
Y up, centred in X/Z, base at y = 0, longest side = 1 unit, front faces +Z. Base colour is a JPEG; metallic/roughness are
constants (no extra texture). Presets: low ~6k tris / 512 px, standard ~20k / 1024 px, high ~60k / 2048 px
(sizes ~0.3 / ~0.9 / ~2 MB).

## Resources

* VRAM: nothing stays on the GPU between jobs except CUDA contexts (~2 GB with both runners alive). Peak per stage: text encoder ~9 GB,
  image DiT ~14 GB, TRELLIS sculpt 3-6 GB, bake 1-7 GB. Highest whole-GPU reading during testing: ~16 GB (incl. desktop).
* RAM is the tight resource: WSL is capped at 20 GB (`.wslconfig`, not touched). TRELLIS keeps ~11-14 GB of weights in RAM
  (only the models of the pipeline in use; the `high` tier swaps in the 1024 models, ~10 s), t2i ~2 GB.
* Idle for 10 min: worker kills both runners (RAM + VRAM freed). Node stops the worker after 30 idle minutes.
* Environment variables: `GEN3D_DISTRO` (default `Ubuntu`), `GEN3D_T2I_KEEP_WARM=1` (keep t2i weights on GPU, +20 GB VRAM, saves ~10 s/job).

## Typical timings (RTX 5090)

Cold (first job after idle): ~110-150 s (t2i 20-30 s, TRELLIS load ~60 s, then the job). Warm standard: ~40 s total
(imagine ~15-20 s of which ~10 s is streaming the weights to the GPU, sculpt 10-20 s, bake 4-6 s). Low ~33 s, high ~70 s.
Times vary when WSL starts swapping (do not run big things in WSL at the same time).

## Uninstall

```powershell
wsl.exe -d Ubuntu -- bash -c "rm -rf ~/gen3d ~/.flex_gemm"      # removes the t2i env + model (~27 GB); TRELLIS in /opt/trellis stays
Remove-Item -Recurse D:\omnissiah\server\gen3d, D:\omnissiah\server\gen3d.js, D:\omnissiah\.cache\gen3d
# and remove the three gen3d lines/case in server\index.js
```

## Licences worth knowing

Z-Image-Turbo Apache-2.0; TRELLIS.2 MIT; the background remover TRELLIS uses (briaai/RMBG-2.0) is CC BY-NC 4.0 (non-commercial).
