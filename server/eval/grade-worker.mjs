// Loads creations headlessly and reports what happened. Used by run.mjs (as a child process) and by check-examples.mjs.
//   node --import ./server/eval/register.mjs server/eval/grade-worker.mjs <job.json>
// job: { gameDir, files: ['creations/x.js', ...], seconds: 5, tier: 'pc'|'quest', out: 'result.json' }
// Result (JSON to job.out, and the last stdout line "RESULT <path>"):
//   { boot, files: [{ path, loaded, loadError, updateError, effect: {...}, calls: [...], uses: [...], meshes, cleanup }], mechanisms, sent, ... }
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootGame } from './headless.mjs';
import { analyzeSource, librarySpawnedNames } from './analyze.mjs';

const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = job.out || process.argv[2].replace(/\.json$/, '.result.json');
const result = { ok: false, boot: {}, files: [], sent: [], calls: [], stubCalls: null, mechanisms: [], effect: false, cleanup: { leaks: [] }, hud: [] };
const done = (code = 0) => { fs.writeFileSync(out, JSON.stringify(result, null, 1)); console.log('RESULT ' + out); process.exit(code); };
const watchdog = setTimeout(() => { result.boot.timeout = true; done(2); }, (job.timeoutMs || 90000));

process.on('unhandledRejection', (e) => { (result.unhandled ??= []).push(String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')); });
process.on('uncaughtException', (e) => { (result.unhandled ??= []).push(String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')); });

// ------------------------------------------------------------------ run
try {
  const t0 = performance.now();
  const G = await bootGame({ gameDir: job.gameDir, tier: job.tier || 'pc', skip: job.skip || [] });
  result.boot = { seconds: +((performance.now() - t0) / 1000).toFixed(1), coreLoaded: G.loadedCore.length, loadFailures: G.loadFailures.map((f) => ({ path: f.path, message: f.message })) };
  const before = G.snapshotState();
  const logStart = G.log.length;
  const sentStart = G.sent.length;
  const loaded = [];
  for (const rel of job.files || []) {
    const abs = path.join(job.gameDir, rel);
    const entry = { path: rel, exists: fs.existsSync(abs), loaded: false, emptied: false };
    result.files.push(entry);
    if (!entry.exists) { entry.loadError = 'file missing'; continue; }
    const src = fs.readFileSync(abs, 'utf8');
    entry.bytes = src.length;
    entry.uses = analyzeSource(src);
    entry.libNames = librarySpawnedNames(src);
    if (/^\s*export\s+default\s+function\s*\(\s*\)\s*\{\s*\}\s*;?\s*$/.test(src.trim()) || !src.trim()) { entry.emptied = true; entry.loaded = true; continue; }
    const rec = await G.loadCreation(rel);
    entry.loaded = !rec.failed;
    if (rec.failed) entry.loadError = rec.loadError.message + ' @ ' + (rec.loadError.stack.split('\n')[1] || '').trim();
    else loaded.push(rel);
  }
  // settle async init (creations that await services), then simulate
  await new Promise((r) => setTimeout(r, 30));
  const simT0 = performance.now();
  G.step(job.seconds ?? 5);
  await new Promise((r) => setTimeout(r, 20));
  G.step(0.2);
  result.simSeconds = +((performance.now() - simT0) / 1000).toFixed(2);

  // ---- exercise runtime-only code paths: cast every spell the creations registered, build every weapon type, press buttons
  const exercise = { spells: [], weapons: [], input: null };
  result.exercise = exercise;
  try {
    const { THREE } = G;
    for (const spec of G.stubs.captured.spells) {
      const rec = { id: spec.id, ok: true };
      exercise.spells.push(rec);
      const args = { origin: new THREE.Vector3(0.25, 1.3, -0.4), direction: new THREE.Vector3(0, -0.05, -1).normalize(), hand: G.input.right, ctx: G.modules.get(job.files?.[0])?.ctx ?? {} };
      try {
        if (spec.hold) {
          spec.cast({ ...args, dt: 1 / 30, first: true, hold: true });
          for (let i = 0; i < 20; i++) { spec.cast({ ...args, dt: 1 / 30, first: false, hold: true }); G.step(1 / 30); }
          spec.onRelease?.({ hand: G.input.right, ctx: args.ctx });
        } else { spec.cast(args); G.step(1.2); spec.cast(args); }
        G.step(1.0);
      } catch (err) { rec.ok = false; rec.error = String(err?.stack ?? err).split('\n').slice(0, 3).join(' | '); }
      for (const m of G.modules.values()) if (!m.core && m.updateError && !rec.updateError) rec.updateError = m.path + ': ' + m.updateError.message;
    }
    for (const { name, spec } of G.stubs.captured.weapons) {
      const rec = { name, ok: true };
      exercise.weapons.push(rec);
      try {
        const obj = spec.build?.(THREE);
        if (!obj || !obj.isObject3D) throw new Error('build(THREE) did not return an Object3D');
        const W = G.world.weapons;
        const w = W?.create?.(G.modules.get(job.files?.[0])?.ctx ?? { root: G.scene }, name, { position: { x: 0, y: 1, z: -2 } });
        rec.created = !!w;
        G.step(0.8);
        if (w && spec.fire) spec.fire({ origin: new THREE.Vector3(0, 1.2, -1), direction: new THREE.Vector3(0, 0, -1), weapon: w, ctx: G.modules.get(job.files?.[0])?.ctx ?? {}, power: 1 });
        else if (w?.fire) w.fire(1);
        G.step(0.8);
      } catch (err) { rec.ok = false; rec.error = String(err?.stack ?? err).split('\n').slice(0, 3).join(' | '); }
    }
    // press the buttons for a moment: creations that react to trigger / squeeze / a / b get a chance to run those paths
    const pressed = [];
    for (const [hand, btn] of [['right', 'trigger'], ['right', 'squeeze'], ['right', 'a'], ['right', 'b'], ['left', 'trigger'], ['left', 'squeeze'], ['left', 'a'], ['left', 'b']]) {
      const h = G.input[hand];
      Object.assign(h._prev, h.down);
      h.down[btn] = true; if (btn === 'trigger' || btn === 'squeeze') h[btn] = 1;
      G.step(0.25);
      Object.assign(h._prev, h.down);
      h.down[btn] = false; if (btn === 'trigger' || btn === 'squeeze') h[btn] = 0;
      G.step(0.1);
      pressed.push(hand + '.' + btn);
    }
    exercise.input = pressed.length;
    G.step(0.5);
    // let the player walk around a bit so proximity logic runs
    G.rig.position.set(1, 0, -4); G.step(0.5); G.rig.position.set(0, 0, 0);
  } catch (err) { exercise.error = String(err?.stack ?? err).split('\n').slice(0, 3).join(' | '); }

  const after = G.snapshotState();
  for (const entry of result.files) {
    const rec = G.modules.get(entry.path);
    if (!rec || !entry.loaded || entry.emptied) continue;
    entry.updateError = rec.updateError ? `${rec.updateError.message} (t=${rec.updateError.atT}s) ${rec.updateError.stack.split('\n')[1] || ''}`.trim() : null;
    let meshes = 0, instanced = 0, points = 0, lights = 0, total = 0, tris = 0;
    rec.root.traverse((o) => {
      total++;
      if (o.isMesh || o.isSkinnedMesh) { meshes++; const g = o.geometry; tris += (g?.index ? g.index.count : g?.attributes?.position?.count ?? 0) / 3 * (o.isInstancedMesh ? o.count : 1); }
      if (o.isInstancedMesh) instanced++;
      if (o.isPoints) points++;
      if (o.isLight) lights++;
    });
    entry.scene = { objects: total - 1, meshes, instanced, points, lights, tris: Math.round(tris) };
    entry.metaName = rec.meta?.name ?? null;
    entry.updateMs = +(rec.updateMs / Math.max(1, (job.seconds ?? 5) * 30)).toFixed(3);
    entry.calls = G.log.slice(logStart).filter((l) => l.mod === entry.path).map((l) => (l.call ? `${l.call}(${l.args.map((a) => JSON.stringify(a)).join(', ').slice(0, 160)})${l.ret ? ' -> ' + l.ret : ''}${l.threw ? ' THREW ' + l.threw : ''}` : `${l.set} = ${JSON.stringify(l.value)}`));
  }
  for (const s of exercise.spells) if (!s.ok || s.updateError) for (const e of result.files) if (e.loaded) (e.exerciseErrors ??= []).push('spell ' + s.id + ': ' + (s.error || s.updateError));
  for (const w of exercise.weapons) if (!w.ok) for (const e of result.files) if (e.loaded) (e.exerciseErrors ??= []).push('weapon ' + w.name + ': ' + w.error);
  result.calls = G.log.slice(logStart).filter((l) => l.call).map((l) => l.call);
  const sentNew = G.sent.slice(sentStart).filter((m) => !['activity'].includes(m.type));
  result.sent = sentNew.map((m) => ({ type: m.type, prompt: m.prompt ?? m.options?.prompt ?? undefined, key: m.key, name: m.name }));
  result.stubCalls = G.stubs.calls;
  result.hud = G.hudLog.slice(0, 8);
  result.coreErrors = G.coreErrors.slice(0, 8);
  const delta = {};
  for (const k of Object.keys(after)) if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) delta[k] = { before: before[k], after: after[k] };
  result.stateDelta = delta;
  // mechanisms (runtime)
  const callSet = new Set(G.log.slice(logStart).filter((l) => l.call).map((l) => l.call));
  const mech = new Set();
  if (callSet.has('library.spawn') || callSet.has('library.wave') || callSet.has('games.start')) mech.add('library');
  if ([...callSet].some((c) => /^models\.(spawn|instances)$/.test(c))) mech.add('models');
  if (callSet.has('models.generate')) mech.add('generate');
  if (callSet.has('travel.go')) mech.add('travel');
  if (callSet.has('blast.create') || callSet.has('blast.open')) mech.add('blast');
  for (const e of result.files) {
    for (const u of e.uses || []) if (u === 'library' && !mech.has('library') && e.libNames?.length) mech.add('library');
    if ((e.uses || []).includes('threeMesh') || (e.uses || []).includes('kit.actor') || (e.uses || []).includes('physics') || (e.uses || []).includes('kit.body')) mech.add('code');
  }
  result.mechanisms = [...mech];
  const wrote = result.files.filter((f) => f.loaded && !f.emptied);
  const anyScene = wrote.some((f) => f.scene && f.scene.objects > 0);
  const anyCalls = wrote.some((f) => f.calls?.length);
  result.effect = anyScene || anyCalls || Object.keys(delta).some((k) => !['sceneChildren', 'rootsChildren'].includes(k)) || sentNew.length > 0;
  result.effectKinds = { scene: anyScene, calls: anyCalls, state: Object.keys(delta), sent: sentNew.length };

  // dispose and cleanup
  for (const e of result.files) {
    if (!e.loaded || e.emptied) continue;
    const rec = G.unloadCreation(e.path);
    if (rec?.disposeError) e.disposeError = rec.disposeError;
  }
  G.step(3);
  await new Promise((r) => setTimeout(r, 20));
  const end = G.snapshotState();
  delete end.player?.health; delete before.player?.health;
  for (const k of Object.keys(end)) {
    if (JSON.stringify(end[k]) !== JSON.stringify(before[k])) {
      if (['particles', 'lights'].includes(k)) continue; // they fade out on their own
      if (['bodies', 'fighters', 'actors'].includes(k) && result.files.some((f) => (f.uses || []).some((u) => ['library', 'combat.fighter', 'kit.actor'].includes(u)))) continue; // corpses, debris and ragdolls linger ~12 s by design
      result.cleanup.leaks.push({ key: k, before: before[k], after: end[k] });
    }
  }
  result.ok = true;
} catch (err) {
  result.fatal = String(err?.stack ?? err).split('\n').slice(0, 8).join(' | ');
}
clearTimeout(watchdog);
done(0);






