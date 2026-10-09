// core/ambience.js — procedural wind + sacred drone + bell chimes; world.audio (core/audio.js) crossfades recorded ambience beds in by what stands around the player (forest, village, tavern, dungeon, ...).
//   world.ambience = { setVolume(v) 0..2 (1 default), setMood('serene' | 'luminous' | 'ominous'), getMood(), getVolume(), getZone() }.  Ducks while the Omnissiah speaks. Wind follows world.env.wind.
//   Also one draw call of drifting golden pollen motes around the player (day and golden hour only; fades out at night; hidden in mixed reality). world.ambience.pollen(0..2) scales it (0 = off).

export const meta = { name: 'Ambience', description: 'Procedural wind, drone, distant chimes and drifting pollen motes' };

const BASE_LEVEL = 0.5;

// ---- pollen: soft golden specks that drift through the late-afternoon light (one Points draw, positions computed in the vertex shader, nothing allocated per frame) ----
const POLLEN_VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uHead;
uniform float uGround;
uniform vec3 uSun;
uniform float uVpH;
varying float vA;
const vec3 BOX = vec3(24.0, 5.5, 24.0);
void main() {
  float t = uTime;
  vec3 base = aSeed.xyz * BOX;
  vec3 p = base + vec3(0.16 + 0.12 * aSeed.w, 0.025 + 0.05 * aSeed.x, -0.08 + 0.10 * aSeed.y) * t
    + vec3(sin(t * 0.5 + aSeed.x * 40.0) * 0.4, sin(t * 0.7 + aSeed.y * 30.0) * 0.25, cos(t * 0.45 + aSeed.z * 50.0) * 0.4);
  vec3 rel = mod(p - uHead + BOX * 0.5, BOX) - BOX * 0.5;
  vec3 w = vec3(uHead.x + rel.x, uGround + 0.3 + mod(p.y, BOX.y), uHead.z + rel.z);
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 0.01);
  float fade = smoothstep(0.7, 2.2, d) * (1.0 - smoothstep(10.0, 18.0, d));
  float glint = pow(max(dot(normalize(w - cameraPosition), uSun), 0.0), 3.0); // brighter when looking towards the sun
  vA = fade * (0.3 + 0.7 * glint) * (0.55 + 0.45 * sin(t * 1.3 + aSeed.w * 60.0));
  gl_PointSize = clamp(uVpH * 0.5 * projectionMatrix[1][1] * (0.07 + 0.10 * aSeed.w) / d, 2.0, 30.0);
}
`;
const POLLEN_FRAG = /* glsl */`
uniform vec3 uCol;
uniform float uAmt;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, r);
  a *= a;
  gl_FragColor = vec4(uCol, a * vA * uAmt * 0.6);
  #include <colorspace_fragment>
}
`;
function makePollen(ctx) {
  const { THREE } = ctx;
  const PC = !!(ctx.quality && ctx.quality.pc);
  const N = PC ? 300 : 110;
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const U = {
    uTime: { value: 0 }, uHead: { value: new THREE.Vector3() }, uGround: { value: 0 }, uSun: { value: new THREE.Vector3(0, 0.3, -1) },
    uVpH: { value: 1000 }, uCol: { value: new THREE.Color(1.0, 0.8, 0.45) }, uAmt: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: POLLEN_VERT, fragmentShader: POLLEN_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'pollen'; pts.frustumCulled = false; pts.renderOrder = 3; pts.visible = false;
  pts.userData = { noShadow: true, noOutline: true, noBlob: true, noCull: true, _shadowed: true };
  ctx.root.add(pts);
  const v2 = new THREE.Vector2(), vp = new THREE.Vector4();
  let amount = typeof ctx.state.pollen === 'number' ? ctx.state.pollen : 1, k = 0, vpAt = 0;
  return {
    set(v) { amount = Math.max(0, Math.min(2, +v || 0)); ctx.state.pollen = amount; },
    get: () => amount,
    update(dt, t) {
      const env = ctx.world && ctx.world.env;
      const tod = env && typeof env.timeOfDay === 'number' ? env.timeOfDay : 0.5;
      const want = (env && env.passthrough) ? 0 : amount * Math.min(1, Math.max(0, (tod - 0.5) / 0.25));
      k += (want - k) * (1 - Math.exp(-dt * 1.5));
      pts.visible = k > 0.01;
      if (!pts.visible) return;
      U.uAmt.value = k;
      U.uTime.value = t;
      const f = ctx.player && ctx.player.feet;
      if (f) { U.uHead.value.set(f.x, f.y, f.z); U.uGround.value = f.y; }
      if (env && env.sunDirection) U.uSun.value.copy(env.sunDirection);
      if (t >= vpAt) { // viewport height in pixels (per eye in a headset)
        vpAt = t + 1;
        let h = 0;
        const r = ctx.renderer;
        if (r.xr.isPresenting) { const c = r.xr.getCamera().cameras; if (c && c.length) { vp.copy(c[0].viewport); h = vp.w; } }
        if (!h) { r.getDrawingBufferSize(v2); h = v2.y; }
        U.uVpH.value = h || 1000;
      }
    },
    dispose() { ctx.root.remove(pts); geo.dispose(); mat.dispose(); },
  };
}

const MOODS = {
  serene: {
    root: 73.42, chord: [0, 7, 12, 14, 19, 24], gains: [0.50, 0.38, 0.30, 0.12, 0.16, 0.07], cutoff: 520,
    wind: 1.0, chimeRoot: 587.33, scale: [0, 2, 4, 7, 9], gap: [9, 22], amp: 1.0,
  },
  luminous: {
    root: 87.31, chord: [0, 7, 12, 16, 19, 23], gains: [0.45, 0.34, 0.30, 0.20, 0.20, 0.14], cutoff: 900,
    wind: 0.85, chimeRoot: 698.46, scale: [0, 2, 4, 7, 9, 11], gap: [5, 13], amp: 1.15,
  },
  ominous: {
    root: 65.41, chord: [0, 7, 12, 15, 19, 22], gains: [0.58, 0.42, 0.30, 0.20, 0.10, 0.08], cutoff: 360,
    wind: 1.2, chimeRoot: 523.25, scale: [0, 3, 5, 7, 10], gap: [16, 36], amp: 0.7,
  },
};
const ALIASES = {
  calm: 'serene', sacred: 'serene', peaceful: 'serene', idle: 'serene',
  bright: 'luminous', wonder: 'luminous', joy: 'luminous', happy: 'luminous',
  dark: 'ominous', tense: 'ominous', dread: 'ominous', danger: 'ominous',
};

export default function (ctx) {
  const pollen = makePollen(ctx);
  const ac = ctx.audio && ctx.audio.context;
  if (!ac) return { update: pollen.update, dispose: pollen.dispose };
  const state = ctx.state;

  let volume = typeof state.volume === 'number' ? state.volume : 1;
  let moodName = MOODS[state.mood] ? state.mood : 'serene';
  let duck = 1;
  let disposed = false;
  let wasRunning = false;

  const nodes = [];   // everything permanent, for disposal
  const sources = []; // started sources (stop on dispose)
  const track = (n) => { nodes.push(n); return n; };
  const gain = (v) => { const g = track(ac.createGain()); g.gain.value = v; return g; };
  const filt = (type, f, q) => {
    const b = track(ac.createBiquadFilter());
    b.type = type; b.frequency.value = f; if (q !== undefined) b.Q.value = q;
    return b;
  };
  const osc = (type, f) => {
    const o = track(ac.createOscillator());
    o.type = type; o.frequency.value = f; sources.push(o);
    return o;
  };

  // ---- master -------------------------------------------------------------------------------
  const master = gain(0);
  master.connect(ac.destination);

  // ---- reverb (generated impulse: dark, exponentially decaying stereo noise) ----------------------
  const reverbIn = gain(1);
  const convolver = track(ac.createConvolver());
  {
    const sr = ac.sampleRate, len = Math.floor(sr * 2.6);
    const ir = ac.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const x = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.0);
        y += 0.35 * (x - y); // one-pole lowpass keeps the tail soft
        d[i] = y;
      }
    }
    convolver.buffer = ir;
  }
  const reverbOut = gain(0.7);
  reverbIn.connect(convolver); convolver.connect(reverbOut); reverbOut.connect(master);

  // ---- wind ---------------------------------------------------------------------------------
  const noiseBuf = (() => {
    const sr = ac.sampleRate, len = Math.floor(sr * 6), xf = Math.floor(sr * 0.75);
    const buf = ac.createBuffer(1, len, sr), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) { // pink noise (Paul Kellet)
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    for (let i = 0; i < xf; i++) { // crossfade so the loop (0 .. len-xf) is seamless
      const a = i / xf;
      d[i] = d[i] * a + d[len - xf + i] * (1 - a);
    }
    buf.loopEndSeconds = (len - xf) / sr;
    return buf;
  })();
  const noise = (rate) => {
    const s = track(ac.createBufferSource());
    s.buffer = noiseBuf; s.loop = true; s.loopStart = 0; s.loopEnd = noiseBuf.loopEndSeconds; s.playbackRate.value = rate;
    sources.push(s);
    s.start(0, Math.random() * noiseBuf.loopEndSeconds);
    return s;
  };

  const windBus = gain(0.35);
  windBus.connect(master);
  const rumbleLP = filt('lowpass', 190, 0.7);
  const rumbleG = gain(1.2);
  noise(0.93).connect(rumbleLP); rumbleLP.connect(rumbleG); rumbleG.connect(windBus);
  const airBP = filt('bandpass', 500, 0.6);
  const airG = gain(1.0);
  noise(1.07).connect(airBP); airBP.connect(airG); airG.connect(windBus);
  const whistleBP = filt('bandpass', 1400, 5);
  const whistleG = gain(0.0);
  noise(1.0).connect(whistleBP); whistleBP.connect(whistleG); whistleG.connect(windBus);
  {
    const lfo = osc('sine', 0.07), lg = gain(160);
    lfo.connect(lg); lg.connect(whistleBP.frequency); lfo.start();
  }

  // ---- drone: six voices, each a detuned pair, slowly breathing -------------------------------------
  const droneFilter = filt('lowpass', MOODS[moodName].cutoff, 0.4);
  const droneBus = gain(0.055);
  const droneSend = gain(0.5);
  droneFilter.connect(droneBus); droneBus.connect(master); droneBus.connect(droneSend); droneSend.connect(reverbIn);
  {
    const lfo = osc('sine', 0.033), lg = gain(140);
    lfo.connect(lg); lg.connect(droneFilter.frequency); lfo.start();
  }
  const voices = [];
  {
    const m = MOODS[moodName];
    for (let i = 0; i < m.chord.length; i++) {
      const f = m.root * Math.pow(2, m.chord[i] / 12);
      const g = gain(m.gains[i]);
      const type = i < 3 ? 'triangle' : 'sine';
      const a = osc(type, f), b = osc(type, f);
      a.detune.value = -5; b.detune.value = 5;
      a.connect(g); b.connect(g); g.connect(droneFilter);
      const lfo = osc('sine', 1 / (17 + i * 6.5)), lg = gain(m.gains[i] * 0.5);
      lfo.connect(lg); lg.connect(g.gain);
      a.start(); b.start(); lfo.start();
      voices.push({ oscs: [a, b], gain: g, lfoGain: lg });
    }
  }
  let windMood = MOODS[moodName].wind;

  function applyMood(name, instant) {
    const m = MOODS[name], now = ac.currentTime, tc = instant ? 0.01 : 1.8;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i], f = m.root * Math.pow(2, m.chord[i] / 12);
      v.oscs[0].frequency.setTargetAtTime(f, now, tc);
      v.oscs[1].frequency.setTargetAtTime(f, now, tc);
      v.gain.gain.setTargetAtTime(m.gains[i], now, tc);
      v.lfoGain.gain.setTargetAtTime(m.gains[i] * 0.5, now, tc);
    }
    droneFilter.frequency.setTargetAtTime(m.cutoff, now, tc);
    windMood = m.wind;
  }

  // ---- chimes -------------------------------------------------------------------------------
  const chimeBus = gain(0.07);
  const chimeSend = gain(1.0);
  chimeBus.connect(master); chimeBus.connect(chimeSend); chimeSend.connect(reverbIn);
  const chimes = new Set();
  const PARTIALS = [[1, 1, 1], [2.76, 0.28, 0.5], [5.4, 0.1, 0.25]]; // ratio, level, decay multiplier

  function strike(freq, when, amp, dur, panV) {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200;
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    const bundle = { nodes: [lp], oscs: [], remaining: PARTIALS.length };
    if (pan) { pan.pan.value = panV; lp.connect(pan); pan.connect(chimeBus); bundle.nodes.push(pan); } else lp.connect(chimeBus);
    for (const [ratio, level, decay] of PARTIALS) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = freq * ratio;
      const end = when + dur * decay;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(amp * level, when + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(g); g.connect(lp);
      o.onended = () => {
        try { o.disconnect(); g.disconnect(); } catch (e) { /* already gone */ }
        if (--bundle.remaining === 0) {
          for (const n of bundle.nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } }
          chimes.delete(bundle);
        }
      };
      o.start(when); o.stop(end + 0.1);
      bundle.oscs.push(o); bundle.nodes.push(g);
    }
    chimes.add(bundle);
  }

  function playChime() {
    const m = MOODS[moodName], now = ac.currentTime;
    const count = 1 + (Math.random() < 0.4 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0);
    const oct = Math.random() < 0.35 ? 2 : 1;
    const panV = Math.random() * 1.6 - 0.8;
    let when = now + 0.05;
    for (let i = 0; i < count; i++) {
      const deg = m.scale[Math.floor(Math.random() * m.scale.length)];
      strike(m.chimeRoot * oct * Math.pow(2, deg / 12), when, m.amp * (0.7 + Math.random() * 0.3), 3.5 + Math.random() * 2.5, panV);
      when += 0.35 + Math.random() * 0.55;
    }
  }

  // ---- pack beds: what is around the player picks a looping recorded bed (core/audio.js), the procedural wind/drone gives way ----
  let bedMix = 0;          // 0 = procedural only, 1 = a pack bed is carrying the soundscape
  let zone = state.zone || 'field', zoneCand = null, zoneCandT = 0, scanAcc = 0;
  const classCache = new Map();
  function classify(n) { // library instance name -> category (cached)
    let c = classCache.get(n);
    if (c === undefined) {
      c = /^(storm|rain)$/.test(n) ? n
        : /^tavern/.test(n) ? 'tavern'
        : /campsite|campfire|bonfire/.test(n) ? 'camp'
        : /dungeon|crypt|catacomb|cave/.test(n) ? 'dungeon'
        : /grave|tomb|cemetery|mausoleum|dead-tree|dead-forest/.test(n) ? 'grave'
        : /forest|grove|palm-grove/.test(n) ? 'forest6'
        : /tree|willow|cherry|bush/.test(n) ? 'tree'
        : /hut|cottage|church|blacksmith|barracks|lumber|market|bazaar|watermill|windmill|well|house|farm|inn$|village|castle|bridge|dock/.test(n) ? 'house'
        : '';
      classCache.set(n, c);
    }
    return c;
  }
  function scanZone() {
    const A = ctx.world.audio;
    if (!A || !A.bed) return;
    const f = ctx.player.feet, X = f.x, Z = f.z;
    let trees = 0, houses = 0, houseNear = 0, dTavern = 1e9, dCamp = 1e9, dDungeon = 1e9, dGrave = 1e9, storm = false, rain = false;
    for (const root of ctx.scene.children) {
      const rn = root.name;
      if (!rn || rn.charCodeAt(0) !== 109 /* m */) continue;
      const ch = root.children;
      if (/campfire/.test(rn) && ch.length) { const p = ch[0].position, d = Math.hypot(p.x - X, p.z - Z); if (d < dCamp) dCamp = d; }
      for (let i = 0; i < ch.length; i++) {
        const o = ch[i], n = o.name;
        if (!n || n.charCodeAt(0) !== 108 /* l */ || n.charCodeAt(1) !== 105 || n.charCodeAt(3) !== 58) continue; // 'lib:'
        let name = n.slice(4);
        const star = name.indexOf('*');
        if (star > 0) name = name.slice(0, star);
        const c = classify(name);
        if (!c) continue;
        if (c === 'storm') { storm = true; continue; }
        if (c === 'rain') { rain = true; continue; }
        const dx = o.position.x - X, dz = o.position.z - Z, d = Math.sqrt(dx * dx + dz * dz);
        if (c === 'tavern') { if (d < dTavern) dTavern = d; houses++; } else if (c === 'camp') { if (d < dCamp) dCamp = d; }
        else if (c === 'dungeon') { if (d < dDungeon) dDungeon = d; } else if (c === 'grave') { if (d < dGrave) dGrave = d; trees++; }
        else if (c === 'house') { if (d < 35) houses++; if (d < 12) houseNear++; }
        else if (c === 'forest6') { if (d < 40) trees += 6; } else if (c === 'tree' && d < 30) trees++;
      }
    }
    const env = ctx.world.env;
    let lake = false;
    if (env) {
      if (env.isWater && env.isWater(X, Z)) lake = true;
      else if (env.lake) lake = Math.hypot(env.lake.x - X, env.lake.z - Z) < env.lake.radius + 10;
    }
    let fighters = 0;
    const C = ctx.world.combat;
    if (C && C.fighters) for (const g of C.fighters) { if (g.alive && g.faction === 'enemy' && g.actor && Math.hypot(g.actor.position.x - X, g.actor.position.z - Z) < 40) fighters++; }
    const night = env && typeof env.timeOfDay === 'number' && env.timeOfDay < 0.28;
    const want = storm ? 'storm' : rain ? 'rain' : dTavern < 14 ? 'tavern' : dCamp < 12 ? 'campfire' : dDungeon < 20 ? 'dungeon' : dGrave < 25 ? 'graveyard'
      : fighters >= 4 ? 'battlefield' : lake ? 'lake' : (houses >= 2 || houseNear >= 1) ? 'village' : trees >= 5 ? 'forest' : night ? 'night' : 'field';
    if (want !== zone) {
      if (zoneCand !== want) { zoneCand = want; zoneCandT = 0; } else zoneCandT += 1.5;
      if (zoneCandT >= 3 || !A.stats().bed) { zone = want; state.zone = want; zoneCand = null; }
    } else zoneCand = null;
    A.setZone(zone);
    const bedName = { field: 'amb-wind', night: 'amb-night-field', forest: 'amb-forest', village: 'amb-village', tavern: 'amb-tavern', dungeon: 'amb-dungeon', graveyard: 'amb-graveyard',
      battlefield: 'amb-battlefield', storm: 'amb-storm', rain: 'amb-rain', campfire: 'amb-campfire', lake: 'amb-lake' }[zone];
    A.bed(bedName, { fade: 4 });
  }

  // ---- control -------------------------------------------------------------------------------
  function applyMaster(tc) {
    master.gain.setTargetAtTime(BASE_LEVEL * volume * duck, ac.currentTime, tc || 0.4);
  }
  applyMood(moodName, true);

  ctx.on('oracle:state', (s) => {
    duck = (s === 'speaking' || s === 'listening') ? 0.5 : 1;
    if (wasRunning) applyMaster(0.35);
  });

  const api = {
    moods: Object.keys(MOODS),
    setVolume(v) {
      volume = Math.max(0, Math.min(2, +v || 0));
      state.volume = volume;
      if (wasRunning) applyMaster(0.3);
    },
    setMood(name) {
      const key = MOODS[name] ? name : ALIASES[String(name).toLowerCase()];
      if (!key || !MOODS[key]) return false;
      moodName = key; state.mood = key;
      applyMood(key, false);
      return key;
    },
    getMood() { return moodName; },
    getVolume() { return volume; },
    getZone() { return zone; },
    pollen(v) { if (v !== undefined) pollen.set(v); return pollen.get(); },
  };
  ctx.provide('ambience', api);

  // ---- per frame (cheap: param updates at ~8 Hz, chime scheduling) ---------------------------------
  let acc = 0;
  let chimeTimer = 5 + Math.random() * 6;
  return {
    update(dt, t) {
      if (disposed) return;
      pollen.update(dt, t);
      const running = ac.state === 'running';
      if (running && !wasRunning) {
        // first audible moment (or after a resume): fade in gently
        const now = ac.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(0, now);
        applyMaster(2.5);
      }
      wasRunning = running;

      acc += dt;
      if (acc >= 0.12) {
        acc = 0;
        const env = ctx.world.env;
        const w = env && typeof env.wind === 'number'
          ? env.wind
          : 0.5 + 0.5 * (0.6 * Math.sin(t * 0.21 + 1.3 * Math.sin(t * 0.07)) + 0.4 * Math.sin(t * 0.53 + 2.0));
        const now = ac.currentTime;
        const A = ctx.world.audio;
        const bedOn = !!(A && A.stats && A.stats().bed && running);
        bedMix += ((bedOn ? 1 : 0) - bedMix) * 0.12; // ~1 s time constant at 8 Hz: the recorded bed fades the synthesised one down
        windBus.gain.setTargetAtTime((0.35 + 0.9 * w) * windMood * (1 - 0.75 * bedMix), now, 0.5);
        droneBus.gain.setTargetAtTime(0.055 * (1 - 0.55 * bedMix), now, 0.8);
        rumbleLP.frequency.setTargetAtTime(150 + 250 * w, now, 0.5);
        airBP.frequency.setTargetAtTime(380 + 700 * w, now, 0.5);
        whistleBP.frequency.setTargetAtTime(1000 + 900 * w, now, 0.5);
        whistleG.gain.setTargetAtTime(0.35 * w * w * w, now, 0.6);
      }

      scanAcc += dt;
      if (scanAcc >= 1.5) { scanAcc = 0; try { scanZone(); } catch (e) { console.warn('[ambience] zone scan failed', e); } }

      if (running) {
        chimeTimer -= dt;
        if (chimeTimer <= 0) {
          playChime();
          const g = MOODS[moodName].gap;
          chimeTimer = g[0] + Math.random() * (g[1] - g[0]);
        }
      }
    },
    dispose() {
      disposed = true;
      pollen.dispose();
      const live = ac.state === 'running';
      const now = ac.currentTime;
      if (live) {
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + 0.15);
      }
      const stopAt = live ? now + 0.2 : now;
      for (const s of sources) { try { s.stop(stopAt); } catch (e) { /* not started / already stopped */ } }
      for (const b of chimes) for (const o of b.oscs) { try { o.stop(stopAt); } catch (e) { /* ignore */ } }
      const finish = () => {
        for (const n of nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
        for (const b of chimes) for (const n of b.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
        chimes.clear();
      };
      if (live) setTimeout(finish, 350); else finish();
    },
  };
}
