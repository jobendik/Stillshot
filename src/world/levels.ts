import type { BoxColliderDef, LevelDef, VolleyDef } from '@/types';

/**
 * The campaign: eight plates. Each one is built around a single idea and gives
 * it room; later plates combine them.
 *
 *   01 FIRST LIGHT        time moves when you move; rounds are objects
 *   02 GLASS HOUSE        nothing in your hands: throw, disarm, catch
 *   03 CROSSFIRE          a round that misses you still hits something; the blade
 *   04 TRANSPOSITION      sealed rooms — the only door is another body
 *   05 BORROWED TIME      a wall of rounds with no way through; take a loan
 *   06 METRONOME          figures that keep their own time; a pool of stillness
 *   07 SLAB               what you fire at the slab comes back
 *   08 THE LONG EXPOSURE  all of it
 *
 * Conventions: +Z is "south" (the player starts there, facing -Z/north), units
 * are metres, y is up, colliders are axis-aligned boxes.
 */

type B = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Perimeter walls just outside the playable bounds. */
function walls(b: B, h = 6, t = 0.8): BoxColliderDef[] {
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

/** A waist-high display plinth; things placed at y = 1.02 rest on it. */
function plinth(x: number, z: number): BoxColliderDef {
  return { pos: [x, 0.42, z], size: [0.62, 0.84, 0.62], kind: 'plinth' };
}
const ON_PLINTH = 1.02;

/**
 * A wall across the room (along X at depth z) with a continuous window: solid
 * below 1.0m and above 2.6m. Sight, bullets and thrown things pass through the
 * opening; bodies do not (the opening is shorter than a body).
 */
function windowWall(b: B, z: number, h = 6): BoxColliderDef[] {
  const cx = (b.minX + b.maxX) / 2;
  const w = b.maxX - b.minX;
  return [
    { pos: [cx, 0.5, z], size: [w, 1.0, 0.5], kind: 'cover' },
    { pos: [cx, (2.6 + h) / 2, z], size: [w, h - 2.6, 0.5], kind: 'wall' },
  ];
}

// ---------------------------------------------------------------------------
// 01 — FIRST LIGHT
// ---------------------------------------------------------------------------
const B1: B = { minX: -6, maxX: 6, minZ: -10, maxZ: 10 };
const FIRST_LIGHT: LevelDef = {
  id: 'first-light',
  name: 'FIRST LIGHT',
  briefing:
    'plate 01. exposure begins when you do.\n\nnothing here moves unless you move.\nstand still and the room holds its breath.\n\nthere is a pistol on the plinth.\nthe red figure wants it too.',
  afterword: 'the plate develops clean. nothing red remains in it.',
  bounds: B1,
  floorY: 0,
  spawn: { pos: [0, 0, 8], yaw: 0 },
  colliders: [
    ...walls(B1),
    plinth(0, 4.4),
    { pos: [-3.2, 0.6, 0.5], size: [1.6, 1.2, 1.6], kind: 'cover' },
    { pos: [3.4, 0.6, -2.5], size: [1.6, 1.2, 1.6], kind: 'cover' },
    { pos: [0, 3, -6.5], size: [2.6, 6, 0.7], kind: 'pillar' },
  ],
  decor: [
    { pos: [-5.7, 3, -4], size: [0.3, 6, 0.3], tone: 'grey' },
    { pos: [5.7, 3, -4], size: [0.3, 6, 0.3], tone: 'grey' },
    { pos: [-5.7, 3, 4], size: [0.3, 6, 0.3], tone: 'grey' },
    { pos: [5.7, 3, 4], size: [0.3, 6, 0.3], tone: 'grey' },
  ],
  glass: [],
  weapons: [{ kind: 'pistol', pos: [0, ON_PLINTH, 4.4] }],
  throwables: [{ pos: [-2.4, 0.14, 6], radius: 0.14 }],
  waves: [
    { trigger: 'start', enemies: [{ pos: [2.5, 0, -8.5], yaw: Math.PI }] },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [-4, 0, -8], weapon: 'pistol', yaw: Math.PI },
        { pos: [4, 0, -8.5], yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [0, 0, -9], weapon: 'pistol', yaw: Math.PI },
        { pos: [-5, 0, -2], weapon: 'pistol', yaw: Math.PI },
        { pos: [5, 0, -6], yaw: Math.PI },
      ],
    },
  ],
  abilities: { hotswitch: false, borrow: false },
  hints: [
    { when: 0.02, text: 'move, and time moves. stop, and it holds.' },
    { when: 'armed', text: 'left mouse — fire. every shot spends a little time.' },
    { when: 'bullet-near', text: 'you can see a round coming. step out of its line.' },
    { when: 'empty', text: 'empty. right mouse — throw it at someone.' },
  ],
  par: 13,
};

