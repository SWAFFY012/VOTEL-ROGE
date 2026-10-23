// Fits the photographs to the Sketchfab model of Letov's Musima 1655 HV
// (public/models/letov-guitar.glb, Kirill_lewis) and writes src/lib/guitarFit.json:
//
//  1. Front: the model's top samples its own small texture (the 660 px
//     archive photo, 512×1024). The sharp front photo is registered to that
//     texture (ORB + RANSAC affine), so a top vertex keeps its place on the
//     guitar and only reads the sharp photo instead.
//  2. Back: the rear photo (public/guitar-back-4k.webp) is projected flat onto
//     the whole back (body, neck, headstock); the model's back silhouette is
//     aligned to the guitar's silhouette in the photo (box, then ECC).
//  3. Headstock face: projected straight from the archive photo
//     (public/letov-guitars.png), box to box, like the old model.
//  4. Strings: tailpiece, saddle, nut and tuner post of each string, read
//     from the model's own string meshes, in the site's guitar frame.
//
// Run: node scripts/build-guitar-model.mjs
import sharp from 'sharp';
import cvReady from '@techstark/opencv-js';
import { readFile, writeFile } from 'node:fs/promises';

const cv = await cvReady;
const glbPath = 'public/models/letov-guitar.glb', frontPath = 'public/guitar-front-4k.webp', backPath = 'public/guitar-back-4k.webp', archivePath = 'public/letov-guitars.png';
const debug = process.argv.includes('--debug') ? 'test-results' : '';

// ── glTF access ──
const glb = await readFile(glbPath);
const jsonLength = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
const bin = 20 + jsonLength + 8;
const view = (index) => { const v = gltf.bufferViews[index]; const start = bin + (v.byteOffset || 0); return glb.subarray(start, start + v.byteLength); };
const read = (index) => {
  const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView], size = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type];
  const Type = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : Uint16Array;
  const start = bin + (v.byteOffset || 0) + (a.byteOffset || 0);
  return new Type(glb.buffer.slice(glb.byteOffset + start, glb.byteOffset + start + a.count * size * Type.BYTES_PER_ELEMENT));
};
const nodeOf = (mesh) => gltf.nodes.find((n) => n.mesh === mesh);
const parentOf = (node) => gltf.nodes.find((n) => n.children?.includes(gltf.nodes.indexOf(node)));
// Under GLTF_SceneRootNode the parents are pure scale + translation (column
// major), and the two Sketchfab root rotations cancel out.
const toScene = (mesh) => {
  const chain = []; let node = nodeOf(mesh);
  while (node && node.name !== 'GLTF_SceneRootNode') { if (node.matrix) chain.push(node.matrix); node = parentOf(node); }
  return (p) => chain.reduce((q, m) => [q[0] * m[0] + m[12], q[1] * m[5] + m[13], q[2] * m[10] + m[14]], p);
};
const scaleOf = (mesh) => { let s = [1, 1, 1], node = nodeOf(mesh); while (node && node.name !== 'GLTF_SceneRootNode') { if (node.matrix) s = [s[0] * node.matrix[0], s[1] * node.matrix[5], s[2] * node.matrix[10]]; node = parentOf(node); } return s; };
const facing = (mesh, normals, i) => { const s = scaleOf(mesh); const x = normals[i * 3] / s[0], y = normals[i * 3 + 1] / s[1], z = normals[i * 3 + 2] / s[2]; return x / Math.hypot(x, y, z); };

