/**
 * The Tarnished Intern (GAME_DESIGN §4).
 *
 * - `PlayerMotor` is the pure gameplay core: movement, facing, the 3-hit combo with its chain
 *   window, roll, the one-slot input buffer, stamina, flask, HP / stagger / hurt invincibility,
 *   arena wall and boss body pushback. No scene dependency; unit tested in Node.
 * - `Player` is the view: the 7-part model with the swing-plane arm rig, the roll somersault,
 *   the visual wobble springs, the flask prop, the hurt blink and the heal flash.
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { CONFIG } from '../config';
import { createPiece, randomSpin, type DebrisPiece } from '../fx/debris';
import type { Rng } from '../util/rng';
import { randRange } from '../util/math';
import { createSphereOBBResult, sphereOBB, type Vec3Like } from '../systems/collision';
import { approach, clamp, easeIn, easeInOut, easeOut, springStep, turnToward, type SpringState } from '../util/math';

const P = CONFIG.player;
const R = CONFIG.roll;
const W = CONFIG.wobble;
const CB = CONFIG.combo;
const ST = CONFIG.stamina;
const FL = CONFIG.flask;
const HU = CONFIG.hurt;

/** Float tolerance for timer comparisons at the fixed step (avoids 14.9999-step boundaries). */
const EPS = 1e-9;

export type PlayerAction = 'free' | 'attack' | 'rolling' | 'dizzy' | 'drink' | 'stagger';
export type AttackPhase = 'windup' | 'active' | 'recovery';
export type BufferKind = 'attack' | 'roll' | 'flask';
export type PlayerEvent =
  | 'rollStart'
  | 'rollEnd'
  | 'footstep'
  | 'attackStart'
  | 'attackActive'
  | 'attackMiss'
  | 'staminaRefused'
  | 'drinkStart'
  | 'flaskHeal'
  | 'hurt';

export type PlayerHitResult = 'hurt' | 'dead' | 'ignored';

/** A yaw-only cube the player cannot walk into (the boss body). */
export interface BodyObstacle {
  center: Vec3Like;
  halfSize: number;
  yaw: number;
}

export interface MotorInput {
  /** World-space movement direction: length 0 (no input) or 1 (normalized). */
  moveX: number;
  moveZ: number;
  /** Presses this step. */
  wantRoll: boolean;
  wantAttack: boolean;
  wantFlask: boolean;
  /** Attack and flask are allowed in the current state (false in BOSS_DEFEATED). */
  allowAttack: boolean;
  bossX: number;
  bossZ: number;
  /** Body-contact obstacle, or null when the boss body is not solid (airborne or dashing). */
  obstacle: BodyObstacle | null;
}

/**
 * Converts a camera-relative input axis into a normalized world direction (GD §3, §7):
 * forward = camera forward projected on XZ; right = forward rotated −90° around Y.
 * Writes into `out` and returns it. Diagonal input is normalized (never faster).
 */
export function moveDirFromAxis(
  axisX: number,
  axisZ: number,
  fwdX: number,
  fwdZ: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const rightX = -fwdZ;
  const rightZ = fwdX;
  let x = rightX * axisX + fwdX * axisZ;
  let z = rightZ * axisX + fwdZ * axisZ;
  const len = Math.hypot(x, z);
  if (len > 1e-6) {
    x /= len;
    z /= len;
  } else {
    x = 0;
    z = 0;
  }
  out.x = x;
  out.z = z;
  return out;
}

/** Yaw that makes local +Z face the direction (dx, dz). */
export const yawOf = (dx: number, dz: number): number => Math.atan2(dx, dz);

/** Arm pose of the sword arm: pitch θ and swing-plane tilt ψ (GD §4.3). */
export interface ArmPose {
  theta: number;
  psi: number;
}

/**
 * Pure: the sword-arm pose for combo hit `hit` (0-based) in `phase` at time `t`, where the
 * wind-up starts from `from` (the arm's pose when the hit started). Writes into `out`.
 */
export function comboArmPose(hit: number, phase: AttackPhase, t: number, from: ArmPose, out: ArmPose): ArmPose {
  const h = CB.hits[hit];
  switch (phase) {
    case 'windup': {
      const u = clamp(t / h.windup.duration, 0, 1);
      out.theta = from.theta + (h.windup.toAngle - from.theta) * easeOut(u);
      out.psi = from.psi + (h.tilt - from.psi) * u;
      break;
    }
    case 'active':
      out.theta = h.windup.toAngle + (h.active.toAngle - h.windup.toAngle) * easeIn(clamp(t / h.active.duration, 0, 1));
      out.psi = h.tilt;
      break;
    default: {
      // Follow-through hold, then back to the rest pose.
      const back = h.recovery.duration - h.recovery.hold;
      const u = t <= h.recovery.hold ? 0 : easeInOut(clamp((t - h.recovery.hold) / back, 0, 1));
      out.theta = h.active.toAngle + (CB.restAngle - h.active.toAngle) * u;
      out.psi = h.tilt + (CB.restTilt - h.tilt) * u;
      break;
    }
  }
  return out;
}

