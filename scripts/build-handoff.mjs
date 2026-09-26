// Builds the seamless hand-off from the scroll film to the two-layer peel scene.
//
//  1. Restores the untouched film frames 100–301 into public/peel/frames.
//  2. Cuts the floral layer straight out of the final film frame: its RGB is
//     frame_0301 byte for byte, the opening is the grey face silhouette of that
//     same frame (so every flower keeps its exact place, light and sharpness).
//  3. Registers the final Letov photo (облога финальная летов фон.png) to the face
//     (edge bands the tighter crop leaves open are filled from letov-new.png) of the final frame
//     (ORB features + ECC refinement inside the opening) and writes it as the
//     layer behind the flowers.
//  4. Writes the aligned photo clipped to the opening; the page fades it in over
//     the last, static film frames, so the last frame already equals the
//     two-layer composite and the switch changes no pixels.
//
// Run: node scripts/build-handoff.mjs [--debug]
import sharp from 'sharp';
import cvReady from '@techstark/opencv-js';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const cv = await cvReady;
const root = process.cwd();
const out = join(root, 'public', 'peel');
const sourceFrames = 'C:/Users/a_zlo/Downloads/video letov/frames';
const debug = process.argv.includes('--debug') ? process.env.DEBUG_DIR || join(root, 'test-results') : '';
const W = 1920, H = 1080, count = W * H;
const frameName = (n) => `frame_${String(n).padStart(4, '0')}.webp`;

// 1. Original film frames.
await mkdir(join(out, 'frames'), { recursive: true });
for (let n = 100; n <= 301; n++) await copyFile(join(sourceFrames, frameName(n)), join(out, 'frames', frameName(n)));

const film = await sharp(join(sourceFrames, frameName(301))).removeAlpha().raw().toBuffer();

// 2. Face silhouette of the final frame. The face is printed in greyscale on
// a saturated flower field, so chroma separates it cleanly. The supplied
// cut-out only serves as a coarse prior that keeps dark flower gaps out.
const prior = await (async () => {
  const jpg = await sharp(join(root, 'цветы с вырезом 1-ый слой.jpg')).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const m = new cv.Mat(H, W, cv.CV_8UC1);
  for (let i = 0; i < count; i++) {
    const r = jpg[i * 3], g = jpg[i * 3 + 1], b = jpg[i * 3 + 2];
    m.data[i] = r > 200 && g > 200 && b > 200 && Math.max(r, g, b) - Math.min(r, g, b) < 30 ? 255 : 0;
  }
  // Only the big white opening, not specular highlights on petals.
  const labels = new cv.Mat(), stats = new cv.Mat(), cent = new cv.Mat();
  const n = cv.connectedComponentsWithStats(m, labels, stats, cent, 8, cv.CV_32S);
  let best = 1;
  for (let i = 2; i < n; i++) if (stats.intAt(i, cv.CC_STAT_AREA) > stats.intAt(best, cv.CC_STAT_AREA)) best = i;
  for (let i = 0; i < count; i++) m.data[i] = labels.data32S[i] === best ? 255 : 0;
  // The JPEG is registered to the film only roughly; be generous.
  const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(81, 81));
  cv.dilate(m, m, k);
  return m;
})();

// HSV saturation (chroma relative to value): dark gaps between flowers are
// still tinted, while even the darkest parts of the printed face stay grey.
const chroma = new cv.Mat(H, W, cv.CV_8UC1);
for (let i = 0; i < count; i++) {
  const r = film[i * 3], g = film[i * 3 + 1], b = film[i * 3 + 2], max = Math.max(r, g, b);
  chroma.data[i] = max ? Math.round(255 * (max - Math.min(r, g, b)) / max) : 0;
}
const smooth = new cv.Mat();
cv.GaussianBlur(chroma, smooth, new cv.Size(0, 0), 2.5);
const face = new cv.Mat(H, W, cv.CV_8UC1);
// Hysteresis: the strict threshold traces the face outline exactly; the looser
// one also catches the bluish end of the neck strip, opened with a wide disc
// so pale hydrangea petals touching it are not swallowed.
const largest = (mask) => {
  const labels = new cv.Mat(), stats = new cv.Mat(), cent = new cv.Mat();
  const n = cv.connectedComponentsWithStats(mask, labels, stats, cent, 8, cv.CV_32S);
  let best = 1;
  for (let i = 2; i < n; i++) if (stats.intAt(i, cv.CC_STAT_AREA) > stats.intAt(best, cv.CC_STAT_AREA)) best = i;
  for (let i = 0; i < count; i++) mask.data[i] = labels.data32S[i] === best ? 255 : 0;
};
const segment = (threshold, opening) => {
  const mask = new cv.Mat(H, W, cv.CV_8UC1);
  for (let i = 0; i < count; i++) mask.data[i] = prior.data[i] && smooth.data[i] < threshold ? 255 : 0;
  cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(11, 11)));
  cv.morphologyEx(mask, mask, cv.MORPH_OPEN, cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(opening, opening)));
  largest(mask);
  return mask;
};
{
  const strict = segment(45, 9), loose = segment(55, 31);
  cv.bitwise_or(strict, loose, face);
  largest(face);
  const close = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(15, 15));
  cv.morphologyEx(face, face, cv.MORPH_CLOSE, close);
  // Fill interior holes (white highlights have no chroma either, but dark
  // lenses with a tinted reflection might).
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  cv.findContours(face, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
  face.setTo(new cv.Scalar(0));
  cv.drawContours(face, contours, -1, new cv.Scalar(255), -1);
}

