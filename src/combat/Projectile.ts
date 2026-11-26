import { Vector3 } from 'three';
import type { Faction, GlassBehavior, ProjectileLook } from '@/types';
import type { GameContext } from '@/core/Context';
import type { KillCause } from '@/core/events';
import type { BulletVisual } from '@/fx/Bullets';
import { rayVsBox, segmentVsSphere } from '@/world/Collision';
import { BULLET_RADIUS, PROJECTILE_LIFETIME, SPLIT_ANGLE } from '@/config/constants';

export interface ProjectileOptions {
  faction: Faction;
  speed: number;
  piercing: boolean;
  glass: GlassBehavior;
  /** Can be split / returned by a blade. */
  deflectable: boolean;
  look: ProjectileLook;
  /** Enemy id of the shooter (so a round never hits the barrel it left). */
  ownerId?: number;
  cause?: KillCause;
}

let NEXT_ID = 1;

export class Projectile {
  id = 0;
  readonly pos = new Vector3();
  readonly dir = new Vector3();
  speed = 0;
  faction: Faction = 'enemy';
  piercing = false;
  glass: GlassBehavior = 'stop';
  deflectable = true;
  look: ProjectileLook = 'bullet';
  ownerId = -1;
  cause: KillCause = 'bullet';
  life = PROJECTILE_LIFETIME;
  /** Distance flown so far (drives the wake and the self-hit grace distance). */
  traveled = 0;
  /** Distance ahead to solid architecture (for the threat line). */
  threat = 0;
  /** Set once the round has passed the player without hitting. */
  passed = false;
  /** Bodies already pierced. */
  readonly pierced = new Set<number>();
}

type Hit =
  | { dist: number; type: 'glass'; index: number }
  | { dist: number; type: 'enemy'; index: number }
  | { dist: number; type: 'thrown'; index: number }
  | { dist: number; type: 'player' }
  | { dist: number; type: 'blade' };

const _p0 = new Vector3();
const _pt = new Vector3();
const _n = new Vector3();
const _rel = new Vector3();

/**
 * Every round in the air. Projectiles are physical objects — never hitscan —
 * advancing on world time (or the local time of whatever field they are in), so
 * they can be watched, side-stepped, split, returned, blocked with a thrown
 * object, or left to find someone else.
 *
 * Each step is a swept segment tested against architecture, glass, thrown
 * objects, bodies and the player's blade, resolved in distance order, so
 * nothing tunnels at any time scale or frame rate.
 *
 * Rules that make the room a sandbox:
 *   - Hostile rounds hit hostile bodies too. A bullet you dodge keeps going.
 *   - A blade does not delete a bullet. A katana SPLITS it into two live halves
 *     that leave along your aim; a bat sends it back whole.
 *   - A Bulwark's slab reflects what hits it; the reflection is nobody's friend.
 */
export class ProjectileSystem {
  private readonly ctx: GameContext;
  private readonly pool: Projectile[] = [];
  readonly active: Projectile[] = [];
  private readonly hits: Hit[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  spawn(origin: Vector3, dir: Vector3, opts: ProjectileOptions): Projectile {
    const p = this.pool.pop() ?? new Projectile();
    p.id = NEXT_ID++;
    p.pos.copy(origin);
    p.dir.copy(dir).normalize();
    p.speed = opts.speed;
    p.faction = opts.faction;
    p.piercing = opts.piercing;
    p.glass = opts.glass;
    p.deflectable = opts.deflectable;
    p.look = opts.look;
    p.ownerId = opts.ownerId ?? -1;
    p.cause = opts.cause ?? 'bullet';
    p.life = PROJECTILE_LIFETIME;
    p.traveled = 0;
    p.threat = 0;
    p.passed = false;
    p.pierced.clear();
    this.active.push(p);
    return p;
  }

  clear(): void {
    for (const p of this.active) this.pool.push(p);
    this.active.length = 0;
  }

  update(): void {
    const ctx = this.ctx;
    const level = ctx.level;
    if (!level) return;
    const b = level.bounds;
    const wantThreat = ctx.time.scale < 0.6;

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      const dt = level.localDt(p.pos, ctx.time);
      let dead = false;
      if (dt > 0) {
        p.life -= dt;
        dead = this.step(p, p.speed * dt) || p.life <= 0;
        if (
          !dead &&
          (p.pos.x < b.minX - 2 || p.pos.x > b.maxX + 2 || p.pos.z < b.minZ - 2 || p.pos.z > b.maxZ + 2 || p.pos.y < level.floorY - 1 || p.pos.y > 30)
        ) {
          dead = true;
        }
      }
      if (dead) {
        this.pool.push(p);
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
        continue;
      }
      if (p.faction === 'enemy' && wantThreat) p.threat = this.threatDistance(p);
      else p.threat = 0;
    }
  }

