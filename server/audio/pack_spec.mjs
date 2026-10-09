// The starter sound pack: every stable NAME the game plays, with its generation prompt(s). Edit, then run
//   tools\node\node.exe server\audio\make_pack.mjs [--only a,b] [--force] [--out dir]
// to (re)generate. Output: public/assets/generated/audio/pack/<name>-<n>.ogg + public/assets/generated/audio/pack.json.
// kind: 'oneshot' (mono) | 'loop' (stereo bed, seamless) | 'music' (stereo seamless loop) | 'stinger' (stereo, ends).
// volume = relative game loudness (files themselves are normalised to the same loudness). Prompts cycle over the variants.
export const SPEC = [];
const add = (o) => SPEC.push(o);
// S(name, seconds, variants, volume, prompt | [prompts], extra)
const S = (name, seconds, variants, volume, prompts, o = {}) => add({ name, kind: 'oneshot', seconds, variants, volume, prompts: [].concat(prompts), ...o });
// A(name, seconds, volume, prompt, extra): seamless ambience bed
const A = (name, seconds, volume, prompt, o = {}) => add({ name, kind: 'loop', seconds, variants: 1, volume, prompts: [prompt], ...o });
// M(name, seconds, bpm, volume, prompt, extra): music loop;  T(...) stinger
const M = (name, seconds, bpm, volume, prompt, o = {}) => add({ name, kind: 'music', seconds, bpm, variants: 1, volume, prompts: [prompt], ...o });
const T = (name, seconds, bpm, volume, prompt, o = {}) => add({ name, kind: 'stinger', seconds, bpm, variants: 1, volume, prompts: [prompt], ...o });

// ---------------------------------------------------------------- weapon swings
S('swing-light', 1.0, 3, 0.55, ['A quick light whoosh of a sword swinging through the air, a short airy swish.', 'A fast thin swish of a dagger cutting through air.']);
S('swing-medium', 1.2, 3, 0.65, ['A firm whoosh of an axe or sword swung through the air, a solid airy swoosh.']);
S('swing-heavy', 1.5, 3, 0.75, ['A heavy whoosh of a huge hammer swinging through the air, a deep low-pitched swoosh.']);
S('thrust', 1.0, 2, 0.55, ['A spear thrust, a short fast whoosh of a pole weapon stabbing forward.']);
S('boomerang-whirl', 2.0, 2, 0.5, ['A wooden boomerang whirring through the air, a fluttering rotating whoosh.']);
S('weapon-throw', 1.0, 2, 0.55, ['Throwing an axe, a fast spinning whoosh and a grunt of effort without words.']);

// ---------------------------------------------------------------- melee impacts
S('slash-flesh', 1.2, 3, 0.9, ['A sword slash cutting through flesh, a wet meaty slicing hit.', 'A blade slicing into a body, a wet cut and thud.']);
S('slash-armor', 1.2, 3, 0.9, ['A sword striking metal plate armour, a sharp metallic clang and scrape.']);
S('slash-wood', 1.2, 3, 0.9, ['An axe chopping into wood, a sharp wooden thunk and crack.']);
S('slash-stone', 1.2, 3, 0.9, ['A sword striking stone, a sharp ringing scrape and metallic clink.']);
S('blunt-flesh', 1.2, 3, 0.9, ['A heavy club thumping into a body, a dull fleshy thud.']);
S('blunt-armor', 1.4, 3, 0.9, ['A warhammer smashing onto steel armour, a heavy dented metal clang with a thud.']);
S('blunt-wood', 1.2, 3, 0.9, ['A heavy hammer smashing into wood, a hollow wooden thump and crack.']);
S('blunt-stone', 1.4, 3, 0.9, ['A heavy hammer smashing against stone, a hard dense stony crack and thud.']);
S('pierce-flesh', 1.0, 3, 0.85, ['A dagger stabbing into flesh, a short wet stab and thud.']);
S('pierce-armor', 1.0, 2, 0.85, ['A spear tip striking steel armour, a sharp metallic tink and scrape.']);
S('pierce-wood', 1.0, 3, 0.85, ['A spear or arrow thunking into wood, a short sharp wooden thock.']);
S('pierce-stone', 1.0, 2, 0.85, ['A metal point striking stone, a sharp tink with a stone chip.']);
S('hit-generic', 1.0, 3, 0.8, ['A solid punch impact, a dull thud hit.']);
S('ground-slam', 2.5, 2, 1.0, ['A huge warhammer slamming into the ground, a heavy booming thud with a rumbling shockwave.']);
S('clang', 1.6, 3, 0.85, ['Two swords clashing together, a ringing metallic clang.']);
S('shield-block', 1.2, 3, 0.9, ['A blade striking a wooden shield with an iron rim, a solid dull clang and thud.']);
S('shield-bash', 1.2, 2, 0.9, ['A shield bashing into a body, a heavy wooden thud with a metallic rattle.']);
S('weapon-grab', 0.7, 3, 0.5, ['Picking up a sword by its handle, a short leather and metal rattle.']);
S('weapon-drop', 1.2, 3, 0.7, ['A sword dropping onto grass, a short metallic thud and clatter.']);

