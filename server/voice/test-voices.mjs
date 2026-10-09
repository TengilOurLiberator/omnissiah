// Headless test of public/game/core/voices.js with a fake ctx / net / WebAudio:  node test-voices.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const THREE = await import(pathToFileURL(path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js')).href);
const mod = await import(pathToFileURL(path.join(ROOT, 'public', 'game', 'core', 'voices.js')).href);
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };

// ------------------------------------------------------------ fakes
const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
class FNode {
  constructor(kind) { this.kind = kind; for (const k of ['gain', 'frequency', 'Q', 'detune', 'playbackRate', 'delayTime', 'positionX', 'positionY', 'positionZ', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[k] = param(); this.disconnected = false; }
  connect(x) { return x; } disconnect() { this.disconnected = true; }
  start() { this.started = true; } stop() { this.stopped = true; queueMicrotask(() => this.onended?.()); }
  getFloatTimeDomainData(a) { a.fill(this.kind === 'analyser' ? 0.08 : 0); }
  setPosition() {}
}
class FakeAC {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = new FNode('dest'); }
  resume() {}
  decodeAudioData() { return Promise.resolve({ duration: 1.5 }); }
  createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) }; }
}
for (const [m, k] of [['createGain', 'gain'], ['createBiquadFilter', 'biquad'], ['createBufferSource', 'src'], ['createPanner', 'panner'], ['createAnalyser', 'analyser'], ['createConvolver', 'conv'], ['createDelay', 'delay'], ['createWaveShaper', 'shaper'], ['createDynamicsCompressor', 'comp']])FakeAC.prototype[m] = function () { return new FNode(k); };
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

function emitter() {
  const l = {};
  return { on: (n, f) => { (l[n] ??= []).push(f); return () => { l[n] = l[n].filter((x) => x !== f); }; }, emit: (n, p) => (l[n] || []).forEach((f) => f(p)) };
}
function makeActor(id, x, z, o = {}) {
  const group = new THREE.Group(); group.position.set(x, 0, z);
  const root = new THREE.Group(); root.add(group);
  const a = { group, kind: o.kind ?? 'humanoid', height: 1.8, eyeH: 1.7, faction: o.faction ?? 'friendly', dead: false, removed: false, name: o.name, mdl: o.model ? { name: o.model, kind: 'humanoid' } : null, said: [], faced: [], heldType: o.held, voiceId: id,
    say(t, s) { this.said.push(t); events.emit('actor:say', { actor: this, text: t, seconds: s }); return this; },
    faceTo(v, s) { this.faced.push(v); }, lookAt() {}, stop() { this.stopped = true; }, follow(t) { this.followT = t; }, wander() {}, walkTo(x2, z2) { this.walked = [x2, z2]; }, wave() { this.waved = true; }, equip() {}, position: group.position };
  return a;
}
const events = emitter();
const hp = new THREE.Vector3(0, 1.7, 0), fwd = new THREE.Vector3(0, 0, -1);
const sent = [];
const input = { left: { down: { trigger: false } }, right: { position: new THREE.Vector3(0.3, 1.2, 0), direction: new THREE.Vector3(0, 0, -1), connected: true } };
const fighters = [];
const combat = { fighters, nearest: (p, o) => fighters.find((f) => f.faction !== o.hostileTo) ?? null };
const cleanups = [];
const ctx = {
  THREE, root: new THREE.Group(), state: {}, events, path: 'core/voices.js',
  world: { contextProviders: {}, combat, kit: { actors: [] }, weapons: { held: {}, create: (c, type, o) => { ctx._gave = { type, o }; } } },
  input, player: { head: hp, forward: fwd, feet: new THREE.Vector3() }, audio: { context: new FakeAC(), listener: { getInput: () => new FNode('gain') } },
  net: { connected: true, send: (m) => sent.push(m) }, hud: { show() {} },
  on: (n, f) => { cleanups.push(events.on(n, f)); }, onDispose: (f) => cleanups.push(f), provide: (n, api) => { ctx.world[n] = api; },
};
const inst = await mod.default(ctx);
const V = ctx.world.voices;
check('module provides world.voices and the npc context provider', !!V && typeof ctx.world.contextProviders.npc === 'function');

