// core/world.js — the stage: twilight field, sky, light, fog, grass, glow-motes, far standing stones, a lake. Nothing to call except the services below.
// THE LAKE: centre (-30, -78), ~48 m long, up to ~1.7 m deep.
// MIXED REALITY (Quest passthrough, env.passthrough / ctx.input.passthrough true): sky, terrain, lake, grass, mist and stones are hidden, scene.background/fog are null, groundHeight is 0 everywhere (the real floor),
//   the rig sits at the origin; the player's real room is the stage. Keep things small and near (within ~2.5 m); never set scene.background or fog. kit.particles already uses an alpha-safe blend there.
//
//   world.groundHeight(x, z) -> metres, allocation-free. Within 60 m of the origin it is ±~1.4 m and smooth (h(0,0) = 0); beyond, soft hills up to ±25 m; the lake is a bowl.
//
//   world.env — restyle the world cheaply (all colour args: THREE.Color | 0xRRGGBB | 'css string'). Changes ease in over ~1.5 s. All methods return env.
//       setSkyColors({ zenith, horizon, mid? })  sky gradient (fog and light tint follow the horizon)
//       setFog(color|null|undefined, density?)   null = re-follow horizon, undefined = unchanged; density is FogExp2, clamped [0.0036, 0.05] (default ~0.0046)
//       setGrassColor(color)                     grass + ground tint
//       setTimeOfDay(t)                          0 = deep night (stars, aurora), 0.5 = twilight (default), 1 = golden hour. Resets custom sky/fog colours.
//       setStars(0..1)  setAurora(0..1)  setWind(0..1 | null = natural gusts)  setTransition(seconds; 0 = instant)
//       setWater({ color, level, enabled })      the lake: shallow tint, surface height (clamped [-2.0, -0.6], default -1.4), enabled:false hides it
//       isWater(x, z) -> boolean                 true where the lake covers the ground (keep things out of it / splash into it)
//     Read-only: env.wind, env.timeOfDay, env.passthrough, env.waterLevel, env.lake { x, z, radius }, env.palette (live colours, do not mutate), env.sunDirection.
//     Whole-place changes (terrain, ground palette, ocean, sky picture) belong to world.travel; do not call env.setTerrain / setGround / setOcean / setSkyPano yourself.
//   Restore anything you change when your creation is disposed (or use a library weather/time entry: night, dusk, day, rain, snow, storm, fog-bank, aurora restore themselves).

export const meta = { name: 'World', description: 'Endless twilight field, sky, grass, motes and distant stones' };

// ------------------------------------------------------------------ terrain function (module scope: pure)
function rawBase(x, z) {
  return 0.45 * Math.sin(x * 0.053 + 0.7) * Math.sin(z * 0.047 + 1.9)
    + 0.3 * Math.sin(x * 0.021 - z * 0.033 + 2.1)
    + 0.1 * Math.sin(x * 0.17 + z * 0.13);
}
const H0 = rawBase(0, 0);

// The lake: a gentle bowl carved into the terrain (the GLSL twin below must match).
const LAKE = { x: -30, z: -78, radius: 38, depth: 2.6, level: -1.4, minLevel: -2.0, maxLevel: -0.6 };

// ---- TRAVEL (core/travel.js): terrain CHARACTER parameters. All zero = the original twilight field, exactly. The GLSL twin
// below reads the same numbers from uniforms uTP0..2 (world.env.setTerrain keeps both in step and tells the physics owner through
// the event 'world:terrain-changed'). Every feature fades in beyond 4..30 m of the origin so the spawn spot stays gentle.
//   baseAmp  scale of the small undulations   = 1 + baseAmp      hillAmp  scale of the far hills      = 1 + hillAmp
//   dune     metres of long asymmetric dune ridges               crag     metres of ridged, craggy peaks
//   islandR  island radius in m (0 = no island; beyond it + islandW m the ground falls to -seaDepth, the coast wobbles)  lift  island plateau lift, m
//   canyon   metres of canyon wall height (a winding corridor ~75 m wide through the origin)
//   lakeScale  lake bowl depth = 1 + lakeScale (-1 = no lake bowl)
const TP = { baseAmp: 0, hillAmp: 0, dune: 0, crag: 0, islandR: 0, islandW: 60, seaDepth: 6, canyon: 0, lakeScale: 0, lift: 0, rev: 0 };
const TP_LIMITS = { baseAmp: [-1, 8], hillAmp: [-1, 4], dune: [0, 14], crag: [0, 30], islandR: [0, 400], islandW: [20, 160], seaDepth: [2, 30], canyon: [0, 90], lakeScale: [-1, 2], lift: [0, 6] };
const TP_DEFAULT = { baseAmp: 0, hillAmp: 0, dune: 0, crag: 0, islandR: 0, islandW: 60, seaDepth: 6, canyon: 0, lakeScale: 0, lift: 0 };
let terrainRevCount = 0;
const sstep = (a, b, x) => { const t = x < a ? 0 : (x > b ? 1 : (x - a) / (b - a)); return t * t * (3 - 2 * t); };
function duneField(x, z) {
  const q = (x * 0.89 + z * 0.46) * 0.035 + 1.7 * Math.sin((-x * 0.46 + z * 0.89) * 0.011);
  let d = 0.5 + 0.5 * Math.sin(q); d = d * d * (3 - 2 * d);
  const e = 0.5 + 0.5 * Math.sin((x * 0.2 + z * 0.98) * 0.09 + 2.0 * Math.sin(x * 0.013));
  return d + 0.35 * e - 0.6;
}
function cragField(x, z) {
  const a = 1 - Math.abs(Math.sin(x * 0.045 + Math.sin(z * 0.031) * 1.7));
  const b = 1 - Math.abs(Math.sin(z * 0.052 + Math.sin(x * 0.037) * 1.3 + 1.0));
  const c = 1 - Math.abs(Math.sin((x + z) * 0.11 + Math.sin(x * 0.07)));
  return a * a * b * b + 0.4 * c * c * a - 0.35;
}

// terrain without the lake bowl: the main terrain mesh is built from this (the lake gets its own finer patch)
function groundHeightBase(x, z) {
  let h = (rawBase(x, z) - H0) * (1 + TP.baseAmp);
  const r2 = x * x + z * z;
  if (r2 > 3600) {
    let t = (Math.sqrt(r2) - 60) / 200;
    if (t > 1) t = 1;
    const k = t * t * (3 - 2 * t);
    h += k * (14 * Math.sin(x * 0.0058 + 0.9) * Math.sin(z * 0.0067 + 2.2)
      + 8 * Math.sin(x * 0.0113 - z * 0.0091 + 4.0)
      + 2.5 * Math.sin(x * 0.027 + z * 0.021 + 1.0)) * (1 + TP.hillAmp);
  }
  if (TP.dune !== 0 || TP.crag !== 0 || TP.canyon !== 0 || TP.islandR > 0) {
    const r = Math.sqrt(r2);
    const pad = sstep(4, 30, r);
    if (TP.dune !== 0) h += TP.dune * pad * duneField(x, z);
    if (TP.crag !== 0) h += TP.crag * pad * cragField(x, z);
    if (TP.canyon !== 0) {
      const along = x * 0.8 + z * 0.6, lat = -x * 0.6 + z * 0.8 + 25 * Math.sin(along * 0.012);
      h += TP.canyon * sstep(38, 95, Math.abs(lat)) * (0.8 + 0.2 * Math.sin(along * 0.045 + Math.abs(lat) * 0.03));
    }
    if (TP.islandR > 0) {
      const ang = Math.atan2(z, x);
      const rr = r * (1 + 0.14 * Math.sin(ang * 3 + 1) + 0.08 * Math.sin(ang * 5 + 2.3) + 0.05 * Math.sin(ang * 9));
      const m = sstep(TP.islandR, TP.islandR + TP.islandW, rr);
      h += TP.lift * (1 - m);
      h += (-TP.seaDepth - h) * m;
    }
  }
  return h;
}

function lakeCarve(x, z) { // metres removed from the base terrain at (x, z)
  if (TP.lakeScale <= -1) return 0;
  const dx = x - LAKE.x, dz = z - LAKE.z, d2 = dx * dx + dz * dz;
  if (d2 >= LAKE.radius * LAKE.radius) return 0;
  const t = 1 - Math.sqrt(d2) / LAKE.radius;
  return LAKE.depth * (1 + TP.lakeScale) * t * t * (3 - 2 * t);
}

function groundHeight(x, z) {
  return groundHeightBase(x, z) - lakeCarve(x, z);
}

// Low-frequency 0..1 patchiness used to colour ground and grass identically (GLSL twin below).
function patchVal(x, z) {
  const a = Math.sin(x * 0.043 + 1.1) * Math.sin(z * 0.037 + 0.3);
  const b = Math.sin(x * 0.011 - z * 0.015 + 2.0);
  const c = Math.sin(x * 0.13 + z * 0.09);
  const v = 0.5 + 0.28 * a + 0.25 * b + 0.08 * c;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

// GLSL twins of groundHeight / patchVal (must be kept in sync with the JS above).
const TERRAIN_GLSL = /* glsl */`
uniform vec4 uTP0; // travel terrain character: baseAmp, hillAmp, dune, crag   (all 0 = the original field; see TP above)
uniform vec4 uTP1; // islandR, islandW, seaDepth, canyon
uniform vec4 uTP2; // lakeScale, lift, -, -
float tpDune(vec2 p) {
  float q = (p.x * 0.89 + p.y * 0.46) * 0.035 + 1.7 * sin((-p.x * 0.46 + p.y * 0.89) * 0.011);
  float d = 0.5 + 0.5 * sin(q); d = d * d * (3.0 - 2.0 * d);
  float e = 0.5 + 0.5 * sin((p.x * 0.2 + p.y * 0.98) * 0.09 + 2.0 * sin(p.x * 0.013));
  return d + 0.35 * e - 0.6;
}
float tpCrag(vec2 p) {
  float a = 1.0 - abs(sin(p.x * 0.045 + sin(p.y * 0.031) * 1.7));
  float b = 1.0 - abs(sin(p.y * 0.052 + sin(p.x * 0.037) * 1.3 + 1.0));
  float c = 1.0 - abs(sin((p.x + p.y) * 0.11 + sin(p.x * 0.07)));
  return a * a * b * b + 0.4 * c * c * a - 0.35;
}
float terrainH(vec2 p) {
  float h = (0.45 * sin(p.x * 0.053 + 0.7) * sin(p.y * 0.047 + 1.9)
          + 0.3 * sin(p.x * 0.021 - p.y * 0.033 + 2.1)
          + 0.1 * sin(p.x * 0.17 + p.y * 0.13)
          - ${H0.toFixed(6)}) * (1.0 + uTP0.x);
  float r = length(p);
  float t = clamp((r - 60.0) / 200.0, 0.0, 1.0);
  float k = t * t * (3.0 - 2.0 * t);
  h += k * (14.0 * sin(p.x * 0.0058 + 0.9) * sin(p.y * 0.0067 + 2.2)
          + 8.0 * sin(p.x * 0.0113 - p.y * 0.0091 + 4.0)
          + 2.5 * sin(p.x * 0.027 + p.y * 0.021 + 1.0)) * (1.0 + uTP0.y);
  if (uTP0.z != 0.0 || uTP0.w != 0.0 || uTP1.w != 0.0 || uTP1.x > 0.0) {
    float pad = smoothstep(4.0, 30.0, r);
    if (uTP0.z != 0.0) h += uTP0.z * pad * tpDune(p);
    if (uTP0.w != 0.0) h += uTP0.w * pad * tpCrag(p);
    if (uTP1.w != 0.0) {
      float along = p.x * 0.8 + p.y * 0.6;
      float lat = -p.x * 0.6 + p.y * 0.8 + 25.0 * sin(along * 0.012);
      h += uTP1.w * smoothstep(38.0, 95.0, abs(lat)) * (0.8 + 0.2 * sin(along * 0.045 + abs(lat) * 0.03));
    }
    if (uTP1.x > 0.0) {
      float ang = atan(p.y, p.x);
      float rr = r * (1.0 + 0.14 * sin(ang * 3.0 + 1.0) + 0.08 * sin(ang * 5.0 + 2.3) + 0.05 * sin(ang * 9.0));
      float m = smoothstep(uTP1.x, uTP1.x + uTP1.y, rr);
      h += uTP2.y * (1.0 - m);
      h += (-uTP1.z - h) * m;
    }
  }
  vec2 lq = p - vec2(${LAKE.x.toFixed(1)}, ${LAKE.z.toFixed(1)});
  float ld2 = dot(lq, lq);
  if (ld2 < ${(LAKE.radius * LAKE.radius).toFixed(1)}) {
    float lt = 1.0 - sqrt(ld2) / ${LAKE.radius.toFixed(1)};
    h -= ${LAKE.depth.toFixed(3)} * (1.0 + uTP2.x) * lt * lt * (3.0 - 2.0 * lt);
  }
  return h;
}
float patchVal(vec2 p) {
  float a = sin(p.x * 0.043 + 1.1) * sin(p.y * 0.037 + 0.3);
  float b = sin(p.x * 0.011 - p.y * 0.015 + 2.0);
  float c = sin(p.x * 0.13 + p.y * 0.09);
  return clamp(0.5 + 0.28 * a + 0.25 * b + 0.08 * c, 0.0, 1.0);
}
`;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ shaders
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uFocus;
uniform float uTime;
uniform float uStars;
uniform float uAurora;
uniform float uSat; // colour lift from world.style (0 = none)
uniform float uSkyQ; // perf: 0 gradient only, 1 stars + aurora + thin clouds, 2 (PC) everything
// travel: a generated equirectangular panorama replaces the procedural gradient/clouds (uPanoMix 0 = off: the original sky, bit for bit)
uniform sampler2D uPano;
uniform float uPanoMix;   // 0..1 (eased by world.js)
uniform vec4 uPanoP;      // x yaw (turns), y vertical offset (turns of latitude: puts the picture's horizon on the true one), z haze 0..1, w exposure
#ifdef SKY_PC
uniform vec3 uSunDir;
#endif
varying vec3 vDir;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);

  // perf: below the horizon the terrain hides the dome. Output the horizon colour (same as the full path at h = 0) and skip
  // the stars / aurora / clouds: on a mobile GPU the dome is shaded for every pixel of the view before the terrain overdraws it.
  if (d.y < -0.04) {
    vec3 c0 = uHorizon * (1.0 + 0.35 * pow(max(dot(normalize(d.xz + vec2(0.0001)), vec2(0.0, -1.0)), 0.0), 3.0));
    c0 = max(mix(vec3(dot(c0, vec3(0.2126, 0.7152, 0.0722))), c0, 1.0 + uSat), vec3(0.0));
    gl_FragColor = vec4(c0, 1.0);
    #include <colorspace_fragment>
    return;
  }

  // base gradient: warm horizon band -> mid -> deep zenith
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
  col = mix(col, uZenith, smoothstep(0.12, 0.9, h));

  // faint warm glow along the horizon on the side the light comes from (-Z)
  float side = max(dot(normalize(d.xz + vec2(0.0001)), vec2(0.0, -1.0)), 0.0);
  float pm = 1.0 - uPanoMix; // travel: the panorama carries its own glow
  col += uHorizon * 0.35 * pow(side, 3.0) * exp(-h * 8.0) * pm;
