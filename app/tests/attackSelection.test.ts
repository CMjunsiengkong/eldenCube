import { describe, expect, it } from 'vitest';
import { chooseAttack } from '../src/entities/Boss';
import type { AttackId } from '../src/attacks/Attack';
import { createRng } from '../src/util/rng';

const FAR = 10;
const NEAR = 6; // exactly 6 m: Charge is invalid (it needs > 6 m)

describe('chooseAttack (GAME_DESIGN §6.5, ARCHITECTURE §8)', () => {
  it('never picks the same attack 3 times in a row', () => {
    const rng = createRng(11);
    for (const id of ['slam', 'charge', 'shards'] as const) {
      for (let i = 0; i < 300; i++) expect(chooseAttack([id, id], FAR, 0, rng)).not.toBe(id);
    }
  });

  it('a repeated attack is allowed when the last two differ', () => {
    const rng = createRng(12);
    const seen = new Set<AttackId>();
    for (let i = 0; i < 300; i++) seen.add(chooseAttack(['charge', 'slam'], FAR, 0, rng));
    expect(seen).toEqual(new Set(['slam', 'charge', 'shards']));
  });

  it('no Charge within 6 m', () => {
    const rng = createRng(13);
    for (let i = 0; i < 500; i++) {
      expect(chooseAttack([], NEAR, 0, rng)).not.toBe('charge');
      expect(chooseAttack([], 1, 0, rng)).not.toBe('charge');
    }
    // Charge invalid and Shards blocked → only Slam remains.
    for (let i = 0; i < 50; i++) expect(chooseAttack(['shards', 'shards'], NEAR, 0, rng)).toBe('slam');
    // Charge invalid and Slam blocked → only Shards remains.
    for (let i = 0; i < 50; i++) expect(chooseAttack(['slam', 'slam'], NEAR, 0, rng)).toBe('shards');
  });

  it('close timer ≥ 3.0 s forces Slam, or Shards when Slam is blocked', () => {
    const rng = createRng(14);
    for (let i = 0; i < 100; i++) {
      expect(chooseAttack([], FAR, 3.0, rng)).toBe('slam');
      expect(chooseAttack(['charge', 'charge'], 2, 5, rng)).toBe('slam');
      expect(chooseAttack(['slam', 'slam'], 2, 3.0, rng)).toBe('shards');
    }
    expect(chooseAttack([], FAR, 2.99, () => 0.5)).not.toBe(undefined);
  });

  it('over 1,000 seeded runs every valid attack appears', () => {
    for (const seed of [1, 2, 3]) {
      const rng = createRng(seed);
      const counts: Record<AttackId, number> = { slam: 0, charge: 0, shards: 0 };
      const history: AttackId[] = [];
      for (let i = 0; i < 1000; i++) {
        const id = chooseAttack(history, FAR, 0, rng);
        counts[id]++;
        history.push(id);
        const n = history.length;
        if (n >= 3) expect(history[n - 1] === history[n - 2] && history[n - 2] === history[n - 3]).toBe(false);
      }
      expect(counts.slam).toBeGreaterThan(200);
      expect(counts.charge).toBeGreaterThan(200);
      expect(counts.shards).toBeGreaterThan(200);
    }
  });

  it('rng values close to 1 still return a valid attack', () => {
    expect(['slam', 'charge', 'shards']).toContain(chooseAttack([], FAR, 0, () => 0.9999999999));
  });
});
