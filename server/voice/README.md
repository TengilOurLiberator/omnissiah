# Omnissiah voices

Three things live here:

1. **The Omnissiah's real voice**: Resemble AI's open-source **Chatterbox** (MIT) running in a WSL worker on the GPU.
2. **NPC voices**: **Kokoro-82M** (Apache-2.0, `kokoro-js`, ONNX on the CPU, inside the Node server).
3. **Talking to NPCs**: hold the talk trigger while pointing at someone; they answer in character.

```
Omnissiah line --> services.tts (server/plugins/voice.js) --> sentence chunks --> worker.py (WSL, 127.0.0.1:18770, Chatterbox)
                    |  worker cold / slower than the budget / down  --> returns null --> server/index.js falls back to SAPI
                    '--> .cache/tts/om_<id>.wav  --> {type:'speak', text, audio}  --> public/sys/voice.js (cathedral effects)

NPC line  (actor.say -> event actor:say -> core/voices.js) --> {type:'npc_say'} --> Kokoro (Node, CPU, cached on disk)
          --> {type:'npc_voice', id, rid, audio:'/npcvoice/npc-<hash>.wav'} --> positional playback at the actor

Player talks to an NPC: context.npc (from world.contextProviders.npc) --> plugin.utterance() consumes it --> oracle.quick()
          --> {type:'npc_thinking'} ... {type:'npc_reply', id, name, text, audio, intent}
```

## Files

| File | Role |
|---|---|
| `../plugins/voice.js` | server plugin: replaces `services.tts`, starts/stops the worker, Kokoro, `npc_say`, NPC conversations, voice selection messages |
| `worker.py` | the WSL worker: HTTP `POST /speak`, `GET /health`, `POST /warm`, `/unload`, `/shutdown`; one inference at a time |
| `voices.json` | the voices (variant, reference clip, exaggeration, cfg, temperature, post-processing); re-read on change |
| `dsp.py` | numpy/scipy helpers (EQ, pitch shift, ensemble, trim, soft limit) shared by the worker and the design scripts |
| `design.py` | builds the synthetic reference clips (`refs`) and runs candidate sweeps (`sweep`) |
| `make-refs.mjs` | renders the Kokoro source material for the references (`.cache/voice/refsrc`) |
| `npc-prompt.md` | system prompt for NPC replies (passed to `oracle.quick`) |
| `setup_env.sh`, `start_worker.sh`, `py.sh`, `check.sh` | install, launcher, run-a-script helper, syntax check |
| `bench.mjs`, `lines.json`, `analyze.py` | latency + Whisper word-accuracy benchmark, 12 reference lines, f0/centroid analysis |
| `test-plugin.mjs`, `test-voices.mjs` | end-to-end plugin test (stub `api`), headless test of `core/voices.js` (fake ctx/net/WebAudio) |
| `devserver.mjs`, `harness/*.html` | tiny static server (port 18771) + browser harnesses that render the real client voice code offline |
| `kokoro-bench.mjs`, `probe.py`, `design_turbo.py`, `make-npc-samples.mjs`, `make-sapi.mjs` | measurements and sample generators |
| `../../public/game/core/voices.js` | client: `world.voices` (casting, positional playback, targeting, intents) |
| `../../public/sys/voice.js` | client: the Omnissiah's playback chain, `setStyle('godlike'\|'clean'\|'subtle')` |

## What is installed where

* WSL Ubuntu `~/voice/env`: micromamba Python 3.11, **torch 2.7.1+cu128** (first torch with Blackwell sm_120 kernels; Chatterbox pins 2.6.0,
  so `chatterbox-tts 0.1.7` is installed with `--no-deps` and its dependencies by hand), transformers 5.2.0, `setuptools<81` (the Perth
  watermarker needs `pkg_resources`). 7.6 GB. `~/voice/mamba` (228 MB) is the micromamba root.
* `~/voice/hf` (6.8 GB): Hugging Face cache with `ResembleAI/chatterbox` (original, 500M, used by all three Omnissiah voices) and
  `ResembleAI/chatterbox-turbo` (350M, only used by the spare voice `omnissiah-turbo`). No account or token is needed.
