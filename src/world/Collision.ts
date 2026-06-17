import { Box3, Vector3 } from 'three';

/**
 * Lightweight collision math. The arenas are white-box geometry made of
 * axis-aligned boxes, so we use cheap cylinder-vs-AABB resolution for actors
 * and a slab ray test for projectiles — no physics engine required, which keeps
 * everything deterministic under the heavily-scaled time step.
 */

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Resolve a vertical cylinder (actor) out of a set of boxes by pushing along the
 * axis of least penetration. Only boxes whose vertical span overlaps the actor's
 * span block it — so an actor can jump over low cover. Mutates `pos`.
 */
export function resolveCylinder(
  pos: Vector3,
  radius: number,
  height: number,
  boxes: Box3[],
  bounds: Bounds,
): void {
  const feetY = pos.y;
  const headY = pos.y + height;

  for (const box of boxes) {
    if (box.max.y <= feetY + 1e-3 || box.min.y >= headY - 1e-3) continue; // no vertical overlap

    const exMinX = box.min.x - radius;
    const exMaxX = box.max.x + radius;
    const exMinZ = box.min.z - radius;
    const exMaxZ = box.max.z + radius;

    if (pos.x <= exMinX || pos.x >= exMaxX || pos.z <= exMinZ || pos.z >= exMaxZ) continue;

    // Penetration depth on each side; resolve along the smallest.
    const penLeft = pos.x - exMinX;
    const penRight = exMaxX - pos.x;
    const penBack = pos.z - exMinZ;
    const penFront = exMaxZ - pos.z;

    const minX = Math.min(penLeft, penRight);
    const minZ = Math.min(penBack, penFront);

    if (minX < minZ) {
      pos.x = penLeft < penRight ? exMinX : exMaxX;
    } else {
      pos.z = penBack < penFront ? exMinZ : exMaxZ;
    }
  }

  // Arena bounds.
  pos.x = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, pos.x));
  pos.z = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, pos.z));
}

const _inv = new Vector3();
const _tmin = new Vector3();
const _tmax = new Vector3();

/**
 * Ray vs AABB (slab method). Returns the entry distance `t` (>= 0) if the ray
 * starting at `origin` along unit `dir` hits the box within `maxDist`, else null.
 */
export function rayVsBox(
  origin: Vector3,
  dir: Vector3,
  box: Box3,
  maxDist: number,
): number | null {
  _inv.set(
    dir.x !== 0 ? 1 / dir.x : Infinity,
    dir.y !== 0 ? 1 / dir.y : Infinity,
    dir.z !== 0 ? 1 / dir.z : Infinity,
  );

  _tmin.set(
    (box.min.x - origin.x) * _inv.x,
    (box.min.y - origin.y) * _inv.y,
    (box.min.z - origin.z) * _inv.z,
  );
  _tmax.set(
    (box.max.x - origin.x) * _inv.x,
    (box.max.y - origin.y) * _inv.y,
    (box.max.z - origin.z) * _inv.z,
  );

  const t1x = Math.min(_tmin.x, _tmax.x);
  const t2x = Math.max(_tmin.x, _tmax.x);
  const t1y = Math.min(_tmin.y, _tmax.y);
  const t2y = Math.max(_tmin.y, _tmax.y);
  const t1z = Math.min(_tmin.z, _tmax.z);
  const t2z = Math.max(_tmin.z, _tmax.z);

  const tNear = Math.max(t1x, t1y, t1z);
  const tFar = Math.min(t2x, t2y, t2z);

  if (tNear > tFar || tFar < 0) return null;
  const t = tNear >= 0 ? tNear : tFar; // if origin inside, use exit
  if (t > maxDist) return null;
  return t;
}

/** Does the horizontal segment between two points clear all boxes? (line of sight) */
export function segmentClear(
  a: Vector3,
  b: Vector3,
  boxes: Box3[],
): boolean {
  const dir = new Vector3().subVectors(b, a);
  const dist = dir.length();
  if (dist < 1e-5) return true;
  dir.multiplyScalar(1 / dist);
  for (const box of boxes) {
    const t = rayVsBox(a, dir, box, dist);
    if (t !== null) return false;
  }
  return true;
}
