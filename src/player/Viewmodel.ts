import { Group, type Object3D } from 'three';
import type { WeaponKind } from '@/types';
import { buildFistModel, buildThrowableModel, buildWeaponModel } from '@/fx/Models';

export type HeldKind = WeaponKind | 'orb';

/** Everything needed to draw the first-person hands for one frame. */
export interface ViewState {
  held: HeldKind;
  orbRadius: number;
  /** 0 = idle; (0,1] = progress through a swing. */
  swing: number;
  /** Alternates each punch so jabs come from both sides. */
  swingSide: number;
  /** Weapon kick, decays to 0. */
  recoil: number;
  /** 1 → 0 just after picking something up (it rises into view). */
  draw: number;
  /** Look-lag offsets (radians), so the weapon trails the camera slightly. */
  swayX: number;
  swayY: number;
  /** Stride phase & amount for a faint walk bob. */
  bob: number;
  bobAmount: number;
}

export function idleViewState(): ViewState {
  return { held: 'fist', orbRadius: 0.13, swing: 0, swingSide: 1, recoil: 0, draw: 0, swayX: 0, swayY: 0, bob: 0, bobAmount: 0 };
}

const REST: Record<string, [number, number, number]> = {
  pistol: [0.23, -0.2, -0.5],
  rifle: [0.2, -0.21, -0.44],
  shotgun: [0.2, -0.2, -0.42],
  nailgun: [0.22, -0.19, -0.48],
  bat: [0.27, -0.3, -0.42],
  katana: [0.27, -0.33, -0.4],
  orb: [0.26, -0.24, -0.5],
  fist: [0.26, -0.3, -0.42],
};

const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * First-person hands. Purely a function of `ViewState`, so the replay's
 * first-person shots show exactly the same motion as live play.
 */
export class Viewmodel {
  readonly group = new Group();
  private model: Object3D | null = null;
  private readonly fist = buildFistModel();
  private current: HeldKind | null = null;
  private currentRadius = 0;

  constructor() {
    this.fist.visible = false;
    this.group.add(this.fist);
  }

  apply(s: ViewState): void {
    if (s.held !== this.current || (s.held === 'orb' && s.orbRadius !== this.currentRadius)) {
      if (this.model) this.group.remove(this.model);
      this.model = null;
      if (s.held === 'orb') this.model = buildThrowableModel(s.orbRadius);
      else if (s.held !== 'fist') this.model = buildWeaponModel(s.held);
      if (this.model) {
        this.model.traverse((o) => {
          o.castShadow = false;
        });
        this.group.add(this.model);
      }
      this.current = s.held;
      this.currentRadius = s.orbRadius;
    }

    const rest = REST[s.held] ?? REST.fist;
    const bobX = Math.sin(s.bob) * 0.006 * s.bobAmount;
    const bobY = -Math.abs(Math.cos(s.bob)) * 0.008 * s.bobAmount;
    const drawDrop = s.draw * s.draw * 0.28;

    this.group.rotation.set(s.swayY * 0.6, s.swayX * 0.6, 0);
    this.group.position.set(-s.swayX * 0.05, s.swayY * 0.05, 0);

    const t = s.swing;
    const arc = t > 0 ? Math.sin(Math.min(1, t) * Math.PI) : 0;

    // Bare hands: only visible while punching.
    this.fist.visible = s.held === 'fist' && t > 0;
    if (this.fist.visible) {
      this.fist.position.set(s.swingSide * 0.2, -0.2 + arc * 0.05, -0.32 - arc * 0.42);
      this.fist.rotation.set(arc * 0.15, -s.swingSide * 0.25 * (1 - arc), 0);
    }

    const m = this.model;
    if (!m) return;
    m.position.set(rest[0] + bobX, rest[1] + bobY - drawDrop, rest[2] + s.recoil * 0.09);
    m.rotation.set(s.recoil * 0.5 + s.draw * 0.5, 0.04, 0);

    if (s.held === 'katana') {
      // Rest: blade raised across the body. Swing: a diagonal cut, right-high to left-low.
      const k = t > 0 ? ease(Math.min(1, t)) : 0;
      m.rotation.set(0.95 - k * 2.0 + arc * 0.2, 0.35 + k * 1.3, -0.35 + k * 1.5);
      m.position.x += -k * 0.42;
      m.position.y += arc * 0.12 - k * 0.1 + 0.1;
      m.position.z += -arc * 0.12;
    } else if (s.held === 'bat') {
      const k = t > 0 ? ease(Math.min(1, t)) : 0;
      m.rotation.set(0.9 - arc * 0.5, 0.9 - k * 2.3, -0.2 + k * 0.5);
      m.position.x += 0.06 - k * 0.5;
      m.position.y += 0.1 + arc * 0.08;
      m.position.z += -arc * 0.18;
    } else if (t > 0) {
      // Pistol-whip / shove with whatever is in hand.
      m.position.z += -arc * 0.3;
      m.rotation.x += -arc * 0.9;
    }
  }
}