* Windows side: `D:\omnissiah\.cache\models\onnx-community\Kokoro-82M-v1.0-ONNX` (q8 88 MB is what the game uses; the 310 MB fp32 file was
  only used to make the reference clips). `D:\omnissiah\.cache\voice\` (~90 MB): `refs/` (reference clips), `refsrc/`, `samples/`, `bench/`,
  `npc/` (the NPC speech cache, LRU 500 files), `settings.json` (selected Omnissiah voice), worker logs.
* Nothing in `/opt/trellis`, `~/gen3d` or the other agents' folders is touched.

Chatterbox puts an inaudible Perth watermark in everything it makes; it is left switched on.

## The voices

Chatterbox clones the *timbre* of a reference clip. No real person is cloned: the references are synthesised here.

1. `make-refs.mjs` renders a 20 s declamation with a Kokoro voice (`am_onyx`, `bm_george`, `bm_lewis`).
2. `design.py refs` pitch/formant-lowers it (`librosa` phase-vocoder shift = a bigger body, not just a lower pitch), adds a low shelf and
   a presence lift, trims to 14 s and normalises: `.cache/voice/refs/<name>.wav`.
3. Chatterbox (original model) reads the lines in that timbre; the worker trims, EQs and soft-limits the result (peak -2 dBFS, no clipping).

| id | made from | feel | exaggeration / cfg | measured median f0 |
|---|---|---|---|---|
| `omnissiah` (default) | `am_onyx`, -3.5 semitones, +3.5 dB below 200 Hz | deep, resonant, grand | 0.70 / 0.35 | ~79 Hz |
| `oracle` | `bm_george`, -2.5 semitones | higher, calmer, doubled (two faintly detuned copies at 22 %) like a small choir | 0.60 / 0.40 | ~122 Hz |
| `titan` | `bm_lewis`, -6 semitones | very low and slow (cfg 0.3 = deliberate pacing), every word lands | 0.55 / 0.30 | ~78 Hz, ~1.9 words/s |
| `omnissiah-turbo` | same reference, Chatterbox-Turbo | 2x faster but 92 % word accuracy: spare | temperature 0.7 | ~69 Hz |

Why the original model and not Turbo: both were measured. Turbo is ~2x faster (0.25 real-time factor vs 0.45) but Turbo has no
exaggeration/cfg control and was clearly less intelligible with a 75 Hz voice (92.1 % vs 97.8 % Whisper word accuracy on the 12 test
lines). Chatterbox-Multilingual is not needed (English only).

To change a voice: edit `voices.json` (live, no restart) or swap `refs/<name>.wav` (any clean 10-15 s mono clip of a voice you have the
right to use; the worker re-reads it when the file changes). To remake the references: `node make-refs.mjs` then
`wsl -d Ubuntu -- bash /mnt/d/omnissiah/server/voice/py.sh design.py refs` and change `REFS` in `design.py` for new recipes.
Switch voice at runtime: client message `{type:'voice_set', voice:'oracle'}` (answers with `voice_info`, previews a line); the choice is
saved in `.cache/voice/settings.json`. `voice_get` lists `{id,label,desc}`; `voice_preview {voice}` speaks a sample line.

### Browser-side effects (`public/sys/voice.js`)

The old chain was tuned for the thin SAPI voice (-2.2 semitones, octave-down layer, heavy ring-mod). Lines named `om_*.wav` now use a
lighter profile; SAPI lines keep the old one. `voice.setStyle('godlike' | 'clean' | 'subtle')` (also `events.emit('voice:set-style', name)`,
`window.game.voice.setStyle`, persisted as `localStorage['omnissiah.voiceStyle']`, event `voice:style` when it changes):

| style | Chatterbox voice | SAPI fallback |
|---|---|---|
| `godlike` (default) | playback 0.97, halo (shimmer) + a little ring-mod, cathedral reverb 0.30, choir pad + sub swell | the original treatment |
| `subtle` | about a third of the effects | half-way |
| `clean` | the voice as synthesised plus a short room | light |

## Test from PowerShell

Node is `D:\omnissiah\tools\node\node.exe`. Nothing here needs the game server.

```powershell
# start the worker by hand (the plugin adopts a worker on 18770 and never kills one it did not start)
wsl.exe -d Ubuntu -- bash /mnt/d/omnissiah/server/voice/start_worker.sh --port 18770        # leave running, or use Start-Process -WindowStyle Hidden
Invoke-RestMethod http://127.0.0.1:18770/health                                               # loaded models, VRAM, queue
Invoke-RestMethod -Method Post http://127.0.0.1:18770/warm -Body '{}' -ContentType application/json   # load + first line (20-40 s)
Invoke-WebRequest -Method Post http://127.0.0.1:18770/speak -ContentType application/json -OutFile $env:TEMP\om.wav `
  -Body '{"text":"I am the Omnissiah. Speak.","voice":"omnissiah","seed":7}'                  # then play $env:TEMP\om.wav
