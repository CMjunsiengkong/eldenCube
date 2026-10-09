import { describe, expect, it } from 'vitest';
import {
  createSphereOBBResult,
  inCircle,
  inRingBand,
  pointInOBB,
  sphereOBB,
  sphereSphere,
  toBoxLocal,
} from '../src/systems/collision';

const v = (x: number, y: number, z: number) => ({ x, y, z });
const BOX = v(0, 2, 0); // boss box center (half-size 2 → spans y 0..4)
const DEG = Math.PI / 180;

describe('toBoxLocal (yaw convention)', () => {
  it('is the inverse of three.js rotation.y', () => {
    // A box with yaw 90° has its local +Z pointing to world +X.
    const l = toBoxLocal(v(1, 0, 0), v(0, 0, 0), 90 * DEG, v(0, 0, 0));
    expect(l.x).toBeCloseTo(0);
    expect(l.z).toBeCloseTo(1);
  });
});

describe('pointInOBB (ARCHITECTURE §5.4)', () => {
  it('axis-aligned: inside, on the surface (inclusive) and outside', () => {
    expect(pointInOBB(v(0, 2, 0), BOX, 2, 0)).toBe(true);
    expect(pointInOBB(v(2, 2, 0), BOX, 2, 0)).toBe(true); // on the face
    expect(pointInOBB(v(2.01, 2, 0), BOX, 2, 0)).toBe(false);
    expect(pointInOBB(v(0, 4.01, 0), BOX, 2, 0)).toBe(false);
    expect(pointInOBB(v(0, -0.01, 0), BOX, 2, 0)).toBe(false);
  });

  it('yawed 45°: a corner direction reaches farther than a face direction', () => {
    // Along world +X, a 45°-rotated cube extends to 2·√2 ≈ 2.83.
    expect(pointInOBB(v(2.7, 2, 0), BOX, 2, 45 * DEG)).toBe(true);
    expect(pointInOBB(v(2.9, 2, 0), BOX, 2, 45 * DEG)).toBe(false);
    // Along its own diagonal (world 45°) it only extends to 2.
    const d = 2.1 / Math.SQRT2;
    expect(pointInOBB(v(d, 2, d), BOX, 2, 45 * DEG)).toBe(false);
  });

  it('yawed 90° behaves like axis-aligned', () => {
    expect(pointInOBB(v(1.9, 2, -1.9), BOX, 2, 90 * DEG)).toBe(true);
    expect(pointInOBB(v(2.1, 2, 0), BOX, 2, 90 * DEG)).toBe(false);
  });
});

describe('sphereOBB', () => {
  const out = createSphereOBBResult();

  it('misses when separated, hits when overlapping a face, with the push-out normal', () => {
    expect(sphereOBB(v(2.5, 1, 0), 0.4, BOX, 2, 0, out)).toBe(false);
    expect(out.depth).toBe(0);
    expect(sphereOBB(v(2.3, 1, 0), 0.4, BOX, 2, 0, out)).toBe(true);
    expect(out.normal.x).toBeCloseTo(1);
    expect(out.normal.z).toBeCloseTo(0);
    expect(out.depth).toBeCloseTo(0.1);
  });

  it('touching exactly is a hit (inclusive)', () => {
    expect(sphereOBB(v(2.4, 1, 0), 0.4, BOX, 2, 0, out)).toBe(true);
    expect(out.depth).toBeCloseTo(0);
  });

  it('corner region: normal points diagonally', () => {
    expect(sphereOBB(v(2.2, 1, 2.2), 0.4, BOX, 2, 0, out)).toBe(true);
    expect(out.normal.x).toBeCloseTo(Math.SQRT1_2);
    expect(out.normal.z).toBeCloseTo(Math.SQRT1_2);
  });

  it('center inside: leaves through the nearest face', () => {
    expect(sphereOBB(v(1.8, 2, 0.5), 0.4, BOX, 2, 0, out)).toBe(true);
    expect(out.normal.x).toBeCloseTo(1);
    expect(out.depth).toBeCloseTo(0.6); // 0.2 to the face + radius 0.4
  });

  it('horizontalOnly never pushes vertically, even when the floor face is nearest', () => {
    // Sphere at y 0.3 inside the box: the bottom face is nearest (0.3 away), but the push
    // must go through the nearest side face (+Z, 0.5 away).
    expect(sphereOBB(v(0, 0.3, 1.5), 0.4, BOX, 2, 0, out, true)).toBe(true);
    expect(out.normal.y).toBe(0);
    expect(out.normal.z).toBeCloseTo(1);
    expect(out.depth).toBeCloseTo(0.9);
  });

  it('yawed box: the normal is rotated into world space', () => {
    // Box yawed 90°: its local +X face points to world −Z.
    expect(sphereOBB(v(0, 2, -2.3), 0.4, BOX, 2, 90 * DEG, out)).toBe(true);
    expect(out.normal.x).toBeCloseTo(0);
    expect(out.normal.z).toBeCloseTo(-1);
  });
});

describe('sphereSphere / inRingBand / inCircle', () => {
  it('sphereSphere is inclusive at r1 + r2', () => {
    expect(sphereSphere(v(0, 0, 0), 0.35, v(0.75, 0, 0), 0.4)).toBe(true);
    expect(sphereSphere(v(0, 0, 0), 0.35, v(0.76, 0, 0), 0.4)).toBe(false);
    expect(sphereSphere(v(0, 0, 0), 0.35, v(0.4, 0.4, 0.4), 0.4)).toBe(true);
  });

  it('inRingBand uses horizontal distance and is inclusive', () => {
    const c = v(0, 0, 0);
    expect(inRingBand(v(5, 0, 0), c, 5, 0.9)).toBe(true);
    expect(inRingBand(v(5.89, 0, 0), c, 5, 0.9)).toBe(true);
    expect(inRingBand(v(4.11, 0, 0), c, 5, 0.9)).toBe(true);
    expect(inRingBand(v(5, 0, 0), c, 5, 0)).toBe(true); // inclusive at |d − r| = halfWidth
    expect(inRingBand(v(6, 0, 0), c, 5, 0.9)).toBe(false);
    expect(inRingBand(v(5, 100, 0), c, 5, 0.9)).toBe(true); // height is ignored
  });

  it('inCircle uses horizontal distance', () => {
    expect(inCircle(v(1.6, 0, 0), v(0, 0, 0), 1.6)).toBe(true);
    expect(inCircle(v(1.0, 5, 1.3), v(0, 0, 0), 1.6)).toBe(false);
  });
});
