// STABLE CORE: microphone streaming + the Omnissiah's voice.
//
// 1. Three ways to talk, all streaming mono Int16 PCM to the server per docs/CONTRACT.md:
//    hold    hold input.left.down.trigger (T on desktop); release to send.
//    tap     tap X on the left CONTROLLER (input.left.pressed('a'), not tracked hands) or press N: he listens until ~1.5 s of
//            silence after you speak (6 s grace for the first word); tap again cancels (nothing is sent). No name needed.
//    open    hands-free "voice activation" (default on, localStorage 'omnissiah.openmic', setOpenMic()): an energy VAD opens a
//            capture when real speech starts (>= 300 ms; clicks and coughs never do). The capture is sent with open:true and the
//            SERVER only acts when the transcript contains his name. A rolling 1 s pre-roll in the capture node means the first
//            word is not clipped. Never starts while he speaks, while the server is busy, or while loud game audio plays.
//    Also wires the #chat box (Enter = utterance_text, /undo, /reset).
//    'listening' on oracle:state is only emitted once a capture is real (hold/tap at once, open after 300 ms of speech).
//    A capture that is abandoned after audio was sent ends the server utterance cleanly (empty start + end, nothing to transcribe).
// 2. The voice: net:speak {text, audio} -> fetch + decode the plain SAPI wav, play it through the
//    "machine god" chain built in buildChain() below, queued in order.
//
// Extra events this module emits for sys/hud.js:
//   oracle:line {text, duration}   a queued line has started playing (duration in seconds)
//   oracle:line-end {text}         that line finished, or was cut off / dropped
// window.game.voice: { setStyle/getStyle/styles, setOpenMic/openMic, stopSpeech, speaking, tune, debug() }.
// voice.tune holds the microphone thresholds (live-editable from the console); voice.debug() shows the current VAD numbers.
//
// ----------------------------------------------------------------------------------------------
// VOICE TUNING. Everything is relative to the body voice at 1.0. Tune intelligibility first:
// if consonants get lost turn down reverbReturn / bodyReverbSend and the metal/shimmer dry levels.
//
// Two voices reach this chain: the real one (Chatterbox, server/plugins/voice.js: urls /tts/om_*.wav; already deep, 75-80 Hz
// fundamental, resonant) and the SAPI fallback (thin, robotic, needs a lot of help). Each has its own profile per STYLE:
//   'godlike' (default)  the full cathedral: halo, many-voices layer, sub swell, choir pad
//   'subtle'             the same ingredients at about a third of the level
//   'clean'              the voice almost as synthesised, a short room and nothing else
// voice.setStyle('godlike' | 'clean' | 'subtle') (persisted in localStorage 'omnissiah.voiceStyle'); event 'voice:set-style'
// does the same, and 'voice:style' is emitted whenever it changes. window.game.voice exposes the whole service.
// ----------------------------------------------------------------------------------------------
const STYLES = ['godlike', 'clean', 'subtle'];
const PROFILES = {
  // real voice: far less pitch-down, no octave-down mush (it is already at 75 Hz), little ring-mod, keep reverb + halo
  cb: {
    godlike: { bodyRate: 0.97, body: 1.0, shimmerDry: 0.09, shimmerReverb: 0.42, metalDry: 0.09, metalReverb: 0.12, sub: 0.10, bodyReverbSend: 0.34, reverbReturn: 0.30, padLevel: 0.30, subSwell: 0.18, lowShelfDb: 1.0, presenceDb: 4.0 },
    subtle: { bodyRate: 1.0, body: 1.0, shimmerDry: 0.03, shimmerReverb: 0.16, metalDry: 0.03, metalReverb: 0.05, sub: 0.04, bodyReverbSend: 0.18, reverbReturn: 0.18, padLevel: 0.10, subSwell: 0.07, lowShelfDb: 0.5, presenceDb: 3.5 },
    clean: { bodyRate: 1.0, body: 1.0, shimmerDry: 0, shimmerReverb: 0, metalDry: 0, metalReverb: 0, sub: 0, bodyReverbSend: 0.07, reverbReturn: 0.10, padLevel: 0, subSwell: 0, lowShelfDb: 0, presenceDb: 2.0 },
  },
  // fallback voice: the original heavy treatment
  sapi: {
    godlike: { bodyRate: 0.88, body: 1.0, shimmerDry: 0.10, shimmerReverb: 0.50, metalDry: 0.20, metalReverb: 0.20, sub: 0.40, bodyReverbSend: 0.40, reverbReturn: 0.32, padLevel: 0.35, subSwell: 0.22, lowShelfDb: 5, presenceDb: 3 },
    subtle: { bodyRate: 0.94, body: 1.0, shimmerDry: 0.05, shimmerReverb: 0.25, metalDry: 0.08, metalReverb: 0.08, sub: 0.18, bodyReverbSend: 0.25, reverbReturn: 0.20, padLevel: 0.12, subSwell: 0.09, lowShelfDb: 3, presenceDb: 3 },
    clean: { bodyRate: 0.97, body: 1.0, shimmerDry: 0, shimmerReverb: 0, metalDry: 0, metalReverb: 0, sub: 0.05, bodyReverbSend: 0.10, reverbReturn: 0.12, padLevel: 0, subSwell: 0, lowShelfDb: 2, presenceDb: 2 },
  },
};
const STYLE_KEY = 'omnissiah.voiceStyle';

const MIX = {
  master: 1.0,
  chime: 0.05,           // push-to-talk chime
};

const FX = {
  // body voicing
  bodyHighpassHz: 70, lowShelfHz: 150, lowShelfDb: 5, presenceHz: 2800, presenceDb: 3, presenceQ: 0.8,
  // octave-up shimmer (delay-line pitch shifter, so it stays time-aligned with the body)
  shimmerRatio: 2, shimmerWindow: 0.09, shimmerHighpassHz: 900, shimmerLowpassHz: 8000,
  // octave-down weight
  subRatio: 0.5, subWindow: 0.14, subLowpassHz: 320,
  // metallic many-voices layer
  ringHz: 52, ringBandLowHz: 250, ringBandHighHz: 3800,
  chorusDelays: [0.014, 0.022, 0.031], chorusRates: [0.31, 0.43, 0.57], chorusDepth: 0.004, chorusPan: [-0.7, 0, 0.7],
  // reverb
  reverbSeconds: 3.5, reverbRT60: 3.3, reverbPreDelay: 0.035, reverbSendHighpassHz: 250, reverbReturnLowpassHz: 5500,
  // bus dynamics
  compThreshold: -20, compKnee: 10, compRatio: 3.5, compAttack: 0.005, compRelease: 0.25, compMakeup: 1.25,
  limitThreshold: -2, limitRatio: 20, limitAttack: 0.002, limitRelease: 0.08,
  // line start
  startLead: 0.3,        // pad/sub swell leads the first word of a fresh line by this long
  levelGain: 5.5,        // analyser RMS -> 0..1 oracle:level
};

// push-to-talk
const MIN_HOLD_MS = 250;   // shorter presses are ignored (nothing is sent)
const TAIL_MS = 200;       // keep recording a little after release so the last word is not clipped
const CAPTURE_FRAME = 2048;
const RING_S = 1.2;        // seconds of audio the capture node always keeps (pre-roll)

