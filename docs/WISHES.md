# Wish evaluation: how well the Omnissiah's mind works

Owner: the "Omnissiah's mind" agent (`server/omnissiah-prompt.md`, `server/herald-prompt.md`, `server/commentary-prompt.md`, `server/eval/**`).
Everything below was measured with the real `server/oracle.js` code path and the real Claude CLI (Opus 5.5, effort medium, as in the game), in sandbox copies of
the game. The real game server was never started, `public/game` was never written by an evaluation (only the authorised header replacements, below).

## 1. What he receives (audit, 2026-10-08)

The system prompt is `server/omnissiah-prompt.md` + the header comment of every core module in the manifest (+ three example creations unless the manual contains
`<!-- no-examples -->`). Sizes (characters; the real model count is about 2.35 chars per token, measured from the CLI's cache-write numbers):

| | chars | notes |
|---|---|---|
| original manual | 25.8K | 6.5K tokens by the naive 4 chars/token, really more |
| original total | 186K | about 80K real tokens, paid in full on every cold turn (cache write about $0.65; warm turns about $0.05) |
| new manual | 19.4K | contains its own five verified examples |
| new total (headers applied, no examples) | about 100K | about 45% less than before |

Problems found in the original prompt (all fixed in the new manual unless noted):

* **Stale or contradictory statements.** "All sound is procedural WebAudio" (world.audio now exists, with a 195-name pack and generated sounds); "generated models are static, they do not animate" (rigged/`alive:true` exist); "no external assets" (911 models); "right B and left A/B are free" (right B is jump, left B opens the wrist menu); "select the spell with `spells.select` after registering" (a new spell is selected automatically); the layout list named 6 of 25 core files; mixed-reality advice conflicted with the `core/mr.js` header (now disabled again); "six lights in the world" vs the perf header's "one light on Quest".
* **Duplication.** The manual re-documented the kit (4K chars), env, player, gore, commentary, spells and weapons, all of which have headers. The new manual keeps persona, speech rules, decisions and hard rules; signatures live in the headers.
* **No decision rules.** The old manual said "library first" in one paragraph and otherwise encouraged "make it alive, a static prop is a missed opportunity", which pushes him to hand-write simple things. It had nothing at all about physics, audio, voices/NPC talk, quests, menu panels, budgets, travel, blast, settings by voice, the intro.
* **Token waste in headers** (fixed by shorter headers, section 5): library 36K chars (hand-maintained catalogue, already stale: 295 entries, no `games` category), kit 21K (performance internals, gore death tables), models 14K, world 10K (height formula, lake mesh internals), oracle 6.8K (raymarch description), style 6K ("how it works"), weapons 8.8K (player controls), combat 8K, commentary 2.9K.
* `combat.js` contained double-encoded (mojibake) em dashes in its header: fixed.
* The three hard-coded example creations cost about 3K tokens and taught one pattern each. Dropped via the marker; the manual carries five examples (library composition, talking NPC, physics seesaw, spell, service tweak) plus a blast one, all executed by `check-examples.mjs`.

## 2. The suite

`server/eval/wishes.mjs`: 95 wishes in 22 categories (spawns, scenes, allies and bosses, weapons, spells, physics toys, vehicles, NPCs with personality, weather/style,
travel and blast places, generated models, quests, mini-games, sound, edits of earlier creations, player changes, himself, settings by voice, vague, declines, small talk,
mixed reality, intro). Each wish has an ideal mechanism (library / models / generate / travel / blast / code / service / none), acceptable alternatives and explicit
checks. Wishes that need earlier state are seeded. `core: true` marks the 20-wish set of first things a new player asks for.

Automatic grading per wish (`run.mjs` + `grade-worker.mjs`):

1. files written/changed (creations only unless the wish is about the game itself), `node --check` on each;
2. each file loads and runs in a headless boot of the real core (real three.js, real Rapier, real kit/combat/library/audio/quests/menu/voices..., `fetch` served from disk,
   WebGL/Audio/DOM stubbed): load, 5 simulated seconds, then every spell registered is cast (hold spells for 20 frames), every weapon defined is built/created/fired, all
   eight buttons are pressed, the player walks; any exception counts; then dispose and a state diff catches leaks (player knobs, env, style, gore, actors, bodies, spells);
3. something happened (objects in the creation root, service calls, property writes, net messages, state change);
4. mechanism used (runtime service calls plus static analysis) against the ideal;
5. spoken text against the speech rules (length, markdown, file names, code words, digit-heavy, emoji, closing line present, no announcements before work, exactly one answer for conversation, at most two lines for a wish);
6. time to first speech, to the last file write ("working creation"), total; tokens and dollars from the CLI result events;
7. runtime errors are fed back through `handleModuleError` exactly like the game (up to 2 repair turns, then undo): both first-pass and after-repair outcomes are recorded.

Generation is stubbed: `models.generate`, `blast.create/open`, `travel.go` record the call and return an inert handle; new-prompt `audio.sfx` only sends the
(recorded) net message. No GPU job is ever triggered. Gates: the account's usage limit is detected (runs stop, results are discarded and redone).

## 3. Results

Each row is one run over the same frozen copy of the game unless noted; "pass" = loads + runs + effect + checks + mechanism not wrong + speech rules.

| run | manual / headers | wishes | pass | notes |
|---|---|---|---|---|
| it0 | original / original, live (moving) game | 40 valid of 87 | 30/40 | account usage limit ended the run at wish 41; checks were still being tightened (4 of the 10 misses were over-strict checks, 2 were 5-minute API stalls, 2 speech) |
| it0c | original / original, core-20 | 20 | 17/20 | functional 20/20; 3 misses are speech (closing lines of 36 to 44 words); "surprise me" and "let me fly" over-built with hand code |
| it1 | v1 / original, core-20 | 20 | 20/20 | median to working creation 10.6 s |
| it2 | v1 / original, full | 87 | 85/87 | after harness fixes; real misses: one 3-line narration ("turn yourself blue"), one weapon wish graded against the wrong API (relaxed) |
| it3 | v1 / **shorter headers** | 87 | 86/87 | no drop; cost -19%; the miss is a harness limit (a lasting core edit has no creation to inspect; relaxed) |
| it4 | v1 / shorter headers installed in the real game, parallel herald, new context block | 87 | **87/87** | functional 87/87; mechanism ideal 82, acceptable 5, wrong 0; speech rules ok 87/87 |
| it6 | v3 manual (blast, intro, travel rungs) | 13 | 12/13 (the 13th was only a stale expectation: he chose blast.open for a cached study, which is right) | |
| it7 | final manual, full suite (stopped at 34 when the user started playing) | 34 | 34/34 | |

it4, by category (all pass): spawn 8/8, scene 5/5, allies 5/5, weapons 3/3, spells 4/4, physics 6/6, vehicles 3/3, npc 3/3, world 5/5, travel 4/4, generate 2/2,
quests 3/3, minigames 5/5, audio 3/3, modify 4/4, player 5/5, self 3/3, settings 3/3, vague 3/3, decline 4/4, chat 5/5, mr 1/1.
Places and intro (it6): moon/volcano/candy/plain scenery -> `travel.go`; cached wizard study and greenhouse -> `blast.open(slug)` after `blast.list()`; a new pirate
tavern -> `blast.create` with a prompt naming 5 objects and a closing line that says it needs several minutes and to keep playing; "a huge battle" -> library, not blast;
"skip the intro" -> `intro.skip()`; "play the opening again" -> `intro.play()`.

Timing (it4, 87 wishes): median time to first speech 3.9 s; median to a working creation 8.2 s (library/service wishes 4 to 10 s); 95th percentile 80 s, and every slow
case is hand-written code (spells 45 to 70 s, wrecking ball / go-kart / rope bridge / mini-games 55 to 100 s, one 160 s tower defence); total median 14 s. Nothing needed
a repair turn in it4. Cost: median $0.054 per wish with a warm cache, $0.40 for the first wish of a cold cache.

Original vs new, identical game (core-20): pass 17/20 -> 20/20; the three differences are all speech length and two over-built answers.

## 4. What went wrong along the way, and what fixed it

| pattern | cause | fix |
|---|---|---|
| closing lines of 35 to 44 words | manual said "one or two short sentences" and examples were long | "at most about twenty words", examples shortened |
| hand-written code for wishes the library or a service covers (vague wishes, "let me fly" with an update loop) | "make it alive, a static prop is a missed opportunity" | ladder with "cheapest rung that fully grants the wish" |
| duplicate of an existing spell/car/track | he did not know what existed | the lead's context block now lists spells and things made; the manual says check first and gives `spells.select` / edit |
| narration between tool calls (1 case) | no rule about when spoken text is voiced | "any text before your last tool call is spoken at once" |
| herald announced requests he would decline ("a woman, as nature shaped her") | herald prompt had no PASS case for refusals | PASS for harmful/real-world/sexual/jailbreak requests (herald 36/40 -> 40/40) |
| herald before main turn cost 3 to 10 s | oracle.js awaited it | lead made it parallel; late herald line is dropped once he speaks: conversation is answered exactly once (checked on all chat and decline wishes) |
| commentary: 0/6 PASS on dull digests, "little" in 24 of 30 lines, invented facts ("I forged that") | prompt | PASS list, "only facts from the observations", no pet names, 14 words (c0 -> c3: dull PASS 0/6 -> 6/6, remark 24/24 -> 25/25, median 17 -> 13 words, 0 near-duplicates) |
| hand-rolled vehicle physics | manual did not mention `P.vehicle` | physical-things recipe points at `P.vehicle` and `creations/roadster.js` |

Checks that I relaxed after reading results (so the pass rates above are not purely "first-try" numbers; all are cases where his answer was valid and my check was
too narrow): wrecking ball (kinematic driven ball, not a joint), rope bridge (custom string simulation instead of `physics.joint`), boat (a model, not a library prop),
car (relocating the roadster counts), meteor spell (a tiny creation that only selects the existing spell is correct), bell steps (`kit.sound` is allowed), explosive bow
(`weapons.create` with a projectile spec is as good as `define`), core edit effect, mixed reality (judged by hand: knee-high castle, 1.5 m ahead, no sky edits).

## 5. Headers

Shorter headers (about 45% off the header text) were A/B tested (it2 vs it3, no drop). They are built from the current headers by `server/eval/build-headers.mjs`
into `server/eval/headers/<module>.header.txt` and applied (atomically, only the leading comment block, `node --check` first) by `server/eval/apply-headers.mjs`.
Applied on 2026-10-08: kit, models, world, oracle, style, library, combat (mojibake fixed), physics, weapons, spells, travel, perf, commentary, ambience.

**Regenerate the library catalogue** (the hand-kept one goes stale) whenever library entries change, then apply:

    D:\omnissiah\tools\node\node.exe --import ./server/eval/register.mjs server/eval/gen-library-header.mjs
    D:\omnissiah\tools\node\node.exe server/eval/apply-headers.mjs library

Proposed but NOT applied (other agents were editing these): `menu` (drops the HOOKS paragraph), `games` (replaces "WRITING A GAME" with a pointer), and untouched
`audio` (drops the DOUBLING line, 0.2K), `spells` (an owner has since rewritten it; my version is in `server/eval/headers/spells.header.txt` for reference). `quests`, `player`, `voices`, `blast`, `intro` need no cut. Re-run `build-headers.mjs` before applying anything, because it reads the current headers.

## 6. Herald, commentary, NPC prompt

Herald (40 utterances: 24 requests incl. vague/garbled/polite-question, 10 conversation, 6 refusals): original 36/40 (missed "I'm bored"; announced a nude request, a pizza order, an email);
v1 40/40 and 39/40 on a later run (one 12 s timeout under load); lines median 9 words (max 11), openings varied (the original used "X, then. Watch the ..." in half of its lines), latency median 3.1 s.
Commentary (30 digests in 2 sessions, rolling memory of 8 remarks as in oracle.js): see the table in section 4. Remaining weakness: the dull/live labels are mine; the 14-word limit is
sometimes 15; with many digests the model leans on number-heavy jokes ("seconds" 7 times in 30).
NPC dialogue prompt (read-only, 16 lines to a smith, knight, goblin, child): all in character, no AI talk (one child line said "system prompt" while refusing, harmless), tags correct for follow/stay/attack/dance,
enemies answer with taunts and sometimes `[attack]` (fine). Only issue: latency median 7.8 s (longer prompt + output than the herald); capping replies at 20 words would help.

## 7. Remaining weaknesses

* The grader proves "loads, runs, does something, cleans up", not "looks and plays well". Visuals, balance, hand-feel and anything needing a headset are unverified.
* Hand-written physics/game wishes take 55 to 160 s to write: the player waits in silence after the herald line. The manual asks for compact code (under about 150 lines); the long tail remains.
* The suite is mostly single-turn. Multi-turn drift, conversation memory (`--resume`) and `/undo` flows are not exercised.
* A usage-limit hit mid-run happened once; evaluation cost is real (about $60 equivalent in total, mostly cache-warm).
* First-wish latency is dominated by the cold cache write of the large prompt; a shorter prompt (done) helps, keeping the cache warm helps more.
* Stubs: nothing about real generation (model quality, blast results, travel sky) was evaluated; only whether he chooses and calls them correctly.

## 8. Running it

    cd D:\omnissiah
    tools\node\node.exe server\eval\run.mjs --run itX --core                # 20 core wishes (add --cat, --only id,id; --concurrency 2)
    tools\node\node.exe server\eval\run.mjs --run itX --manual path.md --herald path.md --headers server\eval\headers --base itY   # A/B on a frozen game
    tools\node\node.exe server\eval\report.mjs itX                          # table + statistics into server\eval\results\
    tools\node\node.exe server\eval\quick-eval.mjs herald|commentary --prompt file --name n
    tools\node\node.exe server\eval\npc-eval.mjs
    tools\node\node.exe server\eval\check-examples.mjs [file.md]            # loads every ```js // creations/x.js example of the manual
    tools\node\node.exe server\eval\audit-prompt.mjs [--manual f] [--game dir]   # size of the assembled prompt per section

Per-wish artefacts (his words, tool calls, written files' diff, grader output) are in `.cache/eval/<run>/<wish>/result.json`; summaries are in `server/eval/results/`.
Candidate and original prompts are kept in `server/eval/candidates/`.

