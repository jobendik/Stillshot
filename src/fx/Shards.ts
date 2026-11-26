import { BufferAttribute, BufferGeometry, Matrix4, Mesh, type Scene, type ShaderMaterial, Vector3 } from 'three';
import { makeRng } from '@/core/Context';
import { GRAVITY, SHARD_LIFETIME } from '@/config/constants';
import { CrystalGlobals, type CrystalTone, crystalFor } from './Crystal';
import { type Poly, type TriSoup, boxPoly, insidePoly, polyBounds, triangulate, voronoi } from './Poly';

/**
 * Crystalline destruction.
 *
 * A body part is registered once as a convex polyhedron. On first use it is
 * pre-fractured into Voronoi cells (a few seeded variations), and each cell is
 * triangulated with its cut faces flagged. When something breaks, the cells of
 * every part are baked into ONE buffer in world space together with per-shard
 * launch data, and from then on the GPU does all the work (see Crystal.ts).
 *
 * The launch model is deliberately physical rather than random:
 *   - impulse along the striking direction, falling off with distance from the
 *     point of impact (an exit cone, not a uniform puff);
 *   - a radial push away from the impact;
 *   - a release DELAY proportional to distance from the impact, so the fracture
 *     visibly propagates through the body as a wave. At 1/200th speed you can
 *     watch a figure come apart from the bullet outwards.
 *
 * A burst is described by a plain serialisable `BurstSpec`; the replay stores
 * the spec and gets the exact same sculpture back.
 */

export interface Piece {
  /** Registered part id. */
  part: string;
  /** World matrix of the part (16 numbers, column-major). */
  m: number[];
}

export interface BurstSpec {
  tone: CrystalTone;
  pieces: Piece[];
  /** If set, a fresh pane fracture is generated instead of using `pieces`. */
  glass?: { center: [number, number, number]; size: [number, number, number] };
  impact: [number, number, number];
  dir: [number, number, number];
  /** Directional impulse (m/s) at the point of impact. */
  force: number;
  /** Radial impulse (m/s) at the point of impact. */
  radial: number;
  /** Crack propagation speed in m/s (0 = everything releases at once). */
  crack: number;
  seed: number;
  /** World time at which the burst begins. */
  start: number;
  life?: number;
}

interface Template {
  cells: Array<{ soup: TriSoup; radius: number }>;
}

interface PartDef {
  poly: Poly;
  cells: number;
  variations: Template[];
}

const VARIATIONS = 3;
const parts = new Map<string, PartDef>();

