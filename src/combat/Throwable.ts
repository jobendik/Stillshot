import { type Object3D, Vector3 } from 'three';
import type { WeaponKind } from '@/types';
import type { GameContext } from '@/core/Context';
import type { Enemy } from '@/ai/Enemy';
import { buildThrowableModel, buildWeaponModel } from '@/fx/Models';
import { rayVsBox } from '@/world/Collision';
import { sweptCylinder } from './Projectile';
import { GRAVITY, THROW_MAGNETISM_RADIUS, THROW_SPEED } from '@/config/constants';

export interface ThrownObject {
  id: number;
  object: Object3D;
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
  isWeapon: boolean;
  kind: WeaponKind | null;
  /** Unfired rounds carried by a thrown firearm — preserved when it lands. */
  ammo: number;
  radius: number;
  targetId: number | null;
  life: number;
}

let NEXT_ID = 1;
const _p0 = new Vector3();
const _step = new Vector3();
const _dir = new Vector3();
const _desired = new Vector3();
const _to = new Vector3();

/**
 * Improvised ordnance. Anything in your hand can be thrown; the throw is gently
 * magnetised toward a target near the crosshair, because a purely ballistic
 * throw is miserable to aim under pressure.
 *
 * A thrown object is a real thing in the world for as long as it flies:
 *   - it staggers and DISARMS whoever it hits — their weapon pops into the air,
 *     toward you, where it can be caught;
 *   - it stops bullets (either side's), so a spent pistol is also a shield;
 *   - it goes through glass and keeps going;
 *   - a thrown katana kills.
 */
export class ThrownObjectSystem {
  private readonly ctx: GameContext;
  readonly objects: ThrownObject[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  throwWeapon(kind: WeaponKind, origin: Vector3, dir: Vector3, ammo: number): void {
    const obj = buildWeaponModel(kind);
    this.launch(obj, origin, dir, true, kind, 0.3, ammo);
  }

  throwThrowable(radius: number, origin: Vector3, dir: Vector3): void {
    this.launch(buildThrowableModel(radius), origin, dir, false, null, Math.max(radius, 0.16), 0);
  }

  private launch(object: Object3D, origin: Vector3, dir: Vector3, isWeapon: boolean, kind: WeaponKind | null, radius: number, ammo: number): void {
    object.position.copy(origin);
    this.ctx.scene.add(object);
    const rng = this.ctx.rng;
    this.objects.push({
      id: NEXT_ID++,
      object,
      pos: origin.clone(),
      vel: dir.clone().normalize().multiplyScalar(THROW_SPEED),
      spin: new Vector3((rng() - 0.5) * 6, (rng() - 0.5) * 6, kind === 'katana' ? 0 : (rng() - 0.5) * 6).add(new Vector3(-14, 0, 0)),
      isWeapon,
      kind,
      ammo,
      radius,
      targetId: this.acquireTarget(origin, dir),
      life: 4,
    });
    this.ctx.audio.play('throw', origin);
  }

  /** The enemy best aligned with the throw (inside a targeting cylinder). */
  private acquireTarget(origin: Vector3, dir: Vector3): number | null {
    let best: number | null = null;
    let bestScore = Infinity;
    for (const e of this.ctx.director.enemies) {
      if (!e.alive) continue;
      _to.subVectors(e.center, origin);
      const along = _to.dot(dir);
      if (along <= 0 || along > 28) continue;
      const perp = _to.addScaledVector(dir, -along).length();
      if (perp > THROW_MAGNETISM_RADIUS + e.radius) continue;
      const score = perp + along * 0.02;
      if (score < bestScore) {
        bestScore = score;
        best = e.id;
      }
    }
    return best;
  }

  /** A bullet has hit this object in flight. */
  struck(o: ThrownObject, point: Vector3, dir: Vector3): void {
    if (o.isWeapon) {
      // Knocked off course; it keeps tumbling.
      o.vel.addScaledVector(dir, 7);
      o.targetId = null;
      this.ctx.fx.sparks(point, dir, 6, 0);
      this.ctx.audio.play('ricochet', point);
    } else {
      this.shatterOrb(o, dir);
      this.remove(o);
    }
  }

  private shatterOrb(o: ThrownObject, dir: Vector3): void {
    o.object.updateMatrixWorld(true);
    this.ctx.fx.shatter([{ part: 'orb', m: o.object.matrixWorld.toArray() }], 'ink', o.pos, dir, 3.5, { radial: 3, crack: 0, life: 4 });
    this.ctx.audio.play('thud', o.pos);
  }

  update(): void {
    const ctx = this.ctx;
    const level = ctx.level;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      const dt = level.localDt(o.pos, ctx.time);
      if (dt <= 0) continue;
      o.life -= dt;

      if (o.targetId !== null) {
        const target = ctx.director.enemies.find((e) => e.id === o.targetId && e.alive);
        if (target) {
          _desired.subVectors(target.center, o.pos).normalize().multiplyScalar(THROW_SPEED);
          o.vel.lerp(_desired, Math.min(1, 5 * dt));
        } else {
          o.targetId = null;
        }
      }

      o.vel.y -= GRAVITY * 0.3 * dt;
      _p0.copy(o.pos);
      _step.copy(o.vel).multiplyScalar(dt);
      const segLen = _step.length();
      if (segLen < 1e-7) continue;
      _dir.copy(_step).multiplyScalar(1 / segLen);

      // Nearest solid / floor.
      let wallT = Infinity;
      for (const box of level.solids) {
        const t = rayVsBox(_p0, _dir, box, segLen);
        if (t !== null && t < wallT) wallT = t;
      }
      if (_dir.y < 0) {
        const t = (level.floorY + o.radius * 0.5 - _p0.y) / _dir.y;
        if (t >= 0 && t <= segLen && t < wallT) wallT = t;
      }
      const reach = Math.min(segLen, wallT);

      // Glass shatters and barely slows it.
      for (let gi = 0; gi < level.glass.length; gi++) {
        const g = level.glass[gi];
        if (!g.alive) continue;
        const t = rayVsBox(_p0, _dir, g.box, reach);
        if (t !== null) {
          const point = _p0.clone().addScaledVector(_dir, t);
          ctx.fx.shatterGlass(g.center, g.size, point, _dir);
          level.breakGlass(gi);
          ctx.audio.play('glass', point);
          o.vel.multiplyScalar(0.8);
        }
      }

      // Bodies.
      let struckEnemy: Enemy | null = null;
      let bestT = reach;
      for (const e of ctx.director.enemies) {
        if (!e.alive) continue;
        const t = sweptCylinder(_p0, _dir, reach, e.pos, e.radius + o.radius, e.height);
        if (t !== null && t <= bestT) {
          bestT = t;
          struckEnemy = e;
        }
      }
      if (struckEnemy) {
        o.pos.copy(_p0).addScaledVector(_dir, bestT);
        if (this.hitEnemy(o, struckEnemy)) {
          this.remove(o);
          continue;
        }
      } else if (wallT <= segLen) {
        o.pos.copy(_p0).addScaledVector(_dir, wallT);
        this.land(o, _dir);
        this.remove(o);
        continue;
      } else {
        o.pos.add(_step);
      }

      o.object.position.copy(o.pos);
      o.object.rotation.x += o.spin.x * dt;
      o.object.rotation.y += o.spin.y * dt;
      o.object.rotation.z += o.spin.z * dt;

      if (o.life <= 0) {
        this.land(o, _dir);
        this.remove(o);
      }
    }
  }

