import { BufferAttribute, BufferGeometry, Vector3 } from 'three';

/**
 * Convex polyhedra as polygon soup, plus the two operations the whole crystal
 * look is built from: clipping by a plane and Voronoi decomposition.
 *
 * Every body part in the game is authored as one of these. The intact mesh and
 * its fracture pattern are generated from the SAME polyhedron, so when a figure
 * shatters the shards are exactly the pieces of the shape that was standing
 * there — no pop, no swap to a different model.
 */

export interface Face {
  pts: Vector3[];
  /** True for faces created by a cut (the inside of the crystal). */
  interior: boolean;
}

export type Poly = Face[];

const EPS = 1e-6;

export function polyCentroid(poly: Poly): Vector3 {
  const c = new Vector3();
  let n = 0;
  for (const f of poly) {
    for (const p of f.pts) {
      c.add(p);
      n++;
    }
  }
  return n > 0 ? c.multiplyScalar(1 / n) : c;
}

function faceNormal(pts: Vector3[], out = new Vector3()): Vector3 {
  // Newell's method — robust for slightly non-planar / near-degenerate polygons.
  out.set(0, 0, 0);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.x += (a.y - b.y) * (a.z + b.z);
    out.y += (a.z - b.z) * (a.x + b.x);
    out.z += (a.x - b.x) * (a.y + b.y);
  }
  return out.normalize();
}

/** Make every face wind counter-clockwise when seen from outside. */
function orient(poly: Poly): Poly {
  const c = polyCentroid(poly);
  const n = new Vector3();
  const fc = new Vector3();
  for (const f of poly) {
    faceNormal(f.pts, n);
    fc.set(0, 0, 0);
    for (const p of f.pts) fc.add(p);
    fc.multiplyScalar(1 / f.pts.length).sub(c);
    if (n.dot(fc) < 0) f.pts.reverse();
  }
  return poly;
}

/**
 * A convex solid of revolution with `n` flat sides. `profile` lists [y, radius]
 * rings from bottom to top; a radius of 0 closes the shape to a point. `sx`/`sz`
 * squash the cross-section. The profile must be convex.
 */
export function lathe(n: number, profile: Array<[number, number]>, sx = 1, sz = 1, phase = 0): Poly {
  const rings: Vector3[][] = profile.map(([y, r]) => {
    if (r <= EPS) return [new Vector3(0, y, 0)];
    const ring: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2;
      ring.push(new Vector3(Math.cos(a) * r * sx, y, Math.sin(a) * r * sz));
    }
    return ring;
  });
  const poly: Poly = [];
  for (let k = 0; k < rings.length - 1; k++) {
    const lo = rings[k];
    const hi = rings[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pts: Vector3[] = [];
      if (lo.length > 1) pts.push(lo[i].clone(), lo[j].clone());
      else pts.push(lo[0].clone());
      if (hi.length > 1) pts.push(hi[j].clone(), hi[i].clone());
      else pts.push(hi[0].clone());
      if (pts.length >= 3) poly.push({ pts, interior: false });
    }
  }
  const first = rings[0];
  const last = rings[rings.length - 1];
  if (first.length > 1) poly.push({ pts: first.map((p) => p.clone()), interior: false });
  if (last.length > 1) poly.push({ pts: last.map((p) => p.clone()), interior: false });
  return orient(poly);
}

/** Axis-aligned box centred on the origin. */
export function boxPoly(w: number, h: number, d: number): Poly {
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  const v = (a: number, b: number, c: number) => new Vector3(a, b, c);
  return orient([
    { pts: [v(-x, -y, -z), v(x, -y, -z), v(x, y, -z), v(-x, y, -z)], interior: false },
    { pts: [v(-x, -y, z), v(x, -y, z), v(x, y, z), v(-x, y, z)], interior: false },
    { pts: [v(-x, -y, -z), v(-x, -y, z), v(-x, y, z), v(-x, y, -z)], interior: false },
    { pts: [v(x, -y, -z), v(x, -y, z), v(x, y, z), v(x, y, -z)], interior: false },
    { pts: [v(-x, -y, -z), v(x, -y, -z), v(x, -y, z), v(-x, -y, z)], interior: false },
    { pts: [v(-x, y, -z), v(x, y, -z), v(x, y, z), v(-x, y, z)], interior: false },
  ]);
}

export function translatePoly(poly: Poly, dx: number, dy: number, dz: number): Poly {
  for (const f of poly) for (const p of f.pts) p.set(p.x + dx, p.y + dy, p.z + dz);
  return poly;
}

/** Rotate a polyhedron about the X axis (used to lay limbs along -Z, etc.). */
export function rotatePolyX(poly: Poly, angle: number): Poly {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (const f of poly) {
    for (const p of f.pts) {
      const y = p.y * c - p.z * s;
      const z = p.y * s + p.z * c;
      p.y = y;
      p.z = z;
    }
  }
  return poly;
}

/**
 * Keep the part of a convex polyhedron where n·p <= d. The cut surface becomes
 * a new face flagged `interior`. Returns null if nothing is left.
 */
