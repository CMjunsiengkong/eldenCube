import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CubeSlam } from '../src/attacks/CubeSlam';
import { RoyalCharge } from '../src/attacks/RoyalCharge';
import { CrownShards, placeCircles } from '../src/attacks/CrownShards';
import type { Attack } from '../src/attacks/Attack';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { makeCtx, spheresAt, type TestCtx } from './attackCtx';

/** Runs the attack to the end; calls `each(t)` after every step. Returns the total time. */
function run(a: Attack, ctx: TestCtx, each?: (t: number) => void, max = 30): number {
  a.start(ctx);
  let t = 0;
  while (!a.isFinished() && t < max) {
    a.update(STEP, ctx);
    t += STEP;
    each?.(t);
  }
  return t;
}

describe('Cube Slam (GAME_DESIGN §6.5 A)', () => {
  it('rises to 4 m over the telegraph, hangs 0.15 s, drops in 0.20 s, ring runs 2.2 → 14 m at 8 m/s', () => {
    const ctx = makeCtx();
    const slam = new CubeSlam();
    let impactAt = -1;
    let maxY = 0;
    const radii: number[] = [];
    const total = run(slam, ctx, (t) => {
      maxY = Math.max(maxY, ctx.boss.pos.y);
      if (impactAt < 0 && slam.phaseName === 'ring') impactAt = t;
      slam.liveRings(radii);
    });
    expect(maxY).toBeCloseTo(CONFIG.slam.riseHeight, 6);
    expect(impactAt).toBeCloseTo(1.0 + 0.15 + 0.2, 6);
    expect(total - impactAt).toBeCloseTo((14 - 2.2) / 8, 1);
    expect(ctx.boss.pos.y).toBe(0);
    expect(ctx.scene.children).toHaveLength(0); // shadow and ring removed
  });

  it('rage: telegraph ×0.6 and ring ×1.4 (11.2 m/s)', () => {
    const ctx = makeCtx({ rage: true });
    const slam = new CubeSlam();
    let impactAt = -1;
    const total = run(slam, ctx, (t) => {
      if (impactAt < 0 && slam.phaseName === 'ring') impactAt = t;
    });
    expect(impactAt).toBeCloseTo(0.6 + 0.15 + 0.2, 6);
    expect(total - impactAt).toBeCloseTo((14 - 2.2) / 11.2, 1);
  });

  it('kills inside the ring band r ± 0.9 only; the footprint kills only on the impact frame', () => {
    const ctx = makeCtx();
    const slam = new CubeSlam();
    slam.start(ctx);
    // Under the boss during the rise: no kill yet.
    for (let i = 0; i < 30; i++) {
      slam.update(STEP, ctx);
      expect(slam.checkPlayerHit(spheresAt(0, 1))).toBeNull();
    }
    while (slam.phaseName !== 'ring') slam.update(STEP, ctx);
    expect(slam.checkPlayerHit(spheresAt(0, 1))).not.toBeNull(); // impact frame, inside the footprint
    const radii: number[] = [];
    slam.update(STEP, ctx);
    const r = slam.liveRings(radii)[0];
    expect(slam.checkPlayerHit(spheresAt(0, r + 0.89))).not.toBeNull();
    expect(slam.checkPlayerHit(spheresAt(0, r - 0.89))).not.toBeNull();
    expect(slam.checkPlayerHit(spheresAt(0, r + 0.95))).toBeNull();
    expect(slam.checkPlayerHit(spheresAt(0, 14.95))).toBeNull();
  });

  it('dispose with puff removes the ring and spawns puffs (D9)', () => {
    const ctx = makeCtx();
    const slam = new CubeSlam();
    slam.start(ctx);
    while (slam.phaseName !== 'ring') slam.update(STEP, ctx);
    slam.update(STEP, ctx);
    slam.dispose(true);
    expect(ctx.effects.count).toBeGreaterThan(0);
    expect(ctx.scene.children).toHaveLength(ctx.effects.count); // only the puff pieces remain
    ctx.effects.clear();
    expect(ctx.scene.children).toHaveLength(0);
    expect(slam.isFinished()).toBe(true);
  });
});

