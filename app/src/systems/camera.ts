/**
 * Camera controller (GAME_DESIGN §7): title orbit, lock-on follow, title → fight blend, shake.
 * Runs in real time (called from Game.realUpdate), so shake and smoothing continue smoothly
 * during hit-stop.
 */
import { Vector3, type PerspectiveCamera } from 'three';
import { CONFIG } from '../config';
import { easeInOut, smoothFactor } from '../util/math';
import type { Rng } from '../util/rng';
import type { Vec3Like } from './collision';

const CAM = CONFIG.camera;
const F = CAM.follow;

export type CameraMode = 'orbit' | 'blend' | 'lockOn';

/**
 * Pure: the lock-on desired camera position and look-at point (GD §7). Writes into `pos` / `look`.
 * `dir` is the last valid horizontal boss→player unit vector; it is updated in place.
 */
export function lockOnPose(
  player: Vec3Like,
  boss: Vec3Like,
  dir: { x: number; z: number },
  pos: Vec3Like,
  look: Vec3Like,
): void {
  const dx = player.x - boss.x;
  const dz = player.z - boss.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 1e-4) {
    dir.x = dx / dist;
    dir.z = dz / dist;
  }
  const close = dist < F.closeThreshold;
  const back = close ? F.closeDistance : F.distance;
  const height = close ? F.closeHeight : F.height;
  pos.x = player.x + dir.x * back;
  pos.y = player.y + height;
  pos.z = player.z + dir.z * back;
  look.x = player.x + (boss.x - player.x) * F.lookBlend;
  look.y = player.y + (boss.y - player.y) * F.lookBlend + F.lookHeight;
  look.z = player.z + (boss.z - player.z) * F.lookBlend;
}

/** Pure: the title orbit pose at `angle` (GD §7). */
export function orbitPose(angle: number, pos: Vec3Like, look: Vec3Like): void {
  const o = CAM.orbit;
  pos.x = o.target.x + Math.sin(angle) * o.radius;
  pos.y = o.height;
  pos.z = o.target.z + Math.cos(angle) * o.radius;
  look.x = o.target.x;
  look.y = o.target.y;
  look.z = o.target.z;
}

export class CameraController {
  mode: CameraMode = 'orbit';

  private readonly camera: PerspectiveCamera;
  private readonly rng: Rng;
  private orbitAngle: number = CAM.orbit.startAngle;
  private blendT = 0;
  private blendDuration = 0;

  private readonly dir = { x: 0, z: 1 };
  private readonly desiredPos = new Vector3();
  private readonly desiredLook = new Vector3();
  private readonly lockPos = new Vector3();
  private readonly lockLook = new Vector3();
  private readonly orbPos = new Vector3();
  private readonly orbLook = new Vector3();
  private readonly finalPos = new Vector3();
  private readonly finalLook = new Vector3();
  private lookOverride: Vector3 | null = null;

  private shakeAmp = 0;
  private shakeDuration = 0;
  private shakeLeft = 0;
  private readonly shakeOffset = new Vector3();

  constructor(camera: PerspectiveCamera, rng: Rng) {
    this.camera = camera;
    this.rng = rng;
    this.setOrbit();
  }

  /** Title orbit, always from the same start angle (GD §7). */
  setOrbit(): void {
    this.mode = 'orbit';
    this.orbitAngle = CAM.orbit.startAngle;
    this.lookOverride = null;
    this.clearShake();
    orbitPose(this.orbitAngle, this.finalPos, this.finalLook);
    this.apply();
  }

  /** Starts the title → fight blend (ease-in-out over `duration` seconds). */
  blendToLockOn(duration: number, player: Vec3Like, boss: Vec3Like): void {
    this.mode = 'blend';
    this.blendT = 0;
    this.blendDuration = duration;
    this.snapLockOn(player, boss);
  }

  /** Jumps the smoothed lock-on state to its target (no smoothing). */
  snapLockOn(player: Vec3Like, boss: Vec3Like): void {
    lockOnPose(player, boss, this.dir, this.lockPos, this.lockLook);
    if (this.mode === 'orbit') this.mode = 'lockOn';
  }

  /** While dying, the look-at point moves toward this point (GD §7); null to clear. */
  setLookOverride(p: Vec3Like | null): void {
    if (p === null) {
      this.lookOverride = null;
      return;
    }
    if (!this.lookOverride) this.lookOverride = new Vector3();
    this.lookOverride.set(p.x, p.y, p.z);
  }

  /** A new shake replaces the current one only if it is stronger (GD §7). */
  shake(amplitude: number, duration: number): void {
    const current = this.shakeDuration > 0 ? this.shakeAmp * (this.shakeLeft / this.shakeDuration) : 0;
    if (amplitude <= current) return;
    this.shakeAmp = amplitude;
    this.shakeDuration = duration;
    this.shakeLeft = duration;
  }

  clearShake(): void {
    this.shakeAmp = 0;
    this.shakeDuration = 0;
    this.shakeLeft = 0;
  }

  /** Camera forward projected on XZ, normalized (the WASD basis, GD §7). */
  forwardXZ(out: { x: number; z: number }): { x: number; z: number } {
    let x = this.finalLook.x - this.finalPos.x;
    let z = this.finalLook.z - this.finalPos.z;
    const len = Math.hypot(x, z);
    if (len < 1e-6) {
      x = 0;
      z = -1;
    } else {
      x /= len;
      z /= len;
    }
    out.x = x;
    out.z = z;
    return out;
  }

  update(dt: number, player: Vec3Like, boss: Vec3Like): void {
    if (this.mode !== 'lockOn') {
      this.orbitAngle += CAM.orbit.speed * dt;
      orbitPose(this.orbitAngle, this.orbPos, this.orbLook);
    }
    if (this.mode !== 'orbit') {
      lockOnPose(player, boss, this.dir, this.desiredPos, this.desiredLook);
      if (this.lookOverride) this.desiredLook.copy(this.lookOverride);
      const f = smoothFactor(CAM.smoothing, dt);
      this.lockPos.lerp(this.desiredPos, f);
      this.lockLook.lerp(this.desiredLook, f);
    }

    switch (this.mode) {
      case 'orbit':
        this.finalPos.copy(this.orbPos);
        this.finalLook.copy(this.orbLook);
        break;
      case 'blend': {
        this.blendT += dt;
        const w = easeInOut(this.blendDuration > 0 ? this.blendT / this.blendDuration : 1);
        this.finalPos.copy(this.orbPos).lerp(this.lockPos, w);
        this.finalLook.copy(this.orbLook).lerp(this.lockLook, w);
        if (w >= 1) this.mode = 'lockOn';
        break;
      }
      case 'lockOn':
        this.finalPos.copy(this.lockPos);
        this.finalLook.copy(this.lockLook);
        break;
    }

    // Shake: random offset whose amplitude decays linearly to 0 over its duration.
    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const a = this.shakeAmp * (this.shakeLeft / this.shakeDuration);
      this.shakeOffset.set(this.rng() * 2 - 1, this.rng() * 2 - 1, this.rng() * 2 - 1);
      if (this.shakeOffset.lengthSq() > 1e-9) this.shakeOffset.normalize().multiplyScalar(a);
    } else {
      this.shakeOffset.set(0, 0, 0);
    }
    this.apply();
  }

  private apply(): void {
    const c = this.camera;
    c.position.copy(this.finalPos).add(this.shakeOffset);
    if (c.position.y < CAM.minY) c.position.y = CAM.minY; // never below 1.0 m
    c.lookAt(this.finalLook);
  }
}
