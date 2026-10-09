// Node loader hook for test_client.mjs: the game module imports '/vendor/three/...' (an absolute URL path served by the game server); map it to node_modules.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/vendor/three/')) return next(`file:///D:/omnissiah/node_modules/three/${specifier.slice('/vendor/three/'.length)}`, context);
  return next(specifier, context);
}
