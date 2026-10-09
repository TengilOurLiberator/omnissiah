// Headless check of the game's own core/models.js with rigged generated models (no browser, no server):
//   node --import ./server/gen3d/register_hooks.mjs server/gen3d/test_models_node.mjs [slug ...]
// A fake ctx + a fetch stub that reads public/ from disk. For every rigged model in public/assets/generated/index.json (or the given slugs):
// spawn it through models.spawn, play every canonical alias, step the mixer, check bones / clips / metadata, then run models.generate with a
// stub `send` that answers like the server (incl. alive: true through a stub kit). Exit code 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { installStubs } from '../../public/assets/_build/nodestubs.mjs';

installStubs();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pub = path.join(root, 'public');
globalThis.fetch = async (url) => {
  const u = String(url).split('?')[0];
  const file = path.join(pub, u.replace(/^\//, ''));
  if (!fs.existsSync(file)) return new Response('nf', { status: 404 });
  const buf = fs.readFileSync(file);
  return new Response(buf, { status: 200, headers: { 'Content-Type': u.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
};

const world = {};
const listeners = new Map();
const disposers = [];
const events = { emit(name, p) { for (const f of listeners.get(name) ?? []) f(p); } };
const sent = [];
const ctx = {
  THREE, state: {}, root: new THREE.Group(), world, quality: { tier: 'pc' }, events, hud: { show() {} },
  provide(name, api) { world[name] = api; }, on(name, fn) { (listeners.get(name) ?? listeners.set(name, []).get(name)).push(fn); }, onDispose(fn) { disposers.push(fn); },
  groundAt: () => 0, player: { head: new THREE.Vector3(0, 1.6, 0), forward: new THREE.Vector3(0, 0, -1) },
  net: { send: (m) => sent.push(m) },
};
ctx.world.kit = null;
const mod = await import(pathToFileURL(path.join(pub, 'game', 'core', 'models.js')).href);
await mod.default(ctx);
const M = ctx.world.models;
const results = [];
let failed = 0;
const check = (name, ok, msg) => { if (!ok) { failed++; console.log(`  FAIL ${name}: ${msg}`); } return ok; };

const index = JSON.parse(fs.readFileSync(path.join(pub, 'assets', 'generated', 'index.json'), 'utf8'));
await M.refreshGenerated();
const want = process.argv.slice(2);
const slugs = Object.keys(index).filter((s) => index[s].rigged && (!want.length || want.includes(s)));
console.log(`rigged generated models: ${slugs.length}; catalogue sees ${M.list({ rigged: true }).filter((n) => M.info(n)?.generated).length}`);

for (const slug of slugs) {
  const e = index[slug];
  console.log(`\n${slug}  (${e.bodyPlan}, ${e.bones} bones, clips: ${e.clips.join(' ')})`);
  check(slug, M.has(slug), 'not registered in the catalogue');
  const info = M.info(slug);
  check(slug, info && info.bodyPlan === e.bodyPlan && info.speeds && info.headBone, 'info() lacks the generated metadata');
  const h = M.spawn(ctx, slug, { position: [0, 0, 0] });
  await h.ready;
  if (!check(slug, h.loaded && !h.error, `spawn failed: ${h.error}`)) continue;
  check(slug, h.bones[e.headBone] && h.bones[e.mouthBone], `bones ${e.headBone} / ${e.mouthBone} missing (have ${Object.keys(h.bones).length})`);
  const aliasOut = {};
  for (const alias of M.aliases) {
    const clip = h.clipFor(alias);
    aliasOut[alias] = clip;
    if (!clip) continue;
    const played = h.play(alias, { fade: 0 });
    check(slug, played === clip, `play('${alias}') returned ${played}, expected ${clip}`);
    for (let i = 0; i < 12; i++) { h.tick(1 / 30, ctx.player.head, ctx.player.forward, i); }
    h.object.updateMatrixWorld(true);
    let bad = false;
    h.root.traverse((o) => { if (o.isBone && (!Number.isFinite(o.position.x + o.quaternion.x + o.quaternion.w + o.scale.x))) bad = true; });
    check(slug, !bad, `NaN in bones after '${alias}'`);
  }
  console.log('  aliases ->', Object.entries(aliasOut).filter(([, v]) => v).map(([k, v]) => (k === v ? k : `${k}=${v}`)).join(' '));
  for (const must of ['idle', 'walk', 'run', 'attack', 'hit', 'die']) check(slug, aliasOut[must], `alias '${must}' unresolved`);
  // kit-style speed matching: walk at the speed kit expects must scale the action by the gait compensation
  h.play('walk', { fade: 0 });
  const comp = h._current.getEffectiveTimeScale();
  h._current.setEffectiveTimeScale(1);
  console.log(`  walk timeScale after kit writes 1.0: ${h._current.getEffectiveTimeScale().toFixed(3)} (raw play wrote ${comp.toFixed(3)})`);
  h.remove();
  results.push(slug);
}

// ---- generate(): cached rigged model -> handle with clips / play; then alive:true through a stub kit
if (slugs.length) {
  const e = index[slugs[0]];
  // default (no animate): the plain static model even though a rigged twin exists
  const gs = M.generate(ctx, e.prompt, { size: 1.2, position: [1, 0, 1] });
  await Promise.race([gs.ready, new Promise((r) => setTimeout(r, 15000))]);
  check('static default', gs.state === 'done' && !gs.rigged && gs.clips.length === 0, `generate() without animate: rigged=${gs.rigged} clips=${gs.clips.length}`);
  console.log(`generate(default): state ${gs.state}, rigged ${gs.rigged}`);
  gs.remove();
  const g = M.generate(ctx, e.prompt, { size: 1.2, position: [2, 0, 3], animate: true });
  await Promise.race([g.ready, new Promise((r) => setTimeout(r, 15000))]);
  check('generate', g.rigged && g.state === 'done' && g.clips.length > 3, `generate(): rigged=${g.rigged} state=${g.state} error=${g.error}`);
  const played = g.play('walk');
  check('generate', played === 'walk', `g.play('walk') -> ${played}`);
  check('generate', Object.keys(g.bones).includes(e.headBone), 'g.bones lacks the head');
  console.log(`generate(cached): state ${g.state}, clips ${g.clips.length}, bones ${Object.keys(g.bones).length}, model ${g.modelName}`);
  g.remove();

  const calls = [];
  ctx.world.kit = { actor: (c, o) => { calls.push(['actor', o]); return { group: new THREE.Group(), wander: (...a) => calls.push(['wander', a]), remove() {} }; } };
  ctx.world.combat = { fighter: (c, a, o) => { calls.push(['fighter', o]); return { remove() {} }; } };
  const g2 = M.generate(ctx, e.prompt, { size: 1.5, position: [4, 0, 0], animate: true, alive: true, faction: 'enemy', fighter: { hp: 30, attack: 'melee' } });
  await Promise.race([g2.ready, new Promise((r) => setTimeout(r, 15000))]);
  check('alive', g2.alive && g2.actor && g2.fighter, `alive wrapper missing: alive=${g2.alive} error=${g2.error}`);
  console.log('generate(alive):', JSON.stringify(calls.map((c) => [c[0], c[1]])).slice(0, 400));
  g2.remove();

  // an uncached wish: the client must ask for animation and understand the server's answer
  sent.length = 0;
  const g3 = M.generate(ctx, 'a tiny test creature nobody has made', { size: 1, animate: true, alive: true });
  await new Promise((r) => setTimeout(r, 300));
  check('wire', sent[0]?.type === 'gen3d' && sent[0].options.animate === true, `unexpected message ${JSON.stringify(sent[0])}`);
  events.emit('net:gen3d_status', { type: 'gen3d_status', id: sent[0].id, state: 'sculpting', message: 'Finding its bones' });
  check('wire', g3.state === 'sculpting' && g3.message === 'Finding its bones', 'status message not relayed');
  g3.remove();
}
// ---- H5 (docs/PERFORMANCE.md): culled characters do not tick, animStride slows the rest, finished deaths stop
if (slugs.length) {
  const mk = async () => { const h = M.spawn(ctx, slugs[0], { position: [0, 0, 0] }); await h.ready; h.play('walk', { fade: 0 }); return h; };
  const h1 = await mk();
  h1.object.userData.perfCulled = true;
  const t0 = h1._current.time;
  for (let i = 0; i < 20; i++) h1.tick(1 / 30, ctx.player.head, ctx.player.forward, i + 1);
  check('H5', h1._current.time === t0, `perfCulled character still advanced (${t0} -> ${h1._current.time})`);
  h1.object.userData.perfCulled = false; h1._hideCheck = 0;
  for (let i = 0; i < 4; i++) h1.tick(1 / 30, ctx.player.head, ctx.player.forward, 100 + i);
  check('H5', h1._current.time > t0, 'character does not animate again after the cull flag is cleared');
  const h2 = await mk();
  ctx.quality.animStride = 4;
  let moved = 0, last = h2._current.time;
  for (let i = 0; i < 16; i++) { h2.tick(1 / 30, ctx.player.head, ctx.player.forward, 200 + i); if (h2._current.time !== last) { moved++; last = h2._current.time; } }
  ctx.quality.animStride = 1;
  check('H5', moved >= 3 && moved <= 5, `animStride 4 should update ~4 of 16 frames, updated ${moved}`);
  console.log(`H5: culled skip ok, animStride 4 -> ${moved}/16 mixer updates`);
  h1.remove(); h2.remove();
}
console.log(`\n${failed ? failed + ' FAILURE(S)' : 'all checks passed'} for ${results.length} model(s)`);
process.exit(failed ? 1 : 0);
