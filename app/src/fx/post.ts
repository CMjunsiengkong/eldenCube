/**
 * Post-processing (1.6; ARCHITECTURE §4.6). The scene renders once into a linear HDR target
 * (half float, 4× MSAA), then:
 *   1. V1 bloom (UnrealBloomPass at half resolution): only pixels brighter than the threshold glow.
 *      Fire, beam and ember colors are boosted above it (`fx/hdr.ts`); nothing else reaches it.
 *   2. Impact pass: V3 chromatic split + radial blur for 0.15 s after a big hit, and V5 heat
 *      shimmer around the firing Flame Beam (a screen-space band around its projected segment).
 *   3. OutputPass: ACES tone mapping (with the scene exposure) and sRGB.
 * `?lowfx` skips all of it: the renderer draws straight to the screen with in-shader tone mapping.
 */
import { HalfFloatType, Vector2, WebGLRenderTarget, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CONFIG } from '../config';

const BL = CONFIG.vfx.bloom;
const IM = CONFIG.vfx.impact;
const SM = CONFIG.vfx.shimmer;

/** Caps the linear HDR color before the bloom (see CONFIG.vfx.bloom.clamp). */
const ClampShader = {
  name: 'ClampShader',
  uniforms: { tDiffuse: { value: null }, uMax: { value: BL.clamp } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(min(c.rgb, vec3(uMax)), c.a);
    }`,
};

const ImpactShader = {
  name: 'ImpactShader',
  uniforms: {
    tDiffuse: { value: null },
    uAberr: { value: 0 },
    uBlur: { value: 0 },
    uCenter: { value: new Vector2(0.5, 0.5) },
    uShimmer: { value: 0 },
    uSegA: { value: new Vector2() },
    uSegB: { value: new Vector2() },
    uWidth: { value: SM.width },
    uAmount: { value: SM.amount },
    uAspect: { value: 1 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAberr;
    uniform float uBlur;
    uniform vec2 uCenter;
    uniform float uShimmer;
    uniform vec2 uSegA;
    uniform vec2 uSegB;
    uniform float uWidth;
    uniform float uAmount;
    uniform float uAspect;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      if (uShimmer > 0.001) {
        // Heat shimmer: ripples inside a band around the beam's screen segment.
        vec2 a = uSegA * vec2(uAspect, 1.0);
        vec2 b = uSegB * vec2(uAspect, 1.0);
        vec2 p = uv * vec2(uAspect, 1.0);
        vec2 ab = b - a;
        float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        float d = length(p - a - ab * h);
        float m = (1.0 - smoothstep(0.0, uWidth, d)) * uShimmer;
        uv += vec2(sin(uv.y * 90.0 + uTime * 23.0), cos(uv.x * 75.0 + uTime * 19.0)) * uAmount * m;
      }
      if (uAberr < 0.0001 && uBlur < 0.0001) {
        gl_FragColor = texture2D(tDiffuse, uv);
        return;
      }
      vec2 dir = uv - uCenter;
      vec2 off = dir * uAberr * 2.0;
      vec3 col = vec3(0.0);
      const int N = 8;
      for (int i = 0; i < N; i++) {
        vec2 s = uv - dir * uBlur * (float(i) / float(N));
        col.r += texture2D(tDiffuse, s + off).r;
        col.g += texture2D(tDiffuse, s).g;
        col.b += texture2D(tDiffuse, s - off).b;
      }
      gl_FragColor = vec4(col / float(N), 1.0);
    }`,
};

export class PostFx {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly impactPass: ShaderPass;
  private impactLeft = 0;
  private impactPeak = 0;
  private shimmer = 0;
  private shimmerWant = 0;
  private time = 0;
  private readonly renderer: WebGLRenderer;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, width: number, height: number) {
    this.renderer = renderer;
    const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: BL.samples });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.setSize(width, height);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(new ShaderPass(ClampShader));
    this.bloom = new UnrealBloomPass(new Vector2(width * BL.resolutionScale, height * BL.resolutionScale), BL.strength, BL.radius, BL.threshold);
    this.composer.addPass(this.bloom);
    this.impactPass = new ShaderPass(ImpactShader);
    this.composer.addPass(this.impactPass);
    this.composer.addPass(new OutputPass());
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    // The composer sizes every pass to the full drawing buffer; the bloom runs at half of it.
    const pr = this.renderer.getPixelRatio();
    this.bloom.setSize(Math.round(width * pr * BL.resolutionScale), Math.round(height * pr * BL.resolutionScale));
    this.impactPass.uniforms.uAspect.value = width / Math.max(1, height);
  }

  /** V3: a big hit; `strength` 0…1 at screen UV (x, y). The strongest of overlapping impacts wins. */
  impact(strength: number, x: number, y: number): void {
    if (strength >= this.impactPeak * (this.impactLeft / IM.duration)) {
      this.impactPeak = strength;
      this.impactLeft = IM.duration;
      this.impactPass.uniforms.uCenter.value.set(x, y);
    }
  }

  /** V5: heat shimmer around the screen segment (ax, ay) → (bx, by) this frame (UV). */
  setShimmer(ax: number, ay: number, bx: number, by: number): void {
    this.shimmerWant = 1;
    this.impactPass.uniforms.uSegA.value.set(ax, ay);
    this.impactPass.uniforms.uSegB.value.set(bx, by);
  }

  /** Real time: decays the impact and eases the shimmer in and out. */
  update(frameDt: number): void {
    this.time += frameDt;
    this.impactLeft = Math.max(0, this.impactLeft - frameDt);
    const k = this.impactLeft / IM.duration;
    const s = this.impactPeak * k * k;
    const u = this.impactPass.uniforms;
    u.uAberr.value = IM.aberration * s;
    u.uBlur.value = IM.blur * s;
    this.shimmer += (this.shimmerWant - this.shimmer) * Math.min(1, SM.fadeRate * frameDt);
    this.shimmerWant = 0;
    u.uShimmer.value = this.shimmer < 0.01 ? 0 : this.shimmer;
    u.uTime.value = this.time;
  }

  render(): void {
    this.composer.render();
  }

  /** Current impact strength 0…1 (tests, debug). */
  get impactStrength(): number {
    const k = this.impactLeft / IM.duration;
    return this.impactPeak * k * k;
  }
}