// ------------------------------------------------------------ casting table
const roles = ['knight', 'dark-knight', 'barbarian', 'mage', 'archer', 'rogue-hooded', 'villager-male-a', 'villager-female-b', 'merchant', 'child', 'king', 'goblin', 'goblin-shaman', 'orc-warrior', 'troll', 'skeleton-warrior', 'demon', 'zombie', 'vampire', 'ghost', 'gravekeeper', 'something unknown'];
const table = roles.map((r) => ({ r, ...mod.castVoice({ id: 'id-' + r, roleText: r }) }));
console.log('    ' + ['role', 'archetype', 'voice', 'speed', 'rate', 'fx'].join(' | '));
for (const c of table) console.log(`    ${c.r.padEnd(18)} ${c.archetype.padEnd(14)} ${c.voice.padEnd(10)} speed ${c.speed}  rate ${c.rate}  fx ${JSON.stringify(c.fx)}`);
const arch = Object.fromEntries(table.map((c) => [c.r, c.archetype]));
check('role -> archetype mapping', arch.knight === 'knight' && arch['dark-knight'] === 'dark-knight' && arch['goblin-shaman'] === 'goblin-shaman' && arch['orc-warrior'] === 'orc' && arch['skeleton-warrior'] === 'skeleton' && arch['villager-female-b'] === 'villager-f' && arch['villager-male-a'] === 'villager' && arch.gravekeeper === 'elder' && arch.demon === 'demon' && arch['something unknown'] === 'person', JSON.stringify(arch));
check('casting is deterministic per id', JSON.stringify(mod.castVoice({ id: 'x1', roleText: 'villager' })) === JSON.stringify(mod.castVoice({ id: 'x1', roleText: 'villager' })));
const vv = new Set(Array.from({ length: 40 }, (_, i) => mod.castVoice({ id: 'v' + i, roleText: 'villager' }).voice));
check('different villagers get different voices', vv.size >= 4, `${vv.size} distinct`);
const g = table.find((c) => c.r === 'goblin'), o = table.find((c) => c.r === 'troll');
check('goblin high / troll low', g.rate > 1.2 && o.rate < 0.75);

// ------------------------------------------------------------ target selection maths
const cands = [{ key: 'a', center: { x: 0, y: 1, z: -4 }, height: 1.8 }, { key: 'b', center: { x: 3, y: 1, z: -4 }, height: 1.8 }, { key: 'far', center: { x: 0, y: 1, z: -12 }, height: 1.8 }];
const ray = (dx, dz) => { const l = Math.hypot(dx, dz); return { origin: { x: 0, y: 1, z: 0 }, dir: { x: dx / l, y: 0, z: dz / l } }; };
check('hand ray picks the one it points at', mod.chooseTarget({ hand: ray(0, -1), gaze: null, cands }) === 'a');
check('hand ray toward the other', mod.chooseTarget({ hand: ray(3, -4), gaze: null, cands }) === 'b');
check('pointing at nothing gives null', mod.chooseTarget({ hand: ray(-1, -0.2), gaze: null, cands }) === null);
check('beyond 8 m is ignored', mod.chooseTarget({ hand: ray(0, -1), gaze: null, cands: [cands[2]] }) === null);
check('gaze is the fallback', mod.chooseTarget({ hand: ray(-1, 0), gaze: ray(3, -4), cands }) === 'b');
check('hand beats gaze', mod.chooseTarget({ hand: ray(0, -1), gaze: ray(3, -4), cands }) === 'a');

