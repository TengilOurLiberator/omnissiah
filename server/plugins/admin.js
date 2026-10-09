// server/plugins/admin.js - backend of the desktop control panel at http://localhost:8080/admin/  (see docs/ADMIN.md).
//
// HTTP is GET-only in this server, so every action is a WebSocket message with its own type, all prefixed `admin_`.
// Every request may carry `rid` (string/number); the answer is always ONE message to the asker:
//     { type:'admin_reply', rid, op:'<request type>', ok:true, data:{...} }   or   { ..., ok:false, error:'text' }
// Panels that said `admin_hello` also receive `admin_event` pushes: { kind:'player', text, ... } (every utterance the Omnissiah hears,
// typed or spoken) and { kind:'changed', op, what } after any successful write (so a second panel refreshes itself).
//
// SECURITY. Reads work from anywhere on the LAN. Every message that changes anything is refused unless
//   (1) the socket's remote address is loopback (127.0.0.1 / ::1) - unknown address = refused, and
//   (2) it carries the per-start token served at GET /admin-auth/token.json (same-origin only: a web page on another site that opens
//       ws://localhost:8080/ws from the player's browser can connect from loopback but cannot read the token).
// Files are only ever touched inside: public/game/creations, saves, input (uploads), the generated-assets folders, and .trash (never
// hard-deletes; everything removed is moved to <root>/.trash/<category>/<timestamp>__<name>). Names/slugs are whitelisted by regex AND
// matched against directory listings, never concatenated blindly.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const VERSION = 1;
export const LIMITS = {
  sourceBytes: 256 * 1024, spawnCap: 12, spawnCount: 20, uploadBytes: 12 * 1024 * 1024, chunkBytes: 1024 * 1024,
  saveKeyBytes: 256 * 1024, sayChars: 500, perfTailBytes: 400 * 1024, perfReports: 150,
};
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const CREATION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.js(\.off)?$/;
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const SAVE_KEY_RE = /^[a-z0-9_-]{1,40}$/;
const SNAP_RE = /^\d{8}-\d{9}-.{1,80}$/;
const TRASH_RE = /^(\d{8}-\d{6}(?:-\d+)?)__(.{1,120})$/;
const SPAWN_RE = /^admin-spawn-(\d+)\.js$/;
const ENTRY_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const RESERVED_RE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i; // Windows device names must never reach the file system
const QUIET_OPS =new Set(['admin_say', 'admin_upload_start', 'admin_upload_chunk']);
const ENV_NAMES =['ORACLE_EFFORT', 'ORACLE_MODEL', 'TTS_VOICE', 'PORT', 'LOCAL_PORT', 'COMMENTARY', 'ORACLE_REPAIR'];

class AdminError extends Error {}
const fail = (msg) => { throw new AdminError(msg); };
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function isLoopback(ws) {
  try {
    const a = ws?._socket?.remoteAddress;
    return typeof a === 'string' && LOOPBACK.has(a);
  } catch { return false; }
}

