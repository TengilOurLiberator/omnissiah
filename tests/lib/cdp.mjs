// Minimal Chrome DevTools Protocol client + headless Edge launcher (no dependencies besides `ws`).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import WebSocket from 'ws';

export const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 3000 }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

export async function launchEdge({ profileDir, port, width = 1280, height = 720, extraArgs = [] }) {
  fs.mkdirSync(profileDir, { recursive: true });
  const args = [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist',
    '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion,Translate', '--mute-audio=false',
    '--enable-precise-memory-info', '--js-flags=--expose-gc',
    `--window-size=${width},${height}`, ...extraArgs, 'about:blank',
  ];
  const child = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
  let exited = false;
  child.on('exit', () => { exited = true; });
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error('edge exited early');
    try { await getJson(port, '/json/version'); break; } catch { await sleep(300); }
  }
  return { child, port, pid: child.pid, get exited() { return exited; } };
}

export class Page {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map();
    ws.on('message', (data) => {
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject, method } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result);
      } else if (m.method) {
        for (const fn of this.listeners.get(m.method) ?? []) { try { fn(m.params); } catch (e) { console.error('cdp listener', e); } }
      }
    });
    ws.on('close', () => { this.closed = true; for (const p of this.pending.values()) p.reject(new Error('cdp socket closed')); this.pending.clear(); });
  }
  static async connect(port) {
    let targets = await getJson(port, '/json/list');
    let t = targets.find((x) => x.type === 'page');
    if (!t) { t = await getJson(port, '/json/new?about:blank'); }
    const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    return new Page(ws);
  }
  on(method, fn) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(fn); }
  send(method, params = {}, timeoutMs = 120000) {
    if (this.closed) return Promise.reject(new Error('cdp closed'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: cdp timeout ${timeoutMs}ms`)); }, timeoutMs);
      this.pending.set(id, { method, resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  // Evaluate an expression (or async IIFE body) in the page; returns the JSON value.
  async eval(expression, { timeout = 120000, awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise, userGesture: true, timeout: Math.max(1000, timeout - 1000) }, timeout);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`page eval threw: ${d.exception?.description ?? d.text}`.slice(0, 1500));
    }
    return r.result.value;
  }
  async screenshot(file, { quality } = {}) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', ...(quality ? {} : {}) }, 60000);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
