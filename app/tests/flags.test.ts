import { describe, expect, it } from 'vitest';
import { cooldownFor, parseFlags, shardFlightTime, speedMult, telegraphMult, type Flags } from '../src/flags';

const NONE: Flags = { easy: false, debug: false };
const EASY: Flags = { easy: true, debug: false };

describe('parseFlags (ARCHITECTURE §8)', () => {
  it('no parameters → no flags', () => {
    expect(parseFlags('')).toEqual({ easy: false, debug: false });
    expect(parseFlags('?')).toEqual({ easy: false, debug: false });
  });

  it('?easy and ?debug individually', () => {
    expect(parseFlags('?easy')).toEqual({ easy: true, debug: false });
    expect(parseFlags('?debug')).toEqual({ easy: false, debug: true });
  });

  it('both combined, in any order and with values', () => {
    expect(parseFlags('?easy&debug')).toEqual({ easy: true, debug: true });
    expect(parseFlags('?debug=1&easy=yes')).toEqual({ easy: true, debug: true });
  });

  it('unrelated parameters are ignored', () => {
    expect(parseFlags('?foo=bar&easyish')).toEqual({ easy: false, debug: false });
  });
});

describe('multipliers (GAME_DESIGN §6.4, §11; decisions D3, D4)', () => {
  it('speed: rage ×1.4, easy ×0.75, combined', () => {
    expect(speedMult('p1', NONE)).toBe(1);
    expect(speedMult('rage', NONE)).toBeCloseTo(1.4);
    expect(speedMult('p1', EASY)).toBeCloseTo(0.75);
    expect(speedMult('rage', EASY)).toBeCloseTo(1.05);
  });

  it('telegraph: rage ×0.6, easy ×1.3', () => {
    expect(telegraphMult('p1', NONE)).toBe(1);
    expect(telegraphMult('rage', NONE)).toBeCloseTo(0.6);
    expect(telegraphMult('p1', EASY)).toBeCloseTo(1.3);
    expect(telegraphMult('rage', EASY)).toBeCloseTo(0.78);
  });

  it('cooldown: 2.5 s / rage 1.6 s, easy ×1.3', () => {
    expect(cooldownFor('p1', NONE)).toBeCloseTo(2.5);
    expect(cooldownFor('rage', NONE)).toBeCloseTo(1.6);
    expect(cooldownFor('p1', EASY)).toBeCloseTo(3.25);
    expect(cooldownFor('rage', EASY)).toBeCloseTo(2.08);
  });

  it('shard flight time = 0.8 / speed multiplier', () => {
    expect(shardFlightTime('p1', NONE)).toBeCloseTo(0.8);
    expect(shardFlightTime('rage', NONE)).toBeCloseTo(0.5714, 3);
    expect(shardFlightTime('p1', EASY)).toBeCloseTo(1.0667, 3);
    expect(shardFlightTime('rage', EASY)).toBeCloseTo(0.7619, 3);
  });
});
