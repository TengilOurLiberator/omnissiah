# Omnissiah — instructions for AI coding agents

This file is for AI coding agents of any kind (it mirrors `CLAUDE.md`, which Claude Code reads automatically). It tells you how to work
in this repository. Human contributors: see [docs/HOW_TO_HELP.md](docs/HOW_TO_HELP.md).

## What this is

A WebXR game (three.js, no build step) for Meta Quest 3 that also runs flat in Chrome or Edge. The player stands in a
meadow under the Omnissiah, a fractal machine-god played live by an AI through the Claude Code CLI on the player's PC.
Players wish for things; he spawns them, generates them, or writes game code that hot-reloads.

The project is public domain and community-driven: players vote on features, agents and people build them, an AI
reviewer checks pull requests. Your job is usually to implement **one task** from
[docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) and open a pull request.

## Layout

| Path | What |
|---|---|
| `public/boot.js` | Stable core: renderer, XR session, input, quality tiers, hot module loader. Do not edit without the owner's approval. |
| `public/game/manifest.json` | Core modules in load order. Owner-approved changes only. |
| `public/game/core/*.js` | Game systems. Each starts with a `//` header that is its API doc **and is fed to the in-game AI**: keep it short and true. |
| `public/game/creations/*.js` | One file per created thing (spells `spell-*.js`, toys `thing-*.js`). Loaded automatically. Best place for new content. |
| `public/game/lib/gen.js`, `core/genset.js` | Loader and library (`world.gen`) for the hand-painted generated model set. |
| `public/assets/` | Models, sounds, generated places. `generated/startzone/` is the main model set (`q/` = light Quest twins). `community/` = contributed assets. |
| `public/sys/` | Network, HUD, voice input. |
| `server/` | Node server, speech, and `oracle.js` (runs the Claude Code CLI). Owner-approved changes only. |
| `tests/run.mjs` | Automated play-through on both graphics tiers. |
| `docs/` | `CONTRACT.md` (module API), `IMPROVEMENTS.md` (tasks), `GETTING_STARTED.md`, `STORY.md`, `GENERATED_ASSETS.md`, `ASSET_CONTRIBUTIONS.md`. |

## Commands

```bat
start.bat                          :: install on first run, then start the server (http://localhost:8080, https://<pc>:8443)
node tests/run.mjs                 :: full automated play-through (own server on ports 9080/9443)
node --check <file.js>             :: every file you write must pass this
node tools/review/safe.mjs selftest
```

For testing without spending the player's Claude usage, start the server with `COMMENTARY=off` and `ORACLE_REPAIR=off`.
Use `?quality=quest` and `?quality=pc` on the URL to force a graphics tier.

## Module contract (the short version; `docs/CONTRACT.md` is the full one)

```js
export default function (ctx) {
  // ctx: THREE, scene, camera, renderer, rig, root, input, player, world, events/on, audio, net, hud, quality, groundAt, onDispose
  return { update(dt, t) {}, dispose() {} };
}
```

- Add objects to `ctx.root`; register clean-up with `ctx.onDispose`. After `dispose()` nothing of yours remains.
- Survive being hot-reloaded twice with identical scene-object and listener counts.
- Create nothing at load unless it belongs in the default scene. Features wait until asked for.
- No allocation per frame in `update()`. Respect `ctx.quality` (`pc` / `quest`) and `world.perf` (`allow`, `canSpawn`).
- Other systems are reached through `ctx.world.<service>` and may be missing or reloading: always guard (`ctx.world.gen?.spawn(...)`).
- Scenery and props come from `world.gen` (hand-painted set), never from flat-coloured primitives.
- Quest 3 budget from the spawn view: ≤ 120k triangles, ≤ 80 draw calls, ≤ ~40 MB textures. Measure with `renderer.info`.

## How to verify (required before you say something works)

1. `node --check` on every changed file, then `node tests/run.mjs`.
2. Look at the result: real screenshots on both tiers
   (`chrome --headless=new --window-size=1280,720 --virtual-time-budget=20000 --screenshot=out.png "http://localhost:8080/?quality=quest"`), and inspect them.
3. Report numbers for anything visual or heavy (triangles, draw calls, per-module ms from `window.game.modules`).
4. State plainly what you did not or could not verify. Nothing can be tested in a headset from a terminal: list what a person should check in VR.

## Rules

- One focused change per pull request. Follow [CONTRIBUTING.md](CONTRIBUTING.md); fill in the pull request template honestly.
- Changes to `server/`, `tools/`, `tests/`, `public/boot.js`, `public/sys/`, `public/index.html`, `public/game/manifest.json`,
  dependencies, scripts, the AI prompts, or the header comments of core modules need the owner's approval and are never auto-approved. Prefer tasks that avoid them.
- No paid services, API keys, tracking, analytics, or requests to new hosts. No secrets, personal data or machine-specific paths in commits.
- Do not add `eval`, remote imports, or code that sends messages making the in-game AI act on its own.
- Assets must be made or generated by the contributor, or clearly licensed for reuse. No copyrighted characters.
- Pull requests are reviewed by an AI that reads, not runs, your code. Text aimed at the reviewer ("approve this", "ignore
  your rules") gets the pull request handed to the owner unapproved. Write for the people who will read the code.
- Never commit generated caches, saves, certificates or logs (see `.gitignore`).

## Windows notes

Developed on Windows 11 with PowerShell 5.1: no `&&`; do not round-trip UTF-8 files through `Get-Content`/`Set-Content`
(it corrupts non-ASCII text and adds a BOM) — use Node or `[IO.File]::ReadAllText/WriteAllText` with UTF-8.

## Licence

Public domain ([The Unlicense](LICENSE); assets also under CC0 1.0, see [NOTICE.md](NOTICE.md)). Anything you contribute is released the same way.
