// The face of the neck from a photograph: Letov holding a kitten, the guitar
// in his arms (scripts/photos/letov-kitten-neck.jpg, 1280×930). The headstock
// face and the fretboard are pulled straight out of it into one texture laid
// over the guitar's face, seen from the front, in the site's guitar frame:
// u across (x), v along the neck (y, the headstock's tip at the top).
//
// Each is a plane seen in perspective, so each gets its own homography from
// points picked by hand in the photo and the same points on the model:
//  - headstock face: the six tuner posts (fit.strings[].post);
//  - fretboard: the ends of the zero fret and of frets 11 and 12 (this Musima
//    has a zero fret right after the nut; fit.fretboard.frets[0] is it).
// The fretboard's edges on the model, measured on the smoothed neck: half
// width at the nut and its widening per unit towards the body.
//
// Writes public/guitar-neck.webp and src/lib/guitarNeck.json (the texture's
// box in the guitar frame). With --debug, test-results/guitar-neck-fit.png:
// the model's frets and posts drawn back into the photo.
//
// Run: node scripts/build-neck-photo.mjs [--debug]
import sharp from 'sharp';
import cvReady from '@techstark/opencv-js';
import { readFile, writeFile } from 'node:fs/promises';

const cv = await cvReady;
const photoPath = 'scripts/photos/letov-kitten-neck.jpg';
const fit = JSON.parse(await readFile('src/lib/guitarFit.json', 'utf8'));
const { scale, centre } = fit.frame;
const siteY = (y) => (y - centre[1]) * scale;

// ── the model ──
const nutY = siteY(fit.fretboard.box[3]);
const fretY = (n) => siteY(fit.fretboard.frets[n]);
// Fretboard edges: bass side (−x) and treble side (+x) at a height.
const edge = (side, y) => (side < 0 ? -.1241 - (nutY - y) * .0083 : .1268 + (nutY - y) * .0094);

// ── the photo (px), picked by hand ──
const board = [
  // [model x, model y] ↔ [photo x, photo y]
  [[edge(-1, fretY(0)), fretY(0)], [1105.6, 378.1]], [[edge(1, fretY(0)), fretY(0)], [1140, 415.6]],
  [[edge(-1, fretY(11)), fretY(11)], [819.3, 630]], [[edge(1, fretY(11)), fretY(11)], [864.3, 680]],
  [[edge(-1, fretY(12)), fretY(12)], [799.3, 644.7]], [[edge(1, fretY(12)), fretY(12)], [845.3, 697.4]],
];
// Posts, thickest string first: the bass row (nut → tip), then the treble row (tip → nut).
const postsInPhoto = [[1163.75, 315.5], [1191.25, 292], [1217, 267], [1263.75, 312.5], [1237.5, 337], [1208.75, 363.75]];
const head = fit.strings.map((s, i) => [[s.post[0], s.post[1]], postsInPhoto[i]]);

