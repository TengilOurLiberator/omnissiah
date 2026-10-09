// server/plugins/save.js - persistence for the player's profile (and any other small JSON the client wants to keep).
//
//   client -> { type: 'save_get', key }          server -> { type: 'save_data', key, data }   (data: null when nothing is stored)
//   client -> { type: 'save_set', key, data }    server -> { type: 'save_ack',  key, ok, error? }   (extra; clients may ignore it)
//
// Files live in <root>/saves/<key>.json. Keys are restricted to [a-z0-9_-]{1,40}; one value may be at most MAX_BYTES of JSON.
// Writes are debounced per key (a burst collapses into the last value), atomic (temp file + rename) and keep ONE backup
// (<key>.json.bak = the version that was on disk before the latest write). A corrupt main file falls back to the backup.
// Reads see values that are still waiting to be written. Nothing here ever throws into the server.
import fs from 'node:fs';
import path from 'node:path';

export const KEY_RE = /^[a-z0-9_-]{1,40}$/;
export const MAX_BYTES = 256 * 1024;
const DEBOUNCE_MS = 400;
const MAX_KEYS = 64;

export default async function (api) {
  const dir = path.join(api.root, 'saves');
  const log = (...a) => { try { (api.log ?? console.log)(...a); } catch { /* ignore */ } };
  try { fs.mkdirSync(dir, { recursive: true }); } catch (err) { log('[save] cannot create saves dir:', err.message); }

  const fileOf = (key) => path.join(dir, `${key}.json`);
  const pending = new Map();   // key -> { text, timer }
  const chains = new Map();    // key -> Promise (writes of one key are serialised)
  let seq = 0;

  const reply = (ws, msg) => { try { api.reply?.(ws, msg); } catch { /* socket gone */ } };

  function knownKeys() {
    try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { return []; }
  }

  async function renameRetry(from, to) {
    // Windows can briefly refuse a rename over a file that antivirus or an indexer is touching.
    let lastErr;
    for (let i = 0; i < 6; i++) {
      try { await fs.promises.rename(from, to); return; } catch (err) {
        lastErr = err;
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) break;
        await new Promise((r) => setTimeout(r, 25 * (i + 1)));
      }
    }
    throw lastErr;
  }

  async function writeAtomic(key, text) {
    const file = fileOf(key);
    const tmp = `${file}.tmp-${process.pid}-${++seq}`;
    try {
      const fh = await fs.promises.open(tmp, 'w');
      try { await fh.writeFile(text, 'utf8'); await fh.sync().catch(() => {}); } finally { await fh.close(); }
      // keep the previous version as .bak, but never replace a good backup with a corrupt file
      try {
        const prev = await fs.promises.readFile(file, 'utf8');
        JSON.parse(prev);
        await fs.promises.writeFile(`${file}.bak`, prev, 'utf8');
      } catch { /* no previous version (or it was already corrupt): keep whatever backup exists */ }
      await renameRetry(tmp, file);
    } catch (err) {
      try { await fs.promises.unlink(tmp); } catch { /* already gone */ }
      throw err;
    }
  }

  function enqueueWrite(key, text) {
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.then(() => writeAtomic(key, text)).catch((err) => { log(`[save] write of "${key}" failed:`, err?.message ?? err); });
    chains.set(key, next);
    next.finally(() => { if (chains.get(key) === next) chains.delete(key); });
    return next;
  }

  function flushKey(key) {
    const p = pending.get(key);
    if (!p) return chains.get(key) ?? Promise.resolve();
    clearTimeout(p.timer);
    pending.delete(key);
    return enqueueWrite(key, p.text);
  }

  async function flushAll() {
    const keys = [...pending.keys()];
    await Promise.all(keys.map(flushKey));
    await Promise.all([...chains.values()]);
  }

  function schedule(key, text) {
    const old = pending.get(key);
    if (old) clearTimeout(old.timer);
    const timer = setTimeout(() => { flushKey(key); }, DEBOUNCE_MS);
    timer.unref?.();
    pending.set(key, { text, timer });
  }

  async function readValue(key) {
    const p = pending.get(key);
    if (p) { try { return { data: JSON.parse(p.text), from: 'pending' }; } catch { /* fall through to disk */ } }
    await (chains.get(key) ?? Promise.resolve()); // an in-flight write finishes first
    for (const [file, from] of [[fileOf(key), 'main'], [`${fileOf(key)}.bak`, 'backup']]) {
      try {
        const text = await fs.promises.readFile(file, 'utf8');
        return { data: JSON.parse(text), from };
      } catch (err) {
        if (err.code !== 'ENOENT' && from === 'main') log(`[save] "${key}" unreadable (${err.message}); trying the backup`);
      }
    }
    return { data: null, from: 'none' };
  }

  const validKey = (k) => typeof k === 'string' && KEY_RE.test(k);

  return {
    name: 'save',
    messages: {
      async save_get(msg, ws) {
        try {
          if (!validKey(msg?.key)) return reply(ws, { type: 'save_data', key: String(msg?.key ?? '').slice(0, 40), data: null, error: 'bad key' });
          const { data, from } = await readValue(msg.key);
          reply(ws, { type: 'save_data', key: msg.key, data, ...(from === 'backup' ? { recovered: true } : {}) });
        } catch (err) {
          log('[save] save_get failed:', err?.message ?? err);
          reply(ws, { type: 'save_data', key: String(msg?.key ?? '').slice(0, 40), data: null, error: 'read failed' });
        }
      },
      async save_set(msg, ws) {
        const key = msg?.key;
        const fail = (error) => reply(ws, { type: 'save_ack', key: String(key ?? '').slice(0, 40), ok: false, error });
        try {
          if (!validKey(key)) return fail('bad key');
          if (msg.data === undefined) return fail('no data');
          let text;
          try { text = JSON.stringify(msg.data); } catch { return fail('not serialisable'); }
          if (typeof text !== 'string') return fail('not serialisable');
          if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return fail('too large');
          if (!pending.has(key) && !fs.existsSync(fileOf(key)) && knownKeys().length + pending.size >= MAX_KEYS) return fail('too many keys');
          schedule(key, text);
          reply(ws, { type: 'save_ack', key, ok: true });
        } catch (err) {
          log('[save] save_set failed:', err?.message ?? err);
          fail('write failed');
        }
      },
    },
    async shutdown() { try { await flushAll(); } catch (err) { log('[save] flush on shutdown failed:', err?.message ?? err); } },
    // test hooks
    flush: flushAll,
    dir,
  };
}
