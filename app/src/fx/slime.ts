/**
 * Boss slime motion (GD §6.1, milestone 1.5b; visual only, pure and unit tested).
 * - Squash and stretch with constant volume: the vertical scale follows its target through an
 *   underdamped spring; the horizontal scale is 1 / √sy.
 * - Lean (shear): the top lags behind the boss's horizontal acceleration and trails its velocity,
 *   in the boss's local frame. `Boss` turns both into one matrix on its visual group.
 */
import { CONFIG } from '../config';
import { clamp, springStep, type SpringState } from '../util/math';

const SL = CONFIG.boss.slime;

export class SlimeBody {
  readonly stretch: SpringState = { x: 1, v: 0 };
  readonly leanX: SpringState = { x: 0, v: 0 };
  readonly leanZ: SpringState = { x: 0, v: 0 };
  private prevX = 0;
  private prevZ = 0;
  private prevVx = 0;
  private prevVz = 0;
  private primed = false;

  reset(): void {
    this.stretch.x = 1;
    this.stretch.v = 0;
    this.leanX.x = this.leanX.v = 0;
    this.leanZ.x = this.leanZ.v = 0;
    this.primed = false;
  }

  /**
   * One step. `targetY`: the wanted vertical scale (attack pose × breathing). (x, z): the boss
   * position (world); `yaw`: the boss yaw (world → local for the lean).
   */
  step(dt: number, targetY: number, x: number, z: number, yaw: number): void {
    if (!this.primed) {
      this.prevX = x;
      this.prevZ = z;
      this.prevVx = this.prevVz = 0;
      this.primed = true;
    }
    const vx = (x - this.prevX) / dt;
    const vz = (z - this.prevZ) / dt;
    const ax = (vx - this.prevVx) / dt;
    const az = (vz - this.prevVz) / dt;
    this.prevX = x;
    this.prevZ = z;
    this.prevVx = vx;
    this.prevVz = vz;

    // World → boss local (root yaw): lx = wx·cos − wz·sin, lz = wx·sin + wz·cos.
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const tx = -(ax * c - az * s) * SL.leanPerAccel - (vx * c - vz * s) * SL.leanPerSpeed;
    const tz = -(ax * s + az * c) * SL.leanPerAccel - (vx * s + vz * c) * SL.leanPerSpeed;
    springStep(this.leanX, clamp(tx, -SL.maxLean, SL.maxLean), SL.leanStiffness, SL.leanDamping, dt);
    springStep(this.leanZ, clamp(tz, -SL.maxLean, SL.maxLean), SL.leanStiffness, SL.leanDamping, dt);
    this.leanX.x = clamp(this.leanX.x, -SL.maxLean, SL.maxLean);
    this.leanZ.x = clamp(this.leanZ.x, -SL.maxLean, SL.maxLean);

    springStep(this.stretch, targetY, SL.stiffness, SL.damping, dt);
    if (this.stretch.x < SL.minScale || this.stretch.x > SL.maxScale) {
      this.stretch.x = clamp(this.stretch.x, SL.minScale, SL.maxScale);
      this.stretch.v *= -0.3; // bounce off the limit instead of sticking to it
    }
  }

  /** Kicks the stretch spring (negative = splat down). */
  kick(velocity: number): void {
    this.stretch.v += velocity;
  }

  /** Kicks the lean (local frame, shear per second). */
  kickLean(vx: number, vz: number): void {
    this.leanX.v += vx;
    this.leanZ.v += vz;
  }

  get scaleY(): number {
    return this.stretch.x;
  }

  /** Constant volume: the horizontal scale for the current vertical scale. */
  get scaleXZ(): number {
    return 1 / Math.sqrt(this.stretch.x);
  }
}