  /** How far ahead until this round hits architecture (or the floor). */
  private threatDistance(p: Projectile): number {
    const level = this.ctx.level;
    let d = level.rayToSolid(p.pos, p.dir, 40);
    if (p.dir.y < -1e-3) d = Math.min(d, (level.floorY - p.pos.y) / p.dir.y);
    return d;
  }

  /** Advance one projectile across a swept segment. Returns true if it is spent. */
  private step(p: Projectile, segLen: number): boolean {
    const ctx = this.ctx;
    const level = ctx.level;
    const dir = p.dir;
    const p0 = _p0.copy(p.pos);

    // Nearest solid — nothing beyond it matters.
    let wallDist = Infinity;
    for (const box of level.solids) {
      const t = rayVsBox(p0, dir, box, segLen);
      if (t !== null && t < wallDist) wallDist = t;
    }
    // The floor is solid too.
    if (dir.y < 0) {
      const t = (level.floorY - p0.y) / dir.y;
      if (t >= 0 && t <= segLen && t < wallDist) wallDist = t;
    }
    const reach = Math.min(segLen, wallDist);

    const hits = this.hits;
    hits.length = 0;

    for (let gi = 0; gi < level.glass.length; gi++) {
      const g = level.glass[gi];
      if (!g.alive) continue;
      const t = rayVsBox(p0, dir, g.box, reach);
      if (t !== null) hits.push({ dist: t, type: 'glass', index: gi });
    }

    // Thrown objects stop bullets of either side: anything you can throw is a shield.
    const thrown = ctx.thrown.objects;
    for (let ti = 0; ti < thrown.length; ti++) {
      const o = thrown[ti];
      const t = segmentVsSphere(p0, dir, reach, o.pos, o.radius + BULLET_RADIUS);
      if (t !== null) hits.push({ dist: t, type: 'thrown', index: ti });
    }

    const enemies = ctx.director.enemies;
    for (let ei = 0; ei < enemies.length; ei++) {
      const e = enemies[ei];
      if (!e.alive || p.pierced.has(e.id)) continue;
      // A round cannot hit the body it was fired from until it has cleared it.
      if (e.id === p.ownerId && p.traveled < 1.2) continue;
      const t = sweptCylinder(p0, dir, reach, e.pos, e.radius + BULLET_RADIUS, e.height);
      if (t !== null) hits.push({ dist: t, type: 'enemy', index: ei });
    }

    if (p.faction === 'enemy') {
      const player = ctx.player;
      if (player.alive) {
        if (p.deflectable && player.bladeActive) {
          const t = segmentVsSphere(p0, dir, reach, player.bladeCenter, player.bladeRadius);
          if (t !== null) hits.push({ dist: t, type: 'blade' });
        }
        const t = sweptCylinder(p0, dir, reach, player.pos, player.hitRadiusFor(p.pos) + BULLET_RADIUS, player.height);
        if (t !== null) hits.push({ dist: t, type: 'player' });
      }
    }

    if (hits.length > 1) hits.sort((a, b) => a.dist - b.dist);

    for (const hit of hits) {
      const point = _pt.copy(p0).addScaledVector(dir, hit.dist);
      switch (hit.type) {
        case 'glass': {
          const g = level.glass[hit.index];
          if (!g.alive) break;
          ctx.fx.shatterGlass(g.center, g.size, point, dir);
          level.breakGlass(hit.index);
          ctx.audio.play('glass', point);
          if (p.glass === 'stop') return this.stopAt(p, point, hit.dist);
          break; // every other behaviour carries on through the broken pane
        }
        case 'thrown': {
          const o = ctx.thrown.objects[hit.index];
          if (!o) break;
          ctx.thrown.struck(o, point, dir);
          return this.stopAt(p, point, hit.dist);
        }
        case 'enemy': {
          const e = enemies[hit.index];
          if (!e.alive) break;
          if (!p.piercing && e.shieldBlocks(dir)) {
            // Reflect off the slab. The reflection belongs to no one.
            e.shieldNormal(_n);
            const d = dir.dot(_n);
            dir.addScaledVector(_n, -2 * d).normalize();
            p.pos.copy(point).addScaledVector(dir, 0.05);
            p.traveled = 0;
            p.faction = 'enemy';
            p.ownerId = e.id;
            p.cause = 'ricochet';
            p.deflectable = true;
            e.onShieldHit(point);
            ctx.fx.sparks(point, _n.clone().negate(), 10, 0);
            ctx.audio.play('ricochet', point);
            return false;
          }
          const cause: KillCause = p.faction === 'player' ? (p.pierced.size > 0 ? 'collateral' : p.cause) : 'friendly';
          e.kill(point.clone(), dir, cause, 5.5);
          if (p.faction === 'player') ctx.bus.emit('hitmarker', {});
          if (p.piercing) {
            p.pierced.add(e.id);
            break;
          }
          return this.stopAt(p, point, hit.dist);
        }
        case 'blade': {
          const action = ctx.player.onBladeContact(point);
          if (action === 'split') {
            // One hostile round becomes two of yours, leaving along your aim.
            const aim = ctx.player.aimDir;
            const right = ctx.player.aimRight;
            const spread = Math.tan(SPLIT_ANGLE);
            for (const sign of [-1, 1]) {
              const d = _rel.copy(aim).addScaledVector(right, sign * spread).normalize();
              this.spawn(point.clone().addScaledVector(right, sign * 0.06), d, {
                faction: 'player',
                speed: p.speed * 0.95,
                piercing: false,
                glass: 'stop',
                deflectable: false,
                look: 'half',
                cause: 'split',
              });
            }
            ctx.fx.sparks(point, dir, 8, 0);
            ctx.audio.play('slice', point);
            ctx.bus.emit('bullet:split', {});
            p.pos.copy(point);
            return true;
          }
          if (action === 'return') {
            dir.copy(ctx.player.aimDir).normalize();
            p.pos.copy(point).addScaledVector(dir, 0.05);
            p.traveled = 0;
            p.faction = 'player';
            p.ownerId = -1;
            p.cause = 'returned';
            p.deflectable = false;
            ctx.fx.sparks(point, dir.clone().negate(), 8, 0);
            ctx.audio.play('deflect', point);
            ctx.bus.emit('bullet:returned', {});
            return false;
          }
          break;
        }
        case 'player': {
          p.pos.copy(point);
          ctx.player.die('shot', p0);
          return true;
        }
      }
    }

    if (wallDist <= segLen) {
      p.pos.copy(p0).addScaledVector(dir, wallDist);
      ctx.fx.sparks(p.pos, dir, 5, 0);
      ctx.audio.play('impact', p.pos);
      return true;
    }

    p.pos.copy(p0).addScaledVector(dir, segLen);
    p.traveled += segLen;

    // Near miss: the round has just gone past the player's head.
    if (p.faction === 'enemy' && !p.passed && ctx.player.alive) {
      const head = ctx.player.headPos;
      _rel.subVectors(head, p.pos);
      if (_rel.dot(dir) < 0) {
        p.passed = true;
        const perp = _rel.addScaledVector(dir, -_rel.dot(dir)).length();
        if (perp < 1.1) {
          ctx.audio.play('whiz', p.pos);
          ctx.bus.emit('bullet:near', { x: p.pos.x, y: p.pos.y, z: p.pos.z });
        }
      }
    }
    return false;
  }

