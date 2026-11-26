import { Box3, BoxGeometry, Group, Mesh, type Object3D, PlaneGeometry, type Scene, type ShaderMaterial, Vector3 } from 'three';
import type { LevelDef, WeaponKind } from '@/types';
import type { TimeController } from '@/core/Time';
import { buildThrowableModel, buildWeaponModel } from '@/fx/Models';
import { type EnvTone, FieldVisual, envMaterial, makeGlassMaterial } from '@/fx/Env';
import { Navigation } from '@/ai/Navigation';
import { type Bounds, rayDistance, resolveCylinder, segmentVsSphere, supportHeight } from './Collision';
import { ENEMY_RADIUS, GRAVITY, RUSH_FIELD_FLOOR, STILL_FIELD_FACTOR } from '@/config/constants';

export interface GlassPane {
  box: Box3;
  mesh: Mesh;
  alive: boolean;
  center: Vector3;
  size: Vector3;
}

export interface GroundItem {
  id: number;
  type: 'weapon' | 'throwable';
  kind: WeaponKind | null;
  /** Rounds left in a dropped firearm; undefined = full magazine. */
  ammo?: number;
  radius: number;
  object: Object3D;
  pos: Vector3;
  vel: Vector3;
  /** False while flying / falling — an airborne item can be caught. */
  settled: boolean;
  spin: number;
  tumble: Vector3;
}

export interface TimeField {
  pos: Vector3;
  radius: number;
  kind: 'still' | 'rush';
}

const TONE_FOR: Record<string, EnvTone> = { wall: 'light', cover: 'grey', pillar: 'dark', plinth: 'white' };

/**
 * A single plate: static white-box architecture, breakable glass, pickups, time
 * fields and a baked navigation grid. Owns all of its meshes under one root so
 * teardown is a single removal.
 */
export class Level {
  readonly def: LevelDef;
  readonly bounds: Bounds;
  readonly floorY: number;

  /** Permanent solid colliders. */
  readonly solids: Box3[] = [];
  readonly glass: GlassPane[] = [];
  readonly items: GroundItem[] = [];
  readonly fields: TimeField[] = [];
  nav!: Navigation;

  private readonly root = new Group();
  private readonly fieldVisuals: FieldVisual[] = [];
  private glassMaterial: ShaderMaterial | null = null;
  private moveBoxes: Box3[] = [];
  private nextItemId = 1;

  constructor(def: LevelDef) {
    this.def = def;
    this.bounds = def.bounds;
    this.floorY = def.floorY;
  }

