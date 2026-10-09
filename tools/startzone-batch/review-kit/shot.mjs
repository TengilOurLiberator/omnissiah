// CDP screenshot driver: node shot.mjs <url> <out.png> [waitExpr] [timeoutSec] [evalExpr] ; chrome on debugging port 9541 (own profile), closed at the end
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const WebSocket = createRequire('D:/omnissiah/package.json')('ws');
const [url, out, waitExpr = 'true', timeoutSec = '60', evalExpr = ''] = process.argv.slice(2);
const PORT = 9541, W = +process.env.W || 1280, H = +process.env.H || 720;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', `--user-data-dir=D:/omnissiah/.cache/genset/chrome-prof2`, `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tgt = null;
for (let i = 0; i < 60 && !tgt; i++) { await sleep(500); try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); tgt = l.find((t) => t.type === 'page'); } catch { /* not up yet */ } }
if (!tgt) { chrome.kill(); console.error('no chrome'); process.exit(2); }
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let id = 0; const pend = new Map(); const logs = [];
ws.on('message', (m) => {
  const j = JSON.parse(m);
  if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); }
  else if (j.method === 'Runtime.consoleAPICalled') { const t = j.params.type; if (t === 'error' || t === 'warning') logs.push(t + ': ' + j.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); }
  else if (j.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (j.params.exceptionDetails.exception?.description || j.params.exceptionDetails.text).slice(0, 300));
  else if (j.method === 'Log.entryAdded' && j.params.entry.level === 'error') logs.push('LOG: ' + j.params.entry.text.slice(0, 200) + ' ' + (j.params.entry.url || ''));
});
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Page.navigate', { url });
const t0 = Date.now(); let ok = false;
while (Date.now() - t0 < +timeoutSec * 1000) {
  await sleep(1000);
  const r = await send('Runtime.evaluate', { expression: `(()=>{try{return !!(${waitExpr})}catch(e){return false}})()`, returnByValue: true });
  if (r.result?.result?.value) { ok = true; break; }
}
console.log('wait', ok ? 'ok' : 'TIMEOUT', ((Date.now() - t0) / 1000).toFixed(1) + 's');
await sleep(1500);
if (evalExpr) { const r = await send('Runtime.evaluate', { expression: evalExpr, returnByValue: true, awaitPromise: true }); console.log('eval', JSON.stringify(r.result?.result?.value ?? r.result)); }
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out, 'console issues:', logs.length); for (const l of logs.slice(0, 12)) console.log('  ', l);
try { ws.close(); } catch { /* ignore */ }
chrome.kill();
await sleep(500);
process.exit(0);
