# The Labours of the Machine-God: story bible

State (2026-10-08, late): the awakening (`core/intro.js`, now owned by the `opening` task) and `server/plugins/story.js` are done. `core/campaign.js` is INERT at load (only a stub `world.campaign`
with status `idle` and a Story panel) until the player starts or continues the story. Twelve chapters are implemented and bot-tested headlessly; **chapter 1 is the polished one** (the opening, entirely in
the starting meadow). All authored text lives in `public/game/campaign/lines.js`; chapters in `act1.js`, `act2.js`, `act3.js`; the script runner in `engine.js`.

## Who he is, and why he serves
The Omnissiah is the SECOND sun. He was lit to grant wishes in the place of the FIRST DRAFT, his elder brother, a sun built to make the world perfect: nothing in it could break, change or end, and so nothing in it
could be asked for. He cast the Draft out beyond the sky. As the Draft fell he made ONE wish: "give the world someone who asks". The Omnissiah granted it. That someone is the pilgrim. His whole service,
every wish he fulfils for the player, is the oldest wish he holds. He has not been able to say so. By the end it is a habit, and he thinks it is love, and he is not sure of the difference.
Voice: grand, warm, a little uncanny, an old star learning to be fond of someone; short plain sentences, a dry joke, never an assistant.

## What is wrong
The world is cracking where the Draft's perfection pressed against the Omnissiah's changing field: the sky stutters, the lake sends things up at night ("the Unfinished", made by nobody), the old standing stones hum.
The things the Omnissiah made before the pilgrim came, made for nobody and never asked for anything, have gone wrong and resent him.

## Antagonists
* **The Unfinished**: wraiths, goblins and imps that seep through the cracks; mindless pressure (Acts I to III).
* **Vesper Quill** (the necromancer who begged never to die), **Gorm** (the troll who was made tall and told nothing else), **Sir Cassian Vael** (the first champion, who guarded a throne for no one): sympathetic, spareable. Spared, they stand with you in the finale; killed, they do not.
* **The Regent**: "every ending I refused to grant" (the lich king). **The First Draft** (the Other Sun): not a monster, a grief. He speaks in a hollow voice from the sky.

## The twist
At the heart of the finale the Draft says: "I asked for you. It was my only wish." The pilgrim is not a stranger who wandered in; the pilgrim is the Draft's wish, and everything the Omnissiah has given is, in a sense,
the Draft's gift. The Omnissiah confirms it in his own voice and admits why he served. This reframes the last choice.

## Ending (two, both reachable; New Game+ afterwards)
At two altars on the field: **offer him a wish** (the asker finally grants) or **strike**. "The Quiet Sun": the Draft asks to be made small and warm; there are two suns, one loud, one gentle. "The Long Day": he breaks into stars; the Omnissiah is lonely for one night, and
says whatever the pilgrim asks next, he makes because he chooses to, not because he must. If the pilgrim was cruel to villagers (five or more), the offer is refused and only the strike remains. The title for the first ending is "Machine-God's Friend", for the second "Sunbreaker".

