import { describe, expect, it } from 'vitest';
import { Object3D } from 'three';
import { createPiece, debrisCenter, stepDebris } from '../src/fx/debris';
import { Squash } from '../src/fx/effects';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { Vector3 } from 'three';

describe('debris physics (ARCHITECTURE §5.6)', () => {
  it('falls, bounces with 0.35 restitution, and eventually sleeps on the ground', () => {
    const o = new Object3D();
    o.position.set(0, 3, 0);
    const p = createPiece(o, 0.5);
    p.vel.set(2, 0, 0);
    let bounced = false;
    for (let i = 0; i < 600 && !p.asleep; i++) {
      const vyBefore = p.vel.y;
      stepDebris([p], STEP);
      if (vyBefore < 0 && p.vel.y > 0) {
        bounced = true;
        expect(p.vel.y).toBeCloseTo(-(vyBefore - CONFIG.fx.gravity * STEP) * CONFIG.fx.debris.bounce, 6);
      }
      expect(o.position.y).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
    expect(bounced).toBe(true);
    expect(p.asleep).toBe(true);
    expect(o.position.y).toBeCloseTo(0.5, 6);
  });

  it('debrisCenter is the average position', () => {
    const a = new Object3D();
    const b = new Object3D();
    a.position.set(0, 0, 0);
    b.position.set(2, 4, 6);
    expect(debrisCenter([createPiece(a, 0), createPiece(b, 0)], new Vector3()).toArray()).toEqual([1, 2, 3]);
  });
});

describe('squash (GAME_DESIGN §6.3)', () => {
  it('starts at (1.15, 0.85, 1.15) and is back to (1, 1, 1) after 0.25 s', () => {
    const s = new Squash();
    const out = { x: 0, y: 0, z: 0 };
    s.start();
    s.scale(out);
    expect(out).toEqual({ x: 1.15, y: 0.85, z: 1.15 });
    for (let i = 0; i < Math.round(CONFIG.boss.hit.squashReturn / STEP); i++) s.step(STEP);
    s.scale(out);
    expect(out.x).toBeCloseTo(1, 6);
    expect(out.y).toBeCloseTo(1, 6);
  });
});