// Microphone / voice-activation tuning. Thresholds are RMS of the mic signal (0..1). Not tuned on a headset: expose and adjust
// live through window.game.voice.tune (e.g. game.voice.tune.onMin = 0.02), watch game.voice.debug().
const TUNE = {
  onMin: 0.014, offMin: 0.008,       // absolute minimum level that counts as speech starting / continuing
  floorMul: 3.2, floorAdd: 0.004,    // speech starts above floor * floorMul + floorAdd (noise floor tracked continuously)
  offMul: 1.8, offAdd: 0.003,        // speech continues above floor * offMul + offAdd
  confirmMs: 300,                    // open mic: speech must last this long (gaps < gapMs bridged) before a capture starts
  gapMs: 220,                        // quiet gaps shorter than this stay part of one burst
  preLeadMs: 350,                    // audio kept before the first loud frame, on top of the detection delay
  holdPreMs: 120,                    // pre-roll for hold-to-talk (a fast talker starting with the press)
  openSilenceMs: 1000,               // open mic ends this long after the last speech ...
  openNameSilenceMs: 1400,           // ... or this long while the capture is still short (a pause after his name)
  tapSilenceMs: 1500, tapGraceMs: 6000, tapVoicedMs: 200,
  maxMs: 25000,                      // no hands-free / tap capture lasts longer
  coolMs: 700,                       // no hands-free start this soon after any capture ended
  speakGuardMs: 900,                 // ... or after he finished speaking (room echo, reverb tail)
  calibrateMs: 1200,                 // after the mic wakes, only measure the room for this long
  outLoudRms: 0.10, outHardRms: 0.35, outBleed: 0.4, // game audio gating (see sense())
};

// ---------------------------------------------------------------------------------------------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// The capture node ALWAYS keeps the last RING_S seconds; 'start' with pre = ms first posts that much history, then streams.
const CAPTURE_WORKLET = `
class OmniCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false; this.id = 0; this.n = 0;
    this.buf = new Int16Array(${CAPTURE_FRAME});
    this.ring = new Int16Array(Math.ceil(sampleRate * ${RING_S}));
    this.w = 0; this.filled = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.cmd === 'start') {
        this.id = m.id; this.n = 0;
        const want = Math.min(this.filled, Math.round((m.pre || 0) * sampleRate / 1000));
        if (want > 0) {
          const L = this.ring.length, out = new Int16Array(want);
          let r = (this.w - want + L) % L;
          for (let i = 0; i < want; i++) { out[i] = this.ring[r]; r = r + 1 === L ? 0 : r + 1; }
          this.port.postMessage({ id: m.id, buf: out.buffer, pre: true }, [out.buffer]);
        }
        this.on = true;
      } else if (m.cmd === 'stop') { this.flush(); this.on = false; this.port.postMessage({ id: m.id, done: true }); }
    };
  }
  flush() {
    if (this.n > 0) {
      const out = this.buf.slice(0, this.n).buffer;
      this.port.postMessage({ id: this.id, buf: out }, [out]);
      this.n = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const ring = this.ring, L = ring.length;
    let w = this.w;
    for (let i = 0; i < ch.length; i++) {
      let s = ch[i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      const v = s < 0 ? s * 32768 : s * 32767;
      ring[w] = v; w = w + 1 === L ? 0 : w + 1;
      if (this.on) {
        this.buf[this.n++] = v;
        if (this.n === this.buf.length) this.flush();
      }
    }
    this.w = w;
    this.filled = Math.min(L, this.filled + ch.length);
    return true;
  }
}
registerProcessor('omni-capture', OmniCapture);
`;

