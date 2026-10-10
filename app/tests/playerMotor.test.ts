import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { comboArmPose, moveDirFromAxis, PlayerMotor, rollInvincibleAt, type ArmPose, type MotorInput } from '../src/entities/Player';


/** Input helper: world direction (normalized here), optional roll press. */
function input(dx = 0, dz = 0, wantRoll = false, obstacle: MotorInput['obstacle'] = null, wantAttack = false, wantFlask = false): MotorInput {
  const len = Math.hypot(dx, dz);
  return {
    moveX: len ? dx / len : 0,
    moveZ: len ? dz / len : 0,
    wantRoll,
    wantAttack,
    wantFlask,
    allowAttack: true,
    bossX: 0,
    bossZ: 0,
    obstacle,
  };
}

function steps(m: PlayerMotor, n: number, inp: MotorInput = input()): void {
  for (let i = 0; i < n; i++) m.step(STEP, inp);
}

/** Motor placed in open space (away from the wall and the boss), at rest. */
function freshMotor(bufferWindow?: number): PlayerMotor {
  const m = new PlayerMotor(bufferWindow);
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
    // No pushback while the boss body is not solid (obstacle null).
    const m2 = freshMotor();
    m2.z = 2.2;
    m2.step(STEP, input());
    expect(m2.z).toBeCloseTo(2.2, 6);
  });
});

const ROLL = () => input(0, 1, true);
const ATK = () => input(0, 0, false, null, true);
const FLASK = () => input(0, 0, false, null, false, true);
const CB = CONFIG.combo;
const ST = CONFIG.stamina;
const FL = CONFIG.flask;
const HU = CONFIG.hurt;
const BW = CONFIG.buffer.window;
const DEG = Math.PI / 180;

/** Steps with no input until `pred` holds; returns the number of steps. */
function until(m: PlayerMotor, pred: () => boolean, inp: () => MotorInput = () => input(), max = 600): number {
  let n = 0;
  while (!pred() && n < max) {
    m.step(STEP, inp());
    n++;
  }
  return n;
}

/** Fixed-step quantization: a duration that is not a whole number of steps rounds up by < 1 step. */
const near = (actual: number, expected: number) => {
  expect(actual).toBeGreaterThanOrEqual(expected - 1e-9);
  expect(actual).toBeLessThan(expected + STEP + 1e-9);
};

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
    m.step(STEP, ROLL());
    inv.push(m.isInvincible());
    for (let i = 0; i < 40; i++) {
      m.step(STEP, input());
      inv.push(m.isInvincible());
    }
    const first = inv.indexOf(true);
    const last = inv.lastIndexOf(true);
    expect((first + 1) * STEP).toBeCloseTo(0.05, 6);
    expect((last + 1) * STEP).toBeCloseTo(0.4 - STEP, 6);
    expect(inv.filter(Boolean).length).toBe(21); // 0.35 s
  });

  it('covers 4.0 m over 0.55 s in the locked direction, even if the input changes', () => {
    const m = freshMotor();
    const startZ = m.z;
    m.step(STEP, ROLL());
    while (m.action === 'rolling') m.step(STEP, input(1, 0));
    expect(m.z - startZ).toBeCloseTo(4.0, 6);
    expect(m.x).toBeCloseTo(0, 9);
  });

  it('without input, rolls in the facing direction', () => {
    const m = freshMotor();
    m.yaw = Math.PI / 2;
    m.step(STEP, input(0, 0, true));
    expect(m.rollDirX).toBeCloseTo(1);
    expect(m.rollDirZ).toBeCloseTo(0, 9);
  });

  it('dizzy recovery 0.12 s at 2 m/s; free after 0.67 s; no roll cooldown', () => {
    const m = freshMotor();
    m.step(STEP, ROLL());
    let n = 1 + until(m, () => m.action !== 'rolling');
    near(n * STEP, 0.55);
    expect(m.events).toContain('rollEnd');
    expect(m.speed()).toBeCloseTo(2, 6);
    n += until(m, () => m.action !== 'dizzy');
    near(n * STEP, 0.67);
    m.step(STEP, input(1, 0, true)); // immediately rolls again
    expect(m.events).toContain('rollStart');
  });

  it('the arena wall still holds during a roll', () => {
    const m = freshMotor();
    m.z = 28;
    m.step(STEP, ROLL());
    until(m, () => m.action === 'free');
    expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(29.6 + 1e-9);
  });

  it('god mode makes the player invincible outside rolls', () => {
    const m = freshMotor();
    expect(m.isInvincible()).toBe(false);
    m.godMode = true;
    expect(m.isInvincible()).toBe(true);
  });
});

