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
import { fireBoost } from '../fx/hdr';
import { GroundDisc, discGeometry, ShockwaveRing, SpikeBurst, type Puffs } from '../fx/effects';
import type { Vfx } from '../fx/vfx';
import { easeIn, easeOut } from '../util/math';
import { inCircle, inRingBand, sphereSphere, type Vec3Like } from '../systems/collision';
import type { Sphere } from '../entities/Player';
import { SILENT, type PillarHit, type SoundSink } from './Attack';

const SL = CONFIG.slam;
const RN = CONFIG.rain;
const RB = CONFIG.rebuke;
const G = CONFIG.fx.gravity;
const PLAYER_R = CONFIG.player.radius;
const EPS = 1e-9;
export const WAVES = 3;

/**
 * Pure (tested): the Rebuke spikes' reach (m from the boss center) `t` s into the burst. It grows
 * from startRadius to endRadius (ease-out) over the first 70% of the burst; both the drawing and
 * the kill check use it, so the damage never arrives before the spikes (2026-10-12).
 */
export function rebukeReach(t: number): number {
  const u = Math.min(1, Math.max(0, t / (CONFIG.rebuke.burst * 0.7)));
  return CONFIG.rebuke.startRadius + (CONFIG.rebuke.endRadius - CONFIG.rebuke.startRadius) * easeOut(u);
}
const MAX = RN.maxPerWave;
const RING_POOL = 3;

interface Ring {
  readonly mesh: ShockwaveRing;
  readonly center: Vector3;
  radius: number;
  speed: number;
  /** Radius at which this ring ends (Slam 14 m; Hop-Back splash smaller, 1.6). */
  end: number;
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
  /** Circle and kill radius (rage Crown Rain is larger, 2026-10-12). */
  radius: number;
}

/** A Meteor Shower meteor (GD §6.5 G): a warning circle and a fireball falling onto it. */
interface Meteor {
  readonly target: Vector3;
  readonly start: Vector3;
  readonly pos: Vector3;
  t: number;
  falling: boolean;
  landedNow: boolean;
  /** 1.6 V5: a huge "hero" meteor (visual only; same warning circle and kill radius). */
  hero: boolean;
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
  radius: number;
}

