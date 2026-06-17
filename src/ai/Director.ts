import type { LevelDef, WaveDef } from '@/types';
import type { GameContext } from '@/core/Context';
import { Enemy } from './Enemy';

/**
 * Wave manager. Enemies don't exist at level start; they're released by an
 * array-based wave system that maintains constant pressure — including the
 * deliberately polarizing habit of spawning behind positions the player has
 * already "secured". When the final enemy falls, the arena is complete.
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
  }

  get aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  /** Alive enemies plus everything still queued — the HUD's countdown. */
  remainingTotal(): number {
    let n = this.aliveCount;
    for (let i = this.queueIndex; i < this.waves.length; i++) {
      n += this.waves[i].enemies.length;
    }
    return n;
  }

  get isComplete(): boolean {
    return this.completed;
  }

  update(scaledDt: number): void {
    // Update + cull.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(scaledDt);
      if (!e.alive) {
        this.enemies.splice(i, 1);
        this.ctx.bus.emit('enemy:killed', { remaining: this.remainingTotal() });
      }
    }

    if (this.completed) return;

    if (this.queueIndex >= this.waves.length) {
      if (this.spawnedAny && this.enemies.length === 0) {
        this.completed = true;
        this.ctx.bus.emit('level:complete', {});
      }
      return;
    }

    const wave = this.waves[this.queueIndex];
    // 'cleared' waits until the previous wave is dead; but if nothing has spawned
    // yet (a 'cleared'-first authoring mistake), self-satisfy so the level can't
    // deadlock. Mid-level behavior is unchanged.
    const ready =
      wave.trigger === 'start'
        ? true
        : !this.spawnedAny || this.enemies.length === 0;

    if (!this.waiting) {
      if (ready) {
        this.waiting = true;
        this.delayTimer = wave.delay ?? 0;
      }
    } else {
      this.delayTimer -= scaledDt;
      if (this.delayTimer <= 0) {
        this.spawnWave(wave);
        this.queueIndex++;
        this.waiting = false;
        this.spawnedAny = true;
      }
    }
  }

  private spawnWave(wave: WaveDef): void {
    for (const def of wave.enemies) {
      this.enemies.push(new Enemy(this.ctx, def));
    }
    this.ctx.bus.emit('enemy:spawned', { remaining: this.remainingTotal() });
    this.ctx.bus.emit('wave:announce', {
      index: this.queueIndex,
      total: this.waves.length,
    });
  }

  clear(): void {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
  }
}