// ------------------------------------------------------------ talking: provider + highlight
const knight = makeActor('k1', 0, -4, { model: 'knight', name: undefined });
const goblin = makeActor('g1', 3, -4, { model: 'goblin', faction: 'enemy' });
const dog = makeActor('d1', -1, -3, { kind: 'creature', model: 'dog' });
ctx.world.kit.actors.push(knight, goblin, dog);
fighters.push({ actor: goblin, faction: 'enemy', alive: true, hp: 10, maxHp: 20, name: 'Goblin' }, { actor: knight, faction: 'friendly', alive: true, hp: 20, maxHp: 20, name: 'Knight', follow: null, setTarget(t) { this.tgt = t; } });
knight.damage = { fighter: fighters[1] };
goblin.damage = { fighter: fighters[0] };
check('no npc context while the trigger is up', ctx.world.contextProviders.npc() === null);
input.left.down.trigger = true;
const info = ctx.world.contextProviders.npc();
console.log('    npc context:', JSON.stringify(info));
check('trigger down + pointing at the knight -> npc context', info && info.id === 'k1' && /knight/i.test(info.role) && info.faction === 'friendly' && info.persona.length > 10 && Array.isArray(info.nearby) && info.voice && info.speed > 0 && info.mood === 'calm', '');
check('nearby facts mention the goblin and the player', info.nearby.some((s) => /goblin/i.test(s)) && info.nearby.some((s) => /player stands/.test(s)));
input.right.direction.set(0.6, 0, -0.8).normalize();
check('target stays locked while the trigger is held', ctx.world.contextProviders.npc().id === 'k1');
inst.update(0.016);
check('highlight ring shown on the locked target', ctx.root.children.length > 0 && ctx.root.children[0].visible);
input.left.down.trigger = false; inst.update(0.016);
input.right.direction.set(0.6, 0, -0.8).normalize();
input.left.down.trigger = true;
check('new hold re-aims (now the goblin, enemies are addressable too)', ctx.world.contextProviders.npc()?.id === 'g1');
input.left.down.trigger = false; inst.update(0.016);
input.right.direction.set(-1, 0, 0);
input.left.down.trigger = true;
check('pointing at a creature or nothing -> null (goes to the Omnissiah)', ctx.world.contextProviders.npc() === null);
input.left.down.trigger = false; inst.update(0.016);
input.right.direction.set(0, 0, -1);

// ------------------------------------------------------------ speaking: actor:say
sent.length = 0;
knight.say('Halt! Who goes there?', 4);
check('actor.say -> npc_say with cast voice', sent.length === 1 && sent[0].type === 'npc_say' && sent[0].id === 'k1' && /^(am_adam|am_michael|bm_lewis)$/.test(sent[0].voice) && sent[0].text.startsWith('Halt'), JSON.stringify(sent[0]));
knight.say('Again!', 2);
check('same actor within 1.2 s is dropped', sent.length === 1);
dog.say('Woof woof', 2);
check('creatures never talk', sent.length === 1);
const farAct = makeActor('far1', 0, -60); ctx.world.kit.actors.push(farAct);
farAct.say('Can anyone hear me out here?', 3);
check('far actors (>24 m) are not voiced', sent.length === 1);
knight.say('...', 2);
check('bubbles without words ("...") are not voiced', sent.length === 1);
// queue cap: pending limit is 3
sent.length = 0;
const crowd = Array.from({ length: 6 }, (_, i) => { const a = makeActor('c' + i, i, -3 - i); ctx.world.kit.actors.push(a); return a; });
crowd.forEach((a) => a.say('Hello there, traveller.', 3));
check('at most 3 pending voice requests, the rest are dropped', sent.length <= 3, `${sent.length} sent`);

// ------------------------------------------------------------ playback + caps
const before = V.playing;
for (const m of sent) events.emit('net:npc_voice', { type: 'npc_voice', id: m.id, rid: m.rid, audio: '/npcvoice/x.wav', seconds: 1.5 });
await new Promise((r) => setTimeout(r, 30));
check('npc_voice starts positional playback', V.playing === sent.length && V.playing > 0, `${V.playing} playing`);
// simultaneous cap: play 8 buffers at increasing distances
V.stop(); await new Promise((r) => setTimeout(r, 10)); inst.update(0.016);
check('stop() clears everything that was playing', V.playing === 0);
const recs = [];
for (let d = 8; d >= 1; d--) { const a = makeActor('p' + d, 0, -d * 2.5); recs.push(V._t.playBuffer({ duration: 1 }, { actor: a, rate: 1, fx: {}, priority: 0 })); }
const live = recs.filter((r) => r && !r.stopped);
check('global cap: 4 simultaneous voices, nearest win', live.length === 4 && live.every((r) => r.dist <= 10.1), `${live.length} live, dists ${live.map((r) => r.dist.toFixed(1)).join(',')}`);
for (const r of recs) if (r) r.src.onended?.();
check('finished voices are cleaned up', V.playing === 0);

