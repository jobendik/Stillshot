import { BoxGeometry, Mesh, Quaternion, Vector3 } from 'three';
import type { Faction, GlassBehavior } from '@/types';
import type { GameContext } from '@/core/Context';
import { Materials } from '@/fx/Materials';
import { rayVsBox } from '@/world/Collision';
import { BULLET_RADIUS, PROJECTILE_LIFETIME } from '@/config/constants';

export interface ProjectileOptions {
  faction: Faction;
  speed: number;
  piercing: boolean;
  glass: GlassBehavior;
  /** Can be sliced/deflected by a katana / bat. */
  deflectable: boolean;
}

const _up = new Vector3(0, 0, 1);
const _q = new Quaternion();
const _tmp = new Vector3();

export class Projectile {
  readonly pos = new Vector3();
  readonly dir = new Vector3();
  speed = 0;
  faction: Faction = 'enemy';
  piercing = false;
  glass: GlassBehavior = 'stop';
  deflectable = true;
  alive = true;
  life = PROJECTILE_LIFETIME;
  /** Enemies already pierced (so a single nail doesn't double-count one body). */
  readonly pierced = new Set<number>();
  mesh: Mesh;

  constructor() {
    this.mesh = new Mesh(new BoxGeometry(0.04, 0.04, 0.3), Materials.bullet);
  }

  orient(): void {
    this.mesh.position.copy(this.pos);
    _q.setFromUnitVectors(_up, this.dir);
    this.mesh.quaternion.copy(_q);
  }
}

/**
 * Manages every live bullet/pellet/nail. Projectiles are *physical* objects (no
 * hitscan), so they crawl through the air at scaled time and can be tracked,
 * dodged, or sliced. Each step does a swept segment test against walls, glass,
 * actors, and the player's blade, processing hits in distance order.
 */
export class ProjectileSystem {
  private readonly ctx: GameContext;
  private readonly pool: Projectile[] = [];
  readonly active: Projectile[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  spawn(origin: Vector3, dir: Vector3, opts: ProjectileOptions): Projectile {
    const p = this.pool.pop() ?? new Projectile();
    p.pos.copy(origin);
    p.dir.copy(dir).normalize();
    p.speed = opts.speed;
    p.faction = opts.faction;
    p.piercing = opts.piercing;
    p.glass = opts.glass;
    p.deflectable = opts.deflectable;
    p.alive = true;
    p.life = PROJECTILE_LIFETIME;
    p.pierced.clear();
    p.orient();
    this.ctx.scene.add(p.mesh);
    this.active.push(p);
    return p;
  }

  private release(p: Projectile): void {
    p.alive = false;
    this.ctx.scene.remove(p.mesh);
    this.pool.push(p);
  }

  clear(): void {
    for (const p of this.active) {
      this.ctx.scene.remove(p.mesh);
      this.pool.push(p);
    }
    this.active.length = 0;
  }

  update(scaledDt: number): void {
    if (scaledDt <= 0) return;
    const ctx = this.ctx;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= scaledDt;
      const segLen = p.speed * scaledDt;
      const p0 = _tmp.copy(p.pos);
      const stopped = this.stepProjectile(p, p0, segLen);

      if (stopped || p.life <= 0 || !ctx.level) {
        this.release(p);
        this.active.splice(i, 1);
        continue;
      }
      // Cull strays that have left the arena.
      const b = ctx.level.bounds;
      if (
        p.pos.x < b.minX - 3 ||
        p.pos.x > b.maxX + 3 ||
        p.pos.z < b.minZ - 3 ||
        p.pos.z > b.maxZ + 3 ||
        p.pos.y < -2 ||
        p.pos.y > 12
      ) {
        this.release(p);
        this.active.splice(i, 1);
        continue;
      }
      p.orient();
    }
  }

