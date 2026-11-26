import { PointLight, type Scene, Vector3 } from 'three';
import { makeRng } from '@/core/Context';
import { GRAVITY } from '@/config/constants';
import type { CrystalTone } from './Crystal';
import { type BurstSpec, type Piece, ShardSystem } from './Shards';
import { StreakRenderer } from './Streaks';
import { BulletRenderer } from './Bullets';

/** Everything the FX layer can do, as plain data — this is what a replay stores. */
export type FxEvent =
  | { k: 'burst'; spec: BurstSpec }
  | { k: 'sparks'; p: [number, number, number]; d: [number, number, number]; n: number; tone: 0 | 1 | 2; seed: number }
  | { k: 'muzzle'; p: [number, number, number]; d: [number, number, number]; hostile: boolean; seed: number }
  | { k: 'ring'; p: [number, number, number]; tone: 0 | 1 | 2; size: number };

interface Spark {
  pos: Vector3;
  vel: Vector3;
  life: number;
  max: number;
  tone: 0 | 1 | 2;
  width: number;
  glow: boolean;
}

interface Ring {
  pos: Vector3;
  age: number;
  life: number;
  tone: 0 | 1 | 2;
  size: number;
}

interface Flash {
  light: PointLight;
  ttl: number;
  life: number;
  intensity: number;
}

// tone 0 = white-hot, 1 = red, 2 = ink
const TONE_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [3.2, 2.8, 2.2],
  [3.0, 0.2, 0.15],
  [0.04, 0.04, 0.05],
];

const RING_SEGMENTS = 28;
const _a = new Vector3();
const _b = new Vector3();

/**
 * Impact and destruction feedback. Owns the GPU shard system, the streak
 * renderer and the bullet renderer. Every effect is triggered through a small
 * set of methods that (a) build a serialisable event and (b) play it — the
 * recorder taps (a), the replay calls (b), so recorded effects are reproduced by
 * the very code that produced them.
 *
 * Sparks and rings live on WORLD time: land a hit while standing still and the
 * spray hangs in the air until you move.
 */
export class FXSystem {
  readonly shards: ShardSystem;
  readonly streaks: StreakRenderer;
  readonly bullets: BulletRenderer;
  /** Set by the recorder to capture every effect as it happens. */
  tap: ((ev: FxEvent) => void) | null = null;
  /** Full-screen flashes are scaled by this (reduced-flash setting). */
  flashScale = 1;

  private readonly particles: Spark[] = [];
  private readonly rings: Ring[] = [];
  private readonly flashes: Flash[] = [];
  private seedCounter = 1;
  private worldTime = 0;

  constructor(scene: Scene) {
    this.shards = new ShardSystem(scene);
    this.streaks = new StreakRenderer(scene);
    this.bullets = new BulletRenderer(scene);
    // A fixed pool: adding/removing lights at runtime would recompile every lit shader.
    for (let i = 0; i < 2; i++) {
      const light = new PointLight(0xffffff, 0, 9, 2);
      scene.add(light);
      this.flashes.push({ light, ttl: 0, life: 1, intensity: 0 });
    }
  }

  /** Reseed the effect RNG (called per attempt so runs are reproducible). */
  reseed(seed: number): void {
    this.seedCounter = seed >>> 0 || 1;
  }

  private nextSeed(): number {
    this.seedCounter = (Math.imul(this.seedCounter, 1664525) + 1013904223) >>> 0;
    return this.seedCounter;
  }

  // ---- triggers ---------------------------------------------------------

  /** Break a posed figure (or any set of registered parts) into crystal. */
  shatter(
    pieces: Piece[],
    tone: CrystalTone,
    impact: Vector3,
    dir: Vector3,
    force: number,
    opts: { radial?: number; crack?: number; life?: number } = {},
  ): void {
    this.emit({
      k: 'burst',
      spec: {
        tone,
        pieces,
        impact: [impact.x, impact.y, impact.z],
        dir: [dir.x, dir.y, dir.z],
        force,
        radial: opts.radial ?? 2.2,
        crack: opts.crack ?? 9,
        seed: this.nextSeed(),
        start: this.worldTime,
        life: opts.life,
      },
    });
  }

  shatterGlass(center: Vector3, size: Vector3, impact: Vector3, dir: Vector3): void {
    this.emit({
      k: 'burst',
      spec: {
        tone: 'glass',
        pieces: [],
        glass: { center: [center.x, center.y, center.z], size: [size.x, size.y, size.z] },
        impact: [impact.x, impact.y, impact.z],
        dir: [dir.x, dir.y, dir.z],
        force: 3.2,
        radial: 2.6,
        crack: 14,
        seed: this.nextSeed(),
        start: this.worldTime,
      },
    });
  }

  sparks(point: Vector3, dir: Vector3, count: number, tone: 0 | 1 | 2 = 0): void {
    this.emit({ k: 'sparks', p: [point.x, point.y, point.z], d: [dir.x, dir.y, dir.z], n: count, tone, seed: this.nextSeed() });
  }

