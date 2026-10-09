// core/style.js â€” world.style: ONE global, toggleable look for everything in the scene (also things created later). Settings persist across hot reloads.
//   const style = ctx.world.style;                       // guard: it may be reloading
//   style.preset('painterly' | 'storybook' | 'flat' | 'noir' | 'neon' | 'pastel')   // restyle the whole world in one call ('painterly' is the default look: soft warm PBR light for the textured generated models)
//   style.set({ toon, bands, softness, rim, rimColor, saturation, fill, outline, outlineWidth, outlineColor, reflections, reflectionStrength, contactShadows })
//   style.get() -> copy of the settings     style.presets -> the settings each preset applies
//   toon true|false|0..1 banded light on every lit material (bands 2..6, softness 0.02..1)    rim 0..1.5 fresnel rim light (rimColor: colour or null = sky tint)
//   saturation -1..1: +0.2 punchier, -0.3 pastel, -1 black and white    fill 0..1 lifts shadowed sides (soft, pastel look)
//   outline true|false ink outlines on characters/props (PC tier only; outlineWidth px, outlineColor)    reflections true|false (sky reflections on metals/glTF)
//   contactShadows true|false soft blob shadows under things (the Quest's substitute for shadow maps)
//   painterly extras: wrapMix 0..1 (soft wrapped diffuse), hemiScale (ambient strength), lightSat/skySat (saturation of the sun / sky light), keyTint/keyTintMix, skyTint/skyTintMix/groundTint (pull the light colours towards neutral-warm so baked colours stay true), shoulder 0..1 (soft highlight roll-off), exposure, albedoSat, outlineTextured
//   Contact shadows follow every object automatically (generated props get a footprint measured at their base). Optional: style.contact(object, radius?) forces/overrides one,
//   style.contactPoints([{x, z, r}]) -> { remove() } adds static blobs (instanced scatter lists are picked up by themselves).
//   style.preset('painterly', { time: true }) also sets the flattering late-afternoon sky + sun angle (done once at load when nobody chose a time of day).
//   Opt an object out with  object.userData.noOutline = true  /  object.userData.noShadow = true.
//   Examples:  style.preset('noir')   style.set({ bands: 2, rim: 0.8, rimColor: 0x66ccff })   style.set({ saturation: -1 })   Event 'style:changed' fires after every change.
//   "Comic book" = preset('flat') or set({ bands: 2, outline: true, saturation: 0.3 });  "black and white" = preset('noir') or set({ saturation: -1 }).

export const meta = { name: 'Style', description: 'Global painterly/toon lighting, sky reflections and contact shadows' };

const CHUNKS = ['lights_lambert_pars_fragment', 'lights_phong_pars_fragment', 'lights_physical_pars_fragment'];
const SHADERLIB_KEYS = ['lambert', 'phong', 'standard', 'physical'];
const UNIFORM_NAMES = ['uStyleA', 'uStyleB', 'uStyleC', 'uStyleD', 'uStyleE', 'uStyleF', 'uStyleG', 'uStyleH'];

const STYLE_PARS = /* glsl */`
#ifndef STYLE_PARS_DEFINED
#define STYLE_PARS_DEFINED
#define STYLE_GRADE_AVAILABLE
uniform vec4 uStyleA; // x toon amount, y bands, z softness, w wrap
uniform vec4 uStyleB; // x rim strength, y rim power, z saturation delta, w fill
uniform vec4 uStyleC; // rgb rim tint, a tint mix (0 = sky colour)
uniform vec4 uStyleD; // x ambient (hemisphere) scale minus 1 (0 = unchanged), y wrapped-diffuse mix, z highlight shoulder 0..1, w shoulder ceiling
uniform vec4 uStyleE; // x sun colour saturation delta, y exposure minus 1 (all light), z sky/ground fill saturation delta
uniform vec4 uStyleF; // rgb sun tint (linear), a how far the sun colour is pulled to it (0 = not at all)
uniform vec4 uStyleG; // rgb sky tint, a pull for the hemisphere light
uniform vec4 uStyleH; // rgb ground tint
vec3 styleTint( const in vec3 c, const in vec3 tint, const in float k ) { // same brightness, colour pulled towards the tint
  if ( k <= 0.0 ) return c;
  float lc = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  float lt = max( dot( tint, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
  return mix( c, tint * ( lc / lt ), k );
}
float styleBanded( const in float nl ) {
  float x = saturate( ( nl + uStyleA.w ) / ( 1.0 + uStyleA.w ) );
  float n = max( uStyleA.y, 1.0 );
  float f = x * n;
  float i = floor( f );
  float s = max( uStyleA.z, 0.02 ) * 0.5;
  float e = smoothstep( 0.5 - s, 0.5 + s, f - i );
  return mix( nl, ( i + e ) / n, uStyleA.x );
}
float styleBand( const in float nl ) {
  #ifdef STYLE_NO_BAND
    return nl; // opted out per material through material.defines (the terrain: smooth ground reads better than contour rings)
  #endif
  if ( uStyleA.x <= 0.0 ) { // painterly: no bands, optionally a wrapped (half-Lambert style) diffuse so the terminator is soft
    return uStyleD.y > 0.0 ? mix( nl, saturate( ( nl + uStyleA.w ) / ( 1.0 + uStyleA.w ) ), uStyleD.y ) : nl;
  }
  return styleBanded( nl );
}
vec3 styleSatBy( const in vec3 c, const in float d ) {
  if ( abs( d ) < 0.001 ) return c;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  return max( mix( vec3( l ), c, 1.0 + d ), vec3( 0.0 ) );
}
vec3 styleSat( const in vec3 c ) { return styleSatBy( c, uStyleB.z ); }
// painterly terms (light colour, ambient scale, exposure, shoulder) are skipped for materials opted out with STYLE_NO_BAND (the terrain keeps the look its grass was tuned for)
vec3 styleLightSat( const in vec3 c ) {
  #ifdef STYLE_NO_BAND
    return styleSatBy( c, uStyleB.z );
  #endif
  return styleSatBy( styleTint( c * ( 1.0 + uStyleE.y ), uStyleF.rgb, uStyleF.a ), uStyleB.z + uStyleE.x );
}
vec3 styleSkySat( const in vec3 c, const in vec3 n ) {
  #ifdef STYLE_NO_BAND
    return styleSatBy( c, uStyleB.z );
  #endif
  vec3 tint = uStyleG.rgb;
  #if NUM_HEMI_LIGHTS > 0
    tint = mix( uStyleH.rgb, uStyleG.rgb, dot( n, hemisphereLights[ 0 ].direction ) * 0.5 + 0.5 );
  #endif
  return styleSatBy( styleTint( c * ( 1.0 + uStyleD.x ) * ( 1.0 + uStyleE.y ), tint, uStyleG.a ), uStyleB.z + uStyleE.z );
}
vec3 styleFill() {
  #if NUM_HEMI_LIGHTS > 0
    return hemisphereLights[ 0 ].skyColor * uStyleB.w;
  #else
    return vec3( 0.0 );
  #endif
}
// the sky/ground blend of the hemisphere light, stepped the same way as the sun (adds the difference to what three computed)
vec3 styleAmbient( const in vec3 n ) {
  #if NUM_HEMI_LIGHTS > 0
    #ifdef STYLE_NO_BAND
      return vec3( 0.0 );
    #endif
    if ( uStyleA.x <= 0.0 ) return vec3( 0.0 );
    float x = dot( n, hemisphereLights[ 0 ].direction ) * 0.5 + 0.5;
    return ( hemisphereLights[ 0 ].skyColor - hemisphereLights[ 0 ].groundColor ) * ( styleBanded( x ) - x );
  #else
    return vec3( 0.0 );
  #endif
}
// soft highlight shoulder on the brightest channel (keeps the hue): bright baked textures roll off instead of clipping
vec3 styleGrade( const in vec3 c ) {
  if ( uStyleD.z <= 0.0 ) return c;
  float m = max( c.r, max( c.g, c.b ) );
  const float k = 0.74;
  if ( m <= k ) return c;
  float span = max( uStyleD.w - k, 0.05 );
  float f = k + span * ( 1.0 - exp( -( m - k ) / span ) );
  return c * ( mix( m, f, uStyleD.z ) / m );
}
vec3 styleRim( const in vec3 n, const in vec3 v, const in vec3 albedo ) {
  if ( uStyleB.x <= 0.0 ) return vec3( 0.0 );
  float f = pow( 1.0 - saturate( dot( n, v ) ), max( uStyleB.y, 0.5 ) );
  vec3 tint = vec3( 0.6 );
  float up = 1.0;
  #if NUM_HEMI_LIGHTS > 0
    tint = hemisphereLights[ 0 ].skyColor * RECIPROCAL_PI;
    float nu = dot( n, hemisphereLights[ 0 ].direction );
    // sides and undersides catch the rim; near-horizontal surfaces (ground, table tops) do not, or the whole field would haze over
    up = ( 0.4 + 0.6 * saturate( nu * 0.5 + 0.5 ) ) * ( 1.0 - smoothstep( 0.55, 0.95, nu ) );
  #endif
  tint = mix( tint, uStyleC.rgb, uStyleC.a );
  return tint * ( f * up * uStyleB.x );
}
#endif
`;

