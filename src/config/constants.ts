/**
 * Global tuning constants for the StillShot temporal engine.
 *
 * The defining mechanic: the global time scale is mapped to the magnitude of the
 * player's input (translation + weighted rotation). When the player is perfectly
 * still, time decelerates to a fractional minimum (~1/200th) rather than freezing
 * entirely, keeping hostile projectiles inching forward as a persistent threat.
 */

// ---------------------------------------------------------------------------
// Temporal mechanics
// ---------------------------------------------------------------------------

/** Baseline idle time scale — 1/200th of normal flow. Never fully frozen. */
export const MIN_TIME_SCALE = 0.005;

/** Full real-time flow when the player is moving at maximum velocity. */
export const MAX_TIME_SCALE = 1.0;

/**
 * Weighting coefficient scaling rotation (mouse look) relative to translation.
 * Looking around accelerates time, but not as rapidly as physically sprinting.
 */
export const ROTATION_WEIGHT = 0.55;

/** Mouse delta (px/frame, summed x+y) that maps to a rotation magnitude of 1.0. */
export const MOUSE_MAGNITUDE_REFERENCE = 26;

/** Attack rate of the time-scale smoother (per second) — how fast time speeds up. */
export const TIME_ATTACK_RATE = 22;

/** Release rate of the time-scale smoother (per second) — how fast time slows down. */
export const TIME_RELEASE_RATE = 9;

/**
 * While airborne with the jump input sustained, the time scale is capped here
 * regardless of directional input — a brief window of superhuman aerial planning.
 */
export const JUMP_DILATION_CAP = 0.25;

/** Base physics step (50 Hz). Fixed-step accumulator target for the world. */
export const BASE_FIXED_DT = 1 / 50;

/** Hard clamp on a single real frame delta to avoid spiral-of-death after stalls. */
export const MAX_FRAME_DT = 1 / 20;

// ---------------------------------------------------------------------------
// Player kinematics
// ---------------------------------------------------------------------------

export const PLAYER_RADIUS = 0.34;
export const PLAYER_HEIGHT = 1.76; // average avatar height referenced by the blueprint
export const PLAYER_EYE_HEIGHT = 1.62;
export const PLAYER_MOVE_SPEED = 4.6; // m/s, real-time feel (unscaled)
export const PLAYER_ACCEL = 60; // m/s^2 toward target velocity (unscaled)
export const PLAYER_AIR_ACCEL = 14;
export const PLAYER_GRAVITY = 18; // m/s^2
export const PLAYER_JUMP_SPEED = 6.4; // m/s
export const MOUSE_SENSITIVITY = 0.0022; // radians per pixel
export const PITCH_LIMIT = Math.PI / 2 - 0.04;

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

/** Player & enemy alike die in a single hit (the core fragility). */
export const ONE_HIT_KILL = true;

export const BULLET_RADIUS = 0.05;
export const KATANA_SLICE_RADIUS = 1.1; // oversized trigger so it never tunnels
export const MELEE_RANGE = 1.7;
export const MELEE_FIST_HITS_TO_KILL = 3;
export const MELEE_COMBO_RESET = 1.1; // seconds before an unarmed combo resets
export const MELEE_WEAPON_DURABILITY = 3; // impacts before an improvised weapon shatters
export const THROW_SPEED = 26;
export const THROW_MAGNETISM_RADIUS = 1.3; // cylinder-cast radius for throw assist

// ---------------------------------------------------------------------------
// Hotswitch
// ---------------------------------------------------------------------------

export const HOTSWITCH_RANGE = 60;
export const HOTSWITCH_COOLDOWN = 3.0; // seconds (world time) before reuse

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const ENEMY_RADIUS = 0.34;
export const ENEMY_HEIGHT = 1.76;
export const ENEMY_MOVE_SPEED = 2.6; // m/s in world time
export const ENEMY_SIGHT_RANGE = 70;
export const ENEMY_AIM_TIME = 0.5; // world seconds to raise weapon before firing
export const ENEMY_PREDICTION_STRENGTH = 1.0; // lead-target multiplier

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const SHARD_LIFETIME = 2.6; // seconds before death shards are culled
export const PROJECTILE_LIFETIME = 12; // world seconds before a stray bullet is culled
