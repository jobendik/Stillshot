import {
  type Camera,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

/**
 * Diegetic CRT post-process: scanlines, screen curvature, chromatic aberration,
 * vignette, and a faint flicker — reinforcing the meta-narrative that you're
 * running a cracked, DOS-era executable. Implemented as a single full-screen
 * quad pass (scene -> render target -> shader -> screen) with zero addon deps.
 */
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uIntensity;

  vec2 curve(vec2 uv) {
    uv = uv * 2.0 - 1.0;
    vec2 offset = abs(uv.yx) / vec2(5.0, 4.0);
    uv = uv + uv * offset * offset * uIntensity;
    return uv * 0.5 + 0.5;
  }

  void main() {
    vec2 uv = mix(vUv, curve(vUv), uIntensity);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Chromatic aberration — offset grows toward the edges.
    float ca = (0.0014 + 0.0012 * length(uv - 0.5)) * uIntensity;
    float r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;
    vec3 col = vec3(r, g, b);

    // Scanlines.
    float scan = sin(uv.y * uResolution.y * 1.6) * 0.04 * uIntensity;
    col -= scan;

    // Subtle rolling flicker / refresh bar.
    float flicker = 0.97 + 0.03 * sin(uTime * 8.0);
    col *= mix(1.0, flicker, uIntensity);

    // Vignette.
    float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * (1.1 * uIntensity);
    col *= clamp(vig, 0.0, 1.0);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class PostFX {
  enabled = true;
  intensity = 1.0;

  private readonly renderer: WebGLRenderer;
  private target: WebGLRenderTarget;
  private readonly quadScene: Scene;
  private readonly quadCamera: OrthographicCamera;
  private readonly quadGeometry: PlaneGeometry;
  private readonly material: ShaderMaterial;
  private elapsed = 0;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    const size = renderer.getSize(new Vector2());
    const dpr = renderer.getPixelRatio();
    this.target = new WebGLRenderTarget(size.x * dpr, size.y * dpr);

    this.material = new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uTime: { value: 0 },
        uResolution: { value: new Vector2(size.x * dpr, size.y * dpr) },
        uIntensity: { value: this.intensity },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    // A standalone full-screen quad scene (kept separate from the game scene).
    this.quadScene = new Scene();
    this.quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadGeometry = new PlaneGeometry(2, 2);
    const quad = new Mesh(this.quadGeometry, this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  setSize(width: number, height: number): void {
    const dpr = this.renderer.getPixelRatio();
    this.target.setSize(width * dpr, height * dpr);
    this.material.uniforms.uResolution.value.set(width * dpr, height * dpr);
  }

  render(scene: Scene, camera: Camera, dt: number): void {
    this.elapsed += dt;
    if (!this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    this.material.uniforms.uTime.value = this.elapsed;
    this.material.uniforms.uIntensity.value = this.intensity;
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quadGeometry.dispose();
  }
}
