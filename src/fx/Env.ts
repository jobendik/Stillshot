import {
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { PALETTE } from '@/config/palette';

/**
 * Environment surfaces. The world stays paper-white and matte — it is the page
 * the action is drawn on — but it is not blank: surfaces carry fine panel seams
 * (so scale and distance read at a glance) and the floor carries the game's
 * clock. Concentric rings spread out from where you stand at a fixed speed in
 * WORLD time: stand still and they hold; move and they flow; borrow time and
 * they stop dead. You can read the time scale off the floor without a HUD.
 */
export const EnvGlobals = {
  uWorldTime: { value: 0 },
  uRealTime: { value: 0 },
  uPlayer: { value: new Vector3() },
  /** 0..1 strength of the floor clock. */
  uClock: { value: 1 },
};

export type EnvTone = 'white' | 'light' | 'grey' | 'dark' | 'ink' | 'red';

const TONES: Record<EnvTone, Color> = {
  white: PALETTE.envWhite,
  light: PALETTE.envLight,
  grey: PALETTE.envGrey,
  dark: PALETTE.envDarkGrey,
  ink: new Color(0x17171b),
  red: PALETTE.enemyRed,
};

const cache = new Map<string, MeshStandardMaterial>();

/**
 * A lit, shadow-receiving standard material with world-space panel seams
 * injected. `floor` adds the clock rings.
 */
export function envMaterial(tone: EnvTone, floor = false): MeshStandardMaterial {
  const key = `${tone}:${floor ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const mat = new MeshStandardMaterial({ color: TONES[tone], roughness: floor ? 0.86 : 0.93, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWorldTime = EnvGlobals.uWorldTime;
    shader.uniforms.uPlayer = EnvGlobals.uPlayer;
    shader.uniforms.uClock = EnvGlobals.uClock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        uniform float uWorldTime;
        uniform vec3 uPlayer;
        uniform float uClock;
        float seamLine(vec2 uv, float cell, float width) {
          vec2 g = abs(fract(uv / cell - 0.5) - 0.5) * cell;
          vec2 w = fwidth(uv) * 1.2;
          vec2 l = 1.0 - smoothstep(vec2(width) , vec2(width) + w, g);
          float fade = clamp(0.035 / max(w.x, w.y), 0.0, 1.0);
          return max(l.x, l.y) * fade;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 an = abs(vWNrm);
          vec2 uv = an.y > 0.5 ? vWPos.xz : (an.x > 0.5 ? vWPos.zy : vWPos.xy);
          float seam = seamLine(uv, ${floor ? '2.0' : '1.5'}, 0.006);
          diffuseColor.rgb *= 1.0 - seam * 0.2;
          ${
            floor
              ? `
          float fine = seamLine(uv, 0.5, 0.003);
          diffuseColor.rgb *= 1.0 - fine * 0.06;
          // The clock: rings leaving the player at 2 m per world-second.
          float d = length(vWPos.xz - uPlayer.xz);
          float ph = fract((d - uWorldTime * 2.0) / 2.5);
          float wr = fwidth(d) / 2.5;
          float ring = (1.0 - smoothstep(0.0, 0.012 + wr, ph)) + smoothstep(1.0 - 0.012 - wr, 1.0, ph);
          ring *= smoothstep(18.0, 3.0, d) * smoothstep(0.5, 1.4, d);
          diffuseColor.rgb *= 1.0 - ring * 0.2 * uClock;`
              : `
          // Walls settle slightly darker toward the floor (cheap contact shading).
          diffuseColor.rgb *= mix(0.9, 1.0, smoothstep(0.0, 1.4, vWPos.y)) ;`
          }
        }`,
      );
  };
  mat.customProgramCacheKey = () => key;
  cache.set(key, mat);
  return mat;
}

// ---------------------------------------------------------------------------
// Glass
// ---------------------------------------------------------------------------

/** Pane material: barely there face-on, bright at grazing angles, with a hairline frame. */
export function makeGlassMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTint: { value: PALETTE.glass.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uTint;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float nv = abs(dot(normalize(vNormal), V));
        float fres = pow(1.0 - nv, 2.5);
        vec2 e = min(vUv, 1.0 - vUv);
        float frame = 1.0 - smoothstep(0.0, 0.012, min(e.x, e.y));
        // Two soft diagonal sheen bands so a pane reads as a surface, not a hole.
        float band = smoothstep(0.42, 0.5, fract((vWorld.x + vWorld.z) * 0.22 + vWorld.y * 0.35)) *
                     (1.0 - smoothstep(0.5, 0.62, fract((vWorld.x + vWorld.z) * 0.22 + vWorld.y * 0.35)));
        float a = 0.1 + fres * 0.55 + band * 0.07 + frame * 0.5;
        vec3 col = mix(uTint, vec3(1.0), fres * 0.6 + band * 0.5);
        col = mix(col, vec3(0.2, 0.28, 0.33), frame * 0.8);
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Time fields
// ---------------------------------------------------------------------------

const fieldGeo = new IcosahedronGeometry(1, 4);

/**
 * A region where time behaves differently, drawn as a thin shell.
 *   still — cool blue; latitude bands that only move with world time (and then barely).
 *   rush  — amber; bands that keep scrolling in REAL time, because inside it time never waits.
 */
export class FieldVisual {
  readonly group = new Group();
  private readonly mat: ShaderMaterial;

  constructor(kind: 'still' | 'rush', radius: number, floorY: number, centerY: number) {
    const color = kind === 'still' ? PALETTE.fieldStill : PALETTE.fieldRush;
    this.mat = new ShaderMaterial({
      uniforms: {
        uColor: { value: color.clone() },
        uWorldTime: EnvGlobals.uWorldTime,
        uRealTime: EnvGlobals.uRealTime,
        uRush: { value: kind === 'rush' ? 1 : 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vLocal;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vLocal = position;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uColor;
        uniform float uWorldTime;
        uniform float uRealTime;
        uniform float uRush;
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec3 vLocal;
        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          float nv = abs(dot(normalize(vNormal), V));
          float rim = pow(1.0 - nv, 2.2);
          float t = mix(uWorldTime * 0.6, uRealTime * 0.9, uRush);
          float lat = fract(vLocal.y * 5.0 - t);
          float band = smoothstep(0.0, 0.04, lat) * (1.0 - smoothstep(0.08, 0.14, lat));
          float a = rim * 0.55 + band * (0.12 + rim * 0.3) + 0.03;
          gl_FragColor = vec4(uColor * (0.75 - band * 0.25), a * 0.8);
        }`,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const shell = new Mesh(fieldGeo, this.mat);
    shell.scale.setScalar(radius);
    shell.renderOrder = 2;
    this.group.add(shell);

    // Footprint on the floor, so the boundary is unambiguous at a glance.
    const h = floorY - centerY;
    const foot = Math.sqrt(Math.max(0.01, radius * radius - h * h));
    const ring = new Mesh(
      new RingGeometry(foot - 0.035, foot + 0.035, 64),
      new ShaderMaterial({
        uniforms: { uColor: { value: color.clone() } },
        vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor * 0.85, 0.9); }',
        transparent: true,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = h + 0.012;
    ring.renderOrder = 1;
    this.group.add(ring);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.geometry !== fieldGeo) m.geometry.dispose();
      if (m.isMesh) (m.material as ShaderMaterial).dispose();
    });
  }
}
