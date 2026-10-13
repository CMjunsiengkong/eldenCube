/**
 * Ground decals (1.6; visual only): gel stains where splash droplets land (V4) and the Flame
 * Beam's molten scar (V5). One instanced quad mesh for all of them (one draw call), a
 * ring buffer like the burn marks. Each mark has its own radius, life, style and color; it may be
 * born in the future (a droplet still falling), and fades out over the last 40% of its life.
 * Styles: 0 gel stain (glossy blob), 2 molten (orange-hot,
 * cooling to dark red; HDR so it blooms). The clock is simulation time.
 */
import { Color, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, type Scene } from 'three';
import { CONFIG } from '../config';
import { moltenBoost } from './hdr';

const DC = CONFIG.vfx.decals;
const DEAD = -1e9;
export type DecalStyle = 0 | 2; // (style 1, the meteor crater, was removed after the 1.6 playtest)

/** Pure (tested): opacity of a mark `age` s old with this `life` — 1, then a smooth fade over the last 40%. */
export function decalFade(age: number, life: number): number {
  if (age < 0 || age >= life) return 0;
  const t = Math.min(1, Math.max(0, (age - life * 0.6) / (life * 0.4)));
  return 1 - t * t * (3 - 2 * t);
}

const VERTEX = /* glsl */ `
attribute vec4 aMark;  // x, z, birth, seed
attribute vec4 aParam; // radius, life, style, unused
attribute vec3 aColor;
uniform float uTime;
uniform float uLift;
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying float vAge;
varying float vStyle;
varying float vLife;
varying vec3 vColor;
void main() {
  float age = uTime - aMark.z;
  float life = aParam.y;
  float t = clamp((age - life * 0.6) / (life * 0.4), 0.0, 1.0);
  vFade = (age < 0.0 || age >= life) ? 0.0 : 1.0 - t * t * (3.0 - 2.0 * t);
  vSeed = aMark.w;
  vAge = age;
  vStyle = aParam.z;
  vLife = life;
  vColor = aColor;
  float grow = aParam.z > 1.5 ? 1.0 : smoothstep(0.0, 0.08, age); // stains splat open
  float r = aParam.x * (0.4 + 0.6 * grow);
  vec3 p = vec3(aMark.x + position.x * r * 2.0, uLift + aParam.z * 0.004, aMark.y - position.y * r * 2.0);
  gl_Position = vFade > 0.0 ? projectionMatrix * viewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  vUv = uv;
}`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vFade;
varying float vSeed;
varying float vAge;
varying float vStyle;
varying float vLife;
varying vec3 vColor;
uniform vec3 uHot;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uBoost;
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float d = length(q);
  float ang = atan(q.y, q.x);
  vec3 col;
  float a;
  if (vStyle < 0.5) {
    // Gel stain: a wobbly blob with a glossy highlight.
    float edge = 0.78 + 0.14 * sin(ang * 4.0 + vSeed * 6.2832) + 0.08 * sin(ang * 9.0 + vSeed * 19.0);
    a = 1.0 - smoothstep(edge - 0.12, edge, d);
    float hi = 1.0 - smoothstep(0.0, 0.35, length(q - vec2(-0.25, 0.25)));
    col = vColor * (0.75 + 0.6 * hi);
    a *= 0.85;
  } else {
    // Molten scar: white-hot, cooling through orange to dark red over its life.
    float edge = 0.8 + 0.15 * sin(ang * 5.0 + vSeed * 6.2832);
    a = 1.0 - smoothstep(edge - 0.3, edge, d);
    float k = clamp(vAge / (vLife * 0.7), 0.0, 1.0);
    vec3 start = mix(uWarm, uHot, 0.35); // orange-yellow, not white
    vec3 hot = k < 0.25 ? mix(start, uWarm, k / 0.25) : mix(uWarm, uCool, (k - 0.25) / 0.75);
    float glow = (1.0 - smoothstep(0.0, 0.8, d)) * (1.0 - k);
    col = hot * (0.6 + 0.4 * glow) * mix(1.0, uBoost, 1.0 - k);
  }
  if (a * vFade < 0.003) discard;
  gl_FragColor = vec4(col, a * vFade);
  #include <colorspace_fragment>
}`;

export class Decals {
  readonly mesh: Mesh;
  readonly capacity: number;
  private readonly marks: InstancedBufferAttribute;
  private readonly params: InstancedBufferAttribute;
  private readonly colors: InstancedBufferAttribute;
  private readonly material: ShaderMaterial;
  private time = 0;
  private slot = 0;
  private dirty = false;

  constructor(capacity: number = DC.capacity) {
    this.capacity = capacity;
    const quad = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    const m = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) m[i * 4 + 2] = DEAD;
    this.marks = new InstancedBufferAttribute(m, 4);
    this.params = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(1), 4);
    this.colors = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    g.setAttribute('aMark', this.marks);
    g.setAttribute('aParam', this.params);
    g.setAttribute('aColor', this.colors);
    g.instanceCount = capacity;
    const C = CONFIG.colors;
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uLift: { value: DC.lift },
        uHot: { value: new Color(C.flameCore) },
        uWarm: { value: new Color(C.fire) },
        uCool: { value: new Color(0x3a0c06) },
        uBoost: { value: moltenBoost() },
      },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      toneMapped: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  addTo(scene: Scene): void {
    if (!this.mesh.parent) scene.add(this.mesh);
  }

  /** A mark at (x, z) appearing `delay` s from now. Overwrites the oldest when full. */
  spawn(x: number, z: number, style: DecalStyle, radius: number, life: number, seed: number, color?: Color, delay = 0): void {
    const i = this.slot;
    this.slot = (i + 1) % this.capacity;
    const m = this.marks.array as Float32Array;
    m[i * 4] = x;
    m[i * 4 + 1] = z;
    m[i * 4 + 2] = this.time + delay;
    m[i * 4 + 3] = seed;
    const p = this.params.array as Float32Array;
    p[i * 4] = radius;
    p[i * 4 + 1] = life;
    p[i * 4 + 2] = style;
    const c = this.colors.array as Float32Array;
    c[i * 3] = color?.r ?? 1;
    c[i * 3 + 1] = color?.g ?? 1;
    c[i * 3 + 2] = color?.b ?? 1;
    this.dirty = true;
  }

  step(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    if (this.dirty) {
      this.marks.needsUpdate = true;
      this.params.needsUpdate = true;
      this.colors.needsUpdate = true;
      this.dirty = false;
    }
  }

  /** Marks visible now or still to appear (tests, debug). */
  activeCount(): number {
    const m = this.marks.array as Float32Array;
    const p = this.params.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const age = this.time - m[i * 4 + 2];
      if (age < p[i * 4 + 1] && m[i * 4 + 2] > DEAD / 2) n++;
    }
    return n;
  }

  clear(): void {
    const m = this.marks.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) m[i * 4 + 2] = DEAD;
    this.dirty = true;
    this.step(0);
  }
}
