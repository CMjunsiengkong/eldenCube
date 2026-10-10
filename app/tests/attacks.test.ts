import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CubeSlam } from '../src/attacks/CubeSlam';
import { RoyalCharge } from '../src/attacks/RoyalCharge';
import { CrownRain, placeCage, placeScatter, placeWall, RAIN_MAX_R } from '../src/attacks/CrownRain';
import { RoyalRebuke } from '../src/attacks/RoyalRebuke';
import type { Attack } from '../src/attacks/Attack';
import { CONFIG } from '../src/config';
import { STEP } from '../src/loop';
import { createRng } from '../src/util/rng';
import { makeCtx, spheresAt, type TestCtx } from './attackCtx';

const RN = CONFIG.rain;
const RB = CONFIG.rebuke;

/** Runs the attack (and the hazards) until the boss is free; `each(t)` after every step. */
function runUntilFree(a: Attack, ctx: TestCtx, each?: (t: number) => void, max = 30): number {
  a.start(ctx);
  let t = 0;
  while (!a.isBossFree() && t < max) {
    a.update(STEP, ctx);
    ctx.hazards.step(STEP);
    t += STEP;
    each?.(t);
  }
  return t;
}

/** Steps the hazards alone until nothing is left (or max). */
function drainHazards(ctx: TestCtx, max = 10): number {
  const radii: number[] = [];
  let t = 0;
  while ((ctx.hazards.rainAlive || ctx.hazards.liveRings(radii).length > 0) && t < max) {
    ctx.hazards.step(STEP);
    t += STEP;
  }
  return t;
}

describe('Cube Slam (GAME_DESIGN §6.5 A)', () => {
  it('rise 1.0, hang 0.15, drop 0.20 → impact (ring hazard), then a 2.0 s punish window; free after it', () => {
    const ctx = makeCtx();
    const slam = new CubeSlam();
    let impactAt = -1;
    let windowSteps = 0;
    const radii: number[] = [];
    const total = runUntilFree(slam, ctx, (t) => {
      if (impactAt < 0 && slam.impactCount === 1) impactAt = t;
      if (slam.inPunishWindow()) {
        windowSteps++;
        expect(ctx.boss.stuck).toBe(true);
      }
    });
    expect(impactAt).toBeCloseTo(1.0 + 0.15 + 0.2, 1);
    expect(windowSteps * STEP).toBeCloseTo(CONFIG.slam.window, 1);
    expect(total - impactAt).toBeCloseTo(CONFIG.slam.window, 1);
    // The ring (1.475 s of travel) is gone before the window ends, but it was a hazard all along.
    expect(ctx.hazards.liveRings(radii)).toHaveLength(0);
    expect(ctx.boss.stuck).toBe(false);
  });

  it('a full combo started 0.7 s after the impact lands its last hit inside the window', () => {
    const lastDamage = 0.18 + 0.12 + 0.15 + 0.12 + 0.12 + 0.15 + 0.25 + 0.15; // 1.24 s
    expect(0.7 + lastDamage).toBeLessThan(CONFIG.slam.window);
  });

  it('impact frame: the footprint hits; the ring band r ± 0.9 hits; outside it does not', () => {
    const ctx = makeCtx();
    const slam = new CubeSlam();
    slam.start(ctx);
    for (let i = 0; i < 30; i++) {
      slam.update(STEP, ctx);
      expect(slam.checkPlayerHit(spheresAt(0, 1))).toBeNull(); // in the air
    }
    while (slam.impactCount === 0) slam.update(STEP, ctx);
    expect(slam.checkPlayerHit(spheresAt(0, 1))).not.toBeNull();
    ctx.hazards.step(STEP);
    const r = ctx.hazards.liveRings([])[0];
    expect(ctx.hazards.check(spheresAt(0, r + 0.89))).not.toBeNull();
    expect(ctx.hazards.check(spheresAt(0, r - 0.89))).not.toBeNull();
    expect(ctx.hazards.check(spheresAt(0, r + 0.95))).toBeNull();
  });

  it('asks for a Rebuke at the window end only when the player is within 5 m', () => {
    for (const [z, want] of [
      [4.9, true],
      [5.1, false],
    ] as const) {
      const ctx = makeCtx();
      ctx.playerPos.set(0, 0, z);
      const slam = new CubeSlam();
      runUntilFree(slam, ctx);
      expect(slam.wantsRebuke()).toBe(want);
    }
  });

  it('rage: telegraph ×0.6; the ring runs at 11.2 m/s; the window is not shortened', () => {
    const ctx = makeCtx({ rage: true });
    const slam = new CubeSlam();
    let impactAt = -1;
    const total = runUntilFree(slam, ctx, (t) => {
      if (impactAt < 0 && slam.impactCount === 1) impactAt = t;
    });
    expect(impactAt).toBeCloseTo(0.6 + 0.15 + 0.2, 1);
    expect(total - impactAt).toBeCloseTo(CONFIG.slam.window, 1);
  });
});