// -------------------------------------------------------------------------------------------- pure parsers (exported for tests)
const unesc = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, ' ').replace(/\\(['"`\\])/g, '$1');
export function parseMeta(src) {
  const m = /export\s+const\s+meta\s*=\s*\{/.exec(src);
  if (!m) return {};
  const body = src.slice(m.index + m[0].length, m.index + m[0].length + 2000);
  const grab = (key) => {
    const r = new RegExp('(?:^|[\\s,{])' + key + '\\s*:\\s*([\'"`])((?:\\\\.|(?!\\1)[^\\\\\\n])*)\\1').exec(body);
    return r ? unesc(r[2]) : undefined;
  };
  const out = {};
  const name = grab('name'), description = grab('description');
  if (name !== undefined) out.name = name.slice(0, 80);
  if (description !== undefined) out.description = description.slice(0, 300);
  return out;
}

export function parseLibrary(text) {
  const entries = [];
  const categories = [];
  let cat = null;
  let inCatalogue = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith('//')) { if (/^export\s/.test(line)) break; continue; }
    if (!inCatalogue) { if (/^\/\/ CATALOGUE\b/.test(line)) inCatalogue = true; continue; }
    const e = /^\/\/ {3}([a-z0-9][a-z0-9-]*) - (.*)$/.exec(line);
    if (e && cat) {
      let desc = e[2].trim();
      let options = '';
      if (desc.endsWith(')')) { // the option list is the LAST balanced (...) group
        let depth = 0, i = desc.length - 1;
        for (; i >= 0; i--) { if (desc[i] === ')') depth++; else if (desc[i] === '(' && --depth === 0) break; }
        if (i > 0) { options = desc.slice(i + 1, -1).trim(); desc = desc.slice(0, i).trim(); }
      }
      entries.push({ name: e[1], category: cat.id, description: desc, options });
      cat.count++;
      continue;
    }
    const c = /^\/\/ ([A-Z][A-Z &/-]+?)(?: \((.*)\))?\s*$/.exec(line);
    if (c) { cat = { id: c[1].toLowerCase().replace(/[^a-z]+/g, '-'), title: c[1][0] + c[1].slice(1).toLowerCase(), note: c[2] ?? '', count: 0 }; categories.push(cat); }
  }
  const declared = Number(/^\/\/ CATALOGUE\s+(\d+) entries/m.exec(String(text))?.[1]);
  return { entries, categories, declared: Number.isFinite(declared) ? declared : null };
}

// One perf-reports.log block -> numbers. Report text format: see core/perf.js report().
export function parsePerfLog(text, max = LIMITS.perfReports) {
  const reports = [];
  const parts = String(text).split(/^=== /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const head = (nl < 0 ? part : part.slice(0, nl)).replace(/ ===\s*$/, '');
    const body = nl < 0 ? '' : part.slice(nl + 1).replace(/\s+$/, '');
    const hm = /^(\S+) client=(\S*) reason=(.*?) level=(\S*) xr=(\S*) hz=(\S*)$/.exec(head);
    if (!hm) continue;
    const t = Date.parse(hm[1]);
    const num = (re) => { const r = re.exec(body); return r ? Number(r[1]) : null; };
    reports.push({
      t: Number.isFinite(t) ? t : null, time: hm[1], client: hm[2], reason: hm[3].slice(0, 80), level: hm[4] === '?' ? null : Number(hm[4]),
      xr: hm[5] === 'yes', hz: hm[6] === '?' ? null : Number(hm[6]),
      fps: num(/\bfps ([\d.]+)/), p95: num(/\bp95 ([\d.]+)/), p99: num(/\bp99 ([\d.]+)/), frameMs: num(/\bema ([\d.]+)ms/),
      draws: num(/draws\/eye (\d+)/), trisK: num(/tris\/eye (\d+)k/), cpuMs: num(/\bcpu ([\d.]+)ms/), text: body.slice(0, 6000),
    });
  }
  const out = reports.slice(-max);
  for (let i = 0; i < out.length - 12; i++) out[i].text = ''; // only the newest reports carry their raw text
  return out;
}

function detectImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// -------------------------------------------------------------------------------------------- plugin
export default async function adminPlugin(api) {
  const { root, publicDir, cacheDir } = api;
  const log = (...a) => { try { (api.log ?? console.log)('[admin]', ...a); } catch { /* ignore */ } };
  const creationsDir = path.join(publicDir, 'game', 'creations');
  const libraryFile = path.join(publicDir, 'game', 'core', 'library.js');
  const genDir = path.join(publicDir, 'assets', 'generated');
  const savesDir = path.join(root, 'saves');
  const inputDir = path.join(root, 'input');
  const trashDir = path.join(root, '.trash');
  const snapsDir = path.join(root, '.snapshots');
  const logFile = path.join(cacheDir, 'perf-reports.log');
  const authDir = path.join(cacheDir, 'admin-auth');
  const startedAt = Date.now();

  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, 'token.json'), JSON.stringify({ token }));
  } catch (err) { log('cannot write the auth token (writes will be refused):', err.message); }

  const panels = new Set();
  const settingsFile = path.join(cacheDir, 'admin-settings.json'); // NOT in authDir: that folder is served over HTTP
  let lastContext = null;
  let lastSayAt = 0;
  const uploads = new WeakMap();

  // ------------------------------------------------------------ helpers
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const stampNow = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
  const within = (base, p) => { const rel = path.relative(base, p); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
  const statOrNull = (p) => { try { return fs.lstatSync(p); } catch { return null; } };
  const isFileNoLink = (p) => { const st = statOrNull(p); return !!st && st.isFile() && !st.isSymbolicLink(); };
  const listDir = (p) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  function writeAtomic(file, data) {
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); } catch (err) { try { fs.unlinkSync(tmp); } catch { /* none */ } throw err; }
  }
  function movePath(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(from, to); } catch (err) {
      if (err.code !== 'EXDEV' && err.code !== 'EPERM') throw err;
      fs.cpSync(from, to, { recursive: true }); fs.rmSync(from, { recursive: true, force: true });
    }
  }
  function uniqueIn(dir, name) { // name -> name, name-2 ... that does not exist (keeps the extension(s) at the end)
    if (!fs.existsSync(path.join(dir, name))) return name;
    const m = /^(.*?)((?:\.js)?(?:\.off)?|\.[A-Za-z0-9]+)$/.exec(name);
    const base = m ? m[1] : name, ext = m ? m[2] : '';
    for (let i = 2; i < 500; i++) if (!fs.existsSync(path.join(dir, `${base}-${i}${ext}`))) return `${base}-${i}${ext}`;
    return fail('too many copies of that name');
  }
  function toTrash(category, absFrom, label) {
    let stamp = stampNow();
    let dest = path.join(trashDir, category, `${stamp}__${label}`);
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(trashDir, category, `${stamp}-${i}__${label}`);
    movePath(absFrom, dest);
    return path.relative(root, dest).split(path.sep).join('/');
  }

  const toPanels = (msg) => {
    for (const ws of [...panels]) {
      if (ws.readyState !== 1) { panels.delete(ws); continue; }
      api.reply(ws, msg);
    }
  };
  const ridOf = (msg) => (typeof msg?.rid === 'string' || typeof msg?.rid === 'number' ? String(msg.rid).slice(0, 40) : null);
  const reply = (ws, rid, op, ok, payload) => api.reply(ws, ok ? { type: 'admin_reply', rid, op, ok: true, data: payload ?? {} } : { type: 'admin_reply', rid, op, ok: false, error: String(payload) });

  function denied(ws, msg) {
    if (!isLoopback(ws)) return 'Read-only here: changes are only accepted from the PC that runs the game.';
    const given = typeof msg?.token === 'string' ? Buffer.from(msg.token) : Buffer.alloc(0);
    const want = Buffer.from(token);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return 'Missing or stale admin token: reload the panel.';
    return null;
  }
  // reads: any client. writes: loopback + token.
  const handler = (op, write, fn) => async (msg, ws) => {
    const rid = ridOf(msg);
    try {
      if (write) { const why = denied(ws, msg); if (why) return reply(ws, rid, op, false, why); }
      const data = await fn(msg ?? {}, ws);
      reply(ws, rid, op, true, data);
      if (write && !QUIET_OPS.has(op)) toPanels({ type: 'admin_event', kind: 'changed', op, what: op.replace(/^admin_/, '').split('_')[0] });
    } catch (err) {
      if (err instanceof AdminError) return reply(ws, rid, op, false, err.message);
      log(`${op} failed:`, err?.stack ?? err);
      reply(ws, rid, op, false, 'Internal error (see the server log).');
    }
  };

  // ------------------------------------------------------------ creations
  function creationPath(name, { mustExist = true } = {}) {
    if (typeof name !== 'string' || !CREATION_RE.test(name) || name.includes('..') || RESERVED_RE.test(name)) fail('Bad creation name.');
    const p = path.join(creationsDir, name);
    if (path.dirname(p) !== creationsDir) fail('Bad creation name.');
    if (mustExist && !isFileNoLink(p)) fail('No such creation.');
    return p;
  }
  function readHead(p, bytes) {
    const fd = fs.openSync(p, 'r');
    try { const b = Buffer.alloc(bytes); const n = fs.readSync(fd, b, 0, bytes, 0); return b.toString('utf8', 0, n); } finally { fs.closeSync(fd); }
  }
  function trashEntries() {
    const out = [];
    for (const e of listDir(path.join(trashDir, 'creations'))) {
      const m = TRASH_RE.exec(e.name);
      if (!m || !e.isFile()) continue;
      const st = statOrNull(path.join(trashDir, 'creations', e.name));
      out.push({ id: e.name, stamp: m[1], name: m[2], size: st?.size ?? 0 });
    }
    return out.sort((a, b) => (a.id < b.id ? 1 : -1));
  }
  function listCreations() {
    let loaded = null;
    try { loaded = new Set(api.files.listModules().map((m) => m.path)); } catch { /* no files service */ }
    const items = [];
    for (const e of listDir(creationsDir)) {
      if (!e.isFile() || !CREATION_RE.test(e.name)) continue;
      const p = path.join(creationsDir, e.name);
      const st = statOrNull(p);
      if (!st || !st.isFile()) continue;
      let meta = {};
      try { meta = parseMeta(readHead(p, 16384)); } catch { /* unreadable */ }
      const enabled = e.name.endsWith('.js');
      items.push({
        name: e.name, enabled, size: st.size, mtime: Math.floor(st.mtimeMs), meta,
        // null = unknown (no files service); false = enabled but excluded from /api/modules (syntax error or the watcher has not caught up yet)
        loaded: enabled && loaded ? loaded.has(`creations/${e.name}`) : null,
        spawn: SPAWN_RE.test(e.name),
      });
    }
    items.sort((a, b) => (a.name < b.name ? -1 : 1));
    return { items, trash: trashEntries(), spawnCap: LIMITS.spawnCap, spawnCount: items.filter((i) => i.spawn && i.enabled).length };
  }

  const creationOps = {
    admin_creations: handler('admin_creations', false, () => listCreations()),
    admin_creation_get: handler('admin_creation_get', false, (msg) => {
      const p = creationPath(msg.name);
      const st = fs.statSync(p);
      const fd = fs.openSync(p, 'r');
      try {
        const n = Math.min(st.size, LIMITS.sourceBytes);
        const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, 0);
        return { name: msg.name, text: b.toString('utf8'), truncated: st.size > n, size: st.size };
      } finally { fs.closeSync(fd); }
    }),
    admin_creation_disable: handler('admin_creation_disable', true, (msg) => {
      const p = creationPath(msg.name);
      if (!msg.name.endsWith('.js')) fail('Already disabled.');
      const to = creationPath(`${msg.name}.off`, { mustExist: false });
      if (fs.existsSync(to)) fail('A disabled copy with that name already exists.');
      fs.renameSync(p, to);
      return { name: `${msg.name}.off` };
    }),
    admin_creation_enable: handler('admin_creation_enable', true, (msg) => {
      const p = creationPath(msg.name);
      if (!msg.name.endsWith('.js.off')) fail('Already enabled.');
      const newName = msg.name.slice(0, -4);
      const to = creationPath(newName, { mustExist: false });
      if (fs.existsSync(to)) fail('An enabled creation with that name already exists.');
      fs.renameSync(p, to);
      return { name: newName };
    }),
    admin_creation_remove: handler('admin_creation_remove', true, (msg) => {
      const p = creationPath(msg.name);
      return { trashed: toTrash('creations', p, msg.name) };
    }),
    admin_creation_duplicate: handler('admin_creation_duplicate', true, (msg) => {
      const p = creationPath(msg.name);
      const m = /^(.*?)(\.js(?:\.off)?)$/.exec(msg.name);
      const copy = uniqueIn(creationsDir, `${m[1].replace(/-copy(-\d+)?$/, '')}-copy${m[2]}`);
      const to = creationPath(copy, { mustExist: false });
      fs.copyFileSync(p, to, fs.constants.COPYFILE_EXCL);
      return { name: copy };
    }),
    admin_trash: handler('admin_trash', false, () => ({ creations: trashEntries() })),
    admin_trash_restore: handler('admin_trash_restore', true, (msg) => {
      const entry = trashEntries().find((t) => t.id === msg.id); // matched against the real listing: no path ever comes from the client
      if (!entry) fail('That item is no longer in the trash.');
      if (!CREATION_RE.test(entry.name)) fail('That trash item has an unusual name; restore it by hand from .trash.');
      const name = uniqueIn(creationsDir, entry.name);
      fs.renameSync(path.join(trashDir, 'creations', entry.id), creationPath(name, { mustExist: false }));
      return { name };
    }),
  };

  // ------------------------------------------------------------ snapshots (list + copy ONE creation back; whole-game restore is the game's own /undo)
  function snapshotList() {
    const items = [];
    for (const e of listDir(snapsDir)) {
      if (!e.isDirectory() || !SNAP_RE.test(e.name)) continue;
      const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\d{3})-(.*)$/.exec(e.name);
      const t = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]).getTime() : null;
      const creations = listDir(path.join(snapsDir, e.name, 'creations')).filter((f) => f.isFile() && CREATION_RE.test(f.name)).map((f) => f.name).sort();
      items.push({ id: e.name, label: m ? m[8] : e.name, t, creations });
    }
    items.sort((a, b) => (a.id < b.id ? 1 : -1));
    const current = new Set(listDir(creationsDir).filter((f) => f.isFile()).map((f) => f.name));
    for (const s of items) {
      const inSnap = new Set(s.creations);
      s.removedSince = s.creations.filter((n) => !current.has(n));
      s.addedSince = [...current].filter((n) => CREATION_RE.test(n) && !inSnap.has(n)).sort();
    }
    return items;
  }
  const snapshotOps = {
    admin_snapshots: handler('admin_snapshots', false, () => ({ items: snapshotList(), canRestoreAll: false })),
    admin_snapshot_restore_creation: handler('admin_snapshot_restore_creation', true, (msg) => {
      const snap = snapshotList().find((s) => s.id === msg.snapshot);
      if (!snap) fail('No such snapshot.');
      if (!snap.creations.includes(msg.name)) fail('That creation is not in the snapshot.');
      const src = path.join(snapsDir, snap.id, 'creations', msg.name);
      if (!isFileNoLink(src)) fail('That file cannot be read.');
      const name = uniqueIn(creationsDir, msg.name);
      fs.copyFileSync(src, creationPath(name, { mustExist: false }), fs.constants.COPYFILE_EXCL);
      return { name };
    }),
  };

  // ------------------------------------------------------------ library + spawn
  // The catalogue comment in core/library.js is the primary source. When it lists fewer things than the folder game/library/*.js defines
  // (the header is being slimmed to save prompt tokens), the missing names are read from those files' def('name', 'description', 'options') calls.
  const libDir = path.join(publicDir, 'game', 'library');
  function libraryFromFiles() {
    const out = [];
    for (const e of listDir(libDir)) {
      if (!e.isFile() || !e.name.endsWith('.js')) continue;
      let src = ''; try { src = readHead(path.join(libDir, e.name), 400 * 1024); } catch { continue; }
      const defCat = /const def = [^\n]*?category: '([a-z]+)'/.exec(src)?.[1];
      const str = String.raw`'((?:\\.|[^'\\])*)'`;
      if (defCat) for (const m of src.matchAll(new RegExp(String.raw`\bdef\(\s*'([a-z0-9-]+)'\s*,\s*${str}(?:\s*,\s*${str})?`, 'g'))) out.push({ name: m[1], category: defCat, description: unesc(m[2]).slice(0, 200), options: unesc(m[3] ?? '').slice(0, 120) });
      for (const m of src.matchAll(new RegExp(String.raw`lib\.add\(\{\s*name:\s*'([a-z0-9-]+)',\s*category:\s*'([a-z]+)',\s*description:\s*${str}(?:,\s*options:\s*${str})?`, 'g'))) out.push({ name: m[1], category: m[2], description: unesc(m[3]).slice(0, 200), options: unesc(m[4] ?? '').slice(0, 120) });
    }
    return out;
  }
  let libCache = { key: '', data: { entries: [], categories: [] } };
  function library() {
    try {
      const key = [libraryFile, ...listDir(libDir).map((e) => path.join(libDir, e.name))].map((f) => statOrNull(f)?.mtimeMs ?? 0).join('|');
      if (key !== libCache.key) {
        const data = parseLibrary(readHead(libraryFile, 96 * 1024));
        const have = new Set(data.entries.map((e) => e.name));        for (const e of libraryFromFiles()) {
          if (have.has(e.name)) continue;
          have.add(e.name); data.entries.push(e);
          let c = data.categories.find((x) => x.id === e.category);
          if (!c) { c = { id: e.category, title: e.category[0].toUpperCase() + e.category.slice(1), note: '', count: 0 }; data.categories.push(c); }
          c.count++;
        }
        // things that game/library builds from lists at load time (the weapon types, ...) cannot be read as text
        data.unlisted = data.declared ? Math.max(0, data.declared - data.entries.length) : 0;
        data.entries.sort((a, b) => data.categories.findIndex((c) => c.id === a.category) - data.categories.findIndex((c) => c.id === b.category));
        libCache = { key, data };
      }
    } catch { libCache = { key: '', data: { entries: [], categories: [] } }; }
    return libCache.data;
  }
  const spawnFiles = () => listDir(creationsDir).filter((e) => e.isFile() && SPAWN_RE.test(e.name)).map((e) => e.name);
  const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const spawnOps = {
    admin_library: handler('admin_library', false, () => ({ ...library(), spawnCap: LIMITS.spawnCap, spawnCount: spawnFiles().length })),
    admin_spawn: handler('admin_spawn', true, (msg) => {
      const entry = String(msg.name ?? '');
      if (!ENTRY_RE.test(entry)) fail('Bad library name.');
      const lib = library();
      if (lib.entries.length && !lib.entries.some((e) => e.name === entry)) fail('That is not in the library catalogue.');
      const existing = spawnFiles();
      if (existing.length >= LIMITS.spawnCap) fail(`Already ${existing.length} admin spawns (the cap is ${LIMITS.spawnCap}). Clear them first.`);
      const used = new Set(existing.map((n) => Number(SPAWN_RE.exec(n)[1])));
      let n = 1; while (used.has(n)) n++;
      const opts = { count: Math.round(clampNum(msg.count, 1, LIMITS.spawnCount, 1)) };
      if (msg.spread !== undefined) opts.spread = clampNum(msg.spread, 0, 40, 4);
      if (msg.scale !== undefined) opts.scale = clampNum(msg.scale, 0.2, 5, 1);
      const file = `admin-spawn-${n}.js`;
      const src = [
        `// Spawned from the admin panel (${new Date().toISOString()}). Safe to delete: Creations tab > Clear admin spawns.`,
        `export const meta = { name: ${JSON.stringify('Admin spawn: ' + entry)}, description: ${JSON.stringify('Spawned from the admin panel: ' + entry + (opts.count > 1 ? ' x' + opts.count : ''))} };`,
        'export default function (ctx) {',
        '  let handle = null, tried = false;',
        '  return {',
        '    update() {',
        '      if (tried) return;',
        '      const lib = ctx.world.library;',
        '      if (!lib) return;',
        '      tried = true;',
        `      try { handle = lib.spawn(ctx, ${JSON.stringify(entry)}, ${JSON.stringify(opts)}); } catch (err) { console.warn('admin spawn failed', err); }`,
        '    },',
        '    dispose() { try { handle?.remove?.(); } catch { /* already gone */ } },',
        '  };',
        '}', '',
      ].join('\n');
      fs.mkdirSync(creationsDir, { recursive: true });
      fs.writeFileSync(creationPath(file, { mustExist: false }), src, { flag: 'wx' });
      return { name: file, count: existing.length + 1 };
    }),
    admin_spawn_clear: handler('admin_spawn_clear', true, () => {
      const names = spawnFiles();
      for (const n of names) toTrash('creations', creationPath(n), n);
      return { cleared: names.length };
    }),
  };

  // ------------------------------------------------------------ generated assets
  const ASSET_KINDS = {
    model: { index: () => path.join(genDir, 'index.json') },
    place: { index: () => path.join(genDir, 'places', 'index.json'), dir: () => path.join(genDir, 'places') },
    blast: { index: () => path.join(genDir, 'blasts', 'index.json'), dir: () => path.join(genDir, 'blasts') },
    sfx: { index: () => path.join(genDir, 'audio', 'sfx', 'index.json'), files: () => path.join(genDir, 'audio', 'sfx') },
    music: { index: () => path.join(genDir, 'audio', 'music', 'index.json'), files: () => path.join(genDir, 'audio', 'music') },
  };
  const assetOps = {
    admin_asset_delete: handler('admin_asset_delete', true, (msg) => {
      const kind = ASSET_KINDS[msg.kind];
      if (!kind || !Object.hasOwn(ASSET_KINDS, msg.kind)) fail('Unknown asset kind.');
      const slug = msg.slug;
      if (typeof slug !== 'string' || !SLUG_RE.test(slug) || slug.includes('..') || RESERVED_RE.test(slug) || slug === 'index.json' || slug === 'pack') fail('Bad asset name.');
      const indexFile = kind.index();
      let index = null; // a missing index is fine (loose files); a present-but-unreadable one is never overwritten
      if (fs.existsSync(indexFile)) { index = readJson(indexFile); if (!isObj(index)) fail('The asset index is unreadable; nothing was changed.'); }
      const hasEntry = !!index && Object.hasOwn(index, slug);
      const targets = []; // absolute paths to move
      if (kind.dir) { // places / blasts: one folder per slug
        const d = path.join(kind.dir(), slug);
        const st = statOrNull(d);
        if (st?.isDirectory() && !st.isSymbolicLink()) targets.push(d);
      } else { // models live loose in genDir; sfx/music in their folder: <slug>.<ext> (+ .static.glb)
        const base = kind.files ? kind.files() : genDir;
        for (const e of listDir(base)) {
          if (e.isFile() && e.name !== 'index.json' && e.name.startsWith(slug + '.') && /^[A-Za-z0-9.]+$/.test(e.name.slice(slug.length + 1))) targets.push(path.join(base, e.name));
        }
      }
      if (!hasEntry && !targets.length) fail('No such asset.');
      const stamp = stampNow();
      let bundle = path.join(trashDir, 'assets', `${stamp}__${msg.kind}__${slug}`);
      for (let i = 2; fs.existsSync(bundle); i++) bundle = path.join(trashDir, 'assets', `${stamp}-${i}__${msg.kind}__${slug}`);
      fs.mkdirSync(bundle, { recursive: true });
      const moved = [];
      for (const t of targets) {
        if (!within(genDir, t)) fail('Refusing a path outside the generated-assets folder.');
        movePath(t, path.join(bundle, 'files', path.relative(genDir, t)));
        moved.push(path.relative(genDir, t).split(path.sep).join('/'));
      }
      fs.writeFileSync(path.join(bundle, 'restore.json'), JSON.stringify({ kind: msg.kind, slug, entry: hasEntry ? index[slug] : null, moved, note: 'Move files/* back under public/assets/generated and re-add "entry" to the index to restore.' }, null, 2));
      if (hasEntry) { delete index[slug]; writeAtomic(indexFile, JSON.stringify(index, null, 2)); }
      return { moved: moved.length, trashed: path.relative(root, bundle).split(path.sep).join('/') };
    }),
    admin_assets_present: handler('admin_assets_present', false, () => ({ // which indexes exist at all (the page also fetches them over HTTP)
      model: fs.existsSync(ASSET_KINDS.model.index()), place: fs.existsSync(ASSET_KINDS.place.index()), blast: fs.existsSync(ASSET_KINDS.blast.index()),
      sfx: fs.existsSync(ASSET_KINDS.sfx.index()), music: fs.existsSync(ASSET_KINDS.music.index()), pack: fs.existsSync(path.join(genDir, 'audio', 'pack.json')),
    })),
  };

  // ------------------------------------------------------------ saves
  const saveFile = (key) => path.join(savesDir, `${key}.json`);
  function readSave(key) {
    for (const f of [saveFile(key), `${saveFile(key)}.bak`]) { const v = readJson(f); if (v !== null) return v; }
    return null;
  }
  const saveKeys = () => listDir(savesDir).filter((e) => e.isFile() && e.name.endsWith('.json') && SAVE_KEY_RE.test(e.name.slice(0, -5))).map((e) => e.name.slice(0, -5));
  function writeSave(key, data) {
    const text = JSON.stringify(data);
    if (typeof text !== 'string' || Buffer.byteLength(text) > LIMITS.saveKeyBytes) fail(`"${key}" is too large or not JSON.`);
    fs.mkdirSync(savesDir, { recursive: true });
    const file = saveFile(key);
    if (isFileNoLink(file)) { // keep the previous version in the trash AND as the plugin-style .bak
      fs.mkdirSync(path.join(trashDir, 'saves'), { recursive: true });
      fs.copyFileSync(file, path.join(trashDir, 'saves', `${stampNow()}__${key}.json`));
      try { JSON.parse(fs.readFileSync(file, 'utf8')); fs.copyFileSync(file, `${file}.bak`); } catch { /* corrupt: keep the old .bak */ }
    }
    writeAtomic(file, text);
  }
  const saveOps = {
    admin_save_export: handler('admin_save_export', false, (msg) => {
      const keys = {};
      const wanted = msg.key !== undefined ? [msg.key] : saveKeys();
      for (const k of wanted.slice(0, 64)) { if (!SAVE_KEY_RE.test(String(k))) fail('Bad save key.'); const v = readSave(k); if (v !== null) keys[k] = v; }
      return { bundle: { format: 'omnissiah-save', version: 1, exported: new Date().toISOString(), keys }, keys: saveKeys() };
    }),
    admin_save_import: handler('admin_save_import', true, (msg) => {
      let b = msg.bundle;
      if (!isObj(b)) fail('Nothing to import.');
      if (b.format !== 'omnissiah-save') b = { format: 'omnissiah-save', version: 1, keys: { profile: b } }; // a bare profile.json is fine too
      if (!isObj(b.keys)) fail('Not an Omnissiah save file.');
      const entries = Object.entries(b.keys);
      if (!entries.length || entries.length > 64) fail('The save file has no (or too many) entries.');
      for (const [k, v] of entries) {
        if (!SAVE_KEY_RE.test(k)) fail(`Bad save key "${String(k).slice(0, 20)}".`);
        if (k === 'profile' && (!isObj(v) || !Number.isFinite(Number(v.xp ?? 0)))) fail('The profile in that file does not look like an Omnissiah profile.');
        if (Buffer.byteLength(JSON.stringify(v) ?? '') > LIMITS.saveKeyBytes) fail(`"${k}" is larger than ${LIMITS.saveKeyBytes / 1024} KB.`);
      }
      const now = Date.now();
      for (const [k, v] of entries) {
        const data = k === 'profile' ? { ...v, updated: now } : v; // newer than the running game's copy, so a connected game adopts it
        writeSave(k, data);
        api.broadcast({ type: 'save_data', key: k, data });
      }
      return { imported: entries.map(([k]) => k) };
    }),
    admin_save_reset: handler('admin_save_reset', true, () => {
      const now = Date.now();
      const data = { v: 1, id: crypto.randomBytes(4).toString('hex'), created: now, updated: now, lastSeen: now, xp: 0, level: 1 }; // the game fills in the rest
      writeSave('profile', data);
      api.broadcast({ type: 'save_data', key: 'profile', data });
      return { reset: true };
    }),
  };

  // ------------------------------------------------------------ perf log
  const perfOps = {
    admin_perf: handler('admin_perf', false, (msg) => {
      const max = Math.round(clampNum(msg.max, 1, LIMITS.perfReports, LIMITS.perfReports));
      const tail = (file) => {
        const st = statOrNull(file);
        if (!st || !st.isFile()) return '';
        const n = Math.min(st.size, LIMITS.perfTailBytes);
        const fd = fs.openSync(file, 'r');
        try { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); return (n < st.size ? b.toString('utf8').replace(/^[^\n]*\n/, '') : b.toString('utf8')); } finally { fs.closeSync(fd); }
      };
      let reports = parsePerfLog(tail(logFile), max);
      if (reports.length < 5) reports = parsePerfLog(tail(logFile + '.1') + '\n' + tail(logFile), max); // just rotated
      const st = statOrNull(logFile);
      return { reports, exists: !!st, size: st?.size ?? 0 };
    }),
  };

  // ------------------------------------------------------------ pictures for the blast plugin
  function dropUpload(ws) { uploads.delete(ws); }
  const uploadOps = {
    admin_inputs: handler('admin_inputs', false, () => ({
      files: listDir(inputDir).filter((e) => e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)).map((e) => ({ name: e.name, path: `input/${e.name}`, size: statOrNull(path.join(inputDir, e.name))?.size ?? 0 })),
    })),
    admin_upload_start: handler('admin_upload_start', true, (msg, ws) => {
      const size = Number(msg.size);
      if (!Number.isFinite(size) || size < 12) fail('That file is empty.');
      if (size > LIMITS.uploadBytes) fail(`Pictures can be at most ${LIMITS.uploadBytes / 1048576} MB.`);
      const base = String(msg.name ?? 'picture').replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'picture';
      uploads.set(ws, { base, size, chunks: [], bytes: 0, next: 0, at: Date.now() });
      if (typeof ws?.once === 'function') ws.once('close', () => dropUpload(ws));
      return { chunkBytes: LIMITS.chunkBytes };
    }),
    admin_upload_chunk: handler('admin_upload_chunk', true, (msg, ws) => {
      const u = uploads.get(ws);
      if (!u) fail('No upload in progress.');
      if (msg.seq !== u.next) { dropUpload(ws); fail('Chunks arrived out of order.'); }
      if (typeof msg.data !== 'string' || msg.data.length > Math.ceil(LIMITS.chunkBytes * 4 / 3) + 8) { dropUpload(ws); fail('Chunk too large.'); }
      const buf = Buffer.from(msg.data, 'base64');
      if (u.bytes + buf.length > u.size || u.bytes + buf.length > LIMITS.uploadBytes) { dropUpload(ws); fail('More data than announced.'); }
      u.chunks.push(buf); u.bytes += buf.length; u.next++; u.at = Date.now();
      return { received: u.bytes };
    }),
    admin_upload_end: handler('admin_upload_end', true, (msg, ws) => {
      const u = uploads.get(ws);
      dropUpload(ws);
      if (!u) fail('No upload in progress.');
      if (u.bytes !== u.size) fail('The upload was incomplete.');
      const buf = Buffer.concat(u.chunks, u.bytes);
      const ext = detectImage(buf);
      if (!ext) fail('That is not a PNG, JPEG or WebP picture.');
      fs.mkdirSync(inputDir, { recursive: true });
      const name = uniqueIn(inputDir, `${u.base}.${ext}`);
      fs.writeFileSync(path.join(inputDir, name), buf, { flag: 'wx' });
      return { name, path: `input/${name}`, size: buf.length };
    }),
  };

  // ------------------------------------------------------------ server log lines worth showing ([stt], [client], [commentary]) + commentary switch
  // The server only console.logs these, so the plugin watches console.log/error (passing everything through untouched) and keeps the last few.
  const LOG_RE = /^\[(stt|client|commentary)\]\s*(.*)$/s;
  const logRing = [];
  let lastHeard = null;
  function noteLog(args) {
    try {
      const first = args[0];
      if (typeof first !== 'string' || first.charCodeAt(0) !== 91) return;
      const m = LOG_RE.exec(args.map((a) => (typeof a === 'string' ? a : a?.message ?? '')).join(' ').slice(0, 600));
      if (!m) return;
      const entry = { t: Date.now(), tag: m[1], line: m[2].replace(/[\p{Cc}\p{Cf}]/gu, ' ').slice(0, 400) };
      logRing.push(entry); if (logRing.length > 80) logRing.shift();
      const h = m[1] === 'stt' ? /^([\d.]+)s of audio, peak ([\d.]+) -> (.*)$/s.exec(entry.line) : null;
      if (h) {
        let text = h[3]; try { text = JSON.parse(h[3]); } catch { /* "(silence)" and friends */ }
        lastHeard = { t: entry.t, seconds: Number(h[1]), peak: Number(h[2]), text: String(text).slice(0, 300), empty: /^\(/.test(h[3]) };
        toPanels({ type: 'admin_event', kind: 'heard', heard: lastHeard });
      }
      toPanels({ type: 'admin_event', kind: 'log', entry });
    } catch { /* logging must never break the server */ }
  }
  const origLog = console.log, origError = console.error;
  const wrapLog = (orig) => function (...args) { noteLog(args); return orig.apply(this, args); };
  const myLog = wrapLog(origLog), myError = wrapLog(origError);
  console.log = myLog; console.error = myError;

  const envAtStart = process.env.COMMENTARY ?? null;
  { // a switch made on the panel survives restarts (the env var itself cannot)
    const s = readJson(settingsFile);
    if (isObj(s) && (s.commentary === 'on' || s.commentary === 'off')) process.env.COMMENTARY = s.commentary;
  }
  const commentaryOn = () => process.env.COMMENTARY !== 'off';

  // ------------------------------------------------------------ cheat sheet: everything already made
  function spellTable() { // built-in id -> wheel category, from the CAT_IDS table at the top of core/spells.js
    const out = {};
    try {
      const src = readHead(path.join(publicDir, 'game', 'core', 'spells.js'), 16384);
      const block = /const CAT_IDS = \{([\s\S]*?)\n\};/.exec(src)?.[1] ?? '';
      for (const m of block.matchAll(/^\s*([a-z]+):\s*'([^']+)'/gm)) for (const id of m[2].split(/\s+/)) out[id] = m[1];
    } catch { /* no table: everything is utility */ }
    return out;
  }
  function scanSpells(items) {
    const table = spellTable();
    const spells = [];
    for (const it of items) {
      let src = ''; try { src = readHead(path.join(creationsDir, it.name), 65536); } catch { continue; }
      for (const m of src.matchAll(/spells\??\.register\(\s*\{/g)) {
        const body = src.slice(m.index + m[0].length, m.index + m[0].length + 1800);
        const grab = (key) => { const r = new RegExp('(?:^|[\\s,{])' + key + '\\s*:\\s*([\'"`])((?:\\\\.|(?!\\1)[^\\\\\\n])*)\\1').exec(body); return r ? unesc(r[2]) : undefined; };
        const id = grab('id'); if (!id || !/^[a-z0-9-]{1,40}$/i.test(id)) continue;
        const cat = (grab('category') ?? table[id] ?? 'utility').toLowerCase();
        spells.push({ id, name: (grab('name') ?? id).slice(0, 60), description: (grab('description') ?? '').slice(0, 200), icon: (grab('icon') ?? '').slice(0, 8), category: cat === 'defense' ? 'defence' : cat, file: it.name, enabled: it.enabled });
      }
    }
    const seen = new Set();
    return spells.filter((s) => (seen.has(s.id) ? false : seen.add(s.id)));
  }
  function questSummary() {
    const p = readSave('profile');
    if (!isObj(p) || !isObj(p.q)) return [];
    const defs = { ...(isObj(p.offered) ? p.offered : {}), ...(isObj(p.gen) ? p.gen : {}) };
    return Object.entries(p.q).slice(0, 80).map(([id, q]) => ({ id, state: String(q?.s ?? '?'), title: String(defs[id]?.title ?? id).slice(0, 80), kind: defs[id]?.kind ?? null }));
  }
  const indexRows = (file, pick) => { const j = readJson(file); return isObj(j) ? Object.entries(j).slice(0, 300).map(([slug, v]) => ({ slug, ...pick(isObj(v) ? v : {}) })) : []; };
  const cheatOps = {
    admin_cheatsheet: handler('admin_cheatsheet', false, () => {
      const { items } = listCreations();
      const spells = scanSpells(items);
      const spellFiles = new Set(spells.map((s) => s.file));
      const lib = library();
      const str = (v, n = 160) => (typeof v === 'string' ? v.slice(0, n) : '');
      return {
        spells,
        creations: items.filter((i) => !spellFiles.has(i.name) && !i.spawn).map((i) => ({ name: i.name, title: i.meta?.name ?? '', description: i.meta?.description ?? '', enabled: i.enabled })),
        libraryUnlisted: lib.unlisted ?? 0,
        library: lib.categories.map((c) => ({ id: c.id, title: c.title, names: lib.entries.filter((e) => e.category === c.id).map((e) => e.name) })),
        places: indexRows(path.join(genDir, 'places', 'index.json'), (v) => ({ name: str(v.name, 80), prompt: str(v.prompt) })),
        blasts: indexRows(path.join(genDir, 'blasts', 'index.json'), (v) => ({ name: str(v.name, 80), prompt: str(v.prompt), caption: str(v.caption) })),
        models: indexRows(path.join(genDir, 'index.json'), (v) => ({ prompt: str(v.prompt) })).slice(-60),
        quests: questSummary(),
      };
    }),
    admin_logs: handler('admin_logs', false, () => ({ lines: logRing.slice(-80), heard: lastHeard })),
    admin_commentary: handler('admin_commentary', true, (msg) => {
      if (typeof msg.on !== 'boolean') fail('Say on or off.');
      process.env.COMMENTARY = msg.on ? 'on' : 'off';
      try { writeAtomic(settingsFile, JSON.stringify({ commentary: process.env.COMMENTARY })); } catch (err) { log('could not remember the commentary setting:', err.message); }
      return { commentary: commentaryOn() };
    }),
  };

  // ------------------------------------------------------------ session
  function sttInfo() { // what server/stt.js exposes through api.services.stt: { last, gpu }
    const s = api.services?.stt;
    if (!s) return null;
    const g = isObj(s.gpu) ? s.gpu : null, l = isObj(s.last) ? s.last : null;
    return {
      gpu: g ? { state: String(g.state ?? '?'), lastError: g.lastError ? String(g.lastError).slice(0, 200) : null, port: g.port ?? null } : null,
      last: l ? { seconds: Number(l.seconds) || 0, peak: Number(l.peak) || 0, silent: !!l.silent, backend: String(l.backend ?? 'none'), ms: Number(l.ms) || 0 } : null,
      envBackend: process.env.STT_BACKEND ?? null, lang: process.env.STT_LANG ?? null,
    };
  }
  const envInfo =() => Object.fromEntries(ENV_NAMES.map((k) => [k, process.env[k] ?? null]));
  const pluginNames = () => listDir(path.join(root, 'server', 'plugins')).filter((e) => e.isFile() && e.name.endsWith('.js')).map((e) => e.name.slice(0, -3)).sort();
  const clientsInfo = () => { try { const c = api.clients?.(); return Array.isArray(c) ? c : null; } catch { return null; } }; // optional hook, see docs/ADMIN.md
  const status = () => ({
    now: Date.now(), startedAt, panels: [...panels].filter((w) => w.readyState === 1).length, clients: clientsInfo(),
    busy: !!api.oracle?.busy, lastContext, stt: sttInfo(), heard: lastHeard, commentary: commentaryOn(), commentaryEnv: envAtStart,
  });
  const sessionOps = {
    admin_hello: handler('admin_hello', false, (_msg, ws) => {
      panels.add(ws);
      if (typeof ws?.once === 'function') ws.once('close', () => panels.delete(ws));
      return { version: VERSION, loopback: isLoopback(ws), env: envInfo(), plugins: pluginNames(), node: process.version, limits: LIMITS, ...status() };
    }),
    admin_status: handler('admin_status', false, () => status()),
    admin_say: handler('admin_say', true, async (msg) => {
      const text = String(msg.text ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.sayChars);
      if (!text) fail('Nothing to say.');
      if (Date.now() - lastSayAt < 1200) fail('Slow down a moment.');
      lastSayAt = Date.now();
      let audio = null;
      try { audio = await api.services?.tts?.synthesize?.(text, { voice: 'omnissiah' }); } catch (err) { log('tts failed:', err?.message ?? err); }
      if (!audio && api.sapiTts && api.sapiTts !== api.services?.tts) { try { audio = await api.sapiTts.synthesize(text); } catch { /* silent */ } }
      api.broadcast({ type: 'speak', text, audio: audio ?? null }); // exactly what the server's own speak() sends
      return { audio: !!audio };
    }),
  };

  const messages = { ...sessionOps, ...creationOps, ...snapshotOps, ...spawnOps, ...assetOps, ...saveOps, ...perfOps, ...uploadOps, ...cheatOps };

  return {
    name: 'admin',
    messages,
    routes: [{ prefix: '/admin-auth/', dir: authDir, cache: 'no-store' }],
    // Called for every player utterance (typed or heard). Never consumes: it only tells open panels what was said.
    async utterance(text, context) {
      try {
        const fromPanel = !!(isObj(context) && context.admin);
        if (isObj(context) && !fromPanel) lastContext = { t: Date.now(), player: context.player ?? null, aimPoint: context.aimPoint ?? null, modules: Array.isArray(context.modules) ? context.modules.length : null, npc: isObj(context.npc) ? String(context.npc.name ?? context.npc.id ?? '').slice(0, 40) : null };
        toPanels({ type: 'admin_event', kind: 'player', text: String(text).slice(0, 2000), t: Date.now(), source: fromPanel ? 'panel' : 'game', npc: isObj(context?.npc) ? String(context.npc.name ?? context.npc.id ?? '').slice(0, 40) : null, lastContext });
      } catch { /* never break the game */ }
      return false;
    },
    status,
    async shutdown() {
      panels.clear();
      if (console.log === myLog) console.log = origLog; // only unwrap if nobody wrapped us since
      if (console.error === myError) console.error = origError;
    },
    _test: { token, dirs: { creationsDir, genDir, savesDir, inputDir, trashDir, snapsDir } },
  };
}
