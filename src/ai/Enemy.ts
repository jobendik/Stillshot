import { Group, Vector3 } from 'three';
import type { EnemySpawnDef } from '@/types';
import type { GameContext } from '@/core/Context';
import type { Player } from '@/player/Player';
import type { GroundItem } from '@/world/Level';
import { WeaponInstance } from '@/combat/Weapon';
import { buildEnemyModel, buildWeaponModel, disposeModelGeometry } from '@/fx/Models';
import { segmentClear } from '@/world/Collision';
import { angleDelta, forwardFromYaw, yawFromDir } from '@/core/math';
import {
  ENEMY_AIM_TIME,
  ENEMY_HEIGHT,
  ENEMY_MOVE_SPEED,
  ENEMY_PREDICTION_STRENGTH,
  ENEMY_RADIUS,
  ENEMY_SIGHT_RANGE,
  MELEE_COMBO_RESET,
  MELEE_FIST_HITS_TO_KILL,
  MELEE_RANGE,
} from '@/config/constants';

type EnemyState = 'acquire' | 'engage' | 'pursue';

let NEXT_ID = 1;

/**
 * A hostile red entity. Intentionally simplistic and predictable — no cover, no
 * retreat, no coordination. Its behavior tree is a strict three-state hierarchy:
 *   1. ACQUIRE — unarmed? ignore everything and sprint to the nearest weapon.
 *   2. ENGAGE  — armed + line of sight? halt, aim, fire (with lead prediction).
 *   3. PURSUE  — armed but no LOS? path the shortest route straight at the player.
 */
export class Enemy {
  readonly id = NEXT_ID++;
  readonly pos: Vector3;
  readonly radius = ENEMY_RADIUS;
  readonly height = ENEMY_HEIGHT;
  yaw: number;
  alive = true;
  weapon: WeaponInstance | null = null;

  private readonly ctx: GameContext;
  private readonly model: Group;
  private hand: Group | null = null;
  private state: EnemyState = 'pursue';

  /** Current behavior-tree state (exposed for debugging / HUD inspection). */
  get aiState(): EnemyState {
    return this.state;
  }

  private path: Vector3[] = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private aimTimer = 0;
  private meleeWindup = 0;

  // Unarmed melee combo bookkeeping (player strikes accumulate here).
  private meleeHits = 0;
  private lastMeleeTime = -10;

  private staggerTimer = 0;
  private readonly _v = new Vector3();
  private readonly _aim = new Vector3();
  private readonly _center = new Vector3();

  constructor(ctx: GameContext, def: EnemySpawnDef) {
    this.ctx = ctx;
    this.pos = new Vector3(def.pos[0], def.pos[1], def.pos[2]);
    this.yaw = def.yaw ?? Math.PI;
    this.model = buildEnemyModel();
    this.model.position.copy(this.pos);
    ctx.scene.add(this.model);
    if (def.weapon) this.equip(new WeaponInstance(def.weapon));
  }

  get center(): Vector3 {
    // Dedicated scratch (NOT the movement scratch _v) to avoid aliasing.
    return this._center.set(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z);
  }

  private get chestY(): number {
    return this.pos.y + 1.2;
  }

  private equip(weapon: WeaponInstance): void {
    this.weapon = weapon;
    if (this.hand) this.model.remove(this.hand);
    this.hand = new Group();
    const model = buildWeaponModel(weapon.kind);
    model.scale.setScalar(0.9);
    this.hand.add(model);
    this.hand.position.set(0.28, 1.18, -0.15);
    this.model.add(this.hand);
  }

  private dropWeapon(upward: boolean): void {
    if (!this.weapon) return;
    const kind = this.weapon.kind;
    const ammo = this.weapon.ammo;
    const hasAmmo = this.weapon.ammo > 0 || this.weapon.def.category !== 'firearm';
    this.weapon = null;
    if (this.hand) {
      this.model.remove(this.hand);
      this.hand = null;
    }
    if (hasAmmo) {
      const vel = upward
        ? new Vector3((this.ctx.rng() - 0.5) * 2, 4.5, (this.ctx.rng() - 0.5) * 2)
        : undefined;
      this.ctx.level.spawnWeaponPickup(kind, this.center.clone().setY(this.pos.y + 1), vel, ammo);
    }
  }

