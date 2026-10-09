# The generated model set (asset librarian, 2026-10-09)

369 overnight models (`sz-*` 60, `lg-*` 272, `x-*` 37) are now a reviewed library with a catalogue, a search API and a section in the
Omnissiah's prompt. Files: `public/assets/generated/startzone/` (`<id>.glb` original ~19k tris, `q/<id>.glb` Quest twin ~2.3k tris, `<id>.png` source
picture, **`index.json` = the catalogue**), `public/game/core/genset.js` (`world.gen`), tools in `tools/startzone-batch/`.
Nothing here was tested in a headset.

## Counts

| | n |
|---|---|
| reviewed | 369 |
| kept, both tiers (`tier: 'all'`) | 332 |
| kept, PC tier only (`tier: 'pc'`, Quest twin too damaged) | 33 |
| rejected (not in index.json) | 4 |
| solid (player collides) / walk-through | 287 / 78 |
| by prefix in the index | sz 60, lg 268, x 37 |

Groups (kept all / pc-only): stones 7/1, camp 19/2, nature 37/5, shrine 3/0, lake 4/0, guide 3/0, training 6/0, clockwork 24/2, landmark 16/0, crypt 10/1,
village 26/2, loot 25/2, lair 3/0, boss 16/1, ruin 11/3, fortress 13/0, dungeon 11/2, swamp 13/0, ritual 3/0, forge 10/2, harbour 11/3, desert 12/1, snow 12/0,
volcanic 8/2, arena 8/0, mount 8/1, statue 7/3, modular 6/0. **None of the 60 `sz-*` is rejected; 3 are PC-only** (flower-patch, mushroom-ring, boulder-b).

## How each model was reviewed

1. Contact sheets of the 369 source pictures (11 sheets of 35, id under each): `.cache\genset\sheets\sheet01..11.png`. All 369 pictures are clean single objects.
2. The picture can be fine while the mesh is broken, so EVERY id was also rendered as the original GLB and as the Quest twin with three's GLTFLoader in headless
   Chrome (same material clamp as `lib/gen.js`): `.cache\genset\sheets\glb_o_01..11.png` (original) and `glb_q_01..11.png` (twin; red label = `warn` in optimized.json,
   the label shows triangles). Suspicious ones were re-rendered large from front and back (`glb_d1_o_01.png`, `glb_d2_o_01.png`, `glb_d3_q_01.png`).
3. Automatic checks over all 738 GLBs (`.cache\genset\diag-o.json`, `diag-q.json`): one mesh, one textured material, no NaN positions, base at y = 0, longest side 1.0
   (twins within 3 %), all materials opaque and single-sided. These pass for every id, so the defects below are visible only by looking.
4. Verdicts: keep (original and twin read as the object, even if the twin is faceted or crumpled), keep-pc-only (twin is destroyed: shards, holes, flaps),
   reject (the original itself is broken or wrong). `warn` models from optimized.json were all looked at: most are fine on the 5000-tri twin, 33 ids are PC-only because even
   that is shredded (and a few non-`warn` ones were bad too: sz-flower-patch, sz-boulder-b, lg-dungeon-stairs, ...).
5. In-game check: sandbox server, real `core/genset.js` + `lib/gen.js`, 20 ids on both tiers next to 1.7 m markers (`.cache\genset\sheets\game_{pc,quest}_row0..3.png`).

## Rejected (4)

| id | why |
|---|---|
| lg-castle-gatehouse | mesh full of holes in original and twin; the picture is fine, the TRELLIS mesh is torn open |
| lg-fallen-obelisk | torn geometry: a loose ribbon of surface hangs off the slab, the end is hollow |
| lg-trilithon | riddled with small holes through lintel and pillars (twin shredded) |
| lg-potion-red | liquid colour lost in the bake: renders as a plain white jug, not a red potion |

(Machine-readable: `tools/startzone-batch/rejected.json`; reasons live in `tools/startzone-batch/review.json`.) Alternatives: castle = `lg-keep`, `lg-castle-wall`, `lg-castle-corner-tower`, `lg-portcullis`; dolmen/trilithon = `sz-runestone-*`, `lg-standing-circle-stone`; potions = `sz-potion-table`, `lg-potion-blue` (PC), `lg-crystal-orb`.

## PC tier only (33) and the Quest substitute

`world.gen.spawn` swaps in `alt` automatically on `?quality=quest` (`h.substituted`), or skips when there is none (`h.skipped`). Every one has an alt.

