// Omnissiah plugin: generated sound effects, ambience and music (local WSL worker: MOSS-SoundEffect + ACE-Step).
// Protocol (docs/CONTRACT.md, v4):  client { type:'sfx'|'music', id, prompt, seconds?, loop? }
//                                   server { type:'audio_status', id, kind, state:'queued'|'generating'|'done'|'error', url, message }
// Cache: public/assets/generated/audio/{sfx,music}/<slug>.ogg + index.json. The starter pack (pack.json) is plain static files.
// Other plugins call  requestAudio({ kind, prompt, seconds, loop }) -> Promise<{ url, slug } | null>  (see server/audio/README.md).
// Never throws into the server: a missing worker only turns into an `error` status for the asking client.
import { createAudio } from '../audio/service.js';
import { setService } from '../audio/client.js';

export { requestAudio } from '../audio/client.js';

export default async function audioPlugin(api) {
  const svc = createAudio({ root: api.root, send: api.broadcast, log: (...a) => api.log('[audio]', ...a) });
  setService(svc);
  const handle = (kind) => async (msg) => {
    try {
      if (typeof msg?.prompt !== 'string') return;
      const seconds = msg.seconds === undefined || msg.seconds === null ? undefined : Number(msg.seconds);
      // fire and forget: progress arrives as audio_status broadcasts
      svc.request({ kind, id: typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : undefined, prompt: msg.prompt, seconds, loop: msg.loop, seed: msg.seed });
    } catch (err) {
      api.log('[audio] message failed:', err?.message ?? err);
    }
  };
  return {
    name: 'audio',
    messages: { sfx: handle('sfx'), music: handle('music') },
    shutdown: () => svc.shutdown(),
    status: () => svc.status(),
  };
}