describe('combo (GAME_DESIGN §4.3)', () => {
  it('Hit 1 phases: wind-up 0.18, active 0.12, chain point at 0.15 into the 0.35 s recovery', () => {
    const m = freshMotor();
    m.step(STEP, ATK());
    expect(m.events).toContain('attackStart');
    expect(m.comboHit).toBe(0);
    const w = 1 + until(m, () => m.attackPhase === 'active');
    expect(m.events).toContain('attackActive');
    near(w * STEP, 0.18);
    const a = until(m, () => m.attackPhase === 'recovery');
    near(a * STEP, 0.12);
    const c = until(m, () => m.chainNext >= 0);
    near(c * STEP, 0.15);
    expect(m.chainNext).toBe(1);
    const r = c + until(m, () => m.action === 'free');
    near(r * STEP, 0.35);
  });

  it('mashing chains 1 → 2 → 3 at the chain points: full combo 1.79 s, damage 1, 1, 2', () => {
    const m = freshMotor();
    const starts: number[] = [];
    const dmg: number[] = [];
    let n = 0;
    while (n < 300) {
      m.step(STEP, ATK()); // a press every step
      n++;
      if (m.events.includes('attackStart')) starts.push(n);
      if (m.events.includes('attackActive')) dmg.push(m.attackDamage());
      if (starts.length === 3 && m.action === 'free') break;
    }
    expect(starts.length).toBe(3);
    // Each phase rounds up to whole steps: allow one step per phase boundary.
    expect((starts[1] - starts[0]) * STEP).toBeGreaterThanOrEqual(0.45 - 1e-9);
    expect((starts[1] - starts[0]) * STEP).toBeLessThan(0.45 + 3 * STEP);
    expect((starts[2] - starts[1]) * STEP).toBeGreaterThanOrEqual(0.39 - 1e-9);
    expect((starts[2] - starts[1]) * STEP).toBeLessThan(0.39 + 3 * STEP);
    expect((n - starts[0] + 1) * STEP).toBeGreaterThanOrEqual(1.79 - 1e-9);
    expect((n - starts[0] + 1) * STEP).toBeLessThan(1.79 + 8 * STEP);
    expect(dmg).toEqual([1, 1, 2]);
    expect(m.chainNext).toBe(-1); // reset after Hit 3
  });

  it('a press late in the 0.5 s window still chains; after the window the combo resets to Hit 1', () => {
    const m = freshMotor();
    m.step(STEP, ATK());
    until(m, () => m.chainNext >= 0);
    until(m, () => m.chainLeft < 0.05); // walks past the recovery end; window still open
    expect(m.action).toBe('free');
    m.step(STEP, ATK());
    expect(m.comboHit).toBe(1);

    const m2 = freshMotor();
    m2.step(STEP, ATK());
    until(m2, () => m2.chainNext >= 0);
    until(m2, () => m2.chainNext < 0, () => input(1, 0));
    m2.step(STEP, ATK());
    expect(m2.comboHit).toBe(0);
  });

  it('lunges: 0.8, 0.6 and 1.2 m during the active phases', () => {
    for (const hit of [0, 1, 2]) {
      const m = freshMotor();
      m.yaw = Math.PI;
      m.comboHit = hit;
      // Start the wanted hit by opening a fake chain.
      if (hit > 0) {
        m.chainNext = hit;
        m.chainLeft = 0.5;
        (m as unknown as { chainOpened: boolean }).chainOpened = true;
      }
      m.step(STEP, ATK());
      expect(m.comboHit).toBe(hit);
      until(m, () => m.attackPhase === 'active');
      const z0 = m.z;
      until(m, () => m.attackPhase !== 'active');
      expect(z0 - m.z).toBeCloseTo(CB.hits[hit].active.lunge, 6);
      expect(m.speed()).toBeCloseTo(0, 6);
    }
  });

  it('damage window: isAttackActive only in active phases; one hit per combo hit; no miss after a hit', () => {
    const m = freshMotor();
    m.step(STEP, ATK());
    let misses = 0;
    let activeSteps = 0;
    while (m.action === 'attack') {
      if (m.isAttackActive()) {
        activeSteps++;
        m.markAttackHit();
        expect(m.isAttackActive()).toBe(false);
      }
      m.step(STEP, input());
      if (m.events.includes('attackMiss')) misses++;
    }
    expect(activeSteps).toBe(1);
    expect(misses).toBe(0);
    const m2 = freshMotor();
    m2.step(STEP, ATK());
    let miss2 = 0;
    while (m2.action === 'attack') {
      m2.step(STEP, input());
      if (m2.events.includes('attackMiss')) miss2++;
    }
    expect(miss2).toBe(1);
  });

  it('no cancels: roll, flask and movement never interrupt a committed hit', () => {
    const m = freshMotor();
    m.hp = 1;
    m.step(STEP, ATK());
    const z0 = m.z;
    let steps = 1;
    while (m.action === 'attack') {
      m.step(STEP, input(1, 0, true, null, false, true));
      steps++;
    }
    expect(steps * STEP).toBeGreaterThanOrEqual(0.65 - 1e-9); // the full Hit 1 length
    expect(Math.abs(m.x)).toBeLessThan(1e-9); // movement input ignored
    expect(z0 - m.z).toBeCloseTo(CB.hits[0].active.lunge, 6); // only the lunge moved the player
  });

  it('rolling or drinking resets the combo', () => {
    const m = freshMotor();
    m.step(STEP, ATK());
    until(m, () => m.action === 'free');
    expect(m.chainNext).toBe(1);
    m.step(STEP, ROLL());
    expect(m.chainNext).toBe(-1);
    until(m, () => m.action === 'free');
    m.step(STEP, ATK());
    expect(m.comboHit).toBe(0);
  });

  it('comboArmPose: kesagiri 215° → 40° at ψ 40°, rising 30° → 200°, finisher at ψ 0, recovery back to rest', () => {
    const from: ArmPose = { theta: CB.restAngle, psi: CB.restTilt };
    const out: ArmPose = { theta: 0, psi: 0 };
    expect(comboArmPose(0, 'windup', 0, from, out).theta).toBeCloseTo(200 * DEG);
    expect(comboArmPose(0, 'windup', 0.18, from, out).theta).toBeCloseTo(215 * DEG);
    expect(comboArmPose(0, 'active', 0.12, from, out).theta).toBeCloseTo(40 * DEG);
    expect(out.psi).toBeCloseTo(40 * DEG);
    expect(comboArmPose(1, 'active', 0.12, from, out).theta).toBeCloseTo(200 * DEG);
    expect(comboArmPose(2, 'active', 0, from, out).psi).toBeCloseTo(0);
    expect(comboArmPose(2, 'recovery', 0.2, from, out).theta).toBeCloseTo(40 * DEG); // still holding
    comboArmPose(2, 'recovery', 0.55, from, out);
    expect(out.theta).toBeCloseTo(CB.restAngle);
    expect(out.psi).toBeCloseTo(CB.restTilt);
  });
});

