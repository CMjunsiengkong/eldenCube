/**
 * Visual effects helpers (ARCHITECTURE §3 fx/effects.ts): hit flash timer, squash, color fade,
 * flat ground discs (slam shadow, warning circles), the glowing shockwave band (1.5b), the Royal
 * Rebuke spike burst (1.5b) and debris puffs.
 * All meshes are created once and reused; nothing is allocated per frame.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import { CONFIG } from '../config';
import { clamp01, randRange } from '../util/math';
import type { Rng } from '../util/rng';
import { createPiece, randomSpin, stepDebris, type DebrisPiece } from './debris';

const H = CONFIG.boss.hit;

/** A countdown timer that is "on" while time remains. */
export class Timer {
  left = 0;
  start(seconds: number): void {
    this.left = seconds;
  }
  step(dt: number): void {
    this.left = Math.max(0, this.left - dt);
  }
  get active(): boolean {
    return this.left > 0;
  }
  clear(): void {
    this.left = 0;
  }
}

/**
 * Squash that springs back to 1 over exactly `squashReturn` seconds (GD §6.3): a damped
 * oscillation that starts at the squash factor and ends at rest.
 */
export class Squash {
  private t = Infinity;

  start(): void {
    this.t = 0;
  }

  clear(): void {
    this.t = Infinity;
  }

  step(dt: number): void {
    this.t += dt;
  }

  /** Current weight in [−1, 1]: 1 = fully squashed, 0 = at rest. */
  weight(): number {
    const u = this.t / H.squashReturn;
    if (u >= 1) return 0;
    return (1 - u) * (1 - u) * Math.cos(2 * Math.PI * H.squashWobbles * u);
  }

  /** Writes the scale into (x, y, z) for the given squash weight. */
  scale(out: { x: number; y: number; z: number }): void {
    const w = this.weight();
    out.x = 1 + (H.squash.x - 1) * w;
    out.y = 1 + (H.squash.y - 1) * w;
    out.z = 1 + (H.squash.z - 1) * w;
  }
}

/** Linear 0 → 1 progress over a duration (e.g. the rage color fade). */
export class Fade {
  private t = 0;
  private duration = 1;
  private running = false;

  start(duration: number): void {
    this.t = 0;
    this.duration = duration;
    this.running = true;
  }

  clear(): void {
    this.t = 0;
    this.running = false;
  }

  step(dt: number): void {
    if (this.running) this.t += dt;
  }

  get value(): number {
    return this.running ? clamp01(this.t / this.duration) : 0;
  }
}

/** A flat, transparent disc lying on the ground (slam shadow, warning circle). */
export class GroundDisc {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  private readonly lift: number;

  constructor(geometry: CircleGeometry, color: number, lift: number) {
    this.lift = lift;
    this.material = new MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
  }

  show(scene: Scene, x: number, z: number, opacity: number): void {
    this.mesh.position.set(x, this.lift, z);
    this.material.opacity = opacity;
    if (!this.mesh.parent) scene.add(this.mesh);
  }

  setOpacity(opacity: number): void {
    this.material.opacity = opacity;
  }

  get visible(): boolean {
    return this.mesh.parent !== null;
  }

  hide(): void {
    this.mesh.removeFromParent();
  }
}

/** Shared circle geometry factory (one geometry per radius). */
export const discGeometry = (radius: number): CircleGeometry => new CircleGeometry(radius, 32);

const BAND_VERTEX = /* glsl */ `
attribute vec3 aBand; // x: 0 inner .. 1 outer, y: 0 bottom .. 1 top, z: angle 0 .. 1
varying vec3 vBand;
void main() {
  vBand = aBand;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BAND_FRAGMENT = /* glsl */ `
