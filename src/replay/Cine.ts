import { type PerspectiveCamera, Vector3 } from 'three';
import type { Level } from '@/world/Level';
import type { KillCause } from '@/core/events';
import { clamp, damp, smoothstep } from '@/core/math';
import type { Frame, Recording } from './Recorder';

/**
 * The automatic cinematographer.
 *
 * Given a finished recording it cuts an edit before playback starts: a list of
 * shots covering the whole timeline, plus a speed curve. It never invents or
 * moves anything — every shot is a different place to stand while the recorded
 * run plays out. What it decides:
 *
 *   WHERE TO LOOK FROM
 *     first person  the player's own view (smoothed).
 *     pursuit       over the shoulder of the player's body.
 *     witness       a fixed high corner chosen to see both the player and the
 *                   target, panning to keep them framed.
 *     round         riding just behind the bullet that makes a kill, when its
 *                   flight is long enough to follow.
 *     impact        beside the victim, off the line of attack, so the debris
 *                   crosses the frame.
 *     still         the closing orbit around the last figure to fall, with the
 *                   world all but stopped.
 *
 *   WHEN TO SLOW DOWN
 *     Playback is real-time, with a short dip into slow motion on each kill and
 *     a long one on the last. Long uneventful stretches run slightly fast.
 *
 * Kills are found from recorded kill events; the bullet responsible is found by
 * looking at the recorded rounds in the frame before the kill.
 */

export type ShotType = 'fp' | 'chase' | 'wide' | 'round' | 'impact' | 'orbit';

export const SHOT_LABEL: Record<ShotType, string> = {
  fp: 'first person',
  chase: 'pursuit',
  wide: 'witness',
  round: 'round',
  impact: 'impact',
  orbit: 'still',
};

export interface Shot {
  type: ShotType;
  t0: number;
  t1: number;
  /** What the shot is about (a kill position), if anything. */
  focus?: Vector3;
  bulletId?: number;
  /** Fixed camera position for static shots. */
  camPos?: Vector3;
}

export interface KillMark {
  tau: number;
  pos: Vector3;
  cause: KillCause;
  bulletId: number | null;
  /** Timeline seconds the killing round spent in the air. */
  flight: number;
  spawnTau: number;
}

export interface Edit {
  shots: Shot[];
  kills: KillMark[];
  duration: number;
  baseRate: number;
  /** Seconds of closing orbit after the timeline ends. */
  outro: number;
}

export type CineMode = 'director' | 'first' | 'pursuit';

const ORBIT_TIME = 4.2;

function frameIndexAt(frames: Frame[], tau: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].tau <= tau) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function findKills(rec: Recording): KillMark[] {
  const kills: KillMark[] = [];
  const frames = rec.frames;
  for (const ev of rec.events) {
    if (ev.k !== 'kill') continue;
    const pos = new Vector3(ev.x, ev.y, ev.z);
    const mark: KillMark = { tau: ev.tau, pos, cause: ev.cause, bulletId: null, flight: 0, spawnTau: ev.tau };
    const byBullet = ev.cause !== 'melee' && ev.cause !== 'thrown' && ev.cause !== 'transfer';
    if (byBullet && frames.length > 1) {
      // The round that did it is the nearest one in the last frame before the kill.
      let i = frameIndexAt(frames, ev.tau);
      while (i > 0 && frames[i].tau >= ev.tau) i--;
      let best = -1;
      let bestD = 3.2 * 3.2;
      for (const b of frames[i].bullets) {
        const dx = b.x - pos.x;
        const dy = b.y - pos.y;
        const dz = b.z - pos.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = b.id;
        }
      }
      if (best >= 0) {
        mark.bulletId = best;
        let j = i;
        while (j > 0 && frames[j - 1].bullets.some((b) => b.id === best)) j--;
        mark.spawnTau = frames[j].tau;
        mark.flight = ev.tau - mark.spawnTau;
      }
    }
    kills.push(mark);
  }
  return kills;
}

