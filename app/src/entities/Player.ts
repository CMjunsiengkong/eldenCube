/**
 * The Tarnished Intern (GAME_DESIGN §4).
 *
 * - `PlayerMotor` is the pure gameplay core (movement, facing, roll, action gating, i-frames,
 *   arena wall, boss body pushback). It has no three.js scene dependency and is unit tested.
 * - `Player` is the view: the 7-part model, the roll somersault and the visual wobble springs.
 *
 * Swing phases (windup / active / recovery) are added in milestone 1.3.
 */
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { CONFIG } from '../config';
import { createSphereOBBResult, sphereOBB, type Vec3Like } from '../systems/collision';
import { approach, clamp, easeIn, easeInOut, easeOut, springStep, turnToward, type SpringState } from '../util/math';

const P = CONFIG.player;
const R = CONFIG.roll;
const W = CONFIG.wobble;

/** Float tolerance for timer comparisons at the fixed step (avoids 14.9999-step boundaries). */
const EPS = 1e-9;

export type PlayerAction = 'free' | 'windup' | 'active' | 'recovery' | 'rolling' | 'dizzy';
export type PlayerEvent = 'rollStart' | 'rollEnd' | 'footstep' | 'swingStart' | 'swingActive' | 'swingMiss';

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
  wantRoll: boolean;
  /** Swing pressed this step (and swinging is allowed in the current state, e.g. not BOSS_DEFEATED). */
  wantSwing: boolean;
  bossX: number;
  bossZ: number;
  /** Body-contact obstacle, or null while the boss is attacking (GD §4.2: no pushback then). */
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

const S = CONFIG.swing;

/**
 * Pure: the right-arm swing angle θ (GD §4.3) for an action and time into it.
 * Wind-up 20° → 200° ease-out; active 200° → 70° ease-in; recovery 70° → 20° ease-in-out.
 */
export function swingAngle(action: PlayerAction, t: number): number {
  switch (action) {
    case 'windup':
      return S.restAngle + (S.windup.toAngle - S.restAngle) * easeOut(t / S.windup.duration);
    case 'active':
      return S.windup.toAngle + (S.active.toAngle - S.windup.toAngle) * easeIn(t / S.active.duration);
    case 'recovery':
      return S.active.toAngle + (S.recovery.toAngle - S.active.toAngle) * easeInOut(t / S.recovery.duration);
    default:
      return S.restAngle;
  }
}

export const isSwingAction = (a: PlayerAction): boolean => a === 'windup' || a === 'active' || a === 'recovery';