/** True while a roll at time `t` (s since it started) is invincible: [0.05, 0.40). */
export const rollInvincibleAt = (t: number): boolean => t >= R.iFrameStart - EPS && t < R.iFrameEnd - EPS;

type Gate = 'ok' | 'busy' | 'refused' | 'invalid';

export class PlayerMotor {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  /** Horizontal acceleration of the last step (m/s²), used by the visual wobble. */
  ax = 0;
  az = 0;
  yaw = 0;
  action: PlayerAction = 'free';
  /** Time in the current action, or in the current attack phase (s). */
  actionT = 0;
  /** The current (or last) combo hit, 0-based. */
  comboHit = 0;
  attackPhase: AttackPhase = 'windup';
  /** The next combo hit while the chain window is open, else -1. */
  chainNext = -1;
  /** Time left in the open chain window (s). */
  chainLeft = 0;
  /** The current combo hit already hit the boss (at most one hit per combo hit). */
  attackHit = false;
  rollDirX = 0;
  rollDirZ = 1;
  stamina: number = ST.max;
  /** Seconds until stamina regeneration resumes. */
  regenDelay = 0;
  hp: number = P.hp;
  hurtInvuln = 0;
  flasks: number = FL.charges;
  /** The one-slot input buffer (GD §4.3d). */
  buffered: BufferKind | null = null;
  /** Debug god mode (`G` with ?debug). */
  godMode = false;
  /** Events raised by the last `step` / `takeHit` (sound and HUD triggers). */
  readonly events: PlayerEvent[] = [];
  /** Buffer window (s); a constructor option so tests can check the strict mode (0). */
  readonly bufferWindow: number;

  private rollCovered = 0;
  private lungeCovered = 0;
  private preLungeVx = 0;
  private preLungeVz = 0;
  private chainOpened = false;
  private healed = false;
  private knockX = 0;
  private knockZ = 0;
  private knockCovered = 0;
  private footstepT = 0;
  private readonly contact = createSphereOBBResult();
  private readonly lowSphere: Vec3Like = { x: 0, y: P.hitSpheres[0].height, z: 0 };

  constructor(bufferWindow: number = CONFIG.buffer.window) {
    this.bufferWindow = bufferWindow;
    this.reset();
  }

  /** Back to spawn, facing the boss (at the origin), full HP / stamina / flasks, timers cleared. */
  reset(): void {
    this.x = P.spawn.x;
    this.z = P.spawn.z;
    this.vx = 0;
    this.vz = 0;
    this.ax = 0;
    this.az = 0;
    this.yaw = yawOf(CONFIG.boss.spawn.x - this.x, CONFIG.boss.spawn.z - this.z);
    this.action = 'free';
    this.actionT = 0;
    this.resetCombo();
    this.attackHit = false;
    this.rollCovered = 0;
    this.stamina = ST.max;
    this.regenDelay = 0;
    this.hp = P.hp;
    this.hurtInvuln = 0;
    this.flasks = FL.charges;
    this.buffered = null;
    this.footstepT = 0;
    this.events.length = 0;
  }

  /** The current combo hit is in its active phase and has not hit yet: the only damaging window. */
  isAttackActive(): boolean {
    return this.action === 'attack' && this.attackPhase === 'active' && !this.attackHit;
  }

  /** Damage of the current combo hit (1, 1 or 2). */
  attackDamage(): number {
    return CB.hits[this.comboHit].damage;
  }

  /** Called by the game when the blade hits the boss: no further hits this combo hit. */
  markAttackHit(): void {
    this.attackHit = true;
  }

  isRollInvincible(): boolean {
    return this.action === 'rolling' && rollInvincibleAt(this.actionT);
  }

  /** Roll i-frames, hurt invincibility or debug god mode. */
  isInvincible(): boolean {
    return this.godMode || this.isRollInvincible() || this.hurtInvuln > EPS;
  }

  speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * GD §4.6: an attack hit from (sourceX, sourceZ). Ignored while invincible. A non-lethal hit
   * ends the current action, resets the combo, clears the buffer and starts the stagger.
   */
  takeHit(sourceX: number, sourceZ: number): PlayerHitResult {
    if (this.isInvincible() || this.hp <= 0) return 'ignored';
    this.hp -= 1;
    this.hurtInvuln = HU.invulnerability;
    if (this.hp <= 0) {
      this.hp = 0;
      return 'dead';
    }
    let dx = this.x - sourceX;
    let dz = this.z - sourceZ;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) {
      dx /= d;
      dz /= d;
    } else {
      dx = -Math.sin(this.yaw);
      dz = -Math.cos(this.yaw);
    }
    this.knockX = dx;
    this.knockZ = dz;
    this.knockCovered = 0;
    this.action = 'stagger';
    this.actionT = 0;
    this.vx = 0;
    this.vz = 0;
    this.resetCombo();
    this.buffered = null;
    this.regenDelay = ST.regenDelay;
    this.events.push('hurt');
    return 'hurt';
  }

  step(dt: number, input: MotorInput): void {
    this.events.length = 0;
    const pvx = this.vx;
    const pvz = this.vz;
    this.hurtInvuln = Math.max(0, this.hurtInvuln - dt);
    if (!input.allowAttack && (this.buffered === 'attack' || this.buffered === 'flask')) this.buffered = null;

    // Newest press wins; otherwise retry the buffered one (GD §4.3d).
    const pressed: BufferKind | null = input.wantRoll
      ? 'roll'
      : input.wantAttack && input.allowAttack
        ? 'attack'
        : input.wantFlask && input.allowAttack
          ? 'flask'
          : null;
    if (pressed) this.request(pressed, input);
    else if (this.buffered) this.request(this.buffered, input);

    switch (this.action) {
      case 'free':
        this.stepMove(dt, input, P.maxSpeed);
        break;
      case 'attack':
        this.stepAttack(dt, input);
        break;
      case 'rolling':
        this.stepRolling(dt);
        break;
      case 'dizzy':
        this.stepDizzy(dt, input);
        break;
      case 'drink':
        this.stepDrink(dt, input);
        break;
      case 'stagger':
        this.stepStagger(dt, input);
        break;
    }
    this.stepChainWindow(dt);
    this.stepStamina(dt);

    this.clampToArena();
    if (input.obstacle) this.pushOutOf(input.obstacle);

    this.ax = (this.vx - pvx) / dt;
    this.az = (this.vz - pvz) / dt;
  }

  // --- action gating -----------------------------------------------------------------------------

  /** Whether `kind` can start now. */
  private gate(kind: BufferKind): Gate {
    switch (kind) {
      case 'roll':
        if (this.action !== 'free') return 'busy';
        return this.stamina + EPS >= ST.rollCost ? 'ok' : 'refused';
      case 'attack': {
        const atChain = this.action === 'attack' && this.chainOpened && this.chainNext >= 0;
        if (this.action !== 'free' && !atChain) return 'busy';
        return this.stamina + EPS >= CB.hits[this.nextHit()].cost ? 'ok' : 'refused';
      }
      case 'flask':
        if (this.action !== 'free') return 'busy';
        return this.hp < P.hp && this.flasks > 0 ? 'ok' : 'invalid';
    }
  }

  /** Seconds until `kind` could start (the buffer window test). */
  private timeUntilPossible(kind: BufferKind): number {
    switch (this.action) {
      case 'attack': {
        const h = CB.hits[this.comboHit];
        let left: number;
        if (this.attackPhase === 'windup') left = h.windup.duration - this.actionT + h.active.duration;
        else if (this.attackPhase === 'active') left = h.active.duration - this.actionT;
        else left = -this.actionT;
        // An attack can follow at the chain point; everything else waits for the recovery end.
        const until = kind === 'attack' && h.chainAt >= 0 ? h.chainAt : h.recovery.duration;
        return left + until;
      }
      case 'rolling':
        return R.duration - this.actionT + R.recoveryDuration;
      case 'dizzy':
        return R.recoveryDuration - this.actionT;
      case 'drink':
        return FL.duration - this.actionT;
      case 'stagger':
        return HU.stagger - this.actionT;
      default:
        return 0;
    }
  }

  private request(kind: BufferKind, input: MotorInput): void {
    const g = this.gate(kind);
    if (g === 'busy') {
      if (this.bufferWindow > 0 && this.timeUntilPossible(kind) <= this.bufferWindow + EPS) this.buffered = kind;
      return;
    }
    this.buffered = null;
    if (g === 'invalid') return;
    if (g === 'refused') {
      this.events.push('staminaRefused');
      this.resetCombo();
      return;
    }
    if (kind === 'roll') this.startRoll(input);
    else if (kind === 'attack') this.startAttack(this.nextHit());
    else this.startDrink();
  }

  private nextHit(): number {
    return this.chainNext >= 0 && this.chainLeft > EPS ? this.chainNext : 0;
  }

  private resetCombo(): void {
    this.chainNext = -1;
    this.chainLeft = 0;
    this.chainOpened = false;
  }

  private spend(cost: number): void {
    this.stamina = Math.max(0, this.stamina - cost);
  }

  // --- starts ------------------------------------------------------------------------------------

  private startRoll(input: MotorInput): void {
    // Direction: camera-relative input at the moment the roll starts, else the facing direction.
    if (input.moveX !== 0 || input.moveZ !== 0) {
      this.rollDirX = input.moveX;
      this.rollDirZ = input.moveZ;
    } else {
      this.rollDirX = Math.sin(this.yaw);
      this.rollDirZ = Math.cos(this.yaw);
    }
    this.spend(ST.rollCost);
    this.resetCombo();
    this.action = 'rolling';
    this.actionT = 0;
    this.rollCovered = 0;
    this.footstepT = 0;
    this.events.push('rollStart');
  }

  private startAttack(hit: number): void {
    this.spend(CB.hits[hit].cost);
    this.resetCombo();
    this.comboHit = hit;
    this.action = 'attack';
    this.attackPhase = 'windup';
    this.actionT = 0;
    this.attackHit = false;
    this.footstepT = 0;
    this.events.push('attackStart');
  }

  private startDrink(): void {
    this.flasks -= 1;
    this.resetCombo();
    this.healed = false;
    this.action = 'drink';
    this.actionT = 0;
    this.events.push('drinkStart');
  }

  // --- per-action steps --------------------------------------------------------------------------

  /** GD §4.3: wind-up, active (lunge, damage), recovery (chain point, follow-through). */
  private stepAttack(dt: number, input: MotorInput): void {
    const h = CB.hits[this.comboHit];
    this.actionT += dt;
    if (this.attackPhase === 'active') {
      // Lunge at lunge / duration, capped so the total is exactly the lunge distance even when the
      // phase length is not a whole number of fixed steps.
      const d = Math.min((h.active.lunge / h.active.duration) * dt, h.active.lunge - this.lungeCovered);
      this.lungeCovered += d;
      this.vx = (Math.sin(this.yaw) * d) / dt;
      this.vz = (Math.cos(this.yaw) * d) / dt;
    } else {
      this.decay(dt);
    }
    this.integrate(dt);
    this.faceBoss(dt, input);

    if (this.attackPhase === 'windup' && this.actionT >= h.windup.duration - EPS) {
      this.attackPhase = 'active';
      this.actionT = 0;
      this.lungeCovered = 0;
      this.preLungeVx = this.vx;
      this.preLungeVz = this.vz;
      this.events.push('attackActive');
    } else if (this.attackPhase === 'active' && this.actionT >= h.active.duration - EPS) {
      if (!this.attackHit) this.events.push('attackMiss');
      // The lunge velocity applies only during the active phase.
      this.vx = this.preLungeVx;
      this.vz = this.preLungeVz;
      this.attackPhase = 'recovery';
      this.actionT = 0;
    } else if (this.attackPhase === 'recovery') {
      if (h.chainAt >= 0 && !this.chainOpened && this.actionT >= h.chainAt - EPS) {
        this.chainOpened = true;
        this.chainNext = this.comboHit + 1;
        this.chainLeft = CB.chainWindow;
      }
      if (this.actionT >= h.recovery.duration - EPS) {
        this.action = 'free';
        this.actionT = 0;
        if (h.chainAt < 0) this.resetCombo(); // after Hit 3 the combo always resets
      }
    }
  }

  /** The chain window keeps running while walking after the recovery has ended. */
  private stepChainWindow(dt: number): void {
    if (!this.chainOpened) return;
    if (this.action !== 'attack' && this.action !== 'free') {
      this.resetCombo();
      return;
    }
    this.chainLeft -= dt;
    if (this.chainLeft <= EPS) this.resetCombo();
  }

  private stepMove(dt: number, input: MotorInput, maxSpeed: number): void {
    const hasInput = input.moveX !== 0 || input.moveZ !== 0;
    const rate = (hasInput ? P.accel : P.decel) * dt;
    const tx = input.moveX * maxSpeed;
    const tz = input.moveZ * maxSpeed;
    // Move the velocity vector toward the desired velocity by at most `rate` (no overshoot).
    const dx = tx - this.vx;
    const dz = tz - this.vz;
    const d = Math.hypot(dx, dz);
    if (d <= rate) {
      this.vx = tx;
      this.vz = tz;
    } else {
      this.vx += (dx / d) * rate;
      this.vz += (dz / d) * rate;
    }
    this.integrate(dt);

    const speed = this.speed();
    if (hasInput && speed > P.faceMoveMinSpeed) {
      this.yaw = turnToward(this.yaw, yawOf(this.vx, this.vz), P.turnRate * dt);
    } else {
      this.faceBoss(dt, input);
    }

    // Footsteps every 0.30 s while walking above 1 m/s (GD §10, optional sound).
    if (speed > CONFIG.audio.footstepMinSpeed) {
      this.footstepT += dt;
      if (this.footstepT >= CONFIG.audio.footstepInterval - EPS) {
        this.footstepT -= CONFIG.audio.footstepInterval;
        this.events.push('footstep');
      }
    } else {
      this.footstepT = 0;
    }
  }

  private stepRolling(dt: number): void {
    this.actionT += dt;
    // Locked direction; displacement follows ease-out (fast start, slow end).
    const covered = R.distance * easeOut(this.actionT / R.duration);
    const delta = covered - this.rollCovered;
    this.rollCovered = covered;
    this.x += this.rollDirX * delta;
    this.z += this.rollDirZ * delta;
    this.vx = (this.rollDirX * delta) / dt;
    this.vz = (this.rollDirZ * delta) / dt;
    this.yaw = turnToward(this.yaw, yawOf(this.rollDirX, this.rollDirZ), P.turnRate * R.turnRateMult * dt);

    if (this.actionT >= R.duration - EPS) {
      this.action = 'dizzy';
      this.actionT = 0;
      this.vx = this.rollDirX * R.recoverySpeed;
      this.vz = this.rollDirZ * R.recoverySpeed;
      this.events.push('rollEnd');
    }
  }

  private stepDizzy(dt: number, input: MotorInput): void {
    this.actionT += dt;
    this.decay(dt);
    this.integrate(dt);
    this.faceBoss(dt, input);
    if (this.actionT >= R.recoveryDuration - EPS) {
      this.action = 'free';
      this.actionT = 0;
    }
  }

  /** GD §4.3c: walk at ≤ 1.8 m/s; +1 HP at 0.60 s; done at 1.10 s. */
  private stepDrink(dt: number, input: MotorInput): void {
    this.actionT += dt;
    this.stepMove(dt, input, FL.maxSpeed);
    if (!this.healed && this.actionT >= FL.healAt - EPS) {
      this.healed = true;
      this.hp = Math.min(P.hp, this.hp + FL.heal);
      this.events.push('flaskHeal');
    }
    if (this.actionT >= FL.duration - EPS) {
      this.action = 'free';
      this.actionT = 0;
    }
  }

  /** GD §4.6: 3.0 m knockback on ease-out over the 0.5 s stagger. */
  private stepStagger(dt: number, input: MotorInput): void {
    this.actionT += dt;
    const covered = HU.knockback * easeOut(Math.min(1, this.actionT / HU.stagger));
    const delta = covered - this.knockCovered;
    this.knockCovered = covered;
    this.x += this.knockX * delta;
    this.z += this.knockZ * delta;
    this.vx = (this.knockX * delta) / dt;
    this.vz = (this.knockZ * delta) / dt;
    this.faceBoss(dt, input);
    if (this.actionT >= HU.stagger - EPS) {
      this.action = 'free';
      this.actionT = 0;
      this.vx = 0;
      this.vz = 0;
    }
  }

  /** GD §4.3b: paused during actions; resumes 0.4 s after the player is free, at 45/s. */
  private stepStamina(dt: number): void {
    if (this.action !== 'free') {
      this.regenDelay = ST.regenDelay;
      return;
    }
    if (this.regenDelay > EPS) {
      this.regenDelay = Math.max(0, this.regenDelay - dt);
      return;
    }
    this.stamina = Math.min(ST.max, this.stamina + ST.regenRate * dt);
  }

  /** Horizontal velocity decays toward 0 at `decel`. */
  private decay(dt: number): void {
    const s = this.speed();
    if (s === 0) return;
    const ns = approach(s, 0, P.decel * dt);
    this.vx *= ns / s;
    this.vz *= ns / s;
  }

  private integrate(dt: number): void {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }

  private faceBoss(dt: number, input: MotorInput): void {
    const dx = input.bossX - this.x;
    const dz = input.bossZ - this.z;
    if (dx * dx + dz * dz < 1e-8) return;
    this.yaw = turnToward(this.yaw, yawOf(dx, dz), P.turnRate * dt);
  }

  /** GD §4.2: horizontal radius clamped to 30 − 0.4 = 29.6 m; outward velocity removed. */
  private clampToArena(): void {
    const max = CONFIG.arena.radius - P.radius;
    const r = Math.hypot(this.x, this.z);
    if (r <= max) return;
    const nx = this.x / r;
    const nz = this.z / r;
    this.x = nx * max;
    this.z = nz * max;
    const vn = this.vx * nx + this.vz * nz;
    if (vn > 0) {
      this.vx -= nx * vn;
      this.vz -= nz * vn;
    }
  }

  /** GD §4.2: push out of the boss box along the shortest horizontal direction at 4 m/s. */
  private pushOutOf(o: BodyObstacle): void {
    this.lowSphere.x = this.x;
    this.lowSphere.z = this.z;
    if (!sphereOBB(this.lowSphere, P.radius, o.center, o.halfSize, o.yaw, this.contact, true)) return;
    const n = this.contact.normal;
    this.x += n.x * this.contact.depth;
    this.z += n.z * this.contact.depth;
    const vn = this.vx * n.x + this.vz * n.z;
    this.vx += n.x * (P.bossPushSpeed - vn);
    this.vz += n.z * (P.bossPushSpeed - vn);
    this.clampToArena();
  }
}

