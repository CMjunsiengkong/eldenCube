import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { grassField, grassThreshold, valueNoise } from '../src/game/Ruins';

describe('ruin floor (GAME_DESIGN §8, 1.6)', () => {
  it('value noise stays in [0, 1) and is continuous', () => {
    for (let x = -5; x < 5; x += 0.37) {
      const v = valueNoise(x, x * 0.7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Math.abs(valueNoise(x + 0.001, x * 0.7) - v)).toBeLessThan(0.01);
    }
  });

  it('grass covers about 30% of the arena, in patches spread over the whole floor', () => {
    const t = grassThreshold();
    const R = CONFIG.arena.radius;
    let n = 0;
    let g = 0;
    const quad = [0, 0, 0, 0];
    for (let x = -R; x <= R; x += 0.37) {
      for (let z = -R; z <= R; z += 0.37) {
        if (x * x + z * z > R * R) continue;
        n++;
        if (grassField(x, z) > t) {
          g++;
          quad[(x > 0 ? 1 : 0) + (z > 0 ? 2 : 0)]++;
        }
      }
    }
    expect(g / n).toBeGreaterThan(0.27);
    expect(g / n).toBeLessThan(0.33);
    for (const q of quad) expect(q / g).toBeGreaterThan(0.12); // every quarter has grass
  });

  it('the curb sits outside the wall that holds the player', () => {
    const wall = CONFIG.arena.radius - CONFIG.player.radius;
    expect(CONFIG.arena.ruin.curb.inner).toBeGreaterThan(wall);
    expect(CONFIG.arena.ruin.decoRadius[0]).toBeGreaterThan(CONFIG.arena.ruin.curb.outer);
  });
});