#ifdef SKY_PC
  // sun-facing horizon glow: a broad warm bloom plus a tighter hot core hugging the horizon
  float sdot = max(dot(d, uSunDir), 0.0);
  col += uHorizon * 0.85 * pow(sdot, 5.0) * exp(-h * 6.0) * pm;
  col += (uHorizon * 1.5 + vec3(0.025, 0.02, 0.012)) * 0.8 * pow(sdot, 40.0) * exp(-h * 2.0) * pm;
#endif

  // keep the region around the Omnissiah quiet and slightly darker so it pops
  float foc = dot(d, uFocus);
  float calm = 1.0 - smoothstep(0.80, 0.94, foc);

  // travel: the generated panorama. Looked up with textureGrad and a wrap-safe derivative so there is no mip line at the +-180 degree seam.
  float panoLum = 0.0;
  if (uPanoMix > 0.002) {
    vec2 puv = vec2(atan(d.x, -d.z) * 0.15915494 + 0.5 + uPanoP.x, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5 + uPanoP.y);
    vec2 pdx = dFdx(puv), pdy = dFdy(puv);
    vec2 pb = vec2(fract(puv.x + 0.5), puv.y);
    vec2 bdx = dFdx(pb), bdy = dFdy(pb);
    if (abs(bdx.x) + abs(bdy.x) < abs(pdx.x) + abs(pdy.x)) { pdx = bdx; pdy = bdy; }
    vec3 pc = textureGrad(uPano, puv, pdx, pdy).rgb * uPanoP.w;
    // haze: toward the fog colour at the horizon (the terrain's far edge is that colour), so the picture's own ground never shows a seam
    pc = mix(pc, uHorizon, uPanoP.z * (1.0 - smoothstep(0.0, 0.10, d.y)));
    pc = mix(uHorizon, pc, smoothstep(-0.04, 0.012, d.y));
    // the Omnissiah's region: darker and quieter (the picture is dimmed there, not erased)
    float zone = 1.0 - calm;
    float pl = dot(pc, vec3(0.2126, 0.7152, 0.0722));
    pc = mix(pc, vec3(pl), 0.55 * zone) * (1.0 - 0.32 * zone);
    panoLum = pl;
    col = mix(col, pc, uPanoMix);
  }
  col *= 1.0 - 0.22 * (1.0 - calm) * pm;

  if (uSkyQ > 0.5 && (uStars > 0.01 || uPanoMix < 0.5)) { // perf: stars, milky way, aurora and clouds are skipped entirely at sky level 0 (uniform branch, no recompile)
  // stars (cell hash on the direction vector) + a faint milky band
  float sv = smoothstep(0.02, 0.3, d.y) * (1.0 - uPanoMix * smoothstep(0.02, 0.25, panoLum)); // (travel: stars sit behind the picture's bright parts)
  vec3 sp = d * 64.0;
  vec3 cell = floor(sp);
  vec3 fp = sp - cell;
  float rnd = hash31(cell);
  vec3 spos = vec3(hash31(cell + 17.0), hash31(cell + 41.0), hash31(cell + 73.0)) * 0.6 + 0.2;
  float sdist = length(fp - spos);
  float ssize = 0.10 + 0.10 * hash31(cell + 5.0);
  float star = (1.0 - smoothstep(0.0, ssize, sdist)) * step(0.955, rnd);
  float tw = 0.7 + 0.3 * sin(uTime * (1.0 + 3.0 * hash31(cell + 9.0)) + 40.0 * hash31(cell + 3.0));
  vec3 scol = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.82, 0.65), hash31(cell + 29.0));
#ifdef SKY_PC
  col += scol * star * tw * uStars * sv * calm * 1.0; // PC: brighter primary stars + a finer, dimmer second layer + glints
  if (uSkyQ > 1.5) {
    vec3 sp2 = d * 150.0;
    vec3 cell2 = floor(sp2);
    vec3 fp2 = sp2 - cell2;
    float r2s = hash31(cell2 + 11.0);
    vec3 pos2 = vec3(hash31(cell2 + 3.0), hash31(cell2 + 19.0), hash31(cell2 + 57.0)) * 0.6 + 0.2;
    float star2 = (1.0 - smoothstep(0.0, 0.11, length(fp2 - pos2))) * step(0.93, r2s);
    col += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.9, 0.75), hash31(cell2 + 8.0)) * star2 * (0.5 + 0.5 * tw) * uStars * sv * calm * 0.55;
    float bright = step(0.985, rnd) * (1.0 - smoothstep(0.0, 0.5, sdist));
    vec2 gl = abs(fp.xy - spos.xy);
    col += scol * bright * (0.35 + 0.65 * tw) * uStars * sv * calm * 0.55 * (0.6 + exp(-min(gl.x, gl.y) * 28.0));
  }
#else
  col += scol * star * tw * uStars * sv * calm * 1.3;
#endif
  float mwBand = dot(d, vec3(0.35, 0.55, 0.76));
  float mw = exp(-mwBand * mwBand * 18.0) * (0.04 + 0.08 * vnoise(sp.xz * 0.3 + sp.y * 0.17));
  col += vec3(0.55, 0.5, 0.85) * mw * uStars * sv * calm;

  // aurora ribbon (periodic in azimuth -> no seam), kept away from the Omnissiah
  if (uAurora > 0.01) {
  float az = atan(d.z, d.x);
  float cen = 0.26 + 0.06 * sin(az * 3.0 + uTime * 0.04) + 0.03 * sin(az * 5.0 - uTime * 0.06) + 0.02 * sin(az * 8.0 + uTime * 0.1);
  float wid = 0.07 + 0.025 * sin(az * 2.0 + 1.0);
  float u = (d.y - cen) / wid;
  float band = exp(-u * u * (u < 0.0 ? 4.0 : 0.8));
  float streak = 0.55 + 0.45 * sin(az * 36.0 + 3.0 * sin(az * 5.0 + uTime * 0.15) + uTime * 0.25);
  float pulse = 0.65 + 0.35 * sin(az * 2.0 - uTime * 0.08 + 1.5);
  vec3 acol = mix(vec3(0.15, 0.95, 0.65), vec3(0.55, 0.30, 0.95), smoothstep(-0.5, 2.0, u));
  col += acol * band * streak * pulse * 0.30 * uAurora * calm * smoothstep(0.0, 0.06, d.y);
  }

  // thin, distant, stretched clouds
  if (uPanoMix < 0.98) { // (travel: the panorama has its own clouds)
  vec2 cuv = d.xz / (h + 0.14) * 1.4 + vec2(uTime * 0.006, uTime * 0.0035);
  float cl = fbm(cuv * vec2(1.0, 2.6));
  cl = smoothstep(0.50, 0.82, cl) * smoothstep(0.015, 0.14, d.y) * (1.0 - smoothstep(0.55, 0.95, d.y)) * calm * pm;
  vec3 ccol = mix(uHorizon, uMid, 0.35) * 1.5 + vec3(0.03);
  col = mix(col, ccol, cl * 0.35);
  }
#ifdef SKY_PC
  // PC: a second, lower and softer cloud bank lit from the sun side, plus high cirrus streaks
  if (uSkyQ > 1.5 && uPanoMix < 0.98) {
    vec2 cuv2 = d.xz / (h + 0.30) * 0.85 + vec2(-uTime * 0.0045, uTime * 0.0028) + vec2(7.0, 3.0);
    float c2 = smoothstep(0.50, 0.86, fbm(cuv2 * vec2(1.0, 1.7)));
    c2 *= smoothstep(0.02, 0.17, d.y) * (1.0 - smoothstep(0.45, 0.85, d.y)) * calm;
    float lit = pow(max(dot(normalize(vec3(d.x, d.y * 0.4, d.z)), uSunDir), 0.0), 2.0);
    vec3 c2col = mix(uMid, uHorizon, 0.35 + 0.65 * lit) * (1.05 + 0.5 * lit) + uHorizon * lit * 0.25;
    col = mix(col, c2col, c2 * 0.4);
    vec2 cuv3 = d.xz / (h + 0.55) * vec2(2.4, 0.6) + vec2(uTime * 0.002, 0.0) + vec2(21.0, 5.0);
    float c3 = smoothstep(0.55, 0.9, fbm(cuv3 * vec2(1.0, 3.5)));
    c3 *= smoothstep(0.12, 0.35, d.y) * (1.0 - smoothstep(0.7, 0.98, d.y)) * calm;
    col = mix(col, mix(uHorizon, uMid, 0.5) * 1.35 + vec3(0.04), c3 * 0.22);
  }
#endif
  } // uSkyQ

  col = max(col, vec3(0.0));
  col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.0 + uSat), vec3(0.0));
  col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0; // dither against banding
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// GRASS_PC (defined on the PC tier): tall-tuft layer parameters + sun shadow lookup (the grass receives the sun's
// shadow map like the terrain does). GRASS_LOD (Quest tier): far tufts collapse to one wider blade (second, 3-vertex mesh).
// perf: everything that depends only on where a tuft stands (ground height, height variation, patch colour value, yaw) is computed
// on the CPU when the tuft enters the draw list (see makeGrassLayer), not 9 x per frame x 2 eyes in this shader.
const GRASS_VERT = /* glsl */`
#ifdef GRASS_SHADOW
#include <common>
#include <shadowmap_pars_vertex>
#endif
#ifdef GRASS_PC
uniform float uHeightMul;
uniform float uWidthMul;
uniform vec3 uTipCol;
uniform float uTipMix;
#endif
#ifdef GRASS_LOD
uniform vec2 uLod; // distances where a tuft's 2nd and 3rd blades are gone (x: start of the collapse, y: end)
#endif
uniform float uWaterLevel;
uniform float uSat;
attribute vec4 aW; // per tuft: world x, world z, ground height, base blade height
attribute vec4 aS; // per tuft: cos(yaw), sin(yaw), random 0..1, ground patch value 0..1
attribute float aBlade; // which blade of the tuft this vertex belongs to
uniform vec2 uCenter;
uniform float uTime;
uniform float uWind;
uniform float uFadeNear;
uniform float uFadeFar;
uniform float uGrow;
uniform vec3 uGrassA;
uniform vec3 uGrassB;
uniform vec3 uLight;
uniform vec3 uTint;
uniform vec3 uToLight;
uniform vec3 uRimCol;
uniform sampler2D uMask;
uniform vec4 uMaskRect; // centre x, centre z, 1 / size, enabled
varying vec3 vColor;
varying float vFogDepth;
void main() {
  vec2 w = aW.xy;
  float dist = length(w - uCenter);
  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, dist);
#ifdef GRASS_LOD
  float lodK = smoothstep(uLod.x, uLod.y, dist);
  if (aBlade > 0.5) fade *= 1.0 - lodK;
#endif
  // beyond the fade distance (the list keeps a margin) or a collapsed blade: nothing to draw
  if (fade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); vFogDepth = 0.0; return; }
  float gy = aW.z;
  fade *= smoothstep(uWaterLevel, uWaterLevel + 0.14, gy); // nothing grows underwater
  // optional mask (roads, clearings): white texels flatten the grass
  if (uMaskRect.w > 0.5) {
    vec2 muv = (w - uMaskRect.xy) * uMaskRect.z + 0.5;
    float mIn = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
    fade *= 1.0 - mIn * smoothstep(0.25, 0.6, texture2D(uMask, clamp(muv, 0.0, 1.0)).r);
  }
  fade *= uGrow;

  float cs = aS.x;
  float sn = aS.y;
  float hv = aW.w;
#ifdef GRASS_PC
  hv *= uHeightMul;
  fade *= uHeightMul > 1.0 ? smoothstep(2.0, 5.5, dist) : 1.0; // tall tufts keep clear of the player's face
  vec2 lq = vec2(position.x * cs - position.z * sn, position.x * sn + position.z * cs) * uWidthMul;
#else
  vec2 lq = vec2(position.x * cs - position.z * sn, position.x * sn + position.z * cs);
#endif
#ifdef GRASS_LOD
  hv *= 1.0 + 0.12 * lodK; // the far single blade is a little taller and wider than one blade of a near tuft
  lq *= 1.0 + 0.5 * lodK;
#endif
  float height = hv * fade;
  vec2 lp = lq * (0.5 + 0.5 * fade);
  float y01 = position.y;
  float bend = y01 * y01;

  float g = 0.5 + 0.5 * sin(w.x * 0.09 + w.y * 0.06 - uTime * 0.9);
  float flutter = sin(uTime * 2.3 + w.x * 0.8 + w.y * 0.6 + aS.z * 6.2831853);
  vec2 wdir = vec2(0.8, 0.6);
  vec2 disp = wdir * ((0.12 + 0.25 * g) * (0.4 + 0.9 * uWind)) + vec2(-wdir.y, wdir.x) * flutter * 0.05;

  vec3 wp = vec3(w.x + lp.x, gy + y01 * height - 0.02, w.y + lp.y);
  wp.xz += disp * (bend * height);

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vFogDepth = -mv.z;
#ifdef GRASS_SHADOW
  {
    vec3 transformedNormal = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    vec4 worldPosition = vec4(wp.x, gy + 0.06 + 0.25 * y01 * height, wp.z, 1.0); // sample the shadow near the ground: whole tuft shares one verdict
    #include <shadowmap_vertex>
  }
#endif

  vec3 base = mix(uGrassA, uGrassB, aS.w);
  vec3 c = base * mix(0.5, 1.4, y01) * (0.82 + 0.36 * aS.z);
  c *= uLight;
  c = mix(c, uTint * 0.5, 0.10 * y01);
  vec3 vd = normalize(wp - cameraPosition);
  float rm = max(dot(vd, uToLight), 0.0);
  float rim = rm * rm * rm * y01;
  c += uRimCol * rim * 0.35;
#ifdef GRASS_PC
  c = mix(c, uTipCol * uLight * (0.8 + 0.5 * aS.z), uTipMix * smoothstep(0.35, 1.0, y01));
#endif
  c = max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, 1.0 + uSat), vec3(0.0));
  vColor = c;
}
`;

