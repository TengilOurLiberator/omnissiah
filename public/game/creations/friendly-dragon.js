export const meta = { name: 'Friendly dragon', description: 'A large friendly dragon that follows the player and defends them.' };
export default function (ctx) {
  const lib = ctx.world.library;
  if (!lib) return {};
  lib.spawn(ctx, 'dragon-whelp', { faction: 'friendly', scale: 1.6, hp: 200, x: -55.5, z: -115, name: 'Ember' });
  ctx.world.oracle?.flare(0x44ff88, 1);
  return {};
}