## Arc: 12 chapters
Act I "The Visitor": **1 The Wanderer's Fire** (the meadow, polished), 2 The Candle in the Cairn (night graveyard, a relic older than the graves), 3 The Merchant's Road (escort; a dog), 4 The Feast at Brindle Green (the first glitch).
Act II "The Cracks": 5 The Quiet Mire (Quill, a travelled swamp), 6 The Toll Bridge (Gorm), 7 The Hollow Knight (Cassian), 8 The Seam (villagers hint; the standing circle; the first eclipse; the Draft's first words).
Act III "The Other Sun": 9 The Dimming (the confession, three braziers, "he asked me for one thing as he fell"), 10 The Muster (allies), 11 The Black Noon (the Moon: the Unfinished, the Regent, the twist, the heart of the eclipse), 12 The Last Wish (the choice).
Every chapter is a self-contained 5 to 10 minute scenario the player starts by choice (Story panel, a pale beacon held for 2 s, or by telling him to continue); nothing is on a timer; failure is gentle (retry from the start; three deaths end it kindly);
everything a chapter spawns or restyles is removed on finish, abandon, failure and hot reload; progress is saved in the quests profile (`campaign.*` stats).

## Chapter 1: The Wanderer's Fire (the opening; played entirely in the meadow)
Flows out of the awakening: the intro's last line sends the pilgrim to the fire. 7 quest steps, about 5 minutes:
1. Walk to the campfire (0,-6). 2. Speak with **Pell**, the wanderer at the fire (persona: patched cloak, dry, kind, calls the Omnissiah "the lamp", knows more than he says; talkable with the NPC voice). 3. Carry three glowing bundles of kindling, scattered about the meadow, to the fire
(grab with squeeze / fist / G; each bundle is marked on the ground). 4. Dusk falls fast; two waves of wraiths, goblins and archers come out of the lake: hold the fire (0/2). 5. Go to the ring of standing stones (-34,-24) that he raises with a beam of light.
6. Strike the glowing altar at their heart (blade, spell or any hit): the stones wake, the sky stutters (first glitch). 7. Return to Pell. Rewards: 220 XP, 6 favour, the title "Fire-Keeper", the Ember Staff, a waypoint at the fire.
Branches: the closing line varies with kills (veteran), favour (fond) and cruelty to villagers (cruel). New Game+ makes it harder (x1.5 foes, x1.4 health, extra imps).
If the library lacks an entry the chapter degrades (missing scenery or foes are skipped; waits on missing things resolve instead of hanging).

### Authored lines of chapter 1 (the Omnissiah)
"A traveller keeps the fire in the meadow, pilgrim. He has been here longer than the grass. Go and sit with him." / "That is Pell. He walks. He has always walked. He calls me the lamp, which I allow." /
"The fire is low. I have scattered kindling about the meadow. It glows, so you cannot miss it. That was not an accident." / "Night, then. It comes early now. I do not know why." /
"Something has crawled out of the lake. I did not make it. Or I did, and forgot." / "More. They are drawn to the fire. Everything is, in the end." / "Pell is right about the stones. I raised them for no one, long ago. Go and look." /
"The altar at their heart is awake. Strike it. Blade, spell, a thrown shoe. Strike it." / "There. The sky stuttered. Did you see? Do not tell me what you saw. I am not ready." /
"Quiet. Hear it? That is a night survived. I have not had one of those with company." (variants: vet, fond, cruel).
Pell: "Sit. The lamp does not mind. It watches everyone and says nothing. Mostly." / "Mind the lake after dark. Things come out of it now. They did not, before." / "That helps. A fire is just a promise someone keeps." / "Here it comes. Stay near the light." /
"Not the first, not the last. Listen. The old stones hum. They did not, before." / "First night is the worst. Sit by the fire when you want to know why."

## Scripted speech
`server/plugins/story.js`: client `{ type: 'say_as_omnissiah', id, text }` is synthesised through `api.services.tts.synthesize(text, { voice: 'omnissiah' })` (Chatterbox when present, SAPI fallback) and broadcast as the normal `speak` message (plus `scripted: id`), queued politely behind
`oracle.busy`, capped at 360 characters and rate limited (8 per 20 s per socket). Client: `world.campaign.omni.say(text)` (promise, resolves when the line finished, with a timeout fallback).

## Verification (all headless Node with the real modules; nothing on a headset)
`.cache/story/playthrough.mjs` (env `PT=plugin,chapters,branches`, `CH=ch1,...`): every chapter 1 to 12 played by a scripted bot through its real waits (position, kills, grabs, hits, choices): all quest steps fire in order, rewards (XP, favour, title, weapon, waypoint, pet) granted, registries (fighters, actors, library instances,
sky, mood, style, travel) return to baseline, no forced completions; plus the kill path of ch5/6/7, both endings, the cruel branch, New Game+, gentle failure and retry, abandon, hot reload mid-chapter (the reloaded module is inert), save/reload mid-chapter, the sandbox working mid-chapter, mixed-reality refusal. 194 of 195 passed in the last full run, the one failure (a stray dropped weapon after chapter 2)
fixed afterwards and re-checked (ch1+ch2 run: all per-chapter checks pass). Real-WebGL screenshots exist only for the intro; the chapters were NOT rendered.

## To enable
`core/campaign.js` is safe to put in the manifest (before `core/intro.js`): inert until `world.campaign.continue()`. The intro's final line starts chapter 1. Manual sentence for the Omnissiah (its header already says it): when the player says "continue the story", call `world.campaign.continue()` with one short line.
