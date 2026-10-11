/**
 * Burning marks left by Crown Rain fireballs (GD §6.5 C, ARCHITECTURE §4.6, milestone 1.5b).
 * Purely cosmetic: a ring buffer of marks, each a flat scorch decal (one draw call for all) and
 * 3 flame-tongue billboards (one draw call for all). The CPU writes a mark only when it spawns;
 * the shaders animate the flicker and fade it out with `burnFade` (mirrored in GLSL). The clock is
 * simulation time. Reset clears them; everything else lets them fade on their own.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  type Scene,
} from 'three';
import { CONFIG } from '../config';

const BU = CONFIG.vfx.burns;
const DEAD = -1e9;

/** Pure (tested): opacity of a mark `age` seconds old — 1 until `fadeStart`, smooth to 0 at `life`. */
export function burnFade(age: number, life: number = BU.life, fadeStart: number = BU.fadeStart): number {
  if (age < 0 || age >= life) return 0;
  const t = Math.min(1, Math.max(0, (age - fadeStart) / (life - fadeStart)));
  return 1 - t * t * (3 - 2 * t);
}

const FADE_GLSL = /* glsl */ `
float burnFade(float age) {
  if (age < 0.0 || age >= uLife) return 0.0;
  return 1.0 - smoothstep(uFadeStart, uLife, age);
}`;

const SCORCH_VERTEX = /* glsl */ `
attribute vec4 aMark; // x, z, birth, seed
uniform float uTime;
uniform float uLife;
uniform float uFadeStart;
uniform float uRadius;
uniform float uLift;
uniform float uGrow;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying float vAge;
${FADE_GLSL}
void main() {
  float age = uTime - aMark.z;
  vFade = burnFade(age);
  vSeed = aMark.w;
  vAge = age;
  float grow = smoothstep(0.0, uGrow, age);
  vec3 p = vec3(aMark.x + position.x * uRadius * 2.0 * grow, uLift, aMark.y - position.y * uRadius * 2.0 * grow);
  gl_Position = vFade > 0.0 ? projectionMatrix * viewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  vUv = uv;
}`;

const SCORCH_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying float vAge;
uniform vec3 uScorch;
uniform vec3 uEmber;
uniform float uScorchAlpha;
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float d = length(q);
  float ang = atan(q.y, q.x);
  float edge = 0.82 + 0.12 * sin(ang * 5.0 + vSeed * 6.2832) + 0.06 * sin(ang * 11.0 + vSeed * 17.0);
  float body = 1.0 - smoothstep(edge - 0.25, edge, d);
  // Embers glow in the middle and cool down over the first half of the life.
  float flick = 0.7 + 0.3 * sin(vAge * 17.0 + vSeed * 40.0 + d * 9.0);
  float ember = (1.0 - smoothstep(0.0, 0.55, d)) * flick * (1.0 - smoothstep(0.0, 1.6, vAge));
  vec3 col = mix(uScorch, uEmber, ember);
  gl_FragColor = vec4(col, body * uScorchAlpha * vFade);
  #include <colorspace_fragment>
}`;

const FLAME_VERTEX = /* glsl */ `
attribute vec4 aFlame; // x, z, birth, seed (each mark has 3 flames with their own offsets)
uniform float uTime;
uniform float uLife;
uniform float uFadeStart;
uniform float uWidth;
uniform float uHeight;
uniform float uGrow;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying float vTime;
${FADE_GLSL}
void main() {
  float age = uTime - aFlame.z;
  vFade = burnFade(age);
  vSeed = aFlame.w;
  vTime = uTime;
  float grow = smoothstep(0.0, uGrow, age);
  float flicker = 0.85 + 0.15 * sin(uTime * 13.0 + aFlame.w * 31.0) * sin(uTime * 7.3 + aFlame.w * 11.0);
  float h = uHeight * (0.6 + 0.4 * fract(aFlame.w * 7.13)) * grow * flicker * (0.35 + 0.65 * vFade);
  // Cylindrical billboard: always faces the camera around the vertical axis, anchored at the ground.
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 base = vec3(aFlame.x, 0.0, aFlame.y);
  vec3 p = base + right * position.x * uWidth + vec3(0.0, (position.y + 0.5) * h, 0.0);
  gl_Position = vFade > 0.0 ? projectionMatrix * viewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  vUv = uv;
}`;

const FLAME_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying float vTime;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uTip;
void main() {
  float y = vUv.y;
  float sway = sin(y * 6.0 + vTime * 11.0 + vSeed * 9.0) * 0.12 * y;
  float x = abs(vUv.x - 0.5 + sway) * 2.0;
  float width = mix(1.0, 0.08, pow(y, 0.8));
  float a = (1.0 - smoothstep(width * 0.55, width, x)) * (1.0 - smoothstep(0.55, 1.0, y)) * smoothstep(0.0, 0.08, y);
  vec3 col = y < 0.35 ? mix(uCore, uMid, y / 0.35) : mix(uMid, uTip, (y - 0.35) / 0.65);
  gl_FragColor = vec4(col, a * vFade);
  #include <colorspace_fragment>
}`;

