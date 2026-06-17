import { Box3, Vector3 } from 'three';
import type { Bounds } from '@/world/Collision';

/**
 * Grid-based navigation that stands in for Unity's NavMesh. The walkable area is
 * rasterized into cells; cells overlapping a collider (inflated by the agent
 * radius) are blocked. A* returns the shortest waypoint path, then we apply
 * string-pulling so enemies walk in straight lines where line-of-sight permits —
 * giving the relentless "shortest route, straight at you" pursuit the AI needs.
 */
export class Navigation {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  private readonly blocked: Uint8Array;
  private readonly bounds: Bounds;

  constructor(bounds: Bounds, boxes: Box3[], agentRadius: number, cell = 0.7) {
    this.bounds = bounds;
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
    this.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cell));
    this.blocked = new Uint8Array(this.cols * this.rows);

    const pad = agentRadius + cell * 0.4;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const wx = bounds.minX + (c + 0.5) * cell;
        const wz = bounds.minZ + (r + 0.5) * cell;
        for (const box of boxes) {
          // Only floor-level obstacles block navigation (tall walls / cover).
          if (box.max.y < 0.3) continue;
          if (
            wx > box.min.x - pad &&
            wx < box.max.x + pad &&
            wz > box.min.z - pad &&
            wz < box.max.z + pad
          ) {
            this.blocked[r * this.cols + c] = 1;
            break;
          }
        }
      }
    }
  }

  private idx(c: number, r: number): number {
    return r * this.cols + c;
  }

  private inGrid(c: number, r: number): boolean {
    return c >= 0 && c < this.cols && r >= 0 && r < this.rows;
  }

  private isBlocked(c: number, r: number): boolean {
    return !this.inGrid(c, r) || this.blocked[this.idx(c, r)] === 1;
  }

  private toCell(p: Vector3): { c: number; r: number } {
    const c = Math.floor((p.x - this.bounds.minX) / this.cell);
    const r = Math.floor((p.z - this.bounds.minZ) / this.cell);
    return {
      c: Math.max(0, Math.min(this.cols - 1, c)),
      r: Math.max(0, Math.min(this.rows - 1, r)),
    };
  }

  private cellCenter(c: number, r: number): Vector3 {
    return new Vector3(
      this.bounds.minX + (c + 0.5) * this.cell,
      0,
      this.bounds.minZ + (r + 0.5) * this.cell,
    );
  }

  /** Nearest walkable cell to a (possibly blocked) cell, via expanding ring search. */
  private nearestFree(c: number, r: number): { c: number; r: number } | null {
    if (!this.isBlocked(c, r)) return { c, r };
    for (let radius = 1; radius < Math.max(this.cols, this.rows); radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (!this.isBlocked(nc, nr)) return { c: nc, r: nr };
        }
      }
    }
    return null;
  }

  /**
   * A* from `start` to `goal`. Returns a list of world-space waypoints (XZ on the
   * floor plane, y = 0) or null if unreachable.
   */
  findPath(start: Vector3, goal: Vector3): Vector3[] | null {
    const sc = this.toCell(start);
    const gc = this.toCell(goal);
    const s = this.nearestFree(sc.c, sc.r);
    const g = this.nearestFree(gc.c, gc.r);
    if (!s || !g) return null;

    const startIdx = this.idx(s.c, s.r);
    const goalIdx = this.idx(g.c, g.r);
    if (startIdx === goalIdx) return [this.cellCenter(g.c, g.r)];

    const open: number[] = [startIdx];
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>([[startIdx, 0]]);
    const fScore = new Map<number, number>([[startIdx, this.heuristic(s, g)]]);
    const closed = new Set<number>();

    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    let guard = this.cols * this.rows * 4;
    while (open.length > 0 && guard-- > 0) {
      // Pop lowest fScore.
      let bestI = 0;
      let bestF = Infinity;
      for (let i = 0; i < open.length; i++) {
        const f = fScore.get(open[i]) ?? Infinity;
        if (f < bestF) {
          bestF = f;
          bestI = i;
        }
      }
      const current = open.splice(bestI, 1)[0];
      if (current === goalIdx) return this.reconstruct(cameFrom, current);
      closed.add(current);

      const cc = current % this.cols;
      const cr = Math.floor(current / this.cols);
      for (const [dc, dr] of neighbors) {
        const nc = cc + dc;
        const nr = cr + dr;
        if (this.isBlocked(nc, nr)) continue;
        // Prevent diagonal cutting through wall corners.
        if (dc !== 0 && dr !== 0) {
          if (this.isBlocked(cc + dc, cr) || this.isBlocked(cc, cr + dr)) continue;
        }
        const nIdx = this.idx(nc, nr);
        if (closed.has(nIdx)) continue;
        const step = dc !== 0 && dr !== 0 ? Math.SQRT2 : 1;
        const tentative = (gScore.get(current) ?? Infinity) + step;
        if (tentative < (gScore.get(nIdx) ?? Infinity)) {
          cameFrom.set(nIdx, current);
          gScore.set(nIdx, tentative);
          fScore.set(nIdx, tentative + this.heuristic({ c: nc, r: nr }, g));
          if (!open.includes(nIdx)) open.push(nIdx);
        }
      }
    }
    return null;
  }

  private heuristic(a: { c: number; r: number }, b: { c: number; r: number }): number {
    const dx = Math.abs(a.c - b.c);
    const dz = Math.abs(a.r - b.r);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  }

  private reconstruct(cameFrom: Map<number, number>, current: number): Vector3[] {
    const path: number[] = [current];
    while (cameFrom.has(current)) {
      current = cameFrom.get(current)!;
      path.unshift(current);
    }
    const waypoints = path.map((i) =>
      this.cellCenter(i % this.cols, Math.floor(i / this.cols)),
    );
    return this.smooth(waypoints);
  }

  /** String-pull: drop intermediate waypoints that are reachable in a straight line. */
  private smooth(points: Vector3[]): Vector3[] {
    if (points.length <= 2) return points;
    const out: Vector3[] = [points[0]];
    let anchor = 0;
    for (let i = 2; i < points.length; i++) {
      if (!this.lineWalkable(points[anchor], points[i])) {
        out.push(points[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  /** Sample the segment; walkable if no sampled cell is blocked. */
  private lineWalkable(a: Vector3, b: Vector3): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(dist / (this.cell * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const { c, r } = this.toCell(new Vector3(x, 0, z));
      if (this.isBlocked(c, r)) return false;
    }
    return true;
  }
}
