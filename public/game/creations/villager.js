export const meta = { name: 'Villager', description: 'A villager from the library who lives near the campfire, at (-3.2, -18.1).' };
export default function (ctx) {
  ctx.world.library?.spawn(ctx, 'villager', { x: -3.22, z: -18.13 });
  return {};
}