  build(scene: Scene): void {
    const b = this.bounds;

    // Floor — extends well past the walls so the horizon is never an edge.
    const floor = new Mesh(new PlaneGeometry(b.maxX - b.minX + 60, b.maxZ - b.minZ + 60), envMaterial('white', true));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((b.minX + b.maxX) / 2, this.floorY, (b.minZ + b.maxZ) / 2);
    floor.receiveShadow = true;
    this.root.add(floor);

    for (const c of this.def.colliders) {
      const mesh = new Mesh(new BoxGeometry(c.size[0], c.size[1], c.size[2]), envMaterial(TONE_FOR[c.kind ?? 'wall']));
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.solids.push(new Box3().setFromCenterAndSize(new Vector3(...c.pos), new Vector3(...c.size)));
    }

    for (const d of this.def.decor ?? []) {
      const mesh = new Mesh(new BoxGeometry(d.size[0], d.size[1], d.size[2]), envMaterial(d.tone ?? 'light'));
      mesh.position.set(d.pos[0], d.pos[1], d.pos[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }

    if (this.def.glass.length > 0) this.glassMaterial = makeGlassMaterial();
    for (const gp of this.def.glass) {
      const mesh = new Mesh(new BoxGeometry(gp.size[0], gp.size[1], gp.size[2]), this.glassMaterial!);
      mesh.position.set(gp.pos[0], gp.pos[1], gp.pos[2]);
      mesh.renderOrder = 4;
      this.root.add(mesh);
      const center = new Vector3(...gp.pos);
      const size = new Vector3(...gp.size);
      this.glass.push({ box: new Box3().setFromCenterAndSize(center, size), mesh, alive: true, center, size });
    }

    for (const w of this.def.weapons) this.spawnWeaponPickup(w.kind, new Vector3(...w.pos));
    for (const t of this.def.throwables) this.spawnThrowable(new Vector3(...t.pos), t.radius ?? 0.13);

    for (const f of this.def.fields ?? []) {
      const pos = new Vector3(...f.pos);
      this.fields.push({ pos, radius: f.radius, kind: f.kind });
      const visual = new FieldVisual(f.kind, f.radius, this.floorY, pos.y);
      visual.group.position.copy(pos);
      this.root.add(visual.group);
      this.fieldVisuals.push(visual);
    }

    scene.add(this.root);
    this.rebuildMoveBoxes();
    // Navigation is baked against permanent solids only.
    this.nav = new Navigation(this.bounds, this.solids, ENEMY_RADIUS);
  }

  // ---- collision --------------------------------------------------------

  private rebuildMoveBoxes(): void {
    this.moveBoxes = this.solids.slice();
    for (const g of this.glass) if (g.alive) this.moveBoxes.push(g.box);
  }

  /** Push a vertical cylinder out of walls and intact glass, and keep it in bounds. */
  resolveActor(pos: Vector3, radius: number, height: number): void {
    resolveCylinder(pos, radius, height, this.moveBoxes, this.bounds);
  }

  /** Highest surface under (x,z) that feet at `feetY` could be standing on. */
  groundHeight(x: number, z: number, feetY: number, margin = 0.12): number {
    return supportHeight(x, z, feetY, margin, this.solids, this.floorY);
  }

  /** Distance a ray travels before hitting solid architecture. */
  rayToSolid(origin: Vector3, dir: Vector3, maxDist: number): number {
    return rayDistance(origin, dir, this.solids, maxDist);
  }

  // ---- time fields ------------------------------------------------------

  fieldAt(pos: Vector3): TimeField | null {
    for (const f of this.fields) {
      if (f.pos.distanceToSquared(pos) < f.radius * f.radius) return f;
    }
    return null;
  }

  /** World delta experienced by something at `pos` this frame. */
  localDt(pos: Vector3, time: TimeController): number {
    if (this.fields.length === 0) return time.scaledDt;
    const f = this.fieldAt(pos);
    if (!f) return time.scaledDt;
    if (f.kind === 'still') return time.scaledDt * STILL_FIELD_FACTOR;
    // Rush: time will not wait — unless the whole world has been stopped.
    return time.borrowPhase === 'borrowing' ? 0 : Math.max(time.scaledDt, time.unscaledDt * RUSH_FIELD_FLOOR);
  }

  // ---- pickups ----------------------------------------------------------

  spawnWeaponPickup(kind: WeaponKind, pos: Vector3, vel?: Vector3, ammo?: number): GroundItem {
    const object = buildWeaponModel(kind);
    return this.addItem('weapon', kind, 0.34, object, pos, vel, ammo);
  }

  spawnThrowable(pos: Vector3, radius: number, vel?: Vector3): GroundItem {
    return this.addItem('throwable', null, radius, buildThrowableModel(radius), pos, vel);
  }

  private addItem(
    type: 'weapon' | 'throwable',
    kind: WeaponKind | null,
    radius: number,
    object: Object3D,
    pos: Vector3,
    vel?: Vector3,
    ammo?: number,
  ): GroundItem {
    object.position.copy(pos);
    this.root.add(object);
    const id = this.nextItemId++;
    const item: GroundItem = {
      id,
      type,
      kind,
      ammo,
      radius,
      object,
      pos: pos.clone(),
      vel: vel ? vel.clone() : new Vector3(),
      settled: !vel,
      spin: id * 1.7,
      tumble: new Vector3(((id * 37) % 11) - 5, ((id * 53) % 7) - 3, ((id * 29) % 9) - 4),
    };
    this.items.push(item);
    return item;
  }

  removeItem(item: GroundItem): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    this.root.remove(item.object);
  }

  /** Nearest pickup within `range` of a point. */
  nearestItem(pos: Vector3, range: number): GroundItem | null {
    let best: GroundItem | null = null;
    let bestD = range * range;
    for (const item of this.items) {
      const d = item.pos.distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = item;
      }
    }
    return best;
  }

