// Starts / stops OUR OWN game server instance (ports 9080/9443 only; never 8080/8443). Only our PID is ever killed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NODE = path.join(ROOT, 'tools', 'node', 'node.exe');
export const LOCAL_PORT = 9080;
export const PORT = 9443;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/modules', timeout: 2000 }, (res) => {
      let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

export async function startServer({ logFile, env = {}, root = ROOT }) {
  if (await ping(LOCAL_PORT)) throw new Error(`port ${LOCAL_PORT} already answers - another QA server is running? refusing to start`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.createWriteStream(logFile);
  const child = spawn(NODE, ['server/index.js'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), LOCAL_PORT: String(LOCAL_PORT), ORACLE_REPAIR: 'off', COMMENTARY: 'off', VOICE_PREWARM: '0', STT_BACKEND: 'cpu', ...env },
  });
  const lines = [];
  const onData = (tag) => (d) => { const s = d.toString(); out.write(s); for (const l of s.split(/\r?\n/)) if (l.trim()) lines.push(`${tag}${l}`); };
  child.stdout.on('data', onData(''));
  child.stderr.on('data', onData('ERR '));
  let exited = false;
  child.on('exit', (code) => { exited = true; out.write(`\n[qa] server exited code=${code}\n`); });
  // The server syntax-checks every game file (one "node --check" each) before it listens; with a dozen agents busy that took > 150 s once.
  let mods = null; const t0 = Date.now();
  while (Date.now() - t0 < 480000) {
    if (exited) throw new Error('server exited at startup: ' + lines.slice(-10).join('\n'));
    mods = await ping(LOCAL_PORT);
    if (mods) break;
    await sleep(300);
  }
  if (!mods) { try { process.kill(child.pid); } catch { /* gone */ } throw new Error('server did not come up on ' + LOCAL_PORT + ' within 480 s: ' + lines.slice(-6).join(' | ')); }
  return {
    pid: child.pid, lines, modules: mods.modules,
    async stop() {
      if (exited) return;
      await sleep(1000); // let the save plugin flush its debounce
      try { process.kill(child.pid); } catch { /* gone */ }
      for (let i = 0; i < 20 && !exited; i++) await sleep(150);
      out.end();
    },
  };
}


