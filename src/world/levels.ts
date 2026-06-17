import type { BoxColliderDef, LevelDef } from '@/types';

/** Build the 4 perimeter walls just outside the playable bounds. */
function walls(
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  h = 4.5,
  t = 0.6,
): BoxColliderDef[] {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  return [
    { pos: [cx, h / 2, b.minZ - t / 2], size: [w + 2 * t, h, t], kind: 'wall' },
    { pos: [cx, h / 2, b.maxZ + t / 2], size: [w + 2 * t, h, t], kind: 'wall' },
    { pos: [b.maxX + t / 2, h / 2, cz], size: [t, h, d + 2 * t], kind: 'wall' },
    { pos: [b.minX - t / 2, h / 2, cz], size: [t, h, d + 2 * t], kind: 'wall' },
  ];
}

// ---------------------------------------------------------------------------
// 01 — ACCESS NODE  (tutorial: learn that time moves when you move)
// ---------------------------------------------------------------------------
const ACCESS_NODE: LevelDef = {
  id: 'access-node',
  name: 'ACCESS NODE',
  briefing:
    'time moves when you move.\nstop, and the world holds its breath.\ngrab the pistol. dismantle the red.',
  bounds: { minX: -7, maxX: 7, minZ: -9, maxZ: 9 },
  floorY: 0,
  spawn: { pos: [0, 0, 7.5], yaw: 0 },
  colliders: [
    ...walls({ minX: -7, maxX: 7, minZ: -9, maxZ: 9 }),
    { pos: [-3, 0.6, 1], size: [1.4, 1.2, 1.4], kind: 'cover' },
    { pos: [3.2, 0.6, -1.5], size: [1.4, 1.2, 1.4], kind: 'cover' },
    { pos: [0, 1.5, -6], size: [2.2, 3, 0.6], kind: 'pillar' },
  ],
  glass: [],
  weapons: [{ kind: 'pistol', pos: [0, 0.5, 5.5] }],
  throwables: [{ pos: [-2.5, 0.2, 4], radius: 0.13 }],
  waves: [
    {
      trigger: 'start',
      enemies: [
        { pos: [-3, 0, -5], weapon: 'pistol', yaw: Math.PI },
        { pos: [3, 0, -6], yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.4,
      enemies: [
        { pos: [0, 0, -8], weapon: 'pistol', yaw: Math.PI },
        { pos: [5, 0, -7], yaw: Math.PI },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 02 — OPEN OFFICE  (cover + glass; mixed arsenal)
// ---------------------------------------------------------------------------
const OPEN_OFFICE: LevelDef = {
  id: 'open-office',
  name: 'OPEN OFFICE',
  briefing:
    'glass shatters. bullets do not care.\none pellet opens the window — the rest pass through.\nuse the room. use the time.',
  bounds: { minX: -10, maxX: 10, minZ: -11, maxZ: 11 },
  floorY: 0,
  spawn: { pos: [0, 0, 9.5], yaw: 0 },
  colliders: [
    ...walls({ minX: -10, maxX: 10, minZ: -11, maxZ: 11 }),
    { pos: [-5, 0.5, 3], size: [3, 1, 1.2], kind: 'cover' },
    { pos: [5, 0.5, 3], size: [3, 1, 1.2], kind: 'cover' },
    { pos: [-6, 0.5, -3], size: [1.2, 1, 3], kind: 'cover' },
    { pos: [6, 0.5, -3], size: [1.2, 1, 3], kind: 'cover' },
    { pos: [0, 1.6, -7.5], size: [0.8, 3.2, 0.8], kind: 'pillar' },
    { pos: [-3.5, 1.6, -7.5], size: [0.8, 3.2, 0.8], kind: 'pillar' },
    { pos: [3.5, 1.6, -7.5], size: [0.8, 3.2, 0.8], kind: 'pillar' },
  ],
  glass: [
    { pos: [-2.2, 1.2, 0], size: [4, 2.4, 0.06] },
    { pos: [2.2, 1.2, 0], size: [4, 2.4, 0.06] },
  ],
  weapons: [
    { kind: 'pistol', pos: [0, 0.5, 8] },
    { kind: 'shotgun', pos: [-8, 0.5, 1] },
    { kind: 'rifle', pos: [8, 0.5, 1] },
  ],
  throwables: [
    { pos: [-1.5, 0.2, 6], radius: 0.13 },
    { pos: [1.5, 0.2, 6], radius: 0.13 },
    { pos: [0, 0.2, -2], radius: 0.16 },
  ],
  waves: [
    {
      trigger: 'start',
      enemies: [
        { pos: [-6, 0, -5], weapon: 'pistol', yaw: Math.PI },
        { pos: [6, 0, -5], weapon: 'pistol', yaw: Math.PI },
        { pos: [0, 0, -9], weapon: 'rifle', yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.3,
      enemies: [
        { pos: [-9, 0, 8], yaw: -Math.PI / 2 }, // spawns BEHIND the player's likely position
        { pos: [9, 0, 8], yaw: Math.PI / 2 },
        { pos: [0, 0, -9.5], weapon: 'shotgun', yaw: Math.PI },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 03 — ATRIUM  (vertical pillars, longer sightlines, the nailgun)
// ---------------------------------------------------------------------------
const ATRIUM: LevelDef = {
  id: 'atrium',
  name: 'ATRIUM',
  briefing:
    'the fishgun pierces everything.\nline them up. one nail, many dead.\nthey will appear where you feel safe.',
  bounds: { minX: -12, maxX: 12, minZ: -13, maxZ: 13 },
  floorY: 0,
  spawn: { pos: [0, 0, 11.5], yaw: 0 },
  colliders: [
    ...walls({ minX: -12, maxX: 12, minZ: -13, maxZ: 13 }),
    { pos: [-7, 1.8, -2], size: [1, 3.6, 1], kind: 'pillar' },
    { pos: [7, 1.8, -2], size: [1, 3.6, 1], kind: 'pillar' },
    { pos: [-7, 1.8, 5], size: [1, 3.6, 1], kind: 'pillar' },
    { pos: [7, 1.8, 5], size: [1, 3.6, 1], kind: 'pillar' },
    { pos: [0, 0.6, 0], size: [4, 1.2, 1.2], kind: 'cover' },
    { pos: [-9, 0.5, -8], size: [2, 1, 2], kind: 'cover' },
    { pos: [9, 0.5, -8], size: [2, 1, 2], kind: 'cover' },
  ],
  glass: [
    { pos: [0, 1.4, -6], size: [6, 2.8, 0.06] },
    { pos: [-4.5, 1.4, -6], size: [0.06, 2.8, 4] },
    { pos: [4.5, 1.4, -6], size: [0.06, 2.8, 4] },
  ],
  weapons: [
    { kind: 'pistol', pos: [-1, 0.5, 10] },
    { kind: 'nailgun', pos: [0, 0.5, -1] },
    { kind: 'rifle', pos: [-10, 0.5, 2] },
    { kind: 'shotgun', pos: [10, 0.5, 2] },
    { kind: 'katana', pos: [0, 0.5, 4] },
  ],
  throwables: [
    { pos: [-3, 0.2, 7], radius: 0.13 },
    { pos: [3, 0.2, 7], radius: 0.13 },
    { pos: [-6, 0.2, -10], radius: 0.16 },
    { pos: [6, 0.2, -10], radius: 0.16 },
  ],
  waves: [
    {
      trigger: 'start',
      enemies: [
        { pos: [-8, 0, -10], weapon: 'pistol', yaw: Math.PI },
        { pos: [8, 0, -10], weapon: 'pistol', yaw: Math.PI },
        { pos: [0, 0, -11], weapon: 'rifle', yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.3,
      enemies: [
        { pos: [-11, 0, 0], weapon: 'shotgun', yaw: Math.PI / 2 },
        { pos: [11, 0, 0], weapon: 'rifle', yaw: -Math.PI / 2 },
        { pos: [-11, 0, 11], yaw: -Math.PI / 4 }, // behind
        { pos: [11, 0, 11], yaw: Math.PI / 4 }, // behind
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [0, 0, -12], weapon: 'rifle', yaw: Math.PI },
        { pos: [-5, 0, -12], weapon: 'pistol', yaw: Math.PI },
        { pos: [5, 0, -12], weapon: 'pistol', yaw: Math.PI },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// 04 — CORE  (the climax: hotswitch is your friend)
// ---------------------------------------------------------------------------
const CORE: LevelDef = {
  id: 'core',
  name: 'THE CORE',
  briefing:
    'they are endless. you are not.\nproject into the red. take their body. keep moving.\nsuper. hot.',
  bounds: { minX: -13, maxX: 13, minZ: -14, maxZ: 14 },
  floorY: 0,
  spawn: { pos: [0, 0, 12.5], yaw: 0 },
  colliders: [
    ...walls({ minX: -13, maxX: 13, minZ: -14, maxZ: 14 }),
    { pos: [0, 1.5, 0], size: [2, 3, 2], kind: 'pillar' },
    { pos: [-8, 0.6, 4], size: [2.4, 1.2, 1.2], kind: 'cover' },
    { pos: [8, 0.6, 4], size: [2.4, 1.2, 1.2], kind: 'cover' },
    { pos: [-8, 0.6, -6], size: [2.4, 1.2, 1.2], kind: 'cover' },
    { pos: [8, 0.6, -6], size: [2.4, 1.2, 1.2], kind: 'cover' },
    { pos: [0, 1.6, -10], size: [5, 3.2, 0.6], kind: 'pillar' },
  ],
  glass: [
    { pos: [-5.5, 1.3, 7], size: [4, 2.6, 0.06] },
    { pos: [5.5, 1.3, 7], size: [4, 2.6, 0.06] },
  ],
  weapons: [
    { kind: 'pistol', pos: [0, 0.5, 11] },
    { kind: 'rifle', pos: [-3, 0.5, 9] },
    { kind: 'shotgun', pos: [3, 0.5, 9] },
    { kind: 'nailgun', pos: [-10, 0.5, 0] },
    { kind: 'katana', pos: [10, 0.5, 0] },
  ],
  throwables: [
    { pos: [-2, 0.2, 6], radius: 0.14 },
    { pos: [2, 0.2, 6], radius: 0.14 },
    { pos: [0, 0.2, 2], radius: 0.16 },
  ],
  waves: [
    {
      trigger: 'start',
      enemies: [
        { pos: [-9, 0, -8], weapon: 'pistol', yaw: Math.PI },
        { pos: [9, 0, -8], weapon: 'pistol', yaw: Math.PI },
        { pos: [0, 0, -12], weapon: 'rifle', yaw: Math.PI },
        { pos: [-4, 0, -11], weapon: 'shotgun', yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.3,
      enemies: [
        { pos: [-12, 0, 10], yaw: -Math.PI / 3 },
        { pos: [12, 0, 10], yaw: Math.PI / 3 },
        { pos: [-12, 0, -2], weapon: 'rifle', yaw: -Math.PI / 2 },
        { pos: [12, 0, -2], weapon: 'rifle', yaw: Math.PI / 2 },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.4,
      enemies: [
        { pos: [0, 0, -13], weapon: 'rifle', yaw: Math.PI },
        { pos: [-6, 0, -13], weapon: 'shotgun', yaw: Math.PI },
        { pos: [6, 0, -13], weapon: 'nailgun', yaw: Math.PI },
        { pos: [-12, 0, 12], yaw: -Math.PI / 4 },
        { pos: [12, 0, 12], yaw: Math.PI / 4 },
      ],
    },
  ],
};

export const LEVELS: LevelDef[] = [ACCESS_NODE, OPEN_OFFICE, ATRIUM, CORE];

export function getLevel(index: number): LevelDef {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))];
}
