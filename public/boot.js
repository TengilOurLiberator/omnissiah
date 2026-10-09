// STABLE CORE. The oracle cannot rewrite this file: it owns the renderer, the XR session, input
// polling and the hot module loader, so the headset stays in VR while everything under /game is
// swapped out underneath it. See docs/CONTRACT.md for the module API this file implements.
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createNet } from './sys/net.js';
import { createHud } from './sys/hud.js';
import { createVoice } from './sys/voice.js';

// ---------------------------------------------------------------- renderer / scene / rig
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // alpha: passthrough (mixed reality)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

// Quality tier. 'quest' = the headset's own mobile GPU (standalone browser). 'pc' = a desktop GPU, either
// flat on a monitor or driving the headset through Link, where there is power to spare. Modules read
// ctx.quality to scale themselves (density, shadows, shader detail). Override with ?quality=quest|pc.
const forcedTier = new URLSearchParams(location.search).get('quality');
const isMobileGpu = /OculusBrowser|Quest|Pico|Android|Mobile/i.test(navigator.userAgent);
const tier = forcedTier === 'quest' || forcedTier === 'pc' ? forcedTier : (isMobileGpu ? 'quest' : 'pc');
function storedSupersample(fallback) {
  try {
    const v = parseFloat(localStorage.getItem('omnissiah.supersample'));
    return v >= 0.5 && v <= 2 ? v : fallback;
  } catch { return fallback; }
}
const quality = {
  tier,
  pc: tier === 'pc',
  shadows: tier === 'pc',        // real-time shadow maps (world.js owns the sun light)
  bloom: tier === 'pc',          // flat desktop view only: post-processing cannot run inside a WebXR session
  supersample: storedSupersample(tier === 'pc' ? 1.4 : 1), // XR framebuffer scale (the perf governor may store a better one)
  shadowSweep: 0.5,              // seconds between shadow-flag sweeps on PC (perf may raise it)
  animStride: 1, fighterThink: 1, // multipliers the perf governor turns up under load
  density: tier === 'pc' ? 2.5 : 1,     // multiplier for grass, particles, crowds
  maxLights: tier === 'pc' ? 12 : 6,
  detail: tier === 'pc' ? 2 : 1,        // geometry/shader detail level: 1 low-poly, 2 rich
};
if (quality.pc) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.setFramebufferScaleFactor(quality.supersample);
} else {
  if (quality.supersample !== 1) renderer.xr.setFramebufferScaleFactor(quality.supersample);
  renderer.xr.setFoveation?.(0.5); // the perf governor raises this toward 1 only when it has to
}
document.body.prepend(renderer.domElement);
// Entering VR can fail silently (no runtime session, headset asleep, GPU mismatch): say why on the page.
function xrStatus(text, bad) {
  let el = document.getElementById('xr-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'xr-status';
    el.style.cssText = 'position:fixed;bottom:118px;left:50%;transform:translateX(-50%);max-width:70vw;padding:8px 14px;border-radius:6px;' +
      'background:rgba(0,0,0,.75);font:14px sans-serif;z-index:1000;text-align:center';
    document.body.appendChild(el);
  }
  el.style.color = bad ? '#ff9a8a' : '#bfe8ff';
  el.textContent = text;
  clearTimeout(xrStatus.t);
  xrStatus.t = setTimeout(() => el.remove(), bad ? 60000 : 8000);
}
if (navigator.xr?.requestSession) {
  const request = navigator.xr.requestSession.bind(navigator.xr);
  const NO_HEADSET = 'The PC cannot see the headset. In the headset: Quick Settings > Link > Launch (Meta Link, not Mixed Reality Link). ' +
    'This page will enter VR by itself once it connects.';
  let pending = null;
  navigator.xr.requestSession = (mode, init) => {
    if (pending) { xrStatus(NO_HEADSET, true); return Promise.reject(new Error('session request already pending')); } // a second click must not stack a second request
    xrStatus('Asking the headset for a session...');
    const slow = setTimeout(() => xrStatus(NO_HEADSET, true), 5000);
    pending = request(mode, init).then((s) => { clearTimeout(slow); pending = null; xrStatus('Session started: put the headset on.'); return s; },
      (err) => { clearTimeout(slow); pending = null; xrStatus(`Could not enter ${mode}: ${err?.name ?? ''} ${err?.message ?? err}`, true); throw err; });
    return pending;
  };
}
document.body.appendChild(VRButton.createButton(renderer, { optionalFeatures: ['hand-tracking'] }));
// On a PC with a headset attached (Link) the small button is easy to miss: a large one, and the V key.
if (!isMobileGpu && navigator.xr?.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (!ok) return;
    const enter = () => { if (!renderer.xr.isPresenting) document.getElementById('VRButton')?.click(); };
    const big = document.createElement('div'); // a div: index.html pins every body > button to the bottom
    big.textContent = 'ENTER VR  (or press V)';
    big.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:16px 34px;border:2px solid #8fd8ff;border-radius:10px;' +
      'background:rgba(10,20,40,.85);color:#fff;font:bold 20px sans-serif;cursor:pointer;z-index:1001;box-shadow:0 0 24px rgba(120,200,255,.6)';
    big.onclick = enter;
    document.body.appendChild(big);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyV' && !e.repeat && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? '')) enter();
    });
    renderer.xr.addEventListener('sessionstart', () => { big.style.display = 'none'; });
    renderer.xr.addEventListener('sessionend', () => { big.style.display = ''; });
  }).catch(() => {});
}

