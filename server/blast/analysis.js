// Parsing, validating and ranking the "uncover" survey (the model's answer, schema from the reference IMAGE-BLAST.md plus game fields).
// Pure functions, no I/O: unit-tested in test_blast.mjs.
import crypto from 'node:crypto';

export const KIT_MATERIALS = ['wood', 'stone', 'glass', 'metal', 'crystal', 'ice', 'earth', 'cloth'];
export const MOODS = ['calm', 'wonder', 'village', 'tavern', 'tension', 'night', 'sacred', 'dungeon'];
const TERRAINS = ['plain', 'rolling', 'hills', 'dunes', 'craggy', 'island', 'snowfield', 'canyon'];
const DEPTHS = ['near', 'mid', 'far'];
const RESTS = ['floor', 'table', 'shelf', 'wall', 'ceiling', 'object'];

const MAT_ALIASES = [
  [/wood|plank|timber|oak|bamboo|log|crate|barrel|furniture|leather|paper|book/, 'wood'],
  [/stone|rock|marble|concrete|brick|granite|bone|skull|plaster|statue/, 'stone'],
  [/glass|bottle|mirror|window|lens/, 'glass'],
  [/metal|iron|steel|brass|gold|silver|copper|tin|aluminium|aluminum|bronze|chrome|armor|armour|coin|plastic|tech|robot/, 'metal'],
  [/crystal|gem|jewel|diamond|quartz|amethyst/, 'crystal'],
  [/ice|frost|snow/, 'ice'],
  [/clay|ceramic|pottery|terracotta|earth|dirt|soil|mud|sand|porcelain/, 'earth'],
  [/cloth|fabric|cotton|wool|canvas|silk|rope|straw|hay|fruit|vegetable|food|plant|leaf|flower|pumpkin|tent/, 'cloth'],
];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' && typeof v !== 'boolean' ? Number(v) : d);
const str = (v, d = '') => (typeof v === 'string' ? v.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim() : d);
export const slugify = (s, max = 40) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
export const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');

// ---------------------------------------------------------------------------------------------------- JSON extraction
// The model is told "JSON only", but fences, a leading sentence, comments, smart quotes and trailing commas happen.
export function repairJsonText(text) {
  let t = String(text ?? '').replace(/^﻿/, '').trim();
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return t;
  t = t.slice(a, b + 1);
  t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  // comments outside strings
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      out += c;
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && t[i + 1] === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, '$1').replace(/\bNone\b/g, 'null').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false');
}

// -> { value } | { error }
export function extractJson(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { error: 'the answer was empty' };
  for (const candidate of [raw.trim(), repairJsonText(raw)]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === 'object' && !Array.isArray(v)) return { value: v };
      if (Array.isArray(v) && v.length === 1 && v[0] && typeof v[0] === 'object') return { value: v[0] };
    } catch (err) { var last = err; }
  }
  return { error: `not valid JSON (${last?.message ?? 'no object found'})` };
}

// ---------------------------------------------------------------------------------------------------- normalisation
export function materialClass(...hints) {
  const text = hints.flat().filter(Boolean).join(' ').toLowerCase();
  if (KIT_MATERIALS.includes(text.trim())) return text.trim();
  for (const [re, m] of MAT_ALIASES) if (re.test(text)) return m;
  return 'wood';
}

function normBox(b) {
  if (!Array.isArray(b) || b.length < 4) return null;
  let [x0, y0, x1, y1] = b.slice(0, 4).map((v) => num(v, NaN));
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  if (Math.max(x0, y0, x1, y1) > 1.5) return null; // pixel coordinates: unusable without the size, caller falls back
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  x0 = clamp(x0, 0, 0.99); y0 = clamp(y0, 0, 0.99); x1 = clamp(x1, x0 + 0.01, 1); y1 = clamp(y1, y0 + 0.01, 1);
  return [x0, y0, x1, y1].map((v) => Math.round(v * 1000) / 1000);
}

