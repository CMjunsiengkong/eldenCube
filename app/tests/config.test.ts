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
      'player', 'swing', 'roll', 'wobble', 'boss', 'tactics', 'rage', 'rageUpgrades', 'slam', 'charge',
      'shards', 'camera', 'arena', 'lights', 'colors', 'fx', 'ui', 'transitions', 'audio', 'easy',
    ];
    for (const g of groups) expect(CONFIG).toHaveProperty(g);
  });

  it('derived documented values hold', () => {
    // arena wall clamp 30 − 0.4 = 29.6 m (GD §4.2)
    expect(CONFIG.arena.radius - CONFIG.player.radius).toBeCloseTo(29.6);
    // i-frames 0.35 s (GD §4.3a)
    expect(CONFIG.roll.iFrameEnd - CONFIG.roll.iFrameStart).toBeCloseTo(0.35);
    // full roll cycle 0.95 s
    expect(CONFIG.roll.duration + CONFIG.roll.recoveryDuration + CONFIG.roll.cooldown).toBeCloseTo(0.95);
    // rage ring speed 11.2 m/s, rage dash 25.2 m/s (GD §6.5)
    expect(CONFIG.slam.ringSpeed * CONFIG.rage.speedMult).toBeCloseTo(11.2);
    expect(CONFIG.charge.speed * CONFIG.rage.speedMult).toBeCloseTo(25.2);
  });
});
