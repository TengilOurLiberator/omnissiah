// Node tests for the presentation manager in public/sys/hud.js (no DOM needed).  Run: tools\node\node.exe tests\unit\presenter.test.mjs
import assert from 'node:assert/strict';
import { createPresenter } from '../../public/sys/hud.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };
const tick = (P, sec, dt = 0.1) => { for (let t = 0; t < sec - 1e-9; t += dt) P.update(dt); };
const rec = () => { const log = []; return { log, mk: (name, extra = {}) => ({ id: name, start: () => log.push('start ' + name), end: (r) => log.push(`end ${name} ${r}`), drop: () => log.push('drop ' + name), ...extra }) }; };

test('one overlay at a time, FIFO within a kind', () => {
  const P = createPresenter(), r = rec();
  P.request({ kind: 'banner', ...r.mk('a') }); P.request({ kind: 'banner', ...r.mk('b') });
  assert.deepEqual(r.log, ['start a']);
  P.end('a'); tick(P, 1.5);
  assert.deepEqual(r.log, ['start a', 'end a done', 'start b']);
});

test('priority: card > banner > toast when several wait', () => {
  const P = createPresenter(), r = rec();
  P.request({ kind: 'critical', ...r.mk('c0'), hold: 0.5 }); // occupies the slot
  P.request({ kind: 'toast', ...r.mk('t') }); P.request({ kind: 'banner', ...r.mk('b'), hold: 1 }); P.request({ kind: 'card', ...r.mk('card'), speech: false });
  tick(P, 3);
  assert.deepEqual(r.log.filter((x) => x.startsWith('start')), ['start c0', 'start card']); // card first; banner and toast wait for it
  P.end('card'); tick(P, 4);
  assert.deepEqual(r.log.filter((x) => x.startsWith('start')), ['start c0', 'start card', 'start b', 'start t']);
});

test('a toast waits while a card is due or active, a banner too; both are dropped after maxWait', () => {
  const P = createPresenter(), r = rec();
  P.request({ kind: 'card', ...r.mk('card') });
  P.request({ kind: 'toast', ...r.mk('t'), maxWait: 2 });
  P.request({ kind: 'banner', ...r.mk('b'), maxWait: 5 });
  tick(P, 3);
  assert.ok(r.log.includes('drop t') && !r.log.includes('drop b'));
  tick(P, 3);
  assert.ok(r.log.includes('drop b') && !r.log.includes('start b'));
});

test('a card in the future (delay) does not block a toast, but one that is due does', () => {
  const P = createPresenter(), r = rec();
  P.request({ kind: 'card', ...r.mk('card'), delay: 5 });
  P.request({ kind: 'toast', ...r.mk('t1'), hold: 1 });
  assert.ok(r.log.includes('start t1'));
  tick(P, 1.2); // t1 timed out
  assert.ok(r.log.includes('end t1 timeout'));
  tick(P, 4);
  assert.ok(r.log.includes('start card'));
  P.request({ kind: 'toast', ...r.mk('t2') }); tick(P, 1);
  assert.ok(!r.log.includes('start t2'));
});

test('a card preempts an active toast but never an active banner', () => {
  const P = createPresenter(), r = rec();
  P.request({ kind: 'toast', ...r.mk('t') });
  P.request({ kind: 'card', ...r.mk('card') });
  assert.deepEqual(r.log, ['start t', 'end t preempted', 'start card']);
  const Q = createPresenter(), s = rec();
  Q.request({ kind: 'banner', ...s.mk('b') });
  Q.request({ kind: 'card', ...s.mk('card') }); tick(Q, 2);
  assert.deepEqual(s.log, ['start b']);
  Q.end('b'); tick(Q, 2);
  assert.ok(s.log.includes('start card'));
});

test('menu panel open holds banners and toasts, not cards or critical', () => {
  let open = true;
  const P = createPresenter({ panelOpen: () => open }), r = rec();
  P.request({ kind: 'banner', ...r.mk('b') }); P.request({ kind: 'toast', ...r.mk('t') });
  tick(P, 2);
  assert.deepEqual(r.log, []);
  P.request({ kind: 'critical', ...r.mk('c'), hold: 0.5 });
  assert.deepEqual(r.log, ['start c']);
  tick(P, 1);
  open = false; tick(P, 3);
  assert.ok(r.log.includes('start b'));
});

