import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import fit from './guitarFit.json';
import neckPhoto from './guitarNeck.json';
import { smoothGeometry, smoothLevel } from './smoothGeometry';
import { rebuildBody } from './bodyShell';

// The Letov guitar as one reusable model: the Sketchfab model of his Musima
// 1655 HV (Kirill_lewis, public/models/letov-guitar.glb), its facets rounded
// off (smoothGeometry), with the front photograph on its top, the rear photograph over its whole back (body, neck,
// headstock), the profile photograph on its sides and the face of the neck
// (headstock and fretboard) from a photo of Letov holding it (guitarNeck.json,
// scripts/build-neck-photo.mjs); the strings are the site's own, laid
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
// A 3×3 homography, row by row: model texture px → front photo px.
const perspective = (h: number[], x: number, y: number) => { const w = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
// The body is slimmer than the model's: its depth behind the top, scaled.
const BODY_DEPTH = .65;
// Radius of the rounded edges of the body, in the model's units: a third of
// its depth would make the rim one soft tube, like rubber.
const EDGE_RADIUS = .13;

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

// Old nickel, for the tuners and the strings wound on them: a colour map of
// dull patches of tarnish and fine scratches, and a roughness map that
// follows them (tarnish duller, rubbed edges and scratches brighter), so the
// metal is worn like the rest of the guitar instead of evenly polished.
function agedMetal(renderer: THREE.WebGLRenderer) {
  const size = 512, colour = document.createElement('canvas'), rough = document.createElement('canvas');
  colour.width = colour.height = rough.width = rough.height = size;
  const c = colour.getContext('2d')!, r = rough.getContext('2d')!;
  let seed = 23;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  c.fillStyle = '#b8b5ae'; c.fillRect(0, 0, size, size);
  r.fillStyle = '#6e6e6e'; r.fillRect(0, 0, size, size);
  // Tarnish: soft dark patches, warm, tiled across the edges.
  for (let i = 0; i < 140; i++) {
    const x = random() * size, y = random() * size, radius = 8 + random() * 46, strength = .12 + random() * .3;
    for (const [dx, dy] of [[0, 0], [-size, 0], [size, 0], [0, -size], [0, size]]) {
      const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
      g.addColorStop(0, `rgba(58,48,36,${strength})`); g.addColorStop(1, 'rgba(58,48,36,0)');
      c.fillStyle = g; c.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
      const h = r.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, radius);
      h.addColorStop(0, `rgba(205,205,205,${strength})`); h.addColorStop(1, 'rgba(205,205,205,0)');
      r.fillStyle = h; r.fillRect(x + dx - radius, y + dy - radius, radius * 2, radius * 2);
    }
  }
  // Scratches: short strokes every way, light in the colour, glossier.
  for (let i = 0; i < 900; i++) {
    const x = random() * size, y = random() * size, angle = random() * Math.PI, length = 4 + random() * 22;
    const light = random() < .7;
    c.strokeStyle = light ? `rgba(235,232,225,${.08 + random() * .18})` : `rgba(40,34,28,${.08 + random() * .15})`;
    r.strokeStyle = light ? `rgba(40,40,40,${.15 + random() * .25})` : `rgba(190,190,190,${.1 + random() * .2})`;
    c.lineWidth = r.lineWidth = .5 + random() * .9;
    for (const pen of [c, r]) { pen.beginPath(); pen.moveTo(x, y); pen.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); pen.stroke(); }
  }
  const texture = (canvas: HTMLCanvasElement, sRGB: boolean) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.flipY = false;
    if (sRGB) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return t;
  };
  return { map: texture(colour, true), roughnessMap: texture(rough, false) };
}

