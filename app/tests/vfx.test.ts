import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { Scene } from 'three';
import { Burns, burnFade } from '../src/fx/burns';
import { Puffs } from '../src/fx/effects';
import { newSpec, nextSlot, Particles } from '../src/fx/particles';
import { SlimeBody } from '../src/fx/slime';
import { torchFlicker } from '../src/game/Arena';
import { createRng } from '../src/util/rng';

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

const SL = CONFIG.boss.slime;

describe('boss slime motion (GAME_DESIGN §6.1, 1.5b)', () => {
  it('keeps the volume constant: sx · sy · sz = 1', () => {
    const b = new SlimeBody();
    for (let i = 0; i < 30; i++) b.step(STEP, SL.slamDropStretch, 0, 0, 0);
    expect(b.scaleY).toBeGreaterThan(1.2);
    expect(b.scaleXZ * b.scaleXZ * b.scaleY).toBeCloseTo(1, 9);
  });

  it('a splat dips below 1 and wobbles back to rest; the scale stays within its limits', () => {
    const b = new SlimeBody();
    b.kick(SL.slamSplatKick);
    let min = 1;
    for (let i = 0; i < 180; i++) {
      b.step(STEP, 1, 0, 0, 0);
      min = Math.min(min, b.scaleY);
      expect(b.scaleY).toBeGreaterThanOrEqual(SL.minScale);
      expect(b.scaleY).toBeLessThanOrEqual(SL.maxScale);
    }
    expect(min).toBeLessThan(0.85);
    expect(b.scaleY).toBeCloseTo(1, 2);
  });

  it('the top trails a fast move (lean against the velocity) and settles when still', () => {
    const b = new SlimeBody();
    let x = 0;
    for (let i = 0; i < 30; i++) {
      x += 18 * STEP; // a dash along +X with yaw 0
      b.step(STEP, 1, x, 0, 0);
    }
    expect(b.leanX.x).toBeLessThan(-0.05);
    for (let i = 0; i < 240; i++) b.step(STEP, 1, x, 0, 0);
    expect(Math.abs(b.leanX.x)).toBeLessThan(0.01);
  });
});

describe('torch flicker (GAME_DESIGN §8, 1.5b)', () => {
  it('stays within ±15% of the base intensity', () => {
    const f = CONFIG.lights.torch.flicker;
    for (let t = 0; t < 10; t += 0.013) {
      const v = torchFlicker(t, 1.3);
      expect(v).toBeGreaterThanOrEqual(1 - f - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + f + 1e-9);
    }
  });
});

describe('debris puffs (ARCHITECTURE §4.6, 1.6)', () => {
  it('a full pool of puffs is one scene object (one draw call), gone after its lifetime', () => {
    const scene = new Scene();
    const puffs = new Puffs(scene, createRng(1));
    for (let i = 0; i < 40; i++) puffs.spawn(i, 0.5, 0, i % 2 ? 'crown' : 'rebuke');
    expect(puffs.count).toBe(CONFIG.fx.puff.pool);
    expect(scene.children).toHaveLength(1);
    for (let t = 0; t < CONFIG.fx.puff.lifetime + STEP; t += STEP) puffs.step(STEP);
    expect(puffs.count).toBe(0);
    expect(scene.children).toHaveLength(0);
  });
});
