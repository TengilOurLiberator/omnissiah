# Omnissiah audio: generated sound effects, ambience and music

Everything the game plays that is not synthesised on the fly comes from two local models, for free, on the RTX 5090:

```
text --> [MOSS-SoundEffect v2.0, Apache-2.0]  --> one-shots, creature voices, ambience beds   (mono / stereo beds, 48 kHz)
text --> [ACE-Step 1.5 turbo,  MIT]           --> music loops and stingers                     (stereo, 48 kHz)
              |
              +--> post.py: trim, fades, loudness, seamless loop, Ogg/Opus --> objective checks --> best-of-N by CLAP similarity
```

Game protocol (docs/CONTRACT.md v4): client `{type:'sfx'|'music', id, prompt, seconds?, loop?}` -> server `{type:'audio_status', id, kind,
state:'queued'|'generating'|'done'|'error', url, message}`. Cache: `public/assets/generated/audio/{sfx,music}/<slug>.ogg` + `index.json`
per kind (`{slug:{prompt,url,seconds,kind,loop,created,bytes,duration}}`). The starter pack lives in `public/assets/generated/audio/pack/` with
the manifest `public/assets/generated/audio/pack.json` (`{name:{url,variants[],volume,kind,durations[],bpm?}}`, kind = oneshot | loop | music | stinger).

## Calling from another server plugin

```js
import { requestAudio } from '../audio/client.js';        // also exported by server/plugins/audio.js
const r = await requestAudio({ kind: 'sfx', prompt: 'a heavy stone door grinding open', seconds: 3 });          // -> { url, slug } | null
const m = await requestAudio({ kind: 'music', prompt: 'slow ominous cave theme, instrumental', seconds: 60, loop: true });
// r.url = '/assets/generated/audio/sfx/<slug>.ogg'  (served by the normal static handler; the client plays it with world.audio.sfx / music)
```

Same cache, same `index.json` and same WSL worker as the game protocol: a known prompt (same text, seconds, loop) answers at once, a new one takes
3-10 s warm (about a minute when the worker has to start and load the models) and is then cached for good. `kind:'sfx'` defaults to a 2 s one-shot (`loop:true` = seamless
stereo ambience bed, 6-30 s); `kind:'music'` defaults to a 60 s seamless loop (`loop:false` = a stinger of `seconds`). The promise resolves `null` on any failure
(worker or WSL missing, the model returning silence, timeout) and never rejects, so callers just fall back. Inside the server the plugin loader has already installed
the shared service; outside it (a script) the function creates its own.

## Files

| File | Role |
|---|---|
| `server/plugins/audio.js` | server plugin: handles the `sfx` / `music` messages, never throws into the server |
| `client.js` | `requestAudio({kind,prompt,seconds,loop}) -> {url,slug} \| null` for other server plugins |
| `service.js` | Node module `createAudio({root, send})`: cache + slugs + atomic index.json + lazy WSL worker (readiness probe, restart once, timeouts, shutdown) |
| `worker.py` | stdlib HTTP service in WSL (127.0.0.1:18775): FIFO queue, one job at a time, owns two runners, post-processing, checks, best-of-N |
| `sfx_runner.py`, `music_runner.py` | the two model processes (own Python envs), JSON lines on stdin/stdout |
| `post.py` | trim / fade / loudness / loop / Ogg-Opus encode (numpy, scipy, pyloudnorm, PyAV) and the objective analysis |
| `clap_score.py` | CLAP text-audio similarity used to pick the best take ("listen-by-proxy") |
| `pack_spec.mjs`, `make_pack.mjs` | the starter pack: names, prompts, variants, volumes; the generator |
| `pack_report.json` | per-file stats of the generated pack (duration, loudness, centroid, CLAP, warnings, timings) |
| `test_core.mjs`, `test_plugin.mjs`, `browser_test.mjs`/`.html`, `test_post.py`, `clap_check.py`, `lab.mjs`, `wtest.ps1` | tests and prompt-lab helpers |
| `setup_moss_env.sh`, `setup_ace_env.sh`, `start_worker.sh` | installers / launcher |
| `public/game/core/audio.js` | `world.audio` in the game (its header is the AI-facing documentation) |
| `public/game/core/ambience.js` | procedural wind/drone, now crossfading under recorded beds chosen by the surroundings |

## What was installed (inside WSL `Ubuntu`; `/opt/trellis`, `~/gen3d`, `~/voice`, `~/travel` were not touched)

* `~/audio/moss` micromamba Python 3.12, torch 2.9.0+cu128 (Blackwell sm_120 works), transformers 4.57, diffusers 0.37, PyAV, pyloudnorm. ~8 GB.
* `~/audio/ace` Python 3.12, torch 2.10.0+cu128, transformers 4.5x, no gradio / vllm. ~8 GB.
* `~/audio/hf`: MOSS-SoundEffect-v2.0 weights (DiT 1.3B + DAC VAE + Qwen3 text encoder), ~11 GB (fp32 on disk, bf16 in memory).
* `~/audio/src/ACE-Step-1.5` (source + `checkpoints/`: turbo DiT 4.5 GB, VAE, text encoder 1.2 GB; the 5Hz language model is not used) and
  `~/audio/src/MOSS-TTS` (source). `~/audio/hfhome`: CLAP (laion/clap-htsat-unfused, ~0.6 GB) and the transformers module cache.