// Mixed reality (Quest 3 passthrough): the same game, drawn over the real room.
if (navigator.xr?.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-ar').then((ok) => {
    if (!ok) return;
    const b = document.createElement('button');
    b.textContent = 'ENTER MIXED REALITY';
    b.style.cssText = 'position:fixed;bottom:72px;left:50%;transform:translateX(-50%);padding:12px 18px;border:1px solid #fff;' +
      'border-radius:4px;background:rgba(0,0,0,.1);color:#fff;font:normal 13px sans-serif;opacity:.6;cursor:pointer;z-index:999';
    b.onclick = async () => {
      try {
        const session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures: ['local-floor', 'hand-tracking'] });
        await renderer.xr.setSession(session);
      } catch (err) { console.error('mixed reality unavailable', err); }
    };
    document.body.appendChild(b);
  }).catch(() => {});
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 4000);
camera.rotation.order = 'YXZ';
const rig = new THREE.Group(); // move/rotate this to move the player; never the camera
rig.name = 'rig';
camera.position.set(0, 1.6, 0);
rig.add(camera);
scene.add(rig);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setSize(window.innerWidth, window.innerHeight);
});

// Bloom for the flat desktop view (PC tier). Inside a headset session the scene renders directly.
let composer = null;
if (quality.bloom) {
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.5, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    quality.bloomPass = bloom; // strength / radius / threshold are tweakable live
  } catch (err) { console.warn('bloom unavailable', err); composer = null; }
}

// PC tier: everything solid casts and receives shadows without each module having to opt in.
// Opt out per object with userData.noShadow = true.
let shadowSweepAt = 0;
function sweepShadows(now) {
  if (!quality.shadows || now < shadowSweepAt) return;
  shadowSweepAt = now + (quality.shadowSweep || 0.5);
  scene.traverse((o) => {
    if (!o.isMesh || o.userData._shadowed) return;
    o.userData._shadowed = true;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || o.userData.noShadow || m.isShaderMaterial || m.isMeshBasicMaterial || m.transparent || m.depthWrite === false) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

renderer.xr.addEventListener('sessionstart', () => {
  const mode = renderer.xr.getSession()?.environmentBlendMode;
  input.passthrough = !!mode && mode !== 'opaque';
  events.emit('xr:start', { passthrough: input.passthrough });
});
renderer.xr.addEventListener('sessionend', () => {
  input.passthrough = false;
  events.emit('xr:end', {});
});

const listener = new THREE.AudioListener();
camera.add(listener);
const audio = { listener, context: listener.context };

// ---------------------------------------------------------------- events
function createEvents() {
  const map = new Map();
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(fn);
      return () => map.get(name)?.delete(fn);
    },
    off(name, fn) { map.get(name)?.delete(fn); },
    emit(name, payload) {
      for (const fn of [...(map.get(name) ?? [])]) {
        try { fn(payload); } catch (err) { console.error(`event "${name}" handler failed`, err); }
      }
    },
  };
}
const events = createEvents();

