import type { EnemyKind, WeaponKind } from '@/types';
import type { GameContext } from '@/core/Context';
import type { BorrowPhase } from '@/core/Time';
import type { KillCause } from '@/core/events';
import type { FxEvent } from '@/fx/FX';
import type { BulletVisual } from '@/fx/Bullets';
import type { FigurePose } from '@/fx/Rig';
import type { SoundName } from '@/audio/Audio';
import type { ViewState } from '@/player/Viewmodel';

/**
 * WHAT A RECORDING IS
 *
 * A run is stored as two streams on one timeline:
 *
 *   frames — dense snapshots of everything that has a pose: the player (body
 *            AND first-person hands), every figure (the same `FigurePose` the
 *            AI wrote, so playback re-poses the real rig), every round, every
 *            thrown or dropped object.
 *   events — everything that happens at an instant: each effect the FX layer
 *            played (shatters carry their full seeded spec, so the identical
 *            fracture is regenerated), each sound, each kill and its cause,
 *            glass breaking, transfers, bullets split or returned, near misses,
 *            time being borrowed and repaid.
 *
 * THE TIMELINE
 *
 * The player lives on real time and the world on scaled time, so neither clock
 * alone can order a run: sampled against real time the replay would be minutes
 * of standing still; sampled against world time alone, anything the player does
 * while the world is frozen (borrowed time) would collapse to a single instant.
 * Frames are therefore keyed by `tau`, the replay clock kept by TimeController:
 * world time, plus a compressed share of borrowed real time. Each frame also
 * stores the world time `w` it corresponds to, which is the clock every
 * world-time shader (shards, floor rings) is driven by during playback.
 *
 * A frame is taken whenever tau has advanced by 1/90s, whenever an event has
 * just been logged (so cause and effect share a snapshot), and whenever the
 * camera has turned noticeably — a snap aim that cost almost no world time is
 * still recorded as the motion it was.
 */

export interface FigSample {
  id: number;
  kind: EnemyKind;
  weapon: WeaponKind | null;
  pose: FigurePose;
}

export interface PlayerSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  stride: number;
  grounded: boolean;
  fov: number;
  view: ViewState;
}

export interface BulletSample extends BulletVisual {
  id: number;
}

export interface PropSample {
  id: number;
  kind: WeaponKind | 'orb';
  radius: number;
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

export interface Frame {
  tau: number;
  w: number;
  scale: number;
  phase: BorrowPhase;
  player: PlayerSample;
  figs: FigSample[];
  bullets: BulletSample[];
  props: PropSample[];
}

export type ReplayEventBody =
  | { k: 'fx'; ev: FxEvent }
  | { k: 'snd'; name: SoundName; pos: [number, number, number] | null; param: number }
  | { k: 'kill'; id: number; x: number; y: number; z: number; cause: KillCause }
  | { k: 'glass'; index: number }
  | { k: 'transfer' }
  | { k: 'split' }
  | { k: 'returned' }
  | { k: 'near'; x: number; y: number; z: number }
  | { k: 'borrow'; on: boolean }
  | { k: 'death' };

export type ReplayEvent = ReplayEventBody & { tau: number; w: number };

export interface Recording {
  frames: Frame[];
  events: ReplayEvent[];
  /** Length of the timeline (tau seconds). */
  duration: number;
  /** World seconds spent — the plate's exposure. */
  exposure: number;
  realTime: number;
}

const SAMPLE_INTERVAL = 1 / 90;
const MAX_FRAMES = 14000;
const TURN_THRESHOLD = 0.03;
const PROP_ID_THROWN = 1_000_000;

export class ReplayRecorder {
  private readonly ctx: GameContext;
  private frames: Frame[] = [];
  private events: ReplayEvent[] = [];
  private recording = false;
  private lastTau = -1;
  private lastYaw = 0;
  private lastPitch = 0;
  private dirty = false;
  private glassAlive: boolean[] = [];
  private startReal = 0;
  private readonly visuals: BulletVisual[] = [];

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    const bus = ctx.bus;
    bus.on('enemy:killed', (p) => this.log({ k: 'kill', id: p.id, x: p.x, y: p.y, z: p.z, cause: p.cause }));
    bus.on('hotswitch', () => this.log({ k: 'transfer' }));
    bus.on('bullet:split', () => this.log({ k: 'split' }));
    bus.on('bullet:returned', () => this.log({ k: 'returned' }));
    bus.on('bullet:near', (p) => this.log({ k: 'near', x: p.x, y: p.y, z: p.z }));
    bus.on('borrow:begin', () => this.log({ k: 'borrow', on: true }));
    bus.on('borrow:end', () => this.log({ k: 'borrow', on: false }));
    bus.on('player:died', () => this.log({ k: 'death' }));
  }

