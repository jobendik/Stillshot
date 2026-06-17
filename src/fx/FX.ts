import {
  BoxGeometry,
  type Material,
  Mesh,
  PointLight,
  type Scene,
  Vector3,
} from 'three';
import { Materials } from './Materials';
import { PALETTE } from '@/config/palette';
import { PLAYER_GRAVITY, SHARD_LIFETIME } from '@/config/constants';

interface Burst {
  meshes: Mesh[];
  vels: Vector3[];
  angVels: Vector3[];
  mat: Material;
  ttl: number;
  life: number;
}

interface Flash {
  light: PointLight;
  ttl: number;
  life: number;
  intensity: number;
}

/**
 * Procedural destruction & impact feedback. Enemies do NOT ragdoll — on lethal
 * impact the intact mesh is removed and replaced by a cloud of crystalline
 * shards driven outward from the point of impact (AddExplosionForce-style), which
 * then fade and cull to avoid piling up physics. Shards live in WORLD time, so a
 * kill landed while you stand still hangs gorgeously in the air.
 */
export class FXSystem {
  private readonly scene: Scene;
  private readonly shardGeo = new BoxGeometry(0.1, 0.1, 0.1);
  private readonly bursts: Burst[] = [];
  private readonly flashes: Flash[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
  }

  shatterEnemy(impact: Vector3, feet: Vector3, _dir: Vector3): void {
    const center = feet.clone().add(new Vector3(0, 1.0, 0));
    this.addBurst(center, impact, 40, Materials.enemyShard, [0.5, 1.5], [2.5, 7], SHARD_LIFETIME, 1.0);
    this.addFlash(center, PALETTE.enemyRed.getHex(), 6, 0.18);
  }

  shatterGlass(pane: { box: { getCenter: (v: Vector3) => Vector3 } }, impact: Vector3, _dir: Vector3): void {
    const center = pane.box.getCenter(new Vector3());
    this.addBurst(center, impact, 28, Materials.glassShard, [0.3, 0.9], [1.5, 4], SHARD_LIFETIME * 0.8, 1.4);
  }

  shatterThrowable(point: Vector3, radius: number): void {
    this.addBurst(point, point, 16, Materials.interactive, [0.4, 0.9], [1.5, 4], SHARD_LIFETIME * 0.7, radius * 4);
  }

  shatterPlayer(point: Vector3): void {
    this.addBurst(point, point, 30, Materials.playerCrystal, [0.4, 1.2], [2, 5], SHARD_LIFETIME, 1.2);
  }

  /** Two diverging cosmetic half-bullets after a katana slice. */
  bulletSplit(point: Vector3, dir: Vector3): void {
    const lateral = new Vector3(-dir.z, 0, dir.x).normalize();
    for (const sign of [-1, 1]) {
      const v = dir.clone().multiplyScalar(8).addScaledVector(lateral, sign * 5);
      this.addShard(point.clone(), v, Materials.bullet, 0.7, 0.5);
    }
  }

  spark(point: Vector3, _dir: Vector3): void {
    this.addFlash(point, 0xffffff, 2.2, 0.07);
  }

  muzzleFlash(origin: Vector3, dir: Vector3): void {
    this.addFlash(origin.clone().addScaledVector(dir, 0.3), 0xfff2d0, 4, 0.06);
  }

  // ---- internal ---------------------------------------------------------

  private addBurst(
    center: Vector3,
    impact: Vector3,
    count: number,
    template: Material,
    sizeRange: [number, number],
    speedRange: [number, number],
    life: number,
    spread: number,
  ): void {
    const mat = template.clone();
    mat.transparent = true;
    const burst: Burst = { meshes: [], vels: [], angVels: [], mat, ttl: life, life };
    for (let i = 0; i < count; i++) {
      const m = new Mesh(this.shardGeo, mat);
      const s = sizeRange[0] + Math.random() * (sizeRange[1] - sizeRange[0]);
      m.scale.setScalar(s);
      const p = center
        .clone()
        .add(new Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * spread));
      m.position.copy(p);
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      const speed = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
      const v = p.clone().sub(impact).normalize().multiplyScalar(speed);
      v.y += 1.5 + Math.random() * 2.5;
      burst.meshes.push(m);
      burst.vels.push(v);
      burst.angVels.push(new Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10));
      this.scene.add(m);
    }
    this.bursts.push(burst);
  }

  private addShard(pos: Vector3, vel: Vector3, template: Material, life: number, _size: number): void {
    const mat = template.clone();
    mat.transparent = true;
    const burst: Burst = { meshes: [], vels: [], angVels: [], mat, ttl: life, life };
    const m = new Mesh(this.shardGeo, mat);
    m.scale.setScalar(0.6);
    m.position.copy(pos);
    burst.meshes.push(m);
    burst.vels.push(vel);
    burst.angVels.push(new Vector3(8, 8, 8));
    this.scene.add(m);
    this.bursts.push(burst);
  }

  private addFlash(pos: Vector3, color: number, intensity: number, life: number): void {
    const light = new PointLight(color, intensity, 6, 2);
    light.position.copy(pos);
    this.scene.add(light);
    this.flashes.push({ light, ttl: life, life, intensity });
  }

  update(unscaledDt: number, scaledDt: number): void {
    // Shards live in world time.
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.ttl -= scaledDt;
      const f = Math.max(0, b.ttl / b.life);
      b.mat.opacity = f;
      for (let j = 0; j < b.meshes.length; j++) {
        const m = b.meshes[j];
        const v = b.vels[j];
        v.y -= PLAYER_GRAVITY * scaledDt;
        m.position.addScaledVector(v, scaledDt);
        const a = b.angVels[j];
        m.rotation.x += a.x * scaledDt;
        m.rotation.y += a.y * scaledDt;
        m.rotation.z += a.z * scaledDt;
      }
      if (b.ttl <= 0) {
        for (const m of b.meshes) this.scene.remove(m);
        b.mat.dispose();
        this.bursts.splice(i, 1);
      }
    }

    // Flashes are instantaneous — real time.
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.ttl -= unscaledDt;
      fl.light.intensity = fl.intensity * Math.max(0, fl.ttl / fl.life);
      if (fl.ttl <= 0) {
        this.scene.remove(fl.light);
        this.flashes.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const b of this.bursts) {
      for (const m of b.meshes) this.scene.remove(m);
      b.mat.dispose();
    }
    this.bursts.length = 0;
    for (const fl of this.flashes) this.scene.remove(fl.light);
    this.flashes.length = 0;
  }
}