/** Cut the edit for a recording. Deterministic: the same run always gets the same film. */
export function buildEdit(rec: Recording, level: Level, reducedMotion: boolean): Edit {
  const kills = findKills(rec);
  const duration = rec.duration;
  const frames = rec.frames;
  const playerAt = (tau: number): Vector3 => {
    const f = frames[frameIndexAt(frames, tau)];
    return new Vector3(f.player.x, f.player.y + 1.2, f.player.z);
  };

  // 1. A shot for every kill.
  const killShots: Shot[] = [];
  let alt = 0;
  for (let i = 0; i < kills.length; i++) {
    const k = kills[i];
    const last = i === kills.length - 1;
    const tail = last ? 0.9 : 0.5;
    let shot: Shot;
    if (!reducedMotion && k.bulletId !== null && k.flight >= 0.2) {
      shot = { type: 'round', t0: k.spawnTau - 0.04, t1: k.tau + tail, focus: k.pos, bulletId: k.bulletId };
    } else if (k.cause === 'melee' || k.cause === 'thrown' || k.cause === 'transfer') {
      shot = { type: reducedMotion ? 'wide' : 'chase', t0: k.tau - 0.8, t1: k.tau + tail, focus: k.pos };
    } else {
      shot = { type: alt++ % 2 === 0 ? 'impact' : 'wide', t0: k.tau - 0.55, t1: k.tau + tail, focus: k.pos };
    }
    shot.t0 = Math.max(0, shot.t0);
    shot.t1 = Math.min(duration, shot.t1);
    killShots.push(shot);
  }

  // 2. Resolve overlaps: quick successive kills share one shot.
  const merged: Shot[] = [];
  for (const s of killShots) {
    const prev = merged[merged.length - 1];
    if (prev && s.t0 < prev.t1) {
      if (s.t1 - prev.t1 < 0.6) {
        prev.t1 = Math.max(prev.t1, s.t1);
        // Several kills in one beat read best from a distance.
        if (prev.type === 'impact') prev.type = 'wide';
        continue;
      }
      s.t0 = prev.t1;
    }
    merged.push(s);
  }

  // 3. Fill everything else with alternating coverage.
  const shots: Shot[] = [];
  let cursor = 0;
  let cover = 0;
  const fill = (from: number, to: number): void => {
    let t = from;
    while (to - t > 0.05) {
      const remaining = to - t;
      const len = remaining < 5.5 ? remaining : 3.6;
      let type: ShotType;
      if (shots.length === 0 && !reducedMotion) type = 'wide'; // establishing shot
      else type = cover++ % 2 === 0 ? 'fp' : reducedMotion ? 'wide' : 'chase';
      const tEnd = shots.length === 0 ? Math.min(to, t + Math.min(len, 1.8)) : t + len;
      shots.push({ type, t0: t, t1: tEnd });
      t = tEnd;
    }
  };
  for (const s of merged) {
    if (s.t0 - cursor > 0.8) fill(cursor, s.t0);
    else if (shots.length > 0) shots[shots.length - 1].t1 = s.t0;
    else s.t0 = 0;
    shots.push(s);
    cursor = s.t1;
  }
  if (duration - cursor > 0.8 || shots.length === 0) fill(cursor, duration);
  else shots[shots.length - 1].t1 = duration;

  // 4. Place the static cameras.
  for (const s of shots) {
    const mid = (s.t0 + s.t1) / 2;
    if (s.type === 'wide') {
      s.camPos = pickWitness(level, playerAt(mid), s.focus ?? playerAt(s.t1));
    } else if (s.type === 'impact' && s.focus) {
      const cam = pickImpact(level, playerAt(s.t0 + 0.5), s.focus);
      if (cam) s.camPos = cam;
      else {
        s.type = 'wide';
        s.camPos = pickWitness(level, playerAt(mid), s.focus);
      }
    }
  }

  // Long runs are tightened so the film stays a film.
  const baseRate = clamp(duration / 55, 1, 2.2);
  return { shots, kills, duration, baseRate, outro: reducedMotion ? 2.2 : ORBIT_TIME };
}

