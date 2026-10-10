import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';

describe('CONFIG', () => {
  it('all three rage upgrades are off by default (GAME_DESIGN §6.5a)', () => {
    expect(CONFIG.rageUpgrades.doubleSlam).toBe(false);
    expect(CONFIG.rageUpgrades.chargeUTurn).toBe(false);
    expect(CONFIG.rageUpgrades.staggeredShards).toBe(false);
  });

  it('is deeply frozen (never mutated)', () => {
    expect(Object.isFrozen(CONFIG)).toBe(true);
    expect(Object.isFrozen(CONFIG.player)).toBe(true);
    expect(Object.isFrozen(CONFIG.player.hitSpheres)).toBe(true);
    expect(Object.isFrozen(CONFIG.player.hitSpheres[0])).toBe(true);
    expect(() => {
      (CONFIG.player as { maxSpeed: number }).maxSpeed = 99;
    }).toThrow();
  });

  it('has the groups required by ARCHITECTURE §6', () => {
    const groups = [
      'player', 'combo', 'roll', 'stamina', 'flask', 'hurt', 'buffer', 'wobble', 'boss', 'rebuke', 'rage',
      'rageUpgrades', 'slam', 'charge', 'rain', 'camera', 'arena', 'lights', 'colors', 'fx', 'ui', 'transitions', 'audio', 'easy',
    ];
    for (const g of groups) expect(CONFIG).toHaveProperty(g);
  });

  it('derived documented values hold', () => {
    // arena wall clamp 30 − 0.4 = 29.6 m (GD §4.2)
    expect(CONFIG.arena.radius - CONFIG.player.radius).toBeCloseTo(29.6);
    // i-frames 0.35 s (GD §4.3a)
    expect(CONFIG.roll.iFrameEnd - CONFIG.roll.iFrameStart).toBeCloseTo(0.35);
    // full roll cycle 0.67 s, no cooldown (GD §4.3a)
    expect(CONFIG.roll.duration + CONFIG.roll.recoveryDuration).toBeCloseTo(0.67);
    // stamina budget: 3 rolls, or 3 hits + 1 roll, from full (GD §4.3b)
    const S = CONFIG.stamina;
    const hits = CONFIG.combo.hits.reduce((a, h) => a + h.cost, 0);
    expect(3 * S.rollCost).toBe(S.max);
    expect(hits + S.rollCost).toBe(S.max);
    // full combo 1.79 s with perfect chaining (GD §4.3)
    const [h1, h2, h3] = CONFIG.combo.hits;
    const toChain = (h: typeof h1) => h.windup.duration + h.active.duration + h.chainAt;
    expect(toChain(h1) + toChain(h2) + h3.windup.duration + h3.active.duration + h3.recovery.duration).toBeCloseTo(1.79);
    // boss HP 20 in 5 segments of 4; rage at ≤ 8
    expect(CONFIG.boss.hp / CONFIG.boss.healthSegments).toBe(4);
    expect(CONFIG.rage.hpThreshold).toBe(8);
    // rage ring speed 11.2 m/s, rage dash 25.2 m/s (GD §6.5)
    expect(CONFIG.slam.ringSpeed * CONFIG.rage.speedMult).toBeCloseTo(11.2);
    expect(CONFIG.charge.speed * CONFIG.rage.speedMult).toBeCloseTo(25.2);
  });
});
