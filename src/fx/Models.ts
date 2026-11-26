import { BoxGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { WeaponKind } from '@/types';

/**
 * Procedural models for everything you can pick up. Interactive objects are
 * ink black — the silhouette carries all the meaning. Prototypes are built once
 * and cloned, so pickups, held weapons and replay props all share geometry.
 */

/** Ink: anything you can hold. Slightly glossy so edges catch the key light. */
export const inkMaterial = new MeshStandardMaterial({
  color: 0x16161b,
  roughness: 0.55,
  metalness: 0,
  flatShading: true,
});

function box(w: number, h: number, d: number): Mesh {
  return new Mesh(new BoxGeometry(w, h, d), inkMaterial);
}

function cyl(r1: number, r2: number, len: number, seg = 8): Mesh {
  const m = new Mesh(new CylinderGeometry(r1, r2, len, seg), inkMaterial);
  m.rotation.x = Math.PI / 2;
  return m;
}

function place<T extends Object3D>(o: T, x: number, y: number, z: number): T {
  o.position.set(x, y, z);
  return o;
}

/** Origin at the grip; barrel / blade points down -Z. */
function buildWeaponPrototype(kind: WeaponKind): Group {
  const g = new Group();
  switch (kind) {
    case 'pistol': {
      const grip = place(box(0.055, 0.13, 0.075), 0, -0.06, 0.035);
      grip.rotation.x = 0.22;
      g.add(place(box(0.062, 0.085, 0.24), 0, 0.03, -0.07), grip, place(box(0.02, 0.03, 0.06), 0, -0.02, -0.03), place(cyl(0.018, 0.018, 0.05), 0, 0.035, -0.2));
      break;
    }
    case 'rifle': {
      const grip = place(box(0.05, 0.12, 0.06), 0, -0.08, 0.06);
      grip.rotation.x = 0.25;
      const mag = place(box(0.045, 0.19, 0.075), 0, -0.12, -0.08);
      mag.rotation.x = -0.18;
      g.add(
        place(box(0.065, 0.095, 0.5), 0, 0.01, -0.12),
        place(cyl(0.02, 0.02, 0.34), 0, 0.02, -0.52),
        place(box(0.05, 0.1, 0.26), 0, -0.005, 0.24),
        place(box(0.03, 0.035, 0.2), 0, 0.075, -0.1),
        mag,
        grip,
      );
      break;
    }
    case 'shotgun': {
      const stock = place(box(0.055, 0.11, 0.28), 0, -0.03, 0.22);
      stock.rotation.x = -0.12;
      g.add(
        place(box(0.07, 0.085, 0.36), 0, 0, -0.06),
        place(cyl(0.03, 0.03, 0.56, 10), -0.018, 0.022, -0.46),
        place(cyl(0.03, 0.03, 0.56, 10), 0.018, 0.022, -0.46),
        place(box(0.075, 0.05, 0.2), 0, -0.035, -0.36),
        stock,
      );
      break;
    }
    case 'nailgun': {
      const grip = place(box(0.055, 0.15, 0.075), 0, -0.1, 0.05);
      grip.rotation.x = 0.2;
      g.add(
        place(box(0.085, 0.13, 0.26), 0, 0.01, -0.06),
        place(cyl(0.012, 0.03, 0.34, 6), 0, 0.03, -0.34),
        place(box(0.05, 0.2, 0.05), 0, -0.07, -0.13),
        grip,
      );
      break;
    }
    case 'bat': {
      g.add(place(cyl(0.024, 0.03, 0.34), 0, 0, 0.14), place(cyl(0.052, 0.03, 0.66, 10), 0, 0, -0.36), place(cyl(0.036, 0.036, 0.03), 0, 0, 0.32));
      break;
    }
    case 'katana': {
      const blade = place(box(0.012, 0.045, 0.98), 0, 0.004, -0.53);
      const tip = place(box(0.012, 0.032, 0.06), 0, 0.012, -1.03);
      tip.rotation.x = 0.35;
      g.add(blade, tip, place(box(0.11, 0.075, 0.016), 0, 0, -0.03), place(cyl(0.02, 0.02, 0.27), 0, 0, 0.11));
      break;
    }
    case 'fist':
    default:
      break;
  }
  g.traverse((o) => {
    o.castShadow = true;
  });
  return g;
}

const weaponProtos = new Map<WeaponKind, Group>();

export function buildWeaponModel(kind: WeaponKind): Group {
  let proto = weaponProtos.get(kind);
  if (!proto) {
    proto = buildWeaponPrototype(kind);
    weaponProtos.set(kind, proto);
  }
  return proto.clone(true);
}

const orbGeometry = new IcosahedronGeometry(1, 1);

/** A black throwable: a faceted ink orb. */
export function buildThrowableModel(radius: number): Mesh {
  const m = new Mesh(orbGeometry, inkMaterial);
  m.scale.setScalar(radius);
  m.castShadow = true;
  return m;
}

/** The player's bare hand (shown when punching / grabbing). */
export function buildFistModel(): Group {
  const g = new Group();
  g.add(place(box(0.085, 0.085, 0.11), 0, 0, -0.04), place(box(0.07, 0.07, 0.3), 0, -0.01, 0.16));
  return g;
}
