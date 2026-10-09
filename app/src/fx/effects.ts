/**
 * Visual effects helpers (ARCHITECTURE §3 fx/effects.ts): hit flash timer, squash, color fade,
 * flat ground discs (slam shadow, warning circles), the shockwave ring mesh and debris puffs.
 * All meshes are created once and reused; nothing is allocated per frame.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
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

/**
 * The Cube Slam shockwave (GD §6.5 A): a flat band 1.0 m wide and 0.3 m tall around the boss.
 * One mesh (top face + inner and outer walls) whose vertices are rewritten in place when the
 * radius changes, so the width stays exactly 1.0 m at every radius.
 */
export class ShockwaveRing {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  private readonly positions: Float32Array;
  private readonly attr: BufferAttribute;
  private readonly segments: number;

  constructor() {
    const S = CONFIG.slam;
    this.segments = S.ringSegments;
    const n = this.segments + 1;
    this.positions = new Float32Array(n * 4 * 3);
    const geo = new BufferGeometry();
    this.attr = new BufferAttribute(this.positions, 3);
    geo.setAttribute('position', this.attr);
    // Per boundary j: 0 inner-bottom, 1 inner-top, 2 outer-top, 3 outer-bottom.
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
    this.material = new MeshBasicMaterial({ color: CONFIG.colors.shockwave, transparent: true, side: DoubleSide });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false; // the bounding sphere would change with every radius
    this.setRadius(S.ringStartRadius);
  }

  setRadius(r: number): void {
    const S = CONFIG.slam;
    const inner = Math.max(0, r - S.ringWidth / 2);
    const outer = r + S.ringWidth / 2;
    const h = S.ringHeight;
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
    this.material.opacity = 1;
    if (!this.mesh.parent) scene.add(this.mesh);
  }

  hide(): void {
    this.mesh.removeFromParent();
  }
}

export type PuffColor = 'crown' | 'shockwave' | 'warning';

/**
 * Small debris puffs (shard landing, and objects removed when an attack is cancelled — D9).
 * A fixed pool of tiny cubes; each lives `puffLifetime` seconds.
 */
export class Puffs {
  private readonly pool: DebrisPiece[] = [];
  private readonly active: DebrisPiece[] = [];
  private readonly life = new Map<DebrisPiece, number>();
  private readonly materials: Record<PuffColor, MeshStandardMaterial>;
  private next = 0;
  private readonly scene: Scene;
  private readonly rng: Rng;

  constructor(scene: Scene, rng: Rng) {
    this.scene = scene;
    this.rng = rng;
    const S = CONFIG.shards;
    const C = CONFIG.colors;
    this.materials = {
      crown: new MeshStandardMaterial({ color: C.crown }),
      shockwave: new MeshStandardMaterial({ color: C.shockwave }),
      warning: new MeshStandardMaterial({ color: C.warning }),
    };
    const geo = new BoxGeometry(S.puffSize, S.puffSize, S.puffSize);
    for (let i = 0; i < S.puffPool; i++) {
      const m = new Mesh(geo, this.materials.crown);
      m.castShadow = false;
      this.pool.push(createPiece(m, S.puffSize / 2));
    }
  }

  /** One puff of `puffPieces` cubes at (x, y, z). Reuses the oldest pieces when the pool is full. */
  spawn(x: number, y: number, z: number, color: PuffColor): void {
    const S = CONFIG.shards;
    for (let i = 0; i < S.puffPieces; i++) {
      const p = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      const m = p.object as Mesh;
      m.material = this.materials[color];
      m.position.set(x, Math.max(y, p.groundR), z);
      m.rotation.set(0, 0, 0);
      const a = this.rng() * Math.PI * 2;
      const sp = randRange(this.rng, S.puffSpeed[0], S.puffSpeed[1]);
      p.vel.set(Math.cos(a) * sp, sp, Math.sin(a) * sp);
      randomSpin(this.rng, CONFIG.boss.defeat.maxSpin, p.angVel);
      p.asleep = false;
      if (!this.life.has(p)) this.active.push(p);
      this.life.set(p, S.puffLifetime);
      if (!m.parent) this.scene.add(m);
    }
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
      p.object.removeFromParent();
      this.active[i] = this.active[this.active.length - 1];
      this.active.pop();
    }
  }

  /** Visible puff pieces (tests, debug). */
  get count(): number {
    return this.active.length;
  }

  clear(): void {
    for (const p of this.active) p.object.removeFromParent();
    this.active.length = 0;
    this.life.clear();
  }
}