function visible(level: Level, from: Vector3, to: Vector3): boolean {
  const d = new Vector3().subVectors(to, from);
  const len = d.length();
  if (len < 1e-3) return true;
  return level.rayToSolid(from, d.multiplyScalar(1 / len), len) >= len - 0.05;
}

/** Choose a high fixed vantage that sees both subjects, preferring a side-on view. */
function pickWitness(level: Level, a: Vector3, b: Vector3): Vector3 {
  const bd = level.bounds;
  const inset = 1.1;
  const xs = [bd.minX + inset, (bd.minX + bd.maxX) / 2, bd.maxX - inset];
  const zs = [bd.minZ + inset, (bd.minZ + bd.maxZ) / 2, bd.maxZ - inset];
  let best = new Vector3(xs[0], level.floorY + 3.2, zs[0]);
  let bestScore = -Infinity;
  const ab = new Vector3().subVectors(b, a);
  const cam = new Vector3();
  const mid = new Vector3().addVectors(a, b).multiplyScalar(0.5);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === 1 && j === 1) continue;
      cam.set(xs[i], level.floorY + (i === 1 || j === 1 ? 2.5 : 3.3), zs[j]);
      let score = 0;
      if (visible(level, cam, a)) score += 2.2;
      if (visible(level, cam, b)) score += 2.2;
      const d = cam.distanceTo(mid);
      score -= Math.abs(d - 10) * 0.12;
      // Side-on: the line between the subjects should cross the view, not point down it.
      const toMid = new Vector3().subVectors(mid, cam).normalize();
      if (ab.lengthSq() > 0.25) score += (1 - Math.abs(toMid.dot(ab.clone().normalize()))) * 1.3;
      if (d < 3) score -= 3;
      if (score > bestScore) {
        bestScore = score;
        best = cam.clone();
      }
    }
  }
  return best;
}

/** A close position beside the victim, off the attack axis, with a clear view. */
function pickImpact(level: Level, attacker: Vector3, victim: Vector3): Vector3 | null {
  const dir = new Vector3(victim.x - attacker.x, 0, victim.z - attacker.z);
  if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
  dir.normalize();
  const bd = level.bounds;
  for (const [angle, dist] of [
    [0.9, 2.9],
    [-0.9, 2.9],
    [1.5, 3.0],
    [-1.5, 3.0],
    [0.5, 2.4],
    [-0.5, 2.4],
  ]) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Stand on the attacker's side of the victim, rotated off-axis.
    const cam = new Vector3(victim.x - (dir.x * c - dir.z * s) * dist, level.floorY + 1.3, victim.z - (dir.x * s + dir.z * c) * dist);
    if (cam.x < bd.minX + 0.5 || cam.x > bd.maxX - 0.5 || cam.z < bd.minZ + 0.5 || cam.z > bd.maxZ - 0.5) continue;
    if (visible(level, cam, victim)) return cam;
  }
  return null;
}

/** What the stage tells the camera about the current instant. */
export interface CineSubject {
  head: Vector3;
  yaw: number;
  pitch: number;
  fov: number;
  /** Position & direction of a tracked round, if it exists right now. */
  bullet: (id: number) => { pos: Vector3; dir: Vector3 } | null;
}

const _fwd = new Vector3();
const _right = new Vector3();
const _want = new Vector3();
const _look = new Vector3();
const _d = new Vector3();