// ---------------------------------------------------------------- ranged
S('bow-draw', 1.6, 2, 0.5, ['Drawing a wooden bow, creaking wood and string tension.']);
S('arrow-loose', 1.2, 3, 0.7, ['An arrow shot from a bow, the twang of the bowstring release and a fast whoosh.']);
S('arrow-hit-flesh', 0.9, 2, 0.8, ['An arrow hitting a body, a short wet thump.']);
S('arrow-hit-ground', 0.9, 2, 0.7, ['An arrow thudding into soft earth, a short dull thunk and quiver.']);
S('crossbow-shot', 1.2, 2, 0.8, ['A crossbow firing a bolt, a sharp mechanical thwack and string snap.']);
S('crossbow-reload', 1.8, 2, 0.5, ['Cranking a crossbow, ratchet clicks and a winding creak.']);
S('blaster-shot', 1.0, 3, 0.7, ['A sci-fi laser blaster shot, a short bright pew zap with a laser tail.']);
S('blaster-heavy', 1.4, 2, 0.8, ['A powerful sci-fi energy cannon shot, a deep thick zap blast with a laser tail.']);
S('plasma-shot', 1.0, 2, 0.7, ['A plasma rifle shot, a bubbling energy burst, short.']);
S('shotgun-blast', 2.0, 3, 1.0, ['A loud shotgun blast, a deep boom with a rattling echo.']);
S('rifle-crack', 1.6, 3, 0.95, ['A single sharp rifle gunshot, a crack with a short echo.']);
S('pistol-shot', 1.4, 2, 0.9, ['A loud revolver gunshot, a sharp gun bang with a short echo.']);
S('gunshot-small', 0.8, 3, 0.7, ['A single short submachine gun gunshot, a snappy small bang.']);
S('sniper-shot', 3.0, 2, 1.0, ['A single loud gunshot from a sniper rifle, a sharp bang followed by a long echo.']);
S('rocket-launch', 2.5, 2, 1.0, ['A rocket launcher firing, a whooshing hiss of a rocket leaving the tube.']);
S('bullet-impact', 0.8, 3, 0.6, ['A bullet ricochet off a rock, a short whining ping.']);
S('grenade-pin', 1.0, 1, 0.6, ['A metal grenade pin being pulled, a click and a small ring.']);
S('grenade-beep', 0.4, 2, 0.5, ['A short electronic beep, one single beep tone.'], { single: true });
S('smoke-pop', 2.0, 2, 0.7, ['A smoke bomb popping, a soft pop and a hissing puff of smoke.']);

