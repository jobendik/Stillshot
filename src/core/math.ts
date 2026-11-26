import { Vector3 } from 'three';

/** Forward direction for a yaw angle (yaw 0 looks down -Z). */
export function forwardFromYaw(yaw: number, out = new Vector3()): Vector3 {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

/** Rightward direction for a yaw angle. */
export function rightFromYaw(yaw: number, out = new Vector3()): Vector3 {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

/** Yaw angle that faces a given horizontal direction. */
export function yawFromDir(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

export const clamp = (v: number, a: number, b: number): number =>
  Math.max(a, Math.min(b, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest signed angular difference b - a, wrapped to [-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach factor. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