// ---------------------------------------------------------------------------
// 02 — GLASS HOUSE
// ---------------------------------------------------------------------------
const B2: B = { minX: -10, maxX: 10, minZ: -11, maxZ: 11 };
const GLASS_HOUSE: LevelDef = {
  id: 'glass-house',
  name: 'GLASS HOUSE',
  briefing:
    'plate 02. you arrive with nothing.\n\nthe black things can be thrown.\nanything thrown knocks a weapon out of a hand —\nand a weapon in the air belongs to whoever takes it.\n\nglass will not protect anyone.',
  afterword: 'you never touched the floor for a weapon. noted.',
  bounds: B2,
  floorY: 0,
  spawn: { pos: [0, 0, 9.5], yaw: 0 },
  colliders: [
    ...walls(B2),
    plinth(-1.6, 7),
    plinth(1.6, 7),
    plinth(-8.4, 0),
    plinth(8.4, 0),
    { pos: [-5.5, 0.55, 3.5], size: [2.6, 1.1, 1], kind: 'cover' },
    { pos: [5.5, 0.55, 3.5], size: [2.6, 1.1, 1], kind: 'cover' },
    // The pavilion: four posts carrying a roof slab, glass between them.
    { pos: [-3.4, 1.6, 2], size: [0.4, 3.2, 0.4], kind: 'pillar' },
    { pos: [3.4, 1.6, 2], size: [0.4, 3.2, 0.4], kind: 'pillar' },
    { pos: [-3.4, 1.6, -5], size: [0.4, 3.2, 0.4], kind: 'pillar' },
    { pos: [3.4, 1.6, -5], size: [0.4, 3.2, 0.4], kind: 'pillar' },
  ],
  decor: [{ pos: [0, 3.35, -1.5], size: [7.6, 0.3, 7.8], tone: 'light' }],
  glass: [
    { pos: [0, 1.6, 2], size: [6.4, 3.2, 0.06] },
    { pos: [0, 1.6, -5], size: [6.4, 3.2, 0.06] },
    { pos: [-3.4, 1.6, -1.5], size: [0.06, 3.2, 6.6] },
    { pos: [3.4, 1.6, -1.5], size: [0.06, 3.2, 6.6] },
  ],
  weapons: [
    { kind: 'shotgun', pos: [8.4, ON_PLINTH, 0] },
    { kind: 'bat', pos: [-8.4, ON_PLINTH, 0] },
  ],
  throwables: [
    { pos: [-1.6, ON_PLINTH, 7], radius: 0.14 },
    { pos: [1.6, ON_PLINTH, 7], radius: 0.14 },
    { pos: [-5.5, 1.24, 3.5], radius: 0.13 },
    { pos: [5.5, 1.24, 3.5], radius: 0.13 },
  ],
  waves: [
    {
      trigger: 'start',
      enemies: [
        { pos: [0, 0, -1], weapon: 'pistol', yaw: Math.PI },
        { pos: [-7, 0, -6], weapon: 'pistol', yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.4,
      enemies: [
        { pos: [0, 0, -9], weapon: 'shotgun', yaw: Math.PI },
        { pos: [-9, 0, 7], yaw: -Math.PI / 2 },
        { pos: [9, 0, 7], yaw: Math.PI / 2 },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.4,
      enemies: [
        { pos: [7, 0, -9], weapon: 'rifle', yaw: Math.PI },
        { pos: [-7, 0, -9], weapon: 'pistol', yaw: Math.PI },
        { pos: [0, 0, -3], weapon: 'pistol', yaw: Math.PI },
        { pos: [0, 0, 10], yaw: 0 },
      ],
    },
  ],
  abilities: { hotswitch: false, borrow: false },
  hints: [
    { when: 0.02, text: 'nothing in your hands. [e] or left mouse — take the black orb.' },
    { when: 'armed', text: 'right mouse — throw. then catch what they drop.' },
    { when: 'first-kill', text: 'fists work too: one to disarm, three to break.' },
  ],
  par: 15,
};

// ---------------------------------------------------------------------------
// 03 — CROSSFIRE
// ---------------------------------------------------------------------------
const B3: B = { minX: -6, maxX: 6, minZ: -15, maxZ: 15 };
const CROSSFIRE: LevelDef = {
  id: 'crossfire',
  name: 'CROSSFIRE',
  briefing:
    'plate 03. they are on both sides of you.\n\nthey fire at where you are standing.\na round that misses you does not stop being a round.\n\nthe blade on the plinth does not block.\nswing into a round and it splits —\nboth halves go where you are looking.',
  afterword: 'most of them were killed by each other. you only moved.',
  bounds: B3,
  floorY: 0,
  spawn: { pos: [0, 0, 1], yaw: 0 },
  colliders: [
    ...walls(B3),
    plinth(0, -1.6),
    { pos: [-4.2, 3, -6], size: [1, 6, 1], kind: 'pillar' },
    { pos: [4.2, 3, -6], size: [1, 6, 1], kind: 'pillar' },
    { pos: [-4.2, 3, 6], size: [1, 6, 1], kind: 'pillar' },
    { pos: [4.2, 3, 6], size: [1, 6, 1], kind: 'pillar' },
    { pos: [0, 0.6, -9], size: [3, 1.2, 0.8], kind: 'cover' },
    { pos: [0, 0.6, 9], size: [3, 1.2, 0.8], kind: 'cover' },
  ],
  decor: [
    { pos: [0, 5.6, -6], size: [12, 0.4, 1], tone: 'grey' },
    { pos: [0, 5.6, 6], size: [12, 0.4, 1], tone: 'grey' },
  ],
  glass: [],
  weapons: [{ kind: 'katana', pos: [0, ON_PLINTH, -1.6] }],
  throwables: [
    { pos: [-2.5, 0.14, 0], radius: 0.14 },
    { pos: [2.5, 0.14, 0], radius: 0.14 },
  ],
  waves: [
    {
      trigger: 'start',
      enemies: [
        { pos: [-2.2, 0, -13], weapon: 'pistol', yaw: Math.PI },
        { pos: [2.2, 0, -13], weapon: 'pistol', yaw: Math.PI },
        { pos: [-2.2, 0, 13], weapon: 'pistol', yaw: 0 },
        { pos: [2.2, 0, 13], weapon: 'pistol', yaw: 0 },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [0, 0, -14], weapon: 'rifle', yaw: Math.PI },
        { pos: [0, 0, 14], weapon: 'rifle', yaw: 0 },
        { pos: [-5, 0, -11], yaw: Math.PI },
        { pos: [5, 0, 11], yaw: 0 },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [-3, 0, -14], weapon: 'shotgun', yaw: Math.PI },
        { pos: [3, 0, -14], weapon: 'pistol', yaw: Math.PI },
        { pos: [-3, 0, 14], weapon: 'pistol', yaw: 0 },
        { pos: [3, 0, 14], weapon: 'shotgun', yaw: 0 },
        { pos: [0, 0, -12], weapon: 'bat', yaw: Math.PI },
      ],
    },
  ],
  abilities: { hotswitch: false, borrow: false },
  hints: [
    { when: 0.02, text: 'red lines show where they are about to fire. do not be there.' },
    { when: 'armed', text: 'swing as a round arrives: it splits and returns along your aim.' },
  ],
  par: 14,
};

// ---------------------------------------------------------------------------
// 04 — TRANSPOSITION
// ---------------------------------------------------------------------------
const B4: B = { minX: -7, maxX: 7, minZ: -13, maxZ: 13 };
const TRANSPOSITION: LevelDef = {
  id: 'transposition',
  name: 'TRANSPOSITION',
  briefing:
    'plate 04. three rooms. no doors.\n\nthe instrument was never meant to hold a person.\nit is holding you anyway — and it does not much care\nwhich body it is holding you in.\n\nlook at one of them. [shift].\nthe body you leave will break.\nwhat they were carrying will still be in the air.',
  afterword: 'four bodies. one observer. the count is consistent.',
  bounds: B4,
  floorY: 0,
  spawn: { pos: [0, 0, 10.5], yaw: 0 },
  colliders: [
    ...walls(B4),
    ...windowWall(B4, 4.5),
    ...windowWall(B4, -4.5),
    { pos: [-4, 0.5, 0], size: [1.4, 1, 1.4], kind: 'cover' },
    { pos: [4, 0.5, 0], size: [1.4, 1, 1.4], kind: 'cover' },
    { pos: [0, 0.5, -9], size: [2.4, 1, 1], kind: 'cover' },
    plinth(-5.5, 10.5),
  ],
  decor: [
    { pos: [-6.85, 3, 4.5], size: [0.3, 6, 0.9], tone: 'grey' },
    { pos: [6.85, 3, 4.5], size: [0.3, 6, 0.9], tone: 'grey' },
    { pos: [-6.85, 3, -4.5], size: [0.3, 6, 0.9], tone: 'grey' },
    { pos: [6.85, 3, -4.5], size: [0.3, 6, 0.9], tone: 'grey' },
  ],
  glass: [],
  weapons: [],
  throwables: [{ pos: [-5.5, ON_PLINTH, 10.5], radius: 0.14 }],
  waves: [
    {
      trigger: 'start',
      enemies: [
        { pos: [-3, 0, 1.5], weapon: 'pistol', yaw: 0 },
        { pos: [3, 0, -1], weapon: 'pistol', yaw: 0 },
        { pos: [0, 0, -10.5], weapon: 'rifle', yaw: 0 },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [-4, 0, 9], yaw: Math.PI },
        { pos: [4, 0, 9], weapon: 'pistol', yaw: Math.PI },
        { pos: [0, 0, 0], weapon: 'shotgun', yaw: 0 },
        { pos: [-5, 0, -10], weapon: 'pistol', yaw: 0 },
        { pos: [5, 0, -10], weapon: 'pistol', yaw: 0 },
      ],
    },
  ],
  abilities: { hotswitch: true, borrow: false },
  hints: [
    { when: 0.02, text: 'you cannot reach them. aim at one — [shift] — be them.' },
    { when: 'hotswitch-ready', text: 'transfer ready again.' },
  ],
  par: 12,
};

