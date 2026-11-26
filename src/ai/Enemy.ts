import { Vector3 } from 'three';
import type { EnemyKind, EnemySpawnDef } from '@/types';
import type { GameContext } from '@/core/Context';
import type { KillCause } from '@/core/events';
import type { GroundItem } from '@/world/Level';
import type { StreakRenderer } from '@/fx/Streaks';
import { WeaponInstance } from '@/combat/Weapon';
import { crystalFor } from '@/fx/Crystal';
import { type FigurePose, FigureRig, neutralPose } from '@/fx/Rig';
import { angleDelta, clamp, damp, forwardFromYaw, yawFromDir } from '@/core/math';
import {
  CONSTANT_TIME_FLOOR,
  ENEMY_AIM_TIME,
  ENEMY_DEVELOP_TIME,
  ENEMY_HEIGHT,
  ENEMY_MELEE_REACH,
  ENEMY_MELEE_RECOVER,
  ENEMY_MELEE_WINDUP,
  ENEMY_MOVE_SPEED,
  ENEMY_PREDICTION_STRENGTH,
  ENEMY_RADIUS,
  ENEMY_SIGHT_RANGE,
  MELEE_COMBO_RESET,
  MELEE_FIST_HITS_TO_KILL,
} from '@/config/constants';

type EnemyState = 'develop' | 'acquire' | 'engage' | 'pursue' | 'strike' | 'stagger';

let NEXT_ID = 1;

const SPEED: Record<EnemyKind, number> = { grunt: ENEMY_MOVE_SPEED, constant: 2.35, bulwark: 1.7 };
const _v = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _hand = { x: 0, y: 0, z: 0 };

/**
 * A red figure. Deliberately simple and legible — the player can study it at
 * 1/200th speed, so every decision it makes is telegraphed and every rule it
 * follows can be learned:
 *
 *   develop — it materialises over ~0.75s and is harmless until it has.
 *   acquire — unarmed: go and get a weapon (or, failing that, come for you).
 *   engage  — armed with a line of sight: stop, level the weapon (a red line
 *             shows exactly where the shot will go), fire. It will not shoot
 *             through a friend; it side-steps for a clear line instead.
 *   pursue  — armed without a line of sight: walk the shortest path to you.
 *   strike  — in reach: a visible wind-up, then a committed swing. Step out of
 *             the arc and it whiffs and has to recover.
 *
 * Variants change one rule each:
 *   constant — its clock never drops below a fixed rate. Standing still does
 *              not stop it. (It carries a halo that turns at a steady pace.)
 *   bulwark  — carries a slab. Rounds that hit it from the front come back.
 *              Slow to turn. Anything thrown knocks the slab aside.
 */
export class Enemy {
  readonly id = NEXT_ID++;
  readonly kind: EnemyKind;
  readonly pos: Vector3;
  readonly radius = ENEMY_RADIUS;
  readonly height = ENEMY_HEIGHT;
  yaw: number;
  alive = true;
  weapon: WeaponInstance | null = null;
  /** Why it died (read by the director when it is removed). */
  deathCause: KillCause = 'bullet';

  readonly pose: FigurePose = neutralPose();
  private readonly rig: FigureRig;
  private readonly ctx: GameContext;
  private state: EnemyState = 'develop';

  private path: Vector3[] = [];
  private pathIndex = 0;
  private repathTimer = 0;
  private aimTimer = 0;
  private blockedTimer = 0;
  private seekId = -1;
  private seekBest = Infinity;
  private seekTimer = 0;
  private readonly givenUp = new Set<number>();
  private strikeT = -1; // <0 idle; 0..windup winding; then follow-through & recovery
  private struck = false;
  private meleeHits = 0;
  private lastMeleeTime = -10;
  private staggerTimer = 0;
  private developT = 0;
  private flashT = 0;
  private ownTime = 0;
  private tickTimer = 0;
  private moving = false;
  /** Aim telegraph for this frame: muzzle → where the shot would go. */
  private teleStrength = 0;
  private readonly teleFrom = new Vector3();
  private readonly teleDir = new Vector3();
  private readonly _center = new Vector3();
  private readonly _eye = new Vector3();
  private readonly aimPoint = new Vector3();