export function createVoice({ THREE, net, events, audio, input, hud, getContext }) {
  const ctx = audio.context;
  const safeContext = () => { try { return getContext(); } catch (err) { console.warn('[voice] getContext failed', err); return null; } };

  // ============================================================================================
  // Oracle state bookkeeping (what we emit on 'oracle:state')
  // ============================================================================================
  let serverState = 'idle';   // last state the server reported
  let lastState = 'idle';     // last state emitted by anyone
  let selfEmit = false;
  let speakingFlag = false;   // a line is playing (or about to) or the queue has more
  let activeCap = null;       // the capture in progress (null once it is done)

  const listening = () => !!activeCap && !activeCap.released;
  function effectiveState() {
    if (listening()) return 'listening';
    if (speakingFlag && serverState === 'idle') return 'speaking';
    return serverState;
  }
  function emitState(s) {
    selfEmit = true;
    try { lastState = s; events.emit('oracle:state', s); } finally { selfEmit = false; }
  }
  function refreshState() {
    const eff = effectiveState();
    if (eff !== lastState) emitState(eff);
  }
  events.on('net:status', (m) => { if (m && typeof m.state === 'string') serverState = m.state; });
  events.on('net:open', () => { serverState = 'idle'; });
  // Server states arrive as oracle:state too; if they would clobber listening/speaking, correct them
  // after the current dispatch (a nested emit would reorder what later listeners see).
  events.on('oracle:state', (s) => {
    if (selfEmit) return;
    lastState = s;
    if (effectiveState() !== s) queueMicrotask(refreshState);
  });

  // ============================================================================================
  // Microphone
  // ============================================================================================
  let mic = null;            // { stream, track }
  let micPromise = null;
  let micFailedAt = 0;
  let micNoticeShown = false;
  let hintShown = false;
  let capture = null;        // { start(id, preMs), stop(id), analyser, dispose() } once set up
  const caps = new Map();    // id -> capture record
  let capIdSeq = 0;
  let keyDown = false;       // hold-to-talk input (left trigger / T)

  function micNotice(text) {
    if (micNoticeShown) return;
    micNoticeShown = true;
    hud.show(text, 8, 'error');
  }

  async function setupCapture(stream) {
    const source = ctx.createMediaStreamSource(stream);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    silent.connect(ctx.destination);
    // energy meter for voice activation (an AnalyserNode is pulled by the browser even without an output)
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    analyser.connect(silent);

    if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
        try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        const node = new AudioWorkletNode(ctx, 'omni-capture', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit',
        });
        node.port.onmessage = (e) => onCaptureMessage(e.data);
        source.connect(node);
        node.connect(silent);
        return {
          analyser,
          start: (id, pre) => node.port.postMessage({ cmd: 'start', id, pre: pre || 0 }),
          stop: (id) => node.port.postMessage({ cmd: 'stop', id }),
          dispose: () => { try { node.port.onmessage = null; source.disconnect(); analyser.disconnect(); node.disconnect(); silent.disconnect(); } catch { /* ignore */ } },
        };
      } catch (err) {
        console.warn('[voice] AudioWorklet capture unavailable, using ScriptProcessor', err);
      }
    }

    // Fallback: ScriptProcessor (deprecated but universal). Keeps the same rolling history in whole frames.
    const sp = ctx.createScriptProcessor(CAPTURE_FRAME, 1, 1);
    const history = [];
    const maxFrames = Math.ceil((ctx.sampleRate * RING_S) / CAPTURE_FRAME) + 1;
    let currentId = 0;
    sp.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      const out = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const s = ch[i] < -1 ? -1 : ch[i] > 1 ? 1 : ch[i];
        out[i] = s < 0 ? s * 32768 : s * 32767;
      }
      history.push(out);
      if (history.length > maxFrames) history.shift();
      if (currentId) onCaptureMessage({ id: currentId, buf: out.slice().buffer });
    };
    source.connect(sp);
    sp.connect(silent);
    return {
      analyser,
      start: (id, pre) => {
        const k = Math.min(history.length, Math.ceil(((pre || 0) * ctx.sampleRate) / 1000 / CAPTURE_FRAME));
        if (k > 0) {
          const out = new Int16Array(k * CAPTURE_FRAME);
          for (let i = 0; i < k; i++) out.set(history[history.length - k + i], i * CAPTURE_FRAME);
          currentId = id;
          onCaptureMessage({ id, buf: out.buffer, pre: true });
        }
        currentId = id;
      },
      stop: (id) => { currentId = 0; setTimeout(() => onCaptureMessage({ id, done: true }), 0); },
      dispose: () => { try { sp.onaudioprocess = null; source.disconnect(); analyser.disconnect(); sp.disconnect(); silent.disconnect(); } catch { /* ignore */ } },
    };
  }

  function micReadyHint() {
    if (hintShown) return;
    hintShown = true;
    const vr = !!(input && input.presenting);
    const hold = vr ? 'hold the left trigger' : 'hold T';
    const tap = vr ? 'tap X' : 'tap N';
    hud.show(openMic ? `Microphone ready: say "Omnissiah, ...", ${tap}, or ${hold} to talk.` : `Microphone ready: ${hold} to talk, or ${tap} and speak.`, 7);
  }

  // Must be called from a user gesture the first time. Resolves true when the mic is ready.
  function ensureMic(force = false) {
    if (mic) return Promise.resolve(true);
    if (micPromise) return micPromise;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micNotice(window.isSecureContext === false
        ? 'Microphone needs HTTPS - type to the Omnissiah instead.'
        : 'No microphone available in this browser - type to the Omnissiah instead.');
      return Promise.resolve(false);
    }
    if (!force && micFailedAt && performance.now() - micFailedAt < 30000) return Promise.resolve(false);
    micPromise = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        const track = stream.getAudioTracks()[0];
        if (!track) throw new Error('no audio track');
        // The track stays enabled: frames are simply not forwarded unless the player is talking.
        // (Toggling track.enabled is unreliable on the Quest browser and can leave it silent.)
        track.addEventListener('ended', () => { if (mic && mic.track === track) resetMic('track ended'); });
        capture = await setupCapture(stream);
        mic = { stream, track };
        micFailedAt = 0;
        sense.active = false; // recalibrate the noise floor
        try { net.send({ type: 'client_log', text: `microphone ready: ${track.label} (${capture.analyser ? 'meter ok' : 'no meter'}, rate ${ctx.sampleRate})` }); } catch { /* ignore */ }
        micReadyHint();
        return true;
      } catch (err) {
        micFailedAt = performance.now();
        console.warn('[voice] microphone unavailable', err);
        try { net.send({ type: 'client_log', text: `microphone unavailable: ${err?.name} ${err?.message}` }); } catch { /* ignore */ }
        micNotice('Microphone blocked - allow it in the browser settings to speak, or type below.');
        return false;
      } finally {
        micPromise = null;
      }
    })();
    return micPromise;
  }

  let silentCaps = 0;
  function resetMic(reason) {
    console.warn('[voice] resetting microphone:', reason);
    for (const c of [...caps.values()]) if (c.mode !== 'hold' && !c.finishing) abortCap(c, 'mic reset');
    try { capture && capture.dispose && capture.dispose(); } catch { /* ignore */ }
    try { mic && mic.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    mic = null; capture = null; micFailedAt = 0; micNoticeShown = false;
    sense.active = false; sense.voice = false; openCand = null;
  }
  const micHealthy = () => !!(mic && capture && mic.track.readyState === 'live' && mic.track.enabled && !mic.track.muted);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    try { if (ctx.state !== 'running') ctx.resume(); } catch { /* ignore */ }
    if (mic && !micHealthy()) resetMic('unhealthy after resume');
  });

  // ---------------------------------------------------------------------------- level sensing (VAD + game output)
  let openMic = true;
  try { const v = localStorage.getItem('omnissiah.openmic'); if (v === '0') openMic = false; } catch { /* storage unavailable */ }
  const sense = {
    active: false, readyAt: 0, floor: 0.004, floorInit: false, rms: 0, onThr: 0.02, offThr: 0.01, voice: false,
    outFast: 0, outSlow: 0, gateUntil: 0, gated: false, coolUntil: 0,
    buf: new Float32Array(2048), obuf: new Float32Array(512),
  };
  let outAn = null;          // analyser on the game's master bus (everything except his own voice chain, which we know about directly)
  function ensureOutTap() {
    if (outAn) return;
    try {
      const g = audio.listener && audio.listener.gain;
      if (!g || typeof g.connect !== 'function') return;
      outAn = ctx.createAnalyser();
      outAn.fftSize = 512;
      outAn.smoothingTimeConstant = 0;
      g.connect(outAn);
    } catch (err) { outAn = null; console.warn('[voice] output meter unavailable', err); }
  }
  function rmsTail(a, n) {
    let s = 0;
    for (let i = a.length - n; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s / n);
  }
  // Called every frame while hands-free listening or a tap capture needs it. dtMs is clamped real time.
  function senseUpdate(now, dtMs) {
    if (!mic || !capture || !micHealthy()) { sense.voice = false; sense.active = false; return; }
    if (!sense.active) { sense.active = true; sense.readyAt = now + TUNE.calibrateMs; sense.floorInit = false; sense.voice = false; }
    const dtS = dtMs / 1000;
    ensureOutTap();
    // what the game itself is playing right now (SFX, music, NPCs): a fast and a slow envelope
    if (outAn) {
      outAn.getFloatTimeDomainData(sense.obuf);
      const o = rmsTail(sense.obuf, sense.obuf.length);
      sense.outFast += (o - sense.outFast) * (1 - Math.exp(-dtS / 0.06));
      sense.outSlow += (o - sense.outSlow) * (1 - Math.exp(-dtS / 4));
      // a loud transient (explosion, zap, thunder) or anything very loud: no hands-free start until it has died away
      if (sense.outFast > TUNE.outHardRms || (sense.outFast > TUNE.outLoudRms && sense.outFast > sense.outSlow * 1.8 + 0.02)) sense.gateUntil = now + 400;
    }
    sense.gated = now < sense.gateUntil;
    // the microphone
    capture.analyser.getFloatTimeDomainData(sense.buf);
    const n = clamp(Math.round(dtS * ctx.sampleRate * 1.2), 512, sense.buf.length);
    const rms = rmsTail(sense.buf, n);
    sense.rms = rms;
    // noise floor: follows quiet moments quickly, rises slowly (very slowly while it is "loud", so a steady new noise is absorbed in
    // about half a minute rather than being mistaken for speech forever)
    if (!sense.floorInit) { sense.floor = Math.min(rms, 0.06); sense.floorInit = true; }
    else if (rms < sense.floor) sense.floor += (rms - sense.floor) * (1 - Math.exp(-dtS / 0.4));
    else sense.floor += (Math.min(rms, 0.06) - sense.floor) * (1 - Math.exp(-dtS / (sense.voice ? 15 : 4)));
    const bleed = TUNE.outBleed * sense.outFast; // speakers leaking into the mic: speech has to stand above that
    sense.onThr = Math.max(TUNE.onMin, sense.floor * TUNE.floorMul + TUNE.floorAdd, bleed);
    sense.offThr = Math.max(TUNE.offMin, sense.floor * TUNE.offMul + TUNE.offAdd, bleed * 0.6);
    sense.voice = rms > (sense.voice ? sense.offThr : sense.onThr);
  }

  // ---------------------------------------------------------------------------- tap-to-talk and voice activation
  let tapKey = false;
  let pendingTap = 0;
  let openCand = null;       // { t0, lastVoice, voiced } while hands-free speech is being confirmed
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyN' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement;
    if (el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable)) return;
    tapKey = true;
  });
  function setOpenMic(on) {
    openMic = !!on;
    try { localStorage.setItem('omnissiah.openmic', openMic ? '1' : '0'); } catch { /* ignore */ }
    if (!openMic) {
      openCand = null;
      if (activeCap && activeCap.mode === 'open' && !activeCap.finishing) abortCap(activeCap, 'voice activation off');
    }
    return openMic;
  }

  function pulse(a, ms) { try { input && input.left && input.left.pulse && input.left.pulse(a, ms); } catch { /* ignore */ } }

  // X (left controller, not a tracked hand) or N: tap to talk, tap again to cancel.
  function handleTap() {
    const L = input && input.left;
    const tap = !!(L && !L.tracked && L.pressed && L.pressed('a')) || tapKey;
    tapKey = false;
    if (!tap) return;
    if (keyDown) return; // hold-to-talk owns the mic
    if (activeCap && activeCap.mode === 'tap' && !activeCap.finishing) {
      abortCap(activeCap, 'tap cancel');
      hud.show('Cancelled.', 1.5);
      pulse(0.3, 30);
      return;
    }
    if (!mic || pendingTap) {
      unlock();
      pendingTap = performance.now();
      hud.show('Waking the microphone...', 2.5);
      ensureMic(true).then((ok) => {
        const fresh = pendingTap && performance.now() - pendingTap < 12000;
        pendingTap = 0;
        if (ok && fresh) startTap();
      });
      return;
    }
    startTap();
  }
  function startTap() {
    if (mic && !micHealthy()) resetMic('unhealthy at tap');
    if (!mic || !capture) return;
    const prev = activeCap && !activeCap.finishing ? activeCap : null;
    const carry = prev && prev.mode === 'open' ? { pre: performance.now() - prev.t0 + 400, voiced: prev.voiced } : null; // keep what was already said
    openCand = null;
    stopSpeech(); // tapping interrupts him
    const cap = beginCapture({ mode: 'tap', pre: carry ? carry.pre : 0, voiced: carry ? carry.voiced : 0, carry: !!carry });
    if (cap) pulse(0.5, 40);
  }

  function canOpen(now) {
    return openMic && !!mic && sense.active && now >= sense.readyAt && net.connected && !keyDown && !activeCap && !pendingPress &&
      !speakingFlag && serverState === 'idle' && now >= sense.coolUntil && now - lastEndAt >= TUNE.speakGuardMs &&
      !sense.gated && ctx.state === 'running';
  }

  function stepOpen(now, dtMs) {
    if (!canOpen(now)) { openCand = null; return; }
    if (sense.voice) {
      if (!openCand) openCand = { t0: now, lastVoice: now, voiced: 0 };
      openCand.lastVoice = now; openCand.voiced += dtMs;
      if (openCand.voiced >= TUNE.confirmMs) {
        const c = openCand; openCand = null;
        beginCapture({ mode: 'open', pre: now - c.t0 + TUNE.preLeadMs, voiced: c.voiced });
      }
    } else if (openCand && now - openCand.lastVoice > TUNE.gapMs) openCand = null;
  }

  // Progress of a tap or hands-free capture: when has the speech ended?
  function stepCapture(cap, now, dtMs) {
    if (cap.mode === 'hold' || cap.finishing || cap.released) return;
    const age = now - cap.t0;
    if (sense.voice && now >= cap.armedAt) {
      cap.lastVoice = now; cap.voiced += dtMs;
      if (cap.onsetFrame == null) cap.onsetFrame = cap.liveFrames;
    } else if (!cap.ready && now - cap.lastVoice > TUNE.gapMs) { cap.voiced = 0; cap.onsetFrame = null; } // a cough or click does not count
    if (cap.mode === 'open') {
      // he started talking (or the server got busy): stop recording rather than record him
      if (speakingFlag || serverState !== 'idle') { endCap(cap); return; }
      const silence = cap.voiced < 1200 ? TUNE.openNameSilenceMs : TUNE.openSilenceMs;
      if (now - cap.lastVoice > silence || age > TUNE.maxMs) endCap(cap);
    } else { // tap
      if (!cap.ready && cap.voiced >= TUNE.tapVoicedMs) {
        cap.ready = true;
        if (!cap.sent && !cap.carry) cap.pending.splice(0, Math.max(0, (cap.onsetFrame ?? 0) - Math.ceil((TUNE.preLeadMs / 1000) * ctx.sampleRate / CAPTURE_FRAME) - 1)); // drop the leading silence
      }
      if (!cap.ready && age > TUNE.tapGraceMs) { abortCap(cap, 'no speech'); hud.show('I did not hear anything.', 2); return; }
      if (cap.ready && (now - cap.lastVoice > TUNE.tapSilenceMs || age > TUNE.maxMs)) endCap(cap);
    }
  }

  function endCap(cap) {
    if (cap.released || cap.finishing) return;
    cap.released = true;
    maybeSend(cap);
    finishCap(cap);
    refreshState();
  }

  function unlock() {
    try { if (ctx.state !== 'running') ctx.resume(); } catch { /* ignore */ }
    warm();
    ensureMic();
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'click']) {
    window.addEventListener(ev, unlock, { capture: true, passive: true });
  }

  // XR session start / controller select are user gestures too. boot.js exposes window.game.renderer.
  let xrHooked = false;
  function hookXr() {
    if (xrHooked) return;
    const xr = window.game && window.game.renderer && window.game.renderer.xr;
    if (!xr) return;
    xrHooked = true;
    const onSession = () => {
      unlock();
      const session = xr.getSession && xr.getSession();
      if (session) {
        session.addEventListener('selectstart', unlock);
        session.addEventListener('squeezestart', unlock);
      }
    };
    xr.addEventListener('sessionstart', onSession);
    if (xr.isPresenting) onSession();
  }

  // ---------------------------------------------------------------------------- hold-to-talk
  let wasDown = false;
  let pendingPress = false;
  let lastWarmAt = -1e9;

  function onPress() {
    unlock();
    if (mic && !micHealthy()) resetMic('unhealthy at press');
    if (mic) { beginHold(); return; }
    pendingPress = true;
    ensureMic(true).then((ok) => {
      if (pendingPress && ok && keyDown) { pendingPress = false; beginHold(); }
      else if (!ok) pendingPress = false;
    });
  }
  function beginHold() { openCand = null; return beginCapture({ mode: 'hold', pre: TUNE.holdPreMs }); }

  function onRelease() {
    pendingPress = false;
    const cap = activeCap;
    if (!cap || cap.mode !== 'hold' || cap.released) return;
    cap.released = true;
    const held = performance.now() - cap.t0;
    if (!cap.sent && held < MIN_HOLD_MS) {
      abortCap(cap, 'too short'); // too short: ignore the press entirely
    } else {
      maybeSend(cap);
      cap.tailTimer = setTimeout(() => finishCap(cap), TAIL_MS);
    }
    refreshState();
  }

  // ---------------------------------------------------------------------------- captures
  // o = { mode: 'hold' | 'tap' | 'open', pre: ms of history to include, voiced: ms of speech already confirmed }
  function beginCapture(o) {
    if (!mic || !capture) return null;
    if (activeCap && !activeCap.finishing) { // a press / tap during a previous capture
      if (activeCap.mode === 'hold') finishCap(activeCap); else abortCap(activeCap, 'superseded');
    }
    const now = performance.now();
    const cap = {
      id: ++capIdSeq, mode: o.mode, open: o.mode === 'open', t0: now, context: safeContext(),
      sent: false, aborted: false, released: false, finishing: false, endSent: false, pending: [], frames: 0, liveFrames: 0, peak: 0,
      watchdog: 0, tailTimer: 0, doneTimer: 0,
      ready: o.mode === 'open' || (o.mode === 'tap' && (o.voiced || 0) >= TUNE.tapVoicedMs), carry: !!o.carry,
      voiced: o.voiced || 0, lastVoice: now, onsetFrame: null, armedAt: o.mode === 'tap' && !o.pre ? now + 350 : now, // let the chime pass
    };
    caps.set(cap.id, cap);
    activeCap = cap;
    capture.start(cap.id, clamp(o.pre || 0, 0, RING_S * 1000 - 100));
    // Tell the voice plugin he is about to be needed: if the Chatterbox worker unloaded after idling, it reloads while the
    // player is still speaking and being transcribed. (Harmless if the server has no such plugin.)
    if (net.connected && performance.now() - lastWarmAt > 60000) { lastWarmAt = performance.now(); net.send({ type: 'voice_warm' }); }
    // Watchdog: a live mic delivers frames within a few tens of ms. None at all means the stream or
    // the audio graph died (headset slept, VR session changed) - rebuild it.
    cap.watchdog = setTimeout(() => {
      if (!cap.liveFrames && caps.has(cap.id) && !cap.aborted && !cap.finishing) {
        console.warn('[voice] no audio frames from the microphone; rebuilding capture');
        abortCap(cap, 'no frames');
        resetMic('no frames');
        if (cap.mode === 'hold' && keyDown) onPress();
      }
    }, 600);
    emitState('listening');
    if (cap.mode !== 'open') chime();
    return cap;
  }

  // Another capture's audio is still being closed on the server side: wait, so utterance starts never interleave.
  const sendBusy = (cap) => { for (const c of caps.values()) if (c !== cap && c.sent && !c.endSent) return true; return false; };

  // Frames are held back until the capture is real (hold: MIN_HOLD_MS; tap: speech heard; open: at once), then flushed in order.
  function maybeSend(cap) {
    if (cap.sent || cap.aborted) return;
    if (cap.mode === 'hold' ? performance.now() - cap.t0 < MIN_HOLD_MS : !cap.ready) return;
    if (!net.connected) {
      cap.aborted = true;
      if (cap.mode !== 'open') hud.show('Not connected to the server.', 2.5, 'error');
      return;
    }
    if (sendBusy(cap)) return;
    cap.sent = true;
    if (cap.mode === 'hold') stopSpeech(); // barge-in: once the press is real (>= MIN_HOLD_MS) the player is talking
    net.send({ type: 'utterance_audio_start', sampleRate: ctx.sampleRate, context: cap.context, open: cap.open });
    for (const b of cap.pending) net.sendBinary(b);
    cap.pending.length = 0;
  }

  function onCaptureMessage(m) {
    const cap = caps.get(m.id);
    if (!cap) return;
    if (m.done) { onCapDone(cap); return; }
    if (cap.aborted) return;
    cap.frames++;
    if (!m.pre) cap.liveFrames++;
    const pcm = new Int16Array(m.buf);
    for (let i = 0; i < pcm.length; i += 8) { const v = pcm[i] < 0 ? -pcm[i] : pcm[i]; if (v > cap.peak) cap.peak = v; }
    if (cap.sent) { net.sendBinary(m.buf); return; }
    cap.pending.push(m.buf);
    maybeSend(cap);
  }

  function finishCap(cap) {
    if (cap.finishing) return;
    cap.finishing = true;
    cap.released = true;
    clearTimeout(cap.tailTimer);
    if (capture) capture.stop(cap.id);
    cap.doneTimer = setTimeout(() => onCapDone(cap), 700); // worklet normally answers within a frame
    refreshState();
  }

  // Abandon a capture. If audio already went to the server, close that utterance with an empty one so nothing is transcribed
  // (the server replaces its buffer on a new utterance_audio_start and ignores an end with < 2 bytes).
  function abortCap(cap, why) {
    if (!cap || (cap.aborted && cap.finishing)) return;
    const wasSent = cap.sent && !cap.endSent;
    cap.aborted = true; cap.released = true; cap.pending.length = 0;
    if (wasSent && net.connected) {
      net.send({ type: 'utterance_audio_start', sampleRate: ctx.sampleRate, context: cap.context, open: cap.open });
      net.send({ type: 'utterance_audio_end' });
    }
    cap.endSent = true;
    cap.sent = false;
    cap.why = why;
    finishCap(cap);
  }

  function onCapDone(cap) {
    if (!caps.has(cap.id)) return;
    clearTimeout(cap.doneTimer);
    caps.delete(cap.id);
    if (cap.sent && !cap.aborted && !cap.endSent) {
      cap.endSent = true;
      if (net.connected) net.send({ type: 'utterance_audio_end' });
    }
    if (activeCap === cap) activeCap = null;
    clearTimeout(cap.watchdog);
    sense.coolUntil = performance.now() + TUNE.coolMs;
    if (cap.mode !== 'hold' && cap.sent && !cap.aborted) {
      try { net.send({ type: 'client_log', text: `${cap.mode} capture: ${((performance.now() - cap.t0) / 1000).toFixed(1)}s, speech ${Math.round(cap.voiced)} ms, peak ${cap.peak}, floor ${sense.floor.toFixed(4)}, on ${sense.onThr.toFixed(4)}` }); } catch { /* ignore */ }
    }
    // Sent a real press but the audio was (near) silent: the mic is not really delivering sound.
    if (cap.mode !== 'hold') { /* hands-free and tap captures only exist because sound was heard */ }
    else if (cap.sent && !cap.aborted && cap.frames > 0 && cap.peak < 60) {
      silentCaps++;
      hud.show(silentCaps > 1 ? 'Your microphone is silent - reconnecting it. Try again.' : 'I could not hear you - try again, a little louder.', 4, 'error');
      if (silentCaps > 1) { resetMic('silent audio'); ensureMic(true); }
    } else if (cap.sent && cap.peak >= 60) silentCaps = 0;
    refreshState();
  }

  // ---------------------------------------------------------------------------- chime
  function chime() {
    try {
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.value = MIX.chime;
      out.connect(ctx.destination);
      [[659.25, 0], [987.77, 0.09]].forEach(([f, dt]) => {
        for (const [mult, amp] of [[1, 1], [2, 0.18]]) {
          const o = ctx.createOscillator();
          const e = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = f * mult;
          e.gain.setValueAtTime(0.0001, t + dt);
          e.gain.linearRampToValueAtTime(amp, t + dt + 0.012);
          e.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.42);
          o.connect(e); e.connect(out);
          o.start(t + dt); o.stop(t + dt + 0.45);
          o.onended = () => { o.disconnect(); e.disconnect(); };
        }
      });
      setTimeout(() => out.disconnect(), 900);
    } catch (err) { console.warn('[voice] chime failed', err); }
  }

  // ============================================================================================
  // The machine-god voice chain
  //
  // One AudioBufferSourceNode per line (playbackRate P.bodyRate, see PROFILES; the gains in this diagram are the 'sapi'/'godlike' ones) feeds `voiceIn`. EVERY layer is
  // derived from that single node, so all layers share the same timeline. Octave shifts are done
  // with delay-line pitch shifters (a modulated DelayNode read by two Hann-crossfaded taps), not
  // by changing playbackRate, so the shimmer and sub layers stay in sync with the words.
  //
  //  voiceIn
  //   |- body:    highpass 70 -> lowshelf +5dB@150 -> peaking +3dB@2.8k -> bodyOut --------------> dryBus
  //   |                                                                              \-- x0.40 --> reverbSend
  //   |- shimmer: highpass 900 -> pitchShift(x2, 90ms window) -> lowpass 8k --- x0.10 -> dryBus
  //   |                                                                      \- x0.50 -> reverbSend
  //   |- metal:   bandpass-ish (hp250/lp3.8k) -> ring mod (52 Hz sine) -> 3 chorus voices
  //   |           (14/22/31 ms delays, LFO 0.31/0.43/0.57 Hz +-4 ms, panned -0.7/0/+0.7)
  //   |                                                         --- x0.20 -> dryBus, x0.20 -> reverbSend
  //   '- sub:     lowpass 320 -> pitchShift(x0.5, 140ms window) --- x0.40 -> dryBus
  //
  //  reverbSend -> highpass 250 -> 35 ms predelay -> Convolver (3.5 s synthetic IR) -> lowpass 5.5k
  //             -> wet(0.32) -> compIn
  //  dryBus -> AnalyserNode (oracle:level) -> compIn
  //  padBus (line-start choir pad + sub swell) -> compIn and -> reverbSend
  //  compIn -> compressor(-20 dB, 3.5:1) -> makeup -> limiter(-2 dB, 20:1) -> master -> destination
  // ============================================================================================
  let chain = null;
  const analyserData = new Float32Array(1024);

  // ---- style / profile: P holds the numbers of the line that is playing (or was last queued)
  let style = 'godlike';
  try { const s = localStorage.getItem(STYLE_KEY); if (STYLES.includes(s)) style = s; } catch { /* storage unavailable */ }
  let kind = 'cb';               // 'cb' (Chatterbox) | 'sapi'
  let P = PROFILES.cb[style];
  // Retunes the live graph to the numbers for this kind of voice + style. Called when a line starts and when the style changes.
  function applyProfile(k = kind) {
    kind = k;
    P = PROFILES[k][style];
    if (!chain || !chain.h) return;
    const t = ctx.currentTime, h = chain.h;
    const set = (param, v) => { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, 0.02); };
    set(h.body.gain, P.body); set(h.shimmerDry.gain, P.shimmerDry); set(h.shimmerReverb.gain, P.shimmerReverb);
    set(h.metalDry.gain, P.metalDry); set(h.metalReverb.gain, P.metalReverb); set(h.sub.gain, P.sub);
    set(h.bodyReverbSend.gain, P.bodyReverbSend); set(chain.wet.gain, P.reverbReturn);
    set(h.shelf.gain, P.lowShelfDb); set(h.pres.gain, P.presenceDb);
  }
  function setStyle(name) {
    if (!STYLES.includes(name)) return style;
    const changed = name !== style;
    style = name;
    try { localStorage.setItem(STYLE_KEY, style); } catch { /* ignore */ }
    applyProfile(kind);
    if (changed) events.emit('voice:style', style);
    return style;
  }

  // Delay-line pitch shifter. Output pitch ratio `ratio` with a loop period of T seconds.
  // Delay ramps at (1 - ratio) s/s: ratio 2 -> falls 1 s/s, ratio 0.5 -> rises 0.5 s/s.
  function makePitchShifter(ratio, T, startAt) {
    const sr = ctx.sampleRate;
    const n = Math.max(8, Math.round(T * sr));
    const D = Math.abs(ratio - 1) * T;                      // total delay excursion per period
    const ramp = ctx.createBuffer(1, n, sr);
    const win = ctx.createBuffer(1, n, sr);
    const r = ramp.getChannelData(0);
    const w = win.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const p = i / n;
      r[i] = ratio > 1 ? D * (1 - p) : D * p;
      const s = Math.sin(Math.PI * p);
      w[i] = s * s;                                         // Hann window; two taps half a period apart sum to 1
    }
    const input = ctx.createGain();
    const output = ctx.createGain();
    for (let k = 0; k < 2; k++) {
      const offset = (k * T) / 2;
      const delay = ctx.createDelay(D + 0.05);
      delay.delayTime.value = 0;
      const rs = ctx.createBufferSource();
      rs.buffer = ramp; rs.loop = true;
      rs.connect(delay.delayTime);
      const tap = ctx.createGain();
      tap.gain.value = 0;
      const ws = ctx.createBufferSource();
      ws.buffer = win; ws.loop = true;
      ws.connect(tap.gain);
      input.connect(delay); delay.connect(tap); tap.connect(output);
      rs.start(startAt, offset);
      ws.start(startAt, offset);
    }
    return { input, output };
  }

  // Procedural cathedral impulse response: stereo decaying noise whose brightness falls over time,
  // a few early reflections, soft onset, rumble removed, normalised to unit energy per channel.
  function makeImpulse() {
    const sr = ctx.sampleRate;
    const n = Math.floor(FX.reverbSeconds * sr);
    const buf = ctx.createBuffer(2, n, sr);
    const decayK = 6.9078 / FX.reverbRT60;
    const taps = [0.019, 0.031, 0.047, 0.067, 0.089, 0.121];
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let seed = 0x9e3779b9 ^ (c * 0x85ebca6b);
      const rnd = () => { // xorshift32 -> [-1, 1)
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        return ((seed >>> 0) / 4294967296) * 2 - 1;
      };
      let lp = 0, hp = 0;
      const hpA = 1 - Math.exp((-2 * Math.PI * 110) / sr);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const fc = 1300 + 7500 * Math.exp(-t / 0.7);
        const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
        lp += a * (rnd() - lp);
        hp += hpA * (lp - hp);
        const onset = t < 0.015 ? t / 0.015 : 1;
        d[i] = (lp - hp) * Math.exp(-t * decayK) * onset;
      }
      taps.forEach((tt, j) => {
        const idx = Math.floor((tt + c * 0.0037 * (j + 1)) * sr);
        if (idx < n) d[idx] += (j % 2 ? -1 : 1) * 0.35 * Math.pow(0.78, j);
      });
      let e = 0;
      for (let i = 0; i < n; i++) e += d[i] * d[i];
      const k = e > 0 ? 1 / Math.sqrt(e) : 1;
      for (let i = 0; i < n; i++) d[i] *= k;
    }
    return buf;
  }

  function biquad(type, freq, q, gainDb) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    if (gainDb !== undefined) f.gain.value = gainDb;
    return f;
  }
  const gainNode = (v) => { const gn = ctx.createGain(); gn.gain.value = v; return gn; };

  function buildChain() {
    if (chain) return chain;
    try {
      chain = buildFullChain();
    } catch (err) {
      console.error('[voice] full voice chain failed, using plain output', err);
      const voiceIn = gainNode(1);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const padBus = gainNode(1);
      voiceIn.connect(analyser); analyser.connect(ctx.destination);
      padBus.connect(ctx.destination);
      chain = { voiceIn, analyser, padBus, wet: gainNode(0) };
    }
    return chain;
  }

  function buildFullChain() {
    const t0 = ctx.currentTime + 0.1;
    const voiceIn = gainNode(1);

    // ---- bus
    const compIn = gainNode(1);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = FX.compThreshold; comp.knee.value = FX.compKnee; comp.ratio.value = FX.compRatio;
    comp.attack.value = FX.compAttack; comp.release.value = FX.compRelease;
    const makeup = gainNode(FX.compMakeup);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = FX.limitThreshold; limiter.knee.value = 0; limiter.ratio.value = FX.limitRatio;
    limiter.attack.value = FX.limitAttack; limiter.release.value = FX.limitRelease;
    const master = gainNode(MIX.master);
    compIn.connect(comp); comp.connect(makeup); makeup.connect(limiter); limiter.connect(master); master.connect(ctx.destination);

    const dryBus = gainNode(1);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    dryBus.connect(analyser); analyser.connect(compIn);

    // ---- reverb
    const reverbSend = gainNode(1);
    const rvHp = biquad('highpass', FX.reverbSendHighpassHz, 0.7);
    const rvPre = ctx.createDelay(0.2); rvPre.delayTime.value = FX.reverbPreDelay;
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = makeImpulse();
    const rvLp = biquad('lowpass', FX.reverbReturnLowpassHz, 0.7);
    const wet = gainNode(P.reverbReturn);
    reverbSend.connect(rvHp); rvHp.connect(rvPre); rvPre.connect(conv); conv.connect(rvLp); rvLp.connect(wet); wet.connect(compIn);

    // ---- pad bus (line-start swell): dry into the bus and into the reverb
    const padBus = gainNode(1);
    padBus.connect(compIn);
    padBus.connect(reverbSend);

    // ---- body
    const bodyHp = biquad('highpass', FX.bodyHighpassHz, 0.7);
    const bodyShelf = biquad('lowshelf', FX.lowShelfHz, undefined, P.lowShelfDb);
    const bodyPres = biquad('peaking', FX.presenceHz, FX.presenceQ, P.presenceDb);
    const bodyOut = gainNode(P.body);
    voiceIn.connect(bodyHp); bodyHp.connect(bodyShelf); bodyShelf.connect(bodyPres); bodyPres.connect(bodyOut);
    bodyOut.connect(dryBus);
    const bodyReverbSend = gainNode(P.bodyReverbSend);
    bodyOut.connect(bodyReverbSend).connect(reverbSend);

    // ---- octave-up shimmer
    const shHp = biquad('highpass', FX.shimmerHighpassHz, 0.7);
    const shift = makePitchShifter(FX.shimmerRatio, FX.shimmerWindow, t0);
    const shLp = biquad('lowpass', FX.shimmerLowpassHz, 0.7);
    voiceIn.connect(shHp); shHp.connect(shift.input); shift.output.connect(shLp);
    const shimmerDry = gainNode(P.shimmerDry), shimmerReverb = gainNode(P.shimmerReverb);
    shLp.connect(shimmerDry).connect(dryBus);
    shLp.connect(shimmerReverb).connect(reverbSend);

    // ---- metallic many-voices: ring mod + 3 detuned, panned chorus voices
    const mHp = biquad('highpass', FX.ringBandLowHz, 0.7);
    const mLp = biquad('lowpass', FX.ringBandHighHz, 0.7);
    const ring = gainNode(0);                 // gain driven entirely by the carrier => multiplication
    const carrier = ctx.createOscillator();
    carrier.type = 'sine'; carrier.frequency.value = FX.ringHz;
    carrier.connect(ring.gain); carrier.start(t0);
    voiceIn.connect(mHp); mHp.connect(mLp); mLp.connect(ring);
    const metalOut = gainNode(1 / Math.sqrt(FX.chorusDelays.length));
    FX.chorusDelays.forEach((base, i) => {
      const d = ctx.createDelay(0.1);
      d.delayTime.value = base;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = FX.chorusRates[i];
      const depth = gainNode(FX.chorusDepth);
      lfo.connect(depth); depth.connect(d.delayTime); lfo.start(t0 + i * 0.37);
      ring.connect(d);
      let tail = d;
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = FX.chorusPan[i] ?? 0;
        d.connect(p); tail = p;
      }
      tail.connect(metalOut);
    });
    const metalDry = gainNode(P.metalDry), metalReverb = gainNode(P.metalReverb);
    metalOut.connect(metalDry).connect(dryBus);
    metalOut.connect(metalReverb).connect(reverbSend);

    // ---- octave-down weight (only the thin SAPI voice really needs it)
    const subLp = biquad('lowpass', FX.subLowpassHz, 0.7);
    const subShift = makePitchShifter(FX.subRatio, FX.subWindow, t0);
    voiceIn.connect(subLp); subLp.connect(subShift.input);
    const subG = gainNode(P.sub);
    subShift.output.connect(subG).connect(dryBus);

    return {
      voiceIn, analyser, padBus, wet,
      h: { body: bodyOut, shimmerDry, shimmerReverb, metalDry, metalReverb, sub: subG, bodyReverbSend, shelf: bodyShelf, pres: bodyPres },
    };
  }

  function warm() {
    if (chain) return;
    try { buildChain(); } catch (err) { console.error('[voice] warm failed', err); }
  }

  // Quietly takes the reverb away on barge-in so the old tail does not talk over the player.
  function duckReverb() {
    if (!chain) return;
    const t = ctx.currentTime;
    chain.wet.gain.cancelScheduledValues(t);
    chain.wet.gain.setTargetAtTime(0, t, 0.06);
  }
  function unduckReverb() {
    if (!chain) return;
    const t = ctx.currentTime;
    chain.wet.gain.cancelScheduledValues(t);
    chain.wet.gain.setTargetAtTime(P.reverbReturn, t, 0.05);
  }

  // ---------------------------------------------------------------------------- line-start swell
  const swells = new Set();

  // Soft sub-bass swell + faint "ah" choir pad. k scales both (1 = fresh run of speech).
  function swell(t0, k) {
    if (P.padLevel <= 0.001 && P.subSwell <= 0.001) return; // 'clean' style: no pad, no swell
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(chain.padBus);
    const nodes = [];
    const track = (o) => { nodes.push(o); return o; };

    // sub-bass
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0, t0);
    subG.gain.linearRampToValueAtTime(P.subSwell * k, t0 + 0.55);
    subG.gain.setTargetAtTime(0, t0 + 0.8, 0.5);
    subG.connect(out);
    for (const [f, a] of [[55, 1], [110, 0.35]]) {
      const o = track(ctx.createOscillator());
      o.type = 'sine'; o.frequency.value = f;
      o.connect(gainNode(a)).connect(subG);
      o.start(t0); o.stop(t0 + 5);
    }

    // choir pad: detuned saws on a D minor stack, through vowel (ah) formant bandpasses
    const padSum = gainNode(0.2);
    const vib = track(ctx.createOscillator());
    vib.type = 'sine'; vib.frequency.value = 5.1;
    const vibG = gainNode(9); // cents
    vib.connect(vibG);
    [146.83, 220, 293.66, 349.23, 440].forEach((f, i) => {
      for (const det of [-6, 6]) {
        const o = track(ctx.createOscillator());
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det + i * 0.7;
        vibG.connect(o.detune);
        o.connect(padSum);
        o.start(t0); o.stop(t0 + 5);
      }
    });
    vib.start(t0); vib.stop(t0 + 5);
    const padEnv = ctx.createGain();
    padEnv.gain.setValueAtTime(0, t0);
    padEnv.gain.linearRampToValueAtTime(P.padLevel * k, t0 + 0.9);
    padEnv.gain.setTargetAtTime(0, t0 + 2.0, 0.7);
    for (const [f, q, a] of [[730, 5, 1], [1090, 6, 0.5], [2440, 8, 0.25]]) {
      padSum.connect(biquad('bandpass', f, q)).connect(gainNode(a)).connect(padEnv);
    }
    padEnv.connect(out);

    const handle = { out };
    swells.add(handle);
    nodes[0].onended = () => { // first sub oscillator ends with the rest (all stop at t0 + 5)
      swells.delete(handle);
      try { out.disconnect(); } catch { /* ignore */ }
    };
  }
  function fadeSwells() {
    const t = ctx.currentTime;
    for (const s of swells) {
      s.out.gain.cancelScheduledValues(t);
      s.out.gain.setTargetAtTime(0, t, 0.08);
    }
  }

  // ============================================================================================
  // Speech queue
  // ============================================================================================
  const queue = [];
  let pumping = false;
  let epoch = 0;          // bumped by stopSpeech(); in-flight work checks it
  let current = null;     // { kind: 'buf' | 'fake', stop() }
  let lastEndAt = 0;
  let level = 0;
  let levelWasEmitted = false;

  const loadBuffer = (url) =>
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((ab) => ctx.decodeAudioData(ab))
      .catch((err) => { console.warn('[voice] could not load', url, err); return null; });

  function endLine(item) {
    if (item.audio && !item.ended) {
      item.ended = true;
      events.emit('oracle:line-end', { text: item.text });
    }
  }

  function enqueue(msg) {
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    const url = typeof msg.audio === 'string' && msg.audio ? msg.audio : null;
    if (!text && !url) return;
    // Chatterbox lines are named om_*.wav by server/plugins/voice.js; anything else is the SAPI fallback voice.
    const item = { text, audio: !!url, promise: url ? loadBuffer(url) : null, ended: false, kind: url && /\/om_[0-9a-f]+\.wav/.test(url) ? 'cb' : 'sapi' };
    queue.push(item);
    speakingFlag = true;
    refreshState();
    pump();
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        const item = queue.shift();
        try { await playItem(item); } catch (err) { console.error('[voice] playback failed', err); }
        endLine(item);
      }
    } finally {
      pumping = false;
      lastEndAt = performance.now();
      speakingFlag = false;
      refreshState();
    }
  }

  function waitRunning(my, maxMs) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const check = () => {
        if (my !== epoch) return resolve(false);
        if (ctx.state === 'running') return resolve(true);
        if (performance.now() - t0 > maxMs) return resolve(false);
        try { ctx.resume(); } catch { /* needs gesture */ }
        setTimeout(check, 150);
      };
      check();
    });
  }

  async function playItem(item) {
    const my = epoch;
    const buf = item.promise ? await item.promise : null;
    if (my !== epoch) return;
    if (!buf) return playFallback(item, my);
    if (!(await waitRunning(my, 20000))) return;
    if (my !== epoch) return;
    buildChain();
    applyProfile(item.kind || 'sapi');

    const fresh = performance.now() - lastEndAt > 1500 && !current;
    const g = ctx.createGain();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bodyRate = P.bodyRate;
    src.playbackRate.value = bodyRate;
    src.connect(g); g.connect(chain.voiceIn);
    const t0 = ctx.currentTime + 0.04;
    swell(t0, fresh ? 1 : 0.4);
    unduckReverb();
    const startAt = t0 + (fresh ? FX.startLead : 0.15);
    const duration = buf.duration / bodyRate;
    src.start(startAt);

    return new Promise((resolve) => {
      let done = false;
      const finish = (disconnectNow) => {
        if (done) return;
        done = true;
        if (current === rec) current = null;
        const cleanup = () => { try { src.disconnect(); g.disconnect(); } catch { /* ignore */ } };
        if (disconnectNow) cleanup(); else setTimeout(cleanup, 400);
        resolve();
      };
      const rec = {
        kind: 'buf',
        stop() {
          const t = ctx.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setTargetAtTime(0, t, 0.025);
          try { src.stop(t + 0.12); } catch { /* not started */ }
          endLine(item);
          finish(false);
        },
      };
      current = rec;
      src.onended = () => finish(true);
      if (item.audio) events.emit('oracle:line', { text: item.text, duration });
    });
  }

  function playFallback(item, my) {
    // No decodable audio: browser speechSynthesis if it has a voice, else just hold the "speaking"
    // state (and a fake level for the fractal) for about as long as the line would take to read.
    return new Promise((resolve) => {
      if (my !== epoch) return resolve();
      let done = false;
      let timer = 0;
      let synth = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (current === rec) current = null;
        resolve();
      };
      const rec = {
        kind: 'fake',
        stop() { try { if (synth) speechSynthesis.cancel(); } catch { /* ignore */ } finish(); },
      };
      current = rec;
      const readTime = clamp(item.text.length * 0.065, 1.2, 14);
      try {
        if (item.text && typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
          const voices = speechSynthesis.getVoices();
          if (voices.length) {
            const u = new SpeechSynthesisUtterance(item.text);
            const v = voices.find((x) => /male|david|daniel|alex|mark|george/i.test(x.name) && /^en/i.test(x.lang)) ||
              voices.find((x) => /^en/i.test(x.lang));
            if (v) u.voice = v;
            u.pitch = 0.2; u.rate = 0.82; u.volume = 1;
            u.onend = u.onerror = finish;
            synth = true;
            speechSynthesis.speak(u);
          }
        }
      } catch (err) { console.warn('[voice] speechSynthesis failed', err); synth = false; }
      timer = setTimeout(rec.stop, (synth ? readTime * 1.6 + 5 : readTime) * 1000);
    });
  }

  // Barge-in / hard stop: silence the current line and drop everything queued.
  function stopSpeech() {
    const had = !!current || queue.length > 0;
    epoch++;
    for (const item of queue.splice(0)) endLine(item);
    if (current) current.stop();
    try { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); } catch { /* ignore */ }
    if (had) { duckReverb(); fadeSwells(); }
  }

  // ---------------------------------------------------------------------------- oracle:level
  function updateLevel(dt) {
    let target = 0;
    const active = !!current;
    if (current && current.kind === 'buf' && chain) {
      chain.analyser.getFloatTimeDomainData(analyserData);
      let s = 0;
      for (let i = 0; i < analyserData.length; i++) s += analyserData[i] * analyserData[i];
      target = clamp(Math.sqrt(s / analyserData.length) * FX.levelGain, 0, 1);
    } else if (current && current.kind === 'fake') {
      const t = performance.now() / 1000;
      target = clamp(0.32 + 0.22 * Math.sin(t * 13) + 0.14 * Math.sin(t * 5.3 + 1) + 0.08 * Math.sin(t * 31), 0, 1);
    }
    level += (target - level) * (1 - Math.exp(-dt * (target > level ? 28 : 9)));
    if (active || level > 0.003) {
      events.emit('oracle:level', level);
      levelWasEmitted = true;
    } else if (levelWasEmitted) {
      level = 0;
      events.emit('oracle:level', 0);
      levelWasEmitted = false;
    }
  }

  events.on('net:speak', (m) => { if (m) enqueue(m); });
  events.on('voice:set-style', (name) => { setStyle(name); }); // e.g. from the wrist menu or world.voices.setOmnissiahStyle()

  // ============================================================================================
  // Chat box
  // ============================================================================================
  const chat = document.getElementById('chat');
  if (chat) {
    chat.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { chat.blur(); return; }
      if (e.key !== 'Enter' || e.isComposing) return;
      const text = chat.value.trim();
      if (!text) return;
      chat.value = '';
      const lower = text.toLowerCase();
      if (!net.connected) { hud.show('Not connected to the server.', 3, 'error'); return; }
      if (lower === '/undo' || lower === '/reset') {
        net.send({ type: 'command', name: lower.slice(1) });
        hud.show(lower === '/undo' ? 'Undoing the last change…' : 'The Omnissiah forgets…', 2.5);
        return;
      }
      stopSpeech();
      if (hud.player) hud.player(text);
      net.send({ type: 'utterance_text', text, context: safeContext() });
    });
  }

  // ============================================================================================
  let lastTick = performance.now();
  const service = {
    update(dt) {
      hookXr();
      if (window.game && !window.game.voice) window.game.voice = service; // so modules (the wrist menu) can reach it
      const now = performance.now();
      const dtMs = clamp(now - lastTick, 0, 100);
      lastTick = now;
      keyDown = !!(input && input.left && input.left.down && input.left.down.trigger);
      handleTap();
      if (keyDown && !wasDown) onPress();
      else if (!keyDown && wasDown) onRelease();
      wasDown = keyDown;
      senseUpdate(now, dtMs);
      if (activeCap) {
        stepCapture(activeCap, now, dtMs);
        if (activeCap && !activeCap.sent && !activeCap.aborted && !activeCap.finishing) maybeSend(activeCap);
      } else stepOpen(now, dtMs);
      updateLevel(dt);
    },
    tune: TUNE,
    // Microphone state for tutorials: 'off' (not asked yet) | 'pending' (permission prompt / starting) | 'ready' | 'blocked' (denied or unavailable)
    get micState() { return mic ? (micHealthy() ? 'ready' : 'unhealthy') : micPromise ? 'pending' : micFailedAt ? 'blocked' : 'off'; },
    get micReady() { return micHealthy(); },
    // Current microphone numbers, for tuning with a real headset: game.voice.debug()
    debug() {
      return {
        openMic, mic: !!mic, healthy: micHealthy(), ctx: ctx.state, rms: +sense.rms.toFixed(4), floor: +sense.floor.toFixed(4),
        onThr: +sense.onThr.toFixed(4), offThr: +sense.offThr.toFixed(4), voice: sense.voice, out: +sense.outFast.toFixed(3), gated: sense.gated,
        serverState, speaking: speakingFlag, cap: activeCap ? { mode: activeCap.mode, sent: activeCap.sent, voiced: Math.round(activeCap.voiced) } : null,
      };
    },
    stopSpeech,
    get speaking() { return !!current; },
    // Omnissiah voice effect amount: 'godlike' (default) | 'clean' | 'subtle'. Persisted; setStyle returns the style now in effect.
    setStyle,
    getStyle: () => style,
    // Hands-free voice activation ("Omnissiah, ..."). Persisted.
    setOpenMic,
    get openMic() { return openMic; },
    styles: STYLES.slice(),
  };
  return service;
}
