import { describe, expect, it } from 'vitest';
import { BossBrain, type HitResult } from '../src/entities/Boss';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { createRng } from '../src/util/rng';
import type { Flags } from '../src/flags';

const NORMAL: Flags = { easy: false, debug: false };
const EASY: Flags = { easy: true, debug: false };
/** Player distance that is neither "close" nor blocks Charge. */
const FAR = 10;

/** A brain that never starts an attack on its own (pure HP/phase tests); hits count in a window. */
function quietBrain(flags: Flags = NORMAL): BossBrain {
  const b = new BossBrain(createRng(1), flags);
  b.cooldownLeft = Infinity;
  return b;
}

/** Steps until `pred` holds; returns the elapsed simulation time. */
function stepUntil(b: BossBrain, pred: () => boolean, distance = FAR, max = 20): number {
  let t = 0;
  while (!pred() && t < max) {
    b.update(STEP, distance, false);
    t += STEP;
  }
  return t;
}

describe('boss HP / phase transitions (GAME_DESIGN §5, §6.4)', () => {
  it('20 HP; damage 1/1/2 per combo; rage at ≤ 8; defeat at 0', () => {
    const b = quietBrain();
    const results: HitResult[] = [];
    // Five full combos (1 + 1 + 2), all inside punish windows so no Rebuke interferes.
    for (let c = 0; c < 5; c++) {
      for (const d of [1, 1, 2]) {
        if (b.mode === 'rageTransition') stepUntil(b, () => b.mode !== 'rageTransition');
        if (b.mode === 'cooldown') b.cooldownLeft = Infinity;
        results.push(b.takeHit(d, true));
      }
    }
    expect(results.filter((r) => r === 'rage')).toHaveLength(1);
    expect(results.indexOf('rage')).toBe(8); // HP 20 → 8 on the 3rd combo's finisher
    expect(results.at(-1)).toBe('defeated');
    expect(b.hp).toBe(0);
    expect(b.mode).toBe('defeated');
  });

  it('there is no invulnerability between hits', () => {
    const b = quietBrain();
    expect(b.takeHit(1, true)).toBe('hit');
    expect(b.takeHit(1, true)).toBe('hit');
    expect(b.hp).toBe(18);
  });

  it('hits are ignored during the 1.0 s rage transition', () => {
    const b = quietBrain();
    b.hp = 9;
    expect(b.takeHit(1)).toBe('rage');
    let t = 0;
    while (b.mode === 'rageTransition') {
      expect(b.takeHit(1)).toBe('ignored');
      b.update(STEP, FAR, false);
      t += STEP;
    }
    expect(t).toBeCloseTo(CONFIG.rage.transitionDuration, 6);
    expect(b.hp).toBe(8);
  });

  it('D10: after the transition a fresh rage cooldown (0.6 s) starts', () => {
    const b = quietBrain();
    b.hp = 9;
    b.takeHit(1);
    stepUntil(b, () => b.mode !== 'rageTransition');
    expect(b.mode).toBe('cooldown');
    expect(b.cooldownLeft).toBeCloseTo(CONFIG.rage.cooldown, 9);
  });

  it('the rage hit requests cancelling the attack AND all hazards, in the same step', () => {
    const b = quietBrain();
    b.hp = 10;
    b.beginAttack('slam');
    expect(b.takeHit(2)).toBe('rage');
    expect(b.mode).toBe('rageTransition');
    expect(b.current).toBeNull();
    expect(b.consumeCancel()).toBe(true);
    expect(b.consumeCancel()).toBe(false);
    // Also when no attack runs (hazards may still fly).
    const c = quietBrain();
    c.hp = 9;
    c.takeHit(1);
    expect(c.consumeCancel()).toBe(true);
  });

  it('other hits never interrupt a running attack', () => {
    const b = quietBrain();
    b.beginAttack('rain');
    expect(b.takeHit(1)).toBe('hit');
    expect(b.takeHit(1)).toBe('hit');
    expect(b.mode).toBe('attacking');
    expect(b.current).toBe('rain');
    expect(b.consumeCancel()).toBe(false);
  });

  it('defeat requests cancelling everything; no hits after defeat or while gloating', () => {
    const b = quietBrain();
    b.phase = 'rage';
    b.hp = 2;
    b.beginAttack('charge');
    expect(b.takeHit(2)).toBe('defeated');
    expect(b.consumeCancel()).toBe(true);
    expect(b.takeHit(1)).toBe('ignored');
    const g = quietBrain();
    g.gloat();
    expect(g.takeHit(1)).toBe('ignored');
  });

  it('reset restores 20 HP in Phase 1 with the 1.0 s grace', () => {
    const b = quietBrain();
    b.takeHit(5);
    b.poise = 2;
    b.reset();
    expect(b.hp).toBe(CONFIG.boss.hp);
    expect(b.phase).toBe('p1');
    expect(b.mode).toBe('grace');
    expect(b.cooldownLeft).toBe(CONFIG.boss.grace);
    expect(b.poise).toBe(0);
    expect(b.history).toEqual([]);
  });
});

describe('boss scheduler (GAME_DESIGN §6.2, §6.5)', () => {
  it('the first attack starts after the 1.0 s grace period', () => {
    const b = new BossBrain(createRng(3), NORMAL);
    const t = stepUntil(b, () => b.mode === 'attacking');
    expect(t).toBeCloseTo(CONFIG.boss.grace, 6);
    expect(b.history).toHaveLength(1);
  });

  it('cooldown from the moment the boss is free: 1.0 s (P1), 0.6 s (rage), ×1.3 with ?easy', () => {
    for (const [flags, phase, expected] of [
      [NORMAL, 'p1', 1.0],
      [NORMAL, 'rage', 0.6],
      [EASY, 'p1', 1.3],
      [EASY, 'rage', 0.78],
    ] as const) {
      const b = new BossBrain(createRng(4), flags);
      b.phase = phase;
      b.beginAttack('slam');
      b.attackFree();
      expect(b.mode).toBe('cooldown');
      expect(b.cooldownLeft).toBeCloseTo(expected, 9);
      const t = stepUntil(b, () => b.mode === 'attacking');
      expect(t).toBeCloseTo(expected, 1);
    }
  });

  it('while attacking, nothing new starts until attackFree()', () => {
    const b = new BossBrain(createRng(5), NORMAL);
    b.beginAttack('rain');
    for (let i = 0; i < 600; i++) expect(b.update(STEP, FAR, true)).toBeNull();
  });

  it('debug forcing overrides the next choice once', () => {
    const b = new BossBrain(createRng(5), NORMAL);
    b.forceNext = 'charge';
    stepUntil(b, () => b.mode === 'attacking', 5.5); // within 6 m: normally Charge is invalid
    expect(b.current).toBe('charge');
    expect(b.forceNext).toBeNull();
  });
});
