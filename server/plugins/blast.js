// Omnissiah plugin: blast. One sentence or one picture becomes a playable scene: a place around the player with the picture's objects standing in it as
// real, grabbable, breakable props, and sound. A local port of image-blaster (FLUX.2 klein edits + Z-Image-Turbo pictures in WSL, TRELLIS.2 models via gen3d,
// the travel place pipeline, the audio plugin, and one Claude look at the picture through api.oracle.ask). See server/blast/README.md.
//
//   client { type:'blast', id, prompt | image, options:{ maxObjects (8, max 14), seed, budgetMs, force, fantasy } }   image = a file name in D:\omnissiah\input (or a path inside the game folder)
//          { type:'blast_get', id | slug }   replays the progress of a running / finished blast to this client (hot reload, late join)
//          { type:'blast_list' }             -> { type:'blast_list', projects:[{ slug, name, caption, prompt, thumb, image, created, objects, place, seconds }] }
//          { type:'blast_inputs' }           -> { type:'blast_inputs', files:[{ name, path, size }] }   the pictures waiting in the input folder
//   server { type:'blast_status', id, slug, stage, state, message, progress:{ done, total }, result }
//
// FOR OTHER PLUGINS:  import { blast } from './blast.js';   const manifest = await blast({ prompt: 'a goblin market at dusk', options: { maxObjects: 6 } });   // -> manifest | null
import fs from 'node:fs';
import path from 'node:path';
import { createBlast } from '../blast/service.js';

let shared = null;
const defaultRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

// neighbours are imported on first use, so a missing or broken one only degrades a blast
async function neighbour(spec, name) {
  try { const m = await import(spec); return typeof m[name] === 'function' ? m[name] : null; } catch (err) { console.error(`[blast] ${name} unavailable:`, err?.message ?? err); return null; }
}
export function neighbours() {
  let gm, gp, ra;
  return {
    generateModel: async (a) => { gm ??= await neighbour('../gen3d.js', 'generateModel'); return gm ? gm(a) : null; },
    generatePlace: async (a) => { gp ??= await neighbour('./travel.js', 'generatePlace'); return gp ? gp(a) : null; },
    requestAudio: async (a) => { ra ??= await neighbour('../audio/client.js', 'requestAudio'); return ra ? ra(a) : null; },
  };
}

function service(opts = {}) {
  if (!shared) shared = createBlast({ root: opts.root ?? defaultRoot, send: opts.send ?? (() => {}), log: opts.log, oracle: opts.oracle ?? null, services: neighbours() });
  return shared;
}

export async function blast({ prompt, image, options } = {}) {
  try { return await service().request({ prompt, image, options }); } catch { return null; }
}

export default async function blastPlugin(api) {
  if (shared) { try { await shared.shutdown(); } catch { /* ignore */ } shared = null; }
  const svc = service({ root: api.root, send: api.broadcast, log: (...a) => api.log('[blast]', ...a), oracle: api.oracle });
  try { fs.mkdirSync(svc.inputDir, { recursive: true }); } catch { /* ignore */ }
  const idOf = (msg) => (typeof msg?.id === 'string' || typeof msg?.id === 'number' ? msg.id : undefined);
  return {
    name: 'blast',
    messages: {
      blast: async (msg) => {
        try {
          const prompt = typeof msg?.prompt === 'string' ? msg.prompt : '';
          const image = typeof msg?.image === 'string' ? msg.image : undefined;
          svc.request({ id: idOf(msg), prompt, image, options: msg?.options && typeof msg.options === 'object' ? msg.options : {} }); // fire and forget: blast_status broadcasts
        } catch (err) { api.log('[blast] message failed:', err?.message ?? err); }
      },
      blast_get: async (msg, ws) => {
        try { svc.replay(idOf(msg), typeof msg?.slug === 'string' ? msg.slug : (idOf(msg) ?? ''), (m) => api.reply(ws, m)); } catch (err) { api.log('[blast] blast_get failed:', err?.message ?? err); }
      },
      blast_list: async (msg, ws) => { try { api.reply(ws, { type: 'blast_list', id: idOf(msg), projects: svc.list() }); } catch { /* ignore */ } },
      blast_inputs: async (msg, ws) => {
        try {
          const files = fs.readdirSync(svc.inputDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => ({ name: f, path: `input/${f}`, size: fs.statSync(path.join(svc.inputDir, f)).size }));
          api.reply(ws, { type: 'blast_inputs', id: idOf(msg), files });
        } catch { api.reply(ws, { type: 'blast_inputs', id: idOf(msg), files: [] }); }
      },
    },
    shutdown: () => svc.shutdown(),
    status: () => svc.status(),
  };
}
