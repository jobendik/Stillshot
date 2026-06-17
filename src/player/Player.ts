import { type Object3D, Group, PerspectiveCamera, Vector3 } from 'three';
import type { WeaponKind } from '@/types';
import type { GameContext } from '@/core/Context';
import type { Enemy } from '@/ai/Enemy';
import type { GroundItem } from '@/world/Level';
import { WeaponInstance } from '@/combat/Weapon';
import { buildThrowableModel, buildWeaponModel } from '@/fx/Models';
import { clamp } from '@/core/math';
import {
  HOTSWITCH_COOLDOWN,
  HOTSWITCH_RANGE,
  KATANA_SLICE_RADIUS,
  MELEE_RANGE,
  MOUSE_SENSITIVITY,
  PITCH_LIMIT,
  PLAYER_ACCEL,
  PLAYER_AIR_ACCEL,
  PLAYER_EYE_HEIGHT,
  PLAYER_GRAVITY,
  PLAYER_HEIGHT,
  PLAYER_JUMP_SPEED,
  PLAYER_MOVE_SPEED,
  PLAYER_RADIUS,
} from '@/config/constants';

type Held =
  | { type: 'fists' }
  | { type: 'weapon'; weapon: WeaponInstance }
  | { type: 'throwable'; radius: number };

/**
 * Kinematic first-person controller. Crucially DECOUPLED from world time: it
 * integrates on unscaled (real) time so keystrokes feel instant even while the
 * world runs at 1/200th speed. The act of moving/looking is precisely what
 * pushes the global time scale up (see TimeController).
 */
export class Player {
  readonly pos = new Vector3();
  readonly velocity = new Vector3();
  readonly radius = PLAYER_RADIUS;
  readonly height = PLAYER_HEIGHT;
  yaw = 0;
  pitch = 0;
  grounded = true;
  alive = true;

  held: Held = { type: 'fists' };

  // Blade-defense volume, published for the projectile system each frame.
  bladeActive = false;
  readonly bladeCenter = new Vector3();
  bladeRadius = 0;
  readonly bladeNormal = new Vector3(0, 0, -1);
  private bladeCanSlice = false;
  private bladeCanDeflect = false;

  private hotswitchTimer = 0;
  private swingTimer = 0;
  private recoil = 0;

  private readonly ctx: GameContext;
  private readonly camera: PerspectiveCamera;
  private readonly viewmodel = new Group();

