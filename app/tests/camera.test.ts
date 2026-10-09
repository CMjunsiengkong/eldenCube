import { describe, expect, it } from 'vitest';
import { lockOnPose, orbitPose } from '../src/systems/camera';

const v = () => ({ x: 0, y: 0, z: 0 });

describe('camera poses (GAME_DESIGN §7)', () => {
  it('lock-on: behind the player, 6.0 m back and 3.2 m up when far from the boss', () => {
    const pos = v();
    const look = v();
    const dir = { x: 0, z: 1 };
    lockOnPose({ x: 0, y: 0, z: 12 }, { x: 0, y: 0, z: 0 }, dir, pos, look);
    expect(pos).toEqual({ x: 0, y: 3.2, z: 18 });
    // look = lerp(player, boss, 0.4) + (0, 1.2, 0)
    expect(look.x).toBeCloseTo(0);
    expect(look.y).toBeCloseTo(1.2);
    expect(look.z).toBeCloseTo(7.2);
  });

  it('lock-on: 7.5 m back and 4.2 m up within 5 m of the boss', () => {
    const pos = v();
    const look = v();
    lockOnPose({ x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, z: 1 }, pos, look);
    expect(pos.x).toBeCloseTo(10.5);
    expect(pos.y).toBeCloseTo(4.2);
    expect(pos.z).toBeCloseTo(0);
  });

  it('lock-on keeps the last direction when the player is at the boss center', () => {
    const pos = v();
    const dir = { x: 1, z: 0 };
    lockOnPose({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, dir, pos, v());
    expect(dir).toEqual({ x: 1, z: 0 });
    expect(pos.x).toBeCloseTo(7.5);
  });

  it('orbit: radius 14, height 6, looking at (0, 2, 0); angle 0 is on +Z', () => {
    const pos = v();
    const look = v();
    orbitPose(0, pos, look);
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBe(6);
    expect(pos.z).toBeCloseTo(14);
    expect(look).toEqual({ x: 0, y: 2, z: 0 });
  });
});
