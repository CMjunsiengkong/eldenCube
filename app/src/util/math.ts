/** Small math helpers (ARCHITECTURE.md §5.5). Pure; no allocation. */
import type { Rng } from './rng';

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (x: number, min: number, max: number): number => (x < min ? min : x > max ? max : x);

export const clamp01 = (x: number): number => clamp(x, 0, 1);

/** Quadratic easings on t ∈ [0, 1] (input is clamped). */
export const easeIn = (t: number): number => {
  const u = clamp01(t);
  return u * u;
};

export const easeOut = (t: number): number => {
  const u = clamp01(t);
  return 1 - (1 - u) * (1 - u);
};

export const easeInOut = (t: number): number => {
  const u = clamp01(t);
  return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
};

/** Frame-rate independent smoothing factor: 1 − exp(−rate × dt). */
export const smoothFactor = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** A damped spring's state. */
export interface SpringState {
  x: number;
  v: number;
}

/**
 * One semi-implicit Euler step of a damped spring (ARCHITECTURE §5.5):
 * a = k·(target − x) − c·v;  v += a·dt;  x += v·dt.  Mutates and returns `s`.
 */
export function springStep(s: SpringState, target: number, k: number, c: number, dt: number): SpringState {
  const a = k * (target - s.x) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
  return s;
}

/** Wraps an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = a % twoPi;
  if (r <= -Math.PI) r += twoPi;
  else if (r > Math.PI) r -= twoPi;
  return r;
}

/** Turns `current` toward `target` along the shortest arc by at most `maxStep` radians. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(diff) * maxStep);
}

/** Uniform random number in [min, max). */
export const randRange = (rng: Rng, min: number, max: number): number => min + (max - min) * rng();

/** Moves `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}