/** A sphere in world space (hitbox). */
export interface Sphere {
  readonly center: Vector3;
  readonly radius: number;
}

const WHITE = new Color(0xffffff);

/** One of the 7 parts that fall apart on death (GD §9), with its rest transform for reset. */
interface BodyPart {
  readonly mesh: Mesh;
  readonly parent: Object3D;
  readonly position: Vector3;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  /** Half the smallest dimension (the radius for spheres). */
  readonly groundR: number;
}
const HEAL = new Color(CONFIG.colors.healFlash);

/** The visual player: 7-part model on a roll pivot, driven by a PlayerMotor. */
export class Player {
  readonly motor: PlayerMotor;
  readonly root = new Group();

  private readonly rollPivot = new Group();
  private readonly neckPivot = new Group();
  private readonly shoulderL = new Group();
  /** Rotated by ψ around the forward axis; the sword arm pitches inside it (GD §4.3). */
  private readonly swingPlane = new Group();
  private readonly shoulderR = new Group();
  private readonly hipL = new Group();
  private readonly hipR = new Group();
  private readonly flaskProp: Mesh;
  private readonly parts: BodyPart[] = [];
  private broken = false;
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly baseColors: Color[] = [];
  private readonly tintColors: Color[] = [];
  private readonly healColors: Color[] = [];
  private tint: 'none' | 'debug' | 'heal' = 'none';