/** True while a roll at time `t` (s since it started) is invincible: [0.05, 0.40). */
export const rollInvincibleAt = (t: number): boolean => t >= R.iFrameStart - EPS && t < R.iFrameEnd - EPS;

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
  /** Time in the current action (s). */
  actionT = 0;
  /** Time left before a new roll may start (s). */
  rollCooldown = 0;
  rollDirX = 0;
  rollDirZ = 1;
  /** Debug god mode (`G` with ?debug). */
  godMode = false;
  /** Events raised by the last `step` (sound triggers). */
  readonly events: PlayerEvent[] = [];

  /** The current swing already hit the boss (at most one hit per swing). */
  swingHit = false;

  private rollCovered = 0;
  /** Velocity just before the lunge; restored when the active phase ends (keeps the lunge ≈ 1.5 m). */
  private preLungeVx = 0;
  private preLungeVz = 0;
  private footstepT = 0;
  private readonly contact = createSphereOBBResult();
  private readonly lowSphere: Vec3Like = { x: 0, y: P.hitSpheres[0].height, z: 0 };

  constructor() {
    this.reset();
  }

  /** Back to spawn, facing the boss (at the origin), all timers cleared. */
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
    this.rollCooldown = 0;
    this.rollCovered = 0;
    this.footstepT = 0;
    this.swingHit = false;
    this.events.length = 0;
  }

  /** True during the active (slash) phase while it has not hit yet: the only damaging window. */
  isSwingActive(): boolean {
    return this.action === 'active' && !this.swingHit;
  }

  /** Called by the game when the blade hits the boss: no further hits this swing. */
  markSwingHit(): void {
    this.swingHit = true;
  }

  /** A roll may start only from free movement after the cooldown (no buffering). */
  canStartRoll(): boolean {
    return this.action === 'free' && this.rollCooldown <= EPS;
  }

  /** A swing may start from free movement; the roll cooldown does NOT block it (decision D1). */
  canStartSwing(): boolean {
    return this.action === 'free';
  }

  isRollInvincible(): boolean {
    return this.action === 'rolling' && rollInvincibleAt(this.actionT);
  }

  /** Roll i-frames or debug god mode. */
  isInvincible(): boolean {
    return this.godMode || this.isRollInvincible();
  }

  speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  step(dt: number, input: MotorInput): void {
    this.events.length = 0;
    const pvx = this.vx;
    const pvz = this.vz;

    if (input.wantRoll && this.canStartRoll()) this.startRoll(input);
    else if (input.wantSwing && this.canStartSwing()) this.startSwing();

    switch (this.action) {
      case 'free':
        this.stepFree(dt, input);
        break;
      case 'rolling':
        this.stepRolling(dt);
        break;
      case 'dizzy':
        this.stepDizzy(dt, input);
        break;
      default:
        this.stepSwing(dt, input);
        break;
    }

    this.clampToArena();
    if (input.obstacle) this.pushOutOf(input.obstacle);

    this.ax = (this.vx - pvx) / dt;
    this.az = (this.vz - pvz) / dt;
  }

  private startRoll(input: MotorInput): void {
    // Direction: camera-relative input at the moment of the press, else the facing direction.
    if (input.moveX !== 0 || input.moveZ !== 0) {
      this.rollDirX = input.moveX;
      this.rollDirZ = input.moveZ;
    } else {
      this.rollDirX = Math.sin(this.yaw);
      this.rollDirZ = Math.cos(this.yaw);
    }
    this.action = 'rolling';
    this.actionT = 0;
    this.rollCovered = 0;
    this.footstepT = 0;
    this.events.push('rollStart');
  }

  private startSwing(): void {
    this.action = 'windup';
    this.actionT = 0;
    this.swingHit = false;
    this.footstepT = 0;
    this.events.push('swingStart');
  }

  /** GD §4.3: wind-up and recovery decay at decel; the active phase lunges at facing × 10 m/s. */
  private stepSwing(dt: number, input: MotorInput): void {
    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    this.actionT += dt;
    if (this.action === 'active') {
      this.vx = Math.sin(this.yaw) * S.active.lungeSpeed;
      this.vz = Math.cos(this.yaw) * S.active.lungeSpeed;
    } else {
      this.decay(dt);
    }
    this.integrate(dt);
    // Movement input is ignored during the swing, so the facing target is the boss (GD §4.2).
    this.faceBoss(dt, input);

    if (this.action === 'windup' && this.actionT >= S.windup.duration - EPS) {
      this.action = 'active';
      this.actionT = 0;
      this.preLungeVx = this.vx;
      this.preLungeVz = this.vz;
      this.events.push('swingActive');
    } else if (this.action === 'active' && this.actionT >= S.active.duration - EPS) {
      if (!this.swingHit) this.events.push('swingMiss');
      // The lunge velocity applies only "for this phase" (GD §4.3); recovery then decays from the
      // pre-lunge velocity, so the lunge moves the player about 1.5 m in total.
      this.vx = this.preLungeVx;
      this.vz = this.preLungeVz;
      this.action = 'recovery';
      this.actionT = 0;
    } else if (this.action === 'recovery' && this.actionT >= S.recovery.duration - EPS) {
      this.action = 'free';
      this.actionT = 0;
    }
  }

  private stepFree(dt: number, input: MotorInput): void {
    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    const hasInput = input.moveX !== 0 || input.moveZ !== 0;
    const rate = (hasInput ? P.accel : P.decel) * dt;
    const tx = input.moveX * P.maxSpeed;
    const tz = input.moveZ * P.maxSpeed;
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
      this.rollCooldown = R.cooldown;
    }
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

