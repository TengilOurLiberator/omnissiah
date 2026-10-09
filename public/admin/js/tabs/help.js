// Help: controls, things to ask for (click one to put it in the wish box), starting the game, troubleshooting. Authored from README.md.
import { h, icon, clear } from '../dom.js';
import { keyGrid } from '../keys.js';

const CONTROLS = {
  Controllers: [['Talk to him', 'hold the LEFT trigger'], ['Move', 'left stick (click = sprint)'], ['Turn', 'right stick'], ['Cast / use weapon', 'right trigger'], ['Spell wheel', 'hold A, point, release (tap = next spell)'], ['Jump', 'B'], ['Grab, throw, hold a weapon', 'squeeze']],
  'Bare hands': [['Talk to him', 'hold a left index pinch'], ['Move', 'left ring pinch: walk where the left hand points'], ['Turn', 'pinky pinch (left hand = left, right = right)'], ['Cast / use weapon', 'right index pinch'], ['Spell wheel', 'hold a right ring pinch'], ['Jump', 'not available'], ['Grab, throw, hold a weapon', 'make a fist; open the hand flat to drop']],
  Desktop: [['Talk to him', 'hold T, tap N to talk and tap again to send, or type in the box'], ['Move', 'W A S D, Shift to sprint'], ['Turn', 'arrow keys, or click to look'], ['Cast / use weapon', 'left mouse button'], ['Spell wheel', 'hold E'], ['Jump', 'Q or Space'], ['Grab, throw, hold a weapon', 'G or right mouse button'], ['Menu / VR', 'M opens the menu, V enters VR']],
};
const ASK = [
  ['Enemies and bosses', 'Goblins, orcs, trolls, skeletons, a demon, a lich king, a dragon, waves of enemies.', ['summon a goblin wave', 'a lich king boss fight', 'five skeletons', 'an ancient dragon']],
  ['Allies', 'A knight, an archer, a mage, a healer, a guard dog.', ['a knight to protect me', 'give me an archer ally', 'a guard dog']],
  ['Weapons (49)', 'Sword, katana, warhammer, bow, crossbow, blaster, shield, grenade, "an armory", signature pieces.', ['give me a katana', 'an armory', 'a crossbow', 'the ember staff']],
  ['Places', 'A village, a goblin camp, a haunted graveyard, a castle siege, a harbour, a medieval market.', ['build a village', 'a haunted graveyard', 'a castle siege', 'a medieval market']],
  ['Buildings, nature, props', 'A tavern, a watchtower, a forest, a treasure chest, a cannon, a trampoline.', ['a tavern', 'a watchtower', 'plant a forest', 'a treasure chest', 'a trampoline']],
  ['Weather and mood', 'Rain, snow, a storm, night, "make everything look like a comic", "black and white".', ['make it rain', 'night time', 'a thunderstorm', 'make everything look like a comic', 'black and white']],
  ['Spells (15)', 'Firebolt, meteor, force push, blink, telekinesis, heal, levitate and more.', ['teach me firebolt', 'a meteor spell', 'let me levitate', 'telekinesis']],
  ['Anything else', 'He writes it, or conjures a brand-new 3D model from your description (a minute or two).', ['conjure a clay teapot', 'a racetrack with lap times', 'a dragon I can ride']],
  ['Settings by voice', 'Gore and commentary can be switched while playing.', ['less gore', 'turn the gore off', 'stop commenting', 'comment more']],
];
const TROUBLE = [
  ['Every reply is heard twice', 'The game is open in two places (for example the headset and a desktop tab). Keep it open in one place at a time.'],
  ['The headset cannot connect', 'Allow Node.js through Windows Firewall on the Private network, and use the https://<PC address>:8443 printed in the server window. Accept the certificate warning once.'],
  ['He does not hear me', 'Allow the microphone in the browser, and hold the trigger (or T) for at least a quarter of a second while you speak.'],
  ['Something he made is broken', 'Type /undo in the game, or press Undo on the Live tab. Broken code is also fed back to him to repair; if that fails it is undone automatically.'],
  ['This panel shows "Read-only"', 'You are on another device. Open http://localhost:8080/admin/ on the PC that runs the game to make changes.'],
  ['Everything is slow', 'Look at the Performance tab. Lower ORACLE_EFFORT (low) for faster replies; on the headset the game lowers its own detail to hold 72 fps.'],
];