  // Wobble springs (pitch angles in radians, head offset in meters).
  private readonly legL: SpringState = { x: 0, v: 0 };
  private readonly legR: SpringState = { x: 0, v: 0 };
  private readonly armL: SpringState = { x: 0, v: 0 };
  private readonly armR: SpringState = { x: CB.restAngle, v: 0 };
  private psi: number = CB.restTilt;
  private readonly headX: SpringState = { x: 0, v: 0 };
  private readonly headZ: SpringState = { x: 0, v: 0 };
  private walkPhase = 0;
  /** Arm pose when the current combo hit started (each wind-up starts from here). */
  private readonly hitFrom: ArmPose = { theta: CB.restAngle, psi: CB.restTilt };
  private readonly pose: ArmPose = { theta: CB.restAngle, psi: CB.restTilt };
  private healFlashLeft = 0;
  private blinkT = 0;

  private readonly spheres: Sphere[] = P.hitSpheres.map((s) => ({ center: new Vector3(), radius: s.radius }));
  private readonly pos = new Vector3();
  private readonly blade: Vector3[] = CB.bladePoints.map(() => new Vector3());
  private readonly debugTint: boolean;

  constructor(debugTint: boolean, bufferWindow?: number) {
    this.debugTint = debugTint;
    this.motor = new PlayerMotor(bufferWindow);
    this.flaskProp = this.buildModel();
    this.syncTransform();
  }

