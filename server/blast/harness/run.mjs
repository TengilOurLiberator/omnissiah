// Runs one harness scenario in headless Edge. node server/blast/harness/run.mjs <slug> <vision|arrive|mr> [outDir] [quality=pc|quest] [timeoutSeconds]
// Starts the harness server on a random high port, launches Edge (SwiftShader, own temp profile), waits for the page to say it is done, kills the Edge it started.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHarness } from './server.mjs';

const [slug, scenario = 'arrive', outArg, quality = 'pc', timeoutArg] = process.argv.slice(2);
if (!slug) { console.log('usage: run.mjs <slug> <vision|arrive|mr> [outDir] [pc|quest] [timeoutSeconds]'); process.exit(1); }
const outDir = path.resolve(outArg || path.join('D:/omnissiah/.cache/blast/harness', `${slug}-${scenario}`));
fs.rmSync(outDir, { recursive: true, force: true });
const port = 41000 + Math.floor(Math.random() * 20000);
const h = await startHarness({ outDir, port });
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-edge-'));
const url = `http://127.0.0.1:${h.port}/?slug=${encodeURIComponent(slug)}&scenario=${scenario}&quality=${quality}`;
const args = ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1280,720', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', url];   // real time (virtual time would run the page's timeouts out before its fetches finish); frames are canvas dumps posted to /save
console.log('harness', url);
const edge = spawn(EDGE, args, { stdio: 'ignore', windowsHide: true });
const timeout = (Number(timeoutArg) || 900) * 1000;
const why = await Promise.race([h.done, new Promise((r) => setTimeout(() => r('timeout'), timeout)), new Promise((r) => edge.on('exit', () => setTimeout(() => r('edge exited'), 3000)))]);
console.log('finished:', why, 'saved', h.saved.join(', '));
console.log(h.logs.join('\n').slice(-6000));
try { execFile('taskkill', ['/PID', String(edge.pid), '/T', '/F'], () => {}); } catch { /* gone */ }
h.close();
setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* in use */ } process.exit(0); }, 2500);
