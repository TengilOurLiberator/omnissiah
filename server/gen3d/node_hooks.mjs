// Node ESM resolve hook so the game's own browser modules (absolute '/vendor/three/...' specifiers) load headlessly. Test tooling only.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/vendor/three/')) return next(pathToFileURL(path.join(root, 'node_modules', 'three', specifier.slice(14))).href, context);
  if (specifier === 'three') return next(pathToFileURL(path.join(root, 'node_modules', 'three', 'build', 'three.module.js')).href, context);
  return next(specifier, context);
}
