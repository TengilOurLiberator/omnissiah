// Server-side entry for other plugins:  import { requestAudio } from '../audio/client.js'   (also re-exported by server/plugins/audio.js)
//   const r = await requestAudio({ kind: 'sfx' | 'music', prompt, seconds, loop });   // -> { url, slug } | null
// Uses the same cache (public/assets/generated/audio/{sfx,music}), the same index.json and the same WSL worker as the game protocol:
// a cached prompt answers at once, a new one is generated (3-10 s warm for a sound effect, ~1 minute cold) and cached for good.
// Resolves null on any failure (worker missing, silence, timeout); never throws. `url` is a public URL such as /assets/generated/audio/sfx/<slug>.ogg.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAudio } from './service.js';

let service = null;
export const setService = (s) => { service = s; };
export const getService = () => service;

export async function requestAudio({ kind = 'sfx', prompt, seconds, loop, seed } = {}) {
  try {
    service ??= createAudio({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), send: () => {} }); // standalone use
    const st = await service.request({ kind: kind === 'music' ? 'music' : 'sfx', prompt, seconds, loop, seed });
    if (st && st.state === 'done' && st.url) return { url: st.url, slug: path.posix.basename(st.url).replace(/\.ogg$/, '') };
    return null;
  } catch {
    return null;
  }
}
