// library/effects.js - weather and ambience. Cheap by design: rain/snow/leaves/fireflies/embers are ONE draw call each, animated entirely in the
// vertex shader (counts scale with ctx.quality.density). Sky weather uses world.env and restores it; storm strikes / meteor impacts throw loose bodies (kit.hit force).
export default function install(lib, H) {
  const { THREE, rand, pick, clamp, TAU, shade, mix } = H;
  const PI = Math.PI;
  const def = (name, description, options, aliases, build, extra) => lib.add({ name, category: 'effects', description, options, aliases, build, noPush: true, face: 'none', ownCount: true, ...extra });
  const _w = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector2();
  const env = () => H.ctx.world.env;

  // ------------------------------------------------------------------ GPU particle field
  const VERT = `
    uniform float uTime, uSway, uSize, uPx, uBaseY, uSpin, uTwinkle, uStreak;
    uniform vec3 uCenter, uArea, uVel;
    attribute vec4 aSeed; attribute vec3 aColor; attribute float aEnd;
    varying vec3 vColor; varying float vA; varying float vRot; varying float vSeed; varying float vEnd;
    void main() {
      vec3 p = position * uArea;
      vec3 v = uVel * (0.75 + 0.5 * aSeed.x);
      p += v * uTime;
      p.x += sin(uTime * (0.6 + aSeed.y) + aSeed.z * 6.2831) * uSway;
      p.z += cos(uTime * (0.5 + aSeed.w) + aSeed.x * 6.2831) * uSway;
      p.y += sin(uTime * (0.9 + aSeed.z) + aSeed.w * 6.2831) * uSway * 0.25;
      vec3 w;
      w.x = uCenter.x + mod(p.x - uCenter.x + 0.5 * uArea.x, uArea.x) - 0.5 * uArea.x;
      w.z = uCenter.z + mod(p.z - uCenter.z + 0.5 * uArea.z, uArea.z) - 0.5 * uArea.z;
      w.y = uBaseY + mod(p.y - uBaseY, uArea.y);
      vec2 rel = (w.xz - uCenter.xz) / uArea.xz;
      float edge = (1.0 - smoothstep(0.36, 0.5, abs(rel.x))) * (1.0 - smoothstep(0.36, 0.5, abs(rel.y)));
      float hy = (w.y - uBaseY) / uArea.y;
      vA = edge * smoothstep(0.0, 0.08, hy) * (1.0 - smoothstep(0.9, 1.0, hy));
      if (uTwinkle > 0.0) vA *= 0.2 + 0.8 * (0.5 + 0.5 * sin(uTime * uTwinkle + aSeed.x * 40.0));
      vColor = aColor; vSeed = aSeed.x; vEnd = aEnd;
      vRot = aSeed.z * 6.2831 + uTime * uSpin * (aSeed.y - 0.5) * 2.0;
      #ifdef STREAK
        vec3 dir = normalize(v);
        w -= dir * uStreak * aEnd;
      #endif
      vec4 mv = modelViewMatrix * vec4(w, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(uSize * (0.6 + 0.8 * aSeed.y) * projectionMatrix[1][1] * uPx / max(gl_Position.w, 0.02), 1.0, 96.0);
    }`;
  const FRAG = `
    uniform float uShape, uAlpha, uTime;
    varying vec3 vColor; varying float vA; varying float vRot; varying float vSeed; varying float vEnd;
    void main() {
      float a = 1.0;
      #ifndef STREAK
        vec2 d = gl_PointCoord - 0.5;
        float c = cos(vRot), s = sin(vRot);
        vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
        if (uShape < 0.5) { float r = dot(d, d) * 4.0; if (r > 1.0) discard; a = (1.0 - r); a *= a; }
        else if (uShape < 1.5) { float fl = abs(sin(uTime * 4.0 + vSeed * 20.0)); if (abs(q.x) > 0.5 || abs(q.y) > 0.5 * max(fl, 0.15)) discard; }
        else if (uShape < 2.5) { vec2 e = q * vec2(1.0, 2.4); if (dot(e, e) * 4.0 > 1.0) discard; }
        else { float r = length(d) * 2.0; if (r > 1.0) discard; a = smoothstep(0.6, 0.95, r) * 0.7 + 0.06 + (1.0 - smoothstep(0.1, 0.3, length(d - vec2(-0.18, 0.18)))) * 0.6; }
      #else
        a = 0.3 + 0.7 * (1.0 - vEnd);
      #endif
      gl_FragColor = vec4(vColor, a * vA * uAlpha);
      #include <colorspace_fragment>
    }`;
  const SHAPES = { round: 0, square: 1, ellipse: 2, bubble: 3 };
  // field(inst, { count, area:[w,h,d], follow (true = centred on the player), center:{x,z}, baseY | yOff, fall (m/s down; negative rises), drift:[vx,vz], sway,
  //               color: hex|[hex..], size (m), shape, spin, twinkle (Hz), alpha, additive, streak (m: draws rain lines) })  count is scaled by ctx.quality.density
  function field(inst, o = {}) {
    const dk = clamp(H.densK(), 0.3, 2), N = clamp(Math.floor((o.count ?? 400) * dk), 1, 6000), A = o.area ?? [30, 14, 30], streak = o.streak > 0; // density read now: 1 on Quest, 2x cap on PC, less under load
    const cols = [].concat(o.color ?? 0xffffff).map((c) => new THREE.Color(c));
    const V = streak ? N * 2 : N;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(V * 3), seed = new Float32Array(V * 4), col = new Float32Array(V * 3), end = new Float32Array(V);
    for (let k = 0; k < N; k++) {
      const px = Math.random(), py = Math.random(), pz = Math.random(), s = [Math.random(), Math.random(), Math.random(), Math.random()], c = cols[(Math.random() * cols.length) | 0];
      for (let e = 0; e < (streak ? 2 : 1); e++) {
        const v = streak ? k * 2 + e : k;
        pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz;
        seed.set(s, v * 4); col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; end[v] = e;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const U = {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uArea: { value: new THREE.Vector3(A[0], A[1], A[2]) }, uVel: { value: new THREE.Vector3(o.drift ? o.drift[0] : 0, -(o.fall ?? 1), o.drift ? o.drift[1] : 0) },
      uSway: { value: o.sway ?? 0 }, uSize: { value: o.size ?? 0.06 }, uPx: { value: 500 }, uBaseY: { value: 0 }, uSpin: { value: o.spin ?? 0 }, uTwinkle: { value: o.twinkle ?? 0 },
      uShape: { value: SHAPES[o.shape ?? 'round'] }, uAlpha: { value: o.alpha ?? 1 }, uStreak: { value: o.streak ?? 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending, defines: streak ? { STREAK: '' } : {},
    });
    mat.userData.own = true;
    const obj = streak ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat);
    obj.frustumCulled = false; obj.renderOrder = o.additive ? 6 : 5;
    if (!streak) obj.onBeforeRender = (renderer, scene, camera) => { const h = camera.viewport ? camera.viewport.w : renderer.getDrawingBufferSize(_v2).y; U.uPx.value = h * 0.5; };
    inst.ctx.root.add(obj);
    inst.cleanup(() => { obj.removeFromParent(); geo.dispose(); mat.dispose(); });
    inst.track(obj);
    const follow = o.follow !== false && !o.center, cx = o.center ? o.center.x : 0, cz = o.center ? o.center.z : 0;
    let tt = rand(0, 100);
    const upd = (dt) => {
      tt += dt; if (tt > 3000) tt -= 3000;
      U.uTime.value = tt;
      if (follow) { U.uCenter.value.set(H.head.x, 0, H.head.z); U.uBaseY.value = H.ground(H.head.x, H.head.z) + (o.yOff ?? -0.4); }
      else { U.uCenter.value.set(cx, 0, cz); U.uBaseY.value = o.baseY ?? H.ground(cx, cz); }
    };
    upd(0);
    inst.tick(upd);
    return { object: obj, uniforms: U };
  }
  H.field = field;

  // ------------------------------------------------------------------ sky/env helpers (remember and restore)
  function weatherEnv(inst, setup) {
    const E = env(); if (!E) return null;
    const prev = E.timeOfDay ?? 0.5;
    try { setup(E); } catch (err) { console.error('[library] env change failed', err); }
    inst.cleanup(() => { const e2 = env(); if (e2) { try { e2.setTimeOfDay(prev); e2.setWind(null); } catch (err) { /* ignore */ } } });
    return E;
  }
  const overcast = (z, h, m) => (E) => E.setSkyColors({ zenith: z, horizon: h, mid: m }).setStars(0).setAurora(0);

  def('rain', 'steady rainfall around you (2200 GPU rain streaks), overcast sky, hushed hiss; option intensity 0.3-2', 'intensity', ['rainfall', 'drizzle', 'shower', 'rainy', 'make it rain', 'rainstorm', 'wet weather'], (i, o) => {
    const k = clamp(o.intensity ?? 1, 0.2, 2.5);
    weatherEnv(i, (E) => { overcast(0x20262e, 0x5a626c, 0x3a424c)(E); E.setFog(undefined, 0.006 + 0.004 * k); E.setWind(0.45); });
    field(i, { count: Math.round(2000 * k), area: [34, 16, 34], streak: 0.55, fall: 11 + 3 * k, drift: [-1.6, 0.4], color: 0xaec6e2, alpha: 0.5, yOff: -0.5 });
    let n = 0;
    i.tick((dt) => { n -= dt; if (n < 0) { n = 1.0; i.snd().noise({ dur: 1.3, filter: { type: 'bandpass', freq: 4500, q: 0.35 }, vol: 0.07 * k, attack: 0.3 }); } });
  });
  def('snow', 'gentle snowfall with a pale overcast sky and a white snowy ground (option ground:false to keep the grass)', 'intensity, ground', ['snowfall', 'blizzard', 'snowing', 'winter', 'snowstorm', 'let it snow', 'flurries'], (i, o) => {
    const k = clamp(o.intensity ?? 1, 0.2, 3);
    weatherEnv(i, (E) => { overcast(0x5a667e, 0xcfd9e6, 0x95a4ba)(E); E.setFog(undefined, 0.007); E.setWind(k > 1.6 ? 0.8 : 0.25); });
    if (o.ground !== false) { env()?.setGrassColor(0xdce6f0); i.cleanup(() => env()?.setGrassColor(0x8aa04a)); }
    field(i, { count: Math.round(1500 * k), area: [34, 14, 34], fall: 1.1 + 0.5 * k, sway: 0.5, drift: [k > 1.6 ? 3 : 0.3, 0], color: [0xffffff, 0xeaf2ff], size: 0.06, alpha: 0.95, yOff: -0.5 });
    let n = rand(0, 5);
    i.tick((dt) => { n -= dt; if (n < 0) { n = rand(5, 9); i.snd().tone({ freq: 90, dur: 4, type: 'sine', vol: 0.05 }); } }, { every: 0.5 });
  });
  def('fog-bank', 'thick low fog: denser pale fog everywhere plus drifting cloud banks around the spot; options density (default 0.02), color', 'density, color, radius', ['fog', 'mist', 'haze', 'foggy', 'smog', 'cloud', 'misty'], (i, o) => {
    const c = o.color ?? 0xb4bdc8, R = o.radius ?? 16;
    weatherEnv(i, (E) => { E.setFog(c, clamp(o.density ?? 0.02, 0.004, 0.05)); });
    const bl = [];
    for (let k = 0; k < 12; k++) {
      const b = H.mk(); b.mode('ghost'); const r = rand(5, 10); b.sph(0, 0, 0, r, r * 0.12, r * 0.85, mix(c, 0xffffff, rand(0.1, 0.5)), 0, 8);
      const m = b.build({ own: true }); m.material.opacity = 0.17; m.material.userData.o0 = 0.17; i.ctx.root.add(m); i.cleanup(() => { m.removeFromParent(); H.disposeOwn(m); }); i.track(m);
      bl.push({ m, a: rand(0, TAU), r: rand(0, R), w: rand(0.01, 0.04) * (Math.random() < 0.5 ? 1 : -1), y: rand(0.4, 1.4), ph: rand(0, 6) });
    }
    i.tick((dt, t) => { for (const b of bl) { b.a += b.w * dt; const x = i.x + Math.cos(b.a) * b.r, z = i.z + Math.sin(b.a) * b.r; b.m.position.set(x, H.ground(x, z) + b.y + Math.sin(t * 0.3 + b.ph) * 0.15, z); } });
  });
  def('fireflies', 'a swarm of 140 blinking yellow-green fireflies drifting around you at knee-to-head height', 'count, follow', ['firefly', 'glow bugs', 'lightning bugs', 'fire flies', 'glowing bugs', 'fairy lights', 'will-o-wisps'], (i, o) => {
    field(i, { count: clamp(o.count ?? 140, 10, 800), area: [26, 5.5, 26], follow: o.follow !== false, center: o.follow === false ? { x: i.x, z: i.z } : undefined, baseY: o.follow === false ? H.ground(i.x, i.z) + 0.2 : undefined, yOff: 0.15, fall: 0, sway: 1.5, color: [0xe8ff7a, 0xffe27a, 0xc8ff7a], size: 0.1, twinkle: 3.2, additive: true, alpha: 1 });
  });
  def('aurora', 'night-sky aurora borealis with full stars; sets deep night, restored when removed (keepTime keeps the time of day)', 'keepTime', ['northern lights', 'aurora borealis', 'polar lights', 'night sky lights', 'auroras'], (i, o) => {
    weatherEnv(i, (E) => { if (!o.keepTime && (E.timeOfDay ?? 0.5) > 0.2) E.setTimeOfDay(0.06); E.setAurora(1).setStars(1); });
    i.snd().chord([196, 294, 392], { dur: 6, type: 'sine', vol: 0.05, stagger: 0.8 });
  });
  def('night', 'switch the world to deep night: stars and aurora (restored to the previous time of day when removed)', 'time (0..0.3)', ['nighttime', 'midnight', 'dark', 'make it night', 'moonlight', 'night time'], (i, o) => { weatherEnv(i, (E) => E.setTimeOfDay(clamp(o.time ?? 0, 0, 0.3))); });
  def('dusk', 'switch to the default violet-orange twilight (restored when removed)', 'time', ['twilight', 'sunset', 'evening', 'dawn', 'sunrise', 'golden hour', 'sundown'], (i, o) => { weatherEnv(i, (E) => E.setTimeOfDay(clamp(o.time ?? 0.5, 0.3, 1))); });
  def('day', 'switch to a bright blue daytime sky with pale fog (restored when removed)', 'none', ['daytime', 'noon', 'sunny', 'midday', 'make it day', 'sunshine', 'bright', 'morning', 'clear sky', 'blue sky'], (i, o) => {
    weatherEnv(i, (E) => { E.setTimeOfDay(1); E.setSkyColors({ zenith: 0x2a6ac8, horizon: 0xc4e2ff, mid: 0x7ab4ee }); E.setStars(0).setAurora(0); E.setFog(0xcfe4ff, 0.0038); });
  });

  // ---- storm
  def('storm', 'thunderstorm: dark sky, hard rain, strong wind, jagged lightning bolts with flashes and rolling thunder', 'intensity', ['thunderstorm', 'lightning', 'thunder', 'stormy weather', 'tempest', 'thunder storm', 'lightning storm'], (i, o) => {
    const k = clamp(o.intensity ?? 1, 0.4, 2);
    weatherEnv(i, (E) => { overcast(0x0b0e14, 0x2c333c, 0x161a22)(E); E.setFog(undefined, 0.011); E.setWind(0.95); });
    field(i, { count: Math.round(2600 * k), area: [36, 18, 36], streak: 0.75, fall: 16, drift: [-5, 1.5], color: 0x9db6d6, alpha: 0.55, yOff: -0.5 });
    const N = 22, lg = new THREE.BufferGeometry(), lp = new Float32Array(N * 2 * 3);
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const lm = new THREE.LineBasicMaterial({ color: 0xdfeaff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }); lm.userData.own = true;
    const bolt = new THREE.LineSegments(lg, lm); bolt.frustumCulled = false; bolt.visible = false; i.ctx.root.add(bolt);
    i.cleanup(() => { bolt.removeFromParent(); lg.dispose(); lm.dispose(); }); i.track(bolt);
    let next = rand(2, 5), show = 0, rainN = 0;
    const K = H.kit();
    i.tick((dt, t) => {
      rainN -= dt; if (rainN < 0) { rainN = 1.0; i.snd().noise({ dur: 1.3, filter: { type: 'bandpass', freq: 4500, q: 0.35 }, vol: 0.1, attack: 0.3 }); }
      next -= dt;
      if (next <= 0) {
        next = rand(4, 10) / k;
        const a = rand(0, TAU), d = rand(40, 130), gx = H.head.x + Math.cos(a) * d, gz = H.head.z + Math.sin(a) * d, gy = H.ground(gx, gz);
        let x = gx + rand(-10, 10), y = 95, z = gz + rand(-10, 10);
        for (let s = 0; s < N; s++) {
          const u = (s + 1) / N, nx = gx + (x - gx) * (1 - u) + rand(-3, 3) * (1 - u), ny = 95 * (1 - u) + gy * u, nz = gz + (z - gz) * (1 - u) + rand(-3, 3) * (1 - u);
          lp[s * 6] = x; lp[s * 6 + 1] = y; lp[s * 6 + 2] = z; lp[s * 6 + 3] = nx; lp[s * 6 + 4] = ny; lp[s * 6 + 5] = nz;
          x = nx; y = ny; z = nz;
        }
        lg.attributes.position.needsUpdate = true; bolt.visible = true; show = 0.18; lm.opacity = 1;
        _w.set(gx, gy + 6, gz);
        if (K) K.hit(_v.set(gx, gy + 0.5, gz), 5, 20, { kind: 'shock', force: 14 }); // a strike throws loose things around it
        if (K) K.flash(i.ctx, _w, { color: 0xcfe0ff, intensity: 160, distance: 120, duration: 0.45 });
        const delay = d / 120, s = i.snd();
        s.noise({ dur: 2.8, filter: { type: 'lowpass', freq: 500, freqEnd: 70, q: 0.8 }, vol: d < 60 ? 0.8 : 0.5, delay, at: _w });
        s.tone({ freq: 62, freqEnd: 35, dur: 2.0, vol: 0.5, delay, at: _w });
        s.noise({ dur: 0.15, filter: { type: 'highpass', freq: 3000 }, vol: 0.4, delay: Math.max(0, delay - 0.05), at: _w });
      }
      if (show > 0) { show -= dt; lm.opacity = clamp(show / 0.18, 0, 1) * (Math.random() < 0.5 ? 1 : 0.4); if (show <= 0) bolt.visible = false; }
    });
  });

  // ---- meteors
  def('meteor-shower', 'night-sky meteors streaking over you with glowing trails; every few seconds one slams into the distance with a flash and thunder', 'rate (per second)', ['meteors', 'shooting stars', 'falling stars', 'meteor', 'comets', 'asteroids', 'star shower'], (i, o) => {
    weatherEnv(i, (E) => { if ((E.timeOfDay ?? 0.5) > 0.2) E.setTimeOfDay(0.08); E.setStars(1); });
    const em = i.fx({ count: 600, color: [0xffffff, 0xff8a30], size: [3.0, 0.3], life: [0.7, 1.3], speed: [0, 0.6], gravity: 0, drag: 0, alpha: 0.9 });
    const P = Array.from({ length: 6 }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, hit: false }));
    const rate = o.rate ?? 0.5, K = H.kit();
    let next = rand(0.3, 1.2);
    i.tick((dt, t) => {
      next -= dt;
      if (next <= 0) {
        next = rand(0.4, 1.4) / rate / 1.0;
        const p = P.find((q) => !q.on);
        if (p) {
          const a = rand(0, TAU), hit = Math.random() < 0.18, d = hit ? rand(70, 140) : rand(100, 180), dir = rand(0, TAU), sp = rand(70, 120);
          p.on = true; p.hit = hit; p.life = hit ? 6 : rand(1.6, 3);
          p.x = H.head.x + Math.cos(a) * d; p.z = H.head.z + Math.sin(a) * d; p.y = rand(80, 130);
          p.vx = Math.cos(dir) * sp * 0.6; p.vz = Math.sin(dir) * sp * 0.6; p.vy = -sp * (hit ? 0.55 : 0.4);
          if (hit) { p.vx = (H.head.x + rand(-60, 60) - p.x) / 3.2; p.vz = (H.head.z + rand(-60, 60) - p.z) / 3.2; p.vy = (H.ground(p.x + p.vx * 3, p.z + p.vz * 3) - p.y) / 3.2; }
        }
      }
      for (const p of P) {
        if (!p.on) continue;
        p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        _w.set(p.x, p.y, p.z);
        if (em) { em.emit(_w, H.dens(1), undefined, 1.6); em.emit(_w, H.dens(2), undefined, 1.0); }
        const g = H.ground(p.x, p.z);
        if (p.y <= g + 0.5 || p.life <= 0) {
          p.on = false;
          if (p.hit && p.y <= g + 6 && K) {
            _w.y = g + 1; K.explosion(i.ctx, _w, { size: 5, color: 0xff7a30 }); K.hit(_w, 9, 25, { kind: 'explosion', force: 50 }); K.flash(i.ctx, _w, { color: 0xffb070, intensity: 200, distance: 150, duration: 0.8 });
            const d = Math.hypot(p.x - H.head.x, p.z - H.head.z), s = i.snd();
            s.noise({ dur: 2.5, filter: { type: 'lowpass', freq: 400, freqEnd: 60 }, vol: 0.7, delay: d / 150, at: _w }); s.tone({ freq: 55, freqEnd: 28, dur: 2, vol: 0.5, delay: d / 150, at: _w });
          }
        }
      }
    });
  });
  def('falling-leaves', 'autumn leaves in orange, gold and red spiralling down around you', 'count', ['autumn', 'leaves', 'fall leaves', 'autumn leaves', 'leaf fall', 'falling leaf', 'fall foliage'], (i, o) => {
    field(i, { count: clamp(o.count ?? 220, 20, 1200), area: [26, 10, 26], fall: 0.9, sway: 1.5, spin: 4, drift: [0.8, 0.3], color: [0xd8742a, 0xe8a030, 0xb8402a, 0x9a6a2a, 0xc8b030, 0xa83a1a], size: 0.13, shape: 'ellipse', yOff: -0.3 });
  });
  def('embers', 'glowing orange embers and sparks drifting upward around you, like next to a great fire', 'count, follow', ['sparks', 'ember', 'glowing embers', 'fire sparks', 'ashes', 'cinders', 'floating embers'], (i, o) => {
    field(i, { count: clamp(o.count ?? 200, 20, 1000), area: [20, 8, 20], fall: -1.1, sway: 0.7, drift: [0.5, 0.2], color: [0xff7a2a, 0xffb040, 0xff4a1a], size: 0.07, twinkle: 5, additive: true, follow: o.follow !== false, center: o.follow === false ? { x: i.x, z: i.z } : undefined, baseY: o.follow === false ? H.ground(i.x, i.z) : undefined, yOff: -0.2 });
  });
  def('bubbles', 'a stream of shimmering soap bubbles rising from a spot (options x, z, count)', 'count, radius', ['soap bubbles', 'bubble', 'bubble machine', 'foam', 'bubbles of soap'], (i, o) => {
    const R = o.radius ?? 2.5;
    field(i, { count: clamp(o.count ?? 90, 10, 500), area: [R * 2, 5, R * 2], fall: -0.55, sway: 0.5, drift: [0.15, 0.1], color: [0xbfe8ff, 0xffd0f0, 0xd0ffd8], size: 0.24, shape: 'bubble', center: { x: i.x, z: i.z }, baseY: H.ground(i.x, i.z) + 0.1, alpha: 0.85 });
    let n = rand(0.5, 2);
    i.tick((dt) => { n -= dt; if (n < 0 && Math.hypot(H.head.x - i.x, H.head.z - i.z) < 20) { n = rand(1, 3); i.snd().tone({ freq: 1200 + rand(0, 800), freqEnd: 700, dur: 0.08, vol: 0.05, at: { x: i.x + rand(-R, R), y: i.y + 1.5, z: i.z + rand(-R, R) } }); } }, { every: 0.2 });
  }, { distance: 4 });
  def('confetti-burst', 'a pop and a burst of ~400 multicoloured confetti that flutters down for 4 s (self-removes after ~6 s)', 'x, z (burst point), height', ['confetti', 'party popper', 'celebration', 'party', 'streamers', 'festive burst', 'fireworks confetti'], (i, o) => {
    const cols = [0xff4a5a, 0xffd24a, 0x4aff8a, 0x4ab0ff, 0xb07aff, 0xff8ac8, 0xffffff];
    const dk = clamp(H.densK(), 0.3, 2), ems = cols.map((c) => i.fx({ count: Math.round(70 * dk), color: [c, c], size: [0.1, 0.1], life: [2.5, 4], speed: [2, 7], gravity: 2.4, drag: 1.1, alpha: 1, additive: false }));
    const at = new THREE.Vector3(i.x, H.ground(i.x, i.z) + (o.height ?? 2.4), i.z), up = new THREE.Vector3(0, 2.5, 0);
    for (const e of ems) if (e) e.emit(at, H.dens(60), up);
    const s = i.snd(); s.noise({ dur: 0.12, filter: { type: 'bandpass', freq: 1800, q: 0.8 }, vol: 0.4, at }); s.tone({ freq: 900, freqEnd: 300, dur: 0.12, type: 'triangle', vol: 0.3, at }); s.chord([523, 659, 784], { dur: 0.6, type: 'triangle', vol: 0.12, at, stagger: 0.06, delay: 0.1 });
    i.expire(6.5);
  }, { distance: 4 });

  // ---- rainbow
  def('rainbow', 'a huge seven-colour rainbow arching across the sky ~130 m away in front of you (gently shimmering)', 'distance', ['rainbows', 'colorful arc', 'colourful sky', 'spectrum', 'sky arc'], (i, o) => {
    const cols = [0xff3a3a, 0xff8a2a, 0xffe03a, 0x3adf5a, 0x3ab0ff, 0x4a50e0, 0x9a4ae0], R = 62, b = H.mk(); b.mode('beam');
    cols.forEach((c, k) => { const r = R - k * 1.9; for (let s = 0; s < 36; s++) { const a = (s / 36) * PI, a2 = ((s + 1) / 36) * PI, am = (a + a2) / 2; b.box(Math.cos(am) * r, Math.sin(am) * r, 0, 1.9, (a2 - a) * r * 1.08, 0.2, c, [0, 0, am]); } });
    const m = b.build({ own: true }); i.add(m);
    i.group.position.y = H.ground(i.x, i.z) - 2;
    i.tick((dt, t) => { m.material.opacity = 0.38 + Math.sin(t * 0.8) * 0.05; });
  }, { distance: 130 });
}
