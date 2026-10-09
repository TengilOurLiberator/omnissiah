import fs from 'fs'; import {spawnSync} from 'child_process';
const meta=JSON.parse(fs.readFileSync('D:/omnissiah/.cache/genset/meta.json','utf8'));
const OUT='D:/omnissiah/.cache/genset/sheets/'; const COLS=7, ROWS=5, N=COLS*ROWS, C=224;
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
let n=0;
for(let s=0;s*N<meta.length;s++){
  const part=meta.slice(s*N,(s+1)*N);
  const cells=part.map(i=>`<div class=c><img src="file:///D:/omnissiah/public/assets/generated/startzone/${i.id}.png"><b${i.opt&&i.opt.warn?' class=w':''}>${i.id}${i.opt&&i.opt.warn?' *':''}</b></div>`).join('');
  const html=`<!doctype html><meta charset=utf8><style>body{margin:0;background:#fff;font:11px Arial;width:${COLS*C}px}.c{float:left;width:${C}px;height:${C+16}px;overflow:hidden}.c img{width:${C}px;height:${C}px;display:block}b{display:block;text-align:center;background:#222;color:#fff;font-size:11px;height:16px;line-height:16px;white-space:nowrap;overflow:hidden}b.w{background:#a30}</style>${cells}`;
  const hp=OUT+`sheet${String(s+1).padStart(2,'0')}.html`; fs.writeFileSync(hp,html);
  const h=ROWS*(C+16);
  const r=spawnSync(chrome,['--headless=new','--enable-unsafe-swiftshader','--user-data-dir=D:/omnissiah/.cache/genset/chrome-prof','--allow-file-access-from-files',`--window-size=${COLS*C},${h}`,'--virtual-time-budget=8000','--hide-scrollbars',`--screenshot=${OUT}sheet${String(s+1).padStart(2,'0')}.png`,'file:///'+hp],{timeout:90000});
  console.log('sheet',s+1,part[0].id,'..',part[part.length-1].id,r.status);
}
