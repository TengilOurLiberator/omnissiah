import fs from 'fs';
const SZ = 'D:/omnissiah/public/assets/generated/startzone/';
const ids = fs.readdirSync(SZ).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));
const modes = {}; const odd = [];
for (const id of ids) for (const [tag, dir] of [['o', ''], ['q', 'q/']]) {
  const b = fs.readFileSync(SZ + dir + id + '.glb'); const jl = b.readUInt32LE(12); const j = JSON.parse(b.slice(20, 20 + jl).toString());
  const m = j.materials[0]; const pbr = m.pbrMetallicRoughness || {};
  const key = tag + ':' + (m.alphaMode || 'OPAQUE') + ':' + (m.doubleSided ? 'ds' : 'ss') + ':m' + (pbr.metallicFactor ?? 1) + ':emis' + (m.emissiveTexture ? 'T' : m.emissiveFactor ? 'F' : '-') + ':ext' + Object.keys(m.extensions || {}).join('+');
  modes[key] = (modes[key] || 0) + 1;
  if (tag === 'o' && (m.alphaMode && m.alphaMode !== 'OPAQUE')) odd.push(id + ' ' + m.alphaMode);
}
console.log(modes); console.log('non-opaque originals', odd.length, odd.slice(0, 50).join(', '));
