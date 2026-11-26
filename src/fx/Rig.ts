import { Group, Mesh, type BufferGeometry, type ShaderMaterial } from 'three';
import type { EnemyKind, WeaponKind } from '@/types';
import { type Poly, boxPoly, lathe, polyGeometry } from './Poly';
import { type Piece, registerPart } from './Shards';
import { buildWeaponModel } from './Models';
import { lerp } from '@/core/math';

/**
 * The articulated crystalline figure used for every humanoid: the reds, their
 * variants, and the player's own body in the replay.
 *
 * A figure is fully described by a `FigurePose` — a handful of numbers. The
 * live AI writes a pose every frame; the replay stores those numbers and feeds
 * them back, so a recorded figure is posed by exactly the same code that posed
 * it during play. At 1/200th speed every frame of this is on show, so limbs are
 * driven by distance travelled (never by wall-clock), and the aim, wind-up and
 * stagger poses are all continuous.
 */
export interface FigurePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Walk-cycle phase in radians (advances with distance covered). */
  walk: number;
  /** 0 = standing, 1 = full stride. */
  move: number;
  /** 0 = weapon lowered, 1 = levelled at the target. */
  aim: number;
  /** Elevation of the aim, radians (positive = up). */
  aimPitch: number;
  /** Melee: 0..1 = wind-up, 1..2 = strike and follow-through. */
  strike: number;
  /** 0..1 knocked off balance. */
  stagger: number;
  /** Weapon kick, decays to 0. */
  recoil: number;
  /** Free-running phase for the Constant's halo (radians). */
  clock: number;
  /** 0..1 materialisation. */
  develop: number;
  /** 0..1 white flash (hit feedback). */
  flash: number;
}

export function neutralPose(): FigurePose {
  return { x: 0, y: 0, z: 0, yaw: 0, walk: 0, move: 0, aim: 0, aimPitch: 0, strike: 0, stagger: 0, recoil: 0, clock: 0, develop: 1, flash: 0 };
}

export type FigureKind = EnemyKind | 'player';

// ---------------------------------------------------------------------------
// Part library — each part is a convex polyhedron authored around its joint.
// ---------------------------------------------------------------------------

interface PartSpec {
  poly: () => Poly;
  cells: number;
}

const PART_SPECS: Record<string, PartSpec> = {
  pelvis: { poly: () => lathe(6, [[-0.1, 0.13], [0.0, 0.17], [0.09, 0.15]], 1, 0.7, Math.PI / 6), cells: 6 },
  torso: { poly: () => lathe(6, [[0.02, 0.14], [0.3, 0.235], [0.46, 0.2], [0.5, 0.12]], 1, 0.62, Math.PI / 6), cells: 14 },
  torsoHeavy: { poly: () => lathe(6, [[0.02, 0.18], [0.3, 0.3], [0.46, 0.27], [0.52, 0.15]], 1, 0.7, Math.PI / 6), cells: 16 },
  head: { poly: () => lathe(5, [[0.03, 0.05], [0.12, 0.125], [0.22, 0.11], [0.3, 0.0]], 1, 1, 0.3), cells: 8 },
  spike: { poly: () => lathe(4, [[0.03, 0.05], [0.11, 0.115], [0.46, 0.0]], 1, 1, Math.PI / 4), cells: 8 },
  upperArm: { poly: () => lathe(5, [[-0.3, 0.045], [-0.14, 0.06], [0.0, 0.055]]), cells: 4 },
  foreArm: { poly: () => lathe(5, [[-0.3, 0.025], [-0.16, 0.05], [0.0, 0.045]]), cells: 4 },
  thigh: { poly: () => lathe(5, [[-0.42, 0.06], [-0.2, 0.085], [0.0, 0.08]]), cells: 5 },
  shin: { poly: () => lathe(5, [[-0.46, 0.02], [-0.4, 0.045], [-0.2, 0.065], [0.0, 0.06]]), cells: 5 },
  bar: { poly: () => boxPoly(0.12, 0.022, 0.022), cells: 2 },
  slab: { poly: () => boxPoly(0.86, 1.2, 0.05), cells: 22 },
  orb: { poly: () => lathe(7, [[-1, 0], [-0.62, 0.78], [0, 1], [0.62, 0.78], [1, 0]]), cells: 12 },
  block: { poly: () => boxPoly(1, 1, 1), cells: 9 },
};

const geoCache = new Map<string, BufferGeometry>();

function partGeometry(id: string): BufferGeometry {
  let g = geoCache.get(id);
  if (!g) {
    const poly = PART_SPECS[id].poly();
    g = polyGeometry(poly);
    geoCache.set(id, g);
  }
  return g;
}