// Soft, sub-pixel edge: signed distance to the silhouette boundary.
const inside = new cv.Mat(), outside = new cv.Mat(), inv = new cv.Mat();
cv.distanceTransform(face, inside, cv.DIST_L2, 5);
cv.bitwise_not(face, inv);
cv.distanceTransform(inv, outside, cv.DIST_L2, 5);
const feather = 1.25;
const sheetAlpha = new Uint8Array(count);
for (let i = 0; i < count; i++) {
  const d = face.data[i] ? inside.data32F[i] - .5 : -(outside.data32F[i] - .5);
  sheetAlpha[i] = Math.round(255 * Math.max(0, Math.min(1, .5 - d / (2 * feather))));
}

// Crimson matte around the film image: never part of the sheet.
const isMatte = (i) => { const r = film[i * 3], g = film[i * 3 + 1], b = film[i * 3 + 2]; return r > 70 && r > 2.2 * g && r > 1.4 * b; };
const matteDepth = (step, start, length, stride) => {
  let depth = 0;
  for (let p = 0; p < 200; p++) {
    let hits = 0;
    for (let q = length * .2; q < length * .8; q++) if (isMatte(start(p, Math.floor(q)))) hits++;
    if (hits > length * .6 * .7) depth = p + 1; else if (p > 4) break;
  }
  return depth;
};
const left = matteDepth(1, (p, q) => q * W + p, H);
const right = matteDepth(1, (p, q) => q * W + (W - 1 - p), H);
const top = matteDepth(1, (p, q) => p * W + q, W);
const bottom = matteDepth(1, (p, q) => (H - 1 - p) * W + q, W);
const pad = 3;
for (let i = 0; i < count; i++) {
  const x = i % W, y = (i / W) | 0;
  if (x < left + pad || x >= W - right - pad || y < top + pad || y >= H - bottom - pad) sheetAlpha[i] = 0;
}

