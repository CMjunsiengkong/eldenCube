import { describe, expect, it } from 'vitest';
import { addPoise, BossBrain } from '../src/entities/Boss';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { createRng } from '../src/util/rng';
import type { Flags } from '../src/flags';

const NORMAL: Flags = { easy: false, debug: false };

/** A brain waiting in a cooldown that never ends on its own. */
function waitingBrain(): BossBrain {
  const b = new BossBrain(createRng(2), NORMAL);
  b.beginAttack('slam');
  b.attackFree();
  b.cooldownLeft = Infinity;
  return b;
}

describe('addPoise (GAME_DESIGN §6.2a)', () => {
  it('adds damage outside windows and triggers at 3, then resets', () => {
    expect(addPoise(0, 1, false)).toEqual({ poise: 1, trigger: false });
    expect(addPoise(1, 1, false)).toEqual({ poise: 2, trigger: false });
    expect(addPoise(2, 1, false)).toEqual({ poise: 0, trigger: true });
    expect(addPoise(1, 2, false)).toEqual({ poise: 0, trigger: true }); // Hit 3 deals 2
  });

  it('damage inside a punish window does not count', () => {
    expect(addPoise(2, 2, true)).toEqual({ poise: 2, trigger: false });
  });
});

describe('Royal Rebuke triggers — BossBrain', () => {
  it('poise: the 3rd damage outside a window makes the next move a Rebuke, right away when waiting', () => {
    const b = waitingBrain();
    b.takeHit(1);
    b.takeHit(1);
    expect(b.update(STEP, 10, false)).toBeNull();
    b.takeHit(1);
    expect(b.pendingRebuke).toBe('poise');
    expect(b.update(STEP, 10, false)).toBe('rebuke');
    expect(b.lastRebuke).toBe('poise');
    expect(b.poise).toBe(0);
  });

  it('poise during an attack: the Rebuke starts right after the attack, skipping the cooldown', () => {
    const b = waitingBrain();
    b.beginAttack('charge');
    b.takeHit(1);
    b.takeHit(2);
    expect(b.mode).toBe('attacking'); // never interrupts
    b.attackFree();
    expect(b.update(STEP, 10, false)).toBe('rebuke');
  });

  it('a punish window does not build poise', () => {
    const b = waitingBrain();
    b.beginAttack('slam');
    for (let i = 0; i < 4; i++) b.takeHit(1, true);
    expect(b.poise).toBe(0);
    expect(b.pendingRebuke).toBeNull();
  });

  it('close (2026-10-12): extremely close at the end of the cooldown, Rebuke is picked about 80% of the time', () => {
    let rebukes = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const b = new BossBrain(createRng(seed), NORMAL);
      b.beginAttack('slam');
      b.attackFree();
      b.cooldownLeft = STEP / 2;
      if (b.update(STEP, 3, false) === 'rebuke') rebukes++;
    }
    expect(rebukes / 400).toBeGreaterThan(0.7);
    expect(rebukes / 400).toBeLessThan(0.9);
  });

  it('after a Crown Rain the next pick happens right away (cooldown 0)', () => {
    const b = new BossBrain(createRng(3), NORMAL);
    b.beginAttack('rain');
    b.attackFree();
    expect(b.cooldownLeft).toBe(0);
    expect(b.update(STEP, 10, true)).not.toBeNull();
  });

  it('window end: requestRebuke("window") is honored when the boss becomes free', () => {
    const b = waitingBrain();
    b.beginAttack('slam');
    b.requestRebuke('window');
    b.attackFree();
    expect(b.update(STEP, 3, false)).toBe('rebuke');
    expect(b.lastRebuke).toBe('window');
  });

  it('the Rebuke is not part of the attack history', () => {
    const b = waitingBrain();
    const before = [...b.history];
    b.requestRebuke('debug');
    expect(b.update(STEP, 10, false)).toBe('rebuke');
    expect(b.history).toEqual(before);
  });

  it('no Rebuke request during the rage transition or while gloating', () => {
    const b = waitingBrain();
    b.hp = CONFIG.rage.hpThreshold + 1;
    b.takeHit(1);
    expect(b.mode).toBe('rageTransition');
    b.requestRebuke('debug');
    expect(b.pendingRebuke).toBeNull();
    b.gloat();
    b.requestRebuke('debug');
    expect(b.pendingRebuke).toBeNull();
  });
});