export default function mount(root, app) {
  let tab = 'Controllers';
  const table = h('table', { class: 'tbl' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Input method' }, Object.keys(CONTROLS).map((k) => h('button', { type: 'button', 'aria-pressed': k === tab ? 'true' : 'false', on: { click: (e) => { tab = k; for (const b of seg.children) b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'); paintTable(); } } }, k)));
  function paintTable() { clear(table); table.append(h('thead', null, h('tr', null, h('th', null, 'Action'), h('th', null, tab))), h('tbody', null, CONTROLS[tab].map(([a, b]) => h('tr', null, h('td', null, a), h('td', null, b))))); }
  paintTable();

  root.append(
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Help'), h('p', null, 'How to play, what to ask for, and what to do when something is off. Click any phrase to send it as a wish from the Live tab.'))),
    h('div', { class: 'grid2 even' },
      h('div', { class: 'col' },
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Controls'), h('div', { class: 'row', style: { marginBottom: '10px' } }, seg), h('div', { class: 'scroll-x' }, table),
          h('p', { class: 'small dim', style: { marginTop: '10px' } }, 'While a weapon is in your hand, that hand\'s trigger uses the weapon instead of casting. Swing melee weapons for real: damage scales with swing speed. Bows: hold the trigger to draw, release to loose. For bare hands, put the controllers down (hand tracking must be on in the Quest settings).'),
          h('p', { class: 'small dim', style: { marginTop: '8px' } }, 'Type ', h('kbd', null, '/undo'), ' in the game to revert his last change, ', h('kbd', null, '/reset'), ' to make him forget the conversation.')),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Desktop keys at a glance'), keyGrid()),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Starting a session'),
          h('ol', { class: 'small', style: { margin: 0, paddingLeft: '20px', display: 'grid', gap: '8px' } },
            h('li', null, 'On the PC, double-click ', h('code', null, 'start.bat'), ' and leave the window open.'),
            h('li', null, h('b', null, 'Through Link (best graphics): '), 'connect the Quest with Link or Air Link, open ', h('code', null, 'http://localhost:8080'), ' in Edge on the PC and click Enter VR.'),
            h('li', null, h('b', null, 'Standalone: '), 'in the Quest browser open ', h('code', null, 'https://<PC address>:8443'), ' (printed in the server window), accept the certificate warning once, allow the microphone, press Enter VR.'),
            h('li', null, h('b', null, 'Flat on the PC: '), h('code', null, 'http://localhost:8080'), ' with mouse and keyboard.'),
            h('li', null, h('b', null, 'Mixed reality: '), 'the page also has an Enter Mixed Reality button on the headset; the Omnissiah then hovers in your real room.')),
          h('p', { class: 'tiny faint', style: { marginTop: '10px' } }, 'Add ?quality=quest or ?quality=pc to the game address to force a graphics tier.')),
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'When something is wrong'), h('dl', { class: 'kv small' }, TROUBLE.flatMap(([q, a]) => [h('dt', { class: 'gold' }, q), h('dd', { class: 'dim' }, a)])))),
      h('div', { class: 'col' },
        h('section', { class: 'card' }, h('h2', { class: 'card-title' }, 'Things to ask for'),
          h('div', { class: 'stack' }, ASK.map(([title, text, phrases]) => h('div', { class: 'ask' }, h('h3', null, title), h('p', null, text),
            h('div', { class: 'chips' }, phrases.map((p) => h('button', { class: 'say-chip', type: 'button', title: 'Put this in the wish box on the Live tab', on: { click: () => app.wish(p) } }, p)))))),
          h('p', { class: 'tiny faint', style: { marginTop: '10px' } }, 'Almost everything can be broken: buildings collapse, trees can be felled, crates splinter.')))));
  return {};
}
