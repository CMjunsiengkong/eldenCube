import { describe, expect, it } from 'vitest';
import { chooseAttack } from '../src/entities/Boss';
import type { AttackId } from '../src/attacks/Attack';
import { createRng } from '../src/util/rng';

const FAR = 10;
const NEAR = 6; // exactly 6 m: Charge is invalid (it needs > 6 m)

describe('chooseAttack (GAME_DESIGN §6.5, ARCHITECTURE §8)', () => {
  it('never picks the same attack 3 times in a row', () => {
    const rng = createRng(11);
    for (const id of ['slam', 'charge', 'rain'] as const) {
      for (let i = 0; i < 300; i++) expect(chooseAttack([id, id], FAR, false, rng)).not.toBe(id);
    }
  });

  it('a repeated attack is allowed when the last two differ', () => {
    const rng = createRng(12);
    const seen = new Set<AttackId>();
    for (let i = 0; i < 300; i++) seen.add(chooseAttack(['charge', 'slam'], FAR, false, rng));
    expect(seen).toEqual(new Set(['slam', 'charge', 'rain']));
  });

  it('no Charge within 6 m', () => {
    const rng = createRng(13);
    for (let i = 0; i < 500; i++) {
      expect(chooseAttack([], NEAR, false, rng)).not.toBe('charge');
      expect(chooseAttack([], 1, false, rng)).not.toBe('charge');
    }
    for (let i = 0; i < 50; i++) expect(chooseAttack(['rain', 'rain'], NEAR, false, rng)).toBe('slam');
    for (let i = 0; i < 50; i++) expect(chooseAttack(['slam', 'slam'], NEAR, false, rng)).toBe('rain');
  });

  it('no Crown Rain while rain shards are alive', () => {
    const rng = createRng(14);
    for (let i = 0; i < 500; i++) expect(chooseAttack([], FAR, true, rng)).not.toBe('rain');
  });

  it('falls back to the blocked attack when nothing else is valid', () => {
    const rng = createRng(15);
    // Within 6 m and rain alive: only Slam is valid, even after two Slams.
    for (let i = 0; i < 50; i++) expect(chooseAttack(['slam', 'slam'], 2, true, rng)).toBe('slam');
  });

  it('over 1,000 seeded runs every valid attack appears', () => {
    for (const seed of [1, 2, 3]) {
      const rng = createRng(seed);
      const counts: Record<AttackId, number> = { slam: 0, charge: 0, rain: 0 };
      const history: AttackId[] = [];
      for (let i = 0; i < 1000; i++) {
        const id = chooseAttack(history, FAR, false, rng);
        counts[id]++;
        history.push(id);
        const n = history.length;
        if (n >= 3) expect(history[n - 1] === history[n - 2] && history[n - 2] === history[n - 3]).toBe(false);
      }
      expect(counts.slam).toBeGreaterThan(200);
      expect(counts.charge).toBeGreaterThan(200);
      expect(counts.rain).toBeGreaterThan(200);
    }
  });

  it('rng values close to 1 still return a valid attack', () => {
    expect(['slam', 'charge', 'rain']).toContain(chooseAttack([], FAR, false, () => 0.9999999999));
  });
});
