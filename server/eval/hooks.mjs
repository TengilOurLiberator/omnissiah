// Node ESM resolve hook so the game's browser modules (absolute '/vendor/three/...' and '/vendor/rapier/...' specifiers,
// and '/game/...' relative to the evaluation game dir) load headlessly. Test tooling only.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('/vendor/three/')) return next(pathToFileURL(path.join(root, 'node_modules', 'three', specifier.slice(14))).href, context);
  if (specifier.startsWith('/vendor/rapier/')) return next(pathToFileURL(path.join(root, 'node_modules', '@dimforge', 'rapier3d-compat', specifier.slice(15))).href, context);
  if (specifier.startsWith('/sys/')) return next(pathToFileURL(path.join(root, 'public', specifier.slice(1))).href, context);
  if (specifier === 'three') return next(pathToFileURL(path.join(root, 'node_modules', 'three', 'build', 'three.module.js')).href, context);
  return next(specifier, context);
}