/** Register every part with the shard system (call once at boot). */
export function registerFigureParts(): void {
  for (const id of Object.keys(PART_SPECS)) registerPart(id, PART_SPECS[id].poly(), PART_SPECS[id].cells);
}

const HIP_Y = 0.9;
const HALO_BARS = 8;

export class FigureRig {
  readonly root = new Group();
  readonly kind: FigureKind;
  readonly material: ShaderMaterial;
  weaponKind: WeaponKind | null = null;

  private readonly pelvis = new Group();
  private readonly torso = new Group();
  private readonly head = new Group();
  private readonly shoulderL = new Group();
  private readonly shoulderR = new Group();
  private readonly elbowL = new Group();
  private readonly elbowR = new Group();
  private readonly hipL = new Group();
  private readonly hipR = new Group();
  private readonly kneeL = new Group();
  private readonly kneeR = new Group();
  private readonly hand = new Group();
  private readonly halo = new Group();
  private readonly shield = new Group();
  private weaponModel: Group | null = null;
  private readonly parts: Array<{ id: string; mesh: Mesh }> = [];
  private readonly shieldMaterial: ShaderMaterial | null;

  constructor(kind: FigureKind, material: ShaderMaterial, shieldMaterial?: ShaderMaterial) {
    this.kind = kind;
    this.material = material;
    this.shieldMaterial = shieldMaterial ?? null;
    const heavy = kind === 'bulwark';

    this.root.add(this.pelvis);
    this.pelvis.position.y = HIP_Y;
    this.addPart(this.pelvis, 'pelvis');

    this.torso.position.y = 0.1;
    this.pelvis.add(this.torso);
    this.addPart(this.torso, heavy ? 'torsoHeavy' : 'torso');

    this.head.position.y = heavy ? 0.55 : 0.53;
    this.torso.add(this.head);
    this.addPart(this.head, kind === 'constant' ? 'spike' : 'head');

    const sx = heavy ? 0.34 : 0.275;
    for (const side of [-1, 1] as const) {
      const shoulder = side < 0 ? this.shoulderL : this.shoulderR;
      const elbow = side < 0 ? this.elbowL : this.elbowR;
      shoulder.position.set(side * sx, 0.42, 0);
      this.torso.add(shoulder);
      this.addPart(shoulder, 'upperArm');
      elbow.position.y = -0.31;
      shoulder.add(elbow);
      this.addPart(elbow, 'foreArm');

      const hip = side < 0 ? this.hipL : this.hipR;
      const knee = side < 0 ? this.kneeL : this.kneeR;
      hip.position.set(side * 0.105, -0.04, 0);
      this.pelvis.add(hip);
      this.addPart(hip, 'thigh');
      knee.position.y = -0.43;
      hip.add(knee);
      this.addPart(knee, 'shin');
    }

    // Weapons are modelled barrel-down-(-Z); the forearm points down -Y.
    this.hand.position.set(0, -0.3, 0);
    this.hand.rotation.x = -Math.PI / 2;
    this.elbowR.add(this.hand);

    if (kind === 'constant') {
      // A ring of bars that turns at a steady rate no matter what time is doing.
      this.halo.position.y = 0.2;
      this.head.add(this.halo);
      for (let i = 0; i < HALO_BARS; i++) {
        const holder = new Group();
        holder.rotation.y = (i / HALO_BARS) * Math.PI * 2;
        const mesh = new Mesh(partGeometry('bar'), material);
        mesh.position.set(0, 0, 0.27);
        mesh.castShadow = true;
        holder.add(mesh);
        this.halo.add(holder);
        this.parts.push({ id: 'bar', mesh });
      }
    }

    if (heavy && shieldMaterial) {
      this.shield.position.set(-0.04, 0.12, -0.46);
      this.torso.add(this.shield);
      const mesh = new Mesh(partGeometry('slab'), shieldMaterial);
      mesh.castShadow = true;
      this.shield.add(mesh);
      this.parts.push({ id: 'slab', mesh });
    }
  }

  private addPart(parent: Group, id: string): void {
    const mesh = new Mesh(partGeometry(id), this.material);
    mesh.castShadow = true;
    parent.add(mesh);
    this.parts.push({ id, mesh });
  }

  setWeapon(kind: WeaponKind | null): void {
    if (kind === this.weaponKind) return;
    this.weaponKind = kind;
    if (this.weaponModel) {
      this.hand.remove(this.weaponModel);
      this.weaponModel = null;
    }
    if (kind && kind !== 'fist') {
      this.weaponModel = buildWeaponModel(kind);
      this.weaponModel.scale.setScalar(0.95);
      this.hand.add(this.weaponModel);
    }
  }

