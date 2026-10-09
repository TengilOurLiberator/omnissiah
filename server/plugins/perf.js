// server/plugins/perf.js — collects frame-time reports from the headset.
// The client (public/game/core/perf.js) sends { type:'perf_report', reason, tier, level, xr, hz, text } 60 s into every XR session,
// whenever its governor hits the floor, and at session end. Each report is appended to D:\omnissiah\.cache\perf-reports.log
// with a timestamp and the client tier, so a first headset session can be read afterwards without a debugger.
import fs from 'node:fs';
import path from 'node:path';

export default async function (api) {
  const file = path.join(api.cacheDir, 'perf-reports.log');
  try { fs.mkdirSync(api.cacheDir, { recursive: true }); } catch { /* exists */ }
  const MAX_BYTES = 2 * 1024 * 1024; // keep the log bounded: rotate to .1 when it grows past 2 MB

  function append(msg, ws) {
    const stamp = new Date().toISOString();
    const text = String(msg.text ?? '').slice(0, 6000);
    const head = `=== ${stamp} client=${String(msg.tier ?? ws?.client ?? '?')} reason=${String(msg.reason ?? '?').slice(0, 80)} ` +
      `level=${msg.level ?? '?'} xr=${msg.xr ? 'yes' : 'no'} hz=${msg.hz ?? '?'} ===`;
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file + '.1');
      fs.appendFileSync(file, head + '\n' + text + '\n\n');
    } catch (err) {
      api.log?.(`[perf] could not write ${file}: ${err.message}`);
    }
  }

  return {
    name: 'perf',
    messages: {
      perf_report: async (msg, ws) => {
        append(msg, ws);
        api.log?.(`[perf] report (${msg.reason ?? '?'}, ${msg.tier ?? '?'}, level ${msg.level ?? '?'}) -> ${path.relative(api.root, file)}`);
      },
    },
  };
}
