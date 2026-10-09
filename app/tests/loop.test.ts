import { describe, expect, it } from 'vitest';
import { Loop, MAX_STEPS_PER_FRAME, STEP, type LoopTarget } from '../src/loop';

class Recorder implements LoopTarget {
  updates = 0;
  simTime = 0;
  realTime = 0;
  renders = 0;
  update(dt: number): void {
    this.updates++;
    this.simTime += dt;
  }
  realUpdate(frameDt: number): void {
    this.realTime += frameDt;
  }
  render(): void {
    this.renders++;
  }
}

/** Creates a loop driven manually by `tick(ms)`. */
function setup(): { loop: Loop; rec: Recorder; at: (ms: number) => number } {
  const rec = new Recorder();
  const loop = new Loop(rec, () => undefined);
  loop.tick(0); // first frame establishes the clock
  return { loop, rec, at: (ms) => loop.tick(ms) };
}

describe('Loop (ARCHITECTURE §4.1)', () => {
  it('runs fixed 1/60 s steps', () => {
    const { rec, at } = setup();
    for (let i = 1; i <= 60; i++) at((i * 1000) / 60);
    expect(rec.updates).toBeGreaterThanOrEqual(59);
    expect(rec.updates).toBeLessThanOrEqual(60);
    expect(rec.simTime).toBeCloseTo(rec.updates * STEP, 10);
  });

  it('clamps long frames to 0.1 s and caps steps at 5 per frame', () => {
    const { rec, at } = setup();
    const steps = at(5000); // 5 s tab switch
    expect(steps).toBe(MAX_STEPS_PER_FRAME);
    expect(rec.realTime).toBeCloseTo(0.1);
    // the accumulator was dropped: a normal next frame runs ~1 step, not a backlog
    expect(at(5000 + 1000 / 60)).toBeLessThanOrEqual(1);
  });

  it('hit-stop freezes the simulation but keeps rendering and real-time updates', () => {
    const { loop, rec, at } = setup();
    loop.hitStop(0.08);
    let t = 0;
    let steps = 0;
    for (let i = 0; i < 4; i++) {
      t += 16;
      steps += at(t); // 64 ms < 80 ms
    }
    expect(steps).toBe(0);
    expect(rec.renders).toBe(5);
    expect(rec.realTime).toBeCloseTo(0.064);
    t += 40;
    at(t); // hit-stop ends
    t += 1000 / 60;
    expect(at(t)).toBeGreaterThanOrEqual(1);
  });

  it('hitStop keeps the max of the current and new value', () => {
    const { loop, at } = setup();
    loop.hitStop(0.2);
    loop.hitStop(0.05);
    expect(at(100)).toBe(0);
    expect(loop.isHitStopped).toBe(true);
    at(250);
    expect(loop.isHitStopped).toBe(false);
  });

  it('time scale slows the simulation for its duration (real time), then restores 1', () => {
    const { loop, rec, at } = setup();
    loop.setTimeScale(0.5, 1.0);
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += 1000 / 60;
      at(t);
    }
    expect(rec.simTime).toBeCloseTo(0.5, 1); // 1 s real → ~0.5 s simulated
    t += 1000 / 60;
    at(t); // first frame after the 1.0 s (avoids a float boundary at exactly 60 frames)
    expect(loop.currentTimeScale).toBe(1);
  });

  it('paused: no simulation steps, rendering continues', () => {
    const { loop, rec, at } = setup();
    loop.paused = true;
    expect(at(100)).toBe(0);
    expect(rec.renders).toBe(2);
    loop.paused = false;
    expect(at(100 + 1000 / 60)).toBeGreaterThanOrEqual(1);
  });
});
