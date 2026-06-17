import type { WeaponDef, WeaponKind } from '@/types';

/**
 * Firearm taxonomy & projectile physics, codified directly from the blueprint.
 * Weapons are disposable, strictly limited, and have NO reload — once depleted
 * they are dropped (or thrown as a bludgeon).
 */
const DEFS: Record<WeaponKind, WeaponDef> = {
  fist: {
    kind: 'fist',
    displayName: 'FISTS',
    category: 'unarmed',
    ammo: 0,
    fireMode: 'semi',
    burstCount: 0,
    burstInterval: 0,
    pelletCount: 0,
    spread: 0,
    cooldown: 0.34,
    projectileSpeed: 0,
    piercing: false,
    glass: 'stop',
    deflectable: false,
    meleeHitsToKill: 3, // three consecutive strikes; combo resets if too slow
    durability: Infinity,
    unbreakable: true,
    canSliceBullets: false,
    canDeflectBullets: false,
    throwable: false,
  },

  pistol: {
    kind: 'pistol',
    displayName: 'PISTOL',
    category: 'firearm',
    ammo: 5,
    fireMode: 'semi',
    burstCount: 1,
    burstInterval: 0,
    pelletCount: 1,
    spread: 0.004,
    cooldown: 0.28, // short internal cooldown between shots
    projectileSpeed: 30,
    piercing: false,
    glass: 'stop', // shatters glass but does not penetrate
    deflectable: true, // can be deflected by a katana
    meleeHitsToKill: 1,
    durability: Infinity,
    unbreakable: true,
    canSliceBullets: false,
    canDeflectBullets: false,
    throwable: true,
  },

  rifle: {
    kind: 'rifle',
    displayName: 'ASSAULT RIFLE',
    category: 'firearm',
    ammo: 12,
    fireMode: 'burst',
    burstCount: 4, // 4 bullets per trigger pull; trigger cannot be interrupted
    burstInterval: 0.06,
    pelletCount: 1,
    spread: 0.012,
    cooldown: 0.5,
    projectileSpeed: 34,
    piercing: false,
    glass: 'penetrate-after-first', // first round shatters, the rest penetrate
    deflectable: true,
    meleeHitsToKill: 1,
    durability: Infinity,
    unbreakable: true,
    canSliceBullets: false,
    canDeflectBullets: false,
    throwable: true,
  },

  shotgun: {
    kind: 'shotgun',
    displayName: 'SHOTGUN',
    category: 'firearm',
    ammo: 2,
    fireMode: 'spread',
    burstCount: 1,
    burstInterval: 0,
    pelletCount: 9, // 9 simultaneous pellets, extreme lateral spread
    spread: 0.14,
    cooldown: 0.42, // ~1.5x the pistol
    projectileSpeed: 28,
    piercing: false,
    glass: 'pellet', // one pellet shatters glass, the rest pass through
    deflectable: false, // nearly impossible to fully deflect
    meleeHitsToKill: 1,
    durability: Infinity,
    unbreakable: true,
    canSliceBullets: false,
    canDeflectBullets: false,
    throwable: true,
  },

  nailgun: {
    kind: 'nailgun',
    displayName: 'FISHGUN',
    category: 'firearm',
    ammo: 3,
    fireMode: 'semi',
    burstCount: 1,
    burstInterval: 0,
    pelletCount: 1,
    spread: 0.002,
    cooldown: 0.3,
    projectileSpeed: 56, // extreme velocity, highly lethal
    piercing: true, // pierces both glass and enemy meshes — collateral multi-kills
    glass: 'pierce',
    deflectable: false, // cannot be deflected by enemy melee blocks
    meleeHitsToKill: 1,
    durability: Infinity,
    unbreakable: true,
    canSliceBullets: false,
    canDeflectBullets: false,
    throwable: true,
  },

  bat: {
    kind: 'bat',
    displayName: 'BAT',
    category: 'melee',
    ammo: 0,
    fireMode: 'semi',
    burstCount: 0,
    burstInterval: 0,
    pelletCount: 0,
    spread: 0,
    cooldown: 0.36,
    projectileSpeed: 0,
    piercing: false,
    glass: 'stop',
    deflectable: false,
    meleeHitsToKill: 1, // single kinetic strike
    durability: 3, // shatters after 3 impacts (strikes or deflects)
    unbreakable: false,
    canSliceBullets: false,
    canDeflectBullets: true, // can physically deflect incoming bullets
    throwable: true,
  },

  katana: {
    kind: 'katana',
    displayName: 'KATANA',
    category: 'melee',
    ammo: 0,
    fireMode: 'semi',
    burstCount: 0,
    burstInterval: 0,
    pelletCount: 0,
    spread: 0,
    cooldown: 0.28,
    projectileSpeed: 0,
    piercing: false,
    glass: 'stop',
    deflectable: false,
    meleeHitsToKill: 1,
    durability: Infinity,
    unbreakable: true, // completely unbreakable
    canSliceBullets: true, // slices incoming bullets out of the air
    canDeflectBullets: true,
    throwable: true,
  },
};

export function getWeaponDef(kind: WeaponKind): WeaponDef {
  return DEFS[kind];
}

export const ALL_WEAPONS = DEFS;
