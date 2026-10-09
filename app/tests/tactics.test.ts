import { describe, expect, it } from 'vitest';
import { applyMissPunish, BossBrain, updateCloseTimer } from '../src/entities/Boss';
import { STEP } from '../src/loop';
import { createRng } from '../src/util/rng';
import type { Flags } from '../src/flags';

const NORMAL: Flags = { easy: false, debug: false };
const EASY: Flags = { easy: true, debug: false };

describe('updateCloseTimer (GAME_DESIGN §6.2a)', () => {
  it('+dt while closer than 4.0 m', () => {
    expect(updateCloseTimer(1, 3.99, 0.5)).toBeCloseTo(1.5);
    expect(updateCloseTimer(0, 0, STEP)).toBeCloseTo(STEP);
  });

  it('−2·dt while not close (4.0 m counts as not close), never below 0', () => {
    expect(updateCloseTimer(1, 4.0, 0.25)).toBeCloseTo(0.5);
    expect(updateCloseTimer(1, 10, 0.25)).toBeCloseTo(0.5);
    expect(updateCloseTimer(0.1, 10, 0.25)).toBe(0);
    expect(updateCloseTimer(0, 10, 1)).toBe(0);
  });

  it('3 s close then 1.5 s away returns to 0', () => {
    let t = 0;
    for (let i = 0; i < 180; i++) t = updateCloseTimer(t, 2, STEP);
    expect(t).toBeCloseTo(3, 6);
    for (let i = 0; i < 90; i++) t = updateCloseTimer(t, 8, STEP);
    expect(t).toBeCloseTo(0, 6);
  });
});

describe('applyMissPunish (GAME_DESIGN §6.2a)', () => {
  it('takes 0.8 s off the remaining cooldown', () => {
    expect(applyMissPunish(2.0, false)).toEqual({ remaining: expect.closeTo(1.2, 9), punished: true });
  });

  it('never below 0.3 s', () => {
    expect(applyMissPunish(0.9, false).remaining).toBeCloseTo(0.3, 9);
    expect(applyMissPunish(0.2, false).remaining).toBeCloseTo(0.3, 9);
  });

  it('at most once per cooldown', () => {
    expect(applyMissPunish(2.0, true)).toEqual({ remaining: 2.0, punished: true });
  });

  it('D3: with ?easy the base cooldown is scaled first, then the fixed 0.8 s / 0.3 s apply', () => {
    const b = new BossBrain(createRng(1), EASY);
    b.beginAttack('slam');
    b.attackFinished();
    expect(b.cooldownLeft).toBeCloseTo(2.5 * 1.3, 9);
    expect(b.onPlayerMissedSwing(2)).toBe(true);
    expect(b.cooldownLeft).toBeCloseTo(3.25 - 0.8, 9);
    // Rage + easy, late in the cooldown: floor stays 0.3 (not scaled).
    const r = new BossBrain(createRng(1), EASY);
    r.phase = 'rage';
    r.beginAttack('slam');
    r.attackFinished();
    expect(r.cooldownLeft).toBeCloseTo(1.6 * 1.3, 9);
    r.cooldownLeft = 0.9;
    r.onPlayerMissedSwing(2);
    expect(r.cooldownLeft).toBeCloseTo(0.3, 9);
  });
});

describe('punish rushing in — BossBrain.onPlayerMissedSwing', () => {
  function inCooldown(): BossBrain {
    const b = new BossBrain(createRng(2), NORMAL);
    b.beginAttack('shards');
    b.attackFinished();
    return b;
  }

  it('fires within 5.0 m while waiting, once per cooldown', () => {
    const b = inCooldown();
    expect(b.onPlayerMissedSwing(4.9)).toBe(true);
    expect(b.cooldownLeft).toBeCloseTo(1.7, 9);
    expect(b.onPlayerMissedSwing(1)).toBe(false);
    expect(b.cooldownLeft).toBeCloseTo(1.7, 9);
  });

  it('does not fire at 5.0 m or farther', () => {
    const b = inCooldown();
    expect(b.onPlayerMissedSwing(5.0)).toBe(false);
    expect(b.cooldownLeft).toBeCloseTo(2.5, 9);
  });

  it('does not fire while attacking or in the rage transition', () => {
    const b = inCooldown();
    b.beginAttack('slam');
    expect(b.onPlayerMissedSwing(1)).toBe(false);
    b.hp = 3;
    b.takeHit();
    expect(b.mode).toBe('rageTransition');
    expect(b.onPlayerMissedSwing(1)).toBe(false);
  });

  it('the limit resets when a new cooldown starts', () => {
    const b = inCooldown();
    b.onPlayerMissedSwing(1);
    b.beginAttack('slam');
    b.attackFinished();
    expect(b.punished).toBe(false);
    expect(b.onPlayerMissedSwing(1)).toBe(true);
  });

  it('works independently of anti-camping in the same cooldown', () => {
    const b = inCooldown();
    b.closeTimer = 3;
    expect(b.onPlayerMissedSwing(1)).toBe(true);
    let started = null;
    let t = 0;
    while (!started) {
      started = b.update(STEP, 1);
      t += STEP;
    }
    expect(t).toBeCloseTo(1.7, 1);
    expect(started).toBe('slam');
  });
});