/** Evaluates the edit: owns the replay camera's smoothing state. */
export class CineCamera {
  mode: CineMode = 'director';
  private readonly level: Level;
  private readonly edit: Edit;
  private readonly baseFov: number;
  private shotIndex = -1;
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private fov = 70;
  private fresh = true;
  private readonly lastHead = new Vector3();
  private readonly lastBullet = new Vector3();
  private readonly lastBulletDir = new Vector3(0, 0, -1);
  private yawS = 0;
  private pitchS = 0;
  private lastMode: CineMode = 'director';

  constructor(level: Level, edit: Edit, baseFov: number) {
    this.level = level;
    this.edit = edit;
    this.baseFov = baseFov;
  }

  shotAt(tau: number, outro: boolean): Shot {
    if (outro) {
      const last = this.edit.kills[this.edit.kills.length - 1];
      return { type: 'orbit', t0: this.edit.duration, t1: this.edit.duration + this.edit.outro, focus: last?.pos };
    }
    const shots = this.edit.shots;
    let i = clamp(this.shotIndex, 0, shots.length - 1);
    while (i < shots.length - 1 && tau >= shots[i].t1) i++;
    while (i > 0 && tau < shots[i].t0) i--;
    this.shotIndexNext = i;
    const s = shots[i];
    if (this.mode === 'first') return { ...s, type: 'fp' };
    if (this.mode === 'pursuit') return { ...s, type: 'chase' };
    return s;
  }

  private shotIndexNext = 0;

  /** Playback speed multiplier at a point on the timeline. */
  rateAt(tau: number): number {
    let rate = this.edit.baseRate;
    const kills = this.edit.kills;
    for (let i = 0; i < kills.length; i++) {
      const k = kills[i];
      const last = i === kills.length - 1;
      const depth = last ? 0.1 : 0.32;
      const pre = 0.07;
      const post = last ? 0.55 : 0.2;
      const dt = tau - k.tau;
      let w = 0;
      if (dt < 0) w = 1 - smoothstep(pre, pre + 0.25, -dt);
      else w = 1 - smoothstep(post, post + 0.35, dt);
      rate = Math.min(rate, this.edit.baseRate + (depth - this.edit.baseRate) * w);
    }
    return rate;
  }

  /** Does this shot show the first-person hands (vs. the player's body)? */
  isFirstPerson(shot: Shot): boolean {
    return shot.type === 'fp';
  }

  /** Force the next update to cut rather than ease. */
  cut(): void {
    this.fresh = true;
  }

