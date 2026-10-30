import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import fit from './guitarFit.json';
import { smoothGeometry, smoothLevel } from './smoothGeometry';

// The Letov guitar as one reusable model: the Sketchfab model of his Musima
// 1655 HV (Kirill_lewis, public/models/letov-guitar.glb), its facets rounded
// off (smoothGeometry), with the front photograph on its top, the rear photograph over its whole back (body, neck,
// headstock), the profile photograph on its sides, the archive photo on the
// headstock face and a rosewood
// fretboard with dots between its frets; the strings are the site's own, laid
// exactly where the model's strings run, so a page can bend them. Used by the
// scroll scene on the landing page and by the release page.
// Fitting numbers come from scripts/build-guitar-model.mjs (guitarFit.json).

export type GuitarString = {
  // Vibrating length, nut to saddle: a cylinder along its local y axis,
  // centred on the string, with 96 segments so a page can bend it.
  mesh: THREE.Mesh;
  length: number;
  index: number;
};

export type GuitarModel = {
  group: THREE.Group;
  strings: GuitarString[];
  dispose: () => void;
};

type Affine = number[];
const apply = (m: Affine, x: number, y: number) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];

// Fretboard: dark rosewood with fine lengthwise grain and pearl dots between
// the model's own frets (3, 5, 7, 9, double 12, 15, 17, 19, 21). The canvas
// spans the fretboard's face box, nut at the top.
function rosewood(renderer: THREE.WebGLRenderer) {
  const width = 512, height = 4096, canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const pen = canvas.getContext('2d')!;
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  pen.fillStyle = '#2b1810'; pen.fillRect(0, 0, width, height);
  for (let i = 0; i < 900; i++) {
    const x = random() * width, tone = random();
    pen.strokeStyle = tone < .5 ? `rgba(18,9,6,${.25 + random() * .35})` : `rgba(${88 + random() * 40},${50 + random() * 22},${30 + random() * 14},${.12 + random() * .22})`;
    pen.lineWidth = .6 + random() * 2.4;
    pen.beginPath(); pen.moveTo(x, 0);
    for (let y = 0; y <= height; y += 256) pen.lineTo(x + Math.sin(y / 700 + i) * 3 + (random() - .5) * 2, y);
    pen.stroke();
  }
  // Pores: short dark dashes along the grain.
  for (let i = 0; i < 9000; i++) { pen.fillStyle = `rgba(10,5,3,${.25 + random() * .4})`; pen.fillRect(random() * width, random() * height, 1 + random() * 1.5, 4 + random() * 14); }
  const [z0, y0, z1, y1] = fit.fretboard.box, frets = [y1, ...fit.fretboard.frets];
  const sx = width / (z1 - z0), sy = height / (y1 - y0), radius = .052;
  const dot = (y: number, z: number) => {
    const cx = (z1 - z) * sx, cy = (y1 - y) * sy;
    const glow = pen.createRadialGradient(cx, cy, 0, cx, cy, radius * sx);
    glow.addColorStop(0, '#f4efe2'); glow.addColorStop(.75, '#ddd3bd'); glow.addColorStop(1, 'rgba(120,100,80,0)');
    pen.fillStyle = glow; pen.beginPath(); pen.ellipse(cx, cy, radius * sx, radius * sy, 0, 0, Math.PI * 2); pen.fill();
  };
  const middle = (z0 + z1) / 2, quarter = (z1 - z0) * .22;
  for (const fret of [3, 5, 7, 9, 12, 15, 17, 19, 21]) {
    if (fret >= frets.length) continue;
    const y = (frets[fret - 1] + frets[fret]) / 2;
    if (fret === 12) { dot(y, middle - quarter); dot(y, middle + quarter); } else dot(y, middle);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);
  return texture;
}

