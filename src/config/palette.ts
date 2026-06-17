import { Color } from 'three';

/**
 * The stark tri-color palette. This brutalist minimalism is a cognitive-load
 * reduction technique: high contrast lets the player subconsciously parse
 * geometry, projectile vectors, and threats instantly.
 *
 *  - Environment: pristine white / sterile grey, matte (unbaked-clay look).
 *  - Interactive objects (weapons, throwables, the player body): absolute black.
 *  - Hostile entities: bright emissive red, glossy like blood-red crystal.
 */
export const PALETTE = {
  /** Sky / background clear color. */
  background: new Color(0xeef0f2),
  fog: new Color(0xe7e9ec),

  envWhite: new Color(0xffffff),
  envLight: new Color(0xf2f3f5),
  envGrey: new Color(0xd2d5da),
  envDarkGrey: new Color(0xb4b8bf),

  /** All weaponizable / interactive objects. */
  interactiveBlack: new Color(0x0a0a0c),

  /** Hostile entity body. */
  enemyRed: new Color(0xff1f3d),
  enemyRedEmissive: new Color(0xb20018),

  /** Breakable glass tint. */
  glass: new Color(0xbfe6ff),

  /** Bullet tracer core. */
  bulletCore: new Color(0x101014),
  bulletGlow: new Color(0x2a2a33),

  /** Weapon pickup highlight ring. */
  pickupRing: new Color(0x000000),

  /** UI accent (the iconic red). */
  uiRed: '#ff1f3d',
  uiWhite: '#f4f5f7',
  uiDim: '#8a8f98',
} as const;
