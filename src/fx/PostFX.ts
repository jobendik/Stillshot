import {
  type Camera,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

/**
 * The lens. The scene is rendered in linear HDR, bright crystal cores and hot
 * streaks are bloomed at quarter resolution, and a single composite pass grades
 * the image according to the state of time:
 *
 *   still     — fractionally cooler and quieter, fine grain.
 *   flowing   — full colour, a breath of chromatic fringe at the edges.
 *   NEGATIVE  — while time is borrowed the image inverts like a photographic
 *               negative: the paper-white world goes black, ink goes white, and
 *               red stays red. The switch sweeps out from the centre like an iris.
 *   overdrawn — while the world collects its debt the frame burns hot at the edges.
 *
 * Every decorative term is scaled by one `lens` setting and can go to zero; the
 * negative has a reduced-flash variant that tints instead of inverting. Nothing
 * here ever hides a projectile: there is no blur, no curvature, no scanlines.
 */

const FS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform vec2 uTexel;
  void main() {
    // 4-tap box downsample + soft-knee threshold.
    vec3 c = texture2D(tScene, vUv + uTexel * vec2(-1.0, -1.0)).rgb
           + texture2D(tScene, vUv + uTexel * vec2( 1.0, -1.0)).rgb
           + texture2D(tScene, vUv + uTexel * vec2(-1.0,  1.0)).rgb
           + texture2D(tScene, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
    c *= 0.25;
    float peak = max(c.r, max(c.g, c.b));
    // Saturated emitters (red crystal) bloom earlier than neutral white walls.
    float sat = peak - min(c.r, min(c.g, c.b));
    float k = max(0.0, peak - 1.05) + max(0.0, sat - 0.55) * 0.9;
    gl_FragColor = vec4(c * (k / max(peak, 1e-4)), 1.0);
  }
`;

const BLUR_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uDir;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
    c += (texture2D(tSrc, vUv + uDir * 1.384615).rgb + texture2D(tSrc, vUv - uDir * 1.384615).rgb) * 0.316216;
    c += (texture2D(tSrc, vUv + uDir * 3.230769).rgb + texture2D(tSrc, vUv - uDir * 3.230769).rgb) * 0.070270;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uLens;
  uniform float uBloom;
  uniform float uFlow;
  uniform float uNegative;
  uniform float uNegativeSoft;
  uniform float uRepay;
  uniform float uDeath;
  uniform float uFade;
  uniform vec4 uRipple;   // xy centre (uv), z age (s), w strength

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 toneMap(vec3 c) {
    // Linear up to 0.75, then a soft shoulder: paper stays paper, highlights roll off.
    vec3 hi = max(c - 0.75, 0.0);
    return min(c, 0.75) + 0.25 * (1.0 - exp(-hi * 2.2));
  }

  void main() {
    vec2 uv = vUv;
    vec2 centred = uv - 0.5;
    float aspect = uResolution.x / uResolution.y;

    // Shock ripple (transfers, the iris snapping shut).
    if (uRipple.w > 0.0) {
      vec2 dv = (uv - uRipple.xy) * vec2(aspect, 1.0);
      float d = length(dv);
      float front = uRipple.z * 1.9;
      float wave = sin((d - front) * 34.0) * exp(-abs(d - front) * 9.0);
      uv += normalize(dv + 1e-5) / vec2(aspect, 1.0) * wave * 0.012 * uRipple.w * exp(-uRipple.z * 3.0);
    }

    float r2 = dot(centred, centred);
    float fringe = (0.0009 * uFlow + 0.0035 * uRepay) * uLens * (0.3 + r2 * 4.0);
    vec3 col;
    col.r = texture2D(tScene, uv + centred * fringe).r;
    col.g = texture2D(tScene, uv).g;
    col.b = texture2D(tScene, uv - centred * fringe).b;
    col += texture2D(tBloom, uv).rgb * uBloom;

    col *= 1.0 + uRepay * 0.18;
    col = toneMap(col);

    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    float red = clamp((col.r - max(col.g, col.b)) * 2.4, 0.0, 1.0);

    // Stillness: a touch cooler and quieter. Reds never lose saturation.
    float still = (1.0 - uFlow) * uLens;
    vec3 quiet = mix(col, vec3(luma) * vec3(0.975, 0.99, 1.02), 0.3);
    col = mix(col, mix(quiet, col, red), still);

    // The negative.
    if (uNegative > 0.001) {
      float iris = smoothstep(uNegative * 1.25, uNegative * 1.25 - 0.14, length(centred * vec2(aspect, 1.0)) * 0.95);
      vec3 inv = vec3(1.0) - col;
      inv = pow(max(inv, 0.0), vec3(2.1)) * vec3(0.84, 0.93, 1.08) * 1.25 + vec3(0.01, 0.014, 0.028);
      vec3 neg = mix(inv, col * 1.08, red);
      vec3 soft = mix(vec3(luma) * vec3(0.55, 0.68, 0.9), col, red); // reduced-flash variant
      col = mix(col, mix(neg, soft, uNegativeSoft), iris);
      // A bright hairline on the iris edge while it travels.
      float edge = smoothstep(0.03, 0.0, abs(length(centred * vec2(aspect, 1.0)) * 0.95 - uNegative * 1.25 + 0.07));
      col += edge * 0.35 * (1.0 - uNegativeSoft) * step(uNegative, 0.98);
    }

    // Debt: the edges of the frame burn.
    if (uRepay > 0.001) {
      float burn = smoothstep(0.12, 0.62, r2 * 1.7) * uRepay;
      col = mix(col, vec3(1.0, 0.16, 0.12) * (0.75 + luma * 0.6), burn * 0.5);
    }

    // Vignette + grain.
    col *= 1.0 - r2 * 0.34 * uLens;

    // Death: the exposure fails.
    if (uDeath > 0.001) {
      float l2 = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l2) * vec3(1.0, 0.25, 0.25), uDeath * 0.85);
      col *= 1.0 - uDeath * smoothstep(0.05, 0.55, r2) * 0.8;
    }

    col *= uFade;
    // sRGB encode.
    col = clamp(col, 0.0, 1.0);
    col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
    // Grain is added after encoding so it is equally faint on ink and on paper.
    float g = hash(gl_FragCoord.xy + fract(uTime) * 311.7) - 0.5;
    col += g * (0.018 + 0.014 * (1.0 - uFlow)) * uLens;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class PostFX {
  /** Normalised time flow 0..1 (0 = still). */
  flow = 0;
  /** 0..1 negative amount (animated by the game). */
  negative = 0;
  /** Use the tint variant of the negative instead of inverting. */
  negativeSoft = false;
  repay = 0;
  death = 0;
  /** Global fade (1 = fully visible). */
  fade = 1;
  /** Strength of decorative lens terms, 0..1. */
  lens = 0.7;
  bloom = true;
  rippleEnabled = true;

  private readonly renderer: WebGLRenderer;
  private sceneRT: WebGLRenderTarget;
  private bloomA: WebGLRenderTarget;
  private bloomB: WebGLRenderTarget;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private readonly bright: ShaderMaterial;
  private readonly blur: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private elapsed = 0;
  private rippleAge = 10;
  private readonly ripple = new Vector4(0.5, 0.5, 10, 0);
  private renderScale = 1;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    renderer.toneMapping = NoToneMapping;
    const { w, h } = this.targetSize();
    const float = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
    const type = float ? HalfFloatType : UnsignedByteType;
    this.sceneRT = new WebGLRenderTarget(w, h, { type, samples: 4, depthBuffer: true });
    const bw = Math.max(2, w >> 2);
    const bh = Math.max(2, h >> 2);
    this.bloomA = new WebGLRenderTarget(bw, bh, { type, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
    this.bloomB = new WebGLRenderTarget(bw, bh, { type, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });

    const mk = (frag: string, uniforms: Record<string, { value: unknown }>): ShaderMaterial =>
      new ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.bright = mk(BRIGHT_FRAG, { tScene: { value: null }, uTexel: { value: new Vector2() } });
    this.blur = mk(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new Vector2() } });
    this.composite = mk(COMPOSITE_FRAG, {
      tScene: { value: null },
      tBloom: { value: null },
      uResolution: { value: new Vector2(w, h) },
      uTime: { value: 0 },
      uLens: { value: 1 },
      uBloom: { value: 1 },
      uFlow: { value: 0 },
      uNegative: { value: 0 },
      uNegativeSoft: { value: 0 },
      uRepay: { value: 0 },
      uDeath: { value: 0 },
      uFade: { value: 1 },
      uRipple: { value: this.ripple },
    });

    this.quad = new Mesh(new PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  private targetSize(): { w: number; h: number } {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    return { w: Math.max(2, Math.round(size.x * this.renderScale)), h: Math.max(2, Math.round(size.y * this.renderScale)) };
  }

  setRenderScale(scale: number): void {
    this.renderScale = Math.max(0.4, Math.min(1, scale));
    this.resize();
  }

  /** Call after the renderer has been resized. */
  resize(): void {
    const { w, h } = this.targetSize();
    this.sceneRT.setSize(w, h);
    this.bloomA.setSize(Math.max(2, w >> 2), Math.max(2, h >> 2));
    this.bloomB.setSize(Math.max(2, w >> 2), Math.max(2, h >> 2));
    this.composite.uniforms.uResolution.value.set(w, h);
  }

  /** Kick a ripple from a screen position (uv 0..1). */
  kick(u = 0.5, v = 0.5, strength = 1): void {
    if (!this.rippleEnabled) return;
    this.ripple.set(u, v, 0, strength);
    this.rippleAge = 0;
  }

  private pass(mat: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  render(scene: Scene, camera: Camera, realDt: number): void {
    this.elapsed += realDt;
    this.rippleAge += realDt;
    this.ripple.z = this.rippleAge;
    if (this.rippleAge > 1.2) this.ripple.w = 0;

    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    if (this.bloom) {
      this.bright.uniforms.tScene.value = this.sceneRT.texture;
      this.bright.uniforms.uTexel.value.set(1 / this.sceneRT.width, 1 / this.sceneRT.height);
      this.pass(this.bright, this.bloomA);
      for (let i = 0; i < 2; i++) {
        const spread = 1 + i * 1.2;
        this.blur.uniforms.tSrc.value = this.bloomA.texture;
        this.blur.uniforms.uDir.value.set(spread / this.bloomA.width, 0);
        this.pass(this.blur, this.bloomB);
        this.blur.uniforms.tSrc.value = this.bloomB.texture;
        this.blur.uniforms.uDir.value.set(0, spread / this.bloomA.height);
        this.pass(this.blur, this.bloomA);
      }
    }

    const u = this.composite.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = this.bloomA.texture;
    u.uTime.value = this.elapsed;
    u.uLens.value = this.lens;
    u.uBloom.value = this.bloom ? 0.85 : 0;
    u.uFlow.value = this.flow;
    u.uNegative.value = this.negative;
    u.uNegativeSoft.value = this.negativeSoft ? 1 : 0;
    u.uRepay.value = this.repay;
    u.uDeath.value = this.death;
    u.uFade.value = this.fade;
    this.pass(this.composite, null);
  }

  dispose(): void {
    this.sceneRT.dispose();
    this.bloomA.dispose();
    this.bloomB.dispose();
    this.bright.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
