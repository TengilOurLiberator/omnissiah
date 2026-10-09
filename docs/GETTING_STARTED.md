# Getting started

Omnissiah is a WebXR game: a small Node.js server on your PC serves the game to a browser (flat on the PC, or in a Meta Quest 3).
The character in the sky is played by Claude through the Claude Code program running on your PC, signed in with **your own**
Claude account. There is no API key in this repository and none is needed.

Everything here was developed and tested on **Windows 11**. Other systems are untested.

## 1. What you need

| | Needed for | Notes |
|---|---|---|
| Windows 10/11 PC | everything | `start.bat` is a Windows script |
| [Node.js](https://nodejs.org) 20 or newer | the server | install it normally, or unpack a portable copy into `tools\node` |
| Chrome or Edge | playing | Firefox has no WebXR |
| A Claude subscription | talking to him, wishes | used through Claude Code, which `npm install` fetches. Every wish and every unprompted remark uses your plan's usage |
| Meta Quest 3 (optional) | VR | through **Meta Link** on a gaming PC, or standalone in the Quest browser |
| NVIDIA GPU + WSL2 Ubuntu (optional) | generating new 3D models, places, his special voice, fast speech recognition | see step 5; the game runs without them |

## 2. Install

```bat
git clone <this repository>
cd omnissiah
start.bat
```

The first run of `start.bat` runs `npm install` (several minutes; it downloads three.js, the physics engine, a speech
recognition model runner and Claude Code). When it prints `Omnissiah is awake`, the server is running. Leave the window open.

## 3. Sign in to Claude (once)

Double-click `login.bat`. Claude Code opens in the terminal: follow the sign-in prompts (or type `/login`), then type `/exit`.
Without this the game still runs, but he cannot answer or build anything.

## 4. Play

- **Flat on the PC:** open `http://localhost:8080` in Chrome or Edge. Click the view, look with the mouse, move with WASD.
- **PC VR:** start **Meta Link** in the headset (Quick Settings > Link > Launch) — not Microsoft's Mixed Reality Link —
  open the same address in Chrome or Edge on the PC and press the big **ENTER VR** button or **V**.
- **Standalone Quest:** in the Quest browser open `https://<your PC's address>:8443` (the server window prints it), accept the
  certificate warning once, allow the microphone, press **ENTER VR**. You may have to allow Node.js through Windows Firewall
  on your private network. The standalone view is currently heavier than the headset likes; PC VR is the better experience.

The first time, he wakes up and teaches you the basics. Press **Esc** or say "Omnissiah, skip" to leave the lesson.
Talk by saying "Omnissiah, ..." (hands-free), holding **T** / the left trigger, tapping **N** / **X**, or typing in the box.
The full control list is in the [README](../README.md) and on the board next to the campfire.

**Close the browser tab when you stop playing.** While a tab is open he comments on what you do, and that spends usage.
Start the server with the environment variable `COMMENTARY=off` to silence the unprompted remarks.

## 5. Optional: the local AI workers

The repository contains everything the game needs to *show* the world, including several hundred generated models.
*Generating new* things on request uses local models that are **not** in the repository (many gigabytes) and run in WSL2
Ubuntu on an NVIDIA GPU. Without them:

- new 3D models, places and "blast" scenes cannot be generated (the ready-made ones still work, and he can still write code and use the library);
- his voice falls back to the built-in Windows voice;
- speech recognition falls back to a smaller model on the CPU (slower and less accurate).

Each worker has its own folder with a setup script or notes: `server/gen3d/` (text → image → 3D model), `server/voice/`
(his voice and NPC voices), `server/stt/` (speech recognition), `server/audio/` (sound effects and music),
`server/travel/` (panorama places), `server/blast/` (whole scenes from one sentence). These were set up by hand on one
machine; expect to adapt paths and versions. They are not a one-click install.

## 6. Where things are

- `public/boot.js` — the stable core: renderer, VR session, input, hot module loader.
- `public/game/core/` — the game's systems, hot-swappable; `public/game/manifest.json` lists what loads.
- `public/game/creations/` — what he (or you) made: one file per thing.
- `public/assets/` — models, sounds, generated places. Sources and licences: [ASSETS.md](ASSETS.md), [GENERATED_ASSETS.md](GENERATED_ASSETS.md).
- `server/` — the web server, speech, and `oracle.js`, which runs Claude Code inside `public/game` so he can edit the game.
- `docs/CONTRACT.md` — the module API. `docs/STORY.md` — the story. `tests/run.mjs` — the automated play-through.

## 7. Safety notes

- He edits files under `public/game` on your PC when you make a wish. Every wish is snapshotted first (`/undo` in the chat box reverts the last one).
- The server listens on your local network on port 8443 so a headset can connect. Do not expose it to the internet.
- Nothing in this repository contains keys or account data. Your saves (`saves/`), caches and the self-signed certificate
  (`.cache/`) stay on your machine and are ignored by git.

## Trouble?

See "Troubleshooting" in the [README](../README.md): the usual causes are the wrong browser, Meta Link not running, or two game tabs open at once.
