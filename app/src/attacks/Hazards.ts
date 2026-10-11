/**
 * Hazards (GAME_DESIGN §6.5, ARCHITECTURE §4.4): everything that keeps moving after the boss is
 * free — shockwave rings, Crown Rain shards and their warning circles, and the Rebuke ring
 * (visual). `Game` steps them and checks them against the player every FIGHT step. They are
 * removed (optionally with a puff) by the rage transition, defeat, the player's death and reset.
 *
 * Shards and circles are drawn with InstancedMesh: one shard mesh for all waves and one circle
 * mesh per wave (per-wave pulsing), plus one separate disc for wave 0's center circle (its own
 * pulse rate with Staggered Rain). Nothing is allocated per frame.
 *
 * 1.5b visuals: shards are fireballs (glowing cores with fire trails) that explode and leave
 * burning marks; shockwave rings are glowing bands with embers riding their front; the Rebuke is
 * a spike burst. All of it is visual: the kill rules are unchanged.
 */
import {
  CircleGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Mesh,
  type Scene,
} from 'three';
import { CONFIG } from '../config';
import { GroundDisc, discGeometry, ShockwaveRing, SpikeBurst, type Puffs } from '../fx/effects';
import type { Vfx } from '../fx/vfx';
import { easeIn, easeOut } from '../util/math';
import { inCircle, inRingBand, sphereSphere, type Vec3Like } from '../systems/collision';
import type { Sphere } from '../entities/Player';
import { SILENT, type SoundSink } from './Attack';

const SL = CONFIG.slam;
const RN = CONFIG.rain;
const RB = CONFIG.rebuke;
const G = CONFIG.fx.gravity;
const PLAYER_R = CONFIG.player.radius;
const EPS = 1e-9;
export const WAVES = 3;
const MAX = RN.maxPerWave;
const RING_POOL = 3;

interface Ring {
  readonly mesh: ShockwaveRing;
  readonly center: Vector3;
  radius: number;
  speed: number;
  alive: boolean;
  /** Fractional embers carried to the next step. */
  emberAcc: number;
}

interface Shard {
  readonly pos: Vector3;
  readonly vel: Vector3;
  readonly target: Vector3;
  flightTime: number;
  t: number;
  /** 'idle' (unused), 'placed' (circle shown, not launched), 'flying'. */
  state: 'idle' | 'placed' | 'flying';
  landedNow: boolean;
  spin: number;
}

interface Wave {
  readonly shards: Shard[];
  count: number;
  readonly circles: InstancedMesh;
  readonly circleMat: MeshBasicMaterial;
  pulseHz: number;
  t: number;
  /** A shard of this wave landed in the current step (one `shard_land` per wave moment). */
  landedThisStep: boolean;
}

const tmpM = new Matrix4();
const tmpS = new Vector3();
const tmpP = new Vector3();
const FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

export class Hazards {
  sound: SoundSink = SILENT;
  private readonly scene: Scene;
  private readonly puffs: Puffs;
  private readonly rings: Ring[] = [];
  private readonly waves: Wave[] = [];
  private readonly shardMesh: InstancedMesh;
  /** Wave 0's center circle as its own disc (Staggered Rain pulses it slower). */
  private readonly centerDisc: GroundDisc;
  private centerPulseHz: number = RN.circlePulseHz;
  private readonly spikes = new SpikeBurst();
  private rebukeT = -1;
  private readonly source = new Vector3();
  private readonly dummy = new Object3D();
  private readonly vfx: Vfx | null;
  /** Simulation time (shader streaks). */
  private time = 0;

  constructor(scene: Scene, puffs: Puffs, vfx: Vfx | null = null) {
    this.scene = scene;
    this.puffs = puffs;
    this.vfx = vfx;
    for (let i = 0; i < RING_POOL; i++) this.rings.push({ mesh: new ShockwaveRing(), center: new Vector3(), radius: 0, speed: 0, alive: false, emberAcc: 0 });

    // Fireball cores: unlit, so they glow at night (the trail is drawn by the particles).
    const shardMat = new MeshBasicMaterial({ color: CONFIG.colors.fireballCore, toneMapped: false });
    this.shardMesh = new InstancedMesh(new IcosahedronGeometry(CONFIG.vfx.fireball.coreRadius, 1), shardMat, WAVES * MAX);
    this.shardMesh.castShadow = false;
    this.shardMesh.frustumCulled = false;
    const circleGeo: CircleGeometry = discGeometry(RN.circleRadius);
    for (let w = 0; w < WAVES; w++) {
      const circleMat = new MeshBasicMaterial({ color: CONFIG.colors.warning, transparent: true, depthWrite: false, opacity: RN.circleOpacity });
      const circles = new InstancedMesh(circleGeo, circleMat, MAX);
      circles.frustumCulled = false;
      circles.renderOrder = 1;
      const shards: Shard[] = [];
      for (let i = 0; i < MAX; i++) {
        shards.push({ pos: new Vector3(), vel: new Vector3(), target: new Vector3(), flightTime: 0, t: 0, state: 'idle', landedNow: false, spin: 0 });
      }
      this.waves.push({ shards, count: 0, circles, circleMat, pulseHz: RN.circlePulseHz, t: 0, landedThisStep: false });
    }
    this.centerDisc = new GroundDisc(circleGeo, CONFIG.colors.warning, RN.circleLift);
    this.hideAllInstances();
  }