| id | alt (Quest) | what is wrong with the twin |
|---|---|---|
| sz-flower-patch | x-plant-lavender | petals collapse into flat green shards |
| sz-mushroom-ring | lg-swamp-mushroom | caps shredded |
| sz-boulder-b | sz-boulder-a | corners torn, dark gaps in the top face |
| lg-graveyard-gate | lg-iron-fence | bars and arch shredded |
| lg-hay-bale | lg-haystack | straw surface shredded |
| lg-enemy-tent-large | lg-enemy-tent-small | dark cloth crumpled with holes |
| lg-goblin-totem | lg-swamp-skull-stake | skulls lost, blobby (the original is blobby on the back side too: face it towards the viewer) |
| lg-dungeon-stairs | sz-stairs | spiral stair collapses to ribbons |
| lg-skull-pile | lg-bone-pile | skulls melt into mush |
| lg-necromancer-altar | lg-imp-shrine | collapses to a broken cube |
| lg-dolmen | sz-runestone-tall | slabs crumpled |
| lg-clockwork-cathedral-arch | lg-clockwork-pillar | tracery torn into flaps |
| lg-machine-heart | lg-tesla-coil | warped, shell dented |
| lg-quench-barrel | sz-barrel | staves crumpled |
| lg-mine-entrance | lg-sea-cave-rock | destroyed (loose shards) |
| lg-fishing-boat | sz-rowing-boat | hull broken open |
| lg-ship-wreck | lg-small-sailboat | sails and hull shredded |
| lg-net-pile | lg-fish-crate | net becomes confetti |
| lg-desert-rock-arch | lg-desert-mesa | shredded wire-frame |
| lg-ash-tree | sz-tree-dead | crown destroyed |
| lg-fire-brazier-big | sz-brazier | bowl shredded (6.8k tris and still bad) |
| lg-gold-pile | lg-treasure-chest-gold | coins shredded |
| lg-potion-blue | lg-crystal-orb | glass shell broken |
| lg-stagecoach | lg-handcart | wheels and frame ragged |
| lg-stable | lg-chicken-coop | roof and walls torn |
| lg-fallen-colossus-head | x-statue-owl | head destroyed |
| lg-giant-hand-statue | lg-broken-sun-statue | fingers shredded |
| lg-floating-island-rock | lg-rock-formation-big | underside broken |
| lg-giant-mushroom | lg-swamp-mushroom | cap shredded |
| x-statue-dragon-head | x-trophy-dragon-skull | crumpled |
| x-statue-troll | x-statue-goblin | crumpled, face lost |
| x-statue-giant-spider | x-statue-skeleton-knight | destroyed (loose shards) |
| x-plant-giant-flower | lg-sunflower-patch | petals shredded |

Kept on both tiers although the twin is faceted/crumpled but still reads: lg-village-inn, lg-windmill, lg-village-gate, lg-village-cottage-b, lg-farm-barn, lg-gravestone-a, lg-bone-fence,
lg-harbour-warehouse, x-rock-mossy-cluster, lg-stone-pillar-hall, lg-mill-sacks, lg-snow-cabin, lg-enemy-tent-small, lg-goblin-hut, lg-desert-skull, lg-troll-pot, lg-ruined-hall-wall,
lg-ruined-tower, sz-stone-well, lg-village-well (judge them on the Quest sheets `glb_d3_q_01.png`; a Quest view is rarely closer than 10 m).

## Things to know (kept, with caveats; all are `note` in index.json)

- `sz-runestone-leaning`: runes are faint in the baked texture (plain brown slab). `sz-waystone`: arrow glyph is faint, back side dark blue-green.
- `lg-hollow-banner`: letters on the banner are garbled. `lg-harbour-tavern-sign` is a small shop front, not a signboard. `lg-saddle-horse-statue` is a statue, not a rideable horse.
- `lg-gold-pile`, `lg-golden-goblet`, `lg-golden-key`: "gold" bakes as orange. `lg-potion-blue`: pale blue, not saturated.
- `lg-airship`, `lg-floating-island-rock`: meant to hang in the air, pass `y`. `x-trophy-boar-head`: wall trophy, mount it at y about 1.5.
- Single-sided materials: nothing is two-sided; the holes in the rejected meshes are real geometry holes (DoubleSide does not rescue them, tested).
- Sizes: `size_m` from the lists, corrected for three items (sz-jetty 5 -> 3.6, sz-bridge 5 -> 4, lg-snowman 1.6 -> 1.8). Measured in the game next to a 1.7 m marker: barrel 1 m, well 1.8 m, tent 3 m, oak 7 m, windmill 10 m, keep/lighthouse 14 m all read right.
- Backs of the models are lower quality than the fronts (TRELLIS): at yaw 0 the front faces +Z (verified on the tent door).