describe('input buffer (GAME_DESIGN §4.3d)', () => {
  it('an attack pressed within 0.20 s before the chain point runs exactly at the chain point', () => {
    const m = freshMotor();
    m.step(STEP, ATK());
    until(m, () => m.attackPhase === 'recovery' && m.actionT >= CB.hits[0].chainAt - BW + 0.02);
    m.step(STEP, ATK()); // buffered
    expect(m.buffered).toBe('attack');
    const n = until(m, () => m.comboHit === 1);
    expect(m.attackPhase).toBe('windup');
    expect(n).toBeLessThanOrEqual(Math.ceil(BW / STEP));
  });

  it('a press earlier than 0.20 s before the action is possible is dropped', () => {
    const m = freshMotor();
    m.step(STEP, ROLL()); // 0.67 s of roll + dizzy
    m.step(STEP, ATK());
    expect(m.buffered).toBeNull();
    until(m, () => m.action === 'free');
    m.step(STEP, input());
    expect(m.action).toBe('free');
  });

  it('a roll pressed late in the dizzy recovery or late in an attack runs at the first free step', () => {
    const m = freshMotor();
    m.step(STEP, ROLL());
    until(m, () => m.action === 'dizzy');
    m.step(STEP, ROLL());
    expect(m.buffered).toBe('roll');
    let started = false;
    for (let i = 0; i < 20 && !started; i++) {
      m.step(STEP, input());
      started = m.events.includes('rollStart');
    }
    expect(started).toBe(true);

    const a = freshMotor();
    a.step(STEP, ATK());
    until(a, () => a.attackPhase === 'recovery' && a.actionT > CB.hits[0].recovery.duration - 0.1);
    a.step(STEP, ROLL());
    expect(a.buffered).toBe('roll');
    expect(a.action).toBe('attack'); // never cancels the recovery
    until(a, () => a.action !== 'attack');
    a.step(STEP, input()); // the first free step
    expect(a.action).toBe('rolling');
  });

  it('the newest press replaces the stored one', () => {
    const m = freshMotor();
    m.step(STEP, ROLL());
    until(m, () => m.action === 'dizzy');
    m.step(STEP, ROLL());
    m.step(STEP, ATK());
    expect(m.buffered).toBe('attack');
    until(m, () => m.action !== 'dizzy');
    m.step(STEP, input());
    expect(m.action).toBe('attack');
  });

  it('bufferWindow = 0 (strict mode) drops every press made while busy', () => {
    const m = freshMotor(0);
    m.step(STEP, ROLL());
    until(m, () => m.action === 'dizzy');
    m.step(STEP, ROLL());
    expect(m.buffered).toBeNull();
    until(m, () => m.action === 'free');
    m.step(STEP, input());
    expect(m.action).toBe('free');
  });
});

