import * as THREE from 'three';

// The body's outer shell, rebuilt smooth. The model's outline is a coarse
// polygon: smoothing or rounding on top of it keeps a kink at every corner.
// So the outside of the body (top, rim, back) is made anew from it:
//
//  - the outline of the top runs through a closed centripetal Catmull–Rom
//    curve, 720 points, lightly Taubin-smoothed (no kinks, no shrinking);
//  - along it a profile is swept: a quarter circle from the top down to the
//    rim, the rim, a quarter circle round to the back; its normals are the
//    circle's own, so the side is round in the light and in silhouette;
//  - the top and the back are flat caps inside that, the top keeping its
//    real openings (f-holes, knobs) exactly where the model has them.
//
// The front photo is looked up by place: every new point of the top (and of
// the top's half of the rounding) takes the model texture coordinate of the
// old top at the same spot, so the photo wraps over the edge instead of
// being stretched. The model's inside (inner faces of the hollow body, f-hole
// walls) is kept as it is. Result: non-indexed, in the mesh's own space,
// with position, normal, uv, `flat` (for sorting faces) and `rim` (1 on the
// rim, its uv = (around the body, top → back)). The model's frame: the top
// faces +x.
export function rebuildBody(source: THREE.BufferGeometry, matrix: THREE.Matrix4, { radius, rimRepeats }: { radius: number; rimRepeats: number }) {
  const geometry = source.index ? source.toNonIndexed() : source;
  const position = geometry.attributes.position, sourceUv = geometry.attributes.uv;
  const count = position.count;
  const points = Array.from({ length: count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix));
  let top = -Infinity, bottom = Infinity;
  for (const p of points) { top = Math.max(top, p.x); bottom = Math.min(bottom, p.x); }
  const depth = top - bottom;
  const faceNormal = (t: number) => new THREE.Vector3().subVectors(points[t + 1], points[t]).cross(new THREE.Vector3().subVectors(points[t + 2], points[t])).normalize();

  // The back: a plane x = a + b·y + c·z fitted to its outer faces.
  const sums = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0), rhs = new THREE.Vector3(), row = new THREE.Vector3();
  for (let t = 0; t < count; t += 3) {
    if (faceNormal(t).x > -.9 || Math.max(points[t].x, points[t + 1].x, points[t + 2].x) > top - depth / 2) continue;
    for (let k = 0; k < 3; k++) {
      const p = points[t + k]; row.set(1, p.y, p.z);
      const e = sums.elements;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e[j * 3 + i] += row.getComponent(i) * row.getComponent(j);
      rhs.addScaledVector(row, p.x);
    }
  }
  const plane = rhs.applyMatrix3(sums.invert());
  const backAt = (y: number, z: number) => plane.x + plane.y * y + plane.z * z;
  const backNormal = new THREE.Vector3(-1, plane.y, plane.z).normalize();

  // The model's outer top: facing up, on the top's plane.
  const kinds: ('top' | 'back' | 'rim' | 'inside')[] = [];
  for (let t = 0; t < count; t += 3) {
    const tri = [points[t], points[t + 1], points[t + 2]];
    kinds.push(faceNormal(t).x > .9 && tri.every((p) => top - p.x < 1e-3) ? 'top' : 'inside');
  }

  // The outer top's boundary: its outline (the largest loop) and its openings.
  const key = (p: THREE.Vector3) => `${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
  const where = new Map<string, THREE.Vector2>(), edges = new Map<string, string>(), reverse = new Set<string>();
  kinds.forEach((kind, f) => {
    if (kind !== 'top') return;
    for (let k = 0; k < 3; k++) {
      const a = points[f * 3 + k], b = points[f * 3 + (k + 1) % 3], ka = key(a), kb = key(b);
      where.set(ka, new THREE.Vector2(a.y, a.z)); where.set(kb, new THREE.Vector2(b.y, b.z));
      edges.set(ka + '>' + kb, kb); reverse.add(kb + '>' + ka);
    }
  });
  const next = new Map<string, string>();
  for (const [edge, to] of edges) if (!reverse.has(edge)) next.set(edge.split('>')[0], to);
  const loops: THREE.Vector2[][] = [], used = new Set<string>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: THREE.Vector2[] = [];
    for (let k: string | undefined = start; k && !used.has(k); k = next.get(k)) { used.add(k); loop.push(where.get(k)!); }
    if (loop.length >= 3) loops.push(loop);
  }
  const area = (loop: THREE.Vector2[]) => THREE.ShapeUtils.area(loop);
  loops.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const [outline, ...openings] = loops;
  // The rest of the outside, to be replaced: the back (facing back, in the
  // back half) and every side face standing on the outline (the inside of
  // the hollow body is a wall's thickness away from it).
  const fromOutline = (y: number, z: number) => {
    let best = Infinity;
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length], ey = b.x - a.x, ez = b.y - a.y, l = ey * ey + ez * ez;
      const t = l ? Math.min(1, Math.max(0, ((y - a.x) * ey + (z - a.y) * ez) / l)) : 0;
      best = Math.min(best, Math.hypot(y - a.x - ey * t, z - a.y - ez * t));
    });
    return best;
  };
  kinds.forEach((kind, f) => {
    if (kind !== 'inside') return;
    const t = f * 3, n = faceNormal(t), tri = [points[t], points[t + 1], points[t + 2]];
    if (n.x < -.5 && Math.max(...tri.map((p) => p.x)) < top - depth / 2) kinds[f] = 'back';
    else if (Math.abs(n.x) < .35 && tri.every((p) => fromOutline(p.y, p.z) < .01)) kinds[f] = 'rim';
  });

  // The smooth outline: spline, evenly spaced, Taubin-smoothed; counter-clockwise.
  const ring = (area(outline) < 0 ? outline.slice().reverse() : outline).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const SAMPLES = 720;
  const curve = new THREE.CatmullRomCurve3(ring, true, 'centripetal').getSpacedPoints(SAMPLES).slice(0, SAMPLES);
  const smooth = curve.map((p) => new THREE.Vector2(p.x, p.y));
  for (let pass = 0; pass < 24; pass++) for (const factor of [.5, -.53]) {
    const copy = smooth.map((p) => p.clone());
    smooth.forEach((p, i) => {
      const before = copy[(i + SAMPLES - 1) % SAMPLES], after = copy[(i + 1) % SAMPLES];
      p.x += factor * ((before.x + after.x) / 2 - p.x); p.y += factor * ((before.y + after.y) / 2 - p.y);
    });
  }
  // Outward normals (counter-clockwise: the outside is to the right of the way round).
  const outward = smooth.map((_, i) => {
    const before = smooth[(i + SAMPLES - 1) % SAMPLES], after = smooth[(i + 1) % SAMPLES];
    return new THREE.Vector2(after.y - before.y, -(after.x - before.x)).normalize();
  });
  const along = [0];
  for (let i = 1; i <= SAMPLES; i++) along.push(along[i - 1] + smooth[i % SAMPLES].distanceTo(smooth[i - 1]));
  const perimeter = along[SAMPLES];

  // Model texture coordinate at a place on the old top (barycentric; a point
  // just outside its polygon extrapolates from the nearest triangle).
  const topFaces = kinds.flatMap((kind, f) => (kind === 'top' ? [f] : []));
  const CELL = .3, grid = new Map<string, number[]>();
  topFaces.forEach((f) => {
    const tri = [points[f * 3], points[f * 3 + 1], points[f * 3 + 2]];
    const y0 = Math.floor(Math.min(...tri.map((p) => p.y)) / CELL), y1 = Math.floor(Math.max(...tri.map((p) => p.y)) / CELL);
    const z0 = Math.floor(Math.min(...tri.map((p) => p.z)) / CELL), z1 = Math.floor(Math.max(...tri.map((p) => p.z)) / CELL);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { const k = y + ',' + z; let list = grid.get(k); if (!list) grid.set(k, list = []); list.push(f); }
  });
  const weights = (f: number, y: number, z: number) => {
    const [a, b, c] = [points[f * 3], points[f * 3 + 1], points[f * 3 + 2]];
    const d = (b.y - a.y) * (c.z - a.z) - (c.y - a.y) * (b.z - a.z) || 1e-12;
    const w1 = ((y - a.y) * (c.z - a.z) - (c.y - a.y) * (z - a.z)) / d, w2 = ((b.y - a.y) * (z - a.z) - (y - a.y) * (b.z - a.z)) / d;
    return [1 - w1 - w2, w1, w2];
  };
  const uvAt = (y: number, z: number) => {
    let best = -1, bestScore = -Infinity, bestW = [0, 0, 0];
    const cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
    for (let ring = 0; ring <= 3 && bestScore < 0; ring++) {
      for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dy), Math.abs(dz)) !== ring) continue;
        for (const f of grid.get(cy + dy + ',' + (cz + dz)) ?? []) {
          const w = weights(f, y, z), score = Math.min(...w);
          if (score > bestScore) { best = f; bestScore = score; bestW = w; }
        }
      }
    }
    if (best < 0) return [0, 0];
    return [0, 1].map((c) => bestW.reduce((sum, w, k) => sum + w * sourceUv.getComponent(best * 3 + k, c), 0));
  };

  // ── Output ──
  const out = { position: [] as number[], normal: [] as number[], uv: [] as number[], flat: [] as number[], rim: [] as number[] };
  type Vertex = { p: THREE.Vector3; n: THREE.Vector3; uv: number[] };
  // One triangle, turned to face its normals' way, with one flat normal and rim mark.
  const triangle = (a: Vertex, b: Vertex, c: Vertex, flat: THREE.Vector3, rim: number) => {
    const facing = new THREE.Vector3().subVectors(b.p, a.p).cross(new THREE.Vector3().subVectors(c.p, a.p));
    const vertices = facing.dot(new THREE.Vector3().add(a.n).add(b.n).add(c.n)) < 0 ? [a, c, b] : [a, b, c];
    for (const v of vertices) { out.position.push(v.p.x, v.p.y, v.p.z); out.normal.push(v.n.x, v.n.y, v.n.z); out.uv.push(v.uv[0], v.uv[1]); out.flat.push(flat.x, flat.y, flat.z); out.rim.push(rim); }
  };
  const plusX = new THREE.Vector3(1, 0, 0);

  // The swept side: per outline point a profile of 26 points, top → back.
  const STEPS = 12;
  type Profile = { inset: number; lift: number; fromBack: boolean; nTop: number; nOut: number };
  const profile: Profile[] = [];
  for (let j = 0; j <= STEPS; j++) { const phi = j / STEPS * Math.PI / 2; profile.push({ inset: radius - radius * Math.sin(phi), lift: radius - radius * Math.cos(phi), fromBack: false, nTop: Math.cos(phi), nOut: Math.sin(phi) }); }
  for (let j = STEPS; j >= 0; j--) { const phi = j / STEPS * Math.PI / 2; profile.push({ inset: radius - radius * Math.sin(phi), lift: radius - radius * Math.cos(phi), fromBack: true, nTop: Math.cos(phi), nOut: Math.sin(phi) }); }
  // Segments 0–5 carry the front photo, 19–24 the rear photo, 6–18 the rim.
  const PHOTO = STEPS / 2, BACK_FROM = profile.length - 1 - STEPS / 2;
  const sweep = (i: number, j: number) => {
    const s = i % SAMPLES, o = outward[s], at = smooth[s], q = profile[j];
    const y = at.x - o.x * q.inset, z = at.y - o.y * q.inset;
    const x = q.fromBack ? backAt(y, z) + q.lift : top - q.lift;
    const n = (q.fromBack ? backNormal.clone() : plusX.clone()).multiplyScalar(q.nTop).add(new THREE.Vector3(0, o.x * q.nOut, o.y * q.nOut)).normalize();
    return { p: new THREE.Vector3(x, y, z), n };
  };
  // Rim texture v: by length along the rim's part of the profile.
  const rimLength = (i: number) => { let total = 0; const lengths = [0]; for (let j = PHOTO; j < BACK_FROM; j++) { total += sweep(i, j).p.distanceTo(sweep(i, j + 1).p); lengths.push(total); } return lengths.map((l) => l / total); };
  let rimV = rimLength(0);
  for (let i = 0; i < SAMPLES; i++) {
    const nextV = rimLength(i + 1);
    for (let j = 0; j < profile.length - 1; j++) {
      const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([si, sj]) => {
        const { p, n } = sweep(si, sj);
        let uv: number[];
        if (j < PHOTO) {
          // The top's half of the rounding: the photo from the strip it replaces,
          // from the cap's edge (inset = radius) out to the outline.
          const s = si % SAMPLES, o = outward[s], reach = radius * (1 - sj / PHOTO);
          uv = uvAt(smooth[s].x - o.x * reach, smooth[s].y - o.y * reach);
        } else if (j < BACK_FROM) uv = [along[si] / perimeter * rimRepeats, (si === i ? rimV : nextV)[sj - PHOTO]];
        else uv = [0, 0];
        return { p, n, uv };
      });
      const flat = j < PHOTO ? plusX : j >= BACK_FROM ? backNormal : new THREE.Vector3(0, outward[i].x, outward[i].y);
      const rim = j >= PHOTO && j < BACK_FROM ? 1 : 0;
      triangle(corners[0], corners[1], corners[2], flat, rim);
      triangle(corners[0], corners[2], corners[3], flat, rim);
    }
    rimV = nextV;
  }

  // The caps, inside the rounding: the top with its openings, the back plain.
  const inner = smooth.map((p, i) => new THREE.Vector2(p.x - outward[i].x * radius, p.y - outward[i].y * radius));
  const capTop = THREE.ShapeUtils.triangulateShape(inner, openings), all = [...inner, ...openings.flat()];
  for (const [a, b, c] of capTop) {
    const v = [a, b, c].map((k) => ({ p: new THREE.Vector3(top, all[k].x, all[k].y), n: plusX, uv: uvAt(all[k].x, all[k].y) }));
    triangle(v[0], v[1], v[2], plusX, 0);
  }
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(inner, [])) {
    const v = [a, b, c].map((k) => ({ p: new THREE.Vector3(backAt(inner[k].x, inner[k].y), inner[k].x, inner[k].y), n: backNormal, uv: [0, 0] }));
    triangle(v[0], v[1], v[2], backNormal, 0);
  }

  // The inside of the body, as the model has it.
  kinds.forEach((kind, f) => {
    if (kind !== 'inside') return;
    const n = faceNormal(f * 3);
    const v = [0, 1, 2].map((k) => ({ p: points[f * 3 + k], n, uv: [sourceUv.getX(f * 3 + k), sourceUv.getY(f * 3 + k)] }));
    for (const vertex of v) { out.position.push(vertex.p.x, vertex.p.y, vertex.p.z); out.normal.push(n.x, n.y, n.z); out.uv.push(vertex.uv[0], vertex.uv[1]); out.flat.push(n.x, n.y, n.z); out.rim.push(0); }
  });
  if (geometry !== source) geometry.dispose();

  // Back into the mesh's own space.
  const inverse = matrix.clone().invert(), toLocal = new THREE.Matrix3().setFromMatrix4(matrix).transpose(), v = new THREE.Vector3();
  for (let i = 0; i < out.position.length; i += 3) {
    v.fromArray(out.position, i).applyMatrix4(inverse).toArray(out.position, i);
    v.fromArray(out.normal, i).applyMatrix3(toLocal).normalize().toArray(out.normal, i);
    v.fromArray(out.flat, i).applyMatrix3(toLocal).normalize().toArray(out.flat, i);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  result.setAttribute('flat', new THREE.Float32BufferAttribute(out.flat, 3));
  result.setAttribute('rim', new THREE.Float32BufferAttribute(out.rim, 1));
  return result;
}