// Body (the one textured with the photo) and headstock meshes.
const bodyMesh = gltf.meshes.findIndex((m) => gltf.materials[m.primitives[0].material].pbrMetallicRoughness?.baseColorTexture?.index === 2);
const headMesh = gltf.meshes.findIndex((m) => gltf.materials[m.primitives[0].material].pbrMetallicRoughness?.baseColorTexture?.index === 0);
const atlas = await sharp(view(gltf.images[2].bufferView)).raw().toBuffer({ resolveWithObject: true });
const AW = atlas.info.width, AH = atlas.info.height;
const body = gltf.meshes[bodyMesh].primitives[0];
const bodyUV = read(body.attributes.TEXCOORD_0), bodyNormal = read(body.attributes.NORMAL);
const uvBox = (sign, [x0, y0, x1, y1]) => {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < bodyUV.length / 2; i++) {
    const x = bodyUV[i * 2] * AW, y = bodyUV[i * 2 + 1] * AH;
    if (facing(bodyMesh, bodyNormal, i) * sign > .5 && x >= x0 && x <= x1 && y >= y0 && y <= y1) box.splice(0, 4, Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y));
  }
  return box;
};
// Region of the model texture with the left guitar's top.
const frontRegion = [110, 540, 380, 975];
const frontBox = uvBox(1, frontRegion);
console.log('model texture box front', frontBox.map(Math.round));

// ── 1. front photo → model texture (ORB + RANSAC affine) ──
const gray = async (input, resize) => {
  let pipeline = sharp(input).removeAlpha().greyscale();
  if (resize) pipeline = pipeline.resize(resize.width, resize.height, { kernel: 'lanczos3' });
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const mat = new cv.Mat(info.height, info.width, cv.CV_8UC1); mat.data.set(data);
  return mat;
};
const frontMeta = await sharp(frontPath).metadata();
// Match at the texture's own scale: the photo's guitar shrunk to about the
// size it has in the model texture.
const shrink = (frontBox[2] - frontBox[0]) / (frontMeta.width * .78);
const small = await gray(frontPath, { width: Math.round(frontMeta.width * shrink), height: Math.round(frontMeta.height * shrink) });
const atlasGray = await gray(view(gltf.images[2].bufferView));
const mask = cv.Mat.zeros(AH, AW, cv.CV_8UC1);
cv.rectangle(mask, new cv.Point(frontRegion[0], frontRegion[1]), new cv.Point(frontRegion[2], frontRegion[3]), new cv.Scalar(255), -1);
const orb = new cv.ORB(6000, 1.2, 8, 15, 0, 2, 0, 15, 5);
const k1 = new cv.KeyPointVector(), k2 = new cv.KeyPointVector(), d1 = new cv.Mat(), d2 = new cv.Mat();
orb.detectAndCompute(small, new cv.Mat(), k1, d1);
orb.detectAndCompute(atlasGray, mask, k2, d2);
const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false), pairs = new cv.DMatchVectorVector();
matcher.knnMatch(d1, d2, pairs, 2);
const from = [], to = [];
for (let i = 0; i < pairs.size(); i++) {
  const pair = pairs.get(i); if (pair.size() < 2) continue;
  const p = pair.get(0), q = pair.get(1);
  if (p.distance < q.distance * .8) { const s = k1.get(p.queryIdx).pt, t = k2.get(p.trainIdx).pt; from.push(s.x / shrink, s.y / shrink); to.push(t.x, t.y); }
}
const inliers = new cv.Mat();
// Model texture px → front photo px (the direction the UVs need).
const affine = cv.estimateAffine2D(cv.matFromArray(to.length / 2, 1, cv.CV_32FC2, to), cv.matFromArray(from.length / 2, 1, cv.CV_32FC2, from), inliers, cv.RANSAC, 4 / shrink, 4000, .995);
const kept = inliers.data.reduce((sum, v) => sum + (v ? 1 : 0), 0);
const front = Array.from(affine.data64F);
console.log('front: matches', from.length / 2, 'inliers', kept, 'affine', front.map((v) => +v.toFixed(4)));
if (kept < 12) throw new Error('front photo did not register to the model texture');