  get isRecording(): boolean {
    return this.recording;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get eventCount(): number {
    return this.events.length;
  }

  begin(): void {
    this.frames = [];
    this.events = [];
    this.recording = true;
    this.lastTau = -1;
    this.dirty = true;
    this.startReal = this.ctx.time.realElapsed;
    this.glassAlive = this.ctx.level.glass.map(() => true);
    this.ctx.fx.tap = (ev) => this.log({ k: 'fx', ev });
    this.ctx.audio.tap = (name, pos, param) => this.log({ k: 'snd', name, pos, param });
  }

  /** Stop recording and hand over the result. */
  finish(): Recording {
    if (this.recording) this.sample(true);
    this.recording = false;
    this.ctx.fx.tap = null;
    this.ctx.audio.tap = null;
    const frames = this.frames;
    const events = this.events;
    this.frames = [];
    this.events = [];
    return {
      frames,
      events,
      duration: frames.length > 0 ? frames[frames.length - 1].tau : 0,
      exposure: this.ctx.time.worldElapsed,
      realTime: this.ctx.time.realElapsed - this.startReal,
    };
  }

  abort(): void {
    this.recording = false;
    this.ctx.fx.tap = null;
    this.ctx.audio.tap = null;
    this.frames = [];
    this.events = [];
  }

  private log(ev: ReplayEventBody): void {
    if (!this.recording) return;
    const time = this.ctx.time;
    this.events.push({ ...ev, tau: time.replayClock, w: time.worldElapsed });
    this.dirty = true;
  }

  /** Called once per simulated frame, after every system has updated. */
  sample(force = false): void {
    if (!this.recording) return;
    const ctx = this.ctx;
    const time = ctx.time;
    const player = ctx.player;

    // Glass has no event of its own; detect panes that have just broken.
    const glass = ctx.level.glass;
    for (let i = 0; i < glass.length; i++) {
      if (this.glassAlive[i] && !glass[i].alive) {
        this.glassAlive[i] = false;
        this.log({ k: 'glass', index: i });
      }
    }

    const tau = time.replayClock;
    const turned = Math.abs(player.yaw - this.lastYaw) + Math.abs(player.pitch - this.lastPitch) > TURN_THRESHOLD;
    if (!force && !this.dirty && !turned && this.lastTau >= 0 && tau - this.lastTau < SAMPLE_INTERVAL) return;
    this.lastTau = tau;
    this.lastYaw = player.yaw;
    this.lastPitch = player.pitch;
    this.dirty = false;

    const figs: FigSample[] = [];
    for (const e of ctx.director.enemies) {
      if (!e.alive) continue;
      figs.push({ id: e.id, kind: e.kind, weapon: e.weapon ? e.weapon.kind : null, pose: { ...e.pose } });
    }

    ctx.projectiles.fillVisuals(this.visuals);
    const bullets: BulletSample[] = [];
    const active = ctx.projectiles.active;
    for (let i = 0; i < active.length; i++) bullets.push({ ...this.visuals[i], id: active[i].id });

    const props: PropSample[] = [];
    for (const item of ctx.level.items) {
      const o = item.object;
      props.push({
        id: item.id,
        kind: item.kind ?? 'orb',
        radius: item.radius,
        x: o.position.x,
        y: o.position.y,
        z: o.position.z,
        rx: o.rotation.x,
        ry: o.rotation.y,
        rz: o.rotation.z,
      });
    }
    for (const t of ctx.thrown.objects) {
      const o = t.object;
      props.push({
        id: PROP_ID_THROWN + t.id,
        kind: t.kind ?? 'orb',
        radius: t.radius,
        x: o.position.x,
        y: o.position.y,
        z: o.position.z,
        rx: o.rotation.x,
        ry: o.rotation.y,
        rz: o.rotation.z,
      });
    }

    this.frames.push({
      tau,
      w: time.worldElapsed,
      scale: time.scale,
      phase: time.borrowPhase,
      player: {
        x: player.pos.x,
        y: player.pos.y,
        z: player.pos.z,
        yaw: player.yaw,
        pitch: player.pitch,
        stride: player.stride,
        grounded: player.grounded,
        fov: ctx.camera.fov,
        view: { ...player.view },
      },
      figs,
      bullets,
      props,
    });

    // Memory bound: thin out the oldest half rather than losing the ending.
    if (this.frames.length > MAX_FRAMES) {
      const half = this.frames.length >> 1;
      const kept: Frame[] = [];
      for (let i = 0; i < half; i += 2) kept.push(this.frames[i]);
      this.frames = kept.concat(this.frames.slice(half));
    }
  }
}
