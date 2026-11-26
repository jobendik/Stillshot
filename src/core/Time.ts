import {
  BORROW_COOLDOWN,
  BORROW_MAX,
  BORROW_REPAY_RATE,
  BORROW_REPLAY_RATE,
  JUMP_DILATION_CAP,
  MAX_FRAME_DT,
  MAX_TIME_SCALE,
  MIN_TIME_SCALE,
  ROTATION_FILTER_TAU,
  ROTATION_REFERENCE,
  ROTATION_WEIGHT,
  TIME_ATTACK_RATE,
  TIME_RELEASE_RATE,
} from '@/config/constants';

export interface TimeInputs {
  /** Translation intent magnitude, 0 (still) .. 1 (full speed). */
  moveMagnitude: number;
  /** Total camera rotation applied this frame, in radians. */
  lookRadians: number;
  jumpHeld: boolean;
  airborne: boolean;
}

export type BorrowPhase = 'idle' | 'borrowing' | 'repaying';

/**
 * The temporal core. Three clocks run side by side:
 *
 *   real        wall-clock seconds; drives the player's own body.
 *   subjective  the time the player has SPENT: real seconds weighted by how
 *               much they are doing. Drives the player's weapon cooldowns.
 *   world       what everything else lives on. Normally identical to
 *               subjective time — the act of moving is what releases it.
 *
 * Spend rate:
 *     magnitude = sqrt(translation^2 + (W * lookSpeed / ref)^2)
 *     target    = lerp(MIN, 1, smoothstep(magnitude))
 * smoothed asymmetrically (snappy attack, eased release). `lookSpeed` is an
 * angular velocity in rad/s, low-passed over ~45ms, so the cost of a mouse
 * sweep does not depend on frame rate or mouse polling rate.
 *
 * Discrete actions call `spendAction(seconds)`: time snaps to full speed until
 * that much has been released. A shot is never free.
 *
 * BORROWED TIME breaks the identity between the subjective and world clocks on
 * purpose. While borrowing, the world rate is exactly zero and the real seconds
 * that pass are booked as debt. When the loan ends the world collects: it runs
 * at (spend + 1), i.e. a full second per second on top of anything the player
 * does, until the debt is cleared. The two phases are mirror images — first you
 * move and the world does not, then the world moves whether or not you do.
 */
export class TimeController {
  /** World rate applied this frame (0 while borrowing, up to 2 while repaying). */
  scale = MIN_TIME_SCALE;
  /** Smoothed input-derived spend rate (MIN..1). */
  spend = MIN_TIME_SCALE;
  /** Real frame delta (seconds), clamped. */
  unscaledDt = 0;
  /** World delta for this frame. */
  scaledDt = 0;
  /** Subjective delta for this frame. */
  subjectiveDt = 0;
  worldElapsed = 0;
  realElapsed = 0;
  subjectiveElapsed = 0;
  /** The replay timeline: world time plus a compressed share of borrowed time. */
  replayClock = 0;
  /** Raw input magnitude this frame (HUD / debugging). */
  magnitude = 0;
  /** Filtered look speed in rad/s. */
  lookSpeed = 0;

  borrowPhase: BorrowPhase = 'idle';
  /** Seconds currently owed to the world. */
  debt = 0;
  /** World seconds until time can be borrowed again. */
  borrowCooldown = 0;
  /** Largest debt reached in the current loan (for the HUD bar). */
  debtPeak = 0;

  private pendingAction = 0;

