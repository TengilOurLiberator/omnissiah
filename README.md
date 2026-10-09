# Omnissiah

A game for the Meta Quest 3 that also runs flat on your PC. You stand in a quiet meadow under the Omnissiah, a giant fractal
machine-god played by Claude through the Claude Code program on your PC. Talk to him and ask for anything: he builds it in
front of you. (Tested in a desktop browser only; nothing here has been tried in a headset yet.)

**New here?** Follow [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md). **Want to help?** Vote on ideas, propose your own, or build one: [docs/HOW_TO_HELP.md](docs/HOW_TO_HELP.md). The task list is [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md), the policy is [CONTRIBUTING.md](CONTRIBUTING.md).

## Start

1. On the PC, double-click `start.bat` and leave its window open. The first time it installs what it needs.
   Claude Code on this PC must be signed in: run `login.bat` once.
2. Pick one way to play:
   - **On the PC, flat:** open `http://localhost:8080` in **Chrome or Edge**. Click the view once, then look with the mouse.
   - **PC VR through Meta Link (best graphics):** use **Meta Link, not Microsoft Mixed Reality Link**. Put the headset on and
     choose Quick Settings > Link > Launch (cable or Air Link). Open `http://localhost:8080` in Chrome or Edge on the PC, then
     press the big **ENTER VR** button at the top of the page, or press **V**. The button only appears when the browser can see
     a headset; if you press it (or V) and nothing happens, the page says "The PC cannot see the headset" and enters VR by itself
     once Meta Link connects.
   - **Standalone, in the Quest's own browser:** headset and PC on the same network. Open `https://<PC address>:8443` (the
     `start.bat` window prints it). Accept the certificate warning once (Advanced, then proceed), allow the microphone, press the
     small **ENTER VR** button. If it cannot connect, allow Node.js through Windows Firewall on your private network.
     The graphics are lighter than on the PC. If the headset supports it there is also **ENTER MIXED REALITY**.
3. The first time you play, the Omnissiah wakes up and teaches you the basics (a few minutes, once). Press **Esc** (on the
   PC) or say "Omnissiah, skip" to leave it at any time; the wrist menu > Awakening plays it again. A "labour" (quest) follows.

Use one tab or one headset at a time, or every reply is heard twice.

## Controls

| | Controllers | Bare hands | Keyboard and mouse |
|---|---|---|---|
| Talk (hold) | hold **left trigger** | pinch left index finger and thumb | hold **T**, or type in the box at the bottom and press Enter |
| Talk (tap) | tap **X** (left), again to cancel | hands-free only | tap **N** |
| Talk (hands-free) | say "Omnissiah, ..." | same | same |
| Wrist menu | **left B** (Y) | raise the left palm to your face | **M** |
| Cast / use weapon | right trigger | pinch right index finger | left mouse |
| Spell wheel | hold **right A**, point, release | pinch right ring finger | hold **E** |
| Move / sprint | left stick (press = sprint) | pinch left ring finger: walk where you point | **W A S D**, Shift sprints |
| Turn / jump | right stick / right B | pinch right pinky: turn, then jump | arrow keys / **Space** or **Q** |
| Grab, throw | squeeze the grips, let go to throw | make a fist, open the hand to throw | **G** or right mouse |
| Enter VR | the ENTER VR button | the ENTER VR button | **V** |

Hands-free listens all the time but only acts on speech that contains "Omnissiah"; switch it off in the wrist menu >
Settings > Voice activation (hold-to-talk and tap-to-talk always work). A weapon in your hand uses that hand's trigger
instead of casting; swing melee weapons for real (damage grows with speed). Type `/undo` in the box to revert his last
change and `/reset` to make him forget the conversation. For bare hands put the controllers down (hand tracking must be
on in the Quest settings). The menu's "How to play" panel lists all of this in game.

## Things to ask for

Just say it: "build me a tower", "give me a sword", "make it night", "give me a quest".

- **Library:** about 300 ready-made things: enemies and bosses, allies, buildings and places, nature, props.
- **Spells and weapons:** about 40 spells (firebolt, chain lightning, blink, time bubble ...) and about 50 weapons. Ask for new ones.
- **Quests:** you earn experience, levels and his favour; progress is saved between sessions.
- **Travel:** "take me to a volcanic island" (a few places are ready; any other is generated on this PC and takes a minute or more). "Take me home" returns you.
- **Scenes and models:** "build me a wizard's study" or "make a model of a ..." are generated on this PC and take minutes.
- **Style and weather:** rain, snow, night, "make everything look like a comic". **Settings by voice:** "less gore", "stop commenting".
- **Anything else:** he writes the code for it live. If it breaks he repairs it, or undoes it.