  // --- spawning ----------------------------------------------------------------------------------

  /** A Slam shockwave ring centered at (x, z), expanding from 2.2 m at `speed` (GD §6.5 A). */
  spawnRing(x: number, z: number, speed: number): void {
    let ring = this.rings.find((r) => !r.alive);
    if (!ring) ring = this.rings.reduce((a, b) => (a.radius > b.radius ? a : b)); // reuse the oldest
    ring.center.set(x, 0, z);
    ring.radius = SL.ringStartRadius;
    ring.speed = speed;
    ring.alive = true;
    ring.emberAcc = 0;
    ring.mesh.setRadius(ring.radius);
    ring.mesh.show(this.scene, x, z);
  }

  /**
   * Shows the warning circles of wave `w` at `targets` (y is ignored). `centerPulseHz`, if given,
   * makes target 0 (wave 0's center) pulse at its own rate.
   */
  placeWave(w: number, targets: readonly Vec3Like[], count: number, pulseHz: number = RN.circlePulseHz, centerPulseHz?: number): void {
    const wave = this.waves[w];
    wave.count = Math.min(count, MAX);
    wave.t = 0;
    wave.pulseHz = pulseHz;
    for (let i = 0; i < MAX; i++) {
      const s = wave.shards[i];
      if (i < wave.count) {
        s.target.set(targets[i].x, RN.landHeight, targets[i].z);
        s.state = 'placed';
      } else {
        s.state = 'idle';
      }
      s.landedNow = false;
    }
    if (w === 0) this.centerPulseHz = centerPulseHz ?? pulseHz;
    this.writeCircles(w);
    if (!wave.circles.parent) this.scene.add(wave.circles);
  }

  /** Launches every placed shard of wave `w` from `from`; shard i flies `flightTime(i)` seconds. */
  launchWave(w: number, from: Vec3Like, flightTime: (i: number) => number): void {
    const wave = this.waves[w];
    for (let i = 0; i < wave.count; i++) {
      const s = wave.shards[i];
      if (s.state !== 'placed') continue;
      const T = flightTime(i);
      s.pos.set(from.x, from.y, from.z);
      // v0 = (target − start − ½ g T²) / T with g = (0, −G, 0); semi-implicit Euler, snap on landing.
      s.vel.set((s.target.x - from.x) / T, (s.target.y - from.y + 0.5 * G * T * T) / T, (s.target.z - from.z) / T);
      s.flightTime = T;
      s.t = 0;
      s.spin = 0;
      s.state = 'flying';
    }
    if (!this.shardMesh.parent) this.scene.add(this.shardMesh);
  }

  /** The Rebuke spike burst (visual; the kill check is in RoyalRebuke). */
  spawnRebuke(x: number, z: number): void {
    this.rebukeT = 0;
    this.spikes.show(this.scene, x, z, RB.startRadius);
  }

  /** During the Rebuke tell (`u` 0 → 1): spike tips poke out of the body as an extra warning. */
  rebukeTell(x: number, z: number, u: number): void {
    if (this.rebukeT >= 0) return;
    const S = RB.spikes;
    this.spikes.show(this.scene, x, z, S.innerRadius + (S.tellTip - S.innerRadius) * easeOut(Math.min(1, u)));
  }

  /** Every normally detached mesh (shader warm-up). */
  get scenePool(): readonly (Mesh | InstancedMesh)[] {
    return [...this.rings.map((r) => r.mesh.mesh), ...this.waves.map((w) => w.circles), this.shardMesh, this.centerDisc.mesh, this.spikes.mesh];
  }

  // --- queries -----------------------------------------------------------------------------------

  /** Any Crown Rain shard still placed or in the air (no new Crown Rain then, GD §6.5). */
  get rainAlive(): boolean {
    for (const w of this.waves) for (let i = 0; i < w.count; i++) if (w.shards[i].state !== 'idle') return true;
    return false;
  }

  /** Live ring radii and their centers (debug wireframes, tests). */
  liveRings(radii: number[], centers?: Vector3[]): number[] {
    radii.length = 0;
    if (centers) centers.length = 0;
    for (const r of this.rings) {
      if (!r.alive) continue;
      radii.push(r.radius);
      centers?.push(r.center);
    }
    return radii;
  }