## The 40 hero props (best-looking, most characterful; `hero: true` in the index, `list({hero:true})`)

`sz-runestone-tall` Tall Runestone; `sz-tent` Pilgrim Tent; `sz-tree-oak` Old Oak Tree; `sz-shrine-altar` Cog Shrine Altar; `sz-pilgrim-statue` Pilgrim Statue; `sz-cooking-pot` Cooking Pot Tripod; `sz-supply-cart` Supply Handcart;
`sz-weapon-rack` Weapon Rack; `sz-archery-target` Archery Target; `sz-spell-lectern` Spell Lectern; `sz-potion-table` Potion Table; `sz-bell-frame` Bell Frame; `sz-stone-well` Stone Well;
`lg-village-cottage-a` Thatched Cottage; `lg-windmill` Windmill; `lg-watermill` Watermill; `lg-village-fountain` Village Fountain; `lg-knight-throne` Knight Throne; `lg-keep` Keep; `lg-catapult` Catapult;
`lg-cannon` Cannon; `lg-moon-altar` Moon Altar; `lg-regent-throne` Regent Throne; `lg-giant-clock-face` Giant Clock Face; `lg-pipe-organ` Pipe Organ; `lg-clockwork-guard` Clockwork Guard;
`lg-lighthouse` Lighthouse; `lg-sailing-ship` Tall Sailing Ship; `lg-oasis-palm` Oasis Palm; `lg-ancient-sphinx` Ancient Sphinx; `lg-snowman` Snowman; `lg-treasure-chest-gold` Open Gold Chest;
`lg-spellbook` Spellbook; `lg-hot-air-balloon` Hot Air Balloon; `lg-ruined-temple-front` Ruined Temple Front; `lg-crystal-spire` Crystal Spire; `x-statue-wolf` Wolf Statue;
`x-statue-skeleton-knight` Skeleton Knight Statue; `x-tree-cherry-blossom` Cherry Blossom Tree; `x-plant-vine-arch` Vine Arch.

## Gaps worth generating next (ready-to-use prompts)

The set is all STATIC props and scenery. It has no people, no enemies, no animals (only 10 static creature statues, x-statue-*). Prompts below follow `list.json`
(the batch appends the shared style suffix "hand-painted low-poly fantasy, chunky shapes, warm dusk palette"; the whole prompt is capped at 200 characters).
For anything that should be rigged and animated (`animate` in gen3d) use ONE character, standing, limbs clear of the body, nothing held (see core/models.js notes):
"in a T-pose" is deliberate. Suggested ids in brackets; put them in a `list4.json` with `group`, `size_m` (longest side in metres), `ground: true`.

**Characters / NPCs (highest value)**
1. [npc-villager-man, 1.8] a friendly stylised villager man standing in a T-pose, arms out, brown tunic, simple trousers, leather boots
2. [npc-villager-woman, 1.7] a friendly stylised villager woman standing in a T-pose, arms out, long green dress, white apron, hair in a braid
3. [npc-child, 1.2] a cheerful stylised child standing in a T-pose, arms out, patched tunic, messy hair, bare feet
4. [npc-elder, 1.7] a wise old stylised man standing in a T-pose, arms out, long grey beard, hooded brown robe, no staff
5. [npc-merchant, 1.8] a stylised travelling merchant standing in a T-pose, arms out, big backpack, red hat, patched coat
6. [npc-blacksmith, 1.9] a broad stylised blacksmith standing in a T-pose, arms out, leather apron, rolled sleeves, soot on face
7. [npc-innkeeper, 1.8] a stylised round innkeeper standing in a T-pose, arms out, white apron, rolled sleeves, friendly face
8. [npc-guard, 1.9] a stylised town guard standing in a T-pose, arms out, steel helmet, chainmail, red tabard, no weapon
9. [npc-wizard, 1.8] a stylised wizard standing in a T-pose, arms out, tall pointed hat, long blue robe, grey beard, no staff
10. [npc-knight, 1.9] a stylised knight standing in a T-pose, arms out, full steel plate armour, plumed helmet, brass trim
11. [npc-ranger, 1.8] a stylised hooded ranger standing in a T-pose, arms out, green cloak, leather armour, quiver on back
12. [npc-queen, 1.8] a stylised queen standing in a T-pose, arms out, golden crown, long purple gown with gold trim
13. [npc-priestess, 1.8] a stylised priestess of the machine god standing in a T-pose, arms out, white robe with brass cog emblem
14. [npc-bard, 1.7] a stylised bard standing in a T-pose, arms out, feathered hat, colourful striped jacket, no instrument
15. [npc-farmer, 1.8] a stylised farmer standing in a T-pose, arms out, straw hat, dungarees, rolled sleeves, muddy boots