// The body's rim: dark aged lacquer between two cream bindings, unrolled
// along the outline (u around the body, v from the top's edge to the back's).
// Its own texture rather than a photo projected from the side, which smears
// wherever the rim turns to face up or down.
const RIM_REPEATS = 6;
function rimTexture(renderer: THREE.WebGLRenderer) {
  const width = 1024, height = 256, canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const pen = canvas.getContext('2d')!;
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lacquer = pen.createLinearGradient(0, 0, 0, height);
  lacquer.addColorStop(0, '#16090a'); lacquer.addColorStop(.5, '#3b0f10'); lacquer.addColorStop(1, '#16090a');
  pen.fillStyle = lacquer; pen.fillRect(0, 0, width, height);
  // Wear: faint lighter scuffs along the rim, tiled across the seam.
  for (let i = 0; i < 260; i++) {
    const x = random() * width, y = height * (.12 + random() * .76), w = 4 + random() * 40;
    pen.fillStyle = `rgba(${120 + random() * 60},${50 + random() * 30},${40 + random() * 20},${.04 + random() * .1})`;
    for (const shift of [0, -width, width]) pen.fillRect(x + shift, y, w, .6 + random() * 1.6);
  }
  // Bindings: cream, aged at the outer edge, with a black purfling line inside.
  const binding = (y0: number, y1: number) => {
    const g = pen.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, '#b9a27a'); g.addColorStop(.5, '#e2d3ae'); g.addColorStop(1, '#c8b48c');
    pen.fillStyle = g; pen.fillRect(0, y0, width, y1 - y0);
  };
  binding(0, height * .055); pen.fillStyle = '#0b0606'; pen.fillRect(0, height * .055, width, height * .02);
  binding(height * .945, height); pen.fillStyle = '#0b0606'; pen.fillRect(0, height * .925, width, height * .02);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);
  return texture;
}

// Marks the body's rim (side faces running from the top down to the back; the
// f-hole walls are only the top's thickness) and gives it the rim texture's
// coordinates: `rim` 1, uv = (around the body, top → back). Done before the
// mesh is smoothed, so the coordinates are carried onto every small triangle.
function markRim(source: THREE.BufferGeometry, matrix: THREE.Matrix4) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const position = geometry.attributes.position, count = position.count;
  const points = Array.from({ length: count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix));
  let top = -Infinity, bottom = Infinity, cy = 0, cz = 0;
  points.forEach((p) => { top = Math.max(top, p.x); bottom = Math.min(bottom, p.x); cy += p.y / count; cz += p.z / count; });
  const depth = top - bottom, rim = new Float32Array(count), uv = new Float32Array(count * 2);
  if (geometry.attributes.uv) uv.set(geometry.attributes.uv.array as Float32Array);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), rimPoints: number[] = [];
  for (let t = 0; t < count; t += 3) {
    const [p, q, r] = [points[t], points[t + 1], points[t + 2]];
    const n = a.subVectors(q, p).cross(b.subVectors(r, p)).normalize();
    const span = Math.max(p.x, q.x, r.x) - Math.min(p.x, q.x, r.x);
    if (Math.abs(n.x) < .35 && span > depth * .3) { rim[t] = rim[t + 1] = rim[t + 2] = 1; rimPoints.push(t, t + 1, t + 2); }
  }
  // v: from the top's edge to the back's edge right there (the rim is deeper
  // at the lower bout); u: the angle around the body's centre.
  const around = (p: THREE.Vector3) => (Math.atan2(p.y - cy, p.z - cz) / (2 * Math.PI) + .5) * RIM_REPEATS;
  for (let t = 0; t < rimPoints.length; t += 3) {
    const corners = [rimPoints[t], rimPoints[t + 1], rimPoints[t + 2]];
    const us = corners.map((i) => around(points[i]));
    // Across the seam of the angle, keep the triangle on one side.
    if (Math.max(...us) - Math.min(...us) > RIM_REPEATS / 2) us.forEach((u, k) => { if (u < RIM_REPEATS / 2) us[k] = u + RIM_REPEATS; });
    corners.forEach((i, k) => {
      let back = top;
      for (const j of rimPoints) if (points[j].x < back && Math.hypot(points[j].y - points[i].y, points[j].z - points[i].z) < .2) back = points[j].x;
      uv[i * 2] = us[k]; uv[i * 2 + 1] = back < top - depth * .2 ? Math.min(1, Math.max(0, (top - points[i].x) / (top - back))) : 0;
    });
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('rim', new THREE.BufferAttribute(rim, 1));
  return geometry;
}

