// core/perf.js — world.perf: measures every frame, keeps 72 fps by itself (degrades grass, particles, crowds, sky, outlines ... then recovers), and tells you what you can afford.
// BUDGET PER EYE (world.perf.budget holds the LIVE numbers and they shrink when the governor degrades):
//   'quest' (standalone headset): scene <= ~150 draw calls, <= ~200k triangles, ONE light, <= 24 fighters, <= 80 kit bodies, <= 24 particle systems. Prefer InstancedMesh / models.instances / kit.particles.
//   'pc' (desktop or Link): <= ~1500 draw calls, <= ~4M triangles, <= 80 fighters. Creation rule everywhere: <= 20 draw calls, no per-frame allocation, no new lights, no shadow maps, share geometries and materials.
// ASK BEFORE YOU SPAWN (guard: ctx.world.perf?.…):
//   perf.allow(kind, n) -> how many of n fit right now (spawn that many instead of refusing)   perf.canSpawn(kind, n = 1) -> bool   perf.headroom(kind) -> units left
//   kind: 'fighters' | 'bodies' | 'particles' | 'actors' | 'drawCalls' | 'triangles'.   Library spawns, waves and combat.fighter() already do this for you.
//   const n = ctx.world.perf ? ctx.world.perf.allow('fighters', 20) : 20;   // spawn n, not 20
// READ: perf.stats() -> { tier, fps, frameMs, p95, level, calls, tris, ... } (shared object: copy)   perf.report() text   perf.overlay(true|false) debug panel   perf.mode = 'auto' | 'quality' | 'performance'
// Every change fires 'quality:changed' and mutates ctx.quality (density, maxLights, ...). Far objects are hidden (userData.perfCulled); set userData.noCull = true on anything that must always render.

export const meta = { name: 'Perf', description: 'Frame-time governor, budgets, debug overlay' };

const STORE_KEY = 'omnissiah.perf';
const SS_KEY = 'omnissiah.supersample';

// ====================================================================== pure governor (no three.js, testable in Node)
// level 0 = best quality, level C.floor = lowest. frame() returns the level change (+n degraded, -1 recovered, 0 none).
export function createGovernor(o = {}) {
  const C = Object.assign({
    budgetMs: 1000 / 72, floor: 9, dropAfter: 1.5, recoverAfter: 12, settle: 2, trialWindow: 30,
    backoff0: 30, backoffMax: 300, badFrac: 0.25, hitchMs: 250, severe: 2.2, missK: 1.25,
  }, o);
  const retryAt = new Float64Array(64), backoff = new Float64Array(64), hr = new Uint8Array(64);
  let level = 0, minL = 0, maxL = C.floor;
  let ema = C.budgetMs, bad = 0, overT = 0, goodT = 0, sinceChange = 99, hi = 0, hrSum = 0;
  let trialLevel = -1, trialAt = 0, floorFlag = false, halfRate = false, over = false;
  let drops = 0, recoveries = 0, hitches = 0, failures = 0;
  const G = {
    cfg: C,
    get level() { return level; },
    get floor() { return C.floor; },
    get ema() { return ema; }, get bad() { return bad; }, get overT() { return overT; }, get goodT() { return goodT; },
    get halfRate() { return halfRate; }, get over() { return over; }, get drops() { return drops; },
    get recoveries() { return recoveries; }, get hitches() { return hitches; }, get failures() { return failures; },
    get minLevel() { return minL; }, get maxLevel() { return maxL; },
    get floorFlag() { return floorFlag; }, set floorFlag(v) { floorFlag = !!v; },
    retryIn(l, now) { return Math.max(0, retryAt[l] - now); },
    setBudget(ms) { C.budgetMs = ms; },
    resetWindow() { bad = 0; overT = 0; goodT = 0; sinceChange = 0; hrSum = 0; hr.fill(0); ema = C.budgetMs; },
    // bounds: mode 'quality' = (0,0), 'performance' = (n,floor), 'auto' = (0,floor). Returns the level change forced by the new bounds.
    setBounds(lo, hi2) {
      minL = Math.max(0, Math.min(C.floor, lo | 0)); maxL = Math.max(minL, Math.min(C.floor, hi2 | 0));
      const was = level;
      if (level < minL) level = minL; else if (level > maxL) level = maxL;
      if (level !== was) { sinceChange = 0; overT = 0; goodT = 0; trialLevel = -1; }
      return level - was;
    },
    force(l) {
      const was = level; level = Math.max(0, Math.min(C.floor, l | 0));
      if (level !== was) { sinceChange = 0; overT = 0; goodT = 0; trialLevel = -1; }
      return level - was;
    },
    // ms = frame interval, now = seconds (any monotonic clock), cpuFrac/gpuFrac = measured cost / budget or -1 if unknown
    frame(ms, now, cpuFrac = -1, gpuFrac = -1) {
      if (!(ms > 0)) return 0;
      if (ms > C.hitchMs) { hitches++; return 0; }            // shader compile / GC / tab switch: not a verdict on the scene
      const dt = ms * 0.001, B = C.budgetMs;
      sinceChange += dt;
      ema += (ms - ema) * Math.min(1, dt / 0.5);
      bad += ((ms > B * C.missK ? 1 : 0) - bad) * Math.min(1, dt / 0.8);
      const r = ms / B, v = r > 1.7 && r < 2.4 ? 1 : 0;       // a missed vsync at 72 Hz is ~27.8 ms, not 14 ms
      hrSum += v - hr[hi]; hr[hi] = v; hi = (hi + 1) & 63;
      halfRate = hrSum >= 48;
      over = bad > C.badFrac || ema > B * 1.2;
      if (trialLevel >= 0 && now - trialAt > C.trialWindow) { backoff[trialLevel] = 0; trialLevel = -1; } // the trial survived
      if (sinceChange < C.settle) return 0;
      if (over) { overT += dt; goodT = 0; }
      else {
        overT = Math.max(0, overT - dt * 2);
        if (bad < 0.04 && !(cpuFrac > 0.85) && !(gpuFrac > 0.85)) goodT += dt;
      }
      if (overT >= C.dropAfter * (halfRate ? 0.6 : 1)) {
        if (level >= maxL) {                                   // at the floor and still over: report, once per window
          if (level >= C.floor) floorFlag = true;
          overT = 0;
          return 0;
        }
        const steps = Math.min(maxL - level, ema > B * C.severe ? 2 : 1);
        if (trialLevel === level && now - trialAt < C.trialWindow) { // we just recovered into this level and it failed again
          backoff[level] = backoff[level] ? Math.min(backoff[level] * 2, C.backoffMax) : C.backoff0;
          retryAt[level] = now + backoff[level];
          failures++;
        }
        trialLevel = -1;
        level += steps; drops++;
        sinceChange = 0; overT = 0; goodT = 0;
        if (level >= C.floor) floorFlag = true;
        return steps;
      }
      if (goodT >= C.recoverAfter && level > minL && now >= retryAt[level - 1]) {
        level--; recoveries++;
        trialLevel = level; trialAt = now;
        sinceChange = 0; overT = 0; goodT = 0;
        return -1;
      }
      return 0;
    },
  };
  return G;
}