**Enemies and creatures**
16. [en-goblin, 1.2] a stylised goblin warrior standing in a T-pose, arms out, green skin, pointy ears, ragged leather vest, no weapon
17. [en-skeleton, 1.8] a stylised skeleton warrior standing in a T-pose, arms out, cracked bone, rusty helmet, ribs showing, no weapon
18. [en-orc, 2.2] a huge stylised orc brute standing in a T-pose, arms out, grey-green skin, tusks, spiked shoulder armour
19. [en-imp, 1.0] a small stylised red imp standing in a T-pose, arms out, little horns, bat wings folded, pointed tail
20. [en-bandit, 1.8] a stylised bandit standing in a T-pose, arms out, black face mask, dark hood, patched leather coat, no weapon
21. [en-dark-knight, 2.0] a stylised dark knight standing in a T-pose, arms out, black spiked armour, glowing red eyes in helmet
22. [en-necromancer, 1.9] a stylised necromancer standing in a T-pose, arms out, tattered black robe, bone mask, purple glow
23. [en-golem, 3.0] a stylised stone golem standing in a T-pose, arms out, mossy boulders for limbs, glowing orange rune chest
24. [en-clockwork-soldier, 2.0] a stylised brass clockwork soldier standing in a T-pose, arms out, visible gears, round glowing eyes
25. [en-slime, 1.0] a stylised green slime blob, round and glossy, big cute eyes, small bubbles inside, flat bottom
26. [en-spider, 1.6] a stylised giant spider standing with eight legs clearly spread apart, round body, red eyes, brown fur
27. [en-wolf, 1.6] a stylised grey wolf standing on all four legs, side view, legs apart, snarling, thick fur
28. [en-bat, 0.8] a stylised giant bat with wings spread wide and flat, small body, big ears, sharp teeth
29. [en-dragon-whelp, 2.4] a stylised young dragon standing on four legs, wings folded, small horns, green scales, tail out behind
30. [en-ghost, 1.6] a stylised ghost standing upright, pale blue sheet-like body, hollow eyes, ragged hem, arms out

**Animals (farm and meadow life)**
31. [an-chicken, 0.5] a stylised white chicken standing, red comb, orange beak and feet, chunky body
32. [an-sheep, 1.1] a stylised woolly sheep standing on four legs, side view, fluffy white wool, dark face and legs
33. [an-cow, 1.8] a stylised brown and white cow standing on four legs, side view, small horns, pink nose
34. [an-horse, 2.2] a stylised brown horse standing on four legs, side view, flowing black mane and tail, leather saddle
35. [an-dog, 0.9] a stylised friendly dog standing on four legs, side view, floppy ears, tan fur, wagging tail
36. [an-cat, 0.6] a stylised ginger cat sitting upright, white chest, long tail curled round its feet
37. [an-rabbit, 0.4] a stylised grey rabbit sitting upright, long ears up, white tail, twitching nose
38. [an-deer, 1.8] a stylised deer standing on four legs, side view, slim legs, branching antlers, white spots
39. [an-fox, 0.8] a stylised red fox standing on four legs, side view, bushy tail with a white tip