describe('Royal Charge (GAME_DESIGN §6.5 B)', () => {
  it('0.7 s telegraph, locks toward the player, dashes at 18 m/s, skids, then a 0.6 s recovery window', () => {
    const ctx = makeCtx();
    ctx.playerPos.set(10, 0, 0);
    const charge = new RoyalCharge();
    let tele = 0;
    let recovery = 0;
    let dashSpeed = 0;
    let prevX = 0;
    runUntilFree(charge, ctx, () => {
      if (charge.phaseName === 'telegraph') tele += STEP;
      if (charge.phaseName === 'dash' && ctx.boss.pos.x > 0.5 && ctx.boss.pos.x < 20) dashSpeed = (ctx.boss.pos.x - prevX) / STEP;
      if (charge.inPunishWindow()) {
        recovery += STEP;
        expect(ctx.boss.stuck).toBe(true);
      }
      prevX = ctx.boss.pos.x;
    });
    expect(tele).toBeCloseTo(CONFIG.charge.telegraph - STEP, 1);
    expect(dashSpeed).toBeCloseTo(18, 6);
    expect(recovery).toBeCloseTo(CONFIG.charge.recovery, 1);
    expect(ctx.boss.pos.x).toBeCloseTo(27, 6);
  });

  it('hits only during the dash', () => {
    const ctx = makeCtx();
    ctx.playerPos.set(0, 0, 5);
    const charge = new RoyalCharge();
    charge.start(ctx);
    let hit = null;
    while (!charge.isBossFree() && !hit) {
      charge.update(STEP, ctx);
      const h = charge.checkPlayerHit(spheresAt(0, 2.2));
      if (h) {
        expect(charge.phaseName).toBe('dash');
        hit = h;
      }
    }
    expect(hit).not.toBeNull();
  });
});