  /** Positions of the shards in flight (debug wireframes, tests). */
  flyingShards(out: Vector3[]): Vector3[] {
    out.length = 0;
    for (const w of this.waves) for (let i = 0; i < w.count; i++) if (w.shards[i].state === 'flying') out.push(w.shards[i].pos);
    return out;
  }

  /** Targets of wave `w` (tests). */
  waveTargets(w: number): Vector3[] {
    const wave = this.waves[w];
    return wave.shards.slice(0, wave.count).map((s) => s.target);
  }

  /** Flight times of wave `w` (tests). */
  waveFlightTimes(w: number): number[] {
    const wave = this.waves[w];
    return wave.shards.slice(0, wave.count).map((s) => s.flightTime);
  }

  // --- simulation --------------------------------------------------------------------------------

  step(dt: number): void {
    this.time += dt;
    // Rings
    const travel = SL.ringEndRadius - SL.ringStartRadius;
    for (const r of this.rings) {
      if (!r.alive) continue;
      r.radius += r.speed * dt;
      if (r.radius >= SL.ringEndRadius - EPS) {
        r.alive = false;
        r.mesh.hide();
        continue;
      }
      r.mesh.setRadius(r.radius);
      r.mesh.setTime(this.time);
      const u = (r.radius - SL.ringStartRadius) / travel;
      const fade = u <= SL.ringFadeStart ? 1 : Math.max(0, 1 - (u - SL.ringFadeStart) / (1 - SL.ringFadeStart));
      r.mesh.setOpacity(fade);
      if (this.vfx) {
        // Embers ride the front (spawned on the current radius, moving outward at the ring speed).
        r.emberAcc += CONFIG.vfx.ringEmbers.perSecond * dt * fade;
        const n = Math.floor(r.emberAcc);
        r.emberAcc -= n;
        if (n > 0) this.vfx.ringEmbers(r.center.x, r.center.z, r.radius, r.speed, n);
      }
    }

    // Rebuke spikes: shoot out over the burst (slight overshoot), hold, then retract.
    if (this.rebukeT >= 0) {
      this.rebukeT += dt;
      const S = RB.spikes;
      let tip: number;
      if (this.rebukeT <= RB.burst) {
        const u = this.rebukeT / RB.burst;
        tip = RB.startRadius + (RB.endRadius + S.overshoot - RB.startRadius) * easeOut(u);
      } else if (this.rebukeT <= RB.burst + S.hold) {
        const u = (this.rebukeT - RB.burst) / S.hold;
        tip = RB.endRadius + S.overshoot * (1 - u);
      } else {
        const u = Math.min(1, (this.rebukeT - RB.burst - S.hold) / (RB.recovery - S.hold));
        tip = RB.endRadius + (S.innerRadius - RB.endRadius) * easeIn(u);
        if (u >= 1) this.hideRebuke();
      }
      if (this.rebukeT >= 0) this.spikes.setTip(tip);
    }

    // Shards
    let anyFlying = false;
    for (let w = 0; w < WAVES; w++) {
      const wave = this.waves[w];
      wave.t += dt;
      wave.landedThisStep = false;
      let circlesDirty = false;
      for (let i = 0; i < wave.count; i++) {
        const s = wave.shards[i];
        s.landedNow = false;
        if (s.state !== 'flying') continue;
        s.t += dt;
        if (s.t >= s.flightTime - EPS) {
          s.pos.copy(s.target);
          s.state = 'idle';
          s.landedNow = true;
          wave.landedThisStep = true;
          circlesDirty = true;
          if (this.vfx) this.vfx.fireExplosion(s.target.x, s.target.z);
          else this.puffs.spawn(s.target.x, RN.landHeight, s.target.z, 'crown', RN.landPuffPieces);
          continue;
        }
        anyFlying = true;
        s.vel.y -= G * dt;
        s.pos.addScaledVector(s.vel, dt);
        s.spin += RN.spinRate * dt;
        this.vfx?.fireballTrail(s.pos.x, s.pos.y, s.pos.z);
      }
      if (wave.landedThisStep) this.sound.play('shard_land');
      if (circlesDirty) this.writeCircles(w);
      // Pulse
      const pulse = 0.5 * (1 - Math.cos(2 * Math.PI * wave.pulseHz * wave.t));
      wave.circleMat.opacity = RN.circleOpacity * (1 - RN.circlePulseDepth * pulse);
    }
    if (this.centerDisc.visible) {
      const pulse = 0.5 * (1 - Math.cos(2 * Math.PI * this.centerPulseHz * this.waves[0].t));
      this.centerDisc.setOpacity(RN.circleOpacity * (1 - RN.circlePulseDepth * pulse));
    }
    this.writeShards();
    if (!anyFlying && !this.rainAlive) this.shardMesh.removeFromParent();
  }

