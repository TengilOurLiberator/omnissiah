// finalize.mjs -- post-process a Blender-exported GLB: shared external palette texture, canonical sampler, compact buffer, generator tag.
//   node finalize.mjs in.glb out.glb [--double]
import { readGlb, writeGlb, compact, externalizePalette } from './glbtools.mjs';
const [, , inp, out, ...flags] = process.argv;
const { json, bin } = readGlb(inp);
externalizePalette(json);
json.asset = { version: '2.0', generator: 'omnissiah hero (Blender glTF exporter + finalize.mjs)' };
if (json.materials) for (const m of json.materials) {
  if (m.name === 'Emissive') { m.emissiveFactor = [1, 1, 1]; }
  if (flags.includes('--double')) m.doubleSided = true;
  delete m.extensions; // KHR_materials_emissive_strength etc. not needed (strength 1)
}
json.extensionsUsed = (json.extensionsUsed || []).filter((e) => json.materials?.some((m) => m.extensions && e in m.extensions));
if (!json.extensionsUsed.length) delete json.extensionsUsed;
delete json.extensionsRequired;
const nb = compact(json, bin);
writeGlb(out, json, nb);
console.log('finalized', out, (nb.length / 1024).toFixed(0) + ' KB bin');
