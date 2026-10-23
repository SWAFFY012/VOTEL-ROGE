import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fit from './guitarFit.json';

// The Letov guitar as one reusable model: the Sketchfab model of his Musima
// 1655 HV (Kirill_lewis, public/models/letov-guitar.glb) with the sharp front
// photograph on its top, the rear photograph over its whole back (body, neck,
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
    const meshes: THREE.Mesh[] = [];
    model.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
    meshes.forEach((mesh) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      owned.push(mesh.geometry, material); if (material.map) owned.push(material.map);
      // The model's own strings: replaced by the site's bendable ones.
      if (material.name === 'Material.003') { mesh.visible = false; return; }
      // The block inside the hollow body, seen through the f-holes: dark.
      if (material.name === 'Material.004') { mesh.material = own(new THREE.MeshStandardMaterial({ color: 0x0b0606, roughness: .9 })); return; }
      const body = material.name === 'Material.001', head = material.name === 'Material.002', neck = material.name === 'Material.005';
      if (!body && !head && !neck) return;
      // Split the textured mesh by material: 0 the model's own (dark lacquer on
      // the body), 1 the face (top photo, headstock face, fretboard), 2 the rear
      // photo, 3 the profile photo.
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const position = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
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
      const groups: number[][] = [[], [], [], []];
      for (let t = 0; t < position.count; t += 3) {
        const tri = [t, t + 1, t + 2];
        let face = 0, sideways = 0;
        tri.forEach((i) => { const n = facing(i); face += n.x / 3; sideways += Math.abs(n.z) / 3; });
        let target = 0;
        if (body && face > .5 && tri.every((i) => inside(i, fit.front.region))) {
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
        } else if (face < .5) {
          // The body's rim, with its binding: the profile photo.
          target = 3; tri.forEach(profile);
        }
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
      mesh.material = [body ? rim : material, head ? headMaterial : neck ? fretboard : frontMaterial, rearMaterial, sideMaterial];
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