// ---------------------------------------------------------------- input
const BUTTONS = ['trigger', 'squeeze', 'a', 'b', 'stickPress'];
function makeHand(name) {
  const anchor = new THREE.Group(); // follows the hand every frame; attach wands/visuals here
  anchor.name = `hand-${name}`;
  rig.add(anchor);
  const hand = {
    name, connected: false, anchor,
    position: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, -1), quaternion: new THREE.Quaternion(),
    trigger: 0, squeeze: 0, stick: { x: 0, y: 0 },
    down: {}, _prev: {},
    pressed(b) { return !!this.down[b] && !this._prev[b]; },
    released(b) { return !this.down[b] && !!this._prev[b]; },
    // Finger tracking (Quest hand tracking). tracked is true while this hand is a bare hand, not a controller.
    tracked: false,
    fingers: {
      wrist: new THREE.Vector3(), palm: new THREE.Vector3(), thumb: new THREE.Vector3(), index: new THREE.Vector3(),
      middle: new THREE.Vector3(), ring: new THREE.Vector3(), pinky: new THREE.Vector3(),   // world-space tips
      palmNormal: new THREE.Vector3(0, -1, 0),                                               // out of the palm
      pinch: { index: 0, middle: 0, ring: 0, pinky: 0 },                                     // 0..1 against the thumb
      curl: { index: 0, middle: 0, ring: 0, pinky: 0 },                                      // 0 straight .. 1 curled
      gesture: 'none',                                                                       // 'open' | 'fist' | 'point' | 'pinch' | 'none'
    },
    _gamepad: null,
    // Haptic buzz on a controller: strength 0..1, milliseconds. Silently does nothing for bare hands/desktop.
    pulse(strength = 0.5, ms = 40) {
      const gp = this._gamepad;
      try {
        if (gp?.hapticActuators?.[0]?.pulse) gp.hapticActuators[0].pulse(Math.min(1, Math.max(0, strength)), ms);
        else if (gp?.vibrationActuator?.playEffect) gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength });
      } catch { /* no haptics */ }
    },
  };
  for (const b of BUTTONS) { hand.down[b] = false; hand._prev[b] = false; }
  return hand;
}
const input = { left: makeHand('left'), right: makeHand('right'), presenting: false, passthrough: false };

const xrControllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  c.addEventListener('connected', (e) => { c.userData.hand = e.data.handedness; c.userData.gamepad = e.data.gamepad; c.userData.isHand = !!e.data.hand; });
  c.addEventListener('disconnected', () => { c.userData.hand = null; c.userData.gamepad = null; c.userData.isHand = false; });
  rig.add(c);
  return c;
});

// Tracked hands: joint poses from WebXR plus a simple jointed model so the player sees their fingers.
const handModels = new XRHandModelFactory();
const xrHands = [0, 1].map((i) => {
  const h = renderer.xr.getHand(i);
  h.add(handModels.createHandModel(h, 'spheres'));
  rig.add(h);
  return h;
});
const TIP = { thumb: 'thumb-tip', index: 'index-finger-tip', middle: 'middle-finger-tip', ring: 'ring-finger-tip', pinky: 'pinky-finger-tip' };
const _hv1 = new THREE.Vector3(), _hv2 = new THREE.Vector3(), _hv3 = new THREE.Vector3();
const smooth01 = (x, lo, hi) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
// Reads finger joints into hand.fingers and turns gestures into the same buttons a controller has.
// Returns false while the joints are not available yet.
function pollTrackedHand(hand, H) {
  const j = H.joints;
  const F = hand.fingers;
  if (!j || !j.wrist || !j[TIP.index] || !j[TIP.thumb] || !j['middle-finger-metacarpal']) return false;
  j.wrist.getWorldPosition(F.wrist);
  for (const k in TIP) j[TIP[k]].getWorldPosition(F[k]);
  j['middle-finger-metacarpal'].getWorldPosition(_hv3);
  F.palm.copy(F.wrist).lerp(_hv3, 0.7);
  if (j['index-finger-metacarpal'] && j['pinky-finger-metacarpal']) {
    j['index-finger-metacarpal'].getWorldPosition(_hv1).sub(F.wrist);
    j['pinky-finger-metacarpal'].getWorldPosition(_hv2).sub(F.wrist);
    F.palmNormal.crossVectors(_hv1, _hv2).normalize();
    if (hand.name === 'left') F.palmNormal.negate();
  }
  let curled = 0, straight = 0;
  for (const k of ['index', 'middle', 'ring', 'pinky']) {
    F.pinch[k] = 1 - smooth01(F[k].distanceTo(F.thumb), 0.018, 0.055);
    const reach = k === 'pinky' ? 0.15 : 0.18; // tip-to-wrist distance of a straight finger, metres
    F.curl[k] = 1 - smooth01(F[k].distanceTo(F.wrist), 0.075, reach * 0.92);
    if (F.curl[k] > 0.65) curled++;
    if (F.curl[k] < 0.3) straight++;
  }
  const fist = curled === 4;
  const point = F.curl.index < 0.3 && F.curl.middle > 0.6 && F.curl.ring > 0.6 && F.curl.pinky > 0.6;
  F.gesture = fist ? 'fist' : point ? 'point' : F.pinch.index > 0.8 ? 'pinch' : straight === 4 ? 'open' : 'none';

  // Gestures -> buttons, with hysteresis so a hold does not flicker.
  const hold = (name, value) => { hand.down[name] = value > (hand._prev[name] ? 0.45 : 0.8); };
  hand.trigger = fist ? 0 : F.pinch.index;            // index pinch = trigger (a fist is a grab, not a pinch)
  hand.squeeze = Math.max(F.pinch.middle, fist ? 1 : 0); // fist or middle pinch = squeeze / grab
  hold('trigger', hand.trigger);
  hold('squeeze', hand.squeeze);
  hold('a', fist ? 0 : F.pinch.ring);                 // ring pinch = A
  hold('b', fist ? 0 : F.pinch.pinky);                // pinky pinch = B
  hand.down.stickPress = false;
  return true;
}