export class Burns {
  readonly scorch: Mesh;
  readonly flames: Mesh;
  readonly capacity: number;
  private readonly marks: InstancedBufferAttribute;
  private readonly flameAttr: InstancedBufferAttribute;
  private readonly scorchMat: ShaderMaterial;
  private readonly flameMat: ShaderMaterial;
  private time = 0;
  private slot = 0;
  private dirty = false;

  constructor(capacity: number = BU.capacity) {
    this.capacity = capacity;
    const quad = new PlaneGeometry(1, 1);
    const C = CONFIG.colors;

    const sg = new InstancedBufferGeometry();
    sg.index = quad.index;
    sg.setAttribute('position', quad.getAttribute('position'));
    sg.setAttribute('uv', quad.getAttribute('uv'));
    const markArr = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) markArr[i * 4 + 2] = DEAD;
    this.marks = new InstancedBufferAttribute(markArr, 4);
    sg.setAttribute('aMark', this.marks);
    sg.instanceCount = capacity;
    const shared = { uTime: { value: 0 }, uLife: { value: BU.life }, uFadeStart: { value: BU.fadeStart }, uGrow: { value: BU.growTime } };
    this.scorchMat = new ShaderMaterial({
      vertexShader: SCORCH_VERTEX,
      fragmentShader: SCORCH_FRAGMENT,
      uniforms: {
        ...shared,
        uRadius: { value: BU.scorchRadius },
        uLift: { value: BU.lift },
        uScorch: { value: new Color(C.scorch) },
        uEmber: { value: new Color(C.fire) },
        uScorchAlpha: { value: BU.scorchAlpha },
      },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      toneMapped: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.scorch = new Mesh(sg, this.scorchMat);
    this.scorch.frustumCulled = false;
    this.scorch.renderOrder = 2;

    const fg = new InstancedBufferGeometry();
    fg.index = quad.index;
    fg.setAttribute('position', quad.getAttribute('position'));
    fg.setAttribute('uv', quad.getAttribute('uv'));
    const flameArr = new Float32Array(capacity * BU.flamesPerMark * 4);
    for (let i = 0; i < capacity * BU.flamesPerMark; i++) flameArr[i * 4 + 2] = DEAD;
    this.flameAttr = new InstancedBufferAttribute(flameArr, 4);
    fg.setAttribute('aFlame', this.flameAttr);
    fg.instanceCount = capacity * BU.flamesPerMark;
    this.flameMat = new ShaderMaterial({
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      uniforms: {
        ...shared,
        uWidth: { value: BU.flameWidth },
        uHeight: { value: BU.flameHeight },
        uCore: { value: new Color(C.flameCore) },
        uMid: { value: new Color(C.fireballCore) },
        uTip: { value: new Color(C.fire) },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
      side: DoubleSide,
    });
    // Both materials share the same clock uniform objects.
    this.flameMat.uniforms.uTime = this.scorchMat.uniforms.uTime;
    this.flames = new Mesh(fg, this.flameMat);
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 6;
  }

  addTo(scene: Scene): void {
    if (!this.scorch.parent) scene.add(this.scorch);
    if (!this.flames.parent) scene.add(this.flames);
  }

  /** A new burning mark at (x, z); `seed` in [0, 1) varies its shape. Overwrites the oldest when full. */
  spawn(x: number, z: number, seed: number): void {
    const i = this.slot;
    this.slot = (i + 1) % this.capacity;
    const m = this.marks.array as Float32Array;
    m[i * 4] = x;
    m[i * 4 + 1] = z;
    m[i * 4 + 2] = this.time;
    m[i * 4 + 3] = seed;
    const f = this.flameAttr.array as Float32Array;
    const n = BU.flamesPerMark;
    for (let k = 0; k < n; k++) {
      const a = seed * Math.PI * 2 + (k / n) * Math.PI * 2;
      const r = BU.flameSpread * (0.4 + 0.6 * (((seed * 13.7 + k * 0.37) % 1 + 1) % 1));
      const j = (i * n + k) * 4;
      f[j] = x + Math.cos(a) * r;
      f[j + 1] = z + Math.sin(a) * r;
      f[j + 2] = this.time + k * BU.flameStagger;
      f[j + 3] = (seed + k * 0.318) % 1;
    }
    this.dirty = true;
  }

  step(dt: number): void {
    this.time += dt;
    this.scorchMat.uniforms.uTime.value = this.time;
    if (this.dirty) {
      this.marks.needsUpdate = true;
      this.flameAttr.needsUpdate = true;
      this.dirty = false;
    }
  }

  /** Marks still visible (tests, debug). */
  activeCount(): number {
    const m = this.marks.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (burnFade(this.time - m[i * 4 + 2]) > 0) n++;
    return n;
  }

  /** Removes every mark at once (reset only). */
  clear(): void {
    const m = this.marks.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) m[i * 4 + 2] = DEAD;
    const f = this.flameAttr.array as Float32Array;
    for (let i = 0; i < this.capacity * BU.flamesPerMark; i++) f[i * 4 + 2] = DEAD;
    this.dirty = true;
    this.step(0);
  }
}
