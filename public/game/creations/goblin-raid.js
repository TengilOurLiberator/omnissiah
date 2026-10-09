export const meta = { name: 'Goblin raid', description: 'A ring of goblins, archers and an orc brute rises around the player, with a sword to meet them.' };
export default function (ctx) {
  const lib = ctx.world.library;
  if (!lib) return {};
  lib.spawn(ctx, 'sword', { x: -13.4, z: -56.7 });
  lib.wave(ctx, [{ name: 'goblin', count: 5 }, { name: 'goblin-archer', count: 2 }, { name: 'skeleton', count: 2 }, { name: 'orc-brute', count: 1 }],
    { around: { x: -15.9, z: -56.9 }, radius: 11, delay: 0.4 });
  ctx.world.oracle?.setMood('wrathful');
  return { dispose() { ctx.world.oracle?.setMood('default'); } };
}