const keys = new Set();
const mouse = { left: false, right: false };
const typing = () => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
window.addEventListener('keydown', (e) => { if (!typing()) keys.add(e.code); });
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (renderer.xr.isPresenting) return;
  if (document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock?.(); return; }
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) mouse.right = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});
window.addEventListener('mousemove', (e) => {
  if (renderer.xr.isPresenting || document.pointerLockElement !== renderer.domElement) return;
  camera.rotation.y -= e.movementX * 0.0022;
  camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - e.movementY * 0.0022, -1.5, 1.5);
});

const _q = new THREE.Quaternion();
const _rigInv = new THREE.Matrix4();
function setHandWorld(hand, obj) {
  obj.updateWorldMatrix(true, false);
  hand.position.setFromMatrixPosition(obj.matrixWorld);
  obj.getWorldQuaternion(hand.quaternion);
  hand.direction.set(0, 0, -1).applyQuaternion(hand.quaternion).normalize();
}
function pollInput() {
  input.presenting = renderer.xr.isPresenting;
  for (const hand of [input.left, input.right]) {
    Object.assign(hand._prev, hand.down);
    hand.connected = false;
  }
  if (input.presenting) {
    for (let i = 0; i < xrControllers.length; i++) {
      const c = xrControllers[i];
      const hand = input[c.userData.hand];
      if (!hand) continue;
      if (c.userData.isHand) {
        // Bare hand: the system's pointing ray aims; finger gestures act as the buttons.
        hand._gamepad = null;
        hand.stick.x = 0; hand.stick.y = 0;
        if (!pollTrackedHand(hand, xrHands[i])) { hand.tracked = false; continue; }
        hand.tracked = true;
        hand.connected = true;
        setHandWorld(hand, c);
        hand.anchor.position.copy(c.position);
        hand.anchor.quaternion.copy(c.quaternion);
        continue;
      }
      const gp = c.userData.gamepad;
      hand.tracked = false;
      hand._gamepad = gp ?? null;
      if (!gp) continue;
      hand.connected = true;
      setHandWorld(hand, c);
      hand.anchor.position.copy(c.position);
      hand.anchor.quaternion.copy(c.quaternion);
      hand.trigger = gp.buttons[0]?.value ?? 0;
      hand.squeeze = gp.buttons[1]?.value ?? 0;
      hand.stick.x = gp.axes[2] ?? 0;
      hand.stick.y = gp.axes[3] ?? 0;
      hand.down.trigger = hand.trigger > 0.5;
      hand.down.squeeze = hand.squeeze > 0.5;
      hand.down.stickPress = !!gp.buttons[3]?.pressed;
      hand.down.a = !!gp.buttons[4]?.pressed;
      hand.down.b = !!gp.buttons[5]?.pressed;
    }
    // Bare hands have no thumbsticks. Left ring-pinch (A) walks toward where the left hand points;
    // a pinky pinch (B) snap-turns toward that hand's side.
    const L = input.left, R = input.right;
    if (L.tracked && L.down.a) {
      const rel = Math.atan2(L.direction.x, -L.direction.z) - Math.atan2(player.forward.x, -player.forward.z);
      L.stick.x = Math.sin(rel); L.stick.y = -Math.cos(rel);
    }
    if (L.tracked || R.tracked) {
      const turn = (R.tracked && R.down.b ? 1 : 0) - (L.tracked && L.down.b ? 1 : 0);
      if (turn) R.stick.x = turn;
      else if (R.tracked) R.stick.x = 0;
    }
  } else {
    // Desktop emulation: both hands ride with the camera; the mouse is the right hand.
    const L = input.left, R = input.right;
    camera.updateWorldMatrix(true, false);
    _rigInv.copy(rig.matrixWorld).invert();
    for (const [hand, dx] of [[L, -0.25], [R, 0.25]]) {
      hand.connected = true; hand.tracked = false; hand._gamepad = null;
      hand.anchor.position.set(dx, -0.22, -0.45).applyMatrix4(camera.matrixWorld).applyMatrix4(_rigInv);
      hand.anchor.quaternion.copy(camera.quaternion);
      camera.getWorldQuaternion(_q);
      hand.quaternion.copy(_q);
      hand.direction.set(0, 0, -1).applyQuaternion(_q).normalize();
      hand.anchor.getWorldPosition(hand.position);
    }
    const k = (code) => (keys.has(code) ? 1 : 0);
    L.stick.x = k('KeyD') - k('KeyA');
    L.stick.y = k('KeyS') - k('KeyW');
    R.stick.x = k('ArrowRight') - k('ArrowLeft');
    R.stick.y = k('ArrowDown') - k('ArrowUp');
    L.trigger = k('KeyT'); L.squeeze = k('KeyG');
    R.trigger = mouse.left ? 1 : 0; R.squeeze = mouse.right ? 1 : 0;
    L.down.trigger = !!L.trigger; L.down.squeeze = !!L.squeeze;
    R.down.trigger = mouse.left; R.down.squeeze = mouse.right;
    R.down.a = keys.has('KeyE'); R.down.b = keys.has('KeyQ');
    L.down.a = keys.has('KeyZ'); L.down.b = keys.has('KeyX');
    R.down.stickPress = L.down.stickPress = false;
  }
}