// The tuners. In the model each shaft runs through the middle of the
// headstock's thickness, so the buttons stick straight out of its edges with
// nothing behind them. On the real guitar the machines sit on the back: a
// gear housing on the back face, its shaft running just behind the face out
// to the button. Each tuner (shaft and button) moves back behind the face,
// following the headstock's pitch, and gets its housing. All in the model's
// frame (top towards +x), before the meshes are smoothed.
function mountTuners(model: THREE.Object3D, head: THREE.Mesh, tuners: THREE.Mesh, material: THREE.Material, own: <T extends { dispose: () => void }>(item: T) => T) {
  const v = new THREE.Vector3();
  const points = (mesh: THREE.Mesh) => {
    const position = mesh.geometry.attributes.position;
    return Array.from({ length: position.count }, (_, i) => v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).clone());
  };
  const headPoints = points(head), tunerPoints = points(tuners);
  // The back face of the headstock at a height: its furthest point backwards.
  const backAt = (y: number) => headPoints.reduce((x, p) => (Math.abs(p.y - y) < .15 ? Math.min(x, p.x) : x), Infinity);
  // Rows of tuners: heights more than .2 apart.
  const heights = tunerPoints.map((p) => p.y).sort((a, b) => a - b);
  const rows: number[][] = [];
  heights.forEach((y) => { const row = rows[rows.length - 1]; if (row && y - row[row.length - 1] < .2) row.push(y); else rows.push([y]); });
  const centres = rows.map((row) => (row[0] + row[row.length - 1]) / 2);
  const rowOf = (y: number) => centres.reduce((best, c, i) => (Math.abs(c - y) < Math.abs(centres[best] - y) ? i : best), 0);
  // The back face's pitch, for laying the housings flat on it.
  const tilt = Math.atan2(backAt(centres[0]) - backAt(centres[centres.length - 1]), centres[centres.length - 1] - centres[0]);
  const shifts = centres.map((y, i) => {
    const xs = tunerPoints.filter((p) => rowOf(p.y) === i).map((p) => p.x);
    return backAt(y) - .085 - (Math.min(...xs) + Math.max(...xs)) / 2;
  });
  const position = tuners.geometry.attributes.position, inverse = tuners.matrixWorld.clone().invert();
  tunerPoints.forEach((p, i) => { p.x += shifts[rowOf(p.y)]; v.copy(p).applyMatrix4(inverse); position.setXYZ(i, v.x, v.y, v.z); });
  position.needsUpdate = true;
  tuners.geometry.computeBoundingSphere();
  // A housing where each shaft starts, on the edge of the headstock it serves.
  const middle = headPoints.reduce((sum, p) => sum + p.z, 0) / headPoints.length;
  const housing = own(new RoundedBoxGeometry(.11, .3, .3, 3, .03));
  centres.forEach((y, i) => {
    for (const side of [-1, 1]) {
      const zs = tunerPoints.filter((p) => rowOf(p.y) === i && Math.sign(p.z - middle) === side).map((p) => p.z);
      if (!zs.length) continue;
      const inner = side < 0 ? Math.max(...zs) : Math.min(...zs);
      const mesh = new THREE.Mesh(housing, material);
      mesh.position.set(backAt(y) - .045, y, inner - side * .1);
      mesh.rotation.z = tilt;
      model.add(mesh);
    }
  });
}

