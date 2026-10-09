import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const ROOT='D:\\omnissiah', PUB=path.join(ROOT,'public'), GAME=path.join(PUB,'game'), GS=path.join(ROOT,'.cache','genset');
const PORT=Number(process.env.PORT)||9540;
const EXTRA=process.env.EXTRA||'';
const MANIFEST=process.env.MANIFEST||path.join(GAME,'manifest.json');
const MIME={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.wasm':'application/wasm','.css':'text/css'};
function modules(){
  const man=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
  const out=man.core.filter(p=>fs.existsSync(path.join(GAME,p))).map(p=>({path:p,version:Math.floor(fs.statSync(path.join(GAME,p)).mtimeMs)}));
  if(EXTRA)out.push({path:'creations/zz-genset-test.js',version:Math.floor(fs.statSync(EXTRA).mtimeMs)});
  if(!process.env.NOCREATIONS){const dir=path.join(GAME,'creations');for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.js')&&!f.startsWith('spell-')).sort())out.push({path:'creations/'+f,version:Math.floor(fs.statSync(path.join(dir,f)).mtimeMs)});}
  return out;
}
const WebSocketServer=createRequire(ROOT+'\\package.json')('ws').WebSocketServer;
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://x'); const p=decodeURIComponent(u.pathname);
  if(req.method==='POST'&&p==='/diag'){let b='';req.on('data',d=>b+=d);req.on('end',()=>{const n=(u.searchParams.get('name')||'diag').replace(/[^\w.-]/g,'');fs.writeFileSync(path.join(GS,n+'.json'),b);res.end('ok');});return;}
  if(req.method==='POST'&&p==='/png'){const chunks=[];req.on('data',d=>chunks.push(d));req.on('end',()=>{const n=(u.searchParams.get('name')||'x').replace(/[^\w.-]/g,'');const b=Buffer.concat(chunks).toString();fs.writeFileSync(path.join(GS,'sheets',n+'.png'),Buffer.from(b.replace(/^data:image\/png;base64,/,''),'base64'));res.end('ok');});return;}
  if(p==='/api/modules'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({modules:modules()}));}
  let file;
  if(EXTRA&&p==='/game/creations/zz-genset-test.js'){return fs.readFile(EXTRA,(e,b)=>{res.setHeader('content-type','text/javascript');res.setHeader('cache-control','no-store');res.end(b);});}
  if(p.startsWith('/vendor/three/'))file=path.join(ROOT,'node_modules','three',p.slice(14));
  else if(p.startsWith('/vendor/rapier/'))file=path.join(ROOT,'node_modules','@dimforge','rapier3d-compat',p.slice(15));
  else if(p.startsWith('/gs/'))file=path.join(GS,p.slice(4));
  else file=path.join(PUB,p==='/'?'index.html':p);
  fs.readFile(file,(e,b)=>{if(e){res.statusCode=404;return res.end('nf');}res.setHeader('content-type',MIME[path.extname(file)]||'application/octet-stream');res.setHeader('cache-control','no-store');res.end(b);});
});
const wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',ws=>{ws.on('message',()=>{});ws.send(JSON.stringify({type:'status',state:'idle'}));ws.send(JSON.stringify({type:'reload',modules:modules()}));});
server.listen(PORT,'127.0.0.1',()=>console.log('genset sandbox on',PORT));


