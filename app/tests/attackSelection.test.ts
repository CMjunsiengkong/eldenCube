import { describe, expect, it } from 'vitest';
import { chooseMove, distanceBand, type BossMove } from '../src/entities/Boss';
import { CONFIG } from '../src/config';
import type { AttackId } from '../src/attacks/Attack';
import { createRng } from '../src/util/rng';

const XC = 3; // extreme close
const CLOSE = 6; // exactly 6 m: Charge is not allowed (it needs > 6 m)
const MID = 10;
const FAR = 20;

/** Frequencies of 20,000 seeded picks. */
function freq(history: AttackId[], distance: number, rainAlive: boolean, phase: 'p1' | 'rage', seed = 7): Record<string, number> {
  const rng = createRng(seed);
  const out: Record<string, number> = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const id = chooseMove(history, distance, rainAlive, phase, rng);
    out[id] = (out[id] ?? 0) + 1 / N;
  }
  return out;
}

describe('distance bands (GAME_DESIGN §6.5, 2026-10-12)', () => {
  it('extreme close < 4.5 m, close < 8, mid < 16, far beyond', () => {
    expect([1, 4.49, 4.5, 7.99, 8, 15.99, 16, 40].map(distanceBand)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('chooseMove — weighted pick (GAME_DESIGN §6.5, 2026-10-12)', () => {
  it('extreme close (1.6): Rebuke 45%, Hop-Back 25%, Shove 15%, the other 15% shared by the allowed attacks', () => {
    for (const phase of ['p1', 'rage'] as const) {
      const f = freq([], XC, false, phase);
      expect(f.rebuke).toBeCloseTo(0.45, 1);
      expect(f.hop).toBeCloseTo(0.25, 1);
      expect(f.shove).toBeCloseTo(0.15, 1);
      expect((f.slam ?? 0) + (f.rain ?? 0) + (f.cone ?? 0)).toBeCloseTo(0.15, 1);
      expect(f.charge ?? 0).toBe(0);
      expect(f.beam ?? 0).toBe(0);
    }
  });

  it('follows the band weights (Phase 1, mid range)', () => {
    const w = CONFIG.ai.weights.p1;
    const total = w.slam[2] + w.charge[2] + w.rain[2] + w.cone[2] + w.beam[2];
    const f = freq([], MID, false, 'p1');
    for (const id of ['slam', 'charge', 'rain', 'cone', 'beam'] as const) expect(f[id]).toBeCloseTo(w[id][2] / total, 1);
    expect(f.rebuke ?? 0).toBe(0);
    expect((f.hop ?? 0) + (f.shove ?? 0)).toBe(0); // defences only at extreme close
  });

  it('rage shifts the far band toward the Flame Beam', () => {
    expect(freq([], FAR, false, 'rage').beam).toBeGreaterThan(freq([], FAR, false, 'p1').beam);
  });

  it('no Charge within 6 m; no Crown Rain while its shards fly', () => {
    expect(freq([], CLOSE, false, 'p1').charge ?? 0).toBe(0);
    expect(freq([], FAR, true, 'p1').rain ?? 0).toBe(0);
  });

  it('never the same attack 3 times in a row; the last one keeps 25% of its weight', () => {
    const rng = createRng(11);
    for (const id of ['slam', 'rain', 'cone'] as const) {
      for (let i = 0; i < 300; i++) expect(chooseMove([id, id], CLOSE + 1, false, 'p1', rng)).not.toBe(id);
    }
    const fresh = freq([], CLOSE + 1, false, 'p1').cone;
    const after = freq(['slam', 'cone'], CLOSE + 1, false, 'p1').cone;
    expect(after).toBeLessThan(fresh * 0.5);
    expect(after).toBeGreaterThan(0);
  });

  it('falls back to a blocked attack when nothing else is allowed, and handles rng ≈ 1', () => {
    // Far band in Phase 1 has weights for slam, charge, rain and beam; block all but the repeats.
    const id: BossMove = chooseMove(['beam', 'beam'], FAR, true, 'p1', () => 0.9999999999);
    expect(['slam', 'charge', 'beam']).toContain(id);
  });
});