* Windows side: files under `server/audio/`, `server/plugins/audio.js`, `public/assets/generated/audio/`, `.cache/audio/` (logs, `jobs/` intermediates).

No account, token or gated download was needed.

## Model choice (checked against the official repositories / model cards)

| Model | Licence | Verdict |
|---|---|---|
| **MOSS-SoundEffect v2.0** (OpenMOSS-Team, DiT 1.3B, flow matching, 48 kHz, up to 30 s) | Apache-2.0 (model card + repo) | **chosen** for sound effects and ambience: open, ungated, good variety, ~3 s per short clip warm |
| **ACE-Step 1.5** (ACE Studio + StepFun; turbo DiT, 8 steps) | MIT (repo + model card, outputs usable commercially) | **chosen** for music: 30 s of stereo music in ~1.2 s, < 8 GB VRAM peak without the LM |
| Stable Audio Open 1.0 | Stability Community Licence, **gated** (login + accepting terms) | skipped (needs an account) |
| TangoFlux | non-commercial research only; builds on Stability weights | skipped (licence), no quality advantage that justified it |
| Sony Woosh (DFlow distilled) | code MIT/Apache, **weights CC-BY-NC 4.0**, outputs inherit it | not installed: MOSS was good enough, so the non-commercial weights were never needed. Could be added later for a private build if its sound effects prove clearly better. |
| CLAP laion/clap-htsat-unfused | Apache-2.0 | used only as a judge (text/audio similarity), never to generate |

MOSS facts that shaped the pipeline: the pipeline always denoises a fixed window and crops it, so time does not depend on the requested length
but on the window; the worker uses a window of `seconds + 4 s` (min 6 s) for one-shots: ~3 s per take at 50 steps instead of ~21 s with the default 30 s window.
Some takes come back silent (peak < -70 dB) and many "single sound" prompts return several hits; the worker detects both and re-rolls.

## Resources and timings (RTX 5090, GPU shared with other agents' jobs while measuring)

See "Measured" below.

## Post-processing (every file)

* One-shots: DC removal, 22 Hz high-pass, trim leading/trailing silence (-38 dB / -48 dB), optional "keep the first event only" (footsteps, ticks),
  2 ms fade-in and up to 120 ms fade-out, gated-RMS normalisation to -20 dBFS with a -1 dBFS soft ceiling, mono, Ogg/Opus 48 kbps.
* Loops (beds): two independent takes become the left and right channel (real stereo width), equal-power crossfade of the tail into the head
  (2 s), -24 LUFS, 80 kbps. Music loops: bar-aligned (the requested BPM) crossfaded loop, the generated outro is cut off, -18 LUFS, 112 kbps.
  Stingers: trimmed to length, natural fade-out. The seam is verified: |first sample - last sample| / typical sample step (reported as `loop_seam`, 1 = as smooth as the signal itself, rejected above 4).
* Rejected and regenerated (up to 3+ takes): silent, too short, long internal silence, clipping, spectrally implausible (`expect.centroid`), loop seam, very low CLAP similarity.
  With `candidates > 1` the take CLAP likes best is kept.
* Format: Ogg/Opus (PyAV bundles libopus; no system packages). Chrome, Edge and the Quest browser decode it natively
  (`decodeAudioData` and `<audio>`); `.ogg` is already in server/index.js's MIME table.

## Regenerate / extend the pack

```powershell
D:\omnissiah\tools\node\node.exe D:\omnissiah\server\audio\make_pack.mjs                       # everything missing (resumable)
D:\omnissiah\tools\node\node.exe D:\omnissiah\server\audio\make_pack.mjs --only slash-flesh,step-* --force --candidates 3
D:\omnissiah\tools\node\node.exe D:\omnissiah\server\audio\dump_spec.mjs D:\omnissiah\.cache\audio\spec_flat.json   # also rewrites clap_bank.json
wsl.exe -d Ubuntu -- bash -lc "cd /mnt/d/omnissiah/server/audio && ~/audio/moss/bin/python clap_check.py <dir> /mnt/d/omnissiah/.cache/audio/spec_flat.json 40"
```

Edit `pack_spec.mjs` to add a name (then add it to the header of `core/audio.js`; `test_core.mjs` verifies that every name the header lists exists).
To try a prompt: `lab.mjs items.json 3` prints CLAP similarity / rank per prompt and writes `.cache/audio/lab/<id>.ogg`.

