/**
 * Pooled GPU particles (ARCHITECTURE §4.6, milestone 1.5b). One system = one draw call: an
 * `InstancedBufferGeometry` quad with a fixed ring buffer of instances. The CPU writes an instance
 * only when it is spawned; the vertex shader moves it (`p0 + v·t + ½·g·t²`), faces the camera and
 * fades it by age. The clock is simulation time (`step(dt)`), so particles freeze during hit-stop
 * and slow down in slow motion. Nothing is allocated per frame.
 */
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  type Scene,
} from 'three';
import { CONFIG } from '../config';

const DEAD = -1e9;

const VERTEX = /* glsl */ `
attribute vec4 aStart;  // xyz start position, w birth time
attribute vec4 aVel;    // xyz velocity, w life
attribute vec4 aShape;  // x start size, y end size, z gravity (m/s², down), w alpha
attribute vec3 aColor;
uniform float uTime;
uniform float uFloor;
uniform float uStretch;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float age = uTime - aStart.w;
  float u = age / aVel.w;
  if (age < 0.0 || u >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume
    return;
  }
  vec3 p = aStart.xyz + aVel.xyz * age;
  p.y -= 0.5 * aShape.z * age * age;
  p.y = max(p.y, uFloor);
  float size = mix(aShape.x, aShape.y, u);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  if (uStretch > 0.0) {
    // Spark: a streak stretched along the screen-space velocity (its last uStretch seconds).
    vec3 vel = aVel.xyz - vec3(0.0, aShape.z * age, 0.0);
    vec4 mv2 = modelViewMatrix * vec4(p - vel * uStretch, 1.0);
    vec2 d = mv.xy - mv2.xy;
    float len = max(length(d), size);
    vec2 dir = length(d) > 1e-5 ? d / length(d) : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    // The quad's x runs along the motion (keeping the winding, so it is not back-face culled).
    mv.xy += dir * (position.x * len) + perp * (position.y * size);
  } else {
    mv.xy += position.xy * size;
  }
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vColor = vec4(aColor, aShape.w * (1.0 - smoothstep(0.45, 1.0, u)));
}`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
uniform float uSoftness;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = 1.0 - smoothstep(uSoftness, 1.0, d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  #include <colorspace_fragment>
}`;

export type ParticleBlend = 'glow' | 'smoke' | 'spark';

/** One spawn request; fields are reused by callers (no allocation per particle). */
export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size0: number;
  size1: number;
  /** Downward acceleration (m/s²); negative values make particles rise. */
  gravity: number;
  alpha: number;
  color: Color;
}

export const newSpec = (): ParticleSpec => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size0: 0.2, size1: 0, gravity: 0, alpha: 1, color: new Color(1, 1, 1) });

/** Next ring-buffer slot (pure, tested): wraps to 0 at `capacity`. */
export const nextSlot = (slot: number, capacity: number): number => (slot + 1) % capacity;

export class Particles {
  readonly mesh: Mesh;
  readonly capacity: number;
  private readonly material: ShaderMaterial;
  private readonly start: InstancedBufferAttribute;
  private readonly vel: InstancedBufferAttribute;
  private readonly shape: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private time = 0;
  private slot = 0;
  /** Spawned this step: the first slot and how many (uploaded once per step). */
  private dirtyFrom = -1;
  private dirtyCount = 0;

  constructor(capacity: number, blend: ParticleBlend) {
    this.capacity = capacity;
    const quad = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const startArr = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) startArr[i * 4 + 3] = DEAD;
    this.start = new InstancedBufferAttribute(startArr, 4);
    this.vel = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(1), 4);
    this.shape = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.color = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    geo.setAttribute('aStart', this.start);
    geo.setAttribute('aVel', this.vel);
    geo.setAttribute('aShape', this.shape);
    geo.setAttribute('aColor', this.color);
    geo.instanceCount = capacity;

    const P = CONFIG.vfx.particles;
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uFloor: { value: P.floor },
        uSoftness: { value: blend === 'smoke' ? P.smokeSoftness : blend === 'spark' ? P.sparkSoftness : P.glowSoftness },
        uStretch: { value: blend === 'spark' ? P.sparkStretch : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: blend === 'smoke' ? NormalBlending : AdditiveBlending,
      toneMapped: false,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = blend === 'smoke' ? 5 : 6;
  }

  /** Simulation time of the shader clock (tests). */
  get now(): number {
    return this.time;
  }

  addTo(scene: Scene): void {
    if (!this.mesh.parent) scene.add(this.mesh);
  }

  /** Writes one particle into the next slot (the oldest one is overwritten when full). */
  spawn(s: ParticleSpec): void {
    const i = this.slot;
    this.slot = nextSlot(i, this.capacity);
    const a = this.start.array as Float32Array;
    const v = this.vel.array as Float32Array;
    const sh = this.shape.array as Float32Array;
    const c = this.color.array as Float32Array;
    a[i * 4] = s.x;
    a[i * 4 + 1] = s.y;
    a[i * 4 + 2] = s.z;
    a[i * 4 + 3] = this.time;
    v[i * 4] = s.vx;
    v[i * 4 + 1] = s.vy;
    v[i * 4 + 2] = s.vz;
    v[i * 4 + 3] = Math.max(1e-3, s.life);
    sh[i * 4] = s.size0;
    sh[i * 4 + 1] = s.size1;
    sh[i * 4 + 2] = s.gravity;
    sh[i * 4 + 3] = s.alpha;
    c[i * 3] = s.color.r;
    c[i * 3 + 1] = s.color.g;
    c[i * 3 + 2] = s.color.b;
    if (this.dirtyFrom < 0) this.dirtyFrom = i;
    this.dirtyCount = Math.min(this.capacity, this.dirtyCount + 1);
  }

  /** Advances the clock and uploads the slots written since the last step. */
  step(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    this.flush();
  }

  /** Number of particles still alive (tests, debug). Scans the pool; not for per-frame use. */
  aliveCount(): number {
    const a = this.start.array as Float32Array;
    const v = this.vel.array as Float32Array;
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const age = this.time - a[i * 4 + 3];
      if (age >= 0 && age < v[i * 4 + 3]) n++;
    }
    return n;
  }

  /** Kills every particle (reset). */
  clear(): void {
    const a = this.start.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) a[i * 4 + 3] = DEAD;
    this.dirtyFrom = 0;
    this.dirtyCount = this.capacity;
    this.flush();
  }

  private flush(): void {
    if (this.dirtyFrom < 0) return;
    const from = this.dirtyFrom;
    const count = this.dirtyCount;
    for (const [attr, size] of [
      [this.start, 4],
      [this.vel, 4],
      [this.shape, 4],
      [this.color, 3],
    ] as const) {
      attr.clearUpdateRanges();
      if (from + count <= this.capacity) {
        attr.addUpdateRange(from * size, count * size);
      } else {
        // The written range wrapped around the end of the ring buffer.
        attr.addUpdateRange(from * size, (this.capacity - from) * size);
        attr.addUpdateRange(0, (from + count - this.capacity) * size);
      }
      attr.needsUpdate = true;
    }
    this.dirtyFrom = -1;
    this.dirtyCount = 0;
  }
}
