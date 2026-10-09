// Page driver of the blast render harness: fakes the net (replays recorded blast statuses), drives the REAL world.blast / travel / kit / physics modules that
// boot.js loaded, and posts canvas frames and a state report back to the harness server. Query: ?slug=<project>&scenario=vision|arrive|mr&quality=pc|quest
const q = new URLSearchParams(location.search);
const slug = q.get('slug');
const scenario = q.get('scenario') || 'arrive';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (url, body) => fetch(url, { method: 'POST', body }).catch(() => {});
const log = (...a) => { const t = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); console.log(t); return post('/log', t); };
window.addEventListener('error', (e) => log('PAGE ERROR', e.message, e.filename, e.lineno));
window.addEventListener('unhandledrejection', (e) => log('PAGE REJECTION', String(e.reason && e.reason.stack || e.reason)));

const frames = (n) => new Promise((res) => { let i = 0; const f = () => { if (++i >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
async function until(fn, ms, what) { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`); await sleep(100); } }
async function shot(name) {
  const g = window.game;
  g.renderer.render(g.scene, g.camera);
  const url = g.renderer.domElement.toDataURL('image/png');
  await post(`/save?name=${encodeURIComponent(name)}`, url);
  await log('shot', name);
}

// ---------------------------------------------------------------- the recorded statuses
async function loadReplay() {
  const base = `/assets/generated/blasts/${slug}`;
  let rows = null;
  try {
    const r = await fetch(`${base}/status.jsonl`, { cache: 'no-store' });
    if (r.ok) rows = (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { /* synthesise */ }
  const manifest = await (await fetch(`${base}/manifest.json`, { cache: 'no-store' })).json();
  if (rows) { const lastQueued = rows.map((m) => m.stage).lastIndexOf('queued'); if (lastQueued > 0) rows = rows.slice(lastQueued); }   // the log appends: only the latest run
  if (!rows || !rows.some((m) => m.stage === 'objects' && m.result && m.result.object) || !rows.some((m) => m.stage === 'done' && m.result && m.result.place && manifest.place && m.result.place.slug === manifest.place.slug)) rows = synthesise(manifest);
  rows = rows.filter((m) => !m.replay);
  // compress the recorded timeline: the real one takes minutes
  const out = [];
  let t = 0, prev = rows[0].t ?? 0;
  for (const m of rows) { const gap = Math.min(900, Math.max(60, (m.t ?? prev) - prev)); prev = m.t ?? prev; t += gap; out.push({ at: t, msg: m }); }
  return { rows: out, manifest };
}
function synthesise(M) {
  const rows = [];
  let t = 0;
  const add = (stage, state, message, extra = {}) => { t += 400; rows.push({ t, stage, state, message, progress: extra.progress || { done: 0, total: 0 }, result: extra.result ?? null, slug: M.slug }); };
  add('queued', 'running', 'Gathering my thoughts');
  add('image', 'running', 'I am dreaming the place');
  add('image', 'done', 'The vision is ready', { result: { slug: M.slug, image: M.image, thumb: M.thumb, aspect: M.aspect, fov: M.fov, prompt: M.prompt } });
  add('uncover', 'done', `I see ${M.objects.length} things`);
  add('plate', 'done', 'The picture is empty now', { result: { plate: M.plate } });
  M.objects.forEach((o, i) => add('objects', 'running', `The ${o.name} is out of the picture`, { progress: { done: i + 1, total: M.objects.length }, result: { object: { id: o.id, name: o.name, ok: true, count: o.count, url: o.url, from: o.from, position: o.position, yaw: o.yaw, scale: o.scale, size_m: o.size_m, dims: o.dims, material: o.material, fixed: o.fixed, mass: o.mass, grabbable: o.grabbable, hp: o.hp, bounce: o.bounce, friction: o.friction } } }));
  add('objects', 'done', 'things are real now');
  add('place', 'done', 'A world has opened', { result: { place: M.place && M.place.slug } });
  add('layout', 'done', 'Everything stands where it belongs', { result: M });
  add('sounds', 'done', 'The place can be heard');
  add('done', 'done', 'Step inside.', { result: M });
  return rows;
}

// ---------------------------------------------------------------- boot the reduced module set
const g = await (async () => { await until(() => window.game && window.game.events, 20000, 'boot.js'); return window.game; })();
const sent = [];
let replay = null;
g.net.send = (m) => { sent.push(m); if (m && m.type === 'blast' && replay) startReplay(m.id); return true; };
g.events.emit('net:open', {});
await until(() => g.world.blast && g.world.kit && g.world.travel && g.world.physics, 60000, 'modules');
await log('modules ready', Object.keys(g.world).join(','), 'tier', g.quality.tier);
g.rig.position.y = g.world.groundHeight ? g.world.groundHeight(0, 0) : 0;
g.camera.rotation.set(0, 0, 0);
await frames(20);

let gate = { layout: false };
function startReplay(id) {
  const t0 = performance.now();
  replay.rows.forEach(({ at, msg }) => {
    const fire = () => g.events.emit('net:blast_status', { ...msg, id, type: 'blast_status' });
    const delay = at;
    const wait = async () => { await sleep(delay); if (msg.stage === 'layout' || msg.stage === 'done' || msg.stage === 'place') await until(() => gate.layout, 600000, 'gate'); fire(); };
    wait();
  });
  void t0;
}
replay = await loadReplay();
await log('replay rows', replay.rows.length, 'objects', replay.manifest.objects.length);

const report = (label) => {
  const b = g.world.blast.active;
  const props = (b && b.props) || [];
  const rows = props.map((p) => ({ id: p.entry.id, copy: p.copy, state: p.state, pos: p.holder.position.toArray().map((v) => +v.toFixed(2)), size: p.size.map((v) => +v.toFixed(2)), ground: +g.world.groundHeight(p.holder.position.x, p.holder.position.z).toFixed(2), body: !!p.body, grabbable: p.body ? p.body.grabbable : null, destructible: !!p.destructible }));
  return { label, state: b && b.state, stage: b && b.stage, message: b && b.message, props: rows, stats: g.world.physics && g.world.physics.stats && g.world.physics.stats(), travel: g.world.travel.current };
};
const overlaps = (rows) => {
  const bad = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    const dx = Math.abs(a.pos[0] - b.pos[0]), dz = Math.abs(a.pos[2] - b.pos[2]), dy = Math.abs(a.pos[1] - b.pos[1]);
    if (dx < (a.size[0] + b.size[0]) * 0.4 && dz < (a.size[2] + b.size[2]) * 0.4 && dy < (a.size[1] + b.size[1]) * 0.4) bad.push([a.id, b.id]);
  }
  return bad;
};

if (scenario === 'glbs') {
  // a turntable-less contact sheet of every GLB of the project (3/4 view, neutral light): are the models whole, textured, upright, on their base?
  const { GLTFLoader } = await import('/vendor/three/examples/jsm/loaders/GLTFLoader.js');
  const T = g.THREE;
  const sc = new T.Scene(); sc.background = new T.Color(0x8a8f99);
  sc.add(new T.HemisphereLight(0xffffff, 0x555566, 1.6)); const dl = new T.DirectionalLight(0xffffff, 2.2); dl.position.set(2, 4, 3); sc.add(dl);
  const cam = new T.PerspectiveCamera(30, 1, 0.1, 50);
  const man = replay.manifest;
  const cell = 320, cols = 4, rows = Math.ceil(man.objects.length / cols);
  const out = document.createElement('canvas'); out.width = cols * cell; out.height = rows * cell; const o2 = out.getContext('2d');
  const prev = g.renderer.getSize(new T.Vector2()); g.renderer.setSize(cell, cell, false);
  const stats = [];
  for (const [i, ob] of man.objects.entries()) {
    const gltf = await new Promise((res, rej) => new GLTFLoader().load(ob.url, res, undefined, rej));
    const m = gltf.scene; const box = new T.Box3().setFromObject(m); const size = box.getSize(new T.Vector3());
    stats.push({ id: ob.id, size: size.toArray().map((v) => +v.toFixed(2)), minY: +box.min.y.toFixed(3) });
    const holder = new T.Group(); holder.add(m); m.position.y -= (box.min.y + size.y / 2); sc.add(holder); holder.rotation.y = 0.6;
    const r = Math.max(size.x, size.y, size.z) * 1.9; cam.position.set(r * 0.7, r * 0.45, r * 0.9); cam.lookAt(0, 0, 0);
    g.renderer.render(sc, cam);
    o2.drawImage(g.renderer.domElement, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
    o2.fillStyle = '#fff'; o2.font = '14px sans-serif'; o2.fillText(ob.id, (i % cols) * cell + 6, Math.floor(i / cols) * cell + 16);
    sc.remove(holder);
  }
  g.renderer.setSize(prev.x, prev.y, false);
  await post('/save?name=glbs', out.toDataURL('image/png'));
  await log('glbs', stats);
  await post('/done?why=glbs', '');
  throw new Error('stop');
}
try {
  const h = g.world.blast.create({ prompt: replay.manifest.prompt || replay.manifest.name });
  await log('create ->', h.state, h.id);
  if (scenario === 'mr') g.input.passthrough = true;
  // 1. the vision
  await until(() => g.scene.getObjectByName('blast-vision') && h.stage !== 'queued' && h.stage !== 'image', 60000, 'vision');
  await sleep(2600); await frames(10);
  await shot('1-vision-painting');
  // 2. objects pop out
  await until(() => g.world.blast.active && g.world.blast.active.props.length >= 1, 60000, 'first object');
  await sleep(500); await frames(6);
  await shot('2-popout-flying');
  await log(report('flying'));
  const n = replay.manifest.objects.length;
  await until(() => g.world.blast.active && g.world.blast.active.props.length >= n, 120000, 'all objects');
  await sleep(2600); await frames(20);
  await shot('3-staged-ring');
  await log(report('staged'));
  if (scenario === 'vision') { await post('/done?why=vision', ''); throw new Error('stop'); }
  // 3. the place: step in
  gate.layout = true;
  await until(() => h.state === 'arrived', 240000, 'arrival');
  await sleep(1500); await frames(40);
  await log(report('arrived'));
  const yaws = [0, 90, 180, 270];
  for (const y of yaws) {
    g.camera.rotation.set(0, (y * Math.PI) / 180, 0);
    await frames(8);
    await shot(`4-arrived-yaw${y}`);
  }
  g.camera.rotation.set(0, 0, 0);
  await frames(8);
  const rep = report('settled');
  rep.overlaps = overlaps(rep.props);
  rep.floating = rep.props.filter((p) => p.state !== 'gone' && (p.pos[1] - p.size[1] / 2 - p.ground) > 1.2 && !g.world.blast.active.manifest.objects.find((o) => o.id === p.id).supportId && !g.world.blast.active.manifest.objects.find((o) => o.id === p.id).fixed).map((p) => p.id);
  await log(rep);
  // 4. smash one: hit the first breakable prop
  const target = g.world.blast.active.props.find((p) => p.destructible && !p.broken);
  if (target) {
    const pos = target.holder.position.clone();
    g.camera.rotation.set(0, Math.atan2(-(pos.x), -(pos.z)) * -1, 0);
    g.camera.rotation.y = Math.atan2(-pos.x, -pos.z);
    await frames(6);
    g.world.kit.hit(pos, 1.2, 80, { from: 'player', kind: 'blunt' });
    await frames(12);
    await shot('5-smash');
    await sleep(800); await frames(10);
    await shot('5-smash-after');
    await log('smashed', target.entry.id, 'broken', target.broken);
  }
  // 5. leave
  const n0 = g.world.blast.active ? g.world.blast.active.props.length : 0;
  const hh = g.world.blast.home();
  await hh.ready;
  await sleep(500);
  await log({ label: 'home', propsBefore: n0, blastActive: !!g.world.blast.active, travelAway: g.world.travel.away, scene: g.scene.children.filter((c) => /blast/.test(c.name || '')).length });
  await shot('6-home');
  await post('/done?why=ok', '');
} catch (err) {
  if (err.message !== 'stop') { await log('DRIVER FAILED', String(err && err.stack || err)); try { await shot('failed'); } catch { /* ignore */ } await post('/done?why=failed', ''); }
}
