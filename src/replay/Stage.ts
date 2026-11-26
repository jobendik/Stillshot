import { type Object3D, Vector3 } from 'three';
import type { GameContext } from '@/core/Context';
import type { BorrowPhase } from '@/core/Time';
import type { BulletVisual } from '@/fx/Bullets';
import { crystalFor } from '@/fx/Crystal';
import { type FigurePose, FigureRig, neutralPose } from '@/fx/Rig';
import { buildThrowableModel, buildWeaponModel } from '@/fx/Models';
import { PLAYER_EYE_HEIGHT, PLAYER_MOVE_SPEED, SHARD_LIFETIME } from '@/config/constants';
import { clamp } from '@/core/math';
import { type CineMode, CineCamera, type CineSubject, type Edit, SHOT_LABEL, type Shot, buildEdit } from './Cine';
import type { BulletSample, FigSample, Frame, PlayerSample, Recording, ReplayEvent } from './Recorder';

const POSE_KEYS: Array<keyof FigurePose> = ['x', 'y', 'z', 'walk', 'move', 'aim', 'aimPitch', 'strike', 'stagger', 'recoil', 'clock', 'develop', 'flash'];

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * t;
}

/**
 * Plays a recording back.
 *
 * Nothing is simulated here. Figures are the real rigs, posed from recorded
 * poses; rounds are drawn by the real bullet renderer from recorded positions;
 * shatters are the recorded burst specs fed back to the real shard system and
 * driven by the recorded world clock; sounds are the recorded sound triggers.
 * The only new thing is where the camera stands (see Cine.ts).
 *
 * Because every visual is a pure function of the timeline position, playback
 * can pause, scrub and restart: seeking rebuilds effect state from the event
 * log rather than trying to run anything backwards.
 */
export class ReplayStage {
  readonly edit: Edit;
  readonly cine: CineCamera;
  readonly recording: Recording;
  tau = 0;
  paused = false;
  /** Current playback rate (for audio pitch and the HUD). */
  rate = 1;
  /** World clock for shaders at the current instant. */
  worldTime = 0;
  phase: BorrowPhase = 'idle';
  /** Seconds into the closing orbit (0 while the timeline is still running). */
  outroT = 0;

  private readonly ctx: GameContext;
  private readonly figures = new Map<number, FigureRig>();
  private readonly props = new Map<number, Object3D>();
  private readonly avatar: FigureRig;
  private eventCursor = 0;
  private readonly visuals: BulletVisual[] = [];
  private curBullets: BulletSample[] = [];
  private readonly head = new Vector3();
  private readonly tmpPose = neutralPose();
  private currentShot: Shot | null = null;
  private readonly subject: CineSubject;
  private readonly seen = new Set<number>();
  private readonly bulletOut = { pos: new Vector3(), dir: new Vector3() };

  constructor(ctx: GameContext, recording: Recording) {
    this.ctx = ctx;
    this.recording = recording;
    const reduced = ctx.settings.values.reducedMotion;
    this.edit = buildEdit(recording, ctx.level, reduced);
    this.cine = new CineCamera(ctx.level, this.edit, ctx.settings.values.fov);
    this.avatar = new FigureRig('player', crystalFor('ink', false));
    this.avatar.root.visible = false;
    ctx.scene.add(this.avatar.root);
    this.subject = {
      head: this.head,
      yaw: 0,
      pitch: 0,
      fov: ctx.settings.values.fov,
      bullet: (id) => {
        for (const b of this.curBullets) {
          if (b.id === id) {
            this.bulletOut.pos.set(b.x, b.y, b.z);
            this.bulletOut.dir.set(b.dx, b.dy, b.dz);
            return this.bulletOut;
          }
        }
        return null;
      },
    };
    this.rebuildTo(0);
  }

  get duration(): number {
    return this.edit.duration;
  }

  get progress(): number {
    return this.duration > 0 ? clamp(this.tau / this.duration, 0, 1) : 1;
  }

  /** True once the closing orbit has run its course. */
  get finished(): boolean {
    return this.outroT >= this.edit.outro;
  }

  get shotLabel(): string {
    return this.currentShot ? SHOT_LABEL[this.currentShot.type] : '';
  }

  setMode(mode: CineMode): void {
    this.cine.mode = mode;
    this.cine.cut();
  }

  restart(): void {
    this.seek(0);
    this.paused = false;
  }

  /** Jump to a point on the timeline. */
  seek(tau: number): void {
    this.tau = clamp(tau, 0, this.duration);
    this.outroT = 0;
    this.rebuildTo(this.tau);
    this.cine.cut();
  }

  /** Skip straight to the closing tableau. */
  skipToEnd(): void {
    this.seek(this.duration);
    this.outroT = Math.max(this.outroT, 0.01);
  }

  // ---- frame lookup -----------------------------------------------------

