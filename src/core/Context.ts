import type { PerspectiveCamera, Scene } from 'three';
import type { TimeController } from './Time';
import type { InputManager } from './Input';
import type { EventBus } from './events';
import type { Level } from '@/world/Level';
import type { ProjectileSystem } from '@/combat/Projectile';
import type { ThrownObjectSystem } from '@/combat/Throwable';
import type { Player } from '@/player/Player';
import type { Director } from '@/ai/Director';
import type { FXSystem } from '@/fx/FX';
import type { AudioEngine } from '@/audio/Audio';
import type { ReplayRecorder } from '@/replay/Replay';

/**
 * A bag of shared services handed to every gameplay entity. Using a single
 * mutable context (assigned once by Game during setup) keeps entities free of
 * direct references to the orchestrator and avoids runtime import cycles —
 * every field here is imported as a *type only*.
 */
export class GameContext {
  scene!: Scene;
  camera!: PerspectiveCamera;
  time!: TimeController;
  input!: InputManager;
  bus!: EventBus;
  level!: Level;
  projectiles!: ProjectileSystem;
  thrown!: ThrownObjectSystem;
  player!: Player;
  director!: Director;
  fx!: FXSystem;
  audio!: AudioEngine;
  replay!: ReplayRecorder;
  /** Seeded RNG in [0,1). */
  rng!: () => number;
}

/** Mulberry32 — small, fast, seedable PRNG for reproducible spawns. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
