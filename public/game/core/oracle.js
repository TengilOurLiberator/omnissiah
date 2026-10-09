// core/oracle.js â€” THE OMNISSIAH'S OWN BODY: a colossal raymarched Mandelbulb star-mind (obsidian body, molten-gold veins, corona, three crystal rings, runes, arcs, god rays, a hex-iris eye
// that follows the player). It reacts to spells, kills, damage, deaths and new creations by itself, and falls asleep after ~100 s of nothing. Everything lives under ctx.root.
// ---- HOOKS for you / creations (safe at any time; bad arguments are ignored) ------------------------------------------------------------
//   world.oracle.position (Vector3), .radius, setState(s), pulse(strength), getState()
//   world.oracle.flare(color, strength = 1)        colour burst: tints the core + corona + eye, sparks arcs and a sound ring. color: 0xff4400 | '#ff4400' | THREE.Color | [r,g,b] (0..1)
//   world.oracle.beamTo(point, { color, duration = 1.6 })   beam of light from the core to a world point (Vector3 or [x,y,z]) with an impact disc; up to 3 at once -> bool
//   world.oracle.setMood('serene' | 'wrathful' | 'joyful' | 'ominous' | 'default')   cross-fades palette, tempo, heartbeat, lightning rate (null = default) -> bool;  getMood()
//   world.oracle.lookAt(point | null)              the eye follows this world point instead of the player (null = watch the player)
//   world.oracle.wake()    world.oracle.creation(point?)  the full "act of creation" set-piece at a point (default: where the player aims; it already plays for every new creation file)
//   world.oracle.limitQuality(maxTier | null) / .quality   (core/perf.js owns these; do not call)
// By itself (no calls needed): he IGNITES (shockwaves, lightning, comets) whenever his root is shown again (the intro hides it first); listening narrows the iris onto the player, thinking races the power and sweeps an
//   orbit-trap band through the bulb, speaking flares the eye and sends rings; a creation fires a lightning lance + beam from his core to the site, a column and a ground shockwave ring; quest:completed, travel:arrive and
//   blast:arrive give gold/prismatic bursts and a ring at your feet; setMood('wrathful') eclipses him (dark body, white-hot rim, more arcs), setMood('joyful') bursts prismatic. The 'quest' tier uses the lean levels even on a flat screen.
// To change how you LOOK for good ("turn yourself blue", "more rings"), edit this file's palette/uniform constants; for a moment, use flare/setMood. In mixed reality you hover as a small apparition near the table.

export const meta = { name: 'Omnissiah', description: 'The fractal machine-god in the sky.' };

export default function (ctx) {
  const THREE = ctx.THREE;
  const root = ctx.root;
  const keep = ctx.state; // survives hot reloads

  // ------------------------------------------------------------------ constants
  const RADIUS = 76;                       // bounding sphere radius, metres
  const RB = 1.3;                          // bounding radius in fractal units (bulb reaches ~1.2-1.3)
  const SKY_POS = new THREE.Vector3(0, 190, -260);
  const POS = SKY_POS.clone();             // LIVE placement (world.oracle.position); mutated in place, never replaced
  let curR = RADIUS;                       // LIVE bounding radius (world.oracle.radius)
  // passthrough (mixed reality) placement, see header
  const PT_R = 0.23, PT_DIST = 2.2, PT_HEIGHT = 1.9, PT_EASE = 2.0, PT_LATCH_DELAY = 0.35;
  const PT_RING_K = 1.15;                  // rings a touch wider than the plain scale: nearest ring ~0.9 m across
  const PT_SPARK_K = 0.07;                 // spark width / spread / helix scale relative to the sky
  const PT_SPARK_AHEAD = 1.6;              // sparks land this far ahead of the player (sky: 10 m)
  const PT_GAZE_R = 1.1;                   // gaze ring radius on the floor (sky: 3.4 m)
  const PT_LIGHT = 0.5;                    // oracle light scale (it hovers within arm's reach of the room)
  const PT_MOTE_PX = 5;                    // max mote sprite size in pixels (sky: 12)
  const PT_VR_CAP = 1;                     // highest VR quality tier used in passthrough (0 low, 1 mid)
  const MAX_SPARKS = 420;
  const N_MOTES = 640;
  // v3 spectacle
  const N_RUNES = 66;                      // glyphs in the halo (two bands, interleaved)
  const GLYPH_COLS = 8, GLYPH_ROWS = 4;    // atlas layout (32 glyphs)
  const N_ARC = 16, ARC_SEG = 16;          // ribbon slots: 0-7 lightning, 8-11 prominences, 12-15 comets
  const ARC_L0 = 0, ARC_L1 = 8, ARC_P0 = 8, ARC_P1 = 12, ARC_C0 = 12, ARC_C1 = 16;
  const N_RAYS = 12;
  const N_SR = 6;                          // simultaneous sound rings
  const N_STRIKE = 3;                      // simultaneous columns / beams
  const SR_R = 3.3;                        // sound-ring quad half-size in sphere radii
  const SLEEP_AFTER = 100;                 // seconds of nothing before it dozes

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const fract = (x) => x - Math.floor(x);
  const tri = (x) => Math.abs(fract(x) * 2 - 1);

  // ------------------------------------------------------------------ palette (mirrors GLSL godPal)
  // idx 0 = white-gold, ~0.25 magenta, ~0.5 violet, 1 = deep cyan. Never passes through green.
  const HSV_OFF = [0, 4, 2];
  const _rgb = [0, 0, 0];
  function palRGB(idx, sat, out) {
    const h = 0.14 - 0.64 * idx;
    for (let i = 0; i < 3; i++) {
      let m = h * 6 + HSV_OFF[i];
      m -= 6 * Math.floor(m / 6);
      const p = clamp(Math.abs(m - 3) - 1, 0, 1);
      _rgb[i] = 1 + (p - 1) * sat;
    }
    out.set(_rgb[0], _rgb[1], _rgb[2]);
    return out;
  }
  const coolIdx = (idx, cool) => lerp(idx, 0.6 + 0.4 * idx, cool);

  // ------------------------------------------------------------------ shared GLSL
  const GLSL_PAL = /* glsl */ `
vec3 hsv2rgb(vec3 c) {
  vec3 p = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z * mix(vec3(1.0), p, c.y);
}
float tri(float x) { return abs(fract(x) * 2.0 - 1.0); }
vec3 godPal(float idx, float sat) { return hsv2rgb(vec3(0.14 - 0.64 * idx, sat, 1.0)); }
`;

  // ------------------------------------------------------------------ shared uniforms (same objects in all materials)
  const U = {
    uTime: { value: 0 },
    uCenter: { value: POS.clone() },
    uRadius: { value: RADIUS },
    uPhase: { value: 0.1 },
    uCool: { value: 0 },
    uEnergy: { value: 1 },
    uFlash: { value: 0 },
    uTint: { value: new THREE.Vector3(1, 0.6, 0.3) },
    uTint2: { value: new THREE.Vector3(0.8, 0.2, 0.9) },
    uMoodC: { value: 0.5 },   // mood palette: idx -> mix(uMoodC, idx, uMoodS)  (0.5 / 1.0 = unchanged)
    uMoodS: { value: 1 },
  };

  // ================================================================== 1. FRACTAL CORE
  const FRACTAL_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

  const FRACTAL_FRAG = /* glsl */ `
#define MAX_STEPS 112
#define MAX_ITER 8
#define RB ${RB.toFixed(3)}

uniform vec3 uCenter;
uniform float uRadius;
uniform mat3 uRot;
uniform float uPower;
uniform float uScale;
uniform float uTwist;
uniform float uTime;
uniform float uPhase;
uniform float uEnergy;
uniform float uCool;
uniform float uFlick;
uniform float uFlash;
uniform vec3 uLightW;
uniform vec3 uTint;
uniform vec3 uTint2;
uniform int uSteps;
uniform int uIter;
uniform float uStepScale;
uniform float uPixelAng;
uniform float uEpsK;
uniform float uGlowK;
uniform float uMoodC;
uniform float uMoodS;
uniform float uIrid;
uniform float uPlasma;
uniform vec3 uMolten;
uniform float uSweep;

varying vec3 vWorld;
${GLSL_PAL}

// Mandelbulb distance estimate (trig form so the power can drift continuously).
float de(vec3 p, out vec4 trap) {
  p *= uScale;
  float tw = uTwist * p.y;
  float cs = cos(tw);
  float sn = sin(tw);
  p.xz = vec2(cs * p.x - sn * p.z, sn * p.x + cs * p.z);
  vec3 w = p;
  float m = dot(w, w);
  float dz = 1.0;
  trap = vec4(abs(w), m);
  for (int i = 0; i < MAX_ITER; i++) {
    if (i >= uIter) break;
    float r = max(sqrt(m), 0.00001);
    float rn = exp2(uPower * log2(r));
    dz = uPower * (rn / r) * dz + 1.0;
    float b = uPower * acos(clamp(w.y / r, -1.0, 1.0));
    float a = uPower * atan(w.x, w.z);
    float sb = sin(b);
    w = p + rn * vec3(sb * sin(a), cos(b), sb * cos(a));
    m = dot(w, w);
    trap = min(trap, vec4(abs(w), m));
    if (m > 64.0) break;
  }
  m = max(m, 0.000001);
  return 0.25 * log(m) * sqrt(m) / dz / uScale;
}

void main() {
  vec3 rdW = normalize(vWorld - cameraPosition);
  float unit = uRadius / RB;
  vec3 ro = uRot * ((cameraPosition - uCenter) / unit);
  vec3 rd = uRot * rdW;

  // ray / bounding sphere (stable form)
  float tm = -dot(ro, rd);
  vec3 cp = ro + rd * tm;
  float d2 = dot(cp, cp);
  float h2 = RB * RB - d2;
  if (h2 <= 0.0) discard;
  float hh = sqrt(h2);
  float t0 = max(tm - hh, 0.0);
  ro += rd * t0;
  float tmax = tm + hh - t0;

  float t = 0.0;
  float glow = 0.0;
  float dLast = 1.0;
  bool hit = false;
  int steps = 0;
  vec4 trap = vec4(1.0);
  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;
    float d = de(ro + rd * t, trap);
    float eps = max(0.0006, (t0 + t) * uPixelAng * uEpsK);
    glow += max(d, 0.0) * uStepScale / (1.0 + d * d * uGlowK);
    steps = i;
    dLast = d;
    if (d < eps) { hit = true; break; }
    t += d * uStepScale;
    if (t > tmax) break;
  }
  // ran out of steps right next to the surface (grazing silhouette): treat as a hot crevice hit
  if (!hit && t < tmax && dLast < 0.03) hit = true;

  float edge = 1.0 - smoothstep(0.5, 1.0, sqrt(d2) / RB);
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  if (hit) {
    vec3 pos = ro + rd * t;
    float ne = max(0.0015, (t0 + t) * uPixelAng * 1.2);
    vec4 tmp = vec4(0.0);
    vec2 k = vec2(1.0, -1.0);
    vec3 gn = k.xyy * de(pos + k.xyy * ne, tmp)
            + k.yyx * de(pos + k.yyx * ne, tmp)
            + k.yxy * de(pos + k.yxy * ne, tmp)
            + k.xxx * de(pos + k.xxx * ne, tmp);
    vec3 n = gn / max(length(gn), 0.000000001);
    vec3 L = normalize(uRot * uLightW);

    float ndv = clamp(dot(n, -rd), 0.0, 1.0);
    float f1 = 1.0 - ndv;
    float fres = f1 * f1 * f1;
    float diff = dot(n, L) * 0.5 + 0.5;
    float cav = clamp(float(steps) / float(uSteps), 0.0, 1.0);

    float ci = 0.5 * trap.y + 0.35 * trap.z + 0.45 * sqrt(trap.w);
    // iridescence: the hue sweeps with view angle (thin-film look), slowly shimmering
    float irid = uIrid * (f1 * 0.62 + 0.14 * sin(ndv * 9.0 - uTime * 0.3 + ci * 2.0));
    float idx = tri(ci * 1.2 + uPhase + fres * 0.35 + n.y * 0.12 + irid);
    idx = mix(idx, 0.6 + 0.4 * idx, uCool);
    idx = mix(uMoodC, idx, uMoodS);
    vec3 base = godPal(idx, 0.9);

    // orbit-trap veins: where the orbit grazed the coordinate planes
    float vl = clamp(1.0 - trap.y * 7.0, 0.0, 1.0);
    float vl2 = clamp(1.0 - trap.x * 9.0, 0.0, 1.0);
    float vl3 = clamp(1.0 - trap.z * 8.0, 0.0, 1.0);
    float veins = 0.8 * vl * vl * vl + 0.7 * vl2 * vl2 * vl2 + 0.7 * vl3 * vl3 * vl3;
    float hot = clamp(cav * cav * cav * 2.2 + veins * 1.6, 0.0, 2.5);

    vec3 molten = mix(uMolten, vec3(0.45, 0.85, 1.0), uCool * 0.8);
    molten = mix(molten, vec3(1.0, 0.95, 0.85), clamp(hot - 0.7, 0.0, 1.0));
    vec3 rim = godPal(tri(idx + 0.3), 0.75);

    col = base * (0.03 + 0.7 * diff * diff) * (1.0 - 0.7 * cav)
        + molten * hot * 1.1 * uEnergy
        + rim * fres * fres * 1.3 * (0.6 + 0.4 * uEnergy)
        + uTint * glow * 0.25;

    // desktop tier only (uPlasma = 0 in VR): living plasma + electric filaments seen deep in the crevices
    if (uPlasma > 0.01) {
      vec3 q = pos * 2.4 + vec3(0.0, uTime * 0.35, 0.0);
      q += 0.55 * sin(q.zxy * 1.9 + uTime * 0.6);
      q += 0.28 * sin(q.yzx * 3.7 - uTime * 0.8);
      float fil = 1.0 - abs(sin(q.x * 2.2 + sin(q.y * 2.0 + sin(q.z * 2.4))));
      fil = fil * fil; fil *= fil; fil *= fil;
      float cloud = 0.5 + 0.5 * sin(q.x * 1.5 + q.y * 1.3 + q.z * 1.7);
      float inner = smoothstep(0.25, 0.85, cav) + 0.35 * clamp(veins, 0.0, 1.0);
      vec3 pc = mix(uTint2, vec3(1.0, 0.95, 0.85), fil) * (0.35 * cloud + 1.8 * fil);
      col += pc * inner * uPlasma * uEnergy;
    }

    // thinking: an orbit-trap colour sweep, a travelling band of light that climbs through the fractal's own structure
    if (uSweep > 0.01) {
      float sx = (fract(ci * 0.7 - uTime * 0.55) - 0.5) * 5.0;
      float sy = (fract(ci * 1.3 + uTime * 0.31) - 0.5) * 7.0;
      float sw = exp(-sx * sx) + 0.6 * exp(-sy * sy);
      col += mix(uTint2, vec3(1.0, 0.95, 0.82), 0.55) * sw * uSweep * (0.35 + veins);
    }

    // racing flickers of light (thinking / transcribing)
    if (uFlick > 0.01) {
      float ph = dot(pos, vec3(0.62, 0.55, 0.56)) * 7.0 - uTime * 11.0 + trap.y * 5.0;
      float s1 = 0.5 + 0.5 * sin(ph);
      s1 *= s1; s1 *= s1; s1 *= s1;
      float ph2 = dot(pos, vec3(-0.5, 0.7, 0.5)) * 5.0 + uTime * 8.0 + trap.z * 4.0;
      float s2 = 0.5 + 0.5 * sin(ph2);
      s2 *= s2; s2 *= s2; s2 *= s2; s2 *= s2;
      col += mix(vec3(1.0, 0.92, 0.75), uTint2, 0.35) * (s1 + s2) * uFlick * (0.5 + veins);
    }
    alpha = 1.0;
  } else {
    // misses: purely additive subsurface/atmosphere glow accumulated along the ray
    float g = glow * edge * 0.75;
    float m2 = clamp(g * 0.7, 0.0, 1.0);
    col = mix(uTint, uTint2, 1.0 - m2) * g * uEnergy;
    alpha = 0.0;
    if (g < 0.004) discard;
  }

  col *= 1.0 + uFlash * 0.8;
  col = 1.0 - exp(-col * 1.35);   // soft filmic roll-off, white-hot cores desaturate naturally
  gl_FragColor = vec4(col, alpha); // premultiplied: alpha 1 = opaque body, alpha 0 = additive glow
}
`;

  const fractalUniforms = Object.assign({}, U, {
    uRot: { value: new THREE.Matrix3() },
    uPower: { value: 8 },
    uScale: { value: 1 },
    uTwist: { value: 0.1 },
    uFlick: { value: 0 },
    uLightW: { value: new THREE.Vector3(0.3, 0.6, 0.7) },
    uSteps: { value: 40 },
    uIter: { value: 5 },
    uStepScale: { value: 0.78 },
    uPixelAng: { value: 0.00095 },
    uEpsK: { value: 1.0 },
    uGlowK: { value: 60 },
    uIrid: { value: 1 },
    uPlasma: { value: 0 },
    uMolten: { value: new THREE.Vector3(1.0, 0.55, 0.12) },
    uSweep: { value: 0 },
  });

  const fractalMat = new THREE.ShaderMaterial({
    uniforms: fractalUniforms,
    vertexShader: FRACTAL_VERT,
    fragmentShader: FRACTAL_FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    fog: false,
    toneMapped: false,
  });
  const fractal = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), fractalMat);
  fractal.position.copy(POS);
  fractal.scale.setScalar(RADIUS * 1.03);
  fractal.frustumCulled = false;
  fractal.renderOrder = 11;
  fractal.name = 'oracle-fractal';
  root.add(fractal);

  // ================================================================== 2. CORONA (additive billboard)
  // CORONA_R: where the glow fades out completely (sphere radii). The mesh is a 28-gon, not a square, and its radius (uQuadR) follows the light
  // that is actually bright enough to show (see coronaExtent): at idle that is about half the area the full 2.8 x 2.8 quad used to cover.
  const CORONA_R = 2.8;
  const CORONA_EPS = 0.0012;  // below this (0.3 of an 8-bit step) a pixel of the corona cannot be seen
  const coronaMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, {
      uGain: { value: 1 },
      uFlare: { value: 0 },
      uEclipse: { value: 0 },        // wrath: the body goes dark, a thin white-hot rim and long streamers remain
      uQuadR: { value: CORONA_R },   // sphere radii covered by the mesh (rho at its rim)
      uEnd: { value: CORONA_R },     // sphere radii where the glow has faded to nothing (smaller on the lowest tier)
      uSize: { value: RADIUS * CORONA_R },
    }),
    vertexShader: /* glsl */ `
uniform vec3 uCenter;
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = uCenter + (right * position.x + up * position.y) * uSize;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform float uGain;
uniform float uFlare;
uniform float uEclipse;
uniform float uQuadR;
uniform float uEnd;
uniform vec3 uTint;
uniform vec3 uTint2;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float rho = r * uQuadR;                 // radius in sphere radii
  float a = atan(vUv.y, vUv.x);
  float rx = max(rho - 0.95, 0.0);
  float body = 0.5 * exp(-rho * rho * 0.45);
  float atmo = 0.55 * exp(-rx * 3.0) * mix(0.4, 1.0, smoothstep(0.6, 1.0, rho));
  // counter-rotating streamers
  float s1 = 0.5 + 0.5 * sin(a * 9.0 + uTime * 0.21 + 2.5 * sin(a * 2.0 - uTime * 0.13));
  float s2 = 0.5 + 0.5 * sin(a * 15.0 - uTime * 0.33 + 3.0 * sin(a * 3.0 + uTime * 0.17));
  float s3 = 0.5 + 0.5 * sin(a * 5.0 + uTime * 0.09 - 1.7 * sin(a * 4.0 + uTime * 0.23));
  s1 *= s1; s1 *= s1;
  s2 *= s2; s2 *= s2; s2 *= s2;
  s3 *= s3; s3 *= s3;
  float streak = (0.55 * s1 + 0.4 * s2 + 0.5 * s3) * exp(-rx * (1.5 - 0.5 * uFlare)) * smoothstep(0.8, 1.1, rho);
  body *= 1.0 - 0.7 * uEclipse; atmo *= 1.0 - 0.3 * uEclipse; streak *= 1.0 + 1.5 * uEclipse;
  vec3 col = uTint * (body + atmo) + uTint2 * streak * (0.7 + 0.9 * uFlare);
  col += vec3(1.0, 0.85, 0.6) * 0.35 * exp(-rx * 7.0) * smoothstep(0.85, 1.0, rho);
  float er = (rho - 1.0) / 0.045;
  col += mix(uTint2, vec3(1.0, 0.9, 0.8), 0.5) * exp(-er * er) * 2.2 * uEclipse;   // diamond rim of the eclipse
  col *= uGain * (1.0 - smoothstep(0.6 * uEnd, uEnd, rho));   // (= 1 - smoothstep(0.6, 1.0, rho / 2.8) while uEnd = 2.8)
  gl_FragColor = vec4(col, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const corona = new THREE.Mesh(new THREE.CircleGeometry(1 / Math.cos(Math.PI / 28), 28), coronaMat); // circumscribed 28-gon: covers the unit circle, not the square
  corona.frustumCulled = false;
  corona.renderOrder = 10;
  corona.name = 'oracle-corona';
  root.add(corona);

  // ================================================================== 3. SHARD RINGS
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const shardMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, {
      uRipCol: { value: new THREE.Vector3(1, 1, 1) },   // set-piece ripple: colour, front progress 0..1, band strength
      uRipP: { value: 0 },
      uRipAmt: { value: 0 },
      uFill: { value: 0 },                              // whole-ring wash in uRipCol (hurt flicker, kill flash)
    }),
    vertexShader: /* glsl */ `
