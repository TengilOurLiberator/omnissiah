// Image helpers for the blast pipeline (sharp, which ships in node_modules as a dependency of @huggingface/transformers).
// Everything degrades: without sharp the functions return null and the pipeline skips the check / the crop / the thumbnail.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

let sharpMod; // undefined = not tried
export function getSharp(root) {
  if (sharpMod !== undefined) return sharpMod;
  sharpMod = null;
  // the game folder's node_modules first (root), then the one this file lives in (server/blast -> ../../node_modules)
  for (const base of [root ? path.join(root, 'package.json') : null, import.meta.url].filter(Boolean)) {
    try { sharpMod = createRequire(base)('sharp'); break; } catch { /* try the next */ }
  }
  return sharpMod;
}

// Mean absolute difference (0..255, over RGB) between two pictures inside a normalised box [x0,y0,x1,y1].
// Both are resized to 336 px wide first, so the picture size and a small VAE re-encode shift do not matter.
export async function boxChange(srcPath, platePath, box, root) {
  const sharp = getSharp(root);
  if (!sharp) return null;
  try {
    const W = 336;
    const a = await sharp(srcPath).resize(W).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(platePath).resize(a.info.width, a.info.height, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = a.info.width, h = a.info.height, ch = a.info.channels;
    const x0 = Math.max(0, Math.floor(box[0] * w)), x1 = Math.min(w, Math.ceil(box[2] * w));
    const y0 = Math.max(0, Math.floor(box[1] * h)), y1 = Math.min(h, Math.ceil(box[3] * h));
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * ch;
      sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      n += 3;
    }
    return n ? sum / n : null;
  } catch { return null; }
}

// Crop a normalised box (with a margin) out of a picture, scaled so the longer side is `size` px. Returns the written path or null.
export async function cropBox(srcPath, outPath, box, { margin = 0.25, size = 768, root } = {}) {
  const sharp = getSharp(root);
  if (!sharp) return null;
  try {
    const m = await sharp(srcPath).metadata();
    const bw = (box[2] - box[0]) * m.width, bh = (box[3] - box[1]) * m.height;
    const cx = ((box[0] + box[2]) / 2) * m.width, cy = ((box[1] + box[3]) / 2) * m.height;
    const half = Math.max(bw, bh) * (0.5 + margin);
    const left = Math.max(0, Math.round(cx - half)), top = Math.max(0, Math.round(cy - half));
    const width = Math.min(m.width - left, Math.round(half * 2)), height = Math.min(m.height - top, Math.round(half * 2));
    if (width < 8 || height < 8) return null;
    await sharp(srcPath).extract({ left, top, width, height }).resize(size, size, { fit: 'inside' }).png().toFile(outPath);
    return outPath;
  } catch { return null; }
}

// Fraction of a picture (0..1) that is "plain white" at its border, and the bounding box (normalised) of the non-white content.
// Used to judge an isolation image: the object should sit inside the frame on a light plain background.
export async function whiteStats(imgPath, root) {
  const sharp = getSharp(root);
  if (!sharp) return null;
  try {
    const { data, info } = await sharp(imgPath).resize(128, 128, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    const px = (x, y) => { const i = (y * w + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
    const isWhite = (p) => p[0] > 225 && p[1] > 225 && p[2] > 225;
    let border = 0, bn = 0, minx = w, miny = h, maxx = -1, maxy = -1, content = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = px(x, y), white = isWhite(p);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { bn++; if (white) border++; }
      if (!white) { content++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    }
    return { borderWhite: border / bn, content: content / (w * h), box: maxx < 0 ? null : [minx / w, miny / h, (maxx + 1) / w, (maxy + 1) / h] };
  } catch { return null; }
}

// 480 px JPEG thumbnail of a picture (the menu shows it).
export async function thumbnail(srcPath, outPath, width = 480, root) {
  const sharp = getSharp(root);
  if (!sharp) { try { fs.copyFileSync(srcPath, outPath.replace(/\.[a-z]+$/, path.extname(srcPath))); } catch { /* ignore */ } return null; }
  try { await sharp(srcPath).resize(width).jpeg({ quality: 82 }).toFile(outPath); return outPath; } catch { return null; }
}

export async function imageSize(p, root) {
  const sharp = getSharp(root);
  if (sharp) { try { const m = await sharp(p).metadata(); return { width: m.width, height: m.height }; } catch { /* fall through */ } }
  // minimal PNG / JPEG sniffing without sharp
  try {
    const b = fs.readFileSync(p);
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i++; continue; }
        const mk = b[i + 1];
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } catch { /* ignore */ }
  return null;
}