// ------------------------------------------------------------ replies + intents
const events2 = [];
events.on('voices:reply', (e) => events2.push(e));
sent.length = 0;
events.emit('net:npc_thinking', { id: 'k1' });
check('npc_thinking makes the NPC face the player', knight.faced.length > 0 && knight.said.at(-1) === '...');
events.emit('net:npc_reply', { type: 'npc_reply', id: 'k1', text: 'Aye, lead on and I will follow.', audio: '/npcvoice/r.wav', seconds: 2, intent: 'follow' });
await new Promise((r) => setTimeout(r, 30));
check('npc_reply: bubble, playback, intent applied', knight.said.at(-1).startsWith('Aye') && V.playing === 1 && fighters[1].follow === 'player' && events2.length === 1);
check('the reply bubble is not spoken a second time', sent.filter((m) => m.type === 'npc_say').length === 0);
events.emit('net:npc_reply', { id: 'g1', text: 'Ha! Come and die.', audio: null, intent: 'follow' });
await new Promise((r) => setTimeout(r, 10));
check('enemies ignore intents (they keep fighting)', fighters[0].follow === undefined && goblin.followT === undefined);
events.emit('net:npc_reply', { id: 'k1', text: 'As you wish.', audio: null, intent: 'stay' });
await new Promise((r) => setTimeout(r, 10));
check('stay: follow cleared and the actor stops', fighters[1].follow === null && knight.stopped === true);
events.emit('net:npc_reply', { id: 'k1', text: 'Run!', audio: null, intent: 'flee' });
await new Promise((r) => setTimeout(r, 10));
check('flee sets fleeing on the fighter', fighters[1].fleeing === true);
events.emit('net:npc_reply', { id: 'k1', text: 'At them!', audio: null, intent: 'attack' });
await new Promise((r) => setTimeout(r, 10));
check('attack targets the nearest foe', fighters[1].tgt === fighters[0]);
const merch = makeActor('m1', 2, -2, { model: 'villager-male-a', held: 'dagger' }); ctx.world.kit.actors.push(merch);
merch.say('Fine wares!', 2);
events.emit('net:npc_reply', { id: 'm1', text: 'Take it, friend.', audio: null, intent: 'give' });
await new Promise((r) => setTimeout(r, 10));
check('give hands over the held weapon', ctx._gave?.type === 'dagger');
events.emit('net:npc_reply', { id: 'm1', text: 'Hello!', audio: null, intent: 'wave' });
await new Promise((r) => setTimeout(r, 10));
check('wave', merch.waved === true);
check('unknown intents are ignored', V._t.applyIntent(merch, 'explode') === false);

// ------------------------------------------------------------ settings (sys/voice.js style API is covered by harness/chain.html)
ctx.state.pending.clear();
V.enabled = false; sent.length = 0;
const k2 = makeActor('k2', 1, -3); ctx.world.kit.actors.push(k2); k2.say('This should be silent.', 3);
check('voices.enabled = false stops requests', sent.length === 0);
V.enabled = true; V.volume = 0.5;
check('volume setting', V.volume === 0.5);
await new Promise((r) => setTimeout(r, 1600)); // global start-rate window
const pos = V.speak(new THREE.Vector3(2, 1, -3), 'A voice from nowhere in particular.', { voice: 'af_nova' });
check('speak(position, text) works', pos === true && sent.at(-1).voice === 'af_nova');
inst.update(0.016);
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
