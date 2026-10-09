import { describe, expect, it } from 'vitest';
import {
  approach,
  clamp,
  easeIn,
  easeInOut,
  easeOut,
  lerp,
  smoothFactor,
  springStep,
  turnToward,
  wrapAngle,
  type SpringState,
} from '../src/util/math';
import { createRng } from '../src/util/rng';
import { STEP } from '../src/loop';
import { CONFIG } from '../src/config';

/** Runs a spring from x0 toward 0 for `seconds` at the fixed step; returns the max |x| seen and the final state. */
function runSpring(k: number, c: number, x0: number, seconds: number): { maxAbs: number; s: SpringState } {
  const s: SpringState = { x: x0, v: 0 };
  let maxAbs = Math.abs(x0);
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    springStep(s, 0, k, c, STEP);
    maxAbs = Math.max(maxAbs, Math.abs(s.x));
  }
  return { maxAbs, s };
}

describe('springStep (ARCHITECTURE §8: settles, no explosion at the fixed step)', () => {
  const cases = [
    { name: 'limbs', k: CONFIG.wobble.limbStiffness, c: CONFIG.wobble.limbDamping },
    { name: 'head', k: CONFIG.wobble.headStiffness, c: CONFIG.wobble.headDamping },
  ];

  for (const { name, k, c } of cases) {
    it(`${name} spring (k ${k}, c ${c}) settles within 3 s`, () => {
      const { s } = runSpring(k, c, 1, 3);
      expect(Math.abs(s.x)).toBeLessThan(1e-3);
      expect(Math.abs(s.v)).toBeLessThan(1e-2);
    });

    it(`${name} spring never exceeds its initial error`, () => {
      const { maxAbs } = runSpring(k, c, 1, 10);
      expect(maxAbs).toBeLessThanOrEqual(1);
    });

    it(`${name} spring stays bounded after a large velocity kick`, () => {
      const s: SpringState = { x: 0, v: 50 };
      let maxAbs = 0;
      for (let i = 0; i < 600; i++) {
        springStep(s, 0, k, c, STEP);
        maxAbs = Math.max(maxAbs, Math.abs(s.x));
      }
      expect(Number.isFinite(s.x)).toBe(true);
      expect(maxAbs).toBeLessThan(10);
      expect(Math.abs(s.x)).toBeLessThan(1e-3);
    });
  }

  it('moves toward a non-zero target', () => {
    const s: SpringState = { x: 0, v: 0 };
    for (let i = 0; i < 300; i++) springStep(s, 0.5, 120, 8, STEP);
    expect(s.x).toBeCloseTo(0.5, 3);
  });
});

describe('math helpers', () => {
  it('lerp and clamp', () => {
    expect(lerp(2, 4, 0.5)).toBe(3);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.3, 0, 1)).toBe(0.3);
  });

  it('easings hit 0 and 1 at the ends and clamp the input', () => {
    for (const f of [easeIn, easeOut, easeInOut]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      expect(f(-1)).toBe(0);
      expect(f(2)).toBe(1);
    }
    expect(easeIn(0.5)).toBeCloseTo(0.25);
    expect(easeOut(0.5)).toBeCloseTo(0.75);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
  });

  it('smoothFactor matches 1 − exp(−rate·dt)', () => {
    expect(smoothFactor(6, STEP)).toBeCloseTo(1 - Math.exp(-6 / 60), 10);
  });

  it('wrapAngle and turnToward take the shortest arc', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    // From 170° toward −170°: shortest is +20°, so a 0.1 rad step increases the angle.
    const from = (170 * Math.PI) / 180;
    const to = (-170 * Math.PI) / 180;
    expect(wrapAngle(turnToward(from, to, 0.1) - from)).toBeCloseTo(0.1);
    expect(turnToward(0, 0.05, 0.1)).toBeCloseTo(0.05);
  });

  it('approach never overshoots', () => {
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(approach(0.9, 1, 0.3)).toBe(1);
    expect(approach(0, -1, 0.3)).toBeCloseTo(-0.3);
  });
});

describe('rng', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('different seeds give different sequences', () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });
});