  private stopAt(p: Projectile, point: Vector3, _dist: number): boolean {
    p.pos.copy(point);
    return true;
  }

  /** Describe every live round for the renderer / recorder. */
  fillVisuals(out: BulletVisual[]): BulletVisual[] {
    out.length = 0;
    for (const p of this.active) {
      out.push({
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z,
        dx: p.dir.x,
        dy: p.dir.y,
        dz: p.dir.z,
        look: p.look,
        hostile: p.faction === 'enemy',
        trail: Math.min(p.traveled, p.speed * 0.05),
        threat: p.threat,
      });
    }
    return out;
  }
}

/**
 * Closest-approach test between a swept segment and a vertical cylinder (an
 * actor standing at `feet`). Returns the distance along the segment, or null.
 */
export function sweptCylinder(origin: Vector3, dir: Vector3, segLen: number, feet: Vector3, radius: number, height: number): number | null {
  const ax = origin.x - feet.x;
  const az = origin.z - feet.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  let t: number;
  if (a < 1e-8) {
    t = 0;
  } else {
    const b = ax * dir.x + az * dir.z;
    const c = ax * ax + az * az - radius * radius;
    if (c > 0 && b >= 0) return null; // outside and heading away
    const disc = b * b - a * c;
    if (disc < 0) return null;
    // Entry point of the infinite cylinder (or 0 if we start inside it).
    t = Math.max(0, (-b - Math.sqrt(disc)) / a);
    if (t > segLen) return null;
    // If the segment enters above/below the body, try where it crosses the caps.
    const yEntry = origin.y + dir.y * t;
    if (yEntry < feet.y || yEntry > feet.y + height) {
      if (Math.abs(dir.y) < 1e-6) return null;
      const capY = yEntry < feet.y ? feet.y : feet.y + height;
      const tc = (capY - origin.y) / dir.y;
      if (tc < t || tc > segLen) return null;
      const cx = ax + dir.x * tc;
      const cz = az + dir.z * tc;
      if (cx * cx + cz * cz > radius * radius) return null;
      t = tc;
    }
    return t;
  }
  if (ax * ax + az * az > radius * radius) return null;
  // Vertical shot: does the segment's vertical span overlap the body?
  const y0 = origin.y;
  const y1 = origin.y + dir.y * segLen;
  if (Math.max(y0, y1) < feet.y || Math.min(y0, y1) > feet.y + height) return null;
  return t;
}