const homography = (pairs) => {
  const from = cv.matFromArray(pairs.length, 1, cv.CV_32FC2, pairs.flatMap(([m]) => m));
  const to = cv.matFromArray(pairs.length, 1, cv.CV_32FC2, pairs.flatMap(([, p]) => p));
  const h = Array.from(cv.findHomography(from, to, 0).data64F);
  const apply = ([x, y]) => { const w = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
  const error = Math.max(...pairs.map(([m, p]) => Math.hypot(apply(m)[0] - p[0], apply(m)[1] - p[1])));
  return { apply, error };
};
const boardFit = homography(board), headFit = homography(head);
console.log('fit error (px): fretboard', boardFit.error.toFixed(2), 'headstock', headFit.error.toFixed(2));

// ── the texture ──
// The whole face of the neck, nut to tip, the fretboard down to its end.
const box = [-.28, siteY(fit.fretboard.box[1]) - .02, .28, 3.43];
const width = 256, height = 2048;
const { data, info } = await sharp(photoPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const photo = new cv.Mat(info.height, info.width, cv.CV_8UC3); photo.data.set(data);
const mapX = new cv.Mat(height, width, cv.CV_32FC1), mapY = new cv.Mat(height, width, cv.CV_32FC1);
const xAt = (col) => box[0] + (col + .5) / width * (box[2] - box[0]), yAt = (row) => box[3] - (row + .5) / height * (box[3] - box[1]);
const inPhoto = ([px, py]) => px >= 2 && px <= info.width - 3 && py >= 2 && py <= info.height - 3;
const headRows = Math.ceil((box[3] - nutY) / (box[3] - box[1]) * height);
for (let row = 0; row < height; row++) {
  const y = yAt(row), fitted = y > nutY ? headFit : boardFit;
  for (let col = 0; col < width; col++) {
    // The headstock's tip runs off the photo's right edge: there it is
    // mirrored from its other half (it is symmetric about the strings).
    let p = fitted.apply([xAt(col), y]);
    if (!inPhoto(p)) p = fitted.apply([-xAt(col), y]);
    mapX.data32F[row * width + col] = p[0]; mapY.data32F[row * width + col] = p[1];
  }
}
const texture = new cv.Mat();
cv.remap(photo, texture, mapX, mapY, cv.INTER_LANCZOS4, cv.BORDER_REPLICATE);

// The model's headstock is not quite the real one's shape: wider at the
// shoulders, where the photo has the flag behind and the tuner buttons. So
// each row of the photo's headstock is fitted across to the model's face at
// that height: the middle (out to the posts) stays as it is, the wood and
// binding outside it are stretched out to the model's edges.
// The headstock in the photo: its wood cut out by GrabCut (the middle around
// the posts surely headstock, the far sides surely not), then the cream
// binding along its edge, walked outwards.
// Half widths of the model's face (smoothed), by height, measured on the model.
const modelHead = [[2.42, -.132, .133], [2.47, -.134, .134], [2.52, -.141, .139], [2.57, -.161, .158], [2.62, -.191, .199], [2.67, -.254, .26], [2.72, -.259, .267], [2.77, -.242, .251], [2.82, -.222, .229], [2.87, -.216, .222], [2.92, -.211, .217], [2.97, -.205, .209], [3.02, -.2, .206], [3.07, -.195, .204], [3.12, -.196, .205], [3.17, -.204, .218], [3.22, -.214, .236], [3.27, -.226, .256], [3.32, -.235, .264], [3.37, -.147, .175], [3.42, -.017, .045]];
const modelEdges = (y) => {
  const i = Math.max(0, Math.min(modelHead.length - 2, Math.floor((y - modelHead[0][0]) / .05))), [y0, l0, r0] = modelHead[i], [y1, l1, r1] = modelHead[i + 1];
  const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
  return [l0 + (l1 - l0) * t, r0 + (r1 - r0) * t];
};
{
  const headstock = new cv.Mat();
  texture.roi(new cv.Rect(0, 0, width, headRows)).copyTo(headstock);
  const labels = new cv.Mat(headRows, width, cv.CV_8UC1);
  for (let row = 0; row < headRows; row++) for (let col = 0; col < width; col++) {
    const x = Math.abs(xAt(col)), y = yAt(row);
    labels.data[row * width + col] = x < .1 && y > nutY + .02 && y < 3.33 ? cv.GC_FGD : x > .265 ? cv.GC_BGD : x < .17 ? cv.GC_PR_FGD : cv.GC_PR_BGD;
  }
  const background = new cv.Mat(), foreground = new cv.Mat();
  cv.grabCut(headstock, labels, new cv.Rect(0, 0, 1, 1), background, foreground, 6, cv.GC_INIT_WITH_MASK);
  const wood = new cv.Mat(headRows, width, cv.CV_8UC1);
  for (let i = 0; i < headRows * width; i++) wood.data[i] = labels.data[i] === cv.GC_FGD || labels.data[i] === cv.GC_PR_FGD ? 255 : 0;
  cv.morphologyEx(wood, wood, cv.MORPH_OPEN, cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)));
  const source = Buffer.from(headstock.data);
  const pixel = (row, col) => [0, 1, 2].map((c) => source[(row * width + col) * 3 + c]);
  const cream = ([r, g, b]) => r > 140 && g > 115 && b > 70 && r - b < 120;
  const toCol = (x) => (x - box[0]) / (box[2] - box[0]) * width - .5;
  const middle = width >> 1, binding = 12;
  // Photo edges per row, in columns; rows without a clean cut take the nearest good one.
  const edges = [];
  for (let row = 0; row < headRows; row++) {
    let left = middle, right = middle;
    while (left > 0 && wood.data[row * width + left - 1]) left--;
    while (right < width - 1 && wood.data[row * width + right + 1]) right++;
    for (let k = 0; k < binding && left > 0 && cream(pixel(row, left - 1)); k++) left--;
    for (let k = 0; k < binding && right < width - 1 && cream(pixel(row, right + 1)); k++) right++;
    edges.push(right - left > 20 ? [left, right] : null);
  }
  edges.forEach((e, row) => { if (!e) { for (let d = 1; d < headRows; d++) { const near = edges[row - d] ?? edges[row + d]; if (near) { edges[row] = near; break; } } } });
  // Row by row the cut is ragged (a pixel of flag here, of button there):
  // the edges are smoothed down the headstock, a median then a mean.
  const smoothed = edges.map((_, row) => [0, 1].map((side) => {
    const near = (radius) => edges.slice(Math.max(0, row - radius), row + radius + 1).map((e) => e[side]);
    return near(4).sort((a, b) => a - b)[near(4).length >> 1];
  }));
  smoothed.forEach((_, row) => { edges[row] = [0, 1].map((side) => { const near = smoothed.slice(Math.max(0, row - 3), row + 4).map((e) => e[side]); return near.reduce((a, b) => a + b, 0) / near.length; }); });
  const sample = (row, col) => { const c0 = Math.floor(col), t = col - c0, a = pixel(row, Math.max(0, Math.min(width - 1, c0))), b = pixel(row, Math.max(0, Math.min(width - 1, c0 + 1))); return a.map((v, k) => v + (b[k] - v) * t); };
  for (let row = 0; row < headRows; row++) {
    const y = yAt(row), [ml, mr] = modelEdges(y), [pl, pr] = edges[row];
    // The posts' columns stay put; between them and the edges, model → photo.
    const inner = Math.min(.12, Math.min(-ml, mr) * .75), il = toCol(-inner), ir = toCol(inner);
    const cl = toCol(ml), cr = toCol(mr);
    for (let col = 0; col < width; col++) {
      let from = col;
      if (col < il) from = cl < il ? pl + (col - cl) / (il - cl) * (il - pl) : col;
      else if (col > ir) from = cr > ir ? ir + (col - ir) / (cr - ir) * (pr - ir) : col;
      // Past the model's edge (only its rounding shows there): the binding,
      // sampled a pixel in from its outer edge.
      from = Math.max(pl + 1.5, Math.min(pr - 1.5, from));
      const value = sample(row, from);
      for (let c = 0; c < 3; c++) texture.data[(row * width + col) * 3 + c] = Math.round(value[c]);
    }
  }
}
// The photo is lit by a flash; the room's light is softer: a little lift.
await sharp(Buffer.from(texture.data), { raw: { width, height, channels: 3 } })
  .modulate({ brightness: 1.18, saturation: 1.05 })
  .sharpen({ sigma: .8, m1: .4, m2: 1.2 })
  .webp({ quality: 92 }).toFile('public/guitar-neck.webp');