// Fallback boxes when the model gave none: from the words in location_in_image (left/right/centre, foreground/background).
function boxFromWords(loc) {
  const t = String(loc || '').toLowerCase();
  let cx = 0.5, cy = 0.62, w = 0.14, h = 0.2;
  if (/far left|leftmost/.test(t)) cx = 0.1; else if (/left/.test(t)) cx = 0.25;
  if (/far right|rightmost/.test(t)) cx = 0.9; else if (/right/.test(t)) cx = 0.75;
  if (/foreground|front|bottom|lower/.test(t)) { cy = 0.78; w = 0.2; h = 0.28; }
  if (/background|back|far|upper|top/.test(t)) { cy = 0.45; w = 0.1; h = 0.16; }
  return [clamp(cx - w / 2, 0, 0.9), clamp(cy - h / 2, 0, 0.9), clamp(cx + w / 2, 0.1, 1), clamp(cy + h / 2, 0.1, 1)].map((v) => Math.round(v * 1000) / 1000);
}

function normSize(s, name, mats) {
  let a = Array.isArray(s) ? s.map((v) => num(v, NaN)) : (s && typeof s === 'object' ? [s.width ?? s.w, s.height ?? s.h, s.depth ?? s.d].map((v) => num(v, NaN)) : []);
  if (a.length === 1 && Number.isFinite(a[0])) a = [a[0], a[0], a[0]];
  if (a.length < 3 || !a.every((v) => Number.isFinite(v) && v > 0)) {
    // a rough prior from the words so the object is not absurd
    const n = `${name} ${mats}`.toLowerCase();
    const sizes = [[/mug|cup|goblet|bottle|candle|skull|coin|key|ring|vial|flask|apple|book/, 0.12], [/lantern|lamp|globe|vase|pot|jug|pitcher|bowl|helmet|crystal|torch/, 0.35], [/stool|bucket|crate|box|basket|chest|barrel|backpack|pack|sack|log|sword|stand/, 0.7],
      [/chair|armchair|table|bench|cabinet|desk|cart|tent|console|robot/, 1.2]];
    const m = sizes.find(([re]) => re.test(n));
    const d = m ? m[1] : 0.6;
    a = [d, d, d];
  }
  return a.slice(0, 3).map((v) => Math.round(clamp(v, 0.03, 12) * 100) / 100);
}

