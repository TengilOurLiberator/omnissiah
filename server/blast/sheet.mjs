// Dev tool: contact sheet of images with labels.  node sheet.mjs out.png cols cellW  a.png b.png ...   (needs sharp from D:\omnissiah\node_modules)
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire('D:/omnissiah/package.json');
const sharp = require('sharp');
const [out, colsS, cellS, ...files] = process.argv.slice(2);
const cols = Number(colsS) || 2, cw = Number(cellS) || 640;
const cells = [];
for (const f of files) {
  const meta = await sharp(f).metadata();
  const ch = Math.round((cw * meta.height) / meta.width);
  cells.push({ f, ch, buf: await sharp(f).resize(cw, ch).flatten({ background: '#808080' }).png().toBuffer() });
}
const rows = Math.ceil(cells.length / cols);
const rowH = [];
for (let r = 0; r < rows; r++) rowH.push(Math.max(...cells.slice(r * cols, r * cols + cols).map((c) => c.ch)) + 22);
const W = cols * cw, H = rowH.reduce((a, b) => a + b, 0);
const comp = [];
let y = 0;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const cell = cells[r * cols + c];
    if (!cell) continue;
    const label = path.basename(cell.f).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="22"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="Arial" font-size="14" fill="#fff">${label}</text></svg>`), left: c * cw, top: y });
    comp.push({ input: cell.buf, left: c * cw, top: y + 22 });
  }
  y += rowH[r];
}
await sharp({ create: { width: W, height: H, channels: 3, background: '#222' } }).composite(comp).png().toFile(out);
console.log('wrote', out, W, H);
