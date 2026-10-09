// Desktop keyboard + mouse controls (checked against public/boot.js, sys/voice.js and core/menu.js key handlers).
import { h } from './dom.js';

export const KEYS = [
  ['W A S D', 'Move'], ['Shift', 'Sprint'], ['Space / Q', 'Jump'], ['Arrows', 'Turn'], ['Mouse', 'Look (click the game first); left button casts, right button grabs'],
  ['E', 'Spell wheel (hold, move, release)'], ['G', 'Grab, throw, hold a weapon'], ['T', 'Hold to talk to him'], ['N', 'Tap to talk, tap again to send'],
  ['M', 'Menu'], ['V', 'Enter VR'],
];

export function keyGrid() {
  return h('div', { class: 'keys' }, KEYS.map(([k, what]) => h('div', { class: 'keyrow' }, h('span', { class: 'row', style: { gap: '4px', flex: 'none' } }, k.split(' ').filter((p) => p !== '/').map((p) => h('kbd', null, p))), h('span', { class: 'dim' }, what))));
}