const tmpM = new Matrix4();
const tmpS = new Vector3();
const tmpP = new Vector3();
const FLAT = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
const IDENTITY_Q = new Quaternion();

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
  // Meteor Shower (GD §6.5 G)
  private readonly meteors: Meteor[] = [];
  private readonly meteorCircles: InstancedMesh;
  private readonly meteorCircleMat: MeshBasicMaterial;
  private readonly meteorCores: InstancedMesh;
  private meteorLeft = 0;
  private meteorAcc = 0;
  private meteorSoundT = 0;
  private meteorRng: () => number = Math.random;
  private meteorElapsed = 0;
  /** Meteors spawned since the last startMeteors (tests, debug). */
  meteorsSpawned = 0;

  constructor(scene: Scene, puffs: Puffs, vfx: Vfx | null = null) {
    this.scene = scene;
    this.puffs = puffs;
    this.vfx = vfx;
    for (let i = 0; i < RING_POOL; i++) this.rings.push({ mesh: new ShockwaveRing(), center: new Vector3(), radius: 0, speed: 0, end: SL.ringEndRadius, alive: false, emberAcc: 0 });

    // Fireball cores: unlit, so they glow at night (the trail is drawn by the particles).
    const shardMat = new MeshBasicMaterial({ color: CONFIG.colors.fireballCore, toneMapped: false });
    shardMat.color.multiplyScalar(fireBoost()); // 1.6 V1: fireballs bloom
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
        shards.push({ pos: new Vector3(), vel: new Vector3(), target: new Vector3(), flightTime: 0, t: 0, state: 'idle', landedNow: false, spin: 0, radius: RN.circleRadius });
      }
      this.waves.push({ shards, count: 0, circles, circleMat, pulseHz: RN.circlePulseHz, t: 0, landedThisStep: false, radius: RN.circleRadius });
    }
    this.centerDisc = new GroundDisc(circleGeo, CONFIG.colors.warning, RN.circleLift);

    const MT = CONFIG.meteor;
    for (let i = 0; i < MT.pool; i++) {
      this.meteors.push({ target: new Vector3(), start: new Vector3(), pos: new Vector3(), t: 0, falling: false, landedNow: false, hero: false });
    }
    this.meteorCircleMat = new MeshBasicMaterial({ color: CONFIG.colors.warning, transparent: true, depthWrite: false, opacity: RN.circleOpacity });
    this.meteorCircles = new InstancedMesh(discGeometry(MT.radius), this.meteorCircleMat, MT.pool);
    this.meteorCircles.frustumCulled = false;
    this.meteorCircles.renderOrder = 1;
    this.meteorCores = new InstancedMesh(this.shardMesh.geometry, shardMat, MT.pool);
    this.meteorCores.frustumCulled = false;
    this.hideAllInstances();
  }

  // --- spawning ----------------------------------------------------------------------------------

  /** A Slam shockwave ring centered at (x, z), expanding from 2.2 m at `speed` (GD §6.5 A). */
  spawnRing(x: number, z: number, speed: number, end: number = SL.ringEndRadius): void {
    let ring = this.rings.find((r) => !r.alive);
    if (!ring) ring = this.rings.reduce((a, b) => (a.radius > b.radius ? a : b)); // reuse the oldest
    ring.center.set(x, 0, z);
    ring.radius = SL.ringStartRadius;
    ring.speed = speed;
    ring.end = end;
    ring.alive = true;
    ring.emberAcc = 0;
    ring.mesh.setRadius(ring.radius);
    ring.mesh.show(this.scene, x, z);
  }

  /**
   * Shows the warning circles of wave `w` at `targets` (y is ignored). `centerPulseHz`, if given,
   * makes target 0 (wave 0's center) pulse at its own rate.
   */
  placeWave(w: number, targets: readonly Vec3Like[], count: number, pulseHz: number = RN.circlePulseHz, centerPulseHz?: number, radius: number = RN.circleRadius): void {
    const wave = this.waves[w];
    wave.count = Math.min(count, MAX);
    wave.t = 0;
    wave.pulseHz = pulseHz;
    wave.radius = radius;
    for (let i = 0; i < MAX; i++) {
      const s = wave.shards[i];
      if (i < wave.count) {
        s.target.set(targets[i].x, RN.landHeight, targets[i].z);
        s.state = 'placed';
        s.radius = radius;
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
    return [...this.rings.map((r) => r.mesh.mesh), ...this.waves.map((w) => w.circles), this.shardMesh, this.centerDisc.mesh, this.spikes.mesh, this.meteorCircles, this.meteorCores];
  }

  /** GD §6.5 G: the Meteor Shower starts now and falls for `CONFIG.meteor.duration` seconds. */
  startMeteors(rng: () => number): void {
    this.meteorRng = rng;
    this.meteorLeft = CONFIG.meteor.duration;
    this.meteorAcc = 0;
    this.meteorsSpawned = 0;
    this.meteorElapsed = 0;
    if (!this.meteorCircles.parent) this.scene.add(this.meteorCircles);
    if (!this.meteorCores.parent) this.scene.add(this.meteorCores);
  }

  /** Blood-moon weight 0…1 during the Meteor Shower (fades in and out; GD §6.5 cinematic). */
  get bloodWeight(): number {
    if (this.meteorLeft <= 0) return 0;
    const B = CONFIG.vfx.bloodMoon;
    return Math.min(1, this.meteorElapsed / B.fadeIn) * Math.min(1, this.meteorLeft / B.fadeOut);
  }

  /** The player died: no new meteors (the falling ones and every other hazard finish visually). */
  stopShower(): void {
    this.meteorLeft = 0;
    this.meteorAcc = 0;
  }

  /** Meteor Shower still running or meteors still falling (debug, tests). */
  get meteorsActive(): boolean {
    return this.meteorLeft > 0 || this.meteors.some((m) => m.falling);
  }

  /** Meteors that landed this step (1.6: the impact screen effect near the player). */
  landedMeteors(out: Vector3[]): Vector3[] {
    out.length = 0;
    for (const m of this.meteors) if (m.landedNow) out.push(m.target);
    return out;
  }

  /** Live meteor targets (tests). */
  meteorTargets(out: Vector3[]): Vector3[] {
    out.length = 0;
    for (const m of this.meteors) if (m.falling) out.push(m.target);
    return out;
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
    for (const r of this.rings) {
      if (!r.alive) continue;
      const travel = r.end - SL.ringStartRadius;
      r.radius += r.speed * dt;
      if (r.radius >= r.end - EPS) {
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
        tip = rebukeReach(this.rebukeT) + S.overshoot * Math.min(1, this.rebukeT / RB.burst);
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
      // 1.6 playtest: rage Crown Rain fireballs (the larger circles) explode; Phase 1 shards clink.
      if (wave.landedThisStep) this.sound.play(wave.radius > RN.circleRadius + 1e-6 ? 'explosion' : 'shard_land');
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
    this.stepMeteors(dt);
  }

  private stepMeteors(dt: number): void {
    const MT = CONFIG.meteor;
    this.meteorSoundT = Math.max(0, this.meteorSoundT - dt);
    if (this.meteorLeft > 0) {
      this.meteorLeft -= dt;
      this.meteorElapsed += dt;
      this.meteorAcc += MT.rate * dt;
      while (this.meteorAcc >= 1) {
        this.meteorAcc -= 1;
        this.spawnMeteor();
      }
    }
    let any = false;
    for (let i = 0; i < this.meteors.length; i++) {
      const m = this.meteors[i];
      m.landedNow = false;
      if (!m.falling) continue;
      m.t += dt;
      const u = Math.min(1, m.t / MT.warning);
      m.pos.lerpVectors(m.start, m.target, u * u); // accelerating fall
      if (u >= 1) {
        m.falling = false;
        m.landedNow = true;
        if (this.vfx) {
          this.vfx.fireExplosion(m.target.x, m.target.z);
          if (m.hero) {
            // 1.6 V5: a bigger blast (the crater decal was removed after the playtest).
            const HM = CONFIG.vfx.heroMeteor;
            for (let k = 1; k < HM.explosionMult; k++) this.vfx.fireExplosion(m.target.x + 0.6, m.target.z - 0.4);
          }
        }
        if (this.meteorSoundT <= 0) {
          this.sound.play('explosion'); // 1.6 playtest
          this.meteorSoundT = MT.soundGap;
        }
        continue;
      }
      any = true;
      this.vfx?.fireballTrail(m.pos.x, m.pos.y, m.pos.z);
      if (m.hero) this.vfx?.meteorSmoke(m.pos.x, m.pos.y, m.pos.z);
    }
    // Instances
    for (let i = 0; i < this.meteors.length; i++) {
      const m = this.meteors[i];
      if (m.falling) {
        tmpS.set(1, 1, 1);
        tmpP.set(m.target.x, RN.circleLift, m.target.z);
        tmpM.compose(tmpP, FLAT, tmpS);
        this.meteorCircles.setMatrixAt(i, tmpM);
        const k = m.hero ? CONFIG.vfx.heroMeteor.coreScale : 1;
        tmpS.set(k, k, k);
        tmpM.compose(m.pos, IDENTITY_Q, tmpS);
        this.meteorCores.setMatrixAt(i, tmpM);
      } else {
        tmpM.makeScale(0, 0, 0);
        this.meteorCircles.setMatrixAt(i, tmpM);
        this.meteorCores.setMatrixAt(i, tmpM);
      }
    }
    this.meteorCircles.instanceMatrix.needsUpdate = true;
    this.meteorCores.instanceMatrix.needsUpdate = true;
    const pulse = 0.5 * (1 - Math.cos(2 * Math.PI * RN.circlePulseHz * this.time));
    this.meteorCircleMat.opacity = RN.circleOpacity * (1 - RN.circlePulseDepth * pulse);
    if (!any && this.meteorLeft <= 0) {
      this.meteorCircles.removeFromParent();
      this.meteorCores.removeFromParent();
    }
  }

  /** A random target in the arena, at least `minSeparation` from the other live targets. */
  private spawnMeteor(): void {
    const MT = CONFIG.meteor;
    const slot = this.meteors.find((m) => !m.falling);
    if (!slot) return;
    const maxR = CONFIG.arena.radius - MT.radius;
    const min2 = MT.minSeparation * MT.minSeparation;
    for (let k = 0; k < MT.tries; k++) {
      const r = maxR * Math.sqrt(this.meteorRng());
      const a = this.meteorRng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      let ok = true;
      for (const m of this.meteors) {
        if (!m.falling) continue;
        const dx = m.target.x - x;
        const dz = m.target.z - z;
        if (dx * dx + dz * dz < min2) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const sa = this.meteorRng() * Math.PI * 2;
      slot.target.set(x, RN.landHeight, z);
      slot.start.set(x + Math.cos(sa) * MT.fallOffset, MT.fallHeight, z + Math.sin(sa) * MT.fallOffset);
      slot.pos.copy(slot.start);
      slot.t = 0;
      slot.falling = true;
      slot.landedNow = false;
      // Every Nth meteor is a hero (deterministic: the gameplay random sequence is unchanged).
      slot.hero = this.meteorsSpawned % CONFIG.vfx.heroMeteor.every === 0;
      this.meteorsSpawned++;
      return;
    }
  }

  /**
   * The hit source if a hazard hits the player now, else null (GD §6.5):
   * ring band `[r − 0.9, r + 0.9]`; a flying shard touching a hit sphere; a landing within 1.6 m.
   */
  check(spheres: readonly Sphere[]): Vector3 | null {
    const p = spheres[0].center;
    for (const r of this.rings) {
      if (r.alive && inRingBand(p, r.center, r.radius, SL.ringWidth / 2 + PLAYER_R)) {
        this.lastHitKind = 'ring';
        return this.source.set(r.center.x, CONFIG.boss.halfSize, r.center.z);
      }
    }
    for (const w of this.waves) {
      for (let i = 0; i < w.count; i++) {
        const s = w.shards[i];
        if (s.state === 'flying') {
          for (const sp of spheres) if (sphereSphere(s.pos, RN.hitRadius, sp.center, sp.radius)) {
            this.lastHitKind = 'shard';
            return this.source.copy(s.pos);
          }
        } else if (s.landedNow && inCircle(p, s.target, s.radius + PLAYER_R)) {
          this.lastHitKind = 'shard';
          return this.source.set(s.target.x, 0, s.target.z);
        }
      }
    }
    for (const m of this.meteors) {
      if (m.landedNow && inCircle(p, m.target, CONFIG.meteor.radius + PLAYER_R)) {
        this.lastHitKind = 'meteor';
        return this.source.set(m.target.x, 0, m.target.z);
      }
    }
    return null;
  }

  /**
   * 1.6 pillars: a hazard touches the pillar circle (x, z, r) this step. A shockwave ring band
   * collapses it and shields a player behind it while that ring lives; a Crown Rain shard or a
   * meteor landing on it collapses it without shielding.
   */
  pillarHit(x: number, z: number, r: number, out: PillarHit): PillarHit | null {
    for (const ring of this.rings) {
      if (!ring.alive) continue;
      const d = Math.hypot(x - ring.center.x, z - ring.center.z);
      if (Math.abs(d - ring.radius) <= SL.ringWidth / 2 + r) {
        out.shield = true;
        out.ox = ring.center.x;
        out.oz = ring.center.z;
        out.life = (ring.end - ring.radius) / Math.max(1e-3, ring.speed) + CONFIG.pillars.shadowLife.ringPad;
        return out;
      }
    }
    out.shield = false;
    out.life = 0;
    for (const w of this.waves) {
      for (let i = 0; i < w.count; i++) {
        const s = w.shards[i];
        if (s.landedNow && Math.hypot(x - s.target.x, z - s.target.z) <= s.radius + r) {
          out.ox = s.target.x;
          out.oz = s.target.z;
          return out;
        }
      }
    }
    for (const m of this.meteors) {
      if (m.landedNow && Math.hypot(x - m.target.x, z - m.target.z) <= CONFIG.meteor.radius + r) {
        out.ox = m.target.x;
        out.oz = m.target.z;
        return out;
      }
    }
    return null;
  }

  /** The kind of the last hit `check` returned (1.6: rings can be shielded by a pillar). */
  lastHitKind: 'ring' | 'shard' | 'meteor' = 'ring';

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
    for (const m of this.meteors) {
      if (puff && m.falling) this.puffs.spawn(m.target.x, 0, m.target.z, 'warning');
      m.falling = false;
      m.landedNow = false;
    }
    this.meteorLeft = 0;
    this.meteorAcc = 0;
    this.meteorCircles.removeFromParent();
    this.meteorCores.removeFromParent();
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
        tmpS.setScalar(s.radius / RN.circleRadius);
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
      if (wave.count > 0 && c.state !== 'idle') {
        this.centerDisc.show(this.scene, c.target.x, c.target.z, RN.circleOpacity);
        this.centerDisc.mesh.scale.setScalar(c.radius / RN.circleRadius);
      } else this.centerDisc.hide();
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
    for (let i = 0; i < CONFIG.meteor.pool; i++) {
      this.meteorCircles.setMatrixAt(i, tmpM);
      this.meteorCores.setMatrixAt(i, tmpM);
    }
    this.meteorCircles.instanceMatrix.needsUpdate = true;
    this.meteorCores.instanceMatrix.needsUpdate = true;
  }
}