/** The visual player: 7-part model on a roll pivot, driven by a PlayerMotor. */
export class Player {
  readonly motor = new PlayerMotor();
  readonly root = new Group();

  private readonly rollPivot = new Group();
  private readonly neckPivot = new Group();
  private readonly shoulderL = new Group();
  private readonly shoulderR = new Group();
  private readonly hipL = new Group();
  private readonly hipR = new Group();
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly baseColors: Color[] = [];
  private readonly tintColors: Color[] = [];
  private tinted = false;

  // Wobble springs (pitch angles in radians, head offset in meters).
  private readonly legL: SpringState = { x: 0, v: 0 };
  private readonly legR: SpringState = { x: 0, v: 0 };
  private readonly armL: SpringState = { x: 0, v: 0 };
  private readonly armR: SpringState = { x: CONFIG.swing.restAngle, v: 0 };
  private readonly headX: SpringState = { x: 0, v: 0 };
  private readonly headZ: SpringState = { x: 0, v: 0 };
  private walkPhase = 0;

  private readonly spheres: Sphere[] = P.hitSpheres.map((s) => ({ center: new Vector3(), radius: s.radius }));
  private readonly pos = new Vector3();
  private readonly blade: Vector3[] = CONFIG.swing.bladePoints.map(() => new Vector3());
  private readonly debugTint: boolean;

  constructor(debugTint: boolean) {
    this.debugTint = debugTint;
    this.buildModel();
    this.syncTransform();
  }

  reset(): void {
    this.motor.reset();
    for (const s of [this.legL, this.legR, this.armL, this.headX, this.headZ]) {
      s.x = 0;
      s.v = 0;
    }
    this.armR.x = CONFIG.swing.restAngle;
    this.armR.v = 0;
    this.walkPhase = 0;
    this.applyPose(0, 0);
    this.syncTransform();
  }

  /** One fixed simulation step. Returns the motor's events (sound triggers). */
  update(dt: number, input: MotorInput): readonly PlayerEvent[] {
    const m = this.motor;
    const prevAction = m.action;
    m.step(dt, input);
    if (prevAction === 'rolling' && m.action === 'dizzy') this.headX.v += W.dizzyHeadKick; // dizzy landing kick
    this.updateWobble(dt);
    this.syncTransform();
    this.updateTint();
    return m.events;
  }