Invoke-RestMethod -Method Post http://127.0.0.1:18770/shutdown -Body '{}' -ContentType application/json

D:\omnissiah\tools\node\node.exe server\voice\bench.mjs omnissiah oracle titan     # latency + Whisper accuracy -> .cache/voice/bench/
D:\omnissiah\tools\node\node.exe server\voice\test-plugin.mjs                      # plugin end to end (starts/stops its own worker)
D:\omnissiah\tools\node\node.exe server\voice\test-plugin.mjs --real 2             # + 2 real oracle.quick calls (spends Claude usage)
D:\omnissiah\tools\node\node.exe server\voice\test-voices.mjs                      # core/voices.js with fakes
D:\omnissiah\tools\node\node.exe server\voice\kokoro-bench.mjs q8                  # Kokoro speed on this CPU
wsl.exe -d Ubuntu -- bash /mnt/d/omnissiah/server/voice/check.sh                   # python + shell syntax
```

Listen: `D:\omnissiah\.cache\voice\samples\` has `omnissiah.wav`, `oracle.wav`, `titan.wav` (raw worker output), `*-long.wav`,
`processed/` (the same lines through the real browser effect chain, all styles, plus the SAPI fallback), and `npc/<archetype>.wav`
(every NPC archetype through the real NPC playback code, 3 m in front of the listener).

## Behaviour and limits

* **Latency budget.** The plugin waits at most `4.5 s + 0.65 s per expected second of speech` (6 to 16 s) for a line. Beyond that, or when the
  worker is cold, loading, down or errors, `synthesize` returns `null` and the server speaks that line with SAPI. Cold worker: the *first* line
  is SAPI while it loads (about 10 s process start + 15-25 s model load + 10-20 s first-run warm-up; the plugin pre-warms 2.5 s after server
  start, and again when the player starts talking or sends any utterance). Long lines are cut into sentence chunks (<= 220 characters) and
  joined into one WAV: the client plays one `speak` message per line, so time-to-first-audio equals the whole synthesis time.
* **Idle.** The worker unloads the models after 15 idle minutes (VRAM back to the bare CUDA context); Node stops the worker process after 30.
* **VRAM** (original model resident): 3.2 GB allocated, 3.4-3.7 GB peak/reserved, plus ~0.4 GB CUDA context.
* **NPC speech**: at most 3 queued syntheses (more are dropped; the bubble still shows), per-NPC 0.7 s minimum gap on the server, 1.2 s on the
  client, identical text+voice+speed is served from `.cache/voice/npc` (LRU 500 files, route `/npcvoice/`).
* NPC replies cost one short `oracle.quick` Claude run each (about 4 s) plus Kokoro (1-3 s).

## Addressing NPCs

`world.voices` sets `world.contextProviders.npc`. While the talk trigger (left trigger / left index pinch / T) is held it picks, once per hold, the
living humanoid actor within 8 m that the RIGHT hand ray (else gaze, narrower) is on, shows a ring and a name tag, and the utterance context
carries `npc: { id, name, role, persona, faction, mood, health, holding, nearby, voice, speed }`. With no one targeted, or when typing in the chat box,
the Omnissiah hears it as before. Actors are found through `kit.actors` (if kit exposes it), `combat.fighters` and every actor that has spoken.

## Uninstall

```powershell
wsl.exe -d Ubuntu -- bash -c "rm -rf ~/voice"                                 # env + models, ~15 GB
Remove-Item -Recurse D:\omnissiah\server\voice, D:\omnissiah\.cache\voice
Remove-Item D:\omnissiah\server\plugins\voice.js, D:\omnissiah\public\game\core\voices.js   # and its line in public/game/manifest.json
# public/sys/voice.js keeps working without the plugin (SAPI profile)
```

## Licences

Chatterbox MIT (weights MIT on Hugging Face), Kokoro-82M Apache-2.0, Perth MIT, librosa ISC, torch BSD.