// lit: the photographed top and back respond to scene lights as lacquered
// wood (clearcoat); without it they are a little softer, for the dark scroll scene.
export function createGuitar(renderer: THREE.WebGLRenderer, onFrontLoaded?: () => void, { lit = false } = {}): GuitarModel {
  const guitar = new THREE.Group();
  const owned: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(item: T) => { owned.push(item); return item; };
  let disposed = false;

  // Four photographs and the model: the front counts as loaded once all are in.
  let pending = 5;
  const ready = () => { if (pending === 0 && !disposed) onFrontLoaded?.(); };
  const loader = new THREE.TextureLoader();
  const photo = (url: string) => {
    const texture = own(loader.load(url, () => { pending--; ready(); }));
    // glTF UVs run from the top of the image.
    texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);
    return texture;
  };
  const lacquer = (map: THREE.Texture) => own(new THREE.MeshPhysicalMaterial({ map, roughness: lit ? .48 : .55, clearcoat: lit ? 1 : .6, clearcoatRoughness: .14 }));
  const frontMaterial = lacquer(photo('/guitar-front-4k.webp'));
  // The arched back catches the overhead lamp head-on: a softer, older lacquer
  // keeps that from burning out to white.
  const rearMaterial = own(new THREE.MeshPhysicalMaterial({ map: photo('/guitar-back-4k.webp'), roughness: .66, clearcoat: .3, clearcoatRoughness: .4 }));
  // The profile photo on the rim and the sides of neck and headstock.
  const sideMaterial = own(new THREE.MeshPhysicalMaterial({ map: photo('/guitar-side-4k.webp'), roughness: .6, clearcoat: .4, clearcoatRoughness: .35 }));
  const headMaterial = lacquer(photo('/letov-guitars.png'));
  const rim = own(new THREE.MeshPhysicalMaterial({ color: 0x1c0a0b, roughness: .42, clearcoat: 1, clearcoatRoughness: .18 }));
  const rimSide = own(new THREE.MeshPhysicalMaterial({ map: own(rimTexture(renderer)), roughness: .5, clearcoat: .8, clearcoatRoughness: .22 }));
  const fretboard = own(new THREE.MeshStandardMaterial({ map: own(rosewood(renderer)), roughness: .62 }));

  // ── Strings: tuner post → nut → saddle → tailpiece, thickest first ──
  const radii = [.0039, .0035, .0031, .0027, .0024, .0022];
  const stripe = document.createElement('canvas'); stripe.width = 4; stripe.height = 8;
  const pen = stripe.getContext('2d')!;
  pen.fillStyle = '#fff'; pen.fillRect(0, 0, 4, 8); pen.fillStyle = '#555'; pen.fillRect(0, 5, 4, 3);
  const stringMaterial = (index: number, length: number) => {
    // Satin metal with a faint glow of its own: a fully metallic thin wire mirrors
    // the dark room and vanishes against the rosewood.
    if (index > 2) return own(new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: .7, roughness: .24, emissive: 0x5e636a, envMapIntensity: 1.4 }));
    const bump = own(new THREE.CanvasTexture(stripe));
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.repeat.set(1, length / .0042);
    return own(new THREE.MeshStandardMaterial({ color: 0xe0cc9c, metalness: .7, roughness: .3, emissive: 0x7d6a45, bumpMap: bump, bumpScale: .7, envMapIntensity: 1.3 }));
  };
  const up = new THREE.Vector3(0, 1, 0);
  const segment = (a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, heightSegments = 1) => {
    const direction = b.clone().sub(a), length = direction.length();
    const mesh = new THREE.Mesh(own(new THREE.CylinderGeometry(radius, radius, length, 8, heightSegments, true)), material);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    guitar.add(mesh);
    return { mesh, length };
  };
  const strings: GuitarString[] = fit.strings.map((s, index) => {
    const [post, nut, saddle, tail] = [s.post, s.nut, s.saddle, s.tail].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const material = stringMaterial(index, nut.distanceTo(saddle));
    const { mesh, length } = segment(nut, saddle, radii[index], material, 96);
    segment(post, nut, radii[index], material);
    segment(saddle, tail, radii[index], material);
    return { mesh, length, index };
  });

  // ── The model ──
  const { scale, centre } = fit.frame;
  // Model frame → site frame: its top faces +x and its bass side +z; the site
  // wants the top towards +z and the neck up +y, centred on the strings.
  const pivot = new THREE.Group();
  pivot.rotation.y = -Math.PI / 2; pivot.scale.setScalar(scale);
  guitar.add(pivot);
  new GLTFLoader().load('/models/letov-guitar.glb', (gltf) => {
    pending--;
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const normal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3(), point = new THREE.Vector3();
    // The top faces +x here: faces across it are the rim and the sides of neck and headstock.
    const sideBand = new THREE.Vector3(1, 0, 0);
    const meshes: THREE.Mesh[] = [];
    model.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
    const named = (name: string) => meshes.find((mesh) => (mesh.material as THREE.Material).name === name);
    const headMesh = named('Material.002'), tunerMesh = named('Material.008');
    if (headMesh && tunerMesh) mountTuners(model, headMesh, tunerMesh, own(new THREE.MeshStandardMaterial({ color: 0x8e887d, metalness: .85, roughness: .36 })), own);
    meshes.forEach((mesh) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      owned.push(mesh.geometry, material); if (material.map) owned.push(material.map);
      // The model's own strings: replaced by the site's bendable ones.
      if (material.name === 'Material.003') { mesh.visible = false; return; }
      // The model is low-poly: round its facets off before anything is fitted.
      const original = mesh.geometry, isBody = material.name === 'Material.001';
      const prepared = isBody ? markRim(original, mesh.matrixWorld) : original;
      mesh.geometry = own(smoothGeometry(prepared, mesh.matrixWorld, smoothLevel((original.index ?? original.attributes.position).count / 3), { band: sideBand, round: .9 }));
      if (prepared !== original) prepared.dispose();
      original.dispose();
      // The block inside the hollow body, seen through the f-holes: dark.
      if (material.name === 'Material.004') { mesh.material = own(new THREE.MeshStandardMaterial({ color: 0x0b0606, roughness: .9 })); return; }
      const body = material.name === 'Material.001', head = material.name === 'Material.002', neck = material.name === 'Material.005';
      if (!body && !head && !neck) return;
      // Split the textured mesh by material: 0 the model's own (dark lacquer on
      // the body), 1 the face (top photo, headstock face, fretboard), 2 the rear
      // photo, 3 the profile photo, 4 the body's rim. Faces are sorted by the
      // flat normal of the model's own triangle: the smoothed normals lean
      // round the edges and would pull the rim's edges onto the top and back.
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const position = geometry.attributes.position, normals = geometry.attributes.flat, uv = geometry.attributes.uv, rimMark = geometry.attributes.rim;
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      const tex = (i: number) => [uv.getX(i) * fit.atlas.width, uv.getY(i) * fit.atlas.height];
      const inside = (i: number, [x0, y0, x1, y1]: number[]) => { const [x, y] = tex(i); return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
      const facing = (i: number) => normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
      const scene = (i: number) => point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      // Flat projection of the rear photo from the model's (z, y), seen from behind.
      const project = (i: number, m: Affine, [width, height]: number[]) => { const p = scene(i); const [x, y] = apply(m, p.z, p.y); uv.setXY(i, x / width, y / height); };
      const rearFit = body ? fit.rear.body : neck ? fit.rear.neck : fit.rear.head;
      // And the profile photo from the model's (x, y), seen from the side.
      const sideFit = body ? fit.side.body : neck ? fit.side.neck : fit.side.head;
      const profile = (i: number) => { const p = scene(i); uv.setXY(i, (sideFit[0] * p.x + sideFit[2]) / fit.side.size[0], (sideFit[4] * p.y + sideFit[5]) / fit.side.size[1]); };
      const groups: number[][] = [[], [], [], [], []];
      for (let t = 0; t < position.count; t += 3) {
        const tri = [t, t + 1, t + 2];
        let face = 0, sideways = 0;
        tri.forEach((i) => { const n = facing(i); face += n.x / 3; sideways += Math.abs(n.z) / 3; });
        let target = 0;
        if (body && rimMark?.getX(t) === 1) {
          // The rim: its own texture, coordinates set by markRim.
          target = 4;
        } else if (body && face > .5 && tri.every((i) => inside(i, fit.front.region))) {
          target = 1;
          tri.forEach((i) => { const [tx, ty] = tex(i); const [x, y] = apply(fit.front.affine, tx, ty); uv.setXY(i, x / fit.front.size[0], y / fit.front.size[1]); });
        } else if (head && face > .5) {
          // Headstock face: the archive photo, box to box.
          target = 1;
          const [z0, y0, z1, y1] = fit.headstock.scene, [px0, py0, px1, py1] = fit.headstock.photo;
          tri.forEach((i) => { const p = scene(i); uv.setXY(i, (px0 + (z1 - p.z) / (z1 - z0) * (px1 - px0)) / fit.headstock.size[0], (py0 + (y1 - p.y) / (y1 - y0) * (py1 - py0)) / fit.headstock.size[1]); });
        } else if ((neck || head) && sideways > .5) {
          // Sides of the neck and headstock: the profile photo.
          target = 3; tri.forEach(profile);
        } else if (neck && face > .5) {
          // Fretboard: the rosewood texture, nut at its top.
          target = 1;
          const [z0, y0, z1, y1] = fit.fretboard.box;
          tri.forEach((i) => { const p = scene(i); uv.setXY(i, (z1 - p.z) / (z1 - z0), (y1 - p.y) / (y1 - y0)); });
        } else if (!body || face < -.2) {
          // Back of the body, neck and headstock.
          target = 2; tri.forEach((i) => project(i, rearFit, fit.rear.size));
        }
        // Anything else on the body facing sideways (the f-hole walls, the
        // neck pocket) stays dark lacquer.
        groups[target].push(t);
      }
      // Rebuild the attributes grouped by material.
      const order = groups.flat();
      const grouped = own(new THREE.BufferGeometry());
      for (const name of ['position', 'normal', 'uv'] as const) {
        const source = geometry.attributes[name], size = source.itemSize, data = new Float32Array(order.length * 3 * size);
        order.forEach((t, k) => { for (let v = 0; v < 3; v++) for (let c = 0; c < size; c++) data[(k * 3 + v) * size + c] = source.array[(t + v) * size + c]; });
        grouped.setAttribute(name, new THREE.BufferAttribute(data, size));
      }
      let start = 0;
      groups.forEach((list, index) => { grouped.addGroup(start, list.length * 3, index); start += list.length * 3; });
      if (geometry !== mesh.geometry) geometry.dispose();
      mesh.geometry = grouped;
      // Leftovers on the body (inside the f-holes) stay dark lacquer: the model
      // texture only has the photo's background there.
      mesh.material = [body ? rim : material, head ? headMaterial : neck ? fretboard : frontMaterial, rearMaterial, sideMaterial, rimSide];
    });
    model.position.set(-centre[0], -centre[1], -centre[2]);
    if (disposed) return;
    pivot.add(model);
    ready();
  });

  return {
    group: guitar,
    strings,
    dispose: () => { disposed = true; owned.forEach((item) => item.dispose()); },
  };
}