// ---------------------------------------------------------------- body and gore
S('limb-sever', 1.4, 3, 1.0, ['A limb being severed, a wet crunching slice and a meaty chop.']);
S('gore-squelch', 1.0, 3, 0.8, ['A wet gory squelch, flesh and blood splashing.']);
S('bone-crack', 0.9, 3, 0.8, ['A bone snapping with a sharp dry crack.']);
S('body-fall', 1.4, 3, 0.8, ['A body collapsing onto the ground, a heavy limp thump with cloth rustle.']);
S('armor-fall', 1.8, 2, 0.9, ['A knight in plate armour falling to the ground, a heavy metallic clatter and thud.']);
S('blood-splat', 0.8, 2, 0.6, ['A wet blood splatter on the ground, a short splash.']);
S('player-hurt', 1.0, 3, 0.8, ['A man grunting in pain after being hit, a short male pain grunt.']);
S('player-death', 2.2, 2, 0.8, ['A man dying, a groaning gasp and a last breath.']);
S('heartbeat', 1.8, 2, 0.7, ['A slow human heartbeat, two deep thumps, thump-thump, muffled.']);
S('humanoid-grunt', 0.9, 3, 0.6, ['A male warrior grunting with effort from a sword swing.']);
S('humanoid-hurt', 1.0, 3, 0.7, ['A man crying out in pain, a short male yelp.']);
S('humanoid-death', 2.2, 3, 0.75, ['A man shouting and dying, a drawn out male death cry.']);

// ---------------------------------------------------------------- creature voices
S('goblin-cackle', 2.5, 3, 0.8, ['A small goblin cackling with a raspy high-pitched evil laugh.', 'A goblin laughing mischievously, a creepy raspy cackle: hehehe, high-pitched and wicked.']);
S('goblin-grunt', 1.0, 3, 0.7, ['A short goblin grunt and snarl, raspy and squeaky.']);
S('goblin-death', 1.6, 2, 0.8, ['A goblin dying with a shrill squeal and a gurgle.']);
S('orc-roar', 2.6, 3, 0.9, ['A big orc roaring angrily, a deep guttural battle roar.']);
S('orc-grunt', 1.0, 3, 0.75, ['A deep orc grunt, a brutish growl.']);
S('orc-death', 2.0, 2, 0.85, ['An orc dying with a deep groan and a heavy gasp.']);
S('troll-bellow', 3.2, 2, 1.0, ['A giant troll bellowing, an enormous low rumbling roar.']);
S('troll-grunt', 1.6, 2, 0.85, ['A huge ogre grunting heavily, a deep slow growl.']);
S('skeleton-rattle', 1.6, 3, 0.7, ['Bones rattling and clacking together, a dry skeleton rattle.']);
S('skeleton-collapse', 2.2, 2, 0.85, ['A skeleton collapsing into a pile of bones, a clattering bone avalanche.']);
S('zombie-groan', 3.0, 3, 0.8, ['A zombie groaning, a low hoarse undead moan.']);
S('zombie-death', 2.2, 2, 0.8, ['A zombie moaning as it dies, a gurgling rattling exhale.']);
S('demon-growl', 2.6, 3, 0.9, ['A demon growling, a low distorted inhuman snarl.']);
S('demon-death', 2.6, 2, 0.9, ['A demon screeching in agony, a distorted shriek.']);
S('dragon-roar', 4.2, 3, 1.0, ['A massive dragon letting out a deafening monster roar, a deep growling bellow and a high screech.', 'A huge dragon roaring, a thunderous reptilian roar with a screeching top end.']);
S('dragon-wings', 3.0, 2, 0.8, ['Large leathery dragon wings flapping slowly, deep whooshing flaps.']);
S('dragon-fire-breath', 3.6, 2, 1.0, ['A dragon breathing fire, a roaring blast of flames and hissing gas.']);
S('wolf-growl', 2.0, 3, 0.75, ['A wolf growling, a low menacing snarl.']);
S('wolf-howl', 4.0, 3, 0.7, ['A lone wolf howling at night, a long mournful howl.']);
S('wolf-yelp', 1.0, 2, 0.7, ['A wolf yelping in pain, a short high yelp.']);
S('bear-roar', 3.0, 2, 0.95, ['A huge bear roaring, a deep powerful growl and roar.']);
S('spider-skitter', 2.0, 2, 0.6, ['A giant spider skittering over stone, rapid clicking legs and a hiss.']);
S('slime-squish', 1.0, 3, 0.7, ['A slime blob squishing and bouncing, a wet squishy bounce.']);
S('slime-splat', 1.2, 2, 0.8, ['A slime blob bursting, a wet splat.']);
S('ghost-wail', 4.0, 3, 0.7, ['A ghost wailing, an eerie ethereal high-pitched moan with echo.']);
S('wraith-whisper', 3.0, 2, 0.6, ['Creepy ghostly whispers, breathy hissing voices.']);
S('imp-cackle', 1.8, 2, 0.65, ['A tiny devil cackling, a high-pitched mischievous giggle.']);
S('bat-screech', 1.5, 2, 0.6, ['High-pitched bats squeaking and screeching in a cave, with fluttering wings.']);
S('robot-beep', 1.0, 2, 0.5, ['A robot beeping, two quick electronic chirps.']);
S('robot-death', 2.2, 2, 0.85, ['A robot being destroyed, electric sparks, mechanical clunks and a power-down whine.']);
S('golem-rumble', 2.6, 2, 0.9, ['A stone golem moving, grinding rock and a deep rumbling groan.']);
S('elemental-roar', 2.6, 2, 0.8, ['A fire elemental growling, a hollow roar with crackling flames.']);
S('monster-bite', 1.0, 2, 0.8, ['A monster jaws snapping shut with a crunch.']);