// ---------------------------------------------------------------------------
// 05 — BORROWED TIME
// ---------------------------------------------------------------------------
const B5: B = { minX: -4.5, maxX: 4.5, minZ: -17, maxZ: 17 };
const VOLLEY: VolleyDef[] = [];
for (let row = 0; row < 3; row++) {
  for (let i = 0; i <= 21; i++) {
    VOLLEY.push({ pos: [-4.2 + i * 0.4, 0.5 + row * 0.5, 9 - row * 0.35], dir: [0, 0, 1], weapon: 'rifle' });
  }
}
const BORROWED_TIME: LevelDef = {
  id: 'borrowed-time',
  name: 'BORROWED TIME',
  briefing:
    'plate 05. the exposure opens on a volley already fired.\n\nthere is no gap. there is no time.\nso take some that is not yours.\n\n[c] stops the world completely — for a moment.\nthen the world collects: for exactly as long as you held it,\ntime runs whether you move or not.\n\nbe somewhere safe when the debt comes due.',
  afterword: 'the archive notes a debt, and notes that it was paid.',
  bounds: B5,
  floorY: 0,
  spawn: { pos: [0, 0, 14.5], yaw: 0 },
  colliders: [
    ...walls(B5),
    { pos: [-2.6, 3, 4.6], size: [1.3, 6, 1.3], kind: 'pillar' },
    { pos: [2.6, 3, 4.6], size: [1.3, 6, 1.3], kind: 'pillar' },
    plinth(-2.6, 3.2),
    plinth(2.6, 3.2),
    { pos: [0, 0.6, -3], size: [3.4, 1.2, 0.9], kind: 'cover' },
    { pos: [-3.2, 3, -9], size: [1.2, 6, 1.2], kind: 'pillar' },
    { pos: [3.2, 3, -9], size: [1.2, 6, 1.2], kind: 'pillar' },
  ],
  decor: [
    { pos: [0, 5.7, 4.6], size: [9, 0.35, 1.3], tone: 'grey' },
    { pos: [0, 5.7, -9], size: [9, 0.35, 1.2], tone: 'grey' },
  ],
  glass: [],
  weapons: [
    { kind: 'pistol', pos: [-2.6, ON_PLINTH, 3.2] },
    { kind: 'shotgun', pos: [2.6, ON_PLINTH, 3.2] },
  ],
  throwables: [{ pos: [0, 1.34, -3], radius: 0.14 }],
  volley: VOLLEY,
  waves: [
    {
      trigger: 'start',
      enemies: [
        { pos: [-2.4, 0, -6.5], weapon: 'rifle', yaw: 0 },
        { pos: [0, 0, -7.5], weapon: 'rifle', yaw: 0 },
        { pos: [2.4, 0, -6.5], weapon: 'rifle', yaw: 0 },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [-3, 0, -15], weapon: 'shotgun', yaw: 0 },
        { pos: [3, 0, -15], weapon: 'shotgun', yaw: 0 },
        { pos: [-2, 0, 15.5], yaw: Math.PI },
        { pos: [2, 0, 15.5], yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [-3.5, 0, -13], weapon: 'pistol', yaw: 0 },
        { pos: [-1.2, 0, -15], weapon: 'pistol', yaw: 0 },
        { pos: [1.2, 0, -15], weapon: 'rifle', yaw: 0 },
        { pos: [3.5, 0, -13], weapon: 'pistol', yaw: 0 },
      ],
    },
  ],
  abilities: { hotswitch: true, borrow: true },
  hints: [
    { when: 0.01, text: '[c] — borrow time. walk through them. get behind a pillar.' },
    { when: 'borrow-ready', text: 'you can borrow again.' },
  ],
  par: 16,
};

