// Observes the Claude CLI processes that the (copied) oracle.js spawns, without changing them: patches child_process.spawn so that
// stdout lines of stream-json runs are parsed into per-working-directory event logs (text blocks, tool uses, result event, timings).
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const taps = new Map(); // normalised cwd -> tap
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function openTap(cwds) {
  const list = [].concat(cwds);
  const tap = { cwds: list.map(norm), runs: [], t0: Date.now() };
  for (const c of tap.cwds) taps.set(c, tap);
  return tap;
}
export function closeTap(tap) { for (const c of tap.cwds) taps.delete(c); }

let installed = false;
export function installSpawnTap() {
  if (installed) return;
  installed = true;
  const orig = cp.spawn;
  cp.spawn = function patched(...a) {
    const child = orig.apply(this, a);
    try {
      const opts = a.find((x) => x && typeof x === 'object' && !Array.isArray(x)) || {};
      const cmdline = typeof a[0] === 'string' ? a[0] + ' ' + (Array.isArray(a[1]) ? a[1].join(' ') : '') : '';
      const tap = taps.get(norm(opts.cwd));
      if (tap) {
        const streamJson = /stream-json/.test(cmdline);
        const run = { kind: streamJson ? 'main' : 'quick', start: Date.now() - tap.t0, events: [], texts: [], tools: [], result: null, rawOut: '', end: null };
        tap.runs.push(run);
        let buf = '';
        child.stdout?.on('data', (d) => {
          const s = d.toString();
          if (!streamJson) { run.rawOut += s; return; }
          buf += s;
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line) continue;
            let ev; try { ev = JSON.parse(line); } catch { continue; }
            const t = Date.now() - tap.t0;
            if (ev.type === 'assistant' && Array.isArray(ev.message?.content) && !ev.parent_tool_use_id) {
              for (const b of ev.message.content) {
                if (b.type === 'text' && b.text?.trim()) run.texts.push({ t, text: b.text.trim(), beforeTool: run.tools.length === 0 });
                else if (b.type === 'tool_use') run.tools.push({ t, name: b.name, input: b.input });
              }
            } else if (ev.type === 'stream_event' && ev.event?.type === 'content_block_start' && ev.event.content_block?.type === 'tool_use' && !ev.parent_tool_use_id) {
              (run.firstToolStream ??= t);
            } else if (ev.type === 'result') {
              run.result = { t, is_error: ev.is_error, result: ev.result, cost: ev.total_cost_usd, duration_ms: ev.duration_ms, duration_api_ms: ev.duration_api_ms, turns: ev.num_turns, usage: ev.usage, subtype: ev.subtype };
            }
          }
        });
        child.on('close', (code) => { run.end = Date.now() - tap.t0; run.code = code; });
      }
    } catch { /* never break the real spawn */ }
    return child;
  };
  syncBuiltinESMExports();
}

