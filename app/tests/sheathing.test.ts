import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { comboElbow, PlayerMotor, SwordHolster, type MotorInput } from '../src/entities/Player';

const CB = CONFIG.combo;
const SW = CONFIG.player.sword;

const input = (attack = false): MotorInput => ({
  moveX: 0,
  moveZ: 0,
  wantRoll: false,
  wantAttack: attack,
  wantFlask: false,
  allowAttack: true,
  bossX: 0,
  bossZ: 0,
  obstacle: null,
});

describe('elbow during the combo (GAME_DESIGN §4.3, 1.5b)', () => {
  it('is exactly straight during every active phase, so the blade points stay on the blade', () => {
    for (let hit = 0; hit < 3; hit++) {
      for (let t = 0; t <= CB.hits[hit].active.duration; t += 0.01) expect(comboElbow(hit, 'active', t, 0.5)).toBe(0);
      expect(comboElbow(hit, 'windup', CB.hits[hit].windup.duration, 0.7)).toBeCloseTo(0, 9);
    }
  });

  it('cocks during the wind-up and settles into the low-guard bend after the recovery', () => {
    const h = CB.hits[0];
    expect(comboElbow(0, 'windup', h.windup.duration / 2, 0)).toBeGreaterThan(0.3);
    expect(comboElbow(0, 'recovery', 0, 0)).toBe(0);
    expect(comboElbow(0, 'recovery', h.recovery.duration, 0)).toBeCloseTo(CB.guardElbow, 9);
  });
});

describe('sheathing (GAME_DESIGN §4.3, 1.5b)', () => {
  it('Hit 1 draws the sword inside its wind-up: fully in hand before the active phase', () => {
    const m = new PlayerMotor();
    const h = new SwordHolster();
    m.step(STEP, input(true));
    h.step(STEP, m);
    let t = STEP;
    let leftBackAt = -1;
    while (m.attackPhase === 'windup') {
      if (leftBackAt < 0 && h.w > 0) leftBackAt = t;
      m.step(STEP, input());
      h.step(STEP, m);
      t += STEP;
    }
    expect(leftBackAt).toBeGreaterThanOrEqual(SW.drawAt * CB.hits[0].windup.duration - 1e-9);
    expect(h.w).toBe(1);
    expect(h.state).toBe('drawn');
  });

  it('puts the sword away 0.4 s after the combo, then the arm drops', () => {
    const m = new PlayerMotor();
    const h = new SwordHolster();
    m.step(STEP, input(true));
    h.step(STEP, m);
    while (m.action !== 'free' || m.chainNext >= 0) {
      m.step(STEP, input());
      h.step(STEP, m);
    }
    let t = 0;
    while (h.state === 'drawn') {
      m.step(STEP, input());
      h.step(STEP, m);
      t += STEP;
    }
    expect(t).toBeCloseTo(SW.sheatheDelay, 1);
    while (h.state !== 'sheathed') {
      m.step(STEP, input());
      h.step(STEP, m);
    }
    expect(h.w).toBe(0);
    expect(h.armReady).toBe(false);
  });

  it('an attack during the put-away continues smoothly from the current blend', () => {
    const h = new SwordHolster();
    h.state = 'stowing';
    h.w = 0.5;
    h.step(STEP, { action: 'attack', attackPhase: 'windup', actionT: 0, comboHit: 0, chainNext: -1 });
    expect(h.state).toBe('drawing');
    expect(h.w).toBeGreaterThan(0.5);
  });

  it('rolls and drinks never draw the sword', () => {
    const h = new SwordHolster();
    for (const action of ['rolling', 'drink', 'stagger', 'dizzy'] as const) {
      h.step(STEP, { action, attackPhase: 'windup', actionT: 0, comboHit: 0, chainNext: -1 });
      expect(h.w).toBe(0);
    }
  });
});