// ---------------------------------------------------------------------------
// 06 — METRONOME
// ---------------------------------------------------------------------------
const B6: B = { minX: -13, maxX: 13, minZ: -13, maxZ: 13 };
const METRONOME: LevelDef = {
  id: 'metronome',
  name: 'METRONOME',
  briefing:
    'plate 06. some of them have learned to keep their own time.\n\nthe ones wearing a turning ring do not wait for you.\nstand still and they keep coming — slowly, but they keep coming.\nlisten: you can hear them counting.\n\nin the blue, time pools. rounds that enter it almost stop.\nin the amber, it will not wait at all.',
  afterword: 'they kept their own time. it ran out anyway.',
  bounds: B6,
  floorY: 0,
  spawn: { pos: [0, 0, 11], yaw: 0 },
  colliders: [
    ...walls(B6),
    plinth(0, 0),
    plinth(-10, 9),
    plinth(10, 9),
    { pos: [-7, 3, -5], size: [1.2, 6, 1.2], kind: 'pillar' },
    { pos: [7, 3, -5], size: [1.2, 6, 1.2], kind: 'pillar' },
    { pos: [-7, 3, 5], size: [1.2, 6, 1.2], kind: 'pillar' },
    { pos: [7, 3, 5], size: [1.2, 6, 1.2], kind: 'pillar' },
    { pos: [-4, 0.55, 7], size: [2.6, 1.1, 0.9], kind: 'cover' },
    { pos: [4, 0.55, 7], size: [2.6, 1.1, 0.9], kind: 'cover' },
    { pos: [0, 0.55, -8], size: [4, 1.1, 0.9], kind: 'cover' },
  ],
  decor: [
    { pos: [0, 5.7, -5], size: [15.2, 0.35, 1.2], tone: 'grey' },
    { pos: [0, 5.7, 5], size: [15.2, 0.35, 1.2], tone: 'grey' },
  ],
  glass: [],
  weapons: [
    { kind: 'rifle', pos: [0, ON_PLINTH, 0] },
    { kind: 'pistol', pos: [-10, ON_PLINTH, 9] },
    { kind: 'katana', pos: [10, ON_PLINTH, 9] },
  ],
  throwables: [
    { pos: [-4, 1.24, 7], radius: 0.14 },
    { pos: [4, 1.24, 7], radius: 0.14 },
  ],
  fields: [
    { pos: [0, 1.2, 0], radius: 3.6, kind: 'still' },
    { pos: [0, 1.2, -10.5], radius: 3.2, kind: 'rush' },
  ],
  waves: [
    {
      trigger: 'start',
      enemies: [
        { pos: [-11, 0, -11], kind: 'constant', yaw: Math.PI },
        { pos: [11, 0, -11], kind: 'constant', yaw: Math.PI },
        { pos: [0, 0, -10.5], weapon: 'pistol', yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [0, 0, -11.5], kind: 'constant', weapon: 'pistol', yaw: Math.PI },
        { pos: [-11, 0, 0], weapon: 'rifle', yaw: -Math.PI / 2 },
        { pos: [11, 0, 0], weapon: 'rifle', yaw: Math.PI / 2 },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [-11, 0, -11], kind: 'constant', yaw: Math.PI },
        { pos: [11, 0, -11], kind: 'constant', yaw: Math.PI },
        { pos: [0, 0, 12], kind: 'constant', weapon: 'bat', yaw: 0 },
        { pos: [-1.5, 0, -10.5], weapon: 'shotgun', yaw: Math.PI },
        { pos: [1.5, 0, -10.5], weapon: 'pistol', yaw: Math.PI },
      ],
    },
  ],
  abilities: { hotswitch: true, borrow: true },
  hints: [{ when: 0.4, text: 'the ringed ones do not stop when you do.' }],
  par: 20,
};