  // ---- damage / melee ---------------------------------------------------

  applyMeleeHit(amount: number): void {
    const now = this.ctx.time.worldElapsed;
    if (now - this.lastMeleeTime > MELEE_COMBO_RESET) this.meleeHits = 0;
    this.lastMeleeTime = now;
    this.meleeHits += amount;
    if (this.meleeHits >= MELEE_FIST_HITS_TO_KILL) {
      this.kill(this.center.clone(), forwardFromYaw(this.yaw));
    }
  }

  stagger(duration: number): void {
    this.staggerTimer = Math.max(this.staggerTimer, duration);
  }

  disarm(): void {
    this.dropWeapon(true);
    this.state = 'acquire';
    this.path = [];
  }

  kill(point: Vector3, dir: Vector3): void {
    if (!this.alive) return;
    this.alive = false;
    this.ctx.fx.shatterEnemy(point, this.pos.clone(), dir);
    this.ctx.audio.play('shatter');
    this.dropWeapon(false);
    disposeModelGeometry(this.model);
    this.ctx.scene.remove(this.model);
  }

  // ---- update -----------------------------------------------------------

  update(scaledDt: number): void {
    if (!this.alive || scaledDt <= 0) return;

    if (this.staggerTimer > 0) {
      this.staggerTimer -= scaledDt;
      this.syncModel(scaledDt, true);
      return;
    }

    const player = this.ctx.player;
    if (!player.alive) {
      this.syncModel(scaledDt, false);
      return;
    }

    if (!this.weapon) this.tickAcquire(scaledDt, player.pos);
    else this.tickArmed(scaledDt, player);

    this.ctx.level.resolveActor(this.pos, this.radius, this.height);
    this.syncModel(scaledDt, false);
  }

  private tickAcquire(scaledDt: number, playerPos: Vector3): void {
    this.state = 'acquire';
    // Highest priority: sprint to the nearest dropped weapon, ignoring the player.
    let target: GroundItem | null = null;
    let bestD = Infinity;
    for (const item of this.ctx.level.items) {
      if (item.type !== 'weapon' || !item.settled) continue;
      const d = item.pos.distanceToSquared(this.pos);
      if (d < bestD) {
        bestD = d;
        target = item;
      }
    }
    if (target) {
      if (this.pos.distanceTo(target.pos) < 0.9) {
        if (target.kind) {
          const w = new WeaponInstance(target.kind);
          if (target.ammo !== undefined) w.ammo = target.ammo; // preserve unfired rounds
          this.equip(w);
        }
        this.ctx.level.removeItem(target);
        this.path = [];
        return;
      }
      this.navigateTo(scaledDt, target.pos);
    } else {
      // No weapon anywhere — close on the player and bludgeon them.
      this.navigateTo(scaledDt, playerPos);
      this.tryMelee(scaledDt, playerPos);
    }
  }

  private tickArmed(scaledDt: number, player: Player): void {
    const eyeTarget = this._aim.set(player.pos.x, this.chestY, player.pos.z);
    const dist = this.pos.distanceTo(player.pos);
    const hasLOS =
      dist < ENEMY_SIGHT_RANGE &&
      segmentClear(this.center, eyeTarget, this.ctx.level.solids);

    if (hasLOS) {
      this.state = 'engage';
      // Halt and face the target.
      this.faceToward(player.pos, scaledDt, 9);
      this.aimTimer += scaledDt;
      const ready = this.aimTimer >= ENEMY_AIM_TIME;
      // Always advance the weapon clock with real world-dt so an in-flight burst
      // keeps ticking (the trigger is uninterruptible). `ready` only gates a NEW
      // trigger pull (the aim-up window) — never the continuation of a burst.
      const shots = this.weapon!.update(scaledDt, ready);
      if (shots > 0) {
        for (let s = 0; s < shots; s++) this.fire(player);
        if (ready) this.aimTimer = ENEMY_AIM_TIME * 0.4; // settle only after a fresh pull
      }
      if (this.weapon!.empty) {
        this.dropWeapon(false);
        this.state = 'acquire';
      }
      // Point-blank: if the player closes the gap, melee them.
      this.tryMelee(scaledDt, player.pos);
    } else {
      this.state = 'pursue';
      this.aimTimer = Math.max(0, this.aimTimer - scaledDt);
      // Keep the burst alive even while moving (uninterruptible trigger).
      const shots = this.weapon!.update(scaledDt, false);
      for (let s = 0; s < shots; s++) this.fire(player);
      this.navigateTo(scaledDt, player.pos);
    }
  }

