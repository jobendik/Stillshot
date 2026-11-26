import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, OctahedronGeometry, Quaternion, type Scene, Vector3 } from 'three';
import type { ProjectileLook } from '@/types';
import type { StreakRenderer } from './Streaks';

/**
 * What one round looks like this frame. The live projectile system and the
 * replay both produce these; nothing in here knows which one is talking.
 */
export interface BulletVisual {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  look: ProjectileLook;
  hostile: boolean;
  /** Length of the wake behind the round, metres. */
  trail: number;
  /** Distance ahead to whatever it will hit (0 = unknown / don't draw). */
  threat: number;
}

const SHAPE: Record<ProjectileLook, [number, number]> = {
  // [radius, half-length]
  bullet: [0.034, 0.17],
  pellet: [0.026, 0.07],
  nail: [0.018, 0.34],
  half: [0.024, 0.1],
};

const _z = new Vector3(0, 0, 1);
const _d = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _m = new Matrix4();
const _a = new Vector3();
const _b = new Vector3();

const INK = new Color(0x08080a);
const HOT = new Color(0x1a0204);

/**
 * Rounds are solid, dark, elongated darts — readable against white from any
 * distance — with a wake whose length is a fixed span of WORLD time. Hostile
 * rounds leave a red wake; yours leave a grey one. While time is nearly still,
 * hostile rounds also project a dashed line to their point of impact, and the
 * dashes crawl forward at the speed of world time: you can see both where the
 * round is going and how fast the clock is running.
 */
export class BulletRenderer {
  private readonly mesh: InstancedMesh;
  private readonly capacity: number;

  constructor(scene: Scene, capacity = 320) {
    this.capacity = capacity;
    const geo = new OctahedronGeometry(1, 0);
    const mat = new MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, INK);
    scene.add(this.mesh);
  }

  /**
   * @param threatAlpha 0..1 opacity of the threat lines (already includes the settings toggle)
   * @param dashPhase   world time, so the dashes crawl with the clock
   */
  draw(list: readonly BulletVisual[], streaks: StreakRenderer, threatAlpha: number, dashPhase: number): void {
    const n = Math.min(list.length, this.capacity);
    for (let i = 0; i < n; i++) {
      const v = list[i];
      const [r, half] = SHAPE[v.look];
      _d.set(v.dx, v.dy, v.dz);
      _q.setFromUnitVectors(_z, _d);
      _s.set(r, r, half);
      _p.set(v.x, v.y, v.z);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, v.hostile ? HOT : INK);

      // Wake.
      if (v.trail > 0.02) {
        _a.copy(_p);
        _b.copy(_p).addScaledVector(_d, -v.trail);
        if (v.hostile) streaks.line(_a, _b, r * 2.6, [2.6, 0.12, 0.1, 0.95], [1.6, 0.05, 0.05, 0]);
        else streaks.line(_a, _b, r * 2.2, [0.03, 0.03, 0.04, 0.7], [0.03, 0.03, 0.04, 0]);
      }
      // Threat line.
      if (v.hostile && v.threat > 0.3 && threatAlpha > 0.01) {
        _a.copy(_p).addScaledVector(_d, half);
        _b.copy(_p).addScaledVector(_d, v.threat);
        const a0 = 0.75 * threatAlpha;
        streaks.line(_a, _b, 0.018, [1.5, 0.08, 0.1, a0], [1.5, 0.08, 0.1, a0 * 0.15], 3.2, dashPhase * 6);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    this.mesh.count = 0;
  }
}