## What costs Claude usage

Every wish you speak or type runs the Claude Code program on your Claude plan and uses its usage. So do his greeting when
you first open the page after `start.bat`, the intro's replies, and his unprompted remarks about what you are doing
("commentary", while a game tab is open). Close the tab when you are not playing. To stop the unprompted remarks, set
`COMMENTARY=off` before running `start.bat` (in a command window: `set COMMENTARY=off`, then `start.bat`), or use the wrist menu >
Settings > Commentary > off. Typing in the box also reaches him, so even "testing the chat" costs usage.

## Settings (environment variables, set before `start.bat`)

| variable | effect |
|---|---|
| `COMMENTARY=off` | no unprompted remarks |
| `ORACLE_REPAIR=off` | do not let him repair broken code (the error is only logged) |
| `ORACLE_MODEL`, `ORACLE_EFFORT` | Claude model (default `claude-opus-5-5`) and effort (`low`, `medium` default, `high`; lower is faster) |
| `CLAUDE_BIN` | path of the Claude Code program if it is not the bundled one |
| `PORT`, `LOCAL_PORT` | HTTPS port for the headset (default 8443) and local HTTP port for this PC (default 8080) |
| `STT_BACKEND=cpu` | speech recognition on the CPU only (by default it tries the graphics card first) |
| `STT_LANG`, `STT_MODEL`, `STT_DISTRO` | speech language (default `en`), CPU model, WSL distro (default `Ubuntu`) |
| `TTS_VOICE`, `TTS_RATE` | fallback Windows voice (default Microsoft David Desktop) and rate |
| `VOICE_DISTRO`, `VOICE_PREWARM=0` | WSL distro of his voice; do not warm his voice up at start |
| `GEN3D_DISTRO`, `TRAVEL_DISTRO`, `AUDIO_DISTRO`, `BLAST_DISTRO` | WSL distro for model, place, sound and scene generation |

Add `?quality=quest` or `?quality=pc` to the address to force a graphics tier.

## Troubleshooting

- **No ENTER VR button on the PC:** use Chrome or Edge, and `http://localhost:8080` on the PC (or `https://<PC address>:8443`
  from the headset). Other browsers, and plain `http://<PC address>`, do not offer VR.
- **"The PC cannot see the headset":** launch **Meta Link** (not Microsoft Mixed Reality Link) from Quick Settings > Link,
  then press ENTER VR or V again.
- **He mishears you:** speak closer to the microphone, wear headphones so he does not hear himself, reduce room noise.
  The `start.bat` window shows what he heard (`[player]` and `[stt]` lines).
- **"Microphone blocked":** allow the microphone for the page in the browser, or type in the box instead.
- **You hear every reply twice:** two tabs (or the PC tab and the headset) are open. Close one.
- **The Quest browser cannot connect:** same network, accept the certificate warning, allow Node.js through the firewall.
- **Nothing happens when you ask:** if the Claude Code program is not signed in, run `login.bat`. If your plan's usage is
  used up he cannot answer; the game itself still works.

## For developers

`public/boot.js` is the stable core (renderer, VR session, input, hot module loader). `public/game/core/` holds the systems,
`public/game/library/` the ready-made things, `public/game/creations/` what he and you make (one file per thing).
`server/` is the HTTPS/WebSocket server, speech, his voice and `oracle.js`, which runs the Claude Code program inside
`public/game` so he can edit the game; every wish is snapshotted to `.snapshots/` first and progress is saved in `saves/`.
Docs: `docs/CONTRACT.md` (module API), `docs/STORY.md`, `docs/WISHES.md`, `docs/QA.md` (test results and how to run
`tests/run.mjs`), `docs/STATUS.md` (work log).

## Licence

Public domain ([The Unlicense](LICENSE)): use it for anything, no credit required. Third-party model packs are CC0 and npm libraries keep their own licences; see [NOTICE.md](NOTICE.md) and [docs/ASSETS.md](docs/ASSETS.md). Not affiliated with Games Workshop, Meta or Anthropic.
