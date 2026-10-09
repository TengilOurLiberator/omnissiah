import fs from 'fs';
const o = JSON.parse(fs.readFileSync('D:/omnissiah/.cache/genset/diag-o.json')), q = JSON.parse(fs.readFileSync('D:/omnissiah/.cache/genset/diag-q.json'));
const bad = [];
for (const [n, a] of [['o', o], ['q', q]]) for (const d of a) { if (d.error || d.nan || d.nomap || d.meshes !== 1 || Math.abs(d.minY) > 0.01) bad.push(n + ' ' + JSON.stringify(d)); }
console.log(o.length, q.length, 'issues', bad.length); console.log(bad.slice(0, 40).join('\n'));
const md = (a) => Math.max(...a.size);
console.log('o maxdim off', o.filter((d) => Math.abs(md(d) - 1) > 0.01).map((d) => d.id + ':' + md(d)).join(' '));
console.log('q maxdim off', q.filter((d) => Math.abs(md(d) - 1) > 0.03).map((d) => d.id + ':' + md(d)).join(' '));