  /** Returns true if the object is consumed by the impact. */
  private hitEnemy(o: ThrownObject, enemy: Enemy): boolean {
    const ctx = this.ctx;
    const dir = _dir.clone();
    ctx.audio.play('thud', o.pos);
    ctx.fx.sparks(o.pos, dir, 6, 2);
    ctx.bus.emit('hitmarker', {});

    if (o.kind === 'katana') {
      // The blade goes straight through and carries on.
      enemy.kill(o.pos.clone(), dir, 'thrown', 6);
      o.targetId = null;
      return false;
    }

    enemy.stagger(1.5);
    enemy.disarm(ctx.player.headPos);
    enemy.applyMeleeHit(1, dir, 'thrown');

    if (o.isWeapon && o.kind) {
      // It rebounds, tumbling, and can be caught again.
      const back = dir.clone().multiplyScalar(-2.2);
      back.y = 3.6;
      ctx.level.spawnWeaponPickup(o.kind, o.pos.clone(), back, o.ammo);
    } else {
      this.shatterOrb(o, dir);
    }
    return true;
  }

  /** The object has struck the world. */
  private land(o: ThrownObject, dir: Vector3): void {
    if (o.isWeapon && o.kind) {
      const v = dir.clone().multiplyScalar(-1.4);
      v.y = 1.6;
      this.ctx.level.spawnWeaponPickup(o.kind, o.pos.clone().addScaledVector(dir, -0.1), v, o.ammo);
      this.ctx.audio.play('thud', o.pos);
    } else {
      this.shatterOrb(o, dir);
    }
  }

  private remove(o: ThrownObject): void {
    const i = this.objects.indexOf(o);
    if (i >= 0) this.objects.splice(i, 1);
    this.ctx.scene.remove(o.object);
  }

  clear(): void {
    for (const o of this.objects) this.ctx.scene.remove(o.object);
    this.objects.length = 0;
  }
}
