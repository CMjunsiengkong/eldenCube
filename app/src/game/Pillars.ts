/**
 * Crown pillars (GD §8a, 1.6 T1): four stone pillars on the diagonals, 15 m from the center.
 *
 * - `PillarField` is the pure rule set (tested): which pillars stand, the circle push-out for the
 *   player, and the "shadows". Any boss hit collapses a pillar at once (no health). A collapse by a
 *   shieldable wave (Slam/Hop ring, Rebuke, Shove, Cone) leaves a shadow for that wave's short life:
 *   a hit from the same origin is blocked when the pillar stood between the origin and the player.
 *   Charge, Beam, Crown Rain and meteors collapse it and go straight through.
 * - `PillarView` draws the standing pillars as one InstancedMesh (dithered see-through when one hides
 *   the player from the camera) and the rubble as another (debris physics, settles until reset).
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { CONFIG } from '../config';
import { createPiece, randomSpin, stepDebris, type DebrisPiece } from '../fx/debris';
import { mergePainted, paint } from '../fx/materials';
import { randRange } from '../util/math';
import type { Rng } from '../util/rng';

const PL = CONFIG.pillars;
const EPS = 1e-9;

export interface Pillar {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  standing: boolean;
  /** Hits left (1.6 playtest: 3). */
  health: number;
  /** No further damage until this runs out (one wave = one hit). */
  cooldown: number;
  /** Direction of the last hit (x, z, away from the attacker): the view leans the pillar that way. */
  leanX: number;
  leanZ: number;
}

interface Shadow {
  ox: number;
  oz: number;
  px: number;
  pz: number;
  r: number;
  life: number;
}

/**
 * Pure (tested): the pillar at (cx, cz) with radius r stands between the origin (ox, oz) and the
 * player (px, pz): the segment passes within r of its center, and the pillar is nearer the origin.
 */
export function pillarBlocks(ox: number, oz: number, px: number, pz: number, cx: number, cz: number, r: number): boolean {
  const ax = px - ox;
  const az = pz - oz;
  const len2 = ax * ax + az * az;
  if (len2 < EPS) return false;
  const t = ((cx - ox) * ax + (cz - oz) * az) / len2;
  if (t <= 0 || t >= 1) return false; // behind the origin or beyond the player
  const dx = ox + ax * t - cx;
  const dz = oz + az * t - cz;
  return dx * dx + dz * dz <= r * r + EPS;
}

export class PillarField {
  readonly pillars: Pillar[] = [];
  private readonly shadows: Shadow[] = [];
  /** Pillars collapsed / damaged since the last `takeEvents` (indices; for the view and sounds). */
  private readonly collapsedNow: number[] = [];
  private readonly damagedNow: number[] = [];

  constructor() {
    for (const deg of PL.angles) {
      const a = (deg * Math.PI) / 180;
      this.pillars.push({ x: Math.sin(a) * PL.distance, z: Math.cos(a) * PL.distance, r: PL.radius, standing: true, health: PL.health, cooldown: 0, leanX: 0, leanZ: 0 });
    }
  }

  reset(): void {
    for (const p of this.pillars) {
      p.standing = true;
      p.health = PL.health;
      p.cooldown = 0;
      p.leanX = p.leanZ = 0;
    }
    this.shadows.length = 0;
    this.collapsedNow.length = 0;
    this.damagedNow.length = 0;
  }

  get standingCount(): number {
    return this.pillars.filter((p) => p.standing).length;
  }

  /**
   * A boss hit on pillar `i` from (ox, oz). It costs 1 health (at most once per `hitCooldown`, so a
   * wave counts once); `instant` (Charge, Beam) collapses it at once. With `shield`, that wave is
   * blocked behind the pillar for `life` s — even while the cooldown runs, and whether or not the
   * pillar survives. Returns 'collapsed', 'damaged' or null (no damage this time).
   */
  hit(i: number, shield: boolean, ox: number, oz: number, life: number, instant = false): 'collapsed' | 'damaged' | null {
    const p = this.pillars[i];
    if (!p.standing) return null;
    if (shield && life > 0) this.addShadow(ox, oz, p, life);
    if (p.cooldown > 0 && !instant) return null;
    p.health = instant ? 0 : p.health - 1;
    p.cooldown = PL.hitCooldown;
    const d = Math.hypot(p.x - ox, p.z - oz) || 1;
    p.leanX = (p.x - ox) / d;
    p.leanZ = (p.z - oz) / d;
    if (p.health <= 0) {
      p.health = 0;
      p.standing = false;
      this.collapsedNow.push(i);
      return 'collapsed';
    }
    this.damagedNow.push(i);
    return 'damaged';
  }

  /** Collapses pillar `i` at once (tests, debug). */
  collapse(i: number, shield = false, ox = 0, oz = 0, life = 0): void {
    this.hit(i, shield, ox, oz, life, true);
  }

