// sets_pack.mjs -- finalize raw Blender exports into public/assets/hero/<name>.glb, verify them, optionally register them in catalog.json.
//   node sets_pack.mjs <name> [<name> ...] [--catalog]      (run with D:\omnissiah\tools\node\node.exe)
// Catalogue write: re-reads catalog.json right before writing, append/replace only the named hero entries, validates with JSON.parse, atomic rename.
import fs from 'fs';
import { readGlb, writeGlb, compact, externalizePalette } from '../../../.cache/blender/tools/glbtools.mjs';
import { load, stats } from '../../../.cache/blender/tools/verify.mjs';

const ROOT = 'D:/omnissiah/public/assets';
const EXP = 'D:/omnissiah/.cache/blender/export';
const CAT = ROOT + '/catalog.json';
const ORIG = 'original, made for this game';
const r3 = (x) => +x.toFixed(3);

// name -> { cat, scale, tags, desc, tile? (tile length m along X), budget }
const META = JSON.parse(fs.readFileSync(new URL('./sets_meta.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));

const args = process.argv.slice(2);
const wantCat = args.includes('--catalog');
const names = args.filter((a) => !a.startsWith('--'));
const added = {};
for (const name of names) {
  const raw = `${EXP}/${name}_raw.glb`;
  const out = `${ROOT}/hero/${name}.glb`;
  const { json, bin } = readGlb(raw);
  externalizePalette(json);
  json.asset = { version: '2.0', generator: 'omnissiah sets (Blender glTF exporter + sets_pack.mjs)' };
  for (const m of json.materials || []) { if (m.name === 'Emissive') m.emissiveFactor = [1, 1, 1]; delete m.extensions; }
  json.extensionsUsed = (json.extensionsUsed || []).filter((e) => json.materials?.some((m) => m.extensions && e in m.extensions));
  if (!json.extensionsUsed.length) delete json.extensionsUsed;
  delete json.extensionsRequired;
  const nb = compact(json, bin);
  const tmp = out + '.tmp';
  writeGlb(tmp, json, nb);
  fs.renameSync(tmp, out);
  const st = stats(await load(out), out);
  const info = JSON.parse(fs.readFileSync(`${EXP}/${name}.json`, 'utf8'));
  const m = META[name];
  if (!m) { console.log('NO META for', name); continue; }
  const budget = m.budget || 8000;
  console.log(`${name}: ${st.tris} tris (budget ${budget}) ${st.kb} KB nodes=${st.nodes} mats=${st.materials.join('+')} size=${st.size.join('x')} min=${st.min.join(',')}${st.tris > budget ? '  **OVER BUDGET**' : ''}`);
  const e = {
    url: `/assets/hero/${name}.glb`, pack: 'hero', category: m.cat, tris: st.tris, size: st.size, min: st.min, rigged: false, clips: [],
    tags: m.tags, license: ORIG, height: r3(st.size[1]), scale: m.scale ?? 1, draws: st.materials.length, materials: st.materials.length,
    atlas: 'hero-palette', emissive: 'Emissive', description: m.desc,
  };
  if (m.tile) e.tile = { axis: 'x', length: m.tile };
  if (info.chunks.length > 1) e.chunks = info.chunks.map((c) => ({ name: c.name, supports: c.supports }));
  if (m.note) e.note = m.note;
  added[name] = e;
}
if (wantCat) {
  const cat = JSON.parse(fs.readFileSync(CAT, 'utf8'));   // re-read right before writing
  let n = 0;
  for (const [k, v] of Object.entries(added)) {
    if (cat.models[k] && cat.models[k].pack !== 'hero') { console.log('SKIP (name taken by another pack):', k); continue; }
    cat.models[k] = v; n++;
  }
  cat.packs.hero.models = Object.values(cat.models).filter((x) => x.pack === 'hero').length;
  let bytes = 0; for (const f of fs.readdirSync(ROOT + '/hero')) bytes += fs.statSync(ROOT + '/hero/' + f).size;
  cat.packs.hero.bytes = bytes;
  const text = JSON.stringify(cat, null, 2);
  JSON.parse(text);
  const tmp = CAT + '.tmp-sets';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, CAT);
  console.log('catalog updated:', n, 'entries; hero pack models', cat.packs.hero.models);
}