// The tuners: the six machines of "Ovation Guitar" by Duane's Mind
// (CC-BY-4.0, sketchfab.com/3d-models/ovation-guitar-f5bd8065de084cf297302ed676f4da71),
// with the string wound on each post and its end sticking out, cut out by
// scripts/build-tuners.mjs (public/models/tuners.glb, every part in the frame
// of its own post: x outwards, y out of the face, z towards the tip). Each
// is set on its post on the headstock's face, in the nickel silver of the
// hardware on the photos of Letov's guitar, its winding in the colour of the
// site's string. The model's own tuners and posts are hidden. Calls back with
// the point each string leaves its winding (model frame, thickest first).
function mountTuners(model: THREE.Object3D, head: THREE.Mesh, hide: THREE.Mesh[], materials: { metal: THREE.Material; string: (index: number) => THREE.Material }, own: <T extends { dispose: () => void }>(item: T) => T, done: (anchors: THREE.Vector3[]) => void) {
  hide.forEach((mesh) => { mesh.visible = false; });
  const v = new THREE.Vector3();
  const headPoints = Array.from({ length: head.geometry.attributes.position.count }, (_, i) => v.fromBufferAttribute(head.geometry.attributes.position, i).applyMatrix4(head.matrixWorld).clone());
  const faceAt = (y: number) => Math.max(...headPoints.filter((p) => Math.abs(p.y - y) < .12).map((p) => p.x));
  // The posts: where the strings start (guitarFit, site frame → model frame).
  const { scale, centre } = fit.frame;
  const posts = fit.strings.map((s) => new THREE.Vector3(centre[0] + s.post[2] / scale, centre[1] + s.post[1] / scale, centre[2] - s.post[0] / scale));
  // The headstock's pitch: its face's normal, and the way along it to the tip.
  const [low, high] = [Math.min(...posts.map((p) => p.y)), Math.max(...posts.map((p) => p.y))];
  const normal = new THREE.Vector3(high - low, faceAt(low) - faceAt(high), 0).normalize();
  const along = new THREE.Vector3(0, 0, 1).cross(normal);
  // The face right under each post, found by a ray through the headstock.
  const ray = new THREE.Raycaster();
  const faceUnder = (post: THREE.Vector3) => {
    ray.set(post.clone().addScaledVector(normal, 2), normal.clone().negate());
    return ray.intersectObject(head, false)[0]?.point ?? post.clone();
  };
  // Each post's frame; bass side (+z) and treble side counted from the nut.
  const frames = posts.map((post, index) => {
    const side = Math.sign(post.z - centre[2]);
    const k = posts.filter((p) => Math.sign(p.z - centre[2]) === side && p.y < post.y).length;
    const matrix = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, side), normal, along).setPosition(faceUnder(post));
    return { index, name: `${side > 0 ? 'bass' : 'treble'}-${k}`, matrix };
  });
  new GLTFLoader().load('/models/tuners.glb', (gltf) => {
    const anchors = posts.map((p) => p.clone());
    frames.forEach(({ index, name, matrix }) => {
      for (const kind of ['tuner', 'winding'] as const) {
        const part = gltf.scene.getObjectByName(`${kind}-${name}`) as THREE.Mesh | undefined;
        if (!part) continue;
        const mesh = new THREE.Mesh(own(part.geometry), kind === 'tuner' ? materials.metal : materials.string(index));
        // (On the treble side the frame is mirrored, like the parts drawn for it.)
        mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix);
        model.add(mesh);
        if (kind === 'winding' && part.userData.anchor) anchors[index] = new THREE.Vector3(...part.userData.anchor as [number, number, number]).applyMatrix4(matrix);
      }
    });
    done(anchors);
  });
}