const sheet = Buffer.alloc(count * 4);
for (let i = 0; i < count; i++) {
  sheet[i * 4] = film[i * 3]; sheet[i * 4 + 1] = film[i * 3 + 1]; sheet[i * 4 + 2] = film[i * 3 + 2];
  sheet[i * 4 + 3] = sheetAlpha[i];
}
await sharp(sheet, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(join(out, 'flowers-cutout.png'));

// 3. Register the photo to the film face.
const loadPhoto = async (path) => {
  const meta = await sharp(path).metadata();
  // Alpha is dropped: the final PNGs are opaque apart from a stray top row.
  const rgba = await sharp(path).removeAlpha().ensureAlpha().raw().toBuffer();
  const mat = cv.matFromArray(meta.height, meta.width, cv.CV_8UC4, rgba);
  const gray = new cv.Mat(); cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
  return { mat, gray, width: meta.width, height: meta.height };
};
const warpTo = (src, m, interpolation = cv.INTER_LINEAR, border = cv.BORDER_REPLICATE) => {
  const dst = new cv.Mat();
  cv.warpAffine(src, dst, m, new cv.Size(W, H), interpolation, border);
  return dst;
};
const ncc = (a, b, mask) => {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < count; i++) if (mask.data[i]) { const x = a.data[i], y = b.data[i]; n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; }
  return (sab - sa * sb / n) / Math.sqrt((saa - sa * sa / n) * (sbb - sb * sb / n));
};
// ORB features + RANSAC affine, then ECC on a blurred pyramid for the residual
// (OpenCV 5's masked ECC wants equal sizes, so R is solved against the
// pre-warped source and composed: source -> target = R⁻¹ · T).
const register = (label, source, targetGray, mask) => {
  const orb = new cv.ORB(8000, 1.2, 8, 19, 0, 2, 0, 31, 10);
  const k1 = new cv.KeyPointVector(), k2 = new cv.KeyPointVector(), d1 = new cv.Mat(), d2 = new cv.Mat();
  orb.detectAndCompute(source.gray, new cv.Mat(), k1, d1);
  orb.detectAndCompute(targetGray, mask, k2, d2);
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false), pairs = new cv.DMatchVectorVector();
  matcher.knnMatch(d1, d2, pairs, 2);
  const a = [], b = [];
  for (let i = 0; i < pairs.size(); i++) {
    const pair = pairs.get(i); if (pair.size() < 2) continue;
    const p = pair.get(0), q = pair.get(1);
    if (p.distance < q.distance * .75) { const s = k1.get(p.queryIdx).pt, t = k2.get(p.trainIdx).pt; a.push(s.x, s.y); b.push(t.x, t.y); }
  }
  const inl = new cv.Mat();
  let transform = cv.estimateAffine2D(cv.matFromArray(a.length / 2, 1, cv.CV_32FC2, a), cv.matFromArray(b.length / 2, 1, cv.CV_32FC2, b), inl, cv.RANSAC, 3);
  const score = (m) => { const g = warpTo(source.gray, m); const v = ncc(g, targetGray, mask); g.delete(); return v; };
  const before = score(transform);
  const prewarped = warpTo(source.gray, transform);
  const warp = cv.Mat.eye(2, 3, cv.CV_32F);
  for (const scale of [.25, .5, 1]) {
    const tw = Math.round(W * scale), th = Math.round(H * scale);
    const tpl = new cv.Mat(), inp = new cv.Mat(), msk = new cv.Mat();
    cv.resize(targetGray, tpl, new cv.Size(tw, th), 0, 0, cv.INTER_AREA);
    cv.resize(prewarped, inp, new cv.Size(tw, th), 0, 0, cv.INTER_AREA);
    cv.resize(mask, msk, new cv.Size(tw, th), 0, 0, cv.INTER_NEAREST);
    const blur = new cv.Size(scale === 1 ? 7 : 5, scale === 1 ? 7 : 5);
    cv.GaussianBlur(tpl, tpl, blur, 0); cv.GaussianBlur(inp, inp, blur, 0);
    const scaled = new cv.Mat(2, 3, cv.CV_32F);
    for (let i = 0; i < 6; i++) scaled.data32F[i] = warp.data32F[i] * (i % 3 === 2 ? scale : 1);
    try {
      cv.findTransformECC(tpl, inp, scaled, cv.MOTION_AFFINE, new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 200, 1e-7), msk, 5);
      for (let i = 0; i < 6; i++) warp.data32F[i] = scaled.data32F[i] / (i % 3 === 2 ? scale : 1);
    } catch (error) { console.log(label, 'ECC failed @', scale, typeof error === 'number' ? cv.exceptionFromPtr(error).msg : error); }
  }
  const residual = new cv.Mat(2, 3, cv.CV_64F), back = new cv.Mat();
  for (let i = 0; i < 6; i++) residual.data64F[i] = warp.data32F[i];
  cv.invertAffineTransform(residual, back);
  const r = back.data64F, t = transform.data64F;
  const refined = cv.matFromArray(2, 3, cv.CV_64F, [
    r[0] * t[0] + r[1] * t[3], r[0] * t[1] + r[1] * t[4], r[0] * t[2] + r[1] * t[5] + r[2],
    r[3] * t[0] + r[4] * t[3], r[3] * t[1] + r[4] * t[4], r[3] * t[2] + r[4] * t[5] + r[5],
  ]);
  const after = score(refined);
  if (after > before) transform = refined;
  console.log(label, 'matches', a.length / 2, 'NCC', before.toFixed(4), '->', Math.max(before, after).toFixed(4), 'affine', Array.from(transform.data64F).map(v => +v.toFixed(5)));
  return transform;
};

const filmMat = new cv.Mat(H, W, cv.CV_8UC3); filmMat.data.set(film);
const filmGray = new cv.Mat(); cv.cvtColor(filmMat, filmGray, cv.COLOR_RGB2GRAY);
const faceCore = new cv.Mat();
cv.erode(face, faceCore, cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(13, 13)));

