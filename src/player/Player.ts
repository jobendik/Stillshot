import { PerspectiveCamera, Vector3 } from 'three';
import type { WeaponKind } from '@/types';
import type { GameContext } from '@/core/Context';
import type { Enemy } from '@/ai/Enemy';
import type { GroundItem } from '@/world/Level';
import { WeaponInstance } from '@/combat/Weapon';
import { crystalFor } from '@/fx/Crystal';
import { FigureRig, neutralPose } from '@/fx/Rig';
import { clamp, damp } from '@/core/math';
import { type ViewState, Viewmodel, idleViewState } from './Viewmodel';
import {
  ACTION_COST,
  BAT_DEFLECT_RADIUS,
  BLADE_REACH,
  COYOTE_TIME,
  GRAB_REACH,
  HOTSWITCH_COOLDOWN,
  HOTSWITCH_RANGE,
  JUMP_BUFFER,
  KATANA_SLICE_RADIUS,
  MELEE_RANGE,
  MOUSE_SENSITIVITY,
  PICKUP_RANGE,
  PITCH_LIMIT,
  PLAYER_ACCEL,
  PLAYER_AIR_ACCEL,
  PLAYER_EYE_HEIGHT,
  PLAYER_GRAVITY,
  PLAYER_HEIGHT,
  PLAYER_JUMP_SPEED,
  PLAYER_MOVE_SPEED,
  PLAYER_RADIUS,
  SWING_TIME,
} from '@/config/constants';

type Held =
  | { type: 'fists' }
  | { type: 'weapon'; weapon: WeaponInstance }
  | { type: 'throwable'; radius: number };

export interface PlayerStats {
  shots: number;
  kills: number;
  throws: number;
  catches: number;
  splits: number;
  transfers: number;
  borrows: number;
}