/** Register a convex part so it can be fractured later. Idempotent. */
export function registerPart(id: string, poly: Poly, cells: number): void {
  if (!parts.has(id)) parts.set(id, { poly, cells, variations: [] });
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildTemplate(
  poly: Poly,
  count: number,
  rng: () => number,
  bias?: { point: Vector3; strength: number },
  flat?: 'x' | 'z',
): Template {
  const { min, max } = polyBounds(poly);
  const size = new Vector3().subVectors(max, min);
  const seeds: Vector3[] = [];
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 24; tries++) {
      const p = new Vector3(min.x + rng() * size.x, min.y + rng() * size.y, min.z + rng() * size.z);
      if (bias && rng() < bias.strength) {
        // Pull the seed toward the impact: small shards near the hit, big ones far away.
        const k = Math.pow(rng(), 1.8);
        p.lerp(bias.point, 1 - k);
      }
      // Panes fracture in 2D: with every seed in the mid-plane, all cuts are
      // perpendicular to the glass and each shard is a clean prism.
      if (flat) p[flat] = 0;
      if (insidePoly(poly, p)) {
        seeds.push(p);
        break;
      }
    }
  }
  if (seeds.length < 2) return { cells: [{ soup: triangulate(poly), radius: size.length() * 0.5 }] };
  const cells = voronoi(poly, seeds);
  return {
    cells: cells.map((c) => {
      const soup = triangulate(c);
      let r = 0;
      for (let i = 0; i < soup.pos.length; i += 3) {
        const dx = soup.pos[i] - soup.centroid.x;
        const dy = soup.pos[i + 1] - soup.centroid.y;
        const dz = soup.pos[i + 2] - soup.centroid.z;
        r = Math.max(r, Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
      return { soup, radius: r };
    }),
  };
}

function templateFor(id: string, variation: number): Template | null {
  const def = parts.get(id);
  if (!def) return null;
  const v = variation % VARIATIONS;
  if (!def.variations[v]) {
    def.variations[v] = buildTemplate(def.poly, def.cells, makeRng(hashString(id) + v * 7919));
  }
  return def.variations[v];
}

/** Pre-fracture every registered part so the first kill does not hitch. */
export function warmShardTemplates(): void {
  for (const id of parts.keys()) for (let v = 0; v < VARIATIONS; v++) templateFor(id, v);
}

interface Burst {
  mesh: Mesh;
  mat: ShaderMaterial;
  end: number;
  tris: number;
}

const _m = new Matrix4();
const _p = new Vector3();
const _n = new Vector3();
const _c = new Vector3();

export class ShardSystem {
  private readonly scene: Scene;
  private readonly bursts: Burst[] = [];
  /** Hard cap on concurrent bursts; the oldest is dropped first. */
  maxBursts = 36;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  get triangleCount(): number {
    let n = 0;
    for (const b of this.bursts) n += b.tris;
    return n;
  }

  get burstCount(): number {
    return this.bursts.length;
  }

  spawn(spec: BurstSpec): void {
    const rng = makeRng(spec.seed);
    const variation = Math.floor(rng() * VARIATIONS);

    // Resolve what is breaking into (template, matrix) pairs.
    const sources: Array<{ tpl: Template; m: Matrix4 }> = [];
    if (spec.glass) {
      const [sx, sy, sz] = spec.glass.size;
      const poly = boxPoly(sx, sy, sz);
      const local = new Vector3(
        spec.impact[0] - spec.glass.center[0],
        spec.impact[1] - spec.glass.center[1],
        spec.impact[2] - spec.glass.center[2],
      );
      const thin = sx < sz ? 'x' : 'z';
      local[thin] = 0;
      const count = Math.round(Math.min(64, 22 + sx * sy * sz * 110));
      const tpl = buildTemplate(poly, count, rng, { point: local, strength: 0.7 }, thin);
      sources.push({ tpl, m: new Matrix4().makeTranslation(...spec.glass.center) });
    } else {
      for (const piece of spec.pieces) {
        const tpl = templateFor(piece.part, variation);
        if (tpl) sources.push({ tpl, m: new Matrix4().fromArray(piece.m) });
      }
    }

    let verts = 0;
    for (const s of sources) for (const c of s.tpl.cells) verts += c.soup.triCount * 3;
    if (verts === 0) return;

    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const aCenter = new Float32Array(verts * 3);
    const aVel = new Float32Array(verts * 3);
    const aSpin = new Float32Array(verts * 4);
    const aData = new Float32Array(verts * 4);

    const impact = new Vector3(...spec.impact);
    const dir = new Vector3(...spec.dir).normalize();
    const floorY = CrystalGlobals.uFloorY.value;
    const vel = new Vector3();
    const axis = new Vector3();
    let o3 = 0;
    let o4 = 0;

    for (const src of sources) {
      _m.copy(src.m);
      for (const cell of src.tpl.cells) {
        const soup = cell.soup;
        _c.copy(soup.centroid).applyMatrix4(_m);

        const d = _c.distanceTo(impact);
        const fall = 1 / (1 + (d / 0.42) * (d / 0.42));
        vel
          .copy(dir)
          .multiplyScalar(spec.force * (0.18 + 0.82 * fall) * (0.6 + rng() * 0.6));
        _p.subVectors(_c, impact);
        const pl = _p.length();
        if (pl > 1e-4) vel.addScaledVector(_p, (spec.radial * (0.3 + 0.7 * fall) * (0.5 + rng())) / pl);
        vel.x += (rng() - 0.5) * 1.1;
        vel.y += rng() * 1.3 + fall * 1.2;
        vel.z += (rng() - 0.5) * 1.1;

        axis.set(rng() - 0.5, rng() - 0.5, rng() - 0.5);
        if (axis.lengthSq() < 1e-4) axis.set(0, 1, 0);
        axis.normalize();
        const spin = (1.5 + rng() * 9) * (0.35 + fall) * (rng() < 0.5 ? -1 : 1);

        const delay = spec.crack > 0 ? d / spec.crack : 0;
        const restY = floorY + Math.min(0.09, cell.radius * 0.45);
        const y0 = Math.max(_c.y, restY);
        const land = (vel.y + Math.sqrt(vel.y * vel.y + 2 * GRAVITY * (y0 - restY))) / GRAVITY;
        const seed = rng();

        for (let i = 0; i < soup.triCount * 3; i++) {
          _p.set(soup.pos[i * 3], soup.pos[i * 3 + 1], soup.pos[i * 3 + 2]).applyMatrix4(_m);
          _n.set(soup.nrm[i * 3], soup.nrm[i * 3 + 1], soup.nrm[i * 3 + 2]).transformDirection(_m);
          position[o3] = _p.x;
          position[o3 + 1] = _p.y;
          position[o3 + 2] = _p.z;
          normal[o3] = _n.x;
          normal[o3 + 1] = _n.y;
          normal[o3 + 2] = _n.z;
          aCenter[o3] = _c.x;
          aCenter[o3 + 1] = _c.y;
          aCenter[o3 + 2] = _c.z;
          aVel[o3] = vel.x;
          aVel[o3 + 1] = vel.y;
          aVel[o3 + 2] = vel.z;
          aSpin[o4] = axis.x;
          aSpin[o4 + 1] = axis.y;
          aSpin[o4 + 2] = axis.z;
          aSpin[o4 + 3] = spin;
          aData[o4] = delay;
          aData[o4 + 1] = land;
          aData[o4 + 2] = soup.interior[i];
          aData[o4 + 3] = seed;
          o3 += 3;
          o4 += 4;
        }
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(position, 3));
    geo.setAttribute('normal', new BufferAttribute(normal, 3));
    geo.setAttribute('aCenter', new BufferAttribute(aCenter, 3));
    geo.setAttribute('aVel', new BufferAttribute(aVel, 3));
    geo.setAttribute('aSpin', new BufferAttribute(aSpin, 4));
    geo.setAttribute('aData', new BufferAttribute(aData, 4));

    const life = spec.life ?? SHARD_LIFETIME;
    const mat = crystalFor(spec.tone, true);
    mat.uniforms.uStart.value = spec.start;
    mat.uniforms.uLife.value = life;
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false; // vertices are displaced on the GPU
    mesh.renderOrder = spec.tone === 'glass' ? 3 : 0;
    this.scene.add(mesh);
    this.bursts.push({ mesh, mat, end: spec.start + life + 0.5, tris: verts / 3 });

    while (this.bursts.length > this.maxBursts) this.remove(0);
  }

  /** Drop bursts whose life is over. `worldTime` is the same clock the shader reads. */
  update(worldTime: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (worldTime > this.bursts[i].end) this.remove(i);
    }
  }

  private remove(i: number): void {
    const b = this.bursts[i];
    this.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    b.mat.dispose();
    this.bursts.splice(i, 1);
  }

  clear(): void {
    while (this.bursts.length > 0) this.remove(this.bursts.length - 1);
  }
}
