// The tuners for Letov's guitar, taken from "Ovation Guitar" by Duane's Mind
// (sketchfab.com/3d-models/ovation-guitar-f5bd8065de084cf297302ed676f4da71,
// CC-BY-4.0; scripts/models/ovation-guitar.glb): its six machines (bushing
// and post, housing, shaft, button) and, of its strings, what is wound on
// each post. The ends sticking out and the straight run from the post to
// the nut are left out: the site's own strings run there.
//
// Each tuner is written in a frame of its own post, scaled to the Letov
// model (the two guitars' lengths): origin on the headstock's face under the
// post, x outwards (away from the strings' middle), y out of the face, z
// along the headstock towards its tip. One mesh per tuner ("tuner-<side>-<k>")
// and one for its winding ("winding-<side>-<k>"), side "bass" or "treble", k
// counting from the nut; the winding's extras.anchor is where the straight
// run leaves it, for the string to start from.
//
// Writes public/models/tuners.glb (credits: public/models/SOURCES.md).
// Run: node scripts/build-tuners.mjs (after downloading the model to scripts/models/).
import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile('scripts/models/ovation-guitar.glb');
const jsonLength = source.readUInt32LE(12), gltf = JSON.parse(source.subarray(20, 20 + jsonLength)), bin = 20 + jsonLength + 8;
const read = (index) => {
  const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView], size = { VEC3: 3, VEC2: 2, SCALAR: 1, VEC4: 4 }[a.type];
  const Type = a.componentType === 5126 ? Float32Array : a.componentType === 5125 ? Uint32Array : Uint16Array;
  const start = bin + (v.byteOffset || 0) + (a.byteOffset || 0);
  return new Type(source.buffer.slice(source.byteOffset + start, source.byteOffset + start + a.count * size * Type.BYTES_PER_ELEMENT));
};
// (The Sketchfab root and the FBX node's rotations cancel out: the meshes are
// in the scene frame, the top facing +y, the headstock towards −z.)
const mesh = (name) => {
  const primitive = gltf.meshes.find((m) => m.name === name).primitives[0];
  const position = read(primitive.attributes.POSITION), normal = read(primitive.attributes.NORMAL), uv = read(primitive.attributes.TEXCOORD_0), index = read(primitive.indices);
  // Connected parts (welding vertices that share a place).
  const parent = Int32Array.from({ length: position.length / 3 }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  for (let t = 0; t < index.length; t += 3) { const a = find(index[t]); parent[find(index[t + 1])] = a; parent[find(index[t + 2])] = a; }
  const seen = new Map();
  for (let i = 0; i < position.length / 3; i++) { const key = [0, 1, 2].map((c) => Math.round(position[i * 3 + c] * 1e4)).join(); if (seen.has(key)) parent[find(i)] = find(seen.get(key)); else seen.set(key, i); }
  const parts = new Map();
  for (let i = 0; i < position.length / 3; i++) { const root = find(i); if (!parts.has(root)) parts.set(root, []); parts.get(root).push(i); }
  return { position, normal, uv, index, parts: [...parts.values()], partOf: (i) => find(i) };
};
const tuners = mesh('polySurface35_Tuners_0'), strings = mesh('polySurface67_Strings1_0');
const at = (m, i) => [m.position[i * 3], m.position[i * 3 + 1], m.position[i * 3 + 2]];
const centre = (m, list) => [0, 1, 2].map((c) => list.reduce((sum, i) => sum + m.position[i * 3 + c], 0) / list.length);
const sub = (a, b) => a.map((v, k) => v - b[k]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };

// Posts: the part of each machine with the bushing and post (1129 vertices,
// the one nearest the face). The face's pitch from the posts: y against z.
const postParts = tuners.parts.filter((p) => p.length === 1129);
const posts = postParts.map((part) => ({ part, c: centre(tuners, part) }));
const fit = posts.reduce((s, p) => ({ z: s.z + p.c[2], y: s.y + p.c[1], zz: s.zz + p.c[2] ** 2, zy: s.zy + p.c[2] * p.c[1] }), { z: 0, y: 0, zz: 0, zy: 0 });
const slope = (posts.length * fit.zy - fit.z * fit.y) / (posts.length * fit.zz - fit.z ** 2);
// Along the face towards the tip, and out of it.
const along = unit([0, -slope, -1]), out = unit([0, 1, -slope]);
// Bass on −x (the guitar seen from the front, headstock up); the posts of a
// side counted from the nut.
for (const p of posts) { p.side = p.c[0] < 0 ? 'bass' : 'treble'; }
for (const side of ['bass', 'treble']) posts.filter((p) => p.side === side).sort((a, b) => b.c[2] - a.c[2]).forEach((p, k) => { p.k = k; });
// Each post's frame: the face under it (the bushing's lowest point along `out`).
for (const p of posts) {
  const low = Math.min(...p.part.map((i) => dot(sub(at(tuners, i), p.c), out)));
  p.origin = p.c.map((v, k) => v + out[k] * low);
  p.across = [p.side === 'bass' ? -1 : 1, 0, 0];
}
// The other parts of each machine: to the nearest post on the same side.
const machine = new Map(posts.map((p) => [p, []]));
for (const part of tuners.parts) {
  const c = centre(tuners, part);
  const near = posts.filter((p) => Math.sign(p.c[0]) === Math.sign(c[0])).reduce((best, p) => (Math.abs(p.c[2] - c[2]) < Math.abs(best.c[2] - c[2]) ? p : best));
  machine.get(near).push(...part);
}

// Scale: the Letov model is 6.83 site units long at fit.frame.scale per unit.
const frame = JSON.parse(await readFile('src/lib/guitarFit.json', 'utf8')).frame;
const zs = gltf.meshes.flatMap((m) => m.primitives.map((pr) => gltf.accessors[pr.attributes.POSITION])).flatMap((a) => [a.min[2], a.max[2]]);
const scale = 6.83 / frame.scale / (Math.max(...zs) - Math.min(...zs));
const local = (p, v) => { const d = sub(v, p.origin); return [dot(d, p.across) * scale, dot(d, out) * scale, dot(d, along) * scale]; };
const localDirection = (p, v) => [dot(v, p.across), dot(v, out), dot(v, along)];

// Windings: each string's triangles within .11 of its post's axis, the
// straight run to the nut (vertices more than .15 from the axis, within 35°
// of the way to the nut) marked for finding where it leaves the winding.
const toNut = [0, 0, 1];
const windings = new Map();
for (const part of strings.parts) {
  const head = part.filter((i) => at(strings, i)[2] < -11.2);
  const post = posts.reduce((best, p) => { const d = Math.min(...head.map((i) => Math.hypot(at(strings, i)[0] - p.c[0], at(strings, i)[2] - p.c[2]))); return d < best.d ? { p, d } : best; }, { d: Infinity }).p;
  const straight = (i) => {
    const d = sub(at(strings, i), post.c), radial = sub(d, out.map((v) => v * dot(d, out))), r = Math.hypot(...radial);
    return r > .15 && dot(radial, toNut) > r * Math.cos(35 * Math.PI / 180);
  };
  const axial = (i) => { const d = sub(at(strings, i), post.c); return Math.hypot(...sub(d, out.map((v) => v * dot(d, out)))); };
  const inPart = new Set(part);
  const kept = [], cut = new Set();
  for (let t = 0; t < strings.index.length; t += 3) {
    const tri = [strings.index[t], strings.index[t + 1], strings.index[t + 2]];
    if (!inPart.has(tri[0]) || !tri.every((i) => at(strings, i)[2] < -10.8)) continue;
    if (tri.some(straight)) { tri.forEach((i) => cut.add(i)); continue; }
    // Only what is wound on the post: the end sticking out is left out too.
    if (!tri.every((i) => axial(i) < .11)) continue;
    kept.push(...tri);
  }
  // Where the straight run leaves the winding: the vertices the two share,
  // or else the run's vertices nearest the post's axis.
  const keptSet = new Set(kept), radius = (i) => { const d = sub(at(strings, i), post.c); return Math.hypot(...sub(d, out.map((v) => v * dot(d, out)))); };
  let joint = [...cut].filter((i) => keptSet.has(i));
  if (!joint.length) { const nearest = Math.min(...[...cut].map(radius)); joint = [...cut].filter((i) => radius(i) < nearest + .02); }
  const anchor = local(post, centre(strings, joint));
  windings.set(post, { triangles: kept, anchor });
}

// ── GLB ──
const chunks = [], accessors = [], views = [], meshes = [], nodes = [];
let offset = 0;
const push = (array, target) => {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target }); chunks.push(bytes);
  offset += bytes.length; const pad = (4 - (offset % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  return views.length - 1;
};
const write = (name, m, triangles, p, extras) => {
  // Re-index the kept vertices.
  const map = new Map(), positions = [], normals = [], uvs = [], indices = [];
  for (const i of triangles) {
    if (!map.has(i)) { map.set(i, map.size); positions.push(...local(p, at(m, i))); normals.push(...localDirection(p, [m.normal[i * 3], m.normal[i * 3 + 1], m.normal[i * 3 + 2]])); uvs.push(m.uv[i * 2], m.uv[i * 2 + 1]); }
    indices.push(map.get(i));
  }
  const position = new Float32Array(positions), normal = new Float32Array(normals), index = map.size < 65536 ? new Uint16Array(indices) : new Uint32Array(indices);
  const min = [0, 1, 2].map((c) => Math.min(...positions.filter((_, k) => k % 3 === c))), max = [0, 1, 2].map((c) => Math.max(...positions.filter((_, k) => k % 3 === c)));
  accessors.push({ bufferView: push(position, 34962), componentType: 5126, count: map.size, type: 'VEC3', min, max });
  accessors.push({ bufferView: push(normal, 34962), componentType: 5126, count: map.size, type: 'VEC3' });
  accessors.push({ bufferView: push(new Float32Array(uvs), 34962), componentType: 5126, count: map.size, type: 'VEC2' });
  accessors.push({ bufferView: push(index, 34963), componentType: index instanceof Uint16Array ? 5123 : 5125, count: index.length, type: 'SCALAR' });
  const a = accessors.length;
  meshes.push({ name, primitives: [{ attributes: { POSITION: a - 4, NORMAL: a - 3, TEXCOORD_0: a - 2 }, indices: a - 1 }] });
  nodes.push({ name, mesh: meshes.length - 1, ...(extras ? { extras } : {}) });
};
for (const p of posts.sort((a, b) => (a.side === b.side ? a.k - b.k : a.side === 'bass' ? -1 : 1))) {
  const triangles = [], part = new Set(machine.get(p));
  for (let t = 0; t < tuners.index.length; t += 3) if (part.has(tuners.index[t])) triangles.push(tuners.index[t], tuners.index[t + 1], tuners.index[t + 2]);
  write(`tuner-${p.side}-${p.k}`, tuners, triangles, p);
  const w = windings.get(p);
  write(`winding-${p.side}-${p.k}`, strings, w.triangles, p, { anchor: w.anchor.map((v) => +v.toFixed(5)) });
  console.log(p.side, p.k, 'tuner tris', triangles.length / 3, 'winding tris', w.triangles.length / 3, 'anchor', w.anchor.map((v) => +v.toFixed(3)));
}
const binary = Buffer.concat(chunks);
const json = {
  asset: { version: '2.0', generator: 'scripts/build-tuners.mjs', extras: { title: 'Tuners from "Ovation Guitar"', author: gltf.asset.extras.author, license: gltf.asset.extras.license, source: gltf.asset.extras.source } },
  scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, accessors, bufferViews: views, buffers: [{ byteLength: binary.length }],
};
let text = Buffer.from(JSON.stringify(json)); text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + binary.length, 8);
const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
await writeFile('public/models/tuners.glb', Buffer.concat([header, chunk(0x4e4f534a, text), chunk(0x004e4942, binary)]));
console.log('scale', scale.toFixed(4), 'face pitch', (Math.atan(slope) * 180 / Math.PI).toFixed(1) + '°', 'bytes', binary.length);