const DIRECT_FROM = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
const DIRECT_TO = 'reflectedLight.directDiffuse += styleBand( dotNL ) * styleLightSat( directLight.color ) * BRDF_Lambert( styleSat( material.diffuseColor ) );';
const INDIRECT_FROM = 'reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
const INDIRECT_TO = 'reflectedLight.indirectDiffuse += styleSkySat( irradiance + styleFill() + styleAmbient( geometryNormal ), geometryNormal ) * BRDF_Lambert( styleSat( material.diffuseColor ) ) + styleRim( geometryNormal, geometryViewDir, material.diffuseColor );';
const GRADE_CHUNK = 'tonemapping_fragment';
const GRADE_PRE = '#if defined( STYLE_GRADE_AVAILABLE ) && !defined( STYLE_NO_BAND )\n  gl_FragColor.rgb = styleGrade( gl_FragColor.rgb );\n#endif\n';

// ------------------------------------------------------------------ outline shaders
const OUTLINE_VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
attribute vec3 aSmooth;
uniform float uWidth;
uniform vec2 uInvRes; // 2 / eye resolution in pixels
void main() {
  vec3 objectNormal = aSmooth;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = vec3( position );
  #include <skinning_vertex>
  #include <project_vertex>
  vec3 nrm = objectNormal;
  #ifdef USE_INSTANCING
    nrm = mat3( instanceMatrix ) * nrm;
  #endif
  vec3 nv = normalize( normalMatrix * nrm );
  vec2 nd = ( projectionMatrix * vec4( nv, 0.0 ) ).xy;
  float l = length( nd );
  nd = l > 1e-5 ? nd / l : vec2( 0.0 );
  float px = uWidth * ( 1.0 - 0.55 * smoothstep( 12.0, 70.0, -mvPosition.z ) );
  gl_Position.xy += nd * px * uInvRes * gl_Position.w;
  #include <fog_vertex>
}
`;
const OUTLINE_FRAG = /* glsl */`
uniform vec3 uColor;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4( uColor, 1.0 );
  #include <fog_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------ contact shadow shader