  private frameIndex(tau: number): number {
    const frames = this.recording.frames;
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].tau <= tau) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  // ---- events -----------------------------------------------------------

  private fire(ev: ReplayEvent): void {
    switch (ev.k) {
      case 'fx':
        this.ctx.fx.play(ev.ev);
        break;
      case 'snd':
        this.ctx.audio.play(ev.name, ev.pos ? { x: ev.pos[0], y: ev.pos[1], z: ev.pos[2] } : null, ev.param);
        break;
      case 'glass':
        this.ctx.level.setGlassVisible(ev.index, false);
        break;
      default:
        break;
    }
  }

  /** Reconstruct effect state at `tau` from the event log (used by seek / restart). */
  private rebuildTo(tau: number): void {
    const ctx = this.ctx;
    ctx.fx.clear(true);
    for (let i = 0; i < ctx.level.glass.length; i++) ctx.level.setGlassVisible(i, true);
    const frames = this.recording.frames;
    const w = frames.length > 0 ? frames[this.frameIndex(tau)].w : 0;
    const events = this.recording.events;
    let i = 0;
    for (; i < events.length && events[i].tau <= tau; i++) {
      const ev = events[i];
      if (ev.k === 'glass') ctx.level.setGlassVisible(ev.index, false);
      else if (ev.k === 'fx' && ev.ev.k === 'burst') {
        // Only debris that would still be on screen is regenerated.
        if (w - ev.ev.spec.start < (ev.ev.spec.life ?? SHARD_LIFETIME)) ctx.fx.play(ev.ev);
      }
    }
    this.eventCursor = i;
  }

  // ---- per-frame --------------------------------------------------------

  /** Advance playback by one rendered frame and pose everything. */
  update(realDt: number): void {
    const frames = this.recording.frames;
    if (frames.length === 0) {
      this.outroT += realDt;
      return;
    }
    const inOutro = this.tau >= this.duration;
    if (!this.paused) {
      if (inOutro) {
        this.outroT += realDt;
        this.rate = 0.06;
      } else {
        this.rate = this.cine.rateAt(this.tau);
        this.tau = Math.min(this.duration, this.tau + realDt * this.rate);
      }
    }

    const events = this.recording.events;
    while (this.eventCursor < events.length && events[this.eventCursor].tau <= this.tau) {
      this.fire(events[this.eventCursor++]);
    }

    // Bracket and interpolate.
    const i = this.frameIndex(this.tau);
    const a = frames[i];
    const b = frames[Math.min(i + 1, frames.length - 1)];
    const span = b.tau - a.tau;
    const alpha = span > 1e-6 ? clamp((this.tau - a.tau) / span, 0, 1) : 0;
    const near = alpha < 0.5 ? a : b;

    this.worldTime = a.w + (b.w - a.w) * alpha + this.outroT * 0.06;
    this.phase = near.phase;

    this.posePlayer(a.player, b.player, alpha, span);
    this.poseFigures(a, b, alpha);
    this.poseProps(a, b, alpha);
    this.poseBullets(a, b, alpha);

    // Camera.
    const shot = this.cine.shotAt(this.tau, this.tau >= this.duration && this.outroT > 0);
    this.currentShot = shot;
    const fp = this.cine.isFirstPerson(shot);
    this.avatar.root.visible = !fp;
    this.ctx.player.viewmodel.group.visible = fp;
    if (fp) this.ctx.player.viewmodel.apply(near.player.view);
    this.cine.update(this.ctx.camera, shot, this.subject, this.tau, realDt, this.outroT);
  }

  private posePlayer(a: PlayerSample, b: PlayerSample, t: number, span: number): void {
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    // A transfer is a discontinuity, not a very fast run.
    const jumped = Math.hypot(b.x - a.x, b.z - a.z) > 2.5;
    const src = jumped ? (t < 0.5 ? a : b) : null;
    this.head.set(src ? src.x : x, (src ? src.y : y) + PLAYER_EYE_HEIGHT, src ? src.z : z);
    this.subject.yaw = src ? src.yaw : lerpAngle(a.yaw, b.yaw, t);
    this.subject.pitch = src ? src.pitch : a.pitch + (b.pitch - a.pitch) * t;
    this.subject.fov = a.fov + (b.fov - a.fov) * t;

    const view = (t < 0.5 ? a : b).view;
    const p = this.tmpPose;
    p.x = this.head.x;
    p.y = this.head.y - PLAYER_EYE_HEIGHT;
    p.z = this.head.z;
    p.yaw = this.subject.yaw;
    const stride = a.stride + (b.stride - a.stride) * t;
    p.walk = stride * 3.4;
    const speed = span > 1e-4 && !jumped ? Math.hypot(b.x - a.x, b.z - a.z) / span / PLAYER_MOVE_SPEED : 0;
    const grounded = (t < 0.5 ? a : b).grounded;
    p.move += ((grounded ? clamp(speed, 0, 1) : 0.35) - p.move) * 0.25;
    const firearm = view.held === 'pistol' || view.held === 'rifle' || view.held === 'shotgun' || view.held === 'nailgun';
    p.aim = firearm ? 1 : 0;
    p.aimPitch = this.subject.pitch;
    p.strike = view.swing > 0 ? 1 + view.swing : 0;
    p.recoil = view.recoil;
    p.stagger = 0;
    p.develop = 1;
    p.flash = 0;
    this.avatar.setWeapon(view.held === 'orb' || view.held === 'fist' ? null : view.held);
    this.avatar.applyPose(p);
  }

  private poseFigures(a: Frame, b: Frame, t: number): void {
    const seen = this.seen;
    seen.clear();
    const apply = (fa: FigSample, fb: FigSample | undefined): void => {
      let rig = this.figures.get(fa.id);
      if (!rig) {
        rig = new FigureRig(
          fa.kind,
          crystalFor(fa.kind === 'constant' ? 'amber' : 'red', false),
          fa.kind === 'bulwark' ? crystalFor('white', false) : undefined,
        );
        this.ctx.scene.add(rig.root);
        this.figures.set(fa.id, rig);
      }
      const p = this.tmpFig;
      if (fb) {
        for (const key of POSE_KEYS) p[key] = fa.pose[key] + (fb.pose[key] - fa.pose[key]) * t;
        p.yaw = lerpAngle(fa.pose.yaw, fb.pose.yaw, t);
      } else {
        Object.assign(p, fa.pose);
      }
      rig.setWeapon((t < 0.5 || !fb ? fa : fb).weapon);
      rig.root.visible = true;
      rig.applyPose(p);
      seen.add(fa.id);
    };
    for (const fa of a.figs) {
      const fb = b.figs.find((f) => f.id === fa.id);
      // A figure missing from the next frame has died in between: hold it until the midpoint.
      if (!fb && t >= 0.5) continue;
      apply(fa, fb);
    }
    if (t >= 0.5) {
      for (const fb of b.figs) if (!seen.has(fb.id)) apply(fb, undefined);
    }
    for (const [id, rig] of this.figures) if (!seen.has(id)) rig.root.visible = false;
  }

  private readonly tmpFig = neutralPose();

  private poseProps(a: Frame, b: Frame, t: number): void {
    const seen = this.seen;
    seen.clear();
    const src = t < 0.5 ? a : b;
    for (const pa of src.props) {
      let obj = this.props.get(pa.id);
      if (!obj) {
        obj = pa.kind === 'orb' ? buildThrowableModel(pa.radius) : buildWeaponModel(pa.kind);
        this.ctx.scene.add(obj);
        this.props.set(pa.id, obj);
      }
      const other = (src === a ? b : a).props.find((p) => p.id === pa.id);
      if (other) {
        const pb = src === a ? other : pa;
        const p0 = src === a ? pa : other;
        obj.position.set(p0.x + (pb.x - p0.x) * t, p0.y + (pb.y - p0.y) * t, p0.z + (pb.z - p0.z) * t);
        obj.rotation.set(p0.rx + (pb.rx - p0.rx) * t, p0.ry + (pb.ry - p0.ry) * t, p0.rz + (pb.rz - p0.rz) * t);
      } else {
        obj.position.set(pa.x, pa.y, pa.z);
        obj.rotation.set(pa.rx, pa.ry, pa.rz);
      }
      obj.visible = true;
      seen.add(pa.id);
    }
    for (const [id, obj] of this.props) if (!seen.has(id)) obj.visible = false;
  }

  private poseBullets(a: Frame, b: Frame, t: number): void {
    const out: BulletSample[] = [];
    for (const ba of a.bullets) {
      const bb = b.bullets.find((x) => x.id === ba.id);
      if (bb) {
        out.push({
          ...ba,
          x: ba.x + (bb.x - ba.x) * t,
          y: ba.y + (bb.y - ba.y) * t,
          z: ba.z + (bb.z - ba.z) * t,
          dx: t < 0.5 ? ba.dx : bb.dx,
          dy: t < 0.5 ? ba.dy : bb.dy,
          dz: t < 0.5 ? ba.dz : bb.dz,
          trail: ba.trail + (bb.trail - ba.trail) * t,
          threat: 0,
        });
      } else if (t < 0.5) {
        out.push({ ...ba, threat: 0 });
      }
    }
    if (t >= 0.5) {
      for (const bb of b.bullets) if (!a.bullets.some((x) => x.id === bb.id)) out.push({ ...bb, threat: 0 });
    }
    this.curBullets = out;
  }

  /** Submit rounds to the renderers (call between streaks.begin() and end()). */
  draw(): void {
    this.visuals.length = 0;
    for (const b of this.curBullets) this.visuals.push(b);
    this.ctx.fx.bullets.draw(this.visuals, this.ctx.fx.streaks, 0, this.worldTime);
  }

  dispose(): void {
    for (const rig of this.figures.values()) rig.dispose();
    this.figures.clear();
    for (const obj of this.props.values()) this.ctx.scene.remove(obj);
    this.props.clear();
    this.avatar.dispose();
    this.ctx.fx.clear(true);
  }
}