// raw model object -> the flat, defaulted schema. `ctx` supplies the slug and the source image path.
export function normaliseAnalysis(raw, ctx = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const slug = ctx.slug ?? 'scene';
  const setting = ['indoor', 'outdoor', 'underground'].includes(r.setting) ? r.setting : (/indoor|interior|room|inside/i.test(`${r.setting} ${r.environment}`) ? 'indoor' : /cave|underground|dungeon/i.test(`${r.setting} ${r.environment}`) ? 'underground' : 'outdoor');
  const objects = [];
  const seen = new Set();
  for (const [i, o] of (Array.isArray(r.objects) ? r.objects : []).entries()) {
    if (!o || typeof o !== 'object') continue;
    const name = str(o.name);
    if (!name || name.length > 120) continue;
    let id = slugify(o.id || name, 40) || `object-${i}`;
    let k = 2;
    while (seen.has(id)) id = `${slugify(o.id || name, 36)}-${k++}`;
    seen.add(id);
    const materials = (Array.isArray(o.materials) ? o.materials : o.materials ? [o.materials] : []).map((m) => str(m)).filter(Boolean).slice(0, 4);
    const loc = str(o.location_in_image ?? o.evidence?.[0]?.location_in_image);
    const box = normBox(o.box ?? o.bbox ?? o.bounding_box) ?? boxFromWords(loc);
    const boxGuess = !normBox(o.box ?? o.bbox ?? o.bounding_box);
    const rests = RESTS.includes(o.rests_on) ? o.rests_on : /table|desk|counter/.test(str(o.rests_on)) ? 'table' : /shelf/.test(str(o.rests_on)) ? 'shelf' : /wall/.test(str(o.rests_on)) ? 'wall' : /ceil|hang/.test(str(o.rests_on)) ? 'ceiling' : 'floor';
    const count = clamp(Math.round(num(o.count_estimate ?? o.count, 1)), 1, 99);
    objects.push({
      id, name, description: str(o.description), count_estimate: count, materials, source_images: ctx.sourceImages ?? [],
      evidence: [{ image: ctx.sourceImages?.[0] ?? '', location_in_image: loc }],
      location_in_image: loc, box, box_guessed: boxGuess,
      depth: DEPTHS.includes(o.depth) ? o.depth : 'mid',
      size_m: normSize(o.size_m ?? o.size, name, materials.join(' ')),
      rests_on: rests, rests_on_id: typeof o.rests_on_id === 'string' && o.rests_on_id ? slugify(o.rests_on_id, 40) : null,
      fully_visible: o.fully_visible !== false, interest: clamp(Math.round(num(o.interest, 3)), 1, 5),
      break_material: materialClass(o.break_material, materials, name),
      impact_sound: str(o.impact_sound).slice(0, 80),
      generate_as_3d_object: o.generate_as_3d_object !== false,
    });
  }
  // supports named by the model may use its own ids: map names too
  for (const o of objects) {
    if (o.rests_on_id && !objects.some((p) => p.id === o.rests_on_id)) {
      const hit = objects.find((p) => p.id !== o.id && (p.name.toLowerCase().includes(o.rests_on_id.replace(/-/g, ' ')) || p.id.includes(o.rests_on_id)));
      o.rests_on_id = hit ? hit.id : null;
    }
    if (o.rests_on === 'object' && !o.rests_on_id) o.rests_on = 'table';
  }
  const terrain = TERRAINS.includes(r.terrain_hint) ? r.terrain_hint : (setting === 'outdoor' ? 'rolling' : 'plain');
  const mood = MOODS.includes(r.music_mood) ? r.music_mood : (setting === 'underground' ? 'dungeon' : setting === 'indoor' ? 'tavern' : 'calm');
  return {
    schema_version: 1,
    world: slug,
    source_images: ctx.sourceImages ?? [],
    scene_name: str(r.scene_name).slice(0, 60) || 'Unnamed Place',
    short_caption: str(r.short_caption).slice(0, 160),
    literal_description: str(r.literal_description).slice(0, 1200),
    environment: str(r.environment).slice(0, 300),
    visual_style: str(r.visual_style).slice(0, 160),
    lighting: str(r.lighting).slice(0, 300),
    atmosphere: str(r.atmosphere).slice(0, 300),
    ambient_sound: str(r.ambient_sound).slice(0, 200),
    setting,
    ground_type: str(r.ground_type).slice(0, 60) || (setting === 'indoor' ? 'floor' : 'ground'),
    backdrop: str(r.backdrop).slice(0, 60) || (setting === 'indoor' ? 'wall' : 'background'),
    time_of_day: str(r.time_of_day).slice(0, 20) || 'unknown',
    terrain_hint: terrain,
    music_mood: mood,
    fantasy: r.fantasy === true,
    view_problems: (Array.isArray(r.view_problems) ? r.view_problems : []).map((p) => str(p)).filter(Boolean).slice(0, 6),
    horizon_y: clamp(num(r.horizon_y, 0.5), 0.05, 0.95),
    objects,
  };
}