  /** The pillars that collapsed / took damage since the last call (for the view and sounds). */
  takeEvents(collapsed: number[], damaged: number[]): void {
    collapsed.length = 0;
    collapsed.push(...this.collapsedNow);
    this.collapsedNow.length = 0;
    damaged.length = 0;
    damaged.push(...this.damagedNow);
    this.damagedNow.length = 0;
  }

  /** One shadow per wave origin and pillar: refreshed, never duplicated. */
  private addShadow(ox: number, oz: number, p: Pillar, life: number): void {
    for (const s of this.shadows) {
      if (s.px === p.x && s.pz === p.z && Math.hypot(s.ox - ox, s.oz - oz) <= 0.6) {
        s.life = Math.max(s.life, life);
        return;
      }
    }
    this.shadows.push({ ox, oz, px: p.x, pz: p.z, r: p.r + PL.shadowMargin, life });
  }

  step(dt: number): void {
    for (const p of this.pillars) p.cooldown = Math.max(0, p.cooldown - dt);
    for (let i = this.shadows.length - 1; i >= 0; i--) {
      this.shadows[i].life -= dt;
      if (this.shadows[i].life <= 0) this.shadows.splice(i, 1);
    }
  }

  /** A hit from origin (ox, oz) on the player at (px, pz) is blocked by a shadow from that origin. */
  blocks(ox: number, oz: number, px: number, pz: number): boolean {
    for (const s of this.shadows) {
      if (Math.hypot(s.ox - ox, s.oz - oz) > 0.6) continue; // another wave
      if (pillarBlocks(ox, oz, px, pz, s.px, s.pz, s.r)) return true;
    }
    return false;
  }

  /**
   * Pushes a circle (x, z, radius) out of every standing pillar; returns the corrected position in
   * `out` and true if it moved (the caller removes the inward velocity).
   */
  pushOut(x: number, z: number, radius: number, out: { x: number; z: number; nx: number; nz: number }): boolean {
    let moved = false;
    out.x = x;
    out.z = z;
    for (const p of this.pillars) {
      if (!p.standing) continue;
      const dx = out.x - p.x;
      const dz = out.z - p.z;
      const d = Math.hypot(dx, dz);
      const min = p.r + radius;
      if (d >= min) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      out.x = p.x + nx * min;
      out.z = p.z + nz * min;
      out.nx = nx;
      out.nz = nz;
      moved = true;
    }
    return moved;
  }
}

// --- view ------------------------------------------------------------------------------------------

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpP = new Vector3();
const tmpAxis = new Vector3();
const tmpColor = new Color();

function pillarGeometry(): ReturnType<typeof mergePainted> {
  const r = PL.radius;
  const h = PL.height;
  const C = CONFIG.colors;
  const stone = 0xa3a5ac;
  const dark = 0x6e7078;
  return mergePainted([
    paint(new CylinderGeometry(r * 1.45, r * 1.6, 0.35, 8).translate(0, 0.175, 0), dark), // plinth
    paint(new CylinderGeometry(r, r * 1.08, h - 0.8, 8).translate(0, 0.35 + (h - 0.8) / 2, 0), stone), // shaft
    paint(new CylinderGeometry(r * 1.4, r * 1.05, 0.45, 8).translate(0, h - 0.225, 0), dark), // capital
    paint(new CylinderGeometry(r * 0.35, r * 0.35, 0.25, 6).translate(0, h + 0.12, 0), C.crown), // gold finial
  ]);
}

export class PillarView {
  private readonly standing: InstancedMesh;
  private readonly rubble: InstancedMesh;
  private readonly fadeAttr: InstancedBufferAttribute;
  private readonly fade: number[];
  private readonly pieces: DebrisPiece[] = [];
  private readonly field: PillarField;
  private readonly rng: Rng;
  private readonly chunkScale: number[] = [];

  constructor(scene: Scene, field: PillarField, rng: Rng) {
    this.field = field;
    this.rng = rng;
    const n = field.pillars.length;
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    // Dithered see-through per instance (screen-door), so shadows and depth stay correct.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          if (vFade < 0.999) {
            vec2 c = mod(floor(gl_FragCoord.xy), 4.0);
            float b = mod(c.x * 4.0 + c.y * 9.0, 16.0) / 16.0;
            if (b >= vFade) discard;
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'pillar-dither';
    const geo = pillarGeometry();
    this.fade = new Array<number>(n).fill(1);
    this.fadeAttr = new InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
    geo.setAttribute('aFade', this.fadeAttr);
    this.standing = new InstancedMesh(geo, mat, n);
    this.standing.castShadow = true;
    this.standing.receiveShadow = true;
    this.standing.frustumCulled = false;
    scene.add(this.standing);

    const rubbleMat = new MeshStandardMaterial({ color: 0x7d7f87, roughness: 0.9 });
    const total = n * PL.chunks;
    this.rubble = new InstancedMesh(new BoxGeometry(1, 1, 1), rubbleMat, total);
    this.rubble.castShadow = false;
    this.rubble.receiveShadow = true;
    this.rubble.frustumCulled = false;
    this.rubble.count = 0;
    for (let i = 0; i < total; i++) {
      this.pieces.push(createPiece(new Object3D(), PL.chunkSize * 0.35));
      this.chunkScale.push(1);
    }
    scene.add(this.rubble);
    this.sync();
  }

