// Waits (poll every 60 s) until the PID in pid.txt has exited, then (if before 07:50 local) runs run3.mjs (= run.mjs over list3.json,
// same guards: GPU temp >= 84 C / VRAM > 26000 MiB -> wait, 10 s pause, stop after 3 consecutive failures, no item after 07:50,
// hard stop 08:00, shuts down only a WSL worker it started). No AI calls.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const log = (m) => console.log(`${new Date().toLocaleString('sv')}  chain: ${m}`);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const cutoff = () => { const d = new Date(); d.setHours(7, 50, 0, 0); return d.getTime(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pid = NaN;
try { pid = parseInt(fs.readFileSync(path.join(here, 'pid.txt'), 'utf8').trim(), 10); } catch { /* none */ }
log(`start, watching pid ${pid}`);
while (Number.isFinite(pid) && alive(pid)) {
  if (Date.now() > cutoff()) { log('07:50 passed while waiting, giving up'); process.exit(0); }
  await sleep(60_000);
}
if (Date.now() > cutoff()) { log('after 07:50, not starting list3'); process.exit(0); }
log('first batch has exited, starting run3.mjs (list3.json)');
const child = spawn(process.execPath, [path.join(here, 'run3.mjs')], { cwd: path.resolve(here, '..', '..'), stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
child.on('exit', (code) => { log(`run3.mjs exited with code ${code}`); process.exit(code ?? 0); });