  constructor(ctx: GameContext, def: EnemySpawnDef) {
    this.ctx = ctx;
    this.kind = def.kind ?? 'grunt';
    this.pos = new Vector3(def.pos[0], def.pos[1], def.pos[2]);
    this.yaw = def.yaw ?? Math.PI;
    const body = crystalFor(this.kind === 'constant' ? 'amber' : 'red', false);
    this.rig = new FigureRig(this.kind, body, this.kind === 'bulwark' ? crystalFor('white', false) : undefined);
    ctx.scene.add(this.rig.root);
    if (def.weapon) this.equip(new WeaponInstance(def.weapon));
    this.writePose(0);
  }

  get aiState(): EnemyState {
    return this.state;
  }

  /** Fully materialised (can be targeted by a transfer, can act). */
  get solid(): boolean {
    return this.developT >= ENEMY_DEVELOP_TIME;
  }

  get center(): Vector3 {
    return this._center.set(this.pos.x, this.pos.y + this.height * 0.58, this.pos.z);
  }

  /** Where it sees from (and where a transfer needs a clear line to). */
  get eye(): Vector3 {
    return this._eye.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
  }

  private get shieldUp(): boolean {
    return this.kind === 'bulwark' && this.staggerTimer <= 0;
  }

  // ---- shield -----------------------------------------------------------

  /** Would something travelling along `dir` be stopped by this figure's slab? */
  shieldBlocks(dir: Vector3): boolean {
    if (!this.shieldUp) return false;
    const f = forwardFromYaw(this.yaw, _v);
    return dir.x * f.x + dir.z * f.z < -0.3;
  }

  shieldNormal(out: Vector3): Vector3 {
    return forwardFromYaw(this.yaw, out);
  }

  onShieldHit(_point: Vector3): void {
    this.flashT = 0.12;
  }

  // ---- equipment --------------------------------------------------------

  private equip(weapon: WeaponInstance): void {
    this.weapon = weapon;
    this.rig.setWeapon(weapon.kind);
  }

  private releaseWeapon(vel: Vector3 | null): void {
    if (!this.weapon) return;
    const w = this.weapon;
    this.weapon = null;
    this.rig.setWeapon(null);
    // A spent firearm is still worth something: it can be thrown.
    this.rig.handWorld(_hand);
    const p = new Vector3(_hand.x, Math.max(_hand.y, this.pos.y + 0.5), _hand.z);
    this.ctx.level.spawnWeaponPickup(w.kind, p, vel ?? new Vector3(0, 0.5, 0), w.ammo);
  }

  // ---- damage -----------------------------------------------------------

  applyMeleeHit(amount: number, dir: Vector3, cause: KillCause): void {
    const now = this.ctx.time.worldElapsed;
    if (now - this.lastMeleeTime > MELEE_COMBO_RESET) this.meleeHits = 0;
    this.lastMeleeTime = now;
    this.meleeHits += amount;
    this.flashT = 0.1;
    if (this.meleeHits >= MELEE_FIST_HITS_TO_KILL) this.kill(this.center.clone(), dir, cause, 4);
  }

  stagger(duration: number): void {
    if (!this.alive) return;
    this.staggerTimer = Math.max(this.staggerTimer, duration);
    this.strikeT = -1;
    this.aimTimer = 0;
    this.flashT = 0.1;
  }

  /** Knock the weapon out of its hand — it arcs toward `toward` and can be caught. */
  disarm(toward: Vector3): void {
    if (!this.weapon) return;
    const d = _a.set(toward.x - this.pos.x, 0, toward.z - this.pos.z);
    const dist = d.length();
    if (dist > 1e-3) d.multiplyScalar(1 / dist);
    // Time of flight for a 5.4 m/s pop is ~0.6s; aim to land just short of the thrower.
    const speed = clamp((dist - 0.9) / 0.62, 0.6, 7);
    this.releaseWeapon(new Vector3(d.x * speed, 5.4, d.z * speed));
    this.path = [];
  }

