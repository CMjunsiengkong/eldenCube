/**
 * Rage upgrades (GAME_DESIGN §6.5a). Each variant is switched on through the
 * `AttackContext.upgrades` override — config.ts is never edited (the all-false default is
 * asserted in config.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CubeSlam } from '../src/attacks/CubeSlam';
import { RoyalCharge } from '../src/attacks/RoyalCharge';
import { CrownShards } from '../src/attacks/CrownShards';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { makeCtx, type TestCtx } from './attackCtx';

const U = CONFIG.rageUpgrades;

/** Slam: the times (since start) at which each ring spawned. */
function slamRingSpawns(ctx: TestCtx): number[] {
  const slam = new CubeSlam();
  slam.start(ctx);
  const spawns: number[] = [];
  const radii: number[] = [];
  let prev = 0;
  let t = 0;
  while (!slam.isFinished() && t < 20) {
    slam.update(STEP, ctx);
    t += STEP;
    const n = slam.liveRings(radii).length;
    if (n > prev) spawns.push(t); // the 2nd ring spawns while the 1st is still expanding
    prev = n;
  }
  return spawns;
}

/** Charge: number of dashes and the length of the 2nd telegraph. */
function chargeRun(ctx: TestCtx): { dashes: number; uturnTime: number } {
  ctx.playerPos.set(0, 0, 10);
  const charge = new RoyalCharge();
  charge.start(ctx);
  let uturnTime = 0;
  let t = 0;
  while (!charge.isFinished() && t < 20) {
    charge.update(STEP, ctx);
    t += STEP;
    if (charge.phaseName === 'uturn') uturnTime += STEP;
    ctx.playerPos.set(0, 0, -10); // the player is on the other side for the U-turn
  }
  return { dashes: charge.dashCount, uturnTime };
}

/** Shards: landing time (since launch) per shard index (0 = center). */
function shardLandings(ctx: TestCtx): number[] {
  const shards = new CrownShards();
  shards.start(ctx);
  const landed: number[] = [-1, -1, -1];
  const flying = shards.flyingShards([]);
  let tFlight = 0;
  let launched = false;
  let t = 0;
  // Track each shard by its mesh identity through flyingShards().
  let tracked: unknown[] = [];
  while (!shards.isFinished() && t < 20) {
    shards.update(STEP, ctx);
    t += STEP;
    shards.flyingShards(flying);
    if (!launched && shards.phaseName === 'flight') {
      launched = true;
      tracked = [...flying];
    }
    if (launched) {
      tFlight += STEP;
      tracked.forEach((p, i) => {
        if (landed[i] < 0 && !flying.includes(p as never)) landed[i] = tFlight;
      });
    }
  }
  return landed;
}

describe('rage upgrade: doubleSlam', () => {
  it('spawns a 2nd ring 0.5 s after the first impact', () => {
    const spawns = slamRingSpawns(makeCtx({ rage: true, upgrades: { doubleSlam: true } }));
    expect(spawns).toHaveLength(2);
    expect(spawns[1] - spawns[0]).toBeCloseTo(U.doubleSlamDelay, 6);
  });

  it('is ignored outside rage, and off by default in rage', () => {
    expect(slamRingSpawns(makeCtx({ rage: false, upgrades: { doubleSlam: true } }))).toHaveLength(1);
    expect(slamRingSpawns(makeCtx({ rage: true }))).toHaveLength(1);
  });

  it('the attack finishes only after the 2nd ring has expired', () => {
    const ctx = makeCtx({ rage: true, upgrades: { doubleSlam: true } });
    const slam = new CubeSlam();
    slam.start(ctx);
    const radii: number[] = [];
    let lastLive = 0;
    while (!slam.isFinished()) {
      slam.update(STEP, ctx);
      lastLive = slam.liveRings(radii).length || lastLive;
    }
    expect(lastLive).toBeGreaterThan(0);
    expect(ctx.scene.children).toHaveLength(0);
  });
});

describe('rage upgrade: chargeUTurn', () => {
  it('re-telegraphs for 0.4 s and dashes once more (max one U-turn)', () => {
    const r = chargeRun(makeCtx({ rage: true, upgrades: { chargeUTurn: true } }));
    expect(r.dashes).toBe(2);
    expect(r.uturnTime).toBeCloseTo(U.uTurnTelegraph, 6);
  });

  it('is ignored outside rage, and off by default in rage', () => {
    expect(chargeRun(makeCtx({ rage: false, upgrades: { chargeUTurn: true } })).dashes).toBe(1);
    expect(chargeRun(makeCtx({ rage: true })).dashes).toBe(1);
  });
});

describe('rage upgrade: staggeredShards', () => {
  it('lands the center shard 0.3 s after the sides', () => {
    const ctx = makeCtx({ rage: true, upgrades: { staggeredShards: true } });
    const [center, a, b] = shardLandings(ctx);
    expect(a).toBeCloseTo(b, 9);
    expect(center - a).toBeCloseTo(U.staggerExtraFlight, 1);
    expect(center - a).toBeGreaterThan(U.staggerExtraFlight - STEP - 1e-9);
  });

  it('is ignored outside rage, and off by default in rage', () => {
    for (const ctx of [makeCtx({ rage: false, upgrades: { staggeredShards: true } }), makeCtx({ rage: true })]) {
      const [center, a, b] = shardLandings(ctx);
      expect(center).toBeCloseTo(a, 9);
      expect(a).toBeCloseTo(b, 9);
    }
  });
});
