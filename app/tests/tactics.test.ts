import { describe, expect, it } from 'vitest';
import { addPoise, BossBrain, updateCloseTimer } from '../src/entities/Boss';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { createRng } from '../src/util/rng';
import type { Flags } from '../src/flags';

const NORMAL: Flags = { easy: false, debug: false };
const RB = CONFIG.rebuke;

/** A brain waiting in a cooldown that never ends on its own. */
function waitingBrain(): BossBrain {
  const b = new BossBrain(createRng(2), NORMAL);
  b.beginAttack('slam');
  b.attackFree();
  b.cooldownLeft = Infinity;
  return b;
}

describe('updateCloseTimer (GAME_DESIGN §6.2a)', () => {
  it('+dt while closer than 5.0 m and waiting', () => {
    expect(updateCloseTimer(0.2, 4.99, true, 0.5)).toBeCloseTo(0.7);
  });

  it('−2·dt otherwise (5.0 m counts as not close; not waiting), never below 0', () => {
    expect(updateCloseTimer(1, 5.0, true, 0.25)).toBeCloseTo(0.5);
    expect(updateCloseTimer(1, 2, false, 0.25)).toBeCloseTo(0.5);
    expect(updateCloseTimer(0.1, 10, true, 0.25)).toBe(0);
  });
});

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

  it('close: 1.0 s within 5 m while waiting triggers a Rebuke; the tell starts at 0.5 s', () => {
    const b = waitingBrain();
    let t = 0;
    let started = null;
    let annoyedAt = -1;
    while (!started && t < 3) {
      started = b.update(STEP, 3, false);
      t += STEP;
      if (annoyedAt < 0 && b.annoyed) annoyedAt = t;
    }
    expect(started).toBe('rebuke');
    expect(b.lastRebuke).toBe('close');
    expect(t).toBeCloseTo(RB.closeTrigger, 1);
    expect(annoyedAt).toBeCloseTo(RB.annoyedAt, 1);
    expect(b.closeTimer).toBe(0);
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
    b.hp = 9;
    b.takeHit(1);
    expect(b.mode).toBe('rageTransition');
    b.requestRebuke('debug');
    expect(b.pendingRebuke).toBeNull();
    b.gloat();
    b.requestRebuke('debug');
    expect(b.pendingRebuke).toBeNull();
  });
});