  /** Advance all clocks by one rendered frame. */
  update(rawDt: number, inputs: TimeInputs): void {
    const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
    this.unscaledDt = dt;
    this.realElapsed += dt;

    // Look speed: instantaneous rad/s (measured against the RAW delta so a
    // stalled frame does not read as a violent flick), then low-passed.
    const inst = inputs.lookRadians / Math.max(rawDt, 1e-3);
    this.lookSpeed += (inst - this.lookSpeed) * (1 - Math.exp(-dt / ROTATION_FILTER_TAU));

    const trans = Math.min(1, inputs.moveMagnitude);
    const rot = Math.min(1, this.lookSpeed / ROTATION_REFERENCE);
    const mag = Math.min(1, Math.sqrt(trans * trans + ROTATION_WEIGHT * ROTATION_WEIGHT * rot * rot));
    this.magnitude = mag;

    const eased = mag * mag * (3 - 2 * mag);
    let target = MIN_TIME_SCALE + (MAX_TIME_SCALE - MIN_TIME_SCALE) * eased;
    if (inputs.airborne && inputs.jumpHeld) target = Math.min(target, JUMP_DILATION_CAP);

    if (this.pendingAction > 0) {
      // An action is being paid for: time runs flat out until it is covered.
      this.spend = MAX_TIME_SCALE;
    } else {
      const rate = target > this.spend ? TIME_ATTACK_RATE : TIME_RELEASE_RATE;
      this.spend += (target - this.spend) * (1 - Math.exp(-rate * dt));
      this.spend = Math.max(MIN_TIME_SCALE, Math.min(MAX_TIME_SCALE, this.spend));
    }

    this.subjectiveDt = dt * this.spend;
    this.subjectiveElapsed += this.subjectiveDt;
    if (this.pendingAction > 0) this.pendingAction = Math.max(0, this.pendingAction - this.subjectiveDt);

    let replayExtra = 0;
    switch (this.borrowPhase) {
      case 'borrowing':
        this.scale = 0;
        this.debt += dt;
        this.debtPeak = this.debt;
        replayExtra = dt * BORROW_REPLAY_RATE;
        if (this.debt >= BORROW_MAX) this.endBorrow();
        break;
      case 'repaying':
        this.scale = Math.min(2, this.spend + BORROW_REPAY_RATE);
        this.debt -= dt * BORROW_REPAY_RATE;
        if (this.debt <= 0) {
          this.debt = 0;
          this.borrowPhase = 'idle';
          this.borrowCooldown = BORROW_COOLDOWN;
        }
        break;
      default:
        this.scale = this.spend;
        break;
    }

    this.scaledDt = dt * this.scale;
    this.worldElapsed += this.scaledDt;
    this.replayClock += this.scaledDt + replayExtra;
    if (this.borrowPhase === 'idle' && this.borrowCooldown > 0) {
      this.borrowCooldown = Math.max(0, this.borrowCooldown - this.scaledDt);
    }
  }

  /** Release `seconds` of time for a discrete action. Costs stack. */
  spendAction(seconds: number): void {
    this.pendingAction = Math.min(0.5, this.pendingAction + seconds);
  }

  get canBorrow(): boolean {
    return this.borrowPhase === 'idle' && this.borrowCooldown <= 0;
  }

  /** Fraction of the loan still available while borrowing (1 → 0). */
  get loanFraction(): number {
    return Math.max(0, 1 - this.debt / BORROW_MAX);
  }

  beginBorrow(): boolean {
    if (!this.canBorrow) return false;
    this.borrowPhase = 'borrowing';
    this.debt = 0;
    this.debtPeak = 0;
    return true;
  }

  endBorrow(): void {
    if (this.borrowPhase !== 'borrowing') return;
    this.borrowPhase = 'repaying';
    this.debtPeak = Math.max(this.debt, 1e-3);
  }

  /** Hold the world at a fixed rate (level-complete tableau, death). */
  hold(rawDt: number, scale: number): void {
    const dt = Math.min(Math.max(rawDt, 0), MAX_FRAME_DT);
    this.unscaledDt = dt;
    this.scale = scale;
    this.spend = Math.max(MIN_TIME_SCALE, Math.min(1, scale));
    this.scaledDt = dt * scale;
    this.subjectiveDt = 0;
    this.worldElapsed += this.scaledDt;
    this.replayClock += this.scaledDt;
    this.realElapsed += dt;
  }

  reset(): void {
    this.scale = MIN_TIME_SCALE;
    this.spend = MIN_TIME_SCALE;
    this.worldElapsed = 0;
    this.subjectiveElapsed = 0;
    this.replayClock = 0;
    this.scaledDt = 0;
    this.subjectiveDt = 0;
    this.magnitude = 0;
    this.lookSpeed = 0;
    this.pendingAction = 0;
    this.borrowPhase = 'idle';
    this.debt = 0;
    this.debtPeak = 0;
    this.borrowCooldown = 0;
  }
}