// lit: the photographed top and back respond to scene lights as lacquered
// wood (clearcoat); without it they are a little softer, for the dark scroll scene.
export function createGuitar(renderer: THREE.WebGLRenderer, onFrontLoaded?: () => void, { lit = false } = {}): GuitarModel {
  const guitar = new THREE.Group();
  const owned: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(item: T) => { owned.push(item); return item; };
  let disposed = false;

  // Four photographs, the model and its tuners: the front counts as loaded once all are in.
  let pending = 6;
  const ready = () => { if (pending === 0 && !disposed) onFrontLoaded?.(); };
  const loader = new THREE.TextureLoader();
  const photo = (url: string) => {
    const texture = own(loader.load(url, () => { pending--; ready(); }));
    // glTF UVs run from the top of the image.
    texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 16);
    return texture;
  };
  // The front photo already carries the lacquer's own highlights: a calmer,
  // satin coat on top, or the room's window turns the whole top milky.
  const frontMaterial = own(new THREE.MeshPhysicalMaterial({ map: photo('/guitar-front-4k.webp'), roughness: .72, clearcoat: lit ? .35 : .25, clearcoatRoughness: .3 }));
  // The arched back catches the overhead lamp head-on: a softer, older lacquer
  // keeps that from burning out to white.
  const rearMaterial = own(new THREE.MeshPhysicalMaterial({ map: photo('/guitar-back-4k.webp'), roughness: .66, clearcoat: .3, clearcoatRoughness: .4 }));
  // The profile photo on the rim and the sides of neck and headstock.
  const sideMaterial = own(new THREE.MeshPhysicalMaterial({ map: photo('/guitar-side-4k.webp'), roughness: .6, clearcoat: .4, clearcoatRoughness: .35 }));
  // The face of the neck: headstock and fretboard, one photo.
  const neckFace = own(new THREE.MeshPhysicalMaterial({ map: photo('/guitar-neck.webp'), roughness: .62, clearcoat: .2, clearcoatRoughness: .45 }));
  const rim = own(new THREE.MeshPhysicalMaterial({ color: 0x1c0a0b, roughness: .42, clearcoat: 1, clearcoatRoughness: .18 }));
  // The rim is old, worn lacquer, nearly matt: a glossy coat mirrors the
  // window as a band running round the rounded edge, and the body looks
  // moulded from rubber.
  const rimSide = own(new THREE.MeshPhysicalMaterial({ map: own(rimTexture(renderer)), roughness: .88, specularIntensity: .45, envMapIntensity: .4 }));

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
  // Post → nut: a unit cylinder stretched between the two, laid again once
  // the tuners are on and each string leaves its winding.
  const lay = (mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
    const direction = b.clone().sub(a);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    mesh.scale.y = direction.length();
  };
  const leads: { mesh: THREE.Mesh; nut: THREE.Vector3 }[] = [];
  const strings: GuitarString[] = fit.strings.map((s, index) => {
    const [post, nut, saddle, tail] = [s.post, s.nut, s.saddle, s.tail].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const material = stringMaterial(index, nut.distanceTo(saddle));
    const { mesh, length } = segment(nut, saddle, radii[index], material, 96);
    const lead = new THREE.Mesh(own(new THREE.CylinderGeometry(radii[index], radii[index], 1, 8, 1, true)), material);
    lay(lead, post, nut); guitar.add(lead); leads.push({ mesh: lead, nut });
    segment(saddle, tail, radii[index], material);
    return { mesh, length, index };
  });
  // Metal looks real only by what it mirrors, and the rooms the guitar
  // stands in are dim: the tuners and windings mirror a lit studio of their
  // own (three's RoomEnvironment), faintly, through the worn finish of
  // agedMetal: dark old nickel, part of the guitar, not chrome.
  const pmrem = new THREE.PMREMGenerator(renderer), studio = new RoomEnvironment();
  const shine = own(pmrem.fromScene(studio, .02).texture);
  studio.dispose(); pmrem.dispose();
  const wear = agedMetal(renderer); own(wear.map); own(wear.roughnessMap);
  const metal = (color: number, roughness: number) => own(new THREE.MeshStandardMaterial({ color, metalness: .9, roughness, map: wear.map, roughnessMap: wear.roughnessMap, envMap: shine, envMapIntensity: .3, side: THREE.DoubleSide }));
  // Tuners in Letov's old nickel; the windings in the strings' colours, as worn.
  const silver = metal(0x8a8781, .75), wound = metal(0x9a8256, .7), plain = metal(0x8d9196, .65);

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
    const headMesh = named('Material.002'), tunerMesh = named('Material.008'), bodyMesh = named('Material.001');
    // Slimmer body: the body and the block inside it pressed towards the top's
    // plane, which stays where it is (strings, hardware and photo fit it).
    if (bodyMesh) {
      const position = bodyMesh.geometry.attributes.position, v = new THREE.Vector3();
      let top = -Infinity;
      for (let i = 0; i < position.count; i++) top = Math.max(top, v.fromBufferAttribute(position, i).applyMatrix4(bodyMesh.matrixWorld).x);
      for (const mesh of [bodyMesh, named('Material.004')]) {
        if (!mesh) continue;
        const points = mesh.geometry.attributes.position, inverse = mesh.matrixWorld.clone().invert();
        for (let i = 0; i < points.count; i++) {
          v.fromBufferAttribute(points, i).applyMatrix4(mesh.matrixWorld); v.x = top + (v.x - top) * BODY_DEPTH;
          v.applyMatrix4(inverse); points.setXYZ(i, v.x, v.y, v.z);
        }
        points.needsUpdate = true; mesh.geometry.computeBoundingSphere();
      }
    }
    // The model's own tuner posts: the metal (Material.007) up on the headstock.
    const headTop = headMesh && new THREE.Box3().setFromObject(headMesh);
    const headPosts = meshes.filter((mesh) => (mesh.material as THREE.Material).name === 'Material.007' && headTop && new THREE.Box3().setFromObject(mesh).min.y > headTop.min.y);
    if (headMesh && tunerMesh) mountTuners(model, headMesh, [tunerMesh, ...headPosts], { metal: silver, string: (index) => (index > 2 ? plain : wound) }, own, (anchors) => {
      pending--;
      // Each string now starts where it leaves its winding (model frame → site frame).
      anchors.forEach((a, index) => lay(leads[index].mesh, new THREE.Vector3(-(a.z - centre[2]) * scale, (a.y - centre[1]) * scale, (a.x - centre[0]) * scale), leads[index].nut));
      ready();
    });
    else pending--;
    meshes.forEach((mesh) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      owned.push(mesh.geometry, material); if (material.map) owned.push(material.map);
      // The model's own strings: replaced by the site's bendable ones.
      if (material.name === 'Material.003') { mesh.visible = false; return; }
      // Replaced by the tuners set on in mountTuners.
      if (!mesh.visible) return;
      // The model is low-poly: the body's outside is rebuilt smooth and round
      // (bodyShell), every other part has its facets rounded off.
      const original = mesh.geometry, triangles = (original.index ?? original.attributes.position).count / 3;
      mesh.geometry = own(material.name === 'Material.001'
        ? rebuildBody(original, mesh.matrixWorld, { radius: EDGE_RADIUS, rimRepeats: RIM_REPEATS })
        : smoothGeometry(original, mesh.matrixWorld, smoothLevel(triangles), { band: sideBand, round: .9 }));
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
          // The rim: its own texture, coordinates set by rebuildBody.
          target = 4;
        } else if (body && face > .5 && tri.every((i) => inside(i, fit.front.region))) {
          target = 1;
          tri.forEach((i) => { const [tx, ty] = tex(i); const [x, y] = perspective(fit.front.homography, tx, ty); uv.setXY(i, x / fit.front.size[0], y / fit.front.size[1]); });
        } else if ((head || neck) && face > .5 && !(neck && sideways > .5)) {
          // Headstock face and fretboard: the neck photo, seen from the front
          // in the site's frame (x across, y along the neck).
          target = 1;
          const [x0, y0, x1, y1] = neckPhoto.box;
          tri.forEach((i) => { const p = scene(i), x = -(p.z - centre[2]) * scale, y = (p.y - centre[1]) * scale; uv.setXY(i, (x - x0) / (x1 - x0), (y1 - y) / (y1 - y0)); });
        } else if ((neck || head) && sideways > .5) {
          // Sides of the neck and headstock: the profile photo.
          target = 3; tri.forEach(profile);
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
      mesh.material = [body ? rim : material, head || neck ? neckFace : frontMaterial, rearMaterial, sideMaterial, rimSide];
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