attribute vec4 aSeed;
varying vec3 vWorld;
varying vec4 vSeed;
void main() {
  vec4 wp = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vWorld = wp.xyz;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`,
    fragmentShader: /* glsl */ `
uniform vec3 uCenter;
uniform vec3 uTint;
uniform vec3 uTint2;
uniform float uTime;
uniform float uPhase;
uniform float uCool;
uniform float uEnergy;
uniform float uFlash;
uniform float uRadius;
uniform float uMoodC;
uniform float uMoodS;
uniform vec3 uRipCol;
uniform float uRipP;
uniform float uRipAmt;
uniform float uFill;
varying vec3 vWorld;
varying vec4 vSeed;
${GLSL_PAL}
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));   // flat facets: crystalline
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  vec3 Lc = normalize(uCenter - vWorld);                    // lit by the oracle itself
  float nl = dot(n, Lc);
  float diff = max(nl, 0.0);
  float wrap = nl * 0.5 + 0.5;
  float f1 = 1.0 - max(dot(n, V), 0.0);
  float fres = f1 * f1 * f1;
  vec3 hv = normalize(Lc + V);
  float spec = pow(max(dot(n, hv), 0.0), 40.0);
  float idx = tri(vSeed.x * 0.3 + uPhase + fres * 0.5 + n.y * 0.15);
  idx = mix(idx, 0.6 + 0.4 * idx, uCool);
  idx = mix(uMoodC, idx, uMoodS);
  vec3 base = godPal(idx, 0.85);
  float tw = 0.5 + 0.5 * sin(uTime * (0.8 + 3.0 * vSeed.z) + vSeed.y * 80.0);
  tw *= tw; tw *= tw; tw *= tw;
  // set-piece ripple: a band of colour sweeping outward through the rings, plus a whole-ring wash
  float rb = (length(vWorld - uCenter) / uRadius - mix(0.9, 3.5, uRipP)) / 0.34;
  float band = exp(-rb * rb) * uRipAmt;
  vec3 col = base * (0.05 + 0.75 * diff) * (0.7 + 0.5 * uEnergy)
           + uTint * wrap * 0.16 * uEnergy
           + base * fres * 0.9
           + vec3(1.0, 0.95, 0.8) * spec * 0.9
           + uTint2 * tw * 0.55 * (uEnergy + uFlash)
           + uRipCol * (band * 2.6 + uFill * (0.3 + 0.7 * tw + 0.4 * fres));
  col = 1.0 - exp(-col * 1.2);
  gl_FragColor = vec4(col, 1.0);
}
`,
    fog: false,
    toneMapped: false,
  });

  const shardBase = new THREE.OctahedronGeometry(1, 0);

  // ring definitions: radius in sphere radii, tilt (euler x,z), spin rad/s, per-shard shape callback
  const RING_DEFS = [
    {
      n: 84, r: 1.62, tilt: [0.28, 0.1], spin: 0.06, seed: 11,
      shape(k, rnd) { // wide cog blades with big teeth
        const big = k % 7 === 0;
        return { sx: big ? 9.5 : 4.6, sy: big ? 3.4 : 1.5, sz: big ? 1.7 : 1.0, dr: big ? 0.06 : 0, dy: (rnd() - 0.5) * 1.5 };
      },
    },
    {
      n: 110, r: 2.05, tilt: [1.12, -0.4], spin: -0.042, seed: 23,
      shape(k, rnd) { // crown of spires
        const big = k % 9 === 0;
        return { sx: 2.0, sy: big ? 17 : 7 + rnd() * 5, sz: 1.2, dr: 0, dy: 0 };
      },
    },
    {
      n: 170, r: 2.62, tilt: [-0.62, 0.85], spin: 0.026, seed: 37,
      shape(k, rnd) { // fine grain with occasional monoliths
        if (k % 17 === 0) return { sx: 10, sy: 3.2, sz: 2.0, dr: 0.04, dy: 0 };
        return { sx: 2.4 + rnd() * 2, sy: 0.8 + rnd() * 0.8, sz: 0.8, dr: (rnd() - 0.5) * 0.05, dy: (rnd() - 0.5) * 3 };
      },
    },
  ];

  const _m4 = new THREE.Matrix4();
  const _qa = new THREE.Quaternion();
  const _qb = new THREE.Quaternion();
  const _eu = new THREE.Euler();
  const _p3 = new THREE.Vector3();
  const _s3 = new THREE.Vector3();
  const _tv = new THREE.Vector3();
  const _uv = new THREE.Vector3(0, 1, 0);
  const _rv = new THREE.Vector3();

  const rings = RING_DEFS.map((def, ri) => {
    const rnd = mulberry32(def.seed);
    const geo = shardBase.clone();
    const seeds = new Float32Array(def.n * 4);
    const mesh = new THREE.InstancedMesh(geo, shardMat, def.n);
    const local = new Float32Array(def.n * 3); // shard positions in ring space (lightning jumps to them)
    for (let k = 0; k < def.n; k++) {
      const th = ((k + rnd() * 0.3) / def.n) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const sh = def.shape(k, rnd);
      const rad = def.r * RADIUS * (1 + sh.dr);
      _p3.set(c * rad, sh.dy, s * rad);
      _tv.set(-s, 0, c);
      _rv.set(-c, 0, -s); // tangent x up = -radial: keeps the basis right-handed
      _m4.makeBasis(_tv, _uv, _rv);
      _qa.setFromRotationMatrix(_m4);
      _eu.set((rnd() - 0.5) * 0.35, (rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.4);
      _qb.setFromEuler(_eu);
      _qa.multiply(_qb);
      _s3.set(sh.sx, sh.sy, sh.sz);
      _m4.compose(_p3, _qa, _s3);
      mesh.setMatrixAt(k, _m4);
      local[k * 3] = _p3.x; local[k * 3 + 1] = _p3.y; local[k * 3 + 2] = _p3.z;
      seeds[k * 4] = rnd(); seeds[k * 4 + 1] = rnd(); seeds[k * 4 + 2] = rnd(); seeds[k * 4 + 3] = ri;
    }
    mesh.instanceMatrix.needsUpdate = true;
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    mesh.frustumCulled = false;
    mesh.name = 'oracle-ring-' + ri;
    const group = new THREE.Group();
    group.position.copy(POS);
    group.add(mesh);
    root.add(group);
    return { def, mesh, group, angle: rnd() * 6.28, ri, local };
  });

  // ================================================================== 4. MOTES (additive points)
  const moteGeo = new THREE.BufferGeometry();
  {
    const rnd = mulberry32(777);
    const pos = new Float32Array(N_MOTES * 3);
    const rn = new Float32Array(N_MOTES * 4);
    for (let i = 0; i < N_MOTES; i++) {
      const u = rnd() * 2 - 1, ph = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const r = 1.25 + Math.pow(rnd(), 1.6) * 2.7;
      pos[i * 3] = s * Math.cos(ph) * r; pos[i * 3 + 1] = u * r * 0.8; pos[i * 3 + 2] = s * Math.sin(ph) * r;
      rn[i * 4] = rnd(); rn[i * 4 + 1] = rnd(); rn[i * 4 + 2] = rnd(); rn[i * 4 + 3] = rnd();
    }
    moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    moteGeo.setAttribute('aRnd', new THREE.BufferAttribute(rn, 4));
  }
  const moteMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uSpin: { value: 0 }, uViewH: { value: 1800 }, uPtMax: { value: 12 } }),
    vertexShader: /* glsl */ `
attribute vec4 aRnd;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uTime;
uniform float uSpin;
uniform float uViewH;
uniform float uPtMax;
varying float vA;
varying float vMix;
void main() {
  float dir = aRnd.y < 0.5 ? 1.0 : -1.0;
  float ang = uSpin * dir * (0.6 + aRnd.x * 0.8);
  float c = cos(ang);
  float s = sin(ang);
  vec3 p = position;
  p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
  p.y += 0.07 * sin(uTime * 0.4 + aRnd.z * 6.2831);
  vec3 wp = uCenter + p * uRadius;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;

  // analytic occlusion by the fractal sphere (it does not write depth)
  vec3 toM = wp - cameraPosition;
  float dist = length(toM);
  vec3 rdir = toM / dist;
  vec3 oc = uCenter - cameraPosition;
  float tc = dot(oc, rdir);
  float dd = dot(oc, oc) - tc * tc;
  float occ = (tc < dist) ? smoothstep(0.8 * uRadius * uRadius, uRadius * uRadius, dd) : 1.0;

  float tw = 0.5 + 0.5 * sin(uTime * (0.5 + aRnd.w * 1.8) + aRnd.x * 60.0);
  vA = occ * (0.25 + 0.75 * tw * tw);
  vMix = aRnd.w;
  float size = 1.0 + 2.6 * aRnd.z * aRnd.z;
  gl_PointSize = clamp(size * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 1.0), 1.5, uPtMax);
}
`,
    fragmentShader: /* glsl */ `
uniform vec3 uTint;
uniform vec3 uTint2;
uniform float uEnergy;
varying float vA;
varying float vMix;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float a = clamp(1.0 - d, 0.0, 1.0);
  a *= a;
  vec3 col = mix(uTint, uTint2, vMix);
  col = mix(col, vec3(1.0, 0.95, 0.85), 0.35);
  gl_FragColor = vec4(col * a * vA * (0.8 + 0.5 * uEnergy), 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  motes.renderOrder = 14;
  motes.name = 'oracle-motes';
  root.add(motes);

  // ================================================================== 5. SPARKS (coding): GPU-animated pool
  const sparkGeo = new THREE.InstancedBufferGeometry();
  {
    const quad = new THREE.PlaneGeometry(2, 2);
    sparkGeo.index = quad.index;
    sparkGeo.setAttribute('position', quad.attributes.position);
    const rnd = mulberry32(4242);
    const a = new Float32Array(MAX_SPARKS * 4);
    const b = new Float32Array(MAX_SPARKS * 4);
    for (let i = 0; i < MAX_SPARKS; i++) {
      a[i * 4] = rnd(); a[i * 4 + 1] = rnd(); a[i * 4 + 2] = rnd(); a[i * 4 + 3] = (i + rnd()) / MAX_SPARKS; // gate: spread so uCode scales density
      b[i * 4] = rnd(); b[i * 4 + 1] = rnd(); b[i * 4 + 2] = rnd(); b[i * 4 + 3] = rnd();
    }
    sparkGeo.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4));
    sparkGeo.setAttribute('aB', new THREE.InstancedBufferAttribute(b, 4));
    sparkGeo.instanceCount = MAX_SPARKS;
  }
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, {
      uCode: { value: 0 },
      uStart: { value: POS.clone() },
      uTarget: { value: new THREE.Vector3(0, 0.2, -10) },
      uSparkK: { value: 1 },   // 1 = sky; PT_SPARK_K in passthrough (min width, landing spread, helix end radius)
    }),
    vertexShader: /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
uniform float uTime;
uniform float uCode;
uniform float uRadius;
uniform float uSparkK;
uniform vec3 uStart;
uniform vec3 uTarget;
varying vec2 vUv;
varying float vA;
varying float vHeat;

vec3 bez(vec3 a, vec3 b, vec3 c, float u) { float v = 1.0 - u; return v * v * a + 2.0 * u * v * b + u * u * c; }
vec3 bezT(vec3 a, vec3 b, vec3 c, float u) { return 2.0 * (1.0 - u) * (b - a) + 2.0 * u * (c - b); }