// ── 2. rear photo → the model's whole back, by silhouette ──
// Body, neck and headstock seen from behind are projected flat onto the rear
// photo: (z, y) → photo px. The model's silhouette from behind (every face
// of body, neck and headstock, flattened) is drawn as a mask and aligned to the
// guitar's silhouette in the photo (box first, then ECC), so the outline of
// the photo lies exactly on the model's edges.
const neckMesh = gltf.meshes.findIndex((m) => gltf.materials[m.primitives[0].material].pbrMetallicRoughness?.baseColorTexture?.index === 1);
const flatten = (meshes) => {
  const triangles = [];
  for (const mesh of meshes) {
    const primitive = gltf.meshes[mesh].primitives[0], scene = toScene(mesh);
    const positions = read(primitive.attributes.POSITION), indices = read(primitive.indices);
    for (let t = 0; t < indices.length; t += 3) {
      triangles.push([indices[t], indices[t + 1], indices[t + 2]].map((i) => { const [, y, z] = scene([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]); return [z, y]; }));
    }
  }
  return triangles;
};
const rearMeta = await sharp(backPath).metadata(), RW = rearMeta.width, RH = rearMeta.height;
const rearGray = await gray(backPath);
const photoMask = new cv.Mat();
// The background is pure black (0); the black lacquer is not, so anything
// above 2 is guitar. Closing fills the dark speckles in the lacquer; opening
// then wipes thin things the model has no faces for (the strap, the tuner
// buttons) before the outer contour is filled: with the strap still there it
// would close a loop of background.
cv.threshold(rearGray, photoMask, 2, 255, cv.THRESH_BINARY);
cv.morphologyEx(photoMask, photoMask, cv.MORPH_CLOSE, cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9)));
cv.morphologyEx(photoMask, photoMask, cv.MORPH_OPEN, cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(45, 45)));
{
  const contours = new cv.MatVector(), hierarchy = new cv.Mat();
  cv.findContours(photoMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  let largest = 0; for (let i = 1; i < contours.size(); i++) if (cv.contourArea(contours.get(i)) > cv.contourArea(contours.get(largest))) largest = i;
  photoMask.setTo(new cv.Scalar(0));
  cv.drawContours(photoMask, contours, largest, new cv.Scalar(255), -1);
}
const rasterize = (triangles, m) => {
  const mat = cv.Mat.zeros(RH, RW, cv.CV_8UC1);
  for (const tri of triangles) {
    const pts = cv.matFromArray(3, 1, cv.CV_32SC2, tri.flatMap(([z, y]) => [Math.round(m[0] * z + m[1] * y + m[2]), Math.round(m[3] * z + m[4] * y + m[5])]));
    cv.fillConvexPoly(mat, pts, new cv.Scalar(255)); pts.delete();
  }
  return mat;
};
const below = (mat, row) => { if (row < mat.rows) mat.roi(new cv.Rect(0, row, mat.cols, mat.rows - row)).setTo(new cv.Scalar(0)); return mat; };
// ECC on a blurred pyramid; the warp maps model-mask px → photo px, and is
// composed with the starting placement into (z, y) → photo px.
const align = (label, triangles, start, target, cut = RH) => {
  const model = below(rasterize(triangles, start), cut), warp = cv.Mat.eye(2, 3, cv.CV_32F);
  for (const level of [.25, .5, 1]) {
    const w = Math.round(RW * level), h = Math.round(RH * level), tpl = new cv.Mat(), inp = new cv.Mat();
    cv.resize(model, tpl, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    cv.resize(target, inp, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    const blur = new cv.Size(level === 1 ? 15 : 9, level === 1 ? 15 : 9);
    cv.GaussianBlur(tpl, tpl, blur, 0); cv.GaussianBlur(inp, inp, blur, 0);
    const scaled = new cv.Mat(2, 3, cv.CV_32F);
    for (let i = 0; i < 6; i++) scaled.data32F[i] = warp.data32F[i] * (i % 3 === 2 ? level : 1);
    try {
      const score = cv.findTransformECC(tpl, inp, scaled, cv.MOTION_AFFINE, new cv.TermCriteria(cv.TermCriteria_COUNT + cv.TermCriteria_EPS, 300, 1e-7), new cv.Mat(), 5);
      for (let i = 0; i < 6; i++) warp.data32F[i] = scaled.data32F[i] / (i % 3 === 2 ? level : 1);
      console.log(label, 'ECC @', level, 'correlation', score.toFixed(4));
    } catch (error) { console.log(label, 'ECC failed @', level, typeof error === 'number' ? cv.exceptionFromPtr(error).msg : error); }
  }
  const W = warp.data32F;
  return [
    W[0] * start[0] + W[1] * start[3], W[0] * start[1] + W[1] * start[4], W[0] * start[2] + W[1] * start[5] + W[2],
    W[3] * start[0] + W[4] * start[3], W[3] * start[1] + W[4] * start[4], W[3] * start[2] + W[4] * start[5] + W[5],
  ];
};
// Whole guitar first, placed by its box (from behind, +z is right, +y is up).
const everything = flatten([bodyMesh, neckMesh, headMesh]);
const maskBox = (mat) => { let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1; for (let y = 0; y < mat.rows; y++) for (let x = 0; x < mat.cols; x++) if (mat.data[y * mat.cols + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };
const [px0, py0, px1, py1] = maskBox(photoMask);
const zs = everything.flat().map((p) => p[0]), ys = everything.flat().map((p) => p[1]);
const [zMin, zMax, yMin, yMax] = [Math.min(...zs), Math.max(...zs), Math.min(...ys), Math.max(...ys)];
const kx = (px1 - px0) / (zMax - zMin), ky = (py1 - py0) / (yMax - yMin);
const rear = align('rear', everything, [kx, 0, px0 - zMin * kx, 0, -ky, py0 + yMax * ky], photoMask);
// The model's neck and headstock differ a little from the real ones, so each
// gets its own box fit. In the photo, the neck runs up from the body until the
// silhouette suddenly widens into the headstock: that row is the nut.
const rowSpan = (row) => { let l = -1, r = -1; for (let x = 0; x < RW; x++) if (photoMask.data[row * RW + x]) { if (l < 0) l = x; r = x; } return [l, r]; };
const flatBox = (meshes, from = -Infinity, to = Infinity) => {
  const points = flatten(meshes).flat().filter(([, y]) => y >= from && y <= to);
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])), Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
};
const bodyTop = flatBox([bodyMesh])[3];
const bodyRow = Math.round(rear[4] * bodyTop + rear[5]);
const neckWidths = [];
let nutRow = bodyRow;
for (let row = bodyRow - 20; row > 0; row--) {
  const [l, r] = rowSpan(row); if (l < 0) break;
  const width = r - l, typical = neckWidths.length ? neckWidths.slice().sort((x, y) => x - y)[neckWidths.length >> 1] : width;
  if (neckWidths.length > 40 && width > typical * 1.6) { nutRow = row; break; }
  neckWidths.push(width);
}
const headTop = maskBox(photoMask)[1];
// The neck mesh ends at the nut.
const nutY = flatBox([neckMesh])[3];
const boxFit = ([z0, y0, z1, y1], [x0, top, x1, bottom]) => { const sx = (x1 - x0) / (z1 - z0), sy = (bottom - top) / (y1 - y0); return [sx, 0, x0 - z0 * sx, 0, -sy, top + y1 * sy]; };
const spanOf = (from, to) => { let l = Infinity, r = -Infinity; for (let row = from; row <= to; row++) { const [a, b] = rowSpan(row); if (a >= 0) { l = Math.min(l, a); r = Math.max(r, b); } } return [l, r]; };
// Neck: from the body to the nut, as wide as the neck between them.
const [nl, nr] = spanOf(nutRow + 12, bodyRow - 12);
// (The neck mesh is a few long faces: its width comes from all of it.)
const [nz0, , nz1] = flatBox([neckMesh]);
const rearNeck = boxFit([nz0, bodyTop, nz1, nutY], [nl, nutRow, nr, bodyRow]);
// Headstock: from the nut to its top.
const [hl, hr] = spanOf(headTop, nutRow);
const rearHead = boxFit(flatBox([headMesh], nutY), [hl, headTop, hr, nutRow]);
console.log('photo rows: body', bodyRow, 'nut', nutRow, 'head top', headTop);
console.log('rear: (z, y) → photo px', rear.map((v) => +v.toFixed(3)), 'neck', rearNeck.map((v) => +v.toFixed(3)), 'head', rearHead.map((v) => +v.toFixed(3)));

// ── fretboard: its face box and the frets, for a sharp rosewood texture ──
const neckPrimitive = gltf.meshes[neckMesh].primitives[0], neckScene = toScene(neckMesh);
const neckPos = read(neckPrimitive.attributes.POSITION), neckNormal = read(neckPrimitive.attributes.NORMAL);
const board = [Infinity, Infinity, -Infinity, -Infinity];
for (let i = 0; i < neckPos.length / 3; i++) {
  if (facing(neckMesh, neckNormal, i) < .5) continue;
  const [, y, z] = neckScene([neckPos[i * 3], neckPos[i * 3 + 1], neckPos[i * 3 + 2]]);
  board.splice(0, 4, Math.min(board[0], z), Math.min(board[1], y), Math.max(board[2], z), Math.max(board[3], y));
}
const fretMesh = gltf.meshes.findIndex((m, i) => { const a = gltf.accessors[m.primitives[0].attributes.POSITION], f = toScene(i); const lo = f(a.min)[1], hi = f(a.max)[1]; return gltf.materials[m.primitives[0].material].name === 'Material.006' && lo > board[1] - .1 && hi < board[3] + .1; });
const fretScene = toScene(fretMesh), fretPos = read(gltf.meshes[fretMesh].primitives[0].attributes.POSITION);
const fretYs = []; for (let i = 0; i < fretPos.length; i += 3) fretYs.push(fretScene([fretPos[i], fretPos[i + 1], fretPos[i + 2]])[1]);
fretYs.sort((a, b) => b - a);
const frets = [];
for (const y of fretYs) { const last = frets[frets.length - 1]; if (last && last.max - y < .06) { last.min = y; last.sum += y; last.n++; } else frets.push({ max: y, min: y, sum: y, n: 1 }); }
const fretboard = { box: board, frets: frets.map((f) => +(f.sum / f.n).toFixed(4)) };
console.log('fretboard box', board.map((v) => +v.toFixed(3)), 'frets', fretboard.frets.length);

// ── 3. headstock face → archive photo, box to box ──
const head = gltf.meshes[headMesh].primitives[0];
const headPos = read(head.attributes.POSITION), headNormal = read(head.attributes.NORMAL), headScene = toScene(headMesh);
const headBox = [Infinity, Infinity, -Infinity, -Infinity];
for (let i = 0; i < headPos.length / 3; i++) {
  if (facing(headMesh, headNormal, i) < .5) continue;
  const [, y, z] = headScene([headPos[i * 3], headPos[i * 3 + 1], headPos[i * 3 + 2]]);
  headBox.splice(0, 4, Math.min(headBox[0], z), Math.min(headBox[1], y), Math.max(headBox[2], z), Math.max(headBox[3], y));
}
// Headstock face in the 660×777 archive photo: from the top to the nut.
const archiveHead = [133, 42, 179, 143.5];
const headstock = { scene: headBox, photo: archiveHead };
console.log('headstock scene box (z, y)', headBox.map((v) => +v.toFixed(3)));

// ── 4. strings ──
// Site frame: x = −(z − zc)·s, y = (y − yc)·s, z = (x − xc)·s. Thickest string first.
const stringMeshes = gltf.meshes.map((m, i) => i).filter((i) => gltf.materials[gltf.meshes[i].primitives[0].material].name === 'Material.003');
const strings = stringMeshes.map((mesh) => {
  const positions = read(gltf.meshes[mesh].primitives[0].attributes.POSITION), scene = toScene(mesh);
  const rings = new Map();
  for (let i = 0; i < positions.length; i += 3) {
    const key = positions[i + 1].toFixed(2), p = scene([positions[i], positions[i + 1], positions[i + 2]]);
    if (!rings.has(key)) rings.set(key, []); rings.get(key).push(p);
  }
  const centres = [...rings.values()].map((r) => [0, 1, 2].map((c) => r.reduce((a, p) => a + p[c], 0) / r.length)).sort((a, b) => a[1] - b[1]);
  // Lowest ring: tailpiece end; then the saddle, the nut, the tuner post.
  const [tail] = centres, post = centres[centres.length - 1], nut = centres[centres.length - 2], saddle = centres[centres.length - 3];
  return { tail, saddle, nut, post };
}).sort((a, b) => b.nut[2] - a.nut[2]);
const bounds = { minY: Infinity, maxY: -Infinity };
gltf.meshes.forEach((m, i) => { const a = gltf.accessors[m.primitives[0].attributes.POSITION], f = toScene(i); const lo = f(a.min), hi = f(a.max); bounds.minY = Math.min(bounds.minY, lo[1], hi[1]); bounds.maxY = Math.max(bounds.maxY, lo[1], hi[1]); });
// Same overall length as the old model (6.83), centred on the strings' line.
const scale = 6.83 / (bounds.maxY - bounds.minY);
const zc = strings.reduce((a, s) => a + s.nut[2] + s.saddle[2], 0) / 12, yc = (bounds.minY + bounds.maxY) / 2;
const bodyScene = toScene(bodyMesh), bodyPos = read(body.attributes.POSITION);
let backX = Infinity, topX = -Infinity;
for (let i = 0; i < bodyPos.length; i += 3) { const x = bodyScene([bodyPos[i], bodyPos[i + 1], bodyPos[i + 2]])[0]; backX = Math.min(backX, x); topX = Math.max(topX, x); }
const xc = (backX + topX) / 2;
const site = ([x, y, z]) => [-(z - zc) * scale, (y - yc) * scale, (x - xc) * scale].map((v) => +v.toFixed(5));
const fit = {
  source: 'Guitar Musima 1655 HV Egor Letov by Kirill_lewis (sketchfab.com/klintonf81), Sketchfab Standard licence',
  frame: { scale, centre: [xc, yc, zc] },
  atlas: { width: AW, height: AH },
  front: { affine: front, region: frontRegion, size: [frontMeta.width, frontMeta.height] },
  rear: { body: rear, neck: rearNeck, head: rearHead, size: [RW, RH] },
  fretboard,
  headstock: { ...headstock, size: [660, 777] },
  strings: strings.map((s) => ({ tail: site(s.tail), saddle: site(s.saddle), nut: site(s.nut), post: site(s.post) })),
};
await writeFile('src/lib/guitarFit.json', JSON.stringify(fit, null, 1));
console.log('frame', fit.frame, 'string 0', fit.strings[0]);

if (debug) {
  // The front photo pulled into model-texture space, half over the original.
  const warped = new cv.Mat(), photo = await gray(frontPath), inverse = new cv.Mat();
  cv.invertAffineTransform(affine, inverse);
  cv.warpAffine(photo, warped, inverse, new cv.Size(AW, AH));
  const blend = Buffer.alloc(AW * AH * 3);
  for (let i = 0; i < AW * AH; i++) { blend[i * 3] = warped.data[i]; blend[i * 3 + 1] = atlasGray.data[i]; blend[i * 3 + 2] = atlasGray.data[i]; }
  await sharp(blend, { raw: { width: AW, height: AH, channels: 3 } }).png().toFile(`${debug}/guitar-front-fit.png`);
  // The model's silhouette (red) over the rear photo.
  const placed = rasterize(flatten([bodyMesh]), rear), neck = rasterize(flatten([neckMesh]), rearNeck), head = rasterize(flatten([headMesh]), rearHead);
  for (let i = 0; i < RW * RH; i++) placed.data[i] |= neck.data[i] | head.data[i];
  const overlay = Buffer.alloc(RW * RH * 3);
  for (let i = 0; i < RW * RH; i++) { overlay[i * 3] = placed.data[i] ? 255 : rearGray.data[i]; overlay[i * 3 + 1] = rearGray.data[i]; overlay[i * 3 + 2] = rearGray.data[i]; }
  await sharp(overlay, { raw: { width: RW, height: RH, channels: 3 } }).png().toFile(`${debug}/guitar-rear-fit.png`);
}
