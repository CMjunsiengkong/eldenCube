import { describe, expect, it } from 'vitest';
import { BossBrain, type HitResult } from '../src/entities/Boss';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { createRng } from '../src/util/rng';
import type { Flags } from '../src/flags';

const NORMAL: Flags = { easy: false, debug: false };
const EASY: Flags = { easy: true, debug: false };
/** Player distance that neither counts as "close" nor blocks Charge. */
const FAR = 10;

/** A brain that never starts an attack on its own (for the pure HP/phase tests). */
function quietBrain(flags: Flags = NORMAL): BossBrain {
  const b = new BossBrain(createRng(1), flags);
  b.cooldownLeft = Infinity;
  return b;
}

/** Advances the brain until it can take damage again. */
function waitUntilVulnerable(b: BossBrain): void {
  let guard = 0;
  while (!b.canTakeDamage() && guard++ < 1000) {
    b.update(STEP, FAR);
    if (b.mode === 'cooldown') b.cooldownLeft = Infinity;
  }
}

/** Steps until `pred` holds; returns the elapsed simulation time. */
function stepUntil(b: BossBrain, pred: () => boolean, distance = FAR, max = 20): number {
  let t = 0;
  while (!pred() && t < max) {
    b.update(STEP, distance);
    t += STEP;
  }
  return t;
}

describe('boss HP / phase transitions (ARCHITECTURE §8, GAME_DESIGN §6.4)', () => {
  it('takeHit sequence → hit, hit, rage, hit, defeated', () => {
    const b = quietBrain();
    const results: HitResult[] = [];
    for (let i = 0; i < 5; i++) {
      waitUntilVulnerable(b);
      results.push(b.takeHit());
    }
    expect(results).toEqual(['hit', 'hit', 'rage', 'hit', 'defeated']);
    expect(b.hp).toBe(0);
    expect(b.phase).toBe('rage');
    expect(b.mode).toBe('defeated');
  });

  it('hits are ignored during the 0.4 s invulnerability', () => {
    const b = quietBrain();
    expect(b.takeHit()).toBe('hit');
    const steps = Math.round(CONFIG.boss.invulnerability / STEP);
    for (let i = 0; i < steps - 1; i++) {
      b.update(STEP, FAR);
      expect(b.takeHit()).toBe('ignored');
    }
    b.update(STEP, FAR);
    expect(b.takeHit()).toBe('hit');
    expect(b.hp).toBe(3);
  });

  it('hits are ignored during the 1.0 s rage transition (even after the invulnerability ends)', () => {
    const b = quietBrain();
    for (let i = 0; i < 2; i++) {
      waitUntilVulnerable(b);
      b.takeHit();
    }
    waitUntilVulnerable(b);
    expect(b.takeHit()).toBe('rage');
    expect(b.mode).toBe('rageTransition');
    let t = 0;
    while (b.mode === 'rageTransition') {
      expect(b.takeHit()).toBe('ignored');
      b.update(STEP, FAR);
      t += STEP;
    }
    expect(t).toBeCloseTo(CONFIG.rage.transitionDuration, 6);
    expect(b.hp).toBe(2);
    expect(b.takeHit()).toBe('hit');
  });

  it('no hits are counted after defeat', () => {
    const b = quietBrain();
    for (let i = 0; i < 5; i++) {
      waitUntilVulnerable(b);
      b.takeHit();
    }
    for (let i = 0; i < 60; i++) b.update(STEP, FAR);
    expect(b.takeHit()).toBe('ignored');
    expect(b.hp).toBe(0);
  });

  it('D9: the 3rd hit during an attack cancels it and starts the transition in the same step', () => {
    const b = quietBrain();
    for (let i = 0; i < 2; i++) {
      waitUntilVulnerable(b);
      b.takeHit();
    }
    waitUntilVulnerable(b);
    b.beginAttack('slam');
    expect(b.mode).toBe('attacking');
    expect(b.takeHit()).toBe('rage');
    expect(b.mode).toBe('rageTransition'); // same step, no update in between
    expect(b.current).toBeNull();
    expect(b.consumeCancel()).toBe(true);
    expect(b.consumeCancel()).toBe(false); // consumed once
  });

  it('D9: hits 1, 2 and 4 during an attack do not interrupt it', () => {
    const b = quietBrain();
    for (const expected of ['hit', 'hit'] as const) {
      waitUntilVulnerable(b);
      b.beginAttack('charge');
      expect(b.takeHit()).toBe(expected);
      expect(b.mode).toBe('attacking');
      expect(b.consumeCancel()).toBe(false);
      b.attackFinished();
      b.cooldownLeft = Infinity;
    }
    waitUntilVulnerable(b);
    expect(b.takeHit()).toBe('rage'); // not attacking: no cancel requested
    expect(b.consumeCancel()).toBe(false);
    waitUntilVulnerable(b);
    b.beginAttack('shards');
    expect(b.takeHit()).toBe('hit'); // 4th hit
    expect(b.mode).toBe('attacking');
    expect(b.current).toBe('shards');
    expect(b.consumeCancel()).toBe(false);
  });

  it('the 5th hit (defeat) requests cancelling a running attack (GD §6.6)', () => {
    const b = quietBrain();
    for (let i = 0; i < 4; i++) {
      waitUntilVulnerable(b);
      b.takeHit();
    }
    waitUntilVulnerable(b);
    b.beginAttack('slam');
    expect(b.takeHit()).toBe('defeated');
    expect(b.consumeCancel()).toBe(true);
  });

  it('reset restores full HP in Phase 1 with the grace period', () => {
    const b = quietBrain();
    for (let i = 0; i < 5; i++) {
      waitUntilVulnerable(b);
      b.takeHit();
    }
    b.reset();
    expect(b.hp).toBe(CONFIG.boss.hp);
    expect(b.phase).toBe('p1');
    expect(b.mode).toBe('grace');
    expect(b.cooldownLeft).toBe(CONFIG.boss.grace);
    expect(b.history).toEqual([]);
    expect(b.canTakeDamage()).toBe(true);
  });
});