describe('Crown Rain (GAME_DESIGN §6.5 C)', () => {
  it('cage: center at P + V·0.5 plus 6 circles at 3.5 m, the first on boss→player', () => {
    const out = Array.from({ length: 12 }, () => new Vector3());
    const n = placeCage(0, 10, 2, 0, 0, 0, 0, out);
    expect(n).toBe(7);
    expect(out[0].toArray()).toEqual([1, 0, 10]);
    expect(out[1].x).toBeCloseTo(1);
    expect(out[1].z).toBeCloseTo(13.5);
    for (let i = 1; i < 7; i++) expect(Math.hypot(out[i].x - 1, out[i].z - 10)).toBeCloseTo(3.5);
  });

  it('wall: 5 circles 3.0 m apart, perpendicular to boss→player, through P + V·0.5', () => {
    const out = Array.from({ length: 12 }, () => new Vector3());
    const n = placeWall(0, 10, 0, 0, 0, 0, 0, out);
    expect(n).toBe(5);
    for (let i = 0; i < 5; i++) expect(out[i].z).toBeCloseTo(10); // perpendicular to boss→player (+Z)
    expect(out.slice(0, 5).map((v) => Math.round(v.x)).sort((a, b) => a - b)).toEqual([-6, -3, 0, 3, 6]);
  });

  it('scatter: up to 12 circles, ≥ 5 m apart, all inside the arena', () => {
    for (const seed of [1, 2, 3, 4]) {
      const out = Array.from({ length: 12 }, () => new Vector3());
      const n = placeScatter(createRng(seed), out);
      expect(n).toBeGreaterThanOrEqual(10);
      for (let i = 0; i < n; i++) {
        expect(Math.hypot(out[i].x, out[i].z)).toBeLessThanOrEqual(RAIN_MAX_R + 1e-9);
        for (let j = 0; j < i; j++) expect(out[i].distanceTo(out[j])).toBeGreaterThanOrEqual(RN.scatter.minSpacing - 1e-9);
      }
    }
  });

  it('every circle stays inside the arena, even for a player at the wall', () => {
    const out = Array.from({ length: 12 }, () => new Vector3());
    placeCage(0, 29.5, 0, 6, 0, 0, 0, out);
    for (let i = 0; i < 7; i++) expect(Math.hypot(out[i].x, out[i].z)).toBeLessThanOrEqual(RAIN_MAX_R + 1e-9);
    placeWall(29, 0, 0, 0, 0, 0, 0, out);
    for (let i = 0; i < 5; i++) expect(Math.hypot(out[i].x, out[i].z)).toBeLessThanOrEqual(RAIN_MAX_R + 1e-9);
  });

  it('the boss is free at the launch (end of the 1.0 s cast); the shards keep flying as hazards', () => {
    const ctx = makeCtx();
    const rain = new CrownRain();
    const t = runUntilFree(rain, ctx);
    expect(t).toBeCloseTo(RN.cast, 1);
    expect(ctx.hazards.rainAlive).toBe(true);
    expect(ctx.hazards.flyingShards([]).length).toBeGreaterThanOrEqual(7 + 5 + 10);
  });

  it('waves land at T, T + 0.4 and T + 0.8 after the launch (T = 0.8 / speed), exactly on their centers', () => {
    for (const [ctx, T] of [
      [makeCtx(), 0.8],
      [makeCtx({ rage: true }), 0.8 / 1.4],
      [makeCtx({ speedMult: 0.75 }), 0.8 / 0.75],
    ] as const) {
      const rain = new CrownRain();
      runUntilFree(rain, ctx);
      for (let w = 0; w < 3; w++) {
        for (const f of ctx.hazards.waveFlightTimes(w)) expect(f).toBeCloseTo(T + w * RN.waveGap, 9);
        for (const c of ctx.hazards.waveTargets(w)) expect(c.y).toBeCloseTo(RN.landHeight, 9);
      }
      const left = drainHazards(ctx);
      expect(left).toBeLessThan(T + 2 * RN.waveGap + 2 * STEP);
      expect(ctx.hazards.rainAlive).toBe(false);
    }
  });

  it('landing hits within 1.2 + 0.4 m of a circle center, not farther', () => {
    const ctx = makeCtx();
    ctx.playerPos.set(0, 0, 10);
    const rain = new CrownRain();
    runUntilFree(rain, ctx);
    const center = ctx.hazards.waveTargets(0)[0].clone();
    let hit = null;
    let t = 0;
    while (ctx.hazards.rainAlive && t < 3 && !hit) {
      ctx.hazards.step(STEP);
      t += STEP;
      const h = ctx.hazards.check(spheresAt(center.x, center.z + 1.55));
      if (h && Math.abs(h.y) < 1e-6) hit = h.clone();
    }
    expect(hit).not.toBeNull();
    expect(hit!.distanceTo(new Vector3(center.x, 0, center.z))).toBeLessThan(RN.circleRadius + 0.4);
  });

  it('clear(puff) removes every hazard with puffs', () => {
    const ctx = makeCtx();
    runUntilFree(new CrownRain(), ctx);
    ctx.hazards.spawnRing(0, 0, 8);
    ctx.hazards.clear(true);
    expect(ctx.hazards.rainAlive).toBe(false);
    expect(ctx.hazards.liveRings([])).toHaveLength(0);
    expect(ctx.effects.count).toBeGreaterThan(0);
    ctx.effects.clear();
    expect(ctx.scene.children).toHaveLength(0);
  });
});

describe('Royal Rebuke (GAME_DESIGN §6.5 D)', () => {
  it('tell 0.35 s, burst 0.10 s, recovery 0.30 s; hits within 4.5 + 0.4 m only during the burst', () => {
    const ctx = makeCtx();
    const rb = new RoyalRebuke();
    rb.start(ctx);
    const phases: Record<string, number> = { tell: 0, burst: 0, recovery: 0 };
    let hitIn = 0;
    let hitOut = 0;
    let hitOutsideBurst = 0;
    while (!rb.isBossFree()) {
      phases[rb.phaseName] = (phases[rb.phaseName] ?? 0) + STEP;
      rb.update(STEP, ctx);
      const inside = rb.checkPlayerHit(spheresAt(0, RB.endRadius + 0.39));
      if (inside && rb.phaseName === 'burst') hitIn++;
      if (inside && rb.phaseName !== 'burst') hitOutsideBurst++;
      if (rb.checkPlayerHit(spheresAt(0, RB.endRadius + 0.45))) hitOut++;
    }
    expect(phases.tell).toBeCloseTo(RB.tell, 1);
    expect(phases.burst).toBeCloseTo(RB.burst, 1);
    expect(phases.recovery).toBeCloseTo(RB.recovery, 1);
    expect(hitIn).toBeGreaterThan(0);
    expect(hitOutsideBurst).toBe(0);
    expect(hitOut).toBe(0);
  });

  it('a roll started at the tell covers the whole burst with i-frames', () => {
    // Roll i-frames run 0.05–0.40 s after the roll starts; the burst is 0.35–0.45 s after the tell starts.
    const rollStart = 0.05; // a reaction 0.05 s into the tell
    expect(rollStart + CONFIG.roll.iFrameStart).toBeLessThanOrEqual(RB.tell);
    expect(rollStart + CONFIG.roll.iFrameEnd).toBeGreaterThanOrEqual(RB.tell + RB.burst);
  });
});
