import type { WeaponDef, WeaponKind } from '@/types';
import { getWeaponDef } from '@/config/weapons';

/**
 * Runtime state of a single weapon held by the player or an enemy: ammunition,
 * the inter-shot cooldown, and burst sequencing. There is NO reload — once the
 * magazine is empty the weapon is spent (and gets dropped or thrown).
 *
 * `update()` is fed whatever delta the owner runs on: the player passes
 * unscaled (real) time for crisp triggers; enemies pass scaled (world) time, so
 * their fire rate naturally bogs down as the player freezes time.
 */
export class WeaponInstance {
  readonly def: WeaponDef;
  ammo: number;
  durability: number;
  private cooldown = 0;
  private burstLeft = 0;
  private burstTimer = 0;

  constructor(kind: WeaponKind) {
    this.def = getWeaponDef(kind);
    this.ammo = this.def.ammo;
    this.durability = this.def.durability;
  }

  get kind(): WeaponKind {
    return this.def.kind;
  }

  /** True when a firearm is spent and should be discarded. */
  get empty(): boolean {
    return this.def.category === 'firearm' && this.ammo <= 0 && this.burstLeft <= 0;
  }

  get readyToFire(): boolean {
    return this.cooldown <= 0 && this.ammo > 0 && this.burstLeft <= 0;
  }

  /**
   * Advance timers and report how many discrete shots to emit this frame.
   * For burst weapons the trigger cannot be interrupted; for spread weapons a
   * single returned "shot" is a shell the caller fans into pellets.
   */
  update(dt: number, triggerPressed: boolean): number {
    this.cooldown = Math.max(0, this.cooldown - dt);
    let shots = 0;

    // Continue an in-flight burst (uninterruptible).
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      while (this.burstLeft > 0 && this.burstTimer <= 0 && this.ammo > 0) {
        shots++;
        this.ammo--;
        this.burstLeft--;
        this.burstTimer += this.def.burstInterval;
      }
      if (this.ammo <= 0) this.burstLeft = 0;
      return shots;
    }

    if (triggerPressed && this.cooldown <= 0 && this.ammo > 0) {
      this.cooldown = this.def.cooldown;
      if (this.def.fireMode === 'burst') {
        this.burstLeft = Math.min(this.def.burstCount, this.ammo);
        // First round leaves the barrel immediately.
        shots++;
        this.ammo--;
        this.burstLeft--;
        this.burstTimer = this.def.burstInterval;
      } else {
        // semi or spread — one trigger pull = one shot/shell.
        shots++;
        this.ammo--;
      }
    }
    return shots;
  }

  /** Degrade an improvised melee weapon. Returns true if it just shattered. */
  degrade(): boolean {
    if (this.def.unbreakable) return false;
    this.durability -= 1;
    return this.durability <= 0;
  }
}