varying vec3 vBand;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uOpacity;
uniform float uTime;
void main() {
  float across = 1.0 - abs(vBand.x - 0.5) * 2.0; // 1 in the middle of the band
  float a6 = vBand.z * 6.2831853;
  float streak = 0.78 + 0.22 * sin(a6 * 26.0 + uTime * 9.0) * sin(a6 * 7.0 - uTime * 5.0);
  float hot = smoothstep(0.25, 1.0, across) * (1.0 - 0.55 * vBand.y);
  vec3 col = mix(uColor, uCore, hot) * streak;
  float a = uOpacity * (0.6 + 0.4 * across) * (1.0 - 0.45 * vBand.y);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

/**
 * The Cube Slam shockwave (GD §6.5 A): a band exactly 1.0 m wide and 0.3 m tall around the
 * impact, drawn as a glowing energy band (1.5b). One mesh (top face + inner and outer walls) whose
 * vertices are rewritten in place when the radius changes, so the width stays exactly 1.0 m.
 */
export class ShockwaveRing {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly attr: BufferAttribute;
  private readonly segments: number;

  private readonly width: number;
  private readonly height: number;

  constructor(width: number = CONFIG.slam.ringWidth, height: number = CONFIG.slam.ringHeight, color: number = CONFIG.colors.shockwave) {
    const S = CONFIG.slam;
    this.width = width;
    this.height = height;
    this.segments = S.ringSegments;
    const n = this.segments + 1;
    this.positions = new Float32Array(n * 4 * 3);
    const band = new Float32Array(n * 4 * 3);
    const geo = new BufferGeometry();
    this.attr = new BufferAttribute(this.positions, 3);
    geo.setAttribute('position', this.attr);
    // Per boundary j: 0 inner-bottom, 1 inner-top, 2 outer-top, 3 outer-bottom.
    const corners = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    for (let j = 0; j <= this.segments; j++) {
      for (let k = 0; k < 4; k++) {
        const o = (j * 4 + k) * 3;
        band[o] = corners[k][0];
        band[o + 1] = corners[k][1];
        band[o + 2] = j / this.segments;
      }
    }
    geo.setAttribute('aBand', new BufferAttribute(band, 3));
    const idx: number[] = [];
    const v = (j: number, k: number): number => j * 4 + k;
    for (let j = 0; j < this.segments; j++) {
      for (const [a, b] of [
        [1, 2], // top
        [2, 3], // outer wall
        [0, 1], // inner wall
      ] as const) {
        idx.push(v(j, a), v(j, b), v(j + 1, b), v(j, a), v(j + 1, b), v(j + 1, a));
      }
    }
    geo.setIndex(idx);
    this.material = new ShaderMaterial({
      vertexShader: BAND_VERTEX,
      fragmentShader: BAND_FRAGMENT,
      uniforms: {
        uColor: { value: new Color(color) },
        uCore: { value: new Color(CONFIG.colors.shockwaveCore) },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending, // true colors on the green floor (additive turns orange yellow)
      side: DoubleSide,
      toneMapped: false,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false; // the bounding sphere would change with every radius
    this.mesh.renderOrder = 3;
    this.setRadius(S.ringStartRadius);
  }

  get visible(): boolean {
    return this.mesh.parent !== null;
  }

  setOpacity(opacity: number): void {
    this.material.uniforms.uOpacity.value = opacity;
  }

  /** Simulation time for the flickering streaks. */
  setTime(t: number): void {
    this.material.uniforms.uTime.value = t;
  }

  setRadius(r: number): void {
    const inner = Math.max(0, r - this.width / 2);
    const outer = r + this.width / 2;
    const h = this.height;
    const p = this.positions;
    for (let j = 0; j <= this.segments; j++) {
      const a = (j / this.segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const o = j * 12;
      p[o] = inner * c; p[o + 1] = 0; p[o + 2] = inner * s;
      p[o + 3] = inner * c; p[o + 4] = h; p[o + 5] = inner * s;
      p[o + 6] = outer * c; p[o + 7] = h; p[o + 8] = outer * s;
      p[o + 9] = outer * c; p[o + 10] = 0; p[o + 11] = outer * s;
    }
    this.attr.needsUpdate = true;
  }

  show(scene: Scene, x: number, z: number): void {
    this.mesh.position.set(x, 0, z);
    this.setOpacity(1);
    if (!this.mesh.parent) scene.add(this.mesh);
  }

  hide(): void {
    this.mesh.removeFromParent();
  }
}

/** A glowing outline ring lying on the ground (the Slam telegraph outline, 1.5b). */
export class GroundRing {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;

  constructor(inner: number, outer: number, color: number, lift: number) {
    const geo = new RingGeometry(inner, outer, 48);
    geo.rotateX(-Math.PI / 2);
    this.material = new MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.position.y = lift;
    this.mesh.renderOrder = 2;
  }

  show(scene: Scene, x: number, z: number, opacity: number): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    this.material.opacity = opacity;
    if (!this.mesh.parent) scene.add(this.mesh);
  }

  hide(): void {
    this.mesh.removeFromParent();
  }
}

const RS = CONFIG.rebuke.spikes;
const spikeQ = new Quaternion();
const spikeM = new Matrix4();
const spikeP = new Vector3();
const spikeS = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * The Royal Rebuke burst (GD §6.5 D, 1.5b): 2 staggered rows of radial spikes (cones) in one
 * instanced mesh. `setTip(r)` extends every spike so its tip is `r` m from the boss center.
 */
export class SpikeBurst {
  readonly mesh: InstancedMesh;
  private readonly count: number;

  constructor() {
    // Unit cone: base at x = 0, tip at x = 1 (pointing outward along +X).
    const geo = new ConeGeometry(RS.baseRadius, 1, RS.radialSegments);
    geo.translate(0, 0.5, 0);
    geo.rotateZ(-Math.PI / 2);
    const color = new Color(CONFIG.colors.rebukeRing);
    const mat = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: RS.glow, metalness: 0.3, roughness: 0.4 });
    this.count = RS.perRow * RS.rows.length;
    this.mesh = new InstancedMesh(geo, mat, this.count);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }

  get visible(): boolean {
    return this.mesh.parent !== null;
  }

  show(scene: Scene, x: number, z: number, tip: number): void {
    this.mesh.position.set(x, 0, z);
    this.setTip(tip);
    if (!this.mesh.parent) scene.add(this.mesh);
  }

  /** Every spike starts at `RS.innerRadius` (inside the body) and ends at radius `tip`. */
  setTip(tip: number): void {
    const len = Math.max(0.01, tip - RS.innerRadius);
    let i = 0;
    for (let row = 0; row < RS.rows.length; row++) {
      const offset = row % 2 === 0 ? 0 : 0.5; // the rows are offset by half a spike
      for (let k = 0; k < RS.perRow; k++, i++) {
        const a = ((k + offset) / RS.perRow) * Math.PI * 2;
        // A small fixed pitch per spike looks less mechanical.
        const pitch = RS.pitchJitter * Math.sin(k * 2.39 + row * 1.3);
        spikeQ.setFromAxisAngle(UP, -a);
        spikeP.set(Math.cos(a) * RS.innerRadius, RS.rows[row], Math.sin(a) * RS.innerRadius);
        spikeS.set(len, 1, 1);
        spikeM.compose(spikeP, spikeQ, spikeS);
        if (pitch !== 0) spikeM.multiply(PITCH.makeRotationZ(pitch));
        this.mesh.setMatrixAt(i, spikeM);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hide(): void {
    this.mesh.removeFromParent();
  }
}
const PITCH = new Matrix4();

export type PuffColor = 'crown' | 'shockwave' | 'warning' | 'rebuke';

/**
 * Small debris puffs (shard landing, and objects removed when an attack is cancelled — D9).
 * A fixed pool of tiny cubes; each lives `puffLifetime` seconds.
 */
export class Puffs {
  /** All pieces share one instanced mesh: one draw call however many puffs are alive (1.6). */
  private readonly mesh: InstancedMesh;
  private readonly pool: DebrisPiece[] = [];
  private readonly active: DebrisPiece[] = [];
  private readonly life = new Map<DebrisPiece, number>();
  private readonly tint = new Map<DebrisPiece, Color>();
  private readonly colors: Record<PuffColor, Color>;
  private next = 0;
  private readonly scene: Scene;
  private readonly rng: Rng;

  constructor(scene: Scene, rng: Rng) {
    this.scene = scene;
    this.rng = rng;
    const S = CONFIG.fx.puff;
    const C = CONFIG.colors;
    this.colors = {
      crown: new Color(C.crown),
      shockwave: new Color(C.shockwave),
      warning: new Color(C.warning),
      rebuke: new Color(C.rebukeRing),
    };
    this.mesh = new InstancedMesh(new BoxGeometry(S.size, S.size, S.size), new MeshStandardMaterial({ color: 0xffffff }), S.pool);
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < S.pool; i++) {
      this.mesh.setColorAt(i, this.colors.crown);
      this.pool.push(createPiece(new Object3D(), S.size / 2));
    }
  }

  /** One puff of `pieces` cubes at (x, y, z). Reuses the oldest pieces when the pool is full. */
  spawn(x: number, y: number, z: number, color: PuffColor, pieces: number = CONFIG.fx.puff.pieces): void {
    const S = CONFIG.fx.puff;
    for (let i = 0; i < pieces; i++) {
      const p = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      const o = p.object;
      this.tint.set(p, this.colors[color]);
      o.position.set(x, Math.max(y, p.groundR), z);
      o.rotation.set(0, 0, 0);
      const a = this.rng() * Math.PI * 2;
      const sp = randRange(this.rng, S.speed[0], S.speed[1]);
      p.vel.set(Math.cos(a) * sp, sp, Math.sin(a) * sp);
      randomSpin(this.rng, CONFIG.boss.defeat.maxSpin, p.angVel);
      p.asleep = false;
      if (!this.life.has(p)) this.active.push(p);
      this.life.set(p, S.lifetime);
    }
    if (!this.mesh.parent) this.scene.add(this.mesh);
    this.sync();
  }

  step(dt: number): void {
    stepDebris(this.active, dt);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      const left = (this.life.get(p) ?? 0) - dt;
      if (left > 0) {
        this.life.set(p, left);
        continue;
      }
      this.life.delete(p);
      this.active[i] = this.active[this.active.length - 1];
      this.active.pop();
    }
    if (this.active.length === 0) this.mesh.removeFromParent();
    this.sync();
  }

  /** Writes the live pieces into the first instance slots. */
  private sync(): void {
    const m = this.mesh;
    for (let i = 0; i < this.active.length; i++) {
      const p = this.active[i];
      p.object.updateMatrix();
      m.setMatrixAt(i, p.object.matrix);
      m.setColorAt(i, this.tint.get(p) ?? this.colors.crown);
    }
    m.count = this.active.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** The instanced mesh (shader warm-up). */
  get warmupPieces(): readonly Mesh[] {
    return [this.mesh];
  }

  /** Visible puff pieces (tests, debug). */
  get count(): number {
    return this.active.length;
  }

  clear(): void {
    this.active.length = 0;
    this.life.clear();
    this.mesh.count = 0;
    this.mesh.removeFromParent();
  }
}