describe('stamina (GAME_DESIGN §4.3b)', () => {
  it('from full: exactly 3 rolls, then refused with an event', () => {
    const m = freshMotor();
    let rolls = 0;
    let refused = 0;
    for (let i = 0; i < 4 * 45; i++) {
      m.step(STEP, ROLL());
      if (m.events.includes('rollStart')) rolls++;
      if (m.events.includes('staminaRefused')) refused++;
      if (refused) break;
    }
    expect(rolls).toBe(3);
    expect(refused).toBe(1);
    expect(m.stamina).toBeLessThan(ST.rollCost);
  });

  it('from full: 3 hits + 1 roll, then empty', () => {
    const m = freshMotor();
    let hits = 0;
    while (hits < 3) {
      m.step(STEP, ATK());
      if (m.events.includes('attackStart')) hits++;
    }
    until(m, () => m.action === 'free');
    expect(m.stamina).toBeCloseTo(ST.rollCost, 6); // no regen during the combo
    m.step(STEP, ROLL());
    expect(m.events).toContain('rollStart');
    expect(m.stamina).toBeCloseTo(0, 6);
  });

  it('one hit + two rolls leaves 10: not enough for anything', () => {
    const m = freshMotor();
    m.step(STEP, ATK());
    until(m, () => m.action === 'free');
    m.step(STEP, ROLL());
    until(m, () => m.action === 'free');
    m.step(STEP, ROLL());
    until(m, () => m.action === 'free');
    expect(m.stamina).toBeCloseTo(10, 6);
    m.step(STEP, ATK());
    expect(m.events).toContain('staminaRefused');
  });

  it('regeneration: paused during actions, resumes 0.4 s after free, at 45/s', () => {
    const m = freshMotor();
    m.step(STEP, ROLL());
    until(m, () => m.action === 'free');
    const s0 = m.stamina;
    expect(s0).toBeCloseTo(60, 6);
    until(m, () => m.stamina > s0 + 1e-9);
    expect(m.regenDelay).toBeCloseTo(0, 9);
    m.step(STEP, input());
    const s1 = m.stamina;
    m.step(STEP, input());
    expect((m.stamina - s1) / STEP).toBeCloseTo(ST.regenRate, 6);
    const empty = freshMotor();
    empty.stamina = 0;
    empty.regenDelay = ST.regenDelay; // as right after an action
    const n = until(empty, () => empty.stamina >= ST.max - 1e-9);
    expect(n * STEP).toBeCloseTo(ST.regenDelay + ST.max / ST.regenRate, 1);
  });

  it('a refused attack resets the combo', () => {
    const m = freshMotor();
    m.step(STEP, ATK());
    until(m, () => m.chainNext >= 0);
    m.stamina = 5;
    until(m, () => m.action === 'free');
    m.step(STEP, ATK());
    expect(m.events).toContain('staminaRefused');
    expect(m.chainNext).toBe(-1);
  });
});

