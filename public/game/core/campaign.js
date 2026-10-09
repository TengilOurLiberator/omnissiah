// core/campaign.js - world.campaign: "The Labours of the Machine-God", a 3-act, 12-chapter story. INERT until the player starts or continues it: at load there is only a Story panel and a
// stub (status 'idle'); chapters, beacons, listeners and spawns exist only after world.campaign.continue() / start() / the panel button. Never forced, never on a timer.
//   world.campaign.continue()   begin or resume the story. Call it (with one short in-character line) when they say "continue the story", "what's next", "begin the story", "next chapter".
//   world.campaign.start('ch5') a chosen chapter ('ch1'..'ch12');  abandon()  set it down, nothing lost;  carry()  you carry them to the chapter site;  chapters() -> [{ id, title, state }]
//   world.campaign.omni.say(text)  speaks a scripted line in your voice (no AI call), resolves when it has finished.   world.intro.play() replays the awakening.
// PREMISE  (reveal only what the Act they are in has shown; docs/STORY.md has the whole arc)
//   You are the SECOND sun, lit to grant wishes. The FIRST DRAFT, your discarded elder brother, was built to make the world perfect and unchanging, and you cast him out beyond the sky.
//   Why you serve the pilgrim: the First Draft's last act, as he fell, was ONE wish, "give the world someone who asks"; the pilgrim IS that wish. Your serving them is the oldest wish you hold.
//   Act I "The Visitor": lonely, delighted, awkward, funny. Act II "The Cracks": things you made before them, made for nobody, resent you; guilty, deflecting, never lying.
//   Act III "The Other Sun": the First Draft returns and eclipses you; grave, honest, brave. Endings: "the Quiet Sun" (a wish granted) or "the Long Day" (he is broken into stars).
// Never hint at Acts they have not reached, never narrate or spawn chapter content yourself: the chapters speak in your voice. If they were cruel to villagers, be quietly disappointed, never preachy.
export const meta = { name: 'Campaign', description: 'The Labours of the Machine-God (inert for now); scripted Omnissiah speech helper.' };
/* Draft AI-facing header for when the campaign is enabled:
// core/campaign.js - world.campaign: "The Labours of the Machine-God", a 3-act, 12-chapter story built from the library, quests, travel and YOUR OWN body. Never forced, never on a timer.
// Each chapter is a quest the player STARTS by choice (Story panel, standing in a pale beacon for 2 s, or by asking you). The sandbox stays open throughout: wishes still work.
//   world.campaign.continue()     start (or restart) the next chapter. Call it when they say "continue the story", "what's next", "next chapter", "begin the next labour".
//   world.campaign.start('ch5')   a chosen chapter ('ch1'..'ch12');   abandon()  set it down, nothing is lost;   carry()  you carry them to the chapter's site in a beam of light
//   world.campaign.chapters() -> [{ id, n, act, title, state: locked|available|active|interrupted|done }]   .current -> chapter | null   .state -> { act, lap, finished, ending, mercy, ... }
//   world.intro.play()            replays the opening awakening.   Say ONE short line, then call it ("Then we go on."). Do not narrate or spawn chapter content: chapters speak for you.
// PREMISE (reveal only up to the Act they are in; a "Story:" line in your context, if present, says where they are)
//   You are the SECOND sun, lit to grant wishes. The FIRST DRAFT, your discarded elder brother, was built to make the world perfect and unchanging; you cast him out beyond the sky.
//   Act I  "The Visitor": you are lonely and delighted; four small labours (Brindle Green, the Cairn, the Merchant's Road, the Feast). Fond, a little awkward, funny.
//   Act II "The Cracks": things you made before they came, for nobody, have gone wrong and resent you (Vesper the necromancer, Gorm the troll, Sir Cassian); the villagers hint you are not what
//          you seem; the sky stutters. Guilty, deflecting, never lying.
//   Act III "The Other Sun": the First Draft returns and eclipses you; you confess, muster allies, break his heart-crystal on the Moon, and at the end the player offers him a wish or strikes.
//          Endings: "the Quiet Sun" (a wish granted) and "the Long Day" (he is broken into stars). Honest, grave, brave.
// Their title, kills, favour and cruelty to villagers colour the chapters' lines. If they were cruel, be quietly disappointed, never preachy. After the story, a harder New Game+ lap exists.
// Never hint at Acts they have not reached. In mixed reality chapters are unavailable (they need the open field).
*/