  kill(point: Vector3, dir: Vector3, cause: KillCause, force = 5): void {
    if (!this.alive) return;
    this.alive = false;
    this.deathCause = cause;
    this.pose.flash = 0;
    this.rig.applyPose(this.pose);
    const tone = this.kind === 'constant' ? 'amber' : 'red';
    this.ctx.fx.shatter(this.rig.pieces(false), tone, point, dir, force);
    if (this.kind === 'bulwark') this.ctx.fx.shatter(this.rig.shieldPieces(), 'white', point, dir, force * 0.6, { crack: 0 });
    this.ctx.audio.play('shatter', this.center);
    this.releaseWeapon(new Vector3(dir.x * 1.2, 1.4, dir.z * 1.2));
    this.rig.dispose();
    this.ctx.director.reportKill(this);
  }

  /** The player has taken this body. It does not shatter; its weapon is left hanging in the air. */
  vacate(_head: Vector3): void {
    if (!this.alive) return;
    this.alive = false;
    this.deathCause = 'transfer';
    const f = forwardFromYaw(this.yaw, _a);
    this.releaseWeapon(new Vector3(f.x * 1.1, 2.6, f.z * 1.1));
    this.rig.dispose();
    this.ctx.director.reportKill(this);
  }

  /** The player is suddenly somewhere else: everyone has to find them again. */
  loseTrack(): void {
    this.aimTimer = 0;
    this.path = [];
  }

  // ---- update -----------------------------------------------------------

  /** World delta this figure experiences this frame. */
  private ownDt(): number {
    const time = this.ctx.time;
    const base = this.ctx.level.localDt(this.pos, time);
    if (this.kind === 'constant' && time.borrowPhase !== 'borrowing') {
      return Math.max(base, time.unscaledDt * CONSTANT_TIME_FLOOR);
    }
    return base;
  }

  update(): void {
    if (!this.alive) return;
    const dt = this.ownDt();
    const real = this.ctx.time.unscaledDt;
    if (this.flashT > 0) this.flashT -= real;
    this.teleStrength = 0;
    if (dt <= 0) {
      this.writePose(0);
      return;
    }
    this.ownTime += dt;
    this.moving = false;
    this.pose.recoil = Math.max(0, this.pose.recoil - dt * 7);

    if (this.kind === 'constant') {
      this.tickTimer -= dt;
      if (this.tickTimer <= 0) {
        this.tickTimer += 0.5;
        this.ctx.audio.play('tick', this.center);
      }
    }

    const player = this.ctx.player;
    if (this.developT < ENEMY_DEVELOP_TIME) {
      this.state = 'develop';
      this.developT += dt;
      this.faceToward(player.pos, dt, 4);
    } else if (this.staggerTimer > 0) {
      this.state = 'stagger';
      this.staggerTimer -= dt;
    } else if (player.alive) {
      if (this.strikeT >= 0) this.tickStrike(dt);
      else if (!this.weapon || this.weapon.def.category === 'melee') this.tickClose(dt);
      else this.tickArmed(dt);
      this.ctx.level.resolveActor(this.pos, this.radius, this.height);
    }

    this.writePose(dt);
  }

  /** Unarmed, or holding a melee weapon: close the distance. */
  private tickClose(dt: number): void {
    const player = this.ctx.player;
    const distToPlayer = this.distXZ(this.pos, player.pos);

    if (!this.weapon && distToPlayer > 3) {
      // Highest priority: a weapon on the floor.
      this.state = 'acquire';
      let target: GroundItem | null = null;
      let bestD = Infinity;
      for (const item of this.ctx.level.items) {
        if (item.type !== 'weapon' || !item.settled || this.givenUp.has(item.id)) continue;
        // A spent firearm is not worth the walk.
        if (item.ammo === 0 && item.kind !== 'bat' && item.kind !== 'katana') continue;
        const d = item.pos.distanceToSquared(this.pos);
        if (d < bestD) {
          bestD = d;
          target = item;
        }
      }
      if (target) {
        const reach = this.distXZ(this.pos, target.pos);
        // Generous reach, so something resting on a plinth can be lifted off it.
        if (reach < 1.3) {
          if (target.kind) {
            const w = new WeaponInstance(target.kind);
            if (target.ammo !== undefined) w.ammo = target.ammo;
            this.equip(w);
          }
          this.ctx.level.removeItem(target);
          this.ctx.audio.play('pickup', this.center);
          this.path = [];
          this.seekId = -1;
          return;
        }
        // If it cannot actually be reached, stop trying and go for the player instead.
        if (target.id !== this.seekId || reach < this.seekBest - 0.25) {
          this.seekId = target.id;
          this.seekBest = reach;
          this.seekTimer = 0;
        } else {
          this.seekTimer += dt;
          if (this.seekTimer > 2.2) this.givenUp.add(target.id);
        }
        this.navigateTo(dt, target.pos, 1.25);
        return;
      }
    }

    this.state = 'pursue';
    if (this.inReach()) {
      this.strikeT = 0;
      this.struck = false;
      this.ctx.audio.play('windup', this.center);
      return;
    }
    this.navigateTo(dt, player.pos, this.weapon ? 1.1 : 1.25);
  }

