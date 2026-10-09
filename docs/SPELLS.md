# Spells (40)

One line per spell: what it does and how it plays. Files are `public/game/creations/spell-<id>.js`; each registers itself with
`world.spells` (see the header of `core/spells.js`). Controls: right trigger casts; right A taps to cycle or holds to open the wheel
(8 wedges: six categories, favourites, recent — the pointed wedge fans its spells out; star up to 3 favourites); desktop: mouse = right hand, E = A. **(hold)** = continuous: cast runs
every frame while the trigger is held. All damage goes through `kit.hit` / `kit.explosion` with `from: 'player'`, so it never hurts
you or your allies. In mixed reality every spell shrinks and stays close (and giants / hand-held teleports are disabled).

## The original 15

- **Firebolt** (`firebolt`) — a fast fiery bolt that explodes on impact; hold the trigger to auto-repeat.
- **Fire Stream** (`fire-stream`, hold) — a flamethrower cone with scorching damage ticks and ground embers.
- **Frost Lance** (`frost-lance`) — a piercing ice shard that chills what it passes through: slowed and encased in ice.
- **Chain Lightning** (`chain-lightning`) — a bolt that arcs from target to target (and crawls over the grass).
- **Force Push** (`force-push`) — a shockwave cone that shoves bodies and throws fighters; tracked hand: thrust an open palm.
- **Gravity Well** (`gravity-well`) — a singularity pulls in bodies, ragdolls and enemies for 3 s, then bursts.
- **Meteor** (`meteor`) — a contracting ring marks the ground, then a meteor falls and detonates (telegraphed).
- **Earth Wall** (`earth-wall`) — a row of stone slabs erupts, launching what stood there, and blocks for 20 s.
- **Arcane Shield** (`arcane-shield`) — a hex dome around you; invulnerable for 8 s, ripples where attacks land.
- **Blink** (`blink`) — teleport to where you point (a wall stops you short), with a flash.
- **Levitate** (`levitate`) — toggle flight: left stick flies along your gaze, right stick / B go up and down.
- **Healing Light** (`heal`, hold) — green motes spiral up while it restores you and nearby allies.
- **Conjure Orb** (`conjure-orb`) — summon a glowing physics orb you can grab and throw (hurts enemies).
- **Summon Familiar** (`summon-familiar`) — a spirit-hound that follows you and fights for 75 s (max 3).
- **Telekinesis** (`telekinesis`, hold) — lift a physics object at range, steer it with your aim, release to fling it.

## The new 25

Offence
- **Life Drain** (`life-drain`, hold) — a crimson tether to the enemy in your sights; it takes magic damage, you heal 60% of what it lost.
- **Sun Beam** (`sun-beam`, hold + release) — a gold ring and a thin shaft swell while you charge; release and a column of sunlight drops there (follows your aim, burns, ends in a blast). Tracked hand: raise an open palm to charge, lower it to fire.
- **Storm Cloud** (`storm-cloud`) — a thunderhead trails you for 18 s; it rings an enemy near you, rumbles, then the bolt lands (shock damage + shove).
- **Rune Trap** (`rune-trap`) — ink a glyph on the ground (up to 4); it arms in 1 s, flares when an enemy steps near and detonates; neighbours chain. Tracked hand: press a flat palm toward the floor.
- **Venom Flask** (`venom-flask`) — lob a physics flask that lands where you point and bursts into a 9 s poison cloud: damage ticks and enemies slowed to 45%.
- **Blade Whirl** (`blade-whirl`) — three spectral blades orbit you for 14 s slicing anything near; recast for a wide 5 m sweep.
- **Fissure** (`fissure`) — a crack races 24 m along the ground; every 1.5 m the earth heaves, throwing enemies, crates and ragdolls; the scar glows then cools.

Control
- **Time Bubble** (`time-bubble`) — a clock-sphere where fighters, arrows and loose bodies run at 15% speed for 10 s; you stay at full speed.
- **Mind Charm** (`mind-charm`) — an enemy joins your side (real faction flip) for 20 s, a heart over its head; bosses resist; it reverts afterwards.
- **Polymorph** (`polymorph`) — an enemy becomes a big chicken for 12 s, then returns with the same health fraction; kill the chicken and it stays dead.
- **Petrify** (`petrify`, hold) — keep your gaze on an enemy for 1.5 s: it stiffens into a statue for 7 s; any heavy blow shatters it for 30 bonus damage.
- **Vine Snare** (`vine-snare`) — thorny vines grow in a patch: enemies are rooted (12% speed), hauled to the middle and pricked for 10 s.
- **Tornado** (`tornado`) — a wandering funnel that sucks bodies, ragdolls and debris into a rising spiral and batters enemies for 9 s.
- **Anti-Gravity Field** (`anti-gravity`) — a sphere where bodies and ragdolls drift upward for 12 s and you jump like on the moon.
- **Shrink Ray** (`shrink-ray`) — zap an enemy to 40% size (weaker, faster) for 15 s; aim at your own feet to become a 2.6x giant whose steps stomp.

Movement
- **Grappling Hook** (`grapple`) — a claw on a rope reels you to where you point (physics raycast: walls, trees, ground); hook an enemy and yank it to you.
- **Ice Path** (`ice-path`) — freeze a 16 m road: you accelerate along it (up to 8 m/s), enemies skate helplessly down it.
- **Sky Disc** (`sky-disc`, hold) — a disc carries you; hold the trigger to fly where your hand points; aim straight down and pull to land.
- **Rewind** (`rewind`) — return to where you stood 5 s ago with at least the health you had then.

Defence and summoning
- **Mirror Images** (`mirror-images`) — three translucent copies of you run around for 14 s; enemies already chasing you are redirected to them.
- **Wall of Force** (`wall-of-force`, hold, two hands) — a panel as wide as the gap between your hands hangs ahead; release to make it solid for 10 s: blocks bodies, walkers and hostile projectiles.
- **Arcane Turret** (`arcane-turret`) — a floating crystal shoots the nearest enemy within 18 m for 22 s (real combat projectiles); enemies can destroy it.
- **Spirit Wolves** (`spirit-wolves`) — three wolves each hunt a different enemy, bite up to three times and vanish in a howl.

Utility and play
- **Light Orb** (`light-orb`) — a companion light that follows you (brighter at night, amber when enemies are near); aim at ground to park it, sky to recall, your feet to snuff.
- **Bloom Brush** (`bloom-brush`, hold) — paint the ground with flowers and toadstools; standing among them heals you slowly.

## Added later

- **Swap Places** (`swap-places`, control) — point at any fighter and trade places with it in a violet flash: you land where it stood, it lands where you were, dizzy for 1.2 s. Mixed reality: the target is yanked to arm's length instead (your living room never moves).