// ---------------------------------------------------------------- villagers and animals
S('villager-murmur', 3.0, 3, 0.5, ['Several villagers talking quietly in a crowd, an indistinct murmur of voices.']);
S('crowd-cheer', 3.0, 2, 0.7, ['A crowd cheering and clapping, a happy roar of voices.']);
S('child-giggle', 1.8, 2, 0.5, ['A little girl laughing and giggling happily.']);
S('cow-moo', 2.5, 2, 0.7, ['A cow mooing, a long low moo.']);
S('sheep-baa', 2.0, 2, 0.6, ['A sheep bleating, a baa.']);
S('pig-oink', 1.5, 2, 0.6, ['A pig oinking and snorting.']);
S('chicken-cluck', 1.5, 3, 0.55, ['A chicken clucking, short bok bok.']);
S('horse-whinny', 2.6, 2, 0.75, ['A horse whinnying, a high neigh.']);
S('cat-meow', 1.5, 2, 0.5, ['A cat meowing, a short meow.']);
S('dog-bark', 1.0, 3, 0.7, ['A dog barking loudly, woof woof.']);
S('crow-caw', 1.5, 3, 0.55, ['A crow cawing, a harsh caw.']);
S('fox-yip', 1.2, 2, 0.5, ['A fox yipping, a short high bark.']);
S('owl-hoot', 2.6, 2, 0.5, ['An owl hooting in the night, a deep hoo-hoo call.']);
S('bird-chirp', 1.6, 3, 0.4, ['A small songbird chirping and tweeting.']);
S('frog-croak', 1.6, 2, 0.4, ['A frog croaking near water.']);
S('deer-snort', 1.2, 1, 0.5, ['A deer snorting, a short breathy snort.']);

