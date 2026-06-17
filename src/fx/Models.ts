import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  type Object3D,
  SphereGeometry,
} from 'three';
import type { WeaponKind } from '@/types';
import { Materials } from './Materials';

/**
 * Procedural low-poly models built from primitives. Interactive objects are
 * absolute black (Materials.interactive); hostile entities are glossy red
 * (Materials.enemy). No textures anywhere — the silhouette carries all meaning.
 */

function box(w: number, h: number, d: number, mat = Materials.interactive): Mesh {
  return new Mesh(new BoxGeometry(w, h, d), mat);
}

/**
 * Dispose every BufferGeometry under a model before discarding it. Materials are
 * shared singletons (Materials.*) and must NOT be disposed here. Cloned meshes
 * share geometry references, so a double-dispose is harmless in three.js.
 */
export function disposeModelGeometry(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}

/** A held/pickup weapon. Origin at the grip; barrel points down -Z. */
export function buildWeaponModel(kind: WeaponKind): Group {
  const g = new Group();
  switch (kind) {
    case 'pistol': {
      const body = box(0.07, 0.11, 0.22);
      body.position.set(0, 0.02, -0.06);
      const grip = box(0.06, 0.13, 0.08);
      grip.position.set(0, -0.07, 0.04);
      grip.rotation.x = 0.25;
      g.add(body, grip);
      break;
    }
    case 'rifle': {
      const body = box(0.07, 0.1, 0.62);
      body.position.set(0, 0.0, -0.18);
      const stock = box(0.06, 0.11, 0.18);
      stock.position.set(0, -0.01, 0.18);
      const mag = box(0.05, 0.16, 0.08);
      mag.position.set(0, -0.11, -0.05);
      const grip = box(0.05, 0.11, 0.07);
      grip.position.set(0, -0.08, 0.05);
      g.add(body, stock, mag, grip);
      break;
    }
    case 'shotgun': {
      const body = box(0.08, 0.1, 0.7);
      body.position.set(0, 0, -0.2);
      const barrel = new Mesh(new CylinderGeometry(0.035, 0.035, 0.5, 10), Materials.interactive);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.03, -0.28);
      const stock = box(0.06, 0.12, 0.2);
      stock.position.set(0, -0.02, 0.2);
      g.add(body, barrel, stock);
      break;
    }
    case 'nailgun': {
      const body = box(0.1, 0.16, 0.3);
      body.position.set(0, 0, -0.08);
      const nozzle = new Mesh(new CylinderGeometry(0.02, 0.03, 0.28, 8), Materials.interactive);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(0, 0.02, -0.28);
      const grip = box(0.06, 0.14, 0.08);
      grip.position.set(0, -0.12, 0.05);
      g.add(body, nozzle, grip);
      break;
    }
    case 'bat': {
      const handle = new Mesh(new CylinderGeometry(0.025, 0.03, 0.32, 8), Materials.interactive);
      handle.position.set(0, 0, 0.16);
      handle.rotation.x = Math.PI / 2;
      const barrel = new Mesh(new CylinderGeometry(0.05, 0.035, 0.6, 10), Materials.interactive);
      barrel.position.set(0, 0, -0.32);
      barrel.rotation.x = Math.PI / 2;
      g.add(handle, barrel);
      break;
    }
    case 'katana': {
      const blade = box(0.02, 0.04, 0.95);
      blade.position.set(0, 0, -0.5);
      const guard = box(0.12, 0.04, 0.03);
      guard.position.set(0, 0, -0.02);
      const handle = new Mesh(new CylinderGeometry(0.022, 0.022, 0.24, 8), Materials.interactive);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(0, 0, 0.12);
      g.add(blade, guard, handle);
      break;
    }
    case 'fist':
    default:
      break;
  }
  return g;
}

/** A glossy-red humanoid adversary. Height ~1.76m, feet at y=0. */
export function buildEnemyModel(): Group {
  const g = new Group();
  const mat = Materials.enemy;

  const torso = new Mesh(new BoxGeometry(0.42, 0.62, 0.26), mat);
  torso.position.y = 1.12;
  const hips = new Mesh(new BoxGeometry(0.38, 0.2, 0.24), mat);
  hips.position.y = 0.78;
  const head = new Mesh(new BoxGeometry(0.24, 0.26, 0.24), mat);
  head.position.y = 1.58;
  const neck = new Mesh(new BoxGeometry(0.12, 0.08, 0.12), mat);
  neck.position.y = 1.43;

  const armL = new Mesh(new CapsuleGeometry(0.08, 0.42, 4, 8), mat);
  armL.position.set(-0.3, 1.12, 0);
  const armR = armL.clone();
  armR.position.x = 0.3;

  const legL = new Mesh(new CapsuleGeometry(0.1, 0.6, 4, 8), mat);
  legL.position.set(-0.12, 0.42, 0);
  const legR = legL.clone();
  legR.position.x = 0.12;

  g.add(torso, hips, head, neck, armL, armR, legL, legR);
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

/** A black throwable (billiard ball / monitor stand-in). */
export function buildThrowableModel(radius: number): Mesh {
  const m = new Mesh(new SphereGeometry(radius, 12, 10), Materials.interactive);
  m.castShadow = true;
  return m;
}