// ---------------------------------------------------------------------------
// 07 — SLAB
// ---------------------------------------------------------------------------
const B7: B = { minX: -9, maxX: 9, minZ: -13, maxZ: 13 };
const SLAB: LevelDef = {
  id: 'slab',
  name: 'SLAB',
  briefing:
    'plate 07. the white slab returns whatever is fired at it.\n\nit is slow to turn. it cannot face two ways.\nanything thrown knocks it aside.\na spike goes straight through.\n\nor let it carry your round to someone else.',
  afterword: 'every round you were returned, you had sent. the plate is fair.',
  bounds: B7,
  floorY: 0,
  spawn: { pos: [0, 0, 11], yaw: 0 },
  colliders: [
    ...walls(B7),
    plinth(-7.5, 10),
    plinth(7.5, 10),
    plinth(7.5, -11),
    { pos: [-5, 3, 3], size: [1.2, 6, 1.2], kind: 'pillar' },
    { pos: [5, 3, 3], size: [1.2, 6, 1.2], kind: 'pillar' },
    { pos: [-5, 3, -5], size: [1.2, 6, 1.2], kind: 'pillar' },
    { pos: [5, 3, -5], size: [1.2, 6, 1.2], kind: 'pillar' },
    { pos: [0, 0.55, 6.5], size: [3, 1.1, 0.9], kind: 'cover' },
    { pos: [0, 0.55, -9], size: [3, 1.1, 0.9], kind: 'cover' },
  ],
  decor: [
    { pos: [-5, 5.7, -1], size: [1.2, 0.35, 9.2], tone: 'grey' },
    { pos: [5, 5.7, -1], size: [1.2, 0.35, 9.2], tone: 'grey' },
  ],
  glass: [{ pos: [0, 1.5, -1], size: [8.8, 3, 0.06] }],
  weapons: [
    { kind: 'pistol', pos: [-7.5, ON_PLINTH, 10] },
    { kind: 'bat', pos: [7.5, ON_PLINTH, 10] },
    { kind: 'nailgun', pos: [7.5, ON_PLINTH, -11] },
  ],
  throwables: [
    { pos: [-1, 1.24, 6.5], radius: 0.14 },
    { pos: [1, 1.24, 6.5], radius: 0.14 },
    { pos: [-7.5, 0.14, 0], radius: 0.14 },
    { pos: [7.5, 0.14, 0], radius: 0.14 },
  ],
  fields: [{ pos: [0, 1.2, -6], radius: 2.8, kind: 'rush' }],
  waves: [
    { trigger: 'start', enemies: [{ pos: [0, 0, -8], kind: 'bulwark', weapon: 'pistol', yaw: Math.PI }] },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [-2.5, 0, -10], kind: 'bulwark', weapon: 'pistol', yaw: Math.PI },
        { pos: [2.5, 0, -10], kind: 'bulwark', weapon: 'pistol', yaw: Math.PI },
        { pos: [0, 0, -12], weapon: 'rifle', yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [0, 0, -11], kind: 'bulwark', weapon: 'shotgun', yaw: Math.PI },
        { pos: [-8, 0, -11], weapon: 'pistol', yaw: Math.PI },
        { pos: [8, 0, -3], weapon: 'pistol', yaw: Math.PI },
        { pos: [-8, 0, 12], kind: 'constant', yaw: 0 },
      ],
    },
  ],
  abilities: { hotswitch: true, borrow: true },
  hints: [{ when: 0.3, text: 'do not shoot the slab. throw something at it — or get behind it.' }],
  par: 22,
};