// ---------------------------------------------------------------- magic
S('fire-whoosh', 1.8, 3, 0.85, ['The roaring whoosh of a fireball flying past, crackling flames and a hot rushing wind.', 'Whoosh of fire, a burst of flame igniting and a fiery blast sound effect.', 'A fireball whooshing through the air, a burning roar of flames.']);
S('fire-cast', 1.5, 2, 0.8, ['Casting a fire spell, flames igniting in a burst.']);
S('fire-burst', 1.6, 2, 0.9, ['A fireball bursting on impact, a fiery whump with crackle.']);
A('flame-loop', 8, 0.8, 'A continuous flamethrower stream, a steady roaring fire blast.');
S('ice-cast', 1.6, 2, 0.75, ['Casting an ice spell, a cold crystalline shimmer and frosty whoosh.']);
S('ice-crack', 1.4, 3, 0.85, ['Ice cracking and shattering, a sharp crystalline crack and tinkle.']);
S('lightning-zap', 1.4, 3, 0.9, ['A sharp electric lightning zap, a crackling bolt.']);
S('chain-lightning', 2.0, 2, 0.9, ['Chains of electricity arcing between targets, crackling zaps and a buzz.']);
S('thunder-crack', 3.5, 2, 1.0, ['A thunder crack, a sharp boom followed by rolling thunder.']);
S('heal-chime', 2.6, 2, 0.7, ['A gentle magical healing chime, soft sparkling bells ascending.']);
A('heal-loop', 8, 0.6, 'A magical healing aura, bright shimmering sparkles over a warm glowing choir-like hum.');
S('teleport', 1.6, 3, 0.8, ['A magical teleport blink, a quick shimmering whoosh and a pop.']);
S('shield-hum', 2.2, 2, 0.7, ['A magical energy dome shield activating, a rising electric hum.']);
S('meteor-fall', 4.0, 2, 1.0, ['A meteor falling from the sky, a rising screaming whistle and roaring fire.']);
S('gravity-rumble', 3.6, 2, 0.9, ['A gravity well sucking things inward, a deep warping rumble and swirling vacuum.']);
A('telekinesis-hum', 8, 0.5, 'A deep magical energy hum, a pulsing telekinetic force with a low wobbling drone.');
S('summon', 2.6, 3, 0.85, ['A magical summoning spell, glowing energy swirling and a deep mystical boom as a creature appears.']);
S('force-push', 1.6, 3, 0.9, ['A powerful magical force blast, a deep booming shockwave and a rushing wind whoosh.']);
S('earth-wall', 2.6, 2, 0.9, ['A stone wall rising out of the ground, grinding and rumbling rock.']);
S('levitate', 2.0, 2, 0.6, ['An airy magical rising whoosh, a gentle lift off the ground.']);
S('conjure-orb', 1.6, 2, 0.65, ['A glowing magic orb appearing, a soft shimmering pop and hum.']);
S('magic-cast', 1.5, 3, 0.65, ['Casting a magic spell, a quick sparkling whoosh.']);
S('magic-impact', 1.2, 3, 0.8, ['A magic bolt exploding on impact, a crackling arcane burst.']);
S('arcane-bolt', 1.2, 2, 0.6, ['A magic staff firing an arcane bolt, a bright fizzing zap.']);
S('necro-bolt', 1.6, 2, 0.7, ['A dark necromancy bolt, an eerie low whispering whoosh.']);

// ---------------------------------------------------------------- destruction
S('break-wood', 1.6, 3, 0.9, ['Wooden planks splintering and cracking apart, a wood breaking crash.']);
S('break-stone', 2.2, 3, 1.0, ['Stone blocks crumbling and cracking, a rocky crash and falling rubble.']);
S('break-glass', 1.6, 3, 0.9, ['Glass shattering, a crash and tinkling shards.']);
S('break-metal', 1.8, 3, 0.9, ['Metal bending and breaking, a clanging crash and rattling pieces.']);
S('break-crystal', 1.8, 2, 0.8, ['A crystal shattering, a bright chiming crack and glittering tinkle.']);
S('break-ice', 1.6, 2, 0.85, ['A block of ice shattering, a sharp crack and falling ice chunks.']);
S('break-earth', 1.6, 2, 0.9, ['Dirt and clay breaking apart, a dull crumble and clods falling.']);
S('break-cloth', 1.0, 2, 0.5, ['Fabric ripping and tearing, a loud rip of cloth.']);
S('building-collapse', 5.5, 2, 1.0, ['A building collapsing, timber cracking and bricks crashing down in a long rumbling collapse.']);
S('tree-creak', 2.6, 2, 0.8, ['A tree trunk creaking and cracking as it begins to fall.']);
S('tree-fall', 3.6, 2, 1.0, ['A big tree crashing to the ground, rustling leaves, snapping branches and a heavy thud.']);
S('debris-thud', 0.9, 3, 0.55, ['Small rocks and wood chunks falling and bouncing on the ground.']);
S('door-creak', 2.2, 2, 0.6, ['A heavy wooden door creaking open slowly.']);
S('chest-open', 1.6, 2, 0.6, ['A wooden treasure chest opening, a creak and a coins jingle.']);
S('chain-rattle', 2.4, 2, 0.7, ['A heavy iron chain rattling and winding as a drawbridge lowers.']);