void main() {
  vUv = position.xy;
  float gate = smoothstep(aA.w, aA.w + 0.1, uCode);
  float life = fract(aA.x + uTime * (0.15 + 0.12 * aA.y));
  float u = life * life * 0.65 + life * 0.35;

  vec3 dirS = normalize(vec3(aB.x * 2.0 - 1.0, -0.25 - 0.75 * aB.y, aB.z * 2.0 - 1.0));
  vec3 S = uStart + dirS * uRadius * 0.8;
  vec3 E = uTarget + vec3(aB.w * 2.0 - 1.0, 0.0, aB.y * 2.0 - 1.0) * (7.0 * uSparkK);
  vec3 C = vec3(mix(S.x, E.x, 0.7), mix(S.y, E.y, 0.55), mix(S.z, E.z, 0.7));
  vec3 T = bezT(S, C, E, u);
  vec3 Tn = T / max(length(T), 0.0001);
  vec3 side = cross(Tn, vec3(0.0, 1.0, 0.0));
  side = side / max(length(side), 0.0001);
  vec3 up2 = cross(side, Tn);
  float ang = u * 7.0 + aB.z * 6.2831 + uTime * 0.6;
  float rad = mix(uRadius * 0.3, 0.9 * uSparkK, smoothstep(0.0, 0.95, u)) * (0.3 + 0.7 * aB.w);
  vec3 c = bez(S, C, E, u) + (side * cos(ang) + up2 * sin(ang)) * rad;

  float dist = length(cameraPosition - c);
  vec3 toCam = (cameraPosition - c) / max(dist, 0.0001);
  vec3 sd = cross(Tn, toCam);
  sd = sd / max(length(sd), 0.0001);
  float wid = max(0.1 * uSparkK, dist * 0.0021) * (0.7 + aA.z * 0.9);
  float len = wid * (3.0 + 5.0 * aA.z);
  vec3 wp = c + sd * position.x * wid + Tn * position.y * len;

  vA = gate * smoothstep(0.0, 0.04, life) * (1.0 - smoothstep(0.88, 1.0, life));
  vHeat = 1.0 - life;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  if (vA < 0.002) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform vec3 uTint;
uniform vec3 uTint2;
varying vec2 vUv;
varying float vA;
varying float vHeat;
void main() {
  float d = length(vec2(vUv.x, max(abs(vUv.y) - 0.35, 0.0) / 0.65));
  float a = clamp(1.0 - d, 0.0, 1.0);
  a = a * a * (3.0 - 2.0 * a);
  vec3 col = mix(uTint2, vec3(1.0, 0.9, 0.62), vHeat * vHeat);
  col = mix(col, uTint, 0.25);
  gl_FragColor = vec4(col * a * vA * 1.7, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const sparks = new THREE.Mesh(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  sparks.renderOrder = 15;
  sparks.visible = false;
  sparks.name = 'oracle-sparks';
  root.add(sparks);

  // ================================================================== 6. BEAM (listening)
  const beamGeo = new THREE.CylinderGeometry(0.16, 1, 1, 20, 1, true);
  beamGeo.translate(0, 0.5, 0); // base (wide) at y=0 near the oracle, tip at y=1 toward the player
  const beamMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uBeam: { value: 0 } }),
    vertexShader: /* glsl */ `
varying vec3 vNW;
varying vec3 vW;
varying float vS;
void main() {
  vS = position.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vNW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`,
    fragmentShader: /* glsl */ `
uniform float uBeam;
uniform float uTime;
uniform vec3 uTint;
varying vec3 vNW;
varying vec3 vW;
varying float vS;
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float f = abs(dot(normalize(vNW), V));
  float a = 0.15 + 0.85 * f * f;
  a *= smoothstep(0.0, 0.08, vS) * (1.0 - smoothstep(0.35, 1.0, vS));
  a *= 0.75 + 0.25 * sin(vS * 60.0 - uTime * 4.0);
  gl_FragColor = vec4(mix(uTint, vec3(1.0), 0.35) * a * uBeam * 0.5, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.frustumCulled = false;
  beam.renderOrder = 12;
  beam.visible = false;
  beam.name = 'oracle-beam';
  root.add(beam);

  // ================================================================== 7. SHOCKWAVE (pulse)
  // The shockwave and the sound rings are thin bright bands on a huge disc (5.5 / 3.3 sphere radii: more than the whole view at spawn). They used to be
  // ONE full-disc quad each; now each ring is its own instance of a thin annulus (ring strip) sized to where that ring is bright enough to see, so the
  // fill cost is the band, not the disc (about a tenth). The per-ring maths is the old shader's, and rings add up on the framebuffer exactly as they
  // added up in the old loop.
  const SHOCK_R = 5.5;
  const RING_SEG = 40;
  // half-width, in Gaussian widths (exp(-x^2)), outside which a ring of peak brightness `peak` is below CORONA_EPS (0 = invisible altogether)
  const bandWidth = (peak) => (peak > CORONA_EPS * 1.5 ? Math.sqrt(Math.log(peak / CORONA_EPS)) : 0);
  function ringStripGeometry(nInst) { // unit ring strip: position = (cos, sin, t) with t 0 = inner edge, 1 = outer edge; aBand = (progress, amplitude, rin, rout) per instance
    const g = new THREE.InstancedBufferGeometry();
    const pos = new Float32Array((RING_SEG + 1) * 2 * 3), idx = [];
    for (let i = 0; i <= RING_SEG; i++) {
      const an = (i / RING_SEG) * Math.PI * 2, c = Math.cos(an), s = Math.sin(an);
      pos.set([c, s, 0], i * 6); pos.set([c, s, 1], i * 6 + 3);
      if (i < RING_SEG) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    const band = new THREE.InstancedBufferAttribute(new Float32Array(nInst * 4), 4);
    band.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aBand', band);
    g.instanceCount = nInst;
    return g;
  }
  const RING_VERT = /* glsl */ `
attribute vec4 aBand;
uniform vec3 uCenter;
uniform float uRadius;
varying float vRho;
varying vec2 vB;
void main() {
  float rho = mix(aBand.z, aBand.w, position.z);
  vRho = rho;
  vB = aBand.xy;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = uCenter + (right * position.x + up * position.y) * (rho * uRadius);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
  const shockMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uQuadR: { value: SHOCK_R }, uPrism: { value: 0 } }),
    vertexShader: RING_VERT,
    fragmentShader: /* glsl */ `
uniform float uQuadR;
uniform float uPrism;
uniform float uTime;
uniform vec3 uTint;
uniform vec3 uTint2;
varying float vRho;
varying vec2 vB;
${GLSL_PAL}
float ringOf(float rho) {
  float p = clamp(vB.x, 0.0, 1.0);
  float q = 1.0 - p;
  float e = 1.0 - q * q * q;
  float c = mix(1.0, uQuadR * 0.9, e);
  float wd = 0.07 + 0.35 * p;
  float x = (rho - c) / wd;
  return vB.y * exp(-x * x) * q * q;
}
void main() {
  float rho = vRho;
  vec3 k = vec3(ringOf(rho * 1.05), ringOf(rho), ringOf(rho * 0.95)); // chromatic split
  vec3 col = k * mix(vec3(1.0), uTint, 0.45) * 1.6;
  col += uTint2 * k.g * 0.4;
  col = mix(col, hsv2rgb(vec3(fract(rho * 0.45 - uTime * 0.25), 0.8, 1.0)) * (k.r + k.g + k.b) * 0.75, uPrism);   // joy: a prismatic burst
  col *= 1.0 - smoothstep(0.75 * uQuadR, uQuadR, rho);
  gl_FragColor = vec4(col, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const shockGeo = ringStripGeometry(3);
  const shock = new THREE.Mesh(shockGeo, shockMat);
  shock.frustumCulled = false;
  shock.renderOrder = 13;
  shock.visible = false;
  shock.name = 'oracle-shock';
  root.add(shock);

  // ================================================================== 8. GAZE RING on the ground (listening)
  const gazeGeo = new THREE.PlaneGeometry(2, 2);
  gazeGeo.rotateX(-Math.PI / 2);
  const gazeMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uGaze: { value: 0 } }),
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform float uGaze;
uniform float uTime;
uniform vec3 uTint;
varying vec2 vUv;
void main() {
  float rho = length(vUv);
  if (rho >= 1.0) discard;
  float a = atan(vUv.y, vUv.x);
  float q1 = (rho - 0.62) / 0.022;\n  float q2 = (rho - 0.85) / 0.03;\n  float q3 = (rho - 0.42) / 0.015;\n  float ring1 = exp(-q1 * q1);
  float dash = smoothstep(0.35, 0.65, 0.5 + 0.5 * sin(a * 12.0 - uTime * 1.2));
  float ring2 = exp(-q2 * q2) * dash;
  float ring3 = exp(-q3 * q3) * (0.5 + 0.5 * sin(a * 6.0 + uTime * 0.9));
  float disc = 0.18 * exp(-rho * rho * 5.0);
  float v = (ring1 * 0.9 + ring2 * 0.8 + ring3 * 0.6 + disc) * (1.0 - smoothstep(0.85, 1.0, rho));
  gl_FragColor = vec4(mix(uTint, vec3(1.0), 0.3) * v * uGaze * 0.55, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: false,
    toneMapped: false,
  });
  const gaze = new THREE.Mesh(gazeGeo, gazeMat);
  gaze.frustumCulled = false;
  gaze.renderOrder = 16;
  gaze.visible = false;
  gaze.scale.setScalar(3.4);
  gaze.name = 'oracle-gaze';
  root.add(gaze);

  // ================================================================== 10. RUNES (a halo of invented glyphs, one draw call)
  let runeTex;
  try {
    const cv = typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null;
    const g = cv && cv.getContext ? cv.getContext('2d') : null;
    if (!g) throw new Error('no canvas');
    const CELL = 64;
    cv.width = GLYPH_COLS * CELL; cv.height = GLYPH_ROWS * CELL;
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
    const rnd = mulberry32(0x0a1b);
    const gx = [0.26, 0.5, 0.74], gy = [0.16, 0.33, 0.5, 0.67, 0.84]; // 3 x 5 lattice inside a cell
    for (let gi = 0; gi < GLYPH_COLS * GLYPH_ROWS; gi++) {
      const ox = (gi % GLYPH_COLS) * CELL, oy = Math.floor(gi / GLYPH_COLS) * CELL;
      const X = (a) => ox + gx[a] * CELL, Y = (b) => oy + gy[b] * CELL;
      g.lineWidth = 3.4;
      if (rnd() < 0.7) { g.beginPath(); g.moveTo(X(1), Y(0)); g.lineTo(X(1), Y(4)); g.stroke(); } // spine
      const n = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < n; s++) {
        const t = Math.floor(rnd() * 6);
        const a = Math.floor(rnd() * 3), b = Math.floor(rnd() * 5);
        if (t === 0) { // free line between lattice points
          const a2 = Math.floor(rnd() * 3), b2 = Math.floor(rnd() * 5);
          g.beginPath(); g.moveTo(X(a), Y(b)); g.lineTo(X(a2), Y(b2 === b && a2 === a ? (b2 + 2) % 5 : b2)); g.stroke();
        } else if (t === 1) { // arc
          const a0 = rnd() * 6.283;
          g.beginPath(); g.arc(X(a), Y(b), (0.11 + rnd() * 0.13) * CELL, a0, a0 + 1.6 + rnd() * 3.0); g.stroke();
        } else if (t === 2) { // small ring
          g.beginPath(); g.arc(X(a), Y(b), (0.06 + rnd() * 0.05) * CELL, 0, 6.283); g.stroke();
        } else if (t === 3) { // dot
          g.beginPath(); g.arc(X(a), Y(b), 2.6, 0, 6.283); g.fill();
        } else if (t === 4) { // crossbar
          g.beginPath(); g.moveTo(X(0), Y(b)); g.lineTo(X(2), Y(b)); g.stroke();
        } else { // chevron
          const b2 = Math.min(4, b + 1 + Math.floor(rnd() * 2));
          g.beginPath(); g.moveTo(X(0), Y(b)); g.lineTo(X(1), Y(b2)); g.lineTo(X(2), Y(b)); g.stroke();
        }
      }
      if (rnd() < 0.45) { g.beginPath(); g.arc(X(1) + (rnd() - 0.5) * 8, oy + 0.07 * CELL, 2.3, 0, 6.283); g.fill(); } // diacritic
    }
    runeTex = new THREE.CanvasTexture(cv);
  } catch (err) {
    runeTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); // glyphs degrade to soft squares
    runeTex.needsUpdate = true;
  }

  const runeGeo = new THREE.InstancedBufferGeometry();
  {
    const quad = new THREE.PlaneGeometry(1, 1);
    runeGeo.index = quad.index;
    runeGeo.setAttribute('position', quad.attributes.position);
    runeGeo.setAttribute('uv', quad.attributes.uv);
    const rnd = mulberry32(909);
    const a = new Float32Array(N_RUNES * 4);
    const cnt = [0, 0];
    for (let i = 0; i < N_RUNES; i++) { // interleaved bands, golden-angle spacing: any prefix of the instances is evenly spread
      const band = i & 1;
      a[i * 4] = cnt[band]++ * 2.399963 + band * 1.1; a[i * 4 + 1] = band; a[i * 4 + 2] = Math.floor(rnd() * GLYPH_COLS * GLYPH_ROWS); a[i * 4 + 3] = rnd();
    }
    runeGeo.setAttribute('aRune', new THREE.InstancedBufferAttribute(a, 4));
    runeGeo.instanceCount = N_RUNES;
  }
  const runeMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, {
      uAtlas: { value: runeTex },
      uSpinA: { value: 0 }, uSpinB: { value: 0 }, uRead: { value: 0 }, uRuneGain: { value: 1 },
      uBasisA: { value: new THREE.Matrix3() }, uBasisB: { value: new THREE.Matrix3() },
    }),
    vertexShader: /* glsl */ `
attribute vec4 aRune;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uTime;
uniform float uSpinA;
uniform float uSpinB;
uniform float uRead;
uniform float uRuneGain;
uniform mat3 uBasisA;
uniform mat3 uBasisB;
varying vec2 vUv;
varying float vA;
varying float vG;
void main() {
  float band = aRune.y;
  float ang = aRune.x + (band < 0.5 ? uSpinA : -uSpinB);
  float rr = band < 0.5 ? 1.27 : 1.43;
  vec3 lp = vec3(cos(ang), 0.07 * sin(ang * 3.0 + uTime * 0.5 + aRune.w * 6.0), sin(ang)) * rr;
  mat3 B = band < 0.5 ? uBasisA : uBasisB;
  vec3 wp = uCenter + B * lp * uRadius;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float size = uRadius * (0.085 + 0.045 * aRune.w);
  vec3 cp = wp + (right * position.x + up * position.y) * size;
  gl_Position = projectionMatrix * viewMatrix * vec4(cp, 1.0);

  // analytic occlusion by the (depth-less) fractal sphere
  vec3 toM = wp - cameraPosition;
  float dist = length(toM);
  vec3 rdir = toM / dist;
  vec3 oc = uCenter - cameraPosition;
  float tc = dot(oc, rdir);
  float dd = dot(oc, oc) - tc * tc;
  float occ = (tc < dist) ? smoothstep(0.8 * uRadius * uRadius, 1.0 * uRadius * uRadius, dd) : 1.0;

  float tw = 0.5 + 0.5 * sin(uTime * (0.4 + aRune.w) + aRune.z * 3.1);
  float rd = 0.5 + 0.5 * cos(ang - uRead + band * 2.0);   // a highlight "reading" its way round the halo
  rd *= rd; rd *= rd; rd *= rd;
  vA = occ * uRuneGain * (0.2 + 0.32 * tw * tw + 0.95 * rd);
  vG = aRune.z;
  vUv = uv;
}
`,
    fragmentShader: /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uTint;
uniform vec3 uTint2;
varying vec2 vUv;
varying float vA;
varying float vG;
void main() {
  float cell = floor(vG + 0.5);
  float cx = mod(cell, ${GLYPH_COLS}.0);
  float cy = ${GLYPH_ROWS - 1}.0 - floor(cell / ${GLYPH_COLS}.0);
  float g = texture2D(uAtlas, (vec2(cx, cy) + vUv) / vec2(${GLYPH_COLS}.0, ${GLYPH_ROWS}.0)).r;
  vec2 d = abs(vUv - 0.5) * 2.0;
  float edge = 1.0 - smoothstep(0.82, 1.0, max(d.x, d.y));
  vec3 col = mix(uTint2, vec3(1.0, 0.93, 0.8), 0.35 + 0.4 * clamp(vA, 0.0, 1.0));
  gl_FragColor = vec4(col * g * edge * vA * 1.6, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const runes = new THREE.Mesh(runeGeo, runeMat);
  runes.frustumCulled = false;
  runes.renderOrder = 17;
  runes.name = 'oracle-runes';
  root.add(runes);

  // ================================================================== 11. ARCS (lightning / prominences / comets: ONE draw call)
  // 16 ribbon slots, each a 16-segment strip shaped entirely in the vertex shader from per-slot uniforms:
  //   kind 0 crawl: a bolt that travels over the surface   kind 1 jump: surface -> a shard   kind 2 prominence: a
  //   solar-flare loop that rises and falls back            kind 3 comet: a bright shard fired straight outward.
  const arcA = [], arcB = [], arcI = [], arcK = [];
  for (let i = 0; i < N_ARC; i++) {
    arcA.push(new THREE.Vector3()); arcB.push(new THREE.Vector3());
    arcI.push(new THREE.Vector4(1, 0, 0, 0));   // x age 0..1, y seed, z kind, w strength (0 = off)
    arcK.push(new THREE.Vector4(1, 1, 1, 1));   // rgb colour, w thickness
  }
  const arcGeo = new THREE.BufferGeometry();
  {
    const nv = N_ARC * (ARC_SEG + 1) * 2;
    const av = new Float32Array(nv * 3);
    const idx = new Uint16Array(N_ARC * ARC_SEG * 6);
    let vi = 0, ii = 0;
    for (let a = 0; a < N_ARC; a++) {
      const base = vi;
      for (let s = 0; s <= ARC_SEG; s++) {
        for (let side = -1; side <= 1; side += 2) { av[vi * 3] = a; av[vi * 3 + 1] = s / ARC_SEG; av[vi * 3 + 2] = side; vi++; }
      }
      for (let s = 0; s < ARC_SEG; s++) {
        const i0 = base + s * 2;
        idx[ii++] = i0; idx[ii++] = i0 + 1; idx[ii++] = i0 + 2;
        idx[ii++] = i0 + 1; idx[ii++] = i0 + 3; idx[ii++] = i0 + 2;
      }
    }
    arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    arcGeo.setAttribute('aV', new THREE.BufferAttribute(av, 3));
    arcGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const arcMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uA: { value: arcA }, uB: { value: arcB }, uI: { value: arcI }, uK: { value: arcK } }),
    vertexShader: /* glsl */ `
attribute vec3 aV;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uTime;
uniform vec3 uA[${N_ARC}];
uniform vec3 uB[${N_ARC}];
uniform vec4 uI[${N_ARC}];
uniform vec4 uK[${N_ARC}];
varying vec4 vP;
varying vec3 vCol;

float hs(float n) { return fract(sin(n) * 43758.5453); }
vec3 noise3(float x, float s) {
  float i = floor(x);
  float f = x - i;
  f = f * f * (3.0 - 2.0 * f);
  vec3 a = vec3(hs(i * 12.9898 + s), hs(i * 78.233 + s * 1.7), hs(i * 37.719 + s * 2.3));
  vec3 b = vec3(hs(i * 12.9898 + 12.9898 + s), hs(i * 78.233 + 78.233 + s * 1.7), hs(i * 37.719 + 37.719 + s * 2.3));
  return mix(a, b, f) - 0.5;
}
vec3 pathAt(vec3 A, vec3 B, vec4 I, float u, float tq) {
  float kind = I.z;
  float R = uRadius;
  vec3 j = noise3(u * 7.0, I.y * 31.0 + tq);
  vec3 q = mix(A, B, u);
  float env = sin(3.14159265 * u);
  if (kind < 0.5) {                                   // crawl over the surface
    vec3 d = normalize(q - uCenter);
    d = normalize(d + j * 0.3 * env);
    return uCenter + d * R * (0.95 + 0.05 * j.z * env);
  }
  if (kind < 1.5) return q + j * R * 0.22 * env;      // jump to a shard
  if (kind < 2.5) {                                   // prominence: loop out and fall back
    vec3 d = normalize(q - uCenter);
    float hs2 = sin(3.14159265 * clamp(I.x / 0.92, 0.0, 1.0));
    float h = (0.08 + 0.6 * I.w) * R * hs2 * pow(max(env, 0.0001), 0.7);
    vec3 nr = normalize(cross(B - A, d) + vec3(0.0001));
    return uCenter + d * (R * 0.93 + h) + nr * R * 0.07 * env * sin(I.x * 4.0 + u * 3.0) + j * R * 0.012;
  }
  return q + j * R * 0.015;                           // comet
}
void main() {
  int id = int(aV.x + 0.5);
  vec3 A = uA[id];
  vec3 B = uB[id];
  vec4 I = uI[id];
  vec4 K = uK[id];
  float kind = I.z;
  float age = I.x;
  float u = aV.y;
  bool travel = kind < 0.5 || kind > 2.5;
  float w = kind < 0.5 ? 0.55 : 0.35;
  float head = age * (kind < 0.5 ? 1.55 : 1.35);
  float up = travel ? clamp(head - w + u * w, 0.0, 1.0) : u;
  float tq = mod(floor(uTime * 16.0), 997.0) * 3.17;
  vec3 p = pathAt(A, B, I, up, tq);
  vec3 pa = pathAt(A, B, I, max(up - 0.015, 0.0), tq);
  vec3 pb = pathAt(A, B, I, min(up + 0.015, 1.0), tq);
  vec3 T = pb - pa;
  T = T / max(length(T), 0.0001);
  vec3 toCam = cameraPosition - p;
  float dist = length(toCam);
  vec3 side = cross(T, toCam / max(dist, 0.0001));
  side = side / max(length(side), 0.0001);
  float wid = max(uRadius * 0.0030, dist * 0.0028) * K.w;
  float wm = kind < 0.5 ? 1.0 : (kind < 1.5 ? 1.2 : (kind < 2.5 ? 2.8 : 1.7));
  float taper = kind > 2.5 ? mix(0.15, 1.0, u) : (kind < 0.5 ? mix(0.35, 1.0, u) : 1.0);
  vec3 wp = p + side * aV.z * wid * wm * taper;

  float envA;
  if (kind < 0.5) envA = 1.0 - smoothstep(0.75, 1.0, age);
  else if (kind < 1.5) envA = 1.0 - age;
  else if (kind < 2.5) envA = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.82, 1.0, age));
  else envA = 1.0 - smoothstep(0.8, 1.0, age);
  float flick = (kind < 1.5) ? 0.6 + 0.4 * step(0.5, fract(uTime * 26.0 + I.y * 13.0)) : 1.0;

  // analytic occlusion by the (depth-less) fractal sphere
  vec3 toM = p - cameraPosition;
  float dm = length(toM);
  vec3 rdir = toM / dm;
  vec3 oc = uCenter - cameraPosition;
  float tc = dot(oc, rdir);
  float dd = dot(oc, oc) - tc * tc;
  float occ = (tc < dm) ? smoothstep(0.62 * uRadius * uRadius, 0.82 * uRadius * uRadius, dd) : 1.0;

  float a = envA * flick * occ * (kind > 1.5 && kind < 2.5 ? 1.0 : I.w);
  vP = vec4(aV.z, u, a, kind);
  vCol = K.xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  if (a < 0.002) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}
