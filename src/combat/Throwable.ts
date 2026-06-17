import { type Object3D, Vector3 } from 'three';
import type { WeaponKind } from '@/types';
import type { GameContext } from '@/core/Context';
import type { Enemy } from '@/ai/Enemy';
import { buildThrowableModel, buildWeaponModel } from '@/fx/Models';
import { rayVsBox } from '@/world/Collision';
import {
  PLAYER_GRAVITY,
  THROW_MAGNETISM_RADIUS,
  THROW_SPEED,
} from '@/config/constants';

interface ThrownObject {
  object: Object3D;
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
  isWeapon: boolean;
  kind: WeaponKind | null;
  /** Unfired rounds carried by a thrown firearm — preserved on landing. */
  ammo: number;
  radius: number;
  targetId: number | null;
  life: number;
}

/**
 * Improvised ordnance. Tapping throw propels the held item at the crosshair.
 * A purely ballistic throw would be miserable to aim under pressure, so the
 * trajectory is gently magnetized toward any enemy inside a targeting cylinder.
 * On impact a throwable shatters; a thrown firearm lands as a recoverable pickup.
 * Hitting an armed enemy staggers and DISARMS them (their weapon pops upward).
 */
export class ThrownObjectSystem {
  private readonly ctx: GameContext;
  private readonly objects: ThrownObject[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  throwWeapon(kind: WeaponKind, origin: Vector3, dir: Vector3, ammo: number): void {
    const obj = buildWeaponModel(kind);
    obj.position.copy(origin);
    this.ctx.scene.add(obj);
    this.objects.push(this.make(obj, origin, dir, true, kind, 0.4, ammo));
    this.ctx.audio.play('throw');
  }

  throwThrowable(radius: number, origin: Vector3, dir: Vector3): void {
    const obj = buildThrowableModel(radius);
    obj.position.copy(origin);
    this.ctx.scene.add(obj);
    this.objects.push(this.make(obj, origin, dir, false, null, radius, 0));
    this.ctx.audio.play('throw');
  }

  private make(
    object: Object3D,
    origin: Vector3,
    dir: Vector3,
    isWeapon: boolean,
    kind: WeaponKind | null,
    radius: number,
    ammo: number,
  ): ThrownObject {
    const target = this.acquireTarget(origin, dir);
    return {
      object,
      pos: origin.clone(),
      vel: dir.clone().normalize().multiplyScalar(THROW_SPEED),
      spin: new Vector3(
        (this.ctx.rng() - 0.5) * 18,
        (this.ctx.rng() - 0.5) * 18,
        (this.ctx.rng() - 0.5) * 18,
      ),
      isWeapon,
      kind,
      ammo,
      radius,
      targetId: target,
      life: 4,
    };
  }

  /** Find the enemy best aligned with the throw direction (the targeting cylinder). */
  private acquireTarget(origin: Vector3, dir: Vector3): number | null {
    const d = dir.clone().normalize();
    let best: number | null = null;
    let bestScore = Infinity;
    for (const e of this.ctx.director.enemies) {
      if (!e.alive) continue;
      const to = new Vector3().subVectors(e.center, origin);
      const along = to.dot(d);
      if (along <= 0 || along > 30) continue;
      // Perpendicular distance from the throw axis.
      const perp = to.clone().addScaledVector(d, -along).length();
      if (perp > THROW_MAGNETISM_RADIUS + e.radius) continue;
      const score = perp + along * 0.02;
      if (score < bestScore) {
        bestScore = score;
        best = e.id;
      }
    }
    return best;
  }

  update(scaledDt: number): void {
    if (scaledDt <= 0) return;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      o.life -= scaledDt;

      // Magnetism: steer toward the locked target.
      if (o.targetId !== null) {
        const target = this.ctx.director.enemies.find((e) => e.id === o.targetId && e.alive);
        if (target) {
          const desired = new Vector3().subVectors(target.center, o.pos).normalize().multiplyScalar(THROW_SPEED);
          o.vel.lerp(desired, Math.min(1, 6 * scaledDt));
        } else {
          o.targetId = null;
        }
      }

      o.vel.y -= PLAYER_GRAVITY * 0.35 * scaledDt; // light arc
      const p0 = o.pos.clone();
      const step = o.vel.clone().multiplyScalar(scaledDt);
      const segLen = step.length();
      const dir = segLen > 1e-6 ? step.clone().multiplyScalar(1 / segLen) : new Vector3(0, -1, 0);

      // Enemy impact.
      let impacted = false;
      for (const e of this.ctx.director.enemies) {
        if (!e.alive) continue;
        if (o.pos.distanceTo(e.center) <= e.radius + o.radius + segLen) {
          this.hitEnemy(o, e);
          impacted = true;
          break;
        }
      }
      if (impacted) {
        this.destroy(i, o, false);
        continue;
      }

      // Wall impact.
      let wallT = Infinity;
      for (const box of this.ctx.level.solids) {
        const t = rayVsBox(p0, dir, box, segLen);
        if (t !== null && t < wallT) wallT = t;
      }
      if (wallT <= segLen) {
        o.pos.copy(p0).addScaledVector(dir, wallT);
        this.land(o);
        this.destroy(i, o, true);
        continue;
      }

      o.pos.add(step);
      o.object.position.copy(o.pos);
      o.object.rotation.x += o.spin.x * scaledDt;
      o.object.rotation.y += o.spin.y * scaledDt;
      o.object.rotation.z += o.spin.z * scaledDt;

      // Floor / lifetime.
      if (o.pos.y <= this.ctx.level.floorY + o.radius * 0.5 || o.life <= 0) {
        o.pos.y = Math.max(o.pos.y, this.ctx.level.floorY + o.radius * 0.5);
        this.land(o);
        this.destroy(i, o, true);
      }
    }
  }

  private hitEnemy(o: ThrownObject, enemy: Enemy): void {
    enemy.stagger(1.6);
    enemy.disarm();
    enemy.applyMeleeHit(1);
    this.ctx.fx.spark(enemy.center.clone(), o.vel.clone().normalize());
    this.ctx.audio.play('thud');
  }

  /** Where the object comes to rest after striking world geometry. */
  private land(o: ThrownObject): void {
    if (o.isWeapon && o.kind) {
      this.ctx.level.spawnWeaponPickup(o.kind, o.pos.clone(), undefined, o.ammo);
    } else {
      this.ctx.fx.shatterThrowable(o.pos.clone(), o.radius);
      this.ctx.audio.play('thud');
    }
  }

  private destroy(index: number, o: ThrownObject, _landed: boolean): void {
    this.ctx.scene.remove(o.object);
    this.objects.splice(index, 1);
  }

  clear(): void {
    for (const o of this.objects) this.ctx.scene.remove(o.object);
    this.objects.length = 0;
  }
}