const GRASS_FRAG = /* glsl */`
#ifdef GRASS_SHADOW
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
uniform vec3 uSunFrac; // fraction of the grass' light that comes from the sun (the rest is sky fill)
#endif
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec3 vColor;
varying float vFogDepth;
void main() {
  vec3 col = vColor;
#ifdef GRASS_SHADOW
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
  {
    DirectionalLightShadow dls = directionalLightShadows[0];
    float sh = receiveShadow ? getShadow(directionalShadowMap[0], dls.shadowMapSize, dls.shadowIntensity, dls.shadowBias, dls.shadowRadius, vDirectionalShadowCoord[0]) : 1.0;
    col *= 1.0 - uSunFrac * (1.0 - sh);
  }
  #endif
#endif
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  gl_FragColor = vec4(mix(col, uFogColor, clamp(f, 0.0, 1.0)), 1.0);
  #include <colorspace_fragment>
}
`;

const GLOW_VERT = /* glsl */`
attribute vec4 aSeed;
uniform vec2 uCenter;
uniform float uPatch;
uniform float uTime;
uniform float uFadeNear;
uniform float uFadeFar;
uniform float uFogDensity;
uniform float uWaterLevel;
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
${TERRAIN_GLSL}
void main() {
  vec2 o = aSeed.xy * uPatch;
  vec2 w = o + uPatch * floor((uCenter - o) / uPatch + 0.5);
  float dist = length(w - uCenter);
  float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, dist);

  float kind = step(0.8, aSeed.z);               // 1 = firefly (drifts), 0 = glowing flower (rooted)
  float gh = terrainH(w);                         // (perf: once, not twice)
  fade *= max(kind, smoothstep(uWaterLevel, uWaterLevel + 0.14, gh)); // flowers do not bloom underwater
  float ph = aSeed.w * 51.0 + aSeed.z * 13.0;
  float t = uTime;
  vec3 wp = vec3(w.x, gh, w.y);
  vec3 flowerOff = vec3(0.0, 0.22 + 0.3 * aSeed.w, 0.0);
  vec3 flyOff = vec3(sin(t * 0.31 + ph) * 1.6 + sin(t * 0.77 + ph * 2.0) * 0.5,
                     0.9 + 1.7 * aSeed.w + 0.35 * sin(t * 0.5 + ph * 3.0),
                     cos(t * 0.27 + ph * 1.3) * 1.6 + cos(t * 0.61 + ph) * 0.5);
  wp += mix(flowerOff, flyOff, kind);

  float blink = mix(0.75 + 0.25 * sin(t * 1.3 + ph),
                    smoothstep(0.1, 0.9, 0.5 + 0.5 * sin(t * (1.1 + aSeed.w) + ph * 2.0)),
                    kind);
  float size = mix(0.16, 0.13, kind) * (0.7 + 0.6 * fract(aSeed.w * 13.7)) * (0.4 + 0.6 * fade);

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * mv.z * mv.z);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;

  float s = fract(aSeed.w * 7.13);
  vec3 col = mix(vec3(0.25, 0.9, 1.0), vec3(1.0, 0.35, 0.75), step(0.4, s));
  col = mix(col, vec3(1.0, 0.8, 0.35), step(0.75, s));
  col = mix(col, vec3(0.85, 1.0, 0.45), kind * 0.85);

  vUv = position.xy;
  vCol = col;
  vAlpha = fade * blink * (1.0 - fogF);
}
`;

const GLOW_FRAG = /* glsl */`
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
void main() {
  float d = length(vUv);
  float halo = exp(-d * d * 4.5);
  float core = 1.0 - smoothstep(0.0, 0.30, d);
  float a = (halo * 0.55 + core * 0.9) * (1.0 - smoothstep(0.75, 1.0, d)) * vAlpha;
  gl_FragColor = vec4(vCol, a);
  #include <colorspace_fragment>
}
`;

