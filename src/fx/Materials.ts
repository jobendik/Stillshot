import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';
import { PALETTE } from '@/config/palette';

/**
 * Shared material library. The blueprint's color-isolation rule:
 *   white/grey matte = environment, black = interactive, glossy red = hostile.
 *
 * Materials are cached singletons (one per visual class) so thousands of shards
 * and bullets reuse a handful of GPU programs.
 */
class MaterialLibrary {
  /** Pristine white, matte — "unbaked clay / default viewport" look. */
  readonly envWhite = new MeshStandardMaterial({
    color: PALETTE.envWhite,
    roughness: 0.92,
    metalness: 0.0,
  });

  readonly envLight = new MeshStandardMaterial({
    color: PALETTE.envLight,
    roughness: 0.9,
    metalness: 0.0,
  });

  readonly envGrey = new MeshStandardMaterial({
    color: PALETTE.envGrey,
    roughness: 0.85,
    metalness: 0.0,
  });

  readonly envDarkGrey = new MeshStandardMaterial({
    color: PALETTE.envDarkGrey,
    roughness: 0.8,
    metalness: 0.0,
  });

  /** All weaponizable / interactive objects — absolute black. */
  readonly interactive = new MeshStandardMaterial({
    color: PALETTE.interactiveBlack,
    roughness: 0.45,
    metalness: 0.1,
  });

  /** Hostile entity — bright emissive red, glossy like blood-red crystal. */
  readonly enemy = new MeshStandardMaterial({
    color: PALETTE.enemyRed,
    emissive: PALETTE.enemyRedEmissive,
    emissiveIntensity: 0.45,
    roughness: 0.18,
    metalness: 0.0,
  });

  /** Enemy shard — same look, used for the shatter cloud. */
  readonly enemyShard = new MeshStandardMaterial({
    color: PALETTE.enemyRed,
    emissive: PALETTE.enemyRedEmissive,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.0,
    transparent: true,
    opacity: 1,
  });

  /** Breakable glass — translucent, faintly blue. */
  readonly glass = new MeshStandardMaterial({
    color: PALETTE.glass,
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.18,
    side: DoubleSide,
  });

  readonly glassShard = new MeshStandardMaterial({
    color: PALETTE.glass,
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.5,
    side: DoubleSide,
  });

  /** Bullet core — dark, unlit so it reads against any background. */
  readonly bullet = new MeshBasicMaterial({ color: PALETTE.bulletCore });

  /** Player-body crystal (used when the player is hotswitched/destroyed). */
  readonly playerCrystal = new MeshStandardMaterial({
    color: new Color(0x101014),
    roughness: 0.3,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9,
  });

  /** Returns the appropriate environment material for a collider kind. */
  envFor(kind?: 'wall' | 'cover' | 'pillar'): MeshStandardMaterial {
    switch (kind) {
      case 'cover':
        return this.envGrey;
      case 'pillar':
        return this.envDarkGrey;
      default:
        return this.envLight;
    }
  }
}

export const Materials = new MaterialLibrary();
