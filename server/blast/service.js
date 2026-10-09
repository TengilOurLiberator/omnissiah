// Omnissiah blast: one sentence or one picture -> a playable scene (local port of image-blaster). See server/blast/README.md.
//
//   const b = createBlast({ root, send, log, oracle, services });   // send(msg) broadcasts a server->client message
//   b.request({ id, prompt, image, options })     -> Promise<manifest | null>   never throws; progress arrives as blast_status broadcasts
//   b.get(idOrSlug)  b.list()  b.status()  b.shutdown()
//   services (all optional, each missing one degrades the result instead of failing it):
//     worker        { generate, edit, unload, shutdown }   the local image models (default: the WSL worker, server/blast/workerclient.js)
//     generateModel ({ prompt, image, options }) -> { url, slug, meta } | null      (server/gen3d.js)
//     generatePlace ({ prompt, image, options }) -> { slug, url, preview, meta } | null   (server/plugins/travel.js)
//     requestAudio  ({ kind, prompt, seconds, loop }) -> { url, slug } | null          (server/audio/client.js)
//   oracle: { ask(input, { promptFile, cwd, tools, effort, timeoutMs }) -> text }      (api.oracle of the plugin loader: Claude Code on the player's account)
//
// Protocol: client { type:'blast', id, prompt | image, options:{ maxObjects, seed, budgetMs, force } }  and  { type:'blast_get', id | slug }  { type:'blast_list' }
//   server { type:'blast_status', id, slug, stage:'queued'|'image'|'uncover'|'plate'|'objects'|'place'|'sounds'|'layout'|'done', state:'running'|'done'|'skipped'|'error',
//            message, progress:{ done, total }, result }
// Project folder  public/assets/generated/blasts/<slug>/  (resumable: every stage writes its result, a re-run skips finished stages):
//   project.json  image.json  manifest.json  source/0-<slug>.png (+ .json)  source/1-<slug>-plate.png  output/<object>/{object.json, reference.png, model.glb, impact.ogg}
//   output/world/place.json  output/sfx/ambient.ogg      and  blasts/index.json (the cache listing)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createWorkerClient } from './workerclient.js';
import { sceneWrapper, platePrompt, isolatePrompt, emptyPlaceDescription } from './prompts.js';
import { extractJson, normaliseAnalysis, selectObjects, physicsFor, impactPrompt, ambientPrompt, slugify, sha1, clamp } from './analysis.js';
import { computeLayout, glbBounds, propSpec } from './layout.js';
import { boxChange, cropBox, whiteStats, thumbnail, imageSize } from './imgtools.js';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const UNCOVER_PROMPT = path.join(HERE, 'uncover-prompt.md');
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PROMPT = 300;
const DEFAULT_BUDGET_MS = 12 * 60 * 1000;
const STAGES = ['image', 'uncover', 'plate', 'objects', 'place', 'sounds', 'layout'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)} s`)), ms);
  Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});
const exists = (p) => { try { return fs.statSync(p).isFile() && fs.statSync(p).size > 0; } catch { return false; } };
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}
const cleanPrompt = (raw) => String(raw ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT).trim();

export function createBlast({ root, send = () => {}, log = (...a) => console.log('[blast]', ...a), oracle = null, services = {}, env = process.env, now = () => Date.now() } = {}) {
  root = path.resolve(root);
  const blastsDir = path.join(root, 'public', 'assets', 'generated', 'blasts');
  const indexFile = path.join(blastsDir, 'index.json');
  const inputDir = path.join(root, 'input');
  const urlBase = '/assets/generated/blasts';
  const worker = services.worker === undefined ? createWorkerClient({ root, log }) : services.worker;
  const jobs = new Map();          // slug -> job (running or recently finished)
  const byId = new Map();          // client id -> job
  let queue = Promise.resolve();   // one blast at a time: the GPU is shared
  let queued = 0;
  let indexChain = Promise.resolve();
  let shuttingDown = false;

  // ------------------------------------------------------------------ paths
  const rel = (p) => path.relative(root, p);
  const projectDir = (slug) => path.join(blastsDir, slug);
  const urlOf = (slug, ...parts) => `${urlBase}/${slug}/${parts.join('/')}`;
  function checkImage(p) {
    const given = String(p);
    const abs = /[\\/]/.test(given) ? path.resolve(root, given) : path.join(inputDir, given); // a bare file name means "the picture in the input folder"
    const r = path.relative(root, abs);
    if (r.startsWith('..') || path.isAbsolute(r)) throw new Error('image must be inside the game folder (use the input folder)');
    if (!IMAGE_EXT.has(path.extname(abs).toLowerCase())) throw new Error('image must be .png, .jpg or .webp');
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size < 100 || st.size > MAX_IMAGE_BYTES) throw new Error('image file is missing, empty or too large');
    const bytes = fs.readFileSync(abs);
    const png = bytes.length > 8 && bytes.readUInt32BE(0) === 0x89504e47;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const webp = bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!png && !jpg && !webp) throw new Error('that file is not a picture');
    return { abs, bytes, hash: sha1(bytes), ext: png ? '.png' : jpg ? '.jpg' : '.webp' };
  }
  function slugFor({ prompt, image, seed }) {
    if (image) return `${slugify(path.basename(image.abs, path.extname(image.abs)), 24) || 'picture'}-${image.hash.slice(0, 8)}`;
    const norm = prompt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return `${slugify(norm, 30) || 'scene'}-${sha1(`${norm}|${seed}`).slice(0, 6)}`;
  }

  // ------------------------------------------------------------------ cache listing
  function readIndex() { const j = readJson(indexFile, {}); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; }
  function updateIndex(slug, entry) {
    indexChain = indexChain.then(() => { const idx = readIndex(); if (entry) idx[slug] = entry; else delete idx[slug]; writeJson(indexFile, idx); }).catch((err) => log('index update failed:', err?.message ?? err));
    return indexChain;
  }
  function list() {
    const idx = readIndex();
    return Object.entries(idx).map(([slug, e]) => ({ slug, ...e })).filter((e) => exists(path.join(projectDir(e.slug), 'manifest.json'))).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  }

  // ------------------------------------------------------------------ status plumbing
  function emit(job, stage, state, message, extra = {}) {
    const msg = { type: 'blast_status', slug: job.slug, stage, state, message, progress: extra.progress ?? { done: 0, total: 0 }, result: extra.result ?? null, ...(extra.replay ? { replay: true } : {}) };
    job.last = { stage, state, message, progress: msg.progress, result: msg.result };
    if (stage !== 'queued') job.history[stage] = job.last;
    if (stage === 'objects' && msg.result?.object) (job.objectEvents ??= []).push(job.last);   // a late client needs every object that already came out
    try { fs.mkdirSync(job.dir, { recursive: true }); fs.appendFileSync(path.join(job.dir, 'status.jsonl'), `${JSON.stringify({ t: now(), ...msg, id: undefined })}\n`); } catch { /* the log is a convenience */ }
    for (const id of job.ids) { try { send({ ...msg, id }); } catch (err) { log('send failed:', err?.message ?? err); } }
  }
  function snapshot(job) {
    return { slug: job.slug, running: !job.finished, last: job.last, history: job.history, manifest: job.manifest ?? null };
  }
  function get(idOrSlug) {
    const job = byId.get(idOrSlug) ?? jobs.get(idOrSlug);
    if (job) return snapshot(job);
    const m = readJson(path.join(projectDir(String(idOrSlug).replace(/[^a-z0-9-]/g, '')), 'manifest.json'));
    return m ? { slug: m.slug, running: false, last: { stage: 'done', state: 'done', message: 'Already known to the Omnissiah', progress: { done: 1, total: 1 }, result: m }, history: {}, manifest: m } : null;
  }
  // re-send everything a late (or reloaded) client needs to catch up
  function replay(id, idOrSlug, reply) {
    const s = get(idOrSlug) ?? get(id);
    if (!s) return reply({ type: 'blast_status', id, slug: null, stage: 'done', state: 'error', message: 'I know of no such vision.', progress: { done: 0, total: 0 }, result: null, replay: true });
    const job = byId.get(idOrSlug) ?? jobs.get(idOrSlug) ?? jobs.get(s.slug);
    if (job && id) { job.ids.add(id); byId.set(id, job); }
    for (const stage of STAGES) {
      const h = s.history[stage];
      if (stage === 'objects' && job?.objectEvents) for (const ev of job.objectEvents) reply({ type: 'blast_status', id, slug: s.slug, ...ev, replay: true });
      if (h) reply({ type: 'blast_status', id, slug: s.slug, ...h, replay: true });
    }
    if (s.manifest) reply({ type: 'blast_status', id, slug: s.slug, stage: 'done', state: 'done', message: 'Step inside.', progress: { done: 1, total: 1 }, result: s.manifest, replay: true });
    else if (s.last && !s.history[s.last.stage]) reply({ type: 'blast_status', id, slug: s.slug, ...s.last, replay: true });
  }

  // ------------------------------------------------------------------ one blast
  async function runBlast(job) {
    const t0 = now();
    const o = job.options;
    const deadline = t0 + clamp(Number(o.budgetMs) || DEFAULT_BUDGET_MS, 60000, 25 * 60000);
    const dir = job.dir;
    const srcDir = path.join(dir, 'source');
    const outDir = path.join(dir, 'output');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    const proj = readJson(path.join(dir, 'project.json'), null) ?? { schema_version: 1, slug: job.slug, created: new Date(now()).toISOString(), prompt: job.prompt || null, source_image: job.image ? path.basename(job.image.abs) : null, options: { maxObjects: o.maxObjects, seed: job.seed }, timings: {}, warnings: [] };
    proj.warnings = proj.warnings ?? []; proj.timings = proj.timings ?? {};
    const save = () => writeJson(path.join(dir, 'project.json'), proj);
    const warn = (w) => { log(`${job.slug}: ${w}`); if (!proj.warnings.includes(w)) proj.warnings.push(w); };
    const timed = async (name, fn) => { const s = now(); try { return await fn(); } finally { proj.timings[name] = Math.round(((proj.timings[name] ?? 0) * 1000 + now() - s)) / 1000; save(); } };
    const left = () => deadline - now();
    const outOfTime = () => left() <= 0;
    const imgName = `0-${job.slug}.png`;
    const imgPath = path.join(srcDir, imgName);
    let image = null;           // the survey (image.json)
    let selected = [];          // the objects to extract
    let platePath = null;
    let placeInfo = null;
    const objResults = new Map();   // id -> { glbPath, glbUrl, glb:{size}, ref, ok }

    let aspect = 16 / 9, fov = 80, imageUrl = '', thumbUrl = '', uncoverNote = '';
    const imageJsonPath = path.join(dir, 'image.json');
    for (let attempt = 0; attempt < 3; attempt++) {
    // ---------------- image (and, when the survey finds the picture flawed, once more with another seed)
    emit(job, 'image', 'running', attempt ? 'That vision was flawed; I am dreaming it again' : job.image ? 'I am studying the picture you gave me' : 'I am dreaming the place', { progress: { done: 0, total: 1 } });
    let imageOk = exists(imgPath);
    if (!imageOk && job.image) {
      try {
        if (job.image.ext === '.png') fs.writeFileSync(imgPath, job.image.bytes);
        else { const sharp = (await import('./imgtools.js')).getSharp(root); if (sharp) await sharp(job.image.bytes).png().toFile(imgPath); else throw new Error('this picture type needs the sharp module; use a PNG'); }
        imageOk = exists(imgPath);
      } catch (err) { warn(`could not read the picture: ${err.message}`); }
    } else if (!imageOk) {
      if (!worker) warn('no image worker');
      else {
        const r = await timed('image', () => worker.generate({ prompt: sceneWrapper(job.prompt, { fantasy: o.fantasy }), width: 1344, height: 768, seed: job.seed + attempt * 7919, out: imgPath }, { timeoutMs: 5 * 60 * 1000 }));
        imageOk = r.ok && exists(imgPath);
        if (!imageOk) warn(`the scene image failed: ${r.error ?? 'unknown'}`);
      }
    }
    if (!imageOk) { emit(job, 'image', 'error', 'The vision would not form. The painter is unavailable.', { progress: { done: 0, total: 1 } }); return finishFailed(job, proj, save, 'no image'); }
    const size = (await imageSize(imgPath, root)) ?? { width: 1344, height: 768 };
    aspect = size.width / size.height;
    const vfov = 2 * Math.atan(Math.tan((80 * Math.PI) / 360) / (16 / 9));
    fov = Math.abs(aspect - 16 / 9) < 0.06 ? 80 : Math.round(clamp(2 * Math.atan(Math.tan(vfov / 2) * aspect) * 180 / Math.PI, 45, 110));
    proj.image = { file: rel(imgPath), width: size.width, height: size.height, aspect, fov };
    save();
    await thumbnail(imgPath, path.join(dir, 'thumb.jpg'), 480, root);
    imageUrl = urlOf(job.slug, 'source', imgName);
    thumbUrl = exists(path.join(dir, 'thumb.jpg')) ? urlOf(job.slug, 'thumb.jpg') : imageUrl;
    emit(job, 'image', 'done', 'The vision is ready', { progress: { done: 1, total: 1 }, result: { slug: job.slug, image: attempt ? `?v=` : imageUrl, thumb: thumbUrl, aspect, fov, prompt: job.prompt || null } });

    // ---------------- uncover (one model call, one retry)
    emit(job, 'uncover', 'running', 'I am studying what I dreamed', { progress: { done: 0, total: 1 } });
    image = readJson(imageJsonPath);
    if (!image) {
      const sourceImages = [rel(imgPath).replace(/\\/g, '/')];
      let raw = null, error = '';
      if (!oracle?.ask) error = 'the Omnissiah cannot see right now (no model access)';
      else {
        const ask = (input) => oracle.ask(input, { promptFile: UNCOVER_PROMPT, cwd: srcDir, tools: 'Read', effort: env.BLAST_EFFORT || 'medium', timeoutMs: 200000 });
        const subject = job.prompt ? `The player asked for: "${job.prompt}".` : 'The player supplied this picture.';
        const first = `Survey the picture file "${imgName}" in your working directory. ${subject}`;
        let text = await timed('uncover', () => ask(first));
        let parsed = extractJson(text);
        if (parsed.error && !outOfTime()) {
          log(`${job.slug}: uncover answer invalid (${parsed.error}); one retry`);
          const retry = `${first}\n\nYour previous answer was ${parsed.error}. Previous answer:\n${String(text).slice(0, 12000)}\n\nReply with the corrected JSON object only, no fences, no commentary.`;
          const t2 = await timed('uncover', () => ask(retry));
          const p2 = extractJson(t2);
          if (!p2.error) parsed = p2; else if (!text) text = t2;
        }
        if (parsed.value) raw = parsed.value; else error = parsed.error;
        if (raw) { const n = normaliseAnalysis(raw, { slug: job.slug, sourceImages }); image = n; }
      }
      if (!image) {
        warn(`no survey: ${error}`);
        uncoverNote = error;
        image = normaliseAnalysis({ scene_name: job.prompt ? job.prompt.slice(0, 40) : 'A picture', short_caption: job.prompt || 'A picture from the player', literal_description: job.prompt || '', setting: /\b(room|study|tavern|inn|lab|laboratory|shop|hall|house|kitchen|library|tower|interior|inside)\b/i.test(job.prompt) ? 'indoor' : /\b(cave|dungeon|mine|crypt|tunnel)\b/i.test(job.prompt) ? 'underground' : 'outdoor', objects: [] }, { slug: job.slug, sourceImages });
        image.degraded = true;
      }
      writeJson(imageJsonPath, image);
      writeJson(path.join(srcDir, `0-${job.slug}.json`), image);
    }
    const flawed = !job.image && attempt < 2 && !image.degraded && worker && left() > 8 * 60 * 1000 && (image.view_problems || []).some((p) => /person|people|character|human|figure|bird|high.?angle|from above|looks? down|diorama|cutaway|void|cliff|edge/i.test(p));
    if (flawed) {
      proj.sceneRetries = (proj.sceneRetries ?? 0) + 1; save();
      warn(`the first picture was flawed (${image.view_problems.join('; ')}); dreamed again`);
      for (const f of [imgPath, imageJsonPath, path.join(srcDir, `0-${job.slug}.json`)]) { try { fs.rmSync(f); } catch { /* none */ } }
      continue;
    }
    break;
    }
    selected = image.degraded ? [] : selectObjects(image, { maxObjects: clamp(Math.round(Number(o.maxObjects) || 8), 1, 14) });
    for (const s of selected) writeJson(path.join(outDir, s.id, 'object.json'), { schema_version: 1, world: job.slug, object: { id: s.id, name: s.name, description: s.description, materials: s.materials, source_images: image.source_images, evidence: [{ image: image.source_images[0], location_in_image: s.location_in_image }], generate_as_3d_object: true, working_dir: rel(path.join(outDir, s.id)).replace(/\\/g, '/'), count: s.count, box: s.box, depth: s.depth, size_m: s.size_m, rests_on: s.rests_on, rests_on_id: s.rests_on_id, break_material: s.break_material, impact_sound: s.impact_sound, score: s.score }, updated_at: new Date(now()).toISOString() });
    emit(job, 'uncover', image.degraded ? 'error' : 'done', image.degraded ? 'I could not read the picture closely; I will build the place without its things.' : `I see ${image.objects.length} things; I will lift ${selected.length} of them`, {
      progress: { done: 1, total: 1 },
      result: { scene_name: image.scene_name, caption: image.short_caption, setting: image.setting, objects: selected.map((s) => ({ id: s.id, name: s.name, box: s.box, depth: s.depth })), degraded: !!image.degraded },
    });

    // ---------------- plate + isolation references (one edit batch, then retries for what failed the checks)
    const plateFile = `1-${job.slug}-plate.png`;
    const platePathWanted = path.join(srcDir, plateFile);
    const refPath = (s) => path.join(outDir, s.id, 'reference.png');
    const needRefs = selected.filter((s) => !exists(refPath(s)));
    const needPlate = selected.length > 0 && !exists(platePathWanted);
    if (selected.length && !worker) { warn('no edit worker: no clean plate and no objects'); selected = []; }
    if (selected.length && (needPlate || needRefs.length)) {
      emit(job, 'plate', 'running', 'I am clearing the picture of its clutter', { progress: { done: 0, total: 1 + needRefs.length } });
      const names = selected.map((s) => s.name);
      const pOpts = { ground: image.ground_type, backdrop: image.backdrop };
      const batch = [];
      if (needPlate) batch.push({ id: 'plate', images: [imgPath], prompt: platePrompt(names, pOpts), out: path.join(job.work, 'plate-1.png'), seed: 3 });
      for (const s of needRefs) batch.push({ id: s.id, images: [imgPath], prompt: isolatePrompt(s), out: path.join(job.work, `ref-${s.id}-1.png`), seed: 5, width: 1024, height: 1024 });
      fs.mkdirSync(job.work, { recursive: true });
      let lastCount = -1;
      let r = await timed('edit', () => worker.edit(batch, { timeoutMs: 6 * 60 * 1000, onProgress: (v) => { const n = (v.items ?? []).length; if (n !== lastCount) { lastCount = n; emit(job, 'plate', 'running', 'I am clearing the picture of its clutter', { progress: { done: n, total: batch.length } }); } } }));
      const got = new Map((r.items ?? []).filter((i) => i.ok && i.out && exists(i.out)).map((i) => [i.id, i.out]));
      if (!r.ok && !got.size) warn(`image edits failed: ${r.error}`);
      // checks: was every object really removed from the plate? is every isolation a single complete thing on white?
      const retries = [];
      let plateCur = got.get('plate') ?? null;
      const unchanged = async (file) => { const bad = []; for (const s of selected) { const c = await boxChange(imgPath, file, s.box, root); if (c !== null && c < 12 && !s.box_guessed) bad.push(s); } return bad; };
      const refOk = async (file) => { const w = await whiteStats(file, root); return !w || (w.borderWhite > 0.93 && w.content > 0.03 && w.content < 0.8); };
      const refCur = new Map();
      for (const s of needRefs) { const f = got.get(s.id); if (f && (await refOk(f))) refCur.set(s.id, f); else if (f) refCur.set(`weak:${s.id}`, f); }
      const redo = [];
      if (needPlate && plateCur) {
        const bad = await unchanged(plateCur);
        if (bad.length) redo.push({ kind: 'plate', bad });
      }
      const badRefs = needRefs.filter((s) => !refCur.has(s.id));
      if ((redo.length || badRefs.length) && !outOfTime() && left() > 5 * 60 * 1000) {
        const b2 = [];
        if (redo.length) b2.push({ id: 'plate2', images: [plateCur], prompt: platePrompt(redo[0].bad.map((s) => s.name), pOpts), out: path.join(job.work, 'plate-2.png'), seed: 3 });
        for (const s of badRefs) {
          const crop = await cropBox(imgPath, path.join(job.work, `crop-${s.id}.png`), s.box, { margin: 0.3, root });
          b2.push({ id: s.id, images: [crop ?? imgPath], prompt: isolatePrompt(s), out: path.join(job.work, `ref-${s.id}-2.png`), seed: 11, width: 1024, height: 1024 });
        }
        emit(job, 'plate', 'running', 'Some things clung to the picture; I am pulling again', { progress: { done: batch.length, total: batch.length + b2.length } });
        const r2 = await timed('edit', () => worker.edit(b2, { timeoutMs: 5 * 60 * 1000 }));
        const got2 = new Map((r2.items ?? []).filter((i) => i.ok && i.out && exists(i.out)).map((i) => [i.id, i.out]));
        if (got2.has('plate2')) {
          const before = redo[0].bad.length;
          const bad2 = await unchanged(got2.get('plate2'));
          plateCur = got2.get('plate2');
          if (bad2.length && bad2.length < before + 99 && !outOfTime() && left() > 4 * 60 * 1000) { // a third and last pass for the stubborn ones
            const r3 = await timed('edit', () => worker.edit([{ id: 'plate3', images: [plateCur], prompt: platePrompt(bad2.map((s) => s.name), pOpts), out: path.join(job.work, 'plate-3.png'), seed: 7 }], { timeoutMs: 4 * 60 * 1000 }));
            const f3 = (r3.items ?? []).find((i) => i.ok && i.out && exists(i.out));
            if (f3) plateCur = f3.out;
          }
        }
        for (const s of badRefs) { const f = got2.get(s.id); if (f && ((await refOk(f)) || !refCur.has(`weak:${s.id}`))) refCur.set(s.id, f); else if (refCur.has(`weak:${s.id}`)) refCur.set(s.id, refCur.get(`weak:${s.id}`)); }
      } else for (const s of badRefs) if (refCur.has(`weak:${s.id}`)) refCur.set(s.id, refCur.get(`weak:${s.id}`));
      if (worker.unload) await worker.unload();             // free the GPU for the 3D stage
      if (needPlate) {
        if (plateCur) { fs.copyFileSync(plateCur, platePathWanted); }
        else warn('no clean plate: the place is built from the picture with its things in it');
      }
      for (const s of selected) { const f = refCur.get(s.id); if (f && !exists(refPath(s))) { fs.mkdirSync(path.dirname(refPath(s)), { recursive: true }); fs.copyFileSync(f, refPath(s)); } }
    }
    platePath = exists(platePathWanted) ? platePathWanted : null;
    emit(job, 'plate', platePath ? 'done' : selected.length ? 'error' : 'skipped', platePath ? 'The picture is empty now' : selected.length ? 'The picture kept its clutter' : 'Nothing to clear', {
      progress: { done: 1, total: 1 }, result: { plate: platePath ? urlOf(job.slug, 'source', plateFile) : null },
    });

    // ---------------- place
    emit(job, 'place', 'running', 'I am opening the picture into a world', { progress: { done: 0, total: 1 } });
    const placeFile = path.join(outDir, 'world', 'place.json');
    placeInfo = readJson(placeFile);
    if (!placeInfo) {
      if (!services.generatePlace) warn('no place generator: the objects will stand in the current world');
      else {
        const indoor = image.setting !== 'outdoor';
        // The things must stand on believable ground: flat unless the picture's ground is clearly rolling / hilly (a canyon, crags or an island preset would heave the floor under them
        // and wrap tall grass round a dirt road); grass only where the survey says the ground is grass; no lake bowl.
        const hint = indoor ? 'plain' : ['canyon', 'craggy', 'island'].includes(image.terrain_hint) ? 'plain' : image.terrain_hint;
        const grassy = /grass|lawn|meadow|moss|turf|clover|field/i.test(image.ground_type);
        const spec = { terrain: hint, grass: indoor ? 0 : grassy ? 0.8 : 0.1, motes: indoor ? 0.2 : 0.4, stones: false, water: { mode: 'none' } };
        spec.music = image.music_mood;
        const planned = (platePath ?? imgPath);
        try {
          const budgetLeft = Math.max(240000, Math.min(8 * 60 * 1000, left() - 60000));
          const p = await timed('place', () => withTimeout(services.generatePlace({ prompt: emptyPlaceDescription(image, selected.map((s) => s.name)), image: planned, options: { name: image.scene_name, seed: job.seed, fov, horizonY: image.horizon_y, slug: `blast-${job.slug.slice(0, 30)}-${sha1(Buffer.concat([fs.readFileSync(planned), Buffer.from(JSON.stringify(spec))])).slice(0, 8)}`, spec, hi: 'fast' } }), budgetLeft, 'the place'));
          if (p && p.slug) { placeInfo = { slug: p.slug, url: p.url ?? null, preview: p.preview ?? null, from: platePath ? 'plate' : 'picture' }; writeJson(placeFile, placeInfo); }
          else warn('the place could not be made: objects will stand in the current world');
        } catch (err) { warn(`place: ${err.message}`); }
      }
    }
    emit(job, 'place', placeInfo ? 'done' : 'error', placeInfo ? 'A world has opened' : 'The world would not open; the things will stand where you are', { progress: { done: 1, total: 1 }, result: { place: placeInfo?.slug ?? null } });

    // ---------------- objects: reference -> GLB, one at a time
    const total = selected.length;
    emit(job, 'objects', total ? 'running' : 'skipped', total ? 'I am lifting things out of the picture' : 'No things to lift', { progress: { done: 0, total } });
    let doneCount = 0;
    const placeReserve = 1.5 * 60 * 1000;   // time kept for the layout and the sounds (the place is already made: it goes first)
    for (const s of selected) {
      const modelPath = path.join(outDir, s.id, 'model.glb');
      const ref = refPath(s);
      const finish = (ok) => {
        doneCount++;
        const base = { id: s.id, name: s.name, ok, count: s.count };
        if (ok) {
          const glb = glbBounds(fs.readFileSync(modelPath));
          objResults.set(s.id, { glb: glb ? { size: glb.size } : null, modelPath });
          const row = computeLayout([{ ...s, glb: glb ? { size: glb.size } : null }], { horizonY: image.horizon_y, fov, aspect, indoor: image.setting !== 'outdoor' })[0];
          emit(job, 'objects', 'running', `The ${s.name} is out of the picture`, { progress: { done: doneCount, total }, result: { object: { ...base, url: urlOf(job.slug, 'output', s.id, 'model.glb'), from: { box: s.box, depth: s.depth }, position: row.position, yaw: row.yaw, scale: row.scale, size_m: s.size_m, dims: row.dims, material: s.break_material, fixed: row.fixed, ...propSpec(s, row) } } });
        } else emit(job, 'objects', 'running', `The ${s.name} would not come`, { progress: { done: doneCount, total }, result: { object: base } });
      };
      if (exists(modelPath)) { finish(true); continue; }
      if (!exists(ref) || !services.generateModel) { if (!services.generateModel) warn('no 3D generator'); finish(false); continue; }
      if (left() < placeReserve + 45000) { warn('out of time: remaining objects skipped'); finish(false); continue; }
      emit(job, 'objects', 'running', `Lifting the ${s.name} out of the picture`, { progress: { done: doneCount, total } });
      try {
        const g = await timed('objects', () => withTimeout(services.generateModel({ prompt: s.name, image: ref, options: { quality: 'standard', animate: false, seed: 1 } }), 6 * 60 * 1000, `the ${s.name}`));
        const src = g && g.url ? path.join(root, 'public', g.url.replace(/^\//, '')) : null;
        if (src && exists(src)) { fs.copyFileSync(src, modelPath); finish(true); } else { warn(`no model for ${s.id}`); finish(false); }
      } catch (err) { warn(`object ${s.id}: ${err.message}`); finish(false); }
    }
    const made = selected.filter((s) => objResults.has(s.id));
    emit(job, 'objects', total ? (made.length ? 'done' : 'error') : 'skipped', total ? `${made.length} of ${total} things are real now` : 'No things to lift', { progress: { done: total, total }, result: { made: made.map((s) => s.id) } });

    // ---------------- layout + manifest (before the sounds, so the player can step in while the sounds are still being made)
    emit(job, 'layout', 'running', 'I am setting everything where it belongs', { progress: { done: 0, total: 1 } });
    const sounds = readJson(path.join(outDir, 'sfx', 'sounds.json'), { ambient: null, impacts: {} });
    const layoutIn = made.map((s) => ({ ...s, glb: objResults.get(s.id).glb }));
    const rows = computeLayout(layoutIn, { horizonY: image.horizon_y, fov, aspect, indoor: image.setting !== 'outdoor' });
    const buildManifest = (final) => {
      const objects = made.map((s, i) => {
        const row = rows[i];
        const phys = propSpec(s, row);
        const snd = sounds.impacts[impactPrompt(s)] ?? null;
        return {
          id: s.id, name: s.name, url: urlOf(job.slug, 'output', s.id, 'model.glb'), reference: urlOf(job.slug, 'output', s.id, 'reference.png'),
          position: row.position, yaw: row.yaw, scale: row.scale, size_m: s.size_m, dims: row.dims, material: s.break_material, breakable: true, mass: phys.mass, hp: phys.hp, grabbable: phys.grabbable,
          bounce: phys.bounce, friction: phys.friction, fixed: row.fixed, rests: row.rests, supportId: row.supportId, count: 1 + row.copies.length, copies: row.copies,
          sound: snd ? { url: snd.url, phrase: snd.prompt } : null, from: { box: s.box, depth: s.depth }, distance: row.distance, bearing_deg: row.bearing_deg,
        };
      });
      return {
        schema_version: 1, slug: job.slug, name: image.scene_name, caption: image.short_caption, prompt: job.prompt || null, created: proj.created,
        image: imageUrl, plate: platePath ? urlOf(job.slug, 'source', plateFile) : null, thumb: thumbUrl, aspect, fov, horizon_y: image.horizon_y,
        place: placeInfo ? { slug: placeInfo.slug, url: placeInfo.url, preview: placeInfo.preview, from: placeInfo.from } : null,
        setting: { kind: image.setting, ground: image.ground_type, backdrop: image.backdrop, time_of_day: image.time_of_day, terrain: image.terrain_hint, lighting: image.lighting, fantasy: image.fantasy },
        ambient: sounds.ambient ?? null, music: image.music_mood, objects, sounds_pending: !final,
        stats: { seconds: Math.round(Object.values(proj.timings).reduce((a, b) => a + b, 0)), timings: proj.timings, selected: selected.length, made: made.length, degraded: !!image.degraded },
        warnings: proj.warnings,
      };
    };
    const commit = async (manifest, final) => {
      writeJson(path.join(dir, 'manifest.json'), manifest);
      if (final) { proj.status = 'done'; proj.finished = new Date(now()).toISOString(); save(); }
      await updateIndex(job.slug, { name: manifest.name, caption: manifest.caption, prompt: manifest.prompt, thumb: thumbUrl, image: imageUrl, created: manifest.created, objects: manifest.objects.length, place: !!manifest.place, seconds: manifest.stats.seconds });
    };
    let manifest = buildManifest(false);
    job.manifest = manifest;
    await commit(manifest, false);
    emit(job, 'layout', 'done', 'Everything stands where it belongs', { progress: { done: 1, total: 1 }, result: manifest });

    // ---------------- sounds
    const impactTargets = [];
    const seenPhrase = new Map();
    for (const s of made) { const p = impactPrompt(s); if (!seenPhrase.has(p)) { if (seenPhrase.size >= 8) continue; seenPhrase.set(p, []); } seenPhrase.get(p).push(s.id); }
    for (const [p, ids] of seenPhrase) impactTargets.push({ prompt: p, ids });
    const soundTotal = 1 + impactTargets.length;
    emit(job, 'sounds', 'running', 'I am teaching the place to sound', { progress: { done: 0, total: soundTotal } });
    if (!services.requestAudio) warn('no audio generator: the place will be silent');
    else {
      let n = 0;
      const copyAudio = (r, dest) => { try { const src = path.join(root, 'public', r.url.replace(/^\//, '')); if (exists(src)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); return urlOf(job.slug, ...path.relative(dir, dest).split(path.sep)); } } catch { /* keep the cache url */ } return r.url; };
      if (!sounds.ambient && !outOfTimeFor(deadline, 20000)) {
        try {
          const r = await timed('sounds', () => withTimeout(services.requestAudio({ kind: 'sfx', prompt: ambientPrompt(image), seconds: 20, loop: true }), 4 * 60 * 1000, 'the ambience'));
          if (r?.url) sounds.ambient = { url: copyAudio(r, path.join(outDir, 'sfx', 'ambient.ogg')), prompt: ambientPrompt(image), seconds: 20 };
        } catch (err) { warn(`ambience: ${err.message}`); }
      }
      n++;
      emit(job, 'sounds', 'running', 'The air has a voice now', { progress: { done: n, total: soundTotal } });
      for (const t of impactTargets) {
        if (outOfTimeFor(deadline, 20000)) { warn('out of time: remaining impact sounds skipped'); break; }
        if (!sounds.impacts[t.prompt]) {
          try {
            const r = await timed('sounds', () => withTimeout(services.requestAudio({ kind: 'sfx', prompt: t.prompt, seconds: 1.5 }), 3 * 60 * 1000, 'an impact sound'));
            if (r?.url) sounds.impacts[t.prompt] = { url: copyAudio(r, path.join(outDir, t.ids[0], 'impact.ogg')), prompt: t.prompt };
          } catch (err) { warn(`impact sound: ${err.message}`); }
        }
        n++;
        emit(job, 'sounds', 'running', 'Teaching the things to ring', { progress: { done: n, total: soundTotal } });
      }
      writeJson(path.join(outDir, 'sfx', 'sounds.json'), sounds);
    }
    const haveSounds = !!(sounds.ambient || Object.keys(sounds.impacts).length);
    emit(job, 'sounds', haveSounds ? 'done' : 'skipped', haveSounds ? 'The place can be heard' : 'The place stays silent', { progress: { done: soundTotal, total: soundTotal } });

    manifest = buildManifest(true);
    job.manifest = manifest;
    await commit(manifest, true);
    void uncoverNote;
    emit(job, 'done', 'done', manifest.place ? 'Step inside.' : 'The things are ready.', { progress: { done: 1, total: 1 }, result: manifest });
    return manifest;
  }
  const outOfTimeFor = (deadline, margin) => now() > deadline - margin;

  function finishFailed(job, proj, save, why) {
    proj.status = 'failed'; proj.error = why; save();
    emit(job, 'done', 'error', 'The vision failed.', { progress: { done: 0, total: 1 } });
    return null;
  }

  // ------------------------------------------------------------------ public API
  function request({ id, prompt, image, options } = {}) {
    try {
      id = id ?? `b-${crypto.randomUUID()}`;
      const opts = options && typeof options === 'object' ? options : {};
      const text = cleanPrompt(prompt);
      let img = null;
      if (image) {
        try { img = checkImage(image); } catch (err) { const m = { type: 'blast_status', id, slug: null, stage: 'image', state: 'error', message: `Bad picture: ${err.message}`, progress: { done: 0, total: 1 }, result: null }; try { send(m); } catch { /* ignore */ } return Promise.resolve(null); }
      }
      if (!text && !img) { const m = { type: 'blast_status', id, slug: null, stage: 'image', state: 'error', message: 'Say what you wish to see.', progress: { done: 0, total: 1 }, result: null }; try { send(m); } catch { /* ignore */ } return Promise.resolve(null); }
      const seedNum = Number(opts.seed);
      const seed = Number.isFinite(seedNum) && opts.seed !== null && opts.seed !== '' ? Math.trunc(seedNum) & 0x7fffffff : parseInt(sha1(text ? text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : img.hash).slice(0, 6), 16);
      const slug = slugFor({ prompt: text, image: img, seed });
      let job = jobs.get(slug);
      if (job && !job.finished) { job.ids.add(id); byId.set(id, job); replay(id, slug, send); return job.promise; }
      const dir = projectDir(slug);
      if (opts.force === true) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
      // cached: a finished project answers at once
      const cachedManifest = readJson(path.join(dir, 'manifest.json'));
      job = { slug, ids: new Set([id]), prompt: text, image: img, seed, options: { maxObjects: opts.maxObjects, budgetMs: opts.budgetMs, fantasy: opts.fantasy === true }, dir, work: path.join(root, '.cache', 'blast', 'work', slug), history: {}, last: null, finished: false, manifest: null, promise: null };
      jobs.set(slug, job); byId.set(id, job);
      if (cachedManifest && readJson(path.join(dir, 'project.json'))?.status === 'done') {
        job.manifest = cachedManifest; job.finished = true;
        emit(job, 'image', 'done', 'Already known to the Omnissiah', { progress: { done: 1, total: 1 }, result: { slug, image: cachedManifest.image, thumb: cachedManifest.thumb, aspect: cachedManifest.aspect, fov: cachedManifest.fov, prompt: cachedManifest.prompt } });
        emit(job, 'done', 'done', 'Step inside.', { progress: { done: 1, total: 1 }, result: cachedManifest });
        job.promise = Promise.resolve(cachedManifest);
        return job.promise;
      }
      queued++;
      emit(job, 'queued', 'running', queued > 1 ? 'Waiting my turn' : 'Gathering my thoughts', { progress: { done: 0, total: STAGES.length } });
      job.promise = (queue = queue.then(async () => {
        queued--;
        if (shuttingDown) return null;
        try { return await runBlast(job); } catch (err) {
          log(`${slug} crashed: ${err?.stack ?? err}`);
          emit(job, 'done', 'error', `The vision faltered: ${err?.message ?? err}`, { progress: { done: 0, total: 1 } });
          // whatever exists is still a result
          return readJson(path.join(dir, 'manifest.json'));
        } finally { job.finished = true; try { fs.rmSync(job.work, { recursive: true, force: true }); } catch { /* ignore */ } }
      }));
      return job.promise;
    } catch (err) {
      log('request failed:', err?.stack ?? err);
      try { send({ type: 'blast_status', id, slug: null, stage: 'done', state: 'error', message: `The vision faltered: ${err?.message ?? err}`, progress: { done: 0, total: 1 }, result: null }); } catch { /* ignore */ }
      return Promise.resolve(null);
    }
  }

  const status = () => ({ active: [...jobs.values()].filter((j) => !j.finished).map((j) => j.slug), queued, worker: worker?.state?.worker ?? 'n/a', cached: list().length });
  async function shutdown() { shuttingDown = true; try { await worker?.shutdown?.(); } catch { /* ignore */ } }
  return { request, blast: request, get, list, replay, status, shutdown, inputDir, checkImage, slugFor };
}
