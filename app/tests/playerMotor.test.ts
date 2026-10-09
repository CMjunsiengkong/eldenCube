import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { moveDirFromAxis, PlayerMotor, rollInvincibleAt, swingAngle, type MotorInput } from '../src/entities/Player';

const R = CONFIG.roll;

/** Input helper: world direction (normalized here), optional roll press. */
function input(dx = 0, dz = 0, wantRoll = false, obstacle: MotorInput['obstacle'] = null, wantSwing = false): MotorInput {
  const len = Math.hypot(dx, dz);
  return {
    moveX: len ? dx / len : 0,
    moveZ: len ? dz / len : 0,
    wantRoll,
    wantSwing,
    bossX: 0,
    bossZ: 0,
    obstacle,
  };
}

function steps(m: PlayerMotor, n: number, inp: MotorInput = input()): void {
  for (let i = 0; i < n; i++) m.step(STEP, inp);
}

/** Motor placed in open space (away from the wall and the boss), at rest. */
function freshMotor(): PlayerMotor {
  const m = new PlayerMotor();
  m.x = 0;
  m.z = 15;
  return m;
}

describe('movement (GAME_DESIGN §4.2)', () => {
  it('accelerates at 10 m/s² to the 6 m/s max speed', () => {
    const m = freshMotor();
    steps(m, 30, input(1, 0)); // 0.5 s
    expect(m.speed()).toBeCloseTo(5, 1);
    steps(m, 60, input(1, 0));
    expect(m.speed()).toBeCloseTo(6, 5);
  });

  it('slides to a stop at 4 m/s² without input (1.5 s from full speed)', () => {
    const m = freshMotor();
    steps(m, 120, input(1, 0));
    steps(m, 45, input()); // 0.75 s
    expect(m.speed()).toBeCloseTo(3, 1);
    steps(m, 50, input());
    expect(m.speed()).toBe(0);
  });

  it('diagonal input is normalized (never faster)', () => {
    const out = { x: 0, z: 0 };
    moveDirFromAxis(1, 1, 0, -1, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1);
    const m = freshMotor();
    steps(m, 120, input(out.x, out.z));
    expect(m.speed()).toBeCloseTo(6, 5);
  });

  it('moveDirFromAxis is camera-relative: W = camera forward, D = camera right', () => {
    const out = { x: 0, z: 0 };
    // Camera looking toward −Z (behind the player at spawn, facing the boss).
    moveDirFromAxis(0, 1, 0, -1, out);
    expect(out).toEqual({ x: 0, z: -1 });
    moveDirFromAxis(1, 0, 0, -1, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(0);
    moveDirFromAxis(0, 0, 0, -1, out);
    expect(out).toEqual({ x: 0, z: 0 });
  });

  it('turns lazily at 4 rad/s', () => {
    const m = freshMotor();
    m.yaw = 0;
    steps(m, 120, input(1, 0)); // target yaw = 90°
    const m2 = freshMotor();
    m2.yaw = 0;
    m2.step(STEP, input(1, 0));
    m2.step(STEP, input(1, 0));
    // After the speed exceeds 0.5 m/s the yaw moves at most 4/60 rad per step.
    expect(Math.abs(m2.yaw)).toBeLessThanOrEqual((2 * 4) / 60 + 1e-9);
    expect(m.yaw).toBeCloseTo(Math.PI / 2, 5);
  });

  it('arena wall holds at 29.6 m and removes the outward velocity', () => {
    const m = freshMotor();
    m.z = 29;
    steps(m, 120, input(0, 1));
    expect(Math.hypot(m.x, m.z)).toBeCloseTo(29.6, 6);
    expect(m.vz).toBeLessThanOrEqual(1e-9);
  });

  it('boss body contact pushes out along the shortest direction at 4 m/s', () => {
    const m = freshMotor();
    m.x = 0;
    m.z = 2.2; // overlapping the +Z face of the 4 m cube at the origin
    const box = { center: { x: 0, y: 2, z: 0 }, halfSize: 2, yaw: 0 };
    m.step(STEP, input(0, 0, false, box));
    expect(m.z).toBeGreaterThanOrEqual(2.4 - 1e-9);
    expect(m.vz).toBeCloseTo(4, 5);
    // No pushback while the boss is attacking (obstacle null).
    const m2 = freshMotor();
    m2.z = 2.2;
    m2.step(STEP, input());
    expect(m2.z).toBeCloseTo(2.2, 6);
  });
});

describe('roll timing (ARCHITECTURE §8, GAME_DESIGN §4.3a)', () => {
  it('rollInvincibleAt is exactly [0.05, 0.40)', () => {
    expect(rollInvincibleAt(0.049)).toBe(false);
    expect(rollInvincibleAt(0.05)).toBe(true);
    expect(rollInvincibleAt(0.399)).toBe(true);
    expect(rollInvincibleAt(0.4)).toBe(false);
  });

  it('i-frames start 0.05 s and end 0.40 s after the roll starts (at the fixed step)', () => {
    const m = freshMotor();
    const inv: boolean[] = [];
    m.step(STEP, input(0, 1, true)); // step 1: roll starts, t = 1/60
    inv.push(m.isInvincible());
    for (let i = 0; i < 40; i++) {
      m.step(STEP, input());
      inv.push(m.isInvincible());
    }
    // inv[k] is the state at t = (k + 1)/60 s.
    const first = inv.indexOf(true);
    const last = inv.lastIndexOf(true);
    expect((first + 1) * STEP).toBeCloseTo(0.05, 6); // 3 steps
    expect((last + 1) * STEP).toBeCloseTo(0.4 - STEP, 6); // last invincible step before 0.40
    expect(inv.filter(Boolean).length).toBe(21); // 0.35 s = 21 steps
  });

  it('covers 4.0 m over 0.55 s in the locked direction, even if the input changes', () => {
    const m = freshMotor();
    const startZ = m.z;
    m.step(STEP, input(0, 1, true));
    while (m.action === 'rolling') m.step(STEP, input(1, 0)); // try to steer sideways
    expect(m.z - startZ).toBeCloseTo(4.0, 6);
    expect(m.x).toBeCloseTo(0, 9);
    expect(m.rollDirX).toBe(0);
    expect(m.rollDirZ).toBe(1);
  });

  it('without input, rolls in the facing direction', () => {
    const m = freshMotor();
    m.yaw = Math.PI / 2; // facing +X
    m.step(STEP, input(0, 0, true));
    expect(m.rollDirX).toBeCloseTo(1);
    expect(m.rollDirZ).toBeCloseTo(0, 9);
  });

  it('dizzy recovery 0.25 s starts at 2 m/s; the full cycle is 0.95 s', () => {
    const m = freshMotor();
    m.step(STEP, input(0, 1, true));
    let n = 1;
    while (m.action === 'rolling') {
      m.step(STEP, input());
      n++;
    }
    expect(n * STEP).toBeCloseTo(0.55, 6);
    expect(m.action).toBe('dizzy');
    expect(m.events).toContain('rollEnd');
    expect(m.speed()).toBeCloseTo(2, 6);
    while (m.action === 'dizzy') {
      m.step(STEP, input());
      n++;
    }
    expect(n * STEP).toBeCloseTo(0.8, 6);
    while (!m.canStartRoll()) {
      m.step(STEP, input());
      n++;
    }
    expect(n * STEP).toBeCloseTo(0.95, 6);
  });

  it('no roll during a roll, the recovery or the cooldown (no buffering)', () => {
    const m = freshMotor();
    m.step(STEP, input(0, 1, true));
    expect(m.events).toContain('rollStart');
    let starts = 0;
    while (!m.canStartRoll()) {
      m.step(STEP, input(1, 0, true)); // spam Space
      if (m.events.includes('rollStart')) starts++;
    }
    expect(starts).toBe(0);
    // A press after the cooldown starts a new roll.
    m.step(STEP, input(1, 0, true));
    expect(m.events).toContain('rollStart');
    expect(m.rollDirX).toBeCloseTo(1);
  });

  it('no swing during a roll or recovery; a swing IS allowed during the roll cooldown (decision D1)', () => {
    const m = freshMotor();
    m.step(STEP, input(0, 1, true));
    while (m.action === 'rolling') {
      expect(m.canStartSwing()).toBe(false);
      m.step(STEP, input());
    }
    while (m.action === 'dizzy') {
      expect(m.canStartSwing()).toBe(false);
      m.step(STEP, input());
    }
    expect(m.rollCooldown).toBeGreaterThan(0);
    expect(m.canStartRoll()).toBe(false);
    expect(m.canStartSwing()).toBe(true);
  });

  it('the arena wall still holds during a roll', () => {
    const m = freshMotor();
    m.z = 28;
    m.step(STEP, input(0, 1, true));
    while (m.action === 'rolling') m.step(STEP, input());
    expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(29.6 + 1e-9);
  });

  it('god mode makes the player invincible outside rolls', () => {
    const m = freshMotor();
    expect(m.isInvincible()).toBe(false);
    m.godMode = true;
    expect(m.isInvincible()).toBe(true);
  });

  it('roll constants match the design (0.35 s i-frames, 0.95 s cycle)', () => {
    expect(R.iFrameEnd - R.iFrameStart).toBeCloseTo(0.35);
  });
});

const swing = (dx = 0, dz = 0) => input(dx, dz, false, null, true);
const DEG = Math.PI / 180;

describe('swing timing (ARCHITECTURE §8, GAME_DESIGN §4.3)', () => {
  it('phases: wind-up 0.20 s, active 0.15 s, recovery 0.40 s', () => {
    const m = freshMotor();
    m.step(STEP, swing());
    expect(m.events).toContain('swingStart');
    let n = 1;
    let activeAt = -1;
    let recoveryAt = -1;
    while (m.action !== 'free') {
      const before = m.action;
      m.step(STEP, input());
      n++;
      if (m.events.includes('swingActive')) activeAt = n;
      if (before === 'active' && m.action === 'recovery') recoveryAt = n;
    }
    expect(activeAt * STEP).toBeCloseTo(0.2, 6);
    expect((recoveryAt - activeAt) * STEP).toBeCloseTo(0.15, 6);
    expect((n - recoveryAt) * STEP).toBeCloseTo(0.4, 6);
    expect(n * STEP).toBeCloseTo(0.75, 6);
  });

  it('damage window: isSwingActive only during the active phase', () => {
    const m = freshMotor();
    m.step(STEP, swing());
    let activeSteps = 0;
    while (m.action !== 'free') {
      if (m.isSwingActive()) {
        expect(m.action).toBe('active');
        activeSteps++;
      } else {
        expect(m.action).not.toBe('active');
      }
      m.step(STEP, input());
    }
    expect(activeSteps * STEP).toBeCloseTo(0.15, 6);
  });

  it('at most one hit per swing; a hit swing does not report a miss', () => {
    const m = freshMotor();
    m.step(STEP, swing());
    while (m.action !== 'active') m.step(STEP, input());
    expect(m.isSwingActive()).toBe(true);
    m.markSwingHit();
    expect(m.isSwingActive()).toBe(false);
    let missed = false;
    const action = (): string => m.action;
    while (action() !== 'free') {
      m.step(STEP, input());
      if (m.events.includes('swingMiss')) missed = true;
      expect(m.isSwingActive()).toBe(false);
    }
    expect(missed).toBe(false);
    // The next swing can hit again.
    m.step(STEP, swing());
    while (m.action !== 'active') m.step(STEP, input());
    expect(m.isSwingActive()).toBe(true);
  });

  it('a missed active phase reports swingMiss exactly once', () => {
    const m = freshMotor();
    m.step(STEP, swing());
    let misses = 0;
    while (m.action !== 'free') {
      m.step(STEP, input());
      misses += m.events.filter((e) => e === 'swingMiss').length;
    }
    expect(misses).toBe(1);
  });

  it('lunge: about 1.5 m forward during the active phase at 10 m/s', () => {
    const m = freshMotor();
    m.yaw = Math.PI; // facing −Z (toward the boss)
    m.step(STEP, swing());
    while (m.action !== 'active') m.step(STEP, input());
    const z0 = m.z;
    while (m.action === 'active') {
      m.step(STEP, input());
      if (m.action === 'active') expect(m.speed()).toBeCloseTo(10, 6);
    }
    expect(z0 - m.z).toBeCloseTo(1.5, 6);
    // After the phase the lunge velocity is gone (restored to the pre-lunge velocity, here 0).
    expect(m.speed()).toBeCloseTo(0, 6);
  });

  it('movement and roll input are ignored during the swing; swing presses are not buffered', () => {
    const m = freshMotor();
    m.step(STEP, swing());
    let rolls = 0;
    let swings = 0;
    while (m.action !== 'free') {
      m.step(STEP, { ...input(1, 0, true, null, true) });
      if (m.events.includes('rollStart')) rolls++;
      if (m.events.includes('swingStart')) swings++;
    }
    expect(rolls).toBe(0);
    expect(swings).toBe(0);
    expect(m.speed()).toBeCloseTo(0, 6); // movement input never accelerated the player
  });

  it('no swing during a roll or the dizzy recovery', () => {
    const m = freshMotor();
    m.step(STEP, input(0, 1, true));
    while (m.action === 'rolling' || m.action === 'dizzy') {
      m.step(STEP, swing());
      expect(m.events).not.toContain('swingStart');
    }
  });

  it('a swing is allowed during the roll cooldown (decision D1)', () => {
    const m = freshMotor();
    m.step(STEP, input(0, 1, true));
    while (m.action !== 'free') m.step(STEP, input());
    expect(m.rollCooldown).toBeGreaterThan(0);
    m.step(STEP, swing());
    expect(m.events).toContain('swingStart');
  });

  it('swingAngle follows the documented curve', () => {
    expect(swingAngle('free', 0)).toBeCloseTo(20 * DEG);
    expect(swingAngle('windup', 0)).toBeCloseTo(20 * DEG);
    expect(swingAngle('windup', 0.2)).toBeCloseTo(200 * DEG);
    expect(swingAngle('windup', 0.1)).toBeGreaterThan(110 * DEG); // ease-out: past halfway at half time
    expect(swingAngle('active', 0)).toBeCloseTo(200 * DEG);
    expect(swingAngle('active', 0.075)).toBeGreaterThan(135 * DEG); // ease-in: slow start
    expect(swingAngle('active', 0.15)).toBeCloseTo(70 * DEG);
    expect(swingAngle('recovery', 0.4)).toBeCloseTo(20 * DEG);
  });
});
