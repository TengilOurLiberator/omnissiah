// Test context handed to every scenario: page driving, console/network collection, checks, screenshots, polling.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchEdge, Page, sleep } from './cdp.mjs';
import { ROOT, LOCAL_PORT } from './server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INJECT = fs.readFileSync(path.join(HERE, 'inject.js'), 'utf8');
const PAGEHELPERS = fs.readFileSync(path.join(HERE, 'pagehelpers.js'), 'utf8');
export const WORK = { width: 640, height: 360 };

export class Session {
  // One headless Edge + one tab. Reused across scenarios (each scenario navigates to a fresh game page).
  constructor({ outDir, tier, edgePort }) { this.outDir = outDir; this.tier = tier; this.edgePort = edgePort; this.console = []; this.network = []; this.models = []; this.glbReq = new Map(); this.requests = 0; }
  async start(viewport = { width: 1280, height: 720 }) {
    this.profile = path.join(ROOT, '.cache', 'qa', `profile-${process.pid}-${this.tier}`);
    this.edge = await launchEdge({ profileDir: this.profile, port: this.edgePort, ...viewport });
    this.page = await Page.connect(this.edgePort);
    const p = this.page;
    const push = (kind, text, extra = {}) => this.console.push({ t: Date.now(), kind, text: String(text).slice(0, 2000), ...extra });
    p.on('Runtime.consoleAPICalled', (e) => {
      const text = e.args.map((a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description ?? a.type))).join(' ');
      push(e.type, text, { url: e.stackTrace?.callFrames?.[0]?.url, line: e.stackTrace?.callFrames?.[0]?.lineNumber });
    });
    p.on('Runtime.exceptionThrown', (e) => {
      const d = e.exceptionDetails;
      push('exception', d.exception?.description ?? d.text, { url: d.url, line: d.lineNumber });
    });
    p.on('Log.entryAdded', (e) => push(`log-${e.entry.level}`, e.entry.text + (e.entry.url ? ` (${e.entry.url})` : ''), { url: e.entry.url, source: e.entry.source }));
    p.on('Network.requestWillBeSent', (e) => { this.requests++; if (/\.(glb|gltf)(\?|#|$)/i.test(e.request?.url ?? '')) this.glbReq.set(e.requestId, e.request.url); });
    p.on('Network.loadingFailed', (e) => { if (!e.canceled) this.network.push({ t: Date.now(), kind: 'failed', id: e.requestId, error: e.errorText, type: e.type }); });
    p.on('Network.responseReceived', (e) => {
      if (e.response.status >= 400) this.network.push({ t: Date.now(), kind: 'http', status: e.response.status, url: e.response.url, type: e.type });
      if (/\.(glb|gltf)(\?|#|$)/i.test(e.response.url)) this.models.push({ t: Date.now(), status: e.response.status, url: e.response.url });
    });
    p.on('Network.loadingFailed', (e) => { const u = this.glbReq.get(e.requestId); if (u && !e.canceled) this.models.push({ t: Date.now(), status: 0, url: u, error: e.errorText }); });
    await p.send('Runtime.enable'); await p.send('Log.enable'); await p.send('Network.enable'); await p.send('Page.enable');
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
    await p.send('Emulation.setDeviceMetricsOverride', { width: WORK.width, height: WORK.height, deviceScaleFactor: 1, mobile: false });
  }
  async stop() {
    try { this.page?.close(); } catch { /* ignore */ }
    try { if (this.edge && !this.edge.exited) execFileSync('taskkill', ['/PID', String(this.edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    await sleep(800);
    // kill leftover children of OUR edge (crashpad/gpu/renderer) via the profile dir marker is not possible; Windows edge --headless
    // exits its children with the browser process. Remove our profile dir.
    try { fs.rmSync(this.profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export class T {
  constructor({ session, scenario, dir, tier }) {
    this.s = session; this.page = session.page; this.scenario = scenario; this.dir = dir; this.tier = tier;
    this.checks = []; this.shots = []; this.notes = []; this.data = {}; this.startedAt = Date.now();
    fs.mkdirSync(dir, { recursive: true });
  }
  log(...a) { console.log(`   [${this.scenario.id}/${this.tier}]`, ...a); }
  note(text) { this.notes.push(text); this.log('note:', text); }
  // check(name, ok, detail, sev) - sev is the severity of the bug if this fails: 'P0' | 'P1' | 'P2'
  check(name, ok, detail = '', sev = 'P1') {
    this.checks.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 1500), sev: ok ? undefined : sev });
    this.log(ok ? 'PASS' : `FAIL(${sev})`, name, ok ? '' : String(detail).slice(0, 300));
    return !!ok;
  }
  async eval(expr, opts) { return this.page.eval(expr, opts); }
  // evaluate a function body (statements, may await, may `return`) in the page.
  async run(body, opts) { return this.page.eval(`(async () => { ${body} })()`, opts); }
  async shot(label) {
    const prev = await this.page.eval('(() => ({ mode: __qa.mode, render: __qa.render }))()');
    await this.page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await this.page.eval('__qa.setMode(\'real\'); __qa.setRender(true)');
    await this.frames(3, 90000);
    const file = path.join(this.dir, `${String(this.shots.length + 1).padStart(2, '0')}-${label.replace(/[^a-z0-9_.-]+/gi, '_')}.png`);
    try { await this.page.screenshot(file); this.shots.push(path.relative(path.dirname(path.dirname(path.dirname(this.dir))), file).replace(/\\/g, '/')); } catch (e) { this.note('screenshot failed: ' + e.message); }
    await this.page.send('Emulation.setDeviceMetricsOverride', { width: WORK.width, height: WORK.height, deviceScaleFactor: 1, mobile: false });
    await this.page.eval(`__qa.setMode(${JSON.stringify(prev.mode)}); __qa.setRender(${prev.render})`);
    return file;
  }
  mark() { return { c: this.s.console.length, n: this.s.network.length, m: this.s.models.length }; }
  // console entries since mark that are errors / exceptions / warnings
  errorsSince(mark, { warnings = false } = {}) {
    const bad = (e) => e.kind === 'error' || e.kind === 'exception' || e.kind === 'log-error' || (warnings && (e.kind === 'warning' || e.kind === 'log-warning'));
    return this.s.console.slice(mark.c).filter((e) => bad(e) && !/favicon\.ico/.test(e.text + (e.url ?? '')));
  }
  netSince(mark) { return this.s.network.slice(mark.n).filter((n) => !/favicon\.ico/.test(n.url ?? '')); }
  // every .glb/.gltf the page asked for since mark (mark() records the position): [{ status, url }] (status 0 = the request failed)
  modelsSince(mark) { return this.s.models.slice(mark.m ?? 0); }
  async wait(ms) { await sleep(ms); }
  // poll a page expression until truthy
  async waitFor(expr, { timeout = 60000, interval = 400, label = expr } = {}) {
    const t0 = Date.now(); let last;
    while (Date.now() - t0 < timeout) {
      try { last = await this.page.eval(expr, { timeout: 30000 }); if (last) return last; } catch (e) { last = 'ERR ' + e.message; }
      await sleep(interval);
    }
    throw new Error(`waitFor timed out (${timeout}ms): ${String(label).slice(0, 120)} -> ${JSON.stringify(last)?.slice(0, 200)}`);
  }
  // wait until the game has advanced `seconds` of game time (dt clamped at 0.1/frame), with a real-time cap
  async step(seconds, { cap = 120000 } = {}) {
    const g0 = await this.page.eval('__qa.gameTime');
    const t0 = Date.now();
    while (Date.now() - t0 < cap) {
      const g = await this.page.eval('__qa.gameTime');
      if (g - g0 >= seconds) return g - g0;
      await sleep(150);
    }
    return (await this.page.eval('__qa.gameTime')) - g0;
  }
  async frames(n, cap = 60000) {
    const f0 = await this.page.eval('__qa.frames'); const t0 = Date.now();
    while (Date.now() - t0 < cap) { if ((await this.page.eval('__qa.frames')) - f0 >= n) return; await sleep(80); }
  }
  // Navigate to a fresh game page and wait for all manifest modules to settle.
  // intro: 'seen' (default: a returning player, the awakening never starts and never touches the world), 'new' (a brand-new player: the
  // awakening starts by itself after ~3 game seconds) or 'keep' (do not touch localStorage: a reload inside a scenario).
  async load({ query = '', timeout = 240000, fast = true, render = false, intro = 'seen' } = {}) {
    const q = new URLSearchParams(query);
    if (this.tier === 'quest') q.set('quality', 'quest'); else q.set('quality', 'pc');
    if (fast) q.set('qafast', '1');
    if (intro !== 'keep') q.set('qaintro', intro);
    const url = `http://localhost:${LOCAL_PORT}/?${q}`;
    const t0 = Date.now();
    this.s.page.send('Page.navigate', { url }, 60000).catch(() => {});
    await this.waitFor('!!(window.game && window.game.modules)', { timeout: 60000, label: 'window.game' });
    const expected = await new Promise((resolve, reject) => {
      fetch(`http://localhost:${LOCAL_PORT}/api/modules`).then((r) => r.json()).then((j) => resolve(j.modules.length)).catch(reject);
    });
    this.data.expectedModules = expected;
    await this.waitFor(`(() => { const m = window.game.modules; if (m.size < ${expected}) return false; for (const r of m.values()) if (!r.instance && !r.failed) return false; return true; })()`, { timeout, label: 'all modules settled' });
    await this.page.eval(`(() => { const g = window.game; if (!g || window.__qa.hooked) return; window.__qa.hooked = true; window.__qa.loaded = [];
      g.events.on('module:loaded', (e) => window.__qa.loaded.push({ t: Math.round(performance.now()), path: e.path }));
      g.events.on('net:reload', (m) => { window.__qa.reloads++; window.__qa.lastReload = Date.now(); });
      g.events.on('xr:start', () => {}); })()`);
    await this.waitFor('!!window.__qaCtx', { timeout: 20000 }).catch(() => this.note('QA hook module (creations/zz-qa-hook.js) did not load: no window.__qaCtx'));
    await this.page.eval(PAGEHELPERS);
    await this.page.eval(`__qa.setRender(${!!render})`);
    await this.frames(3);
    this.data.bootMs = Date.now() - t0;
    this.log(`booted in ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  // Light page load for checks that only need boot.js (no module settling): navigates, waits for window.game and a moment of real time.
  async loadLite({ query = '', settleMs = 2500 } = {}) {
    const q = new URLSearchParams(query);
    q.set('quality', this.tier === 'quest' ? 'quest' : 'pc'); q.set('qafast', '1'); q.set('qaintro', 'seen');
    await this.s.page.send('Page.navigate', { url: 'about:blank' }, 30000).catch(() => {});
    await sleep(400);
    this.s.page.send('Page.navigate', { url: `http://localhost:${LOCAL_PORT}/?${q}` }, 60000).catch(() => {});
    await this.waitFor('!!(window.game && window.game.renderer)', { timeout: 60000, label: 'window.game' });
    await sleep(settleMs);
  }
  // ---- input helpers (desktop emulation) ----
  async keyDown(code) { await this.page.eval(`window.dispatchEvent(new KeyboardEvent('keydown',{code:${JSON.stringify(code)},key:${JSON.stringify(code.replace(/^Key/, '').toLowerCase())},bubbles:true}))`); }
  async keyUp(code) { await this.page.eval(`window.dispatchEvent(new KeyboardEvent('keyup',{code:${JSON.stringify(code)},key:${JSON.stringify(code.replace(/^Key/, '').toLowerCase())},bubbles:true}))`); }
  async tap(code, holdFrames = 3) { await this.keyDown(code); await this.frames(holdFrames); await this.keyUp(code); await this.frames(2); }
  async lock(on = true) { await this.page.eval(`__qa.lock(${on})`); }
  async mouseDown(button = 0) { await this.page.eval(`document.querySelector('canvas').dispatchEvent(new MouseEvent('mousedown',{button:${button},bubbles:true}))`); }
  async mouseUp(button = 0) { await this.page.eval(`window.dispatchEvent(new MouseEvent('mouseup',{button:${button},bubbles:true}))`); }
  async click(button = 0, holdFrames = 3) { await this.lock(true); await this.mouseDown(button); await this.frames(holdFrames); await this.mouseUp(button); await this.frames(2); }
  async look(dx, dy) { await this.page.eval(`window.dispatchEvent(new MouseEvent('mousemove',{movementX:${dx},movementY:${dy},bubbles:true}))`); }
  // A snapshot of the module table.
  async moduleReport() {
    return this.page.eval(`(() => { const out = []; for (const [p, r] of window.game.modules) out.push({ path: p, failed: !!r.failed, hasInstance: !!r.instance, hasUpdate: !!(r.instance && r.instance.update), ms: Math.round((r.ms ?? 0) * 1000) / 1000, version: r.version }); return out; })()`);
  }
  async rendererInfo() {
    return this.page.eval(`(() => { const i = window.game.renderer.info; const m = __qa.measure(); return { calls: m.calls, triangles: m.triangles, lines: m.lines, points: m.points, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 }; })()`);
  }
  // compile all scene materials (finds broken shaders even when rendering is switched off), then list broken programs
  async compileAndCheck() {
    await this.page.eval('__qa.compile()', { timeout: 180000 });
    return this.brokenPrograms();
  }
  async brokenPrograms() {
    return this.page.eval(`(() => { const r = window.game.renderer; const out = []; for (const p of r.info.programs ?? []) { const d = p.diagnostics; if (d && d.runnable === false) out.push({ name: p.name, cacheKey: String(p.cacheKey).slice(0, 80), program: String(d.programLog ?? '').slice(0, 500), vertex: String(d.vertexShader?.log ?? '').slice(0, 500), fragment: String(d.fragmentShader?.log ?? '').slice(0, 500) }); } return out; })()`);
  }
  async perfStats() {
    return this.page.eval(`(() => { try { return JSON.parse(JSON.stringify(window.game.world.perf?.stats?.() ?? null)); } catch (e) { return { error: String(e) }; } })()`);
  }
  async services() {
    return this.page.eval(`Object.keys(window.game.world).sort()`);
  }
  // collect pixels statistics of the current canvas (to detect black/blown-out/flat frames): average luminance, % near-black, % near-white, % magenta
  async pixelStats() {
    return this.page.eval(`(() => { const g = window.game; (__qa.origRender || g.renderer.render.bind(g.renderer))(g.scene, g.camera); const c = document.querySelector('canvas'); const tmp = document.createElement('canvas'); tmp.width = 160; tmp.height = 90; const x = tmp.getContext('2d'); x.drawImage(c, 0, 0, 160, 90); const d = x.getImageData(0, 0, 160, 90).data; let sum = 0, dark = 0, bright = 0, mag = 0, n = d.length / 4; for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += l; if (l < 8) dark++; if (l > 247) bright++; if (d[i] > 200 && d[i + 2] > 200 && d[i + 1] < 60) mag++; } return { avg: Math.round(sum / n), dark: Math.round(dark / n * 100), bright: Math.round(bright / n * 100), magenta: Math.round(mag / n * 1000) / 10 }; })()`);
  }
  summary() {
    const failed = this.checks.filter((c) => !c.ok);
    return { id: this.scenario.id, name: this.scenario.name, tier: this.tier, pass: failed.length === 0, checks: this.checks, notes: this.notes, shots: this.shots, data: this.data, ms: Date.now() - this.startedAt };
  }
}

