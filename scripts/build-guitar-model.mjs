// Fits the photographs to the Sketchfab model of Letov's Musima 1655 HV
// (public/models/letov-guitar.glb, Kirill_lewis) and writes src/lib/guitarFit.json:
//
//  1. Front: the model's top samples its own small texture (the 660 px
//     archive photo, 512×1024). The sharp front photo is registered to that
//     texture (ORB + RANSAC affine), so a top vertex keeps its place on the
//     guitar and only reads the sharp photo instead.
//  2. Back: the archival rear photo (public/guitar-back.png) is a different
//     print, so it is fitted by outline: the box of the body (below the neck)
//     in the photo onto the box the model's rear faces use in its texture.
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
const glbPath = 'public/models/letov-guitar.glb', frontPath = 'public/guitar-front-4k.webp', backPath = 'public/guitar-back.png', archivePath = 'public/letov-guitars.png';
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
// Regions of the model texture: the left guitar's top, and the rear guitar.
const frontRegion = [110, 540, 380, 975], backRegion = [270, 290, 430, 540];
const frontBox = uvBox(1, frontRegion), backBox = uvBox(-1, backRegion);
console.log('model texture boxes front', frontBox.map(Math.round), 'back', backBox.map(Math.round));

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

// ── 2. rear photo → model texture, by the body's box ──
const bodyBox = async (path, region) => {
  const { data, info } = await sharp(path).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const [x0, y0, x1, y1] = region ?? [0, 0, info.width, info.height];
  const rows = [];
  for (let y = y0; y < y1; y++) { let l = -1, r = -1; for (let x = x0; x < x1; x++) if (data[y * info.width + x] > 40) { if (l < 0) l = x; r = x; } rows.push([y, l, r]); }
  const widest = Math.max(...rows.map(([, l, r]) => (l < 0 ? 0 : r - l)));
  // The body is every row at least 45% as wide as the widest: the neck and
  // headstock are much narrower.
  const bodyRows = rows.filter(([, l, r]) => l >= 0 && r - l >= widest * .45);
  return [Math.min(...bodyRows.map((r) => r[1])), bodyRows[0][0], Math.max(...bodyRows.map((r) => r[2])), bodyRows[bodyRows.length - 1][0]];
};
const rearBox = await bodyBox(backPath);
// The model's rear faces: its texture box is the outline the mesh expects.
const sx = (rearBox[2] - rearBox[0]) / (backBox[2] - backBox[0]), sy = (rearBox[3] - rearBox[1]) / (backBox[3] - backBox[1]);
const back = [sx, 0, rearBox[0] - backBox[0] * sx, 0, sy, rearBox[1] - backBox[1] * sy];
console.log('back: photo body box', rearBox, 'affine', back.map((v) => +v.toFixed(4)));

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
  back: { affine: back, region: backRegion, size: [(await sharp(backPath).metadata()).width, (await sharp(backPath).metadata()).height] },
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
}