By hand: `wsl.exe -d Ubuntu -- bash /mnt/d/omnissiah/server/audio/start_worker.sh --port 18775`, then
`powershell -File server\audio\wtest.ps1 sfx "a prompt" 2` or `... music "a prompt" 45 true -extra '{"bpm":80}'`. Logs: `.cache/audio/worker.log`, `sfx.log`, `music.log`.
Env vars: `AUDIO_DISTRO` (default Ubuntu), `AUDIO_SFX_PY`, `AUDIO_MUSIC_PY`.

## Tests

```powershell
D:\omnissiah\tools\node\node.exe server\audio\test_core.mjs      # core/audio.js + ambience.js zone logic against a fake AudioContext (no GPU)
D:\omnissiah\tools\node\node.exe server\audio\test_plugin.mjs    # plugin <-> worker end to end with a stub api (starts the worker)
D:\omnissiah\tools\node\node.exe server\audio\browser_test.mjs   # headless Edge: every pack file decodes; the real module runs on a real AudioContext
```

## Doubling with kit.sound

`kit.sound` has no master volume or enable switch, and its sound goes through the same `AudioListener` gain as the Omnissiah's voice, so
lowering it would silence him. The pack therefore plays on its own bus (straight to the destination) and `world.audio.replaces` lists the procedural
moments the pack covers (`'slash','pierce','blunt','burst','fire','frost','shock','magic','thud','break:<material>','combat:swing|hit|impact|death|shot'`).
One line in `kit.js` `gsnd()` / `breakSound()` and in `combat.js sfx()` would silence them: `if (ctx.world.audio?.replaces?.has(kind)) return;`.
Without it the procedural sounds simply play underneath (they are short and quiet; the compressor keeps the sum clean).

## Uninstall

```powershell
wsl.exe -d Ubuntu -- bash -c "rm -rf ~/audio"       # envs + models (~35 GB); other agents' folders are not touched
Remove-Item -Recurse D:\omnissiah\server\audio, D:\omnissiah\server\plugins\audio.js, D:\omnissiah\.cache\audio
# optional: D:\omnissiah\public\assets\generated\audio (the pack and everything generated), public\game\core\audio.js (and its entry in manifest.json)
```

## Measured (RTX 5090; the GPU and CPU were shared with other agents' model jobs most of the time, so warm numbers are pessimistic)

| | cold (worker + models start) | warm |
|---|---|---|
| MOSS-SoundEffect load | ~110 s first ever (11 GB download), 14-45 s afterwards | - |
| one sound effect (50 steps, window = seconds + 4 s) | 70-90 s total for the very first request (WSL worker start + load + first kernels) | 3.8-5 s per take end to end (gen ~3 s) |
| ambience bed (2 takes of 28 s, 30 s window) | - | ~13-25 s |
| ACE-Step 1.5 turbo, 30 s of stereo music | ~18 s first generation after load | 1.2 s (8 steps); a 45 s loop request ~34 s cold end to end |

VRAM: MOSS 10.6 GB after load, 14 GB peak while generating (the text encoder and DAC VAE are large); ACE-Step turbo 6 GB loaded, 7.5 GB peak (no language model);
CLAP ~1 GB. Models unload after 5 idle minutes (`--idle`), the Node side stops the worker after 20 idle minutes. Disk: `~/audio` 38 GB in total
(envs 16 GB, MOSS weights 11 GB, ACE checkpoints ~9.5 GB of which the unused 5Hz LM 3.5 GB `checkpoints/acestep-5Hz-lm-1.7B` can be deleted, CLAP 0.6 GB).

Starter pack: 195 names, 436 Ogg/Opus files, 17.7 MB (167 one-shots 408 files ~4.0 MB mono 48 kbps; 16 stereo loops ~3.4 MB; 10 music loops ~10 MB at 112 kbps, 63 s each; 2 stingers).
Build time ~3 h wall clock with retries. All 436 decode in headless Edge (`browser_test.mjs`: 1564 s of audio). Objective checks: no clipping, every file between -20 dB RMS
(one-shots) and -24 / -18 LUFS (beds / music), loop seams <= 4 sample-steps (music ~0.02-2.6), best-of-N by CLAP similarity where time allowed.
Median CLAP retrieval rank of a file's own prompt among the 203 prompts: 20 (CLAP is weak on foley, so this is a sanity filter, not proof).
Known weak spots: `heal-loop` has sparse sparkles with gaps, `humanoid-hurt-2` has a poor CLAP match, short "single event" sounds (footsteps, ticks) vary
in character between variants. Nobody could listen to it: the whole pack is verified by numbers only.

Quirks found: MOSS returns silence (peak < -70 dB) for about a quarter of the takes, much more for requests under ~1.5 s, so the worker asks for >= 2 s and crops, re-rolls with
another seed / window / cfg, and fails the job instead of ever amplifying silence. Streamed Ogg often reports `audio.duration = Infinity` (the game server has no Range support),
so `core/audio.js` loops music using the durations stored in `pack.json` / `index.json`.