// The tuners photographed on the back of the headstock (public/guitar-back-4k.webp)
// are painted out: the model has its own tuners there now (mountTuners in
// src/lib/guitarModel.ts), and the photo's, projected a little off, showed
// next to them. In a box around each tuner (picked by hand) its light metal
// is masked and the wood is filled in over it (OpenCV inpainting).
//
// Run once: node scripts/clean-rear-headstock.mjs (a second run finds nothing to paint).
import sharp from 'sharp';
import cvReady from '@techstark/opencv-js';
import { rename } from 'node:fs/promises';

const cv = await cvReady;
const path = 'public/guitar-back-4k.webp';
// [x0, y0, x1, y1] in photo px: each tuner with its tabs, inside the binding
// along the edge, and its button outside it (the model's headstock is wider
// at the shoulders than the photo's, so that much of the background shows).
const boxes = [];
for (const [y0, y1] of [[62, 113], [107, 160], [151, 207]]) boxes.push([449, y0, 488, y1], [516, y0, 552, y1], [400, y0, 441, y1], [560, y0, 600, y1]);

const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const image = new cv.Mat(info.height, info.width, cv.CV_8UC3); image.data.set(data);
const mask = cv.Mat.zeros(info.height, info.width, cv.CV_8UC1);
for (const [x0, y0, x1, y1] of boxes) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
  const i = (y * info.width + x) * 3, [r, g, b] = [data[i], data[i + 1], data[i + 2]];
  // Nickel and the cream buttons: light and nearly grey; the lacquer is dark or red.
  if ((r + g + b) / 3 > 75 && Math.max(r, g, b) - Math.min(r, g, b) < 60) mask.data[y * info.width + x] = 255;
}
cv.dilate(mask, mask, cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9)));
const filled = new cv.Mat();
cv.inpaint(image, mask, filled, 9, cv.INPAINT_TELEA);
await sharp(Buffer.from(filled.data), { raw: { width: info.width, height: info.height, channels: 3 } }).webp({ quality: 92 }).toFile(path + '.tmp');
await rename(path + '.tmp', path);
console.log('painted out', mask.data.reduce((n, v) => n + (v ? 1 : 0), 0), 'px');
