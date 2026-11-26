import { Color } from 'three';

/**
 * The palette is a reading aid before it is a style: paper-white world, ink
 * black for everything you can pick up, signal red for everything that wants
 * you dead. Two restrained accents mark places where time itself is different.
 */
export const PALETTE = {
  background: new Color(0xf1f1ee),
  fog: new Color(0xecebe7),

  envWhite: new Color(0xfbfaf7),
  envLight: new Color(0xf0efeb),
  envGrey: new Color(0xd4d3cf),
  envDarkGrey: new Color(0xa9a9a6),

  ink: new Color(0x0b0b0e),

  enemyRed: new Color(0xf5152f),
  enemyCore: new Color(0xff5a3c),

  glass: new Color(0xbfe1f0),

  /** Still fields — time pools here. */
  fieldStill: new Color(0x7fc4e6),
  /** Rush fields & Constants — time will not wait here. */
  fieldRush: new Color(0xffa23a),

  uiRed: '#f5152f',
  uiInk: '#0b0b0e',
  uiPaper: '#f1f1ee',
} as const;