const BLOB_VERT = (terrainGLSL) => /* glsl */`
attribute vec4 aBlob; // x, z, radius, opacity
uniform float uFlat;
uniform float uLift;
varying vec2 vUv;
varying float vA;
varying float vFogDepth;
${terrainGLSL || 'float terrainH(vec2 p) { return 0.0; }'}
void main() {
  vec2 p = aBlob.xy + position.xz * aBlob.z;
  // lifted into the grass layer (not just onto the ground): blades behind the plane darken, blades in front occlude it
  float y = mix(terrainH(p), 0.0, uFlat) + uLift + (1.0 - uFlat) * 0.06 * min(aBlob.z, 2.0);
  vec4 mv = viewMatrix * vec4(p.x, y, p.y, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = position.xz;
  vA = aBlob.w;
  vFogDepth = -mv.z;
}
`;
const BLOB_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uStrength;
uniform float uFogDensity;
varying vec2 vUv;
varying float vA;
varying float vFogDepth;
void main() {
  float r = length(vUv);
  float a = 1.0 - smoothstep(0.15, 1.0, r);
  a = a * (0.55 + 0.45 * a); // broad soft core, long gentle tail
  float f = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
  gl_FragColor = vec4(uColor, a * vA * uStrength * (1.0 - f));
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------ environment (reflection) sky
const ENV_VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const ENV_FRAG = /* glsl */`
uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uGround;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uFocus; uniform vec3 uGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 up = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
  up = mix(up, uZenith, smoothstep(0.12, 0.9, h));
  vec3 dn = mix(uHorizon * 0.55, uGround, smoothstep(0.0, 0.5, -h));
  vec3 col = h >= 0.0 ? up : dn;
  col += uHorizon * 0.6 * pow(max(dot(d, uSunDir), 0.0), 4.0);
  col += uSunCol * 2.2 * pow(max(dot(d, uSunDir), 0.0), 40.0);
  col += uGlow * 1.6 * pow(max(dot(d, uFocus), 0.0), 14.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ presets
const DEFAULTS = {
  toon: 1, bands: 3, softness: 0.35, wrap: 0.1,
  rim: 0.35, rimPower: 3, rimColor: null, fill: 0, saturation: 0.1,
  outline: true, outlineWidth: 1.6, outlineColor: 0x140a1e,
  reflections: true, reflectionStrength: 0.7, questReflections: false,
  contactShadows: true, contactStrength: 0.75, contactColor: 0x080414, contactShift: 0,
  // painterly controls (all neutral here: the old presets look exactly as before)
  keyTint: 0xffe2b8, keyTintMix: 0, skyTint: 0xcfd6e6, skyTintMix: 0, groundTint: 0x9a8c70,
  wrapMix: 0, hemiScale: 1, hemiEnv: 1, lightSat: 0, skySat: 0, albedoSat: 0, exposure: 1, shoulder: 0, shoulderTop: 1, outlineTextured: true,
};
const DEFAULT_PRESET = 'painterly';
const PRESETS = {
  // Soft warm PBR light for the baked, hand-painted generated models. No bands, no ink, wrapped diffuse, tamed light colours,
  // a gentle highlight shoulder, a modest sky environment (PC), a bluish soft contact shadow (Quest: nudged away from the sun).
  painterly: {
    ...DEFAULTS, toon: 0, wrap: 0.4, wrapMix: 1, rim: 0, fill: 0, saturation: 0.06, albedoSat: -0.15, lightSat: -0.3, skySat: 0, keyTintMix: 0.7, skyTintMix: 0.6, exposure: 0.92,
    outline: false, outlineTextured: false, reflections: true, reflectionStrength: 0.5, questReflections: false,
    hemiScale: 1, hemiEnv: 0.75, shoulder: 0.9, shoulderTop: 1, contactStrength: 0.55, contactColor: 0x2a2446, contactShift: 1,
  },
  storybook: { ...DEFAULTS },
  flat: {
    ...DEFAULTS, toon: 0, rim: 0, fill: 0, saturation: 0, outline: false, reflections: false, contactShadows: false,
  },
  noir: {
    ...DEFAULTS, bands: 2, softness: 0.18, wrap: 0, rim: 0.8, rimColor: 0xc4d0ff, saturation: -0.92,
    outlineWidth: 2.2, outlineColor: 0x000000, reflectionStrength: 0.5, contactStrength: 0.85,
  },
  neon: {
    ...DEFAULTS, bands: 3, softness: 0.25, rim: 1.2, rimPower: 2.6, rimColor: 0xff40e0, saturation: 0.55,
    outlineWidth: 1.4, outlineColor: 0x07021a, reflectionStrength: 1.2, contactStrength: 0.7,
  },
  pastel: {
    ...DEFAULTS, bands: 3, softness: 0.65, wrap: 0.25, rim: 0.22, fill: 0.3, saturation: -0.2,
    outlineWidth: 1.1, outlineColor: 0x5a4a72, reflectionStrength: 0.45, contactStrength: 0.35,
  },
};

export default function (ctx) {
  const { THREE, scene, renderer } = ctx;
  const { Color, Vector2, Vector3, Box3 } = THREE;
  const PC = !!(ctx.quality && ctx.quality.pc);
  const keep = ctx.state;
  const SC = THREE.ShaderChunk;
  const SL = THREE.ShaderLib;
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // ================================================================== state
  if (!keep.presetName) keep.presetName = keep.style ? 'custom' : DEFAULT_PRESET;
  const state = Object.assign({}, DEFAULTS, keep.style || PRESETS[DEFAULT_PRESET]);
  const toColor = (c) => (c && c.isColor ? c.clone() : new Color(c));

  // ================================================================== lighting patch
  // Originals live in ctx.state so a crashed instance that never restored cannot poison the next one.
  const patched = {};
  let patchOK = true;
  {
    if (!keep.orig) {
      keep.orig = {};
      for (const k of CHUNKS) keep.orig[k] = SC[k];
      keep.origCacheKey = THREE.Material.prototype.customProgramCacheKey;
    }
    if (typeof keep.orig[GRADE_CHUNK] !== 'string') keep.orig[GRADE_CHUNK] = SC[GRADE_CHUNK];
    for (const k of CHUNKS) {
      const src = keep.orig[k];
      if (typeof src !== 'string' || !src.includes(DIRECT_FROM) || !src.includes(INDIRECT_FROM)) { patchOK = false; continue; }
      patched[k] = STYLE_PARS + src.split(DIRECT_FROM).join(DIRECT_TO).split(INDIRECT_FROM).join(INDIRECT_TO);
    }
    if (patchOK && typeof keep.orig[GRADE_CHUNK] === 'string') patched[GRADE_CHUNK] = GRADE_PRE + keep.orig[GRADE_CHUNK];
    if (!patchOK) console.warn('[style] three.js lighting chunks changed shape; toon/rim lighting disabled');
  }
  const ALL_CHUNKS = CHUNKS.concat([GRADE_CHUNK]);
  // the program cache key follows the patched source: a reloaded style.js with different shader text must not reuse stale programs
  let patchKey = 0;
  for (const k of ALL_CHUNKS) { const s = patched[k] || ''; for (let i = 0; i < s.length; i += 7) patchKey = (patchKey * 31 + s.charCodeAt(i)) | 0; }
  const A = new Float32Array(4), B = new Float32Array(4), C = new Float32Array(4), D = new Float32Array(4), E = new Float32Array(4), F = new Float32Array(4), G = new Float32Array(4), H = new Float32Array(4);
  const uniformDefs = { uStyleA: { value: A }, uStyleB: { value: B }, uStyleC: { value: C }, uStyleD: { value: D }, uStyleE: { value: E }, uStyleF: { value: F }, uStyleG: { value: G }, uStyleH: { value: H } };
  let litPatched = false;
  const isLit = (m) => m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial || (m.isShaderMaterial && m.lights);

  function recompileAll() {
    const seen = new Set();
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m && !seen.has(m) && isLit(m)) { seen.add(m); m.needsUpdate = true; }
      }
    });
  }
  function installPatch() {
    if (litPatched || !patchOK) return;
    litPatched = true;
    for (const k of ALL_CHUNKS) if (patched[k]) SC[k] = patched[k];
    for (const lib of SHADERLIB_KEYS) if (SL[lib]) for (const n of UNIFORM_NAMES) SL[lib].uniforms[n] = uniformDefs[n];
    const orig = keep.origCacheKey;
    const tag = '|style' + patchKey;
    THREE.Material.prototype.customProgramCacheKey = function () {
      const base = orig.call(this);
      return litPatched && isLit(this) ? base + tag : base;
    };
    recompileAll();
  }
  function removePatch(recompile = true) {
    if (!litPatched) return;
    litPatched = false;
    for (const k of ALL_CHUNKS) if (keep.orig[k]) SC[k] = keep.orig[k];
    for (const lib of SHADERLIB_KEYS) if (SL[lib]) for (const n of UNIFORM_NAMES) delete SL[lib].uniforms[n];
    THREE.Material.prototype.customProgramCacheKey = keep.origCacheKey;
    if (recompile) recompileAll();
  }

  // ================================================================== outlines (PC)
  const smoothCache = new WeakMap(); // geometry -> true (aSmooth attribute computed) | false (not outlinable)
  const outlineMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uWidth: { value: 1.6 }, uInvRes: { value: new Vector2(2 / 1920, 2 / 1080) }, uColor: { value: new Color(0x140a1e) },
    }]),
    vertexShader: OUTLINE_VERT, fragmentShader: OUTLINE_FRAG, side: THREE.BackSide, fog: true,
  });
  outlineMat.name = 'style-outline';
  outlineMat.userData.keep = true; // kit's cleanup and tint effects leave shared materials alone
  const realDispose = outlineMat.dispose.bind(outlineMat);
  outlineMat.dispose = () => {};   // a module unloading must not free the shared program
  const outlines = new Map();      // source mesh -> outline mesh
  let outlineOn = false;
  const OUTLINE_CAP = 150, OUTLINE_MAX_RADIUS = 7, OUTLINE_MIN_RADIUS = 0.04, OUTLINE_MAX_DIST = 70;
  // perf: live overrides from core/perf.js (ctx.quality); undefined = no limit
  const QL = ctx.quality || {};
  const allowed = (k) => QL[k] !== false;
  const outlineCap = () => clamp(Math.round(QL.outlineCap === undefined ? OUTLINE_CAP : +QL.outlineCap || 0), 0, OUTLINE_CAP);

  let outlinePx = 1.6;
  function onOutlineDraw() { // runs right before each outline draws: per-object width on the one shared material
    outlineMat.uniforms.uWidth.value = outlinePx * this.userData.ws;
    outlineMat.uniformsNeedUpdate = true;
  }
  function ensureSmooth(geo) {
    let r = smoothCache.get(geo);
    if (r !== undefined) return r;
    r = false;
    const pos = geo.attributes && geo.attributes.position, nor = geo.attributes && geo.attributes.normal;
    if (pos && nor && pos.count > 0 && pos.count <= 40000 && !geo.morphAttributes?.position && !geo.isInstancedBufferGeometry) {
      const n = pos.count, idx = geo.index;
      const sums = new Map();
      const keyOf = (i) => `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
      const keys = new Array(n);
      for (let i = 0; i < n; i++) { keys[i] = keyOf(i); if (!sums.has(keys[i])) sums.set(keys[i], [0, 0, 0]); }
      const tri = idx ? idx.count / 3 : n / 3;
      for (let t = 0; t < tri; t++) {
        const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
        const ux = pos.getX(b) - ax, uy = pos.getY(b) - ay, uz = pos.getZ(b) - az;
        const vx = pos.getX(c) - ax, vy = pos.getY(c) - ay, vz = pos.getZ(c) - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // area-weighted
        for (const i of [a, b, c]) { const s = sums.get(keys[i]); s[0] += nx; s[1] += ny; s[2] += nz; }
      }
      const out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const s = sums.get(keys[i]);
        let l = Math.hypot(s[0], s[1], s[2]);
        if (l < 1e-9) { out[i * 3] = nor.getX(i); out[i * 3 + 1] = nor.getY(i); out[i * 3 + 2] = nor.getZ(i); continue; }
        l = 1 / l;
        out[i * 3] = s[0] * l; out[i * 3 + 1] = s[1] * l; out[i * 3 + 2] = s[2] * l;
      }
      geo.setAttribute('aSmooth', new THREE.BufferAttribute(out, 3));
      r = true;
    }
    smoothCache.set(geo, r);
    return r;
  }

  const outlineCand = []; // reused per sweep: { m, d }
  const candPool = [];
  const _sph = new THREE.Sphere();
  const _wp = new Vector3();
  function outlineEligible(m) {
    if (!m.isMesh || m.userData.isOutline || m.userData.noOutline || !m.visible || m.isSprite) return false;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (!mat || mat.transparent || mat.opacity < 0.98 || mat.depthWrite === false || mat.isShaderMaterial || mat.isMeshBasicMaterial || mat.wireframe) return false;
    if (Array.isArray(m.material) && m.material.length > 1) return false;
    if (!state.outlineTextured && mat.map) return false; // baked, hand-painted textures carry their own shading: no ink on them
    const g = m.geometry;
    if (!g || !g.attributes || !g.attributes.normal) return false;
    if (m.isInstancedMesh && m.count > 300) return false;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const r = g.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis();
    return r >= OUTLINE_MIN_RADIUS && (r <= OUTLINE_MAX_RADIUS || m.isInstancedMesh && r <= 3);
  }
  function makeOutline(src) {
    if (!ensureSmooth(src.geometry)) return null;
    let o;
    if (src.isSkinnedMesh) {
      o = new THREE.SkinnedMesh(src.geometry, outlineMat);
      o.bindMode = src.bindMode;
      o.bind(src.skeleton, src.bindMatrix);
    } else if (src.isInstancedMesh) {
      o = new THREE.InstancedMesh(src.geometry, outlineMat, src.count);
      o.instanceMatrix = src.instanceMatrix; // shares the GPU buffer: always in step with the source
    } else {
      o = new THREE.Mesh(src.geometry, outlineMat);
    }
    o.name = 'style-outline';
    o.frustumCulled = src.isSkinnedMesh || src.isInstancedMesh ? false : src.frustumCulled;
    o.matrixAutoUpdate = false;
    o.castShadow = false; o.receiveShadow = false;
    o.renderOrder = src.renderOrder;
    o.raycast = () => {};
    // small things get a proportionally thinner line (a pebble must not turn into a ring of ink)
    const r = src.geometry.boundingSphere.radius * src.matrixWorld.getMaxScaleOnAxis();
    o.userData = { isOutline: true, noShadow: true, noOutline: true, _shadowed: true, noBlob: true, ws: clamp(0.3 + 0.7 * (r / 0.45), 0.3, 1) };
    o.onBeforeRender = onOutlineDraw;
    src.add(o);
    return o;
  }
  function dropOutline(src, o) {
    if (o.parent) o.parent.remove(o);
    outlines.delete(src);
  }
  function clearOutlines() { for (const [src, o] of [...outlines]) dropOutline(src, o); }

  function sweepOutlines() {
    const cam = ctx.camera;
    cam.getWorldPosition(_wp);
    let n = 0;
    const cx = _wp.x, cy = _wp.y, cz = _wp.z;
    const self = 'module:' + ctx.path;
    for (const root of scene.children) {
      if (!root.name || !root.name.startsWith('module:') || root.name === self || root.name === 'module:core/world.js') continue;
      root.traverse((m) => {
        if (!m.isMesh || m.userData.isOutline) return;
        if (!m.visible) return;
        // an invisible ancestor hides it too (cheap parent walk)
        for (let p = m.parent; p && p !== root; p = p.parent) if (!p.visible) return;
        if (!outlineEligible(m)) return;
        m.getWorldPosition(_wp);
        const d = (_wp.x - cx) * (_wp.x - cx) + (_wp.y - cy) * (_wp.y - cy) + (_wp.z - cz) * (_wp.z - cz);
        if (d > OUTLINE_MAX_DIST * OUTLINE_MAX_DIST) return;
        let c = outlineCand[n];
        if (!c) { c = outlineCand[n] = { m: null, d: 0 }; }
        c.m = m; c.d = d; n++;
      });
    }
    outlineCand.length = n;
    outlineCand.sort((a, b) => a.d - b.d);
    const keepSet = new Set();
    let made = 0;
    const capNow = outlineCap();
    for (let i = 0; i < n && i < capNow; i++) {
      const m = outlineCand[i].m;
      keepSet.add(m);
      const have = outlines.get(m);
      if (have) {
        if (m.isInstancedMesh && have.count !== m.count) have.count = Math.min(m.count, have.instanceMatrix.count);
        continue;
      }
      if (made >= 24) continue; // time-slice: first build of smooth normals can be a little heavy
      const o = makeOutline(m);
      if (o) { outlines.set(m, o); made++; }
    }
    for (const [src, o] of [...outlines]) if (!keepSet.has(src)) dropOutline(src, o);
    for (const c of outlineCand) c.m = null;
  }

  const _vp = new THREE.Vector4();
  let resCheckAt = 0;
  function updateOutlineUniforms(t) {
    if (t < resCheckAt) return;
    resCheckAt = t + 1;
    let w = 0, h = 0;
    if (renderer.xr.isPresenting) {
      const cams = renderer.xr.getCamera().cameras;
      if (cams && cams.length) { _vp.copy(cams[0].viewport); w = _vp.z; h = _vp.w; }
    }
    if (!w) { renderer.getDrawingBufferSize(_blobV2); w = _blobV2.x; h = _blobV2.y; }
    outlineMat.uniforms.uInvRes.value.set(2 / w, 2 / h);
    outlinePx = state.outlineWidth * clamp(h / 1080, 0.8, 2.2);
  }

  // ================================================================== environment reflections
  let pmrem = null, envRT = null, envScene = null, envU = null;
  let envOwned = false, prevEnv = null, prevEnvIntensity = 1;
  const lastPal = { zenith: new Color(), mid: new Color(), horizon: new Color(), dirCol: new Color(), valid: false };
  let envBuiltAt = -10, envDirty = true;
  const groundCol = new Color(), sunCol = new Color();
  const reflectionsActive = () => !!state.reflections && (PC || !!state.questReflections) && allowed('reflections');

  function buildEnv(t) {
    const env = ctx.world.env;
    const pal = env && env.palette;
    if (!pal) return false;
    if (!pmrem) {
      pmrem = new THREE.PMREMGenerator(renderer);
      envU = {
        uZenith: { value: new Color() }, uMid: { value: new Color() }, uHorizon: { value: new Color() }, uGround: { value: new Color() },
        uSunDir: { value: new Vector3(0, 0.3, -1) }, uSunCol: { value: new Color() }, uFocus: { value: new Vector3(0, 0.6, -0.8) },
        uGlow: { value: new Color(1.0, 0.85, 0.95) },
      };
      envScene = new THREE.Scene();
      const m = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
        uniforms: envU, vertexShader: ENV_VERT, fragmentShader: ENV_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      }));
      envScene.add(m);
    }
    envU.uZenith.value.copy(pal.zenith); envU.uMid.value.copy(pal.mid); envU.uHorizon.value.copy(pal.horizon);
    groundCol.copy(pal.hemiGround).lerp(pal.horizon, 0.35).multiplyScalar(0.8);
    envU.uGround.value.copy(groundCol);
    if (env.sunDirection) envU.uSunDir.value.copy(env.sunDirection);
    sunCol.copy(pal.dirCol).multiplyScalar(0.9);
    envU.uSunCol.value.copy(sunCol);
    const op = ctx.world.oracle && ctx.world.oracle.position;
    if (op && op.isVector3) envU.uFocus.value.copy(op).sub(ctx.camera.getWorldPosition(_wp)).normalize();
    const old = envRT;
    envRT = pmrem.fromScene(envScene, 0.02, 0.1, 100, { size: PC ? 128 : 64 });
    scene.environment = envRT.texture;
    if (old) old.dispose();
    lastPal.zenith.copy(pal.zenith); lastPal.mid.copy(pal.mid); lastPal.horizon.copy(pal.horizon); lastPal.dirCol.copy(pal.dirCol);
    lastPal.valid = true;
    envBuiltAt = t; envDirty = false;
    return true;
  }
  function enableEnv() {
    if (!envOwned) {
      if (scene.environment && (!envRT || scene.environment !== envRT.texture)) return; // somebody else owns scene.environment
      prevEnv = scene.environment; prevEnvIntensity = scene.environmentIntensity;
      envOwned = true;
    }
    scene.environmentIntensity = state.reflectionStrength;
    envDirty = true;
  }
  function disableEnv() {
    if (!envOwned) return;
    scene.environment = prevEnv; scene.environmentIntensity = prevEnvIntensity;
    envOwned = false;
    if (envRT) { envRT.dispose(); envRT = null; }
  }
  function palChanged(pal) {
    if (!lastPal.valid) return true;
    const d = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
    return d(pal.zenith, lastPal.zenith) + d(pal.mid, lastPal.mid) + d(pal.horizon, lastPal.horizon) + d(pal.dirCol, lastPal.dirCol) > 0.06;
  }

  // ================================================================== contact shadows
  // One instanced draw: soft discs on the ground under things. PC has real shadow maps, so there they are a faint occlusion pad; on the
  // Quest they are THE shadow, nudged away from the sun (a cheap stand-in for the cast shadow). Generated props (names 'gen:<id>' / 'gen-scatter:<id>',
  // see lib/gen.js) get a footprint measured from the lowest slice of their geometry (trunk, plinth, wheels), not their whole bounding box.
  const BLOB_MAX = 120;
  let blobMesh = null, blobGeo = null, blobAttr = null, blobMat = null;
  const blobData = new Float32Array(BLOB_MAX * 4);
  const _blobV2 = new Vector2();
  const bObj = new Array(BLOB_MAX).fill(null);
  const bOff = new Float32Array(BLOB_MAX * 3);  // world offset from object origin to the footprint centre
  const bRad = new Float32Array(BLOB_MAX), bHalf = new Float32Array(BLOB_MAX);
  const bSX = new Float32Array(BLOB_MAX), bSZ = new Float32Array(BLOB_MAX), bStat = new Uint8Array(BLOB_MAX);
  let bCount = 0;
  const blobBox = new Box3(), blobC = new Vector3(), blobS = new Vector3();
  const blobCand = [];
  const flatU = { value: 0 };
  const liftU = { value: 0.09 }; // height of the blob plane above the ground (in passthrough: 0.01 on the real floor)
  const _m4 = new THREE.Matrix4();
  const contactReg = new Set();     // objects registered with api.contact()
  const statics = new Set();        // handles from api.contactPoints(): { pts: [{ x, z, r, h }] }
  const scatterRec = new WeakMap(); // 'gen-scatter:' group -> [{ x, z, r, h }] (instances never move)
  const baseCache = new WeakMap();  // geometry -> footprint of its lowest slice (or null)
  let blobStamp = 0;

  function ensureBlobs() {
    if (blobMesh) return;
    blobGeo = new THREE.InstancedBufferGeometry();
    const N = 4, verts = [], idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) verts.push((i / N) * 2 - 1, 0, (j / N) * 2 - 1);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    blobGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    blobGeo.setIndex(idx);
    blobAttr = new THREE.InstancedBufferAttribute(blobData, 4).setUsage(THREE.DynamicDrawUsage);
    blobGeo.setAttribute('aBlob', blobAttr);
    blobGeo.instanceCount = 0;
    const tg = ctx.world.env && ctx.world.env.terrainGLSL;
    blobMat = new THREE.ShaderMaterial({
      uniforms: { uFlat: flatU, uLift: liftU, uColor: { value: new Color(state.contactColor) }, uStrength: { value: 0.6 }, uFogDensity: { value: 0 } },
      vertexShader: BLOB_VERT(tg), fragmentShader: BLOB_FRAG, transparent: true, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    blobMesh = new THREE.Mesh(blobGeo, blobMat);
    blobMesh.frustumCulled = false;
    blobMesh.renderOrder = 2;
    blobMesh.name = 'contact-shadows';
    blobMesh.userData = { noShadow: true, noOutline: true, _shadowed: true, noBlob: true };
    ctx.root.add(blobMesh);
  }
  function removeBlobs() {
    bCount = 0;
    if (blobMesh) { blobMesh.visible = false; blobGeo.instanceCount = 0; }
  }

  // footprint of the lowest ~14 % of a geometry (model space), cached per geometry (clones share it)
  function baseOf(geo) {
    let b = baseCache.get(geo);
    if (b !== undefined) return b;
    b = null;
    const pos = geo && geo.attributes && geo.attributes.position;
    if (pos && pos.count > 8) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox, h = bb.max.y - bb.min.y;
      if (h > 1e-5) {
        const cut = bb.min.y + h * 0.14;
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0;
        for (let i = 0, c = pos.count; i < c; i++) {
          if (pos.getY(i) > cut) continue;
          const x = pos.getX(i), z = pos.getZ(i);
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
          n++;
        }
        if (n >= 3) b = { cx: (x0 + x1) * 0.5, cz: (z0 + z1) * 0.5, w: x1 - x0, d: z1 - z0, minY: bb.min.y, h };
      }
    }
    baseCache.set(geo, b);
    return b;
  }
  // radius of the disc for a base slice of size (w, d), world scale s, total height H
  const discRadius = (b, s) => clamp((0.5 * (0.62 * Math.max(b.w, b.d) + 0.38 * Math.min(b.w, b.d)) * 1.45 + b.h * 0.04) * s, 0.12, 3.4);

  function genFoot(c, f) {
    let m = null;
    for (let i = 0; i < c.children.length; i++) if (c.children[i].isMesh) { m = c.children[i]; break; }
    if (!m) return false; // still loading
    const b = baseOf(m.geometry);
    if (!b) return false;
    c.updateWorldMatrix(true, true);
    const e = m.matrixWorld.elements;
    const s = Math.hypot(e[0], e[1], e[2]);
    blobC.set(b.cx, b.minY, b.cz).applyMatrix4(m.matrixWorld);
    const H = b.h * s;
    f.ox = blobC.x - c.position.x; f.oy = blobC.y + H * 0.5 - c.position.y; f.oz = blobC.z - c.position.z;
    f.r = discRadius(b, s); f.h = H * 0.5;
    return true;
  }

  // Contact-shadow sweep, time-sliced. A pass visits the top-level objects a few at a time under a ~0.6 ms budget, and
  // each object's footprint (size, offset from its origin, solidity) is cached for FOOT_TTL seconds, so most visits are a few
  // arithmetic ops.
  const FOOT_TTL = 4;
  const footCache = new WeakMap(); // object -> { at, ok, ox, oy, oz, r, h }
  const blobWork = [];
  const scatterWork = [];
  let blobRun = false, blobCursor = 0, blobN = 0;
  const _now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function footprint(c, t) {
    let f = footCache.get(c);
    if (f && t - f.at < FOOT_TTL) return f;
    if (!f) f = { at: 0, ok: false, ox: 0, oy: 0, oz: 0, r: 0, h: 0 };
    f.at = t + Math.random() * 0.8; // spread re-measures over time
    f.ok = false;
    const ud = c.userData;
    if (c.name && c.name.startsWith('gen:')) {
      if (genFoot(c, f)) f.ok = true; else f.at = t - FOOT_TTL + 0.5; // geometry not there yet: look again soon
    } else if (!(c.isLight || c.isPoints || c.isSprite || c.isLine || c.isCamera || (c.isInstancedMesh && c.count > 8))) {
      let solid = !!ud.contactForce;
      if (!solid) c.traverse((m) => {
        if (solid || !m.isMesh || m.userData.isOutline) return;
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        if (!mat || mat.transparent || mat.isShaderMaterial || mat.isMeshBasicMaterial || mat.depthWrite === false) return;
        solid = true;
      });
      if (solid) {
        c.updateWorldMatrix(true, true);
        blobBox.setFromObject(c);
        if (!blobBox.isEmpty()) {
          blobBox.getSize(blobS); blobBox.getCenter(blobC);
          const sx = blobS.x, sz = blobS.z, sy = blobS.y;
          const rad = Math.max(0.5 * Math.max(sx, sz) * 0.82, 0.5 * Math.min(sx, sz) * 1.25) * 1.6;
          if (!(sx > 14 || sz > 14 || sy > 40 || rad < 0.07)) {
            f.ok = true; f.ox = blobC.x - c.position.x; f.oy = blobC.y - c.position.y; f.oz = blobC.z - c.position.z;
            f.r = Math.min(rad, 4); f.h = sy * 0.5;
          }
        }
      }
    }
    if (f.ok && ud.contactRadius > 0) f.r = ud.contactRadius;
    footCache.set(c, f);
    return f;
  }
  function beginBlobSweep() {
    ensureBlobs();
    blobWork.length = 0; scatterWork.length = 0;
    blobStamp++;
    const self = 'module:' + ctx.path;
    for (const root of scene.children) {
      if (!root.name || !root.name.startsWith('module:') || root.name === self || root.name === 'module:core/world.js') continue;
      for (const c of root.children) {
        if (c.name && c.name.startsWith('gen-scatter:')) { scatterWork.push(c); continue; }
        c.userData._bs = blobStamp;
        blobWork.push(c);
      }
    }
    for (const c of contactReg) {
      if (!c.parent) { contactReg.delete(c); continue; }
      if (c.userData._bs !== blobStamp) { c.userData._bs = blobStamp; blobWork.push(c); }
    }
    blobRun = true; blobCursor = 0; blobN = 0;
    ctx.camera.getWorldPosition(_wp);
  }
  function pushCand(o, d, ox, oy, oz, r, h, stat, sx, sz) {
    let e = blobCand[blobN];
    if (!e) e = blobCand[blobN] = { o: null, d: 0, ox: 0, oy: 0, oz: 0, r: 0, h: 0, st: 0, sx: 0, sz: 0 };
    e.o = o; e.d = d; e.ox = ox; e.oy = oy; e.oz = oz; e.r = r; e.h = h; e.st = stat; e.sx = sx; e.sz = sz;
    blobN++;
  }
  function staticPoint(owner, p) {
    const dx = p.x - _wp.x, dz = p.z - _wp.z, d2 = dx * dx + dz * dz;
    if (d2 <= 110 * 110) pushCand(owner, d2, 0, 0, 0, p.r, p.h, 1, p.x, p.z);
  }
  function addStatics() {
    for (const g of scatterWork) {
      if (!g.parent || !g.visible) continue;
      let rec = scatterRec.get(g);
      if (rec === undefined) {
        let im = null;
        for (let i = 0; i < g.children.length; i++) if (g.children[i].isInstancedMesh) { im = g.children[i]; break; }
        if (!im) continue; // not loaded yet
        rec = [];
        const b = baseOf(im.geometry);
        if (b) {
          g.updateWorldMatrix(true, false);
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, _m4);
            _m4.premultiply(g.matrixWorld);
            const e = _m4.elements, s = Math.hypot(e[0], e[1], e[2]);
            blobC.set(b.cx, b.minY, b.cz).applyMatrix4(_m4);
            rec.push({ x: blobC.x, z: blobC.z, r: discRadius(b, s), h: b.h * s * 0.5 });
          }
        }
        scatterRec.set(g, rec);
      }
      for (let i = 0; i < rec.length; i++) staticPoint(g, rec[i]);
    }
    for (const h of statics) for (let i = 0; i < h.pts.length; i++) staticPoint(h.owner, h.pts[i]);
  }
  function stepBlobSweep(t) {
    const t0 = _now();
    let k = 0;
    while (blobCursor < blobWork.length) {
      const c = blobWork[blobCursor++];
      if (c.parent && c.visible && !c.userData.noShadow && !c.userData.noBlob && !c.userData.isOutline) {
        const f = footprint(c, t);
        if (f.ok) {
          const dx = c.position.x + f.ox - _wp.x, dz = c.position.z + f.oz - _wp.z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= 110 * 110) pushCand(c, d2, f.ox, f.oy, f.oz, f.r, f.h, 0, 0, 0);
        }
      }
      if ((++k & 3) === 0 && _now() - t0 > 0.6) return; // continue next frame
    }
    // pass complete: publish the nearest candidates
    blobRun = false;
    addStatics();
    blobCand.length = blobN;
    blobCand.sort((a, b) => a.d - b.d);
    const capN = clamp(Math.round(QL.blobs === undefined ? BLOB_MAX : +QL.blobs || 0), 0, BLOB_MAX);
    bCount = Math.min(blobN, capN);
    for (let i = 0; i < bCount; i++) {
      const e = blobCand[i];
      bObj[i] = e.o; bOff[i * 3] = e.ox; bOff[i * 3 + 1] = e.oy; bOff[i * 3 + 2] = e.oz;
      bRad[i] = e.r; bHalf[i] = e.h; bStat[i] = e.st; bSX[i] = e.sx; bSZ[i] = e.sz;
    }
    for (let i = bCount; i < BLOB_MAX; i++) bObj[i] = null;
    for (const e of blobCand) e.o = null;
  }
  function updateBlobs() {
    if (!blobMesh) return;
    const ground = ctx.world.groundHeight;
    const env = ctx.world.env;
    const k = state.contactStrength;
    blobMat.uniforms.uStrength.value = PC ? k * 0.55 : k; // PC has real shadows: a faint occlusion pad only
    flatU.value = env && env.passthrough ? 1 : 0;
    liftU.value = flatU.value ? 0.01 : 0.09;
    const fog = scene.fog;
    blobMat.uniforms.uFogDensity.value = fog && fog.density ? fog.density : 0;
    // direction the shadows fall (away from the sun), horizontal; only where there is no shadow map
    let shx = 0, shz = 0;
    if (!PC && state.contactShift > 0 && env && env.sunDirection) {
      const sd = env.sunDirection, l = Math.hypot(sd.x, sd.z);
      if (l > 1e-3) { shx = -sd.x / l * state.contactShift; shz = -sd.z / l * state.contactShift; }
    }
    let n = 0;
    for (let i = 0; i < bCount; i++) {
      const o = bObj[i];
      if (!o || !o.parent || !o.visible) continue;
      let x, z, rad, fade;
      if (bStat[i]) { x = bSX[i]; z = bSZ[i]; rad = bRad[i]; fade = 1; }
      else {
        const p = o.position;
        x = p.x + bOff[i * 3]; z = p.z + bOff[i * 3 + 2];
        const cy = p.y + bOff[i * 3 + 1];
        const gy = ground ? ground(x, z) : 0;
        const h = cy - bHalf[i] - gy;                      // clearance between the underside and the ground
        const lift = h < 0 ? 0 : h;
        fade = 1 - clamp((lift - 0.05) / (0.9 + bRad[i] * 1.6), 0, 1);
        if (fade <= 0.02) continue;
        fade = fade * fade * (3 - 2 * fade);
        rad = bRad[i] * (1 + 0.45 * lift);
      }
      if (shx !== 0 || shz !== 0) {
        const sh = Math.min(bHalf[i] * 0.5, rad * 0.85);
        x += shx * sh; z += shz * sh;
      }
      const j = n * 4;
      blobData[j] = x; blobData[j + 1] = z;
      blobData[j + 2] = rad;
      blobData[j + 3] = fade;
      n++;
    }
    blobGeo.instanceCount = n;
    blobMesh.visible = n > 0;
    if (n > 0) blobAttr.needsUpdate = true;
  }

  // ================================================================== apply / API
  function normalise() {
    state.toon = state.toon === true ? 1 : (state.toon === false || state.toon == null ? 0 : clamp(+state.toon || 0, 0, 1));
    state.bands = clamp(Math.round(+state.bands || 3), 2, 6);
    state.softness = clamp(+state.softness || 0, 0.02, 1);
    state.wrap = clamp(+state.wrap || 0, 0, 0.6);
    state.rim = state.rim === true ? 0.35 : (state.rim === false || state.rim == null ? 0 : clamp(+state.rim || 0, 0, 1.5));
    state.rimPower = clamp(+state.rimPower || 3, 0.8, 8);
    state.fill = clamp(+state.fill || 0, 0, 1);
    state.saturation = clamp(+state.saturation || 0, -1, 1);
    state.outlineWidth = clamp(+state.outlineWidth || 1.6, 0.4, 6);
    state.reflectionStrength = clamp(+state.reflectionStrength || 0, 0, 2);
    state.contactStrength = clamp(+state.contactStrength || 0, 0, 1);
    state.contactShift = clamp(+state.contactShift || 0, 0, 2);
    state.wrapMix = clamp(+state.wrapMix || 0, 0, 1);
    state.hemiScale = clamp(+state.hemiScale || 1, 0.2, 3);
    state.hemiEnv = clamp(+state.hemiEnv || 1, 0.2, 2);
    state.lightSat = clamp(+state.lightSat || 0, -1, 1);
    state.albedoSat = clamp(+state.albedoSat || 0, -1, 1);
    state.skySat = clamp(+state.skySat || 0, -1, 1);
    state.keyTintMix = clamp(+state.keyTintMix || 0, 0, 1); state.skyTintMix = clamp(+state.skyTintMix || 0, 0, 1);
    state.exposure = clamp(+state.exposure || 1, 0.3, 2);
    state.shoulder = clamp(+state.shoulder || 0, 0, 1);
    state.shoulderTop = clamp(+state.shoulderTop || 1, 0.9, 2);
    state.outline = !!state.outline; state.reflections = !!state.reflections; state.contactShadows = !!state.contactShadows;
    state.questReflections = !!state.questReflections; state.outlineTextured = !!state.outlineTextured;
  }
  const rimC = new Color(), tintC = new Color();
  function apply() {
    normalise();
    if (reflectionsActive()) enableEnv(); else disableEnv();
    A[0] = state.toon; A[1] = state.bands; A[2] = state.softness; A[3] = state.wrap;
    B[0] = allowed('rim') ? state.rim : 0; B[1] = state.rimPower; B[2] = state.saturation + state.albedoSat; B[3] = state.fill;
    if (state.rimColor != null) { rimC.copy(toColor(state.rimColor)); C[0] = rimC.r; C[1] = rimC.g; C[2] = rimC.b; C[3] = 1; } else { C[0] = C[1] = C[2] = C[3] = 0; }
    // painterly: the sky environment adds its own ambient light on PC, so the hemisphere light steps back by hemiEnv
    D[0] = state.hemiScale * (envOwned ? state.hemiEnv : 1) - 1; D[1] = state.wrapMix; D[2] = state.shoulder; D[3] = state.shoulderTop + (PC ? 0.12 : 0); // PC: a little headroom for the bloom
    tintC.set(state.keyTint); F[0] = tintC.r; F[1] = tintC.g; F[2] = tintC.b; F[3] = state.keyTintMix;
    tintC.set(state.skyTint); G[0] = tintC.r; G[1] = tintC.g; G[2] = tintC.b; G[3] = state.skyTintMix;
    tintC.set(state.groundTint); H[0] = tintC.r; H[1] = tintC.g; H[2] = tintC.b; H[3] = 0;
    E[0] = state.lightSat - state.albedoSat; E[1] = state.exposure - 1; E[2] = state.skySat - state.albedoSat; E[3] = 0;
    const need = state.toon > 0 || state.rim > 0 || Math.abs(state.saturation + state.albedoSat) > 0.001 || state.fill > 0 || state.wrapMix > 0 || state.shoulder > 0 || Math.abs(D[0]) > 0.001 || Math.abs(state.lightSat) > 0.001 || Math.abs(state.skySat) > 0.001 || state.keyTintMix > 0 || state.skyTintMix > 0 || Math.abs(state.exposure - 1) > 0.001;
    if (need) installPatch(); else removePatch();

    outlineOn = PC && state.outline && allowed('outlines');
    if (outlineOn) {
      outlineMat.uniforms.uColor.value.copy(toColor(state.outlineColor));
      resCheckAt = 0;
      outAt = 0;
    } else clearOutlines();

    if (state.contactShadows) { ensureBlobs(); blobMat.uniforms.uColor.value.set(state.contactColor); blobAt = 0; } else removeBlobs();
    keep.style = JSON.parse(JSON.stringify(state, (k, v) => (v && v.isColor ? v.getHex() : v)));
  }

  // ================================================================== the default look: late-afternoon golden light (set once, only if nobody chose a time of day)
  // World.env restores (weather, travel, blast) put the time of day back, so the look is expressed as a time-of-day value plus the sun direction
  // (which no restore of the palette touches); the light COLOURS are tamed per pixel by lightSat, whatever the palette is.
  const LOOKS = { painterly: { time: 0.9, dir: [0.72, 0.30, -0.42] } };
  let easeBack = null, easeAt = 0;
  function applyLook(look) {
    const env = ctx.world && ctx.world.env;
    if (!look || !env || env.passthrough || !env.setTimeOfDay) return false;
    let ease = 1.5;
    try { const s = env.snapshot && env.snapshot(); if (s && typeof s.easeSeconds === 'number') ease = s.easeSeconds; } catch (e) { /* ignore */ }
    if (easeBack === null) easeBack = ease;
    env.setTransition(0);
    env.setTimeOfDay(look.time);
    if (env.setLight) env.setLight({ dir: look.dir });
    easeAt = -1; // restored on the first frame that runs after the world has applied it
    return true;
  }
  if (!keep.lookDone) {
    keep.lookDone = true;
    const env = ctx.world && ctx.world.env;
    const away = !!(ctx.world && ctx.world.travel && ctx.world.travel.away);
    if (!keep.style && env && Math.abs((env.timeOfDay === undefined ? 0.5 : env.timeOfDay) - 0.5) < 1e-6 && !away) applyLook(LOOKS[DEFAULT_PRESET]);
  }

  const api = {
    set(o) {
      if (o && typeof o === 'object') for (const k of Object.keys(o)) if (k in DEFAULTS) state[k] = o[k];
      keep.presetName = 'custom';
      apply();
      ctx.events.emit('style:changed', api.get());
      return api;
    },
    get() { return JSON.parse(JSON.stringify(state, (k, v) => (v && v.isColor ? v.getHex() : v))); },
    preset(name, opts) {
      const p = PRESETS[name];
      if (!p) throw new Error(`unknown style preset "${name}"; try ${Object.keys(PRESETS).join(', ')}`);
      Object.assign(state, DEFAULTS, p);
      keep.presetName = name;
      apply();
      if (opts && opts.time && LOOKS[name]) applyLook(LOOKS[name]);
      ctx.events.emit('style:changed', api.get());
      return api;
    },
    // contact shadow for one object (also objects nested deeper than the module root, or ones the automatic sweep would skip); radius in metres optional
    contact(o, radius) {
      if (o && o.isObject3D) { if (radius > 0) o.userData.contactRadius = +radius; o.userData.contactForce = true; contactReg.add(o); blobAt = 0; }
      return api;
    },
    uncontact(o) { if (o) { contactReg.delete(o); if (o.userData) { delete o.userData.contactRadius; delete o.userData.contactForce; } } return api; },
    // static blobs, e.g. under a scatter: list of { x, z, r, h? } (world metres); returns { remove() }
    contactPoints(list) {
      const h = { owner: ctx.root, pts: [], remove() { statics.delete(h); blobAt = 0; } };
      for (const p of list || []) if (p && isFinite(p.x) && isFinite(p.z)) h.pts.push({ x: +p.x, z: +p.z, r: clamp(+p.r || 0.5, 0.1, 4), h: +p.h || 0.5 });
      statics.add(h); blobAt = 0;
      return h;
    },
    presets: PRESETS,
    get name() { return keep.presetName; }, // current preset name ('custom' after set())
    get state() { return state; }, // live settings object (read-only: world.js reads state.saturation every frame)
    get tier() { return PC ? 'pc' : 'quest'; },
    // effective, tier-limited switches (what is actually running right now)
    get active() { return { lighting: litPatched, outline: outlineOn, reflections: envOwned, contactShadows: !!blobMesh && blobMesh.visible, outlined: outlines.size, blobs: bCount, rim: B[0] > 0 }; },
  };
  ctx.provide('style', api);

  let outAt = 0, blobAt = 0, envAt = 0;
  apply();
  // perf: follow the governor live (only the knobs this module owns trigger work)
  ctx.on('quality:changed', (e) => {
    const c = e && e.changed;
    if (c && !('outlines' in c || 'outlineCap' in c || 'reflections' in c || 'rim' in c || 'blobs' in c)) return;
    apply();
    blobAt = 0;
  });

  return {
    update(dt, t) {
      if (easeBack !== null) {
        if (easeAt < 0) easeAt = t + 0.25; // let the world apply the instant change once, then give the player the normal easing back
        else if (t >= easeAt) { const env = ctx.world && ctx.world.env; if (env && env.setTransition) env.setTransition(easeBack); easeBack = null; }
      }
      if (outlineOn) {
        if (t >= outAt) { outAt = t + 0.4; sweepOutlines(); }
        updateOutlineUniforms(t);
      }
      if (blobMesh && state.contactShadows) {
        if (!blobRun && t >= blobAt) { blobAt = t + 0.5; beginBlobSweep(); }
        if (blobRun) stepBlobSweep(t);
        updateBlobs();
      }
      if (envOwned && t >= envAt) {
        envAt = t + 0.5;
        const pal = ctx.world.env && ctx.world.env.palette;
        if (pal && (envDirty || (t - envBuiltAt > 1.5 && palChanged(pal)))) buildEnv(t);
        scene.environmentIntensity = state.reflectionStrength;
      }
    },
    dispose() {
      if (easeBack !== null) { const env = ctx.world && ctx.world.env; if (env && env.setTransition) env.setTransition(easeBack); easeBack = null; }
      clearOutlines();
      removePatch(true);
      disableEnv();
      if (pmrem) { pmrem.dispose(); pmrem = null; }
      if (envScene) envScene.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      realDispose();
      if (blobMesh) { ctx.root.remove(blobMesh); blobGeo.dispose(); blobMat.dispose(); blobMesh = null; }
      contactReg.clear(); statics.clear();
    },
  };
}
