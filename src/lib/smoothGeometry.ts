import * as THREE from 'three';

// Curved PN triangles (Vlachos et al., 2001) for a low-poly model: every
// triangle is split into level² small ones lying on a cubic patch through its
// corners, bent by smoothed vertex normals. The original vertices stay where
// they are, so photos fitted to the model and the strings laid on it keep
// their places; only the facets between the vertices round off.
//
// Normals are averaged over faces that meet at less than `crease` degrees, so
// the real edges (top against rim, fretboard against the neck's sides) stay
// crisp in the light. Faces of the side band (normals across `band`, the
// direction the top faces: the rim, the sides of neck and headstock) always
// blend into each other, however sharply the outline turns between them.
// An edge whose two sides disagree on its normals (a crease, or the edge of
// the mesh) cannot bend by normals without opening a crack; it bends along
// its own line instead: a spline through its neighbours on that crease, the
// same for the triangles on both sides. So the outline of the top is a smooth
// curve too, not the model's polygon.
//
// The band is also rounded into its neighbours: a side face's normals lean
// towards the top or back it meets (by `round`, 0–1), so the light rolls over
// the edge instead of breaking on it, while the top itself stays flat.
//
// `matrix` is the mesh's transform: angles and curves are measured in the
// scene's proportions (the model's nodes scale unevenly), and the result is
// returned in the mesh's own space, non-indexed, with position, normal, every
// other attribute of the source interpolated (uv…), and `flat`: the normal of
// the original triangle each small one came from, for sorting faces.
export function smoothGeometry(source: THREE.BufferGeometry, matrix: THREE.Matrix4, level: number, { crease = 65, band, round = 0 }: { crease?: number; band?: THREE.Vector3; round?: number } = {}) {
  const geometry = source.index ? source.toNonIndexed() : source;
  const position = geometry.attributes.position;
  const extra = Object.entries(geometry.attributes).filter(([name]) => name !== 'position' && name !== 'normal') as [string, THREE.BufferAttribute][];
  const count = position.count, triangles = count / 3;
  // Positions in scene proportions.
  const p = new Float32Array(count * 3), v = new THREE.Vector3();
  for (let i = 0; i < count; i++) { v.fromBufferAttribute(position, i).applyMatrix4(matrix); p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z; }
  // Welded position keys (UV seams split vertices that share a place).
  let size = 0;
  for (let i = 0; i < count * 3; i++) size = Math.max(size, Math.abs(p[i]));
  const step = Math.max(size, 1e-6) * 1e-5;
  const key = (i: number) => `${Math.round(p[i * 3] / step)},${Math.round(p[i * 3 + 1] / step)},${Math.round(p[i * 3 + 2] / step)}`;
  const keys = Array.from({ length: count }, (_, i) => key(i));

  // Area-weighted face normals, and the faces around each welded vertex.
  const face = new Float32Array(triangles * 3), area = new Float32Array(triangles);
  const around = new Map<string, number[]>();
  for (let t = 0; t < triangles; t++) {
    const a = t * 9, ux = p[a + 3] - p[a], uy = p[a + 4] - p[a + 1], uz = p[a + 5] - p[a + 2];
    const wx = p[a + 6] - p[a], wy = p[a + 7] - p[a + 1], wz = p[a + 8] - p[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, length = Math.hypot(nx, ny, nz);
    area[t] = length;
    if (length > 0) { face[t * 3] = nx / length; face[t * 3 + 1] = ny / length; face[t * 3 + 2] = nz / length; }
    for (let c = 0; c < 3; c++) { const k = keys[t * 3 + c]; let list = around.get(k); if (!list) around.set(k, list = []); list.push(t); }
  }
  // Corner normals: the faces at this vertex within the crease angle of this
  // face, or both in the side band (and not back to back).
  const limit = Math.cos(crease * Math.PI / 180), n = new Float32Array(count * 3);
  const across = (t: number) => band ? Math.abs(face[t * 3] * band.x + face[t * 3 + 1] * band.y + face[t * 3 + 2] * band.z) : 1;
  for (let i = 0; i < count; i++) {
    const t = Math.floor(i / 3), side = across(t) < .35;
    let x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0;
    for (const other of around.get(keys[i])!) {
      const cos = face[t * 3] * face[other * 3] + face[t * 3 + 1] * face[other * 3 + 1] + face[t * 3 + 2] * face[other * 3 + 2];
      const w = area[other];
      if (cos >= limit || (side && across(other) < .35 && cos > -.2)) { x += face[other * 3] * w; y += face[other * 3 + 1] * w; z += face[other * 3 + 2] * w; }
      // The top or back this side face runs into, for rounding the edge.
      else if (side && round > 0 && cos > -.2) { rx += face[other * 3] * w; ry += face[other * 3 + 1] * w; rz += face[other * 3 + 2] * w; }
    }
    let length = Math.hypot(x, y, z) || 1;
    x /= length; y /= length; z /= length;
    const lean = Math.hypot(rx, ry, rz);
    if (lean > 0) { x += rx / lean * round; y += ry / lean * round; z += rz / lean * round; length = Math.hypot(x, y, z) || 1; x /= length; y /= length; z /= length; }
    n[i * 3] = x; n[i * 3 + 1] = y; n[i * 3 + 2] = z;
  }
  // An edge may curve only if every triangle on it has the same normals at its ends.
  const edges = new Map<string, number[]>();
  const edgeKey = (i: number, j: number) => (keys[i] < keys[j] ? keys[i] + '|' + keys[j] : keys[j] + '|' + keys[i]);
  for (let t = 0; t < triangles; t++) for (let c = 0; c < 3; c++) {
    const k = edgeKey(t * 3 + c, t * 3 + (c + 1) % 3); let list = edges.get(k); if (!list) edges.set(k, list = []); list.push(t * 3 + c);
  }
  const same = (i: number, j: number) => n[i * 3] * n[j * 3] + n[i * 3 + 1] * n[j * 3 + 1] + n[i * 3 + 2] * n[j * 3 + 2] > .9995;
  // Corner of a triangle at the same welded position.
  const corner = (start: number, k: string) => { for (let c = 0; c < 3; c++) if (keys[start - start % 3 + c] === k) return start - start % 3 + c; return start; };
  const curved = (i: number, j: number) => {
    const list = edges.get(edgeKey(i, j))!;
    return list.length > 1 && list.every((e) => same(corner(e, keys[i]), i) && same(corner(e, keys[j]), j));
  };
  // Creases and mesh edges as lines: each welded vertex's neighbours along them.
  const lines = new Map<string, Set<string>>(), at = new Map<string, number>();
  keys.forEach((k, i) => { if (!at.has(k)) at.set(k, i); });
  for (let t = 0; t < triangles; t++) for (let c = 0; c < 3; c++) {
    const i = t * 3 + c, j = t * 3 + (c + 1) % 3;
    if (keys[i] === keys[j] || curved(i, j)) continue;
    for (const [a, b] of [[keys[i], keys[j]], [keys[j], keys[i]]]) { let set = lines.get(a); if (!set) lines.set(a, set = new Set()); set.add(b); }
  }
  // Bézier control near a on the crease a → b: the tangent at a runs from its
  // other neighbour on the line towards b (Catmull–Rom, weighted by the
  // lengths). A corner, a fork or a line's end keeps the straight third.
  const spline = (a: number, b: number, slot: number) => {
    const ka = keys[a], neighbours = lines.get(ka);
    let previous = -1;
    if (neighbours?.size === 2 && neighbours.has(keys[b])) for (const k of neighbours) if (k !== keys[b]) previous = at.get(k)!;
    let l1 = 0, l2 = 0, turn = -1;
    if (previous >= 0) {
      let dot = 0;
      for (let c = 0; c < 3; c++) { const d1 = p[a * 3 + c] - p[previous * 3 + c], d2 = p[b * 3 + c] - p[a * 3 + c]; l1 += d1 * d1; l2 += d2 * d2; dot += d1 * d2; }
      l1 = Math.sqrt(l1); l2 = Math.sqrt(l2); turn = l1 && l2 ? dot / (l1 * l2) : -1;
    }
    for (let c = 0; c < 3; c++) control[slot * 3 + c] = turn > 0
      ? p[a * 3 + c] + (p[b * 3 + c] - p[previous * 3 + c]) * l2 / (l1 + l2) / 3
      : (2 * p[a * 3 + c] + p[b * 3 + c]) / 3;
  };

  const level2 = level * level, out = triangles * level2 * 3;
  const outPosition = new Float32Array(out * 3), outNormal = new Float32Array(out * 3), outFlat = new Float32Array(out * 3);
  const outExtra = extra.map(([, attribute]) => new Float32Array(out * attribute.itemSize));
  const inverse = new THREE.Matrix4().copy(matrix).invert();
  // Normals go back through the transpose of the forward linear part.
  const back = new THREE.Matrix3().setFromMatrix4(matrix).transpose();
  const grid = (level + 1) * (level + 2) / 2;
  const gp = new Float32Array(grid * 3), gn = new Float32Array(grid * 3), ge = extra.map(([, attribute]) => new Float32Array(grid * attribute.itemSize));
  const index = (i: number, j: number) => { let k = 0; for (let r = 0; r < i; r++) k += level + 1 - r; return k + j; };
  const control = new Float32Array(30), normal = new THREE.Vector3(), flat = new THREE.Vector3();
  let o = 0;
  for (let t = 0; t < triangles; t++) {
    const i1 = t * 3, i2 = i1 + 1, i3 = i1 + 2;
    flat.set(face[t * 3], face[t * 3 + 1], face[t * 3 + 2]).applyMatrix3(back).normalize();
    // Edge control point near `a` on the edge a → b: pulled into a's tangent
    // plane where the normals agree, along the crease line where they do not.
    const edge = (a: number, b: number, bend: boolean, slot: number) => {
      if (!bend) { spline(a, b, slot); return; }
      const w = (p[b * 3] - p[a * 3]) * n[a * 3] + (p[b * 3 + 1] - p[a * 3 + 1]) * n[a * 3 + 1] + (p[b * 3 + 2] - p[a * 3 + 2]) * n[a * 3 + 2];
      for (let c = 0; c < 3; c++) control[slot * 3 + c] = (2 * p[a * 3 + c] + p[b * 3 + c] - w * n[a * 3 + c]) / 3;
    };
    const e12 = curved(i1, i2), e23 = curved(i2, i3), e31 = curved(i3, i1);
    edge(i1, i2, e12, 0); edge(i2, i1, e12, 1); edge(i2, i3, e23, 2); edge(i3, i2, e23, 3); edge(i3, i1, e31, 4); edge(i1, i3, e31, 5);
    // Slots: 0 b210, 1 b120, 2 b021, 3 b012, 4 b102, 5 b201, 6 b111.
    for (let c = 0; c < 3; c++) {
      const e = (control[c] + control[3 + c] + control[6 + c] + control[9 + c] + control[12 + c] + control[15 + c]) / 6;
      const m = (p[i1 * 3 + c] + p[i2 * 3 + c] + p[i3 * 3 + c]) / 3;
      control[18 + c] = e + (e - m) / 2;
    }
    for (let i = 0; i <= level; i++) for (let j = 0; i + j <= level; j++) {
      const b = i / level, c = j / level, a = 1 - b - c, g = index(i, j);
      for (let k = 0; k < 3; k++) {
        gp[g * 3 + k] = p[i1 * 3 + k] * a * a * a + p[i2 * 3 + k] * b * b * b + p[i3 * 3 + k] * c * c * c
          + 3 * control[k] * a * a * b + 3 * control[3 + k] * a * b * b + 3 * control[6 + k] * b * b * c
          + 3 * control[9 + k] * b * c * c + 3 * control[12 + k] * a * c * c + 3 * control[15 + k] * a * a * c
          + 6 * control[18 + k] * a * b * c;
        gn[g * 3 + k] = n[i1 * 3 + k] * a + n[i2 * 3 + k] * b + n[i3 * 3 + k] * c;
      }
      extra.forEach(([, attribute], e) => {
        const size = attribute.itemSize;
        for (let k = 0; k < size; k++) ge[e][g * size + k] = attribute.getComponent(i1, k) * a + attribute.getComponent(i2, k) * b + attribute.getComponent(i3, k) * c;
      });
    }
    const emit = (g: number) => {
      v.set(gp[g * 3], gp[g * 3 + 1], gp[g * 3 + 2]).applyMatrix4(inverse);
      outPosition[o * 3] = v.x; outPosition[o * 3 + 1] = v.y; outPosition[o * 3 + 2] = v.z;
      normal.set(gn[g * 3], gn[g * 3 + 1], gn[g * 3 + 2]).applyMatrix3(back).normalize();
      outNormal[o * 3] = normal.x; outNormal[o * 3 + 1] = normal.y; outNormal[o * 3 + 2] = normal.z;
      outFlat[o * 3] = flat.x; outFlat[o * 3 + 1] = flat.y; outFlat[o * 3 + 2] = flat.z;
      extra.forEach(([, attribute], e) => { const size = attribute.itemSize; for (let k = 0; k < size; k++) outExtra[e][o * size + k] = ge[e][g * size + k]; });
      o++;
    };
    for (let i = 0; i < level; i++) for (let j = 0; i + j < level; j++) {
      emit(index(i, j)); emit(index(i + 1, j)); emit(index(i, j + 1));
      if (i + j < level - 1) { emit(index(i + 1, j)); emit(index(i + 1, j + 1)); emit(index(i, j + 1)); }
    }
  }
  if (geometry !== source) geometry.dispose();
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(outPosition, 3));
  result.setAttribute('normal', new THREE.BufferAttribute(outNormal, 3));
  result.setAttribute('flat', new THREE.BufferAttribute(outFlat, 3));
  extra.forEach(([name, attribute], e) => result.setAttribute(name, new THREE.BufferAttribute(outExtra[e], attribute.itemSize)));
  return result;
}

// Subdivision level for a mesh: about 24k triangles each, 1–8 steps.
export const smoothLevel = (triangles: number) => Math.max(1, Math.min(8, Math.round(Math.sqrt(24000 / Math.max(1, triangles)))));
