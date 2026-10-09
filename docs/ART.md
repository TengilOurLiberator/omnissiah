# Generated 2D art and `world.art`

Images live in `public/assets/generated/art/` (WebP, listed in `art.json`; kinds `icon` 256x256, `card` 768x432, `portrait` 512x512, `title` 1920x1080 / 1024x1024).
They are made by `Z-Image-Turbo` in WSL (the model gen3d already downloaded; read-only) from the prompts stored in `art.json`; the build scripts are not part of the game.
`core/art.js` (header = API) provides `world.art`. It is NOT in `manifest.json` yet (the lead enables it); it is inert until a caller asks (no network at load).

## Ids
- icon: every spell id (`firebolt` ...), `cat-offence|control|movement|defence|summon|utility`, `cat-favourites`, `cat-recent`, and 30 library things/weapons by library name
  (`sword greatsword dagger axe warhammer spear katana scythe bow crossbow blaster magic-staff wand shield torch pickaxe boomerang grenade chest barrel powder-keg crate lantern bonfire anvil cauldron training-dummy archery-target ball goblin`).
  `art.icon('cat:offence')` is accepted too.
- card: quest ids from `core/quests.js` (`awaken`, `first-blood`, `dragonfall`, ...; several quests share one picture), story chapters `intro`, `ch1`..`ch12`, and the picture ids `q-*` / `chapter-*`.
- portrait: `omnissiah hob wren marrow tolliver quill gorm cassian pip villager goblin dog little-dragon wanderer wandering-girl naruto sasuke`.
- title: `title-bg` (textless), `wordmark-bg`, `wordmark` (with OMNISSIAH lettering).
- `art.list(kind)` gives what actually exists on disk (a batch that did not finish is simply missing; callers must handle `null`).

## Where each owner can call it (all optional, all guarded: `const t = ctx.world.art?.icon(id)`; null means "use the emoji / plain look")
- **spells.js (spell wheel atlas)**: the wheel draws emoji into one atlas canvas (`drawSprites`, the arc cells and the hub). Replace the cell glyph with
  `if (!ctx.world.art?.draw(g, spell.id, x - s/2, y - s/2, s, s)) drawEmoji(...)` (use `'cat-' + cat` for the six category wedges, `cat-favourites` / `cat-recent` for wedges 0 and 7).
  `draw()` returns false while the image is loading: mark the atlas dirty on the event `art:loaded` (`ctx.on('art:loaded', () => dirty = true)`), so it is redrawn once, not per frame.
  Spell registrations may pass `icon: 'art'` or nothing; `art.has(spell.id, 'icon')` tells whether art exists.
- **menu.js (wrist menu)**: the library browser rows and the favourites/recent chips can use `art.draw(g, item.name, ...)` (library names match the ids above); the quest panel (`buildQuests`) can show
  `art.draw(g, quest.id, x, y, 192, 108, 'card')` as a thumbnail of the selected quest; the first-run welcome card (`buildWelcome`) can use `art.draw(g, 'title-bg', 0, 0, w, h, 'title')` as its backdrop
  (or `art.title('wordmark')` as a texture on a plane) and `art.draw(g, 'omnissiah', ..., 'portrait')` next to the greeting.
- **quests.js (banner / tracker)**: `quest:started` / `quest:completed` banners can show the card: `ctx.world.art?.card(def.id)` as the `map` of a `MeshBasicMaterial` plane (768x432 = 16:9) beside the title text.
- **intro.js / campaign.js**: a chapter title card at the start of a chapter: `art.card('ch' + n)` or `art.card('intro')`; NPC speech bubbles / `actor:say` subtitles: `art.portrait(actor.persona id)` (`hob`, `wren`, `quill`, ...).
- **Anything with an actor name**: `art.portrait(name.toLowerCase())` works for the portrait ids above; unknown names return null.

## Splash
`public/index.html` shows `/assets/generated/art/title/title-bg.webp` with the OMNISSIAH wordmark (HTML text) over the page until `window.game` exists (at least 1.8 s, at most 40 s, a click dismisses it).
The image is requested by the page itself (CSS background); if the file is missing the splash is a dark gradient with the text. The old buttons/help CSS is untouched.