// hysteresis for the distance culler (pure): hide beyond R, show again inside 0.92 R
export function cullDecide(hidden, distEdge, R) {
  return hidden ? !(distEdge < R * 0.92) : distEdge > R;
}

// ====================================================================== ladders
// Every rung lists the knobs it sets (cumulative: level N = defaults + rungs 1..N). Cheapest-to-notice first.
//   fov foveation 0..1 (XR) | grass motes 0..1 scale | sky 0 lite 1 normal 2 full | water 0 off 1 lite 2 full | blobs contact-shadow cap
//   outlines bool, outlineCap | reflections rim bool | cull metres | mist bool | shadowMap px (0 = off) | bloom bool (flat view)
//   density K x tier base | gore K caps | lights cap | anim K animation stride | think K fighter think interval | oracle fractal max tier (0..2)
//   skyLate bool (depth-tested sky drawn last) | terrainDetail bool
const LADDERS = {
  quest: [
    ['foveation',  { fov: 1 }],
    ['grass-80',   { grass: 0.8, motes: 0.8 }],
    ['cull-300',   { cull: 300, blobs: 64, anim: 1.5 }],
    ['sky-lite',   { sky: 0, water: 1 }],
    ['density-75', { density: 0.75, gore: 0.75, grass: 0.6, think: 1.5 }],
    ['cull-200',   { cull: 200, anim: 2, oracle: 1 }],
    ['grass-40',   { grass: 0.4, motes: 0.5, rim: false, blobs: 32 }],
    ['density-50', { density: 0.5, gore: 0.5, lights: 4, cull: 140, anim: 3, think: 2, oracle: 0 }],
    ['floor',      { grass: 0.15, motes: 0.25, water: 0, density: 0.35, gore: 0.25, lights: 3, cull: 100, anim: 4, think: 3, blobs: 16, skyLate: true }],
  ],
  pc: [
    ['shadow-2k',   { shadowMap: 2048 }],
    ['bloom-off',   { bloom: false, mist: false }],
    ['outlines-80', { outlineCap: 80, reflections: false, terrainDetail: false }],
    ['grass-70',    { grass: 0.7, density: 0.72, shadowMap: 1024, fov: 0.5 }],
    ['sky-lite',    { sky: 1, outlines: false, cull: 450, anim: 1.5 }],
    ['shadow-off',  { shadowMap: 0, grass: 0.45, density: 0.48, water: 1, blobs: 64, fov: 1, anim: 2, think: 1.5 }],
    ['floor',       { sky: 0, grass: 0.25, density: 0.32, gore: 0.5, lights: 6, cull: 250, blobs: 32, anim: 3, think: 2, oracle: 1 }],
  ],
};
const DEFAULTS = {
  quest: { fov: 0.5, grass: 1, motes: 1, sky: 1, water: 2, blobs: 120, outlines: false, outlineCap: 150, reflections: false, rim: true, cull: 380,
    mist: false, shadowMap: 0, bloom: false, density: 1, gore: 1, lights: 6, anim: 1, think: 1, oracle: 2, skyLate: false, terrainDetail: false },
  pc: { fov: 0, grass: 1, motes: 1, sky: 2, water: 2, blobs: 120, outlines: true, outlineCap: 150, reflections: true, rim: true, cull: 700,
    mist: true, shadowMap: 4096, bloom: true, density: 1, gore: 1, lights: 12, anim: 1, think: 1, oracle: 2, skyLate: false, terrainDetail: true },
};
const KNOBS = Object.keys(DEFAULTS.quest);
// population budgets at level 0 (per eye for drawCalls / triangles); scaled down with the level
const BUDGET0 = {
  quest: { fighters: 24, bodies: 80, particles: 24, actors: 40, drawCalls: 220, triangles: 300000 },
  pc: { fighters: 80, bodies: 300, particles: 80, actors: 140, drawCalls: 1500, triangles: 4000000 },
};
const PERF_LEVEL = { quest: 4, pc: 3 }; // where mode 'performance' starts