  /**
   * The hit source if a hazard hits the player now, else null (GD §6.5):
   * ring band `[r − 0.9, r + 0.9]`; a flying shard touching a hit sphere; a landing within 1.6 m.
   */
  check(spheres: readonly Sphere[]): Vector3 | null {
    const p = spheres[0].center;
    for (const r of this.rings) {
      if (r.alive && inRingBand(p, r.center, r.radius, SL.ringWidth / 2 + PLAYER_R)) {
        return this.source.set(r.center.x, CONFIG.boss.halfSize, r.center.z);
      }
    }
    for (const w of this.waves) {
      for (let i = 0; i < w.count; i++) {
        const s = w.shards[i];
        if (s.state === 'flying') {
          for (const sp of spheres) if (sphereSphere(s.pos, RN.hitRadius, sp.center, sp.radius)) return this.source.copy(s.pos);
        } else if (s.landedNow && inCircle(p, s.target, RN.circleRadius + PLAYER_R)) {
          return this.source.set(s.target.x, 0, s.target.z);
        }
      }
    }
    return null;
  }

  /** Removes every hazard; with `puff`, each removed object vanishes in a small puff (GD §6.4). */
  clear(puff: boolean): void {
    for (const r of this.rings) {
      if (!r.alive) continue;
      if (puff) {
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2;
          this.puffs.spawn(r.center.x + Math.cos(a) * r.radius, SL.ringHeight, r.center.z + Math.sin(a) * r.radius, 'shockwave');
        }
      }
      r.alive = false;
      r.mesh.hide();
    }
    for (const w of this.waves) {
      for (let i = 0; i < w.count; i++) {
        const s = w.shards[i];
        if (puff && s.state === 'flying') this.puffs.spawn(s.pos.x, s.pos.y, s.pos.z, 'crown');
        else if (puff && s.state === 'placed') this.puffs.spawn(s.target.x, 0, s.target.z, 'warning');
        s.state = 'idle';
        s.landedNow = false;
      }
      w.count = 0;
      w.circles.removeFromParent();
    }
    if (puff && this.spikes.visible) {
      const c = this.spikes.mesh.position;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        this.puffs.spawn(c.x + Math.cos(a) * RB.startRadius, RB.spikes.rows[0], c.z + Math.sin(a) * RB.startRadius, 'rebuke');
      }
    }
    this.hideRebuke();
    this.centerDisc.hide();
    this.shardMesh.removeFromParent();
    this.hideAllInstances();
  }

  // --- rendering helpers -------------------------------------------------------------------------

  private hideRebuke(): void {
    this.rebukeT = -1;
    this.spikes.hide();
  }

  private writeCircles(w: number): void {
    const wave = this.waves[w];
    let visible = 0;
    for (let i = 0; i < MAX; i++) {
      const s = wave.shards[i];
      const show = i < wave.count && s.state !== 'idle' && !(w === 0 && i === 0);
      if (show) {
        tmpS.set(1, 1, 1);
        tmpP.set(s.target.x, RN.circleLift, s.target.z);
        tmpM.compose(tmpP, FLAT, tmpS);
        visible++;
      } else {
        tmpM.makeScale(0, 0, 0);
      }
      wave.circles.setMatrixAt(i, tmpM);
    }
    wave.circles.instanceMatrix.needsUpdate = true;
    if (visible === 0) wave.circles.removeFromParent();
    if (w === 0) {
      const c = wave.shards[0];
      if (wave.count > 0 && c.state !== 'idle') this.centerDisc.show(this.scene, c.target.x, c.target.z, RN.circleOpacity);
      else this.centerDisc.hide();
    }
  }

  private writeShards(): void {
    let k = 0;
    for (const w of this.waves) {
      for (let i = 0; i < MAX; i++, k++) {
        const s = w.shards[i];
        if (i < w.count && s.state === 'flying') {
          this.dummy.position.copy(s.pos);
          this.dummy.rotation.set(s.spin, s.spin, 0);
          this.dummy.scale.set(1, 1, 1);
          this.dummy.updateMatrix();
          this.shardMesh.setMatrixAt(k, this.dummy.matrix);
        } else {
          tmpM.makeScale(0, 0, 0);
          this.shardMesh.setMatrixAt(k, tmpM);
        }
      }
    }
    this.shardMesh.instanceMatrix.needsUpdate = true;
  }

  private hideAllInstances(): void {
    tmpM.makeScale(0, 0, 0);
    for (let k = 0; k < WAVES * MAX; k++) this.shardMesh.setMatrixAt(k, tmpM);
    this.shardMesh.instanceMatrix.needsUpdate = true;
    for (const w of this.waves) {
      for (let i = 0; i < MAX; i++) w.circles.setMatrixAt(i, tmpM);
      w.circles.instanceMatrix.needsUpdate = true;
    }
  }
}
