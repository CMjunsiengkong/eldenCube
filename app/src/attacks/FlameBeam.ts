/**
 * Flame Beam (GD §6.5 F, reworked 2026-10-12 like Hyper Beam): charge (the boss turns toward the
 * player; a red aiming line; sparks rush into a growing orb at its mouth; the screen edges darken)
 * → fire (a white flash; the beam slants from the mouth down to the ground at the player's locked
 * distance; its front travels out at 14 m/s; it sweeps toward the player on ONE side, decided when
 * it fires, slow enough to outwalk, and never reverses; the ground point explodes and leaves a
 * trail of burning marks) → a short recovery (a punish window) → free. The beam stops at once if
 * the player is hit or the boss takes damage.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { CONFIG } from '../config';
import type { Sphere } from '../entities/Player';
import { wrapAngle } from '../util/math';
import type { Attack, AttackContext, SoundHandle } from './Attack';

const BM = CONFIG.beam;
const PLAYER_R = CONFIG.player.radius;
const EPS = 1e-9;

/**
 * Pure (tested): the sweep side when the beam fires (+1 = toward increasing yaw, atan2(x, z)
 * convention). From the player's sideways velocity across the boss→player line `(dx, dz)` (unit);
 * below the dead zone, `fallback` (a random number in [0, 1)) decides.
 */
export function sweepSide(dx: number, dz: number, vx: number, vz: number, fallback: number): 1 | -1 {
  const lat = vx * dz - vz * dx; // velocity along the direction of increasing yaw
  if (Math.abs(lat) > BM.lateralDeadzone) return lat > 0 ? 1 : -1;
  return fallback >= 0.5 ? 1 : -1;
}

/**
 * Pure (tested): one step of the beam angle `phi` toward `target`, only in direction `side`, at
 * most `maxStep`. It never moves backwards: once the target is behind the sweep, it holds.
 */
export function beamStep(phi: number, target: number, side: 1 | -1, maxStep: number): number {
  const want = side * wrapAngle(target - phi);
  return phi + side * Math.min(maxStep, Math.max(0, want));
}

/** Pure (tested): horizontal distance from (px, pz) to the segment (ax, az)–(bx, bz). */
export function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax;
  const ez = bz - az;
  const len2 = ex * ex + ez * ez;
  const u = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * ex + (pz - az) * ez) / len2)) : 0;
  return Math.hypot(px - (ax + ex * u), pz - (az + ez * u));
}

