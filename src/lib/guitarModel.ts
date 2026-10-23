import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import fit from './guitarFit.json';

// The Letov guitar as one reusable model: the Sketchfab model of his Musima
// 1655 HV (Kirill_lewis, public/models/letov-guitar.glb) with the sharp front
// photograph on its top, the archival rear photograph on its back and the
// archive photo on the headstock face; the strings are the site's own, laid
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

// lit: the photographed top and back respond to scene lights as lacquered
// wood (clearcoat); without it they are a little softer, for the dark scroll scene.
export function createGuitar(renderer: THREE.WebGLRenderer, onFrontLoaded?: () => void, { lit = false } = {}): GuitarModel {
  const guitar = new THREE.Group();
  const owned: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(item: T) => { owned.push(item); return item; };
  let disposed = false;

  // Three photographs and the model: the front counts as loaded once all are in.
  let pending = 4;
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
  const backMaterial = lacquer(photo('/guitar-back.png'));
  const headMaterial = lacquer(photo('/letov-guitars.png'));
  const rim = own(new THREE.MeshPhysicalMaterial({ color: 0x1c0a0b, roughness: .42, clearcoat: 1, clearcoatRoughness: .18 }));

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
      // Fretboard and neck: the model's wood texture is too orange for rosewood.
      if (material.name === 'Material.005') material.color.setRGB(.5, .36, .3);
      // The block inside the hollow body, seen through the f-holes: dark.
      if (material.name === 'Material.004') { mesh.material = own(new THREE.MeshStandardMaterial({ color: 0x0b0606, roughness: .9 })); return; }
      const body = material.name === 'Material.001', head = material.name === 'Material.002';
      if (!body && !head) return;
      // Split the textured mesh: triangles on the top, back or headstock face
      // read the photographs, the rest (sides, inside) keeps the model texture.
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const position = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      const tex = (i: number) => [uv.getX(i) * fit.atlas.width, uv.getY(i) * fit.atlas.height];
      const inside = (i: number, [x0, y0, x1, y1]: number[]) => { const [x, y] = tex(i); return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
      const facing = (i: number) => normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize().x;
      const remap = (i: number, affine: Affine, [width, height]: number[]) => { const [tx, ty] = tex(i); const [x, y] = apply(affine, tx, ty); uv.setXY(i, x / width, y / height); };
      const groups: number[][] = [[], [], []];
      for (let t = 0; t < position.count; t += 3) {
        const tri = [t, t + 1, t + 2], face = tri.reduce((sum, i) => sum + facing(i), 0) / 3;
        let target = 0;
        if (body && face > .5 && tri.every((i) => inside(i, fit.front.region))) {
          target = 1; tri.forEach((i) => remap(i, fit.front.affine, fit.front.size));
        } else if (body && face < -.5 && tri.every((i) => inside(i, fit.back.region))) {
          target = 2; tri.forEach((i) => remap(i, fit.back.affine, fit.back.size));
        } else if (head && face > .5) {
          // Headstock face: straight projection of the archive photo, box to box.
          target = 1;
          const [z0, y0, z1, y1] = fit.headstock.scene, [px0, py0, px1, py1] = fit.headstock.photo;
          tri.forEach((i) => {
            point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
            uv.setXY(i, (px0 + (z1 - point.z) / (z1 - z0) * (px1 - px0)) / fit.headstock.size[0], (py0 + (y1 - point.y) / (y1 - y0) * (py1 - py0)) / fit.headstock.size[1]);
          });
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
      // Body sides: the dark lacquered rim of the real guitar (the model texture
      // only has the photo's background there).
      mesh.material = [body ? rim : material, head ? headMaterial : frontMaterial, backMaterial];
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