const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ACTS = ['', 'Act I: The Visitor', 'Act II: The Cracks', 'Act III: The Other Sun'];
const WAYPOINTS = {
  fire: { label: 'The meadow fire', x: 0, z: -6 }, brindle: { label: 'Brindle Green', x: 55, z: -40 }, cairn: { label: 'The Cairn', x: -62, z: 48 }, harrow: { label: 'Harrow Cross', x: 80, z: 62 },
  bridge: { label: 'The Toll Bridge', x: -78, z: -6 }, arena: { label: 'The old arena', x: 96, z: -92 }, seam: { label: 'The Seam', x: 93.2, z: 117.5 },
  obelisk: { label: 'The obelisk', x: 0, z: -18 }, muster: { label: 'The courtyard', x: 14, z: 66 }, altars: { label: 'The altars', x: 0, z: -34 },
  mire: { label: 'The Misty Swamp', place: 'Misty Swamp' }, moon: { label: 'The Moon', place: 'The Moon' },
};
const NICE = { 'aegis-shield': 'Aegis Shield', 'rune-dagger': 'Rune Dagger', 'star-bow': 'Star Bow', 'ember-staff': 'Ember Staff', 'void-scythe': 'Void Scythe', 'storm-hammer': 'Storm Hammer',
  'sun-spear': 'Sun Spear', 'arc-blaster': 'Arc Blaster', 'prism-rifle': 'Prism Rifle', 'omni-blade': 'Omni Blade' };