const BEAM_VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const BEAM_FRAGMENT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uLen;
uniform vec2 uNear;
void main() {
  // Streaks flowing outward show the beam's direction even end-on; it fades near the camera.
  float streak = 0.72 + 0.28 * sin(vUv.y * uLen * 1.6 - uTime * 28.0) * sin(vUv.x * 12.566 + uTime * 6.0);
  float fade = smoothstep(uNear.x, uNear.y, distance(vWorld, cameraPosition));
  gl_FragColor = vec4(uColor * streak, uOpacity * fade);
  #include <colorspace_fragment>
}`;

function beamMaterial(color: number, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
      uLen: { value: 10 },
      uNear: { value: [BM.nearFade[0], BM.nearFade[1]] },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
}

type Phase = 'charge' | 'fire' | 'recovery' | 'done';

export class FlameBeam implements Attack {
  readonly id = 'beam' as const;
  private phase: Phase = 'done';
  private t = 0;
  private charge = 0;
  private fireTime = 0;
  private sweep = 0;
  private recovery = 0;
  private phi = 0;
  private side: 1 | -1 = 1;
  /** Horizontal distance of the ground point from the boss center (locked at fire). */
  private ground: number = BM.minGround;
  /** Horizontal distance of the beam's front from the boss center. */
  private head = 0;
  private burnT = 0;
  private time = 0;
  /** The aim is locked (the last `lockLead` seconds of the charge). */
  private locked = false;
  private chargeSound: SoundHandle | null = null;
  private fireSound: SoundHandle | null = null;
  private readonly source = new Vector3();
  private ctx: AttackContext | null = null;
  private readonly beam = new Group();
  private readonly core: Mesh;
  private readonly glow: Mesh;
  private readonly coreMat = beamMaterial(CONFIG.colors.flameCore, 0.95);
  private readonly glowMat = beamMaterial(CONFIG.colors.fire, 0.5);
  private readonly stripe: Mesh;
  private readonly stripeMat: MeshBasicMaterial;
  private readonly aim: Mesh;
  private readonly aimMat: MeshBasicMaterial;
  private readonly orb: Mesh;
  private readonly tmp = new Vector3();

  constructor() {
    const cyl = new CylinderGeometry(1, 1, 1, 14, 1, true);
    cyl.rotateX(Math.PI / 2); // axis along +Z (uv.y = 1 at the far end)
    cyl.translate(0, 0, 0.5); // from z = 0 to z = 1
    this.core = new Mesh(cyl, this.coreMat);
    this.glow = new Mesh(cyl, this.glowMat);
    this.core.renderOrder = 6;
    this.glow.renderOrder = 6;
    this.beam.add(this.core, this.glow);
    this.beam.rotation.order = 'YXZ'; // yaw, then pitch down toward the ground point

    const add = (color: number, opacity: number): MeshBasicMaterial =>
      new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide });
    const plane = new PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    plane.translate(0, 0, 0.5);
    this.stripeMat = add(CONFIG.colors.fire, 0.45);
    this.stripe = new Mesh(plane, this.stripeMat);
    this.stripe.renderOrder = 2;
    const line = new BoxGeometry(0.06, 0.06, 1);
    line.translate(0, 0, 0.5);
    this.aimMat = add(CONFIG.colors.warning, 0.6);
    this.aim = new Mesh(line, this.aimMat);
    this.aim.renderOrder = 6;
    this.orb = new Mesh(new SphereGeometry(1, 16, 12), add(CONFIG.colors.fireballCore, 0.9));
    this.orb.renderOrder = 6;
  }

  get phaseName(): string {
    return this.phase;
  }

  /** The beam's current angle, sweep side and front (tests, debug). */
  get angle(): number {
    return this.phi;
  }

  get sweepDirection(): 1 | -1 {
    return this.side;
  }

  get front(): number {
    return this.head;
  }

  get groundDistance(): number {
    return this.ground;
  }

  /** Normally detached meshes (shader warm-up). */
  get scenePool(): readonly (Group | Mesh)[] {
    return [this.beam, this.aim, this.stripe, this.orb];
  }

  start(ctx: AttackContext): void {
    this.ctx = ctx;
    const rage = ctx.rage;
    this.charge = (rage ? BM.rageCharge : BM.charge) * (ctx.easyMult ?? 1);
    this.fireTime = rage ? BM.rageFire : BM.fire;
    this.sweep = rage ? BM.rageSweep : BM.sweep;
    this.recovery = rage ? BM.rageRecovery : BM.recovery;
    ctx.cinema?.lift(true);
    this.locked = false;
    this.chargeSound = ctx.audio.play('beam_charge', { duration: this.charge });
    this.next('charge');
    this.placeAim(ctx);
  }

  update(dt: number, ctx: AttackContext): void {
    const b = ctx.boss;
    this.t += dt;
    this.time += dt;
    switch (this.phase) {
      case 'charge': {
        // The boss turns toward the player normally; an orb grows at its mouth.
        const u = Math.min(1, this.t / this.charge);
        b.crownGlow = u;
        b.attackSquash.y = 1 + 0.08 * u;
        if (!this.locked && this.t >= this.charge - BM.lockLead - EPS) this.lock(ctx);
        if (this.locked) {
          // Locked: the line stays put and flashes bright; the boss no longer turns.
          b.yaw = this.phi;
          this.aimMat.opacity = 0.6 + 0.4 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 14 * this.t));
        } else {
          this.aimMat.opacity = 0.25 + 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 6 * this.t));
          this.placeAim(ctx);
        }
        this.mouth(ctx, b.yaw, this.tmp);
        this.orb.position.copy(this.tmp);
        this.orb.scale.setScalar(Math.max(0.01, BM.orbRadius * u * (0.9 + 0.1 * Math.sin(this.t * 40))));
        if (!this.orb.parent) ctx.scene.add(this.orb);
        ctx.vfx?.chargeSparks(this.tmp.x, this.tmp.y, this.tmp.z, u);
        ctx.vfx?.holdLight(this.tmp.x, this.tmp.y, this.tmp.z, CONFIG.vfx.bossLight.beam * 0.35 * u);
        ctx.cinema?.vignette(BM.vignette * u);
        if (this.t >= this.charge - EPS) this.fire(ctx);
        break;
      }
      case 'fire': {
        // The beam fires straight at where the player was; it starts sweeping once its front has
        // reached the ground point (so a player who walks away at once stays ahead of it).
        if (this.head >= this.ground - EPS) {
          const dx = ctx.playerPos.x - b.pos.x;
          const dz = ctx.playerPos.z - b.pos.z;
          this.phi = beamStep(this.phi, Math.atan2(dx, dz), this.side, this.sweep * dt);
        }
        b.yaw = this.phi; // the boss faces its beam
        this.head = Math.min(this.ground, this.head + BM.travelSpeed * dt);
        this.placeBeam(ctx);
        this.effects(ctx, dt);
        ctx.shake(BM.rumble, 0.15);
        ctx.cinema?.vignette(BM.vignette * 0.5);
        if (this.t >= this.fireTime - EPS) this.stopFiring();
        break;
      }
      case 'recovery':
        b.stuck = true;
        if (this.t >= this.recovery - EPS) this.finish(ctx);
        break;
      default:
        break;
    }
  }

  checkPlayerHit(spheres: readonly Sphere[]): Vector3 | null {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'fire' || this.head <= BM.startOffset) return null;
    const b = ctx.boss.pos;
    const s = Math.sin(this.phi);
    const c = Math.cos(this.phi);
    const p = spheres[0].center;
    const d = segmentDistance(p.x, p.z, b.x + s * BM.startOffset, b.z + c * BM.startOffset, b.x + s * this.head, b.z + c * this.head);
    if (d <= BM.hitRadius + PLAYER_R) return this.source.set(b.x, BM.mouthHeight, b.z);
    return null;
  }

  /** The boss took damage: the beam stops (GD §6.5 F). */
  onBossHit(): void {
    if (this.phase === 'fire' || this.phase === 'charge') this.stopFiring();
  }

  /** The player died from the beam: fire bursts along its whole line. */
  finale(): void {
    const ctx = this.ctx;
    if (!ctx || this.phase !== 'fire' || !ctx.vfx) return;
    const b = ctx.boss.pos;
    for (let i = 0; i < 6; i++) ctx.vfx.beamSparks(b.x, b.z, this.phi, BM.startOffset, this.head, BM.mouthHeight * 0.5);
    const s = Math.sin(this.phi);
    const c = Math.cos(this.phi);
    for (let d = BM.startOffset + 1; d < this.head; d += 1.5) ctx.vfx.fireExplosion(b.x + s * d, b.z + c * d);
  }

  /** The player was hit: the beam stops. */
  onPlayerHit(): void {
    if (this.phase === 'fire') this.stopFiring();
  }

  isBossFree(): boolean {
    return this.phase === 'done';
  }

  inPunishWindow(): boolean {
    return this.phase === 'recovery';
  }

  wantsRebuke(): boolean {
    return false;
  }

  dispose(): void {
    this.stopSounds();
    this.hideAll();
    this.ctx?.cinema?.lift(false);
    this.ctx?.boss.clearAttackPose();
    this.phase = 'done';
  }

  /** `lockLead` s before firing: the aim locks onto the player, aimed down at their feet. */
  private lock(ctx: AttackContext): void {
    const b = ctx.boss;
    const dx = ctx.playerPos.x - b.pos.x;
    const dz = ctx.playerPos.z - b.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.phi = Math.atan2(dx, dz);
    this.ground = Math.min(BM.maxGround, Math.max(BM.minGround, d));
    this.locked = true;
    b.yaw = this.phi;
    b.stuck = true;
    this.placeAim(ctx);
  }

  private fire(ctx: AttackContext): void {
    const b = ctx.boss;
    if (!this.locked) this.lock(ctx);
    const dx = ctx.playerPos.x - b.pos.x;
    const dz = ctx.playerPos.z - b.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.head = BM.startOffset;
    this.burnT = 0;
    // The sweep side follows how the player moves at the moment of firing.
    this.side = sweepSide(dx / d, dz / d, ctx.playerVel.x, ctx.playerVel.z, ctx.rng());
    b.yaw = this.phi;
    b.stuck = true;
    b.crownGlow = 0;
    b.attackSquash.y = 1;
    this.aim.removeFromParent();
    this.orb.removeFromParent();
    this.chargeSound?.stop(); // a longer file is cut where the charge ends
    this.chargeSound = null;
    this.fireSound = ctx.audio.play('beam_fire', { duration: this.fireTime });
    ctx.shake(0.4, 0.35);
    ctx.cinema?.flash(BM.flash);
    this.next('fire');
    this.placeBeam(ctx);
  }

  private stopFiring(): void {
    this.stopSounds();
    this.hideAll();
    this.ctx?.cinema?.lift(false);
    this.next('recovery');
  }

  private stopSounds(): void {
    this.chargeSound?.stop();
    this.fireSound?.stop();
    this.chargeSound = null;
    this.fireSound = null;
  }

  private hideAll(): void {
    this.beam.removeFromParent();
    this.aim.removeFromParent();
    this.stripe.removeFromParent();
    this.orb.removeFromParent();
  }

  /** World position of the boss's mouth (the beam's start) for facing `yaw`. */
  private mouth(ctx: AttackContext, yaw: number, out: Vector3): Vector3 {
    const b = ctx.boss.pos;
    return out.set(b.x + Math.sin(yaw) * BM.startOffset, BM.mouthHeight, b.z + Math.cos(yaw) * BM.startOffset);
  }

  private placeAim(ctx: AttackContext): void {
    const b = ctx.boss;
    this.mouth(ctx, b.yaw, this.tmp);
    this.aim.position.set(this.tmp.x, 0.08, this.tmp.z);
    this.aim.rotation.set(0, b.yaw, 0);
    this.aim.scale.set(1, 1, BM.maxGround - BM.startOffset);
    if (!this.aim.parent) ctx.scene.add(this.aim);
  }

  private placeBeam(ctx: AttackContext): void {
    this.mouth(ctx, this.phi, this.tmp);
    const run = this.ground - BM.startOffset; // horizontal run to the ground point
    const pitch = Math.atan2(BM.mouthHeight, run);
    const full = Math.hypot(run, BM.mouthHeight);
    const frac = Math.max(0.001, (this.head - BM.startOffset) / run);
    const len = full * frac;
    const flick = 1 + 0.12 * Math.sin(this.time * 40) * Math.sin(this.time * 23);
    this.beam.position.copy(this.tmp);
    this.beam.rotation.set(pitch, this.phi, 0);
    this.core.scale.set(BM.radius * flick, BM.radius * flick, len);
    this.glow.scale.set(BM.glowRadius * flick, BM.glowRadius * flick, len);
    for (const m of [this.coreMat, this.glowMat]) {
      m.uniforms.uTime.value = this.time;
      m.uniforms.uLen.value = len;
    }
    if (!this.beam.parent) ctx.scene.add(this.beam);
    // The glowing stripe on the ground under the beam's path.
    this.stripe.position.set(this.tmp.x, 0.04, this.tmp.z);
    this.stripe.rotation.set(0, this.phi, 0);
    this.stripe.scale.set(BM.stripeWidth, 1, run * frac);
    this.stripeMat.opacity = 0.35 + 0.15 * Math.sin(this.time * 30);
    if (!this.stripe.parent) ctx.scene.add(this.stripe);
  }

  /** Sparks along the beam; at the ground point explosions and a trail of burning marks. */
  private effects(ctx: AttackContext, dt: number): void {
    const v = ctx.vfx;
    if (!v) return;
    const b = ctx.boss.pos;
    const s = Math.sin(this.phi);
    const c = Math.cos(this.phi);
    v.beamSparks(b.x, b.z, this.phi, BM.startOffset, this.head, BM.mouthHeight * 0.5);
    this.mouth(ctx, this.phi, this.tmp);
    v.holdLight(this.tmp.x, this.tmp.y, this.tmp.z, CONFIG.vfx.bossLight.beam);
    if (this.head < this.ground - EPS) return; // the front has not reached the ground yet
    const gx = b.x + s * this.ground;
    const gz = b.z + c * this.ground;
    v.beamImpact(gx, gz);
    this.burnT -= dt;
    if (this.burnT <= 0) {
      this.burnT = BM.burnEvery;
      v.burnAt(gx, gz);
    }
  }

  private finish(ctx: AttackContext): void {
    ctx.boss.clearAttackPose();
    this.phase = 'done';
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
  }
}