  muzzle(origin: Vector3, dir: Vector3, hostile: boolean): void {
    this.emit({ k: 'muzzle', p: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z], hostile, seed: this.nextSeed() });
  }

  /** An expanding ring on the floor (arrivals, transfers). */
  ring(point: Vector3, tone: 0 | 1 | 2, size = 1.6): void {
    this.emit({ k: 'ring', p: [point.x, point.y, point.z], tone, size });
  }

  private emit(ev: FxEvent): void {
    this.tap?.(ev);
    this.play(ev);
  }

  /** Play an effect event (live or from a recording). */
  play(ev: FxEvent): void {
    switch (ev.k) {
      case 'burst':
        this.shards.spawn(ev.spec);
        break;
      case 'sparks': {
        const rng = makeRng(ev.seed);
        const d = new Vector3(...ev.d).normalize();
        for (let i = 0; i < ev.n && this.particles.length < 260; i++) {
          // Reflect-ish spray: mostly back along the incoming direction.
          const v = new Vector3(rng() - 0.5, rng() - 0.3, rng() - 0.5).multiplyScalar(2);
          v.addScaledVector(d, -0.9 - rng() * 0.8).normalize().multiplyScalar(2.5 + rng() * 7);
          const life = 0.12 + rng() * 0.3;
          this.particles.push({ pos: new Vector3(...ev.p), vel: v, life, max: life, tone: ev.tone, width: 0.012 + rng() * 0.012, glow: false });
        }
        this.flash(new Vector3(...ev.p), ev.tone === 1 ? 0xff3020 : 0xffffff, 1.6, 0.08);
        break;
      }
      case 'muzzle': {
        const rng = makeRng(ev.seed);
        const p = new Vector3(...ev.p);
        const d = new Vector3(...ev.d).normalize();
        this.particles.push({ pos: p.clone().addScaledVector(d, 0.12), vel: d.clone().multiplyScalar(1.5), life: 0.045, max: 0.045, tone: 0, width: 0.2, glow: true });
        for (let i = 0; i < 6; i++) {
          const v = d.clone().multiplyScalar(6 + rng() * 10);
          v.x += (rng() - 0.5) * 5;
          v.y += (rng() - 0.5) * 5;
          v.z += (rng() - 0.5) * 5;
          const life = 0.035 + rng() * 0.05;
          this.particles.push({ pos: p.clone(), vel: v, life, max: life, tone: 0, width: 0.016, glow: false });
        }
        this.flash(p, ev.hostile ? 0xff5a40 : 0xfff0d0, 3.2, 0.07);
        break;
      }
      case 'ring':
        this.rings.push({ pos: new Vector3(...ev.p), age: 0, life: 0.55, tone: ev.tone, size: ev.size });
        break;
    }
  }

  private flash(pos: Vector3, color: number, intensity: number, life: number): void {
    // Reuse whichever pooled light is closest to finishing.
    let best = this.flashes[0];
    for (const f of this.flashes) if (f.ttl < best.ttl) best = f;
    best.light.color.setHex(color);
    best.light.position.copy(pos);
    best.ttl = life;
    best.life = life;
    best.intensity = intensity * this.flashScale;
  }

  // ---- per-frame --------------------------------------------------------

  /**
   * @param realDt   wall-clock delta (light pulses always decay)
   * @param worldDt  world delta (sparks, rings)
   * @param worldTime the clock the shard shader reads
   */
  update(realDt: number, worldDt: number, worldTime: number): void {
    this.worldTime = worldTime;
    this.shards.update(worldTime);

    // Sparks: world time, with a trickle of real time so a muzzle glow never
    // parks itself in front of the camera for a minute.
    const sdt = Math.max(worldDt, realDt * 0.04);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const s = this.particles[i];
      s.life -= s.glow ? Math.max(worldDt, realDt * 0.35) : sdt;
      if (s.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      s.vel.y -= GRAVITY * 0.45 * sdt;
      s.pos.addScaledVector(s.vel, sdt);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += Math.max(worldDt, realDt * 0.05);
      if (r.age >= r.life) this.rings.splice(i, 1);
    }
    for (const f of this.flashes) {
      if (f.ttl > 0) {
        f.ttl -= Math.max(worldDt, realDt * 0.5);
        f.light.intensity = f.intensity * Math.max(0, f.ttl / f.life);
      } else if (f.light.intensity !== 0) {
        f.light.intensity = 0;
      }
    }
  }

  /** Submit sparks & rings to the streak renderer (between streaks.begin/end). */
  draw(): void {
    const st = this.streaks;
    for (const s of this.particles) {
      const k = s.life / s.max;
      const c = TONE_RGB[s.tone];
      if (s.glow) {
        st.glow(s.pos, s.width * (1.4 - k * 0.4), [c[0], c[1], c[2], 0.9 * k]);
      } else {
        _a.copy(s.pos);
        _b.copy(s.pos).addScaledVector(s.vel, -0.028);
        st.line(_a, _b, s.width, [c[0], c[1], c[2], k], [c[0], c[1], c[2], 0]);
      }
    }
    for (const r of this.rings) {
      const k = r.age / r.life;
      const radius = 0.25 + r.size * (1 - (1 - k) * (1 - k));
      const c = TONE_RGB[r.tone];
      const alpha = (1 - k) * 0.85;
      for (let i = 0; i < RING_SEGMENTS; i++) {
        const a0 = (i / RING_SEGMENTS) * Math.PI * 2;
        const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
        _a.set(r.pos.x + Math.cos(a0) * radius, r.pos.y + 0.03, r.pos.z + Math.sin(a0) * radius);
        _b.set(r.pos.x + Math.cos(a1) * radius, r.pos.y + 0.03, r.pos.z + Math.sin(a1) * radius);
        st.line(_a, _b, 0.05 * (1 - k) + 0.012, [c[0], c[1], c[2], alpha], [c[0], c[1], c[2], alpha]);
      }
    }
  }

  get sparkCount(): number {
    return this.particles.length;
  }

  /** Remove transient particles (keeps shard bursts unless `all`). */
  clear(all = true): void {
    this.particles.length = 0;
    this.rings.length = 0;
    for (const f of this.flashes) {
      f.ttl = 0;
      f.light.intensity = 0;
    }
    if (all) this.shards.clear();
    this.bullets.clear();
  }
}