// ---------------------------------------------------------------- explosions
S('explosion-small', 2.6, 3, 0.9, ['A small explosion blast with a sharp boom and bits of debris raining down.', 'A small explosion, a sharp bang with debris scattering.']);
S('explosion-large', 4.6, 3, 1.0, ['A loud explosion blast with a deep boom, a fiery burst and rocks and debris raining down.', 'A single large explosion with a deep boom and rumbling debris.']);
S('explosion-distant', 4.0, 2, 0.8, ['A distant explosion rumbling far away, a muffled low boom.']);

// ---------------------------------------------------------------- UI
S('ui-open', 0.9, 2, 0.5, ['A soft magical menu opening, a short rising shimmer, user interface sound.']);
S('ui-close', 0.8, 2, 0.5, ['A soft magical menu closing, a short falling shimmer, user interface sound.']);
S('ui-tick', 0.3, 3, 0.35, ['A tiny soft user interface click tick.'], { single: true });
S('ui-select', 0.8, 2, 0.5, ['A gentle confirmation chime, user interface select sound.']);
S('ui-error', 0.9, 2, 0.5, ['A low dull error buzz, user interface denied sound.']);
S('quest-start', 3.0, 2, 0.7, ['A short fantasy fanfare of horns announcing a quest beginning.']);
S('quest-complete', 3.6, 2, 0.75, ['A triumphant achievement fanfare with bells, quest complete.']);
S('level-up', 3.2, 2, 0.75, ['An ascending magical shimmering level-up chime with a harp glissando.']);
S('pickup', 0.7, 3, 0.5, ['A bright coin pickup chime, a short sparkling ding.']);
S('pickup-coin', 0.7, 3, 0.5, ['A single gold coin clink.']);
S('spell-select', 0.5, 2, 0.4, ['A small magical tick, a tiny sparkle.'], { single: true });

// ---------------------------------------------------------------- footsteps
S('step-grass', 0.7, 4, 0.5, ['A single footstep on grass, a soft boot crunch.'], { single: true });
S('step-stone', 0.7, 4, 0.55, ['A single footstep on a stone floor, a hard boot tap.'], { single: true });
S('step-wood', 0.7, 4, 0.55, ['A single footstep on wooden planks, a hollow boot knock.'], { single: true });
S('step-water', 0.8, 4, 0.55, ['A single footstep splashing in shallow water.'], { single: true });
S('step-dirt', 0.7, 3, 0.5, ['A single footstep on dry dirt, a soft crunchy scuff.'], { single: true });
S('land-thud', 0.8, 2, 0.6, ['A person landing on the ground after a jump, a soft thud.'], { single: true });