  private inReach(): boolean {
    const player = this.ctx.player;
    return this.distXZ(this.pos, player.pos) <= ENEMY_MELEE_REACH && Math.abs(player.pos.y - this.pos.y) < 1.5;
  }

  /** A committed melee swing: wind-up → strike → recovery. */
  private tickStrike(dt: number): void {
    this.state = 'strike';
    const player = this.ctx.player;
    const before = this.strikeT;
    this.strikeT += dt;
    if (before < ENEMY_MELEE_WINDUP) this.faceToward(player.pos, dt, 6);
    if (!this.struck && this.strikeT >= ENEMY_MELEE_WINDUP) {
      this.struck = true;
      this.ctx.audio.play('swing', this.center);
      // It lands only if you are still inside the arc.
      const f = forwardFromYaw(this.yaw, _a);
      _b.set(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z);
      const d = _b.length();
      const facing = d > 1e-3 ? (_b.x * f.x + _b.z * f.z) / d : 1;
      if (d <= ENEMY_MELEE_REACH + 0.25 && facing > 0.35 && Math.abs(player.pos.y - this.pos.y) < 1.5) {
        player.die('struck', this.center);
      }
    }
    if (this.strikeT >= ENEMY_MELEE_WINDUP + 0.16 + ENEMY_MELEE_RECOVER) this.strikeT = -1;
  }

  private tickArmed(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    const weapon = this.weapon!;
    const def = weapon.def;

    // Where the round would leave from and where it should go.
    this.rig.handWorld(_hand);
    const muzzle = this.teleFrom.set(_hand.x, _hand.y, _hand.z);
    const target = this.aimPoint.set(player.pos.x, player.pos.y + 1.15, player.pos.z);
    // Sight is eye to eye, so a figure can see (and be seen) over low walls.
    const eye = this.eye;
    const dist = eye.distanceTo(player.headPos);
    const toTarget = _v.subVectors(player.headPos, eye);
    const los = dist < ENEMY_SIGHT_RANGE && ctx.level.rayToSolid(eye, toTarget.multiplyScalar(1 / Math.max(dist, 1e-4)), dist) >= dist;

    // Burst rounds keep leaving the barrel whatever else happens.
    const wantRange = def.kind === 'shotgun' ? 9 : this.kind === 'bulwark' ? 8 : 40;

    if (!los) {
      this.state = 'pursue';
      this.aimTimer = Math.max(0, this.aimTimer - dt);
      this.blockedTimer = 0;
      const shots = weapon.update(dt, false);
      for (let s = 0; s < shots; s++) this.fire();
      this.navigateTo(dt, player.pos, 1);
      return;
    }

    this.state = 'engage';
    this.faceToward(player.pos, dt, this.kind === 'bulwark' ? 2.2 : 9);
    if (this.inReach()) {
      // Too close to shoot comfortably — club them.
      this.strikeT = 0;
      this.struck = false;
      this.ctx.audio.play('windup', this.center);
      return;
    }
    if (dist > wantRange) this.navigateTo(dt, player.pos, 0.75, true);

    // Lead the target: aim where it will be when the round arrives.
    const flight = muzzle.distanceTo(target) / def.projectileSpeed;
    target.addScaledVector(player.velocity, flight * ENEMY_PREDICTION_STRENGTH);
    target.y = Math.max(target.y, player.pos.y + 0.5);
    this.teleDir.subVectors(target, muzzle).normalize();

    // Only shoot when actually pointing at them, and never through a friend.
    const f = forwardFromYaw(this.yaw, _a);
    const onTarget = f.x * this.teleDir.x + f.z * this.teleDir.z > 0.96 * Math.hypot(this.teleDir.x, this.teleDir.z);
    const blocked = this.allyInLine(muzzle, this.teleDir, muzzle.distanceTo(target));
    if (blocked) {
      this.blockedTimer += dt;
      this.aimTimer = Math.min(this.aimTimer, ENEMY_AIM_TIME * 0.85);
      if (this.blockedTimer > 0.25) this.sidestep(dt);
    } else {
      this.blockedTimer = 0;
    }
    if (onTarget && weapon.readyToFire) this.aimTimer += dt;

    const ready = this.aimTimer >= ENEMY_AIM_TIME && onTarget && !blocked;
    const shots = weapon.update(dt, ready);
    if (shots > 0) {
      for (let s = 0; s < shots; s++) this.fire();
      if (ready) this.aimTimer = ENEMY_AIM_TIME * 0.3;
    }
    // The telegraph: a line that firms up as the trigger pull approaches.
    this.teleStrength = weapon.bursting ? 1 : clamp((this.aimTimer / ENEMY_AIM_TIME - 0.3) / 0.7, 0, 1);

    if (weapon.empty) {
      this.releaseWeapon(null);
      this.aimTimer = 0;
    }
  }