const HZ_SNAP = [72, 80, 90, 120];
const NOW = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export default function (ctx) {
  const { THREE, scene, renderer, camera, root, quality, events } = ctx;
  const world = ctx.world;
  const keep = ctx.state;
  const PC = !!quality.pc;
  const TIER = PC ? 'pc' : 'quest';
  const ladder = LADDERS[TIER];
  const FLOOR = ladder.length;
  const base = (keep.base ??= { density: quality.density, maxLights: quality.maxLights, supersample: quality.supersample });
  const D = DEFAULTS[TIER];

  // ---------------------------------------------------------------- persistence
  const store = {
    read() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; } },
    write(o) { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch { /* private window */ } },
  };
  const saved = store.read();
  let mode = keep.mode || (['auto', 'quality', 'performance'].includes(saved.mode) ? saved.mode : 'auto');

  // ---------------------------------------------------------------- frame sampler (no allocation per frame)
  const WIN = 360, BIN = 0.5, NBIN = 120;
  const ring = new Float32Array(WIN), ringBin = new Uint8Array(WIN), hist = new Uint16Array(NBIN + 1);
  let ringN = 0, ringI = 0, lastT = -1, frameN = 0;
  let frameEma = 1000 / 72, worstEver = 0, worstWin = 0, sessionWorst = 0;
  let budgetMs = 1000 / 72, curHz = 72, estHz = 0, flatHz = 60;

  const pctl = (p) => {
    if (!ringN) return 0;
    const target = Math.ceil(p * ringN);
    let c = 0;
    for (let i = 0; i <= NBIN; i++) {
      c += hist[i];
      if (c < target) continue;
      if (i < NBIN) return (i + 0.5) * BIN;
      let s = 0, n = 0;                       // the overflow bin (>= 60 ms): mean of those frames
      for (let k = 0; k < ringN; k++) if (ring[k] >= NBIN * BIN) { s += ring[k]; n++; }
      return n ? s / n : NBIN * BIN;
    }
    return NBIN * BIN;
  };

  // ---------------------------------------------------------------- governor wiring
  const gov = createGovernor({ budgetMs, floor: FLOOR });
  gov.force(keep.level | 0);
  const history = (keep.history ??= []); // [{t, from, to, why, ema}] last 12
  let changedAt = 0, nowT = 0;
  const levelTime = (keep.levelTime ??= new Float64Array(FLOOR + 1));
  const cur = (keep.cur ??= {});          // knob values currently applied
  const tgt = {};
  let cullFull = 0; // > 0: the next culler passes visit every object (set when the radius changes)
  const sessionStartT = { v: -1 };

  function targetFor(level, out) {
    for (const k of KNOBS) out[k] = D[k];
    for (let i = 1; i <= level && i <= FLOOR; i++) Object.assign(out, ladder[i - 1][1]);
    return out;
  }
  function inXR() { return !!(renderer.xr && renderer.xr.isPresenting); }

  function setKnob(k, v) {
    switch (k) {
      case 'fov': quality.foveation = v; if (inXR() && renderer.xr.setFoveation) { try { renderer.xr.setFoveation(v); } catch { /* ignore */ } } break;
      case 'cull': quality.cull = v; cullFull = 2; break; // a new radius: re-judge every object at once (cheap, no measuring)
      case 'density': quality.density = base.density * v; break;
      case 'lights': quality.maxLights = Math.min(base.maxLights, v); break;
      case 'anim': quality.animStride = v; break;
      case 'think': quality.fighterThink = v; break;
      case 'bloom': quality.bloomLive = v; if (quality.bloomPass) quality.bloomPass.enabled = !!v; break;
      case 'gore': {
        quality.gore = v;
        const caps = world.kit && world.kit.gore && world.kit.gore.caps;
        if (caps) {
          const b = (keep.goreBase ??= { parts: caps.parts, bleeds: caps.bleeds });
          caps.parts = Math.max(8, Math.round(b.parts * v)); caps.bleeds = Math.max(4, Math.round(b.bleeds * v));
        }
        break;
      }
      case 'oracle': quality.oracleMax = v; if (world.oracle && typeof world.oracle.limitQuality === 'function') { try { world.oracle.limitQuality(v >= 2 ? null : v); } catch { /* hook not ready */ } } break;
      default: quality[k] = v;
    }
  }

  function applyLevel(reason) {
    targetFor(gov.level, tgt);
    let changed = null;
    for (const k of KNOBS) {
      if (cur[k] === tgt[k]) continue;
      (changed ??= {})[k] = tgt[k];
      cur[k] = tgt[k];
      setKnob(k, tgt[k]);
    }
    quality.perfLevel = gov.level;
    keep.level = gov.level;
    updateBudget();
    if (changed) events.emit('quality:changed', { changed, level: gov.level, rung: gov.level ? ladder[gov.level - 1][0] : 'full', reason, tier: TIER });
    return changed;
  }

  function changeLevel(delta, why) {
    const from = gov.level - delta;
    history.push({ t: nowT, from, to: gov.level, why, ema: Math.round(gov.ema * 10) / 10 });
    if (history.length > 12) history.shift();
    changedAt = nowT;
    applyLevel(why);
    if (gov.floorFlag) onFloor();
  }

  function setMode(m) {
    if (!['auto', 'quality', 'performance', 'manual'].includes(m)) return mode;
    mode = m; keep.mode = m;
    if (m !== 'manual') { const s = store.read(); s.mode = m; store.write(s); }
    if (m === 'quality') gov.setBounds(0, 0);
    else if (m === 'performance') gov.setBounds(PERF_LEVEL[TIER], FLOOR);
    else gov.setBounds(0, FLOOR);
    applyLevel('mode ' + m);
    return mode;
  }

  // ---------------------------------------------------------------- frames that are not our fault
  // A frame interval above the budget only means "the scene is too heavy" when something we can measure is heavy. If the tab is hidden,
  // or the browser / compositor / headset runtime paces rAF below the display rate (a throttled pane, Link or ASW pacing, a monitor at a
  // lower refresh) while our own CPU time (module updates + render submit) AND the GPU timer are both far under budget, lowering
  // quality changes nothing: the governor then ignores those frames (and counts them as comfortable ones, so it can climb back).
  // Needs the GPU timer to rule the GPU out; without it (Quest) only a hidden tab is ignored.
  const EXT_WORK = 0.5; // both measures must be under this fraction of the budget
  let extEma = 0, extFrames = 0, shownAt = -9;
  const hiddenNow = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  const isExternal = (ms, work, gpu) => ms > budgetMs * gov.cfg.missK && gpu >= 0 && work < budgetMs * EXT_WORK && gpu < budgetMs * EXT_WORK;
  // one frame into the ring / governor. work = js + render submit ms, gpu = timer ms or -1. Returns the governor's level change.
  function step(ms, t, work, gpu, hidden) {
    if (hidden || t - shownAt < 1.0) return 0;                 // a hidden tab (or the first second after it came back) says nothing
    const ext = isExternal(ms, work, gpu);
    extEma += ((ext ? 1 : 0) - extEma) * 0.02;
    if (ext) extFrames++;
    if (mode === 'manual') return 0;
    return ext ? gov.frame(budgetMs * 0.9, t, work / budgetMs, gpu / budgetMs) : gov.frame(ms, t, work > 0 ? work / budgetMs : -1, gpu >= 0 ? gpu / budgetMs : -1);
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    const onVis = () => { if (document.visibilityState === 'hidden') { lastT = -1; } else { shownAt = nowT; lastT = -1; gov.resetWindow(); } };
    document.addEventListener('visibilitychange', onVis);
    ctx.onDispose(() => document.removeEventListener('visibilitychange', onVis));
  }

  // ---------------------------------------------------------------- display refresh / frame-rate management
  const xrSession = () => (inXR() ? renderer.xr.getSession() : null);
  let rateTried = 0, rateFailUntil = 0, rateBackoff = 60, rateUpAt = 0;
  function refreshBudget() {
    const s = xrSession();
    let hz;
    if (s) {
      hz = s.frameRate;
      if (!(hz > 0)) { // no session.frameRate: infer the display rate from the fastest 10 % of frames (a missed vsync only makes frames longer)
        if (ringN >= 120) { const f = 1000 / pctl(0.1); for (const r of HZ_SNAP) if (Math.abs(f - r) / r < 0.06) estHz = r; }
        hz = estHz || (PC ? 90 : 72);
      }
    } else hz = flatHz;
    if (hz !== curHz) { curHz = hz; budgetMs = 1000 / hz; gov.setBudget(budgetMs); gov.resetWindow(); }
  }
  function setFrameRate(hz) {
    const s = xrSession();
    if (!s || typeof s.updateTargetFrameRate !== 'function') return false;
    try { const p = s.updateTargetFrameRate(hz); if (p && p.catch) p.catch(() => {}); } catch { return false; }
    rateUpAt = nowT;
    return true;
  }
  const supported = () => { const s = xrSession(); return s && s.supportedFrameRates ? Array.from(s.supportedFrameRates).sort((a, b) => a - b) : []; };
  function rateStepDown() { // before sacrificing visuals: 90 -> 72
    const s = xrSession();
    if (!s || !(s.frameRate > 72)) return false;
    const lower = supported().filter((r) => r < s.frameRate).pop();
    if (!lower) return false;
    rateFailUntil = nowT + rateBackoff; rateBackoff = Math.min(rateBackoff * 2, 900);
    changedAt = nowT;
    history.push({ t: nowT, from: -1, to: -1, why: 'frame rate ' + s.frameRate + ' -> ' + lower, ema: Math.round(gov.ema * 10) / 10 });
    return setFrameRate(lower);
  }
  function rateStepUp() { // Link / PC only: more fps when there is plenty of headroom
    if (!PC || gov.level !== 0 || nowT < rateFailUntil) return false;
    const s = xrSession();
    if (!s || !(s.frameRate > 0)) return false;
    const higher = supported().filter((r) => r > s.frameRate)[0];
    if (!higher || cpuFrac() > 0.5 || (gpuMs >= 0 && gpuMs / budgetMs > 0.5)) return false;
    return setFrameRate(higher);
  }

  // ---------------------------------------------------------------- timing hooks: render CPU/GPU, per-module JS time
  let renderAcc = 0, renderMs = 0, jsMs = 0, gpuMs = -1, gpuEma = -1;
  const cpuFrac = () => ((jsMs + renderMs) > 0 ? (jsMs + renderMs) / budgetMs : -1);
  const recs = []; // per-module timing records
  const recByPath = new Map();
  let wrapAt = 0;
  let gl = null, tq = null;
  const qFree = [], qBusy = []; // GPU timer queries
  let qActive = null, gpuFrame = 0, accFrame = -1, gpuAcc = 0;
  try {
    gl = renderer.getContext && renderer.getContext();
    tq = gl && gl.getExtension ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    if (!(tq && typeof gl.createQuery === 'function')) tq = null;
  } catch { tq = null; }

  let origRender = renderer.render;
  if (origRender.__perf) origRender = origRender.__perf; // unwrap a stale hook left by a previous instance of this module
  const hookedRender = function (a, b) {
    const t0 = NOW();
    let q = null;
    if (tq && !qActive && qBusy.length < 64) {
      q = qFree.pop() || gl.createQuery();
      gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
      qActive = q;
    }
    try { return origRender.call(this, a, b); } finally {
      if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); qActive = null; qBusy.push({ q, f: gpuFrame }); }
      renderAcc += NOW() - t0;
    }
  };
  hookedRender.__perf = origRender;
  renderer.render = hookedRender;

  function pollGpu() {
    if (!tq) return;
    const disjoint = gl.getParameter(tq.GPU_DISJOINT_EXT);
    while (qBusy.length) {
      const e = qBusy[0];
      if (!gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) break;
      qBusy.shift();
      if (!disjoint) {
        const ms = gl.getQueryParameter(e.q, gl.QUERY_RESULT) / 1e6;
        if (!(ms >= 0 && ms < 250)) { qFree.push(e.q); continue; } // a stalled / throttled tab: not a measure of our cost
        if (e.f !== accFrame) { if (accFrame >= 0) { gpuMs = gpuAcc; gpuEma = gpuEma < 0 ? gpuAcc : gpuEma + (gpuAcc - gpuEma) * 0.1; } accFrame = e.f; gpuAcc = 0; }
        gpuAcc += ms;
      }
      qFree.push(e.q);
    }
  }

  function wrapModules() {
    const mods = globalThis.game && globalThis.game.modules;
    if (!mods || typeof mods.entries !== 'function') return;
    for (const [path, m] of mods) {
      const inst = m && m.instance;
      if (!inst || typeof inst.update !== 'function' || inst.update.__perf || path === ctx.path) continue;
      let rec = recByPath.get(path);
      if (!rec) { rec = { path, name: path.replace(/^core\//, '').replace(/\.js$/, ''), acc: 0, last: 0, ema: 0 }; recByPath.set(path, rec); recs.push(rec); }
      const orig = inst.update;
      const w = function (dt, t) { const a = NOW(); try { return orig.call(this, dt, t); } finally { rec.acc += NOW() - a; } };
      w.__perf = orig;
      inst.update = w;
    }
  }
  function unwrapModules() {
    const mods = globalThis.game && globalThis.game.modules;
    if (!mods || typeof mods.values !== 'function') return;
    for (const m of mods.values()) { const u = m && m.instance && m.instance.update; if (u && u.__perf) m.instance.update = u.__perf; }
  }

  // ---------------------------------------------------------------- counts from services (2 Hz, may allocate)
  const C = { fighters: 0, projectiles: 0, particles: 0, bodies: 0, actors: 0, lights: 0, parts: 0, debris: 0, decals: 0, bleeds: 0, models: 0, animated: 0, mixers: 0, physics: 0 };
  let countsAt = -9;
  function refreshCounts(t) {
    if (t - countsAt < 0.5) return;
    countsAt = t;
    try {
      const k = world.kit && world.kit.stats && world.kit.stats();
      if (k) { C.particles = k.particles | 0; C.bodies = k.bodies | 0; C.actors = k.actors | 0; C.lights = k.lights | 0; C.parts = k.parts | 0; C.debris = k.debris | 0; C.decals = k.decals | 0; C.bleeds = k.bleeds | 0; }
      const cb = world.combat;
      if (cb) { C.fighters = cb.fighters ? cb.fighters.length : (cb.stats ? cb.stats().fighters | 0 : 0); const cs = cb.stats && cb.stats(); C.projectiles = cs ? cs.projectiles | 0 : 0; }
      const ms = world.models && world.models.stats && world.models.stats();
      if (ms) { C.models = ms.cached | 0; C.animated = ms.animated | 0; C.mixers = ms.mixers | 0; }
      const ps = world.physics && world.physics.stats && world.physics.stats();
      if (ps) C.physics = (ps.bodies | 0) || (ps.rigidBodies | 0) || 0;
    } catch { /* a service is mid-reload */ }
  }

  // ---------------------------------------------------------------- budgets and the population governor
  const budget = { fighters: 0, bodies: 0, particles: 0, actors: 0, drawCalls: 0, triangles: 0 };
  function updateBudget() {
    const b0 = BUDGET0[TIER], f = 1 - 0.6 * (gov.level / FLOOR);
    for (const k in b0) budget[k] = Math.round(b0[k] * f);
  }
  const views = () => (inXR() && renderer.xr.getCamera && renderer.xr.getCamera().cameras ? Math.max(1, renderer.xr.getCamera().cameras.length) : 1);
  function current(kind) {
    const r = renderer.info.render;
    switch (kind) {
      case 'fighters': return world.combat && world.combat.fighters ? world.combat.fighters.length : C.fighters;
      case 'bodies': return C.bodies;
      case 'particles': return C.particles;
      case 'actors': return C.actors;
      case 'drawCalls': return r.calls / views();
      case 'triangles': return r.triangles / views();
      default: return 0;
    }
  }
  const aliases = { fighter: 'fighters', enemy: 'fighters', enemies: 'fighters', npc: 'actors', npcs: 'actors', body: 'bodies', particle: 'particles', draws: 'drawCalls', draw: 'drawCalls', tris: 'triangles', triangle: 'triangles' };
  const norm = (kind) => aliases[kind] || kind;
  const headroom = (kind) => { kind = norm(kind); return kind in budget ? Math.max(0, budget[kind] - current(kind)) : Infinity; };
  const canSpawn = (kind, n = 1) => headroom(kind) >= n;
  const allow = (kind, n) => Math.max(0, Math.min(n | 0, Math.floor(headroom(kind))));

  // ---------------------------------------------------------------- distance culler (top-level objects under module roots)
  const EXEMPT = new Set(['module:core/world.js', 'module:core/oracle.js', 'module:core/style.js', 'module:core/perf.js', 'module:core/player.js',
    'module:core/spells.js', 'module:core/menu.js', 'module:core/commentary.js', 'module:core/quests.js', 'module:core/voices.js', 'module:core/audio.js', 'module:core/ambience.js']);
  const cullList = [], cullInfo = new WeakMap(), hidden = new Set();
  let cullIdx = 0, cullListAt = -9, cullOn = true, measuresLeft = 0;
  const _box = new THREE.Box3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  function rebuildCullList() {
    cullList.length = 0;
    const ch = scene.children;
    for (let i = 0; i < ch.length; i++) {
      const r = ch[i], n = r.name;
      if (!n || n.charCodeAt(0) !== 109 || !n.startsWith('module:') || EXEMPT.has(n)) continue;
      const c = r.children;
      for (let j = 0; j < c.length; j++) cullList.push(c[j]);
    }
    for (const o of hidden) if (!o.parent) hidden.delete(o); // removed while hidden
  }
  function measure(o, e) {
    if (!e) e = { ox: 0, oy: 0, oz: 0, r: 0, at: 0, skip: false };
    e.at = nowT; measuresLeft--;
    e.skip = !!(o.userData.noCull || o.isLight || o.isCamera || o.isPoints || o.isLine || o.isInstancedMesh || o.isSprite || (o.isMesh && o.frustumCulled === false) || o.userData.isOutline);
    if (!e.skip) {
      _box.setFromObject(o);
      if (_box.isEmpty()) e.skip = true;
      else {
        _box.getCenter(_v);
        _box.getSize(_w);
        const r = 0.5 * Math.hypot(_w.x, _w.y, _w.z);
        const m = o.matrixWorld.elements;
        e.ox = _v.x - m[12]; e.oy = _v.y - m[13]; e.oz = _v.z - m[14];
        e.r = r;
        if (r > 120) e.skip = true;                    // huge structures: cannot be judged by their centre
      }
    }
    cullInfo.set(o, e);
    return e;
  }
  function unhide(o) { o.visible = true; o.userData.perfCulled = false; hidden.delete(o); }
  function cullStep() {
    if (nowT - cullListAt > 1.0) { cullListAt = nowT; rebuildCullList(); }
    const n = cullList.length;
    if (!n) return;
    const R = quality.cull || 1e9, head = ctx.player.head;
    measuresLeft = 3; // Box3.setFromObject on a skinned character computes its bounds once: keep that off the frame budget
    let slice = cullFull > 0 ? n : Math.max(8, Math.ceil(n / 20));
    if (cullFull > 0) { cullFull--; cullIdx = 0; }
    while (slice-- > 0) {
      if (cullIdx >= n) cullIdx = 0;
      const o = cullList[cullIdx++];
      if (!o.parent) continue;
      let e = cullInfo.get(o);
      if (e === undefined) { if (measuresLeft <= 0) { cullIdx--; break; } e = measure(o, null); }
      else if (!e.skip && nowT - e.at > 6 && measuresLeft > 0) e = measure(o, e);
      if (e.skip) { if (o.userData.perfCulled && !o.visible) unhide(o); continue; }
      const m = o.matrixWorld.elements;
      const dx = m[12] + e.ox - head.x, dy = m[13] + e.oy - head.y, dz = m[14] + e.oz - head.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - e.r;
      const isHid = o.userData.perfCulled === true && !o.visible;
      if (cullOn && cullDecide(isHid, d, R)) {
        if (!isHid && o.visible) { o.visible = false; o.userData.perfCulled = true; hidden.add(o); }
      } else if (isHid) unhide(o);
    }
  }
  function uncullAll() { for (const o of hidden) { o.visible = true; o.userData.perfCulled = false; } hidden.clear(); }

  // ---------------------------------------------------------------- session / floor / reports
  let xrT0 = -1, sentMinute = false, lastFloorReport = -999, floorHit = false, lastSessionEnd = 0;
  function onFloor() {
    floorHit = true;
    gov.floorFlag = false;
    if (nowT - lastFloorReport > 180) { lastFloorReport = nowT; sendReport('governor at floor'); }
    events.emit('perf:floor', { level: gov.level, tier: TIER });
  }
  function sendReport(reason) {
    try { ctx.net.send({ type: 'perf_report', reason, tier: TIER, level: gov.level, xr: inXR(), hz: curHz, text: report() }); } catch { /* offline */ }
  }
  ctx.on('xr:start', () => {
    xrT0 = nowT; sentMinute = false; sessionWorst = 0; floorHit = false;
    levelTime.fill(0);
    setTimeout(() => {
      refreshBudget();
      const s = xrSession();
      if (!s) return;
      if (!PC && s.frameRate > 72) rateStepDown();
      if (cur.fov != null && renderer.xr.setFoveation) { try { renderer.xr.setFoveation(cur.fov); } catch { /* ignore */ } }
      try { s.addEventListener('frameratechange', () => { refreshBudget(); }); } catch { /* ignore */ }
      gov.resetWindow();
      // start the session a little leaner than where the last one ended
      const last = (store.read().last || {})[TIER];
      if (mode === 'auto' && last > 1 && gov.level < last - 2) { gov.force(last - 2); changeLevel(0, 'resume near last session level'); }
    }, 400);
  });
  ctx.on('xr:end', () => {
    if (xrT0 >= 0) { updateRecommendation(true); sendReport('session end'); }
    xrT0 = -1;
    refreshBudget();
  });

  // supersample for the NEXT session (framebuffer scale cannot change inside a session)
  const rec = (keep.rec ??= { supersample: base.supersample, reason: '' });
  function updateRecommendation(final) {
    const sess = xrT0 >= 0 ? nowT - xrT0 : 0;
    if (sess < 45) return;
    let total = 0, weighted = 0;
    for (let l = 0; l <= FLOOR; l++) { total += levelTime[l]; weighted += levelTime[l] * l; }
    const meanLevel = total > 0 ? weighted / total : 0;
    let v = base.supersample;
    try { v = parseFloat(localStorage.getItem(SS_KEY)) || v; } catch { /* no storage */ }
    let why = 'unchanged';
    if (extEma > 0.25) { why = 'rate limited externally, not by the scene'; }
    else if (floorHit || meanLevel > FLOOR * 0.55) { v *= 0.85; why = floorHit ? 'hit the floor' : 'mean level ' + meanLevel.toFixed(1); }
    else if (sess > 120 && meanLevel < 0.5 && gov.drops === 0 && pctl(0.95) < budgetMs * 0.8) { v *= 1.1; why = 'ran at level 0 with headroom'; }
    const lo = PC ? 0.8 : 0.6, hi = PC ? 1.8 : 1.0;
    v = Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
    rec.supersample = v; rec.reason = why;
    if (final) { try { localStorage.setItem(SS_KEY, String(v)); } catch { /* ignore */ } }
    const s = store.read(); (s.last ??= {})[TIER] = gov.level; s.ss = rec; store.write(s);
  }

  // ---------------------------------------------------------------- stats / report
  const S = {
    tier: TIER, mode, fps: 0, frameMs: 0, p50: 0, p95: 0, p99: 0, overPct: 0, worstMs: 0, hz: 72, budgetMs: 13.9, level: 0, floor: FLOOR, rung: 'full',
    calls: 0, tris: 0, points: 0, lines: 0, programs: 0, geometries: 0, textures: 0, cpuMs: 0, renderCpuMs: 0, gpuMs: -1, bound: '?', halfRate: false,
    culled: 0, external: 0, xr: false, drops: 0, recoveries: 0, hitches: 0, supersampleNext: 1, counts: C, // counts: fighters, bodies, particles (systems), actors, lights, parts, debris, animated, ...
  };
  let statsAt = -9;
  function stats() {
    const r = renderer.info;
    const v = views();
    S.calls = Math.round(r.render.calls / v); S.tris = Math.round(r.render.triangles / v); S.points = r.render.points; S.lines = r.render.lines;
    S.programs = r.programs ? r.programs.length : 0; S.geometries = r.memory.geometries; S.textures = r.memory.textures;
    if (nowT - statsAt > 0.25) {
      statsAt = nowT;
      S.p50 = pctl(0.5); S.p95 = pctl(0.95); S.p99 = pctl(0.99);
      let over = 0, worst = 0, lim = budgetMs * 1.25;
      for (let i = 0; i < ringN; i++) { const m = ring[i]; if (m > lim) over++; if (m > worst) worst = m; }
      worstWin = worst;
      S.overPct = ringN ? Math.round((1000 * over) / ringN) / 10 : 0;
      S.worstMs = Math.max(worst, 0);
    }
    S.tier = TIER; S.mode = mode; S.frameMs = frameEma; S.fps = frameEma > 0 ? 1000 / frameEma : 0;
    S.hz = curHz; S.budgetMs = budgetMs; S.level = gov.level; S.rung = gov.level ? ladder[gov.level - 1][0] : 'full';
    S.cpuMs = jsMs + renderMs; S.renderCpuMs = renderMs; S.gpuMs = tq && gpuEma >= 0 ? gpuEma : -1;
    S.halfRate = gov.halfRate; S.culled = hidden.size; S.xr = inXR();
    S.bound = gov.over ? (S.gpuMs > 0 && S.gpuMs > S.cpuMs ? 'gpu' : S.cpuMs > budgetMs * 0.85 ? 'cpu' : S.gpuMs > budgetMs * 0.85 ? 'gpu' : '?') : '-';
    S.external = Math.round(extEma * 100); S.drops = gov.drops; S.recoveries = gov.recoveries; S.hitches = gov.hitches; S.supersampleNext = rec.supersample;
    return S;
  }
  const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
  function report() {
    const s = stats();
    const mods = recs.slice().sort((a, b) => b.ema - a.ema).slice(0, 4).map((r) => r.name + ' ' + f1(r.ema)).join('  ');
    const L = [];
    L.push(`perf ${TIER} L${s.level}/${FLOOR} [${s.rung}] mode=${mode} ${s.xr ? 'xr' : 'flat'} ${s.hz}Hz budget ${f1(s.budgetMs)}ms fov=${cur.fov} grass=${cur.grass} cull=${cur.cull}m`);
    L.push(`fps ${f1(s.fps)} ema ${f1(s.frameMs)}ms p50 ${f1(s.p50)} p95 ${f1(s.p95)} p99 ${f1(s.p99)} worst ${Math.round(s.worstMs)}ms over ${s.overPct}% halfRate=${s.halfRate ? 'YES' : 'no'} hitches=${s.hitches}`);
    L.push(`draws/eye ${s.calls} tris/eye ${Math.round(s.tris / 1000)}k pts ${s.points} progs ${s.programs} geo ${s.geometries} tex ${s.textures} culled ${s.culled}${s.external > 5 ? ` | EXTERNAL PACING ${s.external}% of frames (cpu+gpu well under budget: browser / runtime limits the rate, not the scene)` : ''}`);
    L.push(`cpu ${f1(s.cpuMs)}ms (render submit ${f1(s.renderCpuMs)}) gpu ${s.gpuMs >= 0 ? f1(s.gpuMs) + 'ms' : 'n/a'} bound ${s.bound}  js: ${mods || 'n/a'}`);
    L.push(`kit particles ${C.particles} bodies ${C.bodies} actors ${C.actors} lights ${C.lights} parts ${C.parts} debris ${C.debris} | fighters ${C.fighters} proj ${C.projectiles} | anim ${C.animated}/${C.mixers} | budget f${budget.fighters} d${budget.drawCalls} t${Math.round(budget.triangles / 1000)}k`);
    L.push(`governor drops ${gov.drops} recoveries ${gov.recoveries} failedTrials ${gov.failures} | next supersample ${rec.supersample}${rec.reason ? ' (' + rec.reason + ')' : ''}`);
    if (history.length) L.push('history: ' + history.slice(-5).map((h) => `${Math.round(h.t)}s ${h.from}>${h.to} ${h.why}`).join(' | '));
    return L.join('\n');
  }

  // ---------------------------------------------------------------- mark / since: cost of what a creation added
  const marks = new Map();
  function snapshot() {
    const r = renderer.info;
    return { calls: r.render.calls / views(), tris: r.render.triangles / views(), geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs ? r.programs.length : 0, ms: frameEma, t: nowT, bodies: C.bodies, particles: C.particles, actors: C.actors };
  }
  function mark(name) { refreshCounts(nowT + 1); marks.set(name, snapshot()); return name; }
  function since(name) {
    const a = marks.get(name);
    if (!a) return null;
    refreshCounts(nowT + 1);
    const b = snapshot(), out = { seconds: b.t - a.t };
    for (const k of ['calls', 'tris', 'geometries', 'textures', 'programs', 'ms', 'bodies', 'particles', 'actors']) out[k] = Math.round((b[k] - a[k]) * 10) / 10;
    out.note = out.seconds < 0.5 ? 'wait a few frames after building before reading calls/tris/ms' : 'ok';
    return out;
  }

  // ---------------------------------------------------------------- debug overlay (canvas texture, redrawn <= 2 Hz)
  let ov = null, ovOn = !!keep.overlay, ovAt = -9;
  function buildOverlay() {
    const canvas = document.createElement('canvas');
    canvas.width = 400; canvas.height = 232;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.232), mat);
    mesh.renderOrder = 9999; mesh.frustumCulled = false; mesh.name = 'perf-overlay';
    mesh.userData = { noShadow: true, noOutline: true, noCull: true, noBlob: true, _shadowed: true };
    root.add(mesh);
    ov = { canvas, tex, mesh, g: canvas.getContext('2d') };
  }
  function drawOverlay() {
    const s = stats(), g = ov.g;
    g.fillStyle = 'rgba(6,8,16,0.78)'; g.fillRect(0, 0, 400, 232);
    const ok = s.p95 <= budgetMs * 1.25;
    g.fillStyle = ok ? '#7dffb0' : '#ff7d7d'; g.font = 'bold 40px monospace';
    g.fillText(`${Math.round(s.fps)} fps`, 12, 46);
    g.fillStyle = '#cfd8ff'; g.font = '19px monospace';
    g.fillText(`${s.hz}Hz  budget ${f1(s.budgetMs)}ms${s.halfRate ? '  HALF-RATE' : ''}`, 190, 22);
    g.fillText(`ema ${f1(s.frameMs)}  p95 ${f1(s.p95)}  p99 ${f1(s.p99)}`, 12, 78);
    g.fillText(`draws ${s.calls}  tris ${Math.round(s.tris / 1000)}k  progs ${s.programs}`, 12, 104);
    g.fillText(`cpu ${f1(s.cpuMs)}  gpu ${s.gpuMs >= 0 ? f1(s.gpuMs) : 'n/a'}  bound ${s.bound}`, 12, 130);
    g.fillText(`level ${s.level}/${FLOOR} ${s.rung}  ${mode}`, 12, 156);
    g.fillText(`over ${s.overPct}%  worst ${Math.round(s.worstMs)}ms  culled ${s.culled}`, 12, 182);
    g.fillText(`fight ${C.fighters}  bodies ${C.bodies}  part ${C.particles}  act ${C.actors}`, 12, 208);
    ov.tex.needsUpdate = true;
  }
  function overlay(on) {
    if (on === undefined) return ovOn;
    ovOn = !!on; keep.overlay = ovOn;
    if (ovOn && !ov && typeof document !== 'undefined') buildOverlay();
    if (ov) ov.mesh.visible = ovOn;
    ovAt = -9;
    return ovOn;
  }
  function placeOverlay() {
    ov.mesh.position.set(-0.26, -0.2, -0.8).applyMatrix4(camera.matrixWorld);
    camera.getWorldQuaternion(ov.mesh.quaternion);
  }

  // ---------------------------------------------------------------- recompute-on-event: external quality changes (menu etc.)
  // services that load or hot-reload after perf (kit, oracle) get the current gore caps / fractal limit again
  ctx.on('module:loaded', (e) => {
    const p = e && e.path;
    if (p === 'core/kit.js') setKnob('gore', cur.gore);
    else if (p === 'core/oracle.js') setKnob('oracle', cur.oracle);
  });

  // ---------------------------------------------------------------- public API
  const api = {
    get mode() { return mode; }, set mode(m) { setMode(m); },
    get level() { return gov.level; }, get floor() { return FLOOR; }, get tier() { return TIER; },
    get rung() { return gov.level ? ladder[gov.level - 1][0] : 'full'; },
    ladder: () => [['full', {}], ...ladder].map(([n, s]) => ({ name: n, set: s })),
    setLevel(l, why = 'manual') { const was = gov.level; setMode('manual'); gov.setBounds(0, FLOOR); gov.force(l); if (gov.level !== was) changeLevel(gov.level - was, why); return gov.level; },
    budget, canSpawn, allow, headroom,
    stats, report, mark, since, overlay,
    summary() { const s = stats(); return `${TIER} L${s.level}/${FLOOR} ${s.rung} ${Math.round(s.fps)}fps/${s.hz}Hz cpu ${f1(s.cpuMs)}ms gpu ${s.gpuMs >= 0 ? f1(s.gpuMs) + 'ms' : 'n/a'} ${s.calls} draws ${Math.round(s.tris / 1000)}k tris${s.external > 5 ? ' (rate limited externally)' : ''}`; },
    _test: { step, isExternal, get extFrames() { return extFrames; }, setShown(t) { shownAt = t; } },
    modules() { return recs.map((r) => ({ module: r.name, ms: Math.round(r.ema * 100) / 100 })).sort((a, b) => b.ms - a.ms); },
    recommended: () => ({ supersample: rec.supersample, reason: rec.reason }),
    setFrameRate: (hz) => setFrameRate(hz),
    setTarget(hz) { flatHz = hz; refreshBudget(); if (!xrSession()) { curHz = hz; budgetMs = 1000 / hz; gov.setBudget(budgetMs); gov.resetWindow(); } },
    tune(o) { Object.assign(gov.cfg, o); return gov.cfg; },
    cull(on) { if (on === undefined) return cullOn; cullOn = !!on; if (!cullOn) uncullAll(); return cullOn; },
    sendReport,
    get governor() { return gov; },
    get history() { return history; },
    get gpuTimer() { return !!tq; },
    get recent() { return ring; },
  };
  ctx.provide('perf', api);
  world.contextProviders && (world.contextProviders.perf = () => ({ tier: TIER, fps: Math.round(S.fps || 1000 / frameEma), level: gov.level }));
  ctx.onDispose(() => { if (world.contextProviders && world.contextProviders.perf) delete world.contextProviders.perf; });

  // ---------------------------------------------------------------- initial state
  setMode(mode === 'manual' ? 'auto' : mode);
  applyLevel('start');
  updateBudget();
  if (ovOn) overlay(true);
  refreshBudget();

  return {
    update(dt, t) {
      nowT = t;
      const ms = lastT < 0 ? 0 : (t - lastT) * 1000;
      lastT = t;
      if (hiddenNow()) { lastT = -1; return; } // a hidden tab: rAF is throttled to ~nothing, nothing to measure or react to
      frameN++;
      // publish last frame's CPU timings
      renderMs += (renderAcc - renderMs) * 0.1; renderAcc = 0;
      let js = 0;
      for (let i = 0; i < recs.length; i++) { const r = recs[i]; r.last = r.acc; r.acc = 0; r.ema += (r.last - r.ema) * 0.1; js += r.last; }
      jsMs += (js - jsMs) * 0.1;
      gpuFrame++;
      if (tq) pollGpu();
      if (t >= wrapAt) { wrapAt = t + 1; wrapModules(); }
      if (ms > 0 && ms < 1000) {
        // histogram ring
        const bi = Math.min(NBIN, (ms / BIN) | 0);
        if (ringN === WIN) hist[ringBin[ringI]]--; else ringN++;
        ring[ringI] = ms; ringBin[ringI] = bi; hist[bi]++;
        ringI = ringI + 1 === WIN ? 0 : ringI + 1;
        if (ms <= gov.cfg.hitchMs) frameEma += (ms - frameEma) * 0.05;
        if (ms > worstEver) worstEver = ms;
        if (ms > sessionWorst) sessionWorst = ms;
        if (inXR() && xrT0 >= 0) levelTime[gov.level] += ms * 0.001;
        if (mode !== 'manual') {
          const d = step(ms, t, jsMs + renderMs, tq && gpuEma >= 0 ? gpuEma : -1, hiddenNow());
          if (d > 0) {
            // before giving up visuals: lower the display rate (90 -> 72)
            if (rateStepDown()) { gov.force(gov.level - d); gov.resetWindow(); }
            else changeLevel(d, 'over budget: ema ' + f1(gov.ema) + 'ms bad ' + Math.round(gov.bad * 100) + '%' + (gov.halfRate ? ' half-rate' : ''));
          } else if (d < 0) {
            changeLevel(d, 'comfortably under budget ' + Math.round(gov.goodT) + 's');
          } else if (gov.floorFlag) onFloor();
          else if (PC && gov.level === 0 && t - rateUpAt > 20 && gov.goodT > 15 && rateStepUp()) { gov.resetWindow(); }
        }
      }
      refreshCounts(t);
      if (frameN % 30 === 0) refreshBudget();
      if (cullOn || hidden.size) cullStep();
      if (xrT0 >= 0 && !sentMinute && t - xrT0 > 60) { sentMinute = true; updateRecommendation(false); sendReport('60 s into session'); }
      if (xrT0 >= 0 && frameN % 600 === 0) updateRecommendation(false);
      if (ovOn) {
        if (!ov) overlay(true);
        if (ov) { placeOverlay(); if (t - ovAt > 0.5) { ovAt = t; drawOverlay(); } }
      }
    },
    dispose() {
      uncullAll();
      unwrapModules();
      if (renderer.render === hookedRender) renderer.render = origRender;
      if (tq) { for (const e of qBusy) gl.deleteQuery(e.q); for (const q of qFree) gl.deleteQuery(q); }
      if (ov) { ov.tex.dispose(); }
    },
  };
}
