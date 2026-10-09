import { describe, expect, it } from 'vitest';
import { BossBrain, type HitResult } from '../src/entities/Boss';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';

/** Advances the brain until it can take damage again. */
function waitUntilVulnerable(b: BossBrain): void {
  let guard = 0;
  while (!b.canTakeDamage() && guard++ < 1000) b.update(STEP);
}

describe('boss HP / phase transitions (ARCHITECTURE §8, GAME_DESIGN §6.4)', () => {
  it('takeHit sequence → hit, hit, rage, hit, defeated', () => {
    const b = new BossBrain();
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
    const b = new BossBrain();
    expect(b.takeHit()).toBe('hit');
    const steps = Math.round(CONFIG.boss.invulnerability / STEP);
    for (let i = 0; i < steps - 1; i++) {
      b.update(STEP);
      expect(b.takeHit()).toBe('ignored');
    }
    b.update(STEP);
    expect(b.takeHit()).toBe('hit');
    expect(b.hp).toBe(3);
  });

  it('hits are ignored during the 1.0 s rage transition (even after the invulnerability ends)', () => {
    const b = new BossBrain();
    waitUntilVulnerable(b);
    b.takeHit();
    waitUntilVulnerable(b);
    b.takeHit();
    waitUntilVulnerable(b);
    expect(b.takeHit()).toBe('rage');
    expect(b.mode).toBe('rageTransition');
    let t = 0;
    while (b.mode === 'rageTransition') {
      expect(b.takeHit()).toBe('ignored');
      b.update(STEP);
      t += STEP;
    }
    expect(t).toBeCloseTo(CONFIG.rage.transitionDuration, 6);
    expect(b.hp).toBe(2);
    expect(b.takeHit()).toBe('hit');
  });

  it('no hits are counted after defeat', () => {
    const b = new BossBrain();
    for (let i = 0; i < 5; i++) {
      waitUntilVulnerable(b);
      b.takeHit();
    }
    for (let i = 0; i < 60; i++) b.update(STEP);
    expect(b.takeHit()).toBe('ignored');
    expect(b.hp).toBe(0);
  });

  it('D9: the 3rd hit during an attack cancels it and starts the transition in the same step', () => {
    const b = new BossBrain();
    waitUntilVulnerable(b);
    b.takeHit();
    waitUntilVulnerable(b);
    b.takeHit();
    waitUntilVulnerable(b);
    b.setAttacking(true);
    expect(b.mode).toBe('attacking');
    expect(b.takeHit()).toBe('rage');
    expect(b.mode).toBe('rageTransition'); // same step, no update in between
    expect(b.consumeCancel()).toBe(true);
    expect(b.consumeCancel()).toBe(false); // consumed once
  });

  it('D9: hits 1, 2 and 4 during an attack do not interrupt it', () => {
    const b = new BossBrain();
    for (const expected of ['hit', 'hit'] as const) {
      waitUntilVulnerable(b);
      b.setAttacking(true);
      expect(b.takeHit()).toBe(expected);
      expect(b.mode).toBe('attacking');
      expect(b.consumeCancel()).toBe(false);
      b.setAttacking(false);
    }
    waitUntilVulnerable(b);
    expect(b.takeHit()).toBe('rage'); // not attacking: no cancel requested
    expect(b.consumeCancel()).toBe(false);
    waitUntilVulnerable(b);
    b.setAttacking(true);
    expect(b.takeHit()).toBe('hit'); // 4th hit
    expect(b.mode).toBe('attacking');
    expect(b.consumeCancel()).toBe(false);
  });

  it('the 5th hit (defeat) requests cancelling a running attack (GD §6.6)', () => {
    const b = new BossBrain();
    for (let i = 0; i < 4; i++) {
      waitUntilVulnerable(b);
      b.takeHit();
    }
    waitUntilVulnerable(b);
    b.setAttacking(true);
    expect(b.takeHit()).toBe('defeated');
    expect(b.consumeCancel()).toBe(true);
  });

  it('reset restores full HP in Phase 1', () => {
    const b = new BossBrain();
    for (let i = 0; i < 5; i++) {
      waitUntilVulnerable(b);
      b.takeHit();
    }
    b.reset();
    expect(b.hp).toBe(CONFIG.boss.hp);
    expect(b.phase).toBe('p1');
    expect(b.mode).toBe('idle');
    expect(b.canTakeDamage()).toBe(true);
  });
});