`,
    fragmentShader: /* glsl */ `
varying vec4 vP;
varying vec3 vCol;
void main() {
  float x = vP.x;
  float k = vP.w;
  bool prom = k > 1.5 && k < 2.5;
  float core = exp(-x * x * (prom ? 2.6 : 6.0));
  float hot = exp(-x * x * 38.0);
  float taper = k > 2.5 ? pow(clamp(vP.y, 0.0, 1.0), 1.4) : (k < 0.5 ? 0.25 + 0.75 * smoothstep(0.0, 0.8, vP.y) : 1.0);
  vec3 col = vCol * core * (prom ? 0.9 : 1.1) + vec3(1.0, 0.97, 0.9) * hot * (prom ? 0.35 : 1.0);
  gl_FragColor = vec4(col * vP.z * taper, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  const arcMesh = new THREE.Mesh(arcGeo, arcMat);
  arcMesh.frustumCulled = false;
  arcMesh.renderOrder = 18;
  arcMesh.name = 'oracle-arcs';
  root.add(arcMesh);

  // ================================================================== 12. GOD RAYS (additive shafts, one draw call)
  const rayGeo = new THREE.BufferGeometry();
  {
    const rnd = mulberry32(31337);
    const pos = new Float32Array(N_RAYS * 4 * 3), rs = new Float32Array(N_RAYS * 4 * 4), idx = new Uint16Array(N_RAYS * 6);
    const corner = [[-1, 0], [1, 0], [-1, 1], [1, 1]];
    for (let r = 0; r < N_RAYS; r++) {
      const sa = rnd(), sb = rnd(), sc = rnd(), sd = rnd();
      for (let k = 0; k < 4; k++) {
        const v = r * 4 + k;
        pos[v * 3] = corner[k][0]; pos[v * 3 + 1] = corner[k][1];
        rs[v * 4] = sa; rs[v * 4 + 1] = sb; rs[v * 4 + 2] = sc; rs[v * 4 + 3] = sd;
      }
      const a = r * 4;
      idx[r * 6] = a; idx[r * 6 + 1] = a + 1; idx[r * 6 + 2] = a + 2; idx[r * 6 + 3] = a + 1; idx[r * 6 + 4] = a + 3; idx[r * 6 + 5] = a + 2;
    }
    rayGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rayGeo.setAttribute('aRay', new THREE.BufferAttribute(rs, 4));
    rayGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const rayMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uRays: { value: 0.3 }, uField: { value: new THREE.Vector3(0, 0, -60) }, uFieldK: { value: 70 }, uWidthK: { value: 1 } }),
    vertexShader: /* glsl */ `
attribute vec4 aRay;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uTime;
uniform vec3 uField;
uniform float uFieldK;
uniform float uWidthK;
varying vec2 vUv;
varying vec3 vInfo;
void main() {
  vec3 E = uField + vec3(aRay.y * 2.0 - 1.0, 0.0, aRay.w * 2.0 - 1.0) * uFieldK;
  vec3 fd = normalize(uField - uCenter);
  vec3 S = uCenter + normalize(fd + (vec3(aRay.x, aRay.z, aRay.y) * 2.0 - 1.0) * 0.55) * uRadius * 0.6;
  vec3 axis = E - S;
  float len = max(length(axis), 0.001);
  vec3 T = axis / len;
  float v = position.y;
  vec3 mid = mix(S, E, v);
  vec3 side = cross(T, cameraPosition - mid);
  side = side / max(length(side), 0.0001);
  float width = mix(uRadius * 0.06, uFieldK * 0.13, v) * (0.55 + 0.9 * aRay.z) * uWidthK;
  vec3 wp = mid + side * position.x * width;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vUv = vec2(position.x, v);
  vInfo = vec3(len, aRay.x, aRay.z);
}
`,
    fragmentShader: /* glsl */ `
uniform float uRays;
uniform float uRadius;
uniform float uTime;
uniform vec3 uTint;
uniform vec3 uTint2;
varying vec2 vUv;
varying vec3 vInfo;
void main() {
  float x = vUv.x;
  float v = vUv.y;
  float s = v * vInfo.x;
  // (evaluated per pixel: a ray is a single long quad)
  float fade = smoothstep(0.85 * uRadius, 1.5 * uRadius, s) * (1.0 - smoothstep(0.55, 1.0, v));
  float shim = 0.65 + 0.35 * sin(v * 9.0 - uTime * 0.45 + vInfo.y * 40.0) * sin(uTime * 0.31 + vInfo.z * 30.0);
  float prof = exp(-x * x * 3.2) * (1.0 - smoothstep(0.7, 1.0, abs(x)));
  vec3 col = mix(uTint, uTint2, 0.35 + 0.3 * v);
  col = mix(col, vec3(1.0, 0.92, 0.8), 0.25);
  gl_FragColor = vec4(col * prof * fade * shim * uRays, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  const rays = new THREE.Mesh(rayGeo, rayMat);
  rays.frustumCulled = false;
  rays.renderOrder = 9;
  rays.name = 'oracle-rays';
  root.add(rays);

  // ================================================================== 13. EYE (a hex-iris aperture on the surface)
  const eyeMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uOpen: { value: 0.5 }, uLid: { value: 1 }, uBright: { value: 1 }, uAck: { value: 0 }, uFocus: { value: 0 } }),
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform float uTime;
uniform float uOpen;
uniform float uLid;
uniform float uBright;
uniform float uAck;
uniform float uFocus;
uniform vec3 uTint;
uniform vec3 uTint2;
varying vec2 vUv;
void main() {
  float rr = length(vUv);
  if (rr >= 1.0) discard;
  vec2 p = vec2(vUv.x, vUv.y / max(uLid, 0.05));          // eyelid: squints to a slit as it sleeps
  float r = length(p);
  float a = atan(p.y, p.x) + uTime * 0.12;
  float hexd = r / (0.866025 / cos(mod(a, 1.047198) - 0.523599));   // hexagonal iris diaphragm
  float ap = (0.1 + 0.2 * uOpen) * (1.0 - 0.38 * uFocus);   // listening: the iris narrows to a pinpoint on the player
  float q1 = (hexd - ap) / 0.03;
  float q2 = (hexd - 0.62) / 0.025;
  float q3 = (hexd - 0.8) / 0.02;
  float q4 = sin(a * 3.0) * r * 7.0;
  float ring = exp(-q1 * q1);
  float outer = exp(-q2 * q2) * 0.55 + exp(-q3 * q3) * 0.3;
  float blades = exp(-q4 * q4) * smoothstep(ap, ap + 0.08, hexd) * (1.0 - smoothstep(0.58, 0.66, hexd));
  float core = 1.0 - smoothstep(ap * 0.35, ap, hexd);
  float glow = exp(-rr * rr * 3.4);
  float streak = exp(-abs(vUv.y) * 30.0) * exp(-abs(vUv.x) * 2.6) + 0.45 * exp(-abs(vUv.x) * 34.0) * exp(-abs(vUv.y) * 3.2);
  vec3 col = uTint2 * glow * 0.55
           + mix(uTint, vec3(1.0), 0.45) * (ring * 1.25 + outer + blades * 0.5)
           + vec3(1.0, 0.97, 0.9) * core * 1.7
           + vec3(1.0, 0.85, 0.6) * streak * (0.25 + 0.9 * uAck + 0.5 * uOpen);
  col *= uBright * (1.0 - smoothstep(0.7, 1.0, rr));
  gl_FragColor = vec4(col, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const eye = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), eyeMat);
  eye.frustumCulled = false;
  eye.renderOrder = 19;
  eye.name = 'oracle-eye';
  root.add(eye);

  // ================================================================== 14. SOUND RINGS (speaking)
  const srP = new Array(N_SR).fill(-1);   // progress 0..1, -1 = free
  const srA = new Array(N_SR).fill(0);    // amplitude
  const soundMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uQuadR: { value: SR_R } }),
    vertexShader: RING_VERT,
    fragmentShader: /* glsl */ `
uniform float uQuadR;
uniform vec3 uTint;
uniform vec3 uTint2;
varying float vRho;
varying vec2 vB;
void main() {
  float rho = vRho, p = vB.x;
  float e = 1.0 - (1.0 - p) * (1.0 - p);
  float c = mix(0.95, uQuadR * 0.9, e);
  float x = (rho - c) / (0.025 + 0.05 * p);
  float x2 = (rho - c + 0.11) / 0.018;
  float s = vB.y * (exp(-x * x) + 0.35 * exp(-x2 * x2)) * (1.0 - p);
  vec3 col = mix(mix(uTint, vec3(1.0), 0.4), uTint2, 0.25) * s * 1.5;
  col *= 1.0 - smoothstep(0.72 * uQuadR, uQuadR, rho);
  gl_FragColor = vec4(col, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  });
  const soundGeo = ringStripGeometry(N_SR);
  const soundRings = new THREE.Mesh(soundGeo, soundMat);
  soundRings.frustumCulled = false;
  soundRings.renderOrder = 13;
  soundRings.visible = false;
  soundRings.name = 'oracle-soundrings';
  root.add(soundRings);

  // ================================================================== 15. STRIKES (columns of light / beams with a ground disc)
  const strikeGeo = new THREE.BufferGeometry();
  {
    const RS = 14, DISC = 5;
    const nv = (RS + 1) * 2 + 1 + (RS + 1);
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), kind = new Float32Array(nv);
    const idx = [];
    for (let i = 0; i <= RS; i++) {
      const an = (i / RS) * Math.PI * 2, c = Math.cos(an), s = Math.sin(an);
      pos.set([c, 0, s], i * 6); pos.set([c, 1, s], i * 6 + 3);
      nrm.set([c, 0, s], i * 6); nrm.set([c, 0, s], i * 6 + 3);
      if (i < RS) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const cV = (RS + 1) * 2;
    kind[cV] = 1; // disc centre
    for (let i = 0; i <= RS; i++) {
      const an = (i / RS) * Math.PI * 2, v = cV + 1 + i;
      pos.set([Math.cos(an) * DISC, 0, Math.sin(an) * DISC], v * 3); kind[v] = 1;
      if (i < RS) idx.push(cV, cV + 1 + i, cV + 2 + i);
    }
    strikeGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    strikeGeo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    strikeGeo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    strikeGeo.setIndex(idx);
    strikeGeo.setAttribute('aStr', new THREE.InstancedBufferAttribute(new Float32Array(N_STRIKE * 4), 4));
    strikeGeo.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(N_STRIKE * 3), 3));
  }
  const strikeMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U),
    vertexShader: /* glsl */ `
attribute float aKind;
attribute vec4 aStr;
attribute vec3 aCol;
varying float vK;
varying float vY;
varying float vEnv;
varying float vPh;
varying vec3 vNW;
varying vec3 vW;
varying vec3 vCol;
varying vec2 vD;
varying float vWd;
void main() {
  vec3 wp;
  vNW = vec3(0.0, 1.0, 0.0);
  vD = vec2(0.0);
  vY = position.y;
  #ifdef USE_INSTANCING
    mat4 im = instanceMatrix;
  #else
    mat4 im = mat4(1.0);
  #endif
  vWd = length(im[0].xyz);
  if (aKind < 0.5) {
    vec3 lp = position;
    lp.xz *= mix(0.3, 1.0, position.y);
    wp = (modelMatrix * im * vec4(lp, 1.0)).xyz;
    vNW = normalize(mat3(modelMatrix) * mat3(im) * normal);
  } else {
    vec3 endW = (modelMatrix * im * vec4(0.0, 1.0, 0.0, 1.0)).xyz;
    float sc = length(im[0].xyz);
    wp = endW + vec3(position.x, 0.0, position.z) * sc + vec3(0.0, 0.04 * sc, 0.0);
    vD = position.xz / 5.0;
  }
  vK = aKind;
  vEnv = aStr.x;
  vPh = aStr.y;
  vCol = aCol;
  vW = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  if (aStr.x < 0.002) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying float vK;
varying float vY;
varying float vEnv;
varying float vPh;
varying vec3 vNW;
varying vec3 vW;
varying vec3 vCol;
varying vec2 vD;
varying float vWd;
void main() {
  vec3 col;
  // standing inside a column (resurrection): fade what is closer than a few beam-widths so it never whites out the view
  float near = smoothstep(1.0 * vWd, 3.2 * vWd, length(cameraPosition - vW));
  if (vK < 0.5) {
    vec3 V = normalize(cameraPosition - vW);
    float f = abs(dot(normalize(vNW), V));
    float core = f * f * f;
    float shell = 0.2 + 0.8 * f * f;
    float along = smoothstep(0.0, 0.1, vY) * (0.6 + 0.4 * vY) * (0.82 + 0.18 * sin(vY * 38.0 - uTime * 11.0 + vPh * 6.0));
    col = mix(vCol, vec3(1.0, 0.98, 0.94), core * 0.5) * shell * along * vEnv * 0.8;
  } else {
    float r = length(vD);
    if (r >= 1.0) discard;
    float qd = (r - 0.7 + 0.1 * sin(uTime * 7.0)) / 0.07;
    float ring = exp(-qd * qd);
    float glow = exp(-r * r * 3.0);
    col = (vCol * (ring * 1.2 + glow * 0.8) + vec3(1.0, 0.95, 0.85) * glow * glow * 0.8) * vEnv * (1.0 - smoothstep(0.8, 1.0, r));
  }
  gl_FragColor = vec4(col * near, 1.0);
}
`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  const strikes = new THREE.InstancedMesh(strikeGeo, strikeMat, N_STRIKE);
  strikes.frustumCulled = false;
  strikes.renderOrder = 20;
  strikes.visible = false;
  strikes.name = 'oracle-strikes';
  {
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N_STRIKE; i++) strikes.setMatrixAt(i, z);
  }
  root.add(strikes);

  // ================================================================== 8b. IMPACT RING on the ground (creation / quest / arrival): one flat quad, only visible while it plays
  const impactMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, U, { uP: { value: 0 }, uAmt: { value: 0 }, uCol: { value: new THREE.Vector3(1, 0.9, 0.6) }, uPrism: { value: 0 } }),
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: /* glsl */ `
uniform float uP;
uniform float uAmt;
uniform float uTime;
uniform float uPrism;
uniform vec3 uCol;
varying vec2 vUv;
${GLSL_PAL}
void main() {
  float rho = length(vUv);
  if (rho >= 1.0) discard;
  float q = 1.0 - uP;
  float c = 1.0 - q * q * q;
  float x = (rho - c) / (0.03 + 0.07 * uP);
  float ring = exp(-x * x);
  float x2 = (rho - c * 0.72) / 0.03;
  float a = atan(vUv.y, vUv.x);
  float spokes = 0.5 + 0.5 * sin(a * 18.0 + uTime * 2.0);
  float ring2 = exp(-x2 * x2) * (0.4 + 0.6 * spokes);
  float core = exp(-rho * rho * 10.0) * q * q;
  vec3 col = mix(uCol, hsv2rgb(vec3(fract(rho * 0.6 + uTime * 0.2), 0.8, 1.0)), uPrism);
  float v = (ring * 1.6 + ring2 * 0.9) * q * q + core * 1.4;
  gl_FragColor = vec4((col * v + vec3(1.0, 0.95, 0.85) * (ring * 0.5 * q + core * 0.6)) * (1.0 - smoothstep(0.8, 1.0, rho)) * uAmt, 1.0);
}
`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false, toneMapped: false,
  });
  const impactGeo = new THREE.PlaneGeometry(2, 2);
  impactGeo.rotateX(-Math.PI / 2);
  const impact = new THREE.Mesh(impactGeo, impactMat);
  impact.frustumCulled = false; impact.renderOrder = 16; impact.visible = false; impact.name = 'oracle-impact';
  root.add(impact);

  // ================================================================== 9. LIGHT (tinted by the fractal's hue)
  const light = new THREE.DirectionalLight(0xffffff, 0.5);
  light.position.copy(POS);
  light.castShadow = false;
  light.name = 'oracle-light';
  root.add(light);

  // ================================================================== STATE MACHINE
  // arcs = lightning rate, rays = god-ray gain, runes = scripture halo gain / spin
  const KEYS = ['speed', 'ring', 'fold', 'cool', 'flick', 'align', 'code', 'energy', 'corona', 'gaze', 'beam', 'arcs', 'rays', 'runes'];
  const STATES = {
    idle:         { speed: 1.0, ring: 1.0, fold: 0.0,  cool: 0.0,  flick: 0.0,  align: 0.0, code: 0, energy: 1.0,  corona: 1.0,  gaze: 0.0, beam: 0.0, arcs: 1.0, rays: 0.35, runes: 1.0 },
    listening:    { speed: 0.55, ring: 0.4, fold: 0.12, cool: 0.85, flick: 0.0,  align: 1.0, code: 0, energy: 1.2,  corona: 0.9,  gaze: 1.0, beam: 1.0, arcs: 0.5, rays: 1.0, runes: 0.7 },
    transcribing: { speed: 2.6, ring: 3.5, fold: 0.55, cool: 0.25, flick: 0.7,  align: 0.2, code: 0, energy: 1.25, corona: 1.1,  gaze: 0.2, beam: 0.3, arcs: 2.5, rays: 0.6, runes: 1.5 },
    thinking:     { speed: 3.4, ring: 6.0, fold: 1.0,  cool: 0.15, flick: 1.0,  align: 0.0, code: 0, energy: 1.35, corona: 1.2,  gaze: 0.0, beam: 0.0, arcs: 3.5, rays: 0.5, runes: 2.0 },
    coding:       { speed: 1.8, ring: 2.4, fold: 0.3,  cool: 0.0,  flick: 0.3,  align: 0.0, code: 1, energy: 1.5,  corona: 1.35, gaze: 0.0, beam: 0.0, arcs: 2.5, rays: 0.7, runes: 1.7 },
    speaking:     { speed: 1.2, ring: 1.3, fold: 0.0,  cool: 0.0,  flick: 0.0,  align: 0.0, code: 0, energy: 1.1,  corona: 1.1,  gaze: 0.0, beam: 0.0, arcs: 1.6, rays: 0.8, runes: 1.5 },
  };

  // moods: palette centre/spread (idx -> mix(c, idx, s)), molten colour, tempo, energy, heartbeat bpm, iridescence, rays, lightning
  const MOODS = {
    default:  { c: 0.5,  s: 1.0,  molten: [1.0, 0.55, 0.12], tempo: 1.0,  energy: 1.0,  bpm: 62, irid: 1.0, rays: 1.0, arcs: 1.0 },
    serene:   { c: 0.8,  s: 0.45, molten: [0.5, 0.82, 1.0],  tempo: 0.7,  energy: 0.92, bpm: 48, irid: 1.3, rays: 1.2, arcs: 0.5 },
    wrathful: { c: 0.2,  s: 0.35, molten: [1.0, 0.16, 0.04], tempo: 1.6,  energy: 1.35, bpm: 98, irid: 0.5, rays: 1.1, arcs: 2.4 },
    joyful:   { c: 0.5,  s: 1.0,  molten: [1.0, 0.78, 0.25], tempo: 1.3,  energy: 1.2,  bpm: 80, irid: 1.8, rays: 1.5, arcs: 1.5 },
    ominous:  { c: 0.62, s: 0.3,  molten: [0.62, 0.15, 1.0], tempo: 0.85, energy: 0.82, bpm: 42, irid: 0.7, rays: 0.6, arcs: 1.2 },
  };
  const MOOD_KEYS = ['c', 's', 'tempo', 'energy', 'bpm', 'irid', 'rays', 'arcs'];
  let moodName = MOODS[keep.mood] ? keep.mood : 'default';
  const mood = {};                                     // live (cross-fading) mood parameters
  for (const k of MOOD_KEYS) mood[k] = MOODS[moodName][k];
  const moodMolten = new THREE.Vector3().fromArray(MOODS[moodName].molten);
  let stateName = STATES[keep.stateName] ? keep.stateName : 'idle';
  const cur = {};
  for (const k of KEYS) cur[k] = STATES[stateName][k];

  function setState(s) {
    if (typeof s !== 'string' || !STATES[s]) return;
    stateName = s;
    keep.stateName = s;
  }

  // pulses
  const waves = [{ p: 1, s: 0 }, { p: 1, s: 0 }, { p: 1, s: 0 }]; // p>=1 => inactive
  let flash = 0;
  function pulse(strength) {
    const s = clamp(typeof strength === 'number' && isFinite(strength) ? strength : 1, 0.05, 2);
    let slot = 0, best = -1;
    for (let i = 0; i < 3; i++) {
      if (waves[i].p >= 1) { slot = i; best = 99; break; }
      if (waves[i].p > best) { best = waves[i].p; slot = i; }
    }
    waves[slot].p = 0;
    waves[slot].s = s;
    flash = Math.max(flash, 0.65 * s);
  }

  let levelTarget = 0, lastLevelT = -10, level = 0, animT = keep.animT || 0;

  // ================================================================== REACTIONS: pooled, priority-ordered set-pieces
  const _col = new THREE.Color();
  const _rgbO = { r: 0, g: 0, b: 0 };
  const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(); // (+ _s3 from the ring builder, reused as scratch)
  const viewDir = new THREE.Vector3(0, 0, 1);       // unit vector core -> player's head (set every frame)
  const accent = new THREE.Vector3(1, 1, 1);        // transient colour burst (flare / hurt / spell), decays
  let accentAmt = 0;
  function setAccent(r, g, b, amt) {
    if (amt >= accentAmt * 0.7) accent.set(r, g, b);
    if (amt > accentAmt) accentAmt = amt;
  }
  // Any colour spec -> display-space rgb in `out` (max channel normalised to 1). Returns false when unusable.
  function parseColor(c, out) {
    try {
      if (c == null) return false;
      if (Array.isArray(c)) {
        if (c.length < 3) return false;
        out.set(+c[0] || 0, +c[1] || 0, +c[2] || 0);
      } else if (c.isColor || typeof c === 'number' || typeof c === 'string') {
        if (c.isColor) _col.copy(c); else _col.set(c);
        _col.getRGB(_rgbO, THREE.SRGBColorSpace);
        out.set(_rgbO.r, _rgbO.g, _rgbO.b);
      } else return false;
    } catch (err) { return false; }
    const m = Math.max(out.x, out.y, out.z);
    if (!(m > 0.001)) return false;
    out.multiplyScalar(1 / m);
    return true;
  }
  function spellColorInto(id, out) {
    try {
      const list = ctx.world.spells && ctx.world.spells.list && ctx.world.spells.list();
      if (list) for (let i = 0; i < list.length; i++) if (list[i].id === id) return parseColor(list[i].color, out);
    } catch (err) { /* spells reloading */ }
    return false;
  }

  // one "show" at a time (the sky-wide look); a lower-priority event cannot interrupt a higher one that is still running.
  // 9 dead/resurrect  8 creation  7 wake  5 hurt  4 kill  3 spell  1 grab
  const show = { on: false, prio: 0, t: 0, dur: 1, type: '' };
  const showCol = new THREE.Vector3(1, 0.9, 0.6);
  function startShow(type, prio, dur) {
    if (show.on && show.t < show.dur && show.prio > prio) return false;
    show.on = true; show.type = type; show.prio = prio; show.t = 0; show.dur = dur;
    return true;
  }
  const cool = { spell: 0, kill: 0, grab: 0, hurt: 0, create: 0 };
  let dimV = 0;                 // 0..1: dead / grieving
  let sleepV = 0;               // 0..1: dozing
  let idleT = 0;                // seconds since anything happened
  let eyeFlare = 0, eyeSyl = 0, ack = 0, gazeT = 0, ackLatched = false, runeBurst = 0;
  let snapV = 0;                // rings snapped into alignment (creation / resurrection)
  const snapDir = new THREE.Vector3(0, -1, 0);
  const reqAim = new THREE.Vector3(); let reqAimOk = false;
  const lookPt = new THREE.Vector3(); let lookOn = false;

  // ---- sound rings
  function spawnSoundRing(amp) {
    let k = -1, best = -1;
    for (let i = 0; i < srMax; i++) { if (srP[i] < 0) { k = i; break; } if (srP[i] > best) { best = srP[i]; k = i; } } // (srMax: fewer simultaneous rings on the lean tiers)
    srP[k] = 0; srA[k] = amp;
  }

  // ---- arcs (lightning / prominences / comets)
  const arcS = [];
  for (let i = 0; i < N_ARC; i++) arcS.push({ on: false, age: 0, dur: 1, kind: 0, ra: 0.95, rb: 0.95, str: 1, ring: -1, shard: 0, toTgt: false, tgt: new THREE.Vector3(), dA: new THREE.Vector3(0, 1, 0), dB: new THREE.Vector3(0, 1, 0) });
  let anyArc = false;
  function freeArc(lo, hi) { for (let i = lo; i < hi; i++) if (!arcS[i].on) return i; return -1; }
  function randDirInto(out, bias, minDot) {
    for (let n = 0; n < 8; n++) {
      const u = Math.random() * 2 - 1, ph = Math.random() * 6.2832, s = Math.sqrt(1 - u * u);
      out.set(s * Math.cos(ph), u, s * Math.sin(ph));
      if (!bias || out.dot(bias) > minDot) return out;
    }
    return out;
  }
  // world position of shard k of ring ri right now (uses this frame's ring transform)
  function shardWorld(ri, k, out) {
    const R = rings[ri], l = R.local;
    const x = l[k * 3], y = l[k * 3 + 1], z = l[k * 3 + 2], c = Math.cos(R.angle), s = Math.sin(R.angle);
    return out.set(x * c + z * s, y, -x * s + z * c).applyQuaternion(R.group.quaternion).multiplyScalar(R.group.scale.x).add(R.group.position);
  }
  const lightningCol = new THREE.Vector3(0.7, 0.8, 1);
  function setArcSlot(i, kind, dur, str, thick, col) {
    const s = arcS[i];
    s.on = true; s.age = 0; s.dur = dur; s.kind = kind; s.str = str; s.toTgt = false;
    arcI[i].set(0, Math.random() * 100, kind, str);
    if (col) arcK[i].set(col.x, col.y, col.z, thick); else arcK[i].set(lightningCol.x, lightningCol.y, lightningCol.z, thick);
    return s;
  }
  function spawnLightning(col, forceJump) {
    const i = freeArc(ARC_L0, ARC_L1);
    if (i < 0) return -1;
    const s = arcS[i];
    if (forceJump || Math.random() < 0.32) { // jump from the surface to a shard of one of the rings
      let ri = 0, k = 0;
      for (let tries = 0; tries < 5; tries++) {
        ri = (Math.random() * rings.length) | 0; k = (Math.random() * rings[ri].def.n) | 0;
        shardWorld(ri, k, _s1); _s1.sub(POS).normalize();
        if (_s1.dot(viewDir) > -0.15) break;
      }
      s.ring = ri; s.shard = k; s.ra = 0.95; s.rb = 0.95;
      s.dA.copy(_s1).add(_s2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.5)).normalize();
      setArcSlot(i, 1, 0.28 + Math.random() * 0.22, 1.1, 1.3, col);
    } else { // crawl across the surface
      s.ring = -1; s.ra = 0.95; s.rb = 0.95;
      randDirInto(s.dA, viewDir, -0.1);
      _s2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(s.dA);
      if (_s2.lengthSq() < 1e-6) _s2.set(0, 1, 0).cross(s.dA);
      _s2.normalize();
      s.dB.copy(s.dA).applyAxisAngle(_s2, 0.5 + Math.random() * 0.8);
      setArcSlot(i, 0, 0.5 + Math.random() * 0.4, 1, 1, col);
    }
    return i;
  }
  // a lightning lance from the surface straight to a world point (the creation site); several at once make a forked spear
  function spawnLance(target, col) {
    const i = freeArc(ARC_L0, ARC_L1);
    if (i < 0) return -1;
    const s = arcS[i];
    s.ring = -1; s.ra = 0.95; s.rb = 0.95;
    s.dA.copy(target).sub(POS);
    if (s.dA.lengthSq() < 1e-6) s.dA.set(0, -1, 0);
    s.dA.normalize();
    setArcSlot(i, 1, 0.8 + Math.random() * 0.5, 1.5, 2.2, col);
    s.toTgt = true; s.tgt.copy(target);
    return i;
  }
  function spawnProminence() {
    const i = freeArc(ARC_P0, ARC_P1);
    if (i < 0) return -1;
    const s = arcS[i];
    s.ring = -1; s.ra = 1; s.rb = 1;
    randDirInto(s.dA, viewDir, 0.0);
    _s2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(s.dA);
    if (_s2.lengthSq() < 1e-6) _s2.set(0, 1, 0).cross(s.dA);
    _s2.normalize();
    s.dB.copy(s.dA).applyAxisAngle(_s2, 0.45 + Math.random() * 0.5);
    _s3.copy(moodMolten).lerp(_s1.set(1, 0.95, 0.85), 0.2);
    setArcSlot(i, 2, 4 + Math.random() * 3, 0.25 + Math.random() * 0.6, 1, _s3);
    return i;
  }
  // a bright shard fired outward from the core (the kill tally); dir null = random sideways-and-up
  function spawnComet(dir, col, len, dur) {
    const i = freeArc(ARC_C0, ARC_C1);
    if (i < 0) return -1;
    const s = arcS[i];
    s.ring = -1; s.ra = 0.95; s.rb = len;
    if (dir) s.dA.copy(dir).normalize();
    else {
      randDirInto(s.dA, null, 0);
      s.dA.addScaledVector(viewDir, -0.85 * s.dA.dot(viewDir));
      s.dA.y += 0.35; s.dA.normalize();
    }
    s.dB.copy(s.dA);
    setArcSlot(i, 3, dur, 1.2, 1, col);
    return i;
  }
  function updateArcs(dt) {
    anyArc = false;
    for (let i = 0; i < N_ARC; i++) {
      const s = arcS[i], I = arcI[i];
      if (!s.on) { I.w = 0; continue; }
      s.age += dt / s.dur;
      if (s.age >= 1) { s.on = false; I.w = 0; I.x = 1; continue; }
      anyArc = true;
      I.x = s.age;
      arcA[i].copy(s.dA).multiplyScalar(s.ra * curR).add(POS);
      if (s.ring >= 0) shardWorld(s.ring, s.shard, arcB[i]);
      else if (s.toTgt) arcB[i].copy(s.tgt);
      else arcB[i].copy(s.dB).multiplyScalar(s.rb * curR).add(POS);
    }
    arcMesh.visible = anyArc;
  }

  // ---- strikes: columns of light / beams with a ground disc
  const strikeS = [];
  for (let i = 0; i < N_STRIKE; i++) strikeS.push({ on: false, age: 0, delay: 0, dur: 1, vertical: true, w: 1, t: new THREE.Vector3(), col: new THREE.Vector3(1, 1, 1) });
  const _up = new THREE.Vector3(0, 1, 0);
  const _zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  const _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _ss = new THREE.Vector3(), _sp = new THREE.Vector3(), _sd = new THREE.Vector3();
  function spawnStrike(point, vertical, col, dur, delay, width) {
    let k = -1, best = -1;
    for (let i = 0; i < N_STRIKE; i++) { if (!strikeS[i].on) { k = i; break; } if (strikeS[i].age > best) { best = strikeS[i].age; k = i; } }
    const s = strikeS[k];
    s.on = true; s.age = 0; s.delay = delay; s.dur = dur; s.vertical = vertical; s.w = width;
    s.t.copy(point);
    if (col) s.col.copy(col); else s.col.set(1, 0.85, 0.5);
    return true;
  }
  let strikeE = 0;     // placement ease (0 sky, 1 room), set in update
  function updateStrikes(dt) {
    const aStr = strikeGeo.attributes.aStr.array, aCol = strikeGeo.attributes.aCol.array;
    let any = false;
    for (let i = 0; i < N_STRIKE; i++) {
      const s = strikeS[i];
      let env = 0;
      if (s.on) {
        if (s.delay > 0) s.delay -= dt;
        else {
          s.age += dt / s.dur;
          if (s.age >= 1) s.on = false;
          else {
            const x = s.age;
            const rise = Math.min(1, x / 0.08); const fall = x < 0.45 ? 1 : 1 - (x - 0.45) / 0.55;
            env = rise * rise * (3 - 2 * rise) * Math.max(0, fall) + 0.5 * Math.exp(-x * 16);
          }
        }
      }
      if (env > 0.002) {
        any = true;
        const room = strikeE;
        if (s.vertical) { _sp.set(s.t.x, s.t.y + lerp(380, 3.6, room), s.t.z); }
        else { _sd.copy(s.t).sub(POS).normalize(); _sp.copy(POS).addScaledVector(_sd, curR * 0.6); }
        _sd.copy(s.t).sub(_sp);
        const L = Math.max(_sd.length(), 0.01);
        _sq.setFromUnitVectors(_up, _sd.multiplyScalar(1 / L));
        const w = s.w * lerp(1, 0.02, room) * (0.45 + 0.55 * Math.min(1, env)) * (1 + 0.08 * Math.sin(animT * 31 + i));
        _ss.set(w, L, w);
        _sm.compose(_sp, _sq, _ss);
        strikes.setMatrixAt(i, _sm);
        aStr[i * 4] = env; aStr[i * 4 + 1] = i * 1.7;
        aCol[i * 3] = s.col.x; aCol[i * 3 + 1] = s.col.y; aCol[i * 3 + 2] = s.col.z;
      } else {
        aStr[i * 4] = 0;
        strikes.setMatrixAt(i, _zeroM);
      }
    }
    strikes.instanceMatrix.needsUpdate = true;
    strikeGeo.attributes.aStr.needsUpdate = true;
    strikeGeo.attributes.aCol.needsUpdate = true;
    strikes.visible = any;
  }

  // ---- triggers
  function aimTarget(out) {
    const P = ctx.world.player;
    if (P && P.aim && P.aim.valid) return out.copy(P.aim.point);
    let a = null;
    try { a = ctx.aimPoint(70); } catch (err) { a = null; }
    if (a) return out.copy(a);
    if (reqAimOk) return out.copy(reqAim);
    out.set(ctx.player.forward.x, 0, ctx.player.forward.z);
    if (out.lengthSq() < 1e-4) out.set(0, 0, -1);
    out.normalize().multiplyScalar(8).add(ctx.player.feet);
    out.y = ctx.groundAt(out.x, out.z);
    return out;
  }
  function poke() {
    idleT = 0;
    if (sleepV > 0.35) wakeBurst();
  }
  function wakeBurst() {
    sleepV = 0.34;
    startShow('wake', 7, 2.2);
    showCol.set(1, 0.95, 0.8);
    flash = Math.max(flash, 1.15);
    eyeFlare = 1; runeBurst = 1;
    pulse(1.3);
    spawnSoundRing(1);
    for (let i = 0; i < 6; i++) spawnLightning(null, i % 2 === 0);
    spawnProminence();
    setAccent(1, 0.9, 0.7, 0.6);
  }
  const creationT = new THREE.Vector3();
  function actOfCreation(target) {
    cool.create = 2.5;
    creationT.copy(target);
    target = creationT;
    if (!startShow('create', 8, 3.4)) return false;
    showCol.copy(moodMolten).lerp(_s1.set(1, 0.95, 0.85), 0.45);
    snapDir.copy(target).sub(POS);
    if (snapDir.lengthSq() < 1e-6) snapDir.set(0, -1, 0);
    snapDir.normalize();
    pulse(1.3);
    spawnSoundRing(1);
    flash = Math.max(flash, 0.8);
    eyeFlare = 1; runeBurst = Math.max(runeBurst, 0.8);
    setAccent(showCol.x, showCol.y, showCol.z, 0.55);
    for (let i = 0; i < 2; i++) spawnLightning(showCol, true);
    // the lance: lightning forks and a beam from his core to the site, then the column falls, the ground rings and the sky flashes
    for (let i = 0; i < 4; i++) spawnLance(target, showCol);
    spawnStrike(target, false, showCol, 1.5, 0.05, Math.max(curR * 0.014, 0.01));
    spawnStrike(target, true, showCol, 2.4, 0.55, 1.4);
    startImpact(target, showCol, 0.55);
    prismV = Math.max(prismV, 0.35);
    return true;
  }
  // ---- ground shockwave ring + ignition
  function startImpact(point, col, delay) {
    impPt.copy(point); impT = 0; impDelay = delay || 0;
    impactMat.uniforms.uCol.value.copy(col || showCol);
    impact.visible = false;
  }
  function ignite() {
    ignT = 0; ignV = 0; igKick = 1;
    startShow('wake', 9, 3.4);
    showCol.set(1, 0.93, 0.7);
    flash = Math.max(flash, 1.6); eyeFlare = 1; runeBurst = 1;
    pulse(1.7); spawnSoundRing(1); prismV = 1;
    setAccent(1, 0.95, 0.8, 0.85);
    for (let i = 0; i < 5; i++) spawnLightning(showCol, i % 2 === 0);
    spawnProminence(); spawnProminence();
  }
  function igniteTick(dt) {
    const t0 = ignT; ignT += dt;
    const x = clamp(ignT / 3.4, 0, 1);
    ignV = x * x * (3 - 2 * x);
    const cross = (a) => t0 < a && ignT >= a;
    if (cross(0.45)) { pulse(1.3); spawnSoundRing(0.9); for (let i = 0; i < 3; i++) spawnComet(null, showCol, 5.5, 1.2); }
    if (cross(1.0)) { pulse(1.2); spawnSoundRing(1); flash = Math.max(flash, 0.9); eyeFlare = 1; for (let i = 0; i < 4; i++) spawnLightning(showCol, true); }
    if (cross(1.8)) { pulse(1.0); spawnSoundRing(0.8); runeBurst = 1; spawnProminence(); for (let i = 0; i < 3; i++) spawnComet(null, showCol, 6, 1.3); }
    if (ignT >= 3.4) { ignT = -1; ignV = 1; }
  }
  function onSpell(e) {
    poke();
    if (cool.spell > 0) return;
    cool.spell = 0.2;
    if (!spellColorInto(e && e.id, _s3)) _s3.set(0.7, 0.85, 1.0);
    if (!startShow('spell', 3, 1.5)) return;
    showCol.copy(_s3);
    spawnLightning(showCol, true);
    flash = Math.max(flash, 0.22);
    setAccent(showCol.x, showCol.y, showCol.z, 0.4);
  }
  function onKill(e) {
    poke();
    if (cool.kill > 0) return;
    cool.kill = 0.08;
    const friendly = !!(e && e.victim && e.victim.faction === 'friendly');
    if (friendly) _s3.set(1, 0.25, 0.2); else _s3.set(1, 0.92, 0.6);
    spawnComet(null, _s3, 5.2, 1.1);
    if (startShow('kill', 4, 0.55)) {
      showCol.copy(_s3);
      flash = Math.max(flash, friendly ? 0.3 : 0.6);
      eyeFlare = Math.max(eyeFlare, 0.8);
    }
  }
  function onHurt(e) {
    poke();
    if (cool.hurt > 0) return;
    cool.hurt = 0.1;
    const amt = e && +e.amount > 0 ? +e.amount : 10;
    if (startShow('hurt', 5, 0.35 + Math.min(0.6, amt / 60))) { showCol.set(1, 0.12, 0.06); eyeFlare = Math.max(eyeFlare, 0.5); }
  }
  let deadT = 0;
  function onDied() {
    poke();
    startShow('dead', 9, Infinity);
    deadT = 0;
    showCol.set(0.9, 0.15, 0.1);
    flash = Math.max(flash, 0.3);
  }
  function onRespawn() {
    poke();
    show.on = false; show.prio = 0;
    startShow('resurrect', 9, 3.6);
    showCol.set(1, 0.93, 0.7);
    snapDir.set(0, -1, 0); // rings turn to face the spawn point
    _s3.copy(ctx.player.feet);
    spawnStrike(_s3, true, showCol, 3.0, 0.25, 3.0);
    pulse(1.4); spawnSoundRing(1);
    flash = Math.max(flash, 1.0);
    eyeFlare = 1; runeBurst = Math.max(runeBurst, 0.7);
    setAccent(1, 0.93, 0.7, 0.6);
    for (let i = 0; i < 3; i++) spawnLightning(showCol, true);
  }
  function onGrab() {
    poke();
    if (cool.grab > 0) return;
    cool.grab = 0.4;
    if (startShow('grab', 1, 0.6)) showCol.set(1, 0.95, 0.8);
    eyeFlare = Math.max(eyeFlare, 0.7);
    flash = Math.max(flash, 0.12);
    spawnLightning(null, true);
  }
  function onModuleLoaded(e) {
    const p = e && e.path;
    if (typeof p !== 'string' || !p.startsWith('creations/')) return;
    if (!keep.settled || cool.create > 0) { pulse(0.8); return; } // initial boot sync, or a repair burst: just the old pulse
    poke();
    if (!actOfCreation(aimTarget(_s3))) pulse(0.8);
  }
  function captureAim() {
    const P = ctx.world.player;
    if (P && P.aim && P.aim.valid) { reqAim.copy(P.aim.point); reqAimOk = true; return; }
    let a = null;
    try { a = ctx.aimPoint(70); } catch (err) { a = null; }
    if (a) { reqAim.copy(a); reqAimOk = true; }
  }

  function groundRingAtPlayer(col, delay) { _s2.copy(ctx.player.feet); startImpact(_s2, col, delay || 0); }
  ctx.on('oracle:state', (s) => {
    // the first-wish loop: he turns to you (listening), races (thinking), then addresses you directly (speaking): the eye flares open, a ring leaves him
    if (typeof s === 'string' && s !== stateName) {
      if (s === 'speaking') { eyeFlare = Math.max(eyeFlare, 0.9); spawnSoundRing(0.8); }
      else if (s === 'listening') { eyeFlare = Math.max(eyeFlare, 0.5); spawnSoundRing(0.45); }
      else if (s === 'thinking') { pulse(0.45); }
    }
    setState(s);
    if (s !== 'idle') poke();
    if (s === 'transcribing' || s === 'thinking') captureAim();
  });
  ctx.on('oracle:level', (v) => { levelTarget = clamp(+v || 0, 0, 1); lastLevelT = animT; });
  ctx.on('module:loaded', onModuleLoaded);
  ctx.on('modules:synced', () => { keep.settled = true; });
  ctx.on('spell:cast', onSpell);
  ctx.on('combat:kill', onKill);
  ctx.on('player:hurt', onHurt);
  ctx.on('player:died', onDied);
  ctx.on('player:respawn', onRespawn);
  ctx.on('weapon:grab', onGrab);
  ctx.on('net:speak', () => poke());
  ctx.on('oracle:line', () => { poke(); eyeFlare = Math.max(eyeFlare, 0.55); });
  // milestones: a quest done, a place reached: gold flare, prismatic ring, a shockwave across the ground at the player's feet
  ctx.on('quest:completed', () => {
    poke(); _s3.set(1, 0.85, 0.4); setAccent(1, 0.85, 0.4, 0.6); flash = Math.max(flash, 0.7); eyeFlare = Math.max(eyeFlare, 0.8);
    prismV = 1; pulse(1.0); spawnSoundRing(0.9); groundRingAtPlayer(_s3, 0.05);
    for (let i = 0; i < 3; i++) spawnComet(null, _s3, 5, 1.2);
  });
  const onArrive = () => {
    poke(); setAccent(1, 0.93, 0.75, 0.7); flash = Math.max(flash, 1.1); eyeFlare = 1; prismV = Math.max(prismV, 0.8); pulse(1.4); spawnSoundRing(1);
    runeBurst = Math.max(runeBurst, 0.9); for (let i = 0; i < 4; i++) spawnLightning(null, true);
  };
  ctx.on('travel:arrive', onArrive);
  ctx.on('blast:arrive', onArrive);

  // ---- public hooks
  function flare(color, strength) {
    const s = clamp(typeof strength === 'number' && isFinite(strength) ? strength : 1, 0.05, 3);
    if (!parseColor(color, _s3)) _s3.set(1, 0.9, 0.7);
    setAccent(_s3.x, _s3.y, _s3.z, Math.min(1, 0.45 * s));
    flash = Math.max(flash, 0.35 * s);
    eyeFlare = Math.max(eyeFlare, Math.min(1, 0.6 * s));
    spawnSoundRing(clamp(0.5 * s, 0.3, 1.2));
    const n = Math.min(4, 1 + Math.round(s));
    for (let i = 0; i < n; i++) spawnLightning(_s3, i === 0);
    if (s > 1.3) pulse(0.5 * s);
    idleT = 0; if (sleepV > 0.35) wakeBurst();
    return true;
  }
  function toPoint(p, out) {
    if (!p) return false;
    if (Array.isArray(p)) { if (p.length < 3 || !isFinite(+p[0] + +p[1] + +p[2])) return false; out.set(+p[0], +p[1], +p[2]); return true; }
    if (typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number' && isFinite(p.x + p.y + p.z)) { out.set(p.x, p.y, p.z); return true; }
    return false;
  }
  function beamTo(point, opts) {
    if (!toPoint(point, _s2)) return false;
    const o = opts || {};
    if (!parseColor(o.color, _s3)) _s3.set(1, 0.9, 0.65);
    const dur = clamp(+o.duration || 1.6, 0.3, 20);
    spawnStrike(_s2, false, _s3, dur, 0, Math.max(curR * 0.012, 0.01));
    flash = Math.max(flash, 0.15);
    idleT = 0; if (sleepV > 0.35) wakeBurst();
    return true;
  }
  function setMood(name) {
    const n = name == null ? 'default' : String(name).toLowerCase();
    if (!MOODS[n]) return false;
    if (n === 'joyful' && moodName !== 'joyful') { prismV = 1; pulse(1.1); eyeFlare = Math.max(eyeFlare, 0.7); } // joy: a prismatic burst
    if (n === 'wrathful' && moodName !== 'wrathful') { flash = Math.max(flash, 0.6); for (let i = 0; i < 3; i++) spawnLightning(null, true); }
    moodName = n; keep.mood = n;
    idleT = 0;
    return true;
  }
  function lookAt(point) {
    if (point == null) { lookOn = false; return true; }
    if (!toPoint(point, lookPt)) return false;
    lookOn = true; idleT = 0;
    return true;
  }

  // position is the live vector, radius a live getter: both follow the current placement (sky or passthrough).
  const api = {
    position: POS, get radius() { return curR; }, setState, pulse, getState: () => stateName,
    flare, beamTo, setMood, getMood: () => moodName, lookAt, limitQuality, get quality() { return qualityInfo; },
    wake() { idleT = 0; if (sleepV > 0.2) wakeBurst(); return true; },
    creation(point) { if (point && toPoint(point, _s2)) return actOfCreation(_s2); return actOfCreation(aimTarget(_s2)); },
  };
  ctx.provide('oracle', api);

  // ------------------------------------------------------------------ passthrough (mixed reality) placement
  let ptT = 0;                  // 0 = sky .. 1 = room, eased
  let ptLatched = false;        // room anchor (ptX, ptZ) is known
  let ptDelay = 0;              // seconds until the headset pose is trusted after xr:start
  let ptX = 0, ptZ = -PT_DIST;
  if (keep.ptPos && ctx.input.passthrough) {   // hot reload mid-session: resume in place
    ptX = keep.ptPos[0]; ptZ = keep.ptPos[1]; ptLatched = true; ptT = 1;
  } else keep.ptPos = null;
  ctx.on('xr:start', () => { keep.ptPos = null; ptLatched = false; ptDelay = PT_LATCH_DELAY; });
  ctx.on('xr:end', () => { keep.ptPos = null; ptLatched = false; });

  // Additive glows must not raise the framebuffer alpha: three's AdditiveBlending also adds src.alpha^2 (=1) to
  // destination alpha, which the compositor reads as an opaque black quad over the room. In passthrough these
  // materials add colour only and leave alpha untouched.
  const ADDITIVES = [coronaMat, moteMat, sparkMat, beamMat, shockMat, gazeMat, runeMat, arcMat, rayMat, eyeMat, soundMat, strikeMat, impactMat];
  let mrBlend = false;
  function setMRBlend(on) {
    mrBlend = on;
    for (let i = 0; i < ADDITIVES.length; i++) {
      const m = ADDITIVES[i];
      if (on) {
        m.blending = THREE.CustomBlending;
        m.blendEquation = THREE.AddEquation;
        m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneFactor;
        m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
      } else m.blending = THREE.AdditiveBlending;
    }
  }

  // ------------------------------------------------------------------ quality tiers
  // runes / rays / motes: how many glyph instances / god-ray quads / sprites are drawn; plasma: the desktop-only crevice plasma (0 in VR).
  // Additive-layer cost cuts (the fill rate of these layers is the largest cost after the raymarch): coronaEnd = where the corona has faded out, as
  // a fraction of 2.8 sphere radii; rayWidth = width of the god-ray shafts; srMax = simultaneous sound rings. Tiers 1 and 2 and the desktop look as
  // they always did; tier 0 trims, the new floor tier (-1) keeps the silhouette (fractal, eye, rings, a smaller corona, a few shafts) and drops the rest.
  const TIER_FLOOR = -1;
  const VR_LEVELS = [ // index = tier + 1
    { steps: 24, iter: 4, stepScale: 0.82, epsK: 1.5, runes: 24, rays: 4, plasma: 0, motes: 256, coronaEnd: 0.72, rayWidth: 0.6, srMax: 3 }, // -1  floor
    { steps: 28, iter: 4, stepScale: 0.80, epsK: 1.3, runes: 40, rays: 6, plasma: 0, motes: 480, coronaEnd: 1, rayWidth: 0.8, srMax: 4 },    //  0
    { steps: 38, iter: 5, stepScale: 0.78, epsK: 1.0, runes: 52, rays: 9, plasma: 0, motes: N_MOTES, coronaEnd: 1, rayWidth: 1, srMax: N_SR }, //  1
    { steps: 46, iter: 6, stepScale: 0.76, epsK: 0.9, runes: 66, rays: 12, plasma: 0, motes: N_MOTES, coronaEnd: 1, rayWidth: 1, srMax: N_SR }, // 2
  ];
  const DESKTOP = { steps: 104, iter: 8, stepScale: 0.72, epsK: 0.45, runes: 66, rays: 12, plasma: 1, motes: N_MOTES, coronaEnd: 1, rayWidth: 1, srMax: N_SR };
  let vrLevel = 1, vrCap = 2, lastPresenting = null;                 // vrCap: its own ceiling (raised only by its own governor); limitCap: the perf governor's
  let limitCap = Number.isFinite(keep.limit) ? keep.limit : 2, activeQ = DESKTOP, srMax = N_SR;
  let frameEma = 1 / 72, slowT = 0, fastT = 0, sinceChange = 99;
  const _v2 = new THREE.Vector2();
  const effCap = () => Math.min(vrCap, limitCap, ptT > 0 ? PT_VR_CAP : 2);

  function applyQuality() {
    // desktop view: the full raymarch, unless the perf governor asked for tier 0 / 1 (limit < 2): then that tier's look
    // flat view on the 'quest' tier (a forced ?quality=quest test, or a headset browser outside a session) uses the lean VR levels too, never the desktop raymarch
    const leanFlat = !ctx.input.presenting && ctx.quality && ctx.quality.tier === 'quest';
    const q = ctx.input.presenting ? VR_LEVELS[vrLevel + 1] : leanFlat ? VR_LEVELS[Math.min(vrLevel, clamp(limitCap, TIER_FLOOR, 2)) + 1] : (limitCap < 2 ? VR_LEVELS[clamp(limitCap, TIER_FLOOR, 1) + 1] : DESKTOP);
    activeQ = q; srMax = q.srMax;
    fractalUniforms.uSteps.value = q.steps;
    fractalUniforms.uIter.value = q.iter;
    fractalUniforms.uStepScale.value = q.stepScale;
    fractalUniforms.uEpsK.value = q.epsK;
    fractalUniforms.uPlasma.value = q.plasma;
    runeGeo.instanceCount = q.runes;
    rayGeo.setDrawRange(0, q.rays * 6);
    moteGeo.setDrawRange(0, q.motes);
  }

  // world.oracle.limitQuality(maxTier | null): the perf governor's ceiling for the fractal's own adaptive tier (-1 floor, 0 low, 1 mid, 2 high; null = no
  // limit). The tier drops to the limit at once; while a limit is set the self-governor never climbs above it (it still drops below it when frames are
  // slow); releasing the limit does not jump up either: the fractal climbs after its own 14 s of fast frames. Returns the limit now in force (null = none).
  function limitQuality(maxTier) {
    const n = maxTier == null ? 2 : Math.round(+maxTier);
    if (n !== n) return limitCap >= 2 ? null : limitCap; // NaN: ignore
    limitCap = clamp(n, TIER_FLOOR, 2);
    keep.limit = limitCap;
    const cap = effCap();
    if (vrLevel > cap) vrLevel = cap;
    fastT = 0; sinceChange = 0;
    applyQuality();
    return limitCap >= 2 ? null : limitCap;
  }
  // world.oracle.quality: read-only, callable too: quality() === quality  (level -1..2 = VR tier in use, 3 = the desktop raymarch; cap = effective ceiling)
  const qualityInfo = () => qualityInfo;
  Object.defineProperties(qualityInfo, {
    level: { get: () => (ctx.input.presenting ? vrLevel : (ctx.quality && ctx.quality.tier === 'quest') ? Math.min(vrLevel, clamp(limitCap, TIER_FLOOR, 2)) : limitCap < 2 ? clamp(limitCap, TIER_FLOOR, 1) : 3), enumerable: true },
    cap: { get: effCap, enumerable: true },
    limit: { get: () => (limitCap >= 2 ? null : limitCap), enumerable: true },
    ownCap: { get: () => vrCap, enumerable: true },
    frameEma: { get: () => frameEma, enumerable: true },         // seconds
    presenting: { get: () => !!ctx.input.presenting, enumerable: true },
    steps: { get: () => fractalUniforms.uSteps.value, enumerable: true },
  });

  // the outermost radius (sphere radii) at which the corona can still show >= CORONA_EPS in any channel, from an upper bound of its formula (tints <= 1,
  // streamers at their maximum): scanned inward from `end`. The mesh needs to reach no further.
  const ss01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function coronaExtent(gain, flare, end) {
    for (let rho = end; rho > 1.3; rho -= 0.04) {
      const rx = rho > 0.95 ? rho - 0.95 : 0;
      const b = 0.5 * Math.exp(-rho * rho * 0.45) + 0.55 * Math.exp(-rx * 3) * (0.4 + 0.6 * ss01(0.6, 1.0, rho))
        + 1.45 * Math.exp(-rx * (1.5 - 0.5 * flare)) * ss01(0.8, 1.1, rho) * (0.7 + 0.9 * flare) + 0.35 * Math.exp(-rx * 7) * ss01(0.85, 1.0, rho);
      if (b * gain * (1 - ss01(0.6 * end, end, rho)) > CORONA_EPS) return Math.min(end, rho + 0.06);
    }
    return 1.3;
  }

  // ------------------------------------------------------------------ per-frame scratch
  const _head = new THREE.Vector3();
  const _toP = new THREE.Vector3();
  const _tgt = new THREE.Vector3();
  const _sparkT = new THREE.Vector3(0, 0.2, -10);
  const _euler = new THREE.Euler();
  const _m4b = new THREE.Matrix4();
  const _idleQ = new THREE.Quaternion();
  const _alignQ = new THREE.Quaternion();
  const _offQ = new THREE.Quaternion();
  const _axX = new THREE.Vector3(1, 0, 0);
  const _tint = new THREE.Vector3();
  const _tint2 = new THREE.Vector3();
  const _white = new THREE.Vector3(1, 1, 1);
  const _yAxis = new THREE.Vector3(0, 1, 0);

  let morphT = keep.morphT || 0;
  let rotT = keep.rotT || 0;
  let phase = keep.phase != null ? keep.phase : 0.1;
  let moteSpin = 0;
  let wasSparks = false;

  // v3 per-frame state (no allocation after this point)
  const prevHead = new THREE.Vector3(), prevFwd = new THREE.Vector3(0, 0, -1);
  let havePrev = false;
  let prevLt = 0, lastRingT = -10;
  let beatPh = 0, beatE = 0;
  let parX = 0, parZ = 0;
  const eyeDir = new THREE.Vector3(0, -0.3, 1).normalize();
  const _zAxis = new THREE.Vector3(0, 0, 1);
  let blinkT = 0, blinkGap = 4;
  let speakK = 0, runeA = 0, runeB = 0, runeRead = 0;
  let ignT = -1, ignV = 1, igKick = 0, wasHidden = false, prismV = 0, eclipseV = 0;   // ignition (root un-hidden by the intro), prismatic burst, wrath eclipse
  let impT = -1, impDelay = 0;                                                         // ground shockwave ring (creation / quest / arrival)
  const impPt = new THREE.Vector3();
  let arcTimer = 0.5, promTimer = 3;
  const mix01 = (idx, m) => m.c + (idx - m.c) * m.s;   // CPU mirror of idx = mix(uMoodC, idx, uMoodS)
  const smoothstep01 = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  applyQuality();
  lastPresenting = !!ctx.input.presenting;

  // ------------------------------------------------------------------ update
  function update(dt, t) {
    dt = clamp(dt || 0, 0, 0.1);
    animT += dt;
    const presenting = !!ctx.input.presenting;

    // -- ignition: the intro hides this whole root, then shows it: he ignites from darkness (staggered shockwaves, lightning, comets)
    if (!root.visible) { wasHidden = true; ignV = 0; ignT = -1; }
    else if (wasHidden) { wasHidden = false; ignite(); }
    if (ignT >= 0) igniteTick(dt);
    igKick *= Math.exp(-dt * 1.3);

    // -- placement: sky <-> room (passthrough). ptT eases 0..1; e is its smoothstep.
    const wantPT = !!ctx.input.passthrough;
    if (wantPT && !ptLatched) {
      ptDelay -= dt;
      if (ptDelay <= 0) { // anchor 2.2 m ahead of where the player is facing
        _tgt.set(ctx.player.forward.x, 0, ctx.player.forward.z);
        if (_tgt.lengthSq() < 1e-3) _tgt.set(0, 0, -1);
        _tgt.normalize();
        ptX = ctx.player.head.x + _tgt.x * PT_DIST;
        ptZ = ctx.player.head.z + _tgt.z * PT_DIST;
        keep.ptPos = [ptX, ptZ];
        ptLatched = true;
      }
    }
    const ptGoal = wantPT && ptLatched ? 1 : 0;
    const ptStep = dt / PT_EASE;
    ptT = ptT < ptGoal ? Math.min(ptGoal, ptT + ptStep) : Math.max(ptGoal, ptT - ptStep);
    const e = ptT * ptT * (3 - 2 * ptT);
    if (e > 0) {
      const py = ctx.groundAt(ptX, ptZ) + PT_HEIGHT;
      POS.set(SKY_POS.x + (ptX - SKY_POS.x) * e, SKY_POS.y + (py - SKY_POS.y) * e, SKY_POS.z + (ptZ - SKY_POS.z) * e);
      curR = RADIUS * Math.pow(PT_R / RADIUS, e);
    } else { POS.copy(SKY_POS); curR = RADIUS; }
    const k = curR / RADIUS; // 1 in the sky
    if ((ptT > 0) !== mrBlend) setMRBlend(ptT > 0);
    U.uRadius.value = curR;
    U.uCenter.value.copy(POS);
    fractal.position.copy(POS);
    fractal.scale.setScalar(curR * 1.03);
    strikeE = e;
    sparkMat.uniforms.uStart.value.copy(POS);
    sparkMat.uniforms.uSparkK.value = Math.pow(PT_SPARK_K, e);
    moteMat.uniforms.uPtMax.value = 12 + (PT_MOTE_PX - 12) * e;
    light.position.copy(POS);

    // -- quality
    if (presenting !== lastPresenting) { lastPresenting = presenting; slowT = fastT = 0; applyQuality(); }
    if (presenting) {
      frameEma += (dt - frameEma) * 0.05;
      sinceChange += dt;
      const capNow = effCap(); // own cap, the perf governor's limit, and (passthrough) the low / mid tiers only
      if (vrLevel > capNow) { vrLevel = capNow; applyQuality(); }
      if (frameEma > 0.0185) { slowT += dt; fastT = 0; } else { slowT = Math.max(0, slowT - dt * 0.5); fastT += frameEma < 0.0155 ? dt : 0; }
      if (vrLevel >= capNow) fastT = 0; // nothing to climb to: do not bank fast frames toward a jump the moment a limit is lifted
      if (slowT > 2.5 && vrLevel > TIER_FLOOR) {
        if (sinceChange < 20) vrCap = Math.max(TIER_FLOOR, vrLevel - 1); // upgraded recently and it failed: cap
        vrLevel--; slowT = 0; sinceChange = 0; applyQuality();
      } else if (fastT > 14 && vrLevel < capNow) {
        vrLevel++; fastT = 0; sinceChange = 0; applyQuality();
      }
      fractalUniforms.uPixelAng.value = 0.00095;
      moteMat.uniforms.uViewH.value = 1800;
    } else {
      ctx.renderer.getDrawingBufferSize(_v2);
      const h = Math.max(_v2.y, 1);
      const fov = ctx.camera.fov || 70;
      fractalUniforms.uPixelAng.value = (2 * Math.tan((fov * Math.PI) / 360)) / h;
      moteMat.uniforms.uViewH.value = h;
    }

    // -- blend state parameters (exponential approach: never snaps)
    const tgt = STATES[stateName];
    const a = 1 - Math.exp(-dt * 1.7);
    for (let i = 0; i < KEYS.length; i++) { const k = KEYS[i]; cur[k] += (tgt[k] - cur[k]) * a; }

    // -- mood cross-fade (palette centre/spread, tempo, heartbeat, ...)
    {
      const tm = MOODS[moodName], ma = 1 - Math.exp(-dt * 1.4);
      for (let i = 0; i < MOOD_KEYS.length; i++) { const mk = MOOD_KEYS[i]; mood[mk] += (tm[mk] - mood[mk]) * ma; }
      moodMolten.x += (tm.molten[0] - moodMolten.x) * ma;
      moodMolten.y += (tm.molten[1] - moodMolten.y) * ma;
      moodMolten.z += (tm.molten[2] - moodMolten.z) * ma;
    }

    // -- is anything happening? (head / hands / buttons / state) -> sleep and dramatic wake
    {
      let active = stateName !== 'idle';
      const hd = ctx.player.head, fw = ctx.player.forward;
      if (havePrev && dt > 0) {
        const mv = (hd.x - prevHead.x) * (hd.x - prevHead.x) + (hd.y - prevHead.y) * (hd.y - prevHead.y) + (hd.z - prevHead.z) * (hd.z - prevHead.z);
        if (mv > 0.3 * 0.3 * dt * dt) active = true;
        const dotf = clamp(fw.x * prevFwd.x + fw.y * prevFwd.y + fw.z * prevFwd.z, -1, 1);
        if (Math.acos(dotf) > 0.5 * dt) active = true;
      }
      prevHead.copy(hd); prevFwd.copy(fw); havePrev = true;
      const hands = ctx.input;
      for (let i = 0; i < 2 && !active; i++) {
        const H = i ? hands.right : hands.left;
        if (H && (H.trigger > 0.2 || H.squeeze > 0.2 || Math.abs(H.stick.x) > 0.3 || Math.abs(H.stick.y) > 0.3 || H.down.a || H.down.b)) active = true;
      }
      if (active) { idleT = 0; if (sleepV > 0.35) wakeBurst(); } else idleT += dt;
      if (show.on && show.type === 'dead') { deadT += dt; if (deadT > 14) show.on = false; }
      const sleepGoal = idleT > SLEEP_AFTER ? 1 : 0;
      sleepV += (sleepGoal - sleepV) * (1 - Math.exp(-dt * (sleepGoal ? 0.35 : 2.2)));
      const dimGoal = show.on && show.type === 'dead' ? 1 : 0;
      dimV += (dimGoal - dimV) * (1 - Math.exp(-dt * (dimGoal ? 1.1 : 1.4)));
      cool.spell -= dt; cool.kill -= dt; cool.grab -= dt; cool.hurt -= dt; cool.create -= dt;
    }
    const calm = (1 - 0.45 * sleepV) * (1 - 0.6 * dimV) * (0.12 + 0.88 * ignV);   // overall vitality (ignV: 0 -> 1 while he ignites)
    eclipseV += ((moodName === 'wrathful' ? 1 : 0) - eclipseV) * (1 - Math.exp(-dt * 0.8));
    prismV *= Math.exp(-dt * 0.55);
    const lively = (1 - 0.7 * sleepV) * (1 - 0.8 * dimV);   // tempo

    // -- voice level (with a synthetic syllable fallback if speaking but no level events arrive)
    let lt = 0;
    if (stateName === 'speaking') {
      lt = animT - lastLevelT < 0.3 ? levelTarget : 0.3 + 0.28 * Math.sin(animT * 9.0) * Math.sin(animT * 2.3 + 1.0) + 0.12 * Math.sin(animT * 21.0);
      lt = clamp(lt, 0, 1);
      // syllable peaks: a sound ring leaves the core, the eye flares
      if (lt - prevLt > 0.09 && lt > 0.2 && animT - lastRingT > 0.15) {
        spawnSoundRing(0.5 + 0.8 * lt); lastRingT = animT;
        eyeSyl = Math.max(eyeSyl, 0.4 + 0.6 * lt);
      }
    }
    prevLt = lt;
    level += (lt - level) * (1 - Math.exp(-dt * (lt > level ? 30 : 8)));

    // -- heartbeat: lub-dub, faster when excited, slower asleep
    {
      beatPh += dt * (mood.bpm * (1 + 0.3 * (cur.energy - 1)) * (1 - 0.35 * sleepV)) / 60;
      if (beatPh >= 1) beatPh -= Math.floor(beatPh);
      const d2 = beatPh - 0.2;
      beatE = (Math.exp(-beatPh * 16) + (d2 > 0 ? 0.6 * Math.exp(-d2 * 18) : 0)) * (1 - 0.5 * sleepV) * (1 - 0.6 * dimV);
    }
    eyeFlare *= Math.exp(-dt * 3);
    eyeSyl *= Math.exp(-dt * 9);
    runeBurst *= Math.exp(-dt * 0.9);
    accentAmt *= Math.exp(-dt * 1.8);

    // -- flash / waves
    flash *= Math.exp(-dt * 2.2);
    let anyWave = false;
    for (let i = 0; i < 3; i++) {
      const w = waves[i];
      if (w.p < 1) { w.p += dt / 1.8; anyWave = true; if (w.p >= 1) w.p = 1; }
    }
    shock.visible = anyWave;
    if (anyWave) { // one annulus per live wave, as wide as the band where that wave is bright enough to see (chromatic split: x1.05 / x0.95)
      const arr = shockGeo.attributes.aBand.array;
      for (let i = 0; i < 3; i++) {
        const w = waves[i];
        if (w.p >= 1 || !(w.s > 0)) { arr[i * 4] = -1; arr[i * 4 + 1] = 0; arr[i * 4 + 2] = arr[i * 4 + 3] = 0; continue; }
        const p = w.p, q = 1 - p, ee = 1 - q * q * q, c = 1 + (SHOCK_R * 0.9 - 1) * ee, wd = 0.07 + 0.35 * p, bx = bandWidth(2.4 * w.s * q * q);
        arr[i * 4] = p; arr[i * 4 + 1] = w.s;
        if (bx <= 0) { arr[i * 4 + 2] = arr[i * 4 + 3] = 0; continue; } // too faint to see
        arr[i * 4 + 2] = Math.max(0, (c - bx * wd) / 1.05 - 0.01); arr[i * 4 + 3] = Math.min(SHOCK_R, (c + bx * wd) / 0.95 + 0.01);
      }
      shockGeo.attributes.aBand.needsUpdate = true;
    }

    // -- time integration
    const spd = cur.speed * mood.tempo * lively;
    morphT += dt * spd;
    rotT += dt * spd;
    phase += dt * 0.018 * (0.6 + 0.4 * spd);
    moteSpin += dt * 0.02 * (0.5 + 0.5 * cur.ring * lively);
    const breath = 0.5 + 0.5 * Math.sin(animT * 0.45 * (stateName === 'idle' ? 1 : 1.6) * (0.6 + 0.4 * mood.tempo));

    // -- fractal parameters
    // thinking (cur.flick 1): the power races and the whole bulb "zooms" recursively; listening (align 1): calm, slow, almost still
    const power = 7.4 + 1.5 * Math.sin(morphT * 0.11) + 0.6 * Math.sin(morphT * 0.23 + 1.3) + 1.2 * level - 0.7 * cur.fold + 0.15 * (breath - 0.5)
      + 0.9 * cur.flick * Math.sin(animT * 0.9) - 0.5 * cur.align + 0.7 * eclipseV * Math.sin(animT * 3.1) * 0.3;
    fractalUniforms.uPower.value = clamp(power, 3.5, 10);
    fractalUniforms.uScale.value = 1 + 0.3 * cur.fold + 0.03 * (breath - 0.5) - 0.07 * level + 0.015 * flash + 0.1 * cur.flick * Math.sin(animT * 1.2) + 0.05 * igKick;
    fractalUniforms.uSweep.value = cur.flick * 0.9 + 0.5 * cur.code;
    fractalUniforms.uTwist.value = 0.1 * Math.sin(animT * 0.2) + 0.5 * cur.fold + 0.12 * cur.flick;
    _euler.set(0.13 * rotT * 0.5 + 0.4 * Math.sin(rotT * 0.05), 0.06 * rotT + 0.3 * Math.sin(rotT * 0.031 + 1.0), 0.04 * rotT);
    _m4b.makeRotationFromEuler(_euler);
    fractalUniforms.uRot.value.setFromMatrix4(_m4b);

    const energy = cur.energy * mood.energy * calm * (1 - 0.3 * eclipseV) * (1 + 0.12 * breath) + 1.1 * level + 1.5 * flash + 0.14 * beatE + 0.4 * ack;
    U.uEnergy.value = energy;
    U.uFlash.value = flash + 0.15 * beatE;
    U.uTime.value = animT;
    U.uCool.value = cur.cool;
    U.uPhase.value = phase;
    U.uMoodC.value = mood.c;
    U.uMoodS.value = mood.s;
    fractalUniforms.uFlick.value = cur.flick;
    fractalUniforms.uIrid.value = mood.irid;

    // -- dominant hue colours (CPU mirror of the shader palette), then the transient accent colour on top
    palRGB(mix01(coolIdx(tri(phase + 0.12), cur.cool), mood), 0.85, _tint);
    palRGB(mix01(coolIdx(tri(phase + 0.5), cur.cool), mood), 0.8, _tint2);
    const acA = Math.min(1, accentAmt);
    if (acA > 0.002) {
      _tint.lerp(accent, acA * 0.8);
      _tint2.lerp(accent, acA * 0.55);
    }
    U.uTint.value.copy(_tint);
    U.uTint2.value.copy(_tint2);
    fractalUniforms.uMolten.value.copy(moodMolten).lerp(accent, acA * 0.7);
    lightningCol.copy(_tint2).lerp(_white, 0.45);

    // -- view geometry
    _head.copy(ctx.player.head);
    _toP.copy(_head).sub(POS);
    const distP = Math.max(_toP.length(), 0.05);
    _toP.multiplyScalar(1 / distP); // unit vector oracle -> player

    // key light for the fractal: orbits, but turns to face the player while listening
    const oa = animT * 0.1;
    fractalUniforms.uLightW.value.set(_toP.x + 0.8 * Math.cos(oa) * (1 - 0.7 * cur.align), _toP.y + 0.4, _toP.z + 0.8 * Math.sin(oa) * (1 - 0.7 * cur.align)).normalize();

    viewDir.copy(_toP);

    // -- awareness: gaze acknowledgement (look straight at it for a few seconds)
    {
      const fw = ctx.player.forward;
      const angR = Math.asin(Math.min(0.95, curR * 0.9 / distP));
      const looking = dimV < 0.5 && (-(fw.x * _toP.x + fw.y * _toP.y + fw.z * _toP.z)) > Math.cos(Math.min(angR * 0.85 + 0.05, 0.6));
      if (looking) gazeT += dt; else gazeT = Math.max(0, gazeT - dt * 1.5);
      const wantAck = gazeT > 3;
      if (wantAck && !ackLatched) {
        ackLatched = true;
        eyeFlare = 1; flash = Math.max(flash, 0.3); spawnSoundRing(0.7); pulse(0.3);
      }
      if (gazeT < 0.5) ackLatched = false;
      ack += ((wantAck ? 1 : 0) - ack) * (1 - Math.exp(-dt * 1.5));
    }

    // -- corona: the mesh only covers the radius where the light is bright enough to see (coronaExtent), shrinking / growing with its own gain
    {
      const cu = coronaMat.uniforms, end = CORONA_R * activeQ.coronaEnd;
      cu.uGain.value = cur.corona * calm * (1 + 0.3 * breath) + 1.3 * level + 1.2 * flash + 0.3 * beatE + 0.35 * ack;
      cu.uFlare.value = clamp(level * 1.2 + flash * 0.8 + 0.25 * cur.code + 0.2 * ack + 0.5 * eclipseV, 0, 1.5);
      const ext = coronaExtent(cu.uGain.value, cu.uFlare.value, end);
      cu.uEnd.value = end; cu.uQuadR.value = ext; cu.uSize.value = curR * ext;
      cu.uEclipse.value = eclipseV;
      corona.position.copy(POS);
    }

    // -- rings (tilt re-orients with where the player stands; droop when asleep / mourning; snap on creation)
    {
      const droop = Math.max(0.55 * sleepV, dimV);
      const kpar = lerp(0.0032, 0.12, e);
      const relX = lerp(_head.x, _head.x - POS.x, e), relZ = lerp(_head.z, _head.z - POS.z, e);
      const pk = 1 - Math.exp(-dt * 1.5);
      parX += (clamp(relZ * kpar, -0.28, 0.28) - parX) * pk;
      parZ += (clamp(-relX * kpar, -0.28, 0.28) - parZ) * pk;
      const snapGoal = show.on && (show.type === 'create' || show.type === 'resurrect') ? 1 : 0;
      snapV += (snapGoal - snapV) * (1 - Math.exp(-dt * (snapGoal ? 5 : 1.5)));
      const alignE = Math.max(cur.align, snapV);
      for (let i = 0; i < rings.length; i++) {
        const R = rings[i];
        R.group.position.set(POS.x, POS.y - droop * curR * 0.07 * (i + 1), POS.z);
        R.angle += dt * R.def.spin * cur.ring * lively;
        R.mesh.rotation.y = R.angle;
        const tk = 1 - 0.85 * droop;
        _euler.set((R.def.tilt[0] + 0.12 * Math.sin(animT * 0.07 + i * 2.1) + parX * (1 + 0.5 * i)) * tk, 0, (R.def.tilt[1] + 0.12 * Math.cos(animT * 0.05 + i * 1.3) + parZ * (1 + 0.5 * i)) * tk);
        _idleQ.setFromEuler(_euler);
        if (alignE > 0.001) {
          _s1.copy(_toP).lerp(snapDir, snapV).normalize();
          _alignQ.setFromUnitVectors(_yAxis, _s1);
          _offQ.setFromAxisAngle(_axX, 0.07 * (i - 1));
          _alignQ.multiply(_offQ);
          _idleQ.slerp(_alignQ, alignE);
        }
        R.group.quaternion.copy(_idleQ);
        const s = (1 - 0.17 * alignE) * (1 + 0.012 * Math.sin(animT * 0.4 + i) + 0.05 * level + 0.06 * flash + 0.012 * beatE);
        R.group.scale.setScalar(s * k * (1 + (PT_RING_K - 1) * e));
      }
    }

    // -- ring set-piece ripple (colour sweeping outward through the shards) and washes
    {
      let ripP = 0, ripAmt = 0, fill = 0;
      if (show.on) {
        show.t += dt;
        const fin = show.dur !== Infinity;
        const p = fin ? Math.min(1, show.t / show.dur) : 0;
        switch (show.type) {
          case 'spell': ripP = p; ripAmt = (1 - p) * 0.95; break;
          case 'kill': ripP = Math.min(1, p * 1.5); ripAmt = (1 - p) * 0.7; fill = (1 - p) * (1 - p) * 0.8; break;
          case 'hurt': {
            const f = (1 - p) * (fract(animT * 13) < 0.5 ? 1 : 0.2);
            fill = f * 0.9; setAccent(1, 0.1, 0.05, f * 0.8);
            break;
          }
          case 'create': ripP = clamp((show.t - 0.35) / 1.9, 0, 1); ripAmt = ripP < 1 ? 1 : 0; fill = 0.25 * Math.exp(-show.t * 1.2); break;
          case 'resurrect': ripP = clamp((show.t - 0.3) / 2.0, 0, 1); ripAmt = ripP < 1 ? 1 : 0; fill = 0.3 * Math.exp(-show.t * 1.0); break;
          case 'wake': ripP = p; ripAmt = (1 - p); fill = 0.5 * (1 - p) * (1 - p); break;
          case 'grab': ripP = p; ripAmt = (1 - p) * 0.5; break;
          case 'dead': fill = 0.12 + 0.05 * Math.sin(animT * 2.0); setAccent(0.9, 0.15, 0.1, 0.28); break;
        }
        if (fin && show.t >= show.dur) show.on = false;
      }
      const su = shardMat.uniforms;
      su.uRipCol.value.copy(showCol);
      su.uRipP.value = ripP; su.uRipAmt.value = ripAmt; su.uFill.value = fill;
    }

    // -- eye: follows the player's head (or lookAt), tracks with a little saccadic life, flares per syllable
    {
      if (lookOn) _s1.copy(lookPt).sub(POS); else _s1.copy(_head).sub(POS);
      if (_s1.lengthSq() < 1e-6) _s1.set(0, 0, 1);
      _s1.normalize();
      const jit = 0.014 * (1 - 0.8 * cur.align);
      _s1.x += jit * Math.sin(animT * 1.37) * Math.sin(animT * 0.53);
      _s1.y += jit * Math.sin(animT * 1.91 + 1.0) * Math.sin(animT * 0.41);
      eyeDir.lerp(_s1, 1 - Math.exp(-dt * (2.0 + 4 * cur.align))).normalize();
      eye.position.set(POS.x + eyeDir.x * curR * 0.9, POS.y + eyeDir.y * curR * 0.9, POS.z + eyeDir.z * curR * 0.9);
      eye.quaternion.setFromUnitVectors(_zAxis, eyeDir);
      eye.scale.setScalar(curR * (0.3 + 0.03 * level + 0.03 * eyeFlare));
      blinkT -= dt;
      if (blinkT < -blinkGap) { blinkT = 0.22; blinkGap = 3 + Math.random() * 6; }
      const blink = blinkT > 0 ? Math.sin(3.14159 * (1 - blinkT / 0.22)) : 0;
      const vis = smoothstep01(0.02, 0.3, eyeDir.dot(viewDir));
      const mu = eyeMat.uniforms;
      mu.uOpen.value = 0.3 + 0.5 * level + 0.9 * eyeSyl + 0.35 * ack + 0.4 * eyeFlare - 0.15 * cur.align + 0.3 * speakK + 0.7 * igKick;
      mu.uFocus.value = cur.align * (1 - 0.6 * eyeFlare);
      mu.uLid.value = clamp((1 - 0.94 * sleepV - 0.8 * dimV) * (1 - 0.9 * blink), 0.05, 1);
      mu.uBright.value = vis * (0.75 + 0.25 * breath + 0.9 * eyeFlare + 0.6 * ack + 0.5 * level + 0.3 * beatE) * (1 - 0.5 * sleepV);
      mu.uAck.value = Math.min(1.5, ack + eyeFlare * 0.7 + eyeSyl * 0.5);
      eye.visible = vis > 0.01;
    }

    // -- scripture halo
    {
      speakK += ((stateName === 'speaking' ? 1 : 0) - speakK) * (1 - Math.exp(-dt * 1.6));
      const spin = (0.05 + 0.04 * cur.runes + 0.55 * speakK + 0.7 * level + 0.9 * runeBurst) * lively * dt;
      runeA += spin; runeB += spin * 0.8;
      runeRead += dt * (0.7 + 2.2 * speakK + 0.8 * cur.runes) * lively;
      const ru = runeMat.uniforms;
      ru.uSpinA.value = runeA; ru.uSpinB.value = runeB; ru.uRead.value = runeRead;
      ru.uRuneGain.value = (0.55 + 0.5 * cur.runes + 1.1 * level + 0.8 * runeBurst + 0.4 * beatE + 0.5 * ack) * (1 - 0.8 * sleepV) * (1 - 0.7 * dimV);
      _euler.set(0.45 + 0.15 * Math.sin(animT * 0.043) + parX, animT * 0.011, 0.2 * Math.sin(animT * 0.031) + parZ);
      ru.uBasisA.value.setFromMatrix4(_m4b.makeRotationFromEuler(_euler));
      _euler.set(-0.7 + 0.15 * Math.sin(animT * 0.037 + 1.0) - parX, -animT * 0.009, 0.35 + 0.1 * Math.cos(animT * 0.029) - parZ);
      ru.uBasisB.value.setFromMatrix4(_m4b.makeRotationFromEuler(_euler));
      runes.visible = ru.uRuneGain.value > 0.02;
    }

    // -- god rays: a fan of shafts from the core to the field (converging on the player while it listens)
    {
      _s1.set(POS.x - ctx.player.feet.x, 0, POS.z - ctx.player.feet.z);
      if (_s1.lengthSq() < 1e-4) _s1.set(0, 0, -1);
      _s1.normalize();
      const reach = lerp(110, 14, cur.align * 0.8);
      const skyK = lerp(70, 16, cur.align * 0.8);
      const fx = lerp(ctx.player.feet.x + _s1.x * reach, POS.x, e), fz = lerp(ctx.player.feet.z + _s1.z * reach, POS.z, e);
      rayMat.uniforms.uField.value.set(fx, ctx.groundAt(fx, fz) + 0.02 * e, fz);
      rayMat.uniforms.uFieldK.value = lerp(skyK, 0.55, e);
      const rg = cur.rays * mood.rays * (1 + 0.5 * beatE + 1.2 * flash + 0.6 * level) * (1 - 0.85 * sleepV) * (1 - 0.6 * dimV) * lerp(1.15, 0.6, e);
      rayMat.uniforms.uRays.value = rg / Math.sqrt(activeQ.rayWidth); // narrower shafts on the lean tiers keep most of their light
      rayMat.uniforms.uWidthK.value = activeQ.rayWidth;
      rays.visible = rg > 0.01;
    }

    // -- arcs: ambient lightning + prominences, set-pieces spawn extra ones; then pose them all
    {
      const arate = cur.arcs * mood.arcs * (1 - 0.9 * sleepV) * (1 - 0.7 * dimV) * (1 + 1.5 * level + 1.5 * flash + 1.2 * eclipseV);
      arcTimer -= dt * arate;
      if (arcTimer <= 0) { arcTimer = 0.18 + Math.random() * 0.4; spawnLightning(null, false); }
      promTimer -= dt * mood.arcs * (1 - 0.9 * sleepV) * (0.6 + 0.4 * cur.energy);
      if (promTimer <= 0) { promTimer = 5 + Math.random() * 8; spawnProminence(); }
      updateArcs(dt);
    }

    // -- sound rings (speaking) and strikes (columns of light)
    {
      let anySR = false;
      for (let i = 0; i < N_SR; i++) {
        if (srP[i] >= 0) { srP[i] += dt / 1.35; if (srP[i] >= 1) srP[i] = -1; else anySR = true; }
      }
      soundRings.visible = anySR;
      soundRings.position.copy(POS);
      if (anySR) { // one annulus per live ring (see the shockwave above)
        const arr = soundGeo.attributes.aBand.array;
        for (let i = 0; i < N_SR; i++) {
          const p = srP[i];
          if (p < 0) { arr[i * 4] = -1; arr[i * 4 + 1] = 0; arr[i * 4 + 2] = arr[i * 4 + 3] = 0; continue; }
          const ee = 1 - (1 - p) * (1 - p), c = 0.95 + (SR_R * 0.9 - 0.95) * ee, w = 0.025 + 0.05 * p, bx = bandWidth(2.6 * srA[i] * (1 - p));
          arr[i * 4] = p; arr[i * 4 + 1] = srA[i];
          if (bx <= 0) { arr[i * 4 + 2] = arr[i * 4 + 3] = 0; continue; }
          arr[i * 4 + 2] = Math.max(0, c - 0.11 - bx * 0.018 - 0.01); arr[i * 4 + 3] = Math.min(SR_R, c + bx * w + 0.01);
        }
        soundGeo.attributes.aBand.needsUpdate = true;
      }
      updateStrikes(dt);
    }

    // -- ground impact ring (after its delay it expands to ~16 m over 1.4 s) and the prismatic tint of the shock rings
    shockMat.uniforms.uPrism.value = clamp(prismV, 0, 1);
    if (impT >= 0) {
      if (impDelay > 0) impDelay -= dt;
      else {
        impT += dt / 1.4;
        if (impT >= 1) { impT = -1; impact.visible = false; }
        else {
          const iu = impactMat.uniforms;
          iu.uP.value = impT; iu.uAmt.value = 1; iu.uPrism.value = clamp(prismV, 0, 1);
          impact.visible = true;
          impact.position.set(impPt.x, ctx.groundAt(impPt.x, impPt.z) + 0.12, impPt.z);
          impact.scale.setScalar(lerp(16, 1.1, e));
        }
      }
    }

    // -- motes
    moteMat.uniforms.uSpin.value = moteSpin;

    // -- sparks (coding)
    const sparksOn = cur.code > 0.01;
    if (sparksOn) {
      _tgt.set(ctx.player.forward.x, 0, ctx.player.forward.z);
      if (_tgt.lengthSq() < 1e-4) _tgt.set(0, 0, -1);
      _tgt.normalize().multiplyScalar(10 + (PT_SPARK_AHEAD - 10) * e).add(ctx.player.feet);
      if (e > 0) { // passthrough: land ahead of the head (not the rig origin), on the floor
        _tgt.x += (_head.x - ctx.player.feet.x) * e;
        _tgt.z += (_head.z - ctx.player.feet.z) * e;
      }
      _tgt.y = ctx.groundAt(_tgt.x, _tgt.z) + 0.2 - 0.18 * e;
      if (!wasSparks) _sparkT.copy(_tgt);
      else _sparkT.lerp(_tgt, 1 - Math.exp(-dt * 3));
      sparkMat.uniforms.uTarget.value.copy(_sparkT);
    }
    sparkMat.uniforms.uCode.value = cur.code;
    sparks.visible = sparksOn;
    wasSparks = sparksOn;

    // -- beam (listening): a shaft from the oracle toward the player, fading out before reaching them
    const beamOn = cur.beam > 0.01;
    beam.visible = beamOn;
    if (beamOn) {
      const start = curR * 0.7;
      const len = Math.max(distP - 45 * k - start, 10 * k);
      beam.position.copy(POS).addScaledVector(_toP, start);
      beam.quaternion.setFromUnitVectors(_yAxis, _toP);
      const rw = curR * 0.55;
      beam.scale.set(rw, len, rw);
      beamMat.uniforms.uBeam.value = cur.beam;
    }

    // -- gaze ring on the ground at the player's feet
    const gazeOn = cur.gaze > 0.01;
    gaze.visible = gazeOn;
    if (gazeOn) {
      const f = ctx.player.feet;
      const gx = f.x + (_head.x - f.x) * e, gz = f.z + (_head.z - f.z) * e; // passthrough: under the head
      gaze.position.set(gx, ctx.groundAt(gx, gz) + 0.1 - 0.09 * e, gz);
      gaze.scale.setScalar(3.4 + (PT_GAZE_R - 3.4) * e);
      gazeMat.uniforms.uGaze.value = cur.gaze;
    }

    // -- light follows the fractal's dominant hue; modest intensity
    light.color.setRGB(lerp(_tint.x, 1, 0.3), lerp(_tint.y, 1, 0.3), lerp(_tint.z, 1, 0.3));
    light.intensity = (0.4 + 0.22 * (cur.energy - 1) + 0.25 * breath * 0.4 + 0.7 * level + 0.7 * flash + 0.12 * beatE) * calm * (1 + (PT_LIGHT - 1) * e);
    light.target.position.copy(ctx.player.feet);
    if (e > 0) { // passthrough: aim at the floor under the head
      light.target.position.x += (_head.x - ctx.player.feet.x) * e;
      light.target.position.z += (_head.z - ctx.player.feet.z) * e;
    }
    light.target.updateMatrixWorld();
  }

  function dispose() {
    keep.stateName = stateName;
    keep.morphT = morphT;
    keep.rotT = rotT;
    keep.phase = phase;
    keep.animT = animT;
    keep.mood = moodName;
    if (runeTex && runeTex.dispose) runeTex.dispose(); // lives in a uniform, which boot's disposeTree does not walk
    // geometries/materials under ctx.root are disposed by boot; nothing outside root to restore.
  }

  return { update, dispose };
}