describe('flask (GAME_DESIGN §4.3c)', () => {
  it('heals 1 HP at 0.60 s of a 1.10 s drink; uses a charge; no stamina restore', () => {
    const m = freshMotor();
    m.hp = 1;
    m.stamina = 10;
    m.step(STEP, FLASK());
    expect(m.events).toContain('drinkStart');
    expect(m.flasks).toBe(FL.charges - 1);
    let n = 1 + until(m, () => m.hp === 2);
    expect(m.events).toContain('flaskHeal');
    near(n * STEP, FL.healAt);
    n += until(m, () => m.action === 'free');
    near(n * STEP, FL.duration);
    expect(m.stamina).toBeCloseTo(10, 6); // regen paused during the drink
  });

  it('blocked at full HP and with 0 charges; 3 charges per fight', () => {
    const m = freshMotor();
    m.step(STEP, FLASK());
    expect(m.action).toBe('free');
    let drinks = 0;
    for (let i = 0; i < 4; i++) {
      m.hp = 1;
      m.step(STEP, FLASK());
      if (m.events.includes('drinkStart')) drinks++;
      until(m, () => m.action === 'free');
    }
    expect(drinks).toBe(3);
    expect(m.flasks).toBe(0);
    m.reset();
    expect(m.flasks).toBe(3);
  });

  it('walking while drinking is limited to 1.8 m/s', () => {
    const m = freshMotor();
    m.hp = 1;
    m.step(STEP, FLASK());
    for (let i = 0; i < 50; i++) m.step(STEP, input(1, 0));
    expect(m.speed()).toBeCloseTo(FL.maxSpeed, 6);
  });

  it('a hit before 0.60 s loses the charge without healing', () => {
    const m = freshMotor();
    m.hp = 2;
    m.takeHit(0, 0); // now 1 HP, invincible for 1.0 s
    until(m, () => m.action === 'free' && m.hurtInvuln === 0);
    m.step(STEP, FLASK());
    expect(m.flasks).toBe(2);
    until(m, () => m.actionT > 0.3);
    m.hp = 2; // pretend: still 2 so the next hit is not lethal
    expect(m.takeHit(0, 0)).toBe('hurt');
    until(m, () => m.action === 'free');
    expect(m.hp).toBe(1);
    expect(m.flasks).toBe(2);
  });
});

describe('player damage (GAME_DESIGN §4.6)', () => {
  it('first hit: hurt, 0.5 s stagger with 3.0 m knockback, 1.0 s invincibility; second hit: dead', () => {
    const m = freshMotor(); // at (0, 15)
    expect(m.takeHit(0, 0)).toBe('hurt');
    expect(m.events).toContain('hurt');
    expect(m.hp).toBe(1);
    expect(m.action).toBe('stagger');
    expect(m.takeHit(0, 0)).toBe('ignored'); // invincible
    const n = until(m, () => m.action === 'free');
    near(n * STEP, HU.stagger);
    expect(m.z - 15).toBeCloseTo(HU.knockback, 6);
    expect(m.isInvincible()).toBe(true);
    const n2 = until(m, () => !m.isInvincible());
    expect((n + n2) * STEP).toBeCloseTo(HU.invulnerability, 6);
    expect(m.takeHit(0, 0)).toBe('dead');
    expect(m.hp).toBe(0);
  });

  it('a hit cancels the current action and resets the combo and the buffer', () => {
    const m = freshMotor();
    m.step(STEP, ATK());
    until(m, () => m.chainNext >= 0);
    m.buffered = 'roll';
    m.takeHit(0, 0);
    expect(m.action).toBe('stagger');
    expect(m.chainNext).toBe(-1);
    expect(m.buffered).toBeNull();
  });

  it('roll i-frames ignore hits', () => {
    const m = freshMotor();
    m.step(STEP, ROLL());
    until(m, () => m.isRollInvincible());
    expect(m.takeHit(0, 0)).toBe('ignored');
    expect(m.hp).toBe(2);
  });

  it('reset restores 2 HP, full stamina and 3 flasks', () => {
    const m = freshMotor();
    m.takeHit(0, 0);
    m.stamina = 0;
    m.flasks = 0;
    m.reset();
    expect([m.hp, m.stamina, m.flasks, m.hurtInvuln]).toEqual([2, ST.max, 3, 0]);
  });
});

describe('allowAttack = false (BOSS_DEFEATED)', () => {
  it('attack and flask presses do nothing; rolls still work', () => {
    const m = freshMotor();
    m.hp = 1;
    const i = { ...input(0, 0, false, null, true, true), allowAttack: false };
    m.step(STEP, i);
    expect(m.action).toBe('free');
    m.step(STEP, { ...ROLL(), allowAttack: false });
    expect(m.action).toBe('rolling');
  });
});
