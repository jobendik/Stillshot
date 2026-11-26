import { Vector3 } from 'three';
import type { LevelDef, WaveDef } from '@/types';
import type { GameContext } from '@/core/Context';
import type { StreakRenderer } from '@/fx/Streaks';
import { Enemy } from './Enemy';

/**
 * Encounter director. Releases waves, keeps figures from standing inside each
 * other, and announces the end of the plate.
 *
 * Arrivals are never silent: a figure takes ~0.75 world-seconds to materialise
 * (harmless meanwhile), a ring marks the spot on the floor, the arrival has a
 * positional sound, and the HUD points to anything arriving off-screen. Being
 * surprised is part of the genre; being killed by something you could not have
 * known about is not.
 */
export class Director {
  readonly enemies: Enemy[] = [];
  private readonly ctx: GameContext;
  private waves: WaveDef[] = [];
  private queueIndex = 0;
  private spawnedAny = false;
  private waiting = false;
  private delayTimer = 0;
  private completed = false;
  /** Total figures in this plate (for the HUD). */
  total = 0;
  killed = 0;
  /** Where the last figure fell — the replay's closing shot looks here. */
  readonly lastKill = new Vector3();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  start(level: LevelDef): void {
    this.clear();
    this.waves = level.waves;
    this.queueIndex = 0;
    this.spawnedAny = false;
    this.waiting = false;
    this.delayTimer = 0;
    this.completed = false;
    this.killed = 0;
    this.total = 0;
    for (const w of this.waves) this.total += w.enemies.length;
  }

  get aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  /** Alive figures plus everything still queued. */
  remainingTotal(): number {
    return this.total - this.killed;
  }

  get isComplete(): boolean {
    return this.completed;
  }

  update(): void {
    const ctx = this.ctx;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update();
      if (!e.alive) this.enemies.splice(i, 1);
    }
    this.separate();

    if (this.completed) return;

    if (this.queueIndex >= this.waves.length) {
      if (this.spawnedAny && this.aliveCount === 0) {
        this.completed = true;
        ctx.bus.emit('level:complete', {});
      }
      return;
    }

    const wave = this.waves[this.queueIndex];
    const alive = this.aliveCount;
    const ready =
      wave.trigger === 'start' ||
      !this.spawnedAny ||
      (wave.trigger === 'cleared' && alive === 0) ||
      (wave.trigger === 'thin' && alive <= (wave.remaining ?? 0));

    if (!this.waiting) {
      if (ready) {
        this.waiting = true;
        this.delayTimer = wave.delay ?? 0;
      }
    } else {
      this.delayTimer -= ctx.time.scaledDt;
      if (this.delayTimer <= 0) {
        this.spawnWave(wave);
        this.queueIndex++;
        this.waiting = false;
        this.spawnedAny = true;
      }
    }
  }

  private spawnWave(wave: WaveDef): void {
    const ctx = this.ctx;
    for (const def of wave.enemies) {
      const e = new Enemy(ctx, def);
      this.enemies.push(e);
      ctx.fx.ring(e.pos, 1, 1.5);
      ctx.audio.play('arrive', e.center);
      ctx.bus.emit('enemy:spawned', { id: e.id, x: e.pos.x, y: e.pos.y + 1, z: e.pos.z });
    }
  }

  /**
   * A figure has just fallen. Reported at the instant it happens (not when the
   * list is next tidied) so the kill, its shatter and its sound share a timestamp.
   */
  reportKill(e: Enemy): void {
    this.killed++;
    this.lastKill.copy(e.pos);
    this.ctx.bus.emit('enemy:killed', {
      id: e.id,
      x: e.pos.x,
      y: e.pos.y + 1,
      z: e.pos.z,
      cause: e.deathCause,
      remaining: this.remainingTotal(),
    });
  }

  /** Gently push overlapping figures apart so they never merge into one silhouette. */
  private separate(): void {
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        const min = a.radius + b.radius + 0.12;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        // Proportional to world time so nothing drifts while the world is held.
        const push = Math.min(min - d, 2.5 * this.ctx.time.scaledDt) * 0.5;
        a.pos.x -= (dx / d) * push;
        a.pos.z -= (dz / d) * push;
        b.pos.x += (dx / d) * push;
        b.pos.z += (dz / d) * push;
      }
    }
  }

  /** The player has changed bodies: aims are reset and paths recomputed. */
  onPlayerRelocated(): void {
    for (const e of this.enemies) e.loseTrack();
  }

  drawTelegraphs(streaks: StreakRenderer): void {
    for (const e of this.enemies) e.drawTelegraph(streaks);
  }

  clear(): void {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
  }
}
