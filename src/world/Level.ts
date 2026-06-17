import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  type Object3D,
  PlaneGeometry,
  Vector3,
} from 'three';
import type { LevelDef, WeaponKind } from '@/types';
import { Materials } from '@/fx/Materials';
import { buildThrowableModel, buildWeaponModel } from '@/fx/Models';
import { Navigation } from '@/ai/Navigation';
import { type Bounds, resolveCylinder } from './Collision';
import { ENEMY_RADIUS, PLAYER_GRAVITY } from '@/config/constants';

export interface GlassPane {
  box: Box3;
  mesh: Mesh;
  alive: boolean;
}

export interface GroundItem {
  id: number;
  type: 'weapon' | 'throwable';
  kind: WeaponKind | null;
  /** Carried ammo for a dropped firearm; undefined = full magazine on pickup. */
  ammo?: number;
  radius: number;
  object: Object3D;
  pos: Vector3;
  vel: Vector3;
  settled: boolean;
  spin: number;
}

/**
 * A single white-box arena: static geometry, breakable glass, weapon & throwable
 * pickups, and a baked navigation grid. Owns all of its meshes under one root so
 * teardown is a single removal.
 */
export class Level {
  readonly def: LevelDef;
  readonly bounds: Bounds;
  readonly floorY: number;

  /** Permanent solid colliders (walls, cover, pillars). */
  readonly solids: Box3[] = [];
  readonly glass: GlassPane[] = [];
  readonly items: GroundItem[] = [];
  nav!: Navigation;

  private root = new Group();
  private scene: import('three').Scene | null = null;
  private nextItemId = 1;

  constructor(def: LevelDef) {
    this.def = def;
    this.bounds = def.bounds;
    this.floorY = def.floorY;
  }

  build(scene: import('three').Scene): void {
    this.scene = scene;

    // Floor.
    const floorGeo = new PlaneGeometry(
      this.bounds.maxX - this.bounds.minX + 8,
      this.bounds.maxZ - this.bounds.minZ + 8,
    );
    const floor = new Mesh(floorGeo, Materials.envWhite);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(
      (this.bounds.minX + this.bounds.maxX) / 2,
      this.floorY,
      (this.bounds.minZ + this.bounds.maxZ) / 2,
    );
    floor.receiveShadow = true;
    this.root.add(floor);

    // Solid geometry.
    for (const c of this.def.colliders) {
      const geo = new BoxGeometry(c.size[0], c.size[1], c.size[2]);
      const mesh = new Mesh(geo, Materials.envFor(c.kind));
      mesh.position.set(c.pos[0], c.pos[1], c.pos[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      const box = new Box3().setFromCenterAndSize(
        new Vector3(c.pos[0], c.pos[1], c.pos[2]),
        new Vector3(c.size[0], c.size[1], c.size[2]),
      );
      this.solids.push(box);
    }

    // Breakable glass.
    for (const gp of this.def.glass) {
      const geo = new BoxGeometry(gp.size[0], gp.size[1], gp.size[2]);
      const mesh = new Mesh(geo, Materials.glass);
      mesh.position.set(gp.pos[0], gp.pos[1], gp.pos[2]);
      this.root.add(mesh);
      const box = new Box3().setFromCenterAndSize(
        new Vector3(gp.pos[0], gp.pos[1], gp.pos[2]),
        new Vector3(gp.size[0], gp.size[1], gp.size[2]),
      );
      this.glass.push({ box, mesh, alive: true });
    }

    // Weapon pickups.
    for (const w of this.def.weapons) {
      this.spawnWeaponPickup(w.kind, new Vector3(w.pos[0], w.pos[1], w.pos[2]));
    }

    // Throwables.
    for (const t of this.def.throwables) {
      this.spawnThrowable(
        new Vector3(t.pos[0], t.pos[1], t.pos[2]),
        t.radius ?? 0.12,
      );
    }

    scene.add(this.root);

    // Bake navigation against permanent solids only (glass / pickups don't block paths).
    this.nav = new Navigation(this.bounds, this.solids, ENEMY_RADIUS);
  }

  /** Solids plus any still-intact glass — used for actor movement. */
  movementColliders(): Box3[] {
    const out = this.solids.slice();
    for (const g of this.glass) if (g.alive) out.push(g.box);
    return out;
  }

  resolveActor(pos: Vector3, radius: number, height: number): void {
    resolveCylinder(pos, radius, height, this.movementColliders(), this.bounds);
  }

  // ---- pickups ----------------------------------------------------------

  spawnWeaponPickup(kind: WeaponKind, pos: Vector3, vel?: Vector3, ammo?: number): GroundItem {
    const object = buildWeaponModel(kind);
    object.position.copy(pos);
    this.root.add(object);
    const item: GroundItem = {
      id: this.nextItemId++,
      type: 'weapon',
      kind,
      ammo,
      radius: 0.4,
      object,
      pos: pos.clone(),
      vel: vel ? vel.clone() : new Vector3(),
      settled: !vel,
      spin: 0,
    };
    this.items.push(item);
    return item;
  }

  spawnThrowable(pos: Vector3, radius: number, vel?: Vector3): GroundItem {
    const object = buildThrowableModel(radius);
    object.position.copy(pos);
    this.root.add(object);
    const item: GroundItem = {
      id: this.nextItemId++,
      type: 'throwable',
      kind: null,
      radius,
      object,
      pos: pos.clone(),
      vel: vel ? vel.clone() : new Vector3(),
      settled: !vel,
      spin: 0,
    };
    this.items.push(item);
    return item;
  }

  removeItem(item: GroundItem): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    this.root.remove(item.object);
  }

  /** Nearest pickup within range of a point (XZ-biased). */
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

  // ---- glass ------------------------------------------------------------

  breakGlass(index: number): void {
    const g = this.glass[index];
    if (!g || !g.alive) return;
    g.alive = false;
    this.root.remove(g.mesh);
  }

  glassIndexOf(pane: GlassPane): number {
    return this.glass.indexOf(pane);
  }

  // ---- per-frame --------------------------------------------------------

  update(scaledDt: number): void {
    for (const item of this.items) {
      if (!item.settled) {
        // Dropped / thrown pickups fall under world-time gravity until they land.
        item.vel.y -= PLAYER_GRAVITY * scaledDt;
        item.pos.addScaledVector(item.vel, scaledDt);
        const restY = this.floorY + item.radius * 0.5;
        if (item.pos.y <= restY) {
          item.pos.y = restY;
          item.vel.set(0, 0, 0);
          item.settled = true;
        }
        // Keep inside the arena.
        item.pos.x = Math.max(this.bounds.minX + 0.2, Math.min(this.bounds.maxX - 0.2, item.pos.x));
        item.pos.z = Math.max(this.bounds.minZ + 0.2, Math.min(this.bounds.maxZ - 0.2, item.pos.z));
        item.object.position.copy(item.pos);
      } else {
        // Gentle idle spin so pickups read as interactive.
        item.spin += scaledDt * 0.8;
        item.object.rotation.y = item.spin;
        item.object.position.y =
          item.pos.y + Math.sin(item.spin * 1.5) * 0.03;
      }
    }
  }

  dispose(): void {
    if (this.scene) this.scene.remove(this.root);
    this.root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.root.clear();
    this.solids.length = 0;
    this.glass.length = 0;
    this.items.length = 0;
  }
}
