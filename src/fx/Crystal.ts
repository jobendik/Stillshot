import { Color, DoubleSide, FrontSide, ShaderMaterial, Vector3, Vector4 } from 'three';
import { GRAVITY } from '@/config/constants';

/**
 * The crystal material. One shader family draws every faceted solid in the
 * game — standing figures, the player's body, and the shards they break into —
 * so an intact body and its debris are literally the same surface.
 *
 * The SHARDS variant moves its vertices entirely on the GPU: every vertex
 * carries the centre, launch velocity, spin and release delay of the shard it
 * belongs to, and the vertex shader evaluates the ballistic arc (with one
 * bounce) as a closed-form function of world time. Nothing is integrated on the
 * CPU, a burst is one draw call, and — because position is a pure function of
 * the clock — a replay can show the identical fracture simply by setting the
 * clock.
 */

/** Uniforms shared by reference across every crystal material. */
export const CrystalGlobals = {
  uSunDir: { value: new Vector3(0.45, 0.82, 0.35).normalize() },
  /** World time (seconds). */
  uTime: { value: 0 },
  /** xz bounds shards are kept inside: minX, minZ, maxX, maxZ. */
  uBounds: { value: new Vector4(-100, -100, 100, 100) },
  uFloorY: { value: 0 },
};

const COMMON = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x), mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x), mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;

const VERT = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vObj;
  varying float vInterior;
  varying float vSeed;
  varying float vFade;

  #ifdef SHARDS
    attribute vec3 aCenter;
    attribute vec3 aVel;
    attribute vec4 aSpin;   // xyz axis, w angular speed
    attribute vec4 aData;   // x delay, y time-to-land, z interior flag, w seed
    uniform float uStart;
    uniform float uLife;
    uniform vec4 uBounds;
    uniform float uFloorY;
    const float G = ${GRAVITY.toFixed(1)};

    vec3 rotateAxis(vec3 v, vec3 axis, float angle) {
      float s = sin(angle);
      float c = cos(angle);
      return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
    }
  #endif

  void main() {
    #ifdef SHARDS
      float t = max(0.0, uTime - uStart - aData.x);
      float T1 = aData.y;
      float t1 = min(t, T1);
      vec3 c = aCenter + aVel * t1;
      c.y -= 0.5 * G * t1 * t1;
      float spinT = t1;
      if (t > T1) {
        // One bounce, then rest.
        float vyL = aVel.y - G * T1;
        vec3 v2 = vec3(aVel.x * 0.38, -vyL * 0.3, aVel.z * 0.38);
        float T2 = 2.0 * v2.y / G;
        float t2 = min(t - T1, T2);
        c += v2 * t2;
        c.y -= 0.5 * G * t2 * t2;
        spinT += t2 * 0.5;
      }
      c.xz = clamp(c.xz, uBounds.xy, uBounds.zw);
      c.y = max(c.y, uFloorY + 0.012);
      float fade = smoothstep(uLife - 1.6, uLife, t + aData.x);
      float angle = aSpin.w * spinT;
      vec3 local = rotateAxis(position - aCenter, aSpin.xyz, angle) * (1.0 - fade * 0.85);
      vec3 world = c + local;
      vNormal = rotateAxis(normal, aSpin.xyz, angle);
      vInterior = aData.z;
      vSeed = aData.w;
      vFade = fade;
      vObj = position;
      vWorld = world;
      gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    #else
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      vInterior = 0.0;
      vSeed = 0.0;
      vFade = 0.0;
      vObj = position;
      gl_Position = projectionMatrix * viewMatrix * w;
    #endif
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uGlow;
  uniform float uRim;
  uniform float uSpec;
  uniform float uDevelop;
  uniform float uFlash;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vObj;
  varying float vInterior;
  varying float vSeed;
  varying float vFade;
  ${COMMON}

  void main() {
    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorld);

    // Materialise / dissolve: a cellular front sweeps through the body.
    float cell = vnoise(vObj * 9.0 + vSeed * 7.0);
    float edge = 0.0;
    #ifndef SHARDS
      if (uDevelop < 0.999) {
        float front = uDevelop * 1.25 - 0.12;
        if (cell > front) discard;
        edge = smoothstep(front - 0.12, front, cell);
      }
    #else
      // Dither shards away at the end of their life (no blending, no sorting).
      if (vFade > 0.0 && hash31(vec3(gl_FragCoord.xy, vSeed)) < vFade) discard;
    #endif

    float ndl = max(dot(N, uSunDir), 0.0);
    float nv = max(dot(N, V), 0.0);
    float fres = pow(1.0 - nv, 3.0);
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(N, H), 0.0), 72.0);

    // Each facet gets its own cut: a stable hash of its normal.
    float facet = hash31(floor(N * 5.0 + 0.5) + vSeed * 13.0);
    vec3 col = uColor * (0.34 + 0.66 * ndl) * (0.8 + 0.4 * facet);

    // Light trapped inside: strongest on cut faces and where we look straight in.
    float inner = vInterior * 0.85 + nv * nv * 0.22;
    col += uCore * inner * uGlow * (0.75 + 0.5 * facet);

    // A cool sky bounce on upward faces and a hard rim keep the silhouette legible.
    col += vec3(0.9, 0.95, 1.0) * fres * uRim;
    col += vec3(1.0) * spec * uSpec;

    col += uCore * edge * 3.0;
    col = mix(col, vec3(1.6), uFlash);

    gl_FragColor = vec4(col, uOpacity);
  }