  /**
   * Advance one projectile across a swept segment of length `segLen`.
   * Returns true if the projectile should be destroyed.
   */
  private stepProjectile(p: Projectile, p0: Vector3, segLen: number): boolean {
    const ctx = this.ctx;
    const dir = p.dir;

    // Nearest hard wall — nothing past this matters.
    let wallDist = Infinity;
    for (const box of ctx.level.solids) {
      const t = rayVsBox(p0, dir, box, segLen);
      if (t !== null && t < wallDist) wallDist = t;
    }

    type Hit =
      | { dist: number; type: 'glass'; index: number }
      | { dist: number; type: 'enemy'; index: number }
      | { dist: number; type: 'player' }
      | { dist: number; type: 'blade' };
    const hits: Hit[] = [];

    // Glass.
    for (let gi = 0; gi < ctx.level.glass.length; gi++) {
      const g = ctx.level.glass[gi];
      if (!g.alive) continue;
      const t = rayVsBox(p0, dir, g.box, Math.min(segLen, wallDist));
      if (t !== null) hits.push({ dist: t, type: 'glass', index: gi });
    }

    // Enemies (player bullets) — swept cylinder test.
    if (p.faction === 'player') {
      const enemies = ctx.director.enemies;
      for (let ei = 0; ei < enemies.length; ei++) {
        const e = enemies[ei];
        if (!e.alive || p.pierced.has(e.id)) continue;
        const t = sweptCylinder(p0, dir, segLen, e.pos, e.radius + BULLET_RADIUS, e.height);
        if (t !== null) hits.push({ dist: t, type: 'enemy', index: ei });
      }
    }

    // Player (enemy bullets) + blade defense.
    if (p.faction === 'enemy') {
      const player = ctx.player;
      if (player.alive) {
        // Blade slice/deflect — checked before the body so it can save you.
        if (p.deflectable && player.bladeActive) {
          const t = segmentVsSphere(p0, dir, segLen, player.bladeCenter, player.bladeRadius);
          if (t !== null) hits.push({ dist: t, type: 'blade' });
        }
        const t = sweptCylinder(
          p0,
          dir,
          segLen,
          player.pos,
          player.hitRadiusFor(p.pos) + BULLET_RADIUS,
          player.height,
        );
        if (t !== null) hits.push({ dist: t, type: 'player' });
      }
    }

    hits.sort((a, b) => a.dist - b.dist);

    for (const hit of hits) {
      if (hit.dist > wallDist) break;
      switch (hit.type) {
        case 'glass': {
          ctx.fx.shatterGlass(ctx.level.glass[hit.index], p0.clone().addScaledVector(dir, hit.dist), dir);
          ctx.level.breakGlass(hit.index);
          ctx.audio.play('glass');
          if (p.glass === 'stop') {
            this.placeAt(p, p0, hit.dist);
            return true;
          }
          break; // all other behaviors penetrate the now-broken pane
        }
        case 'enemy': {
          const e = ctx.director.enemies[hit.index];
          const point = p0.clone().addScaledVector(dir, hit.dist);
          e.kill(point, dir);
          if (p.piercing) {
            p.pierced.add(e.id);
            break;
          }
          this.placeAt(p, p0, hit.dist);
          return true;
        }
        case 'player': {
          ctx.player.die('shot');
          this.placeAt(p, p0, hit.dist);
          return true;
        }
        case 'blade': {
          const point = p0.clone().addScaledVector(dir, hit.dist);
          const action = ctx.player.onBladeContact(point);
          if (action === 'slice') {
            ctx.fx.bulletSplit(point, dir);
            ctx.audio.play('slice');
            return true;
          } else if (action === 'deflect') {
            // Reflect roughly back at the shooters and convert to a player bullet.
            ctx.audio.play('deflect');
            p.dir.copy(ctx.player.bladeNormal).normalize();
            p.faction = 'player';
            p.deflectable = false;
            p.speed *= 0.85;
            this.placeAt(p, p0, hit.dist);
            return false;
          }
          break;
        }
      }
    }

    // Stop at the wall if we reached one.
    if (wallDist <= segLen) {
      const point = p0.clone().addScaledVector(dir, wallDist);
      ctx.fx.spark(point, dir);
      ctx.audio.play('impact');
      p.pos.copy(point);
      return true;
    }

    p.pos.copy(p0).addScaledVector(dir, segLen);
    return false;
  }

  private placeAt(p: Projectile, p0: Vector3, dist: number): void {
    p.pos.copy(p0).addScaledVector(p.dir, dist);
  }
}

// ---------------------------------------------------------------------------
// Swept intersection helpers
// ---------------------------------------------------------------------------

const _seg = new Vector3();
const _rel = new Vector3();

/**
 * Closest-approach test between a swept bullet segment and a vertical cylinder
 * (actor). Returns the hit distance along the segment, or null.
 */
function sweptCylinder(
  origin: Vector3,
  dir: Vector3,
  segLen: number,
  feet: Vector3,
  radius: number,
  height: number,
): number | null {
  // Horizontal closest approach (XZ plane).
  const ax = origin.x - feet.x;
  const az = origin.z - feet.z;
  const dx = dir.x;
  const dz = dir.z;
  const a = dx * dx + dz * dz;
  let t: number;
  if (a < 1e-8) {
    t = 0;
  } else {
    t = -(ax * dx + az * dz) / a;
    t = Math.max(0, Math.min(segLen, t));
  }
  const cx = origin.x + dir.x * t;
  const cz = origin.z + dir.z * t;
  const distSq = (cx - feet.x) * (cx - feet.x) + (cz - feet.z) * (cz - feet.z);
  if (distSq > radius * radius) return null;
  const cy = origin.y + dir.y * t;
  if (cy < feet.y - radius || cy > feet.y + height + radius) return null;
  return t;
}

/** Ray/segment vs sphere. Returns nearest positive hit distance within segLen. */
function segmentVsSphere(
  origin: Vector3,
  dir: Vector3,
  segLen: number,
  center: Vector3,
  radius: number,
): number | null {
  _rel.subVectors(origin, center);
  const b = _rel.dot(dir);
  const c = _rel.lengthSq() - radius * radius;
  if (c > 0 && b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  const hit = t < 0 ? 0 : t;
  if (hit > segLen) return null;
  _seg.copy(origin).addScaledVector(dir, hit);
  return hit;
}
