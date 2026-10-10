/**
 * Rage upgrades (GAME_DESIGN §6.5a). Each variant is switched on through the
 * `AttackContext.upgrades` override — config.ts is never edited (the all-false default is
 * asserted in config.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CubeSlam } from '../src/attacks/CubeSlam';
import { RoyalCharge } from '../src/attacks/RoyalCharge';
import { CrownRain } from '../src/attacks/CrownRain';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { makeCtx, type TestCtx } from './attackCtx';

const U = CONFIG.rageUpgrades;

/** Slam: the times at which each impact happened, and when the boss became free. */
function slamRun(ctx: TestCtx): { impacts: number[]; free: number } {
  const slam = new CubeSlam();
  slam.start(ctx);
  const impacts: number[] = [];
  let t = 0;
  while (!slam.isBossFree() && t < 20) {
    const before = slam.impactCount;
    slam.update(STEP, ctx);
    ctx.hazards.step(STEP);
    t += STEP;
    if (slam.impactCount > before) impacts.push(t);
  }
  return { impacts, free: t };
}

/** Charge: number of dashes and the length of the U-turn telegraph. */
function chargeRun(ctx: TestCtx): { dashes: number; uturnTime: number } {
  ctx.playerPos.set(0, 0, 10);
  const charge = new RoyalCharge();
  charge.start(ctx);
  let uturnTime = 0;
  let t = 0;
  while (!charge.isBossFree() && t < 20) {
    charge.update(STEP, ctx);
    t += STEP;
    if (charge.phaseName === 'uturn') uturnTime += STEP;
    ctx.playerPos.set(0, 0, -10); // the player is on the other side for the U-turn
  }
  return { dashes: charge.dashCount, uturnTime };
}

/** Rain: wave 0 flight times (index 0 = center). */
function rainFlights(ctx: TestCtx): number[] {
  const rain = new CrownRain();
  rain.start(ctx);
  while (!rain.isBossFree()) rain.update(STEP, ctx);
  return ctx.hazards.waveFlightTimes(0);
}

describe('rage upgrade: doubleSlam', () => {
  it('a 2nd impact (and ring) 0.5 s after the first; the window starts at the 2nd impact', () => {
    const r = slamRun(makeCtx({ rage: true, upgrades: { doubleSlam: true } }));
    expect(r.impacts).toHaveLength(2);
    expect(r.impacts[1] - r.impacts[0]).toBeCloseTo(U.doubleSlamDelay, 1);
    expect(r.free - r.impacts[1]).toBeCloseTo(CONFIG.slam.window, 1);
  });

  it('is ignored outside rage, and off by default in rage', () => {
    expect(slamRun(makeCtx({ rage: false, upgrades: { doubleSlam: true } })).impacts).toHaveLength(1);
    expect(slamRun(makeCtx({ rage: true })).impacts).toHaveLength(1);
  });
});

describe('rage upgrade: chargeUTurn', () => {
  it('re-telegraphs for 0.4 s and dashes once more (max one U-turn)', () => {
    const r = chargeRun(makeCtx({ rage: true, upgrades: { chargeUTurn: true } }));
    expect(r.dashes).toBe(2);
    expect(r.uturnTime).toBeCloseTo(U.uTurnTelegraph, 1);
  });

  it('is ignored outside rage, and off by default in rage', () => {
    expect(chargeRun(makeCtx({ rage: false, upgrades: { chargeUTurn: true } })).dashes).toBe(1);
    expect(chargeRun(makeCtx({ rage: true })).dashes).toBe(1);
  });
});

describe('rage upgrade: staggeredShards (Staggered Rain)', () => {
  it("wave 0's center shard flies 0.3 s longer than the rest of its cage", () => {
    const f = rainFlights(makeCtx({ rage: true, upgrades: { staggeredShards: true } }));
    for (let i = 1; i < f.length; i++) expect(f[0] - f[i]).toBeCloseTo(U.staggerExtraFlight, 9);
  });

  it('is ignored outside rage, and off by default in rage', () => {
    for (const ctx of [makeCtx({ rage: false, upgrades: { staggeredShards: true } }), makeCtx({ rage: true })]) {
      const f = rainFlights(ctx);
      for (let i = 1; i < f.length; i++) expect(f[0]).toBeCloseTo(f[i], 9);
    }
  });
});
