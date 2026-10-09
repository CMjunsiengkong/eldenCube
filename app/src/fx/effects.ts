/**
 * Visual effects helpers (ARCHITECTURE §3 fx/effects.ts). Milestone 1.3: hit flash, squash spring,
 * color fade. Warning circles, shockwave ring and puffs are added in 1.4.
 */
import { CONFIG } from '../config';
import { clamp01 } from '../util/math';

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