  private fire(player: Player): void {
    if (!this.weapon) return;
    const def = this.weapon.def;
    const origin = new Vector3(this.pos.x, this.chestY, this.pos.z).addScaledVector(
      forwardFromYaw(this.yaw),
      0.5,
    );

    // Predictive lead: aim where the player WILL be, based on their velocity.
    const aimPoint = new Vector3(player.pos.x, player.pos.y + 1.1, player.pos.z);
    const flightTime = origin.distanceTo(aimPoint) / def.projectileSpeed;
    aimPoint.addScaledVector(player.velocity, flightTime * ENEMY_PREDICTION_STRENGTH);
    const baseDir = aimPoint.sub(origin).normalize();

    const pellets = def.fireMode === 'spread' ? def.pelletCount : 1;
    for (let i = 0; i < pellets; i++) {
      const dir = baseDir.clone();
      if (def.spread > 0) {
        dir.x += (this.ctx.rng() - 0.5) * def.spread * 2;
        dir.y += (this.ctx.rng() - 0.5) * def.spread * 2;
        dir.z += (this.ctx.rng() - 0.5) * def.spread * 2;
        dir.normalize();
      }
      this.ctx.projectiles.spawn(origin.clone(), dir, {
        faction: 'enemy',
        speed: def.projectileSpeed,
        piercing: def.piercing,
        glass: def.glass,
        deflectable: def.deflectable,
      });
    }
    this.ctx.audio.play('shoot');
  }

  private tryMelee(scaledDt: number, playerPos: Vector3): void {
    if (this.pos.distanceTo(playerPos) <= MELEE_RANGE) {
      this.meleeWindup += scaledDt;
      if (this.meleeWindup >= 0.35) {
        this.ctx.player.die('melee');
        this.meleeWindup = 0;
      }
    } else {
      this.meleeWindup = 0;
    }
  }

  // ---- movement ---------------------------------------------------------

  private navigateTo(scaledDt: number, goal: Vector3): void {
    this.repathTimer -= scaledDt;
    const needRepath =
      this.repathTimer <= 0 ||
      this.path.length === 0 ||
      (this.path.length > 0 && this.path[this.path.length - 1].distanceTo(goal) > 1.5);
    if (needRepath) {
      const path = this.ctx.level.nav.findPath(this.pos, goal);
      this.path = path ?? [goal.clone()];
      this.pathIndex = 0;
      this.repathTimer = 0.4;
    }

    if (this.path.length === 0) return;
    let wp = this.path[this.pathIndex];
    while (wp && this.distXZ(this.pos, wp) < 0.45 && this.pathIndex < this.path.length - 1) {
      this.pathIndex++;
      wp = this.path[this.pathIndex];
    }
    if (!wp) return;

    const dir = this._v.set(wp.x - this.pos.x, 0, wp.z - this.pos.z);
    const len = dir.length();
    if (len > 1e-4) {
      dir.multiplyScalar(1 / len);
      this.pos.addScaledVector(dir, Math.min(ENEMY_MOVE_SPEED * scaledDt, len));
      this.faceToward(this.ctx.player.pos, scaledDt, 7);
    }
  }

  private faceToward(target: Vector3, scaledDt: number, rate: number): void {
    const desired = yawFromDir(target.x - this.pos.x, target.z - this.pos.z);
    this.yaw += angleDelta(this.yaw, desired) * Math.min(1, rate * scaledDt);
  }

  private distXZ(a: Vector3, b: Vector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  private syncModel(_scaledDt: number, frozen: boolean): void {
    this.model.position.copy(this.pos);
    this.model.rotation.y = this.yaw;
    // A faint idle/aim bob so the figures don't read as statues when time crawls.
    if (!frozen) {
      const bob = Math.sin(this.ctx.time.worldElapsed * 6 + this.id) * 0.012;
      this.model.position.y = this.pos.y + bob;
    }
  }

  dispose(): void {
    disposeModelGeometry(this.model);
    this.ctx.scene.remove(this.model);
  }
}