// ---------------------------------------------------------------- ambience beds (seamless loops)
A('amb-night-field', 28, 0.6, 'Night in a meadow, a steady chorus of crickets chirping, a low breeze rustling the grass, a distant owl hooting.');
A('amb-forest', 28, 0.6, 'Forest ambience, birdsong, rustling leaves and a light breeze.');
A('amb-village', 28, 0.6, 'Medieval village ambience, distant chatter, a dog barking, chickens clucking, a gentle breeze.');
A('amb-tavern', 28, 0.65, 'Busy medieval tavern interior, a murmuring crowd, clinking mugs, a crackling fireplace and laughter.');
A('amb-dungeon', 28, 0.55, 'Dungeon cave ambience, slow water drips with echo, a low hollow wind and distant chains.');
A('amb-graveyard', 28, 0.55, 'Eerie graveyard at night, cold wind softly howling, creaking, a distant crow.');
A('amb-battlefield', 28, 0.6, 'A distant medieval battlefield, far-off clashing swords, shouting men, war horns and wind.');
A('amb-storm', 28, 0.7, 'Thunderstorm with heavy rain, rolling thunder and gusting wind.');
A('amb-campfire', 24, 0.55, 'A campfire crackling and popping at night.');
A('amb-lake', 28, 0.6, 'Lake shore ambience, gentle waves lapping, reeds rustling, frogs and a soft breeze.');
A('amb-wind', 28, 0.55, 'Open field in daytime, a steady breeze through the grass, distant birds.');
A('amb-rain', 28, 0.6, 'Steady rain falling on grass.');
A('omni-think', 8, 0.4, 'Soft whirring clockwork gears and a quiet thinking electronic hum, mysterious machine.');

// ---------------------------------------------------------------- the Omnissiah
S('omni-awaken', 8.0, 2, 0.9, ['A vast cosmic awakening, an enormous deep swelling drone rising with shimmering metallic overtones, sacred sci-fi.']);
S('omni-create', 4.0, 3, 0.85, ['A divine creation chord, bright shimmering ascending bell tones, harmonic and magical, resolving in a big warm chord.']);
S('omni-approve', 2.6, 2, 0.7, ['A gentle warm chord of approval, soft glowing tones.']);
S('omni-displeased', 3.0, 2, 0.8, ['A dark dissonant low rumbling drone, a menacing metallic growl.']);
S('omni-listen', 1.5, 2, 0.4, ['A subtle futuristic hum, a soft machine-angelic tone, listening.']);

// ---------------------------------------------------------------- music
M('music-calm', 64, 72, 0.7, 'calm peaceful fantasy exploration music, soft acoustic guitar and flute, warm strings, gentle, slow tempo, instrumental');
M('music-wonder', 64, 80, 0.7, 'magical wonder and discovery, shimmering harp, celesta, ethereal choir pads, awe-inspiring, orchestral, instrumental');
M('music-village', 64, 104, 0.7, 'cheerful medieval village folk music, lute, fiddle, tin whistle, hand drum, lively and warm, instrumental');
M('music-tavern', 64, 112, 0.7, 'lively tavern music, fast fiddle, bodhran drum, concertina, jolly Celtic dance, instrumental');
M('music-tension', 64, 90, 0.7, 'tense suspense music, low drones, ticking, dissonant strings, creeping dread, slow build, instrumental');
M('music-battle', 64, 144, 0.75, 'epic fantasy battle music, driving taiko drums, aggressive orchestral strings and brass, fast and intense, instrumental');
M('music-boss', 64, 120, 0.8, 'epic boss fight music, massive dark orchestra with choir, pounding percussion, heavy brass, menacing and heroic, instrumental');
M('music-night', 64, 60, 0.65, 'peaceful night music, soft piano, sparse notes, moonlit, slow, ethereal pads, instrumental');
M('music-sacred', 64, 64, 0.7, 'sacred cathedral music, majestic pipe organ, choir pads, slow, awe-inspiring, mystical machine god, instrumental');
M('music-dungeon', 64, 70, 0.65, 'dark ambient dungeon music, low cello drone, distant metallic echoes, ominous, slow, instrumental');
T('music-victory', 7, 100, 0.8, 'triumphant victory fanfare, bright brass fanfare, cymbal crash, heroic resolution, short orchestral stinger, instrumental');
T('music-defeat', 8, 60, 0.8, 'sad defeat stinger, slow somber low strings and a mournful horn, descending, dark, short, instrumental');