  reset(): void {
    this.motor.reset();
    if (this.broken) {
      for (const p of this.parts) {
        p.parent.add(p.mesh);
        p.mesh.position.copy(p.position);
        p.mesh.rotation.set(p.rotationX, p.rotationY, p.rotationZ);
      }
      this.broken = false;
    }
    for (const s of [this.legL, this.legR, this.armL, this.headX, this.headZ]) {
      s.x = 0;
      s.v = 0;
    }
    this.armR.x = CB.restAngle;
    this.armR.v = 0;
    this.psi = CB.restTilt;
    this.walkPhase = 0;
    this.healFlashLeft = 0;
    this.blinkT = 0;
    this.root.visible = true;
    this.flaskProp.visible = false;
    this.applyPose(0, 0);
    this.syncTransform();
    this.updateTint();
  }

  /** One fixed simulation step. Returns the motor's events (sound and HUD triggers). */
  update(dt: number, input: MotorInput): readonly PlayerEvent[] {
    const m = this.motor;
    const prevAction = m.action;
    m.step(dt, input);
    if (prevAction === 'rolling' && m.action === 'dizzy') this.headX.v += W.dizzyHeadKick; // dizzy landing kick
    if (m.events.includes('attackStart')) {
      this.hitFrom.theta = this.armR.x;
      this.hitFrom.psi = this.psi;
    }
    if (m.events.includes('flaskHeal')) this.healFlashLeft = FL.healFlash;
    this.healFlashLeft = Math.max(0, this.healFlashLeft - dt);
    this.updateWobble(dt);
    this.updateBlink(dt);
    this.syncTransform();
    this.updateTint();
    return m.events;
  }

  /**
   * The 3 blade points in world space (GD §5): 0.5, 1.3 and 2.1 m from the right shoulder along
   * the arm direction (inside the tilted swing plane). Reuses preallocated vectors.
   */
  getBladePoints(): readonly Vector3[] {
    this.root.updateMatrixWorld(true);
    const pts = CB.bladePoints;
    for (let i = 0; i < pts.length; i++) {
      this.blade[i].set(0, -pts[i], 0).applyMatrix4(this.shoulderR.matrixWorld);
    }
    return this.blade;
  }

  /** The two hitbox spheres in world space (GD §4.5). Reuses preallocated objects. */
  getHitSpheres(): readonly Sphere[] {
    for (let i = 0; i < this.spheres.length; i++) {
      this.spheres[i].center.set(this.motor.x, P.hitSpheres[i].height, this.motor.z);
    }
    return this.spheres;
  }

  isInvincible(): boolean {
    return this.motor.isInvincible();
  }

  get isBroken(): boolean {
    return this.broken;
  }

