// Performance: the headset's frame-time reports (.cache/perf-reports.log, written by server/plugins/perf.js) as charts and tiles.
import { h, icon, clear, fmtAgo, fmtClock, fmtDate, emptyState } from '../dom.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';

function drawChart(canvas, pts, o) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || 600, H = canvas.clientHeight || 150;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const L = 40, R = 12, T = 12, B = 24, pw = W - L - R, ph = H - T - B;
  const vals = pts.map((p) => p.v).filter((v) => v != null);
  const lo = o.min ?? 0;
  let hi = o.max ?? Math.max(1, ...vals);
  if (o.target) hi = Math.max(hi, o.target * 1.08);
  if (hi <= lo) hi = lo + 1;
  const t0 = pts.length ? pts[0].t : 0, t1 = pts.length > 1 ? pts[pts.length - 1].t : t0 + 1;
  const X = (t) => L + (pts.length > 1 ? (t - t0) / (t1 - t0 || 1) : 0.5) * pw, Y = (v) => T + ph - ((v - lo) / (hi - lo)) * ph;
  g.font = '11px "Segoe UI", system-ui, sans-serif'; g.textBaseline = 'middle';
  g.strokeStyle = 'rgba(150,160,255,.14)'; g.fillStyle = css('--faint'); g.lineWidth = 1;
  const ticks = o.ticks ?? 4;
  for (let i = 0; i <= ticks; i++) { const v = lo + ((hi - lo) * i) / ticks, y = Math.round(Y(v)) + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.textAlign = 'right'; g.fillText(o.fmt ? o.fmt(v) : String(Math.round(v)), L - 6, y); }
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (let i = 0; i < 5 && pts.length > 1; i++) { const t = t0 + ((t1 - t0) * i) / 4; g.fillText(fmtClock(t).slice(0, 5), Math.min(W - R - 12, Math.max(L + 12, X(t))), H - B + 7); }
  if (o.target) { g.setLineDash([5, 4]); g.strokeStyle = 'rgba(255,216,119,.55)'; const y = Math.round(Y(o.target)) + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.setLineDash([]); g.fillStyle = css('--gold'); g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(`${o.target} Hz target`, L + 6, y - 2); }
  const line = pts.filter((p) => p.v != null);
  if (!line.length) { g.fillStyle = css('--faint'); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('no data', W / 2, H / 2); return; }
  const col = css(o.color);
  const path = () => { g.beginPath(); line.forEach((p, i) => { const x = X(p.t), y = Y(p.v); if (o.step && i) g.lineTo(x, Y(line[i - 1].v)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); };
  path(); g.lineTo(X(line[line.length - 1].t), T + ph); g.lineTo(X(line[0].t), T + ph); g.closePath();
  const grad = g.createLinearGradient(0, T, 0, T + ph); grad.addColorStop(0, `${col}55`.length === 9 && col.startsWith('#') ? `${col}55` : 'rgba(127,230,255,.3)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fill();
  path(); g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
  g.fillStyle = col; for (const p of line) { g.beginPath(); g.arc(X(p.t), Y(p.v), line.length > 60 ? 1.6 : 3, 0, 7); g.fill(); }
  if (canvas._hover != null && line[canvas._hover]) {
    const p = line[canvas._hover], x = X(p.t), y = Y(p.v);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, T); g.lineTo(Math.round(x) + 0.5, T + ph); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill();
    const label = `${o.fmt ? o.fmt(p.v) : p.v}${o.unit ?? ''} · ${fmtClock(p.t).slice(0, 5)}`;
    const w = g.measureText(label).width + 16, bx = Math.min(W - R - w, Math.max(L, x - w / 2)), by = y < T + 34 ? y + 12 : y - 30;
    g.fillStyle = 'rgba(10,12,50,.96)'; g.strokeStyle = 'rgba(190,198,255,.5)'; g.beginPath(); g.roundRect(bx, by, w, 20, 6); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, bx + 8, by + 10);
  }
}

