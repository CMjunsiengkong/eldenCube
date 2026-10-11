import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { Burns, burnFade } from '../src/fx/burns';
import { newSpec, nextSlot, Particles } from '../src/fx/particles';

const BU = CONFIG.vfx.burns;

describe('burn marks (GAME_DESIGN §6.5 C, 1.5b)', () => {
  it('stay fully visible until 1.8 s, fade smoothly, and are gone at 3.0 s', () => {
    expect(burnFade(0)).toBe(1);
    expect(burnFade(BU.fadeStart - 1e-6)).toBe(1);
    expect(burnFade(BU.life)).toBe(0);
    expect(burnFade(-0.1)).toBe(0);
    let prev = 1;
    for (let t = BU.fadeStart; t < BU.life; t += 0.01) {
      const f = burnFade(t);
      expect(f).toBeLessThanOrEqual(prev + 1e-12); // monotone
      expect(prev - f).toBeLessThan(0.03); // no pop: small change per 10 ms
      prev = f;
    }
  });

  it('a ring buffer: the oldest mark is reused when full; reset clears all', () => {
    const b = new Burns(4);
    for (let i = 0; i < 6; i++) b.spawn(i, 0, 0.1 * i);
    b.step(STEP);
    expect(b.activeCount()).toBe(4);
    b.clear();
    expect(b.activeCount()).toBe(0);
  });

  it('marks expire after 3.0 s of simulation time', () => {
    const b = new Burns();
    b.spawn(0, 0, 0.5);
    b.step(STEP);
    expect(b.activeCount()).toBe(1);
    for (let t = 0; t < BU.life; t += STEP) b.step(STEP);
    expect(b.activeCount()).toBe(0);
  });
});

describe('particles (ARCHITECTURE §4.6, 1.5b)', () => {
  it('ring-buffer slots wrap to 0', () => {
    expect(nextSlot(0, 4)).toBe(1);
    expect(nextSlot(3, 4)).toBe(0);
  });

  it('particles live for their life in simulation time, then die; clear kills all', () => {
    const p = new Particles(8, 'glow');
    const s = newSpec();
    s.life = 0.5;
    for (let i = 0; i < 3; i++) p.spawn(s);
    p.step(STEP);
    expect(p.aliveCount()).toBe(3);
    for (let t = 0; t < 0.5; t += STEP) p.step(STEP);
    expect(p.aliveCount()).toBe(0);
    for (let i = 0; i < 20; i++) p.spawn(s); // more than the capacity: the oldest are overwritten
    p.step(STEP);
    expect(p.aliveCount()).toBe(8);
    p.clear();
    expect(p.aliveCount()).toBe(0);
  });

  it('the clock only advances in step (it freezes during hit-stop)', () => {
    const p = new Particles(4, 'smoke');
    p.step(0.1);
    p.step(0.1);
    expect(p.now).toBeCloseTo(0.2, 9);
  });
});
