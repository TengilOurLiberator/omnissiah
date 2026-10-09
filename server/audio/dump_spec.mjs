// Writes the spec as a flat [{file,name,prompt,kind}] list for clap_check.py:  node dump_spec.mjs <out.json>
import fs from 'node:fs';
import { SPEC } from './pack_spec.mjs';
const out = [];
for (const e of SPEC) for (let i = 0; i < e.variants; i++) out.push({ file: `${e.name}-${i}.ogg`, name: e.name, kind: e.kind, prompt: e.prompts[i % e.prompts.length] });
fs.writeFileSync(process.argv[2] ?? 'spec_flat.json', JSON.stringify(out, null, 1));
fs.writeFileSync(new URL('./clap_bank.json', import.meta.url), JSON.stringify([...new Set(out.map((o) => o.prompt))], null, 1));
console.log(out.length, 'files');