  private allyInLine(from: Vector3, dir: Vector3, maxDist: number): boolean {
    for (const e of this.ctx.director.enemies) {
      if (e === this || !e.alive) continue;
      _b.subVectors(e.center, from);
      const along = _b.dot(dir);
      if (along < 0.3 || along > maxDist) continue;
      if (_b.addScaledVector(dir, -along).lengthSq() < 0.55 * 0.55) return true;
    }
    return false;
  }

  private sidestep(dt: number): void {
    // Step sideways (a fixed side per figure, so it is predictable) for a clear line.
    const f = forwardFromYaw(this.yaw, _a);
    const side = this.id % 2 === 0 ? 1 : -1;
    const step = SPEED[this.kind] * 0.7 * dt;
    this.pos.x += -f.z * side * step;
    this.pos.z += f.x * side * step;
    this.moving = true;
    this.pose.walk += step * 3.4;
  }

  private fire(): void {
    const weapon = this.weapon;
    if (!weapon) return;
    const ctx = this.ctx;
    const def = weapon.def;
    this.rig.handWorld(_hand);
    const origin = _b.set(_hand.x, _hand.y, _hand.z).addScaledVector(this.teleDir, 0.3);
    const pellets = def.fireMode === 'spread' ? def.pelletCount : 1;
    for (let i = 0; i < pellets; i++) {
      const dir = _v.copy(this.teleDir);
      if (def.spread > 0) {
        dir.x += (ctx.rng() - 0.5) * def.spread * 2;
        dir.y += (ctx.rng() - 0.5) * def.spread * 2;
        dir.z += (ctx.rng() - 0.5) * def.spread * 2;
      }
      ctx.projectiles.spawn(origin, dir, {
        faction: 'enemy',
        speed: def.projectileSpeed,
        piercing: def.piercing,
        glass: def.glass,
        deflectable: def.deflectable,
        look: def.kind === 'shotgun' ? 'pellet' : def.kind === 'nailgun' ? 'nail' : 'bullet',
        ownerId: this.id,
      });
    }
    this.pose.recoil = 1;
    ctx.audio.play(def.kind === 'shotgun' ? 'shotgun' : def.kind === 'nailgun' ? 'nail' : 'shoot', origin);
    ctx.fx.muzzle(origin, this.teleDir, true);
  }

  // ---- movement ---------------------------------------------------------

