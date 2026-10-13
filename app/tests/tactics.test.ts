import { describe, expect, it } from 'vitest';
import { addPoise, BossBrain, chooseDefence } from '../src/entities/Boss';
import { DEFENCE_IDS } from '../src/attacks/Attack';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { createRng } from '../src/util/rng';
import type { Flags } from '../src/flags';

const NORMAL: Flags = { easy: false, debug: false, lowfx: false };

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

describe('Close-range defence triggers — BossBrain (1.6: Rebuke, Hop-Back or Shove)', () => {
  it('poise: the 3rd damage outside a window makes the next move a defence, right away when waiting', () => {
    const b = waitingBrain();
    b.takeHit(1);
    b.takeHit(1);
    expect(b.update(STEP, 10, false)).toBeNull();
    b.takeHit(1);
    expect(b.pendingRebuke).toBe('poise');
    expect(DEFENCE_IDS).toContain(b.update(STEP, 10, false));
    expect(b.lastRebuke).toBe('poise');
    expect(b.poise).toBe(0);
  });

  it('poise during an attack: the defence starts right after the attack, skipping the cooldown', () => {
    const b = waitingBrain();
    b.beginAttack('charge');
    b.takeHit(1);
    b.takeHit(2);
    expect(b.mode).toBe('attacking'); // never interrupts
    b.attackFree();
    expect(DEFENCE_IDS).toContain(b.update(STEP, 10, false));
  });

  it('a punish window does not build poise', () => {
    const b = waitingBrain();
    b.beginAttack('slam');
    for (let i = 0; i < 4; i++) b.takeHit(1, true);
    expect(b.poise).toBe(0);
    expect(b.pendingRebuke).toBeNull();
  });

  it('close (1.6): extremely close at the end of the cooldown, a defence is picked about 85% of the time (Rebuke about 45%)', () => {
    let defences = 0;
    let rebukes = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const b = new BossBrain(createRng(seed), NORMAL);
      b.beginAttack('slam');
      b.attackFree();
      b.cooldownLeft = STEP / 2;
      const m = b.update(STEP, 3, false);
      if ((DEFENCE_IDS as readonly (string | null)[]).includes(m)) defences++;
      if (m === 'rebuke') rebukes++;
    }
    expect(defences / 600).toBeGreaterThan(0.78);
    expect(defences / 600).toBeLessThan(0.92);
    expect(rebukes / 600).toBeGreaterThan(0.38);
    expect(rebukes / 600).toBeLessThan(0.52);
  });

  it('triggered defences split Rebuke 45 / Hop-Back 25 / Shove 15 (chooseDefence)', () => {
    const rng = createRng(11);
    const n: Record<string, number> = { rebuke: 0, hop: 0, shove: 0 };
    for (let i = 0; i < 6000; i++) n[chooseDefence(rng)]++;
    expect(n.rebuke / 6000).toBeCloseTo(45 / 85, 1);
    expect(n.hop / 6000).toBeCloseTo(25 / 85, 1);
    expect(n.shove / 6000).toBeCloseTo(15 / 85, 1);
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
    expect(DEFENCE_IDS).toContain(b.update(STEP, 3, false));
    expect(b.lastRebuke).toBe('window');
  });

  it('defences are not part of the attack history', () => {
    const b = waitingBrain();
    const before = [...b.history];
    for (const id of DEFENCE_IDS) {
      b.forceNext = id;
      b.cooldownLeft = 0;
      expect(b.update(STEP, 10, false)).toBe(id);
      b.attackFree();
    }
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