**Props the set still lacks**
40. [pr-campfire, 1.0] a lit campfire, stacked split logs in a ring of stones, bright orange flames and glowing embers
41. [pr-bed, 2.0] a cosy wooden bed with a patchwork quilt, a pillow and a carved headboard
42. [pr-table-chairs, 2.0] a rustic round wooden tavern table with two wooden chairs and two tankards on top
43. [pr-wardrobe, 2.0] a tall carved wooden wardrobe with two doors and brass handles
44. [pr-fireplace, 2.4] a big stone fireplace with a burning log fire, a wooden mantel and a hanging iron pot
45. [pr-wooden-door, 2.2] a sturdy arched wooden door in a stone frame with iron hinges and a round window
46. [pr-ladder-hatch, 3.0] a long wooden ladder leaning on a stone ledge beside a square wooden hatch
47. [pr-hedge, 3.0] a neatly trimmed green garden hedge segment, rounded top, with small white flowers
48. [pr-stepping-stones, 3.0] a curving path of flat round stepping stones set in grass with small moss patches
49. [pr-pond, 4.0] a small round pond with a rocky rim, blue water, lily pads and reeds
50. [pr-portal-ring, 4.0] a standing stone ring portal with glowing blue runes and a swirling light inside the ring
51. [pr-checkpoint-flag, 3.0] a tall wooden pole with a bright yellow checkpoint flag showing a brass cog, stones at its base
52. [pr-quest-pillar, 3.0] a slim stone pillar with a floating glowing golden exclamation mark above it
53. [pr-torch-standing, 2.0] a tall wooden standing torch with a bright flame and a stone base
54. [pr-sword-in-stone, 1.2] a steel sword stuck in a mossy grey stone, shining blade, golden cross-guard
55. [pr-bow-quiver, 1.0] a wooden longbow leaning on a leather quiver full of arrows
56. [pr-tankard-food, 0.6] a wooden tavern board with a mug of ale, a loaf of bread, a wedge of cheese and an apple

**Modular kit (building from parts)**
57. [mod-wall-window, 3.0] a half-timbered cottage wall segment with a small shuttered window, plaster and dark beams
58. [mod-wall-door, 3.0] a stone cottage wall segment with a wooden arched door and a lantern
59. [mod-roof-tile, 4.0] a sloped red clay-tile roof segment, chunky tiles, a wooden ridge beam
60. [mod-roof-thatch, 4.0] a sloped golden thatched roof segment, thick straw, a wooden ridge beam
61. [mod-stairs-wood, 3.0] a straight flight of chunky wooden stairs with side rails
62. [mod-battlement, 3.0] a stone castle battlement wall segment with crenellations and a narrow arrow slit
63. [mod-cliff, 6.0] a tall mossy grey cliff face segment with layered rock ledges and a few hanging vines
64. [mod-cave-mouth, 5.0] a dark cave entrance in a rocky hillside, ferns around the opening, a few glowing mushrooms

Priorities: 1-15 and 16-30 first (the game cannot show a person or an enemy yet except as a statue), 31-39 for ambience, 40-56 for interiors and quest markers, 57-64 so the Omnissiah can build whole houses.
Run one batch with `tools/startzone-batch/run.mjs` (it takes a list path; see `run3.mjs` for how `list3.json` was wired), then `optimize.mjs`, then the three steps below.

## How to regenerate / extend (every step is idempotent)

1. New models: add to a list json (`{ id, group, size_m, ground, prompt }`), run the batch, run the optimiser (creates `q/<id>.glb`, appends to `optimized.json`).
2. Review them: copy `tools\startzone-batch\review-kit\*` to `.cache\genset\` (the scripts assume that folder), run `meta.mjs` (writes meta.json), `tools\startzone-batch\sheets.mjs` (source-picture sheets),
   then `srv.mjs` (static server, port 9540) and open `render.html?sets=o,q` in headless Chrome (writes the GLB / twin sheets and diag json; `shot.mjs` is a CDP screenshot driver, `test-creation.js` the in-game grid, `test_genset.mjs` the headless API test). LOOK at them. Put the verdicts into `tools/startzone-batch/review.json` (`reject`, `pcOnly` + `alt`, `notes`, `name`, `size`, `solid`, `tags`, `hero`).
3. `D:\omnissiah\tools\node\node.exe tools\startzone-batch\build-index.mjs` rewrites `public/assets/generated/startzone/index.json` (atomic) from the lists + `optimized.json` + `review.json`
   and prints the counts (ids with no twin are skipped until the optimiser has run).
4. `D:\omnissiah\tools\node\node.exe tools\startzone-batch\gen-header.mjs` regenerates the id catalogue between `CATALOG-BEGIN` and `CATALOG-END` in the header of
   `public/game/core/genset.js` (and the model count in line 1; it syntax-checks before replacing the file). `--print` only shows it. The whole header is about 7 KB.
5. Hot reload picks up genset.js; the index is fetched with `cache: 'no-cache'` on the first use per page load.