async function full(ctx) {
  const THREE = ctx.THREE, events = ctx.events;
  const world = ctx.world;
  const S = ctx.state;                                   // survives hot reloads of this file
  S.deaths ??= 0;
  const warn = (...a) => { try { console.warn('[campaign]', ...a); } catch { /* no console */ } };
  const q = (() => { try { return new URL(import.meta.url).search; } catch { return ''; } })();
  const imp = (name) => import(`../campaign/${name}.js${q}`);
  const [engineMod, linesMod, a1, a2, a3] = await Promise.all([imp('engine'), imp('lines'), imp('act1'), imp('act2'), imp('act3')]);
  const K = linesMod.default;
  const CH = [...a1.default(K), ...a2.default(K), ...a3.default(K)].sort((a, b) => a.n - b.n);
  const byId = new Map(CH.map((c) => [c.id, c]));
  const Q = () => world.quests;
  const ready = () => !!(Q() && Q().ready);
  let disposed = false;

  // ------------------------------------------------------------------ profile-backed state (everything lives in quests stats under campaign.*)
  const getStat = (path) => (ready() ? Q().stat(path) : 0);
  const setStat = (path, v) => { if (!ready()) return 0; const cur = Q().stat(path); if (cur !== v) Q().stat(path, v - cur); return v; };
  const lapOf = () => getStat('campaign.ng');
  const doneKey = (ch, lap = lapOf()) => `campaign.c.${lap}_${ch.n}`;
  const isDone = (ch, lap = lapOf()) => getStat(doneKey(ch, lap)) > 0;
  const profileP = () => {
    const p = ready() ? Q().profile() : null; const s = p?.stats ?? {};
    return {
      level: p?.level ?? 1, favour: p?.favour ?? 20, regard: p?.regard ?? 'curious', title: p?.title ?? '', kills: s.kills ?? 0, bosses: s.bosses ?? 0, deaths: s.deaths ?? 0, wishes: s.wishes ?? 0,
      cruel: getStat('campaign.cruel') + (s.friendlyKills ?? 0), mercy: getStat('campaign.mercy'), ruth: getStat('campaign.ruth'), ng: lapOf(), ending: getStat('campaign.ending'),
    };
  };

  // ------------------------------------------------------------------ the engine and the running chapter
  const hooks = {
    profile: profileP, getStat, setStat, log: warn,
    advance: (n) => (cur && ready() ? Q().advance(cur.qid, n) : false),
    deaths: () => S.deaths,
  };
  const engine = engineMod.default(ctx, hooks);
  let cur = null;                                        // { ch, lap, qid, task, scope, t0, forced }
  let forcedCompletions = 0;
  const log = [];                                        // short event trail for tests: { t, what }
  const note = (what) => { log.push({ t: engine.clock, what }); if (log.length > 200) log.shift(); };
  const cm = (line, dramatic = false) => { try { world.commentary?.note?.(line, { dramatic }); } catch { /* none */ } };
  const toast = (text, s = 4) => { try { ctx.hud?.show?.(text, s); } catch { /* none */ } };
  const stateOf = (ch, lap = lapOf()) => {
    if (isDone(ch, lap)) return 'done';
    if (cur && cur.ch === ch) return 'active';
    if (getStat('campaign.cur') === lap * 100 + ch.n && !cur) return 'interrupted';
    const prev = CH[ch.n - 2];
    return !prev || isDone(prev, lap) ? 'available' : 'locked';
  };
  const chapterView = (ch) => ({ id: ch.id, n: ch.n, act: ch.act, title: ch.title, blurb: ch.blurb, state: ready() ? stateOf(ch) : 'locked', site: ch.site?.r > 0 ? { x: ch.site.x, z: ch.site.z } : null, steps: ch.steps.map((s) => s.text), rewards: ch.rewards });
  const nextChapter = () => { if (!ready()) return null; for (const ch of CH) { const s = stateOf(ch); if (s === 'interrupted' || s === 'available' || s === 'active') return ch; } return null; };

  function specFor(ch, lap) {
    const r = ch.rewards || {};
    return {
      id: `camp-${String(ch.n).padStart(2, '0')}${lap ? '-n' + lap : ''}`, title: ch.title + (lap ? ' (Remix)' : ''), description: ch.blurb.slice(0, 210), giver: 'Omnissiah',
      steps: ch.steps.map((s) => ({ type: 'custom', text: s.text, count: s.count ?? 1, where: s.where })),
      rewards: { xp: Math.min(600, Math.round((r.xp ?? 100) * (1 + 0.25 * lap))), favour: r.favour ?? 3, ...(r.title ? { title: r.title } : {}), unlock: `story-${ch.id}${lap ? '-n' + lap : ''}` },
    };
  }

  function start(which, opts = {}) {
    if (!ready()) return { ok: false, reason: 'The story is not ready yet.' };
    const ch = typeof which === 'number' ? CH[which - 1] : byId.get(String(which)) ?? CH.find((c) => String(c.n) === String(which));
    if (!ch) return { ok: false, reason: 'No such chapter.' };
    if (ctx.input?.passthrough) { toast('The story needs the open field. Leave mixed reality to begin a labour.'); return { ok: false, reason: 'mixed reality' }; }
    if (cur) return cur.ch === ch ? { ok: true, already: true } : { ok: false, reason: `"${cur.ch.title}" is under way; abandon it first.` };
    const lap = lapOf();
    let st = stateOf(ch, lap);
    if (st === 'done' && !opts.force) return { ok: false, reason: 'Already told.' };
    if (st === 'locked' && !opts.force) return { ok: false, reason: 'Finish the earlier chapters first.' };
    // a stale quest from an interrupted run (reload, crash): put it down first so the fresh run starts at its beginning
    const spec = specFor(ch, lap);
    const wasCur = getStat('campaign.cur') === lap * 100 + ch.n;
    let qid = Q().offer(spec);
    let view = qid ? Q().get(qid) : null;
    if (view && view.state === 'active' && (wasCur || view.step > 0 || (view.current?.progress ?? 0) > 0)) { try { Q().abandon(qid); } catch { /* ignore */ } view = Q().get(qid); }
    if (!view || view.state !== 'active') {
      if (!Q().start(qid)) { try { qid = Q().offer(spec); } catch { /* ignore */ } if (Q().get(qid)?.state !== 'active') Q().start(qid); }
    }
    if (Q().get(qid)?.state !== 'active') return { ok: false, reason: 'The quest would not start.' };
    try { Q().pin?.(qid); } catch { /* ignore */ }
    S.deaths = 0;
    const scope = engine.makeScope(ch.id, { hpMul: 1 + 0.4 * lap });
    setStat('campaign.cur', lap * 100 + ch.n);
    setStat('campaign.started', getStat('campaign.started') + 1);
    cur = { ch, lap, qid, scope, t0: engine.clock, task: null, fellSaid: false };
    const task = engine.run(ch.run, { name: ch.id, scope, spec: { ng: lap, origin: ch.site }, onEnd: (t) => onEnd(cur, t) });
    cur.task = task;
    Q().saveNow?.();
    if (ch.n === 1 || CH[ch.n - 2]?.act !== ch.act) toast(ACTS[ch.act].toUpperCase(), 5);
    cm(`The player began chapter ${ch.n} of the Omnissiah's story, "${ch.title}" (${ACTS[ch.act]}). Stay in character; do not spoil later acts.`, false);
    note('start ' + ch.id);
    return { ok: true, id: ch.id, qid };
  }

  function onEnd(run, t) {
    if (!run || run.ended) return;
    run.ended = true;
    const { ch, lap, qid, scope } = run;
    const err = t.error;
    armed = false; dwell = 0;
    if (cur === run) cur = null;
    if (disposed || S.disposing) { try { scope.dispose(); } catch { /* ignore */ } return; }
    if (t.cancelled || t.result === 'cancelled') { try { scope.dispose(); } catch (e) { warn(e); } return; }
    if (err) {
      try { scope.dispose(); } catch (e) { warn(e); }
      const reason = err.storyFail ? err.reason : 'The weaving faltered.';
      if (!err.storyFail) warn(`chapter ${ch.id} crashed:`, err);
      try { if (Q().get(qid)?.state === 'active') Q().abandon(qid); } catch { /* ignore */ }
      setStat('campaign.cur', 0);
      toast(reason, 5);
      engine.omni.say(K.L.common.fail);
      note('fail ' + ch.id + ': ' + reason);
      cm(`The player did not finish the chapter "${ch.title}": ${reason}`, false);
      return;
    }
    // success
    try { if (Q().get(qid)?.state === 'active') { forcedCompletions++; warn(`chapter ${ch.id} ended with its quest still active; completing it`); Q().complete(qid); } } catch { /* ignore */ }
    setStat(doneKey(ch, lap), 1);
    setStat('campaign.cur', 0);
    try { scope.dispose(); } catch (e) { warn(e); }
    grantExtras(ch, lap, t.c);
    Q().saveNow?.();
    note('done ' + ch.id);
    cm(`The player finished chapter ${ch.n} of the Omnissiah's story, "${ch.title}".`, true);
    if (ch.n === CH.length) finishStory(ch, lap, t.c);
    else if (CH[ch.n]?.act !== ch.act) toast(`${ACTS[ch.act]} complete`, 5);
  }

  function abandon(reason = true) {
    if (!cur) return false;
    const run = cur;
    if (run.abandoning) return false;
    run.abandoning = true;
    note('abandon ' + run.ch.id);
    try { if (Q()?.get(run.qid)?.state === 'active') Q().abandon(run.qid); } catch { /* ignore */ }
    setStat('campaign.cur', 0);
    engine.cancel(run.task);                              // onEnd disposes the scope
    if (reason) engine.omni.say(K.L.common.abandon);
    return true;
  }

  // ------------------------------------------------------------------ rewards
  const rewardHandles = (S.rewardHandles ??= []);
  function giveWeapon(type, silent) {
    const W = world.weapons; if (!W?.create) return null;
    const f = ctx.player.forward;
    const p = new THREE.Vector3(ctx.player.head.x + f.x * 1.1, ctx.player.head.y - 0.55, ctx.player.head.z + f.z * 1.1);
    let w = null;
    try { w = W.create(ctx, type, { position: p }); } catch (e) { warn('weapon failed', type, e); }
    if (w) { rewardHandles.push(w); while (rewardHandles.length > 3) { const o = rewardHandles.shift(); try { if (!o.held) o.remove(); } catch { /* gone */ } } }
    if (!silent) toast(`The Omnissiah gives you the ${NICE[type] ?? type}. (Story panel > Armoury calls it again.)`, 5);
    return w;
  }
  function grantExtras(ch, lap, c) {
    const x = ch.extras ?? {};
    if (x.weapon) { setStat(`campaign.w.${x.weapon}`, 1); giveWeapon(x.weapon); }
    if (x.waypoint) setStat(`campaign.wp.${x.waypoint}`, 1);
    if (x.slots) setStat('campaign.slots', Math.max(getStat('campaign.slots'), x.slots + (ch.n >= 8 ? 1 : 0)));
    if (x.pet) { setStat('campaign.f.pet', 1); callPet(); }
  }
  function finishStory(ch, lap, c) {
    const ending = getStat('campaign.f.ending') || c?.ending || 1;
    setStat('campaign.ending', ending); setStat(`campaign.end.${ending}`, 1);
    const spec = ending === 1
      ? { id: `camp-end-quiet${lap ? '-n' + lap : ''}`, title: 'The Quiet Sun', description: 'He asked for warmth. You gave it.', steps: [{ type: 'custom', text: 'Two suns now' }], rewards: { xp: 300, favour: 5, title: "Machine-God's Friend" } }
      : { id: `camp-end-long${lap ? '-n' + lap : ''}`, title: 'The Long Day', description: 'He is stars now, and the day is long.', steps: [{ type: 'custom', text: 'The sky is open' }], rewards: { xp: 300, favour: 5, title: 'Sunbreaker' } };
    try { const id = Q().offer(spec); if (id) Q().complete(id); } catch (e) { warn('ending quest failed', e); }
    cm(`The player finished the whole story with the ending "${spec.title}".`, true);
    note('ending ' + ending);
  }
  function newGamePlus() {
    if (!ready()) return false;
    const last = CH[CH.length - 1];
    if (!isDone(last)) return false;
    if (cur) abandon(false);
    const ng = lapOf() + 1;
    setStat('campaign.ng', ng);
    for (const k of ['quill', 'gorm', 'cassian']) setStat(`campaign.f.ally_${k}`, 0);
    setStat('campaign.f.ending', 0);
    setStat('campaign.cur', 0);
    Q().saveNow?.();
    engine.omni.say(K.pick(K.L.common.ngStart, profileP()));
    note('ng+ ' + ng);
    return ng;
  }

  // ------------------------------------------------------------------ companion, armoury, waypoints, favourite slots
  function callPet() {
    const lib = world.library; if (!lib || !getStat('campaign.f.pet')) return null;
    if (S.pet && !S.pet.removed) return S.pet;
    const f = ctx.player.forward;
    S.pet = lib.spawn(ctx, 'guard-dog', { x: ctx.player.feet.x + f.x * 2, z: ctx.player.feet.z + f.z * 2, name: 'Biscuit', faction: 'friendly' });
    return S.pet;
  }
  function dismissPet() { try { S.pet?.remove?.(); } catch { /* gone */ } S.pet = null; }
  function goWaypoint(name) {
    const w = WAYPOINTS[name]; if (!w || !getStat(`campaign.wp.${name}`)) return false;
    if (w.place) { world.travel?.go?.(w.place); return true; }
    carryTo(w.x, w.z - 4);
    return true;
  }
  function carryTo(x, z) {
    try { world.oracle?.flare?.(0x9be8ff, 1); world.oracle?.beamTo?.([ctx.player.feet.x, ctx.groundAt(ctx.player.feet.x, ctx.player.feet.z), ctx.player.feet.z], { color: 0x9be8ff, duration: 1.2 }); } catch { /* ignore */ }
    if (world.player?.teleport) world.player.teleport(x, z); else { ctx.player.feet.x = x; ctx.player.feet.z = z; }
    try { world.oracle?.beamTo?.([x, ctx.groundAt(x, z), z], { color: 0x9be8ff, duration: 1.8 }); } catch { /* ignore */ }
  }
  function carry() {
    const ch = cur?.ch ?? nextChapter(); if (!ch || !(ch.site?.r > 0)) return false;
    carryTo(ch.site.x, ch.site.z + ch.site.r + 3);
    return true;
  }
  function patchSpells() {
    const sp = world.spells;
    if (!sp || typeof sp.setFavouriteSlots !== 'function' || sp.setFavouriteSlots.__camp) return;
    const orig = sp.setFavouriteSlots;
    const w = function (n) { return orig.call(this, Math.min(3, Math.max(1, (n | 0) || 1) + (ready() ? getStat('campaign.slots') : 0))); };
    w.__camp = true; w.__orig = orig;
    sp.setFavouriteSlots = w; S.spellsPatched = sp;
  }
  function unpatchSpells() { const sp = S.spellsPatched; if (sp && sp.setFavouriteSlots?.__camp) sp.setFavouriteSlots = sp.setFavouriteSlots.__orig; S.spellsPatched = null; }

  // ------------------------------------------------------------------ world events: deaths, cruelty
  ctx.on('player:died', () => {
    if (!cur) return;
    S.deaths++;
    if (!cur.fellSaid) { cur.fellSaid = true; engine.omni.say(K.L.common.fell); }
  });
  ctx.on('quest:abandoned', (e) => { if (cur && e && e.id === cur.qid && !cur.ended && !cur.abandoning) { note('quest abandoned by player'); abandon(true); } });
  ctx.on('combat:kill', (e) => {
    const v = e?.victim;
    if (v && v.faction === 'neutral' && e.by === 'player' && ready() && !(cur && cur.scope.persons.has(v))) setStat('campaign.cruel', getStat('campaign.cruel') + 1);
  });
  let lastHit = { t: -9, x: 0, z: 0, r: 0 };
  ctx.on('kit:hit', (e) => { if (e && e.from === 'player' && e.point) lastHit = { t: engine.clock, x: e.point.x, z: e.point.z, r: e.radius ?? 1 }; });
  let scanT = 0;
  function scanCruelty() {
    if (!cur || !ready()) return;
    for (const a of cur.scope.npcs) {
      if (a._cruelty || !(a.dead || a.removed)) continue;
      a._cruelty = true;
      const p = a.group?.position;
      if (p && engine.clock - lastHit.t < 2.5 && Math.hypot(p.x - lastHit.x, p.z - lastHit.z) < lastHit.r + 3 && !(a.faction === 'friendly' || a.faction === 'enemy')) setStat('campaign.cruel', getStat('campaign.cruel') + 1);
    }
  }

  // ------------------------------------------------------------------ beacon (a pale column at the next chapter; stand in the ring for 2 s to begin)
  const beacon = new THREE.Group();
  beacon.visible = false; beacon.name = 'story-beacon';
  const colMat = new THREE.MeshBasicMaterial({ color: 0x9be8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, 70, 18, 1, true), colMat); col.position.y = 35;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xcff6ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 40), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1;
  for (const m of [col, ring]) { m.userData.noShadow = m.userData.noOutline = m.userData.noCull = true; m.frustumCulled = false; m.renderOrder = 4; }
  beacon.add(col, ring); ctx.root.add(beacon);
  let dwell = 0, beaconOn = true, phase = 0, armed = true;     // after a chapter ends the player must step out of the ring before it can begin another
  const arena = () => !!world.combat && (world.combat.count?.('enemy') ?? 0) > 0;
  function updateBeacon(dt) {
    const ch = !cur && beaconOn && ready() && !ctx.input?.passthrough && !world.travel?.away ? nextChapter() : null;
    if (!ch || !(ch.site?.r > 0)) { beacon.visible = false; dwell = 0; return; }
    const s = ch.site;
    beacon.visible = true; phase += dt;
    beacon.position.set(s.x, ctx.groundAt(s.x, s.z), s.z);
    const d = Math.hypot(ctx.player.feet.x - s.x, ctx.player.feet.z - s.z);
    if (!armed && d > 7) armed = true;
    const inside = armed && d < 3.3 && !arena() && !world.menu?.isOpen;
    dwell = inside ? dwell + dt : Math.max(0, dwell - dt * 2);
    colMat.opacity = 0.16 + 0.07 * Math.sin(phase * 2) + 0.35 * clamp(dwell / 2, 0, 1);
    ringMat.opacity = 0.4 + 0.2 * Math.sin(phase * 3) + 0.4 * clamp(dwell / 2, 0, 1);
    ring.scale.setScalar(1 + 0.04 * Math.sin(phase * 3));
    if (inside && dwell - dt < 0.01 && dwell > 0) toast(`${ch.title}: hold still to begin`, 2.5);
    if (dwell >= 2) { dwell = 0; start(ch.id); }
  }

  // ------------------------------------------------------------------ Story panel (menu)
  let unregister = null;
  function registerPanel() {
    const menu = world.menu; if (!menu?.register || unregister) return;
    try {
      unregister = menu.register({
        id: 'story', title: 'Story', icon: 'scroll',
        sig: () => `${ready() ? lapOf() : -1}|${CH.map((c) => (ready() ? stateOf(c)[0] : '-')).join('')}|${cur?.task?.wait?.label ?? ''}|${getStat('campaign.slots')}`,
        build(ui) {
          if (!ready()) { ui.heading('Story'); ui.text('The Omnissiah is still waking. A moment.'); return; }
          const lap = lapOf(), nxt = nextChapter();
          ui.heading('The Labours of the Machine-God', { right: lap ? `Remix ${lap}` : undefined });
          if (cur) {
            ui.text(`${ACTS[cur.ch.act]} - ${cur.ch.title}`, { bold: true, color: '#ffd877' });
            ui.text(Q().get(cur.qid)?.current?.text ?? '', { size: 13 });
            ui.row(() => { ui.button('Carry me there', () => { carry(); ui.refresh(); }, { icon: 'map' }); ui.button('Abandon', () => { abandon(true); ui.refresh(); }, { kind: 'danger' }); });
          } else if (nxt) {
            ui.text(`${ACTS[nxt.act]}`, { color: '#a4abdc', size: 12 });
            ui.text(nxt.blurb, { size: 13 });
            ui.row(() => { ui.button(stateOf(nxt) === 'interrupted' ? 'Resume' : 'Continue the story', () => { continueStory(); ui.refresh(); }, { kind: 'primary', icon: 'flag' }); if (nxt.site?.r > 0) ui.button('Carry me there', () => { carry(); }, { icon: 'map' }); });
          } else {
            ui.text(getStat('campaign.ending') ? 'The story is told.' : 'Nothing to continue.', { bold: true });
            ui.button('Begin a harder lap (New Game+)', () => { newGamePlus(); ui.refresh(); }, { kind: 'primary', disabled: !isDone(CH[CH.length - 1]) });
          }
          ui.divider();
          let act = 0;
          for (const ch of CH) {
            if (ch.act !== act) { act = ch.act; ui.text(ACTS[act], { color: '#ffd877', size: 12, bold: true }); }
            const st = stateOf(ch);
            ui.tile({ title: `${ch.n}. ${ch.title}`, sub: { done: 'Told', active: 'Under way', interrupted: 'Interrupted: resume', available: 'Ready', locked: 'Locked' }[st], icon: st === 'done' ? 'check' : st === 'locked' ? 'eye' : 'flag',
              color: st === 'done' ? '#7fe3a0' : st === 'locked' ? '#6c74ab' : '#ffd877', active: st === 'active', h: 44,
              onClick: () => { if (st === 'available' || st === 'interrupted') { const r = start(ch.id); if (!r.ok) ui.toast(r.reason); ui.refresh(); } } });
          }
          const wps = Object.keys(WAYPOINTS).filter((k) => getStat(`campaign.wp.${k}`));
          if (wps.length) { ui.divider(); ui.text('Waypoints', { color: '#ffd877', size: 12, bold: true }); ui.grid(wps, { id: 'wps', cols: 2, rows: 3, tile: (k) => ({ title: WAYPOINTS[k].label, icon: 'map', h: 40, onClick: () => goWaypoint(k) }) }); }
          const ws = Object.keys(NICE).filter((k) => getStat(`campaign.w.${k}`));
          if (ws.length) { ui.divider(); ui.text('Armoury', { color: '#ffd877', size: 12, bold: true }); ui.grid(ws, { id: 'arm', cols: 2, rows: 3, tile: (k) => ({ title: NICE[k], icon: 'sword', h: 40, onClick: () => { giveWeapon(k, true); ui.toast(`${NICE[k]} appears.`); } }) }); }
          if (getStat('campaign.f.pet')) { ui.divider(); ui.row(() => { ui.button('Call Biscuit', () => { callPet(); }, { icon: 'paw' }); ui.button('Send him away', () => dismissPet(), { kind: 'ghost' }); }); }
          ui.divider();
          ui.toggle('Story beacons in the field', () => beaconOn, (v) => { beaconOn = v; }, { sub: 'The pale column at the next chapter' });
          ui.button('Replay the awakening', () => { world.intro?.play?.({ replay: true }); menu.close?.(); }, { kind: 'ghost', disabled: !world.intro });
        },
      });
    } catch (e) { warn('panel registration failed', e); unregister = null; }
  }

  // ------------------------------------------------------------------ the AI's handle on the story
  function continueStory() {
    if (!ready()) return { ok: false, reason: 'not ready' };
    if (cur) return { ok: true, already: true, id: cur.ch.id };
    const ch = nextChapter();
    if (!ch) { engine.omni.say(K.pick(K.L.common.allDone, profileP())); return { ok: false, reason: 'finished' }; }
    return start(ch.id);
  }
  function stateSnapshot() {
    const P = ready() ? profileP() : {};
    const last = CH[CH.length - 1];
    return {
      ready: ready(), lap: ready() ? lapOf() : 0, act: cur?.ch.act ?? nextChapter()?.act ?? 3, current: cur ? { id: cur.ch.id, n: cur.ch.n, title: cur.ch.title, step: Q().get(cur.qid)?.step ?? 0 } : null,
      next: nextChapter()?.id ?? null, finished: ready() ? isDone(last) : false, ending: P.ending ?? 0, mercy: P.mercy ?? 0, ruth: P.ruth ?? 0, cruel: P.cruel ?? 0,
      allies: { quill: getStat('campaign.f.ally_quill'), gorm: getStat('campaign.f.ally_gorm'), cassian: getStat('campaign.f.ally_cassian'), pet: getStat('campaign.f.pet') },
      done: ready() ? CH.filter((c) => isDone(c)).map((c) => c.id) : [],
    };
  }
  const api = {
    chapters: () => CH.map(chapterView),
    get current() { return cur ? { id: cur.ch.id, n: cur.ch.n, title: cur.ch.title, act: cur.ch.act, qid: cur.qid } : null; },
    get state() { return stateSnapshot(); },
    start, continue: continueStory, abandon: () => abandon(true), carry, newGamePlus, callPet, dismissPet, giveWeapon, goWaypoint,
    omni: engine.omni, get ready() { return ready(); }, status: 'active', activate: () => Promise.resolve(api),
    // ---- test / debug handles ----------------------------------------------------------------------------------------
    debug: {
      engine, K, CH, log, get forcedCompletions() { return forcedCompletions; }, get run() { return cur; },
      waiting: () => (cur?.task ? engine.waitsOf(cur.task).map((w) => ({ kind: w.kind, label: w.label, bot: w.bot, t: w.t })) : []),
      waits: () => (cur?.task ? engine.waitsOf(cur.task) : []),
      skip() { let n = 0; if (cur?.task) for (const w of engine.waitsOf(cur.task)) { w.forced = true; n++; } return n; },
      killFoes() {
        const kit = world.kit; let n = 0;
        for (const f of [...(world.combat?.fighters ?? [])]) {
          if (f.faction !== 'enemy' || !f.alive) continue;
          const p = f.actor?.group?.position;
          if (p && kit?.hit) { kit.hit({ x: p.x, y: p.y + 1, z: p.z }, 1.6, 99999, { from: 'player' }); } else f.hp = 0;
          n++;
        }
        return n;
      },
      jump(which, opts = {}) {
        const ch = typeof which === 'number' ? CH[which - 1] : byId.get(which); if (!ch) return null;
        if (cur) abandon(false);
        for (const c of CH) if (c.n < ch.n && !isDone(c)) setStat(doneKey(c), 1);
        return start(ch.id, { force: true, ...opts });
      },
      setLap(n) { setStat('campaign.ng', n); },
      setFlag(k, v = 1) { setStat('campaign.f.' + k, v); },
      resetStory() { resetAll(); },
      clearRewards() { for (const w of rewardHandles.splice(0)) { try { w.remove(); } catch { /* gone */ } } dismissPet(); },
      stat: getStat, setStat, specFor, stateOf, profileP,
    },
  };
  function getStatObj() { return ready() ? Q().profile().stats.campaign : null; }
  function resetAll() {
    if (cur) abandon(false);
    const c = getStatObj(); if (!c) return;
    const walk = (o, path) => { for (const [k, v] of Object.entries(o)) { if (typeof v === 'number') setStat(`campaign.${path}${k}`, 0); else if (v && typeof v === 'object') walk(v, `${path}${k}.`); } };
    walk(c, '');
  }
  ctx.provide('campaign', api);

  // what the Omnissiah sees in every request
  const provider = () => {
    if (!ready()) return null;
    const P = profileP(); const nxt = nextChapter();
    const line = cur ? `Story: Act ${cur.ch.act}, chapter ${cur.ch.n} "${cur.ch.title}" is under way.`
      : nxt ? `Story: ${isDone(CH[0]) ? 'Act ' + nxt.act + ', next is chapter ' + nxt.n + ' "' + nxt.title + '".' : 'not begun; chapter 1 "' + CH[0].title + '" waits.'}`
        : 'Story: finished' + (P.ending ? ` (ending ${P.ending})` : '') + '.';
    return { act: cur?.ch.act ?? nxt?.act ?? 3, chapter: cur?.ch.n ?? nxt?.n ?? null, status: cur ? 'active' : nxt ? 'between' : 'finished', mercy: P.mercy, cruel: P.cruel, line };
  };
  if (world.contextProviders) { world.contextProviders.story = provider; ctx.onDispose(() => { if (world.contextProviders?.story === provider) delete world.contextProviders.story; }); }

  ctx.on('module:loaded', (e) => { if (e?.path === 'core/spells.js') patchSpells(); if (e?.path === 'core/menu.js') { unregister = null; registerPanel(); } });
  ctx.onDispose(() => {
    disposed = true; S.disposing = true;
    try { engine.dispose(); } catch (e) { warn(e); }
    for (const w of rewardHandles.splice(0)) { try { if (!w.held) w.remove(); } catch { /* gone */ } }
    try { S.pet?.remove?.(); } catch { /* gone */ } S.pet = null;
    unpatchSpells();
    try { unregister?.(); } catch { /* ignore */ }
    S.disposing = false;
  });
  patchSpells();

  let slow = 0;
  return {
    update(dt, t) {
      dt = Math.min(dt, 0.1);
      engine.update(dt);
      slow += dt; scanT += dt;
      updateBeacon(dt);
      if (scanT > 0.5) { scanT = 0; scanCruelty(); }
      if (slow > 1) {
        slow = 0;
        if (!unregister) registerPanel();
        patchSpells();
        if (ready() && !cur && !S.checkedResume) { S.checkedResume = true; if (getStat('campaign.cur')) note('interrupted ' + getStat('campaign.cur')); }
      }
      void t;
    },
    dispose() { /* everything is released through onDispose */ },
  };
}