describe('boss scheduler (GAME_DESIGN §6.2, §6.5; design §7.1)', () => {
  it('the first attack starts after the 2.0 s grace period', () => {
    const b = new BossBrain(createRng(3), NORMAL);
    const t = stepUntil(b, () => b.mode === 'attacking');
    expect(t).toBeCloseTo(CONFIG.boss.grace, 6);
    expect(b.history).toHaveLength(1);
    expect(b.current).toBe(b.history[0]);
  });

  it('cooldown from the end of one attack to the next: 2.5 s (P1), 1.6 s (rage), ×1.3 with ?easy', () => {
    for (const [flags, phase, expected] of [
      [NORMAL, 'p1', 2.5],
      [NORMAL, 'rage', 1.6],
      [EASY, 'p1', 2.5 * 1.3],
      [EASY, 'rage', 1.6 * 1.3],
    ] as const) {
      const b = new BossBrain(createRng(4), flags);
      b.phase = phase;
      b.beginAttack('slam');
      b.attackFinished();
      expect(b.mode).toBe('cooldown');
      expect(b.cooldownLeft).toBeCloseTo(expected, 9);
      const t = stepUntil(b, () => b.mode === 'attacking');
      expect(t).toBeCloseTo(expected, 1);
    }
  });

  it('after the rage transition a fresh rage cooldown starts (D10)', () => {
    const b = quietBrain();
    for (let i = 0; i < 2; i++) {
      waitUntilVulnerable(b);
      b.takeHit();
    }
    waitUntilVulnerable(b);
    b.beginAttack('slam');
    b.takeHit();
    stepUntil(b, () => b.mode !== 'rageTransition');
    expect(b.mode).toBe('cooldown');
    expect(b.cooldownLeft).toBeCloseTo(CONFIG.rage.cooldown, 9);
  });

  it('no attacks and no chase-relevant waiting during the rage transition', () => {
    const b = quietBrain();
    b.hp = 3;
    b.cooldownLeft = 0.01;
    b.takeHit();
    for (let i = 0; i < 30; i++) expect(b.update(STEP, FAR)).toBeNull();
    expect(b.waiting).toBe(false);
  });

  it('debug forcing overrides the next choice once', () => {
    const b = new BossBrain(createRng(5), NORMAL);
    b.forceNext = 'charge';
    stepUntil(b, () => b.mode === 'attacking', 2); // within 6 m: normally Charge is invalid
    expect(b.current).toBe('charge');
    expect(b.forceNext).toBeNull();
  });

  it('anti-camping: close timer ≥ 3.0 s at cooldown end forces Slam and resets the timer', () => {
    const b = new BossBrain(createRng(6), NORMAL);
    b.beginAttack('shards');
    b.attackFinished();
    b.closeTimer = 3.0;
    let started = null;
    while (!started) started = b.update(STEP, 2);
    expect(started).toBe('slam');
    expect(b.closeTimer).toBe(0);
  });

  it('anti-camping tell: annoyed while waiting in cooldown with the close timer ≥ 3.0 s', () => {
    const b = new BossBrain(createRng(7), NORMAL);
    b.beginAttack('slam');
    b.attackFinished();
    b.closeTimer = 2.99;
    expect(b.annoyed).toBe(false);
    b.update(STEP, 2);
    expect(b.annoyed).toBe(true);
    b.beginAttack('slam');
    expect(b.annoyed).toBe(false);
  });

  it('the close timer only counts while fighting (not while gloating)', () => {
    const b = quietBrain();
    b.update(1, 2);
    expect(b.closeTimer).toBeCloseTo(1);
    b.gloat();
    b.update(1, 2);
    expect(b.closeTimer).toBeCloseTo(1);
    expect(b.update(10, 2)).toBeNull();
  });
});