test('the card waits for the Omnissiah to finish speaking (up to speechWait)', () => {
  let talking = true;
  const P = createPresenter({ speaking: () => talking }), r = rec();
  P.request({ kind: 'card', ...r.mk('card'), speech: true, delay: 0.3 });
  tick(P, 5);
  assert.deepEqual(r.log, []);
  talking = false; tick(P, 0.5);
  assert.deepEqual(r.log, ['start card']);
  const Q = createPresenter({ speaking: () => true }), s = rec();
  Q.request({ kind: 'card', ...s.mk('c2'), speech: true, speechWait: 4 });
  tick(Q, 3); assert.deepEqual(s.log, []);
  tick(Q, 2); assert.deepEqual(s.log, ['start c2']);
});

test('same id: queued request is replaced, active request is refreshed', () => {
  const P = createPresenter(), r = rec();
  P.request({ kind: 'card', ...r.mk('x') });                       // active
  P.request({ kind: 'toast', ...r.mk('first'), id: 'tt' }); P.request({ kind: 'toast', ...r.mk('second'), id: 'tt' });
  assert.equal(P.pending('toast'), 1);
  let refreshed = 0;
  P.request({ kind: 'card', id: 'x', refresh: () => refreshed++ });
  assert.equal(refreshed, 1);
});

test('queue cap: oldest toast is dropped', () => {
  const P = createPresenter(), r = rec();
  P.request({ kind: 'card', ...r.mk('card') });
  for (let i = 0; i < 5; i++) P.request({ kind: 'toast', ...r.mk('t' + i), maxWait: 99 });
  assert.equal(P.pending('toast'), 3);
  assert.ok(r.log.includes('drop t0') && r.log.includes('drop t1'));
});

test('hold ends an overlay by itself; gap before the next one', () => {
  const P = createPresenter(), r = rec();
  P.request({ kind: 'toast', ...r.mk('a'), hold: 1 }); P.request({ kind: 'toast', ...r.mk('b'), hold: 1 });
  tick(P, 1.2);
  assert.deepEqual(r.log, ['start a', 'end a timeout']);
  tick(P, 0.5);
  assert.ok(r.log.includes('start b'));
});

test('hot reload: cancelOwner ends the active overlay and clears the queue of that owner only', () => {
  const P = createPresenter(), r = rec();
  P.request({ kind: 'banner', owner: 'core/quests.js', ...r.mk('q1') });
  P.request({ kind: 'banner', owner: 'core/quests.js', ...r.mk('q2') });
  P.request({ kind: 'banner', owner: 'other', ...r.mk('o1') });
  P.cancelOwner('core/quests.js');
  assert.deepEqual(r.log, ['start q1', 'end q1 cancelled']);
  tick(P, 2);
  assert.ok(r.log.includes('start o1') && !r.log.includes('start q2'));
  // the reloaded module asks again with the same ids and is served normally
  P.request({ kind: 'banner', owner: 'core/quests.js', ...r.mk('q1') });
  P.end('o1'); tick(P, 2);
  assert.ok(r.log.filter((x) => x === 'start q1').length === 2);
});

test('a throwing start handler does not wedge the queue', () => {
  const P = createPresenter(), r = rec();
  const orig = console.error; console.error = () => {};
  P.request({ kind: 'banner', id: 'bad', start: () => { throw new Error('boom'); } });
  console.error = orig;
  P.request({ kind: 'banner', ...r.mk('good') }); tick(P, 2);
  assert.ok(r.log.includes('start good'));
});

test('quiet / busy / active queries', () => {
  const P = createPresenter();
  assert.equal(P.quiet('card'), true); assert.equal(P.busy('card'), false);
  const h = P.request({ kind: 'card', id: 'w', delay: 10 });
  assert.equal(P.busy('card'), true); assert.equal(P.quiet('banner'), false); assert.equal(h.state, 'queued');
  h.cancel(); assert.equal(P.busy('card'), false);
});

console.log(`${n} tests passed`);
