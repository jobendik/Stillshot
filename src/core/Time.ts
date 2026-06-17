import {
  JUMP_DILATION_CAP,
  MAX_FRAME_DT,
  MAX_TIME_SCALE,
  MIN_TIME_SCALE,
  MOUSE_MAGNITUDE_REFERENCE,
  ROTATION_WEIGHT,
  TIME_ATTACK_RATE,
  TIME_RELEASE_RATE,
} from '@/config/constants';

export interface TimeInputs {
  /** Translation intent magnitude, 0 (still) .. 1 (max sprint). */
  moveMagnitude: number;
  /** Summed absolute mouse delta in pixels this frame. */
  mousePixels: number;
  /** Is the jump input currently held? */
  jumpHeld: boolean;
  /** Is the player airborne? */
  airborne: boolean;
  /** External override (replay / menus) — when set, scale is forced. */
  forcedScale?: number;
}

/**
 * The temporal core. Maps the magnitude of player input to the global time
 * scale via:
 *
 *   magnitude = sqrt(translation^2 + (W * rotation)^2)
 *   targetScale = lerp(MIN, MAX, smoothstep(magnitude))
 *
 * The result is smoothed asymmetrically (fast attack, slow release) so action
 * snaps to life the instant you move and eases back down as you settle, exactly
 * matching the "auditory/temporal whiplash" the blueprint describes.
 *
 * Player kinematics intentionally read `unscaledDt`; the world reads `scaledDt`.
 */
export class TimeController {
  /** Current smoothed global time scale (0.005 .. 1.0). */
  scale = MIN_TIME_SCALE;
  /** Real frame delta (seconds), clamped. Drives the player controller. */
  unscaledDt = 0;
  /** World delta (unscaledDt * scale). Drives projectiles, enemies, FX. */
  scaledDt = 0;
  /** Accumulated world (scaled) time — the clock the replay records against. */
  worldElapsed = 0;
  /** Accumulated real time. */
  realElapsed = 0;
  /** Raw input magnitude this frame (for HUD readout). */
  magnitude = 0;

  private targetScale = MIN_TIME_SCALE;

  /** Advance the clock. Returns the clamped real delta. */
  update(rawDt: number, inputs: TimeInputs): number {
    const dt = Math.min(rawDt, MAX_FRAME_DT);
    this.unscaledDt = dt;
    this.realElapsed += dt;

    if (inputs.forcedScale !== undefined) {
      this.scale = inputs.forcedScale;
      this.targetScale = inputs.forcedScale;
      this.magnitude = inputs.forcedScale;
      this.scaledDt = dt * this.scale;
      this.worldElapsed += this.scaledDt;
      return dt;
    }

    // Rotation contribution: normalize pixel delta, weight it below translation.
    const rotMag = Math.min(1, inputs.mousePixels / MOUSE_MAGNITUDE_REFERENCE);
    const trans = Math.min(1, inputs.moveMagnitude);
    let mag = Math.sqrt(trans * trans + ROTATION_WEIGHT * ROTATION_WEIGHT * rotMag * rotMag);
    mag = Math.min(1, mag);
    this.magnitude = mag;

    // Ease the magnitude so micro-jitter near zero doesn't lurch time forward.
    const eased = mag * mag * (3 - 2 * mag); // smoothstep
    this.targetScale = MIN_TIME_SCALE + (MAX_TIME_SCALE - MIN_TIME_SCALE) * eased;

    // Aerial dilation: while airborne with jump held, cap the ceiling low for a
    // window of superhuman planning, regardless of directional input.
    if (inputs.airborne && inputs.jumpHeld) {
      this.targetScale = Math.min(this.targetScale, JUMP_DILATION_CAP);
    }

    // Asymmetric exponential smoothing toward the target.
    const speedingUp = this.targetScale > this.scale;
    const rate = speedingUp ? TIME_ATTACK_RATE : TIME_RELEASE_RATE;
    const k = 1 - Math.exp(-rate * dt);
    this.scale += (this.targetScale - this.scale) * k;
    this.scale = Math.max(MIN_TIME_SCALE, Math.min(MAX_TIME_SCALE, this.scale));

    this.scaledDt = dt * this.scale;
    this.worldElapsed += this.scaledDt;
    return dt;
  }

  /** Force the scale (replay playback locks to 1.0; menus freeze at MIN). */
  force(scale: number): void {
    this.scale = scale;
    this.targetScale = scale;
    // Keep the derived world delta coherent so callers that read scaledDt right
    // after forcing (e.g. the level-complete freeze) get the forced rate, not a
    // stale value left over from the last Playing frame.
    this.scaledDt = this.unscaledDt * scale;
  }

  reset(): void {
    this.scale = MIN_TIME_SCALE;
    this.targetScale = MIN_TIME_SCALE;
    this.worldElapsed = 0;
    this.scaledDt = 0;
    this.magnitude = 0;
  }
}