// ---------------------------------------------------------------- player + shared world registry
const player = {
  head: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1), feet: rig.position, rig,
};
function updatePlayer() {
  camera.getWorldPosition(player.head);
  camera.getWorldDirection(player.forward);
}

const world = { contextProviders: {} }; // services provided by modules: world.groundHeight, world.oracle, world.spells, ...
const groundAt = (x, z) => (typeof world.groundHeight === 'function' ? world.groundHeight(x, z) : 0);

const _p = new THREE.Vector3();
// Where the right hand points on the ground, or null. Returns a fresh Vector3.
function aimPoint(maxDistance = 80, hand = input.right) {
  const step = 0.5;
  let prevT = 0, prevD = hand.position.y - groundAt(hand.position.x, hand.position.z);
  for (let t = step; t <= maxDistance; t += step) {
    _p.copy(hand.position).addScaledVector(hand.direction, t);
    const d = _p.y - groundAt(_p.x, _p.z);
    if (d <= 0) {
      const hitT = prevT + (t - prevT) * (prevD / (prevD - d || 1));
      const hit = hand.position.clone().addScaledVector(hand.direction, hitT);
      hit.y = groundAt(hit.x, hit.z);
      return hit;
    }
    prevT = t; prevD = d;
  }
  return null;
}

// ---------------------------------------------------------------- system services (stable)
const net = createNet({ events });
const hud = createHud({ THREE, camera, events });
const voice = createVoice({ THREE, net, events, audio, input, hud, getContext: buildRequestContext });

function buildRequestContext() {
  const aim = aimPoint();
  return {
    player: { position: player.feet.toArray().map(round2), forward: player.forward.toArray().map(round2) },
    aimPoint: aim ? aim.toArray().map(round2) : null,
    modules: [...modules.keys()],
    passthrough: input.passthrough || undefined,
    // Modules may contribute: world.contextProviders = { name: () => jsonable | null } (e.g. the NPC being addressed).
    ...collectContext(),
  };
}
function collectContext() {
  const out = {};
  const providers = world.contextProviders;
  if (providers) {
    for (const k in providers) {
      try { const v = providers[k]?.(); if (v != null) out[k] = v; } catch { /* a broken provider must not block speech */ }
    }
  }
  return out;
}
const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- hot module loader
const modules = new Map(); // path -> { version, instance, root, cleanups, failed, ms }
let timeModules = true;     // per-module update cost; world.perf reads record.ms through game.modules
const moduleState = new Map(); // path -> object that survives hot reloads
const clock = { t: 0, dt: 0 };