// The final photo is a tighter crop: aligned to the film it leaves thin bands
// at the frame edges. Those bands come from the earlier, wider print of the
// same photograph, registered to the final one and tone-matched on the seam.
const photo = await loadPhoto(join(root, 'облога финальная летов фон.png'));
const transform = register('photo -> film', photo, filmGray, faceCore);
const main = warpTo(photo.mat, transform, cv.INTER_CUBIC);
const coverage = warpTo(new cv.Mat(photo.height, photo.width, cv.CV_8UC1, new cv.Scalar(255)), transform, cv.INTER_NEAREST, cv.BORDER_CONSTANT);
cv.erode(coverage, coverage, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
const coverDist = new cv.Mat();
cv.distanceTransform(coverage, coverDist, cv.DIST_L2, 5);
const alignedRGB = Buffer.alloc(count * 3);
for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) alignedRGB[i * 3 + c] = main.data[i * 4 + c];
let uncovered = 0;
for (let i = 0; i < count; i++) if (!coverage.data[i]) uncovered++;
if (uncovered) {
  const wide = await loadPhoto(join(out, 'letov-new.png'));
  const mainGray = new cv.Mat(); cv.cvtColor(main, mainGray, cv.COLOR_RGBA2GRAY);
  const inner = new cv.Mat(); cv.erode(coverage, inner, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(41, 41)));
  const fillTransform = register('wide -> photo', wide, mainGray, inner);
  const fill = warpTo(wide.mat, fillTransform, cv.INTER_CUBIC);
  // Per-channel gain/offset fitted on a 60 px band just inside the seam.
  const fit = [0, 1, 2].map((c) => {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < count; i++) { const d = coverDist.data32F[i]; if (d > 8 && d < 68) { const x = fill.data[i * 4 + c], y = main.data[i * 4 + c]; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; } }
    const gain = (sxy - sx * sy / n) / (sxx - sx * sx / n), offset = (sy - gain * sx) / n;
    return { gain, offset };
  });
  console.log('seam tone fit', fit.map(f => [+f.gain.toFixed(3), +f.offset.toFixed(1)]));
  const feather = 40;
  for (let i = 0; i < count; i++) {
    const w = Math.min(1, coverDist.data32F[i] / feather);
    if (w >= 1) continue;
    for (let c = 0; c < 3; c++) {
      const f = Math.max(0, Math.min(255, fill.data[i * 4 + c] * fit[c].gain + fit[c].offset));
      alignedRGB[i * 3 + c] = Math.round(main.data[i * 4 + c] * w + f * (1 - w));
    }
  }
  console.log('filled edge px', uncovered);
}
await sharp(alignedRGB, { raw: { width: W, height: H, channels: 3 } }).webp({ lossless: true }).toFile(join(out, 'letov-aligned.webp'));

// 4. The photo as seen through the opening, for the in-film cross-fade.
const hole = Buffer.alloc(count * 4);
for (let i = 0; i < count; i++) {
  for (let c = 0; c < 3; c++) hole[i * 4 + c] = alignedRGB[i * 3 + c];
  hole[i * 4 + 3] = 255 - sheetAlpha[i];
}
// Everything outside the opening is transparent; keep the matte band clear too.
for (let i = 0; i < count; i++) {
  const x = i % W, y = (i / W) | 0;
  if (x < left + pad || x >= W - right - pad || y < top + pad || y >= H - bottom - pad) hole[i * 4 + 3] = 0;
}
await sharp(hole, { raw: { width: W, height: H, channels: 4 } }).webp({ lossless: true }).toFile(join(out, 'letov-hole.webp'));

console.log('matte', { left, right, top, bottom }, 'opening px', face.data.reduce((s, v) => s + (v ? 1 : 0), 0));

if (debug) {
  const o = Buffer.from(film);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, m = face.data[i];
    if (m !== face.data[i + 1] || m !== face.data[i + W]) { o[i * 3] = 0; o[i * 3 + 1] = 255; o[i * 3 + 2] = 0; }
  }
  await sharp(o, { raw: { width: W, height: H, channels: 3 } }).extract({ left: 560, top: 180, width: 1100, height: 640 }).png().toFile(join(debug, 'handoff-mask.png'));
  const composite = Buffer.alloc(count * 3);
  for (let i = 0; i < count; i++) { const a = sheetAlpha[i] / 255; for (let c = 0; c < 3; c++) composite[i * 3 + c] = Math.round(film[i * 3 + c] * a + alignedRGB[i * 3 + c] * (1 - a)); }
  await sharp(composite, { raw: { width: W, height: H, channels: 3 } }).png().toFile(join(debug, 'handoff-composite.png'));
  const chk = Buffer.alloc(count * 3);
  for (let i = 0; i < count; i++) { const x = i % W, y = (i / W) | 0, src = ((x >> 5) + (y >> 5)) & 1 ? film : alignedRGB; for (let c = 0; c < 3; c++) chk[i * 3 + c] = src[i * 3 + c]; }
  await sharp(chk, { raw: { width: W, height: H, channels: 3 } }).extract({ left: 560, top: 180, width: 1100, height: 640 }).png().toFile(join(debug, 'handoff-checker.png'));
}
console.log('Restored frames 100–301, wrote flowers-cutout.png, letov-aligned.webp, letov-hole.webp');
