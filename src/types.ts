import type { Vector3 } from 'three';

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
  Replay = 'replay',
  LevelComplete = 'level-complete',
  Win = 'win',
}

export type Faction = 'player' | 'enemy';

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

export type WeaponKind =
  | 'fist'
  | 'pistol'
  | 'rifle'
  | 'shotgun'
  | 'nailgun'
  | 'bat'
  | 'katana';

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
  /** Magazine capacity. Firearms have no reload — depleted weapons are dropped. */
  ammo: number;
  fireMode: FireMode;
  /** Rounds fired per trigger pull for burst weapons. */
  burstCount: number;
  /** Delay (real seconds) between rounds within a burst. */
  burstInterval: number;
  /** Pellets per shell for spread weapons. */
  pelletCount: number;
  /** Half-angle spread cone in radians. */
  spread: number;
  /** Minimum real-time seconds between trigger pulls. */
  cooldown: number;
  /** Projectile muzzle speed in m/s (world time). */
  projectileSpeed: number;
  /** Pierces enemy meshes for collateral kills. */
  piercing: boolean;
  glass: GlassBehavior;
  /** Can be deflected/sliced by an opposing katana or bat. */
  deflectable: boolean;
  // Melee / unarmed
  meleeHitsToKill: number;
  durability: number; // improvised melee weapons shatter after this many impacts
  unbreakable: boolean; // katana
  canSliceBullets: boolean; // katana
  canDeflectBullets: boolean; // bat / katana
  // Handling
  throwable: boolean;
}

// ---------------------------------------------------------------------------
// Lightweight transform snapshot used by the replay recorder
// ---------------------------------------------------------------------------

export interface TransformSnapshot {
  px: number;
  py: number;
  pz: number;
  /** Quaternion */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface ReplayFrame {
  t: number; // accumulated world time at capture
  camera: TransformSnapshot;
  enemies: Array<TransformSnapshot & { alive: boolean }>;
  projectiles: Array<{ px: number; py: number; pz: number }>;
}

// ---------------------------------------------------------------------------
// Spawn / level data
// ---------------------------------------------------------------------------

export interface BoxColliderDef {
  /** Center position. */
  pos: [number, number, number];
  /** Full size (width, height, depth). */
  size: [number, number, number];
  /** 'wall' | 'cover' — both block movement & bullets. */
  kind?: 'wall' | 'cover' | 'pillar';
}

export interface GlassPaneDef {
  pos: [number, number, number];
  size: [number, number, number]; // thin on one axis
}

export interface WeaponSpawnDef {
  kind: WeaponKind;
  pos: [number, number, number];
}

export interface ThrowableSpawnDef {
  pos: [number, number, number];
  /** Visual scale of the black throwable. */
  radius?: number;
}

export interface EnemySpawnDef {
  pos: [number, number, number];
  /** Starting weapon, or undefined = unarmed (will seek a weapon). */
  weapon?: WeaponKind;
  /** Facing yaw in radians. */
  yaw?: number;
}

export interface WaveDef {
  /** Enemies in this wave. */
  enemies: EnemySpawnDef[];
  /**
   * Trigger to release the wave: 'start' (immediately), or 'cleared'
   * (when the previous wave's enemies are all dead).
   */
  trigger: 'start' | 'cleared';
  /** Optional delay (world seconds) after the trigger condition. */
  delay?: number;
}

export interface LevelDef {
  id: string;
  name: string;
  /** Faux-DOS briefing text shown before the level. */
  briefing: string;
  /** Arena floor extents (half-sizes from origin) used for the nav grid + bounds. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  floorY: number;
  spawn: { pos: [number, number, number]; yaw: number };
  colliders: BoxColliderDef[];
  glass: GlassPaneDef[];
  weapons: WeaponSpawnDef[];
  throwables: ThrowableSpawnDef[];
  waves: WaveDef[];
}

// ---------------------------------------------------------------------------
// Shared spatial helpers
// ---------------------------------------------------------------------------

export interface RayHit {
  point: Vector3;
  distance: number;
  /** What was struck. */
  kind: 'wall' | 'glass' | 'none';
  /** Reference to the glass pane index if kind === 'glass'. */
  glassIndex?: number;
}