// ---------------------------------------------------------------------------
// 08 — THE LONG EXPOSURE
// ---------------------------------------------------------------------------
const B8: B = { minX: -14, maxX: 14, minZ: -16, maxZ: 16 };
const LONG_EXPOSURE: LevelDef = {
  id: 'long-exposure',
  name: 'THE LONG EXPOSURE',
  briefing:
    'plate 08. there is one exposure left.\nit is the one you are standing in.\n\neverything the archive has shown you is in this room.\nit will not show you anything again.\n\nspend it well.',
  afterword: 'the shutter closes.',
  bounds: B8,
  floorY: 0,
  spawn: { pos: [0, 0, 14], yaw: 0 },
  colliders: [
    ...walls(B8, 7),
    plinth(0, 10.5),
    plinth(-12, 6),
    plinth(12, 6),
    plinth(-12, -10),
    plinth(12, -10),
    // Central dais you can stand on, with a monolith behind it.
    { pos: [0, 0.5, 0], size: [5, 1, 5], kind: 'cover' },
    { pos: [0, 3.5, -3.2], size: [3, 7, 0.8], kind: 'pillar' },
    { pos: [-8, 3.5, 2], size: [1.3, 7, 1.3], kind: 'pillar' },
    { pos: [8, 3.5, 2], size: [1.3, 7, 1.3], kind: 'pillar' },
    { pos: [-8, 3.5, -8], size: [1.3, 7, 1.3], kind: 'pillar' },
    { pos: [8, 3.5, -8], size: [1.3, 7, 1.3], kind: 'pillar' },
    { pos: [-5, 0.55, 8], size: [2.8, 1.1, 0.9], kind: 'cover' },
    { pos: [5, 0.55, 8], size: [2.8, 1.1, 0.9], kind: 'cover' },
    { pos: [-10, 0.55, -3], size: [0.9, 1.1, 3], kind: 'cover' },
    { pos: [10, 0.55, -3], size: [0.9, 1.1, 3], kind: 'cover' },
  ],
  decor: [
    { pos: [-8, 6.7, -3], size: [1.3, 0.4, 11.3], tone: 'grey' },
    { pos: [8, 6.7, -3], size: [1.3, 0.4, 11.3], tone: 'grey' },
    { pos: [0, 6.7, -8], size: [17.3, 0.4, 1.3], tone: 'grey' },
  ],
  glass: [
    { pos: [-4.5, 1.6, -8], size: [5.6, 3.2, 0.06] },
    { pos: [4.5, 1.6, -8], size: [5.6, 3.2, 0.06] },
    { pos: [-8, 1.6, -3], size: [0.06, 3.2, 8.6] },
    { pos: [8, 1.6, -3], size: [0.06, 3.2, 8.6] },
  ],
  weapons: [
    { kind: 'pistol', pos: [0, ON_PLINTH, 10.5] },
    { kind: 'katana', pos: [-12, ON_PLINTH, 6] },
    { kind: 'shotgun', pos: [12, ON_PLINTH, 6] },
    { kind: 'nailgun', pos: [-12, ON_PLINTH, -10] },
    { kind: 'rifle', pos: [12, ON_PLINTH, -10] },
  ],
  throwables: [
    { pos: [-5, 1.24, 8], radius: 0.14 },
    { pos: [5, 1.24, 8], radius: 0.14 },
    { pos: [-1.5, 1.14, 1.5], radius: 0.14 },
    { pos: [1.5, 1.14, 1.5], radius: 0.14 },
  ],
  fields: [
    { pos: [0, 1.4, 5.2], radius: 2.6, kind: 'still' },
    { pos: [0, 1.4, -12.5], radius: 3.4, kind: 'rush' },
  ],
  waves: [
    {
      trigger: 'start',
      enemies: [
        { pos: [-11, 0, -13], weapon: 'pistol', yaw: Math.PI },
        { pos: [11, 0, -13], weapon: 'pistol', yaw: Math.PI },
        { pos: [0, 0, -12.5], weapon: 'rifle', yaw: Math.PI },
        { pos: [-4, 0, -11], yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [0, 0, -13], kind: 'bulwark', weapon: 'pistol', yaw: Math.PI },
        { pos: [-13, 0, 0], kind: 'constant', yaw: -Math.PI / 2 },
        { pos: [13, 0, 0], kind: 'constant', yaw: Math.PI / 2 },
        { pos: [3, 0, -14], weapon: 'shotgun', yaw: Math.PI },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.5,
      enemies: [
        { pos: [-3, 0, -13], kind: 'bulwark', weapon: 'pistol', yaw: Math.PI },
        { pos: [3, 0, -13], kind: 'bulwark', weapon: 'shotgun', yaw: Math.PI },
        { pos: [0, 0, -15], weapon: 'nailgun', yaw: Math.PI },
        { pos: [-13, 0, 14], weapon: 'pistol', yaw: -Math.PI / 4 },
        { pos: [13, 0, 14], weapon: 'pistol', yaw: Math.PI / 4 },
      ],
    },
    {
      trigger: 'cleared',
      delay: 0.6,
      enemies: [
        { pos: [0, 0, -13.5], kind: 'constant', weapon: 'rifle', yaw: Math.PI },
        { pos: [-12, 0, -13], kind: 'constant', yaw: Math.PI },
        { pos: [12, 0, -13], kind: 'constant', yaw: Math.PI },
        { pos: [-13, 0, 3], weapon: 'rifle', yaw: -Math.PI / 2 },
        { pos: [13, 0, 3], weapon: 'shotgun', yaw: Math.PI / 2 },
        { pos: [0, 0, 15], weapon: 'katana', yaw: 0 },
      ],
    },
  ],
  abilities: { hotswitch: true, borrow: true },
  par: 34,
};

export const LEVELS: LevelDef[] = [
  FIRST_LIGHT,
  GLASS_HOUSE,
  CROSSFIRE,
  TRANSPOSITION,
  BORROWED_TIME,
  METRONOME,
  SLAB,
  LONG_EXPOSURE,
];

export function getLevel(index: number): LevelDef {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))];
}