export function clipPoly(poly: Poly, n: Vector3, d: number): Poly | null {
  const out: Poly = [];
  const cap: Vector3[] = [];
  let clipped = false;

  for (const f of poly) {
    const pts = f.pts;
    const res: Vector3[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const da = n.dot(a) - d;
      const db = n.dot(b) - d;
      if (da <= EPS) res.push(a);
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        const t = da / (da - db);
        const p = new Vector3().lerpVectors(a, b, t);
        res.push(p);
        cap.push(p);
        clipped = true;
      } else if (Math.abs(da) <= EPS && db > EPS) {
        cap.push(a);
      } else if (Math.abs(db) <= EPS && da > EPS) {
        cap.push(b);
      }
      if (da > EPS) clipped = true;
    }
    if (res.length >= 3) out.push({ pts: res, interior: f.interior });
  }

  if (!clipped) return poly;
  if (out.length < 3) return null;

  // Build the cap: unique cut points ordered around the plane normal.
  const uniq: Vector3[] = [];
  for (const p of cap) {
    let dup = false;
    for (const q of uniq) {
      if (q.distanceToSquared(p) < 1e-9) {
        dup = true;
        break;
      }
    }
    if (!dup) uniq.push(p);
  }
  if (uniq.length >= 3) {
    const c = new Vector3();
    for (const p of uniq) c.add(p);
    c.multiplyScalar(1 / uniq.length);
    const u = new Vector3(1, 0, 0);
    if (Math.abs(n.x) > 0.9) u.set(0, 1, 0);
    u.addScaledVector(n, -u.dot(n)).normalize();
    const v = new Vector3().crossVectors(n, u);
    const rel = new Vector3();
    const keyed = uniq.map((p) => {
      rel.subVectors(p, c);
      return { p, a: Math.atan2(rel.dot(v), rel.dot(u)) };
    });
    keyed.sort((x, y) => x.a - y.a);
    out.push({ pts: keyed.map((k) => k.p), interior: true });
  }
  return out;
}

/** Is a point inside a convex polyhedron? */
export function insidePoly(poly: Poly, p: Vector3): boolean {
  const n = new Vector3();
  for (const f of poly) {
    faceNormal(f.pts, n);
    if (n.dot(p) - n.dot(f.pts[0]) > 1e-5) return false;
  }
  return true;
}

/** Split a convex polyhedron into the Voronoi cells of `seeds`. */
export function voronoi(poly: Poly, seeds: Vector3[]): Poly[] {
  const cells: Poly[] = [];
  const n = new Vector3();
  const mid = new Vector3();
  for (let i = 0; i < seeds.length; i++) {
    // Deep-copy so cells never share vertex objects.
    let cell: Poly | null = poly.map((f) => ({ pts: f.pts.map((p) => p.clone()), interior: f.interior }));
    for (let j = 0; j < seeds.length && cell; j++) {
      if (i === j) continue;
      n.subVectors(seeds[j], seeds[i]);
      const len = n.length();
      if (len < 1e-5) continue;
      n.multiplyScalar(1 / len);
      mid.addVectors(seeds[i], seeds[j]).multiplyScalar(0.5);
      cell = clipPoly(cell, n, n.dot(mid));
    }
    if (cell && cell.length >= 4) cells.push(cell);
  }
  return cells;
}

/** Flat-shaded triangle soup for a polyhedron. */
export interface TriSoup {
  /** 9 floats per triangle. */
  pos: Float32Array;
  /** 9 floats per triangle (the face normal, repeated). */
  nrm: Float32Array;
  /** One flag per VERTEX: 1 = cut surface. */
  interior: Float32Array;
  centroid: Vector3;
  triCount: number;
}

export function triangulate(poly: Poly): TriSoup {
  let tris = 0;
  for (const f of poly) tris += Math.max(0, f.pts.length - 2);
  const pos = new Float32Array(tris * 9);
  const nrm = new Float32Array(tris * 9);
  const interior = new Float32Array(tris * 3);
  const n = new Vector3();
  let o = 0;
  let vi = 0;
  for (const f of poly) {
    faceNormal(f.pts, n);
    for (let i = 1; i < f.pts.length - 1; i++) {
      const tri = [f.pts[0], f.pts[i], f.pts[i + 1]];
      for (const p of tri) {
        pos[o] = p.x;
        pos[o + 1] = p.y;
        pos[o + 2] = p.z;
        nrm[o] = n.x;
        nrm[o + 1] = n.y;
        nrm[o + 2] = n.z;
        interior[vi++] = f.interior ? 1 : 0;
        o += 3;
      }
    }
  }
  return { pos, nrm, interior, centroid: polyCentroid(poly), triCount: tris };
}

export function polyGeometry(poly: Poly): BufferGeometry {
  const soup = triangulate(poly);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(soup.pos, 3));
  g.setAttribute('normal', new BufferAttribute(soup.nrm, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Axis-aligned bounds of a polyhedron. */
export function polyBounds(poly: Poly): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const f of poly) {
    for (const p of f.pts) {
      min.min(p);
      max.max(p);
    }
  }
  return { min, max };
}