  private readonly _fwd = new Vector3();
  private readonly _camPos = new Vector3();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.camera = ctx.camera;
    this.camera.rotation.order = 'YXZ';
    this.camera.add(this.viewmodel);
  }

  // ---- lifecycle --------------------------------------------------------

  spawnAt(pos: Vector3, yaw: number): void {
    this.pos.copy(pos);
    this.pos.y = this.ctx.level.floorY;
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = true;
    this.alive = true;
    this.hotswitchTimer = 0;
    this.setHeld({ type: 'fists' });
    this.syncCamera();
  }

  get heldKind(): WeaponKind | 'ball' | null {
    if (this.held.type === 'fists') return 'fist';
    if (this.held.type === 'throwable') return 'ball';
    return this.held.weapon.kind;
  }

  get heldAmmo(): number {
    return this.held.type === 'weapon' ? this.held.weapon.ammo : 0;
  }

  get hotswitchReady(): boolean {
    return this.hotswitchTimer <= 0;
  }

  get hotswitchCooldownFraction(): number {
    return clamp(this.hotswitchTimer / HOTSWITCH_COOLDOWN, 0, 1);
  }

  private get camPos(): Vector3 {
    return this._camPos.set(this.pos.x, this.pos.y + PLAYER_EYE_HEIGHT, this.pos.z);
  }

  private forward(): Vector3 {
    return this.camera.getWorldDirection(this._fwd);
  }

  // ---- per-frame --------------------------------------------------------

  update(unscaledDt: number, worldDt: number): void {
    if (!this.alive) return;

    this.applyLook();
    this.applyMovement(unscaledDt);
    this.syncCamera();
    this.handleActions(unscaledDt);
    this.updateBlade(unscaledDt);
    this.updateViewmodel(unscaledDt);

    if (this.hotswitchTimer > 0) this.hotswitchTimer -= worldDt;
  }

  private applyLook(): void {
    const input = this.ctx.input;
    this.yaw -= input.mouseDX * MOUSE_SENSITIVITY;
    this.pitch -= input.mouseDY * MOUSE_SENSITIVITY;
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  private applyMovement(dt: number): void {
    const input = this.ctx.input;
    const intent = input.moveIntent();

    // Build world-space move direction from yaw.
    // forward F = (-sin, 0, -cos), right R = (cos, 0, -sin); W gives intent.z = -1,
    // so world dir = intent.x*R + (-intent.z)*F.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wishX = intent.x * cos + intent.z * sin;
    const wishZ = -intent.x * sin + intent.z * cos;

    const targetVX = wishX * PLAYER_MOVE_SPEED;
    const targetVZ = wishZ * PLAYER_MOVE_SPEED;
    const accel = this.grounded ? PLAYER_ACCEL : PLAYER_AIR_ACCEL;
    const k = Math.min(1, accel * dt);
    this.velocity.x += (targetVX - this.velocity.x) * k;
    this.velocity.z += (targetVZ - this.velocity.z) * k;

    // Jump.
    this.grounded = this.pos.y <= this.ctx.level.floorY + 1e-3;
    if (input.pressed('jump') && this.grounded) {
      this.velocity.y = PLAYER_JUMP_SPEED;
      this.grounded = false;
    }

    // Gravity + integrate (real time — the player's own arc is crisp).
    this.velocity.y -= PLAYER_GRAVITY * dt;
    this.pos.addScaledVector(this.velocity, dt);

    // Ground plane.
    if (this.pos.y <= this.ctx.level.floorY) {
      this.pos.y = this.ctx.level.floorY;
      this.velocity.y = 0;
      this.grounded = true;
    }

    // Horizontal world collision + arena bounds.
    this.ctx.level.resolveActor(this.pos, this.radius, this.height);
  }

  private syncCamera(): void {
    this.camera.position.copy(this.camPos);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  // ---- actions ----------------------------------------------------------

  private handleActions(dt: number): void {
    const input = this.ctx.input;

    // Throw (right mouse / Q).
    if (input.pressed('altFire')) this.throwHeld();

    // Pickup (E).
    if (input.pressed('use')) this.tryPickup();

    // Hotswitch (Shift).
    if (input.pressed('hotswitch')) this.tryHotswitch();

    // Primary action.
    if (this.held.type === 'weapon' && this.held.weapon.def.category === 'firearm') {
      this.fireFirearm(dt);
    } else if (input.pressed('fire') || input.pressed('melee')) {
      this.startMelee();
    }
  }

  private fireFirearm(dt: number): void {
    if (this.held.type !== 'weapon') return;
    const weapon = this.held.weapon;
    const triggered = this.ctx.input.pressed('fire');
    if (triggered && weapon.empty) {
      this.ctx.audio.play('dryfire');
      this.ctx.bus.emit('weapon:empty', {});
    }
    const shots = weapon.update(dt, triggered);
    if (shots > 0) {
      const def = weapon.def;
      const origin = this.camPos.clone().addScaledVector(this.forward(), 0.5);
      for (let s = 0; s < shots; s++) {
        const pellets = def.fireMode === 'spread' ? def.pelletCount : 1;
        for (let i = 0; i < pellets; i++) {
          const dir = this.forward().clone();
          if (def.spread > 0) {
            dir.x += (this.ctx.rng() - 0.5) * def.spread * 2;
            dir.y += (this.ctx.rng() - 0.5) * def.spread * 2;
            dir.z += (this.ctx.rng() - 0.5) * def.spread * 2;
            dir.normalize();
          }
          this.ctx.projectiles.spawn(origin.clone(), dir, {
            faction: 'player',
            speed: def.projectileSpeed,
            piercing: def.piercing,
            glass: def.glass,
            deflectable: def.deflectable,
          });
        }
      }
      this.recoil = Math.min(0.12, this.recoil + 0.05);
      this.ctx.audio.play('shoot');
      this.ctx.fx.muzzleFlash(origin, this.forward());
      this.ctx.bus.emit('weapon:fired', { kind: def.kind });
      this.ctx.bus.emit('weapon:changed', { kind: def.kind, ammo: weapon.ammo });
    }
  }

  private startMelee(): void {
    if (this.swingTimer > 0) return;
    const isWeapon = this.held.type === 'weapon';
    const def = isWeapon ? (this.held as { weapon: WeaponInstance }).weapon.def : null;
    this.swingTimer = 0.2;
    this.ctx.audio.play('swing');

    // Resolve the melee arc immediately at the apex of the swing.
    const fwd = this.forward();
    const enemies = this.ctx.director.enemies;
    let nearest: (typeof enemies)[number] | null = null;
    let nearestD = Infinity;
    const hitArc: typeof enemies = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const to = e.center.clone().sub(this.camPos);
      const dist = to.length();
      if (dist > MELEE_RANGE + e.radius) continue;
      to.normalize();
      if (to.dot(fwd) < 0.5) continue; // ~60° arc
      hitArc.push(e);
      if (dist < nearestD) {
        nearestD = dist;
        nearest = e;
      }
    }

    if (def?.kind === 'katana') {
      for (const e of hitArc) e.kill(e.center.clone(), fwd);
    } else if (def?.category === 'melee') {
      // Improvised weapon — single kinetic kill + durability cost.
      if (nearest) {
        nearest.kill(nearest.center.clone(), fwd);
        if ((this.held as { weapon: WeaponInstance }).weapon.degrade()) this.shatterHeld();
      }
    } else {
      // Fists — three accumulating strikes.
      if (nearest) {
        nearest.applyMeleeHit(1);
        this.ctx.fx.spark(nearest.center.clone(), fwd);
      }
    }
    if (nearest) this.ctx.bus.emit('hitmarker', {});
  }

  private throwHeld(): void {
    const origin = this.camPos.clone().addScaledVector(this.forward(), 0.4);
    const dir = this.forward().clone();
    if (this.held.type === 'weapon') {
      const w = this.held.weapon;
      this.ctx.thrown.throwWeapon(w.kind, origin, dir, w.ammo);
      this.setHeld({ type: 'fists' });
    } else if (this.held.type === 'throwable') {
      this.ctx.thrown.throwThrowable(this.held.radius, origin, dir);
      this.setHeld({ type: 'fists' });
    }
  }

  private tryPickup(): void {
    const item = this.ctx.level.nearestItem(this.pos, 2.2);
    if (!item) return;
    // Drop whatever we're holding so it isn't lost.
    this.dropHeldAsPickup();
    if (item.type === 'weapon' && item.kind) {
      const weapon = new WeaponInstance(item.kind);
      if (item.ammo !== undefined) weapon.ammo = item.ammo; // preserve unfired rounds
      this.setHeld({ type: 'weapon', weapon });
    } else {
      this.setHeld({ type: 'throwable', radius: item.radius });
    }
    this.ctx.level.removeItem(item);
    this.ctx.audio.play('pickup');
    this.ctx.bus.emit('pickup', { kind: item.kind ?? 'ball' });
  }

  private tryHotswitch(): void {
    if (this.hotswitchTimer > 0) return;
    const fwd = this.forward();
    const origin = this.camPos;
    let target: Enemy | null = null;
    let bestT = HOTSWITCH_RANGE;
    for (const e of this.ctx.director.enemies) {
      if (!e.alive) continue;
      const to = e.center.clone().sub(origin);
      const along = to.dot(fwd);
      if (along <= 0 || along > HOTSWITCH_RANGE) continue;
      const perp = to.addScaledVector(fwd, -along).length();
      if (perp > e.radius + 0.5) continue;
      if (along < bestT) {
        bestT = along;
        target = e;
      }
    }
    if (!target) return;

    // Leave the old body behind as shattering crystal.
    this.ctx.fx.shatterPlayer(this.camPos.clone());
    // Assume the target's position; the host body drops/shatters its weapon.
    this.pos.set(target.pos.x, this.ctx.level.floorY, target.pos.z);
    this.velocity.set(0, 0, 0);
    this.shatterHeld(true);
    // Vacate the target enemy (it counts toward clearing the arena).
    target.alive = false;
    target.dispose();

    this.hotswitchTimer = HOTSWITCH_COOLDOWN;
    this.syncCamera();
    this.ctx.audio.play('hotswitch');
    this.ctx.bus.emit('hotswitch', {});
  }

  // ---- blade defense ----------------------------------------------------

  private updateBlade(unscaledDt: number): void {
    // The swing is a player action: it must run on REAL time so the strike,
    // its animation, and the bat's deflect window all resolve in ~0.2s rather
    // than stretching to ~40s when the world is near-frozen.
    if (this.swingTimer > 0) this.swingTimer -= unscaledDt;
    const def = this.held.type === 'weapon' ? this.held.weapon.def : null;
    const canSlice = def?.canSliceBullets ?? false;
    const canDeflect = def?.canDeflectBullets ?? false;
    // Katana defends continuously (its blade is essentially always lethal-fast);
    // a bat only deflects mid-swing.
    this.bladeActive =
      (canSlice && this.held.type === 'weapon') || (canDeflect && this.swingTimer > 0);
    this.bladeCanSlice = canSlice;
    this.bladeCanDeflect = canDeflect;
    if (this.bladeActive) {
      this.bladeCenter.copy(this.camPos).addScaledVector(this.forward(), 0.8);
      this.bladeRadius = canSlice ? KATANA_SLICE_RADIUS : 0.8;
      this.bladeNormal.copy(this.forward());
    }
  }

  onBladeContact(_point: Vector3): 'slice' | 'deflect' | null {
    if (!this.bladeActive) return null;
    if (this.bladeCanSlice) return 'slice';
    if (this.bladeCanDeflect) {
      if (this.held.type === 'weapon' && this.held.weapon.degrade()) {
        // Bat shatters on this final deflect.
        queueMicrotask(() => this.shatterHeld());
      }
      return 'deflect';
    }
    return null;
  }

  /** FOV-aware hitbox: a bullet you're actively tracking is far easier to dodge. */
  hitRadiusFor(bulletPos: Vector3): number {
    const to = bulletPos.clone().sub(this.camPos).normalize();
    const frontness = clamp(to.dot(this.forward()), 0, 1);
    return PLAYER_RADIUS + 0.08 - 0.22 * frontness;
  }

  die(reason: string): void {
    if (!this.alive) return;
    this.alive = false;
    this.bladeActive = false;
    this.ctx.audio.play('death');
    this.ctx.bus.emit('player:died', { reason });
  }

  // ---- held item / viewmodel -------------------------------------------

  private setHeld(held: Held): void {
    this.held = held;
    this.viewmodel.clear();
    let model: Object3D | null = null;
    if (held.type === 'weapon') {
      model = buildWeaponModel(held.weapon.kind);
    } else if (held.type === 'throwable') {
      model = buildThrowableModel(held.radius);
    }
    if (model) {
      model.position.set(0.26, -0.24, -0.5);
      model.rotation.set(0, Math.PI, 0);
      this.viewmodel.add(model);
    }
    this.ctx.bus.emit('weapon:changed', {
      kind: this.heldKind,
      ammo: this.heldAmmo,
    });
  }

  private dropHeldAsPickup(): void {
    const dropPos = this.pos.clone().addScaledVector(this.forward(), 0.6);
    dropPos.y = this.ctx.level.floorY + 0.4;
    if (this.held.type === 'weapon') {
      this.ctx.level.spawnWeaponPickup(this.held.weapon.kind, dropPos, undefined, this.held.weapon.ammo);
    } else if (this.held.type === 'throwable') {
      this.ctx.level.spawnThrowable(dropPos, this.held.radius);
    }
  }

  private shatterHeld(silent = false): void {
    if (this.held.type === 'weapon' || this.held.type === 'throwable') {
      if (!silent) this.ctx.fx.spark(this.camPos.clone().addScaledVector(this.forward(), 0.6), this.forward());
    }
    this.setHeld({ type: 'fists' });
  }

  private updateViewmodel(dt: number): void {
    this.recoil = Math.max(0, this.recoil - dt * 0.8);
    const swing = this.swingTimer > 0 ? Math.sin((1 - this.swingTimer / 0.2) * Math.PI) : 0;
    this.viewmodel.rotation.x = -this.recoil * 2 - swing * 0.9;
    this.viewmodel.position.z = -this.recoil * 0.1;
  }

  /** Nearest pickup hint for the HUD (or null). */
  nearbyPickup(): GroundItem | null {
    return this.ctx.level.nearestItem(this.pos, 2.2);
  }

  /** True if the crosshair is currently over a hotswitchable enemy. */
  aimingAtEnemy(): boolean {
    const fwd = this.forward();
    const origin = this.camPos;
    for (const e of this.ctx.director.enemies) {
      if (!e.alive) continue;
      const to = e.center.clone().sub(origin);
      const along = to.dot(fwd);
      if (along <= 0 || along > HOTSWITCH_RANGE) continue;
      const perp = to.addScaledVector(fwd, -along).length();
      if (perp <= e.radius + 0.5) return true;
    }
    return false;
  }
}
