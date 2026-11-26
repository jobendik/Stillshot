// ---------------------------------------------------------------------------
// Top-level game state machine
// ---------------------------------------------------------------------------

export enum GameState {
  Boot = 'boot',
  Menu = 'menu',
  Briefing = 'briefing',
  Playing = 'playing',
  Paused = 'paused',
  Dead = 'dead',
  LevelComplete = 'level-complete',
  Replay = 'replay',
  Win = 'win',
}

export type Faction = 'player' | 'enemy';

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type WeaponKind = 'fist' | 'pistol' | 'rifle' | 'shotgun' | 'nailgun' | 'bat' | 'katana';

export type WeaponCategory = 'unarmed' | 'firearm' | 'melee';

export type FireMode = 'semi' | 'burst' | 'spread';

/** How a projectile from this weapon interacts with breakable glass. */
export type GlassBehavior =
  | 'stop' // shatters glass and stops
  | 'penetrate-after-first' // first round shatters, subsequent penetrate
  | 'pellet' // one pellet shatters, the rest pass through
  | 'pierce'; // passes through glass entirely

export interface WeaponDef {
  kind: WeaponKind;
  displayName: string;
  category: WeaponCategory;
  /** Magazine capacity. No reload — a spent weapon is something to throw. */
  ammo: number;
  fireMode: FireMode;
  burstCount: number;
  /** Delay between rounds within a burst (seconds on the owner's clock). */
  burstInterval: number;
  pelletCount: number;
  /** Half-angle spread cone in radians. */
  spread: number;
  /** Seconds between trigger pulls, on the owner's clock (see WeaponInstance). */
  cooldown: number;
  /** Muzzle speed in m/s of world time. */
  projectileSpeed: number;
  /** Pierces bodies for collateral kills. */
  piercing: boolean;
  glass: GlassBehavior;
  /** Can be split / returned by a blade. */
  deflectable: boolean;
  meleeHitsToKill: number;
  durability: number;
  unbreakable: boolean;
  canSliceBullets: boolean;
  canDeflectBullets: boolean;
  throwable: boolean;
}

/** Visual class of a projectile (drives the bullet renderer & the replay). */
export type ProjectileLook = 'bullet' | 'pellet' | 'nail' | 'half';

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

/**
 * grunt    — the baseline red: relentless, predictable.
 * constant — refuses to wait for you: keeps moving while you stand still.
 * bulwark  — carries a slab that returns bullets fired at its front.
 */
export type EnemyKind = 'grunt' | 'constant' | 'bulwark';

// ---------------------------------------------------------------------------
// Level data
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];

export interface BoxColliderDef {
  pos: Vec3;
  size: Vec3;
  kind?: 'wall' | 'cover' | 'pillar' | 'plinth';
}

/** Purely visual architecture — never collides, never blocks a bullet. */
export interface DecorDef {
  pos: Vec3;
  size: Vec3;
  tone?: 'light' | 'grey' | 'dark' | 'ink' | 'red';
}

export interface GlassPaneDef {
  pos: Vec3;
  size: Vec3; // thin on one horizontal axis
}

export interface WeaponSpawnDef {
  kind: WeaponKind;
  pos: Vec3;
}

export interface ThrowableSpawnDef {
  pos: Vec3;
  radius?: number;
}

export interface EnemySpawnDef {
  pos: Vec3;
  kind?: EnemyKind;
  /** Starting weapon; omitted = unarmed (will go looking for one). */
  weapon?: WeaponKind;
  yaw?: number;
}

export interface WaveDef {
  enemies: EnemySpawnDef[];
  /**
   * 'start'   — released when the plate begins.
   * 'cleared' — released once every earlier enemy is gone.
   * 'thin'    — released once `remaining` or fewer earlier enemies are alive.
   */
  trigger: 'start' | 'cleared' | 'thin';
  remaining?: number;
  /** Delay in world seconds after the trigger condition is met. */
  delay?: number;
}

/** A region where time behaves differently. */
export interface FieldDef {
  pos: Vec3;
  radius: number;
  kind: 'still' | 'rush';
}

/** A round already in the air when the plate begins. */
export interface VolleyDef {
  pos: Vec3;
  dir: Vec3;
  weapon: WeaponKind;
}

export interface HintDef {
  /** World seconds after the plate starts, or the name of a one-shot trigger. */
  when: number | 'armed' | 'empty' | 'first-kill' | 'bullet-near' | 'borrow-ready' | 'hotswitch-ready';
  text: string;
}

export interface LevelDef {
  id: string;
  /** Short title shown on the plate card. */
  name: string;
  /** The archivist's note shown before the plate. */
  briefing: string;
  /** One line shown after the plate is developed. */
  afterword?: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  floorY: number;
  wallHeight?: number;
  spawn: { pos: Vec3; yaw: number };
  colliders: BoxColliderDef[];
  decor?: DecorDef[];
  glass: GlassPaneDef[];
  weapons: WeaponSpawnDef[];
  throwables: ThrowableSpawnDef[];
  fields?: FieldDef[];
  volley?: VolleyDef[];
  waves: WaveDef[];
  abilities: { hotswitch: boolean; borrow: boolean };
  hints?: HintDef[];
  /** Target exposure (world seconds) for a clean run. */
  par: number;
  /** Direction TO the key light. */
  sun?: Vec3;
}