const READING = [
  ['fps / p95 / p99', 'fps near 72 with p99 under 20 ms is fine. A high p99 with a good p95 means hitches (a one-off stall), not a slow scene.'],
  ['halfRate = YES', 'Every frame costs more than one display refresh, so you see 36 fps. The governor keeps lowering the quality level until it recovers.'],
  ['Level (L3/9)', '0 is the best picture, 9 the leanest. If it sits at 0 after minutes of busy play there is headroom; if it hits the floor the scene is simply too heavy.'],
  ['draws / tris per eye', 'Compare with the budget line in the raw report. After summoning something big, a jump here tells you what it cost.'],
  ['cpu vs gpu, bound', 'cpu above 85% of the frame budget = too much JavaScript or too many draw calls. "gpu n/a" is normal on Quest.'],
];

export default function mount(root, app) {
  const { net } = app;
  let reports = [], exists = null, err = null, selected = -1, loaded = false;
  const tiles = h('div', { class: 'tiles' });
  const chartsBox = h('div');
  const rawBox = h('div');
  const tableBox = h('div', { class: 'scroll-x' });
  const meta = h('p', { class: 'small dim' });
  const charts = [];

  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Performance'), h('p', null, 'What the headset reported about its frame rate: a report is sent a minute into every VR session, whenever the game hits its lowest quality level, and when the session ends.')),
      h('button', { class: 'btn right', type: 'button', on: { click: () => load() } }, icon('restore', 15), 'Refresh')),
    meta, tiles,
    h('div', { class: 'grid2' },
      h('div', { class: 'col' }, h('section', { class: 'card' }, h('h2', { class: 'card-title' }, icon('perf', 15), 'Over time'), chartsBox), h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Report'), rawBox)),
      h('div', { class: 'col' }, h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Reports'), tableBox),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'How to read this'),
          h('dl', { class: 'kv small' }, READING.flatMap(([k, v]) => [h('dt', { class: 'mono gold' }, k), h('dd', { class: 'dim' }, v)])),
          h('p', { class: 'tiny faint', style: { marginTop: '10px' } }, 'The full guide, with the symptom table, is section 7 of docs/PERFORMANCE.md. Nothing is collected unless a headset session ran: the log is a file on this PC.')))));

  async function load() {
    if (net.state !== 'open' || net.hasPlugin !== true) { err = net.hasPlugin === false ? 'The admin plugin is not loaded on the server.' : 'Waiting for the server…'; paint(); return; }
    try { const d = await net.request('admin_perf', { max: 150 }); reports = d.reports; exists = d.exists; err = null; loaded = true; if (selected >= reports.length) selected = -1; } catch (e) { err = e.message; }
    paint();
  }
  net.on('plugin', load);
  const poll = setInterval(() => { if (!root.hidden && !document.hidden) load(); }, 15000);

  const tone = (fps, hz) => (fps == null ? '' : fps >= (hz ?? 72) * 0.94 ? 'good' : fps >= (hz ?? 72) * 0.75 ? 'mid' : 'low');
  function paint() {
    clear(tiles); clear(chartsBox); clear(rawBox); clear(tableBox);
    charts.length = 0;
    if (!loaded) { meta.textContent = ''; chartsBox.append(emptyState(err ? 'Cannot read the reports' : 'Loading…', err)); return; }
    if (!reports.length) {
      meta.textContent = '';
      const e = emptyState(exists ? 'The log has no readable reports' : 'No headset report yet', exists ? 'D:\\omnissiah\\.cache\\perf-reports.log exists but nothing in it could be parsed.' : 'Play a VR session of a minute or more and reports start to appear here. They are written to D:\\omnissiah\\.cache\\perf-reports.log.');
      chartsBox.append(e); rawBox.append(emptyState('Nothing to show', null)); tableBox.append(emptyState('No reports', null));
      return;
    }
    const last = reports[reports.length - 1], cur = selected >= 0 ? reports[selected] : last;
    meta.textContent = `${reports.length} reports · latest ${fmtAgo(last.t)} from ${last.client}${last.xr ? ' in VR' : ' (flat)'} at ${last.hz ?? '?'} Hz (${last.reason})`;
    const tile = (label, value, unit, cls = '') => h('div', { class: `tile ${cls}` }, h('span', null, label), h('b', null, value ?? '-'), unit ? h('small', null, unit) : null);
    tiles.append(tile('Frame rate', cur.fps?.toFixed(1), 'fps', tone(cur.fps, cur.hz)), tile('p95 frame', cur.p95?.toFixed(1), 'ms'), tile('p99 frame', cur.p99?.toFixed(1), 'ms', cur.p99 > 25 ? 'mid' : ''), tile('Quality level', cur.level != null ? `L${cur.level}` : null, '/ 9'), tile('Draw calls', cur.draws, '/ eye'), tile('Triangles', cur.trisK, 'k / eye'), tile('CPU', cur.cpuMs?.toFixed(1), 'ms'));
    const series = [
      ['Frame rate (fps)', 'fps', { color: '--cyan', min: 0, max: Math.ceil(((last.hz ?? 72) * 1.12) / 20) * 20, target: last.hz ?? 72, fmt: (v) => v.toFixed(0), unit: ' fps' }],
      ['Quality ladder level (0 = best picture, higher = the game is dropping detail)', 'level', { color: '--gold', min: 0, max: 9, ticks: 3, step: true, fmt: (v) => v.toFixed(0), unit: '' }],
      ['Draw calls per eye', 'draws', { color: '--violet', min: 0, fmt: (v) => v.toFixed(0), unit: ' draws' }],
    ];
    for (const [title, key, opt] of series) {
      const pts = reports.map((r) => ({ t: r.t, v: r[key] }));
      const canvas = h('canvas', { class: 'chart', role: 'img', 'aria-label': `${title}: latest ${pts[pts.length - 1].v ?? 'none'}, from ${Math.min(...pts.map((p) => p.v ?? Infinity))} to ${Math.max(...pts.map((p) => p.v ?? -Infinity))}` });
      const redraw = () => drawChart(canvas, pts, opt);
      canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(), x = e.clientX - r.left; const line = pts.filter((p) => p.v != null); const t0 = pts[0].t, t1 = pts[pts.length - 1].t; const tt = t0 + ((x - 40) / (r.width - 52)) * (t1 - t0); let bi = 0, bd = Infinity; line.forEach((p, i) => { const d = Math.abs(p.t - tt); if (d < bd) { bd = d; bi = i; } }); canvas._hover = bi; redraw(); });
      canvas.addEventListener('pointerleave', () => { canvas._hover = null; redraw(); });
      chartsBox.append(h('div', { class: 'chart-wrap' }, h('div', { class: 'chart-label' }, h('span', null, title)), canvas));
      charts.push(redraw);
    }
    requestAnimationFrame(() => charts.forEach((f) => f()));
    rawBox.append(h('p', { class: 'small dim', style: { marginBottom: '8px' } }, `${fmtDate(cur.t)} · ${cur.client} · ${cur.reason}${cur === last ? ' (latest)' : ''}`), cur.text ? h('pre', { class: 'raw', tabIndex: 0, 'aria-label': 'Raw report' }, cur.text) : h('p', { class: 'dim small' }, 'Raw text is only kept for the 12 newest reports.'));
    tableBox.append(h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['When', 'Why', 'fps', 'p99', 'L', 'Draws'].map((c, i) => h('th', { class: i > 1 ? 'num' : '' }, c)))),
      h('tbody', null, reports.slice(-30).reverse().map((r) => { const idx = reports.indexOf(r); return h('tr', { tabIndex: 0, style: { cursor: 'pointer', background: (selected === idx || (selected < 0 && r === last)) ? 'rgba(255,216,119,.08)' : '' }, title: 'Show this report', on: { click: () => { selected = idx; paint(); }, keydown: (e) => { if (e.key === 'Enter') { selected = idx; paint(); } } } },
        h('td', { class: 'nowrap' }, fmtDate(r.t).slice(5)), h('td', null, r.reason), h('td', { class: 'num' }, r.fps?.toFixed(1) ?? '-'), h('td', { class: 'num' }, r.p99?.toFixed(0) ?? '-'), h('td', { class: 'num' }, r.level ?? '-'), h('td', { class: 'num' }, r.draws ?? '-')); }))));
  }
  const ro = new ResizeObserver(() => { for (const f of charts) f(); }); ro.observe(root);
  paint();
  return { show() { load(); }, destroy() { clearInterval(poll); ro.disconnect(); } };
}
