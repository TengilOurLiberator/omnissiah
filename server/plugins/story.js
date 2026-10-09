// server/plugins/story.js - authored lines in the Omnissiah's own voice, with NO AI call (the campaign and the intro use it).
//
//   client -> { type: 'say_as_omnissiah', id, text }
//   server -> broadcast { type: 'speak', text, audio, scripted: id }   (exactly what his improvised speech sends: the client plays and subtitles it the same way)
//          -> to the asking socket only, when a line is refused: { type: 'say_dropped', id, reason: 'rate' | 'empty' }  (the client then reads the line itself)
//
// The line is synthesised through api.services.tts.synthesize(text, { voice: 'omnissiah' }) (the plugin voice when present, else SAPI), exactly as server/index.js does for
// his own replies. Lines are queued in order, one at a time, and wait politely while the oracle is mid-turn (api.oracle.busy), up to POLITE_MS, so an authored line never
// talks over an improvised one. Limits: MAX_LEN characters per line, at most BURST lines in any WINDOW_MS window per socket, QUEUE_MAX waiting lines in all.
const MAX_LEN = 360;
const WINDOW_MS = 20000;
const BURST = 8;
const QUEUE_MAX = 12;
const POLITE_MS = 25000;
const POLL_MS = 150;

export default async function (api) {
  const log = (...a) => { try { (api.log ?? console.log)(...a); } catch { /* ignore */ } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stats = { said: 0, dropped: 0, waitedBusy: 0, fallbacks: 0 };
  const recent = new WeakMap();         // socket -> [timestamps]
  const anon = [];                      // timestamps for callers without a socket
  let queued = 0;
  let chain = Promise.resolve();
  let epoch = 0;                        // bumped by say_cancel: lines queued before it are dropped unsaid

  function clean(text) {
    let t = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[<>`*_#\\]/g, '').replace(/\s+/g, ' ').trim();
    if (t.length > MAX_LEN) {
      const cut = t.slice(0, MAX_LEN);
      const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
      t = end > MAX_LEN * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '...';
    }
    return t;
  }

  function allowed(ws) {
    const now = Date.now();
    const arr = ws ? (recent.get(ws) ?? (recent.set(ws, []), recent.get(ws))) : anon;
    while (arr.length && now - arr[0] > WINDOW_MS) arr.shift();
    if (arr.length >= BURST) return false;
    arr.push(now);
    return true;
  }

  async function waitPolite() {
    const t0 = Date.now();
    let waited = false;
    while (api.oracle?.busy && Date.now() - t0 < POLITE_MS) { waited = true; await sleep(POLL_MS); }
    if (waited) stats.waitedBusy++;
  }

  async function synth(text) {
    let audio = null;
    try { audio = await api.services?.tts?.synthesize?.(text, { voice: 'omnissiah' }); } catch (err) { log('[story] tts failed:', err?.message ?? err); }
    if (!audio && api.sapiTts && api.sapiTts !== api.services?.tts) {
      stats.fallbacks++;
      try { audio = await api.sapiTts.synthesize(text); } catch (err) { log('[story] SAPI failed:', err?.message ?? err); }
    }
    return audio || null;
  }

  async function speakOne(text, id, e) {
    if (e !== epoch) return;
    await waitPolite();
    if (e !== epoch) return;
    const audio = await synth(text);
    if (e !== epoch) return;
    api.broadcast({ type: 'speak', text, audio, scripted: id ?? null });
    stats.said++;
  }

  const messages = {
    async say_as_omnissiah(msg, ws) {
      const id = msg && (typeof msg.id === 'string' || typeof msg.id === 'number') ? msg.id : null;
      const text = clean(msg?.text);
      const drop = (reason) => { stats.dropped++; api.reply?.(ws, { type: 'say_dropped', id, reason }); };
      if (!text) return drop('empty');
      if (queued >= QUEUE_MAX || !allowed(ws)) return drop('rate');
      queued++;
      const e = epoch;
      const job = chain.then(() => speakOne(text, id, e)).catch((err) => { log('[story] line failed:', err?.message ?? err); })
        .finally(() => { queued--; });
      chain = job;
      await job;
    },
    // client -> { type: 'say_cancel' }: the player skipped a scripted sequence; forget every line still waiting.
    async say_cancel() { epoch++; },
  };

  return {
    name: 'story',
    messages,
    status: () => ({ ...stats, queued }),
    _internals: { clean, MAX_LEN, BURST, WINDOW_MS },
  };
}