  /**
   * The 3 blade points in world space (GD §5): 0.5, 1.3 and 2.1 m from the right shoulder along
   * the arm direction. Reuses preallocated vectors.
   */
  getBladePoints(): readonly Vector3[] {
    this.root.updateMatrixWorld(true);
    const pts = CONFIG.swing.bladePoints;
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

  /** Feet position (y = 0). Returns a reused vector; do not keep a reference across steps. */
  get position(): Vector3 {
    return this.pos.set(this.motor.x, 0, this.motor.z);
  }

  // ---------------------------------------------------------------------------------------------

  private buildModel(): void {
    const M = P.model;
    const C = CONFIG.colors;
    const py = M.rollPivotHeight;
    const mat = (color: number): MeshStandardMaterial => {
      const m = new MeshStandardMaterial({ color, roughness: M.roughness, metalness: M.metalness });
      this.materials.push(m);
      this.baseColors.push(new Color(color));
      this.tintColors.push(new Color(color).lerp(WHITE, R.debugTint));
      return m;
    };
    const mesh = (geo: BoxGeometry | SphereGeometry, material: Material, parent: Object3D, p: Vec3Like): Mesh => {
      const m = new Mesh(geo, material);
      m.position.set(p.x, p.y, p.z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    this.root.add(this.rollPivot);
    this.rollPivot.position.y = py;

    // Body
    mesh(new BoxGeometry(M.body.size.x, M.body.size.y, M.body.size.z), mat(C.playerBody), this.rollPivot, {
      x: M.body.center.x,
      y: M.body.center.y - py,
      z: M.body.center.z,
    });

    // Head on the neck pivot, eyes on the head
    this.neckPivot.position.set(M.neckPivot.x, M.neckPivot.y - py, M.neckPivot.z);
    this.rollPivot.add(this.neckPivot);
    const head = mesh(
      new SphereGeometry(M.head.radius, M.sphereSegments, M.sphereSegments / 2),
      mat(C.playerHead),
      this.neckPivot,
      M.head.offset,
    );
    const eyeGeo = new SphereGeometry(M.eyes.radius, 8, 6);
    const eyeMat = mat(C.pupils);
    for (const sx of [-1, 1]) {
      const e = mesh(eyeGeo, eyeMat, head, { x: sx * M.eyes.offset.x, y: M.eyes.offset.y, z: M.eyes.offset.z });
      e.castShadow = false;
    }

    // Arms on shoulder pivots. Facing +Z, the character's right side is −X. The sword hangs
    // from the right shoulder, continuing the arm's direction.
    const armGeo = new BoxGeometry(M.arm.size.x, M.arm.size.y, M.arm.size.z);
    const armMat = mat(C.playerArms);
    for (const [pivot, sx] of [
      [this.shoulderL, 1],
      [this.shoulderR, -1],
    ] as const) {
      pivot.position.set(sx * M.shoulderPivot.x, M.shoulderPivot.y - py, M.shoulderPivot.z);
      this.rollPivot.add(pivot);
      mesh(armGeo, armMat, pivot, M.arm.offset);
    }
    mesh(new BoxGeometry(M.weapon.size.x, M.weapon.size.y, M.weapon.size.z), mat(C.weapon), this.shoulderR, M.weapon.offset);

    // Legs on hip pivots
    const legGeo = new BoxGeometry(M.leg.size.x, M.leg.size.y, M.leg.size.z);
    const legMat = mat(C.playerLegs);
    for (const [pivot, sx] of [
      [this.hipL, 1],
      [this.hipR, -1],
    ] as const) {
      pivot.position.set(sx * M.hipPivot.x, M.hipPivot.y - py, M.hipPivot.z);
      this.rollPivot.add(pivot);
      mesh(legGeo, legMat, pivot, M.leg.offset);
    }
  }

  /** GD §4.4: limb springs, walk cycle, head spring, lean; roll tuck and somersault; dizzy sway. */
  private updateWobble(dt: number): void {
    const m = this.motor;
    const s = clamp(m.speed() / P.maxSpeed, 0, 1);
    const rolling = m.action === 'rolling';

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
      armRT = CONFIG.swing.restAngle + w * W.armSwing * s + lag;
    }
    const k = W.limbStiffness;
    const c = W.limbDamping;
    for (const [spring, target] of [
      [this.legL, legLT],
      [this.legR, legRT],
      [this.armL, armLT],
    ] as const) {
      springStep(spring, target, k, c, dt);
      spring.x = clamp(spring.x, -W.limbClamp, W.limbClamp);
    }
    if (isSwingAction(m.action)) {
      // Right arm while swinging: driven directly by the swing curve, no spring (GD §4.4).
      this.armR.x = swingAngle(m.action, m.actionT);
      this.armR.v = 0;
    } else {
      springStep(this.armR, armRT, k, c, dt);
      this.armR.x = clamp(this.armR.x, -W.limbClamp, W.limbClamp);
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
    this.rollPivot.rotation.x = lean;
    this.rollPivot.rotation.z = sway;
    const M = P.model;
    this.neckPivot.position.set(M.neckPivot.x + this.headX.x, M.neckPivot.y - M.rollPivotHeight, M.neckPivot.z + this.headZ.x);
  }

  private syncTransform(): void {
    this.root.position.set(this.motor.x, 0, this.motor.z);
    this.root.rotation.y = this.motor.yaw;
  }

  /** ?debug: 30% white while invincible. */
  private updateTint(): void {
    if (!this.debugTint) return;
    const want = this.motor.isInvincible();
    if (want === this.tinted) return;
    this.tinted = want;
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].color.copy(want ? this.tintColors[i] : this.baseColors[i]);
    }
  }
}
