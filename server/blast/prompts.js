// Prompt builders for the blast pipeline (text-to-image wrapper, clean plate, object isolation). Pure functions, no I/O.
// The conventions come from the reference image-blaster skills (image-blast-plate: ONE removal-only pass naming what to remove;
// image-blast-3d: "Isolate the <target> ... Reproduce it exactly as shown ... white background, centered ... one single object")
// and were tuned on the six evaluation scenes with FLUX.2 [klein] (see README.md, "Evaluation").

const clean = (s) => String(s ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
const trimDot = (s) => clean(s).replace(/[.!?;:,\s]+$/, '');

// Wrap the player's words into a prompt for Z-Image-Turbo that yields an image the rest of the pipeline can use:
// ONE coherent place, standing eye height, level horizon, separated mid-ground props, consistent lighting, the game's stylised look,
// a ground that continues to the camera (no diorama / floating island edge: the place is wrapped into a 360 panorama later).
export function sceneWrapper(subject, { fantasy = false } = {}) {
  const s = trimDot(subject) || 'a quiet place';
  const flavour = fantasy ? ' A faint magical glow hangs in the air.' : '';
  // Measured on six scenes with Z-Image-Turbo (no negative prompt: guidance 0). Variants that spelled out "not a diorama / cutaway / visitor / camera on a tripod" made it
  // paint exactly those things (a stage, a person seen from behind, a tripod in the middle of the floor): this wording, with a plain "No people ...", gave eye-level
  // pictures without people in 6 of 6 scenes. When it still slips (a person, a bird's-eye view), the survey says so (view_problems) and the picture is dreamed again once.
  return `${s}. Wide establishing view of one single coherent place, seen from standing eye height (1.6 metres) with the camera level and looking straight ahead, perfectly level horizon, `
    + 'the floor or ground clearly visible in the lower part of the picture. A handful of distinct, readable props stand separately in the middle ground with clear space around each one, '
    + 'nothing overlapping or piled together into a heap. Consistent light direction, soft clean shadows. '
    + 'Stylised colourful painterly game environment art, chunky readable shapes, rich saturated colours, toon-shaded look with soft brush texture, crisp detail. '
    + 'No people, no characters, no text, no letters, no frame, no border, no watermark.' + flavour;
}
// Clean plate: ONE pass removing all chosen objects. Names must be literal visible noun phrases ("brown leather armchair").
// Worked best (6 scenes): a plain "Remove the A, B and C." + "Show the empty <ground> and the bare <backdrop> behind them." + a keep-everything-else sentence.
export function platePrompt(names, { ground = 'floor', backdrop = 'wall' } = {}) {
  const list = [...new Set(names.map(trimDot).filter(Boolean))];
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0] || 'objects';
  return `Remove the ${joined}, and everything standing or lying on them. Show the empty ${trimDot(ground) || 'floor'} and the bare ${trimDot(backdrop) || 'background'} behind them. `
    + 'Keep everything else exactly as it is: same camera, same perspective, same lighting, same colours and painting style.';
}

// Second chance for objects the first pass left in place (checked by comparing the plate with the source inside each object's box).
export function replatePrompt(names, opts) {
  return platePrompt(names, opts);
}

// Words for where a box sits in the picture (box = normalised [x0, y0, x1, y1]); used instead of the model's free text, which may name other objects.
export function placeWords(box, depth) {
  if (!Array.isArray(box) || box.length < 4) return '';
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  const h = cx < 0.2 ? 'far left' : cx < 0.4 ? 'left' : cx < 0.6 ? 'centre' : cx < 0.8 ? 'right' : 'far right';
  const v = cy < 0.35 ? 'upper part' : cy < 0.65 ? 'middle' : 'lower part';
  const d = depth === 'near' ? 'foreground' : depth === 'far' ? 'background' : 'middle distance';
  return `${d}, ${h} of the picture, ${v}`;
}

// Object isolation: one atomic instance, complete, centred, 3/4 view on plain white (the 3D stage removes the background).
export function isolatePrompt(obj) {
  const name = trimDot(obj.name);
  const where = placeWords(obj.box, obj.depth) || trimDot(obj.location_in_image);
  const desc = trimDot(obj.description);
  const mats = Array.isArray(obj.materials) ? obj.materials.map(trimDot).filter(Boolean).join(', ') : '';
  return `Isolate the ${name}${where ? ` (${where})` : ''} from this image.${desc ? ` ${desc}.` : ''} `
    + `Reproduce that one single object exactly as shown: same colours, materials${mats ? ` (${mats})` : ''}, proportions and the same stylised painted game-art look, not a photograph. `
    + 'Show the complete object, including parts that are hidden behind other things or cut off by the frame, in a three-quarter view, centred, entirely inside the frame, '
    + 'on a plain pure white background with soft even studio lighting and no cast shadow on the ground. '
    + 'Only this one single object: no other objects, nothing resting on top of it, no scene, no people, no text.';
}

// Text clean plate for the place stage (reference image-blast-world rule): the scene description with the removed objects subtracted.
export function emptyPlaceDescription(image, removedNames) {
  const j = image || {};
  const parts = [j.environment, j.literal_description, j.lighting, j.atmosphere].map(clean).filter(Boolean);
  const names = removedNames.map(trimDot).filter((n) => n.length > 2);
  const sentences = parts.join(' ').split(/(?<=[.!?])\s+/).filter((s) => {
    const low = s.toLowerCase();
    return !names.some((n) => {
      const head = n.toLowerCase().split(/\s+/).slice(-1)[0];       // "wooden barrel" -> "barrel"
      return head.length > 3 && new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(low);
    });
  });
  const base = `${clean(j.scene_name) || 'A place'}: empty ${trimDot(j.environment) || 'scene'}, no loose objects, bare floor or ground.`;
  return `${base} ${sentences.join(' ')}`.replace(/\s+/g, ' ').trim().slice(0, 700);
}