  /** The pickup under the crosshair within `reach` (generous sphere test). */
  aimedItem(origin: Vector3, dir: Vector3, reach: number): GroundItem | null {
    let best: GroundItem | null = null;
    let bestT = reach;
    for (const item of this.items) {
      const t = segmentVsSphere(origin, dir, reach, item.pos, item.settled ? 0.36 : 0.55);
      if (t !== null && t < bestT) {
        bestT = t;
        best = item;
      }
    }
    return best;
  }

  // ---- glass ------------------------------------------------------------

  breakGlass(index: number): void {
    const g = this.glass[index];
    if (!g || !g.alive) return;
    g.alive = false;
    g.mesh.visible = false;
    this.rebuildMoveBoxes();
  }

  /** Replay support: show / hide panes without touching collision. */
  setGlassVisible(index: number, visible: boolean): void {
    const g = this.glass[index];
    if (g) g.mesh.visible = visible;
  }

  setItemsVisible(visible: boolean): void {
    for (const item of this.items) item.object.visible = visible;
  }

  // ---- per-frame --------------------------------------------------------

  update(time: TimeController): void {
    for (const item of this.items) {
      const dt = this.localDt(item.pos, time);
      if (!item.settled) {
        item.vel.y -= GRAVITY * dt;
        item.pos.addScaledVector(item.vel, dt);
        // Walls stop it dead (it then drops straight down).
        const bx = item.pos.x;
        const bz = item.pos.z;
        resolveCylinder(item.pos, 0.12, 0.2, this.solids, this.bounds);
        if (item.pos.x !== bx) item.vel.x *= -0.25;
        if (item.pos.z !== bz) item.vel.z *= -0.25;

        const rest = this.groundHeight(item.pos.x, item.pos.z, item.pos.y + 0.2, 0) + item.radius * 0.5;
        if (item.pos.y <= rest && item.vel.y <= 0) {
          item.pos.y = rest;
          if (item.vel.y < -3.2) {
            item.vel.y *= -0.28;
            item.vel.x *= 0.45;
            item.vel.z *= 0.45;
          } else {
            item.vel.set(0, 0, 0);
            item.settled = true;
            item.object.rotation.set(0, item.spin, 0);
          }
        }
        item.object.position.copy(item.pos);
        if (!item.settled) {
          item.object.rotation.x += item.tumble.x * dt;
          item.object.rotation.y += item.tumble.y * dt;
          item.object.rotation.z += item.tumble.z * dt;
        }
      } else {
        // A slow turn so pickups read as available.
        item.spin += dt * 0.8;
        item.object.rotation.y = item.spin;
        item.object.position.y = item.pos.y + Math.sin(item.spin * 1.5) * 0.025;
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const v of this.fieldVisuals) v.dispose();
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      // Pickup models share prototype geometry; only level-built boxes are ours.
      if (mesh.isMesh && (mesh.geometry instanceof BoxGeometry || mesh.geometry instanceof PlaneGeometry)) {
        if (mesh.parent === this.root) mesh.geometry.dispose();
      }
    });
    this.glassMaterial?.dispose();
    this.root.clear();
    this.solids.length = 0;
    this.glass.length = 0;
    this.items.length = 0;
    this.fields.length = 0;
  }
}