  update(camera: PerspectiveCamera, shot: Shot, subject: CineSubject, tau: number, realDt: number, outroT: number): void {
    const cutNow = this.fresh || this.shotIndexNext !== this.shotIndex || this.mode !== this.lastMode || subject.head.distanceTo(this.lastHead) > 3;
    this.shotIndex = this.shotIndexNext;
    this.lastMode = this.mode;
    this.lastHead.copy(subject.head);
    this.fresh = false;

    const cp = Math.cos(subject.pitch);
    _fwd.set(-Math.sin(subject.yaw) * cp, Math.sin(subject.pitch), -Math.cos(subject.yaw) * cp);
    _right.set(Math.cos(subject.yaw), 0, -Math.sin(subject.yaw));
    let wantFov = 60;
    let posRate = 8;
    let lookRate = 10;

    switch (shot.type) {
      case 'fp': {
        // Whip-pans instead of teleports: follow the recorded view through a short filter.
        if (cutNow) {
          this.yawS = subject.yaw;
          this.pitchS = subject.pitch;
        } else {
          const k = damp(26, realDt);
          let dy = subject.yaw - this.yawS;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          this.yawS += dy * k;
          this.pitchS += (subject.pitch - this.pitchS) * k;
        }
        camera.position.copy(subject.head);
        camera.rotation.set(this.pitchS, this.yawS, 0, 'YXZ');
        this.pos.copy(subject.head);
        this.setFov(camera, subject.fov, true, realDt);
        return;
      }
      case 'chase': {
        _d.set(_fwd.x, 0, _fwd.z).normalize();
        _want.copy(subject.head).addScaledVector(_d, -3.1).addScaledVector(_right, 0.8);
        _want.y += 0.45;
        _look.copy(subject.head).addScaledVector(_d, 5).addScaledVector(_fwd, 1.5);
        _look.y -= 0.25;
        wantFov = 62;
        posRate = 7;
        lookRate = 9;
        this.pullIn(subject.head, _want);
        break;
      }
      case 'wide': {
        _want.copy(shot.camPos ?? subject.head);
        _look.copy(subject.head);
        if (shot.focus) _look.lerp(shot.focus, 0.5);
        wantFov = 46 - clamp((tau - shot.t0) / Math.max(0.5, shot.t1 - shot.t0), 0, 1) * 4;
        posRate = 100;
        lookRate = 3.5;
        break;
      }
      case 'impact': {
        _want.copy(shot.camPos ?? subject.head);
        _look.copy(shot.focus ?? subject.head);
        wantFov = 44 - clamp((tau - shot.t0) / Math.max(0.5, shot.t1 - shot.t0), 0, 1) * 5;
        posRate = 100;
        lookRate = 100;
        break;
      }
      case 'round': {
        const b = shot.bulletId !== undefined ? subject.bullet(shot.bulletId) : null;
        if (b) {
          this.lastBullet.copy(b.pos);
          this.lastBulletDir.copy(b.dir);
        } else if (cutNow && shot.focus) {
          this.lastBullet.copy(shot.focus);
        }
        const dir = this.lastBulletDir;
        _right.set(-dir.z, 0, dir.x).normalize();
        _want.copy(this.lastBullet).addScaledVector(dir, -1.15).addScaledVector(_right, 0.3);
        _want.y += 0.2;
        _look.copy(this.lastBullet).addScaledVector(dir, 4);
        if (!b && shot.focus) _look.copy(shot.focus);
        wantFov = 72;
        posRate = b ? 60 : 2.5;
        lookRate = b ? 40 : 5;
        break;
      }
      case 'orbit': {
        const c = shot.focus ?? subject.head;
        const a = 0.6 + outroT * 0.34;
        _want.set(c.x + Math.cos(a) * 4.3, this.level.floorY + 1.75, c.z + Math.sin(a) * 4.3);
        this.clampToBounds(_want);
        _look.set(c.x, c.y + 0.1, c.z);
        wantFov = 44;
        posRate = cutNow ? 100 : 6;
        lookRate = 8;
        break;
      }
    }

    this.clampToBounds(_want);
    if (cutNow) {
      this.pos.copy(_want);
      this.look.copy(_look);
    } else {
      this.pos.lerp(_want, damp(posRate, realDt));
      this.look.lerp(_look, damp(lookRate, realDt));
    }
    camera.position.copy(this.pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.look);
    this.setFov(camera, wantFov, cutNow, realDt);
  }

  private setFov(camera: PerspectiveCamera, fov: number, snap: boolean, dt: number): void {
    this.fov = snap ? fov : this.fov + (fov - this.fov) * damp(5, dt);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }

  get defaultFov(): number {
    return this.baseFov;
  }

  private clampToBounds(p: Vector3): void {
    const b = this.level.bounds;
    p.x = clamp(p.x, b.minX + 0.35, b.maxX - 0.35);
    p.z = clamp(p.z, b.minZ + 0.35, b.maxZ - 0.35);
    p.y = Math.max(p.y, this.level.floorY + 0.35);
  }

  /** Keep a following camera from ending up behind a wall. */
  private pullIn(anchor: Vector3, cam: Vector3): void {
    _d.subVectors(cam, anchor);
    const len = _d.length();
    if (len < 1e-3) return;
    _d.multiplyScalar(1 / len);
    const hit = this.level.rayToSolid(anchor, _d, len + 0.3);
    if (hit < len + 0.3) cam.copy(anchor).addScaledVector(_d, Math.max(0.4, hit - 0.3));
  }
}
