import { BoxGeometry, type Group, Mesh, Quaternion, Vector3 } from 'three';
import type { GameContext } from '@/core/Context';
import { Materials } from '@/fx/Materials';
import { buildEnemyModel, disposeModelGeometry } from '@/fx/Models';

interface EnemySample {
  id: number;
  p: Vector3;
  q: Quaternion;
}

interface Frame {
  t: number; // world time at capture
  camPos: Vector3;
  camQuat: Quaternion;
  enemies: EnemySample[];
  bullets: Vector3[];
}

const SAMPLE_INTERVAL = 1 / 60; // capture every 1/60th of WORLD time (dead time is skipped)
const PLAYBACK_TAIL = 1.2; // seconds to linger after the last action
const MAX_FRAMES = 9000;

/**
 * Records the run against WORLD (scaled) time and replays it at a hard-locked
 * real-time 1.0 — condensing minutes of agonizing slow-motion deliberation into
 * a few seconds of fluid, superhuman action. Frames are only captured as world
 * time advances, so the long stretches where the player stood frozen are
 * naturally compressed out of the montage.
 */
export class ReplayRecorder {
  private readonly ctx: GameContext;
  private readonly uiRoot: HTMLElement;
  private frames: Frame[] = [];
  private recording = false;
  private lastSampleT = -1;

  // Playback state.
  private playing = false;
  private clock = 0;
  private maxT = 0;
  private ghostEnemies = new Map<number, Group>();
  private ghostBullets: Mesh[] = [];
  private overlay: HTMLDivElement | null = null;
  private flashTimer = 0;
  private flashOn = true;
  private speakTimer = 0;

  constructor(ctx: GameContext, uiRoot: HTMLElement) {
    this.ctx = ctx;
    this.uiRoot = uiRoot;
  }

  // ---- recording --------------------------------------------------------

  beginRecording(): void {
    this.frames = [];
    this.recording = true;
    this.lastSampleT = -1;
  }

  stopRecording(): void {
    this.recording = false;
  }

  /** Called every frame during play; captures only when world time advanced enough. */
  sample(): void {
    if (!this.recording || this.frames.length >= MAX_FRAMES) return;
    const t = this.ctx.time.worldElapsed;
    if (this.lastSampleT >= 0 && t - this.lastSampleT < SAMPLE_INTERVAL) return;
    this.lastSampleT = t;

    const cam = this.ctx.camera;
    const enemies: EnemySample[] = this.ctx.director.enemies
      .filter((e) => e.alive)
      .map((e) => ({
        id: e.id,
        p: e.pos.clone(),
        q: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), e.yaw),
      }));
    const bullets = this.ctx.projectiles.active.map((p) => p.pos.clone());

    this.frames.push({
      t,
      camPos: cam.position.clone(),
      camQuat: cam.quaternion.clone(),
      enemies,
      bullets,
    });
  }

  get frameCount(): number {
    return this.frames.length;
  }

  // ---- playback ---------------------------------------------------------

  beginPlayback(): boolean {
    this.recording = false;
    if (this.frames.length < 2) return false;
    this.playing = true;
    this.clock = 0;
    this.maxT = this.frames[this.frames.length - 1].t;

    // Build a ghost per unique enemy id seen across the run.
    const ids = new Set<number>();
    for (const f of this.frames) for (const e of f.enemies) ids.add(e.id);
    for (const id of ids) {
      const ghost = buildEnemyModel();
      ghost.visible = false;
      this.ctx.scene.add(ghost);
      this.ghostEnemies.set(id, ghost);
    }

    this.buildOverlay();
    return true;
  }

  /** Advance playback. Returns true when the montage is finished. */
  update(realDt: number): boolean {
    if (!this.playing) return true;
    this.clock += realDt;

    const tt = this.clock;
    const [a, b, alpha] = this.bracket(tt);

    // Camera (smoothed interpolation).
    const cam = this.ctx.camera;
    cam.position.lerpVectors(a.camPos, b.camPos, alpha);
    cam.quaternion.copy(a.camQuat).slerp(b.camQuat, alpha);

    // Enemy ghosts — drive by the nearest frame's set.
    const present = new Set<number>();
    const frame = alpha < 0.5 ? a : b;
    for (const e of frame.enemies) {
      const ghost = this.ghostEnemies.get(e.id);
      if (ghost) {
        ghost.visible = true;
        ghost.position.copy(e.p);
        ghost.quaternion.copy(e.q);
        present.add(e.id);
      }
    }
    for (const [id, ghost] of this.ghostEnemies) {
      if (!present.has(id)) ghost.visible = false;
    }

    // Bullet ghosts.
    this.syncBullets(frame.bullets);

    // SUPER / HOT flash + voice.
    this.flashTimer -= realDt;
    if (this.flashTimer <= 0) {
      this.flashTimer = 0.45;
      this.flashOn = !this.flashOn;
      if (this.overlay) this.overlay.textContent = this.flashOn ? 'SUPER' : 'HOT';
    }
    this.speakTimer -= realDt;
    if (this.speakTimer <= 0) {
      this.speakTimer = 1.6;
      this.ctx.audio.speak('super hot');
    }

    return this.clock >= this.maxT + PLAYBACK_TAIL;
  }

  private bracket(tt: number): [Frame, Frame, number] {
    const frames = this.frames;
    if (tt <= frames[0].t) return [frames[0], frames[0], 0];
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].t >= tt) {
        const a = frames[i - 1];
        const b = frames[i];
        const span = b.t - a.t;
        const alpha = span > 1e-6 ? (tt - a.t) / span : 0;
        return [a, b, Math.max(0, Math.min(1, alpha))];
      }
    }
    const last = frames[frames.length - 1];
    return [last, last, 0];
  }

  private syncBullets(positions: Vector3[]): void {
    while (this.ghostBullets.length < positions.length) {
      const m = new Mesh(new BoxGeometry(0.04, 0.04, 0.3), Materials.bullet);
      this.ctx.scene.add(m);
      this.ghostBullets.push(m);
    }
    for (let i = 0; i < this.ghostBullets.length; i++) {
      const m = this.ghostBullets[i];
      if (i < positions.length) {
        m.visible = true;
        m.position.copy(positions[i]);
      } else {
        m.visible = false;
      }
    }
  }

  private buildOverlay(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'replay-overlay';
    this.overlay.textContent = 'SUPER';
    this.uiRoot.appendChild(this.overlay);
    this.flashTimer = 0.45;
    this.flashOn = true;
    this.speakTimer = 0.2;
  }

  endPlayback(): void {
    this.playing = false;
    for (const ghost of this.ghostEnemies.values()) {
      disposeModelGeometry(ghost);
      this.ctx.scene.remove(ghost);
    }
    this.ghostEnemies.clear();
    for (const m of this.ghostBullets) {
      m.geometry.dispose();
      this.ctx.scene.remove(m);
    }
    this.ghostBullets.length = 0;
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