  /**
   * GD §9: the 7 parts detach keeping their world transforms. Each flies 3–6 m/s horizontally
   * away from the hit source, 4–7 m/s up, with a random spin up to 10 rad/s. Parts are restored
   * by `reset()` (their shared materials are never disposed).
   */
  breakApart(source: Vec3Like, scene: Object3D, rng: Rng): DebrisPiece[] {
    const D = CONFIG.fx.death;
    this.root.updateMatrixWorld(true);
    this.flaskProp.visible = false;
    this.rollPivot.visible = true;
    const pieces: DebrisPiece[] = [];
    const wp = new Vector3();
    for (const part of this.parts) {
      scene.attach(part.mesh);
      part.mesh.getWorldPosition(wp);
      let dx = wp.x - source.x;
      let dz = wp.z - source.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        dx /= d;
        dz /= d;
      } else {
        const a = rng() * Math.PI * 2;
        dx = Math.cos(a);
        dz = Math.sin(a);
      }
      const p = createPiece(part.mesh, part.groundR);
      const h = randRange(rng, D.horizontalSpeed[0], D.horizontalSpeed[1]);
      p.vel.set(dx * h, randRange(rng, D.upwardSpeed[0], D.upwardSpeed[1]), dz * h);
      randomSpin(rng, D.maxSpin, p.angVel);
      pieces.push(p);
    }
    this.broken = true;
    return pieces;
  }

  /** Feet position (y = 0). Returns a reused vector; do not keep a reference across steps. */
  get position(): Vector3 {
    return this.pos.set(this.motor.x, 0, this.motor.z);
  }

  // ---------------------------------------------------------------------------------------------

  private buildModel(): Mesh {
    const M = P.model;
    const C = CONFIG.colors;
    const py = M.rollPivotHeight;
    const mat = (color: number): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ color, roughness: M.roughness, metalness: M.metalness });
      this.materials.push(m);
      this.baseColors.push(new Color(color));
      this.tintColors.push(new Color(color).lerp(WHITE, R.debugTint));
      this.healColors.push(HEAL.clone());
      return m;
    };
    const mesh = (geo: BoxGeometry | SphereGeometry | CylinderGeometry, material: Material, parent: Object3D, p: Vec3Like): Mesh => {
      const m = new Mesh(geo, material);
      m.position.set(p.x, p.y, p.z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const part = (m: Mesh, groundR: number): void => {
      this.parts.push({ mesh: m, parent: m.parent!, position: m.position.clone(), rotationX: m.rotation.x, rotationY: m.rotation.y, rotationZ: m.rotation.z, groundR });
    };
    const half = (v: { x: number; y: number; z: number }): number => Math.min(v.x, v.y, v.z) / 2;

    this.root.add(this.rollPivot);
    this.rollPivot.position.y = py;

    // Body
    const body = mesh(new BoxGeometry(M.body.size.x, M.body.size.y, M.body.size.z), mat(C.playerBody), this.rollPivot, {
      x: M.body.center.x,
      y: M.body.center.y - py,
      z: M.body.center.z,
    });
    part(body, half(M.body.size));

    // Head on the neck pivot, eyes on the head
    this.neckPivot.position.set(M.neckPivot.x, M.neckPivot.y - py, M.neckPivot.z);
    this.rollPivot.add(this.neckPivot);
    const head = mesh(
      new SphereGeometry(M.head.radius, M.sphereSegments, M.sphereSegments / 2),
      mat(C.playerHead),
      this.neckPivot,
      M.head.offset,
    );
    part(head, M.head.radius);
    const eyeGeo = new SphereGeometry(M.eyes.radius, 8, 6);
    const eyeMat = mat(C.pupils);
    for (const sx of [-1, 1]) {
      const e = mesh(eyeGeo, eyeMat, head, { x: sx * M.eyes.offset.x, y: M.eyes.offset.y, z: M.eyes.offset.z });
      e.castShadow = false;
    }

    // Arms. Facing +Z, the character's right side is −X. The sword arm sits in a swing plane
    // tilted around the forward axis; the sword continues the arm's direction.
    const armGeo = new BoxGeometry(M.arm.size.x, M.arm.size.y, M.arm.size.z);
    const armMat = mat(C.playerArms);
    this.shoulderL.position.set(M.shoulderPivot.x, M.shoulderPivot.y - py, M.shoulderPivot.z);
    this.rollPivot.add(this.shoulderL);
    part(mesh(armGeo, armMat, this.shoulderL, M.arm.offset), half(M.arm.size));
    this.swingPlane.position.set(-M.shoulderPivot.x, M.shoulderPivot.y - py, M.shoulderPivot.z);
    this.rollPivot.add(this.swingPlane);
    this.swingPlane.add(this.shoulderR);
    part(mesh(armGeo, armMat, this.shoulderR, M.arm.offset), half(M.arm.size));
    part(mesh(new BoxGeometry(M.weapon.size.x, M.weapon.size.y, M.weapon.size.z), mat(C.weapon), this.shoulderR, M.weapon.offset), half(M.weapon.size));

    // Flask in the left hand (visible only while drinking)
    const F = M.flask;
    const flask = mesh(new CylinderGeometry(F.radius, F.radius, F.height, F.segments), mat(C.flask), this.shoulderL, F.offset);
    flask.visible = false;

    // Legs on hip pivots
    const legGeo = new BoxGeometry(M.leg.size.x, M.leg.size.y, M.leg.size.z);
    const legMat = mat(C.playerLegs);
    for (const [pivot, sx] of [
      [this.hipL, 1],
      [this.hipR, -1],
    ] as const) {
      pivot.position.set(sx * M.hipPivot.x, M.hipPivot.y - py, M.hipPivot.z);
      this.rollPivot.add(pivot);
      part(mesh(legGeo, legMat, pivot, M.leg.offset), half(M.leg.size));
    }
    return flask;
  }

  /** GD §4.4: limb springs, walk cycle, head spring, lean; roll tuck and somersault; dizzy sway. */
  private updateWobble(dt: number): void {
    const m = this.motor;
    const s = clamp(m.speed() / P.maxSpeed, 0, 1);
    const rolling = m.action === 'rolling';
    const drinking = m.action === 'drink';

    // Forward/side acceleration in the player's local frame.
    const sin = Math.sin(m.yaw);
    const cos = Math.cos(m.yaw);
    const accFwd = m.ax * sin + m.az * cos;
    const accSide = m.ax * cos - m.az * sin;

    let legLT: number;
    let legRT: number;
    let armLT: number;
    let armRT: number;
    if (rolling) {
      legLT = legRT = armLT = armRT = R.tuckAngle; // tucked; walk cycle paused
    } else {
      this.walkPhase += 2 * Math.PI * W.walkFrequency * s * dt;
      const w = Math.sin(this.walkPhase);
      const lag = W.armLagPerAccel * accFwd;
      legLT = w * W.legSwing * s;
      legRT = -w * W.legSwing * s;
      armLT = -w * W.armSwing * s + lag; // opposite phase to the same-side leg
      armRT = CB.restAngle + w * W.restArmSwing * s;
    }
    const k = W.limbStiffness;
    const c = W.limbDamping;
    for (const [spring, target] of [
      [this.legL, legLT],
      [this.legR, legRT],
    ] as const) {
      springStep(spring, target, k, c, dt);
      spring.x = clamp(spring.x, -W.limbClamp, W.limbClamp);
    }
    if (drinking) {
      this.armL.x = FL.armAngle; // hand at the face, no spring
      this.armL.v = 0;
    } else {
      // After a drink the arm springs down from 150°; it may only fall back inside the ±80° clamp.
      const prev = this.armL.x;
      springStep(this.armL, armLT, k, c, dt);
      this.armL.x = clamp(this.armL.x, -W.limbClamp, Math.max(W.limbClamp, prev));
    }
    this.flaskProp.visible = drinking;

    if (m.action === 'attack') {
      // Sword arm while attacking: driven directly by the combo curves, no spring (GD §4.4).
      comboArmPose(m.comboHit, m.attackPhase, m.actionT, this.hitFrom, this.pose);
      this.armR.x = this.pose.theta;
      this.armR.v = 0;
      this.psi = this.pose.psi;
    } else {
      // The rest pose is far outside the ±80° limb clamp, so the sword arm is not clamped.
      springStep(this.armR, armRT, k, c, dt);
      this.psi += (CB.restTilt - this.psi) * Math.min(1, k * 0.05 * dt);
    }

    // Head offset spring pushed by −0.02 × horizontal acceleration (local frame).
    springStep(this.headX, W.headPush * accSide, W.headStiffness, W.headDamping, dt);
    springStep(this.headZ, W.headPush * accFwd, W.headStiffness, W.headDamping, dt);

    const lean = rolling ? R.somersault * easeInOut(m.actionT / R.duration) : W.bodyLean * s;
    const sway = m.action === 'dizzy' ? R.recoverySway * Math.sin(2 * Math.PI * R.recoverySwayCycles * (m.actionT / R.recoveryDuration)) : 0;
    this.applyPose(lean, sway);
    this.neckPivot.rotation.x = rolling ? 0 : -W.headNod * s * Math.sin(W.headNodPerStride * this.walkPhase);
  }

  /** Writes spring states to the pivots. Pitch θ maps to rotation.x = −θ (0 = down, 90° = forward). */
  private applyPose(lean: number, sway: number): void {
    this.hipL.rotation.x = -this.legL.x;
    this.hipR.rotation.x = -this.legR.x;
    this.shoulderL.rotation.x = -this.armL.x;
    this.shoulderR.rotation.x = -this.armR.x;
    // ψ > 0 tilts the top of the swing plane toward the character's right (−X).
    this.swingPlane.rotation.z = this.psi;
    this.rollPivot.rotation.x = lean;
    this.rollPivot.rotation.z = sway;
    const M = P.model;
    this.neckPivot.position.set(M.neckPivot.x + this.headX.x, M.neckPivot.y - M.rollPivotHeight, M.neckPivot.z + this.headZ.x);
  }

  /** GD §4.6: the body blinks (visible ↔ hidden at 10 Hz) during the hurt invincibility. */
  private updateBlink(dt: number): void {
    if (this.motor.hurtInvuln > 0 && this.motor.hp > 0) {
      this.blinkT += dt;
      this.rollPivot.visible = Math.floor(this.blinkT * HU.blinkHz * 2) % 2 === 0;
    } else {
      this.blinkT = 0;
      this.rollPivot.visible = true;
    }
  }

  private syncTransform(): void {
    this.root.position.set(this.motor.x, 0, this.motor.z);
    this.root.rotation.y = this.motor.yaw;
  }

  /** Gold heal flash (GD §4.3c); with ?debug, 30% white while roll/god invincible. */
  private updateTint(): void {
    const m = this.motor;
    const want = this.healFlashLeft > 0 ? 'heal' : this.debugTint && (m.godMode || m.isRollInvincible()) ? 'debug' : 'none';
    if (want === this.tint) return;
    this.tint = want;
    const colors = want === 'heal' ? this.healColors : want === 'debug' ? this.tintColors : this.baseColors;
    for (let i = 0; i < this.materials.length; i++) this.materials[i].color.copy(colors[i]);
  }
}
