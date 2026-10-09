import fs from 'fs';
const B='D:/omnissiah/tools/startzone-batch/';
const SZ='D:/omnissiah/public/assets/generated/startzone/';
const items=[];
for (const f of ['list.json','list2.json','list3.json']) for (const i of JSON.parse(fs.readFileSync(B+f,'utf8')).items) items.push(i);
const opt=Object.fromEntries(JSON.parse(fs.readFileSync(B+'optimized.json','utf8')).map(x=>[x.id,x]));
const have=items.filter(i=>fs.existsSync(SZ+i.id+'.glb')&&fs.existsSync(SZ+i.id+'.png'));
for(const i of have){i.opt=opt[i.id]||null;}
fs.writeFileSync('D:/omnissiah/.cache/genset/meta.json',JSON.stringify(have,null,1));
console.log(have.length, have.filter(i=>!i.opt).length, 'ids in list without files:', items.length-have.length);
const ids=new Set(have.map(i=>i.id));
console.log('files not in lists:', fs.readdirSync(SZ).filter(f=>f.endsWith('.glb')).map(f=>f.slice(0,-4)).filter(i=>!ids.has(i)));
const dup=have.map(i=>i.id).filter((x,i,a)=>a.indexOf(x)!==i);console.log('dups',dup);
const u=have.filter(i=>!i.ground);console.log('nonground',u.map(i=>i.id).join(' '));