  /** Breaks pillar `i` into rubble flying away from (fromX, fromZ). */
  breakApart(i: number, fromX: number, fromZ: number): void {
    const p = this.field.pillars[i];
    const r = this.rng;
    let dx = p.x - fromX;
    let dz = p.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    for (let k = 0; k < PL.chunks; k++) {
      const piece = this.pieces[i * PL.chunks + k];
      const o = piece.object;
      const h = ((k + 0.5) / PL.chunks) * PL.height;
      o.position.set(p.x + (r() - 0.5) * 0.4, h, p.z + (r() - 0.5) * 0.4);
      o.rotation.set(r() * 3, r() * 3, r() * 3);
      const sp = randRange(r, PL.chunkSpeed[0], PL.chunkSpeed[1]);
      const a = Math.atan2(dx, dz) + (r() - 0.5) * 1.6;
      piece.vel.set(Math.sin(a) * sp, randRange(r, PL.chunkUp[0], PL.chunkUp[1]) * (0.4 + h / PL.height), Math.cos(a) * sp);
      randomSpin(r, 6, piece.angVel);
      piece.asleep = false;
      this.chunkScale[i * PL.chunks + k] = PL.chunkSize * (0.7 + 0.6 * r());
    }
    this.sync();
  }

  /** Simulation step: rubble physics. */
  step(dt: number): void {
    const live: DebrisPiece[] = [];
    for (let i = 0; i < this.field.pillars.length; i++) {
      if (this.field.pillars[i].standing) continue;
      for (let k = 0; k < PL.chunks; k++) live.push(this.pieces[i * PL.chunks + k]);
    }
    stepDebris(live, dt);
    this.sync();
  }

  /**
   * Real time: a pillar between the camera and the player dithers out (x, z of both; the pillar must
   * be nearer the camera than the player).
   */
  updateFade(frameDt: number, camX: number, camZ: number, px: number, pz: number): void {
    const k = Math.min(1, PL.fadeRate * frameDt);
    let changed = false;
    this.field.pillars.forEach((p, i) => {
      const want = p.standing && pillarBlocks(camX, camZ, px, pz, p.x, p.z, p.r + 0.6) ? PL.fadeOpacity : 1;
      const f = this.fade[i] + (want - this.fade[i]) * k;
      if (Math.abs(f - this.fade[i]) > 1e-4) changed = true;
      this.fade[i] = Math.abs(f - want) < 0.01 ? want : f;
      (this.fadeAttr.array as Float32Array)[i] = this.fade[i];
    });
    if (changed) this.fadeAttr.needsUpdate = true;
  }

  reset(): void {
    this.fade.fill(1);
    (this.fadeAttr.array as Float32Array).fill(1);
    this.fadeAttr.needsUpdate = true;
    this.sync();
  }

  /** Shader warm-up. */
  get scenePool(): readonly InstancedMesh[] {
    return [this.standing, this.rubble];
  }

  private sync(): void {
    const pillars = this.field.pillars;
    tmpS.set(1, 1, 1);
    tmpQ.identity();
    for (let i = 0; i < pillars.length; i++) {
      const p = pillars[i];
      if (p.standing) {
        // Damage (1.6 playtest): each lost health tilts it away from the last hit and darkens it.
        const lost = PL.health - p.health;
        tmpAxis.set(p.leanZ, 0, -p.leanX);
        if (lost > 0 && tmpAxis.lengthSq() > 1e-6) tmpQ.setFromAxisAngle(tmpAxis.normalize(), (lost * PL.damageLean * Math.PI) / 180);
        else tmpQ.identity();
        tmpM.compose(tmpP.set(p.x, 0, p.z), tmpQ, tmpS);
        tmpColor.setScalar(1 - PL.damageDarken * lost);
      } else {
        tmpM.makeScale(0, 0, 0);
        tmpColor.setScalar(1);
      }
      this.standing.setMatrixAt(i, tmpM);
      this.standing.setColorAt(i, tmpColor);
    }
    this.standing.instanceMatrix.needsUpdate = true;
    if (this.standing.instanceColor) this.standing.instanceColor.needsUpdate = true;
    let n = 0;
    for (let i = 0; i < pillars.length; i++) {
      if (pillars[i].standing) continue;
      for (let k = 0; k < PL.chunks; k++) {
        const j = i * PL.chunks + k;
        const o = this.pieces[j].object;
        const s = this.chunkScale[j];
        o.scale.set(s, s * 0.8, s);
        o.updateMatrix();
        this.rubble.setMatrixAt(n++, o.matrix);
      }
    }
    this.rubble.count = n;
    this.rubble.instanceMatrix.needsUpdate = true;
  }
}