describe('Royal Charge (GAME_DESIGN §6.5 B)', () => {
  it('locks toward the player at the end of the telegraph and dashes at 18 m/s', () => {
    const ctx = makeCtx();
    ctx.playerPos.set(10, 0, 0);
    const charge = new RoyalCharge();
    charge.start(ctx);
    let t = 0;
    while (charge.phaseName === 'telegraph') {
      charge.update(STEP, ctx);
      t += STEP;
    }
    expect(t).toBeCloseTo(1.0, 6);
    expect(ctx.boss.dashing).toBe(true);
    ctx.playerPos.set(0, 0, 10); // moving after the lock does not change the direction
    const x0 = ctx.boss.pos.x;
    charge.update(STEP, ctx);
    expect((ctx.boss.pos.x - x0) / STEP).toBeCloseTo(18, 6);
    expect(ctx.boss.pos.z).toBeCloseTo(0, 9);
  });

  it('stops at radius 27 (then skids 0.3 s, clamped) or after 2.0 s', () => {
    const ctx = makeCtx();
    ctx.playerPos.set(10, 0, 0);
    const charge = new RoyalCharge();
    let dashTime = 0;
    let maxR = 0;
    run(charge, ctx, () => {
      if (charge.phaseName === 'dash') dashTime += STEP;
      maxR = Math.max(maxR, Math.hypot(ctx.boss.pos.x, ctx.boss.pos.z));
    });
    expect(dashTime).toBeLessThan(27 / 18 + 2 * STEP);
    expect(maxR).toBeLessThanOrEqual(27 + 1e-9);
    expect(ctx.boss.pos.x).toBeCloseTo(27, 6);

    const slow = makeCtx({ speedMult: 0.5 }); // 9 m/s from −13: reaches 27 only after 4.4 s
    slow.boss.pos.set(-13, 0, 0);
    slow.playerPos.set(10, 0, 0);
    const c2 = new RoyalCharge();
    let d2 = 0;
    run(c2, slow, () => {
      if (c2.phaseName === 'dash') d2 += STEP;
    });
    expect(d2).toBeCloseTo(2.0, 1);
  });

  it('kills only during the dash', () => {
    const ctx = makeCtx();
    ctx.playerPos.set(0, 0, 5);
    const charge = new RoyalCharge();
    charge.start(ctx);
    while (charge.phaseName === 'telegraph') {
      charge.update(STEP, ctx);
      if (charge.phaseName === 'telegraph') expect(charge.checkPlayerHit(spheresAt(0, 2.2))).toBeNull(); // touching, not dashing
    }
    let hit = null;
    while (charge.phaseName === 'dash' && !hit) {
      charge.update(STEP, ctx);
      hit = charge.checkPlayerHit(spheresAt(0, 5));
    }
    expect(hit).not.toBeNull();
  });
});

describe('Crown Shards (GAME_DESIGN §6.5 C)', () => {
  it('places circles at P + V·0.5 and ±2.5 m perpendicular to boss→player, clamped inside the arena', () => {
    const out = [new Vector3(), new Vector3(), new Vector3()];
    placeCircles(0, 10, 2, 0, 0, 0, 0, out);
    expect(out[0].toArray()).toEqual([1, 0, 10]);
    expect(out[1].x).toBeCloseTo(3.5);
    expect(out[2].x).toBeCloseTo(-1.5);
    expect(out[1].z).toBeCloseTo(10);
    placeCircles(0, 29, 0, 6, 0, 0, 0, out);
    for (const c of out) expect(Math.hypot(c.x, c.z)).toBeLessThanOrEqual(30 - 1.2 + 1e-9);
  });

  it('shards land exactly on the circle centers at the same time after 0.8 s (D4: 0.8 / speedMult)', () => {
    for (const [ctx, flight] of [
      [makeCtx(), 0.8],
      [makeCtx({ rage: true }), 0.8 / 1.4],
      [makeCtx({ speedMult: 0.75 }), 0.8 / 0.75],
    ] as const) {
      ctx.playerPos.set(3, 0, 9);
      const shards = new CrownShards();
      shards.start(ctx);
      expect(shards.flightTimes().every((f) => Math.abs(f - flight) < 1e-9)).toBe(true);
      const positions: Vector3[] = [];
      const last: Vector3[] = [new Vector3(), new Vector3(), new Vector3()];
      let tFlight = 0;
      while (!shards.isFinished()) {
        shards.update(STEP, ctx);
        if (shards.phaseName !== 'flight') continue;
        tFlight += STEP;
        shards.flyingShards(positions);
        if (positions.length === 3) positions.forEach((p, i) => last[i].copy(p));
      }
      expect(tFlight).toBeLessThan(flight + 2 * STEP);
      // The semi-implicit Euler path is within a few cm of the target on the last flight step
      // before the landing snap (allow one step of travel).
      shards.circleCenters.forEach((c, i) => {
        expect(c.y).toBeCloseTo(CONFIG.shards.landHeight, 9);
        expect(last[i].distanceTo(c)).toBeLessThan(1.0);
      });
    }
  });

  it('landing kills within 1.2 + 0.4 m of a circle center; shards in flight kill on contact', () => {
    const ctx = makeCtx();
    ctx.playerPos.set(0, 0, 10);
    const shards = new CrownShards();
    shards.start(ctx);
    let landingHit = null;
    let flightHits = 0;
    while (!shards.isFinished()) {
      shards.update(STEP, ctx);
      const h = shards.checkPlayerHit(spheresAt(0, 10 + 1.55));
      if (h && shards.isFinished()) landingHit = h.clone();
      if (h && !shards.isFinished()) flightHits++;
    }
    expect(landingHit).not.toBeNull();
    expect(landingHit!.z).toBeCloseTo(10);
    expect(flightHits).toBe(0);

    const ctx2 = makeCtx();
    const s2 = new CrownShards();
    s2.start(ctx2);
    let missed = true;
    while (!s2.isFinished()) {
      s2.update(STEP, ctx2);
      if (s2.checkPlayerHit(spheresAt(0, 10 + 1.65))) missed = false;
    }
    expect(missed).toBe(true);
    expect(ctx2.scene.children).toHaveLength(ctx2.effects.count); // circles and shards removed
  });
});
