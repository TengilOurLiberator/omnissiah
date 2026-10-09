// Dev tool: the six-scene evaluation of the edit model with hand-written object lists (boxes read off the pictures by eye).
//   node evalset.mjs build [scene...]   -> writes .cache/blast/lab/eval/items.json (a batch for lab.mjs edit)
import fs from 'node:fs';
import { platePrompt, isolatePrompt } from './prompts.js';
const L = 'D:/omnissiah/.cache/blast/lab/';
fs.mkdirSync(L + 'eval', { recursive: true });
const O = (name, box, depth = 'mid', description = '', materials = []) => ({ name, box, depth, description, materials });
const SETS = {
  study: { ground: 'wooden floor', backdrop: 'wall', objects: [
    O('brown leather armchair', [0.19, 0.55, 0.39, 0.91], 'near'), O('wooden barrel with iron hoops', [0.81, 0.5, 0.96, 0.83], 'near'), O('globe on a wooden stand', [0.57, 0.37, 0.65, 0.56]),
    O('human skull', [0.40, 0.49, 0.45, 0.55]), O('large wooden writing desk', [0.33, 0.47, 0.67, 0.82]), O('leather trunk', [0.04, 0.45, 0.18, 0.70], 'near'), O('tall wooden potion cabinet', [0.65, 0.22, 0.82, 0.7]) ] },
  tavern: { ground: 'wooden floor', backdrop: 'wall', objects: [
    O('square wooden table with two mugs', [0.06, 0.60, 0.29, 0.92], 'near'), O('three-legged wooden stool', [0.26, 0.72, 0.33, 0.88], 'near'), O('wooden barrel with iron hoops', [0.01, 0.43, 0.13, 0.68]),
    O('white ceramic mug', [0.16, 0.58, 0.22, 0.67], 'near'), O('square wooden table', [0.72, 0.60, 0.95, 0.88], 'near') ] },
  camp: { ground: 'grass', backdrop: 'forest', objects: [
    O('beige canvas tent', [0.41, 0.42, 0.58, 0.65]), O('blue backpack with orange straps', [0.26, 0.56, 0.35, 0.69]), O('black cooking pot', [0.38, 0.63, 0.45, 0.71]), O('wooden crate', [0.64, 0.56, 0.73, 0.67]),
    O('oil lantern', [0.58, 0.58, 0.62, 0.66]), O('stack of three logs', [0.62, 0.63, 0.67, 0.70]), O('campfire', [0.46, 0.55, 0.55, 0.72]) ] },
  lab: { ground: 'metal floor', backdrop: 'wall', objects: [
    O('white robot arm on a round base', [0.30, 0.32, 0.42, 0.68]), O('grey office chair', [0.15, 0.52, 0.23, 0.73]), O('orange storage crate', [0.57, 0.60, 0.65, 0.72]), O('red storage crate', [0.90, 0.67, 1.0, 0.84], 'near'),
    O('holographic table with a glowing blue top', [0.40, 0.44, 0.61, 0.70]) ] },
  market: { ground: 'cobblestone street', backdrop: 'street', objects: [
    O('wooden barrel with iron hoops', [0.25, 0.55, 0.33, 0.73]), O('wooden covered cart with spoked wheels', [0.64, 0.30, 0.82, 0.60]), O('wooden crate of red tomatoes', [0.04, 0.68, 0.22, 0.88], 'near'),
    O('wicker basket of fruit', [0.35, 0.58, 0.41, 0.67]), O('clay pot', [0.76, 0.60, 0.80, 0.67]) ] },
  cave: { ground: 'cave floor', backdrop: 'cave wall', objects: [
    O('open wooden treasure chest with gold coins inside', [0.43, 0.33, 0.57, 0.52]), O('steel sword with a gold crossguard', [0.30, 0.20, 0.40, 0.52]), O('human skull', [0.10, 0.47, 0.19, 0.60]),
    O('wooden wall torch with a flame', [0.22, 0.37, 0.25, 0.52]), O('blue crystal cluster', [0.25, 0.38, 0.30, 0.52]), O('pile of gold coins', [0.38, 0.50, 0.64, 0.62]) ] },
};
const only = process.argv.slice(3);
const items = [];
for (const [scene, set] of Object.entries(SETS)) {
  if (only.length && !only.includes(scene)) continue;
  const img = `${L}scene-${scene}.png`;
  items.push({ id: `${scene}-plate`, images: [img], prompt: platePrompt(set.objects.map((o) => o.name), set), out: `${L}eval/${scene}-plate.png`, seed: 3 });
  set.objects.forEach((o, i) => items.push({ id: `${scene}-iso${i}`, images: [img], prompt: isolatePrompt(o), out: `${L}eval/${scene}-iso${i}-${o.name.split(' ').slice(-1)[0]}.png`, seed: 5, width: 1024, height: 1024 }));
}
fs.writeFileSync(L + 'eval/items.json', JSON.stringify(items, null, 1));
console.log(items.length, 'items');
console.log(items[0].prompt);
console.log(items[1].prompt);