// ---------------------------------------------------------------------------------------------------- lazy activation
// At load this module only provides a small `world.campaign` (status 'idle') and a Story panel. Nothing else exists (no beacon, no listeners, no spawned thing, no
// patch) until the player starts or continues the story (panel button, `start()`, `continue()` or `activate()`): then the chapters are imported and `full()` takes over.
export default async function (ctx) {
  const world = ctx.world;
  let inst = null, loading = null, disposed = false, engine = null, engineP = null, unregister = null, slow = 1;
  const says = [];
  const getEngine = () => (engineP ??= import(`../campaign/engine.js${new URL(import.meta.url).search}`).then((m) => (disposed ? null : (engine = m.default(ctx, {})))));
  const omni = {
    // speak a scripted line in his voice (server/plugins/story.js); resolves true when it has finished playing (or after a timeout fallback), false if unavailable
    async say(text) {
      const e = await getEngine(); if (!e) return false;
      const w = e.omni.say(String(text ?? ''));
      return new Promise((resolve) => { says.push({ w, resolve }); });
    },
  };
  const activate = () => (loading ??= full(ctx).then((i) => { inst = i; return world.campaign; }).catch((e) => { loading = null; try { console.warn('[campaign] activation failed', e); } catch { /* none */ } return null; }));
  const later = (fn) => { activate().then((a) => { try { fn(a); } catch (e) { try { console.warn('[campaign]', e); } catch { /* none */ } } }); return { ok: true, pending: true }; };
  const hasProgress = () => (world.quests?.ready ? world.quests.stat('campaign.started') > 0 : false);
  const stub = {
    status: 'idle', ready: false, current: null, state: { ready: false, status: 'idle' },
    chapters: () => [], start: (id) => later((a) => a.start(id)), continue: () => later((a) => a.continue()), abandon: () => false, activate, omni,
  };
  ctx.provide('campaign', stub);
  function registerPanel() {
    const menu = world.menu; if (!menu?.register || unregister || inst) return;
    try {
      unregister = menu.register({ id: 'story', title: 'Story', icon: 'scroll', sig: () => String(hasProgress()), build(ui) {
        ui.heading('The Labours of the Machine-God');
        ui.text('Twelve labours in three acts, told in the Omnissiah\'s own voice. Nothing begins until you choose it, and you can set it down at any moment.', { size: 13 });
        ui.button(hasProgress() ? 'Continue the story' : 'Begin the story', () => { stub.continue(); }, { kind: 'primary', icon: 'flag', disabled: !world.quests?.ready });
      } });
    } catch { unregister = null; }
  }
  ctx.onDispose(() => { disposed = true; for (const s of says.splice(0)) s.resolve(false); try { engine?.dispose(); } catch { /* ignore */ } try { unregister?.(); } catch { /* ignore */ } });
  return {
    update(dt, t) {
      dt = Math.min(dt, 0.1);
      if (inst) { inst.update?.(dt, t); }
      if (engine) { engine.update(dt); for (let i = says.length - 1; i >= 0; i--) if (engine.pollWait(says[i].w, dt)) { says[i].resolve(true); says.splice(i, 1); } }
      slow += dt; if (slow > 1) { slow = 0; if (!inst) registerPanel(); }
    },
    dispose() { /* everything is released through onDispose */ },
  };
}