  private navigateTo(dt: number, goal: Vector3, speedMul: number, keepFacing = false): void {
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 || this.path.length === 0 || this.distXZ(this.path[this.path.length - 1], goal) > 1.5) {
      this.path = this.ctx.level.nav.findPath(this.pos, goal) ?? [goal.clone()];
      this.pathIndex = 0;
      this.repathTimer = 0.4;
    }
    let wp = this.path[this.pathIndex];
    while (wp && this.distXZ(this.pos, wp) < 0.45 && this.pathIndex < this.path.length - 1) {
      this.pathIndex++;
      wp = this.path[this.pathIndex];
    }
    if (!wp) return;
    const dx = wp.x - this.pos.x;
    const dz = wp.z - this.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const step = Math.min(SPEED[this.kind] * speedMul * dt, len);
    this.pos.x += (dx / len) * step;
    this.pos.z += (dz / len) * step;
    this.pose.walk += step * 3.4;
    this.moving = true;
    if (!keepFacing) {
      const desired = yawFromDir(dx, dz);
      this.yaw += angleDelta(this.yaw, desired) * damp(8, dt);
    }
  }

  private faceToward(target: Vector3, dt: number, rate: number): void {
    const desired = yawFromDir(target.x - this.pos.x, target.z - this.pos.z);
    const delta = angleDelta(this.yaw, desired);
    if (this.kind === 'bulwark') {
      // A hard cap on turn rate: this is what makes flanking work.
      this.yaw += clamp(delta, -rate * dt, rate * dt);
    } else {
      this.yaw += delta * damp(rate, dt);
    }
  }

  private distXZ(a: Vector3, b: Vector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  // ---- presentation -----------------------------------------------------

  private writePose(dt: number): void {
    const p = this.pose;
    p.x = this.pos.x;
    p.y = this.pos.y;
    p.z = this.pos.z;
    p.yaw = this.yaw;
    const k = dt > 0 ? damp(9, dt) : 0;
    p.move += ((this.moving ? 1 : 0) - p.move) * k;

    const armed = this.weapon !== null && this.weapon.def.category === 'firearm';
    const wantAim = armed && this.state === 'engage' ? 1 : 0;
    p.aim += (wantAim - p.aim) * (dt > 0 ? damp(11, dt) : 0);
    if (wantAim) {
      const dy = this.aimPoint.y - (this.pos.y + 1.4);
      p.aimPitch = Math.atan2(dy, Math.max(0.5, this.distXZ(this.pos, this.aimPoint)));
    }

    if (this.strikeT < 0) p.strike += (0 - p.strike) * k;
    else if (this.strikeT < ENEMY_MELEE_WINDUP) p.strike = this.strikeT / ENEMY_MELEE_WINDUP;
    else p.strike = 1 + clamp((this.strikeT - ENEMY_MELEE_WINDUP) / 0.16, 0, 1) * (1 - clamp((this.strikeT - ENEMY_MELEE_WINDUP - 0.3) / 0.4, 0, 1));

    p.stagger += ((this.staggerTimer > 0 ? 1 : 0) - p.stagger) * (dt > 0 ? damp(14, dt) : 0);
    p.clock = this.ownTime * 2.4;
    p.develop = clamp(this.developT / ENEMY_DEVELOP_TIME, 0, 1);
    p.flash = clamp(this.flashT / 0.1, 0, 1) * 0.8;
    this.rig.applyPose(p);
  }

  /** Draw this figure's aim telegraph (called once per frame by the director). */
  drawTelegraph(streaks: StreakRenderer): void {
    if (this.teleStrength <= 0.01 || !this.alive) return;
    const len = Math.min(this.ctx.level.rayToSolid(this.teleFrom, this.teleDir, 34), 34);
    _a.copy(this.teleFrom);
    _b.copy(this.teleFrom).addScaledVector(this.teleDir, len);
    const s = this.teleStrength;
    const a = 0.12 + 0.55 * s * s;
    streaks.line(_a, _b, 0.012 + 0.012 * s, [2.4, 0.1, 0.12, a], [2.4, 0.1, 0.12, a * 0.25]);
    streaks.glow(_a, 0.05 + 0.1 * s, [3, 0.4, 0.3, 0.5 * s]);
  }

  get weaponKind(): string | null {
    return this.weapon ? this.weapon.kind : null;
  }

  /** Remove without ceremony (level teardown). */
  dispose(): void {
    this.alive = false;
    this.rig.dispose();
  }
}