// ---------------------------------------------------------------------------------------------------- choosing what to extract
const touchesEdge = (b) => b[0] < 0.01 || b[1] < 0.01 || b[2] > 0.995 || b[3] > 0.995;
export function scoreObject(o) {
  const [w, h, d] = o.size_m;
  const longest = Math.max(w, h, d);
  let s = o.interest * 1.3;
  s += o.fully_visible ? 2 : -3;
  s += o.depth === 'mid' ? 2 : o.depth === 'near' ? 1 : -1;
  s += longest >= 0.12 && longest <= 1.6 ? 2 : longest > 2.5 ? -6 : longest < 0.07 ? -3 : 0;
  if (touchesEdge(o.box)) s -= 3;
  const area = (o.box[2] - o.box[0]) * (o.box[3] - o.box[1]);
  s += Math.min(5, area * 55);                        // big things define a place
  if (area < 0.0015) s -= 4; else if (area < 0.004) s -= 1;
  if (area > 0.35) s -= 3;
  if (o.rests_on === 'wall' || o.rests_on === 'ceiling') s -= 2;
  if (o.box_guessed) s -= 2;
  return s;
}

// Picks up to `maxObjects` (default 8, cap 14): distinct, complete, mid-ground, grab-or-break-worthy first. A supported object is only taken when its
// support is taken too or it stands on the floor (it is lifted out of the picture on its own either way, so no extra rule is needed there).
export function selectObjects(analysis, { maxObjects = 8 } = {}) {
  const cap = clamp(Math.round(num(maxObjects, 8)), 1, 14);
  const ranked = (analysis.objects || [])
    .filter((o) => o.generate_as_3d_object && Math.max(...o.size_m) <= 3.2 && (o.box[2] - o.box[0]) * (o.box[3] - o.box[1]) >= 0.0008)
    .map((o) => ({ o, score: scoreObject(o) }))
    .filter((x) => x.score > -2);
  // a surface that carries other candidates (desk, table, barrel under a crate) is worth lifting: its things then stand on it
  for (const x of ranked) {
    const kids = ranked.filter((y) => y !== x && y.o.rests_on_id === x.o.id && y.score > 6).length;
    x.score += Math.min(6, kids * 2.5);
  }
  ranked.sort((a, b) => b.score - a.score);
  const out = [];
  for (const { o, score } of ranked) {
    if (out.length >= cap) break;
    // two candidates whose boxes nearly coincide are the same thing seen twice
    if (out.some((p) => iou(p.box, o.box) > 0.6)) continue;
    out.push({ ...o, score, count: clamp(o.count_estimate, 1, 4) });
  }
  return out;
}

export function iou(a, b) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), y1 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
}

// ---------------------------------------------------------------------------------------------------- physics numbers per material
const DENSITY = { wood: 140, stone: 900, glass: 250, metal: 500, crystal: 600, ice: 600, earth: 450, cloth: 60 };   // kg/m3 of the bounding box (things are hollow, thin, partly air)
export function physicsFor(o) {
  const [w, h, d] = o.size_m;
  const vol = w * h * d;
  const mass = clamp(Math.round((DENSITY[o.break_material] ?? 200) * vol * 0.35 * 10) / 10, 0.2, 150);
  const longest = Math.max(w, h, d);
  return {
    mass,
    grabbable: longest <= 1.4 && mass <= 45,
    hp: Math.round(clamp(5 + 10 * longest + mass * 0.15, 6, 45)),
    bounce: o.break_material === 'metal' ? 0.25 : o.break_material === 'cloth' ? 0.05 : 0.15,
    friction: o.break_material === 'ice' ? 0.15 : 0.6,
  };
}

// short object-impact prompt for the audio service (reference sfx skill: "impact one-shot, short-decay, <material description> hitting a hard surface")
export function impactPrompt(o) {
  const phrase = str(o.impact_sound) || `${o.break_material} ${o.name}`;
  return `impact one-shot, short decay, ${phrase.replace(/[.]+$/, '')} hitting a hard floor`.slice(0, 200);
}
export function ambientPrompt(a) {
  const base = str(a.ambient_sound) || (a.setting === 'indoor' ? 'quiet room tone with a faint low hum' : 'soft wind and distant ambience');
  return `ambient environment, ${base.replace(/[.]+$/, '')}`.slice(0, 220);
}