// Passthrough floor cue: motes lying flat on the floor (y = 0.01) on a soft-edged ring around uCenter.
// Fragment stage is GLOW_FRAG (varyings vUv, vCol, vAlpha).
const CUE_VERT = /* glsl */`
attribute vec4 aSeed;
uniform vec2 uCenter;
uniform float uTime;
uniform float uRing;
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
void main() {
  float ang = aSeed.x * 6.2831853 + uTime * 0.03;
  float jr = aSeed.y + aSeed.z - 1.0;                     // -1..1, triangular: dense on the ring, thin at its edges
  float r = uRing + jr * 0.3;
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(jr));
  float size = 0.025 + 0.045 * aSeed.w;
  vec3 wp = vec3(uCenter.x + cos(ang) * r, 0.01, uCenter.y + sin(ang) * r);
  wp.xz += position.xy * size;
  float tw = 0.5 + 0.5 * sin(uTime * (0.35 + aSeed.w) + aSeed.z * 40.0);
  vAlpha = uAlpha * edge * (0.35 + 0.65 * tw * tw);
  vUv = position.xy;
  vCol = mix(vec3(1.0, 0.8, 0.5), vec3(0.65, 0.6, 1.0), step(0.5, fract(aSeed.w * 7.13)));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

// ------------------------------------------------------------------ water + mist
const NOISE_GLSL = /* glsl */`
float wHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float wFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * wNoise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
  return v;
}
`;

const FLATWORLD_VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Stylised lake. Depth comes from the analytic bowl (terrainH twin), so the shore line is exact, not a depth-buffer
// guess. No render targets: the "reflection" is the sky gradient looked up along the reflected ray (+ sun glitter and
// the fractal's glow as analytic highlights on PC). Transparent, normal blending, hidden in passthrough.
const WATER_FRAG = /* glsl */`
uniform float uTime;
uniform float uLevel;
uniform float uWind;
uniform float uFogDensity;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform vec3 uLight;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uFocus;
uniform vec3 uGlowCol;
uniform float uSat;
uniform float uLite; // perf: 1 = cheap water (perf.js quality.water = 1)
varying vec3 vWorld;
${TERRAIN_GLSL}
${NOISE_GLSL}
vec3 skyAt(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
  c = mix(c, uZenith, smoothstep(0.12, 0.9, h));
  float side = max(dot(normalize(d.xz + vec2(0.0001)), vec2(0.0, -1.0)), 0.0);
  c += uHorizon * 0.35 * pow(side, 3.0) * exp(-h * 8.0);
  return c;
}
void main() {
  vec2 p = vWorld.xz;
  float depth = uLevel - terrainH(p);
  if (depth <= 0.0) discard;
  float t = uTime;
  float calm = smoothstep(0.0, 0.7, depth);                 // ripples die out at the very shore
  float amp = (0.55 + 0.9 * uWind) * (0.35 + 0.65 * calm);
  vec2 g = vec2(0.0);
  g += vec2(0.80, 0.60) * cos(dot(p, vec2(0.80, 0.60)) * 1.3 + t * 0.90) * 0.034;
  g += vec2(-0.50, 0.87) * cos(dot(p, vec2(-0.50, 0.87)) * 2.3 - t * 1.30) * 0.022;
  if (uLite < 0.5) { // perf: the lite lake keeps the two long swells and skips the small ripples + noise
    g += vec2(0.95, -0.30) * cos(dot(p, vec2(0.95, -0.30)) * 4.1 + t * 1.80) * 0.012;
    g += vec2(-0.20, -0.98) * cos(dot(p, vec2(-0.20, -0.98)) * 7.3 - t * 2.40) * 0.006;
    g += (vec2(wNoise(p * 1.1 + t * 0.15), wNoise(p * 1.1 - t * 0.12 + 9.0)) - 0.5) * 0.04;
  }
  g *= amp;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 toEye = cameraPosition - vWorld;
  vec3 V = normalize(toEye);
  float ndv = max(dot(n, V), 0.0);
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  vec3 refl = skyAt(normalize(R));

  vec3 body = mix(uShallow, uDeep, 1.0 - exp(-depth * 0.85)) * (0.28 + 0.62 * uLight);
  float fres = mix(0.05, 1.0, pow(1.0 - ndv, 4.0));
  vec3 col = mix(body, refl, fres);
#ifdef WATER_PC
  float sd = max(dot(R, uSunDir), 0.0);
  col += uSunCol * (pow(sd, 260.0) * 3.0 + pow(sd, 22.0) * 0.28) * (0.4 + 0.6 * fres);
  float fo = max(dot(R, uFocus), 0.0);
  col += uGlowCol * (pow(fo, 70.0) * 1.8 + pow(fo, 10.0) * 0.18) * (0.3 + 0.7 * fres);
#endif
  float a = mix(0.34, 0.96, 1.0 - exp(-depth * 1.9));
  a = max(a, fres * 0.95);

  // foam: a bright rim lapping at the waterline plus drifting lace in the shallows
  float wob = 0.5 + 0.5 * sin(dot(p, vec2(0.7, 0.7)) * 2.3 - t * 0.9 + sin(p.x * 0.6 + t * 0.5) * 1.5);
  float rim = 1.0 - smoothstep(0.0, 0.07 + 0.09 * wob, depth);
  float lace = 0.0;
  if (uLite < 0.5) lace = (1.0 - smoothstep(0.04, 0.4, depth)) * smoothstep(0.62, 0.9, wNoise(p * 3.1 + vec2(t * 0.22, -t * 0.14))) * 0.45;
  float foam = clamp(rim + lace, 0.0, 1.0);
  col = mix(col, mix(uHorizon, vec3(1.0), 0.55) * (0.55 + 0.45 * uLight), foam * 0.85);
  a = max(a, foam * 0.9);
  a *= smoothstep(0.0, 0.03, depth);

  col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.0 + uSat), vec3(0.0));
  float vz = -(viewMatrix * vec4(vWorld, 1.0)).z;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vz * vz);
  gl_FragColor = vec4(mix(col, uFogColor, clamp(f, 0.0, 1.0)), a);
  #include <colorspace_fragment>
}
`;

// Ground mist (PC): a flat sheet at a fixed world height; opacity comes from how far the ground sits below it,
// so it pools in hollows and over the lake and thins to nothing on rises. Hidden in passthrough.
const MIST_FRAG = /* glsl */`
uniform float uTime;
uniform float uTop;
uniform float uRadius;
uniform float uAlpha;
uniform float uFogDensity;
uniform vec2 uCenter;
uniform vec3 uColor;
uniform vec3 uFogColor;
varying vec3 vWorld;
${TERRAIN_GLSL}
${NOISE_GLSL}
void main() {
  vec2 p = vWorld.xz;
  float depth = uTop - terrainH(p);
  float dens = smoothstep(0.0, 1.1, depth);
  float n = wFbm(p * 0.032 + vec2(uTime * 0.011, uTime * 0.006));
  dens *= 0.25 + 1.1 * n * n;
  dens *= 1.0 - smoothstep(0.5 * uRadius, uRadius, length(p - uCenter));
  dens *= smoothstep(4.0, 20.0, length(cameraPosition - vWorld));
  float a = clamp(dens * uAlpha, 0.0, 0.5);
  if (a < 0.003) discard;
  float vz = -(viewMatrix * vec4(vWorld, 1.0)).z;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vz * vz);
  gl_FragColor = vec4(mix(uColor, uFogColor, clamp(f, 0.0, 1.0)), a * (1.0 - 0.6 * f));
  #include <colorspace_fragment>
}
`;

// Terrain detail (PC): world-space noise breaks up the vertex-colour albedo and adds a fine procedural bump,
// injected into the Lambert terrain material (the terrain itself already has plenty of vertices).
const TERRAIN_DETAIL_PARS = /* glsl */`
varying vec3 vTWorld;
uniform float uTD; // perf: 0 skips the detail noise + bump (perf.js quality.terrainDetail)
float tdHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tdNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tdHash(i), tdHash(i + vec2(1.0, 0.0)), f.x), mix(tdHash(i + vec2(0.0, 1.0)), tdHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float tdHeight(vec2 p) { return tdNoise(p * 2.7) * 0.6 + tdNoise(p * 7.3 + 5.0) * 0.3 + tdNoise(p * 19.0 + 11.0) * 0.1; }
`;

// ------------------------------------------------------------------ module
export default function (ctx) {
  const { THREE, scene, root, rig, player, input, renderer } = ctx;
  const { Color, Vector2, Vector3 } = THREE;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const keep = ctx.state; // survives hot reloads

  let pt = false; // mixed-reality (passthrough) mode, see setPT()
  // The service: terrain height, or a flat floor at y = 0 in passthrough. The module-level groundHeight()
  // stays the pure terrain function (mesh vertices, stones, grass shader twin).
  ctx.provide('groundHeight', (x, z) => (pt ? 0 : groundHeight(x, z)));

  // ---- tunables
  const Q = ctx.quality || { tier: 'quest', pc: false, shadows: false, density: 1, detail: 1 };
  const PC = !!Q.pc;
  const R_MAX = 480, RING_POW = 1.7;
  const RINGS = PC ? 128 : 80, SEGS = PC ? 240 : 144; // PC: finer terrain near the player
  const RECENTER_DIST = 32, RECENTER_SNAP = 16;
  const GRASS_VR = 22000, GRASS_DESKTOP = 46000, GRASS_PATCH_VR = 38, GRASS_PATCH_DESKTOP = 56;
  // PC: density multiplier on the headset grass density, over a larger patch (longer draw distance)
  const GRASS_PATCH_PC = 66;
  // perf: sized from the tier's own base density (2.5 on PC), not the live quality.density that core/perf.js scales under load;
  // the live knob is quality.grass (0..1 of these counts)
  const DENS0 = PC ? 2.5 : 1;
  const GRASS_PC = Math.round((GRASS_VR / (GRASS_PATCH_VR * GRASS_PATCH_VR)) * DENS0 * GRASS_PATCH_PC * GRASS_PATCH_PC);
  const TUFT_PATCH_PC = 84, TUFT_PC = Math.round(1.4 * TUFT_PATCH_PC * TUFT_PATCH_PC * DENS0 / 2.5);
  const GLOW_VR = 360, GLOW_DESKTOP = 900, GLOW_PATCH = 56;
  const SKY_RADIUS = 1500;
  const LAKE_HOLE = LAKE.radius + 1, LAKE_PATCH = LAKE.radius + 3, LAKE_CELL = 1.25;
  const SHADOW_HALF = 45, SHADOW_MAP = 4096;
  const MIST_TOP = -0.3, MIST_RADIUS = 140;
  const OCEAN_SIZE = 3200; // travel: side of the water quad that follows the player when the ocean is on

  // ---- palette / environment state ----------------------------------------------------
  const mkKF = (o) => ({
    zenith: new Color(o.z), mid: new Color(o.m), horizon: new Color(o.h),
    hemiSky: new Color(o.hs), hemiGround: new Color(o.hg), dirCol: new Color(o.d),
    hemiI: o.hi, dirI: o.di, fogD: o.fd, stars: o.st, aurora: o.au,
  });
  const KF = [
    // night
    mkKF({ z: 0x03040f, m: 0x0b0f2e, h: 0x1f1a46, hs: 0x2e3a78, hg: 0x0a0a16, hi: 0.7, d: 0x7080d8, di: 0.45, fd: 0.0050, st: 1.0, au: 0.95 }),
    // twilight (default)
    mkKF({ z: 0x120f3a, m: 0x4a2a6c, h: 0xe0875c, hs: 0x8a78b8, hg: 0x3c2a3c, hi: 1.3, d: 0xffb07a, di: 1.4, fd: 0.0046, st: 0.6, au: 0.6 }),
    // golden hour
    mkKF({ z: 0x2a3578, m: 0xa8507c, h: 0xffb36b, hs: 0x9a90c8, hg: 0x5a4232, hi: 1.4, d: 0xffc07a, di: 1.8, fd: 0.0042, st: 0.12, au: 0.15 }),
  ];
  const COLOR_KEYS = ['zenith', 'mid', 'horizon', 'hemiSky', 'hemiGround', 'dirCol'];
  const NUM_KEYS = ['hemiI', 'dirI', 'fogD', 'stars', 'aurora'];
  const mkState = () => ({
    zenith: new Color(), mid: new Color(), horizon: new Color(), fog: new Color(),
    hemiSky: new Color(), hemiGround: new Color(), dirCol: new Color(),
    hemiI: 1, dirI: 1, fogD: 0.0046, stars: 0.6, aurora: 0.6,
  });
  const cur = mkState(); // what is rendered
  const tgt = mkState(); // where it is easing to
  const WHITE = new Color(1, 1, 1);
  let tod = 0.5, skyCustom = false, fogCustom = false, easeSeconds = 1.5, windOverride = null;

  const setC = (target, v) => { if (v && v.isColor) target.copy(v); else target.set(v); };

  function applyTOD(t) {
    tod = clamp(t, 0, 1);
    let A, B, u;
    if (tod < 0.5) { A = KF[0]; B = KF[1]; u = tod * 2; } else { A = KF[1]; B = KF[2]; u = (tod - 0.5) * 2; }
    for (const k of COLOR_KEYS) tgt[k].lerpColors(A[k], B[k], u);
    for (const k of NUM_KEYS) tgt[k] = A[k] + (B[k] - A[k]) * u;
    if (!fogCustom) tgt.fog.copy(tgt.horizon);
  }
  function deriveSkyLights() {
    tgt.hemiSky.copy(tgt.mid).lerp(WHITE, 0.25);
    tgt.dirCol.copy(tgt.horizon).lerp(WHITE, 0.3);
    tgt.hemiGround.copy(tgt.horizon).multiplyScalar(0.3);
  }
  applyTOD(0.5);
  for (const k of COLOR_KEYS) cur[k].copy(tgt[k]);
  cur.fog.copy(tgt.fog);
  for (const k of NUM_KEYS) cur[k] = tgt[k];

  // ground / grass palette (linear Color objects, referenced live by the grass shader)
  const gA = new Color(0x2f6b55), gB = new Color(0x8aa04a), gF = new Color(0x3b3a5a);
  const uLight = new Color(), uRim = new Color(), tmpC = new Color();
  // travel: extra ground colours. rock: where the ground rises above rockFrom..rockTo metres (rockAmt 0 = off); sand: the shore line
  // (the lake's own shore always uses it; shoreAll extends it to every waterline, for oceans); gFarMix: how far the distant tint reaches.
  const gRock = new Color(0x6b6670), gSand = new Color(0.50, 0.41, 0.26);
  const gnd = { rockAmt: 0, rockFrom: 2, rockTo: 9, shoreAll: false, lakeShore: true, farMix: 0.5 };

  // ---- scene fog / background -----------------------------------------------------------
  const prevBg = scene.background, prevFog = scene.fog;
  const fog = new THREE.FogExp2(cur.fog.getHex(), cur.fogD);
  scene.fog = fog;
  scene.background = cur.horizon; // live reference; the sky dome covers it anyway

  // ---- lights -----------------------------------------------------------------------------
  const L = new Vector3(-0.25, 0.28, -1).normalize(); // direction towards the low sun
  const Lt = L.clone();                               // travel: where L is easing to (env.setLight)
  Object.assign(TP, { baseAmp: 0, hillAmp: 0, dune: 0, crag: 0, islandR: 0, islandW: 60, seaDepth: 6, canyon: 0, lakeScale: 0, lift: 0 }); // a (re)loaded world starts as the field
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.position.copy(L).multiplyScalar(100);
  root.add(hemi, sun, sun.target);
  const sunDir = L.clone();      // current direction towards the light (L, blended towards the passthrough key light)
  const shTarget = new Vector3(); // where the shadow window is centred (texel-snapped)
  const shRight = new Vector3(), shUp = new Vector3();
  if (PC && Q.shadows !== false) {
    // PC: the sun casts a real shadow map over a window that follows the player. The window is snapped to whole
    // shadow texels in light space every frame, so shadow edges never shimmer while walking.
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
    sc.near = 20; sc.far = 330;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2.2;
  }
  const SHADOWS = sun.castShadow;
  let shadowPx = SHADOW_MAP; // current shadow map size (perf: live, 0 = shadow pass off)
  // perf: live shadow size. Toggling castShadow would recompile every lit material, so "off" = no shadow pass + zero intensity.
  function applyShadowQuality() {
    if (!SHADOWS) return;
    const want = Q.shadowMap === undefined || Q.shadowMap === null ? SHADOW_MAP : Q.shadowMap;
    if (want <= 0) {
      if (shadowPx !== 0) { shadowPx = 0; sun.shadow.intensity = 0; renderer.shadowMap.autoUpdate = false; }
      return;
    }
    const px = Math.max(256, Math.min(SHADOW_MAP, Math.round(want)));
    if (shadowPx === 0) { sun.shadow.intensity = 1; renderer.shadowMap.autoUpdate = true; }
    if (px !== shadowPx || sun.shadow.mapSize.x !== px) {
      shadowPx = px;
      sun.shadow.mapSize.set(px, px);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
  }
  function updateShadowWindow() {
    const px = player.head.x, py = rig.position.y, pz = player.head.z;
    // light camera basis exactly as three builds it (lookAt with up = +Y, eye = sun side)
    shRight.set(sunDir.z, 0, -sunDir.x); // cross((0,1,0), dir)
    const rl = Math.hypot(shRight.x, shRight.z) || 1;
    shRight.multiplyScalar(1 / rl);
    shUp.crossVectors(sunDir, shRight);
    const texel = (2 * SHADOW_HALF) / (shadowPx || SHADOW_MAP);
    const a = Math.round((px * shRight.x + py * shRight.y + pz * shRight.z) / texel) * texel;
    const b = Math.round((px * shUp.x + py * shUp.y + pz * shUp.z) / texel) * texel;
    const c = px * sunDir.x + py * sunDir.y + pz * sunDir.z;
    shTarget.set(0, 0, 0).addScaledVector(shRight, a).addScaledVector(shUp, b).addScaledVector(sunDir, c);
    sun.target.position.copy(shTarget);
    sun.position.copy(shTarget).addScaledVector(sunDir, 160);
    sun.target.updateMatrixWorld();
  }

  // ---- shared uniforms ---------------------------------------------------------------------
  const uTime = { value: 0 };
  const uFogDensity = { value: cur.fogD };
  const fogOut = cur.fog.clone(); // fog colour as rendered (cur.fog with world.style's colour lift applied)
  const uFogColor = { value: fogOut };
  const uCenter = { value: new Vector2() };
  const uWind = { value: 0.5 };
  const uSat = { value: 0 }; // world.style colour lift, applied to the world's own shaders (sky, grass, water)
  const focus = new Vector3(0, 190 - 1.6, -260).normalize();
  const DEFAULT_FOCUS = focus.clone();
  // travel: terrain-character uniforms shared by every shader that embeds TERRAIN_GLSL (grass, motes, water, mist, style's contact shadows)
  const tpU = { uTP0: { value: new THREE.Vector4() }, uTP1: { value: new THREE.Vector4() }, uTP2: { value: new THREE.Vector4() } };
  function syncTP() {
    tpU.uTP0.value.set(TP.baseAmp, TP.hillAmp, TP.dune, TP.crag);
    tpU.uTP1.value.set(TP.islandR, TP.islandW, TP.seaDepth, TP.canyon);
    tpU.uTP2.value.set(TP.lakeScale, TP.lift, 0, 0);
  }
  syncTP();
  const panoTex0 = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); panoTex0.needsUpdate = true; // sampler placeholder
  ctx.onDispose(() => panoTex0.dispose());
  const panoU = { uPano: { value: panoTex0 }, uPanoMix: { value: 0 }, uPanoP: { value: new THREE.Vector4(0, 0, 0.6, 1) } };
  let panoTarget = 0, panoOn = false;

  // ---- sky --------------------------------------------------------------------------------
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: cur.zenith }, uMid: { value: cur.mid }, uHorizon: { value: cur.horizon },
      uFocus: { value: focus }, uTime, uStars: { value: cur.stars }, uAurora: { value: cur.aurora },
      uSunDir: { value: L }, uSat, uSkyQ: { value: PC ? 2 : 1 }, ...panoU,
    },
    defines: PC ? { SKY_PC: 1 } : {},
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), skyMat);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.name = 'sky';
  root.add(sky);

  // ---- terrain ----------------------------------------------------------------------------
  const VC = (RINGS + 1) * (SEGS + 1);
  const tPos = new Float32Array(VC * 3);
  const tNor = new Float32Array(VC * 3);
  const tCol = new Float32Array(VC * 3);
  for (let i = 0; i <= RINGS; i++) {
    const r = R_MAX * Math.pow(i / RINGS, RING_POW);
    for (let j = 0; j <= SEGS; j++) {
      const v = i * (SEGS + 1) + j, th = (j / SEGS) * TAU;
      tPos[v * 3] = r * Math.cos(th);
      tPos[v * 3 + 2] = r * Math.sin(th);
    }
  }
  const tIdx = new Uint16Array(RINGS * SEGS * 6);
  const tHole = new Uint8Array(VC); // 1 = vertex inside the lake hole (its cell is left out; the lake patch fills it)
  const tGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage);
  const norAttr = new THREE.BufferAttribute(tNor, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage);
  tGeo.setAttribute('position', posAttr);
  tGeo.setAttribute('normal', norAttr);
  tGeo.setAttribute('color', colAttr);
  tGeo.setIndex(new THREE.BufferAttribute(tIdx, 1).setUsage(THREE.DynamicDrawUsage));

  const tdU = { value: Q.terrainDetail === false ? 0 : 1 }; // perf: live switch for the terrain detail noise (see quality:changed)
  // PC: world-space noise breaks up the vertex-colour albedo and adds a fine bump to the Lambert terrain.
  function terrainDetail(mat) {
    if (!PC) return mat;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTD = tdU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + TERRAIN_DETAIL_PARS)
        .replace('#include <color_fragment>', `#include <color_fragment>
          if (uTD > 0.5) {
          float tdH = tdHeight(vTWorld.xz);
          diffuseColor.rgb *= mix(vec3(0.84, 0.88, 0.82), vec3(1.14, 1.10, 1.02), tdH);
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          if (uTD > 0.5) {
            vec2 tdp = vTWorld.xz;
            float tde = 0.07, tdh0 = tdHeight(tdp);
            vec3 tdg = vec3(-(tdHeight(tdp + vec2(tde, 0.0)) - tdh0), 0.0, -(tdHeight(tdp + vec2(0.0, tde)) - tdh0)) * (0.1 / tde);
            tdg *= 1.0 - smoothstep(18.0, 60.0, length(vViewPosition));
            normal = normalize(normal + (viewMatrix * vec4(tdg, 0.0)).xyz);
          }`);
    };
    mat.customProgramCacheKey = () => 'world-terrain-detail';
    return mat;
  }
  // STYLE_NO_BAND: core/style.js's banded diffuse skips this material (smooth ground reads better than contour rings)
  const terrainMat = terrainDetail(new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrainMat.defines = { STYLE_NO_BAND: 1 };
  const terrain = new THREE.Mesh(tGeo, terrainMat);
  terrain.frustumCulled = false;
  terrain.name = 'terrain';
  // the terrain receives the sun's shadows but never casts them (self-shadowing a smooth heightfield only gives acne)
  terrain.receiveShadow = SHADOWS; terrain.castShadow = false; terrain.userData._shadowed = true;
  root.add(terrain);
  let tcx = 1e9, tcz = 1e9;
  let lakeLevel = LAKE.level;

  // ground / lake-bed colour at (x, z), terrain height h (with the lake). Writes linear rgb into out[o..o+2].
  function shade(x, z, h, out, o) {
    const dR = gB.r - gA.r, dG = gB.g - gA.g, dB = gB.b - gA.b;
    const p = patchVal(x, z);
    let r = (gA.r + dR * p) * 0.85, g = (gA.g + dG * p) * 0.85, b = (gA.b + dB * p) * 0.85;
    const r2 = x * x + z * z;
    if (r2 > 3600) {
      let f = (Math.sqrt(r2) - 60) / 260;
      if (f > 1) f = 1;
      f *= gnd.farMix;
      r += (gF.r - r) * f; g += (gF.g - g) * f; b += (gF.b - b) * f;
    }
    if (gnd.rockAmt > 0) { // travel: rock on the high ground (peaks, canyon walls)
      let u = (h - gnd.rockFrom) / (gnd.rockTo - gnd.rockFrom); u = u < 0 ? 0 : u > 1 ? 1 : u;
      u = u * u * (3 - 2 * u) * gnd.rockAmt;
      r += (gRock.r - r) * u; g += (gRock.g - g) * u; b += (gRock.b - b) * u;
    }
    const lx = x - LAKE.x, lz = z - LAKE.z;
    if (gnd.shoreAll || (gnd.lakeShore && lx * lx + lz * lz < LAKE.radius * LAKE.radius * 1.2)) { // (no lake: no wet mud / shore sand either)
      // damp sand just above the waterline, wet dark mud and silt below it
      const above = h - lakeLevel;
      const su = above < 0 ? 0 : above > 0.3 ? 1 : above / 0.3;
      const sand = 1 - su * su * (3 - 2 * su);
      if (sand > 0) {
        r += (gSand.r - r) * sand * 0.75; g += (gSand.g - g) * sand * 0.75; b += (gSand.b - b) * sand * 0.75;
      }
      if (above < 0) {
        let d = -above / 1.3; if (d > 1) d = 1; d = d * d * (3 - 2 * d);
        r += (0.05 - r) * d; g += (0.10 - g) * d; b += (0.12 - b) * d;
      }
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
  }

  // perf: the per-vertex height + colour loop (~20 sines per vertex) is the expensive part of a re-centre. It writes into scratch
  // buffers, a few hundred vertices per frame (stepTerrain), and commitTerrain() swaps the result in one cheap pass, so walking
  // never costs one long frame. rebuildTerrain() is the synchronous version (load, setGrassColor, setWater).
  const sY = new Float32Array(VC), sCol = new Float32Array(VC * 3), sHole = new Uint8Array(VC);
  let rb = null; // pending sliced rebuild { cx, cz, v }
  function fillTerrain(cx, cz, v0, v1) {
    const hole2 = LAKE_HOLE * LAKE_HOLE;
    for (let v = v0; v < v1; v++) {
      const v3 = v * 3;
      const x = cx + tPos[v3], z = cz + tPos[v3 + 2];
      const hb = groundHeightBase(x, z);
      sY[v] = hb; // the lake bowl is NOT in this mesh: its cells are cut out, see the patch
      shade(x, z, hb - lakeCarve(x, z), sCol, v3);
      const lx = x - LAKE.x, lz = z - LAKE.z;
      sHole[v] = lx * lx + lz * lz < hole2 ? 1 : 0;
    }
  }
  function stepTerrain(per) {
    if (!rb) return;
    const v1 = Math.min(VC, rb.v + per);
    fillTerrain(rb.cx, rb.cz, rb.v, v1);
    rb.v = v1;
    if (v1 >= VC) { const cx = rb.cx, cz = rb.cz; rb = null; commitTerrain(cx, cz); }
  }
  function rebuildTerrain(cx, cz) { rb = null; fillTerrain(cx, cz, 0, VC); commitTerrain(cx, cz); }
  function commitTerrain(cx, cz) {
    tcx = cx; tcz = cz;
    terrain.position.set(cx, 0, cz);
    for (let v = 0; v < VC; v++) { tPos[v * 3 + 1] = sY[v]; tHole[v] = sHole[v]; }
    tCol.set(sCol);
    {
      let n = 0;
      const W0 = SEGS + 1;
      for (let i = 0; i < RINGS; i++) {
        for (let j = 0; j < SEGS; j++) {
          const a = i * W0 + j, b = a + 1, c = a + W0, d = c + 1;
          if (tHole[a] & tHole[b] & tHole[c] & tHole[d]) continue;
          tIdx[n++] = a; tIdx[n++] = b; tIdx[n++] = c;
          tIdx[n++] = b; tIdx[n++] = d; tIdx[n++] = c;
        }
      }
      tGeo.setDrawRange(0, n);
      tGeo.index.needsUpdate = true;
    }
    // normals from the grid neighbours (t = tangent along the ring, s = radial); n = t x s points up
    const W = SEGS + 1;
    for (let i = 1; i <= RINGS; i++) {
      const im = i - 1, ip = i < RINGS ? i + 1 : RINGS;
      for (let j = 0; j <= SEGS; j++) {
        const jm = j > 0 ? j - 1 : SEGS - 1, jp = j < SEGS ? j + 1 : 1;
        const a = (i * W + jp) * 3, b = (i * W + jm) * 3, c = (ip * W + j) * 3, d = (im * W + j) * 3;
        const tx = tPos[a] - tPos[b], ty = tPos[a + 1] - tPos[b + 1], tz = tPos[a + 2] - tPos[b + 2];
        const sx = tPos[c] - tPos[d], sy = tPos[c + 1] - tPos[d + 1], sz = tPos[c + 2] - tPos[d + 2];
        let nx = ty * sz - tz * sy, ny = tz * sx - tx * sz, nz = tx * sy - ty * sx;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= l; ny /= l; nz /= l;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const o = (i * W + j) * 3;
        tNor[o] = nx; tNor[o + 1] = ny; tNor[o + 2] = nz;
      }
    }
    { // centre point: finite differences of the height function
      const hx = (groundHeightBase(cx + 1, cz) - groundHeightBase(cx - 1, cz)) * 0.5;
      const hz = (groundHeightBase(cx, cz + 1) - groundHeightBase(cx, cz - 1)) * 0.5;
      const l = Math.sqrt(hx * hx + 1 + hz * hz);
      for (let j = 0; j <= SEGS; j++) { tNor[j * 3] = -hx / l; tNor[j * 3 + 1] = 1 / l; tNor[j * 3 + 2] = -hz / l; }
    }
    posAttr.needsUpdate = true; norAttr.needsUpdate = true; colAttr.needsUpdate = true;
  }
  const snap = (v) => Math.round(v / RECENTER_SNAP) * RECENTER_SNAP;

  // ---- lake-bed patch: a fine fixed grid (1.25 m) over the bowl, where the main terrain has its cells cut out ------
  // The main mesh is far too coarse at ~85 m to carry a believable shoreline, and it is built from the bowl-free
  // height, so the lake patch (true height, bowl included) fills the hole. Outside LAKE.radius the two surfaces are
  // identical; where they overlap, the patch is pushed back with polygonOffset so the main terrain wins.
  const patchMat = terrainDetail(new THREE.MeshLambertMaterial({
    vertexColors: true, polygonOffset: true, polygonOffsetFactor: 3, polygonOffsetUnits: 6,
  }));
  patchMat.defines = { STYLE_NO_BAND: 1 };
  const lakePatch = new THREE.Mesh(new THREE.BufferGeometry(), patchMat);
  lakePatch.name = 'lake-bed';
  lakePatch.position.set(LAKE.x, 0, LAKE.z);
  lakePatch.receiveShadow = SHADOWS; lakePatch.castShadow = false; lakePatch.userData._shadowed = true;
  root.add(lakePatch);
  function buildLakePatch() {
    const N = Math.ceil((2 * LAKE_PATCH) / LAKE_CELL), W = N + 1, half = (N * LAKE_CELL) / 2;
    const pos = new Float32Array(W * W * 3), nor = new Float32Array(W * W * 3), col = new Float32Array(W * W * 3);
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const o = (j * W + i) * 3, lx = i * LAKE_CELL - half, lz = j * LAKE_CELL - half;
        const x = LAKE.x + lx, z = LAKE.z + lz, h = groundHeight(x, z);
        pos[o] = lx; pos[o + 1] = h; pos[o + 2] = lz;
        const e = 0.6;
        const hx = groundHeight(x + e, z) - groundHeight(x - e, z), hz = groundHeight(x, z + e) - groundHeight(x, z - e);
        const l = Math.sqrt(hx * hx + 4 * e * e + hz * hz);
        nor[o] = -hx / l; nor[o + 1] = (2 * e) / l; nor[o + 2] = -hz / l;
        shade(x, z, h, col, o);
      }
    }
    const idx = [];
    const r2 = LAKE_PATCH * LAKE_PATCH;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const cx = (i + 0.5) * LAKE_CELL - half, cz = (j + 0.5) * LAKE_CELL - half;
        if (cx * cx + cz * cz > r2) continue;
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = lakePatch.geometry;
    g.dispose(); // frees the GPU buffers of a previous build (setWater / setGrassColor rebuild the patch)
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
  }
  buildLakePatch();
  rebuildTerrain(snap(rig.position.x), snap(rig.position.z));

  // ---- grass --------------------------------------------------------------------------------
  // perf (round two): the field is a fixed set of tufts on a torus that wraps around the player (every tuft stands still in the world). What a
  // tuft needs for its position (ground height, height variation, patch colour) used to be evaluated in the vertex shader for every one of its
  // 9 vertices, in both eyes, every frame (~30 sines each). Now the CPU evaluates it once per tuft, only when the tuft steps into a new world
  // cell, and keeps a compact DRAW LIST of the tufts that matter right now: inside the fade radius (+ a margin), and on Quest also inside a
  // ~270 degree sector around where the player looks. Far tufts (Quest) go into a second 3-vertex mesh (one wider blade instead of three).
  // The list is rebuilt in time slices (<= ~0.6 ms per frame) when the player moved ~0.6 m or turned ~22 degrees, never in one long frame.
  function seeds(count, rngSeed) {
    const rng = mulberry32(rngSeed), a = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { // R2 low-discrepancy positions: any prefix is evenly spread
      a[i * 4] = (0.5 + i * 0.7548776662466927) % 1;
      a[i * 4 + 1] = (0.5 + i * 0.5698402909980532) % 1;
      a[i * 4 + 2] = rng();
      a[i * 4 + 3] = rng();
    }
    return a;
  }
  const grassPos = new THREE.BufferAttribute((() => {
    const verts = [];
    const tipH = [0.8, 1.0, 0.88];
    for (let k = 0; k < 3; k++) {
      const a = k * 2.0944 + 0.3, cx = Math.cos(a) * 0.1, cz = Math.sin(a) * 0.1;
      const b = a + 1.5708 + k * 0.4, tx = Math.cos(b) * 0.03, tz = Math.sin(b) * 0.03;
      verts.push(cx - tx, 0, cz - tz, cx + tx, 0, cz + tz, cx + Math.cos(a) * 0.05, tipH[k], cz + Math.sin(a) * 0.05);
    }
    return new Float32Array(verts);
  })(), 3);
  const grassFarPos = new THREE.BufferAttribute(grassPos.array.slice(0, 9), 3); // blade 0 of the tuft: the far mesh
  const bladeNear = new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]), 1);
  const bladeFar = new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 1);
  const uWaterLevel = { value: LAKE.level }; // grass and flowers do not grow below this (-1e4 = no lake)
  const uSunFrac = { value: new Color(0.5, 0.5, 0.5) };
  const noMask = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  noMask.needsUpdate = true;
  ctx.onDispose(() => noMask.dispose());
  const grassShared = {
    uCenter, uTime, uWind, uFogDensity, uFogColor, uWaterLevel, uSat,
    uGrassA: { value: gA }, uGrassB: { value: gB },
    uLight: { value: uLight }, uTint: { value: cur.horizon },
    uToLight: { value: L }, uRimCol: { value: uRim },
    uMask: { value: noMask }, uMaskRect: { value: new THREE.Vector4(0, 0, 1, 0) },
  };
  const GRASS_MOVE = 0.6, GRASS_MARGIN = 1.6, GRASS_TURN_COS = Math.cos(22 * Math.PI / 180), GRASS_SECTOR_COS2 = 0.5, GRASS_NEAR_ALL = 5;
  const CELL_NONE = 0x7fffffff;
  const pnow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // One grass layer: one or two instanced draws sharing one material. seedArr: R2 positions (x, z in 0..1), yaw (turns), random.
  function makeGrassLayer(name, seedArr, patch, tuft) {
    const N = (seedArr.length / 4) | 0;
    const sx = new Float32Array(N), sz = new Float32Array(N), cs = new Float32Array(N), sn = new Float32Array(N), rn = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      sx[i] = seedArr[i * 4]; sz[i] = seedArr[i * 4 + 1]; rn[i] = seedArr[i * 4 + 3];
      const yaw = seedArr[i * 4 + 2] * TAU; cs[i] = Math.cos(yaw); sn[i] = Math.sin(yaw);
    }
    // what depends on where a tuft stands, valid while it stays in the same world cell (kx, kz)
    const kx = new Int32Array(N).fill(CELL_NONE), kz = new Int32Array(N).fill(CELL_NONE);
    const cgy = new Float32Array(N), chv = new Float32Array(N), cpv = new Float32Array(N);
    const cap = Math.ceil(N * 0.9) + 64;
    const mkList = (pos, blade, label) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', pos);
      geo.setAttribute('aBlade', blade);
      const aW = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const aS = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aW', aW); geo.setAttribute('aS', aS);
      geo.instanceCount = 0;
      return { geo, aW, aS, aWa: aW.array, aSa: aS.array, mesh: null, label };
    };
    const near = mkList(grassPos, bladeNear, name);
    const far = !PC ? mkList(grassFarPos, bladeFar, name + '-far') : null;
    const u = Object.assign({}, grassShared, {
      uFadeNear: { value: patch * 0.24 }, uFadeFar: { value: patch * 0.48 }, uGrow: { value: 1 }, uLod: { value: new Vector2(1e5, 1e5) },
    });
    const defines = {};
    if (PC) {
      defines.GRASS_PC = 1;
      Object.assign(u, {
        uHeightMul: { value: tuft ? 1.75 : 1 }, uWidthMul: { value: tuft ? 1.5 : 1 },
        uTipCol: { value: new Color(0.9, 0.72, 0.5) }, uTipMix: { value: tuft ? 0.4 : 0 },
      });
    } else defines.GRASS_LOD = 1;
    if (SHADOWS) {
      defines.GRASS_SHADOW = 1;
      Object.assign(u, THREE.UniformsUtils.clone(THREE.UniformsLib.lights), { uSunFrac });
    }
    const mat = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: GRASS_VERT, fragmentShader: GRASS_FRAG, side: THREE.DoubleSide, fog: false,
      defines, lights: SHADOWS,
    });
    for (const L2 of far ? [near, far] : [near]) {
      const m = new THREE.Mesh(L2.geo, mat);
      m.frustumCulled = false;
      m.name = L2.label;
      m.receiveShadow = SHADOWS; m.castShadow = false; m.userData._shadowed = true;
      m.visible = false;
      root.add(m);
      L2.mesh = m;
    }
    const st = { P: patch, count: 0, fadeNear: -1, fadeFar: -1, listR2: 0, lodA: 0, lodB: 0, split2: 0, sector: false, lod: false }; // (fade -1: the first configure() always sets listR2)
    let enabled = true, run = false, ri = 0, nn = 0, nf = 0, dirty = true, jump = true;
    let rcx = 0, rcz = 0, rfx = 0, rfz = -1, lcx = 1e9, lcz = 1e9, lfx = 0, lfz = -1;
    const stats = { passes: 0, recomputed: 0, near: 0, far: 0, lastPassMs: 0, jumps: 0 };
    function configure(o) {
      let ch = false;
      if (o.patch !== st.P) { st.P = o.patch; kx.fill(CELL_NONE); jump = true; ch = true; }
      const cnt = Math.max(0, Math.min(N, o.count | 0));
      if (cnt !== st.count) { st.count = cnt; ch = true; }
      if (o.fadeNear !== st.fadeNear || o.fadeFar !== st.fadeFar) {
        st.fadeNear = o.fadeNear; st.fadeFar = o.fadeFar;
        u.uFadeNear.value = o.fadeNear; u.uFadeFar.value = o.fadeFar;
        const r = o.fadeFar + GRASS_MARGIN; st.listR2 = r * r;
        ch = true;
      }
      const lod = !!(o.lod && far), sector = !!o.sector;
      if (lod !== st.lod || sector !== st.sector || o.lodA !== st.lodA || o.lodB !== st.lodB) {
        st.lod = lod; st.sector = sector; st.lodA = o.lodA || 0; st.lodB = o.lodB || 0;
        u.uLod.value.set(lod ? st.lodA : 1e5, lod ? st.lodB : 1e5);
        const sp = st.lodB + 1.3; st.split2 = sp * sp;
        ch = true;
      }
      if (ch) dirty = true;
    }
    function invalidate() { kx.fill(CELL_NONE); dirty = true; jump = true; }
    function setEnabled(v) {
      enabled = !!v;
      near.mesh.visible = enabled && near.geo.instanceCount > 0;
      if (far) far.mesh.visible = enabled && far.geo.instanceCount > 0;
      if (enabled) dirty = true;
    }
    function commit(L2, n) {
      L2.geo.instanceCount = n;
      if (n > 0) { L2.aW.addUpdateRange(0, n * 4); L2.aW.needsUpdate = true; L2.aS.addUpdateRange(0, n * 4); L2.aS.needsUpdate = true; }
      L2.mesh.visible = enabled && n > 0;
    }
    // cx, cz: where the player's head is; fx, fz: unit horizontal view direction. budgetMs < 0: run to completion.
    function tick(dt, cx, cz, fx, fz, budgetMs) {
      if (!enabled) return;
      if (u.uGrow.value < 1) u.uGrow.value = Math.min(1, u.uGrow.value + dt * 2.6);
      if (!run) {
        const mx = cx - lcx, mz = cz - lcz, m2 = mx * mx + mz * mz;
        if (!dirty && m2 < GRASS_MOVE * GRASS_MOVE && !(st.sector && fx * lfx + fz * lfz < GRASS_TURN_COS)) return;
        if (m2 > 100) jump = true;                       // teleported: what is on screen is stale, hide it until the new list is ready
        run = true; ri = 0; nn = 0; nf = 0; dirty = false;
        rcx = cx; rcz = cz; rfx = fx; rfz = fz;
        if (jump) { near.geo.instanceCount = 0; near.mesh.visible = false; if (far) { far.geo.instanceCount = 0; far.mesh.visible = false; } u.uGrow.value = 0; stats.jumps++; }
      }
      const budget = budgetMs !== undefined ? budgetMs : (jump ? 7 : 0.6);
      const t0 = budget >= 0 ? pnow() : 0;
      const P = st.P, c = st.count, list2 = st.listR2, sector = st.sector, lod = st.lod, split2 = st.split2;
      const nW = near.aWa, nS = near.aSa, fW = far ? far.aWa : null, fS = far ? far.aSa : null;
      let i = ri, n1 = nn, n2 = nf, redo = 0;
      while (i < c) {
        const stop = Math.min(c, i + 256);
        for (; i < stop; i++) {
          const ox = sx[i] * P, oz = sz[i] * P;
          const kxn = Math.floor((rcx - ox) / P + 0.5), kzn = Math.floor((rcz - oz) / P + 0.5);
          const wx = ox + P * kxn, wz = oz + P * kzn;
          const dx = wx - rcx, dz = wz - rcz, d2 = dx * dx + dz * dz;
          if (d2 > list2) continue;
          if (sector && d2 > GRASS_NEAR_ALL * GRASS_NEAR_ALL) { const dot = dx * rfx + dz * rfz; if (dot < 0 && dot * dot > GRASS_SECTOR_COS2 * d2) continue; }
          let gy, hv, pv;
          if (kx[i] !== kxn || kz[i] !== kzn) {
            gy = groundHeight(wx, wz);
            hv = (0.30 + 0.50 * rn[i]) * (0.85 + 0.15 * Math.sin(wx * 0.23 + 1.0) * Math.sin(wz * 0.19));
            pv = patchVal(wx, wz);
            kx[i] = kxn; kz[i] = kzn; cgy[i] = gy; chv[i] = hv; cpv[i] = pv; redo++;
          } else { gy = cgy[i]; hv = chv[i]; pv = cpv[i]; }
          if (lod && d2 > split2) {
            if (n2 >= cap) continue;
            const o = n2++ * 4;
            fW[o] = wx; fW[o + 1] = wz; fW[o + 2] = gy; fW[o + 3] = hv; fS[o] = cs[i]; fS[o + 1] = sn[i]; fS[o + 2] = rn[i]; fS[o + 3] = pv;
          } else {
            if (n1 >= cap) continue;
            const o = n1++ * 4;
            nW[o] = wx; nW[o + 1] = wz; nW[o + 2] = gy; nW[o + 3] = hv; nS[o] = cs[i]; nS[o + 1] = sn[i]; nS[o + 2] = rn[i]; nS[o + 3] = pv;
          }
        }
        if (budget >= 0 && pnow() - t0 > budget) break;
      }
      stats.recomputed += redo;
      ri = i; nn = n1; nf = n2;
      if (i < c) return;
      run = false; ri = 0;
      lcx = rcx; lcz = rcz; lfx = rfx; lfz = rfz;
      commit(near, nn); if (far) commit(far, nf);
      stats.passes++; stats.near = nn; stats.far = nf;
      jump = false;
    }
    return { near: near.mesh, far: far ? far.mesh : null, u, mat, configure, invalidate, setEnabled, tick, stats, N, get listCapacity() { return cap; } };
  }
  const grassMain = makeGrassLayer('grass', seeds(PC ? GRASS_PC : GRASS_DESKTOP, 0x6A55), PC ? GRASS_PATCH_PC : GRASS_PATCH_VR, false);
  const grass = grassMain.near, grassU = grassMain.u;
  const tufts = PC ? makeGrassLayer('grass-tufts', seeds(TUFT_PC, 0x7EF7), TUFT_PATCH_PC, true) : null;
  const grassLayers = tufts ? [grassMain, tufts] : [grassMain];
  // ---- glow motes: flowers + fireflies (one instanced draw) ------------------------------------
  const glowGeo = new THREE.InstancedBufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  glowGeo.setIndex([0, 1, 2, 0, 2, 3]);
  glowGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds(GLOW_DESKTOP, 0xF1EF), 4));
  glowGeo.instanceCount = GLOW_VR;
  const glow = new THREE.Mesh(glowGeo, new THREE.ShaderMaterial({
    uniforms: {
      ...tpU, uCenter, uTime, uFogDensity, uWaterLevel, uPatch: { value: GLOW_PATCH },
      uFadeNear: { value: GLOW_PATCH * 0.25 }, uFadeFar: { value: GLOW_PATCH * 0.47 },
    },
    vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  glow.frustumCulled = false;
  glow.renderOrder = 10;
  glow.name = 'glow';
  root.add(glow);

  let lastVR = null;
  const gView = { x: 0, z: -1 }; // horizontal unit view direction (held while the player looks straight up or down)
  // Live quality (core/perf.js mutates ctx.quality and emits 'quality:changed'): instance counts, patch radius and
  // uniforms only. No rebuilds, no shader recompiles.
  const qv = (k, d) => (Q[k] === undefined || Q[k] === null ? d : Q[k]);
  let waterQ = 2, mistOn = true;
  let grassMul = 1, motesMul = 1; // travel: per-place grass / glow-mote amount (x the perf governor's knobs)
  let oceanOn = false;            // travel: the water follows the player and reaches the horizon (islands, beaches)
  function applyQuality(vr) {
    lastVR = vr;
    const g0 = clamp(+qv('grass', 1), 0.05, 1), ps = 0.6 + 0.4 * g0, g = g0 * grassMul; // grass 0..1: fewer blades over a somewhat smaller patch
    // PC: the same dense, far-reaching grass on the monitor and through Link; Quest keeps the lean headset counts
    // (the torus keeps its full size and the density of the original: fewer tufts over a smaller FADE radius = count / ps^2 tufts on the
    // full torus, so changing the knob never moves a tuft or re-evaluates the terrain)
    const Pb = PC ? GRASS_PATCH_PC : (vr ? GRASS_PATCH_VR : GRASS_PATCH_DESKTOP), P = Pb * ps;
    grassMain.configure({
      patch: Pb, count: Math.round((PC ? GRASS_PC : (vr ? GRASS_VR : GRASS_DESKTOP)) * g / (ps * ps)), fadeNear: P * 0.24, fadeFar: P * 0.48,
      sector: !PC && qv('grassSector', false) === true, lod: !PC && qv('grassLod', false) === true, lodA: P * 0.28, lodB: P * 0.38,
    });
    if (tufts) { // second layer: PC only; it fades out first when the grass is thinned
      const tp = TUFT_PATCH_PC * ps;
      tufts.configure({ patch: TUFT_PATCH_PC, count: g < 0.4 ? 0 : Math.round(TUFT_PC * g / (ps * ps)), fadeNear: tp * 0.3, fadeFar: tp * 0.5, sector: false, lod: false });
    }
    glowGeo.instanceCount = Math.round((vr ? GLOW_VR : GLOW_DESKTOP) * clamp(+qv('motes', 1), 0, 1) * motesMul);
    skyMat.uniforms.uSkyQ.value = clamp(+qv('sky', PC ? 2 : 1), 0, PC ? 2 : 1);
    const late = !!qv('skyLate', false); // depth-tested sky drawn after the opaque pass: pixels covered by terrain are never shaded
    if (skyMat.depthTest !== late) { skyMat.depthTest = late; sky.renderOrder = late ? 1e6 : -1000; }
    waterQ = clamp(Math.round(+qv('water', 2)), 0, 2);
    waterU.uLite.value = (waterQ < 2 || (oceanOn && !PC)) ? 1 : 0; // (an ocean fills half the view: the cheap water on the Quest tier)
    mistOn = qv('mist', true) !== false;
    tdU.value = qv('terrainDetail', true) === false ? 0 : 1;
    applyShadowQuality();
    syncWorldVis();
  }

  // ---- far standing stones (one InstancedMesh) -------------------------------------------------
  let stones = null;
  {
    const rng = mulberry32(0x57A1E5);
    const list = [];
    const circles = [[150, 0.9, 6, 13], [235, 3.8, 7, 17], [320, 5.5, 5, 12]]; // dist, azimuth, count, radius
    for (const [d, az, n, rad] of circles) {
      const ccx = d * Math.cos(az), ccz = d * Math.sin(az);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rng() * 0.15;
        list.push([ccx + rad * Math.cos(a), ccz + rad * Math.sin(a), 4.5 + rng() * 3.5, 0.9 + rng() * 0.5]);
      }
    }
    for (let k = 0; k < 10; k++) {
      const d = 85 + rng() * 250, az = rng() * TAU;
      list.push([d * Math.cos(az), d * Math.sin(az), 6 + rng() * 10, 1.1 + rng() * 1.2]);
    }
    // keep the lake clear (stones stay where they were; any that would stand in the water are dropped)
    for (let k = list.length - 1; k >= 0; k--) {
      if (Math.hypot(list[k][0] - LAKE.x, list[k][1] - LAKE.z) < LAKE.radius + 3) list.splice(k, 1);
    }
    const sg =new THREE.CylinderGeometry(0.55, 1.0, 1, 5, 1);
    sg.translate(0, 0.5, 0);
    const sm = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x0b0818 });
    stones = new THREE.InstancedMesh(sg, sm, list.length);
    const dummy = new THREE.Object3D();
    dummy.rotation.order = 'YXZ';
    const c = new Color();
    for (let i = 0; i < list.length; i++) {
      const [x, z, h, w] = list[i];
      dummy.position.set(x, groundHeight(x, z) - 0.3, z);
      dummy.rotation.set((rng() - 0.5) * 0.12, rng() * TAU, (rng() - 0.5) * 0.12);
      dummy.scale.set(w, h, w);
      dummy.updateMatrix();
      stones.setMatrixAt(i, dummy.matrix);
      c.setHSL(0.72 + rng() * 0.05, 0.18, 0.2 + rng() * 0.08);
      stones.setColorAt(i, c);
    }
    stones.instanceMatrix.needsUpdate = true;
    if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
    stones.frustumCulled = false;
    stones.name = 'stones';
    root.add(stones);
  }
  // travel: stand the stones on the new ground after a terrain change (keeps their x / z / rotation)
  const _sm = new THREE.Matrix4();
  function restandStones() {
    if (!stones) return;
    for (let i = 0; i < stones.count; i++) {
      stones.getMatrixAt(i, _sm);
      _sm.elements[13] = groundHeight(_sm.elements[12], _sm.elements[14]) - 0.3;
      stones.setMatrixAt(i, _sm);
    }
    stones.instanceMatrix.needsUpdate = true;
  }

  // ---- passthrough floor cue: a faint, soft-edged ring of glowing motes lying on the floor ---------
  const CUE_N = 160, CUE_R = 2.5, CUE_ALPHA = 0.14;
  const cueCenter = { value: new Vector2() };
  const cueU = { uCenter: cueCenter, uTime, uRing: { value: CUE_R }, uAlpha: { value: 0 } };
  const cueGeo = new THREE.InstancedBufferGeometry();
  cueGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  cueGeo.setIndex([0, 1, 2, 0, 2, 3]);
  cueGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds(CUE_N, 0xC0E5), 4));
  cueGeo.instanceCount = CUE_N;
  const cue = new THREE.Mesh(cueGeo, new THREE.ShaderMaterial({
    uniforms: cueU,
    vertexShader: CUE_VERT, fragmentShader: GLOW_FRAG, // same soft round sprite as the glow motes
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    // additive that leaves framebuffer alpha alone (AdditiveBlending would add alpha^2 and paint black over the room)
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }));
  cue.frustumCulled = false;
  cue.renderOrder = 10;
  cue.visible = false;
  cue.name = 'passthrough-floor-cue';
  root.add(cue);

  // ---- lake water + ground mist -------------------------------------------------------------------
  const waterShallow = new Color(0x2f8f8a), waterDeep = new Color(0x0c2b44);
  let waterOn = true;
  const sunCol = new Color(), glowCol = new Color(1.0, 0.86, 0.95);
  const waterU = {
    ...tpU, uTime, uWind, uFogDensity, uFogColor, uLevel: { value: lakeLevel },
    uShallow: { value: waterShallow }, uDeep: { value: waterDeep },
    uZenith: { value: cur.zenith }, uMid: { value: cur.mid }, uHorizon: { value: cur.horizon },
    uLight: { value: uLight }, uSunDir: { value: sunDir }, uSunCol: { value: sunCol },
    uFocus: { value: focus }, uGlowCol: { value: glowCol }, uSat, uLite: { value: 0 },
  };
  const waterGeo = new THREE.PlaneGeometry(LAKE.radius * 2.8, LAKE.radius * 2.8, 1, 1);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, new THREE.ShaderMaterial({
    uniforms: waterU, vertexShader: FLATWORLD_VERT, fragmentShader: WATER_FRAG, defines: PC ? { WATER_PC: 1 } : {},
    transparent: true, depthWrite: false, fog: false,
  }));
  water.position.set(LAKE.x, lakeLevel, LAKE.z);
  water.renderOrder = 3;
  water.frustumCulled = false;
  water.name = 'lake-water';
  water.userData.noShadow = true; water.userData.noOutline = true;
  root.add(water);

  let mist = null;
  const mistU = {
    ...tpU, uTime, uFogDensity, uFogColor, uTop: { value: MIST_TOP }, uRadius: { value: MIST_RADIUS }, uAlpha: { value: 0.9 },
    uCenter: { value: new Vector2() }, uColor: { value: new Color() },
  };
  if (PC) {
    const mg = new THREE.CircleGeometry(MIST_RADIUS, 40);
    mg.rotateX(-Math.PI / 2);
    mist = new THREE.Mesh(mg, new THREE.ShaderMaterial({
      uniforms: mistU, vertexShader: FLATWORLD_VERT, fragmentShader: MIST_FRAG, transparent: true, depthWrite: false, fog: false,
    }));
    mist.position.y = MIST_TOP;
    mist.renderOrder = 4;
    mist.frustumCulled = false;
    mist.name = 'ground-mist';
    mist.userData.noShadow = true; mist.userData.noOutline = true;
    root.add(mist);
  }
  water.userData._shadowed = true; if (mist) mist.userData._shadowed = true;
  // water and mist follow their own switches in addition to the passthrough hiding
  function syncWorldVis() {
    for (const L2 of grassLayers) L2.setEnabled(!pt && grassMul > 0.001);
    water.visible = waterOn && !pt && waterQ > 0;
    if (mist) mist.visible = !pt && mistOn;
  }

  // ---- passthrough (mixed reality) mode ----------------------------------------------------------
  const ptNodes = [sky, terrain, lakePatch, glow, stones];            // hidden while passthrough (the grass layers follow setEnabled via syncWorldVis)
  const ptWasVisible = ptNodes.map(() => true);
  const PT_HEMI_SKY = new Color(0xfff3e4), PT_HEMI_GND = new Color(0x756e66), PT_SUN_COL = new Color(0xffeedd);
  const PT_HEMI_I = 0.65, PT_SUN_I = 0.4;                  // x PI; roughly 1.0 on an up-facing matte surface
  const PT_L = new Vector3(-0.3, 0.9, -0.35).normalize();  // key light from above, slightly in front
  let ptL = 0, sunMoved = false;                           // 0..1 blend of the light retune
  let ptPrevBg = null, ptPrevFog = null, ptPrevClearAlpha = 0;
  if (!input.passthrough) keep.ptRig = null;               // a stale saved rig position from an older session

  function setPT(on) {
    if (on === pt) return;
    pt = on;
    if (on) {
      ptPrevBg = scene.background; ptPrevFog = scene.fog;
      scene.background = null; scene.fog = null;
      ptPrevClearAlpha = renderer.getClearAlpha();
      renderer.setClearAlpha(0);
      for (let i = 0; i < ptNodes.length; i++) { ptWasVisible[i] = ptNodes[i].visible; ptNodes[i].visible = false; }
      if (!keep.ptRig) keep.ptRig = [rig.position.x, rig.position.y, rig.position.z]; // survives a hot reload
      rig.position.set(0, 0, 0);
      cueCenter.value.set(player.head.x, player.head.z);
    } else {
      if (scene.background === null) scene.background = ptPrevBg;
      if (scene.fog === null) scene.fog = ptPrevFog;
      renderer.setClearAlpha(ptPrevClearAlpha);
      for (let i = 0; i < ptNodes.length; i++) ptNodes[i].visible = ptWasVisible[i];
      if (keep.ptRig) { rig.position.set(keep.ptRig[0], keep.ptRig[1], keep.ptRig[2]); keep.ptRig = null; }
    }
    syncWorldVis();
  }
  ctx.on('xr:start', (e) => setPT(!!(e && e.passthrough)));
  ctx.on('xr:end', () => setPT(false));

  // ---- spawn placement ---------------------------------------------------------------------
  if (Math.abs(rig.position.x) < 0.01 && Math.abs(rig.position.z) < 0.01) rig.position.y = groundHeight(0, 0);

  // ---- env service -------------------------------------------------------------------------
  const env = {
    wind: 0.5,
    get timeOfDay() { return tod; },
    get passthrough() { return pt; },
    setSkyColors(o) {
      o = o || {};
      if (o.zenith != null) setC(tgt.zenith, o.zenith);
      if (o.horizon != null) setC(tgt.horizon, o.horizon);
      if (o.mid != null) setC(tgt.mid, o.mid); else tgt.mid.lerpColors(tgt.zenith, tgt.horizon, 0.5);
      skyCustom = true;
      deriveSkyLights();
      if (!fogCustom) tgt.fog.copy(tgt.horizon);
      return env;
    },
    setFog(color, density) {
      if (color === null) { fogCustom = false; tgt.fog.copy(tgt.horizon); }
      else if (color !== undefined) { setC(tgt.fog, color); fogCustom = true; }
      if (density != null && isFinite(density)) tgt.fogD = clamp(density, 0.0036, 0.05);
      return env;
    },
    setGrassColor(color) {
      setC(gB, color);
      gA.copy(gB).multiplyScalar(0.55);
      gA.g = Math.min(1, gA.g * 1.15); gA.b = Math.min(1, gA.b * 1.25);
      rebuildTerrain(tcx, tcz);
      buildLakePatch();
      return env;
    },
    setWater(o) {
      o = o || {};
      if (o.color != null) {
        setC(waterShallow, o.color);
        waterDeep.copy(waterShallow).multiplyScalar(0.22);
        waterDeep.b = Math.min(1, waterDeep.b + 0.05);
      }
      if (o.level != null && isFinite(o.level)) {
        lakeLevel = clamp(+o.level, LAKE.minLevel, LAKE.maxLevel);
        waterU.uLevel.value = lakeLevel;
        water.position.y = lakeLevel;
        buildLakePatch(); rebuildTerrain(tcx, tcz); // the wet-sand shoreline colours follow the level
      }
      if (o.enabled != null) { waterOn = !!o.enabled; gnd.lakeShore = waterOn; if (o.level == null) groundChanged(false); }
      uWaterLevel.value = waterOn ? lakeLevel : -1e4;
      syncWorldVis();
      return env;
    },
    isWater(x, z) {
      if (pt || !waterOn) return false;
      if (oceanOn) return groundHeight(x, z) < lakeLevel; // travel: the water reaches the horizon
      const dx = x - LAKE.x, dz = z - LAKE.z;
      const r = LAKE.radius * 1.4;
      return dx * dx + dz * dz < r * r && groundHeight(x, z) < lakeLevel;
    },
    get waterLevel() { return lakeLevel; },
    get waterEnabled() { return waterOn; },
    get lake() { return { x: LAKE.x, z: LAKE.z, radius: LAKE.radius }; },
    get palette() { return cur; },
    get sunDirection() { return L; },
    terrainGLSL: TERRAIN_GLSL,
    quality: Q.tier || 'quest',
    setTimeOfDay(t) {
      skyCustom = false; fogCustom = false;
      applyTOD(+t || 0);
      return env;
    },
    setStars(v) { tgt.stars = clamp(+v || 0, 0, 1); return env; },
    setAurora(v) { tgt.aurora = clamp(+v || 0, 0, 1); return env; },
    setWind(v) { windOverride = v == null ? null : clamp(+v || 0, 0, 1); return env; },
    setTransition(seconds) { easeSeconds = Math.max(0, +seconds || 0); return env; },
    // setGrassMask(texture, centreX, centreZ, size): white areas of the texture have no grass. null clears it.
    setGrassMask(texture, cx = 0, cz = 0, size = 100) {
      grassShared.uMask.value = texture || noMask; // shared by every grass layer
      grassShared.uMaskRect.value.set(cx, cz, 1 / Math.max(1, size), texture ? 1 : 0);
      return env;
    },

    // ======================= TRAVEL additions (used by core/travel.js; safe for anyone) =======================
    // setTerrain({ baseAmp, hillAmp, dune, crag, islandR, islandW, seaDepth, canyon, lakeScale, lift })  replaces the whole terrain
    //   character (see TP at the top; missing keys = the field's defaults; null = the field). Rebuilds the mesh over a few frames
    //   (env.terrainBusy), the lake bed at once, moves the standing stones, and emits 'world:terrain-changed' { rev, params }:
    //   world.groundHeight changed, so the physics heightfield patch must be rebuilt by its owner. { sync: true } rebuilds at once.
    setTerrain(o) {
      const next = Object.assign({}, TP_DEFAULT);
      if (o && typeof o === 'object') for (const k in TP_LIMITS) if (o[k] != null && isFinite(o[k])) next[k] = clamp(+o[k], TP_LIMITS[k][0], TP_LIMITS[k][1]);
      applyTerrain(next, !!(o && o.sync));
      return env;
    },
    get terrain() { const p = Object.assign({}, TP); return p; },
    get terrainBusy() { return rb !== null; },
    // setGround({ a, b, far, rock, sand, rockAmount 0..1, rockFrom, rockTo, farMix })  ground / grass palette (a = dark, b = light patches)
    setGround(o) {
      o = o || {};
      if (o.a != null) setC(gA, o.a);
      if (o.b != null) setC(gB, o.b);
      if (o.far != null) setC(gF, o.far);
      if (o.rock != null) setC(gRock, o.rock);
      if (o.sand != null) setC(gSand, o.sand);
      if (o.rockAmount != null) gnd.rockAmt = clamp(+o.rockAmount || 0, 0, 1);
      if (o.rockFrom != null) gnd.rockFrom = +o.rockFrom;
      if (o.rockTo != null) gnd.rockTo = Math.max(gnd.rockFrom + 0.5, +o.rockTo);
      if (o.farMix != null) gnd.farMix = clamp(+o.farMix, 0, 1);
      groundChanged(!!o.sync);
      return env;
    },
    setGrass(amount) { grassMul = clamp(+amount, 0, 1); applyQuality(lastVR === null ? !!input.presenting : lastVR); return env; }, // 0 = bare ground
    setMotes(amount) { motesMul = clamp(+amount, 0, 1); applyQuality(lastVR === null ? !!input.presenting : lastVR); return env; },
    setStones(on) { if (stones) stones.visible = !!on && !pt; stonesOn = !!on; return env; },
    // setOcean({ enabled, level, color })  water that follows the player and reaches the horizon (use with terrain islandR / lift)
    setOcean(o) {
      o = o || {};
      if (o.color != null) { setC(waterShallow, o.color); waterDeep.copy(waterShallow).multiplyScalar(0.22); waterDeep.b = Math.min(1, waterDeep.b + 0.05); }
      if (o.level != null && isFinite(o.level)) { lakeLevel = clamp(+o.level, -2.5, -0.3); waterU.uLevel.value = lakeLevel; water.position.y = lakeLevel; }
      if (o.enabled != null) {
        oceanOn = !!o.enabled;
        if (oceanOn) waterOn = true;
        gnd.shoreAll = oceanOn; gnd.lakeShore = waterOn;
        water.scale.set(oceanOn ? OCEAN_SIZE / (LAKE.radius * 2.8) : 1, 1, oceanOn ? OCEAN_SIZE / (LAKE.radius * 2.8) : 1);
        if (!oceanOn) water.position.set(LAKE.x, lakeLevel, LAKE.z);
      }
      uWaterLevel.value = waterOn ? lakeLevel : -1e4;
      applyQuality(lastVR === null ? !!input.presenting : lastVR);
      groundChanged(!!o.sync);
      return env;
    },
    get ocean() { return oceanOn; },
    // setLight({ dir: [x,y,z] | Vector3 (towards the light), color, intensity, hemiIntensity, hemiSky, hemiGround })  call AFTER setSkyColors
    //   (that derives the light colours from the sky); the direction eases like the palette. Elevation is kept >= ~5 degrees.
    setLight(o) {
      o = o || {};
      if (o.dir) {
        const d = o.dir.isVector3 ? o.dir : { x: o.dir[0], y: o.dir[1], z: o.dir[2] };
        if (isFinite(d.x + d.y + d.z)) { Lt.set(d.x, d.y, d.z).normalize(); if (Lt.y < 0.09) { Lt.y = 0.09; Lt.normalize(); } }
      }
      if (o.color != null) setC(tgt.dirCol, o.color);
      if (o.intensity != null && isFinite(o.intensity)) tgt.dirI = clamp(+o.intensity, 0, 4);
      if (o.hemiIntensity != null && isFinite(o.hemiIntensity)) tgt.hemiI = clamp(+o.hemiIntensity, 0, 3);
      if (o.hemiSky != null) setC(tgt.hemiSky, o.hemiSky);
      if (o.hemiGround != null) setC(tgt.hemiGround, o.hemiGround);
      return env;
    },
    // setSkyPano(texture | null, { yaw (deg), horizon (deg: where the picture's own horizon is, + = above its equator), haze 0..1,
    //   exposure, mix 0..1, instant })  an equirectangular sky (u = atan(x, -z), centre = -Z). null fades back to the procedural sky.
    setSkyPano(tex, o) {
      o = o || {};
      if (!tex) { panoTarget = 0; if (o.instant) { panoU.uPanoMix.value = 0; panoU.uPano.value = panoTex0; } return env; }
      panoU.uPano.value = tex;
      panoU.uPanoP.value.set((+o.yaw || 0) / 360, (+o.horizon || 0) / 180, o.haze != null ? clamp(+o.haze, 0, 1) : 0.6, o.exposure != null ? +o.exposure : 1);
      panoTarget = o.mix != null ? clamp(+o.mix, 0, 1) : 1;
      if (o.instant) panoU.uPanoMix.value = panoTarget;
      return env;
    },
    get skyPano() { return panoTarget > 0 ? panoU.uPano.value : null; },
    // snapshot() -> plain data; restore(snap, { instant }) puts every setter above (+ palette, fog, lake, grass colour, time of day) back exactly
    snapshot() {
      const c = (col) => col.toArray();
      const s = {
        v: 1, tod, skyCustom, fogCustom, easeSeconds, windOverride, tgt: {}, light: Lt.toArray(),
        ground: { a: c(gA), b: c(gB), far: c(gF), rock: c(gRock), sand: c(gSand), rockAmt: gnd.rockAmt, rockFrom: gnd.rockFrom, rockTo: gnd.rockTo, farMix: gnd.farMix },
        water: { shallow: c(waterShallow), deep: c(waterDeep), level: lakeLevel, on: waterOn, ocean: oceanOn },
        terrain: Object.assign({}, TP), grassMul, motesMul, stones: stonesOn,
      };
      for (const k of COLOR_KEYS) s.tgt[k] = c(tgt[k]);
      s.tgt.fog = c(tgt.fog);
      for (const k of NUM_KEYS) s.tgt[k] = tgt[k];
      return s;
    },
    restore(s, o) {
      if (!s || s.v !== 1) return env;
      o = o || {};
      tod = s.tod; skyCustom = s.skyCustom; fogCustom = s.fogCustom; easeSeconds = s.easeSeconds; windOverride = s.windOverride;
      for (const k of COLOR_KEYS) tgt[k].fromArray(s.tgt[k]);
      tgt.fog.fromArray(s.tgt.fog);
      for (const k of NUM_KEYS) tgt[k] = s.tgt[k];
      Lt.fromArray(s.light);
      gA.fromArray(s.ground.a); gB.fromArray(s.ground.b); gF.fromArray(s.ground.far); gRock.fromArray(s.ground.rock); gSand.fromArray(s.ground.sand);
      gnd.rockAmt = s.ground.rockAmt; gnd.rockFrom = s.ground.rockFrom; gnd.rockTo = s.ground.rockTo; gnd.farMix = s.ground.farMix;
      waterShallow.fromArray(s.water.shallow); waterDeep.fromArray(s.water.deep);
      lakeLevel = s.water.level; waterOn = s.water.on; oceanOn = s.water.ocean; gnd.shoreAll = oceanOn; gnd.lakeShore = waterOn;
      waterU.uLevel.value = lakeLevel; water.position.y = lakeLevel; uWaterLevel.value = waterOn ? lakeLevel : -1e4;
      const sc = oceanOn ? OCEAN_SIZE / (LAKE.radius * 2.8) : 1;
      water.scale.set(sc, 1, sc);
      if (!oceanOn) water.position.set(LAKE.x, lakeLevel, LAKE.z);
      grassMul = s.grassMul; motesMul = s.motesMul; stonesOn = s.stones; if (stones) stones.visible = stonesOn && !pt;
      panoTarget = 0;
      if (o.instant) {
        for (const k of COLOR_KEYS) cur[k].copy(tgt[k]);
        cur.fog.copy(tgt.fog);
        for (const k of NUM_KEYS) cur[k] = tgt[k];
        L.copy(Lt);
        panoU.uPanoMix.value = 0; panoU.uPano.value = panoTex0;
      }
      applyQuality(lastVR === null ? !!input.presenting : lastVR);
      applyTerrain(Object.assign({}, TP_DEFAULT, s.terrain), !!o.instant, true);
      return env;
    },
  };
  // travel helpers (declared after env so they can reach everything above)
  var stonesOn = true;
  // style.js builds its contact-shadow shader from env.terrainGLSL (which now declares uTP0..2) but cannot know our uniform objects:
  // hand them over (once, and again if style reloads). Without this the blobs would use the field's terrain.
  let blobCheckAt = 0, blobRef = null;
  function linkBlobShader(t) {
    blobCheckAt = t + (blobRef && blobRef.parent ? 3 : 1);
    if (!blobRef || !blobRef.parent) blobRef = scene.getObjectByName('contact-shadows') || null;
    const m = blobRef && blobRef.material;
    if (m && m.uniforms && m.uniforms.uTP0 !== tpU.uTP0) { m.uniforms.uTP0 = tpU.uTP0; m.uniforms.uTP1 = tpU.uTP1; m.uniforms.uTP2 = tpU.uTP2; m.needsUpdate = true; }
  }
  // Everything that changes the ground (height, colours, water level) funnels through here: the lake bed is rebuilt at once, the big
  // mesh over a few frames (or at once with sync). env.batch(fn) groups several setters into ONE rebuild.
  let batchDepth = 0, pendingGround = false, pendingSync = false;
  function groundChanged(sync) {
    if (batchDepth > 0) { pendingGround = true; pendingSync = pendingSync || !!sync; return; }
    buildLakePatch();
    restandStones();
    if (sync) { rb = null; rebuildTerrain(tcx, tcz); } else rb = { cx: snap(player.head.x), cz: snap(player.head.z), v: 0 };
  }
  env.batch = (fn, o) => {
    batchDepth++;
    try { fn(env); } finally {
      batchDepth--;
      if (batchDepth === 0 && pendingGround) { const s = pendingSync || !!(o && o.sync); pendingGround = false; pendingSync = false; groundChanged(s); }
    }
    return env;
  };
  function applyTerrain(next, sync, force) {
    let changed = false;
    for (const k in TP_LIMITS) if (TP[k] !== next[k]) { TP[k] = next[k]; changed = true; }
    if (!changed && !force) return;
    syncTP();
    TP.rev = ++terrainRevCount;
    for (const L2 of grassLayers) L2.invalidate(); // the tufts' ground heights were cached for the old terrain
    groundChanged(sync);
    if (changed) ctx.events?.emit('world:terrain-changed', { rev: TP.rev, params: Object.assign({}, TP) });
  }
  ctx.provide('env', env);

  ctx.on('quality:changed', () => applyQuality(lastVR === null ? !!input.presenting : lastVR));
  applyQuality(!!input.presenting); // also runs syncWorldVis()
  syncWorldVis();
  { // the first grass draw lists are built right now (load time), later ones in slices
    const f = player.forward, fl = Math.sqrt(f.x * f.x + f.z * f.z);
    if (fl > 0.3) { gView.x = f.x / fl; gView.z = f.z / fl; }
    for (const L2 of grassLayers) L2.tick(0, player.head.x, player.head.z, gView.x, gView.z, -1);
  }
  if (input.passthrough) setPT(true); // loaded (or hot-reloaded) while a mixed-reality session is running

  // ---- per frame -----------------------------------------------------------------------------
  return {
    update(dt, t) {
      const head = player.head;
      uTime.value = t;
      if (!!input.passthrough !== pt) setPT(!!input.passthrough); // safety net if an event was missed
      if (pt && renderer.getClearAlpha() !== 0) renderer.setClearAlpha(0);

      // ease towards the target palette
      const k = easeSeconds <= 0.001 ? 1 : 1 - Math.exp(-dt * 3 / easeSeconds);
      cur.zenith.lerp(tgt.zenith, k); cur.mid.lerp(tgt.mid, k); cur.horizon.lerp(tgt.horizon, k);
      cur.fog.lerp(tgt.fog, k); cur.hemiSky.lerp(tgt.hemiSky, k); cur.hemiGround.lerp(tgt.hemiGround, k);
      cur.dirCol.lerp(tgt.dirCol, k);
      cur.hemiI += (tgt.hemiI - cur.hemiI) * k; cur.dirI += (tgt.dirI - cur.dirI) * k;
      cur.fogD += (tgt.fogD - cur.fogD) * k;
      cur.stars += (tgt.stars - cur.stars) * k; cur.aurora += (tgt.aurora - cur.aurora) * k;
      skyMat.uniforms.uStars.value = cur.stars;
      skyMat.uniforms.uAurora.value = cur.aurora;
      // travel: the light direction and the sky panorama ease like the palette
      if (L.distanceToSquared(Lt) > 1e-9) { L.lerp(Lt, k).normalize(); if (L.distanceToSquared(Lt) < 1e-7) L.copy(Lt); }
      { const pm = panoU.uPanoMix; const dv = panoTarget - pm.value;
        if (dv !== 0) { pm.value += dv * k; if (Math.abs(dv) < 0.003) { pm.value = panoTarget; if (panoTarget === 0) panoU.uPano.value = panoTex0; } } }
      if (oceanOn) water.position.set(head.x, lakeLevel, head.z);
      if (t >= blobCheckAt) linkBlobShader(t);

      // fog + lights
      { const st = ctx.world.style; uSat.value = st && st.state ? st.state.saturation || 0 : 0; }
      fogOut.copy(cur.fog);
      if (uSat.value !== 0) {
        const l = fogOut.r * 0.2126 + fogOut.g * 0.7152 + fogOut.b * 0.0722, s = 1 + uSat.value;
        fogOut.setRGB(Math.max(0, l + (fogOut.r - l) * s), Math.max(0, l + (fogOut.g - l) * s), Math.max(0, l + (fogOut.b - l) * s));
      }
      fog.color.copy(fogOut);
      fog.density = cur.fogD;
      uFogDensity.value = cur.fogD;
      hemi.color.copy(cur.hemiSky);
      hemi.groundColor.copy(cur.hemiGround);
      hemi.intensity = cur.hemiI * Math.PI;
      sun.color.copy(cur.dirCol);
      sun.intensity = cur.dirI * Math.PI;
      // what an upward-facing Lambert surface receives (pi cancels) -> used by the grass
      uLight.copy(cur.hemiSky).multiplyScalar(cur.hemiI);
      tmpC.copy(cur.dirCol).multiplyScalar(cur.dirI * L.y);
      uLight.add(tmpC);
      uRim.copy(cur.dirCol).multiplyScalar(cur.dirI);

      // passthrough: ease the lights to a neutral room-like key (virtual objects must read against a real room)
      ptL += ((pt ? 1 : 0) - ptL) * (1 - Math.exp(-dt * 3));
      if (!pt && ptL < 0.002) ptL = 0;
      if (ptL > 0) {
        hemi.color.lerp(PT_HEMI_SKY, ptL);
        hemi.groundColor.lerp(PT_HEMI_GND, ptL);
        hemi.intensity += (PT_HEMI_I * Math.PI - hemi.intensity) * ptL;
        sun.color.lerp(PT_SUN_COL, ptL);
        sun.intensity += (PT_SUN_I * Math.PI - sun.intensity) * ptL;
        sunDir.copy(L).lerp(PT_L, ptL).normalize();
        sun.position.copy(sunDir).multiplyScalar(100);
        sunMoved = true;
      } else {
        sunDir.copy(L); // (travel: L can now move, so follow it every frame)
        if (sunMoved || !SHADOWS) sun.position.copy(L).multiplyScalar(100);
        sunMoved = false;
      }
      if (SHADOWS) updateShadowWindow(); // after sunDir is settled; overrides sun.position / target

      // lake + mist + sun shadow on the grass
      sunCol.copy(cur.dirCol).multiplyScalar(0.5 + 0.35 * cur.dirI);
      glowCol.setRGB(1.0, 0.86, 0.95);
      if (SHADOWS) {
        uSunFrac.value.r = tmpC.r / (uLight.r || 1);
        uSunFrac.value.g = tmpC.g / (uLight.g || 1);
        uSunFrac.value.b = tmpC.b / (uLight.b || 1);
      }
      if (mist) {
        mist.position.set(head.x, MIST_TOP, head.z);
        mistU.uCenter.value.set(head.x, head.z);
        mistU.uColor.value.copy(cur.fog).lerp(cur.mid, 0.25).lerp(WHITE, 0.3).multiplyScalar(0.7 + 0.3 * Math.min(1, uLight.g));
      }
      cue.visible = ptL > 0;
      if (cue.visible) {
        cueU.uAlpha.value = CUE_ALPHA * ptL;
        const kc = 1 - Math.exp(-dt * 2);
        cueCenter.value.x += (head.x - cueCenter.value.x) * kc;
        cueCenter.value.y += (head.z - cueCenter.value.y) * kc;
      }

      // wind
      const wnd = windOverride !== null
        ? windOverride
        : 0.5 + 0.5 * (0.6 * Math.sin(t * 0.21 + 1.3 * Math.sin(t * 0.07)) + 0.4 * Math.sin(t * 0.53 + 2.0));
      env.wind = wnd;
      uWind.value = wnd;

      // sky follows the head; keep the quiet patch centred on the Omnissiah if it exists
      sky.position.copy(head);
      const op = ctx.world.oracle && ctx.world.oracle.position;
      if (op && op.isVector3) {
        focus.copy(op).sub(head);
        const l = focus.length();
        if (l > 1) focus.multiplyScalar(1 / l); else focus.copy(DEFAULT_FOCUS);
      }

      const vr = !!input.presenting;
      if (vr !== lastVR) applyQuality(vr);

      uCenter.value.set(head.x, head.z);
      if (!pt) { // grass draw lists: time-sliced, only when the player moved or turned (see makeGrassLayer)
        const f = player.forward, fl = Math.sqrt(f.x * f.x + f.z * f.z);
        if (fl > 0.3) { gView.x = f.x / fl; gView.z = f.z / fl; }
        for (let i = 0; i < grassLayers.length; i++) grassLayers[i].tick(dt, head.x, head.z, gView.x, gView.z);
      }
      if (rb) stepTerrain(PC ? 2400 : 900); // perf: the sliced re-centre, a few hundred vertices per frame
      else if (!pt && (Math.abs(head.x - tcx) > RECENTER_DIST || Math.abs(head.z - tcz) > RECENTER_DIST)) {
        rb = { cx: snap(head.x), cz: snap(head.z), v: 0 };
        stepTerrain(PC ? 2400 : 900);
      }
    },
    dispose() {
      // In passthrough scene.fog / background are null (we nulled them): hand the originals back as well.
      // keep.ptRig stays so a reloaded module resumes the session and can still restore the rig on exit.
      if (scene.fog === fog || (pt && scene.fog === null)) scene.fog = prevFog;
      if (scene.background === cur.horizon || (pt && scene.background === null)) scene.background = prevBg;
      if (pt) renderer.setClearAlpha(ptPrevClearAlpha);
      sun.shadow.dispose?.();
      renderer.shadowMap.autoUpdate = true;
    },
  };
}
