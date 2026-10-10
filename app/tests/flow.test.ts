import { describe, expect, it } from 'vitest';
import { FlowMachine, type FlowCommand } from '../src/game/Game';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';

const T = CONFIG.transitions;
const D = CONFIG.fx.death;
const FRAME = 1 / 60;

/** Runs real-time frames (and optional sim steps) until `pred`; returns the elapsed seconds. */
function frames(f: FlowMachine, pred: () => boolean, opts: { sim?: boolean; anyStart?: () => boolean; max?: number } = {}): number {
  let t = 0;
  const max = opts.max ?? 30;
  while (!pred() && t < max) {
    if (opts.sim) f.update(STEP);
    f.realUpdate(FRAME, opts.anyStart?.() ?? false);
    t += FRAME;
  }
  return t;
}

function take(f: FlowMachine): FlowCommand[] {
  const c = [...f.commands];
  f.commands.length = 0;
  return c;
}

/** A machine already in FIGHT. */
function fighting(): FlowMachine {
  const f = new FlowMachine();
  frames(f, () => f.titleUnlocked);
  f.realUpdate(FRAME, true);
  take(f);
  return f;
}

describe('FlowMachine (GAME_DESIGN §1, §9; ARCHITECTURE §8 state flow)', () => {
  it('TITLE: input is ignored during the 0.5 s lock; then any key starts the fight and counts an attempt', () => {
    const f = new FlowMachine();
    f.realUpdate(0.25, true);
    expect(f.state).toBe('TITLE');
    const t = 0.25 + frames(f, () => f.titleUnlocked);
    expect(t).toBeCloseTo(T.titleInputLock, 1);
    expect(take(f)).toContain('titleReady');
    f.realUpdate(FRAME, true);
    expect(f.state).toBe('FIGHT');
    expect(f.attempts).toBe(1);
    expect(take(f)).toEqual(['startFight']);
  });

  it('death: break @0.10, YOU DIED @0.60, TO_TITLE after 2.0 s of simulation time (from the hit)', () => {
    const f = fighting();
    f.playerDied(D.hitStop);
    expect(f.state).toBe('DYING');
    const at: Record<string, number> = {};
    let t = D.hitStop;
    while (f.state === 'DYING' && t < 5) {
      f.update(STEP);
      t += STEP;
      for (const c of take(f)) at[c] = t;
    }
    expect(at.breakPlayer).toBeCloseTo(D.breakAt + STEP, 6); // first step after the hit-stop
    expect(at.showYouDied).toBeCloseTo(D.youDiedAt, 1);
    expect(at.beginToTitle).toBeCloseTo(D.duration, 1);
    expect(f.state).toBe('TO_TITLE');
  });

  it('real-time frames alone (hit-stop, pause) never advance the death timeline', () => {
    const f = fighting();
    f.playerDied(D.hitStop);
    for (let i = 0; i < 600; i++) f.realUpdate(FRAME, true);
    expect(f.state).toBe('DYING');
    expect(take(f)).toEqual([]);
  });

  it('victory: VICTORY_SCREEN 1.5 s (sim) after the hit; input locked for 1.0 s; then input → TO_TITLE', () => {
    const f = fighting();
    f.bossDefeated(CONFIG.boss.defeat.hitStop);
    let t = CONFIG.boss.defeat.hitStop;
    while (f.state === 'BOSS_DEFEATED') {
      f.update(STEP);
      t += STEP;
    }
    expect(t).toBeCloseTo(CONFIG.boss.defeat.victoryDelay, 1);
    expect(take(f)).toEqual(['showVictory']);
    for (let t2 = 0; t2 < T.victoryInputLock - 0.05; t2 += FRAME) f.realUpdate(FRAME, true);
    expect(f.state).toBe('VICTORY_SCREEN'); // input during the lock does nothing
    frames(f, () => f.continueUnlocked);
    expect(take(f)).toContain('continueReady');
    f.realUpdate(FRAME, true);
    expect(f.state).toBe('TO_TITLE');
  });

  it('victory: with no input, TO_TITLE automatically after 8 s', () => {
    const f = fighting();
    f.bossDefeated(0.2);
    while (f.state === 'BOSS_DEFEATED') f.update(STEP);
    const t = frames(f, () => f.state === 'TO_TITLE');
    expect(t).toBeCloseTo(T.victoryIdleReturn, 1);
  });

  it('TO_TITLE: fade 0 → 1 in 0.6 s, reset exactly once at full black, fade 1 → 0 in 0.8 s, then TITLE with a new lock', () => {
    const f = fighting();
    f.playerDied(0.1);
    frames(f, () => f.state === 'TO_TITLE', { sim: true });
    take(f);
    let resets = 0;
    let resetAt = -1;
    let t = 0;
    let maxFade = 0;
    let duckMin = 1;
    while (f.state === 'TO_TITLE' && t < 5) {
      f.realUpdate(FRAME, true);
      t += FRAME;
      maxFade = Math.max(maxFade, f.fade);
      duckMin = Math.min(duckMin, f.duck);
      for (const c of take(f)) {
        if (c === 'reset') {
          resets++;
          resetAt = t;
          expect(f.fade).toBe(1);
        }
      }
    }
    expect(resets).toBe(1);
    expect(resetAt).toBeCloseTo(T.fadeOut, 1);
    expect(t).toBeCloseTo(T.fadeOut + T.fadeIn, 1);
    expect(maxFade).toBe(1);
    expect(duckMin).toBeCloseTo(T.audioDuck, 6);
    expect(f.state).toBe('TITLE');
    expect(f.fade).toBe(0);
    expect(f.duck).toBe(1);
    expect(f.titleUnlocked).toBe(false);
    // The 0.5 s title lock applies again after the fade-in.
    expect(frames(f, () => f.titleUnlocked)).toBeCloseTo(T.titleInputLock, 1);
  });

  it('the attempt counter increases with every fight', () => {
    const f = fighting();
    for (let i = 0; i < 2; i++) {
      f.playerDied(0.1);
      frames(f, () => f.state === 'TITLE', { sim: true });
      frames(f, () => f.titleUnlocked);
      f.realUpdate(FRAME, true);
    }
    expect(f.attempts).toBe(3);
  });

  it('pause is valid only in FIGHT', () => {
    const t = new FlowMachine();
    expect(t.pause()).toBe(false);
    const f = fighting();
    expect(f.pause()).toBe(true);
    expect(f.paused).toBe(true);
    f.resume();
    expect(f.paused).toBe(false);
    f.playerDied(0.1);
    expect(f.pause()).toBe(false);
  });
});