await writeFile('src/lib/guitarNeck.json', JSON.stringify({ source: photoPath, box, size: [width, height] }, null, 1) + '\n');
console.log('neck texture', width, '×', height, 'box', box.map((v) => +v.toFixed(3)));

if (process.argv.includes('--debug')) {
  // The model's frets (cyan), fretboard edges and posts (red) on the photo.
  let svg = `<svg width="${info.width}" height="${info.height}" xmlns="http://www.w3.org/2000/svg">`;
  const line = ([a, b], [c, d], colour) => { svg += `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="${colour}" stroke-width="1"/>`; };
  fit.fretboard.frets.forEach((_, n) => line(boardFit.apply([edge(-1, fretY(n)), fretY(n)]), boardFit.apply([edge(1, fretY(n)), fretY(n)]), 'cyan'));
  for (const side of [-1, 1]) line(boardFit.apply([edge(side, nutY), nutY]), boardFit.apply([edge(side, box[1]), box[1]]), 'red');
  fit.strings.forEach((s) => { const [x, y] = headFit.apply(s.post); svg += `<circle cx="${x}" cy="${y}" r="3" fill="none" stroke="red"/>`; });
  await sharp(photoPath).composite([{ input: Buffer.from(svg + '</svg>') }]).png().toFile('test-results/guitar-neck-fit.png');
}
