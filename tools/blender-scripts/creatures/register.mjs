// register.mjs -- finalize raw GLBs into public/assets/hero and add catalogue entries (atomic, re-reads catalog.json right before writing).
//   node register.mjs name1 name2 ...
import fs from 'fs';
import { execFileSync } from 'child_process';
import { load, stats } from './verify.mjs';
const ROOT = 'D:/omnissiah/public/assets', CAT = ROOT + '/catalog.json', EXPD = 'D:/omnissiah/.cache/creatures/export';
const NODE = process.execPath;
const r3 = (x) => +x.toFixed(3);
const META = JSON.parse(fs.readFileSync(new URL('./meta.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const names = process.argv.slice(2);
const added = {};
for (const name of names) {
  const m = META[name]; if (!m) { console.log('no meta for', name); continue; }
  const out = `${ROOT}/hero/${name}.glb`;
  execFileSync(NODE, [new URL('./finalize.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), `${EXPD}/${name}_raw.glb`, out, '--double'], { stdio: 'inherit' });
  const st = stats(await load(out), out);
  if (st.tris > m.budget) console.log('OVER BUDGET', name, st.tris, m.budget);
  added[name] = {
    url: `/assets/hero/${name}.glb`, pack: 'hero', category: m.category, tris: st.tris, size: st.size, min: st.min, rigged: true,
    clips: st.clips.map((c) => c.split(':')[0]), tags: m.tags, license: 'original, made for this game', height: r3(st.size[1]), scale: m.scale ?? 1,
    rig: name, bones: st.bones, draws: st.materials.length, materials: st.materials.length, ownClips: st.clips.length, atlas: 'hero-palette',
    length: r3(st.size[2]), headBone: m.head ?? 'Head', emissive: 'Emissive', facing: '+z', bodyPlan: m.plan,
    durations: Object.fromEntries(st.clips.map((c) => { const [n, d] = c.split(':'); return [n, parseFloat(d)]; })),
  };
  if (m.jaw) added[name].jawBone = m.jaw;
  if (m.mouth) added[name].mouthBone = m.mouth;
  if (m.desc) added[name].desc = m.desc;
  console.log(name, st.tris, 'tris', st.bones, 'bones', st.materials.join('+'), st.size.join('x'), 'min', st.min.join(','), st.kb + 'KB');
}
// atomic: re-read right before writing
const cat = JSON.parse(fs.readFileSync(CAT, 'utf8'));
let n = 0;
for (const [k, v] of Object.entries(added)) {
  if (cat.models[k] && cat.models[k].pack !== 'hero') { console.log('SKIP (taken):', k); continue; }
  cat.models[k] = v; n++;
}
let bytes = 0; for (const f of fs.readdirSync(ROOT + '/hero')) bytes += fs.statSync(ROOT + '/hero/' + f).size;
if (cat.packs?.hero) { cat.packs.hero.models = Object.values(cat.models).filter((x) => x.pack === 'hero').length; cat.packs.hero.bytes = bytes; }
const txt = JSON.stringify(cat, null, 2);
JSON.parse(txt);
const tmp = CAT + '.tmp-creatures';
fs.writeFileSync(tmp, txt);
fs.renameSync(tmp, CAT);
JSON.parse(fs.readFileSync(CAT, 'utf8'));
console.log('catalogue updated:', n, 'entries');

