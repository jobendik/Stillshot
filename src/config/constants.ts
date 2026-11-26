/**
 * Global tuning constants for the STILLSHOT temporal engine.
 *
 * The defining rule: time is SPENT. The world advances at a rate set by how much
 * the player is doing (translation + weighted look speed), and every discrete
 * action (a shot, a swing, a throw) releases a small, fixed quantum of world
 * time. Standing perfectly still slows the world to 1/200th — never fully
 * frozen, so hostile rounds keep inching forward.
 */

// ---------------------------------------------------------------------------
// Temporal mechanics
// ---------------------------------------------------------------------------

/** Idle time scale — 1/200th of normal flow. Never fully frozen. */
export const MIN_TIME_SCALE = 0.005;
/** Full real-time flow when the player moves at full speed. */
export const MAX_TIME_SCALE = 1.0;
/** Looking around spends time, but less than physically moving. */
export const ROTATION_WEIGHT = 0.55;
/**
 * Filtered look speed (radians / second) that maps to a rotation magnitude of
 * 1.0. Expressed as an angular VELOCITY so the cost of a mouse sweep is the same
 * at 30, 60 or 240 fps (the original summed pixels per rendered frame).
 */
export const ROTATION_REFERENCE = 4.0;
/** Low-pass time constant (s) applied to the instantaneous look speed. */
export const ROTATION_FILTER_TAU = 0.06;
/** How fast time speeds up (per second). */
export const TIME_ATTACK_RATE = 22;
/** How fast time settles back down (per second). */
export const TIME_RELEASE_RATE = 9;
/** While airborne with jump held the scale is capped here — aerial planning. */
export const JUMP_DILATION_CAP = 0.25;
/** Hard clamp on one real frame delta, so a stalled tab cannot leap the world. */
export const MAX_FRAME_DT = 1 / 20;

/**
 * World-seconds released by each discrete action (on top of the ~0.1s the
 * release curve adds as time settles). "Every action spends time."
 */
export const ACTION_COST = {
  fire: 0.05,
  melee: 0.09,
  throw: 0.05,
  pickup: 0.03,
  hotswitch: 0.08,
} as const;

// ---------------------------------------------------------------------------
// Borrowed time
// ---------------------------------------------------------------------------

/** Maximum real seconds the world can be held completely still. */
export const BORROW_MAX = 1.6;
/** Rate at which the world collects the debt (world-seconds per real second). */
export const BORROW_REPAY_RATE = 1.0;
/** World seconds after the debt is cleared before time can be borrowed again. */
export const BORROW_COOLDOWN = 4.0;
/** How much of a borrowed second the replay shows (the world is frozen meanwhile). */
export const BORROW_REPLAY_RATE = 0.3;

// ---------------------------------------------------------------------------
// Local time fields
// ---------------------------------------------------------------------------

/** Inside a still field, world time advances at this fraction of the global rate. */
export const STILL_FIELD_FACTOR = 0.06;
/** Inside a rush field (and for Constants), time never drops below this real-time rate. */
export const RUSH_FIELD_FLOOR = 0.45;
export const CONSTANT_TIME_FLOOR = 0.28;

// ---------------------------------------------------------------------------
// Player kinematics (all on REAL time)
// ---------------------------------------------------------------------------

export const PLAYER_RADIUS = 0.34;
export const PLAYER_HEIGHT = 1.76;
export const PLAYER_EYE_HEIGHT = 1.62;
export const PLAYER_MOVE_SPEED = 4.8;
export const PLAYER_ACCEL = 60;
export const PLAYER_AIR_ACCEL = 14;
export const PLAYER_GRAVITY = 19;
export const PLAYER_JUMP_SPEED = 7.2; // apex ~1.36m — enough to mount waist-high cover
export const MOUSE_SENSITIVITY = 0.0022; // radians per pixel at sensitivity 1.0
export const PITCH_LIMIT = Math.PI / 2 - 0.04;
/** Jump buffered this long before landing still fires; and this long after leaving a ledge. */
export const JUMP_BUFFER = 0.12;
export const COYOTE_TIME = 0.1;

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

export const BULLET_RADIUS = 0.05;
export const BLADE_REACH = 0.95;
export const KATANA_SLICE_RADIUS = 1.05;
export const BAT_DEFLECT_RADIUS = 0.9;
/** Half-angle (radians) between the two halves of a split bullet. */
export const SPLIT_ANGLE = 0.11;
export const MELEE_RANGE = 1.9;
export const MELEE_FIST_HITS_TO_KILL = 3;
export const MELEE_COMBO_RESET = 1.4;
export const THROW_SPEED = 24;
export const THROW_MAGNETISM_RADIUS = 1.1;
export const PICKUP_RANGE = 2.1;
/** Crosshair-targeted grab reach (lets you snatch weapons out of the air). */
export const GRAB_REACH = 3.6;
export const SWING_TIME = 0.24;

// ---------------------------------------------------------------------------
// Hotswitch
// ---------------------------------------------------------------------------

export const HOTSWITCH_RANGE = 60;
export const HOTSWITCH_COOLDOWN = 3.0; // world seconds

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export const ENEMY_RADIUS = 0.34;
export const ENEMY_HEIGHT = 1.78;
export const ENEMY_MOVE_SPEED = 2.7;
export const ENEMY_SIGHT_RANGE = 70;
export const ENEMY_AIM_TIME = 0.62; // world seconds from acquiring to firing (telegraphed)
export const ENEMY_PREDICTION_STRENGTH = 0.8;
export const ENEMY_DEVELOP_TIME = 0.75; // world seconds to materialise (harmless meanwhile)
export const ENEMY_MELEE_WINDUP = 0.42;
export const ENEMY_MELEE_RECOVER = 0.55;
export const ENEMY_MELEE_REACH = 1.75;

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const SHARD_LIFETIME = 7.0; // world seconds before a shard cloud dissolves
export const PROJECTILE_LIFETIME = 12;
export const GRAVITY = 18;