function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material ?? [])) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose?.();
    }
  });
}

function reportModuleError(path, phase, err) {
  const message = `${phase}: ${err?.message ?? err}`;
  console.error(`[module ${path}] ${message}`, err);
  hud.show(`⚠ ${path} — ${message}`, 6);
  net.send({ type: 'module_error', path, message, stack: String(err?.stack ?? '').slice(0, 2000) });
}

function unloadModule(path) {
  const m = modules.get(path);
  if (!m) return;
  modules.delete(path);
  try { m.instance?.dispose?.(); } catch (err) { console.error(`[module ${path}] dispose failed`, err); }
  for (const fn of m.cleanups.reverse()) { try { fn(); } catch (err) { console.error(err); } }
  scene.remove(m.root);
  disposeTree(m.root);
}

async function loadModule(path, version) {
  unloadModule(path);
  const root = new THREE.Group();
  root.name = `module:${path}`;
  const record = { version, instance: null, root, cleanups: [], failed: false };
  if (!moduleState.has(path)) moduleState.set(path, {});
  const ctx = {
    THREE, scene, camera, renderer, rig, root, input, player, world, events, audio, net, hud, clock, quality,
    path,
    state: moduleState.get(path),
    aimPoint,
    groundAt,
    on(name, fn) { record.cleanups.push(events.on(name, fn)); },
    provide(name, api) {
      world[name] = api;
      record.cleanups.push(() => { if (world[name] === api) delete world[name]; });
    },
    onDispose(fn) { record.cleanups.push(fn); },
  };
  scene.add(root);
  modules.set(path, record);
  try {
    const mod = await import(`/game/${path}?v=${version}`);
    if (typeof mod.default !== 'function') throw new Error('module has no default export function');
    record.instance = (await mod.default(ctx)) ?? {};
    events.emit('module:loaded', { path });
  } catch (err) {
    record.failed = true;
    unloadModule(path);
    modules.set(path, { ...record, instance: null, cleanups: [], failed: true }); // remember version so we don't retry-loop
    reportModuleError(path, 'load', err);
  }
}

let syncChain = Promise.resolve();
// listing: [{ path, version }] in load order. Loads new/changed modules, unloads removed ones.
function syncModules(listing) {
  syncChain = syncChain.then(async () => {
    const wanted = new Map(listing.map((m) => [m.path, m.version]));
    for (const path of [...modules.keys()].reverse()) if (!wanted.has(path)) unloadModule(path);
    for (const { path, version } of listing) {
      if (modules.get(path)?.version !== version) await loadModule(path, version);
    }
    events.emit('modules:synced', { modules: [...modules.keys()] });
    try { renderer.compileAsync?.(scene, camera)?.catch?.(() => {}); } catch { /* optional */ }
  }).catch((err) => console.error('module sync failed', err));
  return syncChain;
}

events.on('net:reload', (msg) => syncModules(msg.modules));
events.on('net:open', async () => {
  try {
    const res = await fetch('/api/modules');
    syncModules((await res.json()).modules);
  } catch (err) { console.error('could not fetch module list', err); }
});

// ---------------------------------------------------------------- main loop
let last = 0;
renderer.setAnimationLoop((time) => {
  const now = time / 1000;
  clock.dt = Math.min(now - last || 0, 0.1);
  clock.t = now;
  last = now;

  pollInput();
  updatePlayer();
  voice.update(clock.dt);
  for (const [path, m] of modules) {
    if (!m.instance?.update) continue;
    try {
      if (timeModules) {
        const t0 = performance.now();
        m.instance.update(clock.dt, clock.t);
        m.ms = (m.ms ?? 0) * 0.95 + (performance.now() - t0) * 0.05;
      } else m.instance.update(clock.dt, clock.t);
    } catch (err) {
      m.instance.update = null; // stop calling a broken update; the rest of the module stays up
      reportModuleError(path, 'update', err);
    }
  }
  hud.update(clock.dt);
  sweepShadows(now);
  if (composer && !renderer.xr.isPresenting) composer.render(clock.dt);
  else renderer.render(scene, camera);
});

// Debug handle for the browser console.
window.game = { THREE, scene, camera, renderer, rig, input, player, world, events, modules, net, syncModules, quality };