/**
 * The first-person controller. Crucially it lives OUTSIDE world time: movement
 * and look integrate on real seconds, so input is instant even when the world is
 * running at 1/200th speed. What the player does is precisely what releases
 * time (see TimeController) — and every discrete action here pays a fixed cost
 * through `time.spendAction`.
 *
 * Weapon cooldowns tick on SUBJECTIVE time (time spent), not real time, so a
 * gun only comes ready again by moving, looking or acting.
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
  readonly stats: PlayerStats = { shots: 0, kills: 0, throws: 0, catches: 0, splits: 0, transfers: 0, borrows: 0 };

  // Blade volume, published for the projectile system.
  bladeActive = false;
  readonly bladeCenter = new Vector3();
  bladeRadius = 0;
  private bladeMode: 'split' | 'return' | null = null;

  /** Unit aim direction and its horizontal right vector (valid after update). */
  readonly aimDir = new Vector3(0, 0, -1);
  readonly aimRight = new Vector3(1, 0, 0);
  readonly headPos = new Vector3();
  /** Where the killing blow came from (for the death indicator). */
  readonly deathFrom = new Vector3();
  /** Total rotation applied this frame, radians (feeds the time controller). */
  lookRadians = 0;
  /** Distance walked — drives the stride of the replay avatar. */
  stride = 0;

  /** Test hook: lethal hits are counted instead of applied. Never set in play. */
  invulnerable = false;
  hitsTaken = 0;

  /** First-person presentation state (also what the replay records). */
  readonly view: ViewState = idleViewState();
  readonly viewmodel = new Viewmodel();

  private hotswitchTimer = 0;
  private swingTimer = 0;
  private meleeCooldown = 0;
  private jumpBuffer = 0;
  private coyote = 0;
  private fireBuffer = 0;
  private punchSide = 1;
  private fovKick = 0;

  private readonly ctx: GameContext;
  private readonly camera: PerspectiveCamera;
  /** Off-scene figure used to shatter the player's own body. */
  private readonly body = new FigureRig('player', crystalFor('ink', false));
  private readonly _v = new Vector3();
  private readonly _o = new Vector3();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.camera = ctx.camera;
    this.camera.rotation.order = 'YXZ';
    this.camera.add(this.viewmodel.group);
  }

  // ---- lifecycle --------------------------------------------------------

  spawnAt(pos: Vector3, yaw: number): void {
    this.pos.copy(pos);
    this.pos.y = this.ctx.level.groundHeight(pos.x, pos.z, pos.y + 0.1);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = true;
    this.alive = true;
    this.hotswitchTimer = 0;
    this.swingTimer = 0;
    this.meleeCooldown = 0;
    this.jumpBuffer = 0;
    this.fireBuffer = 0;
    this.stride = 0;
    this.bladeActive = false;
    Object.assign(this.stats, { shots: 0, kills: 0, throws: 0, catches: 0, splits: 0, transfers: 0, borrows: 0 });
    Object.assign(this.view, idleViewState());
    this.setHeld({ type: 'fists' });
    this.viewmodel.group.visible = true;
    this.syncCamera();
  }

  get heldKind(): WeaponKind | 'orb' {
    if (this.held.type === 'fists') return 'fist';
    if (this.held.type === 'throwable') return 'orb';
    return this.held.weapon.kind;
  }

  get heldAmmo(): number {
    return this.held.type === 'weapon' ? this.held.weapon.ammo : 0;
  }

  /** 0 = ready, 1 = just fired / swung. Drives the crosshair. */
  get readiness(): number {
    if (this.held.type === 'weapon' && this.held.weapon.def.category === 'firearm') {
      return this.held.weapon.cooldownFraction;
    }
    return clamp(this.meleeCooldown / 0.3, 0, 1);
  }

  get hotswitchReady(): boolean {
    return this.hotswitchTimer <= 0;
  }

  get hotswitchCooldownFraction(): number {
    return clamp(this.hotswitchTimer / HOTSWITCH_COOLDOWN, 0, 1);
  }

  // ---- per-frame --------------------------------------------------------

  update(): void {
    if (!this.alive) return;
    const time = this.ctx.time;
    const dt = time.unscaledDt;

    this.applyLook();
    this.applyMovement(dt);
    this.syncCamera();
    this.handleActions();
    this.updateBlade(dt);
    this.updateView(dt);

    if (this.hotswitchTimer > 0) this.hotswitchTimer -= time.scaledDt;
  }

  /** Read the mouse. Called before the time controller so it sees this frame's look. */
  readLook(): number {
    const input = this.ctx.input;
    const sens = MOUSE_SENSITIVITY * this.ctx.settings.values.sensitivity;
    const dx = input.mouseDX * sens;
    const dy = input.mouseDY * sens * (this.ctx.settings.values.invertY ? -1 : 1);
    this.pendingYaw = -dx;
    this.pendingPitch = -dy;
    this.lookRadians = Math.hypot(dx, dy);
    return this.lookRadians;
  }

  private pendingYaw = 0;
  private pendingPitch = 0;

  private applyLook(): void {
    this.yaw += this.pendingYaw;
    this.pitch = clamp(this.pitch + this.pendingPitch, -PITCH_LIMIT, PITCH_LIMIT);
    // Weapon sway trails the camera and springs back.
    const k = damp(14, this.ctx.time.unscaledDt);
    this.view.swayX += (clamp(this.pendingYaw * 6, -0.25, 0.25) - this.view.swayX) * k;
    this.view.swayY += (clamp(this.pendingPitch * 6, -0.25, 0.25) - this.view.swayY) * k;
    this.pendingYaw = 0;
    this.pendingPitch = 0;
  }

  private applyMovement(dt: number): void {
    const input = this.ctx.input;
    const level = this.ctx.level;
    const intent = input.moveIntent();

    // forward F = (-sin, 0, -cos), right R = (cos, 0, -sin); W gives intent.z = -1.
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wishX = intent.x * cos + intent.z * sin;
    const wishZ = -intent.x * sin + intent.z * cos;

    const k = damp(this.grounded ? PLAYER_ACCEL : PLAYER_AIR_ACCEL, dt);
    this.velocity.x += (wishX * PLAYER_MOVE_SPEED - this.velocity.x) * k;
    this.velocity.z += (wishZ * PLAYER_MOVE_SPEED - this.velocity.z) * k;

    // Jump, with a short buffer before landing and a grace period off ledges.
    if (input.pressed('jump')) this.jumpBuffer = JUMP_BUFFER;
    else this.jumpBuffer -= dt;
    this.coyote = this.grounded ? COYOTE_TIME : this.coyote - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = PLAYER_JUMP_SPEED;
      this.grounded = false;
      this.jumpBuffer = 0;
      this.coyote = 0;
    }

    this.velocity.y -= PLAYER_GRAVITY * dt;
    const px = this.pos.x;
    const pz = this.pos.z;
    this.pos.addScaledVector(this.velocity, dt);
    level.resolveActor(this.pos, this.radius, this.height);

    // Land on the floor or on top of cover.
    const ground = level.groundHeight(this.pos.x, this.pos.z, this.pos.y - this.velocity.y * dt);
    if (this.pos.y <= ground && this.velocity.y <= 0) {
      this.pos.y = ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    const moved = Math.hypot(this.pos.x - px, this.pos.z - pz);
    if (this.grounded) this.stride += moved;
    const speedFrac = clamp(moved / Math.max(dt, 1e-4) / PLAYER_MOVE_SPEED, 0, 1);
    this.view.bob = this.stride * 5.2;
    this.view.bobAmount += ((this.grounded ? speedFrac : 0) - this.view.bobAmount) * damp(10, dt);
  }

  private syncCamera(): void {
    this.headPos.set(this.pos.x, this.pos.y + PLAYER_EYE_HEIGHT, this.pos.z);
    this.camera.position.copy(this.headPos);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    const cp = Math.cos(this.pitch);
    this.aimDir.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    this.aimRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // FOV: the configured value, plus a breath outward as time rushes.
    const s = this.ctx.settings.values;
    const time = this.ctx.time;
    const target = s.reducedMotion ? 0 : clamp(time.scale, 0, 1.6) * 2.2 + (time.borrowPhase === 'borrowing' ? 5 : 0);
    this.fovKick += (target - this.fovKick) * damp(9, time.unscaledDt);
    const fov = s.fov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---- actions ----------------------------------------------------------

  private handleActions(): void {
    const input = this.ctx.input;
    const time = this.ctx.time;
    const abilities = this.ctx.level.def.abilities;

    if (this.meleeCooldown > 0) this.meleeCooldown -= time.subjectiveDt;

    if (input.pressed('borrow') && abilities.borrow) this.toggleBorrow();
    if (input.pressed('hotswitch') && abilities.hotswitch) this.tryHotswitch();
    if (input.pressed('altFire')) this.throwHeld();
    if (input.pressed('use')) this.tryGrab(true);

    const firearm = this.held.type === 'weapon' && this.held.weapon.def.category === 'firearm';
    if (firearm) {
      this.fireFirearm();
      if (input.pressed('melee')) this.startMelee();
    } else if (input.pressed('fire')) {
      // Empty hands reach for whatever is under the crosshair before they punch.
      if (this.held.type === 'fists' && this.tryGrab(false)) return;
      this.startMelee();
    } else if (input.pressed('melee')) {
      this.startMelee();
    }
  }

  private fireFirearm(): void {
    if (this.held.type !== 'weapon') return;
    const ctx = this.ctx;
    const weapon = this.held.weapon;
    const def = weapon.def;
    const pressed = ctx.input.pressed('fire');

    if (pressed && weapon.empty) {
      ctx.audio.play('dryfire');
      ctx.bus.emit('weapon:empty', {});
    }
    // A click always commits. If the weapon is still cycling, the remaining
    // cycle time is spent (the world lurches forward) and then it fires.
    if (pressed && !weapon.empty) {
      this.fireBuffer = weapon.cooldown + 0.2;
      if (!weapon.readyToFire && !weapon.bursting) ctx.time.spendAction(weapon.cooldown + 0.01);
    } else {
      this.fireBuffer -= ctx.time.subjectiveDt;
    }
    const trigger = this.fireBuffer > 0 && weapon.readyToFire;
    if (trigger) this.fireBuffer = 0;

    const shots = weapon.update(ctx.time.subjectiveDt, trigger);
    if (shots <= 0) return;

    const origin = this._o.copy(this.headPos).addScaledVector(this.aimDir, 0.45).addScaledVector(this.aimRight, 0.07);
    origin.y -= 0.06;
    for (let s = 0; s < shots; s++) {
      const pellets = def.fireMode === 'spread' ? def.pelletCount : 1;
      for (let i = 0; i < pellets; i++) {
        const dir = this._v.copy(this.aimDir);
        if (def.spread > 0) {
          dir.x += (ctx.rng() - 0.5) * def.spread * 2;
          dir.y += (ctx.rng() - 0.5) * def.spread * 2;
          dir.z += (ctx.rng() - 0.5) * def.spread * 2;
        }
        ctx.projectiles.spawn(origin, dir, {
          faction: 'player',
          speed: def.projectileSpeed,
          piercing: def.piercing,
          glass: def.glass,
          deflectable: def.deflectable,
          look: def.kind === 'shotgun' ? 'pellet' : def.kind === 'nailgun' ? 'nail' : 'bullet',
        });
      }
      ctx.time.spendAction(ACTION_COST.fire);
      this.stats.shots++;
    }
    this.view.recoil = Math.min(1.4, this.view.recoil + (def.kind === 'shotgun' ? 1.2 : 0.75));
    ctx.audio.play(def.kind === 'shotgun' ? 'shotgun' : def.kind === 'nailgun' ? 'nail' : 'shoot');
    ctx.fx.muzzle(origin, this.aimDir, false);
    ctx.bus.emit('weapon:fired', { kind: def.kind });
    ctx.bus.emit('weapon:changed', { kind: def.kind, ammo: weapon.ammo });
  }

  private startMelee(): void {
    if (this.swingTimer > 0 || this.meleeCooldown > 0) return;
    const ctx = this.ctx;
    const def = this.held.type === 'weapon' ? this.held.weapon.def : null;
    const melee = def?.category === 'melee';
    this.swingTimer = SWING_TIME;
    this.meleeCooldown = melee ? def!.cooldown : 0.3;
    this.punchSide = -this.punchSide;
    this.view.swingSide = this.punchSide;
    ctx.time.spendAction(ACTION_COST.melee);
    ctx.audio.play(def?.kind === 'katana' ? 'slash' : 'swing');

    // Resolve the arc immediately — the hit lands the instant you commit.
    const fwd = this.aimDir;
    const enemies = ctx.director.enemies;
    let nearest: Enemy | null = null;
    let nearestD = Infinity;
    const inArc: Enemy[] = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const to = this._v.subVectors(e.center, this.headPos);
      const dist = to.length();
      if (dist > MELEE_RANGE + e.radius) continue;
      if (to.multiplyScalar(1 / Math.max(dist, 1e-4)).dot(fwd) < 0.45) continue;
      inArc.push(e);
      if (dist < nearestD) {
        nearestD = dist;
        nearest = e;
      }
    }
    if (!nearest) return;

    if (def?.kind === 'katana') {
      for (const e of inArc) e.kill(e.center.clone(), fwd, 'melee', 4.5);
    } else if (melee) {
      if (nearest.shieldBlocks(fwd)) {
        this.blockedHit(nearest);
      } else {
        nearest.kill(nearest.center.clone(), fwd, 'melee', 7);
      }
      if (this.held.type === 'weapon' && this.held.weapon.degrade()) this.breakHeld();
    } else if (nearest.shieldBlocks(fwd)) {
      this.blockedHit(nearest);
    } else {
      // Bare hands (or the butt of a gun): stagger, knock their weapon loose, wear them down.
      nearest.stagger(0.7);
      nearest.disarm(this.headPos);
      nearest.applyMeleeHit(1, fwd, 'melee');
      ctx.fx.sparks(nearest.center, fwd, 5, 1);
      ctx.audio.play('punch', nearest.center);
    }
    ctx.bus.emit('hitmarker', {});
  }

  private blockedHit(e: Enemy): void {
    this.ctx.fx.sparks(e.center, this.aimDir, 7, 0);
    this.ctx.audio.play('ricochet', e.center);
    e.onShieldHit(e.center);
  }

  private throwHeld(): void {
    if (this.held.type === 'fists') return;
    const origin = this._o.copy(this.headPos).addScaledVector(this.aimDir, 0.5);
    if (this.held.type === 'weapon') {
      this.ctx.thrown.throwWeapon(this.held.weapon.kind, origin, this.aimDir, this.held.weapon.ammo);
    } else {
      this.ctx.thrown.throwThrowable(this.held.radius, origin, this.aimDir);
    }
    this.stats.throws++;
    this.ctx.time.spendAction(ACTION_COST.throw);
    this.view.swing = 0.001;
    this.swingTimer = SWING_TIME * 0.6;
    this.setHeld({ type: 'fists' });
  }

  /** What the crosshair (or, failing that, proximity) would pick up right now. */
  grabTarget(allowNearby: boolean): GroundItem | null {
    const level = this.ctx.level;
    const aimed = level.aimedItem(this.headPos, this.aimDir, GRAB_REACH);
    if (aimed) return aimed;
    if (!allowNearby) return null;
    this._v.set(this.pos.x, this.pos.y + 0.9, this.pos.z);
    return level.nearestItem(this._v, PICKUP_RANGE);
  }

  private tryGrab(allowNearby: boolean): boolean {
    const item = this.grabTarget(allowNearby);
    if (!item) return false;
    const caught = !item.settled;
    this.dropHeld();
    if (item.type === 'weapon' && item.kind) {
      const weapon = new WeaponInstance(item.kind);
      if (item.ammo !== undefined) weapon.ammo = item.ammo;
      this.setHeld({ type: 'weapon', weapon });
    } else {
      this.setHeld({ type: 'throwable', radius: item.radius });
    }
    this.ctx.level.removeItem(item);
    this.view.draw = 1;
    if (caught) this.stats.catches++;
    this.ctx.time.spendAction(ACTION_COST.pickup);
    this.ctx.audio.play(caught ? 'catch' : 'pickup');
    this.ctx.bus.emit('pickup', { kind: item.kind ?? 'orb', caught });
    return true;
  }

  private toggleBorrow(): void {
    const time = this.ctx.time;
    if (time.borrowPhase === 'borrowing') {
      time.endBorrow();
    } else if (time.beginBorrow()) {
      this.stats.borrows++;
    }
  }

  /** The enemy under the crosshair that a transfer would land in. */
  hotswitchTarget(): Enemy | null {
    let target: Enemy | null = null;
    let best = HOTSWITCH_RANGE;
    for (const e of this.ctx.director.enemies) {
      if (!e.alive || !e.solid) continue;
      const to = this._v.subVectors(e.center, this.headPos);
      const along = to.dot(this.aimDir);
      if (along <= 0 || along >= best) continue;
      const perp = to.addScaledVector(this.aimDir, -along).length();
      if (perp > e.radius + 0.4) continue;
      // Needs a clear line: you cannot project through a wall (glass is fine).
      const d = this._v.subVectors(e.eye, this.headPos);
      const dist = d.length();
      if (this.ctx.level.rayToSolid(this.headPos, d.multiplyScalar(1 / dist), dist) < dist) continue;
      best = along;
      target = e;
    }
    return target;
  }

  private tryHotswitch(): void {
    if (this.hotswitchTimer > 0) return;
    const target = this.hotswitchTarget();
    if (!target) return;
    const ctx = this.ctx;

    // The body you leave is still a body: it breaks where it stood.
    this.shatterOwnBody(this.aimDir.clone().negate());
    this.dropHeld();
    ctx.fx.ring(this.pos, 2, 1.4);

    // Take the target's place and its point of view.
    this.pos.copy(target.pos);
    this.velocity.set(0, 0, 0);
    this.yaw = target.yaw;
    this.pitch = 0;
    this.grounded = true;
    target.vacate(this.headPos.set(this.pos.x, this.pos.y + PLAYER_EYE_HEIGHT, this.pos.z));
    this.syncCamera();
    ctx.fx.ring(this.pos, 1, 1.8);

    this.hotswitchTimer = HOTSWITCH_COOLDOWN;
    this.stats.transfers++;
    ctx.time.spendAction(ACTION_COST.hotswitch);
    ctx.director.onPlayerRelocated();
    ctx.audio.play('hotswitch');
    ctx.bus.emit('hotswitch', {});
  }

  private shatterOwnBody(dir: Vector3): void {
    const pose = neutralPose();
    pose.x = this.pos.x;
    pose.y = this.pos.y;
    pose.z = this.pos.z;
    pose.yaw = this.yaw;
    this.body.setWeapon(null);
    this.body.applyPose(pose);
    this._v.set(this.pos.x, this.pos.y + 1.2, this.pos.z);
    this.ctx.fx.shatter(this.body.pieces(), 'ink', this._v, dir, 2.5, { radial: 3.2, crack: 6 });
    this.ctx.audio.play('shatter', this._v);
  }

  // ---- blade ------------------------------------------------------------

  private updateBlade(dt: number): void {
    // A swing is a player action, so its window is in REAL time — but swinging
    // also spends time, which is what carries the bullet into the blade.
    if (this.swingTimer > 0) this.swingTimer -= dt;
    const def = this.held.type === 'weapon' ? this.held.weapon.def : null;
    this.bladeMode = def?.canSliceBullets ? 'split' : def?.canDeflectBullets ? 'return' : null;
    this.bladeActive = this.bladeMode !== null && this.swingTimer > 0;
    if (this.bladeActive) {
      this.bladeCenter.copy(this.headPos).addScaledVector(this.aimDir, BLADE_REACH);
      this.bladeRadius = this.bladeMode === 'split' ? KATANA_SLICE_RADIUS : BAT_DEFLECT_RADIUS;
    }
  }

  onBladeContact(_point: Vector3): 'split' | 'return' | null {
    if (!this.bladeActive) return null;
    if (this.bladeMode === 'split') {
      this.stats.splits++;
      return 'split';
    }
    if (this.bladeMode === 'return') {
      if (this.held.type === 'weapon' && this.held.weapon.degrade()) {
        // Resolve after the projectile step so we never mutate mid-iteration.
        queueMicrotask(() => this.breakHeld());
      }
      return 'return';
    }
    return null;
  }

  /**
   * FOV-aware hit radius: a round you are watching is easier to slip than one
   * you have turned your back on. Forgiving, but never invisible — the cylinder
   * only ever gets smaller than the body, not larger than a fair graze.
   */
  hitRadiusFor(bulletPos: Vector3): number {
    const to = this._v.subVectors(bulletPos, this.headPos).normalize();
    const frontness = clamp(to.dot(this.aimDir), 0, 1);
    return PLAYER_RADIUS + 0.04 - 0.2 * frontness;
  }

  die(reason: string, from: Vector3): void {
    if (!this.alive) return;
    if (this.invulnerable) {
      this.hitsTaken++;
      return;
    }
    this.alive = false;
    this.bladeActive = false;
    this.deathFrom.copy(from);
    this.viewmodel.group.visible = false;
    this.ctx.audio.play('death');
    this.ctx.bus.emit('player:died', { reason, x: from.x, y: from.y, z: from.z });
  }

  // ---- held item --------------------------------------------------------

  private setHeld(held: Held): void {
    this.held = held;
    this.view.held = this.heldKind;
    if (held.type === 'throwable') this.view.orbRadius = held.radius;
    this.ctx.bus.emit('weapon:changed', { kind: this.heldKind, ammo: this.heldAmmo });
  }

  /** Put whatever is in hand on the floor in front of us. */
  private dropHeld(): void {
    if (this.held.type === 'fists') return;
    const pos = this._o.copy(this.headPos).addScaledVector(this.aimDir, 0.5);
    pos.y -= 0.35;
    const vel = new Vector3(this.aimDir.x * 1.6, 1.2, this.aimDir.z * 1.6);
    if (this.held.type === 'weapon') {
      this.ctx.level.spawnWeaponPickup(this.held.weapon.kind, pos, vel, this.held.weapon.ammo);
    } else {
      this.ctx.level.spawnThrowable(pos, this.held.radius, vel);
    }
    this.setHeld({ type: 'fists' });
  }

  /** An improvised weapon has broken in our hands. */
  private breakHeld(): void {
    if (this.held.type !== 'weapon') return;
    const p = this._o.copy(this.headPos).addScaledVector(this.aimDir, 0.7);
    this.ctx.fx.sparks(p, this.aimDir, 12, 2);
    this.ctx.audio.play('thud', p);
    this.ctx.bus.emit('hint', { text: 'it broke.', ms: 1200 });
    this.setHeld({ type: 'fists' });
  }

  private updateView(dt: number): void {
    const v = this.view;
    v.recoil = Math.max(0, v.recoil - dt * 6.5);
    v.draw = Math.max(0, v.draw - dt * 6);
    v.swing = this.swingTimer > 0 ? clamp(1 - this.swingTimer / SWING_TIME, 0.001, 1) : 0;
    this.viewmodel.apply(v);
  }

  /** Nearest thing the player could grab right now (HUD prompt). */
  nearbyPickup(): GroundItem | null {
    return this.grabTarget(true);
  }
}