`;

export interface CrystalOptions {
  color: Color;
  core: Color;
  glow?: number;
  rim?: number;
  spec?: number;
  opacity?: number;
  shards?: boolean;
}

export function makeCrystalMaterial(opts: CrystalOptions): ShaderMaterial {
  const translucent = (opts.opacity ?? 1) < 1;
  const mat = new ShaderMaterial({
    uniforms: {
      uSunDir: CrystalGlobals.uSunDir,
      uTime: CrystalGlobals.uTime,
      uBounds: CrystalGlobals.uBounds,
      uFloorY: CrystalGlobals.uFloorY,
      uColor: { value: opts.color.clone() },
      uCore: { value: opts.core.clone() },
      uGlow: { value: opts.glow ?? 1 },
      uRim: { value: opts.rim ?? 0.35 },
      uSpec: { value: opts.spec ?? 0.9 },
      uDevelop: { value: 1 },
      uFlash: { value: 0 },
      uOpacity: { value: opts.opacity ?? 1 },
      uStart: { value: 0 },
      uLife: { value: 8 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: opts.shards ? { SHARDS: '' } : {},
    transparent: translucent,
    depthWrite: !translucent,
    side: translucent ? DoubleSide : FrontSide,
  });
  return mat;
}

/** The named looks. Colours are authored in sRGB and converted by three. */
export type CrystalTone = 'red' | 'amber' | 'ink' | 'glass' | 'white';

export function crystalFor(tone: CrystalTone, shards: boolean): ShaderMaterial {
  switch (tone) {
    case 'red':
      return makeCrystalMaterial({ color: new Color(0xe5122b), core: new Color(0xff4a2a), glow: 1.5, rim: 0.3, shards });
    case 'amber':
      return makeCrystalMaterial({ color: new Color(0xe5122b), core: new Color(0xffa23a), glow: 2.6, rim: 0.3, shards });
    case 'ink':
      return makeCrystalMaterial({ color: new Color(0x0c0c10), core: new Color(0x30323c), glow: 0.5, rim: 0.55, spec: 1.4, shards });
    case 'white':
      return makeCrystalMaterial({ color: new Color(0xe9eef2), core: new Color(0xffffff), glow: 0.5, rim: 0.5, spec: 1.6, shards });
    case 'glass':
    default:
      return makeCrystalMaterial({
        color: new Color(0x9fd0e6),
        core: new Color(0xffffff),
        glow: 0.5,
        rim: 0.9,
        spec: 2.2,
        opacity: 0.55,
        shards,
      });
  }
}