  /** Drop the shield (bulwark only) — it has been broken or knocked away. */
  setShieldVisible(on: boolean): void {
    this.shield.visible = on;
  }

  applyPose(p: FigurePose): void {
    const armed = this.weaponKind !== null && this.weaponKind !== 'fist';
    const twoHanded = this.weaponKind === 'rifle' || this.weaponKind === 'shotgun';
    const heavy = this.kind === 'bulwark';
    const m = p.move;
    const s = Math.sin(p.walk);
    const c = Math.cos(p.walk);
    const stag = p.stagger;

    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;

    // Pelvis: stride bob, slight crouch when running.
    this.pelvis.position.y = HIP_Y - m * 0.035 + Math.abs(c) * 0.03 * m - stag * 0.05;
    this.pelvis.rotation.x = stag * 0.12;

    // Legs.
    this.hipL.rotation.x = s * 0.62 * m - stag * 0.25;
    this.hipR.rotation.x = -s * 0.62 * m + stag * 0.15;
    this.kneeL.rotation.x = -(0.08 + 0.95 * Math.max(0, c)) * m - stag * 0.3;
    this.kneeR.rotation.x = -(0.08 + 0.95 * Math.max(0, -c)) * m - stag * 0.1;

    // Strike phases.
    const wind = Math.min(p.strike, 1);
    const hit = Math.max(p.strike - 1, 0);

    // Torso: lean into a run, twist with the stride, rock back when hit.
    const lean = -(armed ? 0.07 : 0.2) * m + stag * 0.42 - hit * 0.25 + wind * 0.08;
    this.torso.rotation.x = lean;
    this.torso.rotation.y = s * 0.13 * m + wind * 0.45 - hit * 0.85 + (twoHanded ? p.aim * 0.28 : 0);
    this.torso.rotation.z = stag * 0.1;
    this.head.rotation.x = -lean * 0.8 - stag * 0.35;
    this.head.rotation.y = -this.torso.rotation.y * 0.8;

    // Left arm: counter-swing; supports a long gun; braces the slab.
    let lx = -s * 0.55 * m;
    let lz = 0.06 + stag * 0.95;
    let le = 0.25 + 0.55 * m;
    if (twoHanded) {
      lx = lerp(lx, 1.15 + p.aimPitch, p.aim);
      lz = lerp(lz, -0.62, p.aim);
      le = lerp(le, 0.5, p.aim);
    }
    if (heavy) {
      lx = lerp(1.1, 0.2, stag);
      lz = -0.5;
      le = 0.7;
    }
    this.shoulderL.rotation.set(lx, 0, -lz);
    this.elbowL.rotation.x = le;

    // Right arm: swing ↔ aim ↔ strike.
    const swing = s * 0.55 * m;
    let rx = lerp(swing, Math.PI / 2 + p.aimPitch + p.recoil * 0.4, p.aim);
    rx = lerp(rx, 2.75, wind) - hit * 2.2;
    const re = lerp(lerp(0.25 + 0.55 * m, 0.06, p.aim), 0.9, wind) - hit * 0.7;
    this.shoulderR.rotation.set(rx, 0, 0.06 + stag * 0.9 + (twoHanded ? p.aim * 0.2 : 0));
    this.elbowR.rotation.x = Math.max(0, re);

    if (this.kind === 'constant') this.halo.rotation.y = p.clock;
    if (heavy) {
      this.shield.rotation.y = stag * 1.25;
      this.shield.position.x = -0.04 - stag * 0.35;
    }

    this.material.uniforms.uDevelop.value = p.develop;
    this.material.uniforms.uFlash.value = p.flash;
  }

  /** World matrices of every part — the input to a shatter. */
  pieces(includeShield = true): Piece[] {
    this.root.updateWorldMatrix(true, true);
    const out: Piece[] = [];
    for (const part of this.parts) {
      if (part.id === 'slab' && (!includeShield || !this.shield.visible)) continue;
      out.push({ part: part.id, m: part.mesh.matrixWorld.toArray() });
    }
    return out;
  }

  /** Just the slab (for when a shield breaks on its own). */
  shieldPieces(): Piece[] {
    this.root.updateWorldMatrix(true, true);
    return this.parts.filter((p) => p.id === 'slab').map((p) => ({ part: p.id, m: p.mesh.matrixWorld.toArray() }));
  }

  /** World-space muzzle / hand position. */
  handWorld(out: { x: number; y: number; z: number }): void {
    this.root.updateWorldMatrix(true, true);
    const e = this.hand.matrixWorld.elements;
    out.x = e[12];
    out.y = e[13];
    out.z = e[14];
  }

  dispose(): void {
    this.root.removeFromParent();
    this.material.dispose();
    this.shieldMaterial?.dispose();
  }
}
