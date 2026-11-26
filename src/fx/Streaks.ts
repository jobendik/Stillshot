import {
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Float32BufferAttribute,
  Mesh,
  NormalBlending,
  type Scene,
  ShaderMaterial,
  type Vector3,
} from 'three';

/**
 * Camera-facing ribbons and soft glows, all in one instanced draw call.
 * Everything linear in the game is drawn with this: bullet trails, the dashed
 * threat lines that show where a slow round is going, aim telegraphs, sparks
 * and muzzle glows. The list is rebuilt from scratch every frame, which makes
 * it equally easy to drive from the live simulation or from a replay.
 */
const VERT = /* glsl */ `
  attribute vec3 iA;
  attribute vec3 iB;
  attribute vec4 iColA;
  attribute vec4 iColB;
  attribute vec4 iParam; // width, dashes per metre, dash phase, mode (0 ribbon, 1 glow)
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vLen;
  varying vec3 vParam;
  void main() {
    vec3 axis = iB - iA;
    float len = max(length(axis), 1e-5);
    axis /= len;
    vec3 p = mix(iA, iB, position.x);
    vec3 toCam = normalize(cameraPosition - p);
    vec3 side = cross(axis, toCam);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    p += side * position.y * iParam.x;
    vColor = mix(iColA, iColB, position.x);
    vUv = vec2(position.x, position.y * 2.0);
    vLen = len;
    vParam = iParam.yzw;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec4 vColor;
  varying vec2 vUv;
  varying float vLen;
  varying vec3 vParam;
  void main() {
    float a = vColor.a;
    if (vParam.z > 0.5) {
      float d = length(vec2(vUv.x * 2.0 - 1.0, vUv.y));
      a *= pow(max(0.0, 1.0 - d), 1.6);
    } else {
      a *= 1.0 - smoothstep(0.55, 1.0, abs(vUv.y));
      if (vParam.x > 0.0) {
        float dash = fract(vUv.x * vLen * vParam.x - vParam.y);
        a *= smoothstep(0.0, 0.08, dash) * (1.0 - smoothstep(0.5, 0.58, dash));
      }
    }
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor.rgb, a);
  }
`;

export class StreakRenderer {
  readonly mesh: Mesh;
  private readonly capacity: number;
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  private readonly colA: Float32Array;
  private readonly colB: Float32Array;
  private readonly param: Float32Array;
  private readonly geo: InstancedBufferGeometry;
  private count = 0;

  constructor(scene: Scene, capacity = 768) {
    this.capacity = capacity;
    this.geo = new InstancedBufferGeometry();
    this.geo.setAttribute(
      'position',
      new Float32BufferAttribute([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0], 3),
    );
    this.a = new Float32Array(capacity * 3);
    this.b = new Float32Array(capacity * 3);
    this.colA = new Float32Array(capacity * 4);
    this.colB = new Float32Array(capacity * 4);
    this.param = new Float32Array(capacity * 4);
    const attr = (arr: Float32Array, size: number): InstancedBufferAttribute => {
      const at = new InstancedBufferAttribute(arr, size);
      at.setUsage(DynamicDrawUsage);
      return at;
    };
    this.geo.setAttribute('iA', attr(this.a, 3));
    this.geo.setAttribute('iB', attr(this.b, 3));
    this.geo.setAttribute('iColA', attr(this.colA, 4));
    this.geo.setAttribute('iColB', attr(this.colB, 4));
    this.geo.setAttribute('iParam', attr(this.param, 4));
    this.geo.instanceCount = 0;

    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      // The ribbon is built to face the camera from either side.
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  begin(): void {
    this.count = 0;
  }

  /** A ribbon from a→b. Colours are linear RGBA; values above 1 bloom. */
  line(
    a: Vector3 | { x: number; y: number; z: number },
    b: Vector3 | { x: number; y: number; z: number },
    width: number,
    ca: readonly [number, number, number, number],
    cb: readonly [number, number, number, number],
    dashesPerMetre = 0,
    dashPhase = 0,
  ): void {
    this.push(a.x, a.y, a.z, b.x, b.y, b.z, width, ca, cb, dashesPerMetre, dashPhase, 0);
  }

  /** A soft round glow centred on p. */
  glow(p: { x: number; y: number; z: number }, radius: number, c: readonly [number, number, number, number]): void {
    this.push(p.x, p.y - radius, p.z, p.x, p.y + radius, p.z, radius * 2, c, c, 0, 0, 1);
  }

  private push(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    width: number,
    ca: readonly [number, number, number, number],
    cb: readonly [number, number, number, number],
    dash: number,
    phase: number,
    mode: number,
  ): void {
    if (this.count >= this.capacity) return;
    const i3 = this.count * 3;
    const i4 = this.count * 4;
    this.a[i3] = ax;
    this.a[i3 + 1] = ay;
    this.a[i3 + 2] = az;
    this.b[i3] = bx;
    this.b[i3 + 1] = by;
    this.b[i3 + 2] = bz;
    this.colA.set(ca, i4);
    this.colB.set(cb, i4);
    this.param[i4] = width;
    this.param[i4 + 1] = dash;
    this.param[i4 + 2] = phase;
    this.param[i4 + 3] = mode;
    this.count++;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    if (this.count === 0) return;
    for (const name of ['iA', 'iB', 'iColA', 'iColB', 'iParam']) {
      const at = this.geo.getAttribute(name) as InstancedBufferAttribute;
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.count * at.itemSize);
      at.needsUpdate = true;
    }
  }

  get instanceCount(): number {
    return this.count;
  }
}
