// Omnissiah plugin: travel. Generated places (a 360 panorama + the world state derived from it) through the local WSL worker
// (Z-Image-Turbo, 127.0.0.1:18780, started lazily, stopped when idle). See server/travel/README.md.
// Protocol (docs/CONTRACT.md, v4):  client { type:'place', id, prompt, options?:{ seed, hi:'fast'|'refine', slug, name, spec, image, fov, horizonY } }
//   server { type:'place_status', id, state:'queued'|'dreaming'|'done'|'error', message, slug, url, hi, preview, meta, progress? }
// options.image = absolute path (under the game folder) of a PNG / JPG / WebP: the panorama is built AROUND it (it is what the player sees
// straight ahead, fov ~80 degrees unless options.fov says otherwise; options.horizonY = where the horizon sits in the picture, 0..1 from the top).
// Cache: public/assets/generated/places/<slug>/ + places/index.json (the starter atlas ships there; plain static files).
// Never throws into the server: a missing worker only turns into an `error` status for the asking client.
//
// FOR OTHER PLUGINS:  import { generatePlace } from './travel.js';
//   const r = await generatePlace({ prompt: 'a ruined chapel at dusk', image: 'D:\\omnissiah\\...\\plate.png', options: { seed: 4, name: 'Chapel', spec: { terrain: 'hills' } } });
//   -> { slug, url, hi, preview, meta, cached } | null      (same queue, cache and worker as the player's requests; never throws; null = failed, see api.log)
//   then show it with  world.travel.go({ place: r.slug, dressing: [...] })  on the client (the place is a cached place now).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTravel } from '../travel/service.js';

let shared = null; // the service of the loaded plugin (or a lazily made one when generatePlace is used before / without the plugin)
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function service(send, log, root) {
  if (!shared) shared = createTravel({ root: root ?? defaultRoot, send: send ?? (() => {}), log: log ?? ((...a) => console.log('[travel]', ...a)) });
  return shared;
}

export async function generatePlace({ prompt, image, options } = {}) {
  try {
    const svc = service();
    const opts = Object.assign({}, options && typeof options === 'object' ? options : {});
    if (image) opts.image = image;
    const r = await svc.request({ id: `gp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`, prompt: String(prompt ?? (image ? 'a place' : '')), options: opts });
    if (!r || r.state !== 'done') return null;
    return { slug: r.slug, url: r.url, hi: r.hi, preview: r.preview, meta: r.meta, cached: /known/i.test(r.message ?? '') };
  } catch (err) {
    console.error('[travel] generatePlace failed:', err?.message ?? err);
    return null;
  }
}

export default async function travelPlugin(api) {
  if (shared) { try { await shared.shutdown(); } catch { /* ignore */ } shared = null; } // a lazily made one without the broadcast
  const svc = service(api.broadcast, (...a) => api.log('[travel]', ...a), api.root);
  return {
    name: 'travel',
    messages: {
      place: async (msg) => {
        try {
          if (typeof msg?.prompt !== 'string') return;
          const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : undefined;
          // fire and forget: progress arrives as place_status broadcasts
          svc.request({ id, prompt: msg.prompt, options: msg.options });
        } catch (err) {
          api.log('[travel] message failed:', err?.message ?? err);
        }
      },
    },
    shutdown: () => svc.shutdown(),
    status: () => svc.status(),
  };
}
